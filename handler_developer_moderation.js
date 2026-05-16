// /gban، /userinfo، broadcast، /forcejoin، /chatinfo، /devmanage
const { Markup }   = require('telegraf');
const db           = require('./db');
const { isDeveloper, getTargetUser, getReason } = require('./helpers_permissions');
const sharedState  = require('./shared_state');

// FIX 22: استخدام الحالة المشتركة بدل Map محلي
const pendingBroadcast = sharedState.pendingBroadcast;

module.exports = function setupModerationHandlers(bot) {

  // ── /gban ────────────────────────────────────────────────────────────
  bot.command('gban', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.reply('❌ مطور فقط!');
    const args  = ctx.message.text.split(' ').slice(1);
    if (!args[0]) return ctx.reply('❌ استخدم: /gban <ID> [سبب]');
    const uid   = Number(args[0]);
    if (isNaN(uid)) return ctx.reply('❌ معرّف غير صحيح!');
    const reason = args.slice(1).join(' ') || 'حظر عالمي بواسطة المطور';
    const user   = db.getOrCreateUser(uid, '', '');
    user.globalBanned = true;
    user.bannedReason = reason;
    user.bannedAt     = new Date();
    let banCount = 0;
    for (const g of db.allGroups()) {
      try { await bot.telegram.banChatMember(g.chatId, uid); banCount++; } catch {}
    }
    await ctx.replyWithMarkdown(
      `🚫 *تم الحظر العالمي*\n\n🆔 \`${uid}\`\n📝 ${reason}\n🔢 طُرد من: \`${banCount}\` مجموعة`,
      Markup.inlineKeyboard([[Markup.button.callback('✅ رفع الحظر', `ungban_${uid}`)]])
    );
  });

  // ── /ungban ──────────────────────────────────────────────────────────
  bot.command('ungban', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.reply('❌ مطور فقط!');
    const uid = Number(ctx.message.text.split(' ')[1]);
    if (!uid || isNaN(uid)) return ctx.reply('❌ استخدم: /ungban <ID>');
    const user = db.getUser(uid);
    if (!user) return ctx.reply('❌ المستخدم غير موجود!');
    user.globalBanned = false;
    user.bannedReason = '';
    let unbanCount = 0;
    for (const g of db.allGroups()) {
      try { await bot.telegram.unbanChatMember(g.chatId, uid); unbanCount++; } catch {}
    }
    await ctx.replyWithMarkdown(`✅ *تم رفع الحظر العالمي*\n\n🆔 \`${uid}\`\n🔢 رُفع من: \`${unbanCount}\` مجموعة`);
  });

  bot.action(/^ungban_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!isDeveloper(ctx)) return;
    const uid  = Number(ctx.match[1]);
    const user = db.getUser(uid);
    if (!user) return ctx.answerCbQuery('❌ غير موجود!', { show_alert: true });
    user.globalBanned = false;
    user.bannedReason = '';
    for (const g of db.allGroups()) { try { await bot.telegram.unbanChatMember(g.chatId, uid); } catch {} }
    await ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n✅ *تم رفع الحظر العالمي*', { parse_mode: 'Markdown' });
  });

  // ── قائمة الحظر العالمي ──────────────────────────────────────────────
  bot.action('dev_gbans', async (ctx) => {
    await ctx.answerCbQuery();
    if (!isDeveloper(ctx)) return;
    const banned = db.allUsers().filter(u => u.globalBanned);
    if (!banned.length)
      return ctx.editMessageText('🚫 *لا يوجد مستخدمون محظورون عالمياً.*', {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', 'dev_home')]]),
      });
    let text = `🚫 *الحظر العالمي* (${banned.length})\n\n`;
    banned.slice(0, 15).forEach((u, i) => {
      text += `${i + 1}. \`${u.userId}\` ${u.username ? `@${u.username}` : u.firstName || '—'}\n   📝 ${u.bannedReason || '—'}\n`;
    });
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', 'dev_home')]]),
    });
  });

  // ── /userinfo ─────────────────────────────────────────────────────────
  bot.command('userinfo', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.reply('❌ مطور فقط!');
    const uid  = Number(ctx.message.text.split(' ')[1]);
    if (!uid || isNaN(uid)) return ctx.reply('❌ استخدم: /userinfo <ID>');
    const user = db.getUser(uid);
    if (!user) return ctx.reply('❌ المستخدم غير موجود في قاعدة البيانات!');
    const groupsStr = [...user.groups].map(id => db.getGroup(id)?.title || String(id)).join('، ') || '—';
    await ctx.replyWithMarkdown(
      `📋 *معلومات المستخدم*\n\n` +
      `🆔 \`${uid}\`\n` +
      `👤 ${user.firstName || '—'}\n` +
      `@${user.username || '—'}\n` +
      `🌍 محظور عالمياً: ${user.globalBanned ? `✅ — ${user.bannedReason}` : '❌'}\n` +
      `📅 أول ظهور: ${user.firstSeen ? new Date(user.firstSeen).toLocaleDateString('ar') : '—'}\n` +
      `👁️ آخر نشاط: ${user.lastSeen ? new Date(user.lastSeen).toLocaleDateString('ar') : '—'}\n` +
      `👥 المجموعات: ${groupsStr}\n` +
      `📨 تاريخ الطلبات: \`${user.joinRequestHistory?.length || 0}\` طلب`
    );
  });

  // ── /chatinfo ─────────────────────────────────────────────────────────
  bot.command('chatinfo', async (ctx) => {
    if (!isDeveloper(ctx) && ctx.chat.type === 'private') return ctx.reply('❌ مطور فقط!');
    const arg    = ctx.message.text.split(' ')[1];
    const chatId = arg ? Number(arg) : ctx.chat.id;
    if (isNaN(chatId)) return ctx.reply('❌ معرّف شات غير صحيح!');
    try {
      const chat = await bot.telegram.getChat(chatId);
      await ctx.replyWithMarkdown(
        `📌 *معلومات الشات*\n\n` +
        `🆔 \`${chat.id}\`\n` +
        `📌 الاسم: *${chat.title || chat.first_name || '—'}*\n` +
        `@${chat.username || '—'}\n` +
        `📂 النوع: \`${chat.type}\`\n` +
        `🧵 يدعم المواضيع: ${chat.is_forum ? '✅' : '❌'}\n` +
        `🔗 مرتبط بقناة: ${chat.linked_chat_id ? `\`${chat.linked_chat_id}\`` : '❌'}\n` +
        `👥 الأعضاء: \`${chat.members_count || '—'}\`\n` +
        `📝 الوصف: ${chat.description || '—'}`
      );
    } catch (e) { await ctx.reply(`❌ فشل جلب بيانات الشات: ${e.message}`); }
  });

  // ── /forcejoin ────────────────────────────────────────────────────────
  bot.command('forcejoin', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.reply('❌ مطور فقط!');
    const args   = ctx.message.text.split(' ').slice(1);
    if (args.length < 2) return ctx.reply('❌ استخدم: /forcejoin <user_id> <chat_id>');
    const [uid, cid] = [Number(args[0]), Number(args[1])];
    try {
      const link = await bot.telegram.callApi('createChatInviteLink', {
        chat_id: cid,
        name:    `forcejoin_${uid}`,
        creates_join_request: false,
        member_limit: 1,
      });
      await bot.telegram.sendMessage(uid, `📩 تمت دعوتك للانضمام:\n${link.invite_link}`);
      await ctx.reply(`✅ تم إرسال رابط الانضمام للمستخدم \`${uid}\``, { parse_mode: 'Markdown' });
    } catch (e) { await ctx.reply(`❌ ${e.message}`); }
  });

  // ── /devmanage ────────────────────────────────────────────────────────
  bot.command('devmanage', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.reply('❌ مطور فقط!');
    const arg    = ctx.message.text.split(' ')[1];
    const chatId = arg ? Number(arg) : null;
    if (!chatId || isNaN(chatId)) {
      const groups = db.allGroups();
      if (!groups.length) return ctx.reply('❌ لا توجد مجموعات!');
      const btns = groups.slice(0, 8).map(g => [Markup.button.callback(`📌 ${g.title}`, `devmanage_${g.chatId}`)]);
      return ctx.reply('🔧 *اختر مجموعة للإدارة:*', { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) });
    }
    const g = db.getGroup(chatId);
    if (!g) return ctx.reply('❌ المجموعة غير موجودة!');
    await ctx.replyWithMarkdown(
      `🔧 *إدارة مطور — ${g.title}*\n\n🆔 \`${chatId}\`\n👑 المالك: ${g.ownerUsername || 'غير محدد'}\n👥 الأعضاء: \`${g.members.size}\``,
      Markup.inlineKeyboard([
        [Markup.button.callback('⚙️ الإعدادات', `settings_${chatId}`), Markup.button.callback('🚫 حذف المجموعة', `devmanage_delete_${chatId}`)],
        // FIX 3: استخدام devmanage_stats_ بدل stats_
        [Markup.button.callback('📊 إحصائيات', `devmanage_stats_${chatId}`)],
      ])
    );
  });

  bot.action(/^devmanage_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!isDeveloper(ctx)) return;
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId);
    if (!g) return ctx.answerCbQuery('❌ غير موجودة!', { show_alert: true });
    await ctx.editMessageText(
      `🔧 *إدارة مطور — ${g.title}*\n\n🆔 \`${chatId}\`\n👑 المالك: ${g.ownerUsername || 'غير محدد'}\n👥 الأعضاء: \`${g.members.size}\``,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('⚙️ الإعدادات', `settings_${chatId}`), Markup.button.callback('🚫 حذف', `devmanage_delete_${chatId}`)],
          // FIX 3: استخدام devmanage_stats_ بدل stats_
          [Markup.button.callback('📊 إحصائيات', `devmanage_stats_${chatId}`)],
          [Markup.button.callback('🔙 رجوع', 'dev_home')],
        ]),
      }
    );
  });

  bot.action(/^devmanage_delete_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!isDeveloper(ctx)) return;
    const chatId = Number(ctx.match[1]);
    db.deleteGroup(chatId);
    await ctx.editMessageText('✅ تم حذف المجموعة من قاعدة البيانات.');
  });

  // FIX 3: action مستقل لإحصائيات المطور يستخدم editMessageText
  bot.action(/^devmanage_stats_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!isDeveloper(ctx)) return;
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId);
    if (!g) return ctx.answerCbQuery('❌ غير موجودة!', { show_alert: true });
    const warns = [...g.warns.values()].reduce((a, w) => a + w.length, 0);
    await ctx.editMessageText(
      `📊 *إحصائيات ${g.title}*\n\n👥 الأعضاء: ${g.members.size}\n👮 المشرفون: ${g.admins.size}\n⚠️ التحذيرات: ${warns}\n🔇 المكتومون: ${g.mutedUsers.size}\n🚫 المحظورون: ${g.bannedUsers.size}`,
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', `devmanage_${chatId}`)]]) }
    );
  });

  // ── بث الرسائل ───────────────────────────────────────────────────────
  bot.action('dev_broadcast_menu', async (ctx) => {
    await ctx.answerCbQuery();
    if (!isDeveloper(ctx)) return;
    pendingBroadcast.set(ctx.from.id, { step: 'text' });
    await ctx.editMessageText(
      '📢 *بث رسالة*\n\nأرسل نص الرسالة التي تريد بثها لجميع المجموعات:\n\n_(يدعم Markdown والإيموجي)_',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('❌ إلغاء', 'dev_home')]]),
      }
    );
  });

  bot.command('broadcast', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.reply('❌ مطور فقط!');
    const text = ctx.message.text.split('\n').slice(1).join('\n').trim();
    if (!text) return ctx.reply('❌ أرسل: /broadcast\nنص الرسالة');
    await sendBroadcast(bot, ctx, text);
  });

  bot.on('message', async (ctx, next) => {
    if (!ctx.from || ctx.chat.type !== 'private') return next();
    const state = pendingBroadcast.get(ctx.from.id);
    if (!state) return next();
    if (state.step === 'text') {
      const text = ctx.message.text;
      if (!text) return next();
      pendingBroadcast.delete(ctx.from.id);
      await sendBroadcast(bot, ctx, text);
      return;
    }
    return next();
  });

  // FIX 2: إزالة answerCbQuery الأول المزدوج — الثاني فقط مع show_alert
  bot.action('dev_global_protect', async (ctx) => {
    if (!isDeveloper(ctx)) return ctx.answerCbQuery('❌', { show_alert: true });
    db.botSettings.globalProtectContent = !db.botSettings.globalProtectContent;
    const enabled = db.botSettings.globalProtectContent;
    if (enabled) {
      for (const g of db.allGroups()) {
        try { await bot.telegram.setChatProtectContent(g.chatId, { is_protected: true }); } catch {}
      }
    }
    await ctx.editMessageText(
      `🔒 *حماية المحتوى العالمية*\n\nالحالة: ${enabled ? '✅ مفعّلة' : '❌ معطّلة'}\n\n_${enabled ? 'تم تطبيقها على جميع المجموعات.' : 'كل مجموعة تتحكم بإعدادها الخاص.'}_`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback(`${enabled ? '✅' : '❌'} حماية عالمية`, 'dev_global_protect')],
          [Markup.button.callback('🔙 رجوع', 'dev_home')],
        ]),
      }
    );
    await ctx.answerCbQuery(enabled ? '✅ حماية عالمية مفعّلة!' : '❌ حماية عالمية معطّلة!', { show_alert: true });
  });

};

async function sendBroadcast(bot, ctx, text) {
  const groups = db.allGroups();
  let success = 0, fail = 0;
  const status = await ctx.reply(`⏳ جاري البث لـ ${groups.length} مجموعة...`);
  for (const g of groups) {
    try { await bot.telegram.sendMessage(g.chatId, text, { parse_mode: 'Markdown' }); success++; } catch { fail++; }
    await new Promise(r => setTimeout(r, 80));
  }
  try {
    await bot.telegram.editMessageText(ctx.chat.id, status.message_id, undefined,
      `✅ *اكتمل البث*\n\n✅ نجح: \`${success}\`\n❌ فشل: \`${fail}\``, { parse_mode: 'Markdown' }
    );
  } catch {}
}
