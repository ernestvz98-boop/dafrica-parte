"use strict";
// Orden para STEL de cada albarán leído (Fase 2). Datos ficticios.
const test=require("node:test"),assert=require("node:assert/strict");
const C=require("../albaranes/cola-stel.js");

const ok=(valor,extra={})=>({valor,literal:String(valor),estado:"OK",confianza:0.99,...extra});
function doc(cambios={}){
 const r={
  proveedor:{nombre:"SUMINISTROS FICTICIOS SL",estado:"OK",account_id:9001},
  numero:ok("123.456"),fecha:ok("2026-10-22"),
  manuscritos:{obra:ok("PRY09999")},
  lineas:[{pagina:1,referencia:ok("REF-001"),descripcion:ok("TUBO FICTICIO 20MM"),cantidad:ok(4),unidad:ok("UD"),
   precio:ok(2.5),descuento:{porcentajes:[10]},importe:ok(9)}],
  totales:{total:ok(10.89)},
  ...cambios.resultado};
 return {archivo:"ficticio.pdf",paginas:[1],estado_documento:"AUTO_OK",...cambios,resultado:r};
}
const catalogo={articulos_completo:true,obras_completo:true,proveedores:[{id:9001,nombre:"SUMINISTROS FICTICIOS, S.L."}],
 obras:[{id:555,codigo:"PRY09999",nombre:"OBRA FICTICIA"}],
 articulos:[{id:777,referencia:"REF-001",descripcion:"TUBO FICTICIO 20MM"},{id:778,referencia:"OTRA-9",descripcion:"CODO FICTICIO"}]};

test("albarán AUTO_OK con todo resuelto: pendiente de crear", ()=>{
 const o=C.orden(doc(),catalogo);
 assert.equal(o.estado,"PENDIENTE",o.motivos.join("; "));
 assert.equal(o.clave,"9001|123456|2026-10-22");
 assert.equal(o.plan.fecha,"22/10/2026");
 assert.deepEqual(o.plan.obra,{codigo:"PRY09999",stel_id:555,nombre:"OBRA FICTICIA"});
 assert.equal(o.plan.proveedor.nombre_stel,"SUMINISTROS FICTICIOS, S.L.");
 assert.equal(o.plan.lineas[0].articulo.item_id,777);
 assert.deepEqual(o.plan.lineas[0].descuentos,[10]);
 assert.equal(o.plan.aviso_precio,null);
});

// 2026-11-25: la cantidad que no se leyó y que sugiere el cuadre llega al plan para ofrecerla en la revisión; nunca como cantidad.
test("cantidad sin leer con sugerencia del cuadre: va al plan como sugerencia, la cantidad sigue vacía", ()=>{
 const l={pagina:1,referencia:ok("REF-001"),descripcion:ok("TUBO FICTICIO 20MM"),cantidad:{valor:null,literal:"",estado:"VACIO",sugerida:-1},unidad:ok("UD"),
  precio:ok(2.5),descuento:{porcentajes:[]},importe:ok(-2.5)};
 const o=C.orden(doc({estado_documento:"REVISAR",resultado:{lineas:[l]}}),catalogo);
 assert.equal(o.plan.lineas[0].cantidad,null);
 assert.equal(o.plan.lineas[0].cantidad_sugerida,-1);
 assert.equal(o.estado,"REVISAR");
 assert.equal(C.orden(doc(),catalogo).plan.lineas[0].cantidad_sugerida,undefined,"con la cantidad leída, ninguna sugerencia");
});

test("el lector no lo da por bueno: REVISAR, nunca automático", ()=>{
 const o=C.orden(doc({estado_documento:"REVISAR"}),catalogo);
 assert.equal(o.estado,"REVISAR");assert.match(o.motivos.join(),/no lo da por bueno/);
});

test("sin obra validada o sin proyecto único en STEL: REVISAR", ()=>{
 assert.equal(C.orden(doc({resultado:{manuscritos:{obra:{valor:"PRY09999",estado:"REVISAR"}}}}),catalogo).estado,"REVISAR");
 const sinProyecto=C.orden(doc({resultado:{manuscritos:{obra:ok("PRY01111")}}}),catalogo);
 assert.equal(sinProyecto.estado,"REVISAR");assert.match(sinProyecto.motivos.join(),/no encontrada/);
 const repetida=C.orden(doc(),{...catalogo,obras:[...catalogo.obras,{id:556,codigo:"PRY09999",nombre:"OTRA"}]});
 assert.equal(repetida.estado,"REVISAR");assert.match(repetida.motivos.join(),/repetida/);
});

