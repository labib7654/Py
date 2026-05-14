// ============================================================
//  نقطة البداية الرئيسية — البوت + السيرفر
// ============================================================

require('dotenv').config();

const { Telegraf }  = require('telegraf');
const express       = require('express');
const { BOT_TOKEN, DEVELOPER_ID, PORT, RENDER_EXTERNAL_URL, WEBHOOK_PATH } = require('./config');
const { globalMiddleware } = require('./middleware');
const { setupDeveloper, setupGroupHandlers, setupAdminHandlers } = require('./handlers');

console.log(`✅ البوت جاهز — المطور: ${DEVELOPER_ID}`);

// ── إنشاء البوت ─────────────────────────────────────────────
const bot = new Telegraf(BOT_TOKEN);
const app = express();

// ── Middleware ───────────────────────────────────────────────
bot.use(globalMiddleware);

// ── تسجيل جميع المعالجات ────────────────────────────────────
setupDeveloper(bot);
setupGroupHandlers(bot);
setupAdminHandlers(bot);

// ── معالجة الأخطاء ──────────────────────────────────────────
bot.catch((err, ctx) => {
  console.error(`[BOT ERROR] update_id=${ctx.update.update_id}:`, err.message);
});

// ── التشغيل ─────────────────────────────────────────────────
async function main() {
  if (RENDER_EXTERNAL_URL) {
    // ══ وضع Webhook (Render / خادم حقيقي) ══
    const webhookUrl = `${RENDER_EXTERNAL_URL}${WEBHOOK_PATH}`;

    try {
      await bot.telegram.setWebhook(webhookUrl, {
        allowed_updates: ['message', 'callback_query', 'my_chat_member', 'chat_member'],
      });
      console.log(`✅ Webhook مُعيَّن على: ${webhookUrl}`);
    } catch (err) {
      console.error('❌ فشل إعداد Webhook:', err.message);
    }

    // مسار الـ webhook لاستقبال التحديثات من تيليغرام
    app.use(WEBHOOK_PATH, express.raw({ type: 'application/json' }), bot.webhookCallback(WEBHOOK_PATH));

    // مسار صحة السيرفر (health check)
    app.get('/health', (req, res) => res.json({ status: 'ok', mode: 'webhook', uptime: process.uptime() }));

    app.listen(PORT, () => {
      console.log(`🚀 السيرفر يعمل على المنفذ ${PORT} [وضع: webhook]`);
    });

    // Ping ذاتي كل 14 دقيقة لمنع النوم (Render Free Plan)
    setInterval(async () => {
      try {
        await fetch(`${RENDER_EXTERNAL_URL}/health`);
        console.log('[KEEP-ALIVE] ping ✓');
      } catch { }
    }, 14 * 60 * 1000);

  } else {
    // ══ وضع Polling (التطوير المحلي) ══
    await bot.telegram.deleteWebhook({ drop_pending_updates: true });
    console.log('🔄 Webhook محذوف، بدء Polling...');

    const startPolling = (retries = 0) => {
      bot.launch({
        allowedUpdates: ['message', 'callback_query', 'my_chat_member', 'chat_member'],
      }).catch((err) => {
        if (err.message && err.message.includes('409') && retries < 5) {
          console.warn(`⚠️ تعارض (409)، إعادة المحاولة ${retries + 1}/5 بعد 5 ثوانٍ...`);
          setTimeout(() => startPolling(retries + 1), 5000);
        } else {
          console.error('❌ فشل البوت:', err.message);
        }
      });
    };

    startPolling();
    console.log(`✅ البوت يعمل في وضع Polling`);
    console.log(`👨‍💻 معرف المطور: ${DEVELOPER_ID}`);

    // health check بسيط محلياً
    app.get('/health', (req, res) => res.json({ status: 'ok', mode: 'polling', uptime: process.uptime() }));
    app.listen(PORT, () => console.log(`🚀 السيرفر يعمل على المنفذ ${PORT}`));
  }

  process.once('SIGINT',  () => { console.log('🛑 إيقاف البوت...'); bot.stop('SIGINT');  process.exit(0); });
  process.once('SIGTERM', () => { console.log('🛑 إيقاف البوت...'); bot.stop('SIGTERM'); process.exit(0); });
}

main().catch((err) => {
  console.error('❌ خطأ فادح:', err.message);
  process.exit(1);
});
