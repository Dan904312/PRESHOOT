/**
 * Pricing toggle + comparison (vanilla port of the shadcn card).
 * Run: node tests/pricing-ui.test.mjs
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const land = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
const pkg = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('  ✓', name);
  } catch (e) {
    failed += 1;
    console.error('  ✗', name, '\n   ', e.message);
  }
}

console.log('\n== Pricing UI ==');

test('landing uses a billing toggle, not a third invented plan', () => {
  assert.ok(land.includes('function setPricingCycle'));
  assert.ok(land.includes("setPricingCycle('monthly')"));
  assert.ok(land.includes("setPricingCycle('annually')"));
  assert.ok(land.includes('price-compare'));
  assert.ok(land.includes('Most Popular'));
  assert.ok(!land.includes('Dedicated Account Manager'));
  assert.ok(!land.includes('priceMonthly: 19'));
});

test('checkout contracts stay $9 / $79 with both Stripe links', () => {
  assert.ok(land.includes('<sup>$</sup>9') || land.includes('$9/mo') || land.includes('$9'));
  assert.ok(land.includes('<sup>$</sup>79') || land.includes('$79'));
  assert.ok(land.includes('https://buy.stripe.com/28EaEXa574Y9esvaEWa7C00'));
  assert.ok(land.includes('https://buy.stripe.com/dRm5kD0ux62d2JN00ia7C01'));
  assert.ok(land.includes('href="/app.html"'));
  assert.ok(app.includes("m: 'https://buy.stripe.com/28EaEXa574Y9esvaEWa7C00'"));
  assert.ok(app.includes("y: 'https://buy.stripe.com/dRm5kD0ux62d2JN00ia7C01'"));
  assert.ok(app.includes('onclick="selPlan(\'m\')"'));
  assert.ok(app.includes('onclick="selPlan(\'y\')"'));
  assert.ok(app.includes('onclick="upgradePro()"'));
});

test('repo stays vanilla HTML — no shadcn / Tailwind / lucide install', () => {
  assert.ok(!fs.existsSync(path.join(root, 'components.json')));
  assert.ok(!fs.existsSync(path.join(root, 'components/ui/pricing-card.tsx')));
  assert.ok(!pkg.includes('lucide-react'));
  assert.ok(!pkg.includes('@radix-ui/react-toggle-group'));
  assert.ok(!pkg.includes('class-variance-authority'));
});

if (failed) {
  console.error('\n' + failed + ' failed, ' + passed + ' passed');
  process.exit(1);
}
console.log('\n' + passed + ' passed');
