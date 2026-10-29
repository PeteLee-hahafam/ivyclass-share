-- 시험: 선생님이 확인 문제와 문제 은행에서 골라 만든 문제 묶음이에요. 인쇄하거나 반에 내서 학생 앱에서 풀어요
-- items 에는 정답과 해설까지 문항을 그대로 담아 둬요 {v, ver, items}. 원래 문제가 바뀌거나 지워져도 시험지와 채점은 그대로예요
-- lecture_ids, bank_ids: 문제를 가져온 강의와 은행 문항 id 목록 (숙제지와 모의고사에 같은 문제가 나오지 않게)
-- reveal: 학생이 낸 뒤 정답과 해설을 보여 줄지 (1 바로 보여 줘요, 0 점수만)
CREATE TABLE IF NOT EXISTS exams (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  items       TEXT NOT NULL,
  lecture_ids TEXT,
  bank_ids    TEXT,
  reveal      INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- 시험을 낸 반: 그 반 학생 앱에 나타나요. closed_at 이 있으면 더 풀 수 없어요 (낸 점수는 그대로)
CREATE TABLE IF NOT EXISTS exam_classes (
  exam_id    INTEGER NOT NULL,
  class_id   INTEGER NOT NULL,
  due_at     INTEGER,
  created_at INTEGER NOT NULL,
  closed_at  INTEGER,
  PRIMARY KEY (exam_id, class_id)
);
CREATE INDEX IF NOT EXISTS idx_exam_classes_class ON exam_classes (class_id);

-- 시험 답안: 학생이 앱에서 낸 것, 또는 선생님이 넣은 종이 답안(by_teacher = 1). 학생마다 하나예요
CREATE TABLE IF NOT EXISTS exam_attempts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id    INTEGER NOT NULL,
  user_id    INTEGER NOT NULL,
  answers    TEXT NOT NULL,
  results    TEXT NOT NULL,
  score      INTEGER NOT NULL,
  total      INTEGER NOT NULL,
  by_teacher INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (exam_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_exam_attempts_user ON exam_attempts (user_id);
