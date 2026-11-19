// Google bağlantısı (firma hesabı): OAuth 2.0, Drive (drive.file) ve Gmail gönderimi (gmail.send).
// Belirteçler kasada şifreli tutulur. drive.file yalnız uygulamanın açtığı dosya/klasörleri görür.
import { HttpHata } from '../hata.js';
import { kasaOku, kasaYaz, kasaSil } from './kasa.js';

const ADRES = {
  izin: 'https://accounts.google.com/o/oauth2/v2/auth',
  belirtec: 'https://oauth2.googleapis.com/token',
  iptal: 'https://oauth2.googleapis.com/revoke',
  kimlik: 'https://openidconnect.googleapis.com/v1/userinfo',
  drive: 'https://www.googleapis.com/drive/v3',
  yukle: 'https://www.googleapis.com/upload/drive/v3/files',
  gmail: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
};
export const KAPSAM = {
  drive: 'https://www.googleapis.com/auth/drive.file',
  gmail: 'https://www.googleapis.com/auth/gmail.send',
};
const KAPSAMLAR = ['openid', 'email', KAPSAM.drive, KAPSAM.gmail];
const KASA = 'google';
export const KOK_KLASOR = 'NetERP';
const KLASOR_TIPI = 'application/vnd.google-apps.folder';

const istemci = () => ({ id: (process.env.GOOGLE_CLIENT_ID || '').trim(), gizli: (process.env.GOOGLE_CLIENT_SECRET || '').trim() });
export const yapilandirildi = () => { const c = istemci(); return !!(c.id && c.gizli); };

export function donusAdresi(req) {
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI.trim();
  const host = (req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
  return `${req.protocol}://${host}/api/baglanti/google/donus`;
}

export function izinAdresi(req, durum) {
  const p = new URLSearchParams({
    client_id: istemci().id, redirect_uri: donusAdresi(req), response_type: 'code',
    scope: KAPSAMLAR.join(' '), access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state: durum,
  });
  return ADRES.izin + '?' + p;
}

async function belirtecIstegi(govde) {
  const c = istemci();
  const r = await fetch(ADRES.belirtec, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: c.id, client_secret: c.gizli, ...govde }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error('google belirteç: ' + (j.error || r.status) + ' ' + (j.error_description || '')); e.kod = j.error; throw e; }
  return j;
}

// İzin dönüşü: kodu belirtece çevirir, hesabı okur, kasaya yazar.
export async function kodTakas(req, db, kod, baglayan) {
  const j = await belirtecIstegi({ code: kod, grant_type: 'authorization_code', redirect_uri: donusAdresi(req) });
  if (!j.refresh_token) throw new HttpHata(400, 'Google yenileme belirteci vermedi; bağlantıyı kesip yeniden dene');
  const k = await (await fetch(ADRES.kimlik, { headers: { authorization: 'Bearer ' + j.access_token } })).json().catch(() => ({}));
  const kapsam = String(j.scope || '').split(' ');
  const kayit = {
    yenile: j.refresh_token, erisim: j.access_token, bitis: Date.now() + (j.expires_in || 3600) * 1000,
    kapsam, hesap: k.email || '', alan: k.hd || '', zaman: new Date().toISOString(), baglayan,
  };
  await kasaYaz(db, KASA, kayit);
  return kayit;
}

export async function durum(db) {
  const k = await kasaOku(db, KASA);
  if (!k) return { yapilandirildi: yapilandirildi(), bagli: false };
  return {
    yapilandirildi: yapilandirildi(), bagli: !k.kopuk, kopuk: !!k.kopuk, hesap: k.hesap, alan: k.alan, zaman: k.zaman,
    drive: k.kapsam?.includes(KAPSAM.drive), gmail: k.kapsam?.includes(KAPSAM.gmail),
  };
}

export async function kes(db) {
  const k = await kasaOku(db, KASA);
  if (k?.yenile) await fetch(ADRES.iptal + '?token=' + encodeURIComponent(k.yenile), { method: 'POST' }).catch(() => {});
  await kasaSil(db, KASA);
}

// Geçerli erişim belirteci (gerekirse yeniler).
async function erisim(db, gereken) {
  const k = await kasaOku(db, KASA);
  if (!k || k.kopuk) throw new HttpHata(409, 'Google hesabı bağlı değil. Ayarlar → Firma → Bulut depolar\'dan bağla.', { kod: 'GOOGLE_YOK' });
  if (gereken && !k.kapsam?.includes(gereken)) throw new HttpHata(409, 'Google bağlantısında bu izin yok; bağlantıyı kesip yeniden bağla.', { kod: 'GOOGLE_IZIN' });
  if (k.erisim && k.bitis > Date.now() + 60_000) return k.erisim;
  try {
    const j = await belirtecIstegi({ refresh_token: k.yenile, grant_type: 'refresh_token' });
    k.erisim = j.access_token; k.bitis = Date.now() + (j.expires_in || 3600) * 1000;
    if (j.refresh_token) k.yenile = j.refresh_token;
    await kasaYaz(db, KASA, k);
    return k.erisim;
  } catch (e) {
    if (e.kod === 'invalid_grant') { k.kopuk = true; await kasaYaz(db, KASA, k); throw new HttpHata(409, 'Google bağlantısı düştü (izin geri alınmış ya da süresi dolmuş). Ayarlar → Firma\'dan yeniden bağla.', { kod: 'GOOGLE_KOPUK' }); }
    throw e;
  }
}

