// ============================================================
//  نقطة البداية — البوت بوضع Polling دائماً
//  النسخة المحدّثة: مع مزامنة محسّنة وإعادة تشغيل تلقائية
// ============================================================

require('dotenv').config();

const { Telegraf } = require('telegraf');
const express      = require('express');
const { BOT_TOKEN, DEVELOPER_ID, PORT } = require('./config');
const { globalMiddleware }              = require('./middleware');
const db = require('./db');
const {
  setupDeveloper,
  setupGroupHandlers,
  setupAdminHandlers,
} = require('./handlers');

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN غير موجود في ملف .env!');
  process.exit(1);
}
if (!DEVELOPER_ID) {
  console.error('❌ DEVELOPER_ID غير موجود في ملف .env!');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const app = express();

app.use(express.json());

// ── صفحات الصحة ──────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status:  'ok',
    bot:     'running',
    mode:    'polling',
    uptime:  `${Math.floor(process.uptime())}s`,
    memory:  `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
    db:      db.useSupabase() ? 'supabase' : 'local_file',
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// ── مزامنة القروبات والقنوات الموجودة عند التشغيل ────────────
async function syncExistingChats() {
  const groups = await db.allGroups();
  if (!groups.length) return;
  console.log(`🔄 مزامنة ${groups.length} مجموعة/قناة محفوظة...`);

  let synced = 0, removed = 0;

  for (const g of groups) {
    try {
      // تحديث عنوان المجموعة
      const chat = await bot.telegram.getChat(g.chatId);
      if (chat.title && chat.title !== g.title) {
        await db.updateGroup(g.chatId, { title: chat.title });
      }

      // مزامنة المشرفين (لا تعمل مع القنوات العامة)
      try {
        const admins = await bot.telegram.getChatAdministrators(g.chatId);
        for (const a of admins) {
          if (a.user.is_bot) continue;
          if (a.status === 'creator') {
            await db.updateGroup(g.chatId, {
              ownerId:       a.user.id,
              ownerUsername: a.user.username || a.user.first_name || String(a.user.id),
            });
            await db.trackMember(g.chatId, a.user.id, a.user.username || '', a.user.first_name || '', 'owner');
          } else if (a.status === 'administrator') {
            await db.addAdmin(g.chatId, a.user.id,
              a.user.username || a.user.first_name || String(a.user.id), 0, 'telegram');
            await db.trackMember(g.chatId, a.user.id, a.user.username || '', a.user.first_name || '', 'admin');
          }
        }
      } catch { /* قنوات بدون وصول للمشرفين */ }

      synced++;
    } catch (e) {
      // البوت تم طرده أو المجموعة محذوفة
      if (e.message && (
        e.message.includes('kicked') ||
        e.message.includes('not found') ||
        e.message.includes('deactivated') ||
        e.message.includes('chat not found')
      )) {
        await db.deleteGroup(g.chatId);
        removed++;
      }
    }
  }

  console.log(`✅ المزامنة اكتملت: ${synced} نشطة، ${removed} محذوفة`);
}

// ── إرسال رسالة تشغيل للمطور ────────────────────────────────
async function notifyDeveloper() {
  if (!DEVELOPER_ID) return;
  try {
    const s = await db.getStats();
    await bot.telegram.sendMessage(
      DEVELOPER_ID,
      `🤖 *البوت بدأ التشغيل*\n\n` +
      `📊 المجموعات: \`${s.totalGroups}\`\n` +
      `👤 المستخدمون: \`${s.totalUsers}\`\n` +
      `🗄️ DB: ${db.useSupabase() ? 'Supabase ✅' : 'ملف محلي ⚠️'}\n` +
      `🕐 ${new Date().toLocaleString('ar-SA')}`,
      { parse_mode: 'Markdown' }
    );
  } catch { /* إذا حظر المطور البوت لا نتوقف */ }
}

// ── تشغيل البوت بوضع Polling ─────────────────────────────────
const ALLOWED_UPDATES = [
  'message',
  'callback_query',
  'my_chat_member',
  'chat_member',
  'chat_join_request',
  'channel_post',
  'edited_channel_post',
];

async function startBot() {
  let attempt = 0;

  while (attempt < 15) {
    try {
      await bot.telegram.deleteWebhook({ drop_pending_updates: true });

      // أوقف أي polling سابق
      try { bot.stop(); } catch { }

      // انتظر انتهاء الجلسة القديمة
      await new Promise(r => setTimeout(r, 2000));

      await bot.launch({ allowedUpdates: ALLOWED_UPDATES });
      console.log('✅ البوت يعمل الآن بوضع Polling!');
      return;
    } catch (err) {
      if (err.message?.includes('409') || err.message?.includes('Conflict')) {
        attempt++;
        const wait = Math.min(15_000 + attempt * 5_000, 60_000);
        console.warn(`⚠️ تعارض 409 — المحاولة ${attempt}/15 بعد ${wait / 1000}ث...`);
        console.warn('   تأكد أنه لا توجد نسخة أخرى من البوت تعمل.');
        await new Promise(r => setTimeout(r, wait));
      } else {
        console.error('❌ فشل تشغيل البوت:', err.message);
        process.exit(1);
      }
    }
  }

  console.error('❌ فشل الاتصال بعد 15 محاولة. البوت يعمل في مكان آخر بنفس التوكن.');
  process.exit(1);
}

// ── نقطة التشغيل الرئيسية ───────────────────────────────────
async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🤖 بوت إدارة المجتمعات الجامعية');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`👨‍💻 معرف المطور: ${DEVELOPER_ID}`);
  console.log(`🌐 المنفذ: ${PORT}`);

  // تهيئة قاعدة البيانات
  await db.initDB();

  // ربط الـ middleware
  bot.use(globalMiddleware);

  // تسجيل الـ handlers بالترتيب الصحيح
  setupDeveloper(bot);       // 1. لوحة المطور
  setupGroupHandlers(bot);   // 2. أحداث المجموعات
  setupAdminHandlers(bot);   // 3. أوامر الإدارة

  // معالجة الأخطاء العامة
  bot.catch((err, ctx) => {
    const uid = ctx?.update?.update_id || '?';
    const msg = err?.message || String(err);

    // تجاهل أخطاء شائعة غير خطيرة
    if (
      msg.includes('message is not modified') ||
      msg.includes('query is too old') ||
      msg.includes('message to delete not found') ||
      msg.includes('bot was blocked')
    ) return;

    console.error(`[خطأ] update_id=${uid}: ${msg}`);
  });

  // تشغيل السيرفر
  app.listen(PORT, () => {
    console.log(`🌐 السيرفر يعمل على المنفذ ${PORT}`);
  });

  // تشغيل البوت
  await startBot();

  // مزامنة المجموعات بعد 5 ثوانٍ
  setTimeout(() => {
    syncExistingChats().catch(e => console.error('⚠️ خطأ في المزامنة:', e.message));
  }, 5_000);

  // إبلاغ المطور بعد 8 ثوانٍ (بعد المزامنة)
  setTimeout(() => {
    notifyDeveloper().catch(() => {});
  }, 8_000);
}

main().catch(err => {
  console.error('❌ خطأ فادح:', err.message);
  process.exit(1);
});

process.once('SIGINT',  () => { console.log('\n🛑 إيقاف البوت...'); bot.stop('SIGINT');  process.exit(0); });
process.once('SIGTERM', () => { console.log('\n🛑 إيقاف البوت...'); bot.stop('SIGTERM'); process.exit(0); });
