// ══════════════════════════════════════════════════════════════════════
//  🔍 نظام التحقق من النبذة — Bio Verification System
//
//  الكلمات المحظورة المستخدمة للفحص:
//  • رسائل الخاص    → كل الكلمات المحظورة من كل مجموعات البوت
//  • طلب انضمام    → كلمات ذلك القروب تحديداً
//  • انضمام فعلي   → كلمات تلك المجموعة تحديداً
//
//  عند اكتشاف مخالفة:
//  ✦ يُحظر من كل مجموعات البوت
//  ✦ البوت يُرسل إشعاراً للشخص ثم يغادر محادثته (leaveChat)
//    → المحادثة تختفي من قائمته تلقائياً
//  ✦ يُبلَّغ المطور + مالك القروب المعني + قنوات السجلات
//  ✦ فك الحظر: /bio_unban <id> من المطور فقط
// ══════════════════════════════════════════════════════════════════════

'use strict';

const db               = require('./db');
const { DEVELOPER_ID } = require('./config');
const { isDeveloper }  = require('./helpers');

// ── Cache — يمنع فحص نفس المستخدم أكثر من مرة كل 5 دقائق ──────────
const _cache = new Map(); // userId -> { ts, passed }
const CACHE_TTL = 5 * 60 * 1000;

