# Veta Analytics — Memoria del Proyecto

Hub de inteligencia de pauta digital multi-cliente que combina Meta Ads,
Google Ads y GA4 en una sola vista. Convierte data en **decisiones concretas**
para el dueño/CEO: qué escalar, qué pausar, dónde mover budget, qué requiere
atención hoy.

Para el plan por features y status detallado ver [`ROADMAP.md`](./ROADMAP.md).

## Stack

- **Frontend**: React 19 + Vite + TypeScript + Tailwind CSS + Recharts + react-router 7
- **Backend**: Netlify Functions (`netlify/functions/*.ts`) — serverless
- **DB**: Neon PostgreSQL (serverless)
- **Auth**: JWT manual (`jose`) + hash SHA-256 de passwords. Tabla `users` + `user_clients`
- **Sync de data**: GitHub Actions cron `0 * * * *` (cada hora)
- **Email**: Resend API (resumen semanal automático)
- **Deploy**: Netlify conectado al repo `juanchoperezdel/Veta-Analytics`
- **Repo**: https://github.com/juanchoperezdel/Veta-Analytics (público)

## Arquitectura

```
GitHub Actions (cron 1h)
  └── scripts/sync/index.ts
        ├── Meta Marketing API v21
        │   ├── syncMetaAds         (campaigns daily, level=campaign)
        │   ├── syncMetaCreatives   (level=ad, top 60 por spend, 7d, thumbnails)
        │   ├── syncMetaBreakdowns  (age/gender/region/publisher_platform, 30d)
        │   └── syncMetaHourly      (account level con hourly_stats, 14d)
        ├── Google Ads API v20 (service account JWT)
        │   ├── syncGoogleAds         (campaign level daily, 30d)
        │   ├── syncGoogleAdsSearchTerms (search_term_view, 30d con concurrency)
        │   └── syncGoogleAdsHourly   (customer level + segments.hour, 14d)
        └── GA4 Data API v1beta (refresh_token OAuth — actualmente expirado)
              └── syncGA4: business_kpis + product_routes (vacío para Andesmar)

GitHub Actions (cron lunes 12:00 UTC = 9am ART)
  └── scripts/weekly-report.ts → Resend → email a usuarios autorizados

Neon PostgreSQL
  └── 12 tablas (ver "Schema de Neon")

Netlify (frontend + 16 functions)
  └── React SPA (JWT en localStorage)
```

## Schema de Neon

Tablas (`scripts/db/schema.sql`, 25 statements al aplicarlo):

**Auth y multi-tenant**
- `users` — id, email, password_hash
- `clients` — id, slug, name, logo_initial
- `user_clients` — user_id × client_id (autorización por slug)

**Campañas y agregados**
- `business_kpis` — KPIs diarios de GA4 (users, sessions, revenue, etc.)
- `google_ads_campaigns` — un row por (client, date, campaign_id), incluye columna `route`
- `google_ads_kpis` — agregados diarios con deltas (legacy, preserved)
- `meta_ads_campaigns` — un row por (client, date, campaign_id), incluye `effective_status`, `route`, `type` (objective)
- `meta_ads_kpis` — agregados diarios con deltas (legacy, preserved)
- `product_routes` — rutas de e-commerce GA4 (vacío para Andesmar)

**Inteligencia adicional (agregadas en mayo 2026)**
- `google_ads_search_terms` — queries reales con `route` parseado, ~21K filas para Andesmar
- `meta_ads_creatives` — ad-level con `thumbnail_url`, `effective_status`, métricas (rolling 7d)
- `meta_ads_breakdowns` — dimension_type (age/gender/region/publisher_platform) × dimension_value
- `meta_ads_hourly` — spend/revenue/purchases por (date, hour 0-23)
- `google_ads_hourly` — spend/revenue/conversions por (date, hour 0-23)
- `client_budgets` — budget mensual por cliente (form en Pulso)
- `youtube_videos` — pausado (sync comentado)

Todas tienen `ON CONFLICT ... DO UPDATE` para upserts idempotentes.

## Pestañas del dashboard

Sidebar (`src/components/layout/AppLayout.tsx`):

