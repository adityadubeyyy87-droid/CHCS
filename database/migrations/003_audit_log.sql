-- Migration 003: Add audit_log table for camp-day accountability.
-- Append-only log of who changed which booking or camp, and when.
CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_id    BIGINT UNSIGNED NULL,
  actor_name  VARCHAR(190) NULL,
  action      VARCHAR(60) NOT NULL,
  target_type VARCHAR(40) NOT NULL,
  target_id   BIGINT UNSIGNED NULL,
  `before`    JSON NULL,
  `after`     JSON NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_audit_actor (actor_id, created_at),
  KEY idx_audit_target (target_type, target_id, created_at),
  KEY idx_audit_action (action, created_at),
  CONSTRAINT fk_audit_actor FOREIGN KEY (actor_id) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
