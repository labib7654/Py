const { Markup } = require('telegraf');
const db = require('./db');
const { DEVELOPER_ID, BOT_ADMINS } = require('./config');

function isDeveloper(ctx) {
  return !!ctx?.from?.id && Number(ctx.from.id) === Number(DEVELOPER_ID);
}

function isBotAdmin(ctx) {
  const userId = Number(ctx?.from?.id);
  return !!userId && (userId === Number(DEVELOPER_ID) || BOT_ADMINS.includes(userId));
}

function isDeveloperOrBotAdmin(ctx) {
  return isBotAdmin(ctx);
}

async function isAdmin(bot, chatId, userId) {
  if (!bot?.telegram || !chatId || !userId) return false;
  try {
    const member = await bot.telegram.getChatMember(chatId, userId);
    return ['creator', 'administrator'].includes(member?.status);
  } catch {
    return false;
  }
}

async function isOwner(bot, chatId, userId) {
  if (!bot?.telegram || !chatId || !userId) return false;
  try {
    const member = await bot.telegram.getChatMember(chatId, userId);
    return member?.status === 'creator';
  } catch {
    return false;
  }
}

async function muteMember(bot, chatId, userId) {
  try {
    await bot.telegram.restrictChatMember(chatId, userId, {
      permissions: {
        can_send_messages: false,
        can_send_audios: false,
        can_send_documents: false,
        can_send_photos: false,
        can_send_videos: false,
        can_send_video_notes: false,
        can_send_voice_notes: false,
        can_send_polls: false,
        can_send_other_messages: false,
        can_add_web_page_previews: false,
      },
    });
    return true;
  } catch {
    return false;
  }
}

async function promoteUser(bot, chatId, userId) {
  try {
    await bot.telegram.promoteChatMember(chatId, userId, {
      can_manage_chat: true,
      can_delete_messages: true,
      can_manage_video_chats: true,
      can_restrict_members: true,
      can_promote_members: false,
      can_change_info: true,
      can_invite_users: true,
      can_pin_messages: true,
      can_post_messages: true,
      can_edit_messages: true,
      can_manage_topics: true,
    });
    return true;
  } catch {
    return false;
  }
}

function buildPermissions(perms = {}) {
  return {
    can_send_messages: !!perms.canSendMessages,
    can_send_audios: !!perms.canSendMedia,
    can_send_documents: !!perms.canSendMedia,
    can_send_photos: !!perms.canSendMedia,
    can_send_videos: !!perms.canSendMedia,
    can_send_video_notes: !!perms.canSendMedia,
    can_send_voice_notes: !!perms.canSendMedia,
    can_send_polls: !!perms.canSendPolls,
    can_send_other_messages: !!perms.canSendMessages,
    can_add_web_page_previews: !!perms.canAddWebPreviews,
    can_invite_users: !!perms.canInviteUsers,
    can_pin_messages: !!perms.canPinMessages,
    can_manage_topics: !!perms.canManageTopics,
  };
}

async function applyGroupPermissions(bot, chatId, perms = {}) {
  try {
    await bot.telegram.setChatPermissions(chatId, buildPermissions(perms));
    return true;
  } catch {
    return false;
  }
}

async function logAction(bot, g, action, by, target, details = '') {
  const byName = by?.username ? `@${by.username}` : by?.first_name || by?.firstName || String(by?.id || 'unknown');
  const targetName = target?.username ? `@${target.username}` : target?.firstName || target?.first_name || String(target?.id || target?.userId || 'unknown');
  const text =
    `📝 *${action}*\n\n` +
    `👤 بواسطة: ${byName}\n` +
    `🎯 الهدف: ${targetName}\n` +
    (details ? `ℹ️ ${details}\n` : '') +
    `🕐 ${new Date().toLocaleString('ar')}`;

  if (g?.chatId) {
    try { db.addAuditLog(g.chatId, { action, by: by?.id, target: target?.id || target?.userId, details }); } catch {}
  }

  if (g?.logChannelId) {
    try { await bot.telegram.sendMessage(g.logChannelId, text, { parse_mode: 'Markdown' }); } catch {}
  }

  return text;
}

