// ============================================================
//  جميع معالجات البوت (المطور + المجموعات + الإدارة)
// ============================================================

const { Markup } = require('telegraf');
const db = require('./db');
const { isDeveloper, isAdmin, getTargetUser, getReason, muteMember, unmuteMember, promoteUser } = require('./helpers');

// ════════════════════════════════════════════════════════════
//  لوحة المطور
// ════════════════════════════════════════════════════════════

function devMainKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📊 الإحصائيات',   'dev_stats'),
     Markup.button.callback('👥 المجموعات',    'dev_groups')],
    [Markup.button.callback('📢 بث رسالة',     'dev_broadcast'),
     Markup.button.callback('🔍 التحقق السري', 'dev_verify')],
    [Markup.button.callback('🚫 حظر مستخدم',   'dev_ban_menu'),
     Markup.button.callback('✅ رفع حظر',      'dev_unban_menu')],
    [Markup.button.callback('📋 المحظورون',    'dev_banned_list'),
     Markup.button.callback('🔄 تحديث',        'dev_refresh')],
  ]);
}

function backBtn(cb) {
  return Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', cb)]]);
}

function setupDeveloper(bot) {

  // /start في الخاص
  bot.command('start', async (ctx) => {
    if (ctx.chat.type !== 'private') return;
    const stats = db.getStats();
    if (isDeveloper(ctx)) {
      await ctx.replyWithMarkdown(
        `🤖 *بوت إدارة المجموعات*\n\n🔐 مرحباً بك في لوحة التحكم السرية!\n\n` +
        `📊 *الإحصائيات:*\n• المجموعات: \`${stats.totalGroups}\`\n` +
        `• المستخدمون: \`${stats.totalUsers}\`\n• المحظورون: \`${stats.bannedUsers}\``,
        devMainKeyboard()
      );
    } else {
      const u = ctx.from;
      await ctx.replyWithMarkdown(
        `👋 *مرحباً ${u.first_name}!*\n\nأنا بوت إدارة المجموعات والمجتمعات.\n\n` +
        `📌 أضفني لمجموعتك وامنحني صلاحيات المشرف!\n\n` +
        `⚙️ *الميزات:*\n• إدارة شاملة للأعضاء\n• نظام تحذيرات تلقائي\n` +
        `• رسائل ترحيب مخصصة\n• حماية من السبام`,
        Markup.inlineKeyboard([
          [Markup.button.url('➕ أضفني لمجموعتك', `https://t.me/${ctx.botInfo.username}?startgroup=true`)],
          [Markup.button.callback('ℹ️ مساعدة', 'help_menu')],
        ])
      );
    }
  });

  // /dev
  bot.command('dev', (ctx, next) => { if (!isDeveloper(ctx)) return; return next(); }, async (ctx) => {
    const stats = db.getStats();
    await ctx.replyWithMarkdown(
      `🔐 *لوحة تحكم المطور*\n\n📊 *إحصائيات سريعة:*\n` +
      `• المجموعات: \`${stats.totalGroups}\`\n• المستخدمون: \`${stats.totalUsers}\`\n` +
      `• المحظورون: \`${stats.bannedUsers}\`\n• المشرفون: \`${stats.totalAdmins}\``,
      devMainKeyboard()
    );
  });

  // زر الإحصائيات
  bot.action('dev_stats', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const s = db.getStats();
    await ctx.editMessageText(
      `📊 *إحصائيات مفصّلة*\n\n👥 المجموعات: \`${s.totalGroups}\`\n` +
      `👤 المستخدمون: \`${s.totalUsers}\`\n🚫 المحظورون عالمياً: \`${s.bannedUsers}\`\n` +
      `👮 المشرفون المسجلون: \`${s.totalAdmins}\`\n⚠️ التحذيرات الكلية: \`${s.totalWarns}\`\n` +
      `📅 التاريخ: \`${new Date().toLocaleDateString('ar-SA')}\``,
      { parse_mode: 'Markdown', ...backBtn('dev_back') }
    );
  });

  // زر المجموعات
  bot.action('dev_groups', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const groups = db.allGroups();
    if (groups.length === 0) {
      return ctx.editMessageText('👥 *قائمة المجموعات*\n\nلا توجد مجموعات حتى الآن.',
        { parse_mode: 'Markdown', ...backBtn('dev_back') });
    }
    const btns = groups.slice(0, 8).map(g =>
      [Markup.button.callback(`👥 ${g.title.slice(0, 22)}`, `dev_grp_${g.chatId}`)]
    );
    btns.push([Markup.button.callback('🔙 رجوع', 'dev_back')]);
    await ctx.editMessageText(
      `👥 *المجموعات* (${groups.length})`,
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) }
    );
  });

  // تفاصيل مجموعة
  bot.action(/^dev_grp_(-?\d+)$/, async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId);
    if (!g) return ctx.answerCbQuery('❌ غير موجودة!', { show_alert: true });
    const warns = [...g.warns.values()].reduce((a, w) => a + w.length, 0);
    await ctx.editMessageText(
      `📋 *${g.title}*\n\n🆔 المعرف: \`${g.chatId}\`\n👑 المالك: \`${g.ownerUsername || 'غير محدد'}\`\n` +
      `➕ أضافه: \`${g.addedByUsername}\`\n📅 الإضافة: \`${g.addedAt.toLocaleDateString('ar-SA')}\`\n` +
      `👮 المشرفون: \`${g.admins.size}\`\n⚠️ التحذيرات: \`${warns}\`\n` +
      `🛡️ مكافحة السبام: ${g.antiSpam ? '✅' : '❌'}\n👋 رسالة الترحيب: ${g.welcomeEnabled ? '✅' : '❌'}`,
      { parse_mode: 'Markdown', ...backBtn('dev_groups') }
    );
  });

  // التحقق السري
  bot.action('dev_verify', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const groups = db.allGroups();
    if (groups.length === 0) {
      return ctx.editMessageText('🔍 *نظام التحقق السري*\n\nلا توجد بيانات.',
        { parse_mode: 'Markdown', ...backBtn('dev_back') });
    }
    let text = '🔍 *التحقق السري - المشرفون*\n\n';
    for (const g of groups.slice(0, 4)) {
      text += `📌 *${g.title}*\n👑 المالك: \`${g.ownerUsername || 'غير محدد'}\`\n`;
      if (g.admins.size > 0) {
        for (const a of g.admins.values()) {
          text += `  👮 @${a.username} ← @${a.promotedByUsername}\n`;
        }
      } else {
        text += `  _لا يوجد مشرفون مسجلون_\n`;
      }
      text += '\n';
    }
    if (groups.length > 4) text += `_...و${groups.length - 4} مجموعة أخرى_`;
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...backBtn('dev_back') });
  });

  bot.action('dev_broadcast', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      '📢 *بث رسالة جماعية*\n\nاستخدم الأمر:\n`/broadcast نص الرسالة`',
      { parse_mode: 'Markdown', ...backBtn('dev_back') }
    );
  });

  bot.action('dev_ban_menu', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      '🚫 *حظر عالمي*\n\nاستخدم: `/gban <id> <السبب>`',
      { parse_mode: 'Markdown', ...backBtn('dev_back') }
    );
  });

  bot.action('dev_unban_menu', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      '✅ *رفع الحظر العالمي*\n\nاستخدم: `/ungban <id>`',
      { parse_mode: 'Markdown', ...backBtn('dev_back') }
    );
  });

  bot.action('dev_banned_list', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const banned = db.allUsers().filter(u => u.globalBanned);
    if (banned.length === 0) {
      return ctx.editMessageText('📋 *المحظورون عالمياً*\n\nلا يوجد مستخدمون محظورون.',
        { parse_mode: 'Markdown', ...backBtn('dev_back') });
    }
    let text = `📋 *المحظورون عالمياً* (${banned.length})\n\n`;
    banned.slice(0, 10).forEach(u => {
      text += `• \`${u.userId}\` — ${u.bannedReason}\n`;
    });
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...backBtn('dev_back') });
  });

  bot.action('dev_refresh', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery('🔄 تم التحديث!');
    const s = db.getStats();
    await ctx.editMessageText(
      `🔐 *لوحة تحكم المطور*\n\n📊 *الإحصائيات:*\n• المجموعات: \`${s.totalGroups}\`\n` +
      `• المستخدمون: \`${s.totalUsers}\`\n• المحظورون: \`${s.bannedUsers}\``,
      { parse_mode: 'Markdown', ...devMainKeyboard() }
    );
  });

  bot.action('dev_back', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const s = db.getStats();
    await ctx.editMessageText(
      `🔐 *لوحة تحكم المطور*\n\n📊 *الإحصائيات:*\n• المجموعات: \`${s.totalGroups}\`\n` +
      `• المستخدمون: \`${s.totalUsers}\`\n• المحظورون: \`${s.bannedUsers}\``,
      { parse_mode: 'Markdown', ...devMainKeyboard() }
    );
  });

  // /broadcast
  bot.command('broadcast', async (ctx, next) => {
    if (!isDeveloper(ctx)) return;
    const text = ctx.message.text.replace('/broadcast', '').trim();
    if (!text) return ctx.reply('❌ أرسل النص بعد الأمر!\nمثال: /broadcast مرحباً بالجميع');
    const groups = db.allGroups();
    await ctx.reply(`📢 جاري الإرسال لـ ${groups.length} مجموعة...`);
    let sent = 0, failed = 0;
    for (const g of groups) {
      try {
        await bot.telegram.sendMessage(g.chatId, `📢 *رسالة إدارة البوت*\n\n${text}`, { parse_mode: 'Markdown' });
        sent++;
      } catch { failed++; }
    }
    await ctx.replyWithMarkdown(`✅ *اكتمل البث*\n\n• تم: \`${sent}\`\n• فشل: \`${failed}\``);
  });

  // /gban
  bot.command('gban', async (ctx) => {
    if (!isDeveloper(ctx)) return;
    const args = ctx.message.text.split(' ').slice(1);
    const targetId = Number(args[0]);
    const reason = args.slice(1).join(' ') || 'لا يوجد سبب';
    if (!targetId || isNaN(targetId)) return ctx.reply('❌ مثال: /gban 123456789 سبب الحظر');
    const user = db.getOrCreateUser(targetId, '', '');
    user.globalBanned = true;
    user.bannedReason = reason;
    user.bannedAt = new Date();
    await ctx.replyWithMarkdown(`🚫 *تم الحظر العالمي*\n\n👤 المعرف: \`${targetId}\`\n📝 السبب: ${reason}`);
    for (const g of db.allGroups()) {
      try { await bot.telegram.banChatMember(g.chatId, targetId); } catch { }
    }
  });

  // /ungban
  bot.command('ungban', async (ctx) => {
    if (!isDeveloper(ctx)) return;
    const targetId = Number(ctx.message.text.split(' ')[1]);
    if (!targetId || isNaN(targetId)) return ctx.reply('❌ مثال: /ungban 123456789');
    const user = db.getUser(targetId);
    if (!user) return ctx.reply('❌ المستخدم غير موجود!');
    user.globalBanned = false;
    user.bannedReason = '';
    user.bannedAt = null;
    await ctx.replyWithMarkdown(`✅ *تم رفع الحظر العالمي عن:* \`${targetId}\``);
  });

  // مساعدة
  bot.action('help_menu', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      '📖 *دليل الاستخدام*\n\n🔧 *الأوامر في المجموعات:*\n' +
      '• `/admins` — قائمة المشرفين\n• `/ban` — حظر عضو\n• `/kick` — طرد عضو\n' +
      '• `/mute` — كتم عضو\n• `/unmute` — رفع الكتم\n• `/warn` — تحذير (3 = حظر)\n' +
      '• `/warns` — تحذيرات عضو\n• `/settings` — إعدادات المجموعة\n' +
      '• `/setwelcome` — تعديل الترحيب\n• `/manage` — إدارة عضو بأزرار',
      { parse_mode: 'Markdown', ...backBtn('help_back') }
    );
  });

  bot.action('help_back', async (ctx) => {
    await ctx.answerCbQuery();
    const u = ctx.from;
    await ctx.editMessageText(
      `👋 *مرحباً ${u.first_name}!*\n\nأضفني لمجموعتك وامنحني صلاحيات المشرف!`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.url('➕ أضفني لمجموعتك', `https://t.me/${ctx.botInfo.username}?startgroup=true`)],
          [Markup.button.callback('ℹ️ مساعدة', 'help_menu')],
        ])
      }
    );
  });
}

