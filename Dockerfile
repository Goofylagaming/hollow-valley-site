FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY server ./server
COPY public ./public
COPY landing ./landing
COPY mydinos ./mydinos

# Syntax errors must fail the image build, not the production application startup.
RUN node --check server/index.js

ENV NODE_ENV=production
ENV PORT=3000
VOLUME ["/app/data"]

EXPOSE 3000
CMD ["node", "server/index.js"]
