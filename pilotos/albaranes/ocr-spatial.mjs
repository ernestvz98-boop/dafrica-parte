// DAFRICA Control — coordinate-aware OCR checker.
// Only flags suspicious rows. It never imputes a missing quantity from a neighbor.
const median=a=>{const s=[...a].sort((a,b)=>a-b),m=Math.floor(s.length/2);return s.length?(s.length%2?s[m]:(s[m-1]+s[m])/2):0};
export function reconcileOcrCoordinates(words,profile={}){
 const {referenceLeft=[65,110],quantityLeft=[1130,1290],minReferenceLength=10,minConfidence=65,maxDistanceFraction=.42}=profile;
 if(!Array.isArray(words))throw Error("Expected OCR words array");
 const t=w=>String(w?.text??"").trim(),x=w=>Number(w?.left),y=w=>Number(w?.top);
 const inColumn=(w,c)=>Number.isFinite(x(w))&&x(w)>=c[0]&&x(w)<=c[1];
 const codeRe=new RegExp("^\\d{"+minReferenceLength+"}$");
 const references=words.filter(w=>inColumn(w,referenceLeft)&&codeRe.test(t(w))).sort((a,b)=>y(a)-y(b));
 const possible=words.filter(w=>inColumn(w,quantityLeft)&&/^\d+[.,]\d{2,4}\D?$/.test(t(w))).sort((a,b)=>y(a)-y(b));
 const spacing=median(references.slice(1).map((v,i)=>y(v)-y(references[i])).filter(v=>v>0));
 const maxGap=spacing?spacing*maxDistanceFraction:14,used=new Set();
 const lines=references.map((ref,i)=>{
  const candidates=possible.map((w,k)=>({w,k,gap:Math.abs(y(w)-y(ref))})).filter(v=>v.gap<=maxGap&&!used.has(v.k)).sort((a,b)=>a.gap-b.gap);
  const match=candidates[0];if(match)used.add(match.k);
  const raw=match?t(match.w):"",flags=[];
  if(Number(ref.conf)<minConfidence)flags.push("LOW_REFERENCE_CONFIDENCE");
  if(!match)flags.push("QUANTITY_NOT_FOUND_IN_ROW");
  else if(!/^\d+,\d{2}$/.test(raw))flags.push("INVALID_QUANTITY_FORMAT");
  else if(Number(raw.replace(",","."))<=0)flags.push("INVALID_QUANTITY");
  if(candidates.length>1)flags.push("MULTIPLE_QUANTITY_CANDIDATES");
  return {row:i+1,reference:t(ref),y:y(ref),quantity:flags.some(f=>f==="QUANTITY_NOT_FOUND_IN_ROW"||f==="INVALID_QUANTITY_FORMAT"||f==="INVALID_QUANTITY")?null:Number(raw.replace(",",".")),rawQuantity:raw||null,confidence:Number(ref.conf),flags};
 });
 return {detectedReferences:references.length,rowsWithValidQuantities:lines.filter(v=>v.quantity!==null).length,flaggedRows:lines.filter(v=>v.flags.length).map(v=>v.row),medianRowSpacing:spacing,unassignedQuantityTokens:possible.filter((_,i)=>!used.has(i)).map(w=>({text:t(w),y:y(w)})),lines,safeForPosting:false};
}
