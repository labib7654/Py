// FEATURE 10 (FIX): إدارة القنوات — dev_channels / dev_ch_
const { Markup } = require('telegraf');
const db         = require('./db');
const { isDeveloper } = require('./helpers_permissions');

const ITEMS_PER_PAGE = 5;

module.exports = function setupChannelsHandlers(bot) {

  // ── قائمة القنوات ─────────────────────────────────────────────────────
  bot.action(/^dev_channels(?:_page_(\d+))?$/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!isDeveloper(ctx)) return;
    const page     = Number(ctx.match[1] || 0);
    const channels = db.allChannels();
    const total    = channels.length;
    const slice    = channels.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE);
    let text = `📢 *قائمة القنوات* (${total})\n\nالصفحة ${page + 1} من ${Math.ceil(total / ITEMS_PER_PAGE) || 1}\n\n`;
    slice.forEach((ch, i) => {
      const verifiedIcon = ch.ownerVerified ? '✅' : '❓';
      text += `${page * ITEMS_PER_PAGE + i + 1}. *${ch.title}*\n   🆔 \`${ch.chatId}\`\n   ${verifiedIcon} المالك: \`${ch.ownerUsername || 'غير محدد'}\`\n   🔒 حماية: ${ch.protectContent ? '✅' : '❌'}\n\n`;
    });
    if (!slice.length) text += '_لا توجد قنوات مسجّلة._';
    const pagBtns = [];
    if (page > 0)                               pagBtns.push(Markup.button.callback('⬅️', `dev_channels_page_${page - 1}`));
    if ((page + 1) * ITEMS_PER_PAGE < total)    pagBtns.push(Markup.button.callback('➡️', `dev_channels_page_${page + 1}`));
    const chBtns  = slice.map(ch => [Markup.button.callback(`📢 ${ch.title.slice(0, 25)}`, `dev_ch_${ch.chatId}`)]);
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        ...chBtns,
        ...(pagBtns.length ? [pagBtns] : []),
        [Markup.button.callback('🔙 رجوع', 'dev_home')],
      ]),
    });
  });

  // ── إدارة قناة واحدة ─────────────────────────────────────────────────
  bot.action(/^dev_ch_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!isDeveloper(ctx)) return;
    const chatId  = Number(ctx.match[1]);
    const ch = db.getChannel(chatId);
    if (!ch) return ctx.answerCbQuery('❌ القناة غير موجودة!', { show_alert: true });
    await ctx.editMessageText(buildChannelText(ch), {
      parse_mode: 'Markdown',
      ...buildChannelKeyboard(chatId, ch),
    });
  });

  // ── التحقق من مالك القناة ────────────────────────────────────────────
  bot.action(/^ch_verify_owner_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!isDeveloper(ctx)) return;
    const chatId = Number(ctx.match[1]);
    const ch = db.getChannel(chatId);
    if (!ch) return ctx.answerCbQuery('❌ القناة غير موجودة!', { show_alert: true });
    try {
      const admins  = await bot.telegram.getChatAdministrators(chatId);
      const creator = admins.find(a => a.status === 'creator' && !a.user.is_bot);
      if (creator) {
        ch.ownerId       = creator.user.id;
        ch.ownerUsername = creator.user.username || creator.user.first_name || String(creator.user.id);
        ch.ownerVerified  = true;
        ch.ownerVerifiedAt = new Date();
      }
      await ctx.answerCbQuery(creator ? `✅ المالك: ${ch.ownerUsername}` : '⚠️ لم يُعثر على مالك!', { show_alert: true });
      await ctx.editMessageText(buildChannelText(ch), { parse_mode: 'Markdown', ...buildChannelKeyboard(chatId, ch) });
    } catch (e) { await ctx.answerCbQuery(`❌ ${e.message}`, { show_alert: true }); }
  });

  // ── حماية محتوى القناة ────────────────────────────────────────────────
  bot.action(/^ch_toggle_protect_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!isDeveloper(ctx)) return;
    const chatId = Number(ctx.match[1]);
    const ch = db.getChannel(chatId);
    if (!ch) return ctx.answerCbQuery('❌ القناة غير موجودة!', { show_alert: true });
    ch.protectContent = !ch.protectContent;
    try { await bot.telegram.setChatProtectContent(chatId, { is_protected: ch.protectContent }); } catch (e) { console.error(`ch_protect error: ${e.message}`); }
    await ctx.editMessageText(buildChannelText(ch), { parse_mode: 'Markdown', ...buildChannelKeyboard(chatId, ch) });
  });

  // ── وضع السلو موو للقناة ─────────────────────────────────────────────
  bot.action(/^ch_slowmode_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!isDeveloper(ctx)) return;
    const chatId = Number(ctx.match[1]);
    const ch = db.getChannel(chatId);
    if (!ch) return ctx.answerCbQuery('❌ القناة غير موجودة!', { show_alert: true });
    await ctx.editMessageText('⏱️ *وضع السلو موو*\n\nاختر مدة الانتظار بين المنشورات:', {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('بدون', `ch_sm_${chatId}_0`), Markup.button.callback('5ث', `ch_sm_${chatId}_5`), Markup.button.callback('30ث', `ch_sm_${chatId}_30`)],
        [Markup.button.callback('1د', `ch_sm_${chatId}_60`), Markup.button.callback('5د', `ch_sm_${chatId}_300`), Markup.button.callback('15د', `ch_sm_${chatId}_900`)],
        [Markup.button.callback('🔙 رجوع', `dev_ch_${chatId}`)],
      ]),
    });
  });

  // FIX 11: setChatSlowModeDelay لا يعمل على القنوات — نُظهر رسالة واضحة
  bot.action(/^ch_sm_(-?\d+)_(\d+)$/, async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('❌', { show_alert: true });
    await ctx.answerCbQuery('⚠️ الـ Slow Mode لا يدعمه Bot API للقنوات حالياً.', { show_alert: true });
  });

  // ── تثبيت آخر منشور ────────────────────────────────────────────────
  bot.action(/^ch_pin_latest_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!isDeveloper(ctx)) return;
    const chatId = Number(ctx.match[1]);
    const ch = db.getChannel(chatId);
    if (!ch?.pinnedMessageId)
      return ctx.answerCbQuery('❌ لا يوجد منشور محدد للتثبيت!', { show_alert: true });
    try {
      await bot.telegram.pinChatMessage(chatId, ch.pinnedMessageId, { disable_notification: false });
      await ctx.answerCbQuery('✅ تم التثبيت!', { show_alert: true });
    } catch (e) { await ctx.answerCbQuery(`❌ ${e.message}`, { show_alert: true }); }
  });

  // ── حذف القناة من قاعدة البيانات ────────────────────────────────────
  bot.action(/^ch_delete_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!isDeveloper(ctx)) return;
    const chatId = Number(ctx.match[1]);
    db.deleteChannel(chatId);
    await ctx.editMessageText('✅ تم حذف القناة من قاعدة البيانات.', {
      ...Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع للقنوات', 'dev_channels')]]),
    });
  });

};