test("proveedor sin cuenta de STEL verificada: REVISAR", ()=>{
 const o=C.orden(doc({resultado:{proveedor:{nombre:"X",estado:"REVISAR",account_id:null}}}),catalogo);
 assert.equal(o.estado,"REVISAR");assert.equal(o.clave,null);
 // El CIF leído va al plan para proponerlo si la persona decide crear el proveedor en STEL (usuario, 2026-11-16).
 const conCif=C.orden(doc({resultado:{proveedor:{nombre:"X",nif:"B12345674",estado:"NIF_NO_REGISTRADO",account_id:null}}}),catalogo);
 assert.equal(conCif.plan.proveedor.nif_leido,"B12345674");assert.equal(conCif.plan.proveedor.account_id,null);
});

test("número o fecha sin confirmar: REVISAR", ()=>{
 assert.equal(C.orden(doc({resultado:{numero:{valor:"123.456",estado:"REVISAR",confianza:0.6}}}),catalogo).estado,"REVISAR");
 assert.equal(C.orden(doc({resultado:{fecha:{valor:"2026-10-22",estado:"OK",confianza:0.5}}}),catalogo).estado,"REVISAR");
});

test("sin precio y sin pedido: 0,00 con aviso PRECIO PENDIENTE (nunca un precio estimado)", ()=>{
 const d=doc();d.resultado.lineas[0].precio={valor:null,estado:"VACIO"};
 const o=C.orden(d,catalogo);
 assert.equal(o.estado,"PENDIENTE");
 assert.equal(o.plan.lineas[0].precio,null);assert.equal(o.plan.lineas[0].precio_pendiente,true);
 assert.equal(o.plan.aviso_precio,"PRECIO PENDIENTE");
});

test("sin precio con pedido validado: sin aviso (el robot toma el precio del pedido)", ()=>{
 const d=doc({resultado:{manuscritos:{obra:ok("PRY09999"),pedido:ok("PAP09001")}}});d.resultado.lineas[0].precio={valor:null,estado:"VACIO"};
 const o=C.orden(d,catalogo);
 assert.equal(o.estado,"PENDIENTE");assert.deepEqual(o.plan.pedido,{codigo:"PAP09001"});assert.equal(o.plan.aviso_precio,null);
});

test("pedido leído y sin validar: REVISAR", ()=>{
 const o=C.orden(doc({resultado:{manuscritos:{obra:ok("PRY09999"),pedido:{valor:"PAP09001",estado:"REVISAR"}}}}),catalogo);
 assert.equal(o.estado,"REVISAR");assert.match(o.motivos.join(),/PAP/);
});

test("artículo nuevo sin parecidos: se propone crearlo; con parecidos: REVISAR; con catálogo incompleto lo busca el robot", ()=>{
 const nuevo=doc();nuevo.resultado.lineas[0].referencia=ok("ZZ-12345");nuevo.resultado.lineas[0].descripcion=ok("VALVULA FICTICIA ESFERA");
 const o=C.orden(nuevo,catalogo);
 assert.equal(o.estado,"PENDIENTE",o.motivos.join("; "));
 assert.equal(o.plan.lineas[0].articulo.estado,"crear");
 assert.equal(o.plan.lineas[0].articulo.propuesta.referencia,"ZZ-12345");
 const parecido=doc();parecido.resultado.lineas[0].referencia=ok("REF-0001");parecido.resultado.lineas[0].descripcion=ok("TUBO FICTICIO 20MM GRIS");
 const p=C.orden(parecido,catalogo);
 assert.equal(p.estado,"REVISAR");assert.equal(p.plan.lineas[0].articulo.estado,"revisar");
 assert.equal(C.orden(nuevo,{...catalogo,articulos_completo:false}).plan.lineas[0].articulo.estado,"buscar");
});

test("artículo nuevo sin referencia en el papel: se propone el alta igual (usuario, 2026-11-11)", ()=>{
 const d=doc();d.resultado.lineas[0].referencia={valor:null,estado:"VACIO"};d.resultado.lineas[0].descripcion=ok("SELLADOR FICTICIO BLANCO 290ML");
 const o=C.orden(d,catalogo);
 assert.equal(o.estado,"PENDIENTE",o.motivos.join("; "));
 assert.equal(o.plan.lineas[0].articulo.estado,"crear");assert.equal(o.plan.lineas[0].articulo.propuesta.referencia,"");
});

test("ya está en STEL (ABP encontrado por el lector): YA_EXISTE, no se crea otro", ()=>{
 const o=C.orden(doc({resultado:{albaran_stel:{estado:"OK",referencia:"ABP09999",id:42}}}),catalogo);
 assert.equal(o.estado,"YA_EXISTE");assert.equal(o.plan.ya_en_stel.id,42);
});

