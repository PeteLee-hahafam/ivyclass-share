-- 문제 은행, 숙제, 숙제지, 모의고사, 올린 자료
-- 강의(지문)마다 엔진이 변형 문제를 쌓아 두고(bank_items), 사이트가 숙제와 모의고사, 출력용 숙제지로 나눠 써요.

-- 엔진 작업에 따로 넘길 내용(payload)과 결과(result): 사진 읽기는 강의 없이 하는 작업이에요
ALTER TABLE tasks ADD COLUMN payload TEXT;
ALTER TABLE tasks ADD COLUMN result TEXT;

-- 문제 은행: 문항 하나가 한 줄 (정답과 해설 포함 JSON)
CREATE TABLE IF NOT EXISTS bank_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  lecture_id INTEGER NOT NULL,
  type       TEXT NOT NULL,
  area       TEXT,
  data       TEXT NOT NULL,
  score      INTEGER,
  source     TEXT,
  task_id    INTEGER,
  hidden     INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bank_lecture ON bank_items (lecture_id, hidden);

-- 숙제(사이트에서 풀기): 강의마다 한 묶음을 lectures.homework 에 담아 두고, 학생은 한 번 내요
ALTER TABLE lectures ADD COLUMN homework TEXT;
CREATE TABLE IF NOT EXISTS hw_attempts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  lecture_id INTEGER NOT NULL,
  hw_ver     INTEGER NOT NULL,
  answers    TEXT NOT NULL,
  results    TEXT NOT NULL,
  score      INTEGER NOT NULL,
  total      INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (user_id, lecture_id, hw_ver)
);
CREATE INDEX IF NOT EXISTS idx_hw_lecture ON hw_attempts (lecture_id, hw_ver);

-- 모의고사: 학생이 풀 때마다 은행에서 새로 뽑아요 (items 는 뽑은 문항 id 목록)
CREATE TABLE IF NOT EXISTS mock_attempts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL,
  lecture_id   INTEGER NOT NULL,
  items        TEXT NOT NULL,
  answers      TEXT,
  results      TEXT,
  score        INTEGER,
  total        INTEGER NOT NULL,
  created_at   INTEGER NOT NULL,
  submitted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_mock_user ON mock_attempts (user_id, lecture_id);
CREATE INDEX IF NOT EXISTS idx_mock_lecture ON mock_attempts (lecture_id, submitted_at);

-- 출력용 숙제지: 뽑을 때마다 한 묶음. 정답지와 맞도록 문항을 그대로 담아 둬요
CREATE TABLE IF NOT EXISTS print_sets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  lecture_id INTEGER NOT NULL,
  items      TEXT NOT NULL,
  bank_ids   TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_print_lecture ON print_sets (lecture_id);

-- 올린 자료: 교과서 사진·PDF(지문 읽기, purpose = passage), 선생님 문제 자료(본보기, purpose = seed)
CREATE TABLE IF NOT EXISTS materials (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  lecture_id INTEGER,
  purpose    TEXT NOT NULL,
  name       TEXT,
  mime       TEXT,
  size       INTEGER,
  key        TEXT,
  text       TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_materials_lecture ON materials (lecture_id, purpose);
