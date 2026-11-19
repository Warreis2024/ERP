// .env dosyası (yerel/IIS). Vercel'de ortam değişkenleri platformdan gelir.
try { await import('dotenv/config'); } catch { /* dotenv yoksa yalnız ortam değişkenleri */ }

const s = (k, v = '') => (process.env[k] ?? v).toString().trim();
const n = (k, v) => { const x = Number(process.env[k]); return Number.isFinite(x) && x > 0 ? x : v; };

export const config = {
  mod: s('MOD', 'tek') === 'coklu' ? 'coklu' : 'tek',
  firmaSub: s('FIRMA_SUB', 'yontem'),
  firmaAd: s('FIRMA_AD', 'Firma'),
  anaAlan: s('ANA_ALAN', 'iq-sense.com.tr').toLowerCase(),
  db: { client: s('DB_CLIENT', 'pg'), url: s('DATABASE_URL'), havuzMax: n('DB_HAVUZ_MAX', 5) },
  katalog: { client: s('KATALOG_DB_CLIENT', 'mssql'), url: s('KATALOG_DATABASE_URL') },
  oturum: {
    gizli: s('OTURUM_GIZLI'),
    saat: n('OTURUM_SAAT', 12),
    hatirlaGun: n('HATIRLA_GUN', 30),
    guvenliCerez: s('GUVENLI_CEREZ', 'true') !== 'false',
  },
  depo: {
    tur: s('DEPO', 'disk'),
    klasor: s('DEPO_KLASOR', './yuklemeler'),
    supabaseUrl: s('SUPABASE_URL'),
    supabaseKey: s('SUPABASE_SERVICE_KEY'),
    bucket: s('SUPABASE_BUCKET', 'erp-dosyalar'),
  },
  port: n('PORT', 3000),
  uretim: s('NODE_ENV') === 'production' || !!process.env.VERCEL,
};

export function configDenetle() {
  const hatalar = [];
  if (!config.oturum.gizli || config.oturum.gizli.length < 32 || /DEGISTIR/.test(config.oturum.gizli))
    hatalar.push('OTURUM_GIZLI en az 32 karakterlik rastgele bir değer olmalı.');
  if (config.mod === 'tek' && !config.db.url) hatalar.push('DATABASE_URL tanımlı değil.');
  if (config.mod === 'coklu' && !config.katalog.url) hatalar.push('KATALOG_DATABASE_URL tanımlı değil.');
  if (!['pg', 'mssql'].includes(config.db.client)) hatalar.push('DB_CLIENT pg ya da mssql olmalı.');
  return hatalar;
}
