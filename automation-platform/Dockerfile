FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY src ./src
COPY public ./public
COPY .env.example ./.env.example

RUN mkdir -p /app/data

EXPOSE 3100

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:${PORT:-3100}/health >/dev/null 2>&1 || exit 1

CMD ["node", "src/index.js"]
