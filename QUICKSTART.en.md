# PRISM for Windows · Quick start

[中文快速开始](QUICKSTART.zh-CN.md) · [Direct DSH installation](DSH-DIRECT.md)

## Install and connect

1. Install Node.js 24 and official DeepSeek Harness (DSH) `0.2.2-rc.1`. Use Chrome for the tested browser path. Compare the downloaded ZIP's SHA-256 against the release checksums, then extract it into a dedicated folder you can keep. [Official DSH download](https://www.deepseek.com/harness/en/)
2. Double-click `INSTALL-PRISM.cmd`. If prompted, enter the absolute path to the installed official DSH `lib/bin.js`. Installation creates a dedicated `PRISM-data` folder and uses loopback port 33833. If occupied, choose an unused port using Windows PowerShell, for example `./INSTALL-PRISM.cmd -Port 33834`.
3. Double-click `START-PRISM.cmd`, leave its window running, and authorize local access in the official browser tab that it opens. To choose a Chrome profile yourself, close this launch and use `START-PRISM-MANUAL.cmd`. Open the authorization URL printed in that local window and keep it private.
4. Open **PRISM 工作台** (PRISM Workbench) in the DSH sidebar. Sign in to DeepSeek through the DSH account menu and check for **DeepSeek 账号已就绪** (account ready). PRISM's workbench UI is currently in Chinese. This guide includes the labels you will see.

If your connection already uses a local HTTP proxy, provide its existing port with `-ProxyPort` at install time. See [Windows setup and backup](WINDOWS.md) for changing this setting, using an optional Codex connection, and upgrading.

## Run one study step

1. Go to **导入论文 → 创建项目** (Import paper → Create project), enter a name and objective, then preview and save. Go to **提取 PDF 正文** (Extract PDF text), enable this import and confirm that you trust the PDF. Select **导入已配置的本机 PDF** (Import configured local PDF), or choose `examples/riparian-thinning.pdf` with the file picker. Check the preview, confirm **保存为新档案** (Save as new record), select **导入正文** (Import text), then **加入当前项目** (Add to current project). Check the source PDF status.
2. Open **编辑步骤 → 创建研究计划** (Edit steps → Create plan). In **流程级输出要求** (Workflow output requirements), save a short rule such as “State the conclusion first. Cite the PDF file page and distinguish observations from interpretations.” Edit a step to ask where the stream temperature sensors were placed and what they measured.
3. Go to **开始研究** (Start research), select that step, enable **附上论文正文** (Attach paper text), and choose PDF file pages 3–4. Open **预览模型请求** (Preview model request). Check the model, pages and exact output requirements. Only the confirmed material is sent to the selected model. Select **确认发送一次** (Confirm and send once). Token usage is shown when returned. The DSH account route may omit monetary amounts.
4. When the reply arrives, select **填入本节点原文草稿 → 预览待保存答复 → 保存答复** (Use reply in this step → Preview → Save). Complete the confirmation shown on the page. Under **查看结果** (View results), open **核对输入出处 → 打开 PDF 原页** (Check input source → Open original PDF page). Page numbers here count from the first page of the PDF file. Review the result and evidence yourself before marking it approved.

The example is Roon, Dunham and Groom (2021). Use the publisher's correction when interpreting the footnotes to Tables 2 and 3. [Article](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0246822) · [Correction](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0314295)

## Reopen, export and recover

- In the source dialog use **下载研究结果 Markdown** (Download result Markdown). It includes the saved answer, the exact requirements, the input excerpt, the source fingerprint, PDF file pages and the request ID. Use **项目便携备份** (Portable project backup) to keep the plan and execution history. Check both exports before sharing them.
- Enable **本机副本** (Local backup) and select **立即保存本机副本** (Save local backup now) before closing. Reopen with the same launcher and Chrome profile. If you switch browser profiles, authorize the same DSH host and restore from **找到可恢复的本机副本** (Recoverable local backup) in a blank PRISM workspace. Keep a separate copy of `PRISM-data` and your original PDFs.
- If a request is interrupted or its outcome is unknown, return to the step and select **只读查回** (Look up existing request). A pending request keeps its ID. An expired local owner session uses the original launcher for authorization. Sign in through the account menu when DSH explicitly reports you are signed out.

PRISM currently extracts selectable PDF text up to 32 MiB and 300 pages, with a separate extracted-text limit. Scans need OCR before extraction. The UI reports partial extraction and truncated model results. Codex requires a separate official sign-in and setup. ZCode is a manual handoff in this preview.
