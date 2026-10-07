import { env } from 'cloudflare:workers';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import styles from '../../components/repository/repository.module.css';
import { currentUser } from '../../src/auth/user';
import { isReservedOwner, repositoryPath } from '../../src/repositories/paths';
import type { RepositoryRecord } from '../../src/repositories/registry-client';
import { registryClient } from '../../src/repositories/registry-client';

type PageProps = { readonly params: Promise<{ readonly owner: string }> };

export async function generateMetadata({ params }: PageProps) {
  return { title: decodeURIComponent((await params).owner) };
}

/**
 * An owner's repositories: everything for the owner, public ones for everyone else. Until
 * accounts can look up a handle, only the signed-in owner's own page lists anything.
 */
export default async function OwnerPage({ params }: PageProps) {
  const handle = decodeURIComponent((await params).owner);
  if (isReservedOwner(handle)) notFound();
  const user = await currentUser();
  if (user === null || user.handle.toLowerCase() !== handle.toLowerCase()) notFound();
  const registry = registryClient(env.GATEWAY);
  const [listed, archivedList] = await Promise.all([
    registry.list(user.id, user.id),
    registry.list(user.id, user.id, 'archived'),
  ]);
  const records = listed.ok ? listed.value : [];
  const archived = archivedList.ok ? archivedList.value : [];
  return (
    <main className={`${styles.page} ${styles.narrow}`}>
      <div className={styles.homeHead}>
        <h1 className={styles.lead}>{user.handle}</h1>
        <Link href="/new" className={styles.primary}>
          New repository
        </Link>
      </div>
      <section className={styles.panel} aria-label="Repositories">
        {records.length === 0 ? (
          <p className={styles.empty}>No repositories yet.</p>
        ) : (
          <RepositoryList records={records} />
        )}
      </section>
      {archived.length === 0 ? null : (
        <section className={styles.panel} aria-labelledby="archived-title">
          <div className={styles.panelHead}>
            <h2 id="archived-title">Archived</h2>
            <span className={styles.muted}>{archived.length}</span>
          </div>
          <p className={styles.sub}>Read-only. Unarchive one from its Settings.</p>
          <RepositoryList records={archived} />
        </section>
      )}
    </main>
  );
}

function RepositoryList({ records }: { readonly records: readonly RepositoryRecord[] }) {
  return (
    <ul className={styles.repoList}>
      {records.map((record) => (
        <li key={record.id} className={styles.repoRow}>
          <span />
          <div>
            <Link
              href={repositoryPath(record.owner.handle, record.name)}
              className={styles.repoName}
            >
              {record.name}
            </Link>
            {record.description === '' ? null : (
              <p className={styles.repoDescription}>{record.description}</p>
            )}
          </div>
          <span className={styles.pill}>
            {record.archived_at === null ? record.visibility : 'archived'}
          </span>
        </li>
      ))}
    </ul>
  );
}
