// Prints the Content-Security-Policy hashes for Lumen's inline scripts, as the server inlines them into index.html
// (src/Jellyfin.Plugin.Lumen/Injection/HtmlInjector.cs): the web plugin's definer, then the guard. Run after
// `npm run build`. The hashes change with every release, and the guard's differs when "Restyle Jellyfin's sign-in and
// settings pages" is on (the script is prefixed then). A strict policy needs the definer's and one of the guard's.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const read = (file) => readFileSync(new URL(`../dist/${file}`, import.meta.url), 'utf8');
const plugin = read('lumen-web-plugin.js');
const guard = read('lumen-guard.js');
const SKIN = "document.documentElement.setAttribute('data-lmn-skin','');";
const inline = (script) => script.replaceAll('</', '<\\/');
const hash = (script) => `'sha256-${createHash('sha256').update(inline(script), 'utf8').digest('base64')}'`;

console.log(`web plugin:         ${hash(plugin)}`);
console.log(`guard, restyle on:  ${hash(SKIN + guard)}`);
console.log(`guard, restyle off: ${hash(guard)}`);
