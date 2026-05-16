// handler_groups.js — معالجات المجموعات — جامعة v5.0
// يشمل: نظام التوجيه للمتخصصين، CAPTCHA، حماية المحتوى، spam
const { Markup }       = require('telegraf');
const db               = require('./db');
const supa             = require('./supabase');
const {
  isDeveloper, isAdmin,
  muteMember, promoteUser, logAction,
  generateCaptcha, handleSpecialistRouting,
} = require('./helpers');
const { DEVELOPER_ID } = require('./config');

// ── anti-spam: تتبع سرعة الرسائل ──────────────────────────
const msgRatemap = new Map(); // userId → [timestamps]

function isSpam(userId, windowMs = 5000, threshold = 5) {
  const now  = Date.now();
  if (!msgRatemap.has(userId)) msgRatemap.set(userId, []);
  const times = msgRatemap.get(userId).filter(t => now - t < windowMs);
  times.push(now);
  msgRatemap.set(userId, times);
  return times.length > threshold;
}

function groupHomeKeyboard(chatId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('⚙️ إعدادات المجموعة', `settings_${chatId}`), Markup.button.callback('👥 المشرفون', `admins_${chatId}`)],
    [Markup.button.callback('📋 القواعد',           `rules_${chatId}`),    Markup.button.callback('📊 إحصائيات', `stats_${chatId}`)],
    [Markup.button.callback('📨 طلبات الانضمام',    `joinreqs_${chatId}`)],
  ]);
}

