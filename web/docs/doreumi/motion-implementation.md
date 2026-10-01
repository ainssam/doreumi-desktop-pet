# Doreumi motion implementation

User requirement: “3D 랜더링 준비된 모든 동작 시각 검증해가면서 움직임이 자연스럽게 모든 애니메이션 확인하고 개선”.

## Source and approval boundary

- Creator checkout: `~/pet/doreumi-desktop-pet`, revision `b2cb2a6f7646a298c577a2dbe510a2a75cb9161b`.
- Approved V60 model SHA-256: `00969b87595ee949d44fbe3f738ad028ee466c215cd64c825268bc01a2ec17d2`.
- V90 approved neutral face correction and 34 approved expression textures use the creator's exact V88/V89/V90 projection and pigment code. Eyes and mouth are not redrawn; the character body and UVs are not replaced.
- All 21 approved animation clips remain in the web GLB. `MegaphoneSpeak` and `CarryBag` preserve V98 candidate code and its actual attached props; their candidate status remains explicit in the review page.
- Creator code is MIT; visual assets retain their separate rights. `public/doreumi/NOTICE.txt` carries attribution and the code notice. Product attribution/profile linking belongs to the host UI.

## Web derivatives

`public/doreumi/manifest.json` records source pins, approval categories and output hashes. The 17,363,164-byte GLB becomes approximately 4.29 MB. Geometry compression uses Meshopt without a quantization transform; the build decodes the result and checks every original vertex attribute byte-for-byte. The original 8K color map is resized to 2K JPEG. The approved neutral correction is an explicit relative morph target with weight 1.

The 34 face inks are lossless 768px WebP, approximately 456 KB combined, plus one shared skin cleanup texture. Only requested expressions are loaded, with a bounded GPU cache. A transparent front projection of the same corrected mesh is displayed during loading and when WebGL is unavailable. The props are loaded only for their corresponding candidate motions.

The thin pale marks on the navy head and belly spirals also appear in the creator's original V98 `evidence/deep-qa/action-Idle-front.png` and V90 `evidence/expressions/neutral-front.png`. Direct browser comparisons with the untouched original GLB and a 4K texture derivative reproduce those marks. They are retained as part of the approved source appearance; increasing texture size does not remove them. The 768px `face-skin.webp` is only a bounded cleanup layer for the original eyes and mouth, not the body color map. The review inspector reports the actual body-map dimensions and sampler settings.

Reproduction from an existing pinned creator checkout:

```sh
python3 scripts/doreumi/assets-fetch.py --source=/path/to/doreumi-desktop-pet
node scripts/doreumi/assets-build.mjs --source=/path/to/doreumi-desktop-pet
node --import ./tests/register-alias.mjs scripts/doreumi/motion-verify.mjs --bake-grounding
node --import ./tests/register-alias.mjs scripts/doreumi/motion-verify.mjs
```

The fetcher uses `gh` credentials only in memory, downloads 42 selected LFS objects with four workers, and verifies each SHA-256. The build has no network access and never writes to the source repository.

## Runtime contract

`DoreumiAvatar({ action?, expression?, active?, className?, onReady? })` is a transparent, front-facing renderer; the host owns its page position, running approach and retreat. Three.js is loaded dynamically after mount. The component also exposes an inspection ref for the developer review page.

- Action aliases: `idle`, `run`, `peek`, `greet`, `think`, `talk`, `retreat`; exact creator IDs also work.
- Expression aliases include `happy -> smile`, `think -> thinking`, `sad -> soft_sad`; all 34 exact IDs work.
- Cloned animation tracks remove root X/Z travel so the host movement is not doubled. Source vertical bounce remains, with surface-sampled floor correction in `motion-grounding.ts`.
- The camera eases outward for Roll's wider full-body envelope and returns afterward; ordinary interaction keeps the larger default framing.
- The uncorrected Lie and Roll clips reach 0.208 and 0.285 model units below the standing floor. A 30 Hz skin-surface scan generates only the upward correction needed to retain contact. No mesh vertex or source clip is edited. Looped correction endpoints are identical.
- Idle, Walk and Run loop; reactions crossfade back to Idle. Think repeats with an idle interval. Sit/Lie/Code/Read retain their completed pose and reverse their approved entry motion before starting the next action.
- A single mixer bounds outgoing fades. Document visibility, offscreen visibility and `active=false` pause at the current time; reduced motion keeps a static pose. Mobile DPR is capped at 1.5, desktop at 2. Context loss exposes the real-model fallback and allows one context restoration.
- Low frame rates preserve elapsed time through 60 Hz mixer substeps; a 12fps recovery regression prevents a slow device from delaying the host transition.
- Blink uses the approved closed-eye expression and a short premultiplied-alpha transition. There is no synthetic speech audio or claim of lip synchronization.

## Review surface and geometric contract

`/dev/doreumi-motion` is accessible in development or with the existing `DORMS_REACT_LOCAL=1` review flag. It is not indexed. OOUX objects are the character, one selected action, and one selected expression. The action catalog is a selector for the same character, not separate duplicate character cards.

Alignment contract: action selector ↔ expression selector share top, width and height; one two-column grid owns these values. Timeline label/value share one baseline. Changing the active action leaves the stage, control sizes and text sizes fixed. The automated width sweep requires at most 1px selector drift and 1px horizontal document overflow.

The main visual owner runs:

```sh
node scripts/doreumi/motion-qa.mjs --base-url=http://127.0.0.1:4355 --animate
```

One browser/context/page is reused. The script captures five phases for all 23 actions, all 34 expressions, full action playback video, seated/lying recovery, 320/390/768/1280px layouts, activity pause, reduced motion and context-loss fallback. `CDP_URL` optionally attaches to the main-owned browser. Results are written to `.collab-backend-react/doreumi-motion/`.

## Verification status

The asset build verifies geometry identity and all expression source hashes. `motion-verify.mjs` loads the shipped GLB, skins its actual vertices through the production mixer, checks 483 sampled poses, exact loop boundaries, root translation ownership, recovery, 12fps recovery and rapid interruption. Whole-project TypeScript checking and `node scripts/check-harness.mjs` have passed during implementation.

The main visual lane ran the actual review component through Playwright with memory-served assets, without starting a competing development server. It captured all 23 actions at five phases (115 samples) and all 34 expressions. The first run exposed recovery lag at low frame rates; the mixer now preserves elapsed time with substeps. The rerun passed the automated action, expression, viewport, pause, fallback and pose-recovery checks (`.collab-backend-react/doreumi-motion-4k/report.json`). The original-GLB comparison also passed its checks (`.collab-backend-react/doreumi-motion-original/report.json`). These ignored reports and captures are local QA evidence, not distributed visual assets.

Full-motion visual judgment, the integrated host in Responsively and physical-device smoothness remain separate acceptance steps owned by the main visual lane. They are not claimed complete from automated assertions or static captures.
