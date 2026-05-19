// ============================================================
//  handler_ai.js — نظام المراقبة الذكية v3.0
//  بدون AI خارجي — يجمع الأسئلة والأجوبة من القروبات
//  ويرد منها مباشرة بدون أي API
// ============================================================

'use strict';

const { Markup } = require('telegraf');
const db = require('./db');

// ═══════════════════════════════════════════════════════════
//  إعدادات القراءة من db
// ═══════════════════════════════════════════════════════════
const cfg = {
  get enabled()        { return db.getAiCfg().enabled; },
  set enabled(v)       { db.setAiCfg({ enabled: v }); },
  get replyGroups()    { return db.getAiCfg().replyGroups; },
  set replyGroups(v)   { db.setAiCfg({ replyGroups: v }); },
  get monitorGroups()  { return db.getAiCfg().monitorGroups; },
  set monitorGroups(v) { db.setAiCfg({ monitorGroups: v }); },
  get minAnswerLen()   { return db.getAiCfg().minAnswerLen || 10; },
};

// ═══════════════════════════════════════════════════════════
//  دوال قاعدة البيانات المحلية
// ═══════════════════════════════════════════════════════════
const qaStore = {
  get:    (h)    => db.getAiQA(h),
  has:    (h)    => db.hasAiQA(h),
  set:    (h, e) => { db.setAiQA(h, e); db.markDirty(); },
  values: ()     => db.allAiQA(),
  get size()     { return db.allAiQA().length; },
  clear:  ()     => db.clearAiQA(),
};

// ═══════════════════════════════════════════════════════════
//  دوال مساعدة
// ═══════════════════════════════════════════════════════════
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

// ─── تسجيل سؤال ──────────────────────────────────────────
function recordQ(text, from, chatId, chatTitle) {
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
      chatId, chatTitle: chatTitle || String(chatId),
      timestamp: new Date().toISOString(),
      lastAsked: new Date().toISOString(),
      count: 1,
    });
  }
  return h;
}

// ─── تسجيل إجابة ─────────────────────────────────────────
function recordA(qHash, ans, from) {
  const e = qaStore.get(qHash);
  if (!e || !ans || ans.length < cfg.minAnswerLen) return;
  if (!e.a || ans.length > e.a.length) {
    e.a = ans;
    e.answeredBy = from.id;
    e.answeredByName = from.first_name || from.username || String(from.id);
    e.answeredAt = new Date().toISOString();
    qaStore.set(qHash, e);
  }
}

// ─── البحث في قاعدة البيانات المحلية ─────────────────────
function findAnswer(question) {
  const q = question.trim().toLowerCase().replace(/\s+/g, ' ');
  const pool = qaStore.values().filter(e => e.a && e.a.length >= cfg.minAnswerLen);
  if (!pool.length) return null;

  function similarity(a, b) {
    const wa = new Set(a.split(' ').filter(w => w.length > 1));
    const wb = new Set(b.split(' ').filter(w => w.length > 1));
    let common = 0;
    wa.forEach(w => { if (wb.has(w)) common++; });
    return common / Math.max(wa.size, wb.size, 1);
  }

  const scored = pool
    .map(e => ({ ...e, score: similarity(q, e.q.toLowerCase()) }))
    .filter(e => e.score > 0.25)
    .sort((a, b) => b.score - a.score || (b.count || 1) - (a.count || 1));

  return scored.length ? scored[0] : null;
}

// ═══════════════════════════════════════════════════════════
//  لوحة التحكم
// ═══════════════════════════════════════════════════════════
function panelText() {
  const answered = qaStore.values().filter(e => e.a).length;
  return (
    `🧠 *لوحة تحكم نظام المعرفة*\n\n` +
    `الحالة: ${cfg.enabled ? '🟢 شغّال' : '🔴 موقوف'}\n` +
    `قروبات المراقبة: ${cfg.monitorGroups.length === 0 ? 'الكل 👁️' : cfg.monitorGroups.length + ' قروب'}\n` +
    `قروبات الرد: ${cfg.replyGroups.length === 0 ? 'لا يوجد ❌' : cfg.replyGroups.length + ' قروب'}\n` +
    `الأسئلة المحفوظة: ${qaStore.size} | المجاب عنها: ${answered}`
  );
}

function panelMarkup() {
  return Markup.inlineKeyboard([
    [Markup.button.callback(cfg.enabled ? '🟢 إيقاف النظام' : '🔴 تشغيل النظام', 'ai_toggle')],
    [Markup.button.callback('👁️ قروبات المراقبة', 'ai_mon')],
    [Markup.button.callback('💬 قروبات الرد',      'ai_rep')],
    [Markup.button.callback('🌐 تفعيل الرد للكل',  'ai_rep_all'), Markup.button.callback('❌ إيقاف الرد للكل', 'ai_rep_none')],
    [Markup.button.callback('📊 إحصائيات',         'ai_stats')],
    [Markup.button.callback('🗑️ مسح قاعدة البيانات', 'ai_clr')],
  ]);
}

