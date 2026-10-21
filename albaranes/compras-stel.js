"use strict";
/*
 * DAFRICA · Albarán de compra de STEL (SOLO LECTURA) de cada albarán leído, sin depender de la
 * letra a mano. En STEL el título del albarán de compra lleva el número del albarán del proveedor,
 * la fecha y la obra («123.456 03/03/2026 OBRA FICTICIA»; medido sobre los albaranes reales, 2026-10-21).
 *
 * Se acepta solo con evidencia independiente: la cuenta de STEL del proveedor (verificada por su
 * CIF en el catálogo), el número del albarán del proveedor como palabra del título de UN ÚNICO
 * albarán de compra de esa cuenta, y la misma fecha (la del albarán de STEL o la de su título).
 * Si el número del papel estaba en revisión y coincide así, también queda confirmado. Si dos
 * albaranes leídos apuntan al mismo de STEL, o la letra a mano dice otro ABP validado, nada se
 * acepta por esta vía.
 */
(function(root,factory){
 const api=factory(root);
 if(typeof module==="object"&&module.exports)module.exports=api;
 else{root.DafricaAlbaranes=root.DafricaAlbaranes||{};root.DafricaAlbaranes.comprasStel=api;}
})(typeof globalThis!=="undefined"?globalThis:this,function(){
const canon=t=>String(t??"").toUpperCase().replace(/[^A-Z0-9]/g,"");
const dia=v=>String(v||"").slice(0,10);
const aceptado=c=>c?.estado==="OK"&&(c.confianza??0)>=0.9;
const RE_FECHA=/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/;

/* Fecha del título («03/03/2026» → «2026-03-03») y texto de obra que la sigue. */
function partesTitulo(t){
 const s=String(t||""),m=s.match(RE_FECHA);
 const fecha=m?m[3]+"-"+m[2].padStart(2,"0")+"-"+m[1].padStart(2,"0"):null;
 const obra=m?s.slice(m.index+m[0].length).replace(/\s+/g," ").trim():"";
 return {fecha,obra,palabras:s.split(/\s+/).map(canon).filter(Boolean)};
}
// ABP de STEL («ABP261234» o «ABP26-1234») con el formato del lector («ABP26-1234»).
function formatoAbp(ref){const c=canon(ref);return /^ABP\d{6}$/.test(c)?c.slice(0,5)+"-"+c.slice(5):null;}

/*
 * docs: [{resultado}] (se modifican). notas: albaranes de compra de STEL (stel-albaranes-consulta
 * {buscar}). Devuelve {resueltos, numeros, conflictos}.
 */
function resolver(docs,notas){
 const res={resueltos:0,numeros:0,conflictos:0};
 const elegidos=[];
 for(const d of docs){
  const r=d.resultado;if(!r)continue;
  const cuenta=r.proveedor?.estado==="OK"?r.proveedor.account_id:null;
  const num=canon(r.numero?.valor),fecha=aceptado(r.fecha)?r.fecha.valor:null;
  if(cuenta==null||num.length<4||!fecha)continue;
  const cands=(notas||[]).filter(n=>String(n.accountId)===String(cuenta)&&partesTitulo(n.title).palabras.includes(num));
  if(cands.length!==1)continue;
  const n=cands[0],t=partesTitulo(n.title),abp=formatoAbp(n.fullReference);
  if(!abp||(dia(n.date)!==fecha&&t.fecha!==fecha))continue;
  elegidos.push({r,n,abp,t});
 }
 // Un mismo albarán de STEL para dos albaranes leídos: ninguno.
 const usos=new Map();for(const e of elegidos)usos.set(e.abp,(usos.get(e.abp)||0)+1);
 for(const e of elegidos){
  const {r,n,abp,t}=e;
  if(usos.get(abp)>1){res.conflictos++;continue;}
  const ev="Albarán de compra STEL "+n.fullReference+" (solo lectura): cuenta del proveedor verificada, número «"+r.numero.valor+
   "» en su título y fecha "+r.fecha.valor+(t.obra?"; obra en STEL «"+t.obra+"»":"");
  const m=r.manuscritos?.stel;
  if(m&&aceptado(m)&&canon(m.valor)!==canon(abp)){
   // La letra a mano (validada por otra vía) dice otro ABP: a revisión, sin elegir.
   r.manuscritos.stel={...m,estado:"REVISAR",confianza:0.5,motivos:[...(m.motivos||[]),"El albarán de compra de STEL con este número es "+abp+", distinto del escrito a mano"]};
   r.albaran_stel={fullReference:n.fullReference,abp,id:n.id,obra:t.obra,estado:"CONFLICTO",evidencias:[ev]};
   res.conflictos++;continue;
  }
  r.albaran_stel={fullReference:n.fullReference,abp,id:n.id,obra:t.obra,estado:"OK",evidencias:[ev]};
  if(!aceptado(r.numero)){
   r.numero={...r.numero,estado:"OK",confianza:0.95,motivos:[],
    resolucion:{...(r.numero.resolucion||{}),metodo:"albaran_stel_titulo",evidencias:[...(r.numero.resolucion?.evidencias||[]),ev]}};
   res.numeros++;
  }
  if(r.manuscritos){
   const previo=r.manuscritos.stel||{};
   r.manuscritos.stel=aceptado(previo)?{...previo,resolucion:{...previo.resolucion,evidencias:[...(previo.resolucion?.evidencias||[]),ev]}}:
    {valor:abp,literal:previo.literal||"",estado:"OK",confianza:0.95,motivos:[],
     resolucion:{metodo:"albaran_stel_por_numero",evidencias:[...(previo.literal?["Escrito a mano: «"+previo.literal+"»"]:[]),ev],alternativas:previo.resolucion?.alternativas||[]}};
  }
  res.resueltos++;
 }
 return res;
}

/* Intervalo de fechas y cuentas que hay que pedir a STEL para los albaranes leídos. */
function consulta(docs,{margen=10}={}){
 const cuentas=new Set(),fechas=[];
 for(const d of docs){const r=d.resultado;
  if(r?.proveedor?.estado==="OK"&&r.proveedor.account_id!=null&&aceptado(r.fecha)){cuentas.add(Number(r.proveedor.account_id));fechas.push(r.fecha.valor);}}
 if(!cuentas.size)return null;
 fechas.sort();
 const mover=(f,d)=>new Date(Date.parse(f)+d*864e5).toISOString().slice(0,10);
 let desde=mover(fechas[0],-margen),hasta=mover(fechas.at(-1),margen);
 if(Date.parse(hasta)-Date.parse(desde)>400*864e5)desde=mover(hasta,-400);
 return {cuentas:[...cuentas].slice(0,40),desde,hasta};
}
return {resolver,consulta,partesTitulo,formatoAbp};
});
