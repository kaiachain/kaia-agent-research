FROM node:20-slim

# Install Chromium and dependencies
RUN apt-get update && apt-get install -y \
    vim \
    wget \
    gnupg \
    ca-certificates \
    procps \
    curl \
    chromium \
    libx11-xcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxi6 \
    libxtst6 \
    libnss3 \
    libcups2 \
    libxss1 \
    libxrandr2 \
    libglib2.0-0 \
    libasound2 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libpangocairo-1.0-0 \
    libgtk-3-0 \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

# Create app directory and ensure proper permissions
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Create necessary directories and set permissions
RUN mkdir -p /app/data && \
    chown -R node:node /app/data

# Set environment variables
ENV NODE_ENV=production \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    PUPPETEER_ARGS=--no-sandbox,--disable-setuid-sandbox,--disable-dev-shm-usage,--disable-gpu,--headless=new,--no-first-run,--no-zygote \
    DEFAULT_NAVIGATION_TIMEOUT=120000 \
    DEFAULT_TIMEOUT=90000 \
    TZ=UTC

# Switch to non-root user
USER node

# Default command (can be overridden by docker-compose)
CMD ["npm", "run", "delphi:run"] 