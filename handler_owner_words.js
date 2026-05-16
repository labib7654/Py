// FEATURE 3: نظام الكلمات المحظورة + المسموحة
const { Markup } = require('telegraf');
const db         = require('./db');
const { isDeveloper, isAdmin } = require('./helpers_permissions');

const pendingAddWord    = new Map(); // userId -> { chatId, step, word, action, threshold, type }
const pendingAddAllowed = new Map(); // userId -> { chatId, step, word, category }

module.exports = function setupWordsHandlers(bot) {

  // ══════════════════════════════════════════════════════════
  //  الكلمات المحظورة
  // ══════════════════════════════════════════════════════════

  bot.action(/^bwords_list_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const g = db.getGroup(chatId);
    if (!g) return ctx.answerCbQuery('❌ بيانات غير موجودة!', { show_alert: true });
    const ar   = { warn: '⚠️ تحذير', mute: '🔇 كتم', kick: '👢 طرد', ban: '🚫 حظر' };
    let text   = `🔤 *الكلمات المحظورة* (${g.bannedWords.length})\n\n`;
    const btns = g.bannedWords.map((bw, i) => {
      text += `${i + 1}. \`${bw.word}\` ${ar[bw.action] || ''} — بعد ${bw.threshold || 1} مرة\n`;
      return [Markup.button.callback(`🗑️ حذف: ${bw.word.slice(0, 16)}`, `del_word_${i}_${chatId}`)];
    });
    if (!g.bannedWords.length) text += '_لا توجد كلمات محظورة حتى الآن._\n';
    btns.push([Markup.button.callback('➕ إضافة كلمة', `add_word_start_${chatId}`)]);
    btns.push([Markup.button.callback('🔙 رجوع', `settings_${chatId}`)]);
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) });
  });

  bot.action(/^del_word_(\d+)_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const [idx, chatId] = [Number(ctx.match[1]), Number(ctx.match[2])];
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const g = db.getGroup(chatId); if (!g) return;
    const removed = g.bannedWords.splice(idx, 1);
    await ctx.answerCbQuery(`🗑️ حُذفت: ${removed[0]?.word || ''}`, { show_alert: true });
    const ar   = { warn: '⚠️ تحذير', mute: '🔇 كتم', kick: '👢 طرد', ban: '🚫 حظر' };
    let text   = `🔤 *الكلمات المحظورة* (${g.bannedWords.length})\n\n`;
    const btns = g.bannedWords.map((bw, i) => {
      text += `${i + 1}. \`${bw.word}\` ${ar[bw.action] || ''} — بعد ${bw.threshold || 1} مرة\n`;
      return [Markup.button.callback(`🗑️ حذف: ${bw.word.slice(0, 16)}`, `del_word_${i}_${chatId}`)];
    });
    if (!g.bannedWords.length) text += '_لا توجد كلمات محظورة حتى الآن._\n';
    btns.push([Markup.button.callback('➕ إضافة كلمة', `add_word_start_${chatId}`)]);
    btns.push([Markup.button.callback('🔙 رجوع', `settings_${chatId}`)]);
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) });
  });

  bot.action(/^add_word_start_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    pendingAddWord.set(ctx.from.id, { chatId, step: 'word', type: 'banned' });
    await ctx.editMessageText('🔤 *إضافة كلمة محظورة*\n\nأرسل الكلمة المراد حظرها (في محادثة الخاص):', {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('❌ إلغاء', `bwords_list_${chatId}`)]]),
    });
  });

  bot.action(/^aw_action_(\d+)_(warn|mute|kick|ban)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const userId = Number(ctx.match[1]);
    const action = ctx.match[2];
    if (ctx.from.id !== userId) return ctx.answerCbQuery('❌', { show_alert: true });
    const state  = pendingAddWord.get(userId);
    if (!state) return ctx.answerCbQuery('❌ انتهت الجلسة!', { show_alert: true });
    state.action = action; state.step = 'threshold';
    pendingAddWord.set(userId, state);
    const arAct = { warn: '⚠️ تحذير', mute: '🔇 كتم', kick: '👢 طرد', ban: '🚫 حظر' };
    await ctx.editMessageText(`✅ الكلمة: \`${state.word}\`\nالإجراء: ${arAct[action]}\n\nكم مرة قبل تطبيق الإجراء؟`, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('1 مرة', `aw_thresh_${userId}_1`), Markup.button.callback('2 مرة', `aw_thresh_${userId}_2`), Markup.button.callback('3 مرات', `aw_thresh_${userId}_3`)],
        [Markup.button.callback('4 مرات', `aw_thresh_${userId}_4`), Markup.button.callback('5 مرات', `aw_thresh_${userId}_5`)],
      ]),
    });
  });

  bot.action(/^aw_thresh_(\d+)_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const userId    = Number(ctx.match[1]);
    const threshold = Number(ctx.match[2]);
    if (ctx.from.id !== userId) return ctx.answerCbQuery('❌', { show_alert: true });
    const state = pendingAddWord.get(userId);
    if (!state) return ctx.answerCbQuery('❌ انتهت الجلسة!', { show_alert: true });
    pendingAddWord.delete(userId);
    const g = db.getGroup(state.chatId);
    if (!g) return ctx.answerCbQuery('❌ المجموعة غير موجودة!', { show_alert: true });
    if (g.bannedWords.find(bw => bw.word.toLowerCase() === state.word.toLowerCase()))
      return ctx.answerCbQuery('⚠️ الكلمة موجودة مسبقاً!', { show_alert: true });
    g.bannedWords.push({ word: state.word, action: state.action, threshold, addedBy: userId, addedAt: new Date() });
    const arAct = { warn: '⚠️ تحذير', mute: '🔇 كتم', kick: '👢 طرد', ban: '🚫 حظر' };
    await ctx.editMessageText(
      `✅ *تمت إضافة الكلمة المحظورة*\n\n🔤 \`${state.word}\`\nالإجراء: ${arAct[state.action]}\nبعد: \`${threshold}\` مرة`,
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 قائمة الكلمات', `bwords_list_${state.chatId}`)]]) }
    );
  });

  // ══════════════════════════════════════════════════════════
  //  الكلمات المسموحة (FEATURE 3)
  // ══════════════════════════════════════════════════════════

  bot.action(/^awords_list_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const g = db.getGroup(chatId);
    if (!g) return ctx.answerCbQuery('❌ بيانات غير موجودة!', { show_alert: true });
    if (!g.allowedWords) g.allowedWords = [];
    let text   = `🟢 *الكلمات المسموحة* (${g.allowedWords.length})\n\n`;
    const btns = g.allowedWords.map((aw, i) => {
      const specialistLabel = aw.hasSpecialist ? ` 👤 @${aw.specialistUsername}` : '';
      text += `${i + 1}. \`${aw.word}\`${specialistLabel}\n`;
      return [
        Markup.button.callback(`🗑️ حذف: ${aw.word.slice(0, 14)}`, `del_aword_${i}_${chatId}`),
        Markup.button.callback(`👤 متخصص`, `aword_set_specialist_${i}_${chatId}`),
      ];
    });
    if (!g.allowedWords.length) text += '_لا توجد كلمات مسموحة حتى الآن._\n';
    btns.push([Markup.button.callback('➕ إضافة كلمة مسموحة', `add_aword_start_${chatId}`)]);
    btns.push([Markup.button.callback('🔙 رجوع', `settings_${chatId}`)]);
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) });
  });

  bot.action(/^del_aword_(\d+)_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const [idx, chatId] = [Number(ctx.match[1]), Number(ctx.match[2])];
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const g = db.getGroup(chatId); if (!g || !g.allowedWords) return;
    const removed = g.allowedWords.splice(idx, 1);
    await ctx.answerCbQuery(`🗑️ حُذفت: ${removed[0]?.word || ''}`, { show_alert: true });
    // إعادة عرض القائمة
    let text   = `🟢 *الكلمات المسموحة* (${g.allowedWords.length})\n\n`;
    const btns = g.allowedWords.map((aw, i) => {
      text += `${i + 1}. \`${aw.word}\`${aw.hasSpecialist ? ` 👤 @${aw.specialistUsername}` : ''}\n`;
      return [Markup.button.callback(`🗑️ حذف: ${aw.word.slice(0, 14)}`, `del_aword_${i}_${chatId}`), Markup.button.callback('👤 متخصص', `aword_set_specialist_${i}_${chatId}`)];
    });
    if (!g.allowedWords.length) text += '_لا توجد كلمات مسموحة حتى الآن._\n';
    btns.push([Markup.button.callback('➕ إضافة كلمة مسموحة', `add_aword_start_${chatId}`)]);
    btns.push([Markup.button.callback('🔙 رجوع', `settings_${chatId}`)]);
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) });
  });

  bot.action(/^add_aword_start_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    pendingAddAllowed.set(ctx.from.id, { chatId, step: 'word' });
    await ctx.editMessageText('🟢 *إضافة كلمة مسموحة*\n\nأرسل الكلمة التي تريد الترحيب بها (في محادثة الخاص):', {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('❌ إلغاء', `awords_list_${chatId}`)]]),
    });
  });

  // ── message handler للحالتين (banned + allowed pending) ────────────
  bot.on('message', async (ctx, next) => {
    if (!ctx.from) return next();
    if (ctx.chat.type !== 'private') return next();
    const text = ctx.message.text?.trim();
    if (!text) return next();

    // حالة إضافة كلمة محظورة
    const bState = pendingAddWord.get(ctx.from.id);
    if (bState) {
      if (bState.step === 'word') {
        bState.word = text;
        bState.step = 'action';
        pendingAddWord.set(ctx.from.id, bState);
        await ctx.reply(`✅ الكلمة: \`${text}\`\n\nاختر الإجراء عند اكتشافها:`, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('⚠️ تحذير', `aw_action_${ctx.from.id}_warn`), Markup.button.callback('🔇 كتم', `aw_action_${ctx.from.id}_mute`)],
            [Markup.button.callback('👢 طرد',   `aw_action_${ctx.from.id}_kick`), Markup.button.callback('🚫 حظر', `aw_action_${ctx.from.id}_ban`)],
          ]),
        });
        return;
      }
      return next();
    }

    // حالة إضافة كلمة مسموحة
    const aState = pendingAddAllowed.get(ctx.from.id);
    if (aState) {
      if (aState.step === 'word') {
        aState.word = text;
        aState.step = 'done';
        pendingAddAllowed.delete(ctx.from.id);
        const g = db.getGroup(aState.chatId);
        if (!g) return ctx.reply('❌ المجموعة غير موجودة!');
        if (!g.allowedWords) g.allowedWords = [];
        if (g.allowedWords.find(aw => aw.word.toLowerCase() === text.toLowerCase()))
          return ctx.reply('⚠️ الكلمة موجودة مسبقاً!');
        g.allowedWords.push({
          word:              text,
          hasSpecialist:     false,
          specialistUserId:  null,
          specialistUsername:'',
          addedBy:           ctx.from.id,
          addedAt:           new Date(),
        });
        await ctx.reply(
          `✅ *تمت إضافة الكلمة المسموحة*\n\n🟢 \`${text}\`\n\n_يمكنك تعيين متخصص لها لاحقاً من قائمة الكلمات المسموحة._`,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([[Markup.button.callback('🔙 قائمة الكلمات المسموحة', `awords_list_${aState.chatId}`)]])
          }
        );
        return;
      }
      return next();
    }

    return next();
  });

};
