"use strict";
/*
 * Catálogo STEL en el navegador (albaranes/catalogo.js): caché de 24 h y reanudación de una
 * descarga cortada con empalme comprobado. STEL simulado con artículos FICTICIOS.
 */
const test=require("node:test"),assert=require("node:assert/strict");
const {obtenerCatalogo}=require("../albaranes/catalogo.js");

// Simula la función Edge: páginas de 100 de una en una hasta una vacía, con `max` consultas.
function funcion(total,{max=Infinity,cambia=null}={}){
 const llamadas=[];
 const consultar=async({desde=0})=>{
  llamadas.push(desde);
  const ids=Array.from({length:total},(_,i)=>i+1).filter(id=>!(cambia&&cambia(llamadas.length,id)));
  let n=desde,peticiones=0,completo=false;const paginas=[];
  while(peticiones<max){peticiones++;const p=ids.slice(n,n+100);if(!p.length){completo=true;break;}paginas.push(p);n+=p.length;}
  const filas=paginas.flat();
  return {proveedores_completo:true,proveedores:[{id:1,nombre:"P",nif:""}],articulos_completo:completo,
   articulos:filas.map(id=>({id,referencia:"R"+id,descripcion:"A"})),articulos_siguiente:desde+filas.length,
   articulos_ids_inicio:(paginas[0]||[]).map(String),articulos_ids_final:(paginas[paginas.length-1]||[]).map(String)};
 };
 return {consultar,llamadas};
}
function memoria(){let v=null;return {leer:()=>v,guardar:o=>{v=JSON.parse(JSON.stringify(o));},get valor(){return v;}};}

test("descarga cortada: la siguiente lectura la reanuda empalmando y queda completa, sin huecos ni duplicados",async()=>{
 const alm=memoria(),stel=funcion(450,{max:3});
 const a=await obtenerCatalogo({consultar:stel.consultar,almacen:alm,ahora:1000});
 assert.equal(a.articulos_completo,false);assert.equal(a.articulos.length,300);
 const b=await obtenerCatalogo({consultar:stel.consultar,almacen:alm,ahora:2000});
 assert.equal(b.origen,"reanudado");assert.equal(b.articulos_completo,false);assert.equal(b.articulos.length,450);
 const c=await obtenerCatalogo({consultar:stel.consultar,almacen:alm,ahora:3000});
 assert.equal(c.articulos_completo,true);assert.deepEqual(c.articulos.map(x=>x.id),Array.from({length:450},(_,i)=>i+1));
 // Cada reanudación vuelve a pedir la última página guardada (200, 400), nunca desde cero.
 assert.deepEqual(stel.llamadas,[0,200,400]);
 // Completo y reciente: no se consulta STEL.
 const d=await obtenerCatalogo({consultar:stel.consultar,almacen:alm,ahora:4000});
 assert.equal(d.origen,"cache");assert.equal(stel.llamadas.length,3);
});

test("si el catálogo ha cambiado entre partes, no empalma: se descarta y se descarga de nuevo",async()=>{
 const alm=memoria();
 // En la segunda llamada desaparece el artículo 250: la última página guardada ya no coincide.
 const stel=funcion(450,{max:3,cambia:(llamada,id)=>llamada>=2&&id===250});
 await obtenerCatalogo({consultar:stel.consultar,almacen:alm,ahora:1000});
 const b=await obtenerCatalogo({consultar:stel.consultar,almacen:alm,ahora:2000});
 assert.equal(b.origen,"descarga");assert.deepEqual(stel.llamadas,[0,200,0]);
});

test("partes antiguas (más de 6 h) o catálogo completo caducado (24 h): descarga nueva; sin respuesta, se conserva lo guardado",async()=>{
 const alm=memoria(),stel=funcion(450,{max:3});
 await obtenerCatalogo({consultar:stel.consultar,almacen:alm,ahora:0});
 const b=await obtenerCatalogo({consultar:stel.consultar,almacen:alm,ahora:7*3600e3});
 assert.equal(b.origen,"descarga");
 const vacio=async()=>({proveedores_completo:true,proveedores:[],articulos_completo:false,articulos:[],articulos_siguiente:100,articulos_ids_inicio:[],articulos_ids_final:[],diagnostico:{articulos:{motivo:"Consulta STEL no disponible (403)"}}});
 const c=await obtenerCatalogo({consultar:vacio,almacen:alm,ahora:7*3600e3+1});
 assert.equal(c.origen,"parcial_sin_avance");assert.equal(c.articulos.length,300);
});
