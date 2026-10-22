"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("fs"),os=require("os"),path=require("path");
const {compararVision,clasificar}=require("./comparar-vision.js");

test("clasificar: aceptado correcto, aceptado erróneo (crítico), revisión con o sin la lectura correcta, vacío",()=>{
 assert.equal(clasificar({valor:"PRY12345",estado:"OK",confianza:0.95},"PRY12345"),"correcto");
 assert.equal(clasificar({valor:"PRY12845",estado:"OK",confianza:0.95},"PRY12345"),"critico");
 assert.equal(clasificar({valor:null,estado:"AMBIGUO",resolucion:{alternativas:["PRY12345","PRY17345"]}},"PRY12345"),"revision_con");
 assert.equal(clasificar({valor:"PRY99999",estado:"REVISAR"},"PRY12345"),"revision_sin");
 assert.equal(clasificar({valor:null,estado:"VACIO"},"PRY12345"),"vacio");
 assert.equal(clasificar({valor:null,estado:"VACIO"},null),"correcto");
});

test("compararVision: empareja por páginas y suma el consumo de cada modelo",()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"cv-"));
 fs.writeFileSync(path.join(dir,"lote.esperado.json"),JSON.stringify({documentos:[{pagina:1,manuscritos:{obra:"PRY12345",stel:"ABP261234"}}]}));
 const m=(obra,stel)=>({obra:{valor:obra,estado:"OK",confianza:0.95},stel:{valor:stel,estado:"OK",confianza:0.95}});
 const lectura={motores:{vision:{uso:{modelo:"gpt-4o",input_tokens:1000,output_tokens:100}}},documentos:[{archivo:"lote.pdf",paginas:[1],resultado:{manuscritos:{comparacion:{
  principal:m("PRY12345","ABP261234"),modelos:{"gpt-5":{...m("PRY12345","ABP261284"),uso:{input_tokens:500,output_tokens:50,llamadas:1}},"o4-mini":{error:"no disponible"}}}}}}]};
 const t=compararVision(lectura,dir);
 assert.equal(t.principal.correcto,2);
 assert.equal(t["gpt-5"].correcto,1);assert.equal(t["gpt-5"].critico,1);
 assert.equal(t["gpt-5"].uso.input_tokens,500);
 assert.equal(t["o4-mini"].errores,1);
});

test("compararVision: el principal cuenta solo el consumo de sus consultas de manuscritos (por_modo, lector24)",()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"cv-"));
 fs.writeFileSync(path.join(dir,"lote.esperado.json"),JSON.stringify({documentos:[{pagina:1,manuscritos:{obra:"PRY12345",stel:null}}]}));
 const lectura={motores:{vision:{por_modo:{manuscrito:{modelo:"gpt-5.1",llamadas:2,input_tokens:800,output_tokens:80},impreso:{modelo:"gpt-4o",llamadas:1,input_tokens:5000,output_tokens:500}}}},
  documentos:[{archivo:"lote.pdf",paginas:[1],resultado:{manuscritos:{comparacion:{principal:{obra:{valor:"PRY12345",estado:"OK",confianza:0.95},stel:null},modelos:{}}}}}]};
 const t=compararVision(lectura,dir);
 assert.deepEqual(t.principal.uso,{input_tokens:800,output_tokens:80,llamadas:2});
 assert.equal(t.principal.correcto,2);
});
