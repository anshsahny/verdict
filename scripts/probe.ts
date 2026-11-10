// Scratch probe for learning sandbox behaviour; prints status + redacted body. Not part of the app.
import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });
import { call, merchantCreds, redactValue, token } from '../lib/paypal-raw';

const [, , method = 'GET', path = '/v1/customer/disputes', jsonArg] = process.argv;

(async () => {
  const m = merchantCreds();
  if (path === 'scope') {
    const t = await token(m);
    console.log(t.scope.split(' ').filter((s) => /dispute|shipping|webhook|checkout|payments/.test(s)).join('\n'));
    return;
  }
  const r = await call(m, path, { method, json: jsonArg ? JSON.parse(jsonArg) : undefined });
  console.log(r.status, r.debugId ?? '');
  console.log(JSON.stringify(redactValue(r.body), null, 2).slice(0, 6000));
})();
