-- ============================================================
--  schema.sql — النسخة المحدّثة
--  شغّل هذا الملف مرة واحدة في Supabase SQL Editor
--  https://supabase.com/dashboard/project/_YOUR_PROJECT_/sql/new
-- ============================================================

-- ── الجداول الأساسية ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS groups (
  chat_id                BIGINT PRIMARY KEY,
  title                  TEXT NOT NULL DEFAULT '',
  type                   TEXT NOT NULL DEFAULT 'group',
  owner_id               BIGINT,
  owner_username         TEXT DEFAULT '',
  added_by               BIGINT,
  added_by_username      TEXT DEFAULT '',
  added_at               TIMESTAMPTZ DEFAULT NOW(),
  locked                 BOOLEAN DEFAULT FALSE,
  protect_content        BOOLEAN DEFAULT FALSE,
  welcome_message        TEXT DEFAULT '👋 مرحباً {name} في {group}!',
  welcome_enabled        BOOLEAN DEFAULT TRUE,
  anti_spam              BOOLEAN DEFAULT FALSE,
  mute_new_members       BOOLEAN DEFAULT FALSE,
  join_requests_enabled  BOOLEAN DEFAULT FALSE,
  rules                  TEXT DEFAULT '',
  max_warns              INTEGER DEFAULT 3,
  banned_words_action    TEXT DEFAULT 'warn',

  -- ── مميزات جديدة ──────────────────────────────────────────
  college                TEXT DEFAULT '',            -- اسم الكلية المخصصة للقروب
  allowed_colleges       TEXT[] DEFAULT '{}',        -- مصفوفة الكليات المسموحة
  college_filter_enabled BOOLEAN DEFAULT FALSE,      -- تفعيل فلتر الكليات
  audit_log_channel_id   BIGINT DEFAULT NULL,        -- قناة سجل النشاط
  exam_mode_enabled      BOOLEAN DEFAULT FALSE,      -- وضع الامتحانات
  exam_start             TIMESTAMPTZ DEFAULT NULL,   -- بداية الامتحان
  exam_end               TIMESTAMPTZ DEFAULT NULL,   -- نهاية الامتحان
  link_filter_enabled    BOOLEAN DEFAULT FALSE,      -- فلتر الروابط
  allowed_domains        TEXT[] DEFAULT '{}',        -- نطاقات مسموحة (مثل university.edu.sa)
  anti_duplicate_enabled BOOLEAN DEFAULT FALSE       -- كشف الحسابات المكررة
);

CREATE TABLE IF NOT EXISTS users (
  user_id       BIGINT PRIMARY KEY,
  username      TEXT DEFAULT '',
  first_name    TEXT DEFAULT '',
  global_banned BOOLEAN DEFAULT FALSE,
  banned_reason TEXT DEFAULT '',
  banned_at     TIMESTAMPTZ,
  first_seen    TIMESTAMPTZ DEFAULT NOW(),

  -- ── مميزات جديدة ──────────────────────────────────────────
  college       TEXT DEFAULT '',     -- كلية المستخدم
  student_id    TEXT DEFAULT '',     -- رقم الطالب الجامعي
  verified      BOOLEAN DEFAULT FALSE, -- تم التحقق من هويته
  badge         TEXT DEFAULT 'new',  -- new | regular | active | warned | vip
  msg_count     INTEGER DEFAULT 0,   -- عدد الرسائل
  last_seen     TIMESTAMPTZ DEFAULT NULL  -- آخر نشاط
);

CREATE TABLE IF NOT EXISTS members (
  chat_id    BIGINT NOT NULL,
  user_id    BIGINT NOT NULL,
  username   TEXT DEFAULT '',
  first_name TEXT DEFAULT '',
  role       TEXT DEFAULT 'member',
  joined_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY(chat_id, user_id)
);

CREATE TABLE IF NOT EXISTS admins (
  chat_id              BIGINT NOT NULL,
  user_id              BIGINT NOT NULL,
  username             TEXT DEFAULT '',
  promoted_by          BIGINT,
  promoted_by_username TEXT DEFAULT '',
  promoted_at          TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY(chat_id, user_id)
);

