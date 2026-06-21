-- Veta Analytics — Neon PostgreSQL Schema

-- Usuarios y permisos por cliente
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_clients (
  user_id   INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, client_id)
);

CREATE TABLE IF NOT EXISTS clients (
  id          TEXT PRIMARY KEY,
  slug        TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  logo_initial TEXT NOT NULL
);

INSERT INTO clients (id, slug, name, logo_initial) VALUES
  ('1', 'andesmar', 'Andesmar Turismo', 'A')
ON CONFLICT (id) DO NOTHING;

-- Cuentas de ads por cliente (multi-cliente). Las credenciales (token Meta,
-- service-account Google) siguen siendo globales (env vars); acá guardamos solo
-- el ID de cada cuenta para que el sync sepa qué consultar por cliente. Si una
-- columna es NULL el sync hace fallback a la env var global (no rompe Andesmar).
ALTER TABLE clients ADD COLUMN IF NOT EXISTS meta_ad_account_id     TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS google_ads_customer_id TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS ga4_property_id        TEXT;
-- active=false → el sync lo saltea (cliente dado de baja), pero su historial en
-- Neon se conserva. El frontend igual puede seguir leyéndolo si hace falta.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;

-- Snapshot de KPIs de negocio (GA4)
CREATE TABLE IF NOT EXISTS business_kpis (
  id                    SERIAL PRIMARY KEY,
  client_id             TEXT NOT NULL REFERENCES clients(id),
  snapshot_date         DATE NOT NULL,
  users                 BIGINT,
  users_delta           NUMERIC(8,4),
  sessions              BIGINT,
  sessions_delta        NUMERIC(8,4),
  avg_session_duration  TEXT,
  avg_session_duration_delta NUMERIC(8,4),
  conversion_rate       NUMERIC(8,6),
  conversion_rate_delta NUMERIC(8,4),
  carts                 BIGINT,
  carts_delta           NUMERIC(8,4),
  tickets               BIGINT,
  tickets_delta         NUMERIC(8,4),
  revenue               NUMERIC(18,2),
  revenue_delta         NUMERIC(8,4),
  aov                   NUMERIC(18,2),
  aov_delta             NUMERIC(8,4),
  synced_at             TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (client_id, snapshot_date)
);

-- Campañas de Google Ads
CREATE TABLE IF NOT EXISTS google_ads_campaigns (
  id            SERIAL PRIMARY KEY,
  client_id     TEXT NOT NULL REFERENCES clients(id),
  snapshot_date DATE NOT NULL,
  campaign_id   TEXT NOT NULL,
  name          TEXT,
  spend         NUMERIC(18,2),
  impressions   BIGINT,
  clicks        BIGINT,
  ctr           NUMERIC(8,6),
  cpc           NUMERIC(18,2),
  users         BIGINT,
  retention     NUMERIC(8,4),
  carts         BIGINT,
  revenue       NUMERIC(18,2),
  roas          NUMERIC(10,2),
  synced_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (client_id, snapshot_date, campaign_id)
);

-- KPIs agregados de Google Ads por día
CREATE TABLE IF NOT EXISTS google_ads_kpis (
  id            SERIAL PRIMARY KEY,
  client_id     TEXT NOT NULL REFERENCES clients(id),
  snapshot_date DATE NOT NULL,
  spend         NUMERIC(18,2), spend_delta NUMERIC(8,4),
  carts         BIGINT,        carts_delta NUMERIC(8,4),
  tickets       BIGINT,        tickets_delta NUMERIC(8,4),
  revenue       NUMERIC(18,2), revenue_delta NUMERIC(8,4),
  cpa           NUMERIC(18,2), cpa_delta NUMERIC(8,4),
  roas          NUMERIC(10,2), roas_delta NUMERIC(8,4),
  aov           NUMERIC(18,2), aov_delta NUMERIC(8,4),
  synced_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (client_id, snapshot_date)
);

