# Build stage
FROM oven/bun:1 AS builder

WORKDIR /app

# Copy package files
COPY package.json bun.lock* ./
COPY frontend/package.json ./frontend/
COPY backend/package.json ./backend/

# Install dependencies
RUN bun install

# Copy source code
COPY . .

# Build frontend
WORKDIR /app/frontend
RUN bun run build

# Production stage
FROM oven/bun:1-slim

WORKDIR /app

# Copy backend
COPY --from=builder /app/backend ./backend
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/backend/node_modules ./backend/node_modules

# Copy built frontend to backend/public
COPY --from=builder /app/frontend/dist ./backend/public

WORKDIR /app/backend

# Expose port
EXPOSE 3001

# Run the server
CMD ["bun", "run", "src/index.ts"]
