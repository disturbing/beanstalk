'use client';

/**
 * The passkey controls: sign up with a handle, sign in, and add another passkey. Each runs
 * one ceremony and then navigates; errors are announced next to the control.
 */
import { useId, useState } from 'react';

import styles from './account.module.css';
import type { Ceremony } from './passkey-client';
import { runPasskeyCeremony } from './passkey-client';

type Status =
  | { readonly kind: 'idle' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'error'; readonly message: string };

function usePasskey(ceremony: Ceremony) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const run = async (input: {
    readonly handle?: string;
    readonly next?: string;
    readonly csrf?: string;
  }) => {
    setStatus({ kind: 'busy' });
    const outcome = await runPasskeyCeremony(ceremony, input);
    if (outcome.kind === 'done') {
      window.location.assign(outcome.redirect);
      return;
    }
    setStatus({ kind: 'error', message: outcome.message });
  };
  return { status, run };
}

export function PasskeySignup({ next }: { readonly next: string }) {
  const { status, run } = usePasskey('signup');
  const [handle, setHandle] = useState('');
  const handleId = useId();
  const errorId = useId();
  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        void run({ handle, next });
      }}
    >
      <label htmlFor={handleId} className={styles.label}>
        Handle
      </label>
      <div className={styles.handleField}>
        <span aria-hidden="true">@</span>
        <input
          id={handleId}
          name="handle"
          value={handle}
          onChange={(event) => setHandle(event.target.value.toLowerCase())}
          autoComplete="username webauthn"
          autoCapitalize="none"
          spellCheck={false}
          required
          minLength={2}
          maxLength={39}
          pattern="[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){1,38}"
          aria-describedby={status.kind === 'error' ? errorId : `${handleId}-hint`}
          aria-invalid={status.kind === 'error'}
        />
      </div>
      <p id={`${handleId}-hint`} className={styles.hint}>
        2–39 lowercase letters, digits or hyphens. It names you on beans, decisions and git.
      </p>
      <button type="submit" className={styles.primary} disabled={status.kind === 'busy'}>
        {status.kind === 'busy' ? 'Waiting for your passkey…' : 'Create account with a passkey'}
      </button>
      <StatusLine id={errorId} status={status} />
    </form>
  );
}

export function PasskeySignin({ next }: { readonly next: string }) {
  const { status, run } = usePasskey('signin');
  const errorId = useId();
  return (
    <div className={styles.form}>
      <button
        type="button"
        className={styles.primary}
        disabled={status.kind === 'busy'}
        onClick={() => void run({ next })}
        aria-describedby={status.kind === 'error' ? errorId : undefined}
      >
        {status.kind === 'busy' ? 'Waiting for your passkey…' : 'Sign in with a passkey'}
      </button>
      <StatusLine id={errorId} status={status} />
    </div>
  );
}

export function AddPasskey({ csrf }: { readonly csrf: string }) {
  const { status, run } = usePasskey('add');
  const errorId = useId();
  return (
    <div className={styles.inline}>
      <button
        type="button"
        className={styles.secondary}
        disabled={status.kind === 'busy'}
        onClick={() => void run({ csrf })}
      >
        {status.kind === 'busy' ? 'Waiting…' : 'Add a passkey'}
      </button>
      <StatusLine id={errorId} status={status} />
    </div>
  );
}

function StatusLine({ id, status }: { readonly id: string; readonly status: Status }) {
  return (
    <p id={id} className={styles.error} role="alert" aria-live="polite">
      {status.kind === 'error' ? status.message : ''}
    </p>
  );
}
