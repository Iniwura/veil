import { useEffect, useState } from "react";

export type Theme = "dark" | "light";

export type ThemeController = {
  theme: Theme;
  toggleTheme: () => void;
};

const STORAGE_KEY = "unveil.theme.v1";
const THEME_QUERY = "(prefers-color-scheme: light)";

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => unknown;
};

function systemTheme(): Theme {
  return window.matchMedia(THEME_QUERY).matches ? "light" : "dark";
}

function initialTheme(): Theme {
  const applied = document.documentElement.dataset.theme;
  if (applied === "light" || applied === "dark") return applied;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : systemTheme();
}

export function useTheme(): ThemeController {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  useEffect(() => {
    const media = window.matchMedia(THEME_QUERY);
    const updateFromSystem = () => {
      if (!window.localStorage.getItem(STORAGE_KEY)) setTheme(media.matches ? "light" : "dark");
    };
    media.addEventListener("change", updateFromSystem);
    return () => media.removeEventListener("change", updateFromSystem);
  }, []);

  return {
    theme,
    toggleTheme: () => {
      const updateTheme = () =>
        setTheme((current) => {
          const next = current === "dark" ? "light" : "dark";
          try {
            window.localStorage.setItem(STORAGE_KEY, next);
          } catch {
            // Theme switching remains available when storage is restricted.
          }
          return next;
        });
      const reducedMotion =
        window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
        document.documentElement.dataset.motionReduced === "true";
      const startViewTransition = (document as ViewTransitionDocument).startViewTransition;
      if (startViewTransition && !reducedMotion) startViewTransition.call(document, updateTheme);
      else updateTheme();
    },
  };
}
