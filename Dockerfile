FROM node:22-slim AS web
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=8080
COPY package*.json ./
RUN npm ci --omit=dev
COPY server/ server/
COPY web/public/data/ web/public/data/
COPY --from=web /app/web/dist web/dist
EXPOSE 8080
CMD ["node", "--no-warnings", "server/index.js"]
