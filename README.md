# YPEA Studio

YPEA Studio, by Yarpiz, is a free browser app in which a researcher or practitioner describes an optimization problem visually, gets a usable answer from one quick run, and can then compare methods, share the project, or continue in Python with the [`ypea`](https://pypi.org/project/ypea/) package.

The app is under construction. The engine runs all six worked examples from the command line, with nine methods, and a first bare version of the web app runs them in the browser.

## Try it

The engine needs only Node 24 or newer. There is nothing to install.

```
node engine/cli.ts examples/linefit.json
node engine/cli.ts examples/knapsack.json --full
node --test
```

The same project file gives the same result every time, because every run is seeded.

The web app is in `web/` and has its own dependencies:

```
cd web
npm ci
npm run dev            # the app on a local address
npm test               # unit tests
npm run typecheck      # also checks the engine's types
npm run check:browser  # builds, then drives the installed Chrome at the root and under a subpath
```

## Layout

| Folder | Contents |
| --- | --- |
| `engine/` | The TypeScript engine: project file, translator for the limited Python syntax, generator, evaluator, constraints, nine methods, command line runner |
| `spec/` | The project file format, the language rules, the generator specification, and the cases that real Python and ypea answer |
| `examples/` | The six worked examples as project files, with their data as CSV |
| `export/` | The Python script exporter, the printable report, and results as CSV and JSON |
| `web/` | The app: React with Vite, the engine in a Web Worker, projects in browser storage |

## License

MIT. See `LICENSE`.