test("cantidad sin confirmar o sin líneas: REVISAR", ()=>{
 const d=doc();d.resultado.lineas[0].cantidad={valor:null,estado:"REVISAR"};
 assert.equal(C.orden(d,catalogo).estado,"REVISAR");
 assert.equal(C.orden(doc({resultado:{lineas:[]}}),catalogo).estado,"REVISAR");
});

test("fecha en formato de STEL", ()=>{
 assert.equal(C.fechaStel("2026-01-05"),"05/01/2026");assert.equal(C.fechaStel("5/1/2026"),null);
});

test("alta con parecidos: la misma descripción que uno de STEL (puede ser él con el código mal leído) o algo dudoso, REVISAR; otra descripción bien leída, lo resuelve el robot", ()=>{
 const con=(ref,desc,conf=0.95)=>{const d=doc();d.resultado.lineas[0].referencia={...ok(ref),confianza:conf};d.resultado.lineas[0].descripcion=ok(desc);return C.orden(d,catalogo);};
 // Misma descripción (con palabras de más o de menos): REVISAR.
 assert.equal(con("ZZ-777","TUBO FICTICIO 20MM GRIS CLARO").estado,"REVISAR");
 assert.equal(con("REF-0001","TUBO FICTICIO 20MM GRIS").estado,"REVISAR");
 // Código a un carácter o con las mismas cifras pero OTRO artículo (usuario, 2026-11-23: real «CODO … 25» frente a «CODO … 20»):
 // el robot lo busca por su código y, si no está, lo crea (regla del 2026-10-30).
 const r=con("REF-0001","PIEZA DISTINTA DEL TODO");
 assert.equal(r.estado,"PENDIENTE",r.motivos.join("; "));
 assert.deepEqual([r.plan.lineas[0].articulo.estado,r.plan.lineas[0].articulo.via],["buscar","robot_stel_parecidos"]);
 assert.deepEqual(r.plan.lineas[0].articulo.propuesta,{referencia:"REF-0001",descripcion:"PIEZA DISTINTA DEL TODO"});
 const cifras={...catalogo,articulos:[...catalogo.articulos,{id:779,referencia:"AB12345",descripcion:"MANGUITO FICTICIO"}]};
 const d=doc();d.resultado.lineas[0].referencia=ok("12345");d.resultado.lineas[0].descripcion=ok("PIEZA DISTINTA DEL TODO");
 // Mismas cifras que otro código: la regla del buscador de artículos (articulos.js) lo sigue dejando en revisión.
 assert.equal(C.orden(d,cifras).estado,"REVISAR");
 // Código leído con poca confianza: REVISAR (un código mal leído crearía un duplicado).
 assert.equal(con("REF-0001","PIEZA DISTINTA DEL TODO",0.6).plan.lineas[0].articulo.estado,"revisar");
 assert.equal(con("ZZ-12345","VALVULA FICTICIA ESFERA").estado,"PENDIENTE");
});

test("Fase 2: la falta del ABP escrito no impide el automático si es lo único y la búsqueda en STEL fue completa", ()=>{
 const d=doc({estado_documento:"REVISAR",resultado:{fiable:true,confianza:0.95,incidencias:["Código manuscrito no detectado: STEL (ABP); comprueba el papel"]}});
 assert.equal(C.orden(d,catalogo,{busquedaStelCompleta:true}).estado,"PENDIENTE");
 assert.equal(C.orden(d,catalogo,{busquedaStelCompleta:false}).estado,"REVISAR","sin búsqueda completa");
 const otra=doc({estado_documento:"REVISAR",resultado:{fiable:true,confianza:0.95,incidencias:["Código manuscrito no detectado: STEL (ABP); comprueba el papel","Confianza del documento 0.75 < 0.9: requiere revisión"]}});
 assert.equal(C.orden(otra,catalogo,{busquedaStelCompleta:true}).estado,"REVISAR","otra incidencia");
 const obra=doc({estado_documento:"REVISAR",resultado:{fiable:true,confianza:0.95,incidencias:["Código manuscrito no detectado: obra (PRY), STEL (ABP); comprueba el papel"]}});
 assert.equal(C.orden(obra,catalogo,{busquedaStelCompleta:true}).estado,"REVISAR","falta también la obra");
 const baja=doc({estado_documento:"REVISAR",resultado:{fiable:false,confianza:0.75,incidencias:["Código manuscrito no detectado: STEL (ABP); comprueba el papel"]}});
 assert.equal(C.orden(baja,catalogo,{busquedaStelCompleta:true}).estado,"REVISAR","documento poco fiable");
});

