// Prints the Content-Security-Policy hashes for Lumen's inline guard, as the server inlines it into index.html
// (src/Jellyfin.Plugin.Lumen/Injection/HtmlInjector.cs). Run after `npm run build`. The hash changes with every
// release, and differs when "Restyle Jellyfin's sign-in and settings pages" is on (the script is prefixed then).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const guard = readFileSync(new URL('../dist/lumen-guard.js', import.meta.url), 'utf8');
const SKIN = "document.documentElement.setAttribute('data-lmn-skin','');";
const inline = (script) => script.replaceAll('</', '<\\/');
const hash = (script) => `'sha256-${createHash('sha256').update(inline(script), 'utf8').digest('base64')}'`;

console.log(`restyle on:  ${hash(SKIN + guard)}`);
console.log(`restyle off: ${hash(guard)}`);
