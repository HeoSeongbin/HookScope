FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci
COPY backend backend
RUN npm run build -w backend
WORKDIR /app/backend
USER node
CMD ["sh", "-c", "node dist/migrate.js && node dist/server.js"]
