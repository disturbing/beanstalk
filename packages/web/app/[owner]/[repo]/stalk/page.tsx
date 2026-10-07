import { permanentRedirect } from 'next/navigation';

import type { RepositoryParams } from '../../../../src/server/repository-page';

type PageProps = { readonly params: RepositoryParams };

/**
 * The Stalk tab folded into History (validated versus landed, `docs/claude-opus/20` §7): its
 * old address goes there. History checks access, so this tells nobody whether it exists.
 */
export default async function StalkPage({ params }: PageProps) {
  const { owner, repo } = await params;
  // Route params arrive still percent-encoded, so they go back into the path as they are.
  permanentRedirect(`/${owner}/${repo}/history`);
}
