import { type IncomingMessage, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface RecordedRequest {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: any;
}

export type Responder = (
  req: RecordedRequest
) => { status?: number; body?: unknown } | undefined;

/**
 * Local HTTP server standing in for the GitHub and Forgejo APIs. Every request is recorded;
 * `respond` may return a custom status/body, otherwise `{}` with status 200 (201 for POST)
 * and an incrementing `id` is returned
 */
export const startFakeApiServer = async (
  respond: Responder = () => undefined
) => {
  const requests: RecordedRequest[] = [];
  let nextId = 1;
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      let body: any = raw;
      try {
        body = raw ? JSON.parse(raw) : undefined;
      } catch {
        // Keep raw text
      }
      const recorded = {
        body,
        headers: req.headers,
        method: req.method ?? '',
        url: req.url ?? ''
      };
      requests.push(recorded);
      const custom = respond(recorded);
      const status = custom?.status ?? (req.method === 'POST' ? 201 : 200);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(custom?.body ?? { id: nextId++ }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    close: async () =>
      new Promise<void>((resolve) => server.close(() => resolve())),
    requests,
    url: `http://127.0.0.1:${port}`
  };
};
