import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';
import { hashPassword } from '../utils/password.js';
import { pool } from './pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Built-in admin account, created only when the Hub has no admin at all.
const DEFAULT_ADMIN = { username: 'admin', password: 'admin123' };

// First start on a server: the Hub's own database doesn't exist yet. Create
// it (and only it) through the server's default "postgres" database.
async function ensureDatabase() {
  try {
    await pool.query('SELECT 1');
  } catch (err) {
    if (err.code !== '3D000') throw err; // 3D000 = database does not exist
    const url = new URL(process.env.DATABASE_URL);
    const name = url.pathname.slice(1);
    if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Invalid database name: ${name}`);
    url.pathname = '/postgres';
    const admin = new pg.Client({ connectionString: url.toString() });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${name}`);
    await admin.end();
    console.log(`Database ${name} created.`);
  }
}

async function migrate() {
  await ensureDatabase();
  const sql = readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('Schema applied.');

  const { rows } = await pool.query('SELECT 1 FROM users WHERE is_admin LIMIT 1');
  if (!rows.length) {
    const password_hash = await hashPassword(DEFAULT_ADMIN.password);
    const { rows: created } = await pool.query(
      `INSERT INTO users (full_name, username, password_hash, is_admin, must_change_password)
       VALUES ('Administrateur', $1, $2, TRUE, FALSE)
       ON CONFLICT (username) DO UPDATE SET is_admin = TRUE, active = TRUE
       RETURNING id`,
      [DEFAULT_ADMIN.username, password_hash]
    );
    // The admin gets every app, with the highest role in each.
    await pool.query(
      `INSERT INTO user_app_access (user_id, app_key, role)
       SELECT $1, key, roles[array_length(roles, 1)] FROM apps
       ON CONFLICT (user_id, app_key) DO NOTHING`,
      [created[0].id]
    );
    console.log(`Default admin account created: ${DEFAULT_ADMIN.username}`);
  }
  await pool.end();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
