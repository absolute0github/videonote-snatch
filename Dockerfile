# Dockerfile for Railway deployment
FROM node:20-slim

# Install yt-dlp and dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    curl \
    ca-certificates \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Verify yt-dlp is installed
RUN yt-dlp --version

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install Node dependencies
RUN npm install --production

# Copy application code
COPY . .

# Expose port (Railway sets PORT env var)
EXPOSE 3000

# Start the server
CMD ["node", "transcript-server.js"]
