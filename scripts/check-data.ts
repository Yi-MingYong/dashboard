/**
 * Refuses to build when raw data files are present in data/ or public/, so sensitive
 * source files can never be deployed or committed by accident. Data is published via
 * Beheer in the dashboard and stored in Cloudflare D1 (EU), never in the repository.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = /\.(xlsx|xlsm|xls|csv|tsv|ris|bib|json\.gz|zip|sqlite|db)$/i;

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const offenders = [...walk(join(root, 'data')), ...walk(join(root, 'public'))].filter((p) => RAW.test(p));
if (offenders.length) {
  console.error('✗ Gegevensbestanden gevonden die niet in de repository of de build horen:');
  for (const p of offenders) console.error(`  - ${relative(root, p)}`);
  console.error('  Publiceer gegevens via Beheer in het dashboard en verwijder deze bestanden.');
  process.exit(1);
}
console.log('✓ Geen gegevensbestanden in data/ of public/.');
