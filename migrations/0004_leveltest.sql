-- 영어 레벨테스트: 링크로 들어온 학생(처음 오는 학생, 재원생)이 응시한 기록
-- 진행 상태와 답(state)을 통째로 담아 두고, 분석과 리포트는 볼 때마다 다시 계산해요 (src/lt/flow.js, core.js)

CREATE TABLE IF NOT EXISTS lt_sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash  TEXT NOT NULL UNIQUE,
  user_id     INTEGER,
  kind        TEXT NOT NULL DEFAULT 'new',
  name        TEXT NOT NULL,
  grade       INTEGER NOT NULL,
  school      TEXT,
  phone       TEXT,
  state       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'running',
  summary     TEXT,
  comment     TEXT,
  ip_hash     TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  finished_at INTEGER,
  seen_at     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_lt_created ON lt_sessions (created_at);
CREATE INDEX IF NOT EXISTS idx_lt_ip ON lt_sessions (ip_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_lt_user ON lt_sessions (user_id, finished_at);
