'use strict';
// ══════════════════════════════════════════════════════════════════════
//  handler_bio_verify.js — نظام التحقق من النبذة (Bio Verification)
//
//  عند اكتشاف كلمة محظورة في النبذة:
//  ✦ يُحظر الشخص من كل مجموعات البوت
//  ✦ يُرسل البوت إشعاراً للشخص ثم يغادر المحادثة
//  ✦ يُبلَّغ المطور + مالك القروب + قنوات السجلات
//  ✦ فك الحظر: /bio_unban <id> من المطور فقط
// ══════════════════════════════════════════════════════════════════════

const db               = require('./db');
const { DEVELOPER_ID } = require('./config');
const { isDeveloper }  = require('./helpers');

// ── Cache — يمنع فحص نفس المستخدم اكثر من مرة كل 5 دقائق ───────────
const _cache  = new Map(); // userId -> { ts, passed }
const CACHE_TTL = 5 * 60 * 1000;

function _isCached(uid) {
  const e = _cache.get(uid);
  if (!e) return false;
  if (!e.passed) return true; // محظور -> skip دائما
  return (Date.now() - e.ts) < CACHE_TTL;
}

function _setCache(uid, passed) {
  _cache.set(uid, { ts: Date.now(), passed });
  if (_cache.size > 1000) {
    const now = Date.now();
    for (const [k, v] of _cache)
      if (v.passed && (now - v.ts) > CACHE_TTL) _cache.delete(k);
  }
}

function _clearCache(uid) { _cache.delete(uid); }

// ── جلب النبذة من Telegram ──────────────────────────────────────────
async function _fetchBio(bot, uid) {
  try { return ((await bot.telegram.getChat(uid)).bio || '').trim(); }
  catch { return ''; }
}

// ── فحص النبذة ضد مجموعة كلمات ────────────────────────────────────
// words: Set<string> او Array<string>
// يُعيد الكلمة المخالفة او null
function _matchBio(bio, words) {
  if (!bio || !words || !words.size) return null;
  const lower = bio.toLowerCase();
  for (const w of words) {
    if (w && lower.includes(w.toLowerCase().trim())) return w;
  }
  return null;
}

// ── جمع كلمات مجموعة واحدة ─────────────────────────────────────────
function _wordsOfGroup(chatId) {
  const g = db.getGroup(chatId);
  if (!g || !g.bannedWords || !g.bannedWords.length) return new Set();
  return new Set(
    g.bannedWords
      .map(bw => bw.word && bw.word.toLowerCase().trim())
      .filter(Boolean)
  );
}

// ── جمع كل الكلمات من كل المجموعات ────────────────────────────────
function _allWords() {
  const words = new Set();
  for (const g of db.allGroups())
    for (const bw of (g.bannedWords || []))
      if (bw.word && bw.word.trim()) words.add(bw.word.toLowerCase().trim());
  return words;
}

// ══════════════════════════════════════════════════════════════════════
//  تنفيذ الحظر الشامل
//  sourceGroupId: القروب الذي جاء منه الحدث
// ══════════════════════════════════════════════════════════════════════
async function _executeBan(bot, user, bio, word, sourceGroupId) {
  const uid  = user.id;
  const name = user.username ? '@' + user.username : (user.first_name || String(uid));
  const link = user.username
    ? 'https://t.me/' + user.username
    : 'tg://user?id=' + uid;

  // ── 1. تحديث قاعدة البيانات ─────────────────────────────────────
  const rec        = db.getOrCreateUser(uid, user.username || '', user.first_name || '');
  rec.globalBanned = true;
  rec.bannedReason = 'نبذة محظورة - كلمة: "' + word + '"';
  rec.bannedAt     = new Date();
  rec.bioBanInfo   = {
    word,
    bio:         bio.slice(0, 300),
    bannedAt:    new Date().toISOString(),
    sourceGroup: sourceGroupId || null,
    unbanBy:     'developer_only',
  };
  db.markDirty();
  _setCache(uid, false);

  // ── 2. بناء رسالة الاشعار للمشرفين ─────────────────────────────
  const notifText =
    `🚫 *حظر تلقائي — نبذة محظورة*\n\n` +
    `👤 [${name}](${link})\n` +
    `🆔 \`${uid}\`\n` +
    `🔤 الكلمة: \`${word}\`\n` +
    `📝 النبذة:\n\`\`\`\n${bio.slice(0, 200)}\n\`\`\`\n` +
    `🕐 ${new Date().toLocaleString('ar-SA')}`;

  // ── 3. حظر من كل المجموعات ──────────────────────────────────────
  const notified = new Set();

  for (const g of db.allGroups()) {
    // حظر
    try { await bot.telegram.banChatMember(g.chatId, uid); } catch {}

    // ابلاغ المالك (مرة واحدة فقط)
    if (g.ownerId && !notified.has(g.ownerId)) {
      try {
        await bot.telegram.sendMessage(g.ownerId, notifText, { parse_mode: 'Markdown' });
        notified.add(g.ownerId);
      } catch {}
    }

    // ابلاغ قناة السجلات
    if (g.logChannelId) {
      try {
        await bot.telegram.sendMessage(g.logChannelId, notifText, { parse_mode: 'Markdown' });
      } catch {}
    }
  }

  // ── 4. ابلاغ المطور ─────────────────────────────────────────────
  if (DEVELOPER_ID && !notified.has(Number(DEVELOPER_ID))) {
    try {
      await bot.telegram.sendMessage(DEVELOPER_ID, notifText, { parse_mode: 'Markdown' });
    } catch {}
  }

  // ── 5. اشعار الشخص المحظور ثم مغادرة المحادثة ──────────────────
  try {
    await bot.telegram.sendMessage(uid,
      `🚫 *تم حظرك تلقائياً*\n\n` +
      `سبب الحظر: نبذتك تحتوي على محتوى محظور.\n\n` +
      `_للاعتراض تواصل مع المطور._`,
      { parse_mode: 'Markdown' }
    );
  } catch {}

  try { await bot.telegram.leaveChat(uid); } catch {}
}

