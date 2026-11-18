import * as sdk from '@automattic/akismet';
import { smoke } from '../smoke.js';

console.log(`import: ${await smoke(sdk)}`);
