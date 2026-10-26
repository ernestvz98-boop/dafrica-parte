#!/usr/bin/env node
"use strict";
/*
 * DAFRICA · Robot de STEL que ejecuta la cola de albaranes (Fase 2, aprobada por el usuario el 2026-10-26).
 *
 *   node robot-stel/procesar-cola.js preparar <carpeta>          pendientes, PDF de cada albarán e imágenes
 *   node robot-stel/procesar-cola.js ensayo <carpeta> <id>       rellena en STEL SIN guardar (capturas)
 *   node robot-stel/procesar-cola.js crear <carpeta>             crea los aprobados (aprobados.json)
 *
 * <carpeta>: privada, fuera del repositorio (PDF, imágenes y capturas con datos reales).
 * Variables: STEL_WEB_ESTADO (sesión de STEL guardada por explorar.js) y ROBOT_LLAVE_FICHERO (llave
 * temporal de la cola). Nunca se imprimen ni se guardan en el repositorio.
 *
 * Revisión humana del modelo (petición del usuario): «preparar» deja el PDF de cada albarán en imágenes
 * junto a su orden; Claude los compara y escribe aprobados.json ({id: {aprobado, motivo}}). «crear» solo
 * toca los aprobados; los rechazados quedan PARADOS con su motivo.
 *
 * Seguridad: toda petición pasa por guardia.js (solo lectura) y escritura.js (solo el albarán exacto de
 * la orden, sus artículos nuevos y su adjunto, una vez). Antes de crear, se busca en STEL el número del
 * proveedor: si aparece, se para (posible duplicado). Albaranes con pedido (PAP): de momento se paran
 * (la regla de entregas parciales y «generar desde el pedido» aún no está automatizada).
 */
const fs=require("fs"),path=require("path"),{execFileSync}=require("child_process");
const {permitido,rutaSinDatos,operacion}=require("./guardia.js");
const E=require("./escritura.js");
const COLA=process.env.ROBOT_COLA_URL||"https://sbocfjxamjmwabmqbeyw.supabase.co/functions/v1/robot-cola";
const STEL="https://app.stelorder.com/app/";
const TERCEROS=/(^|\.)(google\.com|gstatic\.com|googleapis\.com|gvt1\.com|stripe\.com|google-analytics\.com|googletagmanager\.com|doubleclick\.net|hotjar\.com|facebook\.net|intercom\.io|intercomcdn\.com)$/i;
const SUSTITUTO="(function(){function n(){return p}var p=new Proxy(n,{get:function(t,k){if(k===Symbol.toPrimitive)return function(){return ''};if(k==='then')return undefined;if(k==='length')return 0;return p},apply:function(){return p},construct:function(){return p}});['firebase','google','Stripe','grecaptcha','gtag','dataLayer'].forEach(function(g){if(!window[g])window[g]=p})})();";
const pausa=ms=>new Promise(r=>setTimeout(r,ms));

// ---------- Cola (función Edge robot-cola, con la llave temporal) ----------
function llave(){
 const f=process.env.ROBOT_LLAVE_FICHERO;if(!f||!fs.existsSync(f))throw Error("Falta ROBOT_LLAVE_FICHERO");
 return fs.readFileSync(f,"utf8").trim();
}
async function cola(cuerpo){
 const r=await fetch(COLA,{method:"POST",headers:{"x-robot-llave":llave(),"Content-Type":"application/json"},body:JSON.stringify(cuerpo),signal:AbortSignal.timeout(60000)});
 const d=await r.json().catch(()=>({}));
 if(!r.ok)throw Error("Cola: "+(d.error||r.status));
 return d;
}

