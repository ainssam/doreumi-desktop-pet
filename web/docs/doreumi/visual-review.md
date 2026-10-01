# Doreumi motion review

The automatic report measures finite transforms, floor intersections, framing,
loading, transitions and pause behavior. It does **not** approve natural movement.
Registry entries remain pending until their visual review is complete.

## Review checkpoints, 2026-09-24

| Evidence directory | Review and resulting correction |
| --- | --- |
| `/tmp/doreumi-all-v3` | Inspected all 26 legacy contact sheets, five views and nine phases. Sit/Lie floated, Think missed the cheek, Roll rotated the upright body, Jump/Joy lacked preparation and landing, Stretch/Cheer lacked reach. These findings drove another clip revision. Lie also exceeded the camera frame. This checkpoint is not approval of the revised clips. |
| `/tmp/doreumi-meshy-pilot-v1` | Imported torso/head rotation exposed a split neck. Neck weights and duplicate-position seams were rebuilt without changing the source geometry. |
| `/tmp/doreumi-meshy-pilot-v2` | Inspected all ten pilot sheets (0, 22, 25, 28, 30, 36, 62, 74, 268, 318), five views and nine phases. The neck split is absent. Dance, greeting, agreement, pointing, one-leg balance, dozing and bowing are readable. Scratch 36 needs a reachable cheek/head contact correction for the short arms. Full-speed/quarter-speed playback and small-size approval remain pending. All automatic checks pass. |
| `/tmp/doreumi-chuseok-v3` | Garment had a jagged upper edge, buried collar and floating flower. Replaced triangle-only trimming with rest-space fragment clipping and moved details onto the visible surface. |
| `/tmp/doreumi-chuseok-v4` | Front, side and three-quarter Idle/Code sheets inspected. Smooth garment edge, attached flower, visible collar, seated laptop on lap. Technical checks pass. Other seasons and movements still require their own review. |
| `/tmp/doreumi-christmas-v1` | Hat top clipped the frame. A trial surface-normal-following megaphone swung into the eye region. Expanded seasonal framing and restored an upright grip that follows the character's stage facing. Requires recheck. |
| `/tmp/doreumi-christmas-v2` | Inspected Idle and MegaphoneSpeak sheets. Hat fully visible and megaphone stays below the eye region. Technical checks pass. |
| `/tmp/doreumi-seollal-v1` | Inspected standing and NewYearBow sheets from all five directions. Garment follows the crouch and bow. Technical checks pass. |
| `/tmp/doreumi-master-final-all` | Latest frozen master `9783e748…` captured all 26 actions in five directions/nine phases and recorded normal playback. Inspected the revised contact sheets and all 34 expression tiles. Sit/Code/Read are grounded, the laptop rests on the lap, Snowman manipulates visible snowballs, Roll lies down before rotating, and Jump/Joy/Landing include knee preparation/recovery. Two framing defects remain in this report: side-view Lie/Roll. |
| `/tmp/doreumi-lying-frame-v3` | Centered the camera at the measured lying body Z center (body Z bounds about -1.72 to +0.42), preserving scale. All five views/nine phases of Lie/Roll now pass framing and floor checks. |
| `/tmp/doreumi-pilot-small-quarter` | Captured small 128px pilot poses and recorded quarter-speed playback. Original runtime showed texture aliasing at native 1x, so small displays now supersample within the existing 2x/1.5x desktop/mobile cap. Recovery assertions in this run used normal-speed waits and failed; the harness now scales those waits by playback rate. This report is not promoted to a pass. |

The source catalogue contains 524 noncombat entries. Acquisition, conversion,
technical validation and visual approval are separate states; a downloaded or
converted motion is never automatically eligible for ambient playback.

## Integration findings, 2026-09-24

