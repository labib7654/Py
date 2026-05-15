const { Markup } = require('telegraf');
const db = require('./db');
const {
  isDeveloper, isAdmin, isOwner,
  promoteUser, demoteUser,
  muteMember, unmutePerms,
  logAction,
} = require('./helpers');

function devMainKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📊 الإحصائيات',     'dev_stats'),
     Markup.button.callback('🔄 تحديث',           'dev_refresh')],
    [Markup.button.callback('👥 المجموعات',       'dev_groups'),
     Markup.button.callback('📢 القنوات',         'dev_channels')],
    [Markup.button.callback('🌐 المجتمعات',       'dev_communities'),
     Markup.button.callback('🔍 بحث مستخدم',    'dev_user_search')],
    [Markup.button.callback('📣 بث رسالة',        'dev_broadcast'),
     Markup.button.callback('🚫 حظر عالمي',       'dev_ban_menu')],
    [Markup.button.callback('📋 المحظورون',       'dev_banned_list'),
     Markup.button.callback('✅ رفع حظر عالمي',  'dev_unban_menu')],
  ]);
}

function back(cb) { return Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', cb)]]); }

function memberActionsKeyboard(targetId, chatId, backCb) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('⬆️ رفع مشرف',   `promote_${targetId}_${chatId}`),
     Markup.button.callback('⬇️ تنزيل مشرف', `demote_${targetId}_${chatId}`)],
    [Markup.button.callback('🔇 كتم',         `mute_${targetId}_${chatId}`),
     Markup.button.callback('🔊 رفع كتم',     `unmute_${targetId}_${chatId}`)],
    [Markup.button.callback('⏱️ كتم مؤقت',   `mutet_show_${targetId}_${chatId}`),
     Markup.button.callback('🚫⏱️ حظر مؤقت', `bant_show_${targetId}_${chatId}`)],
    [Markup.button.callback('⚠️ تحذير',       `warn_${targetId}_${chatId}`),
     Markup.button.callback('🗑️ مسح تحذيرات',`clearwarns_${targetId}_${chatId}`)],
    [Markup.button.callback('👢 طرد',         `kick_${targetId}_${chatId}`),
     Markup.button.callback('🚫 حظر',         `ban_${targetId}_${chatId}`)],
    [Markup.button.callback('✅ رفع حظر',     `unban_${targetId}_${chatId}`),
     Markup.button.callback('📋 معلومات',     `info_${targetId}_${chatId}`)],
    [Markup.button.callback('🔙 رجوع', backCb || 'cancel')],
  ]);
}

