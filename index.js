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
const setupBotAdmins     = require('./handler_bot_admins');
const setupBioVerify     = require('./handler_bio_verify');
const setupTopicHandlers = require('./handler_topics');
const setupGroupHandlers = require('./handler_groups');
const setupAdminHandlers = require('./handler_admin');
const setupOwnerHandlers = require('./handler_owner');
const setupRadar         = require('./handler_radar');
const setupAdder  
       = require('./handler_adder');
const setupAI = require('./handler_ai');
const setupVerifyRegistration = require('./verify_registration');
const setupVerifyActions       = require('./verify_actions');
const db = require('./db');

if (!BOT_TOKEN)    { console.error('❌ BOT_TOKEN غير موجود!');    process.exit(1); }
if (!DEVELOPER_ID) { console.error('❌ DEVELOPER_ID غير موجود!'); process.exit(1); }

// ── Hardening: لا نسمح للـ process يسكت عن أخطاء غير معالجة ─────────
process.on('unhandledRejection', (reason) => {
  console.error('❌ unhandledRejection:', reason?.message || reason);
});
process.on('uncaughtException', (err) => {
  console.error('❌ uncaughtException:', err?.message || err);
});

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

// ── مزامنة بيانات المجموعات عند بدء التشغيل ─────────────────
async function syncBotChats(bot, botId) {
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
      try {
        const admins = await bot.telegram.getChatAdministrators(g.chatId);
        const owner  = admins.find(a => a.status === 'creator');
        if (owner) {
          g.ownerId       = owner.user.id;
          g.ownerUsername = owner.user.username || owner.user.first_name || String(owner.user.id);
        }
      } catch {}
      synced++;
    } catch {}
  }
  console.log(`✅ تمت المزامنة: ${synced} نشطة، ${removed} محذوفة`);
}

