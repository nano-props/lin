# Design tokens

The default palette follows Goblin's macOS theme, in light and dark variants.

- `palette.css` owns surface, text, border, action, status, shadow and terminal colors.
- `tokens.css` owns typography, spacing, radii, motion, control sizes and component roles.
- `terminal-theme.ts` reads the same CSS variables for xterm; there is no second JavaScript palette.

Components consume `--lin-*` roles rather than color literals. Terminal foreground,
background, selection and all 16 ANSI colors use the `--lin-terminal-*` namespace.
`useTheme` resolves the automatic setting into a light/dark `data-theme` attribute.
