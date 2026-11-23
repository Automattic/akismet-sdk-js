import { describe, expect, it } from 'vitest';
import { type Content, ValidationError } from '../src/index.js';
import { checkWire, feedbackWire } from './wire.js';

const base: Content = { userIp: '127.0.0.1' };

describe('content on the wire', () => {
  it('maps fields to wire keys', async () => {
    const wire = await checkWire({
      userIp: '127.0.0.1',
      userAgent: 'UA',
      siteLanguages: ['en', 'fr_ca'],
      body: 'body',
      authorName: 'Name',
      authorEmail: 'a@b.co',
      type: 'contact-form',
    });
    expect(wire.get('user_ip')).toBe('127.0.0.1');
    expect(wire.get('user_agent')).toBe('UA');
    expect(wire.get('blog_lang')).toBe('en, fr_ca');
    // eslint-disable-next-line unicorn/text-encoding-identifier-case -- wire charset name
    expect(wire.get('blog_charset')).toBe('UTF-8');
    expect(wire.get('comment_content')).toBe('body');
    expect(wire.get('comment_author')).toBe('Name');
    expect(wire.get('comment_author_email')).toBe('a@b.co');
    expect(wire.get('comment_type')).toBe('contact-form');
    expect(wire.get('blog')).toBe('https://example.com');
    expect(wire.has('is_test')).toBe(false);
  });

  it('omits optional fields that are null, undefined, or empty', async () => {
    const wire = await checkWire({
      ...base,
      authorEmail: '',
      authorUrl: null,
      permalink: undefined,
    });
    expect([...wire.keys()].toSorted()).toEqual(['api_key', 'blog', 'blog_charset', 'user_ip']);
  });

  it('serializes string context as comment_context', async () => {
    const wire = await checkWire({ ...base, context: 'single-tag' });
    expect(wire.get('comment_context')).toBe('single-tag');
  });

  it('serializes array context as repeated comment_context[] fields', async () => {
    const wire = await checkWire({ ...base, context: ['tag-a', 'tag-b'] });
    expect(wire.getAll('comment_context[]')).toEqual(['tag-a', 'tag-b']);
    expect(wire.has('comment_context')).toBe(false);
  });

  it('drops empty context values', async () => {
    const wire = await checkWire({ ...base, context: ['', 'kept'] });
    expect(wire.getAll('comment_context[]')).toEqual(['kept']);
    const empty = await checkWire({ ...base, context: [''] });
    expect(empty.has('comment_context[]')).toBe(false);
  });

  it('serializes classify=1 only when requested', async () => {
    const on = await checkWire({ ...base, classify: true });
    const off = await checkWire(base);
    expect(on.get('classify')).toBe('1');
    expect(off.has('classify')).toBe(false);
  });

  // A caller passing a dual-stack socket address gets the same wire value the request builders send.
  it('sends an IPv4-mapped userIp as plain IPv4', async () => {
    const wire = await checkWire({ userIp: '::FFFF:192.0.2.1' });
    expect(wire.get('user_ip')).toBe('192.0.2.1');
  });

  it('does not mutate the caller object', async () => {
    const content: Content = { ...base, context: ['a'], serverVariables: { X: '1' } };
    const snapshot = structuredClone(content);
    await checkWire(content);
    expect(content).toEqual(snapshot);
  });
});