// ---------- preparar ----------
async function preparar(dir){
 const {PDFDocument}=require("pdf-lib");
 fs.mkdirSync(dir,{recursive:true});
 const {pendientes}=await cola({accion:"pendientes"});
 const resumen=[];
 for(const p of pendientes){
  const base=path.join(dir,p.id);
  const todo=path.join(dir,(p.pdf_sha256||p.id)+".pdf");
  if(!fs.existsSync(todo)){const {pdf}=await cola({accion:"pdf",id:p.id});fs.writeFileSync(todo,Buffer.from(pdf,"base64"));}
  // Solo las páginas de este albarán.
  const origen=await PDFDocument.load(fs.readFileSync(todo)),solo=await PDFDocument.create();
  const pags=(p.plan.paginas||[]).map(n=>n-1).filter(n=>n>=0&&n<origen.getPageCount());
  if(!pags.length)throw Error("Albarán sin páginas: "+p.id);
  for(const pg of await solo.copyPages(origen,pags))solo.addPage(pg);
  fs.writeFileSync(base+".pdf",await solo.save());
  execFileSync("pdftoppm",["-r","110","-png",base+".pdf",base+"-pag"]);
  fs.writeFileSync(base+".orden.json",JSON.stringify(p,null,1));
  resumen.push({id:p.id,numero:p.plan.numero,fecha:p.plan.fecha,proveedor:p.plan.proveedor.nombre_stel,obra:p.plan.obra?.codigo,pedido:p.plan.pedido?.codigo||null,lineas:p.plan.lineas.length,
   imagenes:fs.readdirSync(dir).filter(f=>f.startsWith(p.id+"-pag")).map(f=>path.join(dir,f))});
 }
 fs.writeFileSync(path.join(dir,"preparados.json"),JSON.stringify(resumen,null,1));
 console.log(pendientes.length+" pendientes preparados en "+dir);
 return resumen;
}

// ---------- navegador con guardia ----------
async function abrirStel(dir,autorizador){
 const {chromium}=(()=>{try{return require("playwright");}catch{return require("/opt/node-tools/node_modules/playwright");}})();
 const estado=process.env.STEL_WEB_ESTADO;if(!estado||!fs.existsSync(estado))throw Error("Falta STEL_WEB_ESTADO (entra antes con explorar.js)");
 const nav=await chromium.launch(fs.existsSync("/opt/pw-browsers/chromium")?{executablePath:"/opt/pw-browsers/chromium"}:{});
 const ctx=await nav.newContext({storageState:estado,viewport:{width:1500,height:1000}});
 const registro={canceladas:[],escrituras:[],adjuntoAbierto:false,respuestas:[]};
 const autorizadas=new Set();
 await ctx.route("**/*",async ruta=>{
  const r=ruta.request(),cuerpo=r.postData()||"";
  let op=operacion(cuerpo);if(!op){try{op=new URL(r.url()).searchParams.get("operacion")||"";}catch{}}
  if(!permitido(r.method(),r.url(),"lectura",cuerpo)){
   let u=null;try{u=new URL(r.url());}catch{}
   const deStel=u&&r.method()==="POST"&&/(^|\.)stelorder\.com$/i.test(u.hostname);
   const multipart=/multipart\/form-data/i.test(r.headers()["content-type"]||"");
   if(deStel&&autorizador){
    let res=null;
    if(multipart&&registro.adjuntoAbierto)res=autorizador.autorizar("adjunto",null,{multipart,cuerpoTexto:(r.postDataBuffer()||Buffer.alloc(0)).toString("latin1")});
    else if(["guardarProducto","guardarDocumentoComercial"].includes(op))res=autorizador.autorizar(op,new URLSearchParams(cuerpo));
    if(res){
     registro.escrituras.push({t:new Date().toISOString(),op:multipart?"adjunto":op,permitida:res[0],motivo:res[1],diag:res[2]});
     if(res[0]){autorizadas.add(r);return ruta.continue();}
     return ruta.abort("blockedbyclient");
    }
   }
   registro.canceladas.push({t:new Date().toISOString(),ruta:rutaSinDatos(r.url()),op:multipart?"(subida)":op});
   return ruta.abort("blockedbyclient");
  }
  let host="";try{host=new URL(r.url()).hostname;}catch{}
  if(TERCEROS.test(host))return ruta.fulfill({status:200,contentType:"application/javascript",body:SUSTITUTO});
  return ruta.continue();
 });
 const p=await ctx.newPage();
 p.on("response",async resp=>{if(!autorizadas.has(resp.request()))return;let t="";try{t=(await resp.text()).slice(0,2000);}catch{}
  registro.respuestas.push({op:operacion(resp.request().postData()||"")||"adjunto",status:resp.status(),texto:t});});
 await p.goto(STEL,{waitUntil:"domcontentloaded",timeout:60000});
 await p.waitForTimeout(20000);
 if(await p.locator("#form_login_boton:visible").count())throw Error("La sesión de STEL ha caducado: vuelve a entrar con explorar.js");
 const captura=async n=>{const f=path.join(dir,n+".png");await p.screenshot({path:f});return f;};
 return {nav,p,registro,captura};
}

