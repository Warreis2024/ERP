// İlk yöneticiyi oluşturur ya da şifresini sıfırlar (seed çalıştırmadan, boş veritabanında).
//   npm run admin                       → .env'deki ADMIN_EPOSTA / ADMIN_SIFRE
// Kullanıcı ilk girişte şifresini değiştirmek zorundadır.
import crypto from 'node:crypto';
import knexPkg from 'knex';
import { config } from '../src/config.js';
import { knexAyar } from '../src/db.js';
import { sifreOzetle } from '../src/auth/sifre.js';

const knex = (knexPkg.default || knexPkg)(knexAyar(config.db.client, config.db.url, 1));
const eposta = (process.env.ADMIN_EPOSTA || 'admin@iq-sense.com.tr').toLowerCase();
const sifre = process.env.ADMIN_SIFRE || 'admin123';

try {
  const ozet = await sifreOzetle(sifre);
  const var_ = await knex('kullanicilar').where({ eposta }).first();
  if (var_) {
    await knex('kullanicilar').where({ id: var_.id }).update({ sifre_ozet: ozet, sifre_degismeli: true, aktif: true, rol: 'yonetici', hatali: 0, kilit: null, oturum_surumu: var_.oturum_surumu + 1 });
    console.log(`Yönetici şifresi sıfırlandı: ${eposta}`);
  } else {
    if (!(await knex('yetki_gruplari').where({ id: 'g-yon' }).first())) await knex('yetki_gruplari').insert({ id: 'g-yon', ad: 'Yönetim', sira: 0 });
    await knex('kullanicilar').insert({ id: crypto.randomUUID(), ad: 'Sistem Yöneticisi', unvan: 'IQ-Sense', eposta, rol: 'yonetici', grup_id: 'g-yon', aktif: true, sistem: true, sifre_ozet: ozet, sifre_degismeli: true, olusturma: new Date() });
    console.log(`Yönetici oluşturuldu: ${eposta}`);
  }
} finally { await knex.destroy(); }
