# Credits: fastify

This arena is built from [fastify/fastify](https://github.com/fastify/fastify) (MIT). Its base is upstream commit
`810e3d548eeceb32c948a0fbfdd90d6d1e6098ce`; every task is one pull request merged upstream after it. A task's prompt is the pull request's
title and description, its acceptance tests are the tests the pull request added or changed, and its reference
solution (`solutions/`) is the pull request's own change, re-based in history order (the chain build). All of that
work is the upstream authors'; this directory only rearranges it into race tasks. Thank you.

## Pull requests and their authors

| task | pull request | title | author | merged |
|---|---|---|---|---|
| t001 | [#6372](https://github.com/fastify/fastify/pull/6372) | fix: handle web stream payload in HEAD route | [@orionmiz](https://github.com/orionmiz) | 2025-11-03 |
| t002 | [#6247](https://github.com/fastify/fastify/pull/6247) | fix: consistent error handling for custom validators in async validation contexts | [@emicovi](https://github.com/emicovi) | 2025-11-08 |
| t003 | [#6383](https://github.com/fastify/fastify/pull/6383) | feat: speed up loading with custom compiler | [@Eomm](https://github.com/Eomm) | 2025-11-10 |
| t004 | [#6412](https://github.com/fastify/fastify/pull/6412) | fix: set status code before publishing diagnostics error channel | [@tt-a1i](https://github.com/tt-a1i) | 2025-12-14 |
| t005 | [#6392](https://github.com/fastify/fastify/pull/6392) | fix(ts): Align routerOptions defaultRoute types with runtime | [@AnkanMisra](https://github.com/AnkanMisra) | 2026-01-02 |
| t006 | [#5732](https://github.com/fastify/fastify/pull/5732) | feat: implement conditional request logging | [@kibertoad](https://github.com/kibertoad) | 2026-01-13 |
| t007 | [#6414](https://github.com/fastify/fastify/pull/6414) | chore: Updated content-type header parsing | [@jsumners](https://github.com/jsumners) | 2026-01-26 |
| t008 | [#6515](https://github.com/fastify/fastify/pull/6515) | fix: avoid mutating shared routerOptions across instances | [@mcollina](https://github.com/mcollina) | 2026-02-20 |
| t009 | [#6521](https://github.com/fastify/fastify/pull/6521) | feat: First-class support for handler-level timeouts | [@kibertoad](https://github.com/kibertoad) | 2026-02-25 |
| t010 | [#6528](https://github.com/fastify/fastify/pull/6528) | fix: remove format placeholder from FST_ERR_CTP_INVALID_MEDIA_TYPE message | [@super-mcgin](https://github.com/super-mcgin) | 2026-02-28 |
| t011 | [#6603](https://github.com/fastify/fastify/pull/6603) | chore: Fix port parsing | [@jsumners](https://github.com/jsumners) | 2026-03-23 |
| t012 | [#6613](https://github.com/fastify/fastify/pull/6613) | fix: restore trustProxy function for number and string types, add null check for socketAddr | [@mcollina](https://github.com/mcollina) | 2026-03-28 |
| t013 | [#6653](https://github.com/fastify/fastify/pull/6653) | feat: add request.mediaType | [@climba03003](https://github.com/climba03003) | 2026-04-14 |
| t014 | [#6676](https://github.com/fastify/fastify/pull/6676) | fix: prevent duplicate res.end in sendTrailer with sync callbacks | [@climba03003](https://github.com/climba03003) | 2026-04-19 |
| t015 | [#6678](https://github.com/fastify/fastify/pull/6678) | fix: error.code not present on some routing errors | [@mcollina](https://github.com/mcollina) | 2026-04-19 |
| t016 | [#6657](https://github.com/fastify/fastify/pull/6657) | fix: correct isCustomSerializerCompiler flag check | [@eddieran](https://github.com/eddieran) | 2026-04-20 |
| t017 | [#6523](https://github.com/fastify/fastify/pull/6523) | fix: validate invalid route logLevel at registration | [@maxpetrusenko](https://github.com/maxpetrusenko) | 2026-04-21 |
| t018 | [#6685](https://github.com/fastify/fastify/pull/6685) | fix: use ContentType parser for response schema lookup | [@UlisesGascon](https://github.com/UlisesGascon) | 2026-04-21 |
| t019 | [#6684](https://github.com/fastify/fastify/pull/6684) | fix: do not trust forwarded host/proto when socket is missing | [@mcollina](https://github.com/mcollina) | 2026-04-24 |
| t020 | [#6458](https://github.com/fastify/fastify/pull/6458) | fix: enable diagnostics tracking for async error handlers | [@irzix](https://github.com/irzix) | 2026-05-07 |
| t021 | [#6714](https://github.com/fastify/fastify/pull/6714) | fix: ignore duplicate trailer completions | [@mcollina](https://github.com/mcollina) | 2026-05-07 |
| t022 | [#6746](https://github.com/fastify/fastify/pull/6746) | fix: chunk large HTTP/2 buffer replies | [@mcollina](https://github.com/mcollina) | 2026-06-07 |
| t023 | [#6799](https://github.com/fastify/fastify/pull/6799) | fix: clear socket._meta after response to prevent keep-alive leaks | [@nerkoux](https://github.com/nerkoux) | 2026-06-19 |
| t024 | [#6803](https://github.com/fastify/fastify/pull/6803) | fix: avoid double slash when joining nested prefixes | [@rohithvegesna](https://github.com/rohithvegesna) | 2026-06-21 |
| t025 | [#6753](https://github.com/fastify/fastify/pull/6753) | fix: hasRequestDecorator/hasReplyDecorator misses constructor-assigned built-in properties | [@LeSingh1](https://github.com/LeSingh1) | 2026-06-28 |
| t026 | [#6680](https://github.com/fastify/fastify/pull/6680) | fix: derive request.port from request.host | [@mcollina](https://github.com/mcollina) | 2026-07-05 |
| t027 | [#6838](https://github.com/fastify/fastify/pull/6838) | fix: normalize method in findRoute | [@Ram-blip](https://github.com/Ram-blip) | 2026-07-11 |
| t028 | [#6483](https://github.com/fastify/fastify/pull/6483) | fix(validation): correctly update falsy values from validator | [@jackjin1997](https://github.com/jackjin1997) | 2026-07-26 |
| t029 | [#6881](https://github.com/fastify/fastify/pull/6881) | fix: uncatchable throws in writeHead when using async hook | [@climba03003](https://github.com/climba03003) | 2026-07-30 |
| t030 | [#6845](https://github.com/fastify/fastify/pull/6845) | fix: clear trailer state when removing all trailers | [@Ram-blip](https://github.com/Ram-blip) | 2026-08-03 |
| t031 | [#6892](https://github.com/fastify/fastify/pull/6892) | fix: recognize constructor-assigned built-in properties as decorator … | [@aquie00t](https://github.com/aquie00t) | 2026-08-08 |
| t032 | [#6846](https://github.com/fastify/fastify/pull/6846) | fix: reset lastIndex before testing global/sticky content-type RegExp parsers | [@zelinewang](https://github.com/zelinewang) | 2026-08-08 |
| t033 | [#6940](https://github.com/fastify/fastify/pull/6940) | fix: run preClose hook exactly once per declaring instance | [@contactjawad](https://github.com/contactjawad) | 2026-08-14 |
| t034 | [#6719](https://github.com/fastify/fastify/pull/6719) | fix: report canonical route url for hidden prefix slash route | [@paulkagiri](https://github.com/paulkagiri) | 2026-08-16 |
| t035 | [#6965](https://github.com/fastify/fastify/pull/6965) | fix: callNotFound should run not-found preHandler regardless of registration order | [@mcollina](https://github.com/mcollina) | 2026-08-23 |
| t036 | [#7039](https://github.com/fastify/fastify/pull/7039) | perf: read the merged headers once in the trust proxy getters | [@hktitof](https://github.com/hktitof) | 2026-09-22 |
| t037 | [#7049](https://github.com/fastify/fastify/pull/7049) | perf: decode string bodies once instead of per chunk | [@gurgunday](https://github.com/gurgunday) | 2026-09-25 |
| t038 | [#7001](https://github.com/fastify/fastify/pull/7001) | fix: omit absent compileSerializationSchema metadata instead of passing null | [@Kjubikstronk](https://github.com/Kjubikstronk) | 2026-09-26 |

38 tasks by 26 authors: @AnkanMisra, @aquie00t, @climba03003, @contactjawad, @eddieran, @emicovi, @Eomm, @gurgunday, @hktitof, @irzix, @jackjin1997, @jsumners, @kibertoad, @Kjubikstronk, @LeSingh1, @maxpetrusenko, @mcollina, @nerkoux, @orionmiz, @paulkagiri, @Ram-blip, @rohithvegesna, @super-mcgin, @tt-a1i, @UlisesGascon, @zelinewang.

## Upstream licence

The upstream's licence at the base commit, which covers the tests and patches copied here:

```
MIT License

Copyright (c) 2016-present The Fastify Team

The Fastify team members are listed at https://github.com/fastify/fastify#team
and in the README file.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
