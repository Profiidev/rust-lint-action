import type { IncomingMessage } from 'node:http';
import * as https from 'node:https';

export interface RequestOptions extends https.RequestOptions {
  body?: any;
}

interface RequestResponse {
  res: IncomingMessage;
  data: any;
}

/**
 * Helper function for making HTTP requests
 * @param {string | URL} url - Request URL
 * @param {RequestOptions} options - Request options
 * @returns {Promise<RequestResponse>} - JSON response
 */
export default async function request(
  url: string | URL,
  options: RequestOptions
): Promise<RequestResponse> {
  return new Promise((resolve, reject) => {
    const req = https
      .request(url, options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          if (res.statusCode !== undefined && res.statusCode >= 400) {
            // oxlint-disable-next-line no-unsafe-type-assertion
            const err = new Error(
              `Received status code ${res.statusCode}`
            ) as any;
            err.response = res;
            err.data = data;
            reject(err);
          } else {
            resolve({ data: JSON.parse(data), res });
          }
        });
      })
      .on('error', reject);
    if (options.body) {
      req.end(JSON.stringify(options.body));
    } else {
      req.end();
    }
  });
}
