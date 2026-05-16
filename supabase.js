// supabase.js — in-memory store (بدون Supabase)
// جامعة v5.0 — كل البيانات في الذاكرة، backup/restore عبر JSON

const fs = require('fs');
const path = require('path');
const DATA_FILE = path.join(__dirname, 'data.json');

let _nextId = 1;
function nextId() { return _nextId++; }

// ── الجداول في الذاكرة ────────────────────────────────────────
const store = {
  groups:                 new Map(),
  group_members:          new Map(), // key: `${chatId}_${userId}`
  group_admins:           new Map(), // key: `${chatId}_${userId}`
  warns:                  [],
  restrictions:           new Map(), // key: `${chatId}_${userId}_${type}`
  banned_words:           [],
  word_violations:        new Map(), // key: `${chatId}_${userId}_${word}`
  join_requests:          new Map(), // key: `${chatId}_${userId}`
  join_request_cooldowns: new Map(), // key: `${chatId}_${userId}`
  audit_log:              [],
  users:                  new Map(),
  channels:               new Map(),
  communities:            new Map(),
  community_groups:       new Map(), // key: `${communityId}_${chatId}`
  community_member_joins: new Map(), // key: `${communityId}_${userId}`
  specialists:            new Map(), // key: `${chatId}_${userId}`
  routing_keywords:       new Map(), // key: `${chatId}_${keyword}`
  specialist_sessions:    [],
  pending_captcha:        new Map(), // key: `${chatId}_${userId}`
  reports:                [],
};

// stub للتوافق مع أي كود يصل supabase.supabase مباشرة
const supabase = { from: () => ({ select: () => Promise.resolve({ data: [], error: null }) }) };

// ═══════════════════════════════════════════
//  BACKUP & RESTORE
// ═══════════════════════════════════════════

function createBackup() {
  return {
    generated_at: new Date().toISOString(),
    version: '5.0',
    _nextId,
    store: {
      groups:                 [...store.groups.entries()],
      group_members:          [...store.group_members.entries()],
      group_admins:           [...store.group_admins.entries()],
      warns:                  store.warns,
      restrictions:           [...store.restrictions.entries()],
      banned_words:           store.banned_words,
      word_violations:        [...store.word_violations.entries()],
      join_requests:          [...store.join_requests.entries()],
      join_request_cooldowns: [...store.join_request_cooldowns.entries()],
      audit_log:              store.audit_log.slice(0, 200),
      users:                  [...store.users.entries()],
      channels:               [...store.channels.entries()],
      communities:            [...store.communities.entries()],
      community_groups:       [...store.community_groups.entries()],
      community_member_joins: [...store.community_member_joins.entries()],
      specialists:            [...store.specialists.entries()],
      routing_keywords:       [...store.routing_keywords.entries()],
      specialist_sessions:    store.specialist_sessions,
      pending_captcha:        [...store.pending_captcha.entries()],
      reports:                store.reports,
    },
  };
}

function restoreFromBackup(data) {
  if (!data || !data.store) throw new Error('بيانات النسخة الاحتياطية غير صحيحة');
  if (data._nextId) _nextId = data._nextId;
  const s = data.store;
  const toMap = (arr) => new Map(arr || []);
  store.groups                 = toMap(s.groups);
  store.group_members          = toMap(s.group_members);
  store.group_admins           = toMap(s.group_admins);
  store.warns                  = s.warns || [];
  store.restrictions           = toMap(s.restrictions);
  store.banned_words           = s.banned_words || [];
  store.word_violations        = toMap(s.word_violations);
  store.join_requests          = toMap(s.join_requests);
  store.join_request_cooldowns = toMap(s.join_request_cooldowns);
  store.audit_log              = s.audit_log || [];
  store.users                  = toMap(s.users);
  store.channels               = toMap(s.channels);
  store.communities            = toMap(s.communities);
  store.community_groups       = toMap(s.community_groups);
  store.community_member_joins = toMap(s.community_member_joins);
  store.specialists            = toMap(s.specialists);
  store.routing_keywords       = toMap(s.routing_keywords);
  store.specialist_sessions    = s.specialist_sessions || [];
  store.pending_captcha        = toMap(s.pending_captcha);
  store.reports                = s.reports || [];
}

