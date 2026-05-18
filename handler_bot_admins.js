/**
 * ═══════════════════════════════════════════════════════════════
 *  handler_bot_admins.js — نظام إدارة مشرفي البوت
 *  الإصدار: 4.1
 *
 *  📋 الصلاحيات:
 *  ─────────────────────────────────────────────────────────────
 *  👑 المطور الأساسي (DEVELOPER_ID):
 *    ✅ كل شيء بلا استثناء
 *    ✅ إضافة/حذف مشرفي البوت
 *    ✅ تعديل صلاحيات كل مشرف
 *    ✅ عرض قائمة كل المشرفين
 *
 *  🔐 مشرف البوت (BotAdmin):
 *    ✅ الوصول لكل لوحات المطور (إحصائيات، مجموعات، مستخدمون...)
 *    ✅ تنفيذ كل إجراءات الإدارة (حظر، كتم، طرد...)
 *    ✅ استقبال طلبات التحقق والموافقة عليها
 *    ❌ لا يمكنه إضافة أو حذف مشرفي البوت
 *    ❌ لا يمكنه الوصول للأوامر الحساسة (gban، community...)
 *
 *  📌 الأوامر:
 *    /addadmin <id>    — إضافة مشرف بوت (المطور فقط)
 *    /removeadmin <id> — حذف مشرف بوت (المطور فقط)
 *    /botadmins        — عرض قائمة المشرفين (المطور + المشرفون)
 * ═══════════════════════════════════════════════════════════════
 */

const { Markup } = require('telegraf');
const db         = require('./db');
const { DEVELOPER_ID } = require('./config');
const { isDeveloper, isBotAdmin, isDeveloperOrBotAdmin } = require('./helpers');

// ═══════════════════════════════════════════════════════════════
//  دالة بناء لوحة إدارة المشرفين (للمطور فقط)
// ═══════════════════════════════════════════════════════════════
function buildAdminsPanel(ctx) {
  const admins = db.allBotAdmins();
  let text = `👥 *إدارة مشرفي البوت*\n\n`;
  text += `👑 المطور الأساسي: \`${DEVELOPER_ID}\`\n\n`;

  if (admins.length === 0) {
    text += `📋 *لا يوجد مشرفون حالياً.*\n\n`;
  } else {
    text += `📋 *المشرفون الحاليون (${admins.length}):*\n`;
    for (const id of admins) {
      const user = db.getUser(id);
      const name = user?.username ? `@${user.username}` : (user?.firstName || `\`${id}\``);
      text += `• \`${id}\` — ${name}\n`;
    }
    text += `\n`;
  }

  const btns = [];

  // أزرار حذف المشرفين (للمطور فقط)
  if (isDeveloper(ctx) && admins.length > 0) {
    for (const id of admins) {
      const user = db.getUser(id);
      const name = user?.username ? `@${user.username}` : (user?.firstName || String(id));
      btns.push([
        Markup.button.callback(`❌ إزالة ${name.slice(0, 20)}`, `ba_remove_${id}`),
        Markup.button.callback(`👤 تفاصيل`, `ba_info_${id}`),
      ]);
    }
    btns.push([Markup.button.callback('➕ إضافة مشرف جديد', 'ba_add_prompt')]);
  } else if (isDeveloper(ctx)) {
    btns.push([Markup.button.callback('➕ إضافة مشرف جديد', 'ba_add_prompt')]);
  }

  btns.push([
    Markup.button.callback('🔄 تحديث', 'ba_panel'),
    Markup.button.callback('🔙 رجوع',  'dev_back'),
  ]);

  return { text, btns };
}

// ═══════════════════════════════════════════════════════════════
//  Map لتتبع حالة إضافة مشرف جديد
// ═══════════════════════════════════════════════════════════════
const pendingAdd = new Map(); // userId → { step: 'awaiting_id' | 'confirming', targetId }

