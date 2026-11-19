// Migration ve seed komutları için. Hedef veritabanı .env'den gelir.
// Çoklu firmada her firma veritabanı için: DB_CLIENT=mssql DATABASE_URL=$DB_YONTEM npm run migrate
import { config } from './src/config.js';
import { knexAyar } from './src/db.js';

export default {
  ...knexAyar(config.db.client, config.db.url, 2),
  migrations: { directory: './migrations', tableName: 'knex_migrations', loadExtensions: ['.js'] },
  seeds: { directory: './seeds', loadExtensions: ['.js'] },
};
