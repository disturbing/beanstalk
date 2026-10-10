# @gitstalk/shared-media

Uploaded pictures for Gitstalk: people's avatars, organization icons and repositories' social
images, stored in an R2 bucket and served by the web host under `/media/<key>`, plus the
generated fallback picture for anyone who has not uploaded one. It is a TypeScript library with
no Worker of its own; today only the web app imports it, and it is bundled into that Worker.

```
gitstalk-web  settings upload routes ─┐
              /media/[...path] route ─┼─> @gitstalk/shared-media ─┬─> R2 MEDIA (gitstalk-media)
              avatars, org icons     ─┘                           └─> Images binding IMAGES (optional)
```

## Key concepts

- **Content is read from bytes**, never from the file name or the type the browser claimed:
  PNG, JPEG, WebP and GIF with their dimensions (`image-format.ts`). SVG is refused because it
  can carry scripts. Uploads are limited to 2 MiB and 16 to 4096 pixels a side.
- **Immutable keys**: `users/<id>/avatar/<hash>`, `orgs/<id>/icon/<hash>` and
  `repos/<id>/social/<hash>`, each ending in a hash of the bytes, so a new picture is a new URL
  and objects are cached for a year. The object at the key is the largest size; `<key>/<width>`
  holds each smaller preset (avatars and icons 460, 128, 64; social images 1280, 640).
- **Resizing**: with the Images binding, an upload is re-encoded to WebP at each preset size
  (first GIF frame, metadata removed). Without it, or when Images refuses the file, the
  original is stored once with location and camera metadata stripped and served at every size.
- **Replacing**: `pruneImages` deletes a replaced picture's objects after the new key is saved;
  `deleteOwnerMedia` removes everything an account or org owns.
- **Fallbacks** (`fallback-avatar.ts`): initials on a tile for a person, a symmetric 5x5
  identicon for an organization, seeded by the account id so a handle change keeps the colour.

Settings and pictures are described in
[29-settings.md](../../docs/claude-opus/29-settings.md).

## Layout

There is no index module; import files by path, for example
`@gitstalk/shared-media/images` (the `exports` map is `./*` to `./src/*.ts`).

| Path | Contents |
| --- | --- |
| `src/images.ts` | `mediaStore(env)` (`uploadImage`, `pruneImages`, `deleteOwnerMedia`), `serveImage`, `imageUrl`, key parsing, `imagesResizer` |
| `src/image-format.ts` | Format sniffing, dimensions, metadata strip |
| `src/fallback-avatar.ts` | `fallbackAvatar`, `initialsOf`, `fallbackAvatarSvg` |
| `test/` | Tests, a test-only Worker and `wrangler.jsonc` (R2 and Images bindings for Miniflare) |

Imported by `packages/web` (profile avatar, org icon and social-image routes, and the
`/media/[...path]` route).

## Develop

```bash
pnpm -F @gitstalk/shared-media test        # vitest in workerd with a real R2 bucket; tests inject their own resizer
pnpm -F @gitstalk/shared-media typecheck   # tsc -p tsconfig.json
pnpm -F @gitstalk/shared-media types       # regenerate worker-configuration.d.ts from test/wrangler.jsonc
```

There is no `dev` script and no `.dev.vars`.

## Configuration

The importing Worker provides (`MediaEnv`):

- `MEDIA`: R2 bucket `gitstalk-media`.
- `IMAGES`: Cloudflare Images binding, optional.

No vars or secrets. The library ships as part of `gitstalk-web`; see
[30-environments.md](../../docs/claude-opus/30-environments.md) for provisioning the bucket and
deploying.

## Contributing

See [CONTRIBUTING.md](../../CONTRIBUTING.md); run `pnpm check` at the root before sending a
change.
