const { Markup } = require('telegraf');
const db         = require('./db');
const { isDeveloper, isAdmin, isOwner } = require('./helpers_permissions');
const { applyGroupPermissions, setJoinApproval } = require('./helpers_actions');

// يتتبع جلسات تغيير الرسالة الترحيبية والقواعد وقناة السجل
const pendingWelcomeEdit = new Map();
const pendingRulesEdit   = new Map();
const pendingLogChannel  = new Map();
const pendingMaxWarns    = new Map();
const pendingCommunity   = new Map();

module.exports = function setupSettingsHandlers(bot) {

  // ── /settings ───────────────────────────────────────────────────────
  bot.command('settings', async (ctx) => {
    if (ctx.chat.type === 'private') {
      // عرض قائمة مجموعات المستخدم
      const userGroups = db.allGroups().filter(g =>
        g.ownerId === ctx.from.id ||
        g.admins.has(ctx.from.id) ||
        isDeveloper(ctx)
      );
      if (!userGroups.length) return ctx.reply('❌ لا توجد مجموعات تديرها.');
      const btns = userGroups.map(g => [Markup.button.callback(`📌 ${g.title}`, `settings_${g.chatId}`)]);
      return ctx.replyWithMarkdown('🤖 *اختر مجموعة للإعدادات:*', Markup.inlineKeyboard(btns));
    }
    const chatId = ctx.chat.id;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.reply('❌ للمشرفين فقط!');
    const g = db.getGroup(chatId);
    if (!g) return ctx.reply('❌ المجموعة غير مسجّلة!');
    await ctx.replyWithMarkdown(buildSettingsText(g), buildSettingsKeyboard(g));
  });

  // ── عرض الإعدادات (callback) ────────────────────────────────────────
  bot.action(/^settings_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const g = db.getGroup(chatId);
    if (!g) return ctx.answerCbQuery('❌ بيانات غير موجودة!', { show_alert: true });
    await ctx.editMessageText(buildSettingsText(g), { parse_mode: 'Markdown', ...buildSettingsKeyboard(g) });
  });

  // ── Toggles ──────────────────────────────────────────────────────────

  bot.action(/^toggle_welcome_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId); if (!g) return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return;
    g.welcomeEnabled = !g.welcomeEnabled;
    await ctx.editMessageText(buildSettingsText(g), { parse_mode: 'Markdown', ...buildSettingsKeyboard(g) });
  });

  bot.action(/^toggle_antispam_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId); if (!g) return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return;
    g.antiSpam = !g.antiSpam;
    await ctx.editMessageText(buildSettingsText(g), { parse_mode: 'Markdown', ...buildSettingsKeyboard(g) });
  });

  bot.action(/^toggle_antilinks_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId); if (!g) return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return;
    g.antiLinks = !g.antiLinks;
    await ctx.editMessageText(buildSettingsText(g), { parse_mode: 'Markdown', ...buildSettingsKeyboard(g) });
  });

  bot.action(/^toggle_antibot_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId); if (!g) return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return;
    g.antiBot = !g.antiBot;
    await ctx.editMessageText(buildSettingsText(g), { parse_mode: 'Markdown', ...buildSettingsKeyboard(g) });
  });

  bot.action(/^toggle_mutenew_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId); if (!g) return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return;
    g.muteNewMembers = !g.muteNewMembers;
    await ctx.editMessageText(buildSettingsText(g), { parse_mode: 'Markdown', ...buildSettingsKeyboard(g) });
  });

  bot.action(/^toggle_protect_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId); if (!g) return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return;
    g.protectContent = !g.protectContent;
    try {
      await bot.telegram.setChatProtectContent(chatId, { is_protected: g.protectContent });
    } catch (e) {
      console.error(`setChatProtectContent error: ${e.message}`);
    }
    await ctx.editMessageText(buildSettingsText(g), { parse_mode: 'Markdown', ...buildSettingsKeyboard(g) });
  });

  // طلبات الانضمام
  bot.action(/^toggle_joinreqs_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId); if (!g) return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return;
    g.joinRequestsEnabled = !g.joinRequestsEnabled;
    try { await setJoinApproval(bot, chatId, g.joinRequestsEnabled); } catch {}
    await ctx.editMessageText(buildSettingsText(g), { parse_mode: 'Markdown', ...buildSettingsKeyboard(g) });
  });

  // ── الرسالة الترحيبية ─────────────────────────────────────────────
  bot.action(/^edit_welcome_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const g = db.getGroup(chatId);
    pendingWelcomeEdit.set(ctx.from.id, { chatId });
    await ctx.reply(
      `✏️ *تعديل رسالة الترحيب*\n\nالرسالة الحالية:\n\`${g?.welcomeMessage || ''}\`\n\n` +
      `المتغيرات: {name} {group} {username}\n\nأرسل الرسالة الجديدة:`,
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('❌ إلغاء', `settings_${chatId}`)]]) }
    );
  });

  // ── القواعد ──────────────────────────────────────────────────────────
  bot.action(/^edit_rules_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    pendingRulesEdit.set(ctx.from.id, { chatId });
    await ctx.reply('📋 *تعديل القواعد*\n\nأرسل القواعد الجديدة:', {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('❌ إلغاء', `settings_${chatId}`)]]),
    });
  });

  // ── قناة السجل ───────────────────────────────────────────────────────
  bot.action(/^set_logchannel_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    pendingLogChannel.set(ctx.from.id, { chatId });
    await ctx.reply('📣 *ضبط قناة السجل*\n\nأرسل معرّف قناة السجل (رقم سالب)، أو أرسل 0 للإلغاء:', {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('❌ إلغاء', `settings_${chatId}`)]]),
    });
  });

  // ── الحد الأقصى للتحذيرات ────────────────────────────────────────
  bot.action(/^set_maxwarns_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    await ctx.editMessageText('⚠️ *الحد الأقصى للتحذيرات*\n\nاختر عدد التحذيرات قبل الحظر:', {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('2', `mw_set_${chatId}_2`), Markup.button.callback('3', `mw_set_${chatId}_3`), Markup.button.callback('4', `mw_set_${chatId}_4`), Markup.button.callback('5', `mw_set_${chatId}_5`)],
        [Markup.button.callback('🔙 رجوع', `settings_${chatId}`)],
      ]),
    });
  });

  // FIX 1: إزالة answerCbQuery المزدوج — الصحيح أولاً editMessageText ثم answerCbQuery واحد فقط
  bot.action(/^mw_set_(-?\d+)_(\d+)$/, async (ctx) => {
    const [chatId, maxWarns] = [Number(ctx.match[1]), Number(ctx.match[2])];
    const g = db.getGroup(chatId); if (!g) return ctx.answerCbQuery();
    g.maxWarns = maxWarns;
    await ctx.editMessageText(buildSettingsText(g), { parse_mode: 'Markdown', ...buildSettingsKeyboard(g) });
    await ctx.answerCbQuery(`✅ الحد الأقصى: ${maxWarns} تحذيرات`, { show_alert: true });
  });

  // ── لوحة صلاحيات الأعضاء ──────────────────────────────────────────
  bot.action(/^perms_panel_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId); if (!g) return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return;
    await ctx.editMessageText(buildPermsText(g), { parse_mode: 'Markdown', ...buildPermsKeyboard(chatId, g) });
  });

  bot.action(/^perm_toggle_(\w+)_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const [key, chatId] = [ctx.match[1], Number(ctx.match[2])];
    const g = db.getGroup(chatId); if (!g) return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return;
    if (g.perms.hasOwnProperty(key)) g.perms[key] = !g.perms[key];
    try { await applyGroupPermissions(bot, chatId, g.perms); } catch (e) { console.error(e.message); }
    await ctx.editMessageText(buildPermsText(g), { parse_mode: 'Markdown', ...buildPermsKeyboard(chatId, g) });
  });

  // ── ربط بالمجتمع ──────────────────────────────────────────────────
  bot.action(/^set_community_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    if (!isDeveloper(ctx) && !await isOwner(bot, chatId, ctx.from.id) && !isDeveloper(ctx))
      return ctx.answerCbQuery('❌ للمالك فقط!', { show_alert: true });
    pendingCommunity.set(ctx.from.id, { chatId });
    await ctx.reply('🏛️ *ربط بمجتمع*\n\nأرسل معرّف المجتمع (رقم سالب):', {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('❌ إلغاء', `settings_${chatId}`)]]),
    });
  });

  // ── معالج الرسائل للجلسات المعلّقة ──────────────────────────────
  bot.on('message', async (ctx, next) => {
    if (!ctx.from || ctx.chat.type !== 'private') return next();
    const userId = ctx.from.id;
    const text   = ctx.message.text?.trim();
    if (!text) return next();

    if (pendingWelcomeEdit.has(userId)) {
      const { chatId } = pendingWelcomeEdit.get(userId);
      pendingWelcomeEdit.delete(userId);
      const g = db.getGroup(chatId);
      if (!g) return ctx.reply('❌ المجموعة غير موجودة!');
      g.welcomeMessage = text;
      return ctx.reply(`✅ *تم تحديث رسالة الترحيب:*\n\n${text}`, { parse_mode: 'Markdown' });
    }

    if (pendingRulesEdit.has(userId)) {
      const { chatId } = pendingRulesEdit.get(userId);
      pendingRulesEdit.delete(userId);
      const g = db.getGroup(chatId);
      if (!g) return ctx.reply('❌ المجموعة غير موجودة!');
      g.rules = text;
      return ctx.reply(`✅ *تم تحديث القواعد:*\n\n${text}`, { parse_mode: 'Markdown' });
    }

    if (pendingLogChannel.has(userId)) {
      const { chatId } = pendingLogChannel.get(userId);
      pendingLogChannel.delete(userId);
      const g = db.getGroup(chatId);
      if (!g) return ctx.reply('❌ المجموعة غير موجودة!');
      const num = Number(text);
      if (isNaN(num)) return ctx.reply('❌ أرسل رقم صحيح!');
      g.logChannelId = num === 0 ? null : num;
      return ctx.reply(num === 0 ? '✅ تم إلغاء قناة السجل' : `✅ قناة السجل: \`${num}\``, { parse_mode: 'Markdown' });
    }

    if (pendingCommunity.has(userId)) {
      const { chatId } = pendingCommunity.get(userId);
      pendingCommunity.delete(userId);
      const g = db.getGroup(chatId);
      if (!g) return ctx.reply('❌ المجموعة غير موجودة!');
      const num = Number(text);
      if (isNaN(num)) return ctx.reply('❌ أرسل رقم صحيح!');
      g.communityId = num;
      const com = db.getOrCreateCommunity(num, `مجتمع ${num}`);
      com.subGroups.add(chatId);
      return ctx.reply(`✅ تم ربط المجموعة بالمجتمع: \`${num}\``, { parse_mode: 'Markdown' });
    }

    return next();
  });

  // ── طلبات الانضمام (callback لوحة) ─────────────────────────────────
  bot.action(/^joinreqs_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId);
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    if (!g) return ctx.answerCbQuery('❌ بيانات غير موجودة!', { show_alert: true });
    const pending = [...g.joinRequests.values()].filter(r => r.status === 'pending');
    if (!pending.length)
      return ctx.editMessageText('📨 *لا توجد طلبات معلقة.*', {
        parse_mode: 'Markdown',
        // FIX 5: الرجوع للإعدادات لا لـ group_home (يعمل من الخاص أيضاً)
        ...Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', `settings_${chatId}`)]]),
      });
    const btns = pending.slice(0, 8).map(r => [
      Markup.button.callback(`✅ ${r.firstName.slice(0, 14)}`, `jr_approve_${r.userId}_${chatId}`),
      Markup.button.callback('❌ رفض', `jr_reject_${r.userId}_${chatId}`),
    ]);
    btns.push([Markup.button.callback('✅ قبول الكل', `jr_approveall_${chatId}`), Markup.button.callback('❌ رفض الكل', `jr_rejectall_${chatId}`)]);
    // FIX 5: الرجوع للإعدادات
    btns.push([Markup.button.callback('🔙 رجوع', `settings_${chatId}`)]);
    await ctx.editMessageText(`📨 *طلبات الانضمام* (${pending.length} معلقة)`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) });
  });

};

