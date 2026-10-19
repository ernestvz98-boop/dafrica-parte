"use strict";
/**
 * Mixed supplier layout reader (V5). Counts physical table rows from the
 * intersection of article/reference + quantity ink bands. This is independent
 * of the AI's proposed row count. Never promotes an unverified row to a cost.
 * Calibrated on seven real scanned pages of RODAVI and Maderas Pereira.
 */
async function pcLeerTablaMixta(doc){
 const lines=Array.isArray(doc?.lineas)?doc.lineas:[];
 const encoded=String(doc?.pdf_separado_b64||"");
 if(!lines.length||lines.length>5||!encoded||encoded.length>9000000)
  throw Error("Formato de tabla corta no aplicable");
 const number=String(doc.numero||"");
 const profile=/^26[/]0[0-9]{4}$/.test(number)?"MADERAS":/^0{2}[0-9]{4}$/.test(number)?"RODAVI":"GENERAL";
 if(profile==="GENERAL")throw Error("Proveedor sin geometría física comprobada: se utilizarán lecturas independientes");
 const pdfjs=await pcLoadPdfJs(),binary=atob(encoded),bytes=new Uint8Array(binary.length);
 for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
 const task=pdfjs.getDocument({data:bytes,verbosity:0,useSystemFonts:true});
 let fullCanvas=null;
 try{
   const pdf=await task.promise;
   if(pdf.numPages!==1)throw Error("La plantilla requiere una página");
   const page=await pdf.getPage(1),base=page.getViewport({scale:1});
   const view=page.getViewport({scale:Math.min(4,2100/base.width)});
   fullCanvas=document.createElement("canvas");fullCanvas.width=Math.ceil(view.width);fullCanvas.height=Math.ceil(view.height);
   const context=fullCanvas.getContext("2d",{alpha:false,willReadFrequently:true});
   context.fillStyle="#fff";context.fillRect(0,0,fullCanvas.width,fullCanvas.height);
   await page.render({canvasContext:context,viewport:view}).promise;
   const w=fullCanvas.width,h=fullCanvas.height,top=Math.floor(h*(profile==="RODAVI"?.342:.332)),bottom=Math.floor(h*.451);
   const pixels=context.getImageData(0,top,w,bottom-top).data;
   const cols=[[.06,.23],[.65,.76]].map(([a,b])=>[Math.floor(w*a),Math.floor(w*b)]);
   const mask=[];
   for(let y=0;y<bottom-top;y++){
     const percentages=cols.map(([x0,x1])=>{
       let ink=0,total=0;
       for(let x=x0;x<x1;x+=3){
         const at=(y*w+x)*4;
         if(pixels[at]+pixels[at+1]+pixels[at+2]<360)ink++;
         total++;
       }
       return ink/Math.max(1,total);
     });
     mask.push(percentages[0]>.017&&percentages[1]>.014);
   }
   const pieces=[];let start=-1;
   for(let y=0;y<=mask.length;y++){
     const ink=!!mask[y];
     if(ink&&start<0)start=y;
     if(!ink&&start>=0){
       if(y-start>=2)pieces.push([start+top,y+top]);
       start=-1;
     }
   }
   const merged=[];
   for(const p of pieces){
     if(merged.length&&p[0]-merged[merged.length-1][1]<h*.003)
       merged[merged.length-1][1]=p[1];
     else merged.push(p.slice());
   }
   const detected=merged.filter(([a,b])=>b-a>=h*.001);
   if(detected.length<1||detected.length>5)
     return {lineas_validas:false,numero_filas_geometricas:detected.length,lineas:[],imagenes_zonas:[],
       codigo_proyecto:"",geometria_razon:"No se pudieron identificar inequívocamente las bandas físicas"};
   // Compose each physical row separately, with an F label outside the PDF.
   // The audit model never needs to guess which line a quantity belongs to.
   const output=document.createElement("canvas");
   const bandH=200;
   output.width=1860;output.height=52+detected.length*bandH;
   const o=output.getContext("2d",{alpha:false});
   o.fillStyle="#fff";o.fillRect(0,0,output.width,output.height);
   o.fillStyle="#131b2b";o.font="bold 21px sans-serif";
   o.fillText("FILAS FÍSICAS DETECTADAS (referencia / descripción / cantidad / precio)",14,30);
   for(let i=0;i<detected.length;i++){
     const [a,b]=detected[i],middle=(a+b)/2;
     const half=Math.max(h*.006,(b-a)*.72);
     const sourceY=Math.max(0,Math.floor(middle-half)),sourceH=Math.max(4,Math.min(h-sourceY,Math.ceil(2*half)));
     const dy=52+i*bandH;
     o.strokeStyle="#ddd";o.strokeRect(0,dy,output.width,bandH);
     o.fillStyle="#111";o.font="bold 30px sans-serif";o.fillText("F"+(i+1),12,dy+98);
     o.drawImage(fullCanvas,Math.floor(w*.035),sourceY,Math.floor(w*.95),sourceH,94,dy+13,1760,172);
   }
   const rowImage=output.toDataURL("image/jpeg",.88);
   output.width=0;output.height=0;
   // Header composite gives the printed date and number more pixels than the
   // old [.01,.29] crop, which cut the date on RODAVI 003424.
   const head=document.createElement("canvas");
   head.width=1840;head.height=850;
   const c=head.getContext("2d",{alpha:false});
   c.fillStyle="white";c.fillRect(0,0,1840,850);
   c.fillStyle="#111";c.font="bold 20px sans-serif";
   c.fillText("CABECERA ORIGINAL: empresa emisora y número/fecha impresos",12,28);
   c.drawImage(fullCanvas,Math.round(w*.02),Math.round(h*.015),Math.round(w*.96),Math.round(h*.215),8,43,1824,443);
   c.fillText("NÚMERO Y FECHA IMPRESOS (parte baja de la cabecera)",12,518);
   c.drawImage(fullCanvas,Math.round(w*.02),Math.round(h*.243),Math.round(w*.96),Math.round(h*.097),8,535,1824,300);
   const headerImage=head.toDataURL("image/jpeg",.93);head.width=0;head.height=0;
   const physicalCountMatches=detected.length===lines.length;
   // The first model is a candidate, NOT the authority for how many physical
   // rows exist. If it missed/duplicated rows, send blank placeholders:
   // backend then requires three independent vision reads to accept them.
   const candidates=physicalCountMatches?lines.map(x=>({
      referencia:String(x.referencia||""),descripcion:String(x.descripcion||""),
      cantidad:x.cantidad===null?null:Number(x.cantidad),unidad:String(x.unidad||""),
      precio_unitario:null
    })):detected.map(()=>({
      referencia:"",descripcion:"",cantidad:null,unidad:"",precio_unitario:null
    }));
   return {
    numero_filas_geometricas:detected.length,lineas_validas:true,
    lineas:candidates,
    imagenes_zonas:[rowImage],imagen_cabecera:headerImage,
    perfil_formato:profile,permite_sin_referencia:profile==="MADERAS",
    codigo_proyecto:String(doc.codigo_proyecto||""),
    bandas_fisicas:detected.map(([a,b],i)=>({fila:i+1,y_inicio:Math.round(10000*a/h)/10000,y_fin:Math.round(10000*b/h)/10000})),
    geometria_razon:physicalCountMatches?"Recuento físico concordante":"Recuento inicial incorrecto: requiere tres lecturas independientes",clasificador_coincide_filas:physicalCountMatches
   };
 }finally{
   if(fullCanvas){fullCanvas.width=0;fullCanvas.height=0}
   await task.destroy().catch(()=>{});
 }
}
