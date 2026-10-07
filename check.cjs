// Round-trip check over a folder of real journals (they are never committed):
//   mise run check [folder]   (default ~/Documents/Isatis.neo-mining)
const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert');
const X = require('./xjnl.js');

const root = process.argv.slice(2).find(a => a !== '-v') || path.join(os.homedir(), 'Documents', 'Isatis.neo-mining');
const files = fs.readdirSync(root, { recursive: true }).filter(f => f.endsWith('.xjnl')).map(f => path.join(root, f));
assert(files.length, `no .xjnl under ${root}`);

const firstTask = n => n.type === 'el' && n.name === 'task' ? n : (n.children || []).map(firstTask).find(Boolean);
const leaf = n => X.elements(n).length ? X.elements(n).map(leaf).find(Boolean) : n;
const unix = p => p.split(path.sep).join('/');
// the diff, applied either way, gives back both sides
const undiff = (a, b) => {
  const ops = X.diff(a, b), eol = a.includes('\r\n') ? '\r\n' : '\n', n = s => s.replace(/\r\n/g, '\n');
  assert.strictEqual(n(ops.filter(o => o.t !== '+').map(o => o.s).join(eol)), n(a), 'diff loses the old side');
  assert.strictEqual(n(ops.filter(o => o.t !== '-').map(o => o.s).join(eol)), n(b), 'diff loses the new side');
};
let edited = 0;
const scans = new Map();
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8'), name = path.relative(root, f);
  const doc = X.parse(src);
  assert.strictEqual(X.serialize(doc), src, `round-trip differs: ${name}`);
  scans.set(unix(name), X.scan(doc));

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

// references: the example resolves everything; real journals get a report, not a failure
const ex = X.scan(X.parse(fs.readFileSync(path.join(__dirname, 'exemplo', 'estimativa.xjnl'), 'utf8')));
assert.deepStrictEqual([...ex.refs.keys()].filter(w => !ex.defs.has(w)), [], 'example has undefined references');
assert.deepStrictEqual(X.names(`$(r['dip']) $(split(dom.table)[1]) $(",".join([f"{q}" for q in qs])) $("a" if s.x != "" else "b") $(f(k=1))`), ['r', 'split', 'dom', 'qs', 's', 'f']);
const missing = new Map();
for (const [p, s] of scans) {
  const k = X.known(p, s, q => scans.get(q));
  for (const w of s.refs.keys()) if (!k.has(w)) missing.set(w, [...(missing.get(w) || []), p]);
}
const top = [...missing].sort((a, b) => b[1].length - a[1].length);
console.log(`refs: ${top.length} names used without a definition in reach, in ${new Set(top.flatMap(t => t[1])).size} journals`);
if (process.argv.includes('-v')) for (const [w, ps] of top) console.log(`  ${w}  (${ps.length}) ${ps.slice(0, 2).join(', ')}`);
