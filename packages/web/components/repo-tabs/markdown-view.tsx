/** A README as React elements (`src/code/markdown.ts`): never HTML, links only to safe targets. */
import type { ReactNode } from 'react';

import { highlight } from '../../src/code/highlight';
import type { Block, Inline } from '../../src/code/markdown';
import { parseMarkdown } from '../../src/code/markdown';
import { CodeTokens } from './code-tokens';
import styles from './repo-tabs.module.css';

export function MarkdownView(props: {
  readonly text: string;
  /** Turns a relative link into this repository's URL; absolute links pass through. */
  readonly resolve: (href: string) => string;
}) {
  return (
    <div className={styles.prose}>
      {parseMarkdown(props.text).map((block, index) => (
        <BlockView key={index} block={block} resolve={props.resolve} />
      ))}
    </div>
  );
}

type Resolve = (href: string) => string;

function BlockView({ block, resolve }: { readonly block: Block; readonly resolve: Resolve }) {
  switch (block.kind) {
    case 'heading': {
      const children = inlines(block.inline, resolve);
      if (block.level === 1) return <h1>{children}</h1>;
      if (block.level === 2) return <h2>{children}</h2>;
      return block.level === 3 ? <h3>{children}</h3> : <h4>{children}</h4>;
    }
    case 'paragraph':
      return <p>{inlines(block.inline, resolve)}</p>;
    case 'quote':
      return <blockquote>{inlines(block.inline, resolve)}</blockquote>;
    case 'list': {
      const items = block.items.map((item, index) => <li key={index}>{inlines(item, resolve)}</li>);
      return block.ordered ? <ol>{items}</ol> : <ul>{items}</ul>;
    }
    case 'code':
      return (
        <pre>
          <code>
            {highlight(block.text, fenceLanguage(block.language)).map((line, index) => (
              <span key={index}>
                {index > 0 ? '\n' : null}
                <CodeTokens tokens={line} />
              </span>
            ))}
          </code>
        </pre>
      );
    case 'rule':
      return <hr />;
    default:
      return null;
  }
}

function inlines(list: readonly Inline[], resolve: Resolve): ReactNode {
  return list.map((inline, index) => <InlineView key={index} inline={inline} resolve={resolve} />);
}

function InlineView({ inline, resolve }: { readonly inline: Inline; readonly resolve: Resolve }) {
  switch (inline.kind) {
    case 'text':
      return <>{inline.text}</>;
    case 'code':
      return <code>{inline.text}</code>;
    case 'strong':
      return <strong>{inlines(inline.children, resolve)}</strong>;
    case 'em':
      return <em>{inlines(inline.children, resolve)}</em>;
    case 'link': {
      const external = /^https?:/i.test(inline.href);
      return (
        <a
          href={resolve(inline.href)}
          {...(external ? { rel: 'nofollow noopener', target: '_blank' } : {})}
        >
          {inlines(inline.children, resolve)}
        </a>
      );
    }
    default:
      return null;
  }
}

/** A fence's info string as a highlighter language (`ts`, `sh` …). */
function fenceLanguage(info: string): string | null {
  const names: Readonly<Record<string, string>> = {
    ts: 'ts',
    typescript: 'ts',
    js: 'ts',
    javascript: 'ts',
    tsx: 'ts',
    json: 'json',
    sh: 'shell',
    bash: 'shell',
    shell: 'shell',
    console: 'shell',
    toml: 'toml',
    rust: 'rust',
    rs: 'rust',
    py: 'python',
    python: 'python',
    yaml: 'yaml',
    yml: 'yaml',
    go: 'go',
  };
  return names[info.toLowerCase()] ?? null;
}
