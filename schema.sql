-- ═══════════════════════════════════════════════════════════════════════
--  جامعة v5.0 — Supabase Database Schema
--  نفِّذ هذا الملف في Supabase SQL Editor قبل تشغيل البوت
-- ═══════════════════════════════════════════════════════════════════════

-- ══ إذا كانت قاعدة البيانات موجودة مسبقاً، نفّذ هذا أولاً لإزالة FK القديم ══
-- ALTER TABLE group_members DROP CONSTRAINT IF EXISTS group_members_chat_id_fkey;
-- ═════════════════════════════════════════════════════════════════════════════

-- ── تفعيل pg_cron (اختياري — من Dashboard → Database → Extensions)
-- SELECT cron.schedule('cleanup-expired-captcha', '* * * * *',
--   $$DELETE FROM pending_captcha WHERE expires_at < NOW()$$
-- );

-- ─────────────────────────────────────────────────────────────
-- 1. GROUPS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS groups (
  chat_id                BIGINT      PRIMARY KEY,
  title                  TEXT        NOT NULL DEFAULT '',
  type                   TEXT        NOT NULL DEFAULT 'group',
  owner_id               BIGINT,
  owner_username         TEXT        DEFAULT '',
  owner_verified         BOOLEAN     DEFAULT FALSE,
  owner_verified_at      TIMESTAMPTZ,
  added_by               BIGINT      DEFAULT 0,
  added_by_username      TEXT        DEFAULT '',
  added_at               TIMESTAMPTZ DEFAULT NOW(),
  updated_at             TIMESTAMPTZ DEFAULT NOW(),
  -- Settings
  max_warns              INTEGER     DEFAULT 3,
  welcome_message        TEXT        DEFAULT '👋 مرحباً {name} في {group}!',
  welcome_enabled        BOOLEAN     DEFAULT TRUE,
  anti_spam              BOOLEAN     DEFAULT FALSE,
  mute_new_members       BOOLEAN     DEFAULT FALSE,
  join_requests_enabled  BOOLEAN     DEFAULT FALSE,
  protect_content        BOOLEAN     DEFAULT FALSE,
  anti_links             BOOLEAN     DEFAULT FALSE,
  anti_bot               BOOLEAN     DEFAULT FALSE,
  captcha_enabled        BOOLEAN     DEFAULT FALSE,
  log_channel_id         BIGINT,
  rules                  TEXT        DEFAULT '',
  community_id           BIGINT,
  slow_mode              INTEGER     DEFAULT 0,
  -- Permissions
  perm_send_messages     BOOLEAN     DEFAULT TRUE,
  perm_send_media        BOOLEAN     DEFAULT TRUE,
  perm_send_polls        BOOLEAN     DEFAULT TRUE,
  perm_web_previews      BOOLEAN     DEFAULT TRUE,
  perm_invite_users      BOOLEAN     DEFAULT TRUE,
  perm_pin_messages      BOOLEAN     DEFAULT FALSE,
  perm_manage_topics     BOOLEAN     DEFAULT FALSE,
  -- Topic Settings
  topic_require_approval BOOLEAN     DEFAULT FALSE,
  topic_auto_lock        BOOLEAN     DEFAULT FALSE,
  topic_owner_bypass     BOOLEAN     DEFAULT TRUE
);

