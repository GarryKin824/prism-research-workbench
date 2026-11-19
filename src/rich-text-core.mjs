import { Marked } from '../third-party/rich-text/marked/marked.esm.js';
import katex from '../third-party/rich-text/katex/katex.mjs';

export const RICH_TEXT_LIMITS = Object.freeze({ characters: 100000, mathCharacters: 4096, mathCount: 100, nodes: 12000, depth: 48 });
export function safeResearchHref(value) {
  if (typeof value !== 'string' || /[\s\u0000-\u001f\u007f-\u009f\\]/u.test(value)) return null;
  if (!/^https?:\/\//i.test(value) || /%(?:0[0-9a-f]|1[0-9a-f]|7f|8[0-9a-f]|9[0-9a-f])/i.test(value)) return null;
  try { const u = new URL(value); return u.username || u.password || !u.hostname ? null : u.href; } catch { return null; }
}
function mathAtStart(src) {
  // Respect Marked's code/raw-HTML lexical state; inert raw text is not math.
  if (this?.lexer?.state?.inRawBlock) return;
  let open, close, display;
  if (src.startsWith('$$')) [open, close, display] = ['$$', '$$', true];
  else if (src.startsWith('\\[')) [open, close, display] = ['\\[', '\\]', true];
  else if (src.startsWith('\\(')) [open, close, display] = ['\\(', '\\)', false];
  else if (src.startsWith('$') && !/\s|\$/u.test(src[1] || ' ')) [open, close, display] = ['$', '$', false];
  else return;
  for (let i = open.length; i < src.length; i++) {
    if (!src.startsWith(close, i)) continue;
    let backslashes = 0; for (let j = i - 1; j >= 0 && src[j] === '\\'; j--) backslashes++;
    if (backslashes % 2) continue;
    const body = src.slice(open.length, i);
    if (!body.trim()) return;
    if (open === '$' && (/\s$/u.test(body) || /\n/u.test(body) || /\d/u.test(src[i + 1] || ''))) return;
    return { type: 'researchMath', raw: src.slice(0, i + close.length), text: body, display };
  }
  if (open !== '$') {
    const raw = src.split('\n', 1)[0];
    return { type: 'researchMath', raw, text: raw.slice(open.length), display, malformed: true };
  }
}
const marked = new Marked({ gfm: true, breaks: false, pedantic: false });
marked.use({ extensions: [
  { name: 'researchMath', level: 'inline', start(src) { const i = src.search(/\$|\\[([]/u); return i < 0 ? undefined : i; }, tokenizer: mathAtStart },
  { name: 'researchDisplayMath', level: 'block', tokenizer(src) { if (!/^(\$\$|\\\[)/u.test(src)) return; const t = mathAtStart(src); if (t?.display) return { ...t, type: 'researchMath' }; } }
] });
const mathElements = new Set('math semantics mrow mi mn mo mtext mspace msup msub msubsup mfrac msqrt mroot munder mover munderover mtable mtr mtd menclose mpadded mphantom mstyle mmultiscripts mprescripts none'.split(' '));
const mathAttributes = new Set('display mathvariant mathsize mathcolor mathbackground scriptlevel displaystyle stretchy symmetric fence separator accent accentunder movablelimits largeop form lspace rspace width height depth voffset lquote rquote linethickness bevelled rowalign columnalign rowspacing columnspacing columnlines rowlines frame framespacing equalrows equalcolumns side minsize maxsize notation'.split(' '));
const mathNS = 'http://www.w3.org/1998/Math/MathML';
function formulaAst(token, Parser, visit) {
  if (token.malformed || !Parser || token.text.length > RICH_TEXT_LIMITS.mathCharacters) throw Error('math unavailable');
  // Trust is disabled. Reject trust-sensitive commands explicitly rather than letting
  // KaTeX silently replace them with colored text. Macros are fresh per fragment.
  if (/\\(?:href|url|includegraphics|html\w*|def|gdef|edef|xdef|let|futurelet|newcommand|renewcommand|providecommand|global|require)\b/u.test(token.text)) throw Error('unsafe math');
  const output = katex.renderToString(token.text, { output: 'mathml', displayMode: token.display, trust: false, strict: 'error', throwOnError: true, maxExpand: 200, maxSize: 20, macros: Object.create(null) });
  const doc = new Parser().parseFromString(output, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw Error('invalid MathML');
  const root = doc.documentElement;
  if (root.localName !== 'span' || root.getAttribute('class') !== 'katex' || root.children.length !== 1) throw Error('invalid wrapper');
  function read(node, depth) {
    visit(depth);
    if (node.nodeType === 3) return node.nodeValue;
    if (node.nodeType !== 1 || node.namespaceURI !== mathNS) throw Error('unexpected MathML node');
    if (node.localName === 'annotation') return null; // Never expose embedded XML/TeX annotations.
    if (!mathElements.has(node.localName)) throw Error('unsupported MathML element');
    const props = {};
    for (const a of node.attributes) {
      if (a.name === 'xmlns' && a.value === mathNS) continue;
      if (!mathAttributes.has(a.name) || a.value.length > 128 || /[<>"'\\]|url\s*\(|:/iu.test(a.value)) throw Error('unsupported MathML attribute');
      props[a.name] = a.value;
    }
    return { tag: node.localName, props, children: [...node.childNodes].map(n => read(n, depth + 1)).filter(n => n !== null) };
  }
  return read(root.firstElementChild, 0);
}
// The complete untouched source is always returned, including in every fallback.
export function parseResearchContent(text, options = {}) {
  const source = typeof text === 'string' ? text : String(text ?? '');
  const raw = reason => ({ source, mode: 'raw', reason, nodes: [], mathFailures: 0 });
  if (source.length > RICH_TEXT_LIMITS.characters) return raw('内容超过安全排版上限（100,000 字符），保留完整原文。');
  // Bound delimiter scanning before the lexer, including unmatched openers.
  if ((source.match(/\$|\\[([]/gu) || []).length > 600) return raw('公式分隔符过多，保留完整原文。');
  let count = 0, mathCount = 0, mathFailures = 0;
  function visit(depth) { if (++count > RICH_TEXT_LIMITS.nodes || depth > RICH_TEXT_LIMITS.depth) throw Error('complexity limit'); }
  const node = (tag, children, props = {}) => ({ tag, props, children });
  function decodeText(value) {
    if (!value.includes('&')) return value;
    const Parser = options.DOMParser || globalThis.DOMParser;
    if (!Parser) return value;
    // All markup delimiters are escaped BEFORE parsing. Entities become text,
    // never markup; no user element or resource request can be constructed.
    const escaped = value.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return new Parser().parseFromString('<!doctype html><body>' + escaped + '</body>', 'text/html').body.textContent;
  }
  function walk(tokens, depth = 0) {
    visit(depth);
    return tokens.map(t => {
      visit(depth);
      const inner = () => walk(t.tokens || [], depth + 1);
      switch (t.type) {
        case 'space': return null;
        // Marked 17 emits an explicit checkbox token. Render it once; the task
        // source stays untouched and ordinary literal [x]/[ ] text is not stripped.
        case 'checkbox': return t.checked === true ? '☑ ' : '☐ ';
        case 'researchMath': {
          if (++mathCount > RICH_TEXT_LIMITS.mathCount) throw Error('math count limit');
          try { return node('span', [formulaAst(t, options.DOMParser || globalThis.DOMParser, visit)], { className: 'research-math', 'aria-label': t.text }); }
          catch { mathFailures++; return node('code', [t.raw], { className: 'research-math-raw', title: '公式无法安全排版，保留原始内容' }); }
        }
        case 'heading': return node(`h${Math.min(6, Math.max(1, t.depth))}`, inner());
        case 'paragraph': return node('p', inner());
        case 'text': return t.tokens ? node('span', inner()) : t.escaped ? t.text : decodeText(t.text);
        case 'escape': return t.text;
        case 'html': return t.raw; // HTML is literal text, never interpreted.
        case 'strong': return node('strong', inner());
        case 'em': return node('em', inner());
        case 'del': return node('del', inner());
        case 'codespan': return node('code', [t.text]);
        case 'code': return node('pre', [node('code', [t.text])]);
        case 'br': return node('br', []);
        case 'hr': return node('hr', []);
        case 'blockquote': return node('blockquote', inner());
        case 'link': { const href = safeResearchHref(decodeText(t.href)); return href ? node('a', inner(), { href, target: '_blank', rel: 'noopener noreferrer' }) : node('span', [t.raw]); }
        case 'image': return node('span', [`[图片未加载：${t.text || ''}] ${t.href || ''}`], { className: 'research-image-inert' });
        case 'list': return node(t.ordered ? 'ol' : 'ul', t.items.map(item => { visit(depth + 1); return node('li', walk(item.tokens || [], depth + 1)); }), t.ordered ? { start: t.start } : {});
        case 'table': {
          // Alignment is a GFM enum, not arbitrary document-controlled CSS.
          const alignment = index => ['left', 'center', 'right'].includes(t.align?.[index]) ? { style: { textAlign: t.align[index] } } : {};
          return node('div', [node('table', [node('thead', [node('tr', t.header.map((c, i) => node('th', walk(c.tokens, depth + 1), alignment(i))))]), node('tbody', t.rows.map(row => { visit(depth + 1); return node('tr', row.map((c, i) => node('td', walk(c.tokens, depth + 1), alignment(i)))); }))])], { className: 'research-table-scroll', style: { overflowX: 'auto', maxWidth: '100%' } });
        }
        default: return t.raw || t.text || '';
      }
    }).filter(n => n !== null);
  }
  try { return { source, mode: 'rendered', nodes: walk(marked.lexer(source)), mathFailures, reason: '' }; }
  catch { return raw('内容过于复杂或解析失败，保留完整原文。'); }
}
