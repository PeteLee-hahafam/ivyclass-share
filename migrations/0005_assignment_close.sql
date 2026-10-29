-- 과제 정리: 선생님이 끝난 과제를 목록에서 지운 때. 학생 앱은 그대로예요 (다 본 학생은 '다 본 강의'에서 다시 볼 수 있어요)
-- 같은 강의를 그 반에 다시 내면 비워져서 다시 목록에 나와요
ALTER TABLE assignments ADD COLUMN closed_at INTEGER;
