FROM node:20-slim

# Install ffmpeg and curl
RUN apt-get update && apt-get install -y ffmpeg curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --omit=dev

# Copy project files
COPY . .

# Run bot
CMD ["node", "index.js"]
