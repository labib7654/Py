/**
 * ═══════════════════════════════════════════════════════════════
 *  handler_topics.js — نظام إدارة المواضيع المتكامل
 *  الميزات:
 *  • طلبات انضمام لكل موضوع (topic join requests)
 *  • إشعارات فورية للمالك + المطور
 *  • لوحة تحكم كاملة للمواضيع
 *  • قبول / رفض / تجاهل مع سجل كامل
 *  • إدارة المواضيع: قفل / فتح / أرشفة / تسمية
 *  • cooldown لمنع إعادة الطلب المتكرر
 * ═══════════════════════════════════════════════════════════════
 */

const { Markup }       = require('telegraf');
const db               = require('./db');
const { isDeveloper, isAdmin } = require('./helpers');
const { DEVELOPER_ID } = require('./config');

// ─── ثوابت ────────────────────────────────────────────────────
const TOPIC_REQUEST_COOLDOWN_MS = 12 * 60 * 60 * 1000; // 12 ساعة بين كل طلب
const MAX_PENDING_PER_USER      = 3;  // أقصى طلبات معلقة لمستخدم واحد

// ─── دوال مساعدة داخلية ───────────────────────────────────────

/**
 * يحصل على بيانات الموضوع أو ينشئه إن لم يكن موجوداً
 */
function getOrCreateTopic(g, topicId, name = '') {
  if (!g.topics.has(topicId)) {
    g.topics.set(topicId, {
      name:         name || String(topicId),
      locked:       false,
      archived:     false,
      approvedUsers: new Set(),
      joinRequests:  new Map(),   // userId → { requestedAt, status, note }
      cooldowns:     new Map(),   // userId → timestamp
      createdAt:     new Date(),
    });
    db.markDirty();
  }
  const t = g.topics.get(topicId);
  // نضمن الحقول الجديدة موجودة في المواضيع القديمة
  if (!t.joinRequests)  { t.joinRequests  = new Map(); db.markDirty(); }
  if (!t.cooldowns)     { t.cooldowns     = new Map(); db.markDirty(); }
  if (!t.approvedUsers) { t.approvedUsers = new Set(); db.markDirty(); }
  return t;
}

/**
 * يبني رسالة تفاصيل الطلب
 */
function buildRequestMessage(g, topicId, topic, userId, user, note = '') {
  const name    = user?.first_name || String(userId);
  const uname   = user?.username   ? ` (@${user.username})` : '';
  const topName = topic.name       || String(topicId);
  return (
    `📨 *طلب انضمام لموضوع*\n\n` +
    `👤 ${name}${uname}\n` +
    `🆔 \`${userId}\`\n` +
    `🧵 الموضوع: *${topName}*\n` +
    `💬 المجموعة: *${g.title}*\n` +
    (note ? `📝 ملاحظة: ${note}\n` : '') +
    `🕐 ${new Date().toLocaleString('ar')}`
  );
}

/**
 * يبني أزرار القبول/الرفض لطلب موضوع
 */
function buildRequestButtons(userId, chatId, topicId) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ قبول',     `ta_allow_${userId}_${chatId}_${topicId}`),
      Markup.button.callback('❌ رفض',      `ta_deny_${userId}_${chatId}_${topicId}`),
      Markup.button.callback('⏳ تجاهل',    `ta_ignore_${userId}_${chatId}_${topicId}`),
    ],
    [
      Markup.button.callback('🔍 معلومات الطالب', `ta_info_${userId}_${chatId}_${topicId}`),
    ],
  ]);
}

/**
 * يبني لوحة تحكم المواضيع الرئيسية
 */
function topicsDashboard(g, chatId) {
  const ts      = g.topicSettings || {};
  const topics  = [...g.topics.entries()];
  const pending = topics.reduce((acc, [, t]) => {
    if (t.joinRequests) {
      acc += [...t.joinRequests.values()].filter(r => r.status === 'pending').length;
    }
    return acc;
  }, 0);

  const rows = [
    [Markup.button.callback(
      `${ts.requireApprovalToJoin ? '🔒 مفعّل' : '🔓 معطّل'} — طلبات دخول المواضيع`,
      `tg_toggle_req_${chatId}`
    )],
    [Markup.button.callback(
      `📨 الطلبات المعلقة ${pending ? `(${pending})` : ''}`,
      `tg_pending_all_${chatId}`
    )],
    [Markup.button.callback('📋 قائمة المواضيع',  `tg_list_${chatId}`)],
    [Markup.button.callback('🔙 رجوع',             `settings_${chatId}`)],
  ];
  return Markup.inlineKeyboard(rows);
}

/**
 * يبني نص لوحة المواضيع
 */
function topicsDashboardText(g) {
  const ts = g.topicSettings || {};
  let text = `🧵 *إدارة المواضيع — ${g.title}*\n\n`;
  text += `طلبات الانضمام: ${ts.requireApprovalToJoin ? '🔒 مفعّلة' : '🔓 معطّلة'}\n`;
  text += `إجمالي المواضيع المسجّلة: \`${g.topics.size}\`\n`;

  const pending = [...g.topics.values()].reduce((acc, t) => {
    if (t.joinRequests)
      acc += [...t.joinRequests.values()].filter(r => r.status === 'pending').length;
    return acc;
  }, 0);
  if (pending) text += `⚠️ طلبات معلقة: \`${pending}\`\n`;
  return text;
}

