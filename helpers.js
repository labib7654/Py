// ============================================================
//  دوال مساعدة مشتركة
// ============================================================

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
    } catch { }
  }
  if (args[0] && /^\d+$/.test(args[0]))
    return { id: Number(args[0]), username: '', firstName: args[0] };
  return null;
}

function getReason(text, offset = 1) {
  return text.split(' ').slice(offset).join(' ').trim() || 'لا يوجد سبب';
}

async function muteMember(bot, chatId, userId) {
  await bot.telegram.restrictChatMember(chatId, userId, {
    permissions: {
      can_send_messages: false, can_send_audios: false,
      can_send_documents: false, can_send_photos: false,
      can_send_videos: false, can_send_video_notes: false,
      can_send_voice_notes: false, can_send_polls: false,
      can_send_other_messages: false, can_add_web_page_previews: false,
    },
  });
}

async function unmuteMember(bot, chatId, userId) {
  await bot.telegram.restrictChatMember(chatId, userId, {
    permissions: {
      can_send_messages: true, can_send_audios: true,
      can_send_documents: true, can_send_photos: true,
      can_send_videos: true, can_send_video_notes: true,
      can_send_voice_notes: true, can_send_polls: true,
      can_send_other_messages: true, can_add_web_page_previews: true,
    },
  });
}

async function promoteUser(bot, chatId, userId) {
  try {
    await bot.telegram.promoteChatMember(chatId, userId, {
      can_manage_chat: true, can_delete_messages: true,
      can_manage_video_chats: true, can_restrict_members: true,
      can_promote_members: false, can_change_info: true,
      can_invite_users: true, can_pin_messages: true,
    });
    return true;
  } catch { return false; }
}

module.exports = { isDeveloper, isAdmin, isOwner, getTargetUser, getReason, muteMember, unmuteMember, promoteUser };
