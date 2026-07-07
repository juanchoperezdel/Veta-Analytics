// Seed / actualiza la tabla `clients` con los IDs de cuenta por cliente.
// Idempotente (ON CONFLICT DO UPDATE). Las credenciales (token Meta,
// service-account Google) siguen globales en env; acá solo van los account IDs.
//
// Uso: npx dotenv-cli -e .env -- npx tsx scripts/seed-clients.ts
import { neon } from '@neondatabase/serverless';
import 'dotenv/config';

const sql = neon(process.env.DATABASE_URL!);

const CLIENTS = [
  {
    id: '1',
    slug: 'andesmar',
    name: 'Andesmar Turismo',
    logo_initial: 'A',
    meta_ad_account_id: '160070906181703',
    google_ads_customer_id: '3945728157',
    ga4_property_id: '488976699',
    active: false, // dado de baja: el sync lo saltea, pero conserva su historial
  },
  {
    id: '2',
    slug: 'smartway',
    name: 'Smartway',
    logo_initial: 'S',
    meta_ad_account_id: '2063808167634',
    google_ads_customer_id: '7483493147',
    ga4_property_id: null, // Smartway no tiene GA4 conectado → el sync saltea GA4
    active: true,
  },
  {
    id: '3',
    slug: 'griba',
    name: 'Griba',
    logo_initial: 'G',
    meta_ad_account_id: '1389164124601064',
    google_ads_customer_id: '1558138541',
    ga4_property_id: null, // Griba no tiene GA4 conectado → el sync saltea GA4
    ghl_location_id: 'L3lXU86W3GXKyWO98mp0', // CRM GoHighLevel (whitelabel vetastation)
    active: true,
  },
];

for (const c of CLIENTS) {
  await sql`
    INSERT INTO clients (id, slug, name, logo_initial, meta_ad_account_id, google_ads_customer_id, ga4_property_id, ghl_location_id, active)
    VALUES (${c.id}, ${c.slug}, ${c.name}, ${c.logo_initial}, ${c.meta_ad_account_id}, ${c.google_ads_customer_id}, ${c.ga4_property_id}, ${(c as any).ghl_location_id ?? null}, ${c.active})
    ON CONFLICT (id) DO UPDATE SET
      slug                   = EXCLUDED.slug,
      name                   = EXCLUDED.name,
      logo_initial           = EXCLUDED.logo_initial,
      meta_ad_account_id     = EXCLUDED.meta_ad_account_id,
      google_ads_customer_id = EXCLUDED.google_ads_customer_id,
      ga4_property_id        = EXCLUDED.ga4_property_id,
      ghl_location_id        = EXCLUDED.ghl_location_id,
      active                 = EXCLUDED.active
  `;
  console.log(`✓ ${c.name} (${c.slug}) — active=${c.active} meta=${c.meta_ad_account_id} google=${c.google_ads_customer_id} ga4=${c.ga4_property_id ?? '—'} ghl=${(c as any).ghl_location_id ?? '—'}`);
}

console.log('\n✓ Clientes sembrados.');