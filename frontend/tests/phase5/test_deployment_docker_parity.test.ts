import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Phase 5 & 6: Deployment & Docker Parity Verification', () => {
  it('test_frontend_standalone_docker_healthcheck', () => {
    // 1. Verify frontend Dockerfile configuration and healthcheck
    const frontendDockerfilePath = path.resolve(__dirname, '../../Dockerfile');
    expect(fs.existsSync(frontendDockerfilePath)).toBe(true);

    const frontendDockerfile = fs.readFileSync(frontendDockerfilePath, 'utf-8');
    expect(frontendDockerfile).toContain('FROM node:22-alpine');
    expect(frontendDockerfile).toContain('mkdir -p /app/public');
    expect(frontendDockerfile).toContain('/app/.next/standalone');
    expect(frontendDockerfile).toContain('USER nextjs');
    expect(frontendDockerfile).toContain('EXPOSE 3000');
    expect(frontendDockerfile).toContain('HEALTHCHECK');
    expect(frontendDockerfile).toContain("require('http')");
    expect(frontendDockerfile).toContain('CMD ["node", "server.js"]');

    // 2. Verify frontend .dockerignore exists and contains essential exclusions
    const dockerignorePath = path.resolve(__dirname, '../../.dockerignore');
    expect(fs.existsSync(dockerignorePath)).toBe(true);
    const dockerignoreContent = fs.readFileSync(dockerignorePath, 'utf-8');
    expect(dockerignoreContent).toContain('node_modules');
    expect(dockerignoreContent).toContain('.next');

    // 3. Verify backend Dockerfile exists with multi-stage build, healthcheck, and non-root security
    const backendDockerfilePath = path.resolve(__dirname, '../../../backend/Dockerfile');
    expect(fs.existsSync(backendDockerfilePath)).toBe(true);
    const backendDockerfile = fs.readFileSync(backendDockerfilePath, 'utf-8');
    expect(backendDockerfile).toContain('FROM python:3.12-slim');
    expect(backendDockerfile).toContain('AS builder');
    expect(backendDockerfile).toContain('AS runner');
    expect(backendDockerfile).toContain('USER studylm');
    expect(backendDockerfile).toContain('EXPOSE 8000');
    expect(backendDockerfile).toContain('HEALTHCHECK');
    expect(backendDockerfile).toContain('curl -f http://localhost:8000');
  });

  it('test_csp_and_security_headers', () => {
    // Verify Caddyfile enforces hardened CSP & security headers
    const caddyfilePath = path.resolve(__dirname, '../../docker/Caddyfile');
    expect(fs.existsSync(caddyfilePath)).toBe(true);

    const caddyfileContent = fs.readFileSync(caddyfilePath, 'utf-8');
    expect(caddyfileContent).toContain('Content-Security-Policy');
    expect(caddyfileContent).toContain('frame-src https://www.youtube.com');
    expect(caddyfileContent).toContain('script-src');
    expect(caddyfileContent).toContain('https://www.youtube.com');
    expect(caddyfileContent).toContain('X-Frame-Options "SAMEORIGIN"');
    expect(caddyfileContent).toContain('X-Content-Type-Options "nosniff"');
    expect(caddyfileContent).toContain('Strict-Transport-Security');
    expect(caddyfileContent).toContain('X-Accel-Buffering "no"');
    expect(caddyfileContent).toContain('Cache-Control "no-cache"');
  });

  it('test_http_206_pdf_range_streaming_through_reverse_proxy', () => {
    // Verify Caddyfile handles HTTP 206 partial content range streaming for PDF sources
    const caddyfilePath = path.resolve(__dirname, '../../docker/Caddyfile');
    expect(fs.existsSync(caddyfilePath)).toBe(true);

    const caddyfileContent = fs.readFileSync(caddyfilePath, 'utf-8');
    expect(caddyfileContent).toContain('handle_path /api/*');
    expect(caddyfileContent).toContain('header_up Range {header.Range}');
    expect(caddyfileContent).toContain('header_down Accept-Ranges "bytes"');

    // Verify compression bypass for SSE streaming endpoints
    expect(caddyfileContent).toContain('encode zstd gzip');
    expect(caddyfileContent).toContain('not path /api/notebooks/*/query/stream*');
    expect(caddyfileContent).toContain('not path /api/sources/*/stream*');
  });

  it('test_docker_compose_orchestration_parity', () => {
    // Assert root docker-compose file defines all 6 microservices with valid worker command
    const rootComposePath = path.resolve(__dirname, '../../../docker-compose.yml');
    expect(fs.existsSync(rootComposePath)).toBe(true);

    const composeContent = fs.readFileSync(rootComposePath, 'utf-8');
    expect(composeContent).toContain('services:');
    expect(composeContent).toContain('backend:');
    expect(composeContent).toContain('frontend:');
    expect(composeContent).toContain('worker:');
    expect(composeContent).toContain('postgres:');
    expect(composeContent).toContain('qdrant:');
    expect(composeContent).toContain('caddy:');
    expect(composeContent).toContain('postgres:16-alpine');
    expect(composeContent).toContain('qdrant/qdrant:v1.12.1');
    expect(composeContent).toContain('pg_isready');
    expect(composeContent).toContain('/healthz');
    expect(composeContent).toContain('condition: service_healthy');
    expect(composeContent).toContain('--app=app.tasks.worker.app');
  });
});
