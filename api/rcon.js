const Rcon = require("rcon");

function sendRcon(command) {
  return new Promise((resolve, reject) => {
    const host = process.env.RCON_HOST || process.env.RCON_IP;
    const port = Number.parseInt(process.env.RCON_PORT, 10);
    const password = process.env.RCON_PASSWORD;

    if (!host || !Number.isFinite(port) || !password) {
      reject(new Error("RCON is not configured"));
      return;
    }

    const rcon = new Rcon(host, port, password);

    rcon.on("auth", () => {
      rcon.send(command);
    });

    rcon.on("response", (str) => {
      resolve(str);
      rcon.disconnect();
    });

    rcon.on("error", reject);

    rcon.connect();
  });
}

module.exports = { sendRcon };