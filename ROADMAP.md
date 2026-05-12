# Veta Analytics — Roadmap

Hub de inteligencia para tomar decisiones de negocio sobre pauta digital
(Meta + Google + GA4). Convierte data en acción concreta sin requerir
manipulación manual.

## Done (commit 4ce5b1f)

- [x] Pestaña **Pulso** — semáforos rojo/ámbar/verde + alertas auto + wins
- [x] Pestaña **Embudo** — funnel detallado vs mes anterior
- [x] Refactor **Rutas/Destinos** — sparklines, top movers, oportunidades, mix de canal
- [x] Sync de **search terms** de Google Ads (~17K queries con ruta inferida)
- [x] Sync de **creatives ad-level** de Meta con thumbnails (top 60 por spend)
- [x] Sync de **demographics** de Meta (age, gender, region, placement)
- [x] **Parser de rutas** desde nombres de campaña (MZA→Mendoza, MZA_SJ→Mendoza↔San Juan)
- [x] Tab Meta Ads ampliada — galería de creatives + heat-maps demográficos
- [x] Tab Google Ads ampliada — top conversores + queries que gastan sin convertir
- [x] **GA4 resiliente** — si el token expira, el resto del sync sigue

---

## Done — Tier 1 + Tier 2 (commits siguientes)

### Tier 1 — decisiones inmediatas
- [x] **Análisis de competencia** (`competitors.ts` + sección en GoogleAds)
- [x] **Forecast del mes** (extensión de Pulso)
- [x] **Health score por campaña** (Escalar/OK/Optimizar/Pausar en Meta y Google)
- [x] **Negative keywords accionables** (botón copy-paste + ahorro estimado)
- [x] **ROAS por destino visible** (badge con semáforo en tab Rutas)
- [x] **Pacing presupuestario** (`client_budgets` + form modal + card)

### Tier 2 — profundidad
- [x] **Estacionalidad** (sync hourly + nueva pestaña con heat-map día×hora)
- [x] **Detección de anomalías** (z-score sobre KPIs en Pulso)
- [x] **Demographic mismatch** (cruce spend share vs conversion share)
- [x] **Resumen semanal por email** (Resend + GH Actions cron)

---

## En espera — Tier 1 (decisiones inmediatas)

Las 6 features con mayor relación valor/esfuerzo. Apuntan a que el dueño/CEO
pueda en 30 segundos saber qué hacer hoy.

### 1. Análisis de competencia
Vista que aísla el spend en queries de competidores (`flecha bus`, `busplus`,
`cata internacional`, etc.) y muestra: spend total, conversion rate, cuánto
sería el ahorro si se cortara.
**Decisión**: pelear o no por queries de competencia.
**Archivos**: `netlify/functions/competitors.ts`, sección nueva en `GoogleAds.tsx`

### 2. Forecast del mes
Card en Pulso: "A este pace, vas a terminar el mes con $X (+Y% vs mes pasado)".
Regresión lineal sobre días corridos del mes.
**Decisión**: saber si vas a llegar a la meta antes de que se acabe el mes.
**Archivos**: actualizar `pulse.ts`, sumar componente `ForecastCard` en `Pulse.tsx`

### 3. Detector de campañas que requieren acción
Health score por campaña ("Escalar / OK / Optimizar / Pausar") basado en reglas
sobre ROAS, CPA, días sin conversión, tendencia 7d.
**Decisión**: en 30 segundos sabés en qué 5 campañas trabajar hoy.
**Archivos**: actualizar `meta-ads.ts` y `google-ads.ts` para devolver `healthScore`,
nueva sección "Acciones sugeridas" en ambas tabs

### 4. Negative keywords accionables
Mejora a "queries que gastan sin convertir" — botón "copiar lista" con sintaxis
de negative keywords + ahorro estimado mensual.
**Decisión**: una acción de copy-paste, dinero ahorrado real.
**Archivos**: actualizar `search-terms.ts` para devolver ahorro proyectado;
botón en sección de search terms de `GoogleAds.tsx`

