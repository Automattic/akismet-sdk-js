import * as sdk from '@automattic/akismet';
import { smoke } from '../smoke.js';

console.log(await smoke(sdk));
