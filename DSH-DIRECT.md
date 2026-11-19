# Direct DSH installation · DSH 直接安装

Use the Windows ZIP and [quick start](QUICKSTART.en.md) for the tested path. It creates a dedicated local profile, model journal and recovery directory. The official DSH CLI also supports installing the same prebuilt `.tgz` without running package build or lifecycle scripts. [Official DSH publishing and install guide](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md)

## Dedicated DSH Web home on Windows

Run this in a separate PowerShell window from the extracted ZIP. Replace the placeholder with a new folder and use an unused loopback port. The example assumes the official `dsh` shim is on PATH. If you use its Node entry instead, replace each `dsh` invocation with `node <path-to-official-dsh-lib/bin.js>`. Use DSH `0.2.2-rc.1` and Node.js 24.

```powershell
$prismHome = '<absolute path to a new dedicated DSH home>'
if (Test-Path -LiteralPath $prismHome) { throw 'Choose a new dedicated directory.' }
New-Item -ItemType Directory -Path $prismHome | Out-Null
$env:DSH_HOME = $prismHome
dsh --profile web --dump-config | Out-Null
dsh plugin --profile web add ./prism-local-workbench-0.2.0-preview.1.tgz --offline --ignore-scripts
```

Before starting the Web host, put the dedicated local component override in `profiles/web/cordis.patch.yml` under that new DSH home. Use [the config example](prism-dsh.example.yml), generate a new `storageNamespace` with `[guid]::NewGuid()`, and replace the example origin and paths. Leave the recovery and reference PDF settings commented until you have specified their own writable directory or explicitly trusted local PDF. The packaged component starts disabled outside an explicit local enablement.

```powershell
dsh --profile web --host 127.0.0.1 --port 33833 --no-open
```

Open the official local authorization link printed by DSH in your chosen browser profile. Sign in through the DSH account menu. The local owner authorization and model sign-in stay with that dedicated host. Keep this terminal for future starts so that `DSH_HOME` points to the same dedicated folder. Reopen with a fresh terminal by setting the same `DSH_HOME` and starting the same loopback origin.

## 安装要点

优先使用 Windows ZIP 的双击启动方式。熟悉 DSH CLI 时，可在专用 PowerShell 窗口设置新 `DSH_HOME`，按上面的命令安装预构建包。在新档案的本地配置中启用 PRISM，写入独立资料目录和相同的环回源站，再从 DSH 打印的官方入口授权。保留专用目录和账号各自原有的安全边界。可选 PDF 路径必须指向你明确选择并核对过 SHA-256 的原件。

Discover uses its own index format and resolves a version to npm or a pinned Git source. The GitHub Release attachment and this direct installer use the prebuilt tarball. [Official Discover format](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/plugin-market.md)
