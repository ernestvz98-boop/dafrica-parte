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
 * En STEL un proveedor puede estar duplicado en una cuenta SIN CIF (fallo real 2026-10-22: las
 * compras de un proveedor estaban en una cuenta sin CIF y la de su CIF no tenía ninguna). Sin
 * ninguno en la cuenta del CIF, se acepta el de una cuenta sin CIF válido (nunca la de otro CIF)
 * solo con un número largo (5+), la misma fecha y si es el ÚNICO de STEL con ese número en el título.
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
 * {buscar}). cuentasSinCif: Set de ids de cuentas de STEL sin CIF válido (catálogo completo de
 * proveedores) o null. Devuelve {resueltos, numeros, conflictos, sin_cif}.
 */
function resolver(docs,notas,{cuentasSinCif=null}={}){
 const res={resueltos:0,numeros:0,conflictos:0,sin_cif:0};
 const elegidos=[];
 const conNumero=num=>(notas||[]).filter(n=>partesTitulo(n.title).palabras.includes(num));
 for(const d of docs){
  const r=d.resultado;if(!r||r.proveedor?.estado!=="OK")continue;
  const cuenta=r.proveedor.account_id??null;
  const num=canon(r.numero?.valor),fecha=aceptado(r.fecha)?r.fecha.valor:null;
  if(num.length<4||!fecha)continue;
  const mismaFecha=n=>dia(n.date)===fecha||partesTitulo(n.title).fecha===fecha;
  let cands=cuenta!=null?conNumero(num).filter(n=>String(n.accountId)===String(cuenta)):[],sinCif=false;
  if(!cands.length&&cuentasSinCif&&num.length>=5){
   const todos=conNumero(num);
   if(todos.length===1&&cuentasSinCif.has(String(todos[0].accountId))){cands=todos;sinCif=true;}
  }
  if(cands.length!==1)continue;
  const n=cands[0],t=partesTitulo(n.title),abp=formatoAbp(n.fullReference);
  if(!abp||!mismaFecha(n))continue;
  elegidos.push({r,n,abp,t,sinCif});
 }
 // Un mismo albarán de STEL para dos albaranes leídos: ninguno.
 const usos=new Map();for(const e of elegidos)usos.set(e.abp,(usos.get(e.abp)||0)+1);
 for(const e of elegidos){
  const {r,n,abp,t,sinCif}=e;
  if(usos.get(abp)>1){res.conflictos++;continue;}
  const ev="Albarán de compra STEL "+n.fullReference+" (solo lectura): "+(sinCif?"cuenta de STEL sin CIF (el único albarán de STEL con ese número)":"cuenta del proveedor verificada")+
   ", número «"+r.numero.valor+"» en su título y fecha "+r.fecha.valor+(t.obra?"; obra en STEL «"+t.obra+"»":"");
  const m=r.manuscritos?.stel;
  if(m&&aceptado(m)&&canon(m.valor)!==canon(abp)){
   // La letra a mano (validada por otra vía) dice otro ABP: a revisión, sin elegir.
   r.manuscritos.stel={...m,estado:"REVISAR",confianza:0.5,motivos:[...(m.motivos||[]),"El albarán de compra de STEL con este número es "+abp+", distinto del escrito a mano"]};
   r.albaran_stel={fullReference:n.fullReference,abp,id:n.id,obra:t.obra,estado:"CONFLICTO",evidencias:[ev]};
   res.conflictos++;continue;
  }
  r.albaran_stel={fullReference:n.fullReference,abp,id:n.id,cuenta:n.accountId??null,sin_cif:sinCif,obra:t.obra,estado:"OK",evidencias:[ev]};
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
  res.resueltos++;if(sinCif)res.sin_cif++;
 }
 return res;
}

/*
 * Identidad del albarán de compra de STEL al final de la lectura: un mismo albarán de STEL (por su
 * id o por su ABP), aceptado para DOS o más albaranes leídos, es un error de identidad (una cifra
 * mal leída, un mismo día con varios albaranes…) que provocaría asociaciones equivocadas o
 * duplicados. Ninguno se acepta: todos a revisión, con el motivo. docs: [{resultado}] (se modifican).
 * Devuelve el número de albaranes leídos afectados.
 */
