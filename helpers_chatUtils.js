// FEATURE 1: نظام تمييز نوع الكيان

async function detectChatType(bot, chatId) {
  try {
    const chat = await bot.telegram.getChat(chatId);
    // chat.type: 'supergroup' | 'channel' | 'group'
    // chat.is_forum: true إذا فعّل المواضيع
    // chat.linked_chat_id: إذا كانت مرتبطة بقناة

    if (chat.type === 'channel') return { type: 'channel', raw: chat };
    if (chat.type === 'supergroup' && chat.is_forum) {
      if (chat.linked_chat_id) return { type: 'community', linkedChannel: chat.linked_chat_id, raw: chat };
      return { type: 'supergroup_forum', raw: chat };
    }
    return { type: 'supergroup', raw: chat };
  } catch (e) {
    return { type: 'unknown', error: e.message };
  }
}

// أيقونة نوع الكيان للعرض
function chatTypeIcon(typeInfo) {
  const icons = {
    channel:          '📢',
    supergroup:       '👥',
    supergroup_forum: '🧵',
    community:        '🏛️',
    unknown:          '❓',
  };
  return icons[typeInfo?.type] || '❓';
}

module.exports = { detectChatType, chatTypeIcon };
