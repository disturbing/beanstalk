/**
 * Where a job's secrets come from and its log batches and result go. In production that is the
 * gateway's `ActionsJobs` entrypoint (lane 1's control plane), called with the job's report
 * token; it relays batches to watchers and writes each as a gzip chunk in R2. A test stack
 * without the control plane uses the standalone sink: batches as gzip chunks in this Worker's
 * own bucket, secrets from the `STANDALONE_SECRETS` Wrangler secret.
 */
import type { ActionsJobSink, JobLogBatch, JobResult, JobSpec, RpcResult } from '../contract';

export type JobSink = {
  /** The values of the job's secret names. Never logged, never stored. */
  secrets(): Promise<Readonly<Record<string, string>>>;
  /** One batch; true when the control plane asks the job to stop. */
  logs(batch: JobLogBatch): Promise<{ readonly cancelRequested: boolean }>;
  finished(result: JobResult): Promise<void>;
};

/** The control plane refused or failed a call; `isRetryable` for a 5xx. */
export class SinkError extends Error {
  readonly code: string;
  readonly isRetryable: boolean;

  constructor(
    operation: string,
    error: { readonly code: string; readonly status: number; readonly message: string },
  ) {
    super(`${operation}: ${error.code} (${error.status}): ${error.message}`);
    this.name = 'SinkError';
    this.code = error.code;
    this.isRetryable = error.status >= 500;
  }
}

/** The sink for `spec`, by the Worker's `SINK_MODE`. */
export function sinkFor(spec: JobSpec, env: Env, mode: 'service' | 'standalone'): JobSink {
  if (mode === 'standalone') return standaloneSink(spec, env);
  const binding: unknown = Reflect.get(env, 'ACTIONS_JOBS');
  if (!isActionsJobSink(binding))
    throw new Error('SINK_MODE is service but ACTIONS_JOBS is not the gateway sink');
  return serviceSink(binding, spec.report.token);
}

export function serviceSink(sink: ActionsJobSink, reportToken: string): JobSink {
  return {
    secrets: async () => valueOf('actionsJobSecrets', await sink.actionsJobSecrets(reportToken)),
    logs: async (batch) => valueOf('actionsJobLogs', await sink.actionsJobLogs(reportToken, batch)),
    finished: async (result) => {
      valueOf('actionsJobFinished', await sink.actionsJobFinished(reportToken, result));
    },
  };
}

/** Batches and the result in `ACTIONS_LOGS` under `standalone/<owner>/<repo>/<run>/<job>/`. */
export function standaloneSink(spec: JobSpec, env: Env): JobSink {
  const prefix = `standalone/${spec.repo.fullName}/${spec.runId}/${spec.jobId}`;
  return {
    secrets: async () => standaloneSecrets(env, spec.secretNames),
    logs: async (batch) => {
      const name = `${prefix}/${String(batch.seq).padStart(6, '0')}.json.gz`;
      await env.ACTIONS_LOGS.put(name, await gzip(JSON.stringify(batch)), {
        httpMetadata: { contentType: 'application/json', contentEncoding: 'gzip' },
      });
      return { cancelRequested: false };
    },
    finished: async (result) => {
      await env.ACTIONS_LOGS.put(`${prefix}/result.json`, JSON.stringify(result), {
        httpMetadata: { contentType: 'application/json' },
      });
    },
  };
}

export async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function gunzip(bytes: ArrayBuffer): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

function standaloneSecrets(env: Env, names: readonly string[]): Record<string, string> {
  const raw: unknown = Reflect.get(env, 'STANDALONE_SECRETS');
  if (typeof raw !== 'string' || raw === '') return {};
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null) return {};
  const values: Record<string, string> = {};
  for (const name of names) {
    const value: unknown = Reflect.get(parsed, name);
    if (typeof value === 'string') values[name] = value;
  }
  return values;
}

function valueOf<T>(operation: string, result: RpcResult<T>): T {
  if (result.ok) return result.value;
  throw new SinkError(operation, result.error);
}

function isActionsJobSink(value: unknown): value is ActionsJobSink {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'actionsJobLogs') === 'function'
  );
}
