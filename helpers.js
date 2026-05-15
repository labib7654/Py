// ============================================================
//  دوال مساعدة مشتركة
// ============================================================

const { DEVELOPER_ID } = require('./config');

// هل المستخدم هو المطور؟
function isDeveloper(ctx) {
  return ctx.from && ctx.from.id === DEVELOPER_ID;
}

// هل المستخدم مشرف في المجموعة؟
async function isAdmin(bot, chatId, userId) {
  try {
    const member = await bot.telegram.getChatMember(chatId, userId);
    return ['administrator', 'creator'].includes(member.status);
  } catch {
    return false;
  }
}

// هل المستخدم مالك المجموعة؟
async function isOwner(bot, chatId, userId) {
  try {
    const member = await bot.telegram.getChatMember(chatId, userId);
    return member.status === 'creator';
  } catch {
    return false;
  }
}

// تحديد المستخدم المستهدف (رد أو ذكر)
async function getTargetUser(ctx) {
  const msg = ctx.message;

  // من الرد على رسالة
  if (msg && msg.reply_to_message && msg.reply_to_message.from) {
    const u = msg.reply_to_message.from;
    return {
      id: u.id,
      username: u.username || '',
      firstName: u.first_name || String(u.id),
    };
  }

  // من ذكر المستخدم بـ @username
  const args = msg && msg.text ? msg.text.split(' ').slice(1) : [];
  if (args[0] && args[0].startsWith('@')) {
    try {
      const member = await ctx.getChatMember(args[0].replace('@', ''));
      if (member && member.user) {
        return {
          id: member.user.id,
          username: member.user.username || '',
          firstName: member.user.first_name || String(member.user.id),
        };
      }
    } catch { }
  }

  return null;
}

// استخراج السبب من الأمر
function getReason(text, offset = 1) {
  const parts = text.split(' ').slice(offset);
  return parts.join(' ').trim() || 'لا يوجد سبب';
}

// كتم عضو (صلاحيات صفر)
async function muteMember(bot, chatId, userId) {
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
}

// رفع كتم عضو (صلاحيات كاملة)
async function unmuteMember(bot, chatId, userId) {
  await bot.telegram.restrictChatMember(chatId, userId, {
    permissions: {
      can_send_messages: true,
      can_send_audios: true,
      can_send_documents: true,
      can_send_photos: true,
      can_send_videos: true,
      can_send_video_notes: true,
      can_send_voice_notes: true,
      can_send_polls: true,
      can_send_other_messages: true,
      can_add_web_page_previews: true,
    },
  });
}

// ترقية مستخدم مشرفاً
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
    });
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  isDeveloper,
  isAdmin,
  isOwner,
  getTargetUser,
  getReason,
  muteMember,
  unmuteMember,
  promoteUser,
};
