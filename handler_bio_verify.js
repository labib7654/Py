// ══════════════════════════════════════════════════════════════════════
//  🔍 نظام التحقق من النبذة (Bio Verification System)
//
//  يعمل في حالتين:
//  1️⃣  طلب انضمام لمجموعة فيها مجتمع → يفحص نبذة الطالب
//  2️⃣  أي رسالة خاصة للبوت → يفحص نبذة المرسل
//
//  إذا وُجدت كلمة محظورة في النبذة:
//  - يُحظر من المجتمع وكل مجموعاته
//  - يُضاف إلى قائمة المحظورين مع السبب + يوزر + ID + رابط
//  - يُحذف البوت نفسه من المحادثة مع الشخص (لا يمكنه مراسلة البوت)
//  - يُعلَم المطور + مالك كل مجموعة + قنوات السجلات
//  - فك الحظر يكون من المطور فقط عبر /bio_unban <user_id>
// ══════════════════════════════════════════════════════════════════════

const db            = require('./db');
const { DEVELOPER_ID } = require('./config');
const { isDeveloper }  = require('./helpers');

// ── ذاكرة مؤقتة للتحقق المُعلَّق (لتجنب التكرار) ──────────────────
const _recentlyChecked = new Map(); // userId → timestamp

function _wasRecentlyChecked(userId) {
  const last = _recentlyChecked.get(userId);
  if (!last) return false;
  if (Date.now() - last < 60_000) return true; // لا نتحقق أكثر من مرة كل دقيقة
  return false;
}
function _markChecked(userId) {
  _recentlyChecked.set(userId, Date.now());
  // تنظيف القديم
  if (_recentlyChecked.size > 500) {
    const oldest = [..._recentlyChecked.entries()].sort((a, b) => a[1] - b[1])[0];
    _recentlyChecked.delete(oldest[0]);
  }
}

// ── جلب نبذة المستخدم من Telegram ─────────────────────────────────
async function fetchUserBio(bot, userId) {
  try {
    const chat = await bot.telegram.getChat(userId);
    return chat.bio || '';
  } catch {
    return '';
  }
}

// ── فحص النبذة ضد الكلمات المحظورة لمجتمع معين ────────────────────
// يُعيد: null إذا لا شيء، أو { word, communityId, communityTitle }
function checkBioAgainstCommunity(bio, communityId) {
  if (!bio) return null;
  const com = db.getCommunity(communityId);
  if (!com || !com.enabled) return null;

  // نجمع الكلمات المحظورة من كل مجموعات المجتمع
  const words = new Set();
  for (const groupId of com.subGroups) {
    const g = db.getGroup(groupId);
    if (!g) continue;
    for (const bw of (g.bannedWords || [])) {
      words.add(bw.word.toLowerCase());
    }
  }

  const lowerBio = bio.toLowerCase();
  for (const word of words) {
    if (lowerBio.includes(word)) {
      return { word, communityId, communityTitle: com.title || String(communityId) };
    }
  }
  return null;
}

// ── فحص النبذة ضد كل المجتمعات (للخاص) ───────────────────────────
function checkBioAgainstAllCommunities(bio) {
  if (!bio) return null;
  for (const com of db.allCommunities()) {
    const result = checkBioAgainstCommunity(bio, com.communityId);
    if (result) return result;
  }
  return null;
}

