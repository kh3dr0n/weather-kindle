FROM mcr.microsoft.com/playwright:v1.48.2-jammy
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.mjs ./
ENV NODE_ENV=production PORT=8080 OUT_DIR=/data TZ=Europe/Berlin
VOLUME /data
EXPOSE 8080
CMD ["node", "server.mjs"]
