// Proje ve kayıt (kart) kaydetme / silme / durum değiştirme. Bütün kurallar sunucuda uygulanır;
// istemciden gelen veriye yalnız kullanıcının "Düzenle" yetkisi olan fonksiyonlarda güvenilir.
import { z } from 'zod';
import { HttpHata } from './hata.js';
import { yazabilir, okuyabilir, fnGorunur, fnErisim, dosyaGorur, kapanisIzni, izin } from './kurallar/yetki.js';
import { degerleriBirlestir, fnOzetleri, alanLoglari, silinebilir, kartTarihi } from './kurallar/kayit.js';
import { degerDb, degerApi } from './kurallar/degerler.js';
import { tanimlar, kodUret, logYaz, yeniId, adCozucu, logApi } from './veri.js';

const DegerSema = z.object({ fnUid: z.string().max(40), id: z.string().max(40).optional().nullable() }).passthrough();
export const ProjeSema = z.object({
  ad: z.string().trim().min(1, 'Proje adı zorunlu').max(250),
  durumId: z.string().max(40).optional().nullable(),
  kategori: z.string().max(100).optional().nullable(),
  arsiv: z.boolean().optional(),
  yonetici: z.array(z.string().max(40)).max(50).optional(),
  ekip: z.array(z.string().max(40)).max(200).optional(),
  degerler: z.array(DegerSema).max(2000).optional(),
});
export const KartSema = z.object({
  modulId: z.string().max(40).optional(),
  projeId: z.string().max(40),
  durumId: z.string().max(40).optional().nullable(),
  degerler: z.array(DegerSema).max(2000).optional(),
});

const iso = (d) => (d ? new Date(d).toISOString() : '');

export async function projeKisileri(db, projeIdler) {
  if (!projeIdler.length) return new Map();
  const r = await db('proje_kisileri').whereIn('proje_id', projeIdler);
  const m = new Map(projeIdler.map((id) => [id, { yonetici: [], ekip: [] }]));
  for (const x of r) m.get(x.proje_id)?.[x.rol]?.push(x.kullanici_id);
  return m;
}

// Kullanıcının görebileceği değerler (gizli fonksiyon ve gizli dosya süzülür).
export function gorunurDegerler(u, tanim, satirlar, kisiler) {
  return satirlar.map(degerApi).filter((d) => {
    const m = tanim.modul(d.modulId); if (!m || !okuyabilir(u, m.id)) return false;
    const f = m.fn.find((x) => x.uid === d.fnUid); if (f && !fnGorunur(u, f)) return false;
    return dosyaGorur(u, d, kisiler.get(d.projeId)?.yonetici || []);
  });
}

export const projeApi = (p, k) => ({
  id: p.id, kod: p.kod, ad: p.ad, durumId: p.durum_id, kategori: p.kategori || '', arsiv: !!p.arsiv,
  yonetici: k?.yonetici || [], ekip: k?.ekip || [],
  olusturan: p.olusturan, olusturma: iso(p.olusturma), guncelleyen: p.guncelleyen, guncelleme: iso(p.guncelleme),
});
export const kartApi = (k) => ({
  id: k.id, kod: k.kod, modulId: k.modul_id, projeId: k.proje_id, durumId: k.durum_id,
  tarih: k.tarih ? (k.tarih instanceof Date ? k.tarih.toISOString().slice(0, 10) : String(k.tarih).slice(0, 10)) : '',
  olusturan: k.olusturan, olusturma: iso(k.olusturma), guncelleyen: k.guncelleyen, guncelleme: iso(k.guncelleme),
});

function durumDenetle(m, durumId) {
  const d = m.durumlar.find((x) => x.id === durumId);
  if (!d) throw new HttpHata(400, 'Durum bu modüle ait değil');
  return d;
}

