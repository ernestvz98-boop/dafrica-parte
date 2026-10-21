"use strict";
/*
 * Anotaciones manuscritas (albaranes/manuscritos.js): detección en la imagen, validación de
 * códigos de obra (PRY) y de STEL (ABP) y coherencia del lote. Imágenes sintéticas, motor de
 * visión simulado y códigos FICTICIOS.
 */
const test=require("node:test"),assert=require("node:assert/strict");
const {detectarRegiones,validarCodigos,coherenciaLote,obrasImpresas,leerManuscritos}=require("../albaranes/manuscritos.js");

// Página en grises a 75 ppp (A4 ≈ 620 × 877) en blanco.
function lienzo(W=620,H=877){const datos=new Uint8Array(W*H).fill(255);return {ancho:W,alto:H,datos,dpi:75,
 rect(x0,y0,x1,y1,v=0){for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)datos[y*W+x]=v;}};}
// «Letras» manuscritas: trazos separados de ~10 px de alto en una fila.
function escribir(g,x,y,n=8){for(let i=0;i<n;i++){g.rect(x+i*9,y,x+i*9+1,y+15);g.rect(x+i*9,y+15,x+i*9+5,y+16);}}

test("detecta una anotación manuscrita y no el texto impreso ya leído por el OCR",()=>{
 const g=lienzo();
 escribir(g,300,400);
 g.rect(60,100,200,108);// palabra impresa (su caja viene del OCR)
 const z=detectarRegiones(g,[[58,98,202,110]],{dpi:75});
 assert.equal(z.length,1);
 assert.ok(z[0].x0>=298&&z[0].x1<=380&&z[0].y0>=398&&z[0].y1<=418);
});

test("un subrayado largo que cruza la anotación no impide detectarla; rayas y bandas grises no son manuscritos",()=>{
 const g=lienzo();
 escribir(g,300,400);
 g.rect(250,410,560,411);// subrayado a bolígrafo
 g.rect(20,600,600,601);// raya de tabla
 g.rect(40,700,580,720,120);// banda gris
 for(let i=0;i<10;i++)g.rect(60+i*12,704,64+i*12,714,255);// texto claro en la banda
 const z=detectarRegiones(g,[],{dpi:75});
 assert.equal(z.length,1);
 assert.ok(z[0].y0>=398&&z[0].y1<=418);
});

const vista=(texto,codigos,{tipo="PRY",tachado=false}={})=>({indice:0,texto_literal:texto,tachado,tipo,lecturas:codigos.map(([c,p])=>({codigo:c,confianza:p}))});

test("PRY validado por el número de la obra impresa («PISCINAS … 12345»)",()=>{
 const r=validarCodigos([vista("PRY12345",[["PRY12345",0.95]])],{obraImpresa:["PISCINAS FICTICIAS 12345"]});
 assert.equal(r.obra.estado,"OK");assert.equal(r.obra.valor,"PRY12345");
 assert.equal(r.obra.resolucion.metodo,"vision_recorte_validada");
 assert.ok(r.obra.resolucion.evidencias.some(e=>/obra impresa/.test(e)));
});

test("PRY sin ninguna validación externa: se propone pero no se acepta automáticamente",()=>{
 const r=validarCodigos([vista("PRY00123",[["PRY00123",0.97]])],{});
 assert.equal(r.obra.estado,"REVISAR");assert.ok(r.obra.confianza<0.9);
});

test("dos interpretaciones plausibles (1/7) y ninguna validada: no se resuelve",()=>{
 const r=validarCodigos([vista("PRY0011?",[["PRY00123",0.6],["PRY00127",0.4]])],{});
 assert.equal(r.obra.estado,"AMBIGUO");assert.equal(r.obra.valor,null);
});

test("de dos interpretaciones, la que existe en el catálogo de obras se acepta; la otra queda como alternativa",()=>{
 const r=validarCodigos([vista("PRY0011?",[["PRY00123",0.6],["PRY00127",0.4]])],{catalogoObras:[{codigo:"PRY00123",nombre:"OBRA FICTICIA"}]});
 assert.equal(r.obra.estado,"OK");assert.equal(r.obra.valor,"PRY00123");
 assert.deepEqual(r.obra.resolucion.alternativas.sort(),["PRY00123","PRY00127"]);
});

test("una anotación tachada no se usa",()=>{
 const r=validarCodigos([vista("ABP26 1234",[["ABP261234",0.9]],{tipo:"ABP",tachado:true})],{});
 assert.equal(r.stel.estado,"VACIO");assert.match(r.stel.motivos[0],/tachadas/);
});

