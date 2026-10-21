'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {verificar}=require('../albaranes/verificacion');
const {NIF,fila,cabeceraDoc,leer,registroCon}=require('./ayudas-ocr');
const catalogo=()=>({solo_lectura:true,persistido:false,escritura_supabase:false,escritura_stel:false,
 proveedores_completo:true,articulos_completo:true,proveedores:[{id:1,nif:NIF,nombre:'Proveedor ficticio'}],
 articulos:[{id:10,referencia:'120OP001',descripcion:'TUBO MULTICAPA'}]});
function documento({importe='10,00'}={}){
 return leer([...cabeceraDoc(),...fila(120,['ALBARÁN',60],['009999',120],['FECHA',300],['15/10/2026',340]),
 ...fila(200,['CÓDIGO',60],['CONCEPTO',120],['CANTIDAD',400],['PRECIO',460],['DTO%',500],['IMPORTE',545]),
 ...fila(218,['120OP001',60],['TUBO',120],['MULTICAPA',150],['2,00',420],['10,00',462],['50',510],[importe,560]),
 ...fila(600,['Base',60],['Imponible',82]),...fila(612,['10,00',70],['21,00%',130],['2,10',190]),...fila(630,['TOTAL',380],['12,10',505])],{registro:registroCon({nifs:[]})});
}
test('verifica automáticamente CIF y artículo únicos con catálogo completo; conserva las cifras del PDF',()=>{
 const r=documento();assert.equal(r.estado,'REVISAR');
 verificar(r,catalogo());
 assert.equal(r.proveedor.account_id,1);assert.equal(r.lineas[0].referencia.validado_catalogo,true);
 assert.equal(r.lineas[0].cantidad.valor,2);assert.equal(r.lineas[0].precio.valor,10);
 assert.equal(r.estado,'AUTO_OK');
});
test('catálogo incompleto no promueve un artículo O/0 a verificado',()=>{
 const r=documento(),c=catalogo();c.articulos_completo=false;verificar(r,c);
 assert.notEqual(r.estado,'AUTO_OK');assert.ok(!r.lineas[0].referencia.validado_catalogo);
});
test('proveedores incompletos o CIF ausente no verifican la identidad por parecido del nombre',()=>{
 for(const tipo of ['incompleto','vacio']){const r=documento(),c=catalogo();if(tipo==='incompleto')c.proveedores_completo=false;else c.proveedores[0].nif='';verificar(r,c);assert.notEqual(r.proveedor.estado,'OK');assert.equal(r.estado,'REVISAR');}
});
test('dos proveedores con el mismo CIF no se resuelven automáticamente',()=>{
 const r=documento(),c=catalogo();c.proveedores.push({...c.proveedores[0],id:2});verificar(r,c);assert.notEqual(r.proveedor.estado,'OK');
});
test('dos artículos posibles no se resuelven automáticamente',()=>{
 const r=documento(),c=catalogo();c.articulos.push({...c.articulos[0],id:11});verificar(r,c);assert.ok(!r.lineas[0].referencia.validado_catalogo);assert.equal(r.estado,'REVISAR');
});
test('una descripción de dimensiones distintas no verifica una referencia coincidente',()=>{
 const r=documento(),c=catalogo();c.articulos[0].descripcion='TUBO MULTICAPA 22 MM';verificar(r,c);assert.ok(!r.lineas[0].referencia.validado_catalogo);
});
test('alternativa realmente observada por OCR: se valida con la referencia exacta del catálogo',()=>{
 const r=documento(),c=catalogo();c.articulos[0].referencia='1200P001';
 r.lineas[0].referencia.alternativas_ocr=['1200P001'];verificar(r,c);assert.equal(r.lineas[0].referencia.valor,'1200P001');assert.equal(r.lineas[0].referencia.literal_ocr_original,'120OP001');
 assert.equal(r.lineas[0].referencia.resolucion.metodo,'catalogo_stel');
});
test('referencia leída con O/0 confundidos: se toma la ÚNICA del catálogo equivalente, con descripción compatible',()=>{
 const r=documento(),c=catalogo();c.articulos[0].referencia='1200P001';verificar(r,c);
 assert.equal(r.lineas[0].referencia.valor,'1200P001');assert.equal(r.lineas[0].referencia.validado_catalogo,true);
 assert.equal(r.lineas[0].referencia.resolucion.metodo,'catalogo_stel_confundibles');
 assert.equal(r.estado,'AUTO_OK');
});
test('dos referencias del catálogo equivalentes por caracteres confundibles: no se elige ninguna',()=>{
 const r=documento(),c=catalogo();c.articulos=[{id:10,referencia:'1200P001',descripcion:'TUBO MULTICAPA'},{id:11,referencia:'120OPOO1',descripcion:'TUBO MULTICAPA'}];
 verificar(r,c);assert.ok(!r.lineas[0].referencia.validado_catalogo);assert.equal(r.estado,'REVISAR');
});
test('equivalente por confundibles con otra descripción o con otras medidas: no se valida',()=>{
 for(const descripcion of ['CODO LATON','TUBO MULTICAPA 22 MM']){
  const r=documento(),c=catalogo();c.articulos=[{id:10,referencia:'1200P001',descripcion}];
  verificar(r,c);assert.ok(!r.lineas[0].referencia.validado_catalogo,descripcion);
 }
});
test('un código con un carácter NO confundible distinto (X por 0) no se valida',()=>{
 const r=documento(),c=catalogo();c.articulos=[{id:10,referencia:'12XOP001',descripcion:'TUBO MULTICAPA'}];
 verificar(r,c);assert.ok(!r.lineas[0].referencia.validado_catalogo);
});
test('el catálogo nunca elimina un descuadre ni rellena los importes del documento',()=>{
 const r=documento({importe:'11,00'});verificar(r,catalogo());assert.equal(r.lineas[0].importe.valor,11);assert.equal(r.lineas[0].cuadre.estado,'DESCUADRE');assert.equal(r.estado,'REVISAR');
});
test('respuesta sin garantías de solo lectura no sirve como autoridad del catálogo',()=>{
 const r=documento(),c=catalogo();c.persistido=true;verificar(r,c);assert.equal(r.proveedor.estado,'NIF_NO_REGISTRADO');assert.equal(r.estado,'REVISAR');
});
test('proveedor identificado por la huella de su CIF (STEL sin CIF): valida artículos; un NIF no registrado, no',()=>{
 const {huella}=require('../albaranes/nif');
 const conHuella=()=>leer([...cabeceraDoc(),...fila(120,['ALBARÁN',60],['009999',120],['FECHA',300],['15/10/2026',340]),
  ...fila(200,['CÓDIGO',60],['CONCEPTO',120],['CANTIDAD',400],['PRECIO',460],['DTO%',500],['IMPORTE',545]),
  ...fila(218,['120OP001',60],['TUBO',120],['MULTICAPA',150],['2,00',420],['10,00',462],['50',510],['10,00',560])],
  {registro:registroCon({nifs:[],huellas_nif:[huella(NIF)]})});
 const c=catalogo();c.proveedores=[{id:1,nif:'',nombre:'Proveedor ficticio'}];c.articulos[0].referencia='1200P001';
 const r=conHuella();assert.equal(r.proveedor.via,'nif');verificar(r,c);
 assert.equal(r.lineas[0].referencia.valor,'1200P001');assert.equal(r.lineas[0].referencia.validado_catalogo,true);
 const s=documento();verificar(s,c);assert.ok(!s.lineas[0].referencia.validado_catalogo);
});
test('CIF impreso ilegible y proveedor por nombre registrado: se completa si la huella del perfil es única en el catálogo',()=>{
 const {huella}=require('../albaranes/nif');
 const doc=()=>leer([...fila(40,['PROVEEDOR',60],['FICTICIO,',115],['S.L.',165]),...fila(120,['ALBARÁN',60],['009999',120],['FECHA',300],['15/10/2026',340]),
  ...fila(200,['CÓDIGO',60],['CONCEPTO',120],['CANTIDAD',400],['PRECIO',460],['DTO%',500],['IMPORTE',545]),
  ...fila(218,['120OP001',60],['TUBO',120],['MULTICAPA',150],['2,00',420],['10,00',462],['50',510],['10,00',560])],
  {registro:registroCon({nifs:[],huellas_nif:[huella(NIF)]})});
 let r=doc();assert.equal(r.proveedor.via,'nombre_registrado');assert.equal(r.proveedor.nif,null);
 verificar(r,catalogo());
 assert.equal(r.proveedor.nif,NIF);assert.equal(r.proveedor.estado,'OK');assert.equal(r.proveedor.account_id,1);
 // Huella repetida o ausente en el catálogo: no se completa.
 for(const c of [(()=>{const x=catalogo();x.proveedores.push({...x.proveedores[0],id:2});return x;})(),(()=>{const x=catalogo();x.proveedores[0].nif='B24999993';return x;})()]){
  r=doc();verificar(r,c);assert.equal(r.proveedor.nif,null);assert.notEqual(r.proveedor.estado,'OK');
 }
});
