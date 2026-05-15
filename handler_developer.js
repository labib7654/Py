// handler_developer.js — لوحة تحكم المطور — جامعة v5.0
const { Markup }    = require('telegraf');
const db            = require('./db');
const supa          = require('./supabase');
const { isDeveloper } = require('./helpers');
const { groupSettingsKeyboard } = require('./handler_owner');

function back(cb) { return Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', cb)]]); }

function devMainKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📦 المجموعات',          'dev_groups'),      Markup.button.callback('📢 القنوات',        'dev_channels')],
    [Markup.button.callback('🌐 المجتمعات',           'dev_communities'), Markup.button.callback('👤 المستخدمون',     'dev_bot_users')],
    [Markup.button.callback('📊 إحصائيات الاستخدام', 'dev_usage'),       Markup.button.callback('🔍 بحث مستخدم',    'dev_user_search')],
    [Markup.button.callback('📣 بث رسالة',           'dev_broadcast'),   Markup.button.callback('🚫 حظر عالمي',     'dev_ban_menu')],
    [Markup.button.callback('✅ رفع حظر عالمي',      'dev_unban_menu'),  Markup.button.callback('📋 المحظورون',     'dev_banned_list')],
    [Markup.button.callback('💾 نسخ احتياطي',         'dev_backup'),      Markup.button.callback('🔄 مزامنة',        'dev_sync')],
  ]);
}

