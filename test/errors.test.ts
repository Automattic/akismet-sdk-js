import { describe, expect, it, vi } from 'vitest';
import {
  AkismetError,
  ClientError,
  InvalidApiKeyError,
  NetworkError,
  RequestRejectedError,
  ResponseError,
  ServerError,
  SuspendedKeyError,
  ThrottledError,
  ValidationError,
} from '../src/index.js';
import { clientOver } from './wire.js';

// Callers construct these in their own tests, so the constructors are public.
describe('AkismetError hierarchy', () => {
  it.each([
    ['ClientError', () => new ClientError('m')],
    ['InvalidApiKeyError', () => new InvalidApiKeyError('m')],
    ['NetworkError', () => new NetworkError('m')],
    ['RequestRejectedError', () => new RequestRejectedError('m')],
    ['ServerError', () => new ServerError('m')],
    ['SuspendedKeyError', () => new SuspendedKeyError('m')],
    ['ThrottledError', () => new ThrottledError('m', { alert: null })],
    ['ValidationError', () => new ValidationError('m', 'field')],
  ])('%s is an AkismetError and an Error with its own name', (name, make) => {
    const e = make();
    expect(e).toBeInstanceOf(AkismetError);
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe(name);
  });

  it.each([
    ClientError,
    InvalidApiKeyError,
    RequestRejectedError,
    ServerError,
    SuspendedKeyError,
    ThrottledError,
  ])('%o is a ResponseError', (ErrorClass) => {
    expect(new ErrorClass('m')).toBeInstanceOf(ResponseError);
  });

  it('errors not derived from a response are not ResponseErrors', () => {
    expect(new NetworkError('m')).not.toBeInstanceOf(ResponseError);
    expect(new ValidationError('m')).not.toBeInstanceOf(ResponseError);
  });
});

describe('NetworkError retryable flag', () => {
  // No response arrived, so the request may never have reached the server.
  it('is retryable when the connection fails', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('connect ECONNREFUSED'));
    const e = await clientOver(fetch)
      .verifyKey()
      .catch((error: unknown) => error);
    expect(e).toBeInstanceOf(NetworkError);
    expect((e as NetworkError).retryable).toBe(true);
    // retries defaults to 0: the error is flagged retryable, but the SDK does not retry it itself.
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('is not retryable on a timeout', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(init.signal?.reason as Error);
          });
        })
    );
    const e = await clientOver(fetch, { timeoutMs: 5 })
      .verifyKey()
      .catch((error: unknown) => error);
    expect(e).toBeInstanceOf(NetworkError);
    expect((e as NetworkError).retryable).toBe(false);
  });
});
