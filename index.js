require('dotenv').config();
const express     = require('express');
const { Telegraf, Markup } = require('telegraf');

const { BOT_TOKEN, PORT, DEVELOPER_ID } = require('./config');
const db                  = require('./db');
const { globalMiddleware, messageTrackingMiddleware } = require('./middleware');

// ── Handlers ─────────────────────────────────────────────────
const setupDeveloperHandlers = require('./handler_developer');
const setupOwnerHandlers     = require('./handler_owner');
const setupAdminHandlers     = require('./handler_admin');
const setupGroupHandlers     = require('./handler_groups');

// ────────────────────────────────────────────────────────────
if (!BOT_TOKEN) { console.error('❌ BOT_TOKEN غير محدد في .env'); process.exit(1); }

const bot = new Telegraf(BOT_TOKEN);
const app = express();
app.use(express.json());

// ── Middleware ───────────────────────────────────────────────
bot.use(globalMiddleware);
bot.use(messageTrackingMiddleware);

// ── تسجيل الـ handlers بالترتيب الصحيح ───────────────────────
setupDeveloperHandlers(bot);
setupOwnerHandlers(bot);
setupAdminHandlers(bot);
setupGroupHandlers(bot);

// ── /start ────────────────────────────────────────────────────
// FIX 20: تحسين UI بأزرار بدل النص الطويل
bot.command('start', async (ctx) => {
  if (ctx.chat.type !== 'private') return;
  const isDev = ctx.from.id === DEVELOPER_ID;
  await ctx.replyWithMarkdown(
    `👋 *مرحباً ${ctx.from.first_name}!*\n\n` +
    `🤖 أنا *جامعة v4.0* — بوت إدارة مجموعات تليغرام الشامل.\n\n` +
    `اختر ما تريد من الأزرار أدناه:`,
    Markup.inlineKeyboard([
      [Markup.button.callback('⚙️ إعداداتي',           'open_my_settings')],
      [Markup.button.callback('📋 الأوامر المتاحة',     'show_commands')],
      ...(isDev ? [[Markup.button.callback('👑 لوحة المطور', 'dev_home')]] : []),
    ])
  );
});

// FIX 20: عرض قائمة الأوامر عبر زر منفصل
bot.action('show_commands', async (ctx) => {
  await ctx.answerCbQuery();
  const isDev = ctx.from.id === DEVELOPER_ID;
  await ctx.reply(
    `📋 *الأوامر المتاحة:*\n\n` +
    `⚙️ /settings — إعدادات المجموعة\n` +
    `👮 /admins — قائمة المشرفين\n` +
    `📋 /rules — القواعد\n` +
    `👤 /manage — إدارة عضو\n` +
    `🚫 /ban — حظر\n` +
    `👢 /kick — طرد\n` +
    `🔇 /mute — كتم\n` +
    `🔊 /unmute — رفع الكتم\n` +
    `⚠️ /warn — تحذير\n` +
    `📊 /warns — استعراض التحذيرات\n` +
    `🔒 /locktopic — قفل موضوع\n` +
    `🔓 /unlocktopic — فتح موضوع\n` +
    `📁 /archivetopic — أرشفة موضوع\n` +
    (isDev
      ? `\n👑 *أوامر المطور:*\n/dev /gban /ungban /userinfo /broadcast /backup /restore /chatinfo /forcejoin /devmanage`
      : ''),
    { parse_mode: 'Markdown' }
  );
});

// FIX 16: open_my_settings يزامن قائمة المشرفين من تيليغرام أولاً
bot.action('open_my_settings', async (ctx) => {
  await ctx.answerCbQuery();
  // مزامنة المشرفين أولاً
  const allGroups = db.allGroups();
  for (const g of allGroups) {
    try {
      const admins = await bot.telegram.getChatAdministrators(g.chatId);
      for (const a of admins) {
        if (a.user.is_bot) continue;
        if (a.status === 'creator') {
          g.ownerId       = a.user.id;
          g.ownerUsername = a.user.username || a.user.first_name || String(a.user.id);
        } else if (a.status === 'administrator') {
          if (!g.admins.has(a.user.id)) {
            g.admins.set(a.user.id, {
              username:           a.user.username || a.user.first_name || String(a.user.id),
              promotedBy:         0,
              promotedByUsername: 'تيليغرام',
              promotedAt:         new Date(),
            });
          }
        }
      }
    } catch { /* المجموعة ليست متاحة */ }
  }
  const userGroups = allGroups.filter(g =>
    g.ownerId === ctx.from.id ||
    g.admins.has(ctx.from.id) ||
    ctx.from.id === DEVELOPER_ID
  );
  if (!userGroups.length) return ctx.reply('❌ لا توجد مجموعات تديرها.');
  const btns = userGroups.map(g => [Markup.button.callback(`📌 ${g.title}`, `settings_${g.chatId}`)]);
  await ctx.reply('🤖 *اختر مجموعة للإعدادات:*', { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) });
});

// ── معالجة الأخطاء ───────────────────────────────────────────
bot.catch((err, ctx) => {
  const desc = err?.description || err?.message || String(err);
  const forbidden = ['have no rights', 'not enough rights', 'is not a member', 'chat not found'];
  if (forbidden.some(s => desc.includes(s))) return;
  console.error(`[Bot Error] ${ctx?.updateType}:`, desc);
});

// ── Express Health Check ──────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true, uptime: process.uptime() }));
app.get('/',       (_req, res) => res.send('🤖 جامعة v4.0 — Bot is running!'));

// ── تشغيل البوت + السيرفر ─────────────────────────────────────
async function main() {
  const port = PORT || 3000;
  app.listen(port, () => {
    console.log(`🌐 Express server on port ${port}`);
  });

  const WEBHOOK_URL = process.env.WEBHOOK_URL;
  if (WEBHOOK_URL) {
    const secretToken = process.env.SESSION_SECRET || undefined;
    await bot.telegram.setWebhook(`${WEBHOOK_URL}/webhook`, { secret_token: secretToken });
    app.post('/webhook', (req, res) => {
      if (secretToken && req.headers['x-telegram-bot-api-secret-token'] !== secretToken) {
        return res.sendStatus(403);
      }
      bot.handleUpdate(req.body);
      res.sendStatus(200);
    });
    console.log(`✅ Webhook: ${WEBHOOK_URL}/webhook`);
  } else {
    await bot.telegram.deleteWebhook({ drop_pending_updates: false });
    bot.launch();
    console.log('✅ Bot running (long polling)');
  }

  try {
    const stats = db.getStats();
    await bot.telegram.sendMessage(DEVELOPER_ID,
      `🟢 *جامعة v4.0 — تشغيل*\n\n` +
      `📊 ${stats.totalGroups} مجموعة | ${stats.totalChannels} قناة | ${stats.totalUsers} مستخدم\n` +
      `🕐 ${new Date().toLocaleString('ar')}`,
      { parse_mode: 'Markdown' }
    );
  } catch {}

  process.once('SIGINT',  () => { bot.stop('SIGINT');  db.saveData(); });
  process.once('SIGTERM', () => { bot.stop('SIGTERM'); db.saveData(); });
}

main().catch(e => {
  console.error('❌ Fatal startup error:', e.message);
  process.exit(1);
});
