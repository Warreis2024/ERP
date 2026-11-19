// Şifre özeti: argon2id. Paket yüklenemezse (ör. desteklenmeyen platform) scrypt'e düşer;
// özet önekiyle hangisi olduğu anlaşılır, doğrulama her ikisini de bilir.
import crypto from 'node:crypto';

let argon2 = null;
try { argon2 = (await import('argon2')).default; } catch { argon2 = null; }

const scryptOzet = (sifre, tuz) => new Promise((ok, red) =>
  crypto.scrypt(sifre, tuz, 64, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? red(e) : ok(k))));

export async function sifreOzetle(sifre) {
  if (argon2) return argon2.hash(sifre, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
  const tuz = crypto.randomBytes(16);
  return 'scrypt$' + tuz.toString('base64') + '$' + (await scryptOzet(sifre, tuz)).toString('base64');
}

export async function sifreDogrula(ozet, sifre) {
  if (!ozet || typeof sifre !== 'string') return false;
  if (ozet.startsWith('scrypt$')) {
    const [, tuz, h] = ozet.split('$');
    const k = await scryptOzet(sifre, Buffer.from(tuz, 'base64'));
    const b = Buffer.from(h, 'base64');
    return k.length === b.length && crypto.timingSafeEqual(k, b);
  }
  if (!argon2) return false;
  try { return await argon2.verify(ozet, sifre); } catch { return false; }
}

// Şifre kuralı: en az 8 karakter, en az bir harf ve bir rakam.
export function sifreKuraliHatasi(sifre) {
  if (typeof sifre !== 'string' || sifre.length < 8) return 'Şifre en az 8 karakter olmalı';
  if (sifre.length > 200) return 'Şifre çok uzun';
  if (!/[A-Za-zÇĞİÖŞÜçğıöşü]/.test(sifre) || !/\d/.test(sifre)) return 'Şifre en az bir harf ve bir rakam içermeli';
  return null;
}
