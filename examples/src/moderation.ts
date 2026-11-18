// Filing feedback when a moderator corrects Akismet.
//
// Send the content exactly as it was checked. The author's IP and user agent must be the
// ones Akismet saw, or the report trains the classifier on the moderator. Store `content`
// and `result.verdict` at check time and replay them here.
import type { Content, SpamVerdict } from '@automattic/akismet';
import { akismet } from './akismet.js';

/** What your comments table needs to hold alongside the comment itself. */
interface StoredComment {
  id: string;
  /** The exact object passed to `akismet.check()`, round-tripped through JSON. */
  akismetContent: Content;
  /** `result.verdict` from that check. */
  akismetVerdict: SpamVerdict | null;
}

// Stand-in for your database.
const db = new Map<string, StoredComment>();

export async function markAsSpam(
  commentId: string,
  moderator: { username: string }
): Promise<void> {
  const stored = db.get(commentId);
  if (!stored) {
    throw new Error(`Unknown comment ${commentId}`);
  }

  await akismet.submitSpam(stored.akismetContent, {
    previousVerdict: stored.akismetVerdict,
    reporter: moderator.username,
  });
  // Then update your own moderation state.
}

export async function markAsHam(commentId: string, moderator: { username: string }): Promise<void> {
  const stored = db.get(commentId);
  if (!stored) {
    throw new Error(`Unknown comment ${commentId}`);
  }

  await akismet.submitHam(stored.akismetContent, {
    previousVerdict: stored.akismetVerdict,
    reporter: moderator.username,
  });
}
