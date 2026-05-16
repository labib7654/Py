// لوحة تحكم المطور: /dev، الإحصائيات، قائمة المجموعات
const { Markup }   = require('telegraf');
const db           = require('./db');
const { isDeveloper } = require('./helpers_permissions');

const ITEMS_PER_PAGE = 6;

module.exports = function setupPanelHandlers(bot) {

  // ── /dev ─────────────────────────────────────────────────────────────
  bot.command('dev', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.reply('❌ مطور فقط!');
    const stats = db.getStats();
    await ctx.replyWithMarkdown(buildDevHomeText(stats), buildDevHomeKeyboard());
  });

  // ── إعادة عرض القائمة الرئيسية ───────────────────────────────────────
  bot.action('dev_home', async (ctx) => {
    await ctx.answerCbQuery();
    if (!isDeveloper(ctx)) return;
    const stats = db.getStats();
    await ctx.editMessageText(buildDevHomeText(stats), { parse_mode: 'Markdown', ...buildDevHomeKeyboard() });
  });

  // ── /stats ────────────────────────────────────────────────────────────
  bot.command('stats', async (ctx) => {
    if (!isDeveloper(ctx)) return;
    const stats = db.getStats();
    await ctx.replyWithMarkdown(buildStatsText(stats), Markup.inlineKeyboard([[Markup.button.callback('🔄 تحديث', 'dev_stats')]]));
  });

  bot.action('dev_stats', async (ctx) => {
    await ctx.answerCbQuery();
    if (!isDeveloper(ctx)) return;
    const stats = db.getStats();
    await ctx.editMessageText(buildStatsText(stats), {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🔄 تحديث', 'dev_stats'), Markup.button.callback('🔙 رجوع', 'dev_home')],
      ]),
    });
  });

  // ── قائمة المجموعات (مع pagination) ──────────────────────────────────
  bot.action(/^dev_groups(?:_page_(\d+))?$/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!isDeveloper(ctx)) return;
    const page   = Number(ctx.match[1] || 0);
    // FIX: عرض المجموعات فقط (بدون قنوات)
    const groups  = db.allGroups();
    const total   = groups.length;
    const slice   = groups.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE);
    let text      = `📋 *قائمة المجموعات* (${total})\n\nالصفحة ${page + 1} من ${Math.ceil(total / ITEMS_PER_PAGE) || 1}\n\n`;
    slice.forEach((g, i) => {
      text += `${page * ITEMS_PER_PAGE + i + 1}. *${g.title}*\n   🆔 \`${g.chatId}\` | 👥 \`${g.members.size}\`\n   👑 \`${g.ownerUsername || 'غير محدد'}\`\n\n`;
    });
    if (!slice.length) text += '_لا توجد مجموعات مسجّلة._';
    const pagBtns = [];
    if (page > 0)                                pagBtns.push(Markup.button.callback('⬅️', `dev_groups_page_${page - 1}`));
    if ((page + 1) * ITEMS_PER_PAGE < total)     pagBtns.push(Markup.button.callback('➡️', `dev_groups_page_${page + 1}`));
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        ...(pagBtns.length ? [pagBtns] : []),
        [Markup.button.callback('🔙 رجوع', 'dev_home')],
      ]),
    });
  });

  // ── قائمة المستخدمين ─────────────────────────────────────────────────
  bot.action(/^dev_users(?:_page_(\d+))?$/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!isDeveloper(ctx)) return;
    const page  = Number(ctx.match[1] || 0);
    const users = db.allUsers();
    const total = users.length;
    const slice = users.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE);
    let text    = `👤 *قائمة المستخدمين* (${total})\n\nالصفحة ${page + 1} من ${Math.ceil(total / ITEMS_PER_PAGE) || 1}\n\n`;
    slice.forEach((u, i) => {
      text += `${page * ITEMS_PER_PAGE + i + 1}. ${u.username ? `@${u.username}` : u.firstName || '—'} \`[${u.userId}]\`${u.globalBanned ? ' 🚫' : ''}\n`;
    });
    if (!slice.length) text += '_لا يوجد مستخدمون مسجّلون._';
    const pagBtns = [];
    if (page > 0)                                pagBtns.push(Markup.button.callback('⬅️', `dev_users_page_${page - 1}`));
    if ((page + 1) * ITEMS_PER_PAGE < total)     pagBtns.push(Markup.button.callback('➡️', `dev_users_page_${page + 1}`));
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        ...(pagBtns.length ? [pagBtns] : []),
        [Markup.button.callback('🔙 رجوع', 'dev_home')],
      ]),
    });
  });

};

// ── نصوص وأزرار مشتركة ───────────────────────────────────────────────
function buildDevHomeText(stats) {
  return (
    `🤖 *جامعة v4.0 — لوحة المطور*\n\n` +
    `📊 *إحصائيات سريعة:*\n` +
    `👥 مجموعات: \`${stats.totalGroups}\`\n` +
    `📢 قنوات: \`${stats.totalChannels}\`\n` +
    `👤 مستخدمون: \`${stats.totalUsers}\`\n` +
    `🚫 محظورون عالمياً: \`${stats.bannedUsers}\`\n` +
    `⚠️ تحذيرات فعّالة: \`${stats.totalWarns}\`\n` +
    `📨 طلبات معلقة: \`${stats.pendingReqs}\`\n\n` +
    `🕐 ${new Date().toLocaleString('ar')}`
  );
}

function buildDevHomeKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📊 إحصائيات',    'dev_stats'),    Markup.button.callback('📋 المجموعات', 'dev_groups')],
    [Markup.button.callback('📢 القنوات',     'dev_channels'), Markup.button.callback('👤 المستخدمون','dev_users')],
    [Markup.button.callback('🚫 الحظر العالمي','dev_gbans'),   Markup.button.callback('📢 بث رسالة',  'dev_broadcast_menu')],
    [Markup.button.callback('💾 نسخ احتياطي', 'dev_backup'),   Markup.button.callback('♻️ استعادة',   'dev_restore')],
    [Markup.button.callback('🔒 حماية عالمية', 'dev_global_protect')],
  ]);
}

function buildStatsText(stats) {
  const groups   = db.allGroups();
  const channels = db.allChannels();
  const totalMembers = groups.reduce((a, g) => a + g.members.size, 0);
  const totalAdmins  = groups.reduce((a, g) => a + g.admins.size, 0);
  return (
    `📊 *إحصائيات تفصيلية*\n\n` +
    `👥 *المجموعات:* \`${stats.totalGroups}\`\n` +
    `   ├ إجمالي الأعضاء: \`${totalMembers}\`\n` +
    `   ├ إجمالي المشرفين: \`${totalAdmins}\`\n` +
    `   └ إجمالي التحذيرات: \`${stats.totalWarns}\`\n\n` +
    `📢 *القنوات:* \`${stats.totalChannels}\`\n` +
    `   └ إجمالي المشتركين: \`${channels.reduce((a, c) => a + c.subscribers.size, 0)}\`\n\n` +
    `👤 *المستخدمون:* \`${stats.totalUsers}\`\n` +
    `   └ محظورون عالمياً: \`${stats.bannedUsers}\`\n\n` +
    `📨 *طلبات الانضمام المعلّقة:* \`${stats.pendingReqs}\`\n\n` +
    `🕐 ${new Date().toLocaleString('ar')}`
  );
}

module.exports.buildDevHomeKeyboard = buildDevHomeKeyboard;
