import { createHash } from 'node:crypto';

/** Review identity includes the fixed support geometry as well as the clip. */
export function motionMetadataSha256(imported) {
  const evidence = imported.retargetEvidence;
  return createHash('sha256').update(JSON.stringify({
    frame: evidence?.framing, semantics: evidence?.semantics,
    planarSupport: evidence?.planarSupport, entryDuration: evidence?.entryDuration,
    exitDuration: evidence?.exitDuration, sourceQuality: imported.sourceQuality,
    environmentSupport: evidence?.environmentSupport,
  })).digest('hex');
}
