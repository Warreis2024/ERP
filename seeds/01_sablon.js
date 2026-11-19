// Test veritabanını şablondaki (sablon.html) tanımlar ve örnek verilerle doldurur.
// UYARI: Var olan bütün verileri siler. Yalnız test ortamında çalıştırın.
//   ORNEK=0        → yalnız tanımlar + yönetici (örnek proje/kayıt yok)
//   ORNEK_SIFRE    → örnek kullanıcıların şifresi (varsayılan Deneme123)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sifreOzetle } from '../src/auth/sifre.js';
import { degerDb } from '../src/kurallar/degerler.js';

const kok = path.dirname(fileURLToPath(import.meta.url));
const S = JSON.parse(fs.readFileSync(path.join(kok, 'sablon-veri.json'), 'utf8'));
const REF = '2026-11-19'; // sablon-veri.json'ın üretildiği gün; tarihler bugüne kaydırılır

const kaydir = (() => {
  const fark = Math.round((Date.parse(new Date().toISOString().slice(0, 10)) - Date.parse(REF)) / 864e5);
  const gun = (s) => { const d = new Date(s.slice(0, 10) + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + fark); return d.toISOString().slice(0, 10); };
  return {
    tarih: (s) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? gun(s) : null),
    zaman: (s) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? new Date(gun(s) + 'T' + (s.slice(11, 16) || '09:00') + ':00+03:00') : null),
  };
})();
const j = (v) => (v === undefined || v === null ? null : JSON.stringify(v));