-- Campañas de Meta Ads
-- type = objective de la campaña en Meta (OUTCOME_SALES, OUTCOME_TRAFFIC, OUTCOME_AWARENESS, etc.)
-- Solo las OUTCOME_SALES (o legacy CONVERSIONS) deben contarse como "ventas" en los KPIs.
CREATE TABLE IF NOT EXISTS meta_ads_campaigns (
  id               SERIAL PRIMARY KEY,
  client_id        TEXT NOT NULL REFERENCES clients(id),
  snapshot_date    DATE NOT NULL,
  campaign_id      TEXT NOT NULL,
  type             TEXT,  -- objective de Meta
  effective_status TEXT,
  segment          TEXT,
  spend            NUMERIC(18,2),
  reach            BIGINT,
  purchases        BIGINT,
  revenue          NUMERIC(18,2),
  cpa              NUMERIC(18,2),
  roas             NUMERIC(10,2),
  ctr              NUMERIC(8,6),
  cpc              NUMERIC(18,2),
  synced_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (client_id, snapshot_date, campaign_id)
);

ALTER TABLE meta_ads_campaigns ADD COLUMN IF NOT EXISTS effective_status TEXT;

-- KPIs agregados de Meta Ads por día
CREATE TABLE IF NOT EXISTS meta_ads_kpis (
  id            SERIAL PRIMARY KEY,
  client_id     TEXT NOT NULL REFERENCES clients(id),
  snapshot_date DATE NOT NULL,
  spend         NUMERIC(18,2), spend_delta NUMERIC(8,4),
  purchases     BIGINT,        purchases_delta NUMERIC(8,4),
  revenue       NUMERIC(18,2), revenue_delta NUMERIC(8,4),
  cpa           NUMERIC(18,2), cpa_delta NUMERIC(8,4),
  roas          NUMERIC(10,2), roas_delta NUMERIC(8,4),
  aov           NUMERIC(18,2), aov_delta NUMERIC(8,4),
  synced_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (client_id, snapshot_date)
);

-- Rutas / productos (e-commerce GA4)
CREATE TABLE IF NOT EXISTS product_routes (
  id              SERIAL PRIMARY KEY,
  client_id       TEXT NOT NULL REFERENCES clients(id),
  snapshot_date   DATE NOT NULL,
  route           TEXT NOT NULL,
  revenue         NUMERIC(18,2),
  revenue_delta   NUMERIC(8,2),
  articles        BIGINT,
  articles_delta  NUMERIC(8,2),
  purchases       BIGINT,
  purchases_delta NUMERIC(8,2),
  add_to_cart     BIGINT,
  synced_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (client_id, snapshot_date, route)
);

-- ─── Extensiones para inteligencia de rutas ────────────────────────────────
-- Andesmar no tiene e-commerce tracking en GA4, así que la ruta se infiere del
-- nombre de la campaña (Meta/Google Ads) con un parser regex en el sync.

ALTER TABLE meta_ads_campaigns   ADD COLUMN IF NOT EXISTS route TEXT;
ALTER TABLE google_ads_campaigns ADD COLUMN IF NOT EXISTS route TEXT;

CREATE INDEX IF NOT EXISTS idx_meta_ads_campaigns_route   ON meta_ads_campaigns   (client_id, route, snapshot_date);
CREATE INDEX IF NOT EXISTS idx_google_ads_campaigns_route ON google_ads_campaigns (client_id, route, snapshot_date);

-- Search Terms reales de Google Ads (queries que activaron ads)
-- Una fila por (cliente, fecha, término) — el agregado se hace al servir.
CREATE TABLE IF NOT EXISTS google_ads_search_terms (
  id             SERIAL PRIMARY KEY,
  client_id      TEXT NOT NULL REFERENCES clients(id),
  snapshot_date  DATE NOT NULL,
  search_term    TEXT NOT NULL,
  clicks         BIGINT,
  impressions    BIGINT,
  cost           NUMERIC(18,2),
  conversions    NUMERIC(10,4),
  conv_value     NUMERIC(18,2),
  route          TEXT,             -- inferido del search term (ej: "andesmar mendoza" → "Mendoza")
  synced_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (client_id, snapshot_date, search_term)
);
CREATE INDEX IF NOT EXISTS idx_search_terms_route ON google_ads_search_terms (client_id, route, snapshot_date);

