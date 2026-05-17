// ============================================================
//  handler_adder.js — ميزة الإضافة العشوائية للمطور (مُصلَح)
//  الإضافة عبر: إنشاء invite link وإرساله للمستخدم بالخاص
// ============================================================

const { Markup } = require('telegraf');
const db         = require('./db');
const { isDeveloperOrBotAdmin } = require('./helpers');

// ─── حالة جلسة الإضافة لكل مستخدم ───────────────────────────
const adderSessions = new Map();

const PAGE_SIZE_USERS = 8;
const PAGE_SIZE_CHATS = 8;

// ─── فلترة المستخدمين الصالحين للإضافة ──────────────────────
function getEligibleUsers() {
  return db.allUsers()
    .filter(u => !u.globalBanned && u.userId > 0)
    .sort((a, b) => {
      const ta = a.lastSeen ? new Date(a.lastSeen).getTime() : 0;
      const tb = b.lastSeen ? new Date(b.lastSeen).getTime() : 0;
      return tb - ta;
    });
}

// ─── لوحة اختيار الأعضاء ─────────────────────────────────────
function buildUserKeyboard(users, selected, page, totalPages) {
  const btns = users.map(u => {
    const tick  = selected.has(u.userId) ? '✅ ' : '';
    const name  = (u.firstName || u.username || String(u.userId)).slice(0, 18);
    const uname = u.username ? ` @${u.username}` : '';
    return [Markup.button.callback(
      `${tick}${name}${uname}`.slice(0, 40),
      `au_t_${u.userId}_${page}`
    )];
  });

  const nav = [];
  if (page > 0)              nav.push(Markup.button.callback('◀️', `au_p_${page - 1}`));
  nav.push(Markup.button.callback(`${page + 1}/${totalPages}`, 'au_noop'));
  if (page + 1 < totalPages) nav.push(Markup.button.callback('▶️', `au_p_${page + 1}`));
  if (nav.length) btns.push(nav);

  btns.push([
    Markup.button.callback('🎲 عشوائي 10', 'au_rand_10'),
    Markup.button.callback('🎲 عشوائي 25', 'au_rand_25'),
  ]);
  btns.push([
    Markup.button.callback('🗑️ مسح الكل', 'au_clear'),
    Markup.button.callback(`✅ تأكيد (${selected.size})`, 'au_done'),
  ]);
  btns.push([Markup.button.callback('🔙 رجوع', 'dev_back')]);
  return Markup.inlineKeyboard(btns);
}

// ─── لوحة اختيار الهدف (قروب أو قناة) ───────────────────────
function buildChatKeyboard(chats, page, totalPages, type, selectedCount) {
  const btns = chats.map(c => {
    const icon  = type === 'channel' ? '📢' : '👥';
    const name  = (c.title || String(c.chatId)).slice(0, 26);
    const count = type === 'channel'
      ? (c.subscribers?.size || 0)
      : (c.members?.size     || 0);
    return [Markup.button.callback(
      `${icon} ${name} (${count} عضو)`,
      `au_ch_${c.chatId}_${page}`
    )];
  });

  const nav = [];
  if (page > 0)              nav.push(Markup.button.callback('◀️', `au_cp_${page - 1}_${type}`));
  nav.push(Markup.button.callback(`${page + 1}/${totalPages}`, 'au_noop'));
  if (page + 1 < totalPages) nav.push(Markup.button.callback('▶️', `au_cp_${page + 1}_${type}`));
  if (nav.length) btns.push(nav);

  const switchLabel = type === 'channel' ? '👥 القروبات' : '📢 القنوات';
  const switchType  = type === 'channel' ? 'group' : 'channel';
  btns.push([Markup.button.callback(switchLabel, `au_sw_${switchType}_0`)]);
  btns.push([Markup.button.callback('🔙 رجوع لاختيار الأعضاء', 'adder_start')]);
  return Markup.inlineKeyboard(btns);
}

