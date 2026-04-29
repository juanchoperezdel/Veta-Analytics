// Parser de rutas/destinos para Andesmar.
// Extrae el destino canónico desde:
//   - Nombres de campañas Meta (ej: "VETA_Conversion_Advantage_MZA_SJ" → "Mendoza ↔ San Juan")
//   - Nombres de campañas Google Ads (ej: "Search_Brand_Comercial_MZA" → "Mendoza")
//   - Search terms (ej: "andesmar mendoza" → "Mendoza")
//
// Si no matchea ninguna regla, devuelve null y el row queda sin clasificar
// (igual cuenta para totales generales pero no para vistas por destino).

// Mapa de tokens (lowercase, sin acentos) → destino canónico.
// Cubrimos abreviaturas (MZA, SJ, BA), nombres completos (mendoza), regiones (NOA, Patagonia, NEA),
// y países/destinos especiales (chile, santiago de chile).
const DESTINATION_MAP: Record<string, string> = {
  // Provincias / ciudades argentinas
  mza: 'Mendoza',
  mendoza: 'Mendoza',
  sj: 'San Juan',
  sanjuan: 'San Juan',
  'san juan': 'San Juan',
  ba: 'Buenos Aires',
  bsas: 'Buenos Aires',
  'buenos aires': 'Buenos Aires',
  cba: 'Córdoba',
  cordoba: 'Córdoba',
  córdoba: 'Córdoba',
  salta: 'Salta',
  jujuy: 'Jujuy',
  tucuman: 'Tucumán',
  tucumán: 'Tucumán',
  neuquen: 'Neuquén',
  neuquén: 'Neuquén',
  bariloche: 'Bariloche',
  corrientes: 'Corrientes',
  rosario: 'Rosario',
  retiro: 'Retiro',
  // Regiones
  noa: 'NOA',
  nea: 'NEA',
  patagonia: 'Patagonia',
  centro: 'Centro',
  sur: 'Sur',
  nacionales: 'Nacionales',
  destinos: 'Nacionales',
  // Internacional
  cl: 'Chile',
  chile: 'Chile',
  santiagodechile: 'Santiago de Chile',
  'santiago de chile': 'Santiago de Chile',
};

// Tokens que NO son rutas — los ignoramos para no falsos positivos
const STOPWORDS = new Set([
  'veta', 'andesmar', 'pasajes', 'boletos', 'precios', 'horarios', 'turismo',
  'argentina', 'empresa', 'pasaje', 'online',
  'search', 'pmax', 'performancemax', 'display', 'trafico', 'tráfico', 'conversion', 'conversión',
  'advantage', 'brand', 'comercial', 'dinamica', 'dinámica', 'genericas', 'genéricas',
  'transaccionales', 'urgencia', 'demanda', 'generación', 'generacion', 'youtube',
  'estaciones', 'estudiantes', 'bancos', 'tarjetas', 'starlink', 'lowcost', 'low',
  'cost', 'musica', 'música', 'golondrina', 'campañas', 'campanas', 'puestos',
  'laborales', 'mensajes', 'whatsapp', 'alcance', 'instagram', 'alwayson', 'always',
  'on', 'post', 'aerea', 'aérea', 'competencia', 'rutas', 'todoelsitio', 'todo',
  'el', 'sitio', 'regiones', 'genericos', 'genéricos', 'solo', 'nuevos', 'mensaje',
  'smile', 'exc', 'excmza',
  // Conectores
  'a', 'de', 'la', 'el', 'los', 'las', 'y', 'o', 'el', 'del',
]);

/**
 * Normaliza un string para matchear: lowercase, sin acentos, alfanumérico + espacios.
 */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // quita acentos
    .replace(/[^a-z0-9\s_-]/g, ' ')
    .trim();
}

/**
 * Parsea un nombre de campaña o search term y devuelve la ruta canónica.
 *
 * - Si encuentra 1 destino: devuelve el destino (ej: "Mendoza")
 * - Si encuentra 2+ destinos: devuelve "A ↔ B" (origen-destino) usando los primeros 2
 * - Si no encuentra ninguno: devuelve null
 *
 * Ejemplos:
 *   parseRoute("VETA_Conversion_Advantage_MZA_SJ") → "Mendoza ↔ San Juan"
 *   parseRoute("Search_Brand_Comercial_MZA")       → "Mendoza"
 *   parseRoute("andesmar mendoza")                 → "Mendoza"
 *   parseRoute("PMax_Tarjetas_Bancos")             → null
 */
export function parseRoute(name: string | null | undefined): string | null {
  if (!name) return null;

  const normalized = normalize(name);
  // Tokens: split por espacio, guion bajo o guion
  const tokens = normalized.split(/[\s_-]+/).filter(t => t.length > 0 && !STOPWORDS.has(t));

  // Buscamos matches: priorizamos multi-token (ej: "san juan", "santiago de chile")
  // así que primero probamos pares y triples antes de tokens sueltos.
  const found: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    let matched = false;
    // Triple
    if (i + 2 < tokens.length) {
      const triple = `${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`;
      if (DESTINATION_MAP[triple]) {
        if (!found.includes(DESTINATION_MAP[triple])) found.push(DESTINATION_MAP[triple]);
        i += 3;
        matched = true;
      }
    }
    // Doble
    if (!matched && i + 1 < tokens.length) {
      const pair = `${tokens[i]} ${tokens[i + 1]}`;
      if (DESTINATION_MAP[pair]) {
        if (!found.includes(DESTINATION_MAP[pair])) found.push(DESTINATION_MAP[pair]);
        i += 2;
        matched = true;
      }
    }
    // Simple
    if (!matched) {
      if (DESTINATION_MAP[tokens[i]]) {
        if (!found.includes(DESTINATION_MAP[tokens[i]])) found.push(DESTINATION_MAP[tokens[i]]);
      }
      i += 1;
    }
  }

  if (found.length === 0) return null;
  if (found.length === 1) return found[0];
  // 2+ destinos → ruta origen-destino (los primeros 2)
  return `${found[0]} ↔ ${found[1]}`;
}