module.exports = function setupBotAdmins(bot) {

  // ════════════════════════════════════════════════════════════
  //  🔐 /addadmin — إضافة مشرف بوت (المطور الأساسي فقط)
  // ════════════════════════════════════════════════════════════
  bot.command('addadmin', async (ctx) => {
    if (ctx.chat.type !== 'private') {
      try { await ctx.deleteMessage(); } catch {}
      return;
    }
    if (!isDeveloper(ctx))
      return ctx.reply('❌ هذا الأمر للمطور الأساسي فقط.');

    const arg    = ctx.message.text.split(' ')[1];
    const userId = Number(arg);

    if (!arg || isNaN(userId)) {
      return ctx.replyWithMarkdown(
        `➕ *إضافة مشرف بوت*\n\n` +
        `الاستخدام: \`/addadmin <ID>\`\n\n` +
        `مثال: \`/addadmin 123456789\`\n\n` +
        `أو افتح لوحة الإدارة:`,
        Markup.inlineKeyboard([[Markup.button.callback('👥 لوحة المشرفين', 'ba_panel')]])
      );
    }

    if (userId === DEVELOPER_ID)
      return ctx.reply('⚠️ هذا هو المطور الأساسي بالفعل!');

    if (db.isBotAdmin(userId))
      return ctx.replyWithMarkdown(`⚠️ \`${userId}\` مشرف بوت بالفعل!`);

    // تخزين حالة انتظار التأكيد
    pendingAdd.set(ctx.from.id, { step: 'confirming', targetId: userId });

    const user = db.getUser(userId);
    const name = user?.username ? `@${user.username}` : (user?.firstName || `غير معروف`);

    await ctx.replyWithMarkdown(
      `➕ *تأكيد إضافة مشرف بوت*\n\n` +
      `👤 المستخدم: ${name}\n` +
      `🆔 المعرف: \`${userId}\`\n\n` +
      `⚠️ سيحصل على كامل صلاحيات لوحة المطور **عدا** إضافة/حذف مشرفين آخرين.\n\n` +
      `هل تريد المتابعة؟`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback('✅ تأكيد الإضافة', `ba_confirm_add_${userId}`),
          Markup.button.callback('❌ إلغاء',          'ba_cancel'),
        ],
      ])
    );
  });

  // ════════════════════════════════════════════════════════════
  //  🗑️ /removeadmin — حذف مشرف بوت (المطور الأساسي فقط)
  // ════════════════════════════════════════════════════════════
  bot.command('removeadmin', async (ctx) => {
    if (ctx.chat.type !== 'private') {
      try { await ctx.deleteMessage(); } catch {}
      return;
    }
    if (!isDeveloper(ctx))
      return ctx.reply('❌ هذا الأمر للمطور الأساسي فقط.');

    const arg    = ctx.message.text.split(' ')[1];
    const userId = Number(arg);

    if (!arg || isNaN(userId)) {
      return ctx.replyWithMarkdown(
        `🗑️ *إزالة مشرف بوت*\n\n` +
        `الاستخدام: \`/removeadmin <ID>\`\n\n` +
        `أو افتح لوحة الإدارة:`,
        Markup.inlineKeyboard([[Markup.button.callback('👥 لوحة المشرفين', 'ba_panel')]])
      );
    }

    if (!db.isBotAdmin(userId))
      return ctx.replyWithMarkdown(`⚠️ \`${userId}\` ليس مشرف بوت.`);

    const user = db.getUser(userId);
    const name = user?.username ? `@${user.username}` : (user?.firstName || String(userId));

    await ctx.replyWithMarkdown(
      `🗑️ *تأكيد إزالة مشرف بوت*\n\n` +
      `👤 المستخدم: ${name}\n` +
      `🆔 المعرف: \`${userId}\`\n\n` +
      `هل تريد إزالة صلاحياته؟`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback('✅ تأكيد الإزالة', `ba_confirm_remove_${userId}`),
          Markup.button.callback('❌ إلغاء',           'ba_cancel'),
        ],
      ])
    );
  });

  // ════════════════════════════════════════════════════════════
  //  📋 /botadmins — عرض القائمة (المطور والمشرفون)
  // ════════════════════════════════════════════════════════════
  bot.command('botadmins', async (ctx) => {
    if (ctx.chat.type !== 'private') {
      try { await ctx.deleteMessage(); } catch {}
      return;
    }
    if (!isDeveloperOrBotAdmin(ctx))
      return ctx.reply('❌ ليس لديك صلاحية!');

    const admins = db.allBotAdmins();
    let text = `👥 *مشرفو البوت*\n\n`;
    text += `👑 المطور الأساسي: \`${DEVELOPER_ID}\`\n\n`;

    if (admins.length === 0) {
      text += `_لا يوجد مشرفون إضافيون._`;
    } else {
      text += `📋 *المشرفون (${admins.length}):*\n`;
      for (const id of admins) {
        const user = db.getUser(id);
        const name = user?.username ? `@${user.username}` : (user?.firstName || `\`${id}\``);
        text += `• \`${id}\` — ${name}\n`;
      }
    }

    const btns = [];
    if (isDeveloper(ctx)) {
      btns.push([Markup.button.callback('⚙️ إدارة المشرفين', 'ba_panel')]);
    }

    await ctx.replyWithMarkdown(text, btns.length ? Markup.inlineKeyboard(btns) : undefined);
  });

  // ════════════════════════════════════════════════════════════
  //  📌 ba_panel — لوحة إدارة المشرفين (للمطور فقط)
  // ════════════════════════════════════════════════════════════
  bot.action('ba_panel', async (ctx) => {
    if (!isDeveloper(ctx))
      return ctx.answerCbQuery('❌ المطور الأساسي فقط!', { show_alert: true });
    await ctx.answerCbQuery();

    const { text, btns } = buildAdminsPanel(ctx);
    try {
      await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) });
    } catch {
      await ctx.reply(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) });
    }
  });

  // ════════════════════════════════════════════════════════════
  //  ➕ ba_add_prompt — طلب إدخال ID للإضافة
  // ════════════════════════════════════════════════════════════
  bot.action('ba_add_prompt', async (ctx) => {
    if (!isDeveloper(ctx))
      return ctx.answerCbQuery('❌ المطور الأساسي فقط!', { show_alert: true });
    await ctx.answerCbQuery();

    pendingAdd.set(ctx.from.id, { step: 'awaiting_id' });

    await ctx.editMessageText(
      `➕ *إضافة مشرف بوت جديد*\n\n` +
      `أرسل معرف المستخدم (ID) الرقمي في هذه المحادثة.\n\n` +
      `مثال: \`123456789\`\n\n` +
      `_لمعرفة ID أي مستخدم، استخدم /userinfo @username_`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('❌ إلغاء', 'ba_cancel')]]),
      }
    );
  });

  // ════════════════════════════════════════════════════════════
  //  ✅ ba_confirm_add — تأكيد إضافة مشرف
  // ════════════════════════════════════════════════════════════
  bot.action(/^ba_confirm_add_(\d+)$/, async (ctx) => {
    if (!isDeveloper(ctx))
      return ctx.answerCbQuery('❌ المطور الأساسي فقط!', { show_alert: true });
    await ctx.answerCbQuery();

    const userId = Number(ctx.match[1]);
    pendingAdd.delete(ctx.from.id);

    if (db.isBotAdmin(userId)) {
      return ctx.editMessageText(`⚠️ \`${userId}\` مشرف بالفعل.`, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', 'ba_panel')]]),
      });
    }

    db.addBotAdmin(userId);

    const user = db.getUser(userId);
    const name = user?.username ? `@${user.username}` : (user?.firstName || String(userId));

    // إشعار المشرف الجديد
    try {
      await bot.telegram.sendMessage(userId,
        `🔐 *تمت ترقيتك كمشرف بوت!*\n\n` +
        `مرحباً بك في فريق إدارة البوت 🎉\n\n` +
        `📋 *صلاحياتك:*\n` +
        `✅ الوصول الكامل للوحة التحكم\n` +
        `✅ إدارة المجموعات والأعضاء\n` +
        `✅ استقبال طلبات التحقق والموافقة عليها\n` +
        `✅ الحظر/الكتم/الطرد في أي مجموعة\n` +
        `✅ عرض الإحصائيات والتقارير\n\n` +
        `❌ *استثناء:* إضافة/حذف مشرفين آخرين\n\n` +
        `▶️ استخدم /dev للوصول للوحة التحكم.`,
        { parse_mode: 'Markdown' }
      );
    } catch {}

    await ctx.editMessageText(
      `✅ *تمت إضافة مشرف بوت جديد*\n\n` +
      `👤 المشرف: ${name}\n` +
      `🆔 المعرف: \`${userId}\`\n\n` +
      `تم إشعاره بصلاحياته الجديدة.`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('🔙 العودة للقائمة', 'ba_panel')]]),
      }
    );
  });

  // ════════════════════════════════════════════════════════════
  //  ❌ ba_confirm_remove — تأكيد إزالة مشرف
  // ════════════════════════════════════════════════════════════
  bot.action(/^ba_confirm_remove_(\d+)$/, async (ctx) => {
    if (!isDeveloper(ctx))
      return ctx.answerCbQuery('❌ المطور الأساسي فقط!', { show_alert: true });
    await ctx.answerCbQuery();

    const userId = Number(ctx.match[1]);

    if (!db.isBotAdmin(userId)) {
      return ctx.editMessageText(`⚠️ \`${userId}\` ليس مشرف بوت.`, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', 'ba_panel')]]),
      });
    }

    db.removeBotAdmin(userId);

    const user = db.getUser(userId);
    const name = user?.username ? `@${user.username}` : (user?.firstName || String(userId));

    // إشعار المشرف المُزال
    try {
      await bot.telegram.sendMessage(userId,
        `⚠️ *تم إلغاء صلاحياتك كمشرف بوت.*\n\n` +
        `لم يعد بإمكانك الوصول لأوامر الإدارة.\n` +
        `للاستفسار، تواصل مع المطور.`,
        { parse_mode: 'Markdown' }
      );
    } catch {}

    await ctx.editMessageText(
      `✅ *تمت إزالة المشرف*\n\n` +
      `👤 المستخدم: ${name}\n` +
      `🆔 المعرف: \`${userId}\`\n\n` +
      `تم إلغاء كامل صلاحياته وإشعاره.`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('🔙 العودة للقائمة', 'ba_panel')]]),
      }
    );
  });

  // ════════════════════════════════════════════════════════════
  //  ❌ ba_remove — حذف مشرف من زر في القائمة
  // ════════════════════════════════════════════════════════════
  bot.action(/^ba_remove_(\d+)$/, async (ctx) => {
    if (!isDeveloper(ctx))
      return ctx.answerCbQuery('❌ المطور الأساسي فقط!', { show_alert: true });
    await ctx.answerCbQuery();

    const userId = Number(ctx.match[1]);
    const user   = db.getUser(userId);
    const name   = user?.username ? `@${user.username}` : (user?.firstName || String(userId));

    await ctx.editMessageText(
      `🗑️ *تأكيد إزالة مشرف بوت*\n\n` +
      `👤 المستخدم: ${name}\n` +
      `🆔 المعرف: \`${userId}\`\n\n` +
      `هل تريد إزالة صلاحياته؟`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('✅ نعم، إزالة', `ba_confirm_remove_${userId}`),
            Markup.button.callback('❌ إلغاء',       'ba_panel'),
          ],
        ]),
      }
    );
  });

  // ════════════════════════════════════════════════════════════
  //  👤 ba_info — تفاصيل مشرف
  // ════════════════════════════════════════════════════════════
  bot.action(/^ba_info_(\d+)$/, async (ctx) => {
    if (!isDeveloper(ctx))
      return ctx.answerCbQuery('❌ المطور الأساسي فقط!', { show_alert: true });
    await ctx.answerCbQuery();

    const userId = Number(ctx.match[1]);
    const user   = db.getUser(userId);
    const name   = user?.username ? `@${user.username}` : (user?.firstName || String(userId));

    // المجموعات التي أضافها
    const addedGroups = db.allGroups().filter(g => g.addedBy === userId);

    await ctx.editMessageText(
      `👤 *تفاصيل مشرف البوت*\n\n` +
      `🆔 المعرف: \`${userId}\`\n` +
      `📛 الاسم: ${user?.firstName || '—'}\n` +
      `🔗 يوزر: ${user?.username ? `@${user.username}` : '—'}\n` +
      `📅 أول ظهور: ${user ? new Date(user.firstSeen).toLocaleDateString('ar') : '—'}\n` +
      `👁️ آخر ظهور: ${user ? new Date(user.lastSeen).toLocaleDateString('ar') : '—'}\n` +
      `👥 مجموعاته: \`${addedGroups.length}\`\n` +
      `🌍 محظور عالمياً: ${user?.globalBanned ? `✅ — ${user.bannedReason}` : '❌'}`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('❌ إزالة المشرف', `ba_remove_${userId}`),
          ],
          [Markup.button.callback('🔙 رجوع', 'ba_panel')],
        ]),
      }
    );
  });

  // ════════════════════════════════════════════════════════════
  //  ❌ ba_cancel — إلغاء أي عملية
  // ════════════════════════════════════════════════════════════
  bot.action('ba_cancel', async (ctx) => {
    await ctx.answerCbQuery('تم الإلغاء');
    pendingAdd.delete(ctx.from.id);

    if (isDeveloper(ctx)) {
      const { text, btns } = buildAdminsPanel(ctx);
      try {
        await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) });
      } catch {
        await ctx.reply(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) });
      }
    } else {
      try { await ctx.deleteMessage(); } catch {}
    }
  });

  // ════════════════════════════════════════════════════════════
  //  💬 استقبال ID بعد ba_add_prompt في الخاص
  // ════════════════════════════════════════════════════════════
  bot.on('text', async (ctx, next) => {
    if (ctx.chat.type !== 'private') return next();
    if (!isDeveloper(ctx)) return next();

    const state = pendingAdd.get(ctx.from.id);
    if (!state || state.step !== 'awaiting_id') return next();

    const text   = ctx.message.text.trim();
    const userId = Number(text);

    if (isNaN(userId) || userId === 0) {
      await ctx.reply(
        `❌ *معرف غير صحيح*\n\nأرسل معرفاً رقمياً صحيحاً.\nمثال: \`123456789\``,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([[Markup.button.callback('❌ إلغاء', 'ba_cancel')]]),
        }
      );
      return;
    }

    if (userId === DEVELOPER_ID) {
      await ctx.reply('⚠️ هذا هو المطور الأساسي بالفعل!');
      pendingAdd.delete(ctx.from.id);
      return;
    }

    if (db.isBotAdmin(userId)) {
      await ctx.replyWithMarkdown(`⚠️ \`${userId}\` مشرف بوت بالفعل.`);
      pendingAdd.delete(ctx.from.id);
      return;
    }

    // انتقال لمرحلة التأكيد
    pendingAdd.set(ctx.from.id, { step: 'confirming', targetId: userId });

    const user = db.getUser(userId);
    const name = user?.username ? `@${user.username}` : (user?.firstName || `غير معروف في قاعدة البيانات`);

    await ctx.replyWithMarkdown(
      `➕ *تأكيد إضافة مشرف بوت*\n\n` +
      `👤 المستخدم: ${name}\n` +
      `🆔 المعرف: \`${userId}\`\n\n` +
      `⚠️ *الصلاحيات التي سيحصل عليها:*\n` +
      `✅ الوصول الكامل للوحة التحكم\n` +
      `✅ إدارة المجموعات والأعضاء\n` +
      `✅ استقبال طلبات التحقق\n` +
      `❌ إضافة/حذف مشرفين آخرين\n\n` +
      `هل تريد المتابعة؟`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback('✅ تأكيد الإضافة', `ba_confirm_add_${userId}`),
          Markup.button.callback('❌ إلغاء',          'ba_cancel'),
        ],
      ])
    );
  });

};