test("sin la lista de proyectos de STEL: la obra validada va sin id (la elige el robot); con lista completa sin ella, REVISAR", ()=>{
 const o=C.orden(doc(),{...catalogo,obras:[],obras_completo:false});
 assert.equal(o.estado,"PENDIENTE");assert.deepEqual(o.plan.obra,{codigo:"PRY09999",stel_id:null,nombre:null});
 assert.equal(C.orden(doc({resultado:{manuscritos:{obra:ok("PRY01111")}}}),{...catalogo,obras_completo:true}).estado,"REVISAR");
});

test("catálogo leído a medias: el artículo no encontrado lo busca el robot en STEL", ()=>{
 const d=doc();d.resultado.lineas[0].referencia=ok("ZZ-12345");d.resultado.lineas[0].descripcion=ok("VALVULA FICTICIA ESFERA");
 const o=C.orden(d,{...catalogo,articulos_completo:false});
 assert.equal(o.estado,"PENDIENTE",o.motivos.join("; "));
 assert.equal(o.plan.lineas[0].articulo.estado,"buscar");
 assert.equal(o.plan.lineas[0].articulo.item_id,null);
});

// Prueba real del 2026-10-28 (lote de 40 páginas): ningún documento desaparece de la cola.
test("documento sin proveedor de STEL o sin lectura: sin clave, pero con plan y motivos (se guarda en revisión con clave provisional)", ()=>{
 const sinCuenta=C.orden(doc({resultado:{proveedor:{nombre:"PROVEEDOR NO REGISTRADO",estado:"REVISAR",account_id:null}}}),catalogo);
 assert.equal(sinCuenta.clave,null);assert.ok(sinCuenta.plan);assert.match(sinCuenta.motivos.join(),/Proveedor sin cuenta/);
 const sinLectura=C.orden({archivo:"f.pdf",paginas:[7],resultado:null,estado_documento:"ERROR_DOCUMENTO",error:"Página ilegible"},catalogo);
 assert.equal(sinLectura.estado,"REVISAR");assert.deepEqual(sinLectura.plan.paginas,[7]);assert.match(sinLectura.motivos[0],/Página ilegible/);
 assert.equal(C.claveProvisional("a".repeat(64)),"SIN_IDENTIFICAR|"+"a".repeat(64));
 assert.equal(C.claveProvisional("no-es-huella"),null);
});

test("abono o rectificativo (impreso o con cantidades negativas): nunca PENDIENTE y el plan lo dice", ()=>{
 const o=C.orden(doc({resultado:{tipo_documento:{valor:"ABONO",evidencia:"Impreso «ABONO» en el documento"}}}),catalogo);
 assert.equal(o.estado,"REVISAR");assert.equal(o.plan.tipo,"ABONO");assert.match(o.motivos.join(),/Abono o rectificativo/);
 assert.equal(C.orden(doc(),catalogo).plan.tipo,"ALBARAN");
});

test("comprobaciones de STEL que no se pudieron hacer quedan anotadas para repetir solo esas", ()=>{
 const o=C.orden(doc(),catalogo,{catalogoIncompleto:true,busquedaStelIncompleta:true});
 assert.deepEqual(o.plan.comprobaciones_pendientes,["catalogo_stel","albaranes_stel"]);
 assert.deepEqual(C.orden(doc(),catalogo).plan.comprobaciones_pendientes,[]);
});

test("artículo aprendido de una revisión confirmada: la próxima lectura lo resuelve sola (2026-10-29)", ()=>{
 // La referencia del papel no está tal cual en el catálogo y hay un parecido: sin lo aprendido, revisión.
 const d=doc({resultado:{lineas:[{pagina:1,referencia:ok("REF-0099"),descripcion:ok("MANGUITO FICTICIO 25"),cantidad:ok(4),unidad:ok("UD"),precio:ok(2.5),importe:ok(10)}]}});
 const cat={...catalogo,articulos:[...catalogo.articulos,{id:779,referencia:"REF-0099-ANTIGUA",descripcion:"MANGUITO FICTICIO 25 VIEJO"}]};
 assert.equal(C.orden(d,cat).estado,"REVISAR");
 const o=C.orden(d,{...cat,mapeos:[{account_id:"9001",referencia_canonica:"REF0099",item_id:"779"}]});
 assert.equal(o.estado,"PENDIENTE",o.motivos.join("; "));
 assert.deepEqual([o.plan.lineas[0].articulo.estado,String(o.plan.lineas[0].articulo.item_id),o.plan.lineas[0].articulo.via],["existente","779","mapeo_guardado"]);
 // Lo aprendido de OTRO proveedor no vale.
 assert.equal(C.orden(d,{...cat,mapeos:[{account_id:"9002",referencia_canonica:"REF0099",item_id:"779"}]}).estado,"REVISAR");
});