// ═══════════════════════════════════════════════════════════════
module.exports = function setupTopicHandlers(bot) {

  // ════════════════════════════════════════════════════════════
  //  فلتر الرسائل: فحص إذن الموضوع
  //  يُضاف في index.js قبل أي handler رسائل آخر
  // ════════════════════════════════════════════════════════════
  bot.on('message', async (ctx, next) => {
    // فقط في المجموعات وعند وجود موضوع
    if (!ctx.chat || ctx.chat.type === 'private' || !ctx.from) return next();
    if (!ctx.message?.message_thread_id) return next();

    const g = db.getGroup(ctx.chat.id);
    if (!g?.topicSettings?.requireApprovalToJoin) return next();

    const topicId = ctx.message.message_thread_id;
    const topic   = g.topics.get(topicId);

    // إن لم يكن الموضوع مسجّلاً أو غير مقفول → مسموح
    if (!topic || !topic.locked) return next();

    const userId       = ctx.from.id;
    const isApproved   = topic.approvedUsers?.has(userId);
    const isPrivileged = await isAdmin(bot, ctx.chat.id, userId) || isDeveloper(ctx);
    if (isApproved || isPrivileged) return next();

    // مستخدم غير مرخّص — احذف رسالته وأرسل طلب انضمام
    try { await ctx.deleteMessage(); } catch {}

    // فحص cooldown
    const cooldownExpiry = topic.cooldowns?.get(userId);
    if (cooldownExpiry && cooldownExpiry > Date.now()) {
      const mins = Math.ceil((cooldownExpiry - Date.now()) / 60000);
      try {
        await bot.telegram.sendMessage(
          userId,
          `⏳ *لا يمكنك إرسال طلب انضمام الآن*\n\nيمكنك إعادة المحاولة بعد \`${mins}\` دقيقة.`,
          { parse_mode: 'Markdown' }
        );
      } catch {}
      return;
    }

    // فحص طلب معلق بالفعل
    const existingReq = topic.joinRequests?.get(userId);
    if (existingReq?.status === 'pending') {
      try {
        await bot.telegram.sendMessage(
          userId,
          `📨 *طلبك قيد المراجعة*\n\nلديك طلب انضمام معلق للموضوع "*${topic.name || topicId}*".\nانتظر حتى يراجعه المالك.`,
          { parse_mode: 'Markdown' }
        );
      } catch {}
      return;
    }

    // تسجيل الطلب
    getOrCreateTopic(g, topicId, topic.name);
    topic.joinRequests.set(userId, {
      userId,
      username:    ctx.from.username  || '',
      firstName:   ctx.from.first_name || String(userId),
      status:      'pending',
      requestedAt: new Date(),
      note:        '',
    });
    db.markDirty();

    // إشعار المستخدم
    try {
      await bot.telegram.sendMessage(
        userId,
        `📨 *تم إرسال طلب الانضمام*\n\nطلبك للموضوع "*${topic.name || topicId}*" في *${g.title}* قيد المراجعة.\nستصلك رسالة عند البت في طلبك.`,
        { parse_mode: 'Markdown' }
      );
    } catch {}

    // بناء رسالة الإشعار للمالك/المطور
    const user     = db.getUser(userId);
    const msgText  = buildRequestMessage(g, topicId, topic, userId, ctx.from);
    const msgBtns  = buildRequestButtons(userId, ctx.chat.id, topicId);

    // إشعار المالك
    if (g.ownerId) {
      try {
        await bot.telegram.sendMessage(g.ownerId, msgText, { parse_mode: 'Markdown', ...msgBtns });
      } catch {}
    }

    // إشعار المشرفين
    for (const [adminId] of g.admins.entries()) {
      if (adminId === g.ownerId) continue;
      try {
        await bot.telegram.sendMessage(adminId, msgText, { parse_mode: 'Markdown', ...msgBtns });
      } catch {}
    }

    // إشعار المطور دائماً
    if (DEVELOPER_ID && DEVELOPER_ID !== g.ownerId) {
      try {
        await bot.telegram.sendMessage(DEVELOPER_ID, msgText, { parse_mode: 'Markdown', ...msgBtns });
      } catch {}
    }

    // إشعار قناة اللوق إن وجدت
    if (g.logChannelId) {
      try {
        await bot.telegram.sendMessage(g.logChannelId, msgText, { parse_mode: 'Markdown' });
      } catch {}
    }
  });

  // ════════════════════════════════════════════════════════════
  //  أزرار: قبول / رفض / تجاهل / معلومات
  // ════════════════════════════════════════════════════════════

  // ✅ قبول الطلب
  bot.action(/^ta_allow_(\d+)_(-?\d+)_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const userId  = Number(ctx.match[1]);
    const chatId  = Number(ctx.match[2]);
    const topicId = Number(ctx.match[3]);
    const g = db.getGroup(chatId);
    if (!g) return ctx.answerCbQuery('❌ المجموعة غير موجودة!', { show_alert: true });

    // التحقق من الصلاحية
    const canAct = isDeveloper(ctx) || ctx.from.id === g.ownerId || await isAdmin(bot, chatId, ctx.from.id);
    if (!canAct) return ctx.answerCbQuery('❌ ليس لديك صلاحية!', { show_alert: true });

    const topic = g.topics.get(topicId);
    if (!topic) return ctx.answerCbQuery('❌ الموضوع غير موجود!', { show_alert: true });

    const req = topic.joinRequests?.get(userId);
    if (!req || req.status !== 'pending')
      return ctx.answerCbQuery('⚠️ الطلب غير موجود أو تمت معالجته!', { show_alert: true });

    // قبول
    req.status     = 'approved';
    req.reviewedAt = new Date();
    req.reviewedBy = ctx.from.id;
    topic.approvedUsers.add(userId);
    topic.cooldowns?.delete(userId);
    db.markDirty();

    await ctx.answerCbQuery('✅ تم القبول!', { show_alert: true });
    await ctx.editMessageText(
      ctx.callbackQuery.message.text + `\n\n✅ *تم القبول* بواسطة @${ctx.from.username || ctx.from.first_name}`,
      { parse_mode: 'Markdown' }
    );

    // إشعار المستخدم بالقبول
    try {
      await bot.telegram.sendMessage(
        userId,
        `✅ *تم قبول طلبك!*\n\nيمكنك الآن المشاركة في الموضوع "*${topic.name || topicId}*" في *${g.title}*.`,
        { parse_mode: 'Markdown' }
      );
    } catch {}
  });

  // ❌ رفض الطلب
  bot.action(/^ta_deny_(\d+)_(-?\d+)_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const userId  = Number(ctx.match[1]);
    const chatId  = Number(ctx.match[2]);
    const topicId = Number(ctx.match[3]);
    const g = db.getGroup(chatId);
    if (!g) return ctx.answerCbQuery('❌ المجموعة غير موجودة!', { show_alert: true });

    const canAct = isDeveloper(ctx) || ctx.from.id === g.ownerId || await isAdmin(bot, chatId, ctx.from.id);
    if (!canAct) return ctx.answerCbQuery('❌ ليس لديك صلاحية!', { show_alert: true });

    const topic = g.topics.get(topicId);
    if (!topic) return ctx.answerCbQuery('❌ الموضوع غير موجود!', { show_alert: true });

    const req = topic.joinRequests?.get(userId);
    if (!req || req.status !== 'pending')
      return ctx.answerCbQuery('⚠️ الطلب غير موجود أو تمت معالجته!', { show_alert: true });

    // رفض + cooldown
    req.status     = 'rejected';
    req.reviewedAt = new Date();
    req.reviewedBy = ctx.from.id;
    topic.cooldowns.set(userId, Date.now() + TOPIC_REQUEST_COOLDOWN_MS);
    db.markDirty();

    await ctx.answerCbQuery('❌ تم الرفض!', { show_alert: true });
    await ctx.editMessageText(
      ctx.callbackQuery.message.text + `\n\n❌ *تم الرفض* بواسطة @${ctx.from.username || ctx.from.first_name}`,
      { parse_mode: 'Markdown' }
    );

    // إشعار المستخدم بالرفض
    try {
      await bot.telegram.sendMessage(
        userId,
        `❌ *تم رفض طلبك*\n\nطلب الانضمام للموضوع "*${topic.name || topicId}*" في *${g.title}* تم رفضه.\nيمكنك إعادة المحاولة بعد 12 ساعة.`,
        { parse_mode: 'Markdown' }
      );
    } catch {}
  });

  // ⏳ تجاهل (بدون إشعار للمستخدم، مع cooldown قصير)
  bot.action(/^ta_ignore_(\d+)_(-?\d+)_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const userId  = Number(ctx.match[1]);
    const chatId  = Number(ctx.match[2]);
    const topicId = Number(ctx.match[3]);
    const g = db.getGroup(chatId);
    if (!g) return ctx.answerCbQuery('❌ المجموعة غير موجودة!', { show_alert: true });

    const canAct = isDeveloper(ctx) || ctx.from.id === g.ownerId || await isAdmin(bot, chatId, ctx.from.id);
    if (!canAct) return ctx.answerCbQuery('❌ ليس لديك صلاحية!', { show_alert: true });

    const topic = g.topics.get(topicId);
    if (!topic) return ctx.answerCbQuery('❌ الموضوع غير موجود!', { show_alert: true });

    const req = topic.joinRequests?.get(userId);
    if (req) { req.status = 'ignored'; req.reviewedAt = new Date(); db.markDirty(); }

    await ctx.answerCbQuery('⏳ تم التجاهل', { show_alert: true });
    await ctx.editMessageText(
      ctx.callbackQuery.message.text + `\n\n⏳ *تم التجاهل*`,
      { parse_mode: 'Markdown' }
    );
  });

  // 🔍 معلومات الطالب
  bot.action(/^ta_info_(\d+)_(-?\d+)_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const userId  = Number(ctx.match[1]);
    const chatId  = Number(ctx.match[2]);
    const topicId = Number(ctx.match[3]);
    const g = db.getGroup(chatId);
    if (!g) return;

    const topic  = g.topics.get(topicId);
    const req    = topic?.joinRequests?.get(userId);
    const user   = db.getUser(userId);

    let info =
      `🔍 *معلومات الطالب*\n\n` +
      `👤 ${req?.firstName || String(userId)}${req?.username ? ` (@${req.username})` : ''}\n` +
      `🆔 \`${userId}\`\n` +
      `🌍 محظور عالمياً: ${user?.globalBanned ? `✅ — ${user.bannedReason}` : '❌'}\n` +
      `📅 أول ظهور: ${user?.firstSeen ? new Date(user.firstSeen).toLocaleDateString('ar') : 'غير معروف'}\n` +
      `💬 عدد المجموعات: \`${user?.groups?.size || 0}\`\n` +
      `🧵 الطلب: ${req ? new Date(req.requestedAt).toLocaleString('ar') : 'غير محدد'}`;

    const otherReqs = [...(g.topics.values())]
      .filter(t => t !== topic && t.joinRequests?.has(userId) && t.joinRequests.get(userId).status === 'pending')
      .length;
    if (otherReqs) info += `\n⚠️ لديه ${otherReqs} طلب معلق في مواضيع أخرى`;

    await ctx.reply(info, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('✅ قبول',  `ta_allow_${userId}_${chatId}_${topicId}`),
          Markup.button.callback('❌ رفض',   `ta_deny_${userId}_${chatId}_${topicId}`),
        ],
      ]),
    });
  });

  // ════════════════════════════════════════════════════════════
  //  لوحة المواضيع الرئيسية
  // ════════════════════════════════════════════════════════════
  bot.action(/^topics_panel_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId);
    if (!g) return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });

    await ctx.editMessageText(topicsDashboardText(g), {
      parse_mode: 'Markdown',
      ...topicsDashboard(g, chatId),
    });
  });

  // تفعيل/تعطيل نظام طلبات المواضيع
  bot.action(/^tg_toggle_req_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId);
    if (!g) return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });

    g.topicSettings = g.topicSettings || { requireApprovalToJoin: false, ownerBypassAll: true };
    g.topicSettings.requireApprovalToJoin = !g.topicSettings.requireApprovalToJoin;
    db.markDirty();

    const status = g.topicSettings.requireApprovalToJoin;
    await ctx.answerCbQuery(status ? '🔒 طلبات المواضيع مفعّلة!' : '🔓 طلبات المواضيع معطّلة!', { show_alert: true });
    await ctx.editMessageText(topicsDashboardText(g), {
      parse_mode: 'Markdown',
      ...topicsDashboard(g, chatId),
    });
  });

  // ════════════════════════════════════════════════════════════
  //  قائمة المواضيع مع إدارة كل موضوع
  // ════════════════════════════════════════════════════════════
  bot.action(/^tg_list_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId);
    if (!g) return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });

    if (!g.topics.size) {
      return ctx.editMessageText(
        `🧵 *مواضيع ${g.title}*\n\n_لا توجد مواضيع مسجّلة._\n\nاستخدم \`/regtopic\` داخل الموضوع لتسجيله.`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', `topics_panel_${chatId}`)]]),
        }
      );
    }

    let text = `🧵 *مواضيع ${g.title}* (${g.topics.size})\n\n`;
    const rows = [];
    for (const [tid, t] of g.topics.entries()) {
      const pending = t.joinRequests
        ? [...t.joinRequests.values()].filter(r => r.status === 'pending').length
        : 0;
      const statusIcon = t.archived ? '📁' : t.locked ? '🔒' : '🔓';
      text += `${statusIcon} \`${tid}\` *${t.name || 'موضوع'}*`;
      if (pending) text += ` — ⚠️ ${pending} طلب`;
      text += '\n';
      rows.push([
        Markup.button.callback(`${statusIcon} ${(t.name || String(tid)).slice(0, 18)}`, `tg_topic_${chatId}_${tid}`),
        ...(pending ? [Markup.button.callback(`📨 ${pending}`, `tg_topic_pending_${chatId}_${tid}`)] : []),
      ]);
    }
    rows.push([Markup.button.callback('🔙 رجوع', `topics_panel_${chatId}`)]);

    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(rows),
    });
  });

  // ═══════════════════════════════════════════════════
  //  إدارة موضوع فردي
  // ═══════════════════════════════════════════════════
  bot.action(/^tg_topic_(-?\d+)_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId  = Number(ctx.match[1]);
    const topicId = Number(ctx.match[2]);
    const g = db.getGroup(chatId);
    if (!g) return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });

    const topic   = g.topics.get(topicId);
    if (!topic) return ctx.answerCbQuery('❌ الموضوع غير موجود!', { show_alert: true });

    const pending  = topic.joinRequests
      ? [...topic.joinRequests.values()].filter(r => r.status === 'pending').length : 0;
    const approved = topic.approvedUsers?.size || 0;
    const total    = topic.joinRequests?.size  || 0;

    const text =
      `🧵 *${topic.name || String(topicId)}*\n\n` +
      `الحالة: ${topic.archived ? '📁 مؤرشف' : topic.locked ? '🔒 مقفول' : '🔓 مفتوح'}\n` +
      `✅ المعتمدون: \`${approved}\`\n` +
      `📨 الطلبات المعلقة: \`${pending}\`\n` +
      `📋 إجمالي الطلبات: \`${total}\``;

    const rows = [
      [
        Markup.button.callback(topic.locked ? '🔓 فتح' : '🔒 قفل', `tg_lock_${chatId}_${topicId}`),
        Markup.button.callback('📁 أرشفة', `tg_archive_${chatId}_${topicId}`),
      ],
      [
        Markup.button.callback(`📨 طلبات معلقة ${pending ? `(${pending})` : ''}`, `tg_topic_pending_${chatId}_${topicId}`),
        Markup.button.callback('👥 المعتمدون', `tg_approved_${chatId}_${topicId}`),
      ],
      [Markup.button.callback('🗑️ مسح الطلبات المنتهية', `tg_clean_${chatId}_${topicId}`)],
      [Markup.button.callback('🔙 رجوع', `tg_list_${chatId}`)],
    ];

    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(rows) });
  });

  // قفل / فتح موضوع
  bot.action(/^tg_lock_(-?\d+)_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId  = Number(ctx.match[1]);
    const topicId = Number(ctx.match[2]);
    const g = db.getGroup(chatId);
    if (!g) return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });

    const topic = getOrCreateTopic(g, topicId);
    topic.locked = !topic.locked;
    db.markDirty();

    // قفل/فتح التيليغرام
    try {
      await bot.telegram.callApi(topic.locked ? 'closeForumTopic' : 'reopenForumTopic', {
        chat_id:           chatId,
        message_thread_id: topicId,
      });
    } catch {}

    await ctx.answerCbQuery(topic.locked ? '🔒 تم قفل الموضوع!' : '🔓 تم فتح الموضوع!', { show_alert: true });

    // أعد عرض صفحة الموضوع
    const pending  = topic.joinRequests
      ? [...topic.joinRequests.values()].filter(r => r.status === 'pending').length : 0;
    const approved = topic.approvedUsers?.size || 0;
    const text =
      `🧵 *${topic.name || String(topicId)}*\n\n` +
      `الحالة: ${topic.archived ? '📁 مؤرشف' : topic.locked ? '🔒 مقفول' : '🔓 مفتوح'}\n` +
      `✅ المعتمدون: \`${approved}\`\n` +
      `📨 الطلبات المعلقة: \`${pending}\``;
    const rows = [
      [
        Markup.button.callback(topic.locked ? '🔓 فتح' : '🔒 قفل', `tg_lock_${chatId}_${topicId}`),
        Markup.button.callback('📁 أرشفة', `tg_archive_${chatId}_${topicId}`),
      ],
      [
        Markup.button.callback(`📨 طلبات معلقة ${pending ? `(${pending})` : ''}`, `tg_topic_pending_${chatId}_${topicId}`),
        Markup.button.callback('👥 المعتمدون', `tg_approved_${chatId}_${topicId}`),
      ],
      [Markup.button.callback('🔙 رجوع', `tg_list_${chatId}`)],
    ];
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(rows) });
  });

  // أرشفة موضوع
  bot.action(/^tg_archive_(-?\d+)_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId  = Number(ctx.match[1]);
    const topicId = Number(ctx.match[2]);
    const g = db.getGroup(chatId);
    if (!g) return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });

    const topic = getOrCreateTopic(g, topicId);
    topic.archived = !topic.archived;
    topic.locked   = topic.archived ? true : topic.locked;
    db.markDirty();

    try {
      if (topic.archived) {
        await bot.telegram.callApi('closeForumTopic', { chat_id: chatId, message_thread_id: topicId });
      }
    } catch {}

    await ctx.answerCbQuery(topic.archived ? '📁 تم الأرشفة!' : '✅ تم الاسترداد!', { show_alert: true });
    // رجوع للقائمة
    bot.action[`tg_topic_${chatId}_${topicId}`]?.(ctx) ||
    await ctx.editMessageText(`🧵 الموضوع ${topic.archived ? 'مؤرشف' : 'نشط'}.`, {
      ...Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', `tg_list_${chatId}`)]]),
    });
  });

  // ═══════════════════════════════════════════════════
  //  قائمة الطلبات المعلقة لموضوع معين
  // ═══════════════════════════════════════════════════
  bot.action(/^tg_topic_pending_(-?\d+)_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId  = Number(ctx.match[1]);
    const topicId = Number(ctx.match[2]);
    const g = db.getGroup(chatId);
    if (!g) return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });

    const topic   = g.topics.get(topicId);
    if (!topic) return ctx.answerCbQuery('❌ الموضوع غير موجود!', { show_alert: true });

    const pending = topic.joinRequests
      ? [...topic.joinRequests.values()].filter(r => r.status === 'pending')
      : [];

    if (!pending.length) {
      return ctx.editMessageText(
        `📨 *لا توجد طلبات معلقة*\n\nالموضوع: *${topic.name || topicId}*`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', `tg_topic_${chatId}_${topicId}`)]]),
        }
      );
    }

    let text = `📨 *طلبات الموضوع: ${topic.name || topicId}*\n(${pending.length} معلق)\n\n`;
    const rows = [];
    for (const r of pending.slice(0, 6)) {
      const since = Math.floor((Date.now() - new Date(r.requestedAt)) / 60000);
      text += `👤 ${r.firstName}${r.username ? ` (@${r.username})` : ''} — منذ ${since} دق\n`;
      rows.push([
        Markup.button.callback(`✅ ${r.firstName.slice(0, 12)}`, `ta_allow_${r.userId}_${chatId}_${topicId}`),
        Markup.button.callback('❌ رفض', `ta_deny_${r.userId}_${chatId}_${topicId}`),
        Markup.button.callback('🔍', `ta_info_${r.userId}_${chatId}_${topicId}`),
      ]);
    }

    // قبول الكل / رفض الكل
    rows.push([
      Markup.button.callback('✅ قبول الكل', `tg_approveall_${chatId}_${topicId}`),
      Markup.button.callback('❌ رفض الكل',  `tg_denyall_${chatId}_${topicId}`),
    ]);
    rows.push([Markup.button.callback('🔙 رجوع', `tg_topic_${chatId}_${topicId}`)]);

    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(rows) });
  });

  // قبول الكل في موضوع
  bot.action(/^tg_approveall_(-?\d+)_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId  = Number(ctx.match[1]);
    const topicId = Number(ctx.match[2]);
    const g = db.getGroup(chatId);
    if (!g) return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });

    const topic = g.topics.get(topicId);
    if (!topic) return;
    let count = 0;
    for (const [uid, req] of (topic.joinRequests || new Map()).entries()) {
      if (req.status === 'pending') {
        req.status     = 'approved';
        req.reviewedAt = new Date();
        req.reviewedBy = ctx.from.id;
        topic.approvedUsers.add(uid);
        count++;
        try {
          await bot.telegram.sendMessage(uid,
            `✅ *تم قبول طلبك!*\n\nيمكنك الآن المشاركة في الموضوع "*${topic.name || topicId}*".`,
            { parse_mode: 'Markdown' }
          );
        } catch {}
      }
    }
    db.markDirty();
    await ctx.answerCbQuery(`✅ تم قبول ${count} طلب!`, { show_alert: true });
    await ctx.editMessageText(`✅ *تم قبول ${count} طلب.*`, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', `tg_topic_${chatId}_${topicId}`)]]),
    });
  });

  // رفض الكل في موضوع
  bot.action(/^tg_denyall_(-?\d+)_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId  = Number(ctx.match[1]);
    const topicId = Number(ctx.match[2]);
    const g = db.getGroup(chatId);
    if (!g) return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });

    const topic = g.topics.get(topicId);
    if (!topic) return;
    let count = 0;
    for (const [uid, req] of (topic.joinRequests || new Map()).entries()) {
      if (req.status === 'pending') {
        req.status     = 'rejected';
        req.reviewedAt = new Date();
        req.reviewedBy = ctx.from.id;
        topic.cooldowns.set(uid, Date.now() + TOPIC_REQUEST_COOLDOWN_MS);
        count++;
        try {
          await bot.telegram.sendMessage(uid,
            `❌ *تم رفض طلبك*\n\nطلب الانضمام للموضوع "*${topic.name || topicId}*" تم رفضه.`,
            { parse_mode: 'Markdown' }
          );
        } catch {}
      }
    }
    db.markDirty();
    await ctx.answerCbQuery(`❌ تم رفض ${count} طلب!`, { show_alert: true });
    await ctx.editMessageText(`❌ *تم رفض ${count} طلب.*`, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', `tg_topic_${chatId}_${topicId}`)]]),
    });
  });

  // ═══════════════════════════════════════════════════
  //  قائمة الطلبات المعلقة (كل المواضيع)
  // ═══════════════════════════════════════════════════
  bot.action(/^tg_pending_all_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId);
    if (!g) return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });

    const allPending = [];
    for (const [tid, t] of g.topics.entries()) {
      if (!t.joinRequests) continue;
      for (const r of t.joinRequests.values()) {
        if (r.status === 'pending') allPending.push({ topicId: tid, topic: t, req: r });
      }
    }

    if (!allPending.length) {
      return ctx.editMessageText(
        `📨 *لا توجد طلبات معلقة في أي موضوع.*`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', `topics_panel_${chatId}`)]]),
        }
      );
    }

    let text = `📨 *جميع الطلبات المعلقة — ${g.title}*\n(${allPending.length} طلب)\n\n`;
    const rows = [];
    for (const { topicId, topic, req } of allPending.slice(0, 8)) {
      const since = Math.floor((Date.now() - new Date(req.requestedAt)) / 60000);
      text += `🧵 *${topic.name || topicId}* — 👤 ${req.firstName}${req.username ? ` (@${req.username})` : ''} (${since} دق)\n`;
      rows.push([
        Markup.button.callback(`✅ ${req.firstName.slice(0, 10)} ← ${(topic.name || String(topicId)).slice(0, 10)}`, `ta_allow_${req.userId}_${chatId}_${topicId}`),
        Markup.button.callback('❌', `ta_deny_${req.userId}_${chatId}_${topicId}`),
      ]);
    }
    if (allPending.length > 8) text += `_... و ${allPending.length - 8} آخرين_`;

    rows.push([Markup.button.callback('🔙 رجوع', `topics_panel_${chatId}`)]);
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(rows) });
  });

  // ═══════════════════════════════════════════════════
  //  قائمة المعتمدين في موضوع
  // ═══════════════════════════════════════════════════
  bot.action(/^tg_approved_(-?\d+)_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId  = Number(ctx.match[1]);
    const topicId = Number(ctx.match[2]);
    const g = db.getGroup(chatId);
    if (!g) return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });

    const topic = g.topics.get(topicId);
    if (!topic) return ctx.answerCbQuery('❌ الموضوع غير موجود!', { show_alert: true });

    const approved = [...(topic.approvedUsers || new Set())];
    if (!approved.length) {
      return ctx.editMessageText(
        `👥 *لا يوجد مستخدمون معتمدون*\n\nالموضوع: *${topic.name || topicId}*`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', `tg_topic_${chatId}_${topicId}`)]]),
        }
      );
    }

    let text = `👥 *المعتمدون في ${topic.name || topicId}* (${approved.length})\n\n`;
    const rows = [];
    for (const uid of approved.slice(0, 10)) {
      const u = db.getUser(uid);
      const name = u?.username ? `@${u.username}` : (u?.firstName || String(uid));
      text += `• ${name} \`[${uid}]\`\n`;
      rows.push([Markup.button.callback(`🚫 إلغاء إذن ${name.slice(0, 14)}`, `tg_revoke_${chatId}_${topicId}_${uid}`)]);
    }
    rows.push([Markup.button.callback('🔙 رجوع', `tg_topic_${chatId}_${topicId}`)]);

    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(rows) });
  });

  // إلغاء إذن مستخدم
  bot.action(/^tg_revoke_(-?\d+)_(\d+)_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId  = Number(ctx.match[1]);
    const topicId = Number(ctx.match[2]);
    const userId  = Number(ctx.match[3]);
    const g = db.getGroup(chatId);
    if (!g) return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });

    const topic = g.topics.get(topicId);
    if (!topic) return;
    topic.approvedUsers?.delete(userId);
    if (topic.joinRequests?.has(userId)) topic.joinRequests.get(userId).status = 'revoked';
    db.markDirty();

    await ctx.answerCbQuery('🚫 تم إلغاء الإذن!', { show_alert: true });
    await ctx.editMessageText(`🚫 *تم إلغاء إذن المستخدم \`${userId}\`*`, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', `tg_approved_${chatId}_${topicId}`)]]),
    });
  });

  // مسح الطلبات القديمة
  bot.action(/^tg_clean_(-?\d+)_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId  = Number(ctx.match[1]);
    const topicId = Number(ctx.match[2]);
    const g = db.getGroup(chatId);
    if (!g) return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });

    const topic = g.topics.get(topicId);
    if (!topic) return;
    let cleaned = 0;
    for (const [uid, r] of (topic.joinRequests || new Map()).entries()) {
      if (['rejected', 'ignored', 'revoked'].includes(r.status)) {
        topic.joinRequests.delete(uid);
        cleaned++;
      }
    }
    db.markDirty();
    await ctx.answerCbQuery(`🗑️ تم مسح ${cleaned} طلب!`, { show_alert: true });
    await ctx.editMessageText(`🗑️ *تم مسح ${cleaned} طلب منتهٍ من سجل الموضوع.*`, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', `tg_topic_${chatId}_${topicId}`)]]),
    });
  });

  // ════════════════════════════════════════════════════════════
  //  أوامر نصية للمواضيع
  // ════════════════════════════════════════════════════════════

  // /regtopic — تسجيل الموضوع الحالي
  bot.command('regtopic', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, ctx.chat.id, ctx.from.id))
      return ctx.reply('❌ للمشرفين فقط!');
    const topicId = ctx.message.message_thread_id;
    if (!topicId) return ctx.reply('❌ هذا الأمر يُستخدم داخل موضوع فقط!');

    const g     = db.getGroup(ctx.chat.id);
    if (!g) return ctx.reply('❌ بيانات المجموعة غير موجودة!');
    const args  = ctx.message.text.split(' ').slice(1).join(' ').trim();
    const topic = getOrCreateTopic(g, topicId, args || String(topicId));
    if (args) topic.name = args;
    db.markDirty();

    await ctx.reply(
      `✅ *تم تسجيل الموضوع*\n\n🆔 \`${topicId}\`\n📌 الاسم: *${topic.name}*\nالحالة: ${topic.locked ? '🔒 مقفول' : '🔓 مفتوح'}`,
      { parse_mode: 'Markdown' }
    );
  });

  // /locktopic — قفل الموضوع الحالي مع تفعيل نظام الطلبات
  bot.command('locktopic', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, ctx.chat.id, ctx.from.id))
      return ctx.reply('❌ للمشرفين فقط!');
    const topicId = ctx.message.message_thread_id;
    if (!topicId) return ctx.reply('❌ هذا الأمر يُستخدم داخل موضوع!');

    const g = db.getGroup(ctx.chat.id);
    if (!g) return ctx.reply('❌ بيانات المجموعة غير موجودة!');

    const topic    = getOrCreateTopic(g, topicId);
    topic.locked   = true;
    g.topicSettings = g.topicSettings || {};
    g.topicSettings.requireApprovalToJoin = true;
    db.markDirty();

    try {
      await bot.telegram.callApi('closeForumTopic', { chat_id: ctx.chat.id, message_thread_id: topicId });
    } catch {}

    await ctx.reply(
      `🔒 *تم قفل الموضوع*\n\nالموضوع \`${topicId}\` مغلق الآن.\nلا يمكن لأحد الكتابة فيه إلا بعد الموافقة.\n\n_استخدم /unlocktopic لفتحه._`,
      { parse_mode: 'Markdown' }
    );
  });

  // /unlocktopic — فتح الموضوع
  bot.command('unlocktopic', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, ctx.chat.id, ctx.from.id))
      return ctx.reply('❌ للمشرفين فقط!');
    const topicId = ctx.message.message_thread_id;
    if (!topicId) return ctx.reply('❌ هذا الأمر يُستخدم داخل موضوع!');

    const g = db.getGroup(ctx.chat.id);
    if (!g) return ctx.reply('❌ بيانات المجموعة غير موجودة!');

    const topic  = getOrCreateTopic(g, topicId);
    topic.locked = false;
    db.markDirty();

    try {
      await bot.telegram.callApi('reopenForumTopic', { chat_id: ctx.chat.id, message_thread_id: topicId });
    } catch {}

    await ctx.reply(`🔓 *تم فتح الموضوع \`${topicId}\`*`, { parse_mode: 'Markdown' });
  });

  // /topicrequest on|off — تفعيل/تعطيل نظام الطلبات للمجموعة
  bot.command('topicrequest', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, ctx.chat.id, ctx.from.id))
      return ctx.reply('❌ للمشرفين فقط!');

    const arg = ctx.message.text.split(' ')[1]?.toLowerCase();
    if (!['on', 'off'].includes(arg))
      return ctx.reply('⚙️ الاستخدام: `/topicrequest on` أو `/topicrequest off`', { parse_mode: 'Markdown' });

    const g = db.getGroup(ctx.chat.id);
    if (!g) return ctx.reply('❌ بيانات المجموعة غير موجودة!');

    g.topicSettings = g.topicSettings || {};
    g.topicSettings.requireApprovalToJoin = arg === 'on';
    db.markDirty();

    await ctx.reply(
      arg === 'on'
        ? `🔒 *تم تفعيل طلبات دخول المواضيع*\n\nالمواضيع المقفلة تتطلب موافقة للمشاركة.`
        : `🔓 *تم تعطيل طلبات دخول المواضيع*\n\nيمكن للجميع الكتابة في المواضيع المفتوحة.`,
      { parse_mode: 'Markdown' }
    );
  });

  // /approveuser @user — الموافقة اليدوية على مستخدم في الموضوع الحالي
  bot.command('approveuser', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, ctx.chat.id, ctx.from.id))
      return ctx.reply('❌ للمشرفين فقط!');

    const topicId = ctx.message.message_thread_id;
    if (!topicId) return ctx.reply('❌ هذا الأمر يُستخدم داخل موضوع!');

    const g = db.getGroup(ctx.chat.id);
    if (!g) return;

    // الحصول على المستخدم المستهدف
    let targetId = null;
    if (ctx.message.reply_to_message?.from) {
      targetId = ctx.message.reply_to_message.from.id;
    } else {
      const args = ctx.message.text.split(' ');
      if (args[1]) {
        const arg = args[1].replace('@', '');
        try {
          const m = await bot.telegram.getChatMember(ctx.chat.id, isNaN(arg) ? arg : Number(arg));
          if (m?.user) targetId = m.user.id;
        } catch {}
      }
    }

    if (!targetId) return ctx.reply('❌ حدد مستخدماً بالرد عليه أو بذكر @username!');

    const topic = getOrCreateTopic(g, topicId);
    topic.approvedUsers.add(targetId);
    if (topic.joinRequests?.has(targetId)) {
      topic.joinRequests.get(targetId).status = 'approved';
    }
    db.markDirty();

    // إشعار المستخدم
    try {
      await bot.telegram.sendMessage(
        targetId,
        `✅ *تمت الموافقة عليك*\n\nيمكنك الآن الكتابة في الموضوع "*${topic.name || topicId}*" في *${g.title}*.`,
        { parse_mode: 'Markdown' }
      );
    } catch {}

    await ctx.reply(`✅ تمت الموافقة على \`${targetId}\` في الموضوع.`, { parse_mode: 'Markdown' });
  });

  // /revokeuser @user — إلغاء إذن مستخدم
  bot.command('revokeuser', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, ctx.chat.id, ctx.from.id))
      return ctx.reply('❌ للمشرفين فقط!');

    const topicId = ctx.message.message_thread_id;
    if (!topicId) return ctx.reply('❌ هذا الأمر يُستخدم داخل موضوع!');

    const g = db.getGroup(ctx.chat.id);
    if (!g) return;

    let targetId = null;
    if (ctx.message.reply_to_message?.from) {
      targetId = ctx.message.reply_to_message.from.id;
    } else {
      const args = ctx.message.text.split(' ');
      if (args[1]) {
        const arg = args[1].replace('@', '');
        try {
          const m = await bot.telegram.getChatMember(ctx.chat.id, isNaN(arg) ? arg : Number(arg));
          if (m?.user) targetId = m.user.id;
        } catch {}
      }
    }

    if (!targetId) return ctx.reply('❌ حدد مستخدماً بالرد عليه أو بذكر @username!');

    const topic = g.topics.get(topicId);
    if (topic) {
      topic.approvedUsers?.delete(targetId);
      if (topic.joinRequests?.has(targetId)) topic.joinRequests.get(targetId).status = 'revoked';
      db.markDirty();
    }

    await ctx.reply(`🚫 تم إلغاء إذن \`${targetId}\` في الموضوع.`, { parse_mode: 'Markdown' });
  });

  // /mytopics — المستخدم يرى المواضيع المتاحة له (في الخاص)
  bot.command('mytopics', async (ctx) => {
    if (ctx.chat.type !== 'private') return ctx.reply('ℹ️ هذا الأمر يعمل في الخاص فقط.');
    const userId  = ctx.from.id;
    const myGroups = db.allGroups().filter(g =>
      g.topicSettings?.requireApprovalToJoin && g.topics.size > 0
    );

    if (!myGroups.length) return ctx.reply('لا توجد مجموعات مفعّل فيها نظام المواضيع.');

    let text = `🧵 *مواضيعك المعتمدة*\n\n`;
    let found = false;
    for (const g of myGroups) {
      const mine = [...g.topics.entries()]
        .filter(([, t]) => t.approvedUsers?.has(userId));
      if (mine.length) {
        found = true;
        text += `*${g.title}*\n`;
        mine.forEach(([tid, t]) => { text += `  ✅ ${t.name || tid}\n`; });
        text += '\n';
      }
    }
    if (!found) text += '_لم تُعتمد في أي موضوع حتى الآن._';
    await ctx.replyWithMarkdown(text);
  });

};
