import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const publicPort = Number(process.env.GYM_DEV_PORT ?? 19006);
const expoPort = Number(process.env.GYM_EXPO_PORT ?? 19007);
const host = 'localhost';
const expoCli = fileURLToPath(
  new URL('../node_modules/expo/bin/cli', import.meta.url),
);

if (
  !Number.isInteger(publicPort) ||
  !Number.isInteger(expoPort) ||
  publicPort < 1 ||
  expoPort < 1 ||
  publicPort === expoPort
) {
  throw new Error(
    'GYM_DEV_PORT and GYM_EXPO_PORT must be different valid ports.',
  );
}

const isolationHeaders = {
  'Cross-Origin-Embedder-Policy': 'credentialless',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

const server = http.createServer((request, response) => {
  const upstream = http.request(
    {
      host,
      port: expoPort,
      method: request.method,
      path: request.url,
      headers: request.headers,
    },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, {
        ...upstreamResponse.headers,
        ...isolationHeaders,
      });
      upstreamResponse.pipe(response);
    },
  );

  upstream.on('error', () => {
    if (!response.headersSent) {
      response.writeHead(502, isolationHeaders);
    }
    response.end('Expo is starting. Reload in a moment.');
  });
  request.pipe(upstream);
});

server.on('upgrade', (request, socket, head) => {
  const upstream = net.connect(expoPort, host, () => {
    const headers = Object.entries(request.headers)
      .map(([name, value]) => `${name}: ${value}`)
      .join('\r\n');
    upstream.write(
      `${request.method} ${request.url} HTTP/1.1\r\n${headers}\r\n\r\n`,
    );
    if (head.length) upstream.write(head);
    socket.pipe(upstream);
    upstream.pipe(socket);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
});

let expo;

server.on('error', (error) => {
  console.error(error);
  expo?.kill('SIGINT');
  process.exitCode = 1;
});

server.listen(publicPort, host, () => {
  console.log(`Open http://localhost:${publicPort}`);
  expo = spawn(
    process.execPath,
    [expoCli, 'start', '--web', '--localhost', '--port', String(expoPort)],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        EXPO_PACKAGER_PROXY_URL: `http://localhost:${publicPort}`,
      },
    },
  );
  expo.on('exit', (code) => {
    server.close();
    process.exitCode = code ?? 0;
  });
});

function stop() {
  expo?.kill('SIGINT');
  server.close();
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
