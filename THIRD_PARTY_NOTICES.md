# Third-party notices and source availability

## anti-defensive-writing

PRISM’s built-in preset adapts a short set of writing rules from Kiterlin’s anti-defensive-writing skill. Copyright (c) 2026 Kiterlin. The MIT notice is included in `third-party/anti-defensive-writing/LICENSE`. [Upstream source](https://github.com/Kiterlin/anti-defensive-writing).

Original PRISM code awaits a publication license decision. Each third-party component or document keeps the terms described here.

## shadcn/ui and control build dependencies

The active components in `src/shadcn` are adapted from the upstream shadcn/ui `new-york-v4` registry under the MIT license. The complete notice, registry URLs and component source digests are in `third-party/shadcn-ui`. Its `dependency-notices.json` lists the pinned registry distributions and complete notices for the additional dependencies, including Tailwind CSS, Radix, Lucide and class-variance-authority. Builds consume the checkout and npm lockfile. The generated client reuses React from the host and uses its `createPortal` when exposed.

## PDF.js 6.3.289

Upstream: https://github.com/mozilla/pdf.js and https://www.npmjs.com/package/pdfjs-dist/v/6.3.289

Copyright 2024 Mozilla Foundation (as retained in the vendored module headers). PDF.js is Apache License 2.0. Full upstream notices are retained in `src/pdf-intake/licenses/PDFJS-LICENSE` and `pdfjs-Apache-2.0.txt`. The inspected official npm 6.3.289 distribution has no separate NOTICE file.

`src/pdf-intake/vendor/pdf.mjs` is the pinned browser module. `worker-input-source.mjs` contains the pinned worker distribution plus the preexisting lab network-denial wrapper. `build.mjs` derives a classic Worker using pinned esbuild 0.25.12, embeds local CMaps/fonts, and produces the experimental opaque-frame runtime. The derived Worker is **not upstream original bytes**. `vendor/REBUILD.json` records input/output hashes and warnings. Historical origin hashes live in `third-party/pdf-intake-original-lock.json` and `pdf-worker-original-derivation.json`; their old sibling paths are provenance, not build dependencies.

## Adobe CMaps

168 local CMap resources in `vendor/binary-assets.mjs` carry Adobe's copyright and redistribution terms. Preserve `src/pdf-intake/licenses/cmaps-LICENSE` in source and binary distributions.

## Foxit standard fonts

10 local standard-font resources carry the terms in `src/pdf-intake/licenses/standard_fonts-LICENSE_FOXIT`. Preserve that complete notice.

## Liberation Sans 1.07.4

Four embedded TTF resources are Liberation Sans 1.07.4. They are licensed under GNU GPL version 2 with the Red Hat font exceptions, **not SIL OFL**, and must not be described as MIT. The document-embedding exception does not remove the font software's own distribution obligations.

Full license/EULA, exceptions, and GPLv2 text: `src/pdf-intake/licenses/standard_fonts-LICENSE_LIBERATION`.

Corresponding version's complete upstream source release (SFD files, Makefile/scripts, COPYING and License.txt) is included directly in this source and install distribution:

`third-party/sources/debian-fonts-liberation_1.07.4.orig.tar.gz`

SHA256: `ad98b7498dc2992f7f0868f79b65ce4a720a3acdb63ab3f1f1cb6881117a5406`

Source: https://deb.debian.org/debian/pool/main/f/fonts-liberation/fonts-liberation_1.07.4.orig.tar.gz

The source archive was cross-checked byte-for-byte with the original 1.07.4 source tar in a GNU/Cygwin mirror. The embedded four TTF files match the official pdfjs-dist 6.3.289 package bytes. This is source availability verification; **we have not reproduced the historical FontForge build bit-for-bit**. The historical build instructions and prerequisites are inside the source archive. Keep this source archive with distributions containing these fonts; do not replace it with a dead URL or claim a different Git tag is identical.

## Build/test dependencies

The exact versions and registry integrity hashes are recorded in `package-lock.json`:

- esbuild 0.25.12 (MIT; build-time only)
- React and ReactDOM 18.3.1 (MIT; tests/native Host supplies React at runtime)
- jsdom 31.0.0 and its locked transitive dependencies (test-time only; individual npm package licenses apply)

The source archive omits `node_modules`. Use `npm ci --ignore-scripts` to install the pinned build dependencies. Obtain the DSH runtime independently from the official distributor.

## Rich-text presentation: KaTeX 0.19.1 and Marked 17.0.5

Fixed official npm distributions were retrieved and checked against their exact-version SHA-512 integrity and SHA-1 values. Full original licenses and package metadata are retained under `third-party/rich-text/`; detailed provenance and SHA-256 values are in `THIRD-PARTY-RICH-TEXT-MANIFEST.json`. These transfer checks are not independent verification of registry signatures. No installation scripts ran.

KaTeX is MIT licensed (upstream https://github.com/KaTeX/KaTeX); preserve `third-party/rich-text/katex/LICENSE`. Only its standalone ESM distribution is used, with MathML output and trusted commands disabled; no KaTeX CSS/fonts or CLI dependency are included. Marked is MIT licensed with inherited Markdown notices (upstream https://github.com/markedjs/marked); preserve the full `third-party/rich-text/marked/LICENSE.md`.

Both are bundled locally into the generated client. Markdown tokens and sanitized MathML nodes are rendered by PRISM's presentational layer; the generated code is not byte-identical upstream distribution. Marked HTML output is not a sanitizer and is not inserted into the DOM. Rendering does not authorize loading external assets or executing raw HTML.

## Example PDF in the Windows ZIP

David A. Roon, Jason B. Dunham and Jeremiah D. Groom (2021), *Shade, light, and stream temperature responses to riparian thinning in second-growth redwood forests of northern California*, PLOS ONE 16(2), e0246822. PLOS distributes the article under the CC0 public-domain dedication. The example is the unmodified article PDF. [Article and terms](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0246822)

PLOS issued a correction to the presentation of the notes to Tables 2 and 3. The publisher's correction is distributed separately under CC BY. [Publisher correction](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0314295)
