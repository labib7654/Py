/**
 * ═══════════════════════════════════════════════════════════════
 *  verify_helpers.js — دوال مساعدة لنظام التحقق الجامعي
 *  النظام الجديد: chat_join_request → تحقق كامل → قبول تلقائي
 * ═══════════════════════════════════════════════════════════════
 */

const { Markup }       = require('telegraf');
const db               = require('./db');
const { isDeveloper, isAdmin } = require('./helpers');
const { DEVELOPER_ID } = require('./config');

// ─── ثوابت ────────────────────────────────────────────────────
const VERIFY_COOLDOWN_MS  = 24 * 60 * 60 * 1000; // 24 ساعة بعد الرفض
const AUTO_APPROVE_DELAY  = 2 * 60 * 1000;        // دقيقتان للقبول التلقائي

// ─── حالة المحادثات الخاصة (session مؤقتة في الذاكرة) ────────
// Map: userId → { step, chatId, data }
const sessions = new Map();

// ─── قائمة جامعات المملكة العربية السعودية ───────────────────
const SAUDI_UNIVERSITIES = [
  'جامعة الملك سعود',
  'جامعة الملك عبدالعزيز',
  'جامعة الملك فهد للبترول والمعادن',
  'جامعة الملك فيصل',
  'جامعة الملك خالد',
  'جامعة الملك عبدالله للعلوم والتقنية (كاوست)',
  'جامعة القصيم',
  'جامعة الإمام محمد بن سعود الإسلامية',
  'جامعة الأمير سلطان',
  'جامعة طيبة',
  'جامعة تبوك',
  'جامعة حائل',
  'جامعة الجوف',
  'جامعة نجران',
  'جامعة جازان',
  'جامعة الباحة',
  'جامعة بيشة',
  'جامعة شقراء',
  'جامعة المجمعة',
  'جامعة الأمير سطام بن عبدالعزيز',
  'جامعة الأمير قاسم',
  'جامعة حفر الباطن',
  'جامعة الدمام (الإمام عبدالرحمن)',
  'جامعة المدينة العالمية',
  'جامعة دار العلوم',
  'جامعة أم القرى',
  'جامعة الطائف',
  'جامعة سعود الطبية',
  'جامعة الأمير محمد بن فهد',
  'جامعة اليمامة',
  'جامعة الأهلية',
  'جامعة عفت',
  'جامعة الإمام عبدالرحمن بن فيصل',
  'جامعة نورة بنت عبدالرحمن',
  'جامعة الفيصل',
  'جامعة زاها',
  'كلية الفنون التطبيقية',
  'أخرى',
];

// ═══════════════════════════════════════════════════════════════
//  دوال قاعدة البيانات
// ═══════════════════════════════════════════════════════════════

function getVerifySettings(g) {
  if (!g.verifySystem) {
    g.verifySystem = {
      enabled:         false,
      verifyTopicId:   null,
      pendingRequests: new Map(),
      approvedMembers: new Map(),
      rejectedMembers: new Map(),
      cooldowns:       new Map(),
    };
    db.markDirty();
  }
  const vs = g.verifySystem;
  if (!vs.pendingRequests)       vs.pendingRequests  = new Map();
  if (!vs.approvedMembers)       vs.approvedMembers  = new Map();
  if (!vs.rejectedMembers)       vs.rejectedMembers  = new Map();
  if (!vs.cooldowns)             vs.cooldowns        = new Map();
  if (vs.verifyTopicId === undefined) vs.verifyTopicId = null;
  return vs;
}

function getAvailableTopics(g) {
  if (!g.topics) return [];
  return [...g.topics.entries()]
    .filter(([, t]) => !t.archived)
    .map(([id, t]) => ({ id, name: t.name || String(id) }));
}

