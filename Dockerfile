# One image = API + web app.  Render / Railway / any Docker host.
# ---- stage 1: build the Expo web app ----
FROM node:22-slim AS web
WORKDIR /mobile
COPY mobile/package.json mobile/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY mobile/ ./
# no EXPO_PUBLIC_API_URL: the hosted web app calls the API on its own origin
RUN EXPO_OFFLINE=1 CI=1 npx expo export --platform web --output-dir /web

# ---- stage 2: python API that also serves /web ----
FROM python:3.11-slim
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app ./app
COPY backend/seed_demo.py .
COPY --from=web /web ./web
ENV PORT=8000 WEB_DIR=/app/web
EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
