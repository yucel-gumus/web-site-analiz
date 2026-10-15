// Projede yalnızca kullanıcının verdiği 9 renk kullanılabilir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const IZINLI = new Set(['#e5d6c5', '#c4a381', '#a38260', '#c88d85', '#b2675e', '#8c4b43', '#896756', '#644536', '#432c21']);
const dizin = new URL('../public/', import.meta.url);
const dosyalar = readdirSync(dizin).filter((f) => /\.(css|js|html)$/.test(f));

const YASAK = [
  [/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix|color)\(/i, 'renk fonksiyonu'],
  [/opacity|globalAlpha|backdrop-filter|box-shadow(?!: 0 0 0 1000px)|(?:repeating-)?(?:linear|radial|conic)-gradient|createLinearGradient|createRadialGradient/, 'karışım/saydamlık/gölge'],
  [/\btransparent\b/i, 'transparent'],
  [/\p{Extended_Pictographic}/u, 'emoji'],
];

for (const f of dosyalar) {
  const kaynak = readFileSync(new URL(f, dizin), 'utf8');
  test(`${f}: yalnızca palet renkleri`, () => {
    for (const m of kaynak.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []) {
      assert.ok(IZINLI.has(m.toLowerCase()), `izinsiz renk ${m}`);
    }
    for (const [re, ad] of YASAK) assert.doesNotMatch(kaynak, re, `${f}: ${ad} yasak`);
    assert.doesNotMatch(kaynak, /\b(?:white|black|red|blue|green|gray|grey|orange|yellow|purple|pink|cyan)\b(?=\s*[;'"])/i, 'adlandırılmış renk');
  });
}
