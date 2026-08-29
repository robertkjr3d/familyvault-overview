import { useEffect, useState } from "react";

// Reads the same dark-mode signal settings.tsx toggles
// (document.documentElement.classList.contains("dark")) — not a separate
// mechanism. A MutationObserver on the class attribute keeps this reactive
// if the user flips the theme while other components (like MemberDot) are
// already mounted, rather than needing a full remount to pick it up.
export function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  );

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setIsDark(root.classList.contains("dark")));
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return isDark;
}
