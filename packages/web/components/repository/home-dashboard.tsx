/**
 * Home after sign-in (`docs/claude-opus/16` §2.3, first slice): your repositories with what
 * each has grown, recent activity across them, and New repository. A first visit gets the
 * three steps that start a project, and the demo repository to look around in.
 */
import Link from 'next/link';

import type { User as SessionUser } from '../../src/auth/user';
import type { Growth } from '../../src/repositories/engine-summary';
import { growthText } from '../../src/repositories/engine-summary';
import { repositoryPath } from '../../src/repositories/paths';
import type { ActivityLine } from '../../src/repositories/home-activity';
import type { RepositoryRecord } from '../../src/repositories/registry-client';
import { timeAgo } from '../../src/repositories/when';
import styles from './repository.module.css';

export type DashboardRepository = { readonly record: RepositoryRecord; readonly growth: Growth };

export function HomeDashboard(props: {
  readonly user: SessionUser;
  readonly repositories: readonly DashboardRepository[];
  /** The engines' events and the registry's, newest first. */
  readonly activity: readonly ActivityLine[];
  readonly nowMs: number;
  /** A sentence when something just happened (a deletion), or a registry problem. */
  readonly notice: { readonly tone: 'good' | 'warn'; readonly text: string } | null;
  readonly demoHref: string;
}) {
  const first = props.repositories.length === 0;
  return (
    <main className={styles.page}>
      {props.notice === null ? null : (
        <p
          className={`${styles.notice} ${props.notice.tone === 'good' ? styles.noticeGood : ''}`}
          role="status"
        >
          {props.notice.text}
        </p>
      )}
      <div className={styles.homeHead}>
        <div>
          <h1 className={styles.lead}>{leadOf(props.user, props.repositories)}</h1>
          <p className={styles.sub}>
            Agents and people push beans; Beanstalk checks each one on the exact tree it would land
            on and grows the stalk.
          </p>
        </div>
        <Link href="/new" className={styles.primary}>
          New repository
        </Link>
      </div>
      <div className={styles.homeGrid}>
        <section className={styles.panel} aria-labelledby="repos-title">
          <div className={styles.panelHead}>
            <h2 id="repos-title">Your repositories</h2>
            <span className={styles.muted}>{props.repositories.length || ''}</span>
          </div>
          {first ? (
            <FirstSteps demoHref={props.demoHref} />
          ) : (
            <ul className={styles.repoList}>
              {props.repositories.map(({ record, growth }) => (
                <RepoRow key={record.id} record={record} growth={growth} nowMs={props.nowMs} />
              ))}
            </ul>
          )}
        </section>
        <section className={styles.panel} aria-labelledby="activity-title">
          <div className={styles.panelHead}>
            <h2 id="activity-title">Recent activity</h2>
          </div>
          {props.activity.length === 0 ? (
            <p className={styles.empty}>What happens in your repositories shows up here.</p>
          ) : (
            <ul className={styles.activity}>
              {props.activity.map((line) => (
                <li key={line.key} data-tone={line.tone}>
                  <span>
                    <Link href={repositoryPath(line.owner, line.repo)} className={styles.mono}>
                      {line.owner}/{line.repo}
                    </Link>{' '}
                    {line.bean === null ? null : (
                      <>
                        <Link
                          href={`${repositoryPath(line.owner, line.repo)}/changes/${encodeURIComponent(line.bean)}`}
                          className={styles.activityBean}
                        >
                          {line.bean}
                        </Link>{' '}
                      </>
                    )}
                    {line.text}
                    <time dateTime={line.at}>{timeAgo(line.at, props.nowMs)}</time>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}

function RepoRow(props: {
  readonly record: RepositoryRecord;
  readonly growth: Growth;
  readonly nowMs: number;
}) {
  const { record } = props;
  return (
    <li className={styles.repoRow}>
      <Sprig grown={props.growth.kind === 'grown'} />
      <div>
        <Link href={repositoryPath(record.owner.handle, record.name)} className={styles.repoName}>
          {record.owner.handle}/{record.name}
        </Link>
        {record.description === '' ? null : (
          <p className={styles.repoDescription}>{record.description}</p>
        )}
        <p className={styles.repoMeta}>
          {growthText(props.growth)}. Created {timeAgo(record.created_at, props.nowMs)}.
        </p>
      </div>
      <span className={styles.pill}>{record.visibility}</span>
    </li>
  );
}

function FirstSteps({ demoHref }: { readonly demoHref: string }) {
  return (
    <>
      <ol className={styles.checklist}>
        <li>
          <strong>Create a repository.</strong> Start from the TypeScript starter to see checks work
          on the first bean. <Link href="/new">New repository</Link>
        </li>
        <li>
          <strong>Connect an agent.</strong> Its start page has the one line to paste into Claude
          Code or Codex.
        </li>
        <li>
          <strong>Push a bean.</strong> Ask your agent for a change, or push a{' '}
          <code>bean/&lt;name&gt;</code> branch yourself.
        </li>
      </ol>
      <p className={styles.empty}>
        Want to look around first? <Link href={demoHref}>Open the demo repository</Link>, a recorded
        day of twelve agent sessions.
      </p>
    </>
  );
}

/** The stalk mark: a stem and a leaf, lit once something has grown. */
function Sprig({ grown }: { readonly grown: boolean }) {
  return (
    <svg className={styles.sprig} viewBox="0 0 14 22" aria-hidden="true">
      <path d="M7 21V5" stroke="currentColor" strokeWidth="2" opacity={grown ? 1 : 0.45} />
      <path d="M7 10c0-3 2-5 6-5 0 3-2 5-6 5Z" fill="currentColor" opacity={grown ? 1 : 0.45} />
      <ellipse cx="7" cy="21" rx="4" ry="1.5" fill="currentColor" opacity="0.35" />
    </svg>
  );
}

function leadOf(user: SessionUser, repositories: readonly DashboardRepository[]): string {
  if (repositories.length === 0) return `Welcome, ${user.handle}. Start your first repository.`;
  const growing = repositories.filter(
    (repo) => repo.growth.kind === 'grown' && repo.growth.growing > 0,
  ).length;
  if (growing > 0)
    return `${growing === 1 ? 'One repository is' : `${growing} repositories are`} growing right now.`;
  return `${repositories.length === 1 ? 'Your repository is' : `All ${repositories.length} repositories are`} quiet. Push a bean to grow one.`;
}
