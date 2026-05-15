// ============================================================
//  قاعدة البيانات في الذاكرة
// ============================================================

const groups      = new Map();
const channels    = new Map();
const users       = new Map();
const communities = new Map();

// ════════ المجموعات ══════════════════════════════════════════

function getGroup(chatId) { return groups.get(chatId) || null; }

function getOrCreateGroup(chatId, title, type, addedBy, addedByUsername) {
  if (!groups.has(chatId)) {
    groups.set(chatId, {
      chatId, title, type,
      ownerId: null, ownerUsername: '',
      addedBy, addedByUsername,
      addedAt: new Date(),
      members: new Map(),
      admins: new Map(),
      warns: new Map(),
      maxWarns: 3,
      welcomeMessage: '👋 مرحباً {name} في {group}!\nنتمنى لك وقتاً ممتعاً.',
      welcomeEnabled: true,
      antiSpam: false,
      muteNewMembers: false,
      mutedUsers: new Set(),
      bannedUsers: new Set(),
      bannedWords: [],
      wordViolations: new Map(),
      joinRequests: new Map(),
      joinRequestsEnabled: false,
      rules: '',
      communityId: null,
    });
  }
  return groups.get(chatId);
}

function deleteGroup(chatId) { groups.delete(chatId); }
function allGroups() { return [...groups.values()]; }

// ════════ القنوات ════════════════════════════════════════════

function getChannel(chatId) { return channels.get(chatId) || null; }

function getOrCreateChannel(chatId, title, username, addedBy, addedByUsername) {
  if (!channels.has(chatId)) {
    channels.set(chatId, {
      chatId, title,
      username: username || '',
      addedBy, addedByUsername,
      addedAt: new Date(),
      subscribers: new Map(),
      ownerId: null, ownerUsername: '',
    });
  }
  return channels.get(chatId);
}

function deleteChannel(chatId) { channels.delete(chatId); }
function allChannels() { return [...channels.values()]; }

// ════════ تتبع الأعضاء ══════════════════════════════════════

function trackMember(chatId, userId, username, firstName, role) {
  const g = groups.get(chatId);
  if (!g) return;
  g.members.set(userId, {
    userId,
    username: username || '',
    firstName: firstName || String(userId),
    role: role || 'member',
    joinedAt: new Date(),
    messageCount: 0,
  });
}

// ════════ المستخدمون ════════════════════════════════════════

function getOrCreateUser(userId, username, firstName) {
  if (!users.has(userId)) {
    users.set(userId, {
      userId,
      username: username || '',
      firstName: firstName || '',
      globalBanned: false,
      bannedReason: '',
      bannedAt: null,
      firstSeen: new Date(),
      groups: new Set(),
      channels: new Set(),
    });
  }
  return users.get(userId);
}

function getUser(userId) { return users.get(userId) || null; }
function allUsers() { return [...users.values()]; }

// ════════ المجتمعات ══════════════════════════════════════════

function getOrCreateCommunity(communityId, title) {
  if (!communities.has(communityId)) {
    communities.set(communityId, {
      communityId, title,
      subGroups: new Set(),
      memberJoins: new Map(),
      maxGroupJoins: 1,
      enabled: true,
    });
  }
  return communities.get(communityId);
}

function getCommunity(communityId) { return communities.get(communityId) || null; }
function allCommunities() { return [...communities.values()]; }

function recordCommunityJoin(communityId, userId, chatId) {
  const c = communities.get(communityId);
  if (!c || !c.enabled) return false;
  if (!c.memberJoins.has(userId)) c.memberJoins.set(userId, new Set());
  const joined = c.memberJoins.get(userId);
  joined.add(chatId);
  return joined.size > c.maxGroupJoins;
}

// ════════ انتهاكات الكلمات ═══════════════════════════════════

function recordWordViolation(chatId, userId, word) {
  const g = groups.get(chatId);
  if (!g) return 0;
  if (!g.wordViolations.has(userId)) g.wordViolations.set(userId, {});
  const vio = g.wordViolations.get(userId);
  vio[word] = (vio[word] || 0) + 1;
  return vio[word];
}

function resetWordViolation(chatId, userId, word) {
  const g = groups.get(chatId);
  if (!g) return;
  const vio = g.wordViolations.get(userId);
  if (vio) delete vio[word];
}

// ════════ إحصائيات ══════════════════════════════════════════

function getStats() {
  return {
    totalGroups:   groups.size,
    totalChannels: channels.size,
    totalUsers:    users.size,
    bannedUsers:   [...users.values()].filter(u => u.globalBanned).length,
    totalAdmins:   [...groups.values()].reduce((a, g) => a + g.admins.size, 0),
    totalWarns:    [...groups.values()].reduce((a, g) =>
      a + [...g.warns.values()].reduce((b, w) => b + w.length, 0), 0),
    pendingReqs:   [...groups.values()].reduce((a, g) =>
      a + [...g.joinRequests.values()].filter(r => r.status === 'pending').length, 0),
  };
}

module.exports = {
  getGroup, getOrCreateGroup, deleteGroup, allGroups,
  getChannel, getOrCreateChannel, deleteChannel, allChannels,
  trackMember,
  getOrCreateUser, getUser, allUsers,
  getOrCreateCommunity, getCommunity, allCommunities, recordCommunityJoin,
  recordWordViolation, resetWordViolation,
  getStats,
};
