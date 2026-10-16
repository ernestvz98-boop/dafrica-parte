"use strict";
async function pcLeerTablaMixta(doc){
 const lines=Array.isArray(doc?.lineas)?doc.lineas:[];
 const encoded=String(doc?.pdf_separado_b64||"");
 if(lines.length<1||lines.length>5||encoded.length>9000000||!encoded)throw Error("Formato de tabla corta no aplicable");
 const number=String(doc.numero||"");
 const profile=/^26\\/0\\d{4}$/.test(number)?"MADERAS":/^0{2}\\d{4}$/.test(number)?"RODAVI":"GENERAL";
 const pdfjs=await pcLoadPdfJs(),binary=atob(encoded),bytes=new Uint8Array(binary.length);
 for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
 const task=pdfjs.getDocument({data:bytes,verbosity:0,useSystemFonts:true});
 let canvas=null;
 try{
   const pdf=await task.promise;
   if(pdf.numPages!==1)throw Error("Documento multipágina fuera del perfil");
   const page=await pdf.getPage(1),base=page.getViewport({scale:1});
   const view=page.getViewport({scale:Math.min(4,2100/base.width)});
   canvas=document.createElement("canvas");canvas.width=Math.ceil(view.width);canvas.height=Math.ceil(view.height);
   const ctx=canvas.getContext("2d",{alpha:false});ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);
   await page.render({canvasContext:ctx,viewport:view}).promise;
   const crop=(rect,title)=>{
     const [x0,y0,x1,y1]=rect;
     const result=document.createElement("canvas");result.width=1660;result.height=740;
     const c=result.getContext("2d",{alpha:false});c.fillStyle="#fff";c.fillRect(0,0,result.width,result.height);
     c.fillStyle="#111";c.font="bold 20px sans-serif";c.fillText(title,14,27);
     c.drawImage(canvas,Math.round(x0*canvas.width),Math.round(y0*canvas.height),
      Math.round((x1-x0)*canvas.width),Math.round((y1-y0)*canvas.height),8,40,1644,690);
     const image=result.toDataURL("image/jpeg",.93);result.width=0;result.height=0;return image;
   };
   const table=profile==="MADERAS"?[.04,.303,.96,.47]:profile==="RODAVI"?[.02,.30,.98,.44]:[.03,.27,.97,.53];
   return {numero_filas_geometricas:lines.length,lineas_validas:true,
    lineas:lines.map(x=>({referencia:String(x.referencia||""),descripcion:String(x.descripcion||""),
     cantidad:x.cantidad===null?null:Number(x.cantidad),unidad:String(x.unidad||""),
     precio_unitario:x.precio_unitario??null})),
    imagenes_zonas:[crop(table,"REGION DE TABLA: "+lines.length+" filas de materiales")],
    imagen_cabecera:crop([.02,.01,.98,.29],"CABECERA: emisor / proveedor, numero y fecha"),
    perfil_formato:profile,permite_sin_referencia:profile==="MADERAS"&&lines.length===1,
    codigo_proyecto:String(doc.codigo_proyecto||"")
   };
 }finally{if(canvas){canvas.width=0;canvas.height=0}await task.destroy().catch(()=>{})}
}