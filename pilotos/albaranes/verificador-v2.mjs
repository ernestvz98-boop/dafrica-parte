// Piloto independiente: validación determinista sin escritura ni modificación de STEL.
// Coincidencia de modelos != certificación del papel original.
const norm=x=>String(x??"").trim().normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase().replace(/\s+/g," ");
const value=x=>typeof x==="number"&&Number.isFinite(x)&&x>0?x:null;
export function validar(input){
 const one=input?.lectura_geometrica?.lineas,two=input?.lectura_independiente?.lineas;
 if(!Array.isArray(one)||!Array.isArray(two)||!one.length)return {estado:"BLOQUEADO",motivos:["Lecturas estructuradas ausentes"],registrable:false};
 const incidencias=[],filas=[];
 if(one.length!==two.length)incidencias.push("Número de filas diferente: "+one.length+"/"+two.length);
 for(let i=0;i<Math.max(one.length,two.length);i++){
  const a=one[i],b=two[i],d=[];
  if(!a||!b)d.push("Fila ausente");
  else{
   if(!String(a.referencia||"").trim()||String(a.referencia).trim()!==String(b.referencia||"").trim())d.push("Referencia");
   if(value(a.cantidad)===null||value(a.cantidad)!==value(b.cantidad))d.push("Cantidad");
   if(!norm(a.descripcion)||norm(a.descripcion)!==norm(b.descripcion))d.push("Descripción");
   if(norm(a.unidad)!==norm(b.unidad))d.push("Unidad");
   if(a.precio_unitario!==b.precio_unitario)d.push("Precio");
  }
  filas.push({fila:i+1,coincide:d.length===0,diferencias:d});
 }
 if(filas.some(x=>!x.coincide))incidencias.push("Existen discrepancias en materiales");
 const total=input?.total_lineas_impreso;
 if(Number.isInteger(total)&&total>=0&&total!==one.length)incidencias.push("El total impreso verificable no coincide");
 // Cuando el total no se lee se mantiene null: no se inventa discrepancia.
 if(input?.filas_verificadas_por_coordenadas!==true||input?.documentos_separados_verificados!==true)
  incidencias.push("Falta prueba geométrica de las filas del PDF original");
 if(input?.duplicado_stel===true)incidencias.push("Posible duplicado en STEL");
 const p=norm(input?.lectura_geometrica?.codigo_proyecto),q=norm(input?.lectura_independiente?.codigo_proyecto);
 const obra_estado=/^PRY\d{5}$/.test(p)&&p===q&&input?.proyecto_confirmado_catalogo===true?"CANDIDATA":"SIN_ASIGNAR";
 return {estado:incidencias.length?"BLOQUEADO":"CANDIDATO_AUTOMATICO",registrable:false,obra_estado,
  numero_lineas:one.length,filas,motivos:incidencias,
  advertencia:"La coincidencia no acredita exactitud del PDF; sin escritura en STEL ni en costes."};
}
