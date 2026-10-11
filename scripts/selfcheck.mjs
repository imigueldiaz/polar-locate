import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = import.meta.dirname;
const mods = ['pointing', 'astrometry', 'detect', 'trace', 'stops', 'meter', 'drift'];

let failed = false;
const orig = console.assert;
console.assert = (cond, ...msg) => {
  if (!cond) {
    failed = true;
    console.error('  ASSERT FAILED:', ...msg);
  }
};

for (const name of mods) {
  const url = pathToFileURL(join(dir, '..', 'src', 'lib', `${name}.ts`)).href;
  const mod = await import(url);
  if (typeof mod.selfCheck === 'function') {
    console.log(`- ${name}`);
    mod.selfCheck();
  }
}
console.assert = orig;

if (failed) {
  console.error('selfcheck: FAILED');
  process.exit(1);
}
console.log('selfcheck: all ok');
