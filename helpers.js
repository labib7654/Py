// helpers.js — دوال مساعدة لبوت جامعة v5.0
const { DEVELOPER_ID } = require('./config');
const supa = require('./supabase');

function isDeveloper(ctx) { return ctx.from && ctx.from.id === DEVELOPER_ID; }

// كاش مؤقت للتحقق من المشرفين (60 ثانية)
const adminCache = new Map();
async function isAdmin(bot, chatId, userId) {
  if (userId === DEVELOPER_ID) return true;
  const key = `${chatId}:${userId}`;
  const cached = adminCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.result;
  try {
    const m = await bot.telegram.getChatMember(chatId, userId);
    const result = ['administrator', 'creator'].includes(m.status);
    adminCache.set(key, { result, expires: Date.now() + 60_000 });
    return result;
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
  // حفظ في Supabase
  await supa.addRestriction(chatId, userId, 'timed_mute',
    new Date(Date.now() + durationSeconds * 1000).toISOString(), null);
}

async function banMemberTimed(bot, chatId, userId, durationSeconds) {
  const untilDate = Math.floor(Date.now() / 1000) + durationSeconds;
  await bot.telegram.banChatMember(chatId, userId, { until_date: untilDate });
  // حفظ في Supabase
  await supa.addRestriction(chatId, userId, 'timed_ban',
    new Date(Date.now() + durationSeconds * 1000).toISOString(), null);
}

async function unmutePerms() {
  return {
    can_send_messages:         true,
    can_send_audios:           true,
    can_send_documents:        true,
    can_send_photos:           true,
    can_send_videos:           true,
    can_send_video_notes:      true,
    can_send_voice_notes:      true,
    can_send_polls:            true,
    can_send_other_messages:   true,
    can_add_web_page_previews: true,
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

// logAction — يكتب في Supabase ويرسل لقناة السجلات
async function logAction(bot, g, action, by, target, details = '') {
  const chatId     = g.chatId || g.chat_id;
  const logChannel = g.logChannelId || g.log_channel_id;

  // سجّل في Supabase
  await supa.addAuditLog(
    chatId, action,
    by.id, by.username || by.first_name || String(by.id),
    target.id, target.username || target.firstName || String(target.id),
    details
  );

  // سجّل في كاش المجموعة إن وُجد
  const entry = {
    action,
    by:     { id: by.id, username: by.username || by.first_name || String(by.id) },
    target: { id: target.id, username: target.username || target.firstName || String(target.id) },
    details,
    at: new Date(),
  };
  if (g.auditLog) {
    g.auditLog.unshift(entry);
    if (g.auditLog.length > 100) g.auditLog.length = 100;
  }

  if (!logChannel) return;
  const text =
    `📋 *سجل إجراء*\n\n` +
    `⚡ الإجراء: *${action}*\n` +
    `👮 بواسطة: ${by.username ? `@${by.username}` : by.first_name || String(by.id)}\n` +
    `👤 على: ${target.username ? `@${target.username}` : target.firstName || String(target.id)}\n` +
    `📌 المجموعة: *${g.title}*\n` +
    (details ? `📝 ${details}\n` : '') +
    `🕐 ${new Date().toLocaleString('ar')}`;
  try {
    await bot.telegram.sendMessage(logChannel, text, { parse_mode: 'Markdown' });
  } catch {}
}

// setJoinApproval — يضبط setChatPermissions + رابط دعوة
async function setJoinApproval(bot, chatId, enabled, currentPerms) {
  try {
    const permsUpdate = {
      can_send_messages:         currentPerms?.canSendMessages   !== false,
      can_send_audios:           currentPerms?.canSendMedia       !== false,
      can_send_documents:        currentPerms?.canSendMedia       !== false,
      can_send_photos:           currentPerms?.canSendMedia       !== false,
      can_send_videos:           currentPerms?.canSendMedia       !== false,
      can_send_video_notes:      currentPerms?.canSendMedia       !== false,
      can_send_voice_notes:      currentPerms?.canSendMedia       !== false,
      can_send_polls:            currentPerms?.canSendPolls       !== false,
      can_send_other_messages:   currentPerms?.canSendMessages    !== false,
      can_add_web_page_previews: currentPerms?.canAddWebPreviews  !== false,
      can_invite_users:          !enabled,
      can_pin_messages:          currentPerms?.canPinMessages     === true,
      can_manage_topics:         currentPerms?.canManageTopics    === true,
    };
    await bot.telegram.setChatPermissions(chatId, permsUpdate);
    const link = await bot.telegram.callApi('createChatInviteLink', {
      chat_id:              chatId,
      creates_join_request: enabled,
      name: enabled ? 'رابط رسمي - موافقة مطلوبة' : 'رابط رسمي - دخول مباشر',
    });
    return link;
  } catch (e) {
    console.error('setJoinApproval error:', e.message);
    return null;
  }
}

// Topic helpers
async function lockTopic(bot, chatId, topicId) {
  try {
    await bot.telegram.callApi('closeForumTopic', { chat_id: chatId, message_thread_id: topicId });
    return true;
  } catch (e) { console.error('lockTopic error:', e.message); return false; }
}

async function unlockTopic(bot, chatId, topicId) {
  try {
    await bot.telegram.callApi('reopenForumTopic', { chat_id: chatId, message_thread_id: topicId });
    return true;
  } catch (e) { console.error('unlockTopic error:', e.message); return false; }
}

async function archiveTopic(bot, chatId, topicId) {
  try {
    await bot.telegram.callApi('closeForumTopic', { chat_id: chatId, message_thread_id: topicId });
    await bot.telegram.callApi('hideGeneralForumTopic', { chat_id: chatId }).catch(() => {});
    return true;
  } catch (e) { console.error('archiveTopic error:', e.message); return false; }
}

// التحقق من المالك وتسجيله
async function verifyAndRegisterOwner(bot, chatId) {
  try {
    const admins  = await bot.telegram.getChatAdministrators(chatId);
    const creator = admins.find(a => a.status === 'creator' && !a.user.is_bot);
    if (!creator) return null;
    const db = require('./db');
    const g  = await db.getGroup(chatId);
    if (g) {
      g.ownerId         = creator.user.id;
      g.ownerUsername   = creator.user.username || creator.user.first_name || String(creator.user.id);
      g.ownerVerified   = true;
      g.ownerVerifiedAt = new Date();
      db.scheduleSync(g);
    }
    await db.getOrCreateUser(creator.user.id, creator.user.username || '', creator.user.first_name || '');
    return creator.user;
  } catch (e) { console.error(`verifyOwner error for ${chatId}:`, e.message); return null; }
}

// CAPTCHA — إنشاء تحدي رياضي
function generateCaptcha() {
  const a = Math.floor(Math.random() * 9) + 1;
  const b = Math.floor(Math.random() * 9) + 1;
  const ops = [
    { q: `${a} + ${b}`, answer: a + b },
    { q: `${a} × ${b}`, answer: a * b },
    { q: `${Math.max(a,b)} - ${Math.min(a,b)}`, answer: Math.abs(a - b) },
  ];
  return ops[Math.floor(Math.random() * ops.length)];
}

// مساعد توجيه المتخصصين
async function handleSpecialistRouting(bot, ctx, g, matched, originalText) {
  const { Markup } = require('telegraf');
  const db = require('./db');
  const userId    = ctx.from.id;
  const chatId    = ctx.chat.id;
  const messageId = ctx.message.message_id;

  // 1. تحديد المتخصص
  let specialist = null;
  if (matched.specialist_id) {
    specialist = await supa.getSpecialist(chatId, matched.specialist_id);
  } else {
    const specialists = await supa.getSpecialists(chatId);
    if (!specialists.length) return;
    specialist = specialists[0];
  }
  if (!specialist) return;

  // 2. احذف الرسالة من المجموعة
  try { await bot.telegram.deleteMessage(chatId, messageId); } catch {}

  const senderName    = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;
  const specialistName = specialist.username ? `@${specialist.username}` : specialist.first_name;

  // 3. أرسل للمتخصص
  try {
    await bot.telegram.sendMessage(
      specialist.user_id,
      `📩 *طلب مساعدة جديد*\n\n` +
      `👤 *الشخص:* ${senderName} \`[${userId}]\`\n` +
      `📌 *المجموعة:* ${g.title}\n` +
      `🔑 *الكلمة المحفِّزة:* \`${matched.keyword}\`\n\n` +
      `💬 *الرسالة الأصلية:*\n${originalText}`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.url(`✉️ فتح محادثة مع ${senderName}`, `tg://user?id=${userId}`)],
          [Markup.button.callback('✅ تم التواصل', `session_done_${userId}`)],
        ]),
      }
    );
  } catch {
    const ownerId = g.ownerId || g.owner_id;
    if (ownerId) {
      await bot.telegram.sendMessage(
        ownerId,
        `⚠️ المتخصص ${specialistName} لم يبدأ محادثة مع البوت\nيرجى إخباره بأن يضغط /start للبوت`
      ).catch(() => {});
    }
    return;
  }

  // 4. أرسل للشخص المحتاج
  try {
    await bot.telegram.sendMessage(
      userId,
      `✅ *تم استلام طلبك!*\n\n` +
      `تم توجيهك إلى المتخصص: *${specialistName}*\n` +
      (specialist.specialty ? `📋 التخصص: ${specialist.specialty}\n` : '') +
      `\n🔗 تواصل معه مباشرة:`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.url(`💬 تواصل مع ${specialistName}`, `tg://user?id=${specialist.user_id}`)],
        ]),
      }
    );
  } catch {
    try {
      const tempMsg = await bot.telegram.sendMessage(chatId,
        `${senderName}، تم توجيه طلبك للمتخصص. تواصل معه: ${specialistName}`);
      setTimeout(() => bot.telegram.deleteMessage(chatId, tempMsg.message_id).catch(() => {}), 10000);
    } catch {}
  }

  // 5. سجّل الجلسة
  await supa.createSession(chatId, userId, specialist.user_id, matched.keyword, originalText);

  // 6. سجّل في audit log
  await supa.addAuditLog(chatId, '🎯 توجيه للمتخصص', 0, 'bot',
    userId, ctx.from.username || ctx.from.first_name,
    `الكلمة: ${matched.keyword} — المتخصص: ${specialistName}`);
}

module.exports = {
  isDeveloper, isAdmin, isOwner, checkBotPermissions,
  getTargetUser, getReason,
  muteMember, muteMemberTimed,
  banMemberTimed,
  unmutePerms,
  promoteUser, demoteUser,
  applyGroupPermissions,
  logAction,
  setJoinApproval,
  lockTopic, unlockTopic, archiveTopic,
  verifyAndRegisterOwner,
  generateCaptcha,
  handleSpecialistRouting,
};
