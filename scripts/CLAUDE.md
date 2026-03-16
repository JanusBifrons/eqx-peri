# /scripts — Physics & Logic Test Scripts

Plain Node.js scripts — no test framework, no bundler. Run directly:

```bash
node scripts/<name>.js
```

## Purpose

These scripts are **living documentation** for physics tuning decisions and attachment logic. They validate math and simulate edge cases that are hard to exercise in-game. Keep them up to date when you change the underlying constants.

## Conventions

- Each script is self-contained — no imports from `src/`. If you need shared constants, copy the relevant values or import from a JSON file.
- Print results to stdout; use `console.error` for failures.
- Name test scripts `test-<subject>.js` and debug scripts `debug-<subject>.js`.
- Document the "expected" output in a comment at the top of the file so a reader can tell at a glance if results are correct.

## Existing Scripts

| Script | Tests |
|--------|-------|
| `test-missiles.js` | Missile trajectory and phase timing |
| `test-missile-phases.js` | Phase transition thresholds |
| `test-missile-power.js` | Missile thrust at each power level |
| `test-missile-steering.js` | Proportional navigation math |
| `test-50x-scaling.js` | 50× unit scaling sanity check |
| `test-force-fix.js` | Engine force application correctness |
| `test-steering-math.js` | Arrive-steering velocity decomposition |
| `debug-attachment.js` | Attachment point generation |
| `debug-connections.js` | Connection graph BFS |
| `debug-b52.js` | B-52 ship layout connectivity |
| `debugShips.js` | General ship definition debug |
| `testB52.js` | B-52 physics simulation |
| `testConnections.js` | Connection detection correctness |
| `generateShips.ts` | TypeScript ship-definition generator (run via `ts-node`) |

---

MAINTENANCE MANDATE: If you add a new script, add it to the table above.
