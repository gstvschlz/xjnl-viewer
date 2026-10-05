# xjnl-viewer

View and edit Isatis.neo batch journals (`.xjnl`) in the browser, on machines without an Isatis licence.

**https://gstvschlz.github.io/xjnl-viewer/**

- **Abrir pasta** (Edge/Chrome) lists every journal under a folder and saves in place with Ctrl+S. **Abrir arquivo** works anywhere; without the File System Access API, saving downloads a copy.
- Each task is a flat table of its values (`INPUT_DATASET › ROOT › file = Drillholes`). Empty values and `@automatic` stay hidden until *mostrar tudo*, and `$(…)` expressions are highlighted.
- Comments, arrays, `foreach`/`for`/`if` attributes, `python`, `message` and `include` are editable. Any block can be moved, duplicated, deleted or toggled with `disabled="block"`.
- *Buscar* filters the tasks; *Substituir tudo* replaces across values, comments and attributes (never `key`, `id` or `version`).

Files are read and written locally and are never uploaded. The page has no schema: it edits what the journal already contains, so new tasks come from duplicating an existing one.

## Fidelity

`xjnl.js` is a small tokenizer that keeps each node's source text. An unedited journal therefore serializes byte for byte (CRLF, CDATA, entity spelling, `<a/>` vs `<a></a>`), and an edit only rewrites the node it touches, so git diffs show just the change.

```
mise run check [folder]   # default ~/Documents/Isatis.neo-mining
```

The check round-trips every journal under the folder byte-identically, then verifies that duplicate/move/edit keep the file intact. Journals are never committed.

## Development

There is no build step. Open `index.html` through any static server; Pages serves `main` from the repository root.
