CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('applicant','officer','registrar','cashier','finaid','dpo','admin')),
  pass_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS applicants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
  surname TEXT NOT NULL,
  first_name TEXT NOT NULL,
  email TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('SHS','College')),
  program TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'applied' CHECK (stage IN ('applied','reserved','complete','enrolled')),
  dedup_key TEXT NOT NULL UNIQUE,
  enc TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS consents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  applicant_id INTEGER REFERENCES applicants(id),
  ticket_id INTEGER REFERENCES tickets(id),
  statement_version TEXT NOT NULL,
  statement_text TEXT NOT NULL,
  purpose TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  applicant_id INTEGER REFERENCES applicants(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'simple' CHECK (tier IN ('simple','complex','technical')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  assignee_id INTEGER REFERENCES users(id),
  closing_remark TEXT,
  escalated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);
CREATE TABLE IF NOT EXISTS requirement_types (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('SHS','College','Both')),
  deadline_days INTEGER NOT NULL DEFAULT 14
);
CREATE TABLE IF NOT EXISTS requirements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  applicant_id INTEGER NOT NULL REFERENCES applicants(id),
  doc_code TEXT NOT NULL,
  label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','received','rejected')),
  deadline TEXT NOT NULL,
  note TEXT,
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (applicant_id, doc_code)
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  applicant_id INTEGER NOT NULL UNIQUE REFERENCES applicants(id),
  amount REAL NOT NULL,
  or_number TEXT NOT NULL UNIQUE,
  validated_by INTEGER NOT NULL REFERENCES users(id),
  validated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS notices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  applicant_id INTEGER NOT NULL REFERENCES applicants(id),
  body TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS aid_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  applicant_id INTEGER NOT NULL REFERENCES applicants(id),
  program_code TEXT NOT NULL,
  program_name TEXT NOT NULL,
  amount TEXT NOT NULL,
  documents TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'endorsed',
  endorsed_by INTEGER REFERENCES users(id),
  endorsed_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (applicant_id, program_code)
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  applicant_id INTEGER REFERENCES applicants(id),
  action TEXT NOT NULL,
  purpose TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS holidays (
  day TEXT PRIMARY KEY,
  label TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status, created_at);
CREATE INDEX IF NOT EXISTS idx_req_applicant ON requirements(applicant_id);
CREATE INDEX IF NOT EXISTS idx_audit_applicant ON audit_log(applicant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(created_at);
INSERT OR IGNORE INTO requirement_types (code, label, level, deadline_days) VALUES
  ('PSA','PSA Birth Certificate','Both',14),
  ('CARD','Report Card (Form 138)','Both',14),
  ('GMC','Certificate of Good Moral Character','Both',21),
  ('PHOTO','2x2 ID Photo','Both',7);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS login_attempts (
  email TEXT PRIMARY KEY COLLATE NOCASE,
  fails INTEGER NOT NULL DEFAULT 0,
  first_at TEXT NOT NULL DEFAULT (datetime('now'))
);