- `/tmp/doreumi-library-v3-normal`: 54 five-view/nine-phase sheets through source ID 62 were captured before pausing the old bulk harness to correct context integration. Root inspected each available sheet except 16–28, which the rig review agent inspected individually in `visual-batch-16-28.json`. Per-ID root observations are in `motion-review-notes.json`. This interrupted run did not emit its numeric report and is not an automatic pass. Heart27 is unreadable and requires a reachable cheek-heart adaptation. Handbag43/635 lacked a bag and stage travel; their metadata is being corrected.
- `/tmp/doreumi-stage-host-v2`: actual Host desktop/mobile movement samples confirm short walking/running/backward movement and facing restoration. Desktop support slip was below 0.5% of body height. Mobile long leap518 reached the edge before its first measurable support phase, so the original contact-frame assertion failed. The ambient director now checks available runway before selecting imported travel. Boundary interruption remains a separate interaction case, not proof of complete playback.
- `/tmp/doreumi-stage-host-v3`: an apparent Run14 support-slip failure involved the foot rising from Y .0204 to .1173. The previous .12-unit floor threshold included toe-off. The contact detector is being corrected to distinguish actual planted-foot movement from lift; the 1% slip limit remains unchanged.
- `/tmp/doreumi-context-v1`: inspected all nine context sheets (29,32,43,272,284,327,551,552,565). Phone/bag placement reads clearly. Kettlebell327 has an implausibly long triangular handle, box551 long fork-like grips, pickup284 appears in the hand before reaching the floor, recliner272 lacks visible back support, umbrella565 is too flat and clips the frame. These are failed visual findings requiring geometry/contact/timing corrections. No imported motion has been promoted based on this run.

### Additional visual checkpoint

- Root inspected all 17 sheets in `/tmp/doreumi-library-106-123` (five views, nine phases). Clip 119 fails horizontal framing; repair is pending. Other sampled poses keep connected original limbs, but continuous and small-size review remain. No ambient approval.
- Root inspected the corrected `Roll` sheet in `/tmp/doreumi-lying-frame-v3`: sideways lying/rolling silhouettes remain fully visible in all five views and return to standing.
- Actual Host quarter-speed stage v5 passes 1, 5, 14, 20 and 39 contact thresholds; 40 fails at 1.177% of body height. Capture stopped before 62, 518 and mobile coverage. Investigation continues without loosening the threshold.

### Runtime checkpoint after prop and contact changes

- `/tmp/doreumi-host-qa-v5`: actual Host/Avatar/chat component with API fixtures passes at 1280×900 and 390×844. Drag, fall, landing, running, docking and all four SSE stages exercised. Pending UI commits in 2.4/1.7ms; first paint opportunity 70.6/79ms, before the delayed fixture response. This measures UI responsiveness, not production answer latency. Root inspected mobile answered and desktop running screenshots.
- Root initially approved Meshy 27, 295 and 298 after normal/quarter playback temporal-frame inspection, 128px rendering, five views and joint overlays. Evidence is in `heart-27-review.json` and `cheer-review.json`; clip/master/metadata hashes bind each decision.
- 318 hand rubbing initially left a measured .046–.057-unit gap despite visually meeting hands. Targeted IK now measures maximum gap .01895 over 159 source-contact samples, with a positive separating-plane margin for the sampled hand surfaces. Revised-clip visual review is pending.
- 119 clipping alert was a false positive caused by projecting empty world-AABB corners. Runtime inspection now projects actual visible deformed vertices and keeps old conservative bounds separately. Independent 60Hz skin sampling plus `/tmp/doreumi-119-exact-bounds` pass without changing clip/camera metadata.
- Dance contact audit now counts target contact missing from every source-confirmed planted interval. Earlier 23/24/63 slip-only passes are not full-contact passes; all five dance corrections remain pending.

### Further individual inspections

- `/tmp/doreumi-library-321-363`: root inspected all 26 five-view/nine-phase sheets; numeric checks pass. Observations are in `visual-batch-321-363.json`. Generic standing-to-floor transitions and prone hand support need correction; none approved.
- `/tmp/doreumi-portable-v1`: root inspected all 18 new prop sheets; numeric checks pass, but cup-to-mouth alignment, mirror backing, jump-rope clearance and seated-drink support require corrections. Itemized findings are in `visual-portable-v1.json`. Small notes and fruit also need continuous and small-size readability review.
- Independent latest security checkpoint: 28 focused regressions and seven malicious-input cases pass, no new security findings. Baseline Semgrep clean; 16 pre-existing Gitleaks false positives unchanged. This is not final asset visual approval.

- Follow-up source-confirmed full foot-skin audit revokes 27 ambient approval: 93/229 planted pairs lack left-foot contact (soleY up to .0694). The registry now permits only 295 and 298. Their full-source foot-contact audits pass (169/104 pairs, max drift .2698%/.5480%). Five corrected dances and revised 318 pass their numeric source-contact audits; their revised visual reviews remain pending.