const ir=async(p,hash,texto)=>{
 await p.evaluate(h=>{location.hash=h;},hash);await p.waitForTimeout(8000);
 if(texto){await p.locator('a:visible:text-is("'+texto+'")').first().click({timeout:15000});await p.waitForTimeout(8000);}
};
async function buscarEnLista(p,q){
 await p.locator("input.buscadorListado:visible").first().fill(q);await p.keyboard.press("Enter");await p.waitForTimeout(8000);
 const t=await p.locator("body").innerText();
 const m=t.match(/Mostrando \d+ a \d+ de (\d+)/);
 return m?Number(m[1]):null;
}

// Duplicado: el número del proveedor ya en algún albarán de proveedor de STEL (título o Ref. Documento Proveedor).
async function hayDuplicado(p,numero){
 await ir(p,"#main_gastosycompras","Albaranes de proveedor");
 for(const q of new Set([numero,numero.replace(/[.\s]/g,"")])){
  const n=await buscarEnLista(p,q);
  if(n==null)return "no se pudo comprobar en STEL";
  if(n>0)return "ya hay "+n+" albarán(es) de proveedor con «"+q+"» en STEL";
 }
 await p.locator("input.buscadorListado:visible").first().fill("");
 return null;
}

// Artículo por referencia exacta en el selector del catálogo de una línea: id si hay UNA fila.
async function elegirArticulo(p,i,ref){
 await p.locator("#lineaDocumentoComercial_producto:visible").nth(i).click({timeout:15000});await p.waitForTimeout(8000);
 await p.locator("#modalObjetosCatalogo_dialog input.buscadorIndividual:visible").first().fill(ref);await p.keyboard.press("Enter");await p.waitForTimeout(7000);
 const filas=p.locator("#modalObjetosCatalogo_dialog tbody tr");
 const html=await p.locator("#modalObjetosCatalogo_dialog tbody").first().evaluate(e=>e.innerHTML);
 const exactas=(html.match(new RegExp(">"+ref.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"<","g"))||[]).length;
 if((await filas.count())!==1||exactas!==1)throw Error("el selector no da una única fila para "+ref);
 await p.locator('#modalObjetosCatalogo_dialog tbody tr td.tdBold').first().click({timeout:15000});await p.waitForTimeout(6000);
}

async function crearArticulo(p,ref,nombre){
 await ir(p,"#main_catalogo");
 await p.locator("button.opcionMenuCrear:visible").first().click({timeout:15000});await p.waitForTimeout(8000);
 // Serie MANUAL (valor -2), referencia y nombre del lector; nada más.
 await p.locator("#comboReferencias").first().selectOption("-2",{force:true});await p.locator("#comboReferencias").first().dispatchEvent("change");await p.waitForTimeout(1500);
 await p.locator("#referencia:visible").first().fill(ref);
 await p.locator("#nombre:visible").first().fill(nombre);
 await p.waitForTimeout(1000);
}

