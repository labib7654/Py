// @ts-nocheck
import { Telegraf } from 'telegraf';
import { BOT_TOKEN, DEVELOPER_ID } from './config';
import { globalMiddleware, messageTrackingMiddleware } from './middleware';
import setupAdminHandlers     from './handler_admin';
import setupDeveloper         from './handler_developer';
import setupGroupHandlers     from './handler_groups';
import setupOwnerHandlers     from './handler_owner';
import * as db                from './db';

export async function startBot(app) {
  if (!BOT_TOKEN) {
    process.stderr.write('[bot] BOT_TOKEN is not set — bot will not start.\n');
    return null;
  }

  const bot = new Telegraf(BOT_TOKEN);

  // ── Middlewares ──────────────────────────────────────────────
  bot.use(globalMiddleware);
  bot.use(messageTrackingMiddleware);

  // ── Handlers ─────────────────────────────────────────────────
  setupDeveloper(bot);
  setupGroupHandlers(bot);
  setupOwnerHandlers(bot);
  setupAdminHandlers(bot);

  // ── /id ──────────────────────────────────────────────────────
  bot.command('id', async (ctx) => {
    const chatId = ctx.chat.id;
    const userId = ctx.from?.id;
    await ctx.replyWithMarkdown(
      `🆔 *معرّفات*\n\n💬 الشات: \`${chatId}\`\n👤 المستخدم: \`${userId}\``
    );
  });

  // ── /ping ────────────────────────────────────────────────────
  bot.command('ping', async (ctx) => {
    const start = Date.now();
    const msg   = await ctx.reply('🏓 ...');
    const diff  = Date.now() - start;
    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `🏓 *Pong!*\n\n⚡ \`${diff}ms\``, { parse_mode: 'Markdown' });
  });

  // ── /save ────────────────────────────────────────────────────
  bot.command('save', async (ctx) => {
    if (ctx.from?.id !== DEVELOPER_ID) return;
    db.saveData();
    await ctx.reply('✅ تم حفظ البيانات!');
  });

  // ── Error handler ────────────────────────────────────────────
  bot.catch((err, ctx) => {
    process.stderr.write(`[bot] Error for ${ctx?.updateType}: ${err.message}\n`);
  });

  // ── Webhook or Polling ────────────────────────────────────────
  const webhookHost = process.env['RENDER_EXTERNAL_URL'] || process.env['WEBHOOK_HOST'];
  if (webhookHost && app) {
    const SECRET_PATH = `/webhook/${BOT_TOKEN.replace(':', '_')}`;
    app.use(bot.webhookCallback(SECRET_PATH));
    const fullUrl = `${webhookHost.replace(/\/$/, '')}${SECRET_PATH}`;
    await bot.telegram.setWebhook(fullUrl);
    process.stdout.write(`[bot] Webhook set: ${fullUrl}\n`);
  } else {
    bot.launch({ dropPendingUpdates: true });
    process.stdout.write('[bot] Polling started (جامعة v4.0)\n');
  }

  process.once('SIGINT',  () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));

  if (DEVELOPER_ID) {
    try {
      await bot.telegram.sendMessage(DEVELOPER_ID,
        `🤖 *جامعة v4.0* — تم التشغيل!\n\n📅 ${new Date().toLocaleString('ar')}`,
        { parse_mode: 'Markdown' }
      );
    } catch {}
  }

  return bot;
}
