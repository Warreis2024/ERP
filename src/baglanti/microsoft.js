// Microsoft bağlantısı (firma hesabı): OAuth 2.0 (Microsoft identity platform v2) + OneDrive (Microsoft Graph).
// Kişisel (Outlook/Hotmail) ve iş/okul (Microsoft 365) hesapları: uygulama "her dizin + kişisel hesaplar" kayıtlı olmalı.
// İzinler: Files.ReadWrite (kullanıcının kendi OneDrive'ı; ERP yalnız NetERP klasörünü kullanır), User.Read, offline_access.
import { HttpHata } from '../hata.js';
import { kasaOku, kasaYaz, kasaSil } from './kasa.js';

const KIRACI = () => (process.env.MS_TENANT || 'common').trim();
const ADRES = {
  izin: () => `https://login.microsoftonline.com/${KIRACI()}/oauth2/v2.0/authorize`,
  belirtec: () => `https://login.microsoftonline.com/${KIRACI()}/oauth2/v2.0/token`,
  graph: 'https://graph.microsoft.com/v1.0',
};
export const KAPSAM = { dosya: 'Files.ReadWrite' };
const KAPSAMLAR = ['offline_access', 'User.Read', KAPSAM.dosya];
const KASA = 'microsoft';
export const KOK_KLASOR = 'NetERP';

const istemci = () => ({ id: (process.env.MS_CLIENT_ID || '').trim(), gizli: (process.env.MS_CLIENT_SECRET || '').trim() });
export const yapilandirildi = () => { const c = istemci(); return !!(c.id && c.gizli); };

