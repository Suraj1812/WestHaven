# WestHaven

A browser-based nighttime superhero sandbox built with Three.js. Fly above the waterfront, drive through the city, and fire energy attacks at destructible buildings and NPCs. The interface uses icons and touch controls rather than a header or marketing text.

## Run locally

Requires Node.js. No dependency installation is needed; Three.js and its licenses are included.

```sh
npm run dev
```

Open http://127.0.0.1:4173. Run `npm run check` to validate JavaScript and local asset references.

## Controls

| Action | Desktop | Touch |
| --- | --- | --- |
| Move | WASD / arrow keys | Left joystick |
| Look | Drag | Drag on the city |
| Fly / land | F | Flight button |
| Rise / descend | R / Q | Look and move around obstacles; flight button to land |
| Drive / exit | E | Vehicle button |
| Attack | Space, or select a target | Attack button, or tap a target |
| Sprint / boost | Shift | Full joystick input |
| Overview camera | C / camera button | Camera button |
| Restore city | Reset button | Reset button |

Buildings, streets, vehicles, and people use consistent real-world proportions. Vehicle footprints are checked against buildings, shorelines, and the bridge. Scene quality adapts to rendering performance; background animation pauses when the browser tab is hidden.

## Deployment

Vercel serves `dist/`. Its native GitHub integration deploys pushes to `main` to production and creates preview deployments for other branches. No CI token or custom deployment workflow is required.

## Assets

Generated PNG emblems, district illustrations, and surface textures live in `dist/assets/`; prompts are documented in `ASSET-PROMPTS.md`. Third-party attribution is in `CREDITS.md`. Three.js is MIT licensed; its license is bundled in `dist/vendor/THREE-LICENSE.txt`.

This is a procedural real-time browser game, not a photorealistic AAA simulation.
