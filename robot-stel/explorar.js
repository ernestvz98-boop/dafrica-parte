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
const {permitido,rutaSinDatos}=require("./guardia.js");
const cargarPlaywright=()=>{try{return require("playwright");}catch{return require("/opt/node-tools/node_modules/playwright");}};

const INICIO="https://app.stelorder.com/app/";

async function explorar(salida){
 const usuario=process.env.STEL_WEB_USUARIO||"",clave=process.env.STEL_WEB_CLAVE||"";
 if(!usuario||!clave)throw Error("Faltan STEL_WEB_USUARIO y STEL_WEB_CLAVE en el entorno");
 fs.mkdirSync(salida,{recursive:true});
 const {chromium}=cargarPlaywright();
 const navegador=await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM?{executablePath:process.env.PLAYWRIGHT_CHROMIUM}:{});
 const informe={inicio:new Date().toISOString(),entrada:null,url_final:null,leidas:{},canceladas:{},fallidas:{},capturas:[],menu:[]};
 let fase="entrada";
 try{
  const contexto=await navegador.newContext();
  await contexto.route("**/*",ruta=>{
   const r=ruta.request(),clave=r.method()+" "+rutaSinDatos(r.url());
   if(!permitido(r.method(),r.url(),fase)){informe.canceladas[clave]=(informe.canceladas[clave]||0)+1;return ruta.abort("blockedbyclient");}
   if(r.resourceType()==="xhr"||r.resourceType()==="fetch")informe.leidas[clave]=(informe.leidas[clave]||0)+1;
   return ruta.continue();
  });
  const p=await contexto.newPage();
  // Peticiones que no llegan (p. ej. dominios no permitidos en el entorno): solo el dominio.
  p.on("requestfailed",r=>{let h;try{h=new URL(r.url()).hostname;}catch{h="?";}const k=h+" · "+String(r.failure()?.errorText||"").slice(0,40);informe.fallidas[k]=(informe.fallidas[k]||0)+1;});
  const captura=async nombre=>{const f=path.join(salida,nombre+".png");await p.screenshot({path:f,fullPage:true});informe.capturas.push(path.basename(f));};
  // La web de STEL nunca deja la red en reposo: se espera al formulario de entrada.
  await p.goto(INICIO,{waitUntil:"domcontentloaded",timeout:60000});
  await p.waitForSelector('input[type="password"]',{timeout:60000}).catch(()=>{});
  await captura("1-entrada");
  if(!(await p.locator('input[type="password"]').count())){informe.entrada="sin_formulario_de_entrada";return informe;}
  // Entrada: primer campo de usuario visible y el de contraseña; Intro (sin pulsar otros botones).
  const campoUsuario=p.locator('input[type="email"],input[name*="user" i],input[name*="email" i],input[id*="user" i],input[id*="email" i],input[type="text"]').first();
  const campoClave=p.locator('input[type="password"]').first();
  await campoUsuario.fill(usuario);await campoClave.fill(clave);
  await campoClave.press("Enter");
  await p.waitForTimeout(15000);
  fase="lectura";
  informe.entrada=(await p.locator('input[type="password"]').count())===0?"aparentemente_correcta":"sigue_pidiendo_contrasena";
  informe.url_final=rutaSinDatos(p.url());
  await captura("2-tras-entrar");
  // Menú visible (solo textos y rutas de enlaces) para saber dónde están Proyectos y Albaranes de compra.
  informe.menu=await p.$$eval("a[href]",as=>as.map(a=>({texto:(a.textContent||"").trim().slice(0,40),href:a.getAttribute("href")})).filter(x=>x.texto).slice(0,120));
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
