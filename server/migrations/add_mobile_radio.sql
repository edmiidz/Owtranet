-- Mobile app + Corporate Radio Station
-- Safe to re-run: every statement is IF NOT EXISTS.
-- Apply to EACH instance database.

-- Layer 1 of the radio architecture: one pre-generated, TTS-friendly segment per post.
-- Permission is NOT stored here — the feed joins back to posts and applies the
-- exact same visibility predicate the forum uses (server/lib/postVisibility.js).
CREATE TABLE IF NOT EXISTS radio_segments (
  id INT NOT NULL AUTO_INCREMENT,
  post_id INT NOT NULL,
  headline VARCHAR(255) NOT NULL,
  tts_text TEXT NOT NULL,
  source_hash CHAR(40) NOT NULL COMMENT 'sha1(title+content) at generation time; changes trigger regeneration',
  model VARCHAR(64) DEFAULT NULL,
  word_count INT DEFAULT NULL,
  est_duration_secs INT DEFAULT NULL,
  status ENUM('ready','failed') NOT NULL DEFAULT 'ready',
  error TEXT DEFAULT NULL,
  generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_radio_segments_post (post_id),
  KEY idx_radio_segments_generated (generated_at),
  CONSTRAINT fk_radio_segments_post FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Corporate Radio: TTS-ready summaries of intranet posts';

-- Listening history so the app can resume / skip already-heard segments.
CREATE TABLE IF NOT EXISTS radio_listens (
  id INT NOT NULL AUTO_INCREMENT,
  user_id INT NOT NULL,
  segment_id INT NOT NULL,
  completed TINYINT(1) NOT NULL DEFAULT 1,
  listened_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_radio_listens_user_segment (user_id, segment_id),
  KEY idx_radio_listens_user (user_id, listened_at),
  CONSTRAINT fk_radio_listens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_radio_listens_segment FOREIGN KEY (segment_id) REFERENCES radio_segments(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Registered mobile devices (Expo push tokens) for push notifications.
CREATE TABLE IF NOT EXISTS mobile_devices (
  id INT NOT NULL AUTO_INCREMENT,
  user_id INT NOT NULL,
  platform ENUM('ios','android','web','unknown') NOT NULL DEFAULT 'unknown',
  push_token VARCHAR(255) NOT NULL,
  device_name VARCHAR(255) DEFAULT NULL,
  app_version VARCHAR(50) DEFAULT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mobile_devices_token (push_token),
  KEY idx_mobile_devices_user (user_id, is_active),
  CONSTRAINT fk_mobile_devices_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Push dispatcher high-water marks (which notifications / DMs have been pushed).
CREATE TABLE IF NOT EXISTS mobile_push_state (
  name VARCHAR(50) NOT NULL,
  last_id INT NOT NULL DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
