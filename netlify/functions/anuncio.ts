import type { Context } from '@netlify/functions';

// Link público a un anuncio de Meta: /anuncio/<ad_id>
//
// Para el mail automático que GHL le manda al cliente cuando entra un lead:
//   https://veta-analytics.netlify.app/anuncio/{{contact.lastAttributionSource.adId}}
// Quien lo abre ve el anuncio aunque NO tenga acceso a la cuenta publicitaria: la página
// muestra la imagen del anuncio (pedida en el momento a Meta con nuestro token) y botones
// a la vista previa compartible de Meta y al post de Instagram si existe.
//
// Solo sirve anuncios de las cuentas que gestionamos (ALLOWED_ACCOUNTS): el token no se
// usa para mostrar anuncios de terceros.

const GRAPH = 'v21.0';
const ALLOWED_ACCOUNTS = new Set(['2063808167634', '1389164124601064', '1046328434650389']); // Smartway, Griba, ControlPet

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

function page(title: string, body: string, status = 200) {
  return new Response(`<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)}</title>
<style>
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f6f7f9;color:#18181b;display:flex;justify-content:center;padding:28px 16px}
.c{width:100%;max-width:520px;background:#fff;border:1px solid #e4e4e7;border-radius:18px;overflow:hidden}
.h{padding:18px 20px 6px}.k{font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#a1a1aa}
h1{font-size:19px;margin:6px 0 2px;line-height:1.25;word-break:break-word}.s{font-size:13px;color:#71717a;margin:0 0 14px}
img{display:block;width:100%;height:auto;background:#f4f4f5}
.b{display:flex;flex-direction:column;gap:10px;padding:18px 20px 20px}
a.btn{display:block;text-align:center;text-decoration:none;font-weight:700;font-size:15px;padding:13px 16px;border-radius:12px;background:#18181b;color:#fff}
a.sec{background:#fff;color:#18181b;box-shadow:inset 0 0 0 1px #d4d4d8}
p.n{font-size:12px;color:#a1a1aa;margin:4px 0 0;text-align:center}
</style></head><body><div class="c">${body}</div></body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

export default async (req: Request, _context: Context) => {
  const url = new URL(req.url);
  const adId = (url.searchParams.get('id') || url.pathname.split('/').filter(Boolean).pop() || '').replace(/\D/g, '');
  if (!adId) return page('Anuncio no encontrado', `<div class="h"><h1>Este lead no tiene el anuncio identificado</h1><p class="s">El CRM no recibió el dato del anuncio para este contacto.</p></div>`, 404);

  const token = process.env.META_ACCESS_TOKEN;
  if (!token) return page('Error', `<div class="h"><h1>No se pudo cargar el anuncio</h1></div>`, 500);

  const fields = 'name,account_id,preview_shareable_link,campaign{name},adset{name},creative.thumbnail_width(1080).thumbnail_height(1080){thumbnail_url,image_url,instagram_permalink_url}';
  const r = await fetch(`https://graph.facebook.com/${GRAPH}/${adId}?fields=${encodeURIComponent(fields)}&access_token=${token}`);
  const ad: any = await r.json().catch(() => ({}));

  if (!r.ok || ad.error || !ALLOWED_ACCOUNTS.has(String(ad.account_id))) {
    return page('Anuncio no disponible', `<div class="h"><span class="k">Anuncio</span><h1>No pudimos mostrar este anuncio</h1><p class="s">Puede que haya sido eliminado de la cuenta.</p></div>`, 404);
  }

  const img = ad.creative?.image_url || ad.creative?.thumbnail_url || null;
  const ig = ad.creative?.instagram_permalink_url || null;
  // La vista previa compartible de Meta (preview_shareable_link) pide iniciar sesión en
  // Business: no sirve para alguien sin acceso, por eso no se ofrece.
  const sub = [ad.campaign?.name, ad.adset?.name].filter(Boolean).join(' · ');

  return page(ad.name || 'Anuncio', `
    <div class="h"><span class="k">El lead llegó por este anuncio</span><h1>${esc(ad.name || 'Anuncio')}</h1>${sub ? `<p class="s">${esc(sub)}</p>` : '<p class="s"></p>'}</div>
    ${img ? `<img src="${esc(img)}" alt="Imagen del anuncio">` : ''}
    <div class="b">
      ${ig ? `<a class="btn" href="${esc(ig)}" target="_blank" rel="noopener">Verlo en Instagram</a>` : ''}
    </div>`);
};
