/**
 * True when the user is in the middle of highlighting text that started inside `container`.
 * A card header that opens/closes on click must ignore the click that ends a highlight drag,
 * otherwise highlighting text also toggles the card. Looks at what is actually highlighted and
 * where it started, so a stray highlight somewhere else on the page never blocks a normal tap.
 */
export type SelectionLike = {
  isCollapsed: boolean;
  anchorNode: unknown;
  toString(): string;
} | null;

export function isHighlightingInside(
  selection: SelectionLike,
  container: { contains(node: never): boolean },
): boolean {
  if (!selection || selection.isCollapsed) return false;
  if (!selection.toString().trim()) return false;
  return container.contains(selection.anchorNode as never);
}
