// Arayüzün (sablon.html) açılışta yüklediği bütün durum, şablonun kendi veri biçiminde (S).
// Kullanıcının göremediği modül, fonksiyon, değer ve gizli dosya gönderilmez; yönetici olmayan
// kullanıcıya diğer kullanıcıların yetki ve hesap ayrıntıları gitmez.
import { Router } from 'express';
import { json } from '../db.js';
import { okuyabilir, fnErisim, yonetici } from '../kurallar/yetki.js';
import { tanimlar, logApi } from '../veri.js';
import { projeKisileri, gorunurDegerler, projeApi, kartApi } from '../kayitServis.js';

const r = Router();
const tanimSat = (x) => ({ ...json.oku(x.tanim, {}), id: x.id, ad: x.ad, sira: x.sira });
const parcala = async (db, tablo, kolon, ids) => {
  const o = [];
  for (let i = 0; i < ids.length; i += 500) o.push(...await db(tablo).whereIn(kolon, ids.slice(i, i + 500)));
  return o;
};

// Kullanıcı satırı → şablondaki kullanıcı nesnesi
export function kullaniciS(k, yetkiSat, tam) {
  const tercih = json.oku(k.tercih, {});
  const o = {
    id: k.id, ad: k.ad, unvan: k.unvan || '', departman: k.departman || '', rol: k.rol, grup: k.grup_id || '',
    aktif: !!k.aktif, foto: k.foto || '', eposta: k.eposta, sistem: !!k.sistem,
  };
  if (!tam) return o;
  const y = yetkiSat.filter((x) => x.kullanici_id === k.id);
  return {
    ...o, tel: k.tel || '',
    yetki: Object.fromEntries(y.map((x) => [x.modul_id, x.yetki])),
    ek: Object.fromEntries(y.filter((x) => x.onay || x.disa).map((x) => [x.modul_id, { onay: !!x.onay, disa: !!x.disa }])),
    gorunum: tercih.gorunum || {}, acilis: tercih.acilis || 'pano', panoGizli: tercih.panoGizli || undefined, panoEk: tercih.panoEk || undefined,
    epostaHesap: json.oku(k.eposta_hesap, { tur: 'yok' }),
    sifre: k.sifre_degismeli ? null : 'sunucuda', sifreTarih: k.sifre_tarih ? new Date(k.sifre_tarih).toISOString() : '',
    kilit: k.kilit ? new Date(k.kilit).toISOString() : '', sonGiris: k.son_giris ? new Date(k.son_giris).toISOString() : '',
  };
}

r.get('/durum', async (req, res) => {
  const u = req.kullanici, db = req.db, t = await tanimlar(req), yon = yonetici(u);
  const [ayar, opsiyonlar, gruplar, departmanlar, kullanicilar, yetkiSat, depolar, malzemeler, sablonlar, panolar, ciktilar, kiosklar, rf, rk, projeSat, kartSat] = await Promise.all([
    db('ayarlar').where({ anahtar: 'firma' }).first(),
    db('opsiyonlar').orderBy(['grup', 'sira']),
    db('yetki_gruplari').orderBy('sira'),
    db('departmanlar').orderBy('sira'),
    db('kullanicilar').orderBy('ad'),
    yon ? db('kullanici_yetki') : db('kullanici_yetki').where({ kullanici_id: u.id }),
    db('depolar').orderBy('sira'),
    db('malzemeler').orderBy('ad'),
    db('sablonlar').orderBy('sira'),
    db('panolar').orderBy('sira'),
    db('ciktilar').orderBy('sira'),
    yon ? db('kiosklar').orderBy('sira') : [],
    db('rehber_firmalar').orderBy('ad'),
    db('rehber_kisiler').orderBy('ad'),
    db('projeler').where({ silindi: false }).orderBy('kod'),
    db('kartlar').where({ silindi: false }).orderBy('kod'),
  ]);

  const firma = json.oku(ayar?.deger, {});
  if (firma.eposta) { firma.eposta.sifreKayitli = !!(firma.eposta.sifre || firma.eposta.sifreKayitli); delete firma.eposta.sifre; delete firma.eposta.token; }

  const moduller = t.moduller.filter((m) => okuyabilir(u, m.id)).map((m) => ({
    id: m.id, ad: m.ad, renk: m.renk, ikon: m.ikon, onek: m.onek, tur: m.tur, acik: m.acik, sira: m.sira, sistem: m.sistem,
    durumlar: m.durumlar.map((d) => ({ id: d.id, ad: d.ad, renk: d.renk, sira: d.sira, kapat: d.kapat })),
    fn: m.fn.filter((f) => fnErisim(u, f) !== 'gizli').map((f) => ({
      uid: f.uid, tip: f.tip, ad: f.ad, zorunlu: f.zorunlu, grup: f.grup || undefined, tarihVarsayilan: f.tarihVarsayilan || undefined,
      sekme: f.sekme || undefined, kanban: f.kanban, liste: f.liste, ...(yon ? { yetki: f.yetki } : {}),
    })),
  }));
  const gorulen = new Set(moduller.map((m) => m.id));

  const projeIds = projeSat.map((p) => p.id);
  const kisiler = await projeKisileri(db, projeIds);
  const kartlar = kartSat.filter((k) => gorulen.has(k.modul_id));
  const kartIds = new Set(kartlar.map((k) => k.id));
  const degerSat = (await parcala(db, 'degerler', 'proje_id', projeIds)).filter((d) => !d.kart_id || kartIds.has(d.kart_id));
  const degerler = gorunurDegerler(u, t, degerSat, kisiler);
  const logSat = await db('log').whereIn('modul_id', [...gorulen]).orderBy('id', 'desc').limit(5000);

  res.json({
    sema: 2,
    firma: { ...firma, ad: firma.ad || req.firma.ad, sub: req.firma.sub },
    yetkiGruplari: gruplar.map((g) => ({ id: g.id, ad: g.ad })),
    departmanlar: departmanlar.map((d) => d.ad),
    kullanicilar: kullanicilar.filter((k) => yon || k.aktif || k.id === u.id).map((k) => kullaniciS(k, yetkiSat, yon || k.id === u.id)),
    moduller,
    opsiyonlar: opsiyonlar.map((o) => ({ id: o.id, grup: o.grup, ad: o.ad, varsayilan: !!o.varsayilan, tur: o.tur })),
    sablonlar: sablonlar.map(tanimSat), panolar: panolar.map(tanimSat), kiosklar: kiosklar.map(tanimSat),
    ciktilar: ciktilar.map(tanimSat).filter((c) => !c.modulId || gorulen.has(c.modulId)), ciktiKuruldu: true,
    depolar: depolar.map((d) => ({ id: d.id, ad: d.ad })),
    malzemeler: malzemeler.map((m) => ({ id: m.id, kod: m.kod || '', ad: m.ad, birim: m.birim || '', kritik: m.kritik === null ? '' : String(Number(m.kritik)) })),
    firmalar: rf.map((f) => ({ id: f.id, ad: f.ad, vergiNo: f.vergi_no || '', vd: f.vd || '', tel: f.tel || '', eposta: f.eposta || '', adres: f.adres || '', not: f.notu || '' })),
    kisiler: rk.map((k) => ({ id: k.id, ad: k.ad, firmaId: k.firma_id || '', unvan: k.unvan || '', tel: k.tel || '', eposta: k.eposta || '' })),
    epostalar: [],
    projeler: projeSat.map((p) => projeApi(p, kisiler.get(p.id))),
    kartlar: kartlar.map(kartApi),
    degerler,
    log: logSat.reverse().map(logApi),
  });
});

export default r;