// ════════════════════════════════════════════════════════════
//  أحداث المجموعات
// ════════════════════════════════════════════════════════════

function groupSettingsKeyboard(chatId, s) {
  return Markup.inlineKeyboard([
    [Markup.button.callback(`${s.welcomeEnabled ? '✅' : '❌'} رسالة الترحيب`, `toggle_welcome_${chatId}`)],
    [Markup.button.callback(`${s.antiSpam ? '✅' : '❌'} مكافحة السبام`, `toggle_antispam_${chatId}`)],
    [Markup.button.callback(`${s.muteNewMembers ? '✅' : '❌'} كتم الأعضاء الجدد`, `toggle_mutenew_${chatId}`)],
    [Markup.button.callback('✏️ تعديل رسالة الترحيب', `edit_welcome_${chatId}`)],
    [Markup.button.callback('🔙 رجوع', `group_home_${chatId}`)],
  ]);
}

function groupHomeKeyboard(chatId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('⚙️ إعدادات المجموعة', `settings_${chatId}`),
     Markup.button.callback('👥 قائمة المشرفين',   `admins_${chatId}`)],
    [Markup.button.callback('📋 قواعد المجموعة',   `rules_${chatId}`),
     Markup.button.callback('📊 إحصائيات',         `stats_${chatId}`)],
  ]);
}

