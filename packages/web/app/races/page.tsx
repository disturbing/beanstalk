import { redirectToAdmin } from '../../src/admin/admin-gate';
import { queryOf } from '../../src/admin/admin-paths';

/** Per person and per request: never prerendered or cached. */
export const dynamic = 'force-dynamic';

type PageProps = {
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
};

/** The benchmark runs moved to the admin area: admins go there, everyone else gets the 404. */
export default async function OldRacesPage({ searchParams }: PageProps): Promise<never> {
  return redirectToAdmin('/races', queryOf(await searchParams));
}