function _isCached(uid) {
  const e = _cache.get(uid);
  if (!e) return false;
  if (!e.passed) return true;                       // محظور → skip دائماً
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
// words: Set<string> أو Array<string>
// يُعيد الكلمة المخالفة أو null
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
  return new Set(g.bannedWords.map(bw => bw.word && bw.word.toLowerCase().trim()).filter(Boolean));
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
//  sourceGroupId: القروب الذي جاء منه الحدث (لإبلاغ مالكه تحديداً أولاً)
// ══════════════════════════════════════════════════════════════════════
async function _executeBan(bot, user, bio, word, sourceGroupId) {
  const uid  = user.id;
  const name = user.username ? '@' + user.username : (user.first_name || String(uid));
  const link = user.username ? 'https://t.me/' + user.username : 'tg://user?id=' + uid;

  // ── 1. تحديث قاعدة البيانات ─────────────────────────────────────
  const rec        = db.getOrCreateUser(uid, user.username || '', user.first_name || '');
  rec.globalBanned = true;
  rec.bannedReason = 'نبذة محظورة — كلمة: "' + word + '"';
  rec.bannedAt     = new Date();
  rec.bioBanInfo   = {
    word,
    bio:        bio.slice(0, 300),
    bannedAt:   new Date().toISOString(),
    sourceGroup: sourceGroupId || null,
    unbanBy:    'developer_only',
  };
  db.markDirty();
  _setCache(uid, false);

  // ── 2. بناء رسالة الإشعار ───────────────────────────────────────
  const bioPreview = bio.length > 150 ? bio.slice(0, 150) + '...' : bio;
  const sourceG    = sourceGroupId ? db.getGroup(sourceGroupId) : null;

  const notice =
    '🚫 *حظر تلقائي — نبذة محظورة*\n\n' +
    '👤 [' + name + '](' + link + ')\n' +
    '🆔 `' + uid + '`\n' +
    '🔤 الكلمة: `' + word + '`\n' +
    '📝 النبذة:\n```\n' + bioPreview + '\n```\n' +
    (sourceG ? '📌 القروب: *' + sourceG.title + '*\n' : '') +
    '🕐 ' + new Date().toLocaleString('ar') + '\n\n' +
    '_لرفع الحظر: /bio\\_unban ' + uid + '_';

  // ── 3. حظر من كل المجموعات + إبلاغ المالكين ────────────────────
  const notified = new Set();

  // نبدأ بمالك القروب المصدر (أولوية)
  if (sourceG && sourceG.ownerId && !notified.has(sourceG.ownerId)) {
    notified.add(sourceG.ownerId);
    try {
      await bot.telegram.sendMessage(sourceG.ownerId, notice, {
        parse_mode: 'Markdown', disable_web_page_preview: true,
      });
    } catch {}
  }

  for (const g of db.allGroups()) {
    // حظر
    try { await bot.telegram.banChatMember(g.chatId, uid); g.bannedUsers.add(uid); } catch {}

    // قناة السجلات
    if (g.logChannelId) {
      try {
        await bot.telegram.sendMessage(g.logChannelId, notice, {
          parse_mode: 'Markdown', disable_web_page_preview: true,
        });
      } catch {}
    }

    // مالك المجموعة (مرة واحدة لكل مالك)
    if (g.ownerId && !notified.has(g.ownerId)) {
      notified.add(g.ownerId);
      try {
        await bot.telegram.sendMessage(g.ownerId, notice, {
          parse_mode: 'Markdown', disable_web_page_preview: true,
        });
      } catch {}
    }

    // تسجيل في المجتمع إن وُجد
    if (g.communityId) {
      const com = db.getCommunity(g.communityId);
      if (com) {
        if (!com.autoBannedUsers) com.autoBannedUsers = new Map();
        if (!com.autoBannedUsers.has(uid)) {
          com.autoBannedUsers.set(uid, {
            reason:   'نبذة محظورة — كلمة: "' + word + '"',
            bio:      bio.slice(0, 200),
            bannedAt: new Date(),
          });
        }
      }
    }
  }

  // ── 4. إبلاغ المطور ─────────────────────────────────────────────
  try {
    await bot.telegram.sendMessage(DEVELOPER_ID, notice, {
      parse_mode: 'Markdown', disable_web_page_preview: true,
    });
  } catch {}

  // ── 5. إشعار الشخص ثم مغادرة محادثته ───────────────────────────
  // leaveChat: البوت يغادر → المحادثة تختفي من قائمة الشخص تلقائياً
  // (هذا ما يحدث حين يحذف المستخدم محادثة من الجهتين)
  try {
    await bot.telegram.sendMessage(
      uid,
      '🚫 *تم حظرك تلقائياً*\n\nنبذتك تحتوي على كلمة غير مسموح بها.\nللاعتراض تواصل مع إدارة المجموعة.',
      { parse_mode: 'Markdown' }
    );
  } catch {}

  // البوت يغادر → يختفي من قائمة محادثات الشخص
  try { await bot.telegram.leaveChat(uid); } catch {}
}

// ══════════════════════════════════════════════════════════════════════
//  الدالة الرئيسية
//  words: Set<string> — الكلمات المطلوب الفحص بها (محدّدة أو كلها)
//  sourceGroupId: القروب المصدر للإشعار
// ══════════════════════════════════════════════════════════════════════
async function verifyUserBio(bot, user, words, sourceGroupId) {
  if (!user || user.is_bot) return false;
  if (user.id === DEVELOPER_ID) return false;

  // محظور مسبقاً
  const rec = db.getUser(user.id);
  if (rec && rec.globalBanned) return true;

  // cache
  if (_isCached(user.id)) return false;

  if (!words || !words.size) {
    _setCache(user.id, true);
    return false;
  }

  const bio = await _fetchBio(bot, user.id);
  if (!bio) {
    _setCache(user.id, true);
    return false;
  }

  const hit = _matchBio(bio, words);
  if (!hit) {
    _setCache(user.id, true);
    return false;
  }

  await _executeBan(bot, user, bio, hit, sourceGroupId);
  return true;
}

// ══════════════════════════════════════════════════════════════════════
//  تسجيل الـ Handlers
// ══════════════════════════════════════════════════════════════════════
module.exports = function setupBioVerify(bot) {

  // ── ① رسائل الخاص — كل رسالة ─────────────────────────────────
  // يستخدم كل الكلمات المحظورة من كل المجموعات
  bot.on('message', async (ctx, next) => {
    if (!ctx.chat || ctx.chat.type !== 'private') return next();
    if (!ctx.from || isDeveloper(ctx)) return next();

    const words = _allWords();
    const banned = await verifyUserBio(bot, ctx.from, words, null);
    if (banned) return; // لا رد
    return next();
  });

  // ── ② طلبات الانضمام ─────────────────────────────────────────
  // يستخدم كلمات ذلك القروب تحديداً
  bot.on('chat_join_request', async (ctx, next) => {
    const req  = ctx.chatJoinRequest;
    const user = req && req.from;
    if (!user) return next();

    const chatId = ctx.chat.id;
    const words  = _wordsOfGroup(chatId);

    // إذا القروب ما عنده كلمات محظورة → لا فحص نبذة
    if (!words.size) return next();

    const banned = await verifyUserBio(bot, user, words, chatId);
    if (banned) {
      // رفض الطلب + إبلاغ المطور والمالك (تم داخل _executeBan)
      try { await bot.telegram.declineChatJoinRequest(chatId, user.id); } catch {}
      return;
    }
    return next();
  });

  // ── ③ انضمام فعلي ────────────────────────────────────────────
  // يستخدم كلمات تلك المجموعة تحديداً
  bot.on('chat_member', async (ctx, next) => {
    const upd = ctx.chatMember;
    if (!upd) return next();

    const newM = upd.new_chat_member;
    const user = newM && newM.user;
    if (!user || user.is_bot) return next();

    const isJoin =
      (newM.status === 'member' || newM.status === 'restricted') &&
      (upd.old_chat_member.status === 'left' || upd.old_chat_member.status === 'kicked');
    if (!isJoin) return next();

    const chatId = upd.chat.id;
    const words  = _wordsOfGroup(chatId);
    if (!words.size) return next();

    const banned = await verifyUserBio(bot, user, words, chatId);
    if (banned) {
      try { await bot.telegram.banChatMember(chatId, user.id); } catch {}
      return;
    }
    return next();
  });

  // ════════════════════════════════════════════════════════════════
  //  أوامر المطور
  // ════════════════════════════════════════════════════════════════

  // /bio_unban <user_id>
  bot.command('bio_unban', async (ctx) => {
    if (!isDeveloper(ctx)) return;
    const uid = Number((ctx.message.text.split(' ')[1] || '').trim());
    if (!uid) return ctx.replyWithMarkdown('🔓 الاستخدام: `/bio_unban <user_id>`');

    const rec = db.getUser(uid);
    if (!rec)             return ctx.reply('❌ المستخدم غير موجود.');
    if (!rec.globalBanned) return ctx.reply('ℹ️ المستخدم غير محظور.');

    const info       = rec.bioBanInfo || {};
    rec.globalBanned = false;
    rec.bannedReason = '';
    rec.bioBanInfo   = null;
    db.markDirty();
    _clearCache(uid);

    let count = 0;
    for (const g of db.allGroups()) {
      if (!g.bannedUsers.has(uid)) continue;
      try { await bot.telegram.unbanChatMember(g.chatId, uid); g.bannedUsers.delete(uid); count++; } catch {}
    }
    for (const com of db.allCommunities()) {
      if (com.autoBannedUsers) com.autoBannedUsers.delete(uid);
    }

    const name = rec.username ? '@' + rec.username : rec.firstName || String(uid);
    await ctx.replyWithMarkdown(
      '✅ *تم رفع الحظر*\n\n' +
      '👤 ' + name + ' `[' + uid + ']`\n' +
      '🔤 الكلمة: `' + (info.word || '—') + '`\n' +
      '📋 رُفع من ' + count + ' مجموعة'
    );
    try { await bot.telegram.sendMessage(uid, '✅ تم رفع حظرك. يمكنك مراسلة البوت والانضمام للمجموعات.'); } catch {}
  });

  // /bio_bans
  bot.command('bio_bans', async (ctx) => {
    if (!isDeveloper(ctx)) return;
    const list = db.allUsers().filter(u => u.globalBanned && u.bioBanInfo);
    if (!list.length) return ctx.replyWithMarkdown('🔍 *لا يوجد محظورون بسبب النبذة.*');

    let text = '🚫 *المحظورون بسبب النبذة* (' + list.length + ')\n\n';
    list.slice(0, 20).forEach((u, i) => {
      const n    = u.username ? '@' + u.username : u.firstName || String(u.userId);
      const href = u.username ? 'https://t.me/' + u.username : 'tg://user?id=' + u.userId;
      const info = u.bioBanInfo || {};
      text +=
        (i + 1) + '. [' + n + '](' + href + ') `' + u.userId + '`\n' +
        '   🔤 `' + (info.word || '—') + '` | ' +
        '🕐 ' + (info.bannedAt ? new Date(info.bannedAt).toLocaleDateString('ar') : '—') + '\n\n';
    });
    if (list.length > 20) text += '_...و' + (list.length - 20) + ' آخرين_\n';
    text += '\n_/bio\\_unban <id>_';
    await ctx.replyWithMarkdown(text, { disable_web_page_preview: true });
  });

  // /bio_check <user_id> — فحص يدوي فوري
  bot.command('bio_check', async (ctx) => {
    if (!isDeveloper(ctx)) return;
    const uid = Number((ctx.message.text.split(' ')[1] || '').trim());
    if (!uid) return ctx.reply('❌ مثال: /bio_check 123456789');

    _clearCache(uid);
    await ctx.reply('🔍 جاري الفحص...');

    const bio   = await _fetchBio(bot, uid);
    const words = _allWords();

    if (!bio) return ctx.replyWithMarkdown('ℹ️ `' + uid + '` لا يملك نبذة.');

    const hit = _matchBio(bio, words);
    if (!hit) {
      return ctx.replyWithMarkdown(
        '✅ *النبذة نظيفة*\n\n👤 `' + uid + '`\n📝 `' + bio.slice(0, 200) + '`'
      );
    }

    await ctx.replyWithMarkdown('🔴 مخالفة — جاري الحظر...\n🔤 `' + hit + '`');
    const rec = db.getUser(uid);
    await _executeBan(bot,
      { id: uid, username: (rec && rec.username) || '', first_name: (rec && rec.firstName) || String(uid), is_bot: false },
      bio, hit, null
    );
  });
};

// تصدير للاستخدام الخارجي
module.exports.verifyUserBio = verifyUserBio;