### 5. ROAS por destino visible
Mejora a tab Rutas: ordenar por rentabilidad en lugar de revenue absoluto,
agregar columna ROAS visible con semáforo (rojo/ámbar/verde).
**Decisión**: redistribuir budget entre destinos.
**Archivos**: `Products.tsx`

### 6. Pacing presupuestario
Card en Pulso: "Vas $X gastado de $Y planeado, llevás 60% del mes pero gastaste
75% → desacelerar". Form simple para cargar budgets mensuales por cliente.
**Decisión**: no quedarte corto ni pasarte.
**Archivos**: nueva tabla `client_budgets`, `netlify/functions/budgets.ts`,
`netlify/functions/budgets-set.ts` (POST), card en `Pulse.tsx`, form simple

---

## Tier 2 — Profundidad (más complejo, más valor en el tiempo)

### 7. Estacionalidad: mejor día/hora para pautar
Sumar al sync `hour_of_day` y `day_of_week` de Meta + Google. Heat-map
"los miércoles 6pm convierten 3x más".
**Decisión**: dayparting de campañas.
**Archivos**: extender `index.ts` (sync), nueva tabla `meta_ads_hourly` y
`google_ads_hourly`, nueva pestaña `Seasonality.tsx`

### 8. Detección de anomalías
Algoritmo simple sobre últimos 30 días: si un KPI sale de ±2 desviaciones
estándar de su banda histórica, alerta automática en Pulso.
**Decisión**: reaccionar a problemas antes de descubrirlos por casualidad.
**Archivos**: actualizar `pulse.ts` con cálculo z-score

### 9. Demographic mismatch
"Gastás 60% en mujeres 25-34, pero las que mejor convierten son 35-44 con ROAS
2.3x más alto". Cruce spend share vs conversion share por dimension.
**Decisión**: redistribuir budget entre audiencias.
**Archivos**: nueva sección en tab Meta o pestaña dedicada

### 10. Resumen ejecutivo semanal por email
Lunes 9am: email automático con "esto pasó la semana, esto requiere atención,
esto está funcionando". Vía Resend.
**Decisión**: no perderte nada estés donde estés.
**Archivos**: `scripts/weekly-report.ts`, `.github/workflows/weekly-report.yml`,
plantilla HTML en `scripts/templates/weekly.html`

---

## Próxima frontera — Análisis con LLM (priorizado)

### 11. Conclusiones estratégicas con Claude (analista, no watchdog)

Las conclusiones actuales de cada pestaña son reglas determinísticas
(`netlify/functions/_conclusions.ts`): `if savings > 5000`, `if share >= 25%`,
etc. Funcionan como **watchdog** — alertan cuando algo cruza un umbral —
pero tienen un techo claro:

- Solo dicen lo que ya pensamos preguntar. Patrones nuevos no aparecen.
- Una vez vistas 3 veces dejan de informar. Se vuelven checklist, no descubrimiento.
- Las que siempre aparecen son justamente las que no estás dispuesto a actuar.
- No cruzan dimensiones (creative × hora × demográfico × ruta) ni consideran
  contexto de calendario (Hot Sale, fin de mes, feriados).

**Solución**: sumar un segundo nivel de conclusiones, generadas por Claude
una vez por semana (no cada hora). Las reglas siguen como watchdog para
alarmas urgentes; el LLM hace el descubrimiento profundo.

**Cómo funciona**:
- Lunes 9am ART, antes del weekly email, un job llama a Claude Sonnet con
  toda la data agregada del cliente: campañas, queries, demografía,
  evolutivo, anomalías, contexto de calendario.
- Prompt pide 5 hallazgos accionables que un analista experto encontraría,
  incluyendo cruces multidimensionales y consideraciones contextuales.
- Output se guarda en `llm_insights (week_start, client_id, payload jsonb)`.
- UI: nueva sección "Análisis semanal" arriba de cada pestaña (o pestaña
  dedicada `Insights.tsx`) que muestra los hallazgos con marca temporal.
