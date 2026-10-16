/* DAFRICA V4 - read-only scanned invoice/delivery note validator. */
export const STATUS={VERIFIED:'MATERIALES_VERIFICADOS_SIN_COSTES',HELD:'PENDIENTE_VERIFICACION'};
export const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().trim().replace(/\s+/g,' ');
export const ref=v=>norm(v).replace(/[^A-Z0-9]/g,'');
const qty=v=>{let s=typeof v==='string'?v.trim().replace(',','.'):v; if(typeof s==='string'&&!/^\d+(?:\.\d+)?$/.test(s))return null;const n=Number(s);return Number.isFinite(n)&&n>0?n:null};
const desc=x=>String(x?.descripcion??x?.description??'').trim();
const code=x=>ref(x?.referencia??x?.reference??'');
const quantity=x=>qty(x?.cantidad??x?.quantity);
const tokens=x=>new Set(norm(x).split(/[^A-Z0-9]+/).filter(w=>w.length>1));
const similar=(a,b)=>{const x=tokens(a),y=tokens(b);if(!x.size||!y.size)return 0;let n=0;for(const w of x)if(y.has(w))n++;return 2*n/(x.size+y.size)};
const validDate=d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(Date.parse(d))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
const uniqueKeys=items=>{const m=new Map();for(const x of items){const k=code(x)+'|'+quantity(x);m.set(k,(m.get(k)||0)+1)}return m};
const badRecipient=s=>/^(DAFRICABIERZO|DAFRICA)(SLU|SL)?$/.test(ref(s));
export function validate({primary,secondary,third=null,physical=null}={}){
 const errors=[],warnings=[],accepted=[];
 if(!primary||!secondary||!Array.isArray(primary.lineas)||!Array.isArray(secondary.lineas))return {status:STATUS.HELD,errors:['DOS_LECTURAS_NECESARIAS'],accepted:[],allowArchive:false,allowCosts:false};
 const n=ref(primary.numero),sup=ref(primary.proveedor),day=primary.fecha;
 if(!n||n!==ref(secondary.numero)||/^ABP\d{5,}$/.test(n)||(physical?.numero&&n!==ref(physical.numero)))errors.push('CABECERA_NUMERO');
 if(!sup||sup!==ref(secondary.proveedor)||badRecipient(sup)||(physical?.proveedor&&sup!==ref(physical.proveedor)))errors.push('CABECERA_PROVEEDOR');
 if(!validDate(day)||day!==secondary.fecha||(physical?.fecha&&physical.fecha!==day))errors.push('CABECERA_FECHA');
 if(!physical?.filas_verificadas||!Number.isInteger(physical.numero_filas)||physical.numero_filas!==primary.lineas.length)errors.push('GEOMETRIA_NO_VERIFICADA');
 const independent=[secondary,...(third?[third]:[])];
 if(independent.some(x=>!Array.isArray(x.lineas)||x.lineas.length!==primary.lineas.length))errors.push('RECUENTO_DISCREPANTE');
 const multiset=uniqueKeys(primary.lineas);
 for(let i=0;i<primary.lineas.length;i++){
  const row=primary.lineas[i],id=code(row),q=quantity(row),description=desc(row),fail=[],matches=[];
  if(q===null)fail.push('CANTIDAD_INVALIDA');
  if(!description)fail.push('DESCRIPCION_AUSENTE');
  if(id&&multiset.get(id+'|'+q)>1)fail.push('IDENTIDAD_REPETIDA');
  if(id){
   for(const view of independent){const found=(view.lineas||[]).filter(r=>code(r)===id);if(found.length===1&&quantity(found[0])===q)matches.push(found[0])}
   if(!matches.length)fail.push('REFERENCIA_O_CANTIDAD_SIN_CONSENSO');
  }else{
   if(!physical?.sin_codigo_permitido||independent.length<2)fail.push('ARTICULO_SIN_CODIGO_NO_CONFIRMADO');
   else{
    for(const view of independent){const found=(view.lineas||[]).filter(r=>!code(r)&&quantity(r)===q&&similar(desc(r),description)>=0.85);if(found.length===1)matches.push(found[0])}
    if(matches.length<2)fail.push('ARTICULO_SIN_CODIGO_NO_CONFIRMADO');
   }
  }
  if(!matches.length||matches.some(r=>similar(desc(r),description)<0.5))warnings.push('DESCRIPCION_DIFERENTE_FILA_'+(i+1));
  if(fail.length)errors.push(...fail.map(e=>'FILA_'+(i+1)+'_'+e));
  accepted.push({fila:i+1,referencia:String(row.referencia??''),descripcion:description,cantidad:q,
    estado:fail.length?'RETENIDO':'VERIFICADO',precio_unitario:null,estado_precio:'PENDIENTE_FACTURA'});
 }
 const ok=!errors.length&&!!accepted.length&&accepted.every(r=>r.estado==='VERIFICADO');
 return {status:ok?STATUS.VERIFIED:STATUS.HELD,numero:primary.numero,proveedor:primary.proveedor,
   fecha:day,accepted,errors:[...new Set(errors)],warnings:[...new Set(warnings)],
   allowArchive:ok,allowCosts:false,writeStel:false};
}
export function verifyStelAbp({abp,numeroProveedor,proveedor,results}={}){
 const token=ref(abp);
 if(!/^ABP\d{5,10}$/.test(token))return {verified:false,reason:'ABP_NO_CONFIABLE'};
 if(!Array.isArray(results))return {verified:false,reason:'STEL_SIN_RESPUESTA'};
 const matching=results.filter(x=>ref(x['full-reference']??x.fullReference)===token);
 if(matching.length!==1)return {verified:false,reason:'STEL_NO_UNICO'};
 const match=matching[0];
 if(!ref(match['extra-reference']??match.extraReference)||ref(match['extra-reference']??match.extraReference)!==ref(numeroProveedor))return {verified:false,reason:'NUMERO_PROVEEDOR_DIFERENTE'};
 if(!ref(match['account-name']??match['supplier-name']??match.account?.name)||ref(match['account-name']??match['supplier-name']??match.account?.name)!==ref(proveedor))return {verified:false,reason:'PROVEEDOR_DIFERENTE'};
 return {verified:true,abp:token,stelId:match.id??null,allowCosts:false,allowWorkAllocation:false};
}