function normalizeTopicText(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function resolveRegistrationTopic(g, data = {}) {
  if (!g?.topics?.size) return null;

  const activeTopics = [...g.topics.entries()].filter(([, t]) => !t.archived);
  if (!activeTopics.length) return null;

  const candidates = [
    data.topicName,
    data.university,
    data.college,
    data.major,
  ].map(normalizeTopicText).filter(Boolean);

  for (const candidate of candidates) {
    const exact = activeTopics.find(([, t]) => normalizeTopicText(t.name) === candidate);
    if (exact) return { topicId: exact[0], topicName: exact[1].name || String(exact[0]) };
  }

  for (const candidate of candidates) {
    const partial = activeTopics.find(([, t]) => {
      const topicName = normalizeTopicText(t.name);
      return topicName.includes(candidate) || candidate.includes(topicName);
    });
    if (partial) return { topicId: partial[0], topicName: partial[1].name || String(partial[0]) };
  }

  const directVerifyTopicId = g.verifySystem?.verifyTopicId;
  if (directVerifyTopicId && g.topics.has(directVerifyTopicId)) {
    const topic = g.topics.get(directVerifyTopicId);
    return { topicId: directVerifyTopicId, topicName: topic?.name || String(directVerifyTopicId) };
  }

  const [topicId, topic] = activeTopics[0];
  return { topicId, topicName: topic?.name || String(topicId) };
}

function attachApprovedUserToTopic(g, userId, data = {}) {
  const resolved = resolveRegistrationTopic(g, data);
  if (!resolved) return null;

  const topic = g.topics?.get(resolved.topicId);
  if (!topic) return null;
  if (!topic.approvedUsers) topic.approvedUsers = new Set();
  topic.approvedUsers.add(userId);
  db.markDirty();
  return resolved;
}

function detachApprovedUserFromTopics(g, userId) {
  if (!g?.topics) return;
  for (const [, topic] of g.topics.entries()) {
    if (topic.approvedUsers?.delete(userId)) db.markDirty();
  }
}

// ═══════════════════════════════════════════════════════════════
//  دوال الإشعارات للمشرفين
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
    `👤 الاسم الرباعي: *${data.fullName}*\n` +
    `🏛️ الجامعة: *${data.university}*\n` +
    `📚 التخصص: *${data.major}*\n` +
    `🔢 الرقم الجامعي: \`${data.studentId}\`\n` +
    `📱 رقم الجوال: \`${data.phone}\`\n\n` +
    `🕐 ${new Date().toLocaleString('ar-SA')}`
  );
}

