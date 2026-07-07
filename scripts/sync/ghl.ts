// Sync de calidad de leads desde GoHighLevel (CRM) → tabla crm_leads en Neon.
//
// Lee los contactos de una location de GHL (paginado), deriva el ESTADO de calidad
// a partir de las etiquetas del CRM, y extrae la ATRIBUCIÓN al anuncio de Meta
// (utmAdId + utmContent) para poder cruzar "qué anuncio trajo leads buenos".
//
// El token es un Private Integration token (pit-...) con scope contacts.readonly,
// pasado por env var GHL_TOKEN_<SLUG> (ej: GHL_TOKEN_GRIBA). La location vive en
// clients.ghl_location_id.
//
// GOTCHA Cloudflare: el endpoint de GHL bloquea User-Agents "de bot" (error 1010).
// Hay que mandar un User-Agent de browser, si no rebota con 403.

import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

const GHL_BASE = 'https://services.leadconnectorhq.com';

type Quality = 'meeting' | 'qualified' | 'unqualified' | 'no_response' | 'unclassified';

// Deriva el estado de calidad a partir de las etiquetas del contacto.
// Precedencia: reunión > (no) calificado > sin respuesta > sin clasificar.
// OJO: "no calificado" contiene "calificado" → chequear el negativo PRIMERO.
function deriveQuality(tags: string[]): Quality {
  const t = tags.map(x => (x || '').toLowerCase().trim());
  const any = (re: RegExp) => t.some(x => re.test(x));
  if (any(/reuni[oó]n\s*agendada|reunion\s*agendada/)) return 'meeting';
  if (any(/no\s*calificad/)) return 'unqualified';
  if (any(/calificad/)) return 'qualified';
  if (any(/no\s*respond|sin\s*respuesta|no\s*contest/)) return 'no_response';
  return 'unclassified';
}

// Elige la atribución más útil: la de primer toque (isFirst) que tenga un ad de Meta;
// si no hay, cualquiera con utmAdId; si no, la primera (para al menos la campaña).
function pickAttribution(attributions: any[] | undefined) {
  const arr = Array.isArray(attributions) ? attributions : [];
  const withAd = arr.filter(a => a && a.utmAdId);
  const first = withAd.find(a => a.isFirst) || withAd[0] || arr[0] || {};
  return {
    adId: first.utmAdId ?? null,
    adName: first.utmContent ?? null,
    campaign: first.utmCampaign ?? null,
    source: first.medium ?? first.adSource ?? first.utmSource ?? null,
  };
}

async function ghlGet(path: string, token: string): Promise<any> {
  const res = await fetch(`${GHL_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Version: '2021-07-28',
      Accept: 'application/json',
      // Necesario para no comer el bloqueo 1010 de Cloudflare.
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GHL ${res.status} ${path.split('?')[0]} → ${body.slice(0, 160)}`);
  }
  return res.json();
}

export async function syncGhlLeads(clientId: string, locationId: string, token: string) {
  let url: string | null = `/contacts/?locationId=${locationId}&limit=100`;
  let total = 0;
  const counts: Record<Quality, number> = { meeting: 0, qualified: 0, unqualified: 0, no_response: 0, unclassified: 0 };
  let withAd = 0;
  let pages = 0;

  while (url && pages < 100) {
    const d: any = await ghlGet(url, token);
    const contacts: any[] = d.contacts ?? [];
    if (contacts.length === 0) break;

    for (const c of contacts) {
      const tags: string[] = Array.isArray(c.tags) ? c.tags : [];
      const quality = deriveQuality(tags);
      const attr = pickAttribution(c.attributions);
      if (attr.adId) withAd++;
      counts[quality]++;
      total++;

      await sql`
        INSERT INTO crm_leads
          (client_id, contact_id, ad_id, ad_name, campaign, form_name, source, quality, tags, date_added, synced_at)
        VALUES
          (${clientId}, ${c.id}, ${attr.adId}, ${attr.adName}, ${attr.campaign}, ${null},
           ${c.source ?? attr.source ?? null}, ${quality}, ${tags}, ${c.dateAdded ?? null}, NOW())
        ON CONFLICT (client_id, contact_id) DO UPDATE SET
          ad_id      = EXCLUDED.ad_id,
          ad_name    = EXCLUDED.ad_name,
          campaign   = EXCLUDED.campaign,
          source     = EXCLUDED.source,
          quality    = EXCLUDED.quality,
          tags       = EXCLUDED.tags,
          date_added = EXCLUDED.date_added,
          synced_at  = NOW()
      `;
    }

    // Paginación: GHL devuelve meta.startAfter + meta.startAfterId para la próxima página.
    const meta = d.meta ?? {};
    if (meta.nextPageUrl && meta.startAfterId && meta.startAfter != null && contacts.length === 100) {
      url = `/contacts/?locationId=${locationId}&limit=100&startAfter=${meta.startAfter}&startAfterId=${meta.startAfterId}`;
      pages++;
    } else {
      url = null;
    }
  }

  console.log(
    `✓ GHL CRM synced: ${total} leads ` +
    `(calif ${counts.qualified}, no-calif ${counts.unqualified}, reunión ${counts.meeting}, ` +
    `s/resp ${counts.no_response}, s/clasif ${counts.unclassified} · con anuncio: ${withAd})`
  );
}
