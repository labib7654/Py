// ============================================================
//  أوامر المشرفين
// ============================================================

const { Markup } = require('telegraf');
const db         = require('./db');
const { isDeveloper, isAdmin, getTargetUser, getReason, muteMember } = require('./helpers');

function memberActionsKeyboard(targetId, chatId, backCb) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🔇 كتم',      `mute_${targetId}_${chatId}`),
     Markup.button.callback('🔊 رفع كتم', `unmute_${targetId}_${chatId}`)],
    [Markup.button.callback('⚠️ تحذير',    `warn_${targetId}_${chatId}`),
     Markup.button.callback('👢 طرد',      `kick_${targetId}_${chatId}`)],
    [Markup.button.callback('🚫 حظر',      `ban_${targetId}_${chatId}`),
     Markup.button.callback('✅ رفع حظر', `unban_${targetId}_${chatId}`)],
    [Markup.button.callback('📋 معلومات',  `info_${targetId}_${chatId}`),
     Markup.button.callback('🔙 رجوع',    backCb || 'cancel')],
  ]);
}

module.exports = function setupAdminHandlers(bot) {

  // /admins
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
          db.trackMember(ctx.chat.id, a.user.id, a.user.username || '', a.user.first_name || '', 'owner');
        } else {
          text += `👮 *مشرف:* ${name}${rec ? `\n   ↳ رُقِّيَ بواسطة: @${rec.promotedByUsername}` : ''}\n`;
          db.trackMember(ctx.chat.id, a.user.id, a.user.username || '', a.user.first_name || '', 'admin');
        }
      }
    } catch { text += '_تعذر جلب القائمة_'; }
    await ctx.replyWithMarkdown(text);
  });

  // /ban
  bot.command('ban', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return ctx.reply('❌ للمشرفين فقط!');
    const target = await getTargetUser(ctx);
    if (!target) return ctx.reply('❌ ارد على رسالة المستخدم أو اذكره!');
    const reason = getReason(ctx.message.text, 2);
    try {
      await bot.telegram.banChatMember(chatId, target.id);
      const g = db.getGroup(chatId); if (g) g.bannedUsers.add(target.id);
      await ctx.replyWithMarkdown(
        `🚫 *تم الحظر*\n👤 ${target.username ? `@${target.username}` : target.firstName}\n👮 @${ctx.from.username || ctx.from.first_name}\n📝 ${reason}`,
        Markup.inlineKeyboard([[Markup.button.callback('✅ رفع الحظر', `unban_${target.id}_${chatId}`)]])
      );
    } catch (e) { await ctx.reply(`❌ ${e.message}`); }
  });

  // /kick
  bot.command('kick', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return ctx.reply('❌ للمشرفين فقط!');
    const target = await getTargetUser(ctx);
    if (!target) return ctx.reply('❌ ارد على رسالة المستخدم أو اذكره!');
    try {
      await bot.telegram.banChatMember(chatId, target.id);
      setTimeout(() => bot.telegram.unbanChatMember(chatId, target.id).catch(() => { }), 1500);
      await ctx.replyWithMarkdown(`👢 *تم الطرد*\n👤 ${target.username ? `@${target.username}` : target.firstName}`);
    } catch (e) { await ctx.reply(`❌ ${e.message}`); }
  });

  // /mute
  bot.command('mute', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return ctx.reply('❌ للمشرفين فقط!');
    const target = await getTargetUser(ctx);
    if (!target) return ctx.reply('❌ ارد على رسالة المستخدم أو اذكره!');
    try {
      await muteMember(bot, chatId, target.id);
      const g = db.getGroup(chatId); if (g) g.mutedUsers.add(target.id);
      await ctx.replyWithMarkdown(
        `🔇 *تم الكتم*\n👤 ${target.username ? `@${target.username}` : target.firstName}`,
        Markup.inlineKeyboard([[Markup.button.callback('🔊 رفع الكتم', `unmute_${target.id}_${chatId}`)]])
      );
    } catch (e) { await ctx.reply(`❌ ${e.message}`); }
  });

  // /unmute
  bot.command('unmute', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return ctx.reply('❌ للمشرفين فقط!');
    const target = await getTargetUser(ctx);
    if (!target) return ctx.reply('❌ ارد على رسالة المستخدم أو اذكره!');
    try {
      await bot.telegram.restrictChatMember(chatId, target.id, {
        permissions: { can_send_messages: true, can_send_audios: true, can_send_documents: true, can_send_photos: true, can_send_videos: true, can_send_video_notes: true, can_send_voice_notes: true, can_send_polls: true, can_send_other_messages: true, can_add_web_page_previews: true },
      });
      const g = db.getGroup(chatId); if (g) g.mutedUsers.delete(target.id);
      await ctx.replyWithMarkdown(`🔊 *تم رفع الكتم*\n👤 ${target.username ? `@${target.username}` : target.firstName}`);
    } catch (e) { await ctx.reply(`❌ ${e.message}`); }
  });

  // /warn
  bot.command('warn', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return ctx.reply('❌ للمشرفين فقط!');
    const target = await getTargetUser(ctx);
    if (!target) return ctx.reply('❌ ارد على رسالة المستخدم أو اذكره!');
    const reason = getReason(ctx.message.text, 2);
    const g = db.getGroup(chatId); if (!g) return;
    if (!g.warns.has(target.id)) g.warns.set(target.id, []);
    const warns = g.warns.get(target.id);
    warns.push({ reason, warnedBy: ctx.from.id, warnedAt: new Date() });
    if (warns.length >= g.maxWarns) {
      try { await bot.telegram.banChatMember(chatId, target.id); g.bannedUsers.add(target.id); g.warns.delete(target.id); } catch { }
      await ctx.replyWithMarkdown(`🚫 *حظر تلقائي*\n👤 ${target.username ? `@${target.username}` : target.firstName}\n📝 ${reason}`);
    } else {
      await ctx.replyWithMarkdown(
        `⚠️ *تحذير ${warns.length}/${g.maxWarns}*\n👤 ${target.username ? `@${target.username}` : target.firstName}\n📝 ${reason}`,
        Markup.inlineKeyboard([[Markup.button.callback('🗑️ حذف التحذيرات', `clearwarns_${target.id}_${chatId}`)]])
      );
    }
  });

  // /warns
  bot.command('warns', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const target = await getTargetUser(ctx);
    if (!target) return ctx.reply('❌ ارد على رسالة المستخدم أو اذكره!');
    const g = db.getGroup(ctx.chat.id);
    const warns = g?.warns.get(target.id) || [];
    if (!warns.length) return ctx.replyWithMarkdown(`✅ ${target.username ? `@${target.username}` : target.firstName} لا يملك تحذيرات.`);
    let text = `⚠️ *تحذيرات ${target.username ? `@${target.username}` : target.firstName}*\n\n`;
    warns.forEach((w, i) => { text += `${i + 1}. ${w.reason} — ${w.warnedAt.toLocaleDateString('ar-SA')}\n`; });
    text += `\nالإجمالي: ${warns.length}/${g?.maxWarns || 3}`;
    await ctx.replyWithMarkdown(text, Markup.inlineKeyboard([[Markup.button.callback('🗑️ حذف التحذيرات', `clearwarns_${target.id}_${ctx.chat.id}`)]]));
  });

  // /manage
  bot.command('manage', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return ctx.reply('❌ للمشرفين فقط!');
    const target = await getTargetUser(ctx);
    if (!target) return ctx.reply('❌ ارد على رسالة المستخدم للإدارة!');
    db.trackMember(chatId, target.id, target.username, target.firstName, 'member');
    const g = db.getGroup(chatId);
    const warns = g?.warns.get(target.id)?.length || 0;
    await ctx.replyWithMarkdown(
      `👤 *إدارة المستخدم*\n\nالاسم: ${target.firstName || '—'}\nالمعرف: @${target.username || '—'}\nالآيدي: \`${target.id}\`\nالتحذيرات: \`${warns}/${g?.maxWarns || 3}\``,
      memberActionsKeyboard(target.id, chatId, 'cancel')
    );
  });

  // ── أزرار الإجراءات ────────────────────────────────────────

  bot.action(/^mute_(\d+)_(-?\d+)$/, async (ctx) => {
    const [tid, cid] = [Number(ctx.match[1]), Number(ctx.match[2])];
    if (!isDeveloper(ctx) && !await isAdmin(bot, cid, ctx.from.id)) return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    try {
      await muteMember(bot, cid, tid);
      const g = db.getGroup(cid); if (g) g.mutedUsers.add(tid);
      await ctx.answerCbQuery('✅ تم الكتم!', { show_alert: true });
    } catch (e) { await ctx.answerCbQuery(`❌ ${e.message}`, { show_alert: true }); }
  });

  bot.action(/^unmute_(\d+)_(-?\d+)$/, async (ctx) => {
    const [tid, cid] = [Number(ctx.match[1]), Number(ctx.match[2])];
    if (!isDeveloper(ctx) && !await isAdmin(bot, cid, ctx.from.id)) return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    try {
      await bot.telegram.restrictChatMember(cid, tid, { permissions: { can_send_messages: true, can_send_audios: true, can_send_documents: true, can_send_photos: true, can_send_videos: true, can_send_video_notes: true, can_send_voice_notes: true, can_send_polls: true, can_send_other_messages: true, can_add_web_page_previews: true } });
      const g = db.getGroup(cid); if (g) g.mutedUsers.delete(tid);
      await ctx.answerCbQuery('✅ تم رفع الكتم!', { show_alert: true });
    } catch (e) { await ctx.answerCbQuery(`❌ ${e.message}`, { show_alert: true }); }
  });

  bot.action(/^ban_(\d+)_(-?\d+)$/, async (ctx) => {
    const [tid, cid] = [Number(ctx.match[1]), Number(ctx.match[2])];
    if (!isDeveloper(ctx) && !await isAdmin(bot, cid, ctx.from.id)) return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    try {
      await bot.telegram.banChatMember(cid, tid);
      const g = db.getGroup(cid); if (g) g.bannedUsers.add(tid);
      await ctx.answerCbQuery('✅ تم الحظر!', { show_alert: true });
    } catch (e) { await ctx.answerCbQuery(`❌ ${e.message}`, { show_alert: true }); }
  });

  bot.action(/^unban_(\d+)_(-?\d+)$/, async (ctx) => {
    const [tid, cid] = [Number(ctx.match[1]), Number(ctx.match[2])];
    if (!isDeveloper(ctx) && !await isAdmin(bot, cid, ctx.from.id)) return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    try {
      await bot.telegram.unbanChatMember(cid, tid);
      const g = db.getGroup(cid); if (g) g.bannedUsers.delete(tid);
      await ctx.answerCbQuery('✅ تم رفع الحظر!', { show_alert: true });
    } catch (e) { await ctx.answerCbQuery(`❌ ${e.message}`, { show_alert: true }); }
  });

  bot.action(/^kick_(\d+)_(-?\d+)$/, async (ctx) => {
    const [tid, cid] = [Number(ctx.match[1]), Number(ctx.match[2])];
    if (!isDeveloper(ctx) && !await isAdmin(bot, cid, ctx.from.id)) return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    try {
      await bot.telegram.banChatMember(cid, tid);
      setTimeout(() => bot.telegram.unbanChatMember(cid, tid).catch(() => { }), 1500);
      await ctx.answerCbQuery('✅ تم الطرد!', { show_alert: true });
    } catch (e) { await ctx.answerCbQuery(`❌ ${e.message}`, { show_alert: true }); }
  });

  bot.action(/^warn_(\d+)_(-?\d+)$/, async (ctx) => {
    const [tid, cid] = [Number(ctx.match[1]), Number(ctx.match[2])];
    if (!isDeveloper(ctx) && !await isAdmin(bot, cid, ctx.from.id)) return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const g = db.getGroup(cid); if (!g) return ctx.answerCbQuery('❌ بيانات غير موجودة!', { show_alert: true });
    if (!g.warns.has(tid)) g.warns.set(tid, []);
    const warns = g.warns.get(tid);
    warns.push({ reason: 'تحذير يدوي', warnedBy: ctx.from.id, warnedAt: new Date() });
    if (warns.length >= g.maxWarns) {
      try { await bot.telegram.banChatMember(cid, tid); g.bannedUsers.add(tid); g.warns.delete(tid); } catch { }
      await ctx.answerCbQuery(`🚫 حظر تلقائي بعد ${g.maxWarns} تحذيرات!`, { show_alert: true });
    } else {
      await ctx.answerCbQuery(`⚠️ تحذير ${warns.length}/${g.maxWarns}!`, { show_alert: true });
    }
  });

  bot.action(/^clearwarns_(\d+)_(-?\d+)$/, async (ctx) => {
    const [tid, cid] = [Number(ctx.match[1]), Number(ctx.match[2])];
    if (!isDeveloper(ctx) && !await isAdmin(bot, cid, ctx.from.id)) return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const g = db.getGroup(cid); if (g) g.warns.delete(tid);
    await ctx.answerCbQuery('✅ تم حذف التحذيرات!', { show_alert: true });
    await ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n✅ *تم حذف التحذيرات*', { parse_mode: 'Markdown' });
  });

  bot.action(/^info_(\d+)_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const [tid, cid] = [Number(ctx.match[1]), Number(ctx.match[2])];
    const g  = db.getGroup(cid);
    const m  = g?.members.get(tid);
    const gu = db.getUser(tid);
    const name = m ? (m.username ? `@${m.username}` : m.firstName) : String(tid);
    await ctx.reply(
      `📋 *معلومات*\n\n👤 ${name}\n🆔 \`${tid}\`\n📛 ${m?.role || '—'}\n` +
      `⚠️ تحذيرات: \`${g?.warns.get(tid)?.length || 0}/${g?.maxWarns || 3}\`\n` +
      `🔇 مكتوم: ${g?.mutedUsers.has(tid) ? '✅' : '❌'}\n🚫 محظور: ${g?.bannedUsers.has(tid) ? '✅' : '❌'}\n` +
      `🌍 محظور عالمياً: ${gu?.globalBanned ? '✅' : '❌'}\n📨 رسائل: \`${m?.messageCount || 0}\``,
      { parse_mode: 'Markdown' }
    );
  });
};
