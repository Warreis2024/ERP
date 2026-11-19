// Yalnız PostgreSQL / Supabase: Supabase'in herkese açık Data API'si (anon / authenticated rolleri)
// public şemasındaki tabloları okuyabilir. Bütün tablolarda RLS açılır ve bu rollerin yetkisi kaldırılır.
// Uygulama kendi Node API'si üzerinden tablo sahibi rolle bağlandığı için etkilenmez.
// MS SQL'de bu adım atlanır.

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  if (knex.client.config.client !== 'pg') return;
  const roller = await knex.raw("select rolname from pg_roles where rolname in ('anon','authenticated')");
  const tablolar = await knex.raw("select tablename from pg_tables where schemaname = 'public'");
  for (const { tablename } of tablolar.rows) await knex.raw('alter table public.?? enable row level security', [tablename]);
  if (roller.rows.length < 2) return; // Supabase değil
  for (const s of ['tables', 'sequences', 'functions']) {
    await knex.raw(`revoke all on all ${s} in schema public from anon, authenticated`);
    await knex.raw(`alter default privileges in schema public revoke all on ${s} from anon, authenticated`);
  }
}

/** @param {import('knex').Knex} knex */
export async function down() { /* güvenlik ayarı geri alınmaz */ }
