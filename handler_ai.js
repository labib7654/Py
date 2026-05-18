// ============================================================
//  handler_ai.js — نظام الذكاء الاصطناعي v2.0
// ============================================================
//
//  المتغيرات المطلوبة في Render:
//  AI_ENABLED=true
//  AI_PROVIDER=deepseek   (أو openai)
//  AI_API_KEY=sk-...
//
//  باقي الإعدادات تُضبط من لوحة التحكم: أرسل /ai للبوت في الخاص
// ============================================================

'use strict';

const { Markup } = require('telegraf');
const fs         = require('fs');
const path       = require('path');

// ─── متغيرات البيئة ───────────────────────────────────────────
const AI_ENABLED  = process.env.AI_ENABLED !== 'false';
const AI_PROVIDER = (process.env.AI_PROVIDER || 'deepseek').toLowerCase();
const AI_API_KEY  = process.env.AI_API_KEY || '';

const PROVIDERS = {
  deepseek: { url: 'https://api.deepseek.com/v1/chat/completions', model: 'deepseek-chat' },
  openai:   { url: 'https://api.openai.com/v1/chat/completions',   model: 'gpt-4o-mini'   },
};

// ─── ملفات التخزين ────────────────────────────────────────────
const QA_FILE  = path.join(__dirname, 'qa_store.json');
const CFG_FILE = path.join(__dirname, 'ai_config.json');

// ═════════════════════════════════════════════════════════════
//  الإعدادات (تُحفظ في ai_config.json)
// ═════════════════════════════════════════════════════════════
let cfg = {
  enabled:       true,   // تشغيل/إيقاف كامل
  replyPrivate:  true,   // رد في الخاص
  replyGroups:   [],     // قروبات يرد فيها البوت (فارغة = لا يرد في قروبات)
  monitorGroups: [],     // قروبات يراقبها (فارغة = يراقب الكل)
  minAnswerLen:  15,     // حد أدنى لطول الإجابة المقبولة
};

function loadCfg() {
  try {
    if (fs.existsSync(CFG_FILE)) {
      cfg = { ...cfg, ...JSON.parse(fs.readFileSync(CFG_FILE, 'utf-8')) };
    }
  } catch (e) { console.warn('AI cfg load:', e.message); }
}

function saveCfg() {
  try { fs.writeFileSync(CFG_FILE, JSON.stringify(cfg, null, 2), 'utf-8'); }
  catch (e) { console.error('AI cfg save:', e.message); }
}

// ═════════════════════════════════════════════════════════════
//  قاعدة الأسئلة والأجوبة
// ═════════════════════════════════════════════════════════════
const qaStore = new Map();

function loadQA() {
  try {
    if (fs.existsSync(QA_FILE)) {
      const arr = JSON.parse(fs.readFileSync(QA_FILE, 'utf-8'));
      if (Array.isArray(arr)) {
        arr.forEach(e => e?.hash && qaStore.set(e.hash, e));
        console.log(`🧠 AI: تم تحميل ${qaStore.size} سؤال`);
      }
    }
  } catch (e) { console.warn('QA load:', e.message); }
}

let _saveT = null;
function saveQA() {
  if (_saveT) clearTimeout(_saveT);
  _saveT = setTimeout(() => {
    try { fs.writeFileSync(QA_FILE, JSON.stringify([...qaStore.values()], null, 2), 'utf-8'); }
    catch (e) { console.error('QA save:', e.message); }
  }, 2000);
}

function makeHash(text) {
  const s = text.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 80);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return String(Math.abs(h >>> 0));
}

const Q_WORDS = [
  'كيف','وش','ايش','ايه','إيه','ما هو','ما هي','متى','لماذا','لش',
  'هل','اين','أين','من هو','من هي','ليش','شو','ماذا','كم','وين',
  'فين','ازاي','امتى','وليش','وكيف','وش هو','وش هي','ما معنى',
  'ما الفرق','شنو','شبيه','علاش','واش','كيفاش',
];

