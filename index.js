// ============================================================
//  نقطة البداية — البوت بوضع Polling دائماً
// ============================================================

require('dotenv').config();

const { Telegraf } = require('telegraf');
const express      = require('express');
const { BOT_TOKEN, DEVELOPER_ID, PORT } = require('./config');
const { globalMiddleware }              = require('./middleware');
const { setupDeveloper, setupGroupHandlers, setupAdminHandlers } = require('./handlers');

console.log(`🚀 جاري تشغيل البوت...`);
console.log(`👨‍💻 معرف المطور: ${DEVELOPER_ID}`);

// ── البوت ────────────────────────────────────────────────────
const bot = new Telegraf(BOT_TOKEN);
const app = express();

bot.use(globalMiddleware);
setupDeveloper(bot);
setupGroupHandlers(bot);
setupAdminHandlers(bot);

bot.catch((err, ctx) => {
  console.error(`[خطأ] update_id=${ctx.update.update_id}:`, err.message);
});

// ── السيرفر (للـ health check فقط) ──────────────────────────
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: 'ok', bot: 'running', mode: 'polling', uptime: process.uptime() });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.listen(PORT, () => {
  console.log(`🌐 السيرفر يعمل على المنفذ ${PORT}`);
});

// ── تشغيل البوت بوضع Polling ─────────────────────────────────
async function startBot(retries = 0) {
  try {
    // حذف أي webhook قديم أولاً
    await bot.telegram.deleteWebhook({ drop_pending_updates: true });
    console.log('✅ تم حذف Webhook القديم');

    bot.launch({
      allowedUpdates: ['message', 'callback_query', 'my_chat_member', 'chat_member'],
    });
    console.log('✅ البوت يعمل الآن بوضع Polling!');

  } catch (err) {
    if (err.message && err.message.includes('409') && retries < 10) {
      console.warn(`⚠️ تعارض، إعادة المحاولة ${retries + 1}/10 بعد 5 ثوانٍ...`);
      setTimeout(() => startBot(retries + 1), 5000);
    } else {
      console.error('❌ فشل تشغيل البوت:', err.message);
      process.exit(1);
    }
  }
}

startBot();

// ── إيقاف نظيف ───────────────────────────────────────────────
process.once('SIGINT',  () => { bot.stop('SIGINT');  process.exit(0); });
process.once('SIGTERM', () => { bot.stop('SIGTERM'); process.exit(0); });