module.exports = function setupDeveloperHandlers(bot) {

  // ── /start ────────────────────────────────────────────────────────────
  bot.command('start', async (ctx) => {
    const from = ctx.from;
    await db.getOrCreateUser(from.id, from.username || '', from.first_name || '');

    if (ctx.chat.type === 'private' && isDeveloper(ctx)) {
      const s = await db.getStats();
      return ctx.replyWithMarkdown(
        `🤖 *بوت إدارة المجموعات — جامعة v5.0*\n\n🔐 *لوحة التحكم السرية للمطور*\n\n` +
        `📊 *الإحصائيات:*\n• المجموعات: \`${s.totalGroups}\`\n• القنوات: \`${s.totalChannels}\`\n` +
        `• المستخدمون: \`${s.totalUsers}\`\n• المحظورون: \`${s.bannedUsers}\`\n• التحذيرات: \`${s.totalWarns}\``,
        devMainKeyboard()
      );
    }

    // فحص start param للوحة التحكم الخاصة
    const param = ctx.message.text.split(' ')[1];
    if (param?.startsWith('panel_') && ctx.chat.type === 'private') {
      const chatId = Number(param.replace('panel_', ''));
      if (!chatId) return;
      const g = await db.getGroup(chatId);
      if (!g) return ctx.reply('❌ المجموعة غير موجودة!');
      const canAccess = isDeveloper(ctx) || g.ownerId === from.id || g.admins.has(from.id);
      if (!canAccess) return ctx.reply('❌ ليس لديك صلاحية!');
      return ctx.replyWithMarkdown(
        `🔐 *لوحة تحكم ${g.title}*\n\nاضغط أدناه للتحكم:`,
        groupSettingsKeyboard(chatId, g)
      );
    }

    if (ctx.chat.type === 'private') {
      await ctx.replyWithMarkdown(
        `👋 مرحباً ${from.first_name}!\n\n` +
        `🤖 أنا *جامعة v5.0* — بوت إدارة متكامل!\n\n` +
        `📌 أضفني لمجموعتك واجعلني مشرفاً للبدء.\n` +
        `\n*المميزات:*\n• ✅ إدارة كاملة للمجموعات\n• 🔒 حماية من الروابط والسبام\n• ⚠️ نظام تحذيرات ذكي\n• 👨‍💼 نظام المتخصصين\n• 🎯 توجيه تلقائي\n• 🧩 CAPTCHA للأعضاء الجدد\n• 🏆 لوحة صدارة`
      );
    }
  });

  // ── /dev ─────────────────────────────────────────────────────────────
  bot.command('dev', async (ctx) => {
    if (!isDeveloper(ctx)) return;
    const s = await db.getStats();
    await ctx.replyWithMarkdown(
      `🤖 *جامعة v5.0 — لوحة المطور*\n\n` +
      `📊 المجموعات: \`${s.totalGroups}\` | القنوات: \`${s.totalChannels}\`\n` +
      `👤 المستخدمون: \`${s.totalUsers}\` | المحظورون: \`${s.bannedUsers}\``,
      devMainKeyboard()
    );
  });

  // ── dev_groups ───────────────────────────────────────────────────────
  bot.action('dev_groups', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const groups = db.allGroups();
    if (!groups.length) return ctx.editMessageText('📦 *لا توجد مجموعات.*', { parse_mode: 'Markdown', ...back('dev_back') });
    let text = `📦 *المجموعات* (${groups.length})\n\n`;
    const btns = groups.slice(0, 15).map(g => {
      const chatId = g.chatId || g.chat_id;
      text += `• *${g.title}* \`[${chatId}]\` — ${g.members?.size || 0} عضو\n`;
      return [Markup.button.callback(`📋 ${g.title.slice(0, 20)}`, `dev_grp_${chatId}`)];
    });
    btns.push([Markup.button.callback('🔙 رجوع', 'dev_back')]);
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) });
  });

  // dev_grp_CHATID
  bot.action(/^dev_grp_(-?\d+)$/, async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g      = await db.getGroup(chatId);
    if (!g) return ctx.answerCbQuery('❌ غير موجودة!', { show_alert: true });
    const warns   = [...(g.warns?.values() || [])].reduce((a, w) => a + w.length, 0);
    const pending = [...(g.joinRequests?.values() || [])].filter(r => r.status === 'pending').length;
    const specialists = await supa.getSpecialists(chatId);
    const text =
      `📦 *${g.title}*\n\n` +
      `🆔 \`${chatId}\`\n` +
      `👑 المالك: \`${g.ownerId || g.owner_id || '—'}\`\n` +
      `👥 الأعضاء: \`${g.members?.size || 0}\`\n` +
      `👮 المشرفون: \`${g.admins?.size || 0}\`\n` +
      `⚠️ التحذيرات: \`${warns}\`\n` +
      `🔇 المكتومون: \`${g.mutedUsers?.size || 0}\`\n` +
      `🚫 المحظورون: \`${g.bannedUsers?.size || 0}\`\n` +
      `📨 طلبات معلقة: \`${pending}\`\n` +
      `🔤 كلمات محظورة: \`${g.bannedWords?.length || 0}\`\n` +
      `👨‍💼 المتخصصون: \`${specialists.length}\`\n` +
      `📅 أُضيف: ${g.addedAt ? new Date(g.addedAt).toLocaleDateString('ar') : '—'}`;
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('👥 الأعضاء', `dev_members_${chatId}`),   Markup.button.callback('⚠️ المحذَّرون',  `dev_warned_${chatId}`)],
        [Markup.button.callback('🔇 المكتومون', `dev_muted_${chatId}`),    Markup.button.callback('🚫 المحظورون',  `dev_banned_grp_${chatId}`)],
        [Markup.button.callback('📨 طلبات الانضمام', `dev_joinreqs_${chatId}`), Markup.button.callback('📢 بث',`dev_grp_bcast_${chatId}`)],
        [Markup.button.callback('⚙️ الإعدادات', `settings_${chatId}`)],
        [Markup.button.callback('🔙 رجوع', 'dev_groups')],
      ]),
    });
  });

  bot.action(/^dev_members_(-?\d+)$/, async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = await db.getGroup(chatId);
    if (!g) return ctx.answerCbQuery('❌ غير موجودة!', { show_alert: true });
    let adminIds = new Set(), ownerLine = '', adminLines = [];
    try {
      const list = await bot.telegram.getChatAdministrators(chatId);
      for (const a of list) {
        if (a.user.is_bot) continue;
        adminIds.add(a.user.id);
        const name = a.user.username ? `@${a.user.username}` : a.user.first_name;
        if (a.status === 'creator') ownerLine = `👑 المالك: ${name} \`[${a.user.id}]\``;
        else adminLines.push(`👮 ${name} \`[${a.user.id}]\``);
      }
    } catch {}
    const members = [...(g.members?.values() || [])].filter(m => !adminIds.has(m.userId) && m.userId !== g.ownerId);
    let text = `👥 *أعضاء ${g.title}*\n\n`;
    if (ownerLine) text += `${ownerLine}\n\n`;
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
    const g = await db.getGroup(chatId);
    if (!g) return ctx.answerCbQuery('❌ غير موجودة!', { show_alert: true });
    const warned = [...(g.warns?.entries() || [])].filter(([, w]) => w.length > 0);
    if (!warned.length) return ctx.answerCbQuery('✅ لا يوجد محذَّرون', { show_alert: true });
    let text = `⚠️ *المحذَّرون في ${g.title}*\n\n`;
    warned.forEach(([uid, ws]) => {
      const m = g.members?.get(uid);
      text += `• ${m?.username ? `@${m.username}` : m?.firstName || uid} — \`${ws.length}/${g.maxWarns}\`\n`;
    });
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...back(`dev_grp_${chatId}`) });
  });

  bot.action(/^dev_muted_(-?\d+)$/, async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = await db.getGroup(chatId);
    if (!g || !g.mutedUsers?.size) return ctx.answerCbQuery('✅ لا يوجد مكتومون', { show_alert: true });
    let text = `🔇 *المكتومون في ${g.title}*\n\n`;
    [...g.mutedUsers].forEach(uid => {
      const m = g.members?.get(uid);
      text += `• ${m?.username ? `@${m.username}` : m?.firstName || uid} \`[${uid}]\`\n`;
    });
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...back(`dev_grp_${chatId}`) });
  });

  bot.action(/^dev_banned_grp_(-?\d+)$/, async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = await db.getGroup(chatId);
    if (!g || !g.bannedUsers?.size) return ctx.answerCbQuery('✅ لا يوجد محظورون', { show_alert: true });
    let text = `🚫 *المحظورون في ${g.title}*\n\n`;
    [...g.bannedUsers].forEach(uid => {
      const m = g.members?.get(uid);
      text += `• ${m?.username ? `@${m.username}` : m?.firstName || uid} \`[${uid}]\`\n`;
    });
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...back(`dev_grp_${chatId}`) });
  });

  bot.action(/^dev_joinreqs_(-?\d+)$/, async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const pending = await supa.getPendingRequests(chatId);
    if (!pending.length) return ctx.answerCbQuery('✅ لا توجد طلبات معلقة', { show_alert: true });
    let text = `📨 *طلبات الانضمام* (${pending.length})\n\n`;
    const btns = pending.slice(0, 5).flatMap(r => {
      text += `• ${r.first_name}${r.username ? ` (@${r.username})` : ''} \`[${r.user_id}]\`\n`;
      return [[
        Markup.button.callback(`✅ ${r.first_name.slice(0, 12)}`, `jr_approve_${r.user_id}_${chatId}`),
        Markup.button.callback('❌', `jr_reject_${r.user_id}_${chatId}`),
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
    channels.slice(0, 15).forEach(c => { text += `• *${c.title}* \`[${c.chatId || c.chat_id}]\` — ${c.subscribers?.size || 0} مشترك\n`; });
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...back('dev_back') });
  });

  // ── dev_communities ──────────────────────────────────────────
  bot.action('dev_communities', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const coms = db.allCommunities();
    if (!coms.length) return ctx.editMessageText('🌐 *لا توجد مجتمعات.*', { parse_mode: 'Markdown', ...back('dev_back') });
    let text = `🌐 *المجتمعات* (${coms.length})\n\n`;
    coms.forEach(c => { text += `• *${c.title}* — الحد: \`${c.maxGroupJoins}\` | ${c.enabled ? '✅' : '❌'}\n`; });
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...back('dev_back') });
  });

  // ── dev_bot_users ─────────────────────────────────────────────
  bot.action('dev_bot_users', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const s = await supa.getStats();
    let text = `👤 *مستخدمو البوت*\n\n`;
    text += `📊 إجمالي المستخدمين: \`${s.totalUsers}\`\n`;
    text += `📦 المجموعات: \`${s.totalGroups}\`\n`;
    text += `🚫 المحظورون عالمياً: \`${s.bannedUsers}\`\n`;
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...back('dev_back') });
  });

  // ── dev_usage ─────────────────────────────────────────────────
  bot.action('dev_usage', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const s = await supa.getStats();
    const groups = db.allGroups();
    const totalMsg   = groups.reduce((a, g) => a + [...(g.members?.values() || [])].reduce((b, m) => b + (m.messageCount || 0), 0), 0);
    const totalWarns = groups.reduce((a, g) => a + [...(g.warns?.values() || [])].reduce((b, w) => b + w.length, 0), 0);
    const text =
      `📈 *إحصائيات استخدام البوت*\n\n` +
      `👥 المجموعات: \`${s.totalGroups}\`\n` +
      `📢 القنوات: \`${s.totalChannels}\`\n` +
      `👤 المستخدمون: \`${s.totalUsers}\`\n` +
      `💬 الرسائل المرصودة (كاش): \`${totalMsg}\`\n` +
      `⚠️ التحذيرات (كاش): \`${totalWarns}\`\n` +
      `🚫 الحظر العالمي: \`${s.bannedUsers}\``;
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...back('dev_back') });
  });

  bot.action('dev_user_search', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    await ctx.editMessageText(`🔍 *بحث مستخدم*\n\nأرسل معرف التيليغرام أو @username:`, { parse_mode: 'Markdown', ...back('dev_back') });
  });

  bot.action('dev_broadcast', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const groups = db.allGroups();
    await ctx.editMessageText(`📣 *بث رسالة*\n\nأرسل الرسالة لبثّها لجميع المجموعات (${groups.length} مجموعة):`, { parse_mode: 'Markdown', ...back('dev_back') });
  });

  bot.action('dev_ban_menu', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    await ctx.editMessageText(`🚫 *حظر عالمي*\n\nأرسل معرف المستخدم أو @username:`, { parse_mode: 'Markdown', ...back('dev_back') });
  });

  bot.action('dev_unban_menu', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    await ctx.editMessageText(`✅ *رفع حظر عالمي*\n\nأرسل معرف المستخدم:`, { parse_mode: 'Markdown', ...back('dev_back') });
  });

  bot.action('dev_banned_list', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const banned = await supa.getGlobalBannedUsers();
    if (!banned.length) return ctx.editMessageText('✅ *لا يوجد محظورون عالمياً.*', { parse_mode: 'Markdown', ...back('dev_back') });
    let text = `🚫 *المحظورون عالمياً* (${banned.length})\n\n`;
    banned.slice(0, 20).forEach(u => {
      text += `• ${u.username ? `@${u.username}` : u.first_name} \`[${u.user_id}]\`\n  📝 ${u.banned_reason || '—'}\n`;
    });
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...back('dev_back') });
  });

  // ── 🆕 نسخ احتياطي من Supabase ─────────────────────────────────
  bot.action('dev_backup', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery('📦 جاري إنشاء النسخة الاحتياطية...', { show_alert: true });
    await performBackup(bot, ctx.from.id);
  });

  // /backup command
  bot.command('backup', async (ctx) => {
    if (!isDeveloper(ctx)) return;
    await ctx.reply('📦 جاري إنشاء النسخة الاحتياطية من Supabase...');
    await performBackup(bot, ctx.from.id);
  });

  async function performBackup(bot, devId) {
    try {
      const [groups, users, warns, specialists, keywords, auditLog] = await Promise.all([
        supa.getAllGroups(),
        supa.getAllUsers(),
        supa.supabase.from('warns').select('*').then(r => r.data || []),
        supa.supabase.from('specialists').select('*').then(r => r.data || []),
        supa.supabase.from('routing_keywords').select('*').then(r => r.data || []),
        supa.supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(500).then(r => r.data || []),
      ]);
      const backup = {
        generated_at: new Date().toISOString(),
        version: '5.0',
        stats: {
          groups:      groups.length,
          users:       users.length,
          warns:       warns.length,
          specialists: specialists.length,
          keywords:    keywords.length,
          auditLog:    auditLog.length,
        },
        data: { groups, users, warns, specialists, keywords, auditLog: auditLog.slice(0, 100) },
      };
      const json = JSON.stringify(backup, null, 2);
      const filename = `backup_jamea_v5_${new Date().toISOString().replace(/:/g, '-').slice(0, 19)}.json`;
      const buf = Buffer.from(json, 'utf8');
      await bot.telegram.sendDocument(devId, {
        source: buf,
        filename,
      }, {
        caption: `💾 *نسخة احتياطية — جامعة v5.0*\n\n📊 ${groups.length} مجموعة | ${users.length} مستخدم | ${warns.length} تحذير\n👨‍💼 ${specialists.length} متخصص | 🔑 ${keywords.length} كلمة توجيه\n📅 ${new Date().toLocaleString('ar')}`,
        parse_mode: 'Markdown',
      });
    } catch (e) {
      console.error('backup error:', e.message);
      await bot.telegram.sendMessage(devId, `❌ فشل إنشاء النسخة الاحتياطية: ${e.message}`);
    }
  }

  // ── 🆕 مزامنة ─────────────────────────────────────────────────
  bot.action('dev_sync', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery('🔄 جاري إعادة تحميل البيانات من Supabase...', { show_alert: true });
    await db.loadData();
    await ctx.answerCbQuery('✅ تم التزامن!', { show_alert: true });
  });

  // ── dev_back ─────────────────────────────────────────────────────
  bot.action('dev_back', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const s = await db.getStats();
    try {
      await ctx.editMessageText(
        `🤖 *بوت إدارة المجموعات — جامعة v5.0*\n\n🔐 *لوحة التحكم السرية للمطور*\n\n` +
        `📊 *الإحصائيات:*\n• المجموعات: \`${s.totalGroups}\`\n• القنوات: \`${s.totalChannels}\`\n` +
        `• المستخدمون: \`${s.totalUsers}\`\n• المحظورون: \`${s.bannedUsers}\``,
        { parse_mode: 'Markdown', ...devMainKeyboard() }
      );
    } catch {}
  });

  // ── /gban — حظر عالمي ──────────────────────────────────────────
  bot.command('gban', async (ctx) => {
    if (!isDeveloper(ctx)) return;
    const args   = ctx.message.text.split(' ');
    const uid    = Number(args[1]);
    const reason = args.slice(2).join(' ') || 'حظر عالمي';
    if (!uid) return ctx.reply('❌ مثال: /gban [user_id] [سبب]');
    // تحديث قاعدة البيانات
    await supa.setGlobalBan(uid, true, reason);
    const u = db.getUser(uid);
    if (u) { u.globalBanned = true; u.bannedReason = reason; u.bannedAt = new Date(); }
    // طرد من جميع المجموعات
    let count = 0;
    for (const g of db.allGroups()) {
      const chatId = g.chatId || g.chat_id;
      try { await bot.telegram.banChatMember(chatId, uid); count++; } catch {}
    }
    await ctx.replyWithMarkdown(`🚫 *حظر عالمي*\n🆔 \`${uid}\`\n📝 ${reason}\n👢 طُرد من \`${count}\` مجموعة`);
  });

  // ── /gunban — رفع حظر عالمي ─────────────────────────────────────
  bot.command('gunban', async (ctx) => {
    if (!isDeveloper(ctx)) return;
    const uid = Number(ctx.message.text.split(' ')[1]);
    if (!uid) return ctx.reply('❌ مثال: /gunban [user_id]');
    await supa.setGlobalBan(uid, false, '');
    const u = db.getUser(uid);
    if (u) { u.globalBanned = false; u.bannedReason = ''; u.bannedAt = null; }
    await ctx.replyWithMarkdown(`✅ *رُفع الحظر العالمي*\n🆔 \`${uid}\``);
  });

  // ── dev_grp_bcast ──────────────────────────────────────────────
  bot.action(/^dev_grp_bcast_(-?\d+)$/, async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = await db.getGroup(chatId);
    await ctx.editMessageText(
      `📢 *بث رسالة لـ ${g?.title || chatId}*\n\nأرسل نص الرسالة:`,
      { parse_mode: 'Markdown', ...back(`dev_grp_${chatId}`) }
    );
  });

  // ── معالج الرسائل في الخاص للمطور (broadcast / search / ban) ─
  bot.on('message', async (ctx, next) => {
    if (ctx.chat?.type !== 'private' || !isDeveloper(ctx)) return next();
    if (!ctx.message?.text) return next();
    const text = ctx.message.text;
    if (text.startsWith('/')) return next();

    // broadcast لجميع المجموعات
    if (text.startsWith('bcast:')) {
      const msg    = text.slice(6).trim();
      const groups = db.allGroups();
      let sent = 0, failed = 0;
      const progress = await ctx.reply(`📣 جاري الإرسال لـ ${groups.length} مجموعة...`);
      for (const g of groups) {
        const chatId = g.chatId || g.chat_id;
        try { await bot.telegram.sendMessage(chatId, msg, { parse_mode: 'Markdown' }); sent++; } catch { failed++; }
        await new Promise(r => setTimeout(r, 50));
      }
      try { await bot.telegram.editMessageText(ctx.chat.id, progress.message_id, null, `📣 *تم الإرسال*\n✅ نجح: \`${sent}\`\n❌ فشل: \`${failed}\``, { parse_mode: 'Markdown' }); } catch {}
      return;
    }

    return next();
  });
};
