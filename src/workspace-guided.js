const guidedStages = [["library","导入论文"],["planning","编辑步骤"],["execution","开始研究"],["results","查看结果"]];

const guidedStyles = `
.prism-shell { color-scheme:light; container-type:inline-size; font:0.9375rem/1.6 Inter,"Segoe UI","Microsoft YaHei UI",system-ui,sans-serif; --prism-bg:#f4f5f3; --prism-panel:#fff; --prism-line:#dbdfda; --prism-control:#737e76; --prism-ink:#18211d; --prism-muted:#526059; --prism-accent:#155d4a; --prism-active:#e9f2ed; --prism-hover:#eef1ee; --prism-warn:#8c4e0c; --prism-error:#9b2d22; --prism-gap:0.875rem; --prism-surface-padding:1rem; }
.prism-workspace { background:var(--prism-bg); color:var(--prism-ink); padding:0 clamp(0.75rem,3%,2.5rem) 1.5rem; overflow-wrap:anywhere; }
.prism-workspace [hidden] { display:none !important; }
.prism-column { inline-size:min(100%,75rem); margin-inline:auto; }
.prism-skip:not(:focus) { position:absolute; clip-path:inset(50%); inline-size:1px; block-size:1px; overflow:hidden; }
.prism-skip { display:inline-block; color:var(--prism-accent); margin-block-end:0.5rem; }
.prism-header { border-block-end:1px solid var(--prism-line); margin-block-end:var(--prism-gap); }
.prism-preview-label { font-size:0.8125rem; color:var(--prism-muted); }
.prism-connection { font-size:0.8125rem; color:var(--prism-muted); display:inline-flex; gap:7px; align-items:center; }
.prism-connection::before { content:""; width:7px; height:7px; border-radius:50%; background:#929aab; }
.prism-connection[data-ready=true]::before { background:#168263; }
.prism-context { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1.45fr); align-items:start; gap:0.5rem 1.5rem; padding-block:0.5rem; }
.prism-context-item { display:flex; align-items:baseline; flex-wrap:wrap; gap:0.1875rem 0.625rem; min-inline-size:0; }
.prism-context small { color:var(--prism-muted); font-size:0.8125rem; flex:none; }
.prism-context strong { font-weight:600; min-inline-size:0; }
.prism-workspace .prism-context .prism-context-item select { display:inline-block; flex:1 1 13rem; inline-size:auto; min-block-size:2.125rem; padding:0.1875rem 0.5rem; margin:0; }
.prism-steps { display:flex; overflow-x:auto; gap:0.1875rem; margin:0; padding:0.25rem; scroll-padding-inline:0.25rem; }
.prism-workspace .prism-step { flex:0 0 auto; position:relative; border-color:transparent; background:transparent; color:var(--prism-muted); padding-inline:0.75rem; white-space:nowrap; font:inherit; font-weight:600; min-block-size:2.5rem; cursor:pointer; }
.prism-workspace .prism-step[aria-selected=true] { color:var(--prism-accent); }
.prism-step[aria-selected=true]::after { content:""; position:absolute; inset-inline:0.375rem; inset-block-end:0; border-block-end:3px solid currentColor; }
.prism-tile { background:var(--prism-panel); border:1px solid var(--prism-line); border-radius:8px; padding:var(--prism-surface-padding); min-inline-size:0; }
.prism-tile > :last-child { margin-block-end:0; }
.prism-task { background:var(--prism-hover); }
.prism-task .prism-actions { margin-block-start:0.625rem; }
.prism-intake-body > .prism-card,.prism-intake-body > div > .prism-card { margin-block-start:0.75rem; }
.prism-results-tabs { border-block-end:1px solid var(--prism-line); margin-block:0 0.75rem; }
.prism-result-pane { min-inline-size:0; }
.prism-result-pane:focus-visible,.prism-stage:focus-visible { outline:2px solid var(--prism-accent); outline-offset:2px; }
.prism-workspace .prism-stage > .prism-stage-heading { margin-block-end:0; }
.prism-workspace .prism-reader.prism-tile { border-block-start:1px solid var(--prism-line); padding:var(--prism-surface-padding); }
.prism-library-search { display:grid; grid-template-columns:minmax(0,2fr) minmax(0,1fr); gap:0.375rem 0.75rem; }
.prism-library-search :is(input,select) { inline-size:100%; margin:0; }
.prism-library-list { list-style:none; margin:0; padding:0; }
.prism-library-list li { padding-block:0.5rem; border-block-end:1px solid var(--prism-line); }
.prism-library-list li:last-child { border-block-end:0; }
.prism-library-list p { margin-block:0.1875rem; }
.prism-library-list button[aria-current=true] { border-inline-start:3px solid var(--prism-accent); background:var(--prism-active); }
.prism-workspace h2 { margin:0 0 0.625rem; font-size:1.3125rem; font-weight:650; }
.prism-workspace h3 { margin:0 0 0.5rem; font-size:1.0625rem; font-weight:650; }
.prism-workspace h4 { margin:0 0 0.5rem; font-size:1rem; font-weight:650; }
.prism-workspace :is(h1,h2,h3,h4) { letter-spacing:0; }
.prism-workspace :is(h1,h2,h3) { text-wrap:balance; }
.prism-stage-heading { scroll-margin-block-start:1rem; }
.prism-workspace p { margin:7px 0 12px; }
.prism-workspace :is(.research-content,.prism-intake) :is(p,blockquote) { max-inline-size:72ch; text-wrap:pretty; }
.prism-stage { display:grid; gap:var(--prism-gap); min-width:0; }
.prism-card { min-width:0; border-block-start:1px solid var(--prism-line); padding-block:0.875rem; }
.prism-card > :last-child { margin-bottom:0; }
.prism-intake { display:grid; gap:10px; }
.prism-intake p { max-width:56ch; }
.prism-intake .prism-actions { margin-top:0; }
.prism-intake .prism-file { margin:0; }
.prism-workspace button[aria-pressed=true] { color:var(--prism-accent); background:var(--prism-active); border-color:var(--prism-accent); box-shadow:inset 0 0 0 1px var(--prism-accent); }
.prism-workspace .prism-form { display:grid; gap:10px; }
.prism-form > label { display:block; }
.prism-form > label > :is(input:not([type=checkbox]):not([type=file]),select) { display:block; width:100%; margin-top:5px; }
.prism-zotero { margin-block: .75rem; min-inline-size: 0; }
.prism-zotero :is(li,dd,label,option) { overflow-wrap: anywhere; }
.prism-zotero :is(select,input[type=search]) { display: block; box-sizing: border-box; inline-size: 100%; min-inline-size: 0; }
.prism-zotero-filters { display: flex; flex-wrap: wrap; gap: .75rem; align-items: end; }
.prism-zotero-filters > label { flex: 1 1 13rem; }
.prism-zotero-filters > form { flex: 3 1 19rem; align-items: end; }
.prism-zotero-filters > form > label { flex: 1 1 12rem; }
.prism-zotero-folders { display: flex; flex-wrap: wrap; align-items: end; gap: .75rem; }
.prism-zotero-folders > label { flex: 1 1 12rem; }
.prism-zotero-list { list-style: none; padding: 0; margin: .5rem 0; }
.prism-zotero-list > li { padding: .625rem .25rem; border-block-end: 1px solid var(--prism-border,#ddd); }
.prism-zotero-list > li > label { display: grid; grid-template-columns: auto minmax(0,1fr); align-items:start; gap: .5rem; cursor: pointer; }
.prism-zotero-list .prism-actions { align-items: end; }
.prism-zotero-list small { display: block; }
.prism-zotero-source { overflow-wrap: anywhere; }
.prism-execution-fields { display: grid; grid-template-columns: repeat(auto-fit,minmax(min(100%,12rem),1fr)); gap: .75rem; }
.prism-execution-fields input,.prism-execution-config select { display: block; box-sizing: border-box; inline-size: 100%; min-inline-size: 0; }
.prism-execution-input { white-space: pre-wrap; overflow-wrap: anywhere; max-block-size: 18rem; overflow: auto; }
.prism-execution-config,.prism-codex-readiness { overflow-wrap: anywhere; min-inline-size: 0; }
.prism-candidate { padding-block:8px; border-top:1px solid var(--prism-line); }
.prism-candidate p { margin:3px 0; }
.prism-candidate summary { padding-block:2px; }
.prism-format-help { font-size:0.875rem; }
.prism-file { margin-top:5px; width:fit-content; cursor:pointer; }
.prism-file input,.prism-visually-hidden { position:absolute; inline-size:1px; block-size:1px; margin:-1px; padding:0; border:0; clip-path:inset(50%); overflow:hidden; white-space:nowrap; }
.prism-file:focus-within { outline:2px solid var(--prism-accent); outline-offset:3px; }
.prism-file[data-disabled=true] { opacity:.55; cursor:not-allowed; }
.prism-actions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-block:12px 0; }
.prism-muted { color:var(--prism-muted); }
.prism-workspace :where(button:not([data-slot]),.prism-button) { display:inline-flex; justify-content:center; align-items:center; gap:0.375rem; color:var(--prism-ink); background:white; border:1px solid var(--prism-control); font:inherit; border-radius:8px; padding:0.375rem 0.75rem; min-block-size:2.5rem; min-inline-size:1.5rem; text-align:start; box-sizing:border-box; cursor:pointer; max-inline-size:100%; overflow-wrap:anywhere; }
@media (hover:hover) {
  .prism-workspace :where(button:not([data-slot]):hover:not(:disabled,[aria-disabled=true]),.prism-button:hover) { background:var(--prism-hover); }
  .prism-workspace .prism-primary:hover:not(:disabled) { background:#104b3b; }
}
.prism-workspace .prism-primary { background:var(--prism-accent); color:white; border-color:var(--prism-accent); font-weight:600; }
.prism-workspace button:disabled { opacity:.52; cursor:not-allowed; }
.prism-shell [data-slot=button] {
  min-block-size:2.5rem; block-size:auto; max-inline-size:100%; border-width:1px; border-style:solid;
  border-color:var(--prism-control); font:inherit; font-weight:550; padding:0.375rem 0.75rem;
  text-align:start; overflow-wrap:anywhere; cursor:pointer;
}
.prism-shell [data-slot=button][data-variant=default] { border-color:var(--prism-accent); }
.prism-shell [data-slot=button]:disabled { pointer-events:auto; cursor:not-allowed; }
.prism-shell [data-slot=button][aria-disabled=true] { cursor:not-allowed; }
.prism-shell [data-slot=accordion-trigger] {
  display:flex; list-style:none; min-block-size:2.5rem; box-sizing:border-box; gap:0.375rem; overflow-wrap:anywhere;
}
.prism-shell [data-slot=accordion-trigger]::-webkit-details-marker { display:none; }
.prism-shell [data-slot=accordion-trigger] > [data-prism-disclosure-icon] { rotate:-90deg; }
.prism-shell details[open] > [data-slot=accordion-trigger] > [data-prism-disclosure-icon] { rotate:0deg; }
.prism-shell [data-slot=accordion-trigger]:dir(rtl) > [data-prism-disclosure-icon] { rotate:90deg; }
.prism-shell details[open] > [data-slot=accordion-trigger]:dir(rtl) > [data-prism-disclosure-icon] { rotate:0deg; }
.prism-workspace .prism-connection[data-slot=badge] { border-radius:8px; border-color:var(--prism-line); font-weight:500; }
.prism-workspace .prism-connection[data-ready=true] { border-color:var(--prism-accent); }
.prism-shell .prism-notice { border:1px solid var(--prism-line); margin-block-end:0.75rem; overflow-wrap:anywhere; }
.prism-shell .prism-notice [data-slot=alert-description] { color:inherit; }
.prism-shell [data-prism-portal] { font:0.9375rem/1.6 Inter,"Segoe UI","Microsoft YaHei UI",system-ui,sans-serif; }
.prism-shell [data-slot=alert-dialog-action] {
  border:1px solid var(--prism-error); background:var(--prism-error); color:white; font:inherit;
  border-radius:8px; min-block-size:2.5rem; padding:0.375rem 0.75rem;
}
.prism-shell [data-slot=alert-dialog-cancel] {
  border:1px solid var(--prism-control); background:var(--prism-panel); color:var(--prism-ink); font:inherit;
  border-radius:8px; min-block-size:2.5rem; padding:0.375rem 0.75rem;
}
.prism-shell :is([data-slot=alert-dialog-action],[data-slot=alert-dialog-cancel]):disabled { pointer-events:auto; opacity:.52; }
.prism-shell [data-prism-portal] :is(button,summary):focus-visible { outline:2px solid var(--prism-accent); outline-offset:2px; }
.prism-workspace :is(a,button,select,input,textarea,summary):focus-visible { outline:2px solid var(--prism-accent); outline-offset:2px; }
.prism-workspace :is(input:not([type=checkbox],[type=radio],[type=file]),textarea,select) { font:inherit; font-size:max(1rem,1em); max-inline-size:100%; min-inline-size:0; min-block-size:3rem; color:var(--prism-ink); background:white; border:1px solid var(--prism-control); border-radius:8px; box-sizing:border-box; padding:0.5rem 0.625rem; }
.prism-workspace input:is([type=checkbox],[type=radio]) { accent-color:var(--prism-accent); margin-inline-end:0.375rem; }
.prism-workspace :is(input,textarea,select):is(:user-invalid,[aria-invalid=true]) { border-color:var(--prism-error); }
.prism-field :is(input,textarea) { display:block; inline-size:100%; margin-block:0.25rem 0; }
.prism-field-error { display:block; color:var(--prism-error); }
.prism-required { color:var(--prism-muted); margin-inline-start:0.375rem; }
.prism-workspace form :is(button[type=submit],label.prism-check) { min-block-size:3rem; }
.prism-check { display:flex; gap:0.375rem; align-items:center; }
.prism-check input { flex:none; }
.prism-workspace :is(textarea,select) { display:block; width:100%; margin:5px 0 10px; }
.prism-workspace :is(label,input,textarea,select,button,section,article,fieldset,pre) { min-width:0; }
.prism-workspace textarea { resize:vertical; }
.prism-workspace fieldset { border:1px solid var(--prism-line); border-radius:8px; }
.prism-workspace pre { font-size:0.875rem; background:var(--prism-hover); border-radius:8px; padding:0.75rem; overflow:auto; max-inline-size:100%; }
.prism-workspace [role=alert] { color:var(--prism-warn); }
.prism-workspace details { margin-block:8px 0; min-width:0; }
.prism-workspace summary { color:var(--prism-muted); padding-block:0.4375rem; min-block-size:1.5rem; cursor:pointer; }
.prism-workspace details[open] > summary { color:var(--prism-ink); font-weight:600; }
.prism-steps-editor { display:grid; grid-template-columns:minmax(138px,.63fr) minmax(0,1.75fr); align-items:start; gap:18px; }
.prism-step-list { display:grid; gap:5px; }
.prism-workspace .prism-step-option { justify-content:flex-start; color:var(--prism-muted); border-color:transparent; background:var(--prism-hover); }
.prism-workspace .prism-step-option[aria-pressed=true] { color:var(--prism-accent); background:var(--prism-active); border-color:var(--prism-accent); }
.prism-editor { min-width:0; }
.prism-editor label { display:block; margin-top:9px; }
.prism-editor textarea { min-height:124px; }
.prism-support { border-block-start:1px solid var(--prism-line); padding-block-start:0.1875rem; }
.prism-support > summary { overflow-wrap:anywhere; }
.prism-shell > .prism-archive-disclosure { inline-size:min(calc(100% - 2rem),75rem); box-sizing:border-box; margin:0.5rem auto 1rem; }
.prism-restore { max-inline-size:46rem; min-inline-size:0; overflow-wrap:anywhere; }
.prism-restore h3 { margin-block:1rem 0.25rem; }
.prism-restore-field { display:block; min-inline-size:0; }
.prism-restore-field input[type=file] { display:block; max-inline-size:100%; margin-block-start:0.25rem; font:inherit; }
.prism-restore-preview { border-block-start:1px solid var(--prism-line); margin-block-start:0.75rem; padding-block:0.25rem; }
.prism-restore pre { white-space:pre-wrap; overflow-wrap:anywhere; max-block-size:20rem; }
.prism-record { border-top:1px solid var(--prism-line); padding-top:14px; margin-top:14px; }
.prism-reader { min-width:0; border-block-start:1px solid var(--prism-line); padding-top:16px; }
.prism-reader-header { display:flex; justify-content:space-between; align-items:start; flex-wrap:wrap; gap:8px 16px; margin-bottom:14px; }
.prism-reader-header h2 { margin:0 0 0.25rem; }
.prism-reader-grid { display:grid; grid-template-columns:minmax(0,1.6fr) minmax(260px,1fr); gap:20px; align-items:start; }
.prism-reading-text { min-width:0; }
.prism-reading-text textarea { width:100%; min-height:220px; }
.prism-reading-evidence { min-width:0; padding-inline-start:16px; border-inline-start:1px solid var(--prism-line); }
.prism-reader-saved { margin-top:14px; padding-top:12px; border-top:1px solid var(--prism-line); }
.prism-reading-record { padding-block:12px; border-bottom:1px solid var(--prism-line); }
.prism-reading-quote { margin:5px 0; padding-inline-start:10px; border-inline-start:2px solid #cad4e4; white-space:pre-wrap; overflow-wrap:anywhere; }
.prism-reading-context { white-space:pre-wrap; overflow-wrap:anywhere; }
.prism-argument { overflow-wrap:anywhere; }
.prism-workspace .prism-argument-editor { min-inline-size:0; padding:0; border:0; margin:12px 0 0; }
.prism-argument-editor legend { font-weight:600; padding:0; margin-block-end:8px; }
.prism-argument-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,23rem),1fr)); gap:16px 24px; align-items:start; }
.prism-argument-grid > * { min-inline-size:0; }
.prism-argument label { display:block; min-inline-size:0; margin-block-end:8px; }
.prism-argument label :is(textarea,select,input) { display:block; inline-size:100%; margin:4px 0 0; }
.prism-argument textarea { resize:vertical; }
.prism-argument .prism-actions { flex-wrap:wrap; }
.prism-argument .prism-actions label { margin-block-end:0; max-inline-size:min(100%,28rem); }
.prism-argument-link,.prism-argument-picker { border-block-start:1px solid var(--prism-line); padding-block:8px; }
.prism-argument-link > p { margin-block:5px; }
.prism-argument-picker > .prism-actions { align-items:end; }
.prism-evidence-choice { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:2px 16px; max-block-size:13rem; overflow:auto; }
.prism-evidence-choice label { display:flex; align-items:baseline; min-block-size:26px; }
.prism-evidence-choice input { flex:none; }
.prism-evidence-filters { display:grid; grid-template-columns:minmax(0,2fr) repeat(2,minmax(0,1fr)); gap:8px 12px; margin-block:12px 8px; }
.prism-evidence-filters :is(input,select) { display:block; inline-size:100%; margin:4px 0 0; }
.prism-evidence-comparison .prism-table-scroll { --prism-paper-column:5.5rem; --prism-data-column:19rem; }
.prism-evidence-column-title { display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.prism-evidence-comparison .prism-reading-record:first-child { padding-block-start:0; }
.prism-evidence-comparison .prism-reading-record:last-child { border-block-end:0; }
.prism-evidence-comparison button { margin-block-start:4px; }
.prism-dialog {
  box-sizing:border-box; inline-size:min(52rem,calc(100% - 24px)); max-inline-size:none;
  max-block-size:min(44rem,calc(100vh - 24px)); max-block-size:min(44rem,calc(100dvh - 24px));
  margin:auto; padding:0 16px 16px; overflow:auto; border:1px solid var(--prism-line); border-radius:8px;
  color:var(--prism-ink); background:var(--prism-panel);
}
.prism-reading-source-dialog[open] { display:flex; flex-direction:column; }
.prism-reading-source-dialog > :not(pre,.prism-pdf-page) { flex-shrink:0; }
.prism-dialog:modal { overscroll-behavior:contain; }
.prism-dialog::backdrop { background:#10192770; overflow:hidden; overscroll-behavior:contain; }
.prism-confirm-dialog { inline-size:min(29rem,calc(100% - 24px)); padding:1rem; }
.prism-output-requirements { inline-size:min(34rem,calc(100% - 24px)); padding:1rem; }
.prism-output-requirements textarea { display:block; box-sizing:border-box; inline-size:100%; min-inline-size:0; min-block-size:8rem; resize:vertical; }
.prism-output-presets { margin-block:.5rem 1rem; }
.prism-output-presets select { max-inline-size:100%; }
.prism-output-presets pre { max-block-size:12rem; overflow:auto; }
.prism-reading-source-header {
  position:sticky; inset-block-start:0; z-index:1; display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px;
  padding-block:10px; border-block-end:1px solid var(--prism-line); background:var(--prism-panel);
}
.prism-workspace .prism-reading-source-header h2 { margin:0; font-size:1.125rem; }
.prism-source-identifiers { display:grid; grid-template-columns:minmax(0,10ch) minmax(0,1fr); gap:3px 10px; font-size:0.875rem; color:var(--prism-muted); }
.prism-source-identifiers dd { margin:0; overflow-wrap:anywhere; }
.prism-source-actions { display:flex; flex-wrap:wrap; gap:8px; margin-block:6px 0; }
.prism-reading-source-dialog pre { min-block-size:8rem; max-block-size:55vh; max-block-size:55dvh; margin-block-end:0; }
.prism-reading-source-dialog pre:focus-visible { outline:2px solid var(--prism-accent); outline-offset:2px; }
.prism-reading-source-dialog mark { background:#f9eba9; color:var(--prism-ink); }
.prism-pdf-page-tools { display:flex; flex-wrap:wrap; align-items:center; gap:6px 14px; margin-block:6px; }
.prism-pdf-page-tools p { margin:0; }
.prism-pdf-page-tools label { display:flex; align-items:center; gap:8px; }
.prism-pdf-page-tools select { inline-size:auto; margin:0; }
.prism-pdf-page { min-block-size:8rem; max-block-size:55vh; max-block-size:55dvh; overflow:auto; margin-block-start:8px; background:#f2f4f8; }
.prism-pdf-page:focus-visible { outline:2px solid var(--prism-accent); outline-offset:2px; }
.prism-pdf-page img { display:block; inline-size:min(100%, 48rem); block-size:auto; margin-inline:auto; background:white; }
.prism-comparison-filters { display:grid; grid-template-columns:minmax(0,1.7fr) repeat(3,minmax(0,1fr)); gap:8px 12px; margin-block:12px 8px; }
.prism-comparison-filters label { display:block; margin-block-end:4px; }
.prism-comparison-filters :is(input,select) { width:100%; margin:0; }
.prism-table-toolbar,.prism-table-exports { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.prism-table-toolbar { margin-block:8px; }
.prism-table-toolbar button { min-inline-size:2.5rem; border-radius:8px; }
.prism-workspace .prism-table-toolbar button[aria-disabled=true] { background:white; opacity:.58; cursor:not-allowed; }
.prism-table-separator { align-self:stretch; border-inline-start:1px solid var(--prism-line); }
.prism-table-note { color:var(--prism-muted); font-size:0.875rem; }
.prism-table-note:empty { margin:0; }
.prism-table-caption { position:absolute; inline-size:1px; block-size:1px; padding:0; overflow:hidden; clip-path:inset(50%); white-space:nowrap; }
.prism-table-scroll {
  --prism-paper-column:12rem; --prism-data-column:10rem;
  min-inline-size:0; max-inline-size:100%; max-block-size:min(36rem,70vh); max-block-size:min(36rem,70dvh);
  overflow:auto; border:1px solid var(--prism-line); border-radius:8px; background:var(--prism-panel);
  scroll-padding-inline-start:var(--prism-paper-column); scroll-padding-block-start:var(--prism-table-header-size,3rem);
}
.prism-table-scroll:focus-visible { outline:2px solid var(--prism-accent); outline-offset:2px; }
.prism-table-scroll table {
  inline-size:100%; min-inline-size:calc(var(--prism-paper-column) + var(--prism-data-column) * var(--prism-field-count));
  table-layout:fixed; border-collapse:separate; border-spacing:0;
}
.prism-table-scroll :is(th,td) { padding:8px 10px; text-align:start; vertical-align:top; border-block-end:1px solid var(--prism-line); border-inline-end:1px solid var(--prism-line); overflow-wrap:anywhere; }
.prism-table-scroll thead { position:sticky; inset-block-start:0; z-index:2; }
.prism-table-scroll thead th { background:var(--prism-hover); }
.prism-table-scroll thead th:first-child { inline-size:var(--prism-paper-column); box-sizing:border-box; }
.prism-table-scroll :is(thead th:first-child,tbody th[scope=row]) { position:sticky; inset-inline-start:0; z-index:1; }
.prism-table-scroll tbody th[scope=row] { background:var(--prism-panel); font-weight:400; }
.prism-table-scroll :is(thead th small,tbody th p) { display:block; color:var(--prism-muted); font-weight:400; }
.prism-table-scroll :is(th,td) > :last-child { margin-block-end:0; }
.prism-table-scroll tbody tr:last-child > * { border-block-end:0; }
.prism-table-scroll tr > :last-child { border-inline-end:0; }
.prism-table-editor { margin-block-start:16px; }
@container (max-width:41rem) {
  .prism-comparison-filters { grid-template-columns:repeat(2,minmax(0,1fr)); }
  .prism-comparison-search { grid-column:1/-1; }
  .prism-table-scroll { --prism-paper-column:7.75rem; --prism-data-column:9rem; }
  .prism-evidence-choice { grid-template-columns:minmax(0,1fr); }
  .prism-evidence-filters { grid-template-columns:repeat(2,minmax(0,1fr)); }
  .prism-evidence-filters > :first-child { grid-column:1/-1; }
  .prism-evidence-comparison .prism-table-scroll { --prism-paper-column:4.25rem; --prism-data-column:15rem; }
  .prism-table-separator { position:absolute; opacity:0; }
}
@media (pointer:coarse) {
  .prism-workspace :is(button,summary,.prism-file,.prism-check) { min-block-size:3rem; }
  .prism-workspace .prism-context .prism-context-item select { min-block-size:3rem; }
}
@media (forced-colors:active) {
  .prism-shell { --prism-ink:CanvasText; --prism-bg:Canvas; --prism-panel:Canvas; --prism-control:ButtonText; --prism-accent:Highlight; --prism-error:CanvasText; }
  .prism-table-scroll th { background:Canvas; color:CanvasText; }
  .prism-workspace .prism-step[aria-selected=true]::after { border-color:Highlight; }
  .prism-workspace button[aria-pressed=true] { outline:1px solid Highlight; outline-offset:-2px; }
  .prism-workspace :is(button,select,input,textarea,summary,a):focus-visible { outline:2px solid Highlight; outline-offset:2px; }
  .prism-workspace .prism-table-toolbar button[aria-disabled=true] { color:GrayText; opacity:1; }
}
@container (max-width:46rem) {
  .prism-reader-grid { grid-template-columns:minmax(0,1fr); gap:16px; }
  .prism-reading-evidence { border-inline-start:0; border-block-start:1px solid var(--prism-line); padding:14px 0 0; }
}
@container (max-width:36rem) {
  .prism-workspace { padding:0 0.75rem 1.25rem; }
  .prism-context,.prism-steps-editor,.prism-library-search { grid-template-columns:minmax(0,1fr); }
  .prism-context { gap:0.5rem; }
  .prism-context-item { display:grid; grid-template-columns:max-content minmax(0,1fr); align-items:center; }
  .prism-workspace .prism-context .prism-context-item select { inline-size:100%; }
  .prism-source-identifiers { grid-template-columns:minmax(0,1fr); }
}
`;