function memberActionsKeyboard(targetId, chatId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🔇 كتم',      `mute_${targetId}_${chatId}`),
     Markup.button.callback('🔊 رفع كتم',  `unmute_${targetId}_${chatId}`)],
    [Markup.button.callback('⚠️ تحذير',    `warn_${targetId}_${chatId}`),
     Markup.button.callback('👢 طرد',      `kick_${targetId}_${chatId}`)],
    [Markup.button.callback('🚫 حظر',      `ban_${targetId}_${chatId}`),
     Markup.button.callback('✅ رفع حظر',  `unban_${targetId}_${chatId}`)],
    [Markup.button.callback('📋 معلومات', `info_${targetId}_${chatId}`),
     Markup.button.callback('❌ إلغاء',    `cancel_${chatId}`)],
  ]);
}

function setupGroupHandlers(bot) {

  // إضافة/إزالة البوت من مجموعة
  bot.on('my_chat_member', async (ctx) => {
    const upd     = ctx.myChatMember;
    const chat    = upd.chat;
    const from    = upd.from;
    const newStat = upd.new_chat_member.status;
    const oldStat = upd.old_chat_member.status;

    if (chat.type === 'private') return;

    if ((newStat === 'member' || newStat === 'administrator') &&
        (oldStat === 'left'   || oldStat === 'kicked')) {

      const group = db.getOrCreateGroup(
        chat.id, chat.title || 'مجموعة', chat.type,
        from.id, from.username || from.first_name || String(from.id)
      );
      db.getOrCreateUser(from.id, from.username || '', from.first_name || '').groups.add(chat.id);

      // ترقية تلقائية لمن أضاف البوت
      let promoted = false;
      if (newStat === 'administrator') {
        promoted = await promoteUser(bot, chat.id, from.id);
      } else {
        try {
          const me = await bot.telegram.getChatMember(chat.id, ctx.botInfo.id);
          if (me.status === 'administrator') {
            promoted = await promoteUser(bot, chat.id, from.id);
          }
        } catch { }
      }

      if (promoted) {
        group.admins.set(from.id, {
          username: from.username || from.first_name || String(from.id),
          promotedBy: ctx.botInfo.id,
          promotedByUsername: ctx.botInfo.username || 'Bot',
          promotedAt: new Date(),
        });
      }

      const welcomeText =
        `🤖 *شكراً لإضافتي إلى ${chat.title}!*\n\n` +
        (promoted ? `✅ تم ترقية @${from.username || from.first_name} مشرفاً تلقائياً!\n\n` : '') +
        `🛡️ أنا جاهز لإدارة مجموعتك.\n` +
        `📌 *ميزاتي:* إدارة أعضاء | تحذيرات تلقائية | حماية سبام\n\n` +
        `_للإعدادات استخدم /settings_`;

      await ctx.replyWithMarkdown(welcomeText, groupHomeKeyboard(chat.id));

    } else if (newStat === 'left' || newStat === 'kicked') {
      db.deleteGroup(chat.id);
    }
  });

  // تتبع ترقية المشرفين
  bot.on('chat_member', async (ctx) => {
    const upd       = ctx.chatMember;
    const chat      = upd.chat;
    const newMember = upd.new_chat_member;
    const oldMember = upd.old_chat_member;
    const by        = upd.from;

    if (newMember.status === 'administrator' && oldMember.status !== 'administrator') {
      const group = db.getGroup(chat.id);
      if (!group) return;
      const u = newMember.user;
      group.admins.set(u.id, {
        username: u.username || u.first_name || String(u.id),
        promotedBy: by.id,
        promotedByUsername: by.username || by.first_name || String(by.id),
        promotedAt: new Date(),
      });
    }

    // ترحيب بالأعضاء الجدد
    if (newMember.status === 'member' && (oldMember.status === 'left' || oldMember.status === 'kicked')) {
      const group = db.getGroup(chat.id);
      if (!group || !group.welcomeEnabled) return;
      const u = newMember.user;
      if (u.is_bot) return;

      db.getOrCreateUser(u.id, u.username || '', u.first_name || '').groups.add(chat.id);

      const globalUser = db.getUser(u.id);
      if (globalUser && globalUser.globalBanned) {
        try {
          await bot.telegram.banChatMember(chat.id, u.id);
          await bot.telegram.sendMessage(chat.id, `🚫 تم طرد @${u.username || u.first_name} (محظور عالمياً).`);
        } catch { }
        return;
      }

      if (group.muteNewMembers) {
        try { await muteMember(bot, chat.id, u.id); } catch { }
      }

      const msg = group.welcomeMessage
        .replace('{name}', u.first_name || '')
        .replace('{group}', chat.title || 'المجموعة')
        .replace('{username}', u.username ? `@${u.username}` : u.first_name || '');

      try {
        await bot.telegram.sendMessage(chat.id, `👋 ${msg}`, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([[Markup.button.callback('📋 القواعد', `rules_${chat.id}`)]]),
        });
      } catch { }
    }
  });

  // أزرار المجموعة الرئيسية
  bot.action(/^settings_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const group  = db.getGroup(chatId);
    if (!group) return ctx.answerCbQuery('❌ بيانات غير موجودة!', { show_alert: true });
    if (!await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    await ctx.editMessageText(
      `⚙️ *إعدادات ${group.title}*\n\nاضغط لتفعيل/تعطيل:`,
      { parse_mode: 'Markdown', ...groupSettingsKeyboard(chatId, group) }
    );
  });

  bot.action(/^admins_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const group  = db.getGroup(chatId);
    if (!group) return ctx.answerCbQuery('❌ بيانات غير موجودة!', { show_alert: true });
    let text = `👮 *مشرفو ${group.title}*\n\n`;
    text += `👑 المالك: \`${group.ownerUsername || 'غير محدد'}\`\n\n`;
    if (group.admins.size === 0) {
      text += '_لا يوجد مشرفون مسجلون_';
    } else {
      for (const a of group.admins.values()) {
        text += `👮 @${a.username}\n   ↳ رُقِّيَ بواسطة: @${a.promotedByUsername}\n   ↳ التاريخ: ${a.promotedAt.toLocaleDateString('ar-SA')}\n\n`;
      }
    }
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...backBtn(`group_home_${chatId}`) });
  });

  bot.action(/^rules_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(
      '📋 *قواعد المجموعة*\n\n1️⃣ الاحترام المتبادل\n2️⃣ عدم الإعلانات بلا إذن\n' +
      '3️⃣ عدم التحرش أو الإزعاج\n4️⃣ احترام قرارات الإدارة\n5️⃣ عدم المحتوى الضار\n\n' +
      '_مخالفة القواعد = طرد أو حظر_',
      { parse_mode: 'Markdown' }
    );
  });

  bot.action(/^stats_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const group  = db.getGroup(chatId);
    if (!group) return ctx.answerCbQuery('❌ بيانات غير موجودة!', { show_alert: true });
    const warns = [...group.warns.values()].reduce((a, w) => a + w.length, 0);
    await ctx.reply(
      `📊 *إحصائيات ${group.title}*\n\n👮 المشرفون: \`${group.admins.size}\`\n` +
      `⚠️ التحذيرات: \`${warns}\`\n🔇 المكتومون: \`${group.mutedUsers.size}\`\n` +
      `🚫 المحظورون: \`${group.bannedUsers.size}\``,
      { parse_mode: 'Markdown' }
    );
  });

  bot.action(/^toggle_welcome_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const group  = db.getGroup(chatId);
    if (!group || !await isAdmin(bot, chatId, ctx.from.id)) return;
    group.welcomeEnabled = !group.welcomeEnabled;
    await ctx.answerCbQuery(`${group.welcomeEnabled ? '✅ تم تفعيل' : '❌ تم تعطيل'} رسالة الترحيب!`);
    await ctx.editMessageReplyMarkup(groupSettingsKeyboard(chatId, group).reply_markup);
  });

  bot.action(/^toggle_antispam_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const group  = db.getGroup(chatId);
    if (!group || !await isAdmin(bot, chatId, ctx.from.id)) return;
    group.antiSpam = !group.antiSpam;
    await ctx.answerCbQuery(`${group.antiSpam ? '✅ تم تفعيل' : '❌ تم تعطيل'} مكافحة السبام!`);
    await ctx.editMessageReplyMarkup(groupSettingsKeyboard(chatId, group).reply_markup);
  });

  bot.action(/^toggle_mutenew_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const group  = db.getGroup(chatId);
    if (!group || !await isAdmin(bot, chatId, ctx.from.id)) return;
    group.muteNewMembers = !group.muteNewMembers;
    await ctx.answerCbQuery(`${group.muteNewMembers ? '✅ تم تفعيل' : '❌ تم تعطيل'} كتم الأعضاء الجدد!`);
    await ctx.editMessageReplyMarkup(groupSettingsKeyboard(chatId, group).reply_markup);
  });

  bot.action(/^edit_welcome_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(
      '✏️ *تعديل رسالة الترحيب*\n\nأرسل:\n`/setwelcome نص الرسالة`\n\n' +
      '*المتغيرات:*\n• `{name}` اسم العضو\n• `{group}` اسم المجموعة\n• `{username}` معرف العضو',
      { parse_mode: 'Markdown' }
    );
  });

  bot.action(/^group_home_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const group  = db.getGroup(chatId);
    if (!group) return;
    await ctx.editMessageText(
      `🤖 *إدارة ${group.title}*\n\nاختر من القائمة:`,
      { parse_mode: 'Markdown', ...groupHomeKeyboard(chatId) }
    );
  });

  bot.action(/^cancel_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery('تم الإلغاء ✅');
    await ctx.deleteMessage().catch(() => { });
  });
}

