// Misafir kullanıcı: normal kullanıcı gibi şifreyle girer, yetki grubu ve modül yetkileri aynıdır. Ek olarak:
//  • Tarih / gün / saat penceresi dışında YENİ giriş açılamaz (açık oturum kapanmaz).
//  • Görünürlük: 'kendi' → açtığı ya da kişi/ekip alanında adı geçen kayıtlar;
//                'firma' → bunlara ek olarak kayıt ya da projesindeki Firma alanı misafirin firmasıyla eşleşenler.
//  • Proje: kişilerinde (yönetici/ekip) olduğu ya da (firma görünümünde) firması eşleşen projeler tam görünür;
//    yalnız içindeki bir kayıt yüzünden görünen projenin kendi alanları gösterilmez.
export const SAAT_DILIMI = 'Europe/Istanbul';
const norm = (s) => String(s || '').trim().toLocaleLowerCase('tr');

// Firma saatine göre şu anki tarih (YYYY-AA-GG), gün (1=Pzt … 7=Paz) ve saat (SS:DD)
export function yerelAn(simdi = new Date(), tz = SAAT_DILIMI) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false }).formatToParts(simdi).map((x) => [x.type, x.value]));
  const gun = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[p.weekday];
  return { tarih: `${p.year}-${p.month}-${p.day}`, gun, saat: `${p.hour === '24' ? '00' : p.hour}:${p.minute}` };
}

const tarihS = (v) => (v ? (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10)) : '');

// Giriş penceresi. Döner: null (izinli) ya da sebep metni.
export function misafirGirisEngeli(u, simdi = new Date()) {
  if (!u || u.tur !== 'misafir') return null;
  const an = yerelAn(simdi);
  const bas = tarihS(u.gecerli_bas), bit = tarihS(u.gecerli_bit);
  if (bas && an.tarih < bas) return 'Misafir erişimin henüz başlamadı';
  if (bit && an.tarih > bit) return 'Misafir erişim süren doldu';
  if (u.gunler && !String(u.gunler).includes(String(an.gun))) return 'Misafir erişimin bu gün kapalı';
  const sb = u.saat_bas || '', ss = u.saat_bit || '';
  if (sb && ss) {
    const icinde = sb <= ss ? an.saat >= sb && an.saat <= ss : an.saat >= sb || an.saat <= ss; // gece yarısını aşan aralık
    if (!icinde) return `Misafir erişimin ${sb}–${ss} saatleri arasında`;
  }
  return null;
}

// Misafirin görebileceği kayıtlar. Döner: { kart:Set, proje:Set (görünür), projeTam:Set (alanları da görünür) }
export async function misafirKapsam(db, u) {
  const benim = (v) => { const x = norm(v); return !!x && (x === norm(u.id) || x === norm(u.ad)); };
  const firmam = norm(u.firma);
  const firmaGor = u.gorunum === 'firma' && !!firmam;
  const [kartlar, kisiDeger, firmaDeger, projeKisi] = await Promise.all([
    db('kartlar').where({ silindi: false }).select('id', 'proje_id', 'olusturan'),
    db('degerler').whereIn('fn_tip', ['kisi', 'ekip']).select('proje_id', 'kart_id', 'kisi'),
    firmaGor ? db('degerler').where({ fn_tip: 'firma' }).select('proje_id', 'kart_id', 'firma') : [],
    db('proje_kisileri').where({ kullanici_id: u.id }).select('proje_id'),
  ]);
  const projeTam = new Set(projeKisi.map((x) => x.proje_id));
  const kartAdim = new Set(kisiDeger.filter((d) => d.kart_id && benim(d.kisi)).map((d) => d.kart_id));
  kisiDeger.filter((d) => !d.kart_id && benim(d.kisi)).forEach((d) => projeTam.add(d.proje_id));
  const kartFirma = new Set(), projeFirma = new Set();
  for (const d of firmaDeger) if (norm(d.firma) === firmam) (d.kart_id ? kartFirma.add(d.kart_id) : projeFirma.add(d.proje_id));
  projeFirma.forEach((p) => projeTam.add(p));
  const kart = new Set(kartlar.filter((k) => k.olusturan === u.id || kartAdim.has(k.id) || (firmaGor && (kartFirma.has(k.id) || projeFirma.has(k.proje_id)))).map((k) => k.id));
  const proje = new Set(projeTam);
  for (const k of kartlar) if (kart.has(k.id)) proje.add(k.proje_id);
  return { kart, proje, projeTam };
}

// Değer satırı (API biçimi ya da veritabanı satırı) misafire görünür mü
export function kapsamDeger(kapsam, d) {
  if (!kapsam) return true;
  const kartId = d.kartId ?? d.kart_id, projeId = d.projeId ?? d.proje_id;
  return kartId ? kapsam.kart.has(kartId) : kapsam.projeTam.has(projeId);
}

// Kayıt misafire görünür mü (misafir değilse her zaman evet). tam: projenin kendi alanları için
export function kayitGorur(u, tur, id, tam = false) {
  const k = u?._kapsam;
  if (!k) return true;
  if (tur === 'kart') return k.kart.has(id);
  return (tam ? k.projeTam : k.proje).has(id);
}
