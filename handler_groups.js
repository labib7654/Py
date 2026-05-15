const { Markup }    = require('telegraf');
const db            = require('./db');
const {
  isDeveloper, isAdmin,
  muteMember, promoteUser, logAction,
} = require('./helpers');
const { DEVELOPER_ID } = require('./config');

function groupHomeKeyboard(chatId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('⚙️ إعدادات المجموعة', `settings_${chatId}`), Markup.button.callback('👥 المشرفون', `admins_${chatId}`)],
    [Markup.button.callback('📋 القواعد',           `rules_${chatId}`),    Markup.button.callback('📊 إحصائيات', `stats_${chatId}`)],
    [Markup.button.callback('📨 طلبات الانضمام',    `joinreqs_${chatId}`)],
  ]);
}

module.exports = function setupGroupHandlers(bot) {

  // ── انضمام/مغادرة البوت ───────────────────────────────────────────────
  bot.on('my_chat_member', async (ctx) => {
    const upd     = ctx.myChatMember;
    const { chat, from } = upd;
    const newStat = upd.new_chat_member.status;
    const oldStat = upd.old_chat_member.status;
    if (chat.type === 'private') return;
    const isChannel = chat.type === 'channel';
    const joined = (newStat === 'member' || newStat === 'administrator') && (oldStat === 'left' || oldStat === 'kicked');
    const left   = newStat === 'left' || newStat === 'kicked';

    if (joined) {
      if (isChannel) {
        const channel = db.getOrCreateChannel(chat.id, chat.title || 'قناة', chat.username || '', from.id, from.username || from.first_name || String(from.id));
        db.getOrCreateUser(from.id, from.username || '', from.first_name || '').channels.add(chat.id);
        try {
          const admins = await bot.telegram.getChatAdministrators(chat.id);
          const owner  = admins.find(a => a.status === 'creator');
          if (owner) { channel.ownerId = owner.user.id; channel.ownerUsername = owner.user.username || owner.user.first_name; }
        } catch {}
        try { await ctx.replyWithMarkdown(`📢 *شكراً لإضافتي لقناة ${chat.title}!*\n\n👑 المالك: \`${db.getChannel(chat.id)?.ownerUsername || 'غير محدد'}\``); } catch {}
      } else {
        const group = db.getOrCreateGroup(chat.id, chat.title || 'مجموعة', chat.type, from.id, from.username || from.first_name || String(from.id));
        db.getOrCreateUser(from.id, from.username || '', from.first_name || '').groups.add(chat.id);
        db.trackMember(chat.id, from.id, from.username || '', from.first_name || '', 'member');
        let promoted = false;
        try { if (newStat === 'administrator') promoted = await promoteUser(bot, chat.id, from.id); } catch {}
        if (promoted) {
          group.admins.set(from.id, { username: from.username || from.first_name || String(from.id), promotedBy: ctx.botInfo.id, promotedByUsername: ctx.botInfo.username || 'Bot', promotedAt: new Date() });
          db.trackMember(chat.id, from.id, from.username || '', from.first_name || '', 'admin');
        }
        try {
          const admins = await bot.telegram.getChatAdministrators(chat.id);
          const owner  = admins.find(a => a.status === 'creator');
          if (owner) { group.ownerId = owner.user.id; group.ownerUsername = owner.user.username || owner.user.first_name; db.trackMember(chat.id, owner.user.id, owner.user.username || '', owner.user.first_name || '', 'owner'); }
        } catch {}
        await ctx.replyWithMarkdown(
          `🤖 *شكراً لإضافتي إلى ${chat.title}!*\n\n` +
          (promoted ? `✅ تم ترقية @${from.username || from.first_name} مشرفاً تلقائياً!\n\n` : '') +
          `👑 المالك: \`${group.ownerUsername || 'غير محدد'}\`\n🛡️ جاهز للإدارة!\n\n_استخدم /settings للإعدادات_`,
          groupHomeKeyboard(chat.id)
        );
      }
    } else if (left) {
      if (isChannel) db.deleteChannel(chat.id);
      else db.deleteGroup(chat.id);
    }
  });

  // ── تغييرات الأعضاء ──────────────────────────────────────────────────
  bot.on('chat_member', async (ctx) => {
    const upd  = ctx.chatMember;
    const { chat, from: by } = upd;
    const newM = upd.new_chat_member;
    const oldM = upd.old_chat_member;
    const u    = newM.user;
    if (u.is_bot) {
      // معالجة البوتات تأتي بعد، لا نوقف هنا
    }

    if (chat.type === 'channel') {
      const ch = db.getChannel(chat.id);
      if (ch && (newM.status === 'member' || newM.status === 'subscriber')) {
        ch.subscribers.set(u.id, { joinedAt: new Date() });
        db.getOrCreateUser(u.id, u.username || '', u.first_name || '').channels.add(chat.id);
      }
      return;
    }

    const g = db.getGroup(chat.id);

    if (newM.status === 'creator') {
      if (g) { g.ownerId = u.id; g.ownerUsername = u.username || u.first_name || String(u.id); }
      db.trackMember(chat.id, u.id, u.username || '', u.first_name || '', 'owner');
    }
    if (newM.status === 'administrator' && oldM.status !== 'administrator') {
      if (g) g.admins.set(u.id, { username: u.username || u.first_name || String(u.id), promotedBy: by.id, promotedByUsername: by.username || by.first_name || String(by.id), promotedAt: new Date() });
      db.trackMember(chat.id, u.id, u.username || '', u.first_name || '', 'admin');
    }
    if (oldM.status === 'administrator' && newM.status === 'member') {
      if (g) g.admins.delete(u.id);
      db.trackMember(chat.id, u.id, u.username || '', u.first_name || '', 'member');
    }

    // ── 7️⃣ منع البوتات المُحسَّن ──────────────────────────────────────
    if (g?.antiBot && u.is_bot) {
      try { await bot.telegram.banChatMember(chat.id, u.id); } catch {}

      const adderName = by.username ? `@${by.username}` : by.first_name;

      // تسجيل في السجل
      await logAction(bot, g, '🤖 إزالة بوت', by,
        { id: u.id, username: u.username || '', firstName: u.first_name || 'بوت' },
        `البوت المضاف: @${u.username || u.id}`
      ).catch(() => {});

      // إضافة تحذير لمن أضاف البوت
      if (!g.warns.has(by.id)) g.warns.set(by.id, []);
      const warns = g.warns.get(by.id);
      warns.push({
        reason:      `أضاف بوت (@${u.username || u.id}) للمجموعة`,
        warnedBy:    ctx.botInfo?.id || 0,
        warnedAt:    new Date(),
        isAutomatic: true,
      });

      // إرسال تحذير في المجموعة
      try {
        await bot.telegram.sendMessage(chat.id,
          `🤖 *تنبيه — منع البوتات*\n\n` +
          `✅ تم إزالة البوت @${u.username || u.id} تلقائياً.\n` +
          `⚠️ ${adderName} — تحذير \`${warns.length}/${g.maxWarns}\`\n\n` +
          `_إضافة البوتات ممنوعة في هذه المجموعة._`,
          { parse_mode: 'Markdown' }
        );
      } catch {}

      // إذا تجاوز التحذيرات → حظر من أضاف البوت
      if (warns.length >= g.maxWarns) {
        try {
          await bot.telegram.banChatMember(chat.id, by.id);
          g.bannedUsers.add(by.id);
          g.warns.delete(by.id);
          await bot.telegram.sendMessage(chat.id,
            `🚫 *حظر تلقائي*\n${adderName} — تكرار إضافة البوتات.`,
            { parse_mode: 'Markdown' }
          );
        } catch {}
      }
      return;
    }

    // تجاهل باقي المعالجة للبوتات غير المحظورة
    if (u.is_bot) return;

    if (newM.status === 'member' && (oldM.status === 'left' || oldM.status === 'kicked')) {
      const urec = db.getOrCreateUser(u.id, u.username || '', u.first_name || '');
      urec.groups.add(chat.id);
      db.trackMember(chat.id, u.id, u.username || '', u.first_name || '', 'member');
      if (!g) return;

      // ── 4️⃣ فحص المجتمع المُحسَّن ──────────────────────────────────
      if (g.communityId) {
        const exceeded = db.recordCommunityJoin(g.communityId, u.id, chat.id);
        if (exceeded) {
          const com = db.getCommunity(g.communityId);

          // أسماء المجموعات التي انضم إليها
          const joinedGroupNames = [...(com?.memberJoins.get(u.id) || [])].map(id => {
            const grp = db.getGroup(id);
            return grp ? grp.title : String(id);
          }).join('، ');

          try { await bot.telegram.banChatMember(chat.id, u.id); g.bannedUsers.add(u.id); } catch {}
          if (com) {
            for (const id of com.subGroups) { try { await bot.telegram.banChatMember(id, u.id); } catch {} }

            // تسجيل الحظر التلقائي في المجتمع
            if (!com.autoBannedUsers) com.autoBannedUsers = new Map();
            com.autoBannedUsers.set(u.id, {
              reason:   `انضم لأكثر من ${com.maxGroupJoins} مجموعة`,
              groups:   joinedGroupNames,
              bannedAt: new Date(),
            });
          }

          const banMsg =
            `🚫 *حظر تلقائي — نظام المجتمع*\n\n` +
            `👤 المستخدم: ${u.username ? `@${u.username}` : u.first_name} \`[${u.id}]\`\n` +
            `📚 المجتمع: *${com?.title || 'غير محدد'}*\n` +
            `🔢 الحد المسموح: \`${com?.maxGroupJoins || 1}\` مجموعة\n` +
            `📋 انضم لـ: ${joinedGroupNames || 'غير محدد'}\n` +
            `🕐 وقت الحظر: ${new Date().toLocaleString('ar')}\n\n` +
            `⚠️ سبب الحظر: انضم لأكثر من المسموح به من مجموعات المجتمع.`;

          if (g.ownerId) { try { await bot.telegram.sendMessage(g.ownerId, banMsg, { parse_mode: 'Markdown' }); } catch {} }
          try { await bot.telegram.sendMessage(DEVELOPER_ID, banMsg, { parse_mode: 'Markdown' }); } catch {}
          if (g.logChannelId) { try { await bot.telegram.sendMessage(g.logChannelId, banMsg, { parse_mode: 'Markdown' }); } catch {} }
          return;
        }
      }

      if (urec.globalBanned) { try { await bot.telegram.banChatMember(chat.id, u.id); } catch {} return; }
      if (g.muteNewMembers)  { try { await muteMember(bot, chat.id, u.id); } catch {} }
      if (!g.welcomeEnabled) return;

      const msg = g.welcomeMessage
        .replace('{name}',     u.first_name || '')
        .replace('{group}',    chat.title   || 'المجموعة')
        .replace('{username}', u.username ? `@${u.username}` : u.first_name || '');
      try {
        await bot.telegram.sendMessage(chat.id,
          `👋 ${msg}`,
          { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('📋 القواعد', `rules_${chat.id}`)]]) }
        );
      } catch {}
    }
  });

  // ── طلبات الانضمام ───────────────────────────────────────────────────
  bot.on('chat_join_request', async (ctx) => {
    const req  = ctx.chatJoinRequest;
    const { chat } = req;
    const u    = req.from;
    const g    = db.getGroup(chat.id);
    if (!g) return;

    // ── 2️⃣ج) تجاهل الطلب إذا لم تكن الميزة مفعّلة ──────────
    if (!g.joinRequestsEnabled) return;

    // فحص فترة الحظر من إعادة الطلب
    const cooldown = g.joinRequestCooldown.get(u.id);
    if (cooldown && cooldown > Date.now()) {
      try { await bot.telegram.declineChatJoinRequest(chat.id, u.id); } catch {}
      return;
    }

    g.joinRequests.set(u.id, {
      userId:      u.id,
      username:    u.username  || '',
      firstName:   u.first_name || String(u.id),
      requestedAt: new Date(),
      status:      'pending',
      bio:         req.bio || '',
      inviteLink:  req.invite_link?.invite_link || '',
    });

    // فحص المجتمع
    if (g.communityId) {
      const exceeded = db.recordCommunityJoin(g.communityId, u.id, chat.id);
      if (exceeded) {
        const com = db.getCommunity(g.communityId);

        const joinedGroupNames = [...(com?.memberJoins.get(u.id) || [])].map(id => {
          const grp = db.getGroup(id);
          return grp ? grp.title : String(id);
        }).join('، ');

        try {
          await bot.telegram.declineChatJoinRequest(chat.id, u.id);
          g.joinRequests.get(u.id).status = 'rejected_community';
        } catch {}

        if (!com.autoBannedUsers) com.autoBannedUsers = new Map();
        com.autoBannedUsers.set(u.id, {
          reason:   `طلب انضمام لأكثر من ${com.maxGroupJoins} مجموعة`,
          groups:   joinedGroupNames,
          bannedAt: new Date(),
        });

        const msg =
          `⚠️ *رُفض طلب انضمام — مجتمع ${com?.title || ''}*\n\n` +
          `👤 ${u.username ? `@${u.username}` : u.first_name} \`[${u.id}]\`\n` +
          `🚫 طلب أكثر من ${com?.maxGroupJoins || 1} مجموعة.\n` +
          `📋 انضم لـ: ${joinedGroupNames || 'غير محدد'}`;

        if (g.ownerId) { try { await bot.telegram.sendMessage(g.ownerId, msg, { parse_mode: 'Markdown' }); } catch {} }
        try { await bot.telegram.sendMessage(DEVELOPER_ID, msg, { parse_mode: 'Markdown' }); } catch {}
        return;
      }
    }

    const notifyText =
      `📨 *طلب انضمام جديد*\n\n` +
      `👤 ${u.first_name}${u.username ? ` (@${u.username})` : ''}\n` +
      `🆔 \`${u.id}\`\n` +
      `📌 المجموعة: *${chat.title}*\n` +
      (req.bio ? `📝 ${req.bio}\n` : '') +
      `🕐 ${new Date().toLocaleString('ar')}`;

    const actionBtns = Markup.inlineKeyboard([[
      Markup.button.callback('✅ قبول',  `jr_approve_${u.id}_${chat.id}`),
      Markup.button.callback('❌ رفض',  `jr_reject_${u.id}_${chat.id}`),
      Markup.button.callback('🔍 تحقق', `jr_check_${u.id}_${chat.id}`),
    ]]);

    const notifyIds = new Set([g.ownerId, ...g.admins.keys()].filter(Boolean));
    for (const adminId of notifyIds) {
      try { await bot.telegram.sendMessage(adminId, notifyText, { parse_mode: 'Markdown', ...actionBtns }); } catch {}
    }
    try { await bot.telegram.sendMessage(DEVELOPER_ID, notifyText, { parse_mode: 'Markdown', ...actionBtns }); } catch {}
  });

  // قبول طلب
  bot.action(/^jr_approve_(\d+)_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const [uid, cid] = [Number(ctx.match[1]), Number(ctx.match[2])];
    const g = db.getGroup(cid);
    if (!isDeveloper(ctx) && !(g && ctx.from.id === g.ownerId) && !await isAdmin(bot, cid, ctx.from.id))
      return ctx.answerCbQuery('❌ ليس لديك صلاحية!', { show_alert: true });
    try {
      await bot.telegram.approveChatJoinRequest(cid, uid);
      if (g?.joinRequests.has(uid)) g.joinRequests.get(uid).status = 'approved';
      await ctx.answerCbQuery('✅ تم القبول!', { show_alert: true });
      await ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n✅ *تم القبول*', { parse_mode: 'Markdown' });
    } catch (e) { await ctx.answerCbQuery(`❌ ${e.message}`, { show_alert: true }); }
  });

  // رفض طلب
  bot.action(/^jr_reject_(\d+)_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const [uid, cid] = [Number(ctx.match[1]), Number(ctx.match[2])];
    const g = db.getGroup(cid);
    if (!isDeveloper(ctx) && !(g && ctx.from.id === g.ownerId) && !await isAdmin(bot, cid, ctx.from.id))
      return ctx.answerCbQuery('❌ ليس لديك صلاحية!', { show_alert: true });
    try {
      await bot.telegram.declineChatJoinRequest(cid, uid);
      if (g?.joinRequests.has(uid)) {
        g.joinRequests.get(uid).status = 'rejected';
        g.joinRequestCooldown.set(uid, Date.now() + 24 * 3600 * 1000);
      }
      await ctx.answerCbQuery('❌ تم الرفض!', { show_alert: true });
      await ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n❌ *تم الرفض*', { parse_mode: 'Markdown' });
    } catch (e) { await ctx.answerCbQuery(`❌ ${e.message}`, { show_alert: true }); }
  });

  // تحقق من الطالب
  bot.action(/^jr_check_(\d+)_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const [uid, cid] = [Number(ctx.match[1]), Number(ctx.match[2])];
    const g  = db.getGroup(cid);
    const r  = g?.joinRequests.get(uid);
    const gu = db.getUser(uid);
    const joinedCount = gu ? [...gu.groups].length : 0;
    let text =
      `🔍 *معلومات الطالب*\n\n` +
      `👤 ${r?.firstName || uid}${r?.username ? ` (@${r.username})` : ''}\n` +
      `🆔 \`${uid}\`\n` +
      `📅 طلب في: ${r?.requestedAt ? new Date(r.requestedAt).toLocaleString('ar') : '—'}\n` +
      `📊 في ${joinedCount} مجموعة معروفة\n` +
      `🌐 محظور عالمياً: ${gu?.globalBanned ? '🚫 نعم' : '✅ لا'}\n` +
      (r?.bio ? `📝 ${r.bio}\n` : '');
    await ctx.answerCbQuery();
    try {
      await bot.telegram.sendMessage(ctx.from.id, text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('✅ قبول',  `jr_approve_${uid}_${cid}`),
           Markup.button.callback('❌ رفض',  `jr_reject_${uid}_${cid}`)],
        ]),
      });
    } catch { await ctx.answerCbQuery('ℹ️ افتح محادثة مع البوت أولاً', { show_alert: true }); }
  });

  // ── Inline callbacks: stats, rules, admins, joinreqs ─────────────────
  bot.action(/^stats_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId);
    if (!g) return ctx.answerCbQuery('❌ بيانات غير موجودة', { show_alert: true });
    const warns   = [...g.warns.values()].reduce((a, w) => a + w.length, 0);
    const pending = [...g.joinRequests.values()].filter(r => r.status === 'pending').length;
    await ctx.replyWithMarkdown(
      `📊 *إحصائيات ${g.title}*\n\n` +
      `👥 الأعضاء: \`${g.members.size}\`\n` +
      `👮 المشرفون: \`${g.admins.size}\`\n` +
      `⚠️ التحذيرات: \`${warns}\`\n` +
      `🔇 المكتومون: \`${g.mutedUsers.size}\`\n` +
      `🚫 المحظورون: \`${g.bannedUsers.size}\`\n` +
      `📨 طلبات معلقة: \`${pending}\`\n` +
      `🔤 كلمات محظورة: \`${g.bannedWords.length}\``
    );
  });

  bot.action(/^rules_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId);
    if (!g || !g.rules) return ctx.answerCbQuery('❌ لا توجد قواعد محددة', { show_alert: true });
    await ctx.replyWithMarkdown(`📋 *قواعد ${g.title}*\n\n${g.rules}`);
  });

  bot.action(/^admins_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    let text = `👮 *مشرفو المجموعة*\n\n`;
    try {
      const list = await bot.telegram.getChatAdministrators(chatId);
      for (const a of list) {
        if (a.user.is_bot) continue;
        const name = a.user.username ? `@${a.user.username}` : a.user.first_name;
        text += a.status === 'creator' ? `👑 *المالك:* ${name}\n` : `👮 *مشرف:* ${name}\n`;
      }
    } catch { text += '_تعذر جلب القائمة_'; }
    await ctx.replyWithMarkdown(text);
  });

  bot.action(/^joinreqs_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId);
    const pending = g ? [...g.joinRequests.values()].filter(r => r.status === 'pending') : [];
    if (!pending.length) return ctx.answerCbQuery('✅ لا توجد طلبات معلقة', { show_alert: true });
    let text = `📨 *طلبات الانضمام المعلقة* (${pending.length})\n\n`;
    pending.slice(0, 5).forEach(r => {
      text += `👤 ${r.firstName}${r.username ? ` (@${r.username})` : ''} \`[${r.userId}]\`\n`;
    });
    if (pending.length > 5) text += `\n_... و${pending.length - 5} طلبات أخرى_`;
    const btns = pending.slice(0, 3).flatMap(r => [[
      Markup.button.callback(`✅ ${r.firstName.slice(0, 15)}`, `jr_approve_${r.userId}_${chatId}`),
      Markup.button.callback('❌', `jr_reject_${r.userId}_${chatId}`),
    ]]);
    await ctx.replyWithMarkdown(text, Markup.inlineKeyboard(btns));
  });

  // ── 3️⃣ج) فحص رسائل المواضيع المقفلة ──────────────────────────────
  bot.on('message', async (ctx, next) => {
    if (!ctx.message || !ctx.chat || ctx.chat.type === 'private') return next();
    const threadId = ctx.message.message_thread_id;
    if (!threadId) return next();

    const chatId = ctx.chat.id;
    const g      = db.getGroup(chatId);
    if (!g || !g.topicSettings?.requireApprovalToJoin) return next();

    const topic = g.topics.get(threadId);
    if (!topic?.locked) return next();

    const isApproved  = topic.approvedUsers?.has(ctx.from.id);
    const isAdminUser = await isAdmin(bot, chatId, ctx.from.id);

    if (!isAdminUser && !isApproved) {
      try { await ctx.deleteMessage(); } catch {}
      if (g.ownerId) {
        try {
          await bot.telegram.sendMessage(g.ownerId,
            `📨 *طلب دخول موضوع*\n\n👤 ${ctx.from.first_name}${ctx.from.username ? ` (@${ctx.from.username})` : ''} يريد المشاركة في موضوع "${topic.name || threadId}"\n🆔 \`${ctx.from.id}\``,
            {
              parse_mode: 'Markdown',
              ...Markup.inlineKeyboard([[
                Markup.button.callback('✅ سماح', `topic_allow_${ctx.from.id}_${chatId}_${threadId}`),
                Markup.button.callback('❌ رفض',  `topic_deny_${ctx.from.id}_${chatId}_${threadId}`),
              ]]),
            }
          );
        } catch {}
      }
    }
    return next();
  });

  // ── 3️⃣ أزرار موافقة/رفض طلب دخول الموضوع ──────────────────────────
  bot.action(/^topic_allow_(\d+)_(-?\d+)_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const uid     = Number(ctx.match[1]);
    const chatId  = Number(ctx.match[2]);
    const topicId = Number(ctx.match[3]);
    const g       = db.getGroup(chatId);
    if (!g) return;
    if (!g.topics.has(topicId)) g.topics.set(topicId, { locked: true, approvedUsers: new Set() });
    const topic = g.topics.get(topicId);
    if (!topic.approvedUsers) topic.approvedUsers = new Set();
    topic.approvedUsers.add(uid);
    await ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n✅ *تم السماح*', { parse_mode: 'Markdown' });
  });

  bot.action(/^topic_deny_(\d+)_(-?\d+)_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery('❌ تم الرفض', { show_alert: true });
    await ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n❌ *تم الرفض*', { parse_mode: 'Markdown' });
  });

  // /top — أنشط الأعضاء
  bot.command('top', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const g = db.getGroup(ctx.chat.id);
    if (!g || !g.members.size) return ctx.reply('❌ لا توجد بيانات أعضاء بعد.');
    const sorted = [...g.members.values()]
      .filter(m => m.messageCount > 0)
      .sort((a, b) => b.messageCount - a.messageCount)
      .slice(0, 10);
    if (!sorted.length) return ctx.reply('❌ لا توجد رسائل مسجّلة بعد.');
    let text = `🏆 *أنشط أعضاء ${ctx.chat.title}*\n\n`;
    sorted.forEach((m, i) => {
      const name = m.username ? `@${m.username}` : m.firstName;
      text += `${i + 1}. ${name} — \`${m.messageCount}\` رسالة\n`;
    });
    await ctx.replyWithMarkdown(text);
  });

  // /myscore — نقاطي
  bot.command('myscore', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const g = db.getGroup(ctx.chat.id);
    const m = g?.members.get(ctx.from.id);
    if (!m) return ctx.reply('❌ لا توجد بيانات لك بعد.');
    const name = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;
    await ctx.replyWithMarkdown(
      `📊 *نقاطي*\n\n👤 ${name}\n✉️ الرسائل: \`${m.messageCount || 0}\`\n⭐ النقاط: \`${m.score || 0}\``
    );
  });
};
