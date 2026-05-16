// db.js — Cache layer فوق Supabase
// جامعة v5.0: يحتفظ بـ in-memory cache لتسريع الأداء
// ويزامن مع Supabase في الخلفية — لا فقدان بيانات عند restart

const supa = require('./supabase');

// ── Cache في الذاكرة ──────────────────────────────────────────
const cache = {
  groups:      new Map(),   // chatId → groupData (snake_case من Supabase)
  users:       new Map(),   // userId → userData
  channels:    new Map(),   // chatId → channelData
  communities: new Map(),   // communityId → communityData
};

// ── دالة مساعدة: تحويل بيانات المجموعة من Supabase إلى بنية داخلية ──
function hydrateGroup(g) {
  if (!g) return null;
  return {
    ...g,
    chatId:              g.chat_id,
    title:               g.title || '',
    type:                g.type || 'group',
    ownerId:             g.owner_id || null,
    ownerUsername:       g.owner_username || '',
    ownerVerified:       g.owner_verified || false,
    ownerVerifiedAt:     g.owner_verified_at || null,
    addedBy:             g.added_by || 0,
    addedByUsername:     g.added_by_username || '',
    addedAt:             g.added_at ? new Date(g.added_at) : new Date(),
    maxWarns:            g.max_warns || 3,
    welcomeMessage:      g.welcome_message || '👋 مرحباً {name} في {group}!\nنتمنى لك وقتاً ممتعاً.',
    welcomeEnabled:      g.welcome_enabled !== false,
    antiSpam:            g.anti_spam || false,
    muteNewMembers:      g.mute_new_members || false,
    joinRequestsEnabled: g.join_requests_enabled || false,
    protectContent:      g.protect_content || false,
    antiLinks:           g.anti_links || false,
    antiBot:             g.anti_bot || false,
    logChannelId:        g.log_channel_id || null,
    rules:               g.rules || '',
    communityId:         g.community_id || null,
    slowMode:            g.slow_mode || 0,
    captchaEnabled:      g.captcha_enabled || false,
    perms: {
      canSendMessages:   g.perm_send_messages   !== false,
      canSendMedia:      g.perm_send_media       !== false,
      canSendPolls:      g.perm_send_polls       !== false,
      canAddWebPreviews: g.perm_web_previews     !== false,
      canInviteUsers:    g.perm_invite_users     !== false,
      canPinMessages:    g.perm_pin_messages     || false,
      canManageTopics:   g.perm_manage_topics    || false,
    },
    topicSettings: {
      requireApprovalToJoin: g.topic_require_approval || false,
      autoLockOnCreate:      g.topic_auto_lock        || false,
      ownerBypassAll:        g.topic_owner_bypass     !== false,
    },
    // كاشات مؤقتة في الذاكرة (تُعاد عند restart من Supabase)
    members:             new Map(),
    admins:              new Map(),
    warns:               new Map(),
    mutedUsers:          new Set(),
    bannedUsers:         new Set(),
    bannedWords:         [],
    wordViolations:      new Map(),
    joinRequests:        new Map(),
    joinRequestCooldown: new Map(),
    topics:              new Map(),
    timedMutes:          new Map(),
    timedBans:           new Map(),
    auditLog:            [],
    autoBannedUsers:     new Map(),
  };
}

