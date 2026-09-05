import { useEffect } from "react";

export type Theme = "dark" | "light";

export type ThemeController = {
  theme: Theme;
  toggleTheme: () => void;
};

export function useTheme(): ThemeController {
  useEffect(() => {
    document.documentElement.dataset.theme = "dark";
    document.documentElement.style.colorScheme = "dark";
  }, []);

  return {
    theme: "dark",
    toggleTheme: () => undefined,
  };
}
