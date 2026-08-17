FROM node:20-alpine

WORKDIR /app

# Install production deps first so this layer caches independently of app code.
# Only package.json is copied: the repo uses pnpm locally (npm is blocked in the
# dev environment), so there is no npm lockfile to trust. `npm install` resolves
# from package.json inside the image.
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

# Frontend + server files are copied explicitly. If you add a new file that has
# to be served or required at runtime, add it here or it will 404 / crash.
COPY schedule_generator.html login.html style.css script.js ./
COPY server.js storage.js ./

ENV NODE_ENV=production
ENV PORT=3000

# Storage defaults to local files under /app/data (bind-mount or volume it).
# Supplying AZURE_STORAGE_* switches the app to the blob backend instead - see
# .env.example and DEPLOY-AZURE.md. Left empty here on purpose: credentials are
# injected at runtime, never baked into the image.
ENV DATA_DIR=/app/data
ENV STORAGE_BACKEND=""
ENV AZURE_STORAGE_CONNECTION_STRING=""
ENV AZURE_STORAGE_ACCOUNT_NAME=""
ENV AZURE_STORAGE_ACCOUNT_KEY=""
ENV AZURE_STORAGE_CONTAINER="schedule-data"
# Azure serves over HTTPS, so the session cookie must be marked Secure there.
ENV COOKIE_SECURE=""
# Supply BOTH of these and settings.json is never created - auth comes purely
# from configuration. Injected at runtime; never bake real values in here.
ENV SCHEDULE_PASSWORD=""
ENV SESSION_SECRET=""

# Only used by the local backend; harmless when running on blob storage.
RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# Run as the image's built-in unprivileged user.
USER node

CMD ["node", "server.js"]
