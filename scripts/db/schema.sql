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
