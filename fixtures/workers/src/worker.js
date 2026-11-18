// run.sh installs the tarball without saving it, so package.json cannot list it.
// eslint-disable-next-line n/no-extraneous-import
import * as sdk from '@automattic/akismet';
import { smoke } from '../../smoke.js';

export default {
  async fetch() {
    try {
      return new Response(await smoke(sdk));
    } catch (error) {
      return new Response(String(error?.stack ?? error), { status: 500 });
    }
  },
};
