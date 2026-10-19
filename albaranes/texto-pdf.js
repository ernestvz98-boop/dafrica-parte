"use strict";
/*
 * DAFRICA · Capa de texto de PDF digitales con coordenadas (pdf.js).
 * No rasteriza ni usa IA: lee el texto exacto que contiene el PDF y lo agrupa
 * en líneas y celdas según su posición. Las coordenadas están en puntos PDF,
 * con origen arriba a la izquierda y la rotación de página ya aplicada.
 */
(function(root,factory){
 const api=factory();
 if(typeof module==="object"&&module.exports)module.exports=api;
 else{root.DafricaAlbaranes=root.DafricaAlbaranes||{};root.DafricaAlbaranes.textoPdf=api;}
})(typeof globalThis!=="undefined"?globalThis:this,function(){

const MIN_CARACTERES_DIGITAL=40;

function multiplicar(m,n){
 return [m[0]*n[0]+m[2]*n[1],m[1]*n[0]+m[3]*n[1],m[0]*n[2]+m[2]*n[3],
  m[1]*n[2]+m[3]*n[3],m[0]*n[4]+m[2]*n[5]+m[4],m[1]*n[4]+m[3]*n[5]+m[5]];
}

/*
 * Mayor área de imagen pintada en la página, como fracción de la página.
 * Una imagen que cubre casi toda la hoja indica un escaneo (aunque tenga
 * una capa de texto OCR invisible, que no es fiable como texto digital).
 */
async function fraccionImagen(pdfjs,page,ancho,alto){
 const ops=await page.getOperatorList();
 const O=pdfjs.OPS,pila=[];
 let ctm=[1,0,0,1,0,0],mayor=0;
 const pintar=new Set([O.paintImageXObject,O.paintInlineImageXObject,O.paintImageMaskXObject,O.paintJpegXObject].filter(x=>x!==undefined));
 for(let i=0;i<ops.fnArray.length;i++){
  const fn=ops.fnArray[i],args=ops.argsArray[i];
  if(fn===O.save)pila.push(ctm);
  else if(fn===O.restore)ctm=pila.pop()||[1,0,0,1,0,0];
  else if(fn===O.transform)ctm=multiplicar(ctm,args);
  else if(pintar.has(fn)){
   const area=Math.abs(ctm[0]*ctm[3]-ctm[1]*ctm[2]);
   mayor=Math.max(mayor,area/(ancho*alto));
  }
 }
 return mayor;
}

/* Une fragmentos de una misma línea en celdas cuando la separación es pequeña. */
function celdasDeLinea(fragmentos){
 const orden=[...fragmentos].sort((a,b)=>a.x0-b.x0),celdas=[];
 for(const f of orden){
  const ultima=celdas[celdas.length-1];
  const hueco=ultima?f.x0-ultima.x1:Infinity;
  const umbral=0.55*Math.min(f.alto,ultima?ultima.alto:f.alto);
  if(ultima&&hueco<umbral){
   ultima.texto+=(hueco>0.12*f.alto?" ":"")+f.texto;
   ultima.crudo=null; // tras unir fragmentos ya no hay posición por carácter
   // OCR: la confianza de una celda es la de su palabra menos segura.
   if(f.conf!=null)ultima.conf=ultima.conf==null?f.conf:Math.min(ultima.conf,f.conf);
   ultima.x1=Math.max(ultima.x1,f.x1);
   ultima.alto=Math.max(ultima.alto,f.alto);
   if(ultima.palabras)ultima.palabras.push({texto:f.texto,x0:f.x0,x1:f.x1,conf:f.conf});
  }else celdas.push({...f,
   // OCR: se guarda la caja real de cada palabra, para repartir una celda entre columnas sin estimar.
   ...(f.conf!=null?{palabras:[{texto:f.texto,x0:f.x0,x1:f.x1,conf:f.conf}]}:{})});
 }
 return celdas;
}

function agruparLineas(fragmentos){
 const orden=[...fragmentos].sort((a,b)=>a.y-b.y||a.x0-b.x0),lineas=[];
 for(const f of orden){
  // Tolerancia de 0,45 × altura: absorbe el desfase de línea base del OCR (1–2 pt) y queda muy
  // por debajo del interlineado real (≥ 1,1 × altura).
  const linea=lineas.find(l=>Math.abs(l.y-f.y)<=0.45*Math.min(l.alto,f.alto));
  if(linea){linea.fragmentos.push(f);linea.alto=Math.max(linea.alto,f.alto);}
  else lineas.push({y:f.y,alto:f.alto,fragmentos:[f]});
 }
 lineas.sort((a,b)=>a.y-b.y);
 return lineas.map((l,i)=>{
  const celdas=celdasDeLinea(l.fragmentos);
  return {indice:i,y:l.y,alto:l.alto,celdas,texto:celdas.map(c=>c.texto).join(" ")};
 });
}

/* Lee una página: líneas con celdas posicionadas y clasificación DIGITAL / ESCANEADO / MIXTO. */
async function leerPagina(pdfjs,page,numero){
 const vista=page.getViewport({scale:1});
 const contenido=await page.getTextContent();
 const fragmentos=[];
 let rotado=0;
 for(const item of contenido.items){
  const texto=String(item.str||"").replace(/\s+/g," ");
  if(!texto.trim())continue;
  const t=pdfjs.Util.transform(vista.transform,item.transform);
  const alto=Math.hypot(t[2],t[3])||Number(item.height)||10;
  const escala=Math.hypot(t[0],t[1])/(Math.hypot(item.transform[0],item.transform[1])||1);
  if(Math.abs(t[1])>0.01*alto||Math.abs(t[2])>0.01*alto){rotado++;continue;}
  const x0=t[4],ancho=(Number(item.width)||0)*escala;
  // crudo: texto original con sus espacios, que ocupa exactamente [x0,x1].
  fragmentos.push({texto:texto.trim(),crudo:String(item.str),x0,x1:x0+ancho,y:t[5],alto});
 }
 const caracteres=fragmentos.reduce((n,f)=>n+f.texto.replace(/\s/g,"").length,0);
 const imagen=await fraccionImagen(pdfjs,page,vista.width,vista.height);
 let tipo="DIGITAL";
 if(caracteres<MIN_CARACTERES_DIGITAL)tipo="ESCANEADO";
 else if(imagen>=0.6)tipo="MIXTO";
 const avisos=[];
 if(rotado)avisos.push(rotado+" fragmentos de texto girados no se han usado");
 if(tipo==="MIXTO")avisos.push("La página es una imagen escaneada con capa de texto: el texto puede proceder de un OCR previo");
 return {numero,ancho:vista.width,alto:vista.height,tipo,caracteres,fraccion_imagen:Math.round(imagen*100)/100,
  lineas:agruparLineas(fragmentos),avisos};
}

async function leerDocumento(pdfjs,datos){
 const tarea=pdfjs.getDocument({data:datos,verbosity:0,isEvalSupported:false,useSystemFonts:true});
 try{
  const pdf=await tarea.promise,paginas=[];
  for(let n=1;n<=pdf.numPages;n++){
   const page=await pdf.getPage(n);
   paginas.push(await leerPagina(pdfjs,page,n));
   page.cleanup();
  }
  return paginas;
 }finally{await tarea.destroy().catch(()=>{});}
}

return {leerDocumento,leerPagina,agruparLineas,celdasDeLinea,MIN_CARACTERES_DIGITAL};
});
