// Projeler ve kayıtlar (kartlar). Liste uçları sayfalıdır; yalnız kullanıcının görebildiği veri döner.
import { Router } from 'express';
import { z } from 'zod';
import { HttpHata } from '../hata.js';
import { okuyabilir, fnErisim } from '../kurallar/yetki.js';
import { degerDb } from '../kurallar/degerler.js';
import { tanimlar, yeniId } from '../veri.js';
import { kaydet, durumDegistir, sil, kayitLog, projeKisileri, gorunurDegerler, projeApi, kartApi } from '../kayitServis.js';

const r = Router();
const Sayfa = z.object({ sayfa: z.coerce.number().int().min(1).default(1), adet: z.coerce.number().int().min(1).max(1000).default(500) });

// ---------- projeler ----------
r.get('/projeler', async (req, res) => {
  const u = req.kullanici, db = req.db, tanim = await tanimlar(req);
  const q = Sayfa.extend({ arsiv: z.enum(['0', '1']).optional(), degerler: z.enum(['0', '1']).optional() }).parse(req.query);
  let s = db('projeler').where({ silindi: false });
  if (q.arsiv !== '1') s = s.andWhere({ arsiv: false });
  const satirlar = await s.orderBy('kod').limit(q.adet).offset((q.sayfa - 1) * q.adet);
  const ids = satirlar.map((p) => p.id);
  const kisiler = await projeKisileri(db, ids);
  const projeModul = tanim.moduller.find((m) => m.tur === 'proje');
  // Proje adı/kodu seçim listeleri için herkese gerekir; proje alanları yalnız ana modülü görebilene gider.
  let degerler = [];
  if (q.degerler !== '0' && projeModul && okuyabilir(u, projeModul.id) && ids.length) {
    const d = [];
    for (let i = 0; i < ids.length; i += 500) d.push(...await db('degerler').whereIn('proje_id', ids.slice(i, i + 500)).whereNull('kart_id'));
    degerler = gorunurDegerler(u, tanim, d, kisiler);
  }
  res.json({ projeler: satirlar.map((p) => projeApi(p, kisiler.get(p.id))), degerler, sayfa: q.sayfa, adet: q.adet });
});

r.get('/projeler/:id', async (req, res) => {
  const u = req.kullanici, db = req.db, tanim = await tanimlar(req);
  const p = await db('projeler').where({ id: req.params.id, silindi: false }).first();
  if (!p) throw new HttpHata(404, 'Proje bulunamadı');
  const kisiler = await projeKisileri(db, [p.id]);
  const pm = tanim.moduller.find((m) => m.tur === 'proje');
  const okur = pm && okuyabilir(u, pm.id);
  const degerler = okur ? gorunurDegerler(u, tanim, await db('degerler').where({ proje_id: p.id }).whereNull('kart_id'), kisiler) : [];
  res.json({ proje: projeApi(p, kisiler.get(p.id)), degerler, log: okur ? await kayitLog(db, 'proje', p.id) : [] });
});
r.post('/projeler', async (req, res) => res.status(201).json(await kaydet(req, 'proje', null, req.body)));
r.put('/projeler/:id', async (req, res) => res.json(await kaydet(req, 'proje', req.params.id, req.body)));
r.patch('/projeler/:id/durum', async (req, res) => res.json(await durumDegistir(req, 'proje', req.params.id, z.object({ durumId: z.string().max(40) }).parse(req.body).durumId)));
r.delete('/projeler/:id', async (req, res) => res.json(await sil(req, 'proje', req.params.id)));