test("sin ningún código de obra leído ni obra impresa: albarán sin obra, automático (usuario, 2026-11-11)", ()=>{
 const FALTA="Código manuscrito no detectado: obra (PRY); comprueba el papel",AMBAS="Código manuscrito no detectado: obra (PRY), STEL (ABP); comprueba el papel";
 const sin=(m={},inc=[FALTA],extra={})=>doc({estado_documento:"REVISAR",...extra,resultado:{fiable:true,confianza:0.95,incidencias:inc,
  manuscritos:{obra:{valor:null,literal:"",estado:"VACIO"},obraImpresa:[],obraEscrita:[],recortes:[],...m}}});
 const o=C.orden(sin(),catalogo);
 assert.equal(o.estado,"PENDIENTE",o.motivos.join("; "));
 assert.equal(o.plan.sin_obra,true);assert.equal(o.plan.obra,null);
 // Firmas o anotaciones sin ningún código de obra: también sin obra.
 assert.equal(C.orden(sin({recortes:[{pagina:1,caja:[0,0,10,10],lectura:null}]}),catalogo).plan.sin_obra,true);
 // Algo leído con otro formato (queda su literal) o leído y sin validar: puede ser la obra.
 assert.equal(C.orden(sin({obra:{valor:null,literal:"PRX 12",estado:"VACIO"}}),catalogo).estado,"REVISAR");
 assert.equal(C.orden(sin({obra:{valor:null,literal:"PRY0001",estado:"AMBIGUO"}}),catalogo).estado,"REVISAR");
 // Manuscritos sin comprobar (OCR caído) o visión fallida en la lectura.
 assert.equal(C.orden(sin({sin_comprobar:true}),catalogo).estado,"REVISAR");
 assert.equal(C.orden(sin(),catalogo,{visionFallida:true}).estado,"REVISAR");
 // Obra impresa en el albarán sin resolver: no es «sin obra».
 assert.equal(C.orden(sin({obraImpresa:["OBRA FICTICIA"]}),catalogo).estado,"REVISAR");
 // Otra incidencia del lector: sigue en revisión.
 assert.equal(C.orden(sin({},[FALTA,"Total sin cuadrar"]),catalogo).estado,"REVISAR");
 // También falta el ABP: solo con la búsqueda en STEL completa.
 assert.equal(C.orden(sin({},[AMBAS]),catalogo).estado,"REVISAR");
 assert.equal(C.orden(sin({},[AMBAS]),catalogo,{busquedaStelCompleta:true}).estado,"PENDIENTE");
 // Con la obra leída, nunca «sin obra».
 assert.equal(C.orden(doc(),catalogo).plan.sin_obra,undefined);
});

