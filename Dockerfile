FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run typecheck && npm run build:web

FROM node:24-slim
ARG APP_VERSION=dev
ENV NODE_ENV=production DATA_DIR=/data
ENV APP_VERSION=$APP_VERSION
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
RUN find src -name '*.test.ts' -o -name 'fixtures.ts' | xargs rm -f
COPY --from=build /app/dist/web ./dist/web
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 12080
CMD ["node", "src/main.ts"]
