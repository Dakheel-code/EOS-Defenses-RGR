FROM node:20-alpine

# Install dependencies for sharp
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    vips-dev \
    pkgconfig

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install npm dependencies with verbose logging
RUN npm install --verbose

# Copy application files
COPY . .

# Create data directory
RUN mkdir -p data

# Start the bot
CMD ["npm", "start"]
