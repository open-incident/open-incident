/**
 * Open Incident design system — entry point.
 *
 * The CSS tokens live in ./tokens.css and the shipped typefaces in ./fonts.css.
 * The components (DataTable, Drawer, CommandPalette, forms…) land here screen by
 * screen as the design is imported: a component exists once a screen uses it,
 * never before.
 */

/** Joins conditional class names together, with no dependency. */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export { Button, type ButtonProps } from "./button";
export { Field, Input, Select, Textarea, type FieldProps } from "./field";
export { Chip, type ChipTone } from "./chip";
