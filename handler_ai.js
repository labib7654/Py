// ============================================================
//  handler_ai.js — نظام الذكاء الاصطناعي v1.0
//  يرصد الأسئلة والردود في المجموعات → يحفظها → يرد ذكياً
// ============================================================
//
//  أضف هذه المتغيرات في ملف .env:
//  ──────────────────────────────────────────────────────────
//  AI_ENABLED=true
//  AI_PROVIDER=deepseek          ← أو openai
//  AI_API_KEY=sk-xxxxxxxxxxxx    ← مفتاحك الجديد (اصنع مفتاحاً جديداً)
//  AI_RESPONSE_MODE=private      ← private | community | both
//  AI_COMMUNITY_CHAT_ID=-100xxx  ← معرف القروب (لو mode=community/both)
//  ──────────────────────────────────────────────────────────
//
//  التثبيت في index.js — أضف هذين السطرين:
//  ──────────────────────────────────────────────────────────
//  const setupAI = require('./handler_ai');   ← في أعلى الملف
//  setupAI(bot);                               ← بعد باقي الـ setup
//  ──────────────────────────────────────────────────────────

'use strict';

const fs   = require('fs');
const path = require('path');

// ─── إعدادات من .env ─────────────────────────────────────────
const AI_ENABLED       = process.env.AI_ENABLED !== 'false';
const AI_PROVIDER      = (process.env.AI_PROVIDER      || 'deepseek').toLowerCase();
const AI_API_KEY       = process.env.AI_API_KEY         || '';
const AI_RESPONSE_MODE = (process.env.AI_RESPONSE_MODE || 'private').toLowerCase();
const AI_COMMUNITY_ID  = Number(process.env.AI_COMMUNITY_CHAT_ID || '0');

// ملف مستقل لحفظ قاعدة الأسئلة والأجوبة (منفصل عن data.json)
const QA_FILE = process.env.QA_FILE
  ? path.resolve(process.env.QA_FILE)
  : path.join(__dirname, 'qa_store.json');

// ─── إعدادات مزودي الـ AI ─────────────────────────────────────
const PROVIDERS = {
  deepseek: { url: 'https://api.deepseek.com/v1/chat/completions', model: 'deepseek-chat'  },
  openai:   { url: 'https://api.openai.com/v1/chat/completions',   model: 'gpt-4o-mini'    },
};

// ─── قاعدة الأسئلة والأجوبة (ذاكرة + ملف) ───────────────────
// الشكل: Map<hash, { hash, q, a, askedBy, askedByName, chatId, timestamp, count, answeredBy, answeredAt }>
const qaStore = new Map();

// ─── تحميل القاعدة عند التشغيل ───────────────────────────────
function loadQA() {
  try {
    if (fs.existsSync(QA_FILE)) {
      const raw  = fs.readFileSync(QA_FILE, 'utf-8');
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        for (const e of data) {
          if (e && e.hash) qaStore.set(e.hash, e);
        }
        console.log(`🧠 AI: تم تحميل ${qaStore.size} سؤال من qa_store.json`);
      }
    }
  } catch (e) {
    console.warn('⚠️ AI: لم يتم تحميل qa_store.json:', e.message);
  }
}

// ─── حفظ القاعدة (مؤجّل ثانيتين لتجميع التغييرات) ───────────
let _saveTimer = null;
function saveQA() {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    try {
      fs.writeFileSync(QA_FILE, JSON.stringify([...qaStore.values()], null, 2), 'utf-8');
    } catch (e) {
      console.error('❌ AI: فشل حفظ qa_store.json:', e.message);
    }
  }, 2000);
}