function saveToFile() {
  try {
    const backup = createBackup();
    fs.writeFileSync(DATA_FILE, JSON.stringify(backup), 'utf8');
  } catch (e) { console.error('saveToFile error:', e.message); }
}

function loadFromFile() {
  try {
    if (!fs.existsSync(DATA_FILE)) return false;
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    restoreFromBackup(data);
    console.log('✅ تم تحميل البيانات من data.json');
    return true;
  } catch (e) { console.error('loadFromFile error:', e.message); return false; }
}

// حفظ تلقائي كل 5 دقائق
setInterval(saveToFile, 5 * 60 * 1000);

// ═══════════════════════════════════════════
//  GROUPS
// ═══════════════════════════════════════════

function getGroup(chatId) {
  return Promise.resolve(store.groups.get(chatId) || null);
}

function upsertGroup(chatId, fields) {
  const existing = store.groups.get(chatId) || { chat_id: chatId };
  store.groups.set(chatId, { ...existing, ...fields, chat_id: chatId, updated_at: new Date().toISOString() });
  return Promise.resolve(store.groups.get(chatId));
}

function getAllGroups() {
  return Promise.resolve([...store.groups.values()]);
}

function deleteGroup(chatId) {
  store.groups.delete(chatId);
  return Promise.resolve();
}

// ═══════════════════════════════════════════
//  MEMBERS
// ═══════════════════════════════════════════

function getMember(chatId, userId) {
  return Promise.resolve(store.group_members.get(`${chatId}_${userId}`) || null);
}

function upsertMember(chatId, userId, fields) {
  const key = `${chatId}_${userId}`;
  const existing = store.group_members.get(key) || { chat_id: chatId, user_id: userId, message_count: 0, score: 0 };
  store.group_members.set(key, { ...existing, ...fields, chat_id: chatId, user_id: userId });
  return Promise.resolve();
}

async function incrementMessageCount(chatId, userId, username, firstName) {
  const key = `${chatId}_${userId}`;
  const existing = store.group_members.get(key);
  if (!existing) {
    store.group_members.set(key, { chat_id: chatId, user_id: userId, username: username || '', first_name: firstName || '', message_count: 1, score: 1, last_message_at: new Date().toISOString() });
  } else {
    existing.message_count = (existing.message_count || 0) + 1;
    existing.score         = (existing.score || 0) + 1;
    existing.last_message_at = new Date().toISOString();
    if (username)  existing.username   = username;
    if (firstName) existing.first_name = firstName;
  }
}

function getTopMembers(chatId, limit = 10) {
  const members = [...store.group_members.values()]
    .filter(m => m.chat_id === chatId)
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, limit);
  return Promise.resolve(members);
}

function getAllMembers(chatId) {
  return Promise.resolve([...store.group_members.values()].filter(m => m.chat_id === chatId));
}

function getMemberRank(chatId, userId) {
  const sorted = [...store.group_members.values()]
    .filter(m => m.chat_id === chatId)
    .sort((a, b) => (b.score || 0) - (a.score || 0));
  const rank = sorted.findIndex(m => m.user_id === userId) + 1;
  return Promise.resolve(rank > 0 ? rank : null);
}

// ═══════════════════════════════════════════
//  ADMINS
// ═══════════════════════════════════════════

function getGroupAdmins(chatId) {
  return Promise.resolve([...store.group_admins.values()].filter(a => a.chat_id === chatId));
}

function addAdmin(chatId, userId, fields) {
  const key = `${chatId}_${userId}`;
  const existing = store.group_admins.get(key) || { chat_id: chatId, user_id: userId };
  store.group_admins.set(key, { ...existing, ...fields, chat_id: chatId, user_id: userId });
  return Promise.resolve();
}

function removeAdmin(chatId, userId) {
  store.group_admins.delete(`${chatId}_${userId}`);
  return Promise.resolve();
}

