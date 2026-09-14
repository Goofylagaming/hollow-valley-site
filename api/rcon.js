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
    let settled = false;

    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      rcon.removeListener("auth", onAuth);
      rcon.removeListener("response", onResponse);
      rcon.removeListener("error", onError);
      fn(value);
    };

    const onAuth = () => {
      rcon.send(command);
    };

    const onResponse = (str) => {
      rcon.disconnect();
      settle(resolve, str);
    };

    const onError = (err) => {
      settle(reject, err);
    };

    rcon.on("auth", onAuth);
    rcon.on("response", onResponse);
    rcon.on("error", onError);

    rcon.connect();
  });
}

module.exports = { sendRcon };