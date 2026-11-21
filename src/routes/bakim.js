// Ayarlar → Firma → Bakım (yalnız yönetici): arşiv temizliği ve "Depoya süpür".
import { Router } from 'express';
import { yoneticiGerekli } from '../auth/middleware.js';
import { arsivTemizle, artikTemizle, depoyaSupur } from '../bakim.js';

const r = Router();

r.get('/bakim/ozet', yoneticiGerekli, async (req, res) => {
  const db = req.db;
  const arsiv = await db('projeler').where({ arsiv: true, silindi: false }).pluck('id');
  const silinmis = arsiv.length ? Number((await db('kartlar').whereIn('proje_id', arsiv).where({ silindi: true }).count({ n: '*' }).first()).n) : 0;
  const supur = await depoyaSupur(db, req.kullanici, { dene: true });
  res.json({ arsivProje: arsiv.length, silinmis, supur });
});

r.post('/bakim/arsiv', yoneticiGerekli, async (req, res) => {
  const db = req.db;
  const toplam = { proje: 0, kayit: 0, artik: 0 };
  for (const id of await db('projeler').where({ arsiv: true, silindi: false }).pluck('id')) {
    const s = await arsivTemizle(db, id, req.kullanici);
    if (!s) continue;
    toplam.proje++; toplam.kayit += s.kayit; toplam.artik += s.deger + s.bag + s.onay + s.takip + s.eposta;
  }
  const a = await artikTemizle(db);
  toplam.artik += a.bag; toplam.giris = a.giris;
  res.json(toplam);
});

r.post('/bakim/supur', yoneticiGerekli, async (req, res) => {
  res.json(await depoyaSupur(req.db, req.kullanici, { dene: false }));
});

export default r;
