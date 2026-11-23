// One client per process. Reads the key and site from the environment and runs in
// test mode so that experimenting never trains the classifier.
import { Akismet, type CheckResult, SpamVerdict } from '@automattic/akismet';

const apiKey = process.env.AKISMET_API_KEY;
if (!apiKey) {
  throw new Error('Set AKISMET_API_KEY');
}

export const akismet = new Akismet({
  apiKey,
  site: process.env.AKISMET_SITE ?? 'https://example.com',
  // Test mode unless NODE_ENV=production, which suits `npx tsx` runs. A real deploy
  // that forgets NODE_ENV would never train Akismet, so prefer an explicit opt-in
  // (isTest: process.env.AKISMET_TEST_MODE === '1') in your own code.
  isTest: process.env.NODE_ENV !== 'production',
  applicationUserAgent: 'akismet-sdk-examples/1.0',
});

/**
 * How many reverse proxies sit between the client and this process. The run
 * commands in the README connect straight to Node, so the default is 0: trust only
 * the socket. Set TRUSTED_PROXY_HOPS when you put a load balancer in front; with
 * the wrong number a client can forge X-Forwarded-For and choose its own IP.
 */
export const TRUSTED_PROXY_HOPS = Number(process.env.TRUSTED_PROXY_HOPS ?? 0);
// Fail at startup, not on every request: NaN or a fraction makes every builder call throw.
if (!Number.isSafeInteger(TRUSTED_PROXY_HOPS) || TRUSTED_PROXY_HOPS < 0) {
  throw new Error('TRUSTED_PROXY_HOPS must be a non-negative integer');
}

/**
 * Shared verdict → HTTP response mapping used by every server example.
 *
 * The servers fail open on any AkismetError: the comment goes to moderation and the
 * error is logged. In production, split that: NetworkError and ServerError are
 * transient, but ThrottledError, SuspendedKeyError, and InvalidApiKeyError mean every
 * comment will land in moderation until an operator acts, so page someone.
 */
export function statusFor(result: CheckResult): {
  status: number;
  body: { status: 'discarded' | 'pending-review' | 'published' };
} {
  if (result.verdict === SpamVerdict.Discard) {
    // Blatant spam: pretend success, store nothing, give the bot no signal.
    return { status: 204, body: { status: 'discarded' } };
  }
  if (result.isSpam) {
    return { status: 200, body: { status: 'pending-review' } };
  }
  return { status: 200, body: { status: 'published' } };
}