-- Creatives de Meta Ads (ad-level performance con thumbnails)
CREATE TABLE IF NOT EXISTS meta_ads_creatives (
  id              SERIAL PRIMARY KEY,
  client_id       TEXT NOT NULL REFERENCES clients(id),
  snapshot_date   DATE NOT NULL,
  ad_id           TEXT NOT NULL,
  ad_name         TEXT,
  campaign_id     TEXT,
  campaign_name   TEXT,
  thumbnail_url   TEXT,
  effective_status TEXT,
  spend           NUMERIC(18,2),
  impressions     BIGINT,
  clicks          BIGINT,
  reach           BIGINT,
  purchases       BIGINT,
  revenue         NUMERIC(18,2),
  cpa             NUMERIC(18,2),
  roas            NUMERIC(10,2),
  ctr             NUMERIC(10,4),    -- CTR de Meta viene como porcentaje (ej: 2.345 = 2.345%)
  synced_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (client_id, snapshot_date, ad_id)
);
ALTER TABLE meta_ads_creatives ALTER COLUMN ctr TYPE NUMERIC(10,4);
-- landing_page_view = paso del funnel (visita a la landing) por ad
ALTER TABLE meta_ads_creatives ADD COLUMN IF NOT EXISTS landing_page_view BIGINT;

-- Breakdowns demográficos / placements de Meta Ads
-- dimension_type ∈ {age, gender, region, publisher_platform}
CREATE TABLE IF NOT EXISTS meta_ads_breakdowns (
  id              SERIAL PRIMARY KEY,
  client_id       TEXT NOT NULL REFERENCES clients(id),
  snapshot_date   DATE NOT NULL,
  dimension_type  TEXT NOT NULL,
  dimension_value TEXT NOT NULL,
  spend           NUMERIC(18,2),
  impressions     BIGINT,
  clicks          BIGINT,
  reach           BIGINT,
  purchases       BIGINT,
  revenue         NUMERIC(18,2),
  cpa             NUMERIC(18,2),
  roas            NUMERIC(10,2),
  synced_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (client_id, snapshot_date, dimension_type, dimension_value)
);
CREATE INDEX IF NOT EXISTS idx_meta_breakdowns ON meta_ads_breakdowns (client_id, dimension_type, snapshot_date);

-- ─── Estacionalidad: hourly + day-of-week ──────────────────────────────────
-- Para identificar mejor día/hora para pautar. Una fila por (cliente, día, hora)
-- agregando todas las campañas. Solo últimos 30 días rolling.

CREATE TABLE IF NOT EXISTS meta_ads_hourly (
  id            SERIAL PRIMARY KEY,
  client_id     TEXT NOT NULL REFERENCES clients(id),
  snapshot_date DATE NOT NULL,
  hour          INT  NOT NULL,            -- 0-23
  spend         NUMERIC(18,2),
  impressions   BIGINT,
  clicks        BIGINT,
  purchases     BIGINT,
  revenue       NUMERIC(18,2),
  synced_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (client_id, snapshot_date, hour)
);

CREATE TABLE IF NOT EXISTS google_ads_hourly (
  id            SERIAL PRIMARY KEY,
  client_id     TEXT NOT NULL REFERENCES clients(id),
  snapshot_date DATE NOT NULL,
  hour          INT  NOT NULL,            -- 0-23
  spend         NUMERIC(18,2),
  impressions   BIGINT,
  clicks        BIGINT,
  conversions   NUMERIC(10,4),
  conv_value    NUMERIC(18,2),
  synced_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (client_id, snapshot_date, hour)
);

