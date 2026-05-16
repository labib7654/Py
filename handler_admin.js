// handler_admin.js — أوامر الإدارة — جامعة v5.0
const { Markup } = require('telegraf');
const db         = require('./db');
const supa       = require('./supabase');
const {
  isDeveloper, isAdmin, isOwner,
  getTargetUser, getReason,
  muteMember, muteMemberTimed, banMemberTimed,
  unmutePerms, promoteUser, demoteUser,
  logAction,
} = require('./helpers');

function memberActionsKeyboard(targetId, chatId, backCb) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('⬆️ رفع مشرف',    `promote_${targetId}_${chatId}`),
      Markup.button.callback('⬇️ تنزيل مشرف', `demote_${targetId}_${chatId}`),
    ],
    [
      Markup.button.callback('🔇 كتم',          `mute_${targetId}_${chatId}`),
      Markup.button.callback('🔊 رفع كتم',      `unmute_${targetId}_${chatId}`),
    ],
    [
      Markup.button.callback('⏱️ كتم مؤقت',    `mutet_show_${targetId}_${chatId}`),
      Markup.button.callback('🚫⏱️ حظر مؤقت', `bant_show_${targetId}_${chatId}`),
    ],
    [
      Markup.button.callback('⚠️ تحذير',        `warn_${targetId}_${chatId}`),
      Markup.button.callback('🗑️ مسح تحذيرات', `clearwarns_${targetId}_${chatId}`),
    ],
    [
      Markup.button.callback('👢 طرد',          `kick_${targetId}_${chatId}`),
      Markup.button.callback('🚫 حظر',          `ban_${targetId}_${chatId}`),
    ],
    [
      Markup.button.callback('✅ رفع حظر',      `unban_${targetId}_${chatId}`),
      Markup.button.callback('📋 معلومات',      `info_${targetId}_${chatId}`),
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
    [Markup.button.callback('🔙 إلغاء', 'cancel')],
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
    [Markup.button.callback('🔙 إلغاء', 'cancel')],
  ]);
}

