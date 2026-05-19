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
  checkAndRestrictExistingMember,
} = require('./verify_helpers');

// تتبع آخر رسالة تحقق أُرسلت للعضو (لتجنب الإزعاج المتكرر)
// Map: userId -> timestamp
const _verifyNoticeSent = new Map();
const NOTICE_COOLDOWN = 10 * 60 * 1000; // 10 دقائق

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

    // ── ربط الكلية بموضوع المجموعة ──────────────────────────
    const { getAvailableTopics } = require('./verify_helpers');
    const availableTopics = getAvailableTopics(g);
    const matchedTopic = availableTopics.find(t =>
      t.name.includes(req.data?.university || '') ||
      (req.data?.university || '').includes(t.name) ||
      t.name.includes(req.data?.major || '') ||
      (req.data?.major || '').includes(t.name)
    ) || availableTopics[0] || null;

    // حفظ الاعتماد مع بيانات الموضوع
    vs.approvedMembers.set(userId, {
      studentData: { ...req.data },
      topicId:    matchedTopic?.id   || null,
      topicName:  matchedTopic?.name || req.data?.university || null,
      approvedAt:  new Date(),
      approvedBy:  ctx.from.id,
    });

    // قبول/رفع تقييد طلب الانضمام
    const jr = g.joinRequests?.get(userId);
    if (jr && (jr.status === 'pending_verify' || jr.status === 'pending')) {
      if (jr.isExistingMember) {
        // عضو قديم → ارفع التقييد
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
          jr.status = 'approved_by_admin';
        } catch (e) { console.log('[vfy_allow] unrestrict:', e.message); }
      } else {
        // عضو جديد → قبول طلب الانضمام
        try {
          await bot.telegram.approveChatJoinRequest(chatId, userId);
          jr.status = 'approved_by_admin';
        } catch (e) {
          console.log('[vfy_allow] approveChatJoinRequest:', e.message);
        }
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
  //  الأعضاء الجدد: انضموا بدون تحقق (نادر)
  //  الأعضاء القدامى: موجودون قبل تفعيل النظام → يُقيَّدون ويُرسل لهم رابط تحقق
  // ════════════════════════════════════════════════════════════
  bot.on('message', async (ctx, next) => {
    if (!ctx.chat || ctx.chat.type === 'private' || !ctx.from) return next();

    const g = db.getGroup(ctx.chat.id);
    if (!g) return next();

    const vs = getVerifySettings(g);
    if (!vs.enabled) return next();

    const userId = ctx.from.id;

    // مشرفون ومطور → مسموح دائماً
    if (isDeveloper(ctx) || await isAdmin(bot, ctx.chat.id, userId)) return next();

    // معتمد → مسموح
    if (vs.approvedMembers.has(userId)) return next();

    // رسائل خدمة (انضمام/مغادرة) → احذف
    const msg = ctx.message;
    if (msg.new_chat_members || msg.left_chat_member) {
      try { await ctx.deleteMessage(); } catch {}
      return;
    }

    // ── العضو غير معتمد (قديم أو جديد تجاوز الفلتر) ──────────
    // 1. احذف الرسالة
    try { await ctx.deleteMessage(); } catch {}

    // 2. قيّده داخل المجموعة (إذا لم يكن مقيداً بعد)
    try {
      await bot.telegram.restrictChatMember(ctx.chat.id, userId, {
        permissions: {
          can_send_messages: false, can_send_audios: false,
          can_send_documents: false, can_send_photos: false,
          can_send_videos: false, can_send_video_notes: false,
          can_send_voice_notes: false, can_send_polls: false,
          can_send_other_messages: false, can_add_web_page_previews: false,
        },
      });
    } catch {}

    // 3. أرسل له رسالة تحقق في الخاص (مرة كل 10 دقائق)
    const lastNotice = _verifyNoticeSent.get(userId);
    if (!lastNotice || (Date.now() - lastNotice) > NOTICE_COOLDOWN) {
      _verifyNoticeSent.set(userId, Date.now());

      // تسجيله في joinRequests حتى يتمكن من إكمال /start verify_chatId
      if (!g.joinRequests) g.joinRequests = new Map();
      if (!g.joinRequests.has(userId)) {
        g.joinRequests.set(userId, {
          userId,
          username:         ctx.from.username || '',
          firstName:        ctx.from.first_name || String(userId),
          status:           'pending_verify',
          requestedAt:      new Date(),
          isExistingMember: true,
        });
        db.markDirty();
      }

      try {
        const botInfo = await bot.telegram.getMe();
        await bot.telegram.sendMessage(userId,
          `🔐 *مرحباً ${ctx.from.first_name || ''}!*\\n\\n` +
          `تم تقييد وصولك في *${g.title}* لأن هذه المجموعة تتطلب التحقق من هويتك الجامعية.\\n\\n` +
          `📋 اضغط الزر أدناه لإكمال خطوات التسجيل والحصول على وصول كامل:`,
          {
            parse_mode: 'Markdown',
            ...require('telegraf').Markup.inlineKeyboard([[
              require('telegraf').Markup.button.url(
                '✅ بدء التحقق الجامعي',
                `https://t.me/${botInfo.username}?start=verify_${ctx.chat.id}`
              )
            ]]),
          }
        );
      } catch {
        // المستخدم حظر البوت أو لم يبدأ محادثة → لا شيء
      }
    }
  });

};