-- ─── Canales de tráfico (GA4 sessionDefaultChannelGroup) ──────────────────
-- Una fila por (cliente, día, canal). Útil para ver mix de origen de las
-- ventas: Paid Search, Paid Social, Direct, Organic Search, Referral, etc.
CREATE TABLE IF NOT EXISTS traffic_channels (
  id            SERIAL PRIMARY KEY,
  client_id     TEXT NOT NULL REFERENCES clients(id),
  snapshot_date DATE NOT NULL,
  channel_group TEXT NOT NULL,          -- ej: 'Paid Search', 'Direct', 'Organic Search'
  sessions      BIGINT,
  transactions  BIGINT,
  revenue       NUMERIC(18,2),
  synced_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (client_id, snapshot_date, channel_group)
);
CREATE INDEX IF NOT EXISTS idx_traffic_channels ON traffic_channels (client_id, snapshot_date);

-- ─── Snapshots Hot Sale 2026 — congelados ──────────────────────────────────
-- Las tablas meta_ads_hourly (14d), meta_ads_creatives (7d) y
-- meta_ads_breakdowns (30d) son rolling. Para preservar el informe Hot Sale
-- más allá de esas ventanas, copiamos los datos del rango 11-17 may 2026
-- a tablas snapshot dedicadas.

-- Hora×día (Meta + Google combinados)
CREATE TABLE IF NOT EXISTS hot_sale_2026_hourly (
  id            SERIAL PRIMARY KEY,
  snapshot_date DATE NOT NULL,
  hour          INT  NOT NULL,            -- 0-23
  spend         NUMERIC(18,2),
  revenue       NUMERIC(18,2),
  purchases     BIGINT,
  frozen_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (snapshot_date, hour)
);

-- Creatives de Meta (ad-level con thumbnails) congelados del Hot Week
CREATE TABLE IF NOT EXISTS hot_sale_2026_creatives (
  id               SERIAL PRIMARY KEY,
  snapshot_date    DATE NOT NULL,
  ad_id            TEXT NOT NULL,
  ad_name          TEXT,
  campaign_id      TEXT,
  campaign_name    TEXT,
  thumbnail_url    TEXT,
  effective_status TEXT,
  spend            NUMERIC(18,2),
  impressions      BIGINT,
  clicks           BIGINT,
  reach            BIGINT,
  purchases        BIGINT,
  revenue          NUMERIC(18,2),
  cpa              NUMERIC(18,2),
  roas             NUMERIC(10,2),
  ctr              NUMERIC(10,4),
  frozen_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (snapshot_date, ad_id)
);

-- Breakdowns demográficos de Meta (age/gender/region/placement) del Hot Week
CREATE TABLE IF NOT EXISTS hot_sale_2026_breakdowns (
  id              SERIAL PRIMARY KEY,
  snapshot_date   DATE NOT NULL,
  dimension_type  TEXT NOT NULL,
  dimension_value TEXT NOT NULL,
  spend           NUMERIC(18,2),
  impressions     BIGINT,
  clicks          BIGINT,
  reach           BIGINT,
  purchases       BIGINT,
  revenue         NUMERIC(18,2),
  cpa             NUMERIC(18,2),
  roas            NUMERIC(10,2),
  frozen_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (snapshot_date, dimension_type, dimension_value)
);

-- ─── Pacing presupuestario ─────────────────────────────────────────────────
-- Budget mensual por cliente. Una fila por mes (primer día del mes).
CREATE TABLE IF NOT EXISTS client_budgets (
  id            SERIAL PRIMARY KEY,
  client_id     TEXT NOT NULL REFERENCES clients(id),
  month         DATE NOT NULL,           -- primer día del mes (ej: 2026-04-01)
  planned_spend NUMERIC(18,2) NOT NULL,  -- ARS planeados para ese mes
  notes         TEXT,
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (client_id, month)
);

-- Videos de YouTube Ads
CREATE TABLE IF NOT EXISTS youtube_videos (
  id               SERIAL PRIMARY KEY,
  client_id        TEXT NOT NULL REFERENCES clients(id),
  snapshot_date    DATE NOT NULL,
  video_id         TEXT NOT NULL,
  title            TEXT,
  campaign         TEXT,
  impressions      BIGINT,
  clicks           BIGINT,
  ctr              NUMERIC(8,6),
  conversions      NUMERIC(10,4),
  conversion_rate  NUMERIC(8,6),
  spend            NUMERIC(18,2),
  synced_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (client_id, snapshot_date, video_id)
);
