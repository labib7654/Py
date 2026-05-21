/**
 * ═══════════════════════════════════════════════════════════════
 *  verify_registration.js — معالجة نظام التحقق الجامعي الجديد
 *
 *  المنطق الجديد:
 *  1. المستخدم يضغط "طلب الانضمام" في المجموعة
 *  2. chat_join_request يُعترض → يُرسل له رابط البوت الخاص
 *  3. في الخاص: /start verify_<chatId>
 *  4. خطوات: نوع المستخدم ← جامعة ← تخصص ← اسم رباعي ← رقم جامعي ← تحقق جوال
 *  5. بعد الإرسال: قبول تلقائي بعد دقيقتين أو يدوي
 * ═══════════════════════════════════════════════════════════════
 */

const db = require('./db');
const { isDeveloper, isAdmin } = require('./helpers');
const {
  SAUDI_UNIVERSITIES,
  AUTO_APPROVE_DELAY,
  sessions,
  getVerifySettings,
  buildAdminNotification,
  buildAdminButtons,
  notifyAll,
  restrictUser,
  stepWelcome,
  stepSelectUniversity,
  stepMajor,
  stepFullName,
  stepStudentId,
  stepPhoneVerify,
  stepRequestContact,
  stepConfirm,
  getAvailableTopics,
  findBestTopicMatch,
  calcVerificationScore,
} = require('./verify_helpers');

