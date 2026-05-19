// ============================================================
//  handler_ai.js — نظام المراقبة الصامتة v1.0
//  يقرأ كل رسالة بصمت تام — لا يرد، لا يظهر، لا يُكشف
//  يحفظ: السؤال، من رد عليه، محتوى الرد، التوقيت
// ============================================================

'use strict';

const db = require('./db');

// ─── دوال مساعدة ─────────────────────────────────────────────

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

// ─── تسجيل سؤال ──────────────────────────────────────────────
function recordQ(text, from, chatId, chatTitle) {
  const h = makeHash(text);
  const existing = db.getAiQA(h);
  if (existing) {
    existing.count = (existing.count || 1) + 1;
    existing.lastAsked = new Date().toISOString();
    db.setAiQA(h, existing);
  } else {
    db.setAiQA(h, {
      hash: h,
      q: text,
      a: null,
      replies: [],
      askedBy: from.id,
      askedByName: from.first_name || from.username || String(from.id),
      askedByUsername: from.username || null,
      chatId,
      chatTitle: chatTitle || String(chatId),
      timestamp: new Date().toISOString(),
      lastAsked: new Date().toISOString(),
      count: 1,
    });
  }
  db.markDirty();
  return h;
}

// ─── تسجيل رد على سؤال ───────────────────────────────────────
function recordReply(qHash, replyText, from, chatId) {
  const entry = db.getAiQA(qHash);
  if (!entry) return;

  // حفظ أفضل رد (الأطول)
  if (!entry.a || replyText.length > entry.a.length) {
    entry.a = replyText;
    entry.answeredBy = from.id;
    entry.answeredByName = from.first_name || from.username || String(from.id);
    entry.answeredByUsername = from.username || null;
    entry.answeredAt = new Date().toISOString();
  }

  // حفظ كل الردود
  if (!entry.replies) entry.replies = [];
  entry.replies.push({
    text: replyText,
    from: from.id,
    fromName: from.first_name || from.username || String(from.id),
    fromUsername: from.username || null,
    at: new Date().toISOString(),
  });

  db.setAiQA(qHash, entry);
  db.markDirty();
}

// ─── تسجيل أي رسالة (حتى غير الأسئلة) ──────────────────────
function recordMessage(text, from, chatId, chatTitle, msgId, replyToMsgId) {
  // نستخدم نفس الـ store لكن بنوع مختلف
  const h = 'msg_' + makeHash(text + String(from.id) + String(msgId));
  db.setAiQA(h, {
    hash: h,
    type: 'message',
    text: text.slice(0, 500),
    from: from.id,
    fromName: from.first_name || from.username || String(from.id),
    fromUsername: from.username || null,
    chatId,
    chatTitle: chatTitle || String(chatId),
    msgId,
    replyToMsgId: replyToMsgId || null,
    timestamp: new Date().toISOString(),
  });
  db.markDirty();
}

// ============================================================
//  التثبيت الرئيسي
// ============================================================
module.exports = function setupAI(bot) {

  // ══════════════════════════════════════════════════════════
  //  مراقبة رسائل المجموعات — صمت تام
  // ══════════════════════════════════════════════════════════
  bot.on('message', async (ctx, next) => {
    try {
      const { from, chat, message: msg } = ctx;

      // تجاهل البوتات والخاص
      if (!from || from.is_bot || !msg) return next();
      if (chat.type !== 'group' && chat.type !== 'supergroup') return next();

      const text = msg.text || msg.caption || '';
      if (!text || text.startsWith('/') || text.length < 2) return next();

      const chatTitle = chat.title || String(chat.id);
      const replyTo   = msg.reply_to_message;

      // ── حالة 1: سؤال مباشر ──────────────────────────────
      if (isQuestion(text)) {
        recordQ(text, from, chat.id, chatTitle);
      }

      // ── حالة 2: رد على سؤال ─────────────────────────────
      if (replyTo && !from.is_bot) {
        const origText = replyTo.text || replyTo.caption || '';
        const origFrom = replyTo.from;

        if (origText && origFrom && !origFrom.is_bot) {
          // إذا الرسالة الأصلية سؤال
          if (isQuestion(origText)) {
            const h = makeHash(origText);
            // سجّل السؤال إن لم يكن مسجلاً
            if (!db.hasAiQA(h)) {
              recordQ(origText, origFrom, chat.id, chatTitle);
            }
            // سجّل الرد
            if (text.length >= 3) {
              recordReply(h, text, from, chat.id);
            }
          }
        }
      }

      // ── حالة 3: تسجيل كل رسالة بصمت (اختياري - للتحليل العميق) ──
      // recordMessage(text, from, chat.id, chatTitle, msg.message_id, replyTo?.message_id);

    } catch (e) {
      // صمت تام — لا نطبع أي خطأ يكشف البوت
    }

    return next();
  });

  // ══════════════════════════════════════════════════════════
  //  مراقبة الرسائل المعدّلة
  // ══════════════════════════════════════════════════════════
  bot.on('edited_message', async (ctx, next) => {
    try {
      const { from, chat } = ctx;
      const msg = ctx.editedMessage;

      if (!from || from.is_bot || !msg) return next();
      if (chat.type !== 'group' && chat.type !== 'supergroup') return next();

      const text = msg.text || msg.caption || '';
      if (!text || text.length < 2) return next();

      // تحديث السجل إن كانت سؤالاً معدّلاً
      if (isQuestion(text)) {
        const h = makeHash(text);
        if (!db.hasAiQA(h)) {
          recordQ(text, from, chat.id, chat.title || String(chat.id));
        }
      }
    } catch (e) {}

    return next();
  });

};
