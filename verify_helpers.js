/**
 * ═══════════════════════════════════════════════════════════════
 *  verify_helpers.js — دوال مساعدة لنظام التحقق الجامعي
 * ═══════════════════════════════════════════════════════════════
 */

const { Markup }       = require('telegraf');
const db               = require('./db');
const { isDeveloper, isAdmin } = require('./helpers');
const { DEVELOPER_ID } = require('./config');

// ─── ثوابت ────────────────────────────────────────────────────
const VERIFY_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 ساعة بعد الرفض

// ─── حالة المحادثات الخاصة (session مؤقتة في الذاكرة) ────────
// Map: userId → { step, chatId, data, topics }
const sessions = new Map();

// ═══════════════════════════════════════════════════════════════
//  دوال قاعدة البيانات
// ═══════════════════════════════════════════════════════════════

function getOrCreateTopic(g, topicId, name) {
  if (!g.topics) g.topics = new Map();
  if (!g.topics.has(topicId)) {
    g.topics.set(topicId, {
      name:          name || String(topicId),
      locked:        false,
      archived:      false,
      approvedUsers: new Set(),
      joinRequests:  new Map(),
      cooldowns:     new Map(),
      createdAt:     new Date(),
    });
    db.markDirty();
  }
  const t = g.topics.get(topicId);
  if (!t.joinRequests)  { t.joinRequests  = new Map(); db.markDirty(); }
  if (!t.cooldowns)     { t.cooldowns     = new Map(); db.markDirty(); }
  if (!t.approvedUsers) { t.approvedUsers = new Set(); db.markDirty(); }
  return t;
}

function getVerifySettings(g) {
  if (!g.verifySystem) {
    g.verifySystem = {
      enabled:          false,
      verifyTopicId:    null,    // ← موضوع التحقق (يبقى مفتوحاً للجميع)
      pendingRequests:  new Map(),
      approvedMembers:  new Map(),
      rejectedMembers:  new Map(),
      cooldowns:        new Map(),
    };
    db.markDirty();
  }
  const vs = g.verifySystem;
  if (!vs.pendingRequests)       vs.pendingRequests  = new Map();
  if (!vs.approvedMembers)       vs.approvedMembers  = new Map();
  if (!vs.rejectedMembers)       vs.rejectedMembers  = new Map();
  if (!vs.cooldowns)             vs.cooldowns        = new Map();
  if (vs.verifyTopicId === undefined) vs.verifyTopicId = null; // حقل جديد
  return vs;
}

function getAvailableTopics(g) {
  if (!g.topics) return [];
  return [...g.topics.entries()]
    .filter(([, t]) => !t.archived)
    .map(([id, t]) => ({ id, name: t.name || String(id) }));
}


// ═══════════════════════════════════════════════════════════════
//  🔒 إدارة المواضيع عبر Telegram API
// ═══════════════════════════════════════════════════════════════

/**
 * يغلق جميع مواضيع المجموعة ماعدا موضوع التحقق.
 * يُستدعى عند انضمام عضو جديد غير معتمد.
 */
async function closeAllTopicsExceptVerify(bot, chatId, verifyTopicId) {
  const g = db.getGroup(chatId);
  if (!g || !g.topics) return;
  for (const [topicId] of g.topics.entries()) {
    if (verifyTopicId && topicId === verifyTopicId) continue;
    try { await bot.telegram.closeForumTopic(chatId, topicId); } catch {}
  }
}

/**
 * يفتح موضوع الكلية بعد قبول الطالب.
 */
async function openTopicForApprovedUser(bot, chatId, topicId) {
  try { await bot.telegram.reopenForumTopic(chatId, topicId); } catch {}
}

/**
 * يغلق موضوعاً محدداً.
 */
async function closeTopic(bot, chatId, topicId) {
  try { await bot.telegram.closeForumTopic(chatId, topicId); return true; }
  catch { return false; }
}

/**
 * يفتح موضوعاً محدداً.
 */
async function openTopic(bot, chatId, topicId) {
  try { await bot.telegram.reopenForumTopic(chatId, topicId); return true; }
  catch { return false; }
}

// ═══════════════════════════════════════════════════════════════
//  دوال الإشعارات
// ═══════════════════════════════════════════════════════════════