// Usuario (2026-11-16): lo escrito a mano que no es la obra («XX XXXX 2026/1234») va al título, pero el número no se lee con
// seguridad: el albarán queda en REVISAR con la lectura del OCR como pista y sin texto (lo escribe la persona).
test("anotación a mano con número: REVISAR, sin texto hasta que la persona lo escriba", ()=>{
 const o=C.orden(doc({resultado:{manuscritos:{obra:ok("PRY09999"),anotaciones:[{pagina:1,lectura:"cis fic 202611234"}]}}}),catalogo);
 assert.equal(o.estado,"REVISAR");
 assert.match(o.motivos.join(),/Anotación escrita a mano para el título \(«cis fic 202611234» según el OCR\)/);
 assert.deepEqual(o.plan.anotacion,{pendiente:true,lectura:"cis fic 202611234",texto:null});
 assert.equal(C.orden(doc(),catalogo).plan.anotacion,undefined);
});
// Usuario (2026-11-17): siempre es el mismo texto y el número no se puede comprobar: con el texto fijo (privado, de la
// aplicación), va solo al título sin número y el albarán no se para por eso.
test("anotación a mano con texto fijo: al título sin número, sin parar el albarán", ()=>{
 const o=C.orden(doc({resultado:{manuscritos:{obra:ok("PRY09999"),anotaciones:[{pagina:1,lectura:"cis fic 202611234"}]}}}),catalogo,{anotacionTexto:"  XX  FICTICIO "});
 assert.equal(o.estado,"PENDIENTE",o.motivos.join("; "));
 assert.deepEqual(o.plan.anotacion,{pendiente:false,automatica:true,lectura:"cis fic 202611234",texto:"XX FICTICIO"});
 assert.equal(C.orden(doc(),catalogo,{anotacionTexto:"XX FICTICIO"}).plan.anotacion,undefined);
 // Pegada a la descripción de una línea por el OCR (fallo real 2026-11-17): cuenta igual; sin el texto fijo, no.
 const pegada=doc({resultado:{lineas:[{pagina:1,referencia:ok("REF-001"),descripcion:ok("TUBO FICTICIO 20MM Cs Fic 2026/9999"),cantidad:ok(4),unidad:ok("UD"),
  precio:ok(2.5),descuento:{porcentajes:[10]},importe:ok(9)}]}});
 assert.equal(C.orden(pegada,catalogo,{anotacionTexto:"XX FICTICIO"}).plan.anotacion?.texto,"XX FICTICIO");
 assert.equal(C.orden(pegada,catalogo).plan.anotacion,undefined);
});
// IVA impreso (usuario, 2026-11-17: «si sale un IVA de 3,47 € de un neto de 16,52 €, se deduce que es el 21»). Cifras ficticias.
test("IVA del papel: porcentaje impreso o cuota ÷ base; si no casan, ninguno", ()=>{
 const ok2=v=>({valor:v,estado:"OK",confianza:0.99});
 assert.equal(C.ivaImpreso({base_imponible:ok2(16.52),cuota_iva:ok2(3.47)}).tipo,21);
 assert.equal(C.ivaImpreso({base_imponible:ok2(140.33),cuota_iva:ok2(14.03)}).tipo,10);
 assert.equal(C.ivaImpreso({base_imponible:ok2(100),cuota_iva:ok2(4)}).tipo,4);
 assert.equal(C.ivaImpreso({iva_porcentaje:ok2(10)}).tipo,10);
 assert.equal(C.ivaImpreso({base_imponible:ok2(100),cuota_iva:ok2(21),iva_porcentaje:ok2(10)}),null,"no casan");
 assert.equal(C.ivaImpreso({base_imponible:ok2(100),cuota_iva:{valor:21,estado:"REVISAR",confianza:0.5}}),null,"cuota sin aceptar");
 assert.equal(C.ivaImpreso({base_imponible:ok2(100),cuota_iva:ok2(7)}),null,"ningún tipo");
 const o=C.orden(doc({resultado:{totales:{total:ok(10.89),base_imponible:ok(9),cuota_iva:ok(1.89)}}}),catalogo);
 assert.equal(o.plan.iva.tipo,21);
});
// Descripciones (fallo real 2026-11-17: el usuario corregía a mano «Ø» y «º» mal leídos). Datos ficticios.
test("descripción: signos mal leídos corregidos con reglas estrechas; nombre de STEL del artículo identificado", ()=>{
 assert.equal(C.corregirSignos("REDUCCION PRENSAR V42X35 INOX AISI 316"),"REDUCCION PRENSAR Ø42X35 INOX AISI 316");
 assert.equal(C.corregirSignos("CODO 45% HH PRENSAR (M54 INOX AISI 316"),"CODO 45º HH PRENSAR Ø54 INOX AISI 316");
 assert.equal(C.corregirSignos("CODO 45 HH PRENSAR 822 INOX AISI 316"),"CODO 45 HH PRENSAR Ø22 INOX AISI 316");
 for(const x of ["DESCUENTO 50% PINTURA","TUBO PRENSAR 54 COBRE","MANGUITO HH PRENSAR Ø76,1 INOX AISI 316","CODO 90 PVC 110"])assert.equal(C.corregirSignos(x),x);
 assert.equal(C.descripcionDeStel("TUBO FICTICIO 2OMM","TUBO FICTICIO 20MM"),"TUBO FICTICIO 20MM");
 assert.equal(C.descripcionDeStel("TUBO FICTICIO 20MM","CODO DISTINTO DE OTRA COSA"),null);
 // En la orden: con el artículo existente, su nombre de STEL; lo leído se conserva.
 const o=C.orden(doc({resultado:{lineas:[{pagina:1,referencia:ok("REF-001"),descripcion:ok("TUBO FICTIC1O 20MM"),cantidad:ok(4),unidad:ok("UD"),
  precio:ok(2.5),descuento:{porcentajes:[10]},importe:ok(9)}]}}),catalogo);
 assert.equal(o.plan.lineas[0].descripcion,"TUBO FICTICIO 20MM");assert.equal(o.plan.lineas[0].descripcion_leida,"TUBO FICTIC1O 20MM");
 assert.equal(C.orden(doc(),catalogo).plan.lineas[0].descripcion_leida,undefined);
});
// Línea partida y código con la descripción pegada (fallo real 2026-11-17, Fino). Datos ficticios.
test("arreglarLineas: renglón sin cifras unido solo si el total cuadra sin él; código separado de su descripción", ()=>{
 const v=x=>({literal:String(x),valor:x,estado:"OK"}),vac={literal:"",valor:null,estado:"VACIO"};
 const lin=()=>[{referencia:v("999760 Placa.larga.blanca"),descripcion:vac,cantidad:v(1),precio:v(12.5),importe:v(11.25)},
  {referencia:v("9999XXX"),descripcion:vac,cantidad:vac,precio:vac,importe:vac}];
 const a=C.arreglarLineas(lin(),{total:{valor:13.61,estado:"OK"}});
 assert.equal(a.lineas.length,1);
 assert.equal(a.lineas[0].referencia.valor,"999760");assert.equal(a.lineas[0].descripcion.valor,"Placa.larga.blanca 9999XXX");
 // Sin total aceptado, o si el total no cuadra sin ese renglón, no se une (podría ser un artículo sin cifras leídas).
 assert.equal(C.arreglarLineas(lin(),{total:{valor:13.61,estado:"REVISAR"}}).lineas.length,2);
 assert.equal(C.arreglarLineas(lin(),{total:{valor:30,estado:"OK"}}).lineas.length,2);
 // Una referencia normal con espacio no se toca.
 const b=C.arreglarLineas([{referencia:v("A 9060"),descripcion:vac,cantidad:v(1),precio:v(1),importe:v(1)}],null);
 assert.equal(b.lineas[0].referencia.valor,"A 9060");
});
// Confirmación de pedido leída por el mismo lector (usuario, 2026-11-17). Datos ficticios.
test("confirmación de pedido: tipo PEDIDO, siempre a REVISAR, clave propia y sin buscar albarán de compra", ()=>{
 const o=C.orden(doc(),catalogo,{tipoDocumento:"PEDIDO"});
 assert.equal(o.plan.tipo,"PEDIDO");assert.equal(o.estado,"REVISAR");
 assert.match(o.motivos.join(),/Confirmación de pedido/);
 assert.equal(o.clave,"PEDIDO|9001|123456|2026-10-22");
 assert.equal(o.plan.ya_en_stel,null);
 assert.equal(C.orden(doc(),catalogo).plan.tipo,"ALBARAN");
});
// Subido por un sitio y titulado como lo otro (usuario, 2026-11-17): a revisión con su aviso.
test("clase impresa contraria a por dónde se subió: REVISAR con aviso", ()=>{
 const comoAlbaran=C.orden(doc({resultado:{clase_impresa:"PEDIDO"}}),catalogo);
 assert.equal(comoAlbaran.estado,"REVISAR");assert.match(comoAlbaran.motivos.join(),/parece una confirmación de pedido/);
 assert.match(C.orden(doc({resultado:{clase_impresa:"ALBARAN"}}),catalogo,{tipoDocumento:"PEDIDO"}).motivos.join(),/parece un albarán/);
 assert.equal(C.orden(doc({resultado:{clase_impresa:"ALBARAN"}}),catalogo).estado,"PENDIENTE");
});
// Albarán sin PAP que encaja con un pedido abierto (usuario, 2026-11-17): aviso, nunca asociación sola. Datos ficticios.
test("pedido abierto con todos los artículos del albarán: aviso y pedidos posibles; si falta alguno, nada", ()=>{
 const abiertos=[{codigo:"PAP09999",cuenta:9001,referencias:["REF-001","OTRA-9"]},{codigo:"PAP09998",cuenta:7777,referencias:["REF-001"]}];
 const o=C.orden(doc(),catalogo,{pedidosAbiertos:abiertos});
 assert.equal(o.estado,"REVISAR");assert.deepEqual(o.plan.pedidos_posibles,["PAP09999"]);assert.equal(o.plan.pedido,null);
 assert.match(o.motivos.join(),/Puede ser del pedido PAP09999/);
 assert.equal(C.orden(doc(),catalogo,{pedidosAbiertos:[{codigo:"PAP09997",cuenta:9001,referencias:["OTRA-9"]}]}).plan.pedidos_posibles,undefined);
 assert.equal(C.orden(doc(),catalogo).estado,"PENDIENTE");
});
// Usuario 2026-11-18 («no cogió el PRY»): en una confirmación de pedido, la obra leída a mano sin segunda prueba va propuesta
// (con su aviso) para que la persona la compruebe; en un albarán, no. Datos ficticios.
test("pedido: obra escrita a mano sin validar, propuesta en la revisión con aviso; albarán: no", ()=>{
 const sinValidar={manuscritos:{obra:{valor:"PRY09999",estado:"REVISAR",confianza:0.8}}};
 const o=C.orden(doc({resultado:sinValidar}),catalogo,{tipoDocumento:"PEDIDO"});
 assert.equal(o.plan.obra.codigo,"PRY09999");assert.equal(o.plan.obra.stel_id,555);assert.equal(o.estado,"REVISAR");
 assert.match(o.motivos.join(),/PRY09999 leída a mano sin otra prueba/);
 assert.equal(C.orden(doc({resultado:sinValidar}),catalogo).plan.obra,null);
 // Sin el formato o con poca confianza, nada.
 assert.equal(C.orden(doc({resultado:{manuscritos:{obra:{valor:"PRY0999",estado:"REVISAR",confianza:0.8}}}}),catalogo,{tipoDocumento:"PEDIDO"}).plan.obra,null);
 assert.equal(C.orden(doc({resultado:{manuscritos:{obra:{valor:"PRY09999",estado:"AMBIGUO",confianza:0}}}}),catalogo,{tipoDocumento:"PEDIDO"}).plan.obra,null);
});
// Fallo real 2026-11-18: «Ø» de un diámetro de conducto leído M, G o Q. Textos ficticios.
test("corregirSignos: «Ø» de conducto leído M/G/Q antes de un diámetro de 3 cifras; una métrica o un código, no", ()=>{
 assert.equal(C.corregirSignos("REGULADOR FICTICIO M100 1 JUNTA"),"REGULADOR FICTICIO Ø100 1 JUNTA");
 assert.equal(C.corregirSignos("REGULADOR FICTICIO G150 1 JUNTA"),"REGULADOR FICTICIO Ø150 1 JUNTA");
 assert.equal(C.corregirSignos("BOCA FICTICIA LACADA G-100mm"),"BOCA FICTICIA LACADA Ø100mm");
 for(const t of ["TORNILLO M10 X 40","VARILLA M12","M100 PRIMERA PALABRA","TUBO FICTICIO M123","PIEZA G1000"])assert.equal(C.corregirSignos(t),t);
});
// Correcciones reales del usuario (2026-11-18) de «Ø» y «º» que el lector no hacía; textos de descripción genéricos, sin códigos reales.
test("corregirSignos: «Ø» por el diámetro del código, «MM»/«WM» ante prensar, «Y» en terminales; «º» en codos", ()=>{
 assert.equal(C.corregirSignos("REG. CAUDAL CONSTANTE PLASTICO XX 2150 1 JUNTA","XX150"),"REG. CAUDAL CONSTANTE PLASTICO XX Ø150 1 JUNTA");
 assert.equal(C.corregirSignos("REG. CAUDAL CONSTANTE PLASTICO XX 2150 1 JUNTA","XX150 CAUDAL"),"REG. CAUDAL CONSTANTE PLASTICO XX Ø150 1 JUNTA");
 // Sin el diámetro en el código, o con un código solo de cifras, nada.
 assert.equal(C.corregirSignos("REGULADOR XX 2150 1 JUNTA","XX100"),"REGULADOR XX 2150 1 JUNTA");
 assert.equal(C.corregirSignos("TUBO 2150 MM","1300000150"),"TUBO 2150 MM");
 assert.equal(C.corregirSignos("CODO 45% M-H PRENSAR WM54 INOX AISI 316"),"CODO 45º M-H PRENSAR Ø54 INOX AISI 316");
 assert.equal(C.corregirSignos("CODO 45% HH PRENSAR MM54 INOX AISI 316"),"CODO 45º HH PRENSAR Ø54 INOX AISI 316");
 assert.equal(C.corregirSignos("CODO 90% HH PRENSAR M54 INOX AISI 316"),"CODO 90º HH PRENSAR Ø54 INOX AISI 316");
 assert.equal(C.corregirSignos("PS CODO 90% IGUAL 20 MULTIPRESS"),"PS CODO 90º IGUAL 20 MULTIPRESS");
 assert.equal(C.corregirSignos("TERMINAL TUBULAR COBRE 35MM2 Y M-10"),"TERMINAL TUBULAR COBRE 35MM2 Ø M-10");
 assert.equal(C.corregirSignos("CABLE 35MM2 Y M-10"),"CABLE 35MM2 Y M-10");
});
// Fallo real 2026-11-18: PAP impreso leído con poca confianza; se ofrece en la revisión («Es del pedido …»). Ficticio.
test("PAP leído y sin validar: se ofrece como pedido posible con su aviso; nunca se pone solo", ()=>{
 const o=C.orden(doc({resultado:{manuscritos:{obra:{valor:"PRY09999",estado:"OK",confianza:0.95},pedido:{valor:"PAP09999",estado:"REVISAR",literal:"PAP09999",resolucion:{alternativas:["PAP09999"]}}}}}),catalogo);
 assert.equal(o.plan.pedido,null);assert.deepEqual(o.plan.pedidos_posibles,["PAP09999"]);assert.equal(o.estado,"REVISAR");
 assert.match(o.motivos.join(),/PAP09999 sin confirmar/);
});
