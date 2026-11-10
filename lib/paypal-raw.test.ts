import { describe, expect, it } from 'vitest';
import { authAssertion, redact, redactValue } from './paypal-raw';

describe('redactValue', () => {
  it('removes tokens and personal fields at any depth', () => {
    const out = redactValue({
      access_token: 'A21AAsecret',
      payer: { email_address: 'buyer@example.com', name: { given_name: 'Ada', surname: 'L' }, payer_id: 'ABC123' },
      items: [{ email_address: 'x@y.z' }],
    });
    expect(out).toEqual({
      access_token: '[REDACTED]',
      payer: { email_address: '[REDACTED]', name: { given_name: '[REDACTED]', surname: '[REDACTED]' }, payer_id: 'ABC123' },
      items: [{ email_address: '[REDACTED]' }],
    });
  });
});

describe('redact', () => {
  it('scrubs bearer tokens and emails from free text', () => {
    expect(redact('token A21AAabc-123 for sb-buyer@personal.example.com')).toBe('token [REDACTED_TOKEN] for [REDACTED_EMAIL]');
  });
});

describe('authAssertion', () => {
  it('builds an unsigned JWT with the client id as issuer', () => {
    const [header, payload, sig] = authAssertion('client-1', { email: 'buyer@example.com' }).split('.');
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({ alg: 'none' });
    expect(JSON.parse(Buffer.from(payload, 'base64url').toString())).toEqual({ iss: 'client-1', email: 'buyer@example.com' });
    expect(sig).toBe('');
  });
});
