/**
 * A person's or organisation's picture: the uploaded image at the right stored size, or the
 * generated fallback (initials for a person, an identicon for an organisation) drawn inline.
 * Decorative by default: the name beside it says who it is.
 */
import { fallbackAvatar } from '@gitstalk/shared-media/fallback-avatar';
import { imageUrl } from '@gitstalk/shared-media/images';

import styles from './avatar.module.css';

export function Avatar({
  kind = 'user',
  seed,
  label,
  imageKey,
  size,
}: {
  readonly kind?: 'user' | 'org';
  /** The account id: the fallback's colour survives a handle change. */
  readonly seed: string;
  /** The display name or handle the initials come from. */
  readonly label: string;
  readonly imageKey: string | null;
  readonly size: number;
}) {
  const shape = kind === 'org' ? styles.square : styles.round;
  if (imageKey !== null)
    return (
      <img
        className={`${styles.avatar} ${shape}`}
        src={imageUrl(imageKey, size * 2)}
        width={size}
        height={size}
        alt=""
        loading="lazy"
        decoding="async"
      />
    );
  const fallback = fallbackAvatar(seed, label);
  const background = `hsl(${fallback.hue} 45% 32%)`;
  const ink = `hsl(${fallback.hue} 80% 88%)`;
  return (
    <svg
      className={`${styles.avatar} ${shape}`}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="100" height="100" fill={background} />
      {kind === 'org' ? (
        fallback.cells.flatMap((row, y) =>
          row.map((on, x) =>
            on ? (
              <rect
                key={`${x}-${y}`}
                x={10 + x * 16}
                y={10 + y * 16}
                width="16"
                height="16"
                fill={ink}
              />
            ) : null,
          ),
        )
      ) : (
        <text
          x="50"
          y="50"
          dy=".35em"
          textAnchor="middle"
          fontFamily="var(--font-sans), system-ui, sans-serif"
          fontWeight="650"
          fontSize={fallback.initials.length > 1 ? 40 : 50}
          fill={ink}
        >
          {fallback.initials}
        </text>
      )}
    </svg>
  );
}
