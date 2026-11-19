# PRISM Research Workbench

PRISM is an independent DeepSeek Harness (DSH) plugin for local literature research. It connects PDF reading, excerpts, evidence, model-assisted research steps, human review, writing and export. It is not an official DeepSeek product.

## Download the Windows preview

Open [Releases](https://github.com/GarryKin824/prism-research-workbench/releases) and download `PRISM-0.2.0-preview.1-Windows.zip` and `SHA256SUMS.txt`. Extract the ZIP into a dedicated folder, run `INSTALL-PRISM.cmd`, then `START-PRISM.cmd`. Chinese and English quick starts are included.

The tested preview targets Windows 11, Node.js 24, DSH 0.2.2-rc.1 and Chrome. DeepSeek requires DSH sign-in; Codex requires its separately configured execution environment. ZCode uses manual handoff. PDF extraction supports selectable text, not OCR.

## Complete source code

**Download the release attachment `PRISM-0.2.0-preview.1-source.zip` for the complete source code, build instructions and third-party notices.** This repository currently contains this README and LICENSE only. GitHub's automatically generated `Source code (zip)` and `Source code (tar.gz)` contain only these repository files, not the complete application.

The source ZIP and install packages are the approved preview artifacts. Browser-created repository commits do not preserve the source archive's original commit identity. Check package hashes against `SHA256SUMS.txt`.

## License

PRISM's own code is licensed under [MIT](LICENSE). Copyright (c) 2026 GarryKin. Third-party components retain their own licenses; their notices are included in the packages. The bundled PLOS ONE example article is distributed under CC0; consult its publisher correction when interpreting the table footnotes.