const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load() {
  const window = {};
  const ctx = vm.createContext({ window, setTimeout, console });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../assets/fx.js'), 'utf8'), ctx);
  return window.QOJFX;
}

test('podium maps ranks 1-3 to classes and medals', () => {
  const fx = load();
  assert.deepStrictEqual({ ...fx.podium(1, 5) }, { cls: 'podium-gold', medal: '\u{1F947}' });
  assert.strictEqual(fx.podium(2, 5).cls, 'podium-silver');
  assert.strictEqual(fx.podium(3, 1).cls, 'podium-bronze');
});

test('podium ties share a rank, rank > 3 is null', () => {
  const fx = load();
  assert.strictEqual(fx.podium(1, 4).cls, fx.podium(1, 4).cls);
  assert.strictEqual(fx.podium(4, 9), null);
  assert.strictEqual(fx.podium(0, 9), null);
});

test('podium is null when nothing solved', () => {
  const fx = load();
  assert.strictEqual(fx.podium(1, 0), null);
  assert.strictEqual(fx.podium(1, -1), null);
});

test('burst is a no-op without a DOM', () => {
  const fx = load();
  assert.strictEqual(fx.burst(null), 0);
});