module.exports = function setupVerifyRegistration(bot) {

  // ════════════════════════════════════════════════════════════
  //  📥 chat_join_request — اعتراض طلب الانضمام
  //  يُشغَّل عندما يضغط أي شخص "طلب الانضمام" في المجموعة
  // ════════════════════════════════════════════════════════════
  bot.on('chat_join_request', async (ctx, next) => {
    const req    = ctx.chatJoinRequest;
    if (!req) return next();

    const chatId = req.chat.id;
    const userId = req.from.id;
    const user   = req.from;

    const g = db.getGroup(chatId);
    if (!g) return next();

    const vs = getVerifySettings(g);
    if (!vs.enabled) {
      try { await bot.telegram.approveChatJoinRequest(chatId, userId); } catch {}
      return next();
    }

    if (user.is_bot) {
      try { await bot.telegram.approveChatJoinRequest(chatId, userId); } catch {}
      return next();
    }

    // ── معتمد مسبقاً ─────────────────────────────────────────
    if (vs.approvedMembers.has(userId)) {
      try { await bot.telegram.approveChatJoinRequest(chatId, userId); } catch {}
      try {
        await bot.telegram.sendMessage(userId,
          `✅ *أنت مُعتمَد مسبقاً!*\n\nتم قبول انضمامك في *${g.title}* تلقائياً.`,
          { parse_mode: 'Markdown' }
        );
      } catch {}
      return next();
    }

    // ── كوولداون من رفض سابق ─────────────────────────────────
    const cooldown = vs.cooldowns.get(userId);
    if (cooldown && cooldown > Date.now()) {
      const hrs = Math.ceil((cooldown - Date.now()) / 3600000);
      try {
        await bot.telegram.declineChatJoinRequest(chatId, userId);
        await bot.telegram.sendMessage(userId,
          `⏳ *طلبك مرفوض مؤقتاً*\n\nيمكنك إعادة المحاولة بعد \`${hrs}\` ساعة.`,
          { parse_mode: 'Markdown' }
        );
      } catch {}
      return next();
    }

    // ── طلب معلق بالفعل ──────────────────────────────────────
    const existing = vs.pendingRequests.get(userId);
    if (existing?.status === 'pending') {
      try {
        await bot.telegram.sendMessage(userId,
          `📨 *لديك طلب قيد المراجعة.*\n\nانتظر حتى يراجعه المشرف وستصلك رسالة بالنتيجة.`,
          { parse_mode: 'Markdown' }
        );
      } catch {}
      return next();
    }

    // ── تسجيل طلب الانضمام في DB ─────────────────────────────
    if (!g.joinRequests) g.joinRequests = new Map();
    g.joinRequests.set(userId, {
      userId,
      username:    user.username  || '',
      firstName:   user.first_name || String(userId),
      status:      'pending_verify',
      requestedAt: new Date(),
    });
    db.markDirty();

    // ════════════════════════════════════════════════════════════
    //  🔒 RACE CONDITION FIX
    //  نقبل الطلب أولاً (يدخل المجموعة) ثم نقيّده فوراً
    //  هذا يضمن أنه لن يستطيع الكتابة قبل إكمال التحقق
    // ════════════════════════════════════════════════════════════
    try {
      await bot.telegram.approveChatJoinRequest(chatId, userId);
    } catch (e) {
      console.warn(`[JoinRequest] فشل قبول الطلب لـ ${userId}:`, e.message);
    }

    // تقييد فوري بعد القبول مباشرة
    const restricted = await restrictUser(bot, chatId, userId);

    // verification loop — نتحقق أن التقييد نجح (يعوّض عن API lag)
    if (!restricted) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        await new Promise(r => setTimeout(r, attempt * 1500));
        const retried = await restrictUser(bot, chatId, userId);
        if (retried) break;
        if (attempt === 3) {
          console.warn(`[JoinRequest] فشل تقييد ${userId} بعد 3 محاولات في ${chatId}`);
        }
      }
    }

    // ── إرسال رابط التحقق للمستخدم ───────────────────────────
    const botInfo = await bot.telegram.getMe();
    try {
      await bot.telegram.sendMessage(userId,
        `👋 *أهلاً بك!*\n\n` +
        `انضممت لـ *${g.title}* لكن وصولك مقيّد مؤقتاً.\n\n` +
        `🔐 هذه مجموعة تتطلب التحقق من هويتك الجامعية.\n` +
        `اضغط الزر أدناه لإكمال خطوات التسجيل:`,
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
    } catch (e) {
      // المستخدم حظر البوت → نطرده لأنه لن يستطيع إكمال التحقق
      console.warn(`[JoinRequest] لا يمكن إرسال رسالة لـ ${userId}:`, e.message);
      try {
        await bot.telegram.banChatMember(chatId, userId);
        await bot.telegram.unbanChatMember(chatId, userId); // kick
        const jr2 = g.joinRequests?.get(userId);
        if (jr2) { jr2.status = 'rejected_bot_blocked'; db.markDirty(); }
      } catch {}
    }
  });;




  // ════════════════════════════════════════════════════════════
  //  🔘 الخطوة 0: نوع المستخدم
  // ════════════════════════════════════════════════════════════
  bot.action('vs_student', async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    const sess   = sessions.get(userId);
    if (!sess) return ctx.reply('⚠️ انتهت الجلسة. اضغط الرابط مجدداً.');

    sess.data.type = 'student';
    sess.step      = 'university';
    try { await ctx.deleteMessage(); } catch {}
    await stepSelectUniversity(bot, userId, 0);
  });

  bot.action('vs_applicant', async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    const sess   = sessions.get(userId);
    if (!sess) return ctx.reply('⚠️ انتهت الجلسة. اضغط الرابط مجدداً.');

    sess.data.type = 'applicant';
    sess.step      = 'university';
    try { await ctx.deleteMessage(); } catch {}
    // للمتقدم نفس الخطوات
    await stepSelectUniversity(bot, userId, 0);
  });


  // ════════════════════════════════════════════════════════════
  //  🔘 اختيار الجامعة (بالرقم في المصفوفة)
  // ════════════════════════════════════════════════════════════
  bot.action(/^vsu_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    const idx    = Number(ctx.match[1]);
    const sess   = sessions.get(userId);
    if (!sess) return ctx.reply('⚠️ انتهت الجلسة. اضغط الرابط مجدداً.');

    const uni = SAUDI_UNIVERSITIES[idx];
    if (!uni) return ctx.answerCbQuery('❌ جامعة غير موجودة!', { show_alert: true });

    sess.data.university = uni;
    sess.step            = 'major';
    try { await ctx.deleteMessage(); } catch {}
    await stepMajor(bot, userId, uni);
  });

  // تنقل بين صفحات الجامعات
  bot.action(/^vsu_pg_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    const page   = Number(ctx.match[1]);
    try { await ctx.deleteMessage(); } catch {}
    await stepSelectUniversity(bot, userId, page);
  });


  // ════════════════════════════════════════════════════════════
  //  💬 معالج الرسائل النصية في الخاص
  // ════════════════════════════════════════════════════════════
  bot.on('message', async (ctx, next) => {
    if (ctx.chat.type !== 'private') return next();
    const userId = ctx.from.id;
    const sess   = sessions.get(userId);
    if (!sess) return next();

    // معالجة مشاركة جهات الاتصال (رقم الجوال)
    if (ctx.message.contact) {
      if (sess.step === 'phone') {
        const contact = ctx.message.contact;
        // تأكد أن المستخدم شارك رقمه هو وليس رقم شخص آخر
        if (contact.user_id && contact.user_id !== userId) {
          return ctx.reply('⚠️ يرجى مشاركة *رقمك الشخصي* فقط، وليس رقم شخص آخر.', { parse_mode: 'Markdown' });
        }
        sess.data.phone = contact.phone_number;
        sess.step       = 'confirm';

        // إغلاق لوحة المفاتيح
        await ctx.reply('✅ تم استلام رقمك.', {
          reply_markup: { remove_keyboard: true },
        });
        await stepConfirm(bot, userId, sess.data);
      }
      return;
    }

    const text = ctx.message.text?.trim() || '';

    // خطوة التخصص
    if (sess.step === 'major') {
      if (!text || text.length < 3) {
        return ctx.reply('⚠️ يرجى كتابة اسم التخصص بشكل صحيح (3 أحرف على الأقل):');
      }
      sess.data.major = text;
      sess.step       = 'full_name';
      await stepFullName(bot, userId);
      return;
    }

    // خطوة الاسم الرباعي
    if (sess.step === 'full_name') {
      const parts = text.split(/\s+/).filter(Boolean);
      if (parts.length < 4) {
        return ctx.reply('⚠️ يرجى إدخال الاسم الرباعي كاملاً (4 كلمات على الأقل):');
      }
      sess.data.fullName = text;
      sess.step          = 'student_id';
      await stepStudentId(bot, userId);
      return;
    }

    // خطوة الرقم الجامعي
    if (sess.step === 'student_id') {
      if (!text || text.length < 5 || !/^\d+/.test(text)) {
        return ctx.reply('⚠️ رقم القيد يجب أن يبدأ بأرقام ولا يقل عن 5 خانات. حاول مجدداً:');
      }
      sess.data.studentId = text;
      sess.step           = 'phone';
      await stepPhoneVerify(bot, userId);
      return;
    }

    return next();
  });


  // ════════════════════════════════════════════════════════════
  //  🔘 الموافقة على التحقق → طلب رقم الجوال
  // ════════════════════════════════════════════════════════════
  bot.action('vs_phone_agree', async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    const sess   = sessions.get(userId);
    if (!sess) return ctx.reply('⚠️ انتهت الجلسة.');

    try { await ctx.deleteMessage(); } catch {}
    await stepRequestContact(bot, userId);
  });


  // ════════════════════════════════════════════════════════════
  //  🔘 تأكيد وإرسال الطلب
  // ════════════════════════════════════════════════════════════
  bot.action('vstep_confirm', async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    const sess   = sessions.get(userId);
    if (!sess) return ctx.reply('⚠️ انتهت جلسة التسجيل.');

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
      `👤 الاسم: *${sess.data.fullName}*\n` +
      `🏛️ الجامعة: *${sess.data.university}*\n` +
      `📚 التخصص: *${sess.data.major}*\n` +
      `🔢 الرقم الجامعي: \`${sess.data.studentId}\`\n` +
      `📱 الجوال: \`${sess.data.phone}\`\n\n` +
      `⏳ *جاري المراجعة...*\n` +
      `سيتم قبولك تلقائياً خلال دقيقتين، أو يدوياً من المشرف.\n\n` +
      `_شكراً لصبرك!_`,
      { parse_mode: 'Markdown' }
    );

    // إشعار الإدارة
    const notifText = buildAdminNotification(g, userId, ctx.from, sess.data);
    const notifBtns = buildAdminButtons(userId, sess.chatId);
    await notifyAll(bot, g, notifText, notifBtns);

    // ── Smart Auto-Approve بناءً على VerificationScore ────────
    const { score, delay } = calcVerificationScore(sess.data);

    if (delay === null) {
      // Score منخفض → يبقى pending للمشرف
      await ctx.reply(
        `⏳ *طلبك قيد المراجعة اليدوية*\n\nسيراجع المشرف بياناتك ويردّ عليك قريباً.\n_شكراً لصبرك!_`,
        { parse_mode: 'Markdown' }
      );
    } else {
      const delayMins = Math.round(delay / 60000);
      await ctx.reply(
        `✅ *تم إرسال طلبك بنجاح!*\n\n` +
        `📋 *ملخص بياناتك:*\n` +
        `👤 الاسم: *${sess.data.fullName}*\n` +
        `🏛️ الجامعة: *${sess.data.university}*\n` +
        `📚 التخصص: *${sess.data.major}*\n` +
        `🔢 الرقم الجامعي: \`${sess.data.studentId}\`\n` +
        `📱 الجوال: \`${sess.data.phone}\`\n\n` +
        `⏳ *جاري المراجعة...*\n` +
        `سيتم قبولك تلقائياً خلال *${delayMins} دقيقة*، أو يدوياً من المشرف.\n\n` +
        `_شكراً لصبرك!_`,
        { parse_mode: 'Markdown' }
      );

      setTimeout(async () => {
        const g2  = db.getGroup(sess.chatId);
        if (!g2) return;
        const vs2 = getVerifySettings(g2);
        const req = vs2.pendingRequests.get(userId);
        if (!req || req.status !== 'pending') return;

        req.status     = 'approved_auto';
        req.reviewedAt = new Date();

        // رفع التقييد
        const jr = g2.joinRequests?.get(userId);
        if (jr && (jr.status === 'pending_verify' || jr.status === 'pending')) {
          try {
            if (jr.isExistingMember) {
              await bot.telegram.restrictChatMember(sess.chatId, userId, {
                permissions: {
                  can_send_messages: true, can_send_audios: true,
                  can_send_documents: true, can_send_photos: true,
                  can_send_videos: true, can_send_video_notes: true,
                  can_send_voice_notes: true, can_send_polls: true,
                  can_send_other_messages: true, can_add_web_page_previews: true,
                },
              });
            } else {
              await bot.telegram.approveChatJoinRequest(sess.chatId, userId);
            }
            jr.status = 'approved_auto';
          } catch (e) { console.warn('[AutoApprove]', e.message); }
        }

        // Fuzzy match للكلية
        const availableTopics  = getAvailableTopics(g2);
        const matchedTopic     = findBestTopicMatch(availableTopics, sess.data);

        vs2.approvedMembers.set(userId, {
          studentData: { ...sess.data },
          topicId:    matchedTopic?.id   || null,
          topicName:  matchedTopic?.name || sess.data?.university || null,
          approvedAt:  new Date(),
          approvedBy:  'auto',
          score,
        });
        db.markDirty();

        try {
          await bot.telegram.sendMessage(userId,
            `🎉 *تم قبول انضمامك تلقائياً!*\n\n` +
            `أهلاً بك في *${g2.title}* 🎓\n` +
            (matchedTopic ? `📌 كليتك: *${matchedTopic.name}*\n` : '') +
            `يمكنك الآن الدخول للمجموعة والمشاركة!`,
            { parse_mode: 'Markdown' }
          );
        } catch {}

        try {
          await notifyAll(bot, g2,
            `🤖 *قبول تلقائي*\n\n` +
            `👤 ${req.firstName}${req.username ? ` (@${req.username})` : ''}\n` +
            `🆔 \`${userId}\`\n` +
            `📊 Score: \`${score}/100\`\n` +
            `✅ تم قبوله تلقائياً بعد ${delayMins} دقيقة`,
            null
          );
        } catch {}
      }, delay);
    }
  });


  // ════════════════════════════════════════════════════════════
  //  🔘 إعادة التسجيل من البداية
  // ════════════════════════════════════════════════════════════
  bot.action('vstep_restart', async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    const sess   = sessions.get(userId);
    if (!sess) return;

    const g    = db.getGroup(sess.chatId);
    sess.data  = {};
    sess.step  = 'type_select';
    try { await ctx.deleteMessage(); } catch {}
    await stepWelcome(bot, userId, g?.title || 'المجموعة');
  });


  // ════════════════════════════════════════════════════════════
  //  🔘 إلغاء التسجيل
  // ════════════════════════════════════════════════════════════
  bot.action('vstep_cancel', async (ctx) => {
    await ctx.answerCbQuery('تم الإلغاء');
    sessions.delete(ctx.from.id);
    try { await ctx.deleteMessage(); } catch {}
    await ctx.reply(
      `❌ *تم إلغاء التسجيل.*\n\nإذا أردت إعادة التسجيل، اضغط رابط المجموعة مجدداً.`,
      {
        parse_mode:   'Markdown',
        reply_markup: { remove_keyboard: true },
      }
    );
  });

};