function guidedButton(label, onClick, { primary = false, disabled = false, id } = {}) {
  return h("button", { type: "button", onClick, disabled, "data-testid": id, className: primary ? "prism-primary" : undefined }, label);
}

function guidedDisclosure(label, content, props = {}) {
  return h("details", { className: "prism-support", ...props }, h("summary", null, label), content);
}

function guidedHelp(label, content, props = {}) {
  return h('details',{className:'prism-format-help',...props},h('summary',null,label),content);
}

function PrismSearch({ children, ...props }) {
  const native = React.useMemo(() => {
    const doc = globalThis.document;
    const Unknown = doc?.defaultView?.HTMLUnknownElement;
    return !!doc && (!Unknown || !(doc.createElement('search') instanceof Unknown));
  }, []);
  return h(native ? 'search' : 'div', { ...props, role: native ? undefined : 'search' }, children);
}

function PrismRequiredText({ label, message, onFieldError, inputRef, as = 'input', value, onChange, ...props }) {
  const id = React.useId();
  const field = React.useRef(null);
  const [invalid, setInvalid] = React.useState(false);
  const edited = React.useRef(false);
  const shown = invalid && !value.trim();
  const description = [props['aria-describedby'], shown ? id + '-error' : null].filter(Boolean).join(' ');
  React.useImperativeHandle(inputRef, () => field.current, []);
  React.useLayoutEffect(() => {
    field.current.setCustomValidity(value && !value.trim() ? message : '');
  }, [value, message]);
  return h('div', { className: 'prism-field' },
    h('label', { htmlFor: id }, label),
    label.endsWith('（必填）') ? null : h('small', { className: 'prism-required', 'aria-hidden': 'true' }, '必填'),
    h(as, { ...props, ref: field, value, id, required: true, 'aria-invalid': shown,
      'aria-describedby': description || undefined,
      onChange: event => {
        edited.current = true;
        if (invalid && event.target.value.trim()) {
          setInvalid(false);
          onFieldError?.('');
        }
        onChange(event);
      },
      onInvalid: () => setInvalid(true),
      onBlur: event => {
        if (edited.current && !invalid && !event.currentTarget.validity.valid) {
          setInvalid(true);
          onFieldError?.(message);
        }
      },
    }),
    h('small', { className: 'prism-field-error', id: id + '-error', hidden: !shown }, message));
}