// ═══════════════════════════════════════════════════════════
//  التثبيت
// ═══════════════════════════════════════════════════════════
module.exports = function setupAI(bot) {

  const { DEVELOPER_ID } = require('./config');
  const isDev = ctx => ctx.from?.id === DEVELOPER_ID;

  // ── /ai لوحة التحكم ──────────────────────────────────────
  bot.command('ai', async (ctx) => {
    if (!isDev(ctx)) return;
    if (ctx.chat.type !== 'private') return ctx.reply('افتح الأمر في الخاص مع البوت.');
    await ctx.replyWithMarkdown(panelText(), panelMarkup());
  });

  bot.action('ai_panel', async (ctx) => {
    if (!isDev(ctx)) return ctx.answerCbQuery('⛔');
    await ctx.answerCbQuery();
    await ctx.editMessageText(panelText(), { parse_mode: 'Markdown', ...panelMarkup() });
  });

  // ── تشغيل/إيقاف ──────────────────────────────────────────
  bot.action('ai_toggle', async (ctx) => {
    if (!isDev(ctx)) return ctx.answerCbQuery('⛔');
    cfg.enabled = !cfg.enabled;
    await ctx.answerCbQuery(cfg.enabled ? '✅ تم التشغيل' : '⛔ تم الإيقاف');
    await ctx.editMessageText(panelText(), { parse_mode: 'Markdown', ...panelMarkup() });
  });

  // ── قروبات المراقبة ──────────────────────────────────────
  bot.action('ai_mon', async (ctx) => {
    if (!isDev(ctx)) return ctx.answerCbQuery('⛔');
    await ctx.answerCbQuery();
    const groups = db.allGroups();
    if (!groups.length) return ctx.answerCbQuery('⚠️ لا يوجد قروبات مسجّلة', { show_alert: true });
    const btns = groups.map(g => {
      const on = cfg.monitorGroups.includes(g.chatId);
      return [Markup.button.callback(`${on ? '✅' : '☑️'} ${(g.title || String(g.chatId)).slice(0, 28)}`, `aim_${g.chatId}`)];
    });
    btns.push([Markup.button.callback('✅ مراقبة الكل', 'aim_all'), Markup.button.callback('🔙 رجوع', 'ai_back')]);
    const note = cfg.monitorGroups.length === 0 ? '_(الكل مراقَب)_' : `_(${cfg.monitorGroups.length} محدد)_`;
    await ctx.editMessageText(`👁️ *قروبات المراقبة*\n${note}`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) });
  });

  bot.action(/^aim_(-?\d+)$/, async (ctx) => {
    if (!isDev(ctx)) return ctx.answerCbQuery('⛔');
    const id = Number(ctx.match[1]);
    const arr = [...cfg.monitorGroups];
    const i = arr.indexOf(id);
    if (i >= 0) arr.splice(i, 1); else arr.push(id);
    cfg.monitorGroups = arr;
    await ctx.answerCbQuery(i >= 0 ? '❌ أُزيل' : '✅ أُضيف');
    const groups = db.allGroups();
    const btns = groups.map(g => {
      const on = cfg.monitorGroups.includes(g.chatId);
      return [Markup.button.callback(`${on ? '✅' : '☑️'} ${(g.title || String(g.chatId)).slice(0, 28)}`, `aim_${g.chatId}`)];
    });
    btns.push([Markup.button.callback('✅ مراقبة الكل', 'aim_all'), Markup.button.callback('🔙 رجوع', 'ai_back')]);
    await ctx.editMessageText(`👁️ *قروبات المراقبة*\n_(${cfg.monitorGroups.length} محدد)_`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) });
  });

  bot.action('aim_all', async (ctx) => {
    if (!isDev(ctx)) return ctx.answerCbQuery('⛔');
    cfg.monitorGroups = [];
    await ctx.answerCbQuery('✅ الكل مراقَب');
    await ctx.editMessageText(panelText(), { parse_mode: 'Markdown', ...panelMarkup() });
  });

  // ── قروبات الرد ──────────────────────────────────────────
  bot.action('ai_rep', async (ctx) => {
    if (!isDev(ctx)) return ctx.answerCbQuery('⛔');
    await ctx.answerCbQuery();
    const groups = db.allGroups();
    if (!groups.length) return ctx.answerCbQuery('⚠️ لا يوجد قروبات مسجّلة', { show_alert: true });
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
    const arr = [...cfg.replyGroups];
    const i = arr.indexOf(id);
    if (i >= 0) arr.splice(i, 1); else arr.push(id);
    cfg.replyGroups = arr;
    await ctx.answerCbQuery(i >= 0 ? '❌ أُزيل' : '✅ أُضيف');
    const groups = db.allGroups();
    const btns = groups.map(g => {
      const on = cfg.replyGroups.includes(g.chatId);
      return [Markup.button.callback(`${on ? '✅' : '☑️'} ${(g.title || String(g.chatId)).slice(0, 28)}`, `air_${g.chatId}`)];
    });
    btns.push([Markup.button.callback('🔙 رجوع', 'ai_back')]);
    await ctx.editMessageText(`💬 *قروبات الرد*\n_(${cfg.replyGroups.length} محدد)_`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) });
  });

  bot.action('ai_rep_all', async (ctx) => {
    if (!isDev(ctx)) return ctx.answerCbQuery('⛔');
    const groups = db.allGroups();
    if (!groups.length) return ctx.answerCbQuery('⚠️ لا يوجد قروبات', { show_alert: true });
    cfg.replyGroups = groups.map(g => g.chatId);
    await ctx.answerCbQuery(`✅ الرد مفعّل في ${cfg.replyGroups.length} قروب`, { show_alert: true });
    await ctx.editMessageText(panelText(), { parse_mode: 'Markdown', ...panelMarkup() });
  });

  bot.action('ai_rep_none', async (ctx) => {
    if (!isDev(ctx)) return ctx.answerCbQuery('⛔');
    cfg.replyGroups = [];
    await ctx.answerCbQuery('✅ تم إيقاف الرد في كل القروبات');
    await ctx.editMessageText(panelText(), { parse_mode: 'Markdown', ...panelMarkup() });
  });

  // ── إحصائيات ─────────────────────────────────────────────
  bot.action('ai_stats', async (ctx) => {
    if (!isDev(ctx)) return ctx.answerCbQuery('⛔');
    await ctx.answerCbQuery();
    const total    = qaStore.size;
    const answered = qaStore.values().filter(e => e.a).length;
    const top5     = qaStore.values()
      .filter(e => e.a)
      .sort((a, b) => (b.count || 1) - (a.count || 1))
      .slice(0, 5);
    let txt = `📊 *إحصائيات قاعدة المعرفة*\n\nالكلي: *${total}* | مجاب: *${answered}* | بدون إجابة: *${total - answered}*\n\n`;
    if (top5.length) {
      txt += `🔥 *الأكثر تكراراً:*\n`;
      top5.forEach((e, i) => { txt += `${i + 1}. _(${e.count}x)_ ${e.q.slice(0, 45)}\n`; });
    }
    await ctx.editMessageText(txt, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', 'ai_back')]]),
    });
  });

  // ── مسح ──────────────────────────────────────────────────
  bot.action('ai_clr', async (ctx) => {
    if (!isDev(ctx)) return ctx.answerCbQuery('⛔');
    await ctx.answerCbQuery();
    await ctx.editMessageText('⚠️ *هل أنت متأكد من مسح كل الأسئلة والأجوبة؟*', {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🗑️ نعم، امسح', 'ai_clr_yes'), Markup.button.callback('❌ إلغاء', 'ai_back')],
      ]),
    });
  });

  bot.action('ai_clr_yes', async (ctx) => {
    if (!isDev(ctx)) return ctx.answerCbQuery('⛔');
    qaStore.clear();
    await ctx.answerCbQuery('✅ تم المسح');
    await ctx.editMessageText(panelText(), { parse_mode: 'Markdown', ...panelMarkup() });
  });

  // ── رجوع ─────────────────────────────────────────────────
  bot.action('ai_back', async (ctx) => {
    if (!isDev(ctx)) return ctx.answerCbQuery('⛔');
    await ctx.answerCbQuery();
    await ctx.editMessageText(panelText(), { parse_mode: 'Markdown', ...panelMarkup() });
  });

  // ═══════════════════════════════════════════════════════════
  //  رادار المجموعات — مراقبة صامتة + جمع + رد محلي
  // ═══════════════════════════════════════════════════════════
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

      const chatTitle = chat.title || String(chat.id);

      // تسجيل سؤال
      if (isQuestion(text)) {
        recordQ(text, from, chat.id, chatTitle);
      }

      // تسجيل رد على سؤال
      if (msg.reply_to_message) {
        const orig     = msg.reply_to_message.text || msg.reply_to_message.caption || '';
        const origFrom = msg.reply_to_message.from;
        if (orig && origFrom && !origFrom.is_bot && isQuestion(orig)) {
          const h = makeHash(orig);
          if (!qaStore.has(h)) recordQ(orig, origFrom, chat.id, chatTitle);
          if (text.length >= cfg.minAnswerLen) recordA(h, text, from);
        }
      }

      // الرد من قاعدة البيانات المحلية
      if (cfg.replyGroups.includes(chat.id) && isQuestion(text)) {
        const result = findAnswer(text);
        if (result) {
          await ctx.reply(result.a, { reply_to_message_id: msg.message_id });
          const h = makeHash(text);
          if (!qaStore.has(h)) recordQ(text, from, chat.id, chatTitle);
          recordA(h, result.a, { id: 0, first_name: 'مجتمع' });
        }
      }

    } catch (e) { /* صمت تام */ }

    return next();
  });

};