function isAdminInDB(chatId, userId) {
  return Promise.resolve(store.group_admins.has(`${chatId}_${userId}`));
}

// ═══════════════════════════════════════════
//  WARNS
// ═══════════════════════════════════════════

function addWarn(chatId, userId, reason, warnedBy) {
  const warn = { id: nextId(), chat_id: chatId, user_id: userId, reason: reason || '', warned_by: warnedBy || 0, warned_at: new Date().toISOString() };
  store.warns.push(warn);
  return Promise.resolve(warn);
}

function getWarns(chatId, userId) {
  return Promise.resolve(store.warns.filter(w => w.chat_id === chatId && w.user_id === userId));
}

function clearWarns(chatId, userId) {
  store.warns = store.warns.filter(w => !(w.chat_id === chatId && w.user_id === userId));
  return Promise.resolve();
}

function getWarnCount(chatId, userId) {
  return Promise.resolve(store.warns.filter(w => w.chat_id === chatId && w.user_id === userId).length);
}

function getAllWarns() {
  return Promise.resolve([...store.warns]);
}

// ═══════════════════════════════════════════
//  RESTRICTIONS
// ═══════════════════════════════════════════

function addRestriction(chatId, userId, type, untilDate, byUserId) {
  const key = `${chatId}_${userId}_${type}`;
  store.restrictions.set(key, { chat_id: chatId, user_id: userId, type, until_date: untilDate, by_user_id: byUserId || 0, created_at: new Date().toISOString() });
  return Promise.resolve();
}

function removeRestriction(chatId, userId, type) {
  store.restrictions.delete(`${chatId}_${userId}_${type}`);
  return Promise.resolve();
}

function getActiveRestrictions(chatId, userId) {
  const results = [...store.restrictions.values()].filter(r => r.chat_id === chatId && r.user_id === userId);
  return Promise.resolve(results);
}

function getExpiredRestrictions() {
  const now = new Date().toISOString();
  const results = [...store.restrictions.values()].filter(r => r.until_date && r.until_date < now);
  return Promise.resolve(results);
}

// ═══════════════════════════════════════════
//  BANNED WORDS
// ═══════════════════════════════════════════

function getBannedWords(chatId) {
  return Promise.resolve(store.banned_words.filter(bw => bw.chat_id === chatId));
}

function getAllBannedWords() {
  return Promise.resolve([...store.banned_words]);
}

function addBannedWord(chatId, word, action, threshold, addedBy) {
  const lw = word.toLowerCase();
  const existing = store.banned_words.find(bw => bw.chat_id === chatId && bw.word === lw);
  if (existing) { existing.action = action; existing.threshold = threshold || 1; }
  else store.banned_words.push({ id: nextId(), chat_id: chatId, word: lw, action: action || 'warn', threshold: threshold || 1, added_by: addedBy || 0, added_at: new Date().toISOString() });
  return Promise.resolve();
}

function removeBannedWord(chatId, word) {
  const lw = word.toLowerCase();
  store.banned_words = store.banned_words.filter(bw => !(bw.chat_id === chatId && bw.word === lw));
  return Promise.resolve();
}

// ═══════════════════════════════════════════
//  WORD VIOLATIONS
// ═══════════════════════════════════════════

function getWordViolationCount(chatId, userId, word) {
  return Promise.resolve(store.word_violations.get(`${chatId}_${userId}_${word.toLowerCase()}`) || 0);
}

async function incrementWordViolation(chatId, userId, word) {
  const key = `${chatId}_${userId}_${word.toLowerCase()}`;
  const count = (store.word_violations.get(key) || 0) + 1;
  store.word_violations.set(key, count);
  return count;
}

function resetWordViolation(chatId, userId, word) {
  store.word_violations.delete(`${chatId}_${userId}_${word.toLowerCase()}`);
  return Promise.resolve();
}

// ═══════════════════════════════════════════
//  JOIN REQUESTS
// ═══════════════════════════════════════════

