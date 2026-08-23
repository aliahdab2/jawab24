/**
 * no-unanchored-chrome-palette
 *
 * Forbids a raw neutral Tailwind step (`zinc`/`gray`/`slate`/`neutral`/`stone`)
 * inside the app's DARK CHROME components — the sidebar rail, the admin bar,
 * and the controls that live in them.
 *
 * ── Why this scope, and not "no raw palette anywhere" ──────────────────────
 * Its sibling `no-mixed-semantic-palette` already records why the broad rule is
 * a trap: it "would fire on ~240 existing lines (the blog renderer alone has 52
 * `rose-*` sites) and be disabled within the week". That judgement still holds,
 * and this rule does not reopen it. Raw palette in ordinary content is out of
 * scope here.
 *
 * Chrome is different, and that difference is what makes a rule enforceable:
 *
 *   1. These surfaces are dark in BOTH themes, so the usual escape hatch — a
 *      `dark:` variant — is not the fix and its absence is not the signal. Only
 *      a named class can carry "this is chrome, deliberately fixed".
 *   2. They cannot use the `surface-*` scale, which inverts between themes and
 *      would flip the rail light in dark mode. So a reviewer cannot even fall
 *      back on "use the scale" as the correction.
 *   3. The set is small and now empty of violations, so the rule starts GREEN
 *      and needs no baseline allowlist.
 *
 * The failure it prevents is concrete: `text-zinc-400 hover:bg-white/5
 * hover:text-white` was written out three times across Sidebar.tsx and
 * ThemeToggleButton.tsx, so the rail's hue had three sources of truth and no
 * single place to change it.
 *
 * ── Deliberately NOT covered ───────────────────────────────────────────────
 *   - `bg-white/5`, `text-white`, `bg-black/40` — opacity-based scrims and
 *     absolutes carry no palette step, are theme-independent by construction,
 *     and read the same on any surface.
 *   - Non-neutral hues (brand, amber, red). Those are already anchored tokens
 *     or semantic families; the active nav states use them directly on purpose.
 *   - Every file outside CHROME_FILES, per the sibling rule's reasoning above.
 */

/** Components that render dark chrome. Extend deliberately, not casually. */
const CHROME_FILES = [
  'components/layout/Sidebar.tsx',
  'components/layout/AdminLayout.tsx',
  'components/ui/ThemeToggleButton.tsx',
];

/**
 * A raw neutral step on a colour-bearing utility, with any variant prefix
 * (`hover:`, `dark:`, `sm:`, `group-hover:`) and any opacity suffix (`/40`).
 */
const RAW_NEUTRAL =
  /(?:^|\s)(?:[a-z-]+:)*(?:bg|text|border|ring|divide|from|via|to)-(?:zinc|gray|slate|neutral|stone)-\d{2,3}(?:\/\d+)?(?=\s|$)/;

/** Every string literal / template chunk reachable from `node`. */
function collectStrings(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (node.type === 'Literal' && typeof node.value === 'string') {
    out.push({ node, text: node.value });
  } else if (node.type === 'TemplateLiteral') {
    for (const q of node.quasis) out.push({ node: q, text: q.value.cooked ?? '' });
  } else if (node.type === 'ConditionalExpression') {
    collectStrings(node.consequent, out);
    collectStrings(node.alternate, out);
  } else if (node.type === 'LogicalExpression') {
    collectStrings(node.right, out);
  } else if (node.type === 'ArrayExpression') {
    for (const el of node.elements) collectStrings(el, out);
  } else if (node.type === 'ObjectExpression') {
    for (const prop of node.properties) {
      if (prop.type === 'Property') collectStrings(prop.value, out);
    }
  } else if (node.type === 'CallExpression') {
    for (const arg of node.arguments) collectStrings(arg, out);
  } else if (node.type === 'JSXExpressionContainer') {
    collectStrings(node.expression, out);
  }
  return out;
}

/** Path check that works on both POSIX and Windows separators. */
function isChromeFile(filename) {
  if (!filename) return false;
  const normalised = filename.split('\\').join('/');
  return CHROME_FILES.some((f) => normalised.endsWith(`/src/${f}`) || normalised.endsWith(`/${f}`));
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'dark-chrome components must name their colours in a semantic class, never as raw neutral Tailwind steps',
    },
    messages: {
      unanchored:
        '`{{raw}}` hard-codes a chrome colour here. This surface is dark in BOTH themes, so a `dark:` variant is not the fix and the surface-* scale would invert it. Move the colour into a semantic class in globals.css (.sidebar-* / .admin-bar-*) and use that instead.',
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename ?? context.getFilename?.();
    if (!isChromeFile(filename)) return {};

    /** Report at most once per string node, so a class list with three hits reads as one finding. */
    const reported = new WeakSet();
    const reportIn = (node) => {
      for (const { node: strNode, text } of collectStrings(node)) {
        if (reported.has(strNode)) continue;
        const hit = text.match(RAW_NEUTRAL);
        if (!hit) continue;
        reported.add(strNode);
        context.report({ node: strNode, messageId: 'unanchored', data: { raw: hit[0].trim() } });
      }
    };

    return {
      Literal(node) {
        if (typeof node.value === 'string') reportIn(node);
      },
      TemplateLiteral(node) {
        reportIn(node);
      },
    };
  },
};

export { RAW_NEUTRAL, CHROME_FILES, isChromeFile };