// ─── هل النص سؤال؟ ────────────────────────────────────────────
const Q_WORDS = [
  'كيف','وش','ايش','ايه','إيه','ما هو','ما هي','متى','لماذا','لش',
  'هل','اين','أين','من هو','من هي','ليش','شو','ماذا','كم','وين',
  'فين','ازاي','امتى','وليش','وكيف','وش هو','وش هي',
];
function isQuestion(text) {
  if (!text || text.length < 4) return false;
  if (text.includes('?') || text.includes('؟')) return true;
  const t = text.toLowerCase().trim();
  return Q_WORDS.some(w => t.startsWith(w + ' ') || t.startsWith(w + '،') || t === w);
}

// ─── هاش النص (مفتاح التخزين) ────────────────────────────────
function makeHash(text) {
  const s = text.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 60);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return String(Math.abs(h >>> 0));
}

// ─── تسجيل سؤال جديد أو تحديث عداده ────────────────────────
function recordQuestion(text, from, chatId) {
  const h = makeHash(text);
  const existing = qaStore.get(h);
  if (existing) {
    existing.count = (existing.count || 1) + 1;
    existing.lastAsked = new Date().toISOString();
  } else {
    qaStore.set(h, {
      hash: h, q: text, a: null,
      askedBy: from.id,
      askedByName: from.first_name || from.username || String(from.id),
      chatId,
      timestamp: new Date().toISOString(),
      lastAsked: new Date().toISOString(),
      count: 1,
    });
  }
  saveQA();
  return h;
}

// ─── تسجيل إجابة (نحفظ الأطول = الأشمل) ─────────────────────
function recordAnswer(questionHash, answerText, from) {
  const e = qaStore.get(questionHash);
  if (!e || !answerText || answerText.length < 5) return;
  if (!e.a || answerText.length > e.a.length) {
    e.a            = answerText;
    e.answeredBy   = from.id;
    e.answeredByName = from.first_name || from.username || String(from.id);
    e.answeredAt   = new Date().toISOString();
    saveQA();
  }
}

// ─── البحث عن إجابة قريبة في القاعدة ────────────────────────
function findCachedAnswer(question) {
  const words = question.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  if (!words.length) return null;
  let best = null, bestScore = 0;
  for (const e of qaStore.values()) {
    if (!e.a) continue;
    const hits  = words.filter(w => e.q.toLowerCase().includes(w)).length;
    const score = hits / words.length;
    if (score > bestScore) { bestScore = score; best = e; }
  }
  // نعيد فقط إذا كانت المطابقة 50% أو أكثر
  return bestScore >= 0.5 ? best : null;
}

// ─── بناء سياق لتغذية الـ AI من أفضل الأسئلة والأجوبة ────────
function buildContext() {
  const pool = [...qaStore.values()]
    .filter(e => e.a && e.a.length > 5)
    .sort((a, b) => (b.count || 1) - (a.count || 1))
    .slice(0, 20);
  if (!pool.length) return '';
  let ctx = 'معرفة مجتمعية (استخدمها كمرجع للإجابة):\n\n';
  for (const e of pool) ctx += `س: ${e.q}\nج: ${e.a}\n\n`;
  return ctx;
}

