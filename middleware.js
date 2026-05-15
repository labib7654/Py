// ============================================================
//  Middleware للبوت
// ============================================================

const { getUser, getOrCreateUser } = require('./db');

// تسجيل المستخدمين تلقائياً + منع المحظورين عالمياً
async function globalMiddleware(ctx, next) {
  if (!ctx.from) return next();

  const user = getOrCreateUser(
    ctx.from.id,
    ctx.from.username || '',
    ctx.from.first_name || ''
  );

  // إذا كان المستخدم محظوراً عالمياً وفي مجموعة → طرده
  if (user.globalBanned && ctx.chat && ctx.chat.type !== 'private') {
    try {
      await ctx.telegram.banChatMember(ctx.chat.id, ctx.from.id);
    } catch { }
    return; // لا نكمل
  }

  return next();
}

module.exports = { globalMiddleware };
