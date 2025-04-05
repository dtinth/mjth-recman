FROM oven/bun:1.2.8

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
CMD ["bun", "src/main.ts"]