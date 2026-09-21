import { gzipSync } from 'node:zlib';
import { readFileSync, statSync } from 'node:fs';

// PRD §6.1: the snippet must stay under 8 KB, without dependencies.
const LIMIT = 8 * 1024;
const file = 'tracking/pulse.min.js';
const bytes = statSync(file).size;
const gz = gzipSync(readFileSync(file)).length;

console.log(`${file}: ${bytes} B (${gz} B gzipped), limit ${LIMIT} B`);
if (bytes > LIMIT) {
  console.error(`tracking script is ${bytes - LIMIT} B over the 8 KB budget`);
  process.exit(1);
}
