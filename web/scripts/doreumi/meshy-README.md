# Meshy motion acquisition and Doreumi retarget

This pipeline supplies the 524 user-approved non-Fighting actions from the 678-action
Meshy library snapshot, with direct and locally derived sources identified separately.
The original Doreumi appearance is retained. The generated
human donor is an intermediate skeleton only, and never ships in the mascot.

## Budget and receipts

- One rig: 5 credits. 524 actions: 1,572 credits. Approved maximum: 1,577 credits.
- Starting account balance: 1,757 credits. Reserved balance: 180 credits.
- A separate T-pose recovery rig was subsequently authorized within the existing
  balance for five additional credits. Its skeleton and receipts remain separate.
- Actual result: 506 direct source downloads and 18 explicitly marked local in-place
  derivatives. The 18 API variants failed with zero consumed credits across both
  donors. Each has an exact-name non-in-place Meshy source already downloaded.
  Total net cost is 1,528 credits; remaining balance is 229 credits. No more failed
  variant retries are authorized for this run.
- Paid intents are written and fsynced before a POST. A POST is sent once.
- Network failures leave an uncertain intent. The runner does not retry it.
- API keys stay in memory. Raw receipts, signed URLs, the donor, and downloaded GLBs
  stay under the ignored `.artifacts/doreumi-meshy/` directory with private permissions.
- Each batch contains at most 10 action IDs. No new purchase or credit top-up occurs.

## Reproduce and resume

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/doreumi/meshy-donor.py -- --out .artifacts/doreumi-meshy/donor
node scripts/doreumi/meshy-acquire.mjs run --phase=pilot --key-file=/private/path/.env.local
node scripts/doreumi/meshy-validate-source.mjs batch-000
node scripts/doreumi/meshy-acquire.mjs accept-pilot --evidence=.artifacts/doreumi-meshy/evidence/batch-000-structure.json
node scripts/doreumi/meshy-acquire.mjs run --phase=all --workers=4 --key-file=/private/path/.env.local
node scripts/doreumi/meshy-retarget.mjs
node scripts/doreumi/meshy-acquire.mjs status
```

Once a donor is recorded in the ledger, do not regenerate or replace it. Its SHA-256
is fixed. Resume the same `run` command after an interrupted poll or download. It
uses the existing task ID and verifies cached checksums. An uncertain submission or
rejected task deliberately stops automatic work. A confirmed zero-cost terminal
failure is recorded while independent actions continue; reconcile
the Meshy account task history before deciding whether any new paid request is warranted.

The runner emits a heartbeat every 30 seconds and polls every seven seconds. A task
with no progress for ten minutes, or more than 25 minutes in one polling session,
stops while retaining its ID. Outputs must be downloaded before Meshy's three-day
retention window expires. A source structure pass permits acquisition to continue;
it does not approve the target motion for random playback.

## Target conversion

`public/doreumi/rig-contract.json` is the master skeleton contract. Conversion applies
world-space rest deltas, derives each target local rotation through the target's own
parent chain, keeps its bind translations and scales, and applies limits to the short
limbs and large head. Source horizontal root motion is removed. Ground height uses
Doreumi's full skinned surface, including palms, head and body. Full source-skin
airborne height is scaled by the leg-length ratio. Convex hulls only reduce vertices
within identical-weight groups, preserving every possible affine support extremum.
Each clip has baked entry and recovery from/to the master's Idle pose with skin
support recomputed throughout the transition. Scratch and hand-contact gestures
use measured two-bone reach without stretching, with reachable cheek adaptation.
Constant, linear, step, and glTF cubic quaternion channels are sampled at 30 Hz.
Quaternion key reduction has a 0.004-radian tolerance, position reduction 0.0008 units.

The outputs in `public/doreumi/motions/meshy-<actionId>.json` contain only Three.js
animation tracks. No source mesh, texture, material, or skin is copied. The sanitized
`meshy-source-manifest.json` records the source hash, target rig signature, output hash,
and conversion policy, master hash, contact/framing bounds and locomotion/prop metadata.
Stable unique clip UUIDs avoid AnimationMixer cache aliases. Re-running conversion skips only matching verified outputs;
`--force` rebakes them, and `--batch=batch-000` limits conversion to one raw batch.

The product registry and its visual review decisions are managed separately. Source
downloaded, locally derived, target converted, target visually passed, and connected to ambient playback
are distinct states. A changed derivative must lose its previous visual approval.
Prop interactions and extreme contact poses still require target-specific review and
correction. Automatic retarget success does not prove natural movement.

The offline `derive-inplace` command records only exact-name matches for isolated,
zero-cost failed in-place variants. It does not send API requests or change their
failed acquisition state. `derivation.requestedActionId` and `baseSourceActionId`
identify the requested variant and actual downloaded source; original failed task
receipts stay in the private ledger. Running the retarget command then creates the
requested local variant with horizontal root travel removed.

## Validation

```sh
node --test tests/doreumi-meshy.test.mjs tests/doreumi-meshy-retarget.test.mjs
node scripts/doreumi/meshy-validate-source.mjs all
```

The tests cover paid scope, batching, credit reserve, duplicate intent safety, source
GLB structure, different bind axes, interpolation, retaining a brief gesture peak,
independent mixer actions, exact support envelopes and short-limb IK reach.
Source inspection verifies the fixed hierarchy/rest, finite keys, monotonic times,
normalized rotations, and separate animation counts. Browser visual QA is a separate
required stage against the real master model.

Official sources: [rigging](https://docs.meshy.ai/en/api/rigging),
[animation](https://docs.meshy.ai/en/api/animation),
[library](https://docs.meshy.ai/en/api/animation-library),
[pricing](https://docs.meshy.ai/en/api/pricing),
[retention](https://docs.meshy.ai/en/api/asset-retention).
