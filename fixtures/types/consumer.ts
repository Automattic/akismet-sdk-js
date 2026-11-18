// Compiles against the installed package only. Every public export is imported, and
// the option and result types are used the way an integrator would use them.
import {
  Akismet,
  AkismetError,
  ClientError,
  ContentType,
  InvalidApiKeyError,
  KeySitesOrder,
  NetworkError,
  RequestRejectedError,
  ResponseError,
  SDK_VERSION,
  ServerError,
  SpamVerdict,
  StatsInterval,
  SubscriptionStatus,
  SuspendedKeyError,
  ThrottledError,
  ValidationError,
  contentFromRequest,
  type AkismetOptions,
  type Alert,
  type AlertUpgrade,
  type BoundClient,
  type CheckResult,
  type ClientIpOptions,
  type Content,
  type ContentFromRequestOptions,
  type FeedbackOptions,
  type FetchLike,
  type FormSource,
  type GetKeySitesOptions,
  type GetStatsOptions,
  type GetUsageLimitOptions,
  type KeySitesResponse,
  type KeyVerification,
  type NodeRequestLike,
  type RequestOptions,
  type RequestSource,
  type ResponseDetails,
  type SiteStats,
  type Stats,
  type StatsBreakdownEntry,
  type Subscription,
  type UsageLimit,
} from '@automattic/akismet';

const fetchStub: FetchLike = async () => new Response('true');
const options: AkismetOptions = {
  apiKey: 'zzzzzzzzzzzz',
  site: 'https://example.com',
  fetch: fetchStub,
};
const akismet = new Akismet(options);

const request: RequestOptions = { timeoutMs: 5_000, isTest: true };
// A maybe-missing value passes straight through under exactOptionalPropertyTypes.
declare const maybe: { timeoutMs?: number; hops?: number; email?: string; key?: string };
const forwarded: RequestOptions = { timeoutMs: maybe.timeoutMs };
const maybeIp: ClientIpOptions = { trustedProxyHops: maybe.hops };
const maybeFields: Partial<Content> = { authorEmail: maybe.email };
// @ts-expect-error A missing tenant key must not fall back to the client's own.
const tenant: RequestOptions = { apiKey: maybe.key };
const ipOptions: ClientIpOptions = { trustedProxyHops: 0 };
const fromRequest: ContentFromRequestOptions = { ...ipOptions };
const source: RequestSource = new Request('https://example.com/comments', { method: 'POST' });
const nodeLike: NodeRequestLike | undefined = undefined;
const form: FormSource | undefined = undefined;

// Spread over the built content, as the docs show.
const content: Content = {
  ...contentFromRequest(source, fromRequest),
  body: 'Nice post',
  type: ContentType.Comment,
};

export async function consume(): Promise<string[]> {
  const notes: string[] = [SDK_VERSION, String(nodeLike), String(form)];
  notes.push(String([forwarded, maybeIp, maybeFields, tenant]));

  const result: CheckResult = await akismet.check(content, request);
  if (result.verdict === SpamVerdict.Discard) notes.push('discard');
  const isSpam: boolean = result.isSpam;
  const alert: Alert | null = result.alert;
  const upgrade: AlertUpgrade | null | undefined = alert?.upgrade;
  notes.push(String(isSpam), String(upgrade?.url));

  const bound: BoundClient = akismet.forRequest(source);
  await bound.check({ body: 'Bound' });

  const feedback: FeedbackOptions = { previousVerdict: result.verdict };
  await akismet.submitSpam(content, feedback);

  const verification: KeyVerification = await akismet.verifyKey();
  const usageOptions: GetUsageLimitOptions = {};
  const usage: UsageLimit = await akismet.getUsageLimit(usageOptions);
  const subscription: Subscription = await akismet.getSubscription();
  if (subscription.status === SubscriptionStatus.Active) notes.push('active');
  const statsOptions: GetStatsOptions = { interval: StatsInterval.SixMonths };
  const stats: Stats = await akismet.getStats(statsOptions);
  const entry: StatsBreakdownEntry | undefined = stats.breakdown[0];
  const sitesOptions: GetKeySitesOptions = { order: KeySitesOrder.Total };
  const sites: KeySitesResponse = await akismet.getKeySites(sitesOptions);
  const site: SiteStats | undefined = sites.sites[0];
  notes.push(String(verification), String(usage), String(entry), String(site));

  try {
    await akismet.check(content);
  } catch (error) {
    if (error instanceof ThrottledError || error instanceof SuspendedKeyError) {
      const details: ResponseDetails = {
        status: error.status,
        headers: error.headers,
        debugHelp: error.debugHelp,
        alert: error.alert,
      };
      notes.push(String(details.alert?.upgrade?.url));
    } else if (error instanceof InvalidApiKeyError || error instanceof RequestRejectedError) {
      notes.push(String(error.debugHelp));
    } else if (error instanceof ServerError || error instanceof ClientError) {
      notes.push(String(error.status));
    } else if (error instanceof ResponseError) {
      notes.push(error.message);
    } else if (error instanceof NetworkError) {
      notes.push(String(error.retryable));
    } else if (error instanceof ValidationError) {
      notes.push(error.message);
    } else if (error instanceof AkismetError) {
      notes.push(error.name);
    } else {
      throw error;
    }
  }
  return notes;
}
