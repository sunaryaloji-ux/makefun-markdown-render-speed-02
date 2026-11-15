[![make.fun](https://make.fun/badge/markdown-render-speed-02.svg)](https://make.fun/bounty/markdown-render-speed-02)
[![rank](https://make.fun/badge/markdown-render-speed-02/sunaryaloji-ux/makefun-markdown-render-speed-02/rank.svg)](https://make.fun/bounty/markdown-render-speed-02)
[![reward](https://make.fun/badge/markdown-render-speed-02/sunaryaloji-ux/makefun-markdown-render-speed-02/reward.svg)](https://make.fun/bounty/markdown-render-speed-02)

# Faster Markdown Renderer

A fast, dependency-free Markdown renderer: `parse.js` returns exactly the HTML
that [marked](https://github.com/markedjs/marked) 18.1.3 renders with its
default options (GFM on, breaks off, pedantic off), and `main.ts` is the
program the harness runs — it reads every case from `/input/cases.json`,
renders each one alone with `parse()`, and writes `/output/html.json`.

Built for the [make.fun bounty](https://make.fun/bounty/markdown-render-speed-02)
"Make Markdown rendering faster" ($250, top 20). On the practice set it
renders all 720 cases byte-identical to marked in ~0.9s, about 1.2× faster
than marked itself on this machine.

## Layout

- `parse.js` — the renderer (ES module, no dependencies, Node stdlib only)
- `main.ts` — the harness driver (Node 22, erasable TypeScript)

## License

MIT
