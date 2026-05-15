const { Markup }     = require('telegraf');
const db             = require('./db');
const { isDeveloper, isAdmin, muteMember, promoteUser } = require('./helpers');
const { DEVELOPER_ID } = require('./config');

function groupHomeKeyboard(chatId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('⚙️ إعدادات المجموعة', `settings_${chatId}`), Markup.button.callback('👥 المشرفون', `admins_${chatId}`)],
    [Markup.button.callback('📋 القواعد', `rules_${chatId}`), Markup.button.callback('📊 إحصائيات', `stats_${chatId}`)],
    [Markup.button.callback('📨 طلبات الانضمام', `joinreqs_${chatId}`)],
  ]);
}

module.exports = function setupGroupHandlers(bot) {

  bot.on('my_chat_member', async (ctx) => {
    const upd = ctx.myChatMember;
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
        try { const admins = await bot.telegram.getChatAdministrators(chat.id); const owner = admins.find(a => a.status === 'creator'); if (owner) { channel.ownerId = owner.user.id; channel.ownerUsername = owner.user.username || owner.user.first_name; } } catch { }
        try { await ctx.replyWithMarkdown(`📢 *شكراً لإضافتي لقناة ${chat.title}!*\n\n👑 المالك: \`${db.getChannel(chat.id)?.ownerUsername || 'غير محدد'}\``); } catch { }
      } else {
        const group = db.getOrCreateGroup(chat.id, chat.title || 'مجموعة', chat.type, from.id, from.username || from.first_name || String(from.id));
        db.getOrCreateUser(from.id, from.username || '', from.first_name || '').groups.add(chat.id);
        db.trackMember(chat.id, from.id, from.username || '', from.first_name || '', 'member');
        let promoted = false;
        try { if (newStat === 'administrator') promoted = await promoteUser(bot, chat.id, from.id); } catch { }
        if (promoted) { group.admins.set(from.id, { username: from.username || from.first_name || String(from.id), promotedBy: ctx.botInfo.id, promotedByUsername: ctx.botInfo.username || 'Bot', promotedAt: new Date() }); db.trackMember(chat.id, from.id, from.username || '', from.first_name || '', 'admin'); }
        try { const admins = await bot.telegram.getChatAdministrators(chat.id); const owner = admins.find(a => a.status === 'creator'); if (owner) { group.ownerId = owner.user.id; group.ownerUsername = owner.user.username || owner.user.first_name; db.trackMember(chat.id, owner.user.id, owner.user.username || '', owner.user.first_name || '', 'owner'); } } catch { }
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

  bot.on('chat_member', async (ctx) => {
    const upd = ctx.chatMember;
    const { chat, from: by } = upd;
    const newM = upd.new_chat_member;
    const oldM = upd.old_chat_member;
    const u = newM.user;
    if (u.is_bot) return;

    if (chat.type === 'channel') {
      const ch = db.getChannel(chat.id);
      if (ch && (newM.status === 'member' || newM.status === 'subscriber')) { ch.subscribers.set(u.id, { joinedAt: new Date() }); db.getOrCreateUser(u.id, u.username || '', u.first_name || '').channels.add(chat.id); }
      return;
    }

    if (newM.status === 'creator') { const g = db.getGroup(chat.id); if (g) { g.ownerId = u.id; g.ownerUsername = u.username || u.first_name || String(u.id); } db.trackMember(chat.id, u.id, u.username || '', u.first_name || '', 'owner'); }
    if (newM.status === 'administrator' && oldM.status !== 'administrator') { const g = db.getGroup(chat.id); if (g) g.admins.set(u.id, { username: u.username || u.first_name || String(u.id), promotedBy: by.id, promotedByUsername: by.username || by.first_name || String(by.id), promotedAt: new Date() }); db.trackMember(chat.id, u.id, u.username || '', u.first_name || '', 'admin'); }
    if (oldM.status === 'administrator' && newM.status === 'member') { const g = db.getGroup(chat.id); if (g) g.admins.delete(u.id); db.trackMember(chat.id, u.id, u.username || '', u.first_name || '', 'member'); }

    if (newM.status === 'member' && (oldM.status === 'left' || oldM.status === 'kicked')) {
      const g    = db.getGroup(chat.id);
      const urec = db.getOrCreateUser(u.id, u.username || '', u.first_name || '');
      urec.groups.add(chat.id);
      db.trackMember(chat.id, u.id, u.username || '', u.first_name || '', 'member');
      if (!g) return;
      if (g.communityId) {
        const exceeded = db.recordCommunityJoin(g.communityId, u.id, chat.id);
        if (exceeded) {
          const com = db.getCommunity(g.communityId);
          try { await bot.telegram.banChatMember(chat.id, u.id); g.bannedUsers.add(u.id); } catch { }
          if (com) { for (const id of com.subGroups) { try { await bot.telegram.banChatMember(id, u.id); } catch { } } }
          const msg = `⚠️ *تنبيه أمني — مجتمع ${com?.title || ''}*\n\n👤 ${u.username ? `@${u.username}` : u.first_name} \`[${u.id}]\`\n🚫 *حُظر تلقائياً* لانضمامه لأكثر من ${com?.maxGroupJoins || 1} مجموعة!`;
          if (g.ownerId) { try { await bot.telegram.sendMessage(g.ownerId, msg, { parse_mode: 'Markdown' }); } catch { } }
          try { await bot.telegram.sendMessage(DEVELOPER_ID, msg, { parse_mode: 'Markdown' }); } catch { }
          return;
        }
      }
      if (urec.globalBanned) { try { await bot.telegram.banChatMember(chat.id, u.id); } catch { } return; }
      if (g.muteNewMembers) { try { await muteMember(bot, chat.id, u.id); } catch { } }
      if (!g.welcomeEnabled) return;
      const msg = g.welcomeMessage.replace('{name}', u.first_name || '').replace('{group}', chat.title || 'المجموعة').replace('{username}', u.username ? `@${u.username}` : u.first_name || '');
      try { await bot.telegram.sendMessage(chat.id, `👋 ${msg}`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('📋 القواعد', `rules_${chat.id}`)]]) }); } catch { }
    }
  });

  bot.on('chat_join_request', async (ctx) => {
    const req = ctx.chatJoinRequest;
    const { chat } = req; const u = req.from;
    const g = db.getGroup(chat.id); if (!g) return;
    g.joinRequests.set(u.id, { userId: u.id, username: u.username || '', firstName: u.first_name || String(u.id), requestedAt: new Date(), status: 'pending' });
    if (g.communityId) {
      const exceeded = db.recordCommunityJoin(g.communityId, u.id, chat.id);
      if (exceeded) {
        const com = db.getCommunity(g.communityId);
        try { await bot.telegram.declineChatJoinRequest(chat.id, u.id); g.joinRequests.get(u.id).status = 'rejected_community'; } catch { }
        const msg = `⚠️ *رُفض طلب انضمام — مجتمع ${com?.title || ''}*\n\n👤 ${u.username ? `@${u.username}` : u.first_name} \`[${u.id}]\`\n🚫 طلب أكثر من ${com?.maxGroupJoins || 1} مجموعة.`;
        if (g.ownerId) { try { await bot.telegram.sendMessage(g.ownerId, msg, { parse_mode: 'Markdown' }); } catch { } }
        try { await bot.telegram.sendMessage(DEVELOPER_ID, msg, { parse_mode: 'Markdown' }); } catch { }
        return;
      }
    }
    const nameDisplay = u.username ? `@${u.username}` : u.first_name;
    const notifyText  = `📨 *طلب انضمام جديد*\n\n👤 ${nameDisplay}\n🆔 \`${u.id}\`\n📌 *${chat.title}*`;
    const actionBtns  = Markup.inlineKeyboard([[Markup.button.callback('✅ قبول', `jr_approve_${u.id}_${chat.id}`), Markup.button.callback('❌ رفض', `jr_reject_${u.id}_${chat.id}`)]]);
    if (g.ownerId && g.joinRequestsEnabled) { try { await bot.telegram.sendMessage(g.ownerId, notifyText, { parse_mode: 'Markdown', ...actionBtns }); } catch { } }
    try { await bot.telegram.sendMessage(DEVELOPER_ID, notifyText, { parse_mode: 'Markdown', ...actionBtns }); } catch { }
  });

  bot.action(/^jr_approve_(\d+)_(-?\d+)$/, async (ctx) => {
    const [uid, cid] = [Number(ctx.match[1]), Number(ctx.match[2])];
    const g = db.getGroup(cid);
    if (!isDeveloper(ctx) && !(g && ctx.from.id === g.ownerId) && !await isAdmin(bot, cid, ctx.from.id)) return ctx.answerCbQuery('❌ ليس لديك صلاحية!', { show_alert: true });
    try { await bot.telegram.approveChatJoinRequest(cid, uid); if (g?.joinRequests.has(uid)) g.joinRequests.get(uid).status = 'approved'; await ctx.answerCbQuery('✅ تم القبول!', { show_alert: true }); await ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n✅ *تم القبول*', { parse_mode: 'Markdown' }); }
    catch (e) { await ctx.answerCbQuery(`❌ ${e.message}`, { show_alert: true }); }
  });

  bot.action(/^jr_reject_(\d+)_(-?\d+)$/, async (ctx) => {
    const [uid, cid] = [Number(ctx.match[1]), Number(ctx.match[2])];
    const g = db.getGroup(cid);
    if (!isDeveloper(ctx) && !(g && ctx.from.id === g.ownerId) && !await isAdmin(bot, cid, ctx.from.id)) return ctx.answerCbQuery('❌ ليس لديك صلاحية!', { show_alert: true });
    try { await bot.telegram.declineChatJoinRequest(cid, uid); if (g?.joinRequests.has(uid)) g.joinRequests.get(uid).status = 'rejected'; await ctx.answerCbQuery('❌ تم الرفض!', { show_alert: true }); await ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n❌ *تم الرفض*', { parse_mode: 'Markdown' }); }
    catch (e) { await ctx.answerCbQuery(`❌ ${e.message}`, { show_alert: true }); }
  });

  bot.action(/^jr_approveall_(-?\d+)$/, async (ctx) => {
    const cid = Number(ctx.match[1]);
    if (!isDeveloper(ctx) && !await isAdmin(bot, cid, ctx.from.id)) return ctx.answerCbQuery('❌ ليس لديك صلاحية!', { show_alert: true });
    await ctx.answerCbQuery();
    const g = db.getGroup(cid); if (!g) return;
    const pending = [...g.joinRequests.values()].filter(r => r.status === 'pending');
    let done = 0;
    for (const r of pending) { try { await bot.telegram.approveChatJoinRequest(cid, r.userId); r.status = 'approved'; done++; } catch { } }
    await ctx.answerCbQuery(`✅ تم قبول ${done} طلب!`, { show_alert: true });
    await ctx.deleteMessage().catch(() => { });
  });

  bot.action(/^jr_rejectall_(-?\d+)$/, async (ctx) => {
    const cid = Number(ctx.match[1]);
    if (!isDeveloper(ctx) && !await isAdmin(bot, cid, ctx.from.id)) return ctx.answerCbQuery('❌ ليس لديك صلاحية!', { show_alert: true });
    await ctx.answerCbQuery();
    const g = db.getGroup(cid); if (!g) return;
    const pending = [...g.joinRequests.values()].filter(r => r.status === 'pending');
    let done = 0;
    for (const r of pending) { try { await bot.telegram.declineChatJoinRequest(cid, r.userId); r.status = 'rejected'; done++; } catch { } }
    await ctx.answerCbQuery(`❌ تم رفض ${done} طلب!`, { show_alert: true });
    await ctx.deleteMessage().catch(() => { });
  });

  // فلتر الكلمات المحظورة
  bot.on('message', async (ctx, next) => {
    if (!ctx.chat || ctx.chat.type === 'private') return next();
    const text = ctx.message.text || ctx.message.caption || '';
    if (!text) return next();
    const g = db.getGroup(ctx.chat.id);
    if (!g || !g.bannedWords.length) return next();
    if (await isAdmin(bot, ctx.chat.id, ctx.from.id)) return next();
    const lower = text.toLowerCase();
    const found = g.bannedWords.find(bw => lower.includes(bw.word.toLowerCase()));
    if (!found) return next();
    const userId = ctx.from.id;
    const userName = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;
    try { await ctx.deleteMessage(); } catch { }
    const count = db.recordWordViolation(ctx.chat.id, userId, found.word);
    if (count < found.threshold) { await ctx.reply(`⚠️ ${userName} — رسالتك حُذفت (كلمة محظورة).\n⚡ الانتهاك ${count}/${found.threshold}`, { parse_mode: 'Markdown' }); return next(); }
    db.resetWordViolation(ctx.chat.id, userId, found.word);
    if (found.action === 'warn') {
      if (!g.warns.has(userId)) g.warns.set(userId, []);
      const warns = g.warns.get(userId); warns.push({ reason: `كلمة محظورة: ${found.word}`, warnedBy: ctx.botInfo.id, warnedAt: new Date() });
      if (warns.length >= g.maxWarns) { try { await bot.telegram.banChatMember(ctx.chat.id, userId); g.bannedUsers.add(userId); g.warns.delete(userId); } catch { } await ctx.reply(`🚫 ${userName} — حظر تلقائي (${g.maxWarns} تحذيرات)`); }
      else { await ctx.reply(`⚠️ ${userName} — تحذير ${warns.length}/${g.maxWarns} (كلمة: "${found.word}")`); }
    } else if (found.action === 'mute') { try { await muteMember(bot, ctx.chat.id, userId); g.mutedUsers.add(userId); } catch { } await ctx.reply(`🔇 ${userName} — كُتم بسبب كلمة محظورة.`); }
    else if (found.action === 'kick') { try { await bot.telegram.banChatMember(ctx.chat.id, userId); setTimeout(() => bot.telegram.unbanChatMember(ctx.chat.id, userId).catch(() => { }), 2000); } catch { } await ctx.reply(`👢 ${userName} — طُرد بسبب كلمة محظورة.`); }
    else if (found.action === 'ban') { try { await bot.telegram.banChatMember(ctx.chat.id, userId); g.bannedUsers.add(userId); } catch { } await ctx.reply(`🚫 ${userName} — حُظر بسبب كلمة محظورة.`); }
    return next();
  });

  // عداد الرسائل
  bot.on('message', async (ctx, next) => {
    if (!ctx.chat || ctx.chat.type === 'private' || !ctx.from) return next();
    const g = db.getGroup(ctx.chat.id);
    if (g) { const m = g.members.get(ctx.from.id); if (m) m.messageCount = (m.messageCount || 0) + 1; }
    return next();
  });

  bot.action(/^group_home_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const g = db.getGroup(Number(ctx.match[1])); if (!g) return;
    await ctx.editMessageText(`🤖 *إدارة ${g.title}*\n\nاختر من القائمة:`, { parse_mode: 'Markdown', ...groupHomeKeyboard(g.chatId) });
  });

  bot.action(/^stats_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const g = db.getGroup(Number(ctx.match[1])); if (!g) return ctx.answerCbQuery('❌ بيانات غير موجودة!', { show_alert: true });
    const warns = [...g.warns.values()].reduce((a, w) => a + w.length, 0);
    const pending = [...g.joinRequests.values()].filter(r => r.status === 'pending').length;
    await ctx.reply(`📊 *إحصائيات ${g.title}*\n\n👥 الأعضاء: \`${g.members.size}\`\n👮 المشرفون: \`${g.admins.size}\`\n⚠️ التحذيرات: \`${warns}\`\n🔇 المكتومون: \`${g.mutedUsers.size}\`\n🚫 المحظورون: \`${g.bannedUsers.size}\`\n🔤 الكلمات: \`${g.bannedWords.length}\`\n📨 طلبات معلقة: \`${pending}\``, { parse_mode: 'Markdown' });
  });

  bot.action(/^admins_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId); if (!g) return ctx.answerCbQuery('❌ بيانات غير موجودة!', { show_alert: true });
    let text = `👮 *مشرفو ${g.title}*\n\n👑 المالك: \`${g.ownerUsername || 'غير محدد'}\`\n\n`;
    try {
      const list = await bot.telegram.getChatAdministrators(chatId);
      for (const a of list) { if (a.user.is_bot || a.status === 'creator') continue; const rec = g.admins.get(a.user.id); const name = a.user.username ? `@${a.user.username}` : a.user.first_name; text += `👮 ${name}${rec ? `\n   ↳ رُقِّيَ بواسطة: @${rec.promotedByUsername}` : ''}\n`; }
    } catch { text += '_تعذر جلب القائمة_'; }
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', `group_home_${chatId}`)]]) });
  });

  bot.action(/^rules_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const g = db.getGroup(Number(ctx.match[1]));
    const rulesText = g?.rules || '1️⃣ الاحترام المتبادل\n2️⃣ عدم الإعلانات\n3️⃣ عدم التحرش\n4️⃣ احترام الإدارة\n5️⃣ عدم المحتوى الضار';
    await ctx.reply(`📋 *قواعد المجموعة*\n\n${rulesText}`, { parse_mode: 'Markdown' });
  });

  bot.action(/^cancel(_-?\d+)?$/, async (ctx) => { await ctx.answerCbQuery('✅'); await ctx.deleteMessage().catch(() => { }); });
};
