/**
 * ═══════════════════════════════════════════════════════════════
 *  verify_registration.js — معالجة خطوات التسجيل التفاعلية
 *
 *  يشمل:
 *  • معالج اعتراض الأعضاء الجدد (chat_member)
 *  • معالجة رسائل الخاص (إدخال رقم القيد والتخصص)
 *  • أزرار اختيار الكلية والسنة والتأكيد
 *  • /new_member_check — لمزامنة تلقائية فور انضمام عضو
 * ═══════════════════════════════════════════════════════════════
 */

const db = require('./db');
const { isDeveloper, isAdmin } = require('./helpers');
const {
  sessions,
  getVerifySettings,
  getAvailableTopics,
  buildAdminNotification,
  buildAdminButtons,
  notifyAll,
  restrictUser,
  closeAllTopicsExceptVerify,
  stepWelcome,
  stepCollege,
  stepMajor,
  stepYear,
  stepConfirm,
} = require('./verify_helpers');

module.exports = function setupVerifyRegistration(bot) {

  // ════════════════════════════════════════════════════════════
  //  🔒 اعتراض الأعضاء الجدد — تقييد فوري + بدء التسجيل
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

    // 2. إغلاق جميع المواضيع ماعدا موضوع التحقق
    const vs2 = getVerifySettings(g);
    await closeAllTopicsExceptVerify(bot, chat.id, vs2.verifyTopicId);

    // 3. جلب المواضيع
    const topics = getAvailableTopics(g);

    // 4. حفظ session
    sessions.set(u.id, { step: 'student_id', chatId: chat.id, data: {}, topics });

    // 5. إرسال رسالة ترحيب في موضوع التحقق داخل المجموعة
    if (vs2.verifyTopicId) {
      try {
        const firstName = u.first_name || String(u.id);
        const mention   = u.username ? `@${u.username}` : `[${firstName}](tg://user?id=${u.id})`;
        await bot.telegram.sendMessage(chat.id,
          `👋 *أهلاً ${mention}!*

` +
          `🔒 تم تقييد وصولك مؤقتاً حتى اكتمال التحقق الجامعي.

` +
          `📲 *للتحقق وفتح المواضيع:*
` +
          `اضغط على الزر أدناه لبدء التسجيل في المحادثة الخاصة مع البوت.`,
          {
            parse_mode: 'Markdown',
            message_thread_id: vs2.verifyTopicId,
            reply_markup: {
              inline_keyboard: [[
                { text: '✅ بدء التحقق الجامعي', url: `https://t.me/${(await bot.telegram.getMe()).username}?start=verify_${chat.id}` }
              ]]
            }
          }
        );
      } catch (e) {
        console.error('verifyTopic welcome msg:', e.message);
      }
    }

    // 6. بدء التسجيل في الخاص أيضاً
    await stepWelcome(bot, u.id, g.title);

    return next();
  });

  // ════════════════════════════════════════════════════════════
  //  💬 معالج الرسائل النصية في الخاص (رقم القيد والتخصص)
  // ════════════════════════════════════════════════════════════
  bot.on('message', async (ctx, next) => {
    if (ctx.chat.type !== 'private') return next();
    const userId = ctx.from.id;
    const sess   = sessions.get(userId);
    if (!sess) return next();

    const text = ctx.message.text?.trim() || '';

    // خطوة رقم القيد
    if (sess.step === 'student_id') {
      if (!text || text.length < 5 || !/^\d+/.test(text)) {
        return ctx.reply('⚠️ رقم القيد يجب أن يبدأ بأرقام ولا يقل عن 5 خانات. حاول مجدداً:');
      }
      sess.data.studentId = text;
      sess.step = 'college';
      await stepCollege(bot, userId, sess.topics);
      return;
    }

    // خطوة التخصص
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
  //  🔘 اختيار الكلية
  // ════════════════════════════════════════════════════════════
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

  // ════════════════════════════════════════════════════════════
  //  🔘 اختيار السنة الدراسية
  // ════════════════════════════════════════════════════════════
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

  // ════════════════════════════════════════════════════════════
  //  🔘 تأكيد وإرسال الطلب
  // ════════════════════════════════════════════════════════════
  bot.action('vstep_confirm', async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    const sess   = sessions.get(userId);
    if (!sess) return ctx.reply('⚠️ انتهت جلسة التسجيل. أرسل /verify.');

    const g = db.getGroup(sess.chatId);
    if (!g) return ctx.reply('❌ المجموعة غير موجودة. تواصل مع المشرف.');

    const vs = getVerifySettings(g);

    // منع الطلبات المتعددة — قاعدة صارمة: طلب واحد فقط
    const existing = vs.pendingRequests.get(userId);
    if (existing?.status === 'pending') {
      sessions.delete(userId);
      try { await ctx.deleteMessage(); } catch {}
      return ctx.reply('📨 *لديك طلب قيد المراجعة بالفعل.*\n\nانتظر حتى يراجعه المشرف.', { parse_mode: 'Markdown' });
    }

    // منع التسجيل في أكثر من مجموعة/كلية
    const alreadyApproved = db.allGroups().find(grp => {
      const gvs = grp.verifySystem;
      return gvs?.approvedMembers?.has(userId);
    });
    if (alreadyApproved) {
      sessions.delete(userId);
      try { await ctx.deleteMessage(); } catch {}
      return ctx.reply(
        `⚠️ *أنت معتمد بالفعل في مجموعة أخرى!*\n\n` +
        `لا يمكن التسجيل في أكثر من كلية واحدة.\n` +
        `أرسل /mytopics لرؤية وضعك الحالي.`,
        { parse_mode: 'Markdown' }
      );
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

    // إشعار الإدارة مع تفاصيل كاملة
    const notifText = buildAdminNotification(g, userId, ctx.from, sess.data);
    const notifBtns = buildAdminButtons(userId, sess.chatId, sess.data.topicId);
    await notifyAll(bot, g, notifText, notifBtns);
  });

  // ════════════════════════════════════════════════════════════
  //  🔘 إعادة التسجيل من البداية
  // ════════════════════════════════════════════════════════════
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

  // ════════════════════════════════════════════════════════════
  //  🔘 إلغاء التسجيل
  // ════════════════════════════════════════════════════════════
  bot.action('vstep_cancel', async (ctx) => {
    await ctx.answerCbQuery('تم الإلغاء');
    sessions.delete(ctx.from.id);
    try { await ctx.deleteMessage(); } catch {}
    await ctx.reply(
      `❌ *تم إلغاء التسجيل.*\n\nإذا أردت إعادة التسجيل لاحقاً، أرسل /verify`,
      { parse_mode: 'Markdown' }
    );
  });

};
