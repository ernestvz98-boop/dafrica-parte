"use strict";
/*
 * DAFRICA · Fase 2 (aprobada por el usuario el 2026-10-26): de cada albarán leído, la ORDEN para crear
 * su albarán de compra en STEL. La web la guarda en la cola privada de Supabase (`stel_cola`) con el PDF;
 * el robot (robot-stel/procesar-cola.js) la ejecuta. Aquí no se escribe nada: solo se decide.
 *
 * Decisiones del usuario (2026-10-26):
 *  - Automático solo si el lector lo da por bueno (AUTO_OK) y todo lo necesario para STEL está
 *    resuelto con evidencia: proveedor (cuenta de STEL), número, fecha, obra con su proyecto de STEL y
 *    cada artículo. Lo demás queda en REVISAR con sus motivos (nunca se adivina).
 *  - Sin precio en el albarán: con pedido (PAP), el del pedido (lo pone el robot al leerlo); sin
 *    pedido, 0,00 con el aviso «PRECIO PENDIENTE». Nunca un precio estimado.
 *  - Artículo que no existe en STEL: se crea solo si el catálogo está completo y no hay ninguno
 *    parecido (articulos.js, comprobación anti-duplicados); si hay candidatos, REVISAR.
 *  - Si el lector encontró ya el albarán en STEL (ABP), no se crea otro: YA_EXISTE.
 *
 * Prueba real del 2026-10-28 (40 páginas): ningún documento puede desaparecer de la cola. Un albarán sin
 * proveedor de STEL, número o fecha también se guarda, en REVISAR, con una clave provisional
 * (`claveProvisional`, por la huella de su PDF individual) y el motivo; un abono o rectificativo nunca
 * queda PENDIENTE (el robot no los crea); y lo que no se pudo comprobar (catálogo o búsqueda de STEL sin
 * respuesta) queda anotado en `comprobaciones_pendientes` para repetir solo esa comprobación.
 */
