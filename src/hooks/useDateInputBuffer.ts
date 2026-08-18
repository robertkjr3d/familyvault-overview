import { useEffect, useRef, useState, type ChangeEvent } from "react";

// Safari fix (Aug 18, 2026) — see components/ui/date-input.tsx for the full
// root-cause writeup. This hook holds the DOM <input type="date">'s live
// value in local state instead of feeding the parent's `value` prop
// straight into the input on every keystroke. A ref tracks the last value
// WE pushed up via onChange, so a genuine external change (switching
// records, a programmatic reset) still syncs `local` correctly, without
// every re-render caused by our OWN onChange loop rewriting the DOM node's
// `.value` mid-type — which is what breaks Safari's native date widget.
//
// Shared here (not duplicated inside <DateInput>) so the one raw,
// custom-styled date input in Settings' Test Mode — which can't go through
// the shadcn-styled <DateInput> component without a visual regression —
// gets the identical fix instead of a second hand-copied version.
export function useDateInputBuffer(
  value: string | null | undefined,
  onChange: (v: string) => void,
) {
  const [local, setLocal] = useState(value ?? "");
  const lastPushed = useRef(value ?? "");

  useEffect(() => {
    const v = value ?? "";
    if (v !== lastPushed.current) {
      setLocal(v);
      lastPushed.current = v;
    }
  }, [value]);

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setLocal(v);
    lastPushed.current = v;
    onChange(v);
  }

  function clear() {
    setLocal("");
    lastPushed.current = "";
    onChange("");
  }

  return { local, handleChange, clear };
}
