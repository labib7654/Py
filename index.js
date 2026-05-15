// ============================================================
//  نقطة البداية — جامعة v5.0
//  Webhook تلقائي على Render، Polling محلياً
//  + Supabase persistent storage
//  + Scheduler للقيود المنتهية
// ============================================================

require('dotenv').config();

const { Telegraf }   = require('telegraf');
const { BOT_TOKEN, DEVELOPER_ID, PORT } = require('./config');
const db             = require('./db');
const supa           = require('./supabase');
const { globalMiddleware, messageTrackingMiddleware } = require('./middleware');
const setupDeveloper     = require('./handler_developer');
const setupGroupHandlers = require('./handler_groups');
const setupAdminHandlers = require('./handler_admin');
const { setupOwnerHandlers } = require('./handler_owner');

if (!BOT_TOKEN)    { console.error('❌ BOT_TOKEN غير موجود!');    process.exit(1); }
if (!DEVELOPER_ID) { console.error('❌ DEVELOPER_ID غير موجود!'); process.exit(1); }
if (!process.env.SUPABASE_URL) { console.warn('⚠️ SUPABASE_URL غير موجود — التخزين سيكون في الذاكرة فقط!'); }

console.log('🚀 جاري تشغيل البوت — جامعة v5.0...');
console.log(`👨‍💻 معرف المطور: ${DEVELOPER_ID}`);

// ── تحميل البيانات من Supabase ───────────────────────────────
db.loadData().then(() => {
  console.log('✅ قاعدة البيانات جاهزة');
}).catch(e => {
  console.error('❌ خطأ في تحميل البيانات:', e.message);
});

const bot = new Telegraf(BOT_TOKEN);

// ── allowed_updates شاملة ─────────────────────────────────────
const ALLOWED_UPDATES = [
  'message',
  'edited_message',
  'callback_query',
  'my_chat_member',
  'chat_member',
  'chat_join_request',
  'channel_post',
];

// ── Middleware ─────────────────────────────────────────────────
bot.use(globalMiddleware);
bot.use(messageTrackingMiddleware);

// ── Handlers ───────────────────────────────────────────────────
setupDeveloper(bot);
setupGroupHandlers(bot);
setupAdminHandlers(bot);
setupOwnerHandlers(bot);

// ── Scheduler: رفع تلقائي للقيود المنتهية كل 60 ثانية ────────
setInterval(async () => {
  try {
    const expired = await supa.getExpiredRestrictions();
    if (!expired.length) return;
    console.log(`⏰ معالجة ${expired.length} قيد منتهٍ...`);
    for (const r of expired) {
      try {
        if (r.type === 'timed_mute') {
          await bot.telegram.restrictChatMember(r.chat_id, r.user_id, {
            permissions: {
              can_send_messages:         true,
              can_send_audios:           true,
              can_send_documents:        true,
              can_send_photos:           true,
              can_send_videos:           true,
              can_send_video_notes:      true,
              can_send_voice_notes:      true,
              can_send_polls:            true,
              can_send_other_messages:   true,
              can_add_web_page_previews: true,
            },
          });
          // تحديث الكاش
          const g = await db.getGroup(r.chat_id);
          if (g) { g.mutedUsers.delete(r.user_id); g.timedMutes?.delete(r.user_id); }
        } else if (r.type === 'timed_ban') {
          await bot.telegram.unbanChatMember(r.chat_id, r.user_id);
          const g = await db.getGroup(r.chat_id);
          if (g) { g.bannedUsers.delete(r.user_id); g.timedBans?.delete(r.user_id); }
        }
        await supa.removeRestriction(r.chat_id, r.user_id, r.type);
        await supa.addAuditLog(r.chat_id, '⏰ رفع تلقائي', 0, 'bot', r.user_id, '', `انتهاء مدة ${r.type}`);
        console.log(`✅ تم رفع ${r.type} عن ${r.user_id} في ${r.chat_id}`);
      } catch (e) {
        console.error(`❌ فشل رفع ${r.type} عن ${r.user_id}:`, e.message);
      }
    }
  } catch (e) {
    console.error('❌ خطأ في scheduler القيود:', e.message);
  }
}, 60 * 1000);