(function(root,factory){
 const api=factory(root);
 if(typeof module==="object"&&module.exports)module.exports=api;
 else{root.DafricaAlbaranes=root.DafricaAlbaranes||{};root.DafricaAlbaranes.colaStel=api;}
})(typeof globalThis!=="undefined"?globalThis:this,function(root){
const M=n=>typeof module==="object"&&module.exports?require("./"+({articulos:"articulos.js"}[n])):root.DafricaAlbaranes[n];
const VERSION=1;
const aceptado=c=>c?.estado==="OK"&&(c.confianza??1)>=0.9;
/*
 * IVA impreso en el papel (usuario, 2026-11-17: «si sale un IVA de 3,47 € de un neto de 16,52 €, se deduce que es el 21»): el
 * porcentaje impreso, o el que da cuota ÷ base (21, 10, 5 o 4 %, el único con base × tipo = cuota a un céntimo). Solo con
 * valores que el lector da por buenos. {tipo, base, cuota, evidencia} o null. El robot lo pone en las líneas de STEL.
 */
/*
 * Nombre de STEL del artículo identificado si se parece a la descripción leída (distancia de edición sobre letras, cifras y
 * espacios, en mayúsculas sin tildes, de como mucho el 20 % de la más larga, y al menos 6 caracteres): el mismo texto con los
 * signos que el OCR lee mal. Si no se parece (otra forma de nombrarlo), null y se queda lo leído.
 */
/*
 * Signos que el OCR confunde en las descripciones (fallo real 2026-11-17, Saltoki, corregidos a mano por el usuario): solo con
 * reglas estrechas que no cambian el material, y nunca cantidades ni precios:
 *  - «º» de un ángulo leído «%» en codos, curvas y lamas: «CODO 90%» → «CODO 90º» (ángulos de accesorios: 15, 30, 45, 60, 67,
 *    87, 88, 90, 135, 180).
 *  - «Ø» de un diámetro de prensar leído «M», «V», «(M», «8» o perdido, en accesorios de prensar de inoxidable: «PRENSAR M54» →
 *    «PRENSAR Ø54»; solo si el diámetro es de la serie de tubo de prensar (12 a 108) y, con el «8» delante, si sin él lo es y con
 *    él no.
 */
const ANGULOS=new Set([15,30,45,60,67,87,88,90,135,180]),DIAM_PRENSAR=new Set([12,15,18,22,28,35,42,54,64,76,88,108]),
 DIAM_CONDUCTO=new Set([100,110,125,140,150,160,180,200,225,250,280,300,315,355,400,450,500,560,600,630,710,800]);
function corregirSignos(desc,ref){
 let s=String(desc??"");
 if(!s)return s;
 // El diámetro del propio código del artículo (fallo real 2026-11-18: código «…150» y descripción «… 2150 …», el «Ø» leído «2»): un
 // signo confundible con «Ø» (2, 8, M, G, Q, V, W, Y) pegado a las cifras finales del código es el «Ø» de ese diámetro.
 const dRef=(String(ref??"").trim().split(/\s+/)[0]||"").toUpperCase().match(/[A-Z](\d{2,3})$/)?.[1];
 if(dRef&&(DIAM_CONDUCTO.has(Number(dRef))||DIAM_PRENSAR.has(Number(dRef))))
  s=s.replace(new RegExp("(\\S\\s+)[28MGQVWY]-?"+dRef+"(?=\\s*MM\\b|\\s|$)","gi"),(t,antes)=>antes+"Ø"+dRef);
 // Terminal de cobre «…MM2 Y M-10» (real, corregido a mano por el usuario: «… MM2 Ø M-10»): el «Ø» de la métrica leído «Y».
 if(/\bTERMINAL\b/i.test(s))s=s.replace(/(\d\s?MM2\s+)Y(\s+M-?\d{1,2}\b)/gi,"$1Ø$2");
 if(/\b(CODO|CURVA|CODOS|CURVAS|LAMAS)\b/i.test(s))s=s.replace(/\b(\d{2,3})\s?%/g,(t,n)=>ANGULOS.has(Number(n))?n+"º":t);
 // «Ø» de un diámetro de conducto leído M, G o Q (fallo real 2026-11-18: «XX M100», «XX G100», «LACADA G-100mm», corregidos a
 // mano por el usuario): solo tras otra palabra y con un diámetro normalizado de 3 cifras; no hay roscas métricas de M100 en adelante.
 s=s.replace(/(\S\s+)[MGQ]-?(\d{3})(?=\s*MM\b|\s|$)/gi,(t,antes,d)=>DIAM_CONDUCTO.has(Number(d))?antes+"Ø"+d:t);
 if(/\bPRENSAR\b/i.test(s)&&/\bINOX\b/i.test(s))
  s=s.replace(/\bPRENSAR\s+\(?(MM|WM|[MVW]|8)?(\d{2,3})((?:,\d)?(?:X\d{2,3})?)(?=\s|$)/gi,(t,pre,d,resto)=>{
   let n=Number(d);
   if(pre==="8"){if(DIAM_PRENSAR.has(Number("8"+d))||!DIAM_PRENSAR.has(n))return t;}
   else if(!pre&&String(d).length===3&&d[0]==="8"&&!DIAM_PRENSAR.has(n)&&DIAM_PRENSAR.has(Number(d.slice(1)))){n=Number(d.slice(1));return "PRENSAR Ø"+d.slice(1)+resto;}
   if(!DIAM_PRENSAR.has(n))return t;
   return "PRENSAR Ø"+d+resto;
  });
 return s;
}
/*
 * Líneas del lector arregladas antes de la orden (fallo real 2026-11-17: «999760 Matricul.larg.blanc.Europ» como código, sin
 * descripción, y el final «9999XXX» en un renglón propio tomado como otra línea):
 *  - un renglón SIN cantidad, precio ni importe se une a la descripción de la línea de arriba solo si el total del papel (aceptado)
 *    cuadra con los importes de las demás líneas (sin IVA o con 21, 10, 5 o 4 %): prueba de que no es un artículo;
 *  - un código seguido de texto con la descripción vacía: el código (3 a 20 letras y cifras, con alguna cifra) a la referencia y el
 *    texto a la descripción.
 * Devuelve las líneas (copias) y las notas de lo hecho.
 */
function arreglarLineas(lineas,totales){
 const L=(lineas||[]).map(l=>({...l})),notas=[];
 const vacia=c=>!String(c?.literal??"").trim()&&!Number.isFinite(c?.valor);
 const tot=Number.isFinite(totales?.total?.valor)&&["OK","VERIFICADO"].includes(totales.total.estado)?totales.total.valor:null;
 const poner=(c,t)=>({...(c||{}),literal:t,valor:t,estado:c?.estado==="VACIO"||!c?.estado?"OK":c.estado});
 for(let i=L.length-1;i>0;i--){
  const l=L[i];
  if(!(vacia(l.cantidad)&&vacia(l.precio)&&vacia(l.importe))||tot==null)continue;
  const otras=L.filter((_,j)=>j!==i),imp=otras.map(x=>x.importe?.valor);
  if(!imp.every(Number.isFinite))continue;
  const suma=Math.round(imp.reduce((a,b)=>a+b,0)*100)/100;
  if(![0,21,10,5,4].some(t=>Math.abs(Math.round(suma*(100+t))/100-tot)<=0.02))continue;
  const extra=[texto(l.referencia),texto(l.descripcion)].filter(Boolean).join(" ").trim();
  const p=L[i-1];
  if(extra){
   if(texto(p.descripcion))p.descripcion=poner(p.descripcion,texto(p.descripcion)+" "+extra);
   else p.referencia=poner(p.referencia,texto(p.referencia)+" "+extra);
  }
  L.splice(i,1);notas.push("Renglón «"+extra+"» unido a la línea "+i+": sin cifras y el total cuadra sin él");
 }
 for(const [i,l] of L.entries()){
  if(texto(l.descripcion))continue;
  const m=texto(l.referencia).match(/^([A-Za-z0-9][A-Za-z0-9.\-\/]{2,19})\s+(.*[A-Za-zÁÉÍÓÚÑáéíóúñ].*)$/);
  if(!m||!/\d/.test(m[1]))continue;
  L[i]={...l,referencia:poner(l.referencia,m[1]),descripcion:poner(l.descripcion,m[2].trim())};
  notas.push("Línea "+(i+1)+": código «"+m[1]+"» separado de su descripción");
 }
 return {lineas:L,notas};
}
function descripcionDeStel(leida,stel){
 const n=t=>String(t??"").normalize("NFD").replace(/[̀-ͯ]/g,"").toUpperCase().replace(/[^A-Z0-9 ]+/g," ").replace(/\s+/g," ").trim();
 const a=n(leida),b=n(stel),s=String(stel??"").replace(/\s+/g," ").trim();
 if(!s||b.length<6)return null;
 if(!a)return s;
 if(a===b)return s;
 const m=a.length,k=b.length;let prev=Array.from({length:k+1},(_,j)=>j);
 for(let i=1;i<=m;i++){const cur=[i];for(let j=1;j<=k;j++)cur[j]=Math.min(prev[j]+1,cur[j-1]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));prev=cur;}
 return prev[k]<=Math.floor(0.2*Math.max(m,k))?s:null;
}
const leido=c=>Number.isFinite(c?.valor)&&["OK","VERIFICADO"].includes(c.estado)&&(c.confianza??1)>=0.9;
function ivaImpreso(T){
 if(!T)return null;
 const b=leido(T.base_imponible)?T.base_imponible.valor:null,q=leido(T.cuota_iva)?T.cuota_iva.valor:null,pct=leido(T.iva_porcentaje)?T.iva_porcentaje.valor:null;
 const porCuota=b>0&&q!=null?[21,10,5,4].filter(x=>Math.abs(Math.round(b*x)/100-q)<=0.011):[];
 if(pct!=null&&[21,10,5,4].includes(pct)){
  if(b>0&&q!=null&&!porCuota.includes(pct))return null;
  return {tipo:pct,base:b,cuota:q,evidencia:"IVA impreso "+pct+" %"};
 }
 if(porCuota.length===1)return {tipo:porCuota[0],base:b,cuota:q,evidencia:"cuota "+q+" ÷ base "+b};
 return null;
}
const canon=t=>String(t??"").toUpperCase().replace(/[^A-Z0-9]/g,"");
const texto=c=>String(c?.valor??c?.literal??"").trim();

// «2026-10-22» → «22/10/2026» (formato del campo de fecha de STEL).
function fechaStel(iso){
 const m=String(iso||"").match(/^(\d{4})-(\d{2})-(\d{2})$/);
 return m?m[3]+"/"+m[2]+"/"+m[1]:null;
}

// Distancia de edición (insertar, borrar o cambiar un carácter).
function distancia(a,b){
 let prev=Array.from({length:b.length+1},(_,j)=>j);
 for(let i=1;i<=a.length;i++){
  const fila=[i];
  for(let j=1;j<=b.length;j++)fila[j]=Math.min(fila[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));
  prev=fila;
 }
 return prev[b.length];
}
const palabras=t=>String(t||"").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g,"").split(/[^A-Z0-9]+/).filter(w=>w.length>=2);

/*
 * Antes de un ALTA automática, más estricto que articulos.js: una referencia leída con un carácter de
 * más, de menos o cambiado (el OCR: «REF-0001» por «REF-001») o con las mismas cifras, o una descripción
 * cuyas palabras están todas en las de otro artículo, se parece demasiado a uno existente: REVISAR.
 */
// ¿Alguno de estos artículos tiene la misma descripción (todas las palabras de una, al menos 3, en la otra)?
function mismoNombreQue(desc,articulos){
 const pd=new Set(palabras(desc));
 return (articulos||[]).some(a=>{const pa=new Set(palabras(a.descripcion));const [menor,mayor]=pd.size<=pa.size?[pd,pa]:[pa,pd];
  return menor.size>=3&&[...menor].every(w=>mayor.has(w))||[...pd].join(" ")===[...pa].join(" ");});
}
function parecidosParaAlta(ref,desc,catalogo){
 const r=canon(ref),cifras=r.replace(/\D/g,""),pd=new Set(palabras(desc));
 return (catalogo||[]).filter(a=>{
  const ra=canon(a.referencia);
  if(r.length>=4&&ra.length>=4&&distancia(r,ra)<=1)return true;
  if(cifras.length>=5&&ra.replace(/\D/g,"")===cifras)return true;
  const pa=new Set(palabras(a.descripcion));
  const [menor,mayor]=pd.size<=pa.size?[pd,pa]:[pa,pd];
  return menor.size>=3&&[...menor].every(w=>mayor.has(w));
 }).map(a=>a.id).slice(0,10);
}

// Clave única del albarán en la cola: cuenta de STEL + número del proveedor + fecha.
function clave(r){
 const cuenta=r?.proveedor?.account_id,num=canon(texto(r?.numero)),f=texto(r?.fecha);
 return cuenta!=null&&num&&f?String(cuenta)+"|"+num+"|"+f:null;
}

/*
 * doc: {archivo, paginas, estado_documento, resultado} de la lectura.
 * catalogo: {articulos:[{id,referencia,descripcion}], articulos_completo, proveedores:[{id,nombre}],
 *            obras:[{id,codigo,nombre}]} (el de la lectura; sin precios).
 * opciones.busquedaStelCompleta: la búsqueda de albaranes de compra de STEL de esta lectura terminó
 *   completa (sin ella, la falta del ABP escrito a mano sigue impidiendo el automático).
 * Devuelve {clave, estado: PENDIENTE|REVISAR|YA_EXISTE, motivos:[…], plan}.
 */
// En la Fase 2 el ABP lo crea el robot: un albarán nuevo nunca lo trae escrito. Si es lo ÚNICO que
// falta (documento fiable, confianza ≥ 0,9) y la búsqueda del número del proveedor en STEL fue completa
// y no lo encontró, no impide el automático (el robot vuelve a buscar el número antes de crear).
const SOLO_FALTA_ABP=/^Código manuscrito no detectado: STEL \(ABP\); comprueba el papel$/;
function soloFaltaAbp(doc,opciones){
 const r=doc?.resultado;
 return doc?.estado_documento==="REVISAR"&&!!opciones?.busquedaStelCompleta&&r?.fiable===true&&(r.confianza??0)>=0.9&&
  (r.incidencias||[]).length>0&&(r.incidencias||[]).every(i=>SOLO_FALTA_ABP.test(String(i)));
}
// Sin obra que relacionar (decisión del usuario, 2026-11-11: «hay casos que no está la obra y simplemente no se puede relacionar,
// no significa un error»): si el lector leyó los manuscritos y ninguna anotación da un código de obra del catálogo (ni con otro
// formato: entonces queda su literal), ni hay obra impresa ni nombre escrito, el albarán va sin obra (plan.sin_obra) y sin
// proyecto. Banco del 2026-11-11 (55 albaranes reales): 4 sin obra de verdad, 1 con un código que no está en el catálogo y 1 con
// la obra descrita a mano sin código; los que tienen código del catálogo, nunca. Con la lectura de manuscritos fallida, o con
// algo leído y sin validar, sigue en REVISAR. La falta del ABP escrito sigue la regla de soloFaltaAbp (búsqueda en STEL completa).
const SOLO_FALTA_OBRA=/^Código manuscrito no detectado: obra \(PRY\)(, STEL \(ABP\))?; comprueba el papel$/;
function sinObraLeida(doc,opciones){
 const r=doc?.resultado,m=r?.manuscritos;
 if(!m||m.sin_comprobar||opciones?.visionFallida||(m.obraImpresa||[]).length||(m.obraEscrita||[]).length)return false;
 if(m.obra?.estado!=="VACIO"||m.obra.literal)return false;
 if(doc.estado_documento==="AUTO_OK")return true;
 const inc=(r.incidencias||[]).map(String);
 return doc.estado_documento==="REVISAR"&&r.fiable===true&&(r.confianza??0)>=0.9&&inc.length>0&&
  inc.every(i=>SOLO_FALTA_OBRA.test(i)||SOLO_FALTA_ABP.test(i))&&
  (!inc.some(i=>/STEL \(ABP\)/.test(i))||!!opciones?.busquedaStelCompleta);
}
// Clave de un documento que no se pudo identificar (sin cuenta de STEL, número o fecha): la huella de su
// PDF individual. Nunca coincide con la de un albarán identificado; el robot no toma nada en REVISAR.
const claveProvisional=sha=>/^[0-9a-f]{64}$/.test(String(sha||""))?"SIN_IDENTIFICAR|"+sha:null;

// Lo que no se pudo comprobar en esta lectura (para repetir solo esa comprobación más tarde).
function comprobacionesPendientes(opciones){
 const p=[];
 if(opciones?.catalogoIncompleto)p.push("catalogo_stel");
 if(opciones?.busquedaStelIncompleta)p.push("albaranes_stel");
 if(opciones?.visionFallida)p.push("vision_manuscritos");
 return p;
}

// Plan mínimo de un documento sin lectura (error de la página): se guarda igual, en REVISAR.
function planSinLectura(doc){
 return {version:VERSION,archivo:doc?.archivo||null,paginas:Array.isArray(doc?.paginas)?doc.paginas.slice():[],tipo:null,
  proveedor:{account_id:null,nombre_stel:null,nombre_leido:null,nif_leido:null},numero:null,fecha:null,obra:null,pedido:null,ya_en_stel:null,lineas:[],total:null,
  aviso_precio:null,error_lectura:String(doc?.error||"Documento sin lectura").slice(0,300)};
}

function orden(doc,catalogo,opciones={}){
 const r=doc?.resultado,motivos=[];
 if(!r)return {clave:null,estado:"REVISAR",motivos:["Documento sin lectura"+(doc?.error?": "+String(doc.error).slice(0,160):"")],plan:planSinLectura(doc)};
 const cat=catalogo||{};
 const sinObra=sinObraLeida(doc,opciones);
 if(doc.estado_documento!=="AUTO_OK"&&!soloFaltaAbp(doc,opciones)&&!sinObra)motivos.push("El lector no lo da por bueno ("+(doc.estado_documento||"sin estado")+")");
 // Abono o rectificativo (impreso o con cantidades negativas): nunca automático.
 // Confirmación de pedido del proveedor (usuario, 2026-11-17: «que haga el mismo proceso que los albaranes»): la lee el mismo
 // lector (opciones.tipoDocumento = «PEDIDO»), va siempre a REVISAR (la confirma la persona) y el robot crea el PAP en STEL.
 const esPedido=opciones.tipoDocumento==="PEDIDO";
 const tipo=esPedido?"PEDIDO":r.tipo_documento?.valor==="ABONO"?"ABONO":"ALBARAN";
 if(esPedido)motivos.push("Confirmación de pedido del proveedor: revísala y confírmala; el robot crea el pedido (PAP) en STEL");
 // Subido por un sitio y titulado como lo otro (extraer: clase_impresa por el título impreso): a revisión, nunca se crea solo.
 if(esPedido&&r.clase_impresa==="ALBARAN")motivos.push("El documento lleva impreso «ALBARÁN»: parece un albarán, no una confirmación de pedido (súbelo en «Subir albaranes»)");
 if(!esPedido&&r.clase_impresa==="PEDIDO")motivos.push("El documento lleva impreso un título de pedido u oferta («PEDIDO», «CONFIRMACIÓN», «OFERTA», «PRESUPUESTO»): parece una confirmación de pedido, no un albarán (súbela en Pedidos → «Subir confirmaciones»)");
 if(tipo==="ABONO")motivos.push("Abono o rectificativo: no se crea automáticamente en STEL ("+(r.tipo_documento?.evidencia||"cantidades negativas")+")");
 // Proveedor: la cuenta de STEL verificada por el lector.
 const p=r.proveedor||{},cuenta=p.account_id??null;
 const provStel=cuenta!=null?(cat.proveedores||[]).find(x=>String(x.id)===String(cuenta)):null;
 if(cuenta==null||p.estado!=="OK")motivos.push("Proveedor sin cuenta de STEL verificada");
 else if(!provStel)motivos.push("La cuenta del proveedor no está en el catálogo de STEL leído");
 // Número y fecha.
 const numero=texto(r.numero),fecha=fechaStel(texto(r.fecha));
 if(!aceptado(r.numero)||!numero)motivos.push("Número del albarán sin confirmar");
 if(!aceptado(r.fecha)||!fecha)motivos.push("Fecha sin confirmar");
 // Obra: el código validado y su proyecto en STEL (código único en el catálogo de obras).
 const ob=r.manuscritos?.obra;
 // Confirmación de pedido (siempre la confirma una persona; usuario 2026-11-18: «no cogió el PRY»): la obra escrita a mano y leída
 // con el formato y confianza ≥ 0,9, pero sin segunda prueba, va PROPUESTA en la revisión (nunca aceptada sola) con su aviso.
 const propuesta=esPedido&&ob?.estado==="REVISAR"&&/^PRY(MP)?\d{5}$/.test(canon(ob.valor))&&Number(ob.confianza)>=0.8?canon(ob.valor):"";
 const codObra=ob?.estado==="OK"?canon(ob.valor):propuesta;
 if(propuesta)motivos.push("Obra "+propuesta+" leída a mano sin otra prueba: compruébala antes de confirmar");
 let obra=null;
 // Obra leída a mano y sin validar (usuario, 2026-11-26: «proponerla en Revisar»; en la cola real la persona tenía que buscarla desde
 // cero en ~40 % de los albaranes): sus lecturas con el formato van PROPUESTAS en la revisión («Es la obra …», como el pedido), nunca
 // aceptadas solas; primero las de la lista de obras (con su nombre), como mucho 3. El robot no las usa: sin obra elegida, no se crea.
 const obrasPosibles=codObra||!ob?[]:(()=>{
  const leidas=[...new Set([ob.valor,...(ob.resolucion?.alternativas||[])].map(x=>canon(x)).filter(x=>/^PRY(MP)?\d{5}$/.test(x)))];
  const deLista=c=>{const o=(cat.obras||[]).filter(x=>canon(x.codigo)===c);return o.length===1?o[0]:null;};
  return [...leidas.filter(c=>deLista(c)),...leidas.filter(c=>!deLista(c))].slice(0,3)
   .map(c=>({codigo:c,nombre:deLista(c)?String(deLista(c).nombre||"").slice(0,150)||null:null,
    stel_id:deLista(c)&&cat.obras_completo?deLista(c).id??null:null,en_lista:!!deLista(c)}));
 })();
 if(!codObra){if(!sinObra)motivos.push("Obra (PRY) sin validar"+(obrasPosibles.length?": puede ser "+obrasPosibles.map(x=>x.codigo).join(" o ")+" (compruébalo en el papel)":""));}
 else if(!cat.obras_completo){
  // Sin la lista de proyectos de STEL en esta lectura: el robot elige en STEL el proyecto cuyo nombre
  // termina en «(código)», solo si es uno (o se para).
  obra={codigo:codObra,stel_id:null,nombre:null};
 }else{
  const cands=(cat.obras||[]).filter(o=>canon(o.codigo)===codObra);
  if(cands.length!==1)motivos.push(cands.length?"Obra "+codObra+" repetida en STEL":"Obra "+codObra+" no encontrada en los proyectos de STEL");
  else obra={codigo:codObra,stel_id:cands[0].id,nombre:String(cands[0].nombre||"").slice(0,150)};
 }
 // Pedido a proveedor: solo validado (uno leído y sin validar ya impide AUTO_OK).
 const pe=r.manuscritos?.pedido,pedido=pe?.estado==="OK"&&/^PAP\d{5}$/.test(canon(pe.valor))?{codigo:canon(pe.valor)}:null;
 if(pe&&pe.estado!=="OK"&&texto(pe))motivos.push("Pedido (PAP) leído y sin validar");
 // Albarán SIN PAP de un proveedor con un pedido abierto que tiene sus artículos (usuario, 2026-11-17: «una alerta»):
 // nunca se asocia solo; va a revisión con el aviso y la persona decide (plan.pedidos_posibles). opciones.pedidosAbiertos:
 // [{codigo, cuenta, referencias}] (los pedidos que creó el robot, de la cola). Basta con la mitad de sus artículos (fallo real
 // 2026-11-24: un albarán de un pedido se creó sin él; el pedido tenía una referencia mal escrita y exigir todos no avisaba).
 const refsAlb=(r.lineas||[]).map(l=>canon(texto(l.referencia))).filter(Boolean);
 // PAP leído (impreso o a mano) y sin validar (fallo real 2026-11-18): sus lecturas se ofrecen en la revisión («Es del pedido …»).
 const leidosSinValidar=!esPedido&&!pedido&&pe&&pe.estado!=="OK"?[...new Set([pe.valor,...(pe.resolucion?.alternativas||[])].map(x=>canon(x)).filter(x=>/^PAP\d{5}$/.test(x)))].slice(0,5):[];
 const comunes=x=>{const del=new Set((x.referencias||[]).map(canon));return refsAlb.filter(k=>del.has(k)).length;};
 const pedidosPosibles=leidosSinValidar.length?leidosSinValidar:esPedido||pedido||(pe&&texto(pe))||!refsAlb.length?[]:
  (opciones.pedidosAbiertos||[]).filter(x=>String(x.cuenta)===String(r.proveedor?.account_id)&&comunes(x)>=Math.max(1,Math.ceil(refsAlb.length/2))).map(x=>x.codigo).slice(0,5);
 if(leidosSinValidar.length)motivos.push("Lleva el pedido "+leidosSinValidar.join(" o ")+" sin confirmar: si es ese, márcalo en la revisión («Es del pedido …»)");
 else if(pedidosPosibles.length)motivos.push("Puede ser del pedido "+pedidosPosibles.join(" o ")+" (mismo proveedor y artículos del albarán en el pedido): si lo es, márcalo en la revisión");
 // Anotación a mano que no es la obra («CS XXXX 2026/1234», usuario 2026-11-16): va al título, pero el número no se lee con
 // seguridad: la escribe la persona en la revisión (el robot pone `anotacion.texto`; sin texto, nada).
 // Con un texto fijo de la anotación (opciones.anotacionTexto, privado: lo pasa la aplicación; usuario 2026-11-17: «siempre es el
 // mismo; el número no está en ningún sitio»), va solo al título SIN el número (que no se puede comprobar) y no para el albarán.
 // También cuando el OCR la pega a la descripción de una línea (fallo real 2026-11-17: «Perfil T45 … Cs Xx 2026/1234»): solo con
 // la forma «CS palabra año/número», y solo cuenta con el texto fijo de la aplicación.
 const enLineas=(r.lineas||[]).map(l=>texto(l.descripcion)).map(d=>d.match(/(^|[^A-Z0-9])C\s?S\s+[A-Z]{1,8}\.?\s+20[2-3]\d\s?\/\s?\d{3,6}(?![0-9])/i)?.[0]?.trim()).filter(Boolean);
 const anots=[...(r.manuscritos?.anotaciones||[]).map(a=>String(a?.lectura||"").trim()),...(opciones.anotacionTexto?enLineas:[])].filter(Boolean);
 const fijo=String(opciones.anotacionTexto||"").replace(/\s+/g," ").trim().slice(0,40);
 const anotacion=!anots.length?null:fijo?{pendiente:false,automatica:true,lectura:anots.join(" | ").slice(0,120),texto:fijo}
  :{pendiente:true,lectura:anots.join(" | ").slice(0,120),texto:null};
 if(anotacion?.pendiente)motivos.push("Anotación escrita a mano para el título («"+anotacion.lectura+"» según el OCR): escríbela en la revisión");
 // Ya existe en STEL: no se crea otro.
 const abp=esPedido?null:r.albaran_stel?.estado==="OK"?r.albaran_stel:(r.manuscritos?.stel?.estado==="OK"?{referencia:r.manuscritos.stel.valor}:null);
 // Líneas: artículo de STEL (existente, o alta tras la comprobación anti-duplicados).
 const artCat=(cat.articulos||[]).map(a=>({id:a.id,reference:a.referencia,name:a.descripcion}));
 const arreglo=arreglarLineas(r.lineas,r.totales);
 const lineas=arreglo.lineas.map((l,i)=>{
  // Descripción con los signos que el OCR confunde corregidos (corregirSignos; lo leído queda en descripcion_leida).
  const ref=texto(l.referencia),descLeida=texto(l.descripcion),desc=corregirSignos(descLeida,ref),cant=l.cantidad?.valor;
  if(!Number.isFinite(cant)||cant<=0)motivos.push("Línea "+(i+1)+": cantidad sin confirmar");
  const precio=Number.isFinite(l.precio?.valor)?l.precio.valor:null;
  const resId=l.referencia?.resolucion?.item_id??l.descripcion?.resolucion?.item_id??null;
  let articulo;
  // El artículo de STEL con su referencia y nombre: el robot lo busca por ellos en el selector (fallo real 2026-10-29:
  // resuelto por la descripción, la referencia de STEL no era la del papel).
  const deStel=id=>{const a=(cat.articulos||[]).find(x=>String(x.id)===String(id));return a?{referencia:a.referencia??null,nombre:a.descripcion??null}:null;};
  if(resId!=null)articulo={estado:"existente",item_id:resId,via:"lector",stel:deStel(resId)};
  else{
   const a=M("articulos").resolverArticulo({referencia:ref,descripcion:desc,unidad:texto(l.unidad)},{account_id:cuenta},
    {catalogo:artCat,catalogo_completo:!!cat.articulos_completo,mapeos:Array.isArray(cat.mapeos)?cat.mapeos:[]});
   const parecidos=a.estado==="crear"?parecidosParaAlta(ref,desc,cat.articulos):[];
   // Sin referencia en el papel se propone el alta igual (usuario, 2026-11-11: «que no se bloquee, no significa que esté mal»):
   // el robot le pone una referencia propia fija (robot-stel/escritura.js, referenciaGenerada).
   // Código que no está en STEL pero con parecidos (usuario, 2026-11-23: «tengo que arreglar muchas cosas manualmente»; en la
   // revisión siempre se confirmaba igual): con el código y la descripción leídos con fiabilidad (≥ 0,9) lo resuelve el robot con su
   // regla (usuario, 2026-10-30): el código una vez en STEL → ese; ninguna → lo crea aunque haya parecidos; varias → se para. Un
   // código o una descripción dudosos siguen en revisión (un código mal leído crearía un duplicado).
   // Y solo si ningún parecido tiene la misma descripción (todas sus palabras en la otra): con la misma, puede ser ese artículo con
   // el código mal leído (un duplicado); con otra («CODO … 25» frente a «CODO … 20»), es otro artículo.
   const fiable=ref&&aceptado(l.referencia)&&desc&&aceptado(l.descripcion)&&!l.referencia?.resolucion?.texto_estimado&&
    !mismoNombreQue(desc,(cat.articulos||[]).filter(x=>parecidos.some(id=>String(id)===String(x.id))));
   articulo=a.estado==="crear"&&!parecidos.length?{estado:"crear",item_id:null,via:a.via,propuesta:{referencia:a.propuesta_alta.reference,descripcion:a.propuesta_alta.name}}:
    a.estado==="crear"&&fiable?{estado:"buscar",item_id:null,via:"robot_stel_parecidos",candidatos:parecidos,propuesta:{referencia:ref,descripcion:desc}}:
    a.estado==="crear"?{estado:"revisar",item_id:null,via:"anti_duplicados_alta",candidatos:parecidos,motivo:"se parece a "+parecidos.length+" artículo(s) de STEL"}:
    a.item_id!=null&&a.estado!=="revision_articulo"?{estado:"existente",item_id:a.item_id,via:a.via,stel:deStel(a.item_id)}:
    // Catálogo leído a medias: el robot busca la referencia exacta en STEL (una fila) o, si no existe,
    // artículos parecidos en STEL antes de crearlo (si hay alguno, se para).
    a.via==="catalogo_incompleto"&&ref&&desc?{estado:"buscar",item_id:null,via:"robot_stel",propuesta:{referencia:ref,descripcion:desc}}:
    {estado:"revisar",item_id:null,via:a.via,motivo:a.motivo};
  }
  if(articulo.estado==="revisar")motivos.push("Línea "+(i+1)+": artículo dudoso en STEL ("+(articulo.motivo||articulo.via)+")");
  // Descripción del artículo ya identificado en STEL (fallo real 2026-11-17: el OCR lee «Ø» como M/V/8 y «º» como %, y la persona
  // lo corregía a mano): si el nombre de STEL se parece a lo leído (descripcionDeStel), la línea lleva el de STEL y conserva lo leído.
  const nombreStel=articulo.estado==="existente"?descripcionDeStel(desc,articulo.stel?.nombre):null;
  const descFinal=nombreStel||desc;
  return {fila:i+1,pagina:l.pagina??null,referencia:ref,descripcion:descFinal,...(descFinal!==descLeida?{descripcion_leida:descLeida}:{}),cantidad:Number.isFinite(cant)?cant:null,
   // La cantidad que sugiere el cuadre (extraer.js, sugerirCantidad) cuando no se leyó: la revisión la ofrece, nunca la pone (2026-11-25).
   ...(!Number.isFinite(cant)&&Number.isFinite(l.cantidad?.sugerida)?{cantidad_sugerida:l.cantidad.sugerida}:{}),unidad:texto(l.unidad)||null,
   precio,precio_pendiente:precio==null,descuentos:Array.isArray(l.descuento?.porcentajes)?l.descuento.porcentajes.filter(Number.isFinite):[],
   importe:Number.isFinite(l.importe?.valor)?l.importe.valor:null,articulo};
 });
 if(!lineas.length)motivos.push("Sin líneas de artículo");
 const plan={version:VERSION,archivo:doc.archivo||null,paginas:Array.isArray(doc.paginas)?doc.paginas.slice():[],
  proveedor:{account_id:cuenta,nombre_stel:provStel?String(provStel.nombre||""):null,nombre_leido:p.nombre||null,nif_leido:p.nif||null},
  tipo,numero,fecha,obra,pedido,su_referencia:r.manuscritos?.suReferencia||null,recoge:r.manuscritos?.recoge||null,notas_mano:Array.isArray(r.manuscritos?.notas)&&r.manuscritos.notas.length?r.manuscritos.notas.slice(0,3):null,...(anotacion?{anotacion}:{}),...(sinObra&&!codObra?{sin_obra:true,sin_obra_motivo:"Ningún código de obra escrito ni obra impresa: albarán sin obra"}:{}),ya_en_stel:abp?{referencia:String(abp.referencia||abp.fullReference||""),id:abp.id??null}:null,
  // Solo un total aceptado por el lector (nunca uno en revisión: prueba real 2026-10-28).
  lineas,total:Number.isFinite(r.totales?.total?.valor)&&["OK","VERIFICADO"].includes(r.totales.total.estado)?r.totales.total.valor:null,
  ...(ivaImpreso(r.totales)?{iva:ivaImpreso(r.totales)}:{}),...(pedidosPosibles.length?{pedidos_posibles:pedidosPosibles}:{}),...(obrasPosibles.length?{obras_posibles:obrasPosibles}:{}),...(arreglo.notas.length?{arreglos_lineas:arreglo.notas}:{}),
  aviso_precio:!pedido&&lineas.some(l=>l.precio_pendiente)?"PRECIO PENDIENTE":null,
  comprobaciones_pendientes:comprobacionesPendientes(opciones)};
  // Solo informativo: las reglas de arriba ya dejan en REVISAR lo que dependa de esas comprobaciones
  // (y el robot vuelve a buscar en STEL antes de crear).
 const estado=abp?"YA_EXISTE":motivos.length?"REVISAR":"PENDIENTE";
 const k=clave(r);
 return {clave:k&&esPedido?"PEDIDO|"+k:k,estado,motivos,plan};
}

return {VERSION,arreglarLineas,corregirSignos,descripcionDeStel,ivaImpreso,orden,clave,claveProvisional,planSinLectura,fechaStel,soloFaltaAbp,sinObraLeida,parecidosParaAlta,palabras};
});
