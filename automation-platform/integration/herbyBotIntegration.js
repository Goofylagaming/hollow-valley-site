const { createHerbyBotAutomationBridge } = require('./herbyBotBridge');
const { attachHerbyBotCommands } = require('./herbyBotCommands');
const { attachHerbyBotTerritoryCommand } = require('./herbyBotTerritoryCommand');

function createHerbyBotIntegration({ client, api, autoRegisterCommands = true } = {}) {
  if (!client) throw new Error('Existing HerbyBot Discord client is required');

  const bridge = createHerbyBotAutomationBridge({ client, api });
  const commands = attachHerbyBotCommands({
    client,
    api,
    autoRegister: autoRegisterCommands,
  });
  const territoryCommand = attachHerbyBotTerritoryCommand({
    client,
    api,
    autoRegister: autoRegisterCommands,
  });

  let started = false;

  async function onReady() {
    if (started) return { started: false, reason: 'already-started' };
    started = true;

    bridge.start();
    let registration = { skipped: true };
    let territoryRegistration = { skipped: true };
    try {
      registration = await commands.register();
    } catch (error) {
      // Delivery can still operate even if command registration temporarily
      // fails. Surface the error to logs rather than killing HerbyBot.
      console.warn('[herbybot-commands]', error.message);
      registration = { skipped: false, error: error.message };
    }
    try {
      territoryRegistration = await territoryCommand.register();
    } catch (error) {
      console.warn('[herbybot-territory-command]', error.message);
      territoryRegistration = { skipped: false, error: error.message };
    }

    return {
      started: true,
      bridge: true,
      commands: registration,
      territoryCommand: territoryRegistration,
    };
  }

  function stop() {
    bridge.stop();
    started = false;
  }

  return {
    onReady,
    stop,
    pollOnce: bridge.pollOnce,
    commandHandler: commands.handler,
    territoryCommandHandler: territoryCommand.handler,
  };
}

module.exports = { createHerbyBotIntegration };