/** @param {import('knex').Knex} knex */
export async function seed(knex) {
  const ornek = process.env.ORNEK !== '0';
  const ornekSifre = process.env.ORNEK_SIFRE || 'Deneme123';
  for (const t of ['epostalar', 'ciktilar', 'kiosklar', 'panolar', 'sablonlar', 'malzemeler', 'depolar', 'rehber_kisiler', 'rehber_firmalar',
    'log', 'degerler', 'kartlar', 'proje_kisileri', 'projeler', 'sayaclar', 'opsiyonlar', 'fonksiyonlar', 'durumlar', 'moduller',
    'giris_kayitlari', 'kullanici_yetki', 'kullanicilar', 'departmanlar', 'yetki_gruplari', 'ayarlar']) await knex(t).del();

  const simdi = new Date();
  await knex('ayarlar').insert({ anahtar: 'firma', deger: j({ ...S.firma, sub: undefined }), guncelleme: simdi });
  await knex('yetki_gruplari').insert(S.yetkiGruplari.map((g, i) => ({ id: g.id, ad: g.ad, sira: i })));
  await knex('departmanlar').insert(S.departmanlar.map((d, i) => ({ ad: d, sira: i })));

  // modüller, durumlar, fonksiyonlar
  await knex('moduller').insert(S.moduller.map((m, i) => ({ id: m.id, ad: m.ad, renk: m.renk, ikon: m.ikon, onek: m.onek, tur: m.tur || 'kart', acik: m.acik !== false, sira: i, sistem: j(m.sistem) })));
  await knex('durumlar').insert(S.moduller.flatMap((m) => m.durumlar.map((d, i) => ({ id: d.id, modul_id: m.id, ad: d.ad, renk: d.renk, sira: i, kapat: !!d.kapat }))));
  await knex('fonksiyonlar').insert(S.moduller.flatMap((m) => m.fn.map((f, i) => ({
    uid: f.uid, modul_id: m.id, tip: f.tip, ad: f.ad, zorunlu: !!f.zorunlu, grup: f.grup || null, tarih_vars: f.tarihVarsayilan || null,
    sekme: f.sekme || null, kanban: !!f.kanban, liste: f.liste !== false, sira: i, yetki: j(f.yetki || {}),
  }))));
  await knex('opsiyonlar').insert(S.opsiyonlar.map((o, i) => ({ id: o.id, grup: o.grup, ad: o.ad, varsayilan: !!o.varsayilan, tur: o.tur || 'select', sira: i })));

  // kullanıcılar: sistem yöneticisi ilk girişte şifresini değiştirmek zorunda
  const adminOzet = await sifreOzetle(process.env.ADMIN_SIFRE || 'admin123');
  const ornekOzet = await sifreOzetle(ornekSifre);
  const kullanicilar = S.kullanicilar.filter((u) => u.sistem || ornek);
  for (const u of kullanicilar) {
    await knex('kullanicilar').insert({
      id: u.id, ad: u.ad, unvan: u.unvan || null, eposta: (u.sistem ? (process.env.ADMIN_EPOSTA || u.eposta) : u.eposta).toLowerCase(),
      rol: u.rol, grup_id: u.grup || null, departman: u.departman || null, aktif: u.aktif !== false, sistem: !!u.sistem,
      sifre_ozet: u.sistem ? adminOzet : ornekOzet, sifre_degismeli: !!u.sistem, olusturma: simdi,
      tercih: j({}), eposta_hesap: j({ tur: 'yok' }),
    });
    const y = Object.entries(u.yetki || {}).filter(([, v]) => v && v !== 'yok')
      .map(([modul_id, yetki]) => ({ kullanici_id: u.id, modul_id, yetki, onay: !!u.ek?.[modul_id]?.onay, disa: !!u.ek?.[modul_id]?.disa }));
    if (y.length) await knex('kullanici_yetki').insert(y);
  }

  await knex('depolar').insert(S.depolar.map((d, i) => ({ id: d.id, ad: d.ad, sira: i })));
  await knex('malzemeler').insert(S.malzemeler.map((m) => ({ id: m.id, kod: m.kod || null, ad: m.ad, birim: m.birim || null, kritik: m.kritik ? Number(String(m.kritik).replace(',', '.')) : null })));
  const tanim = (L, alanlar) => L.map((x, i) => { const t = { ...x }; delete t.id; delete t.ad; delete t.sira; return { id: x.id, ad: x.ad, sira: i, tanim: j(t), guncelleme: simdi }; });
  await knex('sablonlar').insert(tanim(S.sablonlar));
  await knex('panolar').insert(tanim(S.panolar));
  await knex('kiosklar').insert(tanim(S.kiosklar));
  await knex('ciktilar').insert(tanim(S.ciktilar));
  if (!ornek) return;

  // rehber
  await knex('rehber_firmalar').insert(S.firmalar.map((f) => ({ id: f.id, ad: f.ad, vergi_no: f.vergiNo || null, vd: f.vd || null, tel: f.tel || null, eposta: f.eposta || null, adres: f.adres || null, notu: f.not || null })));
  if (S.kisiler.length) await knex('rehber_kisiler').insert(S.kisiler.map((k) => ({ id: k.id, ad: k.ad, firma_id: k.firmaId || null, unvan: k.unvan || null, tel: k.tel || null, eposta: k.eposta || null })));

  // projeler, kayıtlar, değerler, log
  const kid = new Set(kullanicilar.map((u) => u.id));
  const den = (o) => ({ olusturan: kid.has(o.olusturan) ? o.olusturan : null, olusturma: kaydir.zaman(o.olusturma), guncelleyen: kid.has(o.guncelleyen) ? o.guncelleyen : null, guncelleme: kaydir.zaman(o.guncelleme) });
  await knex('projeler').insert(S.projeler.map((p) => ({ id: p.id, kod: p.kod, ad: p.ad, durum_id: p.durumId, kategori: p.kategori || null, arsiv: !!p.arsiv, silindi: !!p.silindi, ...den(p) })));
  const pk = S.projeler.flatMap((p) => [...new Set(p.yonetici || [])].map((u) => ({ proje_id: p.id, kullanici_id: u, rol: 'yonetici' }))
    .concat([...new Set(p.ekip || [])].map((u) => ({ proje_id: p.id, kullanici_id: u, rol: 'ekip' })))).filter((x) => kid.has(x.kullanici_id));
  if (pk.length) await knex('proje_kisileri').insert(pk);
  await knex('kartlar').insert(S.kartlar.map((k) => ({ id: k.id, kod: k.kod, modul_id: k.modulId, proje_id: k.projeId, durum_id: k.durumId, tarih: kaydir.tarih(k.tarih), silindi: !!k.silindi, ...den(k) })));

  const deg = S.degerler.map((d) => {
    const r = { ...d, tarih: kaydir.tarih(d.tarih) || '', vade: kaydir.tarih(d.vade) || '', zaman: d.zaman ? kaydir.zaman(d.zaman).toISOString() : '' };
    if (r.kisi) { const u = S.kullanicilar.find((x) => x.ad === r.kisi || x.id === r.kisi); if (u) r.kisi = u.id; }
    return { ...degerDb(r, { modulId: d.modulId, projeId: d.projeId, kartId: d.kartId }), olusturma: simdi };
  });
  for (let i = 0; i < deg.length; i += 50) await knex('degerler').insert(deg.slice(i, i + 50));

  const adId = (ad) => S.kullanicilar.find((u) => u.ad === ad)?.id || null;
  await knex('log').insert(S.log.map((l) => ({ proje_id: l.projeId || null, modul_id: l.modulId || null, kart_id: l.kartId || null, tip: l.tip, kisi_id: adId(l.kisi), kisi_ad: l.kisi, zaman: kaydir.zaman(l.zaman), alan: l.alan || null, eski: l.eski ?? null, yeni: l.yeni ?? null, metin: l.metin || null })));

  // kod sayaçları: mevcut en büyük numaradan devam
  const say = {};
  for (const x of [...S.projeler.map((p) => ({ m: 'ana', kod: p.kod })), ...S.kartlar.map((k) => ({ m: k.modulId, kod: k.kod }))]) {
    const n = Number(String(x.kod).split('-').pop()); if (n > (say[x.m] || 1000)) say[x.m] = n;
  }
  await knex('sayaclar').insert(Object.entries(say).map(([anahtar, son]) => ({ anahtar, son })));
}
