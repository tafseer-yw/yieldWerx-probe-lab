# Pinned to the exact @playwright/test version in package.json — visual
# baselines are ONLY valid when generated inside this image. A host GPU/font
# stack renders differently, and a host-generated baseline would quietly gate
# everyone else's merges on one laptop's fonts.
#
# Everything runs in the container: the app, the API, the browser. Playwright's
# webServer starts `npm start` inside, so there is no host/container networking
# to get wrong. Authority for container-only baselines: docs/visual-regression.md.
FROM mcr.microsoft.com/playwright:v1.61.1-jammy

# better-sqlite3 has no prebuilt binary for this image's Node/arch, so it
# compiles from source — which needs `make` and a C++ toolchain. The base
# image ships Python but not build-essential.
RUN apt-get update && apt-get install -y --no-install-recommends build-essential \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /e2e

# Manifests first for layer caching. Copy the app's package files so the root
# postinstall (npm install --prefix probe-lab-app) finds the directory, and
# scripts/ so ensure-deps and friends resolve.
COPY package.json package-lock.json .npmrc ./
COPY probe-lab-app/package.json probe-lab-app/package-lock.json ./probe-lab-app/
COPY scripts ./scripts
# Root install; its postinstall installs and compiles the app's dependencies.
RUN npm ci --include=dev

COPY . .

# Regenerate BDD specs at build time so the image is self-contained.
RUN npx bddgen

CMD ["npx", "playwright", "test", "--project=visual"]
