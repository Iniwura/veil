import type { ThemeController } from "../hooks/useTheme";

export function ThemeToggle({ theme, toggleTheme }: ThemeController) {
  const nextTheme = theme === "dark" ? "light" : "dark";
  return (
    <button
      className={`theme-toggle theme-toggle--${theme}`}
      type="button"
      aria-label={`Switch to ${nextTheme} mode`}
      aria-pressed={theme === "light"}
      onClick={toggleTheme}
    >
      <span className="theme-toggle-icon" aria-hidden="true">
        {theme === "dark" ? "☼" : "◐"}
      </span>
      <span>{theme === "dark" ? "DARK" : "LIGHT"}</span>
    </button>
  );
}
