/**
 * Job logs in R2 (doc 25 §3.3, D9): each executor batch is one gzip chunk of NDJSON lines at
 * `<owner id>/<repo id>/<run>/<job>/<seq, 10 digits>.log.gz`. The bucket's lifecycle rule
 * deletes them after 30 days. Nothing of a log is kept in a Durable Object.
 */
import type { LogChunkPage, LogLine } from '@beanstalk/shared-race/actions';
import { LogLineSchema } from '@beanstalk/shared-race/actions';

/** Chunks one `logChunks` page reads at most. */
const CHUNKS_PER_PAGE = 50;
const SEQ_DIGITS = 10;

export type LogLocation = {
  readonly ownerId: string;
  readonly repoId: string;
  readonly runId: string;
  readonly jobId: string;
};

/** The key prefix of one job's chunks. */
export function jobLogPrefix(where: LogLocation): string {
  return `${where.ownerId}/${where.repoId}/${where.runId}/${where.jobId}/`;
}

/** Writes one batch as a gzip chunk. Rewriting the same `seq` replaces it (retries are harmless). */
export async function writeLogChunk(
  bucket: R2Bucket,
  where: LogLocation,
  chunk: { readonly seq: number; readonly lines: readonly LogLine[] },
): Promise<void> {
  const text = chunk.lines.map((line) => JSON.stringify(line)).join('\n');
  const gzipped = await new Response(
    new Blob([text]).stream().pipeThrough(new CompressionStream('gzip')),
  ).arrayBuffer();
  await bucket.put(
    `${jobLogPrefix(where)}${String(chunk.seq).padStart(SEQ_DIGITS, '0')}.log.gz`,
    gzipped,
    {
      httpMetadata: { contentType: 'application/x-ndjson', contentEncoding: 'gzip' },
    },
  );
}

/** Chunks after `after`, in order, as one page. */
export async function readLogChunks(
  bucket: R2Bucket,
  where: LogLocation,
  input: { readonly after: number; readonly complete: boolean },
): Promise<LogChunkPage> {
  const prefix = jobLogPrefix(where);
  const listed = await bucket.list({
    prefix,
    startAfter: `${prefix}${String(input.after).padStart(SEQ_DIGITS, '0')}.log.gz`,
    limit: CHUNKS_PER_PAGE,
  });
  const chunks = await Promise.all(
    listed.objects.map(async (object) => ({
      seq: Number(object.key.slice(prefix.length, prefix.length + SEQ_DIGITS)),
      lines: await readChunk(bucket, object.key),
    })),
  );
  const last = chunks.at(-1);
  return {
    chunks,
    next: listed.truncated && last !== undefined ? last.seq : null,
    complete: input.complete && !listed.truncated,
  };
}

async function readChunk(bucket: R2Bucket, key: string): Promise<LogLine[]> {
  const object = await bucket.get(key);
  if (object === null) return [];
  const text = await new Response(object.body.pipeThrough(new DecompressionStream('gzip'))).text();
  return text
    .split('\n')
    .filter((line) => line !== '')
    .flatMap((line) => {
      const parsed = LogLineSchema.safeParse(JSON.parse(line));
      return parsed.success ? [parsed.data] : [];
    });
}