- El weekly email incluye los 3 más importantes en el cuerpo.

**Decisión**: dejar de ver siempre lo mismo. Insights frescos cada semana
con cruces que las reglas no pueden hacer.

**Costo**: ~$0.50–$1 por análisis con Sonnet. Una vez por semana por
cliente → **<$5/mes** total para Andesmar.

**Archivos**:
- nueva tabla `llm_insights` en `scripts/db/schema.sql`
- `scripts/weekly-llm-analysis.ts` (job que llama a Claude y persiste)
- `.github/workflows/weekly-llm-analysis.yml` (cron lunes 8:30am ART, antes
  del email para que el email pueda incluirlos)
- `netlify/functions/insights.ts` (sirve el último snapshot)
- componente `WeeklyInsights.tsx` que se monta en pestañas relevantes
- extender `scripts/weekly-report.ts` para incluir top 3 en el email
- env var `ANTHROPIC_API_KEY` en GH Secrets

**Pre-requisito**: no requiere arreglar GA4. Funciona con la data que ya
tenemos en Neon (Meta + Google + breakdowns + hourly).

---

## Tier 3 — Espera

- **Cohort / LTV** — quién vuelve a comprar por canal (necesita GA4 + user_id consistente)
- **Análisis de landing pages** — qué página engancha mejor (necesita GA4 OK)
- **Multi-touch attribution** — cómo se combinan canales en el journey
- **Frequency capping insights** — cuándo se quema una audiencia (sumar a creatives)
- **Auction insights** — impression share, dónde perdés vs competencia
- **Anotaciones / comentarios** — markers en gráficos para eventos del negocio
- **Multi-cliente real** — extender `clients` con credenciales por cliente
- **Reactivar YouTube** — sync ya existe, falta definir cómo se mide

---

## Bloqueos conocidos

- **GA4 token expirado** — afecta `business_kpis` (Dashboard, Embudo, parte de Pulso).
  Solución: publicar OAuth consent en Production O migrar a service account
  cuando se tenga acceso admin a GA4 de Andesmar.
- **JWT_SECRET vacío en `.env` local** — solo afecta dev, no prod. Fix:
  `npx netlify env:get JWT_SECRET` y pegar en `.env`.

## Setup pendiente del usuario (para activar features nuevas)