function usePrismFieldAnnouncement() {
  const [message, setMessage] = React.useState('');
  const pending = React.useRef();
  React.useEffect(() => () => clearTimeout(pending.current), []);
  return {
    say(text) {
      clearTimeout(pending.current);
      setMessage('');
      if (text) pending.current = setTimeout(() => setMessage(text), 400);
    },
    region: h('div', { className: 'prism-visually-hidden', 'aria-live': 'polite', 'aria-atomic': 'true' }, message),
  };
}

function PrismDiscardDialog({ onClose }) {
  const title = React.useId();
  const description = React.useId();
  const native = typeof globalThis.HTMLDialogElement?.prototype.showModal === 'function';
  return native ? h(prismUi.AlertDialogContent, { className: 'prism-dialog prism-confirm-dialog', 'aria-labelledby': title,
    'aria-describedby': description, onClose: event => {
      const discarded = event.currentTarget.returnValue === 'discard';
      event.currentTarget.returnValue = '';
      onClose(discarded);
    } },
    h(prismUi.AlertDialogTitle, { id: title }, '放弃当前草稿修改？'),
    h(prismUi.AlertDialogDescription, { id: description }, '已保存版本仍可打开。'),
    h('form', { method: 'dialog', className: 'prism-actions' },
      h(prismUi.AlertDialogCancel, { type: 'submit', value: 'keep', autoFocus: true }, '继续编辑'),
      h(prismUi.AlertDialogAction, { type: 'submit', value: 'discard' }, '确认放弃')))
    : h('section', { 'aria-labelledby': title },
      h('h3', { id: title }, '放弃当前草稿修改？'),
      guidedButton('继续编辑', () => onClose(false)), guidedButton('确认放弃', () => onClose(true)));
}

