# Master rebuild 2026-09-25 (seated Code/Read)

Codex stopped (usage limit) after moving the new lap pose into `DOREUMI_LAP` without rebaking the master.
Claude finished the handoff:

- Read hold gained a loop-aligned 2.4s palm shift (`readingLift .008`) so the hold never freezes.
- The book tips its far edge up (`bookTilt .45` around `bookHingeZ -.17`); Read palm targets and wrist
  orientation turn with the page. Laptop is unchanged.
- Rebuilt with `motion-verify --bake-grounding` then `build-master-rig`.

## Equivalence proof (why imported-motion reviews carry over)

Old master `9783e748…cbf1c` vs new master `ff950b38…f0afa1` (intermediate `fc708870…`, `7001194d…` superseded the same day), compared node by node:

| Part | Result |
|---|---|
| Node rest transforms and parents | identical |
| Skin joints and inverse binds | identical |
| POSITION / NORMAL / UV / morph attributes | identical |
| Textures, scene extras, rig signature `21af64ae…` | identical |
| Animations | only Code and Read joint values differ; every clip gained constant `lap` socket keys |

Imported Meshy clips drive only rig bones through the unchanged skin, so their rendered surface is the same.
The live bindings (registry, source manifest, 12 contact plans and their plan hashes, acrobatics 502 metadata
hash, airborne and arm-skin script constants, one test constant) were moved to the new hash. Historical review
JSON under `docs/doreumi/` keeps the hash that was actually reviewed.

## Checks

- Palms to keyboard/page ≤ .0077 units over the hold; hold seam step .0006.
- Laptop underside .0049 above the actual thigh skin; zero body vertices inside laptop or book boxes at
  t = .4 … 3.5 s.
- Isolated renderer captures at 0/45/90/-90/180° for entry and hold.
- `meshy-registry`: 524 registered, 59 passed and ambient (unchanged).
- Walker 567/696 stage-v1 candidates (visually reviewed normal and ¼ speed by Codex) promoted to public clips;
  still `pending`, not in the random pool.
- Independent review (code and security lanes) passed. Follow-up applied: Read wrist orientation now uses the
  visible page tilt under the scaled lap socket (`atan2(sin θ·sy, cos θ·sz)` ≈ .572 rad) instead of `bookTilt`
  alone. Motion assets are size-capped before `JSON.parse` (registry 8 MB, clip 2 MB).