// ── تحميل البيانات من Supabase عند الـ startup ────────────────
async function loadData() {
  console.log('📥 تحميل البيانات من Supabase...');
  try {
    const [groups, users, channels, communities, allBannedWords, allWarns] = await Promise.all([
      supa.getAllGroups(),
      supa.getAllUsers(),
      supa.getAllChannels(),
      supa.getAllCommunities(),
      supa.getAllBannedWords(),
      supa.getAllWarns(),
    ]);

    for (const g of groups) {
      cache.groups.set(g.chat_id, hydrateGroup(g));
    }
    for (const u of users) {
      cache.users.set(u.user_id, {
        ...u,
        userId:       u.user_id,
        username:     u.username || '',
        firstName:    u.first_name || '',
        globalBanned: u.global_banned || false,
        bannedReason: u.banned_reason || '',
        bannedAt:     u.banned_at || null,
        firstSeen:    u.first_seen ? new Date(u.first_seen) : new Date(),
        lastSeen:     u.last_seen  ? new Date(u.last_seen)  : new Date(),
        groups:   new Set(),
        channels: new Set(),
      });
    }
    for (const c of channels) {
      cache.channels.set(c.chat_id, {
        ...c,
        chatId:           c.chat_id,
        title:            c.title || '',
        username:         c.username || '',
        ownerId:          c.owner_id || null,
        ownerUsername:    c.owner_username || '',
        addedBy:          c.added_by || 0,
        addedByUsername:  c.added_by_username || '',
        addedAt:          c.added_at ? new Date(c.added_at) : new Date(),
        subscribers:      new Map(),
      });
    }
    for (const com of communities) {
      cache.communities.set(com.community_id, {
        ...com,
        communityId:    com.community_id,
        title:          com.title || '',
        maxGroupJoins:  com.max_group_joins || 1,
        enabled:        com.enabled !== false,
        subGroups:      new Set(),
        memberJoins:    new Map(),
        autoBannedUsers: new Map(),
      });
    }

    // ── تحميل الكلمات المحظورة لكل مجموعة ──
    for (const bw of allBannedWords) {
      const g = cache.groups.get(bw.chat_id);
      if (g) {
        g.bannedWords.push({
          word:      bw.word,
          action:    bw.action || 'warn',
          threshold: bw.threshold || 1,
          addedBy:   bw.added_by || 0,
          addedAt:   bw.added_at ? new Date(bw.added_at) : new Date(),
        });
      }
    }

    // ── تحميل التحذيرات لكل مجموعة ──
    for (const w of allWarns) {
      const g = cache.groups.get(w.chat_id);
      if (g) {
        if (!g.warns.has(w.user_id)) g.warns.set(w.user_id, []);
        g.warns.get(w.user_id).push({
          reason:    w.reason || '',
          warnedBy:  w.warned_by || 0,
          warnedAt:  w.warned_at ? new Date(w.warned_at) : new Date(),
        });
      }
    }

    console.log(
      `✅ تم تحميل ${groups.length} مجموعة، ${users.length} مستخدم، ` +
      `${channels.length} قناة، ${allBannedWords.length} كلمة محظورة، ` +
      `${allWarns.length} تحذير من Supabase`
    );
  } catch (e) {
    console.error('❌ فشل تحميل البيانات من Supabase:', e.message);
  }
}

// ── saveData — للتوافق مع الكود القديم ──────────────────────
function saveData() {
  // البيانات تُحفظ فوراً في Supabase — لا حاجة لهذه الدالة
}

// ═══════════════════════════════════════════
//  GROUPS
// ═══════════════════════════════════════════

async function getGroup(chatId) {
  if (cache.groups.has(chatId)) return cache.groups.get(chatId);
  const g = await supa.getGroup(chatId);
  if (g) {
    const hydrated = hydrateGroup(g);
    cache.groups.set(chatId, hydrated);
    return hydrated;
  }
  return null;
}

async function getOrCreateGroup(chatId, title, type, addedBy, addedByUsername) {
  let g = await getGroup(chatId);
  if (!g) {
    await supa.upsertGroup(chatId, {
      title: title || 'مجموعة',
      type:  type  || 'group',
      added_by: addedBy || 0,
      added_by_username: addedByUsername || '',
    });
    const fresh = await supa.getGroup(chatId);
    g = hydrateGroup(fresh);
    cache.groups.set(chatId, g);
  }
  return g;
}

async function deleteGroup(chatId) {
  cache.groups.delete(chatId);
  await supa.deleteGroup(chatId);
}

function allGroups() {
  return [...cache.groups.values()];
}

