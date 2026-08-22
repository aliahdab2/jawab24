/**
 * no-mixed-semantic-palette
 *
 * Flags a semantic design-system class (`status-*`, `alert-*`, `icon-bg-*`,
 * `notif-*`) sitting next to a raw Tailwind palette utility (`bg-red-50`,
 * `text-amber-600`, …) in the SAME class string, the same `clsx()` call, or
 * the same object literal.
 *
 * Why this, and only this. A naive "no raw palette colors" rule would fire on
 * ~240 existing lines (the blog renderer alone has 52 `rose-*` sites) and be
 * disabled within the week. The defect that actually shipped is narrower: a
 * class string that is HALF migrated — the ring was `notif-ring-amber` while
 * the background beside it was hand-typed `bg-orange-50`. Two sources of truth
 * for one hue is how `stale_message` rendered orange while its twin
 * `stale_comment` rendered amber. So the rule targets co-location, which is
 * the one shape that has no legitimate reading: either the semantic class owns
 * the hue, or it should not be there.
 *
 * Deliberately NOT flagged, by construction rather than by allowlist:
 *   - a private color map with no semantic class in it (leads StatusControl)
 *   - the Instagram brand gradient (`from-purple-500 to-pink-500` — gradient
 *     stops are not bg/text/border/ring utilities)
 *   - SmartStatusBanner's rose utilities (no semantic class beside them; it
 *     sits on `.card` and needs utilities to win on specificity)
 *   - `landing-section-dark`'s token overrides (CSS, not class strings)
 */

const SEMANTIC = /(?:^|\s)(status|alert|icon-bg|notif)-[a-z][a-z-]*(?=\s|$)/;
const RAW =
  /(?:^|\s)(?:[a-z-]+:)*(bg|text|border|ring|divide|from|via|to)-(red|rose|pink|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|slate|gray|zinc|neutral|stone)-\d{2,3}(?:\/\d+)?(?=\s|$)/;
// Gradient stops carry brand identity (Instagram) and are never a hue the
// semantic families own, so they do not count as "raw" here.
const RAW_NON_GRADIENT =
  /(?:^|\s)(?:[a-z-]+:)*(bg|text|border|ring|divide)-(red|rose|pink|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|slate|gray|zinc|neutral|stone)-\d{2,3}(?:\/\d+)?(?=\s|$)/;

/** Every string literal / no-substitution template reachable in `node`. */
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

/** clsx / cn / classNames / twMerge / cva — calls whose arguments are one class list. */
function joinerName(call) {
  const c = call.callee;
  const name =
    c.type === 'Identifier'
      ? c.name
      : c.type === 'MemberExpression' && c.property.type === 'Identifier'
        ? c.property.name
        : null;
  return name && /^(clsx|cn|classNames|twMerge|cva)$/.test(name) ? name : null;
}
const isClassJoiner = (call) => joinerName(call) !== null;

function check(context, scopeNode, scopeLabel) {
  const strings = collectStrings(scopeNode);
  const semantic = strings.find((s) => SEMANTIC.test(s.text));
  if (!semantic) return;
  const raw = strings.find((s) => RAW_NON_GRADIENT.test(s.text));
  if (!raw) return;
  context.report({
    node: raw.node,
    messageId: 'mixed',
    data: {
      semantic: semantic.text.match(SEMANTIC)[0].trim(),
      raw: raw.text.match(RAW_NON_GRADIENT)[0].trim(),
      scope: scopeLabel,
    },
  });
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'a semantic design-system class must not share a class string, clsx() call or object with a raw Tailwind palette utility',
    },
    messages: {
      mixed:
        '`{{semantic}}` already owns this hue; `{{raw}}` beside it in the same {{scope}} is a second source of truth. Move the color into the semantic class (or add one) instead of hand-typing it here.',
    },
    schema: [],
  },
  create(context) {
    return {
      // One string that contains both halves.
      Literal(node) {
        if (typeof node.value !== 'string') return;
        if (SEMANTIC.test(node.value) && RAW_NON_GRADIENT.test(node.value)) {
          check(context, node, 'class string');
        }
      },
      TemplateLiteral(node) {
        const text = node.quasis.map((q) => q.value.cooked ?? '').join(' ');
        if (SEMANTIC.test(text) && RAW_NON_GRADIENT.test(text)) {
          check(context, node, 'class string');
        }
      },
      // A bare ternary choosing between a semantic class and a raw palette for
      // the SAME slot — the AiUsageWarningBanner shape: `isStopped ?
      // 'alert-critical' : onTopup ? 'bg-sky-50 …' : 'alert-usage-warning'`.
      // Not inside any call or object, so no other visitor reaches it. Only the
      // OUTERMOST ternary is checked, so a nested chain reports once.
      ConditionalExpression(node) {
        // One finding per site: skip when an enclosing ternary, clsx()-style
        // call, or style object will report this same string anyway.
        for (let a = node.parent; a; a = a.parent) {
          if (a.type === 'ConditionalExpression') return;
          if (a.type === 'ObjectExpression') return;
          if (a.type === 'CallExpression' && isClassJoiner(a)) return;
          if (a.type === 'JSXElement' || a.type === 'Program' || /Declaration|Statement$/.test(a.type)) break;
        }
        check(context, node, 'ternary');
      },
      // clsx()/cn()/classNames() joining the two halves from separate arguments.
      CallExpression(node) {
        const name = joinerName(node);
        if (!name) return;
        check(context, node, `${name}() call`);
      },
      // An object whose properties split one hue across semantic and raw —
      // the notificationUtils shape.
      ObjectExpression(node) {
        // Only objects that are plainly a style record: every value a string-ish.
        const props = node.properties.filter((p) => p.type === 'Property');
        if (props.length < 2) return;
        const allStringish = props.every((p) => {
          const v = p.value;
          return (
            (v.type === 'Literal' && typeof v.value === 'string') ||
            v.type === 'TemplateLiteral' ||
            v.type === 'ConditionalExpression' ||
            v.type === 'Identifier'
          );
        });
        if (!allStringish) return;
        check(context, node, 'object');
      },
    };
  },
};

export { RAW, RAW_NON_GRADIENT, SEMANTIC };
