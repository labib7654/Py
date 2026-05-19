const { Markup } = require('telegraf');
const db         = require('./db');
const {
  isDeveloper, isAdmin, isOwner, isBotAdmin,
  applyGroupPermissions, logAction,
  setJoinApproval, verifyAndRegisterOwner,
  lockTopic, unlockTopic, archiveTopic,
} = require('./helpers');

// ── Map لتتبع جلسات إضافة كلمات محظورة ───────────────────────
const pendingAddWord         = new Map();
const pendingAddSpecialist   = new Map(); // لإضافة كلمة مع متخصص

// ── لوحة الإعدادات الرئيسية ──────────────────────────────────
// ── تنسيق وقت التأخير للعرض ──────────────────────────────────────────
function formatDelay(seconds) {
  if (seconds < 60)   return `${seconds} ث`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} د`;
  return `${(seconds / 3600).toFixed(1).replace('.0', '')} س`;
}

function getPendingJoinRequests(g) {
  return [...(g.joinRequests?.values() || [])].filter(r =>
    ['pending', 'pending_verify', 'pending_direct'].includes(r.status)
  );
}

function groupSettingsKeyboard(chatId, s) {
  const com = s.communityId ? require('./db').getCommunity(s.communityId) : null;
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(`${s.joinRequestsEnabled ? '🔒' : '🔓'} موافقة الانضمام`, `toggle_joinreq_${chatId}`),
      Markup.button.callback('📨 الطلبات المعلقة', `joinreqs_${chatId}`),
    ],
    [
      Markup.button.callback(`${s.autoApproveJoin ? '🤖✅' : '🤖❌'} قبول تلقائي`, `toggle_autoapprove_${chatId}`),
      Markup.button.callback(`⏱ ${formatDelay(s.autoApproveDelay ?? 300)}`, `autoapprove_delay_${chatId}`),
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
    ...(com ? [[Markup.button.callback(`${com.enabled ? '✅' : '❌'} 🏫 حماية المجتمع`, `toggle_community_${chatId}`)]] : []),
    [Markup.button.callback('🎛️ صلاحيات الأعضاء', `perms_panel_${chatId}`)],
    [
      Markup.button.callback('✏️ رسالة الترحيب', `edit_welcome_${chatId}`),
      Markup.button.callback('📋 القواعد',        `edit_rules_${chatId}`),
    ],
    [
      Markup.button.callback('🔤 كلمات محظورة',   `bwords_list_${chatId}`),
      Markup.button.callback('⚙️ حد التحذيرات',  `set_maxwarns_${chatId}`),
    ],
    [
      Markup.button.callback('👨‍⚕️ كلمات المتخصصين', `specwords_list_${chatId}`),
    ],
    [
      Markup.button.callback('🧵 إدارة المواضيع', `topics_panel_${chatId}`),
      Markup.button.callback('📊 إحصائيات',       `stats_${chatId}`),
    ],
    [Markup.button.callback('📋 سجل الإجراءات', `auditlog_${chatId}`)],
    [Markup.button.callback('🔙 رجوع', `group_home_${chatId}`)],
  ]);
}

// ── لوحة صلاحيات الأعضاء ────────────────────────────────────
function permissionsDashboard(chatId, perms) {
  return Markup.inlineKeyboard([
    [Markup.button.callback(`${perms.canSendMessages   ? '✅' : '❌'} إرسال رسائل`,    `perm_msg_${chatId}`)],
    [Markup.button.callback(`${perms.canSendMedia      ? '✅' : '❌'} إرسال وسائط`,    `perm_media_${chatId}`)],
    [Markup.button.callback(`${perms.canSendPolls      ? '✅' : '❌'} إرسال استطلاعات`,`perm_polls_${chatId}`)],
    [Markup.button.callback(`${perms.canAddWebPreviews ? '✅' : '❌'} معاينة روابط`,   `perm_preview_${chatId}`)],
    [Markup.button.callback(`${perms.canInviteUsers    ? '✅' : '❌'} دعوة مستخدمين`, `perm_invite_${chatId}`)],
    [Markup.button.callback(`${perms.canPinMessages    ? '✅' : '❌'} تثبيت رسائل`,   `perm_pin_${chatId}`)],
    [Markup.button.callback(`${perms.canManageTopics   ? '✅' : '❌'} إدارة المواضيع`, `perm_topics_${chatId}`)],
    [Markup.button.callback('🔙 رجوع', `settings_${chatId}`)],
  ]);
}


// ── دالة مساعدة لبناء أزرار لوحة المواضيع ──────────────────
async function buildTopicsMarkupRaw(bot, g, chatId) {
  const { getVerifySettings } = require('./verify_helpers');
  const vs     = getVerifySettings(g);
  const topics = g.topics ? [...g.topics.entries()].filter(([, t]) => !t.archived) : [];

    const rows = topics.map(([tid, t]) => {
      const icon     = t.locked ? '🔒' : '🔓';
      const isVerify = tid === vs.verifyTopicId ? ' ✅' : '';
      return [
      Markup.button.callback(`${icon} ${(t.name || String(tid)).slice(0, 22)}${isVerify}`, `tp_toggle_${tid}_${chatId}`),
        Markup.button.callback('📌', `tp_setvfy_${tid}_${chatId}`),
      ];
    });

  rows.push([
    Markup.button.callback(vs.enabled ? '🔴 تعطيل التحقق' : '🟢 تفعيل التحقق', `vfy_toggle_${chatId}`),
  ]);
  rows.push([
    Markup.button.callback('🔒 إغلاق الكل', `tp_closeall_${chatId}`),
    Markup.button.callback('🔓 فتح الكل',   `tp_openall_${chatId}`),
  ]);
  rows.push([Markup.button.callback('🔙 رجوع', `owner_panel_${chatId}`)]);
  return rows;
}

async function buildTopicsMarkup(bot, g, chatId) {
  return Markup.inlineKeyboard(await buildTopicsMarkupRaw(bot, g, chatId)).reply_markup;
}

module.exports = function setupOwnerHandlers(bot) {

  // ════════════════════════════════════════════════════════════
  //  الأوامر
  // ════════════════════════════════════════════════════════════

  bot.command('settings', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.reply('❌ للمشرفين فقط!');
    const g = db.getGroup(chatId);
    if (!g) return ctx.reply('❌ بيانات المجموعة غير موجودة!');
    await ctx.replyWithMarkdown(
      `⚙️ *إعدادات ${g.title}*\n\nاضغط لتفعيل/تعطيل:`,
      groupSettingsKeyboard(chatId, g)
    );
  });

  bot.command('mybot', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    const g = db.getGroup(chatId);
    if (!g) return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.reply('❌ للمشرفين فقط!');
    try {
      await bot.telegram.sendMessage(
        ctx.from.id,
        `🔐 *لوحة تحكم ${g.title}*\n\nمرحباً ${ctx.from.first_name}، اضغط أدناه للتحكم:`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([[
            Markup.button.callback(`⚙️ إعدادات ${g.title.slice(0, 20)}`, `owner_panel_${chatId}`),
          ]]),
        }
      );
      await ctx.reply('✅ تم إرسال لوحة التحكم إلى خاصك.',
        { reply_to_message_id: ctx.message.message_id });
    } catch {
      await ctx.reply(
        '❌ تعذر إرسال الرسالة، ابدأ محادثة مع البوت أولاً.',
        Markup.inlineKeyboard([[
          Markup.button.url('🔓 افتح الخاص', `https://t.me/${ctx.botInfo.username}?start=panel_${chatId}`),
        ]])
      );
    }
  });

  bot.command('setwelcome', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, ctx.chat.id, ctx.from.id))
      return ctx.reply('❌ للمشرفين فقط!');
    const text = ctx.message.text.replace('/setwelcome', '').trim();
    if (!text)
      return ctx.replyWithMarkdown('📝 `/setwelcome نص`\nالمتغيرات: `{name}` `{group}` `{username}`');
    const g = db.getGroup(ctx.chat.id); if (!g) return;
    g.welcomeMessage = text;
    const preview = text
      .replace('{name}',     ctx.from.first_name || 'عضو')
      .replace('{group}',    ctx.chat.title       || 'المجموعة')
      .replace('{username}', ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name || '');
    await ctx.replyWithMarkdown(`✅ *تم تعديل رسالة الترحيب*\n\n*معاينة:*\n${preview}`);
  });

  bot.command('setrules', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, ctx.chat.id, ctx.from.id))
      return ctx.reply('❌ للمشرفين فقط!');
    const text = ctx.message.text.replace('/setrules', '').trim();
    if (!text) return ctx.reply('📋 مثال: /setrules 1. الاحترام\n2. عدم الإعلانات');
    const g = db.getGroup(ctx.chat.id); if (!g) return;
    g.rules = text;
    await ctx.replyWithMarkdown(`✅ *تم تعيين القواعد*\n\n${text}`);
  });

  bot.command('setmaxwarns', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    if (!isDeveloper(ctx) && !await isOwner(bot, ctx.chat.id, ctx.from.id))
      return ctx.reply('❌ للمالك فقط!');
    const n = Number(ctx.message.text.split(' ')[1]);
    if (!n || n < 1 || n > 10) return ctx.reply('❌ مثال: /setmaxwarns 3  (النطاق: 1-10)');
    const g = db.getGroup(ctx.chat.id); if (!g) return;
    g.maxWarns = n;
    await ctx.replyWithMarkdown(`✅ الحد الأقصى للتحذيرات: \`${n}\``);
  });

  bot.command('setlogchannel', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    if (!isDeveloper(ctx) && !await isOwner(bot, ctx.chat.id, ctx.from.id))
      return ctx.reply('❌ للمالك فقط!');
    const arg = ctx.message.text.split(' ')[1];
    const g   = db.getGroup(ctx.chat.id); if (!g) return;
    if (!arg) { g.logChannelId = null; return ctx.reply('✅ تم إلغاء قناة السجلات.'); }
    const channelId = Number(arg);
    if (!channelId) return ctx.reply('❌ مثال: /setlogchannel -100123456789');
    g.logChannelId = channelId;
    await ctx.replyWithMarkdown(`✅ *قناة السجلات:* \`${channelId}\``);
  });

  // ── /protect — أمر مباشر لتفعيل/تعطيل حماية المحتوى ─────────
  // يعمل داخل: المجموعة، القناة، الخاص (مع تحديد chatId)
  // يعمل مع: المطور، المالك، الأدمن
  bot.command('protect', async (ctx) => {
    // ── تحديد chatId المستهدف ────────────────────────────────
    let targetChatId = ctx.chat.id;
    let targetLabel  = ctx.chat.title || 'هذه المحادثة';

    // من الخاص: /protect -100XXXXXXXXX on|off
    if (ctx.chat.type === 'private') {
      if (!isDeveloper(ctx))
        return ctx.reply('❌ هذا الأمر من الخاص للمطور فقط!');
      const args = ctx.message.text.split(' ').slice(1);
      if (args.length < 1) {
        return ctx.replyWithMarkdown(
          '🛡️ *أمر حماية المحتوى*\n\n' +
          'الاستخدام:\n' +
          '`/protect -100CHATID on` — تفعيل\n' +
          '`/protect -100CHATID off` — تعطيل\n\n' +
          'مثال: `/protect -1001234567890 on`'
        );
      }
      targetChatId = Number(args[0]);
      if (isNaN(targetChatId)) return ctx.reply('❌ معرف المجموعة/القناة غير صحيح!');
    }

    // داخل مجموعة أو قناة: فحص الصلاحية
    if (ctx.chat.type !== 'private') {
      if (!isDeveloper(ctx) && !await isAdmin(bot, targetChatId, ctx.from.id))
        return ctx.reply('❌ للمشرفين فقط!');
    }

    // قراءة المعامل on/off
    const args      = ctx.message.text.split(' ').slice(1);
    const lastArg   = args[args.length - 1]?.toLowerCase();
    let   newState;

    if (lastArg === 'on'  || lastArg === 'تفعيل')  newState = true;
    else if (lastArg === 'off' || lastArg === 'تعطيل') newState = false;
    else {
      // بدون معامل: نقلب الحالة الحالية
      const g  = db.getGroup(targetChatId);
      const ch = db.getChannel?.(targetChatId);
      newState = !(g?.protectContent || ch?.protectContent || false);
    }

    // ── فحص صلاحيات البوت ───────────────────────────────────
    try {
      const botInfo   = await bot.telegram.getMe();
      const botMember = await bot.telegram.getChatMember(targetChatId, botInfo.id);

      if (botMember.status !== 'administrator') {
        return ctx.replyWithMarkdown(
          '❌ *البوت ليس مشرفاً*\n\n' +
          `أضفه كمشرف في \`${targetChatId}\` مع صلاحية "تغيير معلومات المجموعة" أولاً.`
        );
      }
      if (!botMember.can_change_info && !botMember.can_post_messages) {
        return ctx.replyWithMarkdown(
          '❌ *البوت لا يملك الصلاحية الكافية*\n\n' +
          'يحتاج صلاحية: `تغيير معلومات المجموعة` (can_change_info)\n\n' +
          'عدّل صلاحياته من إعدادات المجموعة → إدارة الأعضاء → البوت.'
        );
      }
    } catch (e) {
      return ctx.reply(`❌ تعذر فحص الصلاحيات: ${e.message}`);
    }

    // ── تطبيق الحماية محلياً ───────────────────────────────────────
    const g  = db.getGroup(targetChatId);
    const ch = db.getChannel?.(targetChatId);
    if (g) {
      g.protectContent = newState;
      if (g.communityId) {
        const com = db.getCommunity(g.communityId);
        if (com?.subGroups?.length) {
          let ok = 0;
          for (const sid of com.subGroups) {
            const sub = db.getGroup(sid);
            if (sub) {
              sub.protectContent = newState;
              ok++;
            }
          }
          if (ok > 0) targetLabel += ` + ${ok} مجموعات فرعية`;
        }
      }
    } else if (ch) {
      ch.protectContent = newState;
    }
    db.markDirty();
    db.saveData();

    const statusText = newState
      ? `🔒 *حماية المحتوى مفعّلة*\n\n✅ رسائل البوت ستُرسل محمية من النسخ/التوجيه\n✅ يتم تطبيقها على الرسائل الجديدة فقط`
      : `🔓 *حماية المحتوى معطّلة*\n\nيمكن الآن نسخ وتوجيه رسائل البوت الجديدة بحرية.`;

    await ctx.replyWithMarkdown(
      `${statusText}\n\n📌 المحادثة: *${targetLabel}*\n👤 بواسطة: ${ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name}`
    );
  });

  bot.command('addword', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, ctx.chat.id, ctx.from.id))
      return ctx.reply('❌ للمشرفين فقط!');
    const args      = ctx.message.text.split(' ').slice(1);
    const word      = args[0];
    const action    = (args[1] || 'warn').toLowerCase();
    const threshold = Number(args[2]) || 1;
    if (!word)
      return ctx.replyWithMarkdown('📌 `/addword <كلمة> <إجراء> <مرات>`\n\nالإجراءات: `warn` | `mute` | `kick` | `ban`\nمثال: `/addword بذيء warn 2`');
    if (!['warn', 'mute', 'kick', 'ban'].includes(action))
      return ctx.reply('❌ الإجراء غير صحيح! الخيارات: warn | mute | kick | ban');
    const g = db.getGroup(ctx.chat.id); if (!g) return;
    if (g.bannedWords.find(bw => bw.word.toLowerCase() === word.toLowerCase()))
      return ctx.reply('❌ الكلمة موجودة مسبقاً!');
    g.bannedWords.push({ word, action, threshold: Math.min(Math.max(threshold, 1), 5), addedBy: ctx.from.id, addedAt: new Date() });
    const arAct = { warn: '⚠️ تحذير', mute: '🔇 كتم', kick: '👢 طرد', ban: '🚫 حظر' };
    await ctx.replyWithMarkdown(`✅ *تمت إضافة الكلمة المحظورة*\n\n🔤 \`${word}\`\n⚡ الإجراء: ${arAct[action]}\n🔁 بعد: \`${threshold}\` مرة`);
  });

  bot.command('removeword', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, ctx.chat.id, ctx.from.id))
      return ctx.reply('❌ للمشرفين فقط!');
    const word = ctx.message.text.split(' ').slice(1).join(' ').trim();
    if (!word) return ctx.reply('📌 مثال: /removeword كلمة');
    const g = db.getGroup(ctx.chat.id); if (!g) return;
    const before = g.bannedWords.length;
    g.bannedWords = g.bannedWords.filter(bw => bw.word.toLowerCase() !== word.toLowerCase());
    if (g.bannedWords.length === before) return ctx.reply('❌ الكلمة غير موجودة!');
    await ctx.replyWithMarkdown(`✅ *تمت الإزالة:* \`${word}\``);
  });

  bot.command('words', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const g = db.getGroup(ctx.chat.id);
    if (!g || !g.bannedWords.length)
      return ctx.reply('🔤 لا توجد كلمات محظورة.\n\n`/addword` لإضافة كلمة.');
    const ar   = { warn: '⚠️', mute: '🔇', kick: '👢', ban: '🚫' };
    let text   = `🔤 *الكلمات المحظورة* (${g.bannedWords.length})\n\n`;
    g.bannedWords.forEach((bw, i) => {
      text += `${i + 1}. \`${bw.word}\` ${ar[bw.action] || ''} — بعد \`${bw.threshold || 1}\` مرة\n`;
    });
    await ctx.replyWithMarkdown(text);
  });

  // ════════════════════════════════════════════════════════════
  //  الكلمات مع المتخصص (specialistWords)
  // ════════════════════════════════════════════════════════════

  // /addspecword <كلمة> @متخصص
  bot.command('addspecword', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, ctx.chat.id, ctx.from.id))
      return ctx.reply('❌ للمشرفين فقط!');
    const args = ctx.message.text.split(' ').slice(1);
    const word = args[0];
    const specMention = args[1]; // @username أو reply
    const g = db.getGroup(ctx.chat.id); if (!g) return;
    if (!word) return ctx.replyWithMarkdown(
      '📌 الاستخدام:\n`/addspecword <كلمة> @متخصص`\n\nأو رد على رسالة المتخصص:\n`/addspecword <كلمة>`'
    );

    // تحديد المتخصص — إما عبر reply أو @username
    let specialist = null;
    if (ctx.message.reply_to_message) {
      const u = ctx.message.reply_to_message.from;
      specialist = { id: u.id, username: u.username || u.first_name };
    } else if (specMention) {
      const uname = specMention.replace('@', '');
      try {
        const m = await bot.telegram.getChatMember(ctx.chat.id, uname);
        specialist = { id: m.user.id, username: m.user.username || m.user.first_name };
      } catch { return ctx.reply('❌ لم أجد المتخصص في المجموعة!'); }
    } else {
      return ctx.replyWithMarkdown('❌ حدد المتخصص:\n- رد على رسالته، أو\n- `/addspecword <كلمة> @username`');
    }

    if (g.specialistWords.find(sw => sw.word.toLowerCase() === word.toLowerCase()))
      return ctx.reply('❌ الكلمة موجودة مسبقاً في قائمة المتخصصين!');

    g.specialistWords.push({
      word,
      specialistId:       specialist.id,
      specialistUsername: specialist.username,
      addedBy:            ctx.from.id,
      addedAt:            new Date(),
    });
    db.saveData();
    await ctx.replyWithMarkdown(
      `✅ *تمت الإضافة*\n\n🔤 الكلمة: \`${word}\`\n👨‍⚕️ المتخصص: @${specialist.username}\n\n` +
      `عند ذكر هذه الكلمة، يُحذف الكلام ويُوجَّه صاحبه للمتخصص تلقائياً.`
    );
  });

  // /removespecword <كلمة>
  bot.command('removespecword', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, ctx.chat.id, ctx.from.id))
      return ctx.reply('❌ للمشرفين فقط!');
    const word = ctx.message.text.split(' ').slice(1).join(' ').trim();
    if (!word) return ctx.reply('📌 مثال: /removespecword كلمة');
    const g = db.getGroup(ctx.chat.id); if (!g) return;
    const before = g.specialistWords.length;
    g.specialistWords = g.specialistWords.filter(sw => sw.word.toLowerCase() !== word.toLowerCase());
    if (g.specialistWords.length === before) return ctx.reply('❌ الكلمة غير موجودة في قائمة المتخصصين!');
    db.saveData();
    await ctx.replyWithMarkdown(`✅ *تمت الإزالة:* \`${word}\``);
  });

  // /specwords — عرض القائمة
  bot.command('specwords', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const g = db.getGroup(ctx.chat.id);
    if (!g || !g.specialistWords.length)
      return ctx.reply('🔤 لا توجد كلمات متخصصين.\n\n/addspecword لإضافة كلمة مع متخصص.');
    let text = `👨‍⚕️ *كلمات المتخصصين* (${g.specialistWords.length})\n\n`;
    g.specialistWords.forEach((sw, i) => {
      text += `${i + 1}. \`${sw.word}\` ← @${sw.specialistUsername}\n`;
    });
    await ctx.replyWithMarkdown(text);
  });

  bot.command('joinreqs', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.reply('❌ للمشرفين فقط!');
    const g = db.getGroup(chatId); if (!g) return ctx.reply('❌ بيانات غير موجودة!');
    const pending = [...g.joinRequests.values()].filter(r => ['pending', 'pending_verify', 'pending_direct'].includes(r.status));
    if (!pending.length) return ctx.reply('📨 لا توجد طلبات انضمام معلقة.');
    const btns = pending.slice(0, 8).map(r => [
      Markup.button.callback(`✅ ${r.firstName.slice(0, 14)}`, `jr_approve_${r.userId}_${chatId}`),
      Markup.button.callback('❌ رفض', `jr_reject_${r.userId}_${chatId}`),
    ]);
    btns.push([Markup.button.callback('✅ قبول الكل', `jr_approveall_${chatId}`), Markup.button.callback('❌ رفض الكل', `jr_rejectall_${chatId}`)]);
    await ctx.replyWithMarkdown(`📨 *طلبات الانضمام* (${pending.length} معلقة)`, Markup.inlineKeyboard(btns));
  });

  // ── أوامر المواضيع ────────────────────────────────────────
  bot.command('locktopic', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.reply('❌ للمشرفين فقط!');
    const g = db.getGroup(chatId); if (!g) return;
    const topicId = ctx.message.message_thread_id || Number(ctx.message.text.split(' ')[1]);
    if (!topicId) return ctx.reply('❌ استخدم في موضوع أو: /locktopic <topic_id>');
    try {
      await lockTopic(bot, chatId, topicId);
      const topic = db.getOrCreateTopic(g, topicId, String(topicId));
      topic.locked = true;
      await ctx.reply(`🔒 تم قفل الموضوع \`${topicId}\``, { parse_mode: 'Markdown' });
    } catch (e) { await ctx.reply(`❌ فشل: ${e.message}`); }
  });

  bot.command('unlocktopic', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.reply('❌ للمشرفين فقط!');
    const g = db.getGroup(chatId); if (!g) return;
    const topicId = ctx.message.message_thread_id || Number(ctx.message.text.split(' ')[1]);
    if (!topicId) return ctx.reply('❌ استخدم في موضوع أو: /unlocktopic <topic_id>');
    try {
      await unlockTopic(bot, chatId, topicId);
      if (g.topics.has(topicId)) g.topics.get(topicId).locked = false;
      await ctx.reply(`🔓 تم فتح الموضوع \`${topicId}\``, { parse_mode: 'Markdown' });
    } catch (e) { await ctx.reply(`❌ فشل: ${e.message}`); }
  });

  bot.command('archivetopic', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.reply('❌ للمشرفين فقط!');
    const g = db.getGroup(chatId); if (!g) return;
    const topicId = ctx.message.message_thread_id || Number(ctx.message.text.split(' ')[1]);
    if (!topicId) return ctx.reply('❌ استخدم في موضوع أو: /archivetopic <topic_id>');
    try {
      await archiveTopic(bot, chatId, topicId);
      const t = db.getOrCreateTopic(g, topicId, String(topicId));
      t.locked = true; t.archived = true;
      await ctx.reply(`📁 تم أرشفة الموضوع \`${topicId}\``, { parse_mode: 'Markdown' });
    } catch (e) { await ctx.reply(`❌ فشل: ${e.message}`); }
  });

  bot.command('topicrequest', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const chatId = ctx.chat.id;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.reply('❌ للمشرفين فقط!');
    const g = db.getGroup(chatId); if (!g) return;
    const arg = ctx.message.text.split(' ')[1]?.toLowerCase();
    if (!['on', 'off'].includes(arg)) return ctx.reply('❌ مثال: /topicrequest on أو /topicrequest off');
    g.topicSettings = g.topicSettings || { requireApprovalToJoin: false, autoLockOnCreate: false, ownerBypassAll: true };
    g.topicSettings.requireApprovalToJoin = arg === 'on';
    await ctx.replyWithMarkdown(
      arg === 'on'
        ? '✅ *طلبات دخول المواضيع مفعّلة* — أي رسالة في موضوع مقفل ستُرسل للمالك طلب موافقة.'
        : '❌ *طلبات دخول المواضيع معطّلة*'
    );
  });

  // ── /community_bans ────────────────────────────────────────
  bot.command('community_bans', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const g = db.getGroup(ctx.chat.id); if (!g) return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, ctx.chat.id, ctx.from.id))
      return ctx.reply('❌ للمشرفين فقط!');
    if (!g.communityId) return ctx.reply('❌ المجموعة ليست في مجتمع.');
    const com = db.getCommunity(g.communityId);
    if (!com || !com.autoBannedUsers?.size)
      return ctx.replyWithMarkdown('🔍 *لا يوجد محظورون تلقائياً في المجتمع.*');
    let text = `🚫 *المحظورون تلقائياً — ${com.title}*\n\n`;
    [...com.autoBannedUsers.entries()].slice(0, 15).forEach(([uid, data]) => {
      const u = db.getUser(uid);
      text += `👤 ${u?.username ? `@${u.username}` : uid} \`[${uid}]\`\n`;
      text += `   السبب: ${data.reason}\n`;
      text += `   المجموعات: ${(data.groups || []).map(id => { const gr = db.getGroup(id); return gr?.title || id; }).join('، ')}\n\n`;
    });
    await ctx.replyWithMarkdown(text);
  });

  bot.command('top', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const g = db.getGroup(ctx.chat.id); if (!g) return;
    const sorted = [...g.members.values()].filter(m => (m.score || 0) > 0).sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 10);
    if (!sorted.length) return ctx.reply('📊 لا توجد بيانات نشاط بعد.');
    const medals = ['🥇', '🥈', '🥉'];
    let text = `🏆 *أنشط أعضاء ${ctx.chat.title}*\n\n`;
    sorted.forEach((m, i) => { text += `${medals[i] || `${i + 1}.`} ${m.username ? `@${m.username}` : m.firstName} — \`${m.score || 0}\` نقطة\n`; });
    await ctx.replyWithMarkdown(text);
  });

  bot.command('myscore', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const g     = db.getGroup(ctx.chat.id);
    const m     = g?.members.get(ctx.from.id);
    const score = m?.score || 0;
    const rank  = m ? [...g.members.values()].sort((a, b) => (b.score || 0) - (a.score || 0)).findIndex(x => x.userId === ctx.from.id) + 1 : 0;
    const name  = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;
    await ctx.replyWithMarkdown(`⭐ *نقاط ${name}*\n\n🔢 النقاط: \`${score}\`\n🏅 الترتيب: \`${rank || '—'}\``);
  });

  bot.command('broadcast', async (ctx) => {
    if (ctx.chat.type !== 'private') return ctx.reply('🔒 هذا الأمر في الخاص فقط!');
    if (!isDeveloper(ctx)) {
      const userGroups = db.getUserGroups(ctx.from.id);
      if (!userGroups.length) return ctx.reply('❌ لا توجد مجموعات تملكها أو تشرف عليها.');
      const text = ctx.message.text.replace('/broadcast', '').trim();
      if (!text) return ctx.reply('📢 اكتب: /broadcast النص');
      let success = 0, fail = 0;
      for (const chatId of userGroups) {
        try { await bot.telegram.sendMessage(chatId, `📢 *إعلان*\n\n${text}`, { parse_mode: 'Markdown' }); success++; } catch { fail++; }
      }
      return ctx.reply(`✅ أُرسل إلى ${success} مجموعة\n❌ فشل في ${fail}`);
    }
    const text = ctx.message.text.replace('/broadcast', '').trim();
    if (!text) return ctx.reply('❌ مثال: /broadcast نص الرسالة');
    const groups = db.allGroups();
    await ctx.reply(`📢 جاري الإرسال لـ ${groups.length} مجموعة...`);
    let sent = 0, failed = 0;
    for (const g of groups) {
      try { await bot.telegram.sendMessage(g.chatId, `📢 *رسالة إدارة البوت*\n\n${text}`, { parse_mode: 'Markdown' }); sent++; } catch { failed++; }
    }
    await ctx.replyWithMarkdown(`✅ *اكتمل البث*\n• أُرسل: \`${sent}\`\n• فشل: \`${failed}\``);
  });

  // ════════════════════════════════════════════════════════════
  //  Callbacks
  // ════════════════════════════════════════════════════════════

  bot.action(/^owner_panel_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId);
    if (!g) return ctx.answerCbQuery('❌ المجموعة غير موجودة!', { show_alert: true });
    const isMine = isDeveloper(ctx) || g.ownerId === ctx.from.id || g.admins.has(ctx.from.id);
    if (!isMine) return ctx.answerCbQuery('❌ ليس لديك صلاحية!', { show_alert: true });
    await ctx.editMessageText(
      `⚙️ *إعدادات ${g.title}*\n\nاضغط لتفعيل/تعطيل:`,
      { parse_mode: 'Markdown', ...groupSettingsKeyboard(chatId, g) }
    );
  });

  bot.action(/^settings_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId);
    if (!g) return ctx.answerCbQuery('❌ بيانات غير موجودة!', { show_alert: true });
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    await ctx.editMessageText(
      `⚙️ *إعدادات ${g.title}*\n\nاضغط لتفعيل/تعطيل:`,
      { parse_mode: 'Markdown', ...groupSettingsKeyboard(chatId, g) }
    );
  });

  // ── Toggles البسيطة ───────────────────────────────────────
  const toggles = [
    ['toggle_welcome',   'welcomeEnabled', 'رسالة الترحيب'],
    ['toggle_antispam',  'antiSpam',       'مكافحة السبام'],
    ['toggle_mutenew',   'muteNewMembers', 'كتم الأعضاء الجدد'],
    ['toggle_antilinks', 'antiLinks',      'منع الروابط'],
    ['toggle_antibot',   'antiBot',        'منع البوتات'],
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

  // ── تبديل حماية المجتمع ──────────────────────────────────
  bot.action(/^toggle_community_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId); if (!g) return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    if (!g.communityId) return ctx.answerCbQuery('❌ المجموعة ليست في مجتمع!', { show_alert: true });
    const com = db.getCommunity(g.communityId);
    if (!com) return ctx.answerCbQuery('❌ المجتمع غير موجود!', { show_alert: true });
    com.enabled = !com.enabled;
    await ctx.answerCbQuery(com.enabled ? '✅ حماية المجتمع مفعّلة!' : '❌ حماية المجتمع معطّلة!', { show_alert: true });
    await ctx.editMessageReplyMarkup(groupSettingsKeyboard(chatId, g).reply_markup);
  });

  // ── تبديل Join Requests ───────────────────────────────────
  bot.action(/^toggle_joinreq_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId); if (!g) return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });

    const newState = !g.joinRequestsEnabled;
    const inviteLink = await setJoinApproval(bot, chatId, newState, g);
    g.joinRequestsEnabled = newState;
    db.saveData();

    await ctx.answerCbQuery(
      newState
        ? '🔒 موافقة الانضمام مفعّلة — الطلبات ستصلك في الخاص'
        : '🔓 موافقة الانضمام معطّلة — الدخول مباشر',
      { show_alert: true }
    );
    if (newState && inviteLink) {
      try {
        await ctx.replyWithMarkdown(`🔗 *رابط طلب الانضمام الجاهز:*\n\n${inviteLink}`);
      } catch {}
    }
    await ctx.editMessageReplyMarkup(groupSettingsKeyboard(chatId, g).reply_markup);
  });

  // ── تفعيل/تعطيل القبول التلقائي ────────────────────────────────────
  bot.action(/^toggle_autoapprove_(-?\d+)$/, async (ctx) => {
    if (!isDeveloper(ctx) && !isBotAdmin(ctx) && !await isAdmin(bot, Number(ctx.match[1]), ctx.from.id))
      return ctx.answerCbQuery('⛔ للمشرفين فقط', { show_alert: true });
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId);
    if (!g) return;
    g.autoApproveJoin = !g.autoApproveJoin;
    db.saveData();
    await ctx.answerCbQuery(
      g.autoApproveJoin
        ? `🤖✅ القبول التلقائي مفعّل — بعد ${formatDelay(g.autoApproveDelay ?? 300)}`
        : '🤖❌ القبول التلقائي معطّل',
      { show_alert: true }
    );
    await ctx.editMessageReplyMarkup(groupSettingsKeyboard(chatId, g).reply_markup);
  });

  // ── اختيار وقت التأخير للقبول التلقائي ──────────────────────────────
  bot.action(/^autoapprove_delay_(-?\d+)$/, async (ctx) => {
    if (!isDeveloper(ctx) && !isBotAdmin(ctx) && !await isAdmin(bot, Number(ctx.match[1]), ctx.from.id))
      return ctx.answerCbQuery('⛔ للمشرفين فقط', { show_alert: true });
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId);
    if (!g) return;

    const current = g.autoApproveDelay ?? 300;

    // خيارات الوقت: [label, ثواني]
    const options = [
      ['⚡ فوري (0 ث)',   0],
      ['30 ثانية',        30],
      ['1 دقيقة',         60],
      ['5 دقائق',         300],
      ['15 دقيقة',        900],
      ['30 دقيقة',        1800],
      ['1 ساعة',          3600],
      ['2 ساعة',          7200],
      ['3 ساعات',         10800],
      ['6 ساعات',         21600],
      ['12 ساعة',         43200],
      ['24 ساعة',         86400],
    ];

    const rows = [];
    for (let i = 0; i < options.length; i += 3) {
      rows.push(
        options.slice(i, i + 3).map(([label, secs]) =>
          Markup.button.callback(
            `${secs === current ? '✅ ' : ''}${label}`,
            `set_approve_delay_${secs}_${chatId}`
          )
        )
      );
    }
    rows.push([Markup.button.callback('🔙 رجوع', `back_to_settings_${chatId}`)]);

    await ctx.editMessageText(
      `⏱ *تحديد وقت القبول التلقائي*\n\n` +
      `المجموعة: *${g.title}*\n` +
      `الوقت الحالي: *${formatDelay(current)}*\n\n` +
      `اختر المدة التي ينتظرها البوت قبل قبول طلب الانضمام:`,
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard(rows) }
    );
  });

  // ── حفظ الوقت المختار ────────────────────────────────────────────────
  bot.action(/^set_approve_delay_(\d+)_(-?\d+)$/, async (ctx) => {
    if (!isDeveloper(ctx) && !isBotAdmin(ctx) && !await isAdmin(bot, Number(ctx.match[2]), ctx.from.id))
      return ctx.answerCbQuery('⛔ للمشرفين فقط', { show_alert: true });
    await ctx.answerCbQuery();
    const delay  = Number(ctx.match[1]);
    const chatId = Number(ctx.match[2]);
    const g = db.getGroup(chatId);
    if (!g) return;

    g.autoApproveDelay = delay;
    db.saveData();

    const label = delay === 0 ? 'فوري' : formatDelay(delay);
    await ctx.answerCbQuery(`✅ تم تعيين الوقت: ${label}`, { show_alert: true });

    // رجوع لصفحة الإعدادات
    await ctx.editMessageText(
      `✅ *تم الحفظ*\n\nوقت القبول التلقائي: *${label}*`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع للإعدادات', `back_to_settings_${chatId}`)]])
      }
    );
  });

  // ── زر رجوع لإعدادات المجموعة ────────────────────────────────────────
  bot.action(/^back_to_settings_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId);
    if (!g) return;
    const settingsText =
      `⚙️ *إعدادات المجموعة*\n\n` +
      `📌 *${g.title}*\n` +
      `🆔 \`${chatId}\``;
    try {
      await ctx.editMessageText(settingsText, { parse_mode: 'Markdown', ...groupSettingsKeyboard(chatId, g) });
    } catch { await ctx.editMessageReplyMarkup(groupSettingsKeyboard(chatId, g).reply_markup); }
  });

  // ── تبديل حماية المحتوى ──────────────────────────────────
  // الحماية هنا محلية على رسائل البوت الجديدة، لأن Bot API لا يوفّر
  // إعداداً دائماً على مستوى الشات لحماية كل الرسائل.
  bot.action(/^toggle_protect_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);

    // ── 1. تحديد المصدر: مجموعة أو قناة ────────────────────
    const g  = db.getGroup(chatId);
    const ch = !g ? db.getChannel(chatId) : null;
    if (!g && !ch)
      return ctx.answerCbQuery('❌ بيانات غير موجودة!', { show_alert: true });

    // ── 2. فحص الصلاحية ─────────────────────────────────────
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });

    // ── 3. قراءة الحالة الحالية من الـ DB ───────────────────
    const currentState = g ? !!g.protectContent : !!ch.protectContent;
    const newState     = !currentState;

    // ── 4. فحص صلاحية البوت قبل المحاولة ───────────────────
    try {
      const botInfo  = await bot.telegram.getMe();
      const botMember = await bot.telegram.getChatMember(chatId, botInfo.id);

      if (botMember.status !== 'administrator') {
        return ctx.answerCbQuery(
          '❌ البوت ليس مشرفاً في هذه المجموعة/القناة!\n\nأضفه كمشرف أولاً.',
          { show_alert: true }
        );
      }

      if (!botMember.can_change_info && !botMember.can_post_messages) {
        return ctx.answerCbQuery(
          '❌ البوت لا يملك صلاحية النشر/تغيير المعلومات اللازمة للتحكم برسائل الحماية.',
          { show_alert: true }
        );
      }
    } catch (e) {
      return ctx.answerCbQuery(`❌ تعذر فحص صلاحيات البوت: ${e.message}`, { show_alert: true });
    }

    // ── 5. تطبيق الحالة محلياً ─────────────────────────────
    if (g) {
      g.protectContent = newState;
      if (g.communityId) {
        const com = db.getCommunity(g.communityId);
        if (com?.enabled && com.subGroups?.length) {
          for (const subId of com.subGroups) {
            const sub = db.getGroup(subId);
            if (sub) sub.protectContent = newState;
          }
        }
      }
    } else if (ch) {
      ch.protectContent = newState;
    }

    db.markDirty();
    db.saveData();

    const successMsg = newState
      ? '🔒 *حماية المحتوى مفعّلة*\n\nسيتم إرسال رسائل البوت الجديدة بوضع محمي.'
      : '🔓 *حماية المحتوى معطّلة*\n\nسيتم إرسال رسائل البوت الجديدة بدون حماية.';

    await ctx.answerCbQuery(
      newState ? '🔒 تم تفعيل حماية المحتوى!' : '🔓 تم تعطيل حماية المحتوى!',
      { show_alert: true }
    );

    if (g) {
      try {
        await ctx.editMessageReplyMarkup(groupSettingsKeyboard(chatId, g).reply_markup);
      } catch {}
    }

    if (g?.logChannelId) {
      try {
        await bot.telegram.sendMessage(
          g.logChannelId,
          `🛡️ *حماية المحتوى*\n\n${successMsg}\n\n👤 بواسطة: ${ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name}\n📌 المجموعة: *${g.title}*`,
          { parse_mode: 'Markdown' }
        );
      } catch {}
    }
  });

  // ── لوحة الصلاحيات ───────────────────────────────────────
  bot.action(/^perms_panel_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId); if (!g) return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    await ctx.editMessageText(
      `🎛️ *صلاحيات أعضاء ${g.title}*\n\nاضغط لتفعيل/تعطيل:`,
      { parse_mode: 'Markdown', ...permissionsDashboard(chatId, g.perms) }
    );
  });

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
    const g = db.getGroup(chatId); if (!g) return;
    const def = permMap[permKey]; if (!def) return;
    g.perms[def.key] = !g.perms[def.key];
    try { await applyGroupPermissions(bot, chatId, g.perms); } catch {}
    await ctx.answerCbQuery(`${g.perms[def.key] ? '✅' : '❌'} ${def.label}`);
    await ctx.editMessageReplyMarkup(permissionsDashboard(chatId, g.perms).reply_markup);
  });

  // ── سجل الإجراءات ─────────────────────────────────────────
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
      text += `${e.action} | @${e.by.username} → @${e.target.username}\n🕐 ${new Date(e.at).toLocaleString('ar')}${e.details ? `\n📝 ${e.details}` : ''}\n\n`;
    });
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', `settings_${chatId}`)]]) });
  });

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

  // ════════════════════════════════════════════════════════════
  //  الكلمات المحظورة — بالزر
  // ════════════════════════════════════════════════════════════

  bot.action(/^bwords_list_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId); if (!g) return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const ar = { warn: '⚠️', mute: '🔇', kick: '👢', ban: '🚫' };
    if (!g.bannedWords.length) {
      return ctx.editMessageText('🔤 *لا توجد كلمات محظورة.*', {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('➕ إضافة كلمة', `add_word_start_${chatId}`)],
          [Markup.button.callback('🔙 رجوع',        `settings_${chatId}`)],
        ]),
      });
    }
    let text   = `🔤 *الكلمات المحظورة* (${g.bannedWords.length})\n\n`;
    const btns = g.bannedWords.map((bw, i) => {
      text += `${i + 1}. \`${bw.word}\` ${ar[bw.action] || ''} — بعد ${bw.threshold || 1} مرة\n`;
      return [Markup.button.callback(`🗑️ حذف: ${bw.word.slice(0, 16)}`, `del_word_${i}_${chatId}`)];
    });
    btns.push([Markup.button.callback('➕ إضافة كلمة', `add_word_start_${chatId}`)]);
    btns.push([Markup.button.callback('🔙 رجوع', `settings_${chatId}`)]);
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) });
  });

  bot.action(/^del_word_(\d+)_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const idx    = Number(ctx.match[1]);
    const chatId = Number(ctx.match[2]);
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const g = db.getGroup(chatId);
    if (!g || !g.bannedWords[idx]) return ctx.answerCbQuery('❌ غير موجودة!', { show_alert: true });
    const removed = g.bannedWords.splice(idx, 1)[0];
    await ctx.answerCbQuery(`✅ حُذفت: ${removed.word}`, { show_alert: true });
    const ar = { warn: '⚠️', mute: '🔇', kick: '👢', ban: '🚫' };
    if (!g.bannedWords.length) {
      return ctx.editMessageText('🔤 *لا توجد كلمات محظورة.*', {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('➕ إضافة كلمة', `add_word_start_${chatId}`)],
          [Markup.button.callback('🔙 رجوع',        `settings_${chatId}`)],
        ]),
      });
    }
    let text   = `🔤 *الكلمات المحظورة* (${g.bannedWords.length})\n\n`;
    const btns = g.bannedWords.map((bw, i) => {
      text += `${i + 1}. \`${bw.word}\` ${ar[bw.action] || ''} — بعد ${bw.threshold || 1} مرة\n`;
      return [Markup.button.callback(`🗑️ حذف: ${bw.word.slice(0, 16)}`, `del_word_${i}_${chatId}`)];
    });
    btns.push([Markup.button.callback('➕ إضافة كلمة', `add_word_start_${chatId}`)]);
    btns.push([Markup.button.callback('🔙 رجوع', `settings_${chatId}`)]);
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) });
  });

  bot.action(/^add_word_start_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    pendingAddWord.set(ctx.from.id, { chatId, step: 'word' });
    await ctx.editMessageText('🔤 *إضافة كلمة محظورة*\n\nأرسل الكلمة المراد حظرها (في محادثة الخاص):', {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('❌ إلغاء', `bwords_list_${chatId}`)]]),
    });
  });

  bot.on('message', async (ctx, next) => {
    if (!ctx.from) return next();
    const state = pendingAddWord.get(ctx.from.id);
    if (!state) return next();
    if (ctx.chat.type !== 'private') return next();
    const text = ctx.message.text?.trim();
    if (!text) return next();
    if (state.step === 'word') {
      state.word = text;
      state.step = 'action';
      pendingAddWord.set(ctx.from.id, state);
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
  });

  bot.action(/^aw_action_(\d+)_(warn|mute|kick|ban)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const userId = Number(ctx.match[1]);
    const action = ctx.match[2];
    if (ctx.from.id !== userId) return ctx.answerCbQuery('❌', { show_alert: true });
    const state = pendingAddWord.get(userId);
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

  // ════════════════════════════════════════════════════════════
  //  كلمات المتخصصين — inline handlers
  // ════════════════════════════════════════════════════════════

  // عرض قائمة كلمات المتخصصين
  bot.action(/^specwords_list_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId); if (!g) return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });

    if (!g.specialistWords.length) {
      return ctx.editMessageText('👨‍⚕️ *لا توجد كلمات متخصصين.*\n\nأضف كلمة واختر لها متخصصاً من الأعضاء:', {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('➕ إضافة كلمة + متخصص', `add_spec_start_${chatId}`)],
          [Markup.button.callback('🔙 رجوع', `settings_${chatId}`)],
        ]),
      });
      return;
    }

    let text = `👨‍⚕️ *كلمات المتخصصين* (${g.specialistWords.length})\n\n`;
    const btns = g.specialistWords.map((sw, i) => {
      text += `${i + 1}. \`${sw.word}\` ← @${sw.specialistUsername}\n`;
      return [Markup.button.callback(`🗑️ حذف: ${sw.word.slice(0, 14)}`, `del_spec_${i}_${chatId}`)];
    });
    btns.push([Markup.button.callback('➕ إضافة كلمة + متخصص', `add_spec_start_${chatId}`)]);
    btns.push([Markup.button.callback('🔙 رجوع', `settings_${chatId}`)]);
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) });
  });

  // حذف كلمة متخصص
  bot.action(/^del_spec_(\d+)_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const idx    = Number(ctx.match[1]);
    const chatId = Number(ctx.match[2]);
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    const g = db.getGroup(chatId);
    if (!g || !g.specialistWords[idx]) return ctx.answerCbQuery('❌ غير موجودة!', { show_alert: true });
    const removed = g.specialistWords.splice(idx, 1)[0];
    db.saveData();
    await ctx.answerCbQuery(`✅ حُذفت: ${removed.word}`, { show_alert: true });

    if (!g.specialistWords.length) {
      return ctx.editMessageText('👨‍⚕️ *لا توجد كلمات متخصصين.*', {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('➕ إضافة كلمة + متخصص', `add_spec_start_${chatId}`)],
          [Markup.button.callback('🔙 رجوع', `settings_${chatId}`)],
        ]),
      });
      return;
    }

    let text = `👨‍⚕️ *كلمات المتخصصين* (${g.specialistWords.length})\n\n`;
    const btns = g.specialistWords.map((sw, i) => {
      text += `${i + 1}. \`${sw.word}\` ← @${sw.specialistUsername}\n`;
      return [Markup.button.callback(`🗑️ حذف: ${sw.word.slice(0, 14)}`, `del_spec_${i}_${chatId}`)];
    });
    btns.push([Markup.button.callback('➕ إضافة كلمة + متخصص', `add_spec_start_${chatId}`)]);
    btns.push([Markup.button.callback('🔙 رجوع', `settings_${chatId}`)]);
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) });
  });

  // ─── دالة مساعدة: بناء أزرار اختيار المتخصص ─────────────────
  async function sendSpecialistPicker(ctx, state, isEdit = false) {
    const chatId = state.chatId;

    // جلب المشرفين والمالكين من تيليغرام
    let adminButtons = [];
    try {
      const admins = await bot.telegram.getChatAdministrators(chatId);
      const filtered = admins.filter(a => !a.user.is_bot);
      adminButtons = filtered.map(a => {
        const label = (a.status === 'creator' ? '👑 ' : '🛡 ') +
          (a.user.first_name || a.user.username || String(a.user.id)).slice(0, 20);
        return [Markup.button.callback(label, `spec_pick_${a.user.id}_${chatId}`)];
      });
    } catch {}

    // جلب الأعضاء من db (المحفوظون في المجموعة)
    const g = db.getGroup(chatId);
    const memberIds = g?.members ? [...g.members.keys()] : [];
    const adminIds  = new Set(
      (await bot.telegram.getChatAdministrators(chatId).catch(() => []))
        .map(a => a.user.id)
    );
    const memberButtons = memberIds
      .filter(uid => !adminIds.has(uid))
      .slice(0, 30)
      .map(uid => {
        const u = db.getUser(uid);
        const label = '👤 ' + (u?.firstName || u?.username || String(uid)).slice(0, 20);
        return [Markup.button.callback(label, `spec_pick_${uid}_${chatId}`)];
      });

    // لوحة المفاتيح: زر لعرض المشرفين وزر للأعضاء
    const keyboard = [
      [Markup.button.callback(`👑 المشرفون والمالكون (${adminButtons.length})`, `spec_show_admins_${chatId}`)],
      [Markup.button.callback(`👥 الأعضاء (${memberButtons.length})`, `spec_show_members_${chatId}`)],
      [Markup.button.callback('❌ إلغاء', `specwords_list_${chatId}`)],
    ];

    // حفظ القوائم في الجلسة لاستخدامها لاحقاً
    state._adminButtons  = adminButtons;
    state._memberButtons = memberButtons;
    pendingAddSpecialist.set(ctx.from.id, state);

    const text =
      `👨‍⚕️ *إضافة كلمة مع متخصص*\n\n` +
      `✅ الكلمة: \`${state.word}\`\n\n` +
      `*الخطوة 2/2:* اختر المتخصص من أي قائمة:`;

    if (isEdit) {
      try {
        await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(keyboard) });
      } catch {
        await ctx.reply(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(keyboard) });
      }
    } else {
      await ctx.reply(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(keyboard) });
    }
  }

  // بدء إضافة كلمة متخصص عبر الأزرار
  bot.action(/^add_spec_start_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    pendingAddSpecialist.set(ctx.from.id, { chatId, step: 'word' });
    await ctx.editMessageText(
      '👨‍⚕️ *إضافة كلمة مع متخصص*\n\n*الخطوة 1/2:* أرسل الكلمة المراد إضافتها (في الخاص):',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('❌ إلغاء', `specwords_list_${chatId}`)]]),
      }
    );
  });

  // عرض قائمة المشرفين والمالكين
  bot.action(/^spec_show_admins_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const uid   = ctx.from.id;
    const state = pendingAddSpecialist.get(uid);
    if (!state || state.step !== 'specialist')
      return ctx.answerCbQuery('⚠️ انتهت الجلسة، ابدأ من جديد.', { show_alert: true });

    const btns = (state._adminButtons || []);
    if (!btns.length)
      return ctx.answerCbQuery('⚠️ لا يوجد مشرفون في المجموعة.', { show_alert: true });

    const keyboard = [
      ...btns,
      [Markup.button.callback('🔙 رجوع', `spec_back_picker_${state.chatId}`)],
    ];
    await ctx.editMessageText(
      `👑 *المشرفون والمالكون*\n\n✅ الكلمة: \`${state.word}\`\n\nاختر المتخصص:`,
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard(keyboard) }
    );
  });

  // عرض قائمة الأعضاء
  bot.action(/^spec_show_members_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const uid   = ctx.from.id;
    const state = pendingAddSpecialist.get(uid);
    if (!state || state.step !== 'specialist')
      return ctx.answerCbQuery('⚠️ انتهت الجلسة، ابدأ من جديد.', { show_alert: true });

    const btns = (state._memberButtons || []);
    if (!btns.length)
      return ctx.answerCbQuery('⚠️ لا يوجد أعضاء محفوظون بعد في قاعدة البيانات.', { show_alert: true });

    const keyboard = [
      ...btns,
      [Markup.button.callback('🔙 رجوع', `spec_back_picker_${state.chatId}`)],
    ];
    await ctx.editMessageText(
      `👥 *أعضاء المجموعة*\n\n✅ الكلمة: \`${state.word}\`\n\nاختر المتخصص:`,
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard(keyboard) }
    );
  });

  // رجوع للقائمة الرئيسية للاختيار
  bot.action(/^spec_back_picker_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const uid   = ctx.from.id;
    const state = pendingAddSpecialist.get(uid);
    if (!state || state.step !== 'specialist')
      return ctx.answerCbQuery('⚠️ انتهت الجلسة، ابدأ من جديد.', { show_alert: true });
    await sendSpecialistPicker(ctx, state, true);
  });

  // اختيار المتخصص بالضغط على الزر — spec_pick_USERID_CHATID
  bot.action(/^spec_pick_(\d+)_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const uid        = ctx.from.id;
    const targetId   = Number(ctx.match[1]);
    const chatId     = Number(ctx.match[2]);
    const state      = pendingAddSpecialist.get(uid);

    if (!state || state.step !== 'specialist' || state.chatId !== chatId)
      return ctx.answerCbQuery('⚠️ انتهت الجلسة، ابدأ من جديد.', { show_alert: true });

    // جلب معلومات المستخدم المختار
    let specialist = null;
    try {
      const m = await bot.telegram.getChatMember(chatId, targetId);
      specialist = { id: m.user.id, username: m.user.username || m.user.first_name };
    } catch {
      // fallback من db
      const u = db.getUser(targetId);
      if (u) specialist = { id: u.userId, username: u.username || u.firstName || String(u.userId) };
    }

    if (!specialist)
      return ctx.answerCbQuery('❌ تعذر جلب بيانات هذا المستخدم.', { show_alert: true });

    const g = db.getGroup(chatId);
    if (!g) { pendingAddSpecialist.delete(uid); return ctx.editMessageText('❌ حدث خطأ، حاول مرة أخرى.'); }

    // تحقق تكرار
    if (g.specialistWords.find(sw => sw.word.toLowerCase() === state.word.toLowerCase())) {
      pendingAddSpecialist.delete(uid);
      return ctx.editMessageText('❌ هذه الكلمة موجودة مسبقاً!',
        Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', `specwords_list_${chatId}`)]]));
    }

    g.specialistWords.push({
      word:               state.word,
      specialistId:       specialist.id,
      specialistUsername: specialist.username,
      addedBy:            uid,
      addedAt:            new Date(),
    });
    db.saveData();
    pendingAddSpecialist.delete(uid);

    const displayName = specialist.username?.startsWith('@')
      ? specialist.username
      : `@${specialist.username}`;

    await ctx.editMessageText(
      `✅ *تمت الإضافة بنجاح!*\n\n🔤 الكلمة: \`${state.word}\`\n👨‍⚕️ المتخصص: ${displayName}\n\n` +
      `عند ذكر هذه الكلمة في المجموعة:\n• يُحذف الكلام تلقائياً\n• يُوجَّه صاحبه للمتخصص في الخاص مباشرة`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('➕ إضافة كلمة أخرى', `add_spec_start_${chatId}`)],
          [Markup.button.callback('📋 قائمة الكلمات', `specwords_list_${chatId}`)],
        ]),
      }
    );
  });

  // معالجة رسائل الخاص لإضافة كلمة متخصص (مرحلة إدخال الكلمة فقط)
  bot.on('message', async (ctx, next) => {
    if (!ctx.from) return next();
    const state = pendingAddSpecialist.get(ctx.from.id);
    if (!state) return next();
    if (ctx.chat.type !== 'private') return next();
    const text = ctx.message.text?.trim();
    if (!text) return next();

    if (state.step === 'word') {
      // تحقق أن الكلمة غير موجودة مسبقاً
      const g = db.getGroup(state.chatId);
      if (g && g.specialistWords.find(sw => sw.word.toLowerCase() === text.toLowerCase())) {
        await ctx.reply('❌ هذه الكلمة موجودة مسبقاً!');
        pendingAddSpecialist.delete(ctx.from.id);
        return next();
      }
      state.word = text;
      state.step = 'specialist';
      pendingAddSpecialist.set(ctx.from.id, state);

      // عرض أزرار الاختيار
      await sendSpecialistPicker(ctx, state, false);
      return;
    }

    return next();
  });

  // طلبات الانضمام (callback)
  bot.action(/^joinreqs_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId);
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });
    if (!g) return ctx.answerCbQuery('❌ بيانات غير موجودة!', { show_alert: true });
    const pending = getPendingJoinRequests(g);
    if (!pending.length)
      return ctx.editMessageText('📨 *لا توجد طلبات معلقة.*', { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', `group_home_${chatId}`)]]) });
    const btns = pending.slice(0, 8).map(r => [
      Markup.button.callback(`✅ ${r.firstName.slice(0, 14)}`, `jr_approve_${r.userId}_${chatId}`),
      Markup.button.callback('❌ رفض', `jr_reject_${r.userId}_${chatId}`),
    ]);
    btns.push([Markup.button.callback('✅ قبول الكل', `jr_approveall_${chatId}`), Markup.button.callback('❌ رفض الكل', `jr_rejectall_${chatId}`)]);
    btns.push([Markup.button.callback('🔙 رجوع', `group_home_${chatId}`)]);
    await ctx.editMessageText(`📨 *طلبات الانضمام* (${pending.length} معلقة)`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) });
  });


  // ════════════════════════════════════════════════════════════
  //  🧵 topics_panel — لوحة إدارة المواضيع الكاملة
  // ════════════════════════════════════════════════════════════
  bot.action(/^topics_panel_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g      = db.getGroup(chatId);
    if (!g) return ctx.answerCbQuery('❌ بيانات غير موجودة!', { show_alert: true });
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id))
      return ctx.answerCbQuery('❌ للمشرفين فقط!', { show_alert: true });

    const { getVerifySettings } = require('./verify_helpers');
    const vs     = getVerifySettings(g);
    const topics = g.topics ? [...g.topics.entries()].filter(([, t]) => !t.archived) : [];

    const statusLine = vs.enabled
      ? `🔒 نظام التحقق: *مفعّل*`
      : `🔓 نظام التحقق: *معطّل*`;

    const verifyTopicName = vs.verifyTopicId && g.topics?.get(vs.verifyTopicId)?.name
      ? g.topics.get(vs.verifyTopicId).name
      : (vs.verifyTopicId ? `ID: ${vs.verifyTopicId}` : 'غير محدد');

    if (!topics.length) {
      return ctx.editMessageText(
        `🧵 *إدارة مواضيع ${g.title}*

${statusLine}

` +
        `📋 لا توجد مواضيع مسجّلة بعد.

` +
        `يمكنك إنشاء موضوع جديد أو استخدام /synctopics داخل المجموعة.`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('➕ إنشاء موضوع جديد', `tp_create_${chatId}`)],
            [Markup.button.callback('🔄 تفعيل التحقق', `vfy_toggle_${chatId}`),
             Markup.button.callback('🔙 رجوع', `owner_panel_${chatId}`)],
          ])
        }
      );
    }

    // بناء أزرار المواضيع — كل موضوع له زر إدارة كامل
    const topicBtns = topics.map(([tid, t]) => {
      const icon     = t.locked ? '🔒' : '🔓';
      const isVerify = tid === vs.verifyTopicId ? ' ✅' : '';
      const members  = t.approvedUsers?.size || 0;
      return [
        Markup.button.callback(
          `${icon} ${(t.name || String(tid)).slice(0, 20)}${isVerify} (${members})`,
          `tp_manage_${tid}_${chatId}`
        ),
      ];
    });

    topicBtns.push([
      Markup.button.callback('➕ إنشاء موضوع جديد', `tp_create_${chatId}`),
    ]);
    topicBtns.push([
      Markup.button.callback(`${vs.enabled ? '🔴 تعطيل التحقق' : '🟢 تفعيل التحقق'}`, `vfy_toggle_${chatId}`),
    ]);
    topicBtns.push([
      Markup.button.callback('🔒 إغلاق الكل', `tp_closeall_${chatId}`),
      Markup.button.callback('🔓 فتح الكل',   `tp_openall_${chatId}`),
    ]);
    topicBtns.push([Markup.button.callback('🔙 رجوع', `owner_panel_${chatId}`)]);

    const totalMembers = topics.reduce((a, [, t]) => a + (t.approvedUsers?.size || 0), 0);
    await ctx.editMessageText(
      `🧵 *إدارة مواضيع ${g.title}*

${statusLine}
📌 موضوع التحقق: *${verifyTopicName}*
` +
      `📊 المواضيع: \`${topics.length}\` | الأعضاء المعتمدون: \`${totalMembers}\`

` +
      `اضغط على أي موضوع لإدارته`,
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard(topicBtns) }
    );
  });

  // تبديل حالة موضوع (فتح/إغلاق)
  bot.action(/^tp_toggle_(\d+)_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const topicId = Number(ctx.match[1]);
    const chatId  = Number(ctx.match[2]);
    const g       = db.getGroup(chatId);
    if (!g || !g.topics?.has(topicId)) return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return;

    const t = g.topics.get(topicId);
    if (t.locked) {
      await bot.telegram.reopenForumTopic(chatId, topicId).catch(() => {});
      t.locked = false;
      await ctx.answerCbQuery(`🔓 تم فتح: ${t.name}`, { show_alert: false });
    } else {
      await bot.telegram.closeForumTopic(chatId, topicId).catch(() => {});
      t.locked = true;
      await ctx.answerCbQuery(`🔒 تم إغلاق: ${t.name}`, { show_alert: false });
    }
    db.markDirty();

    // تحديث اللوحة
    return ctx.editMessageReplyMarkup(await buildTopicsMarkup(bot, g, chatId));
  });

  // تعيين موضوع التحقق
  bot.action(/^tp_setvfy_(\d+)_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const topicId = Number(ctx.match[1]);
    const chatId  = Number(ctx.match[2]);
    const g       = db.getGroup(chatId);
    if (!g) return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return;

    const { getVerifySettings } = require('./verify_helpers');
    const vs       = getVerifySettings(g);
    vs.verifyTopicId = topicId;
    db.markDirty();

    const name = g.topics?.get(topicId)?.name || topicId;
    await ctx.answerCbQuery(`✅ تم تعيين "${name}" كموضوع تحقق`, { show_alert: true });
    return ctx.editMessageReplyMarkup(await buildTopicsMarkup(bot, g, chatId));
  });

  // إغلاق كل المواضيع
  bot.action(/^tp_closeall_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g      = db.getGroup(chatId);
    if (!g) return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return;

    const { getVerifySettings } = require('./verify_helpers');
    const vs = getVerifySettings(g);
    for (const [tid, t] of (g.topics || new Map()).entries()) {
      if (tid === vs.verifyTopicId) continue;
      await bot.telegram.closeForumTopic(chatId, tid).catch(() => {});
      t.locked = true;
    }
    db.markDirty();
    await ctx.answerCbQuery('🔒 تم إغلاق كل المواضيع', { show_alert: true });
    return ctx.editMessageReplyMarkup(await buildTopicsMarkup(bot, g, chatId));
  });

  // فتح كل المواضيع
  bot.action(/^tp_openall_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g      = db.getGroup(chatId);
    if (!g) return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return;

    for (const [tid, t] of (g.topics || new Map()).entries()) {
      await bot.telegram.reopenForumTopic(chatId, tid).catch(() => {});
      t.locked = false;
    }
    db.markDirty();
    await ctx.answerCbQuery('🔓 تم فتح كل المواضيع', { show_alert: true });
    return ctx.editMessageReplyMarkup(await buildTopicsMarkup(bot, g, chatId));
  });

  // تفعيل/تعطيل نظام التحقق
  bot.action(/^vfy_toggle_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g      = db.getGroup(chatId);
    if (!g) return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return;

    const { getVerifySettings } = require('./verify_helpers');
    const vs    = getVerifySettings(g);
    vs.enabled  = !vs.enabled;
    db.markDirty();
    await ctx.answerCbQuery(vs.enabled ? '🟢 تم تفعيل التحقق' : '🔴 تم تعطيل التحقق', { show_alert: true });

    // إعادة رسم اللوحة
    const topicBtns = await buildTopicsMarkupRaw(bot, g, chatId);
    return ctx.editMessageReplyMarkup(Markup.inlineKeyboard(topicBtns).reply_markup);
  });

  // ════════════════════════════════════════════════════════════
  //  🧵 لوحة إدارة المواضيع المتطورة
  // ════════════════════════════════════════════════════════════

  // جلسات انتظار الإدخال النصي من المستخدم
  const topicInputSessions = new Map();
  // { userId → { action:'create'|'rename', chatId, topicId?, step } }

  // ── بناء لوحة موضوع واحد ────────────────────────────────────
  async function buildTopicDetailKeyboard(chatId, topicId, t, vs) {
    const isVerify = topicId === vs?.verifyTopicId;
    return Markup.inlineKeyboard([
      [
        Markup.button.callback(t.locked ? '🔓 فتح الموضوع' : '🔒 إغلاق الموضوع', `tp_toggle_${topicId}_${chatId}`),
        Markup.button.callback('✏️ تعديل الاسم', `tp_rename_${topicId}_${chatId}`),
      ],
      [
        Markup.button.callback('🔐 الصلاحيات', `tp_perms_${topicId}_${chatId}`),
        Markup.button.callback(isVerify ? '✅ موضوع التحقق' : '📌 تعيين للتحقق', `tp_setvfy_${topicId}_${chatId}`),
      ],
      [
        Markup.button.callback('📌 تثبيت رسالة', `tp_pin_${topicId}_${chatId}`),
        Markup.button.callback('🗄️ أرشفة', `tp_archive_${topicId}_${chatId}`),
      ],
      [
        Markup.button.callback('🗑️ حذف الموضوع', `tp_delete_${topicId}_${chatId}`),
      ],
      [Markup.button.callback('🔙 رجوع للمواضيع', `topics_panel_${chatId}`)],
    ]);
  }

  // ── صفحة إدارة موضوع واحد ────────────────────────────────────
  bot.action(/^tp_manage_(\d+)_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const topicId = Number(ctx.match[1]);
    const chatId  = Number(ctx.match[2]);
    const g = db.getGroup(chatId);
    if (!g) return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return;

    const t = g.topics?.get(topicId);
    if (!t) return ctx.answerCbQuery('❌ موضوع غير موجود', { show_alert: true });

    const { getVerifySettings } = require('./verify_helpers');
    const vs = getVerifySettings(g);

    const statusIcon  = t.locked ? '🔒 مغلق' : '🔓 مفتوح';
    const verifyMark  = topicId === vs.verifyTopicId ? '\n✅ *موضوع التحقق الرسمي*' : '';
    const approvedCnt = t.approvedUsers?.size || 0;

    const keyboard = await buildTopicDetailKeyboard(chatId, topicId, t, vs);
    await ctx.editMessageText(
      `🧵 *${t.name}*\n\n` +
      `🆔 ID: \`${topicId}\`\n` +
      `📊 الحالة: ${statusIcon}\n` +
      `👥 أعضاء معتمدون: \`${approvedCnt}\`${verifyMark}`,
      { parse_mode: 'Markdown', ...keyboard }
    );
  });

  // ── لوحة صلاحيات موضوع ──────────────────────────────────────
  bot.action(/^tp_perms_(\d+)_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const topicId = Number(ctx.match[1]);
    const chatId  = Number(ctx.match[2]);
    const g = db.getGroup(chatId);
    if (!g) return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return;

    const t = g.topics?.get(topicId) || {};
    const perms = t.perms || {};

    const btn = (label, key) =>
      Markup.button.callback(`${perms[key] !== false ? '✅' : '❌'} ${label}`, `tp_perm_${key}_${topicId}_${chatId}`);

    await ctx.editMessageText(
      `🔐 *صلاحيات موضوع: ${t.name || topicId}*\n\nاضغط لتفعيل/تعطيل:`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [btn('إرسال رسائل', 'canSend'),   btn('إرسال وسائط', 'canMedia')],
          [btn('إرسال استطلاعات', 'canPolls'), btn('إرسال روابط', 'canLinks')],
          [btn('تثبيت رسائل', 'canPin'),   btn('الردود', 'canReply')],
          [Markup.button.callback('🔙 رجوع', `tp_manage_${topicId}_${chatId}`)],
        ]),
      }
    );
  });

  // تبديل صلاحية واحدة في الموضوع
  bot.action(/^tp_perm_(\w+)_(\d+)_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const permKey = ctx.match[1];
    const topicId = Number(ctx.match[2]);
    const chatId  = Number(ctx.match[3]);
    const g = db.getGroup(chatId);
    if (!g) return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return;

    if (!g.topics.has(topicId)) return;
    const t = g.topics.get(topicId);
    if (!t.perms) t.perms = {};
    t.perms[permKey] = t.perms[permKey] === false ? true : false;
    db.markDirty();

    const perms = t.perms;
    const btn = (label, key) =>
      Markup.button.callback(`${perms[key] !== false ? '✅' : '❌'} ${label}`, `tp_perm_${key}_${topicId}_${chatId}`);

    await ctx.editMessageReplyMarkup(
      Markup.inlineKeyboard([
        [btn('إرسال رسائل', 'canSend'),   btn('إرسال وسائط', 'canMedia')],
        [btn('إرسال استطلاعات', 'canPolls'), btn('إرسال روابط', 'canLinks')],
        [btn('تثبيت رسائل', 'canPin'),   btn('الردود', 'canReply')],
        [Markup.button.callback('🔙 رجوع', `tp_manage_${topicId}_${chatId}`)],
      ]).reply_markup
    );
    await ctx.answerCbQuery(`${t.perms[permKey] !== false ? '✅' : '❌'} تم تعديل الصلاحية`, { show_alert: false });
  });

  // ── تعديل اسم موضوع ─────────────────────────────────────────
  bot.action(/^tp_rename_(\d+)_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const topicId = Number(ctx.match[1]);
    const chatId  = Number(ctx.match[2]);
    const g = db.getGroup(chatId);
    if (!g) return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return;

    const t = g.topics?.get(topicId);
    if (!t) return;

    topicInputSessions.set(ctx.from.id, { action: 'rename', chatId, topicId });

    await ctx.editMessageText(
      `✏️ *تعديل اسم الموضوع*\n\nالاسم الحالي: *${t.name}*\n\nأرسل الاسم الجديد الآن:`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('❌ إلغاء', `tp_manage_${topicId}_${chatId}`)]]),
      }
    );
  });

  // ── إنشاء موضوع جديد ─────────────────────────────────────────
  bot.action(/^tp_create_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const g = db.getGroup(chatId);
    if (!g) return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return;

    topicInputSessions.set(ctx.from.id, { action: 'create', chatId });

    await ctx.editMessageText(
      `➕ *إنشاء موضوع جديد*\n\nأرسل اسم الموضوع الجديد:`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('❌ إلغاء', `topics_panel_${chatId}`)]]),
      }
    );
  });

  // ── حذف موضوع ───────────────────────────────────────────────
  bot.action(/^tp_delete_(\d+)_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const topicId = Number(ctx.match[1]);
    const chatId  = Number(ctx.match[2]);
    const g = db.getGroup(chatId);
    if (!g) return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return;

    const t = g.topics?.get(topicId);
    if (!t) return;

    await ctx.editMessageText(
      `🗑️ *تأكيد حذف الموضوع*\n\nهل تريد حذف *${t.name}* نهائياً؟\n⚠️ هذا الإجراء لا يمكن التراجع عنه.`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('✅ نعم، احذف', `tp_delconfirm_${topicId}_${chatId}`),
            Markup.button.callback('❌ إلغاء', `tp_manage_${topicId}_${chatId}`),
          ],
        ]),
      }
    );
  });

  bot.action(/^tp_delconfirm_(\d+)_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const topicId = Number(ctx.match[1]);
    const chatId  = Number(ctx.match[2]);
    const g = db.getGroup(chatId);
    if (!g) return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return;

    const t = g.topics?.get(topicId);
    const name = t?.name || topicId;

    try {
      await bot.telegram.callApi('deleteForumTopic', {
        chat_id:           chatId,
        message_thread_id: topicId,
      });
      g.topics.delete(topicId);
      db.markDirty();
      await ctx.answerCbQuery(`🗑️ تم حذف "${name}"`, { show_alert: true });
    } catch (e) {
      await ctx.answerCbQuery(`❌ فشل الحذف: ${e.message}`, { show_alert: true });
    }

    // إعادة لوحة المواضيع
    const topicBtns = await buildTopicsMarkupRaw(bot, g, chatId);
    return ctx.editMessageText(
      `🧵 *إدارة مواضيع ${g.title}*\n\n✅ تم حذف الموضوع: *${name}*`,
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard(topicBtns) }
    );
  });

  // ── أرشفة موضوع ─────────────────────────────────────────────
  bot.action(/^tp_archive_(\d+)_(-?\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const topicId = Number(ctx.match[1]);
    const chatId  = Number(ctx.match[2]);
    const g = db.getGroup(chatId);
    if (!g) return;
    if (!isDeveloper(ctx) && !await isAdmin(bot, chatId, ctx.from.id)) return;

    const t = g.topics?.get(topicId);
    if (!t) return ctx.answerCbQuery('❌ غير موجود', { show_alert: true });

    try {
      await bot.telegram.callApi('closeForumTopic', { chat_id: chatId, message_thread_id: topicId });
      t.locked = true; t.archived = true;
      db.markDirty();
      await ctx.answerCbQuery(`🗄️ تم أرشفة "${t.name}"`, { show_alert: true });
    } catch {}

    const topicBtns = await buildTopicsMarkupRaw(bot, g, chatId);
    return ctx.editMessageReplyMarkup(Markup.inlineKeyboard(topicBtns).reply_markup);
  });

  // ── استقبال النص (إنشاء / تعديل اسم) ────────────────────────
  bot.on('text', async (ctx, next) => {
    if (ctx.chat.type !== 'private') return next();
    const sess = topicInputSessions.get(ctx.from.id);
    if (!sess) return next();

    topicInputSessions.delete(ctx.from.id);
    const newName = ctx.message.text.trim();
    if (!newName || newName.startsWith('/')) return next();

    const g = db.getGroup(sess.chatId);
    if (!g) return ctx.reply('❌ المجموعة غير موجودة.');

    if (sess.action === 'rename') {
      const t = g.topics?.get(sess.topicId);
      if (!t) return ctx.reply('❌ الموضوع غير موجود.');
      const oldName = t.name;
      try {
        await bot.telegram.callApi('editForumTopic', {
          chat_id:           sess.chatId,
          message_thread_id: sess.topicId,
          name:              newName,
        });
        t.name = newName;
        db.markDirty();
        await ctx.reply(
          `✅ تم تعديل اسم الموضوع\n*${oldName}* → *${newName}*`,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([[
              Markup.button.callback('🔙 رجوع للموضوع', `tp_manage_${sess.topicId}_${sess.chatId}`)
            ]]),
          }
        );
      } catch (e) {
        await ctx.reply(`❌ فشل التعديل: ${e.message}`);
      }

    } else if (sess.action === 'create') {
      try {
        const result = await bot.telegram.callApi('createForumTopic', {
          chat_id: sess.chatId,
          name:    newName,
        });
        const newTopicId = result.message_thread_id;
        db.getOrCreateTopic(g, newTopicId, newName);
        db.markDirty();
        await ctx.reply(
          `✅ تم إنشاء الموضوع *${newName}*\n🆔 ID: \`${newTopicId}\``,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([[
              Markup.button.callback('⚙️ إدارة الموضوع', `tp_manage_${newTopicId}_${sess.chatId}`),
              Markup.button.callback('🔙 كل المواضيع',   `topics_panel_${sess.chatId}`),
            ]]),
          }
        );
      } catch (e) {
        await ctx.reply(`❌ فشل الإنشاء: ${e.message}\n\nتأكد أن المجموعة تدعم المواضيع (Supergroup + Topics مفعّل)`);
      }
    }
  });

};
