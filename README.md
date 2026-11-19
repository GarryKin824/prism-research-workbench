# PRISM Research Workbench

PRISM is an independent DeepSeek Harness (DSH) plugin for local literature research. It brings PDF reading, excerpts, evidence, model-assisted research steps, human review, writing, citations and export into one workbench. It is not an official DeepSeek product.

## Download the Windows preview

[Download v0.2.0-preview.1](https://github.com/GarryKin824/prism-research-workbench/releases/tag/v0.2.0-preview.1). Choose `PRISM-0.2.0-preview.1-Windows.zip` and `SHA256SUMS.txt`, check the hash, and extract into a dedicated folder. Run `INSTALL-PRISM.cmd`, then `START-PRISM.cmd`.

[中文快速开始](QUICKSTART.zh-CN.md) · [English quick start](QUICKSTART.en.md) · [Windows instructions](WINDOWS.md) · [Direct DSH installation](DSH-DIRECT.md)

The tested preview targets Windows 11, Node.js 24, DSH 0.2.2-rc.1 and Chrome. The workbench UI is Chinese. DeepSeek requires DSH account sign-in; Codex requires its own configured and signed-in execution environment. ZCode uses manual handoff. No model account is included in the source or packages.

## Clone and run the development preview

The `main` branch contains the complete approved preview source. With Node.js 24 installed:

```sh
git clone https://github.com/GarryKin824/prism-research-workbench.git
cd prism-research-workbench
npm ci --ignore-scripts --no-audit --no-fund
npm run build:preview
npm run dev
```

Open the local URL printed by the development server. This preview supports reading and editing, but does not provide DeepSeek sign-in. Use the Windows package or the DSH installation instructions for model execution. `npm run build` builds the plugin client and host components.

## Research workflow

- Import TXT, Markdown, PDF or a saved project; read PDF file pages, record excerpts and judgments, and return to the source to check evidence.
- Set workflow-wide output requirements and writing presets, then preview the actual text sent for each step. Select PDF pages or excerpts before execution. Saved requests retain the requirements used.
- Review model results before incorporating them into evidence, arguments and drafts. Models do not have approval authority. Automatic step progression can be configured; model requests still require the workflow's confirmation.
- Export Markdown and portable project backups. Recovery includes saved papers, excerpts, arguments, drafts and execution records, but does not merge or restore model account credentials.

## Limits and recovery

PDF extraction supports selectable text, not OCR. Each PDF can be up to 32 MiB and 300 pages; extracted text is limited to 200,000 characters and 512 KiB. The UI reports unsupported pages and truncation. PDF file page numbers start at 1 and may differ from printed page numbers.

Research requests have a 24,000 UTF-8 byte limit, including context, selected materials and workflow requirements. Preview the request and reduce the selection if necessary. The DeepSeek step has a 512-token output limit; truncated results remain partial and do not automatically advance. Preserve existing request IDs when checking interrupted runs to avoid duplicate calls.

Storage depends on the browser profile and workbench URL. Export project backups before moving or changing the installation. Original PDF storage has its own status if space is insufficient.

## Release source and provenance

Release assets remain unchanged. `PRISM-0.2.0-preview.1-source.zip` contains the complete approved source snapshot; this main-branch import preserves its files byte-for-byte except this README. The existing release tag was created during the initial browser publication and points to the original README/LICENSE-only commit. Therefore GitHub's automatically generated source archives for **that tag** contain only those two files. Use the custom source ZIP for the frozen preview source, or clone `main` for the complete repository.

## License

PRISM's own code: [MIT](LICENSE), Copyright (c) 2026 GarryKin. Third-party components retain their own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md) and [changelog](CHANGELOG.md). The bundled PLOS ONE example article is CC0. [Paper and license](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0246822) · [Publisher correction](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0314295).
