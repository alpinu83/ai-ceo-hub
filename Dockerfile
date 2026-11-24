FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev
COPY . .
EXPOSE 3456
CMD ["node", "server.js"]
