'use client';

/**
 * The passkey controls: sign up with a handle, sign in, and add another passkey. Each runs
 * one ceremony and then navigates; errors are announced next to the control.
 */
import { useId, useState } from 'react';

import styles from './account.module.css';
import type { Ceremony } from './passkey-client';
import { runPasskeyCeremony } from './passkey-client';
import type { TurnstileState } from './turnstile';
import { TurnstileBox, useTurnstile } from './turnstile';

type Status =
  | { readonly kind: 'idle' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'error'; readonly message: string };

const CHECK_FIRST = 'Complete the check above first.';

/**
 * Runs a ceremony; with a Turnstile widget (sign-up, sign-in) its token goes with the first
 * step, and the widget is reset after every try that does not navigate away.
 */
function usePasskey(ceremony: Ceremony, human: TurnstileState | null = null) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const run = async (input: {
    readonly handle?: string;
    readonly next?: string;
    readonly csrf?: string;
  }) => {
    if (human !== null && human.token === null) {
      setStatus({ kind: 'error', message: CHECK_FIRST });
      return;
    }
    setStatus({ kind: 'busy' });
    const outcome = await runPasskeyCeremony(ceremony, {
      ...input,
      ...(human?.token === null || human === null ? {} : { turnstile: human.token }),
    });
    if (outcome.kind === 'done') {
      window.location.assign(outcome.redirect);
      return;
    }
    human?.reset();
    setStatus({ kind: 'error', message: outcome.message });
  };
  return { status, run };
}

/** The widget's state when Turnstile is on, else null (no token is needed). */
function useHumanCheck(siteKey: string | null, action: 'signin' | 'signup') {
  const state = useTurnstile(siteKey, action);
  return { state, required: siteKey === null ? null : state };
}

export function PasskeySignup({
  next,
  turnstileSiteKey,
}: {
  readonly next: string;
  readonly turnstileSiteKey: string | null;
}) {
  const human = useHumanCheck(turnstileSiteKey, 'signup');
  const { status, run } = usePasskey('signup', human.required);
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
      <TurnstileBox siteKey={turnstileSiteKey} state={human.state} />
      <button type="submit" className={styles.primary} disabled={status.kind === 'busy'}>
        {status.kind === 'busy' ? 'Waiting for your passkey…' : 'Create account with a passkey'}
      </button>
      <StatusLine id={errorId} status={status} />
    </form>
  );
}

export function PasskeySignin({
  next,
  turnstileSiteKey,
}: {
  readonly next: string;
  readonly turnstileSiteKey: string | null;
}) {
  const human = useHumanCheck(turnstileSiteKey, 'signin');
  const { status, run } = usePasskey('signin', human.required);
  const errorId = useId();
  return (
    <div className={styles.form}>
      <TurnstileBox siteKey={turnstileSiteKey} state={human.state} />
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
