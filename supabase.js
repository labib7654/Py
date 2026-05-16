// supabase.js — عميل Supabase + كل دوال قاعدة البيانات
// جامعة v5.0
// ── إذا لم تُوجَد متغيرات Supabase → وضع الذاكرة فقط (بدون DB) ──
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const DB_ENABLED   = !!(SUPABASE_URL && SUPABASE_KEY);

if (!DB_ENABLED) {
  console.warn('⚠️  SUPABASE_URL / SUPABASE_SERVICE_KEY غير موجودَين — البوت يعمل بالذاكرة فقط (بيانات مؤقتة).');
}

// [FIX #4] stub يُعيد نتائج فارغة بدلاً من الإخفاق — تم تغطية كل chains بما فيها .not() و .lt()
const _emptyChain = {
  single:  async () => ({ data: null,  error: null }),
  order:   () => _emptyChain,
  limit:   async () => ({ data: [],    error: null }),
  not:     () => _emptyChain,
  lt:      () => _emptyChain,
  eq:      () => _emptyChain,
  select:  () => _emptyChain,
  insert:  () => _emptyChain,
  upsert:  () => _emptyChain,
  update:  () => _emptyChain,
  delete:  () => _emptyChain,
  data:    [],
  error:   null,
  count:   0,
};

const stubClient = {
  from: () => ({
    select: () => _emptyChain,
    insert: () => _emptyChain,
    upsert: () => _emptyChain,
    update: () => _emptyChain,
    delete: () => _emptyChain,
  }),
  rpc: async () => ({ data: null, error: null }),
};

let supabase = stubClient;
if (DB_ENABLED) {
  const { createClient } = require('@supabase/supabase-js');
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
}

// ═══════════════════════════════════════════
//  GROUPS
// ═══════════════════════════════════════════

async function getGroup(chatId) {
  try {
    const { data } = await supabase
      .from('groups').select('*').eq('chat_id', chatId).single();
    return data || null;
  } catch { return null; }
}

async function upsertGroup(chatId, fields) {
  try {
    const { data } = await supabase
      .from('groups')
      .upsert({ chat_id: chatId, ...fields, updated_at: new Date().toISOString() }, { onConflict: 'chat_id' })
      .select().single();
    return data;
  } catch (e) { console.error('upsertGroup error:', e.message); return null; }
}

async function getAllGroups() {
  try {
    const { data } = await supabase.from('groups').select('*');
    return data || [];
  } catch { return []; }
}

async function deleteGroup(chatId) {
  try { await supabase.from('groups').delete().eq('chat_id', chatId); } catch {}
}

// ═══════════════════════════════════════════
//  MEMBERS
// ═══════════════════════════════════════════

async function getMember(chatId, userId) {
  try {
    const { data } = await supabase
      .from('group_members').select('*')
      .eq('chat_id', chatId).eq('user_id', userId).single();
    return data || null;
  } catch { return null; }
}

async function upsertMember(chatId, userId, fields) {
  try {
    await supabase.from('group_members').upsert(
      { chat_id: chatId, user_id: userId, ...fields },
      { onConflict: 'chat_id,user_id' }
    );
  } catch (e) { console.error('upsertMember error:', e.message); }
}

// [FIX #1 + #5] incrementMessageCount: تأكد من وجود المجموعة أولاً قبل upsert الأعضاء
// واستخدام ignoreDuplicates: true حتى لا يُعيد كتابة score=0 عند conflict
async function incrementMessageCount(chatId, userId, username, firstName) {
  try {
    // تأكد أن المجموعة موجودة في groups (لتجنب Foreign Key violation)
    await supabase.from('groups').upsert(
      { chat_id: chatId, title: '', updated_at: new Date().toISOString() },
      { onConflict: 'chat_id', ignoreDuplicates: true }
    );
    // أدخل السجل فقط إذا لم يكن موجوداً (ignoreDuplicates: true) حتى لا يُصفَّر الـ score
    await supabase.from('group_members').upsert(
      {
        chat_id:         chatId,
        user_id:         userId,
        username:        username  || '',
        first_name:      firstName || '',
        last_message_at: new Date().toISOString(),
        message_count:   0,
        score:           0,
      },
      { onConflict: 'chat_id,user_id', ignoreDuplicates: true }
    );
    // بعد ضمان وجود السجل، نزيد الـ score و message_count بالـ rpc
    await supabase.rpc('increment_member_stats', { p_chat_id: chatId, p_user_id: userId });
    // تحديث last_message_at و username بشكل منفصل بعد الزيادة
    await supabase.from('group_members').update({
      username:        username  || '',
      first_name:      firstName || '',
      last_message_at: new Date().toISOString(),
    }).eq('chat_id', chatId).eq('user_id', userId);
  } catch (e) { console.error('incrementMessageCount error:', e.message); }
}

