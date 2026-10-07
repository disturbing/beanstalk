import { env } from 'cloudflare:workers';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import styles from '../../components/repository/repository.module.css';
import { currentUser } from '../../src/accounts/current-user';
import { isReservedOwner, repositoryPath } from '../../src/repositories/paths';
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
  const listed = await registryClient(env.GATEWAY).list(user.id, user.id);
  const records = listed.ok ? listed.value : [];
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
                <span className={styles.pill}>{record.visibility}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
