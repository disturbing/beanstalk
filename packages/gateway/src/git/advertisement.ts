/**
 * The receive-pack ref advertisement (`GET info/refs?service=git-receive-pack`) as the
 * git-native flow serves it: the upstream's, with `push-options` added to the capabilities
 * so `git push -o wait` is accepted (the gateway reads the options; Artifacts never sees
 * them), and `push-options` alone never makes a client send options the gateway cannot read.
 */
import { concatBytes, encodePktLine, pktLine, pktText, readPktLines } from './pkt-line';

/** The advertisement with `capabilities` added to its first ref line; unchanged if malformed. */
export function withCapabilities(
  advertisement: Uint8Array,
  capabilities: readonly string[],
): Uint8Array {
  const parsed = readPktLines(advertisement);
  if (!parsed.ok || parsed.offset !== advertisement.length) return advertisement;
  let isDone = false;
  const parts = parsed.lines.map((line): Uint8Array => {
    if (line.kind !== 'data') return encodePktLine(line);
    const text = pktText(line.payload);
    const nul = text.indexOf('\0');
    if (isDone || nul < 0) return pktLine(line.payload);
    isDone = true;
    const present = text
      .slice(nul + 1)
      .split(' ')
      .filter(Boolean);
    const added = capabilities.filter((capability) => !present.includes(capability));
    return pktLine(`${text.slice(0, nul)}\0${[...present, ...added].join(' ')}\n`);
  });
  return isDone ? concatBytes(parts) : advertisement;
}