test("ABP validado con el albarán de STEL (mismo proveedor y número); sin STEL queda propuesto",()=>{
 const lect=[vista("ABP26 1234",[["ABP261234",0.95]],{tipo:"ABP"})];
 const stel=c=>c==="ABP26-1234"?{proveedorId:"A",numero:"600.111",fecha:"2026-10-15"}:null;
 const ok=validarCodigos(lect,{albaranStel:stel,proveedorId:"A",numero:"600.111"});
 assert.equal(ok.stel.estado,"OK");assert.equal(ok.stel.valor,"ABP26-1234");
 const otro=validarCodigos(lect,{albaranStel:stel,proveedorId:"B",numero:"600.111"});
 assert.equal(otro.stel.estado,"REVISAR");
});

test("coherencia del lote: mismo código en dos albaranes con la misma obra → aceptado; si el lote se contradice, no",()=>{
 const doc=(obra,cod,impresa=[],escrita=[])=>({obraImpresa:impresa,obraEscrita:escrita,obra:{valor:cod,estado:"REVISAR",confianza:0.8,resolucion:{evidencias:[]}}});
 const a=doc("",  "PRY00456",["MOLINO FICTICIA"]),b=doc("","PRY00456",[],["Molino"]),c=doc("","PRY00055",["OBRA NAVE"]);
 assert.equal(coherenciaLote([a,b,c]),2);
 assert.equal(a.obra.estado,"OK");assert.equal(b.obra.estado,"OK");assert.equal(c.obra.estado,"REVISAR");
 const x=doc("","PRY00456",["MOLINO FICTICIA"]),y=doc("","PRY00456",["Molino"]),z=doc("","PRY00453",["Molino"]);
 assert.equal(coherenciaLote([x,y,z]),0);
});

test("obra impresa: «OBRA: …», «Referencia: OBRA …» y «SU PEDIDO: …»",()=>{
 const t=obrasImpresas([{texto:"OBRA: PISCINAS FICTICIAS 12345"},{texto:"Referencia: OBRA MUSEO FICTICIO"},{texto:"SU PEDIDO: vegasx"},{texto:"CANTIDAD 2,00"}]);
 assert.deepEqual(t,["PISCINAS FICTICIAS 12345","MUSEO FICTICIO","vegasx"]);
});

test("flujo completo: a visión solo llegan recortes pequeños de la anotación, nunca la página",async()=>{
 const g=lienzo();escribir(g,300,400);
 const enviados=[];
 const pagina={numero:1,anchoPx:2480,altoPx:3508,gris:()=>g,recortePng:caja=>{enviados.push(caja);return "data:image/png;base64,AAAA";}};
 const resultado={_pags:[{numero:1,lineas:[{texto:"OBRA: PISCINAS FICTICIAS 12345",y:100,alto:8,celdas:[]}]}],lineas_ignoradas:[],proveedor:{id:"A"}};
 const vision=async recortes=>recortes.map((_,i)=>({indice:i,texto_literal:"PRY 12345",tachado:false,tipo:"PRY",lecturas:[{codigo:"PRY12345",confianza:0.95}]}));
 const m=await leerManuscritos([pagina],resultado,vision);
 assert.equal(m.obra.valor,"PRY12345");assert.equal(m.obra.estado,"OK");
 assert.equal(enviados.length,1);
 const [,,w,h]=enviados[0];
 assert.ok(w<0.3*2480&&h<0.05*3508,"recorte "+w+"×"+h);
});

test("código escrito de un trazo continuo (dos componentes) también se detecta",()=>{
 const g=lienzo();
 // Dos trazos en zigzag de ~10 mm cada uno (ninguna raya recta larga).
 for(const x0 of [300,350])for(let i=0;i<5;i++){g.rect(x0+i*8,400,x0+i*8,416);if(i<4)g.rect(x0+i*8,i%2?400:416,x0+i*8+8,i%2?400:416);}
 const z=detectarRegiones(g,[],{dpi:75});
 assert.equal(z.length,1);
});

test("una firma grande junto a un código no se une a él: el código sigue siendo una zona propia",()=>{
 const g=lienzo();
 escribir(g,300,400);
 // Firma: trazos altos que solapan la franja del código por arriba.
 for(let i=0;i<6;i++)g.rect(330+i*14,330,331+i*14,420);
 const z=detectarRegiones(g,[],{dpi:75});
 assert.ok(z.some(x=>x.y1-x.y0<30&&x.x0<=302),JSON.stringify(z));
});

