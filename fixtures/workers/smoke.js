// Runs src/worker.js in workerd through wrangler and asks it to run the smoke test.
import { unstable_startWorker } from 'wrangler';

// A build error (such as an unresolvable import) is logged but leaves wrangler
// waiting, so a run that has not answered by now has failed.
setTimeout(() => {
  throw new Error('worker did not answer within 60s; see the wrangler output above');
}, 60_000).unref();

const worker = await unstable_startWorker({
  config: 'wrangler.json',
  dev: { server: { port: 0 }, inspector: false },
});
try {
  const response = await worker.fetch('http://fixture.test/');
  const text = await response.text();
  if (!response.ok) throw new Error(`worker answered ${response.status}: ${text}`);
  console.log(text);
} finally {
  await worker.dispose();
}