// حفظ تغييرات المجموعة في Supabase (غير مُعيق)
async function _syncGroup(g) {
  try {
    await supa.upsertGroup(g.chat_id || g.chatId, {
      title:                  g.title,
      type:                   g.type,
      owner_id:               g.ownerId || g.owner_id || null,
      owner_username:         g.ownerUsername || g.owner_username || '',
      owner_verified:         g.ownerVerified || false,
      added_by:               g.addedBy || g.added_by || 0,
      added_by_username:      g.addedByUsername || g.added_by_username || '',
      max_warns:              g.maxWarns || 3,
      welcome_message:        g.welcomeMessage || '',
      welcome_enabled:        g.welcomeEnabled !== false,
      anti_spam:              g.antiSpam || false,
      mute_new_members:       g.muteNewMembers || false,
      join_requests_enabled:  g.joinRequestsEnabled || false,
      protect_content:        g.protectContent || false,
      anti_links:             g.antiLinks || false,
      anti_bot:               g.antiBot || false,
      log_channel_id:         g.logChannelId || null,
      rules:                  g.rules || '',
      community_id:           g.communityId || null,
      slow_mode:              g.slowMode || 0,
      captcha_enabled:        g.captchaEnabled || false,
      perm_send_messages:     g.perms?.canSendMessages   !== false,
      perm_send_media:        g.perms?.canSendMedia       !== false,
      perm_send_polls:        g.perms?.canSendPolls       !== false,
      perm_web_previews:      g.perms?.canAddWebPreviews  !== false,
      perm_invite_users:      g.perms?.canInviteUsers     !== false,
      perm_pin_messages:      g.perms?.canPinMessages     || false,
      perm_manage_topics:     g.perms?.canManageTopics    || false,
      topic_require_approval: g.topicSettings?.requireApprovalToJoin || false,
      topic_auto_lock:        g.topicSettings?.autoLockOnCreate      || false,
      topic_owner_bypass:     g.topicSettings?.ownerBypassAll        !== false,
    });
  } catch (e) { console.error('_syncGroup error:', e.message); }
}

// دالة مساعدة لحفظ التغييرات بعد التعديل
function scheduleSync(g) {
  setImmediate(() => _syncGroup(g));
}

// ═══════════════════════════════════════════
//  CHANNELS
// ═══════════════════════════════════════════

function getChannel(chatId) { return cache.channels.get(chatId) || null; }

async function getOrCreateChannel(chatId, title, username, addedBy, addedByUsername) {
  if (!cache.channels.has(chatId)) {
    await supa.upsertChannel(chatId, {
      title: title || 'قناة',
      username: username || '',
      added_by: addedBy || 0,
      added_by_username: addedByUsername || '',
    });
    const channel = {
      chatId, title: title || 'قناة',
      username: username || '',
      addedBy: addedBy || 0,
      addedByUsername: addedByUsername || '',
      addedAt: new Date(),
      subscribers: new Map(),
      ownerId: null,
      ownerUsername: '',
    };
    cache.channels.set(chatId, channel);
  }
  return cache.channels.get(chatId);
}

async function deleteChannel(chatId) {
  cache.channels.delete(chatId);
  await supa.deleteChannel(chatId);
}

function allChannels() { return [...cache.channels.values()]; }

// ═══════════════════════════════════════════
//  MEMBERS
// ═══════════════════════════════════════════

async function trackMember(chatId, userId, username, firstName, role) {
  const g = await getGroup(chatId);
  if (!g) return;
  if (!g.members.has(userId)) {
    g.members.set(userId, {
      userId,
      username:      username  || '',
      firstName:     firstName || String(userId),
      role:          role      || 'member',
      joinedAt:      new Date(),
      messageCount:  0,
      score:         0,
      lastMessageAt: null,
    });
  } else {
    const m = g.members.get(userId);
    if (role)      m.role      = role;
    if (username)  m.username  = username;
    if (firstName) m.firstName = firstName;
  }
  // تأكد من وجود المجموعة في Supabase أولاً قبل إضافة العضو (تجنب Foreign Key violation)
  await supa.upsertGroup(chatId, {
    title:      g.title || 'مجموعة',
    type:       g.type  || 'group',
    updated_at: new Date().toISOString(),
  }).catch(e => console.error('trackMember upsertGroup error:', e.message));
  // الآن أضف العضو بأمان
  await supa.upsertMember(chatId, userId, {
    username:   username  || '',
    first_name: firstName || '',
    role:       role      || 'member',
  });
}

// ═══════════════════════════════════════════
//  USERS
// ═══════════════════════════════════════════

