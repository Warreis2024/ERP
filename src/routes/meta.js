// Arayüzün açılışta ihtiyaç duyduğu tanımlar. Kullanıcının görmediği modül ve "Görme" fonksiyonlar gönderilmez.
import { Router } from 'express';
import { json } from '../db.js';
import { okuyabilir, fnErisim, yonetici, izin, modulYetki } from '../kurallar/yetki.js';
import { tanimlar, kullaniciDis } from '../veri.js';

const r = Router();
const tanimSat = (x) => ({ id: x.id, ad: x.ad, sira: x.sira, ...json.oku(x.tanim, {}) });

r.get('/meta', async (req, res) => {
  const u = req.kullanici, db = req.db, t = await tanimlar(req);
  const [ayar, opsiyonlar, gruplar, departmanlar, kullanicilar, depolar, malzemeler, sablonlar, panolar, ciktilar, kiosklar, rf, rk] = await Promise.all([
    db('ayarlar').where({ anahtar: 'firma' }).first(),
    db('opsiyonlar').orderBy(['grup', 'sira']),
    db('yetki_gruplari').orderBy('sira'),
    db('departmanlar').orderBy('sira'),
    db('kullanicilar').where({ aktif: true }).orderBy('ad'),
    db('depolar').orderBy('sira'),
    db('malzemeler').orderBy('ad'),
    db('sablonlar').orderBy('sira'),
    db('panolar').orderBy('sira'),
    db('ciktilar').orderBy('sira'),
    yonetici(u) ? db('kiosklar').orderBy('sira') : [],
    db('rehber_firmalar').orderBy('ad'),
    db('rehber_kisiler').orderBy('ad'),
  ]);
  const firma = json.oku(ayar?.deger, {});
  // Gizli ayarlar istemciye gitmez
  if (firma.eposta) { delete firma.eposta.sifre; delete firma.eposta.token; }
  const moduller = t.moduller.filter((m) => okuyabilir(u, m.id)).map((m) => ({
    ...m,
    yetki: modulYetki(u, m.id), onay: izin(u, m.id, 'onay'), disa: izin(u, m.id, 'disa'),
    fn: m.fn.filter((f) => fnErisim(u, f) !== 'gizli').map((f) => ({ ...f, erisim: fnErisim(u, f), yetki: yonetici(u) ? f.yetki : undefined })),
  }));
  const gorulenModul = new Set(moduller.map((m) => m.id));
  res.json({
    firma: { sub: req.firma.sub, ad: firma.ad || req.firma.ad, ...firma },
    ben: kullaniciDis(u, true),
    moduller,
    opsiyonlar: opsiyonlar.map((o) => ({ id: o.id, grup: o.grup, ad: o.ad, varsayilan: !!o.varsayilan, tur: o.tur, sira: o.sira })),
    yetkiGruplari: gruplar, departmanlar: departmanlar.map((d) => d.ad),
    kullanicilar: kullanicilar.map((k) => kullaniciDis(k)),
    depolar, malzemeler: malzemeler.map((m) => ({ ...m, kritik: m.kritik === null ? '' : String(Number(m.kritik)) })),
    sablonlar: sablonlar.map(tanimSat), panolar: panolar.map(tanimSat),
    ciktilar: ciktilar.map(tanimSat).filter((c) => gorulenModul.has(c.modulId)),
    kiosklar: kiosklar.map(tanimSat),
    rehber: { firmalar: rf, kisiler: rk },
  });
});

export default r;
