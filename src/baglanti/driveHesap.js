// ERP'nin Google hizmet hesabı ile Paylaşılan Drive (Shared Drive) bağlantısı.
// Satıcı bir kez GOOGLE_SERVICE_ACCOUNT (JSON anahtar) tanımlar; müşteri yalnız Paylaşılan Drive açıp
// hizmet hesabının adresini "İçerik yöneticisi" olarak ekler. OAuth izin ekranı ve Google doğrulaması gerekmez.
// Not: hizmet hesaplarının depolama kotası yoktur; bu yüzden yalnız Paylaşılan Drive'a yazılır (dosyalar kuruma ait olur).
import crypto from 'node:crypto';
import { HttpHata } from '../hata.js';
import { kasaOku, kasaYaz, kasaSil } from './kasa.js';

const DRIVE = 'https://www.googleapis.com/drive/v3';
const YUKLE = 'https://www.googleapis.com/upload/drive/v3/files';
const KAPSAM = 'https://www.googleapis.com/auth/drive';
const KLASOR_TIPI = 'application/vnd.google-apps.folder';
export const KOK_KLASOR = 'NetERP';
const KASA = 'gdrive-paylasimli';
const TUM = { supportsAllDrives: 'true' };

let _hesap;
export function hesap() {
  if (_hesap !== undefined) return _hesap;
  const ham = (process.env.GOOGLE_SERVICE_ACCOUNT || '').trim();
  _hesap = null;
  if (!ham) return null;
  try {
    const j = JSON.parse(ham.startsWith('{') ? ham : Buffer.from(ham, 'base64').toString('utf8'));
    if (j.client_email && j.private_key) _hesap = { eposta: j.client_email, anahtar: j.private_key, tokenUri: j.token_uri || 'https://oauth2.googleapis.com/token' };
    else console.error('GOOGLE_SERVICE_ACCOUNT: client_email / private_key yok');
  } catch (e) { console.error('GOOGLE_SERVICE_ACCOUNT okunamadı:', e.message); }
  return _hesap;
}
export const yapilandirildi = () => !!hesap();
export const hesapEposta = () => hesap()?.eposta || '';
export function _sifirla() { _hesap = undefined; _erisim = null; } // testler için

// ---- erişim belirteci: imzalı JWT (RS256) → OAuth belirteci. Örnek başına bellekte tutulur. ----
let _erisim = null;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
async function erisim() {
  const h = hesap();
  if (!h) throw new HttpHata(409, 'Sunucuda Google hizmet hesabı tanımlı değil (GOOGLE_SERVICE_ACCOUNT).', { kod: 'SA_YOK' });
  if (_erisim && _erisim.bitis > Date.now() + 60_000) return _erisim.belirtec;
  const simdi = Math.floor(Date.now() / 1000);
  const govde = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({ iss: h.eposta, scope: KAPSAM, aud: h.tokenUri, iat: simdi, exp: simdi + 3600 });
  const imza = crypto.createSign('RSA-SHA256').update(govde).sign(h.anahtar, 'base64url');
  const r = await fetch(h.tokenUri, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: govde + '.' + imza }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    console.error('hizmet hesabı belirteç:', r.status, j.error, j.error_description);
    throw new HttpHata(502, 'Google hizmet hesabıyla oturum açılamadı (' + (j.error || r.status) + ')');
  }
  _erisim = { belirtec: j.access_token, bitis: Date.now() + (j.expires_in || 3600) * 1000 };
  return _erisim.belirtec;
}

async function istek(url, sec = {}) {
  const r = await fetch(url, { ...sec, headers: { authorization: 'Bearer ' + (await erisim()), ...(sec.headers || {}) } });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    console.error('drive', sec.method || 'GET', url.split('?')[0], r.status, j.error?.message || '');
    const e = new HttpHata(r.status === 404 ? 404 : r.status === 403 ? 403 : 502, 'Google Drive: ' + (j.error?.message || r.status));
    e.googleDurum = r.status; throw e;
  }
  return r;
}
const q = (o) => '?' + new URLSearchParams({ ...TUM, ...o });

