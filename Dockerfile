# server/Dockerfile
FROM node:20-slim

# Chromium ve bağımlılıklar
RUN apt-get update && apt-get install -y \
  chromium \
  ca-certificates fonts-liberation \
  libasound2 libatk-bridge2.0-0 libatk1.0-0 libc6 libcairo2 libcups2 \
  libdbus-1-3 libexpat1 libfontconfig1 libglib2.0-0 libgtk-3-0 libnspr4 \
  libnss3 libu2f-udev libx11-6 libx11-xcb1 libxcb1 libxcomposite1 \
  libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 \
  libxrender1 libxss1 libxtst6 xdg-utils && rm -rf /var/lib/apt/lists/*

ENV CHROME_PATH=/usr/bin/chromium
ENV NODE_ENV=production

WORKDIR /app

# Eğer server için ayrı package.json yoksa bu iki satırı kendi yapına göre uyarlayabilirsin
COPY server/package*.json ./
RUN npm ci --only=production || npm ci

COPY server/ ./

EXPOSE 5001
CMD ["node", "server.js"]
