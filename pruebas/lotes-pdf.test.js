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
  const ctx={console,Uint8Array,window:{DafricaAlbaranes:{lotesPdf:{procesar},motorNavegador:{cerrar:async()=>{}}}},
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
 assert.match(html,/3 artículos leídos con OCR local · requiere revisión/);
 assert.match(html,/Proveedor no verificado/);assert.match(html,/Confianza insuficiente/);
 assert.match(html,/Comparar con la interpretación de IA/);assert.doesNotMatch(html,/Todos los campos verificados/);
});
