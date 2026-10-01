# Imported stage contact investigation

The master remains frozen. This investigation does not approve motion 40 or the stomp variants for ambient playback.

## Motion 40

The actual Host quarter-speed capture `/tmp/doreumi-stage-host-v5/report.json` reports a maximum 1.177% horizontal foot displacement. At clip times 5.91505 to 5.927175, the right-foot screen movement is 1.18094 px: Host movement contributes .4375 px and the foot pose contributes .74344 px. Yaw remains -2.3108356 and the scale remains 51.163414 px per model unit, so camera easing and Host turning do not cause this pair.

That maximum is a descending swing foot. The source right-foot skin remains .045 to .054 units above its minimum floor; target right-foot skin remains .018 to .024 units above its floor. The ankle-offset proxy and .04-unit height band incorrectly count it as a planted foot. The existing travel curve also has a separate real error: its .035-unit height hysteresis retains the left foot after the source changes support to the right, through approximately clip time 6.20.

`scripts/doreumi/meshy-phase-travel.mjs` now selects support from actual source skin stability and integrates the corresponding fixed target skin point. A changing heel/toe point uses the same material point at both ends of each interval. Source gliding remains measurable instead of being silently foot-locked. The helper returns complete travel metadata, including `contactEvidence.phases` with the source interval, source vertex, target vertex and source/target height and speed evidence.

The current candidate is `.artifacts/doreumi-contact-audit/travel-40-candidate.json`, not the shipping manifest or registry. Replaying the 938 captured browser times offline against this candidate produces 606 confirmed skin-contact pairs, with a maximum pair displacement of .1644% of body height. That does **not** close motion 40: 136 of 383 source-planted pairs have no target contact inside the .012-unit skin band. Their median target foot minimum is .02418 units and the maximum is .07920 units. The detailed source/target observations are in `.artifacts/doreumi-contact-audit/travel-40-missing-contacts.json`. Excluding those floating target feet would hide a pose defect.

The contact IK owners must finish the 22/67 solver before applying it to 40. For locomotion, apply the candidate stage displacement as a temporary offline root transform, solve actual source-confirmed skin contacts, then separate the horizontal root transform from the clip and regenerate travel. Applying a stationary foot lock directly to an in-place walking clip would duplicate the Host movement. The current shared solver still needs its full-body floor-lift interaction resolved before reuse.

`bakePhaseAwareTravel` accepts `{ clip, evidence, contract, sourceTimes, sourceFeet, sourceRoots, sourceVertexIds, sourceFloor, targetSampler }`. Times are raw source seconds from zero through the final sample. The source sampler covers `LeftFoot`/`LeftToeBase` and `RightFoot`/`RightToeBase`; the target sampler covers `footL`/`footR` with neutral morph weight one. `targetSampler.vertexIds` retains the original master glTF vertex indices. The master mesh name is `Doreumi`, with 78,799 vertices.

The runtime travel parser validates the optional contact evidence, vertex bounds and non-overlapping intervals per foot. Host QA projects each exact target skin vertex through `getVertexPosition`, `matrixWorld` and the camera. It checks only pairs inside the same source-confirmed interval and preserves the existing 1% limit. Older curves are explicitly reported as `ankle-offset-proxy`, rather than claiming equivalent skin evidence.

After pose correction and manifest/registry synchronization, the root browser lane should run both commands and inspect the captures:

```sh
node scripts/doreumi/host-qa.mjs --stage-only --stage-actions=40 --stage-speed=.25 --output=/tmp/doreumi-stage-host-40-skin-quarter
node scripts/doreumi/host-qa.mjs --stage-only --stage-actions=40 --stage-speed=1 --output=/tmp/doreumi-stage-host-40-skin-normal
```

## Stomp variants 255, 256 and 257

Each existing sheet was inspected individually. The raw source and target foot skin were also sampled at 120 Hz. Variants 255 and 256 are distinct source clips with very similar small left-foot stomps, not identical imported files. The weakness is not primarily nine-frame aliasing:

