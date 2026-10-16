import assert from "node:assert/strict";
import {validate,verifyStelAbp,STATUS} from "./core-validator-v4.mjs";
const h={numero:"003570",proveedor:"RODAVI SUMINISTROS, S.L.",fecha:"2026-10-13"};
const l=[
 {referencia:"156670",descripcion:"SOUDASEAL 255 SUPERTACK WHITE",cantidad:1,precio_unitario:7.99},
 {referencia:"1123580",descripcion:"POLIMERO GRIS SOUDASEAL 240 FC",cantidad:2,precio_unitario:7.58},
 {referencia:"08092307",descripcion:"BROCA HEX-9 HARD CERAMIC D.6 OFERTA",cantidad:2,precio_unitario:12.5},
 {referencia:"608577351",descripcion:"ESTUCHE PROBOX 19 BROCAS PointeQ",cantidad:1,precio_unitario:25.95}];
const primary={...h,lineas:l};
const independent={...h,lineas:l.map(x=>({...x,descripcion:x.descripcion+" (OFERTA)",precio_unitario:x.precio_unitario+0.03})).reverse()};
const layout={filas_verificadas:true,numero_filas:4,numero:h.numero,proveedor:h.proveedor,fecha:h.fecha};
const good=validate({primary,secondary:independent,physical:layout});
assert.equal(good.status,STATUS.VERIFIED);
assert.equal(good.accepted.length,4);
assert(good.accepted.every(x=>x.precio_unitario===null));
const wrong={...independent,lineas:independent.lineas.map(x=>({...x}))};
wrong.lineas.find(x=>x.referencia==="1123580").cantidad=5;
assert.equal(validate({primary,secondary:wrong,physical:layout}).status,STATUS.HELD);
assert.equal(validate({primary,secondary:{...independent,lineas:l.slice(0,3)},physical:layout}).status,STATUS.HELD);
assert.equal(validate({primary:{...primary,numero:"ABP262687"},secondary:{...independent,numero:"ABP262687"},physical:layout}).status,STATUS.HELD);
assert.equal(validate({primary:{...primary,proveedor:"DAFRICA BIERZO SL"},secondary:{...independent,proveedor:"DAFRICA BIERZO SL"},physical:layout}).status,STATUS.HELD);
assert.equal(validate({primary:{...primary,fecha:"2023-10-13"},secondary:{...independent,fecha:"2023-10-13"},physical:layout}).status,STATUS.HELD);
const m={numero:"26/02629",proveedor:"MADERAS PEREIRA REGUERAS SLU",fecha:"2026-09-14",lineas:[{referencia:"",descripcion:"Cabina sanitaria",cantidad:1,precio_unitario:1890}]};
const proof={numero:m.numero,proveedor:m.proveedor,fecha:m.fecha,filas_verificadas:true,numero_filas:1,sin_codigo_permitido:true};
assert.equal(validate({primary:m,secondary:m,physical:proof}).status,STATUS.HELD);
assert.equal(validate({primary:m,secondary:m,third:m,physical:proof}).status,STATUS.VERIFIED);
assert.equal(validate({primary,secondary:independent,physical:{...layout,filas_verificadas:false}}).status,STATUS.HELD);
const stel=[{id:9081,"full-reference":"ABP262680","extra-reference":"681.599","account-name":"SALTOKI PONFERRADA, S.L."}];
assert.equal(verifyStelAbp({abp:"ABP262680",numeroProveedor:"681.599",proveedor:"SALTOKI PONFERRADA SL",results:stel}).verified,true);
assert.equal(verifyStelAbp({abp:"ABP262680",numeroProveedor:"681.677",proveedor:"SALTOKI PONFERRADA SL",results:stel}).verified,false);
console.log("V4: 11 validation checks passed (synthetic and adversarial).");
