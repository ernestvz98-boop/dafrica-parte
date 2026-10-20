"use strict";
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {PDFDocument,StandardFonts}=require('pdf-lib');
const {procesar}=require('../albaranes/lotes-pdf.js');
async function documento(n){
 const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);
 for(let i=1;i<=n;i++)pdf.addPage().drawText('Pagina original '+i,{font});
 return pdf.save();
}
async function ejecutar(n,{grupo=p=>p,fallar=()=>false,interpretar=null}={}){
 const progreso=[],llamadas=[],resultados=[];let activas=0,max=0,liberadas=0;
 const r=await procesar({PDFDocument,bytes:await documento(n),
  progreso:t=>progreso.push(t),liberar:async()=>{liberadas++},
  alResultado:(r,d)=>resultados.push([...d.paginas]),
  separar:async(data,rango)=>{
   llamadas.push(rango);assert.ok(rango.fin-rango.inicio+1<=10);
   const pdf=await PDFDocument.load(Buffer.from(data,'base64'));
   assert.equal(pdf.getPageCount(),rango.fin-rango.inicio+1);
   if(fallar(rango))throw Error('Fallo simulado');
   const docs=[];
   for(let p=rango.inicio;p<=rango.fin;p++){
    const numero=String(grupo(p));let d=docs.find(d=>d.numero===numero);
    if(!d){d={numero,paginas:[]};docs.push(d)}d.paginas.push(p-rango.inicio+1);
   }
   return {paginas_pdf:pdf.getPageCount(),documentos:docs};
  },interpretar:async d=>{
   max=Math.max(max,++activas);
   try{
    const pdf=await PDFDocument.load(Buffer.from(d.pdf_separado_b64,'base64'));
    assert.equal(pdf.getPageCount(),d.paginas.length);
    return interpretar?await interpretar(d):{estado:'PRUEBA',numero:d.numero};
   }finally{activas--}
  }});
 return {...r,progreso,llamadas,resultados,max,liberadas};
}
for(const n of [11,20,25,50])test(`PDF real de ${n} páginas: orden, cobertura única y bloques secuenciales`,async()=>{
 const r=await ejecutar(n);
 assert.equal(r.documentos.length,n);assert.equal(r.fallos.length,0);assert.equal(r.max,1);
 assert.deepEqual(r.documentos.flatMap(d=>d.paginas),Array.from({length:n},(_,i)=>i+1));
 assert.equal(r.progreso[0],`Procesando páginas 1–10 de ${n}`);
 assert.ok(r.liberadas>=r.llamadas.length+n);
 assert.ok(r.documentos.every(d=>!d.pdf_separado_b64));
});
test('fallo parcial: conserva documentos anteriores y posteriores, sin aceptar frontera incompleta',async()=>{
 const r=await ejecutar(25,{fallar:r=>r.inicio===10});
 assert.equal(r.fallos.length,1);assert.deepEqual(r.paginas_pendientes,[11,12,13,14,15,16,17,18]);
 assert.equal(r.out[0].estado,'PRUEBA');assert.equal(r.out.at(-1).estado,'PRUEBA');
 assert.ok(r.out.some(d=>d.error));assert.equal(r.documentos.length,17);
});
test('varios albaranes cruzan los bloques: se unen por página compartida sin duplicar líneas',async()=>{
 const r=await ejecutar(25,{grupo:p=>p<=12?'A':p<=22?'B':'C'});
 assert.deepEqual(r.documentos.map(d=>d.paginas.length),[12,10,3]);
 assert.deepEqual(r.out.map(d=>d.numero),['A','B','C']);assert.equal(r.fallos.length,0);
});
test('números iguales sin página compartida no eliminan documentos',async()=>{
 const r=await ejecutar(20);assert.equal(r.documentos.length,20);
});
test('error de interpretación conserva el resto y el resultado incremental',async()=>{
 const r=await ejecutar(11,{interpretar:d=>{if(d.numero==='3')throw Error('OCR caído');return {estado:'PRUEBA'}}});
 assert.equal(r.out[2].error,'OCR caído');assert.equal(r.out.length,11);assert.equal(r.resultados.length,11);
});
test('mapa inválido se rechaza sin aceptar valores ni perder otros bloques',async()=>{
 const r=await procesar({PDFDocument,bytes:await documento(11),
 separar:async(_,r)=>({paginas_pdf:r.fin-r.inicio+1,documentos:[{paginas:[1,1]}]}),
 interpretar:async()=>assert.fail('No interpretar una separación inválida')});
 assert.equal(r.fallos.length,2);assert.equal(r.out.length,0);assert.equal(r.paginas_pendientes.length,11);
});
test('pantalla integrada: 25 páginas digitales y escaneadas, sin escrituras ni llamadas STEL',async()=>{
 const vm=require('node:vm'),fs=require('node:fs');
 for(const escaneado of [false,true]){
  const bytes=await documento(25),els={},peticiones=[];let ocr=0;
  for(const id of ['pcBatch','pcPreviewFile','pcPreviewConsent','pcPreviewStart','pcPreviewStatus','pcPreviewResults'])
   els[id]={innerHTML:'',textContent:'',insertAdjacentHTML(_,s){this.innerHTML+=s},addEventListener(_,fn){this.click=fn}};
  els.pcPreviewFile.files=[{name:'25.pdf',size:7000000,arrayBuffer:async()=>bytes}];
  els.pcPreviewConsent.checked=true;
  const det={estado:'AUTO_OK',numero:{valor:'TEST'},proveedor:{nombre:'Ficticio'},lineas:[]};
  const ctx={console,Uint8Array,window:{DafricaAlbaranes:{lotesPdf:require('../albaranes/lotes-pdf'),motorNavegador:{cerrar:async()=>{}}}},
   $:id=>els[id],has:()=>true,esc:x=>String(x),renderComprasLotePilot:null,
   pcLecturaDeterminista:async()=>escaneado?{estado:'NO_DIGITAL'}:det,
   pcLecturaOCR:async()=>{ocr++;return det},pcRenderDeterminista:()=>'<p>verificado</p>',
   sb:async(url,req)=>{
    peticiones.push(url);assert.equal(url,'/functions/v1/compras-lote-piloto');
    const data=JSON.parse(req.body).data.split(',')[1],pdf=await PDFDocument.load(Buffer.from(data,'base64'));
    return {paginas_pdf:pdf.getPageCount(),documentos:Array.from({length:pdf.getPageCount()},(_,i)=>({paginas:[i+1]}))};
   },authFetch:()=>assert.fail('No se debe invocar IA cuando AUTO_OK')};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync('control-27.js','utf8'),ctx);
  ctx.pcLoadPdfLib=async()=>PDFDocument;
  ctx.renderComprasLotePilot();await els.pcPreviewStart.click();
  assert.match(els.pcPreviewResults.innerHTML,/25 documentos separados/);
  assert.match(els.pcPreviewStatus.textContent,/finalizada/);assert.equal(els.pcPreviewStart.disabled,false);
  assert.equal(ocr,escaneado?25:0);assert.equal(peticiones.length,3);
 }
});
test('frontera contradictoria se rechaza atómicamente y conserva separación previa',async()=>{
 let llamada=0;
 const r=await procesar({PDFDocument,bytes:await documento(11),
  separar:async()=>++llamada===1?{paginas_pdf:10,documentos:[{numero:'A',paginas:[1,2,3,4,5,6,7,8,9,10]}]}:
   {paginas_pdf:2,documentos:[{numero:'B',paginas:[1,2]}]},interpretar:async()=>assert.fail('Frontera dudosa')});
 assert.equal(r.fallos.length,1);assert.equal(r.documentos[0].numero,'A');assert.deepEqual(r.paginas_pendientes,[11]);
});
test('copia temporal para IA: rota solo las páginas detectadas y conserva el original',async()=>{
 const {enderezar}=require('../albaranes/lotes-pdf');
 const bytes=await documento(2),original=Buffer.from(bytes).toString('base64');
 const copia=await enderezar(PDFDocument,original,[{pagina:1,grados:270},{pagina:2,grados:0}]);
 const pdf=await PDFDocument.load(Buffer.from(copia,'base64'));
 assert.equal(pdf.getPage(0).getRotation().angle,270);assert.equal(pdf.getPage(1).getRotation().angle,0);
 assert.equal((await PDFDocument.load(bytes)).getPage(0).getRotation().angle,0);
 assert.equal(await enderezar(PDFDocument,original,[]),original);
 await assert.rejects(()=>enderezar(PDFDocument,original,[{pagina:9,grados:270}]),/no válida/);
});
test('pantalla: OCR parcial visible, IA enderezada y cabecera fiable como pista, sin aceptar campos dudosos',async()=>{
 const vm=require('node:vm'),fs=require('node:fs'),lotesPdf=require('../albaranes/lotes-pdf');
 const bytes=await documento(1),els={};let peticion,geometria=0;
 for(const id of ['pcBatch','pcPreviewFile','pcPreviewConsent','pcPreviewStart','pcPreviewStatus','pcPreviewResults'])
  els[id]={innerHTML:'',textContent:'',insertAdjacentHTML(_,s){this.innerHTML+=s},addEventListener(_,fn){this.click=fn}};
 els.pcPreviewFile.files=[{name:'test.pdf',size:bytes.length,arrayBuffer:async()=>bytes}];els.pcPreviewConsent.checked=true;
 const det={tipo_pdf:'ESCANEADO_OCR',estado:'REVISAR',orientacion:[{pagina:1,grados:270}],
  numero:{estado:'OK',valor:'009999',literal:'009999',confianza:0.95},fecha:{estado:'OK',valor:'2026-10-15',literal:'15/10/2026',confianza:0.95},
  proveedor:{id:'PERFIL_FICTICIO',nombre:'FICTICIO',nif:'B24123457',estado:'NIF_NO_REGISTRADO'},
  lineas:Array.from({length:3},(_,i)=>({fila:i+1,estado:'OK',confianza:0.6,motivos:[]})),validaciones:[],incidencias:[],confianza:0.6};
 const ctx={console,Uint8Array,window:{DafricaAlbaranes:{lotesPdf,motorNavegador:{cerrar:async()=>{}}}},
  $:id=>els[id],has:()=>true,esc:x=>String(x),renderComprasLotePilot:null,SUPABASE_URL:'https://test.invalid',
  pcProveedorMostrable:x=>x,pcLeerTablaMixta:async()=>{geometria++;throw Error('Plantilla incorrecta')},
  sb:async()=>({paginas_pdf:1,documentos:[{numero:'numero_malo',fecha:'2023-10-15',paginas:[1]}]}),
  authFetch:async(url,req)=>{peticion=JSON.parse(req.body);return {ok:true,json:async()=>({estado:'INTERPRETADO_SIN_GUARDAR',numero:'IA',lineas:[],lineas_detectadas:1,lectura_completa:false})}}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync('control-28.js','utf8'),ctx);vm.runInContext(fs.readFileSync('control-27.js','utf8'),ctx);
 ctx.pcLoadPdfLib=async()=>PDFDocument;ctx.pcLecturaDeterminista=async()=>({estado:'NO_DIGITAL'});ctx.pcLecturaOCR=async()=>det;
 ctx.renderComprasLotePilot();await els.pcPreviewStart.click();
 assert.equal(geometria,0);assert.equal(peticion.numero_esperado,'009999');assert.equal(peticion.fecha_esperada,'2026-10-15');
 const pdf=await PDFDocument.load(Buffer.from(peticion.data.split(',')[1],'base64'));
 assert.equal(pdf.getPage(0).getRotation().angle,270);
 const html=els.pcPreviewResults.innerHTML;
 assert.match(html,/3 artículos leídos con OCR local · no resuelto automáticamente/);
 assert.match(html,/Proveedor no verificado/);assert.match(html,/Confianza insuficiente/);
 assert.match(html,/Comparar con la interpretación de IA/);assert.doesNotMatch(html,/Todos los campos verificados/);
 // Tras agotarse los reintentos, el OCR debe verse también durante el avance.
 let llamadas=0,incremental='';
 ctx.window.DafricaAlbaranes.lotesPdf={...lotesPdf,reintentarLectura:(f,o)=>lotesPdf.reintentarLectura(f,{...o,esperar:async()=>{}})};
 ctx.authFetch=async()=>{llamadas++;return {ok:false,status:503,json:async()=>({error:'IA temporalmente caída'})}};
 els.pcPreviewResults.insertAdjacentHTML=function(_,s){incremental+=s;this.innerHTML+=s};
 await els.pcPreviewStart.click();
 assert.equal(llamadas,3);
 assert.match(incremental,/Lectura local conservada/);assert.match(incremental,/009999/);
 assert.match(els.pcPreviewResults.innerHTML,/Lectura local conservada/);
 assert.doesNotMatch(els.pcPreviewResults.innerHTML,/Todos los campos verificados/);
});
test('cabeceras multipágina: separa números distintos y conserva continuaciones con mismo número/fecha',()=>{
 const {dividirPorCabeceras}=require('../albaranes/lotes-pdf');
 const cab=(pagina,numero,fecha='2026-10-15')=>({pagina,titulo:true,numero:{valor:numero,estado:'OK',confianza:0.85},fecha:{valor:fecha}});
 const doc={paginas:[10,11,12],numero:'2026'};
 const r=dividirPorCabeceras(doc,[cab(1,'2026/1111'),cab(2,'2026/2222'),cab(3,'2026/2222')]);
 assert.deepEqual(r.map(d=>d.paginas),[[10],[11,12]]);
 assert.equal(dividirPorCabeceras(doc,[cab(1,'2026'),cab(2,'2026'),cab(3,'2026')])[0].separacion_local_dudosa,true);
});
test('refinamiento de separación externa: cada página se interpreta una vez y en orden',async()=>{
 const r=await procesar({PDFDocument,bytes:await documento(3),
 separar:async()=>({paginas_pdf:3,documentos:[{paginas:[1,2,3]}]}),
 refinar:async d=>d.paginas.map(p=>({paginas:[p],numero:'N'+p})),
 interpretar:async d=>({numero:d.numero})});
 assert.deepEqual(r.out.map(x=>x.numero),['N1','N2','N3']);assert.deepEqual(r.documentos.flatMap(d=>d.paginas),[1,2,3]);
});
test('refinamiento inválido conserva la agrupación original marcada sin perder páginas',async()=>{
 const r=await procesar({PDFDocument,bytes:await documento(3),
 separar:async()=>({paginas_pdf:3,documentos:[{paginas:[1,2,3]}]}),
 refinar:async()=>[{paginas:[1,2]}],interpretar:async d=>({dudosa:d.separacion_local_dudosa})});
 assert.deepEqual(r.documentos[0].paginas,[1,2,3]);assert.equal(r.out[0].dudosa,true);
 assert.ok(!r.documentos[0].pdf_separado_b64);
});
test('contraste automático bloquea cantidades IA confundidas con bultos y conserva evidencia',()=>{
 const vm=require('node:vm'),fs=require('node:fs'),ctx={};vm.createContext(ctx);vm.runInContext(fs.readFileSync('control-28.js','utf8'),ctx);
 const det={lineas:[{cantidad:{estado:'VERIFICADO',valor:90,confianza:0.99}}]};
 const entrada={lectura_completa:true,lineas:[{cantidad:30,estado_lectura:'COINCIDE'}]};
 const r=ctx.pcContrastarLocal(det,entrada);assert.equal(r.lectura_completa,false);assert.equal(r.lineas[0].estado_lectura,'DIFERENTE');
 assert.equal(r.lineas[0].cantidad,30);assert.ok(r.avisos.some(s=>s.includes('cantidad')));assert.equal(entrada.lectura_completa,true);
 assert.equal(ctx.pcContrastarLocal(det,{lectura_completa:true,lineas:[]}).lectura_completa,false);
});
test('PRY candidato conserva ceros, no asigna obra y no resuelve códigos contradictorios',()=>{
 const vm=require('node:vm'),fs=require('node:fs'),ctx={};vm.createContext(ctx);vm.runInContext(fs.readFileSync('control-28.js','utf8'),ctx);
 assert.equal(ctx.pcPryCandidato({anotacion_manual:'PRY 00111'}),'00111');
 assert.equal(ctx.pcPryCandidato({pry_codigo:'PRY00111'}),'00111');
 assert.equal(ctx.pcPryCandidato({pry_codigo:'00111',anotacion_manual:'PRY 00222'}),null);
 assert.equal(ctx.pcPryCandidato({anotacion_manual:'obra 111'}),null);
});
test('mismo número y fecha en proveedores distintos no fusiona dos albaranes',()=>{
 const {dividirPorCabeceras}=require('../albaranes/lotes-pdf');
 const cab=(pagina,nif)=>({pagina,titulo:true,numero:{valor:'009999',estado:'OK',confianza:0.95},fecha:{valor:'2026-10-15'},proveedor:{nif}});
 const r=dividirPorCabeceras({paginas:[1,2]},[cab(1,'B24123457'),cab(2,'B24555559')]);
 assert.deepEqual(r.map(d=>d.paginas),[[1],[2]]);
});
test('lectura temporal: reintenta fallos transitorios y conserva el resultado recuperado',async()=>{
 const {reintentarLectura}=require('../albaranes/lotes-pdf');let n=0;const pausas=[],avance=[];
 const r=await reintentarLectura(async()=>{if(++n<3)throw Error('IA no disponible');return {numero:'A'}},
  {esperar:async ms=>pausas.push(ms),progreso:t=>avance.push(t)});
 assert.equal(n,3);assert.equal(r.numero,'A');assert.deepEqual(pausas,[1000,2000]);assert.equal(avance.length,2);
});
test('lectura temporal: límite de intentos y rechazo definitivo sin bucle',async()=>{
 const {reintentarLectura}=require('../albaranes/lotes-pdf');let n=0;
 await assert.rejects(()=>reintentarLectura(async()=>{n++;throw Error('Caído')},{esperar:async()=>{}}),/Caído/);
 assert.equal(n,3);n=0;
 await assert.rejects(()=>reintentarLectura(async()=>{n++;throw Object.assign(Error('Sin permiso'),{noReintentar:true})},{esperar:async()=>assert.fail()}),/Sin permiso/);
 assert.equal(n,1);
});
test('bloque recuperado automáticamente: páginas 10–11 conservadas sin duplicar la compartida',async()=>{
 const {reintentarLectura}=require('../albaranes/lotes-pdf');let intentos=0;
 const r=await procesar({PDFDocument,bytes:await documento(11),
 separar:async(_,rango)=>reintentarLectura(async()=>{
  if(rango.inicio===10&&++intentos===1)throw Error('Análisis IA no disponible');
  return {paginas_pdf:rango.fin-rango.inicio+1,documentos:Array.from({length:rango.fin-rango.inicio+1},(_,i)=>({numero:String(rango.inicio+i),paginas:[i+1]}))};
 },{esperar:async()=>{}}),interpretar:async d=>({numero:d.numero})});
 assert.equal(intentos,2);assert.equal(r.fallos.length,0);assert.deepEqual(r.paginas_pendientes,[]);
 assert.deepEqual(r.out.map(d=>d.numero),Array.from({length:11},(_,i)=>String(i+1)));
});
