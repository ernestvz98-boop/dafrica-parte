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
const {permitido,cancelar,rutaSinDatos,operacion}=require("./guardia.js");
const E=require("./escritura.js");
const C=require("../albaranes/cola-stel.js");
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
 const ctx=await nav.newContext({storageState:estado,viewport:{width:1500,height:1000},serviceWorkers:"block"});
 const registro={canceladas:[],escrituras:[],adjuntoAbierto:false,respuestas:[],diario:[]};
 const autorizadas=new Set();
 await ctx.route("**/*",async ruta=>{
  const r=ruta.request(),cuerpo=r.postData()||"";
  let op=operacion(cuerpo);if(!op){try{op=new URL(r.url()).searchParams.get("operacion")||"";}catch{}}
  // Diario de TODAS las peticiones a STEL (método, ruta y operación; nunca datos).
  try{const u=new URL(r.url());if(/(^|\.)stelorder\.com$/i.test(u.hostname))registro.diario.push(new Date().toISOString().slice(11,23)+" "+r.method()+" "+rutaSinDatos(r.url())+(op?" op="+op:"")+(r.resourceType()?" ["+r.resourceType()+"]":""));}catch{}
  if(!permitido(r.method(),r.url(),"lectura",cuerpo)){
   let u=null;try{u=new URL(r.url());}catch{}
   const deStel=u&&r.method()==="POST"&&/(^|\.)stelorder\.com$/i.test(u.hostname);
   const multipart=/multipart\/form-data/i.test(r.headers()["content-type"]||"");
   if(deStel&&autorizador){
    let res=null;
    if(multipart&&registro.adjuntoAbierto)res=autorizador.autorizar("adjunto",null,{multipart,cuerpoTexto:(r.postDataBuffer()||Buffer.alloc(0)).toString("latin1")});
    else if(["guardarProducto","guardarDocumentoComercial"].includes(op))res=autorizador.autorizar(op,new URLSearchParams(cuerpo));
    else if(registro.adjuntoAbierto)res=autorizador.autorizar("enlazarAdjunto",null,{operacion:op,cuerpoTexto:decodeURIComponent(cuerpo.replace(/\+/g," "))});
    if(res){
     const campos=res[0]||multipart?undefined:[...new URLSearchParams(cuerpo).keys()].slice(0,40);
     registro.escrituras.push({t:new Date().toISOString(),op:multipart?"adjunto":op,permitida:res[0],motivo:res[1],diag:res[2],...(campos?{campos}:{})});
     if(res[0]){autorizadas.add(r);return ruta.continue();}
     return cancelar(ruta);
    }
   }
   // De una subida cancelada solo se anotan los NOMBRES de sus campos (nunca valores ni el fichero).
   const campos=multipart?[...new Set(((r.postDataBuffer()||Buffer.alloc(0)).toString("latin1").match(/name="[^"]{1,60}"/g)||[]).map(x=>x.slice(6,-1)))].slice(0,30):undefined;
   let clavesLinea;
   if(!multipart&&op==="guardarDocumentoComercial"){try{const L=JSON.parse(new URLSearchParams(cuerpo).get("lineasDocumentoComercial")||"[]");clavesLinea=Object.keys(L[0]||{}).slice(0,80);}catch{}}
   registro.canceladas.push({t:new Date().toISOString(),ruta:rutaSinDatos(r.url()),op:multipart?"(subida)":op,...(campos?{campos}:{}),
    ...(clavesLinea?{campos_documento:[...new URLSearchParams(cuerpo).keys()].slice(0,80),claves_linea:clavesLinea}:{})});
   return cancelar(ruta);
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
 const cerrar=nav.close.bind(nav);
 // Antes de cerrar, fuera de STEL (página en blanco): que no quede ninguna petición suya en marcha.
 nav.close=async()=>{try{await p.goto("about:blank",{timeout:15000});await p.waitForTimeout(1000);}catch{}try{fs.writeFileSync(path.join(dir,"diario-"+new Date().toISOString().replace(/[:.]/g,"-")+".txt"),registro.diario.join("\n"));}catch{}return cerrar();};
 return {nav,p,registro,captura};
}

// «¿Deseas continuar y perder los datos no guardados?»: solo sale con algo SIN guardar (el ensayo, o un paso
// que no llegó a guardarse); aceptar lo descarta y no escribe nada en STEL.
async function descartarSinGuardar(p){
 await p.waitForTimeout(2500);
 if(await p.getByText("perder los datos no guardados").first().isVisible().catch(()=>false)){
  await p.getByRole("button",{name:"Aceptar",exact:true}).filter({visible:true}).first().click({timeout:10000});await p.waitForTimeout(3000);
 }
}
const ir=async(p,hash,texto)=>{
 // Como una persona: el enlace del menú principal (si no está visible, el ancla) y el del submenú.
 const a=p.locator('a[href="'+hash+'"]').first();
 if(await a.count())await a.click({timeout:15000});else await p.evaluate(h=>{location.hash=h;},hash);
 await descartarSinGuardar(p);await p.waitForTimeout(5000);
 if(texto){await p.locator('a:visible:text-is("'+texto+'")').first().click({timeout:15000});await descartarSinGuardar(p);await p.waitForTimeout(6000);}
};
async function buscarEnLista(p,q){
 await p.locator("input.buscadorListado:visible").first().fill(q);await p.keyboard.press("Enter");await p.waitForTimeout(8000);
 const t=await p.locator("body").innerText();
 const m=t.match(/Mostrando \d+ a \d+ de (\d+)/);
 return m?Number(m[1]):null;
}

// Lista del catálogo con 500 filas por página: las filas {id, referencia, descripcion} de una búsqueda
// (filas null si no caben en una página o no se pudieron leer todas).
const POR_PAGINA=500;
async function abrirCatalogo(p){
 await ir(p,"#main_catalogo");
 await p.locator("select[name=cat_tabla_length]:visible").first().selectOption(String(POR_PAGINA));await p.waitForTimeout(8000);
}
async function filasCatalogo(p,q){
 const n=await buscarEnLista(p,q);
 if(n==null||n>POR_PAGINA)return {n,filas:null};
 const filas=await p.locator("#cat_tabla:visible tbody tr[id]").evaluateAll(trs=>trs.map(tr=>({id:tr.id,
  referencia:(tr.querySelector("td:nth-child(3)")?.innerText||"").trim(),descripcion:(tr.querySelector("td.tdTextoLargo")?.innerText||"").trim()})));
 return {n,filas:filas.length===n?filas:null};
}
const canon=t=>String(t??"").toUpperCase().replace(/[^A-Z0-9]/g,"");

/*
 * Artículo «buscar» (la web leyó el catálogo a medias): la referencia exacta en STEL, si es UNA, se usa.
 * Si no existe, antes de crearlo se buscan en STEL artículos parecidos con la misma regla que la web
 * (albaranes/cola-stel.js: referencia a un carácter, mismas cifras, descripción contenida); si hay alguno,
 * o alguna búsqueda no se puede leer entera, se para. Búsquedas: la referencia, sus dos mitades (un
 * carácter cambiado deja intacta una de ellas), sus cifras y las palabras de la descripción (de una en
 * una; si salen más de 500, con la siguiente palabra, hasta tres).
 */
async function resolverArticulo(p,l){
 const {referencia:ref,descripcion:desc}=l.articulo.propuesta,r=canon(ref),cifras=r.replace(/\D/g,"");
 const vistas=new Map();
 const leer=async q=>{const x=await filasCatalogo(p,q);if(x.filas)for(const f of x.filas)vistas.set(f.id,f);return x;};
 const exacta=await leer(ref);
 if(!exacta.filas)return "no se pudo leer la búsqueda de "+ref+" en STEL";
 const iguales=exacta.filas.filter(f=>canon(f.referencia)===r);
 if(iguales.length>1)return "la referencia "+ref+" está "+iguales.length+" veces en STEL";
 if(iguales.length===1){l.articulo={estado:"existente",item_id:iguales[0].id,via:"robot_stel_referencia"};return null;}
 const consultas=new Set();
 if(r.length>=4){consultas.add(r.slice(0,Math.ceil(r.length/2)));consultas.add(r.slice(Math.ceil(r.length/2)));}
 if(cifras.length>=5)consultas.add(cifras);
 for(const q of consultas)if(!(await leer(q)).filas)return "demasiados artículos de STEL con «"+q+"» para descartar parecidos de "+ref;
 const pal=[...new Set(C.palabras(desc))];
 async function porPalabras(desde,conjunto){
  for(let i=desde;i<pal.length;i++){
   const s=[...conjunto,pal[i]],x=await leer(s.join(" "));
   if(x.n===0||x.filas)continue;
   if(x.n==null||s.length>=3)return "demasiados artículos de STEL con «"+s.join(" ")+"» para descartar parecidos de "+ref;
   const e=await porPalabras(i+1,s);if(e)return e;
  }
  return null;
 }
 const e=await porPalabras(0,[]);if(e)return e;
 const parecidos=C.parecidosParaAlta(ref,desc,[...vistas.values()]);
 if(parecidos.length)return "el artículo "+ref+" no está en STEL pero se parece a "+parecidos.map(id=>{const f=vistas.get(String(id));return f.referencia+" «"+f.descripcion+"»";}).join("; ");
 l.articulo={estado:"crear",item_id:null,via:"robot_stel_sin_parecidos",busquedas:vistas.size,propuesta:{referencia:ref,descripcion:desc}};
 return null;
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

// Artículo por referencia exacta en el selector del catálogo de una línea (ha de haber UNA fila): su id.
async function elegirArticulo(p,i,ref){
 await p.locator("#lineaDocumentoComercial_producto:visible").nth(i).click({timeout:15000});await p.waitForTimeout(8000);
 await p.locator("#modalObjetosCatalogo_dialog input.buscadorIndividual:visible").first().fill(ref);await p.keyboard.press("Enter");await p.waitForTimeout(7000);
 const filas=p.locator("#modalObjetosCatalogo_dialog tbody tr");
 const html=await p.locator("#modalObjetosCatalogo_dialog tbody").first().evaluate(e=>e.innerHTML);
 const exactas=(html.match(new RegExp(">"+ref.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"<","g"))||[]).length;
 if((await filas.count())!==1||exactas!==1)throw Error("el selector no da una única fila para "+ref);
 // La fila lleva el id del artículo de STEL (el que irá en la línea).
 const id=await filas.first().getAttribute("id");
 await p.locator('#modalObjetosCatalogo_dialog tbody tr td.tdBold').first().click({timeout:15000});await p.waitForTimeout(6000);
 return id;
}

async function crearArticulo(p,ref,nombre){
 // A la lista de productos (tras guardar otro artículo, STEL se queda en su ficha, sin botón «Crear»).
 await ir(p,"#main_catalogo","Productos");
 await p.locator("button.opcionMenuCrear:visible").first().click({timeout:15000});await p.waitForTimeout(8000);
 // Serie MANUAL (valor -2), referencia y nombre del lector; nada más.
 await p.locator("#comboReferencias").first().selectOption("-2",{force:true});await p.locator("#comboReferencias").first().dispatchEvent("change");await p.waitForTimeout(1500);
 await p.locator("#referencia:visible").first().fill(ref);
 await p.locator("#nombre:visible").first().fill(nombre);
 await p.waitForTimeout(1000);
}

// Botón «Guardar» de la barra del formulario abierto (no «Guardar y editar»).
const botonGuardar=p=>p.locator("div.toolbar button:visible").filter({hasText:/^\s*Guardar\s*$/});

// Rellena el albarán (sin guardar). Devuelve la orden con los datos que se han puesto.
async function rellenarAlbaran(p,plan,{captura}){
 await ir(p,"#main_gastosycompras","Albaranes de proveedor");
 await p.locator("button.opcionMenuCrear:visible").first().click({timeout:15000});await p.waitForTimeout(12000);
 // Proveedor: la única sugerencia con el nombre de la cuenta de STEL (o el leído, si STEL no lo dio) y,
 // elegida, ha de ser la cuenta de la orden (id de cliente del formulario).
 const nombre=plan.proveedor.nombre_stel||plan.proveedor.nombre_leido;
 if(!nombre)throw Error("orden sin nombre de proveedor");
 // Sugerencias de cuentas existentes cuyo nombre empieza igual que el de la orden (sin signos: «ACME
 // SUMINISTROS» vale para «ACME SUMINISTROS, S.L.»); nunca la de «Nuevo proveedor» (crearía uno).
 const sugerencias=async()=>{
  const t=await p.locator("td.nombrePredictivo:visible").evaluateAll(tds=>tds.map(td=>({texto:td.innerText,fila:(td.closest("tr")||td).innerText})));
  const n=canon(nombre);
  return t.map((x,i)=>({...x,i})).filter(x=>!/nuevo\s+proveedor/i.test(x.fila)&&x.texto.split("\n").map(canon).some(c=>c.length>=6&&(n.startsWith(c)||c.startsWith(n)))).map(x=>x.i);
 };
 let ok=false;
 const campoProv=p.locator("#nombreClienteALBARANDEPROVEEDOR:visible");
 for(let i=0;i<3&&!ok;i++){
  // Pulsar, vaciar y escribir con calma (fallo real: se perdía la primera letra); esperar a que STEL busque.
  // La casilla se convierte en desplegable con buscador al activarla: activarla, esperar y escribir
  // donde STEL deja el cursor (el buscador o la propia casilla).
  await campoProv.evaluate(e=>{e.value="";e.focus();});await p.waitForTimeout(1500);
  await p.keyboard.press("Control+A");await p.keyboard.press("Backspace");
  await p.keyboard.type(nombre.slice(0,14),{delay:90});
  for(let t=0;t<15&&!ok;t++){await p.waitForTimeout(1000);ok=(await sugerencias()).length===1;}
 }
 if(!ok)throw Error("la sugerencia del proveedor no es única");
 await p.locator("td.nombrePredictivo:visible").nth((await sugerencias())[0]).click();await p.waitForTimeout(6000);
 const idCliente=await campoProv.evaluate(e=>{for(let a=e.parentElement;a;a=a.parentElement){const c=a.querySelector("#idCliente");if(c)return c.textContent.trim();}return "";});
 if(idCliente!==String(plan.proveedor.account_id))throw Error("el proveedor elegido no es la cuenta de la orden");
 await p.locator("#fechaALBARANDEPROVEEDOR:visible").fill(plan.fecha);await p.waitForTimeout(800);
 await p.locator("#referenciaDocumentoExtraALBARANDEPROVEEDOR:visible").fill(plan.numero);await p.waitForTimeout(1000);
 for(const [i,l] of plan.lineas.entries()){
  if(i){await p.getByText("Nueva línea",{exact:true}).first().click();await p.waitForTimeout(3000);}
  const id=await elegirArticulo(p,i,l.referencia_stel||l.articulo.propuesta?.referencia||l.referencia);
  if(l.articulo.item_id!=null&&String(l.articulo.item_id)!==String(id))throw Error("el artículo elegido en la línea "+(i+1)+" no es el de la orden");
  l.articulo.item_id=id;
  const precio=Number.isFinite(l.precio)?l.precio:Number.isFinite(l.precio_pedido)?l.precio_pedido:0;
  if(!Number.isFinite(l.precio)&&!Number.isFinite(l.precio_pedido))
   await p.locator("textarea[name=_descripcionCompleta]:visible").nth(i).fill("PRECIO PENDIENTE (el albarán del proveedor no trae precio)");
  // El precio con todos sus decimales (fallo real: un precio como 2,345 se escribía redondeado a 2,35); se comprueba lo que queda.
  const casillaPrecio=p.locator("input[name=_precioBaseTarifa]:visible").nth(i);
  await casillaPrecio.fill(String(precio).replace(".",","));await p.keyboard.press("Tab");await p.waitForTimeout(800);
  const visto=Number(String(await casillaPrecio.inputValue()).trim().replace(/\./g,"").replace(",","."));
  if(!(Math.abs(visto-precio)<0.00005))throw Error("el precio de la línea "+(i+1)+" no queda exacto en STEL");
  await p.locator("input[name=_unidades]:visible").nth(i).fill(String(l.cantidad).replace(".",","));await p.keyboard.press("Tab");await p.waitForTimeout(800);
  const dto=E.descuentoLinea(l);
  if(dto==null)throw Error("descuento no representable en la línea "+(i+1));
  // Tabulador desde el descuento (última casilla) abre una línea nueva en STEL: se confirma hacia atrás.
  if(dto>0){await p.locator("input[name=_descuento]:visible").nth(i).fill(dto.toFixed(2).replace(".",","));await p.keyboard.press("Shift+Tab");await p.waitForTimeout(800);}
 }
 await p.locator('li:visible:text-is("Más información"), a:visible:text-is("Más información")').first().click();await p.waitForTimeout(3000);
 // El desplegable de la obra está oculto (select2): el del formulario abierto es el último; se comprueba en pantalla.
 const sel=p.locator("#selectProyectos").last();
 // Sin id de STEL en la orden: el proyecto cuyo nombre termina en «(código)», solo si es uno.
 if(plan.obra.stel_id==null){
  const cod="("+String(plan.obra.codigo).toUpperCase()+")";
  const ops=await sel.evaluate((e,c)=>[...e.options].filter(o=>o.text.trim().toUpperCase().endsWith(c)).map(o=>({id:o.value,texto:o.text.trim()})),cod);
  if(ops.length!==1)throw Error(ops.length?"la obra "+plan.obra.codigo+" está "+ops.length+" veces en los proyectos de STEL":"la obra "+plan.obra.codigo+" no está en los proyectos de STEL");
  plan.obra.stel_id=ops[0].id;plan.obra.nombre=ops[0].texto.slice(0,-cod.length).trim().slice(0,150)||null;
 }
 await sel.selectOption(String(plan.obra.stel_id),{force:true});await sel.dispatchEvent("change");await p.waitForTimeout(2000);
 const obraVista=await sel.evaluate(e=>e.options[e.selectedIndex]?.text||"");
 if(!obraVista.toUpperCase().includes(String(plan.obra.codigo).toUpperCase())&&!obraVista.toUpperCase().includes(String(plan.obra.nombre||"").toUpperCase().slice(0,10)))
  throw Error("la obra elegida no es la de la orden");
 await p.locator("#observacionesALBARANDEPROVEEDOR:visible").fill(("Albarán "+plan.numero+" del proveedor, escaneado y leído por DAFRICA Control."+
  (plan.aviso_precio?" PRECIO PENDIENTE: el albarán no trae precio; completar antes de facturar.":"")).slice(0,500));
 await p.locator("#comentariosALBARANDEPROVEEDOR:visible").fill("Creado por el robot de DAFRICA Control (Fase 2) desde la cola de albaranes leídos. Obra "+plan.obra.codigo+".");
 await p.locator('li:visible:text-is("Líneas"), a:visible:text-is("Líneas")').first().click();await p.waitForTimeout(2500);
 // Título al final y comprobado. STEL convierte la casilla en un desplegable con buscador (select2) al
 // pulsarla; escribir en la casilla oculta no vale. Como una persona: pulsar el título, escribir en el
 // buscador que aparece y confirmar con Intro.
 const tit=E.titulo(plan),campoTit=p.locator("#tituloALBARANDEPROVEEDOR").last();
 // Solo dentro de la celda del título: las líneas también tienen desplegables del mismo tipo (fallo del
 // ensayo de 2026-10-27: el título se escribió en una línea y el Intro añadió otra).
 const celdaTit=p.locator("td:has(#tituloALBARANDEPROVEEDOR)").last();
 for(let i=0;i<3;i++){
  await p.evaluate(()=>window.scrollTo(0,0));await p.waitForTimeout(500);
  await celdaTit.locator("ul.select2-choices:visible, input#tituloALBARANDEPROVEEDOR:visible:not(.select2-offscreen)").first().click({timeout:15000});await p.waitForTimeout(1500);
  const busca=celdaTit.locator("input.select2-input:visible").first();
  if(!await busca.count())continue;
  await busca.fill("");await busca.pressSequentially(tit,{delay:25});await p.waitForTimeout(2500);
  await busca.press("Enter");await p.waitForTimeout(2000);
  if(await campoTit.inputValue()===tit)break;
 }
 const comp={proveedor:[!!(await p.locator("#nombreClienteALBARANDEPROVEEDOR:visible").inputValue()).trim(),true],fecha:[await p.locator("#fechaALBARANDEPROVEEDOR:visible").inputValue(),plan.fecha],
  titulo:[await p.locator("#tituloALBARANDEPROVEEDOR").last().inputValue(),tit],ref_proveedor:[await p.locator("#referenciaDocumentoExtraALBARANDEPROVEEDOR:visible").inputValue(),plan.numero]};
 const mal=Object.entries(comp).filter(([,[v,e]])=>v!==e).map(([k])=>k);
 // STEL añade sola una línea vacía al terminar la última (sin referencia ni nombre de artículo): se
 // quita con su papelera, como haría una persona (solo en pantalla; nada se guarda todavía).
 for(let i=0;i<3;i++){
  const vacias=p.locator("tr:has(input[name=_precioBaseTarifa]:visible)").filter({has:p.locator("input[name=_referenciaObjetoCatalogo]")});
  let quitada=false;
  for(let k=(await vacias.count())-1;k>=0;k--){
   const fila=vacias.nth(k);
   const ref=await fila.locator("input[name=_referenciaObjetoCatalogo]").first().inputValue(),nom=await fila.locator("textarea[name=_nombreObjetoCatalogo]").first().inputValue();
   if(ref.trim()||nom.trim())continue;
   await fila.locator("button.button_soloIconoFichaSinBorde").first().click({timeout:10000});await p.waitForTimeout(1500);
   await descartarSinGuardar(p);quitada=true;break;
  }
  if(!quitada)break;
 }
 const lineasForm=await p.locator("input[name=_precioBaseTarifa]:visible").count();
 if(lineasForm!==plan.lineas.length)mal.push("líneas ("+lineasForm+" en pantalla, "+plan.lineas.length+" en la orden)");
 if(mal.length&&process.env.DETALLE)console.error("DIAGNÓSTICO título:",JSON.stringify(await p.evaluate(()=>[...document.querySelectorAll("#tituloALBARANDEPROVEEDOR")].map(e=>({valor:e.value,clase:e.className,
  visibleContenedor:!!e.parentElement?.offsetParent,padre:(e.parentElement?.outerHTML||"").replace(/value="[^"]*"/g,'value="…"').slice(0,1500),
  select2:typeof window.jQuery?.fn?.select2,datos:(()=>{try{return JSON.stringify(window.jQuery(e).select2("data"));}catch(x){return "ERR "+x.message;}})()})))));
 if(mal.length)throw Error("cabecera distinta de la orden: "+mal.join(", "));
 return await captura("albaran-antes-de-guardar");
}

// Adjunta el PDF del albarán en su pestaña «Adjuntos».
async function adjuntar(p,registro,fichero){
 await p.locator('a:visible:text-is("Adjuntos")').first().click({timeout:15000});await p.waitForTimeout(4000);
 await p.locator("#documentos_add:visible").first().click({timeout:15000});await p.waitForTimeout(3000);
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
 if(plan.lineas.some(l=>E.descuentoLinea(l)==null))return {estado:"PARADO",motivo:"Descuentos de una línea que no caben exactos en la casilla de STEL o que no cuadran con su importe"};
 if(!plan.obra?.codigo)return {estado:"PARADO",motivo:"Orden sin obra"};
 const fichero=path.join(dir,orden.id+".pdf");
 const adj=path.join(dir,"albaran-"+String(plan.numero).replace(/[^0-9A-Za-z]/g,"")+".pdf");
 fs.copyFileSync(fichero,adj);
 // Autorizador por pasos: nada hasta saber qué artículos se crean; luego solo esas altas; con el albarán
 // relleno (obra y artículos con su id de STEL), solo ese albarán y su adjunto.
 const autorizador={actual:null,autorizar:(...a)=>autorizador.actual?autorizador.actual.autorizar(...a):[false,"aún no hay escrituras autorizadas",{}]};
 const {nav,p,registro,captura}=await abrirStel(dir,real?autorizador:null);
 try{return await pasos();}
 catch(e){await captura("error").catch(()=>{});e.registro=registro;throw e;}
 finally{await nav.close();}
 async function pasos(){
  const dup=await hayDuplicado(p,plan.numero);
  if(dup)return {estado:"PARADO",motivo:"Posible duplicado: "+dup,registro};
  // Artículos: los «buscar» se resuelven en STEL (referencia exacta o alta sin parecidos); los «crear» se
  // vuelven a buscar (si apareció, se para).
  if(plan.lineas.some(l=>["buscar","crear"].includes(l.articulo?.estado)))await abrirCatalogo(p);
  const paradas=[];
  for(const l of plan.lineas){
   if(l.articulo?.estado==="buscar"){const m=await resolverArticulo(p,l);if(m)paradas.push(m);}
   else if(l.articulo?.estado==="crear"){
    const ref=l.articulo.propuesta.referencia,x=await filasCatalogo(p,ref);
    if(x.n!==0)return {estado:"PARADO",motivo:"El artículo "+ref+" aparece ahora en STEL ("+x.n+"): revisar antes de crear",registro};
   }else if(l.articulo?.estado!=="existente")return {estado:"PARADO",motivo:"Línea "+l.fila+" sin artículo resuelto",registro};
  }
  if(paradas.length)return {estado:"PARADO",motivo:paradas.join(" · "),registro};
  registro.articulos=plan.lineas.map(l=>({referencia:l.referencia,estado:l.articulo.estado,via:l.articulo.via}));
  autorizador.actual=E.crearAutorizador(E.soloProductos(plan));
  const ids={};
  for(const l of plan.lineas.filter(l=>l.articulo.estado==="crear")){
   const ref=l.articulo.propuesta.referencia;
   await crearArticulo(p,ref,l.articulo.propuesta.descripcion);
   await captura("articulo-"+ref.replace(/[^0-9A-Za-z]/g,"")+"-antes-de-guardar");
   if(!real){registro.botonGuardarArticulo=await botonGuardar(p).count();continue;}
   const antes=registro.respuestas.length;
   await botonGuardar(p).first().click({timeout:15000});await p.waitForTimeout(8000);
   const resp=registro.respuestas.slice(antes).find(x=>x.op==="guardarProducto");
   const id=resp?.texto.match(/"id(?:Producto)?"\s*:\s*"?(\d+)/)?.[1];
   if(!id)return {estado:"ERROR",motivo:"No se pudo confirmar el alta del artículo "+ref,registro};
   ids[ref]=id;l.articulo.item_id=id;
  }
  autorizador.actual=null;
  // En el ensayo los artículos nuevos no se guardan: el albarán se rellena solo con los existentes.
  if(!real)plan.lineas=plan.lineas.filter(l=>l.articulo?.estado!=="crear");
  await rellenarAlbaran(p,plan,{captura});
  registro.obra={codigo:plan.obra.codigo,stel_id:plan.obra.stel_id,nombre:plan.obra.nombre};
  if(!real)registro.botonGuardarAlbaran=await botonGuardar(p).count();
  // Ensayo: «Guardar» con la guardia cancelando el envío (no se escribe nada), para ver qué campos manda STEL.
  if(!real&&process.env.ENSAYO_GUARDAR){await botonGuardar(p).first().click({timeout:15000});await p.waitForTimeout(6000);await captura("ensayo-guardar-cancelado");}
  if(!real){
   // Adjunto de ensayo en un albarán YA existente (ENSAYO_ADJUNTO_EN=referencia): la guardia cancela
   // la subida y queda anotado cómo la envía STEL.
   if(process.env.ENSAYO_ADJUNTO_EN){
    await ir(p,"#main_gastosycompras","Albaranes de proveedor");
    await buscarEnLista(p,process.env.ENSAYO_ADJUNTO_EN);
    await p.getByText(process.env.ENSAYO_ADJUNTO_EN,{exact:true}).first().click({timeout:15000});await p.waitForTimeout(8000);
    await adjuntar(p,registro,adj);await captura("adjunto-ensayo");
   }
   return {estado:"ENSAYO",motivo:"Relleno sin guardar",registro,plan};
  }
  // Con la obra y los artículos que se ven en pantalla: el albarán exacto y su adjunto (sin más altas).
  const e=E.esperado(plan,{ids,fichero:path.basename(adj)});e.productos={};
  autorizador.actual=E.crearAutorizador(e);
  const antes=registro.respuestas.length;
  await botonGuardar(p).first().click({timeout:15000});await p.waitForTimeout(12000);
  const resp=registro.respuestas.slice(antes).find(x=>x.op==="guardarDocumentoComercial");
  const id=resp?.texto.match(/"id"\s*:\s*"?(\d+)/)?.[1];
  if(!id){
   const neg=registro.escrituras.find(x=>x.op==="guardarDocumentoComercial"&&!x.permitida);
   return neg?{estado:"PARADO",motivo:"La guardia canceló el albarán (no se ha creado): "+neg.motivo,registro}:{estado:"ERROR",motivo:"No se pudo confirmar el albarán creado",registro};
  }
  autorizador.actual.idAlbaran(id);
  // La referencia del albarán (la del formulario visible: la ficha de un artículo creado antes también tiene «#referencia»).
  const referencia=await p.locator("#referencia:visible").first().inputValue().catch(()=>"");
  await adjuntar(p,registro,adj);
  const adjOk=autorizador.actual.gastado.adjunto&&autorizador.actual.gastado.enlace&&(await p.locator("body").innerText()).includes(path.basename(adj));
  await captura("albaran-creado");
  return {estado:"CREADO",stel_id:Number(id),stel_referencia:referencia||null,adjunto:adjOk,registro,plan};
 }
}

async function principal(){
 const [modo,dir,id]=process.argv.slice(2);
 if(!modo||!dir)throw Error("Uso: procesar-cola.js preparar|ensayo|crear <carpeta> [id]");
 if(modo==="preparar")return preparar(dir);
 if(modo==="ensayo"){
  const orden=JSON.parse(fs.readFileSync(path.join(dir,id+".orden.json"),"utf8"));
  const r=await procesar(dir,orden,{real:false});
  console.log(JSON.stringify({estado:r.estado,motivo:r.motivo,articulos:r.registro?.articulos,obra:r.registro?.obra,botones_guardar:{articulo:r.registro?.botonGuardarArticulo,albaran:r.registro?.botonGuardarAlbaran},canceladas:(r.registro?.canceladas||[]).filter(x=>x.op!=="obtenerNuevasNotificacionesPUSH").slice(-4)},null,1));return;
 }
 if(modo==="crear"){
  const aprobados=JSON.parse(fs.readFileSync(path.join(dir,"aprobados.json"),"utf8"));
  // Antes de tomar ningún albarán de la cola: la sesión de STEL ha de seguir abierta (si no, nada cambia).
  {const {nav}=await abrirStel(dir,null);await nav.close();}
  for(const [cid,dec] of Object.entries(aprobados)){
   const orden=JSON.parse(fs.readFileSync(path.join(dir,cid+".orden.json"),"utf8"));
   const {tomado}=await cola({accion:"empezar",id:cid});
   if(!tomado){console.log(cid+": ya no está pendiente");continue;}
   let r;
   try{r=dec.aprobado?await procesar(dir,orden,{real:true}):{estado:"PARADO",motivo:"Revisión: "+dec.motivo};}
   catch(e){r={estado:"ERROR",motivo:String(e?.message||e).slice(0,300),registro:e?.registro};}
   const resultado={motivo:r.motivo||null,adjunto:r.adjunto??null,revisado_por:"Claude (comparación con el PDF)",
    escrituras:(r.registro?.escrituras||[]).map(x=>({op:x.op,permitida:x.permitida,motivo:x.motivo})),canceladas:(r.registro?.canceladas||[]).length};
   await cola({accion:"terminar",id:cid,estado:r.estado,resultado,stel_id:r.stel_id,stel_referencia:r.stel_referencia});
   console.log(cid+": "+r.estado+(r.motivo?" · "+r.motivo:"")+(r.stel_referencia?" · "+r.stel_referencia:""));
   // Ante un error (estado dudoso en STEL) no se sigue con los demás: primero se revisa.
   if(r.estado==="ERROR"){console.log("Lote detenido tras un error: revisar antes de seguir");break;}
  }
 }
}
if(require.main===module)principal().then(()=>process.exit(0),e=>{console.error("Robot detenido:",String(e?.message||e).slice(0,process.env.DETALLE?3000:300));process.exit(1);});
module.exports={preparar,procesar,abrirStel,ir,buscarEnLista};
