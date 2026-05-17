const fs   = require('fs');
const path = require('path');

const DATA_FILE = process.env.DATA_FILE
  ? path.resolve(process.env.DATA_FILE)
  : path.join(__dirname, 'data.json');

const groups      = new Map();
const channels    = new Map();
const users       = new Map();
const communities = new Map();

// ═══════════════════════════════════════════════════════════════
//  Groups
// ═══════════════════════════════════════════════════════════════

function getGroup(chatId) { return groups.get(chatId) || null; }

function getOrCreateGroup(chatId, title, type, addedBy, addedByUsername) {
  if (!groups.has(chatId)) {
    groups.set(chatId, {
      chatId, title, type,
      ownerId: null, ownerUsername: '',
      ownerVerified: false, ownerVerifiedAt: null,
      addedBy, addedByUsername, addedAt: new Date(),
      members:      new Map(),
      admins:       new Map(),
      warns:        new Map(),
      maxWarns:     3,
      welcomeMessage: '👋 مرحباً {name} في {group}!\nنتمنى لك وقتاً ممتعاً.',
      welcomeEnabled:      true,
      antiSpam:            false,
      muteNewMembers:      false,
      mutedUsers:          new Set(),
      bannedUsers:         new Set(),
      bannedWords:         [],
      wordViolations:      new Map(),
      joinRequests:        new Map(),
      joinRequestsEnabled: false,
      rules:               '',
      communityId:         null,
      protectContent:      false,
      antiLinks:           false,
      antiBot:             false,
      logChannelId:        null,
      timedMutes:          new Map(),
      timedBans:           new Map(),
      joinRequestCooldown: new Map(),
      // المواضيع
      topics:       new Map(),   // topicId -> { name, locked, archived, approvedUsers: Set }
      topicSettings: {
        requireApprovalToJoin: false,
        autoLockOnCreate:      false,
        ownerBypassAll:        true,
      },
      perms: {
        canSendMessages:   true,
        canSendMedia:      true,
        canSendPolls:      true,
        canAddWebPreviews: true,
        canInviteUsers:    true,
        canPinMessages:    false,
        canManageTopics:   false,
      },
      auditLog: [],
    });
  }
  return groups.get(chatId);
}

function deleteGroup(chatId) { groups.delete(chatId); }
function allGroups()         { return [...groups.values()]; }

// ═══════════════════════════════════════════════════════════════
//  Channels
// ═══════════════════════════════════════════════════════════════

function getChannel(chatId) { return channels.get(chatId) || null; }
function getOrCreateChannel(chatId, title, username, addedBy, addedByUsername) {
  if (!channels.has(chatId)) {
    channels.set(chatId, {
      chatId, title,
      username:         username || '',
      addedBy,
      addedByUsername,
      addedAt:          new Date(),
      subscribers:      new Map(),
      ownerId:          null,
      ownerUsername:    '',
    });
  }
  return channels.get(chatId);
}
function deleteChannel(chatId) { channels.delete(chatId); }
function allChannels()         { return [...channels.values()]; }

// ═══════════════════════════════════════════════════════════════
//  Members
// ═══════════════════════════════════════════════════════════════

function trackMember(chatId, userId, username, firstName, role) {
  const g = groups.get(chatId);
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
}

// ═══════════════════════════════════════════════════════════════
//  Users
// ═══════════════════════════════════════════════════════════════

function getOrCreateUser(userId, username, firstName) {
  if (!users.has(userId)) {
    users.set(userId, {
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
    });
  }
  return users.get(userId);
}
function getUser(userId) { return users.get(userId) || null; }
function allUsers()      { return [...users.values()]; }

function getUserGroups(userId) {
  return [...groups.values()]
    .filter(g => g.ownerId === userId || g.admins.has(userId))
    .map(g => g.chatId);
}

// ═══════════════════════════════════════════════════════════════
//  Communities
// ═══════════════════════════════════════════════════════════════

function getOrCreateCommunity(communityId, title) {
  if (!communities.has(communityId)) {
    communities.set(communityId, {
      communityId, title,
      subGroups:        new Set(),
      memberJoins:      new Map(),
      maxGroupJoins:    1,
      enabled:          true,
      autoBannedUsers:  new Map(), // userId -> { reason, groups[], bannedAt }
    });
  }
  return communities.get(communityId);
}
function getCommunity(communityId) { return communities.get(communityId) || null; }
function allCommunities()          { return [...communities.values()]; }