function normalizeExternalUrl(url) {
  if (!url) return '';
  const s = String(url).trim();
  if (!s) return '';
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

function getRenderExternalUrl() {
  // Render غالباً يوفر RENDER_EXTERNAL_URL، وبعض البيئات توفر فقط hostname
  const direct = normalizeExternalUrl(process.env.RENDER_EXTERNAL_URL);
  if (direct) return direct;
  const host = (process.env.RENDER_EXTERNAL_HOSTNAME || process.env.RENDER_EXTERNAL_HOST || '').trim();
  if (host) return normalizeExternalUrl(`https://${host}`);
  return '';
}

function isRenderRuntime() {
  // لا نعتمد على متغير واحد فقط لأن بعض الإعدادات لا تمرره
  if (process.env.RENDER === 'true') return true;
  if (process.env.RENDER_SERVICE_ID) return true;
  if (process.env.RENDER_INSTANCE_ID) return true;
  if (process.env.RENDER_REGION) return true;
  if (process.env.RENDER_GIT_REPO_SLUG) return true;
  if (process.env.RENDER_EXTERNAL_URL) return true;
  if (process.env.RENDER_EXTERNAL_HOSTNAME) return true;
  return false;
}

// ══════════════════════════════════════════════════════════════
//  نقطة الدخول الرئيسية — ننتظر تحميل البيانات أولاً
// ══════════════════════════════════════════════════════════════
async function main() {
  console.log('🚀 جاري تشغيل البوت — جامعة v4.0...');
  console.log(`👨‍💻 معرف المطور: ${DEVELOPER_ID}`);

  // ✅ انتظر تحميل البيانات من GitHub قبل أي شيء
  console.log('⏳ جاري تحميل البيانات...');
  await db.waitReady();
  console.log('✅ البيانات جاهزة، يبدأ البوت الآن...');

  const bot = new Telegraf(BOT_TOKEN);
  const app = express();

  // ── Middleware ────────────────────────────────────────────
  bot.use(globalMiddleware);
  bot.use(messageTrackingMiddleware);

  // ── Handlers ──────────────────────────────────────────────
  setupDeveloper(bot);
  setupBotAdmins(bot);       // ✅ نظام إدارة مشرفي البوت
  setupRadar(bot);           // ✅ رادار المستخدمين — يسجّل الجميع في كل مكان
  setupAdder(bot);
  setupAI(bot);             // ✅ نظام الذكاء الاصطناعي
  setupBioVerify(bot);      // ✅ يجب قبل setupGroupHandlers (يعترض chat_join_request أولاً)
  setupVerifyRegistration(bot);  // ✅ نظام التحقق الجامعي (join_request)
  setupVerifyActions(bot);       // ✅ قبول/رفض/تفاصيل
  setupTopicHandlers(bot);  // ✅ نظام طلبات المواضيع — يجب قبل setupGroupHandlers
  setupGroupHandlers(bot);
  setupAdminHandlers(bot);
  setupOwnerHandlers(bot);

  // ── معالج callback_query احتياطي (للأزرار غير المعروفة فقط) ──
  bot.action(/^cancel$/, async (ctx) => {
    try { await ctx.answerCbQuery(); } catch {}
    try { await ctx.deleteMessage(); } catch {}
  });

  // ── أوامر عامة ───────────────────────────────────────────
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

  // ── قبول تلقائي لطلبات الانضمام بعد 5 دقائق (يعمل في Webhook و Polling) ──
  function startAutoApproveInterval() {
    setInterval(async () => {
      const groups = db.allGroups();
      const now    = Date.now();
      for (const g of groups) {
        if (!g.autoApproveJoin || !g.joinRequestsEnabled) continue;
        const delay = ((g.autoApproveDelay ?? 300)) * 1000; // بالميلي ثانية
        const pending = [...g.joinRequests.values()].filter(r =>
          r.status === 'pending' && (now - new Date(r.requestedAt).getTime()) >= delay
        );
        for (const r of pending) {
          try {
            await bot.telegram.approveChatJoinRequest(g.chatId, r.userId);
            r.status = 'approved_auto';
            db.trackMember(g.chatId, r.userId, r.username || '', r.firstName || '', 'member');
            console.log(`🤖 قبول تلقائي: ${r.username || r.userId} في ${g.title}`);
          } catch (e) {
            if (e.message?.includes('USER_ALREADY_PARTICIPANT') || e.message?.includes('HIDE_REQUESTER_MISSING')) {
              r.status = 'approved_auto';
            } else {
              console.warn(`⚠️ فشل القبول التلقائي لـ ${r.userId} في ${g.title}:`, e.message);
            }
          }
        }
        if (pending.length > 0) db.saveData();
      }
    }, 60 * 1000);
    console.log('🤖 نظام القبول التلقائي مفعّل (فحص كل دقيقة) ✅');
  }

  // ── Webhook / Polling ─────────────────────────────────────
  const RENDER_URL = getRenderExternalUrl();
  const IS_RENDER  = isRenderRuntime();
  let server = null;

  if (RENDER_URL) {
    const WEBHOOK_PATH = `/webhook/${BOT_TOKEN}`;
    const WEBHOOK_URL  = `${RENDER_URL}${WEBHOOK_PATH}`;

    // نستقبل الـ update من Telegram ونمرره للبوت مباشرة
    app.post(WEBHOOK_PATH, express.json(), async (req, res) => {
      try {
        await bot.handleUpdate(req.body, res);
      } catch (e) {
        console.error('❌ خطأ في معالجة الـ update:', e.message);
        res.sendStatus(500);
      }
    });

    server = app.listen(PORT, async () => {
      console.log(`🌐 السيرفر يعمل على المنفذ ${PORT}`);

      // Retry تعيين Webhook بدل ما يشتغل السيرفر لحاله بدون بوت
      let attempt = 0;
      const setWebhookWithRetry = async () => {
        attempt++;
        try {
          await bot.telegram.setWebhook(WEBHOOK_URL, {
            allowed_updates:      ALLOWED_UPDATES,
            drop_pending_updates: true,
          });
          console.log(`✅ Webhook مفعّل: ${WEBHOOK_URL}`);
          console.log('✅ البوت يعمل الآن بوضع Webhook!');
          const botInfo = await bot.telegram.getMe();
          setTimeout(() => syncBotChats(bot, botInfo.id).catch(console.error), 5000);
          return;
        } catch (err) {
          const msg = err?.message || String(err);
          const delay = Math.min(120000, 2000 * Math.pow(2, Math.min(6, attempt - 1)));
          console.error(`❌ فشل تعيين Webhook (محاولة ${attempt}):`, msg);
          console.warn(`⏳ إعادة المحاولة بعد ${Math.ceil(delay / 1000)}s...`);
          setTimeout(setWebhookWithRetry, delay);
        }
      };

      setWebhookWithRetry();
    });

    startAutoApproveInterval(); // ✅ القبول التلقائي — يعمل في Webhook و Polling

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
    server = app.listen(PORT, () => {
      console.log(`🌐 السيرفر يعمل على المنفذ ${PORT}`);
    });

    // Polling محلياً. على Render بدون External URL نخلّيه resilient وما يطيح.
    async function startPolling(retries = 0, lastDelayMs = 5000) {
      try {
        await bot.telegram.deleteWebhook({ drop_pending_updates: true });
        console.log('✅ تم حذف Webhook القديم');
        await bot.launch({
          allowedUpdates:     ALLOWED_UPDATES,
          dropPendingUpdates: true,
        });
        console.log('✅ البوت يعمل الآن بوضع Polling!');
        const botInfo = await bot.telegram.getMe();
        setTimeout(() => syncBotChats(bot, botInfo.id).catch(console.error), 5000);
      } catch (err) {
        const msg = err?.message || String(err);
        if (msg.includes('409')) {
          const nextDelay = Math.min(120000, Math.max(5000, Math.floor(lastDelayMs * 1.6)));
          if (IS_RENDER) {
            console.warn('⚠️ Telegram 409 Conflict: يوجد instance ثانية للبوت شغالة (getUpdates).');
            console.warn(`⏳ راح أعيد المحاولة تلقائياً بعد ${Math.ceil(nextDelay / 1000)}s (بدون إيقاف السيرفر) ...`);
            setTimeout(() => startPolling(retries + 1, nextDelay), nextDelay);
            return;
          }
          if (retries < 5) {
            console.warn(`⚠️ تعارض — إعادة المحاولة ${retries + 1}/5 بعد ${Math.ceil(nextDelay / 1000)}s...`);
            setTimeout(() => startPolling(retries + 1, nextDelay), nextDelay);
            return;
          }
        }

        console.error('❌ فشل تشغيل البوت:', msg);
        if (IS_RENDER) {
          const nextDelay = Math.min(120000, Math.max(10000, Math.floor(lastDelayMs * 1.8)));
          console.warn(`⏳ إعادة محاولة تشغيل Polling بعد ${Math.ceil(nextDelay / 1000)}s...`);
          setTimeout(() => startPolling(retries + 1, nextDelay), nextDelay);
          return;
        }
        process.exit(1);
      }
    }

    startPolling();
    startAutoApproveInterval(); // ✅ القبول التلقائي في وضع Polling
  }

  // ── Graceful shutdown (يطبق على Webhook و Polling) ───────────
  const shutdown = (signal) => {
    try { bot.stop(signal); } catch {}
    try { server?.close?.(); } catch {}
    process.exit(0);
  };
  process.once('SIGINT',  () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch(err => {
  console.error('❌ فشل تشغيل البوت:', err.message);
  process.exit(1);
});
