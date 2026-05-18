/**
 * ═══════════════════════════════════════════════════════════════
 *  verify_actions.js — معالجات قبول/رفض/حظر طلبات التحقق
 *
 *  ✅ قبول (vfy_allow) → approveChatJoinRequest
 *  ❌ رفض  (vfy_deny)  → declineChatJoinRequest + cooldown
 *  🚫 رفض وحظر (vfy_ban)
 *  🔍 تفاصيل الطالب (vfy_info)
 *  🔒 فلتر رسائل الأعضاء غير المعتمدين داخل المجموعة
 * ═══════════════════════════════════════════════════════════════
 */

const db = require('./db');
const { isDeveloper, isAdmin } = require('./helpers');
const {
  getVerifySettings,
  buildAdminButtons,
  VERIFY_COOLDOWN_MS,
} = require('./verify_helpers');

module.exports = function setupVerifyActions(bot) {

  // ════════════════════════════════════════════════════════════
  //  ✅ قبول الطلب — يدوياً من المشرف
  // ════════════════════════════════════════════════════════════
  bot.action(/^vfy_allow_(\d+)_(-?\d+)$/, async (ctx) => {
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

    // تحديث الطلب
    req.status     = 'approved';
    req.reviewedAt = new Date();
    req.reviewedBy = ctx.from.id;

    // حفظ الاعتماد
    vs.approvedMembers.set(userId, {
      studentData: { ...req.data },
      approvedAt:  new Date(),
      approvedBy:  ctx.from.id,
    });

    // قبول طلب الانضمام عبر Telegram
    const jr = g.joinRequests?.get(userId);
    if (jr && (jr.status === 'pending_verify' || jr.status === 'pending')) {
      try {
        await bot.telegram.approveChatJoinRequest(chatId, userId);
        jr.status = 'approved_by_admin';
      } catch (e) {
        // قد يكون انتهى الطلب أو انضم بالفعل — ليس خطأ فادحاً
        console.log('[vfy_allow] approveChatJoinRequest:', e.message);
      }
    }

    db.markDirty();

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
        `أهلاً بك في *${g.title}* 🎓\n\n` +
        `✅ تم قبول انضمامك. يمكنك الآن الدخول والمشاركة!\n\n` +
        `_إذا واجهت أي مشكلة، تواصل مع المشرف._`,
        { parse_mode: 'Markdown' }
      );
    } catch {}

    await ctx.answerCbQuery('✅ تم القبول وقبول طلب الانضمام!', { show_alert: true });
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

    // cooldown 24 ساعة
    vs.cooldowns.set(userId, Date.now() + VERIFY_COOLDOWN_MS);

    // رفض طلب الانضمام
    const jr = g.joinRequests?.get(userId);
    if (jr && (jr.status === 'pending_verify' || jr.status === 'pending')) {
      try {
        await bot.telegram.declineChatJoinRequest(chatId, userId);
        jr.status = 'rejected';
      } catch (e) { console.log('[vfy_deny] declineChatJoinRequest:', e.message); }
    }

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
        `⏳ يمكنك إعادة المحاولة بعد *24 ساعة* بالضغط على رابط المجموعة مجدداً.\n\n` +
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

    // رفض طلب الانضمام
    const jr = g.joinRequests?.get(userId);
    if (jr) {
      try { await bot.telegram.declineChatJoinRequest(chatId, userId); jr.status = 'banned'; db.markDirty(); } catch {}
    }

    // حظر من المجموعة
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

    const vs  = getVerifySettings(g);
    const req = vs.pendingRequests.get(userId);
    const user = db.getUser(userId);

    const info =
      `🔍 *تفاصيل الطالب*\n\n` +
      `👤 ${req?.firstName || String(userId)}${req?.username ? ` (@${req.username})` : ''}\n` +
      `🆔 \`${userId}\`\n` +
      `📅 أول ظهور: ${user?.firstSeen ? new Date(user.firstSeen).toLocaleDateString('ar-SA') : 'غير معروف'}\n` +
      `🌍 محظور عالمياً: ${user?.globalBanned ? `✅ — ${user.bannedReason}` : '❌'}\n\n` +
      `📋 *البيانات المُدخلة:*\n` +
      `👤 الاسم: *${req?.data?.fullName || 'غير محدد'}*\n` +
      `🏛️ الجامعة: *${req?.data?.university || 'غير محدد'}*\n` +
      `📚 التخصص: *${req?.data?.major || 'غير محدد'}*\n` +
      `🔢 الرقم الجامعي: \`${req?.data?.studentId || 'غير محدد'}\`\n` +
      `📱 الجوال: \`${req?.data?.phone || 'غير محدد'}\`\n` +
      `🕐 تاريخ الطلب: ${req?.submittedAt ? new Date(req.submittedAt).toLocaleString('ar-SA') : 'غير محدد'}`;

    await ctx.reply(info, {
      parse_mode: 'Markdown',
      ...buildAdminButtons(userId, chatId),
    });
  });


  // ════════════════════════════════════════════════════════════
  //  🔒 فلتر رسائل الأعضاء غير المعتمدين داخل المجموعة
  //  (يعمل إذا دخل أحدهم بطريقة ما بدون تحقق)
  // ════════════════════════════════════════════════════════════
  bot.on('message', async (ctx, next) => {
    if (!ctx.chat || ctx.chat.type === 'private' || !ctx.from) return next();

    const g = db.getGroup(ctx.chat.id);
    if (!g) return next();

    const vs = getVerifySettings(g);
    if (!vs.enabled) return next();

    const userId = ctx.from.id;

    // مشرفون ومطور → مسموح
    if (isDeveloper(ctx) || await isAdmin(bot, ctx.chat.id, userId)) return next();

    // معتمد → مسموح
    if (vs.approvedMembers.has(userId)) return next();

    // رسائل خدمة (انضمام/مغادرة) → احذف
    const msg = ctx.message;
    if (msg.new_chat_members || msg.left_chat_member) {
      try { await ctx.deleteMessage(); } catch {}
      return;
    }

    // غير معتمد → احذف بصمت
    try { await ctx.deleteMessage(); } catch {}
  });

};
