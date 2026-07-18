const http = require('node:http');
const path = require('node:path');
const express = require('express');

const { createApp } = require('./app.js');

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

function createServer(options) {
  const app = createApp(options);
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

function startServer({ port = 4173, coachService } = {}) {
  const listenPort = resolveListenPort(port);
  const server = createServer({ coachService });

  return server.listen(listenPort, '127.0.0.1');
}

function startFromEnvironment() {
  try {
    const server = startServer({ port: resolvePort(process.env.PORT) });
    server.once('error', () => {
      process.stderr.write('SERVER_START_FAILED\n');
      process.exitCode = 1;
    });
  } catch (error) {
    process.stderr.write(`${error.code === 'INVALID_PORT' ? 'INVALID_PORT' : 'SERVER_START_FAILED'}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  startFromEnvironment();
}

module.exports = { createServer, resolvePort, startServer };
