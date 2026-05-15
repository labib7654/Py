// ============================================================
//  Middleware — فلتر الكلمات + حماية عالمية + Rate Limiting
// ============================================================

const db = require('./db');

// ── Rate Limiting (لكل مستخدم: max 10 رسائل/10 ثوانٍ) ──────
const rateLimitMap = new Map(); // userId → { count, resetAt }
const RATE_LIMIT   = 10;
const RATE_WINDOW  = 10_000; // 10 ثوانٍ

function isRateLimited(userId) {
  const now = Date.now();
  const r   = rateLimitMap.get(userId);
  if (!r || now > r.resetAt) {
    rateLimitMap.set(userId, { count: 1, resetAt: now + RATE_WINDOW });
    return false;
  }
  r.count++;
  if (r.count > RATE_LIMIT) return true;
  return false;
}

// تنظيف الكاش القديم كل دقيقة
setInterval(() => {
  const now = Date.now();
  for (const [uid, r] of rateLimitMap) {
    if (now > r.resetAt) rateLimitMap.delete(uid);
  }
}, 60_000);

// ── كاش الكلمات المحظورة (30 ثانية لكل قروب) ───────────────
const bwordsCache = new Map(); // chatId → { words, expiresAt }
const BWORDS_TTL  = 30_000;

async function getBannedWordsCached(chatId) {
  const now = Date.now();
  const cached = bwordsCache.get(chatId);
  if (cached && now < cached.expiresAt) return cached.words;
  const words = await db.getBannedWords(chatId);
  bwordsCache.set(chatId, { words, expiresAt: now + BWORDS_TTL });
  return words;
}

// مسح كاش القروب عند إضافة/حذف كلمة
function invalidateBwordsCache(chatId) {
  bwordsCache.delete(chatId);
}

// ── Middleware الرئيسي ───────────────────────────────────────
async function globalMiddleware(ctx, next) {
  if (!ctx.from) return next();

  const userId = ctx.from.id;
  const chatId = ctx.chat?.id;

  // تسجيل / تحديث المستخدم
  await db.getOrCreateUser(userId, ctx.from.username || '', ctx.from.first_name || '');
  const user = await db.getUser(userId);

  // حظر عالمي
  if (user?.globalBanned && chatId && ctx.chat?.type !== 'private') {
    try { await ctx.telegram.banChatMember(chatId, userId); } catch { }
    return; // لا نكمل
  }

  // ── فلتر الكلمات المحظورة (في المجموعات فقط) ──────────────
  if (ctx.message && chatId && ctx.chat?.type !== 'private') {

    // Rate limiting — تجاهل المشرفين
    if (isRateLimited(userId)) {
      try { await ctx.deleteMessage(); } catch { }
      return; // لا نكمل حتى لا يُطغي المستخدم الـ handlers
    }

    const text = ctx.message.text || ctx.message.caption || '';
    if (text) {
      // جلب رتبة المستخدم بسرعة (Telegram API)
      let isAdminOrOwner = false;
      try {
        const m = await ctx.telegram.getChatMember(chatId, userId);
        isAdminOrOwner = ['administrator', 'creator'].includes(m.status);
      } catch { }

      // المشرفون والمالك لا يخضعون للفلتر
      if (!isAdminOrOwner) {
        const bwords    = await getBannedWordsCached(chatId);
        const lowerText = text.toLowerCase();
        const found     = bwords.find(bw => lowerText.includes(bw.word.toLowerCase()));

        if (found) {
          // حذف الرسالة المخالفة
          try { await ctx.deleteMessage(); } catch { }

          const userName = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;
          const g        = await db.getGroup(chatId);
          const maxWarns = g?.maxWarns ?? 3;

          if (found.action === 'warn') {
            await db.addWarn(chatId, userId, `كلمة محظورة: ${found.word}`, 0);
            const count = await db.getWarnCount(chatId, userId);
            if (count >= maxWarns) {
              try {
                await ctx.telegram.banChatMember(chatId, userId);
                await db.banUser(chatId, userId);
                await db.clearWarns(chatId, userId);
              } catch { }
              await ctx.reply(`🚫 ${userName} تم حظره تلقائياً بعد ${maxWarns} تحذيرات (كلمة محظورة)`);
            } else {
              await ctx.reply(`⚠️ ${userName} تحذير ${count}/${maxWarns} — رسالتك تحتوي على كلمة محظورة`);
            }
          } else if (found.action === 'mute') {
            try {
              await ctx.telegram.restrictChatMember(chatId, userId, {
                permissions: { can_send_messages: false, can_send_audios: false, can_send_documents: false,
                  can_send_photos: false, can_send_videos: false, can_send_video_notes: false,
                  can_send_voice_notes: false, can_send_polls: false, can_send_other_messages: false },
              });
              await db.muteUser(chatId, userId);
            } catch { }
            await ctx.reply(`🔇 ${userName} تم كتمه — كلمة محظورة`);
          } else if (found.action === 'kick') {
            try {
              await ctx.telegram.banChatMember(chatId, userId);
              setTimeout(() => ctx.telegram.unbanChatMember(chatId, userId).catch(() => {}), 2000);
            } catch { }
            await ctx.reply(`👢 ${userName} تم طرده — كلمة محظورة`);
          } else if (found.action === 'ban') {
            try {
              await ctx.telegram.banChatMember(chatId, userId);
              await db.banUser(chatId, userId);
            } catch { }
            await ctx.reply(`🚫 ${userName} تم حظره — كلمة محظورة`);
          }

          return; // لا نكمل لـ handlers
        }
      }
    }
  }

  return next();
}

module.exports = { globalMiddleware, invalidateBwordsCache };
