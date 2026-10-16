// Deterministic reconciliation; does not permit writes.
export function reconcile(readings, options={}) {
  if (!Array.isArray(readings)||readings.length<2) return {status:'BLOCKED', reasons:['Two independent readings required']};
  const [a,b]=readings; const reasons=[]; const rows=[];
  if (!Array.isArray(a.lines)||!Array.isArray(b.lines)) return {status:'BLOCKED',reasons:['Missing lines']};
  if(a.lines.length!==b.lines.length) reasons.push('ROW_COUNT_DIFFERENCE');
  for(let i=0;i<Math.max(a.lines.length,b.lines.length);i++) {
    const x=a.lines[i],y=b.lines[i],flags=[];
    if(!x||!y) flags.push('MISSING');
    else {
      if(!x.code || String(x.code)!==String(y.code)) flags.push('CODE');
      if(!(typeof x.qty==='number'&&Number.isFinite(x.qty)&&x.qty>0&&x.qty===y.qty)) flags.push('QUANTITY');
      if(!x.description||String(x.description).trim().toUpperCase()!==String(y.description??'').trim().toUpperCase()) flags.push('DESCRIPTION');
    }
    rows.push({row:i+1,flags});
  }
  if(rows.some(x=>x.flags.length))reasons.push('ROW_DIFFERENCES');
  if(a.printedTotal!==null && a.printedTotal!==undefined && a.printedTotal!==a.lines.length) reasons.push('PRINTED_TOTAL');
  if(b.printedTotal!==null && b.printedTotal!==undefined && b.printedTotal!==b.lines.length) reasons.push('PRINTED_TOTAL_AUDIT');
  const projectValid=typeof a.project==='string' && /^PRY\d{5}$/.test(a.project) && a.project===b.project && options.projectConfirmed===true;
  if(!projectValid) reasons.push('PROJECT_UNCONFIRMED');
  if(options.geometryVerified!==true)reasons.push('GEOMETRY_NOT_VERIFIED');
  return {status:reasons.length?'HELD_AUTOMATICALLY':'DOUBLE_READ_CANDIDATE',readRows:rows.length,reasons,rows,project:projectValid?a.project:null,canWrite:false};
}