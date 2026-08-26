import { useEffect, useState } from "react";

export type Theme = "dark" | "light";

export type ThemeController = {
  theme: Theme;
  toggleTheme: () => void;
};

const STORAGE_KEY = "unveil.theme.v1";
const THEME_QUERY = "(prefers-color-scheme: light)";

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
    toggleTheme: () =>
      setTheme((current) => {
        const next = current === "dark" ? "light" : "dark";
        window.localStorage.setItem(STORAGE_KEY, next);
        return next;
      }),
  };
}
