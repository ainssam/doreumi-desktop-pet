# Doreumi master rig

`public/doreumi/doreumi.glb` is the pinned creator source. The offline builder writes `doreumi-master.glb`; the renderer loads that master directly. Scene extras carry `doreumiClipsVersion: 3`, so a baked asset is never re-rigged, retargeted or grounded again at runtime.

The build preserves POSITION, NORMAL, TEXCOORD_0, neutral morph attributes and embedded texture bytes exactly. Only hierarchy, inverse binds, skin indices/weights and animation channels change. The source corrective skin transform is retained in every inverse bind. The measured neutral vertex error is below `9e-8` model units.

## Skeleton and reach

The character faces +Z and uses +Y up. `rig-contract.json` contains the complete rest transforms, semantic names, parent names, sockets and signature used by the Meshy retargeter. Joint coordinates below precede the runtime root lift of `1.1423397` units; X is mirrored for the right side.

| Joint | X | Y | Z | Parent |
| --- | ---: | ---: | ---: | --- |
| shoulderL | .400 | -.245 | .000 | torso |
| armL | .570 | -.245 | .000 | shoulderL |
| elbowL | .713 | -.423 | .029 | armL |
| wristL | .800 | -.520 | .060 | elbowL |
| thighL | .2675 | -.720 | .000 | body |
| kneeL | .2675 | -.890 | .015 | thighL |
| shinL | .2675 | -.890 | .015 | kneeL |
| footL | .2675 | -1.045 | .065 | shinL |

`shinL/R` are zero-offset compatibility helpers. The knee rotates the lower leg and foot. The arm chain includes the collar, upper arm, elbow and wrist. Two-bone IK measures its current segment lengths and clamps unreachable targets instead of stretching bones. Collar-to-palm reach is approximately .55 units, while collar-to-head-top distance is approximately .9. Stretch and Cheer therefore raise hands beside the head with chest extension, preserving the approved short arms.

Skin weights blend through the elbows, knees and wrists. The old horizontal head/torso weight boundary is replaced by a continuous spatial field. Duplicated vertices at UV/material seams receive matching weights; mesh topology and UVs stay unchanged.

## Clips, contact and travel

All 26 existing action IDs remain available. The core gait, greetings, seated work, rest, thinking, presentation, stretch/cheer, jumps, rolling and kneeling bow are authored on the corrected skeleton. Remaining creator actions are retargeted into its rest axes.

Walk and Run use explicit stance and swing foot trajectories, 90 Hz sampled IK, alternating hip/shoulder movement and delayed head motion. `motion-gait.ts` is the shared stride contract. The host owns screen travel; every imported `DoreumiRig.position` track must have zero X/Z. Source root travel is handled separately by the import/host layer, avoiding double movement.

Sit, Lie, Code and Read have entry, continuous hold and reversible exit. A request during exit updates the pending action. Hold clips have an explicit closing sample with the original track dimension preserved. Code alternates small palm taps; Read uses a slower shared rhythm. The lap socket is attached to the body at `[0, .17, .265]`. Typing contacts are lap-local `[±.42, .025, .04]` with at most `.008` vertical tapping motion. Runtime props follow the actual current action and `propVisibility`.

Ground-contact poses use sampled signed root-height corrections, so lying/rolling bodies are placed on the surface as well as kept above it. Jump and Joy preserve intentional airborne height and include crouch, takeoff and landing compression. Clip changes require regenerating grounding before rebuilding the master.

Snowman rolls a small ball beside the right hand, lifts the smaller head, pats it into place and presents the result. `motion-snowman.ts` shares the exact prop positions and palm target with the runtime. The snowman uses avatar-floor coordinates under the model holder, independent of the animated root lift. Landing compresses the hips by about .09 units over .12 seconds, with feet planted; Dragged and Falling use different body/head/limb phases to show inertia without scaling the character.

Imported clips are loaded by action ID and registered under `meshy:<id>`. The runtime retains at most 12 imported clips and at most four outgoing fades. Active, outgoing, requested and pending clips are protected from eviction. Registration validates track dimensions, time ordering, finite/unit rotations, joint names, fixed limb translations, unit scale and host-owned planar travel.

The 176 imported locomotion actions carry `entry.travel` in the runtime registry. Those curves integrate the opposite displacement of the final target clip's supporting foot, including its rotated sole offset. The source donor stride does not set the stage speed. Entry and exit have zero travel, support changes use a height hysteresis, and airborne samples carry the last supporting velocity. `motion-travel.ts` validates each ordered animation-time curve before use.

`useDoreumiLocomotion.onMotionFrame` receives the actual renderer action, time and camera pixels per model unit. The host samples that same clock rather than running a second animation timer. Source forward, backward and sideways relations are retained while choosing the available horizontal stage direction. Camera scale changes apply only to subsequent displacement. The avatar stops at the safe viewport edge and returns to face the user; pointer interaction, disabled surfaces and reduced motion cancel stage movement. Its public drag/fall phase stays idle during imported performances so the personality director does not cancel its own animation. The parked screen position survives the next idle and chat close.

## Rebuild and checks

```sh
node --import ./tests/register-alias.mjs scripts/doreumi/motion-verify.mjs --bake-grounding
node --import ./tests/register-alias.mjs scripts/doreumi/build-master-rig.mjs
node --import ./tests/register-alias.mjs scripts/doreumi/motion-verify.mjs
node --import ./tests/register-alias.mjs --test tests/doreumi-rig.test.mjs
node --import ./tests/register-alias.mjs --test tests/doreumi-stage-travel.test.mjs
node --test tests/doreumi-locomotion.test.mjs
node scripts/doreumi/host-qa.mjs --stage-only --output=/tmp/doreumi-stage-qa
```

The focused tests cover protected bytes, baked-asset idempotence, independent neck/torso deformation, connected elbow/knee chains, seated/lying surface contact, sustained holds and recovery, palm contact, stance travel, unchanged segment lengths, malformed imports and bounded cache/fades. Stage tests read all 176 shipped curves and measure real master/clip support positions after the actual host projection. The optional Host stage mode uses the real renderer and hook, keeps approval data unchanged, and measures screen contact residuals while sampling normal animation frames. Only the root visual lane runs that browser mode. The broader verifier checks all 26 action frames, expression assets, framing and interruption recovery. Browser review still owns visual acceptance, including all angles, intermediate poses, props, seasonal clothing and individual imported actions.
