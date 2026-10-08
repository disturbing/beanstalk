/**
 * The stub executor's whole behaviour, pure (used until the container executor lands, and on
 * staging): each step is "run" by echoing it. `echo` prints its text with `${{ secrets.X }}`,
 * `matrix`, `inputs`, `needs` and `github.sha` filled in; `echo "k=v" >> $GITHUB_OUTPUT` sets a
 * step output; `exit N` (N > 0) fails the step and skips the rest. Job outputs are then
 * evaluated from the step outputs. Nothing runs.
 */
import type {
  JobLogBatch,
  JobResult,
  JobSpec,
  LogLine,
  StepView,
} from '@beanstalk/shared-race/actions';

/** A step that sleeps this long or more makes the stub job hang (cancel and timeout tests). */
const HANG_SECONDS = 60;

/** Whether the stub should leave this job running (a long `sleep`). */
export function stubHangs(spec: JobSpec): boolean {
  return spec.steps.some((step) =>
    [...(step.run ?? '').matchAll(/^\s*sleep\s+(\d+)/gm)].some(
      (match) => Number(match[1]) >= HANG_SECONDS,
    ),
  );
}

/** The log batch and the result an echo of `spec` produces. */
export function echoJob(
  spec: JobSpec,
  secrets: Readonly<Record<string, string>>,
  clock: { readonly startedMs: number; readonly nowIso: string },
): { readonly batch: JobLogBatch; readonly result: JobResult } {
  const lines: LogLine[] = [
    { step: null, at: clock.nowIso, text: `stub executor: ${spec.displayName} on ${spec.image}` },
  ];
  const steps: StepView[] = [];
  const stepOutputs: Record<string, Record<string, string>> = {};
  let failed = false;
  for (const step of spec.steps) {
    if (failed) {
      steps.push({
        number: step.number,
        name: step.name,
        status: 'completed',
        conclusion: 'skipped',
        startedAt: null,
        completedAt: null,
      });
      continue;
    }
    lines.push({ step: step.number, at: clock.nowIso, text: `▶ ${step.name}` });
    const ran = echoStep(step.run, step.uses, (text) => fill(text, spec, secrets, stepOutputs));
    for (const text of ran.lines) lines.push({ step: step.number, at: clock.nowIso, text });
    if (step.id !== null) stepOutputs[step.id] = ran.outputs;
    failed = ran.exitCode !== 0;
    steps.push({
      number: step.number,
      name: step.name,
      status: 'completed',
      conclusion: failed ? 'failure' : 'success',
      startedAt: clock.nowIso,
      completedAt: clock.nowIso,
    });
  }
  const outputs = Object.fromEntries(
    Object.entries(spec.outputs).map(([name, expression]) => [
      name,
      fill(expression, spec, secrets, stepOutputs),
    ]),
  );
  return {
    batch: { seq: 1, lines, steps },
    result: {
      conclusion: failed ? 'failure' : 'success',
      outputs,
      durationMs: Math.max(0, Date.parse(clock.nowIso) - clock.startedMs),
      minutesBilled: 1,
      steps,
      error: null,
    },
  };
}

function echoStep(
  run: string | null,
  uses: string | null,
  fillText: (text: string) => string,
): { lines: string[]; outputs: Record<string, string>; exitCode: number } {
  if (run === null)
    return { lines: [`stub: would run ${uses ?? 'nothing'}`], outputs: {}, exitCode: 0 };
  const lines: string[] = [];
  const outputs: Record<string, string> = {};
  for (const command of run
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')) {
    lines.push(`$ ${command}`);
    const output = /^echo\s+["']?([^"'>]*?)["']?\s*>>\s*"?\$GITHUB_OUTPUT"?$/.exec(command);
    const exit = /^exit\s+(\d+)$/.exec(command);
    if (output !== null) {
      const [name, ...value] = fillText(output[1] ?? '').split('=');
      if (name !== undefined) outputs[name] = value.join('=');
    } else if (exit !== null && Number(exit[1]) !== 0) {
      return { lines: [...lines, `exit code ${exit[1]}`], outputs, exitCode: Number(exit[1]) };
    } else if (command.startsWith('echo ')) {
      lines.push(fillText(command.slice(5).replace(/^["']|["']$/g, '')));
    }
  }
  return { lines, outputs, exitCode: 0 };
}

/** `${{ … }}` filled from the few contexts the stub knows; anything else stays as written. */
function fill(
  text: string,
  spec: JobSpec,
  secrets: Readonly<Record<string, string>>,
  stepOutputs: Readonly<Record<string, Readonly<Record<string, string>>>>,
): string {
  return text.replaceAll(/\$\{\{\s*([^}]+?)\s*\}\}/g, (whole, expression: string) => {
    const [context, first, second, third] = expression.split('.');
    switch (context ?? '') {
      case 'secrets':
        return secrets[(first ?? '').toUpperCase()] ?? '';
      case 'matrix':
        return String(spec.matrix?.[first ?? ''] ?? '');
      case 'inputs':
        return spec.inputs[first ?? ''] ?? '';
      case 'github':
        return first === 'sha' ? spec.context.sha : whole;
      case 'needs':
        return second === 'outputs' ? (spec.needs[first ?? '']?.outputs[third ?? ''] ?? '') : whole;
      case 'steps':
        return second === 'outputs' ? (stepOutputs[first ?? '']?.[third ?? ''] ?? '') : whole;
      default:
        return whole;
    }
  });
}