// Rellena el albarán (sin guardar). Devuelve la orden con los datos que se han puesto.
async function rellenarAlbaran(p,plan,{captura}){
 await ir(p,"#main_gastosycompras","Albaranes de proveedor");
 await p.locator("button.opcionMenuCrear:visible").first().click({timeout:15000});await p.waitForTimeout(12000);
 // Proveedor: la única sugerencia con el nombre exacto de la cuenta de STEL.
 const nombre=plan.proveedor.nombre_stel;
 let ok=false;
 for(let i=0;i<3&&!ok;i++){
  await p.locator("#nombreClienteALBARANDEPROVEEDOR").fill("");await p.waitForTimeout(1000);
  await p.locator("#nombreClienteALBARANDEPROVEEDOR").pressSequentially(nombre.slice(0,14),{delay:60});await p.waitForTimeout(6000);
  ok=(await p.locator("td.nombrePredictivo:visible").filter({hasText:nombre}).count())===1;
 }
 if(!ok)throw Error("la sugerencia del proveedor no es única");
 await p.locator("td.nombrePredictivo:visible").filter({hasText:nombre}).first().click();await p.waitForTimeout(6000);
 await p.locator("#fechaALBARANDEPROVEEDOR").fill(plan.fecha);await p.waitForTimeout(800);
 await p.locator("#referenciaDocumentoExtraALBARANDEPROVEEDOR").fill(plan.numero);await p.waitForTimeout(1000);
 for(const [i,l] of plan.lineas.entries()){
  if(i){await p.getByText("Nueva línea",{exact:true}).first().click();await p.waitForTimeout(3000);}
  await elegirArticulo(p,i,l.referencia_stel||l.referencia);
  const precio=Number.isFinite(l.precio)?l.precio:Number.isFinite(l.precio_pedido)?l.precio_pedido:0;
  if(!Number.isFinite(l.precio)&&!Number.isFinite(l.precio_pedido))
   await p.locator("textarea[name=_descripcionCompleta]:visible").nth(i).fill("PRECIO PENDIENTE (el albarán del proveedor no trae precio)");
  await p.locator("input[name=_precioBaseTarifa]:visible").nth(i).fill(precio.toFixed(2).replace(".",","));await p.keyboard.press("Tab");await p.waitForTimeout(800);
  await p.locator("input[name=_unidades]:visible").nth(i).fill(String(l.cantidad).replace(".",","));await p.keyboard.press("Tab");await p.waitForTimeout(800);
  if(l.descuentos?.length===1){await p.locator("input[name=_descuento]:visible").nth(i).fill(String(l.descuentos[0]).replace(".",","));await p.keyboard.press("Tab");await p.waitForTimeout(800);}
 }
 await p.locator('li:visible:text-is("Más información"), a:visible:text-is("Más información")').first().click();await p.waitForTimeout(3000);
 await p.locator("#selectProyectos").first().selectOption(String(plan.obra.stel_id),{force:true});await p.locator("#selectProyectos").first().dispatchEvent("change");await p.waitForTimeout(2000);
 await p.locator("#observacionesALBARANDEPROVEEDOR").fill(("Albarán "+plan.numero+" del proveedor, escaneado y leído por DAFRICA Control."+
  (plan.aviso_precio?" PRECIO PENDIENTE: el albarán no trae precio; completar antes de facturar.":"")).slice(0,500));
 await p.locator("#comentariosALBARANDEPROVEEDOR").fill("Creado por el robot de DAFRICA Control (Fase 2) desde la cola de albaranes leídos. Obra "+plan.obra.codigo+".");
 await p.locator("#tituloALBARANDEPROVEEDOR").fill(E.titulo(plan));await p.keyboard.press("Tab");await p.waitForTimeout(2000);
 await p.locator('li:visible:text-is("Líneas"), a:visible:text-is("Líneas")').first().click();await p.waitForTimeout(2500);
 const comp={proveedor:[await p.locator("#nombreClienteALBARANDEPROVEEDOR").inputValue(),nombre],fecha:[await p.locator("#fechaALBARANDEPROVEEDOR").inputValue(),plan.fecha],
  titulo:[await p.locator("#tituloALBARANDEPROVEEDOR").inputValue(),E.titulo(plan)],ref_proveedor:[await p.locator("#referenciaDocumentoExtraALBARANDEPROVEEDOR").inputValue(),plan.numero]};
 const mal=Object.entries(comp).filter(([,[v,e]])=>v!==e).map(([k])=>k);
 if(mal.length)throw Error("cabecera distinta de la orden: "+mal.join(", "));
 return await captura("albaran-antes-de-guardar");
}

