#!/usr/bin/env node
"use strict";
/*
 * DAFRICA · Robot de STEL Order, paso 1: EXPLORAR en SOLO LECTURA (aprobado por el usuario el
 * 2026-10-22; todavía sin modificaciones de ningún tipo).
 *
 *   STEL_WEB_USUARIO=… STEL_WEB_CLAVE=… node robot-stel/explorar.js <carpeta-salida>
 *
 * - Usuario y contraseña SOLO de variables de entorno (ajustes del entorno, nunca en el chat ni en
 *   el repositorio). No se escriben en ningún registro ni fichero.
 * - Toda petición pasa por robot-stel/guardia.js: solo lectura; cualquier escritura se cancela.
 * - No pulsa botones: entra (rellena usuario y contraseña y pulsa Intro) y después solo navega por URL.
 * - En <carpeta-salida> (fuera del repositorio) deja capturas y un informe con las rutas que pide la
 *   web (sin datos) y las peticiones canceladas, para construir después la lectura de obras y
 *   albaranes de compra.
 */
const fs=require("fs"),path=require("path");
const {permitido,cancelar,rutaSinDatos,operacion}=require("./guardia.js");
const cargarPlaywright=()=>{try{return require("playwright");}catch{return require("/opt/node-tools/node_modules/playwright");}};

const INICIO="https://app.stelorder.com/app/";
// Sustituto de los servicios de terceros: objetos que aceptan cualquier llamada y no hacen nada
// (la web los espera definidos: firebase, google, Stripe…). Nada sale a Internet.
const SUSTITUTO="/* sustituto del robot de DAFRICA */(function(){function n(){return p}var p=new Proxy(n,{get:function(t,k){"+
 "if(k===Symbol.toPrimitive)return function(){return ''};if(k==='then')return undefined;if(k==='length')return 0;return p},apply:function(){return p},construct:function(){return p}});"+
 "['firebase','google','Stripe','grecaptcha','gtag','dataLayer'].forEach(function(g){if(!window[g])window[g]=p})})();";
const TERCEROS=/(^|\.)(google\.com|gstatic\.com|googleapis\.com|gvt1\.com|stripe\.com|google-analytics\.com|googletagmanager\.com|doubleclick\.net|hotjar\.com|facebook\.net|intercom\.io|intercomcdn\.com)$/i;