module.exports = function setupGroupHandlers(bot) {

  // ── انضمام/مغادرة البوت ──────────────────────────────────────────────
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
        await db.getOrCreateChannel(chat.id, chat.title || 'قناة', chat.username || '', from.id, from.username || from.first_name || String(from.id));
        const u = await db.getOrCreateUser(from.id, from.username || '', from.first_name || '');
        if (u) u.channels?.add(chat.id);
        try {
          const admins = await bot.telegram.getChatAdministrators(chat.id);
          const owner  = admins.find(a => a.status === 'creator');
          const ch     = db.getChannel(chat.id);
          if (owner && ch) { ch.ownerId = owner.user.id; ch.ownerUsername = owner.user.username || owner.user.first_name; }
        } catch {}
        try { await ctx.replyWithMarkdown(`📢 *شكراً لإضافتي لقناة ${chat.title}!*`); } catch {}
      } else {
        const group = await db.getOrCreateGroup(chat.id, chat.title || 'مجموعة', chat.type, from.id, from.username || from.first_name || String(from.id));
        const u = await db.getOrCreateUser(from.id, from.username || '', from.first_name || '');
        if (u) u.groups?.add(chat.id);
        await db.trackMember(chat.id, from.id, from.username || '', from.first_name || '', 'member');
        let promoted = false;
        try { if (newStat === 'administrator') promoted = await promoteUser(bot, chat.id, from.id); } catch {}
        if (promoted && group) {
          group.admins.set(from.id, { username: from.username || from.first_name || String(from.id), promotedBy: ctx.botInfo.id, promotedByUsername: ctx.botInfo.username || 'Bot', promotedAt: new Date() });
          await db.trackMember(chat.id, from.id, from.username || '', from.first_name || '', 'admin');
        }
        try {
          const admins = await bot.telegram.getChatAdministrators(chat.id);
          const owner  = admins.find(a => a.status === 'creator');
          if (owner && group) {
            group.ownerId      = owner.user.id;
            group.ownerUsername = owner.user.username || owner.user.first_name;
            await db.trackMember(chat.id, owner.user.id, owner.user.username || '', owner.user.first_name || '', 'owner');
            db.scheduleSync(group);
          }
        } catch {}
        await ctx.replyWithMarkdown(
          `🤖 *شكراً لإضافتي إلى ${chat.title}!*\n\n` +
          (promoted ? `✅ تم ترقيتي مشرفاً تلقائياً!\n\n` : '') +
          `👑 المالك: \`${group?.ownerUsername || 'غير محدد'}\`\n🛡️ جاهز للإدارة!\n\n_استخدم /settings للإعدادات_`,
          groupHomeKeyboard(chat.id)
        );
      }
    } else if (left) {
      if (isChannel) await db.deleteChannel(chat.id);
      else await db.deleteGroup(chat.id);
    }
  });

  // ── تغييرات الأعضاء ─────────────────────────────────────────────────
  bot.on('chat_member', async (ctx) => {
    const upd  = ctx.chatMember;
    const { chat, from: by } = upd;
    const newM = upd.new_chat_member;
    const oldM = upd.old_chat_member;
    const u    = newM.user;

    if (chat.type === 'channel') {
      const ch = db.getChannel(chat.id);
      if (ch && (newM.status === 'member' || newM.status === 'subscriber')) {
        ch.subscribers?.set(u.id, { joinedAt: new Date() });
        const usr = await db.getOrCreateUser(u.id, u.username || '', u.first_name || '');
        if (usr) usr.channels?.add(chat.id);
      }
      return;
    }

    const g = await db.getGroup(chat.id);

    if (newM.status === 'creator') {
      if (g) { g.ownerId = u.id; g.ownerUsername = u.username || u.first_name || String(u.id); db.scheduleSync(g); }
      await db.trackMember(chat.id, u.id, u.username || '', u.first_name || '', 'owner');
    }
    if (newM.status === 'administrator' && oldM.status !== 'administrator') {
      if (g) g.admins.set(u.id, { username: u.username || u.first_name || String(u.id), promotedBy: by.id, promotedByUsername: by.username || by.first_name || String(by.id), promotedAt: new Date() });
      await db.trackMember(chat.id, u.id, u.username || '', u.first_name || '', 'admin');
    }
    if (oldM.status === 'administrator' && newM.status === 'member') {
      if (g) g.admins.delete(u.id);
      await db.trackMember(chat.id, u.id, u.username || '', u.first_name || '', 'member');
    }

    // ── منع البوتات ──────────────────────────────────────────────────
    if (g?.antiBot && u.is_bot) {
      try { await bot.telegram.banChatMember(chat.id, u.id); } catch {}
      const adderName = by.username ? `@${by.username}` : by.first_name;
      await logAction(bot, g, '🤖 إزالة بوت', by,
        { id: u.id, username: u.username || '', firstName: u.first_name || 'بوت' },
        `البوت المضاف: @${u.username || u.id}`).catch(() => {});
      if (!g.warns.has(by.id)) g.warns.set(by.id, []);
      const warns = g.warns.get(by.id);
      warns.push({ reason: `أضاف بوت (@${u.username || u.id}) للمجموعة`, warnedBy: ctx.botInfo?.id || 0, warnedAt: new Date(), isAutomatic: true });
      await supa.addWarn(chat.id, by.id, `أضاف بوت (@${u.username || u.id})`, ctx.botInfo?.id || 0);
      try {
        await bot.telegram.sendMessage(chat.id,
          `🤖 *تنبيه — منع البوتات*\n\n✅ تم إزالة البوت @${u.username || u.id} تلقائياً.\n⚠️ ${adderName} — تحذير \`${warns.length}/${g.maxWarns}\``,
          { parse_mode: 'Markdown' }
        );
      } catch {}
      if (warns.length >= g.maxWarns) {
        try {
          await bot.telegram.banChatMember(chat.id, by.id);
          g.bannedUsers.add(by.id);
          g.warns.delete(by.id);
          await supa.clearWarns(chat.id, by.id);
          await bot.telegram.sendMessage(chat.id, `🚫 *حظر تلقائي*\n${adderName} — تكرار إضافة البوتات.`, { parse_mode: 'Markdown' });
        } catch {}
      }
      return;
    }

    if (u.is_bot) return;

    if (newM.status === 'member' && (oldM.status === 'left' || oldM.status === 'kicked')) {
      const urec = await db.getOrCreateUser(u.id, u.username || '', u.first_name || '');
      if (urec) urec.groups?.add(chat.id);
      await db.trackMember(chat.id, u.id, u.username || '', u.first_name || '', 'member');
      if (!g) return;

      // ── فحص المجتمع ─────────────────────────────────────────────
      if (g.communityId) {
        const exceeded = await db.recordCommunityJoin(g.communityId, u.id, chat.id);
        if (exceeded) {
          const com = db.getCommunity(g.communityId);
          const joinedGroupNames = [...(com?.memberJoins.get(u.id) || [])].map(id => {
            const grp = db.allGroups().find(gg => (gg.chatId || gg.chat_id) === id);
            return grp ? grp.title : String(id);
          }).join('، ');
          try { await bot.telegram.banChatMember(chat.id, u.id); g.bannedUsers.add(u.id); } catch {}
          if (com) {
            for (const id of com.subGroups) { try { await bot.telegram.banChatMember(id, u.id); } catch {} }
            if (!com.autoBannedUsers) com.autoBannedUsers = new Map();
            com.autoBannedUsers.set(u.id, { reason: `انضم لأكثر من ${com.maxGroupJoins} مجموعة`, groups: joinedGroupNames, bannedAt: new Date() });
          }
          const banMsg =
            `🚫 *حظر تلقائي — نظام المجتمع*\n\n` +
            `👤 ${u.username ? `@${u.username}` : u.first_name} \`[${u.id}]\`\n` +
            `📚 المجتمع: *${com?.title || 'غير محدد'}*\n` +
            `🔢 الحد المسموح: \`${com?.maxGroupJoins || 1}\` مجموعة\n` +
            `📋 انضم لـ: ${joinedGroupNames || 'غير محدد'}`;
          if (g.ownerId) { try { await bot.telegram.sendMessage(g.ownerId, banMsg, { parse_mode: 'Markdown' }); } catch {} }
          try { await bot.telegram.sendMessage(DEVELOPER_ID, banMsg, { parse_mode: 'Markdown' }); } catch {}
          return;
        }
      }

      if (urec?.globalBanned) { try { await bot.telegram.banChatMember(chat.id, u.id); } catch {} return; }

      // ── CAPTCHA ──────────────────────────────────────────────────
      if (g.captchaEnabled) {
        const captcha = generateCaptcha();
        try {
          await muteMember(bot, chat.id, u.id);
          const expires = Date.now() + 5 * 60 * 1000; // 5 دقائق
          const msg = await bot.telegram.sendMessage(chat.id,
            `👋 مرحباً ${u.first_name}! قبل البدء، أجب على هذا السؤال:\n\n🔢 *${captcha.q} = ?*\n\n⏱️ لديك 5 دقائق للإجابة، وإلا ستُطرد.`,
            {
              parse_mode: 'Markdown',
              ...Markup.inlineKeyboard([
                [1, 2, 3, 4, 5].map(n => Markup.button.callback(`${n}`, `captcha_${u.id}_${chat.id}_${n}`)),
                [[6, 7, 8, 9, 10].map(n => Markup.button.callback(`${n}`, `captcha_${u.id}_${chat.id}_${n}`))],
              ].flat()),
            }
          );
          await supa.setPendingCaptcha(chat.id, u.id, captcha.answer, msg.message_id, expires);
          // طرد تلقائي بعد انتهاء المدة
          setTimeout(async () => {
            const pending = await supa.getPendingCaptcha(chat.id, u.id);
            if (pending) {
              try { await bot.telegram.banChatMember(chat.id, u.id); } catch {}
              try { await bot.telegram.unbanChatMember(chat.id, u.id); } catch {}
              try { await bot.telegram.deleteMessage(chat.id, msg.message_id); } catch {}
              await supa.deletePendingCaptcha(chat.id, u.id);
              try { await bot.telegram.sendMessage(chat.id, `⏱️ انتهت مدة ${u.first_name} للإجابة — تم الطرد تلقائياً.`); } catch {}
            }
          }, 5 * 60 * 1000);
        } catch {}
        return;
      }

      if (g.muteNewMembers) { try { await muteMember(bot, chat.id, u.id); } catch {} }
      if (!g.welcomeEnabled) return;
      const msg = (g.welcomeMessage || '👋 مرحباً {name} في {group}!')
        .replace('{name}',     u.first_name || '')
        .replace('{group}',    chat.title   || 'المجموعة')
        .replace('{username}', u.username ? `@${u.username}` : u.first_name || '');
      try {
        await bot.telegram.sendMessage(chat.id, `👋 ${msg}`,
          { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('📋 القواعد', `rules_${chat.id}`)]]) });
      } catch {}
    }
  });

  // ── CAPTCHA — استجابة أزرار ──────────────────────────────────
  bot.action(/^captcha_(\d+)_(-?\d+)_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const uid    = Number(ctx.match[1]);
    const chatId = Number(ctx.match[2]);
    const answer = Number(ctx.match[3]);
    if (ctx.from.id !== uid) return ctx.answerCbQuery('❌ هذا ليس اختبارك!', { show_alert: true });
    const pending = await supa.getPendingCaptcha(chatId, uid);
    if (!pending) return ctx.answerCbQuery('⏱️ انتهى وقت الاختبار', { show_alert: true });
    if (new Date(pending.expires_at).getTime() < Date.now()) {
      await supa.deletePendingCaptcha(chatId, uid);
      try { await bot.telegram.banChatMember(chatId, uid); } catch {}
      try { await bot.telegram.unbanChatMember(chatId, uid); } catch {}
      try { await ctx.deleteMessage(); } catch {}
      return ctx.answerCbQuery('⏱️ انتهى وقت الاختبار — تم الطرد', { show_alert: true });
    }
    if (String(answer) === String(pending.answer)) {
      // إجابة صحيحة
      await supa.deletePendingCaptcha(chatId, uid);
      const g = await db.getGroup(chatId);
      if (g && !g.muteNewMembers) {
        const { Markup: M } = require('telegraf');
        try {
          await bot.telegram.restrictChatMember(chatId, uid, {
            permissions: {
              can_send_messages: g.perms?.canSendMessages !== false,
              can_send_audios: g.perms?.canSendMedia !== false,
              can_send_documents: g.perms?.canSendMedia !== false,
              can_send_photos: g.perms?.canSendMedia !== false,
              can_send_videos: g.perms?.canSendMedia !== false,
              can_send_video_notes: g.perms?.canSendMedia !== false,
              can_send_voice_notes: g.perms?.canSendMedia !== false,
              can_send_polls: g.perms?.canSendPolls !== false,
              can_send_other_messages: g.perms?.canSendMessages !== false,
              can_add_web_page_previews: g.perms?.canAddWebPreviews !== false,
            },
          });
        } catch {}
      }
      try { await ctx.deleteMessage(); } catch {}
      try { await bot.telegram.sendMessage(chatId, `✅ مرحباً ${ctx.from.first_name}! تم التحقق بنجاح. 🎉`); } catch {}
    } else {
      // إجابة خاطئة
      await supa.incrementCaptchaAttempts(chatId, uid);
      if ((pending.attempts || 0) >= 2) {
        await supa.deletePendingCaptcha(chatId, uid);
        try { await bot.telegram.banChatMember(chatId, uid); } catch {}
        try { await bot.telegram.unbanChatMember(chatId, uid); } catch {}
        try { await ctx.deleteMessage(); } catch {}
        await ctx.answerCbQuery('❌ أجوبة خاطئة متعددة — تم الطرد!', { show_alert: true });
      } else {
        await ctx.answerCbQuery('❌ إجابة خاطئة! حاول مرة أخرى.', { show_alert: true });
      }
    }
  });

  // ── طلبات الانضمام ──────────────────────────────────────────────────
  bot.on('chat_join_request', async (ctx) => {
    const req  = ctx.chatJoinRequest;
    const { chat } = req;
    const u    = req.from;
    const g    = await db.getGroup(chat.id);
    if (!g || !g.joinRequestsEnabled) return;

    // فحص فترة الانتظار
    const cooldown = await supa.getJoinRequestCooldown(chat.id, u.id);
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
    await supa.addJoinRequest(chat.id, u.id, u.first_name || '', u.username || '', req.bio || '', req.invite_link?.invite_link || '');

    // فحص المجتمع
    if (g.communityId) {
      const exceeded = await db.recordCommunityJoin(g.communityId, u.id, chat.id);
      if (exceeded) {
        const com = db.getCommunity(g.communityId);
        const joinedGroupNames = await supa.getCommunityMemberJoins(g.communityId, u.id);
        try { await bot.telegram.declineChatJoinRequest(chat.id, u.id); g.joinRequests.get(u.id).status = 'rejected_community'; } catch {}
        if (!com.autoBannedUsers) com.autoBannedUsers = new Map();
        com.autoBannedUsers.set(u.id, { reason: `طلب انضمام لأكثر من ${com.maxGroupJoins} مجموعة`, groups: joinedGroupNames.join('،'), bannedAt: new Date() });
        const msg =
          `⚠️ *رُفض طلب انضمام — مجتمع ${com?.title || ''}*\n\n` +
          `👤 ${u.username ? `@${u.username}` : u.first_name} \`[${u.id}]\`\n` +
          `🚫 طلب أكثر من ${com?.maxGroupJoins || 1} مجموعة.`;
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
    const notifyIds = new Set([g.ownerId, ...(g.admins ? g.admins.keys() : [])].filter(Boolean));
    for (const adminId of notifyIds) {
      try { await bot.telegram.sendMessage(adminId, notifyText, { parse_mode: 'Markdown', ...actionBtns }); } catch {}
    }
    try { await bot.telegram.sendMessage(DEVELOPER_ID, notifyText, { parse_mode: 'Markdown', ...actionBtns }); } catch {}
  });

  // قبول طلب
  bot.action(/^jr_approve_(\d+)_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const [uid, cid] = [Number(ctx.match[1]), Number(ctx.match[2])];
    const g = await db.getGroup(cid);
    if (!isDeveloper(ctx) && !(g && ctx.from.id === g.ownerId) && !await isAdmin(bot, cid, ctx.from.id))
      return ctx.answerCbQuery('❌ ليس لديك صلاحية!', { show_alert: true });
    try {
      await bot.telegram.approveChatJoinRequest(cid, uid);
      if (g?.joinRequests.has(uid)) g.joinRequests.get(uid).status = 'approved';
      await supa.updateJoinRequest(cid, uid, 'approved', ctx.from.id);
      await ctx.answerCbQuery('✅ تم القبول!', { show_alert: true });
      await ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n✅ *تم القبول*', { parse_mode: 'Markdown' });
    } catch (e) { await ctx.answerCbQuery(`❌ ${e.message}`, { show_alert: true }); }
  });

  // رفض طلب
  bot.action(/^jr_reject_(\d+)_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const [uid, cid] = [Number(ctx.match[1]), Number(ctx.match[2])];
    const g = await db.getGroup(cid);
    if (!isDeveloper(ctx) && !(g && ctx.from.id === g.ownerId) && !await isAdmin(bot, cid, ctx.from.id))
      return ctx.answerCbQuery('❌ ليس لديك صلاحية!', { show_alert: true });
    try {
      await bot.telegram.declineChatJoinRequest(cid, uid);
      if (g?.joinRequests.has(uid)) g.joinRequests.get(uid).status = 'rejected';
      await supa.updateJoinRequest(cid, uid, 'rejected', ctx.from.id);
      await supa.setJoinRequestCooldown(cid, uid, Date.now() + 24 * 3600 * 1000);
      await ctx.answerCbQuery('❌ تم الرفض!', { show_alert: true });
      await ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n❌ *تم الرفض*', { parse_mode: 'Markdown' });
    } catch (e) { await ctx.answerCbQuery(`❌ ${e.message}`, { show_alert: true }); }
  });

  // تحقق من الطالب
  bot.action(/^jr_check_(\d+)_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const [uid, cid] = [Number(ctx.match[1]), Number(ctx.match[2])];
    const g  = await db.getGroup(cid);
    const r  = g?.joinRequests.get(uid);
    const gu = db.getUser(uid) || await supa.getUser(uid);
    const joinedCount = gu ? [...(gu.groups?.values() || [])].length : 0;
    let text =
      `🔍 *معلومات الطالب*\n\n` +
      `👤 ${r?.firstName || uid}${r?.username ? ` (@${r.username})` : ''}\n` +
      `🆔 \`${uid}\`\n` +
      `📊 في ${joinedCount} مجموعة معروفة\n` +
      `🌐 محظور عالمياً: ${gu?.globalBanned || gu?.global_banned ? '🚫 نعم' : '✅ لا'}\n` +
      (r?.bio ? `📝 ${r.bio}\n` : '');
    try {
      await bot.telegram.sendMessage(ctx.from.id, text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[
          Markup.button.callback('✅ قبول',  `jr_approve_${uid}_${cid}`),
          Markup.button.callback('❌ رفض',  `jr_reject_${uid}_${cid}`),
        ]]),
      });
    } catch { await ctx.answerCbQuery('ℹ️ افتح محادثة مع البوت أولاً', { show_alert: true }); }
  });

  // ── Stats / Rules / Admins / JoinReqs ─────────────────────────────
  bot.action(/^stats_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = await db.getGroup(chatId);
    if (!g) return ctx.answerCbQuery('❌ بيانات غير موجودة', { show_alert: true });
    const warns   = [...g.warns.values()].reduce((a, w) => a + w.length, 0);
    const pending = [...g.joinRequests.values()].filter(r => r.status === 'pending').length;
    const specialists = await supa.getSpecialists(chatId);
    const keywords    = await supa.getRoutingKeywords(chatId);
    await ctx.replyWithMarkdown(
      `📊 *إحصائيات ${g.title}*\n\n` +
      `👥 الأعضاء (معروفون): \`${g.members.size}\`\n` +
      `👮 المشرفون: \`${g.admins.size}\`\n` +
      `⚠️ التحذيرات: \`${warns}\`\n` +
      `🔇 المكتومون: \`${g.mutedUsers.size}\`\n` +
      `🚫 المحظورون: \`${g.bannedUsers.size}\`\n` +
      `📨 طلبات معلقة: \`${pending}\`\n` +
      `🔤 كلمات محظورة: \`${g.bannedWords.length}\`\n` +
      `👨‍💼 المتخصصون: \`${specialists.length}\`\n` +
      `🔑 كلمات التوجيه: \`${keywords.length}\``
    );
  });

  bot.action(/^rules_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = await db.getGroup(chatId);
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
    const g = await db.getGroup(chatId);
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

  // ── زر: session_done ──────────────────────────────────────────────
  bot.action(/^session_done_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery('✅ تم التسجيل', { show_alert: true });
    try { await ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n✅ *تم التواصل*', { parse_mode: 'Markdown' }); } catch {}
  });

  // ── فحص رسائل المواضيع المقفلة ──────────────────────────────────────
  bot.on('message', async (ctx, next) => {
    if (!ctx.message || !ctx.chat || ctx.chat.type === 'private') return next();
    const threadId = ctx.message.message_thread_id;
    if (!threadId) return next();
    const chatId = ctx.chat.id;
    const g      = await db.getGroup(chatId);
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
            { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[
              Markup.button.callback('✅ سماح', `topic_allow_${ctx.from.id}_${chatId}_${threadId}`),
              Markup.button.callback('❌ رفض',  `topic_deny_${ctx.from.id}_${chatId}_${threadId}`),
            ]]) }
          );
        } catch {}
      }
    }
    return next();
  });

  // أزرار موافقة/رفض موضوع
  bot.action(/^topic_allow_(\d+)_(-?\d+)_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const uid = Number(ctx.match[1]), chatId = Number(ctx.match[2]), topicId = Number(ctx.match[3]);
    const g = await db.getGroup(chatId); if (!g) return;
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

  // /top — لوحة الصدارة
  bot.command('top', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    const sorted = await supa.getTopMembers(chatId, 10);
    if (!sorted.length) return ctx.reply('❌ لا توجد بيانات أعضاء بعد.');
    let text = `🏆 *أنشط أعضاء ${ctx.chat.title}*\n\n`;
    const medals = ['🥇', '🥈', '🥉'];
    sorted.forEach((m, i) => {
      const name = m.username ? `@${m.username}` : m.first_name;
      const medal = medals[i] || `${i + 1}.`;
      text += `${medal} ${name} — \`${m.score || m.message_count || 0}\` نقطة\n`;
    });
    await ctx.replyWithMarkdown(text);
  });

  // /myscore — نقاطي
  bot.command('myscore', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    const g      = await db.getGroup(chatId);
    const cached = g?.members.get(ctx.from.id);
    const m      = cached || await supa.getMember(chatId, ctx.from.id);
    if (!m) return ctx.reply('❌ لا توجد بيانات لك بعد، أرسل رسالة أولاً!');
    const rank = await supa.getMemberRank(chatId, ctx.from.id);
    const name = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;
    await ctx.replyWithMarkdown(
      `📊 *نقاطي*\n\n👤 ${name}\n` +
      `✉️ الرسائل: \`${m.messageCount || m.message_count || 0}\`\n` +
      `⭐ النقاط: \`${m.score || 0}\`\n` +
      (rank ? `🏅 الترتيب: \`#${rank}\`` : '')
    );
  });

  // /joinreqs أمر نصي
  bot.command('joinreqs', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return ctx.reply('❌ للمشرفين فقط!');
    const g = await db.getGroup(chatId);
    const pending = g ? [...g.joinRequests.values()].filter(r => r.status === 'pending') : [];
    if (!pending.length) {
      const fromDB = await supa.getPendingRequests(chatId);
      if (!fromDB.length) return ctx.replyWithMarkdown('✅ *لا توجد طلبات انضمام معلقة.*');
      let text = `📨 *طلبات الانضمام المعلقة* (${fromDB.length})\n\n`;
      fromDB.slice(0, 10).forEach((r, i) => {
        text += `${i + 1}. ${r.first_name}${r.username ? ` (@${r.username})` : ''} \`[${r.user_id}]\`\n`;
      });
      const btns = fromDB.slice(0, 5).flatMap(r => [[
        Markup.button.callback(`✅ ${r.first_name.slice(0, 12)}`, `jr_approve_${r.user_id}_${chatId}`),
        Markup.button.callback('❌', `jr_reject_${r.user_id}_${chatId}`),
      ]]);
      return ctx.replyWithMarkdown(text, Markup.inlineKeyboard(btns));
    }
    let text = `📨 *طلبات الانضمام المعلقة* (${pending.length})\n\n`;
    pending.slice(0, 10).forEach((r, i) => {
      text += `${i + 1}. ${r.firstName}${r.username ? ` (@${r.username})` : ''} \`[${r.userId}]\`\n`;
    });
    const btns = pending.slice(0, 5).flatMap(r => [[
      Markup.button.callback(`✅ ${r.firstName.slice(0, 12)}`, `jr_approve_${r.userId}_${chatId}`),
      Markup.button.callback('❌', `jr_reject_${r.userId}_${chatId}`),
    ]]);
    await ctx.replyWithMarkdown(text, Markup.inlineKeyboard(btns));
  });

  // ── معالج الرسائل الرئيسي ────────────────────────────────────────────
  bot.on('message', async (ctx, next) => {
    if (!ctx.message || !ctx.chat || ctx.chat.type === 'private') return next();
    const from   = ctx.from;
    const chatId = ctx.chat.id;
    const text   = ctx.message.text || ctx.message.caption || '';
    const g      = await db.getGroup(chatId);
    if (!g) return next();

    // ── 1) فحص كلمات التوجيه (المتخصصون) ────────────────────
    if (text) {
      const matched = await supa.findMatchingKeyword(chatId, text);
      if (matched) {
        await handleSpecialistRouting(bot, ctx, g, matched, text);
        return; // لا تكمل باقي المعالجات
      }
    }

    // ── 2) منع الروابط ───────────────────────────────────────
    if (g.antiLinks && text) {
      const linkRegex = /https?:\/\/|t\.me\/|@\w{5,}/gi;
      if (linkRegex.test(text)) {
        const isAdminUser = await isAdmin(bot, chatId, from.id);
        if (!isAdminUser) {
          try { await ctx.deleteMessage(); } catch {}
          const notif = await bot.telegram.sendMessage(chatId,
            `⚠️ ${from.username ? `@${from.username}` : from.first_name} — الروابط ممنوعة!`,
            { parse_mode: 'Markdown' }
          );
          setTimeout(() => bot.telegram.deleteMessage(chatId, notif.message_id).catch(() => {}), 5000);
          return;
        }
      }
    }

    // ── 3) مكافحة الكلمات المحظورة ──────────────────────────
    if (text && g.bannedWords.length > 0) {
      const lowerText = text.toLowerCase();
      for (const bw of g.bannedWords) {
        if (lowerText.includes(bw.word.toLowerCase())) {
          const isAdminUser = await isAdmin(bot, chatId, from.id);
          if (isAdminUser) continue;
          try { await ctx.deleteMessage(); } catch {}
          const count = await db.recordWordViolation(chatId, from.id, bw.word);
          if (count >= (bw.threshold || 1)) {
            const arAct = { warn: '⚠️ تحذير', mute: '🔇 كتم', kick: '👢 طرد', ban: '🚫 حظر' };
            await db.resetWordViolation(chatId, from.id, bw.word);
            if (bw.action === 'warn') {
              if (!g.warns.has(from.id)) g.warns.set(from.id, []);
              g.warns.get(from.id).push({ reason: `كلمة محظورة: ${bw.word}`, warnedBy: ctx.botInfo?.id || 0, warnedAt: new Date() });
              await supa.addWarn(chatId, from.id, `كلمة محظورة: ${bw.word}`, ctx.botInfo?.id || 0);
              await logAction(bot, g, `⚠️ تحذير تلقائي (${bw.word})`, { id: 0, username: 'bot', first_name: 'Bot' }, from, `كلمة محظورة`);
            } else if (bw.action === 'mute') {
              try { await muteMember(bot, chatId, from.id); g.mutedUsers.add(from.id); } catch {}
            } else if (bw.action === 'kick') {
              try {
                await bot.telegram.banChatMember(chatId, from.id);
                setTimeout(() => bot.telegram.unbanChatMember(chatId, from.id).catch(() => {}), 1500);
              } catch {}
            } else if (bw.action === 'ban') {
              try { await bot.telegram.banChatMember(chatId, from.id); g.bannedUsers.add(from.id); } catch {}
            }
            try {
              const notif = await bot.telegram.sendMessage(chatId,
                `⚠️ *كلمة محظورة!*\n${from.username ? `@${from.username}` : from.first_name} — ${arAct[bw.action]}`,
                { parse_mode: 'Markdown' }
              );
              setTimeout(() => bot.telegram.deleteMessage(chatId, notif.message_id).catch(() => {}), 5000);
            } catch {}
          }
          return;
        }
      }
    }

    // ── 4) مكافحة الـ Spam ───────────────────────────────────
    if (g.antiSpam) {
      const isAdminUser = await isAdmin(bot, chatId, from.id);
      if (!isAdminUser && isSpam(from.id)) {
        try { await ctx.deleteMessage(); } catch {}
        if (!g.warns.has(from.id)) g.warns.set(from.id, []);
        const warns = g.warns.get(from.id);
        warns.push({ reason: 'سبام تلقائي', warnedBy: 0, warnedAt: new Date() });
        await supa.addWarn(chatId, from.id, 'سبام تلقائي', 0);
        if (warns.length >= g.maxWarns) {
          try { await muteMember(bot, chatId, from.id); g.mutedUsers.add(from.id); g.warns.delete(from.id); } catch {}
        }
        return;
      }
    }

    return next();
  });
};
