# PrismOS-AI brand

The mark is a P drawn as one beam that opens into three lanes. The beam is the tool; the lanes are the solutions it works out. From the outside in they run cyan, blue and violet, the order in which glass bends light, so violet takes the tightest turn. The wordmark reads in three parts: Prism, then OS in a heavier weight, then AI in blue.

Everything here is drawn from lines and arcs. There is no font, stock shape or traced artwork in any of these files.

## Files

| File | Use |
|---|---|
| `prismos-ai-app-icon.svg`, `prismos-ai-app-icon-1024.png` | The app icon on the macOS grid (an 824 px tile on a 1024 px canvas) |
| `prismos-ai-mark-dark.svg` | The mark on dark backgrounds (white beam) |
| `prismos-ai-mark-light.svg` | The mark on light backgrounds (blue beam) |
| `prismos-ai-mark-mono-white.svg`, `prismos-ai-mark-mono-black.svg` | The mark in one color, for print or engraving |
| `prismos-ai-lockup-dark.svg`, `prismos-ai-lockup-light.svg` | Mark and wordmark side by side |
| `prismos-ai-lockup-mono-white.svg`, `prismos-ai-lockup-mono-black.svg` | The lockup in one color |
| `prismos-ai-wordmark-dark.svg`, `prismos-ai-wordmark-light.svg` | The wordmark on its own |
| `favicon.svg`, `favicon-32.png` | Browser tab icon |
| `source/` | Sources for the app icons (see below) |

## Colors

| | On dark | On light |
|---|---|---|
| Beam | `#eef1f5` | `#2f6fe4` |
| Outer lane | `#2cc4d6` | `#0e8fa3` |
| Middle lane | `#5b8def` | `#2f6fe4` |
| Inner lane | `#8b7cf6` | `#6a55e8` |
| Wordmark | `#eef1f5`, AI in `#5b8def` | `#1b1f25`, AI in `#2f6fe4` |
| App icon tile | `#11151b` | |

These are the app's own theme colors from `src/App.css`. Inside the app the mark is the `PrismosMark` component, which reads them from the `--brand-*` variables, so it follows the theme.

## Using it

- Keep clear space around the mark of at least half its width.
- The bare mark reads down to about 14 px. Smaller than that, use the app icon.
- Don't recolor the lanes, change their order, stretch the mark or add effects to it.

## Regenerating the app icons

From the repository root:

```sh
npx tauri icon docs/brand/source/manifest.json
npx tauri icon docs/brand/source/app-icon-macos.png -o /tmp/prismos-mac-icons
cp /tmp/prismos-mac-icons/icon.icns src-tauri/icons/icon.icns
```

The first command builds the Windows, Linux, Android and iOS icons from the full-bleed tile, with the tile color behind the Android and iOS versions. The second builds the macOS icon from the tile on Apple's grid. `src-tauri/icons/tray-template.png` is the black silhouette that macOS tints in the menu bar.
