import assert from "node:assert/strict";
import {reconcileOcrCoordinates} from "./ocr-spatial.mjs";
const data=[];
for(let i=1;i<=25;i++){
 const y=100+i*38;
 data.push({text:String(i).padStart(10,"0"),left:83,top:y,conf:"95"});
 data.push({text:i===14?"2,001":"2,00",left:1227,top:y,conf:i===14?"48":"95"});
}
const got=reconcileOcrCoordinates(data);
assert.equal(got.detectedReferences,25);
assert.equal(got.rowsWithValidQuantities,24);
assert.deepEqual(got.flaggedRows,[14]);
assert.equal(got.lines[13].quantity,null);
assert.equal(got.lines[13].rawQuantity,"2,001");
assert.equal(got.lines[14].quantity,2);
assert.equal(got.safeForPosting,false);
console.log("PASS: row 14 automatically isolated, no fabricated amount.");
