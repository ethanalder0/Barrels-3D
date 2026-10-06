# Barrels 3D: the built frontend and the Python backend in one image.
#
# The backend serves both the API and the site (server/static_files.py), so a
# deploy is this one container. Built by .github/workflows/deploy.yml, which
# checks the repo out WITH Git LFS -- see the guard in the first stage for why
# that matters.

# --- 1. Build the frontend ---------------------------------------------------
FROM node:20-alpine AS web
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY index.html vite.config.js ./
COPY public ./public
COPY src ./src

# The player model is stored in Git LFS. A checkout without LFS leaves a
# 130-byte pointer file in its place, the build succeeds anyway, and the site
# goes up with no players on the field. Fail here instead.
RUN size=$(wc -c < public/models/player.glb) && \
    if [ "$size" -lt 100000 ]; then \
      echo "public/models/player.glb is $size bytes -- an LFS pointer, not the model." >&2; \
      echo "Check out with Git LFS (git lfs pull) before building." >&2; \
      exit 1; \
    fi

RUN npm run build

# --- 2. Run the backend ------------------------------------------------------
FROM python:3.12-slim
WORKDIR /app

COPY server/requirements.txt server/requirements.txt
RUN pip install --no-cache-dir -r server/requirements.txt

COPY server ./server
COPY --from=web /app/dist ./dist

# Behind Heroku's router, the visitor's address is the last X-Forwarded-For hop
# (server/ratelimit.py). Unbuffered so log lines reach `heroku logs` at once.
ENV TRUST_PROXY=1 \
    PYTHONUNBUFFERED=1

# Heroku sets PORT; app.py listens on it, on every interface.
CMD ["python", "server/app.py"]
