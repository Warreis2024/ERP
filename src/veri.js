// Ortak veri erişimi: kullanıcı, modül tanımları, kod üretimi, log yazımı.
import crypto from 'node:crypto';
import { json } from './db.js';

export const yeniId = () => crypto.randomUUID();

export async function kullaniciYukle(db, id) {
  const u = await db('kullanicilar').where({ id }).first();
  if (!u) return null;
  const y = await db('kullanici_yetki').where({ kullanici_id: id });
  u.yetkiler = Object.fromEntries(y.map((r) => [r.modul_id, { yetki: r.yetki, onay: !!r.onay, disa: !!r.disa }]));
  u.tercih = json.oku(u.tercih, {});
  u.eposta_hesap = json.oku(u.eposta_hesap, { tur: 'yok' });
  return u;
}

// İstemciye giden kullanıcı (gizli alanlar çıkarılır).
export function kullaniciDis(u, tam = false) {
  const o = { id: u.id, ad: u.ad, unvan: u.unvan || '', departman: u.departman || '', rol: u.rol, grup: u.grup_id, aktif: !!u.aktif, foto: u.foto || '' };
  if (tam) Object.assign(o, { eposta: u.eposta, tel: u.tel || '', yetkiler: u.yetkiler, tercih: u.tercih, epostaHesap: u.eposta_hesap, sifreDegismeli: !!u.sifre_degismeli, sistem: !!u.sistem });
  return o;
}

// Modül tanımları (istek boyunca bir kez okunur).
export async function tanimlar(req) {
  if (req._tanim) return req._tanim;
  const db = req.db;
  const [moduller, durumlar, fonksiyonlar] = await Promise.all([
    db('moduller').orderBy('sira'), db('durumlar').orderBy(['modul_id', 'sira']), db('fonksiyonlar').orderBy(['modul_id', 'sira']),
  ]);
  const fnler = fonksiyonlar.map((f) => ({
    uid: f.uid, modulId: f.modul_id, tip: f.tip, ad: f.ad, zorunlu: !!f.zorunlu, grup: f.grup, tarihVarsayilan: f.tarih_vars || '',
    sekme: f.sekme || '', kanban: !!f.kanban, liste: !!f.liste, sira: f.sira, yetki: json.oku(f.yetki, {}), ayar: json.oku(f.ayar, {}),
  }));
  const dur = durumlar.map((d) => ({ id: d.id, modulId: d.modul_id, ad: d.ad, renk: d.renk, sira: d.sira, kapat: !!d.kapat, gecis: d.gecis || '' }));
  const mod = moduller.map((m) => ({
    id: m.id, ad: m.ad, renk: m.renk, ikon: m.ikon, onek: m.onek, tur: m.tur, acik: !!m.acik, sira: m.sira, sistem: json.oku(m.sistem, {}), aktarimlar: json.oku(m.aktarimlar, []),
    durumlar: dur.filter((d) => d.modulId === m.id), fn: fnler.filter((f) => f.modulId === m.id),
  }));
  req._tanim = { moduller: mod, modul: (id) => mod.find((m) => m.id === id), durum: (id) => dur.find((d) => d.id === id) };
  return req._tanim;
}

// Kayıt kodu: PRJ-1001, IS-1002… Sayaç satırı işlem içinde artırılır (eşzamanlı isteklerde çakışmaz).
export async function kodUret(trx, modul) {
  const anahtar = modul.id;
  const n = await trx('sayaclar').where({ anahtar }).increment('son', 1);
  if (!n) await trx('sayaclar').insert({ anahtar, son: 1001 });
  const { son } = await trx('sayaclar').where({ anahtar }).first();
  return `${modul.onek}-${son}`;
}

export async function logYaz(trx, u, ortak, kayitlar) {
  const satirlar = (Array.isArray(kayitlar) ? kayitlar : [kayitlar]).map((l) => ({
    proje_id: ortak.projeId || null, modul_id: ortak.modulId || null, kart_id: ortak.kartId || null,
    tip: l.tip, kisi_id: u.id, kisi_ad: u.ad, zaman: new Date(),
    alan: l.alan || null, eski: l.eski ?? null, yeni: l.yeni ?? null, metin: l.metin || null,
  }));
  if (satirlar.length) await trx('log').insert(satirlar);
}

export const logApi = (l) => ({
  id: l.id, projeId: l.proje_id, modulId: l.modul_id, kartId: l.kart_id, tip: l.tip, kisi: l.kisi_ad, kisiId: l.kisi_id,
  zaman: l.zaman ? new Date(l.zaman).toISOString() : '', alan: l.alan || '', eski: l.eski || '', yeni: l.yeni || '', metin: l.metin || '',
});

// Ad çözücü (özet metinleri için): kullanıcı id → ad, depo id → ad.
export async function adCozucu(db) {
  const [k, d] = await Promise.all([db('kullanicilar').select('id', 'ad'), db('depolar').select('id', 'ad')]);
  const km = new Map(k.map((x) => [x.id, x.ad])), dm = new Map(d.map((x) => [x.id, x.ad]));
  return { kisi: (v) => km.get(v) || v || '', depo: (v) => dm.get(v) || v || '' };
}
