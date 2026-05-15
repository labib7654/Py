// ============================================================
//  جميع معالجات البوت — المطور + المجموعات + الإدارة + المالك
// ============================================================

const { Markup } = require('telegraf');
const db = require('./db');
const { isDeveloper, isAdmin, isOwner, getTargetUser, getReason, muteMember, unmuteMember, promoteUser } = require('./helpers');

// ════════════════════════════════════════════════════════════
//  دوال مشتركة للأزرار
// ════════════════════════════════════════════════════════════

const back = (cb) => Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', cb)]]);

function memberActionsKeyboard(targetId, chatId, backCb) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🔇 كتم',     `mute_${targetId}_${chatId}`),
     Markup.button.callback('🔊 رفع كتم', `unmute_${targetId}_${chatId}`)],
    [Markup.button.callback('⚠️ تحذير',   `warn_${targetId}_${chatId}`),
     Markup.button.callback('👢 طرد',     `kick_${targetId}_${chatId}`)],
    [Markup.button.callback('🚫 حظر',     `ban_${targetId}_${chatId}`),
     Markup.button.callback('✅ رفع حظر', `unban_${targetId}_${chatId}`)],
    [Markup.button.callback('📋 معلومات', `info_${targetId}_${chatId}`),
     Markup.button.callback('🔙 رجوع',   backCb || `cancel_${chatId}`)],
  ]);
}

function groupSettingsKeyboard(chatId, s) {
  return Markup.inlineKeyboard([
    [Markup.button.callback(`${s.welcomeEnabled   ? '✅' : '❌'} رسالة الترحيب`,    `toggle_welcome_${chatId}`)],
    [Markup.button.callback(`${s.antiSpam         ? '✅' : '❌'} مكافحة السبام`,     `toggle_antispam_${chatId}`)],
    [Markup.button.callback(`${s.muteNewMembers   ? '✅' : '❌'} كتم الأعضاء الجدد`,`toggle_mutenew_${chatId}`)],
    [Markup.button.callback(`${s.joinRequestsEnabled ? '✅' : '❌'} إدارة طلبات الانضمام`, `toggle_joinreq_${chatId}`)],
    [Markup.button.callback('✏️ تعديل رسالة الترحيب', `edit_welcome_${chatId}`),
     Markup.button.callback('📋 القواعد',              `edit_rules_${chatId}`)],
    [Markup.button.callback('🚫 الكلمات المحظورة', `bwords_list_${chatId}`)],
    [Markup.button.callback('🔙 رجوع', `group_home_${chatId}`)],
  ]);
}

function groupHomeKeyboard(chatId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('⚙️ إعدادات المجموعة', `settings_${chatId}`),
     Markup.button.callback('👥 قائمة المشرفين',   `admins_${chatId}`)],
    [Markup.button.callback('📋 القواعد',           `rules_${chatId}`),
     Markup.button.callback('📊 إحصائيات',          `stats_${chatId}`)],
    [Markup.button.callback('📨 طلبات الانضمام',   `joinreqs_${chatId}`)],
  ]);
}

// ════════════════════════════════════════════════════════════
//  لوحة المطور السرية
// ════════════════════════════════════════════════════════════

function devMainKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📊 الإحصائيات',   'dev_stats'),
     Markup.button.callback('👥 المجموعات',    'dev_groups')],
    [Markup.button.callback('📢 بث رسالة',     'dev_broadcast'),
     Markup.button.callback('🔍 التحقق السري', 'dev_verify')],
    [Markup.button.callback('🚫 حظر عالمي',    'dev_ban_menu'),
     Markup.button.callback('✅ رفع حظر',      'dev_unban_menu')],
    [Markup.button.callback('📋 المحظورون',    'dev_banned_list'),
     Markup.button.callback('🔄 تحديث',        'dev_refresh')],
  ]);
}