// ── Helpers ──────────────────────────────────────────────────────────
function buildSettingsText(g) {
  return (
    `⚙️ *إعدادات ${g.title}*\n\n` +
    `👑 المالك: \`${g.ownerUsername || 'غير محدد'}\`\n` +
    `💬 الترحيب: ${g.welcomeEnabled ? '✅' : '❌'}\n` +
    `🛡️ مكافحة سبام: ${g.antiSpam ? '✅' : '❌'}\n` +
    `🔗 مكافحة روابط: ${g.antiLinks ? '✅' : '❌'}\n` +
    `🤖 مكافحة بوتات: ${g.antiBot ? '✅' : '❌'}\n` +
    `🔕 كتم الأعضاء الجدد: ${g.muteNewMembers ? '✅' : '❌'}\n` +
    `🔒 حماية المحتوى: ${g.protectContent ? '✅' : '❌'}\n` +
    `📨 طلبات الانضمام: ${g.joinRequestsEnabled ? '✅' : '❌'}\n` +
    `⚠️ الحد الأقصى للتحذيرات: \`${g.maxWarns}\`\n` +
    `📣 قناة السجل: \`${g.logChannelId || 'غير محدد'}\`\n` +
    `🏛️ المجتمع: \`${g.communityId || 'غير محدد'}\`\n`
  );
}

