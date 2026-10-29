-- 확인 문제: 강의를 듣고 푸는 25문항 (엔진이 만들어요)
-- lectures.quiz 에는 정답까지 든 문제가, quiz_attempts 에는 학생이 낸 답과 채점이 들어가요.
ALTER TABLE lectures ADD COLUMN quiz TEXT;

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  lecture_id INTEGER NOT NULL,
  quiz_ver   INTEGER NOT NULL,
  answers    TEXT NOT NULL,
  results    TEXT NOT NULL,
  score      INTEGER NOT NULL,
  total      INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (user_id, lecture_id, quiz_ver)
);
CREATE INDEX IF NOT EXISTS idx_quiz_lecture ON quiz_attempts (lecture_id, quiz_ver);
