const net = require("node:net");

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
    const ip = process.env.RCON_IP || process.env.RCON_HOST || "103.193.81.65";
    const port = Number.parseInt(process.env.RCON_PORT || "5569", 10);
    const password = process.env.RCON_PASSWORD || "testingrconpassword";

    if (RconModule) {
      const rcon = new RconModule(ip, port, password, { tcp: true, challenge: false });

      let settled = false;
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          try { rcon.disconnect(); } catch (e) {}
          reject(new Error("RCON execution timeout"));
        }
      }, 10000);

      rcon.on("auth", () => {
        rcon.send(command);
      });

      rcon.on("response", (str) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          resolve(str);
          try { rcon.disconnect(); } catch (e) {}
        }
      });

      rcon.on("error", (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          try { rcon.disconnect(); } catch (e) {}
          reject(err);
        }
      });

      try {
        rcon.connect();
      } catch (err) {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(err);
        }
      }
      return;
    }

    // Native TCP Socket Fallback for Evrima binary wire format
    const socket = new net.Socket();
    let settled = false;

    const cleanup = () => {
      if (settled) return;
      settled = true;
      socket.destroy();
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("RCON socket connection timeout"));
    }, 10000);

    socket.once("error", (err) => {
      cleanup();
      clearTimeout(timer);
      reject(err);
    });

    socket.connect(port, ip, () => {
      const authPacket = `\x01${password}\x00`;
      socket.write(authPacket, "latin1");

      socket.once("data", (authChunk) => {
        const authStr = authChunk.toString("latin1");
        if (!authStr.includes("Password Accepted")) {
          cleanup();
          clearTimeout(timer);
          return reject(new Error("RCON authentication failed"));
        }

        const cmdPacket = `\x02${command}\x00`;
        let responseStr = "";

        const onData = (chunk) => {
          responseStr += chunk.toString("latin1");
        };

        socket.on("data", onData);
        socket.write(cmdPacket, "latin1");

        setTimeout(() => {
          cleanup();
          clearTimeout(timer);
          resolve(responseStr || "OK");
        }, 1200);
      });
    });
  });
}

module.exports = {
  sendRcon,
};
module.exports.default = { sendRcon };
