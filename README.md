# WestHaven

A browser nighttime superhero city sandbox built with Three.js, with a minimal icon interface and desktop/touch controls.

The explorable map is **1,260 × 1,080 metres**: ten times the previous width and depth. Its 406 enterable buildings include houses, townhouses, apartments, offices, restaurants, cafés, stores, a hospital, gym, school, and library, alongside parks, markets, and a waterfront.

## Run locally

Requires Node.js. Three.js and its license are bundled; no package installation is required.

```sh
npm run dev
npm run check
```

Open http://127.0.0.1:4173.

## Play

| Action | Desktop | Touch |
| --- | --- | --- |
| Walk / steer | WASD or arrow keys | Joystick |
| Look | Drag | Drag the city |
| Enter / use / leave a building | E near a door or object | Contextual door button |
| Enter / leave your parked car | E near the car, or vehicle button | Vehicle button |
| Fly / land | F | Flight button |
| Rise / descend | R / Q | Up/down buttons while flying |
| Sprint / flight boost | Shift | Full joystick input |
| Energy attack | Space or tap a target | Attack button or tap a target |
| City overview | C or camera button | Camera button |
| Restore the city | Reset button | Reset button |

Interiors load on entry and include halls, living rooms, kitchens, bedrooms, bathrooms, and furnishings appropriate to each building type. TVs, refrigerators, taps, showers, room doors, beds, and gym equipment have interactions. Their state persists between visits during the browser session.

Forty vehicles follow lanes, queues, turning paths, traffic lights, and pedestrian crossings. Thirty simulated residents follow compressed work/home/dining/shopping/gym schedules; twelve detailed NPC models are allocated to nearby residents. Vehicles brake around the player. Pedestrians use sidewalks and entrances.

The hero can fly, land on roof profiles, drive with acceleration/braking/steering, and fire energy attacks that collapse building pieces and affect NPCs. Human, vehicle, road, room, and building dimensions use metres. Ground collision checks include the entire rotated car footprint, exact shore/bridge boundaries, furniture, walls, and door openings. The camera follows motion and turns, yields to manual looking, and avoids walls.

Static geometry uses spatial GPU instancing and distant detail reduction. Interiors and traffic use merged meshes. Pixel density and bloom adapt to frame performance; background tabs stop rendering. Lighting includes shadows, photographic HDR reflections, generated surface textures, and emissive window details.

## Deployments

The GitHub repository is linked to the Vercel project `westhaven`. Pushes to **main** automatically deploy production; branch pushes receive preview deployments. Vercel serves `dist/` and runs `npm run check`.

## Assets and limits

Generated PNG originals and optimized rendering images are in `dist/assets/`, with prompts in `dist/assets/ASSET-PROMPTS.md`. HDR attribution and source licensing are in `dist/assets/CREDITS.md`; the bundled Three.js license is in `dist/vendor/THREE-LICENSE.txt`.

This is a procedural browser sandbox. Interiors provide furnished playable ground-floor layouts; multi-storey buildings do not contain every upper floor. Physics, NPC routines, and destruction are game simulations, and the current procedural character/building meshes do not provide AAA photorealism. Frame rate depends on the device and graphics hardware.
