"use strict";
/* Orquestación temporal. El solapamiento es evidencia de continuidad, nunca se
 * deduplica por número (dos documentos distintos pueden compartirlo). */
(function(root,factory){
 const api=factory();
 if(typeof module==="object"&&module.exports)module.exports=api;
 else {root.DafricaAlbaranes=root.DafricaAlbaranes||{};root.DafricaAlbaranes.lotesPdf=api;}
})(globalThis,function(){
 function base64(bytes){
  let s="";for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));
  return btoa(s);
 }
 async function procesar({PDFDocument,bytes,separar,interpretar,refinar=null,progreso=()=>{},alResultado=()=>{},liberar=async()=>{}}){
  const pdf=await PDFDocument.load(bytes),total=pdf.getPageCount(),grupos=[],fallos=[];
  const extraer=async paginas=>{
   const tmp=await PDFDocument.create();
   for(const p of await tmp.copyPages(pdf,paginas.map(n=>n-1)))tmp.addPage(p);
   return base64(await tmp.save());
  };
  for(let inicio=1;inicio<=total;inicio+=9){
   const fin=Math.min(inicio+9,total),mensaje=`Procesando páginas ${inicio}–${fin} de ${total}`;
   progreso(mensaje);
   try{
    const data=await extraer(Array.from({length:fin-inicio+1},(_,i)=>inicio+i));
    const split=await separar(data,{inicio,fin,total});
    const docs=split.documentos,map=docs?.flatMap(d=>d.paginas||[]);
    if(!docs?.length||split.paginas_pdf!==fin-inicio+1||map.length!==fin-inicio+1||
       new Set(map).size!==map.length||map.some(p=>!Number.isInteger(p)||p<1||p>fin-inicio+1)||
       docs.some(d=>!d.paginas?.length))throw Error("El separador encontró páginas repetidas o sin asignar");
    // Validar todo el bloque antes de modificar lo acumulado.
    const siguientes=grupos.map(g=>({...g,paginas:[...g.paginas]}));
    for(const d of docs){
     const paginas=d.paginas.map(p=>p+inicio-1).sort((a,b)=>a-b);
     const coinciden=siguientes.filter(g=>g.paginas.some(p=>paginas.includes(p)));
     const identidad=x=>String(x.numero||"").trim().toUpperCase();
     if(coinciden.length>1||coinciden.some(g=>identidad(g)&&identidad(d)&&identidad(g)!==identidad(d)))
      throw Error("Separación contradictoria en la página compartida; no se acepta automáticamente");
     const union=[...new Set([...paginas,...coinciden.flatMap(g=>g.paginas)])].sort((a,b)=>a-b);
     const meta={...d};delete meta.pdf_separado_b64;
     for(const g of coinciden)siguientes.splice(siguientes.indexOf(g),1);
     siguientes.push({...meta,paginas:union});
    }
    grupos.splice(0,grupos.length,...siguientes);
   }catch(e){fallos.push({inicio,fin,error:String(e?.message||e)});}
   finally{await liberar();}
   if(fin===total)break;
  }
  grupos.sort((a,b)=>a.paginas[0]-b.paginas[0]);
  const cubiertas=new Set(grupos.flatMap(g=>g.paginas));
  const faltantes=Array.from({length:total},(_,i)=>i+1).filter(p=>!cubiertas.has(p));
  if(refinar){
   const revisados=[];
   for(const d of grupos){
    if(d.paginas.length===1){revisados.push(d);continue;}
    progreso(`Comprobando separación de páginas ${d.paginas.join(", ")} de ${total}`);
    try{
     d.pdf_separado_b64=await extraer(d.paginas);
     const partes=await refinar(d),map=partes?.flatMap(p=>p.paginas||[]);
     if(!partes?.length||partes.some(p=>!p.paginas?.length)||map.length!==d.paginas.length||new Set(map).size!==map.length||
        [...map].sort((a,b)=>a-b).some((p,i)=>p!==d.paginas[i]))throw Error("Refinamiento con páginas repetidas o sin asignar");
     for(const p of partes){delete p.pdf_separado_b64;revisados.push(p);}
    }catch(e){const copia={...d,separacion_local_dudosa:true,error_separacion:String(e?.message||e)};delete copia.pdf_separado_b64;revisados.push(copia);}
    finally{delete d.pdf_separado_b64;await liberar();}
   }
   grupos.splice(0,grupos.length,...revisados.sort((a,b)=>a.paginas[0]-b.paginas[0]));
  }
  const out=[];
  for(const [index,d] of grupos.entries()){
   progreso(`Interpretando documento ${index+1} de ${grupos.length} · páginas ${d.paginas.join(", ")} de ${total}`);
   let r;
   // Una frontera fallida puede ocultar una continuación: nunca aceptar como completo.
   if(fallos.some(f=>d.paginas.some(p=>p>=f.inicio-1&&p<=f.fin+1)))
    r={error:"Separación incompleta junto a un bloque fallido; no se acepta este documento como completo"};
   else try{
    d.pdf_separado_b64=await extraer(d.paginas);
    r=await interpretar(d,index,grupos.length);
   }catch(e){r={error:String(e?.message||e)};}
   finally{delete d.pdf_separado_b64;await liberar();}
   out.push(r);alResultado(r,d,index);
  }
  return {documentos:grupos,out,fallos,paginas_pdf:total,paginas_pendientes:faltantes};
 }
 // Conserva el PDF original: solo rota una copia temporal para la lectura
 // geométrica/IA. Las orientaciones proceden del OCR local, no de una suposición.
 async function enderezar(PDFDocument,encoded,orientacion=[]){
  const giros=orientacion.filter(o=>o.grados);
  if(!giros.length)return encoded;
  const raw=atob(encoded),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
  const pdf=await PDFDocument.load(bytes),vistas=new Set();
  for(const o of giros){
   if(!Number.isInteger(o.pagina)||o.pagina<1||o.pagina>pdf.getPageCount()||
      ![90,180,270].includes(o.grados)||vistas.has(o.pagina))throw Error("Orientación OCR no válida");
   vistas.add(o.pagina);
   const p=pdf.getPage(o.pagina-1);
   p.setRotation({type:"degrees",angle:(p.getRotation().angle+o.grados)%360});
  }
  return base64(await pdf.save());
 }
 function dividirPorCabeceras(doc,cabeceras){
  const firmes=cabeceras.length===doc.paginas.length&&cabeceras.every((h,i)=>h.pagina===i+1&&h.titulo&&
   h.numero?.estado==="OK"&&h.numero.confianza>=0.8&&h.numero.valor&&h.fecha?.valor&&
   !/^(19|20)\d{2}$/.test(h.numero.valor));
  if(!firmes)return [{...doc,separacion_local_dudosa:true}];
  const grupos=[];
  for(const [i,h] of cabeceras.entries()){
   let g=grupos.at(-1);
   const nif=h.proveedor?.nif||null;
   if(!g||g.numero!==h.numero.valor||g.fecha!==h.fecha.valor||(nif&&g.proveedor_nif&&nif!==g.proveedor_nif)){
    g={...doc,numero:h.numero.valor,fecha:h.fecha.valor,proveedor_nif:nif,paginas:[]};delete g.pdf_separado_b64;grupos.push(g);
   }else if(!nif||!g.proveedor_nif){
    g.separacion_local_dudosa=true;
   }
   g.paginas.push(doc.paginas[i]);
  }
  return grupos;
 }
 return {procesar,enderezar,dividirPorCabeceras};
});
