FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY server ./server
COPY public ./public
COPY api ./api
COPY landing ./landing
COPY mydinos ./mydinos

ENV NODE_ENV=production
ENV PORT=3000
VOLUME ["/app/data"]

EXPOSE 3000
CMD ["node", "server/index.js"]
