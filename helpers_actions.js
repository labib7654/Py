const { DEVELOPER_ID } = require('./config');

async function muteMember(bot, chatId, userId) {
  await bot.telegram.restrictChatMember(chatId, userId, {
    permissions: {
      can_send_messages:         false,
      can_send_audios:           false,
      can_send_documents:        false,
      can_send_photos:           false,
      can_send_videos:           false,
      can_send_video_notes:      false,
      can_send_voice_notes:      false,
      can_send_polls:            false,
      can_send_other_messages:   false,
      can_add_web_page_previews: false,
    },
  });
}

async function muteMemberTimed(bot, chatId, userId, durationSeconds) {
  const untilDate = Math.floor(Date.now() / 1000) + durationSeconds;
  await bot.telegram.restrictChatMember(chatId, userId, {
    permissions: {
      can_send_messages:         false,
      can_send_audios:           false,
      can_send_documents:        false,
      can_send_photos:           false,
      can_send_videos:           false,
      can_send_video_notes:      false,
      can_send_voice_notes:      false,
      can_send_polls:            false,
      can_send_other_messages:   false,
      can_add_web_page_previews: false,
    },
    until_date: untilDate,
  });
}

async function banMemberTimed(bot, chatId, userId, durationSeconds) {
  const untilDate = Math.floor(Date.now() / 1000) + durationSeconds;
  await bot.telegram.banChatMember(chatId, userId, { until_date: untilDate });
}

// FIX 17: unmutePerms تراعي إعدادات المجموعة الفعلية
async function unmutePerms(bot, chatId) {
  const db = require('./db');
  const g  = db.getGroup(chatId);
  const p  = g?.perms || {};
  return {
    can_send_messages:         p.canSendMessages   ?? true,
    can_send_audios:           p.canSendMedia       ?? true,
    can_send_documents:        p.canSendMedia       ?? true,
    can_send_photos:           p.canSendMedia       ?? true,
    can_send_videos:           p.canSendMedia       ?? true,
    can_send_video_notes:      p.canSendMedia       ?? true,
    can_send_voice_notes:      p.canSendMedia       ?? true,
    can_send_polls:            p.canSendPolls       ?? true,
    can_send_other_messages:   p.canSendMessages    ?? true,
    can_add_web_page_previews: p.canAddWebPreviews  ?? true,
  };
}

async function promoteUser(bot, chatId, userId) {
  try {
    await bot.telegram.promoteChatMember(chatId, userId, {
      can_manage_chat:        true,
      can_delete_messages:    true,
      can_manage_video_chats: true,
      can_restrict_members:   true,
      can_promote_members:    false,
      can_change_info:        true,
      can_invite_users:       true,
      can_pin_messages:       true,
    });
    return true;
  } catch { return false; }
}

async function demoteUser(bot, chatId, userId) {
  try {
    await bot.telegram.promoteChatMember(chatId, userId, {
      can_manage_chat:        false,
      can_delete_messages:    false,
      can_manage_video_chats: false,
      can_restrict_members:   false,
      can_promote_members:    false,
      can_change_info:        false,
      can_invite_users:       false,
      can_pin_messages:       false,
    });
    return true;
  } catch { return false; }
}

async function applyGroupPermissions(bot, chatId, perms) {
  await bot.telegram.setChatPermissions(chatId, {
    can_send_messages:         perms.canSendMessages,
    can_send_audios:           perms.canSendMedia,
    can_send_documents:        perms.canSendMedia,
    can_send_photos:           perms.canSendMedia,
    can_send_videos:           perms.canSendMedia,
    can_send_video_notes:      perms.canSendMedia,
    can_send_voice_notes:      perms.canSendMedia,
    can_send_polls:            perms.canSendPolls,
    can_send_other_messages:   perms.canSendMessages,
    can_add_web_page_previews: perms.canAddWebPreviews,
    can_invite_users:          perms.canInviteUsers,
    can_pin_messages:          perms.canPinMessages,
    can_manage_topics:         perms.canManageTopics,
  });
}

