export function normalizeSelection(value={},catalog,candidateMode=false){
 const s={expression:catalog.expressions.some(a=>a.id===value.expression)?value.expression:'neutral',head:null,hand:null,action:'Idle',season:'none',effect:'navy'};
 for(const slot of ['head','hand']){const p=catalog.props.find(a=>a.id===value[slot]&&a.slot===slot);if(p&&(p.sourceApproval==='approved'||candidateMode)&&p.attachmentStatus!=='blocked')s[slot]=p.id;}return s;
}
export function createLatestSelection({load,apply,dispose=()=>{}}){let generation=0,selected=null,closed=false;return {get selected(){return selected;},cancel(){generation++;},dispose(){closed=true;generation++;},async select(id){if(closed)throw new Error('disposed');const ticket=++generation;const value=await load(id);if(ticket!==generation||closed){dispose(value);return false;}try{apply(value,id);selected=id;return true;}catch(e){dispose(value);throw e;}}};}
export function createSequenceController(){let generation=0;return {cancel(){generation++;},async run(steps){const ticket=++generation;for(const step of steps){if(ticket!==generation)return false;await step();}return ticket===generation;}};}
