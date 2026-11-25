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
 const r=validarCodigos([vista("PRY90123",[["PRY90123",0.97]])],{});
 assert.equal(r.obra.estado,"REVISAR");assert.ok(r.obra.confianza<0.9);
});

test("dos interpretaciones plausibles (1/7) y ninguna validada: no se resuelve",()=>{
 const r=validarCodigos([vista("PRY9012?",[["PRY90123",0.6],["PRY90127",0.4]])],{});
 assert.equal(r.obra.estado,"AMBIGUO");assert.equal(r.obra.valor,null);
});

test("de dos interpretaciones, la que existe en el catálogo de obras se acepta; la otra queda como alternativa",()=>{
 const r=validarCodigos([vista("PRY9012?",[["PRY90123",0.6],["PRY90127",0.4]])],{catalogoObras:[{codigo:"PRY90123",nombre:"OBRA FICTICIA"}]});
 assert.equal(r.obra.estado,"OK");assert.equal(r.obra.valor,"PRY90123");
 assert.deepEqual(r.obra.resolucion.alternativas.sort(),["PRY90123","PRY90127"]);
});

test("una anotación tachada no se usa, pero queda pendiente: impide AUTO_OK",()=>{
 const {aplicarEstado}=require("../albaranes/manuscritos.js");
 const r=validarCodigos([vista("ABP26 1234",[["ABP261234",0.9]],{tipo:"ABP",tachado:true})],{});
 assert.equal(r.stel.estado,"VACIO");assert.equal(r.stel.valor,null);assert.match(r.stel.motivos[0],/tachadas/);
 assert.equal(aplicarEstado({estado:"AUTO_OK",manuscritos:{obra:{estado:"VACIO",literal:""},stel:r.stel}}).estado,"REVISAR");
});

test("ABP validado con el albarán de STEL (mismo proveedor y número); sin STEL queda propuesto",()=>{
 const lect=[vista("ABP26 1234",[["ABP261234",0.95]],{tipo:"ABP"})];
 const stel=c=>c==="ABP26-1234"?{proveedorId:"A",numero:"600.111",fecha:"2026-10-15"}:null;
 const ok=validarCodigos(lect,{albaranStel:stel,proveedorId:"A",numero:"600.111"});
 assert.equal(ok.stel.estado,"OK");assert.equal(ok.stel.valor,"ABP26-1234");
 const otro=validarCodigos(lect,{albaranStel:stel,proveedorId:"B",numero:"600.111"});
 assert.equal(otro.stel.estado,"REVISAR");
});

test("coherencia del lote: el código se extiende desde un albarán donde está VALIDADO; si el lote se contradice, no",()=>{
 const doc=(obra,cod,impresa=[],escrita=[],validado=false)=>({obraImpresa:impresa,obraEscrita:escrita,obra:validado?
  {valor:cod,estado:"OK",confianza:0.95,resolucion:{metodo:"vision_recorte_validada",evidencias:["Visión","Coincide con el número de la obra impresa"]}}:
  {valor:cod,estado:"REVISAR",confianza:0.8,resolucion:{evidencias:[]}}});
 const a=doc("","PRY90456",["MOLINO FICTICIA 90456"],[],true),b=doc("","PRY90456",[],["Molino"]),c=doc("","PRY90055",["OBRA NAVE"]);
 assert.equal(coherenciaLote([a,b,c]),1);
 assert.equal(b.obra.estado,"OK");assert.equal(b.obra.resolucion.metodo,"vision_recorte_coherencia_lote");assert.equal(c.obra.estado,"REVISAR");
 const x=doc("","PRY90456",["MOLINO FICTICIA 90456"],[],true),y=doc("","PRY90456",["Molino"]),z=doc("","PRY90453",["Molino"]);
 assert.equal(coherenciaLote([x,y,z]),0);
});

test("coherencia del lote: dos lecturas de visión iguales sin validar NO se confirman entre sí (fallo real 88 → 38)",()=>{
 const doc=(cod,impresa)=>({obraImpresa:impresa,obraEscrita:[],obra:{valor:cod,estado:"REVISAR",confianza:0.8,resolucion:{evidencias:[]}}});
 // Misma letra, mismo motor: los dos albaranes de la obra ficticia se leen igual de mal.
 const a=doc("PRY90031",["OBRA MOLINO FICTICIO"]),b=doc("PRY90031",["MOLINO FICTICIO"]);
 assert.equal(coherenciaLote([a,b]),0);
 assert.equal(a.obra.estado,"REVISAR");assert.equal(b.obra.estado,"REVISAR");
});

