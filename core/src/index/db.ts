import Database from "better-sqlite3";
import { existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname } from "node:path";

export type DB = Database.Database;

export const SCHEMA_VERSION = 2; // v2: FTS tokenizer unicode61 → trigram (CJK substring search)

const FTS_DDL = `CREATE VIRTUAL TABLE message_fts USING fts5(
  session_path UNINDEXED, role UNINDEXED, source_type UNINDEXED, search_text,
  content='message_entries', content_rowid='rowid_pk', tokenize='trigram'
)`;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_meta (
  id INTEGER PRIMARY KEY CHECK(id=1),
  schema_version INTEGER NOT NULL,
  app_version TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  session_path   TEXT PRIMARY KEY,
  session_id     TEXT NOT NULL,
  provider_slug  TEXT NOT NULL,
  source         TEXT NOT NULL DEFAULT 'cli'
                 CHECK(source IN ('cli','app-code','app-web','db-backed','vm')),
  workspace      TEXT,
  project_root   TEXT,
  title          TEXT,
  title_source   TEXT,
  last_prompt    TEXT,
  summary        TEXT,
  model_name     TEXT,
  rounds         INTEGER NOT NULL DEFAULT 0,
  message_count  INTEGER NOT NULL DEFAULT 0,
  started_at     INTEGER,
  ended_at       INTEGER,
  input_tokens   INTEGER,
  output_tokens  INTEGER,
  cli_session_id TEXT,
  metadata_json  TEXT NOT NULL DEFAULT '{}',
  indexed_at     TEXT NOT NULL,
  fts_indexed    INTEGER -- 1 once message-content FTS has processed this session (NULL = pending)
);
CREATE INDEX IF NOT EXISTS idx_sessions_ended_at    ON sessions(ended_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_project_root ON sessions(project_root);
CREATE INDEX IF NOT EXISTS idx_sessions_provider    ON sessions(provider_slug);
CREATE INDEX IF NOT EXISTS idx_sessions_id          ON sessions(session_id);

CREATE TABLE IF NOT EXISTS scan_state (
  session_path       TEXT PRIMARY KEY,
  backing_path       TEXT NOT NULL,
  provider_slug      TEXT NOT NULL,
  file_modified      INTEGER NOT NULL,
  file_size          INTEGER NOT NULL,
  last_scanned_at    INTEGER NOT NULL,
  last_parse_status  TEXT NOT NULL,
  read_offset        INTEGER NOT NULL DEFAULT 0,
  append_trust_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS message_entries (
  rowid_pk     INTEGER PRIMARY KEY,
  session_path TEXT NOT NULL,
  idx          INTEGER NOT NULL,
  native_id    TEXT,
  role         TEXT NOT NULL,
  source_type  TEXT NOT NULL DEFAULT 'text',
  content      TEXT NOT NULL,
  search_text  TEXT NOT NULL DEFAULT '',
  timestamp    INTEGER,
  is_sidechain INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_me_session_idx ON message_entries(session_path, idx);

CREATE VIRTUAL TABLE IF NOT EXISTS message_fts USING fts5(
  session_path UNINDEXED, role UNINDEXED, source_type UNINDEXED, search_text,
  content='message_entries', content_rowid='rowid_pk', tokenize='trigram'
);

CREATE TABLE IF NOT EXISTS favorites ( session_path TEXT PRIMARY KEY, created_at TEXT NOT NULL );
CREATE TABLE IF NOT EXISTS tags ( id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE );
CREATE TABLE IF NOT EXISTS session_tags (
  session_path TEXT NOT NULL, tag_id INTEGER NOT NULL,
  PRIMARY KEY (session_path, tag_id),
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);
`;

function applyPragmas(db: DB): void {
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 10000");
  db.pragma("foreign_keys = ON");
  db.pragma("temp_store = MEMORY");
}

function ensureSchema(db: DB, appVersion: string): void {
  db.exec(SCHEMA);
  // Additive column migration (sessions table is CREATE IF NOT EXISTS, so older DBs lack newer cols).
  try {
    db.exec("ALTER TABLE sessions ADD COLUMN fts_indexed INTEGER");
  } catch {
    /* column already present */
  }
  const row = db.prepare("SELECT schema_version FROM schema_meta WHERE id=1").get() as
    | { schema_version: number }
    | undefined;
  if (!row) {
    db.prepare(
      "INSERT INTO schema_meta (id, schema_version, app_version, updated_at) VALUES (1, ?, ?, ?)",
    ).run(SCHEMA_VERSION, appVersion, new Date().toISOString());
  } else if (row.schema_version > SCHEMA_VERSION) {
    // downgrade guard: a newer DB shape — caller should treat as rebuildable cache.
    throw new Error(`db schema ${row.schema_version} is newer than supported ${SCHEMA_VERSION}`);
  } else if (row.schema_version < SCHEMA_VERSION) {
    // index is a disposable cache: rebuild the FTS index (external-content, regenerable) with the
    // current tokenizer instead of a data migration.
    db.exec("DROP TABLE IF EXISTS message_fts");
    db.exec(FTS_DDL);
    db.exec("INSERT INTO message_fts(message_fts) VALUES('rebuild')");
    db.prepare("UPDATE schema_meta SET schema_version = ?, app_version = ?, updated_at = ? WHERE id = 1").run(
      SCHEMA_VERSION,
      appVersion,
      new Date().toISOString(),
    );
  }
}

/** Open the index DB. The index is a disposable cache: on corruption/downgrade we move it aside and rebuild. */
export function openDb(path: string, appVersion = "0.0.0"): DB {
  mkdirSync(dirname(path), { recursive: true });
  const open = (): DB => {
    const db = new Database(path);
    applyPragmas(db);
    ensureSchema(db, appVersion);
    return db;
  };
  try {
    return open();
  } catch (e) {
    if (existsSync(path)) {
      const aside = `${path}.corrupted.${Date.now()}`;
      try {
        renameSync(path, aside);
      } catch {
        /* best effort */
      }
      // eslint-disable-next-line no-console
      console.warn(`[agent-summa] index unusable (${String(e)}); rebuilt from scratch (old → ${aside})`);
    }
    return open();
  }
}