async function logAction(bot, g, action, by, target, details = '') {
  const db    = require('./db');
  const entry = {
    action,
    by:     { id: by.id, username: by.username || by.first_name || String(by.id) },
    target: { id: target.id, username: target.username || target.firstName || String(target.id) },
    details,
  };
  db.addAuditLog(g.chatId, entry);

  if (!g.logChannelId) return;
  const text =
    `📋 *سجل إجراء*\n\n` +
    `⚡ الإجراء: *${action}*\n` +
    `👮 بواسطة: ${by.username ? `@${by.username}` : by.first_name || String(by.id)}\n` +
    `👤 على: ${target.username ? `@${target.username}` : target.firstName || String(target.id)}\n` +
    `📌 المجموعة: *${g.title}*\n` +
    (details ? `📝 ${details}\n` : '') +
    `🕐 ${new Date().toLocaleString('ar')}`;
  try {
    await bot.telegram.sendMessage(g.logChannelId, text, { parse_mode: 'Markdown' });
  } catch {}
}

// FIX 13: setJoinApproval تراعي إعدادات صلاحيات المجموعة الفعلية
async function setJoinApproval(bot, chatId, enabled) {
  const db = require('./db');
  const g  = db.getGroup(chatId);
  const p  = g?.perms || {};
  try {
    await bot.telegram.setChatPermissions(chatId, {
      can_send_messages:         p.canSendMessages   ?? true,
      can_send_audios:           p.canSendMedia       ?? true,
      can_send_documents:        p.canSendMedia       ?? true,
      can_send_photos:           p.canSendMedia       ?? true,
      can_send_videos:           p.canSendMedia       ?? true,
      can_send_voice_notes:      p.canSendMedia       ?? true,
      can_send_polls:            p.canSendPolls       ?? true,
      can_send_other_messages:   p.canSendMessages    ?? true,
      can_add_web_page_previews: p.canAddWebPreviews  ?? true,
      can_invite_users:          enabled ? false : (p.canInviteUsers ?? true),
    });
  } catch {}

  try {
    const link = await bot.telegram.callApi('createChatInviteLink', {
      chat_id:              chatId,
      creates_join_request: enabled,
      name: enabled ? 'رابط رسمي - موافقة مطلوبة' : 'رابط رسمي - دخول مباشر',
    });
    return link;
  } catch (e) {
    console.error('setJoinApproval (createLink) error:', e.message);
    return null;
  }
}

// ── التحقق من المالك الحقيقي ─────────────────────────────────
async function verifyAndRegisterOwner(bot, chatId) {
  try {
    const admins  = await bot.telegram.getChatAdministrators(chatId);
    const creator = admins.find(a => a.status === 'creator' && !a.user.is_bot);
    if (!creator) return null;

    const db = require('./db');
    const g  = db.getGroup(chatId);
    if (g) {
      g.ownerId         = creator.user.id;
      g.ownerUsername   = creator.user.username || creator.user.first_name || String(creator.user.id);
      g.ownerVerified   = true;
      g.ownerVerifiedAt = new Date();
    }

    db.getOrCreateUser(creator.user.id, creator.user.username || '', creator.user.first_name || '');
    return creator.user;
  } catch (e) {
    console.error(`verifyOwner error for ${chatId}:`, e.message);
    return null;
  }
}

// ── إدارة المواضيع (Topics) ────────────────────────────────────
async function lockTopic(bot, chatId, topicId) {
  await bot.telegram.callApi('closeForumTopic', {
    chat_id:           chatId,
    message_thread_id: topicId,
  });
}

async function unlockTopic(bot, chatId, topicId) {
  await bot.telegram.callApi('reopenForumTopic', {
    chat_id:           chatId,
    message_thread_id: topicId,
  });
}

// FIX 10: archiveTopic تستخدم hideForumTopic للأرشفة الفعلية
async function archiveTopic(bot, chatId, topicId) {
  // أغلق الموضوع أولاً
  await bot.telegram.callApi('closeForumTopic', {
    chat_id:           chatId,
    message_thread_id: topicId,
  });
  // ثم أخفه (الأرشفة الفعلية)
  await bot.telegram.callApi('hideForumTopic', {
    chat_id:           chatId,
    message_thread_id: topicId,
  }).catch(() => {}); // hideForumTopic للموضوع العام فقط
}

module.exports = {
  muteMember, muteMemberTimed,
  banMemberTimed,
  unmutePerms,
  promoteUser, demoteUser,
  applyGroupPermissions,
  logAction,
  setJoinApproval,
  verifyAndRegisterOwner,
  lockTopic, unlockTopic, archiveTopic,
};
