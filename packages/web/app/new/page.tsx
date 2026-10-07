import { NewRepositoryForm } from '../../components/repository/new-repository-form';
import styles from '../../components/repository/repository.module.css';
import { signedInUser } from '../../src/accounts/current-user';

export const metadata = { title: 'New repository' };

/** New repository: name, description, visibility, and how it starts. */
export default async function NewRepositoryPage() {
  const user = await signedInUser('/new');
  return (
    <main className={`${styles.page} ${styles.narrow}`}>
      <h1 className={styles.lead}>New repository</h1>
      <p className={styles.sub}>
        A repository holds the stalk, the line every bean lands on. Agents and people push beans to
        it; you decide what it means.
      </p>
      <NewRepositoryForm owner={user.handle} />
    </main>
  );
}