function buildAdminButtons(userId, chatId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✅ قبول', `vfy_allow_${userId}_${chatId}`)],
    [
      Markup.button.callback('❌ رفض',      `vfy_deny_${userId}_${chatId}`),
      Markup.button.callback('🚫 رفض وحظر', `vfy_ban_${userId}_${chatId}`),
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
//  خطوات التسجيل الجديدة
// ═══════════════════════════════════════════════════════════════

/**
 * الخطوة 0: رسالة الترحيب + زرين (طالب / أريد الدخول)
 */
async function stepWelcome(bot, userId, groupTitle) {
  try {
    await bot.telegram.sendMessage(userId,
      `🎓 *أهلاً بك في مجتمع ${groupTitle}!*\n\n` +
      `🔐 هذه مجموعة خاصة بطلاب الجامعات السعودية.\n` +
      `يرجى إكمال خطوات التحقق للانضمام.\n\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `*ما وضعك؟*`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🎓 أنا طالب جامعي', 'vs_student')],
          [Markup.button.callback('🏫 أريد الدخول للجامعة', 'vs_applicant')],
        ]),
      }
    );
  } catch (e) { console.error('stepWelcome:', e.message); }
}

/**
 * الخطوة 1: اختيار الجامعة (صفحات من أزرار)
 */
async function stepSelectUniversity(bot, userId, page = 0) {
  const PAGE_SIZE = 8;
  const start     = page * PAGE_SIZE;
  const slice     = SAUDI_UNIVERSITIES.slice(start, start + PAGE_SIZE);

  const rows = [];
  for (let i = 0; i < slice.length; i += 2) {
    const row = [Markup.button.callback(slice[i], `vsu_${start + i}`)];
    if (slice[i + 1]) row.push(Markup.button.callback(slice[i + 1], `vsu_${start + i + 1}`));
    rows.push(row);
  }

  // أزرار التنقل
  const nav = [];
  if (page > 0) nav.push(Markup.button.callback('⬅️ السابق', `vsu_pg_${page - 1}`));
  if (start + PAGE_SIZE < SAUDI_UNIVERSITIES.length) nav.push(Markup.button.callback('التالي ➡️', `vsu_pg_${page + 1}`));
  if (nav.length) rows.push(nav);
  rows.push([Markup.button.callback('❌ إلغاء', 'vstep_cancel')]);

  try {
    await bot.telegram.sendMessage(userId,
      `━━━━━━━━━━━━━━━━━━\n` +
      `1️⃣ *اختر جامعتك:*\n` +
      `_(الصفحة ${page + 1} من ${Math.ceil(SAUDI_UNIVERSITIES.length / PAGE_SIZE)})_`,
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard(rows) }
    );
  } catch (e) { console.error('stepSelectUniversity:', e.message); }
}

/**
 * الخطوة 2: إدخال التخصص نصياً
 */
async function stepMajor(bot, userId, universityName) {
  try {
    await bot.telegram.sendMessage(userId,
      `━━━━━━━━━━━━━━━━━━\n` +
      `2️⃣ *اكتب تخصصك في ${universityName}:*\n\n` +
      `_مثال: هندسة حاسب آلي، نظم المعلومات، المحاسبة_`,
      { parse_mode: 'Markdown' }
    );
  } catch (e) { console.error('stepMajor:', e.message); }
}

/**
 * الخطوة 3: إدخال الاسم الرباعي
 */
async function stepFullName(bot, userId) {
  try {
    await bot.telegram.sendMessage(userId,
      `━━━━━━━━━━━━━━━━━━\n` +
      `3️⃣ *أدخل اسمك الرباعي:*\n\n` +
      `_مثال: محمد عبدالله أحمد الغامدي_`,
      { parse_mode: 'Markdown' }
    );
  } catch (e) { console.error('stepFullName:', e.message); }
}

/**
 * الخطوة 4: إدخال الرقم الجامعي
 */
async function stepStudentId(bot, userId) {
  try {
    await bot.telegram.sendMessage(userId,
      `━━━━━━━━━━━━━━━━━━\n` +
      `4️⃣ *أدخل رقمك الجامعي:*\n\n` +
      `_مثال: 2023001234_`,
      { parse_mode: 'Markdown' }
    );
  } catch (e) { console.error('stepStudentId:', e.message); }
}

/**
 * الخطوة 5: التحقق "أنت إنسان" — مشاركة رقم الجوال
 */
async function stepPhoneVerify(bot, userId) {
  try {
    await bot.telegram.sendMessage(userId,
      `━━━━━━━━━━━━━━━━━━\n` +
      `5️⃣ *التحقق من أنك إنسان حقيقي ومن نفس البلد*\n\n` +
      `🔐 اضغط الزر أدناه للموافقة على التحقق.\n` +
      `بعد الضغط سيُطلب منك مشاركة رقم جوالك.\n\n` +
      `_رقمك يُستخدم للتحقق فقط ولن يُشارَك مع أحد._`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('✅ وافق على التحقق', 'vs_phone_agree')],
          [Markup.button.callback('❌ إلغاء', 'vstep_cancel')],
        ]),
      }
    );
  } catch (e) { console.error('stepPhoneVerify:', e.message); }
}

/**
 * الخطوة 5b: طلب رقم الهاتف الفعلي عبر زر contact
 */
async function stepRequestContact(bot, userId) {
  try {
    await bot.telegram.sendMessage(userId,
      `📱 *اضغط الزر أدناه لمشاركة رقم جوالك:*`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          keyboard: [[{ text: '📱 مشاركة رقم الجوال', request_contact: true }]],
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      }
    );
  } catch (e) { console.error('stepRequestContact:', e.message); }
}

/**
 * الخطوة 6: ملخص وتأكيد
 */
async function stepConfirm(bot, userId, data) {
  try {
    await bot.telegram.sendMessage(userId,
      `━━━━━━━━━━━━━━━━━━\n` +
      `✅ *مراجعة بياناتك قبل الإرسال:*\n\n` +
      `👤 الاسم: *${data.fullName}*\n` +
      `🏛️ الجامعة: *${data.university}*\n` +
      `📚 التخصص: *${data.major}*\n` +
      `🔢 الرقم الجامعي: \`${data.studentId}\`\n` +
      `📱 رقم الجوال: \`${data.phone}\`\n\n` +
      `هل البيانات صحيحة؟`,
      {
        parse_mode: 'Markdown',
        reply_markup: { remove_keyboard: true },
      }
    );
    // إرسال أزرار التأكيد في رسالة منفصلة (بعد إغلاق الكيبورد)
    await bot.telegram.sendMessage(userId,
      `اختر:`,
      {
        ...Markup.inlineKeyboard([
          [Markup.button.callback('✅ إرسال الطلب',    'vstep_confirm')],
          [Markup.button.callback('✏️ تعديل البيانات', 'vstep_restart')],
          [Markup.button.callback('❌ إلغاء',           'vstep_cancel')],
        ]),
      }
    );
  } catch (e) { console.error('stepConfirm:', e.message); }
}

// ═══════════════════════════════════════════════════════════════
//  دوال التقييد (للأعضاء الموجودين داخل المجموعة)
// ═══════════════════════════════════════════════════════════════

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

async function closeAllTopicsExceptVerify(bot, chatId, verifyTopicId) {
  const g = db.getGroup(chatId);
  if (!g || !g.topics) return;
  for (const [topicId] of g.topics.entries()) {
    if (verifyTopicId && topicId === verifyTopicId) continue;
    try { await bot.telegram.closeForumTopic(chatId, topicId); } catch {}
  }
}

async function openTopicForApprovedUser(bot, chatId, topicId) {
  try { await bot.telegram.reopenForumTopic(chatId, topicId); } catch {}
}

async function openTopic(bot, chatId, topicId) {
  try { await bot.telegram.reopenForumTopic(chatId, topicId); } catch {}
}

async function closeTopic(bot, chatId, topicId) {
  try { await bot.telegram.closeForumTopic(chatId, topicId); } catch {}
}

// ═══════════════════════════════════════════════════════════════
//  فحص عضو قديم وتقييده إذا لم يكن معتمداً
//  يُستخدم من /check_unverified وعند تفعيل النظام
//  يُرسل له رسالة خاصة لإكمال التحقق
// ═══════════════════════════════════════════════════════════════
async function checkAndRestrictExistingMember(bot, chatId, userId, g) {
  const vs = getVerifySettings(g);

  // معتمد مسبقاً → لا شيء
  if (vs.approvedMembers.has(userId)) return false;

  // له طلب معلق → لا شيء
  if (['pending', 'pending_verify', 'pending_direct'].includes(vs.pendingRequests.get(userId)?.status)) return false;

  // تقييد العضو داخل المجموعة
  const restricted = await restrictUser(bot, chatId, userId);

  if (restricted) {
    // إرسال رسالة له في الخاص لإكمال التحقق
    try {
      const botInfo = await bot.telegram.getMe();
      await bot.telegram.sendMessage(userId,
        `🔐 *مرحباً!*\\n\\n` +
        `تم تقييد وصولك مؤقتاً في *${g.title}*\\n\\n` +
        `📋 هذه المجموعة تتطلب التحقق من هويتك الجامعية.\\n` +
        `اضغط الزر أدناه لإكمال خطوات التسجيل والحصول على وصول كامل:`,
        {
          parse_mode: 'Markdown',
          ...require('telegraf').Markup.inlineKeyboard([[
            require('telegraf').Markup.button.url(
              '✅ بدء التحقق الجامعي',
              `https://t.me/${botInfo.username}?start=verify_${chatId}`
            )
          ]]),
        }
      );
    } catch {}

    // تسجيل طلب انضمام مؤقت حتى يكتمل التحقق
    if (!g.joinRequests) g.joinRequests = new Map();
    if (!g.joinRequests.has(userId)) {
      g.joinRequests.set(userId, {
        userId,
        username:    '',
        firstName:   String(userId),
        status:      'pending_verify',
        requestedAt: new Date(),
        isExistingMember: true,
      });
      db.markDirty();
    }
  }

  return restricted;
}

module.exports = {
  VERIFY_COOLDOWN_MS,
  AUTO_APPROVE_DELAY,
  SAUDI_UNIVERSITIES,
  sessions,
  getVerifySettings,
  getAvailableTopics,
  resolveRegistrationTopic,
  attachApprovedUserToTopic,
  detachApprovedUserFromTopics,
  buildAdminNotification,
  buildAdminButtons,
  notifyAll,
  restrictUser,
  unrestrictUser,
  closeAllTopicsExceptVerify,
  openTopicForApprovedUser,
  openTopic,
  closeTopic,
  checkAndRestrictExistingMember,
  stepWelcome,
  stepSelectUniversity,
  stepMajor,
  stepFullName,
  stepStudentId,
  stepPhoneVerify,
  stepRequestContact,
  stepConfirm,
};