// ─── الإضافة الفعلية عبر invite link ─────────────────────────
// تيليغرام Bot API لا تتيح إضافة مستخدمين مباشرة إلا للأكاونت العادي (User)
// الحل: إنشاء invite link وإرساله لكل شخص بالخاص
async function performAdd(bot, targetChatId, targetName, userIds) {
  let success = 0, failed = 0, noPrivate = 0;
  const noPrivateList = [];

  // إنشاء invite link خاص بهذه العملية (محدود بالعدد المطلوب)
  let inviteLink = null;
  try {
    const res = await bot.telegram.createChatInviteLink(targetChatId, {
      name:         `batch_${Date.now()}`,
      member_limit: userIds.length + 10,
    });
    inviteLink = res.invite_link;
  } catch {
    // fallback: محاولة الحصول على اللينك العام
    try {
      const chat = await bot.telegram.getChat(targetChatId);
      inviteLink = chat.invite_link || null;
    } catch {}
  }

  if (!inviteLink) {
    return {
      success: 0, failed: userIds.length, noPrivate: 0,
      noPrivateList: [],
      inviteLink: null,
      error: '❌ البوت لا يملك صلاحية إنشاء روابط دعوة في هذا الشات\n(تأكد أن البوت مشرف بصلاحية "إضافة أعضاء" أو "إنشاء روابط")',
    };
  }

  // إرسال الرابط لكل مستخدم بالخاص
  for (const uid of userIds) {
    const u    = db.getUser(uid);
    const name = u?.firstName || u?.username || String(uid);

    try {
      await bot.telegram.sendMessage(uid,
        `👋 *مرحباً ${name}!*\n\n` +
        `تمت دعوتك للانضمام إلى:\n` +
        `📌 *${targetName}*\n\n` +
        `اضغط الزر للانضمام 👇`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: `➕ انضم إلى ${targetName}`, url: inviteLink }
            ]],
          },
        }
      );
      success++;
    } catch (e) {
      const msg = e.message || '';
      if (
        msg.includes('bot was blocked') ||
        msg.includes('user is deactivated') ||
        msg.includes('chat not found') ||
        msg.includes('PEER_ID_INVALID') ||
        msg.includes('Forbidden')
      ) {
        noPrivate++;
        noPrivateList.push(u?.username ? `@${u.username}` : String(uid));
      } else {
        failed++;
      }
    }
    // تأخير بين الرسائل لتجنب flood
    await new Promise(r => setTimeout(r, 350));
  }

  return { success, failed, noPrivate, noPrivateList, inviteLink, error: null };
}

