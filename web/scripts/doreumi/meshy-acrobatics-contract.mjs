import { createHash } from 'node:crypto';

const sha = value => createHash('sha256').update(value).digest('hex');
const CONTRACTS = new Map([[406, Object.freeze({
  version: 1,
  actionId: 406,
  sourceSha256: 'f0b484f4bf1fe3f7113cd0be005e6306c5cc6a908e88b3e17088a41ea1aa77ba',
  masterSha256: 'ff950b38e254c5a92c4d198bc333cf9b5763883f5f824de06b8c688019f0afa1',
  convertedSha256: '42bfddc199c332a2ee2ce4076d5aaa140bd950b8f7e1e14e9664c5dfc52e076e',
  metadataSha256: '86e6114745b016132f9e1c05151cae0468d9ecad02e6a274a4b2721478cad34d',
})], [502, Object.freeze({
  version: 2,
  actionId: 502,
  sourceSha256: 'd4eeaeea8e16dc1ec703aeb13f42eaf7fd638923258ef4923efdd5efa847990b',
  masterSha256: 'ff950b38e254c5a92c4d198bc333cf9b5763883f5f824de06b8c688019f0afa1',
  convertedSha256: 'c1a29fe35a74c0e51b563c5d16accfb4102d20b956925451347ccfdaea7b4ba0',
  metadataSha256: '975df32b338de07f985b7a5b9f7e61cb8148861f8db8472379615491d5efb9f0',
})]]);

const METADATA_FIELDS = ['targetRigSignature', 'duration', 'sourceDuration', 'entryDuration', 'exitDuration',
  'bounds', 'framing', 'planarSupport', 'acrobatics', 'semantics', 'transitions', 'floorTransitions', 'rootPolicy'];
const AIRBORNE_FIELDS = ['duration', 'entryDuration', 'exitDuration', 'sourceDuration', 'playbackSourceDuration',
  'sourceTimeScale', 'framing', 'airborneFall'];

/** Preserve the exact clip and support metadata independently reviewed in the renderer. */
export function loadAcrobaticsContract({ actionId, sourceSha256, masterSha256 }) {
  const contract = CONTRACTS.get(actionId);
  if (!contract) return undefined;
  if (sourceSha256 !== contract.sourceSha256 || masterSha256 !== contract.masterSha256)
    throw new Error(`Acrobatics ${actionId} source or master changed; a new review is required.`);
  return contract;
}

export function validateAcrobaticsOutput(contract, json, evidence) {
  if (CONTRACTS.get(contract?.actionId) !== contract) throw new Error('Unknown acrobatics replay contract.');
  const convertedSha256 = sha(JSON.stringify(json) + '\n');
  const fields = contract.actionId === 502 ? AIRBORNE_FIELDS : METADATA_FIELDS;
  const metadataSha256 = sha(JSON.stringify(Object.fromEntries(fields.map(key => [key, evidence[key]]))));
  if (convertedSha256 !== contract.convertedSha256 || metadataSha256 !== contract.metadataSha256)
    throw new Error(`Acrobatics ${contract.actionId} no longer reproduces its reviewed clip or support metadata; output was not written.`);
  return { version: contract.version, convertedSha256, metadataSha256 };
}
