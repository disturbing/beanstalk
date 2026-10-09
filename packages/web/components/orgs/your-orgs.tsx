import Link from 'next/link';

import type { Membership } from '@beanstalk/shared-identity/orgs';

import repo from '../repository/repository.module.css';
import { OrgMark } from './org-mark';
import styles from './orgs.module.css';

/** Home: the organizations a person belongs to, with their role, and New organization. */
export function YourOrgs(props: { readonly memberships: readonly Membership[] }) {
  return (
    <section className={repo.panel} aria-labelledby="your-orgs-title">
      <div className={repo.panelHead}>
        <h2 id="your-orgs-title">Your organizations</h2>
        <Link href="/orgs/new" className={repo.secondary}>
          New organization
        </Link>
      </div>
      {props.memberships.length === 0 ? (
        <p className={repo.empty}>
          Repositories you own together live in an organization. Create one and invite people by
          their handle.
        </p>
      ) : (
        <ul className={styles.orgList}>
          {props.memberships.map(({ org, role }) => (
            <li key={org.id}>
              <OrgMark handle={org.handle} iconKey={org.iconKey} size={26} />
              <Link href={`/${org.handle}`}>{org.name}</Link>
              <span className={repo.muted}>{org.handle}</span>
              <span className={repo.pill}>{role}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