function buildSettingsKeyboard(g) {
  const chatId = g.chatId;
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(`${g.welcomeEnabled ? '✅' : '❌'} ترحيب`,       `toggle_welcome_${chatId}`),
      Markup.button.callback(`${g.antiSpam ? '✅' : '❌'} ضد سبام`,           `toggle_antispam_${chatId}`),
    ],
    [
      Markup.button.callback(`${g.antiLinks ? '✅' : '❌'} ضد روابط`,         `toggle_antilinks_${chatId}`),
      Markup.button.callback(`${g.antiBot ? '✅' : '❌'} ضد بوتات`,           `toggle_antibot_${chatId}`),
    ],
    [
      Markup.button.callback(`${g.muteNewMembers ? '✅' : '❌'} كتم الجدد`,   `toggle_mutenew_${chatId}`),
      Markup.button.callback(`${g.protectContent ? '✅' : '❌'} حماية المحتوى`,`toggle_protect_${chatId}`),
    ],
    [
      Markup.button.callback(`${g.joinRequestsEnabled ? '✅' : '❌'} طلبات`,  `toggle_joinreqs_${chatId}`),
      Markup.button.callback(`⚠️ حد التحذيرات (${g.maxWarns})`,               `set_maxwarns_${chatId}`),
    ],
    [
      Markup.button.callback('✏️ رسالة الترحيب', `edit_welcome_${chatId}`),
      Markup.button.callback('📋 القواعد',        `edit_rules_${chatId}`),
    ],
    [
      Markup.button.callback('📣 قناة السجل',     `set_logchannel_${chatId}`),
      Markup.button.callback('🏛️ ربط مجتمع',      `set_community_${chatId}`),
    ],
    [
      Markup.button.callback('🔐 صلاحيات',        `perms_panel_${chatId}`),
      Markup.button.callback('🔤 كلمات محظورة',   `bwords_list_${chatId}`),
    ],
    [
      Markup.button.callback('🟢 كلمات مسموحة',  `awords_list_${chatId}`),
      Markup.button.callback('🧵 المواضيع',        `topics_panel_${chatId}`),
    ],
    [Markup.button.callback('📨 طلبات الانضمام',  `joinreqs_${chatId}`)],
  ]);
}

