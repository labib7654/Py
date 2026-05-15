// ============================================================
//  helpers.js — دوال مساعدة مشتركة (النسخة المحدّثة)
//  يشمل: فحص الصلاحيات + إجراءات الأعضاء + أدوات الجامعة
// ============================================================

const { DEVELOPER_ID } = require('./config');

// ════════════════════════════════════════════════════════════
//  فحص الصلاحيات
// ════════════════════════════════════════════════════════════

// هل المستخدم هو المطور؟
function isDeveloper(ctx) {
  return ctx.from && ctx.from.id === DEVELOPER_ID;
}

// هل المستخدم مشرف أو مالك في المجموعة؟
async function isAdmin(bot, chatId, userId) {
  try {
    const member = await bot.telegram.getChatMember(chatId, userId);
    return ['administrator', 'creator'].includes(member.status);
  } catch {
    return false;
  }
}

// هل المستخدم مالك المجموعة فقط؟
async function isOwner(bot, chatId, userId) {
  try {
    const member = await bot.telegram.getChatMember(chatId, userId);
    return member.status === 'creator';
  } catch {
    return false;
  }
}

// ════════════════════════════════════════════════════════════
//  تحديد المستخدم المستهدف
// ════════════════════════════════════════════════════════════

// تحديد المستخدم المستهدف (رد أو ذكر أو ID)
async function getTargetUser(ctx) {
  const msg = ctx.message;

  // عبر الرد على رسالة
  if (msg?.reply_to_message?.from) {
    const u = msg.reply_to_message.from;
    return {
      id:        u.id,
      username:  u.username  || '',
      firstName: u.first_name || String(u.id),
    };
  }

  const args = msg?.text ? msg.text.split(' ').slice(1) : [];

  // عبر ذكر @username
  if (args[0]?.startsWith('@')) {
    try {
      const member = await ctx.getChatMember(args[0].replace('@', ''));
      if (member?.user) {
        return {
          id:        member.user.id,
          username:  member.user.username  || '',
          firstName: member.user.first_name || String(member.user.id),
        };
      }
    } catch { }
  }

  // عبر ID رقمي
  if (args[0] && /^\d+$/.test(args[0])) {
    const id = Number(args[0]);
    return { id, username: '', firstName: String(id) };
  }

  return null;
}

// استخراج السبب من الأمر
function getReason(text, offset = 1) {
  return text.split(' ').slice(offset).join(' ').trim() || 'لا يوجد سبب';
}

// ════════════════════════════════════════════════════════════
//  إجراءات الكتم والرفع
// ════════════════════════════════════════════════════════════

// كتم عضو (صلاحيات صفر)
async function muteMember(bot, chatId, userId) {
  await bot.telegram.restrictChatMember(chatId, userId, {
    permissions: {
      can_send_messages:       false,
      can_send_audios:         false,
      can_send_documents:      false,
      can_send_photos:         false,
      can_send_videos:         false,
      can_send_video_notes:    false,
      can_send_voice_notes:    false,
      can_send_polls:          false,
      can_send_other_messages: false,
      can_add_web_page_previews: false,
    },
  });
}

// رفع كتم عضو (صلاحيات كاملة)
async function unmuteMember(bot, chatId, userId) {
  await bot.telegram.restrictChatMember(chatId, userId, {
    permissions: {
      can_send_messages:       true,
      can_send_audios:         true,
      can_send_documents:      true,
      can_send_photos:         true,
      can_send_videos:         true,
      can_send_video_notes:    true,
      can_send_voice_notes:    true,
      can_send_polls:          true,
      can_send_other_messages: true,
      can_add_web_page_previews: true,
    },
  });
}

// ════════════════════════════════════════════════════════════
//  إجراءات الترقية والتخفيض
// ════════════════════════════════════════════════════════════

// ترقية مستخدم مشرفاً
async function promoteUser(bot, chatId, userId) {
  try {
    await bot.telegram.promoteChatMember(chatId, userId, {
      can_manage_chat:       true,
      can_delete_messages:   true,
      can_manage_video_chats: true,
      can_restrict_members:  true,
      can_promote_members:   false,
      can_change_info:       true,
      can_invite_users:      true,
      can_pin_messages:      true,
    });
    return true;
  } catch {
    return false;
  }
}

