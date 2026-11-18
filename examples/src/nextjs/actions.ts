// app/comments/actions.ts: a Next.js Server Action. It gets the form and `headers()`, but
// no request or socket. Like route.ts, it runs only behind the platform ingress, the one
// trusted hop.
'use server';

import { AkismetError, ContentType, ValidationError } from '@automattic/akismet';
// eslint-disable-next-line n/no-missing-import -- declared in next-headers.d.ts; next is not installed
import { headers } from 'next/headers';
// In your app, import the client from wherever you create it, such as '@/lib/akismet'.
import { akismet, statusFor } from '../akismet.js';

export async function postComment(form: FormData): Promise<{ status: string }> {
  const text = (name: string): string | null => {
    const value = form.get(name);
    return typeof value === 'string' ? value : null;
  };

  try {
    const content = akismet.forRequest(await headers(), { trustedProxyHops: 1, form }).content({
      body: text('comment'),
      authorName: text('name'),
      authorEmail: text('email'),
      authorUrl: text('website'),
      permalink: 'https://example.com/posts/42',
      type: ContentType.Comment,
    });

    const result = await akismet.check(content);
    return statusFor(result).body;
  } catch (e) {
    if (e instanceof ValidationError) {
      return { status: 'invalid' };
    }
    if (e instanceof AkismetError) {
      console.error(e); // safe to log: the key is redacted
      return { status: 'pending-review' };
    }
    throw e;
  }
}
