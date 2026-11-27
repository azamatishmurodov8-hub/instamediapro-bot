FROM node:20-slim

# Install ffmpeg, curl, python3, python-is-python3, ca-certificates and yt-dlp
RUN apt-get update && apt-get install -y ffmpeg curl python3 python-is-python3 ca-certificates && \
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --omit=dev

# Copy project files
COPY . .

# Run bot
CMD ["node", "index.js"]