// Hizmet hesabının üye olduğu Paylaşılan Drive'lar
export async function suruculer() {
  const r = await istek(`${DRIVE}/drives?` + new URLSearchParams({ pageSize: '50', fields: 'drives(id,name)' }));
  return ((await r.json()).drives || []).map((d) => ({ id: d.id, ad: d.name }));
}

const tirnak = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
async function klasorBulYaKur(driveId, ad, ustId, aciklama) {
  const sorgu = `name='${tirnak(ad)}' and mimeType='${KLASOR_TIPI}' and trashed=false and '${tirnak(ustId)}' in parents`;
  const r = await istek(`${DRIVE}/files` + q({ q: sorgu, corpora: 'drive', driveId, includeItemsFromAllDrives: 'true', fields: 'files(id)', pageSize: '1' }));
  const v = (await r.json()).files?.[0];
  if (v) return v.id;
  const y = await istek(`${DRIVE}/files` + q({ fields: 'id' }), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: ad, mimeType: KLASOR_TIPI, parents: [ustId], ...(aciklama ? { description: aciklama } : {}) }),
  });
  return (await y.json()).id;
}

// Seçilen sürücüyü doğrular: üyelik + yazma yetkisi; NetERP kök klasörünü oluşturur.
export async function surucuDogrula(driveId) {
  let d;
  try { d = await (await istek(`${DRIVE}/drives/${encodeURIComponent(driveId)}?` + new URLSearchParams({ fields: 'id,name,capabilities' }))).json(); }
  catch (e) { if (e.googleDurum === 404) throw new HttpHata(404, 'Bu Paylaşılan Drive görünmüyor. ERP adresini üye olarak eklediğinden emin ol.'); throw e; }
  if (!d.capabilities?.canAddChildren) throw new HttpHata(403, 'ERP adresinin bu Drive\'da yazma yetkisi yok. Rolü "İçerik yöneticisi" yap.');
  const kok = await klasorBulYaKur(d.id, KOK_KLASOR, d.id, 'NetERP dosyaları (ERP tarafından yönetilir)');
  return { driveId: d.id, driveAd: d.name, kokId: kok };
}

export async function baglan(db, driveId, baglayan) {
  const v = await surucuDogrula(driveId);
  const kayit = { ...v, zaman: new Date().toISOString(), baglayan };
  await kasaYaz(db, KASA, kayit);
  return kayit;
}
export const kes = (db) => kasaSil(db, KASA);
export async function ayar(db) { return kasaOku(db, KASA); }

export async function durum(db) {
  const a = await ayar(db);
  return { yapilandirildi: yapilandirildi(), hesap: hesapEposta(), bagli: !!(a && yapilandirildi()), driveId: a?.driveId || '', driveAd: a?.driveAd || '', zaman: a?.zaman || '' };
}

// NetERP/<proje kodu> (proje yoksa NetERP/Genel). Kök klasör silinmişse yeniden kurulur.
export async function projeKlasoru(db, kod, projeAd) {
  const a = await ayar(db);
  if (!a) throw new HttpHata(409, 'Google Drive bağlı değil. Ayarlar → Firma → Bulut depolar.', { kod: 'DRIVE_YOK' });
  const kok = await klasorBulYaKur(a.driveId, KOK_KLASOR, a.driveId, '');
  return klasorBulYaKur(a.driveId, kod || 'Genel', kok, projeAd || '');
}

export async function yuklemeBaslat({ ad, tip, boyut, klasorId }) {
  const r = await istek(`${YUKLE}` + q({ uploadType: 'resumable', fields: 'id,name,size,mimeType,webViewLink' }), {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-type': tip || 'application/octet-stream', 'x-upload-content-length': String(boyut) },
    body: JSON.stringify({ name: ad, parents: [klasorId] }),
  });
  const uri = r.headers.get('location');
  if (!uri) throw new HttpHata(502, 'Google yükleme oturumu açılamadı');
  return uri;
}

export const klasorAdresi = (id) => 'https://drive.google.com/drive/folders/' + encodeURIComponent(id);