function isQuestion(text) {
  if (!text || text.length < 4) return false;
  if (text.includes('?') || text.includes('؟')) return true;
  const t = text.toLowerCase().trim();
  return Q_WORDS.some(w => t.startsWith(w + ' ') || t.startsWith(w + '،') || t === w);
}

function recordQ(text, from, chatId) {
  const h = makeHash(text);
  const e = qaStore.get(h);
  if (e) { e.count = (e.count || 1) + 1; e.lastAsked = new Date().toISOString(); }
  else {
    qaStore.set(h, {
      hash: h, q: text, a: null,
      askedBy: from.id,
      askedByName: from.first_name || from.username || String(from.id),
      chatId, timestamp: new Date().toISOString(),
      lastAsked: new Date().toISOString(), count: 1,
    });
  }
  saveQA();
  return h;
}

function recordA(qHash, ans, from) {
  const e = qaStore.get(qHash);
  if (!e || !ans || ans.length < cfg.minAnswerLen) return;
  if (!e.a || ans.length > e.a.length) {
    e.a = ans;
    e.answeredBy = from.id;
    e.answeredByName = from.first_name || from.username || String(from.id);
    e.answeredAt = new Date().toISOString();
    saveQA();
  }
}

// ═════════════════════════════════════════════════════════════
//  استدعاء الـ AI مع سياق قاعدة المعرفة
// ═════════════════════════════════════════════════════════════
function buildContext() {
  const pool = [...qaStore.values()]
    .filter(e => e.a && e.a.length >= cfg.minAnswerLen)
    .sort((a, b) => (b.count || 1) - (a.count || 1))
    .slice(0, 25);
  if (!pool.length) return '';
  let ctx = 'قاعدة معرفة المجتمع:\n\n';
  pool.forEach(e => { ctx += `س: ${e.q}\nج: ${e.a}\n\n`; });
  return ctx;
}