// ══════════════════════════════════════════════════════════════════════
//  تنفيذ الحظر الكامل
// ══════════════════════════════════════════════════════════════════════
async function executeBioBan(bot, user, bio, violation) {
  const { word, communityId, communityTitle } = violation;
  const com = db.getCommunity(communityId);

  // ── 1. تسجيل الحظر في db ────────────────────────────────────────
  const userRec = db.getOrCreateUser(user.id, user.username || '', user.first_name || '');
  userRec.globalBanned  = true;
  userRec.bannedReason  = `نبذة تحتوي كلمة محظورة: "${word}" | المجتمع: ${communityTitle}`;
  userRec.bannedAt      = new Date();
  userRec.bioBanInfo    = {
    word,
    bio:         bio.slice(0, 200),
    communityId,
    communityTitle,
    bannedAt:    new Date(),
    canUnbanBy:  'developer_only',
  };

  // تسجيل في المجتمع
  if (com) {
    if (!com.autoBannedUsers) com.autoBannedUsers = new Map();
    com.autoBannedUsers.set(user.id, {
      reason:    `نبذة محظورة — كلمة: "${word}"`,
      bio:       bio.slice(0, 200),
      bannedAt:  new Date(),
      bannedBy:  'bio_verify',
    });
  }

  db.markDirty();

  // ── 2. بناء رسالة التقرير ────────────────────────────────────────
  const userName    = user.username ? `@${user.username}` : user.first_name || String(user.id);
  const profileLink = user.username
    ? `https://t.me/${user.username}`
    : `tg://user?id=${user.id}`;

  const reportMsg =
    `🚫 *حظر تلقائي — نبذة محظورة*\n\n` +
    `👤 المستخدم: [${userName}](${profileLink})\n` +
    `🆔 ID: \`${user.id}\`\n` +
    `📝 النبذة: \`${bio.slice(0, 150)}${bio.length > 150 ? '...' : ''}\`\n` +
    `🔤 الكلمة المحظورة: \`${word}\`\n` +
    `🏫 المجتمع: *${communityTitle}*\n` +
    `🕐 ${new Date().toLocaleString('ar')}\n\n` +
    `⚠️ _لرفع الحظر: /bio\\_unban ${user.id}_`;

  // ── 3. حظر من كل مجموعات المجتمع ────────────────────────────────
  if (com) {
    for (const groupId of com.subGroups) {
      const g = db.getGroup(groupId);
      try {
        await bot.telegram.banChatMember(groupId, user.id);
        if (g) {
          g.bannedUsers.add(user.id);
          // إرسال إشعار لقناة السجلات
          if (g.logChannelId) {
            try {
              await bot.telegram.sendMessage(g.logChannelId, reportMsg, {
                parse_mode: 'Markdown',
                disable_web_page_preview: true,
              });
            } catch {}
          }
          // إبلاغ مالك المجموعة
          if (g.ownerId) {
            try {
              await bot.telegram.sendMessage(g.ownerId, reportMsg, {
                parse_mode: 'Markdown',
                disable_web_page_preview: true,
              });
            } catch {}
          }
        }
      } catch {}
    }
  }

  // ── 4. إبلاغ المطور ──────────────────────────────────────────────
  try {
    await bot.telegram.sendMessage(DEVELOPER_ID, reportMsg, {
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    });
  } catch {}

  // ── 5. حذف البوت من المحادثة الخاصة (يمنع مراسلته) ─────────────
  // البوت يحذف المحادثة من جانبه — الشخص يرى أن البوت "غير متاح"
  try {
    await bot.telegram.sendMessage(
      user.id,
      `🚫 تم حظرك من استخدام البوت بسبب محتوى غير مسموح في نبذتك الشخصية.\n\nللاعتراض تواصل مع إدارة المجتمع.`
    );
  } catch {}

  // نطلب من Telegram حذف المحادثة من جانب البوت
  try {
    await bot.telegram.callApi('deleteChat', { chat_id: user.id });
  } catch {}
  // بديل: نغلق المحادثة بحظر الأوامر
  // (البوت سيرفض رسائله لاحقاً عبر globalMiddleware)

  return reportMsg;
}

// ══════════════════════════════════════════════════════════════════════
//  الدالة الرئيسية: فحص + حظر إن وُجد مخالفة
//  chatId: مجموعة مصدر الحدث (لتحديد المجتمع)
// ══════════════════════════════════════════════════════════════════════
async function verifyUserBio(bot, user, sourceChatId = null) {
  if (!user || user.is_bot) return null;
  if (_wasRecentlyChecked(user.id)) return null;
  _markChecked(user.id);

  // تجاهل المطور والبوتات المحظورة مسبقاً
  if (user.id === DEVELOPER_ID) return null;
  const userRec = db.getUser(user.id);
  if (userRec?.globalBanned) return null; // محظور مسبقاً

  const bio = await fetchUserBio(bot, user.id);
  if (!bio) return null;

  let violation = null;

  if (sourceChatId) {
    // فحص مجتمع المجموعة المصدر فقط
    const g = db.getGroup(sourceChatId);
    if (g?.communityId) {
      violation = checkBioAgainstCommunity(bio, g.communityId);
    }
    // إن لم تكن مجموعة أو لا مجتمع → فحص كل المجتمعات
    if (!violation) {
      violation = checkBioAgainstAllCommunities(bio);
    }
  } else {
    // رسالة خاصة — فحص كل المجتمعات
    violation = checkBioAgainstAllCommunities(bio);
  }

  if (!violation) return null;

  // تنفيذ الحظر
  await executeBioBan(bot, user, bio, violation);
  return violation;
}

