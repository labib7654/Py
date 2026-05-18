/**
 * ═══════════════════════════════════════════════════════════════
 *  verify_actions.js — معالجات قبول/رفض/حظر طلبات التحقق
 *
 *  يشمل:
 *  ✅ قبول الطلب (vfy_allow)
 *  ❌ رفض الطلب (vfy_deny)
 *  🚫 رفض وحظر (vfy_ban)
 *  🔍 تفاصيل الطالب (vfy_info)
 *  🔒 فلتر الرسائل داخل المجموعة
 *  🔄 فحص دوري للأعضاء الموجودين
 * ═══════════════════════════════════════════════════════════════
 */

const db = require('./db');
const { isDeveloper, isAdmin } = require('./helpers');
const {
  getOrCreateTopic,
  getVerifySettings,
  buildAdminButtons,
  unrestrictUser,
  restrictUser,
  checkAndRestrictExistingMember,
  openTopicForApprovedUser,
  closeTopic,
  openTopic,
} = require('./verify_helpers');

module.exports = function setupVerifyActions(bot) {

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

    // فتح موضوع الكلية عبر Telegram API الحقيقي
    const topic = getOrCreateTopic(g, topicId, req.data.topicName);
    topic.approvedUsers.add(userId);
    db.markDirty();

    // فتح الموضوع فعلياً في Telegram
    await openTopicForApprovedUser(bot, chatId, topicId);

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

    // cooldown 24 ساعة
    const { VERIFY_COOLDOWN_MS } = require('./verify_helpers');
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
  //  🔄 فحص دوري — تقييد الأعضاء الموجودين غير المعتمدين
  //  يعمل كل 30 دقيقة على كل المجموعات التي نظام التحقق مفعّل فيها
  // ════════════════════════════════════════════════════════════
  async function runPeriodicCheck() {
    const allGroups = db.allGroups();
    for (const g of allGroups) {
      const vs = getVerifySettings(g);
      if (!vs.enabled) continue;

      // جلب أعضاء المجموعة
      try {
        // نستخدم العضويات المسجلة في DB
        for (const [userId] of (g.members || new Map()).entries()) {
          // تجاهل البوتات (نتحقق من DB)
          const user = db.getUser(userId);
          if (!user) continue;

          await checkAndRestrictExistingMember(bot, g.chatId, userId, g);

          // delay صغير لتجنب flood
          await new Promise(r => setTimeout(r, 200));
        }
      } catch (e) {
        console.error(`[PeriodicCheck] error for ${g.chatId}:`, e.message);
      }
    }
  }

  // بدء الفحص الدوري بعد دقيقة من تشغيل البوت
  setTimeout(() => {
    runPeriodicCheck().catch(console.error);
    setInterval(() => runPeriodicCheck().catch(console.error), 30 * 60 * 1000);
  }, 60 * 1000);

};
