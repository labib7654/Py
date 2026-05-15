// handler_owner.js — إعدادات المجموعة + نظام المتخصصين — جامعة v5.0
const { Markup } = require('telegraf');
const db         = require('./db');
const supa       = require('./supabase');
const {
  isDeveloper, isAdmin, isOwner,
  applyGroupPermissions, logAction,
  setJoinApproval, verifyAndRegisterOwner,
  lockTopic, unlockTopic, archiveTopic,
} = require('./helpers');

// ── Map لتتبع جلسات إضافة كلمات محظورة ─────────────────────────
const pendingAddWord = new Map();
// ── Map لتتبع جلسات إضافة كلمات التوجيه ─────────────────────────
const pendingAddKeyword = new Map();
// ── Map لتتبع جلسات إضافة المتخصصين ─────────────────────────────
const pendingAddSpecialist = new Map();

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
    [
      Markup.button.callback(`${s.captchaEnabled ? '✅' : '❌'} CAPTCHA`,       `toggle_captcha_${chatId}`),
    ],
    ...(com ? [[Markup.button.callback(`${com.enabled ? '✅' : '❌'} 🏫 حماية المجتمع`, `toggle_community_${chatId}`)]] : []),
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
      Markup.button.callback('👨‍💼 المتخصصون',       `specialists_panel_${chatId}`),
      Markup.button.callback('🔑 كلمات التوجيه',   `routing_panel_${chatId}`),
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
    const g = await db.getGroup(chatId);
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
    const g = await db.getGroup(chatId);
    if (!g) return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.reply('❌ للمشرفين فقط!');
    try {
      await bot.telegram.sendMessage(
        ctx.from.id,
        `🔐 *لوحة تحكم ${g.title}*\n\nمرحباً ${ctx.from.first_name}، اضغط أدناه للتحكم:`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([[Markup.button.callback(`⚙️ إعدادات ${g.title.slice(0, 20)}`, `owner_panel_${chatId}`)]]),
        }
      );
      await ctx.reply('✅ تم إرسال لوحة التحكم إلى خاصك.', { reply_to_message_id: ctx.message.message_id });
    } catch {
      await ctx.reply(
        '❌ تعذر إرسال الرسالة، ابدأ محادثة مع البوت أولاً.',
        Markup.inlineKeyboard([[Markup.button.url('🔓 افتح الخاص', `https://t.me/${ctx.botInfo.username}?start=panel_${chatId}`)]])
      );
    }
  });

  // ── /setwelcome ────────────────────────────────────────────
  bot.command('setwelcome', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, ctx.chat.id, ctx.from.id))
      return ctx.reply('❌ للمشرفين فقط!');
    const text = ctx.message.text.replace('/setwelcome', '').trim();
    if (!text) return ctx.replyWithMarkdown('📝 `/setwelcome نص`\nالمتغيرات: `{name}` `{group}` `{username}`');
    const g = await db.getGroup(ctx.chat.id); if (!g) return;
    g.welcomeMessage = text;
    db.scheduleSync(g);
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
    const g = await db.getGroup(ctx.chat.id); if (!g) return;
    g.rules = text;
    db.scheduleSync(g);
    await ctx.replyWithMarkdown(`✅ *تم تعيين القواعد*\n\n${text}`);
  });

  // ── /setmaxwarns ───────────────────────────────────────────
  bot.command('setmaxwarns', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    if (!isDeveloper(ctx) && !await isOwner(bot, ctx.chat.id, ctx.from.id))
      return ctx.reply('❌ للمالك فقط!');
    const n = Number(ctx.message.text.split(' ')[1]);
    if (!n || n < 1 || n > 10) return ctx.reply('❌ مثال: /setmaxwarns 3  (النطاق: 1-10)');
    const g = await db.getGroup(ctx.chat.id); if (!g) return;
    g.maxWarns = n;
    db.scheduleSync(g);
    await ctx.replyWithMarkdown(`✅ الحد الأقصى للتحذيرات: \`${n}\``);
  });

  // ── /setlogchannel ─────────────────────────────────────────
  bot.command('setlogchannel', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    if (!isDeveloper(ctx) && !await isOwner(bot, ctx.chat.id, ctx.from.id))
      return ctx.reply('❌ للمالك فقط!');
    const arg = ctx.message.text.split(' ')[1];
    const g   = await db.getGroup(ctx.chat.id); if (!g) return;
    if (!arg) { g.logChannelId = null; db.scheduleSync(g); return ctx.reply('✅ تم إلغاء قناة السجلات.'); }
    const channelId = Number(arg);
    if (!channelId) return ctx.reply('❌ مثال: /setlogchannel -100123456789');
    g.logChannelId = channelId;
    db.scheduleSync(g);
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
    if (!word) return ctx.replyWithMarkdown('📌 `/addword <كلمة> <إجراء> <عدد_مرات>`\n\nالإجراءات: `warn` | `mute` | `kick` | `ban`');
    if (!['warn', 'mute', 'kick', 'ban'].includes(action)) return ctx.reply('❌ الإجراء غير صحيح!');
    if (threshold < 1 || threshold > 5) return ctx.reply('❌ عدد المرات بين 1 و 5');
    const g = await db.getGroup(ctx.chat.id); if (!g) return;
    if (g.bannedWords.find(bw => bw.word.toLowerCase() === word.toLowerCase())) return ctx.reply('❌ الكلمة موجودة مسبقاً!');
    g.bannedWords.push({ word, action, threshold, addedBy: ctx.from.id, addedAt: new Date() });
    await supa.addBannedWord(ctx.chat.id, word, action, threshold, ctx.from.id);
    const arAct = { warn: '⚠️ تحذير', mute: '🔇 كتم', kick: '👢 طرد', ban: '🚫 حظر' };
    await ctx.replyWithMarkdown(`✅ *تمت إضافة الكلمة المحظورة*\n\n🔤 \`${word}\`\n⚡ الإجراء: ${arAct[action]}\n🔁 بعد: \`${threshold}\` مرة`);
  });

  // ── /removeword ────────────────────────────────────────────
  bot.command('removeword', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, ctx.chat.id, ctx.from.id)) return ctx.reply('❌ للمشرفين فقط!');
    const word = ctx.message.text.split(' ').slice(1).join(' ').trim();
    if (!word) return ctx.reply('📌 مثال: /removeword كلمة');
    const g = await db.getGroup(ctx.chat.id); if (!g) return;
    const before = g.bannedWords.length;
    g.bannedWords = g.bannedWords.filter(bw => bw.word.toLowerCase() !== word.toLowerCase());
    if (g.bannedWords.length === before) return ctx.reply('❌ الكلمة غير موجودة!');
    await supa.removeBannedWord(ctx.chat.id, word);
    await ctx.replyWithMarkdown(`✅ *تمت الإزالة:* \`${word}\``);
  });

  // ── /words ─────────────────────────────────────────────────
  bot.command('words', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const g = await db.getGroup(ctx.chat.id);
    if (!g || !g.bannedWords.length)
      return ctx.reply('🔤 لا توجد كلمات محظورة.\n\n`/addword` لإضافة كلمة.');
    const ar   = { warn: '⚠️', mute: '🔇', kick: '👢', ban: '🚫' };
    let text   = `🔤 *الكلمات المحظورة* (${g.bannedWords.length})\n\n`;
    g.bannedWords.forEach((bw, i) => {
      text += `${i + 1}. \`${bw.word}\` ${ar[bw.action] || ''} — بعد \`${bw.threshold || 1}\` مرة\n`;
    });
    await ctx.replyWithMarkdown(text);
  });

  // ══════════════════════════════════════════════════════════════
  //  🆕 نظام المتخصصين — أوامر
  // ══════════════════════════════════════════════════════════════

  // /addspecialist @username [وصف التخصص]
  bot.command('addspecialist', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.reply('❌ للمشرفين فقط!');
    const args    = ctx.message.text.split(' ').slice(1);
    const target  = args[0];
    const specialty = args.slice(1).join(' ').trim() || 'متخصص';
    if (!target) return ctx.replyWithMarkdown('📌 مثال:\n`/addspecialist @username وصف التخصص`\nأو:\n`/addspecialist 123456789 وصف التخصص`');
    let userId, username = '', firstName = '';
    if (target.startsWith('@')) {
      try {
        const member = await bot.telegram.getChatMember(chatId, target.replace('@', ''));
        userId    = member.user.id;
        username  = member.user.username || '';
        firstName = member.user.first_name || '';
      } catch { return ctx.reply('❌ لم أتمكن من إيجاد هذا المستخدم في المجموعة!'); }
    } else if (/^\d+$/.test(target)) {
      userId    = Number(target);
      firstName = target;
    } else { return ctx.reply('❌ استخدم @username أو user_id'); }
    await supa.addSpecialist(chatId, userId, username, firstName, specialty, ctx.from.id);
    await ctx.replyWithMarkdown(
      `✅ *تمت إضافة المتخصص!*\n\n` +
      `👨‍💼 ${username ? `@${username}` : firstName} \`[${userId}]\`\n` +
      `📋 التخصص: ${specialty}\n\n` +
      `⚠️ تأكد من أن المتخصص قد بدأ محادثة مع البوت (أرسل /start للبوت).`
    );
  });

  // /removespecialist @username أو user_id
  bot.command('removespecialist', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.reply('❌ للمشرفين فقط!');
    const target = ctx.message.text.split(' ')[1];
    if (!target) return ctx.reply('📌 مثال: /removespecialist @username');
    let userId;
    if (target.startsWith('@')) {
      try {
        const member = await bot.telegram.getChatMember(chatId, target.replace('@', ''));
        userId = member.user.id;
      } catch { return ctx.reply('❌ لم أتمكن من إيجاد هذا المستخدم!'); }
    } else if (/^\d+$/.test(target)) {
      userId = Number(target);
    } else { return ctx.reply('❌ استخدم @username أو user_id'); }
    await supa.removeSpecialist(chatId, userId);
    await ctx.replyWithMarkdown(`✅ *تمت إزالة المتخصص:* \`${userId}\``);
  });

  // /specialists — عرض كل المتخصصين
  bot.command('specialists', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.reply('❌ للمشرفين فقط!');
    const specialists = await supa.getSpecialists(chatId);
    if (!specialists.length) return ctx.reply('👨‍💼 لا يوجد متخصصون بعد.\n\n`/addspecialist @username تخصص` لإضافة.');
    let text = `👨‍💼 *المتخصصون* (${specialists.length})\n\n`;
    for (const s of specialists) {
      text += `• ${s.username ? `@${s.username}` : s.first_name} \`[${s.user_id}]\`\n  📋 ${s.specialty || 'متخصص'}\n`;
    }
    await ctx.replyWithMarkdown(text);
  });

  // ══════════════════════════════════════════════════════════════
  //  🆕 كلمات التوجيه — أوامر
  // ══════════════════════════════════════════════════════════════

  // /addkeyword [كلمة] [@متخصص]
  bot.command('addkeyword', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.reply('❌ للمشرفين فقط!');
    const args      = ctx.message.text.split(' ').slice(1);
    const keyword   = args[0];
    const specialist = args[1]; // اختياري @username أو user_id
    if (!keyword) return ctx.replyWithMarkdown('📌 مثال:\n`/addkeyword كلمة` — لأي متخصص متاح\n`/addkeyword كلمة @username` — لمتخصص محدد');
    let specialistId = null;
    if (specialist) {
      if (specialist.startsWith('@')) {
        try {
          const member = await bot.telegram.getChatMember(chatId, specialist.replace('@', ''));
          specialistId = member.user.id;
        } catch { return ctx.reply('❌ لم أتمكن من إيجاد هذا المستخدم!'); }
      } else if (/^\d+$/.test(specialist)) {
        specialistId = Number(specialist);
      }
    }
    await supa.addRoutingKeyword(chatId, keyword, specialistId, ctx.from.id);
    await ctx.replyWithMarkdown(
      `✅ *تمت إضافة كلمة التوجيه:* \`${keyword}\`\n` +
      (specialistId ? `👨‍💼 مرتبطة بمتخصص محدد: \`${specialistId}\`` : '👥 تُوجَّه لأي متخصص متاح')
    );
  });

  // /removekeyword [كلمة]
  bot.command('removekeyword', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId  = ctx.chat.id;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.reply('❌ للمشرفين فقط!');
    const keyword = ctx.message.text.split(' ').slice(1).join(' ').trim();
    if (!keyword) return ctx.reply('📌 مثال: /removekeyword كلمة');
    await supa.removeRoutingKeyword(chatId, keyword);
    await ctx.replyWithMarkdown(`✅ *تمت إزالة كلمة التوجيه:* \`${keyword}\``);
  });

  // /keywords — عرض كل كلمات التوجيه
  bot.command('keywords', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId   = ctx.chat.id;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.reply('❌ للمشرفين فقط!');
    const keywords = await supa.getRoutingKeywords(chatId);
    if (!keywords.length) return ctx.reply('🔑 لا توجد كلمات توجيه بعد.\n\n`/addkeyword كلمة` لإضافة.');
    let text = `🔑 *كلمات التوجيه* (${keywords.length})\n\n`;
    for (const kw of keywords) {
      text += `• \`${kw.keyword}\` — ${kw.specialist_id ? `متخصص: \`${kw.specialist_id}\`` : 'أي متخصص'}\n`;
    }
    await ctx.replyWithMarkdown(text);
  });

  // ── أوامر المواضيع ────────────────────────────────────────
  bot.command('locktopic', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId  = ctx.chat.id;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return ctx.reply('❌ للمشرفين فقط!');
    const topicId = ctx.message.message_thread_id || Number(ctx.message.text.split(' ')[1]);
    if (!topicId) return ctx.reply('❌ مثال: /locktopic [topic_id] أو ارد على رسالة في الموضوع');
    const ok = await lockTopic(bot, chatId, topicId);
    if (!ok) return ctx.reply('❌ فشل قفل الموضوع.');
    const g = await db.getGroup(chatId);
    if (g) {
      if (!g.topics.has(topicId)) g.topics.set(topicId, { approvedUsers: new Set() });
      g.topics.get(topicId).locked = true;
    }
    await ctx.replyWithMarkdown(`🔒 *تم قفل الموضوع* \`${topicId}\``);
  });

  bot.command('unlocktopic', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId  = ctx.chat.id;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return ctx.reply('❌ للمشرفين فقط!');
    const topicId = ctx.message.message_thread_id || Number(ctx.message.text.split(' ')[1]);
    if (!topicId) return ctx.reply('❌ مثال: /unlocktopic [topic_id]');
    const ok = await unlockTopic(bot, chatId, topicId);
    if (!ok) return ctx.reply('❌ فشل فتح الموضوع.');
    const g = await db.getGroup(chatId);
    if (g && g.topics.has(topicId)) g.topics.get(topicId).locked = false;
    await ctx.replyWithMarkdown(`🔓 *تم فتح الموضوع* \`${topicId}\``);
  });

  bot.command('archivetopic', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId  = ctx.chat.id;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return ctx.reply('❌ للمشرفين فقط!');
    const topicId = ctx.message.message_thread_id || Number(ctx.message.text.split(' ')[1]);
    if (!topicId) return ctx.reply('❌ مثال: /archivetopic [topic_id]');
    const ok = await archiveTopic(bot, chatId, topicId);
    if (!ok) return ctx.reply('❌ فشل أرشفة الموضوع.');
    const g = await db.getGroup(chatId);
    if (g) {
      if (!g.topics.has(topicId)) g.topics.set(topicId, { approvedUsers: new Set() });
      const t = g.topics.get(topicId);
      t.locked = true; t.archived = true;
    }
    await ctx.replyWithMarkdown(`📦 *تم أرشفة الموضوع* \`${topicId}\``);
  });

  bot.command('topicrequest', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return ctx.reply('❌ للمشرفين فقط!');
    const arg = ctx.message.text.split(' ')[1]?.toLowerCase();
    const g   = await db.getGroup(chatId); if (!g) return;
    if (!g.topicSettings) g.topicSettings = { requireApprovalToJoin: false, autoLockOnCreate: false, ownerBypassAll: true };
    if (arg === 'on')  { g.topicSettings.requireApprovalToJoin = true;  await ctx.replyWithMarkdown('✅ *تم تفعيل موافقة دخول المواضيع*'); }
    else if (arg === 'off') { g.topicSettings.requireApprovalToJoin = false; await ctx.replyWithMarkdown('❌ *تم تعطيل موافقة دخول المواضيع*'); }
    else { await ctx.replyWithMarkdown(`🗂️ الوضع الحالي: ${g.topicSettings.requireApprovalToJoin ? '✅ مفعّل' : '❌ معطّل'}\n\nاستخدم: \`/topicrequest on\` أو \`/topicrequest off\``); }
    db.scheduleSync(g);
  });

  bot.command('community_bans', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const g = await db.getGroup(ctx.chat.id);
    if (!isDeveloper(ctx) && !await isAdmin(bot, ctx.chat.id, ctx.from.id)) return ctx.reply('❌ للمشرفين فقط!');
    if (!g?.communityId) return ctx.reply('❌ هذه المجموعة ليست ضمن مجتمع.');
    const com = db.getCommunity(g.communityId);
    if (!com || !com.autoBannedUsers?.size) return ctx.reply('✅ لا يوجد محظورون تلقائياً في المجتمع.');
    let text = `🚫 *المحظورون تلقائياً — مجتمع ${com.title}*\n\n`;
    let count = 0;
    for (const [uid, info] of com.autoBannedUsers) {
      if (count >= 20) { text += `\n_... والمزيد_`; break; }
      text += `👤 \`${uid}\`\n📝 ${info.reason}\n🕐 ${new Date(info.bannedAt).toLocaleDateString('ar')}\n\n`;
      count++;
    }
    await ctx.replyWithMarkdown(text);
  });

  // ════════════════════════════════════════════════════════════
  //  Toggle Callbacks
  // ════════════════════════════════════════════════════════════

  bot.action(/^toggle_protect_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const g = await db.getGroup(chatId); if (!g) return;
    g.protectContent = !g.protectContent;
    try {
      await bot.telegram.callApi('setChatProtectContent', { chat_id: chatId, protect_content: g.protectContent });
      db.scheduleSync(g);
    } catch (e) { g.protectContent = !g.protectContent; return ctx.answerCbQuery(`❌ فشل: ${e.message}`, { show_alert: true }); }
    try { await ctx.editMessageReplyMarkup(groupSettingsKeyboard(chatId, g).reply_markup); } catch {}
    await ctx.answerCbQuery(`${g.protectContent ? '🔒 تفعيل' : '🔓 تعطيل'} حماية المحتوى`, { show_alert: true });
  });

  bot.action(/^toggle_joinreq_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const g = await db.getGroup(chatId); if (!g) return;
    g.joinRequestsEnabled = !g.joinRequestsEnabled;
    const link = await setJoinApproval(bot, chatId, g.joinRequestsEnabled, g.perms);
    db.scheduleSync(g);
    if (link?.invite_link && g.ownerId) {
      try { await bot.telegram.sendMessage(g.ownerId, `🔗 رابط دعوة جديد:\n${link.invite_link}`, { parse_mode: 'Markdown' }); } catch {}
    }
    try { await ctx.editMessageReplyMarkup(groupSettingsKeyboard(chatId, g).reply_markup); } catch {}
    await ctx.answerCbQuery(`${g.joinRequestsEnabled ? '🔒 تفعيل' : '🔓 تعطيل'} موافقة الانضمام`, { show_alert: true });
  });

  bot.action(/^toggle_welcome_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const g = await db.getGroup(chatId); if (!g) return;
    g.welcomeEnabled = !g.welcomeEnabled;
    db.scheduleSync(g);
    try { await ctx.editMessageReplyMarkup(groupSettingsKeyboard(chatId, g).reply_markup); } catch {}
    await ctx.answerCbQuery(`${g.welcomeEnabled ? '✅ تفعيل' : '❌ تعطيل'} رسالة الترحيب`, { show_alert: true });
  });

  bot.action(/^toggle_mutenew_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const g = await db.getGroup(chatId); if (!g) return;
    g.muteNewMembers = !g.muteNewMembers;
    db.scheduleSync(g);
    try { await ctx.editMessageReplyMarkup(groupSettingsKeyboard(chatId, g).reply_markup); } catch {}
    await ctx.answerCbQuery(`${g.muteNewMembers ? '✅ تفعيل' : '❌ تعطيل'} كتم الجدد`, { show_alert: true });
  });

  bot.action(/^toggle_antispam_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const g = await db.getGroup(chatId); if (!g) return;
    g.antiSpam = !g.antiSpam;
    db.scheduleSync(g);
    try { await ctx.editMessageReplyMarkup(groupSettingsKeyboard(chatId, g).reply_markup); } catch {}
    await ctx.answerCbQuery(`${g.antiSpam ? '✅ تفعيل' : '❌ تعطيل'} مكافحة السبام`, { show_alert: true });
  });

  bot.action(/^toggle_antilinks_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const g = await db.getGroup(chatId); if (!g) return;
    g.antiLinks = !g.antiLinks;
    db.scheduleSync(g);
    try { await ctx.editMessageReplyMarkup(groupSettingsKeyboard(chatId, g).reply_markup); } catch {}
    await ctx.answerCbQuery(`${g.antiLinks ? '✅ تفعيل' : '❌ تعطيل'} منع الروابط`, { show_alert: true });
  });

  bot.action(/^toggle_antibot_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const g = await db.getGroup(chatId); if (!g) return;
    g.antiBot = !g.antiBot;
    db.scheduleSync(g);
    try { await ctx.editMessageReplyMarkup(groupSettingsKeyboard(chatId, g).reply_markup); } catch {}
    await ctx.answerCbQuery(`${g.antiBot ? '✅ تفعيل' : '❌ تعطيل'} منع البوتات`, { show_alert: true });
  });

  bot.action(/^toggle_captcha_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const g = await db.getGroup(chatId); if (!g) return;
    g.captchaEnabled = !g.captchaEnabled;
    db.scheduleSync(g);
    try { await ctx.editMessageReplyMarkup(groupSettingsKeyboard(chatId, g).reply_markup); } catch {}
    await ctx.answerCbQuery(`${g.captchaEnabled ? '✅ تفعيل' : '❌ تعطيل'} CAPTCHA`, { show_alert: true });
  });

  bot.action(/^toggle_community_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const g = await db.getGroup(chatId); if (!g || !g.communityId) return;
    const com = db.getCommunity(g.communityId); if (!com) return;
    com.enabled = !com.enabled;
    try { await ctx.editMessageReplyMarkup(groupSettingsKeyboard(chatId, g).reply_markup); } catch {}
    await ctx.answerCbQuery(`${com.enabled ? '✅ تفعيل' : '❌ تعطيل'} حماية المجتمع`, { show_alert: true });
  });

  // ── لوحة صلاحيات الأعضاء ────────────────────────────────
  bot.action(/^perms_panel_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const g = await db.getGroup(chatId); if (!g) return;
    try { await ctx.editMessageText(`🎛️ *صلاحيات الأعضاء — ${g.title}*`, { parse_mode: 'Markdown', ...permissionsDashboard(chatId, g.perms) }); } catch {}
  });

  async function togglePerm(ctx, chatId, permKey, label) {
    await ctx.answerCbQuery();
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const g = await db.getGroup(chatId); if (!g) return;
    g.perms[permKey] = !g.perms[permKey];
    try {
      await applyGroupPermissions(bot, chatId, g.perms);
      db.scheduleSync(g);
      await ctx.editMessageReplyMarkup(permissionsDashboard(chatId, g.perms).reply_markup);
      await ctx.answerCbQuery(`${g.perms[permKey] ? '✅' : '❌'} ${label}`, { show_alert: true });
    } catch (e) { g.perms[permKey] = !g.perms[permKey]; await ctx.answerCbQuery(`❌ ${e.message}`, { show_alert: true }); }
  }

  bot.action(/^perm_msg_(-?\d+)$/,     (ctx) => togglePerm(ctx, Number(ctx.match[1]), 'canSendMessages',   'إرسال رسائل'));
  bot.action(/^perm_media_(-?\d+)$/,   (ctx) => togglePerm(ctx, Number(ctx.match[1]), 'canSendMedia',      'إرسال وسائط'));
  bot.action(/^perm_polls_(-?\d+)$/,   (ctx) => togglePerm(ctx, Number(ctx.match[1]), 'canSendPolls',      'إرسال استطلاعات'));
  bot.action(/^perm_preview_(-?\d+)$/, (ctx) => togglePerm(ctx, Number(ctx.match[1]), 'canAddWebPreviews', 'معاينة روابط'));
  bot.action(/^perm_invite_(-?\d+)$/,  (ctx) => togglePerm(ctx, Number(ctx.match[1]), 'canInviteUsers',    'دعوة مستخدمين'));
  bot.action(/^perm_pin_(-?\d+)$/,     (ctx) => togglePerm(ctx, Number(ctx.match[1]), 'canPinMessages',    'تثبيت رسائل'));
  bot.action(/^perm_topics_(-?\d+)$/,  (ctx) => togglePerm(ctx, Number(ctx.match[1]), 'canManageTopics',   'إدارة المواضيع'));

  // ── لوحة المواضيع ────────────────────────────────────────
  bot.action(/^topics_panel_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const g = await db.getGroup(chatId); if (!g) return;
    try { await ctx.editMessageText(
      `🗂️ *إدارة المواضيع — ${g.title}*\n\nالأوامر:\n/locktopic — قفل\n/unlocktopic — فتح\n/archivetopic — أرشفة\n/topicrequest on/off — موافقة الدخول`,
      { parse_mode: 'Markdown', ...topicsPanelKeyboard(chatId, g.topicSettings) }
    ); } catch {}
  });

  bot.action(/^toggle_topicapproval_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const g = await db.getGroup(chatId); if (!g) return;
    if (!g.topicSettings) g.topicSettings = { requireApprovalToJoin: false, autoLockOnCreate: false, ownerBypassAll: true };
    g.topicSettings.requireApprovalToJoin = !g.topicSettings.requireApprovalToJoin;
    db.scheduleSync(g);
    try { await ctx.editMessageReplyMarkup(topicsPanelKeyboard(chatId, g.topicSettings).reply_markup); } catch {}
    await ctx.answerCbQuery(`${g.topicSettings.requireApprovalToJoin ? '✅ تفعيل' : '❌ تعطيل'} موافقة المواضيع`, { show_alert: true });
  });

  bot.action(/^toggle_autolock_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const g = await db.getGroup(chatId); if (!g) return;
    if (!g.topicSettings) g.topicSettings = { requireApprovalToJoin: false, autoLockOnCreate: false, ownerBypassAll: true };
    g.topicSettings.autoLockOnCreate = !g.topicSettings.autoLockOnCreate;
    db.scheduleSync(g);
    try { await ctx.editMessageReplyMarkup(topicsPanelKeyboard(chatId, g.topicSettings).reply_markup); } catch {}
    await ctx.answerCbQuery(`${g.topicSettings.autoLockOnCreate ? '✅ تفعيل' : '❌ تعطيل'} القفل التلقائي`, { show_alert: true });
  });

  // ── لوحة قناة السجلات ───────────────────────────────────
  bot.action(/^logchannel_info_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = await db.getGroup(chatId); if (!g) return;
    const info = g.logChannelId
      ? `✅ قناة السجلات: \`${g.logChannelId}\`\n\nلتغييرها: \`/setlogchannel -100...\`\nلإلغائها: \`/setlogchannel\``
      : '❌ لا توجد قناة سجلات.\n\nلتعيينها: `/setlogchannel -100123456789`';
    await ctx.replyWithMarkdown(info);
  });

  // ══════════════════════════════════════════════════════════════
  //  🆕 لوحة المتخصصين — callback
  // ══════════════════════════════════════════════════════════════

  bot.action(/^specialists_panel_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const g = await db.getGroup(chatId); if (!g) return;
    const specialists = await supa.getSpecialists(chatId);
    let text = `👨‍💼 *المتخصصون في ${g.title}*\n\n`;
    if (specialists.length) {
      for (const s of specialists) {
        text += `• ${s.username ? `@${s.username}` : s.first_name} — ${s.specialty || 'متخصص'}\n`;
      }
    } else { text += '_لا يوجد متخصصون بعد._\n'; }
    text += `\n📝 لإضافة: \`/addspecialist @username تخصص\`\n📝 لإزالة: \`/removespecialist @username\``;
    const btns = [
      [Markup.button.callback('📋 عرض الكلمات المرتبطة', `routing_panel_${chatId}`)],
      [Markup.button.callback('🔙 رجوع', `settings_${chatId}`)],
    ];
    if (specialists.length > 0) {
      for (const s of specialists.slice(0, 5)) {
        const name = (s.username ? `@${s.username}` : s.first_name)?.slice(0, 15);
        btns.unshift([Markup.button.callback(`❌ إزالة ${name}`, `remove_specialist_${s.user_id}_${chatId}`)]);
      }
    }
    try { await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) }); } catch {}
  });

  bot.action(/^remove_specialist_(\d+)_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const uid    = Number(ctx.match[1]);
    const chatId = Number(ctx.match[2]);
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return ctx.answerCbQuery('❌ ممنوع', { show_alert: true });
    await supa.removeSpecialist(chatId, uid);
    await ctx.answerCbQuery('✅ تمت إزالة المتخصص!', { show_alert: true });
    // إعادة عرض اللوحة
    const g = await db.getGroup(chatId); if (!g) return;
    const specialists = await supa.getSpecialists(chatId);
    let text = `👨‍💼 *المتخصصون في ${g.title}*\n\n`;
    if (specialists.length) {
      for (const s of specialists) text += `• ${s.username ? `@${s.username}` : s.first_name} — ${s.specialty || 'متخصص'}\n`;
    } else { text += '_لا يوجد متخصصون بعد._\n'; }
    const btns = [
      [Markup.button.callback('📋 عرض الكلمات المرتبطة', `routing_panel_${chatId}`)],
      [Markup.button.callback('🔙 رجوع', `settings_${chatId}`)],
    ];
    for (const s of specialists.slice(0, 5)) {
      const name = (s.username ? `@${s.username}` : s.first_name)?.slice(0, 15);
      btns.unshift([Markup.button.callback(`❌ إزالة ${name}`, `remove_specialist_${s.user_id}_${chatId}`)]);
    }
    try { await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) }); } catch {}
  });

  // ══════════════════════════════════════════════════════════════
  //  🆕 لوحة كلمات التوجيه — callback
  // ══════════════════════════════════════════════════════════════

  bot.action(/^routing_panel_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const g = await db.getGroup(chatId); if (!g) return;
    const keywords = await supa.getRoutingKeywords(chatId);
    let text = `🔑 *كلمات التوجيه في ${g.title}*\n\n`;
    if (keywords.length) {
      for (const kw of keywords) {
        text += `• \`${kw.keyword}\` → ${kw.specialist_id ? `\`${kw.specialist_id}\`` : 'أي متخصص'}\n`;
      }
    } else { text += '_لا توجد كلمات توجيه بعد._\n'; }
    text += `\n📝 لإضافة: \`/addkeyword كلمة [@متخصص]\`\n📝 لإزالة: \`/removekeyword كلمة\``;
    const btns = [
      [Markup.button.callback('👨‍💼 المتخصصون', `specialists_panel_${chatId}`)],
      [Markup.button.callback('🔙 رجوع', `settings_${chatId}`)],
    ];
    if (keywords.length > 0) {
      for (const kw of keywords.slice(0, 5)) {
        btns.unshift([Markup.button.callback(`❌ إزالة: ${kw.keyword.slice(0,15)}`, `remove_keyword_${chatId}_${Buffer.from(kw.keyword).toString('base64').slice(0,20)}`)]);
      }
    }
    try { await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) }); } catch {}
  });

  // ── لوحة الكلمات المحظورة ────────────────────────────────────
  bot.action(/^bwords_list_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const g = await db.getGroup(chatId); if (!g) return;
    if (!g.bannedWords.length) {
      return ctx.answerCbQuery('📭 لا توجد كلمات محظورة', { show_alert: true });
    }
    const ar = { warn: '⚠️', mute: '🔇', kick: '👢', ban: '🚫' };
    let text = `🔤 *الكلمات المحظورة* (${g.bannedWords.length})\n\n`;
    g.bannedWords.slice(0, 20).forEach((bw, i) => {
      text += `${i + 1}. \`${bw.word}\` ${ar[bw.action] || ''} — بعد ${bw.threshold || 1} مرة\n`;
    });
    await ctx.replyWithMarkdown(text, Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', `settings_${chatId}`)]]));
  });

  // ── owner_panel / settings callbacks ───────────────────────────
  bot.action(/^owner_panel_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = await db.getGroup(chatId);
    if (!g) return ctx.answerCbQuery('❌ بيانات غير موجودة', { show_alert: true });
    const canAccess = isDeveloper(ctx) || g.ownerId === ctx.from.id || g.admins.has(ctx.from.id);
    if (!canAccess) return ctx.answerCbQuery('❌ ليس لديك صلاحية!', { show_alert: true });
    try {
      await ctx.editMessageText(`⚙️ *إعدادات ${g.title}*\n\nاضغط لتفعيل/تعطيل:`, { parse_mode: 'Markdown', ...groupSettingsKeyboard(chatId, g) });
    } catch {
      await ctx.replyWithMarkdown(`⚙️ *إعدادات ${g.title}*\n\nاضغط لتفعيل/تعطيل:`, groupSettingsKeyboard(chatId, g));
    }
  });

  bot.action(/^settings_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const g = await db.getGroup(chatId); if (!g) return;
    try { await ctx.editMessageText(`⚙️ *إعدادات ${g.title}*\n\nاضغط لتفعيل/تعطيل:`, { parse_mode: 'Markdown', ...groupSettingsKeyboard(chatId, g) }); } catch {}
  });

  bot.action(/^group_home_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = await db.getGroup(chatId); if (!g) return;
    try {
      await ctx.editMessageText(`🏠 *${g.title}*\n\nاختر ما تريد:`, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('⚙️ الإعدادات', `settings_${chatId}`), Markup.button.callback('📊 إحصائيات', `stats_${chatId}`)],
          [Markup.button.callback('📨 طلبات الانضمام', `joinreqs_${chatId}`)],
        ]),
      });
    } catch {}
  });

  // ── edit_welcome / edit_rules callbacks ─────────────────────
  bot.action(/^edit_welcome_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    pendingAddWord.set(`welcome_${chatId}_${ctx.from.id}`, { chatId, type: 'welcome' });
    await ctx.replyWithMarkdown(
      `✏️ *تعديل رسالة الترحيب*\n\nأرسل النص الجديد:\nالمتغيرات: \`{name}\` \`{group}\` \`{username}\`\n\n*للإلغاء:* أرسل /cancel`
    );
  });

  bot.action(/^edit_rules_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    pendingAddWord.set(`rules_${chatId}_${ctx.from.id}`, { chatId, type: 'rules' });
    await ctx.replyWithMarkdown(`📋 *تعديل القواعد*\n\nأرسل القواعد الجديدة:\n\n*للإلغاء:* أرسل /cancel`);
  });

  // ── معالج الرسائل في الخاص (لمتابعة welcome/rules) ──────────
  bot.on('message', async (ctx, next) => {
    if (ctx.chat?.type !== 'private' || !ctx.from) return next();
    const userId = ctx.from.id;
    // فحص pending welcome/rules
    for (const [key, data] of pendingAddWord) {
      if (key.endsWith(`_${userId}`) && (key.startsWith('welcome_') || key.startsWith('rules_'))) {
        pendingAddWord.delete(key);
        const { chatId, type } = data;
        const text = ctx.message.text;
        if (!text || text === '/cancel') return ctx.reply('❌ تم الإلغاء.');
        const g = await db.getGroup(chatId); if (!g) return ctx.reply('❌ المجموعة غير موجودة!');
        if (type === 'welcome') {
          g.welcomeMessage = text;
          const preview = text.replace('{name}', ctx.from.first_name || 'عضو').replace('{group}', 'المجموعة').replace('{username}', ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name);
          db.scheduleSync(g);
          await ctx.replyWithMarkdown(`✅ *تم تحديث رسالة الترحيب*\n\n*معاينة:*\n${preview}`);
        } else if (type === 'rules') {
          g.rules = text;
          db.scheduleSync(g);
          await ctx.replyWithMarkdown(`✅ *تم تحديث القواعد*\n\n${text}`);
        }
        return;
      }
    }
    return next();
  });

  } // end setupOwnerHandlers
};
