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