function buildPermsText(g) {
  const p = g.perms;
  return (
    `🔐 *صلاحيات أعضاء ${g.title}*\n\n` +
    `💬 إرسال رسائل: ${p.canSendMessages ? '✅' : '❌'}\n` +
    `🖼️ إرسال وسائط: ${p.canSendMedia ? '✅' : '❌'}\n` +
    `📊 إرسال استطلاعات: ${p.canSendPolls ? '✅' : '❌'}\n` +
    `🔗 إرسال روابط: ${p.canAddWebPreviews ? '✅' : '❌'}\n` +
    `📨 دعوة مستخدمين: ${p.canInviteUsers ? '✅' : '❌'}\n` +
    `📌 تثبيت رسائل: ${p.canPinMessages ? '✅' : '❌'}\n` +
    `🧵 إدارة مواضيع: ${p.canManageTopics ? '✅' : '❌'}\n`
  );
}

function buildPermsKeyboard(chatId, g) {
  const p = g.perms;
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(`${p.canSendMessages ? '✅' : '❌'} رسائل`,   `perm_toggle_canSendMessages_${chatId}`),
      Markup.button.callback(`${p.canSendMedia ? '✅' : '❌'} وسائط`,      `perm_toggle_canSendMedia_${chatId}`),
    ],
    [
      Markup.button.callback(`${p.canSendPolls ? '✅' : '❌'} استطلاعات`, `perm_toggle_canSendPolls_${chatId}`),
      Markup.button.callback(`${p.canAddWebPreviews ? '✅' : '❌'} روابط`, `perm_toggle_canAddWebPreviews_${chatId}`),
    ],
    [
      Markup.button.callback(`${p.canInviteUsers ? '✅' : '❌'} دعوة`,     `perm_toggle_canInviteUsers_${chatId}`),
      Markup.button.callback(`${p.canPinMessages ? '✅' : '❌'} تثبيت`,    `perm_toggle_canPinMessages_${chatId}`),
    ],
    [
      Markup.button.callback(`${p.canManageTopics ? '✅' : '❌'} مواضيع`,  `perm_toggle_canManageTopics_${chatId}`),
    ],
    [Markup.button.callback('🔙 رجوع', `settings_${chatId}`)],
  ]);
}