### Resumen semanal por email
Agregar a **GitHub Secrets** del repo `juanchoperezdel/Veta-Analytics`:
- `RESEND_API_KEY` — sacar gratis en [resend.com](https://resend.com) (plan free permite 100 emails/día)
- `REPORT_FROM_EMAIL` — opcional. Default: `Veta Analytics <onboarding@resend.dev>`. Si tenés dominio verificado en Resend, usalo (ej: `Veta Analytics <reportes@tudominio.com>`)

El cron corre lunes 9am ART automáticamente. Para probar antes: GitHub → Actions → Weekly Report → Run workflow.

### Pacing presupuestario
Cargar el budget mensual desde el dashboard: pestaña **Pulso** → card "Pacing presupuestario" → "Cargar budget". Una vez por mes.

---

## Sacado intencionalmente — por si vuelve

### "Top destinos" en el informe Hot Sale (sacado 2026-05-11)

Era una tabla en la Sección 1 del informe `/hot-sale-andesmar-2026` que
listaba las rutas/destinos con más ingresos durante la Hot Week, inferidas
por el parser de rutas (`scripts/sync/parse-routes.ts`) que matchea tokens
del nombre de campaña a un destino canónico.

**Por qué se sacó**:
- La data no es confiable. La "ruta" se infiere del **nombre de la campaña**,
  no del **producto comprado**. Una persona puede ver un ad de la campaña
  "Mendoza" y terminar comprando "Buenos Aires" — el spend queda asignado
  a Mendoza pero la venta real es otra ruta.
- El cliente comparó con sus dashboards de Analytics y los números no
  cuadran. Mostrarle algo incorrecto en un informe oficial mina la
  credibilidad de todo el dashboard.

**Cómo volver a meterlo**:
- Necesitaríamos ecommerce tracking en GA4 (la tabla `product_routes` para
  poblarse), o un export del back de Andesmar con las ventas por ruta.
- Mientras no tengamos esa fuente, la "ruta inferida de campaña" sirve
  para análisis interno (cómo distribuimos el spend) pero NO para
  presentarle al cliente como "qué rutas vendieron más".
- En `netlify/functions/hot-sale.ts`: la función `topRoutes()` y sus dos
  llamadas en el `Promise.all` se borraron. Buscar git blame del archivo
  para recuperar el código.
- En `src/pages/HotSale.tsx`: el bloque JSX y el componente `RoutesTable`
  también se borraron.

### "Búsquedas más relevantes (Google Ads)" en el informe Hot Sale (sacado 2026-05-11)

Era una tabla con los top queries de Google Ads que activaron los ads
durante la Hot Week, ordenadas por conversiones.

**Por qué se sacó**:
- En Andesmar, casi el 100% de las top queries son brand ("andesmar",
  "andesmar pasajes", "andesmar mendoza", etc.). Mostrarle al cliente
  que la mayoría del search es brand puede leerse como "Google Ads solo
  está capturando demanda existente" — info técnicamente correcta pero
  mala como presentación.

**Reemplazada por**: tabla "Campañas que más vendieron" (Meta + Google
combinadas, ordenadas por revenue).

**Cómo volver a meterlo** si querés mostrarla en algún momento:
- Filtrar para excluir queries que contengan "andesmar" (sería mostrar
  demanda no-brand).
- En `netlify/functions/hot-sale.ts`: la función `topSearchTerms()` se
  borró. Buscar git blame para recuperar el código.

### "Lift sobre el baseline" en el informe Hot Sale (sacado 2026-05-11)

Era un card en la Sección 3 del informe `/hot-sale-andesmar-2026` que comparaba
el promedio diario de la Hot Week vs el promedio diario de las 4 semanas previas
(BASELINE_4W = 6 abr → 3 may 2026). Mostraba spend / revenue / purchases diarios
con un % de lift.

**Por qué se sacó**:
1. Mientras el evento estaba en curso, el "promedio diario" del Hot Week se
   calculaba dividiendo el total por 7 aunque solo hubieran pasado 1-2 días.
   Resultado: aparecía -83% / -69% / -76% el primer día y daba la sensación
   de que el evento estaba fallando cuando recién arrancaba.
2. Aunque se arreglara el cálculo (dividir por días reales transcurridos),
   no aportaba una decisión accionable — el cliente ya tiene "vs semana base"
   y "vs HS 2025" como comparativas más claras.
3. Detectamos también un posible bug numérico: las compras diarias del Hot
   Week salían en 34.571 cuando los KPIs hero del mismo período mostraban
   46 compras totales. Nunca se llegó a investigar la raíz porque el card
   se sacó antes.

**Cómo volver a meterlo** si surge la necesidad:
- En `netlify/functions/hot-sale.ts`: reagregar la constante `BASELINE_4W`,
  el `kpisInRange()` correspondiente en `Promise.all`, el cálculo de `lift`
  con `baselineDailyAvg` / `hotWeekDailyAvg` / `*Lift`, y exponerlo en el
  return.
- En `src/pages/HotSale.tsx`: reagregar el tipo `lift` en `HotSaleData`,
  el destructuring, el componente `LiftCard`, y la sección JSX (entre el
  SectionHeader de la 3 y el card del Heat-map).
- **Antes de mostrar**: arreglar el cálculo del `hotWeekDailyAvg` para
  dividir por días reales transcurridos (no por 7 fijo), y mostrar el
  card solo cuando `phase === 'after'` para evitar números engañosos.
- Investigar el desfase de purchases: posible double-count entre Meta y
  Google si una compra se atribuye a ambos canales, o un bug en cómo se
  suma `google_ads_campaigns.carts` (que pueden ser eventos de add-to-cart,
  no ventas reales).
