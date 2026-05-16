const { Markup } = require('telegraf');
const db = require('./db');
const {
  isDeveloper, isAdmin, isOwner,
  promoteUser, demoteUser,
  muteMember, unmutePerms,
  logAction,
} = require('./helpers');

// ── 6️⃣أ) لوحة المطور المحدَّثة ──────────────────────────────
function devMainKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📊 الإحصائيات',      'dev_stats'),
     Markup.button.callback('🔄 تحديث',            'dev_refresh')],
    [Markup.button.callback('👥 المجموعات',        'dev_groups'),
     Markup.button.callback('📢 القنوات',          'dev_channels')],
    [Markup.button.callback('🌐 المجتمعات',        'dev_communities'),
     Markup.button.callback('🔍 بحث مستخدم',      'dev_user_search')],
    [Markup.button.callback('📣 بث رسالة',         'dev_broadcast'),
     Markup.button.callback('🚫 حظر عالمي',        'dev_ban_menu')],
    [Markup.button.callback('📋 المحظورون',        'dev_banned_list'),
     Markup.button.callback('✅ رفع حظر عالمي',   'dev_unban_menu')],
    // ── 6️⃣أ) جديد ──
    [Markup.button.callback('👤 مستخدمو البوت',    'dev_bot_users'),
     Markup.button.callback('📈 استخدام البوت',    'dev_usage')],
  ]);
}

function back(cb) { return Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', cb)]]); }

function memberActionsKeyboard(targetId, chatId, backCb) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('⬆️ رفع مشرف',    `promote_${targetId}_${chatId}`),
     Markup.button.callback('⬇️ تنزيل مشرف', `demote_${targetId}_${chatId}`)],
    [Markup.button.callback('🔇 كتم',          `mute_${targetId}_${chatId}`),
     Markup.button.callback('🔊 رفع كتم',      `unmute_${targetId}_${chatId}`)],
    [Markup.button.callback('⏱️ كتم مؤقت',    `mutet_show_${targetId}_${chatId}`),
     Markup.button.callback('🚫⏱️ حظر مؤقت', `bant_show_${targetId}_${chatId}`)],
    [Markup.button.callback('⚠️ تحذير',        `warn_${targetId}_${chatId}`),
     Markup.button.callback('🗑️ مسح تحذيرات', `clearwarns_${targetId}_${chatId}`)],
    [Markup.button.callback('👢 طرد',          `kick_${targetId}_${chatId}`),
     Markup.button.callback('🚫 حظر',          `ban_${targetId}_${chatId}`)],
    [Markup.button.callback('✅ رفع حظر',      `unban_${targetId}_${chatId}`),
     Markup.button.callback('📋 معلومات',      `info_${targetId}_${chatId}`)],
    [Markup.button.callback('🔙 رجوع', backCb || 'cancel')],
  ]);
}

