// ============================================================
//  handler_adder.js — ميزة الإضافة العشوائية للمطور
//  يتيح للمطور اختيار أعضاء من المحفوظات وإضافتهم لأي قروب/قناة
// ============================================================

const { Markup } = require('telegraf');
const db         = require('./db');
const { DEVELOPER_ID } = require('./config');
const { isDeveloper, isDeveloperOrBotAdmin } = require('./helpers');

// ─── حالة جلسة الإضافة لكل مستخدم ───────────────────────────
// { step, selectedUsers: Set, targetChatId, limit, page }
const adderSessions = new Map();

const PAGE_SIZE_USERS = 8;  // عدد الأعضاء في كل صفحة
const PAGE_SIZE_CHATS = 8;  // عدد القروبات/القنوات في كل صفحة

// ─── فلترة المستخدمين الصالحين للإضافة (لهم username) ────────
function getEligibleUsers() {
  return db.allUsers()
    .filter(u => u.username && u.username.trim() !== '' && !u.globalBanned && u.userId > 0)
    .sort((a, b) => {
      const ta = a.lastSeen ? new Date(a.lastSeen).getTime() : 0;
      const tb = b.lastSeen ? new Date(b.lastSeen).getTime() : 0;
      return tb - ta; // الأحدث أولاً
    });
}

// ─── بناء نص معلومات المستخدم ──────────────────────────────
function userLine(u) {
  const name = u.firstName || u.username || String(u.userId);
  const uname = u.username ? `@${u.username}` : '—';
  const link  = u.profileLink || (u.username ? `https://t.me/${u.username}` : `tg://user?id=${u.userId}`);
  return `[${name}](${link}) ${uname} \`${u.userId}\``;
}

// ─── لوحة اختيار الأعضاء العشوائيين ─────────────────────────
function buildUserSelectionKeyboard(users, selected, page, totalPages) {
  const btns = users.map(u => {
    const tick = selected.has(u.userId) ? '✅ ' : '';
    const name = (u.firstName || u.username || String(u.userId)).slice(0, 20);
    return [Markup.button.callback(`${tick}${name}`, `adder_toggle_${u.userId}_${page}`)];
  });

  const nav = [];
  if (page > 0) nav.push(Markup.button.callback('◀️', `adder_upage_${page - 1}`));
  nav.push(Markup.button.callback(`${page + 1}/${totalPages}`, 'adder_noop'));
  if (page + 1 < totalPages) nav.push(Markup.button.callback('▶️', `adder_upage_${page + 1}`));
  if (nav.length) btns.push(nav);

  btns.push([
    Markup.button.callback('🎲 عشوائي (10)', 'adder_random_10'),
    Markup.button.callback('🎲 عشوائي (25)', 'adder_random_25'),
  ]);
  btns.push([
    Markup.button.callback('🗑️ مسح الاختيار', 'adder_clear'),
    Markup.button.callback(`✅ تأكيد (${selected.size})`, 'adder_confirm_users'),
  ]);
  btns.push([Markup.button.callback('🔙 رجوع', 'dev_back')]);
  return Markup.inlineKeyboard(btns);
}

// ─── لوحة اختيار القروب/القناة الهدف ─────────────────────────
function buildChatSelectionKeyboard(chats, page, totalPages, type) {
  const btns = chats.map(c => {
    const icon = type === 'channel' ? '📢' : '👥';
    const name = (c.title || String(c.chatId)).slice(0, 24);
    return [Markup.button.callback(`${icon} ${name}`, `adder_target_${c.chatId}_${page}`)];
  });

  const nav = [];
  if (page > 0) nav.push(Markup.button.callback('◀️', `adder_cpage_${page - 1}_${type}`));
  nav.push(Markup.button.callback(`${page + 1}/${totalPages}`, 'adder_noop'));
  if (page + 1 < totalPages) nav.push(Markup.button.callback('▶️', `adder_cpage_${page + 1}_${type}`));
  if (nav.length) btns.push(nav);

  const otherType = type === 'channel' ? 'group' : 'channel';
  const otherLabel = type === 'channel' ? '👥 عرض القروبات' : '📢 عرض القنوات';
  btns.push([Markup.button.callback(otherLabel, `adder_show_${otherType}_0`)]);
  btns.push([Markup.button.callback('🔙 رجوع', 'adder_start')]);
  return Markup.inlineKeyboard(btns);
}