async function getOrCreateUser(userId, username, firstName) {
  if (!cache.users.has(userId)) {
    const u = {
      userId,
      username:     username  || '',
      firstName:    firstName || '',
      globalBanned: false,
      bannedReason: '',
      bannedAt:     null,
      firstSeen:    new Date(),
      lastSeen:     new Date(),
      groups:       new Set(),
      channels:     new Set(),
    };
    cache.users.set(userId, u);
    // مزامنة مع Supabase
    supa.upsertUser(userId, username || '', firstName || '').catch(() => {});
  }
  return cache.users.get(userId);
}

function getUser(userId) { return cache.users.get(userId) || null; }
function allUsers()      { return [...cache.users.values()]; }

function getUserGroups(userId) {
  return [...cache.groups.values()]
    .filter(g => g.ownerId === userId || g.admins.has(userId))
    .map(g => g.chatId || g.chat_id);
}

// ═══════════════════════════════════════════
//  COMMUNITIES
// ═══════════════════════════════════════════

async function getOrCreateCommunity(communityId, title) {
  if (!cache.communities.has(communityId)) {
    await supa.upsertCommunity(communityId, title, 1, true);
    cache.communities.set(communityId, {
      communityId, title: title || '',
      maxGroupJoins: 1,
      enabled: true,
      subGroups: new Set(),
      memberJoins: new Map(),
      autoBannedUsers: new Map(),
    });
  }
  return cache.communities.get(communityId);
}

function getCommunity(communityId) { return cache.communities.get(communityId) || null; }
function allCommunities()          { return [...cache.communities.values()]; }

async function recordCommunityJoin(communityId, userId, chatId) {
  // كاش محلي
  const com = cache.communities.get(communityId);
  if (!com || !com.enabled) return false;
  if (!com.memberJoins.has(userId)) com.memberJoins.set(userId, new Set());
  const joined = com.memberJoins.get(userId);
  joined.add(chatId);
  // مزامنة مع Supabase
  return await supa.recordCommunityJoin(communityId, userId, chatId);
}

// ═══════════════════════════════════════════
//  WORD VIOLATIONS
// ═══════════════════════════════════════════

async function recordWordViolation(chatId, userId, word) {
  const g = await getGroup(chatId);
  if (!g) return 0;
  if (!g.wordViolations.has(userId)) g.wordViolations.set(userId, {});
  const vio = g.wordViolations.get(userId);
  const count = await supa.incrementWordViolation(chatId, userId, word);
  vio[word] = count;
  return count;
}

async function resetWordViolation(chatId, userId, word) {
  const g = await getGroup(chatId);
  if (!g) return;
  const vio = g.wordViolations.get(userId);
  if (vio) delete vio[word];
  await supa.resetWordViolation(chatId, userId, word);
}

// ═══════════════════════════════════════════
//  AUDIT LOG
// ═══════════════════════════════════════════

async function addAuditLog(chatId, entry) {
  const g = await getGroup(chatId);
  if (g) {
    g.auditLog.unshift({ ...entry, at: new Date() });
    if (g.auditLog.length > 100) g.auditLog.length = 100;
  }
  await supa.addAuditLog(
    chatId,
    entry.action,
    entry.by?.id || 0,
    entry.by?.username || '',
    entry.target?.id || 0,
    entry.target?.username || '',
    entry.details || ''
  );
}

// ═══════════════════════════════════════════
//  STATS
// ═══════════════════════════════════════════

async function getStats() {
  return await supa.getStats();
}

// ═══════════════════════════════════════════
//  EXPORTS
// ═══════════════════════════════════════════

module.exports = {
  // Core
  loadData, saveData,
  scheduleSync,
  // Groups
  getGroup, getOrCreateGroup, deleteGroup, allGroups,
  // Channels
  getChannel, getOrCreateChannel, deleteChannel, allChannels,
  // Members
  trackMember,
  // Users
  getOrCreateUser, getUser, allUsers, getUserGroups,
  // Communities
  getOrCreateCommunity, getCommunity, allCommunities, recordCommunityJoin,
  // Word violations
  recordWordViolation, resetWordViolation,
  // Audit log
  addAuditLog,
  // Stats
  getStats,
  // Delegate everything else to supabase
  ...supa,
};
