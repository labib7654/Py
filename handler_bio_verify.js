// ══════════════════════════════════════════════════════════════════════
//  🔍 نظام التحقق من النبذة — High Precision Bio Verification
//
//  يجمع الكلمات المحظورة من كل مجموعة وقناة أُضيف إليها البوت
//  (ليس فقط المجتمعات — بل كل الكلمات المحظورة في قاعدة البيانات)
//
//  يُفحص الشخص في هذه الحالات:
//  ① أي رسالة خاصة للبوت (سواء كان يراسله لأول مرة أو قديماً)
//  ② طلب انضمام لأي مجموعة
//  ③ انضمام عضو جديد لأي مجموعة (chat_member)
//
//  عند اكتشاف كلمة محظورة في النبذة:
//  ✦ يُحظر من كل مجموعات البوت (ليس فقط المجتمع)
//  ✦ يُسجَّل في قائمة المحظورين: يوزر + ID + رابط + كلمة + النبذة
//  ✦ يُبلَّغ المطور + مالك كل مجموعة + قنوات السجلات
//  ✦ يُرسَل له إشعار ثم تُحذف المحادثة من جانب البوت
//  ✦ فك الحظر: /bio_unban <id> من المطور فقط
// ══════════════════════════════════════════════════════════════════════

'use strict';

const db               = require('./db');
const { DEVELOPER_ID } = require('./config');
const { isDeveloper }  = require('./helpers');

// ══════════════════════════════════════════════════════════════════════
//  Cache — يمنع فحص نفس المستخدم أكثر من مرة كل 5 دقائق
// ══════════════════════════════════════════════════════════════════════
const _cache = new Map(); // userId -> { ts, passed }
const CACHE_TTL = 5 * 60 * 1000;

function _isCached(userId) {
  const e = _cache.get(userId);
  if (!e) return false;
  if (!e.passed) return true; // محظور -> skip دائماً
  return (Date.now() - e.ts) < CACHE_TTL;
}
function _setCache(userId, passed) {
  _cache.set(userId, { ts: Date.now(), passed });
  if (_cache.size > 1000) {
    const now = Date.now();
    for (const [k, v] of _cache) {
      if (v.passed && (now - v.ts) > CACHE_TTL) _cache.delete(k);
    }
  }
}
function _clearCache(userId) { _cache.delete(userId); }

// ══════════════════════════════════════════════════════════════════════
//  جمع كل الكلمات المحظورة من كل المجموعات
// ══════════════════════════════════════════════════════════════════════
function _collectBannedWords() {
  const words = new Set();
  for (const g of db.allGroups()) {
    for (const bw of (g.bannedWords || [])) {
      if (bw.word && bw.word.trim()) words.add(bw.word.toLowerCase().trim());
    }
  }
  return words;
}

// ══════════════════════════════════════════════════════════════════════
//  فحص النبذة ضد الكلمات — يُعيد الكلمة المخالفة أو null
// ══════════════════════════════════════════════════════════════════════
function _matchBio(bio, words) {
  if (!bio || !words.size) return null;
  const lower = bio.toLowerCase();
  for (const w of words) {
    if (lower.includes(w)) return w;
  }
  return null;
}

// ══════════════════════════════════════════════════════════════════════
//  جلب النبذة من Telegram
// ══════════════════════════════════════════════════════════════════════
async function _fetchBio(bot, userId) {
  try {
    const chat = await bot.telegram.getChat(userId);
    return (chat.bio || '').trim();
  } catch { return ''; }
}

