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
const db = require('./db');

// ─── متغيرات البيئة ───────────────────────────────────────────
const AI_ENABLED       = process.env.AI_ENABLED !== 'false';
const AI_PROVIDER      = (process.env.AI_PROVIDER || 'deepseek').toLowerCase();
const AI_API_KEY       = process.env.AI_API_KEY || '';
// questions_only = يرد على الأسئلة فقط | all = يرد على كل رسالة
const AI_RESPONSE_MODE = (process.env.AI_RESPONSE_MODE || 'questions_only').toLowerCase();

// ─── مزودو الـ AI المدعومون ────────────────────────────────────
// gemini  → مجاني، API Key من: https://aistudio.google.com/apikey
// deepseek→ رخيص، API Key من: https://platform.deepseek.com
// openai  → API Key من: https://platform.openai.com
const PROVIDERS = {
  gemini: {
    type: 'gemini',
    url:  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent`,
    model: 'gemini-2.0-flash',
  },
  deepseek: {
    type: 'openai',
    url:  'https://api.deepseek.com/v1/chat/completions',
    model: 'deepseek-chat',
  },
  openai: {
    type: 'openai',
    url:  'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o-mini',
  },
};

// ═════════════════════════════════════════════════════════════
//  الإعدادات والبيانات — تُحفظ عبر db.js على GitHub تلقائياً
// ═════════════════════════════════════════════════════════════
// cfg — يقرأ ويكتب مباشرة في db (يحفظ على GitHub تلقائياً)
const cfg = {
  get enabled()       { return db.getAiCfg().enabled; },
  set enabled(v)      { db.setAiCfg({ enabled: v }); },
  get replyPrivate()  { return db.getAiCfg().replyPrivate; },
  set replyPrivate(v) { db.setAiCfg({ replyPrivate: v }); },
  get replyGroups()   { return db.getAiCfg().replyGroups; },
  set replyGroups(v)  { db.setAiCfg({ replyGroups: v }); },
  get monitorGroups() { return db.getAiCfg().monitorGroups; },
  set monitorGroups(v){ db.setAiCfg({ monitorGroups: v }); },
  get minAnswerLen()  { return db.getAiCfg().minAnswerLen; },
  set minAnswerLen(v) { db.setAiCfg({ minAnswerLen: v }); },
};

// qaStore — يقرأ ويكتب مباشرة في db
const qaStore = {
  get:    (h)  => db.getAiQA(h),
  has:    (h)  => db.hasAiQA(h),
  set:    (h, e) => { db.setAiQA(h, e); db.saveData(); },
  values: ()   => db.allAiQA(),
  get size()   { return db.allAiQA().length; },
  clear:  ()   => db.clearAiQA(),
};

function saveCfg() { db.saveData(); }
function saveQA()  { db.saveData(); }

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
  if (e) {
    e.count = (e.count || 1) + 1;
    e.lastAsked = new Date().toISOString();
    qaStore.set(h, e);
  } else {
    qaStore.set(h, {
      hash: h, q: text, a: null,
      askedBy: from.id,
      askedByName: from.first_name || from.username || String(from.id),
      chatId, timestamp: new Date().toISOString(),
      lastAsked: new Date().toISOString(), count: 1,
    });
  }
  return h;
}

function recordA(qHash, ans, from) {
  const e = qaStore.get(qHash);
  if (!e || !ans || ans.length < db.getAiCfg().minAnswerLen) return;
  if (!e.a || ans.length > e.a.length) {
    e.a = ans;
    e.answeredBy = from.id;
    e.answeredByName = from.first_name || from.username || String(from.id);
    e.answeredAt = new Date().toISOString();
    qaStore.set(qHash, e);
  }
}

// ═════════════════════════════════════════════════════════════
//  استدعاء الـ AI مع سياق قاعدة المعرفة
// ═════════════════════════════════════════════════════════════
function buildContext() {
  const pool = qaStore.values()
    .filter(e => e.a && e.a.length >= db.getAiCfg().minAnswerLen)
    .sort((a, b) => (b.count || 1) - (a.count || 1))
    .slice(0, 25);
  if (!pool.length) return '';
  let ctx = 'قاعدة معرفة المجتمع:\n\n';
  pool.forEach(e => { ctx += `س: ${e.q}\nج: ${e.a}\n\n`; });
  return ctx;
}

// ─── استدعاء Gemini API ──────────────────────────────────────
async function callGemini(question, systemPrompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${AI_API_KEY}`;
  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: question }] }],
    generationConfig: { maxOutputTokens: 700, temperature: 0.3 },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Gemini ${res.status}: ${err.slice(0, 120)}`);
  }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
}

// ─── استدعاء OpenAI-compatible APIs (DeepSeek / OpenAI) ──────
async function callOpenAI(p, question, systemPrompt) {
  const res = await fetch(p.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${AI_API_KEY}` },
    body: JSON.stringify({
      model: p.model, max_tokens: 700, temperature: 0.3,
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: question }],
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`${p.model} ${res.status}: ${err.slice(0, 120)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || null;
}

// ─── الاستدعاء الرئيسي مع retry تلقائي ──────────────────────
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

  // محاولة أولى
  try {
    const ans = p.type === 'gemini'
      ? await callGemini(question, sys)
      : await callOpenAI(p, question, sys);
    if (ans) return ans;
    throw new Error('empty response');
  } catch (e1) {
    console.warn(`⚠️ AI attempt 1 failed (${AI_PROVIDER}):`, e1.message);

    // محاولة ثانية بعد ثانيتين
    await new Promise(r => setTimeout(r, 2000));
    try {
      const ans = p.type === 'gemini'
        ? await callGemini(question, sys)
        : await callOpenAI(p, question, sys);
      if (ans) return ans;
      throw new Error('empty response');
    } catch (e2) {
      console.error(`❌ AI attempt 2 failed (${AI_PROVIDER}):`, e2.message);
      throw e2;
    }
  }
}

// ═════════════════════════════════════════════════════════════
//  لوحة التحكم
// ═════════════════════════════════════════════════════════════
function panelText() {
  const answered = qaStore.values().filter(e => e.a).length;
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
    [Markup.button.callback('🌐 السماح بالرد للكل',       'ai_rep_all')],
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

  const { DEVELOPER_ID } = require('./config');
  const isDev = ctx => ctx.from?.id === DEVELOPER_ID;

  console.log(`🤖 AI v2 نشط | ${AI_PROVIDER}`);

  // ── أمر /ai ───────────────────────────────────────────────
  bot.command('ai', async (ctx) => {
    if (!isDev(ctx)) return;
    if (ctx.chat.type !== 'private') return ctx.reply('افتح الأمر في الخاص مع البوت.');
    await ctx.replyWithMarkdown(panelText(), panelMarkup());
  });

  // ── فتح اللوحة من زر المطور ───────────────────────────────
  bot.action('ai_panel', async (ctx) => {
    if (!isDev(ctx)) return ctx.answerCbQuery('⛔');
    await ctx.answerCbQuery();
    await ctx.editMessageText(panelText(), { parse_mode: 'Markdown', ...panelMarkup() });
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
    const arr = [...cfg.monitorGroups];
    const i  = arr.indexOf(id);
    if (i >= 0) arr.splice(i, 1); else arr.push(id);
    cfg.monitorGroups = arr;
    saveCfg();
    await ctx.answerCbQuery(i >= 0 ? '❌ أُزيل' : '✅ أُضيف');
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
    const arr2 = [...cfg.replyGroups];
    const i  = arr2.indexOf(id);
    if (i >= 0) arr2.splice(i, 1); else arr2.push(id);
    cfg.replyGroups = arr2;
    saveCfg();
    await ctx.answerCbQuery(i >= 0 ? '❌ أُزيل' : '✅ أُضيف');
    const groups = db.allGroups();
    const btns = groups.map(g => {
      const on = cfg.replyGroups.includes(g.chatId);
      return [Markup.button.callback(`${on ? '✅' : '☑️'} ${(g.title || String(g.chatId)).slice(0, 28)}`, `air_${g.chatId}`)];
    });
    btns.push([Markup.button.callback('🔙 رجوع', 'ai_back')]);
    await ctx.editMessageText(`💬 *قروبات الرد*\n_(${cfg.replyGroups.length} محدد)_`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) });
  });

  // ── السماح بالرد لكل القروبات دفعة واحدة ─────────────────
  bot.action('ai_rep_all', async (ctx) => {
    if (!isDev(ctx)) return ctx.answerCbQuery('⛔');
    await ctx.answerCbQuery();
    const groups = db.allGroups();
    if (!groups.length) {
      return ctx.answerCbQuery('⚠️ لا يوجد قروبات مسجلة', { show_alert: true });
    }
    cfg.replyGroups = groups.map(g => g.chatId);
    saveCfg();
    await ctx.answerCbQuery(`✅ تم تفعيل الرد في ${cfg.replyGroups.length} قروب`, { show_alert: true });
    await ctx.editMessageText(panelText(), { parse_mode: 'Markdown', ...panelMarkup() });
  });

  // ── إحصائيات ──────────────────────────────────────────────
  bot.action('ai_stats', async (ctx) => {
    if (!isDev(ctx)) return ctx.answerCbQuery('⛔');
    await ctx.answerCbQuery();
    const total    = qaStore.size;
    const answered = qaStore.values().filter(e => e.a).length;
    const top5     = qaStore.values().filter(e => e.a).sort((a, b) => (b.count || 1) - (a.count || 1)).slice(0, 5);
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
    qaStore.clear();
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
        } catch (e) { console.error('AI group reply:', e.message); /* لا نرسل رسالة خطأ في القروب لتجنب الفوضى */ }
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

      // فقط للأسئلة في الخاص (أو كل الرسائل إذا AI_RESPONSE_MODE=all)
      if (AI_RESPONSE_MODE !== 'all' && !isQuestion(text)) return next();

      await ctx.sendChatAction('typing');
      const ans = await smartAsk(text);
      await ctx.reply(ans);

      const h = recordQ(text, from, chat.id);
      recordA(h, ans, { id: 0, first_name: 'AI' });
    } catch (e) {
      console.error('AI private error:', e.message);
      const providerName = AI_PROVIDER === 'gemini' ? 'Gemini' : AI_PROVIDER === 'openai' ? 'OpenAI' : 'DeepSeek';
      await ctx.reply(`⚠️ فشل الاتصال بـ ${providerName} مرتين.\n\nتأكد من:\n• صحة AI_API_KEY في Render\n• رصيد الحساب لدى المزوّد`).catch(() => {});
    }
  });
};