test("obra impresa: «OBRA: …», «Referencia: OBRA …» y «SU PEDIDO: …»",()=>{
 const t=obrasImpresas([{texto:"OBRA: PISCINAS FICTICIAS 12345"},{texto:"Referencia: OBRA MUSEO FICTICIO"},{texto:"SU PEDIDO: vegasx"},{texto:"CANTIDAD 2,00"}]);
 assert.deepEqual(t,["PISCINAS FICTICIAS 12345","MUSEO FICTICIO","vegasx"]);
 // Su pedido abreviado (fallo real 2026-11-25).
 assert.deepEqual(obrasImpresas([{texto:"S/PDO: PUEBLO FICTICIO ENV.P.: SUS MEDIOS"},{texto:"S/PED. NAVE FICTICIA"},{texto:"SU PDO: OTRA FICTICIA"},{texto:"S/PDOS 12"},
  {texto:"ALBARÁN SIPDO: VILLA FICTICIA ENV.P.: SUS MEDIOS PPTO:"},{texto:"PDO.: 254"}]),
  ["PUEBLO FICTICIO ENV.P.: SUS MEDIOS","NAVE FICTICIA","OTRA FICTICIA","VILLA FICTICIA ENV.P.: SUS MEDIOS PPTO:"]);
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

test("prueba de modelos: cada modelo se valida igual sobre los mismos recortes y el resultado no cambia",async()=>{
 const g=lienzo();escribir(g,300,400);
 const pagina={numero:1,anchoPx:2480,altoPx:3508,gris:()=>g,recortePng:()=>"data:image/png;base64,AAAA"};
 const resultado={_pags:[{numero:1,lineas:[{texto:"OBRA: PISCINAS FICTICIAS 12345",y:100,alto:8,celdas:[]}]}],lineas_ignoradas:[],proveedor:{id:"A"}};
 const lectura=codigo=>recortes=>recortes.map((_,i)=>({indice:i,texto_literal:codigo,tachado:false,tipo:"PRY",lecturas:[{codigo,confianza:0.95}]}));
 const pedidos=[];
 const compararModelos={modelos:["m-bueno","m-malo","m-roto"],vision:async(pngs,modelo)=>{
  pedidos.push(modelo);
  if(modelo==="m-roto")throw Error("Modelo no disponible");
  return {recortes:lectura(modelo==="m-bueno"?"PRY12345":"PRY12845")(pngs),uso:{input_tokens:100,output_tokens:10}};
 }};
 const m=await leerManuscritos([pagina],resultado,async r=>lectura("PRY12345")(r),{compararModelos});
 assert.equal(m.obra.valor,"PRY12345");assert.equal(m.obra.estado,"OK");
 assert.deepEqual(pedidos.sort(),["m-bueno","m-malo","m-roto"]);
 assert.equal(m.comparacion.principal.obra.valor,"PRY12345");
 assert.equal(m.comparacion.modelos["m-bueno"].obra.estado,"OK");
 // Otra cifra: sin la obra impresa que lo corrobore no se acepta.
 assert.notEqual(m.comparacion.modelos["m-malo"].obra.estado,"OK");
 assert.equal(m.comparacion.modelos["m-bueno"].uso.input_tokens,100);
 assert.match(m.comparacion.modelos["m-roto"].error,/no disponible/);
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
 const r={estado:"AUTO_OK",incidencias:[],manuscritos:{obra:{valor:"PRY90123",literal:"PRY90123",estado:"REVISAR"},stel:{valor:null,literal:"",estado:"VACIO"}}};
 aplicarEstado(r);
 assert.equal(r.estado,"REVISAR");assert.ok(r.incidencias.some(i=>/Código manuscrito sin validar: obra «PRY90123»/.test(i)));
 // Validado (y estado base recalculado por extraer.finalizar): ya no lo baja ni deja la incidencia.
 r.manuscritos.obra.estado="OK";r.manuscritos.stel={valor:"ABP26-1234",literal:"ABP26 1234",estado:"OK"};r.estado="AUTO_OK";aplicarEstado(r);
 assert.equal(r.estado,"AUTO_OK");assert.equal(r.incidencias.length,0);
 // Ambiguo o sin el formato: tampoco AUTO_OK.
 for(const m of [{valor:null,literal:"PRYO0999",estado:"AMBIGUO"},{valor:null,literal:"ABP69999",estado:"VACIO"}]){
  const x={estado:"AUTO_OK",manuscritos:{obra:m,stel:{estado:"VACIO",literal:""}}};assert.equal(aplicarEstado(x).estado,"REVISAR");
 }
 // Nada detectado: la anotación puede existir sin haberse visto (fallo real: obra y ABP escritos
 // no detectados en albaranes dados por AUTO_OK). Tampoco AUTO_OK.
 const nada=aplicarEstado({estado:"AUTO_OK",manuscritos:{obra:{estado:"VACIO",literal:""},stel:{valor:"ABP26-1234",estado:"OK"}}});
 assert.equal(nada.estado,"REVISAR");assert.ok(nada.incidencias.some(i=>/no detectado: obra/.test(i)));
});

test("código STEL manuscrito: se valida con el albarán de compra de STEL (solo lectura) del mismo proveedor y fecha o número",async()=>{
 const {validarStel}=require("../albaranes/manuscritos.js");
 const base=()=>({fecha:{estado:"OK",valor:"2026-10-14"},numero:{valor:"600.111"},proveedor:{nombre:"PROVEEDOR FICTICIO, S.L."},
  manuscritos:{stel:{valor:"ABP26-1234",literal:"ABP26 1234",estado:"REVISAR",resolucion:{alternativas:["ABP261234"]}}}});
 const stel={"ABP26-1234":[{fullReference:"ABP26-1234",supplier:"Proveedor Ficticio SL",date:"2026-10-14",extraReference:""}],
  "ABP26-7234":[{fullReference:"ABP26-7234",supplier:"Proveedor Ficticio SL",date:"2026-10-14",extraReference:""}]};
 const consultar=async c=>stel[c]||[];
 // Único albarán de compra del proveedor ese día (lo dice la lista de la búsqueda).
 const unico={delMismoDia:()=>0};
 let r=base();assert.equal(await validarStel(r,consultar,unico),true);
 assert.equal(r.manuscritos.stel.estado,"OK");assert.equal(r.manuscritos.stel.resolucion.metodo,"vision_recorte_albaran_stel");
 // Prueba de fuerza: con otro albarán de compra del proveedor el mismo día, la fecha no lo
 // identifica (una cifra mal leída del ABP daría el otro); sin la lista, tampoco.
 r=base();assert.equal(await validarStel(r,consultar,{delMismoDia:()=>1}),false);
 r=base();assert.equal(await validarStel(r,consultar),false);
 // Ya asignado a otro albarán leído: no.
 r=base();assert.equal(await validarStel(r,async()=>[{...stel["ABP26-1234"][0],id:5}],{...unico,asignadas:new Set(["5"])}),false);
 // Otro proveedor, o ni fecha ni número coinciden: no se valida.
 r=base();assert.equal(await validarStel(r,async()=>[{...stel["ABP26-1234"][0],supplier:"OTRO PROVEEDOR"}],unico),false);assert.equal(r.manuscritos.stel.estado,"REVISAR");
 r=base();assert.equal(await validarStel(r,async()=>[{...stel["ABP26-1234"][0],date:"2026-09-01"}],unico),false);
 // Número del proveedor en la referencia externa de STEL: también vale.
 r=base();assert.equal(await validarStel(r,async()=>[{...stel["ABP26-1234"][0],date:"2026-09-01",extraReference:"600111"}]),true);
 // Dos interpretaciones (1/7) que STEL valida ambas: no se resuelve.
 r=base();r.manuscritos.stel={valor:null,literal:"ABP26 ?234",estado:"AMBIGUO",resolucion:{alternativas:["ABP261234","ABP267234"]}};
 assert.equal(await validarStel(r,consultar,unico),false);assert.equal(r.manuscritos.stel.estado,"AMBIGUO");
 // Varias coincidencias exactas en STEL: no es única.
 r=base();assert.equal(await validarStel(r,async()=>[...stel["ABP26-1234"],...stel["ABP26-1234"]],unico),false);
});

test("una sola lectura PRY: existir en el catálogo no basta; hace falta que el nombre de la obra coincida con el albarán",()=>{
 const catalogoObras=[{codigo:"PRY90123",nombre:"REFORMA NAVE FICTICIA"},{codigo:"PRY90124",nombre:"VIVIENDA INVENTADA"}];
 const solo=validarCodigos([vista("PRY90123",[["PRY90123",0.95]])],{catalogoObras});
 assert.equal(solo.obra.estado,"REVISAR");
 const conObra=validarCodigos([vista("PRY90123",[["PRY90123",0.95]])],{catalogoObras,obraImpresa:["OBRA: NAVE POLIGONO"]});
 assert.equal(conObra.obra.estado,"OK");assert.match(conObra.obra.resolucion.evidencias.join(" "),/NAVE/);
 // Nombre de otra obra: no corrobora.
 const otra=validarCodigos([vista("PRY90123",[["PRY90123",0.95]])],{catalogoObras,obraEscrita:["Vivienda"]});
 assert.equal(otra.obra.estado,"REVISAR");
});

test("código STEL: el proveedor se compara por la cuenta de STEL verificada con el CIF, aunque el nombre se escriba distinto",async()=>{
 const {validarStel}=require("../albaranes/manuscritos.js");
 const base=()=>({fecha:{estado:"OK",valor:"2026-10-14"},numero:{valor:"600.111"},proveedor:{nombre:"PROVEEDOR FICTICIO, S.L.",account_id:777},
  manuscritos:{stel:{valor:"ABP26-1234",literal:"ABP26 1234",estado:"REVISAR",resolucion:{alternativas:["ABP261234"]}}}});
 const doc={fullReference:"ABP261234",supplier:"Ficticio Distribuciones",accountId:777,date:"2026-10-14",extraReference:""};
 const vistos=[];
 let r=base();assert.equal(await validarStel(r,async()=>[doc],{diagnostico:x=>vistos.push(x),delMismoDia:()=>0}),true);
 assert.equal(vistos[0].mismo_proveedor,true);assert.equal(vistos[0].cuenta_stel,777);
 // Otra cuenta, aunque el nombre coincida: no.
 r=base();assert.equal(await validarStel(r,async()=>[{...doc,accountId:778,supplier:"PROVEEDOR FICTICIO SL"}],{delMismoDia:()=>0}),false);
});

test("revalidarObra: el nombre de obra del albarán de compra de STEL corrobora el código del catálogo; otro nombre, no",()=>{
 const {revalidarObra}=require("../albaranes/manuscritos.js");
 const r=()=>({proveedor:{id:"A"},numero:{valor:"1"},fecha:{valor:"2026-10-14"},manuscritos:{obra:{valor:"PRY12345",estado:"REVISAR"},stel:{estado:"VACIO"},obraImpresa:[],obraEscrita:[],
  recortes:[{lectura:{indice:0,tipo:"PRY",tachado:false,texto_literal:"PRY 12345",lecturas:[{codigo:"PRY12345",confianza:0.95}]}}]}});
 const cat=[{codigo:"PRY12345",nombre:"ALAMEDA FICTICIA"},{codigo:"PRY12845",nombre:"PISCINA FICTICIA"}];
 const a=r();assert.equal(revalidarObra(a,{catalogoObras:cat,obraStel:"ALAMEDA"}),true);
 assert.equal(a.manuscritos.obra.estado,"OK");assert.ok(a.manuscritos.obra.resolucion.evidencias.some(e=>/STEL/.test(e)));
 const b=r();assert.equal(revalidarObra(b,{catalogoObras:cat,obraStel:"GIRASOL"}),false);
 assert.equal(b.manuscritos.obra.estado,"REVISAR");
});
test("catálogo de obras incompleto: «solo una de las lecturas existe» no decide",()=>{
 const {validarCodigos}=require("../albaranes/manuscritos.js");
 const lect=[{indice:0,tipo:"PRY",tachado:false,texto_literal:"PRY 12?45",lecturas:[{codigo:"PRY12345",confianza:0.6},{codigo:"PRY12845",confianza:0.5}]}];
 const cat=[{codigo:"PRY12845",nombre:"PISCINA FICTICIA"}];
 assert.notEqual(validarCodigos(lect,{catalogoObras:cat,catalogoObrasCompleto:false}).obra.estado,"OK");
});

test("obra por nombre: número de obra impreso + nombre en el catálogo + lectura a mano a una cifra",()=>{
 const {validarCodigos}=require("../albaranes/manuscritos.js");
 const cat=[{codigo:"PRY26111",nombre:"PISCINAS FICTICIAS"},{codigo:"PRY26112",nombre:"OTRA OBRA"}];
 const casi=[{indice:0,tipo:"PRY",tachado:false,texto_literal:"PRY 26171",lecturas:[{codigo:"PRY26171",confianza:0.9}]}];
 const r=validarCodigos(casi,{catalogoObras:cat,catalogoObrasCompleto:false,obraImpresa:["PISCINAS FICTICIAS 26111"]});
 assert.equal(r.obra.valor,"PRY26111");assert.equal(r.obra.estado,"OK");assert.equal(r.obra.resolucion.metodo,"obra_impresa_catalogo");
 // Sin código a mano: la obra puede estar solo mencionada (caso real); no se acepta.
 assert.notEqual(validarCodigos([],{catalogoObras:cat,obraImpresa:["PISCINAS FICTICIAS 26111"]}).obra.estado,"OK");
 // La letra a mano dice claramente otra cosa (más de una cifra distinta): no.
 const v=[{indice:0,tipo:"PRY",tachado:false,texto_literal:"PRY 99999",lecturas:[{codigo:"PRY99999",confianza:0.95}]}];
 assert.notEqual(validarCodigos(v,{catalogoObras:cat,obraImpresa:["PISCINAS FICTICIAS 26111"]}).obra.estado,"OK");
});
test("obra por nombre: lectura a una cifra solo con el catálogo completo y una sola obra con ese nombre",()=>{
 const {validarCodigos}=require("../albaranes/manuscritos.js");
 const v=[{indice:0,tipo:"PRY",tachado:false,texto_literal:"PRY 90038",lecturas:[{codigo:"PRY90038",confianza:0.95}]}];
 const cat=[{codigo:"PRY90088",nombre:"ALAMEDA FICTICIA DEL VALLE"},{codigo:"PRY90038",nombre:"GIRASOL FICTICIO"},{codigo:"PRY90012",nombre:"OTRA ALAMEDA FICTICIA"}];
 const ctx={catalogoObras:cat,obraEscrita:["ALAMEDA DEL VALLE"]};
 // Catálogo incompleto: no.
 assert.notEqual(validarCodigos(v,{...ctx,catalogoObrasCompleto:false}).obra.estado,"OK");
 // Completo: la única obra con «ALAMEDA» a una cifra de lo leído (90012 está a más de una).
 const r=validarCodigos(v,{...ctx,catalogoObrasCompleto:true}).obra;
 assert.equal(r.valor,"PRY90088");assert.equal(r.estado,"OK");assert.equal(r.resolucion.metodo,"obra_nombre_catalogo");
 // Dos obras con ese nombre a una cifra: no se elige.
 const dos=[...cat,{codigo:"PRY90058",nombre:"ALAMEDA FICTICIA NORTE"}];
 assert.notEqual(validarCodigos(v,{...ctx,catalogoObras:dos,catalogoObrasCompleto:true}).obra.estado,"OK");
 // Sin nombre de obra en el albarán: no.
 assert.notEqual(validarCodigos(v,{catalogoObras:cat,catalogoObrasCompleto:true}).obra.estado,"OK");
});

// Prueba de fuerza 2026-10-22 (catálogo real de 103 obras, lecturas de visión falsas realistas):
// una cifra mal leída o dos contiguas intercambiadas daban otra obra que existe y que comparte
// con el albarán una palabra común a varias obras («HOSPITAL», «CENTRO»…), y se aceptaba.
const leePry=c=>[{indice:0,tipo:"PRY",tachado:false,texto_literal:c,lecturas:[{codigo:c,confianza:0.99}]}];
test("prueba de fuerza: una palabra común a dos obras de códigos confundibles no valida el código leído",()=>{
 const cat=[{codigo:"PRY90124",nombre:"HOSPITAL FICTICIO GERENCIA"},{codigo:"PRY90127",nombre:"HOSPITAL FICTICIO CARDIOLOGIA"},{codigo:"PRY90150",nombre:"GIRASOL INVENTADO"}];
 // En el albarán solo «HOSPITAL FICTICIO»: las dos coinciden igual y una cifra mal leída las confunde.
 for(const c of ["PRY90124","PRY90127"])
  assert.notEqual(validarCodigos(leePry(c),{catalogoObras:cat,catalogoObrasCompleto:true,obraImpresa:["HOSPITAL FICTICIO"]}).obra.estado,"OK");
 // Con la palabra que las distingue, la del albarán se acepta y la otra no.
 const ctx={catalogoObras:cat,catalogoObrasCompleto:true,obraEscrita:["Hospital ficticio cardiologia"]};
 const r=validarCodigos(leePry("PRY90127"),ctx).obra;
 assert.equal(r.estado,"OK");assert.equal(r.valor,"PRY90127");
 assert.notEqual(validarCodigos(leePry("PRY90124"),ctx).obra.estado,"OK");
});
test("prueba de fuerza: nombre + lectura cercana solo si el nombre señala una única obra y no hay otra candidata",()=>{
 const cat=[{codigo:"PRY90059",nombre:"SALA ENFRIADORA FICTICIA"},{codigo:"PRY90094",nombre:"ENFRIADORA INVENTADA"},{codigo:"PRY90010",nombre:"OTRA COSA"}];
 const ctx=t=>({catalogoObras:cat,catalogoObrasCompleto:true,obraEscrita:[t]});
 // Lee 90095 (no existe): «ENFRIADORA» es de las dos obras; no se elige ninguna.
 assert.notEqual(validarCodigos(leePry("PRY90095"),ctx("enfriadora")).obra.estado,"OK");
 // El nombre completo señala 90059 (cifras intercambiadas), pero 90094 está a una cifra: dos candidatas.
 assert.notEqual(validarCodigos(leePry("PRY90095"),ctx("sala enfriadora ficticia")).obra.estado,"OK");
 // Sin la otra obra cerca, el intercambio de cifras se corrige con el nombre.
 const r=validarCodigos(leePry("PRY90095"),{catalogoObras:[cat[0],cat[2]],catalogoObrasCompleto:true,obraEscrita:["sala enfriadora ficticia"]}).obra;
 assert.equal(r.valor,"PRY90059");assert.equal(r.estado,"OK");assert.equal(r.resolucion.metodo,"obra_nombre_catalogo");
});
test("prueba de fuerza: de dos lecturas, la que existe solo vale si con cualquier cifra en la dudosa no existe otra obra",()=>{
 const lee2=(a,b)=>[{indice:0,tipo:"PRY",tachado:false,texto_literal:"PRY9012?",lecturas:[{codigo:a,confianza:0.6},{codigo:b,confianza:0.5}]}];
 // «1 o 7»: solo existe 90121, pero 90124 (otra cifra en esa posición) también es una obra.
 const cat=[{codigo:"PRY90121",nombre:"OBRA FICTICIA UNO"},{codigo:"PRY90124",nombre:"OBRA FICTICIA DOS"}];
 assert.notEqual(validarCodigos(lee2("PRY90121","PRY90127"),{catalogoObras:cat,catalogoObrasCompleto:true}).obra.estado,"OK");
 // Una obra a una mala lectura de alguna de las lecturas (aquí, cifras intercambiadas) también lo impide.
 assert.notEqual(validarCodigos(lee2("PRY90121","PRY90127"),{catalogoObras:[cat[0],{codigo:"PRY90172",nombre:"OTRA"}],catalogoObrasCompleto:true}).obra.estado,"OK");
 // Sin otra obra posible, se acepta la que existe.
 const r=validarCodigos(lee2("PRY90121","PRY90127"),{catalogoObras:[cat[0]],catalogoObrasCompleto:true}).obra;
 assert.equal(r.estado,"OK");assert.equal(r.valor,"PRY90121");
});
test("prueba de fuerza: la coherencia del lote no extiende un código si otra obra confundible coincide igual con el nombre",()=>{
 const cat=[{codigo:"PRY90124",nombre:"HOSPITAL FICTICIO GERENCIA"},{codigo:"PRY90127",nombre:"HOSPITAL FICTICIO CARDIOLOGIA"}];
 const doc=(cod,escrita,validado)=>({obraImpresa:[],obraEscrita:escrita,obra:validado?
  {valor:cod,estado:"OK",confianza:0.95,resolucion:{metodo:"vision_recorte_validada",evidencias:["Visión","Obra del catálogo"]}}:
  {valor:cod,estado:"REVISAR",confianza:0.8,resolucion:{evidencias:[]}}});
 const a=doc("PRY90124",["Hospital ficticio gerencia"],true),b=doc("PRY90124",["Hospital ficticio"]);
 assert.equal(coherenciaLote([a,b],{catalogoObras:cat}),0);assert.equal(b.obra.estado,"REVISAR");
 // Sin obra confundible en el catálogo, la regla de siempre.
 const c=doc("PRY90124",["Hospital ficticio gerencia"],true),d=doc("PRY90124",["Hospital ficticio"]);
 assert.equal(coherenciaLote([c,d],{catalogoObras:[cat[0]]}),1);assert.equal(d.obra.estado,"OK");
});
test("prueba de fuerza: con la visión caída los códigos quedan sin comprobar y el albarán no es AUTO_OK",async()=>{
 const {sinComprobar,validarStel}=require("../albaranes/manuscritos.js");
 const r={estado:"AUTO_OK",incidencias:[],proveedor:{nombre:"PROVEEDOR FICTICIO",account_id:777},fecha:{estado:"OK",valor:"2026-03-03"},numero:{valor:"600.111"}};
 sinComprobar(r,Error("Servicio de visión no disponible: OpenAI 500"));
 assert.equal(r.estado,"REVISAR");assert.equal(r.manuscritos.sin_comprobar,true);
 for(const k of ["obra","stel"]){assert.equal(r.manuscritos[k].estado,"REVISAR");assert.equal(r.manuscritos[k].valor,null);}
 assert.ok(r.incidencias.some(i=>/No se han podido leer los manuscritos/.test(i)));
 assert.ok(r.incidencias.some(i=>/sin validar: obra «sin leer»/.test(i)));
 // Sin lecturas, la comprobación de ABP contra STEL no tiene nada que validar.
 assert.equal(await validarStel(r,async()=>[{fullReference:"ABP261234",supplier:"x",accountId:777,date:"2026-03-03"}]),false);
});
test("obra por nombre: a la lectura le falta una cifra («PRY9011»): se completa solo con la obra que señala el nombre",()=>{
 const cat=[{codigo:"PRY90111",nombre:"COLMENA FICTICIA"},{codigo:"PRY90110",nombre:"OTRA OBRA"},{codigo:"PRY90011",nombre:"TERCERA INVENTADA"}];
 const lee=[{indice:0,tipo:"PRY",tachado:false,texto_literal:"PRY 9011",lecturas:[{codigo:"PRY9011",confianza:0.99}]}];
 const r=validarCodigos(lee,{catalogoObras:cat,catalogoObrasCompleto:true,obraEscrita:["colmena ficticia"]}).obra;
 assert.equal(r.valor,"PRY90111");assert.equal(r.estado,"OK");assert.match(r.resolucion.evidencias.join(" "),/falta una cifra/);
 // Sin el nombre, o con el catálogo incompleto: no.
 assert.notEqual(validarCodigos(lee,{catalogoObras:cat,catalogoObrasCompleto:true}).obra.estado,"OK");
 assert.notEqual(validarCodigos(lee,{catalogoObras:cat,catalogoObrasCompleto:false,obraEscrita:["colmena ficticia"]}).obra.estado,"OK");
 // Dos obras con ese nombre que se completan desde la lectura: no.
 const dos=[...cat,{codigo:"PRY90115",nombre:"COLMENA FICTICIA NORTE"}];
 assert.notEqual(validarCodigos(lee,{catalogoObras:dos,catalogoObrasCompleto:true,obraEscrita:["colmena ficticia"]}).obra.estado,"OK");
});
test("código STEL a mano: vale la cuenta de STEL sin CIF que otros albaranes del lote han demostrado del proveedor",async()=>{
 const {validarStel}=require("../albaranes/manuscritos.js");
 const base=()=>({fecha:{estado:"OK",valor:"2026-03-03"},numero:{valor:"600.111"},proveedor:{nombre:"PROVEEDOR FICTICIO",account_id:777},
  manuscritos:{stel:{valor:"ABP26-1234",literal:"ABP26 1234",estado:"REVISAR",resolucion:{alternativas:["ABP261234"]}}}});
 const nota={fullReference:"ABP261234",supplier:"",accountId:70,date:"2026-03-03",extraReference:""};
 // Cuenta distinta de la del CIF y sin demostrar: no.
 let r=base();assert.equal(await validarStel(r,async()=>[nota]),false);
 // Demostrada por otros albaranes del lote: sí, con la misma fecha (su único albarán ese día).
 const vinc={cuentasProveedor:new Set(["70"]),delMismoDia:()=>0};
 r=base();assert.equal(await validarStel(r,async()=>[nota],vinc),true);
 assert.match(r.manuscritos.stel.resolucion.evidencias.join(" "),/sin CIF del mismo proveedor/);
 // Otra fecha, u otro albarán de compra del proveedor ese mismo día: no.
 r=base();assert.equal(await validarStel(r,async()=>[{...nota,date:"2026-03-09"}],vinc),false);
 r=base();assert.equal(await validarStel(r,async()=>[nota],{...vinc,delMismoDia:()=>1}),false);
});
test("texto encima de la línea que es la obra del albarán: la descripción no queda en revisión; otro texto, sí",()=>{
 const {textoPrevioObra}=require("../albaranes/manuscritos.js");
 const cat=[{codigo:"PRY90088",nombre:"EDIFICIO FICTICIO TORREON DEL VALLE"}];
 const motivo=t=>"Texto justo encima de la línea: «"+t+"» (¿primer renglón de la descripción o anotación?)";
 const r=(t,obra={valor:"PRY90088",estado:"OK",confianza:0.95})=>({manuscritos:{obra},lineas:[{descripcion:{valor:"puerta de paso ficticia",estado:"REVISAR",conf_ocr:93,texto_previo:t,motivos:[motivo(t)]}}]});
 const a=r("TORREON DEL VALLE");assert.equal(textoPrevioObra(a,{catalogoObras:cat}),1);
 assert.equal(a.lineas[0].descripcion.estado,"OK");assert.equal(a.lineas[0].descripcion.motivos.length,0);
 assert.equal(a.lineas[0].descripcion.resolucion.metodo,"texto_previo_obra");
 // Texto que no es de la obra («Suministro y montaje»): sigue en revisión.
 const b=r("Suministro y montaje");assert.equal(textoPrevioObra(b,{catalogoObras:cat}),0);assert.equal(b.lineas[0].descripcion.estado,"REVISAR");
 // Obra sin validar, o una palabra que no es de la obra: no.
 const c=r("TORREON DEL VALLE",{valor:"PRY90088",estado:"REVISAR",confianza:0.8});assert.equal(textoPrevioObra(c,{catalogoObras:cat}),0);
 const d=r("TORREON NORTE");assert.equal(textoPrevioObra(d,{catalogoObras:cat}),0);
 // Con la obra del título del albarán de compra de STEL también vale.
 const e=r("TORREON",{estado:"VACIO"});e.albaran_stel={estado:"OK",obra:"TORREON"};assert.equal(textoPrevioObra(e,{catalogoObras:cat}),1);
});

// STEL sin respuesta (cupo agotado, 2026-10-23): una lectura del ABP que no se pudo consultar no
// cuenta como «no existe»; sin comprobarlas todas no hay unicidad que valga.
test("ABP con dos lecturas: si STEL no respondió para una, no se valida la otra aunque exista",async()=>{
 const {validarStel}=require("../albaranes/manuscritos.js");
 const r=()=>({fecha:{estado:"OK",valor:"2026-03-03"},numero:{valor:"600.111"},proveedor:{nombre:"PROVEEDOR FICTICIO, S.L."},
  manuscritos:{stel:{valor:null,literal:"ABP26 ?234",estado:"AMBIGUO",resolucion:{alternativas:["ABP261234","ABP267234"]}}}});
 const nota={fullReference:"ABP26-7234",supplier:"Proveedor Ficticio SL",date:"2026-03-03",extraReference:"600111"};
 const a=r();assert.equal(await validarStel(a,async c=>c==="ABP26-7234"?[nota]:[]),true);
 const b=r();assert.equal(await validarStel(b,async c=>c==="ABP26-7234"?[nota]:null),false);assert.equal(b.manuscritos.stel.estado,"AMBIGUO");
});

// Fallo hallado (2026-10-23): la cabecera de la tabla («REFERENCIA DESCRIPCIÓN CANTIDAD P. UNITARIO
// IMPORTE») se tomaba como obra impresa; sus palabras unían albaranes de obras distintas por
// coherencia del lote.
test("coherencia del lote: los títulos de la tabla no son palabras de obra",()=>{
 const {coherenciaLote,palabrasObra}=require("../albaranes/manuscritos.js");
 assert.equal(palabrasObra("DESCRIPCIÓN CANTIDAD P. UNITARIO IMPORTE").size,0);
 const ancla={obraImpresa:["OBRA RESIDENCIA FICTICIA","Cantidad Concepto Dto. Precio Importe"],obra:{valor:"PRY90111",estado:"OK",confianza:0.95,resolucion:{metodo:"obra_nombre_catalogo",evidencias:["x","y"]}}};
 const otro={obraImpresa:["DESCRIPCIÓN CANTIDAD P. UNITARIO IMPORTE"],obra:{valor:"PRY90111",estado:"REVISAR",confianza:0.8,resolucion:{metodo:"vision_recorte"}}};
 assert.equal(coherenciaLote([ancla,otro]),0);assert.equal(otro.obra.estado,"REVISAR");
 // Con una palabra de obra de verdad en común, sí.
 const tercero={obraImpresa:["RESIDENCIA FICTICIA"],obra:{valor:"PRY90111",estado:"REVISAR",confianza:0.8,resolucion:{metodo:"vision_recorte"}}};
 assert.equal(coherenciaLote([ancla,tercero]),1);
});

test('validarStel registra el albarán de compra asignado: el siguiente albarán leído no puede quedarse con él',async()=>{
 const M=require('../albaranes/manuscritos.js');
 const nota={id:41,fullReference:'ABP26-0041',supplier:'PROVEEDOR FICTICIO',accountId:3,date:'2026-05-04',extraReference:''};
 const mk=()=>({proveedor:{nombre:'PROVEEDOR FICTICIO',account_id:3},fecha:{valor:'2026-05-04',estado:'OK'},numero:{valor:'1'},
  manuscritos:{stel:{valor:null,literal:'ABP26 0041',estado:'REVISAR',confianza:0.5,resolucion:{alternativas:['ABP260041']}}}});
 const asignadas=new Set(),a=mk(),b=mk();
 const opc={asignadas,delMismoDia:()=>0};
 assert.equal(await M.validarStel(a,async()=>[nota],opc),true);
 assert.ok(asignadas.has('41'));assert.equal(a.manuscritos.stel.resolucion.id_stel,41);
 assert.equal(await M.validarStel(b,async()=>[nota],opc),false);
 assert.equal(b.manuscritos.stel.estado,'REVISAR');
});

test('ABP por fecha: si el número del proveedor en STEL (referencia externa o título) contradice el papel, no se valida aunque sea el único del día',async()=>{
 const {validarStel}=require("../albaranes/manuscritos.js");
 const base=()=>({fecha:{estado:"OK",valor:"2026-10-14"},numero:{valor:"600.111",estado:"OK",confianza:0.95},proveedor:{nombre:"PROVEEDOR FICTICIO, S.L."},
  manuscritos:{stel:{valor:"ABP26-1234",literal:"ABP26 1234",estado:"REVISAR",resolucion:{alternativas:["ABP261234"]}}}});
 const nota={id:8,fullReference:"ABP26-1234",supplier:"Proveedor Ficticio SL",date:"2026-10-14",extraReference:"",title:""};
 const unico={delMismoDia:()=>0};
 // Referencia externa con OTRO número del proveedor.
 let r=base();assert.equal(await validarStel(r,async()=>[{...nota,extraReference:"600.999"}],unico),false);
 assert.equal(r.manuscritos.stel.estado,"REVISAR");
 // Título con OTRO número del proveedor («número fecha obra»).
 r=base();assert.equal(await validarStel(r,async()=>[{...nota,title:"600.999 14/10/2026 OBRA FICTICIA"}],unico),false);
 assert.equal(r.manuscritos.stel.estado,"REVISAR");
 // Título con el MISMO número, o sin número: sí (único del día).
 r=base();assert.equal(await validarStel(r,async()=>[{...nota,title:"600.111 14/10/2026 OBRA FICTICIA"}],unico),true);
 r=base();assert.equal(await validarStel(r,async()=>[{...nota,title:"OBRA FICTICIA"}],unico),true);
 // Contradicción aunque coincida la referencia externa: el título dice otro número → no.
 r=base();assert.equal(await validarStel(r,async()=>[{...nota,extraReference:"600111",title:"600.999 14/10/2026 OBRA FICTICIA"}],unico),false);
});

test("pedido PAP escrito a mano: se lee (también como OTRO y con O por 0) y queda en revisión hasta validarlo con STEL",()=>{
 const M=require("../albaranes/manuscritos.js");
 assert.equal(M.normalizarPedido("PAPO9001"),"PAP09001");
 assert.equal(M.normalizarPedido("PAP 9O0I2"),"PAP90012");
 assert.equal(M.normalizarPedido("PAP123"),null);assert.equal(M.normalizarPedido("XPAP12345"),null);
 const v=M.validarCodigos([{indice:0,texto_literal:"PAPO9001",tachado:false,tipo:"OTRO",lecturas:[]}]);
 assert.equal(v.pedido.valor,"PAP09001");assert.equal(v.pedido.estado,"REVISAR");
 const t=M.validarCodigos([{indice:0,texto_literal:"PAP90001",tachado:false,tipo:"PAP",lecturas:[{codigo:"PAP90001",confianza:0.6},{codigo:"PAP90007",confianza:0.5}]}]);
 assert.equal(t.pedido.estado,"AMBIGUO");assert.deepEqual(t.pedido.resolucion.alternativas.sort(),["PAP90001","PAP90007"]);
 // Sin PAP: vacío y no exige nada (el pedido es opcional).
 const n=M.validarCodigos([]);assert.equal(n.pedido.estado,"VACIO");
 const r={estado:"AUTO_OK",incidencias:[],manuscritos:{obra:{valor:"PRY90001",estado:"OK"},stel:{valor:"ABP26-0001",estado:"OK"},pedido:{...v.pedido}}};
 M.aplicarEstado(r);assert.equal(r.estado,"REVISAR");assert.match(r.incidencias.join(" "),/pedido «PAPO9001»/);
 const s={estado:"AUTO_OK",incidencias:[],manuscritos:{obra:{valor:"PRY90001",estado:"OK"},stel:{valor:"ABP26-0001",estado:"OK"},pedido:n.pedido}};
 M.aplicarEstado(s);assert.equal(s.estado,"AUTO_OK");
});

// Fallo real 2026-11-25: un PAP escrito a mano en boli negro; el OCR local (solo compara con las obras) lo devolvió como NOTA con su
// lectura libre (letras por cifras) y el albarán no ofrecía su pedido. Códigos ficticios.
test("pedido PAP en la lectura libre del OCR local (NOTA): se propone, sin validar, y no va a las notas del título",async()=>{
 const M=require("../albaranes/manuscritos.js");
 const v=M.validarCodigos([{indice:0,texto_literal:"PAPO9 876",tachado:false,tipo:"NOTA",lecturas:[]}]);
 assert.equal(v.pedido.valor,"PAP09876");assert.equal(v.pedido.estado,"REVISAR");
 // Solo si TODA la lectura es el pedido: una nota con otras palabras, o sin el «PAP» entero, no.
 for(const t of ["Pablo 09876","PAP09876 recoge Juan","PA 09876","PAPO9 87"])
  assert.equal(M.validarCodigos([{indice:0,texto_literal:t,tachado:false,tipo:"NOTA",lecturas:[]}]).pedido.estado,"VACIO",t);
 // Una nota tachada no cuenta.
 assert.equal(M.validarCodigos([{indice:0,texto_literal:"PAPO9 876",tachado:true,tipo:"NOTA",lecturas:[]}]).pedido.valor,null);
 // De principio a fin: el pedido leído y ninguna «nota a mano» con él para el título.
 const g=lienzo();escribir(g,300,400);
 const pagina={numero:1,anchoPx:2480,altoPx:3508,gris:()=>g,recortePng:()=>"data:image/png;base64,AAAA"};
 const resultado={_pags:[{numero:1,lineas:[]}],lineas_ignoradas:[],lineas:[],proveedor:{id:"A"}};
 const m=await M.leerManuscritos([pagina],resultado,async pngs=>pngs.map((_,i)=>({indice:i,tipo:"NOTA",texto_literal:"PAPO9 876",tachado:false,lecturas:[]})));
 assert.equal(m.pedido.valor,"PAP09876");assert.equal(m.pedido.estado,"REVISAR");
 assert.deepEqual(m.notas,[]);
});

test("pedido PAP validado con STEL: mismo proveedor y con los artículos del albarán; si no, o con dos candidatos, no",async()=>{
 const M=require("../albaranes/manuscritos.js");
 const base=alt=>({numero:{valor:"700.001"},proveedor:{account_id:77},
  lineas:[{referencia:{valor:"A-100",estado:"OK"}},{referencia:{valor:"B-200",estado:"VERIFICADO"}}],
  manuscritos:{pedido:{valor:null,literal:"PAP9000?",estado:"AMBIGUO",resolucion:{alternativas:alt}}}});
 const ped=(ref,cuenta,refs,extra="")=>({id:1,fullReference:ref,accountId:cuenta,extraReference:extra,state:"Pendiente de recibir",lineas:refs.map(x=>({ref:x,unidades:1}))});
 // Solo una lectura es un pedido del mismo proveedor con esos artículos.
 let r=base(["PAP90001","PAP90007"]);
 assert.equal(await M.validarPedido(r,async()=>[ped("PAP90001",77,["A-100","B-200","DEP"],"700.001"),ped("PAP90007",77,["X-1"])]),true);
 assert.equal(r.manuscritos.pedido.valor,"PAP90001");assert.equal(r.manuscritos.pedido.estado,"OK");
 assert.match(r.manuscritos.pedido.resolucion.evidencias.at(-1),/mismo proveedor.*su referencia del proveedor es este albarán/);
 // Otro proveedor, o falta un artículo del albarán en el pedido: no.
 r=base(["PAP90001"]);assert.equal(await M.validarPedido(r,async()=>[ped("PAP90001",78,["A-100","B-200"])]),false);
 r=base(["PAP90001"]);assert.equal(await M.validarPedido(r,async()=>[ped("PAP90001",77,["A-100"])]),false);
 // Una línea sin referencia aceptada: no se puede comprobar el pedido.
 r=base(["PAP90001"]);r.lineas[1].referencia.estado="REVISAR";assert.equal(await M.validarPedido(r,async()=>[ped("PAP90001",77,["A-100","B-200"])]),false);
 // Las dos lecturas encajan: no se resuelve.
 r=base(["PAP90001","PAP90007"]);
 assert.equal(await M.validarPedido(r,async()=>[ped("PAP90001",77,["A-100","B-200"]),ped("PAP90007",77,["A-100","B-200"])]),false);
 assert.equal(r.manuscritos.pedido.estado,"AMBIGUO");
 // STEL no responde: sin validar (nunca «no existe»).
 r=base(["PAP90001"]);assert.equal(await M.validarPedido(r,async()=>null),false);assert.equal(r.manuscritos.pedido.estado,"AMBIGUO");
});

test("S/Referencia impresa: solo lo leído con fiabilidad, también con la etiqueta pegada (usuario, 2026-11-11)", ()=>{
 const {suReferencia}=require("../albaranes/manuscritos.js");
 assert.equal(suReferencia([{texto:"S/REF:CENTRO FICTICIO para PRY00001",celdas:[{texto:"S/REF:CENTRO",conf:92},{texto:"FICTICIO",conf:90},{texto:"para",conf:40},{texto:"PRY00001",conf:30}]}]),"CENTRO FICTICIO");
 assert.equal(suReferencia([{texto:"Su Pedido OBRA FICTICIA"}]),"OBRA FICTICIA");
 assert.equal(suReferencia([{texto:"Ref. cliente: NAVE 9"}]),"NAVE 9");
 assert.equal(suReferencia([{texto:"OBRA: ALMACEN"}]),null);
 assert.equal(suReferencia([{texto:"S/REF:",celdas:[{texto:"S/REF:",conf:95}]}]),null);
});

test("anotación a mano con número (tipo ANOTACION del OCR local): se recoge con su página, sin darla por leída",async()=>{
 const g=lienzo();escribir(g,300,400);
 const pagina={numero:1,anchoPx:2480,altoPx:3508,gris:()=>g,recortePng:()=>"data:image/png;base64,AAAA"};
 const resultado={_pags:[{numero:1,lineas:[]}],lineas_ignoradas:[],proveedor:{id:"A"}};
 const vision=async recortes=>recortes.map((_,i)=>({indice:i,texto_literal:"cis fic 202611234",tachado:false,tipo:"ANOTACION",lecturas:[]}));
 const m=await leerManuscritos([pagina],resultado,vision);
 assert.deepEqual(m.anotaciones,[{pagina:1,lectura:"cis fic 202611234"}]);
 assert.notEqual(m.obra.estado,"OK");
});

// Fallo real 2026-11-18: «Su referencia: PEDIDO: PAP01234» impreso; el lector solo buscaba el PAP escrito a mano. Ficticio.
test("pedido impreso: con lo escrito igual o sin escribir, validado; con otro escrito, en revisión; poca confianza o dos, nada",()=>{
 const M=require("../albaranes/manuscritos.js");
 const lin=(...cs)=>[{texto:cs.map(c=>c[0]).join(" "),celdas:cs.map(([texto,conf])=>({texto,conf}))}];
 const imp=M.pedidoImpreso(lin(["PEDIDO:",95],["PAP09999",96]));
 assert.equal(imp.valor,"PAP09999");
 const dudoso=M.pedidoImpreso(lin(["PEDIDO:",95],["PAP09999",48]));assert.equal(dudoso.fiable,false);
 assert.equal(M.conPedidoImpreso({valor:null,estado:"VACIO",motivos:[],resolucion:{}},dudoso).estado,"REVISAR");
 assert.equal(M.pedidoImpreso(lin(["PAP09999",20])),null);
 assert.equal(M.pedidoImpreso([...lin(["PAP09999",96]),...lin(["PAP09998",96])]),null);
 const vacio={valor:null,estado:"VACIO",motivos:[],resolucion:{}};
 assert.equal(M.conPedidoImpreso(vacio,imp).estado,"OK");
 const escrito={valor:"PAP09999",estado:"REVISAR",motivos:["x"],resolucion:{alternativas:["PAP09999"],evidencias:[]}};
 const ok=M.conPedidoImpreso(escrito,imp);assert.equal(ok.estado,"OK");assert.equal(ok.valor,"PAP09999");
 const otro=M.conPedidoImpreso({...escrito,valor:"PAP09990",resolucion:{alternativas:["PAP09990"]}},imp);
 assert.equal(otro.estado,"AMBIGUO");assert.equal(otro.valor,null);
 assert.equal(M.conPedidoImpreso(escrito,null),escrito);
});

// Proyectos PRYMP (usuario, 2026-11-20): el código de obra escrito a mano también puede ser «PRYMP» y 5 cifras. Ficticio.
test("obra PRYMP escrita a mano: formato válido y validada con el catálogo y su nombre como las PRY",()=>{
 const M=require("../albaranes/manuscritos.js");
 assert.equal(M.FORMATOS.obra.test("PRYMP90001"),true);assert.equal(M.FORMATOS.obra.test("PRY90001"),true);assert.equal(M.FORMATOS.obra.test("PRYMP9001"),false);
 const r=M.validarCodigos([{indice:0,texto_literal:"PRYMP90001",tachado:false,tipo:"PRY",lecturas:[{codigo:"PRYMP90001",confianza:0.97}]}],
  {catalogoObras:[{codigo:"PRYMP90001",nombre:"ABRIGO FICTICIO"}],catalogoObrasCompleto:true,obraImpresa:["ABRIGO FICTICIO"]});
 assert.equal(r.obra.estado,"OK");assert.equal(r.obra.valor,"PRYMP90001");
});

// Quién recoge, impreso (usuario, 2026-11-20: «si un DNI o un nombre» en el título). Nombres y DNI ficticios (letra de control válida).
test("quienRecoge: nombre y DNI impresos; lo escrito a mano, un DNI con letra mala o el NIF del proveedor no", ()=>{
 const {quienRecoge,dniValido}=require("../albaranes/manuscritos.js");
 const l=(texto,conf=95)=>({texto,celdas:texto.split(" ").map(t=>({texto:t,conf}))});
 assert.equal(dniValido("12345678-Z"),"12345678Z");assert.equal(dniValido("12345678A"),null);assert.equal(dniValido("X1234567L"),"X1234567L");
 assert.equal(quienRecoge([l("Retirado por: JUAN FICTICIO DNI 12345678Z")]),"JUAN FICTICIO · DNI 12345678Z");
 assert.equal(quienRecoge([l("Recogido por: PEDRO EJEMPLO"),l("Fecha 01/10/2026")]),"PEDRO EJEMPLO");
 assert.equal(quienRecoge([l("D.N.I.: X1234567L")]),"DNI X1234567L");
 // Escrito a mano (confianza baja): nada.
 assert.equal(quienRecoge([{texto:"Retirado por: Juan",celdas:[{texto:"Retirado",conf:95},{texto:"por:",conf:95},{texto:"Juan",conf:40}]}]),null);
 assert.equal(quienRecoge([l("Retirado por: JUAN DNI 12345678A")]),"JUAN");
 assert.equal(quienRecoge([l("DNI 12345678Z")],["12345678Z"]),null);
 assert.equal(quienRecoge([l("CIF B00000000 TRANSPORTE PROPIO")]),null);
});

// Fallo real 2026-11-23 (escaneado): «Retirado por:NOMBRE DNI NIF:DNI» con confianza OCR muy baja en «por:NOMBRE» y el DNI pegado a
// «NIF:»; y la casilla S/REF vacía impresa como «S REF». Datos ficticios (DNI con letra de control válida).
test("quienRecoge: el DNI válido de la línea respalda el nombre aunque el OCR dude; S/REF vacía no es referencia", ()=>{
 const {quienRecoge,suReferencia}=require("../albaranes/manuscritos.js");
 const L=(...c)=>({texto:c.map(x=>x[0]).join(" "),celdas:c.map(([texto,conf])=>({texto,conf}))});
 assert.equal(quienRecoge([L(["Retirado",97],["por:",11],["PEDRO",11],["12345678Z",89],["NIF:12345678Z",88])]),"PEDRO · DNI 12345678Z");
 assert.equal(quienRecoge([L(["Retirado",97],["por: PEDRO",0],["NIF:12345678Z",91])]),"PEDRO · DNI 12345678Z");
 // Sin DNI válido, un nombre dudoso no entra; el DNI con la letra mal, tampoco.
 assert.equal(quienRecoge([L(["Retirado",97],["por:",11],["PEDRO",11],["NIF:12345678A",88])]),null);
 // El NIF de otra línea sin «retirado» ni «DNI» (p. ej. del cliente) no es quien recoge.
 assert.equal(quienRecoge([L(["CLIENTE",95],["NIF:12345678Z",95])]),null);
 assert.equal(suReferencia([L(["S/REF:S",92],["REF",97])]),null);
 assert.equal(suReferencia([L(["S/REF:S/REF",92])]),null);
 assert.equal(suReferencia([L(["S/REF:S",92],["REF",97]),L(["S/REF:OBRA",92],["FICTICIA",96])]),"OBRA FICTICIA");
});
test("coherenciaRecoge: el mismo DNI con un nombre mal leído en un solo albarán del lote toma el mayoritario", ()=>{
 const {coherenciaRecoge}=require("../albaranes/manuscritos.js");
 const l=["PEDRO","PEDRO","PEDRO","PEDR"].map(n=>({recoge:n+" · DNI 12345678Z"})).concat([{recoge:"ANA · DNI X1234567L"},{recoge:null}]);
 coherenciaRecoge(l);
 assert.deepEqual(l.map(x=>x.recoge),["PEDRO · DNI 12345678Z","PEDRO · DNI 12345678Z","PEDRO · DNI 12345678Z","PEDRO · DNI 12345678Z","ANA · DNI X1234567L",null]);
 // Empate o diferencia de uno: no se cambia.
 const e=[{recoge:"PEDRO · DNI 12345678Z"},{recoge:"PEDR · DNI 12345678Z"}];coherenciaRecoge(e);
 assert.equal(e[1].recoge,"PEDR · DNI 12345678Z");
});
// Notas libres a mano para el título (usuario, 2026-11-23). Lecturas reales del modelo ante firmas y texto impreso (inventadas en
// inglés) y notas ficticias.
test("notaPlausible y enZonaDeFirma: fuera las frases inventadas, los signos sueltos y lo que está en la casilla de firma", ()=>{
 const {notaPlausible,enZonaDeFirma}=require("../albaranes/manuscritos.js");
 for(const t of ["the establishment of the province's","MR. Fitzmontainefsonferencecondenue and an extra time","0- 0. 0. 0. 1,0003.","·","THE FEDEROUS S. FACceeded into the entire"])
  assert.equal(notaPlausible(t),false,t);
 for(const t of ["FALTA 1 CAJA","Pedro","TLF 600 000 000","devolver 2 codos"])assert.equal(notaPlausible(t),true,t);
 const lin=[{texto:"Recibí de conformidad el cliente",y:600,alto:8,celdas:[{texto:"Recibí",x0:200,x1:230},{texto:"cliente",x0:320,x1:350}]}];
 assert.equal(enZonaDeFirma([300,620,120,40],lin),true,"debajo de «Recibí»");
 assert.equal(enZonaDeFirma([100,300,120,30],lin),false,"en mitad de la tabla");
 assert.equal(enZonaDeFirma([60,620,100,40],[{texto:"Por Proveedor",y:600,alto:8,celdas:[{texto:"Por",x0:70,x1:85},{texto:"Proveedor",x0:88,x1:130}]}]),true,"casilla «Por <empresa>»");
});
// Notas a mano por tipo (usuario, 2026-11-23: «nombre, referencia, número, matrícula o descripción»). Las malas son lecturas reales
// del modelo en 40 albaranes (texto impreso mal detectado o frases inventadas); las buenas, ficticias.
test("clasificarNota: solo matrícula, número, referencia, nombre o descripción, y nada que ya esté impreso", ()=>{
 const {clasificarNota}=require("../albaranes/manuscritos.js");
 const ctx={impreso:["SALTOKI","PONFERRADA","TOTAL","LINEAS","DIRECCION","ENVIO","RAZON","SOCIAL","COMPONENTES","FRIGORIFICOS","VENTAJAS","CLIENTES"],vocabulario:["CODO","MULTICAPA","TUBO"]};
 for(const t of ["spouse","1961 Total lineas","MRF0","W. 200m","O\"35 Grundfosky 5eara","SSATON 0","0 0","SALTON","ITV","isation","ISATOKI","tops","0 1","SALTOKI 12",
  "ITVEC","ITV expansion","MAN Government","Direccion de envio","Components Frigorificos","Razon Social","Isaltoki 10","Ventaias parati","y paratus clientes","42 000","I 950 )",
  "0Sentinel coverage","ITVIII","1953- Nelson Tennessee","MissINESS Miss Texas since November 1892","800 fatalities ( 12247. 1.2. 1.2. 2","III Metalleness 121.60.4.60 1VA.21,0096"])
  assert.equal(clasificarNota(t,ctx),null,t);
 assert.deepEqual(clasificarNota("1234 BCD",ctx),{tipo:"MATRICULA",texto:"1234BCD"});
 assert.deepEqual(clasificarNota("600 123 456",ctx),{tipo:"NUMERO",texto:"600 123 456"});
 assert.deepEqual(clasificarNota("pedido 2026",ctx),null,"una palabra suelta con un número no es nada claro");
 assert.deepEqual(clasificarNota("PAP09996",ctx),{tipo:"REFERENCIA",texto:"PAP09996"});
 assert.deepEqual(clasificarNota("Pedro",ctx),{tipo:"NOMBRE",texto:"PEDRO"});
 assert.deepEqual(clasificarNota("Juan Ficticio",ctx),{tipo:"NOMBRE",texto:"JUAN FICTICIO"});
 assert.deepEqual(clasificarNota("falta 2 codos",ctx),{tipo:"DESCRIPCION",texto:"FALTA 2 CODOS"});
 assert.deepEqual(clasificarNota("devolver tubo multicapa",ctx),{tipo:"DESCRIPCION",texto:"DEVOLVER TUBO MULTICAPA"});
});
