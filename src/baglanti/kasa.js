// Bağlantı kasası: OAuth belirteçleri ve benzeri gizli bilgiler veritabanına şifreli (AES-256-GCM) yazılır.
// Anahtar BAGLANTI_ANAHTAR ortam değişkeninden, yoksa OTURUM_GIZLI'den HKDF ile türetilir.
// Not: anahtar değişirse kayıtlı bağlantılar çözülemez; "Bağlan" ile yeniden bağlanmak gerekir.
import crypto from 'node:crypto';
import { config } from '../config.js';
import { json } from '../db.js';

let _anahtar = null;
function anahtar() {
  if (_anahtar) return _anahtar;
  const kok = (process.env.BAGLANTI_ANAHTAR || config.oturum.gizli || '').trim();
  if (kok.length < 32) throw new Error('BAGLANTI_ANAHTAR ya da OTURUM_GIZLI en az 32 karakter olmalı');
  _anahtar = Buffer.from(crypto.hkdfSync('sha256', kok, 'yontem-erp', 'baglanti-kasasi-v1', 32));
  return _anahtar;
}

export function sifrele(nesne) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', anahtar(), iv);
  const veri = Buffer.concat([c.update(JSON.stringify(nesne), 'utf8'), c.final()]);
  return 'v1.' + [iv, c.getAuthTag(), veri].map((b) => b.toString('base64url')).join('.');
}

export function coz(metin) {
  if (typeof metin !== 'string' || !metin.startsWith('v1.')) return null;
  try {
    const [iv, etiket, veri] = metin.slice(3).split('.').map((x) => Buffer.from(x, 'base64url'));
    const d = crypto.createDecipheriv('aes-256-gcm', anahtar(), iv);
    d.setAuthTag(etiket);
    return JSON.parse(Buffer.concat([d.update(veri), d.final()]).toString('utf8'));
  } catch { return null; }
}

// ayarlar tablosunda "baglanti:<ad>" anahtarıyla şifreli kayıt
const ANAHTAR = (ad) => 'baglanti:' + ad;
export async function kasaOku(db, ad) {
  const r = await db('ayarlar').where({ anahtar: ANAHTAR(ad) }).first();
  return r ? coz(json.oku(r.deger, null)) : null;
}
export async function kasaYaz(db, ad, nesne) {
  const deger = json.yaz(sifrele(nesne)), k = ANAHTAR(ad);
  const var_ = await db('ayarlar').where({ anahtar: k }).first();
  if (var_) await db('ayarlar').where({ anahtar: k }).update({ deger, guncelleme: new Date() });
  else await db('ayarlar').insert({ anahtar: k, deger, guncelleme: new Date() });
}
export const kasaSil = (db, ad) => db('ayarlar').where({ anahtar: ANAHTAR(ad) }).del();