function setupDeveloper(bot) {

  bot.command('start', async (ctx) => {
    if (ctx.chat.type !== 'private') return;
    if (isDeveloper(ctx)) {
      const s = db.getStats();
      await ctx.replyWithMarkdown(
        `🤖 *بوت إدارة المجموعات والمجتمعات*\n\n🔐 *لوحة التحكم السرية للمطور*\n\n` +
        `📊 *الإحصائيات الحية:*\n• المجموعات النشطة: \`${s.totalGroups}\`\n` +
        `• إجمالي المستخدمين: \`${s.totalUsers}\`\n• المحظورون عالمياً: \`${s.bannedUsers}\`\n` +
        `• المشرفون المسجلون: \`${s.totalAdmins}\`\n• طلبات الانضمام: \`${s.pendingReqs}\``,
        devMainKeyboard()
      );
    } else {
      const u = ctx.from;
      db.getOrCreateUser(u.id, u.username || '', u.first_name || '');
      await ctx.replyWithMarkdown(
        `👋 *مرحباً ${u.first_name}!*\n\nأنا بوت إدارة المجموعات والمجتمعات.\n\n` +
        `📌 *أضفني لمجموعتك وامنحني صلاحيات المشرف!*\n\n` +
        `⚙️ *الميزات:*\n• إدارة شاملة للأعضاء والمشرفين\n• نظام تحذيرات تلقائي\n` +
        `• رسائل ترحيب مخصصة\n• كلمات محظورة مع إجراءات تلقائية\n` +
        `• إدارة طلبات الانضمام\n• نظام تحقق للمشرفين`,
        Markup.inlineKeyboard([
          [Markup.button.url('➕ أضفني لمجموعتك', `https://t.me/${ctx.botInfo.username}?startgroup=true`)],
          [Markup.button.callback('ℹ️ مساعدة وأوامر', 'help_menu')],
        ])
      );
    }
  });

  bot.command('dev', async (ctx) => {
    if (!isDeveloper(ctx)) return;
    const s = db.getStats();
    await ctx.replyWithMarkdown(
      `🔐 *لوحة تحكم المطور*\n\n📊 *إحصائيات سريعة:*\n• المجموعات: \`${s.totalGroups}\`\n` +
      `• المستخدمون: \`${s.totalUsers}\`\n• المحظورون: \`${s.bannedUsers}\`\n` +
      `• المشرفون: \`${s.totalAdmins}\`\n• طلبات الانضمام: \`${s.pendingReqs}\``,
      devMainKeyboard()
    );
  });

  // ── إحصائيات ──────────────────────────────────────────────
  bot.action('dev_stats', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const s = db.getStats();
    const groups = db.allGroups();
    const totalWords = groups.reduce((a, g) => a + g.bannedWords.length, 0);
    await ctx.editMessageText(
      `📊 *إحصائيات مفصّلة*\n\n` +
      `👥 المجموعات النشطة: \`${s.totalGroups}\`\n` +
      `👤 إجمالي المستخدمين: \`${s.totalUsers}\`\n` +
      `🚫 محظورون عالمياً: \`${s.bannedUsers}\`\n` +
      `👮 مشرفون مسجلون: \`${s.totalAdmins}\`\n` +
      `⚠️ إجمالي التحذيرات: \`${s.totalWarns}\`\n` +
      `🔤 الكلمات المحظورة: \`${totalWords}\`\n` +
      `📨 طلبات انضمام معلقة: \`${s.pendingReqs}\`\n` +
      `📅 التاريخ: \`${new Date().toLocaleDateString('ar-SA')}\``,
      { parse_mode: 'Markdown', ...back('dev_back') }
    );
  });

  // ── قائمة المجموعات ────────────────────────────────────────
  bot.action('dev_groups', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const groups = db.allGroups();
    if (groups.length === 0)
      return ctx.editMessageText('👥 *قائمة المجموعات*\n\nلا توجد مجموعات حتى الآن.',
        { parse_mode: 'Markdown', ...back('dev_back') });
    const btns = groups.slice(0, 10).map(g =>
      [Markup.button.callback(`👥 ${g.title.slice(0, 24)}`, `dev_grp_${g.chatId}`)]
    );
    btns.push([Markup.button.callback('🔙 رجوع', 'dev_back')]);
    await ctx.editMessageText(
      `👥 *قائمة المجموعات* (${groups.length})`,
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) }
    );
  });

  // ── تفاصيل مجموعة مع صلاحيات المطور الكاملة ──────────────
  bot.action(/^dev_grp_(-?\d+)$/, async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId);
    if (!g) return ctx.answerCbQuery('❌ غير موجودة!', { show_alert: true });
    const warns    = [...g.warns.values()].reduce((a, w) => a + w.length, 0);
    const pending  = [...g.joinRequests.values()].filter(r => r.status === 'pending').length;
    const memberCount = g.members.size;
    await ctx.editMessageText(
      `📋 *${g.title}*\n\n` +
      `🆔 المعرف: \`${g.chatId}\`\n` +
      `👑 المالك: \`${g.ownerUsername || 'غير محدد'}\`\n` +
      `➕ أضافه: \`${g.addedByUsername}\`\n` +
      `📅 تاريخ الإضافة: \`${g.addedAt.toLocaleDateString('ar-SA')}\`\n` +
      `👮 المشرفون المسجلون: \`${g.admins.size}\`\n` +
      `👥 الأعضاء المتتبعون: \`${memberCount}\`\n` +
      `⚠️ التحذيرات: \`${warns}\`\n` +
      `🔤 الكلمات المحظورة: \`${g.bannedWords.length}\`\n` +
      `📨 طلبات معلقة: \`${pending}\`\n` +
      `🛡️ مكافحة السبام: ${g.antiSpam ? '✅' : '❌'}\n` +
      `👋 الترحيب: ${g.welcomeEnabled ? '✅' : '❌'}`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('👥 قائمة الأعضاء الكاملة', `dev_members_${chatId}`)],
          [Markup.button.callback('🔍 نظام التحقق',           `dev_grp_verify_${chatId}`),
           Markup.button.callback('📢 بث للمجموعة',          `dev_grp_bcast_${chatId}`)],
          [Markup.button.callback('⚙️ ضبط إعدادات البوت',    `settings_${chatId}`),
           Markup.button.callback('📨 طلبات الانضمام',       `dev_joinreqs_${chatId}`)],
          [Markup.button.callback('🔙 رجوع', 'dev_groups')],
        ])
      }
    );
  });

  // ── قائمة الأعضاء الكاملة مع الفرز (المطور) ───────────────
  bot.action(/^dev_members_(-?\d+)$/, async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId);
    if (!g) return ctx.answerCbQuery('❌ غير موجودة!', { show_alert: true });

    // جلب المشرفين من تيليغرام مباشرة
    let adminIds = new Set();
    let ownerLine = '';
    let adminLines = [];
    try {
      const chatAdmins = await bot.telegram.getChatAdministrators(chatId);
      for (const a of chatAdmins) {
        if (a.user.is_bot) continue;
        adminIds.add(a.user.id);
        const name = a.user.username ? `@${a.user.username}` : a.user.first_name;
        if (a.status === 'creator') {
          ownerLine = `👑 المالك: ${name} \`[${a.user.id}]\``;
          g.ownerId = a.user.id;
          g.ownerUsername = a.user.username || a.user.first_name;
          db.trackMember(chatId, a.user.id, a.user.username || '', a.user.first_name || '', 'owner');
        } else {
          const rec = g.admins.get(a.user.id);
          const promoted = rec ? ` ← @${rec.promotedByUsername}` : '';
          adminLines.push(`👮 ${name}\`[${a.user.id}]\`${promoted}`);
          db.trackMember(chatId, a.user.id, a.user.username || '', a.user.first_name || '', 'admin');
        }
      }
    } catch { }

    // الأعضاء العاديون من قاعدة البيانات
    const members = [...g.members.values()].filter(m => !adminIds.has(m.userId) && m.userId !== g.ownerId);

    let text = `👥 *أعضاء ${g.title}*\n\n`;
    if (ownerLine) text += `${ownerLine}\n\n`;
    if (adminLines.length) text += `*المشرفون (${adminLines.length}):*\n${adminLines.join('\n')}\n\n`;

    const memberBtns = [];
    if (members.length > 0) {
      text += `*الأعضاء المتتبعون (${members.length}):*\n`;
      members.slice(0, 8).forEach(m => {
        const name = m.username ? `@${m.username}` : m.firstName;
        text += `👤 ${name} \`[${m.userId}]\`\n`;
        memberBtns.push([Markup.button.callback(`👤 ${name.slice(0, 20)}`, `dev_mact_${m.userId}_${chatId}`)]);
      });
    } else {
      text += `_لا يوجد أعضاء عاديون متتبعون حتى الآن_`;
    }

    // أزرار المشرفين للتحكم
    const adminBtns = [...adminIds].filter(id => id !== g.ownerId).slice(0, 4).map(id => {
      const m = g.members.get(id);
      const name = m ? (m.username || m.firstName) : String(id);
      return [Markup.button.callback(`👮 ${name.slice(0, 20)}`, `dev_mact_${id}_${chatId}`)];
    });

    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        ...adminBtns,
        ...memberBtns,
        [Markup.button.callback('🔙 رجوع', `dev_grp_${chatId}`)],
      ])
    });
  });

  // ── إجراءات على عضو (المطور) ──────────────────────────────
  bot.action(/^dev_mact_(\d+)_(-?\d+)$/, async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const targetId = Number(ctx.match[1]);
    const chatId   = Number(ctx.match[2]);
    const g        = db.getGroup(chatId);
    const m        = g && g.members.get(targetId);
    const name     = m ? (m.username ? `@${m.username}` : m.firstName) : String(targetId);
    const warns    = g && g.warns.get(targetId) ? g.warns.get(targetId).length : 0;
    const role     = m ? { owner: '👑 مالك', admin: '👮 مشرف', member: '👤 عضو' }[m.role] || '👤' : '👤';

    await ctx.editMessageText(
      `${role} *${name}*\n\n` +
      `🆔 الآيدي: \`${targetId}\`\n` +
      `📛 الرتبة: ${role}\n` +
      `⚠️ التحذيرات: \`${warns}/3\`\n` +
      `🔇 مكتوم: ${g && g.mutedUsers.has(targetId) ? 'نعم ✅' : 'لا ❌'}\n` +
      `🚫 محظور: ${g && g.bannedUsers.has(targetId) ? 'نعم ✅' : 'لا ❌'}`,
      {
        parse_mode: 'Markdown',
        ...memberActionsKeyboard(targetId, chatId, `dev_members_${chatId}`)
      }
    );
  });

  // ── التحقق السري الشامل ────────────────────────────────────
  bot.action('dev_verify', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const groups = db.allGroups();
    if (groups.length === 0)
      return ctx.editMessageText('🔍 *نظام التحقق السري*\n\nلا توجد بيانات.',
        { parse_mode: 'Markdown', ...back('dev_back') });
    let text = '🔍 *نظام التحقق السري*\n\n';
    for (const g of groups.slice(0, 5)) {
      text += `📌 *${g.title}*\n👑 المالك: \`${g.ownerUsername || 'غير محدد'}\`\n`;
      if (g.admins.size > 0) {
        for (const a of g.admins.values()) {
          text += `  👮 @${a.username}\n     ↳ رقّاه: @${a.promotedByUsername} | ${a.promotedAt.toLocaleDateString('ar-SA')}\n`;
        }
      } else text += `  _لا يوجد مشرفون مسجلون_\n`;
      text += '\n';
    }
    if (groups.length > 5) text += `_...و${groups.length - 5} مجموعة أخرى_`;
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...back('dev_back') });
  });

  // ── تحقق مجموعة محددة (المطور) ────────────────────────────
  bot.action(/^dev_grp_verify_(-?\d+)$/, async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId);
    if (!g) return ctx.answerCbQuery('❌ غير موجودة!', { show_alert: true });
    let text = `🔍 *تحقق: ${g.title}*\n\n`;
    text += `👑 المالك: \`${g.ownerUsername || 'غير محدد'}\` \`[${g.ownerId || '—'}]\`\n`;
    text += `➕ من أضاف البوت: \`${g.addedByUsername}\` \`[${g.addedBy}]\`\n\n`;
    if (g.admins.size > 0) {
      text += `*سجل المشرفين:*\n`;
      for (const a of g.admins.values()) {
        text += `👮 @${a.username}\n   رقّاه: @${a.promotedByUsername}\n   التاريخ: ${a.promotedAt.toLocaleDateString('ar-SA')}\n\n`;
      }
    } else text += `_لا يوجد مشرفون مسجلون_`;
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...back(`dev_grp_${chatId}`) });
  });

  // ── بث لمجموعة محددة ─────────────────────────────────────
  bot.action(/^dev_grp_bcast_(-?\d+)$/, async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    await ctx.reply(
      `📢 *بث لهذه المجموعة*\n\nأرسل الأمر:\n\`/bcastone ${chatId} نص الرسالة\``,
      { parse_mode: 'Markdown' }
    );
  });

  // ── طلبات الانضمام (المطور) ──────────────────────────────
  bot.action(/^dev_joinreqs_(-?\d+)$/, async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId);
    if (!g) return ctx.answerCbQuery('❌ غير موجودة!', { show_alert: true });
    const pending = [...g.joinRequests.values()].filter(r => r.status === 'pending');
    if (pending.length === 0)
      return ctx.editMessageText('📨 *طلبات الانضمام*\n\nلا توجد طلبات معلقة.',
        { parse_mode: 'Markdown', ...back(`dev_grp_${chatId}`) });
    const btns = pending.slice(0, 8).map(r => [
      Markup.button.callback(`✅ ${r.firstName.slice(0, 12)}`, `jr_approve_${r.userId}_${chatId}`),
      Markup.button.callback(`❌ رفض`,                          `jr_reject_${r.userId}_${chatId}`),
    ]);
    btns.push([Markup.button.callback('✅ قبول الكل', `jr_approveall_${chatId}`),
               Markup.button.callback('❌ رفض الكل',  `jr_rejectall_${chatId}`)]);
    btns.push([Markup.button.callback('🔙 رجوع', `dev_grp_${chatId}`)]);
    await ctx.editMessageText(
      `📨 *طلبات الانضمام* (${pending.length} معلقة)`,
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) }
    );
  });

  bot.action('dev_broadcast', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      '📢 *بث رسالة جماعية*\n\nاستخدم الأمر:\n`/broadcast نص الرسالة`',
      { parse_mode: 'Markdown', ...back('dev_back') }
    );
  });

  bot.action('dev_ban_menu', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    await ctx.editMessageText('🚫 *حظر عالمي*\n\nاستخدم: `/gban <id> <السبب>`',
      { parse_mode: 'Markdown', ...back('dev_back') });
  });

  bot.action('dev_unban_menu', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    await ctx.editMessageText('✅ *رفع الحظر العالمي*\n\nاستخدم: `/ungban <id>`',
      { parse_mode: 'Markdown', ...back('dev_back') });
  });

  bot.action('dev_banned_list', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const banned = db.allUsers().filter(u => u.globalBanned);
    if (banned.length === 0)
      return ctx.editMessageText('📋 *المحظورون عالمياً*\n\nلا يوجد مستخدمون محظورون.',
        { parse_mode: 'Markdown', ...back('dev_back') });
    let text = `📋 *المحظورون عالمياً* (${banned.length})\n\n`;
    banned.slice(0, 10).forEach(u => { text += `• \`${u.userId}\` — ${u.bannedReason}\n`; });
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...back('dev_back') });
  });

  bot.action('dev_refresh', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery('🔄 تم التحديث!');
    const s = db.getStats();
    await ctx.editMessageText(
      `🔐 *لوحة تحكم المطور*\n\n📊 المجموعات: \`${s.totalGroups}\`\n👤 المستخدمون: \`${s.totalUsers}\`\n🚫 المحظورون: \`${s.bannedUsers}\``,
      { parse_mode: 'Markdown', ...devMainKeyboard() }
    );
  });

  bot.action('dev_back', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const s = db.getStats();
    await ctx.editMessageText(
      `🔐 *لوحة تحكم المطور*\n\n📊 المجموعات: \`${s.totalGroups}\`\n👤 المستخدمون: \`${s.totalUsers}\`\n🚫 المحظورون: \`${s.bannedUsers}\``,
      { parse_mode: 'Markdown', ...devMainKeyboard() }
    );
  });

  // ── أوامر المطور ──────────────────────────────────────────

  bot.command('broadcast', async (ctx) => {
    if (!isDeveloper(ctx)) return;
    const text = ctx.message.text.replace('/broadcast', '').trim();
    if (!text) return ctx.reply('❌ مثال: /broadcast مرحباً بالجميع');
    const groups = db.allGroups();
    await ctx.reply(`📢 جاري الإرسال لـ ${groups.length} مجموعة...`);
    let sent = 0, failed = 0;
    for (const g of groups) {
      try {
        await bot.telegram.sendMessage(g.chatId, `📢 *رسالة إدارة البوت*\n\n${text}`, { parse_mode: 'Markdown' });
        sent++;
      } catch { failed++; }
    }
    await ctx.replyWithMarkdown(`✅ *اكتمل البث*\n\n• أُرسل: \`${sent}\`\n• فشل: \`${failed}\``);
  });

  bot.command('bcastone', async (ctx) => {
    if (!isDeveloper(ctx)) return;
    const parts = ctx.message.text.split(' ');
    const chatId = Number(parts[1]);
    const text   = parts.slice(2).join(' ');
    if (!chatId || !text) return ctx.reply('❌ مثال: /bcastone -1001234567 نص الرسالة');
    try {
      await bot.telegram.sendMessage(chatId, `📢 *رسالة من المطور*\n\n${text}`, { parse_mode: 'Markdown' });
      await ctx.reply('✅ تم الإرسال!');
    } catch (e) { await ctx.reply(`❌ ${e.message}`); }
  });

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
    await ctx.replyWithMarkdown(`🚫 *تم الحظر العالمي*\n👤 المعرف: \`${targetId}\`\n📝 السبب: ${reason}`);
    for (const g of db.allGroups()) { try { await bot.telegram.banChatMember(g.chatId, targetId); } catch { } }
  });

  bot.command('ungban', async (ctx) => {
    if (!isDeveloper(ctx)) return;
    const targetId = Number(ctx.message.text.split(' ')[1]);
    if (!targetId || isNaN(targetId)) return ctx.reply('❌ مثال: /ungban 123456789');
    const user = db.getUser(targetId);
    if (!user) return ctx.reply('❌ المستخدم غير موجود!');
    user.globalBanned = false; user.bannedReason = ''; user.bannedAt = null;
    await ctx.replyWithMarkdown(`✅ *تم رفع الحظر العالمي عن:* \`${targetId}\``);
  });

  // ── مساعدة ────────────────────────────────────────────────
  bot.action('help_menu', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      '📖 *دليل الاستخدام الكامل*\n\n' +
      '🔧 *أوامر الإدارة:*\n• `/admins` — قائمة المشرفين مع التحقق\n' +
      '• `/ban` — حظر عضو\n• `/kick` — طرد عضو\n• `/mute` — كتم\n• `/unmute` — رفع كتم\n' +
      '• `/warn` — تحذير (3 = حظر تلقائي)\n• `/warns` — تحذيرات عضو\n• `/manage` — لوحة تحكم عضو\n\n' +
      '👑 *أوامر المالك:*\n• `/settings` — إعدادات المجموعة\n• `/setwelcome` — تعديل الترحيب\n' +
      '• `/setrules` — تعيين القواعد\n• `/addword` — إضافة كلمة محظورة\n' +
      '• `/removeword` — إزالة كلمة محظورة\n• `/words` — قائمة الكلمات المحظورة',
      { parse_mode: 'Markdown', ...back('help_back') }
    );
  });

  bot.action('help_back', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      `👋 *مرحباً!*\n\nأضفني لمجموعتك وامنحني صلاحيات المشرف!`,
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

function setupGroupHandlers(bot) {

  // إضافة/إزالة البوت
  bot.on('my_chat_member', async (ctx) => {
    const upd = ctx.myChatMember;
    const { chat, from } = upd;
    const newStat = upd.new_chat_member.status;
    const oldStat = upd.old_chat_member.status;
    if (chat.type === 'private') return;

    if ((newStat === 'member' || newStat === 'administrator') && (oldStat === 'left' || oldStat === 'kicked')) {
      const group = db.getOrCreateGroup(chat.id, chat.title || 'مجموعة', chat.type,
        from.id, from.username || from.first_name || String(from.id));
      const user = db.getOrCreateUser(from.id, from.username || '', from.first_name || '');
      user.groups.add(chat.id);
      db.trackMember(chat.id, from.id, from.username || '', from.first_name || '', 'member');

      let promoted = false;
      try {
        const me = await bot.telegram.getChatMember(chat.id, ctx.botInfo.id);
        if (me.status === 'administrator' || newStat === 'administrator') {
          promoted = await promoteUser(bot, chat.id, from.id);
        }
      } catch { }

      if (promoted) {
        group.admins.set(from.id, {
          username: from.username || from.first_name || String(from.id),
          promotedBy: ctx.botInfo.id,
          promotedByUsername: ctx.botInfo.username || 'Bot',
          promotedAt: new Date(),
        });
        db.trackMember(chat.id, from.id, from.username || '', from.first_name || '', 'admin');
      }

      await ctx.replyWithMarkdown(
        `🤖 *شكراً لإضافتي إلى ${chat.title}!*\n\n` +
        (promoted ? `✅ تم ترقية @${from.username || from.first_name} مشرفاً تلقائياً!\n\n` : '') +
        `🛡️ أنا جاهز لإدارة مجموعتك بكفاءة عالية.\n` +
        `📌 الميزات: كلمات محظورة | نظام تحذيرات | إدارة طلبات الانضمام | تحقق المشرفين\n\n` +
        `_استخدم /settings للإعدادات_`,
        groupHomeKeyboard(chat.id)
      );
    } else if (newStat === 'left' || newStat === 'kicked') {
      db.deleteGroup(chat.id);
    }
  });

  // تتبع حالات الأعضاء والمشرفين
  bot.on('chat_member', async (ctx) => {
    const upd = ctx.chatMember;
    const { chat, from: by } = upd;
    const newM = upd.new_chat_member;
    const oldM = upd.old_chat_member;
    const u = newM.user;
    if (u.is_bot) return;

    if (newM.status === 'creator') {
      const g = db.getGroup(chat.id);
      if (g) { g.ownerId = u.id; g.ownerUsername = u.username || u.first_name || String(u.id); }
      db.trackMember(chat.id, u.id, u.username || '', u.first_name || '', 'owner');
    }

    if (newM.status === 'administrator' && oldM.status !== 'administrator') {
      const g = db.getGroup(chat.id);
      if (g) {
        g.admins.set(u.id, {
          username: u.username || u.first_name || String(u.id),
          promotedBy: by.id,
          promotedByUsername: by.username || by.first_name || String(by.id),
          promotedAt: new Date(),
        });
      }
      db.trackMember(chat.id, u.id, u.username || '', u.first_name || '', 'admin');
    }

    if (newM.status === 'member' && (oldM.status === 'left' || oldM.status === 'kicked')) {
      const g = db.getGroup(chat.id);
      db.getOrCreateUser(u.id, u.username || '', u.first_name || '').groups.add(chat.id);
      db.trackMember(chat.id, u.id, u.username || '', u.first_name || '', 'member');

      if (!g || !g.welcomeEnabled) return;

      const globalUser = db.getUser(u.id);
      if (globalUser && globalUser.globalBanned) {
        try { await bot.telegram.banChatMember(chat.id, u.id); } catch { }
        return;
      }
      if (g.muteNewMembers) { try { await muteMember(bot, chat.id, u.id); } catch { } }

      const msg = g.welcomeMessage
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

  // ── طلبات الانضمام ─────────────────────────────────────────
  bot.on('chat_join_request', async (ctx) => {
    const req    = ctx.chatJoinRequest;
    const chat   = req.chat;
    const u      = req.from;
    const g      = db.getGroup(chat.id);
    if (!g) return;

    // تسجيل الطلب
    g.joinRequests.set(u.id, {
      userId: u.id,
      username: u.username || '',
      firstName: u.first_name || String(u.id),
      requestedAt: new Date(),
      status: 'pending',
    });

    const nameDisplay = u.username ? `@${u.username}` : u.first_name;
    const notifyText =
      `📨 *طلب انضمام جديد*\n\n` +
      `👤 الاسم: ${nameDisplay}\n` +
      `🆔 الآيدي: \`${u.id}\`\n` +
      `📌 المجموعة: *${chat.title}*`;

    const actionBtns = Markup.inlineKeyboard([
      [Markup.button.callback('✅ قبول',  `jr_approve_${u.id}_${chat.id}`),
       Markup.button.callback('❌ رفض',   `jr_reject_${u.id}_${chat.id}`)],
    ]);

    // إشعار المالك في الخاص
    if (g.ownerId && g.joinRequestsEnabled) {
      try {
        await bot.telegram.sendMessage(g.ownerId, notifyText, { parse_mode: 'Markdown', ...actionBtns });
      } catch { }
    }

    // إشعار المطور دائماً
    const { DEVELOPER_ID } = require('./config');
    try {
      await bot.telegram.sendMessage(DEVELOPER_ID, notifyText, { parse_mode: 'Markdown', ...actionBtns });
    } catch { }
  });

  // ── قبول/رفض طلبات الانضمام ───────────────────────────────
  bot.action(/^jr_approve_(\d+)_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const userId = Number(ctx.match[1]);
    const chatId = Number(ctx.match[2]);
    const g = db.getGroup(chatId);
    const canAct = isDeveloper(ctx) || (g && ctx.from.id === g.ownerId) || await isAdmin(bot, chatId, ctx.from.id);
    if (!canAct) return ctx.answerCbQuery('❌ ليس لديك صلاحية!', { show_alert: true });
    try {
      await bot.telegram.approveChatJoinRequest(chatId, userId);
      if (g && g.joinRequests.has(userId)) g.joinRequests.get(userId).status = 'approved';
      await ctx.answerCbQuery('✅ تم القبول!', { show_alert: true });
      await ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n✅ *تم القبول*', { parse_mode: 'Markdown' });
    } catch (e) { await ctx.answerCbQuery(`❌ ${e.message}`, { show_alert: true }); }
  });

  bot.action(/^jr_reject_(\d+)_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const userId = Number(ctx.match[1]);
    const chatId = Number(ctx.match[2]);
    const g = db.getGroup(chatId);
    const canAct = isDeveloper(ctx) || (g && ctx.from.id === g.ownerId) || await isAdmin(bot, chatId, ctx.from.id);
    if (!canAct) return ctx.answerCbQuery('❌ ليس لديك صلاحية!', { show_alert: true });
    try {
      await bot.telegram.declineChatJoinRequest(chatId, userId);
      if (g && g.joinRequests.has(userId)) g.joinRequests.get(userId).status = 'rejected';
      await ctx.answerCbQuery('❌ تم الرفض!', { show_alert: true });
      await ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n❌ *تم الرفض*', { parse_mode: 'Markdown' });
    } catch (e) { await ctx.answerCbQuery(`❌ ${e.message}`, { show_alert: true }); }
  });

  bot.action(/^jr_approveall_(-?\d+)$/, async (ctx) => {
    if (!isDeveloper(ctx) && !await isAdmin(bot, Number(ctx.match[1]), ctx.from.id))
      return ctx.answerCbQuery('❌ ليس لديك صلاحية!', { show_alert: true });
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId);
    if (!g) return;
    const pending = [...g.joinRequests.values()].filter(r => r.status === 'pending');
    let done = 0;
    for (const r of pending) {
      try { await bot.telegram.approveChatJoinRequest(chatId, r.userId); r.status = 'approved'; done++; } catch { }
    }
    await ctx.answerCbQuery(`✅ تم قبول ${done} طلب!`, { show_alert: true });
    await ctx.deleteMessage().catch(() => { });
  });

  bot.action(/^jr_rejectall_(-?\d+)$/, async (ctx) => {
    if (!isDeveloper(ctx) && !await isAdmin(bot, Number(ctx.match[1]), ctx.from.id))
      return ctx.answerCbQuery('❌ ليس لديك صلاحية!', { show_alert: true });
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId);
    if (!g) return;
    const pending = [...g.joinRequests.values()].filter(r => r.status === 'pending');
    let done = 0;
    for (const r of pending) {
      try { await bot.telegram.declineChatJoinRequest(chatId, r.userId); r.status = 'rejected'; done++; } catch { }
    }
    await ctx.answerCbQuery(`❌ تم رفض ${done} طلب!`, { show_alert: true });
    await ctx.deleteMessage().catch(() => { });
  });

  // ── فلتر الكلمات المحظورة ──────────────────────────────────
  bot.on('message', async (ctx, next) => {
    if (!ctx.chat || ctx.chat.type === 'private') return next();
    const text = ctx.message.text || ctx.message.caption || '';
    if (!text) return next();
    const g = db.getGroup(ctx.chat.id);
    if (!g || !g.bannedWords.length) return next();
    if (await isAdmin(bot, ctx.chat.id, ctx.from.id)) return next();

    const lower = text.toLowerCase();
    const found = g.bannedWords.find(bw => lower.includes(bw.word.toLowerCase()));
    if (!found) return next();

    try { await ctx.deleteMessage(); } catch { }

    const userId   = ctx.from.id;
    const userName = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;
    const action   = found.action;

    if (action === 'warn') {
      if (!g.warns.has(userId)) g.warns.set(userId, []);
      const warns = g.warns.get(userId);
      warns.push({ reason: `كلمة محظورة: ${found.word}`, warnedBy: ctx.botInfo.id, warnedAt: new Date() });
      if (warns.length >= g.maxWarns) {
        try { await bot.telegram.banChatMember(ctx.chat.id, userId); g.bannedUsers.add(userId); g.warns.delete(userId); } catch { }
        await ctx.reply(`🚫 ${userName} تم حظره بعد ${g.maxWarns} تحذيرات (كلمة محظورة: "${found.word}")`);
      } else {
        await ctx.reply(`⚠️ ${userName} تحذير ${warns.length}/${g.maxWarns} — كلمة محظورة: "${found.word}"`);
      }
    } else if (action === 'mute') {
      try { await muteMember(bot, ctx.chat.id, userId); g.mutedUsers.add(userId); } catch { }
      await ctx.reply(`🔇 ${userName} تم كتمه — كلمة محظورة: "${found.word}"`);
    } else if (action === 'kick') {
      try { await bot.telegram.banChatMember(ctx.chat.id, userId); setTimeout(() => bot.telegram.unbanChatMember(ctx.chat.id, userId).catch(() => { }), 2000); } catch { }
      await ctx.reply(`👢 ${userName} تم طرده — كلمة محظورة: "${found.word}"`);
    } else if (action === 'ban') {
      try { await bot.telegram.banChatMember(ctx.chat.id, userId); g.bannedUsers.add(userId); } catch { }
      await ctx.reply(`🚫 ${userName} تم حظره — كلمة محظورة: "${found.word}"`);
    }
  });

  // ── أزرار المجموعة ─────────────────────────────────────────
  bot.action(/^settings_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId);
    if (!g) return ctx.answerCbQuery('❌ بيانات غير موجودة!', { show_alert: true });
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    await ctx.editMessageText(`⚙️ *إعدادات ${g.title}*\n\nاضغط لتفعيل/تعطيل:`,
      { parse_mode: 'Markdown', ...groupSettingsKeyboard(chatId, g) });
  });

  bot.action(/^admins_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId);
    if (!g) return ctx.answerCbQuery('❌ بيانات غير موجودة!', { show_alert: true });
    let text = `👮 *مشرفو ${g.title}*\n\n👑 المالك: \`${g.ownerUsername || 'غير محدد'}\`\n\n`;
    try {
      const chatAdmins = await bot.telegram.getChatAdministrators(chatId);
      for (const a of chatAdmins) {
        if (a.user.is_bot || a.status === 'creator') continue;
        const rec  = g.admins.get(a.user.id);
        const name = a.user.username ? `@${a.user.username}` : a.user.first_name;
        text += `👮 ${name}\n`;
        if (rec) text += `   ↳ رُقِّيَ بواسطة: @${rec.promotedByUsername}\n   ↳ ${rec.promotedAt.toLocaleDateString('ar-SA')}\n`;
        text += '\n';
      }
    } catch { text += '_تعذر جلب القائمة_'; }
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...back(`group_home_${chatId}`) });
  });

  bot.action(/^rules_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId);
    const rulesText = g && g.rules ? g.rules
      : '1️⃣ الاحترام المتبادل\n2️⃣ عدم الإعلانات بلا إذن\n3️⃣ عدم التحرش\n4️⃣ احترام قرارات الإدارة\n5️⃣ عدم المحتوى الضار';
    await ctx.reply(`📋 *قواعد المجموعة*\n\n${rulesText}\n\n_مخالفة القواعد = طرد أو حظر_`, { parse_mode: 'Markdown' });
  });

  bot.action(/^stats_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId);
    if (!g) return ctx.answerCbQuery('❌ بيانات غير موجودة!', { show_alert: true });
    const warns   = [...g.warns.values()].reduce((a, w) => a + w.length, 0);
    const pending = [...g.joinRequests.values()].filter(r => r.status === 'pending').length;
    await ctx.reply(
      `📊 *إحصائيات ${g.title}*\n\n👥 الأعضاء المتتبعون: \`${g.members.size}\`\n` +
      `👮 المشرفون: \`${g.admins.size}\`\n⚠️ التحذيرات: \`${warns}\`\n` +
      `🔇 المكتومون: \`${g.mutedUsers.size}\`\n🚫 المحظورون: \`${g.bannedUsers.size}\`\n` +
      `🔤 الكلمات المحظورة: \`${g.bannedWords.length}\`\n📨 طلبات معلقة: \`${pending}\``,
      { parse_mode: 'Markdown' }
    );
  });

  bot.action(/^joinreqs_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId);
    if (!g) return ctx.answerCbQuery('❌ بيانات غير موجودة!', { show_alert: true });
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const pending = [...g.joinRequests.values()].filter(r => r.status === 'pending');
    if (pending.length === 0)
      return ctx.editMessageText('📨 *طلبات الانضمام*\n\nلا توجد طلبات معلقة.',
        { parse_mode: 'Markdown', ...back(`group_home_${chatId}`) });
    const btns = pending.slice(0, 8).map(r => [
      Markup.button.callback(`✅ ${r.firstName.slice(0, 14)}`, `jr_approve_${r.userId}_${chatId}`),
      Markup.button.callback('❌ رفض', `jr_reject_${r.userId}_${chatId}`),
    ]);
    btns.push([Markup.button.callback('✅ قبول الكل', `jr_approveall_${chatId}`),
               Markup.button.callback('❌ رفض الكل',  `jr_rejectall_${chatId}`)]);
    btns.push([Markup.button.callback('🔙 رجوع', `group_home_${chatId}`)]);
    await ctx.editMessageText(
      `📨 *طلبات الانضمام* (${pending.length} معلقة)`,
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) }
    );
  });

  bot.action(/^bwords_list_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId);
    if (!g) return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    if (g.bannedWords.length === 0) {
      return ctx.editMessageText(
        '🔤 *الكلمات المحظورة*\n\nلا توجد كلمات محظورة.\n\n`/addword <كلمة> <إجراء>`\nالإجراءات: warn | mute | kick | ban',
        { parse_mode: 'Markdown', ...back(`settings_${chatId}`) }
      );
    }
    let text = `🔤 *الكلمات المحظورة* (${g.bannedWords.length})\n\n`;
    const actionAr = { warn: '⚠️ تحذير', mute: '🔇 كتم', kick: '👢 طرد', ban: '🚫 حظر' };
    g.bannedWords.forEach((bw, i) => {
      text += `${i + 1}. \`${bw.word}\` → ${actionAr[bw.action] || bw.action}\n`;
    });
    text += `\n_لإزالة كلمة: /removeword <الكلمة>_`;
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...back(`settings_${chatId}`) });
  });

  // الأزرار التبديلية للإعدادات
  const toggles = [
    ['toggle_welcome',  'welcomeEnabled',       'رسالة الترحيب'],
    ['toggle_antispam', 'antiSpam',             'مكافحة السبام'],
    ['toggle_mutenew',  'muteNewMembers',       'كتم الأعضاء الجدد'],
    ['toggle_joinreq',  'joinRequestsEnabled',  'إدارة طلبات الانضمام'],
  ];

  for (const [prefix, field, label] of toggles) {
    bot.action(new RegExp(`^${prefix}_(-?\\d+)$`), async (ctx) => {
      await ctx.answerCbQuery();
      const chatId = Number(ctx.match[1]);
      const g = db.getGroup(chatId);
      if (!g || !await isAdmin(bot, chatId, ctx.from.id)) return;
      g[field] = !g[field];
      await ctx.answerCbQuery(`${g[field] ? '✅ تم تفعيل' : '❌ تم تعطيل'} ${label}!`);
      await ctx.editMessageReplyMarkup(groupSettingsKeyboard(chatId, g).reply_markup);
    });
  }

  bot.action(/^edit_welcome_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply('✏️ أرسل: `/setwelcome نص`\n\nالمتغيرات: `{name}` `{group}` `{username}`', { parse_mode: 'Markdown' });
  });

  bot.action(/^edit_rules_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply('📋 أرسل: `/setrules نص القواعد`', { parse_mode: 'Markdown' });
  });

  bot.action(/^group_home_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId);
    if (!g) return;
    await ctx.editMessageText(`🤖 *إدارة ${g.title}*\n\nاختر من القائمة:`,
      { parse_mode: 'Markdown', ...groupHomeKeyboard(chatId) });
  });

  bot.action(/^cancel_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery('تم الإلغاء ✅');
    await ctx.deleteMessage().catch(() => { });
  });
}

