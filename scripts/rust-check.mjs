// Runs the Rust checks when the workspace has a root Cargo.toml.
// The first Rust package creates that file (see the clean-code-rust skill).
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

if (!existsSync('Cargo.toml')) {
  console.log('rust:check skipped: no Cargo.toml at the repo root yet');
  process.exit(0);
}

const steps = [
  ['cargo', ['fmt', '--all', '--check']],
  ['cargo', ['clippy', '--workspace', '--all-targets', '--all-features', '--', '-D', 'warnings']],
  ['cargo', ['test', '--workspace']],
];

for (const [cmd, args] of steps) {
  const result = spawnSync(cmd, args, { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
