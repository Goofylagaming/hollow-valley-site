import { sendRcon } from './rcon.js';

export default async function handler(req, res) {
    try {
        const { steamid } = req.query;

        const result = await sendRcon(`getplayerdata ${steamid}`);

        res.json({ success: true, data: result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
}