// ════════════════════════════════════════════════════════════
//  أوامر الإدارة والمالك
// ════════════════════════════════════════════════════════════

function setupAdminHandlers(bot) {

  // /admins
  bot.command('admins', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const g = db.getGroup(ctx.chat.id);
    let text = `👮 *مشرفو ${ctx.chat.title}*\n\n`;
    try {
      const list = await bot.telegram.getChatAdministrators(ctx.chat.id);
      for (const a of list) {
        if (a.user.is_bot) continue;
        const rec  = g && g.admins.get(a.user.id);
        const name = a.user.username ? `@${a.user.username}` : a.user.first_name;
        if (a.status === 'creator') {
          text += `👑 *المالك:* ${name}\n`;
          if (g) { g.ownerId = a.user.id; g.ownerUsername = a.user.username || a.user.first_name; }
          db.trackMember(ctx.chat.id, a.user.id, a.user.username || '', a.user.first_name || '', 'owner');
        } else {
          text += `👮 *مشرف:* ${name}`;
          if (rec) text += `\n   ↳ رُقِّيَ بواسطة: @${rec.promotedByUsername}`;
          text += '\n';
          db.trackMember(ctx.chat.id, a.user.id, a.user.username || '', a.user.first_name || '', 'admin');
        }
      }
    } catch { text += '_تعذر جلب القائمة_'; }
    await ctx.replyWithMarkdown(text);
  });

  // /ban
  bot.command('ban', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    if (!await isAdmin(bot, chatId, ctx.from.id)) return ctx.reply('❌ للمشرفين فقط!');
    const target = await getTargetUser(ctx);
    if (!target) return ctx.reply('❌ ارد على رسالة المستخدم أو اذكره!');
    const reason = getReason(ctx.message.text, target.username ? 2 : 1);
    try {
      await bot.telegram.banChatMember(chatId, target.id);
      const g = db.getGroup(chatId);
      if (g) g.bannedUsers.add(target.id);
      await ctx.replyWithMarkdown(
        `🚫 *تم الحظر*\n👤 ${target.username ? `@${target.username}` : target.firstName}\n👮 بواسطة: @${ctx.from.username || ctx.from.first_name}\n📝 ${reason}`,
        Markup.inlineKeyboard([[Markup.button.callback('✅ رفع الحظر', `unban_${target.id}_${chatId}`)]])
      );
    } catch (e) { await ctx.reply(`❌ ${e.message}`); }
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
      await ctx.replyWithMarkdown(`👢 *تم الطرد*\n👤 ${target.username ? `@${target.username}` : target.firstName}\n👮 بواسطة: @${ctx.from.username || ctx.from.first_name}`);
    } catch (e) { await ctx.reply(`❌ ${e.message}`); }
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
      const g = db.getGroup(chatId);
      if (g) g.mutedUsers.add(target.id);
      await ctx.replyWithMarkdown(
        `🔇 *تم الكتم*\n👤 ${target.username ? `@${target.username}` : target.firstName}\n👮 بواسطة: @${ctx.from.username || ctx.from.first_name}`,
        Markup.inlineKeyboard([[Markup.button.callback('🔊 رفع الكتم', `unmute_${target.id}_${chatId}`)]])
      );
    } catch (e) { await ctx.reply(`❌ ${e.message}`); }
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
      const g = db.getGroup(chatId);
      if (g) g.mutedUsers.delete(target.id);
      await ctx.replyWithMarkdown(`🔊 *تم رفع الكتم*\n👤 ${target.username ? `@${target.username}` : target.firstName}`);
    } catch (e) { await ctx.reply(`❌ ${e.message}`); }
  });

  // /warn
  bot.command('warn', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    if (!await isAdmin(bot, chatId, ctx.from.id)) return ctx.reply('❌ للمشرفين فقط!');
    const target = await getTargetUser(ctx);
    if (!target) return ctx.reply('❌ ارد على رسالة المستخدم أو اذكره!');
    const reason = getReason(ctx.message.text, 2);
    const g = db.getGroup(chatId);
    if (!g) return;
    if (!g.warns.has(target.id)) g.warns.set(target.id, []);
    const warns = g.warns.get(target.id);
    warns.push({ reason, warnedBy: ctx.from.id, warnedAt: new Date() });
    if (warns.length >= g.maxWarns) {
      try { await bot.telegram.banChatMember(chatId, target.id); g.bannedUsers.add(target.id); g.warns.delete(target.id); } catch { }
      await ctx.replyWithMarkdown(`🚫 *حظر تلقائي*\n👤 ${target.username ? `@${target.username}` : target.firstName}\n📝 ${g.maxWarns} تحذيرات. آخر سبب: ${reason}`);
    } else {
      await ctx.replyWithMarkdown(
        `⚠️ *تحذير ${warns.length}/${g.maxWarns}*\n👤 ${target.username ? `@${target.username}` : target.firstName}\n📝 ${reason}`,
        Markup.inlineKeyboard([[Markup.button.callback('🗑️ حذف التحذيرات', `clearwarns_${target.id}_${chatId}`)]])
      );
    }
  });

  // /warns
  bot.command('warns', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const target = await getTargetUser(ctx);
    if (!target) return ctx.reply('❌ ارد على رسالة المستخدم أو اذكره!');
    const g = db.getGroup(ctx.chat.id);
    const warns = g && g.warns.get(target.id) || [];
    if (warns.length === 0) return ctx.replyWithMarkdown(`✅ ${target.username ? `@${target.username}` : target.firstName} لا يملك تحذيرات.`);
    let text = `⚠️ *تحذيرات ${target.username ? `@${target.username}` : target.firstName}*\n\n`;
    warns.forEach((w, i) => { text += `${i + 1}. ${w.reason} — ${w.warnedAt.toLocaleDateString('ar-SA')}\n`; });
    text += `\nالإجمالي: ${warns.length}/${g.maxWarns || 3}`;
    await ctx.replyWithMarkdown(text, Markup.inlineKeyboard([[Markup.button.callback('🗑️ حذف التحذيرات', `clearwarns_${target.id}_${ctx.chat.id}`)]]));
  });

  // /settings
  bot.command('settings', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    if (!await isAdmin(bot, chatId, ctx.from.id)) return ctx.reply('❌ للمشرفين فقط!');
    const g = db.getGroup(chatId);
    if (!g) return ctx.reply('❌ بيانات المجموعة غير موجودة!');
    await ctx.replyWithMarkdown(`⚙️ *إعدادات ${g.title}*\n\nاضغط لتفعيل/تعطيل:`, groupSettingsKeyboard(chatId, g));
  });

  // /setwelcome
  bot.command('setwelcome', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    if (!await isAdmin(bot, chatId, ctx.from.id)) return ctx.reply('❌ للمشرفين فقط!');
    const text = ctx.message.text.replace('/setwelcome', '').trim();
    if (!text) return ctx.replyWithMarkdown('📝 `/setwelcome نص`\n\nالمتغيرات: `{name}` `{group}` `{username}`');
    const g = db.getGroup(chatId);
    if (!g) return;
    g.welcomeMessage = text;
    const preview = text.replace('{name}', ctx.from.first_name || 'عضو')
      .replace('{group}', ctx.chat.title || 'المجموعة')
      .replace('{username}', ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name || '');
    await ctx.replyWithMarkdown(`✅ *تم تعديل رسالة الترحيب*\n\n*معاينة:*\n${preview}`);
  });

  // /setrules
  bot.command('setrules', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    if (!await isAdmin(bot, chatId, ctx.from.id)) return ctx.reply('❌ للمشرفين فقط!');
    const text = ctx.message.text.replace('/setrules', '').trim();
    if (!text) return ctx.reply('📋 مثال: /setrules 1. الاحترام المتبادل\n2. عدم الإعلانات');
    const g = db.getGroup(chatId);
    if (!g) return;
    g.rules = text;
    await ctx.replyWithMarkdown(`✅ *تم تعيين قواعد المجموعة*\n\n${text}`);
  });

  // /addword — إضافة كلمة محظورة
  bot.command('addword', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    if (!await isAdmin(bot, chatId, ctx.from.id)) return ctx.reply('❌ للمشرفين فقط!');
    const args   = ctx.message.text.split(' ').slice(1);
    const word   = args[0];
    const action = (args[1] || 'warn').toLowerCase();
    if (!word) return ctx.replyWithMarkdown('📌 `/addword <كلمة> <إجراء>`\n\nالإجراءات: `warn` | `mute` | `kick` | `ban`');
    if (!['warn', 'mute', 'kick', 'ban'].includes(action))
      return ctx.reply('❌ الإجراء غير صحيح! الخيارات: warn | mute | kick | ban');
    const g = db.getGroup(chatId);
    if (!g) return;
    if (g.bannedWords.find(bw => bw.word.toLowerCase() === word.toLowerCase()))
      return ctx.reply('❌ هذه الكلمة موجودة مسبقاً!');
    g.bannedWords.push({ word, action, addedBy: ctx.from.id, addedAt: new Date() });
    const actionAr = { warn: '⚠️ تحذير', mute: '🔇 كتم', kick: '👢 طرد', ban: '🚫 حظر' };
    await ctx.replyWithMarkdown(`✅ *تمت إضافة الكلمة المحظورة*\n\n🔤 الكلمة: \`${word}\`\n⚡ الإجراء: ${actionAr[action]}`);
  });

  // /removeword — إزالة كلمة محظورة
  bot.command('removeword', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    if (!await isAdmin(bot, chatId, ctx.from.id)) return ctx.reply('❌ للمشرفين فقط!');
    const word = ctx.message.text.split(' ').slice(1).join(' ').trim();
    if (!word) return ctx.reply('📌 مثال: /removeword كلمة');
    const g = db.getGroup(chatId);
    if (!g) return;
    const before = g.bannedWords.length;
    g.bannedWords = g.bannedWords.filter(bw => bw.word.toLowerCase() !== word.toLowerCase());
    if (g.bannedWords.length === before) return ctx.reply('❌ الكلمة غير موجودة!');
    await ctx.replyWithMarkdown(`✅ *تمت إزالة الكلمة المحظورة:* \`${word}\``);
  });

  // /words — عرض الكلمات المحظورة
  bot.command('words', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    const g = db.getGroup(chatId);
    if (!g || g.bannedWords.length === 0) return ctx.reply('🔤 لا توجد كلمات محظورة.\n\nاستخدم /addword لإضافة كلمة.');
    const actionAr = { warn: '⚠️', mute: '🔇', kick: '👢', ban: '🚫' };
    let text = `🔤 *الكلمات المحظورة* (${g.bannedWords.length})\n\n`;
    g.bannedWords.forEach((bw, i) => { text += `${i + 1}. \`${bw.word}\` ${actionAr[bw.action] || ''}\n`; });
    text += '\n_لإزالة كلمة: /removeword <الكلمة>_';
    await ctx.replyWithMarkdown(text);
  });

  // /manage
  bot.command('manage', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    if (!await isAdmin(bot, chatId, ctx.from.id)) return ctx.reply('❌ للمشرفين فقط!');
    const target = await getTargetUser(ctx);
    if (!target) return ctx.reply('❌ ارد على رسالة المستخدم للإدارة!');
    db.trackMember(chatId, target.id, target.username, target.firstName, 'member');
    await ctx.replyWithMarkdown(
      `👤 *إدارة المستخدم*\n\nالاسم: ${target.firstName || '—'}\nالمعرف: @${target.username || '—'}\nالآيدي: \`${target.id}\``,
      memberActionsKeyboard(target.id, chatId, `cancel_${chatId}`)
    );
  });

  // ── أزرار الإجراءات الفردية ────────────────────────────────

  bot.action(/^mute_(\d+)_(-?\d+)$/, async (ctx) => {
    const [tid, cid] = [Number(ctx.match[1]), Number(ctx.match[2])];
    if (!isDeveloper(ctx) && !await isAdmin(bot, cid, ctx.from.id)) return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    try { await muteMember(bot, cid, tid); const g = db.getGroup(cid); if (g) g.mutedUsers.add(tid); await ctx.answerCbQuery('✅ تم الكتم!', { show_alert: true }); }
    catch (e) { await ctx.answerCbQuery(`❌ ${e.message}`, { show_alert: true }); }
  });

  bot.action(/^unmute_(\d+)_(-?\d+)$/, async (ctx) => {
    const [tid, cid] = [Number(ctx.match[1]), Number(ctx.match[2])];
    if (!isDeveloper(ctx) && !await isAdmin(bot, cid, ctx.from.id)) return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    try { await unmuteMember(bot, cid, tid); const g = db.getGroup(cid); if (g) g.mutedUsers.delete(tid); await ctx.answerCbQuery('✅ تم رفع الكتم!', { show_alert: true }); }
    catch (e) { await ctx.answerCbQuery(`❌ ${e.message}`, { show_alert: true }); }
  });

  bot.action(/^ban_(\d+)_(-?\d+)$/, async (ctx) => {
    const [tid, cid] = [Number(ctx.match[1]), Number(ctx.match[2])];
    if (!isDeveloper(ctx) && !await isAdmin(bot, cid, ctx.from.id)) return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    try { await bot.telegram.banChatMember(cid, tid); const g = db.getGroup(cid); if (g) g.bannedUsers.add(tid); await ctx.answerCbQuery('✅ تم الحظر!', { show_alert: true }); await ctx.deleteMessage().catch(() => { }); }
    catch (e) { await ctx.answerCbQuery(`❌ ${e.message}`, { show_alert: true }); }
  });

  bot.action(/^unban_(\d+)_(-?\d+)$/, async (ctx) => {
    const [tid, cid] = [Number(ctx.match[1]), Number(ctx.match[2])];
    if (!isDeveloper(ctx) && !await isAdmin(bot, cid, ctx.from.id)) return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    try { await bot.telegram.unbanChatMember(cid, tid); const g = db.getGroup(cid); if (g) g.bannedUsers.delete(tid); await ctx.answerCbQuery('✅ تم رفع الحظر!', { show_alert: true }); }
    catch (e) { await ctx.answerCbQuery(`❌ ${e.message}`, { show_alert: true }); }
  });

  bot.action(/^kick_(\d+)_(-?\d+)$/, async (ctx) => {
    const [tid, cid] = [Number(ctx.match[1]), Number(ctx.match[2])];
    if (!isDeveloper(ctx) && !await isAdmin(bot, cid, ctx.from.id)) return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    try { await bot.telegram.banChatMember(cid, tid); setTimeout(() => bot.telegram.unbanChatMember(cid, tid).catch(() => { }), 1500); await ctx.answerCbQuery('✅ تم الطرد!', { show_alert: true }); await ctx.deleteMessage().catch(() => { }); }
    catch (e) { await ctx.answerCbQuery(`❌ ${e.message}`, { show_alert: true }); }
  });

  bot.action(/^warn_(\d+)_(-?\d+)$/, async (ctx) => {
    const [tid, cid] = [Number(ctx.match[1]), Number(ctx.match[2])];
    if (!isDeveloper(ctx) && !await isAdmin(bot, cid, ctx.from.id)) return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const g = db.getGroup(cid); if (!g) return;
    if (!g.warns.has(tid)) g.warns.set(tid, []);
    const warns = g.warns.get(tid);
    warns.push({ reason: 'تحذير من لوحة التحكم', warnedBy: ctx.from.id, warnedAt: new Date() });
    if (warns.length >= g.maxWarns) {
      try { await bot.telegram.banChatMember(cid, tid); g.warns.delete(tid); await ctx.answerCbQuery(`🚫 حظر تلقائي! ${g.maxWarns} تحذيرات`, { show_alert: true }); } catch { }
    } else { await ctx.answerCbQuery(`⚠️ تحذير ${warns.length}/${g.maxWarns}`, { show_alert: true }); }
  });

  bot.action(/^info_(\d+)_(-?\d+)$/, async (ctx) => {
    const [tid, cid] = [Number(ctx.match[1]), Number(ctx.match[2])];
    const g = db.getGroup(cid);
    const m = g && g.members.get(tid);
    const roleAr = { owner: '👑 مالك', admin: '👮 مشرف', member: '👤 عضو' };
    const warns  = g && g.warns.get(tid) ? g.warns.get(tid).length : 0;
    await ctx.answerCbQuery(
      `👤 ${tid}\n📛 الرتبة: ${m ? roleAr[m.role] || '👤' : '👤 عضو'}\n⚠️ تحذيرات: ${warns}/${g && g.maxWarns || 3}\n🔇 مكتوم: ${g && g.mutedUsers.has(tid) ? 'نعم' : 'لا'}\n🚫 محظور: ${g && g.bannedUsers.has(tid) ? 'نعم' : 'لا'}`,
      { show_alert: true }
    );
  });

  bot.action(/^clearwarns_(\d+)_(-?\d+)$/, async (ctx) => {
    const [tid, cid] = [Number(ctx.match[1]), Number(ctx.match[2])];
    if (!isDeveloper(ctx) && !await isAdmin(bot, cid, ctx.from.id)) return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const g = db.getGroup(cid);
    if (g) g.warns.delete(tid);
    await ctx.answerCbQuery('✅ تم حذف جميع التحذيرات!', { show_alert: true });
    await ctx.deleteMessage().catch(() => { });
  });
}

module.exports = { setupDeveloper, setupGroupHandlers, setupAdminHandlers };