CREATE TABLE IF NOT EXISTS warns (
  id         BIGSERIAL PRIMARY KEY,
  chat_id    BIGINT NOT NULL,
  user_id    BIGINT NOT NULL,
  reason     TEXT DEFAULT '',
  warned_by  BIGINT,
  warned_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS muted_users (
  chat_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  PRIMARY KEY(chat_id, user_id)
);

CREATE TABLE IF NOT EXISTS banned_users (
  chat_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  PRIMARY KEY(chat_id, user_id)
);

CREATE TABLE IF NOT EXISTS banned_words (
  id       BIGSERIAL PRIMARY KEY,
  chat_id  BIGINT NOT NULL,
  word     TEXT NOT NULL,
  action   TEXT DEFAULT 'warn',
  added_by BIGINT,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(chat_id, word)
);

CREATE TABLE IF NOT EXISTS join_requests (
  chat_id      BIGINT NOT NULL,
  user_id      BIGINT NOT NULL,
  username     TEXT DEFAULT '',
  first_name   TEXT DEFAULT '',
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  status       TEXT DEFAULT 'pending',
  college      TEXT DEFAULT '',   -- كلية الطالب عند التقديم
  PRIMARY KEY(chat_id, user_id)
);

CREATE TABLE IF NOT EXISTS user_groups (
  user_id BIGINT NOT NULL,
  chat_id BIGINT NOT NULL,
  PRIMARY KEY(user_id, chat_id)
);

-- ── إضافة الأعمدة الجديدة إن كانت الجداول موجودة مسبقاً ─────
-- (آمن للتشغيل أكثر من مرة)

ALTER TABLE groups ADD COLUMN IF NOT EXISTS college                TEXT DEFAULT '';
ALTER TABLE groups ADD COLUMN IF NOT EXISTS allowed_colleges       TEXT[] DEFAULT '{}';
ALTER TABLE groups ADD COLUMN IF NOT EXISTS college_filter_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS audit_log_channel_id   BIGINT DEFAULT NULL;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS exam_mode_enabled      BOOLEAN DEFAULT FALSE;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS exam_start             TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS exam_end               TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS link_filter_enabled    BOOLEAN DEFAULT FALSE;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS allowed_domains        TEXT[] DEFAULT '{}';
ALTER TABLE groups ADD COLUMN IF NOT EXISTS anti_duplicate_enabled BOOLEAN DEFAULT FALSE;

ALTER TABLE users ADD COLUMN IF NOT EXISTS college    TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS student_id TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS verified   BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS badge      TEXT DEFAULT 'new';
ALTER TABLE users ADD COLUMN IF NOT EXISTS msg_count  INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen  TIMESTAMPTZ DEFAULT NULL;

ALTER TABLE join_requests ADD COLUMN IF NOT EXISTS college TEXT DEFAULT '';

-- ── تعطيل RLS ────────────────────────────────────────────────
ALTER TABLE groups        DISABLE ROW LEVEL SECURITY;
ALTER TABLE users         DISABLE ROW LEVEL SECURITY;
ALTER TABLE members       DISABLE ROW LEVEL SECURITY;
ALTER TABLE admins        DISABLE ROW LEVEL SECURITY;
ALTER TABLE warns         DISABLE ROW LEVEL SECURITY;
ALTER TABLE muted_users   DISABLE ROW LEVEL SECURITY;
ALTER TABLE banned_users  DISABLE ROW LEVEL SECURITY;
ALTER TABLE banned_words  DISABLE ROW LEVEL SECURITY;
ALTER TABLE join_requests DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_groups   DISABLE ROW LEVEL SECURITY;

-- ── Indexes للأداء ───────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_members_chat       ON members(chat_id);
CREATE INDEX IF NOT EXISTS idx_warns_chat_user    ON warns(chat_id, user_id);
CREATE INDEX IF NOT EXISTS idx_bwords_chat        ON banned_words(chat_id);
CREATE INDEX IF NOT EXISTS idx_admins_chat        ON admins(chat_id);
CREATE INDEX IF NOT EXISTS idx_jreqs_chat         ON join_requests(chat_id);
CREATE INDEX IF NOT EXISTS idx_users_college      ON users(college);
CREATE INDEX IF NOT EXISTS idx_users_badge        ON users(badge);
CREATE INDEX IF NOT EXISTS idx_groups_college     ON groups(college);