async function getTopMembers(chatId, limit = 10) {
  try {
    const { data } = await supabase
      .from('group_members').select('*')
      .eq('chat_id', chatId)
      .order('score', { ascending: false })
      .limit(limit);
    return data || [];
  } catch { return []; }
}

async function getAllMembers(chatId) {
  try {
    const { data } = await supabase
      .from('group_members').select('*').eq('chat_id', chatId);
    return data || [];
  } catch { return []; }
}

async function getMemberRank(chatId, userId) {
  try {
    const { data } = await supabase
      .from('group_members').select('user_id, score')
      .eq('chat_id', chatId)
      .order('score', { ascending: false });
    if (!data) return null;
    const rank = data.findIndex(m => m.user_id === userId) + 1;
    return rank > 0 ? rank : null;
  } catch { return null; }
}

// ═══════════════════════════════════════════
//  ADMINS
// ═══════════════════════════════════════════

async function getGroupAdmins(chatId) {
  try {
    const { data } = await supabase
      .from('group_admins').select('*').eq('chat_id', chatId);
    return data || [];
  } catch { return []; }
}

async function addAdmin(chatId, userId, fields) {
  try {
    await supabase.from('group_admins').upsert(
      { chat_id: chatId, user_id: userId, ...fields },
      { onConflict: 'chat_id,user_id' }
    );
  } catch (e) { console.error('addAdmin error:', e.message); }
}

async function removeAdmin(chatId, userId) {
  try {
    await supabase.from('group_admins').delete()
      .eq('chat_id', chatId).eq('user_id', userId);
  } catch {}
}

async function isAdminInDB(chatId, userId) {
  try {
    const { data } = await supabase
      .from('group_admins').select('user_id')
      .eq('chat_id', chatId).eq('user_id', userId).single();
    return !!data;
  } catch { return false; }
}

// ═══════════════════════════════════════════
//  WARNS
// ═══════════════════════════════════════════

async function addWarn(chatId, userId, reason, warnedBy) {
  try {
    const { data } = await supabase.from('warns').insert({
      chat_id: chatId, user_id: userId, reason, warned_by: warnedBy
    }).select().single();
    return data;
  } catch (e) { console.error('addWarn error:', e.message); return null; }
}

async function getWarns(chatId, userId) {
  try {
    const { data } = await supabase.from('warns').select('*')
      .eq('chat_id', chatId).eq('user_id', userId)
      .order('warned_at', { ascending: false });
    return data || [];
  } catch { return []; }
}

async function clearWarns(chatId, userId) {
  try {
    await supabase.from('warns').delete()
      .eq('chat_id', chatId).eq('user_id', userId);
  } catch {}
}

async function getWarnCount(chatId, userId) {
  try {
    const { count } = await supabase.from('warns').select('*', { count: 'exact', head: true })
      .eq('chat_id', chatId).eq('user_id', userId);
    return count || 0;
  } catch { return 0; }
}

// [FIX #2] دالة جديدة: جلب كل التحذيرات من Supabase للتحميل عند الـ startup
async function getAllWarns() {
  try {
    const { data } = await supabase.from('warns').select('*');
    return data || [];
  } catch (e) { console.error('getAllWarns error:', e.message); return []; }
}

// ═══════════════════════════════════════════
//  RESTRICTIONS (mute/ban)
// ═══════════════════════════════════════════