// ---- kaydet (yeni ya da güncelle) ----
export async function kaydet(req, tur, id, govde) {
  const u = req.kullanici, db = req.db, tanim = await tanimlar(req);
  const proj = tur === 'proje';
  const veri = (proj ? ProjeSema : KartSema).parse(govde);
  const mevcut = id ? await db(proj ? 'projeler' : 'kartlar').where({ id }).first() : null;
  if (id && (!mevcut || mevcut.silindi)) throw new HttpHata(404, 'Kayıt bulunamadı');
  const m = proj ? tanim.moduller.find((x) => x.tur === 'proje') : tanim.modul(mevcut?.modul_id || veri.modulId);
  if (!m) throw new HttpHata(400, 'Modül bulunamadı');
  if (!yazabilir(u, m.id)) throw new HttpHata(403, 'Bu modülde yazma yetkin yok');
  const ilk = m.durumlar[0];
  const yeniDurum = durumDenetle(m, veri.durumId || mevcut?.durum_id || ilk?.id);
  const onceDurum = mevcut ? tanim.durum(mevcut.durum_id) : null;
  if (!kapanisIzni(u, m.id, onceDurum?.id || ilk?.id, yeniDurum)) throw new HttpHata(403, `${yeniDurum.ad} akışı kapatır; onay yetkisi gerekir`);
  if (!proj) {
    const p = await db('projeler').where({ id: veri.projeId, silindi: false }).first();
    if (!p) throw new HttpHata(400, 'Kayıt bir projeye bağlanmalı');
  }

  return db.transaction(async (trx) => {
    const kayitId = mevcut?.id || yeniId();
    const ortak = proj ? { projeId: kayitId, modulId: m.id, kartId: null } : { projeId: veri.projeId, modulId: m.id, kartId: kayitId };
    const eskiSat = mevcut
      ? await trx('degerler').where(proj ? { proje_id: kayitId, kart_id: null } : { kart_id: kayitId })
      : [];
    const eski = eskiSat.map(degerApi);
    const { yeni, zorunluEksik, hatalar } = degerleriBirlestir(u, m.fn, veri.degerler || [], eski, yeniId);
    if (hatalar.length) throw new HttpHata(400, hatalar[0], { hatalar });
    if (zorunluEksik.length) throw new HttpHata(400, zorunluEksik[0] + ' zorunlu', { zorunlu: zorunluEksik });

    // mesaj / imza: yazan ve zaman sunucuda doldurulur
    const simdi = new Date().toISOString();
    for (const r of yeni) {
      if (r.fnTip === 'mesaj' && !eski.some((e) => e.id === r.id)) { r.kisi = u.id; r.zaman = simdi; r.okuyan = [u.id]; }
      if (r.fnTip === 'imza' && r.url && !r.zaman) r.zaman = simdi;
      if (r.fnTip === 'dokuman' && !eski.some((e) => e.id === r.id)) { r.yukleyen = u.id; r.onay = 'bekliyor'; }
      if (r.fnTip === 'dokuman' && eski.some((e) => e.id === r.id && e.onay !== r.onay) && !izin(u, m.id, 'onay')) {
        r.onay = eski.find((e) => e.id === r.id).onay; // onay durumunu yalnız onay yetkilisi değiştirir
      }
    }

    const ad = await adCozucu(trx);
    const zaman = new Date();
    let kod = mevcut?.kod;
    if (proj) {
      const satir = { ad: veri.ad, durum_id: yeniDurum.id, kategori: veri.kategori || null, arsiv: !!veri.arsiv, guncelleyen: u.id, guncelleme: zaman };
      if (mevcut) await trx('projeler').where({ id: kayitId }).update(satir);
      else { kod = await kodUret(trx, m); await trx('projeler').insert({ id: kayitId, kod, ...satir, olusturan: u.id, olusturma: zaman }); }
      const kisiler = [...new Set(veri.yonetici || [])].map((k) => ({ proje_id: kayitId, kullanici_id: k, rol: 'yonetici' }))
        .concat([...new Set(veri.ekip || [])].map((k) => ({ proje_id: kayitId, kullanici_id: k, rol: 'ekip' })));
      const eskiKisi = mevcut ? await trx('proje_kisileri').where({ proje_id: kayitId }) : [];
      await trx('proje_kisileri').where({ proje_id: kayitId }).del();
      if (kisiler.length) await trx('proje_kisileri').insert(kisiler);
      if (mevcut) {
        const adlar = (L, rol) => L.filter((x) => x.rol === rol).map((x) => ad.kisi(x.kullanici_id)).join(', ');
        const once = { ad: mevcut.ad, kategori: mevcut.kategori || '', arsiv: mevcut.arsiv ? 'Evet' : 'Hayır', yonetici: adlar(eskiKisi, 'yonetici'), ekip: adlar(eskiKisi, 'ekip') };
        const sonra = { ad: veri.ad, kategori: veri.kategori || '', arsiv: veri.arsiv ? 'Evet' : 'Hayır', yonetici: adlar(kisiler, 'yonetici'), ekip: adlar(kisiler, 'ekip') };
        const AD = { ad: 'Ad', kategori: 'Kategori', arsiv: 'Arşiv', yonetici: 'Yönetici', ekip: 'Ekip' };
        await logYaz(trx, u, ortak, Object.keys(AD).filter((k) => once[k] !== sonra[k]).map((k) => ({ tip: 'alan', alan: AD[k], eski: once[k], yeni: sonra[k], metin: AD[k] + ' değişti' })));
      }
    } else {
      const satir = { proje_id: veri.projeId, durum_id: yeniDurum.id, tarih: kartTarihi(yeni) || null, guncelleyen: u.id, guncelleme: zaman };
      if (mevcut) {
        await trx('kartlar').where({ id: kayitId }).update(satir);
        if (mevcut.proje_id !== veri.projeId) {
          const [a, b] = await Promise.all([trx('projeler').where({ id: mevcut.proje_id }).first(), trx('projeler').where({ id: veri.projeId }).first()]);
          await logYaz(trx, u, ortak, { tip: 'alan', alan: 'Proje', eski: a?.ad || '', yeni: b?.ad || '', metin: 'Proje değişti' });
        }
      } else { kod = await kodUret(trx, m); await trx('kartlar').insert({ id: kayitId, kod, modul_id: m.id, ...satir, olusturan: u.id, olusturma: zaman }); }
    }

    // değerler: sil-yaz (aynı id'ler korunur)
    await trx('degerler').where(proj ? { proje_id: kayitId, kart_id: null } : { kart_id: kayitId }).del();
    const dbSat = yeni.map((r) => ({ ...degerDb(r, ortak), olusturan: eskiSat.find((e) => e.id === r.id)?.olusturan || u.id, olusturma: eskiSat.find((e) => e.id === r.id)?.olusturma || zaman, guncelleyen: u.id, guncelleme: zaman }));
    for (let i = 0; i < dbSat.length; i += 100) await trx('degerler').insert(dbSat.slice(i, i + 100));
    if (!proj && mevcut && mevcut.proje_id !== veri.projeId) await trx('degerler').where({ kart_id: kayitId }).update({ proje_id: veri.projeId });

    if (!mevcut) await logYaz(trx, u, ortak, { tip: 'yeni', metin: proj ? 'Proje açıldı' : 'Kayıt açıldı' });
    else {
      if (onceDurum?.id !== yeniDurum.id) await logYaz(trx, u, ortak, { tip: 'durum', alan: 'Durum', eski: onceDurum?.ad || '', yeni: yeniDurum.ad, metin: 'Durum değişti' });
      const L = alanLoglari(m.fn, fnOzetleri(m.fn, eski, ad), fnOzetleri(m.fn, yeni, ad));
      await logYaz(trx, u, ortak, L);
    }
    return { id: kayitId, kod };
  });
}