// ---------- kayıtlar ----------
r.get('/kartlar', async (req, res) => {
  const u = req.kullanici, db = req.db, tanim = await tanimlar(req);
  const q = Sayfa.extend({ modul: z.string().max(40).optional(), proje: z.string().max(40).optional(), durum: z.string().max(40).optional() }).parse(req.query);
  const izinli = tanim.moduller.filter((m) => m.tur !== 'proje' && okuyabilir(u, m.id)).map((m) => m.id);
  if (q.modul && !izinli.includes(q.modul)) throw new HttpHata(403, 'Bu modülü görme yetkin yok');
  let s = db('kartlar as k').join('projeler as p', 'p.id', 'k.proje_id').where('k.silindi', false).andWhere('p.silindi', false)
    .whereIn('k.modul_id', q.modul ? [q.modul] : (izinli.length ? izinli : ['__yok']));
  if (q.proje) s = s.andWhere('k.proje_id', q.proje);
  if (q.durum) s = s.andWhere('k.durum_id', q.durum);
  const kartlar = await s.select('k.*').orderBy('k.kod').limit(q.adet).offset((q.sayfa - 1) * q.adet);
  const ids = kartlar.map((k) => k.id);
  const d = [];
  for (let i = 0; i < ids.length; i += 500) d.push(...await db('degerler').whereIn('kart_id', ids.slice(i, i + 500)));
  const kisiler = await projeKisileri(db, [...new Set(kartlar.map((k) => k.proje_id))]);
  res.json({ kartlar: kartlar.map(kartApi), degerler: gorunurDegerler(u, tanim, d, kisiler), sayfa: q.sayfa, adet: q.adet });
});

r.get('/kartlar/:id', async (req, res) => {
  const u = req.kullanici, db = req.db, tanim = await tanimlar(req);
  const k = await db('kartlar').where({ id: req.params.id, silindi: false }).first();
  if (!k || !okuyabilir(u, k.modul_id)) throw new HttpHata(404, 'Kayıt bulunamadı');
  const kisiler = await projeKisileri(db, [k.proje_id]);
  res.json({ kart: kartApi(k), degerler: gorunurDegerler(u, tanim, await db('degerler').where({ kart_id: k.id }), kisiler), log: await kayitLog(db, 'kart', k.id) });
});
r.post('/kartlar', async (req, res) => res.status(201).json(await kaydet(req, 'kart', null, req.body)));
r.put('/kartlar/:id', async (req, res) => res.json(await kaydet(req, 'kart', req.params.id, req.body)));
r.patch('/kartlar/:id/durum', async (req, res) => res.json(await durumDegistir(req, 'kart', req.params.id, z.object({ durumId: z.string().max(40) }).parse(req.body).durumId)));
r.delete('/kartlar/:id', async (req, res) => res.json(await sil(req, 'kart', req.params.id)));

// ---------- mesaj: kaydı açıp Kaydet'e basmadan mesaj yazma ----------
r.post('/mesaj', async (req, res) => {
  const u = req.kullanici, db = req.db, tanim = await tanimlar(req);
  const v = z.object({ projeId: z.string().max(40), kartId: z.string().max(40).optional().nullable(), fnUid: z.string().max(40), metin: z.string().trim().min(1).max(10000), ustId: z.string().max(40).optional().nullable() }).parse(req.body);
  const kayit = v.kartId ? await db('kartlar').where({ id: v.kartId, silindi: false }).first() : await db('projeler').where({ id: v.projeId, silindi: false }).first();
  if (!kayit) throw new HttpHata(404, 'Kayıt bulunamadı');
  const m = v.kartId ? tanim.modul(kayit.modul_id) : tanim.moduller.find((x) => x.tur === 'proje');
  const f = m?.fn.find((x) => x.uid === v.fnUid && x.tip === 'mesaj');
  if (!f || !okuyabilir(u, m.id) || fnErisim(u, f) !== 'duzenle') throw new HttpHata(403, 'Bu kayda mesaj yazma yetkin yok');
  const ortak = { modulId: m.id, projeId: v.kartId ? kayit.proje_id : kayit.id, kartId: v.kartId || null };
  const id = yeniId(), zaman = new Date();
  await db('degerler').insert({ ...degerDb({ id, fnUid: f.uid, fnTip: 'mesaj', metin: v.metin, kisi: u.id, ustId: v.ustId || null, zaman: zaman.toISOString(), okuyan: [u.id] }, ortak), olusturan: u.id, olusturma: zaman, guncelleyen: u.id, guncelleme: zaman });
  res.status(201).json({ id });
});

export default r;
