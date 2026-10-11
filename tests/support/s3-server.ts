import { createServer } from 'node:http';
import { createHash } from 'node:crypto';

// Local S3 protocol fixture: exercise the actual AWS SDK and conditional writes.
export async function startS3Server() {
  const objects = new Map<string, { body: Buffer; etag: string }>();
  const requests: Array<{ method: string; key: string; signed: boolean; ifMatch?: string; ifNoneMatch?: string }> = [];
  let rejectNextPublish = false;
  const server = createServer(async (request, response) => {
    const key = decodeURIComponent(new URL(request.url!, 'http://localhost').pathname).replace(/^\/test-bucket\/?/u, '');
    requests.push({ method: request.method!, key, signed: request.headers.authorization?.startsWith('AWS4-HMAC-SHA256') ?? false, ifMatch: request.headers['if-match'] as string | undefined, ifNoneMatch: request.headers['if-none-match'] as string | undefined });
    const failure = (status: number, code: string): void => { response.writeHead(status, { 'Content-Type': 'application/xml' }); response.end(`<Error><Code>${code}</Code><Message>${code}</Message></Error>`); };
    if (request.method === 'HEAD') { response.writeHead(200); response.end(); return; }
    const stored = objects.get(key);
    if (request.method === 'GET') {
      if (!stored) { failure(404, 'NoSuchKey'); return; }
      response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': stored.body.length, ETag: stored.etag }); response.end(stored.body); return;
    }
    if (request.method === 'PUT') {
      if (key.endsWith('/latest.json') && rejectNextPublish) { rejectNextPublish = false; failure(412, 'PreconditionFailed'); return; }
      if (request.headers['if-none-match'] === '*' && stored || request.headers['if-match'] && stored?.etag !== request.headers['if-match']) { failure(412, 'PreconditionFailed'); return; }
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks); const etag = `"${createHash('sha256').update(body).digest('hex')}"`;
      objects.set(key, { body, etag }); response.writeHead(200, { ETag: etag }); response.end(); return;
    }
    failure(405, 'MethodNotAllowed');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  return { endpoint: `http://127.0.0.1:${address.port}`, objects, requests, rejectNextPublish: () => { rejectNextPublish = true; }, close: () => new Promise<void>((resolve, reject) => { server.closeAllConnections(); server.close((error) => error ? reject(error) : resolve()); }) };
}