// ══════════════════════════════════════════════════════════════════════
//  الدالة الرئيسية للفحص
// ══════════════════════════════════════════════════════════════════════
async function checkBio(bot, user, sourceGroupId, wordsOverride) {
  const uid = user.id;
  if (_isCached(uid)) return;

  const words = wordsOverride || (sourceGroupId ? _wordsOfGroup(sourceGroupId) : _allWords());
  if (!words.size) { _setCache(uid, true); return; }

  const bio = await _fetchBio(bot, uid);
  const hit = _matchBio(bio, words);

  if (hit) {
    await _executeBan(bot, user, bio, hit, sourceGroupId);
  } else {
    _setCache(uid, true);
  }
}

// ══════════════════════════════════════════════════════════════════════
//  تسجيل المعالجات
// ══════════════════════════════════════════════════════════════════════
module.exports = function setupBioVerify(bot) {

  // ── رسائل الخاص — فحص بكل الكلمات ──────────────────────────────
  bot.on('message', async (ctx, next) => {
    if (ctx.chat?.type !== 'private') return next();
    const u = ctx.from;
    if (!u || u.is_bot) return next();

    const rec = db.getUser(u.id);
    if (rec?.globalBanned) {
      try { await ctx.deleteMessage(); } catch {}
      return; // لا نكمل
    }

    // فحص في الخلفية دون تأخير المعالج
    checkBio(bot, u, null).catch(() => {});
    return next();
  });

  // ── طلب انضمام — فحص بكلمات ذلك القروب ─────────────────────────
  bot.on('chat_join_request', async (ctx, next) => {
    const req = ctx.chatJoinRequest;
    if (!req) return next();

    const u      = req.from;
    const chatId = req.chat.id;

    if (!u || u.is_bot) return next();

    const rec = db.getUser(u.id);
    if (rec?.globalBanned) {
      try { await bot.telegram.declineChatJoinRequest(chatId, u.id); } catch {}
      return; // لا نكمل
    }

    const words = _wordsOfGroup(chatId);
    if (words.size) {
      const bio = await _fetchBio(bot, u.id);
      const hit = _matchBio(bio, words);
      if (hit) {
        try { await bot.telegram.declineChatJoinRequest(chatId, u.id); } catch {}
        await _executeBan(bot, u, bio, hit, chatId);
        return; // لا نكمل لنظام التحقق
      }
    }

    return next();
  });

  // ── انضمام فعلي (chat_member) — فحص بكلمات تلك المجموعة ─────────
  bot.on('chat_member', async (ctx, next) => {
    const upd = ctx.chatMember;
    if (!upd) return next();

    const newM = upd.new_chat_member;
    const oldM = upd.old_chat_member;
    const u    = newM?.user;

    if (!u || u.is_bot) return next();
    if (!(newM.status === 'member' &&
          (oldM.status === 'left' || oldM.status === 'kicked'))) return next();

    const chatId = upd.chat.id;

    const rec = db.getUser(u.id);
    if (rec?.globalBanned) {
      try { await bot.telegram.banChatMember(chatId, u.id); } catch {}
      return;
    }

    const words = _wordsOfGroup(chatId);
    if (words.size) {
      const bio = await _fetchBio(bot, u.id);
      const hit = _matchBio(bio, words);
      if (hit) {
        await _executeBan(bot, u, bio, hit, chatId);
        return;
      }
    }

    return next();
  });

  // ── امر فك الحظر /bio_unban <id> — للمطور فقط ───────────────────
  bot.command('bio_unban', async (ctx) => {
    if (!isDeveloper(ctx)) return;

    const parts = ctx.message.text.trim().split(/\s+/);
    const uid   = Number(parts[1]);
    if (!uid) return ctx.reply('الاستخدام: /bio_unban <user_id>');

    const rec = db.getUser(uid);
    if (!rec) return ctx.reply(`لا يوجد مستخدم بالمعرف \`${uid}\``, { parse_mode: 'Markdown' });
    if (!rec.globalBanned) return ctx.reply(`المستخدم \`${uid}\` غير محظور.`, { parse_mode: 'Markdown' });

    rec.globalBanned = false;
    rec.bannedReason = null;
    rec.bioBanInfo   = null;
    db.markDirty();
    _clearCache(uid);

    // فك الحظر من كل المجموعات
    let unbanned = 0;
    for (const g of db.allGroups()) {
      try { await bot.telegram.unbanChatMember(g.chatId, uid, { only_if_banned: true }); unbanned++; } catch {}
    }

    await ctx.reply(
      `✅ *تم فك حظر* \`${uid}\`\n` +
      `فُك الحظر من \`${unbanned}\` مجموعة.`,
      { parse_mode: 'Markdown' }
    );
  });

};