// ── Scheduler: مزامنة دورية مع Supabase كل 30 دقيقة ──────────
setInterval(async () => {
  console.log('🔄 مزامنة دورية مع Supabase...');
  const groups = db.allGroups();
  for (const g of groups) {
    db.scheduleSync(g);
  }
}, 30 * 60 * 1000);

// ── معالج callback_query عام ──────────────────────────────────
bot.on('callback_query', async (ctx) => {
  try { await ctx.answerCbQuery(); } catch {}
});

// ── أوامر عامة مفيدة ──────────────────────────────────────────
bot.command('id', async (ctx) => {
  const chatInfo   = `🆔 Chat ID: \`${ctx.chat.id}\`\n👤 User ID: \`${ctx.from.id}\``;
  const target     = ctx.message.reply_to_message?.from;
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

bot.command('rules', async (ctx) => {
  if (ctx.chat.type === 'private') return;
  const g = await db.getGroup(ctx.chat.id);
  if (!g?.rules) return ctx.reply('📋 لا توجد قواعد محددة بعد.\n\nاستخدم /setrules لتعيين القواعد.');
  await ctx.replyWithMarkdown(`📋 *قواعد ${ctx.chat.title}*\n\n${g.rules}`);
});

// ── 5️⃣ مزامنة بيانات المجموعات عند بدء التشغيل ───────────────
async function syncBotChats(botInfo) {
  const groups = db.allGroups();
  if (!groups.length) return;
  console.log(`🔄 مزامنة ${groups.length} مجموعة...`);
  let updated = 0, removed = 0;
  for (const g of groups) {
    const chatId = g.chatId || g.chat_id;
    try {
      const member = await bot.telegram.getChatMember(chatId, botInfo.id);
      if (member.status === 'left' || member.status === 'kicked') {
        await db.deleteGroup(chatId);
        removed++;
      } else {
        try {
          const admins = await bot.telegram.getChatAdministrators(chatId);
          const owner  = admins.find(a => a.status === 'creator');
          if (owner) {
            g.ownerId      = owner.user.id;
            g.ownerUsername = owner.user.username || owner.user.first_name;
            db.scheduleSync(g);
          }
          updated++;
        } catch {}
      }
    } catch {}
    await new Promise(r => setTimeout(r, 300));
  }
  console.log(`✅ تم تحديث ${updated} مجموعة، إزالة ${removed} مجموعة غير نشطة`);
}

// ── معالج الأخطاء ─────────────────────────────────────────────
bot.catch((err, ctx) => {
  console.error(`[خطأ] update_id=${ctx.update?.update_id}:`, err.message);
});

// ── Webhook / Polling ──────────────────────────────────────────
const RENDER_URL = process.env.RENDER_EXTERNAL_URL;

if (RENDER_URL) {
  const express        = require('express');
  const app            = express();
  const WEBHOOK_PATH   = `/webhook/${BOT_TOKEN}`;
  const WEBHOOK_URL    = `${RENDER_URL}${WEBHOOK_PATH}`;

  app.use(express.json());
  app.get('/', (req, res) => res.json({ status: 'ok', bot: 'جامعة v5.0', uptime: process.uptime() }));
  app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));
  app.use(bot.webhookCallback(WEBHOOK_PATH));

  app.listen(PORT, async () => {
    console.log(`🌐 السيرفر يعمل على المنفذ ${PORT}`);
    try {
      await bot.telegram.setWebhook(WEBHOOK_URL, {
        allowed_updates:      ALLOWED_UPDATES,
        drop_pending_updates: true,
      });
      console.log(`✅ Webhook مفعّل: ${WEBHOOK_URL}`);
      const botInfo = await bot.telegram.getMe();
      console.log(`✅ البوت يعمل الآن بوضع Webhook: @${botInfo.username}`);
      setTimeout(() => syncBotChats(botInfo).catch(console.error), 5000);
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
  async function startPolling(retries = 0) {
    try {
      await bot.telegram.deleteWebhook({ drop_pending_updates: true });
      console.log('✅ تم حذف Webhook القديم');
      await bot.launch({
        allowedUpdates:     ALLOWED_UPDATES,
        dropPendingUpdates: true,
      });
      const botInfo = await bot.telegram.getMe();
      console.log(`✅ البوت يعمل الآن بوضع Polling: @${botInfo.username}`);
      setTimeout(() => syncBotChats(botInfo).catch(console.error), 5000);
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