// ─── إجراء الإضافة الفعلية ────────────────────────────────────
async function performAdd(bot, ctx, targetChatId, userIds) {
  let success = 0, failed = 0, skipped = 0;
  const errors = [];

  for (const uid of userIds) {
    try {
      const u = db.getUser(uid);
      if (!u || !u.username) { skipped++; continue; }

      // محاولة الإضافة عبر username
      await bot.telegram.addChatMember(targetChatId, uid);
      success++;
      // تأخير بسيط لتجنب flood
      await new Promise(r => setTimeout(r, 600));
    } catch (e) {
      const msg = e.message || '';
      if (msg.includes('USER_ALREADY_PARTICIPANT') || msg.includes('already')) {
        skipped++;
      } else if (msg.includes('PEER_FLOOD') || msg.includes('flood')) {
        errors.push('⚠️ حد الإضافة اليومي وصل — انتظر قبل المتابعة');
        failed++;
        break;
      } else if (msg.includes('USER_PRIVACY_RESTRICTED')) {
        skipped++;
      } else {
        failed++;
      }
      await new Promise(r => setTimeout(r, 300));
    }
  }

  return { success, failed, skipped, errors };
}

// ════════════════════════════════════════════════════════════════
module.exports = function setupAdder(bot) {

  // ── زر فتح ميزة الإضافة العشوائية (من لوحة المطور) ───────────
  bot.action('adder_start', async (ctx) => {
    if (!isDeveloperOrBotAdmin(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();

    const uid = ctx.from.id;
    adderSessions.set(uid, { step: 'select_users', selectedUsers: new Set(), page: 0 });

    const users = getEligibleUsers();
    if (!users.length) {
      return ctx.editMessageText(
        '⚠️ *لا يوجد مستخدمون محفوظون بعد.*\n\nيجب أن يتفاعل أشخاص مع البوت أولاً.',
        { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', 'dev_back')]]) }
      );
    }

    const page = 0;
    const slice = users.slice(page * PAGE_SIZE_USERS, (page + 1) * PAGE_SIZE_USERS);
    const totalPages = Math.ceil(users.length / PAGE_SIZE_USERS);

    await ctx.editMessageText(
      `👥 *اختر الأعضاء العشوائيين*\n\n` +
      `📋 إجمالي المحفوظين: \`${users.length}\` شخص\n` +
      `✅ المختارون: \`0\`\n\n` +
      `اضغط على الاسم للاختيار، أو استخدم زر العشوائي لاختيار تلقائي:`,
      { parse_mode: 'Markdown', ...buildUserSelectionKeyboard(slice, new Set(), page, totalPages) }
    );
  });

  // ── تبديل اختيار مستخدم ────────────────────────────────────
  bot.action(/^adder_toggle_(\d+)_(\d+)$/, async (ctx) => {
    if (!isDeveloperOrBotAdmin(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    const uid      = ctx.from.id;
    const targetId = Number(ctx.match[1]);
    const page     = Number(ctx.match[2]);
    const session  = adderSessions.get(uid);
    if (!session) return ctx.answerCbQuery('⚠️ انتهت الجلسة — ابدأ من جديد');

    if (session.selectedUsers.has(targetId)) {
      session.selectedUsers.delete(targetId);
      await ctx.answerCbQuery('❌ تم إلغاء الاختيار');
    } else {
      session.selectedUsers.add(targetId);
      await ctx.answerCbQuery('✅ تم الاختيار');
    }

    const users = getEligibleUsers();
    const slice = users.slice(page * PAGE_SIZE_USERS, (page + 1) * PAGE_SIZE_USERS);
    const totalPages = Math.ceil(users.length / PAGE_SIZE_USERS);

    try {
      await ctx.editMessageText(
        `👥 *اختر الأعضاء العشوائيين*\n\n` +
        `📋 إجمالي المحفوظين: \`${users.length}\` شخص\n` +
        `✅ المختارون: \`${session.selectedUsers.size}\`\n\n` +
        `اضغط على الاسم للاختيار:`,
        { parse_mode: 'Markdown', ...buildUserSelectionKeyboard(slice, session.selectedUsers, page, totalPages) }
      );
    } catch {}
  });

  // ── تنقل صفحات المستخدمين ──────────────────────────────────
  bot.action(/^adder_upage_(\d+)$/, async (ctx) => {
    if (!isDeveloperOrBotAdmin(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const uid     = ctx.from.id;
    const page    = Number(ctx.match[1]);
    const session = adderSessions.get(uid);
    if (!session) return ctx.answerCbQuery('⚠️ انتهت الجلسة');

    session.page = page;
    const users = getEligibleUsers();
    const slice = users.slice(page * PAGE_SIZE_USERS, (page + 1) * PAGE_SIZE_USERS);
    const totalPages = Math.ceil(users.length / PAGE_SIZE_USERS);

    try {
      await ctx.editMessageText(
        `👥 *اختر الأعضاء العشوائيين*\n\n` +
        `📋 إجمالي المحفوظين: \`${users.length}\` شخص\n` +
        `✅ المختارون: \`${session.selectedUsers.size}\`\n\n` +
        `اضغط على الاسم للاختيار:`,
        { parse_mode: 'Markdown', ...buildUserSelectionKeyboard(slice, session.selectedUsers, page, totalPages) }
      );
    } catch {}
  });

  // ── اختيار عشوائي تلقائي ───────────────────────────────────
  bot.action(/^adder_random_(\d+)$/, async (ctx) => {
    if (!isDeveloperOrBotAdmin(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    const uid     = ctx.from.id;
    const count   = Number(ctx.match[1]);
    const session = adderSessions.get(uid);
    if (!session) return ctx.answerCbQuery('⚠️ انتهت الجلسة');

    const users = getEligibleUsers();
    // اختيار عشوائي من الكل
    const shuffled = [...users].sort(() => Math.random() - 0.5);
    const picked   = shuffled.slice(0, count);
    session.selectedUsers = new Set(picked.map(u => u.userId));

    await ctx.answerCbQuery(`🎲 تم اختيار ${session.selectedUsers.size} شخص عشوائياً`);

    const page = 0;
    const slice = users.slice(0, PAGE_SIZE_USERS);
    const totalPages = Math.ceil(users.length / PAGE_SIZE_USERS);

    try {
      await ctx.editMessageText(
        `👥 *اختر الأعضاء العشوائيين*\n\n` +
        `📋 إجمالي المحفوظين: \`${users.length}\` شخص\n` +
        `✅ المختارون: \`${session.selectedUsers.size}\`\n\n` +
        `تم اختيار ${count} شخص عشوائياً — يمكنك التعديل:`,
        { parse_mode: 'Markdown', ...buildUserSelectionKeyboard(slice, session.selectedUsers, page, totalPages) }
      );
    } catch {}
  });

  // ── مسح الاختيار ───────────────────────────────────────────
  bot.action('adder_clear', async (ctx) => {
    if (!isDeveloperOrBotAdmin(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    const uid     = ctx.from.id;
    const session = adderSessions.get(uid);
    if (!session) return ctx.answerCbQuery('⚠️ انتهت الجلسة');
    session.selectedUsers.clear();
    await ctx.answerCbQuery('🗑️ تم مسح الاختيار');

    const users = getEligibleUsers();
    const page  = session.page || 0;
    const slice = users.slice(page * PAGE_SIZE_USERS, (page + 1) * PAGE_SIZE_USERS);
    const totalPages = Math.ceil(users.length / PAGE_SIZE_USERS);
    try {
      await ctx.editMessageText(
        `👥 *اختر الأعضاء العشوائيين*\n\n📋 إجمالي: \`${users.length}\`\n✅ المختارون: \`0\``,
        { parse_mode: 'Markdown', ...buildUserSelectionKeyboard(slice, new Set(), page, totalPages) }
      );
    } catch {}
  });

  // ── تأكيد الاختيار والانتقال لاختيار القروب/القناة ─────────
  bot.action('adder_confirm_users', async (ctx) => {
    if (!isDeveloperOrBotAdmin(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const uid     = ctx.from.id;
    const session = adderSessions.get(uid);
    if (!session) return ctx.answerCbQuery('⚠️ انتهت الجلسة');

    if (session.selectedUsers.size === 0) {
      return ctx.answerCbQuery('⚠️ لم تختر أي شخص بعد!', { show_alert: true });
    }

    session.step = 'select_chat';

    // عرض قائمة القروبات أولاً
    const groups = db.allGroups();
    const page   = 0;
    const slice  = groups.slice(0, PAGE_SIZE_CHATS);
    const totalPages = Math.ceil(groups.length / PAGE_SIZE_CHATS);

    // بناء قائمة مختصرة بالمختارين
    const previewIds = [...session.selectedUsers].slice(0, 5);
    const preview    = previewIds.map(id => {
      const u = db.getUser(id);
      return u?.username ? `@${u.username}` : `\`${id}\``;
    }).join(', ');
    const more = session.selectedUsers.size > 5 ? ` و${session.selectedUsers.size - 5} آخرين...` : '';

    await ctx.editMessageText(
      `✅ *تم اختيار ${session.selectedUsers.size} شخص*\n\n` +
      `👥 المختارون: ${preview}${more}\n\n` +
      `📌 *الآن اختر القروب أو القناة التي تريد الإضافة إليها:*`,
      { parse_mode: 'Markdown', ...buildChatSelectionKeyboard(slice, page, totalPages || 1, 'group') }
    );
  });

  // ── عرض القنوات أو القروبات ────────────────────────────────
  bot.action(/^adder_show_(group|channel)_(\d+)$/, async (ctx) => {
    if (!isDeveloperOrBotAdmin(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const type    = ctx.match[1];
    const page    = Number(ctx.match[2]);
    const uid     = ctx.from.id;
    const session = adderSessions.get(uid);
    if (!session) return ctx.answerCbQuery('⚠️ انتهت الجلسة');

    const chats      = type === 'channel' ? db.allChannels() : db.allGroups();
    const slice      = chats.slice(page * PAGE_SIZE_CHATS, (page + 1) * PAGE_SIZE_CHATS);
    const totalPages = Math.ceil(chats.length / PAGE_SIZE_CHATS);

    try {
      await ctx.editMessageText(
        `📌 *اختر ${type === 'channel' ? 'القناة' : 'القروب'} الهدف:*\n\n` +
        `✅ المختارون: \`${session.selectedUsers.size}\` شخص`,
        { parse_mode: 'Markdown', ...buildChatSelectionKeyboard(slice, page, totalPages || 1, type) }
      );
    } catch {}
  });

  // ── تنقل صفحات القروبات/القنوات ─────────────────────────────
  bot.action(/^adder_cpage_(\d+)_(group|channel)$/, async (ctx) => {
    if (!isDeveloperOrBotAdmin(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery();
    const page    = Number(ctx.match[1]);
    const type    = ctx.match[2];
    const uid     = ctx.from.id;
    const session = adderSessions.get(uid);
    if (!session) return ctx.answerCbQuery('⚠️ انتهت الجلسة');

    const chats      = type === 'channel' ? db.allChannels() : db.allGroups();
    const slice      = chats.slice(page * PAGE_SIZE_CHATS, (page + 1) * PAGE_SIZE_CHATS);
    const totalPages = Math.ceil(chats.length / PAGE_SIZE_CHATS);

    try {
      await ctx.editMessageText(
        `📌 *اختر ${type === 'channel' ? 'القناة' : 'القروب'} الهدف:*\n✅ المختارون: \`${session.selectedUsers.size}\` شخص`,
        { parse_mode: 'Markdown', ...buildChatSelectionKeyboard(slice, page, totalPages || 1, type) }
      );
    } catch {}
  });

  // ── اختيار القروب/القناة الهدف والبدء بالإضافة ─────────────
  bot.action(/^adder_target_(-?\d+)_(\d+)$/, async (ctx) => {
    if (!isDeveloperOrBotAdmin(ctx)) return ctx.answerCbQuery('⛔ ممنوع', { show_alert: true });
    await ctx.answerCbQuery('⏳ جاري الإضافة...');

    const uid      = ctx.from.id;
    const targetId = Number(ctx.match[1]);
    const session  = adderSessions.get(uid);
    if (!session) return ctx.answerCbQuery('⚠️ انتهت الجلسة');

    if (session.selectedUsers.size === 0) {
      return ctx.answerCbQuery('⚠️ لا يوجد أشخاص مختارون!', { show_alert: true });
    }

    // الحصول على اسم الهدف
    const targetGroup   = db.getGroup(targetId);
    const targetChannel = db.getChannel(targetId);
    const targetName    = (targetGroup || targetChannel)?.title || String(targetId);

    // رسالة تقدم
    let progressMsg;
    try {
      progressMsg = await ctx.reply(
        `⏳ *جاري إضافة ${session.selectedUsers.size} شخص إلى ${targetName}...*\n\nيرجى الانتظار...`,
        { parse_mode: 'Markdown' }
      );
    } catch {}

    // تنفيذ الإضافة
    const userIds = [...session.selectedUsers];
    const result  = await performAdd(bot, ctx, targetId, userIds);

    // تنظيف الجلسة
    adderSessions.delete(uid);

    // رسالة النتيجة
    const errText = result.errors.length ? `\n\n⚠️ ${result.errors[0]}` : '';
    const summary =
      `✅ *نتيجة الإضافة إلى ${targetName}*\n\n` +
      `✅ نجح: \`${result.success}\`\n` +
      `❌ فشل: \`${result.failed}\`\n` +
      `⏭️ موجود مسبقاً أو خصوصية: \`${result.skipped}\`` +
      errText;

    try {
      if (progressMsg) {
        await bot.telegram.editMessageText(
          ctx.chat.id, progressMsg.message_id, null,
          summary,
          { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 لوحة المطور', 'dev_back')]]) }
        );
      } else {
        await ctx.replyWithMarkdown(summary, Markup.inlineKeyboard([[Markup.button.callback('🔙 لوحة المطور', 'dev_back')]]));
      }
    } catch {}
  });

  // ── no-op للأزرار الزخرفية (ترقيم الصفحات) ──────────────────
  bot.action('adder_noop', async (ctx) => ctx.answerCbQuery());

};
