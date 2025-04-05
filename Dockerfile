# Build stage
FROM oven/bun:1.2.8 as builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun build --target=bun --outfile=dist/main.js ./src/main.ts

# Run stage
FROM oven/bun:1.2.8
RUN apt-get update && apt-get install -y zip && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/dist/ ./dist/
CMD ["bun", "dist/main.js"]