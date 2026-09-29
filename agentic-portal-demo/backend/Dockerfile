FROM oven/bun:1 AS portal
WORKDIR /portal
COPY portal/package.json portal/bun.lock ./
RUN bun install --frozen-lockfile
COPY portal/ ./
RUN bun run build

FROM python:3.12-slim
WORKDIR /app
COPY backend/pyproject.toml ./
COPY backend/app ./app
COPY backend/portal ./portal
COPY backend/agent ./agent
COPY backend/harness ./harness
RUN pip install --no-cache-dir .
COPY --from=portal /portal/dist /app/portal-dist
ENV PORTAL_DIST=/app/portal-dist DATA_DIR=/data TRACES_DIR=/data/traces
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
