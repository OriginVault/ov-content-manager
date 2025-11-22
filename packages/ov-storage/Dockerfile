# More robust than alpine on WSL/VPNs
FROM node:23-bookworm-slim

WORKDIR /app

# Make npm/Node resilient to dual-stack flakiness
ENV NODE_OPTIONS="--dns-result-order=ipv4first"
RUN npm config set registry https://registry.npmjs.org/ \
 && npm config set fetch-retries 5 \
 && npm config set fetch-retry-mintimeout 20000 \
 && npm config set fetch-retry-maxtimeout 120000 \
 && npm config set audit false \
 && npm config set fund false

# Copy manifests first for cache
COPY package*.json ./

# Use lockfile for reproducible installs and cache to speed up
RUN --mount=type=cache,target=/root/.npm npm ci --no-fund --no-audit

# Bring the rest of the code
COPY . .

# Build the TypeScript application with optimized memory settings
RUN NODE_OPTIONS='--max-old-space-size=4096' npm run build

EXPOSE 8080
CMD ["npm", "start"] 