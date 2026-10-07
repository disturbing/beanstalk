'use client';

/**
 * The Turnstile widget on sign-in and sign-up, rendered explicitly so each form keeps its own
 * widget id and can reset it after a try (a token is redeemed once). The widget also writes
 * the token into a hidden `cf-turnstile-response` field, which plain form posts carry.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import styles from './account.module.css';

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

type RenderOptions = {
  readonly sitekey: string;
  readonly action: string;
  readonly theme: 'auto';
  readonly callback: (token: string) => void;
  readonly 'expired-callback': () => void;
  readonly 'error-callback': () => void;
};

/** The part of `window.turnstile` this page uses. */
type TurnstileApi = {
  render(container: HTMLElement, options: RenderOptions): string | undefined;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
};

export type TurnstileState = {
  /** The solved token, or null until the person passes the check. */
  readonly token: string | null;
  /** Ask for a fresh token (after any try, since a token works once). */
  readonly reset: () => void;
  readonly containerRef: React.RefObject<HTMLDivElement | null>;
};

/** A widget for `action` when `siteKey` is set; with no site key the token is never needed. */
export function useTurnstile(siteKey: string | null, action: 'signin' | 'signup'): TurnstileState {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetId = useRef<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (siteKey === null || container === null) return undefined;
    let cancelled = false;
    const draw = async () => {
      const api = await loadTurnstile();
      if (cancelled || api === null) return;
      widgetId.current =
        api.render(container, {
          sitekey: siteKey,
          action,
          theme: 'auto',
          callback: (solved) => setToken(solved),
          'expired-callback': () => setToken(null),
          'error-callback': () => setToken(null),
        }) ?? null;
    };
    void draw();
    return () => {
      cancelled = true;
      const id = widgetId.current;
      const api = turnstileApi();
      if (id !== null && api !== null) api.remove(id);
      widgetId.current = null;
    };
  }, [siteKey, action]);

  const reset = useCallback(() => {
    setToken(null);
    const id = widgetId.current;
    const api = turnstileApi();
    if (id !== null && api !== null) api.reset(id);
  }, []);

  return { token, reset, containerRef };
}

/** Where the widget draws itself; nothing when Turnstile is off. */
export function TurnstileBox({
  siteKey,
  state,
}: {
  readonly siteKey: string | null;
  readonly state: TurnstileState;
}) {
  if (siteKey === null) return null;
  return <div ref={state.containerRef} className={styles.turnstile} />;
}

/** A self-contained widget for a plain form (the email forms): the hidden field is enough. */
export function TurnstileField({
  siteKey,
  action,
}: {
  readonly siteKey: string | null;
  readonly action: 'signin' | 'signup';
}) {
  const state = useTurnstile(siteKey, action);
  return <TurnstileBox siteKey={siteKey} state={state} />;
}

/** Loads Cloudflare's script once per page (a second widget waits for the same tag). */
function loadTurnstile(): Promise<TurnstileApi | null> {
  const ready = turnstileApi();
  if (ready !== null) return Promise.resolve(ready);
  const existing = document.querySelector<HTMLScriptElement>('script[data-turnstile]');
  const script = existing ?? document.createElement('script');
  const loaded = new Promise<TurnstileApi | null>((resolve) => {
    script.addEventListener('load', () => resolve(turnstileApi()));
    script.addEventListener('error', () => resolve(null));
  });
  if (existing === null) {
    script.src = SCRIPT_URL;
    script.async = true;
    script.dataset['turnstile'] = '';
    document.head.appendChild(script);
  }
  return loaded;
}

function turnstileApi(): TurnstileApi | null {
  const api: unknown = Reflect.get(window, 'turnstile');
  return isTurnstileApi(api) ? api : null;
}

function isTurnstileApi(value: unknown): value is TurnstileApi {
  return (
    typeof value === 'object' &&
    value !== null &&
    ['render', 'reset', 'remove'].every(
      (method) => typeof Reflect.get(value, method) === 'function',
    )
  );
}
