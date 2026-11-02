-- Tacquet Hub schema. Idempotent: safe to run on every start.

CREATE TABLE IF NOT EXISTS users (
  id                   SERIAL PRIMARY KEY,
  full_name            TEXT NOT NULL,
  -- What people type to sign in: their company email, or a short name such
  -- as the built-in "admin" account.
  username             TEXT NOT NULL UNIQUE,
  company_email        TEXT UNIQUE,
  password_hash        TEXT NOT NULL,
  is_admin             BOOLEAN NOT NULL DEFAULT FALSE,
  active               BOOLEAN NOT NULL DEFAULT TRUE,
  -- Accounts are created (or reset) by an admin with a temporary password,
  -- which the user has to replace at their next login.
  must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at        TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The tools the Hub can open. `roles` lists the roles that make sense inside
-- each tool (they mirror the roles the tools already use on their own side).
CREATE TABLE IF NOT EXISTS apps (
  key         TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  roles       TEXT[] NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0
);

INSERT INTO apps (key, name, description, roles, sort_order) VALUES
  ('measure', 'Tacquet Measure',         'Mesure sur plan',                       ARRAY['user'],                1),
  ('qhse',    'QHSE',                    'Formations, habilitations, EPI, visites', ARRAY['user', 'admin'],     2),
  ('tracker', 'SolidWorks Team Tracker', 'Suivi des chantiers et des pièces',     ARRAY['engineer', 'manager'], 3)
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  roles = EXCLUDED.roles,
  sort_order = EXCLUDED.sort_order;

-- One row = this user can open this app, with this role inside it.
CREATE TABLE IF NOT EXISTS user_app_access (
  user_id INT  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app_key TEXT NOT NULL REFERENCES apps(key) ON DELETE CASCADE,
  role    TEXT NOT NULL,
  PRIMARY KEY (user_id, app_key)
);

CREATE TABLE IF NOT EXISTS tickets (
  id              SERIAL PRIMARY KEY,
  user_id         INT  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- NULL = the problem is about the Hub itself, not one of the tools.
  app_key         TEXT REFERENCES apps(key) ON DELETE SET NULL,
  hub_version     TEXT,
  title           TEXT NOT NULL,
  description     TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open', 'in_progress', 'fixed', 'closed')),
  priority        TEXT NOT NULL DEFAULT 'normal'
                  CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  screenshot_path TEXT,
  diagnostics     JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tickets_user_idx   ON tickets (user_id);
CREATE INDEX IF NOT EXISTS tickets_status_idx ON tickets (status);

CREATE TABLE IF NOT EXISTS ticket_messages (
  id         SERIAL PRIMARY KEY,
  ticket_id  INT  NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id    INT  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ticket_messages_ticket_idx ON ticket_messages (ticket_id);
