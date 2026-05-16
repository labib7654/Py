// @ts-nocheck
import * as db from './db';

export async function globalMiddleware(ctx, next) {
  if (ctx.from) {
    const user = db.getOrCreateUser(ctx.from.id, ctx.from.username || '', ctx.from.first_name || '');
    user.lastSeen = new Date();
    if (ctx.chat && ctx.chat.type !== 'private' && user.globalBanned) {
      try { await ctx.telegram.banChatMember(ctx.chat.id, ctx.from.id); } catch {}
      return;
    }
  }
  return next();
}

export async function messageTrackingMiddleware(ctx, next) {
  if (ctx.message && ctx.from && ctx.chat && ctx.chat.type !== 'private') {
    const g = db.getGroup(ctx.chat.id);
    if (g) {
      const m = g.members.get(ctx.from.id);
      if (m) {
        m.messageCount = (m.messageCount || 0) + 1;
        m.score        = (m.score        || 0) + 1;
        m.lastMessageAt = new Date();
      }
    }
  }
  return next();
}