// ---- yalnız durum (kanbanda sürükle-bırak) ----
export async function durumDegistir(req, tur, id, durumId) {
  const u = req.kullanici, db = req.db, tanim = await tanimlar(req);
  const proj = tur === 'proje';
  const k = await db(proj ? 'projeler' : 'kartlar').where({ id }).first();
  if (!k || k.silindi) throw new HttpHata(404, 'Kayıt bulunamadı');
  const m = proj ? tanim.moduller.find((x) => x.tur === 'proje') : tanim.modul(k.modul_id);
  if (!yazabilir(u, m.id)) throw new HttpHata(403, 'Bu modülde yazma yetkin yok');
  const yeni = durumDenetle(m, durumId); const once = tanim.durum(k.durum_id);
  if (once?.id === yeni.id) return { id };
  if (!kapanisIzni(u, m.id, once?.id, yeni)) throw new HttpHata(403, `${yeni.ad} akışı kapatır; onay yetkisi gerekir`);
  await db.transaction(async (trx) => {
    await trx(proj ? 'projeler' : 'kartlar').where({ id }).update({ durum_id: yeni.id, guncelleyen: u.id, guncelleme: new Date() });
    await logYaz(trx, u, proj ? { projeId: id, modulId: m.id } : { projeId: k.proje_id, modulId: m.id, kartId: id }, { tip: 'durum', alan: 'Durum', eski: once?.ad || '', yeni: yeni.ad, metin: 'Durum değişti' });
  });
  return { id };
}

// ---- sil: README genel kuralı ----
export async function sil(req, tur, id) {
  const u = req.kullanici, db = req.db, tanim = await tanimlar(req);
  const proj = tur === 'proje';
  const k = await db(proj ? 'projeler' : 'kartlar').where({ id }).first();
  if (!k || k.silindi) throw new HttpHata(404, 'Kayıt bulunamadı');
  const m = proj ? tanim.moduller.find((x) => x.tur === 'proje') : tanim.modul(k.modul_id);
  if (!yazabilir(u, m.id)) throw new HttpHata(403, 'Bu modülde yazma yetkin yok');
  const loglar = await db('log').where(proj ? { proje_id: id, kart_id: null } : { kart_id: id }).select('tip');
  const bagli = proj ? Number((await db('kartlar').where({ proje_id: id }).count({ n: '*' }).first()).n) : 0;
  const kalici = silinebilir(k, m.durumlar[0]?.id, loglar, bagli);
  const ortak = proj ? { projeId: id, modulId: m.id } : { projeId: k.proje_id, modulId: m.id, kartId: id };
  await db.transaction(async (trx) => {
    if (kalici) {
      await trx('degerler').where(proj ? { proje_id: id } : { kart_id: id }).del();
      if (proj) await trx('proje_kisileri').where({ proje_id: id }).del();
      await trx(proj ? 'projeler' : 'kartlar').where({ id }).del();
      await logYaz(trx, u, ortak, { tip: 'sil', metin: `${k.kod} kalıcı silindi (ilk durum, işlem görmemiş)` });
    } else {
      await trx(proj ? 'projeler' : 'kartlar').where({ id }).update({ silindi: true, guncelleyen: u.id, guncelleme: new Date() });
      await logYaz(trx, u, ortak, { tip: 'sil', metin: `${k.kod} silindi olarak işaretlendi` });
    }
  });
  return { id, kalici };
}

export async function kayitLog(db, tur, id) {
  const L = await db('log').where(tur === 'proje' ? { proje_id: id, kart_id: null } : { kart_id: id }).orderBy('id');
  return L.map(logApi);
}
export { fnErisim };
