/** The beanstalk mark: a stem with three beans, drawn like a cyanotype botanical. */
export function VineMark({ size = 22 }: { readonly size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    >
      <path d="M12 22.5c-1.8-3.4-1.6-6.4.4-9.6 1.9-3.1 2-6.2.1-10.4" />
      <path
        d="M11.3 17.2c-2.9.2-4.9-1.1-5.7-3.4 2.6-.5 4.6.4 5.7 3.4Z"
        fill="currentColor"
        fillOpacity="0.18"
      />
      <path
        d="M12.6 11.4c2.8-.4 4.7-2 5.1-4.4-2.6.1-4.4 1.4-5.1 4.4Z"
        fill="currentColor"
        fillOpacity="0.18"
      />
      <circle cx="12.4" cy="3.1" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}