- `/tmp/doreumi-contact-quarter-v3` full runtime checks pass; root inspected all five joint sheets and temporal frame sequences. Independent 60Hz continuity audit nonetheless finds large between-key knee/foot rotations in the five new dance adapters and a contact-weight arm jump in 318. These clips remain pending. Numeric framing/contact results and sparse visual samples do not establish continuous joint motion.

### Latest contact and continuity checkpoint

- 318 SHA `241003805b82fdd8987118995a986bd412cf00359c5cebd0926a44be8c8a7574` fixes the contact-weight arm jump. Root individually inspected normal 128px and quarter-speed joint-overlay five-view sheets plus temporal sequences. Source-contact and 60Hz arm continuity audits pass. Approved exact asset in `hand-rub-review.json`; ambient set is now 295, 298, 318. Earlier 318 captures are superseded.
- Root inspected all 42 sheets in `/tmp/doreumi-library-365-422`; findings in `visual-batch-365-422.json`. Floor entry/recovery, short-arm handstand support and head-holding contact remain corrections, not passes.
- Root individually inspected temporal frame sequences for 24 frozen master actions, recorded in `master-temporal-review.json`. Lie and Roll need continuous recapture using the corrected camera.
- Registry/director focused regression suite passes 10 tests after the exact 318 approval.

### Floor transitions and library continuation

- Root inspected all 34 new five-view/nine-pose sheets in `/tmp/doreumi-library-425-460`; scoped numeric checks pass. `visual-batch-425-460.json` records each action. Ladder, ledge, wall and vault motions lack their support context; 451 has the same short-arm handstand issue. No approval from these samples. Unique imported-action observations now cover 257 entries.
- `/tmp/doreumi-floor-cup-v2-quarter` stopped at 344 because serialized shoulder track times duplicated. Earlier 48/329/342/343 sheets and temporal sequences were individually inspected; findings in `visual-floor-cup-v2.json`. 343 cushion was subsequently corrected from independent butt-skin measurements, so its earlier visuals are superseded.
- `/tmp/doreumi-floor-v3-quarter` passes after deduplicating corresponding time/value keys. Root inspected 344 and 363 five-view sheets and quarter-speed temporal sequences: sitting/reclining and folded-leg entry/recovery now read in sequence. Normal128 review and source-core support are distinct remaining checks.
- Source-contact-clean candidates received full21-joint60Hz audits, summarized in `contact-clean-joint-candidates.json`. Scratch36 introduces a large arm jump; 464 has zero measured motion and needs source investigation. Neither is approved.
- `/tmp/doreumi-contact-clean-small` was gracefully stopped after2/11/12/38/243/244 to prioritize the floor correction. All six normal128 sheets and temporal sequences were individually inspected and recorded, with quarter-speed joint review still pending.

- Exact assets2/11/12/38/243/244 completed normal128 and quarter-speed skeleton five-view and temporal inspection, plus source-confirmed foot contact and whole-joint60Hz checks. `contact-clean-review-a.json` binds their hashes. Ambient approval now covers nine assets:2,11,12,38,243,244,295,298,318. All others retain independent gates.
- TypeScript full check passes. A full524-file scan finds no nonfinite values, duplicate/nonascending track times, or nonunit quaternion samples after the serializer correction. This is structural validation, not naturalness approval.

- Root individually inspected all37 five-view/nine-pose128px sheets and4fps actual-playback temporal sheets in `/tmp/doreumi-contact-clean-small-b`. Numeric checks pass. Observations and exact hashes are in `visual-contact-clean-small-b.json`.269/490/502 need supported floor recovery;255/256 stomp readability is still weak at128px. Other entries await quarter-speed review and matching contact evidence. No new ambient approvals.
- The dev QA harness can now apply the production `expressionForMotion` mapping with `--ambient-expression`; TypeScript passes. The ongoing quarter-speed batch includes the latest46/48/343 props and corrected Lie/Roll camera.48 mirror no longer hides the face at45deg, but its relation to the character gaze needs correction before approval.

