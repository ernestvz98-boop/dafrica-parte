"use strict";
/*
 * Lector local de albaranes (Fase 1): uno o varios PDF de cualquier tamaño, digitales,
 * escaneados o mixtos. Todo se procesa en el navegador página a página (albaranes/lector.js):
 * separa los albaranes, muestra el avance por bloques, los errores por página y un resultado
 * consolidado que se puede descargar. No usa IA, no guarda nada y no llama a STEL.
 * La lectura de códigos manuscritos (visión de recortes) solo se activa si está configurada.
 */
(function(){
const anterior=typeof renderComprasLotePilot==="function"?renderComprasLotePilot:null;
renderComprasLotePilot=function(){
 if(anterior)anterior();
 const root=$("pcBatch");if(!root||!has("costes.ver")||$("lalCard"))return;
 const card=document.createElement("div");
 card.className="card";card.id="lalCard";
 card.innerHTML='<h3>Lector local de albaranes · sin IA · SIN GUARDAR</h3>'+
  '<p class="muted">Lee PDF digitales y escaneados de cualquier número de páginas en este navegador, separa cada albarán y comprueba cantidades, precios, descuentos, importes y totales. Solo acepta automáticamente lo que valida; lo demás queda marcado para revisión. <b>No guarda nada, no envía el PDF y no crea nada en STEL.</b></p>'+
  '<label for="lalArchivos">PDF de albaranes (uno o varios)</label>'+
  '<input type="file" id="lalArchivos" accept=".pdf,application/pdf" multiple>'+
  '<div style="display:flex;gap:8px;margin:10px 0"><button type="button" class="btn" id="lalLeer">Leer albaranes</button>'+
  '<button type="button" class="btn secondary" id="lalCancelar" disabled>Detener</button></div>'+
  '<progress id="lalBarra" max="1" value="0" style="width:100%;display:none"></progress>'+
  '<p class="muted" role="status" id="lalEstado">Selecciona uno o varios PDF.</p>'+
  '<div id="lalResumen"></div><div id="lalErrores"></div><div id="lalDocs"></div>';
 root.appendChild(card);
 const archivos=$("lalArchivos"),leer=$("lalLeer"),cancelar=$("lalCancelar"),barra=$("lalBarra"),estado=$("lalEstado");
 let detener=false,ultimo=null;
 cancelar.onclick=()=>{detener=true;estado.textContent="Deteniendo al terminar la página en curso…";};
 leer.onclick=async()=>{
  const lista=[...(archivos.files||[])];
  if(!lista.length){estado.textContent="Selecciona al menos un PDF.";return;}
  const lib=window.DafricaAlbaranes;
  if(!lib?.lector||!lib?.motorNavegador){estado.textContent="El lector no se ha cargado. Recarga la página.";return;}
  detener=false;leer.disabled=true;cancelar.disabled=false;barra.style.display="";
  $("lalResumen").innerHTML=$("lalErrores").innerHTML=$("lalDocs").innerHTML="";
  const resultado={archivos:[],documentos:[],errores:[]};
  try{
   const pdfjs=await pcLoadPdfJs();
   // Visión SOLO de recortes (manuscritos y celdas dudosas) con la sesión del usuario; su salida
   // nunca se acepta sin validar (formato, contexto, OCR, catálogo). Desactivable con config.
   const vision=lib.config?.vision===false||typeof sb!=="function"?null:
    async(recortes,{modo="manuscrito"}={})=>(await sb("/functions/v1/albaranes-manuscritos",{method:"POST",headers:{"Content-Type":"application/json"},
     body:JSON.stringify({recortes,modo}),signal:AbortSignal.timeout(70000)}))?.recortes||[];
   // Catálogo STEL de SOLO LECTURA (proveedores y artículos, sin precios): una consulta por
   // ejecución, solo en memoria. Valida CIF y referencias O/0, S/5… con coincidencia única.
   const catalogo=lib.verificacion&&typeof sb==="function"?
    await sb("/functions/v1/compras-catalogo-lectura",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}",signal:AbortSignal.timeout(65000)}).catch(()=>null):null;
   for(const [i,f] of lista.entries()){
    if(detener)break;
    const bytes=new Uint8Array(await f.arrayBuffer());
    const fuente=await lib.motorNavegador.abrirFuente(pdfjs,bytes,{alProgresar:t=>{estado.textContent=f.name+" · "+t;}});
    try{
     const r=await lib.lector.leerPdf(fuente,{registro:lib.proveedores.REGISTRO,vision,tamLote:5,cancelado:()=>detener,
      alProgresar:e=>{
       barra.max=e.total;barra.value=e.pagina||e.total;
       estado.textContent="PDF "+(i+1)+"/"+lista.length+" «"+f.name+"» · página "+(e.pagina||e.total)+"/"+e.total+
        (e.lote?" · bloque "+e.lote:"")+" · "+(resultado.documentos.length+e.documentos)+" albaranes · "+(resultado.errores.length+e.errores)+" errores";
      }});
     resultado.archivos.push({nombre:f.name,paginas:fuente.numPaginas,...r.resumen});
     for(const d of r.documentos){
      if(catalogo&&d.resultado?._ctx)lib.verificacion.verificar(d.resultado,catalogo);
      resultado.documentos.push({archivo:f.name,...d});
     }
     for(const e of r.errores)resultado.errores.push({archivo:f.name,...e});
     if(!r.resumen.paginas_completas&&!r.resumen.paginas_no_procesadas.length)resultado.errores.push({archivo:f.name,paginas:[],error:"Comprobación de páginas fallida: alguna página no está en exactamente un documento"});
    }catch(e){resultado.errores.push({archivo:f.name,paginas:[],error:String(e?.message||e)});}
    finally{await fuente.cerrar();}
    pintar(resultado);
   }
   // Coherencia de los códigos de obra entre todos los PDF leídos juntos.
   const man=resultado.documentos.map(d=>d.resultado?.manuscritos).filter(Boolean);
   if(man.length&&lib.manuscritos)lib.manuscritos.coherenciaLote(man);
   ultimo=resultado;pintar(resultado);
   estado.textContent=(detener?"Lectura detenida. ":"Lectura terminada. ")+resultado.documentos.length+" albaranes en "+resultado.archivos.length+" PDF.";
  }catch(e){estado.textContent="No se ha podido leer: "+(e?.message||e);}
  finally{leer.disabled=false;cancelar.disabled=true;barra.style.display="none";}
 };
 function pintar(r){
  const n=e=>r.documentos.filter(d=>d.estado_documento===e).length;
  const ETIQ={AUTO_OK:"AUTO_OK · verificado",REVISAR:'<span class="error">REVISAR</span>',ERROR_DOCUMENTO:'<b class="error">ERROR_DOCUMENTO</b>'};
  $("lalResumen").innerHTML='<p><b>'+esc(r.documentos.length)+'</b> documentos: <b>'+esc(n("AUTO_OK"))+'</b> AUTO_OK · <b>'+
   esc(n("REVISAR"))+'</b> REVISAR · <b>'+esc(n("ERROR_DOCUMENTO"))+'</b> ERROR_DOCUMENTO</p>'+
   (r.documentos.length?'<p><button type="button" class="btn secondary" id="lalJson">Descargar resultado (JSON)</button> '+
    '<button type="button" class="btn secondary" id="lalCsv">Descargar líneas (CSV)</button></p>':'')+
   '<div class="table-wrap" style="overflow:auto;max-height:420px"><table><thead><tr><th>#</th><th>PDF · páginas</th><th>Proveedor</th><th>Número</th><th>Fecha</th><th>Líneas</th><th>Total</th><th>Obra (manuscrito)</th><th>Estado</th></tr></thead><tbody>'+
   r.documentos.map((d,i)=>{const x=d.resultado||{},o=x.manuscritos?.obra;
    return '<tr><td>'+(i+1)+'</td><td>'+esc(d.archivo)+' · '+esc(d.paginas.join(", "))+'</td><td>'+esc(x.proveedor?.nombre||x.proveedor?.nif||"—")+'</td><td>'+
     esc(x.numero?.valor||"—")+'</td><td>'+esc(x.fecha?.valor||"—")+'</td><td>'+esc((x.lineas||[]).length)+'</td><td>'+esc(x.totales?.total?.literal||"—")+'</td><td>'+
     esc(o?.valor?(o.valor+(o.estado==="OK"?"":" (a revisar)")):"—")+'</td><td>'+(ETIQ[d.estado_documento]||esc(d.estado_documento))+(d.error?' · '+esc(d.error):'')+'</td></tr>';}).join("")+
   '</tbody></table></div>';
  $("lalErrores").innerHTML=r.errores.length?'<details open><summary>'+esc(r.errores.length)+' error(es) de lectura</summary>'+
   r.errores.map(e=>'<p class="error">'+esc(e.archivo)+(e.paginas?.length?' · páginas '+esc(e.paginas.join(", ")):'')+': '+esc(e.error)+'</p>').join("")+'</details>':"";
  $("lalDocs").innerHTML=r.documentos.map((d,i)=>!d.resultado?'':'<details style="border:1px solid #d6dee8;border-radius:8px;padding:10px;margin:8px 0"><summary style="cursor:pointer;font-weight:bold">'+
   (i+1)+' · '+esc(d.resultado?.proveedor?.nombre||"Proveedor no identificado")+' · '+esc(d.resultado?.numero?.valor||"sin número")+'</summary>'+pcRenderDeterminista(d.resultado)+'</details>').join("");
  const j=$("lalJson"),c=$("lalCsv");
  if(j)j.onclick=()=>descargar("albaranes.json","application/json",JSON.stringify(r,null,1));
  if(c)c.onclick=()=>descargar("albaranes-lineas.csv","text/csv;charset=utf-8",csv(r));
 }
 function csv(r){
  const q=v=>{const s=v==null?"":String(v);return /[";\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;};
  const filas=[["pdf","paginas","proveedor","nif","numero","fecha","obra","referencia","descripcion","cantidad","unidad","precio","estado_precio","descuento","importe","estado_linea"]];
  for(const d of r.documentos){const x=d.resultado||{};
   for(const l of x.lineas||[])filas.push([d.archivo,d.paginas.join(" "),x.proveedor?.nombre,x.proveedor?.nif,x.numero?.valor,x.fecha?.valor,x.manuscritos?.obra?.estado==="OK"?x.manuscritos.obra.valor:"",
    l.referencia?.valor,l.descripcion?.valor,l.cantidad?.valor,l.unidad?.valor,l.precio?.valor,l.precio?.valor==null?"precio_pendiente":"",
    l.descuento?.porcentajes?.join("+"),l.importe?.valor,l.estado]);}
  return "﻿"+filas.map(f=>f.map(q).join(";")).join("\n");
 }
 function descargar(nombre,tipo,texto){
  const url=URL.createObjectURL(new Blob([texto],{type:tipo}));
  const a=document.createElement("a");a.href=url;a.download=nombre;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
};
})();