1. **Pulso** (default) — semáforos de salud + alertas auto + wins + forecast del mes + pacing presupuestario + anomaly detection (z-score)
2. **Dashboard** — KPIs hero + donut canales (preservado del original)
3. **Google Ads** — KPIs + spend en queries de competidores + negative keywords accionables + tabla campañas con health score
4. **Meta Ads** — KPIs + galería de creatives con thumbnails + heat-maps demográficos + recomendaciones de redistribución (mismatch)
5. **Evolutivo** — line chart YoY mensual + tabla histórica
6. **Rutas / Destinos** — sparklines, top movers, oportunidades, mix de canal, ROAS visible con semáforo
7. **Embudo** — Usuarios → Sesiones → Carritos → Compras (depende de business_kpis = GA4)
8. **Estacionalidad** — heat-map día×hora + por día del mes + por fase del mes (Principio/Mitad/Fin) + por día semana, con DateRangePicker y selector Meta/Google/All
9. **YouTube** — preservada pero con sync deshabilitado

## Informes públicos (sin auth)

Páginas standalone para mandar links directo al cliente, fuera del dashboard
authenticated.

### `/hot-sale-andesmar-2026` (`src/pages/HotSale.tsx` + `netlify/functions/hot-sale.ts`)

Informe de un solo scroll para presentar al cliente Andesmar en el evento
Hot Sale 2026. Sin login: el gate es por oscuridad — el path es específico
y no está linkeado desde ningún lado. Si hay que revocar acceso se cambia
el path en `App.tsx` y se redeploya.

Tres secciones:
1. **Semana base (4-10 may) vs Hot Week (11-17 may)** — KPIs hero (totales y
   por canal Meta/Google), curva diaria 14d con franja resaltada (ingresos
   + inversión + compras en doble eje), **top destinos vendidos según GA4
   ecommerce**, top creatives Meta con thumbnails, y top campañas Meta+Google
   por revenue.
2. **YoY Hot Week 2025 (12-18 may) vs 2026 (11-17 may)** — solo Meta + Google
   total y por canal, sin breakdown por ruta (la data 2025 no está bien
   etiquetada).
3. **Heat-map hora×día Hot Week + demografía** (edad, género, región,
   placement de Meta).

**Sacado intencionalmente** (ver `ROADMAP.md` para detalle):
- "Búsquedas Google" — Andesmar tiene ~100% brand search, no agrega para
  presentar al cliente.
- "Lift sobre baseline 4 semanas" — métrica engañosa mientras el evento
  está en curso.

Fechas hardcodeadas como constantes en el endpoint. Para reusar el patrón
con otro evento (Cyber Monday, Black Friday, etc.) crear nuevo archivo
copiando la estructura.

**UX time-locked**: cuando la Hot Week aún no empezó (todos los KPIs en 0),
los cards y tablas detectan eso automáticamente y muestran la **semana base
como protagonista** (es el dato vivo), con un badge ámbar "pendiente" en
lugar del delta. Cuando arranca el evento y empieza a llegar data, vuelve
solo a la presentación normal.

## Parser de rutas (`scripts/sync/parse-routes.ts`)

Andesmar **no tiene e-commerce tracking en GA4** — `product_routes` está
vacía. Por eso las rutas se infieren del **nombre de campaña** (Meta + Google)
y de **search terms** de Google Ads.

Mapeo de tokens → destino canónico:
- `MZA, mendoza` → Mendoza
- `SJ, sanjuan, san juan` → San Juan
- `BA, bsas` → Buenos Aires
- `cba, cordoba` → Córdoba
- `salta, jujuy, tucuman, neuquen, bariloche, corrientes, rosario, retiro` → su nombre
- `noa, nea, patagonia, centro, sur, nacionales` → región
- `cl, chile` → Chile
- `santiagodechile` → Santiago de Chile

Si encuentra 2+ destinos en el mismo string → ruta origen-destino con `↔`
(ej: `VETA_Conversion_Advantage_MZA_SJ` → `Mendoza ↔ San Juan`).

Stopwords filtran palabras comunes de campaign names (VETA, Conversion,
Advantage, AlwaysOn, Estudiantes, Bancos, etc.).

Después de cualquier cambio al parser, correr `scripts/backfill-routes.ts`
para repoblar `route` en filas históricas.

## Estado actual de la data (mayo 2026)

