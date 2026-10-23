FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
    && apt-get install -y --no-install-recommends bubblewrap chromium ca-certificates fonts-noto-core \
    && rm -rf /var/lib/apt/lists/*

# The Codex SDK invokes its paired CLI executable. Keep the tested CLI pinned.
RUN npm install --global @openai/codex@0.163.0

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV HOST=0.0.0.0 \
    PORT=3000 \
    NEGAHBAN_DATA=/data \
    LIVE_CHROMIUM=/usr/bin/chromium

EXPOSE 3000
CMD ["npm", "run", "start"]
