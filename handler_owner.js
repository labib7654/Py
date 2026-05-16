const { Markup } = require('telegraf');
const db         = require('./db');
const {
  isDeveloper, isAdmin, isOwner,
  applyGroupPermissions, logAction,
  setJoinApproval, verifyAndRegisterOwner,
  lockTopic, unlockTopic, archiveTopic,
} = require('./helpers');

// ── Map لتتبع جلسات إضافة كلمات محظورة ───────────────────────
const pendingAddWord = new Map();

// ── لوحة الإعدادات الرئيسية ──────────────────────────────────
function groupSettingsKeyboard(chatId, s) {
  const com = s.communityId ? db.getCommunity(s.communityId) : null;
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(`${s.joinRequestsEnabled ? '🔒' : '🔓'} موافقة الانضمام`, `toggle_joinreq_${chatId}`),
      Markup.button.callback('📨 الطلبات المعلقة', `joinreqs_${chatId}`),
    ],
    [
      Markup.button.callback(`${s.protectContent ? '🔒' : '🔓'} حماية المحتوى`, `toggle_protect_${chatId}`),
      Markup.button.callback(`${s.antiLinks      ? '✅' : '❌'} منع الروابط`,   `toggle_antilinks_${chatId}`),
    ],
    [
      Markup.button.callback(`${s.welcomeEnabled  ? '✅' : '❌'} ترحيب`,        `toggle_welcome_${chatId}`),
      Markup.button.callback(`${s.muteNewMembers  ? '✅' : '❌'} كتم الجدد`,    `toggle_mutenew_${chatId}`),
    ],
    [
      Markup.button.callback(`${s.antiSpam ? '✅' : '❌'} مكافحة سبام`,        `toggle_antispam_${chatId}`),
      Markup.button.callback(`${s.antiBot  ? '✅' : '❌'} منع بوتات`,          `toggle_antibot_${chatId}`),
    ],
    // ── 4️⃣د) زر حماية المجتمع ──────────────────────────────
    ...(com ? [[
      Markup.button.callback(`${com.enabled ? '✅' : '❌'} 🏫 حماية المجتمع`, `toggle_community_${chatId}`),
    ]] : []),
    [Markup.button.callback('🎛️ صلاحيات الأعضاء', `perms_panel_${chatId}`)],
    [
      Markup.button.callback('✏️ رسالة الترحيب',  `edit_welcome_${chatId}`),
      Markup.button.callback('📋 القواعد',          `edit_rules_${chatId}`),
    ],
    [
      Markup.button.callback('🔤 كلمات محظورة',    `bwords_list_${chatId}`),
      Markup.button.callback('⚙️ حد التحذيرات',    `set_maxwarns_${chatId}`),
    ],
    [
      Markup.button.callback('🗂️ إدارة المواضيع',  `topics_panel_${chatId}`),
      Markup.button.callback('📢 قناة السجلات',    `logchannel_info_${chatId}`),
    ],
    [
      Markup.button.callback('📊 إحصائيات',         `stats_${chatId}`),
      Markup.button.callback('📋 سجل الإجراءات',   `auditlog_${chatId}`),
    ],
    [Markup.button.callback('🔙 رجوع', `group_home_${chatId}`)],
  ]);
}

// ── لوحة صلاحيات الأعضاء ────────────────────────────────────
function permissionsDashboard(chatId, perms) {
  return Markup.inlineKeyboard([
    [Markup.button.callback(`${perms.canSendMessages   ? '✅' : '❌'} إرسال رسائل`,     `perm_msg_${chatId}`)],
    [Markup.button.callback(`${perms.canSendMedia      ? '✅' : '❌'} إرسال وسائط`,     `perm_media_${chatId}`)],
    [Markup.button.callback(`${perms.canSendPolls      ? '✅' : '❌'} إرسال استطلاعات`, `perm_polls_${chatId}`)],
    [Markup.button.callback(`${perms.canAddWebPreviews ? '✅' : '❌'} معاينة روابط`,    `perm_preview_${chatId}`)],
    [Markup.button.callback(`${perms.canInviteUsers    ? '✅' : '❌'} دعوة مستخدمين`,  `perm_invite_${chatId}`)],
    [Markup.button.callback(`${perms.canPinMessages    ? '✅' : '❌'} تثبيت رسائل`,    `perm_pin_${chatId}`)],
    [Markup.button.callback(`${perms.canManageTopics   ? '✅' : '❌'} إدارة المواضيع`,  `perm_topics_${chatId}`)],
    [Markup.button.callback('🔙 رجوع', `settings_${chatId}`)],
  ]);
}