async function addRestriction(chatId, userId, type, untilDate, byUserId) {
  try {
    await supabase.from('restrictions').upsert(
      { chat_id: chatId, user_id: userId, type, until_date: untilDate, by_user_id: byUserId },
      { onConflict: 'chat_id,user_id,type' }
    );
  } catch (e) { console.error('addRestriction error:', e.message); }
}

async function removeRestriction(chatId, userId, type) {
  try {
    await supabase.from('restrictions').delete()
      .eq('chat_id', chatId).eq('user_id', userId).eq('type', type);
  } catch {}
}

async function getActiveRestrictions(chatId, userId) {
  try {
    const { data } = await supabase.from('restrictions').select('*')
      .eq('chat_id', chatId).eq('user_id', userId);
    return data || [];
  } catch { return []; }
}

async function getExpiredRestrictions() {
  try {
    const { data } = await supabase.from('restrictions').select('*')
      .lt('until_date', new Date().toISOString())
      .not('until_date', 'is', null);
    return data || [];
  } catch { return []; }
}

// ═══════════════════════════════════════════
//  BANNED WORDS
// ═══════════════════════════════════════════

async function getBannedWords(chatId) {
  try {
    const { data } = await supabase.from('banned_words').select('*').eq('chat_id', chatId);
    return data || [];
  } catch { return []; }
}

// [FIX #2] دالة جديدة: جلب كل الكلمات المحظورة من Supabase للتحميل عند الـ startup
async function getAllBannedWords() {
  try {
    const { data } = await supabase.from('banned_words').select('*');
    return data || [];
  } catch (e) { console.error('getAllBannedWords error:', e.message); return []; }
}

async function addBannedWord(chatId, word, action, threshold, addedBy) {
  try {
    await supabase.from('banned_words').upsert(
      { chat_id: chatId, word: word.toLowerCase(), action, threshold: threshold || 1, added_by: addedBy },
      { onConflict: 'chat_id,word' }
    );
  } catch (e) { console.error('addBannedWord error:', e.message); }
}

async function removeBannedWord(chatId, word) {
  try {
    await supabase.from('banned_words').delete()
      .eq('chat_id', chatId).eq('word', word.toLowerCase());
  } catch {}
}

// ═══════════════════════════════════════════
//  WORD VIOLATIONS
// ═══════════════════════════════════════════

async function getWordViolationCount(chatId, userId, word) {
  try {
    const { data } = await supabase.from('word_violations').select('count')
      .eq('chat_id', chatId).eq('user_id', userId).eq('word', word.toLowerCase()).single();
    return data?.count || 0;
  } catch { return 0; }
}

async function incrementWordViolation(chatId, userId, word) {
  try {
    const current = await getWordViolationCount(chatId, userId, word);
    const newCount = current + 1;
    await supabase.from('word_violations').upsert(
      { chat_id: chatId, user_id: userId, word: word.toLowerCase(), count: newCount },
      { onConflict: 'chat_id,user_id,word' }
    );
    return newCount;
  } catch { return 1; }
}

async function resetWordViolation(chatId, userId, word) {
  try {
    await supabase.from('word_violations').delete()
      .eq('chat_id', chatId).eq('user_id', userId).eq('word', word.toLowerCase());
  } catch {}
}

// ═══════════════════════════════════════════
//  JOIN REQUESTS
// ═══════════════════════════════════════════

async function addJoinRequest(chatId, userId, firstName, username, bio, inviteLink) {
  try {
    await supabase.from('join_requests').upsert(
      { chat_id: chatId, user_id: userId, first_name: firstName || '', username: username || '', bio: bio || '', invite_link: inviteLink || '', status: 'pending' },
      { onConflict: 'chat_id,user_id' }
    );
  } catch (e) { console.error('addJoinRequest error:', e.message); }
}

async function updateJoinRequest(chatId, userId, status, processedBy) {
  try {
    await supabase.from('join_requests').update({
      status, processed_at: new Date().toISOString(), processed_by: processedBy
    }).eq('chat_id', chatId).eq('user_id', userId);
  } catch {}
}

async function getPendingRequests(chatId) {
  try {
    const { data } = await supabase.from('join_requests').select('*')
      .eq('chat_id', chatId).eq('status', 'pending')
      .order('requested_at', { ascending: true });
    return data || [];
  } catch { return []; }
}

