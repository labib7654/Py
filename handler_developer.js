const setupPanelHandlers      = require('./handler_developer_panel');
const setupModerationHandlers = require('./handler_developer_moderation');
const setupChannelsHandlers   = require('./handler_developer_channels');
const setupBackupHandlers     = require('./handler_developer_backup');

module.exports = function setupDeveloperHandlers(bot) {
  setupPanelHandlers(bot);
  setupModerationHandlers(bot);
  setupChannelsHandlers(bot);
  setupBackupHandlers(bot);
};
