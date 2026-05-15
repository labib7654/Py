// ============================================================
//  أوامر مالك المجموعة — إعدادات كاملة
// ============================================================

const { Markup } = require('telegraf');
const db         = require('./db');
const { isDeveloper, isAdmin, isOwner } = require('./helpers');

function groupSettingsKeyboard(chatId, s) {
  return Markup.inlineKeyboard([
    [Markup.button.callback(`${s.welcomeEnabled      ? '✅' : '❌'} رسالة الترحيب`,       `toggle_welcome_${chatId}`)],
    [Markup.button.callback(`${s.antiSpam            ? '✅' : '❌'} مكافحة السبام`,        `toggle_antispam_${chatId}`)],
    [Markup.button.callback(`${s.muteNewMembers      ? '✅' : '❌'} كتم الأعضاء الجدد`,   `toggle_mutenew_${chatId}`)],
    [Markup.button.callback(`${s.joinRequestsEnabled ? '✅' : '❌'} إدارة طلبات الانضمام`, `toggle_joinreq_${chatId}`)],
    [Markup.button.callback('✏️ رسالة الترحيب',        `edit_welcome_${chatId}`),
     Markup.button.callback('📋 القواعد',              `edit_rules_${chatId}`)],
    [Markup.button.callback('🔤 الكلمات المحظورة',    `bwords_list_${chatId}`)],
    [Markup.button.callback('⚙️ الحد الأقصى للتحذيرات', `set_maxwarns_${chatId}`)],
    [Markup.button.callback('🔙 رجوع',                `group_home_${chatId}`)],
  ]);
}

