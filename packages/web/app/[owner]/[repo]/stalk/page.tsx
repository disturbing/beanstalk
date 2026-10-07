import { env } from 'cloudflare:workers';

import { RepoHead } from '../../../../components/home/repo-head';
import { StalkView } from '../../../../components/repository/stalk-view';
import styles from '../../../../components/repository/repository.module.css';
import { indexClient } from '../../../../src/repositories/index-client';
import type { RepositoryParams } from '../../../../src/server/repository-page';
import { repositoryPage } from '../../../../src/server/repository-page';

type PageProps = { readonly params: RepositoryParams };

export async function generateMetadata({ params }: PageProps) {
  const { owner, repo } = await params;
  return { title: `Stalk, ${decodeURIComponent(owner)}/${decodeURIComponent(repo)}` };
}

/**
 * The Stalk tab: the stalk's and the sprout's heads, what is validated and promoted (with
 * the commits), what landed and is still validating, what is growing and what was taken
 * off. One D1 read through the gateway's index RPC (repo-events), never the engine.
 */
export default async function StalkPage({ params }: PageProps) {
  const page = await repositoryPage(params);
  const { record, base, user, role } = page;
  const started = performance.now();
  const stalk = await indexClient(env.GATEWAY).stalk(record.id, user?.id ?? null);
  const readMs = performance.now() - started;
  return (
    <main>
      <RepoHead
        base={base}
        repository={{ owner: record.owner.handle, name: record.name }}
        current="stalk"
        kind="repository"
        visibility={record.visibility}
        ownerHref={`/${record.owner.handle}`}
        archived={record.archived_at !== null}
        canAdminister={role !== null}
      />
      {stalk.ok ? (
        <StalkView base={base} stalk={stalk.value} nowMs={Date.now()} readMs={readMs} />
      ) : (
        <div className={`${styles.page} ${styles.narrow}`}>
          <p className={styles.notice} role="status">
            The stalk&rsquo;s history could not be read: {stalk.error.message}
          </p>
        </div>
      )}
    </main>
  );
}
