-- A failed CHECK in a D1 batch aborts the entire write sequence.
-- Writers use this to turn a failed conditional precondition into rollback.
CREATE TABLE "__WriteGuard" (
  "ok" INTEGER NOT NULL CHECK ("ok" = 1)
);
