# Owtranet: one image serving the API and the built web app.
# Used by docker-compose.yml; see the "Run with Docker" section of the README.

# ---- Build the React client -------------------------------------------------
FROM node:20-bookworm-slim AS client
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ---- Runtime ----------------------------------------------------------------
FROM node:20-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .
COPY --from=client /app/client/dist ./client/dist

RUN mkdir -p uploads logs && chown -R node:node uploads logs
USER node

EXPOSE 3006
# docker/init.js loads the schema and creates the first admin on an empty
# database, then hands over to the server.
CMD ["sh", "-c", "node docker/init.js && exec node server.js"]
