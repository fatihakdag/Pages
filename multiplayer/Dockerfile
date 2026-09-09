# The relay, and the game it serves. Node rather than a Workers runtime: the
# relay is a plain node:http + ws server, so this deploys the exact code the
# tests run against, with nothing rewritten for the platform.
FROM node:22-alpine

WORKDIR /app

# Only the server has dependencies; installing them first keeps this layer
# cached across game edits.
COPY server/package.json server/package-lock.json ./server/
RUN npm --prefix server ci --omit=dev

# The game itself. relay.mjs resolves its static root as the directory above
# its own, so index.html has to sit here rather than in server/.
COPY server/ ./server/
COPY index.html ./

ENV PORT=8080
EXPOSE 8080

# Serving the game as well as relaying gives a single origin that works with no
# configuration: the page derives wss:// from whatever host it was loaded from.
CMD ["node", "server/relay.mjs"]
