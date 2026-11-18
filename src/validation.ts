import { invalidValue } from './errors/factories.js';
import { isIP } from './ip.js';

export function validateUrl(url: string, fieldName: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw invalidValue(fieldName, 'must be a valid URL');
  }

  if (parsed.hostname === '') {
    throw invalidValue(fieldName, 'must be a valid URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw invalidValue(fieldName, 'must use http or https scheme');
  }
}

export function validateIp(ip: string, fieldName: string): void {
  if (!isIP(ip)) {
    throw invalidValue(fieldName, 'must be a valid IP address');
  }
}
