const { DEVELOPER_ID } = require('./config');

function isDeveloper(ctx) {
  return ctx.from && ctx.from.id === DEVELOPER_ID;
}

async function isAdmin(bot, chatId, userId) {
  try {
    const m = await bot.telegram.getChatMember(chatId, userId);
    return ['administrator', 'creator'].includes(m.status);
  } catch { return false; }
}

async function isOwner(bot, chatId, userId) {
  try {
    const m = await bot.telegram.getChatMember(chatId, userId);
    return m.status === 'creator';
  } catch { return false; }
}

async function checkBotPermissions(bot, chatId, permission) {
  try {
    const botId  = (await bot.telegram.getMe()).id;
    const member = await bot.telegram.getChatMember(chatId, botId);
    if (member.status !== 'administrator') return false;
    return member[permission] === true;
  } catch { return false; }
}

async function getTargetUser(ctx) {
  const msg = ctx.message;
  if (msg?.reply_to_message?.from) {
    const u = msg.reply_to_message.from;
    return { id: u.id, username: u.username || '', firstName: u.first_name || String(u.id) };
  }
  const args = msg?.text ? msg.text.split(' ').slice(1) : [];
  if (args[0]?.startsWith('@')) {
    try {
      const m = await ctx.getChatMember(args[0].replace('@', ''));
      if (m?.user) return { id: m.user.id, username: m.user.username || '', firstName: m.user.first_name || String(m.user.id) };
    } catch {}
  }
  if (args[0] && /^\d+$/.test(args[0])) return { id: Number(args[0]), username: '', firstName: args[0] };
  return null;
}

function getReason(text, offset = 1) {
  return text.split(' ').slice(offset).join(' ').trim() || 'لا يوجد سبب';
}

module.exports = {
  isDeveloper, isAdmin, isOwner, checkBotPermissions,
  getTargetUser, getReason,
};