test("prefijo PRY cortado o borroso («Y12345»): las 5 cifras con tipo PRY valen como PRY12345",()=>{
 const r=validarCodigos([vista("Y12345",[["Y12345",0.92]])],{obraImpresa:["PISCINAS FICTICIAS 12345"]});
 assert.equal(r.obra.valor,"PRY12345");assert.equal(r.obra.estado,"OK");
 // Sin la «Y» no hay prueba de que sea un código de obra.
 const s=validarCodigos([vista("12345",[["12345",0.92]])],{obraImpresa:["PISCINAS FICTICIAS 12345"]});
 assert.notEqual(s.obra.estado,"OK");
});

test("un código manuscrito leído pero sin validar impide AUTO_OK; validado, deja de bloquear",()=>{
 const {aplicarEstado}=require("../albaranes/manuscritos.js");
 const r={estado:"AUTO_OK",incidencias:[],manuscritos:{obra:{valor:"PRY00123",literal:"PRY00123",estado:"REVISAR"},stel:{valor:null,literal:"",estado:"VACIO"}}};
 aplicarEstado(r);
 assert.equal(r.estado,"REVISAR");assert.ok(r.incidencias.some(i=>/Código manuscrito sin validar: obra «PRY00123»/.test(i)));
 // Validado (y estado base recalculado por extraer.finalizar): ya no lo baja ni deja la incidencia.
 r.manuscritos.obra.estado="OK";r.estado="AUTO_OK";aplicarEstado(r);
 assert.equal(r.estado,"AUTO_OK");assert.equal(r.incidencias.length,0);
 // Ambiguo o sin el formato: tampoco AUTO_OK. Nada detectado: no cambia el estado.
 for(const m of [{valor:null,literal:"PRYO0999",estado:"AMBIGUO"},{valor:null,literal:"ABP69999",estado:"VACIO"}]){
  const x={estado:"AUTO_OK",manuscritos:{obra:m,stel:{estado:"VACIO",literal:""}}};assert.equal(aplicarEstado(x).estado,"REVISAR");
 }
 assert.equal(aplicarEstado({estado:"AUTO_OK",manuscritos:{obra:{estado:"VACIO",literal:""},stel:{estado:"VACIO",literal:""}}}).estado,"AUTO_OK");
});

test("código STEL manuscrito: se valida con el albarán de compra de STEL (solo lectura) del mismo proveedor y fecha o número",async()=>{
 const {validarStel}=require("../albaranes/manuscritos.js");
 const base=()=>({fecha:{estado:"OK",valor:"2026-10-14"},numero:{valor:"600.111"},proveedor:{nombre:"PROVEEDOR FICTICIO, S.L."},
  manuscritos:{stel:{valor:"ABP26-1234",literal:"ABP26 1234",estado:"REVISAR",resolucion:{alternativas:["ABP261234"]}}}});
 const stel={"ABP26-1234":[{fullReference:"ABP26-1234",supplier:"Proveedor Ficticio SL",date:"2026-10-14",extraReference:""}],
  "ABP26-7234":[{fullReference:"ABP26-7234",supplier:"Proveedor Ficticio SL",date:"2026-10-14",extraReference:""}]};
 const consultar=async c=>stel[c]||[];
 let r=base();assert.equal(await validarStel(r,consultar),true);
 assert.equal(r.manuscritos.stel.estado,"OK");assert.equal(r.manuscritos.stel.resolucion.metodo,"vision_recorte_albaran_stel");
 // Otro proveedor, o ni fecha ni número coinciden: no se valida.
 r=base();assert.equal(await validarStel(r,async()=>[{...stel["ABP26-1234"][0],supplier:"OTRO PROVEEDOR"}]),false);assert.equal(r.manuscritos.stel.estado,"REVISAR");
 r=base();assert.equal(await validarStel(r,async()=>[{...stel["ABP26-1234"][0],date:"2026-09-01"}]),false);
 // Número del proveedor en la referencia externa de STEL: también vale.
 r=base();assert.equal(await validarStel(r,async()=>[{...stel["ABP26-1234"][0],date:"2026-09-01",extraReference:"600111"}]),true);
 // Dos interpretaciones (1/7) que STEL valida ambas: no se resuelve.
 r=base();r.manuscritos.stel={valor:null,literal:"ABP26 ?234",estado:"AMBIGUO",resolucion:{alternativas:["ABP261234","ABP267234"]}};
 assert.equal(await validarStel(r,consultar),false);assert.equal(r.manuscritos.stel.estado,"AMBIGUO");
 // Varias coincidencias exactas en STEL: no es única.
 r=base();assert.equal(await validarStel(r,async()=>[...stel["ABP26-1234"],...stel["ABP26-1234"]]),false);
});
