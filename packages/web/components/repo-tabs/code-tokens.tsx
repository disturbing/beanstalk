/** One highlighted line's tokens as spans; plain text needs no span. */
import { Fragment } from 'react';

import type { Token } from '../../src/code/highlight';
import styles from './repo-tabs.module.css';

export function CodeTokens({ tokens }: { readonly tokens: readonly Token[] }) {
  return (
    <>
      {tokens.map((token, index) =>
        token.kind === 'plain' ? (
          <Fragment key={index}>{token.text}</Fragment>
        ) : (
          <span key={index} className={styles[`t-${token.kind}`]}>
            {token.text}
          </span>
        ),
      )}
    </>
  );
}
