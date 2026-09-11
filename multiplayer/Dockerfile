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
# The game, plus the files that make it installable to a home screen: the
# manifest, its icons and the service worker. Leaving any of them out still
# serves a playable game, which is exactly why it would go unnoticed.
COPY index.html manifest.webmanifest sw.js ./
COPY icon-192.png icon-512.png icon-maskable-512.png ./

ENV PORT=8080
EXPOSE 8080

# Serving the game as well as relaying gives a single origin that works with no
# configuration: the page derives wss:// from whatever host it was loaded from.
CMD ["node", "server/relay.mjs"]
