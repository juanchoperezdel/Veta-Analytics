# Veta Analytics — Memoria del Proyecto

Dashboard de analytics multi-cliente que combina data de Meta Ads, Google Ads
y GA4 en una sola vista, con comparativas vs mismo período del mes anterior.

## Stack

- **Frontend**: React 19 + Vite + TypeScript + Tailwind CSS + Recharts
- **Backend**: Netlify Functions (`netlify/functions/*.ts`) — serverless
- **DB**: Neon PostgreSQL (serverless, región `sa-east-1`)
- **Auth**: JWT manual (`jose`) + hash SHA-256 de passwords. Tabla `users` + `user_clients`
- **Sync de data**: GitHub Actions cron `0 * * * *` (cada hora)
- **Deploy**: Netlify conectado al repo `juanchoperezdel/Veta-Analytics`
- **Repo**: https://github.com/juanchoperezdel/Veta-Analytics (público)

## Arquitectura

```
GitHub Actions (cron 1h)
  └── scripts/sync/index.ts
        ├── Meta Marketing API v21  (por cliente, daily rows)
        ├── Google Ads API v20       (searchStream, service account)
        └── GA4 Data API v1beta      (refresh_token OAuth)
              │
              ▼
       Neon PostgreSQL
              │
              ▼
    Netlify (frontend + functions)
      ├── /.netlify/functions/login
      ├── /.netlify/functions/dashboard
      ├── /.netlify/functions/google-ads
      ├── /.netlify/functions/meta-ads
      ├── /.netlify/functions/products
      └── /.netlify/functions/youtube   (deshabilitado por ahora)
              │
              ▼
         React SPA (JWT en localStorage)
```

## Schema de Neon

Tablas principales (`scripts/db/schema.sql`):

- `clients` — un row por cliente (slug, name)
- `users` + `user_clients` — auth manual + autorización por slug
- `business_kpis` — KPIs diarios de GA4 (users, sessions, revenue, etc.)
- `google_ads_campaigns` — un row por (client, date, campaign_id)
- `meta_ads_campaigns` — un row por (client, date, campaign_id)
- `product_routes` — un row por (client, date, route) — e-commerce
- `youtube_videos` — un row por (client, date, video_id)

Todas tienen `ON CONFLICT ... DO UPDATE` para upserts idempotentes.

## Autenticación de APIs

- **Meta Ads**: System User token (larga duración) en `META_ACCESS_TOKEN`
- **Google Ads**: Service account JWT (scope `adwords`) usando `jose` para
  firmar el JWT RS256 y cambiarlo por access token. El service account está
  en `GOOGLE_ADS_SERVICE_ACCOUNT_JSON` (una sola línea con `\n` escapados).
  MCC en `GOOGLE_ADS_LOGIN_CUSTOMER_ID`.
- **GA4**: `authorized_user` refresh_token OAuth en `GA4_SERVICE_ACCOUNT_JSON`

Los archivos originales de credenciales están en
`Paid Media Strategist Company/Jsons/` (el vetadashboard, proyecto hermano).

## Variables de entorno

Local: `.env` en la raíz (gitignoreado). Production: GitHub Secrets +
Netlify env vars. Lista:

```
DATABASE_URL
META_ACCESS_TOKEN
META_AD_ACCOUNT_ID
GOOGLE_ADS_DEV_TOKEN
GOOGLE_ADS_CUSTOMER_ID
GOOGLE_ADS_LOGIN_CUSTOMER_ID
GOOGLE_ADS_SERVICE_ACCOUNT_JSON    # JWT service account (scope adwords)
GA4_PROPERTY_ID
GA4_SERVICE_ACCOUNT_JSON           # authorized_user con refresh_token
```

Variables obsoletas (ya no se usan, se pueden borrar de GH Secrets):
`GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_REFRESH_TOKEN`.

## Filtros de fecha y comparativas

`DateRangePicker` (`src/components/ui/DateRangePicker.tsx`) tiene:
- Presets: **Este mes hasta la fecha** (default), Mes pasado, Últimos 7/30 días
- Rango personalizado con inputs de día (selección libre)

