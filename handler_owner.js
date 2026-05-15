const { Markup } = require('telegraf');
const db         = require('./db');
const { isDeveloper, isAdmin, isOwner, applyGroupPermissions, logAction } = require('./helpers');

// ── لوحة الإعدادات الرئيسية ──────────────────────────────────────────────
function groupSettingsKeyboard(chatId, s) {
  return Markup.inlineKeyboard([
    // إدارة الانضمام
    [
      Markup.button.callback(`${s.joinRequestsEnabled ? '🔒' : '🔓'} موافقة الانضمام`, `toggle_joinreq_${chatId}`),
      Markup.button.callback('📨 الطلبات المعلقة', `joinreqs_${chatId}`),
    ],
    // الحماية
    [
      Markup.button.callback(`${s.protectContent ? '🔒' : '🔓'} حماية المحتوى`,    `toggle_protect_${chatId}`),
      Markup.button.callback(`${s.antiLinks     ? '✅' : '❌'} منع الروابط`,       `toggle_antilinks_${chatId}`),
    ],
    // الأعضاء
    [
      Markup.button.callback(`${s.welcomeEnabled  ? '✅' : '❌'} ترحيب`,           `toggle_welcome_${chatId}`),
      Markup.button.callback(`${s.muteNewMembers  ? '✅' : '❌'} كتم الجدد`,       `toggle_mutenew_${chatId}`),
    ],
    // الأمان
    [
      Markup.button.callback(`${s.antiSpam ? '✅' : '❌'} مكافحة سبام`,           `toggle_antispam_${chatId}`),
      Markup.button.callback(`${s.antiBot  ? '✅' : '❌'} منع بوتات`,             `toggle_antibot_${chatId}`),
    ],
    // صلاحيات
    [Markup.button.callback('🎛️ صلاحيات الأعضاء', `perms_panel_${chatId}`)],
    // تعديل النصوص
    [
      Markup.button.callback('✏️ رسالة الترحيب', `edit_welcome_${chatId}`),
      Markup.button.callback('📋 القواعد',        `edit_rules_${chatId}`),
    ],
    [
      Markup.button.callback('🔤 كلمات محظورة',  `bwords_list_${chatId}`),
      Markup.button.callback('⚙️ حد التحذيرات',  `set_maxwarns_${chatId}`),
    ],
    // معلومات
    [
      Markup.button.callback('📊 إحصائيات',       `stats_${chatId}`),
      Markup.button.callback('📋 سجل الإجراءات',  `auditlog_${chatId}`),
    ],
    [Markup.button.callback('🔙 رجوع', `group_home_${chatId}`)],
  ]);
}

// ── لوحة صلاحيات الأعضاء ────────────────────────────────────────────────
function permissionsDashboard(chatId, perms) {
  return Markup.inlineKeyboard([
    [Markup.button.callback(`${perms.canSendMessages   ? '✅' : '❌'} إرسال رسائل`,       `perm_msg_${chatId}`)],
    [Markup.button.callback(`${perms.canSendMedia      ? '✅' : '❌'} إرسال وسائط`,       `perm_media_${chatId}`)],
    [Markup.button.callback(`${perms.canSendPolls      ? '✅' : '❌'} إرسال استطلاعات`,   `perm_polls_${chatId}`)],
    [Markup.button.callback(`${perms.canAddWebPreviews ? '✅' : '❌'} معاينة روابط`,      `perm_preview_${chatId}`)],
    [Markup.button.callback(`${perms.canInviteUsers    ? '✅' : '❌'} دعوة مستخدمين`,    `perm_invite_${chatId}`)],
    [Markup.button.callback(`${perms.canPinMessages    ? '✅' : '❌'} تثبيت رسائل`,      `perm_pin_${chatId}`)],
    [Markup.button.callback(`${perms.canManageTopics   ? '✅' : '❌'} إدارة المواضيع`,   `perm_topics_${chatId}`)],
    [Markup.button.callback('🔙 رجوع', `settings_${chatId}`)],
  ]);
}

