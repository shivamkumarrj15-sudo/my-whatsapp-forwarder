# Ultra-Lightweight 24/7 WhatsApp Bot Dockerfile
FROM node:22-slim

WORKDIR /app

# Install curl and system fonts for crisp canvas/image rendering
RUN apt-get update && apt-get install -y --no-install-recommends curl fonts-dejavu-core fonts-freefont-ttf fonts-noto-core fontconfig && rm -rf /var/lib/apt/lists/*

# Copy dependency definitions
COPY package*.json ./

# Install only production dependencies
RUN npm install --omit=dev --ignore-scripts --no-audit

# Copy bot code
COPY bot.js ./

# Create data directory for persistent auth state
RUN mkdir -p auth_info_baileys

EXPOSE 2785

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:2785/api/health || exit 1

CMD ["node", "bot.js"]