// ══════════════════════════════════════════════════════════════════════
//  تسجيل الـ Handlers
// ══════════════════════════════════════════════════════════════════════
module.exports = function setupBioVerify(bot) {

  // ── 1. فحص طلبات الانضمام ─────────────────────────────────────
  // يعمل قبل handler_groups.js لأنه مسجّل أولاً في index.js
  bot.on('chat_join_request', async (ctx, next) => {
    const req    = ctx.chatJoinRequest;
    const { chat } = req;
    const user   = req.from;

    const g = db.getGroup(chat.id);
    if (!g?.communityId) return next(); // لا مجتمع → لا فحص

    const violation = await verifyUserBio(bot, user, chat.id);

    if (violation) {
      // رفض الطلب تلقائياً
      try { await bot.telegram.declineChatJoinRequest(chat.id, user.id); } catch {}
      // لا نكمل معالجة الطلب
      return;
    }

    return next();
  });

  // ── 2. فحص الرسائل الخاصة ─────────────────────────────────────
  bot.on('message', async (ctx, next) => {
    if (ctx.chat?.type !== 'private') return next();
    if (!ctx.from) return next();

    // لا نفحص المطور
    if (isDeveloper(ctx)) return next();

    // نفحص فقط إذا فيه مجتمعات مفعّلة
    const activeCommunities = db.allCommunities().filter(c => c.enabled);
    if (!activeCommunities.length) return next();

    const violation = await verifyUserBio(bot, ctx.from, null);
    if (violation) {
      // البوت لن يرد — الرسالة المُرسلة في executeBioBan كافية
      return;
    }

    return next();
  });

  // ── 3. أمر فك الحظر (المطور فقط) ─────────────────────────────
  bot.command('bio_unban', async (ctx) => {
    if (!isDeveloper(ctx)) return;

    const args   = ctx.message.text.split(' ').slice(1);
    const userId = Number(args[0]);
    if (!userId) {
      return ctx.replyWithMarkdown(
        `🔓 *رفع حظر النبذة*\n\n` +
        `الاستخدام: \`/bio_unban <user_id>\`\n\n` +
        `_هذا الأمر للمطور فقط — يُفعَّل يدوياً بعد مراجعة حساب الشخص_`
      );
    }

    const userRec = db.getUser(userId);
    if (!userRec) return ctx.reply(`❌ المستخدم \`${userId}\` غير موجود في قاعدة البيانات.`, { parse_mode: 'Markdown' });
    if (!userRec.globalBanned) return ctx.reply(`ℹ️ المستخدم \`${userId}\` غير محظور أصلاً.`, { parse_mode: 'Markdown' });

    const bioBanInfo = userRec.bioBanInfo;
    const communityId = bioBanInfo?.communityId;

    // رفع الحظر من db
    userRec.globalBanned = false;
    userRec.bannedReason = '';
    userRec.bioBanInfo   = null;
    db.markDirty();

    // رفع الحظر من مجموعات المجتمع
    let unbannedFrom = 0;
    if (communityId) {
      const com = db.getCommunity(communityId);
      if (com) {
        com.autoBannedUsers?.delete(userId);
        for (const groupId of com.subGroups) {
          try {
            await bot.telegram.unbanChatMember(groupId, userId);
            const g = db.getGroup(groupId);
            if (g) g.bannedUsers.delete(userId);
            unbannedFrom++;
          } catch {}
        }
      }
    }

    const userName = userRec.username ? `@${userRec.username}` : userRec.firstName || String(userId);
    await ctx.replyWithMarkdown(
      `✅ *تم رفع حظر النبذة*\n\n` +
      `👤 ${userName} \`[${userId}]\`\n` +
      `🏫 المجتمع: ${bioBanInfo?.communityTitle || 'غير محدد'}\n` +
      `🔤 الكلمة: \`${bioBanInfo?.word || 'غير محدد'}\`\n` +
      `📋 رُفع الحظر من: ${unbannedFrom} مجموعة\n` +
      `👨‍💻 بواسطة: المطور`
    );

    // إبلاغ الشخص
    try {
      await bot.telegram.sendMessage(
        userId,
        `✅ تم رفع حظرك من قِبل إدارة البوت. يمكنك الآن استخدام البوت ومجموعاته.`
      );
    } catch {}
  });

  // ── 4. عرض قائمة المحظورين بسبب النبذة ───────────────────────
  bot.command('bio_bans', async (ctx) => {
    if (!isDeveloper(ctx)) return;

    const bioBanned = db.allUsers().filter(u => u.globalBanned && u.bioBanInfo);
    if (!bioBanned.length) {
      return ctx.replyWithMarkdown('🔍 *لا يوجد محظورون بسبب النبذة حالياً.*');
    }

    let text = `🚫 *المحظورون بسبب النبذة* (${bioBanned.length})\n\n`;
    bioBanned.slice(0, 15).forEach((u, i) => {
      const name    = u.username ? `@${u.username}` : u.firstName || String(u.userId);
      const link    = u.username ? `https://t.me/${u.username}` : `tg://user?id=${u.userId}`;
      const info    = u.bioBanInfo;
      text +=
        `${i + 1}. [${name}](${link}) \`[${u.userId}]\`\n` +
        `   🔤 كلمة: \`${info?.word || '—'}\`\n` +
        `   🏫 مجتمع: ${info?.communityTitle || '—'}\n` +
        `   🕐 ${info?.bannedAt ? new Date(info.bannedAt).toLocaleDateString('ar') : '—'}\n\n`;
    });

    if (bioBanned.length > 15) text += `_... و${bioBanned.length - 15} آخرين_\n`;
    text += `\n_لرفع الحظر: /bio\\_unban <user\\_id>_`;

    await ctx.replyWithMarkdown(text, { disable_web_page_preview: true });
  });

};

// تصدير الدالة الأساسية للاستخدام خارجياً (من handler_groups مثلاً)
module.exports.verifyUserBio = verifyUserBio;
