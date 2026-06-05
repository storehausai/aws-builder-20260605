/**
 * Minimal local shim for `next-intl`'s `useTranslations`.
 *
 * selection-action-bar) were authored against next-intl. pebble has no i18n
 * runtime, so this shim resolves the `common` namespace keys those components
 * actually request to plain English strings. Mapped via the `next-intl`
 * tsconfig path alias.
 */

type Vars = Record<string, string | number>;

const MESSAGES: Record<string, string> = {
  "table.noItemsYet": "No items yet",
  "table.noItemsMatch": "No items match",
  "action.selected": "{count} selected",
  "column.calculate": "Calculate",
  "column.none": "None",
  "column.sum": "Sum",
  "column.average": "Average",
  "column.min": "Min",
  "column.max": "Max",
  "column.countAll": "Count all",
  "column.countUnique": "Count unique",
  "column.countEmpty": "Count empty",
  "column.countNotEmpty": "Count not empty",
};

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, k: string) =>
    k in vars ? String(vars[k]) : `{${k}}`,
  );
}

export function useTranslations(namespace?: string) {
  return (key: string, vars?: Vars): string => {
    const full = namespace ? `${namespace}.${key}` : key;
    const msg = MESSAGES[key] ?? MESSAGES[full] ?? key;
    return interpolate(msg, vars);
  };
}