function PrismResearchTable({ id, caption, sourceHeading, headers, rows, scrollHint = '左右滚动可看其余字段。' }) {
  const scroll = React.useRef(null);
  const [wide, setWide] = React.useState(false);
  React.useEffect(() => {
    const pane = scroll.current;
    const table = pane.querySelector('table');
    function measure() {
      setWide(pane.clientWidth > 0 && pane.scrollWidth > pane.clientWidth);
      pane.style.setProperty('--prism-table-header-size', table.tHead.offsetHeight + 'px');
    }
    measure();
    if (!globalThis.ResizeObserver) return;
    const observer = new ResizeObserver(measure);
    observer.observe(pane);
    observer.observe(table);
    observer.observe(table.tHead);
    return () => observer.disconnect();
  }, [headers.length]);
  const captionId = id + '-caption';
  const hintId = id + '-scroll-hint';
  return h(React.Fragment, null,
    wide ? h('p', { id: hintId, className: 'prism-table-note' }, scrollHint) : null,
    h('div', { ref: scroll, className: 'prism-table-scroll', role: 'region', tabIndex: 0,
      'aria-labelledby': captionId, 'aria-describedby': wide ? hintId : undefined,
      style: { '--prism-field-count': headers.length } },
      h('table', { id },
        h('caption', { id: captionId, className: 'prism-table-caption' }, caption),
        h('thead', null, h('tr', null, h('th', { scope: 'col' }, sourceHeading),
          headers.map((value, index) => h('th', { key: index, scope: 'col' }, value)))),
        h('tbody', null, rows))));
}

