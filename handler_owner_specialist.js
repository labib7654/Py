// FEATURE 4: نظام المتخصص (Specialist Routing)
const { Markup } = require('telegraf');
const db         = require('./db');
const { isDeveloper, isAdmin } = require('./helpers_permissions');

module.exports = function setupSpecialistHandlers(bot) {

  // ── عرض الكلمات المسموحة مع أزرار تعيين متخصص ────────────────────────
  bot.action(/^aword_set_specialist_(\d+)_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const wordIdx = Number(ctx.match[1]);
    const chatId  = Number(ctx.match[2]);
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const g = db.getGroup(chatId);
    if (!g) return ctx.answerCbQuery('❌ المجموعة غير موجودة!', { show_alert: true });
    const word = g.allowedWords[wordIdx];
    if (!word) return ctx.answerCbQuery('❌ الكلمة غير موجودة!', { show_alert: true });

    const memberBtns = [...g.members.values()]
      .filter(m => m.userId !== ctx.from.id)
      .slice(0, 10)
      .map(m => [Markup.button.callback(
        `${m.username ? '@' + m.username : m.firstName}`,
        `aword_assign_${wordIdx}_${chatId}_${m.userId}`
      )]);
    memberBtns.push([Markup.button.callback('❌ إلغاء المتخصص', `aword_unassign_${wordIdx}_${chatId}`)]);
    memberBtns.push([Markup.button.callback('🔙 رجوع', `awords_list_${chatId}`)]);

    await ctx.editMessageText(
      `👤 *تعيين متخصص للكلمة:* \`${word.word}\`\n\nاختر المتخصص من الأعضاء:`,
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard(memberBtns) }
    );
  });

  bot.action(/^aword_assign_(\d+)_(-?\d+)_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const [wordIdx, chatId, specialistId] = [Number(ctx.match[1]), Number(ctx.match[2]), Number(ctx.match[3])];
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const g = db.getGroup(chatId);
    if (!g) return ctx.answerCbQuery('❌ غير موجودة!', { show_alert: true });
    const word = g.allowedWords[wordIdx];
    if (!word) return ctx.answerCbQuery('❌ الكلمة غير موجودة!', { show_alert: true });
    const specialist = g.members.get(specialistId);
    word.hasSpecialist      = true;
    word.specialistUserId   = specialistId;
    word.specialistUsername = specialist?.username || specialist?.firstName || String(specialistId);
    await ctx.answerCbQuery(`✅ تم تعيين ${word.specialistUsername} متخصصاً!`, { show_alert: true });
    await ctx.editMessageText(
      `✅ *تم التعيين*\n\n🔤 الكلمة: \`${word.word}\`\n👤 المتخصص: @${word.specialistUsername}`,
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', `awords_list_${chatId}`)]]) }
    );
  });

  bot.action(/^aword_unassign_(\d+)_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const [wordIdx, chatId] = [Number(ctx.match[1]), Number(ctx.match[2])];
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const g = db.getGroup(chatId);
    if (!g) return;
    const word = g.allowedWords[wordIdx];
    if (!word) return;
    word.hasSpecialist      = false;
    word.specialistUserId   = null;
    word.specialistUsername = '';
    await ctx.answerCbQuery('✅ تم إلغاء المتخصص!', { show_alert: true });
    await ctx.editMessageText(
      `✅ *تم الإلغاء*\n\n🔤 الكلمة: \`${word.word}\` — بدون متخصص الآن`,
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', `awords_list_${chatId}`)]]) }
    );
  });

};