describe('content validation at the call boundary', () => {
  it.each([
    [{ userIp: 'not-an-ip' }, 'bad IP'],
    [{ ...base, permalink: 'relative/path' }, 'relative permalink'],
    [{ ...base, callback: 'javascript:alert(1)' }, 'callback scheme'],
    [{ ...base, honeypotFieldValue: 'v' }, 'honeypot value without name'],
    [{ ...base, createdAt: new Date('nope') }, 'invalid date'],
    [{ ...base, createdAt: '2026-01-01' }, 'date without a time'],
    [{ ...base, createdAt: '2026-01-01T10:00:00' }, 'date-time without a zone'],
    [{ ...base, postModifiedAt: 'yesterday' }, 'free-form date'],
  ])('rejects %j (%s) before anything is sent', async (content, _label) => {
    await expect(checkWire(content as Content)).rejects.toBeInstanceOf(ValidationError);
  });

  // The author typed these; a malformed value is a spam signal for Akismet, not a caller bug.
  it('sends malformed author email and URL as typed', async () => {
    const wire = await checkWire({ ...base, authorEmail: 'asdf', authorUrl: 'buy pills' });
    expect(wire.get('comment_author_email')).toBe('asdf');
    expect(wire.get('comment_author_url')).toBe('buy pills');
  });

  // JSON bodies reach Content untyped; a number or array must fail as a ValidationError, not a TypeError.
  it.each([
    [{ userIp: 123 }, 'number IP'],
    [{ ...base, body: 123 }, 'number body'],
    [{ ...base, authorName: ['x', 'y'] }, 'array author name'],
    [{ ...base, userAgent: { a: 1 } }, 'object user agent'],
    [{ ...base, honeypotFieldName: 'hp', honeypotFieldValue: 1 }, 'number honeypot value'],
    [{ ...base, context: 5 }, 'number context'],
    [{ ...base, context: ['a', 5] }, 'number in context list'],
    [{ ...base, serverVariables: { HTTP_ACCEPT: 1 } }, 'number server variable'],
    [{ ...base, createdAt: 1_700_000_000 }, 'epoch number date'],
    [{ ...base, siteLanguages: 5 }, 'number site languages'],
  ])('rejects %j (%s) as a ValidationError', async (content, _label) => {
    await expect(checkWire(content as unknown as Content)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('caller-chosen wire keys', () => {
  // The server reads the form via PHP $_POST, which rewrites these spellings to user_role
  // or truncates them at NUL. The allowlist keeps every such spelling off the wire.
  const unsafe: Array<[string, string]> = [
    ['user.role', 'dot'],
    ['user role', 'space'],
    [' user_role', 'leading space'],
    ['user_role[', 'unmatched bracket'],
    ['user.role[x]', 'bracket'],
    ['user_role\0x', 'NUL byte'],
    ['a=b', 'equals sign'],
  ];

  it.each(unsafe)('rejects honeypot field name %j (%s)', async (name) => {
    await expect(
      checkWire({ ...base, honeypotFieldName: name, honeypotFieldValue: 'administrator' })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it.each(unsafe)('rejects server-variable key %j (%s)', async (name) => {
    await expect(
      checkWire({ ...base, serverVariables: { [name]: 'administrator' } })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  // Every wire key the SDK writes, plus the legacy key field. Listed here, not imported, so
  // dropping one from the source list turns this red.
  const reserved = [
    'user_ip',
    'user_agent',
    'blog_lang',
    'blog_charset',
    'comment_content',
    'comment_author',
    'comment_author_email',
    'comment_author_url',
    'comment_type',
    'permalink',
    'referrer',
    'comment_date_gmt',
    'comment_post_modified_gmt',
    'comment_parent',
    'user_role',
    'user_id',
    'user_ID',
    'recheck_reason',
    'honeypot_field_name',
    'comment_context',
    'api_key',
    'key',
    'blog',
    'is_test',
    'reporter',
    'comment_check_response',
    'callback',
    'classify',
  ];

  it.each(reserved)(
    'rejects every reserved wire key as a honeypot field name: %s',
    async (name) => {
      await expect(
        checkWire({ ...base, honeypotFieldName: name, honeypotFieldValue: '1' })
      ).rejects.toBeInstanceOf(ValidationError);
    }
  );

  it.each(['REQUEST_URI', 'REMOTE_ADDR', 'HTTP_X_REAL_IP', 'http_x_forwarded_for', 'Http_Cookie'])(
    'rejects server-read name %s as a honeypot field name',
    async (name) => {
      await expect(
        checkWire({ ...base, honeypotFieldName: name, honeypotFieldValue: '' })
      ).rejects.toBeInstanceOf(ValidationError);
    }
  );

  // A reserved key in serverVariables is a caller bug, the same as a reserved honeypot name.
  it.each(reserved)('rejects every reserved wire key as a server variable: %s', async (name) => {
    await expect(checkWire({ ...base, serverVariables: { [name]: '1' } })).rejects.toBeInstanceOf(
      ValidationError
    );
  });

  it('rejects a server variable named like the honeypot field', async () => {
    await expect(
      checkWire({
        ...base,
        honeypotFieldName: 'hp_field',
        honeypotFieldValue: 'filled by a bot',
        serverVariables: { hp_field: '' },
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('sends ordinary server variables', async () => {
    const wire = await checkWire({ ...base, serverVariables: { HTTP_ACCEPT: 'text/html' } });
    expect(wire.get('HTTP_ACCEPT')).toBe('text/html');
  });

  // A row loaded from a database may store a missing honeypot as an empty string.
  it('treats an empty honeypot field name as absent', async () => {
    const wire = await checkWire({ ...base, honeypotFieldName: '', honeypotFieldValue: '' });
    expect(wire.has('honeypot_field_name')).toBe(false);
  });

  it('still allows ordinary honeypot names', async () => {
    const wire = await checkWire({
      ...base,
      honeypotFieldName: 'website-url_2',
      honeypotFieldValue: '',
    });
    expect(wire.get('honeypot_field_name')).toBe('website-url_2');
    expect(wire.get('website-url_2')).toBe('');
  });
});

describe('wire encoding', () => {
  it('serializes dates as UTC ISO 8601 with a Z suffix and no milliseconds', async () => {
    const wire = await checkWire({
      ...base,
      createdAt: new Date('2026-10-20T10:00:00.123-07:00'),
      postModifiedAt: new Date(Date.UTC(2026, 0, 2, 3, 4, 5, 678)),
    });
    expect(wire.get('comment_date_gmt')).toBe('2026-10-20T17:00:00Z');
    expect(wire.get('comment_post_modified_gmt')).toBe('2026-01-02T03:04:05Z');
  });

  it('serializes ISO date strings with an offset as UTC', async () => {
    const wire = await checkWire({ ...base, createdAt: '2026-10-20T10:00:00-07:00' });
    expect(wire.get('comment_date_gmt')).toBe('2026-10-20T17:00:00Z');
  });

  it('omits check-only fields from feedback: comment_context, classify', async () => {
    const content: Content = {
      ...base,
      context: ['a', 'b'],
      callback: 'https://x.example/cb',
      classify: true,
    };
    const check = await checkWire(content);
    expect(check.getAll('comment_context[]')).toEqual(['a', 'b']);
    expect(check.get('callback')).toBe('https://x.example/cb');

    const feedback = await feedbackWire(content);
    expect(feedback.has('comment_context[]')).toBe(false);
    expect(feedback.has('comment_context')).toBe(false);
    expect(feedback.has('classify')).toBe(false);
    expect(feedback.get('user_ip')).toBe('127.0.0.1');
  });

  it('sends callback on feedback, where the server queues a webhook for it', async () => {
    const feedback = await feedbackWire({ ...base, callback: 'https://x.example/cb' });
    expect(feedback.get('callback')).toBe('https://x.example/cb');
  });

  it('restores content stored as JSON so feedback matches the check', async () => {
    const content: Content = {
      ...base,
      body: 'hello',
      createdAt: new Date('2026-10-20T17:00:00Z'),
      postModifiedAt: new Date('2026-01-02T03:04:05Z'),
      siteLanguages: ['en', 'fr_ca'],
      serverVariables: { HTTP_ACCEPT: 'text/html' },
    };
    // A real round trip through storage: JSON, which turns dates into strings.
    // eslint-disable-next-line unicorn/prefer-structured-clone -- the JSON round trip is the point
    const restored = JSON.parse(JSON.stringify(content)) as Content;
    const original = await feedbackWire(content);
    const replayed = await feedbackWire(restored);
    expect(replayed.toString()).toBe(original.toString());
  });
});

describe('core hardening', () => {
  // A prototype name is never an own form field, so the trap could never fire.
  it.each(['__proto__', 'constructor', 'prototype'])(
    'rejects prototype name %s as a honeypot field name on direct content',
    async (name) => {
      await expect(checkWire({ ...base, honeypotFieldName: name })).rejects.toBeInstanceOf(
        ValidationError
      );
    }
  );

  it('names the rejected field on ValidationError', async () => {
    const e = await checkWire({ userIp: 'not-an-ip' }).catch((error: unknown) => error);
    expect(e).toBeInstanceOf(ValidationError);
    expect((e as ValidationError).field).toBe('userIp');
  });
});
