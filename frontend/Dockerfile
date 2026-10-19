# Build context is the repository root (the web app needs the shared package):
#   docker build -f frontend/Dockerfile -t retrolive-web .

# ---- build stage ----
FROM node:24-slim AS build
WORKDIR /app
# Be patient with flaky networks: retry registry downloads instead of failing the build
ENV NPM_CONFIG_FETCH_RETRIES=6 NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=2000 NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=30000

COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --workspace=frontend --workspace=shared --no-audit --no-fund

COPY shared shared
COPY frontend frontend
# Empty means "same origin": the browser talks to this nginx, which proxies /api and /socket.io to the API.
ARG API_URL=""
ENV API_URL=$API_URL
RUN npm run build --workspace=frontend

# ---- runtime stage ----
FROM nginx:1.27-alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost/ >/dev/null || exit 1
