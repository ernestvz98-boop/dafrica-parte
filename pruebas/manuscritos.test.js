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
 let r=base();assert.equal(await validarStel(r,async()=>[doc],{diagnostico:x=>vistos.push(x)}),true);
 assert.equal(vistos[0].mismo_proveedor,true);assert.equal(vistos[0].cuenta_stel,777);
 // Otra cuenta, aunque el nombre coincida: no.
 r=base();assert.equal(await validarStel(r,async()=>[{...doc,accountId:778,supplier:"PROVEEDOR FICTICIO SL"}]),false);
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
