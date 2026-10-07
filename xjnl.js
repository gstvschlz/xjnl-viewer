// Lossless .xjnl tokenizer: every node keeps its source text, so an unedited
// journal serializes byte-for-byte and an edit only rewrites the node it touches.
const XJNL = (() => {
  const TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<\/[^\s>]+\s*>|<[A-Za-z_][^\s/>]*(?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*\s*\/?>|[^<]+/y;
  const ATTR = /(\s+)([^\s=/>]+)(\s*=\s*)(["'])([\s\S]*?)\4/y;

  const decode = s => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1))
      : { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()]);
  const escText = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escAttr = (s, q) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(q === '"' ? /"/g : /'/g, q === '"' ? '&quot;' : '&apos;');

  function parseStart(raw) {
    const name = raw.match(/^<([^\s/>]+)/)[1];
    const attrs = [];
    let pos = name.length + 1, m;
    while ((ATTR.lastIndex = pos, m = ATTR.exec(raw))) {
      attrs.push({ ws: m[1], name: m[2], eq: m[3], q: m[4], value: decode(m[5]), raw: m[0] });
      pos = ATTR.lastIndex;
    }
    const rest = raw.slice(pos);
    const selfClosing = rest.trimStart().startsWith('/');
    return { type: 'el', name, attrs, tail: rest.slice(0, rest.length - (selfClosing ? 2 : 1)), selfClosing, children: [], close: null };
  }

  function parse(src) {
    const doc = { type: 'doc', children: [], eol: src.includes('\r\n') ? '\r\n' : '\n' };
    const stack = [doc];
    TOKEN.lastIndex = 0;
    while (TOKEN.lastIndex < src.length) {
      const at = TOKEN.lastIndex, m = TOKEN.exec(src);
      if (!m) throw new Error(`malformed XML at offset ${at}: ${JSON.stringify(src.slice(at, at + 40))}`);
      const t = m[0], top = stack[stack.length - 1];
      if (t.startsWith('<!--')) top.children.push({ type: 'comment', raw: t });
      else if (t.startsWith('<![CDATA[')) top.children.push({ type: 'cdata', raw: t });
      else if (t.startsWith('<?')) top.children.push({ type: 'pi', raw: t });
      else if (t.startsWith('</')) {
        const name = t.slice(2).trim().slice(0, -1).trim();
        if (top.type !== 'el' || top.name !== name) throw new Error(`unexpected </${name}> at offset ${at}`);
        top.close = t;
        stack.pop();
      } else if (t[0] === '<') {
        const el = parseStart(t);
        if (open(el) !== t) throw new Error(`cannot round-trip tag at offset ${at}: ${t}`);
        top.children.push(el);
        if (!el.selfClosing) stack.push(el);
      } else top.children.push({ type: 'text', raw: t });
    }
    if (stack.length > 1) throw new Error(`unclosed <${stack[stack.length - 1].name}>`);
    return doc;
  }

  const open = el => `<${el.name}${el.attrs.map(a => a.raw).join('')}${el.tail}${el.selfClosing && !el.children.length ? '/>' : '>'}`;

  function serialize(n) {
    if (n.type !== 'el' && n.type !== 'doc') return n.raw;
    const inner = n.children.map(serialize).join('');
    if (n.type === 'doc') return inner;
    if (n.selfClosing && !n.children.length) return open(n);
    return open(n) + inner + (n.close || `</${n.name}>`);
  }

  // values -----------------------------------------------------------------
  const value = n => n.type === 'cdata' ? n.raw.slice(9, -3) : n.type === 'comment' ? n.raw.slice(4, -3) : decode(n.raw);
  const elements = n => n.children.filter(c => c.type === 'el');
  const blocks = n => n.children.filter(c => c.type === 'el' || c.type === 'comment');
  const attr = (el, name) => el.attrs.find(a => a.name === name);
  const text = el => el.children.filter(c => c.type === 'text' || c.type === 'cdata').map(value).join('');

  function setValue(n, v) {
    if (n.type === 'cdata') n.raw = `<![CDATA[${v.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
    else if (n.type === 'comment') n.raw = `<!--${v.replace(/--/g, '- -')}-->`;
    else n.raw = escText(v);
  }

  function setText(el, v, eol = '\n') {
    v = v.replace(/\r?\n/g, eol);
    if (v === text(el)) return;
    const keep = el.children.find(c => c.type === 'cdata') || el.children.find(c => c.type === 'text') || { type: 'text' };
    setValue(keep, v);
    el.children = v ? [keep] : [];
  }

  function setAttr(el, name, v) {
    let a = attr(el, name);
    if (v == null) { el.attrs = el.attrs.filter(x => x !== a); return; }
    if (!a) el.attrs.unshift(a = { ws: ' ', name, eq: '=', q: '"' });
    a.value = v;
    a.raw = `${a.ws}${name}${a.eq}${a.q}${escAttr(v, a.q)}${a.q}`;
  }

  // structure: blocks move among block siblings; the whitespace text nodes stay put
  function move(parent, n, dir) {
    const sib = blocks(parent), j = sib.indexOf(n) + dir;
    if (j < 0 || j >= sib.length) return;
    const a = parent.children.indexOf(n), b = parent.children.indexOf(sib[j]);
    [parent.children[a], parent.children[b]] = [parent.children[b], parent.children[a]];
  }

  const indentOf = (parent, i) => {
    const prev = parent.children[i - 1];
    return prev && prev.type === 'text' && !prev.raw.trim() ? prev : null;
  };

  function duplicate(parent, n) {
    const i = parent.children.indexOf(n), ws = indentOf(parent, i);
    const copy = parse(serialize(n)).children[0];
    parent.children.splice(i + 1, 0, ...(ws ? [{ type: 'text', raw: ws.raw }] : []), copy);
    return copy;
  }

  function remove(parent, n) {
    const i = parent.children.indexOf(n), ws = indentOf(parent, i);
    parent.children.splice(ws ? i - 1 : i, ws ? 2 : 1);
  }

  // find & replace over values: text, CDATA, comments and attributes other than the schema ids
  const FIXED = new Set(['key', 'id', 'version']);
  function replaceAll(n, re, by, eol = '\n') {
    let count = 0;
    const sub = s => s.replace(re, () => (count++, by));
    (function walk(n) {
      if (n.type === 'el') for (const a of n.attrs) if (!FIXED.has(a.name)) { const v = sub(a.value); if (v !== a.value) setAttr(n, a.name, v); }
      for (const c of n.children || []) {
        if (c.type === 'el') walk(c);
        else if (c.type !== 'pi' && (c.type !== 'text' || c.raw.trim())) {
          const v = value(c), w = sub(v);
          if (w !== v) setValue(c, w.replace(/\r?\n/g, eol));
        }
      }
    })(n);
    return count;
  }

  // copy & paste: a copied block carries its indentation relative to itself, and a
  // pasted one takes the indentation of the block it lands after. Only whitespace-only
  // text nodes move, so values and python code are never touched
  const indent = ws => ws ? ws.raw.slice(ws.raw.lastIndexOf('\n') + 1) : '';
  function reindent(n, from, to) {
    for (const c of n.children || []) {
      if (c.type === 'el') reindent(c, from, to);
      else if (c.type === 'text' && !c.raw.trim() && c.raw.includes('\n'))
        c.raw = c.raw.replace(/\n([ \t]*)/g, (m, sp) => '\n' + (sp.startsWith(from) ? to + sp.slice(from.length) : sp));
    }
  }

  function copy(parent, n) {
    const c = parse(serialize(n)).children[0];
    reindent(c, indent(indentOf(parent, parent.children.indexOf(n))), '');
    return serialize(c);
  }

  // throws on text that is not XML; returns the pasted blocks (none if the text had no element)
  function paste(parent, n, src, eol = '\n') {
    const add = blocks(parse(src.replace(/\r?\n/g, eol)));
    const i = parent.children.indexOf(n), ws = indentOf(parent, i);
    add.forEach(b => reindent(b, '', indent(ws)));
    parent.children.splice(i + 1, 0, ...add.flatMap(b => [{ type: 'text', raw: ws ? ws.raw : eol }, b]));
    return add;
  }

  // line diff (Myers) between two sources: [{ t: ' ' | '-' | '+', s, a, b }] with 1-based line numbers
  function diff(x, y) {
    const A = x.split(/\r?\n/), B = y.split(/\r?\n/);
    let s = 0, e = 0;
    while (s < A.length && s < B.length && A[s] === B[s]) s++;
    while (e < A.length - s && e < B.length - s && A[A.length - 1 - e] === B[B.length - 1 - e]) e++;
    const a = A.slice(s, A.length - e), b = B.slice(s, B.length - e), n = a.length, m = b.length;
    const mid = [], max = n + m, v = new Int32Array(2 * max + 3), trace = [];
    const at = (t, k) => t[1][k - t[0]];
    let found = !max;
    for (let d = 0; d <= Math.min(max, 3000) && !found; d++) {
      trace.push([-d - 1, v.slice(max - d, max + d + 3)]);
      for (let k = -d; k <= d && !found; k += 2) {
        let i = k === -d || (k !== d && v[max + k] < v[max + k + 2]) ? v[max + k + 2] : v[max + k] + 1, j = i - k;
        while (i < n && j < m && a[i] === b[j]) i++, j++;
        v[max + k + 1] = i;
        found = i >= n && j >= m;
      }
    }
    if (!found) { // too different to be worth aligning: all out, all in
      a.forEach((l, i) => mid.push({ t: '-', s: l, a: s + i + 1 }));
      b.forEach((l, j) => mid.push({ t: '+', s: l, b: s + j + 1 }));
    } else {
      let i = n, j = m;
      for (let d = trace.length - 1; d >= 0; d--) {
        const t = trace[d], k = i - j;
        const pk = k === -d || (k !== d && at(t, k - 1) < at(t, k + 1)) ? k + 1 : k - 1, pi = at(t, pk), pj = pi - pk;
        while (i > pi && j > pj) { i--, j--; mid.push({ t: ' ', s: a[i], a: s + i + 1, b: s + j + 1 }); }
        if (d) i > pi ? mid.push({ t: '-', s: a[--i], a: s + i + 1 }) : mid.push({ t: '+', s: b[--j], b: s + j + 1 });
      }
      mid.reverse();
    }
    const same = (l, i, o) => ({ t: ' ', s: l, a: i + 1 + o, b: i + 1 + o + B.length - A.length });
    return [...A.slice(0, s).map((l, i) => ({ t: ' ', s: l, a: i + 1, b: i + 1 })), ...mid, ...A.slice(A.length - e).map((l, i) => same(l, i, A.length - e))];
  }

  // references: every $(...) is a python expression over batch names. Names come from
  // array/variable, foreach/for (and param-level repeat) loops, python blocks and includes
  const EXPR = /\$\((?:[^()]|\([^()]*\))*\)/g;
  const KW = new Set('False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield'.split(' '));
  const BUILTIN = new Set(('abs all any ascii bin bool bytearray bytes callable chr classmethod compile complex delattr dict dir divmod enumerate eval exec filter float format frozenset getattr globals hasattr hash hex id input int isinstance issubclass iter len list locals map max min next object oct open ord pow print property range repr reversed round set setattr slice sorted staticmethod str sum super tuple type vars zip __import__ __name__ __file__ app Exception ValueError TypeError KeyError IndexError').split(' '));
  const STR = /[rbuf]*("""|'''|"|')(?:\\[\s\S]|(?!\1)[^\\])*?\1/gi;
  const words = s => s.match(/[A-Za-z_]\w*/g) || [];

  function free(expr) {
    const s = expr.replace(STR, '""'), bound = new Set();
    for (const m of s.matchAll(/\bfor\s+([\w\s,()]+?)\s+in\b|\blambda\b([^:]*):/g)) words(m[1] || m[2]).forEach(w => bound.add(w));
    const out = new Set();
    for (const m of s.matchAll(/(\.\s*)?\b([A-Za-z_]\w*)\b(\s*=(?!=))?/g))
      if (!m[1] && !m[3] && !KW.has(m[2]) && !BUILTIN.has(m[2]) && !bound.has(m[2])) out.add(m[2]);
    return [...out];
  }
  const names = s => [...new Set([...s.matchAll(EXPR)].flatMap(m => free(m[0].slice(2, -1))))];

  function pyDefs(code) {
    const s = code.replace(STR, '""').replace(/#.*/g, ''), out = [];
    for (const m of s.matchAll(/^[ \t]*([\w \t,.()[\]*"]+?)\s*(?:[-+*/%&|^@]|\/\/|\*\*|>>|<<)?=(?!=)/gm)) out.push(...words(m[1].replace(/\.\s*\w+|\[[^\]]*\]/g, '')));
    for (const m of s.matchAll(/\b(?:def|class)\s+(\w+)|\bas\s+(\w+)|(\w+)\s*:=|\bfor\s+([\w\s,()]+?)\s+in\b|\bglobal\s+([\w \t,]+)/g)) out.push(...words(m.slice(1).find(Boolean)));
    for (const m of s.matchAll(/^[ \t]*import\s+(.+)|^[ \t]*from\s+\S+\s+import\s+\(?([^)\n]+)/gm))
      for (const part of (m[1] || m[2]).split(',')) { const w = words(part.replace(/\.\w+/g, '')); w.length && out.push(w.at(-1)); }
    return out;
  }

  const LOOP = n => n.name === 'foreach' || n.name === 'for' || attr(n, 'repeat');
  const EXPR_ATTR = { foreach: ['array'], for: ['start', 'end'], if: ['condition'], elseif: ['condition'] };

  // { defs: Set, includes: [file], refs: Map name -> count }
  function scan(doc) {
    const defs = new Set(), includes = [], refs = new Map();
    const use = list => list.forEach(w => refs.set(w, (refs.get(w) || 0) + 1));
    (function walk(n) {
      if (n.type === 'el') {
        if ((n.name === 'array' || n.name === 'variable') && attr(n, 'name')) defs.add(attr(n, 'name').value);
        if (LOOP(n)) for (const k of ['element', 'index']) if (attr(n, k)) words(attr(n, k).value).forEach(w => defs.add(w));
        if (n.name === 'include' && attr(n, 'file')) includes.push(attr(n, 'file').value);
        if (n.name === 'python') pyDefs(text(n)).forEach(w => defs.add(w));
        const bare = EXPR_ATTR[n.name] || (attr(n, 'repeat') ? ['array', 'start', 'end'] : []);
        for (const a of n.attrs) use(!a.value.includes('$(') && bare.includes(a.name) ? free(a.value) : names(a.value));
      }
      if (n.name === 'comment') return; // documentation: Isatis prints it as written
      for (const c of n.children || []) {
        if (c.type === 'el') walk(c);
        else if (c.type !== 'comment' && c.type !== 'pi') use(names(value(c)));
        // a task's own python (SCRIPT params) shares names with the batch through `global`
        if (c.type === 'cdata') for (const m of value(c).matchAll(/\bglobal\s+([\w \t,]+)/g)) words(m[1]).forEach(w => defs.add(w));
      }
    })(doc);
    return { defs, includes, refs };
  }

  // names a journal can see: its own plus those of the files it includes, recursively.
  // include paths are relative to the including file; get(path) -> scan or undefined
  const resolve = (path, file) => (path.slice(0, path.lastIndexOf('/') + 1) + file.replace(/\\/g, '/'))
    .split('/').reduce((a, s) => (s === '..' ? a.pop() : s && s !== '.' && a.push(s), a), []).join('/');
  function known(path, own, get, seen = new Set([path])) {
    const out = new Set(own.defs);
    for (const f of own.includes) {
      const p = resolve(path, f), s = !seen.has(p) && get(p);
      if (s) { seen.add(p); known(p, s, get, seen).forEach(w => out.add(w)); }
    }
    return out;
  }

  return { parse, serialize, value, setValue, elements, blocks, attr, text, setText, setAttr, move, duplicate, remove, replaceAll, copy, paste, diff, names, scan, resolve, known };
})();
if (typeof module !== 'undefined') module.exports = XJNL;