module.exports = function setupDeveloper(bot) {

  // ── /start ──────────────────────────────────────────────────
  bot.command('start', async (ctx) => {
    if (ctx.chat.type !== 'private') return;
    const u = ctx.from;
    db.getOrCreateUser(u.id, u.username || '', u.first_name || '');

    // معالجة payload مثل panel_-100123456
    const payload = ctx.startPayload || '';
    if (payload.startsWith('panel_')) {
      const chatId = Number(payload.replace('panel_', ''));
      const g = db.getGroup(chatId);
      if (g) {
        const canAccess = isDeveloper(ctx) || g.ownerId === u.id || g.admins.has(u.id);
        if (canAccess) {
          const { Markup: M } = require('telegraf');
          return ctx.replyWithMarkdown(
            `⚙️ *إعدادات ${g.title}*\n\nاضغط لتفعيل/تعطيل:`,
            require('./handler_owner').groupSettingsKeyboard
              ? require('./handler_owner').groupSettingsKeyboard(chatId, g)
              : M.inlineKeyboard([[M.button.callback(`⚙️ الإعدادات`, `owner_panel_${chatId}`)]])
          );
        }
      }
    }

    // المطور
    if (isDeveloper(ctx)) {
      const s = db.getStats();
      return ctx.replyWithMarkdown(
        `🤖 *بوت إدارة المجموعات — جامعة v4.0*\n\n🔐 *لوحة التحكم السرية للمطور*\n\n` +
        `📊 *الإحصائيات:*\n• المجموعات: \`${s.totalGroups}\`\n• القنوات: \`${s.totalChannels}\`\n` +
        `• المستخدمون: \`${s.totalUsers}\`\n• المحظورون: \`${s.bannedUsers}\`\n` +
        `• المشرفون: \`${s.totalAdmins}\`\n• الطلبات المعلقة: \`${s.pendingReqs}\``,
        devMainKeyboard()
      );
    }

    // مالك/مشرف في مجموعات
    const userGroups = db.getUserGroups(u.id);
    if (userGroups.length > 0) {
      const btns = userGroups.slice(0, 8).map(chatId => {
        const g = db.getGroup(chatId);
        return [Markup.button.callback(`⚙️ ${(g?.title || String(chatId)).slice(0, 28)}`, `owner_panel_${chatId}`)];
      });
      btns.push([Markup.button.callback('ℹ️ مساعدة وأوامر', 'help_menu')]);
      return ctx.replyWithMarkdown(
        `👑 *مرحباً ${u.first_name}!*\n\n` +
        `لديك *${userGroups.length}* مجموعة تحت إدارتك.\n` +
        `اختر المجموعة للتحكم بها:`,
        Markup.inlineKeyboard(btns)
      );
    }

    // مستخدم عادي
    await ctx.replyWithMarkdown(
      `👋 *مرحباً ${u.first_name}!*\n\nأنا بوت إدارة المجموعات والمجتمعات.\n\n📌 *أضفني لمجموعتك وامنحني صلاحيات المشرف!*`,
      Markup.inlineKeyboard([
        [Markup.button.url('➕ أضفني لمجموعتك', `https://t.me/${ctx.botInfo.username}?startgroup=true`)],
        [Markup.button.callback('ℹ️ مساعدة وأوامر', 'help_menu')],
      ])
    );
  });

  // ── help_menu ────────────────────────────────────────────────
  bot.action('help_menu', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      `ℹ️ *دليل الأوامر — جامعة v4.0*\n\n` +
      `*أوامر الإدارة:*\n` +
      `\`/ban\` — حظر عضو\n\`/kick\` — طرد عضو\n\`/mute\` — كتم عضو\n\`/unmute\` — رفع الكتم\n` +
      `\`/warn\` — تحذير\n\`/warns\` — عرض التحذيرات\n\`/manage\` — لوحة إدارة عضو\n\n` +
      `*إعدادات المجموعة:*\n` +
      `\`/settings\` — فتح الإعدادات\n\`/mybot\` — لوحة التحكم في الخاص\n` +
      `\`/setwelcome\` — تعيين رسالة ترحيب\n\`/setrules\` — تعيين القواعد\n` +
      `\`/addword\` — إضافة كلمة محظورة\n\`/joinreqs\` — طلبات الانضمام\n\n` +
      `*معلومات:*\n` +
      `\`/top\` — أنشط الأعضاء\n\`/myscore\` — نقاطي\n\`/admins\` — قائمة المشرفين\n` +
      `\`/id\` — معرف الشات\n\`/ping\` — اختبار سرعة الاستجابة`,
      { parse_mode: 'Markdown', ...back('cancel') }
    );
  });

  // ── /dev ─────────────────────────────────────────────────────
  bot.command('dev', async (ctx) => {
    if (!isDeveloper(ctx)) return;
    const s = db.getStats();
    await ctx.replyWithMarkdown(
      `🔐 *لوحة تحكم المطور*\n\n📊 المجموعات: \`${s.totalGroups}\` | القنوات: \`${s.totalChannels}\`\n👤 ${s.totalUsers} مستخدم | 🚫 ${s.bannedUsers} محظور`,
      devMainKeyboard()
    );
  });

  // ── dev_stats ────────────────────────────────────────────────
  bot.action('dev_stats', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const s = db.getStats();
    const totalWords = db.allGroups().reduce((a, g) => a + g.bannedWords.length, 0);
    await ctx.editMessageText(
      `📊 *إحصائيات مفصّلة*\n\n👥 المجموعات: \`${s.totalGroups}\`\n📢 القنوات: \`${s.totalChannels}\`\n🌐 المجتمعات: \`${db.allCommunities().length}\`\n👤 المستخدمون: \`${s.totalUsers}\`\n🚫 محظورون: \`${s.bannedUsers}\`\n👮 المشرفون: \`${s.totalAdmins}\`\n⚠️ التحذيرات: \`${s.totalWarns}\`\n🔤 الكلمات: \`${totalWords}\`\n📨 طلبات معلقة: \`${s.pendingReqs}\``,
      { parse_mode: 'Markdown', ...back('dev_back') }
    );
  });

  // ── dev_groups ───────────────────────────────────────────────
  bot.action('dev_groups', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const groups = db.allGroups();
    if (!groups.length)
      return ctx.editMessageText('👥 *لا توجد مجموعات حتى الآن.*', { parse_mode: 'Markdown', ...back('dev_back') });
    const btns = groups.slice(0, 10).map(g => [Markup.button.callback(`👥 ${g.title.slice(0, 26)}`, `dev_grp_${g.chatId}`)]);
    btns.push([Markup.button.callback('🔙 رجوع', 'dev_back')]);
    await ctx.editMessageText(`👥 *المجموعات* (${groups.length})`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) });
  });

  bot.action(/^dev_grp_(-?\d+)$/, async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId);
    if (!g) return ctx.answerCbQuery('❌ غير موجودة!', { show_alert: true });
    const warns   = [...g.warns.values()].reduce((a, w) => a + w.length, 0);
    const pending = [...g.joinRequests.values()].filter(r => r.status === 'pending').length;
    await ctx.editMessageText(
      `📋 *${g.title}*\n\n🆔 \`${g.chatId}\`\n👑 المالك: \`${g.ownerUsername || 'غير محدد'}\` ${g.ownerVerified ? '✅' : ''}\n➕ أضافه: \`${g.addedByUsername}\`\n👮 المشرفون: \`${g.admins.size}\`\n👥 الأعضاء: \`${g.members.size}\`\n⚠️ التحذيرات: \`${warns}\`\n🔤 الكلمات: \`${g.bannedWords.length}\`\n📨 طلبات معلقة: \`${pending}\`\n🛡️ حماية المحتوى: ${g.protectContent ? '✅' : '❌'}\n🔗 منع روابط: ${g.antiLinks ? '✅' : '❌'}\n🤖 منع بوتات: ${g.antiBot ? '✅' : '❌'}\n🛡️ مكافحة السبام: ${g.antiSpam ? '✅' : '❌'} | 👋 الترحيب: ${g.welcomeEnabled ? '✅' : '❌'}`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('👥 الأعضاء',         `dev_members_${chatId}`),  Markup.button.callback('⚠️ المحذَّرون',   `dev_warned_${chatId}`)],
          [Markup.button.callback('🔇 المكتومون',        `dev_muted_${chatId}`),   Markup.button.callback('🚫 المحظورون',   `dev_banned_grp_${chatId}`)],
          [Markup.button.callback('📨 طلبات الانضمام',  `dev_joinreqs_${chatId}`),Markup.button.callback('📢 بث للمجموعة',`dev_grp_bcast_${chatId}`)],
          [Markup.button.callback('⚙️ الإعدادات',        `settings_${chatId}`)],
          [Markup.button.callback('🔙 رجوع',            'dev_groups')],
        ]),
      }
    );
  });

  bot.action(/^dev_members_(-?\d+)$/, async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId);
    if (!g) return ctx.answerCbQuery('❌ غير موجودة!', { show_alert: true });
    let adminIds = new Set(), ownerLine = '', adminLines = [];
    try {
      const list = await bot.telegram.getChatAdministrators(chatId);
      for (const a of list) {
        if (a.user.is_bot) continue;
        adminIds.add(a.user.id);
        const name = a.user.username ? `@${a.user.username}` : a.user.first_name;
        if (a.status === 'creator') {
          ownerLine = `👑 المالك: ${name} \`[${a.user.id}]\``;
          g.ownerId = a.user.id; g.ownerUsername = a.user.username || a.user.first_name;
        } else {
          const rec = g.admins.get(a.user.id);
          adminLines.push(`👮 ${name} \`[${a.user.id}]\`${rec ? ` ← @${rec.promotedByUsername}` : ''}`);
        }
      }
    } catch {}
    const members    = [...g.members.values()].filter(m => !adminIds.has(m.userId) && m.userId !== g.ownerId);
    let text         = `👥 *أعضاء ${g.title}*\n\n`;
    if (ownerLine)          text += `${ownerLine}\n\n`;
    if (adminLines.length)  text += `*المشرفون:*\n${adminLines.join('\n')}\n\n`;
    const memberBtns = [];
    if (members.length > 0) {
      text += `*الأعضاء (${members.length}):*\n`;
      members.slice(0, 8).forEach(m => {
        const name  = m.username ? `@${m.username}` : m.firstName;
        const icons = `${(g.warns.get(m.userId)?.length || 0) > 0 ? '⚠️' : ''}${g.mutedUsers.has(m.userId) ? '🔇' : ''}${g.bannedUsers.has(m.userId) ? '🚫' : ''}`;
        text += `👤 ${name} \`[${m.userId}]\` ${icons} ⭐${m.score || 0}\n`;
        memberBtns.push([Markup.button.callback(`👤 ${name.slice(0, 20)} ${icons}`, `dev_mact_${m.userId}_${chatId}`)]);
      });
    } else { text += '_لا يوجد أعضاء عاديون_'; }
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([...memberBtns, [Markup.button.callback('🔙 رجوع', `dev_grp_${chatId}`)]]),
    });
  });

  bot.action(/^dev_warned_(-?\d+)$/, async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId);
    if (!g) return ctx.answerCbQuery('❌ غير موجودة!', { show_alert: true });
    const warned = [...g.warns.entries()].filter(([, w]) => w.length > 0);
    if (!warned.length)
      return ctx.editMessageText('⚠️ *لا يوجد أعضاء محذَّرون*', { parse_mode: 'Markdown', ...back(`dev_grp_${chatId}`) });
    let text = `⚠️ *المحذَّرون في ${g.title}*\n\n`;
    const btns = warned.map(([uid, wList]) => {
      const m    = g.members.get(uid);
      const name = m ? (m.username ? `@${m.username}` : m.firstName) : String(uid);
      text += `👤 ${name} — \`${wList.length}/${g.maxWarns}\`\n`;
      return [Markup.button.callback(`👤 ${name.slice(0, 22)} (${wList.length})`, `dev_mact_${uid}_${chatId}`)];
    });
    btns.push([Markup.button.callback('🔙 رجوع', `dev_grp_${chatId}`)]);
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) });
  });

  bot.action(/^dev_muted_(-?\d+)$/, async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId);
    if (!g || !g.mutedUsers.size)
      return ctx.editMessageText('🔇 *لا يوجد أعضاء مكتومون*', { parse_mode: 'Markdown', ...back(`dev_grp_${chatId}`) });
    let text = `🔇 *المكتومون في ${g.title}* (${g.mutedUsers.size})\n\n`;
    const btns = [];
    for (const uid of g.mutedUsers) {
      const m    = g.members.get(uid);
      const name = m ? (m.username ? `@${m.username}` : m.firstName) : String(uid);
      text += `👤 ${name}\n`;
      btns.push([Markup.button.callback(`🔊 رفع كتم ${name.slice(0, 18)}`, `unmute_${uid}_${chatId}`)]);
    }
    btns.push([Markup.button.callback('🔙 رجوع', `dev_grp_${chatId}`)]);
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) });
  });

  bot.action(/^dev_banned_grp_(-?\d+)$/, async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId);
    if (!g || !g.bannedUsers.size)
      return ctx.editMessageText('🚫 *لا يوجد أعضاء محظورون*', { parse_mode: 'Markdown', ...back(`dev_grp_${chatId}`) });
    let text = `🚫 *المحظورون في ${g.title}* (${g.bannedUsers.size})\n\n`;
    const btns = [];
    for (const uid of g.bannedUsers) {
      const m     = g.members.get(uid);
      const name  = m ? (m.username ? `@${m.username}` : m.firstName) : String(uid);
      const timed = g.timedBans.get(uid);
      text += `👤 ${name}${timed ? ` (حتى ${new Date(timed).toLocaleString('ar')})` : ''}\n`;
      btns.push([Markup.button.callback(`✅ رفع حظر ${name.slice(0, 18)}`, `unban_${uid}_${chatId}`)]);
    }
    btns.push([Markup.button.callback('🔙 رجوع', `dev_grp_${chatId}`)]);
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) });
  });

  bot.action(/^dev_joinreqs_(-?\d+)$/, async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId);
    if (!g) return ctx.answerCbQuery('❌ غير موجودة!', { show_alert: true });
    const pending = [...g.joinRequests.values()].filter(r => r.status === 'pending');
    if (!pending.length)
      return ctx.editMessageText('📨 *لا توجد طلبات معلقة.*', { parse_mode: 'Markdown', ...back(`dev_grp_${chatId}`) });
    let text = `📨 *طلبات الانضمام* (${pending.length})\n\n`;
    const btns = pending.slice(0, 8).map(r => {
      text += `👤 ${r.firstName}${r.username ? ` (@${r.username})` : ''} \`[${r.userId}]\`\n`;
      return [
        Markup.button.callback(`✅ ${r.firstName.slice(0, 14)}`, `jr_approve_${r.userId}_${chatId}`),
        Markup.button.callback('❌ رفض',   `jr_reject_${r.userId}_${chatId}`),
        Markup.button.callback('🔍 تحقق', `jr_check_${r.userId}_${chatId}`),
      ];
    });
    btns.push([
      Markup.button.callback('✅ قبول الكل', `jr_approveall_${chatId}`),
      Markup.button.callback('❌ رفض الكل',  `jr_rejectall_${chatId}`),
    ]);
    btns.push([Markup.button.callback('🔙 رجوع', `dev_grp_${chatId}`)]);
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) });
  });

  bot.action(/^dev_grp_bcast_(-?\d+)$/, async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    await ctx.editMessageText(
      `📢 *بث للمجموعة*\n\n\`/bcastone ${chatId} نص الرسالة\``,
      { parse_mode: 'Markdown', ...back(`dev_grp_${chatId}`) }
    );
  });

  bot.action(/^dev_mact_(\d+)_(-?\d+)$/, async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const targetId = Number(ctx.match[1]);
    const chatId   = Number(ctx.match[2]);
    const g    = db.getGroup(chatId);
    const m    = g?.members.get(targetId);
    const name = m ? (m.username ? `@${m.username}` : m.firstName) : String(targetId);
    const warns= g?.warns.get(targetId)?.length || 0;
    const gu   = db.getUser(targetId);
    await ctx.editMessageText(
      `👤 *${name}*\n\n🆔 \`${targetId}\`\n⚠️ التحذيرات: \`${warns}/${g?.maxWarns || 3}\`\n🔇 مكتوم: ${g?.mutedUsers.has(targetId) ? '✅' : '❌'}\n🚫 محظور محلياً: ${g?.bannedUsers.has(targetId) ? '✅' : '❌'}\n🌍 محظور عالمياً: ${gu?.globalBanned ? `✅ — ${gu.bannedReason}` : '❌'}\n📨 رسائل: \`${m?.messageCount || 0}\`\n⭐ نقاط: \`${m?.score || 0}\``,
      { parse_mode: 'Markdown', ...memberActionsKeyboard(targetId, chatId, `dev_members_${chatId}`) }
    );
  });

  // ── dev_channels ─────────────────────────────────────────────
  bot.action('dev_channels', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const chs = db.allChannels();
    if (!chs.length)
      return ctx.editMessageText('📢 *لا توجد قنوات حتى الآن.*', { parse_mode: 'Markdown', ...back('dev_back') });
    const btns = chs.slice(0, 10).map(c => [Markup.button.callback(`📢 ${c.title.slice(0, 26)}`, `dev_ch_${c.chatId}`)]);
    btns.push([Markup.button.callback('🔙 رجوع', 'dev_back')]);
    await ctx.editMessageText(`📢 *القنوات* (${chs.length})`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) });
  });

  bot.action(/^dev_ch_(-?\d+)$/, async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const c = db.getChannel(Number(ctx.match[1]));
    if (!c) return ctx.answerCbQuery('❌ غير موجودة!', { show_alert: true });
    await ctx.editMessageText(
      `📢 *${c.title}*\n\n🆔 \`${c.chatId}\`\n🔗 ${c.username ? `@${c.username}` : '—'}\n👑 المالك: \`${c.ownerUsername || 'غير محدد'}\`\n👥 المشتركون: \`${c.subscribers.size}\``,
      { parse_mode: 'Markdown', ...back('dev_channels') }
    );
  });

  // ── dev_communities ──────────────────────────────────────────
  bot.action('dev_communities', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const coms = db.allCommunities();
    if (!coms.length)
      return ctx.editMessageText('🌐 *لا توجد مجتمعات.*\n\n`/community create <معرف> <الاسم>`', { parse_mode: 'Markdown', ...back('dev_back') });
    const btns = coms.map(c => [Markup.button.callback(`🌐 ${c.title.slice(0, 24)} (${c.subGroups.size})`, `dev_com_${c.communityId}`)]);
    btns.push([Markup.button.callback('🔙 رجوع', 'dev_back')]);
    await ctx.editMessageText(`🌐 *المجتمعات* (${coms.length})`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) });
  });

  bot.action(/^dev_com_(-?\d+)$/, async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const c = db.getCommunity(Number(ctx.match[1]));
    if (!c) return ctx.answerCbQuery('❌ غير موجود!', { show_alert: true });
    const subNames = [...c.subGroups].map(id => { const g = db.getGroup(id); return g ? `• ${g.title} \`[${id}]\`` : `• \`${id}\``; }).join('\n') || '_لا توجد مجموعات فرعية_';
    await ctx.editMessageText(
      `🌐 *${c.title}*\n\n🆔 \`${c.communityId}\`\n📁 المجموعات:\n${subNames}\n\n⚙️ الحد الأقصى: \`${c.maxGroupJoins}\`\n🛡️ الحماية: ${c.enabled ? '✅' : '❌'}`,
      { parse_mode: 'Markdown', ...back('dev_communities') }
    );
  });

  // ── /community ───────────────────────────────────────────────
  bot.command('community', async (ctx) => {
    if (!isDeveloper(ctx)) return;
    const args = ctx.message.text.split(' ').slice(1);
    if (args[0] === 'create') {
      const id = Number(args[1]); const name = args.slice(2).join(' ');
      if (!id || !name) return ctx.reply('❌ مثال: /community create 123456 جامعة عمران');
      db.getOrCreateCommunity(id, name);
      return ctx.replyWithMarkdown(`✅ *تم إنشاء المجتمع:* ${name}\n🆔 \`${id}\``);
    }
    if (args[0] === 'addgroup') {
      const comId = Number(args[1]); const chatId = Number(args[2]);
      const c = db.getCommunity(comId); if (!c) return ctx.reply('❌ المجتمع غير موجود!');
      c.subGroups.add(chatId);
      const g = db.getGroup(chatId); if (g) g.communityId = comId;
      return ctx.replyWithMarkdown(`✅ أُضيفت المجموعة \`${chatId}\` لمجتمع *${c.title}*`);
    }
    if (args[0] === 'setlimit') {
      const comId = Number(args[1]); const limit = Number(args[2]);
      const c = db.getCommunity(comId); if (!c || !limit) return ctx.reply('❌ مثال: /community setlimit 123456 1');
      c.maxGroupJoins = limit;
      return ctx.replyWithMarkdown(`✅ الحد الأقصى: \`${limit}\` لمجتمع *${c.title}*`);
    }
    ctx.replyWithMarkdown('🌐 *أوامر المجتمعات:*\n\n`/community create <معرف> <الاسم>`\n`/community addgroup <معرف_مجتمع> <معرف_مجموعة>`\n`/community setlimit <معرف_مجتمع> <الحد>`');
  });

  // ── dev_broadcast ────────────────────────────────────────────
  bot.action('dev_broadcast', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    await ctx.editMessageText('📢 *بث جماعي*\n\n`/broadcast نص الرسالة`\n\nيُرسل لكل المجموعات.', { parse_mode: 'Markdown', ...back('dev_back') });
  });

  // ── /bcastone ────────────────────────────────────────────────
  bot.command('bcastone', async (ctx) => {
    if (!isDeveloper(ctx)) return;
    const parts  = ctx.message.text.split(' ');
    const chatId = Number(parts[1]);
    const text   = parts.slice(2).join(' ');
    if (!chatId || !text) return ctx.reply('❌ مثال: /bcastone -100123456 نص');
    try {
      await bot.telegram.sendMessage(chatId, `📢 *رسالة من المطور*\n\n${text}`, { parse_mode: 'Markdown' });
      await ctx.reply('✅ تم!');
    } catch (e) { await ctx.reply(`❌ ${e.message}`); }
  });

  // ── dev_ban_menu / dev_unban_menu ────────────────────────────
  bot.action('dev_ban_menu', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    await ctx.editMessageText('🚫 *حظر عالمي*\n\n`/gban <id> <السبب>`', { parse_mode: 'Markdown', ...back('dev_back') });
  });

  bot.action('dev_unban_menu', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    await ctx.editMessageText('✅ *رفع الحظر العالمي*\n\n`/ungban <id>`', { parse_mode: 'Markdown', ...back('dev_back') });
  });

  // ── /gban / /ungban ──────────────────────────────────────────
  bot.command('gban', async (ctx) => {
    if (!isDeveloper(ctx)) return;
    const args     = ctx.message.text.split(' ').slice(1);
    const targetId = Number(args[0]);
    const reason   = args.slice(1).join(' ') || 'لا يوجد سبب';
    if (!targetId) return ctx.reply('❌ مثال: /gban 123456 سبب');
    const user = db.getOrCreateUser(targetId, '', '');
    user.globalBanned = true; user.bannedReason = reason; user.bannedAt = new Date();
    await ctx.replyWithMarkdown(`🚫 *تم الحظر العالمي*\n\`${targetId}\`\n${reason}`);
    for (const g of db.allGroups()) {
      try { await bot.telegram.banChatMember(g.chatId, targetId); } catch {}
    }
  });

  bot.command('ungban', async (ctx) => {
    if (!isDeveloper(ctx)) return;
    const targetId = Number(ctx.message.text.split(' ')[1]);
    if (!targetId) return ctx.reply('❌ مثال: /ungban 123456');
    const user = db.getUser(targetId);
    if (!user) return ctx.reply('❌ المستخدم غير موجود!');
    user.globalBanned = false; user.bannedReason = ''; user.bannedAt = null;
    await ctx.replyWithMarkdown(`✅ *رُفع الحظر عن:* \`${targetId}\``);
  });

  // ── dev_banned_list ──────────────────────────────────────────
  bot.action('dev_banned_list', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const banned = db.allUsers().filter(u => u.globalBanned);
    if (!banned.length)
      return ctx.editMessageText('📋 *لا يوجد محظورون عالمياً.*', { parse_mode: 'Markdown', ...back('dev_back') });
    let text = `📋 *المحظورون عالمياً* (${banned.length})\n\n`;
    banned.slice(0, 10).forEach(u => {
      text += `• \`${u.userId}\` ${u.username ? `@${u.username}` : ''} — ${u.bannedReason}\n`;
    });
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...back('dev_back') });
  });

  // ── dev_user_search / /userinfo ──────────────────────────────
  bot.action('dev_user_search', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    await ctx.editMessageText('🔍 *بحث مستخدم*\n\n`/userinfo <id أو @username>`', { parse_mode: 'Markdown', ...back('dev_back') });
  });

  bot.command('userinfo', async (ctx) => {
    if (!isDeveloper(ctx)) return;
    const arg = ctx.message.text.split(' ')[1];
    if (!arg) return ctx.reply('❌ مثال: /userinfo 123456');
    const user = /^\d+$/.test(arg)
      ? db.getUser(Number(arg))
      : db.allUsers().find(u => u.username.toLowerCase() === arg.replace('@', '').toLowerCase());
    if (!user) return ctx.reply('❌ المستخدم غير موجود!');
    await ctx.replyWithMarkdown(
      `👤 *معلومات المستخدم*\n\n🆔 \`${user.userId}\`\n📛 ${user.firstName}\n🔗 ${user.username ? `@${user.username}` : '—'}\n🌍 محظور: ${user.globalBanned ? `✅ — ${user.bannedReason}` : '❌'}\n📅 أول ظهور: ${new Date(user.firstSeen).toLocaleDateString('ar')}\n👁️ آخر ظهور: ${new Date(user.lastSeen).toLocaleDateString('ar')}\n👥 المجموعات: \`${user.groups.size}\``
    );
  });

  // ── dev_refresh / dev_back ───────────────────────────────────
  bot.action('dev_refresh', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery('🔄 تم التحديث!');
    const s = db.getStats();
    await ctx.editMessageText(
      `🔐 *لوحة تحكم المطور*\n\n📊 المجموعات: \`${s.totalGroups}\` | القنوات: \`${s.totalChannels}\`\n👤 ${s.totalUsers} مستخدم | 🚫 ${s.bannedUsers} محظور`,
      { parse_mode: 'Markdown', ...devMainKeyboard() }
    );
  });

  bot.action('dev_back', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const s = db.getStats();
    await ctx.editMessageText(
      `🔐 *لوحة تحكم المطور*\n\n📊 المجموعات: \`${s.totalGroups}\` | القنوات: \`${s.totalChannels}\`\n👤 ${s.totalUsers} مستخدم | 🚫 ${s.bannedUsers} محظور`,
      { parse_mode: 'Markdown', ...devMainKeyboard() }
    );
  });

};
