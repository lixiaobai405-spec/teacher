const http = require('node:http');
const path = require('node:path');
const express = require('express');

const { createApp } = require('./app.js');
const { loadConfig } = require('./config.js');
const { createCoachService } = require('./coach-service.js');
const { createDeepSeekClient } = require('./deepseek-client.js');
const { createPromptLoader } = require('./prompt-loader.js');
const { createRuntime } = require('./runtime.js');

function invalidPortError() {
  const error = new Error('INVALID_PORT');
  error.code = 'INVALID_PORT';
  return error;
}

function resolvePort(value) {
  if (value === undefined || value === '') {
    return 4173;
  }

  const port = typeof value === 'number' ? value : Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw invalidPortError();
  }

  return port;
}

function resolveListenPort(value) {
  return value === 0 ? 0 : resolvePort(value);
}

function createDefaultCoachService({ fetchImpl } = {}) {
  const rootDir = path.join(__dirname, '..');
  const promptLoader = createPromptLoader({ rootDir });
  const client = createDeepSeekClient({
    fetchImpl,
    apiKey: process.env.DEEPSEEK_API_KEY,
  });

  return createCoachService({ promptLoader, client });
}

function createServer({ coachService, fetchImpl, authBoundary } = {}) {
  const app = createApp({
    coachService: coachService || createDefaultCoachService({ fetchImpl }),
    authBoundary,
  });
  const frontendDir = path.join(__dirname, '..', 'frontend');

  app.use(express.static(frontendDir, {
    setHeaders(response, filePath) {
      if (path.extname(filePath).toLowerCase() === '.html') {
        response.setHeader('Cache-Control', 'no-store');
      }
    },
  }));
  app.use((request, response) => {
    response.status(404).type('text/plain').send('Not Found');
  });

  return http.createServer(app);
}

function startServer({ port = 4173, coachService, fetchImpl, authBoundary } = {}) {
  const listenPort = resolveListenPort(port);
  const server = createServer({ coachService, fetchImpl, authBoundary });

  return server.listen(listenPort, '127.0.0.1');
}

async function startFromEnvironment() {
  let runtime;
  try {
    const config = loadConfig(process.env);
    runtime = await createRuntime(config);
    const server = startServer({
      port: resolvePort(process.env.PORT),
      authBoundary: runtime.authBoundary,
    });
    server.once('error', () => {
      process.stderr.write('SERVER_START_FAILED\n');
      process.exitCode = 1;
    });
    server.once('close', () => {
      runtime.close().catch(() => undefined);
    });
  } catch (error) {
    if (runtime) await runtime.close().catch(() => undefined);
    process.stderr.write(`${error.code === 'INVALID_PORT' ? 'INVALID_PORT' : 'SERVER_START_FAILED'}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  startFromEnvironment();
}

module.exports = {
  createDefaultCoachService,
  createServer,
  resolvePort,
  startServer,
};
