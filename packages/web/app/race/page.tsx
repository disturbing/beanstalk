import { redirectToAdmin } from '../../src/admin/admin-gate';
import { queryOf } from '../../src/admin/admin-paths';

/** Per person and per request: never prerendered or cached. */
export const dynamic = 'force-dynamic';

type PageProps = {
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
};

/** The race moved to the admin area: admins are sent there, everyone else gets the 404. */
export default async function OldRacePage({ searchParams }: PageProps): Promise<never> {
  return redirectToAdmin('/race', queryOf(await searchParams));
}