async function getJoinRequestCooldown(chatId, userId) {
  try {
    const { data } = await supabase.from('join_request_cooldowns').select('until_date')
      .eq('chat_id', chatId).eq('user_id', userId).single();
    return data?.until_date ? new Date(data.until_date).getTime() : null;
  } catch { return null; }
}

async function setJoinRequestCooldown(chatId, userId, untilMs) {
  try {
    await supabase.from('join_request_cooldowns').upsert(
      { chat_id: chatId, user_id: userId, until_date: new Date(untilMs).toISOString() },
      { onConflict: 'chat_id,user_id' }
    );
  } catch {}
}

// ═══════════════════════════════════════════
//  AUDIT LOG
// ═══════════════════════════════════════════

async function addAuditLog(chatId, action, byUserId, byUsername, targetUserId, targetUsername, details) {
  try {
    await supabase.from('audit_log').insert({
      chat_id: chatId, action,
      by_user_id: byUserId, by_username: byUsername || '',
      target_user_id: targetUserId, target_username: targetUsername || '',
      details: details || ''
    });
  } catch (e) { console.error('addAuditLog error:', e.message); }
}

async function getAuditLog(chatId, limit = 20) {
  try {
    const { data } = await supabase.from('audit_log').select('*')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: false })
      .limit(limit);
    return data || [];
  } catch { return []; }
}

// ═══════════════════════════════════════════
//  USERS
// ═══════════════════════════════════════════

async function getUser(userId) {
  try {
    const { data } = await supabase.from('users').select('*').eq('user_id', userId).single();
    return data || null;
  } catch { return null; }
}

async function upsertUser(userId, username, firstName) {
  try {
    const { data } = await supabase.from('users').upsert(
      { user_id: userId, username: username || '', first_name: firstName || '', last_seen: new Date().toISOString() },
      { onConflict: 'user_id' }
    ).select().single();
    return data;
  } catch (e) { console.error('upsertUser error:', e.message); return null; }
}

async function setGlobalBan(userId, banned, reason) {
  try {
    await supabase.from('users').upsert({
      user_id: userId,
      global_banned: banned,
      banned_reason: reason || '',
      banned_at: banned ? new Date().toISOString() : null
    }, { onConflict: 'user_id' });
  } catch (e) { console.error('setGlobalBan error:', e.message); }
}

async function getAllUsers() {
  try {
    const { data } = await supabase.from('users').select('*');
    return data || [];
  } catch { return []; }
}

async function getGlobalBannedUsers() {
  try {
    const { data } = await supabase.from('users').select('*').eq('global_banned', true);
    return data || [];
  } catch { return []; }
}

// ═══════════════════════════════════════════
//  CHANNELS
// ═══════════════════════════════════════════

async function upsertChannel(chatId, fields) {
  try {
    await supabase.from('channels').upsert(
      { chat_id: chatId, ...fields },
      { onConflict: 'chat_id' }
    );
  } catch (e) { console.error('upsertChannel error:', e.message); }
}

async function getAllChannels() {
  try {
    const { data } = await supabase.from('channels').select('*');
    return data || [];
  } catch { return []; }
}

async function deleteChannel(chatId) {
  try { await supabase.from('channels').delete().eq('chat_id', chatId); } catch {}
}

// ═══════════════════════════════════════════
//  COMMUNITIES
// ═══════════════════════════════════════════

async function getCommunity(communityId) {
  try {
    const { data } = await supabase.from('communities').select('*').eq('community_id', communityId).single();
    return data || null;
  } catch { return null; }
}

async function upsertCommunity(communityId, title, maxGroupJoins, enabled) {
  try {
    await supabase.from('communities').upsert(
      { community_id: communityId, title: title || '', max_group_joins: maxGroupJoins || 1, enabled: enabled !== false },
      { onConflict: 'community_id' }
    );
  } catch {}
}

async function getAllCommunities() {
  try {
    const { data } = await supabase.from('communities').select('*');
    return data || [];
  } catch { return []; }
}