function addJoinRequest(chatId, userId, firstName, username, bio, inviteLink) {
  const key = `${chatId}_${userId}`;
  store.join_requests.set(key, { chat_id: chatId, user_id: userId, first_name: firstName || '', username: username || '', bio: bio || '', invite_link: inviteLink || '', status: 'pending', requested_at: new Date().toISOString() });
  return Promise.resolve();
}

function updateJoinRequest(chatId, userId, status, processedBy) {
  const key = `${chatId}_${userId}`;
  const r = store.join_requests.get(key);
  if (r) { r.status = status; r.processed_at = new Date().toISOString(); r.processed_by = processedBy; }
  return Promise.resolve();
}

function getPendingRequests(chatId) {
  const results = [...store.join_requests.values()].filter(r => r.chat_id === chatId && r.status === 'pending');
  return Promise.resolve(results);
}

function getJoinRequestCooldown(chatId, userId) {
  const val = store.join_request_cooldowns.get(`${chatId}_${userId}`);
  return Promise.resolve(val ? new Date(val).getTime() : null);
}

function setJoinRequestCooldown(chatId, userId, untilMs) {
  store.join_request_cooldowns.set(`${chatId}_${userId}`, new Date(untilMs).toISOString());
  return Promise.resolve();
}

// ═══════════════════════════════════════════
//  AUDIT LOG
// ═══════════════════════════════════════════

function addAuditLog(chatId, action, byUserId, byUsername, targetUserId, targetUsername, details) {
  store.audit_log.unshift({ id: nextId(), chat_id: chatId, action, by_user_id: byUserId || 0, by_username: byUsername || '', target_user_id: targetUserId || 0, target_username: targetUsername || '', details: details || '', created_at: new Date().toISOString() });
  if (store.audit_log.length > 500) store.audit_log.length = 500;
  return Promise.resolve();
}

function getAuditLog(chatId, limit = 20) {
  return Promise.resolve(store.audit_log.filter(l => l.chat_id === chatId).slice(0, limit));
}

// ═══════════════════════════════════════════
//  USERS
// ═══════════════════════════════════════════

function getUser(userId) {
  return Promise.resolve(store.users.get(userId) || null);
}

function upsertUser(userId, username, firstName) {
  const existing = store.users.get(userId) || { user_id: userId, global_banned: false, banned_reason: '', banned_at: null, first_seen: new Date().toISOString() };
  store.users.set(userId, { ...existing, username: username || existing.username || '', first_name: firstName || existing.first_name || '', last_seen: new Date().toISOString() });
  return Promise.resolve(store.users.get(userId));
}

function setGlobalBan(userId, banned, reason) {
  const existing = store.users.get(userId) || { user_id: userId, username: '', first_name: '', first_seen: new Date().toISOString() };
  store.users.set(userId, { ...existing, global_banned: banned, banned_reason: reason || '', banned_at: banned ? new Date().toISOString() : null });
  return Promise.resolve();
}

function getAllUsers() {
  return Promise.resolve([...store.users.values()]);
}

function getGlobalBannedUsers() {
  return Promise.resolve([...store.users.values()].filter(u => u.global_banned));
}

// ═══════════════════════════════════════════
//  CHANNELS
// ═══════════════════════════════════════════

function upsertChannel(chatId, fields) {
  const existing = store.channels.get(chatId) || { chat_id: chatId };
  store.channels.set(chatId, { ...existing, ...fields, chat_id: chatId });
  return Promise.resolve();
}

function getAllChannels() {
  return Promise.resolve([...store.channels.values()]);
}

function deleteChannel(chatId) {
  store.channels.delete(chatId);
  return Promise.resolve();
}

// ═══════════════════════════════════════════
//  COMMUNITIES
// ═══════════════════════════════════════════

function getCommunity(communityId) {
  return Promise.resolve(store.communities.get(communityId) || null);
}

function upsertCommunity(communityId, title, maxGroupJoins, enabled) {
  const existing = store.communities.get(communityId) || { community_id: communityId };
  store.communities.set(communityId, { ...existing, community_id: communityId, title: title || '', max_group_joins: maxGroupJoins || 1, enabled: enabled !== false });
  return Promise.resolve();
}

