/**
 * ═══════════════════════════════════════════════════════════════
 *  handler_topics.js — نظام التحقق الجامعي المتطور v3.0
 *
 *  🎓 نظام التحقق الجامعي الكامل:
 *  ─────────────────────────────────────────────────────────────
 *  1. عضو جديد ينضم → يُقيَّد فوراً (لا يكتب في أي موضوع)
 *  2. البوت يرسل له في الخاص: ترحيب + طلب بيانات تدريجي بالأزرار
 *  3. الطالب يُدخل: رقم القيد → يختار الكلية → التخصص → السنة
 *  4. الطلب يُرسل للمالك + المشرفين + المطور مع أزرار قبول/رفض
 *  5. عند القبول → يُفك تقييده ويُفتح له موضوع كليته فقط
 *  6. المواضيع تُجلب تلقائياً من المجموعة عبر /synctopics
 *
 *  🛡️ قواعد صارمة:
 *  • طلب واحد فقط في نفس الوقت (منع التكرار)
 *  • Cooldown 24 ساعة بعد الرفض
 *  • لا يُسمح للطالب بأكثر من كلية واحدة
 *  • غير المعتمدين لا يستطيعون الكتابة في أي موضوع
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
//  دوال مساعدة
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

// يضمن وجود كائن verifySystem في بيانات المجموعة
function getVerifySettings(g) {
  if (!g.verifySystem) {
    g.verifySystem = {
      enabled:         false,
      pendingRequests: new Map(), // userId → { firstName, username, data, submittedAt, status }
      approvedMembers: new Map(), // userId → { topicId, topicName, studentData, approvedAt, approvedBy }
      rejectedMembers: new Map(), // userId → { rejectedAt, reason }
      cooldowns:       new Map(), // userId → timestamp (بعد الرفض)
    };
    db.markDirty();
  }
  const vs = g.verifySystem;
  if (!vs.pendingRequests)  vs.pendingRequests  = new Map();
  if (!vs.approvedMembers)  vs.approvedMembers  = new Map();
  if (!vs.rejectedMembers)  vs.rejectedMembers  = new Map();
  if (!vs.cooldowns)        vs.cooldowns        = new Map();
  return vs;
}

// قائمة المواضيع غير المؤرشفة
function getAvailableTopics(g) {
  if (!g.topics) return [];
  return [...g.topics.entries()]
    .filter(([, t]) => !t.archived)
    .map(([id, t]) => ({ id, name: t.name || String(id) }));
}

// بناء رسالة الإشعار الكاملة للإدارة
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

// أزرار القبول/الرفض/المعلومات
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

// إرسال إشعار لجميع المسؤولين
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

// رفع التقييد (السماح بالكتابة)
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

// تقييد (منع الكتابة — يبقى في المجموعة)
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
//  خطوات التسجيل التفاعلية
// ═══════════════════════════════════════════════════════════════

async function stepWelcome(bot, userId, groupTitle) {
  try {
    await bot.telegram.sendMessage(userId,
      `🎓 *أهلاً بك في مجتمع جامعة الأمير سلطان!*\n\n` +
      `انضممت إلى *${groupTitle}*.\n\n` +
      `لفتح المواضيع وتفعيل حسابك، يرجى إكمال بيانات التسجيل:\n\n` +
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

// ═══════════════════════════════════════════════════════════════
//  الدالة الرئيسية
// ═══════════════════════════════════════════════════════════════
module.exports = function setupTopicHandlers(bot) {

  // ════════════════════════════════════════════════════════════
  //  🔒 اعتراض الأعضاء الجدد — تقييد فوري + بدء التسجيل
  //  يعمل بالتوازي مع handler_groups (لا يستبدله)
  // ════════════════════════════════════════════════════════════
  bot.on('chat_member', async (ctx, next) => {
    const upd = ctx.chatMember;
    if (!upd) return next();

    const { chat } = upd;
    const newM = upd.new_chat_member;
    const oldM = upd.old_chat_member;
    const u    = newM.user;

    if (chat.type === 'channel' || u.is_bot) return next();

    // عضو جديد فقط
    if (!(newM.status === 'member' && (oldM.status === 'left' || oldM.status === 'kicked'))) {
      return next();
    }

    const g = db.getGroup(chat.id);
    if (!g) return next();

    const vs = getVerifySettings(g);
    if (!vs.enabled) return next();

    // المشرفون والمالك والمطور لا يُقيَّدون
    const isPriv = isDeveloper({ from: u }) || await isAdmin(bot, chat.id, u.id);
    if (isPriv) return next();

    // معتمد مسبقاً؟
    if (vs.approvedMembers.has(u.id)) return next();

    // لديه cooldown من رفض سابق؟
    const cooldown = vs.cooldowns.get(u.id);
    if (cooldown && cooldown > Date.now()) {
      const hrs = Math.ceil((cooldown - Date.now()) / 3600000);
      try {
        await bot.telegram.sendMessage(u.id,
          `⏳ *لا يمكنك التسجيل الآن*\n\nيمكن إعادة المحاولة بعد \`${hrs}\` ساعة.`,
          { parse_mode: 'Markdown' }
        );
      } catch {}
      return next();
    }

    // 1. تقييد فوري
    await restrictUser(bot, chat.id, u.id);

    // 2. جلب المواضيع
    const topics = getAvailableTopics(g);

    // 3. حفظ session
    sessions.set(u.id, { step: 'student_id', chatId: chat.id, data: {}, topics });

    // 4. بدء التسجيل في الخاص
    await stepWelcome(bot, u.id, g.title);

    return next();
  });

  // ════════════════════════════════════════════════════════════
  //  💬 معالج الرسائل النصية في الخاص (خطوات التسجيل)
  // ════════════════════════════════════════════════════════════
  bot.on('message', async (ctx, next) => {
    if (ctx.chat.type !== 'private') return next();
    const userId = ctx.from.id;
    const sess   = sessions.get(userId);
    if (!sess) return next();

    const text = ctx.message.text?.trim() || '';

    if (sess.step === 'student_id') {
      if (!text || text.length < 5 || !/^\d+/.test(text)) {
        return ctx.reply('⚠️ رقم القيد يجب أن يبدأ بأرقام ولا يقل عن 5 خانات. حاول مجدداً:');
      }
      sess.data.studentId = text;
      sess.step = 'college';
      await stepCollege(bot, userId, sess.topics);
      return;
    }

    if (sess.step === 'major') {
      if (!text || text.length < 3) {
        return ctx.reply('⚠️ يرجى كتابة اسم التخصص بشكل صحيح (3 أحرف على الأقل):');
      }
      sess.data.major = text;
      sess.step = 'year';
      await stepYear(bot, userId);
      return;
    }

    return next();
  });

  // ════════════════════════════════════════════════════════════
  //  🔘 أزرار خطوات التسجيل
  // ════════════════════════════════════════════════════════════

  // اختيار الكلية
  bot.action(/^vc_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const userId  = ctx.from.id;
    const topicId = Number(ctx.match[1]);
    const sess    = sessions.get(userId);
    if (!sess) return ctx.reply('⚠️ انتهت جلسة التسجيل. أرسل /verify لإعادة البدء.');

    const topic = sess.topics.find(t => t.id === topicId);
    if (!topic) return ctx.answerCbQuery('❌ الكلية غير موجودة!', { show_alert: true });

    sess.data.college   = topic.name;
    sess.data.topicId   = topicId;
    sess.data.topicName = topic.name;
    sess.step = 'major';

    try { await ctx.deleteMessage(); } catch {}
    await stepMajor(bot, userId, topic.name);
  });

  // اختيار السنة الدراسية
  bot.action(/^vy_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    const year   = ctx.match[1];
    const sess   = sessions.get(userId);
    if (!sess) return ctx.reply('⚠️ انتهت جلسة التسجيل. أرسل /verify.');

    sess.data.year = year;
    sess.step = 'confirm';

    try { await ctx.deleteMessage(); } catch {}
    await stepConfirm(bot, userId, sess.data);
  });

  // تأكيد وإرسال الطلب
  bot.action('vstep_confirm', async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    const sess   = sessions.get(userId);
    if (!sess) return ctx.reply('⚠️ انتهت جلسة التسجيل. أرسل /verify.');

    const g = db.getGroup(sess.chatId);
    if (!g) return ctx.reply('❌ المجموعة غير موجودة. تواصل مع المشرف.');

    const vs = getVerifySettings(g);

    // منع الطلبات المتعددة
    const existing = vs.pendingRequests.get(userId);
    if (existing?.status === 'pending') {
      sessions.delete(userId);
      try { await ctx.deleteMessage(); } catch {}
      return ctx.reply('📨 *لديك طلب قيد المراجعة بالفعل.*\n\nانتظر حتى يراجعه المشرف.', { parse_mode: 'Markdown' });
    }

    // حفظ الطلب
    vs.pendingRequests.set(userId, {
      userId,
      username:    ctx.from.username  || '',
      firstName:   ctx.from.first_name || String(userId),
      data:        { ...sess.data },
      submittedAt: new Date(),
      status:      'pending',
    });
    db.markDirty();
    sessions.delete(userId);

    try { await ctx.deleteMessage(); } catch {}

    // إشعار الطالب
    await ctx.reply(
      `✅ *تم إرسال طلبك بنجاح!*\n\n` +
      `📋 *ملخص بياناتك:*\n` +
      `🔢 رقم القيد: \`${sess.data.studentId}\`\n` +
      `🏛️ الكلية: *${sess.data.college}*\n` +
      `📚 التخصص: *${sess.data.major}*\n` +
      `📅 السنة: *${sess.data.year}*\n\n` +
      `⏳ *جاري المراجعة...*\n` +
      `سيتم إشعارك فور اتخاذ القرار.\n\n` +
      `_قد يستغرق المراجعة بعض الوقت. شكراً لصبرك!_`,
      { parse_mode: 'Markdown' }
    );

    // إشعار الإدارة
    const notifText = buildAdminNotification(g, userId, ctx.from, sess.data);
    const notifBtns = buildAdminButtons(userId, sess.chatId, sess.data.topicId);
    await notifyAll(bot, g, notifText, notifBtns);
  });

  // إعادة التسجيل من البداية
  bot.action('vstep_restart', async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    const sess   = sessions.get(userId);
    if (!sess) return;

    const g = db.getGroup(sess.chatId);
    sess.data = {};
    sess.step = 'student_id';
    try { await ctx.deleteMessage(); } catch {}
    await stepWelcome(bot, userId, g?.title || 'المجموعة');
  });

  // إلغاء التسجيل
  bot.action('vstep_cancel', async (ctx) => {
    await ctx.answerCbQuery('تم الإلغاء');
    sessions.delete(ctx.from.id);
    try { await ctx.deleteMessage(); } catch {}
    await ctx.reply(
      `❌ *تم إلغاء التسجيل.*\n\nإذا أردت إعادة التسجيل لاحقاً، أرسل /verify`,
      { parse_mode: 'Markdown' }
    );
  });

  // ════════════════════════════════════════════════════════════
  //  ✅ قبول الطلب
  // ════════════════════════════════════════════════════════════
  bot.action(/^vfy_allow_(\d+)_(-?\d+)_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const userId  = Number(ctx.match[1]);
    const chatId  = Number(ctx.match[2]);
    const topicId = Number(ctx.match[3]);

    const g = db.getGroup(chatId);
    if (!g) return ctx.answerCbQuery('❌ المجموعة غير موجودة!', { show_alert: true });

    const canAct = isDeveloper(ctx) || ctx.from.id === g.ownerId || await isAdmin(bot, chatId, ctx.from.id);
    if (!canAct) return ctx.answerCbQuery('❌ ليس لديك صلاحية!', { show_alert: true });

    const vs  = getVerifySettings(g);
    const req = vs.pendingRequests.get(userId);
    if (!req || req.status !== 'pending')
      return ctx.answerCbQuery('⚠️ الطلب غير موجود أو تمت معالجته!', { show_alert: true });

    // تحديث الطلب
    req.status     = 'approved';
    req.reviewedAt = new Date();
    req.reviewedBy = ctx.from.id;

    // حفظ الاعتماد
    vs.approvedMembers.set(userId, {
      topicId,
      topicName:   req.data.topicName,
      studentData: { ...req.data },
      approvedAt:  new Date(),
      approvedBy:  ctx.from.id,
    });

    // فتح الموضوع لهذا الطالب فقط
    const topic = getOrCreateTopic(g, topicId, req.data.topicName);
    topic.locked = true; // الموضوع مقفول للعموم
    topic.approvedUsers.add(userId);
    db.markDirty();

    // رفع التقييد عن العضو
    await unrestrictUser(bot, chatId, userId);

    // تحديث رسالة الإشعار
    try {
      await ctx.editMessageText(
        ctx.callbackQuery.message.text +
        `\n\n✅ *تم القبول* — @${ctx.from.username || ctx.from.first_name}\n` +
        `🕐 ${new Date().toLocaleString('ar-SA')}`,
        { parse_mode: 'Markdown' }
      );
    } catch {}

    // إشعار الطالب
    try {
      await bot.telegram.sendMessage(userId,
        `🎉 *تم قبول طلبك!*\n\n` +
        `أهلاً بك في مجتمع جامعة الأمير سلطان 🎓\n\n` +
        `✅ تم فتح موضوع *${req.data.topicName}* لك.\n` +
        `يمكنك الآن المشاركة والتفاعل مع زملائك في كليتك!\n\n` +
        `_إذا واجهت أي مشكلة، تواصل مع المشرف._`,
        { parse_mode: 'Markdown' }
      );
    } catch {}

    await ctx.answerCbQuery('✅ تم القبول وفتح الموضوع!', { show_alert: true });
  });

  // ════════════════════════════════════════════════════════════
  //  ❌ رفض الطلب
  // ════════════════════════════════════════════════════════════
  bot.action(/^vfy_deny_(\d+)_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const userId = Number(ctx.match[1]);
    const chatId = Number(ctx.match[2]);

    const g = db.getGroup(chatId);
    if (!g) return ctx.answerCbQuery('❌ المجموعة غير موجودة!', { show_alert: true });

    const canAct = isDeveloper(ctx) || ctx.from.id === g.ownerId || await isAdmin(bot, chatId, ctx.from.id);
    if (!canAct) return ctx.answerCbQuery('❌ ليس لديك صلاحية!', { show_alert: true });

    const vs  = getVerifySettings(g);
    const req = vs.pendingRequests.get(userId);
    if (!req || req.status !== 'pending')
      return ctx.answerCbQuery('⚠️ الطلب غير موجود أو تمت معالجته!', { show_alert: true });

    req.status     = 'rejected';
    req.reviewedAt = new Date();
    req.reviewedBy = ctx.from.id;
    vs.cooldowns.set(userId, Date.now() + VERIFY_COOLDOWN_MS);
    db.markDirty();

    try {
      await ctx.editMessageText(
        ctx.callbackQuery.message.text +
        `\n\n❌ *تم الرفض* — @${ctx.from.username || ctx.from.first_name}`,
        { parse_mode: 'Markdown' }
      );
    } catch {}

    try {
      await bot.telegram.sendMessage(userId,
        `❌ *تم رفض طلبك*\n\n` +
        `للأسف، لم يتم التحقق من بياناتك.\n\n` +
        `⏳ يمكنك إعادة المحاولة بعد *24 ساعة* عبر الأمر /verify\n\n` +
        `_إذا كنت تعتقد أن هذا خطأ، تواصل مع المشرف مباشرة._`,
        { parse_mode: 'Markdown' }
      );
    } catch {}

    await ctx.answerCbQuery('❌ تم الرفض وإشعار الطالب', { show_alert: true });
  });

  // ════════════════════════════════════════════════════════════
  //  🚫 رفض + حظر
  // ════════════════════════════════════════════════════════════
  bot.action(/^vfy_ban_(\d+)_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const userId = Number(ctx.match[1]);
    const chatId = Number(ctx.match[2]);

    const g = db.getGroup(chatId);
    if (!g) return ctx.answerCbQuery('❌ المجموعة غير موجودة!', { show_alert: true });

    const canAct = isDeveloper(ctx) || ctx.from.id === g.ownerId || await isAdmin(bot, chatId, ctx.from.id);
    if (!canAct) return ctx.answerCbQuery('❌ ليس لديك صلاحية!', { show_alert: true });

    const vs  = getVerifySettings(g);
    const req = vs.pendingRequests.get(userId);
    if (req) { req.status = 'banned'; req.reviewedAt = new Date(); db.markDirty(); }

    try { await bot.telegram.banChatMember(chatId, userId); } catch {}

    try {
      await ctx.editMessageText(
        ctx.callbackQuery.message.text +
        `\n\n🚫 *تم الرفض والحظر* — @${ctx.from.username || ctx.from.first_name}`,
        { parse_mode: 'Markdown' }
      );
    } catch {}

    try {
      await bot.telegram.sendMessage(userId,
        `🚫 *تم رفض طلبك وحظرك من المجموعة.*\n\n_إذا كنت تعتقد أن هذا خطأ، تواصل مع إدارة الجامعة._`,
        { parse_mode: 'Markdown' }
      );
    } catch {}

    await ctx.answerCbQuery('🚫 تم الرفض والحظر', { show_alert: true });
  });

  // ════════════════════════════════════════════════════════════
  //  🔍 تفاصيل الطالب
  // ════════════════════════════════════════════════════════════
  bot.action(/^vfy_info_(\d+)_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const userId = Number(ctx.match[1]);
    const chatId = Number(ctx.match[2]);

    const g = db.getGroup(chatId);
    if (!g) return;

    const vs   = getVerifySettings(g);
    const req  = vs.pendingRequests.get(userId);
    const user = db.getUser(userId);

    const info =
      `🔍 *تفاصيل الطالب*\n\n` +
      `👤 ${req?.firstName || String(userId)}${req?.username ? ` (@${req.username})` : ''}\n` +
      `🆔 \`${userId}\`\n` +
      `📅 أول ظهور: ${user?.firstSeen ? new Date(user.firstSeen).toLocaleDateString('ar-SA') : 'غير معروف'}\n` +
      `🌍 محظور عالمياً: ${user?.globalBanned ? `✅ — ${user.bannedReason}` : '❌'}\n\n` +
      `📋 *البيانات المُدخلة:*\n` +
      `🔢 رقم القيد: \`${req?.data?.studentId || 'غير محدد'}\`\n` +
      `🏛️ الكلية: *${req?.data?.college || 'غير محدد'}*\n` +
      `📚 التخصص: *${req?.data?.major || 'غير محدد'}*\n` +
      `📅 السنة: *${req?.data?.year || 'غير محدد'}*\n` +
      `🧵 الموضوع: *${req?.data?.topicName || 'غير محدد'}*\n` +
      `🕐 تاريخ الطلب: ${req?.submittedAt ? new Date(req.submittedAt).toLocaleString('ar-SA') : 'غير محدد'}`;

    await ctx.reply(info, {
      parse_mode: 'Markdown',
      ...buildAdminButtons(userId, chatId, req?.data?.topicId || 0),
    });
  });

  // ════════════════════════════════════════════════════════════
  //  🔒 فلتر الرسائل داخل المجموعة — منع غير المعتمدين
  // ════════════════════════════════════════════════════════════
  bot.on('message', async (ctx, next) => {
    if (!ctx.chat || ctx.chat.type === 'private' || !ctx.from) return next();
    if (!ctx.message?.message_thread_id) return next();

    const g = db.getGroup(ctx.chat.id);
    if (!g) return next();

    const vs = getVerifySettings(g);
    if (!vs.enabled) return next();

    const topicId = ctx.message.message_thread_id;
    const userId  = ctx.from.id;

    // مشرفون ومطور → مسموح دائماً
    if (isDeveloper(ctx) || await isAdmin(bot, ctx.chat.id, userId)) return next();

    // هل معتمد وهذا موضوعه؟
    const approved = vs.approvedMembers.get(userId);
    if (approved?.topicId === topicId) return next();

    // هل لديه إذن قديم في هذا الموضوع؟
    const topic = g.topics?.get(topicId);
    if (topic?.approvedUsers?.has(userId)) return next();

    // حذف الرسالة بصمت
    try { await ctx.deleteMessage(); } catch {}
  });

  // ════════════════════════════════════════════════════════════
  //  🔄 /synctopics — جلب المواضيع من المجموعة تلقائياً
  // ════════════════════════════════════════════════════════════
  bot.command('synctopics', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, ctx.chat.id, ctx.from.id))
      return ctx.reply('❌ للمشرفين فقط!');

    const g = db.getGroup(ctx.chat.id);
    if (!g) return ctx.reply('❌ المجموعة غير مسجّلة!');

    const msg = await ctx.reply('⏳ جاري جلب المواضيع...');

    try {
      const result = await bot.telegram.callApi('getForumTopics', {
        chat_id: ctx.chat.id,
        limit: 100,
      });

      const fetched = result?.topics || [];
      if (!fetched.length) {
        return bot.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
          '⚠️ لم أجد مواضيع. تأكد أن المجموعة تدعم المواضيع (Forum) وأن البوت مشرف.'
        );
      }

      let added = 0, updated = 0;
      for (const t of fetched) {
        const tid = t.message_thread_id;
        if (!tid || !t.name) continue;
        if (!g.topics.has(tid)) {
          getOrCreateTopic(g, tid, t.name);
          added++;
        } else {
          const ex = g.topics.get(tid);
          if (ex.name !== t.name) { ex.name = t.name; updated++; db.markDirty(); }
        }
      }

      const topics = getAvailableTopics(g);
      const list   = topics.map((t, i) => `${i + 1}. *${t.name}* \`[${t.id}]\``).join('\n');

      await bot.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
        `✅ *تمت مزامنة المواضيع*\n\n` +
        `➕ مضاف: \`${added}\` | 🔄 محدَّث: \`${updated}\`\n` +
        `📋 الإجمالي: \`${topics.length}\`\n\n` +
        `📋 *قائمة الكليات/المواضيع:*\n${list}\n\n` +
        `_هذه هي الكليات التي سيختار منها الطلاب عند التسجيل._`,
        { parse_mode: 'Markdown' }
      );
    } catch (e) {
      await bot.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
        `❌ *فشل جلب المواضيع*\n\`${e.message}\`\n\n` +
        `💡 إذا لم يدعم الـ API هذا، استخدم /regtopic داخل كل موضوع يدوياً.`,
        { parse_mode: 'Markdown' }
      );
    }
  });

  // ════════════════════════════════════════════════════════════
  //  ⚙️ /verify_system on|off — تفعيل/تعطيل نظام التحقق
  // ════════════════════════════════════════════════════════════
  bot.command('verify_system', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, ctx.chat.id, ctx.from.id))
      return ctx.reply('❌ للمشرفين فقط!');

    const arg = ctx.message.text.split(' ')[1]?.toLowerCase();
    if (!['on', 'off'].includes(arg))
      return ctx.reply(
        `⚙️ الاستخدام:\n` +
        `\`/verify_system on\` — لتفعيل نظام التحقق\n` +
        `\`/verify_system off\` — لتعطيله`,
        { parse_mode: 'Markdown' }
      );

    const g = db.getGroup(ctx.chat.id);
    if (!g) return ctx.reply('❌ المجموعة غير مسجّلة!');

    const vs   = getVerifySettings(g);
    vs.enabled = arg === 'on';
    db.markDirty();

    await ctx.reply(
      arg === 'on'
        ? `🔒 *تم تفعيل نظام التحقق الجامعي*\n\n` +
          `الأعضاء الجدد سيُقيَّدون فوراً ويُطلب منهم إكمال التسجيل.\n\n` +
          `📋 *الخطوات التالية:*\n` +
          `1. /synctopics — لجلب الكليات/المواضيع\n` +
          `2. تأكد أن البوت مشرف بصلاحية تقييد الأعضاء`
        : `🔓 *تم تعطيل نظام التحقق*\n\nالأعضاء الجدد لن يخضعوا للتقييد.`,
      { parse_mode: 'Markdown' }
    );
  });

  // ════════════════════════════════════════════════════════════
  //  📋 /verify_requests — الطلبات المعلقة للمشرفين
  // ════════════════════════════════════════════════════════════
  bot.command('verify_requests', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, ctx.chat.id, ctx.from.id))
      return ctx.reply('❌ للمشرفين فقط!');

    const g = db.getGroup(ctx.chat.id);
    if (!g) return ctx.reply('❌ المجموعة غير مسجّلة!');

    const vs      = getVerifySettings(g);
    const pending = [...vs.pendingRequests.values()].filter(r => r.status === 'pending');

    if (!pending.length) return ctx.reply('✅ لا توجد طلبات معلقة حالياً.');

    let text = `📨 *الطلبات المعلقة — (${pending.length})*\n\n`;
    for (const req of pending.slice(0, 10)) {
      text +=
        `👤 ${req.firstName}${req.username ? ` (@${req.username})` : ''} \`${req.userId}\`\n` +
        `🏛️ ${req.data?.college} | 📚 ${req.data?.major} | 📅 ${req.data?.year}\n` +
        `🕐 ${new Date(req.submittedAt).toLocaleString('ar-SA')}\n\n`;
    }
    if (pending.length > 10) text += `_...و ${pending.length - 10} طلب آخر_`;

    const rows = pending.slice(0, 5).map(req => [
      Markup.button.callback(
        `👤 ${req.firstName.substring(0, 20)} — ${req.data?.college?.substring(0, 12) || ''}`,
        `vfy_info_${req.userId}_${ctx.chat.id}`
      ),
    ]);
    rows.push([Markup.button.callback('🔄 تحديث القائمة', `vfylist_${ctx.chat.id}`)]);

    await ctx.reply(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(rows) });
  });

  // تحديث قائمة الطلبات
  bot.action(/^vfylist_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId);
    if (!g) return;

    const vs      = getVerifySettings(g);
    const pending = [...vs.pendingRequests.values()].filter(r => r.status === 'pending');

    if (!pending.length) return ctx.editMessageText('✅ لا توجد طلبات معلقة.');

    let text = `📨 *الطلبات المعلقة — (${pending.length})*\n\n`;
    for (const req of pending.slice(0, 10)) {
      text +=
        `👤 ${req.firstName}${req.username ? ` (@${req.username})` : ''} \`${req.userId}\`\n` +
        `🏛️ ${req.data?.college} | 📚 ${req.data?.major}\n` +
        `🕐 ${new Date(req.submittedAt).toLocaleString('ar-SA')}\n\n`;
    }

    const rows = pending.slice(0, 5).map(req => [
      Markup.button.callback(
        `👤 ${req.firstName.substring(0, 20)} — ${req.data?.college?.substring(0, 12) || ''}`,
        `vfy_info_${req.userId}_${chatId}`
      ),
    ]);
    rows.push([Markup.button.callback('🔄 تحديث القائمة', `vfylist_${chatId}`)]);

    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(rows) });
  });

  // ════════════════════════════════════════════════════════════
  //  📊 /verify_stats — إحصائيات نظام التحقق
  // ════════════════════════════════════════════════════════════
  bot.command('verify_stats', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, ctx.chat.id, ctx.from.id))
      return ctx.reply('❌ للمشرفين فقط!');

    const g = db.getGroup(ctx.chat.id);
    if (!g) return ctx.reply('❌ المجموعة غير مسجّلة!');

    const vs      = getVerifySettings(g);
    const allReqs = [...vs.pendingRequests.values()];
    const pending = allReqs.filter(r => r.status === 'pending').length;
    const approved = vs.approvedMembers.size;
    const rejected = allReqs.filter(r => r.status === 'rejected').length;
    const banned   = allReqs.filter(r => r.status === 'banned').length;
    const topics   = getAvailableTopics(g);

    // توزيع على الكليات
    const dist = new Map();
    for (const [, m] of vs.approvedMembers) {
      const name = m.topicName || String(m.topicId);
      dist.set(name, (dist.get(name) || 0) + 1);
    }
    const distText = [...dist.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => `  🏛️ ${name}: \`${count}\``)
      .join('\n');

    await ctx.replyWithMarkdown(
      `📊 *إحصائيات نظام التحقق — ${g.title}*\n\n` +
      `🔒 الحالة: ${vs.enabled ? '*مفعّل* ✅' : '*معطّل* ❌'}\n` +
      `🏛️ الكليات المسجّلة: \`${topics.length}\`\n\n` +
      `📋 *الطلبات:*\n` +
      `⏳ معلقة: \`${pending}\`\n` +
      `✅ مقبولة: \`${approved}\`\n` +
      `❌ مرفوضة: \`${rejected}\`\n` +
      `🚫 محظورة: \`${banned}\`\n` +
      `📊 المجموع: \`${allReqs.length}\`\n\n` +
      (distText ? `🏛️ *توزيع الطلاب على الكليات:*\n${distText}` : '')
    );
  });

  // ════════════════════════════════════════════════════════════
  //  🔑 /verify — للطالب لبدء/استئناف التسجيل في الخاص
  // ════════════════════════════════════════════════════════════
  bot.command('verify', async (ctx) => {
    if (ctx.chat.type !== 'private') {
      return ctx.reply(
        `📩 *لبدء التسجيل، أرسل هذا الأمر في الخاص مع البوت:*\n\n/verify`,
        { parse_mode: 'Markdown' }
      );
    }

    const userId  = ctx.from.id;
    const allGrps = db.allGroups();

    // البحث عن مجموعة التحقق المرتبطة بالمستخدم
    const myGroup = allGrps.find(g => {
      const vs = g.verifySystem;
      return vs?.enabled && (
        vs.pendingRequests?.has(userId) ||
        vs.approvedMembers?.has(userId) ||
        g.members?.has(userId)
      );
    });

    if (!myGroup) {
      return ctx.reply(
        `❌ *لم أجد مجموعة مرتبطة بحسابك.*\n\n` +
        `يجب أن تنضم للمجموعة أولاً، ثم أرسل /verify في الخاص.`,
        { parse_mode: 'Markdown' }
      );
    }

    const vs = getVerifySettings(myGroup);

    if (vs.approvedMembers.has(userId)) {
      const info = vs.approvedMembers.get(userId);
      return ctx.reply(
        `✅ *حسابك معتمد بالفعل!*\n\n` +
        `🏛️ الكلية: *${info.topicName}*\n` +
        `🔢 رقم القيد: \`${info.studentData?.studentId || 'غير متاح'}\`\n\n` +
        `يمكنك المشاركة في موضوعك مباشرة.`,
        { parse_mode: 'Markdown' }
      );
    }

    const existing = vs.pendingRequests.get(userId);
    if (existing?.status === 'pending') {
      return ctx.reply(
        `📨 *لديك طلب قيد المراجعة.*\n\nانتظر حتى يراجعه المشرف وستصلك رسالة.`,
        { parse_mode: 'Markdown' }
      );
    }

    const cooldown = vs.cooldowns.get(userId);
    if (cooldown && cooldown > Date.now()) {
      const hrs = Math.ceil((cooldown - Date.now()) / 3600000);
      return ctx.reply(
        `⏳ *يجب الانتظار \`${hrs}\` ساعة* قبل إعادة المحاولة.`,
        { parse_mode: 'Markdown' }
      );
    }

    // بدء جلسة جديدة
    const topics = getAvailableTopics(myGroup);
    sessions.set(userId, { step: 'student_id', chatId: myGroup.chatId, data: {}, topics });
    await stepWelcome(bot, userId, myGroup.title);
  });

  // ════════════════════════════════════════════════════════════
  //  🗑️ /revoke_verify — إلغاء اعتماد طالب
  // ════════════════════════════════════════════════════════════
  bot.command('revoke_verify', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, ctx.chat.id, ctx.from.id))
      return ctx.reply('❌ للمشرفين فقط!');

    const g = db.getGroup(ctx.chat.id);
    if (!g) return;

    let targetId = ctx.message.reply_to_message?.from?.id;
    if (!targetId) {
      const arg = ctx.message.text.split(' ')[1];
      if (arg && /^\d+$/.test(arg)) targetId = Number(arg);
    }
    if (!targetId) return ctx.reply('❌ حدد المستخدم بالرد عليه أو: `/revoke_verify <userId>`', { parse_mode: 'Markdown' });

    const vs  = getVerifySettings(g);
    const had = vs.approvedMembers.has(targetId);
    vs.approvedMembers.delete(targetId);

    for (const [, topic] of (g.topics || new Map())) {
      topic.approvedUsers?.delete(targetId);
    }

    await restrictUser(bot, ctx.chat.id, targetId);
    db.markDirty();

    try {
      await bot.telegram.sendMessage(targetId,
        `⚠️ *تم إلغاء اعتمادك في المجموعة.*\n\nللإعادة، أرسل /verify وأكمل التسجيل من جديد.`,
        { parse_mode: 'Markdown' }
      );
    } catch {}

    await ctx.reply(
      had
        ? `✅ تم إلغاء اعتماد \`${targetId}\` وتقييده.`
        : `⚠️ \`${targetId}\` لم يكن معتمداً، تم تقييده.`,
      { parse_mode: 'Markdown' }
    );
  });

  // ════════════════════════════════════════════════════════════
  //  📌 /regtopic — تسجيل موضوع يدوياً (احتياطي)
  // ════════════════════════════════════════════════════════════
  bot.command('regtopic', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, ctx.chat.id, ctx.from.id))
      return ctx.reply('❌ للمشرفين فقط!');

    const topicId = ctx.message.message_thread_id;
    if (!topicId) return ctx.reply('❌ هذا الأمر يُستخدم داخل موضوع فقط!');

    const g    = db.getGroup(ctx.chat.id);
    if (!g) return ctx.reply('❌ المجموعة غير مسجّلة!');

    const name  = ctx.message.text.split(' ').slice(1).join(' ').trim();
    const topic = getOrCreateTopic(g, topicId, name || String(topicId));
    if (name) topic.name = name;
    db.markDirty();

    await ctx.reply(
      `✅ *تم تسجيل الموضوع*\n\n🆔 \`${topicId}\`\n📌 الاسم: *${topic.name}*`,
      { parse_mode: 'Markdown' }
    );
  });

  // ════════════════════════════════════════════════════════════
  //  📋 /mytopics — الطالب يرى وضعه (في الخاص)
  // ════════════════════════════════════════════════════════════
  bot.command('mytopics', async (ctx) => {
    if (ctx.chat.type !== 'private') return ctx.reply('ℹ️ هذا الأمر يعمل في الخاص فقط.');
    const userId = ctx.from.id;

    const activeGroups = db.allGroups().filter(g => g.verifySystem?.enabled);
    if (!activeGroups.length) return ctx.reply('لا توجد مجموعات مفعّل فيها نظام التحقق.');

    let text  = `🎓 *وضع حسابك الجامعي*\n\n`;
    let found = false;

    for (const g of activeGroups) {
      const vs  = getVerifySettings(g);
      const app = vs.approvedMembers.get(userId);
      const req = vs.pendingRequests.get(userId);

      if (app) {
        found = true;
        text +=
          `*${g.title}*\n` +
          `  ✅ معتمد — ${app.topicName}\n` +
          `  🏛️ ${app.studentData?.college || ''} | 📚 ${app.studentData?.major || ''}\n\n`;
      } else if (req?.status === 'pending') {
        found = true;
        text += `*${g.title}*\n  ⏳ طلبك قيد المراجعة...\n\n`;
      }
    }

    if (!found) {
      text += `_لم تُعتمد في أي مجموعة حتى الآن._\n\nأرسل /verify لبدء التسجيل.`;
    }

    await ctx.replyWithMarkdown(text);
  });

};
