import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { __testInternals } from '../services/imageCompositor.js';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7N3RkAAAAASUVORK5CYII=',
  'base64'
);

function createDnsLookup(recordsByHost) {
  return async (hostname, options) => {
    assert.equal(options?.all, true);
    assert.equal(options?.verbatim, true);
    const records = recordsByHost[hostname];
    if (!records) {
      const error = new Error(`getaddrinfo ENOTFOUND ${hostname}`);
      error.code = 'ENOTFOUND';
      throw error;
    }
    return records;
  };
}

afterEach(() => {
  __testInternals.resetTestNetworkDeps();
});

describe('imageCompositor remote image security', () => {
  test('rejects hostnames that resolve to private/internal addresses', async () => {
    let fetchCalls = 0;
    __testInternals.setTestNetworkDeps({
      dnsLookup: createDnsLookup({
        'safe.example': [
          { address: '93.184.216.34', family: 4 },
          { address: '10.0.0.5', family: 4 }
        ]
      }),
      fetch: async () => {
        fetchCalls += 1;
        return new Response(PNG_1X1, { status: 200 });
      }
    });

    await assert.rejects(
      () => __testInternals.loadImage('https://safe.example/image.png'),
      /resolves to private\/internal address/i
    );
    assert.equal(fetchCalls, 0, 'fetch should not be called when DNS checks fail');
  });

  test('follows redirects manually and re-validates each target URL', async () => {
    const fetchCalls = [];
    __testInternals.setTestNetworkDeps({
      dnsLookup: createDnsLookup({
        'origin.example': [{ address: '93.184.216.34', family: 4 }],
        'cdn.example': [{ address: '151.101.1.140', family: 4 }]
      }),
      fetch: async (url, options = {}) => {
        fetchCalls.push({ url: String(url), options });
        if (fetchCalls.length === 1) {
          return new Response(null, {
            status: 302,
            headers: { Location: 'https://cdn.example/final.png' }
          });
        }
        return new Response(PNG_1X1, {
          status: 200,
          headers: { 'content-length': String(PNG_1X1.length) }
        });
      }
    });

    const image = await __testInternals.loadImage('https://origin.example/start.png');
    assert.ok(Buffer.isBuffer(image));
    assert.equal(image.length, PNG_1X1.length);
    assert.equal(fetchCalls.length, 2);
    assert.equal(fetchCalls[0].options.redirect, 'manual');
    assert.equal(fetchCalls[1].options.redirect, 'manual');
  });

  test('rejects redirects to direct private/internal hosts', async () => {
    let fetchCalls = 0;
    __testInternals.setTestNetworkDeps({
      dnsLookup: createDnsLookup({
        'origin.example': [{ address: '93.184.216.34', family: 4 }]
      }),
      fetch: async () => {
        fetchCalls += 1;
        return new Response(null, {
          status: 302,
          headers: { Location: 'https://127.0.0.1/private.png' }
        });
      }
    });

    await assert.rejects(
      () => __testInternals.loadImage('https://origin.example/start.png'),
      /Private\/internal image hosts are not allowed/i
    );
    assert.equal(fetchCalls, 1, 'redirect target should be rejected before a second fetch');
  });

  test('rejects redirects when the target DNS resolves to private/internal address', async () => {
    let fetchCalls = 0;
    __testInternals.setTestNetworkDeps({
      dnsLookup: createDnsLookup({
        'origin.example': [{ address: '93.184.216.34', family: 4 }],
        'rebind.example': [
          { address: '203.0.113.10', family: 4 },
          { address: '192.168.1.10', family: 4 }
        ]
      }),
      fetch: async () => {
        fetchCalls += 1;
        return new Response(null, {
          status: 302,
          headers: { Location: 'https://rebind.example/private.png' }
        });
      }
    });

    await assert.rejects(
      () => __testInternals.loadImage('https://origin.example/start.png'),
      /resolves to private\/internal address/i
    );
    assert.equal(fetchCalls, 1, 'private redirect target should be blocked pre-fetch');
  });

  test('rejects redirect chains that exceed the max redirect depth', async () => {
    let fetchCalls = 0;
    __testInternals.setTestNetworkDeps({
      dnsLookup: createDnsLookup({
        'origin.example': [{ address: '93.184.216.34', family: 4 }]
      }),
      fetch: async () => {
        fetchCalls += 1;
        return new Response(null, {
          status: 302,
          headers: { Location: `https://origin.example/step-${fetchCalls}.png` }
        });
      }
    });

    await assert.rejects(
      () => __testInternals.loadImage('https://origin.example/start.png'),
      /Too many redirects/i
    );
    assert.equal(fetchCalls, 4, 'should stop after max redirect depth is reached');
  });
});
