import { redirectToAdmin } from '../../../src/admin/admin-gate';
import { queryOf } from '../../../src/admin/admin-paths';

type PageProps = {
  readonly params: Promise<{ readonly path: readonly string[] }>;
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
};

/**
 * A run's pages (`/runs/<run>`, `/runs/<run>/race`, `/runs/<run>/files`) moved to the admin
 * area: admins are sent to the same page there (query kept), everyone else gets the 404.
 */
export default async function OldRunPage({ params, searchParams }: PageProps): Promise<never> {
  const { path } = await params;
  return redirectToAdmin(`/runs/${path.join('/')}`, queryOf(await searchParams));
}