// ══════════════════════════════════════════════════════════════════════
//  تنفيذ الحظر الشامل
// ══════════════════════════════════════════════════════════════════════
async function _executeBan(bot, user, bio, word) {
  const uid  = user.id;
  const name = user.username ? '@' + user.username : (user.first_name || String(uid));
  const link = user.username ? 'https://t.me/' + user.username : 'tg://user?id=' + uid;

  // 1. تحديث قاعدة البيانات
  const rec        = db.getOrCreateUser(uid, user.username || '', user.first_name || '');
  rec.globalBanned = true;
  rec.bannedReason = 'نبذة محظورة — كلمة: "' + word + '"';
  rec.bannedAt     = new Date();
  rec.bioBanInfo   = {
    word,
    bio:      bio.slice(0, 300),
    bannedAt: new Date().toISOString(),
    unbanBy:  'developer_only',
  };
  db.markDirty();
  _setCache(uid, false);

  // 2. رسالة الإشعار
  const preview = bio.length > 150 ? bio.slice(0, 150) + '...' : bio;
  const notice =
    '\u{1F6AB} *حظر تلقائي \u2014 نبذة محظورة*\n\n' +
    '\u{1F464} [' + name + '](' + link + ')\n' +
    '\u{1F194} `' + uid + '`\n' +
    '\u{1F524} الكلمة: `' + word + '`\n' +
    '\u{1F4DD} النبذة:\n```\n' + preview + '\n```\n' +
    '\u{1F550} ' + new Date().toLocaleString('ar') + '\n\n' +
    '_لرفع الحظر: /bio\\_unban ' + uid + '_';

  // 3. حظر من كل المجموعات + إبلاغ المالكين
  const notified = new Set();
  for (const g of db.allGroups()) {
    // حظر
    try {
      await bot.telegram.banChatMember(g.chatId, uid);
      g.bannedUsers.add(uid);
    } catch {}

    // قناة السجلات
    if (g.logChannelId) {
      try {
        await bot.telegram.sendMessage(g.logChannelId, notice, {
          parse_mode: 'Markdown', disable_web_page_preview: true,
        });
      } catch {}
    }

    // المالك (مرة واحدة فقط)
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
            reason: 'نبذة محظورة — كلمة: "' + word + '"',
            bio:    bio.slice(0, 200),
            bannedAt: new Date(),
          });
        }
      }
    }
  }

  // 4. إبلاغ المطور
  try {
    await bot.telegram.sendMessage(DEVELOPER_ID, notice, {
      parse_mode: 'Markdown', disable_web_page_preview: true,
    });
  } catch {}

  // 5. إشعار الشخص ثم حذف المحادثة
  try {
    await bot.telegram.sendMessage(uid,
      '\u{1F6AB} *تم حظرك تلقائياً*\n\nنبذتك تحتوي على كلمة غير مسموح بها.\nللاعتراض تواصل مع إدارة المجموعة.',
      { parse_mode: 'Markdown' }
    );
  } catch {}
  try { await bot.telegram.callApi('deleteChat', { chat_id: uid }); } catch {}
}

// ══════════════════════════════════════════════════════════════════════
//  الدالة الرئيسية — verifyUserBio
//  تُعيد true إذا كان محظوراً، false إذا كان آمناً
// ══════════════════════════════════════════════════════════════════════
async function verifyUserBio(bot, user) {
  if (!user || user.is_bot) return false;
  if (user.id === DEVELOPER_ID) return false;

  // محظور مسبقاً
  const rec = db.getUser(user.id);
  if (rec && rec.globalBanned) return true;

  // cache hit
  if (_isCached(user.id)) return false;

  // لا كلمات محظورة أصلاً
  const words = _collectBannedWords();
  if (!words.size) {
    _setCache(user.id, true);
    return false;
  }

  // جلب النبذة
  const bio = await _fetchBio(bot, user.id);
  if (!bio) {
    _setCache(user.id, true);
    return false;
  }

  // فحص
  const hit = _matchBio(bio, words);
  if (!hit) {
    _setCache(user.id, true);
    return false;
  }

  // تنفيذ الحظر
  await _executeBan(bot, user, bio, hit);
  return true;
}

