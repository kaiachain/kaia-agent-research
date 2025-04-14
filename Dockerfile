FROM node:20-slim

# Install dependencies for Puppeteer
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    procps \
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

# Create app directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy application code
COPY . .

# Create data directory for persistent storage
RUN mkdir -p src/data

# Create volume mount points for persisting data
VOLUME ["/app/src/data/delphi_cookies.json", "/app/src/data/visited_links.json", "/app/src/data/processed_reports_cache.json", "/app/src/data/backups"]

# Set environment variables
ENV NODE_ENV=production \
    COOKIES_FILE=/app/src/data/delphi_cookies.json \
    CACHE_FILE=/app/src/data/processed_reports_cache.json \
    VISITED_LINKS_FILE=/app/src/data/visited_links.json \
    BACKUPS_DIR=/app/src/data/backups

# Run the application
CMD ["node", "src/scripts/summarize.js"] 