// app/api/comments/route.ts: a Next.js App Router route handler on a Web Request.
// It runs only behind the platform ingress (Vercel, or your own proxy), the one trusted
// hop. The ingress must also bound the body: Vercel caps it at 4.5 MB, but a self-hosted
// deployment needs a limit at its reverse proxy, because request.formData() buffers it all.
import { AkismetError, ContentType, ValidationError } from '@automattic/akismet';
// In your app, import the client from wherever you create it, such as '@/lib/akismet'.
import { akismet, statusFor } from '../akismet.js';

export async function POST(request: Request): Promise<Response> {
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- Next.js route handlers parse form posts this way; the deprecation is Node's, for its own server
  const form = await request.formData();
  const text = (name: string): string | null => {
    const value = form.get(name);
    return typeof value === 'string' ? value : null;
  };

  try {
    const content = akismet.forRequest(request, { trustedProxyHops: 1, form }).content({
      body: text('comment'),
      authorName: text('name'),
      authorEmail: text('email'),
      authorUrl: text('website'),
      // The page the comment belongs to, from your own route or data. Not the Referer
      // header: the client controls it, and a bad value fails validation.
      permalink: 'https://example.com/posts/42',
      type: ContentType.Comment,
      // userRole: (await auth()).user?.role  ← from your session, never from the form
    });

    const result = await akismet.check(content, { signal: request.signal });
    const { status, body } = statusFor(result);
    return status === 204 ? new Response(null, { status }) : Response.json(body, { status });
  } catch (e) {
    if (e instanceof ValidationError) {
      return Response.json({ error: 'Invalid submission' }, { status: 400 });
    }
    if (e instanceof AkismetError) {
      console.error(e); // safe to log: the key is redacted
      return Response.json({ status: 'pending-review' });
    }
    throw e;
  }
}
