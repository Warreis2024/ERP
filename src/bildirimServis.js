// Mobil (web push) bildirimlerinin kime gideceği: yeni mesaj, işe atanma.
// Yalnız kullanıcı kimlikleri döner; gönderim push.js'te. Gönderen hiçbir zaman kendine bildirim almaz.
import { bildirBekle } from './push.js';
import { json } from './db.js';

const ATAMA = { tr: '{0} seni bu işe ekledi', en: '{0} added you to this job', de: '{0} hat dich zu dieser Aufgabe hinzugefügt', es: '{0} te ha añadido a este trabajo' };

// Kişi alanı kullanıcı kimliği ya da (serbest yazılmış) ad tutabilir: ikisi de etkin kullanıcıya çözülür.
async function kullaniciCozucu(db) {
  const L = await db('kullanicilar').where({ aktif: true }).select('id', 'ad');
  const id = new Set(L.map((u) => u.id));
  const ad = new Map(L.map((u) => [String(u.ad || '').trim().toLocaleLowerCase('tr'), u.id]));
  return (v) => { const s = String(v || '').trim(); return id.has(s) ? s : ad.get(s.toLocaleLowerCase('tr')) || null; };
}

// Mesajın alıcıları: seçili alıcılar; yoksa projenin yönetici/ekibi + kaydı açan + kayıtta atanmış kişiler
export async function mesajAlicilari(db, { projeId, kartId, alici, gonderen }) {
  const coz = await kullaniciCozucu(db);
  if (Array.isArray(alici) && alici.length) return [...new Set(alici.map(coz).filter((x) => x && x !== gonderen))];
  const set = new Set();
  (await db('proje_kisileri').where({ proje_id: projeId })).forEach((x) => set.add(x.kullanici_id));
  if (kartId) {
    const k = await db('kartlar').where({ id: kartId }).first(); if (k?.olusturan) set.add(k.olusturan);
    (await db('degerler').where({ kart_id: kartId }).whereIn('fn_tip', ['kisi', 'ekip'])).forEach((d) => set.add(d.kisi));
  } else {
    const p = await db('projeler').where({ id: projeId }).first(); if (p?.olusturan) set.add(p.olusturan);
  }
  // yalnız var olan, aktif kullanıcılar; gönderen hariç
  return [...new Set([...set].map(coz).filter((x) => x && x !== gonderen))];
}

const kisaMetin = (s) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);

export async function mesajBildir(req, { projeId, kartId, alici, metin, kod, baslik }) {
  try {
    const idler = await mesajAlicilari(req.db, { projeId, kartId, alici, gonderen: req.kullanici.id });
    await bildirBekle(req.db, idler, { baslik: `${req.kullanici.ad} · ${kod || ''}`.trim(), govde: (baslik ? baslik + ': ' : '') + (kisaMetin(metin) || '📎'), url: `/m/#${kartId ? 'k' : 'p'}=${kartId || projeId}`, etiket: 'm:' + (kartId || projeId) });
  } catch (e) { console.error('mesaj bildirimi:', e.message); }
}

// Kayıt kaydedilirken: yeni mesajlar ve kişi/ekip alanına yeni eklenen kullanıcılar
export async function kayitBildir(req, { eski, yeni, projeId, kartId, kod, baslik }) {
  try {
    const u = req.kullanici;
    const eskiId = new Set(eski.map((r) => r.id));
    for (const r of yeni.filter((x) => x.fnTip === 'mesaj' && !eskiId.has(x.id))) {
      await mesajBildir(req, { projeId, kartId, alici: r.alici, metin: r.metin, kod, baslik });
    }
    const coz = await kullaniciCozucu(req.db);
    const kisiler = (L) => new Set(L.filter((r) => r.fnTip === 'kisi' || r.fnTip === 'ekip').map((r) => coz(r.kisi)).filter(Boolean));
    const once = kisiler(eski), sonra = kisiler(yeni);
    const yeniler = [...sonra].filter((x) => !once.has(x) && x !== u.id);
    if (!yeniler.length) return;
    // bildirim metni alıcının seçtiği dilde
    const dil = new Map((await req.db('kullanicilar').whereIn('id', yeniler).select('id', 'tercih')).map((x) => [x.id, (json.oku(x.tercih, {}).dil) || 'tr']));
    const grup = new Map();
    for (const id of yeniler) { const d = ATAMA[dil.get(id)] ? dil.get(id) : 'tr'; grup.set(d, [...(grup.get(d) || []), id]); }
    for (const [d, idler] of grup) await bildirBekle(req.db, idler, { baslik: `${kod || ''} · ${baslik || ''}`.trim(), govde: ATAMA[d].replace('{0}', u.ad), url: `/m/#${kartId ? 'k' : 'p'}=${kartId || projeId}`, etiket: 'a:' + (kartId || projeId) });
  } catch (e) { console.error('kayıt bildirimi:', e.message); }
}

// Alıcının dilinde tek tip bildirim. metinler: { tr, en, de, es } — {0}, {1} … yer tutucuları args'tan dolar.
export async function dilliBildir(req, idler, { baslik, metinler, args = [], url, etiket }) {
  idler = [...new Set(idler.filter(Boolean))];
  if (!idler.length) return;
  try {
    const dil = new Map((await req.db('kullanicilar').whereIn('id', idler).select('id', 'tercih')).map((x) => [x.id, json.oku(x.tercih, {}).dil || 'tr']));
    const grup = new Map();
    for (const id of idler) { const d = metinler[dil.get(id)] ? dil.get(id) : 'tr'; grup.set(d, [...(grup.get(d) || []), id]); }
    for (const [d, L] of grup) {
      const govde = metinler[d].replace(/\{(\d+)\}/g, (_, i) => String(args[+i] ?? ''));
      await bildirBekle(req.db, L, { baslik, govde, url, etiket });
    }
  } catch (e) { console.error('bildirim:', e.message); }
}

export const FIYAT_METIN = {
  bekliyor: { tr: '{0}: {1} fiyat onayını bekliyor', en: '{0}: {1} is waiting for your price approval', de: '{0}: {1} wartet auf deine Preisfreigabe', es: '{0}: {1} espera tu aprobación de precio' },
  onaylandi: { tr: '{0} fiyatı onayladı ({1})', en: '{0} approved the price ({1})', de: '{0} hat den Preis freigegeben ({1})', es: '{0} aprobó el precio ({1})' },
  reddedildi: { tr: '{0} fiyatı reddetti ({1})', en: '{0} rejected the price ({1})', de: '{0} hat den Preis abgelehnt ({1})', es: '{0} rechazó el precio ({1})' },
};