module.exports = function setupAdminHandlers(bot) {

  // ── /admins ──────────────────────────────────────────────────────────────
  bot.command('admins', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const g = await db.getGroup(ctx.chat.id);
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
      const g = await db.getGroup(chatId);
      if (g) { g.bannedUsers.add(target.id); await logAction(bot, g, '🚫 حظر', ctx.from, target, reason); }
      await supa.setGlobalBan(target.id, false, ''); // تسجيل في قاعدة البيانات
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
      const g = await db.getGroup(chatId);
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
      const g = await db.getGroup(chatId);
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
      const g = await db.getGroup(chatId);
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
    const g = await db.getGroup(chatId); if (!g) return;
    if (!g.warns.has(target.id)) g.warns.set(target.id, []);
    const warns = g.warns.get(target.id);
    warns.push({ reason, warnedBy: ctx.from.id, warnedAt: new Date() });
    // حفظ في Supabase
    await supa.addWarn(chatId, target.id, reason, ctx.from.id);
    await logAction(bot, g, `⚠️ تحذير ${warns.length}/${g.maxWarns}`, ctx.from, target, reason);
    if (warns.length >= g.maxWarns) {
      try { await bot.telegram.banChatMember(chatId, target.id); g.bannedUsers.add(target.id); g.warns.delete(target.id); } catch {}
      await supa.clearWarns(chatId, target.id);
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
    const g      = await db.getGroup(ctx.chat.id);
    const warns  = g?.warns.get(target.id) || await supa.getWarns(ctx.chat.id, target.id);
    if (!warns.length) return ctx.replyWithMarkdown(`✅ ${target.username ? `@${target.username}` : target.firstName} لا يملك تحذيرات.`);
    let text = `⚠️ *تحذيرات ${target.username ? `@${target.username}` : target.firstName}*\n\n`;
    warns.forEach((w, i) => { text += `${i + 1}. ${w.reason || w}\n`; });
    text += `\nالإجمالي: ${warns.length}/${g?.maxWarns || 3}`;
    await ctx.replyWithMarkdown(text, Markup.inlineKeyboard([[Markup.button.callback('🗑️ حذف التحذيرات', `clearwarns_${target.id}_${ctx.chat.id}`)]]));
  });

  // ── /manage ──────────────────────────────────────────────────────────────
  bot.command('manage', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return ctx.reply('❌ للمشرفين فقط!');
    const target = await getTargetUser(ctx); if (!target) return ctx.reply('❌ ارد على رسالة المستخدم للإدارة!');
    await db.trackMember(chatId, target.id, target.username, target.firstName, 'member');
    const g      = await db.getGroup(chatId);
    const warns  = g?.warns.get(target.id)?.length || (await supa.getWarnCount(chatId, target.id));
    await ctx.replyWithMarkdown(
      `👤 *إدارة المستخدم*\n\nالاسم: ${target.firstName || '—'}\n@${target.username || '—'}\nالآيدي: \`${target.id}\`\nالتحذيرات: \`${warns}/${g?.maxWarns || 3}\``,
      memberActionsKeyboard(target.id, chatId, 'cancel')
    );
  });

  // ── /report ──────────────────────────────────────────────────────────────
  bot.command('report', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId  = ctx.chat.id;
    const target  = await getTargetUser(ctx);
    const reason  = getReason(ctx.message.text, target ? 2 : 1);
    const msgId   = ctx.message.reply_to_message?.message_id || null;
    if (!target) return ctx.reply('❌ ارد على رسالة الشخص الذي تريد الإبلاغ عنه!');
    const report = await supa.addReport(chatId, ctx.from.id, target.id, msgId, reason);
    const g      = await db.getGroup(chatId);
    const notifyIds = new Set([g?.ownerId, ...(g?.admins ? g.admins.keys() : [])].filter(Boolean));
    const msg =
      `⚠️ *بلاغ جديد*\n\n` +
      `👤 المُبلِّغ: ${ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name}\n` +
      `🎯 المُبلَّغ عنه: ${target.username ? `@${target.username}` : target.firstName} \`[${target.id}]\`\n` +
      `📝 السبب: ${reason}\n` +
      `📌 المجموعة: *${ctx.chat.title}*`;
    for (const adminId of notifyIds) {
      try {
        await bot.telegram.sendMessage(adminId, msg, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([[
            Markup.button.callback(`🚫 حظر ${target.firstName?.slice(0,10)}`, `ban_${target.id}_${chatId}`),
            Markup.button.callback('⚠️ تحذير', `warn_${target.id}_${chatId}`),
          ]]),
        });
      } catch {}
    }
    await ctx.reply('✅ تم إرسال البلاغ للمشرفين.', { reply_to_message_id: ctx.message.message_id });
  });

  // ════════════════════════════════════════════════════════════════════════
  //  أزرار الإجراءات (callbacks)
  // ════════════════════════════════════════════════════════════════════════

  // رفع مشرف
  bot.action(/^promote_(\d+)_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const [uid, cid] = [Number(ctx.match[1]), Number(ctx.match[2])];
    if (!isDeveloper(ctx) && !await isAdmin(bot, cid, ctx.from.id)) return ctx.answerCbQuery('❌ ممنوع', { show_alert: true });
    const ok = await promoteUser(bot, cid, uid);
    const g  = await db.getGroup(cid);
    if (ok && g) {
      g.admins.set(uid, { username: '', promotedBy: ctx.from.id, promotedByUsername: ctx.from.username || ctx.from.first_name, promotedAt: new Date() });
      await db.trackMember(cid, uid, '', '', 'admin');
    }
    await ctx.answerCbQuery(ok ? '✅ تم رفع مشرف!' : '❌ فشل', { show_alert: true });
  });

  // تنزيل مشرف
  bot.action(/^demote_(\d+)_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const [uid, cid] = [Number(ctx.match[1]), Number(ctx.match[2])];
    if (!isDeveloper(ctx) && !await isAdmin(bot, cid, ctx.from.id)) return ctx.answerCbQuery('❌ ممنوع', { show_alert: true });
    const ok = await demoteUser(bot, cid, uid);
    const g  = await db.getGroup(cid);
    if (ok && g) { g.admins.delete(uid); await db.trackMember(cid, uid, '', '', 'member'); }
    await ctx.answerCbQuery(ok ? '✅ تم تنزيل مشرف!' : '❌ فشل', { show_alert: true });
  });

  // كتم (زر)
  bot.action(/^mute_(\d+)_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const [uid, cid] = [Number(ctx.match[1]), Number(ctx.match[2])];
    if (!isDeveloper(ctx) && !await isAdmin(bot, cid, ctx.from.id)) return ctx.answerCbQuery('❌ ممنوع', { show_alert: true });
    try {
      await muteMember(bot, cid, uid);
      const g = await db.getGroup(cid); if (g) g.mutedUsers.add(uid);
      await ctx.answerCbQuery('🔇 تم الكتم!', { show_alert: true });
    } catch (e) { await ctx.answerCbQuery(`❌ ${e.message}`, { show_alert: true }); }
  });

  // رفع كتم (زر)
  bot.action(/^unmute_(\d+)_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const [uid, cid] = [Number(ctx.match[1]), Number(ctx.match[2])];
    if (!isDeveloper(ctx) && !await isAdmin(bot, cid, ctx.from.id)) return ctx.answerCbQuery('❌ ممنوع', { show_alert: true });
    try {
      const perms = await unmutePerms();
      await bot.telegram.restrictChatMember(cid, uid, { permissions: perms });
      const g = await db.getGroup(cid); if (g) g.mutedUsers.delete(uid);
      await supa.removeRestriction(cid, uid, 'timed_mute');
      await ctx.answerCbQuery('🔊 تم رفع الكتم!', { show_alert: true });
    } catch (e) { await ctx.answerCbQuery(`❌ ${e.message}`, { show_alert: true }); }
  });

  // كتم مؤقت — عرض الأزرار
  bot.action(/^mutet_show_(\d+)_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const [uid, cid] = [Number(ctx.match[1]), Number(ctx.match[2])];
    if (!isDeveloper(ctx) && !await isAdmin(bot, cid, ctx.from.id)) return ctx.answerCbQuery('❌ ممنوع', { show_alert: true });
    await ctx.editMessageReplyMarkup(muteDurationKeyboard(uid, cid).reply_markup);
  });

  // كتم مؤقت — تنفيذ
  bot.action(/^mutet_(\d+)_(-?\d+)_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const [uid, cid, dur] = [Number(ctx.match[1]), Number(ctx.match[2]), Number(ctx.match[3])];
    if (!isDeveloper(ctx) && !await isAdmin(bot, cid, ctx.from.id)) return ctx.answerCbQuery('❌ ممنوع', { show_alert: true });
    try {
      await muteMemberTimed(bot, cid, uid, dur);
      const g = await db.getGroup(cid);
      if (g) {
        g.mutedUsers.add(uid);
        g.timedMutes.set(uid, { until: Date.now() + dur * 1000, by: ctx.from.id });
      }
      const label = dur < 3600 ? `${dur/60}د` : dur < 86400 ? `${dur/3600}س` : `${dur/86400}أيام`;
      await ctx.answerCbQuery(`🔇 كتم مؤقت لمدة ${label}!`, { show_alert: true });
    } catch (e) { await ctx.answerCbQuery(`❌ ${e.message}`, { show_alert: true }); }
  });

  // حظر مؤقت — عرض الأزرار
  bot.action(/^bant_show_(\d+)_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const [uid, cid] = [Number(ctx.match[1]), Number(ctx.match[2])];
    if (!isDeveloper(ctx) && !await isAdmin(bot, cid, ctx.from.id)) return ctx.answerCbQuery('❌ ممنوع', { show_alert: true });
    await ctx.editMessageReplyMarkup(banDurationKeyboard(uid, cid).reply_markup);
  });

  // حظر مؤقت — تنفيذ
  bot.action(/^bant_(\d+)_(-?\d+)_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const [uid, cid, dur] = [Number(ctx.match[1]), Number(ctx.match[2]), Number(ctx.match[3])];
    if (!isDeveloper(ctx) && !await isAdmin(bot, cid, ctx.from.id)) return ctx.answerCbQuery('❌ ممنوع', { show_alert: true });
    try {
      await banMemberTimed(bot, cid, uid, dur);
      const g = await db.getGroup(cid);
      if (g) g.timedBans.set(uid, { until: Date.now() + dur * 1000, by: ctx.from.id });
      const label = dur < 3600 ? `${dur/60}د` : dur < 86400 ? `${dur/3600}س` : `${dur/86400}أيام`;
      await ctx.answerCbQuery(`🚫 حظر مؤقت لمدة ${label}!`, { show_alert: true });
    } catch (e) { await ctx.answerCbQuery(`❌ ${e.message}`, { show_alert: true }); }
  });

  // تحذير (زر)
  bot.action(/^warn_(\d+)_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const [uid, cid] = [Number(ctx.match[1]), Number(ctx.match[2])];
    if (!isDeveloper(ctx) && !await isAdmin(bot, cid, ctx.from.id)) return ctx.answerCbQuery('❌ ممنوع', { show_alert: true });
    const g = await db.getGroup(cid); if (!g) return;
    if (!g.warns.has(uid)) g.warns.set(uid, []);
    const warns = g.warns.get(uid);
    warns.push({ reason: 'تحذير يدوي', warnedBy: ctx.from.id, warnedAt: new Date() });
    await supa.addWarn(cid, uid, 'تحذير يدوي', ctx.from.id);
    if (warns.length >= g.maxWarns) {
      try { await bot.telegram.banChatMember(cid, uid); g.bannedUsers.add(uid); g.warns.delete(uid); } catch {}
      await supa.clearWarns(cid, uid);
      await ctx.answerCbQuery('🚫 حظر تلقائي بعد التحذيرات!', { show_alert: true });
    } else {
      await ctx.answerCbQuery(`⚠️ تحذير ${warns.length}/${g.maxWarns}`, { show_alert: true });
    }
  });

  // مسح التحذيرات (زر)
  bot.action(/^clearwarns_(\d+)_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const [uid, cid] = [Number(ctx.match[1]), Number(ctx.match[2])];
    if (!isDeveloper(ctx) && !await isAdmin(bot, cid, ctx.from.id)) return ctx.answerCbQuery('❌ ممنوع', { show_alert: true });
    const g = await db.getGroup(cid); if (!g) return;
    g.warns.delete(uid);
    await supa.clearWarns(cid, uid);
    await ctx.answerCbQuery('✅ تم مسح التحذيرات!', { show_alert: true });
  });

  // طرد (زر)
  bot.action(/^kick_(\d+)_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const [uid, cid] = [Number(ctx.match[1]), Number(ctx.match[2])];
    if (!isDeveloper(ctx) && !await isAdmin(bot, cid, ctx.from.id)) return ctx.answerCbQuery('❌ ممنوع', { show_alert: true });
    try {
      await bot.telegram.banChatMember(cid, uid);
      setTimeout(() => bot.telegram.unbanChatMember(cid, uid).catch(() => {}), 1500);
      await ctx.answerCbQuery('👢 تم الطرد!', { show_alert: true });
    } catch (e) { await ctx.answerCbQuery(`❌ ${e.message}`, { show_alert: true }); }
  });

  // حظر (زر)
  bot.action(/^ban_(\d+)_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const [uid, cid] = [Number(ctx.match[1]), Number(ctx.match[2])];
    if (!isDeveloper(ctx) && !await isAdmin(bot, cid, ctx.from.id)) return ctx.answerCbQuery('❌ ممنوع', { show_alert: true });
    try {
      await bot.telegram.banChatMember(cid, uid);
      const g = await db.getGroup(cid); if (g) g.bannedUsers.add(uid);
      await ctx.answerCbQuery('🚫 تم الحظر!', { show_alert: true });
    } catch (e) { await ctx.answerCbQuery(`❌ ${e.message}`, { show_alert: true }); }
  });

  // رفع الحظر (زر)
  bot.action(/^unban_(\d+)_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const [uid, cid] = [Number(ctx.match[1]), Number(ctx.match[2])];
    if (!isDeveloper(ctx) && !await isAdmin(bot, cid, ctx.from.id)) return ctx.answerCbQuery('❌ ممنوع', { show_alert: true });
    try {
      await bot.telegram.unbanChatMember(cid, uid);
      const g = await db.getGroup(cid); if (g) g.bannedUsers.delete(uid);
      await supa.removeRestriction(cid, uid, 'timed_ban');
      await ctx.answerCbQuery('✅ تم رفع الحظر!', { show_alert: true });
    } catch (e) { await ctx.answerCbQuery(`❌ ${e.message}`, { show_alert: true }); }
  });

  // معلومات (زر)
  bot.action(/^info_(\d+)_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const [uid, cid] = [Number(ctx.match[1]), Number(ctx.match[2])];
    const g      = await db.getGroup(cid);
    const m      = g?.members.get(uid);
    const gu     = db.getUser(uid) || await supa.getUser(uid);
    const warns  = g?.warns.get(uid)?.length || await supa.getWarnCount(cid, uid);
    const text =
      `📋 *معلومات المستخدم*\n\n` +
      `👤 الاسم: ${m?.firstName || gu?.first_name || uid}\n` +
      `🔗 المعرف: ${m?.username ? `@${m.username}` : '—'}\n` +
      `🆔 الآيدي: \`${uid}\`\n` +
      `💬 الرسائل: \`${m?.messageCount || 0}\`\n` +
      `⭐ النقاط: \`${m?.score || 0}\`\n` +
      `⚠️ التحذيرات: \`${warns}/${g?.maxWarns || 3}\`\n` +
      `🔇 مكتوم: ${g?.mutedUsers.has(uid) ? '✅ نعم' : '❌ لا'}\n` +
      `🚫 محظور: ${g?.bannedUsers.has(uid) ? '✅ نعم' : '❌ لا'}\n` +
      `🌐 حظر عالمي: ${gu?.globalBanned || gu?.global_banned ? '🚫 نعم' : '✅ لا'}`;
    try {
      await bot.telegram.sendMessage(ctx.from.id, text, { parse_mode: 'Markdown' });
      await ctx.answerCbQuery('📋 تم الإرسال في الخاص', { show_alert: true });
    } catch { await ctx.answerCbQuery('ℹ️ افتح محادثة مع البوت أولاً', { show_alert: true }); }
  });

  // إلغاء
  bot.action('cancel', async (ctx) => {
    await ctx.answerCbQuery();
    try { await ctx.deleteMessage(); } catch {}
  });

  // /unban أمر نصي
  bot.command('unban', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return ctx.reply('❌ للمشرفين فقط!');
    const target = await getTargetUser(ctx); if (!target) return ctx.reply('❌ ارد على رسالة المستخدم أو اذكره!');
    try {
      await bot.telegram.unbanChatMember(chatId, target.id);
      const g = await db.getGroup(chatId); if (g) g.bannedUsers.delete(target.id);
      await supa.removeRestriction(chatId, target.id, 'timed_ban');
      await ctx.replyWithMarkdown(`✅ *تم رفع الحظر*\n👤 ${target.username ? `@${target.username}` : target.firstName}`);
    } catch (e) { await ctx.reply(`❌ ${e.message}`); }
  });

  // /promote أمر نصي
  bot.command('promote', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return ctx.reply('❌ للمشرفين فقط!');
    const target = await getTargetUser(ctx); if (!target) return ctx.reply('❌ ارد على رسالة المستخدم أو اذكره!');
    const ok = await promoteUser(bot, chatId, target.id);
    const g  = await db.getGroup(chatId);
    if (ok && g) {
      g.admins.set(target.id, { username: target.username || '', promotedBy: ctx.from.id, promotedByUsername: ctx.from.username || ctx.from.first_name, promotedAt: new Date() });
      await db.trackMember(chatId, target.id, target.username, target.firstName, 'admin');
    }
    await ctx.replyWithMarkdown(ok ? `✅ *تم رفع مشرف*\n👤 ${target.username ? `@${target.username}` : target.firstName}` : '❌ فشل الترقية!');
  });

  // /demote أمر نصي
  bot.command('demote', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return ctx.reply('❌ للمشرفين فقط!');
    const target = await getTargetUser(ctx); if (!target) return ctx.reply('❌ ارد على رسالة المستخدم أو اذكره!');
    const ok = await demoteUser(bot, chatId, target.id);
    const g  = await db.getGroup(chatId);
    if (ok && g) { g.admins.delete(target.id); await db.trackMember(chatId, target.id, target.username, target.firstName, 'member'); }
    await ctx.replyWithMarkdown(ok ? `✅ *تم تنزيل مشرف*\n👤 ${target.username ? `@${target.username}` : target.firstName}` : '❌ فشل التنزيل!');
  });

  // /slowmode
  bot.command('slowmode', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return ctx.reply('❌ للمشرفين فقط!');
    const sec = Number(ctx.message.text.split(' ')[1]) || 0;
    if (sec < 0 || sec > 900) return ctx.reply('❌ القيمة بين 0 و 900 ثانية (0 = إيقاف)');
    try {
      await bot.telegram.callApi('setChatSlowModeDelay', { chat_id: chatId, seconds: sec });
      const g = await db.getGroup(chatId); if (g) { g.slowMode = sec; db.scheduleSync(g); }
      await ctx.replyWithMarkdown(sec === 0 ? '✅ *تم إيقاف الوضع البطيء*' : `✅ *الوضع البطيء: \`${sec}\` ثانية*`);
    } catch (e) { await ctx.reply(`❌ ${e.message}`); }
  });

  // /pin
  bot.command('pin', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, ctx.chat.id, ctx.from.id)) return ctx.reply('❌ للمشرفين فقط!');
    if (!ctx.message.reply_to_message) return ctx.reply('❌ ارد على الرسالة التي تريد تثبيتها!');
    try {
      await bot.telegram.pinChatMessage(ctx.chat.id, ctx.message.reply_to_message.message_id, { disable_notification: true });
      await ctx.reply('📌 تم تثبيت الرسالة.', { reply_to_message_id: ctx.message.reply_to_message.message_id });
    } catch (e) { await ctx.reply(`❌ ${e.message}`); }
  });

  // /unpin
  bot.command('unpin', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, ctx.chat.id, ctx.from.id)) return ctx.reply('❌ للمشرفين فقط!');
    try {
      if (ctx.message.reply_to_message) {
        await bot.telegram.unpinChatMessage(ctx.chat.id, { message_id: ctx.message.reply_to_message.message_id });
      } else {
        await bot.telegram.unpinChatMessage(ctx.chat.id);
      }
      await ctx.reply('📌 تم إلغاء تثبيت الرسالة.');
    } catch (e) { await ctx.reply(`❌ ${e.message}`); }
  });

  // /del — حذف رسالة
  bot.command('del', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, ctx.chat.id, ctx.from.id)) return ctx.reply('❌ للمشرفين فقط!');
    if (!ctx.message.reply_to_message) return ctx.reply('❌ ارد على الرسالة التي تريد حذفها!');
    try {
      await bot.telegram.deleteMessage(ctx.chat.id, ctx.message.reply_to_message.message_id);
      await ctx.deleteMessage();
    } catch (e) { await ctx.reply(`❌ ${e.message}`); }
  });

  // /clearwarns أمر نصي
  bot.command('clearwarns', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, ctx.chat.id, ctx.from.id)) return ctx.reply('❌ للمشرفين فقط!');
    const target = await getTargetUser(ctx); if (!target) return ctx.reply('❌ ارد على رسالة المستخدم أو اذكره!');
    const g = await db.getGroup(ctx.chat.id); if (!g) return;
    g.warns.delete(target.id);
    await supa.clearWarns(ctx.chat.id, target.id);
    await ctx.replyWithMarkdown(`✅ *تم مسح تحذيرات*\n👤 ${target.username ? `@${target.username}` : target.firstName}`);
  });

  // /setmaxwarns — نقله هنا أيضاً من handler_owner (للوصول)
  bot.action(/^set_maxwarns_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    await ctx.editMessageText(
      `⚙️ *تعيين الحد الأقصى للتحذيرات*\n\nأرسل رقم بين 1-10 لتعيين الحد:`,
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard([
        [Markup.button.callback('1', `mw_${chatId}_1`), Markup.button.callback('2', `mw_${chatId}_2`), Markup.button.callback('3', `mw_${chatId}_3`), Markup.button.callback('4', `mw_${chatId}_4`), Markup.button.callback('5', `mw_${chatId}_5`)],
        [Markup.button.callback('🔙 رجوع', `settings_${chatId}`)],
      ]) }
    );
  });

  bot.action(/^mw_(-?\d+)_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const n      = Number(ctx.match[2]);
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ ممنوع', { show_alert: true });
    const g = await db.getGroup(chatId); if (!g) return;
    g.maxWarns = n;
    db.scheduleSync(g);
    await ctx.answerCbQuery(`✅ تم تعيين الحد: ${n}`, { show_alert: true });
  });

  // /auditlog callback
  bot.action(/^auditlog_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const logs = await supa.getAuditLog(chatId, 10);
    if (!logs.length) return ctx.answerCbQuery('📋 لا يوجد سجل بعد', { show_alert: true });
    let text = `📋 *سجل الإجراءات الأخيرة*\n\n`;
    for (const l of logs) {
      text += `⚡ *${l.action}*\n`;
      text += `👮 ${l.by_username || l.by_user_id}\n`;
      text += `👤 ${l.target_username || l.target_user_id}\n`;
      if (l.details) text += `📝 ${l.details}\n`;
      text += `🕐 ${new Date(l.created_at).toLocaleString('ar')}\n\n`;
    }
    try { await ctx.replyWithMarkdown(text.slice(0, 4096)); } catch {}
  });
};
