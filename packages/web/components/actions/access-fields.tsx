/** The hidden fields every Actions form carries: the CSRF token and which repository. */
import type { ActionsAccess } from '../../src/server/actions-page';

export function AccessFields({ access }: { readonly access: ActionsAccess }) {
  return (
    <>
      <input type="hidden" name="csrf" value={access.csrf} />
      <input type="hidden" name="owner" value={access.owner} />
      <input type="hidden" name="name" value={access.name} />
    </>
  );
}