| ID | Source peak foot clearance | Target peak foot clearance | Peak visible in the nine-frame sheet |
| --- | ---: | ---: | ---: |
| 255 | .07680 | .05078 | 93.5% |
| 256 | .08580 | .05221 | 92.7% |
| 257 | .28406 | .19507 | 99.3% |

Clearance measures one foot's lowest skin point relative to the other foot's lowest point at the same time. For 255/256, the target lift is only about 2.4% of body height, approximately two pixels on the small avatar. Variant 257 has a readable right-foot lift and asymmetric compression. Preserve the separate source IDs and timing; use a bounded short-leg lift plus visible landing compression if adapting 255/256. The measurements are stored in `.artifacts/doreumi-contact-audit/stomp-255-257.json`; no stomp clip was changed during this investigation.

## Validation checkpoint

The phase-travel and locomotion suites pass all 18 checks. The Host stage bundle compiles without opening a browser, TypeScript checking passes, and `git diff --check` passes. Browser playback of the new exact-skin QA path, correction of the missing 40 contacts, and registry approval remain pending.
## Coupled pelvis path

`meshy-contact-path.mjs` solves a complete root path while planted ankle goals remain fixed. Each core contact limits the root to a sphere centered at `ankleGoal - hipOffset`, with radius `reach * reachScale`. The default reach scale is .98. A frame may also provide a measured `minimumRootY` for the non-leg body envelope. The objective minimizes distance from the source root plus the squared second difference across the whole path, allowing anticipation before a new stance and gradual recovery after release. Projection onto the intersection of two reach spheres is exact, including the optional floor halfspace. No joint translation or scale is changed.

The helper explicitly reports impossible intersections. It does not enlarge the shipping rig or silently accept an overstretched leg. Diagnostic paths for infeasible frames are finite, but `report.feasible` remains false and those paths must not be treated as solved motion. `report.converged` describes only numerical optimization; it does not override feasibility or actual skin-contact validation.

On the recorded source 23 and 27 constraints, smoothing with weight 80 kept every planted leg within 98% reach and reduced maximum root acceleration from 24.10 to 4.18 and 14.40 to 2.87 model units/s² respectively. Source 67 exposed a separate impossible stance: from source time 5.233 seconds, both reach spheres are disjoint, with a maximum center-distance deficit of .20557 units. The planted material-point indices remain unchanged. The skin goals barely move while the preserved wide pelvis rotates between them, so a root-only solution cannot work. The new left-foot landing at 5.1 seconds needs a phase-wide reachable placement planned before contact; moving it after planting would hide the defect as foot sliding.

```sh
node --test tests/doreumi-contact-path.test.mjs
```

The code-review owner integrates the resulting fixed root path into actual skin IK and checks the final decoded clips. The helper's sphere constraints alone do not prove calf clearance, palm/sole contact, or visually natural playback.

`planContactPhaseOffset` chooses one constant horizontal landing displacement against every future double-stance frame. Each frame contributes a disk of feasible XZ offsets; Dykstra projection finds the displacement nearest zero within the .35-unit default bound. The same `minimumRootY` may restrict the disk to a slice high enough for the measured body/hip envelope. The offset must be applied before landing and remain constant through continuous planted core. A heel/toe material-point change inside core is not a new landing phase. Empty vertical or horizontal intersections are explicit failures.

`solveContactAnglePath` accepts `{rawAngle, minimum, maximum, time?}` frames and returns a smooth unwrapped pole-angle trajectory inside measured skin-clear intervals. It minimizes the same deviation and curvature objective as the root path. This allows anticipation before a calf-clearance turn and gradual release after it. The caller must measure the whole permitted interval: increasing the angle beyond its smallest clear value does not prove that the calf remains above the floor. Opposite-branch conflicts and empty intervals remain explicit failures. All ten root/landing/angle math tests pass; actual skin and browser acceptance remain separate responsibilities.