- **Meta Ads**: ~4000 filas (oct 2024 → hoy), 1446 con ruta parseada
- **Google Ads**: ~8200 filas (oct 2024 → hoy), 3153 con ruta parseada
- **Search Terms**: ~21K queries únicas, ~10K con ruta parseada
- **Meta Creatives**: 842 filas, 141 ads únicos, 500 con thumbnail
- **Meta Breakdowns**: 1115 filas (age/gender/region/placement)
- **Meta Hourly**: 356 filas (14 días)
- **Google Ads Hourly**: 325 filas (14 días)
- **GA4 KPIs**: ~242 días (sept 2025 → presente, sync funcionando)
- **product_routes**: ~3600 filas (sept 2025 → presente). Andesmar SÍ tiene
  ecommerce tracking — la ruta llega como `itemName` con formato
  "Origen → Destino" (ej: `Santiago → Mendoza`, `Salta → San Pedro De Atacama`)
- **YouTube**: 165 filas (sync pausado)

Top rutas detectadas (últimos 30d): Mendoza, Nacionales, Mendoza↔Chile,
Mendoza↔San Juan, NOA↔Patagonia, San Juan, Patagonia.

## Autenticación de APIs

- **Meta Ads**: System User token (larga duración) en `META_ACCESS_TOKEN`. Rate limits agresivos en `level=ad` con +500 ads — por eso syncMetaCreatives limita a top 60 por spend y rolling 7d.
- **Google Ads**: Service account JWT (`google-ads-mcp@protean-genius-489017-j9.iam.gserviceaccount.com`, scope `adwords`). MCC en `GOOGLE_ADS_LOGIN_CUSTOMER_ID`.
- **GA4**: `authorized_user` refresh_token OAuth (NO es service account, a pesar del nombre `GA4_SERVICE_ACCOUNT_JSON`). El OAuth consent screen del proyecto `veta-ga4-sync` está **publicado en Production** (no Testing), por eso el refresh_token no expira automáticamente. Si en algún momento hay que renovarlo: correr `scripts/renew-ga4-token.ts`.

## Variables de entorno

```
DATABASE_URL
JWT_SECRET                        # firma de tokens — MISMO valor en local y prod
META_ACCESS_TOKEN
META_AD_ACCOUNT_ID
GOOGLE_ADS_DEV_TOKEN
GOOGLE_ADS_CUSTOMER_ID
GOOGLE_ADS_LOGIN_CUSTOMER_ID
GOOGLE_ADS_SERVICE_ACCOUNT_JSON   # JWT service account (scope adwords)
GA4_PROPERTY_ID
GA4_SERVICE_ACCOUNT_JSON          # OAuth refresh_token (mal nombre, no es SA)
RESEND_API_KEY                    # opcional, para weekly report — pendiente cargar
REPORT_FROM_EMAIL                 # opcional, default usa onboarding@resend.dev
```

## Filtros de fecha y comparativas

`DateRangePicker` (`src/components/ui/DateRangePicker.tsx`):
- Presets: **Este mes hasta la fecha** (default), Mes pasado, Últimos 7/30 días
- Rango personalizado con inputs de día

**Todas las comparativas (deltas) son vs el mismo rango de fechas pero un mes
atrás** (`snapshot_date - INTERVAL '1 month'`). Decisión deliberada del
usuario, aplicada en todos los endpoints.

Excepción: la pestaña **Estacionalidad** acepta cualquier rango y compara
contra distribuciones (no vs período anterior). El heat-map día×hora
**siempre** muestra últimos 14 días (limitación de tablas hourly).

## Clientes configurados

- **Andesmar** (slug `andesmar`) — único cliente activo, empresa de pasajes de bus argentina
  - Meta ad account: `160070906181703`
  - Google Ads customer: `3945728157` (bajo MCC `5971963548`)
  - GA4 property: `488976699`

Para multi-cliente real (próximo paso): extender tabla `clients` con
columnas `meta_ad_account_id`, `google_ads_customer_id`, `ga4_property_id` y
leerlas por cliente en el sync en vez de env vars globales.

## Lista de competidores conocidos (Andesmar)

Hardcoded en `netlify/functions/competitors.ts`:
Flecha Bus, BusPlus, Cata Internacional, Vía Bariloche, Crucero del Norte,
General Urquiza, El Rápido, Plataforma 10, Omnilíneas, Plusmar.

Cuando se agreguen más clientes, mover esto a una tabla `client_competitors`.

## Scripts útiles