async function addCommunityGroup(communityId, chatId) {
  try {
    await supabase.from('community_groups').upsert(
      { community_id: communityId, chat_id: chatId },
      { onConflict: 'community_id,chat_id' }
    );
  } catch {}
}

async function getCommunityGroups(communityId) {
  try {
    const { data } = await supabase.from('community_groups').select('chat_id').eq('community_id', communityId);
    return (data || []).map(r => r.chat_id);
  } catch { return []; }
}

async function recordCommunityJoin(communityId, userId, chatId) {
  try {
    const { data } = await supabase.from('community_member_joins').select('chat_ids')
      .eq('community_id', communityId).eq('user_id', userId).single();
    const chatIds = data?.chat_ids || [];
    if (!chatIds.includes(chatId)) chatIds.push(chatId);
    await supabase.from('community_member_joins').upsert(
      { community_id: communityId, user_id: userId, chat_ids: chatIds },
      { onConflict: 'community_id,user_id' }
    );
    const com = await getCommunity(communityId);
    return chatIds.length > (com?.max_group_joins || 1);
  } catch { return false; }
}

async function getCommunityMemberJoins(communityId, userId) {
  try {
    const { data } = await supabase.from('community_member_joins').select('chat_ids')
      .eq('community_id', communityId).eq('user_id', userId).single();
    return data?.chat_ids || [];
  } catch { return []; }
}

// ═══════════════════════════════════════════
//  SPECIALISTS (نظام المتخصصين)
// ═══════════════════════════════════════════

async function addSpecialist(chatId, userId, username, firstName, specialty, addedBy) {
  try {
    await supabase.from('specialists').upsert(
      { chat_id: chatId, user_id: userId, username: username || '', first_name: firstName || '', specialty: specialty || '', added_by: addedBy, is_active: true },
      { onConflict: 'chat_id,user_id' }
    );
  } catch (e) { console.error('addSpecialist error:', e.message); }
}

async function removeSpecialist(chatId, userId) {
  try {
    await supabase.from('specialists').delete()
      .eq('chat_id', chatId).eq('user_id', userId);
  } catch {}
}

async function getSpecialists(chatId) {
  try {
    const { data } = await supabase.from('specialists').select('*')
      .eq('chat_id', chatId).eq('is_active', true);
    return data || [];
  } catch { return []; }
}

async function getSpecialist(chatId, userId) {
  try {
    const { data } = await supabase.from('specialists').select('*')
      .eq('chat_id', chatId).eq('user_id', userId).single();
    return data || null;
  } catch { return null; }
}

// ═══════════════════════════════════════════
//  ROUTING KEYWORDS (كلمات التوجيه)
// ═══════════════════════════════════════════

async function addRoutingKeyword(chatId, keyword, specialistId, addedBy) {
  try {
    await supabase.from('routing_keywords').upsert(
      { chat_id: chatId, keyword: keyword.toLowerCase().trim(), specialist_id: specialistId || null, added_by: addedBy },
      { onConflict: 'chat_id,keyword' }
    );
  } catch (e) { console.error('addRoutingKeyword error:', e.message); }
}

async function removeRoutingKeyword(chatId, keyword) {
  try {
    await supabase.from('routing_keywords').delete()
      .eq('chat_id', chatId).eq('keyword', keyword.toLowerCase().trim());
  } catch {}
}

async function getRoutingKeywords(chatId) {
  try {
    const { data } = await supabase.from('routing_keywords').select('*').eq('chat_id', chatId);
    return data || [];
  } catch { return []; }
}

async function findMatchingKeyword(chatId, messageText) {
  try {
    const keywords = await getRoutingKeywords(chatId);
    const lowerMsg = messageText.toLowerCase();
    for (const kw of keywords) {
      if (lowerMsg.includes(kw.keyword)) return kw;
    }
    return null;
  } catch { return null; }
}

// ═══════════════════════════════════════════
//  SPECIALIST SESSIONS
// ═══════════════════════════════════════════

