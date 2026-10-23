-- 강의실 데이터베이스 구조 (처음 설치)
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS classes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  note       TEXT,
  color      TEXT,
  archived   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  role          TEXT NOT NULL CHECK (role IN ('admin', 'student')),
  login_id      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  pw_hash       TEXT NOT NULL,
  pw_salt       TEXT NOT NULL,
  class_id      INTEGER,
  school        TEXT,
  grade         TEXT,
  memo          TEXT,
  call_name     TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_users_class ON users (class_id);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);

CREATE TABLE IF NOT EXISTS lectures (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  title             TEXT NOT NULL,
  source            TEXT,
  tool              TEXT NOT NULL DEFAULT 'passage',
  passage           TEXT,
  translation       TEXT,
  options           TEXT,
  status            TEXT NOT NULL,
  progress          INTEGER NOT NULL DEFAULT 0,
  progress_msg      TEXT,
  error             TEXT,
  script            TEXT,
  video_key         TEXT,
  note_key          TEXT,
  practice_key      TEXT,
  thumb_key         TEXT,
  duration          REAL,
  video_bytes       INTEGER,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  done_at           INTEGER,
  engine_claimed_at INTEGER,
  voice             TEXT,
  name_slots        TEXT,
  edit              TEXT,
  subtitle_key      TEXT,
  transcript        TEXT,
  summary           TEXT
);
CREATE INDEX IF NOT EXISTS idx_lectures_status ON lectures (status, updated_at);

CREATE TABLE IF NOT EXISTS assignments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  lecture_id INTEGER NOT NULL,
  class_id   INTEGER NOT NULL,
  due_at     INTEGER,
  note       TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (lecture_id, class_id)
);
CREATE INDEX IF NOT EXISTS idx_assign_class ON assignments (class_id);

CREATE TABLE IF NOT EXISTS progress (
  user_id      INTEGER NOT NULL,
  lecture_id   INTEGER NOT NULL,
  bits         TEXT,
  watched      INTEGER NOT NULL DEFAULT 0,
  duration     INTEGER NOT NULL DEFAULT 0,
  percent      INTEGER NOT NULL DEFAULT 0,
  last_pos     REAL NOT NULL DEFAULT 0,
  max_pos      REAL NOT NULL DEFAULT 0,
  views        INTEGER NOT NULL DEFAULT 0,
  started_at   INTEGER,
  updated_at   INTEGER,
  completed_at INTEGER,
  PRIMARY KEY (user_id, lecture_id)
);
CREATE INDEX IF NOT EXISTS idx_progress_lecture ON progress (lecture_id);

CREATE TABLE IF NOT EXISTS login_attempts (
  key      TEXT PRIMARY KEY,
  count    INTEGER NOT NULL,
  first_at INTEGER NOT NULL
);

-- 학원 PC 엔진이 처리할 작은 작업 (자막 만들기, 요약·연습지 만들기)
CREATE TABLE IF NOT EXISTS tasks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT NOT NULL,
  lecture_id   INTEGER,
  status       TEXT NOT NULL,
  progress     INTEGER NOT NULL DEFAULT 0,
  progress_msg TEXT,
  error        TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  claimed_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status, created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_lecture ON tasks (lecture_id);

-- 학생 이름을 부르는 짧은 목소리 (목소리·말투마다 하나)
CREATE TABLE IF NOT EXISTS name_clips (
  user_id    INTEGER NOT NULL,
  voice      TEXT NOT NULL,
  key        TEXT NOT NULL,
  text       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, voice)
);
