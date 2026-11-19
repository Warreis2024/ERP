// Veritabanı bağlantıları. PostgreSQL (Supabase) ve MS SQL aynı Knex arayüzünden kullanılır.
// Progress OpenEdge ileride ayrı bir adaptör olarak eklenecek (ODBC).
import knexPkg from 'knex';
import { config } from './config.js';

const knex = knexPkg.default || knexPkg;
const havuz = new Map(); // anahtar → knex örneği (firma başına bir bağlantı havuzu)

// mssql://kullanici:sifre@sunucu:1433/veritabani?encrypt=true&trustServerCertificate=true&instanceName=SQLEXPRESS
export function mssqlAyristir(url) {
  const u = new URL(url);
  const q = u.searchParams;
  const evet = (k, v) => (q.has(k) ? q.get(k) === 'true' : v);
  return {
    server: u.hostname,
    port: u.port ? Number(u.port) : 1433,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.replace(/^\//, '')),
    options: {
      encrypt: evet('encrypt', true),
      trustServerCertificate: evet('trustServerCertificate', false),
      ...(q.get('instanceName') ? { instanceName: q.get('instanceName') } : {}),
    },
  };
}

export function knexAyar(client, url, havuzMax = config.db.havuzMax) {
  if (client === 'mssql') {
    return { client: 'mssql', connection: mssqlAyristir(url), pool: { min: 0, max: havuzMax } };
  }
  return {
    client: 'pg',
    connection: { connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } },
    pool: { min: 0, max: havuzMax },
  };
}

export function baglanti(anahtar, client, url) {
  if (!havuz.has(anahtar)) havuz.set(anahtar, knex(knexAyar(client, url)));
  return havuz.get(anahtar);
}

export async function hepsiniKapat() {
  await Promise.all([...havuz.values()].map((k) => k.destroy().catch(() => {})));
  havuz.clear();
}

// JSON alanları her iki veritabanında da metin olarak tutulur (taşınabilirlik).
export const json = {
  yaz: (v) => (v === undefined || v === null ? null : JSON.stringify(v)),
  oku: (v, vars = null) => { if (v === null || v === undefined || v === '') return vars; try { return JSON.parse(v); } catch { return vars; } },
};

// Tarih-saat: veritabanında UTC, API'de ISO metin.
export const zaman = {
  simdi: () => new Date(),
  iso: (d) => (d ? new Date(d).toISOString() : null),
};
