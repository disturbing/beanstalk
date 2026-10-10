/**
 * The `deps.internal` contract with the `gitstalk-deps` tool in the job container
 * (packages/actions-executor/container, `src/deps/manifest.rs`). The tool names only snapshot keys and
 * chunk hashes; the Worker resolves the repository and scope from the job's bearer.
 */
import { z } from 'zod';

/** A sha256, lowercase hex: snapshot and family keys, chunk names. */
export const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);

/** At most this many chunks in one snapshot: 64 buckets, each split at most 16 ways, plus layout. */
const MAX_CHUNKS_PER_SNAPSHOT = 64 * 16 + 1;

export const LookupRequestSchema = z.object({ familyKey: Sha256, snapshotKey: Sha256 });

export const ChunkEntrySchema = z.object({
  sha256: Sha256,
  bytes: z.number().int().min(1),
  extractedBytes: z.number().int().min(0),
  label: z.string().max(32),
  packages: z.array(z.string().max(1024)).max(100_000),
});

export const ManifestSchema = z.object({
  version: z.literal(1),
  snapshotKey: Sha256,
  familyKey: Sha256,
  chunkCount: z.number().int().min(1).max(64),
  installDir: z.string().max(512),
  lockfile: z.string().max(64),
  packageManager: z.string().max(16),
  platform: z.string().max(64),
  nodeMajor: z.string().max(16),
  flags: z.string().max(1024),
  extractedBytes: z.number().int().min(0),
  files: z.number().int().min(0),
  chunks: z.array(ChunkEntrySchema).min(1).max(MAX_CHUNKS_PER_SNAPSHOT),
});
export type Manifest = z.infer<typeof ManifestSchema>;

export const MissingRequestSchema = z.object({
  chunks: z.array(Sha256).max(MAX_CHUNKS_PER_SNAPSHOT),
});

export const CompleteUploadSchema = z.object({
  uploadId: z.string().min(1).max(1024),
  parts: z
    .array(z.object({ partNumber: z.number().int().min(1).max(10_000), etag: z.string() }))
    .min(1)
    .max(10_000),
});

/** How a lookup matched: the same key, the family's latest, or nothing. */
export type LookupMatch = 'exact' | 'partial' | 'none';

export type LookupResponse = {
  readonly match: LookupMatch;
  readonly manifest: Manifest | null;
  readonly chunkCount: number | null;
  readonly canSave: boolean;
  readonly snapshotMaxBytes: number;
  readonly tmpfsMaxBytes: number;
};
