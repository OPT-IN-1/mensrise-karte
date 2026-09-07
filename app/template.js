// テンプレート差し込み（Python版と同じ書式）。
//   {{key}} / {{{key}}} / {{#list}}…{{/list}} / {{^key}}…{{/key}} / {{.}}
// 未充填のスロットが残ったらエラーにする（空白のまま納品しないため）。

const SECTION_RE = /\{\{([#^])([\w.]+)\}\}([\s\S]*?)\{\{\/\2\}\}/g;
const VAR_RE = /\{\{(\{)?\s*([\w.]+)\s*\}?\}\}/g;
const LEFTOVER_RE = /\{\{[^}]+\}\}/g;

function lookup(context, key) {
  if (key === '.') return Object.prototype.hasOwnProperty.call(context, '.') ? context['.'] : context;
  let value = context;
  for (const part of key.split('.')) {
    if (value === null || value === undefined) return undefined;
    value = Array.isArray(value) && /^\d+$/.test(part) ? value[Number(part)] : value[part];
  }
  return value;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' }[c]));
}

function renderInner(template, context) {
  const withSections = template.replace(SECTION_RE, (_m, flag, key, inner) => {
    const value = lookup(context, key);
    if (flag === '^') {
      const empty = !value || (Array.isArray(value) && !value.length);
      return empty ? renderInner(inner, context) : '';
    }
    if (!value) return '';
    if (Array.isArray(value)) {
      return value.map((item) =>
        renderInner(inner, (item && typeof item === 'object') ? { ...context, ...item } : { ...context, '.': item })
      ).join('');
    }
    if (typeof value === 'object') return renderInner(inner, { ...context, ...value });
    return renderInner(inner, context);
  });

  return withSections.replace(VAR_RE, (match, raw, key) => {
    const value = lookup(context, key);
    if (value === undefined || value === null) return match;   // 未充填として残す
    return raw ? String(value) : escapeHtml(value);
  });
}

export function render(template, context, where = '') {
  const output = renderInner(template, context);
  const leftovers = [...new Set(output.match(LEFTOVER_RE) || [])];
  if (leftovers.length) {
    throw new Error(`${where}: 未充填のスロットが残っています: ${leftovers.join(', ')}`);
  }
  return output;
}

/** カルテに出ている文言を、担当者が指定した文言へ置き換える（タグの外だけ）。 */
export function applyTextCorrections(html, corrections) {
  const rules = (corrections || []).filter((r) => (r.find || '').trim());
  if (!rules.length) return html;
  const parts = html.split(/(<[^>]*>)/);
  for (let i = 0; i < parts.length; i += 2) {
    for (const rule of rules) parts[i] = parts[i].split(rule.find).join(rule.replace ?? '');
  }
  return parts.join('');
}