module.exports = function setupOwnerHandlers(bot) {

  // /settings
  bot.command('settings', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return ctx.reply('❌ للمشرفين فقط!');
    const g = db.getGroup(chatId);
    if (!g) return ctx.reply('❌ بيانات المجموعة غير موجودة!');
    await ctx.replyWithMarkdown(`⚙️ *إعدادات ${g.title}*\n\nاضغط لتفعيل/تعطيل:`, groupSettingsKeyboard(chatId, g));
  });

  // /setwelcome
  bot.command('setwelcome', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, ctx.chat.id, ctx.from.id)) return ctx.reply('❌ للمشرفين فقط!');
    const text = ctx.message.text.replace('/setwelcome', '').trim();
    if (!text) return ctx.replyWithMarkdown('📝 `/setwelcome نص`\nالمتغيرات: `{name}` `{group}` `{username}`');
    const g = db.getGroup(ctx.chat.id); if (!g) return;
    g.welcomeMessage = text;
    const preview = text.replace('{name}', ctx.from.first_name || 'عضو').replace('{group}', ctx.chat.title || 'المجموعة').replace('{username}', ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name || '');
    await ctx.replyWithMarkdown(`✅ *تم تعديل رسالة الترحيب*\n\n*معاينة:*\n${preview}`);
  });

  // /setrules
  bot.command('setrules', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, ctx.chat.id, ctx.from.id)) return ctx.reply('❌ للمشرفين فقط!');
    const text = ctx.message.text.replace('/setrules', '').trim();
    if (!text) return ctx.reply('📋 مثال: /setrules 1. الاحترام\n2. عدم الإعلانات');
    const g = db.getGroup(ctx.chat.id); if (!g) return;
    g.rules = text;
    await ctx.replyWithMarkdown(`✅ *تم تعيين القواعد*\n\n${text}`);
  });

  // /setmaxwarns
  bot.command('setmaxwarns', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    if (!isDeveloper(ctx) && !await isOwner(bot, ctx.chat.id, ctx.from.id)) return ctx.reply('❌ للمالك فقط!');
    const n = Number(ctx.message.text.split(' ')[1]);
    if (!n || n < 1 || n > 10) return ctx.reply('❌ مثال: /setmaxwarns 3  (النطاق: 1-10)');
    const g = db.getGroup(ctx.chat.id); if (!g) return;
    g.maxWarns = n;
    await ctx.replyWithMarkdown(`✅ الحد الأقصى للتحذيرات: \`${n}\``);
  });

  // /addword — مع عتبة التكرار
  bot.command('addword', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, ctx.chat.id, ctx.from.id)) return ctx.reply('❌ للمشرفين فقط!');
    const args      = ctx.message.text.split(' ').slice(1);
    const word      = args[0];
    const action    = (args[1] || 'warn').toLowerCase();
    const threshold = Number(args[2]) || 1;
    if (!word) return ctx.replyWithMarkdown('📌 `/addword <كلمة> <إجراء> <عدد_مرات>`\n\nالإجراءات: `warn` | `mute` | `kick` | `ban`\nمثال: `/addword بذيء warn 2` — يحذر بعد المرة الثانية');
    if (!['warn', 'mute', 'kick', 'ban'].includes(action)) return ctx.reply('❌ الإجراء غير صحيح! الخيارات: warn | mute | kick | ban');
    if (threshold < 1 || threshold > 5) return ctx.reply('❌ عدد المرات بين 1 و 5');
    const g = db.getGroup(ctx.chat.id); if (!g) return;
    if (g.bannedWords.find(bw => bw.word.toLowerCase() === word.toLowerCase())) return ctx.reply('❌ الكلمة موجودة مسبقاً!');
    g.bannedWords.push({ word, action, threshold, addedBy: ctx.from.id, addedAt: new Date() });
    const arAct = { warn: '⚠️ تحذير', mute: '🔇 كتم', kick: '👢 طرد', ban: '🚫 حظر' };
    await ctx.replyWithMarkdown(`✅ *تمت إضافة الكلمة المحظورة*\n\n🔤 الكلمة: \`${word}\`\n⚡ الإجراء: ${arAct[action]}\n🔁 يُطبَّق بعد: \`${threshold}\` مرة\n🗑️ رسالة المخالف تُحذف فوراً`);
  });

  // /removeword
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

  // /words
  bot.command('words', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const g = db.getGroup(ctx.chat.id);
    if (!g || !g.bannedWords.length) return ctx.reply('🔤 لا توجد كلمات محظورة.\n\n`/addword` لإضافة كلمة.');
    const ar = { warn: '⚠️', mute: '🔇', kick: '👢', ban: '🚫' };
    let text = `🔤 *الكلمات المحظورة* (${g.bannedWords.length})\n\n`;
    g.bannedWords.forEach((bw, i) => { text += `${i + 1}. \`${bw.word}\` ${ar[bw.action] || ''} — بعد \`${bw.threshold || 1}\` مرة\n`; });
    text += '\n_لإزالة: /removeword <كلمة>_';
    await ctx.replyWithMarkdown(text);
  });

  // /joinreqs
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
    btns.push([Markup.button.callback('✅ قبول الكل', `jr_approveall_${chatId}`), Markup.button.callback('❌ رفض الكل', `jr_rejectall_${chatId}`)]);
    await ctx.replyWithMarkdown(`📨 *طلبات الانضمام* (${pending.length} معلقة)`, Markup.inlineKeyboard(btns));
  });

  // ── أزرار الإعدادات ────────────────────────────────────────

  bot.action(/^settings_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId);
    if (!g) return ctx.answerCbQuery('❌ بيانات غير موجودة!', { show_alert: true });
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    await ctx.editMessageText(`⚙️ *إعدادات ${g.title}*\n\nاضغط لتفعيل/تعطيل:`,
      { parse_mode: 'Markdown', ...groupSettingsKeyboard(chatId, g) });
  });

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
      const g = db.getGroup(chatId); if (!g) return;
      if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
      g[field] = !g[field];
      await ctx.answerCbQuery(`${g[field] ? '✅ تم تفعيل' : '❌ تم تعطيل'} ${label}!`);
      await ctx.editMessageReplyMarkup(groupSettingsKeyboard(chatId, g).reply_markup);
    });
  }

  bot.action(/^edit_welcome_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply('✏️ أرسل: `/setwelcome نص`\nالمتغيرات: `{name}` `{group}` `{username}`', { parse_mode: 'Markdown' });
  });

  bot.action(/^edit_rules_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply('📋 أرسل: `/setrules نص القواعد`', { parse_mode: 'Markdown' });
  });

  bot.action(/^bwords_list_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId); if (!g) return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    if (!g.bannedWords.length) {
      return ctx.editMessageText(
        '🔤 *الكلمات المحظورة*\n\nلا توجد كلمات.\n`/addword <كلمة> <إجراء> <عدد_مرات>`',
        { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', `settings_${chatId}`)]]) }
      );
    }
    const ar = { warn: '⚠️', mute: '🔇', kick: '👢', ban: '🚫' };
    let text = `🔤 *الكلمات المحظورة* (${g.bannedWords.length})\n\n`;
    const btns = g.bannedWords.map((bw, i) => {
      text += `${i + 1}. \`${bw.word}\` ${ar[bw.action] || ''} — بعد ${bw.threshold || 1} مرة\n`;
      return [Markup.button.callback(`🗑️ حذف: ${bw.word.slice(0, 16)}`, `del_word_${i}_${chatId}`)];
    });
    btns.push([Markup.button.callback('🔙 رجوع', `settings_${chatId}`)]);
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) });
  });

  bot.action(/^del_word_(\d+)_(-?\d+)$/, async (ctx) => {
    const idx = Number(ctx.match[1]); const chatId = Number(ctx.match[2]);
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const g = db.getGroup(chatId);
    if (!g || !g.bannedWords[idx]) return ctx.answerCbQuery('❌ غير موجودة!', { show_alert: true });
    const removed = g.bannedWords.splice(idx, 1)[0];
    await ctx.answerCbQuery(`✅ حُذفت: ${removed.word}`, { show_alert: true });
    if (!g.bannedWords.length) {
      return ctx.editMessageText('🔤 *لا توجد كلمات محظورة.*', { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', `settings_${chatId}`)]]) });
    }
    const ar = { warn: '⚠️', mute: '🔇', kick: '👢', ban: '🚫' };
    let text = `🔤 *الكلمات المحظورة* (${g.bannedWords.length})\n\n`;
    const btns = g.bannedWords.map((bw, i) => {
      text += `${i + 1}. \`${bw.word}\` ${ar[bw.action] || ''} — بعد ${bw.threshold || 1} مرة\n`;
      return [Markup.button.callback(`🗑️ حذف: ${bw.word.slice(0, 16)}`, `del_word_${i}_${chatId}`)];
    });
    btns.push([Markup.button.callback('🔙 رجوع', `settings_${chatId}`)]);
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) });
  });

  bot.action(/^set_maxwarns_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    await ctx.reply(`⚙️ الحد الحالي: \`${db.getGroup(chatId)?.maxWarns || 3}\`\n\nأرسل: \`/setmaxwarns <عدد>\``, { parse_mode: 'Markdown' });
  });

  bot.action(/^joinreqs_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId);
    if (!g) return ctx.answerCbQuery('❌ بيانات غير موجودة!', { show_alert: true });
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const pending = [...g.joinRequests.values()].filter(r => r.status === 'pending');
    if (!pending.length) return ctx.editMessageText('📨 *لا توجد طلبات معلقة.*', { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', `group_home_${chatId}`)]]) });
    const btns = pending.slice(0, 8).map(r => [
      Markup.button.callback(`✅ ${r.firstName.slice(0, 14)}`, `jr_approve_${r.userId}_${chatId}`),
      Markup.button.callback('❌ رفض', `jr_reject_${r.userId}_${chatId}`),
    ]);
    btns.push([Markup.button.callback('✅ قبول الكل', `jr_approveall_${chatId}`), Markup.button.callback('❌ رفض الكل', `jr_rejectall_${chatId}`)]);
    btns.push([Markup.button.callback('🔙 رجوع', `group_home_${chatId}`)]);
    await ctx.editMessageText(`📨 *طلبات الانضمام* (${pending.length} معلقة)`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) });
  });
};
