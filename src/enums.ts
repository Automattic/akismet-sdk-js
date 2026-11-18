export const ContentType = {
  Comment: 'comment',
  ForumPost: 'forum-post',
  Reply: 'reply',
  BlogPost: 'blog-post',
  ContactForm: 'contact-form',
  Signup: 'signup',
  Message: 'message',
  Pingback: 'pingback',
  Trackback: 'trackback',
  Tweet: 'tweet',
} as const;
export type ContentType = (typeof ContentType)[keyof typeof ContentType];

export const SpamVerdict = {
  Ham: 'ham',
  Spam: 'spam',
  Discard: 'discard',
} as const;
export type SpamVerdict = (typeof SpamVerdict)[keyof typeof SpamVerdict];

const SPAM_VERDICTS: ReadonlySet<unknown> = new Set(Object.values(SpamVerdict));

export function isSpamVerdict(value: unknown): value is SpamVerdict {
  return SPAM_VERDICTS.has(value);
}

export const StatsInterval = {
  /** Daily stats for 60 days. Needs a paid key; other keys get the 6-month monthly breakdown. */
  SixtyDays: '60-days',
  SixMonths: '6-months',
  Year: 'year',
  All: 'all',
} as const;
export type StatsInterval = (typeof StatsInterval)[keyof typeof StatsInterval];

export const KeySitesOrder = {
  Total: 'total',
  Spam: 'spam',
  Ham: 'ham',
  MissedSpam: 'missed_spam',
  FalsePositives: 'false_positives',
} as const;
export type KeySitesOrder = (typeof KeySitesOrder)[keyof typeof KeySitesOrder];

export const SubscriptionStatus = {
  Active: 'active',
  Missing: 'missing',
  Suspended: 'suspended',
  Cancelled: 'cancelled',
  NoSub: 'no-sub',
} as const;
export type SubscriptionStatus = (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus];
