"use strict";
/* Evaluación de una lectura descargada de la web contra el corpus (datos ficticios). */
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("fs"),os=require("os"),path=require("path");
const {evaluarWeb}=require("./evaluar-web.js");

test("empareja cada albarán esperado con el documento leído en sus mismas páginas; separación distinta = error",()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"evaluar-web-"));
 fs.writeFileSync(path.join(dir,"lote.esperado.json"),JSON.stringify({revisado_por_persona:true,escaneado:true,documentos:[
  {pagina:1,proveedor_nif:"B24123457",numero:"600.111",fecha:"2026-10-15",lineas:[]},
  {pagina:[2,3],proveedor_nif:"B24123457",numero:"600.112",fecha:"2026-10-15",lineas:[]}]}));
 const doc=(paginas,numero)=>({archivo:"lote.pdf",paginas,estado_documento:"REVISAR",resultado:{tipo_pdf:"ESCANEADO_OCR",estado:"REVISAR",
  proveedor:{nif:"B24123457",estado:"OK",confianza:0.99},numero:{valor:numero,estado:"OK",confianza:0.95},fecha:{valor:"2026-10-15",estado:"OK",confianza:0.95},lineas:[]}});
 const r=evaluarWeb({archivos:[{nombre:"lote.pdf"}],documentos:[doc([1],"600.111"),doc([2],"600.112"),doc([3],"600.112")]},dir);
 assert.equal(r.informes.length,2);
 assert.ok(r.informes[0].comparacion.campos.every(c=>c.categoria==="CORRECTO"));
 assert.equal(r.informes[1].resultado.estado,"ERROR_SEPARACION");
});
