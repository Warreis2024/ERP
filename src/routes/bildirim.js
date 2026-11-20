// Sayfa açıkken bildirimler: istemci düzenli aralıkla "şu andan beri ne oldu" diye sorar.
//  • Bana gelen yeni mesajlar (alıcısı ben ya da alıcısız; kaydı görebiliyorsam)
//  • Bana atanan işler (kişi / ekip alanına adım eklendi)
//  • Oluşturduğum dış onay (QR) bağlantılarına müşteri yanıtı
// Yalnız görme yetkisi olan kayıtlar döner; kendi yaptığım değişiklikler bildirilmez.
import { Router } from 'express';
import { json } from '../db.js';
import { okuyabilir, fnGorunur } from '../kurallar/yetki.js';
import { tanimlar } from '../veri.js';
import { gorunurDegerler, projeKisileri } from '../kayitServis.js';

const r = Router();
const EN_COK = 30;

r.get('/bildirimler', async (req, res) => {
  const u = req.kullanici, db = req.db, simdi = new Date();
  const sonQ = new Date(String(req.query.son || ''));
  // İlk çağrı ya da çok eski/ileri tarih: yalnız şimdiki zaman döner (geçmiş bildirim yağmuru olmasın)
  if (isNaN(sonQ) || simdi - sonQ > 6 * 3600_000 || sonQ > simdi) return res.json({ simdi: simdi.toISOString(), olaylar: [] });
  const son = sonQ;
  const tanim = await tanimlar(req);
  const olaylar = [];

  // 1) mesajlar
  const msat = await db('degerler').where({ fn_tip: 'mesaj' }).andWhere('zaman', '>', son).andWhere((q) => q.whereNot('kisi', u.id).orWhereNull('kisi')).orderBy('zaman').limit(EN_COK);
  if (msat.length) {
    const kisiler = await projeKisileri(db, [...new Set(msat.map((x) => x.proje_id))]);
    for (const d of gorunurDegerler(u, tanim, msat, kisiler)) {
      const alici = Array.isArray(d.alici) ? d.alici : [];
      if (alici.length && !alici.includes(u.id)) continue;
      olaylar.push({ tur: 'mesaj', projeId: d.projeId, kartId: d.kartId || null, modulId: d.modulId, kimden: d.kisi, metin: String(d.metin || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200), zaman: d.zaman });
    }
  }

  // 2) atamalar: kişi / ekip alanının günlüğünde yeni değerde ben varım, eskisinde yoktum
  const ls = await db('log').where('zaman', '>', son).andWhere({ tip: 'alan' }).andWhere((q) => q.whereNot('kisi_id', u.id).orWhereNull('kisi_id')).orderBy('zaman').limit(200);
  const benMi = (v) => { const s = String(v || ''); return s.includes(u.ad) || s.includes(u.id); };
  for (const l of ls) {
    if (olaylar.length >= EN_COK) break;
    const m = tanim.modul(l.modul_id); if (!m || !okuyabilir(u, m.id)) continue;
    const f = m.fn.find((x) => x.ad === l.alan && (x.tip === 'kisi' || x.tip === 'ekip'));
    if (!f || !fnGorunur(u, f)) continue;
    if (!benMi(l.yeni) || benMi(l.eski)) continue;
    olaylar.push({ tur: 'atama', projeId: l.proje_id, kartId: l.kart_id, modulId: l.modul_id, kimden: l.kisi_ad, alan: l.alan, zaman: new Date(l.zaman).toISOString() });
  }

  // 3) dış onay yanıtları (bağlantıyı ben oluşturdum)
  const ds = await db('dis_onaylar').where({ olusturan: u.id, durum: 'yanitlandi' }).andWhere('yanit_zaman', '>', son).limit(EN_COK).catch(() => []);
  for (const d of ds) {
    if (!okuyabilir(u, d.modul_id)) continue;
    const y = json.oku(d.yanit, {});
    olaylar.push({ tur: 'onay', projeId: d.proje_id, kartId: d.kart_id, modulId: d.modul_id, karar: y.karar || '', baslik: d.baslik, zaman: new Date(d.yanit_zaman).toISOString() });
  }

  res.json({ simdi: simdi.toISOString(), olaylar: olaylar.slice(0, EN_COK) });
});

export default r;
