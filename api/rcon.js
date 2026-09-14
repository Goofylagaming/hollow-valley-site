let RconModule = null;
try {
  RconModule = require("rcon");
} catch (e) {
  // rcon module will be installed via npm during container build
}

/**
 * Sends an RCON command to the game server.
 * @param {string} command - The RCON command to execute (e.g. "park 76561198038977506" or "getplayerdata 76561198038977506")
 * @returns {Promise<string>} RCON response text
 */
function sendRcon(command) {
  return new Promise((resolve, reject) => {
    const ip = process.env.RCON_IP || process.env.RCON_HOST;
    const port = Number.parseInt(process.env.RCON_PORT || "", 10);
    const password = process.env.RCON_PASSWORD;

    if (!ip || !Number.isFinite(port) || !password) {
      reject(new Error("RCON is not configured"));
      return;
    }

    if (!RconModule) {
      reject(new Error("rcon dependency is not installed"));
      return;
    }

    const rcon = new RconModule(ip, port, password, { tcp: true, challenge: false });
    let settled = false;

    const clearTimer = (timer) => {
      clearTimeout(timer);
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      clearTimer(timer);
      try { rcon.disconnect(); } catch (e) {}
      reject(new Error("RCON execution timeout"));
    }, 10000);

    rcon.on("auth", () => {
      rcon.send(command);
    });

    rcon.on("response", (str) => {
      if (settled) return;
      settled = true;
      clearTimer(timer);
      try { rcon.disconnect(); } catch (e) {}
      resolve(str);
    });

    rcon.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimer(timer);
      try { rcon.disconnect(); } catch (e) {}
      reject(err);
    });

    try {
      rcon.connect();
    } catch (err) {
      if (settled) return;
      settled = true;
      clearTimer(timer);
      reject(err);
    }
  });
}

module.exports = {
  sendRcon,
};
module.exports.default = { sendRcon };