async function explorar(salida){
 const usuario=process.env.STEL_WEB_USUARIO||"",clave=process.env.STEL_WEB_CLAVE||"";
 if(!usuario||!clave)throw Error("Faltan STEL_WEB_USUARIO y STEL_WEB_CLAVE en el entorno");
 fs.mkdirSync(salida,{recursive:true});
 const {chromium}=cargarPlaywright();
 const navegador=await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM?{executablePath:process.env.PLAYWRIGHT_CHROMIUM}:{});
 const informe={inicio:new Date().toISOString(),entrada:null,url_final:null,leidas:{},canceladas:{},fallidas:{},omitidos:{},capturas:[],menu:[]};
 let fase="entrada";
 try{
  // Sesión recordada («Recordar este dispositivo»): cookies guardadas en un fichero FUERA del
  // repositorio (STEL_WEB_ESTADO), para no pedir otro código en cada ejecución.
  const estado=process.env.STEL_WEB_ESTADO||"";
  const tablas=new Set(String(process.env.STEL_WEB_TABLAS||"").split(",").map(x=>x.trim()).filter(Boolean)),plantillas={};
  const contexto=await navegador.newContext(estado&&fs.existsSync(estado)?{storageState:estado}:{});
  await contexto.route("**/*",ruta=>{
   const r=ruta.request(),cuerpo=r.postData()||"";
   let op=operacion(cuerpo);if(!op){try{op=new URL(r.url()).searchParams.get("operacion")||"";}catch{}}
   // Solo el nombre de la operación, nunca el resto del cuerpo (puede llevar datos o credenciales).
   const clave=r.method()+" "+rutaSinDatos(r.url())+(op?" · "+op:"");
   if(!permitido(r.method(),r.url(),fase,cuerpo)){informe.canceladas[clave]=(informe.canceladas[clave]||0)+1;
    // Sin nombre de operación: solo el tipo de contenido y los NOMBRES de los campos (nunca valores).
    if(!op&&r.method()==="POST"){const k=(r.headers()["content-type"]||"").split(";")[0]+" · "+(()=>{try{return [...new URLSearchParams(cuerpo).keys()].slice(0,15).join(",");}catch{return "?";}})();
     informe.sin_operacion=informe.sin_operacion||{};informe.sin_operacion[k]=(informe.sin_operacion[k]||0)+1;}
    return cancelar(ruta);}
   if(r.resourceType()==="xhr"||r.resourceType()==="fetch")informe.leidas[clave]=(informe.leidas[clave]||0)+1;
   // Tablas paginadas pedidas (STEL_WEB_TABLAS="listarProyectosPaginado,…"): se guarda la petición
   // original (filtros y columnas de la tabla) para pedir después todas las filas de una vez.
   if(op&&tablas.has(op)&&!plantillas[op])plantillas[op]={url:r.url(),cuerpo,tipo:r.headers()["content-type"]||"application/x-www-form-urlencoded"};
   // Servicios de terceros que la web carga y el robot no necesita (mapas, pagos, Google): se
   // responden aquí mismo con un fichero vacío, sin salir a Internet. Sin ellos la web no termina
   // de entrar («Logging in») porque el entorno no permite esos dominios.
   let host="";try{host=new URL(r.url()).hostname;}catch{}
   if(TERCEROS.test(host)){informe.omitidos[host]=(informe.omitidos[host]||0)+1;
    return ruta.fulfill({status:200,contentType:r.resourceType()==="stylesheet"?"text/css":"application/javascript",body:r.resourceType()==="stylesheet"?"":SUSTITUTO});}
   return ruta.continue();
  });
  const p=await contexto.newPage();
  informe.tablas={};
  // Errores de la propia web (solo el mensaje, recortado): para saber por qué no termina de cargar.
  informe.errores=[];
  p.on("pageerror",e=>{if(informe.errores.length<20)informe.errores.push("pageerror: "+String(e?.message||e).slice(0,200));});
  p.on("console",m=>{if(m.type()==="error"&&informe.errores.length<20)informe.errores.push("console: "+m.text().slice(0,200));});
  // Peticiones que no llegan (p. ej. dominios no permitidos en el entorno): solo el dominio.
  p.on("requestfailed",r=>{let h;try{h=new URL(r.url()).hostname;}catch{h="?";}const k=h+" · "+String(r.failure()?.errorText||"").slice(0,40);informe.fallidas[k]=(informe.fallidas[k]||0)+1;});
  const captura=async nombre=>{const f=path.join(salida,nombre+".png");await p.screenshot({path:f,fullPage:true});informe.capturas.push(path.basename(f));};
  // La web de STEL nunca deja la red en reposo: se espera al formulario de entrada.
  await p.goto(INICIO,{waitUntil:"domcontentloaded",timeout:60000});
  await p.waitForSelector('input[type="password"]',{timeout:60000}).catch(()=>{});
  await captura("1-entrada");
  const yaDentro=!(await p.locator('input[type="password"]').count());
  if(yaDentro&&!estado){informe.entrada="sin_formulario_de_entrada";return informe;}
  if(!yaDentro){
  // Entrada: primer campo de usuario visible y el de contraseña; Intro (sin pulsar otros botones).
  const campoUsuario=p.locator('input[type="email"],input[name*="user" i],input[name*="email" i],input[id*="user" i],input[id*="email" i],input[type="text"]').first();
  const campoClave=p.locator('input[type="password"]').first();
  await campoUsuario.fill(usuario);await campoClave.fill(clave);
  await campoClave.press("Enter");
  await p.waitForTimeout(15000);
  }
  // Doble factor: STEL envía un código por correo. Se lee de STEL_WEB_CODIGO_FICHERO (lo escribe
  // quien recibe el correo) y se espera hasta 14 minutos a que cambie si STEL rechaza el anterior.
  const fichero=process.env.STEL_WEB_CODIGO_FICHERO||"";
  const campoCodigo=()=>p.locator('input[placeholder*="code" i],input[placeholder*="código" i],input[placeholder*="codigo" i]').first();
  if(fichero&&await campoCodigo().count()){
   informe.doble_factor="pedido";
   const limite=Date.now()+14*60e3;let usado="";
   while(Date.now()<limite&&await campoCodigo().count()&&await campoCodigo().isVisible().catch(()=>false)){
    const codigo=fs.existsSync(fichero)?fs.readFileSync(fichero,"utf8").replace(/\D/g,""):"";
    if(codigo&&codigo!==usado){
     usado=codigo;await campoCodigo().fill(codigo);await campoCodigo().press("Enter");await p.waitForTimeout(8000);
     informe.doble_factor=(await campoCodigo().count())&&(await campoCodigo().isVisible().catch(()=>false))?"codigo_rechazado_esperando_otro":"aceptado";
     await captura("2b-tras-codigo");
    }else await p.waitForTimeout(3000);
   }
  }
  fase="lectura";
  // Esperar a que la aplicación termine de cargar (deja de decir «Logging in» y no pide claves).
  for(let i=0;i<30;i++){
   const texto=await p.locator("body").innerText().catch(()=>"");
   if(!/Logging in|Iniciando sesi/i.test(texto)&&!(await p.locator('input[type="password"]').count()))break;
   await p.waitForTimeout(3000);
  }
  await p.waitForTimeout(20000);
  if(estado)await contexto.storageState({path:estado});
  informe.entrada=(await p.locator('input[type="password"]').count())===0?"aparentemente_correcta":"sigue_pidiendo_contrasena";
  informe.url_final=rutaSinDatos(p.url());
  await captura("2-tras-entrar");
  // Menú visible (solo textos y rutas de enlaces) para saber dónde están Proyectos y Albaranes de compra.
  informe.menu=await p.$$eval("a[href]",as=>as.map(a=>({texto:(a.textContent||"").trim().slice(0,40),href:a.getAttribute("href")})).filter(x=>x.texto).slice(0,120));
  // Secciones a visitar por su ancla (STEL_WEB_VISITAR="#main_proyectos,…"): sin pulsar botones.
  // Captura y texto visible en la carpeta de salida (fuera del repositorio).
  informe.visitas=[];
  // También «texto:Albaranes de proveedor»: enlace de submenú con ese texto exacto (navegación).
  for(const ancla of String(process.env.STEL_WEB_VISITAR||"").split(",").map(x=>x.trim()).filter(x=>/^#[A-Za-z0-9_]+$/.test(x)||/^texto:[\wÁÉÍÓÚÑáéíóúñ ]{3,60}$/.test(x)||/^abrir:[A-Z0-9-]{4,20}$/.test(x))){
   if(ancla.startsWith("abrir:")){
    // Abrir UN documento por su referencia: se escribe en el buscador de la lista (sin guardar nada)
    // y se abre la fila. Solo lectura: la guardia sigue cortando cualquier escritura.
    const ref=ancla.slice(6);
    const buscador=p.locator('input[type="search"],input[placeholder*="Buscar" i],input[placeholder*="Search" i]').first();
    if(await buscador.count()){await buscador.fill(ref);await buscador.press("Enter").catch(()=>{});}
    await p.waitForTimeout(8000);
    const fila=p.locator("tr").filter({hasText:ref}).first();
    if(await fila.count())await fila.click({timeout:10000}).catch(()=>{});
    await p.waitForTimeout(12000);
    const nombre="documento";
    await captura(nombre);fs.writeFileSync(path.join(salida,nombre+".txt"),await p.locator("body").innerText().catch(()=>""));
    informe.visitas.push({ancla:"abrir",captura:nombre+".png",texto:nombre+".txt"});
    continue;
   }
   if(ancla.startsWith("texto:")){
    const t=ancla.slice(6),enl=p.locator("a").filter({hasText:new RegExp("^\\s*"+t.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"\\s*$")}).first();
    if(await enl.count())await enl.click({timeout:10000}).catch(()=>{});
    await p.waitForTimeout(12000);
    const nombre="visita-"+t.replace(/[^A-Za-z]+/g,"_");
    await captura(nombre);fs.writeFileSync(path.join(salida,nombre+".txt"),await p.locator("body").innerText().catch(()=>""));
    informe.visitas.push({ancla,captura:nombre+".png",texto:nombre+".txt"});
    continue;
   }
   // Solo enlaces del menú principal (navegación); nunca botones de acción.
   const enlace=p.locator('a[href="'+ancla+'"]').first();
   try{if(await enlace.count())await enlace.click({timeout:10000});else await p.evaluate(a=>{location.hash=a;},ancla);}
   catch{await p.evaluate(a=>{location.hash=a;},ancla);}
   await p.waitForTimeout(12000);
   const nombre="visita-"+ancla.slice(1);
   await captura(nombre);
   fs.writeFileSync(path.join(salida,nombre+".txt"),await p.locator("body").innerText().catch(()=>""));
   informe.visitas.push({ancla,captura:nombre+".png",texto:nombre+".txt"});
  }
  // Todas las filas de cada tabla pedida: la MISMA petición de lectura (pasa por la guardia) con
  // otra página y otro tamaño. Respuesta guardada en la carpeta de salida (fuera del repositorio).
  for(const [op,t] of Object.entries(plantillas)){
   const filas=[];let total=null;
   for(let inicio=0;inicio<20000;inicio+=1000){
    const q=new URLSearchParams(t.cuerpo);q.set("iDisplayStart",String(inicio));q.set("iDisplayLength","1000");
    const datos=await p.evaluate(async([url,cuerpo,tipo])=>{const r=await fetch(url,{method:"POST",headers:{"Content-Type":tipo},body:cuerpo,credentials:"include"});return r.ok?r.json():{error:r.status};},[t.url,q.toString(),t.tipo]);
    if(!datos||datos.error||!Array.isArray(datos.aaData)){informe.tablas[op]={error:datos?.error??"formato"};break;}
    filas.push(...datos.aaData);total=Number(datos.iTotalDisplayRecords??datos.iTotalRecords??filas.length);
    if(datos.aaData.length<1000||filas.length>=total)break;
   }
   if(!informe.tablas[op]){fs.writeFileSync(path.join(salida,"tabla-"+op+".json"),JSON.stringify(filas));informe.tablas[op]={filas:filas.length,total};}
  }
 }finally{
  informe.fin=new Date().toISOString();
  fs.writeFileSync(path.join(salida,"informe.json"),JSON.stringify(informe,null,1));
  await navegador.close();
 }
 return informe;
}

if(require.main===module){
 const salida=process.argv[2];
 if(!salida){console.error("Uso: node robot-stel/explorar.js <carpeta-salida>");process.exit(2);}
 explorar(salida).then(i=>console.log("Entrada:",i.entrada,"· peticiones de lectura:",Object.keys(i.leidas).length,
  "· canceladas por la guardia:",Object.values(i.canceladas).reduce((a,b)=>a+b,0),"· informe en",path.join(salida,"informe.json")))
  .catch(e=>{console.error("Robot detenido:",String(e?.message||e).slice(0,200));process.exit(1);});
}
module.exports={explorar};
