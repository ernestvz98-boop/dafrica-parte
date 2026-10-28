"use strict";
/*
 * Módulo «Lector de albaranes» de DAFRICA Control (Fase 1), en el menú lateral (permiso
 * costes.ver). Uno o varios PDF de cualquier tamaño, digitales, escaneados o mixtos, leídos en el
 * navegador página a página (albaranes/lector.js): separa los albaranes, muestra el avance por
 * bloques, los errores por página y un resultado consolidado que se puede descargar. No guarda nada
 * ni envía el PDF. Segunda fase: visión solo de RECORTES dudosos (siempre validada) y catálogo STEL
 * solo en lectura, con la sesión del usuario.
 */
(function(){
const MODULO={id:"lector-albaranes",label:"Lector de albaranes",icon:"📄",permission:"costes.ver"};
// Versión visible en la pantalla (debe coincidir con ?v= de los scripts en index.html).
const VERSION_LECTOR="20261023lector29";
// Modelo de visión de los recortes de manuscritos, elegido por el usuario (2026-10-22) tras la
// comparación sobre los mismos recortes de los 3 PDF reales: 32 de 60 códigos aceptados y
// correctos frente a 29 del anterior (gpt-4o), 0 erróneos en ambos y menor coste. Las casillas
// impresas dudosas siguen con el modelo por defecto de la función hasta medirlo también.
const MODELO_MANUSCRITOS="gpt-5.1";
// PRUEBA (no activa nada): modelos de visión que se comparan con el principal sobre los mismos
// recortes de manuscritos, solo si se marca la casilla. El resultado no cambia.
const MODELOS_COMPARAR=["gpt-4o","gpt-4.1","gpt-5","o4-mini"];
if(!modules.some(m=>m.id===MODULO.id)){
 const i=modules.findIndex(m=>m.id==="costes");
 modules.splice(i>=0?i+1:modules.length,0,MODULO);
}
const renderModuleBase=renderModule;
renderModule=async function(){
 if(state.module===MODULO.id)return renderLectorAlbaranes();
 return renderModuleBase();
};
// El piloto anterior de «Pedidos y alertas» (PDF completo a una IA externa) queda sustituido por
// este módulo: en su lugar, un aviso que lleva al lector nuevo.
renderComprasLotePilot=function(){
 const root=$("pcBatch");if(!root||!has("costes.ver"))return;
 root.innerHTML='<div class="card"><h3>Lectura de albaranes PDF</h3>'+
  '<p class="muted">La lectura de albaranes se hace ahora en el módulo <b>«📄 Lector de albaranes»</b> del menú (versión '+esc(VERSION_LECTOR)+'). '+
  'El piloto anterior, que enviaba el PDF completo a una IA externa, ya no se usa.</p>'+
  '<button type="button" class="btn" id="pcIrLector">Abrir el Lector de albaranes</button></div>';
 $("pcIrLector").onclick=()=>navigate(MODULO.id);
};
function renderLectorAlbaranes(){
 setTopbar("Lector de albaranes","Versión "+VERSION_LECTOR+" · PDF digitales, escaneados o mixtos · se leen en este navegador y no se guardan");
 setContent('<div id="lalRaiz"></div>');
 montar($("lalRaiz"));
}
function montar(root){
 const card=document.createElement("div");
 card.className="card";card.id="lalCard";
 card.innerHTML='<h3>Leer albaranes PDF · SIN GUARDAR</h3>'+
  '<p class="muted">Lee PDF digitales y escaneados de cualquier número de páginas en este navegador, separa cada albarán y comprueba cantidades, precios, descuentos, importes y totales. Solo acepta automáticamente lo que valida; lo demás queda marcado para revisión. Para los campos dudosos consulta el catálogo de STEL en solo lectura y, solo con recortes pequeños (nunca la página), un motor de visión cuya lectura se acepta únicamente si la confirman el OCR, el formato o el catálogo; nunca precios, cantidades ni importes. <b>No guarda nada, no envía el PDF y no crea nada en STEL.</b></p>'+
  '<label for="lalArchivos">PDF de albaranes (uno o varios)</label>'+
  '<input type="file" id="lalArchivos" accept=".pdf,application/pdf" multiple>'+
  (has("costes.editar")?'<label style="display:flex;gap:6px;align-items:center;margin-top:8px"><input type="checkbox" id="lalComparar" style="width:auto"> '+
   'Prueba: comparar otros modelos de visión con los manuscritos ('+esc(MODELOS_COMPARAR.join(", "))+'). Tarda más y tiene coste; no cambia el resultado.</label>':'')+
  '<div style="display:flex;gap:8px;margin:10px 0"><button type="button" class="btn" id="lalLeer">Leer albaranes</button>'+
  '<button type="button" class="btn secondary" id="lalCancelar" disabled>Detener</button></div>'+
  '<progress id="lalBarra" max="1" value="0" style="width:100%;display:none"></progress>'+
  '<p class="muted" role="status" id="lalEstado">Selecciona uno o varios PDF.</p>'+
  '<div id="lalResumen"></div><div id="lalErrores"></div><div id="lalDocs"></div>'+
  (has("costes.editar")?panelReferencia():'');
 root.appendChild(card);
 if(has("costes.editar"))montarReferencia();
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
   // Lector de QR para las etiquetas de obra (librería propia de la web, sin servicios externos).
   const jsQR=await cargarScript("albaranes/vendor/jsQR.js?v="+VERSION_LECTOR,"jsQR").catch(()=>null);
   // Visión SOLO de recortes (manuscritos y celdas dudosas) con la sesión del usuario; su salida
   // nunca se acepta sin validar (formato, contexto, OCR, catálogo). Desactivable con config.
   const motores={vision:{activa:false,llamadas:0,fallos:0},catalogo:{disponible:false,articulos:0,completo:false}};
   resultado.motores=motores;
   motores.qr={disponible:typeof jsQR==="function",etiquetas:0};
   const vision=lib.config?.vision===false||typeof sb!=="function"?null:
    async(recortes,{modo="manuscrito"}={})=>{
     motores.vision.activa=true;motores.vision.llamadas++;
     try{
      const resp=await sb("/functions/v1/albaranes-manuscritos",{method:"POST",headers:{"Content-Type":"application/json"},
       body:JSON.stringify({recortes,modo,...(modo==="manuscrito"?{modelo:MODELO_MANUSCRITOS}:{})}),signal:AbortSignal.timeout(130000)});
      // Consumo por uso (manuscritos / casillas impresas), cada uno con el modelo que respondió.
      const pm=motores.vision.por_modo||(motores.vision.por_modo={});
      const u=pm[modo]||(pm[modo]={modelo:null,llamadas:0,input_tokens:0,output_tokens:0});
      u.modelo=resp?.modelo||u.modelo;u.llamadas++;u.input_tokens+=resp?.uso?.input_tokens||0;u.output_tokens+=resp?.uso?.output_tokens||0;
      // Respuesta sin la lista de recortes: es un fallo de la visión, no «ningún manuscrito».
      if(!Array.isArray(resp?.recortes))throw Error("Respuesta de visión no válida");
      return resp.recortes;
     }catch(e){motores.vision.fallos++;motores.vision.ultimo_error=String(e?.message||e).slice(0,160);throw e;}
    };
   // Prueba de otros modelos sobre los mismos recortes de manuscritos (casilla; no cambia nada).
   const compararModelos=vision&&$("lalComparar")?.checked?{modelos:MODELOS_COMPARAR,
    vision:async(recortes,modelo)=>{
     const c=motores.comparacion_vision||(motores.comparacion_vision={modelos:MODELOS_COMPARAR,llamadas:0,fallos:0});c.llamadas++;
     try{return await sb("/functions/v1/albaranes-manuscritos",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({recortes,modo:"manuscrito",modelo}),signal:AbortSignal.timeout(130000)});}
     catch(e){c.fallos++;c.ultimo_error=modelo+": "+String(e?.message||e).slice(0,160);throw e;}
    }}:null;
   // Catálogo STEL de SOLO LECTURA (proveedores y artículos, sin precios): una consulta por
   // ejecución, solo en memoria. Valida CIF y referencias O/0, S/5… con coincidencia única.
   // Guardado 24 h en este navegador y reanudable si STEL corta (limita el número de consultas).
   const consultarCatalogo=cuerpo=>sb("/functions/v1/compras-catalogo-lectura",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify(cuerpo),signal:AbortSignal.timeout(150000)});
   if(lib.verificacion&&lib.catalogo&&typeof sb==="function")
    estado.textContent="Cargando el catálogo de STEL (solo lectura)… La primera vez del día puede tardar 1–2 minutos; después queda guardado en este navegador.";
   const catalogo=lib.verificacion&&lib.catalogo&&typeof sb==="function"?
    await lib.catalogo.obtenerCatalogo({consultar:consultarCatalogo,almacen:lib.catalogo.almacenLocal()})
     .catch(e=>{motores.catalogo.error=String(e?.message||e).slice(0,160);return null;}):null;
   // Obras del lector (código PRY y nombre, importadas o confirmadas por una persona): catálogo de
   // obras cuando STEL no da el suyo completo. Incompleto: solo valida con el nombre de la obra.
   const obrasLector=typeof sb==="function"?await sb("/rest/v1/lector_obras?select=codigo,nombre&limit=20000").catch(()=>null):null;
   // Marcada como el listado COMPLETO de proyectos de STEL (y con al menos esas obras cargadas).
   const ajusteObras=typeof sb==="function"?(await sb("/rest/v1/lector_ajustes?select=valor&clave=eq.obras_lista_completa").catch(()=>null))?.[0]?.valor:null;
   motores.confirmadas={cargadas:null,aplicadas:0};
   // Albaranes de compra de STEL (SOLO LECTURA) para validar los códigos ABP manuscritos.
   const stelAlb={consultas:0,validados:0,fallos:0};motores.stel_albaranes=stelAlb;
   const cacheStel=new Map();
   // STEL sin respuesta (cupo de consultas, «403»/«429», o caído): en esta lectura no se le pregunta
   // más; las consultas siguientes devuelven null («no se sabe»), nunca «no existe».
   let stelNoDisponible=null;
   const consultarStel=typeof sb!=="function"?null:async ref=>{
    if(cacheStel.has(ref))return cacheStel.get(ref);
    if(stelNoDisponible)return null;
    const pedir=async x=>{stelAlb.consultas++;
     try{
      const resp=await sb("/functions/v1/stel-albaranes-consulta",{method:"POST",headers:{"Content-Type":"application/json"},
       body:JSON.stringify({fullReference:x}),signal:AbortSignal.timeout(30000)});
      // Diagnóstico de las primeras consultas (cuántos albaranes devuelve STEL y su formato).
      if((stelAlb.muestras||(stelAlb.muestras=[])).length<3)stelAlb.muestras.push({ref:x,devueltos:resp?.checkedCount??null,encontrados:(resp?.documents||[]).length,diagnostico:resp?.diagnostico||null});
      if((resp?.documents||[]).length)(stelAlb.encontrados||(stelAlb.encontrados=[])).push({ref:x,documentos:resp.documents});
      return resp?.documents||[];
     }catch(e){stelAlb.fallos++;stelAlb.ultimo_error=String(e?.message||e).slice(0,160);stelNoDisponible=stelAlb.ultimo_error;return null;}};
    // STEL guarda la referencia sin guion («ABP261234»): se pide así primero (medido 2026-10-21).
    const docs=await pedir(ref.replace(/-/g,""));
    const final=docs&&!docs.length?await pedir(ref):docs;
    if(final)cacheStel.set(ref,final);
    return final;
   };
   const nombreProveedor=x=>(x?.proveedor?.account_id!=null&&(catalogo?.proveedores||[]).find(p=>String(p.id)===String(x.proveedor.account_id))?.nombre)||x?.proveedor?.nombre||null;
   if(catalogo)Object.assign(motores.catalogo,{disponible:true,articulos:(catalogo.articulos||[]).length,completo:!!catalogo.articulos_completo,
    motivo:catalogo.diagnostico?.articulos?.motivo||null,paginas:catalogo.diagnostico?.articulos?.paginas??null,origen:catalogo.origen||null,
    obras:(catalogo.obras||[]).length,obras_completo:!!catalogo.obras_completo,obras_motivo:catalogo.diagnostico?.obras?.motivo||null});
   const listaCompleta=Array.isArray(obrasLector)&&Number.isInteger(ajusteObras?.total)&&ajusteObras.total>0&&obrasLector.length>=ajusteObras.total;
   const catalogoObrasCompleto=!!catalogo?.obras_completo||listaCompleta;
   const catalogoObras=catalogo?.obras_completo?catalogo.obras:(Array.isArray(obrasLector)&&obrasLector.length?obrasLector:null);
   motores.catalogo.obras_lector=Array.isArray(obrasLector)?obrasLector.length:null;
   motores.catalogo.obras_lector_completa=listaCompleta;
   // PDF de cada albarán leído, para guardarlo con su orden en la cola de STEL (Fase 2).
   const pdfDeDoc=new Map();
   for(const [i,f] of lista.entries()){
    if(detener)break;
    const bytes=new Uint8Array(await f.arrayBuffer());
    // Copia: pdf.js puede quedarse con el original al abrirlo.
    const copiaPdf=bytes.slice();
    // Un PDF dañado o vacío da error solo en ese fichero; los demás se leen (prueba de fuerza
    // 2026-10-22: un PDF roto en la misma lectura detenía todos con «Invalid PDF structure»).
    const fuente=await lib.motorNavegador.abrirFuente(pdfjs,bytes,{alProgresar:t=>{estado.textContent=f.name+" · "+t;}})
     .catch(e=>{resultado.errores.push({archivo:f.name,paginas:[],error:"PDF dañado, vacío o protegido: "+String(e?.message||e).slice(0,160)});return null;});
    if(!fuente){pintar(resultado);continue;}
    try{
     const r=await lib.lector.leerPdf(fuente,{registro:lib.proveedores.REGISTRO,vision,compararModelos,qr:jsQR,tamLote:5,cancelado:()=>detener,
      catalogoObras,catalogoObrasCompleto,
      alProgresar:e=>{
       barra.max=e.total;barra.value=e.pagina||e.total;
       estado.textContent="PDF "+(i+1)+"/"+lista.length+" «"+f.name+"» · página "+(e.pagina||e.total)+"/"+e.total+
        (e.lote?" · bloque "+e.lote:"")+" · "+(resultado.documentos.length+e.documentos)+" albaranes · "+(resultado.errores.length+e.errores)+" errores";
      }});
     resultado.archivos.push({nombre:f.name,paginas:fuente.numPaginas,...r.resumen});
     for(const d of r.documentos){
      if(catalogo&&d.resultado?._ctx)lib.verificacion.verificar(d.resultado,catalogo);
      const doc={archivo:f.name,...d};
      resultado.documentos.push(doc);pdfDeDoc.set(doc,copiaPdf);
     }
     for(const e of r.errores)resultado.errores.push({archivo:f.name,...e});
     if(!r.resumen.paginas_completas&&!r.resumen.paginas_no_procesadas.length)resultado.errores.push({archivo:f.name,paginas:[],error:"Comprobación de páginas fallida: alguna página no está en exactamente un documento"});
    }catch(e){resultado.errores.push({archivo:f.name,paginas:[],error:String(e?.message||e)});}
    finally{await fuente.cerrar();}
    pintar(resultado);
   }
   // Albarán de compra de STEL de cada albarán leído, por el número del proveedor en su título
   // (solo lectura). Una sola búsqueda en TODAS las cuentas (también las sin CIF) en las fechas de la
   // lectura, desde el final de la lista y con la pista del total. Fallo real (2026-10-23): por cuenta
   // gastó 55 consultas y la búsqueda siguiente recibió «403» (cupo de STEL). Con «403»/«429», un
   // reintento al minuto; si no termina por larga (fechas muy separadas), por cuenta y sin las
   // cuentas sin CIF. Solo con la búsqueda completa.
   if(typeof sb==="function"&&lib.comprasStel&&!detener){
    const q=lib.comprasStel.consulta(resultado.documentos),sc=motores.stel_compras={consultado:false};
    if(q){
     let pista=null;try{pista=Number(localStorage.getItem("dafrica_stel_compras_total"))||null;}catch{}
     estado.textContent="Buscando los albaranes de compra en STEL (solo lectura)…";
     const buscar=b=>sb("/functions/v1/stel-albaranes-consulta",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({buscar:{...b,...(pista?{pista}:{})}}),signal:AbortSignal.timeout(170000)});
     try{
      const b=await lib.comprasStel.buscarNotasLectura(buscar,q,{detenido:()=>detener,
       esperar:async ms=>{for(let t=0;t<ms&&!detener;t+=1000)await new Promise(ok=>setTimeout(ok,1000));},
       alEsperar:ms=>{estado.textContent="STEL no responde por ahora (límite de consultas): se vuelve a intentar dentro de "+Math.round(ms/1000)+" s (solo lectura)…";}});
      const resp=b.resp,todas=b.todas;sc.intentos=b.intentos;
      Object.assign(sc,{consultado:true,todas_las_cuentas:todas,metodo:resp?.metodo||null,completo:!!resp?.completo,notas:(resp?.notas||[]).length,
       consultas:sc.intentos.reduce((n,x)=>n+(x.consultas||0),0),motivo:resp?.motivo||null,sin_cupo:b.sin_cupo});
      if(b.sin_cupo)stelNoDisponible=resp.motivo;
      if(resp?.total)try{localStorage.setItem("dafrica_stel_compras_total",String(resp.total));}catch{}
      // Cuentas de STEL sin CIF válido (solo con el catálogo de proveedores completo): un proveedor
      // puede estar duplicado en STEL en una cuenta sin CIF con sus compras (fallo real 2026-10-22).
      const cuentasSinCif=todas&&catalogo?.proveedores_completo&&lib.nif?new Set((catalogo.proveedores||[]).filter(p=>!lib.nif.validar(p.nif).valido).map(p=>String(p.id))):null;
      if(resp?.completo)Object.assign(sc,lib.comprasStel.resolver(resultado.documentos,resp.notas||[],{cuentasSinCif}));
      // En el JSON descargado (solo en el equipo del usuario), para medir sin volver a leer.
      sc.lista=resp?.notas||[];
      // Con el nombre de la obra que la oficina escribió en STEL, el código PRY a mano puede
      // validarse con el catálogo de obras (mismo código y mismo nombre).
      sc.obras=0;
      for(const d of resultado.documentos){const x=d.resultado;
       if(x?.albaran_stel?.estado==="OK"&&x.albaran_stel.obra&&lib.manuscritos?.revalidarObra&&
        lib.manuscritos.revalidarObra(x,{catalogoObras,catalogoObrasCompleto,obraStel:x.albaran_stel.obra}))sc.obras++;}
     }catch(e){sc.error=String(e?.message||e).slice(0,160);stelNoDisponible=sc.error;}
    }
   }
   // Códigos ABP escritos a mano: se comprueban contra los albaranes de compra que ya trajo la
   // búsqueda (sin más consultas a STEL). Solo si la búsqueda no terminó, uno a uno (fallo real:
   // 39 consultas sueltas agotaban el cupo de STEL y la búsqueda general recibía «403»).
   const notasStel=motores.stel_compras?.completo?(motores.stel_compras.lista||[]):null;
   const consultarAbp=notasStel?async ref=>{const c=String(ref).toUpperCase().replace(/[^A-Z0-9]/g,"");
    return notasStel.filter(n=>String(n.fullReference).toUpperCase().replace(/[^A-Z0-9]/g,"")===c);}:consultarStel;
   stelAlb.origen=notasStel?"busqueda":stelNoDisponible?"stel_no_disponible":"una_a_una";
   // Cuentas de STEL sin CIF que otros albaranes del lote han demostrado de cada proveedor.
   const cuentasDemostradas=lib.comprasStel?.cuentasSinCifPorProveedor?lib.comprasStel.cuentasSinCifPorProveedor(resultado.documentos):new Map();
   // Con la lista de la búsqueda se sabe cuántos albaranes de compra tiene el proveedor cada día y
   // cuáles están ya asignados; sin ella (consultas sueltas), la fecha sola no basta.
   const asignadas=new Set(resultado.documentos.map(d=>d.resultado?.albaran_stel?.id).filter(x=>x!=null).map(String));
   const delMismoDia=(x,extra)=>notasStel?n=>{const cuentas=new Set([...(extra||[]),...(x.proveedor?.account_id!=null?[String(x.proveedor.account_id)]:[])]);
    return notasStel.filter(o=>String(o.id)!==String(n.id)&&cuentas.has(String(o.accountId))&&lib.manuscritos.fechaStel(o.date)===lib.manuscritos.fechaStel(n.date)).length;}:null;
   if(consultarAbp&&lib.manuscritos?.validarStel)for(const d of resultado.documentos){
    const extra=notasStel?cuentasDemostradas.get(lib.comprasStel.claveProveedor(d.resultado))||null:null;
    if(d.resultado?.manuscritos&&await lib.manuscritos.validarStel(d.resultado,consultarAbp,{proveedorNombre:nombreProveedor(d.resultado),
     cuentasProveedor:extra,delMismoDia:d.resultado?delMismoDia(d.resultado,extra):null,asignadas,
     diagnostico:x=>{(stelAlb.comparaciones||(stelAlb.comparaciones=[])).push(x);}}))stelAlb.validados++;
    // Prueba de modelos: la misma validación con STEL para el principal y para cada modelo.
    const cmp=d.resultado?.manuscritos?.comparacion;
    if(cmp)for(const e of [cmp.principal,...Object.values(cmp.modelos||{})]){
     if(!e?.stel)continue;
     const falso={manuscritos:{stel:{...e.stel}},proveedor:d.resultado.proveedor,fecha:d.resultado.fecha,numero:d.resultado.numero};
     if(await lib.manuscritos.validarStel(falso,consultarAbp,{proveedorNombre:nombreProveedor(d.resultado)}))
      e.stel={...e.stel,valor:falso.manuscritos.stel.valor,estado:falso.manuscritos.stel.estado,confianza:falso.manuscritos.stel.confianza,metodo_final:"vision_recorte_albaran_stel"};
    }
   }
   // Un mismo albarán de compra de STEL para dos albaranes leídos: ninguno se acepta.
   if(lib.comprasStel?.conflictosIdentidad)stelAlb.conflictos_identidad=lib.comprasStel.conflictosIdentidad(resultado.documentos);
   // Pedidos a proveedor (PAP) escritos a mano: UNA consulta de solo lectura con todos los códigos de
   // la lectura; se aceptan solo con el mismo proveedor y los artículos del albarán en el pedido.
   if(typeof sb==="function"&&lib.manuscritos?.validarPedido&&!detener&&!stelNoDisponible){
    const conPedido=resultado.documentos.filter(d=>["REVISAR","AMBIGUO"].includes(d.resultado?.manuscritos?.pedido?.estado));
    const codigos=[...new Set(conPedido.flatMap(d=>d.resultado.manuscritos.pedido.resolucion?.alternativas||[]))].slice(0,20);
    const sp=motores.stel_pedidos={consultado:false,codigos:codigos.length,validados:0};
    if(codigos.length){
     estado.textContent="Comprobando los pedidos a proveedor en STEL (solo lectura)…";
     let resp=null;
     try{resp=await sb("/functions/v1/stel-albaranes-consulta",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({pedidos:{codigos}}),signal:AbortSignal.timeout(60000)});}catch(e){sp.error=String(e?.message||e).slice(0,160);}
     sp.consultado=!!resp;sp.completo=!!resp?.completo;
     const pedidos=resp?.completo?resp.pedidos:null;
     for(const d of conPedido)if(await lib.manuscritos.validarPedido(d.resultado,async()=>pedidos))sp.validados++;
    }
   }
   // Coherencia de los códigos de obra entre todos los PDF leídos juntos.
   const man=resultado.documentos.map(d=>d.resultado?.manuscritos).filter(Boolean);
   if(man.length&&lib.manuscritos)lib.manuscritos.coherenciaLote(man,{catalogoObras});
   // Texto encima de una línea que es la obra del albarán (no el primer renglón de la descripción).
   if(lib.manuscritos?.textoPrevioObra)for(const d of resultado.documentos)if(d.resultado)lib.manuscritos.textoPrevioObra(d.resultado,{catalogoObras});
   // Códigos confirmados por una persona y tarifas importadas: solo los que hacen falta.
   let confirmadas=null;
   if(typeof sb==="function"&&lib.confirmadas){
    confirmadas=[];
    try{
     for(const [k,clases] of Object.entries(lib.confirmadas.necesarias(resultado.documentos)))
      for(let i=0;i<clases.length;i+=40)
       confirmadas.push(...(await sb("/rest/v1/lector_referencias_confirmadas?select=proveedor_clave,referencia,descripcion,confirmado_en,origen&proveedor_clave=eq."+
        encodeURIComponent(k)+"&clase=in.("+clases.slice(i,i+40).map(encodeURIComponent).join(",")+")")||[]));
    }catch(e){motores.confirmadas.error=String(e?.message||e).slice(0,160);}
    motores.confirmadas.cargadas=confirmadas.length;
   }
   // Estado final de cada albarán tras catálogo, STEL y lote: un manuscrito sin validar impide AUTO_OK.
   for(const d of resultado.documentos){
    const x=d.resultado;if(!x)continue;
    const n=Array.isArray(confirmadas)&&x._ctx?lib.confirmadas.aplicar(x,confirmadas):0;
    motores.confirmadas.aplicadas+=n;
    if(x._ctx&&(n||x.manuscritos||x.albaran_stel))lib.extraer.finalizar(x);
    if(x.manuscritos&&lib.manuscritos?.aplicarEstado)lib.manuscritos.aplicarEstado(x);
    if(x.etiqueta_obra)motores.qr.etiquetas++;
    d.estado_documento=lib.lector.estadoDocumento(x);
   }
   // Catálogo usado (solo lectura, sin precios) dentro del JSON descargado: permite medir y ajustar
   // la validación con el catálogo sin volver a leer los PDF. Solo en el fichero que descarga el usuario.
   if(catalogo)resultado.catalogo_stel={articulos_completo:!!catalogo.articulos_completo,proveedores_completo:!!catalogo.proveedores_completo,
    creado:catalogo.creado||null,articulos:catalogo.articulos||[],proveedores:catalogo.proveedores||[]};
   // Fase 2 (aprobada 2026-10-26): cada albarán y su PDF a la cola de STEL. Los AUTO_OK con todo
   // resuelto quedan PENDIENTES para el robot; el resto, en REVISAR. Solo con permiso de edición.
   if(!detener&&has("costes.editar")&&lib.colaStel&&typeof sb==="function"){
    estado.textContent="Enviando los albaranes a la cola de STEL…";
    try{await enviarColaStel(resultado,catalogo,pdfDeDoc);}
    catch(e){resultado.cola_stel={...(resultado.cola_stel||{}),error:String(e?.message||e).slice(0,160)};}
   }
   ultimo=resultado;pintar(resultado);
   estado.textContent=(detener?"Lectura detenida. ":"Lectura terminada. ")+resultado.documentos.length+" albaranes en "+resultado.archivos.length+" PDF.";
  }catch(e){estado.textContent="No se ha podido leer: "+(e?.message||e);}
  finally{leer.disabled=false;cancelar.disabled=true;barra.style.display="none";}
 };
 // Cola de STEL: la orden de cada albarán (albaranes/cola-stel.js) y su PDF en el almacén privado, por su
 // huella SHA-256. La base de datos nunca pisa uno ya procesado.
 // Prueba real del 2026-10-28 (40 páginas, 8 sin fila en la cola y 32 con el mismo PDF): ahora TODO
 // documento leído llega a la cola (los no identificados, en REVISAR con clave provisional y su motivo),
 // cada albarán lleva su PDF individual (solo sus páginas) y el PDF original del lote se guarda como
 // respaldo. Lo que no se guarda queda anotado documento a documento (nunca en silencio).
 async function enviarColaStel(r,catalogo,pdfDeDoc){
  const lib=window.DafricaAlbaranes,info=r.cola_stel={enviados:0,pendientes:0,revisar:0,ya_existe:0,sin_cambios:0,sin_clave:0,provisionales:0,
   duplicados:0,errores_guardado:0,errores_lectura:0,pdf_individuales:0,originales:0};
  const PDFLib=await cargarScript("albaranes/vendor/pdf-lib.min.js?v="+VERSION_LECTOR,"PDFLib").catch(()=>null);
  const A=lib.archivoPdf,m=r.motores||{};
  const opciones={busquedaStelCompleta:!!m.stel_compras?.completo,catalogoIncompleto:!catalogo||!catalogo.articulos_completo,
   busquedaStelIncompleta:!!m.stel_compras?.consultado&&!m.stel_compras?.completo,visionFallida:!!m.vision?.fallos};
  const huellas=new Map(),subidos=new Map(),originales=new Set();
  const huellaDe=async b=>{if(!huellas.has(b))huellas.set(b,await A.huella(b));return huellas.get(b);};
  const subir=async(bytes,h)=>{
   if(!subidos.has(h)){
    const resp=await authFetch(SUPABASE_URL+"/storage/v1/object/albaranes-stel/"+h+".pdf",{method:"POST",headers:{"Content-Type":"application/pdf","x-upsert":"false"},body:bytes});
    // El mismo PDF ya subido en otra lectura: vale el que hay.
    const ya=!resp.ok&&/duplicate|already exists/i.test(await resp.text().catch(()=>""));
    subidos.set(h,resp.ok||ya);
   }
   return subidos.get(h);
  };
  const ordenes=[];
  for(const d of r.documentos){
   const o=lib.colaStel.orden(d,catalogo,opciones);
   if(!d.resultado)info.errores_lectura++;
   const bytes=pdfDeDoc.get(d);
   let individual=null,errPdf=null,original=null;
   if(bytes){
    try{
     original={sha256:await huellaDe(bytes),nombre:d.archivo||null};
     if(!PDFLib)throw Error("pdf-lib no disponible");
     const b=await A.separar(PDFLib,bytes,d.paginas);
     individual={bytes:b,sha256:await A.huella(b)};
    }catch(e){errPdf=String(e?.message||e).slice(0,160);}
   }else errPdf="PDF original no disponible";
   if(!o.clave){
    o.clave=lib.colaStel.claveProvisional(individual?.sha256);
    if(o.clave){info.provisionales++;o.estado="REVISAR";o.motivos.unshift("Documento sin identificar en STEL (proveedor, número o fecha): guardado para revisión");}
   }
   if(!o.clave){info.sin_clave++;d.cola_stel={estado:"SIN_ENVIAR",guardado:false,motivos:[...o.motivos,"Sin PDF individual: "+(errPdf||"desconocido")]};continue;}
   ordenes.push({d,o,individual,original,errPdf});
  }
  // Dos albaranes de la lectura con el mismo proveedor, número y fecha: ninguno automático.
  const veces=new Map();for(const {o} of ordenes)veces.set(o.clave,(veces.get(o.clave)||0)+1);
  for(const {o} of ordenes)if(veces.get(o.clave)>1){info.duplicados++;if(o.estado==="PENDIENTE")o.estado="REVISAR";o.motivos.push("Mismo proveedor, número y fecha que otro albarán de la lectura");}
  const filas=[];
  for(const x of ordenes){
   const {d,o,individual,original}=x;let sha=null,errPdf=x.errPdf;
   try{
    if(original&&await subir(pdfDeDoc.get(d),original.sha256)){originales.add(original.sha256);info.originales=originales.size;}
    if(individual){
     if(await subir(individual.bytes,individual.sha256)){sha=individual.sha256;info.pdf_individuales++;}
     else errPdf="No se pudo guardar el PDF individual";
    }
   }catch(e){errPdf=String(e?.message||e).slice(0,160);}
   if(sha&&o.plan)o.plan.pdf=A.referencia({sha256:sha,paginasOriginales:d.paginas,original:{...original,total_paginas:r.archivos.find(a=>a.nombre===d.archivo)?.paginas??null}});
   if(!sha){if(o.estado==="PENDIENTE")o.estado="REVISAR";o.motivos.push("Sin PDF individual guardado ("+(errPdf||"error")+")");}
   filas.push({clave:o.clave,estado:o.estado,motivos:o.motivos,plan:o.plan,pdf_ruta:sha?sha+".pdf":null,pdf_sha256:sha});
   d.cola_stel={estado:o.estado,motivos:o.motivos,clave:o.clave,pdf_sha256:sha,guardado:null};
  }
  for(let i=0;i<filas.length;i+=50){
   const parte=filas.slice(i,i+50);
   let res;
   try{res=await sb("/rest/v1/rpc/stel_cola_enviar",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({p_filas:parte})});}
   catch(e){
    // Error de guardado: cada documento del bloque lo dice (no «no detectado» ni «duplicado»).
    for(const f of parte){const d=ordenes.find(z=>z.o.clave===f.clave)?.d;if(d){info.errores_guardado++;d.cola_stel={...d.cola_stel,guardado:false,error:"Error de guardado: "+String(e?.message||e).slice(0,160)};}}
    continue;
   }
   for(const x of res||[]){
    info.enviados++;
    if(x.accion==="sin_cambios")info.sin_cambios++;
    else if(x.estado==="PENDIENTE")info.pendientes++;else if(x.estado==="REVISAR")info.revisar++;else if(x.estado==="YA_EXISTE")info.ya_existe++;
    for(const z of ordenes.filter(z=>z.o.clave===x.clave)){
     z.d.cola_stel={...z.d.cola_stel,guardado:true,accion:x.accion};
     if(x.accion==="sin_cambios")z.d.cola_stel={...z.d.cola_stel,estado:x.estado,motivos:["Ya enviado antes ("+x.estado+"); no se cambia"]};
    }
   }
  }
  // Ningún documento sin respuesta de la base de datos queda como guardado.
  for(const {d} of ordenes)if(d.cola_stel&&d.cola_stel.guardado===null){info.errores_guardado++;d.cola_stel.guardado=false;d.cola_stel.error="Error de guardado: la base de datos no confirmó este documento";}
 }
 function pintar(r){
  const n=e=>r.documentos.filter(d=>d.estado_documento===e).length;
  const ETIQ={AUTO_OK:"AUTO_OK · verificado",REVISAR:'<span class="error">REVISAR</span>',ERROR_DOCUMENTO:'<b class="error">ERROR_DOCUMENTO</b>'};
  const m=r.motores,v=m?.vision,cat=m?.catalogo;
  const segunda=!m?"":'<p class="muted">Segunda fase · catálogo STEL (solo lectura): '+(cat.disponible?(cat.obras_completo?esc(cat.obras)+' obras y ':'obras <b>no disponibles</b>'+(cat.obras_motivo?' ('+esc(cat.obras_motivo)+')':'')+' · ')+esc(cat.articulos)+' artículos'+({cache:' (guardado en este navegador)',reanudado:' (descarga reanudada)',parcial_sin_avance:' (STEL no ha respondido; se usa lo guardado)'}[cat.origen]||'')+(cat.completo?'':' (<b>incompleto</b>'+(cat.motivo?': '+esc(cat.motivo):'')+'; sin catálogo completo no se validan códigos)'):'<b>no disponible</b>'+(cat.error?' ('+esc(cat.error)+')':''))+
   ' · visión de recortes: '+(!v.activa?'sin campos dudosos que consultar':v.fallos?'<b>no disponible</b> ('+esc(v.fallos)+' de '+esc(v.llamadas)+' consultas fallidas'+(v.ultimo_error?': '+esc(v.ultimo_error):'')+')':esc(v.llamadas)+' consultas'+
    (v.por_modo?' ('+Object.entries(v.por_modo).map(([k,x])=>(k==="manuscrito"?"manuscritos":"casillas impresas")+": "+esc(x.modelo||"—")).join("; ")+')':''))+
   (m.stel_albaranes?' · albaranes STEL (códigos ABP): '+esc(m.stel_albaranes.validados)+' validados en '+esc(m.stel_albaranes.consultas)+' consultas'+
    (m.stel_albaranes.fallos?' (<b>'+esc(m.stel_albaranes.fallos)+' fallidas</b>'+(m.stel_albaranes.ultimo_error?': '+esc(m.stel_albaranes.ultimo_error):'')+')':''):'')+
   (m.stel_compras?.sin_cupo?' · albaranes de compra STEL: <b>STEL no responde</b> (límite de consultas: «'+esc(m.stel_compras.motivo)+'»); los códigos ABP quedan sin comprobar. Vuelve a leer más tarde':
    m.stel_compras?.consultado?' · albaranes de compra STEL por número: '+esc(m.stel_compras.resueltos||0)+' encontrados'+(m.stel_compras.completo?'':' (<b>búsqueda incompleta</b>'+(m.stel_compras.motivo?': '+esc(m.stel_compras.motivo):'')+')'):
    m.stel_compras?.error?' · albaranes de compra STEL: <b>no disponible</b> ('+esc(m.stel_compras.error)+')':'')+
   (cat.disponible&&(!v.activa||!v.fallos)?'':'. Sin ellos, los campos dudosos quedan en REVISAR.')+'</p>';
  $("lalResumen").innerHTML='<p><b>'+esc(r.documentos.length)+'</b> documentos: <b>'+esc(n("AUTO_OK"))+'</b> AUTO_OK · <b>'+
   esc(n("REVISAR"))+'</b> REVISAR · <b>'+esc(n("ERROR_DOCUMENTO"))+'</b> ERROR_DOCUMENTO</p>'+segunda+
   (r.cola_stel?'<p>Cola de STEL: '+(r.cola_stel.error?'<b class="error">no se pudo enviar</b> ('+esc(r.cola_stel.error)+')':
    '<b>'+esc(r.cola_stel.pendientes)+'</b> pendientes de crear · <b>'+esc(r.cola_stel.revisar)+'</b> en revisión · '+esc(r.cola_stel.ya_existe)+' ya en STEL'+
    (r.cola_stel.sin_cambios?' · '+esc(r.cola_stel.sin_cambios)+' ya enviados antes (sin cambios)':'')+(r.cola_stel.provisionales?' · '+esc(r.cola_stel.provisionales)+' sin identificar (guardados en revisión)':'')+
    (r.cola_stel.errores_lectura?' · '+esc(r.cola_stel.errores_lectura)+' con error de lectura (guardados en revisión)':'')+
    (r.cola_stel.duplicados?' · '+esc(r.cola_stel.duplicados)+' repetidos en la lectura':'')+
    (r.cola_stel.errores_guardado?' · <b class="error">'+esc(r.cola_stel.errores_guardado)+' sin guardar (error de guardado)</b>':'')+
    (r.cola_stel.sin_clave?' · <b class="error">'+esc(r.cola_stel.sin_clave)+' no enviados (sin PDF individual)</b>':'')+
    ' · PDF individuales: '+esc(r.cola_stel.pdf_individuales)+' · originales del lote: '+esc(r.cola_stel.originales))+'</p>':'')+
   (r.documentos.length?'<p><button type="button" class="btn secondary" id="lalJson">Descargar resultado (JSON)</button> '+
    '<button type="button" class="btn secondary" id="lalCsv">Descargar líneas (CSV)</button></p>':'')+
   '<div class="table-wrap" style="overflow:auto;max-height:420px"><table><thead><tr><th>#</th><th>PDF · páginas</th><th>Proveedor</th><th>Número</th><th>Fecha</th><th>Líneas</th><th>Total</th><th>Obra (manuscrito)</th><th>Pedido (manuscrito)</th><th>Estado</th></tr></thead><tbody>'+
   r.documentos.map((d,i)=>{const x=d.resultado||{},o=x.manuscritos?.obra,pe=x.manuscritos?.pedido;
    return '<tr><td>'+(i+1)+'</td><td>'+esc(d.archivo)+' · '+esc(d.paginas.join(", "))+'</td><td>'+esc(x.proveedor?.nombre||x.proveedor?.nif||"—")+'</td><td>'+
     esc(x.numero?.valor||"—")+'</td><td>'+esc(x.fecha?.valor||"—")+'</td><td>'+esc((x.lineas||[]).length)+'</td><td>'+esc(x.totales?.total?.literal||"—")+'</td><td>'+
     esc(o?.valor?(o.valor+(o.estado==="OK"?"":" (a revisar)")):"—")+'</td><td>'+
     esc(pe?.valor?(pe.valor+(pe.estado==="OK"?"":" (a revisar)")):pe?.estado==="AMBIGUO"?"dudoso: "+(pe.resolucion?.alternativas||[]).join(" / "):"—")+'</td><td>'+(ETIQ[d.estado_documento]||esc(d.estado_documento))+(d.error?' · '+esc(d.error):'')+
     (d.cola_stel?'<br><span class="muted" title="'+esc((d.cola_stel.motivos||[]).join(" · "))+'">STEL: '+esc({PENDIENTE:"pendiente de crear",REVISAR:"en revisión",YA_EXISTE:"ya existe",SIN_ENVIAR:"no enviado"}[d.cola_stel.estado]||d.cola_stel.estado)+'</span>'+(d.cola_stel.error?' <b class="error">'+esc(d.cola_stel.error)+'</b>':''):'')+'</td></tr>';}).join("")+
   '</tbody></table></div>';
  $("lalErrores").innerHTML=r.errores.length?'<details open><summary>'+esc(r.errores.length)+' error(es) de lectura</summary>'+
   r.errores.map(e=>'<p class="error">'+esc(e.archivo)+(e.paginas?.length?' · páginas '+esc(e.paginas.join(", ")):'')+': '+esc(e.error)+'</p>').join("")+'</details>':"";
  $("lalDocs").innerHTML=r.documentos.map((d,i)=>!d.resultado?'':'<details style="border:1px solid #d6dee8;border-radius:8px;padding:10px;margin:8px 0"><summary style="cursor:pointer;font-weight:bold">'+
   (i+1)+' · '+esc(d.resultado?.proveedor?.nombre||"Proveedor no identificado")+' · '+esc(d.resultado?.numero?.valor||"sin número")+'</summary>'+pcRenderDeterminista(d.resultado)+confirmarObra(d,i)+confirmarCodigos(d,i)+'</details>').join("");
  $("lalDocs").onclick=async ev=>{
   const bo=ev.target.closest?.("button[data-lal-obra]");
   if(bo){
    const i=Number(bo.dataset.lalObra),codigo=String($("lalObraCod_"+i)?.value||"").toUpperCase().replace(/[^A-Z0-9]/g,""),nombre=String($("lalObraNom_"+i)?.value||"").trim();
    const est=$("lalObraEstado_"+i);
    if(!/^PRY\d{5}$/.test(codigo)){est.textContent="El código debe ser PRY y 5 cifras.";return;}
    if(nombre.length<2){est.textContent="Escribe el nombre de la obra.";return;}
    bo.disabled=true;est.textContent="Guardando…";
    try{
     await sb("/rest/v1/lector_obras?on_conflict=codigo",{method:"POST",headers:{"Content-Type":"application/json",Prefer:"resolution=ignore-duplicates,return=minimal"},
      body:JSON.stringify({codigo,nombre:nombre.slice(0,150),origen:"persona"})});
     est.textContent="✓ Obra guardada: las próximas lecturas validarán este código con el nombre de la obra.";
    }catch(e){est.textContent="No se ha podido guardar: "+(e?.message||e);bo.disabled=false;}
    return;
   }
   const b=ev.target.closest?.("button[data-lal-confirmar]");if(!b)return;
   const lib=window.DafricaAlbaranes;
   const [i,f]=b.dataset.lalConfirmar.split(":").map(Number),d=r.documentos[i],l=d?.resultado?.lineas?.[f];
   const entrada=$("lalRef_"+i+"_"+f),estadoFila=$("lalRefEstado_"+i+"_"+f);
   const referencia=String(entrada?.value||"").trim().replace(/\s+/g," "),clave=lib.confirmadas.clave(d?.resultado?.proveedor);
   if(!referencia||!clave||!l)return;
   // Solo códigos con forma de código: sin texto de la descripción pegado, sin comillas ni signos,
   // sin forma de importe y con el formato de código del proveedor si se conoce.
   const perfil=lib.confirmadas.perfilDe?.(d.resultado.proveedor);
   if(lib.confirmadas.codigoValido&&!lib.confirmadas.codigoValido(referencia,perfil)){
    estadoFila.textContent="No parece un código"+(perfil?.formato_referencia?" de este proveedor":"")+
     ": quita el texto pegado de la descripción, las comillas o los espacios. Si en el papel no hay código, no lo confirmes.";
    return;
   }
   // Código en dos renglones: el OCR pierde guiones y espacios (fallo real 2026-10-23: se confirmó un
   // espacio donde el papel lleva guion). Se guarda al segundo clic, tras compararlo con el papel.
   if(lib.confirmadas.dosRenglones?.(l.referencia)&&b.dataset.lalComprobado!==referencia){
    b.dataset.lalComprobado=referencia;
    estadoFila.textContent="Código en dos renglones: compáralo con el papel letra a letra, con sus espacios y guiones, y pulsa otra vez para guardarlo.";
    return;
   }
   b.disabled=true;estadoFila.textContent="Guardando…";
   try{
    await sb("/rest/v1/lector_referencias_confirmadas?on_conflict=proveedor_clave,referencia",{method:"POST",
     headers:{"Content-Type":"application/json",Prefer:"resolution=ignore-duplicates,return=minimal"},
     body:JSON.stringify({proveedor_clave:clave,referencia,descripcion:String(l.descripcion?.valor||l.descripcion?.literal||"").slice(0,200)||null})});
    estadoFila.textContent="✓ Confirmado: las próximas lecturas de este proveedor lo validarán solas.";
   }catch(e){estadoFila.textContent="No se ha podido guardar: "+(e?.message||e);b.disabled=false;}
  };
  const j=$("lalJson"),c=$("lalCsv");
  if(j)j.onclick=()=>descargar("albaranes.json","application/json",JSON.stringify(r,null,1));
  if(c)c.onclick=()=>descargar("albaranes-lineas.csv","text/csv;charset=utf-8",csv(r));
 }
 // Obra pendiente de un albarán: la persona que revisa confirma el código PRY y el nombre; queda en
 // el catálogo de obras del lector (lector_obras) para validar las lecturas siguientes.
 function confirmarObra(d,i){
  const x=d.resultado,o=x?.manuscritos?.obra;
  if(!x?.manuscritos||!has("costes.editar")||(o?.estado==="OK"&&(o.confianza??0)>=0.9))return "";
  const cod=o?.valor||(o?.resolucion?.alternativas||[])[0]||"";
  const nom=x.albaran_stel?.obra||(x.manuscritos.obraImpresa||[])[0]||(x.manuscritos.obraEscrita||[])[0]||"";
  return '<div style="margin-top:8px"><b>Confirmar obra</b> <span class="muted">(código PRY del papel y nombre de la obra)</span>'+
   '<div style="display:flex;gap:6px;align-items:center;margin:4px 0;flex-wrap:wrap">'+
   '<input id="lalObraCod_'+i+'" value="'+esc(cod)+'" placeholder="PRY00000" style="width:120px">'+
   '<input id="lalObraNom_'+i+'" value="'+esc(nom)+'" placeholder="Nombre de la obra" style="width:220px">'+
   '<button type="button" class="btn secondary" data-lal-obra="'+i+'">Confirmar obra</button>'+
   '<span id="lalObraEstado_'+i+'" class="muted"></span></div></div>';
 }
 // Códigos pendientes de un albarán: la persona que revisa puede confirmarlos (o corregirlos) para
 // que el lector los valide solo en adelante. Solo con permiso de edición de costes.
 function confirmarCodigos(d,i){
  const x=d.resultado,lib=window.DafricaAlbaranes;if(!x||!has("costes.editar")||!lib?.confirmadas)return "";
  const pendientes=(x.lineas||[]).map((l,f)=>({l,f})).filter(({l})=>l.referencia?.literal&&!(l.referencia.estado==="OK"&&(l.referencia.confianza??0)>=0.9));
  if(!pendientes.length)return "";
  if(!lib.confirmadas.clave(x.proveedor))return '<p class="muted">Códigos pendientes: identifica antes el proveedor para poder confirmarlos.</p>';
  // Propuesta: lo leído o, si lleva texto pegado o un espacio, la parte con forma de código.
  const perfil=lib.confirmadas.perfilDe?.(x.proveedor);
  const propuesta=r=>{const t=String(r.valor||r.literal||"").trim();
   const opciones=[t,t.split(/\s+/)[0],t.replace(/\s+/g,"")];
   return (lib.confirmadas.codigoValido?opciones.find(o=>lib.confirmadas.codigoValido(o,perfil)):null)||t;};
  return '<div style="margin-top:8px"><b>Confirmar códigos</b> <span class="muted">(revisa el código con el papel letra a letra; corrígelo si hace falta; si dudas, no lo confirmes)</span>'+
   pendientes.map(({l,f})=>'<div style="display:flex;gap:6px;align-items:center;margin:4px 0;flex-wrap:wrap">'+
    '<input id="lalRef_'+i+'_'+f+'" value="'+esc(propuesta(l.referencia))+'" style="width:190px">'+
    '<span class="muted">'+esc(l.descripcion?.valor||"")+'</span>'+
    ((l.referencia.motivos||[]).some(m=>/dos renglones|Frontera entre código y descripción/.test(m))?
     '<span class="error">Ojo: el código ocupa dos renglones o lleva texto pegado; escríbelo exactamente como en el papel (espacios y guiones).</span>':'')+
    '<button type="button" class="btn secondary" data-lal-confirmar="'+i+':'+f+'">Confirmar código</button>'+
    '<span id="lalRefEstado_'+i+'_'+f+'" class="muted"></span></div>').join("")+'</div>';
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
 // Script propio de la web (albaranes/vendor/), cargado solo cuando hace falta.
 function cargarScript(src,global){
  if(window[global])return Promise.resolve(window[global]);
  return new Promise((ok,mal)=>{const sc=document.createElement("script");sc.src=src;sc.async=true;
   sc.onload=()=>window[global]?ok(window[global]):mal(Error("No se ha cargado "+global));sc.onerror=()=>mal(Error("No se ha cargado "+src));
   document.head.appendChild(sc);});
 }
 // Tabla de un CSV o de la primera hoja de un Excel (.xlsx o .xls): lista de filas de celdas.
 async function leerTabla(archivo){
  if(/\.csv$|\.txt$/i.test(archivo.name))return window.DafricaAlbaranes.datosReferencia.parseCsv(await archivo.text());
  const X=await cargarScript("albaranes/vendor/xlsx.full.min.js?v="+VERSION_LECTOR,"XLSX");
  const libro=X.read(new Uint8Array(await archivo.arrayBuffer()),{type:"array"});
  return X.utils.sheet_to_json(libro.Sheets[libro.SheetNames[0]],{header:1,raw:false,defval:""});
 }
 // Envío por bloques a una tabla del lector (los repetidos se ignoran).
 async function insertar(tabla,conflicto,filas,alAvanzar){
  for(let i=0;i<filas.length;i+=500){
   await sb("/rest/v1/"+tabla+"?on_conflict="+conflicto,{method:"POST",headers:{"Content-Type":"application/json",Prefer:"resolution=ignore-duplicates,return=minimal"},
    body:JSON.stringify(filas.slice(i,i+500))});
   alAvanzar(Math.min(filas.length,i+500));
  }
 }
 // Datos de referencia del lector (permiso costes.editar): lista de obras, tarifas de proveedor y
 // etiquetas de obra con QR. Nada de precios: de las tarifas solo se toman código y descripción.
 function panelReferencia(){
  const provs=(window.DafricaAlbaranes?.proveedores?.REGISTRO?.proveedores||[]).slice().sort((a,b)=>String(a.nombre).localeCompare(String(b.nombre)));
  return '<details style="margin-top:14px;border-top:1px solid #d6dee8;padding-top:8px"><summary style="cursor:pointer;font-weight:bold">Datos de referencia del lector</summary>'+
   '<p class="muted">Mejoran la validación automática. Solo se guardan códigos, nombres y descripciones; nunca precios.</p>'+
   '<h4>Lista de obras</h4><p class="muted">CSV o Excel con columnas «Código» (PRY00000) y «Nombre» (por ejemplo, la lista de proyectos exportada de STEL). Con ella, un código de obra escrito a mano se valida si existe y su nombre coincide con la obra del albarán o del albarán de compra de STEL.</p>'+
   '<input type="file" id="lalObrasArchivo" accept=".csv,.txt,.xlsx,.xls"> <label style="display:inline-flex;gap:4px;align-items:center"><input type="checkbox" id="lalObrasCompleta" style="width:auto"> Es el listado completo de proyectos de STEL</label> '+
   '<button type="button" class="btn secondary" id="lalObrasImportar">Importar obras</button> <span class="muted" id="lalObrasEstado"></span>'+
   '<h4>Tarifa o catálogo de un proveedor</h4><p class="muted">CSV o Excel con columnas «Código»/«Referencia» y «Descripción». Un código leído se valida si existe una sola vez en la tarifa de ese proveedor y la descripción coincide.</p>'+
   '<select id="lalTarifaProv"><option value="">Proveedor…</option>'+provs.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.nombre)+'</option>').join("")+'</select> '+
   '<input type="file" id="lalTarifaArchivo" accept=".csv,.txt,.xlsx,.xls"> <button type="button" class="btn secondary" id="lalTarifaImportar">Importar tarifa</button> <span class="muted" id="lalTarifaEstado"></span>'+
   '<h4>Etiquetas de obra con QR</h4><p class="muted">Hoja A4 para imprimir: se pega una etiqueta en cada albarán al recibirlo y el lector toma el código de obra del QR, sin depender de la letra a mano.</p>'+
   '<input id="lalEtqCodigo" placeholder="PRY00000" style="width:120px"> <input id="lalEtqNombre" placeholder="Nombre de la obra" style="width:220px"> '+
   '<button type="button" class="btn secondary" id="lalEtqDescargar">Descargar hoja de etiquetas</button> <span class="muted" id="lalEtqEstado"></span></details>';
 }
 function montarReferencia(){
  const lib=window.DafricaAlbaranes;
  $("lalObrasImportar").onclick=async()=>{
   const f=$("lalObrasArchivo").files?.[0],est=$("lalObrasEstado");if(!f){est.textContent="Elige un fichero.";return;}
   try{
    est.textContent="Leyendo…";
    const r=lib.datosReferencia.filasObras(await leerTabla(f));
    if(r.error){est.textContent=r.error;return;}
    if(!r.filas.length){est.textContent="No hay ninguna obra con código PRY y 5 cifras.";return;}
    await insertar("lector_obras","codigo",r.filas.map(x=>({...x,origen:"lista"})),n=>{est.textContent="Guardando "+n+" de "+r.filas.length+"…";});
    // Listado completo: el lector puede usar la lectura a una cifra con el nombre de la obra.
    if($("lalObrasCompleta").checked)
     await sb("/rest/v1/lector_ajustes?on_conflict=clave",{method:"POST",headers:{"Content-Type":"application/json",Prefer:"resolution=merge-duplicates,return=minimal"},
      body:JSON.stringify({clave:"obras_lista_completa",valor:{total:r.filas.length,fecha:new Date().toISOString().slice(0,10)}})});
    est.textContent="✓ "+r.filas.length+" obras importadas"+(r.repetidas?" · "+r.repetidas+" códigos con dos nombres distintos no importados":"")+(r.descartadas?" · "+r.descartadas+" filas sin código PRY válido":"")+".";
   }catch(e){est.textContent="No se ha podido importar: "+(e?.message||e);}
  };
  $("lalTarifaImportar").onclick=async()=>{
   const id=$("lalTarifaProv").value,f=$("lalTarifaArchivo").files?.[0],est=$("lalTarifaEstado");
   if(!id){est.textContent="Elige el proveedor.";return;}if(!f){est.textContent="Elige un fichero.";return;}
   try{
    est.textContent="Leyendo…";
    const r=lib.datosReferencia.filasTarifa(await leerTabla(f),"perfil:"+id);
    if(r.error){est.textContent=r.error;return;}
    if(!r.filas.length){est.textContent="No hay códigos con descripción.";return;}
    await insertar("lector_referencias_confirmadas","proveedor_clave,referencia",r.filas,n=>{est.textContent="Guardando "+n+" de "+r.filas.length+"…";});
    est.textContent="✓ "+r.filas.length+" códigos importados"+(r.repetidas?" · "+r.repetidas+" códigos repetidos con descripciones distintas no importados":"")+".";
   }catch(e){est.textContent="No se ha podido importar: "+(e?.message||e);}
  };
  $("lalEtqDescargar").onclick=async()=>{
   const est=$("lalEtqEstado"),codigo=String($("lalEtqCodigo").value||"").toUpperCase().replace(/[^A-Z0-9]/g,"");
   try{
    const qrcode=await cargarScript("albaranes/vendor/qrcode.js?v="+VERSION_LECTOR,"qrcode");
    descargar("etiquetas-"+codigo+".html","text/html;charset=utf-8",lib.etiquetas.hojaEtiquetas({codigo,nombre:$("lalEtqNombre").value},qrcode));
    est.textContent="✓ Abre el fichero descargado e imprímelo en A4 a tamaño real (100 %).";
   }catch(e){est.textContent=String(e?.message||e);}
  };
 }
 function descargar(nombre,tipo,texto){
  const url=URL.createObjectURL(new Blob([texto],{type:tipo}));
  const a=document.createElement("a");a.href=url;a.download=nombre;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
};
})();
