// Confirmed against Hollow Valley's LogTheIsleChatData Global message format.
// The channel capture is deliberately generic until a Local sample is verified.
const DEFAULT_CHAT_LINE_PATTERN = String.raw`^\[[^\]]+\]\[[^\]]+\]LogTheIsleChatData: \[[^\]]+\] \[(?<channel>[^\]]+)\](?: \[GROUP-[^\]]+\])? (?<name>.+?) \[\d{17}\]: (?<message>.+)$`;

function createChatLineRegex(pattern = DEFAULT_CHAT_LINE_PATTERN) {
  const regex = new RegExp(pattern);
  if (!regex.source.includes('?<name>') || !regex.source.includes('?<message>') || !regex.source.includes('?<channel>')) {
    throw new Error('CHAT_LINE_PATTERN needs named name, message, and channel groups.');
  }
  return regex;
}

function parseChatLine(line, regex = createChatLineRegex()) {
  const match = regex.exec(line);
  regex.lastIndex = 0;
  if (!match?.groups?.name || !match.groups.message || !match.groups.channel) return null;
  return {
    name: match.groups.name.trim().slice(0, 80),
    message: match.groups.message.trim().slice(0, 500),
    channel: match.groups.channel.trim().slice(0, 32),
  };
}

module.exports = { DEFAULT_CHAT_LINE_PATTERN, createChatLineRegex, parseChatLine };
