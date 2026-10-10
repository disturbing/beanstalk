/** Gathers what the entity resolver needs from a data source, in one round of parallel calls. */
import type { RunId } from '@gitstalk/shared-race/ids';

import type { ForgeSource } from '../forge/forge-source';
import type { RefName } from '../repo/repo-types';
import { featureStems } from './question-words';
import type { ResolverCorpus } from './resolve-files';

export async function loadCorpus(
  source: ForgeSource,
  scope: { readonly run: RunId; readonly ref: RefName },
  feature: string,
): Promise<ResolverCorpus> {
  const stems = featureStems(feature);
  const [tree, beans, tests, greps] = await Promise.all([
    source.repoTree(scope.run, scope.ref),
    source.beansByPath(scope.run, []),
    source.testsFor(scope.run, []),
    Promise.all(stems.map((stem) => source.repoGrep(scope.run, scope.ref, stem))),
  ]);
  return {
    paths: tree.files.map((file) => file.path),
    grep: new Map(stems.map((stem, index) => [stem, greps[index] ?? []])),
    beans: beans.map((bean) => ({
      id: bean.id,
      title: bean.title,
      intent: bean.intent,
      files: bean.files,
    })),
    tests: tests.map((test) => ({ path: test.path, covers: test.covers })),
  };
}
