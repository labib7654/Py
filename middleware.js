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

  const from = ctx.from;

  // تسجيل / تحديث بيانات المستخدم
  const user = db.getOrCreateUser(from.id, from.username || '', from.first_name || '');
  if (from.username   && user.username   !== from.username)   user.username   = from.username;
  if (from.first_name && user.firstName  !== from.first_name) user.firstName  = from.first_name;
  user.lastSeen = new Date();

  // تسجيل المجموعة في بيانات المستخدم
  if (ctx.chat && ctx.chat.type !== 'private') {
    user.groups.add(ctx.chat.id);
  }

  // فحص الحظر العالمي في المجموعات
  if (user.globalBanned && ctx.chat && ctx.chat.type !== 'private') {
    try { await ctx.telegram.banChatMember(ctx.chat.id, from.id); } catch {}
    return;
  }

  return next();
}

// ── Middleware 2: رصد الرسائل وتحديث نقاط الأعضاء ──────────
async function messageTrackingMiddleware(ctx, next) {
  if (!ctx.from || !ctx.chat || ctx.chat.type === 'private') return next();
  if (!ctx.message && !ctx.editedMessage) return next();

  const from   = ctx.from;
  const chatId = ctx.chat.id;

  // تتبع تلقائي للمجموعة إذا لم تكن مسجّلة
  if (!db.getGroup(chatId)) {
    db.getOrCreateGroup(chatId, ctx.chat.title || 'مجموعة', ctx.chat.type, 0, 'unknown');
    try {
      const admins = await ctx.telegram.getChatAdministrators(chatId);
      const owner  = admins.find(a => a.status === 'creator');
      const g      = db.getGroup(chatId);
      if (owner && g) {
        g.ownerId      = owner.user.id;
        g.ownerUsername = owner.user.username || owner.user.first_name;
      }
    } catch {}
  }

  const g = db.getGroup(chatId);
  if (g) {
    db.trackMember(chatId, from.id, from.username || '', from.first_name || '');
    const m = g.members.get(from.id);
    if (m) {
      m.messageCount  = (m.messageCount || 0) + 1;
      m.score         = (m.score        || 0) + 1;
      m.lastMessageAt = new Date();
    }
  }

  return next();
}

module.exports = { globalMiddleware, messageTrackingMiddleware, isFlood };
