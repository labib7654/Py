const { Markup } = require('telegraf');
const db         = require('./db');
const {
  isDeveloper, isAdmin,
  getTargetUser, getReason,
} = require('./helpers_permissions');
const {
  muteMember, muteMemberTimed, banMemberTimed,
  unmutePerms, promoteUser, demoteUser,
  logAction,
} = require('./helpers_actions');

function memberActionsKeyboard(targetId, chatId, backCb) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('⬆️ رفع مشرف',   `promote_${targetId}_${chatId}`),
      Markup.button.callback('⬇️ تنزيل مشرف', `demote_${targetId}_${chatId}`),
    ],
    [
      Markup.button.callback('🔇 كتم',         `mute_${targetId}_${chatId}`),
      Markup.button.callback('🔊 رفع كتم',     `unmute_${targetId}_${chatId}`),
    ],
    [
      Markup.button.callback('⏱️ كتم مؤقت',   `mutet_show_${targetId}_${chatId}`),
      Markup.button.callback('🚫⏱️ حظر مؤقت', `bant_show_${targetId}_${chatId}`),
    ],
    [
      Markup.button.callback('⚠️ تحذير',       `warn_${targetId}_${chatId}`),
      Markup.button.callback('🗑️ مسح تحذيرات',`clearwarns_${targetId}_${chatId}`),
    ],
    [
      Markup.button.callback('👢 طرد',         `kick_${targetId}_${chatId}`),
      Markup.button.callback('🚫 حظر',         `ban_${targetId}_${chatId}`),
    ],
    [
      Markup.button.callback('✅ رفع حظر',     `unban_${targetId}_${chatId}`),
      Markup.button.callback('📋 معلومات',     `info_${targetId}_${chatId}`),
    ],
    [Markup.button.callback('🔙 رجوع', backCb || 'cancel')],
  ]);
}

function muteDurationKeyboard(userId, chatId) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('5د',    `mutet_${userId}_${chatId}_300`),
      Markup.button.callback('30د',   `mutet_${userId}_${chatId}_1800`),
      Markup.button.callback('1س',    `mutet_${userId}_${chatId}_3600`),
    ],
    [
      Markup.button.callback('6س',    `mutet_${userId}_${chatId}_21600`),
      Markup.button.callback('24س',   `mutet_${userId}_${chatId}_86400`),
      Markup.button.callback('7أيام', `mutet_${userId}_${chatId}_604800`),
    ],
    [Markup.button.callback('🔙 إلغاء', `cancel`)],
  ]);
}

function banDurationKeyboard(userId, chatId) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('1س',    `bant_${userId}_${chatId}_3600`),
      Markup.button.callback('6س',    `bant_${userId}_${chatId}_21600`),
      Markup.button.callback('24س',   `bant_${userId}_${chatId}_86400`),
    ],
    [
      Markup.button.callback('3أيام', `bant_${userId}_${chatId}_259200`),
      Markup.button.callback('7أيام', `bant_${userId}_${chatId}_604800`),
      Markup.button.callback('30يوم', `bant_${userId}_${chatId}_2592000`),
    ],
    [Markup.button.callback('🔙 إلغاء', `cancel`)],
  ]);
}