module.exports = function setupDeveloper(bot) {

  // ── /start ──────────────────────────────────────────────────
  bot.command('start', async (ctx) => {
    if (ctx.chat.type !== 'private') return;
    const u = ctx.from;
    db.getOrCreateUser(u.id, u.username || '', u.first_name || '');

    const payload = ctx.startPayload || '';
    if (payload.startsWith('panel_')) {
      const chatId = Number(payload.replace('panel_', ''));
      const g = db.getGroup(chatId);
      if (g) {
        const canAccess = isDeveloper(ctx) || g.ownerId === u.id || g.admins.has(u.id);
        if (canAccess) {
          const { groupSettingsKeyboard } = require('./handler_owner');
          return ctx.replyWithMarkdown(
            `⚙️ *إعدادات ${g.title}*\n\nاضغط لتفعيل/تعطيل:`,
            groupSettingsKeyboard(chatId, g)
          );
        }
      }
    }

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
      `\`/warn\` — تحذير\n\`/warns\` — عرض التحذيرات\n\`/manage\` — لوحة إدارة عضو\n\`/promote\` — رفع مشرف\n\`/demote\` — تنزيل مشرف\n\`/unban\` — رفع الحظر\n\n` +
      `*إعدادات المجموعة:*\n` +
      `\`/settings\` — فتح الإعدادات\n\`/mybot\` — لوحة التحكم في الخاص\n` +
      `\`/setwelcome\` — تعيين رسالة ترحيب\n\`/setrules\` — تعيين القواعد\n` +
      `\`/addword\` — إضافة كلمة محظورة\n\`/removeword\` — إزالة كلمة\n\`/words\` — عرض الكلمات\n\`/joinreqs\` — طلبات الانضمام\n\n` +
      `*المواضيع (Topics):*\n` +
      `\`/locktopic\` — قفل موضوع\n\`/unlocktopic\` — فتح موضوع\n\`/archivetopic\` — أرشفة موضوع\n\`/topicrequest on/off\` — موافقة دخول\n\n` +
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

  // ── dev_refresh ──────────────────────────────────────────────
  bot.action('dev_refresh', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery('🔄 تم التحديث', { show_alert: false });
    const s = db.getStats();
    try {
      await ctx.editMessageText(
        `🤖 *بوت إدارة المجموعات — جامعة v4.0*\n\n🔐 *لوحة التحكم السرية للمطور*\n\n` +
        `📊 *الإحصائيات:*\n• المجموعات: \`${s.totalGroups}\`\n• القنوات: \`${s.totalChannels}\`\n` +
        `• المستخدمون: \`${s.totalUsers}\`\n• المحظورون: \`${s.bannedUsers}\`\n` +
        `• المشرفون: \`${s.totalAdmins}\`\n• الطلبات المعلقة: \`${s.pendingReqs}\``,
        { parse_mode: 'Markdown', ...devMainKeyboard() }
      );
    } catch {}
  });

  // ── 6️⃣ج) dev_groups — مع Pagination ────────────────────────
  bot.action(/^dev_groups(_(\d+))?$/, async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const page      = Number(ctx.match[2] || 0);
    const PAGE_SIZE = 8;
    const groups    = db.allGroups();
    const slice     = groups.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

    if (!groups.length) {
      return ctx.editMessageText('👥 *لا توجد مجموعات حتى الآن.*',
        { parse_mode: 'Markdown', ...back('dev_back') });
    }

    const btns = slice.map(g => [
      Markup.button.callback(
        `${g.type === 'channel' ? '📢' : '👥'} ${g.title.slice(0, 24)} (${g.members.size})`,
        `dev_grp_${g.chatId}`
      ),
    ]);

    const navBtns = [];
    if (page > 0) navBtns.push(Markup.button.callback('◀️ السابق', `dev_groups_${page - 1}`));
    if ((page + 1) * PAGE_SIZE < groups.length) navBtns.push(Markup.button.callback('التالي ▶️', `dev_groups_${page + 1}`));
    if (navBtns.length) btns.push(navBtns);
    btns.push([Markup.button.callback('🔙 رجوع', 'dev_back')]);

    await ctx.editMessageText(
      `👥 *المجموعات* (${groups.length}) — صفحة ${page + 1}`,
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) }
    );
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
      `📋 *${g.title}*\n\n🆔 \`${g.chatId}\`\n👑 المالك: \`${g.ownerUsername || 'غير محدد'}\` ${g.ownerVerified ? '✅' : ''}\n➕ أضافه: \`${g.addedByUsername}\`\n👮 المشرفون: \`${g.admins.size}\`\n👥 الأعضاء: \`${g.members.size}\`\n⚠️ التحذيرات: \`${warns}\`\n🔤 الكلمات: \`${g.bannedWords.length}\`\n📨 طلبات معلقة: \`${pending}\`\n🛡️ حماية المحتوى: ${g.protectContent ? '✅' : '❌'}\n🔒 موافقة الانضمام: ${g.joinRequestsEnabled ? '✅' : '❌'}\n🤖 منع البوتات: ${g.antiBot ? '✅' : '❌'}`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('👥 الأعضاء',          `dev_members_${chatId}`),   Markup.button.callback('⚠️ المحذَّرون',  `dev_warned_${chatId}`)],
          [Markup.button.callback('🔇 المكتومون',         `dev_muted_${chatId}`),    Markup.button.callback('🚫 المحظورون',  `dev_banned_grp_${chatId}`)],
          [Markup.button.callback('📨 طلبات الانضمام',   `dev_joinreqs_${chatId}`), Markup.button.callback('📢 بث للمجموعة',`dev_grp_bcast_${chatId}`)],
          [Markup.button.callback('⚙️ الإعدادات',         `settings_${chatId}`)],
          [Markup.button.callback('🔙 رجوع',             'dev_groups')],
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
    const members = [...g.members.values()].filter(m => !adminIds.has(m.userId) && m.userId !== g.ownerId);
    let text      = `👥 *أعضاء ${g.title}*\n\n`;
    if (ownerLine)         text += `${ownerLine}\n\n`;
    if (adminLines.length) text += `*المشرفون:*\n${adminLines.join('\n')}\n\n`;
    const memberBtns = [];
    if (members.length > 0) {
      text += `*الأعضاء (${members.length}):*\n`;
      members.slice(0, 8).forEach(m => {
        const name = m.username ? `@${m.username}` : m.firstName;
        text += `• ${name} \`[${m.userId}]\`\n`;
        memberBtns.push([Markup.button.callback(`👤 ${name.slice(0, 20)}`, `info_${m.userId}_${chatId}`)]);
      });
    }
    memberBtns.push([Markup.button.callback('🔙 رجوع', `dev_grp_${chatId}`)]);
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(memberBtns) });
  });

  bot.action(/^dev_warned_(-?\d+)$/, async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId);
    if (!g) return ctx.answerCbQuery('❌ غير موجودة!', { show_alert: true });
    const warned = [...g.warns.entries()].filter(([, w]) => w.length > 0);
    if (!warned.length) return ctx.answerCbQuery('✅ لا يوجد محذَّرون', { show_alert: true });
    let text = `⚠️ *المحذَّرون في ${g.title}*\n\n`;
    warned.forEach(([uid, ws]) => {
      const m = g.members.get(uid);
      text += `• ${m?.username ? `@${m.username}` : m?.firstName || uid} — \`${ws.length}/${g.maxWarns}\`\n`;
    });
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...back(`dev_grp_${chatId}`) });
  });

  bot.action(/^dev_muted_(-?\d+)$/, async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId);
    if (!g || !g.mutedUsers.size) return ctx.answerCbQuery('✅ لا يوجد مكتومون', { show_alert: true });
    let text = `🔇 *المكتومون في ${g.title}*\n\n`;
    [...g.mutedUsers].forEach(uid => {
      const m = g.members.get(uid);
      text += `• ${m?.username ? `@${m.username}` : m?.firstName || uid} \`[${uid}]\`\n`;
    });
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...back(`dev_grp_${chatId}`) });
  });

  bot.action(/^dev_banned_grp_(-?\d+)$/, async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId);
    if (!g || !g.bannedUsers.size) return ctx.answerCbQuery('✅ لا يوجد محظورون', { show_alert: true });
    let text = `🚫 *المحظورون في ${g.title}*\n\n`;
    [...g.bannedUsers].forEach(uid => {
      const m = g.members.get(uid);
      text += `• ${m?.username ? `@${m.username}` : m?.firstName || uid} \`[${uid}]\`\n`;
    });
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...back(`dev_grp_${chatId}`) });
  });

  bot.action(/^dev_joinreqs_(-?\d+)$/, async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId);
    const pending = g ? [...g.joinRequests.values()].filter(r => r.status === 'pending') : [];
    if (!pending.length) return ctx.answerCbQuery('✅ لا توجد طلبات معلقة', { show_alert: true });
    let text = `📨 *طلبات الانضمام* (${pending.length})\n\n`;
    const btns = pending.slice(0, 5).flatMap(r => {
      text += `• ${r.firstName}${r.username ? ` (@${r.username})` : ''} \`[${r.userId}]\`\n`;
      return [[
        Markup.button.callback(`✅ ${r.firstName.slice(0, 12)}`, `jr_approve_${r.userId}_${chatId}`),
        Markup.button.callback('❌', `jr_reject_${r.userId}_${chatId}`),
      ]];
    });
    btns.push([Markup.button.callback('🔙 رجوع', `dev_grp_${chatId}`)]);
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) });
  });

  // ── dev_channels ─────────────────────────────────────────────
  bot.action('dev_channels', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const channels = db.allChannels();
    if (!channels.length) return ctx.editMessageText('📢 *لا توجد قنوات.*', { parse_mode: 'Markdown', ...back('dev_back') });
    let text = `📢 *القنوات* (${channels.length})\n\n`;
    channels.slice(0, 15).forEach(c => {
      text += `• *${c.title}* \`[${c.chatId}]\` — ${c.subscribers.size} مشترك\n`;
    });
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...back('dev_back') });
  });

  // ── dev_communities ──────────────────────────────────────────
  bot.action('dev_communities', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const coms = db.allCommunities();
    if (!coms.length) return ctx.editMessageText('🌐 *لا توجد مجتمعات.*', { parse_mode: 'Markdown', ...back('dev_back') });
    let text = `🌐 *المجتمعات* (${coms.length})\n\n`;
    coms.forEach(c => {
      text += `• *${c.title}* — ${c.subGroups.size} مجموعة | الحد: \`${c.maxGroupJoins}\` | ${c.enabled ? '✅' : '❌'}\n`;
    });
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...back('dev_back') });
  });

  // ── 6️⃣ب) dev_bot_users — مستخدمو البوت ────────────────────
  bot.action('dev_bot_users', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();

    const addedByStats = new Map();
    for (const g of db.allGroups()) {
      const key = g.addedBy;
      if (!addedByStats.has(key)) {
        addedByStats.set(key, { username: g.addedByUsername, groups: 0 });
      }
      addedByStats.get(key).groups++;
    }

    let text = `👤 *مستخدمو البوت*\n\n`;
    text += `📊 إجمالي المستخدمين: \`${db.allUsers().length}\`\n`;
    text += `👥 من أضافوا البوت لمجموعات: \`${addedByStats.size}\` مستخدم\n\n`;
    text += `*أكثر المستخدمين إضافةً:*\n`;

    const sorted = [...addedByStats.entries()]
      .sort((a, b) => b[1].groups - a[1].groups)
      .slice(0, 10);

    for (const [uid, data] of sorted) {
      text += `• ${data.username || uid} — \`${data.groups}\` مجموعة\n`;
    }

    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...back('dev_back') });
  });

  // ── 6️⃣ب) dev_usage — إحصائيات استخدام البوت ───────────────
  bot.action('dev_usage', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();

    const groups   = db.allGroups();
    const users    = db.allUsers();
    const totalMsg = groups.reduce((a, g) =>
      a + [...g.members.values()].reduce((b, m) => b + (m.messageCount || 0), 0), 0
    );
    const totalWarns = groups.reduce((a, g) =>
      a + [...g.warns.values()].reduce((b, w) => b + w.length, 0), 0
    );
    const totalBans  = groups.reduce((a, g) => a + g.bannedUsers.size, 0);
    const globalBans = users.filter(u => u.globalBanned).length;
    const activeLast24h = users.filter(u =>
      u.lastSeen && (Date.now() - new Date(u.lastSeen).getTime()) < 24 * 3600 * 1000
    ).length;

    const text =
      `📈 *إحصائيات استخدام البوت*\n\n` +
      `👥 المجموعات: \`${groups.length}\`\n` +
      `👤 المستخدمون: \`${users.length}\`\n` +
      `💬 إجمالي الرسائل المرصودة: \`${totalMsg}\`\n` +
      `⚠️ إجمالي التحذيرات: \`${totalWarns}\`\n` +
      `🚫 إجمالي الحظر في المجموعات: \`${totalBans}\`\n` +
      `🌐 الحظر العالمي: \`${globalBans}\`\n` +
      `🟢 نشطون آخر 24 ساعة: \`${activeLast24h}\``;

    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...back('dev_back') });
  });

  // ── dev_user_search ──────────────────────────────────────────
  bot.action('dev_user_search', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      `🔍 *بحث مستخدم*\n\nأرسل معرف التيليغرام أو @username:`,
      { parse_mode: 'Markdown', ...back('dev_back') }
    );
  });

  // ── dev_broadcast ────────────────────────────────────────────
  bot.action('dev_broadcast', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      `📣 *بث رسالة*\n\nأرسل الرسالة التي تريد بثّها لجميع المجموعات (${db.allGroups().length} مجموعة):`,
      { parse_mode: 'Markdown', ...back('dev_back') }
    );
  });

  // ── dev_ban_menu / dev_unban_menu ────────────────────────────
  bot.action('dev_ban_menu', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      `🚫 *حظر عالمي*\n\nأرسل معرف المستخدم أو @username للحظر العالمي:`,
      { parse_mode: 'Markdown', ...back('dev_back') }
    );
  });

  bot.action('dev_unban_menu', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      `✅ *رفع حظر عالمي*\n\nأرسل معرف المستخدم لرفع الحظر العالمي:`,
      { parse_mode: 'Markdown', ...back('dev_back') }
    );
  });

  // ── dev_banned_list ──────────────────────────────────────────
  bot.action('dev_banned_list', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const banned = db.allUsers().filter(u => u.globalBanned);
    if (!banned.length) return ctx.editMessageText('✅ *لا يوجد محظورون عالمياً.*', { parse_mode: 'Markdown', ...back('dev_back') });
    let text = `🚫 *المحظورون عالمياً* (${banned.length})\n\n`;
    banned.slice(0, 20).forEach(u => {
      text += `• ${u.username ? `@${u.username}` : u.firstName} \`[${u.userId}]\`\n  📝 ${u.bannedReason || '—'}\n`;
    });
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...back('dev_back') });
  });

  // ── dev_back ─────────────────────────────────────────────────
  bot.action('dev_back', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const s = db.getStats();
    try {
      await ctx.editMessageText(
        `🤖 *بوت إدارة المجموعات — جامعة v4.0*\n\n🔐 *لوحة التحكم السرية للمطور*\n\n` +
        `📊 *الإحصائيات:*\n• المجموعات: \`${s.totalGroups}\`\n• القنوات: \`${s.totalChannels}\`\n` +
        `• المستخدمون: \`${s.totalUsers}\`\n• المحظورون: \`${s.bannedUsers}\``,
        { parse_mode: 'Markdown', ...devMainKeyboard() }
      );
    } catch {}
  });

  // ── /gban — حظر عالمي ───────────────────────────────────────
  bot.command('gban', async (ctx) => {
    if (!isDeveloper(ctx)) return;
    const args   = ctx.message.text.split(' ');
    const uid    = Number(args[1]);
    const reason = args.slice(2).join(' ') || 'حظر عالمي';
    if (!uid) return ctx.reply('❌ مثال: /gban [user_id] [سبب]');
    const u = db.getOrCreateUser(uid, '', '');
    u.globalBanned = true;
    u.bannedReason = reason;
    u.bannedAt     = new Date();
    // طرد من جميع المجموعات
    let count = 0;
    for (const g of db.allGroups()) {
      try { await bot.telegram.banChatMember(g.chatId, uid); count++; } catch {}
    }
    await ctx.replyWithMarkdown(`🚫 *حظر عالمي*\n🆔 \`${uid}\`\n📝 ${reason}\n👢 طُرد من \`${count}\` مجموعة`);
  });

  // ── /gunban — رفع حظر عالمي ─────────────────────────────────
  bot.command('gunban', async (ctx) => {
    if (!isDeveloper(ctx)) return;
    const uid = Number(ctx.message.text.split(' ')[1]);
    if (!uid) return ctx.reply('❌ مثال: /gunban [user_id]');
    const u = db.getUser(uid);
    if (!u) return ctx.reply('❌ المستخدم غير موجود في قاعدة البيانات');
    u.globalBanned = false;
    u.bannedReason = '';
    u.bannedAt     = null;
    await ctx.replyWithMarkdown(`✅ *رُفع الحظر العالمي*\n🆔 \`${uid}\``);
  });

  // ── /grp_bcast — بث لمجموعة محددة ──────────────────────────
  bot.action(/^dev_grp_bcast_(-?\d+)$/, async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId);
    await ctx.editMessageText(
      `📢 *بث رسالة لـ ${g?.title || chatId}*\n\nأرسل نص الرسالة:`,
      { parse_mode: 'Markdown', ...back(`dev_grp_${chatId}`) }
    );
  });
};
