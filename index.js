// ============================================================
//  نقطة البداية — جامعة v4.0
//  Webhook تلقائي على Render، Polling محلياً
// ============================================================

require('dotenv').config();

const { Telegraf }   = require('telegraf');
const express        = require('express');
const { BOT_TOKEN, DEVELOPER_ID, PORT } = require('./config');
const { globalMiddleware, messageTrackingMiddleware } = require('./middleware');
const setupDeveloper     = require('./handler_developer');
const setupGroupHandlers = require('./handler_groups');
const setupAdminHandlers = require('./handler_admin');
const setupOwnerHandlers = require('./handler_owner');

const db = require('./db');

if (!BOT_TOKEN)    { console.error('❌ BOT_TOKEN غير موجود!');    process.exit(1); }
if (!DEVELOPER_ID) { console.error('❌ DEVELOPER_ID غير موجود!'); process.exit(1); }

console.log('🚀 جاري تشغيل البوت — جامعة v4.0...');
console.log(`👨‍💻 معرف المطور: ${DEVELOPER_ID}`);

const bot = new Telegraf(BOT_TOKEN);
const app = express();

// ── allowed_updates شاملة ─────────────────────────────────
const ALLOWED_UPDATES = [
  'message',
  'edited_message',
  'callback_query',
  'my_chat_member',
  'chat_member',
  'chat_join_request',
  'channel_post',
];

// ── Middleware ────────────────────────────────────────────
bot.use(globalMiddleware);
bot.use(messageTrackingMiddleware);

// ── Handlers ──────────────────────────────────────────────
setupDeveloper(bot);
setupGroupHandlers(bot);
setupAdminHandlers(bot);
setupOwnerHandlers(bot);

// ── معالج callback_query عام (يمنع timeout على أزرار غير معالَجة) ──
bot.on('callback_query', async (ctx) => {
  try { await ctx.answerCbQuery(); } catch {}
});

// ── أوامر عامة مفيدة ─────────────────────────────────────

bot.command('id', async (ctx) => {
  const chatInfo  = `🆔 Chat ID: \`${ctx.chat.id}\`\n👤 User ID: \`${ctx.from.id}\``;
  const target    = ctx.message.reply_to_message?.from;
  const targetInfo = target
    ? `\n👥 المستهدف: \`${target.id}\` (${target.username ? `@${target.username}` : target.first_name})`
    : '';
  await ctx.replyWithMarkdown(chatInfo + targetInfo);
});

bot.command('ping', async (ctx) => {
  const start = Date.now();
  const msg   = await ctx.reply('🏓 Pong...');
  const ms    = Date.now() - start;
  await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, `🏓 Pong! \`${ms}ms\``, { parse_mode: 'Markdown' });
});

// ── مزامنة بيانات المجموعات عند بدء التشغيل ─────────────────
async function syncBotChats(botId) {
  const groups = db.allGroups();
  if (!groups.length) return;
  console.log(`🔄 مزامنة ${groups.length} مجموعة...`);
  let synced = 0, removed = 0;
  for (const g of groups) {
    try {
      const member = await bot.telegram.getChatMember(g.chatId, botId);
      if (member.status === 'left' || member.status === 'kicked') {
        db.deleteGroup(g.chatId);
        removed++;
        continue;
      }
      // تحديث بيانات المالك
      try {
        const admins = await bot.telegram.getChatAdministrators(g.chatId);
        const owner  = admins.find(a => a.status === 'creator');
        if (owner) {
          g.ownerId       = owner.user.id;
          g.ownerUsername = owner.user.username || owner.user.first_name || String(owner.user.id);
        }
      } catch {}
      synced++;
    } catch {
      // خطأ في جلب البيانات — نتجاوز هذه المجموعة
    }
  }
  console.log(`✅ تمت المزامنة: ${synced} نشطة، ${removed} محذوفة`);
}

// ── معالج الأخطاء ─────────────────────────────────────────
bot.catch((err, ctx) => {
  console.error(`[خطأ] update_id=${ctx.update?.update_id}:`, err.message);
});

// ── Express ───────────────────────────────────────────────
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: 'ok', bot: 'جامعة v4.0', uptime: process.uptime() });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// ── Webhook / Polling ─────────────────────────────────────
const RENDER_URL = process.env.RENDER_EXTERNAL_URL;

if (RENDER_URL) {
  // وضع Webhook على Render
  const WEBHOOK_PATH = `/webhook/${BOT_TOKEN}`;
  const WEBHOOK_URL  = `${RENDER_URL}${WEBHOOK_PATH}`;

  app.use(bot.webhookCallback(WEBHOOK_PATH));

  app.listen(PORT, async () => {
    console.log(`🌐 السيرفر يعمل على المنفذ ${PORT}`);
    try {
      await bot.telegram.setWebhook(WEBHOOK_URL, {
        allowed_updates:      ALLOWED_UPDATES,
        drop_pending_updates: true,
      });
      console.log(`✅ Webhook مفعّل: ${WEBHOOK_URL}`);
      console.log('✅ البوت يعمل الآن بوضع Webhook!');
      // مزامنة البيانات في الخلفية بعد 5 ثواني
      const botInfo = await bot.telegram.getMe();
      setTimeout(() => syncBotChats(botInfo.id).catch(console.error), 5000);
    } catch (err) {
      console.error('❌ فشل تعيين Webhook:', err.message);
    }
  });

  // Keep-Alive كل 14 دقيقة
  setInterval(async () => {
    try {
      const res  = await fetch(`${RENDER_URL}/health`);
      const data = await res.json();
      console.log(`🏓 Keep-alive — uptime: ${Math.floor(data.uptime)}s`);
    } catch (e) {
      console.warn('⚠️ Keep-alive فشل:', e.message);
    }
  }, 14 * 60 * 1000);
  console.log(`🔁 Keep-alive مفعّل → ${RENDER_URL}/health`);

} else {
  // وضع Polling محلياً
  app.listen(PORT, () => {
    console.log(`🌐 السيرفر يعمل على المنفذ ${PORT}`);
  });

  async function startPolling(retries = 0) {
    try {
      await bot.telegram.deleteWebhook({ drop_pending_updates: true });
      console.log('✅ تم حذف Webhook القديم');
      await bot.launch({
        allowedUpdates:      ALLOWED_UPDATES,
        dropPendingUpdates:  true,
      });
      console.log('✅ البوت يعمل الآن بوضع Polling!');
      // مزامنة البيانات في الخلفية بعد 5 ثواني
      const botInfo = await bot.telegram.getMe();
      setTimeout(() => syncBotChats(botInfo.id).catch(console.error), 5000);
    } catch (err) {
      if (err.message?.includes('409') && retries < 5) {
        console.warn(`⚠️ تعارض — إعادة المحاولة ${retries + 1}/5 بعد 5 ثوانٍ...`);
        setTimeout(() => startPolling(retries + 1), 5000);
      } else {
        console.error('❌ فشل تشغيل البوت:', err.message);
        process.exit(1);
      }
    }
  }

  startPolling();

  process.once('SIGINT',  () => { bot.stop('SIGINT');  process.exit(0); });
  process.once('SIGTERM', () => { bot.stop('SIGTERM'); process.exit(0); });
}
