import { readFileSync, writeFileSync } from 'node:fs';
import yaml from 'js-yaml';

const [, , input, output] = process.argv;
if (!input || !output) {
  console.error('usage: yaml-to-json.mjs <input.yaml> <output.json>');
  process.exit(1);
}

writeFileSync(output, JSON.stringify(yaml.load(readFileSync(input, 'utf8')), null, 2));
