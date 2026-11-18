// The README promises that CommonJS projects on Node 22.12+ can require() the package.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- require() is what this fixture tests
const sdk = require('@automattic/akismet');

import('../smoke.js')
  .then(({ smoke }) => smoke(sdk))
  .then((message) => {
    console.log(`require: ${message}`);
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
