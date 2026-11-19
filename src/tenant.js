// Firma çözümleme: her istek hangi firmaya aitse o firmanın veritabanına bağlanır.
// MOD=tek  : bütün istekler FIRMA_SUB firmasına gider (test ortamı).
// MOD=coklu: alt alan adı (yontem.iq-sense.com.tr → "yontem") katalogda aranır.
import { config } from './config.js';
import { baglanti } from './db.js';
import { HttpHata } from './hata.js';

const katalogOnbellek = new Map(); // sub → { kayit, zaman }
const ONBELLEK_MS = 60_000;

export function altAlanBul(host) {
  const h = String(host || '').toLowerCase().split(':')[0];
  if (!h.endsWith('.' + config.anaAlan)) return null;
  const sub = h.slice(0, -(config.anaAlan.length + 1));
  return /^[a-z0-9-]{2,40}$/.test(sub) ? sub : null;
}

async function katalogKaydi(sub) {
  const o = katalogOnbellek.get(sub);
  if (o && Date.now() - o.zaman < ONBELLEK_MS) return o.kayit;
  const kdb = baglanti('__katalog', config.katalog.client, config.katalog.url);
  const kayit = await kdb('firmalar').where({ sub, aktif: true }).first();
  katalogOnbellek.set(sub, { kayit: kayit || null, zaman: Date.now() });
  return kayit || null;
}

export async function firmaCoz(req, _res, next) {
  try {
    if (config.mod === 'tek') {
      req.firma = { sub: config.firmaSub, ad: config.firmaAd };
      req.db = baglanti('tek', config.db.client, config.db.url);
      return next();
    }
    const sub = altAlanBul(req.headers['x-forwarded-host'] || req.headers.host);
    if (!sub) throw new HttpHata(404, 'Firma bulunamadı');
    const k = await katalogKaydi(sub);
    if (!k) throw new HttpHata(404, 'Firma bulunamadı');
    const url = process.env[k.db_env];
    if (!url) throw new HttpHata(500, 'Firma veritabanı yapılandırılmamış');
    req.firma = { sub, ad: k.ad };
    req.db = baglanti('f:' + sub, k.db_client || 'mssql', url);
    next();
  } catch (e) { next(e); }
}