// ════════════════════════════════════════════════════════════
//  أوامر الإدارة
// ════════════════════════════════════════════════════════════

function setupAdminHandlers(bot) {

  // /admins
  bot.command('admins', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    const group  = db.getGroup(chatId);
    let text = `👮 *مشرفو ${ctx.chat.title}*\n\n`;
    try {
      const chatAdmins = await bot.telegram.getChatAdministrators(chatId);
      for (const a of chatAdmins) {
        if (a.user.is_bot) continue;
        const rec  = group && group.admins.get(a.user.id);
        const name = a.user.username ? `@${a.user.username}` : a.user.first_name;
        if (a.status === 'creator') {
          text += `👑 *المالك:* ${name}\n`;
          if (group) { group.ownerId = a.user.id; group.ownerUsername = a.user.username || a.user.first_name; }
        } else {
          text += `👮 *مشرف:* ${name}`;
          if (rec) text += `\n   ↳ رُقِّيَ بواسطة: @${rec.promotedByUsername}`;
          text += '\n';
        }
      }
    } catch {
      text += '_تعذر جلب القائمة_';
    }
    await ctx.replyWithMarkdown(text);
  });

  // /ban
  bot.command('ban', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    if (!await isAdmin(bot, chatId, ctx.from.id)) return ctx.reply('❌ للمشرفين فقط!');
    const target = await getTargetUser(ctx);
    if (!target) return ctx.reply('❌ ارد على رسالة المستخدم أو اذكره!\nمثال: /ban @username سبب');
    const reason = getReason(ctx.message.text, target.username ? 2 : 1);
    try {
      await bot.telegram.banChatMember(chatId, target.id);
      const group = db.getGroup(chatId);
      if (group) group.bannedUsers.add(target.id);
      await ctx.replyWithMarkdown(
        `🚫 *تم الحظر*\n\n👤 ${target.username ? `@${target.username}` : target.firstName}\n` +
        `👮 بواسطة: @${ctx.from.username || ctx.from.first_name}\n📝 السبب: ${reason}`,
        Markup.inlineKeyboard([[Markup.button.callback('✅ رفع الحظر', `unban_${target.id}_${chatId}`)]])
      );
    } catch (e) { await ctx.reply(`❌ تعذر الحظر: ${e.message}`); }
  });

  // /kick
  bot.command('kick', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    if (!await isAdmin(bot, chatId, ctx.from.id)) return ctx.reply('❌ للمشرفين فقط!');
    const target = await getTargetUser(ctx);
    if (!target) return ctx.reply('❌ ارد على رسالة المستخدم أو اذكره!');
    try {
      await bot.telegram.banChatMember(chatId, target.id);
      setTimeout(() => bot.telegram.unbanChatMember(chatId, target.id).catch(() => { }), 1500);
      await ctx.replyWithMarkdown(
        `👢 *تم الطرد*\n\n👤 ${target.username ? `@${target.username}` : target.firstName}\n` +
        `👮 بواسطة: @${ctx.from.username || ctx.from.first_name}`
      );
    } catch (e) { await ctx.reply(`❌ تعذر الطرد: ${e.message}`); }
  });

  // /mute
  bot.command('mute', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    if (!await isAdmin(bot, chatId, ctx.from.id)) return ctx.reply('❌ للمشرفين فقط!');
    const target = await getTargetUser(ctx);
    if (!target) return ctx.reply('❌ ارد على رسالة المستخدم أو اذكره!');
    try {
      await muteMember(bot, chatId, target.id);
      const group = db.getGroup(chatId);
      if (group) group.mutedUsers.add(target.id);
      await ctx.replyWithMarkdown(
        `🔇 *تم الكتم*\n\n👤 ${target.username ? `@${target.username}` : target.firstName}\n` +
        `👮 بواسطة: @${ctx.from.username || ctx.from.first_name}`,
        Markup.inlineKeyboard([[Markup.button.callback('🔊 رفع الكتم', `unmute_${target.id}_${chatId}`)]])
      );
    } catch (e) { await ctx.reply(`❌ تعذر الكتم: ${e.message}`); }
  });

  // /unmute
  bot.command('unmute', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    if (!await isAdmin(bot, chatId, ctx.from.id)) return ctx.reply('❌ للمشرفين فقط!');
    const target = await getTargetUser(ctx);
    if (!target) return ctx.reply('❌ ارد على رسالة المستخدم أو اذكره!');
    try {
      await unmuteMember(bot, chatId, target.id);
      const group = db.getGroup(chatId);
      if (group) group.mutedUsers.delete(target.id);
      await ctx.replyWithMarkdown(
        `🔊 *تم رفع الكتم*\n\n👤 ${target.username ? `@${target.username}` : target.firstName}\n` +
        `👮 بواسطة: @${ctx.from.username || ctx.from.first_name}`
      );
    } catch (e) { await ctx.reply(`❌ تعذر رفع الكتم: ${e.message}`); }
  });

  // /warn
  bot.command('warn', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    if (!await isAdmin(bot, chatId, ctx.from.id)) return ctx.reply('❌ للمشرفين فقط!');
    const target = await getTargetUser(ctx);
    if (!target) return ctx.reply('❌ ارد على رسالة المستخدم أو اذكره!');
    const reason = getReason(ctx.message.text, 2);
    const group  = db.getGroup(chatId);
    if (!group) return;
    if (!group.warns.has(target.id)) group.warns.set(target.id, []);
    const warns = group.warns.get(target.id);
    warns.push({ reason, warnedBy: ctx.from.id, warnedAt: new Date() });
    if (warns.length >= 3) {
      try {
        await bot.telegram.banChatMember(chatId, target.id);
        group.bannedUsers.add(target.id);
        group.warns.delete(target.id);
        await ctx.replyWithMarkdown(
          `🚫 *حظر تلقائي*\n\n👤 ${target.username ? `@${target.username}` : target.firstName}\n` +
          `📝 وصل لـ 3 تحذيرات. آخر سبب: ${reason}`
        );
      } catch { }
    } else {
      await ctx.replyWithMarkdown(
        `⚠️ *تحذير ${warns.length}/3*\n\n👤 ${target.username ? `@${target.username}` : target.firstName}\n📝 ${reason}\n\n` +
        `_3 تحذيرات = حظر تلقائي_`,
        Markup.inlineKeyboard([[Markup.button.callback('🗑️ حذف التحذيرات', `clearwarns_${target.id}_${chatId}`)]])
      );
    }
  });

  // /warns
  bot.command('warns', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const target = await getTargetUser(ctx);
    if (!target) return ctx.reply('❌ ارد على رسالة المستخدم أو اذكره!');
    const group = db.getGroup(ctx.chat.id);
    const warns = group && group.warns.get(target.id) || [];
    if (warns.length === 0) return ctx.replyWithMarkdown(`✅ ${target.username ? `@${target.username}` : target.firstName} لا يملك تحذيرات.`);
    let text = `⚠️ *تحذيرات ${target.username ? `@${target.username}` : target.firstName}*\n\n`;
    warns.forEach((w, i) => { text += `${i + 1}. ${w.reason} — ${w.warnedAt.toLocaleDateString('ar-SA')}\n`; });
    text += `\nالإجمالي: ${warns.length}/3`;
    await ctx.replyWithMarkdown(text, Markup.inlineKeyboard([[Markup.button.callback('🗑️ حذف التحذيرات', `clearwarns_${target.id}_${ctx.chat.id}`)]]));
  });

  // /settings
  bot.command('settings', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    if (!await isAdmin(bot, chatId, ctx.from.id)) return ctx.reply('❌ للمشرفين فقط!');
    const group = db.getGroup(chatId);
    if (!group) return ctx.reply('❌ بيانات المجموعة غير موجودة!');
    await ctx.replyWithMarkdown(
      `⚙️ *إعدادات ${group.title}*\n\nاضغط لتفعيل/تعطيل:`,
      groupSettingsKeyboard(chatId, group)
    );
  });

  // /setwelcome
  bot.command('setwelcome', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    if (!await isAdmin(bot, chatId, ctx.from.id)) return ctx.reply('❌ للمشرفين فقط!');
    const text = ctx.message.text.replace('/setwelcome', '').trim();
    if (!text) return ctx.replyWithMarkdown(
      '📝 *تعديل الترحيب*\n\nاكتب: `/setwelcome نص`\n\n*متغيرات:*\n• `{name}` • `{group}` • `{username}`'
    );
    const group = db.getGroup(chatId);
    if (!group) return;
    group.welcomeMessage = text;
    const preview = text
      .replace('{name}', ctx.from.first_name || 'عضو')
      .replace('{group}', ctx.chat.title || 'المجموعة')
      .replace('{username}', ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name || '');
    await ctx.replyWithMarkdown(`✅ *تم تعديل رسالة الترحيب*\n\n*معاينة:*\n${preview}`);
  });

  // /manage
  bot.command('manage', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    if (!await isAdmin(bot, chatId, ctx.from.id)) return ctx.reply('❌ للمشرفين فقط!');
    const target = await getTargetUser(ctx);
    if (!target) return ctx.reply('❌ ارد على رسالة المستخدم للإدارة!');
    await ctx.replyWithMarkdown(
      `👤 *إدارة المستخدم*\n\nالاسم: ${target.firstName || '—'}\nالمعرف: @${target.username || '—'}\nالآيدي: \`${target.id}\``,
      memberActionsKeyboard(target.id, chatId)
    );
  });

  // ── أزرار الإجراءات الفردية ────────────────────────────────

  bot.action(/^mute_(\d+)_(-?\d+)$/, async (ctx) => {
    const [targetId, chatId] = [Number(ctx.match[1]), Number(ctx.match[2])];
    if (!await isAdmin(bot, chatId, ctx.from.id)) return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    try {
      await muteMember(bot, chatId, targetId);
      const group = db.getGroup(chatId);
      if (group) group.mutedUsers.add(targetId);
      await ctx.answerCbQuery('✅ تم الكتم!', { show_alert: true });
    } catch (e) { await ctx.answerCbQuery(`❌ ${e.message}`, { show_alert: true }); }
  });

  bot.action(/^unmute_(\d+)_(-?\d+)$/, async (ctx) => {
    const [targetId, chatId] = [Number(ctx.match[1]), Number(ctx.match[2])];
    if (!await isAdmin(bot, chatId, ctx.from.id)) return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    try {
      await unmuteMember(bot, chatId, targetId);
      const group = db.getGroup(chatId);
      if (group) group.mutedUsers.delete(targetId);
      await ctx.answerCbQuery('✅ تم رفع الكتم!', { show_alert: true });
    } catch (e) { await ctx.answerCbQuery(`❌ ${e.message}`, { show_alert: true }); }
  });

  bot.action(/^ban_(\d+)_(-?\d+)$/, async (ctx) => {
    const [targetId, chatId] = [Number(ctx.match[1]), Number(ctx.match[2])];
    if (!await isAdmin(bot, chatId, ctx.from.id)) return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    try {
      await bot.telegram.banChatMember(chatId, targetId);
      const group = db.getGroup(chatId);
      if (group) group.bannedUsers.add(targetId);
      await ctx.answerCbQuery('✅ تم الحظر!', { show_alert: true });
      await ctx.deleteMessage().catch(() => { });
    } catch (e) { await ctx.answerCbQuery(`❌ ${e.message}`, { show_alert: true }); }
  });

  bot.action(/^unban_(\d+)_(-?\d+)$/, async (ctx) => {
    const [targetId, chatId] = [Number(ctx.match[1]), Number(ctx.match[2])];
    if (!await isAdmin(bot, chatId, ctx.from.id)) return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    try {
      await bot.telegram.unbanChatMember(chatId, targetId);
      const group = db.getGroup(chatId);
      if (group) group.bannedUsers.delete(targetId);
      await ctx.answerCbQuery('✅ تم رفع الحظر!', { show_alert: true });
    } catch (e) { await ctx.answerCbQuery(`❌ ${e.message}`, { show_alert: true }); }
  });

  bot.action(/^kick_(\d+)_(-?\d+)$/, async (ctx) => {
    const [targetId, chatId] = [Number(ctx.match[1]), Number(ctx.match[2])];
    if (!await isAdmin(bot, chatId, ctx.from.id)) return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    try {
      await bot.telegram.banChatMember(chatId, targetId);
      setTimeout(() => bot.telegram.unbanChatMember(chatId, targetId).catch(() => { }), 1500);
      await ctx.answerCbQuery('✅ تم الطرد!', { show_alert: true });
      await ctx.deleteMessage().catch(() => { });
    } catch (e) { await ctx.answerCbQuery(`❌ ${e.message}`, { show_alert: true }); }
  });

  bot.action(/^warn_(\d+)_(-?\d+)$/, async (ctx) => {
    const [targetId, chatId] = [Number(ctx.match[1]), Number(ctx.match[2])];
    if (!await isAdmin(bot, chatId, ctx.from.id)) return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const group = db.getGroup(chatId);
    if (!group) return;
    if (!group.warns.has(targetId)) group.warns.set(targetId, []);
    const warns = group.warns.get(targetId);
    warns.push({ reason: 'تحذير من لوحة التحكم', warnedBy: ctx.from.id, warnedAt: new Date() });
    if (warns.length >= 3) {
      try {
        await bot.telegram.banChatMember(chatId, targetId);
        group.warns.delete(targetId);
        await ctx.answerCbQuery('🚫 حظر تلقائي! وصل لـ 3 تحذيرات', { show_alert: true });
      } catch { }
    } else {
      await ctx.answerCbQuery(`⚠️ تحذير ${warns.length}/3`, { show_alert: true });
    }
  });

  bot.action(/^info_(\d+)_(-?\d+)$/, async (ctx) => {
    const [targetId, chatId] = [Number(ctx.match[1]), Number(ctx.match[2])];
    const group = db.getGroup(chatId);
    const warns = group && group.warns.get(targetId) ? group.warns.get(targetId).length : 0;
    const muted  = group && group.mutedUsers.has(targetId);
    const banned = group && group.bannedUsers.has(targetId);
    await ctx.answerCbQuery(
      `👤 ${targetId}\n⚠️ تحذيرات: ${warns}/3\n🔇 مكتوم: ${muted ? 'نعم' : 'لا'}\n🚫 محظور: ${banned ? 'نعم' : 'لا'}`,
      { show_alert: true }
    );
  });

  bot.action(/^clearwarns_(\d+)_(-?\d+)$/, async (ctx) => {
    const [targetId, chatId] = [Number(ctx.match[1]), Number(ctx.match[2])];
    if (!await isAdmin(bot, chatId, ctx.from.id)) return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const group = db.getGroup(chatId);
    if (group) group.warns.delete(targetId);
    await ctx.answerCbQuery('✅ تم حذف جميع التحذيرات!', { show_alert: true });
    await ctx.deleteMessage().catch(() => { });
  });
}

module.exports = { setupDeveloper, setupGroupHandlers, setupAdminHandlers };
