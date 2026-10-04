'use client';

import type { ChangeEvent, ReactNode } from 'react';

function submit(event: ChangeEvent<HTMLSelectElement>): void {
  event.currentTarget.form?.requestSubmit();
}

/** A select that submits its form on change (without JS, the form's button does it). */
export function AutoSubmitSelect(props: {
  readonly name: string;
  readonly defaultValue: string;
  readonly className?: string | undefined;
  readonly id: string;
  readonly children: ReactNode;
}) {
  return (
    <select
      id={props.id}
      name={props.name}
      defaultValue={props.defaultValue}
      className={props.className}
      onChange={submit}
    >
      {props.children}
    </select>
  );
}