// تخفيض مشرف (إزالة جميع الصلاحيات)
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
  } catch {
    return false;
  }
}

// ════════════════════════════════════════════════════════════
//  إجراءات قفل المجموعة
// ════════════════════════════════════════════════════════════

// قفل المجموعة — منع الإرسال للجميع
async function lockChat(bot, chatId) {
  await bot.telegram.setChatPermissions(chatId, {
    can_send_messages:       false,
    can_send_audios:         false,
    can_send_documents:      false,
    can_send_photos:         false,
    can_send_videos:         false,
    can_send_video_notes:    false,
    can_send_voice_notes:    false,
    can_send_polls:          false,
    can_send_other_messages: false,
    can_add_web_page_previews: false,
  });
}

// فتح المجموعة — السماح بالإرسال للجميع
async function unlockChat(bot, chatId) {
  await bot.telegram.setChatPermissions(chatId, {
    can_send_messages:       true,
    can_send_audios:         true,
    can_send_documents:      true,
    can_send_photos:         true,
    can_send_videos:         true,
    can_send_video_notes:    true,
    can_send_voice_notes:    true,
    can_send_polls:          true,
    can_send_other_messages: true,
    can_add_web_page_previews: true,
  });
}

// ════════════════════════════════════════════════════════════
//  أدوات الجامعة — جديد
// ════════════════════════════════════════════════════════════

// التحقق من أن المستخدم ينتمي لكلية مسموحة
function isCollegeAllowed(userCollege, allowedColleges) {
  if (!allowedColleges || allowedColleges.length === 0) return true; // لا قيود
  if (!userCollege) return false; // لم يُسجّل كليته
  return allowedColleges.includes(userCollege);
}

// استخراج الروابط من نص
function extractUrls(text) {
  const urlRegex = /https?:\/\/[^\s]+|t\.me\/[^\s]+/g;
  return text.match(urlRegex) || [];
}

// هل الرابط لمجموعة/قناة تيليغرام؟
function isTelegramLink(url) {
  return /t\.me\//i.test(url) || /telegram\.me\//i.test(url);
}

// هل الرابط من نطاق مسموح؟
function isAllowedDomain(url, allowedDomains = []) {
  if (!allowedDomains.length) return false;
  return allowedDomains.some(domain => url.includes(domain));
}

// تحويل مدة إلى نص عربي مقروء
function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0)  return `${d} يوم`;
  if (h > 0)  return `${h} ساعة`;
  if (m > 0)  return `${m} دقيقة`;
  return `${s} ثانية`;
}

// تحويل نص تاريخ إلى Date مع التحقق
function parseDateTime(text) {
  // صيغة: YYYY-MM-DD HH:MM
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/);
  if (!match) return null;
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:00`);
  if (isNaN(date.getTime())) return null;
  return date;
}

// تنسيق التاريخ بالعربي
function formatDate(date) {
  if (!date) return '—';
  return new Date(date).toLocaleString('ar-SA', {
    year:   'numeric',
    month:  'long',
    day:    'numeric',
    hour:   '2-digit',
    minute: '2-digit',
  });
}

// بناء رسم بياني نصي (ASCII bar)
function buildAsciiBar(value, max, length = 10) {
  if (max === 0) return '░'.repeat(length);
  const filled = Math.round((value / max) * length);
  return '█'.repeat(filled) + '░'.repeat(length - filled);
}

// ════════════════════════════════════════════════════════════
//  تصدير
// ════════════════════════════════════════════════════════════

module.exports = {
  // صلاحيات
  isDeveloper,
  isAdmin,
  isOwner,
  // تحديد المستخدم
  getTargetUser,
  getReason,
  // إجراءات الأعضاء
  muteMember,
  unmuteMember,
  promoteUser,
  demoteUser,
  // قفل المجموعة
  lockChat,
  unlockChat,
  // أدوات الجامعة
  isCollegeAllowed,
  extractUrls,
  isTelegramLink,
  isAllowedDomain,
  formatDuration,
  parseDateTime,
  formatDate,
  buildAsciiBar,
};
