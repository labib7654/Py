const { DEVELOPER_ID } = require('./config');

function isDeveloper(ctx) { return ctx.from && ctx.from.id === DEVELOPER_ID; }

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
    } catch {}
  }
  if (args[0] && /^\d+$/.test(args[0])) return { id: Number(args[0]), username: '', firstName: args[0] };
  return null;
}

function getReason(text, offset = 1) {
  return text.split(' ').slice(offset).join(' ').trim() || 'لا يوجد سبب';
}

async function muteMember(bot, chatId, userId) {
  await bot.telegram.restrictChatMember(chatId, userId, {
    permissions: {
      can_send_messages:      false,
      can_send_audios:        false,
      can_send_documents:     false,
      can_send_photos:        false,
      can_send_videos:        false,
      can_send_video_notes:   false,
      can_send_voice_notes:   false,
      can_send_polls:         false,
      can_send_other_messages:false,
      can_add_web_page_previews:false,
    },
  });
}

async function muteMemberTimed(bot, chatId, userId, durationSeconds) {
  const untilDate = Math.floor(Date.now() / 1000) + durationSeconds;
  await bot.telegram.restrictChatMember(chatId, userId, {
    permissions: {
      can_send_messages:      false,
      can_send_audios:        false,
      can_send_documents:     false,
      can_send_photos:        false,
      can_send_videos:        false,
      can_send_video_notes:   false,
      can_send_voice_notes:   false,
      can_send_polls:         false,
      can_send_other_messages:false,
      can_add_web_page_previews:false,
    },
    until_date: untilDate,
  });
}

async function banMemberTimed(bot, chatId, userId, durationSeconds) {
  const untilDate = Math.floor(Date.now() / 1000) + durationSeconds;
  await bot.telegram.banChatMember(chatId, userId, { until_date: untilDate });
}

async function unmutePerms() {
  return {
    can_send_messages:       true,
    can_send_audios:         true,
    can_send_documents:      true,
    can_send_photos:         true,
    can_send_videos:         true,
    can_send_video_notes:    true,
    can_send_voice_notes:    true,
    can_send_polls:          true,
    can_send_other_messages: true,
    can_add_web_page_previews:true,
  };
}

async function promoteUser(bot, chatId, userId) {
  try {
    await bot.telegram.promoteChatMember(chatId, userId, {
      can_manage_chat:       true,
      can_delete_messages:   true,
      can_manage_video_chats:true,
      can_restrict_members:  true,
      can_promote_members:   false,
      can_change_info:       true,
      can_invite_users:      true,
      can_pin_messages:      true,
    });
    return true;
  } catch { return false; }
}

async function demoteUser(bot, chatId, userId) {
  try {
    await bot.telegram.promoteChatMember(chatId, userId, {
      can_manage_chat:       false,
      can_delete_messages:   false,
      can_manage_video_chats:false,
      can_restrict_members:  false,
      can_promote_members:   false,
      can_change_info:       false,
      can_invite_users:      false,
      can_pin_messages:      false,
    });
    return true;
  } catch { return false; }
}

async function applyGroupPermissions(bot, chatId, perms) {
  await bot.telegram.setChatPermissions(chatId, {
    can_send_messages:        perms.canSendMessages,
    can_send_audios:          perms.canSendMedia,
    can_send_documents:       perms.canSendMedia,
    can_send_photos:          perms.canSendMedia,
    can_send_videos:          perms.canSendMedia,
    can_send_video_notes:     perms.canSendMedia,
    can_send_voice_notes:     perms.canSendMedia,
    can_send_polls:           perms.canSendPolls,
    can_send_other_messages:  perms.canSendMessages,
    can_add_web_page_previews:perms.canAddWebPreviews,
    can_invite_users:         perms.canInviteUsers,
    can_pin_messages:         perms.canPinMessages,
    can_manage_topics:        perms.canManageTopics,
  });
}

async function logAction(bot, g, action, by, target, details = '') {
  const db = require('./db');
  const entry = {
    action,
    by:      { id: by.id, username: by.username || by.first_name || String(by.id) },
    target:  { id: target.id, username: target.username || target.firstName || String(target.id) },
    details,
  };
  db.addAuditLog(g.chatId, entry);

  if (!g.logChannelId) return;
  const text =
    `📋 *سجل إجراء*\n\n` +
    `⚡ الإجراء: *${action}*\n` +
    `👮 بواسطة: ${by.username ? `@${by.username}` : by.first_name}\n` +
    `👤 على: ${target.username ? `@${target.username}` : target.firstName}\n` +
    `📌 المجموعة: *${g.title}*\n` +
    (details ? `📝 ${details}\n` : '') +
    `🕐 ${new Date().toLocaleString('ar')}`;
  try {
    await bot.telegram.sendMessage(g.logChannelId, text, { parse_mode: 'Markdown' });
  } catch {}
}

module.exports = {
  isDeveloper, isAdmin, isOwner,
  getTargetUser, getReason,
  muteMember, muteMemberTimed,
  banMemberTimed,
  unmutePerms,
  promoteUser, demoteUser,
  applyGroupPermissions,
  logAction,
};
