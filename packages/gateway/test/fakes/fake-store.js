// The fake Artifacts' repos, shared by the fake Artifacts binding, its git remotes and the
// fake runner (one worker, one isolate), so a squash lands in the trunk repo as the real
// runner's candidate push does. Tests only.

export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const namespaces = new Map();

export function storeOf(namespace) {
  if (!namespaces.has(namespace)) namespaces.set(namespace, new Map());
  return namespaces.get(namespace);
}

/**
 * The fake runner's clean squash, as the real runner pushes its candidate: a commit whose only
 * parent is `onto` and whose files are `onto`'s with the change's head's on top, stored in
 * the trunk repo `remote` names. Returns the paths the change sets differently from `onto`
 * (none when the repo or the commits carry no files, as most tests' pushes do).
 */
export function recordSquash({ remote, sha, onto, changeRef, message }) {
  const repo = Array.from(namespaces.values())
    .flatMap((store) => Array.from(store.values()))
    .find((candidate) => candidate.remote === remote);
  if (repo === undefined) return [];
  const head = repo.refs.get(changeRef);
  const changed = head === undefined ? {} : (repo.commits.get(head)?.files ?? {});
  const base = repo.commits.get(onto)?.files ?? {};
  const files = { ...base, ...changed };
  repo.commits.set(sha, { parents: [onto], message, time: 0, files, tree: storeTree(repo, files) });
  return Object.keys(changed).filter((path) => base[path] !== changed[path]);
}

/** A 40-hex id for an object's content (FNV-1a, five seeds): stable, like git's. */
export function objectId(text) {
  let out = '';
  for (let seed = 0; seed < 5; seed += 1) {
    let hash = (0x811c9dc5 ^ seed) >>> 0;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    out += hash.toString(16).padStart(8, '0');
  }
  return out;
}

/** Stores the tree of a file map (and its blobs and subtrees); returns the root tree id. */
export function storeTree(repo, files) {
  const children = new Map();
  for (const [path, content] of Object.entries(files)) {
    const [head, ...rest] = path.split('/');
    if (rest.length === 0) {
      const blob = objectId(`blob:${content}`);
      repo.blobs.set(blob, content);
      children.set(head, { name: head, mode: '100644', hash: blob, type: 'blob' });
      continue;
    }
    const sub = children.get(head)?.files ?? {};
    sub[rest.join('/')] = content;
    children.set(head, { name: head, files: sub });
  }
  const entries = [...children.values()]
    .map((child) =>
      child.files === undefined
        ? child
        : { name: child.name, mode: '40000', hash: storeTree(repo, child.files), type: 'tree' },
    )
    .toSorted((a, b) => (a.name < b.name ? -1 : 1));
  const id = entries.length === 0 ? EMPTY_TREE : objectId(`tree:${JSON.stringify(entries)}`);
  repo.trees.set(id, entries);
  return id;
}
