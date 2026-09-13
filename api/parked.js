import { sendRcon } from './rcon.js';

export default async function handler(req, res) {
    try {
        const result = await sendRcon("listparked");

        res.json({ success: true, data: result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
}