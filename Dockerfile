FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV DATA_DIR=/data

COPY package.json ./
COPY server.mjs config.json ./
COPY public ./public

RUN mkdir -p /data

VOLUME ["/data"]
EXPOSE 8080

CMD ["node", "server.mjs"]