async function setJoinApproval(bot, chatId, enabled, g) {
  const group = g || db.getGroup(chatId);
  if (!group) return null;

  group.joinRequestsEnabled = !!enabled;

  if (enabled) {
    if (group.joinApprovalLink?.invite_link) {
      db.markDirty();
      db.saveData();
      return group.joinApprovalLink.invite_link;
    }

    try {
      const link = await bot.telegram.createChatInviteLink(chatId, {
        creates_join_request: true,
        name: `join-approval-${chatId}`,
      });
      group.joinApprovalLink = {
        invite_link: link?.invite_link || null,
        createdAt: new Date(),
      };
      db.markDirty();
      db.saveData();
      return link?.invite_link || null;
    } catch {
      return null;
    }
  }

  if (group.joinApprovalLink?.invite_link) {
    try {
      await bot.telegram.revokeChatInviteLink(chatId, group.joinApprovalLink.invite_link);
    } catch {}
    group.joinApprovalLink = null;
  }

  db.markDirty();
  db.saveData();
  return null;
}

async function verifyAndRegisterOwner(bot, chatId, userId) {
  try {
    const member = await bot.telegram.getChatMember(chatId, userId);
    return member?.status === 'creator';
  } catch {
    return false;
  }
}

async function lockTopic(bot, chatId, topicId) {
  try {
    await bot.telegram.closeForumTopic(chatId, topicId);
    return true;
  } catch {
    return false;
  }
}

async function unlockTopic(bot, chatId, topicId) {
  try {
    await bot.telegram.reopenForumTopic(chatId, topicId);
    return true;
  } catch {
    return false;
  }
}

async function archiveTopic(bot, chatId, topicId) {
  try {
    await bot.telegram.closeForumTopic(chatId, topicId);
    return true;
  } catch {
    return false;
  }
}

function isProtectedChat(chatId) {
  const g = db.getGroup(chatId);
  const ch = db.getChannel(chatId);
  return !!(g?.protectContent || ch?.protectContent);
}

function applyTelegramContentProtection(bot) {
  if (!bot?.telegram || bot.telegram.__contentProtectionPatched) return;
  bot.telegram.__contentProtectionPatched = true;

  const patch = (methodName, targetIndex = 0, extraIndex = -1) => {
    const original = bot.telegram[methodName];
    if (typeof original !== 'function') return;
    bot.telegram[methodName] = async (...args) => {
      const targetChatId = args[targetIndex];
      if (isProtectedChat(targetChatId)) {
        const extraPos = extraIndex >= 0 ? extraIndex : args.length - 1;
        const extra = args[extraPos];
        if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
          extra.protect_content = true;
        } else if (extraPos === args.length - 1) {
          args.push({ protect_content: true });
        }
      }
      return original.apply(bot.telegram, args);
    };
  };

  patch('sendMessage', 0);
  patch('sendPhoto', 0);
  patch('sendVideo', 0);
  patch('sendDocument', 0);
  patch('sendAudio', 0);
  patch('sendVoice', 0);
  patch('sendAnimation', 0);
  patch('sendSticker', 0);
  patch('sendVideoNote', 0);
  patch('sendPoll', 0);
  patch('copyMessage', 0, 3);
}

module.exports = {
  isDeveloper,
  isBotAdmin,
  isDeveloperOrBotAdmin,
  isAdmin,
  isOwner,
  muteMember,
  promoteUser,
  applyGroupPermissions,
  logAction,
  setJoinApproval,
  verifyAndRegisterOwner,
  lockTopic,
  unlockTopic,
  archiveTopic,
  applyTelegramContentProtection,
};
