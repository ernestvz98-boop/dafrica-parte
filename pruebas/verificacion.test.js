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
test('resuelve solo una alternativa realmente observada por OCR, sin inventar variantes',()=>{
 const r=documento(),c=catalogo();c.articulos[0].referencia='1200P001';verificar(r,c);assert.ok(!r.lineas[0].referencia.validado_catalogo);
 r.lineas[0].referencia.alternativas_ocr=['1200P001'];verificar(r,c);assert.equal(r.lineas[0].referencia.valor,'1200P001');assert.equal(r.lineas[0].referencia.literal_ocr_original,'120OP001');
});
test('el catálogo nunca elimina un descuadre ni rellena los importes del documento',()=>{
 const r=documento({importe:'11,00'});verificar(r,catalogo());assert.equal(r.lineas[0].importe.valor,11);assert.equal(r.lineas[0].cuadre.estado,'DESCUADRE');assert.equal(r.estado,'REVISAR');
});
test('respuesta sin garantías de solo lectura no sirve como autoridad del catálogo',()=>{
 const r=documento(),c=catalogo();c.persistido=true;verificar(r,c);assert.equal(r.proveedor.estado,'NIF_NO_REGISTRADO');assert.equal(r.estado,'REVISAR');
});