**Todas las comparativas (deltas) son vs el mismo rango de fechas pero un mes
atrás** (`snapshot_date - INTERVAL '1 month'`). Ej: si miramos 1-20 abril, se
compara contra 1-20 marzo. Decisión deliberada del usuario, aplicada en los 5
Netlify functions.

## Clientes configurados

- **Andesmar** — único cliente activo.
  - Meta ad account: `160070906181703`
  - Google Ads customer: `3945728157` (bajo MCC `5971963548`)
  - GA4 property: `488976699`

Para agregar más clientes: insertar row en `clients` + credenciales
específicas en la tabla (ver "Próximos pasos").

## Estado actual de la data

Verificado el 2026-04-20 con `scripts/check-data.ts`:

- **Meta Ads**: oct 2024 → hoy — 3885 filas, 567 días ✓
- **Google Ads**: oct 2024 → hoy — 8017 filas, 558 días ✓
- **GA4 KPIs**: sept 2025 → hoy — solo 210 días (límite de retención de GA4)
- **GA4 rutas (productos)**: 0 filas — Andesmar no tiene e-commerce tracking
- **YouTube**: 168 filas — pausado, re-habilitar después

## Scripts útiles

```bash
# Sync normal (lo que corre en GH Actions cada hora)
npx dotenv-cli -e .env -- npx tsx scripts/sync/index.ts

# Backfill histórico (one-off)
npx dotenv-cli -e .env -- npx tsx scripts/sync/backfill.ts
# O con rango custom:
npx dotenv-cli -e .env -- npx tsx scripts/sync/backfill.ts 2024-01-01 2024-12-31

# Ver estado de la data
npx dotenv-cli -e .env -- npx tsx scripts/check-data.ts

# Crear usuario
npx dotenv-cli -e .env -- npx tsx scripts/create-user.ts email password slug1,slug2

# Dev server
npm run dev
```

## Decisiones clave

- **Auth manual sobre Clerk**: para un dashboard con pocos usuarios (1-10),
  agregar Clerk era overhead innecesario. JWT en localStorage + SHA-256 basta.
- **Netlify Functions sobre Vercel**: elección del usuario por preferencia
  previa con Netlify.
- **Data diaria vs agregada**: el schema guarda una fila por día para poder
  filtrar cualquier rango arbitrario. Las agregaciones se hacen en SQL al
  servir, no al sincronizar.
- **Service account para Google Ads**: el refresh_token de
  `ga_mcp_credentials.json` solo tenía scope de Analytics, no de `adwords`. El
  service account `google-ads-mcp@protean-genius-489017-j9` ya estaba agregado
  como MCC user, así que se usa ese.
- **Backfill paginado por meses**: Meta API devuelve 500 si pedís un rango
  muy largo de datos diarios. Dividirlo mes a mes evita timeouts.

## Próximos pasos

- [ ] Agregar más clientes (Datte.me, GBOL, Sur France Citroen, etc.).
      Para esto hay que extender la tabla `clients` con columnas
      `meta_ad_account_id`, `google_ads_customer_id`, `ga4_property_id` y
      leer esos valores por cliente en el sync en vez de env vars globales.
- [ ] Re-habilitar YouTube (el usuario va a definir cómo)
- [ ] Re-chequear el tema de retención GA4: ver si se puede cambiar el setting
      de 2 a 14 meses en Analytics Admin → Data Retention
- [ ] Posibles features futuros: charts temporales, export a CSV, alertas por
      email cuando CPA/ROAS cae fuera de umbrales

## Sesiones previas relevantes

El dashboard original con mock data fue clonado de
`juanchoperezdel/Veta-Analytics`. Las credenciales y configuración de
clientes vienen del proyecto hermano **vetadashboard**
(`Paid Media Strategist Company/dashboard/`), que tiene un patrón similar de
sync pero con Next.js y scope más amplio (17 clientes).
