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
-- `title`/`artist` are captured from the recommendation at feedback time so the
-- taste profile can name the artists the user liked/disliked (recs aren't in
-- library_songs, so there's nothing to join against). Nullable: older rows and
-- library-sourced feedback may not carry them. Existing deployments need a
-- one-time `ALTER TABLE feedback_events ADD COLUMN title TEXT` / `... artist
-- TEXT` since CREATE IF NOT EXISTS won't migrate the live table.
CREATE TABLE IF NOT EXISTS feedback_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  song_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT,
  artist TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback_events(user_id);

-- Phase 4: a snapshot of the derived taste profile each time it drives a chat,
-- for observability and the before/after demo. `profile_json` is the serialized
-- TasteProfile that was injected into that request's prompt.
CREATE TABLE IF NOT EXISTS taste_profile_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  profile_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_taste_snapshots_user ON taste_profile_snapshots(user_id);

-- Phase 3.5: append-only log of in-app playback signal (full plays, early
-- skips, repeats). Kept separate from feedback_events so passive listen signal
-- stays distinct from explicit like/dislike/add; Phase 4's taste profile can
-- opt into consuming it later. `kind` is 'play_complete' | 'skip' | 'repeat'
-- (validated in the route, not via CHECK, to match the rest of this schema).
-- `title`/`artist` mirror feedback_events so the signal can name the track.
-- `ms_played` is how long the track played before the signal fired.
CREATE TABLE IF NOT EXISTS listen_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  song_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT,
  artist TEXT,
  ms_played INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_listen_events_user ON listen_events(user_id);