export function donusAdresi(req) {
  if (process.env.MS_REDIRECT_URI) return process.env.MS_REDIRECT_URI.trim();
  const host = (req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
  return `${req.protocol}://${host}/api/baglanti/microsoft/donus`;
}

export function izinAdresi(req, durum) {
  return ADRES.izin() + '?' + new URLSearchParams({
    client_id: istemci().id, response_type: 'code', redirect_uri: donusAdresi(req), response_mode: 'query',
    scope: KAPSAMLAR.join(' '), state: durum, prompt: 'select_account',
  });
}

// Microsoft hata kodları (AADSTS…) → anlaşılır mesaj
function msHata(j, varsayilan) {
  const t = String(j.error_description || '');
  const kod = (t.match(/AADSTS\d+/) || [])[0] || j.error || '';
  const M = {
    AADSTS7000222: 'Sunucudaki Microsoft istemci gizli anahtarının süresi dolmuş (MS_CLIENT_SECRET yenilenmeli).',
    AADSTS7000215: 'Microsoft istemci gizli anahtarı geçersiz (MS_CLIENT_SECRET: "Secret ID" değil "Value" girilmeli).',
    AADSTS50011: 'Dönüş adresi Microsoft uygulama kaydındaki Redirect URI ile aynı değil.',
    AADSTS700016: 'Microsoft uygulaması bulunamadı (MS_CLIENT_ID yanlış ya da hesap türü desteklenmiyor).',
    AADSTS65001: 'İzin verilmedi; kuruluşun Microsoft 365 yöneticisinin onayı gerekebilir.',
    AADSTS90094: 'Bu uygulama için kuruluşun Microsoft 365 yöneticisinin onayı gerekiyor.',
  };
  return { kod, mesaj: M[kod] || varsayilan + (kod ? ' (' + kod + ')' : '') };
}

async function belirtecIstegi(govde) {
  const c = istemci();
  const r = await fetch(ADRES.belirtec(), {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: c.id, client_secret: c.gizli, scope: KAPSAMLAR.join(' '), ...govde }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const h = msHata(j, 'Microsoft belirteç hatası');
    console.error('microsoft belirtec:', j.error, h.kod, String(j.error_description || '').split('\r\n')[0]);
    const e = new HttpHata(400, h.mesaj); e.kod = j.error; e.aadsts = h.kod; throw e;
  }
  return j;
}

export async function kodTakas(req, db, kod, baglayan) {
  const j = await belirtecIstegi({ code: kod, grant_type: 'authorization_code', redirect_uri: donusAdresi(req) });
  if (!j.refresh_token) throw new HttpHata(400, 'Microsoft yenileme belirteci vermedi (offline_access izni eksik)');
  const yetki = { authorization: 'Bearer ' + j.access_token };
  const ben = await (await fetch(`${ADRES.graph}/me?$select=displayName,mail,userPrincipalName`, { headers: yetki })).json().catch(() => ({}));
  const surucu = await (await fetch(`${ADRES.graph}/me/drive?$select=id,driveType`, { headers: yetki })).json().catch(() => ({}));
  const kayit = {
    yenile: j.refresh_token, erisim: j.access_token, bitis: Date.now() + (j.expires_in || 3600) * 1000,
    kapsam: String(j.scope || '').split(' '), hesap: ben.mail || ben.userPrincipalName || '', ad: ben.displayName || '',
    surucuTur: surucu.driveType || '', zaman: new Date().toISOString(), baglayan,
  };
  await kasaYaz(db, KASA, kayit);
  return kayit;
}

const dosyaIzni = (k) => (k?.kapsam || []).some((x) => /(^|\/)Files\.ReadWrite(\.All)?$/i.test(x));

export async function durum(db) {
  const k = await kasaOku(db, KASA);
  if (!k) return { yapilandirildi: yapilandirildi(), bagli: false };
  return {
    yapilandirildi: yapilandirildi(), bagli: !k.kopuk, kopuk: !!k.kopuk, hesap: k.hesap, zaman: k.zaman,
    dosya: dosyaIzni(k), surucuTur: k.surucuTur, // personal | business
    kapsam: (k.kapsam || []).map((x) => x.replace('https://graph.microsoft.com/', '')),
  };
}

// Microsoft'ta temsilci belirteci iptal ucu yok; kasadan silinir. Kullanıcı izni hesabından da kaldırabilir.
export const kes = (db) => kasaSil(db, KASA);

async function erisim(db) {
  const k = await kasaOku(db, KASA);
  if (!k || k.kopuk) throw new HttpHata(409, 'OneDrive bağlı değil. Ayarlar → Firma → Bulut depolar\'dan bağla.', { kod: 'MS_YOK' });
  if (!dosyaIzni(k)) throw new HttpHata(409, 'OneDrive bağlantısında dosya izni yok; bağlantıyı kesip yeniden bağla.', { kod: 'MS_IZIN' });
  if (k.erisim && k.bitis > Date.now() + 60_000) return k.erisim;
  try {
    const j = await belirtecIstegi({ refresh_token: k.yenile, grant_type: 'refresh_token' });
    k.erisim = j.access_token; k.bitis = Date.now() + (j.expires_in || 3600) * 1000;
    if (j.refresh_token) k.yenile = j.refresh_token; // Microsoft yenileme belirtecini döndürür; yenisi saklanır
    await kasaYaz(db, KASA, k);
    return k.erisim;
  } catch (e) {
    if (e.kod === 'invalid_grant') {
      k.kopuk = true; await kasaYaz(db, KASA, k);
      throw new HttpHata(409, 'OneDrive bağlantısı düştü (izin geri alınmış, şifre değişmiş ya da süresi dolmuş). Ayarlar → Firma\'dan yeniden bağla.', { kod: 'MS_KOPUK' });
    }
    throw e;
  }
}

async function gIstek(db, yol, sec = {}) {
  const t = await erisim(db);
  const r = await fetch(yol.startsWith('http') ? yol : ADRES.graph + yol, { ...sec, headers: { authorization: 'Bearer ' + t, ...(sec.headers || {}) } });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    const e = new HttpHata(r.status === 404 ? 404 : 502, 'OneDrive: ' + (j.error?.message || r.status));
    e.msDurum = r.status;
    if (r.status !== 404) console.error('onedrive', sec.method || 'GET', yol.split('?')[0], r.status, j.error?.code || '', j.error?.message || '');
    throw e;
  }
  return r;
}

