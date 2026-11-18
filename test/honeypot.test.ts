import { describe, expect, it } from 'vitest';
import { contentFromRequest, type FormSource, ValidationError } from '../src/index.js';
import { checkWire } from './wire.js';

const NAME_FIELD = 'akismet_honeypot_name';

function read(form: FormSource, honeypotNameField?: string) {
  const content = contentFromRequest(new Headers(), {
    clientIp: '192.0.2.1',
    form,
    ...(honeypotNameField === undefined ? {} : { honeypotNameField }),
  });
  return { name: content.honeypotFieldName, value: content.honeypotFieldValue, content };
}

describe('honeypot from the form option', () => {
  it('reads the honeypot pair from FormData', () => {
    const form = new FormData();
    form.set(NAME_FIELD, 'website_url_2');
    form.set('website_url_2', 'http://spam.example');
    expect(read(form)).toMatchObject({ name: 'website_url_2', value: 'http://spam.example' });
  });

  it('reads the honeypot pair from a parsed body onto the wire', async () => {
    const { content } = read({ [NAME_FIELD]: 'hp_field', hp_field: '' });
    const wire = await checkWire(content);
    expect(wire.get('honeypot_field_name')).toBe('hp_field');
    expect(wire.get('hp_field')).toBe('');
  });

  it('reads nothing when the form carries no honeypot', () => {
    expect(read({ comment: 'hi' })).toMatchObject({ name: null, value: null });
    expect(read({ [NAME_FIELD]: '  ' }).name).toBeNull();
  });

  it('honors a custom name field', () => {
    expect(read({ hp_name: 'trap', trap: 'x' }, 'hp_name')).toMatchObject({
      name: 'trap',
      value: 'x',
    });
  });

  it('reads own properties only', () => {
    const inherited = Object.create({ [NAME_FIELD]: 'trap', trap: 'x' }) as Record<string, unknown>;
    expect(read(inherited).name).toBeNull();
  });

  it('rejects prototype property names as the honeypot field', () => {
    const body = JSON.parse(`{"${NAME_FIELD}":"__proto__","__proto__":{"x":1}}`) as Record<
      string,
      unknown
    >;
    expect(() => read(body)).toThrow(ValidationError);
    expect(() => read({ [NAME_FIELD]: 'constructor' })).toThrow(ValidationError);
  });

  it('rejects honeypot names outside identifier characters', () => {
    for (const name of ['user.role', 'user role', 'user_role[', 'a=b', 'é']) {
      expect(() => read({ [NAME_FIELD]: name, [name]: 'x' })).toThrow(ValidationError);
    }
  });

  it.each(['user_id', 'key', 'REQUEST_URI', 'REMOTE_ADDR', 'HTTP_X_REAL_IP'])(
    'rejects server-read field %s as a well-formed honeypot name',
    (name) => {
      expect(() => read({ [NAME_FIELD]: name, [name]: '' })).toThrow(ValidationError);
    }
  );
});
