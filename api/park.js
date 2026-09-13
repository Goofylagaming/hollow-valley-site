import { sendRcon } from './rcon.js';

export default async function handler(req, res) {
    try {
        const { steamid } = req.body;

        const result = await sendRcon(`park ${steamid}`);

        res.json({ success: true, rcon: result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
}