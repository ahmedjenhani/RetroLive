# Build context is the repository root (the API needs the shared package):
#   docker build -f backend/Dockerfile -t retrolive-api .

# ---- build stage: install everything, compile ----
FROM node:24-slim AS build
WORKDIR /app
# Be patient with flaky networks: retry registry downloads instead of failing the build
ENV NPM_CONFIG_FETCH_RETRIES=6 NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=2000 NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=30000
# Prisma's engine needs OpenSSL
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --workspace=backend --workspace=shared --no-audit --no-fund

COPY shared shared
COPY backend backend
RUN npm run build --workspace=backend

# ---- runtime stage: production dependencies and the compiled server only ----
FROM node:24-slim AS runtime
WORKDIR /app
# Be patient with flaky networks: retry registry downloads instead of failing the build
ENV NPM_CONFIG_FETCH_RETRIES=6 NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=2000 NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=30000
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --omit=dev --workspace=backend --workspace=shared --no-audit --no-fund

COPY backend/prisma backend/prisma
RUN cd backend && npx prisma generate
COPY --from=build /app/backend/dist backend/dist

# The files stay owned by root and are only read at runtime, so the app can run as an unprivileged user.
# (A recursive chown here would store a second copy of every file in a new image layer.)
USER node
ENV NODE_ENV=production
# Small free-tier instances have 512 MB of RAM: keep Node's heap well below that.
ENV NODE_OPTIONS=--max-old-space-size=300
WORKDIR /app/backend
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Apply any new database migrations, then start the API. "exec" lets Node receive the stop signal directly.
CMD ["sh", "-c", "npx prisma migrate deploy && exec node dist/server.js"]
