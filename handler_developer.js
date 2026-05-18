const { Markup } = require('telegraf');
const db = require('./db');
const { DEVELOPER_ID } = require('./config');
const {
  isDeveloper, isDeveloperOrBotAdmin, isAdmin, isOwner,
  promoteUser, demoteUser,
  muteMember, unmutePerms,
  logAction,
} = require('./helpers');

// ═══════════════════════════════════════════════════════════════
//  لوحة المطور الرئيسية (مع زر مشرفي البوت)
// ═══════════════════════════════════════════════════════════════
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
    [Markup.button.callback('👥 مشرفي البوت',     'ba_panel'),
     Markup.button.callback('📋 المحظورون',       'dev_banned_list')],
    [Markup.button.callback('✅ رفع حظر عالمي',  'dev_unban_menu'),
     Markup.button.callback('👤 مستخدمو البوت',  'dev_bot_users')],
    [Markup.button.callback('📈 استخدام البوت',  'dev_usage'),
     Markup.button.callback('🛡️ حماية المحتوى', 'dev_protect_menu')],
    [Markup.button.callback('🎲 الإضافة العشوائية', 'adder_start')],
  ]);
}

function back(cb) { return Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', cb)]]); }

function memberActionsKeyboard(targetId, chatId, backCb) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📋 تفاصيل كاملة', `dev_profile_${targetId}_${chatId}_0`)],
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

    const payload = ctx.startPayload || '';
    if (payload.startsWith('panel_')) {
      const chatId = Number(payload.replace('panel_', ''));
      const g = db.getGroup(chatId);
      if (g) {
        const canAccess = isDeveloperOrBotAdmin(ctx) || g.ownerId === u.id || g.admins.has(u.id);
        if (canAccess) {
          return ctx.replyWithMarkdown(
            `⚙️ *إعدادات ${g.title}*\n\nاضغط لفتح لوحة التحكم:`,
            Markup.inlineKeyboard([[Markup.button.callback(`⚙️ الإعدادات`, `owner_panel_${chatId}`)]])
          );
        }
      }
    }

    // ── رابط التحقق الجامعي: /start verify_{chatId}
    if (payload.startsWith('verify_')) {
      const { sessions, getVerifySettings, stepWelcome } = require('./verify_helpers');
      const chatId = Number(payload.replace('verify_', ''));
      const g      = db.getGroup(chatId);
      if (!g) return ctx.reply('❌ المجموعة غير موجودة.');

      const vs = getVerifySettings(g);
      if (!vs.enabled) return ctx.reply('⚠️ نظام التحقق غير مفعّل حالياً.');

      // معتمد مسبقاً
      if (vs.approvedMembers.has(u.id)) {
        // إذا كان عضواً قديماً → ارفع تقييده
        try {
          await bot.telegram.restrictChatMember(chatId, u.id, {
            permissions: {
              can_send_messages: true, can_send_audios: true,
              can_send_documents: true, can_send_photos: true,
              can_send_videos: true, can_send_video_notes: true,
              can_send_voice_notes: true, can_send_polls: true,
              can_send_other_messages: true, can_add_web_page_previews: true,
            },
          });
        } catch {}
        return ctx.reply('✅ أنت معتمد بالفعل! يمكنك المشاركة في المجموعة.');
      }

      // طلب معلق
      if (vs.pendingRequests.get(u.id)?.status === 'pending')
        return ctx.reply('📨 لديك طلب قيد المراجعة. انتظر حتى يراجعه المشرف.');

      // cooldown
      const cd = vs.cooldowns.get(u.id);
      if (cd && cd > Date.now()) {
        const hrs = Math.ceil((cd - Date.now()) / 3600000);
        return ctx.reply(`⏳ يمكنك إعادة المحاولة بعد ${hrs} ساعة.`);
      }

      // تسجيل في joinRequests إن لم يكن موجوداً (للأعضاء القدامى)
      if (!g.joinRequests) g.joinRequests = new Map();
      if (!g.joinRequests.has(u.id)) {
        let isMember = false;
        try {
          const cm = await bot.telegram.getChatMember(chatId, u.id);
          isMember = ['member', 'restricted'].includes(cm.status);
        } catch {}
        g.joinRequests.set(u.id, {
          userId:           u.id,
          username:         u.username || '',
          firstName:        u.first_name || String(u.id),
          status:           'pending_verify',
          requestedAt:      new Date(),
          isExistingMember: isMember,
        });
        db.markDirty();
      }

      // بدء جلسة تسجيل جديدة من الخطوة الأولى
      sessions.set(u.id, { step: 'type_select', chatId, data: {} });
      return stepWelcome(bot, u.id, g.title);
    }
    if (isDeveloperOrBotAdmin(ctx)) {
      const s = db.getStats();
      return ctx.replyWithMarkdown(
        `🤖 *بوت إدارة المجموعات — جامعة v4.0*\n\n🔐 *لوحة التحكم السرية للمطور*\n\n` +
        `📊 *الإحصائيات:*\n• المجموعات: \`${s.totalGroups}\`\n• القنوات: \`${s.totalChannels}\`\n` +
        `• المستخدمون: \`${s.totalUsers}\`\n• المحظورون: \`${s.bannedUsers}\`\n` +
        `• المشرفون: \`${s.totalAdmins}\`\n• الطلبات المعلقة: \`${s.pendingReqs}\``,
        devMainKeyboard()
      );
    }

    // ── قائمة المجموعات مصنّفة حسب النوع ──────────────────────
    const userGroups = db.getUserGroups(u.id);
    if (userGroups.length > 0) {
      // تصنيف كل مسجل حسب نوعه
      const classified = userGroups.map(chatId => {
        const g = db.getGroup(chatId);
        if (!g) return null;
        let icon, typeLabel, panelAction;
        if (g.type === 'channel') {
          icon = '📢'; typeLabel = 'قناة'; panelAction = `channel_panel_${chatId}`;
        } else if (g.communityId || g.type === 'forum' || g.topics?.size > 0) {
          icon = '🎓'; typeLabel = 'مجتمع/فورم'; panelAction = `community_panel_${chatId}`;
        } else if (g.type === 'supergroup') {
          icon = '👥'; typeLabel = 'سوبر قروب'; panelAction = `owner_panel_${chatId}`;
        } else {
          icon = '💬'; typeLabel = 'مجموعة'; panelAction = `owner_panel_${chatId}`;
        }
        return { chatId, g, icon, typeLabel, panelAction };
      }).filter(Boolean);

      // تجميع حسب النوع
      const channels   = classified.filter(x => x.typeLabel === 'قناة');
      const forums     = classified.filter(x => x.typeLabel === 'مجتمع/فورم');
      const supergroups = classified.filter(x => x.typeLabel === 'سوبر قروب');
      const groups_    = classified.filter(x => x.typeLabel === 'مجموعة');

      const btns = [];

      // عنوان لكل قسم
      const addSection = (label, items) => {
        if (!items.length) return;
        items.slice(0, 6).forEach(({ g, icon, panelAction }) => {
          const members = g.members?.size || 0;
          btns.push([Markup.button.callback(
            `${icon} ${(g.title || '').slice(0, 22)} (${members})`,
            panelAction
          )]);
        });
      };

      // ترتيب: مجتمعات → سوبر قروبات → مجموعات → قنوات
      if (forums.length)      btns.push([Markup.button.callback(`── 🎓 المجتمعات (${forums.length}) ──`, 'noop')]);
      addSection('مجتمع', forums);
      if (supergroups.length) btns.push([Markup.button.callback(`── 👥 السوبر قروبات (${supergroups.length}) ──`, 'noop')]);
      addSection('سوبر قروب', supergroups);
      if (groups_.length)     btns.push([Markup.button.callback(`── 💬 المجموعات (${groups_.length}) ──`, 'noop')]);
      addSection('مجموعة', groups_);
      if (channels.length)    btns.push([Markup.button.callback(`── 📢 القنوات (${channels.length}) ──`, 'noop')]);
      addSection('قناة', channels);

      btns.push([Markup.button.callback('🔄 فحص وتصنيف تلقائي', 'auto_classify_chats')]);
      btns.push([Markup.button.callback('ℹ️ مساعدة وأوامر', 'help_menu')]);

      const summary = [
        forums.length      ? `🎓 ${forums.length} مجتمع` : null,
        supergroups.length ? `👥 ${supergroups.length} سوبر قروب` : null,
        groups_.length     ? `💬 ${groups_.length} مجموعة` : null,
        channels.length    ? `📢 ${channels.length} قناة` : null,
      ].filter(Boolean).join(' • ');

      return ctx.replyWithMarkdown(
        `👑 *مرحباً ${u.first_name}!*\n\n` +
        `📊 ${summary}\n\n` +
        `اختر لفتح لوحة التحكم المناسبة:`,
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
      `\`/ban\` — حظر | \`/kick\` — طرد | \`/mute\` — كتم | \`/unmute\` — رفع كتم\n` +
      `\`/warn\` — تحذير | \`/warns\` — عرض تحذيرات | \`/manage\` — لوحة عضو\n\n` +
      `*إعدادات المجموعة:*\n` +
      `\`/settings\` — الإعدادات | \`/mybot\` — لوحة التحكم بالخاص\n` +
      `\`/setwelcome\` — رسالة ترحيب | \`/setrules\` — القواعد\n` +
      `\`/addword\` — كلمة محظورة | \`/joinreqs\` — طلبات الانضمام\n\n` +
      `*المواضيع:*\n` +
      `\`/locktopic\` — قفل موضوع | \`/unlocktopic\` — فتح موضوع\n` +
      `\`/archivetopic\` — أرشفة | \`/topicrequest on|off\` — طلبات الدخول\n\n` +
      `*معلومات:*\n` +
      `\`/top\` — أنشط الأعضاء | \`/myscore\` — نقاطي\n` +
      `\`/id\` — معرف الشات | \`/ping\` — سرعة الاستجابة`,
      { parse_mode: 'Markdown', ...back('cancel') }
    );
  });

  // ── /dev ─────────────────────────────────────────────────────
  bot.command('dev', async (ctx) => {
    if (!isDeveloperOrBotAdmin(ctx)) return;
    const s = db.getStats();
    await ctx.replyWithMarkdown(
      `🔐 *لوحة تحكم المطور*\n\n📊 المجموعات: \`${s.totalGroups}\` | القنوات: \`${s.totalChannels}\`\n👤 ${s.totalUsers} مستخدم | 🚫 ${s.bannedUsers} محظور`,
      devMainKeyboard()
    );
  });

  // ── dev_stats ────────────────────────────────────────────────
  bot.action('dev_stats', async (ctx) => {
    if (!isDeveloperOrBotAdmin(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const s = db.getStats();
    const totalWords = db.allGroups().reduce((a, g) => a + g.bannedWords.length, 0);
    await ctx.editMessageText(
      `📊 *إحصائيات مفصّلة*\n\n👥 المجموعات: \`${s.totalGroups}\`\n📢 القنوات: \`${s.totalChannels}\`\n🌐 المجتمعات: \`${db.allCommunities().length}\`\n👤 المستخدمون: \`${s.totalUsers}\`\n🚫 محظورون: \`${s.bannedUsers}\`\n👮 المشرفون: \`${s.totalAdmins}\`\n⚠️ التحذيرات: \`${s.totalWarns}\`\n🔤 الكلمات: \`${totalWords}\`\n📨 طلبات معلقة: \`${s.pendingReqs}\``,
      { parse_mode: 'Markdown', ...back('dev_back') }
    );
  });

  // ── dev_groups (مع Pagination) ───────────────────────────────
  bot.action(/^dev_groups(_(\d+))?$/, async (ctx) => {
    if (!isDeveloperOrBotAdmin(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const page      = Number(ctx.match[2] || 0);
    const PAGE_SIZE = 8;
    const groups    = db.allGroups();
    if (!groups.length)
      return ctx.editMessageText('👥 *لا توجد مجموعات حتى الآن.*', { parse_mode: 'Markdown', ...back('dev_back') });
    const slice = groups.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    const btns  = slice.map(g => [
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
    if (!isDeveloperOrBotAdmin(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId);
    if (!g) return ctx.answerCbQuery('❌ غير موجودة!', { show_alert: true });
    const warns   = [...g.warns.values()].reduce((a, w) => a + w.length, 0);
    const pending = [...g.joinRequests.values()].filter(r => r.status === 'pending').length;
    await ctx.editMessageText(
      `📋 *${g.title}*\n\n🆔 \`${g.chatId}\`\n👑 المالك: \`${g.ownerUsername || 'غير محدد'}\` ${g.ownerVerified ? '✅' : ''}\n➕ أضافه: \`${g.addedByUsername}\`\n👮 المشرفون: \`${g.admins.size}\`\n👥 الأعضاء: \`${g.members.size}\`\n⚠️ التحذيرات: \`${warns}\`\n🔤 الكلمات: \`${g.bannedWords.length}\`\n📨 طلبات معلقة: \`${pending}\`\n🛡️ حماية المحتوى: ${g.protectContent ? '✅' : '❌'}\n🔗 منع روابط: ${g.antiLinks ? '✅' : '❌'}\n🤖 منع بوتات: ${g.antiBot ? '✅' : '❌'}\n🛡️ مكافحة سبام: ${g.antiSpam ? '✅' : '❌'} | 👋 ترحيب: ${g.welcomeEnabled ? '✅' : '❌'}`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('👥 الأعضاء',        `dev_members_${chatId}`),  Markup.button.callback('⚠️ المحذَّرون',  `dev_warned_${chatId}`)],
          [Markup.button.callback('🔇 المكتومون',       `dev_muted_${chatId}`),   Markup.button.callback('🚫 المحظورون',  `dev_banned_grp_${chatId}`)],
          [Markup.button.callback('📨 طلبات الانضمام', `dev_joinreqs_${chatId}`),Markup.button.callback('📢 بث للمجموعة',`dev_grp_bcast_${chatId}`)],
          [Markup.button.callback('⚙️ الإعدادات',       `settings_${chatId}`)],
          [Markup.button.callback('🔙 رجوع',           'dev_groups')],
        ]),
      }
    );
  });

  // ── noop button (عناوين غير قابلة للضغط) ────────────────────────────
  bot.action('noop', async (ctx) => { await ctx.answerCbQuery(); });

  // ── لوحة التحكم الخاصة بالقنوات ──────────────────────────────────────
  bot.action(/^channel_panel_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId);
    const ch = db.getChannel(chatId);
    const item = g || ch;
    if (!item) return ctx.answerCbQuery('❌ غير موجودة!', { show_alert: true });
    const canAccess = isDeveloperOrBotAdmin(ctx) || item.ownerId === ctx.from.id;
    if (!canAccess) return ctx.answerCbQuery('❌ ليس لديك صلاحية!', { show_alert: true });

    await ctx.editMessageText(
      `📢 *لوحة تحكم القناة*\n\n` +
      `📌 *${item.title}*\n` +
      `🆔 \`${chatId}\`\n` +
      `👑 المالك: \`${item.ownerUsername || 'غير محدد'}\`\n\n` +
      `⚙️ أوامر القناة:`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🛡️ حماية المحتوى', `toggle_protect_${chatId}`)],
          [Markup.button.callback('📊 إحصائيات', `ch_stats_${chatId}`)],
          [Markup.button.callback('📢 بث رسالة', `dev_grp_bcast_${chatId}`)],
          [Markup.button.callback('🔙 رجوع', 'back_to_my_list')],
        ]),
      }
    );
  });

  // ── لوحة التحكم الخاصة بالمجتمعات/الفورم ────────────────────────────
  bot.action(/^community_panel_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId);
    if (!g) return ctx.answerCbQuery('❌ غير موجودة!', { show_alert: true });
    const canAccess = isDeveloperOrBotAdmin(ctx) || g.ownerId === ctx.from.id || g.admins.has(ctx.from.id);
    if (!canAccess) return ctx.answerCbQuery('❌ ليس لديك صلاحية!', { show_alert: true });

    const pending = [...g.joinRequests.values()].filter(r => r.status === 'pending').length;
    const topicsCount = g.topics?.size || 0;

    await ctx.editMessageText(
      `🎓 *لوحة تحكم المجتمع/الفورم*\n\n` +
      `📌 *${g.title}*\n` +
      `🆔 \`${chatId}\`\n` +
      `👑 المالك: \`${g.ownerUsername || 'غير محدد'}\`\n` +
      `👥 الأعضاء: \`${g.members.size}\`\n` +
      `📂 المواضيع: \`${topicsCount}\`\n` +
      `📨 طلبات معلقة: \`${pending}\``,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📂 إدارة المواضيع',    `topics_panel_${chatId}`),
           Markup.button.callback('📨 طلبات الانضمام',   `joinreqs_${chatId}`)],
          [Markup.button.callback(`🔒 موافقة الانضمام`, `toggle_joinreq_${chatId}`),
           Markup.button.callback(`🤖 قبول تلقائي`,     `toggle_autoapprove_${chatId}`)],
          [Markup.button.callback('👥 الأعضاء',          `dev_members_${chatId}`),
           Markup.button.callback('⚙️ إعدادات متقدمة',   `settings_${chatId}`)],
          [Markup.button.callback('🎓 نظام التحقق',      `verify_settings_${chatId}`)],
          [Markup.button.callback('🔙 رجوع', 'back_to_my_list')],
        ]),
      }
    );
  });

  // ── فحص وتصنيف تلقائي لكل المسجلات ──────────────────────────────────
  bot.action('auto_classify_chats', async (ctx) => {
    await ctx.answerCbQuery('🔄 جاري الفحص...');
    const groups = db.allGroups();
    const channels = db.allChannels();
    let updated = 0;

    for (const g of groups) {
      try {
        const chat = await bot.telegram.getChat(g.chatId);
        // تحديث النوع الدقيق
        const newType = chat.is_forum
          ? 'forum'
          : chat.type === 'supergroup'
            ? 'supergroup'
            : chat.type;
        if (g.type !== newType) { g.type = newType; updated++; }
        // تحديث الاسم لو تغيّر
        if (chat.title && chat.title !== g.title) { g.title = chat.title; }
      } catch {}
    }

    for (const ch of channels) {
      try {
        const chat = await bot.telegram.getChat(ch.chatId);
        if (chat.title && chat.title !== ch.title) { ch.title = chat.title; updated++; }
      } catch {}
    }

    db.saveData();
    await ctx.answerCbQuery(`✅ تم الفحص — حُدّث ${updated} مسجل`, { show_alert: true });
    // أعد عرض القائمة المصنّفة
    const u = ctx.from;
    const userGroups = db.getUserGroups(u.id);
    if (!userGroups.length) return ctx.editMessageText('لا توجد مجموعات.');

    const classified = userGroups.map(chatId => {
      const g = db.getGroup(chatId);
      if (!g) return null;
      let icon, typeLabel, panelAction;
      if (g.type === 'channel') { icon = '📢'; typeLabel = 'قناة'; panelAction = `channel_panel_${chatId}`; }
      else if (g.communityId || g.type === 'forum' || g.topics?.size > 0) { icon = '🎓'; typeLabel = 'مجتمع/فورم'; panelAction = `community_panel_${chatId}`; }
      else if (g.type === 'supergroup') { icon = '👥'; typeLabel = 'سوبر قروب'; panelAction = `owner_panel_${chatId}`; }
      else { icon = '💬'; typeLabel = 'مجموعة'; panelAction = `owner_panel_${chatId}`; }
      return { chatId, g, icon, typeLabel, panelAction };
    }).filter(Boolean);

    const btns = [];
    const sections = [
      ['🎓 مجتمع/فورم', '🎓'], ['👥 سوبر قروب', '👥'],
      ['💬 مجموعة', '💬'],     ['📢 قناة', '📢'],
    ];
    for (const [label, icon] of sections) {
      const items = classified.filter(x => x.icon === icon);
      if (!items.length) continue;
      btns.push([Markup.button.callback(`── ${label} (${items.length}) ──`, 'noop')]);
      items.forEach(({ g, panelAction }) => {
        btns.push([Markup.button.callback(`${icon} ${(g.title||'').slice(0,22)} (${g.members?.size||0})`, panelAction)]);
      });
    }
    btns.push([Markup.button.callback('🔄 فحص مجدد', 'auto_classify_chats')]);
    await ctx.editMessageText(
      `👑 *قائمتك المصنّفة — ${classified.length} مسجل*\n✅ تم تحديث ${updated} نوع`,
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) }
    );
  });

  // ── رجوع لقائمة المجموعات الشخصية ───────────────────────────────────
  bot.action('back_to_my_list', async (ctx) => {
    await ctx.answerCbQuery();
    const u = ctx.from;
    const userGroups = db.getUserGroups(u.id);
    if (!userGroups.length) return ctx.editMessageText('لا توجد مجموعات تحت إدارتك.');

    const classified = userGroups.map(chatId => {
      const g = db.getGroup(chatId);
      if (!g) return null;
      let icon, panelAction;
      if (g.type === 'channel')   { icon = '📢'; panelAction = `channel_panel_${chatId}`; }
      else if (g.communityId || g.type === 'forum' || g.topics?.size > 0) { icon = '🎓'; panelAction = `community_panel_${chatId}`; }
      else if (g.type === 'supergroup') { icon = '👥'; panelAction = `owner_panel_${chatId}`; }
      else { icon = '💬'; panelAction = `owner_panel_${chatId}`; }
      return { g, icon, panelAction };
    }).filter(Boolean);

    const btns = [];
    for (const [icon, label] of [['🎓','مجتمع'],['👥','سوبر قروب'],['💬','مجموعة'],['📢','قناة']]) {
      const items = classified.filter(x => x.icon === icon);
      if (!items.length) continue;
      btns.push([Markup.button.callback(`── ${icon} ${label} (${items.length}) ──`, 'noop')]);
      items.forEach(({ g, panelAction }) => {
        btns.push([Markup.button.callback(`${icon} ${(g.title||'').slice(0,22)} (${g.members?.size||0})`, panelAction)]);
      });
    }
    btns.push([Markup.button.callback('🔄 فحص وتصنيف تلقائي', 'auto_classify_chats')]);

    await ctx.editMessageText(
      `👑 *مجموعاتك — ${classified.length} مسجل*`,
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) }
    );
  });

  // ── إحصائيات القناة ──────────────────────────────────────────────────
  bot.action(/^ch_stats_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    try {
      const chat = await bot.telegram.getChat(chatId);
      const count = await bot.telegram.getChatMemberCount(chatId);
      await ctx.editMessageText(
        `📊 *إحصائيات القناة*\n\n📌 ${chat.title}\n👥 المشتركون: \`${count}\`\n🔗 ${chat.username ? `@${chat.username}` : 'خاصة'}`,
        { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', `channel_panel_${chatId}`)]]) }
      );
    } catch (e) {
      await ctx.answerCbQuery('❌ تعذر جلب الإحصائيات: ' + e.message, { show_alert: true });
    }
  });

  // ── إضافة handler في my_chat_member لتحديث النوع تلقائياً عند الإضافة ──

  // ── إحصائيات القناة ──────────────────────────────────────────────────
  // ── إحصائيات القناة ──────────────────────────────────────────────────

  // ── dev_members مع pagination وزر تفاصيل لكل عضو ──────────────
  bot.action(/^dev_members_(-?\d+)(?:_p(\d+))?$/, async (ctx) => {
    if (!isDeveloperOrBotAdmin(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const page   = Number(ctx.match[2] || 0);
    const PAGE   = 6;
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

    const allMembers = [...g.members.values()].filter(m => !adminIds.has(m.userId) && m.userId !== g.ownerId);
    const totalPages = Math.ceil(allMembers.length / PAGE) || 1;
    const slice      = allMembers.slice(page * PAGE, (page + 1) * PAGE);

    let text = `👥 *أعضاء ${g.title}*\n`;
    text += `📊 الإجمالي: \`${allMembers.length}\` عضو | صفحة ${page + 1}/${totalPages}\n\n`;
    if (page === 0) {
      if (ownerLine)         text += `${ownerLine}\n\n`;
      if (adminLines.length) text += `*المشرفون (${adminLines.length}):*\n${adminLines.join('\n')}\n\n`;
    }

    const memberBtns = [];
    if (slice.length > 0) {
      text += `*الأعضاء العاديون:*\n`;
      slice.forEach(m => {
        const name  = m.username ? `@${m.username}` : m.firstName;
        const icons = `${(g.warns.get(m.userId)?.length || 0) > 0 ? '⚠️' : ''}${g.mutedUsers.has(m.userId) ? '🔇' : ''}${g.bannedUsers.has(m.userId) ? '🚫' : ''}`;
        text += `👤 ${name} \`[${m.userId}]\` ${icons} 💬${m.messageCount || 0} ⭐${m.score || 0}\n`;
        memberBtns.push([
          Markup.button.callback(`👤 ${name.slice(0, 16)} ${icons}`, `dev_mact_${m.userId}_${chatId}`),
          Markup.button.callback(`🔍 تفاصيل`, `dev_profile_${m.userId}_${chatId}_${page}`),
        ]);
      });
    } else {
      text += '_لا يوجد أعضاء عاديون_';
    }

    const navBtns = [];
    if (page > 0)              navBtns.push(Markup.button.callback('◀️ السابق', `dev_members_${chatId}_p${page - 1}`));
    if (page + 1 < totalPages) navBtns.push(Markup.button.callback('التالي ▶️', `dev_members_${chatId}_p${page + 1}`));

    const keyboard = [...memberBtns];
    if (navBtns.length) keyboard.push(navBtns);
    keyboard.push([Markup.button.callback('🔙 رجوع', `dev_grp_${chatId}`)]);

    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(keyboard),
    });
  });

  bot.action(/^dev_warned_(-?\d+)$/, async (ctx) => {
    if (!isDeveloperOrBotAdmin(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
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
    if (!isDeveloperOrBotAdmin(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
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
    if (!isDeveloperOrBotAdmin(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
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
    if (!isDeveloperOrBotAdmin(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
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
    btns.push([Markup.button.callback('✅ قبول الكل', `jr_approveall_${chatId}`), Markup.button.callback('❌ رفض الكل', `jr_rejectall_${chatId}`)]);
    btns.push([Markup.button.callback('🔙 رجوع', `dev_grp_${chatId}`)]);
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) });
  });

  bot.action(/^dev_grp_bcast_(-?\d+)$/, async (ctx) => {
    if (!isDeveloperOrBotAdmin(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    await ctx.editMessageText(`📢 *بث للمجموعة*\n\n\`/bcastone ${chatId} نص الرسالة\``, { parse_mode: 'Markdown', ...back(`dev_grp_${chatId}`) });
  });

  bot.action(/^dev_mact_(\d+)_(-?\d+)$/, async (ctx) => {
    if (!isDeveloperOrBotAdmin(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const targetId = Number(ctx.match[1]);
    const chatId   = Number(ctx.match[2]);
    const g    = db.getGroup(chatId);
    const m    = g?.members.get(targetId);
    const name = m ? (m.username ? `@${m.username}` : m.firstName) : String(targetId);
    const warns= g?.warns.get(targetId)?.length || 0;
    const gu   = db.getUser(targetId);
    await ctx.editMessageText(
      `👤 *${name}*\n\n🆔 \`${targetId}\`\n📋 يوزر: ${m?.username ? `@${m.username}` : '—'}\n⚠️ التحذيرات: \`${warns}/${g?.maxWarns || 3}\`\n🔇 مكتوم: ${g?.mutedUsers.has(targetId) ? '✅' : '❌'}\n🚫 محظور محلياً: ${g?.bannedUsers.has(targetId) ? '✅' : '❌'}\n🌍 محظور عالمياً: ${gu?.globalBanned ? `✅ — ${gu.bannedReason}` : '❌'}\n💬 رسائل: \`${m?.messageCount || 0}\`\n⭐ نقاط: \`${m?.score || 0}\`\n📅 انضم: ${m?.joinedAt ? new Date(m.joinedAt).toLocaleString('ar') : '—'}`,
      { parse_mode: 'Markdown', ...memberActionsKeyboard(targetId, chatId, `dev_members_${chatId}`) }
    );
  });

  // ── صفحة التفاصيل الشاملة للعضو ────────────────────────────
  bot.action(/^dev_profile_(\d+)_(-?\d+)_(\d+)$/, async (ctx) => {
    if (!isDeveloperOrBotAdmin(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const targetId = Number(ctx.match[1]);
    const chatId   = Number(ctx.match[2]);
    const backPage = Number(ctx.match[3] || 0);
    const g   = db.getGroup(chatId);
    const m   = g?.members.get(targetId);
    const gu  = db.getUser(targetId);

    const name     = m?.username ? `@${m.username}` : (m?.firstName || gu?.firstName || String(targetId));
    const userId   = targetId;
    const username = m?.username || gu?.username || '';

    // — حالته في هذا القروب
    const warns       = g?.warns.get(userId) || [];
    const isMuted     = g?.mutedUsers.has(userId) || false;
    const isBanned    = g?.bannedUsers.has(userId) || false;
    const timedBan    = g?.timedBans?.get(userId);
    const timedMute   = g?.timedMutes?.get(userId);
    const isGBanned   = gu?.globalBanned || false;
    const isBotAdmin  = db.isBotAdmin(userId);

    // — الكلمات المحظورة التي أرسلها
    const wordVio = g?.wordViolations?.get(userId) || {};
    const wordVioStr = Object.entries(wordVio).length > 0
      ? Object.entries(wordVio).map(([w, c]) => `• "${w}" × ${c}`).join('\n')
      : '_لا يوجد_';

    // — آخر إجراءات من سجل التدقيق
    const auditEntries = (g?.auditLog || [])
      .filter(e => e.target?.id === userId || e.by?.id === userId)
      .slice(0, 5);
    const auditStr = auditEntries.length > 0
      ? auditEntries.map(e => {
          const dt = new Date(e.at).toLocaleString('ar-SA', { dateStyle: 'short', timeStyle: 'short' });
          return `• ${e.action} — ${dt}`;
        }).join('\n')
      : '_لا يوجد سجل_';

    // — كل القروبات التي هو فيها (من db)
    const allGrps = db.allGroups();
    const memberInGroups = allGrps.filter(gr => gr.members?.has(userId));
    const ownerInGroups  = allGrps.filter(gr => gr.ownerId === userId);
    const adminInGroups  = allGrps.filter(gr => gr.admins?.has(userId));

    const grpListStr = memberInGroups.slice(0, 8).map(gr => {
      const mm = gr.members.get(userId);
      const joined = mm?.joinedAt ? new Date(mm.joinedAt).toLocaleDateString('ar-SA') : '—';
      const isOwner = gr.ownerId === userId ? ' 👑' : '';
      const isAdm   = gr.admins?.has(userId) ? ' 👮' : '';
      return `• ${gr.title.slice(0, 22)}${isOwner}${isAdm} — ${joined}`;
    }).join('\n') || '_غير موجود في مجموعات أخرى_';

    let text = '';
    text += `👤 *تفاصيل: ${name}*\n`;
    text += `━━━━━━━━━━━━━━━━\n`;
    text += `🆔 ID: \`${userId}\``;
    if (username) text += ` ← نسخ\n`;
    else text += `\n`;
    text += `📋 يوزر: ${username ? `@${username}` : '_بدون يوزر_'}\n`;
    text += `📛 الاسم: ${m?.firstName || gu?.firstName || '—'}\n`;
    text += `\n*📊 في هذا القروب:*\n`;
    text += `📅 تاريخ الانضمام: ${m?.joinedAt ? new Date(m.joinedAt).toLocaleString('ar-SA', { dateStyle: 'medium', timeStyle: 'medium' }) : '—'}\n`;
    text += `💬 الرسائل: \`${m?.messageCount || 0}\`\n`;
    text += `⭐ النقاط: \`${m?.score || 0}\`\n`;
    text += `⚠️ التحذيرات: \`${warns.length}/${g?.maxWarns || 3}\`\n`;
    text += `🔇 مكتوم: ${isMuted ? `✅${timedMute ? ` (حتى ${new Date(timedMute).toLocaleString('ar-SA', { dateStyle: 'short', timeStyle: 'short' })})` : ''}` : '❌'}\n`;
    text += `🚫 محظور محلياً: ${isBanned ? `✅${timedBan ? ` (حتى ${new Date(timedBan).toLocaleString('ar-SA', { dateStyle: 'short', timeStyle: 'short' })})` : ''}` : '❌'}\n`;
    text += `\n*🌍 حالة عالمية:*\n`;
    text += `🌍 محظور عالمياً: ${isGBanned ? `✅ — ${gu?.bannedReason || ''}` : '❌'}\n`;
    text += `🤖 مشرف بوت: ${isBotAdmin ? '✅' : '❌'}\n`;
    text += `👑 مالك في: \`${ownerInGroups.length}\` قروب | 👮 مشرف في: \`${adminInGroups.length}\`\n`;
    text += `\n*🚫 كلمات محظورة أرسلها:*\n${wordVioStr}\n`;
    text += `\n*📋 آخر إجراءات عليه:*\n${auditStr}\n`;
    text += `\n*👥 القروبات (${memberInGroups.length}):*\n${grpListStr}`;
    if (memberInGroups.length > 8) text += `\n_... و${memberInGroups.length - 8} أخرى_`;

    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('⚙️ إجراءات', `dev_mact_${userId}_${chatId}`)],
        [Markup.button.callback('🔙 رجوع للأعضاء', `dev_members_${chatId}_p${backPage}`)],
      ]),
    });
  });

  // ── dev_channels ─────────────────────────────────────────────
  bot.action('dev_channels', async (ctx) => {
    if (!isDeveloperOrBotAdmin(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const chs = db.allChannels();
    if (!chs.length)
      return ctx.editMessageText('📢 *لا توجد قنوات حتى الآن.*', { parse_mode: 'Markdown', ...back('dev_back') });
    const btns = chs.slice(0, 10).map(c => [Markup.button.callback(`📢 ${c.title.slice(0, 26)}`, `dev_ch_${c.chatId}`)]);
    btns.push([Markup.button.callback('🔙 رجوع', 'dev_back')]);
    await ctx.editMessageText(`📢 *القنوات* (${chs.length})`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) });
  });

  bot.action(/^dev_ch_(-?\d+)$/, async (ctx) => {
    if (!isDeveloperOrBotAdmin(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
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
    if (!isDeveloperOrBotAdmin(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const coms = db.allCommunities();
    if (!coms.length)
      return ctx.editMessageText('🌐 *لا توجد مجتمعات.*\n\n`/community create <معرف> <الاسم>`', { parse_mode: 'Markdown', ...back('dev_back') });
    const btns = coms.map(c => [Markup.button.callback(`🌐 ${c.title.slice(0, 24)} (${c.subGroups.size})`, `dev_com_${c.communityId}`)]);
    btns.push([Markup.button.callback('🔙 رجوع', 'dev_back')]);
    await ctx.editMessageText(`🌐 *المجتمعات* (${coms.length})`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) });
  });

  bot.action(/^dev_com_(-?\d+)$/, async (ctx) => {
    if (!isDeveloperOrBotAdmin(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const c = db.getCommunity(Number(ctx.match[1]));
    if (!c) return ctx.answerCbQuery('❌ غير موجود!', { show_alert: true });
    const subNames = [...c.subGroups].map(id => { const g = db.getGroup(id); return g ? `• ${g.title} \`[${id}]\`` : `• \`${id}\``; }).join('\n') || '_لا توجد مجموعات فرعية_';
    const autoBanned = c.autoBannedUsers?.size || 0;
    await ctx.editMessageText(
      `🌐 *${c.title}*\n\n🆔 \`${c.communityId}\`\n📁 المجموعات:\n${subNames}\n\n⚙️ الحد الأقصى: \`${c.maxGroupJoins}\`\n🛡️ الحماية: ${c.enabled ? '✅' : '❌'}\n🚫 المحظورون تلقائياً: \`${autoBanned}\``,
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
    if (!isDeveloperOrBotAdmin(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    await ctx.editMessageText('📢 *بث جماعي*\n\n`/broadcast نص الرسالة`\n\nيُرسل لكل المجموعات.', { parse_mode: 'Markdown', ...back('dev_back') });
  });

  bot.command('bcastone', async (ctx) => {
    if (!isDeveloperOrBotAdmin(ctx)) return;
    const parts  = ctx.message.text.split(' ');
    const chatId = Number(parts[1]);
    const text   = parts.slice(2).join(' ');
    if (!chatId || !text) return ctx.reply('❌ مثال: /bcastone -100123456 نص');
    try { await bot.telegram.sendMessage(chatId, `📢 *رسالة من المطور*\n\n${text}`, { parse_mode: 'Markdown' }); await ctx.reply('✅ تم!'); }
    catch (e) { await ctx.reply(`❌ ${e.message}`); }
  });

  // ── dev_ban_menu ─────────────────────────────────────────────
  // يعرض قائمة بمستخدمي البوت مع زر "حظر عالمي" لكل شخص غير محظور
  bot.action(/^dev_ban_menu(_(\\d+))?$/, async (ctx) => {
    if (!isDeveloperOrBotAdmin(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const page     = Number(ctx.match?.[2] || 0);
    const PAGE     = 8;
    const allUsers = db.allUsers().filter(u => !u.globalBanned && u.userId > 0);
    if (!allUsers.length)
      return ctx.editMessageText('👤 *لا يوجد مستخدمون متاحون للحظر.*', { parse_mode: 'Markdown', ...back('dev_back') });
    const slice = allUsers.slice(page * PAGE, (page + 1) * PAGE);
    let text = `🚫 *اختر المستخدم للحظر العالمي* (${allUsers.length})\n\n`;
    const btns = slice.map(u => {
      const name = u.username ? `@${u.username}` : (u.firstName || String(u.userId));
      text += `👤 ${name} \`[${u.userId}]\`\n`;
      return [Markup.button.callback(`🚫 ${name.slice(0, 22)}`, `dev_ugban_quick_${u.userId}_${page}`)];
    });
    const nav = [];
    if (page > 0) nav.push(Markup.button.callback('◀️ السابق', `dev_ban_menu_${page - 1}`));
    if ((page + 1) * PAGE < allUsers.length) nav.push(Markup.button.callback('التالي ▶️', `dev_ban_menu_${page + 1}`));
    if (nav.length) btns.push(nav);
    btns.push([Markup.button.callback('🔙 رجوع', 'dev_back')]);
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) });
  });

  // حظر عالمي سريع من قائمة المستخدمين
  bot.action(/^dev_ugban_quick_(\d+)_(\d+)$/, async (ctx) => {
    if (!isDeveloperOrBotAdmin(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    const userId = Number(ctx.match[1]);
    const page   = Number(ctx.match[2]);
    const u      = db.getOrCreateUser(userId, '', '');
    if (u.globalBanned) return ctx.answerCbQuery('⚠️ محظور بالفعل!', { show_alert: true });
    u.globalBanned = true; u.bannedReason = 'حظر من لوحة المطور'; u.bannedAt = new Date();
    db.saveData();
    for (const g of db.allGroups()) { try { await bot.telegram.banChatMember(g.chatId, userId); } catch {} }
    await ctx.answerCbQuery('🚫 تم الحظر العالمي!', { show_alert: true });
    // إعادة تحميل القائمة
    const allUsers = db.allUsers().filter(u2 => !u2.globalBanned && u2.userId > 0);
    if (!allUsers.length)
      return ctx.editMessageText('✅ *تم حظر المستخدم. لا يوجد مزيد.*', { parse_mode: 'Markdown', ...back('dev_back') });
    const PAGE  = 8;
    const pg    = Math.min(page, Math.floor((allUsers.length - 1) / PAGE));
    const slice = allUsers.slice(pg * PAGE, (pg + 1) * PAGE);
    let text2   = `🚫 *اختر المستخدم للحظر العالمي* (${allUsers.length})\n\n`;
    const btns2 = slice.map(u2 => {
      const name = u2.username ? `@${u2.username}` : (u2.firstName || String(u2.userId));
      text2 += `👤 ${name} \`[${u2.userId}]\`\n`;
      return [Markup.button.callback(`🚫 ${name.slice(0, 22)}`, `dev_ugban_quick_${u2.userId}_${pg}`)];
    });
    const nav2 = [];
    if (pg > 0) nav2.push(Markup.button.callback('◀️ السابق', `dev_ban_menu_${pg - 1}`));
    if ((pg + 1) * PAGE < allUsers.length) nav2.push(Markup.button.callback('التالي ▶️', `dev_ban_menu_${pg + 1}`));
    if (nav2.length) btns2.push(nav2);
    btns2.push([Markup.button.callback('🔙 رجوع', 'dev_back')]);
    await ctx.editMessageText(text2, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns2) });
  });

  // ── dev_unban_menu ────────────────────────────────────────────
  // يعرض قائمة بالمحظورين عالمياً مع زر "رفع حظر" لكل شخص
  bot.action(/^dev_unban_menu(_(\\d+))?$/, async (ctx) => {
    if (!isDeveloperOrBotAdmin(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const page   = Number(ctx.match?.[2] || 0);
    const PAGE   = 8;
    const banned = db.allUsers().filter(u => u.globalBanned);
    if (!banned.length)
      return ctx.editMessageText('✅ *لا يوجد محظورون عالمياً حالياً.*', { parse_mode: 'Markdown', ...back('dev_back') });
    const slice = banned.slice(page * PAGE, (page + 1) * PAGE);
    let text = `✅ *اختر المستخدم لرفع الحظر العالمي* (${banned.length})\n\n`;
    const btns = slice.map(u => {
      const name = u.username ? `@${u.username}` : (u.firstName || String(u.userId));
      text += `🚫 ${name} \`[${u.userId}]\` — ${u.bannedReason || '—'}\n`;
      return [Markup.button.callback(`✅ رفع حظر: ${name.slice(0, 18)}`, `dev_uungban_quick_${u.userId}_${page}`)];
    });
    const nav = [];
    if (page > 0) nav.push(Markup.button.callback('◀️ السابق', `dev_unban_menu_${page - 1}`));
    if ((page + 1) * PAGE < banned.length) nav.push(Markup.button.callback('التالي ▶️', `dev_unban_menu_${page + 1}`));
    if (nav.length) btns.push(nav);
    btns.push([Markup.button.callback('🔙 رجوع', 'dev_back')]);
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) });
  });

  // رفع حظر سريع من قائمة المحظورين
  bot.action(/^dev_uungban_quick_(\d+)_(\d+)$/, async (ctx) => {
    if (!isDeveloperOrBotAdmin(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    const userId = Number(ctx.match[1]);
    const page   = Number(ctx.match[2]);
    const u      = db.getUser(userId);
    if (!u || !u.globalBanned) return ctx.answerCbQuery('⚠️ ليس محظوراً!', { show_alert: true });
    u.globalBanned = false; u.bannedReason = ''; u.bannedAt = null;
    db.saveData();
    for (const g of db.allGroups()) { try { await bot.telegram.unbanChatMember(g.chatId, userId); } catch {} }
    await ctx.answerCbQuery('✅ رُفع الحظر العالمي!', { show_alert: true });
    // إعادة تحميل القائمة
    const banned = db.allUsers().filter(u2 => u2.globalBanned);
    if (!banned.length)
      return ctx.editMessageText('✅ *تم رفع الحظر. لا يوجد محظورون الآن.*', { parse_mode: 'Markdown', ...back('dev_back') });
    const PAGE  = 8;
    const pg    = Math.min(page, Math.floor((banned.length - 1) / PAGE));
    const slice = banned.slice(pg * PAGE, (pg + 1) * PAGE);
    let text2   = `✅ *اختر المستخدم لرفع الحظر العالمي* (${banned.length})\n\n`;
    const btns2 = slice.map(u2 => {
      const name = u2.username ? `@${u2.username}` : (u2.firstName || String(u2.userId));
      text2 += `🚫 ${name} \`[${u2.userId}]\` — ${u2.bannedReason || '—'}\n`;
      return [Markup.button.callback(`✅ رفع حظر: ${name.slice(0, 18)}`, `dev_uungban_quick_${u2.userId}_${pg}`)];
    });
    const nav2 = [];
    if (pg > 0) nav2.push(Markup.button.callback('◀️ السابق', `dev_unban_menu_${pg - 1}`));
    if ((pg + 1) * PAGE < banned.length) nav2.push(Markup.button.callback('التالي ▶️', `dev_unban_menu_${pg + 1}`));
    if (nav2.length) btns2.push(nav2);
    btns2.push([Markup.button.callback('🔙 رجوع', 'dev_back')]);
    await ctx.editMessageText(text2, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns2) });
  });

  bot.command('gban', async (ctx) => {
    if (!isDeveloperOrBotAdmin(ctx)) return ctx.reply('⛔ ليس لديك صلاحية للحظر العالمي.');
    const args     = ctx.message.text.split(' ').slice(1);
    const targetId = Number(args[0]);
    const reason   = args.slice(1).join(' ') || 'لا يوجد سبب';
    if (!targetId) return ctx.reply('❌ مثال: /gban 123456 سبب');
    const user = db.getOrCreateUser(targetId, '', '');
    if (user.globalBanned) return ctx.reply('⚠️ هذا المستخدم محظور عالمياً بالفعل!');
    user.globalBanned = true; user.bannedReason = reason; user.bannedAt = new Date();
    db.saveData();
    await ctx.replyWithMarkdown(`🚫 *تم الحظر العالمي*\n\`${targetId}\`\n${reason}`);
    for (const g of db.allGroups()) { try { await bot.telegram.banChatMember(g.chatId, targetId); } catch {} }
  });

  bot.command('ungban', async (ctx) => {
    if (!isDeveloperOrBotAdmin(ctx)) return ctx.reply('⛔ ليس لديك صلاحية لرفع الحظر العالمي.');
    const targetId = Number(ctx.message.text.split(' ')[1]);
    if (!targetId) return ctx.reply('❌ مثال: /ungban 123456');
    const user = db.getUser(targetId);
    if (!user) return ctx.reply('❌ المستخدم غير موجود في قاعدة البيانات!');
    if (!user.globalBanned) return ctx.reply('⚠️ هذا المستخدم ليس محظوراً عالمياً!');
    user.globalBanned = false; user.bannedReason = ''; user.bannedAt = null;
    db.saveData();
    for (const g of db.allGroups()) { try { await bot.telegram.unbanChatMember(g.chatId, targetId); } catch {} }
    await ctx.replyWithMarkdown('✅ *رُفع الحظر العالمي عن:* `' + targetId + '`\nتم رفع الحظر من جميع المجموعات.');
  });

  // ── dev_banned_list ──────────────────────────────────────────
  // قائمة المحظورين مع أزرار رفع حظر تفاعلية
  bot.action(/^dev_banned_list(_(\\d+))?$/, async (ctx) => {
    if (!isDeveloperOrBotAdmin(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const page   = Number(ctx.match?.[2] || 0);
    const PAGE   = 6;
    const banned = db.allUsers().filter(u => u.globalBanned);
    if (!banned.length)
      return ctx.editMessageText('📋 *لا يوجد محظورون عالمياً.*', { parse_mode: 'Markdown', ...back('dev_back') });
    const slice = banned.slice(page * PAGE, (page + 1) * PAGE);
    let text = `📋 *المحظورون عالمياً* (${banned.length}) — صفحة ${page + 1}\n\n`;
    slice.forEach(u => {
      const name = u.username ? `@${u.username}` : (u.firstName || String(u.userId));
      text += `🚫 ${name} \`[${u.userId}]\` — ${u.bannedReason || '—'}\n`;
    });
    const btns = slice.map(u => {
      const name = u.username ? `@${u.username}` : (u.firstName || String(u.userId));
      return [Markup.button.callback(`✅ رفع حظر: ${name.slice(0, 18)}`, `dev_uungban_quick_${u.userId}_${page}`)];
    });
    const nav = [];
    if (page > 0) nav.push(Markup.button.callback('◀️ السابق', `dev_banned_list_${page - 1}`));
    if ((page + 1) * PAGE < banned.length) nav.push(Markup.button.callback('التالي ▶️', `dev_banned_list_${page + 1}`));
    if (nav.length) btns.push(nav);
    btns.push([Markup.button.callback('🔙 رجوع', 'dev_back')]);
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) });
  });

  // ── dev_user_search / /userinfo ──────────────────────────────
  bot.action('dev_user_search', async (ctx) => {
    if (!isDeveloperOrBotAdmin(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    await ctx.editMessageText('🔍 *بحث مستخدم*\n\n`/userinfo <id أو @username>`', { parse_mode: 'Markdown', ...back('dev_back') });
  });

  bot.command('userinfo', async (ctx) => {
    if (!isDeveloperOrBotAdmin(ctx)) return;
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

  // ── 👤 مستخدمو البوت (مع Pagination وأزرار تفاعلية) ────────────
  bot.action(/^dev_bot_users(_(\d+))?$/, async (ctx) => {
    if (!isDeveloperOrBotAdmin(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const page      = Number(ctx.match?.[2] || 0);
    const PAGE_SIZE = 8;
    const allUsers  = db.allUsers();
    if (!allUsers.length)
      return ctx.editMessageText('👤 *لا يوجد مستخدمون مسجّلون بعد.*', { parse_mode: 'Markdown', ...back('dev_back') });

    // إحصاء مجموعات كل مستخدم
    const addedByStats = new Map();
    for (const g of db.allGroups()) {
      if (!addedByStats.has(g.addedBy))
        addedByStats.set(g.addedBy, { username: g.addedByUsername, groups: 0 });
      addedByStats.get(g.addedBy).groups++;
    }

    const slice = allUsers.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    let text = `👤 *مستخدمو البوت* (${allUsers.length}) — صفحة ${page + 1}\n\n`;
    const btns = slice.map(u => {
      const name    = u.username ? `@${u.username}` : (u.firstName || String(u.userId));
      const groups  = addedByStats.get(u.userId)?.groups || 0;
      const banned  = u.globalBanned ? '🚫' : '';
      text += `${banned}👤 ${name} \`[${u.userId}]\` — ${groups} مجموعة\n`;
      return [Markup.button.callback(
        `${banned}👤 ${name.slice(0, 20)} (${groups} مج)`,
        `dev_uinfo_${u.userId}_${page}`
      )];
    });

    const navBtns = [];
    if (page > 0) navBtns.push(Markup.button.callback('◀️ السابق', `dev_bot_users_${page - 1}`));
    if ((page + 1) * PAGE_SIZE < allUsers.length) navBtns.push(Markup.button.callback('التالي ▶️', `dev_bot_users_${page + 1}`));
    if (navBtns.length) btns.push(navBtns);
    btns.push([Markup.button.callback('🔙 رجوع', 'dev_back')]);

    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) });
  });

  // ── معلومات مستخدم + أزرار الإجراءات ────────────────────────
  bot.action(/^dev_uinfo_(\d+)_(\d+)$/, async (ctx) => {
    if (!isDeveloperOrBotAdmin(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const userId = Number(ctx.match[1]);
    const page   = Number(ctx.match[2]);
    const u      = db.getUser(userId);
    if (!u) return ctx.answerCbQuery('❌ المستخدم غير موجود!', { show_alert: true });

    const name      = u.username ? `@${u.username}` : (u.firstName || String(userId));
    const groups    = db.allGroups().filter(g => g.addedBy === userId);
    const groupList = groups.slice(0, 5).map(g => `• ${g.title}`).join('\n') || '—';

    await ctx.editMessageText(
      `👤 *${name}*\n\n` +
      `🆔 \`${userId}\`\n` +
      `📛 الاسم: ${u.firstName || '—'}\n` +
      `🔗 يوزر: ${u.username ? `@${u.username}` : '—'}\n` +
      `📅 أول ظهور: ${new Date(u.firstSeen).toLocaleDateString('ar')}\n` +
      `👁️ آخر ظهور: ${new Date(u.lastSeen).toLocaleDateString('ar')}\n` +
      `🌍 محظور عالمياً: ${u.globalBanned ? `✅ — ${u.bannedReason}` : '❌'}\n` +
      `🤖 مشرف بوت: ${db.isBotAdmin(userId) ? '✅' : '❌'}\n` +
      `👥 مجموعاته (${groups.length}):\n${groupList}`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('🚫 حظر عالمي',    `dev_ugban_${userId}_${page}`),
            Markup.button.callback('✅ رفع حظر',       `dev_uungban_${userId}_${page}`),
          ],
          [
            Markup.button.callback('🤖 منح مشرف بوت', `dev_umakeadmin_${userId}_${page}`),
            Markup.button.callback('❌ إزالة مشرف',   `dev_uremoveadmin_${userId}_${page}`),
          ],
          [Markup.button.callback('🔙 رجوع', `dev_bot_users_${page}`)],
        ]),
      }
    );
  });

  // حظر عالمي من لوحة المستخدم
  bot.action(/^dev_ugban_(\d+)_(\d+)$/, async (ctx) => {
    if (!isDeveloperOrBotAdmin(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    const userId = Number(ctx.match[1]);
    const page   = Number(ctx.match[2]);
    const u      = db.getOrCreateUser(userId, '', '');
    if (u.globalBanned) return ctx.answerCbQuery('⚠️ محظور بالفعل!', { show_alert: true });
    u.globalBanned = true; u.bannedReason = 'حظر من لوحة المطور'; u.bannedAt = new Date();
    db.saveData();
    for (const g of db.allGroups()) { try { await bot.telegram.banChatMember(g.chatId, userId); } catch {} }
    await ctx.answerCbQuery('🚫 تم الحظر العالمي!', { show_alert: true });
    // إعادة تحميل معلومات المستخدم
    ctx.match[1] = String(userId); ctx.match[2] = String(page);
    await ctx.editMessageText(
      `🚫 *تم حظر \`${userId}\` عالمياً.*`,
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', `dev_bot_users_${page}`)]]) }
    );
  });

  // رفع حظر من لوحة المستخدم
  bot.action(/^dev_uungban_(\d+)_(\d+)$/, async (ctx) => {
    if (!isDeveloperOrBotAdmin(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    const userId = Number(ctx.match[1]);
    const page   = Number(ctx.match[2]);
    const u      = db.getUser(userId);
    if (!u || !u.globalBanned) return ctx.answerCbQuery('⚠️ ليس محظوراً!', { show_alert: true });
    u.globalBanned = false; u.bannedReason = ''; u.bannedAt = null;
    db.saveData();
    await ctx.answerCbQuery('✅ رُفع الحظر!', { show_alert: true });
    await ctx.editMessageText(
      `✅ *رُفع الحظر عن \`${userId}\`.*`,
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', `dev_bot_users_${page}`)]]) }
    );
  });

  // منح صلاحية مشرف بوت
  bot.action(/^dev_umakeadmin_(\d+)_(\d+)$/, async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('❌ المطور الأساسي فقط!', { show_alert: true });
    const userId = Number(ctx.match[1]);
    const page   = Number(ctx.match[2]);
    if (db.isBotAdmin(userId)) return ctx.answerCbQuery('⚠️ مشرف بالفعل!', { show_alert: true });
    db.addBotAdmin(userId);
    try { await bot.telegram.sendMessage(userId, '🔐 *تمت ترقيتك كمشرف بوت!*\n\nاستخدم /dev للوصول.', { parse_mode: 'Markdown' }); } catch {}
    await ctx.answerCbQuery('✅ تمت الترقية!', { show_alert: true });
    await ctx.editMessageText(
      `✅ *تم منح \`${userId}\` صلاحية مشرف بوت.*`,
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', `dev_bot_users_${page}`)]]) }
    );
  });

  // إزالة صلاحية مشرف بوت
  bot.action(/^dev_uremoveadmin_(\d+)_(\d+)$/, async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('❌ المطور الأساسي فقط!', { show_alert: true });
    const userId = Number(ctx.match[1]);
    const page   = Number(ctx.match[2]);
    if (!db.isBotAdmin(userId)) return ctx.answerCbQuery('⚠️ ليس مشرفاً!', { show_alert: true });
    db.removeBotAdmin(userId);
    await ctx.answerCbQuery('✅ تمت الإزالة!', { show_alert: true });
    await ctx.editMessageText(
      `❌ *تمت إزالة صلاحية مشرف بوت عن \`${userId}\`.*`,
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', `dev_bot_users_${page}`)]]) }
    );
  });

  // ── 📈 استخدام البوت ─────────────────────────────────────────
  bot.action('dev_usage', async (ctx) => {
    if (!isDeveloperOrBotAdmin(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const groups = db.allGroups();
    const totalMsgs  = groups.reduce((a, g) => a + [...g.members.values()].reduce((b, m) => b + (m.messageCount || 0), 0), 0);
    const totalWords = groups.reduce((a, g) => a + g.bannedWords.length, 0);
    const totalWarns = groups.reduce((a, g) => a + [...g.warns.values()].reduce((b, w) => b + w.length, 0), 0);
    const topGroup   = groups.sort((a, b) => b.members.size - a.members.size)[0];
    await ctx.editMessageText(
      `📈 *استخدام البوت*\n\n` +
      `💬 إجمالي الرسائل المسجّلة: \`${totalMsgs}\`\n` +
      `🔤 إجمالي الكلمات المحظورة: \`${totalWords}\`\n` +
      `⚠️ إجمالي التحذيرات: \`${totalWarns}\`\n` +
      `🕐 وقت تشغيل السيرفر: \`${Math.floor(process.uptime() / 3600)}س ${Math.floor((process.uptime() % 3600) / 60)}د\`\n` +
      (topGroup ? `\n🏆 أكبر مجموعة: *${topGroup.title}* (${topGroup.members.size} عضو)` : ''),
      { parse_mode: 'Markdown', ...back('dev_back') }
    );
  });

  // ── dev_refresh / dev_back ───────────────────────────────────
  bot.action('dev_refresh', async (ctx) => {
    if (!isDeveloperOrBotAdmin(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery('🔄 تم التحديث!');
    const s = db.getStats();
    await ctx.editMessageText(
      `🔐 *لوحة تحكم المطور*\n\n📊 المجموعات: \`${s.totalGroups}\` | القنوات: \`${s.totalChannels}\`\n👤 ${s.totalUsers} مستخدم | 🚫 ${s.bannedUsers} محظور`,
      { parse_mode: 'Markdown', ...devMainKeyboard() }
    );
  });

  bot.action('dev_back', async (ctx) => {
    if (!isDeveloperOrBotAdmin(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const s = db.getStats();
    await ctx.editMessageText(
      `🔐 *لوحة تحكم المطور*\n\n📊 المجموعات: \`${s.totalGroups}\` | القنوات: \`${s.totalChannels}\`\n👤 ${s.totalUsers} مستخدم | 🚫 ${s.bannedUsers} محظور`,
      { parse_mode: 'Markdown', ...devMainKeyboard() }
    );
  });

  // ═══════════════════════════════════════════════════════════════
  //  إدارة مشرفي البوت (لوحة تفاعلية)
  // ═══════════════════════════════════════════════════════════════
  // ── botadmins_panel — يُحيل للنظام الجديد في handler_bot_admins.js ──
  bot.action('botadmins_panel', async (ctx) => {
    if (!isDeveloper(ctx))
      return ctx.answerCbQuery('❌ المطور الأساسي فقط!', { show_alert: true });
    await ctx.answerCbQuery();
    // إعادة توجيه للوحة الجديدة (ba_panel)
    // سيستقبلها handler_bot_admins.js
    await ctx.callbackQuery.message.editText
      ? ctx.editMessageText(
          `👥 *إدارة مشرفي البوت*\n\nجاري التحميل...`,
          { parse_mode: 'Markdown' }
        ).catch(() => {})
      : null;
    // نشر callback جديد
    ctx.match = ['ba_panel'];
    // تمرير لـ ba_panel عبر emit مباشر
    await bot.telegram.callApi('answerCallbackQuery', {
      callback_query_id: ctx.callbackQuery.id,
    }).catch(() => {});
  });

  // ══════════════════════════════════════════════════════════════
  //  🛡️ لوحة حماية المحتوى — للمطور فقط
  //  تتيح التطبيق على أي مجموعة/قناة/مجتمع مسجّل في البوت
  // ══════════════════════════════════════════════════════════════
  bot.action('dev_protect_menu', async (ctx) => {
    if (!isDeveloperOrBotAdmin(ctx))
      return ctx.answerCbQuery('❌ للمطور فقط!', { show_alert: true });
    await ctx.answerCbQuery();

    const groups   = db.allGroups();
    const channels = db.allChannels ? db.allChannels() : [];
    const total    = groups.length + channels.length;

    const btns = [];

    // مجموعات
    for (const g of groups.slice(0, 8)) {
      const icon = g.protectContent ? '🔒' : '🔓';
      btns.push([Markup.button.callback(
        `${icon} ${g.title.slice(0, 22)}`,
        `dev_protect_toggle_${g.chatId}`
      )]);
    }

    // قنوات
    for (const ch of channels.slice(0, 4)) {
      const icon = ch.protectContent ? '🔒' : '🔓';
      btns.push([Markup.button.callback(
        `${icon} 📢 ${(ch.title || 'قناة').slice(0, 20)}`,
        `dev_protect_toggle_${ch.chatId}`
      )]);
    }

    btns.push([
      Markup.button.callback('🔒 تفعيل الكل',  'dev_protect_all_on'),
      Markup.button.callback('🔓 تعطيل الكل',  'dev_protect_all_off'),
    ]);
    btns.push([Markup.button.callback('🔙 رجوع', 'dev_main')]);

    await ctx.editMessageText(
      `🛡️ *حماية المحتوى — كل المحادثات*\n\n` +
      `📊 إجمالي: \`${total}\` محادثة\n` +
      `🔒 محمية: \`${groups.filter(g => g.protectContent).length + channels.filter(c => c.protectContent).length}\`\n` +
      `🔓 غير محمية: \`${groups.filter(g => !g.protectContent).length + channels.filter(c => !c.protectContent).length}\`\n\n` +
      `اضغط على أي محادثة لتبديل حالتها:`,
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) }
    );
  });

  // تبديل حماية محادثة واحدة من لوحة المطور
  bot.action(/^dev_protect_toggle_(-?\d+)$/, async (ctx) => {
    if (!isDeveloperOrBotAdmin(ctx))
      return ctx.answerCbQuery('❌ للمطور فقط!', { show_alert: true });
    await ctx.answerCbQuery();

    const chatId = Number(ctx.match[1]);
    const g  = db.getGroup(chatId);
    const ch = db.getChannel ? db.getChannel(chatId) : null;
    if (!g && !ch)
      return ctx.answerCbQuery('❌ غير موجودة!', { show_alert: true });

    const current  = g ? !!g.protectContent : !!ch.protectContent;
    const newState = !current;

    try {
      // فحص البوت
      const botInfo   = await bot.telegram.getMe();
      const botMember = await bot.telegram.getChatMember(chatId, botInfo.id);
      if (botMember.status !== 'administrator')
        return ctx.answerCbQuery('❌ البوت ليس مشرفاً هناك!', { show_alert: true });

      await bot.telegram.callApi('setChatProtectContent', {
        chat_id: chatId, protect_content: newState,
      });

      if (g) g.protectContent = newState;
      else ch.protectContent  = newState;
      db.markDirty();

      const label = g ? g.title : (ch?.title || 'القناة');
      await ctx.answerCbQuery(
        newState ? `🔒 ${label} — تم التفعيل!` : `🔓 ${label} — تم التعطيل!`,
        { show_alert: true }
      );

      // إعادة رسم اللوحة
      const groups   = db.allGroups();
      const channels = db.allChannels ? db.allChannels() : [];
      const btns = [];
      for (const gr of groups.slice(0, 8)) {
        const ic = gr.protectContent ? '🔒' : '🔓';
        btns.push([Markup.button.callback(`${ic} ${gr.title.slice(0, 22)}`, `dev_protect_toggle_${gr.chatId}`)]);
      }
      for (const c of channels.slice(0, 4)) {
        const ic = c.protectContent ? '🔒' : '🔓';
        btns.push([Markup.button.callback(`${ic} 📢 ${(c.title || 'قناة').slice(0, 20)}`, `dev_protect_toggle_${c.chatId}`)]);
      }
      btns.push([Markup.button.callback('🔒 تفعيل الكل', 'dev_protect_all_on'), Markup.button.callback('🔓 تعطيل الكل', 'dev_protect_all_off')]);
      btns.push([Markup.button.callback('🔙 رجوع', 'dev_main')]);
      const total    = groups.length + channels.length;
      await ctx.editMessageText(
        `🛡️ *حماية المحتوى — كل المحادثات*\n\n` +
        `📊 إجمالي: \`${total}\`\n` +
        `🔒 محمية: \`${groups.filter(g => g.protectContent).length + channels.filter(c => c.protectContent).length}\`\n` +
        `🔓 غير محمية: \`${groups.filter(g => !g.protectContent).length + channels.filter(c => !c.protectContent).length}\`\n\n` +
        `اضغط على أي محادثة لتبديل حالتها:`,
        { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) }
      );
    } catch (e) {
      await ctx.answerCbQuery(`❌ فشل: ${e.description || e.message}`, { show_alert: true });
    }
  });

  // تفعيل الحماية على الكل
  bot.action('dev_protect_all_on', async (ctx) => {
    if (!isDeveloperOrBotAdmin(ctx))
      return ctx.answerCbQuery('❌ للمطور فقط!', { show_alert: true });
    await ctx.answerCbQuery('⏳ جاري التطبيق على الجميع...', { show_alert: true });
    const groups   = db.allGroups();
    const channels = db.allChannels ? db.allChannels() : [];
    let ok = 0, fail = 0;
    for (const item of [...groups, ...channels]) {
      const id = item.chatId;
      try {
        await bot.telegram.callApi('setChatProtectContent', { chat_id: id, protect_content: true });
        item.protectContent = true;
        ok++;
      } catch { fail++; }
      await new Promise(r => setTimeout(r, 100));
    }
    db.markDirty();
    await ctx.reply(`🔒 *تم تفعيل حماية المحتوى على الجميع*\n\n✅ نجح: \`${ok}\`\n❌ فشل: \`${fail}\``, { parse_mode: 'Markdown' });
  });

  // تعطيل الحماية على الكل
  bot.action('dev_protect_all_off', async (ctx) => {
    if (!isDeveloperOrBotAdmin(ctx))
      return ctx.answerCbQuery('❌ للمطور فقط!', { show_alert: true });
    await ctx.answerCbQuery('⏳ جاري التعطيل على الجميع...', { show_alert: true });
    const groups   = db.allGroups();
    const channels = db.allChannels ? db.allChannels() : [];
    let ok = 0, fail = 0;
    for (const item of [...groups, ...channels]) {
      const id = item.chatId;
      try {
        await bot.telegram.callApi('setChatProtectContent', { chat_id: id, protect_content: false });
        item.protectContent = false;
        ok++;
      } catch { fail++; }
      await new Promise(r => setTimeout(r, 100));
    }
    db.markDirty();
    await ctx.reply(`🔓 *تم تعطيل حماية المحتوى على الجميع*\n\n✅ نجح: \`${ok}\`\n❌ فشل: \`${fail}\``, { parse_mode: 'Markdown' });
  });

};