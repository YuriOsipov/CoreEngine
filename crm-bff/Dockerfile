# CoreEngine BFF — build from repo root:
#   docker build -f crm-bff/Dockerfile -t coreengine-bff .
FROM node:22-bookworm-slim AS deps
WORKDIR /app/crm-bff
COPY crm-bff/package.json crm-bff/package-lock.json ./
# tsx is required at runtime for start + provision scripts
RUN npm install

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV RUNNING_IN_DOCKER=1
COPY --from=deps /app/crm-bff/node_modules ./crm-bff/node_modules
COPY crm-bff ./crm-bff
COPY scripts ./scripts
COPY supabase/migrations ./supabase/migrations
COPY supabase/domains ./supabase/domains
COPY package.json ./package.json

EXPOSE 4000
WORKDIR /app/crm-bff
CMD ["npx", "tsx", "src/index.ts"]
