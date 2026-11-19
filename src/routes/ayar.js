// Ayarlar (yalnız yönetici). Tablo başına izin verilen alanlar burada tanımlıdır; başka alan yazılamaz.
import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { HttpHata } from '../hata.js';
import { json } from '../db.js';
import { yoneticiGerekli } from '../auth/middleware.js';
import { sifreOzetle } from '../auth/sifre.js';
import { yeniId, kullaniciDis } from '../veri.js';

const r = Router();
// Personel rehbere firma/kişi ve malzeme listesine yeni kayıt ekleyebilir (formda yazdığı firma rehbere düşer);
// listeleme, düzenleme ve silme yöneticinin işidir.
const HERKES_EKLER = new Set(['rehber_firmalar', 'rehber_kisiler', 'malzemeler']);
r.use((req, res, next) => {
  const tablo = req.path.split('/')[1];
  if (req.method === 'POST' && HERKES_EKLER.has(tablo) && req.path === '/' + tablo) return next();
  return yoneticiGerekli(req, res, next);
});

const ad = z.string().trim().min(1).max(150);
const renk = z.string().regex(/^#[0-9a-fA-F]{3,8}$/).optional();
const kimlik = z.string().regex(/^[a-z0-9_-]{1,40}$/i);
const JSONV = z.record(z.any());

// tablo → { anahtar, sema (kısmi güncellemede .partial()), json alanları, silmeden önce kontrol }
const T = {
  moduller: { anahtar: 'id', id: true, sema: z.object({ ad, renk, ikon: z.string().max(30).optional(), onek: z.string().regex(/^[A-ZÇĞİÖŞÜ0-9]{1,10}$/), tur: z.enum(['proje', 'kart']).optional(), acik: z.boolean().optional(), sira: z.number().int().optional(), sistem: JSONV.optional() }), json: ['sistem'],
    silKontrol: async (db, id) => (await db('kartlar').where({ modul_id: id }).first()) && 'Bu modülde kayıt var; modül kapatılabilir ama silinemez' },
  durumlar: { anahtar: 'id', sema: z.object({ modul_id: kimlik, ad, renk, sira: z.number().int().optional(), kapat: z.boolean().optional() }),
    silKontrol: async (db, id) => ((await db('kartlar').where({ durum_id: id }).first()) || (await db('projeler').where({ durum_id: id }).first())) && 'Bu durumda kayıt var' },
  fonksiyonlar: { anahtar: 'uid', sema: z.object({ modul_id: kimlik, tip: z.string().max(20), ad, zorunlu: z.boolean().optional(), grup: z.string().max(60).nullable().optional(), tarih_vars: z.string().max(20).optional(), sekme: z.string().max(60).optional(), kanban: z.boolean().optional(), liste: z.boolean().optional(), sira: z.number().int().optional(), yetki: z.record(z.enum(['duzenle', 'gor', 'gizli'])).optional() }), json: ['yetki'],
    silKontrol: async (db, id) => (await db('degerler').where({ fn_uid: id }).first()) && 'Bu fonksiyonda veri var; önce verileri taşıyın' },
  opsiyonlar: { anahtar: 'id', sema: z.object({ grup: z.string().trim().min(1).max(60), ad, varsayilan: z.boolean().optional(), tur: z.enum(['select', 'radio', 'check']).optional(), sira: z.number().int().optional() }) },
  yetki_gruplari: { anahtar: 'id', sema: z.object({ ad, sira: z.number().int().optional() }),
    silKontrol: async (db, id) => (await db('kullanicilar').where({ grup_id: id }).first()) && 'Bu grupta kullanıcı var' },
  departmanlar: { anahtar: 'ad', sema: z.object({ ad, sira: z.number().int().optional() }) },
  depolar: { anahtar: 'id', sema: z.object({ ad, sira: z.number().int().optional() }) },
  malzemeler: { anahtar: 'id', sema: z.object({ kod: z.string().max(60).optional(), ad, birim: z.string().max(30).optional(), kritik: z.number().nonnegative().nullable().optional() }) },
  rehber_firmalar: { anahtar: 'id', sema: z.object({ ad: z.string().trim().min(1).max(250), vergi_no: z.string().max(20).optional(), vd: z.string().max(100).optional(), tel: z.string().max(40).optional(), eposta: z.string().max(254).optional(), adres: z.string().max(2000).optional(), notu: z.string().max(5000).optional() }) },
  rehber_kisiler: { anahtar: 'id', sema: z.object({ ad, firma_id: z.string().max(40).nullable().optional(), unvan: z.string().max(100).optional(), tel: z.string().max(40).optional(), eposta: z.string().max(254).optional() }) },
  sablonlar: { anahtar: 'id', sema: z.object({ ad, sira: z.number().int().optional(), tanim: JSONV.optional() }), json: ['tanim'] },
  panolar: { anahtar: 'id', sema: z.object({ ad, sira: z.number().int().optional(), tanim: JSONV.optional() }), json: ['tanim'] },
  kiosklar: { anahtar: 'id', sema: z.object({ ad, sira: z.number().int().optional(), tanim: JSONV.optional() }), json: ['tanim'] },
  ciktilar: { anahtar: 'id', sema: z.object({ ad, sira: z.number().int().optional(), tanim: JSONV.optional() }), json: ['tanim'] },
};
const tablo = (ad) => { const t = T[ad]; if (!t) throw new HttpHata(404, 'Bilinmeyen ayar'); return t; };
const yaz = (t, v) => { const o = { ...v }; for (const k of t.json || []) if (k in o) o[k] = json.yaz(o[k]); if ('tanim' in o || t.json?.includes('tanim')) o.guncelleme = new Date(); return o; };

r.get('/:tablo', async (req, res) => { const t = tablo(req.params.tablo); res.json(await req.db(req.params.tablo).orderBy(t.anahtar)); });
r.post('/:tablo', async (req, res) => {
  const t = tablo(req.params.tablo);
  const v = t.sema.parse(req.body);
  // Arayüz kendi kimliğiyle çalışır; verdiği kimlik biçim ve teklik denetiminden geçerse kullanılır.
  const id = t.anahtar === 'ad' ? v.ad : (req.body[t.anahtar] ? kimlik.parse(req.body[t.anahtar]) : yeniId());
  if (await req.db(req.params.tablo).where({ [t.anahtar]: id }).first()) throw new HttpHata(409, 'Bu kayıt zaten var');
  await req.db(req.params.tablo).insert({ ...yaz(t, v), ...(t.anahtar !== 'ad' ? { [t.anahtar]: id } : {}) });
  res.status(201).json({ [t.anahtar]: id });
});
r.put('/:tablo/:id', async (req, res) => {
  const t = tablo(req.params.tablo);
  const v = t.sema.partial().parse(req.body);
  const n = await req.db(req.params.tablo).where({ [t.anahtar]: req.params.id }).update(yaz(t, v));
  if (!n) throw new HttpHata(404, 'Bulunamadı');
  res.json({ ok: true });
});
r.delete('/:tablo/:id', async (req, res) => {
  const t = tablo(req.params.tablo);
  const engel = t.silKontrol && await t.silKontrol(req.db, req.params.id);
  if (engel) throw new HttpHata(409, engel);
  await req.db(req.params.tablo).where({ [t.anahtar]: req.params.id }).del();
  res.json({ ok: true });
});
// Sıralama: [id, id, …] sırasıyla sira = 0..n
r.put('/:tablo/sira/toplu', async (req, res) => {
  const t = tablo(req.params.tablo);
  const ids = z.array(z.string().max(150)).max(500).parse(req.body);
  await req.db.transaction(async (trx) => { for (let i = 0; i < ids.length; i++) await trx(req.params.tablo).where({ [t.anahtar]: ids[i] }).update({ sira: i }); });
  res.json({ ok: true });
});

// ---------- firma ayarı (logo, depo, NAS, e-posta…) ----------
export const firmaRouter = Router();
firmaRouter.use(yoneticiGerekli);
firmaRouter.put('/', async (req, res) => {
  const v = JSONV.parse(req.body);
  const db = req.db, var_ = await db('ayarlar').where({ anahtar: 'firma' }).first();
  // E-posta şifresi/belirteci istemciye hiç gönderilmez; gelmezse eskisi korunur.
  const eski = json.oku(var_?.deger, {});
  if (v.eposta && typeof v.eposta === 'object') {
    delete v.eposta.sifreKayitli;
    for (const k of ['sifre', 'token']) if (!v.eposta[k] && eski.eposta?.[k]) v.eposta[k] = eski.eposta[k];
  }
  delete v.sub;
  const s = json.yaz(v); if (s.length > 400000) throw new HttpHata(400, 'Firma ayarı çok büyük (logo 300 KB altında olmalı)');
  if (var_) await db('ayarlar').where({ anahtar: 'firma' }).update({ deger: s, guncelleme: new Date() });
  else await db('ayarlar').insert({ anahtar: 'firma', deger: s, guncelleme: new Date() });
  res.json({ ok: true });
});

// ---------- kullanıcılar ----------
export const kullaniciRouter = Router();
kullaniciRouter.use(yoneticiGerekli);
const KSema = z.object({
  ad, unvan: z.string().max(150).optional(), eposta: z.string().trim().toLowerCase().email().max(254),
  tel: z.string().max(40).optional(), rol: z.enum(['yonetici', 'personel']).optional(),
  grup_id: z.string().max(40).nullable().optional(), departman: z.string().max(100).nullable().optional(), aktif: z.boolean().optional(),
});
const geciciSifre = () => crypto.randomBytes(9).toString('base64url').replace(/[-_]/g, 'x') + '7';

kullaniciRouter.get('/', async (req, res) => {
  const L = await req.db('kullanicilar').orderBy('ad');
  const y = await req.db('kullanici_yetki');
  res.json(L.map((u) => ({ ...kullaniciDis({ ...u, yetkiler: Object.fromEntries(y.filter((x) => x.kullanici_id === u.id).map((x) => [x.modul_id, { yetki: x.yetki, onay: !!x.onay, disa: !!x.disa }])), tercih: {}, eposta_hesap: json.oku(u.eposta_hesap, { tur: 'yok' }) }, true), kilitli: !!(u.kilit && new Date(u.kilit) > new Date()), sonGiris: u.son_giris })));
});
kullaniciRouter.post('/', async (req, res) => {
  const v = KSema.parse(req.body);
  if (await req.db('kullanicilar').where({ eposta: v.eposta }).first()) throw new HttpHata(409, 'Bu e-posta kayıtlı');
  const id = req.body.id ? kimlik.parse(req.body.id) : yeniId();
  if (await req.db('kullanicilar').where({ id }).first()) throw new HttpHata(409, 'Bu kimlikte kullanıcı var');
  const sifre = geciciSifre();
  await req.db('kullanicilar').insert({ id, ...v, rol: v.rol || 'personel', aktif: true, sifre_ozet: await sifreOzetle(sifre), sifre_degismeli: true, olusturan: req.kullanici.id, olusturma: new Date() });
  res.status(201).json({ id, geciciSifre: sifre }); // geçici şifre yalnız bir kez gösterilir
});
kullaniciRouter.put('/:id', async (req, res) => {
  const v = KSema.partial().parse(req.body);
  const db = req.db, u = await db('kullanicilar').where({ id: req.params.id }).first();
  if (!u) throw new HttpHata(404, 'Kullanıcı bulunamadı');
  if (v.aktif === false && u.id === req.kullanici.id) throw new HttpHata(400, 'Kendi hesabını pasife alamazsın');
  if ((v.aktif === false || v.rol === 'personel') && u.rol === 'yonetici') {
    const n = Number((await db('kullanicilar').where({ rol: 'yonetici', aktif: true }).count({ n: '*' }).first()).n);
    if (n < 2) throw new HttpHata(400, 'Son aktif yönetici pasife alınamaz ya da personele çevrilemez');
  }
  const d = { ...v, guncelleyen: req.kullanici.id, guncelleme: new Date() };
  if (v.aktif === false || (v.rol && v.rol !== u.rol)) d.oturum_surumu = u.oturum_surumu + 1; // açık oturumları düşür
  await db('kullanicilar').where({ id: u.id }).update(d);
  res.json({ ok: true });
});
kullaniciRouter.post('/:id/sifre-sifirla', async (req, res) => {
  const u = await req.db('kullanicilar').where({ id: req.params.id }).first();
  if (!u) throw new HttpHata(404, 'Kullanıcı bulunamadı');
  // Sistem yöneticisi ve kişinin kendi hesabı bu yoldan sıfırlanmaz: biri yanlışlıkla tetiklerse yönetici hesabı kilitlenir.
  if (u.sistem) throw new HttpHata(403, 'Sistem yöneticisinin şifresi buradan sıfırlanamaz');
  if (u.id === req.kullanici.id) throw new HttpHata(400, 'Kendi şifreni Profilim → Güvenlik bölümünden değiştir');
  const sifre = geciciSifre();
  await req.db('kullanicilar').where({ id: u.id }).update({ sifre_ozet: await sifreOzetle(sifre), sifre_degismeli: true, hatali: 0, kilit: null, oturum_surumu: u.oturum_surumu + 1 });
  res.json({ geciciSifre: sifre });
});
kullaniciRouter.put('/:id/yetkiler', async (req, res) => {
  const v = z.record(z.object({ yetki: z.enum(['yok', 'oku', 'yaz']), onay: z.boolean().optional(), disa: z.boolean().optional() })).parse(req.body);
  await req.db.transaction(async (trx) => {
    await trx('kullanici_yetki').where({ kullanici_id: req.params.id }).del();
    const s = Object.entries(v).map(([modul_id, x]) => ({ kullanici_id: req.params.id, modul_id, yetki: x.yetki, onay: !!x.onay, disa: !!x.disa }));
    if (s.length) await trx('kullanici_yetki').insert(s);
  });
  res.json({ ok: true });
});

export default r;