- Six more idle performances246/247/249/250/251/252 passed individually inspected normal128px and quarter-speed joint-overlay playback with matching full-source foot and60Hz joint evidence (`contact-clean-review-b.json`). Eleven gestures290/293/296/308/309/310/313/314/317/319/326 passed the same checks (`contact-clean-review-c.json`). Approved ambient count is now26. The ongoing quarter batch separately fails mirror48 framing; no approval of48 is implied.
-443 further clips received whole21-joint60Hz source-relative measurements (`remaining-joint-candidates.json`).13 have introduced world-angle changes above the3degree triage threshold.500 wrist crosses the180degree rest-relative branch and the105degree shortest-path clamp creates a confirmed large jump;35/299 use the generic partial clap IK and need correction. These numeric results never substitute for visual review.
- Corrected Lie/Roll camera temporal sequences and46/48 props were individually inspected (`visual-lie-roll-props-quarter.json`). Lie capture verifies held rest, not an exit request.46 needs rope/airborne phase audit.48 gaze placement and framing require a new capture after correction.

### Additional exact-clip review

Nine motions (338, 388, 403, 412, 452, 460, 461, 474, 503) passed individually inspected normal128px and quarter-speed five-angle sheets and temporal playback samples, with matching source-foot and21-joint audits. Total ambient-approved:35. Evidence: `contact-clean-review-d.json`. The quarter-b batch has14 mirror48 framing failures, so the whole batch is not a pass. Floor recoveries269/490/502 and weak stomp readability255/256 remain pending.

Two matching in-place/derived entries601 and639 also passed individual visual review and exact source-contact/joint checks (`contact-clean-review-e.json`). Current ambient-approved total:37.

Scratch-cheek36 and rope-jump46 passed exact shipping source-contact/21-joint audits plus individually inspected normal128px/quarter sheets and temporal sequences. Rope additionally passes triangle clearance and8-jump60Hz timing. `scratch-rope-review.json` records actual measured hashes. Ambient-approved total:39.

### Hold recovery and visibility correction

Independent code review found two runtime faults: pose recovery was skipped during the first0.15seconds of each hold loop, and paused animation frames permanently stopped the ambient director. Both are fixed. Actual-master hold-boundary tests and pause/resume timing regressions pass; independent follow-up ran17 related tests and TypeScript successfully. This is code evidence; explicit hold-to-Run visual capture is still pending.

Root individually inspected45 normal128px five-angle sheets and their4fps playback sequences in `/tmp/doreumi-library-462-508`. `visual-batch-462-508-progress.json` records exact clip and evidence hashes.501/508 visibly shrink too far, several wall/rope/bar motions lack their support geometry, and multiple back-fall recoveries remain rigid. Automatic bounds pass is not naturalness approval. Ambient-approved count remains39.

Root inspected all four actual hold-start-to-Run transition sheets at quarter speed; exact held times below0.15seconds, recovery flag and finalRun verified (`hold-recovery-review.json`). Lie first sits up; Code/Read props fade before standing. Full harness final checks pass.

Absolute source-inclusive joint audit found wrist changes requiring finer inspection in452/601; both temporarily returned to pending despite earlier sampled-playback approval. One-palm seated balance451 passed independent same-material-vertex120Hz contact verification plus normal/quarter visual review (`one-palm-balance-review.json`). Current ambient-approved count:38.

Eight source-inclusive angular peak windows received individual13-frame60Hz three-view inspection (`absolute-peak-visual-review.json`).452/601 also received adjacent full-resolution peak inspection; same-skin-point seam gap is0 across all eight windows. No disconnected silhouette, so both prior approvals restored.23/24 exact geometric candidates passed normal128/quarter playback and shipping contact/joint audits, then converter exact-byte reproduction (`dance-23-24-review.json`). Ambient-approved count:42.

Bubble dance67 passed normal128px and quarter-speed five-view sheets, actual playback sequences, and three13-frame60Hz peak windows. Exact shipping replay retains267 source-planted pairs with0 missing/0 excessive drift; registry metadata and clip hashes match reviewed evidence (`visual-dance67-flex.json`). Current ambient-approved count:43.

Root individually inspected55 more normal128px five-view nine-pose sheets and4fps playback sequences for509–563 (`visual-batch-509-563-progress.json`). Bounds checks passed; quarter-speed and actual stage contact remain pending. Torch520–522 needs its prop; crawling549 and stumble519 need support verification. No ambient approvals resulted from this batch.
