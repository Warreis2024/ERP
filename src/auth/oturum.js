// Oturum: imzalı (HMAC-SHA256) belirteç, httpOnly çerezde taşınır. Harici bağımlılık yok.
// Belirteçte yalnız kullanıcı id, firma, oturum sürümü ve bitiş zamanı bulunur.
// Kullanıcının oturum_surumu artırılınca (çıkış, şifre değişimi, pasife alma) eski belirteçler geçersiz olur.
import crypto from 'node:crypto';
import { config } from '../config.js';

const b64 = (b) => Buffer.from(b).toString('base64url');
const imza = (veri) => crypto.createHmac('sha256', config.oturum.gizli).update(veri).digest('base64url');

export function belirtecUret(yuk, sureSn) {
  const govde = b64(JSON.stringify({ ...yuk, exp: Math.floor(Date.now() / 1000) + sureSn }));
  return govde + '.' + imza(govde);
}

export function belirtecCoz(belirtec) {
  if (typeof belirtec !== 'string' || belirtec.length > 2000) return null;
  const [govde, im] = belirtec.split('.');
  if (!govde || !im) return null;
  const beklenen = imza(govde);
  const a = Buffer.from(im), b = Buffer.from(beklenen);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const yuk = JSON.parse(Buffer.from(govde, 'base64url').toString('utf8'));
    if (!yuk.exp || yuk.exp < Date.now() / 1000) return null;
    return yuk;
  } catch { return null; }
}

// ---- çerezler ----
export const CEREZ = { oturum: 'erp_oturum', csrf: 'erp_csrf' };

export function cerezleriOku(req) {
  const o = {};
  for (const p of String(req.headers.cookie || '').split(';')) {
    const i = p.indexOf('=');
    if (i > 0) o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  }
  return o;
}

function cerez(ad, deger, { maxAge, httpOnly = true } = {}) {
  const parca = [`${ad}=${encodeURIComponent(deger)}`, 'Path=/', 'SameSite=Lax'];
  if (httpOnly) parca.push('HttpOnly');
  if (config.oturum.guvenliCerez) parca.push('Secure');
  if (maxAge !== undefined) parca.push(`Max-Age=${maxAge}`);
  return parca.join('; ');
}

export function oturumCerezleriYaz(res, belirtec, csrf, hatirla) {
  const sure = hatirla ? config.oturum.hatirlaGun * 86400 : undefined; // hatırla yoksa tarayıcı kapanınca biter
  res.append('Set-Cookie', cerez(CEREZ.oturum, belirtec, { maxAge: sure }));
  res.append('Set-Cookie', cerez(CEREZ.csrf, csrf, { maxAge: sure, httpOnly: false })); // istemci okuyup başlığa koyar
}
export function oturumCerezleriSil(res) {
  res.append('Set-Cookie', cerez(CEREZ.oturum, '', { maxAge: 0 }));
  res.append('Set-Cookie', cerez(CEREZ.csrf, '', { maxAge: 0, httpOnly: false }));
}
export const csrfUret = () => crypto.randomBytes(24).toString('base64url');
export const oturumSuresiSn = (hatirla) => (hatirla ? config.oturum.hatirlaGun * 86400 : config.oturum.saat * 3600);
