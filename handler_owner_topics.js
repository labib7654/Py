const { Markup } = require('telegraf');
const db         = require('./db');
const { isDeveloper, isAdmin } = require('./helpers_permissions');
const { lockTopic, unlockTopic, archiveTopic } = require('./helpers_actions');

module.exports = function setupTopicsHandlers(bot) {

  // ── /locktopic ────────────────────────────────────────────
  bot.command('locktopic', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.reply('❌ للمشرفين فقط!');
    const g = db.getGroup(chatId); if (!g) return;
    const topicId = ctx.message.message_thread_id || Number(ctx.message.text.split(' ')[1]);
    if (!topicId) return ctx.reply('❌ استخدم في موضوع أو: /locktopic <topic_id>');
    try {
      await lockTopic(bot, chatId, topicId);
      if (!g.topics.has(topicId)) g.topics.set(topicId, { name: String(topicId), locked: false, archived: false, approvedUsers: new Set(), pendingRequests: new Map(), requireJoinRequest: false, isPrivateTopic: false, specialization: '', specialistUserId: null, specialistUsername: '' });
      g.topics.get(topicId).locked = true;
      await ctx.reply(`🔒 تم قفل الموضوع \`${topicId}\``, { parse_mode: 'Markdown' });
    } catch (e) { await ctx.reply(`❌ فشل: ${e.message}`); }
  });

  // ── /unlocktopic ──────────────────────────────────────────
  bot.command('unlocktopic', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.reply('❌ للمشرفين فقط!');
    const g = db.getGroup(chatId); if (!g) return;
    const topicId = ctx.message.message_thread_id || Number(ctx.message.text.split(' ')[1]);
    if (!topicId) return ctx.reply('❌ استخدم في موضوع أو: /unlocktopic <topic_id>');
    try {
      await unlockTopic(bot, chatId, topicId);
      if (g.topics.has(topicId)) g.topics.get(topicId).locked = false;
      await ctx.reply(`🔓 تم فتح الموضوع \`${topicId}\``, { parse_mode: 'Markdown' });
    } catch (e) { await ctx.reply(`❌ فشل: ${e.message}`); }
  });

  // ── /archivetopic ─────────────────────────────────────────
  bot.command('archivetopic', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.reply('❌ للمشرفين فقط!');
    const g = db.getGroup(chatId); if (!g) return;
    const topicId = ctx.message.message_thread_id || Number(ctx.message.text.split(' ')[1]);
    if (!topicId) return ctx.reply('❌ استخدم في موضوع أو: /archivetopic <topic_id>');
    try {
      await archiveTopic(bot, chatId, topicId);
      if (!g.topics.has(topicId)) g.topics.set(topicId, { name: String(topicId), locked: false, archived: false, approvedUsers: new Set(), pendingRequests: new Map(), requireJoinRequest: false, isPrivateTopic: false, specialization: '', specialistUserId: null, specialistUsername: '' });
      const t = g.topics.get(topicId);
      t.locked = true; t.archived = true;
      await ctx.reply(`📁 تم أرشفة الموضوع \`${topicId}\``, { parse_mode: 'Markdown' });
    } catch (e) { await ctx.reply(`❌ فشل: ${e.message}`); }
  });

  // ── /topicrequest on|off ──────────────────────────────────
  bot.command('topicrequest', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.reply('❌ للمشرفين فقط!');
    const g   = db.getGroup(chatId); if (!g) return;
    const arg = ctx.message.text.split(' ')[1]?.toLowerCase();
    if (!['on', 'off'].includes(arg)) return ctx.reply('❌ مثال: /topicrequest on أو /topicrequest off');
    g.topicSettings = g.topicSettings || { requireApprovalToJoin: false, autoLockOnCreate: false, ownerBypassAll: true };
    g.topicSettings.requireApprovalToJoin = arg === 'on';
    await ctx.replyWithMarkdown(
      arg === 'on'
        ? '✅ *طلبات دخول المواضيع مفعّلة* — أي رسالة في موضوع مقفل ستُرسل للمالك طلب موافقة.'
        : '❌ *طلبات دخول المواضيع معطّلة*'
    );
  });

  // ── لوحة المواضيع ─────────────────────────────────────────
  bot.action(/^topics_panel_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId); if (!g) return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const ts = g.topicSettings || {};
    let text = `🧵 *إدارة المواضيع — ${g.title}*\n\n`;
    text += `🔒 طلبات دخول المواضيع: ${ts.requireApprovalToJoin ? '✅ مفعّل' : '❌ معطّل'}\n\n`;
    if (g.topics.size) {
      text += `*المواضيع المسجّلة (${g.topics.size}):*\n`;
      for (const [tid, t] of g.topics.entries()) {
        text += `• \`${tid}\` ${t.name ? `(${t.name})` : ''} ${t.locked ? '🔒' : '🔓'} ${t.archived ? '📁' : ''}${t.requireJoinRequest ? ' 📩' : ''}${t.specialistUserId ? ' 👤' : ''}\n`;
      }
    } else {
      text += '_لا توجد مواضيع مسجّلة حتى الآن._\n';
    }
    text += `\n*الأوامر المتاحة:*\n\`/locktopic\` | \`/unlocktopic\` | \`/archivetopic\`\n\`/topicrequest on|off\``;
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback(`${ts.requireApprovalToJoin ? '✅' : '❌'} طلبات دخول المواضيع`, `toggle_topicreq_${chatId}`)],
        [Markup.button.callback('🔙 رجوع', `settings_${chatId}`)],
      ]),
    });
  });

  bot.action(/^toggle_topicreq_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId); if (!g) return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    g.topicSettings = g.topicSettings || { requireApprovalToJoin: false, autoLockOnCreate: false, ownerBypassAll: true };
    g.topicSettings.requireApprovalToJoin = !g.topicSettings.requireApprovalToJoin;
    await ctx.answerCbQuery(g.topicSettings.requireApprovalToJoin ? '✅ طلبات دخول المواضيع مفعّلة!' : '❌ طلبات دخول المواضيع معطّلة!');
    const ts   = g.topicSettings;
    let text   = `🧵 *إدارة المواضيع — ${g.title}*\n\n`;
    text += `🔒 طلبات دخول المواضيع: ${ts.requireApprovalToJoin ? '✅ مفعّل' : '❌ معطّل'}\n`;
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback(`${ts.requireApprovalToJoin ? '✅' : '❌'} طلبات دخول المواضيع`, `toggle_topicreq_${chatId}`)],
        [Markup.button.callback('🔙 رجوع', `settings_${chatId}`)],
      ]),
    });
  });

};