```bash
# Sync normal (lo que corre en GH Actions cada hora)
npx dotenv-cli -e .env -- npx tsx scripts/sync/index.ts

# Aplicar schema (idempotente, usa CREATE IF NOT EXISTS)
npx dotenv-cli -e .env -- npx tsx scripts/apply-schema.ts

# Backfill de ruta histórica después de cambios al parser
npx dotenv-cli -e .env -- npx tsx scripts/backfill-routes.ts

# Sync solo de creatives de Meta (caso de rate limit en sync regular)
npx dotenv-cli -e .env -- npx tsx scripts/sync-creatives-only.ts

# Discovery: investigar fuentes de data nuevas
npx dotenv-cli -e .env -- npx tsx scripts/discover-routes.ts

# Estado de la data
npx dotenv-cli -e .env -- npx tsx scripts/check-data.ts

# Crear usuario
npx dotenv-cli -e .env -- npx tsx scripts/create-user.ts email password slug1,slug2

# Backfill histórico de campañas (one-off)
npx dotenv-cli -e .env -- npx tsx scripts/sync/backfill.ts [start] [end]

# Resumen semanal por email (manual)
npx dotenv-cli -e .env -- npx tsx scripts/weekly-report.ts

# Dev server
npm run dev                       # Vite en :3000
npx netlify dev --port 8888 --target-port 3000  # Vite + Functions juntos
```

## Decisiones clave

- **Auth manual sobre Clerk**: dashboard con pocos usuarios (1-10), Clerk era overhead innecesario.
- **Netlify Functions sobre Vercel**: preferencia previa del usuario.
- **Data diaria vs agregada**: schema guarda una fila por día para poder filtrar cualquier rango. Agregaciones se hacen en SQL al servir.
- **Service account para Google Ads**: el refresh_token de `ga_mcp_credentials.json` solo tenía scope Analytics, no `adwords`. El SA `google-ads-mcp` ya estaba como MCC user.
- **Backfill paginado por meses**: Meta API tira 500 si se piden rangos largos.
- **Sumar pestañas, no consolidar**: cuando se agregan features nuevas (Pulso, Funnel, Estacionalidad), van como pestañas adicionales sin tocar las existentes.
- **Lenguaje simple en UI**: "Por cada $1 invertido recuperaste $X" en vez de "ROAS Xx". El dashboard es para el dueño del negocio, no para el media buyer técnico.
- **Filtro anti-outliers en Estacionalidad**: best/worst slot solo considera celdas con spend ≥ mediana × 0.5. Sin esto, un slot con $14K spend y $2.2M revenue (1 compra grande random) salía como "ROAS 154x" y no era predictivo.
- **Health score por reglas vs ML**: thresholds simples sobre ROAS / CPA / días sin conversión. Suficientemente útil sin overhead.
- **GA4 resiliente**: el sync de GA4 está en try/catch independiente, su falla NO frena el resto del sync (Meta + Google + breakdowns + hourly siguen).

## Próximos pasos (ver ROADMAP.md para detalle)

### Setup pendiente del usuario
- [ ] Configurar `RESEND_API_KEY` en GitHub Secrets para activar email semanal
- [ ] Cargar budget mensual desde Pulso para activar pacing
- [ ] Resolver GA4 token (publicar OAuth en Production O migrar a service account)

### Tier 3 backlog
- [ ] Cohort / LTV por canal de adquisición
- [ ] Análisis de landing pages (necesita GA4 OK)
- [ ] Multi-touch attribution
- [ ] Frequency capping insights
- [ ] Auction insights (Google Ads impression share)
- [ ] Anotaciones / comentarios sobre eventos
- [ ] Multi-cliente real (Datte.me, GBOL, Sur France Citroen)
- [ ] Reactivar YouTube
- [ ] Dayparting automático sugerido (basado en Estacionalidad)

### Mejoras menores
- [ ] Export a CSV/PDF
- [ ] Mobile-friendly
- [ ] Dark mode
- [ ] Comparador de períodos custom (no solo vs mes pasado)

## Sesiones previas relevantes

El dashboard original (mock data) fue clonado del template del repo. El sync
real se construyó copiando patrones de **vetadashboard**
(`Paid Media Strategist Company/dashboard/`, Next.js, 17 clientes).

Mayo 2026: refactor mayor que pasó el dashboard de "vista de KPIs" a "hub de
inteligencia con decisiones sugeridas":
- Tier 1: análisis de competencia, forecast, health score, negative keywords
  accionables, ROAS por destino, pacing presupuestario
- Tier 2: estacionalidad (día/hora/día del mes/fase del mes), anomaly
  detection, demographic mismatch, resumen semanal por email
