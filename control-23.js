"use strict";
// Rasterización local de PDF y lectura zonal: no envía documentos al proveedor de PDF.js.
// Solo se envían imágenes a la Edge Function autorizada por el usuario.
let pcPdfJsModulePromise=null;
async function pcLoadPdfJs(){
 if(!pcPdfJsModulePromise){
  pcPdfJsModulePromise=import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs")
   .then(mod=>{
    mod.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";
    return mod;
   }).catch(e=>{pcPdfJsModulePromise=null;throw new Error("No se pudo cargar el procesador local de PDF: "+e.message);});
 }
 return pcPdfJsModulePromise;
}
function pcImageBandFromCanvas(source,band){
 const total=6;
 const coreStart=band/total,coreEnd=(band+1)/total;
 const visibleStart=Math.max(0,coreStart-.021),visibleEnd=Math.min(1,coreEnd+.021);
 const sy=Math.round(source.height*visibleStart);
 const ey=Math.round(source.height*visibleEnd);
 const height=Math.max(1,ey-sy);
 const target=document.createElement("canvas");
 target.width=source.width;target.height=height;
 const context=target.getContext("2d",{alpha:false});
 if(!context)throw Error("No se pudieron preparar imágenes ampliadas");
 context.drawImage(source,0,sy,source.width,height,0,0,target.width,height);
 const jpeg=target.toDataURL("image/jpeg",.88);
 target.width=0;target.height=0;
 return {
  indice:band+1,
  core_inicio:(coreStart-visibleStart)/(visibleEnd-visibleStart),
  core_fin:(coreEnd-visibleStart)/(visibleEnd-visibleStart),
  imagen:jpeg
 };
}
async function pcLeerDocumentoPorFranjas(doc){
 const base64=String(doc?.pdf_separado_b64||"");
 if(!base64)throw Error("No existe un PDF separado válido");
 if(base64.length>9_000_000)throw Error("PDF demasiado grande para ampliación por franjas");
 const pdfjs=await pcLoadPdfJs();
 const binary=atob(base64);
 const bytes=new Uint8Array(binary.length);
 for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
 const task=pdfjs.getDocument({data:bytes,verbosity:0,useSystemFonts:true});
 let pdf;
 try{pdf=await task.promise;}catch(e){throw Error("PDF.js no pudo visualizar este PDF: "+e.message);}
 if(pdf.numPages<1||pdf.numPages>5){
  await task.destroy();
  throw Error("La lectura visual por franjas admite por ahora hasta cinco páginas de un mismo documento.");
 }
 const allLines=[],alerts=[];
 let pry="",pryLiteral="",number="";
 try{
  for(let p=1;p<=pdf.numPages;p++){
   const page=await pdf.getPage(p);
   const normal=page.getViewport({scale:1});
   const scale=Math.min(2.7,1700/normal.width);
   const viewport=page.getViewport({scale});
   const canvas=document.createElement("canvas");
   canvas.width=Math.ceil(viewport.width);
   canvas.height=Math.ceil(viewport.height);
   const ctx=canvas.getContext("2d",{alpha:false});
   if(!ctx)throw Error("El navegador no permite dibujar el PDF");
   ctx.fillStyle="#ffffff";
   ctx.fillRect(0,0,canvas.width,canvas.height);
   await page.render({canvasContext:ctx,viewport}).promise;
   const regions=Array.from({length:6},(_,i)=>pcImageBandFromCanvas(canvas,i));
   canvas.width=0;canvas.height=0;
   page.cleanup();
   const parsed=await sb("/functions/v1/compras-ocr-franjas",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({pagina:p,regiones:regions})
   });
   if(!parsed||!Array.isArray(parsed.lineas))throw Error("La lectura ampliada no pudo obtener líneas del documento");
   if(Array.isArray(parsed.advertencias))alerts.push(...parsed.advertencias.map(x=>"Página "+p+": "+x));
   const code=String(parsed.codigo_proyecto||"").trim().toUpperCase();
   if(code){
    if(pry&&pry!==code)alerts.push("Diferentes códigos PRY entre páginas: "+pry+" y "+code);
    pry=code;pryLiteral=String(parsed.codigo_proyecto_literal||"");
   }
   if(parsed.numero_documento)number=String(parsed.numero_documento);
   for(const line of parsed.lineas){
    if(!Number.isInteger(line.banda)||line.banda<1||line.banda>6){
     alerts.push("Línea de material sin franja válida en página "+p);continue;
    }
    allLines.push({
     referencia:String(line.referencia||"").trim(),
     descripcion:String(line.descripcion||"").trim(),
     cantidad:line.cantidad===null?null:Number(line.cantidad),
     unidad:String(line.unidad||"").trim(),
     precio_unitario:line.precio_unitario===null?null:Number(line.precio_unitario),
     pagina:p,banda:line.banda,ilegible:!!line.ilegible,duda:line.duda||""
    });
   }
  }
 }finally{
  await task.destroy().catch(()=>{});
 }
 if(!allLines.length)alerts.push("No se han identificado materiales en los recortes");
 if(allLines.some(x=>x.ilegible||!x.referencia||!Number.isFinite(x.cantidad)||x.cantidad<=0))
  alerts.push("Existen líneas con referencias o cantidades insuficientemente legibles");
 if(number&&doc.numero&&String(doc.numero).replace(/\W/g,"")!==number.replace(/\W/g,""))
  alerts.push("El número de documento de los recortes no coincide con la primera lectura");
 if(pry&&!/^PRY[0-9]{4,8}$/.test(pry))alerts.push("Código PRY no válido");
 return {lineas:allLines,codigo_proyecto:pry,codigo_proyecto_literal:pryLiteral,
  numero_documento:number,advertencias:alerts};
}