function recordCommunityJoin(communityId, userId, chatId) {
  const c = communities.get(communityId);
  if (!c || !c.enabled) return false;
  if (!c.memberJoins.has(userId)) c.memberJoins.set(userId, new Set());
  const joined = c.memberJoins.get(userId);
  joined.add(chatId);
  return joined.size > c.maxGroupJoins;
}

// ═══════════════════════════════════════════════════════════════
//  Word violations & Audit log
// ═══════════════════════════════════════════════════════════════

function recordWordViolation(chatId, userId, word) {
  const g = groups.get(chatId); if (!g) return 0;
  if (!g.wordViolations.has(userId)) g.wordViolations.set(userId, {});
  const vio = g.wordViolations.get(userId);
  vio[word] = (vio[word] || 0) + 1;
  return vio[word];
}
function resetWordViolation(chatId, userId, word) {
  const g = groups.get(chatId); if (!g) return;
  const vio = g.wordViolations.get(userId);
  if (vio) delete vio[word];
}

function addAuditLog(chatId, entry) {
  const g = groups.get(chatId); if (!g) return;
  g.auditLog.unshift({ ...entry, at: new Date() });
  if (g.auditLog.length > 100) g.auditLog.length = 100;
}

// ═══════════════════════════════════════════════════════════════
//  Stats
// ═══════════════════════════════════════════════════════════════

function getStats() {
  return {
    totalGroups:   groups.size,
    totalChannels: channels.size,
    totalUsers:    users.size,
    bannedUsers:   [...users.values()].filter(u => u.globalBanned).length,
    totalAdmins:   [...groups.values()].reduce((a, g) => a + g.admins.size, 0),
    totalWarns:    [...groups.values()].reduce((a, g) => a + [...g.warns.values()].reduce((b, w) => b + w.length, 0), 0),
    pendingReqs:   [...groups.values()].reduce((a, g) => a + [...g.joinRequests.values()].filter(r => r.status === 'pending').length, 0),
  };
}

// ═══════════════════════════════════════════════════════════════
//  Persistence — save / load data.json
// ═══════════════════════════════════════════════════════════════

