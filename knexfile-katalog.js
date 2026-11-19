import { config } from './src/config.js';
import { knexAyar } from './src/db.js';

export default {
  ...knexAyar(config.katalog.client, config.katalog.url, 2),
  migrations: { directory: './migrations-katalog', tableName: 'knex_migrations', loadExtensions: ['.js'] },
};