// OneDrive yolunda yasak karakterler: " * : < > ? / \ |  (proje kodu ve dosya adı için)
const temizAd = (s) => String(s).replace(/["*:<>?/\\|]/g, '_').replace(/[. ]+$/, '').trim() || 'Adsiz';
const yolKodla = (...p) => p.map((x) => encodeURIComponent(temizAd(x))).join('/');

async function klasorBulYaKur(db, ustId, ad) {
  try {
    const r = await gIstek(db, `/me/drive/items/${encodeURIComponent(ustId)}:/${yolKodla(ad)}?$select=id,folder`);
    return (await r.json()).id;
  } catch (e) { if (e.msDurum !== 404) throw e; }
  try {
    const y = await gIstek(db, `/me/drive/items/${encodeURIComponent(ustId)}/children`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: temizAd(ad), folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }),
    });
    return (await y.json()).id;
  } catch (e) {
    if (e.msDurum === 409) { // aynı anda başka istek açtı
      const r = await gIstek(db, `/me/drive/items/${encodeURIComponent(ustId)}:/${yolKodla(ad)}?$select=id`);
      return (await r.json()).id;
    }
    throw e;
  }
}

// OneDrive kökünde NetERP/<proje kodu> (proje yoksa NetERP/Genel)
export async function projeKlasoru(db, kod) {
  const kok = await (await gIstek(db, '/me/drive/root?$select=id')).json();
  const neterp = await klasorBulYaKur(db, kok.id, KOK_KLASOR);
  return klasorBulYaKur(db, neterp, kod || 'Genel');
}

// Yükleme oturumu: dönen uploadUrl önceden yetkilendirilmiştir (Authorization başlığı GÖNDERİLMEZ).
export async function yuklemeBaslat(db, { ad, klasorId }) {
  const r = await gIstek(db, `/me/drive/items/${encodeURIComponent(klasorId)}:/${yolKodla(ad)}:/createUploadSession`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'rename' } }),
  });
  const j = await r.json();
  if (!j.uploadUrl) throw new HttpHata(502, 'OneDrive yükleme oturumu açılamadı');
  return j.uploadUrl;
}

// Boş dosya (0 bayt) yükleme oturumuyla gönderilemez; doğrudan içerik olarak yazılır.
export async function bosDosya(db, { ad, klasorId }) {
  const r = await gIstek(db, `/me/drive/items/${encodeURIComponent(klasorId)}:/${yolKodla(ad)}:/content?@microsoft.graph.conflictBehavior=rename`, {
    method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: Buffer.alloc(0),
  });
  return dosyaOzet(await r.json());
}

const dosyaOzet = (d) => ({ id: d.id, name: d.name, size: d.size, mimeType: d.file?.mimeType || '', webViewLink: d.webUrl });

// 202: devam (nextExpectedRanges), 200/201: bitti (driveItem).
export async function parcaGonder(uri, parca, bas, toplam) {
  const son = bas + parca.length - 1;
  const r = await fetch(uri, { method: 'PUT', headers: { 'content-range': `bytes ${bas}-${son}/${toplam}`, 'content-length': String(parca.length) }, body: parca });
  const j = await r.json().catch(() => ({}));
  if (r.status === 202) {
    const sonraki = (j.nextExpectedRanges || [])[0];
    return { bitti: false, alinan: sonraki ? Number(String(sonraki).split('-')[0]) : bas + parca.length };
  }
  if (r.ok) return { bitti: true, dosya: dosyaOzet(j) };
  console.error('onedrive yukleme parca', r.status, j.error?.code || '', j.error?.message || '');
  const bitmis = r.status === 404 || r.status === 410;
  throw new HttpHata(bitmis ? 410 : 502, bitmis ? 'Yükleme oturumu sona erdi, dosyayı yeniden yükle' : 'OneDrive yükleme hatası: ' + (j.error?.message || r.status));
}

// İş hesabında (OneDrive for Business) kuruluş içine "görüntüleme" bağlantısı; kişisel hesapta paylaşım yapılmaz.
export async function kurulustaPaylas(db, dosyaId) {
  const k = await kasaOku(db, KASA);
  if (k?.surucuTur !== 'business') return null;
  const r = await gIstek(db, `/me/drive/items/${encodeURIComponent(dosyaId)}/createLink`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'view', scope: 'organization' }),
  });
  return (await r.json()).link?.webUrl || null;
}
