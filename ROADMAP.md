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