async function createSession(chatId, userId, specialistId, triggerKeyword, originalMessage) {
  try {
    const { data } = await supabase.from('specialist_sessions').insert({
      chat_id: chatId,
      user_id: userId,
      specialist_id: specialistId,
      trigger_keyword: triggerKeyword || '',
      original_message: (originalMessage || '').slice(0, 1000),
      status: 'active'
    }).select().single();
    return data;
  } catch (e) { console.error('createSession error:', e.message); return null; }
}

async function closeSession(sessionId) {
  try {
    await supabase.from('specialist_sessions').update({
      status: 'closed', closed_at: new Date().toISOString()
    }).eq('id', sessionId);
  } catch {}
}

async function getActiveSession(userId) {
  try {
    const { data } = await supabase.from('specialist_sessions').select('*')
      .eq('user_id', userId).eq('status', 'active')
      .order('created_at', { ascending: false }).limit(1).single();
    return data || null;
  } catch { return null; }
}

// ═══════════════════════════════════════════
//  CAPTCHA
// ═══════════════════════════════════════════

async function setPendingCaptcha(chatId, userId, answer, messageId, expiresAt) {
  try {
    await supabase.from('pending_captcha').upsert(
      { chat_id: chatId, user_id: userId, answer: String(answer), message_id: messageId, expires_at: new Date(expiresAt).toISOString(), attempts: 0 },
      { onConflict: 'chat_id,user_id' }
    );
  } catch (e) { console.error('setPendingCaptcha error:', e.message); }
}

async function getPendingCaptcha(chatId, userId) {
  try {
    const { data } = await supabase.from('pending_captcha').select('*')
      .eq('chat_id', chatId).eq('user_id', userId).single();
    return data || null;
  } catch { return null; }
}

async function incrementCaptchaAttempts(chatId, userId) {
  try {
    await supabase.rpc('increment_captcha_attempts', { p_chat_id: chatId, p_user_id: userId });
  } catch {}
}

async function deletePendingCaptcha(chatId, userId) {
  try {
    await supabase.from('pending_captcha').delete()
      .eq('chat_id', chatId).eq('user_id', userId);
  } catch {}
}

// ═══════════════════════════════════════════
//  REPORTS
// ═══════════════════════════════════════════

async function addReport(chatId, reporterId, reportedUserId, messageId, reason) {
  try {
    const { data } = await supabase.from('reports').insert({
      chat_id: chatId,
      reporter_id: reporterId,
      reported_user_id: reportedUserId,
      message_id: messageId || null,
      reason: reason || '',
      status: 'pending'
    }).select().single();
    return data;
  } catch (e) { console.error('addReport error:', e.message); return null; }
}

async function getPendingReports(chatId) {
  try {
    const { data } = await supabase.from('reports').select('*')
      .eq('chat_id', chatId).eq('status', 'pending')
      .order('created_at', { ascending: false });
    return data || [];
  } catch { return []; }
}

async function updateReport(reportId, status) {
  try {
    await supabase.from('reports').update({ status }).eq('id', reportId);
  } catch {}
}

// ═══════════════════════════════════════════
//  STATS
// ═══════════════════════════════════════════

async function getStats() {
  try {
    const [groups, channels, users, banned, warns, communities] = await Promise.all([
      supabase.from('groups').select('*', { count: 'exact', head: true }),
      supabase.from('channels').select('*', { count: 'exact', head: true }),
      supabase.from('users').select('*', { count: 'exact', head: true }),
      supabase.from('users').select('*', { count: 'exact', head: true }).eq('global_banned', true),
      supabase.from('warns').select('*', { count: 'exact', head: true }),
      supabase.from('communities').select('*', { count: 'exact', head: true }),
    ]);
    return {
      totalGroups:      groups.count      || 0,
      totalChannels:    channels.count    || 0,
      totalUsers:       users.count       || 0,
      bannedUsers:      banned.count      || 0,
      totalWarns:       warns.count       || 0,
      totalCommunities: communities.count || 0,
      pendingReqs:      0,
    };
  } catch (e) {
    console.error('getStats error:', e.message);
    return { totalGroups: 0, totalChannels: 0, totalUsers: 0, bannedUsers: 0, totalWarns: 0, totalCommunities: 0, pendingReqs: 0 };
  }
}

module.exports = {
  supabase,
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
