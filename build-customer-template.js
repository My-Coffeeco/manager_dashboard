// Deterministic packaging: the same HTML/CSS/JS becomes the editor-only Liquid preview.
// No theme upload or production connection occurs here.
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8');
const css = read('customer.css').replace(/@font-face\{[^}]+\}/, '');
const script = read('customer.js');
const customer = read('customer.html')
  .replace('<link rel="stylesheet" href="/customer.css">', `<style>${css}</style>`)
  .replace('<script src="/customer.js" defer></script>', '')
  .replace('</body>', `<script>${script}</script></body>`)
  .replace('src="/logo.avif"', 'src="{{ \'logo_cleaned.avif\' | file_url }}"')
  .replace('data-runtime="render-preview"', 'data-runtime="shopify-editor"')
  .replace(/<a href="\/manager" id="manager-return">[\s\S]*?<\/a>/, '<span id="manager-return">Shopify editor-only review</span>');
const output = `{% layout none %}\n{% comment %}PRIVATE EDITOR PREVIEW ONLY. No customer data or production API calls. Upload only to a NEW UNPUBLISHED theme. Never main theme 147584581741.{% endcomment %}\n{% if request.design_mode %}\n${customer}\n{% else %}\n<!doctype html><html lang="en"><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><title>Not available</title><p>This preview is available only in the authenticated Shopify theme editor.</p></html>\n{% endif %}\n`;
if (process.argv.includes('--check')) {
  if (read('index.mcc-customer-preview.liquid') !== output) throw new Error('Customer Liquid preview needs rebuilding.');
  console.log('Customer template matches source.');
} else {
  fs.writeFileSync(path.join(__dirname, 'index.mcc-customer-preview.liquid'), output);
  console.log('Built editor-only customer preview from shared source.');
}
