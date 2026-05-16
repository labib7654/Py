// FEATURE 5: النسخ الاحتياطي والاستعادة
const { Markup } = require('telegraf');
const fs         = require('fs');
const path       = require('path');
const db         = require('./db');
const { isDeveloper } = require('./helpers_permissions');
// FIX 23: استخدام الحالة المشتركة
const sharedState = require('./shared_state');
const pendingRestore = sharedState.pendingRestore;

module.exports = function setupBackupHandlers(bot) {

  // ── زر النسخ الاحتياطي ───────────────────────────────────────────────
  bot.action('dev_backup', async (ctx) => {
    await ctx.answerCbQuery();
    if (!isDeveloper(ctx)) return;
    await performBackup(bot, ctx);
  });

  bot.command('backup', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.reply('❌ مطور فقط!');
    await performBackup(bot, ctx);
  });

  // ── زر الاستعادة ─────────────────────────────────────────────────────
  bot.action('dev_restore', async (ctx) => {
    await ctx.answerCbQuery();
    if (!isDeveloper(ctx)) return;
    pendingRestore.set(ctx.from.id, true);
    await ctx.editMessageText(
      '♻️ *استعادة النسخ الاحتياطي*\n\n' +
      'أرسل ملف JSON (data.json) للاستعادة.\n\n' +
      '⚠️ *تحذير:* سيستبدل الملف الحالي وتُفقد البيانات غير المحفوظة!',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('❌ إلغاء', 'dev_home')]]),
      }
    );
  });

  bot.command('restore', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.reply('❌ مطور فقط!');
    pendingRestore.set(ctx.from.id, true);
    await ctx.reply(
      '♻️ *استعادة النسخ الاحتياطي*\n\nأرسل ملف JSON (data.json):',
      { parse_mode: 'Markdown' }
    );
  });

  // ── استقبال ملف JSON ─────────────────────────────────────────────────
  bot.on('document', async (ctx, next) => {
    if (!ctx.from || ctx.chat.type !== 'private') return next();
    if (!isDeveloper(ctx)) return next();
    if (!pendingRestore.has(ctx.from.id)) return next();

    const doc = ctx.message.document;
    if (!doc.file_name.endsWith('.json') && doc.mime_type !== 'application/json') {
      return ctx.reply('❌ الملف يجب أن يكون بصيغة JSON!');
    }
    if (doc.file_size > 10 * 1024 * 1024) {
      return ctx.reply('❌ الملف أكبر من 10 ميجابايت!');
    }

    pendingRestore.delete(ctx.from.id);
    const statusMsg = await ctx.reply('⏳ جاري استعادة البيانات...');

    try {
      const fileLink = await bot.telegram.getFileLink(doc.file_id);
      const res      = await fetch(fileLink.href);
      const json     = await res.text();

      JSON.parse(json); // التحقق من صحة JSON

      // FIX 14: إصلاح مسار data.json — مستوى واحد فقط للأعلى
      const DATA_FILE = process.env.DATA_FILE
        ? path.resolve(process.env.DATA_FILE)
        : path.join(__dirname, '..', 'data.json');
      const BAK_FILE  = DATA_FILE.replace('.json', `.bak_${Date.now()}.json`);
      if (fs.existsSync(DATA_FILE)) fs.copyFileSync(DATA_FILE, BAK_FILE);

      fs.writeFileSync(DATA_FILE, json, 'utf-8');
      db.loadData();

      const stats = db.getStats();
      await bot.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined,
        `✅ *تمت الاستعادة بنجاح!*\n\n` +
        `👥 مجموعات: \`${stats.totalGroups}\`\n` +
        `📢 قنوات: \`${stats.totalChannels}\`\n` +
        `👤 مستخدمون: \`${stats.totalUsers}\`\n\n` +
        `💾 النسخة السابقة محفوظة في:\n\`${path.basename(BAK_FILE)}\``,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([[Markup.button.callback('🔙 الرئيسية', 'dev_home')]]),
        }
      );
    } catch (e) {
      await bot.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined,
        `❌ *فشل الاستعادة:*\n${e.message}`,
        { parse_mode: 'Markdown' }
      );
    }
  });

};

async function performBackup(bot, ctx) {
  // FIX 14: إصلاح مسار data.json
  const DATA_FILE = process.env.DATA_FILE
    ? path.resolve(process.env.DATA_FILE)
    : path.join(__dirname, '..', 'data.json');

  db.saveData();

  // FIX 15: استخدام ctx.reply مباشرةً
  if (!fs.existsSync(DATA_FILE)) {
    return await ctx.reply('❌ لا يوجد ملف بيانات!');
  }

  const stats = db.getStats();
  const caption =
    `💾 *نسخ احتياطي — جامعة v4.0*\n\n` +
    `👥 مجموعات: \`${stats.totalGroups}\`\n` +
    `📢 قنوات: \`${stats.totalChannels}\`\n` +
    `👤 مستخدمون: \`${stats.totalUsers}\`\n` +
    `🚫 محظورون: \`${stats.bannedUsers}\`\n\n` +
    `🕐 ${new Date().toLocaleString('ar')}`;

  try {
    const chatId  = ctx.from?.id || ctx.chat?.id;
    const docName = `backup_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    await bot.telegram.sendDocument(chatId, {
      source: fs.createReadStream(DATA_FILE),
      filename: docName,
    }, { caption, parse_mode: 'Markdown' });

    if (ctx.editMessageText) {
      try { await ctx.editMessageText('✅ *تم إرسال النسخ الاحتياطي!*', { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', 'dev_home')]]) }); } catch {}
    }
  } catch (e) {
    await ctx.reply(`❌ فشل الإرسال: ${e.message}`);
  }
}
