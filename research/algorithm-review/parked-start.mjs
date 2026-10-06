// Read-only reproducer for the real scheduler, using Node's TypeScript support.
// Run from any directory with Node 24+ and the workspace dependencies installed.
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

// The application uses extensionless imports; resolve them for this standalone script.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context);
    }
    return nextResolve(specifier, context);
  },
});

const { chooseStart } = await import('../../packages/gateway/src/engine/v2/v2-start-order.ts');
const order = ['p1', 'p2', 'p3', 'next'];
// Only fields consumed by chooseStart are needed for this direct state reproducer.
const tasks = Object.fromEntries(
  order.map((id) => [id, { id, status: id === 'next' ? 'pending' : 'parked', selected: [] }]),
);
const definitions = new Map(
  order.map((id) => [
    id,
    {
      id,
      couplings:
        id === 'next'
          ? order.slice(0, 3).map((partner) => ({ with: partner, type: 'semantic' }))
          : [],
    },
  ]),
);
const context = {
  state: { order, tasks },
  env: { config: { agents: 2 }, tasks: definitions },
};

console.info(
  JSON.stringify({
    case: 'three parked neighbors; no running work',
    choice: chooseStart(context, ['next'], 'dependency'),
  }),
);
for (const id of order.slice(0, 3)) tasks[id].status = 'dropped';
console.info(
  JSON.stringify({
    case: 'same neighbors, terminal as dropped',
    choice: chooseStart(context, ['next'], 'dependency'),
  }),
);
