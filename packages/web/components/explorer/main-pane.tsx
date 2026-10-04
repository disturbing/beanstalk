import Link from 'next/link';

import type { MainPane as MainPaneModel } from '@beanstalk/shared-ask/ask/answer';
import { BeanList, BeanView } from './bean-view';
import { DiffView } from './diff-view';
import styles from './explorer.module.css';
import type { ExplorerState } from './explorer-url';
import { explorerHref } from './explorer-url';
import { FileView } from './file-view';

/** The centre of the explorer: a diff, a file, a bean, or a list of beans. */
export function MainPane(props: {
  readonly run: string;
  readonly state: ExplorerState;
  readonly main: MainPaneModel;
  /** The bean whose history the rail already shows, if any. */
  readonly railBean: string | null;
}) {
  const { run, state, main } = props;
  switch (main.kind) {
    case 'diff': {
      const additions = main.diff.files.reduce((sum, file) => sum + file.additions, 0);
      const deletions = main.diff.files.reduce((sum, file) => sum + file.deletions, 0);
      return (
        <>
          <div className={styles.mainHead}>
            <h2 className={styles.mainTitle}>{main.title}</h2>
            <span className={styles.mainMeta}>
              {main.fromLabel} to {main.toLabel}, <span className={styles.add}>+{additions}</span>{' '}
              <span className={styles.del}>−{deletions}</span>
            </span>
          </div>
          <div className={styles.mainBody}>
            <DiffView files={main.diff.files} />
          </div>
        </>
      );
    }
    case 'file':
      return (
        <>
          <div className={styles.mainHead}>
            <h2 className={styles.mainTitle}>{main.title}</h2>
            <span className={styles.mainMeta}>
              {main.blame === null ? null : 'Blame by bean. '}
              {main.highlights.length === 0
                ? ''
                : `${main.highlights.length} lines changed in this range are marked.`}
            </span>
            <span className={styles.viewSwitch}>
              <Link href={explorerHref(run, state, { file: main.title, view: 'diff', bean: null })}>
                Diff in this range
              </Link>
            </span>
          </div>
          <FileView
            run={run}
            state={state}
            text={main.file.text}
            highlights={main.highlights}
            blame={main.blame}
          />
        </>
      );
    case 'bean':
      return (
        <BeanView
          run={run}
          state={state}
          bean={main.bean}
          diff={main.diff}
          showSteps={props.railBean !== main.bean.id}
        />
      );
    case 'beans':
      return (
        <>
          <div className={styles.mainHead}>
            <h2 className={styles.mainTitle}>{main.title}</h2>
          </div>
          <BeanList run={run} state={state} beans={main.beans} />
        </>
      );
    case 'empty':
      return (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>{main.title}</p>
          <p>{main.message}</p>
        </div>
      );
    default:
      return null;
  }
}
