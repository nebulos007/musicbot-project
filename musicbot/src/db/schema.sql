-- D1 schema for musicbot.
-- Applied via: wrangler d1 execute musicbot --file=src/db/schema.sql
-- Times are stored as INTEGER unix epoch seconds.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  tidal_user_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS library_songs (
  user_id TEXT NOT NULL,
  song_id TEXT NOT NULL,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  album TEXT,
  album_art_url TEXT,
  added_at INTEGER NOT NULL,
  synced_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, song_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_library_songs_user ON library_songs(user_id);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- Append-only log of explicit feedback. One row per action; Phase 4's taste
-- profile aggregates these. `kind` is 'like' | 'dislike' | 'add' (validated in
-- the route, not via CHECK, to match the rest of this schema).
CREATE TABLE IF NOT EXISTS feedback_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  song_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback_events(user_id);
