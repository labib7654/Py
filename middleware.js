const db = require('./db');

async function globalMiddleware(ctx, next) {
  if (!ctx.from) return next();
  const user = db.getOrCreateUser(ctx.from.id, ctx.from.username || '', ctx.from.first_name || '');
  if (user.globalBanned && ctx.chat && ctx.chat.type !== 'private') {
    try { await ctx.telegram.banChatMember(ctx.chat.id, ctx.from.id); } catch {}
    return;
  }
  return next();
}

module.exports = { globalMiddleware };
