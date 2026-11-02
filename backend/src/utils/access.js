import { pool } from '../db/pool.js';

// The apps a user may open, with their role inside each one.
export async function appsForUser(userId) {
  const { rows } = await pool.query(
    `SELECT a.key, a.name, a.description, x.role
       FROM user_app_access x
       JOIN apps a ON a.key = x.app_key
      WHERE x.user_id = $1
      ORDER BY a.sort_order, a.name`,
    [userId]
  );
  return rows;
}

export async function allApps() {
  const { rows } = await pool.query(
    'SELECT key, name, description, roles FROM apps ORDER BY sort_order, name'
  );
  return rows;
}