function getAllCommunities() {
  return Promise.resolve([...store.communities.values()]);
}

function addCommunityGroup(communityId, chatId) {
  store.community_groups.set(`${communityId}_${chatId}`, { community_id: communityId, chat_id: chatId });
  return Promise.resolve();
}

function getCommunityGroups(communityId) {
  const results = [...store.community_groups.values()].filter(r => r.community_id === communityId).map(r => r.chat_id);
  return Promise.resolve(results);
}

async function recordCommunityJoin(communityId, userId, chatId) {
  const key = `${communityId}_${userId}`;
  const existing = store.community_member_joins.get(key) || { community_id: communityId, user_id: userId, chat_ids: [] };
  if (!existing.chat_ids.includes(chatId)) existing.chat_ids.push(chatId);
  store.community_member_joins.set(key, existing);
  const com = store.communities.get(communityId);
  return existing.chat_ids.length > (com?.max_group_joins || 1);
}

function getCommunityMemberJoins(communityId, userId) {
  const r = store.community_member_joins.get(`${communityId}_${userId}`);
  return Promise.resolve(r?.chat_ids || []);
}

// ═══════════════════════════════════════════
//  SPECIALISTS
// ═══════════════════════════════════════════

function addSpecialist(chatId, userId, username, firstName, specialty, addedBy) {
  store.specialists.set(`${chatId}_${userId}`, { chat_id: chatId, user_id: userId, username: username || '', first_name: firstName || '', specialty: specialty || '', added_by: addedBy, is_active: true });
  return Promise.resolve();
}

function removeSpecialist(chatId, userId) {
  store.specialists.delete(`${chatId}_${userId}`);
  return Promise.resolve();
}

function getSpecialists(chatId) {
  return Promise.resolve([...store.specialists.values()].filter(s => s.chat_id === chatId && s.is_active));
}

function getSpecialist(chatId, userId) {
  return Promise.resolve(store.specialists.get(`${chatId}_${userId}`) || null);
}

// ═══════════════════════════════════════════
//  ROUTING KEYWORDS
// ═══════════════════════════════════════════

function addRoutingKeyword(chatId, keyword, specialistId, addedBy) {
  const kw = keyword.toLowerCase().trim();
  store.routing_keywords.set(`${chatId}_${kw}`, { chat_id: chatId, keyword: kw, specialist_id: specialistId || null, added_by: addedBy });
  return Promise.resolve();
}

function removeRoutingKeyword(chatId, keyword) {
  store.routing_keywords.delete(`${chatId}_${keyword.toLowerCase().trim()}`);
  return Promise.resolve();
}

function getRoutingKeywords(chatId) {
  return Promise.resolve([...store.routing_keywords.values()].filter(k => k.chat_id === chatId));
}

async function findMatchingKeyword(chatId, messageText) {
  const keywords = await getRoutingKeywords(chatId);
  const lowerMsg = messageText.toLowerCase();
  for (const kw of keywords) { if (lowerMsg.includes(kw.keyword)) return kw; }
  return null;
}

// ═══════════════════════════════════════════
//  SPECIALIST SESSIONS
// ═══════════════════════════════════════════

function createSession(chatId, userId, specialistId, triggerKeyword, originalMessage) {
  const session = { id: nextId(), chat_id: chatId, user_id: userId, specialist_id: specialistId, trigger_keyword: triggerKeyword || '', original_message: (originalMessage || '').slice(0, 1000), status: 'active', created_at: new Date().toISOString() };
  store.specialist_sessions.push(session);
  return Promise.resolve(session);
}

function closeSession(sessionId) {
  const s = store.specialist_sessions.find(s => s.id === sessionId);
  if (s) { s.status = 'closed'; s.closed_at = new Date().toISOString(); }
  return Promise.resolve();
}

function getActiveSession(userId) {
  const results = store.specialist_sessions.filter(s => s.user_id === userId && s.status === 'active');
  return Promise.resolve(results.length ? results[results.length - 1] : null);
}

// ═══════════════════════════════════════════
//  CAPTCHA
// ═══════════════════════════════════════════

