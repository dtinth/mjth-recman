FROM oven/bun:1.2.8

# Install zip command
RUN apt-get update && apt-get install -y zip && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
CMD ["bun", "src/main.ts"]