# Multi-Stage Production Dockerfile for StudyLM FastAPI Backend & Worker
FROM python:3.12-slim AS base
WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

# Stage 1: Dependency builder stage
FROM base AS builder
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --upgrade pip && \
    pip install --no-cache-dir --prefix=/install -r requirements.txt

# Stage 2: Production runner stage
FROM base AS runner
WORKDIR /app

# Install curl for container healthcheck probe
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy installed Python packages and binaries from builder stage
COPY --from=builder /install /usr/local

# Create non-root system user and group for security
RUN groupadd -r studylm && useradd -r -g studylm -d /app -s /sbin/nologin studylm

# Copy application code
COPY --chown=studylm:studylm . .

USER studylm

EXPOSE 8000

# Container Healthcheck probe
HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
  CMD curl -f http://localhost:8000/health || curl -f http://localhost:8000/api/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
