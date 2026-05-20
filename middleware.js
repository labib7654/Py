const db = require('./db');

// ── Rate limiting (flood protection) ─────────────────────────
const userLastAction = new Map();
function isFlood(userId, minInterval = 800) {
  const now  = Date.now();
  const last = userLastAction.get(userId) || 0;
  if (now - last < minInterval) return true;
  userLastAction.set(userId, now);
  return false;
}

// ── Middleware 1: تسجيل المستخدم + فحص الحظر العالمي ─────────
async function globalMiddleware(ctx, next) {
  if (!ctx.from) return next();

  // 🔇 إذا كانت المجموعة في وضع صامت — تجاوز كل الهاندلرز (handler_spy يعالجها بنفسه)
  if (ctx.chat && ctx.chat.type !== 'private' && ctx.chat.type !== 'channel') {
    if (global._silentGroups?.has(ctx.chat.id)) {
      // استثناء: نسمح فقط بـ my_chat_member لتتمكن handler_spy من رصد الإزالة
      if (!ctx.myChatMember) return; // صامت تام — لا تكمل
    }
  }

  const from = ctx.from;

  // تسجيل / تحديث بيانات المستخدم
  const user = db.getOrCreateUser(from.id, from.username || '', from.first_name || '');
  if (from.username  && user.username  !== from.username)  user.username  = from.username;
  if (from.first_name && user.firstName !== from.first_name) user.firstName = from.first_name;
  user.lastSeen = new Date();

  // تسجيل المجموعة في بيانات المستخدم
  if (ctx.chat && ctx.chat.type !== 'private' && ctx.chat.type !== 'channel') {
    user.groups.add(ctx.chat.id);
  }

  // فحص الحظر العالمي في المجموعات (ليس القنوات)
  if (user.globalBanned && ctx.chat && ctx.chat.type !== 'private' && ctx.chat.type !== 'channel') {
    try { await ctx.telegram.banChatMember(ctx.chat.id, from.id); } catch {}
    return;
  }

  return next();
}

// ══════════════════════════════════════════════════════════════
//  Middleware 2: رصد الرسائل وتحديث نقاط الأعضاء
//  ✅ يعمل على: message, editedMessage
//  ✅ ينشئ المجموعة تلقائياً إن لم تكن مسجّلة
// ══════════════════════════════════════════════════════════════
async function messageTrackingMiddleware(ctx, next) {
  // نتحقق من وجود رسالة (عادية أو معدّلة)
  const msg = ctx.message || ctx.editedMessage;
  if (!ctx.from || !ctx.chat || !msg) return next();

  // نتجاهل القنوات والخاص — الرصد للمجموعات والسوبرقروبات فقط
  const chatType = ctx.chat.type;
  if (chatType === 'private' || chatType === 'channel') return next();

  const from   = ctx.from;
  const chatId = ctx.chat.id;

  // ✅ إنشاء المجموعة تلقائياً إن لم تكن موجودة (الإصلاح الجوهري)
  let g = db.getGroup(chatId);
  if (!g) {
    g = db.getOrCreateGroup(
      chatId,
      ctx.chat.title || 'مجموعة',
      chatType,
      0,
      'auto-detected'
    );
    // محاولة جلب مالك المجموعة
    try {
      const admins = await ctx.telegram.getChatAdministrators(chatId);
      const owner  = admins.find(a => a.status === 'creator');
      if (owner && g) {
        g.ownerId       = owner.user.id;
        g.ownerUsername = owner.user.username || owner.user.first_name || String(owner.user.id);
      }
    } catch {}
  }

  // تتبع العضو وزيادة نقاطه
  if (g) {
    db.trackMember(chatId, from.id, from.username || '', from.first_name || '');
    const m = g.members.get(from.id);
    if (m) {
      m.messageCount  = (m.messageCount || 0) + 1;
      m.score         = (m.score        || 0) + 1;
      m.lastMessageAt = new Date();
      db.markDirty();
    }
  }

  return next();
}

module.exports = { globalMiddleware, messageTrackingMiddleware, isFlood };