function PrismButtonToolbar({ label, controls, actions, exportLabel, exports = [] }) {
  const nativeFocusGroup = typeof globalThis.HTMLElement === 'function' && 'focusGroup' in HTMLElement.prototype;
  const [active, setActive] = React.useState(0);
  function moveFocus(event) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
    const offset = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (!offset && event.key !== 'Home' && event.key !== 'End') return;
    const bar = event.currentTarget;
    const buttons = Array.from(bar.querySelectorAll('button'));
    const direction = bar.ownerDocument.defaultView.getComputedStyle(bar).direction === 'rtl' ? -1 : 1;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (buttons.indexOf(event.target) + offset * direction + buttons.length) % buttons.length;
    event.preventDefault();
    buttons[next].focus();
  }
  function button(action, index) {
    const tabIndex = index === active ? 0 : -1;
    return h('button', { key: action.label, type: 'button', 'aria-disabled': action.disabled || undefined,
      'aria-pressed': action.pressed,
      onClick: action.disabled ? undefined : action.onClick, 'data-testid': action.id,
      tabIndex: nativeFocusGroup ? undefined : tabIndex,
      onFocus: nativeFocusGroup ? undefined : () => setActive(index) }, action.label);
  }
  return h('div', { role: 'toolbar', 'aria-label': label, 'aria-controls': controls, className: 'prism-table-toolbar',
    focusgroup: 'toolbar wrap', onKeyDown: nativeFocusGroup ? undefined : moveFocus },
    actions.map(button),
    exports.length ? h('div', { role: 'group', 'aria-label': exportLabel, className: 'prism-table-exports' },
      h('span', { role: 'separator', 'aria-orientation': 'vertical', className: 'prism-table-separator' }),
      exports.map((action, index) => button(action, actions.length + index))) : null);
}

function PrismTableToolbar({ refresh, ...props }) {
  return h(PrismButtonToolbar, { ...props, actions: [refresh] });
}

