FROM node:22-slim AS build
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
COPY server/lib/boleto.js /app/server/lib/boleto.js
RUN npx vite build

FROM node:22-slim
ENV NODE_ENV=production DB_PATH=/data/paopuro.db
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY --from=build /app/web/dist ./web/dist
VOLUME /data
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
