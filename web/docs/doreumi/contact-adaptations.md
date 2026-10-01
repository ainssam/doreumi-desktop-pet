# Imported contact adaptations

These targeted adapters change animation rotations and bounded root placement. The master GLB, original mesh attributes, UVs, texture bytes, morphs, joint translations and scales remain unchanged. The source action IDs and source timing remain traceable. Numerical contact checks supplement the root browser review; they do not approve an imported motion for ambient playback.

| Source IDs | Adaptation | Preserved behavior |
| --- | --- | --- |
| 27, `Big_Heart_Gesture` | Both mittens present against the lower cheeks. The additional source head roll is reduced so both contacts fit the measured short arms. | Original body sway and leg timing, followed by the existing idle recovery. |
| 327, 598, kettlebell swings | Upper-body tilt is bounded and the hands form a compact grip in front of the body. Source hand height drives the smaller swing. | Source heading, swing rhythm and knee/foot rotations. |
| 551, 611, heavy-object walks | Both hands move forward to a stable, short side grip on the box. | Source heading, knee/foot rotations and separate host travel. |

`meshy-heart.mjs` uses measured cheek vertices 69825/8888 and mitten contact vertices 78797/0. The cheek points retain their actual head/torso skin blend. The controller measures reach through the collar, upper arm and forearm, then orients the mitten surface outside the cheek. The source-relative envelope raises the hands from phase .045 to .22, holds through .70 and releases by .88. The baked clip test measures the visible surface directly without reapplying the adapter: 88 contact samples remain between .01294 and .01499 model units apart, below 1% of the 2.14-unit body height. This is a cheek-heart interpretation; it does not claim that the short arms form a human overhead heart.

`meshy-prop-contact.mjs` uses the same fixed skin material points selected by the runtime props, vertices 78089/705, including their small elbow influence. Kettlebell grips are .75 units apart; box grips are 1.04 units apart. The goals use the body's horizontal heading, including the rotated source 598. Body/torso/head tilt limits are 20/25/25 degrees for the bell and 10/10/15 degrees for the box. After moderating the body, the adapter restores each thigh's original world rotation, retaining the source knee and foot rhythm without changing segment lengths. Rebuilding the carry clips also requires regenerating their separate travel curves.

The prop solver uses an outward/downward elbow pole. The generic forward pole becomes parallel to a forward/downward grip in some bell frames, allowing the elbow plane to flip. A neutral wrist, fixed collar and damped solve of the actual skin offset prevent that ambiguity. The optional pole parameter leaves every other imported action on the existing solver behavior. In 124 sampled source poses, contact error is below .00010 units, reach clamp is zero, wrists remain neutral, elbows stay below 142 degrees and collars below 101 degrees.

The final four shipping clips are also decoded without reapplying the adapter. Across 484 poses after key reduction, actual skin grip error is at most .003713 units (under .18% of body height), grip span error is at most .002162 units, and wrists remain neutral. The interpolated maximum bell tilt is 25.164 degrees; box tilt remains below 11.851 degrees. Prop screenshots and continuous playback remain separate visual review steps.

```sh
node --test tests/doreumi-meshy-heart.test.mjs tests/doreumi-meshy-prop-contact.test.mjs tests/doreumi-meshy-retarget.test.mjs
```

The tests also verify protected joint positions/scales, unchanged foot rotations, anchor agreement with the actual master skin, scope isolation and recovery of the heart envelope. Root owns browser captures, full-speed and quarter-speed playback, small-avatar review, prop geometry/contact review and registry decisions.

## Floor entry and recovery

`meshy-transition.mjs` replaces only the authored entry and recovery of 30 inspected floor actions. It copies every original source key and both interpolated boundary values, shifting their timestamps without changing the exercise itself. The frozen master supplies the pelvis/leg paths for sitting, kneeling and reclining. A prone entry first kneels, then puts both palms on the floor for .15 seconds, then moves into the original source pose. Recovery reverses that supporting sequence. A symmetric, reachable kneeling waypoint prevents an asymmetric source shoulder or head tilt from making one short arm miss the floor. The copied master arm path is replaced by a continuous rotation to its endpoint because the original arm IK can cross an elbow pole branch during lowering.

Before correction, action 329 entered with a 44.3-degree body tilt while its knees were bent only 11.3 degrees. Action 344 reached a 44.4-degree tilt with knees near 5 degrees. The replacement flexes both knees past 100 degrees before leaning. The actual mitten surfaces at the brace waypoint are .003783 units above the floor, with no reach clamp or changed joint translation/scale. After serialization, the representative entry/recovery paths sampled at 120 Hz have maximum joint rotation increments of 1.67 degrees and minimum skin height of .00152 units. The original source interval changes by at most 1.75e-6 in the sampled quaternion/vector comparison.

The airborne policy is separate from transition rotation. A donor's belly penetrates its floor in some original lying clips, so a global full-body tenth percentile falsely lifts later standing poses. In 344 that produced .103 units of extra target height. Explicit non-jumping floor actions use grounded support; jump push-up 325 requires both actual source feet to rise. Actions 366 and 369 use the donor's actual skin rest floor, preserving genuine flight, including 369's .623-unit original full-body lift. Other catalog IDs retain the previous airborne policy. This is a measured, scoped correction, not a new global policy for all 524 clips.

```sh
node --test tests/doreumi-meshy-transition.test.mjs
```

The initial 329/344/363 shipping clips were separately decoded after integration, with the same continuous support and original source rotations. Root reviewed their quarter-speed playback. This does not approve every floor clip. Source exercise contacts remain separate: 329's original push-up middle still has palms approximately .28 units above the floor while the belly/forearms support it, and source 325's existing reduced endpoint has about .0021 units of floor penetration. Those source defects are not hidden by classifying the new entry as supported.

