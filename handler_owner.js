const setupSettingsHandlers  = require('./handler_owner_settings');
const setupWordsHandlers     = require('./handler_owner_words');
const setupTopicsHandlers    = require('./handler_owner_topics');
const setupSpecialistHandlers = require('./handler_owner_specialist');

module.exports = function setupOwnerHandlers(bot) {
  setupSettingsHandlers(bot);
  setupWordsHandlers(bot);
  setupTopicsHandlers(bot);
  setupSpecialistHandlers(bot);
};
