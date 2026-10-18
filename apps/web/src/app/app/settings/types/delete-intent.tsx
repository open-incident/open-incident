"use client";

import { dangerLinkStyle } from "./styles";

/**
 * "Delete this field" inside an edit dialog: the dialog's own form is posted
 * with `intent=delete`, so its action deletes instead of saving.
 *
 * Not a submit button: the first submit button of a form is the one Enter
 * presses, and Enter in the name field must save, never delete. The intent
 * is set for the one submission the click makes, then cleared.
 */
export function DeleteIntent({
  label,
  testId,
  disabled,
  title,
}: {
  label: string;
  testId?: string;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <>
      <input type="hidden" name="intent" defaultValue="" />
      <button
        type="button"
        data-testid={testId}
        disabled={disabled}
        title={title}
        onClick={(e) => {
          const form = e.currentTarget.form;
          const intent = form?.elements.namedItem("intent");
          if (!form || !(intent instanceof HTMLInputElement)) return;
          intent.value = "delete";
          form.requestSubmit();
          intent.value = "";
        }}
        style={{
          ...dangerLinkStyle,
          color: disabled ? "var(--ink-3)" : "var(--dang)",
          cursor: disabled ? "default" : "pointer",
        }}
      >
        {label}
      </button>
    </>
  );
}