The later scope includes sleep 269 and falls 490/502. Sleep uses grounded support because its imported final body floated .126 units above the floor. Falls retain their existing source airborne curve. Source 502 is an airborne prone pose throughout: its actual donor skin remains .654 to .827 units above the donor rest floor. It receives a real two-palm brace during entry and recovery, rather than pretending its airborne middle is a hand-supported exercise. Both brace palms measure .003782 units above the floor.

## Supported acrobatics

`meshy-floor-acrobatics.mjs` retains each imported action ID and records the supported interpretation in `semantics.contactAdaptation` and `acrobatics.variant`:

| Source ID | Supported interpretation | Source behavior retained |
| --- | --- | --- |
| 375 | Tucked floor roll | Original cartwheel turn progression, approximately -2π over 3.3 seconds. Root travel is bounded to .26 units and returns to zero. |
| 395 | Backspin | Original axial turn progression, approximately -2π in .5 seconds. The body stays horizontal and the short legs retain subdued source accents. |
| 406 | Flair with an initial right-palm brace | All original body, torso, head, leg and later jump rotations. The collar moves only as much as the measured short-arm reach needs. |
| 451 | One-palm seated balance | Original inversion timing becomes a side lean and raised free arm, with a seated pelvis and actual right-palm support. |

The standard straight inverted posture in 375/395/451 places the supporting shoulder farther from the floor than the unchanged short arm can reach. Keeping that posture would produce head support with floating hands. These explicit interpretations are not mislabeled human handstands. No master, mesh, morph, joint position or scale is changed. Entry/recovery use the same supported floor path described above.

Decoded shipping clips were checked without reapplying the helper. At 120 Hz, minimum full-skin floor clearance is .00130 units across the four clips. Right-palm height is .00373 to .00423 during 406's corrected initial support and .0039996 to .0039999 throughout 451's supported hold, with zero reach clamp. Motion 406 remains fast: its original knee reached 9.04 degrees per 120 Hz sample and its adapted elbow reaches 9.89 degrees. The numerical checks do not establish that this speed reads naturally at avatar size. Root must review full-speed and quarter-speed playback, all angles and the 128-pixel avatar before registry approval.

```sh
node --test tests/doreumi-floor-acrobatics.test.mjs
```

## Small stomp visibility

The first 255/256 correction raised the left sole from roughly .05 to .13 units. Root's 128-pixel playback review still found it difficult to read: the foot tucked behind the belly and the simultaneous head nod dominated the movement. The revised helper keeps the 1.2-second source accent, adds a short preparation/hold, moves the foot in front of the belly within its measured two-segment reach, and reduces torso/head pitch during that accent. The standing leg and original foot orientation remain unchanged. The regenerated shipping clips reach .19078/.19221 units at the same 1.2-second source peak, with the foot .27 units in front of its hip and head pitch .213/.210 radians. A raised sole above .15 units lasts over .15 seconds. Minimum skin height remains .00191/.00174 and maximum leg increments fall to 4.68 degrees per 120 Hz sample. Small-avatar readability still needs root's visual decision; these measurements do not approve it.

The final direct shipping evidence for acrobatics is `.artifacts/doreumi-transition-audit/acrobatics-shipping-final.json`, containing the frozen master SHA, each clip SHA, 120 Hz full-skin floor measurements, local/world joint increments and actual palm height intervals. Its palm evidence measures height contact, not source-confirmed planar slip. The 269/490/502 report is `.artifacts/doreumi-transition-audit/sleep-falls-shipping.json`. Root's latest 395 review still finds a rigid horizontal spin: retain its source turn rhythm but add visible arm-sweep and knee-tuck/release momentum before accepting that adaptation. This follow-up belongs to the asset owner after the current handoff.

## Corrupt source tail

Action 463, `Run_and_Jump`, contains an isolated corrupt final source key. From source 2.3000 to 2.3333 seconds, the original right foot turns 139.70 degrees, the right thigh 137.58 degrees and the right knee 96.05 degrees. Matching the original source therefore does not establish natural motion. `meshy-source-tail.mjs` replaces that key with the last valid pose, using a smooth sample-time deceleration over the final two playback frames. Source sampling is unchanged before 2.2667 seconds; the jump apex and earlier motion retain their original timing. The playback source duration remains 2.3333 seconds, while the last retained original pose is at 2.3000 seconds. `sourceTailRepair` records both durations, the replaced key and the time-warp interval.

The source-time derivative enters at one and ends at zero, so recovery starts from a stopped, valid pose. The acquired donor's maximum right-leg world rotation in that tail falls from 45.95 to 2.90 degrees per 120 Hz sample before retargeting. This repair is restricted to action 463 and the exact audited source SHA, and refuses a missing or different checksum or duration. It does not repair the separate landing contact failures: earlier source-confirmed foot support remains subject to its own skin-contact and stage-motion checks.

The final shipping clip is checked without reapplying the helper and is accepted by `DoreumiMotion.registerClip`. At 120 Hz its repaired right-leg world step is at most 2.318 degrees; the retained free-arm sweep reaches 5.412 degrees. Before the repair interval, key reduction changes local rotations by at most .227 degrees and root height by .000108 units. The jump apex remains exactly .37448281785 units. The distinct landing findings remain pending: 13 missing-support pairs, eight slip pairs and an existing whole-skin minimum of -.007991 units. Exact old/new hashes, preservation measurements and full-joint/contact results are under `.artifacts/doreumi-contact-audit/source-tail-463/`.

```sh
node --test tests/doreumi-source-tail.test.mjs
```
