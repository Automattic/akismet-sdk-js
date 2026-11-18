import { describe, expect, it } from 'vitest';
import * as sdk from '../src/index.js';

describe('public surface', () => {
  // Removing an export after publish is a breaking change, so every runtime export is listed here on purpose.
  it('exports exactly the supported runtime names', () => {
    expect(Object.keys(sdk).toSorted()).toEqual([
      'Akismet',
      'AkismetError',
      'ClientError',
      'ContentType',
      'InvalidApiKeyError',
      'KeySitesOrder',
      'NetworkError',
      'RequestRejectedError',
      'ResponseError',
      'SDK_VERSION',
      'ServerError',
      'SpamVerdict',
      'StatsInterval',
      'SubscriptionStatus',
      'SuspendedKeyError',
      'ThrottledError',
      'ValidationError',
      'contentFromRequest',
    ]);
  });
});