module.exports = function setupOwnerHandlers(bot) {

  // ── /settings ────────────────────────────────────────────────────────
  bot.command('settings', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return ctx.reply('❌ للمشرفين فقط!');
    const g = db.getGroup(chatId); if (!g) return ctx.reply('❌ بيانات المجموعة غير موجودة!');
    await ctx.replyWithMarkdown(`⚙️ *إعدادات ${g.title}*\n\nاضغط لتفعيل/تعطيل:`, groupSettingsKeyboard(chatId, g));
  });

  // ── /setwelcome ──────────────────────────────────────────────────────
  bot.command('setwelcome', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, ctx.chat.id, ctx.from.id)) return ctx.reply('❌ للمشرفين فقط!');
    const text = ctx.message.text.replace('/setwelcome', '').trim();
    if (!text) return ctx.replyWithMarkdown('📝 `/setwelcome نص`\nالمتغيرات: `{name}` `{group}` `{username}`');
    const g = db.getGroup(ctx.chat.id); if (!g) return;
    g.welcomeMessage = text;
    const preview = text
      .replace('{name}',     ctx.from.first_name || 'عضو')
      .replace('{group}',    ctx.chat.title || 'المجموعة')
      .replace('{username}', ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name || '');
    await ctx.replyWithMarkdown(`✅ *تم تعديل رسالة الترحيب*\n\n*معاينة:*\n${preview}`);
  });

  // ── /setrules ────────────────────────────────────────────────────────
  bot.command('setrules', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, ctx.chat.id, ctx.from.id)) return ctx.reply('❌ للمشرفين فقط!');
    const text = ctx.message.text.replace('/setrules', '').trim();
    if (!text) return ctx.reply('📋 مثال: /setrules 1. الاحترام\n2. عدم الإعلانات');
    const g = db.getGroup(ctx.chat.id); if (!g) return;
    g.rules = text;
    await ctx.replyWithMarkdown(`✅ *تم تعيين القواعد*\n\n${text}`);
  });

  // ── /setmaxwarns ─────────────────────────────────────────────────────
  bot.command('setmaxwarns', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    if (!isDeveloper(ctx) && !await isOwner(bot, ctx.chat.id, ctx.from.id)) return ctx.reply('❌ للمالك فقط!');
    const n = Number(ctx.message.text.split(' ')[1]);
    if (!n || n < 1 || n > 10) return ctx.reply('❌ مثال: /setmaxwarns 3  (النطاق: 1-10)');
    const g = db.getGroup(ctx.chat.id); if (!g) return;
    g.maxWarns = n;
    await ctx.replyWithMarkdown(`✅ الحد الأقصى للتحذيرات: \`${n}\``);
  });

  // ── /setlogchannel ───────────────────────────────────────────────────
  bot.command('setlogchannel', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    if (!isDeveloper(ctx) && !await isOwner(bot, ctx.chat.id, ctx.from.id)) return ctx.reply('❌ للمالك فقط!');
    const arg = ctx.message.text.split(' ')[1];
    const g   = db.getGroup(ctx.chat.id); if (!g) return;
    if (!arg) {
      g.logChannelId = null;
      return ctx.reply('✅ تم إلغاء قناة السجلات.');
    }
    const channelId = Number(arg);
    if (!channelId) return ctx.reply('❌ مثال: /setlogchannel -100123456789');
    g.logChannelId = channelId;
    await ctx.replyWithMarkdown(`✅ *قناة السجلات:* \`${channelId}\``);
  });

  // ── /addword ─────────────────────────────────────────────────────────
  bot.command('addword', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, ctx.chat.id, ctx.from.id)) return ctx.reply('❌ للمشرفين فقط!');
    const args = ctx.message.text.split(' ').slice(1);
    const word = args[0]; const action = (args[1] || 'warn').toLowerCase(); const threshold = Number(args[2]) || 1;
    if (!word) return ctx.replyWithMarkdown('📌 `/addword <كلمة> <إجراء> <عدد_مرات>`\n\nالإجراءات: `warn` | `mute` | `kick` | `ban`\nمثال: `/addword بذيء warn 2`');
    if (!['warn', 'mute', 'kick', 'ban'].includes(action)) return ctx.reply('❌ الإجراء غير صحيح! الخيارات: warn | mute | kick | ban');
    if (threshold < 1 || threshold > 5) return ctx.reply('❌ عدد المرات بين 1 و 5');
    const g = db.getGroup(ctx.chat.id); if (!g) return;
    if (g.bannedWords.find(bw => bw.word.toLowerCase() === word.toLowerCase())) return ctx.reply('❌ الكلمة موجودة مسبقاً!');
    g.bannedWords.push({ word, action, threshold, addedBy: ctx.from.id, addedAt: new Date() });
    const arAct = { warn: '⚠️ تحذير', mute: '🔇 كتم', kick: '👢 طرد', ban: '🚫 حظر' };
    await ctx.replyWithMarkdown(`✅ *تمت إضافة الكلمة المحظورة*\n\n🔤 \`${word}\`\n⚡ الإجراء: ${arAct[action]}\n🔁 يُطبَّق بعد: \`${threshold}\` مرة\n🗑️ الرسالة تُحذف فوراً`);
  });

  // ── /removeword ──────────────────────────────────────────────────────
  bot.command('removeword', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, ctx.chat.id, ctx.from.id)) return ctx.reply('❌ للمشرفين فقط!');
    const word = ctx.message.text.split(' ').slice(1).join(' ').trim();
    if (!word) return ctx.reply('📌 مثال: /removeword كلمة');
    const g = db.getGroup(ctx.chat.id); if (!g) return;
    const before = g.bannedWords.length;
    g.bannedWords = g.bannedWords.filter(bw => bw.word.toLowerCase() !== word.toLowerCase());
    if (g.bannedWords.length === before) return ctx.reply('❌ الكلمة غير موجودة!');
    await ctx.replyWithMarkdown(`✅ *تمت الإزالة:* \`${word}\``);
  });

  // ── /words ───────────────────────────────────────────────────────────
  bot.command('words', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const g = db.getGroup(ctx.chat.id);
    if (!g || !g.bannedWords.length) return ctx.reply('🔤 لا توجد كلمات محظورة.\n\n`/addword` لإضافة كلمة.');
    const ar  = { warn: '⚠️', mute: '🔇', kick: '👢', ban: '🚫' };
    let text  = `🔤 *الكلمات المحظورة* (${g.bannedWords.length})\n\n`;
    g.bannedWords.forEach((bw, i) => { text += `${i + 1}. \`${bw.word}\` ${ar[bw.action] || ''} — بعد \`${bw.threshold || 1}\` مرة\n`; });
    await ctx.replyWithMarkdown(text);
  });

  // ── /joinreqs ────────────────────────────────────────────────────────
  bot.command('joinreqs', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return ctx.reply('❌ للمشرفين فقط!');
    const g = db.getGroup(chatId); if (!g) return ctx.reply('❌ بيانات غير موجودة!');
    const pending = [...g.joinRequests.values()].filter(r => r.status === 'pending');
    if (!pending.length) return ctx.reply('📨 لا توجد طلبات انضمام معلقة.');
    const btns = pending.slice(0, 8).map(r => [
      Markup.button.callback(`✅ ${r.firstName.slice(0, 14)}`, `jr_approve_${r.userId}_${chatId}`),
      Markup.button.callback('❌ رفض', `jr_reject_${r.userId}_${chatId}`),
    ]);
    btns.push([
      Markup.button.callback('✅ قبول الكل', `jr_approveall_${chatId}`),
      Markup.button.callback('❌ رفض الكل',  `jr_rejectall_${chatId}`),
    ]);
    await ctx.replyWithMarkdown(`📨 *طلبات الانضمام* (${pending.length} معلقة)`, Markup.inlineKeyboard(btns));
  });

  // ── /top ─────────────────────────────────────────────────────────────
  bot.command('top', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const g = db.getGroup(ctx.chat.id); if (!g) return;
    const sorted = [...g.members.values()]
      .filter(m => (m.score || 0) > 0)
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, 10);
    if (!sorted.length) return ctx.reply('📊 لا توجد بيانات نشاط بعد.');
    const medals = ['🥇', '🥈', '🥉'];
    let text = `🏆 *أنشط أعضاء ${ctx.chat.title}*\n\n`;
    sorted.forEach((m, i) => {
      text += `${medals[i] || `${i + 1}.`} ${m.username ? `@${m.username}` : m.firstName} — \`${m.score || 0}\` نقطة\n`;
    });
    await ctx.replyWithMarkdown(text);
  });

  // ── /myscore ─────────────────────────────────────────────────────────
  bot.command('myscore', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const g = db.getGroup(ctx.chat.id);
    const m = g?.members.get(ctx.from.id);
    const score = m?.score || 0;
    const rank  = m ? [...g.members.values()].sort((a, b) => (b.score || 0) - (a.score || 0)).findIndex(x => x.userId === ctx.from.id) + 1 : 0;
    const name  = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;
    await ctx.replyWithMarkdown(`⭐ *نقاط ${name}*\n\n🔢 النقاط: \`${score}\`\n🏅 الترتيب: \`${rank || '—'}\``);
  });

  // ── /broadcast (للمالك) ──────────────────────────────────────────────
  bot.command('broadcast', async (ctx) => {
    if (ctx.chat.type !== 'private') return ctx.reply('🔒 هذا الأمر في الخاص فقط!');
    const text = ctx.message.text.replace('/broadcast', '').trim();
    if (!text) return ctx.reply('📢 اكتب: /broadcast النص');
    const userGroups = db.getUserGroups(ctx.from.id);
    if (!userGroups.length) return ctx.reply('❌ لا توجد مجموعات تملكها أو تشرف عليها.');
    let success = 0, fail = 0;
    for (const chatId of userGroups) {
      try { await bot.telegram.sendMessage(chatId, `📢 *إعلان*\n\n${text}`, { parse_mode: 'Markdown' }); success++; } catch { fail++; }
    }
    await ctx.reply(`✅ أُرسل إلى ${success} مجموعة\n❌ فشل في ${fail}`);
  });

  // ════════════════════════════════════════════════════════════════════════
  //  أزرار الإعدادات
  // ════════════════════════════════════════════════════════════════════════

  bot.action(/^settings_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId); if (!g) return ctx.answerCbQuery('❌ بيانات غير موجودة!', { show_alert: true });
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    await ctx.editMessageText(`⚙️ *إعدادات ${g.title}*\n\nاضغط لتفعيل/تعطيل:`, { parse_mode: 'Markdown', ...groupSettingsKeyboard(chatId, g) });
  });

  // ── Toggles ──────────────────────────────────────────────────────────
  const toggles = [
    ['toggle_welcome',   'welcomeEnabled',      'رسالة الترحيب'],
    ['toggle_antispam',  'antiSpam',            'مكافحة السبام'],
    ['toggle_mutenew',   'muteNewMembers',      'كتم الأعضاء الجدد'],
    ['toggle_joinreq',   'joinRequestsEnabled', 'موافقة الانضمام'],
    ['toggle_antilinks', 'antiLinks',           'منع الروابط'],
    ['toggle_antibot',   'antiBot',             'منع البوتات'],
  ];

  for (const [prefix, field, label] of toggles) {
    bot.action(new RegExp(`^${prefix}_(-?\\d+)$`), async (ctx) => {
      await ctx.answerCbQuery();
      const chatId = Number(ctx.match[1]);
      const g = db.getGroup(chatId); if (!g) return;
      if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
        return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
      g[field] = !g[field];
      await ctx.answerCbQuery(`${g[field] ? '✅ تم تفعيل' : '❌ تم تعطيل'} ${label}!`);
      await ctx.editMessageReplyMarkup(groupSettingsKeyboard(chatId, g).reply_markup);
    });
  }

  // ── تبديل حماية المحتوى ──────────────────────────────────────────────
  bot.action(/^toggle_protect_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId); if (!g) return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    g.protectContent = !g.protectContent;
    try {
      await bot.telegram.callApi('setChatProtectContent', { chat_id: chatId, protect_content: g.protectContent });
    } catch {}
    await ctx.answerCbQuery(`${g.protectContent ? '🔒 تم تفعيل' : '🔓 تم تعطيل'} حماية المحتوى!`);
    await ctx.editMessageReplyMarkup(groupSettingsKeyboard(chatId, g).reply_markup);
  });

  // ── لوحة الصلاحيات ──────────────────────────────────────────────────
  bot.action(/^perms_panel_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId); if (!g) return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    await ctx.editMessageText(`🎛️ *صلاحيات أعضاء ${g.title}*\n\nاضغط لتفعيل/تعطيل:`, { parse_mode: 'Markdown', ...permissionsDashboard(chatId, g.perms) });
  });

  // تبديل صلاحية فردية
  const permMap = {
    msg:     { key: 'canSendMessages',   label: 'إرسال رسائل' },
    media:   { key: 'canSendMedia',      label: 'إرسال وسائط' },
    polls:   { key: 'canSendPolls',      label: 'إرسال استطلاعات' },
    preview: { key: 'canAddWebPreviews', label: 'معاينة روابط' },
    invite:  { key: 'canInviteUsers',    label: 'دعوة مستخدمين' },
    pin:     { key: 'canPinMessages',    label: 'تثبيت رسائل' },
    topics:  { key: 'canManageTopics',   label: 'إدارة المواضيع' },
  };

  bot.action(/^perm_(\w+)_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const permKey = ctx.match[1];
    const chatId  = Number(ctx.match[2]);
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const g    = db.getGroup(chatId); if (!g) return;
    const def  = permMap[permKey]; if (!def) return;
    g.perms[def.key] = !g.perms[def.key];
    try { await applyGroupPermissions(bot, chatId, g.perms); } catch {}
    await ctx.answerCbQuery(`${g.perms[def.key] ? '✅' : '❌'} ${def.label}`);
    await ctx.editMessageReplyMarkup(permissionsDashboard(chatId, g.perms).reply_markup);
  });

  // ── سجل الإجراءات ────────────────────────────────────────────────────
  bot.action(/^auditlog_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId);
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    if (!g || !g.auditLog.length)
      return ctx.editMessageText('📋 *سجل الإجراءات فارغ.*', { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', `settings_${chatId}`)]]) });

    let text = `📋 *آخر الإجراءات — ${g.title}*\n\n`;
    g.auditLog.slice(0, 10).forEach(e => {
      text += `${e.action} | @${e.by.username} → @${e.target.username}\n`;
      text += `🕐 ${new Date(e.at).toLocaleString('ar')}\n`;
      if (e.details) text += `📝 ${e.details}\n`;
      text += '\n';
    });
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', `settings_${chatId}`)]]) });
  });

  // ── أزرار تعديل ──────────────────────────────────────────────────────
  bot.action(/^edit_welcome_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply('✏️ أرسل: `/setwelcome نص`\nالمتغيرات: `{name}` `{group}` `{username}`', { parse_mode: 'Markdown' });
  });

  bot.action(/^edit_rules_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply('📋 أرسل: `/setrules نص القواعد`', { parse_mode: 'Markdown' });
  });

  bot.action(/^set_maxwarns_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    await ctx.reply(`⚙️ الحد الحالي: \`${db.getGroup(chatId)?.maxWarns || 3}\`\n\nأرسل: \`/setmaxwarns <عدد>\``, { parse_mode: 'Markdown' });
  });

  // ── قائمة الكلمات المحظورة ──────────────────────────────────────────
  bot.action(/^bwords_list_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId); if (!g) return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    if (!g.bannedWords.length)
      return ctx.editMessageText('🔤 *لا توجد كلمات محظورة.*\n`/addword <كلمة> <إجراء> <مرات>`', { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', `settings_${chatId}`)]]) });
    const ar   = { warn: '⚠️', mute: '🔇', kick: '👢', ban: '🚫' };
    let text   = `🔤 *الكلمات المحظورة* (${g.bannedWords.length})\n\n`;
    const btns = g.bannedWords.map((bw, i) => {
      text += `${i + 1}. \`${bw.word}\` ${ar[bw.action] || ''} — بعد ${bw.threshold || 1} مرة\n`;
      return [Markup.button.callback(`🗑️ حذف: ${bw.word.slice(0, 16)}`, `del_word_${i}_${chatId}`)];
    });
    btns.push([Markup.button.callback('🔙 رجوع', `settings_${chatId}`)]);
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) });
  });

  bot.action(/^del_word_(\d+)_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const idx = Number(ctx.match[1]); const chatId = Number(ctx.match[2]);
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const g = db.getGroup(chatId);
    if (!g || !g.bannedWords[idx]) return ctx.answerCbQuery('❌ غير موجودة!', { show_alert: true });
    const removed = g.bannedWords.splice(idx, 1)[0];
    await ctx.answerCbQuery(`✅ حُذفت: ${removed.word}`, { show_alert: true });
    if (!g.bannedWords.length)
      return ctx.editMessageText('🔤 *لا توجد كلمات محظورة.*', { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', `settings_${chatId}`)]]) });
    const ar   = { warn: '⚠️', mute: '🔇', kick: '👢', ban: '🚫' };
    let text   = `🔤 *الكلمات المحظورة* (${g.bannedWords.length})\n\n`;
    const btns = g.bannedWords.map((bw, i) => {
      text += `${i + 1}. \`${bw.word}\` ${ar[bw.action] || ''} — بعد ${bw.threshold || 1} مرة\n`;
      return [Markup.button.callback(`🗑️ حذف: ${bw.word.slice(0, 16)}`, `del_word_${i}_${chatId}`)];
    });
    btns.push([Markup.button.callback('🔙 رجوع', `settings_${chatId}`)]);
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) });
  });

  // ── طلبات الانضمام (زر) ──────────────────────────────────────────────
  bot.action(/^joinreqs_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId);
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    if (!g) return ctx.answerCbQuery('❌ بيانات غير موجودة!', { show_alert: true });
    const pending = [...g.joinRequests.values()].filter(r => r.status === 'pending');
    if (!pending.length)
      return ctx.editMessageText('📨 *لا توجد طلبات معلقة.*', { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', `group_home_${chatId}`)]]) });
    const btns = pending.slice(0, 8).map(r => [
      Markup.button.callback(`✅ ${r.firstName.slice(0, 14)}`, `jr_approve_${r.userId}_${chatId}`),
      Markup.button.callback('❌ رفض', `jr_reject_${r.userId}_${chatId}`),
    ]);
    btns.push([
      Markup.button.callback('✅ قبول الكل', `jr_approveall_${chatId}`),
      Markup.button.callback('❌ رفض الكل',  `jr_rejectall_${chatId}`),
    ]);
    btns.push([Markup.button.callback('🔙 رجوع', `group_home_${chatId}`)]);
    await ctx.editMessageText(`📨 *طلبات الانضمام* (${pending.length} معلقة)`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) });
  });
};