// ── لوحة المواضيع ────────────────────────────────────────────
function topicsPanelKeyboard(chatId, ts) {
  return Markup.inlineKeyboard([
    [Markup.button.callback(
      `${ts?.requireApprovalToJoin ? '✅' : '❌'} موافقة دخول المواضيع`,
      `toggle_topicapproval_${chatId}`
    )],
    [Markup.button.callback(
      `${ts?.autoLockOnCreate ? '✅' : '❌'} قفل تلقائي للمواضيع الجديدة`,
      `toggle_autolock_${chatId}`
    )],
    [Markup.button.callback('🔙 رجوع', `settings_${chatId}`)],
  ]);
}

module.exports = {
  groupSettingsKeyboard,
  setupOwnerHandlers: function setupOwnerHandlers(bot) {

  // ════════════════════════════════════════════════════════════
  //  الأوامر
  // ════════════════════════════════════════════════════════════

  // ── /settings ─────────────────────────────────────────────
  bot.command('settings', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.reply('❌ للمشرفين فقط!');
    const g = db.getGroup(chatId);
    if (!g) return ctx.reply('❌ بيانات المجموعة غير موجودة!');
    await ctx.replyWithMarkdown(
      `⚙️ *إعدادات ${g.title}*\n\nاضغط لتفعيل/تعطيل:`,
      groupSettingsKeyboard(chatId, g)
    );
  });

  // ── /mybot ─────────────────────────────────────────────────
  bot.command('mybot', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    const g = db.getGroup(chatId);
    if (!g) return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.reply('❌ للمشرفين فقط!');
    try {
      await bot.telegram.sendMessage(
        ctx.from.id,
        `🔐 *لوحة تحكم ${g.title}*\n\nمرحباً ${ctx.from.first_name}، اضغط أدناه للتحكم:`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([[
            Markup.button.callback(`⚙️ إعدادات ${g.title.slice(0, 20)}`, `owner_panel_${chatId}`),
          ]]),
        }
      );
      await ctx.reply('✅ تم إرسال لوحة التحكم إلى خاصك.', { reply_to_message_id: ctx.message.message_id });
    } catch {
      await ctx.reply(
        '❌ تعذر إرسال الرسالة، ابدأ محادثة مع البوت أولاً.',
        Markup.inlineKeyboard([[
          Markup.button.url('🔓 افتح الخاص', `https://t.me/${ctx.botInfo.username}?start=panel_${chatId}`),
        ]])
      );
    }
  });

  // ── /setwelcome ────────────────────────────────────────────
  bot.command('setwelcome', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, ctx.chat.id, ctx.from.id))
      return ctx.reply('❌ للمشرفين فقط!');
    const text = ctx.message.text.replace('/setwelcome', '').trim();
    if (!text)
      return ctx.replyWithMarkdown('📝 `/setwelcome نص`\nالمتغيرات: `{name}` `{group}` `{username}`');
    const g = db.getGroup(ctx.chat.id); if (!g) return;
    g.welcomeMessage = text;
    const preview = text
      .replace('{name}',     ctx.from.first_name || 'عضو')
      .replace('{group}',    ctx.chat.title       || 'المجموعة')
      .replace('{username}', ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name || '');
    await ctx.replyWithMarkdown(`✅ *تم تعديل رسالة الترحيب*\n\n*معاينة:*\n${preview}`);
  });

  // ── /setrules ──────────────────────────────────────────────
  bot.command('setrules', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, ctx.chat.id, ctx.from.id))
      return ctx.reply('❌ للمشرفين فقط!');
    const text = ctx.message.text.replace('/setrules', '').trim();
    if (!text) return ctx.reply('📋 مثال: /setrules 1. الاحترام\n2. عدم الإعلانات');
    const g = db.getGroup(ctx.chat.id); if (!g) return;
    g.rules = text;
    await ctx.replyWithMarkdown(`✅ *تم تعيين القواعد*\n\n${text}`);
  });

  // ── /setmaxwarns ───────────────────────────────────────────
  bot.command('setmaxwarns', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    if (!isDeveloper(ctx) && !await isOwner(bot, ctx.chat.id, ctx.from.id))
      return ctx.reply('❌ للمالك فقط!');
    const n = Number(ctx.message.text.split(' ')[1]);
    if (!n || n < 1 || n > 10) return ctx.reply('❌ مثال: /setmaxwarns 3  (النطاق: 1-10)');
    const g = db.getGroup(ctx.chat.id); if (!g) return;
    g.maxWarns = n;
    await ctx.replyWithMarkdown(`✅ الحد الأقصى للتحذيرات: \`${n}\``);
  });

  // ── /setlogchannel ─────────────────────────────────────────
  bot.command('setlogchannel', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    if (!isDeveloper(ctx) && !await isOwner(bot, ctx.chat.id, ctx.from.id))
      return ctx.reply('❌ للمالك فقط!');
    const arg = ctx.message.text.split(' ')[1];
    const g   = db.getGroup(ctx.chat.id); if (!g) return;
    if (!arg) { g.logChannelId = null; return ctx.reply('✅ تم إلغاء قناة السجلات.'); }
    const channelId = Number(arg);
    if (!channelId) return ctx.reply('❌ مثال: /setlogchannel -100123456789');
    g.logChannelId = channelId;
    await ctx.replyWithMarkdown(`✅ *قناة السجلات:* \`${channelId}\``);
  });

  // ── /addword ───────────────────────────────────────────────
  bot.command('addword', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, ctx.chat.id, ctx.from.id))
      return ctx.reply('❌ للمشرفين فقط!');
    const args      = ctx.message.text.split(' ').slice(1);
    const word      = args[0];
    const action    = (args[1] || 'warn').toLowerCase();
    const threshold = Number(args[2]) || 1;
    if (!word)
      return ctx.replyWithMarkdown('📌 `/addword <كلمة> <إجراء> <عدد_مرات>`\n\nالإجراءات: `warn` | `mute` | `kick` | `ban`\nمثال: `/addword بذيء warn 2`');
    if (!['warn', 'mute', 'kick', 'ban'].includes(action))
      return ctx.reply('❌ الإجراء غير صحيح! الخيارات: warn | mute | kick | ban');
    if (threshold < 1 || threshold > 5) return ctx.reply('❌ عدد المرات بين 1 و 5');
    const g = db.getGroup(ctx.chat.id); if (!g) return;
    if (g.bannedWords.find(bw => bw.word.toLowerCase() === word.toLowerCase()))
      return ctx.reply('❌ الكلمة موجودة مسبقاً!');
    g.bannedWords.push({ word, action, threshold, addedBy: ctx.from.id, addedAt: new Date() });
    const arAct = { warn: '⚠️ تحذير', mute: '🔇 كتم', kick: '👢 طرد', ban: '🚫 حظر' };
    await ctx.replyWithMarkdown(
      `✅ *تمت إضافة الكلمة المحظورة*\n\n🔤 \`${word}\`\n⚡ الإجراء: ${arAct[action]}\n🔁 يُطبَّق بعد: \`${threshold}\` مرة\n🗑️ الرسالة تُحذف فوراً`
    );
  });

  // ── /removeword ────────────────────────────────────────────
  bot.command('removeword', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, ctx.chat.id, ctx.from.id))
      return ctx.reply('❌ للمشرفين فقط!');
    const word = ctx.message.text.split(' ').slice(1).join(' ').trim();
    if (!word) return ctx.reply('📌 مثال: /removeword كلمة');
    const g = db.getGroup(ctx.chat.id); if (!g) return;
    const before = g.bannedWords.length;
    g.bannedWords = g.bannedWords.filter(bw => bw.word.toLowerCase() !== word.toLowerCase());
    if (g.bannedWords.length === before) return ctx.reply('❌ الكلمة غير موجودة!');
    await ctx.replyWithMarkdown(`✅ *تمت الإزالة:* \`${word}\``);
  });

  // ── /words ─────────────────────────────────────────────────
  bot.command('words', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const g = db.getGroup(ctx.chat.id);
    if (!g || !g.bannedWords.length)
      return ctx.reply('🔤 لا توجد كلمات محظورة.\n\n`/addword` لإضافة كلمة.');
    const ar   = { warn: '⚠️', mute: '🔇', kick: '👢', ban: '🚫' };
    let text   = `🔤 *الكلمات المحظورة* (${g.bannedWords.length})\n\n`;
    g.bannedWords.forEach((bw, i) => {
      text += `${i + 1}. \`${bw.word}\` ${ar[bw.action] || ''} — بعد \`${bw.threshold || 1}\` مرة\n`;
    });
    await ctx.replyWithMarkdown(text);
  });

  // ── 3️⃣ب) أوامر إدارة المواضيع ────────────────────────────

  // /locktopic
  bot.command('locktopic', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.reply('❌ للمشرفين فقط!');
    // الموضوع من reply أو argument
    const topicId = ctx.message.message_thread_id || Number(ctx.message.text.split(' ')[1]);
    if (!topicId) return ctx.reply('❌ مثال: /locktopic [topic_id] أو ارد على رسالة في الموضوع');
    const ok = await lockTopic(bot, chatId, topicId);
    if (!ok) return ctx.reply('❌ فشل قفل الموضوع — تأكد من صلاحيات البوت وأن المجموعة تدعم المواضيع.');
    const g = db.getGroup(chatId);
    if (g) {
      if (!g.topics.has(topicId)) g.topics.set(topicId, { approvedUsers: new Set() });
      g.topics.get(topicId).locked   = true;
      g.topics.get(topicId).name     = g.topics.get(topicId).name || String(topicId);
    }
    await ctx.replyWithMarkdown(`🔒 *تم قفل الموضوع* \`${topicId}\``);
  });

  // /unlocktopic
  bot.command('unlocktopic', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.reply('❌ للمشرفين فقط!');
    const topicId = ctx.message.message_thread_id || Number(ctx.message.text.split(' ')[1]);
    if (!topicId) return ctx.reply('❌ مثال: /unlocktopic [topic_id]');
    const ok = await unlockTopic(bot, chatId, topicId);
    if (!ok) return ctx.reply('❌ فشل فتح الموضوع.');
    const g = db.getGroup(chatId);
    if (g && g.topics.has(topicId)) g.topics.get(topicId).locked = false;
    await ctx.replyWithMarkdown(`🔓 *تم فتح الموضوع* \`${topicId}\``);
  });

  // /archivetopic
  bot.command('archivetopic', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.reply('❌ للمشرفين فقط!');
    const topicId = ctx.message.message_thread_id || Number(ctx.message.text.split(' ')[1]);
    if (!topicId) return ctx.reply('❌ مثال: /archivetopic [topic_id]');
    const ok = await archiveTopic(bot, chatId, topicId);
    if (!ok) return ctx.reply('❌ فشل أرشفة الموضوع.');
    const g = db.getGroup(chatId);
    if (g) {
      if (!g.topics.has(topicId)) g.topics.set(topicId, { approvedUsers: new Set() });
      const t    = g.topics.get(topicId);
      t.locked   = true;
      t.archived = true;
    }
    await ctx.replyWithMarkdown(`📦 *تم أرشفة الموضوع* \`${topicId}\``);
  });

  // /topicrequest — تفعيل/تعطيل موافقة دخول المواضيع
  bot.command('topicrequest', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.reply('❌ للمشرفين فقط!');
    const arg = ctx.message.text.split(' ')[1]?.toLowerCase();
    const g   = db.getGroup(chatId); if (!g) return;
    if (!g.topicSettings) g.topicSettings = { requireApprovalToJoin: false, autoLockOnCreate: false, ownerBypassAll: true };
    if (arg === 'on') {
      g.topicSettings.requireApprovalToJoin = true;
      await ctx.replyWithMarkdown('✅ *تم تفعيل موافقة دخول المواضيع*\n\nأي شخص يرسل في موضوع مقفل سيُرسل طلب للمالك.');
    } else if (arg === 'off') {
      g.topicSettings.requireApprovalToJoin = false;
      await ctx.replyWithMarkdown('❌ *تم تعطيل موافقة دخول المواضيع*');
    } else {
      const status = g.topicSettings.requireApprovalToJoin ? '✅ مفعّل' : '❌ معطّل';
      await ctx.replyWithMarkdown(`🗂️ *موافقة دخول المواضيع:* ${status}\n\nاستخدم: \`/topicrequest on\` أو \`/topicrequest off\``);
    }
  });

  // ── 4️⃣ب) /community_bans ──────────────────────────────────
  bot.command('community_bans', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const g = db.getGroup(ctx.chat.id);
    if (!isDeveloper(ctx) && !await isAdmin(bot, ctx.chat.id, ctx.from.id))
      return ctx.reply('❌ للمشرفين فقط!');
    if (!g?.communityId) return ctx.reply('❌ هذه المجموعة ليست ضمن مجتمع.');
    const com = db.getCommunity(g.communityId);
    if (!com || !com.autoBannedUsers?.size) return ctx.reply('✅ لا يوجد محظورون تلقائياً في المجتمع.');
    let text = `🚫 *المحظورون تلقائياً — مجتمع ${com.title}*\n\n`;
    let count = 0;
    for (const [uid, info] of com.autoBannedUsers) {
      if (count >= 20) { text += `\n_... والمزيد_`; break; }
      text += `👤 \`${uid}\`\n📝 ${info.reason}\n📋 ${info.groups || '—'}\n🕐 ${new Date(info.bannedAt).toLocaleDateString('ar')}\n\n`;
      count++;
    }
    await ctx.replyWithMarkdown(text);
  });

  // ════════════════════════════════════════════════════════════
  //  Toggle Callbacks
  // ════════════════════════════════════════════════════════════

  // ── 1️⃣ toggle_protect — مُصلَح: يستدعي setChatProtectContent ──
  bot.action(/^toggle_protect_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const g = db.getGroup(chatId); if (!g) return;
    g.protectContent = !g.protectContent;

    // ── استدعاء Telegram API الفعلي ──
    try {
      await bot.telegram.callApi('setChatProtectContent', {
        chat_id:          chatId,
        protect_content:  g.protectContent,
      });
    } catch (e) {
      g.protectContent = !g.protectContent; // تراجع عند الخطأ
      return ctx.answerCbQuery(`❌ فشل: ${e.message}`, { show_alert: true });
    }

    const statusText = g.protectContent
      ? '🔒 *تم تفعيل حماية المحتوى*\n\nالرسائل في هذه المجموعة لا يمكن نسخها أو تصويرها.'
      : '🔓 *تم تعطيل حماية المحتوى*\n\nيمكن الآن نسخ الرسائل وتصويرها.';

    try {
      await ctx.editMessageText(
        `⚙️ *إعدادات ${g.title}*\n\n${statusText}\n\nاضغط لتفعيل/تعطيل:`,
        { parse_mode: 'Markdown', ...groupSettingsKeyboard(chatId, g) }
      );
    } catch {
      await ctx.replyWithMarkdown(statusText);
    }
  });

  // ── 2️⃣ toggle_joinreq — مُصلَح: يستدعي setJoinApproval ──────
  bot.action(/^toggle_joinreq_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const g = db.getGroup(chatId); if (!g) return;
    g.joinRequestsEnabled = !g.joinRequestsEnabled;

    const link = await setJoinApproval(bot, chatId, g.joinRequestsEnabled, g.perms);

    let statusText = g.joinRequestsEnabled
      ? `🔒 *تم تفعيل الموافقة على الانضمام*\n\nأي شخص يحاول الدخول سيُرسل طلب انضمام للمشرفين.`
      : `🔓 *تم تعطيل الموافقة على الانضمام*\n\nالدخول للمجموعة مباشر الآن.`;

    if (link?.invite_link) {
      statusText += `\n\n🔗 *الرابط الرسمي الجديد:*\n\`${link.invite_link}\``;
      // إرسال الرابط للمالك في الخاص
      if (g.ownerId) {
        try {
          await bot.telegram.sendMessage(g.ownerId,
            `🔗 *رابط دعوة جديد — ${g.title}*\n\n${link.invite_link}\n\n` +
            (g.joinRequestsEnabled ? '⚠️ هذا الرابط يتطلب موافقتك.' : '✅ دخول مباشر.'),
            { parse_mode: 'Markdown' }
          );
        } catch {}
      }
    }

    try {
      await ctx.editMessageText(
        `⚙️ *إعدادات ${g.title}*\n\n${statusText}\n\nاضغط لتفعيل/تعطيل:`,
        { parse_mode: 'Markdown', ...groupSettingsKeyboard(chatId, g) }
      );
    } catch {
      await ctx.replyWithMarkdown(statusText);
    }
  });

  bot.action(/^toggle_welcome_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const g = db.getGroup(chatId); if (!g) return;
    g.welcomeEnabled = !g.welcomeEnabled;
    try {
      await ctx.editMessageReplyMarkup(groupSettingsKeyboard(chatId, g).reply_markup);
    } catch {}
    await ctx.answerCbQuery(`${g.welcomeEnabled ? '✅ تم تفعيل' : '❌ تم تعطيل'} رسالة الترحيب`, { show_alert: true });
  });

  bot.action(/^toggle_mutenew_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const g = db.getGroup(chatId); if (!g) return;
    g.muteNewMembers = !g.muteNewMembers;
    try { await ctx.editMessageReplyMarkup(groupSettingsKeyboard(chatId, g).reply_markup); } catch {}
    await ctx.answerCbQuery(`${g.muteNewMembers ? '✅ تفعيل' : '❌ تعطيل'} كتم الجدد`, { show_alert: true });
  });

  bot.action(/^toggle_antispam_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const g = db.getGroup(chatId); if (!g) return;
    g.antiSpam = !g.antiSpam;
    try { await ctx.editMessageReplyMarkup(groupSettingsKeyboard(chatId, g).reply_markup); } catch {}
    await ctx.answerCbQuery(`${g.antiSpam ? '✅ تفعيل' : '❌ تعطيل'} مكافحة السبام`, { show_alert: true });
  });

  bot.action(/^toggle_antilinks_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const g = db.getGroup(chatId); if (!g) return;
    g.antiLinks = !g.antiLinks;
    try { await ctx.editMessageReplyMarkup(groupSettingsKeyboard(chatId, g).reply_markup); } catch {}
    await ctx.answerCbQuery(`${g.antiLinks ? '✅ تفعيل' : '❌ تعطيل'} منع الروابط`, { show_alert: true });
  });

  bot.action(/^toggle_antibot_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const g = db.getGroup(chatId); if (!g) return;
    g.antiBot = !g.antiBot;
    try { await ctx.editMessageReplyMarkup(groupSettingsKeyboard(chatId, g).reply_markup); } catch {}
    await ctx.answerCbQuery(`${g.antiBot ? '✅ تفعيل' : '❌ تعطيل'} منع البوتات`, { show_alert: true });
  });

  // ── 4️⃣د) toggle_community — تشغيل/إيقاف حماية المجتمع ──────
  bot.action(/^toggle_community_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const g = db.getGroup(chatId); if (!g || !g.communityId) return;
    const com = db.getCommunity(g.communityId); if (!com) return;
    com.enabled = !com.enabled;
    try { await ctx.editMessageReplyMarkup(groupSettingsKeyboard(chatId, g).reply_markup); } catch {}
    await ctx.answerCbQuery(
      `${com.enabled ? '✅ تفعيل' : '❌ تعطيل'} حماية المجتمع`,
      { show_alert: true }
    );
  });

  // ── لوحة صلاحيات الأعضاء toggles ────────────────────────────
  bot.action(/^perms_panel_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const g = db.getGroup(chatId); if (!g) return;
    try {
      await ctx.editMessageText(
        `🎛️ *صلاحيات الأعضاء — ${g.title}*`,
        { parse_mode: 'Markdown', ...permissionsDashboard(chatId, g.perms) }
      );
    } catch {}
  });

  async function togglePerm(ctx, chatId, permKey, label) {
    await ctx.answerCbQuery();
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const g = db.getGroup(chatId); if (!g) return;
    g.perms[permKey] = !g.perms[permKey];
    try {
      await applyGroupPermissions(bot, chatId, g.perms);
      await ctx.editMessageReplyMarkup(permissionsDashboard(chatId, g.perms).reply_markup);
      await ctx.answerCbQuery(`${g.perms[permKey] ? '✅' : '❌'} ${label}`, { show_alert: true });
    } catch (e) {
      g.perms[permKey] = !g.perms[permKey];
      await ctx.answerCbQuery(`❌ ${e.message}`, { show_alert: true });
    }
  }

  bot.action(/^perm_msg_(-?\d+)$/,     (ctx) => togglePerm(ctx, Number(ctx.match[1]), 'canSendMessages',   'إرسال رسائل'));
  bot.action(/^perm_media_(-?\d+)$/,   (ctx) => togglePerm(ctx, Number(ctx.match[1]), 'canSendMedia',      'إرسال وسائط'));
  bot.action(/^perm_polls_(-?\d+)$/,   (ctx) => togglePerm(ctx, Number(ctx.match[1]), 'canSendPolls',      'إرسال استطلاعات'));
  bot.action(/^perm_preview_(-?\d+)$/, (ctx) => togglePerm(ctx, Number(ctx.match[1]), 'canAddWebPreviews', 'معاينة روابط'));
  bot.action(/^perm_invite_(-?\d+)$/,  (ctx) => togglePerm(ctx, Number(ctx.match[1]), 'canInviteUsers',    'دعوة مستخدمين'));
  bot.action(/^perm_pin_(-?\d+)$/,     (ctx) => togglePerm(ctx, Number(ctx.match[1]), 'canPinMessages',    'تثبيت رسائل'));
  bot.action(/^perm_topics_(-?\d+)$/,  (ctx) => togglePerm(ctx, Number(ctx.match[1]), 'canManageTopics',   'إدارة المواضيع'));

  // ── 3️⃣ لوحة المواضيع ─────────────────────────────────────────
  bot.action(/^topics_panel_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const g = db.getGroup(chatId); if (!g) return;
    try {
      await ctx.editMessageText(
        `🗂️ *إدارة المواضيع — ${g.title}*\n\nالأوامر المتاحة:\n/locktopic — قفل موضوع\n/unlocktopic — فتح موضوع\n/archivetopic — أرشفة موضوع\n/topicrequest on/off — موافقة الدخول`,
        { parse_mode: 'Markdown', ...topicsPanelKeyboard(chatId, g.topicSettings) }
      );
    } catch {}
  });

  bot.action(/^toggle_topicapproval_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const g = db.getGroup(chatId); if (!g) return;
    if (!g.topicSettings) g.topicSettings = { requireApprovalToJoin: false, autoLockOnCreate: false, ownerBypassAll: true };
    g.topicSettings.requireApprovalToJoin = !g.topicSettings.requireApprovalToJoin;
    try { await ctx.editMessageReplyMarkup(topicsPanelKeyboard(chatId, g.topicSettings).reply_markup); } catch {}
    await ctx.answerCbQuery(`${g.topicSettings.requireApprovalToJoin ? '✅ تفعيل' : '❌ تعطيل'} موافقة المواضيع`, { show_alert: true });
  });

  bot.action(/^toggle_autolock_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const g = db.getGroup(chatId); if (!g) return;
    if (!g.topicSettings) g.topicSettings = { requireApprovalToJoin: false, autoLockOnCreate: false, ownerBypassAll: true };
    g.topicSettings.autoLockOnCreate = !g.topicSettings.autoLockOnCreate;
    try { await ctx.editMessageReplyMarkup(topicsPanelKeyboard(chatId, g.topicSettings).reply_markup); } catch {}
    await ctx.answerCbQuery(`${g.topicSettings.autoLockOnCreate ? '✅ تفعيل' : '❌ تعطيل'} القفل التلقائي`, { show_alert: true });
  });

  // ── logchannel_info ─────────────────────────────────────────
  bot.action(/^logchannel_info_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId); if (!g) return;
    const info = g.logChannelId
      ? `✅ قناة السجلات: \`${g.logChannelId}\`\n\nلتغييرها: \`/setlogchannel -100...\`\nلإلغائها: \`/setlogchannel\``
      : '❌ لا توجد قناة سجلات.\n\nلتعيينها: `/setlogchannel -100123456789`';
    await ctx.answerCbQuery();
    await ctx.replyWithMarkdown(info);
  });

  // ── owner_panel ─────────────────────────────────────────────
  bot.action(/^owner_panel_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId);
    if (!g) return ctx.answerCbQuery('❌ بيانات غير موجودة', { show_alert: true });
    const canAccess = isDeveloper(ctx) || g.ownerId === ctx.from.id || g.admins.has(ctx.from.id);
    if (!canAccess) return ctx.answerCbQuery('❌ ليس لديك صلاحية!', { show_alert: true });
    try {
      await ctx.editMessageText(
        `⚙️ *إعدادات ${g.title}*\n\nاضغط لتفعيل/تعطيل:`,
        { parse_mode: 'Markdown', ...groupSettingsKeyboard(chatId, g) }
      );
    } catch {
      await ctx.replyWithMarkdown(
        `⚙️ *إعدادات ${g.title}*\n\nاضغط لتفعيل/تعطيل:`,
        groupSettingsKeyboard(chatId, g)
      );
    }
  });

  // ── settings_${chatId} ─────────────────────────────────────
  bot.action(/^settings_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const g = db.getGroup(chatId); if (!g) return;
    try {
      await ctx.editMessageText(
        `⚙️ *إعدادات ${g.title}*\n\nاضغط لتفعيل/تعطيل:`,
        { parse_mode: 'Markdown', ...groupSettingsKeyboard(chatId, g) }
      );
    } catch {}
  });

  // ── group_home ─────────────────────────────────────────────
  bot.action(/^group_home_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId); if (!g) return;
    try {
      await ctx.editMessageText(
        `🏠 *${g.title}*\n\nاختر ما تريد:`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('⚙️ الإعدادات', `settings_${chatId}`), Markup.button.callback('📊 إحصائيات', `stats_${chatId}`)],
            [Markup.button.callback('📨 طلبات الانضمام', `joinreqs_${chatId}`)],
          ]),
        }
      );
    } catch {}
  });

  // ── /joinreqs — عرض الطلبات المعلقة ──────────────────────
  bot.command('joinreqs', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.reply('❌ للمشرفين فقط!');
    const g = db.getGroup(chatId);
    const pending = g ? [...g.joinRequests.values()].filter(r => r.status === 'pending') : [];
    if (!pending.length) return ctx.replyWithMarkdown('✅ *لا توجد طلبات انضمام معلقة.*');
    let text = `📨 *طلبات الانضمام المعلقة* (${pending.length})\n\n`;
    pending.slice(0, 10).forEach((r, i) => {
      text += `${i + 1}. ${r.firstName}${r.username ? ` (@${r.username})` : ''} \`[${r.userId}]\`\n`;
    });
    const btns = pending.slice(0, 5).flatMap(r => [[
      Markup.button.callback(`✅ ${r.firstName.slice(0, 12)}`, `jr_approve_${r.userId}_${chatId}`),
      Markup.button.callback('❌', `jr_reject_${r.userId}_${chatId}`),
    ]]);
    await ctx.replyWithMarkdown(text, Markup.inlineKeyboard(btns));
  });

  // ── edit_welcome / edit_rules callbacks ─────────────────────
  bot.action(/^edit_welcome_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const g = db.getGroup(chatId);
    await ctx.replyWithMarkdown(
      `✏️ *تعديل رسالة الترحيب*\n\nالرسالة الحالية:\n_${g?.welcomeMessage || 'لا توجد'}_\n\nاستخدم: \`/setwelcome نص جديد\`\nالمتغيرات: \`{name}\` \`{group}\` \`{username}\``
    );
  });

  bot.action(/^edit_rules_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const g = db.getGroup(chatId);
    await ctx.replyWithMarkdown(
      `📋 *تعديل القواعد*\n\nالقواعد الحالية:\n_${g?.rules || 'لا توجد'}_\n\nاستخدم: \`/setrules القواعد الجديدة\``
    );
  });

  bot.action(/^bwords_list_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId);
    if (!g || !g.bannedWords.length) return ctx.answerCbQuery('❌ لا توجد كلمات محظورة', { show_alert: true });
    const ar   = { warn: '⚠️', mute: '🔇', kick: '👢', ban: '🚫' };
    let text   = `🔤 *الكلمات المحظورة* (${g.bannedWords.length})\n\n`;
    g.bannedWords.slice(0, 20).forEach((bw, i) => {
      text += `${i + 1}. \`${bw.word}\` ${ar[bw.action] || ''}\n`;
    });
    await ctx.replyWithMarkdown(text);
  });

  bot.action(/^set_maxwarns_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId);
    await ctx.replyWithMarkdown(
      `⚙️ *الحد الأقصى للتحذيرات*\n\nالحالي: \`${g?.maxWarns || 3}\`\n\nاستخدم: \`/setmaxwarns [رقم 1-10]\``
    );
  });

  bot.action(/^auditlog_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const g = db.getGroup(chatId);
    if (!g?.auditLog?.length) return ctx.answerCbQuery('❌ السجل فارغ', { show_alert: true });
    let text = `📋 *سجل الإجراءات — ${g.title}*\n\n`;
    g.auditLog.slice(0, 10).forEach(e => {
      text += `• *${e.action}* — @${e.by?.username || e.by?.id} ← @${e.target?.username || e.target?.id}\n`;
      if (e.details) text += `  📝 ${e.details}\n`;
      text += `  🕐 ${new Date(e.at).toLocaleString('ar')}\n\n`;
    });
    await ctx.replyWithMarkdown(text);
  });

  },
};