function PrismTabStrip({ items, active, onSelect, label, prefix, panelPrefix, className }) {
  const list = React.useRef(null);
  const nativeFocusGroup = typeof globalThis.HTMLElement === 'function' && 'focusGroup' in HTMLElement.prototype;
  React.useLayoutEffect(() => {
    const scroller = list.current;
    function reveal() {
      if (!scroller.clientWidth) return;
      const selected = scroller.querySelector('[aria-selected=true]');
      if (!selected) return;
      const bounds = scroller.getBoundingClientRect();
      const tab = selected.getBoundingClientRect();
      if (tab.left < bounds.left) scroller.scrollLeft += tab.left - bounds.left - 4;
      if (tab.right > bounds.right) scroller.scrollLeft += tab.right - bounds.right + 4;
    }
    reveal();
    if (typeof globalThis.ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(reveal);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [active, items.length]);
  function moveTab(event) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
    const tabs = [...event.currentTarget.querySelectorAll('[role=tab]')];
    const index = tabs.indexOf(event.target);
    if (index < 0) return;
    const direction = getComputedStyle(event.currentTarget).direction === 'rtl' ? -1 : 1;
    const offset = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
      : offset ? (index + offset * direction + tabs.length) % tabs.length : null;
    if (next === null) return;
    event.preventDefault();
    tabs[next].focus();
  }
  return h(prismUi.TabsList, { ref:list, className:'prism-steps' + (className ? ' ' + className : ''), role:"tablist", "aria-label":label,
    focusgroup:"tablist nomemory wrap", onKeyDown:nativeFocusGroup ? undefined : moveTab },
      items.map(([id, text]) => h(prismUi.TabsTrigger, {
        key: id, type: "button", id: prefix + id, className: "prism-step", role: "tab",
        "aria-controls": panelPrefix + id, "aria-selected": active === id, focusgroupstart: active === id ? '' : undefined,
        tabIndex: nativeFocusGroup ? undefined : active === id ? 0 : -1,
        onClick: () => onSelect(id),
      }, text)));
}

function GuidedWorkspaceChrome({ project, paper, papers, onSelect, modelStatus, area, destination,
  onNavigate, onShortcut, onArchive, onRestore, canRead, canSelectPaper, scopeStatus, children }) {
  const [navigationOpen, setNavigationOpen] = React.useState(false);
  const toggle = React.useRef(null);
  const navigationId = React.useId();
  const connection = {
    ready: 'DeepSeek 账号已就绪', 'signed-out': 'DeepSeek 待登录',
    unavailable: 'DeepSeek 暂不可用', checking: '正在读取 DeepSeek 状态', local: 'DeepSeek 直连未配置',
    'owner-required': '需要重新授权本机宿主',
  };
  const groups = [
    ['资料', [
      ['library','论文库',prismUi.LibraryBig],
      ['reader','正文阅读',prismUi.BookOpen,!canRead],
      ['reading','摘录与证据',prismUi.Waypoints],
    ]],
    ['研究', [
      ['planning','编辑步骤',prismUi.ClipboardList],
      ['execution','开始研究',prismUi.Play],
      ['argument','研究论证',prismUi.Network,!project?.id],
      ['progress','研究进度',prismUi.ListChecks],
      ['saved','成果与导出',prismUi.FileOutput],
    ]],
  ];
  const section = groups.flatMap(([, items]) => items).find(([id]) => id === destination)?.[1]
    ?? (area === 'results' ? '研究成果' : guidedStages.find(([id]) => id === area)?.[1]);
  function shortcut(id) {
    if (onShortcut(id) !== false) setNavigationOpen(false);
  }
  function icon(Component) {
    return h(Component,{size:16,strokeWidth:1.65,'aria-hidden':true});
  }
  function railButton(label, Icon, action, className) {
    return h('button',{type:'button',className:'prism-rail-button'+(className?' '+className:''),'aria-label':label,title:label,onClick:action},icon(Icon));
  }
  return h('div',{className:'prism-frame','data-navigation-open':navigationOpen},
    h('nav',{className:'prism-rail','aria-label':'工作台快捷入口'},
      railButton('回到论文库',prismUi.Layers3,()=>shortcut('library'),'prism-rail-brand'),
      railButton('查找本地论文',prismUi.Search,()=>shortcut('search')),
      railButton('项目便携备份',prismUi.FileOutput,onArchive),
      railButton('打开基础档案备份与恢复',prismUi.Archive,onRestore)),
    h('header',{className:'prism-header prism-topbar'},
      h('div',{className:'prism-command-bar'},
        h('button',{type:'button',ref:toggle,className:'prism-navigation-toggle','aria-expanded':navigationOpen,
          'aria-controls':navigationId,onClick:()=>setNavigationOpen(value=>!value)},icon(prismUi.PanelLeft),'导航'),
        h('nav',{className:'prism-breadcrumb','aria-label':'当前位置'},
          h('ol',null,h('li',null,'工作台'),h('li',{'aria-hidden':true},icon(prismUi.ChevronRight)),
            h('li',{'aria-current':'page'},section))),
        h('div',{className:'prism-command-actions'},
          h('button',{type:'button',className:'prism-search-command','aria-label':'查找论文',title:'查找本地论文',
            onClick:()=>shortcut('search')},icon(prismUi.Search),h('span',null,'查找论文')),
          h(prismUi.Badge,{className:'prism-connection',variant:'outline',role:'status',
            'data-ready':modelStatus==='ready','data-testid':'workspace-model-status'},connection[modelStatus]))),
      h(PrismTabStrip,{items:guidedStages,active:area,onSelect:id=>onNavigate(id,false),label:'研究步骤',
        prefix:'workspace-tab-',panelPrefix:'workspace-zone-',className:'prism-stage-tabs'}),
      h('section',{className:'prism-context','aria-label':'当前工作上下文'},
        h('div',{className:'prism-context-item'},h('small',null,project?'项目':'范围'),h('strong',null,project?.title||'共享论文库')),
        h('label',{className:'prism-context-item'},h('small',null,'论文'),
          papers.length?h('select',{'aria-label':'当前论文',value:paper?.id||'',disabled:!canSelectPaper,onChange:event=>{
            if(onSelect(event.target.value)===false)event.target.value=paper?.id||'';
          }},!paper?h('option',{value:''},'请选择论文'):null,papers.map(item=>h('option',{key:item.id,value:item.id},item.title)))
            :h('strong',null,'未选择论文')))),
    h('aside',{id:navigationId,className:'prism-sidebar','aria-label':'项目与研究导航',onKeyDown:event=>{
      if(event.key==='Escape'&&navigationOpen&&toggle.current?.getClientRects().length){
        setNavigationOpen(false);toggle.current.focus();event.stopPropagation();
      }
    }},
      h('div',{className:'prism-sidebar-pane'},
        h('header',{className:'prism-sidebar-brand'},h('h1',null,'PRISM'),
          PRISM_DEVELOPMENT_PREVIEW?h('span',{className:'prism-preview-label'},'本地预览'):null),
        h('nav',{'aria-label':'研究工作区'},groups.map(([label, items])=>
          h('section',{className:'prism-nav-group',key:label},
            h('h2',null,label),
            h('ul',null,items.map(([id,text,Icon,disabled])=>h('li',{key:id},
              h('button',{type:'button',className:'prism-nav-item','aria-label':text+'（工作区导航）',
                'aria-current':destination===id?'page':undefined,disabled:!!disabled,
                onClick:()=>shortcut(id)},icon(Icon),h('span',null,text)))))))),
        h('section',{className:'prism-project-tree','aria-label':project?'项目论文':'共享论文',
          'data-testid':'workspace-project-tree'},
          h('h2',null,project?'当前项目':'论文范围'),
          h('div',{className:'prism-project-branch'},icon(prismUi.FolderOpen),h('strong',null,project?.title||'共享论文库')),
          papers.length?h('ul',null,papers.map(item=>h('li',{key:item.id},
            h('button',{type:'button',className:'prism-tree-item','aria-label':'选择论文：'+item.title,
              title:item.title,'aria-current':paper?.id===item.id?'true':undefined,disabled:!canSelectPaper,onClick:()=>{
                if(onSelect(item.id)!==false&&toggle.current?.getClientRects().length){
                  setNavigationOpen(false);toggle.current.focus();
                }
              }},icon(prismUi.FileText),h('span',null,item.title))))):h('p',{className:'prism-muted'},scopeStatus||'暂无论文'),
          h('button',{type:'button',className:'prism-tree-manage',onClick:()=>shortcut('planning')},'管理项目')),
        h('div',{className:'prism-sidebar-archives'},
          h('button',{type:'button',className:'prism-nav-item',onClick:()=>{
            setNavigationOpen(false);onRestore();
          }},icon(prismUi.Archive),'档案备份与恢复')))),
    h('div',{className:'prism-main-surface'},children));
}

function GuidedLibrarySummary({ project, papers, ready, blocked }) {
  const verified = ready && !blocked;
  const documents = verified ? papers.filter(paper=>paper.document).length : 0;
  const waiting = blocked ? '待核对' : '核验中';
  return h('dl',{className:'prism-library-summary','aria-label':'当前论文库状态'},
    h('div',null,h('dt',null,h(prismUi.FolderOpen,{size:15,'aria-hidden':true}),'当前范围'),h('dd',null,project?.title||'共享论文库')),
    h('div',null,h('dt',null,h(prismUi.LibraryBig,{size:15,'aria-hidden':true}),'论文档案'),h('dd',null,verified?papers.length+' 篇':waiting)),
    h('div',null,h('dt',null,h(prismUi.FileText,{size:15,'aria-hidden':true}),'有正文'),h('dd',null,verified?documents+' 篇':waiting)));
}

function GuidedLibraryTask({ paper, project, persistence, ready, blocked, canOpen, canPlan, planReady, onRead, onNavigate }) {
  let state;
  if (blocked) state = '当前论文档案待核对。';
  else if (!ready) state = '正在核对项目论文关系。';
  else if (!paper) state = project ? '导入或关联论文后，可在这里继续阅读。' : '创建项目后，可组织论文、研究步骤和证据。';
  else if (!paper.document) state = '当前论文待挂接正文。';
  else state = (persistence.saved ? '已保存正文 · ' : '当前内存正文 · ') + paper.document.filename;
  return h('aside',{className:'prism-tile prism-task','aria-labelledby':'prism-task-title','data-testid':'guided-library-task'},
    h('h2',{id:'prism-task-title'},paper?'当前论文':'当前任务'),
    paper?h('strong',{className:'prism-task-paper'},paper.title):null,
    h('p',{className:'prism-muted'},state),
    h(ZoteroPaperSource,{paper}),
    h('div',{className:'prism-actions'},
      paper?guidedButton('阅读正文',onRead,{id:'open-paper-reader',primary:true,disabled:!canOpen}):null,
      canPlan?guidedButton('编辑步骤',()=>onNavigate('planning'),{id:'guided-go-plan'}):null,
      !project&&!paper?guidedButton('创建项目',()=>onNavigate('planning')):null,
      paper&&planReady&&canPlan?guidedButton('开始研究',()=>onNavigate('execution')):null));
}

function GuidedResultTools({ items, active, onSelect, panes, actions }) {
  const tabPrefix = 'prism-result-tab-';
  const panelPrefix = 'prism-result-panel-';
  return h('section',{className:'prism-results-surface','aria-labelledby':'prism-results-heading'},
    h('div',{className:'prism-view-heading'},
      h('h2',{id:'prism-results-heading',tabIndex:-1,className:'prism-stage-heading','data-prism-stage-heading':''},'研究成果'),
      actions),
    h(PrismTabStrip,{items,active,onSelect,label:'成果工具',prefix:tabPrefix,panelPrefix,className:'prism-results-tabs'}),
    items.map(([id])=>h('section',{key:id,id:panelPrefix+id,role:'tabpanel',className:'prism-result-pane',
      'aria-labelledby':tabPrefix+id,hidden:active!==id,tabIndex:active===id&&id==='saved'?0:undefined},panes[id])));
}

function GuidedResults({store,projectId,paper,active,onNavigate,planReady,currentPapers}) {
  const [summary,setSummary]=React.useState({state:'loading'});
  const [inspection,setInspection]=React.useState(null);
  const [sourceError,setSourceError]=React.useState('');
  React.useEffect(()=>{
    setInspection(null);
    setSourceError('');
    if(!active||!projectId||!paper)return;
    let live=true;
    const controller=instanceOutcomesOverviewCore.createInstanceOutcomesOverviewController({store,storage:globalThis.localStorage,projectId});
    setSummary({state:'loading'});
    controller.read({paperId:paper.id,explicitReadConsent:true},()=>live).then(view=>{
      if(!live)return;
      view.stable();
      const instances=view.papers[0]?.instances||[];
      const results=instances.flatMap(instance=>instance.results.map(item=>{
        if(!item.record.execution)return item;
        const review=instance.decisions.findLast(decision=>decision.status==='current'
          &&decision.record.upstream.some(result=>result.id===item.record.id));
        return {...item,review:review?.record};
      })).sort((a,b)=>Date.parse(b.record.createdAt)-Date.parse(a.record.createdAt));
      const incomplete=Object.values(view.sources).some(state=>state==='unavailable'||state==='unknown')||instances.some(instance=>instance.quarantined.length);
      setSummary({state:'ready',results,incomplete,sourceForResult:view.sourceForResult});
    }).catch(()=>{if(live)setSummary({state:'unavailable'})});
    return()=>{live=false};
  },[store,projectId,paper,active]);
  function inspectSource(record,review){
    setSourceError('');
    try{
      const reveal=()=>summary.sourceForResult(record.id);
      const source=workbenchModelCore.workbenchResultInputSource(reveal());
      if(!source.fragment)return;
      const original=readingEvidenceCore.pdfOriginalAtCapture(source.paper);
      if(original)source.fragment.source.pdfOriginal=original;
      const current=()=>{
        const fresh=currentPapers().find(item=>item.id===source.paper.id);
        return !!fresh&&readingEvidenceCore.readingSourceMatches(source.fragment,fresh.document)
          &&(!original||readingEvidenceCore.pdfOriginalAtCapture(fresh)?.sha256===original.sha256);
      };
      const mayReadOriginal=current();
      const scope=source.pages.length?'PDF 文件内第 '+source.pages.join('、')+' 页':'正文字符范围';
      const delivery=record.execution.input.execution?.channel==='manual'?'外部交接包里的范围':'请求中附上的范围';
      const description=delivery+' · '+scope+'。'
        +(mayReadOriginal?'可对照当前存档。':'当前存档已变化。这里保留请求当时的正文。')
        +'结论仍需按原文复核。';
      const verify=()=>{
        reveal();
        if(!current())throw Error('PDF_SOURCE_MISMATCH');
      };
      const download=()=>{
        reveal();
        const {literalMarkdownLabel:label,literalMarkdownBlock:literal}=readingEvidenceCore;
        const execution=record.execution;
        const target=execution.input.target;
        const parts=[
          '# '+label(source.paper.title),
          '研究结果 '+label(record.id)+' · 请求 '+label(execution.input.requestId),
          '项目 '+label(target.projectId)+' · 论文 '+label(target.paperId)+' · 步骤 '+label(target.nodeId),
          '执行端 '+label(executionTargetsCore.executionChoiceLabel(execution.input.execution))
            +' · 要求版本 '+(execution.outputRequirements?.version??0),
          '## 输入范围',
          description,
          '正文 SHA-256 '+source.fragment.source.sha256,
          '实际请求文本 SHA-256 '+execution.input.promptSha256,
        ];
        if(original)parts.push('PDF '+label(original.filename)+' · SHA-256 '+original.sha256);
        if(execution.outputRequirements?.text)parts.push('## 本次使用的流程输出要求',literal(execution.outputRequirements.text));
        parts.push(literal(source.fragment.quote),'## 已保存答复',literal(record.text));
        if(execution.reply.finish==='max-tokens')parts.push('此答复达到输出上限，保存的是部分结果。');
        if(review)parts.push('## 人工复核',({approved:'通过',returned:'退回',revoked:'撤销'})[review.decision],literal(review.reason));
        downloadReadingData(parts.join('\n\n')+'\n','PRISM-研究结果-'+execution.input.requestId+'.md','text/markdown;charset=utf-8');
      };
      setInspection({paper:source.paper,fragment:source.fragment,request:{current:mayReadOriginal,description,verify,download}});
    }catch{setSourceError('输入出处暂时无法核对。请重新打开结果，或查看保存的请求回执。');}
  }
  let content;
  if(!projectId||!paper){
    content=h(React.Fragment,null,h('p',{className:'prism-muted'},'选择项目和论文后，即可查看该论文的已保存结果。'),
      guidedButton('前往导入论文',()=>onNavigate('library'),{primary:true}));
  }else if(summary.state==='loading'){
    content=h('p',{role:'status'},'正在读取已保存结果。');
  }else if(summary.state==='unavailable'){
    content=h('p',{role:'alert'},'当前结果无法读取。请在「更多结果工具」核对记录。');
  }else if(!summary.results.length&&!summary.incomplete){
    content=h(React.Fragment,null,h('p',{className:'prism-muted'},'当前论文还没有已保存的结果。'),
      guidedButton(planReady?'开始研究':'编辑步骤',()=>onNavigate(planReady?'execution':'planning'),{primary:true}));
  }else{
    content=h(React.Fragment,null,
      summary.incomplete?h('p',{role:'status'},'有记录待核对，可在「更多结果工具」查看。'):null,
      summary.results.map(({record,status,review})=>h('article',{key:record.id,className:'prism-record'},
        h('h3',null,record.execution
          ?({'dsh':'DeepSeek','codex':'Codex','zcode':'ZCode'}[record.execution.input.execution?.platform]
            ?? (record.execution.input.execution ? '模型' : 'DeepSeek'))+' 步骤答复':'步骤答复'),
        record.sourceLabel?h('p',{className:'prism-muted'},record.sourceLabel):null,
        record.execution?.reply.finish==='max-tokens'?h('p',{role:'status'},record.execution.reply.route.maxTokens===512
          ?'部分答复 · 512 token 上限截断':'部分答复 · 输出达到上限'):null,
        h('p',{className:'prism-muted'},status==='current'?'当前步骤版本':'历史步骤版本',
          review?' · 人工复核'+({approved:'通过',returned:'退回',revoked:'已撤销'})[review.decision]
            +(/^(?:【开发验收(?:·[^】]+)?】|开发验收(?:复核)?：)/.test(review.reason)?'（开发验收）':''):' · 待核对'),
        record.execution?.includeDocument?h('button',{type:'button','aria-haspopup':'dialog',
          onClick:()=>inspectSource(record,review)},'核对输入出处'):null,
        record.execution?guidedHelp('执行回执',h(React.Fragment,null,
          h('p',null,executionTargetsCore.executionChoiceLabel(record.execution.input.execution),' · ',
           record.execution.input.execution?.channel==='manual'?'外部答复由用户登记':
            record.execution.input.execution?.channel==='automatic'?'外部自动执行回执':'宿主回执'),
          h('p',null,'请求号 ',record.execution.input.requestId,
           record.execution.reply.externalSessionId?' · 外部会话 '+record.execution.reply.externalSessionId:'',
           record.execution.reply.externalTurnId?' · 外部执行 '+record.execution.reply.externalTurnId:''),
          h('p',null,record.execution.reply.finish==='max-tokens'?'记录为不完整答复。':'已记录完整答复。'),
          record.execution.outputRequirements?.version?h('details',null,
            h('summary',null,'使用的流程输出要求 · 第 '+record.execution.outputRequirements.version+' 版'),
            h('pre',{style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}},record.execution.outputRequirements.text||'当前版本为空。')):null,
          h('p',null,'原步骤 Prompt 指纹 ',record.execution.originalPromptSha256),
          h('p',null,'实际发送文本指纹 ',record.execution.input.promptSha256),
          h('p',null,'来源指纹 ',record.execution.input.sourceSha256),
          !record.execution.includeDocument?h('p',null,'本次没有附论文正文。'):null,
          record.execution.reply.usage?h('p',null,record.execution.reply.usage.totalTokens===undefined?'':'总计 '+record.execution.reply.usage.totalTokens+' tokens · ',
           '未缓存输入 ',record.execution.reply.usage.inputTokens??'未回传',' · 缓存命中 ',record.execution.reply.usage.cacheReadTokens??'未回传',' · 缓存写入 ',record.execution.reply.usage.cacheWriteTokens??'未回传',' · 输出 ',record.execution.reply.usage.outputTokens??'未回传',' tokens'):null)):null,
        h(ResearchContent,{text:record.text}))));
  }
  return h('section',{'data-testid':'guided-results'},h('h3',null,'本篇已保存结果'),content,
    sourceError?h('p',{role:'alert'},sourceError):null,
    active&&inspection?h(ReadingSourceDialog,{paper:inspection.paper,record:inspection.fragment,store,projectId,
      currentPapers,onDismiss:()=>setInspection(null),returnLabel:'返回已保存结果',request:inspection.request}):null);
}