// Adjunta el PDF del albarán en su pestaña «Adjuntos».
async function adjuntar(p,registro,fichero){
 await p.locator('a:visible:text-is("Adjuntos")').first().click({timeout:15000});await p.waitForTimeout(4000);
 await p.locator("#documentos_add").click({timeout:15000});await p.waitForTimeout(3000);
 await p.locator(".ui-dialog:visible input#ruta").setInputFiles(fichero);
 await p.locator(".ui-dialog:visible textarea#descripcion").fill("Albarán del proveedor escaneado (DAFRICA Control)");
 registro.adjuntoAbierto=true;
 await p.locator(".ui-dialog:visible button.opcionMenuGuardar").click({timeout:15000});await p.waitForTimeout(8000);
 registro.adjuntoAbierto=false;
}

// ---------- ensayo y creación ----------
async function procesar(dir,orden,{real}){
 const plan=JSON.parse(JSON.stringify(orden.plan));
 if(plan.pedido)return {estado:"PARADO",motivo:"Lleva pedido "+plan.pedido.codigo+": las entregas con pedido aún no se crean solas (regla de entregas parciales)"};
 if(plan.lineas.some(l=>(l.descuentos||[]).length>1))return {estado:"PARADO",motivo:"Línea con varios descuentos: pendiente de automatizar"};
 const fichero=path.join(dir,orden.id+".pdf");
 const adj=path.join(dir,"albaran-"+String(plan.numero).replace(/[^0-9A-Za-z]/g,"")+".pdf");
 fs.copyFileSync(fichero,adj);
 const ids={};
 const autorizador=real?E.crearAutorizador(E.esperado(plan,{ids:Object.fromEntries(plan.lineas.filter(l=>l.articulo?.estado==="crear").map(l=>[l.referencia,"pendiente"])),fichero:path.basename(adj)})):null;
 const {nav,p,registro,captura}=await abrirStel(dir,autorizador);
 try{
  const dup=await hayDuplicado(p,plan.numero);
  if(dup)return {estado:"PARADO",motivo:"Posible duplicado: "+dup,registro};
  // Artículos nuevos: se vuelve a buscar la referencia en STEL; si apareció, se usa ese.
  for(const l of plan.lineas.filter(l=>l.articulo?.estado==="crear")){
   const ref=l.articulo.propuesta.referencia;
   await ir(p,"#main_catalogo");
   const n=await buscarEnLista(p,ref);
   if(n!==0)return {estado:"PARADO",motivo:"El artículo "+ref+" aparece ahora en STEL ("+n+"): revisar antes de crear",registro};
   await crearArticulo(p,ref,l.articulo.propuesta.descripcion);
   await captura("articulo-"+ref.replace(/[^0-9A-Za-z]/g,"")+"-antes-de-guardar");
   if(!real)continue;
   const antes=registro.respuestas.length;
   await p.locator("button.opcionMenuGuardar:visible").first().click({timeout:15000});await p.waitForTimeout(8000);
   const resp=registro.respuestas.slice(antes).find(x=>x.op==="guardarProducto");
   const id=resp?.texto.match(/"id(?:Producto)?"\s*:\s*"?(\d+)/)?.[1];
   if(!id)return {estado:"ERROR",motivo:"No se pudo confirmar el alta del artículo "+ref,registro};
   ids[ref]=id;l.articulo.item_id=id;
  }
  // Con los ids de los artículos ya creados: autorizador del albarán y del adjunto (sin más altas).
  if(real){const e=E.esperado(plan,{ids,fichero:path.basename(adj)});e.productos={};Object.assign(autorizador,E.crearAutorizador(e));}
  await rellenarAlbaran(p,plan,{captura});
  if(!real)return {estado:"ENSAYO",motivo:"Relleno sin guardar",registro};
  const antes=registro.respuestas.length;
  await p.locator("button.opcionMenuGuardar:visible").first().click({timeout:15000});await p.waitForTimeout(12000);
  const resp=registro.respuestas.slice(antes).find(x=>x.op==="guardarDocumentoComercial");
  const id=resp?.texto.match(/"id"\s*:\s*"?(\d+)/)?.[1];
  if(!id)return {estado:"ERROR",motivo:"No se pudo confirmar el albarán creado",registro};
  autorizador.idAlbaran(id);
  const referencia=await p.locator("#referencia").first().inputValue().catch(()=>"");
  await adjuntar(p,registro,adj);
  const adjOk=registro.escrituras.some(x=>x.op==="adjunto"&&x.permitida)&&/albaran-/.test(await p.locator("body").innerText());
  await captura("albaran-creado");
  return {estado:"CREADO",stel_id:Number(id),stel_referencia:referencia||null,adjunto:adjOk,registro};
 }finally{await nav.close();}
}

async function principal(){
 const [modo,dir,id]=process.argv.slice(2);
 if(!modo||!dir)throw Error("Uso: procesar-cola.js preparar|ensayo|crear <carpeta> [id]");
 if(modo==="preparar")return preparar(dir);
 if(modo==="ensayo"){
  const orden=JSON.parse(fs.readFileSync(path.join(dir,id+".orden.json"),"utf8"));
  const r=await procesar(dir,orden,{real:false});
  console.log(JSON.stringify({estado:r.estado,motivo:r.motivo,canceladas:r.registro?.canceladas.slice(-5)},null,1));return;
 }
 if(modo==="crear"){
  const aprobados=JSON.parse(fs.readFileSync(path.join(dir,"aprobados.json"),"utf8"));
  for(const [cid,dec] of Object.entries(aprobados)){
   const orden=JSON.parse(fs.readFileSync(path.join(dir,cid+".orden.json"),"utf8"));
   const {tomado}=await cola({accion:"empezar",id:cid});
   if(!tomado){console.log(cid+": ya no está pendiente");continue;}
   let r;
   try{r=dec.aprobado?await procesar(dir,orden,{real:true}):{estado:"PARADO",motivo:"Revisión: "+dec.motivo};}
   catch(e){r={estado:"ERROR",motivo:String(e?.message||e).slice(0,300)};}
   const resultado={motivo:r.motivo||null,adjunto:r.adjunto??null,revisado_por:"Claude (comparación con el PDF)",
    escrituras:(r.registro?.escrituras||[]).map(x=>({op:x.op,permitida:x.permitida,motivo:x.motivo})),canceladas:(r.registro?.canceladas||[]).length};
   await cola({accion:"terminar",id:cid,estado:r.estado,resultado,stel_id:r.stel_id,stel_referencia:r.stel_referencia});
   console.log(cid+": "+r.estado+(r.motivo?" · "+r.motivo:"")+(r.stel_referencia?" · "+r.stel_referencia:""));
  }
 }
}
if(require.main===module)principal().catch(e=>{console.error("Robot detenido:",String(e?.message||e).slice(0,300));process.exit(1);});
module.exports={preparar,procesar};
