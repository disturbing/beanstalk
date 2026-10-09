import { orgIconSrc } from '../../src/orgs/org-icon';
import styles from './orgs.module.css';

/**
 * An org's mark: its uploaded icon, or the first two letters of its handle. Decorative beside
 * the name, so the image has no alternative text of its own.
 */
export function OrgMark(props: {
  readonly handle: string;
  readonly iconKey: string | null;
  readonly size: number;
}) {
  const style = { width: props.size, height: props.size, fontSize: Math.round(props.size * 0.42) };
  return (
    <span className={styles.mark} style={style} aria-hidden="true">
      {props.iconKey === null ? (
        initials(props.handle)
      ) : (
        <img
          src={orgIconSrc(props.iconKey, props.size * 2)}
          alt=""
          width={props.size}
          height={props.size}
        />
      )}
    </span>
  );
}

function initials(handle: string): string {
  const parts = handle.split('-').filter((part) => part !== '');
  const [first = '', second = ''] = parts;
  return parts.length > 1 ? `${first.charAt(0)}${second.charAt(0)}` : handle.slice(0, 2);
}