// ════════════════════════════════════════════════════════════════
module.exports = function setupAdder(bot) {

  // ── فتح لوحة الاختيار ──────────────────────────────────────
  bot.action('adder_start', async (ctx) => {
    if (!isDeveloperOrBotAdmin(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();

    const uid   = ctx.from.id;
    const users = getEligibleUsers();

    adderSessions.set(uid, {
      step:          'select_users',
      selectedUsers: new Set(),
      page:          0,
    });

    if (!users.length) {
      return ctx.editMessageText(
        '⚠️ *لا يوجد مستخدمون محفوظون بعد.*\n\n' +
        'يحتاج أشخاص أن يتفاعلوا مع البوت في أي قروب أو يرسلون له رسالة أولاً.',
        { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', 'dev_back')]]) }
      );
    }

    const page  = 0;
    const slice = users.slice(0, PAGE_SIZE_USERS);
    const total = Math.ceil(users.length / PAGE_SIZE_USERS);

    await ctx.editMessageText(
      `👥 *اختر الأعضاء للإضافة*\n\n` +
      `📋 إجمالي المحفوظين: \`${users.length}\` شخص\n` +
      `✅ المختارون حالياً: \`0\`\n\n` +
      `اضغط على اسم الشخص لاختياره/إلغائه:`,
      { parse_mode: 'Markdown', ...buildUserKeyboard(slice, new Set(), page, total) }
    );
  });

  // ── تبديل اختيار مستخدم — au_t_USERID_PAGE ────────────────
  bot.action(/^au_t_(\d+)_(\d+)$/, async (ctx) => {
    if (!isDeveloperOrBotAdmin(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });

    const uid      = ctx.from.id;
    const targetId = Number(ctx.match[1]);
    const page     = Number(ctx.match[2]);
    const session  = adderSessions.get(uid);

    if (!session) {
      return ctx.answerCbQuery('⚠️ انتهت الجلسة — افتح 🎲 الإضافة العشوائية من جديد', { show_alert: true });
    }

    if (session.selectedUsers.has(targetId)) {
      session.selectedUsers.delete(targetId);
      await ctx.answerCbQuery('❌ تم إلغاء الاختيار');
    } else {
      session.selectedUsers.add(targetId);
      await ctx.answerCbQuery('✅ تم الاختيار');
    }

    const users = getEligibleUsers();
    const slice = users.slice(page * PAGE_SIZE_USERS, (page + 1) * PAGE_SIZE_USERS);
    const total = Math.ceil(users.length / PAGE_SIZE_USERS);

    try {
      await ctx.editMessageText(
        `👥 *اختر الأعضاء للإضافة*\n\n` +
        `📋 إجمالي المحفوظين: \`${users.length}\` شخص\n` +
        `✅ المختارون حالياً: \`${session.selectedUsers.size}\`\n\n` +
        `اضغط على الاسم للاختيار/إلغائه:`,
        { parse_mode: 'Markdown', ...buildUserKeyboard(slice, session.selectedUsers, page, total) }
      );
    } catch {}
  });

  // ── تنقل صفحات الأعضاء — au_p_PAGE ─────────────────────────
  bot.action(/^au_p_(\d+)$/, async (ctx) => {
    if (!isDeveloperOrBotAdmin(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();

    const uid     = ctx.from.id;
    const page    = Number(ctx.match[1]);
    const session = adderSessions.get(uid);
    if (!session) return ctx.answerCbQuery('⚠️ انتهت الجلسة', { show_alert: true });

    session.page  = page;
    const users   = getEligibleUsers();
    const slice   = users.slice(page * PAGE_SIZE_USERS, (page + 1) * PAGE_SIZE_USERS);
    const total   = Math.ceil(users.length / PAGE_SIZE_USERS);

    try {
      await ctx.editMessageText(
        `👥 *اختر الأعضاء للإضافة*\n\n` +
        `📋 الإجمالي: \`${users.length}\`\n✅ المختارون: \`${session.selectedUsers.size}\``,
        { parse_mode: 'Markdown', ...buildUserKeyboard(slice, session.selectedUsers, page, total) }
      );
    } catch {}
  });

  // ── اختيار عشوائي — au_rand_N ───────────────────────────────
  bot.action(/^au_rand_(\d+)$/, async (ctx) => {
    if (!isDeveloperOrBotAdmin(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });

    const uid     = ctx.from.id;
    const count   = Number(ctx.match[1]);
    const session = adderSessions.get(uid);
    if (!session) return ctx.answerCbQuery('⚠️ انتهت الجلسة', { show_alert: true });

    const users    = getEligibleUsers();
    const shuffled = [...users].sort(() => Math.random() - 0.5);
    session.selectedUsers = new Set(shuffled.slice(0, count).map(u => u.userId));

    await ctx.answerCbQuery(`🎲 تم اختيار ${session.selectedUsers.size} شخص`);

    const page  = 0;
    const slice = users.slice(0, PAGE_SIZE_USERS);
    const total = Math.ceil(users.length / PAGE_SIZE_USERS);

    try {
      await ctx.editMessageText(
        `👥 *اختر الأعضاء للإضافة*\n\n` +
        `📋 الإجمالي: \`${users.length}\`\n` +
        `✅ المختارون: \`${session.selectedUsers.size}\` (عشوائي)\n\n` +
        `يمكنك التعديل على الاختيار:`,
        { parse_mode: 'Markdown', ...buildUserKeyboard(slice, session.selectedUsers, page, total) }
      );
    } catch {}
  });

  // ── مسح الاختيار — au_clear ─────────────────────────────────
  bot.action('au_clear', async (ctx) => {
    if (!isDeveloperOrBotAdmin(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery('🗑️ تم مسح الاختيار');

    const uid     = ctx.from.id;
    const session = adderSessions.get(uid);
    if (!session) return;

    session.selectedUsers.clear();
    const page  = session.page || 0;
    const users = getEligibleUsers();
    const slice = users.slice(page * PAGE_SIZE_USERS, (page + 1) * PAGE_SIZE_USERS);
    const total = Math.ceil(users.length / PAGE_SIZE_USERS);

    try {
      await ctx.editMessageText(
        `👥 *اختر الأعضاء للإضافة*\n\n📋 الإجمالي: \`${users.length}\`\n✅ المختارون: \`0\``,
        { parse_mode: 'Markdown', ...buildUserKeyboard(slice, new Set(), page, total) }
      );
    } catch {}
  });

  // ── تأكيد الاختيار — au_done ─────────────────────────────────
  // ⚠️ string action (ليس regex) لضمان أولوية الـ matching
  bot.action('au_done', async (ctx) => {
    if (!isDeveloperOrBotAdmin(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });

    const uid     = ctx.from.id;
    const session = adderSessions.get(uid);

    if (!session) {
      return ctx.answerCbQuery('⚠️ انتهت الجلسة — افتح 🎲 الإضافة العشوائية من جديد', { show_alert: true });
    }
    if (session.selectedUsers.size === 0) {
      return ctx.answerCbQuery('⚠️ اختر شخصاً واحداً على الأقل!', { show_alert: true });
    }

    await ctx.answerCbQuery(`✅ تم اختيار ${session.selectedUsers.size} شخص`);
    session.step = 'select_chat';

    // معاينة المختارين
    const previewIds = [...session.selectedUsers].slice(0, 5);
    const preview    = previewIds.map(id => {
      const u = db.getUser(id);
      return u?.username ? `@${u.username}` : `\`${id}\``;
    }).join(', ');
    const more = session.selectedUsers.size > 5
      ? ` _و${session.selectedUsers.size - 5} آخرين_`
      : '';

    // عرض القروبات المحفوظة
    const groups = db.allGroups();
    const page   = 0;
    const slice  = groups.slice(0, PAGE_SIZE_CHATS);
    const total  = Math.max(1, Math.ceil(groups.length / PAGE_SIZE_CHATS));

    try {
      await ctx.editMessageText(
        `✅ *تم اختيار ${session.selectedUsers.size} شخص*\n\n` +
        `👥 ${preview}${more}\n\n` +
        `📌 *اختر القروب أو القناة التي تريد إضافتهم إليها:*\n\n` +
        `_سيصلهم رابط دعوة مباشرة في الخاص_`,
        { parse_mode: 'Markdown', ...buildChatKeyboard(slice, page, total, 'group', session.selectedUsers.size) }
      );
    } catch (e) {
      console.error('[adder] au_done error:', e.message);
      // إعادة محاولة بدون parse_mode لو كانت مشكلة markdown
      try {
        await ctx.editMessageText(
          `✅ تم اختيار ${session.selectedUsers.size} شخص\n\nاختر القروب أو القناة:`,
          buildChatKeyboard(slice, page, total, 'group', session.selectedUsers.size)
        );
      } catch {}
    }
  });

  // ── تبديل عرض القنوات/القروبات — au_sw_TYPE_PAGE ─────────────
  bot.action(/^au_sw_(group|channel)_(\d+)$/, async (ctx) => {
    if (!isDeveloperOrBotAdmin(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();

    const type    = ctx.match[1];
    const page    = Number(ctx.match[2]);
    const uid     = ctx.from.id;
    const session = adderSessions.get(uid);
    if (!session) return ctx.answerCbQuery('⚠️ انتهت الجلسة', { show_alert: true });

    const chats = type === 'channel' ? db.allChannels() : db.allGroups();
    const slice = chats.slice(page * PAGE_SIZE_CHATS, (page + 1) * PAGE_SIZE_CHATS);
    const total = Math.max(1, Math.ceil(chats.length / PAGE_SIZE_CHATS));

    try {
      await ctx.editMessageText(
        `📌 *اختر ${type === 'channel' ? 'القناة' : 'القروب'} الهدف:*\n\n` +
        `✅ سيتم إرسال رابط دعوة لـ \`${session.selectedUsers.size}\` شخص`,
        { parse_mode: 'Markdown', ...buildChatKeyboard(slice, page, total, type, session.selectedUsers.size) }
      );
    } catch {}
  });

  // ── تنقل صفحات الشاتات — au_cp_PAGE_TYPE ────────────────────
  bot.action(/^au_cp_(\d+)_(group|channel)$/, async (ctx) => {
    if (!isDeveloperOrBotAdmin(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();

    const page    = Number(ctx.match[1]);
    const type    = ctx.match[2];
    const uid     = ctx.from.id;
    const session = adderSessions.get(uid);
    if (!session) return ctx.answerCbQuery('⚠️ انتهت الجلسة', { show_alert: true });

    const chats = type === 'channel' ? db.allChannels() : db.allGroups();
    const slice = chats.slice(page * PAGE_SIZE_CHATS, (page + 1) * PAGE_SIZE_CHATS);
    const total = Math.max(1, Math.ceil(chats.length / PAGE_SIZE_CHATS));

    try {
      await ctx.editMessageText(
        `📌 *اختر ${type === 'channel' ? 'القناة' : 'القروب'} الهدف:*\n` +
        `✅ \`${session.selectedUsers.size}\` شخص مختار`,
        { parse_mode: 'Markdown', ...buildChatKeyboard(slice, page, total, type, session.selectedUsers.size) }
      );
    } catch {}
  });

  // ── اختيار الهدف وبدء الإرسال — au_ch_CHATID_PAGE ───────────
  bot.action(/^au_ch_(-?\d+)_(\d+)$/, async (ctx) => {
    if (!isDeveloperOrBotAdmin(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });

    const uid      = ctx.from.id;
    const targetId = Number(ctx.match[1]);
    const session  = adderSessions.get(uid);

    if (!session || session.selectedUsers.size === 0) {
      return ctx.answerCbQuery('⚠️ لا يوجد أعضاء مختارون!', { show_alert: true });
    }

    await ctx.answerCbQuery('⏳ جاري الإرسال...');

    const targetGroup   = db.getGroup(targetId);
    const targetChannel = db.getChannel(targetId);
    const targetName    = (targetGroup || targetChannel)?.title || String(targetId);
    const userIds       = [...session.selectedUsers];

    // رسالة تقدم
    let progressMsg;
    try {
      progressMsg = await ctx.reply(
        `⏳ *جاري إرسال روابط الدعوة...*\n\n` +
        `📌 الهدف: *${targetName}*\n` +
        `👥 العدد: \`${userIds.length}\` شخص\n\n` +
        `_يتم إرسال رابط لكل شخص في الخاص..._`,
        { parse_mode: 'Markdown' }
      );
    } catch {}

    // تنظيف الجلسة
    adderSessions.delete(uid);

    // تنفيذ الإرسال
    const result = await performAdd(bot, targetId, targetName, userIds);

    // رسالة النتيجة
    let summary =
      `📊 *نتيجة الإضافة — ${targetName}*\n\n` +
      `✅ استلموا الرابط: \`${result.success}\` شخص\n` +
      `🔇 ما استلموا (ما راسلوا البوت): \`${result.noPrivate}\`\n` +
      `❌ خطأ آخر: \`${result.failed}\`\n`;

    if (result.error) {
      summary += `\n⚠️ *${result.error}*`;
    } else {
      summary += `\n🔗 رابط الدعوة:\n\`${result.inviteLink}\``;
    }

    if (result.noPrivate > 0) {
      const list = result.noPrivateList.slice(0, 5).join(', ');
      const more = result.noPrivateList.length > 5 ? ` و${result.noPrivateList.length - 5} آخرين` : '';
      summary += `\n\n👥 *لم يستلموا:* ${list}${more}`;
      summary += `\n\n💡 _هؤلاء يحتاجون يراسلون البوت أولاً حتى يستقبلوا الرسائل_`;
    }

    const kb = Markup.inlineKeyboard([
      [Markup.button.callback('🔁 إضافة جديدة', 'adder_start')],
      [Markup.button.callback('🔙 لوحة المطور', 'dev_back')],
    ]);

    try {
      if (progressMsg) {
        await bot.telegram.editMessageText(
          ctx.chat.id, progressMsg.message_id, null,
          summary,
          { parse_mode: 'Markdown', ...kb }
        );
      } else {
        await ctx.replyWithMarkdown(summary, kb);
      }
    } catch {}
  });

  // ── no-op ────────────────────────────────────────────────────
  bot.action('au_noop', async (ctx) => ctx.answerCbQuery());

};
