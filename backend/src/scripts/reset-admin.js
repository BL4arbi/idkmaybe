// Recovery: sets the password of the built-in "admin" account (e.g. if it was
// changed and forgotten). Run on the server:
//   docker exec tacquet-hub-api npm run reset-admin -- <new password>
import { hashPassword } from '../utils/password.js';
import { pool } from '../db/pool.js';

async function main() {
  const [password] = process.argv.slice(2);
  if (!password || password.length < 6) {
    console.error('Usage: npm run reset-admin -- <new password (6+ characters)>');
    process.exit(1);
  }
  const password_hash = await hashPassword(password);
  const { rowCount } = await pool.query(
    `UPDATE users SET password_hash = $1, is_admin = TRUE, active = TRUE, must_change_password = FALSE
      WHERE username = 'admin'`,
    [password_hash]
  );
  console.log(rowCount ? 'Admin password updated.' : 'No "admin" account found — start the API once to create it.');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
