/**
 * Home after sign-in (`docs/claude-opus/16` §2.3 and item 1.6): your repositories with what
 * each has grown (and the demo repository, for everyone), your agent sessions, recent activity
 * and New repository. Until the first bean, a checklist: connect a session, create or import a
 * repository, push a bean.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';

import type { AgentSession } from '@gitstalk/shared-identity/agent-sessions';

import type { User as SessionUser } from '../../src/auth/user';
import type { Growth } from '../../src/repositories/engine-summary';
import { growthText } from '../../src/repositories/engine-summary';
import { repositoryPath } from '../../src/repositories/paths';
import type { ActivityLine } from '../../src/repositories/home-activity';
import type { RepositoryRecord } from '../../src/repositories/registry-client';
import { timeAgo } from '../../src/repositories/when';
import { FirstSteps, LiveSessions, SessionsPanel } from './home-sessions';
import styles from './repository.module.css';

export type DashboardRepository = { readonly record: RepositoryRecord; readonly growth: Growth };

export function HomeDashboard(props: {
  readonly user: SessionUser;
  readonly repositories: readonly DashboardRepository[];
  /** The engines' events and the registry's, newest first. */
  readonly activity: readonly ActivityLine[];
  /** Repositories others invited this person to (accepted). */
  readonly shared?: readonly DashboardRepository[];
  /** Invitations waiting for an answer (rendered by the page: they are forms). */
  readonly invitations?: ReactNode;
  readonly nowMs: number;
  /** A sentence when something just happened (a deletion), or a registry problem. */
  readonly notice: { readonly tone: 'good' | 'warn'; readonly text: string } | null;
  readonly demoHref: string;
  /** Connected agent sessions when the page was rendered (null: not available). */
  readonly sessions: readonly AgentSession[] | null;
  /** The person's archived repositories, listed on their own page rather than here. */
  readonly archivedCount?: number;
}) {
  const archivedCount = props.archivedCount ?? 0;
  const withBeans = props.repositories.filter(({ growth }) => growth.kind === 'grown').length;
  return (
    <LiveSessions initial={props.sessions} nowMs={props.nowMs}>
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
            <h1 className={styles.lead}>{leadOf(props.user, props.repositories, archivedCount)}</h1>
            <p className={styles.sub}>
              Agents and people push beans; Gitstalk checks each one on the exact tree it would land
              on and grows the stalk.
            </p>
          </div>
          <Link href="/new" className={styles.primary}>
            New repository
          </Link>
        </div>
        {props.invitations}
        <div className={styles.homeGrid}>
          <div className={styles.homeColumn}>
            <FirstSteps
              repositories={props.repositories.length + archivedCount}
              repositoriesWithBeans={withBeans}
            />
            <section className={styles.panel} aria-labelledby="repos-title">
              <div className={styles.panelHead}>
                <h2 id="repos-title">Your repositories</h2>
                <span className={styles.muted}>
                  {props.repositories.length || ''}
                  {archivedCount === 0 ? null : (
                    <>
                      {' '}
                      <Link href={`/${props.user.handle}`}>{archivedCount} archived</Link>
                    </>
                  )}
                </span>
              </div>
              {props.repositories.length === 0 && archivedCount > 0 ? (
                <p className={styles.empty}>
                  Every repository of yours is archived.{' '}
                  <Link href={`/${props.user.handle}`}>Your page lists them</Link>; unarchive one
                  from its Settings, or start a new one.
                </p>
              ) : null}
              <ul className={styles.repoList}>
                {props.repositories.map(({ record, growth }) => (
                  <RepoRow key={record.id} record={record} growth={growth} nowMs={props.nowMs} />
                ))}
                <DemoRow href={props.demoHref} />
              </ul>
            </section>
            {(props.shared ?? []).length === 0 ? null : (
              <section className={styles.panel} aria-labelledby="shared-title">
                <div className={styles.panelHead}>
                  <h2 id="shared-title">Shared with you</h2>
                  <span className={styles.muted}>{props.shared?.length}</span>
                </div>
                <ul className={styles.repoList}>
                  {(props.shared ?? []).map(({ record, growth }) => (
                    <RepoRow key={record.id} record={record} growth={growth} nowMs={props.nowMs} />
                  ))}
                </ul>
              </section>
            )}
          </div>
          <div className={styles.homeColumn}>
            <SessionsPanel />
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
        </div>
      </main>
    </LiveSessions>
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

/** The demo repository, listed for everyone: a recorded day of twelve agent sessions. */
function DemoRow({ href }: { readonly href: string }) {
  return (
    <li className={styles.repoRow}>
      <Sprig grown />
      <div>
        <Link href={href} className={styles.repoName}>
          demo/beanstalk-shop
        </Link>
        <p className={styles.repoDescription}>
          A recorded day of twelve agent sessions on one shop: look around before your own.
        </p>
      </div>
      <span className={styles.pill}>demo</span>
    </li>
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

function leadOf(
  user: SessionUser,
  repositories: readonly DashboardRepository[],
  archivedCount: number,
): string {
  if (repositories.length === 0 && archivedCount > 0)
    return `Welcome back, ${user.handle}. Your repositories are archived.`;
  if (repositories.length === 0) return `Welcome, ${user.handle}. Start your first repository.`;
  const growing = repositories.filter(
    (repo) => repo.growth.kind === 'grown' && repo.growth.growing > 0,
  ).length;
  if (growing > 0)
    return `${growing === 1 ? 'One repository is' : `${growing} repositories are`} growing right now.`;
  return `${repositories.length === 1 ? 'Your repository is' : `All ${repositories.length} repositories are`} quiet. Push a bean to grow one.`;
}