-- ─────────────────────────────────────────────────────────────
-- 2. GROUP MEMBERS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS group_members (
  id              BIGSERIAL   PRIMARY KEY,
  chat_id         BIGINT      NOT NULL,
  user_id         BIGINT      NOT NULL,
  username        TEXT        DEFAULT '',
  first_name      TEXT        DEFAULT '',
  role            TEXT        DEFAULT 'member',
  joined_at       TIMESTAMPTZ DEFAULT NOW(),
  message_count   INTEGER     DEFAULT 0,
  score           INTEGER     DEFAULT 0,
  last_message_at TIMESTAMPTZ,
  UNIQUE(chat_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_group_members_chat ON group_members(chat_id);
CREATE INDEX IF NOT EXISTS idx_group_members_score ON group_members(chat_id, score DESC);

-- دالة لزيادة عداد الرسائل والنقاط
CREATE OR REPLACE FUNCTION increment_member_stats(p_chat_id BIGINT, p_user_id BIGINT)
RETURNS VOID AS $$
BEGIN
  UPDATE group_members
  SET
    message_count   = message_count + 1,
    score           = score + 1,
    last_message_at = NOW()
  WHERE chat_id = p_chat_id AND user_id = p_user_id;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────────
-- 3. GROUP ADMINS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS group_admins (
  id                  BIGSERIAL   PRIMARY KEY,
  chat_id             BIGINT      NOT NULL REFERENCES groups(chat_id) ON DELETE CASCADE,
  user_id             BIGINT      NOT NULL,
  username            TEXT        DEFAULT '',
  promoted_by         BIGINT,
  promoted_by_username TEXT       DEFAULT '',
  promoted_at         TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(chat_id, user_id)
);

-- ─────────────────────────────────────────────────────────────
-- 4. WARNS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS warns (
  id         BIGSERIAL   PRIMARY KEY,
  chat_id    BIGINT      NOT NULL,
  user_id    BIGINT      NOT NULL,
  reason     TEXT        DEFAULT '',
  warned_by  BIGINT      DEFAULT 0,
  warned_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_warns_chat_user ON warns(chat_id, user_id);

-- ─────────────────────────────────────────────────────────────
-- 5. RESTRICTIONS (timed mute/ban)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS restrictions (
  id          BIGSERIAL   PRIMARY KEY,
  chat_id     BIGINT      NOT NULL,
  user_id     BIGINT      NOT NULL,
  type        TEXT        NOT NULL, -- 'timed_mute' | 'timed_ban'
  until_date  TIMESTAMPTZ,
  by_user_id  BIGINT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(chat_id, user_id, type)
);
CREATE INDEX IF NOT EXISTS idx_restrictions_until ON restrictions(until_date);

-- ─────────────────────────────────────────────────────────────
-- 6. BANNED WORDS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS banned_words (
  id        BIGSERIAL   PRIMARY KEY,
  chat_id   BIGINT      NOT NULL,
  word      TEXT        NOT NULL,
  action    TEXT        DEFAULT 'warn', -- 'warn'|'mute'|'kick'|'ban'
  threshold INTEGER     DEFAULT 1,
  added_by  BIGINT      DEFAULT 0,
  added_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(chat_id, word)
);

-- ─────────────────────────────────────────────────────────────
-- 7. WORD VIOLATIONS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS word_violations (
  id        BIGSERIAL PRIMARY KEY,
  chat_id   BIGINT    NOT NULL,
  user_id   BIGINT    NOT NULL,
  word      TEXT      NOT NULL,
  count     INTEGER   DEFAULT 1,
  UNIQUE(chat_id, user_id, word)
);

-- ─────────────────────────────────────────────────────────────
-- 8. JOIN REQUESTS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS join_requests (
  id           BIGSERIAL   PRIMARY KEY,
  chat_id      BIGINT      NOT NULL,
  user_id      BIGINT      NOT NULL,
  first_name   TEXT        DEFAULT '',
  username     TEXT        DEFAULT '',
  bio          TEXT        DEFAULT '',
  invite_link  TEXT        DEFAULT '',
  status       TEXT        DEFAULT 'pending', -- 'pending'|'approved'|'rejected'|'rejected_community'
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  processed_by BIGINT,
  UNIQUE(chat_id, user_id)
);

-- ─────────────────────────────────────────────────────────────
-- 9. JOIN REQUEST COOLDOWNS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS join_request_cooldowns (
  id         BIGSERIAL   PRIMARY KEY,
  chat_id    BIGINT      NOT NULL,
  user_id    BIGINT      NOT NULL,
  until_date TIMESTAMPTZ NOT NULL,
  UNIQUE(chat_id, user_id)
);

-- ─────────────────────────────────────────────────────────────
-- 10. AUDIT LOG
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id               BIGSERIAL   PRIMARY KEY,
  chat_id          BIGINT      NOT NULL,
  action           TEXT        NOT NULL,
  by_user_id       BIGINT      DEFAULT 0,
  by_username      TEXT        DEFAULT '',
  target_user_id   BIGINT      DEFAULT 0,
  target_username  TEXT        DEFAULT '',
  details          TEXT        DEFAULT '',
  created_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_chat ON audit_log(chat_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────
-- 11. USERS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  user_id        BIGINT      PRIMARY KEY,
  username       TEXT        DEFAULT '',
  first_name     TEXT        DEFAULT '',
  global_banned  BOOLEAN     DEFAULT FALSE,
  banned_reason  TEXT        DEFAULT '',
  banned_at      TIMESTAMPTZ,
  first_seen     TIMESTAMPTZ DEFAULT NOW(),
  last_seen      TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- 12. CHANNELS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS channels (
  chat_id          BIGINT      PRIMARY KEY,
  title            TEXT        DEFAULT '',
  username         TEXT        DEFAULT '',
  owner_id         BIGINT,
  owner_username   TEXT        DEFAULT '',
  added_by         BIGINT      DEFAULT 0,
  added_by_username TEXT       DEFAULT '',
  added_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- 13. COMMUNITIES
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS communities (
  community_id    BIGINT      PRIMARY KEY,
  title           TEXT        DEFAULT '',
  max_group_joins INTEGER     DEFAULT 1,
  enabled         BOOLEAN     DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS community_groups (
  id           BIGSERIAL PRIMARY KEY,
  community_id BIGINT    NOT NULL REFERENCES communities(community_id) ON DELETE CASCADE,
  chat_id      BIGINT    NOT NULL,
  UNIQUE(community_id, chat_id)
);

CREATE TABLE IF NOT EXISTS community_member_joins (
  id           BIGSERIAL PRIMARY KEY,
  community_id BIGINT    NOT NULL,
  user_id      BIGINT    NOT NULL,
  chat_ids     BIGINT[]  DEFAULT '{}',
  UNIQUE(community_id, user_id)
);

-- ─────────────────────────────────────────────────────────────
-- 14. SPECIALISTS (نظام المتخصصين) — جديد v5.0
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS specialists (
  id         BIGSERIAL   PRIMARY KEY,
  chat_id    BIGINT      NOT NULL,
  user_id    BIGINT      NOT NULL,
  username   TEXT        DEFAULT '',
  first_name TEXT        DEFAULT '',
  specialty  TEXT        DEFAULT 'متخصص',
  added_by   BIGINT      DEFAULT 0,
  is_active  BOOLEAN     DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(chat_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_specialists_chat ON specialists(chat_id, is_active);

-- ─────────────────────────────────────────────────────────────
-- 15. ROUTING KEYWORDS (كلمات التوجيه) — جديد v5.0
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS routing_keywords (
  id            BIGSERIAL   PRIMARY KEY,
  chat_id       BIGINT      NOT NULL,
  keyword       TEXT        NOT NULL,
  specialist_id BIGINT,                -- NULL = أي متخصص متاح
  added_by      BIGINT      DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(chat_id, keyword)
);
CREATE INDEX IF NOT EXISTS idx_routing_keywords_chat ON routing_keywords(chat_id);

-- ─────────────────────────────────────────────────────────────
-- 16. SPECIALIST SESSIONS — جديد v5.0
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS specialist_sessions (
  id               BIGSERIAL   PRIMARY KEY,
  chat_id          BIGINT      NOT NULL,
  user_id          BIGINT      NOT NULL,
  specialist_id    BIGINT      NOT NULL,
  trigger_keyword  TEXT        DEFAULT '',
  original_message TEXT        DEFAULT '',
  status           TEXT        DEFAULT 'active', -- 'active'|'closed'
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  closed_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON specialist_sessions(user_id, status);

-- ─────────────────────────────────────────────────────────────
-- 17. PENDING CAPTCHA — جديد v5.0
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pending_captcha (
  id         BIGSERIAL   PRIMARY KEY,
  chat_id    BIGINT      NOT NULL,
  user_id    BIGINT      NOT NULL,
  answer     TEXT        NOT NULL,
  message_id INTEGER,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts   INTEGER     DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(chat_id, user_id)
);

-- دالة لزيادة عداد المحاولات
CREATE OR REPLACE FUNCTION increment_captcha_attempts(p_chat_id BIGINT, p_user_id BIGINT)
RETURNS VOID AS $$
BEGIN
  UPDATE pending_captcha
  SET attempts = attempts + 1
  WHERE chat_id = p_chat_id AND user_id = p_user_id;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────────
-- 18. REPORTS — جديد v5.0
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reports (
  id               BIGSERIAL   PRIMARY KEY,
  chat_id          BIGINT      NOT NULL,
  reporter_id      BIGINT      NOT NULL,
  reported_user_id BIGINT      NOT NULL,
  message_id       INTEGER,
  reason           TEXT        DEFAULT '',
  status           TEXT        DEFAULT 'pending', -- 'pending'|'resolved'|'dismissed'
  created_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reports_chat ON reports(chat_id, status);

-- ─────────────────────────────────────────────────────────────
-- Row Level Security (تعطيل — البوت يستخدم service key)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE groups                  DISABLE ROW LEVEL SECURITY;
ALTER TABLE group_members           DISABLE ROW LEVEL SECURITY;
ALTER TABLE group_admins            DISABLE ROW LEVEL SECURITY;
ALTER TABLE warns                   DISABLE ROW LEVEL SECURITY;
ALTER TABLE restrictions            DISABLE ROW LEVEL SECURITY;
ALTER TABLE banned_words            DISABLE ROW LEVEL SECURITY;
ALTER TABLE word_violations         DISABLE ROW LEVEL SECURITY;
ALTER TABLE join_requests           DISABLE ROW LEVEL SECURITY;
ALTER TABLE join_request_cooldowns  DISABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log               DISABLE ROW LEVEL SECURITY;
ALTER TABLE users                   DISABLE ROW LEVEL SECURITY;
ALTER TABLE channels                DISABLE ROW LEVEL SECURITY;
ALTER TABLE communities             DISABLE ROW LEVEL SECURITY;
ALTER TABLE community_groups        DISABLE ROW LEVEL SECURITY;
ALTER TABLE community_member_joins  DISABLE ROW LEVEL SECURITY;
ALTER TABLE specialists             DISABLE ROW LEVEL SECURITY;
ALTER TABLE routing_keywords        DISABLE ROW LEVEL SECURITY;
ALTER TABLE specialist_sessions     DISABLE ROW LEVEL SECURITY;
ALTER TABLE pending_captcha         DISABLE ROW LEVEL SECURITY;
ALTER TABLE reports                 DISABLE ROW LEVEL SECURITY;
