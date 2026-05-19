/**
 * ═══════════════════════════════════════════════════════════════
 *  verify_commands.js — أوامر نظام التحقق الجامعي
 *
 *  أوامر الطالب:
 *  /verify   — بدء/استئناف التسجيل
 *  /mytopics — حالة الاعتماد
 *
 *  أوامر الإدارة:
 *  /verify_system on|off — تفعيل/تعطيل
 *  /verify_requests      — الطلبات المعلقة
 *  /verify_stats         — إحصائيات
 *  /revoke_verify        — إلغاء اعتماد طالب
 *  /synctopics           — مزامنة المواضيع تلقائياً
 *  /regtopic             — تسجيل موضوع يدوياً
 *  /check_unverified     — فحص الأعضاء غير المعتمدين يدوياً
 * ═══════════════════════════════════════════════════════════════
 */

const { Markup } = require('telegraf');
const db         = require('./db');
const { isDeveloper, isAdmin } = require('./helpers');
const {
  sessions,
  getVerifySettings,
  getAvailableTopics,
  buildAdminButtons,
  restrictUser,
  checkAndRestrictExistingMember,
  closeAllTopicsExceptVerify,
  openTopic,
  closeTopic,
  stepWelcome,
} = require('./verify_helpers');

module.exports = function setupVerifyCommands(bot) {

  // ════════════════════════════════════════════════════════════
  //  🆕 تسجيل تلقائي لأي موضوع جديد يُنشأ في المجموعة
  //  يعمل دون الحاجة لـ /regtopic أو /synctopics
  // ════════════════════════════════════════════════════════════
  bot.on('message', async (ctx, next) => {
    if (!ctx.chat || ctx.chat.type === 'private') return next();
    const msg = ctx.message;
    const g = db.getGroup(ctx.chat.id);
    if (!g) return next();

    const topicId = msg?.message_thread_id;
    if (!topicId) return next();

    const topicName = msg?.forum_topic_created?.name || g.topics?.get(topicId)?.name || `موضوع #${topicId}`;
    const topic = db.getOrCreateTopic(g, topicId, topicName);
    if (msg?.forum_topic_created?.name && topic.name !== msg.forum_topic_created.name) {
      topic.name = msg.forum_topic_created.name;
      db.markDirty();
    }
    topic.lastSeenAt = new Date();
    db.markDirty();

    return next();
  });

  // ════════════════════════════════════════════════════════════
  //  🔄 /synctopics — جلب المواضيع من المجموعة تلقائياً
  // ════════════════════════════════════════════════════════════
  bot.command('synctopics', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, ctx.chat.id, ctx.from.id))
      return ctx.reply('❌ للمشرفين فقط!');

    // حذف رسالة الأمر فوراً
    try { await ctx.deleteMessage(); } catch {}

    const g = db.getGroup(ctx.chat.id);
    if (!g) return;

    const msg = await ctx.reply('⏳ جاري جلب المواضيع...');

    const currentTopicId = ctx.message?.message_thread_id;
    if (currentTopicId && !g.topics?.has(currentTopicId)) {
      db.getOrCreateTopic(g, currentTopicId, `موضوع #${currentTopicId}`);
    }

    const topics = getAvailableTopics(g);
    if (!topics.length) {
      await bot.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
        `⚠️ *لم يتم العثور على مواضيع مسجلة بعد*\n\n` +
        `✅ سيقوم البوت بتسجيل أي موضوع يراه في الرسائل القادمة.\n` +
        `📌 يمكنك أيضاً استخدام /regtopic من داخل الموضوع نفسه.`,
        { parse_mode: 'Markdown' }
      );
      setTimeout(() => bot.telegram.deleteMessage(ctx.chat.id, msg.message_id).catch(() => {}), 10000);
      return;
    }

    const list   = topics.map((t, i) => `${i + 1}. *${t.name}* \`[${t.id}]\``).join('\n');

    await bot.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
      `✅ *تمت مزامنة المواضيع المحلية*\n\n` +
      `📋 *المواضيع المسجّلة حالياً (${topics.length}):*\n${list}\n\n` +
      `✅ _أي موضوع جديد يظهر في الرسائل سيتم تسجيله تلقائياً._`,
      { parse_mode: 'Markdown' }
    );

    setTimeout(() => bot.telegram.deleteMessage(ctx.chat.id, msg.message_id).catch(() => {}), 15000);
  });

  // ════════════════════════════════════════════════════════════
  //  ⚙️ /verify_system on|off
  // ════════════════════════════════════════════════════════════
  bot.command('verify_system', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, ctx.chat.id, ctx.from.id))
      return ctx.reply('❌ للمشرفين فقط!');

    // حذف رسالة الأمر
    try { await ctx.deleteMessage(); } catch {}

    const arg = ctx.message.text.split(' ')[1]?.toLowerCase();
    if (!['on', 'off'].includes(arg)) {
      const m = await ctx.reply(
        `⚙️ الاستخدام:\n` +
        `\`/verify_system on\` — لتفعيل نظام التحقق\n` +
        `\`/verify_system off\` — لتعطيله`,
        { parse_mode: 'Markdown' }
      );
      setTimeout(() => bot.telegram.deleteMessage(ctx.chat.id, m.message_id).catch(() => {}), 8000);
      return;
    }

    const g = db.getGroup(ctx.chat.id);
    if (!g) return ctx.reply('❌ المجموعة غير مسجّلة!');

    const vs   = getVerifySettings(g);
    vs.enabled = arg === 'on';
    db.markDirty();

    const replyMsg = await ctx.reply(
      arg === 'on'
        ? `🔒 *تم تفعيل نظام التحقق الجامعي*\n\n` +
          `الأعضاء الجدد سيُقيَّدون فوراً ويُطلب منهم إكمال التسجيل.\n\n` +
          `📋 *الخطوات التالية:*\n` +
          `1. /synctopics — لجلب الكليات/المواضيع\n` +
          `2. /check_unverified — لتقييد الأعضاء الموجودين غير المعتمدين\n` +
          `3. تأكد أن البوت مشرف بصلاحية تقييد الأعضاء`
        : `🔓 *تم تعطيل نظام التحقق*\n\nالأعضاء الجدد لن يخضعوا للتقييد.`,
      { parse_mode: 'Markdown' }
    );
    setTimeout(() => bot.telegram.deleteMessage(ctx.chat.id, replyMsg.message_id).catch(() => {}), 12000);
  });


  // ════════════════════════════════════════════════════════════
  //  📌 /setverifytopic — تحديد موضوع التحقق (يبقى مفتوحاً دائماً)
  //  الاستخدام: أرسل الأمر داخل موضوع التحقق مباشرة
  // ════════════════════════════════════════════════════════════
  bot.command('setverifytopic', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, ctx.chat.id, ctx.from.id))
      return ctx.reply('❌ للمشرفين فقط!');

    try { await ctx.deleteMessage(); } catch {}

    const topicId = ctx.message?.message_thread_id;
    if (!topicId) {
      const m = await ctx.reply('⚠️ أرسل هذا الأمر *داخل موضوع التحقق* مباشرة.', { parse_mode: 'Markdown' });
      setTimeout(() => bot.telegram.deleteMessage(ctx.chat.id, m.message_id).catch(() => {}), 5000);
      return;
    }

    const g = db.getGroup(ctx.chat.id);
    if (!g) return ctx.reply('❌ المجموعة غير مسجّلة!');

    const vs = getVerifySettings(g);
    vs.verifyTopicId = topicId;
    db.markDirty();

    const _setVfyMsg = await ctx.reply(
      `✅ *تم تحديد موضوع التحقق بنجاح!*

` +
      `🧵 موضوع التحقق: \`${topicId}\`

` +
      `عند انضمام أي عضو جديد، سيُغلق البوت جميع المواضيع الأخرى تلقائياً ويُبقي هذا الموضوع مفتوحاً.`,
      { parse_mode: 'Markdown' }
    );
    setTimeout(() => bot.telegram.deleteMessage(ctx.chat.id, _setVfyMsg.message_id).catch(() => {}), 10000);
  });

  // ════════════════════════════════════════════════════════════
  //  🔒 /closetopics — إغلاق كل المواضيع ماعدا موضوع التحقق
  // ════════════════════════════════════════════════════════════
  bot.command('closetopics', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, ctx.chat.id, ctx.from.id))
      return ctx.reply('❌ للمشرفين فقط!');

    try { await ctx.deleteMessage(); } catch {}
    const g = db.getGroup(ctx.chat.id);
    if (!g) return ctx.reply('❌ المجموعة غير مسجّلة!');

    const vs = getVerifySettings(g);
    const msg = await ctx.reply('⏳ جاري إغلاق المواضيع...');
    await closeAllTopicsExceptVerify(bot, ctx.chat.id, vs.verifyTopicId);

    try {
      await bot.telegram.editMessageText(
        ctx.chat.id, msg.message_id, null,
        `🔒 *تم إغلاق جميع المواضيع* ماعدا موضوع التحقق.`,
        { parse_mode: 'Markdown' }
      );
    } catch {}
  });

  // ════════════════════════════════════════════════════════════
  //  🔓 /opentopic <topicId> — فتح موضوع محدد
  // ════════════════════════════════════════════════════════════
  bot.command('opentopic', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, ctx.chat.id, ctx.from.id))
      return ctx.reply('❌ للمشرفين فقط!');

    try { await ctx.deleteMessage(); } catch {}

    const arg     = ctx.message.text.split(' ')[1];
    const topicId = arg ? Number(arg) : ctx.message?.message_thread_id;
    if (!topicId)
      return ctx.reply('⚠️ استخدم: `/opentopic <topicId>` أو أرسل الأمر داخل الموضوع المطلوب.', { parse_mode: 'Markdown' });

    const ok = await openTopic(bot, ctx.chat.id, topicId);
    await ctx.reply(ok ? `✅ تم فتح الموضوع \`${topicId}\`` : `❌ فشل فتح الموضوع.`, { parse_mode: 'Markdown' });
  });

  // ════════════════════════════════════════════════════════════
  //  🔍 /check_unverified — فحص وتقييد الأعضاء غير المعتمدين يدوياً
  // ════════════════════════════════════════════════════════════
  bot.command('check_unverified', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, ctx.chat.id, ctx.from.id))
      return ctx.reply('❌ للمشرفين فقط!');

    // حذف رسالة الأمر
    try { await ctx.deleteMessage(); } catch {}

    const g = db.getGroup(ctx.chat.id);
    if (!g) return ctx.reply('❌ المجموعة غير مسجّلة!');

    const vs = getVerifySettings(g);
    if (!vs.enabled) return ctx.reply('⚠️ نظام التحقق معطّل. فعّله أولاً بـ /verify_system on');

    const msg = await ctx.reply('⏳ جاري فحص الأعضاء...');
    let checked = 0, restricted = 0;

    for (const [userId] of (g.members || new Map()).entries()) {
      // تجاهل المعتمدين
      if (vs.approvedMembers.has(userId)) continue;
      // تجاهل الانتظار
      if (['pending', 'pending_verify', 'pending_direct'].includes(vs.pendingRequests.get(userId)?.status)) continue;

      try {
        const member = await bot.telegram.getChatMember(ctx.chat.id, userId);
        if (['administrator', 'creator', 'left', 'kicked'].includes(member.status)) continue;

        checked++;
        const wasRestricted = await checkAndRestrictExistingMember(bot, ctx.chat.id, userId, g);
        if (wasRestricted !== undefined) restricted++;

        await new Promise(r => setTimeout(r, 300)); // تجنب flood
      } catch {}
    }

    await bot.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
      `✅ *اكتمل الفحص*\n\n` +
      `🔍 تم فحص: \`${checked}\` عضو\n` +
      `🔒 تم تقييد: \`${restricted}\` عضو غير معتمد\n\n` +
      `_تم إرسال رسالة تسجيل لكل عضو تم تقييده_`,
      { parse_mode: 'Markdown' }
    );
    setTimeout(() => bot.telegram.deleteMessage(ctx.chat.id, msg.message_id).catch(() => {}), 15000);
  });

  // ════════════════════════════════════════════════════════════
  //  📋 /verify_requests — الطلبات المعلقة
  // ════════════════════════════════════════════════════════════
  bot.command('verify_requests', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, ctx.chat.id, ctx.from.id))
      return ctx.reply('❌ للمشرفين فقط!');

    try { await ctx.deleteMessage(); } catch {}

    const g = db.getGroup(ctx.chat.id);
    if (!g) return ctx.reply('❌ المجموعة غير مسجّلة!');

    const vs      = getVerifySettings(g);
    const pending = [...vs.pendingRequests.values()].filter(r => ['pending', 'pending_verify', 'pending_direct'].includes(r.status));

    if (!pending.length) return ctx.reply('✅ لا توجد طلبات معلقة حالياً.');

    let text = `📨 *الطلبات المعلقة — (${pending.length})*\n\n`;
    for (const req of pending.slice(0, 10)) {
      text +=
        `👤 ${req.firstName}${req.username ? ` (@${req.username})` : ''} \`${req.userId}\`\n` +
        `🏛️ ${req.data?.university || req.data?.college || 'غير محدد'} | 📚 ${req.data?.major || 'غير محدد'} | 🔢 ${req.data?.studentId || req.data?.year || 'غير محدد'}\n` +
        `🕐 ${new Date(req.submittedAt).toLocaleString('ar-SA')}\n\n`;
    }
    if (pending.length > 10) text += `_...و ${pending.length - 10} طلب آخر_`;

    const rows = pending.slice(0, 5).map(req => [
      Markup.button.callback(
        `👤 ${req.firstName.substring(0, 20)} — ${(req.data?.university || req.data?.college || '').substring(0, 12)}`,
        `vfy_info_${req.userId}_${ctx.chat.id}`
      ),
    ]);
    rows.push([Markup.button.callback('🔄 تحديث القائمة', `vfylist_${ctx.chat.id}`)]);

    await ctx.reply(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(rows) });
  });

  // تحديث قائمة الطلبات (callback)
  bot.action(/^vfylist_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId);
    if (!g) return;

    const vs      = getVerifySettings(g);
    const pending = [...vs.pendingRequests.values()].filter(r => ['pending', 'pending_verify', 'pending_direct'].includes(r.status));

    if (!pending.length) return ctx.editMessageText('✅ لا توجد طلبات معلقة.');

    let text = `📨 *الطلبات المعلقة — (${pending.length})*\n\n`;
    for (const req of pending.slice(0, 10)) {
      text +=
        `👤 ${req.firstName}${req.username ? ` (@${req.username})` : ''} \`${req.userId}\`\n` +
        `🏛️ ${req.data?.university || req.data?.college || 'غير محدد'} | 📚 ${req.data?.major || 'غير محدد'}\n` +
        `🕐 ${new Date(req.submittedAt).toLocaleString('ar-SA')}\n\n`;
    }

    const rows = pending.slice(0, 5).map(req => [
      Markup.button.callback(
        `👤 ${req.firstName.substring(0, 20)} — ${(req.data?.university || req.data?.college || '').substring(0, 12)}`,
        `vfy_info_${req.userId}_${chatId}`
      ),
    ]);
    rows.push([Markup.button.callback('🔄 تحديث القائمة', `vfylist_${chatId}`)]);

    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(rows) });
  });

  // ════════════════════════════════════════════════════════════
  //  📊 /verify_stats — إحصائيات
  // ════════════════════════════════════════════════════════════
  bot.command('verify_stats', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, ctx.chat.id, ctx.from.id))
      return ctx.reply('❌ للمشرفين فقط!');

    try { await ctx.deleteMessage(); } catch {}

    const g = db.getGroup(ctx.chat.id);
    if (!g) return ctx.reply('❌ المجموعة غير مسجّلة!');

    const vs      = getVerifySettings(g);
    const allReqs = [...vs.pendingRequests.values()];
    const pending = allReqs.filter(r => ['pending', 'pending_verify', 'pending_direct'].includes(r.status)).length;
    const approved = vs.approvedMembers.size;
    const rejected = allReqs.filter(r => r.status === 'rejected').length;
    const banned   = allReqs.filter(r => r.status === 'banned').length;
    const topics   = getAvailableTopics(g);

    // توزيع على الكليات
    const dist = new Map();
    for (const [, m] of vs.approvedMembers) {
      const name = m.topicName || m.studentData?.topicName || m.studentData?.university || String(m.topicId || 'غير محدد');
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
  //  🔑 /verify — بدء التسجيل في الخاص
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

    const myGroup = allGrps.find(g => {
      const vs = g.verifySystem;
      return vs?.enabled && (
        vs.pendingRequests?.has(userId) ||
        vs.approvedMembers?.has(userId) ||
        ['pending', 'pending_verify', 'pending_direct'].includes(g.joinRequests?.get(userId)?.status) ||
        g.members?.has(userId)
      );
    });

    if (!myGroup) {
      return ctx.reply(
        `❌ *لم أجد مجموعة مرتبطة بحسابك.*\n\n` +
        `يجب أن تنضم للمجموعة أولاً، أو يكون لديك طلب انضمام/تحقق مسجل، ثم أرسل /verify في الخاص.`,
        { parse_mode: 'Markdown' }
      );
    }

    const vs = getVerifySettings(myGroup);

    if (vs.approvedMembers.has(userId)) {
      const info = vs.approvedMembers.get(userId);
      return ctx.reply(
        `✅ *حسابك معتمد بالفعل!*\n\n` +
        `🏛️ الكلية: *${info.topicName || info.studentData?.topicName || info.studentData?.university || 'غير متاح'}*\n` +
        `🔢 رقم القيد: \`${info.studentData?.studentId || info.studentId || 'غير متاح'}\`\n\n` +
        `يمكنك المشاركة في موضوعك مباشرة.`,
        { parse_mode: 'Markdown' }
      );
    }

    const existing = vs.pendingRequests.get(userId);
    if (['pending', 'pending_verify', 'pending_direct'].includes(existing?.status)) {
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
    sessions.set(userId, { step: 'type_select', chatId: myGroup.chatId, data: {}, topics });
    await stepWelcome(bot, userId, myGroup.title);
  });

  // ════════════════════════════════════════════════════════════
  //  🗑️ /revoke_verify — إلغاء اعتماد طالب
  // ════════════════════════════════════════════════════════════
  bot.command('revoke_verify', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, ctx.chat.id, ctx.from.id))
      return ctx.reply('❌ للمشرفين فقط!');

    try { await ctx.deleteMessage(); } catch {}

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

    // حذف رسالة الأمر فوراً
    try { await ctx.deleteMessage(); } catch {}

    const topicId = ctx.message.message_thread_id;
    if (!topicId) {
      const m = await ctx.reply('❌ هذا الأمر يُستخدم داخل موضوع فقط!');
      setTimeout(() => bot.telegram.deleteMessage(ctx.chat.id, m.message_id).catch(() => {}), 5000);
      return;
    }

    const g    = db.getGroup(ctx.chat.id);
    if (!g) return;

    const name  = ctx.message.text.split(' ').slice(1).join(' ').trim();
    const topic = db.getOrCreateTopic(g, topicId, name || String(topicId));
    if (name) topic.name = name;
    db.markDirty();

    const m = await ctx.reply(
      `✅ *تم تسجيل الموضوع*\n\n🆔 \`${topicId}\`\n📌 الاسم: *${topic.name}*`,
      { parse_mode: 'Markdown' }
    );
    setTimeout(() => bot.telegram.deleteMessage(ctx.chat.id, m.message_id).catch(() => {}), 8000);
  });

  // ════════════════════════════════════════════════════════════
  //  📋 /mytopics — الطالب يرى وضعه
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
          `  ✅ معتمد — ${app.topicName || app.studentData?.topicName || app.studentData?.university || 'غير محدد'}\n` +
          `  🏛️ ${app.studentData?.university || app.studentData?.college || ''} | 📚 ${app.studentData?.major || ''}\n\n`;
      } else if (['pending', 'pending_verify', 'pending_direct'].includes(req?.status)) {
        found = true;
        text += `*${g.title}*\n  ⏳ طلبك قيد المراجعة...\n\n`;
      } else if (['pending_verify', 'pending_direct'].includes(g.joinRequests?.get(userId)?.status)) {
        found = true;
        text += `*${g.title}*\n  🟡 طلبك مسجل، لكن التحقق لم يكتمل بعد.\n\n`;
      }
    }

    if (!found) {
      text += `_لم تُعتمد في أي مجموعة حتى الآن._\n\nأرسل /verify لبدء التسجيل.`;
    }

    await ctx.replyWithMarkdown(text);
  });

};