function buildChannelText(ch) {
  return (
    `📢 *إدارة القناة — ${ch.title}*\n\n` +
    `🆔 \`${ch.chatId}\`\n` +
    `@${ch.username || '—'}\n` +
    `👑 المالك: \`${ch.ownerUsername || 'غير محدد'}\`\n` +
    `✅ التحقق: ${ch.ownerVerified ? `✅ ${new Date(ch.ownerVerifiedAt).toLocaleDateString('ar')}` : '❌ لم يتم'}\n` +
    `🔒 حماية المحتوى: ${ch.protectContent ? '✅' : '❌'}\n` +
    `⏱️ السلو موو: ${ch.slowMode ? `${ch.slowMode}ث` : '❌'}\n` +
    `🔗 مجموعة مرتبطة: ${ch.linkedGroupId ? `\`${ch.linkedGroupId}\`` : '❌'}\n` +
    `📌 آخر منشور مثبت: ${ch.pinnedMessageId ? `\`${ch.pinnedMessageId}\`` : '—'}\n` +
    `📊 مشتركون: \`${ch.subscribers.size}\`\n` +
    `🕐 أُضيف: ${new Date(ch.addedAt).toLocaleDateString('ar')}`
  );
}

function buildChannelKeyboard(chatId, ch) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🔍 تحقق من المالك', `ch_verify_owner_${chatId}`),
      Markup.button.callback(`${ch.protectContent ? '✅' : '❌'} حماية`, `ch_toggle_protect_${chatId}`),
    ],
    [
      Markup.button.callback('⏱️ سلو موو', `ch_slowmode_${chatId}`),
      Markup.button.callback('📌 تثبيت', `ch_pin_latest_${chatId}`),
    ],
    [Markup.button.callback('🗑️ حذف من DB', `ch_delete_${chatId}`)],
    [Markup.button.callback('🔙 رجوع', 'dev_channels')],
  ]);
}
