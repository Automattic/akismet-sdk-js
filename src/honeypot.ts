import { PROTOTYPE_NAMES } from './content.js';

/**
 * Hidden form field that carries the honeypot field's name, so the server can find
 * the honeypot even when the name is randomized per render.
 */
const HONEYPOT_NAME_FIELD = 'akismet_honeypot_name';

/** A submitted form: `FormData` or an already-parsed body object. */
export type FormSource = FormData | Record<string, unknown>;

/** Both are `null` when the form carried no honeypot. */
interface HoneypotFields {
  honeypotFieldName: string | null;
  honeypotFieldValue: string | null;
}

// By shape, not instanceof: a FormData from another fetch implementation is still a
// form. A parsed body cannot hold a function, so a field named `get` cannot pass.
function isFormData(source: FormSource): source is FormData {
  return typeof (source as { get?: unknown }).get === 'function';
}

function readOwnString(source: FormSource, name: string): string | null {
  if (PROTOTYPE_NAMES.has(name)) {
    return null;
  }
  if (isFormData(source)) {
    const value = source.get(name);
    return typeof value === 'string' ? value : null;
  }
  if (!Object.hasOwn(source, name)) {
    return null;
  }
  const value = source[name];
  return typeof value === 'string' ? value : null;
}

/**
 * Read the honeypot field name and value from a submitted form. Reads own
 * properties only, so a JSON body cannot reach prototype settings.
 */
export function honeypotFromForm(
  source: FormSource,
  nameField: string = HONEYPOT_NAME_FIELD
): HoneypotFields {
  const name = readOwnString(source, nameField);
  if (name === null || name.trim() === '') {
    return { honeypotFieldName: null, honeypotFieldValue: null };
  }
  // The name is browser-controlled and becomes a wire key; contentFromRequest() rejects
  // an unsafe one as soon as the content is built.
  return { honeypotFieldName: name, honeypotFieldValue: readOwnString(source, name) ?? '' };
}