function conflictosIdentidad(docs){
 const claves=new Map();
 const anotar=(k,i)=>{if(!k)return;if(!claves.has(k))claves.set(k,new Set());claves.get(k).add(i);};
 docs.forEach((d,i)=>{
  const r=d?.resultado;if(!r)return;
  const a=r.albaran_stel;
  if(a&&a.estado==="OK"){anotar(a.id!=null?"id:"+a.id:null,i);anotar(canon(a.abp||a.fullReference)?"abp:"+canon(a.abp||a.fullReference):null,i);}
  const m=r.manuscritos?.stel;
  if(aceptado(m)){anotar(canon(m.valor)?"abp:"+canon(m.valor):null,i);anotar(m.resolucion?.id_stel!=null?"id:"+m.resolucion.id_stel:null,i);}
 });
 const afectados=new Set();
 for(const [k,s] of claves)if(s.size>1)for(const i of s)afectados.add(i+"|"+k);
 const porDoc=new Map();
 for(const x of afectados){const [i,k]=x.split("|");if(!porDoc.has(+i))porDoc.set(+i,[]);porDoc.get(+i).push(k);}
 for(const [i,ks] of porDoc){
  const r=docs[i].resultado,otros=new Set();
  for(const k of ks)for(const j of claves.get(k))if(j!==i)otros.add(docs[j].resultado?.numero?.valor||"#"+(j+1));
  const motivo="El mismo albarán de compra de STEL quedaba asociado también a "+[...otros].join(", ")+": identidad sin resolver";
  if(r.albaran_stel?.estado==="OK")r.albaran_stel={...r.albaran_stel,estado:"CONFLICTO",motivos:[...(r.albaran_stel.motivos||[]),motivo]};
  const m=r.manuscritos?.stel;
  if(aceptado(m))r.manuscritos.stel={...m,estado:"REVISAR",confianza:0.5,motivos:[...(m.motivos||[]),motivo]};
 }
 return porDoc.size;
}

/*
 * La búsqueda de la lectura: una en TODAS las cuentas. STEL corta con «403»/«429» tras muchas
 * consultas seguidas y al rato vuelve a responder (21-23/10/2026): un único reintento tras una
 * espera. Si no termina por larga (fechas muy separadas), por cuenta. buscar(b) pide {buscar: b} a
 * stel-albaranes-consulta. Devuelve {resp, todas, intentos, sin_cupo}: sin_cupo = STEL no respondió.
 */
const sinCupo=r=>!r?.completo&&/^STEL (403|429|5\d\d)$/.test(String(r?.motivo||""));
async function buscarNotasLectura(buscar,q,{espera=60000,esperar=ms=>new Promise(ok=>setTimeout(ok,ms)),detenido=()=>false,alEsperar=null}={}){
 const intentos=[];
 const pedir=async(b,cuentas)=>{const r=await buscar(b);
  intentos.push({cuentas,completo:!!r?.completo,consultas:r?.consultas??null,motivo:r?.motivo||null});return r;};
 const todasLasCuentas={cuentas:[],desde:q.desde,hasta:q.hasta};
 let resp=await pedir(todasLasCuentas,"todas"),todas=true;
 if(sinCupo(resp)&&!detenido()){
  if(typeof alEsperar==="function")alEsperar(espera);
  await esperar(espera);
  if(!detenido())resp=await pedir(todasLasCuentas,"todas");
 }
 if(!resp?.completo&&resp?.motivo==="limite_paginas"&&q.cuentas.length&&!detenido()){resp=await pedir(q,q.cuentas.length);todas=false;}
 return {resp,todas,intentos,sin_cupo:sinCupo(resp)};
}

/* Cuentas de STEL sin CIF demostradas de cada proveedor por los albaranes resueltos en ellas. */
const claveProveedor=r=>r?.proveedor?.id!=null?"id:"+r.proveedor.id:r?.proveedor?.nif?"nif:"+canon(r.proveedor.nif):null;
function cuentasSinCifPorProveedor(docs){
 const out=new Map();
 for(const d of docs){const r=d.resultado,k=claveProveedor(r);
  if(k&&r.albaran_stel?.estado==="OK"&&r.albaran_stel.sin_cif&&r.albaran_stel.cuenta!=null){
   if(!out.has(k))out.set(k,new Set());out.get(k).add(String(r.albaran_stel.cuenta));}}
 return out;
}

/*
 * Intervalo de fechas de los albaranes leídos (proveedor identificado y fecha aceptada) y cuentas de
 * STEL de sus CIF. La búsqueda principal es en todas las cuentas: también vale para un proveedor sin
 * cuenta con su CIF en STEL.
 */
function consulta(docs,{margen=10}={}){
 const cuentas=new Set(),fechas=[];
 for(const d of docs){const r=d.resultado;
  if(r?.proveedor?.estado!=="OK"||!aceptado(r.fecha))continue;
  fechas.push(r.fecha.valor);
  if(r.proveedor.account_id!=null)cuentas.add(Number(r.proveedor.account_id));}
 if(!fechas.length)return null;
 fechas.sort();
 const mover=(f,d)=>new Date(Date.parse(f)+d*864e5).toISOString().slice(0,10);
 let desde=mover(fechas[0],-margen),hasta=mover(fechas.at(-1),margen);
 if(Date.parse(hasta)-Date.parse(desde)>400*864e5)desde=mover(hasta,-400);
 return {cuentas:[...cuentas].slice(0,40),desde,hasta};
}
return {resolver,consulta,buscarNotasLectura,conflictosIdentidad,sinCupo,cuentasSinCifPorProveedor,claveProveedor,partesTitulo,formatoAbp};
});
