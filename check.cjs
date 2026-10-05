// Round-trip check over a folder of real journals (they are never committed):
//   mise run check [folder]   (default ~/Documents/Isatis.neo-mining)
const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert');
const X = require('./xjnl.js');

const root = process.argv[2] || path.join(os.homedir(), 'Documents', 'Isatis.neo-mining');
const files = fs.readdirSync(root, { recursive: true }).filter(f => f.endsWith('.xjnl')).map(f => path.join(root, f));
assert(files.length, `no .xjnl under ${root}`);

const firstTask = n => n.type === 'el' && n.name === 'task' ? n : (n.children || []).map(firstTask).find(Boolean);
const leaf = n => X.elements(n).length ? X.elements(n).map(leaf).find(Boolean) : n;
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

  // an edit with markup characters survives a re-parse
  const p = leaf(task), tricky = 'a<b & "c" ]]> $(v)';
  X.setText(p, tricky, doc.eol);
  X.setAttr(task, 'disabled', 'block');
  const again = X.parse(X.serialize(doc));
  assert.strictEqual(X.text(leaf(firstTask(again))), tricky, `edit lost: ${name}`);
  assert.strictEqual(X.attr(firstTask(again), 'disabled').value, 'block');
  edited++;
}
console.log(`ok: ${files.length} journals round-trip byte-identical, ${edited} survived duplicate/move/edit`);
