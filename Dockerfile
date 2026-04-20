# Use the latest LTS Node version
FROM node:22-slim AS builder

WORKDIR /app

# Install app dependencies
COPY package*.json ./
RUN npm install

# Copy source files
COPY . .

# Build the frontend assets
RUN npm run build

# --- Production Image ---
FROM node:22-slim

WORKDIR /app

# Copy production dependencies and built assets
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.ts ./
COPY --from=builder /app/firebase-applet-config.json ./
# Include other necessary files for the scraper
COPY --from=builder /app/migrate_status.ts ./

# Ensure the environment is production
ENV NODE_ENV=production

# The application listens on port 3000
EXPOSE 3000

# Start the server
CMD ["npm", "start"]
