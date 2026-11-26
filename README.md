# YPEA Studio

YPEA Studio, by Yarpiz, is a free browser app in which a researcher or practitioner describes an optimization problem visually, gets a usable answer from one quick run, and can then compare methods, share the project, or continue in Python with the [`ypea`](https://pypi.org/project/ypea/) package.

- **The app:** https://smkalami.github.io/ypea-studio/
- **The guide:** https://smkalami.github.io/ypea-studio/guide.html

Everything runs in your browser. Nothing you type, import or compute is sent anywhere, and your projects are kept in the storage of your browser.

## What it does

- A workspace for one problem: data from CSV files, variables, an objective, constraints, helper functions, a drawing of the solution, and a test of a candidate by hand before any run.
- Six worked examples: calibration line fit, 0/1 knapsack, traveling salesman, vehicle routing, assignment and benchmark functions.
- Eleven kinds of variables, from decimal numbers to orderings and ordered groups.
- Nine solvers: Random Search, Particle Swarm Optimization, Differential Evolution, SHADE, Genetic Algorithm, Simulated Annealing, CMA-ES, Nelder-Mead and the Imperialist Competitive Algorithm.
- Experiments: a project keeps several solver setups, each with its own result. A comparison runs them several times with the same budget and describes the runs side by side, without naming a winner.
- Results that can be repeated: every run is seeded and stores the definition that produced it.
- Files to take away: the project with or without results, an HTML report, a Python script that repeats the run with `ypea`, results as CSV and JSON, and charts as SVG and PNG.

The guide explains each part, lists the limits, says how to cite the app, and holds the roadmap.

## Run it from the command line

The engine needs only Node 24 or newer. There is nothing to install.

```
node engine/cli.ts examples/linefit.json
node engine/cli.ts examples/knapsack.json --full
node --test
```

The same project file gives the same result every time, because every run is seeded.

## Work on the app

The web app is in `web/` and has its own dependencies:

```
cd web
npm ci
npm run dev            # the app on a local address, with the guide at /guide.html
npm test               # unit tests
npm run typecheck      # also checks the engine's types
npm run build          # the static site in web/dist: the app and the guide
npm run check:browser  # builds, then drives the installed Chrome at the root and under a subpath
```

## Layout

| Folder | Contents |
| --- | --- |
| `engine/` | The TypeScript engine: project file, translator for the limited Python syntax, generator, evaluator, constraints, nine methods, command line runner |
| `spec/` | The project file format, the language rules, the generator specification, and the cases that real Python and ypea answer |
| `examples/` | The six worked examples as project files, with their data as CSV |
| `export/` | The Python script exporter, the printable report, results as CSV and JSON, and the figures |
| `web/` | The app and its guide: React with Vite, the engine in a Web Worker, projects in browser storage |

## License

MIT. See `LICENSE`.
