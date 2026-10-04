'use server';

/**
 * The Plot's one server action: pick the headline facts for a moment of the race. The client
 * computes the same facts to draw them, but the pick runs here, where the AI binding is.
 * Facts are recomputed from the run's own events, never taken from the browser.
 */
import { env } from 'cloudflare:workers';
import { z } from 'zod';

import { RunId } from '@beanstalk/shared-race/ids';

import { allEvents } from '@beanstalk/shared-ask/ask/plan-context';
import { isFinished, leadDecision, leadFacts } from '@beanstalk/shared-ask/pick/lead';
import type { PickReceipt } from '@beanstalk/shared-ask/pick/picker';
import { reduceRace } from '@beanstalk/shared-ask/race/reduce-race';
import { forgeForRun } from '../forge/sources';
import { recordedRun } from '../recorded/recorded-runs';
import { pagePicker } from './picker';

const RaceSecond = z
  .number()
  .finite()
  .nonnegative()
  .max(7 * 24 * 3600);

export async function pickLead(run: string, now: number): Promise<PickReceipt | null> {
  const parsedRun = RunId.safeParse(run);
  const parsedNow = RaceSecond.safeParse(now);
  if (!parsedRun.success || !parsedNow.success) return null;
  const recorded = recordedRun(parsedRun.data);
  const events =
    recorded?.events ?? (await allEvents(forgeForRun(env.GATEWAY, parsedRun.data), parsedRun.data));
  const visible = events.filter((event) => event.t <= parsedNow.data);
  const state = reduceRace(visible);
  const facts = leadFacts(state, parsedNow.data);
  return pagePicker().decide(leadDecision(facts, isFinished(state, parsedNow.data)));
}