function buildAdminNotification(g, userId, user, data) {
  const name  = user?.first_name || String(userId);
  const uname = user?.username   ? ` (@${user.username})` : '';
  return (
    `🎓 *طلب تحقق جامعي جديد*\n\n` +
    `👤 ${name}${uname}\n` +
    `🆔 \`${userId}\`\n` +
    `🏫 المجموعة: *${g.title}*\n\n` +
    `📋 *البيانات:*\n` +
    `🔢 رقم القيد: \`${data.studentId}\`\n` +
    `🏛️ الكلية: *${data.college}*\n` +
    `📚 التخصص: *${data.major}*\n` +
    `📅 السنة: *${data.year}*\n` +
    `🧵 الموضوع المطلوب: *${data.topicName}*\n\n` +
    `🕐 ${new Date().toLocaleString('ar-SA')}`
  );
}

function buildAdminButtons(userId, chatId, topicId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✅ قبول وفتح الموضوع', `vfy_allow_${userId}_${chatId}_${topicId}`)],
    [
      Markup.button.callback('❌ رفض',          `vfy_deny_${userId}_${chatId}`),
      Markup.button.callback('🚫 رفض وحظر',     `vfy_ban_${userId}_${chatId}`),
    ],
    [Markup.button.callback('🔍 تفاصيل الطالب', `vfy_info_${userId}_${chatId}`)],
  ]);
}

async function notifyAll(bot, g, text, buttons) {
  const notified = new Set();
  const opts = { parse_mode: 'Markdown', ...(buttons || {}) };

  if (g.ownerId) {
    try { await bot.telegram.sendMessage(g.ownerId, text, opts); notified.add(g.ownerId); } catch {}
  }
  for (const [adminId] of (g.admins || new Map()).entries()) {
    if (notified.has(adminId)) continue;
    try { await bot.telegram.sendMessage(adminId, text, opts); notified.add(adminId); } catch {}
  }
  if (DEVELOPER_ID && !notified.has(Number(DEVELOPER_ID))) {
    try { await bot.telegram.sendMessage(DEVELOPER_ID, text, opts); } catch {}
  }
  if (g.logChannelId) {
    try { await bot.telegram.sendMessage(g.logChannelId, text, { parse_mode: 'Markdown' }); } catch {}
  }
}

// ═══════════════════════════════════════════════════════════════
//  دوال التقييد ورفع التقييد
// ═══════════════════════════════════════════════════════════════

async function unrestrictUser(bot, chatId, userId) {
  try {
    await bot.telegram.restrictChatMember(chatId, userId, {
      permissions: {
        can_send_messages: true, can_send_audios: true,
        can_send_documents: true, can_send_photos: true,
        can_send_videos: true, can_send_video_notes: true,
        can_send_voice_notes: true, can_send_polls: true,
        can_send_other_messages: true, can_add_web_page_previews: true,
      },
    });
    return true;
  } catch { return false; }
}

async function restrictUser(bot, chatId, userId) {
  try {
    await bot.telegram.restrictChatMember(chatId, userId, {
      permissions: {
        can_send_messages: false, can_send_audios: false,
        can_send_documents: false, can_send_photos: false,
        can_send_videos: false, can_send_video_notes: false,
        can_send_voice_notes: false, can_send_polls: false,
        can_send_other_messages: false, can_add_web_page_previews: false,
      },
    });
    return true;
  } catch { return false; }
}

// ═══════════════════════════════════════════════════════════════
//  فحص عضو موجود (غير معتمد) وتقييده وإرسال التسجيل له
// ═══════════════════════════════════════════════════════════════

async function checkAndRestrictExistingMember(bot, chatId, userId, g) {
  const vs = getVerifySettings(g);
  if (!vs.enabled) return;

  // تجاهل المعتمدين والمعلق طلباتهم
  if (vs.approvedMembers.has(userId)) return;
  if (vs.pendingRequests.get(userId)?.status === 'pending') return;

  // تجاهل الكوولداون
  const cooldown = vs.cooldowns.get(userId);
  if (cooldown && cooldown > Date.now()) return;

  // جلب معلومات العضو للتحقق من أنه ليس مشرفاً
  try {
    const member = await bot.telegram.getChatMember(chatId, userId);
    if (['administrator', 'creator'].includes(member.status)) return;
    if (member.status === 'left' || member.status === 'kicked') return;
  } catch { return; }

  // تقييد
  await restrictUser(bot, chatId, userId);

  // بدء جلسة تسجيل إن لم تكن موجودة
  if (!sessions.has(userId)) {
    const topics = getAvailableTopics(g);
    sessions.set(userId, { step: 'student_id', chatId, data: {}, topics });
    await stepWelcome(bot, userId, g.title);
  }
}