// ─── استدعاء الـ AI ───────────────────────────────────────────
async function askAI(question) {
  const p   = PROVIDERS[AI_PROVIDER] || PROVIDERS.deepseek;
  const ctx = buildContext();
  const sys = ctx
    ? `أنت مساعد ذكي لمجتمع عربي. استخدم المعرفة المتوفرة للإجابة بدقة وإيجاز بالعربية.\n\n${ctx}`
    : 'أنت مساعد ذكي لمجتمع عربي. أجب بإيجاز ووضوح بالعربية.';

  const res = await fetch(p.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${AI_API_KEY}` },
    body: JSON.stringify({
      model: p.model, max_tokens: 600,
      messages: [{ role: 'system', content: sys }, { role: 'user', content: question }],
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${err.slice(0, 120)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || 'لم أتمكن من الإجابة الآن.';
}

// ═════════════════════════════════════════════════════════════
//  setupAI — يُستدعى من index.js
// ═════════════════════════════════════════════════════════════
module.exports = function setupAI(bot) {

  if (!AI_ENABLED) {
    console.log('ℹ️ نظام AI معطّل — فعّله بـ AI_ENABLED=true في .env');
    return;
  }
  if (!AI_API_KEY) {
    console.warn('⚠️ نظام AI: AI_API_KEY مفقود في .env — تم التخطي');
    return;
  }

  loadQA();
  console.log(`🤖 نظام AI نشط | المزود: ${AI_PROVIDER} | الوضع: ${AI_RESPONSE_MODE}`);

  // ──────────────────────────────────────────────────────────
  //  ١. رادار المجموعات — يرصد الأسئلة والردود ويحفظها
  // ──────────────────────────────────────────────────────────
  bot.on('message', async (ctx, next) => {
    try {
      const { from, chat, message: msg } = ctx;
      if (!from || from.is_bot || !msg) return next();
      if (chat.type !== 'group' && chat.type !== 'supergroup') return next();

      const text = msg.text || msg.caption || '';
      if (!text || text.startsWith('/') || text.length < 4) return next();

      if (isQuestion(text)) {
        // سؤال مباشر
        recordQuestion(text, from, chat.id);
      } else if (msg.reply_to_message && text.length > 8) {
        // ردّ على رسالة → قد يكون إجابة لسؤال
        const origText = msg.reply_to_message.text || msg.reply_to_message.caption || '';
        if (origText && isQuestion(origText)) {
          const h = makeHash(origText);
          // تأكد السؤال مسجّل
          if (!qaStore.has(h)) {
            const origFrom = msg.reply_to_message.from || { id: 0, first_name: 'مجهول' };
            recordQuestion(origText, origFrom, chat.id);
          }
          recordAnswer(h, text, from);
        }
      }
    } catch (e) {
      console.error('AI radar error:', e.message);
    }
    return next();
  });

  // ──────────────────────────────────────────────────────────
  //  ٢. الرد في الخاص (إذا الوضع = private أو both)
  // ──────────────────────────────────────────────────────────
  if (AI_RESPONSE_MODE === 'private' || AI_RESPONSE_MODE === 'both') {
    bot.on('message', async (ctx, next) => {
      const { from, chat, message: msg } = ctx;
      if (!from || from.is_bot || !msg) return next();
      if (chat.type !== 'private') return next();

      const text = msg.text || '';
      if (!text || text.startsWith('/') || text.length < 3) return next();

      try {
        await ctx.sendChatAction('typing');

        // أولاً: ابحث في قاعدة المعرفة
        const cached = findCachedAnswer(text);
        if (cached) {
          await ctx.reply(
            `${cached.a}\n\n_💡 من تجارب المجتمع_`,
            { parse_mode: 'Markdown' }
          );
          if (isQuestion(text)) recordQuestion(text, from, chat.id);

          // لو وضع both — أرسل للمجتمع أيضاً
          if (AI_RESPONSE_MODE === 'both' && AI_COMMUNITY_ID) {
            bot.telegram.sendMessage(
              AI_COMMUNITY_ID,
              `❓ *سؤال:* ${text}\n\n💡 *الإجابة:*\n${cached.a}`,
              { parse_mode: 'Markdown' }
            ).catch(() => {});
          }
          return;
        }

        // ثانياً: اسأل الـ AI
        const answer = await askAI(text);
        await ctx.reply(answer);

        // احفظ في القاعدة
        if (isQuestion(text)) {
          const h = recordQuestion(text, from, chat.id);
          recordAnswer(h, answer, { id: 0, first_name: 'AI' });
        }

        // لو وضع both — أرسل للمجتمع أيضاً
        if (AI_RESPONSE_MODE === 'both' && AI_COMMUNITY_ID) {
          bot.telegram.sendMessage(
            AI_COMMUNITY_ID,
            `❓ *سؤال:* ${text}\n\n🤖 *الإجابة:*\n${answer}`,
            { parse_mode: 'Markdown' }
          ).catch(() => {});
        }

      } catch (e) {
        console.error('AI private error:', e.message);
        await ctx.reply('⚠️ حدث خطأ أثناء معالجة سؤالك، حاول مجدداً.');
      }
    });
  }

  // ──────────────────────────────────────────────────────────
  //  ٣. الرد في المجتمع (إذا الوضع = community)
  //     البوت ينشر سؤال+جواب في المجتمع مباشرة
  // ──────────────────────────────────────────────────────────
  if (AI_RESPONSE_MODE === 'community' && AI_COMMUNITY_ID) {
    bot.on('message', async (ctx, next) => {
      const { from, chat, message: msg } = ctx;
      if (!from || from.is_bot || !msg) return next();
      if (chat.type !== 'private') return next();

      const text = msg.text || '';
      if (!text || text.startsWith('/') || text.length < 3) return next();

      try {
        await ctx.sendChatAction('typing');
        const answer = await askAI(text);

        // أرسل للمجتمع
        await bot.telegram.sendMessage(
          AI_COMMUNITY_ID,
          `❓ *سؤال:* ${text}\n\n🤖 *الإجابة:*\n${answer}`,
          { parse_mode: 'Markdown' }
        );

        // أخبر المستخدم أن سؤاله نُشر
        await ctx.reply('✅ سؤالك تم إرساله للمجتمع، ستجد الإجابة هناك.');

        if (isQuestion(text)) {
          const h = recordQuestion(text, from, chat.id);
          recordAnswer(h, answer, { id: 0, first_name: 'AI' });
        }

      } catch (e) {
        console.error('AI community error:', e.message);
        await ctx.reply('⚠️ حدث خطأ، حاول مجدداً.');
      }
    });
  }

  // ──────────────────────────────────────────────────────────
  //  ٤. أوامر الإدارة (للمطور فقط)
  // ──────────────────────────────────────────────────────────
  bot.command('ai_stats', async (ctx) => {
    const { DEVELOPER_ID } = require('./config');
    if (ctx.from.id !== DEVELOPER_ID) return;

    const total    = qaStore.size;
    const answered = [...qaStore.values()].filter(e => e.a).length;
    const top5     = [...qaStore.values()]
      .filter(e => e.a)
      .sort((a, b) => (b.count || 1) - (a.count || 1))
      .slice(0, 5);

    let text = `🧠 *إحصائيات قاعدة المعرفة*\n\n`;
    text += `📊 إجمالي الأسئلة المرصودة: *${total}*\n`;
    text += `✅ مجاب عنها: *${answered}*\n`;
    text += `❓ بدون إجابة: *${total - answered}*\n`;
    text += `🤖 المزود: \`${AI_PROVIDER}\` | الوضع: \`${AI_RESPONSE_MODE}\`\n`;
    if (top5.length) {
      text += `\n🔥 *الأكثر تكراراً:*\n`;
      top5.forEach((e, i) => {
        text += `${i + 1}. _(${e.count}x)_ ${e.q.slice(0, 50)}\n`;
      });
    }
    await ctx.reply(text, { parse_mode: 'Markdown' });
  });

  bot.command('ai_info', async (ctx) => {
    const { DEVELOPER_ID } = require('./config');
    if (ctx.from.id !== DEVELOPER_ID) return;
    await ctx.reply(
      `⚙️ *إعدادات نظام AI*\n\n` +
      `• الحالة: ✅ نشط\n` +
      `• المزود: \`${AI_PROVIDER}\`\n` +
      `• الوضع: \`${AI_RESPONSE_MODE}\`\n` +
      `• معرف المجتمع: \`${AI_COMMUNITY_ID || 'غير محدد'}\`\n` +
      `• ملف القاعدة: \`qa_store.json\`\n\n` +
      `الأوامر المتاحة:\n` +
      `/ai_stats — إحصائيات قاعدة المعرفة\n` +
      `/ai_info — هذه الرسالة`,
      { parse_mode: 'Markdown' }
    );
  });

};
