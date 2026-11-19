import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import postcss from 'postcss';
import { compile } from 'tailwindcss';

const root = new URL('../', import.meta.url);

export async function buildShadcn() {
  const hostModules = {
    react: 'module.exports = React;',
    'react-dom': 'module.exports = prismHostReactDOM;',
    'react/jsx-runtime': `
      const jsx = (type, props, key) => React.createElement(type, key === undefined ? props : { ...props, key });
      module.exports = { Fragment: React.Fragment, jsx, jsxs: jsx };
    `,
  };
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('src/shadcn/index.ts', root))],
    bundle: true, format: 'iife', globalName: 'prismUi', platform: 'browser', target: 'es2022',
    write: false, metafile: true, legalComments: 'inline', define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{
      name: 'use-dsh-react',
      setup(context) {
        context.onResolve({ filter: /^react(?:-dom|\/jsx-runtime)?$/ },
          ({ path }) => ({ path, namespace: 'prism-host' }));
        context.onLoad({ filter: /.*/, namespace: 'prism-host' },
          ({ path }) => ({ contents: hostModules[path] }));
      },
    }],
  });
  const forbidden = Object.keys(bundle.metafile.inputs).find(path => /node_modules\/(react|react-dom)\//.test(path));
  if (forbidden || Object.values(bundle.metafile.outputs).some(output => output.imports.length)) {
    throw Error('Shadcn must reuse the host React and ReactDOM');
  }

  // Scan source string literals for Tailwind candidates. The compiler ignores
  // tokens it cannot resolve. No template or CSS from the host is scanned.
  const components = new URL('src/shadcn/', root);
  const sources = await Promise.all((await readdir(components))
    .filter(name => name.endsWith('.tsx')).map(name => readFile(new URL(name, components), 'utf8')));
  const candidates = new Set(sources.flatMap(source =>
    [...source.matchAll(/"(?:\\.|[^"\\])*"/g)].flatMap(([literal]) => literal.slice(1, -1).split(/\s+/))));
  const theme = await readFile(new URL('node_modules/tailwindcss/theme.css', root), 'utf8');
  const utilities = await compile(`
    @layer prism-shadcn-theme, prism-shadcn-utilities;
    @layer prism-shadcn-theme { ${theme} }
    @theme inline {
      --color-background: var(--prism-panel);
      --color-foreground: var(--prism-ink);
      --color-card: var(--prism-panel);
      --color-card-foreground: var(--prism-ink);
      --color-muted: var(--prism-hover);
      --color-muted-foreground: var(--prism-muted);
      --color-primary: var(--prism-accent);
      --color-primary-foreground: #fff;
      --color-secondary: var(--prism-active);
      --color-secondary-foreground: var(--prism-ink);
      --color-accent: var(--prism-hover);
      --color-accent-foreground: var(--prism-ink);
      --color-border: var(--prism-line);
      --color-input: var(--prism-control);
      --color-ring: var(--prism-accent);
      --color-destructive: var(--prism-error);
    }
    @layer prism-shadcn-utilities { @tailwind utilities; }
  `);
  // No Preflight. Scope every emitted selector, including Tailwind defaults.
  // Property registration is document wide, so private names are required.
  const scope = ':where(.prism-shell)';
  const sheet = postcss.parse(utilities.build([...candidates]).replaceAll('--tw-', '--prism-tw-').replace(/@layer properties\b/g, '@layer prism-shadcn-properties'));
  sheet.walkRules(rule => {
    for (let parent = rule.parent; parent; parent = parent.parent) {
      if (parent.type === 'rule' || parent.type === 'atrule' && parent.name.endsWith('keyframes')) return;
    }
    rule.selectors = rule.selectors.map(selector =>
      selector === ':root' || selector === ':host' ? scope : scope + ' ' + selector);
  });
  return { js: bundle.outputFiles[0].text, css: sheet.toString() };
}