async function smartAsk(question) {
  const p   = PROVIDERS[AI_PROVIDER] || PROVIDERS.deepseek;
  const ctx = buildContext();

  const sys = ctx
    ? `أنت مساعد ذكي لمجتمع عربي. مهمتك:
١. ابحث في قاعدة المعرفة عن إجابة تتوافق مع السؤال حتى لو اختلفت الصياغة أو اللهجة أو حُذفت حروف.
٢. إذا وجدت إجابة مناسبة استخدمها وأضف عليها إن لزم.
٣. إذا لم تجد أجب من معرفتك بإيجاز.
٤. أجب بالعربية مباشرة بدون مقدمات.

${ctx}`
    : 'أنت مساعد ذكي لمجتمع عربي. أجب بإيجاز ووضوح بالعربية.';

  const res = await fetch(p.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${AI_API_KEY}` },
    body: JSON.stringify({
      model: p.model, max_tokens: 700, temperature: 0.3,
      messages: [{ role: 'system', content: sys }, { role: 'user', content: question }],
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`${res.status}: ${err.slice(0, 100)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || 'لم أتمكن من الإجابة الآن.';
}

// ═════════════════════════════════════════════════════════════
//  لوحة التحكم
// ═════════════════════════════════════════════════════════════
function panelText() {
  const answered = [...qaStore.values()].filter(e => e.a).length;
  return (
    `🤖 *لوحة تحكم الذكاء الاصطناعي*\n\n` +
    `الحالة: ${cfg.enabled ? '🟢 شغّال' : '🔴 موقوف'}\n` +
    `الرد في الخاص: ${cfg.replyPrivate ? '✅ مفعّل' : '❌ معطّل'}\n` +
    `قروبات المراقبة: ${cfg.monitorGroups.length === 0 ? 'الكل 👁️' : cfg.monitorGroups.length + ' قروب'}\n` +
    `قروبات الرد: ${cfg.replyGroups.length === 0 ? 'لا يوجد ❌' : cfg.replyGroups.length + ' قروب'}\n` +
    `الأسئلة المحفوظة: ${qaStore.size} | المجاب عنها: ${answered}\n` +
    `_المزود: ${AI_PROVIDER}_`
  );
}

function panelMarkup() {
  return Markup.inlineKeyboard([
    [Markup.button.callback(cfg.enabled ? '🟢 إيقاف النظام' : '🔴 تشغيل النظام', 'ai_toggle')],
    [Markup.button.callback(cfg.replyPrivate ? '✅ الخاص: مفعّل — إيقاف' : '❌ الخاص: معطّل — تفعيل', 'ai_priv')],
    [Markup.button.callback('👁️ إعداد قروبات المراقبة',  'ai_mon')],
    [Markup.button.callback('💬 إعداد قروبات الرد',       'ai_rep')],
    [Markup.button.callback('📊 إحصائيات',                'ai_stats')],
    [Markup.button.callback('🗑️ مسح قاعدة البيانات',     'ai_clr')],
  ]);
}

// ═════════════════════════════════════════════════════════════
//  التثبيت
// ═════════════════════════════════════════════════════════════
module.exports = function setupAI(bot) {
  if (!AI_ENABLED) { console.log('ℹ️ AI معطّل'); return; }
  if (!AI_API_KEY) { console.warn('⚠️ AI_API_KEY مفقود'); return; }

  loadCfg();
  loadQA();

  const { DEVELOPER_ID } = require('./config');
  const isDev = ctx => ctx.from?.id === DEVELOPER_ID;

  console.log(`🤖 AI v2 نشط | ${AI_PROVIDER}`);

  // ── أمر /ai ───────────────────────────────────────────────
  bot.command('ai', async (ctx) => {
    if (!isDev(ctx)) return;
    if (ctx.chat.type !== 'private') return ctx.reply('افتح الأمر في الخاص مع البوت.');
    await ctx.replyWithMarkdown(panelText(), panelMarkup());
  });

  // ── تشغيل/إيقاف ───────────────────────────────────────────
  bot.action('ai_toggle', async (ctx) => {
    if (!isDev(ctx)) return ctx.answerCbQuery('⛔');
    cfg.enabled = !cfg.enabled; saveCfg();
    await ctx.answerCbQuery(cfg.enabled ? '✅ تم التشغيل' : '⛔ تم الإيقاف');
    await ctx.editMessageText(panelText(), { parse_mode: 'Markdown', ...panelMarkup() });
  });

  // ── الخاص ─────────────────────────────────────────────────
  bot.action('ai_priv', async (ctx) => {
    if (!isDev(ctx)) return ctx.answerCbQuery('⛔');
    cfg.replyPrivate = !cfg.replyPrivate; saveCfg();
    await ctx.answerCbQuery(cfg.replyPrivate ? '✅ الخاص مفعّل' : '❌ الخاص معطّل');
    await ctx.editMessageText(panelText(), { parse_mode: 'Markdown', ...panelMarkup() });
  });

  // ── قروبات المراقبة ────────────────────────────────────────
  bot.action('ai_mon', async (ctx) => {
    if (!isDev(ctx)) return ctx.answerCbQuery('⛔');
    await ctx.answerCbQuery();
    const db = require('./db');
    const groups = db.allGroups();
    const btns = groups.map(g => {
      const on = cfg.monitorGroups.includes(g.chatId);
      return [Markup.button.callback(`${on ? '✅' : '☑️'} ${(g.title || String(g.chatId)).slice(0, 28)}`, `aim_${g.chatId}`)];
    });
    btns.push([Markup.button.callback('✅ الكل', 'aim_all'), Markup.button.callback('🔙 رجوع', 'ai_back')]);
    const note = cfg.monitorGroups.length === 0 ? '_(الكل مراقَب)_' : `_(${cfg.monitorGroups.length} محدد)_`;
    await ctx.editMessageText(`👁️ *قروبات المراقبة*\n${note}`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) });
  });

  bot.action(/^aim_(-?\d+)$/, async (ctx) => {
    if (!isDev(ctx)) return ctx.answerCbQuery('⛔');
    const id = Number(ctx.match[1]);
    const i  = cfg.monitorGroups.indexOf(id);
    if (i >= 0) cfg.monitorGroups.splice(i, 1); else cfg.monitorGroups.push(id);
    saveCfg();
    await ctx.answerCbQuery(i >= 0 ? '❌ أُزيل' : '✅ أُضيف');
    const db = require('./db');
    const groups = db.allGroups();
    const btns = groups.map(g => {
      const on = cfg.monitorGroups.includes(g.chatId);
      return [Markup.button.callback(`${on ? '✅' : '☑️'} ${(g.title || String(g.chatId)).slice(0, 28)}`, `aim_${g.chatId}`)];
    });
    btns.push([Markup.button.callback('✅ الكل', 'aim_all'), Markup.button.callback('🔙 رجوع', 'ai_back')]);
    await ctx.editMessageText(`👁️ *قروبات المراقبة*\n_(${cfg.monitorGroups.length} محدد)_`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) });
  });

  bot.action('aim_all', async (ctx) => {
    if (!isDev(ctx)) return ctx.answerCbQuery('⛔');
    cfg.monitorGroups = []; saveCfg();
    await ctx.answerCbQuery('✅ الكل مراقَب');
    await ctx.editMessageText(panelText(), { parse_mode: 'Markdown', ...panelMarkup() });
  });

  // ── قروبات الرد ────────────────────────────────────────────
  bot.action('ai_rep', async (ctx) => {
    if (!isDev(ctx)) return ctx.answerCbQuery('⛔');
    await ctx.answerCbQuery();
    const db = require('./db');
    const groups = db.allGroups();
    const btns = groups.map(g => {
      const on = cfg.replyGroups.includes(g.chatId);
      return [Markup.button.callback(`${on ? '✅' : '☑️'} ${(g.title || String(g.chatId)).slice(0, 28)}`, `air_${g.chatId}`)];
    });
    btns.push([Markup.button.callback('🔙 رجوع', 'ai_back')]);
    await ctx.editMessageText(`💬 *قروبات الرد*\n_(${cfg.replyGroups.length} محدد)_`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) });
  });

  bot.action(/^air_(-?\d+)$/, async (ctx) => {
    if (!isDev(ctx)) return ctx.answerCbQuery('⛔');
    const id = Number(ctx.match[1]);
    const i  = cfg.replyGroups.indexOf(id);
    if (i >= 0) cfg.replyGroups.splice(i, 1); else cfg.replyGroups.push(id);
    saveCfg();
    await ctx.answerCbQuery(i >= 0 ? '❌ أُزيل' : '✅ أُضيف');
    const db = require('./db');
    const groups = db.allGroups();
    const btns = groups.map(g => {
      const on = cfg.replyGroups.includes(g.chatId);
      return [Markup.button.callback(`${on ? '✅' : '☑️'} ${(g.title || String(g.chatId)).slice(0, 28)}`, `air_${g.chatId}`)];
    });
    btns.push([Markup.button.callback('🔙 رجوع', 'ai_back')]);
    await ctx.editMessageText(`💬 *قروبات الرد*\n_(${cfg.replyGroups.length} محدد)_`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) });
  });

  // ── إحصائيات ──────────────────────────────────────────────
  bot.action('ai_stats', async (ctx) => {
    if (!isDev(ctx)) return ctx.answerCbQuery('⛔');
    await ctx.answerCbQuery();
    const total    = qaStore.size;
    const answered = [...qaStore.values()].filter(e => e.a).length;
    const top5     = [...qaStore.values()].filter(e => e.a).sort((a, b) => (b.count || 1) - (a.count || 1)).slice(0, 5);
    let txt = `📊 *إحصائيات قاعدة المعرفة*\n\nالكلي: *${total}* | مجاب: *${answered}* | بدون إجابة: *${total - answered}*\n\n`;
    if (top5.length) { txt += `🔥 *الأكثر تكراراً:*\n`; top5.forEach((e, i) => { txt += `${i+1}. _(${e.count}x)_ ${e.q.slice(0,50)}\n`; }); }
    await ctx.editMessageText(txt, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', 'ai_back')]]) });
  });

  // ── مسح ───────────────────────────────────────────────────
  bot.action('ai_clr', async (ctx) => {
    if (!isDev(ctx)) return ctx.answerCbQuery('⛔');
    await ctx.answerCbQuery();
    await ctx.editMessageText('⚠️ *هل أنت متأكد من مسح كل الأسئلة والأجوبة؟*', {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('🗑️ نعم، امسح', 'ai_clr_yes'), Markup.button.callback('❌ إلغاء', 'ai_back')]])
    });
  });

  bot.action('ai_clr_yes', async (ctx) => {
    if (!isDev(ctx)) return ctx.answerCbQuery('⛔');
    qaStore.clear(); saveQA();
    await ctx.answerCbQuery('✅ تم المسح');
    await ctx.editMessageText(panelText(), { parse_mode: 'Markdown', ...panelMarkup() });
  });

  // ── رجوع ──────────────────────────────────────────────────
  bot.action('ai_back', async (ctx) => {
    if (!isDev(ctx)) return ctx.answerCbQuery('⛔');
    await ctx.answerCbQuery();
    await ctx.editMessageText(panelText(), { parse_mode: 'Markdown', ...panelMarkup() });
  });

  // ──────────────────────────────────────────────────────────
  //  رادار المجموعات
  // ──────────────────────────────────────────────────────────
  bot.on('message', async (ctx, next) => {
    try {
      if (!cfg.enabled) return next();
      const { from, chat, message: msg } = ctx;
      if (!from || from.is_bot || !msg) return next();
      if (chat.type !== 'group' && chat.type !== 'supergroup') return next();

      const monitored = cfg.monitorGroups.length === 0 || cfg.monitorGroups.includes(chat.id);
      if (!monitored) return next();

      const text = msg.text || msg.caption || '';
      if (!text || text.startsWith('/') || text.length < 4) return next();

      if (isQuestion(text)) {
        recordQ(text, from, chat.id);
      } else if (msg.reply_to_message && text.length >= cfg.minAnswerLen) {
        const orig = msg.reply_to_message.text || msg.reply_to_message.caption || '';
        if (orig && isQuestion(orig)) {
          const h = makeHash(orig);
          if (!qaStore.has(h)) recordQ(orig, msg.reply_to_message.from || { id: 0, first_name: 'مجهول' }, chat.id);
          recordA(h, text, from);
        }
      }

      // رد في القروب إن كان محدداً
      if (cfg.replyGroups.includes(chat.id) && isQuestion(text)) {
        try {
          await ctx.sendChatAction('typing');
          const ans = await smartAsk(text);
          await ctx.reply(ans, { reply_to_message_id: msg.message_id });
          const h = makeHash(text);
          recordA(h, ans, { id: 0, first_name: 'AI' });
        } catch (e) { console.error('AI group reply:', e.message); }
      }
    } catch (e) { console.error('AI radar:', e.message); }
    return next();
  });

  // ──────────────────────────────────────────────────────────
  //  الرد في الخاص
  // ──────────────────────────────────────────────────────────
  bot.on('message', async (ctx, next) => {
    try {
      if (!cfg.enabled || !cfg.replyPrivate) return next();
      const { from, chat, message: msg } = ctx;
      if (!from || from.is_bot || !msg) return next();
      if (chat.type !== 'private') return next();
      const text = msg.text || '';
      if (!text || text.startsWith('/') || text.length < 3) return next();

      await ctx.sendChatAction('typing');
      const ans = await smartAsk(text);
      await ctx.reply(ans);

      if (isQuestion(text)) {
        const h = recordQ(text, from, chat.id);
        recordA(h, ans, { id: 0, first_name: 'AI' });
      }
    } catch (e) {
      console.error('AI private:', e.message);
      await ctx.reply('⚠️ حدث خطأ، حاول مجدداً.').catch(() => {});
    }
  });
};