function saveData() {
  try {
    const data = {
      savedAt: new Date().toISOString(),
      groups: Object.fromEntries(
        [...groups.entries()].map(([k, v]) => [k, {
          ...v,
          members:             Object.fromEntries(v.members),
          admins:              Object.fromEntries(v.admins),
          warns:               Object.fromEntries([...v.warns.entries()]),
          mutedUsers:          [...v.mutedUsers],
          bannedUsers:         [...v.bannedUsers],
          timedMutes:          Object.fromEntries(v.timedMutes),
          timedBans:           Object.fromEntries(v.timedBans),
          joinRequests:        Object.fromEntries(v.joinRequests),
          joinRequestCooldown: Object.fromEntries(v.joinRequestCooldown),
          wordViolations:      Object.fromEntries(v.wordViolations),
          topics:              Object.fromEntries(
            [...v.topics.entries()].map(([tid, tv]) => [tid, {
              ...tv,
              approvedUsers: tv.approvedUsers ? [...tv.approvedUsers] : [],
            }])
          ),
        }])
      ),
      channels: Object.fromEntries(
        [...channels.entries()].map(([k, v]) => [k, {
          ...v,
          subscribers: Object.fromEntries(v.subscribers),
        }])
      ),
      users: Object.fromEntries(
        [...users.entries()].map(([k, v]) => [k, {
          ...v,
          groups:   [...v.groups],
          channels: [...v.channels],
        }])
      ),
      communities: Object.fromEntries(
        [...communities.entries()].map(([k, v]) => [k, {
          ...v,
          subGroups:       [...v.subGroups],
          memberJoins:     Object.fromEntries(
            [...v.memberJoins.entries()].map(([uk, uv]) => [uk, [...uv]])
          ),
          autoBannedUsers: Object.fromEntries(v.autoBannedUsers || new Map()),
        }])
      ),
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error('saveData error:', e.message);
  }
}

function loadData() {
  if (!fs.existsSync(DATA_FILE)) return;
  try {
    const raw  = fs.readFileSync(DATA_FILE, 'utf-8');
    const data = JSON.parse(raw);

    for (const [k, v] of Object.entries(data.groups || {})) {
      // إعادة بناء topics
      const topicsMap = new Map();
      for (const [tid, tv] of Object.entries(v.topics || {})) {
        topicsMap.set(Number(tid), {
          ...tv,
          approvedUsers: new Set((tv.approvedUsers || []).map(Number)),
        });
      }

      groups.set(Number(k), {
        ...v,
        chatId:              Number(k),
        ownerVerified:       v.ownerVerified  || false,
        ownerVerifiedAt:     v.ownerVerifiedAt || null,
        members:             new Map(Object.entries(v.members || {}).map(([uk, uv]) => [Number(uk), uv])),
        admins:              new Map(Object.entries(v.admins  || {}).map(([uk, uv]) => [Number(uk), uv])),
        warns:               new Map(Object.entries(v.warns   || {}).map(([uk, uv]) => [Number(uk), uv])),
        mutedUsers:          new Set((v.mutedUsers  || []).map(Number)),
        bannedUsers:         new Set((v.bannedUsers || []).map(Number)),
        timedMutes:          new Map(Object.entries(v.timedMutes  || {}).map(([uk, uv]) => [Number(uk), uv])),
        timedBans:           new Map(Object.entries(v.timedBans   || {}).map(([uk, uv]) => [Number(uk), uv])),
        joinRequests:        new Map(Object.entries(v.joinRequests || {}).map(([uk, uv]) => [Number(uk), uv])),
        joinRequestCooldown: new Map(Object.entries(v.joinRequestCooldown || {}).map(([uk, uv]) => [Number(uk), uv])),
        wordViolations:      new Map(Object.entries(v.wordViolations || {}).map(([uk, uv]) => [Number(uk), uv])),
        topics:              topicsMap,
        topicSettings: v.topicSettings || {
          requireApprovalToJoin: false,
          autoLockOnCreate:      false,
          ownerBypassAll:        true,
        },
        perms: v.perms || {
          canSendMessages: true, canSendMedia: true, canSendPolls: true,
          canAddWebPreviews: true, canInviteUsers: true,
          canPinMessages: false, canManageTopics: false,
        },
        auditLog: v.auditLog || [],
      });
    }

    for (const [k, v] of Object.entries(data.channels || {})) {
      channels.set(Number(k), {
        ...v,
        chatId:      Number(k),
        subscribers: new Map(Object.entries(v.subscribers || {}).map(([uk, uv]) => [Number(uk), uv])),
      });
    }

    for (const [k, v] of Object.entries(data.users || {})) {
      users.set(Number(k), {
        ...v,
        userId:   Number(k),
        lastSeen: v.lastSeen || v.firstSeen || new Date(),
        groups:   new Set((v.groups   || []).map(Number)),
        channels: new Set((v.channels || []).map(Number)),
      });
    }

    for (const [k, v] of Object.entries(data.communities || {})) {
      communities.set(Number(k), {
        ...v,
        communityId:     Number(k),
        subGroups:       new Set((v.subGroups || []).map(Number)),
        memberJoins:     new Map(
          Object.entries(v.memberJoins || {}).map(([uk, uv]) => [Number(uk), new Set((uv || []).map(Number))])
        ),
        autoBannedUsers: new Map(
          Object.entries(v.autoBannedUsers || {}).map(([uk, uv]) => [Number(uk), uv])
        ),
      });
    }

    console.log(`✅ تم استعادة البيانات: ${groups.size} مجموعة، ${users.size} مستخدم`);
  } catch (e) {
    console.error('loadData error:', e.message);
  }
}

// تنظيف الكتم/الحظر المنتهي كل دقيقة
setInterval(() => {
  const now = Date.now();
  for (const g of groups.values()) {
    for (const [uid, expiry] of g.timedBans.entries()) {
      if (expiry <= now) g.timedBans.delete(uid);
    }
    for (const [uid, expiry] of g.timedMutes.entries()) {
      if (expiry <= now) {
        g.timedMutes.delete(uid);
        g.mutedUsers.delete(uid);
      }
    }
  }
}, 60 * 1000);

loadData();
setInterval(saveData, 5 * 60 * 1000);
process.on('SIGINT',  () => { saveData(); process.exit(0); });
process.on('SIGTERM', () => { saveData(); process.exit(0); });
process.on('exit',    () => { saveData(); });

module.exports = {
  getGroup, getOrCreateGroup, deleteGroup, allGroups,
  getChannel, getOrCreateChannel, deleteChannel, allChannels,
  trackMember,
  getOrCreateUser, getUser, allUsers, getUserGroups,
  getOrCreateCommunity, getCommunity, allCommunities, recordCommunityJoin,
  recordWordViolation, resetWordViolation,
  addAuditLog,
  getStats,
  saveData,
};