async function gIstek(db, gereken, url, sec = {}) {
  const t = await erisim(db, gereken);
  const r = await fetch(url, { ...sec, headers: { authorization: 'Bearer ' + t, ...(sec.headers || {}) } });
  if (!r.ok && r.status !== 308) {
    const j = await r.json().catch(() => ({}));
    console.error('google', sec.method || 'GET', url.split('?')[0], r.status, j.error?.message || '');
    throw new HttpHata(502, 'Google isteği başarısız: ' + (j.error?.message || r.status));
  }
  return r;
}

// ---------------- Drive ----------------
const tirnak = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
async function klasorBulYaKur(db, ad, ustId, aciklama) {
  const q = `name='${tirnak(ad)}' and mimeType='${KLASOR_TIPI}' and trashed=false and '${tirnak(ustId)}' in parents`;
  const r = await gIstek(db, KAPSAM.drive, `${ADRES.drive}/files?` + new URLSearchParams({ q, fields: 'files(id,name)', pageSize: '1', spaces: 'drive' }));
  const v = (await r.json()).files?.[0];
  if (v) return v.id;
  const y = await gIstek(db, KAPSAM.drive, `${ADRES.drive}/files?fields=id`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: ad, mimeType: KLASOR_TIPI, parents: [ustId], ...(aciklama ? { description: aciklama } : {}) }),
  });
  return (await y.json()).id;
}

// NetERP/<proje kodu> klasörü (proje yoksa NetERP/Genel). Klasör açıklamasına proje adı yazılır.
export async function projeKlasoru(db, kod, projeAd) {
  const kok = await klasorBulYaKur(db, KOK_KLASOR, 'root', 'NetERP dosyaları (ERP tarafından yönetilir)');
  return klasorBulYaKur(db, kod || 'Genel', kok, projeAd || '');
}

// Yükleme oturumu (resumable). Dönen adres bir yetkidir; istemciye şifreli verilir.
export async function yuklemeBaslat(db, { ad, tip, boyut, klasorId }) {
  const r = await gIstek(db, KAPSAM.drive, `${ADRES.yukle}?uploadType=resumable&fields=id,name,size,mimeType,webViewLink`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-type': tip || 'application/octet-stream', 'x-upload-content-length': String(boyut) },
    body: JSON.stringify({ name: ad, parents: [klasorId] }),
  });
  const uri = r.headers.get('location');
  if (!uri) throw new HttpHata(502, 'Google yükleme oturumu açılamadı');
  return uri;
}

// Bir parça gönderir. 308: devam; 200/201: bitti (dosya bilgisi döner).
export async function parcaGonder(uri, parca, bas, toplam) {
  const son = bas + parca.length - 1;
  const r = await fetch(uri, {
    method: 'PUT',
    headers: { 'content-range': toplam === 0 ? 'bytes */0' : `bytes ${bas}-${son}/${toplam}`, 'content-length': String(parca.length) },
    body: parca,
  });
  if (r.status === 308) {
    const aralik = r.headers.get('range'); // "bytes=0-12345"
    return { bitti: false, alinan: aralik ? Number(aralik.split('-')[1]) + 1 : 0 };
  }
  if (r.ok) return { bitti: true, dosya: await r.json() };
  const j = await r.json().catch(() => ({}));
  console.error('google yukleme parca', r.status, j.error?.message || '');
  throw new HttpHata(r.status === 404 || r.status === 410 ? 410 : 502, r.status === 404 || r.status === 410 ? 'Yükleme oturumu sona erdi, dosyayı yeniden yükle' : 'Google yükleme hatası: ' + (j.error?.message || r.status));
}

// Workspace alanındaki herkes bağlantıyla görebilsin (aramada çıkmaz). Kişisel hesapta paylaşım yapılmaz.
export async function alandaPaylas(db, dosyaId) {
  const k = await kasaOku(db, KASA);
  if (!k?.alan) return false;
  await gIstek(db, KAPSAM.drive, `${ADRES.drive}/files/${encodeURIComponent(dosyaId)}/permissions?sendNotificationEmail=false`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'domain', role: 'reader', domain: k.alan, allowFileDiscovery: false }),
  });
  return true;
}

// ---------------- Gmail ----------------
const kodla = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : '=?UTF-8?B?' + Buffer.from(s, 'utf8').toString('base64') + '?=');
const adresTemiz = (s) => String(s || '').replace(/[\r\n<>"]/g, '').trim();
export function mimeOlustur({ kimden, kimdenAd, kime, cc, cevap, konu, metin }) {
  const satir = (b) => b.toString('base64').replace(/.{76}/g, '$&\r\n');
  const bas = [
    `From: ${kimdenAd ? `${kodla(adresTemiz(kimdenAd))} <${adresTemiz(kimden)}>` : adresTemiz(kimden)}`,
    `To: ${kime.map(adresTemiz).join(', ')}`,
    ...(cc?.length ? [`Cc: ${cc.map(adresTemiz).join(', ')}`] : []),
    ...(cevap ? [`Reply-To: ${adresTemiz(cevap)}`] : []),
    `Subject: ${kodla(String(konu || '').replace(/[\r\n]+/g, ' '))}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
  ];
  return bas.join('\r\n') + '\r\n\r\n' + satir(Buffer.from(String(metin || ''), 'utf8'));
}

export async function gmailGonder(db, ileti) {
  const k = await kasaOku(db, KASA);
  const ham = mimeOlustur({ ...ileti, kimden: ileti.kimden || k?.hesap });
  const r = await gIstek(db, KAPSAM.gmail, ADRES.gmail, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ raw: Buffer.from(ham, 'utf8').toString('base64url') }),
  });
  const j = await r.json();
  return { id: j.id, kimden: ileti.kimden || k?.hesap };
}
