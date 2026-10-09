import type { RepositoryRecord } from '../repositories/registry-client';

/** What the repository settings forms need from the record. */
export type SettingsRepo = {
  readonly id: string;
  readonly owner: string;
  readonly name: string;
  readonly description: string;
  readonly visibility: 'public' | 'private' | 'internal';
  readonly ownerKind: 'user' | 'org';
  readonly website: string;
  readonly topics: readonly string[];
};

export function settingsRepo(record: RepositoryRecord): SettingsRepo {
  return {
    id: record.id,
    owner: record.owner.handle,
    name: record.name,
    description: record.description,
    visibility: record.visibility,
    ownerKind: record.owner_kind,
    website: record.website,
    topics: record.topics,
  };
}