function setPendingCaptcha(chatId, userId, answer, messageId, expiresAt) {
  store.pending_captcha.set(`${chatId}_${userId}`, { chat_id: chatId, user_id: userId, answer: String(answer), message_id: messageId, expires_at: new Date(expiresAt).toISOString(), attempts: 0 });
  return Promise.resolve();
}

function getPendingCaptcha(chatId, userId) {
  return Promise.resolve(store.pending_captcha.get(`${chatId}_${userId}`) || null);
}

function incrementCaptchaAttempts(chatId, userId) {
  const c = store.pending_captcha.get(`${chatId}_${userId}`);
  if (c) c.attempts = (c.attempts || 0) + 1;
  return Promise.resolve();
}

function deletePendingCaptcha(chatId, userId) {
  store.pending_captcha.delete(`${chatId}_${userId}`);
  return Promise.resolve();
}

// ═══════════════════════════════════════════
//  REPORTS
// ═══════════════════════════════════════════

function addReport(chatId, reporterId, reportedUserId, messageId, reason) {
  const report = { id: nextId(), chat_id: chatId, reporter_id: reporterId, reported_user_id: reportedUserId, message_id: messageId || null, reason: reason || '', status: 'pending', created_at: new Date().toISOString() };
  store.reports.push(report);
  return Promise.resolve(report);
}

function getPendingReports(chatId) {
  return Promise.resolve(store.reports.filter(r => r.chat_id === chatId && r.status === 'pending'));
}

function updateReport(reportId, status) {
  const r = store.reports.find(r => r.id === reportId);
  if (r) r.status = status;
  return Promise.resolve();
}

// ═══════════════════════════════════════════
//  STATS
// ═══════════════════════════════════════════

function getStats() {
  return Promise.resolve({
    totalGroups:      store.groups.size,
    totalChannels:    store.channels.size,
    totalUsers:       store.users.size,
    bannedUsers:      [...store.users.values()].filter(u => u.global_banned).length,
    totalWarns:       store.warns.length,
    totalCommunities: store.communities.size,
    pendingReqs:      [...store.join_requests.values()].filter(r => r.status === 'pending').length,
  });
}

module.exports = {
  supabase,
  // Backup/Restore/File
  createBackup, restoreFromBackup, saveToFile, loadFromFile,
  // Groups
  getGroup, upsertGroup, getAllGroups, deleteGroup,
  // Members
  getMember, upsertMember, incrementMessageCount, getTopMembers, getAllMembers, getMemberRank,
  // Admins
  getGroupAdmins, addAdmin, removeAdmin, isAdminInDB,
  // Warns
  addWarn, getWarns, clearWarns, getWarnCount, getAllWarns,
  // Restrictions
  addRestriction, removeRestriction, getActiveRestrictions, getExpiredRestrictions,
  // Banned Words
  getBannedWords, getAllBannedWords, addBannedWord, removeBannedWord,
  // Word Violations
  getWordViolationCount, incrementWordViolation, resetWordViolation,
  // Join Requests
  addJoinRequest, updateJoinRequest, getPendingRequests,
  getJoinRequestCooldown, setJoinRequestCooldown,
  // Audit Log
  addAuditLog, getAuditLog,
  // Users
  getUser, upsertUser, setGlobalBan, getAllUsers, getGlobalBannedUsers,
  // Channels
  upsertChannel, getAllChannels, deleteChannel,
  // Communities
  getCommunity, upsertCommunity, getAllCommunities,
  addCommunityGroup, getCommunityGroups,
  recordCommunityJoin, getCommunityMemberJoins,
  // Specialists
  addSpecialist, removeSpecialist, getSpecialists, getSpecialist,
  // Routing Keywords
  addRoutingKeyword, removeRoutingKeyword, getRoutingKeywords, findMatchingKeyword,
  // Sessions
  createSession, closeSession, getActiveSession,
  // Captcha
  setPendingCaptcha, getPendingCaptcha, incrementCaptchaAttempts, deletePendingCaptcha,
  // Reports
  addReport, getPendingReports, updateReport,
  // Stats
  getStats,
};
