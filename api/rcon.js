import Rcon from 'rcon';

export function sendRcon(command) {
    return new Promise((resolve, reject) => {
        const rcon = new Rcon(
            process.env.RCON_IP,
            parseInt(process.env.RCON_PORT),
            process.env.RCON_PASSWORD
        );

        rcon.on('auth', () => {
            rcon.send(command);
        });

        rcon.on('response', (str) => {
            resolve(str);
            rcon.disconnect();
        });

        rcon.on('error', reject);

        rcon.connect();
    });
}