module.exports = function setupAdminHandlers(bot) {

  // ── /admins ──────────────────────────────────────────────────────────────
  bot.command('admins', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const g = db.getGroup(ctx.chat.id);
    let text = `👮 *مشرفو ${ctx.chat.title}*\n\n`;
    try {
      const list = await bot.telegram.getChatAdministrators(ctx.chat.id);
      for (const a of list) {
        if (a.user.is_bot) continue;
        const rec  = g?.admins.get(a.user.id);
        const name = a.user.username ? `@${a.user.username}` : a.user.first_name;
        if (a.status === 'creator') {
          text += `👑 *المالك:* ${name}\n`;
          if (g) { g.ownerId = a.user.id; g.ownerUsername = a.user.username || a.user.first_name; }
        } else {
          text += `👮 *مشرف:* ${name}${rec ? `\n   ↳ رُقِّيَ بواسطة: @${rec.promotedByUsername}` : ''}\n`;
        }
      }
    } catch { text += '_تعذر جلب القائمة_'; }
    await ctx.replyWithMarkdown(text);
  });

  // ── /ban ─────────────────────────────────────────────────────────────────
  bot.command('ban', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return ctx.reply('❌ للمشرفين فقط!');
    const target = await getTargetUser(ctx); if (!target) return ctx.reply('❌ ارد على رسالة المستخدم أو اذكره!');
    const reason = getReason(ctx.message.text, 2);
    try {
      await bot.telegram.banChatMember(chatId, target.id);
      const g = db.getGroup(chatId);
      if (g) { g.bannedUsers.add(target.id); await logAction(bot, g, '🚫 حظر', ctx.from, target, reason); }
      await ctx.replyWithMarkdown(
        `🚫 *تم الحظر*\n👤 ${target.username ? `@${target.username}` : target.firstName}\n👮 @${ctx.from.username || ctx.from.first_name}\n📝 ${reason}`,
        Markup.inlineKeyboard([[Markup.button.callback('✅ رفع الحظر', `unban_${target.id}_${chatId}`)]])
      );
    } catch (e) { await ctx.reply(`❌ ${e.message}`); }
  });

  // ── /kick ────────────────────────────────────────────────────────────────
  bot.command('kick', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return ctx.reply('❌ للمشرفين فقط!');
    const target = await getTargetUser(ctx); if (!target) return ctx.reply('❌ ارد على رسالة المستخدم أو اذكره!');
    try {
      await bot.telegram.banChatMember(chatId, target.id);
      setTimeout(() => bot.telegram.unbanChatMember(chatId, target.id).catch(() => {}), 1500);
      const g = db.getGroup(chatId);
      if (g) await logAction(bot, g, '👢 طرد', ctx.from, target, '');
      await ctx.replyWithMarkdown(`👢 *تم الطرد*\n👤 ${target.username ? `@${target.username}` : target.firstName}`);
    } catch (e) { await ctx.reply(`❌ ${e.message}`); }
  });

  // ── /mute ────────────────────────────────────────────────────────────────
  bot.command('mute', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return ctx.reply('❌ للمشرفين فقط!');
    const target = await getTargetUser(ctx); if (!target) return ctx.reply('❌ ارد على رسالة المستخدم أو اذكره!');
    try {
      await muteMember(bot, chatId, target.id);
      const g = db.getGroup(chatId);
      if (g) { g.mutedUsers.add(target.id); await logAction(bot, g, '🔇 كتم', ctx.from, target, ''); }
      await ctx.replyWithMarkdown(
        `🔇 *تم الكتم*\n👤 ${target.username ? `@${target.username}` : target.firstName}`,
        Markup.inlineKeyboard([[Markup.button.callback('🔊 رفع الكتم', `unmute_${target.id}_${chatId}`)]])
      );
    } catch (e) { await ctx.reply(`❌ ${e.message}`); }
  });

  // ── /unmute ──────────────────────────────────────────────────────────────
  bot.command('unmute', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return ctx.reply('❌ للمشرفين فقط!');
    const target = await getTargetUser(ctx); if (!target) return ctx.reply('❌ ارد على رسالة المستخدم أو اذكره!');
    try {
      const perms = await unmutePerms();
      await bot.telegram.restrictChatMember(chatId, target.id, { permissions: perms });
      const g = db.getGroup(chatId);
      if (g) { g.mutedUsers.delete(target.id); await logAction(bot, g, '🔊 رفع كتم', ctx.from, target, ''); }
      await ctx.replyWithMarkdown(`🔊 *تم رفع الكتم*\n👤 ${target.username ? `@${target.username}` : target.firstName}`);
    } catch (e) { await ctx.reply(`❌ ${e.message}`); }
  });

  // ── /warn ────────────────────────────────────────────────────────────────
  bot.command('warn', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return ctx.reply('❌ للمشرفين فقط!');
    const target = await getTargetUser(ctx); if (!target) return ctx.reply('❌ ارد على رسالة المستخدم أو اذكره!');
    const reason = getReason(ctx.message.text, 2);
    const g = db.getGroup(chatId); if (!g) return;
    if (!g.warns.has(target.id)) g.warns.set(target.id, []);
    const warns = g.warns.get(target.id);
    warns.push({ reason, warnedBy: ctx.from.id, warnedAt: new Date() });
    await logAction(bot, g, `⚠️ تحذير ${warns.length}/${g.maxWarns}`, ctx.from, target, reason);
    if (warns.length >= g.maxWarns) {
      try { await bot.telegram.banChatMember(chatId, target.id); g.bannedUsers.add(target.id); g.warns.delete(target.id); } catch {}
      await ctx.replyWithMarkdown(`🚫 *حظر تلقائي*\n👤 ${target.username ? `@${target.username}` : target.firstName}\n📝 ${reason}`);
    } else {
      await ctx.replyWithMarkdown(
        `⚠️ *تحذير ${warns.length}/${g.maxWarns}*\n👤 ${target.username ? `@${target.username}` : target.firstName}\n📝 ${reason}`,
        Markup.inlineKeyboard([[Markup.button.callback('🗑️ حذف التحذيرات', `clearwarns_${target.id}_${chatId}`)]])
      );
    }
  });

  // ── /warns ───────────────────────────────────────────────────────────────
  bot.command('warns', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const target = await getTargetUser(ctx); if (!target) return ctx.reply('❌ ارد على رسالة المستخدم أو اذكره!');
    const g = db.getGroup(ctx.chat.id);
    const warns = g?.warns.get(target.id) || [];
    if (!warns.length) return ctx.replyWithMarkdown(`✅ ${target.username ? `@${target.username}` : target.firstName} لا يملك تحذيرات.`);
    let text = `⚠️ *تحذيرات ${target.username ? `@${target.username}` : target.firstName}*\n\n`;
    warns.forEach((w, i) => { text += `${i + 1}. ${w.reason}\n`; });
    text += `\nالإجمالي: ${warns.length}/${g?.maxWarns || 3}`;
    await ctx.replyWithMarkdown(text, Markup.inlineKeyboard([[Markup.button.callback('🗑️ حذف التحذيرات', `clearwarns_${target.id}_${ctx.chat.id}`)]]));
  });

  // ── /manage ──────────────────────────────────────────────────────────────
  bot.command('manage', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return ctx.reply('❌ للمشرفين فقط!');
    const target = await getTargetUser(ctx); if (!target) return ctx.reply('❌ ارد على رسالة المستخدم للإدارة!');
    db.trackMember(chatId, target.id, target.username, target.firstName, 'member');
    const g  = db.getGroup(chatId);
    const warns = g?.warns.get(target.id)?.length || 0;
    await ctx.replyWithMarkdown(
      `👤 *إدارة المستخدم*\n\nالاسم: ${target.firstName || '—'}\n@${target.username || '—'}\nالآيدي: \`${target.id}\`\nالتحذيرات: \`${warns}/${g?.maxWarns || 3}\``,
      memberActionsKeyboard(target.id, chatId, 'cancel')
    );
  });

  // ════════════════════════════════════════════════════════════════════════
  //  أزرار الإجراءات (callbacks)
  // ════════════════════════════════════════════════════════════════════════

  bot.action(/^promote_(\d+)_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const [uid, cid] = [Number(ctx.match[1]), Number(ctx.match[2])];
    if (!isDeveloper(ctx) && !await isAdmin(bot, cid, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    try {
      await promoteUser(bot, cid, uid);
      const g = db.getGroup(cid);
      const m = g?.members.get(uid);
      if (g) g.admins.set(uid, { username: m?.username || String(uid), promotedBy: ctx.from.id, promotedByUsername: ctx.from.username || ctx.from.first_name, promotedAt: new Date() });
      await ctx.answerCbQuery('✅ تم الترقية!', { show_alert: true });
    } catch (e) { await ctx.answerCbQuery(`❌ ${e.message}`, { show_alert: true }); }
  });

  bot.action(/^demote_(\d+)_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const [uid, cid] = [Number(ctx.match[1]), Number(ctx.match[2])];
    if (!isDeveloper(ctx) && !await isAdmin(bot, cid, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    try {
      await demoteUser(bot, cid, uid);
      const g = db.getGroup(cid);
      if (g) g.admins.delete(uid);
      await ctx.answerCbQuery('✅ تم التنزيل!', { show_alert: true });
    } catch (e) { await ctx.answerCbQuery(`❌ ${e.message}`, { show_alert: true }); }
  });

  bot.action(/^mute_(\d+)_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const [uid, cid] = [Number(ctx.match[1]), Number(ctx.match[2])];
    if (!isDeveloper(ctx) && !await isAdmin(bot, cid, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    try {
      await muteMember(bot, cid, uid);
      const g = db.getGroup(cid);
      if (g) g.mutedUsers.add(uid);
      await ctx.answerCbQuery('🔇 تم الكتم!', { show_alert: true });
    } catch (e) { await ctx.answerCbQuery(`❌ ${e.message}`, { show_alert: true }); }
  });

  bot.action(/^unmute_(\d+)_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const [uid, cid] = [Number(ctx.match[1]), Number(ctx.match[2])];
    if (!isDeveloper(ctx) && !await isAdmin(bot, cid, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    try {
      const perms = await unmutePerms();
      await bot.telegram.restrictChatMember(cid, uid, { permissions: perms });
      const g = db.getGroup(cid);
      if (g) g.mutedUsers.delete(uid);
      await ctx.answerCbQuery('🔊 تم رفع الكتم!', { show_alert: true });
    } catch (e) { await ctx.answerCbQuery(`❌ ${e.message}`, { show_alert: true }); }
  });

  bot.action(/^mutet_show_(\d+)_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const [uid, cid] = [Number(ctx.match[1]), Number(ctx.match[2])];
    await ctx.editMessageText('⏱️ اختر مدة الكتم المؤقت:', muteDurationKeyboard(uid, cid));
  });

  bot.action(/^mutet_(\d+)_(-?\d+)_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const [uid, cid, dur] = [Number(ctx.match[1]), Number(ctx.match[2]), Number(ctx.match[3])];
    if (!isDeveloper(ctx) && !await isAdmin(bot, cid, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    try {
      await muteMemberTimed(bot, cid, uid, dur);
      const g = db.getGroup(cid);
      if (g) {
        g.mutedUsers.add(uid);
        g.timedMutes.set(uid, Date.now() + dur * 1000);
      }
      const mins = dur < 3600 ? `${dur / 60} دقيقة` : dur < 86400 ? `${dur / 3600} ساعة` : `${dur / 86400} يوم`;
      await ctx.editMessageText(`🔇 تم الكتم المؤقت لمدة ${mins}`);
    } catch (e) { await ctx.answerCbQuery(`❌ ${e.message}`, { show_alert: true }); }
  });

  bot.action(/^bant_show_(\d+)_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const [uid, cid] = [Number(ctx.match[1]), Number(ctx.match[2])];
    await ctx.editMessageText('🚫⏱️ اختر مدة الحظر المؤقت:', banDurationKeyboard(uid, cid));
  });

  bot.action(/^bant_(\d+)_(-?\d+)_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const [uid, cid, dur] = [Number(ctx.match[1]), Number(ctx.match[2]), Number(ctx.match[3])];
    if (!isDeveloper(ctx) && !await isAdmin(bot, cid, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    try {
      await banMemberTimed(bot, cid, uid, dur);
      const g = db.getGroup(cid);
      if (g) {
        g.bannedUsers.add(uid);
        g.timedBans.set(uid, Date.now() + dur * 1000);
      }
      const mins = dur < 3600 ? `${dur / 60} دقيقة` : dur < 86400 ? `${dur / 3600} ساعة` : `${dur / 86400} يوم`;
      await ctx.editMessageText(`🚫 تم الحظر المؤقت لمدة ${mins}`);
    } catch (e) { await ctx.answerCbQuery(`❌ ${e.message}`, { show_alert: true }); }
  });

  bot.action(/^warn_(\d+)_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const [uid, cid] = [Number(ctx.match[1]), Number(ctx.match[2])];
    if (!isDeveloper(ctx) && !await isAdmin(bot, cid, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const g = db.getGroup(cid); if (!g) return;
    if (!g.warns.has(uid)) g.warns.set(uid, []);
    const warns = g.warns.get(uid);
    warns.push({ reason: 'تحذير من الإدارة', warnedBy: ctx.from.id, warnedAt: new Date() });
    if (warns.length >= g.maxWarns) {
      try { await bot.telegram.banChatMember(cid, uid); g.bannedUsers.add(uid); g.warns.delete(uid); } catch {}
      await ctx.answerCbQuery(`🚫 حظر تلقائي بعد ${g.maxWarns} تحذيرات!`, { show_alert: true });
    } else {
      await ctx.answerCbQuery(`⚠️ تحذير ${warns.length}/${g.maxWarns}`, { show_alert: true });
    }
  });

  bot.action(/^clearwarns_(\d+)_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const [uid, cid] = [Number(ctx.match[1]), Number(ctx.match[2])];
    if (!isDeveloper(ctx) && !await isAdmin(bot, cid, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const g = db.getGroup(cid);
    if (g) g.warns.delete(uid);
    await ctx.answerCbQuery('✅ تم مسح التحذيرات!', { show_alert: true });
  });

  bot.action(/^ban_(\d+)_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const [uid, cid] = [Number(ctx.match[1]), Number(ctx.match[2])];
    if (!isDeveloper(ctx) && !await isAdmin(bot, cid, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    try {
      await bot.telegram.banChatMember(cid, uid);
      const g = db.getGroup(cid);
      if (g) { g.bannedUsers.add(uid); await logAction(bot, g, '🚫 حظر', ctx.from, { id: uid, username: '', firstName: String(uid) }, 'عبر الزر'); }
      await ctx.answerCbQuery('🚫 تم الحظر!', { show_alert: true });
    } catch (e) { await ctx.answerCbQuery(`❌ ${e.message}`, { show_alert: true }); }
  });

  bot.action(/^unban_(\d+)_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const [uid, cid] = [Number(ctx.match[1]), Number(ctx.match[2])];
    if (!isDeveloper(ctx) && !await isAdmin(bot, cid, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    try {
      await bot.telegram.unbanChatMember(cid, uid);
      const g = db.getGroup(cid);
      if (g) { g.bannedUsers.delete(uid); g.timedBans.delete(uid); }
      await ctx.answerCbQuery('✅ تم رفع الحظر!', { show_alert: true });
    } catch (e) { await ctx.answerCbQuery(`❌ ${e.message}`, { show_alert: true }); }
  });

  bot.action(/^kick_(\d+)_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const [uid, cid] = [Number(ctx.match[1]), Number(ctx.match[2])];
    if (!isDeveloper(ctx) && !await isAdmin(bot, cid, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    try {
      await bot.telegram.banChatMember(cid, uid);
      setTimeout(() => bot.telegram.unbanChatMember(cid, uid).catch(() => {}), 1500);
      await ctx.answerCbQuery('👢 تم الطرد!', { show_alert: true });
    } catch (e) { await ctx.answerCbQuery(`❌ ${e.message}`, { show_alert: true }); }
  });

  bot.action(/^info_(\d+)_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const [uid, cid] = [Number(ctx.match[1]), Number(ctx.match[2])];
    const g   = db.getGroup(cid);
    const m   = g?.members.get(uid);
    const gu  = db.getUser(uid);
    const warns = g?.warns.get(uid)?.length || 0;
    await ctx.reply(
      `📋 *معلومات المستخدم*\n\n🆔 \`${uid}\`\n👤 ${m?.firstName || '—'}\n@${m?.username || '—'}\n⚠️ تحذيرات: \`${warns}/${g?.maxWarns || 3}\`\n🔇 مكتوم: ${g?.mutedUsers.has(uid) ? '✅' : '❌'}\n🚫 محظور محلياً: ${g?.bannedUsers.has(uid) ? '✅' : '❌'}\n🌍 محظور عالمياً: ${gu?.globalBanned ? `✅ — ${gu.bannedReason}` : '❌'}\n💬 رسائل: \`${m?.messageCount || 0}\`\n⭐ نقاط: \`${m?.score || 0}\``,
      { parse_mode: 'Markdown' }
    );
  });

  // ── /jr_ban — حظر من طلب الانضمام (FEATURE 7) ───────────────────────────
  bot.action(/^jr_ban_(\d+)_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const [uid, cid] = [Number(ctx.match[1]), Number(ctx.match[2])];
    if (!isDeveloper(ctx) && !await isAdmin(bot, cid, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    try {
      await bot.telegram.declineChatJoinRequest(cid, uid).catch(() => {});
      await bot.telegram.banChatMember(cid, uid);
      const g = db.getGroup(cid);
      if (g) {
        g.bannedUsers.add(uid);
        if (g.joinRequests.has(uid)) g.joinRequests.get(uid).status = 'banned';
      }
      await ctx.answerCbQuery('🚫 تم الحظر!', { show_alert: true });
      await ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n🚫 *تم الحظر*', { parse_mode: 'Markdown' });
    } catch (e) { await ctx.answerCbQuery(`❌ ${e.message}`, { show_alert: true }); }
  });

};