// ═══════════════════════════════════════════════════════════════
//  خطوات التسجيل التفاعلية
// ═══════════════════════════════════════════════════════════════

async function stepWelcome(bot, userId, groupTitle) {
  try {
    await bot.telegram.sendMessage(userId,
      `🎓 *أهلاً بك في نظام التحقق الجامعي!*\n\n` +
      `📌 المجموعة: *${groupTitle}*\n\n` +
      `🔐 *للانضمام يجب التحقق من هويتك الجامعية.*\n\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `1⃣ *أدخل رقم القيد الجامعي:*\n\n` +
      `_مثال: 2023001234_`,
      { parse_mode: 'Markdown' }
    );
  } catch (e) { console.error('stepWelcome:', e.message); }
}

async function stepCollege(bot, userId, topics) {
  if (!topics.length) {
    return bot.telegram.sendMessage(userId,
      `⚠️ *لا توجد كليات مسجّلة حالياً.*\n\nيرجى التواصل مع المشرف.`,
      { parse_mode: 'Markdown' }
    );
  }
  const rows = [];
  for (let i = 0; i < topics.length; i += 2) {
    const row = [Markup.button.callback(`🏛️ ${topics[i].name}`, `vc_${topics[i].id}`)];
    if (topics[i + 1]) row.push(Markup.button.callback(`🏛️ ${topics[i + 1].name}`, `vc_${topics[i + 1].id}`));
    rows.push(row);
  }
  rows.push([Markup.button.callback('❌ إلغاء التسجيل', 'vstep_cancel')]);

  await bot.telegram.sendMessage(userId,
    `━━━━━━━━━━━━━━━━━━\n` +
    `2⃣ *اختر كليتك:*\n\n` +
    `_اضغط على اسم كليتك_`,
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard(rows) }
  );
}

async function stepMajor(bot, userId, collegeName) {
  await bot.telegram.sendMessage(userId,
    `━━━━━━━━━━━━━━━━━━\n` +
    `3⃣ *اكتب تخصصك في كلية ${collegeName}:*\n\n` +
    `_مثال: هندسة حاسب آلي، نظم المعلومات، المحاسبة..._`,
    { parse_mode: 'Markdown' }
  );
}

async function stepYear(bot, userId) {
  await bot.telegram.sendMessage(userId,
    `━━━━━━━━━━━━━━━━━━\n` +
    `4⃣ *اختر سنتك الدراسية:*`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('1⃣ السنة الأولى',   'vy_السنة الأولى'),
          Markup.button.callback('2⃣ السنة الثانية',  'vy_السنة الثانية'),
        ],
        [
          Markup.button.callback('3⃣ السنة الثالثة',  'vy_السنة الثالثة'),
          Markup.button.callback('4⃣ السنة الرابعة',  'vy_السنة الرابعة'),
        ],
        [
          Markup.button.callback('5⃣ السنة الخامسة',  'vy_السنة الخامسة'),
          Markup.button.callback('🎓 دراسات عليا',     'vy_دراسات عليا'),
        ],
        [Markup.button.callback('❌ إلغاء التسجيل',    'vstep_cancel')],
      ]),
    }
  );
}

async function stepConfirm(bot, userId, data) {
  await bot.telegram.sendMessage(userId,
    `━━━━━━━━━━━━━━━━━━\n` +
    `✅ *مراجعة بياناتك قبل الإرسال:*\n\n` +
    `🔢 رقم القيد: \`${data.studentId}\`\n` +
    `🏛️ الكلية: *${data.college}*\n` +
    `📚 التخصص: *${data.major}*\n` +
    `📅 السنة: *${data.year}*\n\n` +
    `هل البيانات صحيحة؟`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('✅ إرسال الطلب',   'vstep_confirm')],
        [Markup.button.callback('✏️ تعديل البيانات', 'vstep_restart')],
        [Markup.button.callback('❌ إلغاء',          'vstep_cancel')],
      ]),
    }
  );
}

module.exports = {
  VERIFY_COOLDOWN_MS,
  sessions,
  getOrCreateTopic,
  getVerifySettings,
  getAvailableTopics,
  buildAdminNotification,
  buildAdminButtons,
  notifyAll,
  unrestrictUser,
  restrictUser,
  checkAndRestrictExistingMember,
  closeAllTopicsExceptVerify,
  openTopicForApprovedUser,
  closeTopic,
  openTopic,
  stepWelcome,
  stepCollege,
  stepMajor,
  stepYear,
  stepConfirm,
};
