import { sendRcon } from './rcon.js';

const COMMANDS = [
    "spawnparked",
    "loadparked",
    "restore",
    "spawn"
];

export default async function handler(req, res) {
    try {
        const { steamid } = req.body;

        for (const cmd of COMMANDS) {
            const result = await sendRcon(`${cmd} ${steamid}`);

            if (
                result &&
                !result.toLowerCase().includes("unknown") &&
                !result.toLowerCase().includes("invalid")
            ) {
                return res.json({
                    success: true,
                    message: `Redeemed using: ${cmd}`,
                    rcon: result
                });
            }
        }

        res.json({ success: false, error: "No redeem command worked." });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
}