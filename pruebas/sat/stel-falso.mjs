// STEL Order FALSO para pruebas locales (nunca toca STEL). Imita las rutas y campos de la especificación oficial
// (https://app.stelorder.com/app/api/openapi.json) que usa sat-stel: clients, addresses, contacts, assets, products,
// services, incidents, workDeliveryNotes, entityAttachments, ordinaryInvoices, issueInvoiceVerifactu.
// Valida lo obligatorio (APIKEY, account-id, líneas ITEM con item-id existente, parent-document-id…) y permite
// simular fallos: respuesta perdida después de un POST (la escritura se hace pero el cliente no recibe nada),
// errores 500/429 y facturas sin PDF.

export function crearStelFalso({clave = "clave-falsa", baseUrl = ""} = {}) {
  let siguiente = 1000;
  const id = () => ++siguiente;
  const ahora = () => new Date().toISOString().replace(/\.\d+Z$/, "+0000");
  const datos = {
    clients: [], addresses: [], contacts: [], assets: [], products: [], services: [],
    incidents: [], workDeliveryNotes: [], entityAttachments: [], ordinaryInvoices: [],
  };
  const estado = {
    llamadas: [], perderRespuesta: new Set(), fallar: new Map(), pdfFactura: true, emitidas: new Set(), baseUrl,
  };
  const sembrar = (ruta, fila) => { const x = {id: id(), deleted: false, "utc-last-modification-date": ahora(), ...fila}; datos[ruta].push(x); return x; };

  const filtrar = (lista, q) => lista.filter((x) => {
    for (const [k, v] of q) {
      if (["limit", "start", "sort", "APIKEY"].includes(k)) continue;
      if (k === "title" || k === "name") { if (!String(x[k] || "").toLowerCase().includes(v.toLowerCase())) return false; continue; }
      if (x[k] === undefined) continue; // filtro que el recurso no tiene: STEL lo ignora
      if (String(x[k]) !== v) return false;
    }
    return true;
  });
  const item = (iid) => datos.products.find((p) => p.id === iid) || datos.services.find((p) => p.id === iid);
  const lineasDe = (lines, res) => {
    if (!Array.isArray(lines) || !lines.length) return res(400, "lines obligatorio");
    const out = [];
    for (const [i, l] of lines.entries()) {
      if (!["ITEM", "SECTION", "COMPONENT"].includes(l["line-type"])) return res(400, "line-type no válido");
      if (l["line-type"] === "ITEM") {
        const it = item(Number(l["item-id"]));
        if (!it) return res(400, `item-id ${l["item-id"]} no existe`);
        const precio = l["item-base-price"] ?? it["sales-price"] ?? 0;
        const units = l.units ?? 1;
        const base = Math.round(units * precio * (1 - (l["discount-percentage"] || 0) / 100) * 100) / 100;
        const iva = l["primary-tax-percentage"] ?? it["primary-tax-percentage"] ?? 21;
        out.push({...l, order: i, "item-name": it.name, "item-base-price": precio, units, "primary-tax-percentage": iva,
          "total-amount": base, "_iva": Math.round(base * iva) / 100});
      } else out.push({...l, order: i});
    }
    return out;
  };
  const totales = (lineas) => {
    const sub = Math.round(lineas.reduce((s, l) => s + (l["total-amount"] || 0), 0) * 100) / 100;
    const iva = Math.round(lineas.reduce((s, l) => s + (l._iva || 0), 0) * 100) / 100;
    return {"subtotal-amount": sub, "tax-total-amount": iva, "total-amount": Math.round((sub + iva) * 100) / 100};
  };

  async function atender(req, res, ruta) {
    // ruta: lo que va después de /__stel/
    const url = new URL(req.url, "http://x");
    const enviar = (codigo, cuerpo, tipo = "application/json; charset=utf-8") => {
      res.writeHead(codigo, {"Content-Type": tipo});
      res.end(typeof cuerpo === "string" || cuerpo instanceof Uint8Array ? cuerpo : JSON.stringify(cuerpo));
      return null;
    };
    const err = (codigo, msg) => { enviar(codigo, {error: msg}); return null; };
    if (ruta.startsWith("pdf/")) {
      const f = datos.ordinaryInvoices.find((x) => String(x.id) === ruta.slice(4));
      if (!f) return err(404, "no existe");
      return enviar(200, Buffer.from(`%PDF-1.4\n% factura falsa ${f["full-reference"]}\n%%EOF`), "application/pdf");
    }
    if ((req.headers.apikey || url.searchParams.get("APIKEY")) !== clave) return err(401, "APIKEY no válida");
    let cuerpo = null;
    if (req.method === "POST" || req.method === "PUT") {
      const trozos = []; for await (const t of req) trozos.push(t);
      try { cuerpo = JSON.parse(Buffer.concat(trozos).toString("utf8") || "null"); } catch { return err(400, "JSON no válido"); }
    }
    const [recurso, idTexto, extra] = ruta.replace(/^app\//, "").split("/");
    estado.llamadas.push({metodo: req.method, recurso, id: idTexto || null, query: Object.fromEntries(url.searchParams), cuerpo});
    const fallo = estado.fallar.get(`${req.method} ${recurso}`);
    if (fallo && fallo.veces > 0) { fallo.veces--; return err(fallo.codigo, "fallo simulado"); }
    const perder = () => { if (estado.perderRespuesta.has(`${req.method} ${recurso}`)) { estado.perderRespuesta.delete(`${req.method} ${recurso}`); res.destroy(); return true; } return false; };

    if (recurso === "issueInvoiceVerifactu" && req.method === "POST") {
      const f = datos.ordinaryInvoices.find((x) => String(x.id) === idTexto);
      if (!f) return err(400, "factura no existe");
      if (typeof cuerpo?.paid !== "boolean") return err(400, "paid obligatorio");
      estado.emitidas.add(f.id);
      return enviar(200, [f]);
    }
    const lista = datos[recurso];
    if (!lista) return err(404, "recurso no expuesto");
    if (req.method === "GET") {
      if (idTexto) {
        if (extra === "download") { const a = lista.find((x) => String(x.id) === idTexto); return a ? enviar(200, Buffer.from(a._base64, "base64"), "application/octet-stream") : err(404, "no"); }
        const x = lista.find((y) => String(y.id) === idTexto);
        return x ? enviar(200, [limpio(x)]) : enviar(200, []);
      }
      const limit = Math.min(Number(url.searchParams.get("limit") || 100), 500), start = Number(url.searchParams.get("start") || 0);
      const visibles = filtrar(lista.filter((x) => !x.deleted), url.searchParams);
      return enviar(200, visibles.slice(start, start + limit).map(limpio));
    }
    if (req.method === "POST" && !idTexto) {
      let nuevo;
      if (recurso === "incidents") {
        if (!cuerpo?.description) return err(400, "description obligatorio");
        if (cuerpo["account-id"] && !datos.clients.some((c) => c.id === cuerpo["account-id"])) return err(400, "account-id no existe");
        nuevo = {...cuerpo, reference: String(datos.incidents.length + 1).padStart(5, "0")};
        nuevo["full-reference"] = "INC" + nuevo.reference;
      } else if (recurso === "workDeliveryNotes" || recurso === "ordinaryInvoices") {
        if (!datos.clients.some((c) => c.id === cuerpo?.["account-id"])) return err(400, "account-id no existe");
        if (recurso === "ordinaryInvoices" && cuerpo["parent-document-id"] && !datos.workDeliveryNotes.some((d) => d.id === cuerpo["parent-document-id"]))
          return err(400, "parent-document-id no válido");
        if ("external-id" in (cuerpo || {})) return err(400, "external-id no admitido al crear documentos");
        const lineas = lineasDe(cuerpo.lines, err); if (!lineas) return null;
        const pref = recurso === "workDeliveryNotes" ? "AT" : "F";
        const n = datos[recurso].length + 1;
        nuevo = {...cuerpo, lines: lineas, reference: String(n).padStart(5, "0"), "full-reference": `${pref}26-${String(n).padStart(5, "0")}`,
          "document-state-id": 1, signed: false, ...totales(lineas)};
      } else if (recurso === "entityAttachments") {
        if (!cuerpo?.["entity-id"] || !cuerpo?.["entity-type"]) return err(400, "entity-id y entity-type obligatorios");
        if (!!cuerpo["file-url"] === !!cuerpo["file-base64"]) return err(400, "file-url o file-base64, uno de los dos");
        if (cuerpo["file-base64"] && !cuerpo["file-name"]) return err(400, "file-name obligatorio con file-base64");
        nuevo = {name: cuerpo["file-name"], description: cuerpo.description || "", "entity-id": cuerpo["entity-id"], "entity-type": cuerpo["entity-type"],
          "upload-date": ahora(), _base64: cuerpo["file-base64"]};
      } else if (recurso === "clients") {
        if (!cuerpo?.name) return err(400, "name obligatorio");
        nuevo = {...cuerpo};
      } else if ((recurso === "services" || recurso === "products") && cuerpo?.reference && !/^\d+$/.test(cuerpo.reference) && cuerpo["serial-number-id"] !== -2) {
        // Como el STEL real (E000191, visto el 2026-11-20): una referencia que no es solo de cifras exige la serie MANUAL (-2).
        return err(400, "Invalid reference: serie MANUAL (-2) obligatoria");
      } else if (recurso === "services") {
        if (!cuerpo?.name) return err(400, "name obligatorio");
        nuevo = {inactive: false, "primary-tax-percentage": 21, ...cuerpo};
      } else if (recurso === "products") {
        if (!cuerpo?.name) return err(400, "name obligatorio");
        // Como el STEL de DAFRICA: no deja dos artículos con el mismo nombre.
        if (datos.products.some((x) => !x.deleted && String(x.name).toLowerCase() === String(cuerpo.name).toLowerCase())) return err(400, "nombre repetido");
        nuevo = {inactive: false, "primary-tax-percentage": 21, ...cuerpo};
      } else return err(405, "no permitido en el falso");
      const x = {id: id(), deleted: false, "creation-date": ahora(), "utc-last-modification-date": ahora(), ...nuevo};
      if (recurso === "ordinaryInvoices") x["pdf-path"] = estado.pdfFactura ? `${estado.baseUrl}/__stel/pdf/${x.id}` : "";
      lista.push(x);
      if (perder()) return null;
      return enviar(200, [limpio(x)]);
    }
    if (req.method === "DELETE" && idTexto) {
      const x = lista.find((y) => String(y.id) === idTexto && !y.deleted);
      if (!x) return err(404, "no existe");
      x.deleted = true;
      return enviar(200, [limpio(x)]);
    }
    if (req.method === "PUT" && idTexto) {
      const x = lista.find((y) => String(y.id) === idTexto && !y.deleted);
      if (!x) return err(404, "no existe");
      if (cuerpo.lines) { const l = lineasDe(cuerpo.lines, err); if (!l) return null; Object.assign(x, totales(l)); x.lines = l; }
      Object.assign(x, {...cuerpo, lines: x.lines, "utc-last-modification-date": ahora()});
      return enviar(200, [limpio(x)]);
    }
    return err(405, "método no permitido");
  }
  const limpio = (x) => { const {_base64, ...r} = x; return {...r, lines: r.lines?.map(({_iva, ...l}) => l)}; };

  return {atender, datos, estado, sembrar};
}

/** Catálogo ficticio de prueba (nombres y datos inventados). */
export function sembrarCatalogo(stel) {
  const c1 = stel.sembrar("clients", {name: "Comunidad Ficticia Calle Mayor 1", "tax-identification-number": "H00000000", phone: "600000001", email: "cm1@prueba.invalid"});
  const c2 = stel.sembrar("clients", {name: "Restaurante Ficticio El Puerto", "tax-identification-number": "B00000001", phone: "600000002"});
  const d1 = stel.sembrar("addresses", {"account-id": c1.id, name: "Sala de calderas", "address-data": "Calle Mayor 1", "postal-code": "28000", "city-town": "Madrid", province: "Madrid"});
  stel.sembrar("addresses", {"account-id": c2.id, name: "Cocina", "address-data": "Paseo Marítimo 5", "postal-code": "29000", "city-town": "Málaga", province: "Málaga"});
  stel.sembrar("contacts", {"account-id": c1.id, name: "Presidente Ficticio", position: "Presidente", phone: "600000003"});
  stel.sembrar("assets", {"account-id": c1.id, "address-id": d1.id, name: "Caldera central", brand: "MarcaX", model: "CX-100", "serial-number": "SN-PRUEBA-1", reference: "EQ1"});
  const p1 = stel.sembrar("products", {name: "Termostato digital", reference: "TER-01", "sales-price": 40, "primary-tax-percentage": 21, inactive: false});
  const p2 = stel.sembrar("products", {name: "Tubo multicapa 16 mm (metro)", reference: "TUB-16", "sales-price": 3.2, "primary-tax-percentage": 21, inactive: false});
  const s1 = stel.sembrar("services", {name: "Mano de obra técnico (hora)", reference: "MO", "sales-price": 35, "primary-tax-percentage": 21, inactive: false});
  const s2 = stel.sembrar("services", {name: "Desplazamiento", reference: "DESP", "sales-price": 25, "primary-tax-percentage": 21, inactive: false});
  return {c1, c2, d1, p1, p2, s1, s2};
}
