// ============================================================
//  نقطة البداية — جميع الملفات في نفس المجلد بدون مجلدات فرعية
// ============================================================

require('dotenv').config();

const { Telegraf } = require('telegraf');
const express      = require('express');
const { BOT_TOKEN, DEVELOPER_ID, PORT } = require('./config');
const { globalMiddleware }               = require('./middleware');
const setupDeveloper    = require('./handler_developer');
const setupGroupHandlers = require('./handler_groups');
const setupAdminHandlers = require('./handler_admin');
const setupOwnerHandlers = require('./handler_owner');

if (!BOT_TOKEN)    { console.error('❌ BOT_TOKEN غير موجود في المتغيرات البيئية!'); process.exit(1); }
if (!DEVELOPER_ID) { console.error('❌ DEVELOPER_ID غير موجود في المتغيرات البيئية!'); process.exit(1); }

console.log('🚀 جاري تشغيل البوت...');
console.log(`👨‍💻 معرف المطور: ${DEVELOPER_ID}`);

// ── البوت ─────────────────────────────────────────────────────
const bot = new Telegraf(BOT_TOKEN);
const app = express();

bot.use(globalMiddleware);

// الترتيب مهم: المطور أولاً ثم الأحداث ثم الأوامر
setupDeveloper(bot);
setupGroupHandlers(bot);
setupAdminHandlers(bot);
setupOwnerHandlers(bot);

bot.catch((err, ctx) => {
  console.error(`[خطأ] update_id=${ctx.update?.update_id}:`, err.message);
});

// ── السيرفر ───────────────────────────────────────────────────
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

// ── Keep-Alive: يمنع Render من إيقاف السيرفر بعد 15 دقيقة ────
const RENDER_URL = process.env.RENDER_EXTERNAL_URL;
if (RENDER_URL) {
  setInterval(async () => {
    try {
      const res  = await fetch(`${RENDER_URL}/health`);
      const data = await res.json();
      console.log(`🏓 Keep-alive ping — uptime: ${Math.floor(data.uptime)}s`);
    } catch (e) {
      console.warn('⚠️ Keep-alive ping فشل:', e.message);
    }
  }, 14 * 60 * 1000); // كل 14 دقيقة
  console.log(`🔁 Keep-alive مفعّل → ${RENDER_URL}/health`);
}

// ── تشغيل البوت ───────────────────────────────────────────────
async function startBot(retries = 0) {
  try {
    await bot.telegram.deleteWebhook({ drop_pending_updates: true });
    console.log('✅ تم حذف Webhook القديم');

    await bot.launch({
      allowedUpdates: [
        'message',
        'callback_query',
        'my_chat_member',
        'chat_member',
        'chat_join_request',
      ],
    });
    console.log('✅ البوت يعمل الآن بوضع Polling!');

  } catch (err) {
    if (err.message?.includes('409') && retries < 10) {
      console.warn(`⚠️ تعارض — إعادة المحاولة ${retries + 1}/10 بعد 5 ثوانٍ...`);
      setTimeout(() => startBot(retries + 1), 5000);
    } else {
      console.error('❌ فشل تشغيل البوت:', err.message);
      process.exit(1);
    }
  }
}

startBot();

process.once('SIGINT',  () => { bot.stop('SIGINT');  process.exit(0); });
process.once('SIGTERM', () => { bot.stop('SIGTERM'); process.exit(0); });
