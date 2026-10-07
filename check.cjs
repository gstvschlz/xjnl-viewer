// Round-trip check over a folder of real journals (they are never committed):
//   mise run check [folder]   (default ~/Documents/Isatis.neo-mining)
const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert');
const X = require('./xjnl.js');

const root = process.argv[2] || path.join(os.homedir(), 'Documents', 'Isatis.neo-mining');
const files = fs.readdirSync(root, { recursive: true }).filter(f => f.endsWith('.xjnl')).map(f => path.join(root, f));
assert(files.length, `no .xjnl under ${root}`);

const firstTask = n => n.type === 'el' && n.name === 'task' ? n : (n.children || []).map(firstTask).find(Boolean);
const leaf = n => X.elements(n).length ? X.elements(n).map(leaf).find(Boolean) : n;
// the diff, applied either way, gives back both sides
const undiff = (a, b) => {
  const ops = X.diff(a, b), eol = a.includes('\r\n') ? '\r\n' : '\n', n = s => s.replace(/\r\n/g, '\n');
  assert.strictEqual(n(ops.filter(o => o.t !== '+').map(o => o.s).join(eol)), n(a), 'diff loses the old side');
  assert.strictEqual(n(ops.filter(o => o.t !== '-').map(o => o.s).join(eol)), n(b), 'diff loses the new side');
};
let edited = 0;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8'), name = path.relative(root, f);
  const doc = X.parse(src);
  assert.strictEqual(X.serialize(doc), src, `round-trip differs: ${name}`);

  const batch = X.elements(doc)[0];
  const task = firstTask(doc);
  if (!task) continue;
  const parent = (function up(n) { return n.children.includes(task) ? n : X.elements(n).map(up).find(Boolean); })(batch);

  // duplicate + remove the copy, and down + up, restore the source exactly
  X.remove(parent, X.duplicate(parent, task));
  assert.strictEqual(X.serialize(doc), src, `duplicate/remove differs: ${name}`);
  if (X.blocks(parent).at(-1) !== task) {
    X.move(parent, task, 1); X.move(parent, task, -1);
    assert.strictEqual(X.serialize(doc), src, `move differs: ${name}`);
  }

  // copy + paste next to itself gives the same block; pasted elsewhere and removed restores the source
  const clip = X.copy(parent, task);
  const [twin] = X.paste(parent, task, clip, doc.eol);
  assert.strictEqual(X.serialize(twin), X.serialize(task), `copy/paste reindents: ${name}`);
  X.remove(parent, twin);
  const [far] = X.paste(batch, X.blocks(batch).at(-1), clip, doc.eol);
  assert.strictEqual(X.text(leaf(far)), X.text(leaf(task)), `paste changes a value: ${name}`);
  X.remove(batch, far);
  assert.strictEqual(X.serialize(doc), src, `paste/remove differs: ${name}`);

  // an edit with markup characters survives a re-parse, and the diff shows it both ways
  const p = leaf(task), tricky = 'a<b & "c" ]]> $(v)';
  X.setText(p, tricky, doc.eol);
  X.setAttr(task, 'disabled', 'block');
  const out = X.serialize(doc), again = X.parse(out);
  assert.strictEqual(X.text(leaf(firstTask(again))), tricky, `edit lost: ${name}`);
  assert.strictEqual(X.attr(firstTask(again), 'disabled').value, 'block');
  undiff(src, out); undiff(out, src);
  edited++;
}
console.log(`ok: ${files.length} journals round-trip byte-identical, ${edited} survived duplicate/move/copy/paste/edit/diff`);