// ══════════════════════════════════════════════════════════════════════
//  تسجيل الـ Handlers
// ══════════════════════════════════════════════════════════════════════
module.exports = function setupBioVerify(bot) {

  // ① رسائل الخاص — كل رسالة بدون استثناء
  bot.on('message', async (ctx, next) => {
    if (ctx.chat && ctx.chat.type !== 'private') return next();
    if (!ctx.from || isDeveloper(ctx)) return next();
    const banned = await verifyUserBio(bot, ctx.from);
    if (banned) return;
    return next();
  });

  // ② طلبات الانضمام
  bot.on('chat_join_request', async (ctx, next) => {
    const user = ctx.chatJoinRequest && ctx.chatJoinRequest.from;
    if (!user) return next();
    const banned = await verifyUserBio(bot, user);
    if (banned) {
      try { await bot.telegram.declineChatJoinRequest(ctx.chat.id, user.id); } catch {}
      return;
    }
    return next();
  });

  // ③ انضمام عضو جديد
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
    const banned = await verifyUserBio(bot, user);
    if (banned) {
      try { await bot.telegram.banChatMember(upd.chat.id, user.id); } catch {}
      return;
    }
    return next();
  });

  // ════════════════════════════════════════════════════════════
  //  أوامر المطور
  // ════════════════════════════════════════════════════════════

  // رفع الحظر
  bot.command('bio_unban', async (ctx) => {
    if (!isDeveloper(ctx)) return;
    const uid = Number((ctx.message.text.split(' ')[1] || '').trim());
    if (!uid) {
      return ctx.replyWithMarkdown('🔓 الاستخدام: `/bio_unban <user_id>`');
    }
    const rec = db.getUser(uid);
    if (!rec) return ctx.reply('❌ المستخدم غير موجود.');
    if (!rec.globalBanned) return ctx.reply('ℹ️ المستخدم غير محظور.');

    const info      = rec.bioBanInfo || {};
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
    for (const com of db.allCommunities()) { com.autoBannedUsers && com.autoBannedUsers.delete(uid); }

    const name = rec.username ? '@' + rec.username : rec.firstName || String(uid);
    await ctx.replyWithMarkdown(
      '✅ *تم رفع الحظر*\n\n' +
      '👤 ' + name + ' `[' + uid + ']`\n' +
      '🔤 الكلمة: `' + (info.word || '—') + '`\n' +
      '📋 رُفع من ' + count + ' مجموعة'
    );
    try { await bot.telegram.sendMessage(uid, '✅ تم رفع حظرك. يمكنك مراسلة البوت والانضمام للمجموعات.'); } catch {}
  });

  // قائمة المحظورين
  bot.command('bio_bans', async (ctx) => {
    if (!isDeveloper(ctx)) return;
    const list = db.allUsers().filter(u => u.globalBanned && u.bioBanInfo);
    if (!list.length) return ctx.replyWithMarkdown('🔍 *لا يوجد محظورون بسبب النبذة.*');

    let text = '🚫 *المحظورون بسبب النبذة* (' + list.length + ')\n\n';
    list.slice(0, 20).forEach((u, i) => {
      const n    = u.username ? '@' + u.username : u.firstName || String(u.userId);
      const href = u.username ? 'https://t.me/' + u.username : 'tg://user?id=' + u.userId;
      const info = u.bioBanInfo || {};
      text += (i + 1) + '. [' + n + '](' + href + ') `' + u.userId + '`\n';
      text += '   🔤 `' + (info.word || '—') + '` | 🕐 ' + (info.bannedAt ? new Date(info.bannedAt).toLocaleDateString('ar') : '—') + '\n\n';
    });
    if (list.length > 20) text += '_...و' + (list.length - 20) + ' آخرين_\n';
    text += '\n_/bio\\_unban <id>_';
    await ctx.replyWithMarkdown(text, { disable_web_page_preview: true });
  });

  // فحص يدوي فوري
  bot.command('bio_check', async (ctx) => {
    if (!isDeveloper(ctx)) return;
    const uid = Number((ctx.message.text.split(' ')[1] || '').trim());
    if (!uid) return ctx.reply('❌ مثال: /bio_check 123456789');

    _clearCache(uid);
    await ctx.reply('🔍 جاري الفحص...');

    const bio   = await _fetchBio(bot, uid);
    const words = _collectBannedWords();

    if (!bio) return ctx.replyWithMarkdown('ℹ️ المستخدم `' + uid + '` لا يملك نبذة.');

    const hit = _matchBio(bio, words);
    if (!hit) {
      return ctx.replyWithMarkdown(
        '✅ *النبذة نظيفة*\n\n' +
        '👤 `' + uid + '`\n' +
        '📝 `' + bio.slice(0, 200) + '`'
      );
    }

    await ctx.replyWithMarkdown('🔴 مخالفة — جاري الحظر...\n🔤 `' + hit + '`');
    const rec = db.getUser(uid);
    await _executeBan(bot, {
      id:         uid,
      username:   rec && rec.username || '',
      first_name: rec && rec.firstName || String(uid),
      is_bot:     false,
    }, bio, hit);
  });
};

// تصدير للاستخدام الخارجي
module.exports.verifyUserBio = verifyUserBio;
