// Emulador LOCAL de Supabase + STEL para probar DAFRICA SAT de punta a punta sin tocar producción.
//   node pruebas/sat/emulador.mjs --puerto 8787 --demo
// Sirve la web (raíz del repositorio), un Supabase mínimo con la MISMA base de datos de la propuesta
// (supabase/propuestas/20261116_sat_partes.sql en PGlite: funciones, permisos, RLS del almacén), la función Edge
// sat-stel real (handler.mjs) contra un STEL falso (pruebas/sat/stel-falso.mjs), y una transcripción de prueba.
// Usuarios de prueba (contraseña «prueba»): tecnico@prueba.local, tecnico2@prueba.local, admin@prueba.local,
// factura@prueba.local. «/__red/caida» y «/__red/ok» simulan la pérdida de conexión de la API.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import {fileURLToPath} from "node:url";
import {PGlite} from "@electric-sql/pglite";
import {ejecutarFicheros} from "../../supabase/tests/ejecutar-local.mjs";
import {handler as satStel} from "../../supabase/functions/sat-stel/handler.mjs";
import {crearStelFalso, sembrarCatalogo} from "./stel-falso.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "../..");
export const SERVICIO = "servicio-local";
export const USUARIOS = [
  {id: "11111111-1111-4111-8111-111111111111", email: "tecnico@prueba.local", nombre: "Técnico de Prueba", rol: "TECNICO_SAT"},
  {id: "22222222-2222-4222-8222-222222222222", email: "tecnico2@prueba.local", nombre: "Segundo Técnico", rol: "TECNICO_SAT"},
  {id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", email: "admin@prueba.local", nombre: "Administración Prueba", rol: "ADMINISTRACION"},
  {id: "ffffffff-ffff-4fff-8fff-ffffffffffff", email: "factura@prueba.local", nombre: "Responsable Facturación", rol: "FACTURACION_SAT"},
];
export const TRANSCRIPCION_PRUEBA = "La caldera no arrancaba y daba error E133. He comprobado la presión del circuito y estaba baja, a medio bar. " +
  "He revisado el electrodo de encendido y estaba sucio. He limpiado el electrodo y he rellenado el circuito hasta un bar y medio. " +
  "He cambiado el termostato, he puesto un termostato digital referencia TER 01. Material: dos metros de tubo multicapa de 16 y tres codos de 16. " +
  "Queda pendiente cambiar la válvula de tres vías, hay que pedir el repuesto.";

const TIPOS = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png",
  ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".ico": "image/x-icon", ".pdf": "application/pdf", ".map": "application/json"};

export async function crearEmulador({puerto = 0, demo = false, registro = () => {}} = {}) {
  const db = new PGlite();
  await ejecutarFicheros(db, [path.join(RAIZ, "supabase/tests/sat_simulado.sql"), path.join(RAIZ, "supabase/propuestas/20261116_sat_partes.sql"),
    path.join(RAIZ, "supabase/propuestas/20261118_sat_precio_hora.sql"), path.join(RAIZ, "supabase/propuestas/20261118_sat_parte_rapido.sql")], {silencioso: true});
  for (const u of USUARIOS) {
    await db.query("insert into public.perfiles (id, nombre, email) values ($1, $2, $3)", [u.id, u.nombre, u.email]);
    await db.query("insert into public.usuario_roles (usuario_id, rol_id) select $1, id from public.roles where codigo = $2", [u.id, u.rol]);
  }
  const tokens = new Map(), refrescos = new Map(), firmasUrl = new Map();
  const dirArchivos = fs.mkdtempSync(path.join(os.tmpdir(), "sat-emulador-"));
  const tipoArchivo = new Map();
  let caida = false;
  let origen = "";
  const stel = crearStelFalso({clave: "clave-falsa"});
  const semilla = sembrarCatalogo(stel);

  // Como PostgREST: el cuerpo JSON se convierte al tipo de cada parámetro de la función.
  const tiposDe = new Map();
  const tipos = async (fn) => {
    if (!tiposDe.has(fn)) {
      const r = await db.query(`select a.n as nombre, format_type(a.t, null) as tipo
        from pg_proc p, unnest(p.proargnames, p.proargtypes::oid[]) as a(n, t) where p.proname = $1 and p.pronamespace = 'public'::regnamespace`, [fn]);
      tiposDe.set(fn, new Map(r.rows.map((x) => [x.nombre, x.tipo])));
    }
    return tiposDe.get(fn);
  };
  const rpc = async (fn, args, {uid = null, servicio = false} = {}) => {
    const t = await tipos(fn);
    const nombres = Object.keys(args || {});
    for (const k of nombres) if (!t.has(k)) throw Object.assign(new Error(`La función ${fn} no tiene el parámetro ${k}`), {code: "42883"});
    const expr = nombres.map((k) => {
      const tipo = t.get(k), ref = `($1::jsonb -> ${"'" + k + "'"})`;
      if (tipo === "jsonb") return `${k} => ${ref}`;
      if (tipo.endsWith("[]")) return `${k} => array(select jsonb_array_elements_text(${ref}))::${tipo}`;
      return `${k} => ($1::jsonb ->> '${k}')::${tipo}`;
    });
    return db.transaction(async (tx) => {
      if (servicio) await tx.query("set local role service_role");
      else { await tx.query("select set_config('prueba.uid', $1, true)", [uid || ""]); await tx.query("set local role authenticated"); }
      const r = nombres.length ? await tx.query(`select public.${fn}(${expr.join(", ")}) as r`, [JSON.stringify(args)])
        : await tx.query(`select public.${fn}() as r`);
      return r.rows[0]?.r ?? null;
    });
  };
  const comoUsuario = (uid, sql, params) => db.transaction(async (tx) => {
    await tx.query("select set_config('prueba.uid', $1, true)", [uid]);
    await tx.query("set local role authenticated");
    return tx.query(sql, params);
  });

  const leerCuerpo = async (req) => { const t = []; for await (const x of req) t.push(x); return Buffer.concat(t); };
  const json = (res, codigo, datos, extra = {}) => {
    res.writeHead(codigo, {"Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra});
    res.end(datos === undefined ? "" : JSON.stringify(datos));
  };
  const quien = (req) => {
    const t = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (t === SERVICIO) return {servicio: true};
    if (tokens.has(t)) return {uid: tokens.get(t)};
    return null;
  };
  const nuevaSesion = (u) => {
    const access = "local." + crypto.randomBytes(18).toString("hex"), refresh = crypto.randomBytes(18).toString("hex");
    tokens.set(access, u.id); refrescos.set(refresh, u.id);
    return {access_token: access, refresh_token: refresh, token_type: "bearer", expires_in: 3600, user: {id: u.id, email: u.email}};
  };
  const rutaArchivo = (nombre) => path.join(dirArchivos, Buffer.from(nombre).toString("base64url"));

  async function atender(req, res) {
    const url = new URL(req.url, "http://x");
    const p = decodeURIComponent(url.pathname);
    if (p === "/__red/caida") { caida = true; return json(res, 200, {caida}); }
    if (p === "/__red/ok") { caida = false; return json(res, 200, {caida}); }
    if (p === "/__estado") return json(res, 200, {caida, stel: {llamadas: stel.estado.llamadas.length,
      albaranes: stel.datos.workDeliveryNotes.length, facturas: stel.datos.ordinaryInvoices.length, incidencias: stel.datos.incidents.length,
      adjuntos: stel.datos.entityAttachments.map((a) => a.name)}});
    if (p.startsWith("/__stel/")) return stel.atender(req, res, p.slice("/__stel/".length));
    // Solo pruebas locales: pdf.js para convertir un PDF en «foto» y PDF de una carpeta privada (variable SAT_PRUEBAS_PDF_DIR).
    if (p.startsWith("/__pruebas/pdfjs/")) {
      const f = path.normalize(path.join(RAIZ, "node_modules/pdfjs-dist/build", p.slice("/__pruebas/pdfjs/".length)));
      if (!f.startsWith(path.join(RAIZ, "node_modules/pdfjs-dist/build")) || !fs.existsSync(f)) return json(res, 404, {error: "no"});
      res.writeHead(200, {"Content-Type": TIPOS[path.extname(f)] || "text/javascript; charset=utf-8"});
      return res.end(fs.readFileSync(f));
    }
    if (p.startsWith("/__pruebas/pdf/") && process.env.SAT_PRUEBAS_PDF_DIR) {
      const dir = path.resolve(process.env.SAT_PRUEBAS_PDF_DIR), f = path.normalize(path.join(dir, path.basename(p)));
      if (!f.startsWith(dir) || !/\.(pdf|json)$/.test(f) || !fs.existsSync(f)) return json(res, 404, {error: "no"});
      res.writeHead(200, {"Content-Type": f.endsWith(".pdf") ? "application/pdf" : "application/json"});
      return res.end(fs.readFileSync(f));
    }
    const esApi = /^\/(auth|rest|storage|functions)\/v1\//.test(p) || p === "/transcribir";
    if (esApi && caida) { req.socket.destroy(); return; }

    // ---- Autenticación
    if (p === "/auth/v1/token" && req.method === "POST") {
      const b = JSON.parse((await leerCuerpo(req)).toString() || "{}");
      if (url.searchParams.get("grant_type") === "password") {
        const u = USUARIOS.find((x) => x.email === String(b.email || "").toLowerCase());
        if (!u || b.password !== "prueba") return json(res, 400, {error: "invalid_grant", error_description: "Invalid login credentials"});
        return json(res, 200, nuevaSesion(u));
      }
      const uid = refrescos.get(b.refresh_token);
      if (!uid) return json(res, 400, {error: "invalid_grant"});
      refrescos.delete(b.refresh_token);
      return json(res, 200, nuevaSesion(USUARIOS.find((x) => x.id === uid)));
    }
    if (p === "/auth/v1/user") {
      const q = quien(req);
      if (!q?.uid) return json(res, 401, {message: "invalid JWT"});
      const u = USUARIOS.find((x) => x.id === q.uid);
      return json(res, 200, {id: u.id, email: u.email});
    }
    if (p === "/auth/v1/logout") return json(res, 204);

    // ---- Funciones de la base de datos (como PostgREST)
    const m = p.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/);
    if (m && req.method === "POST") {
      const q = quien(req);
      if (!q) return json(res, 401, {code: "PGRST301", message: "JWT inválido"});
      const args = JSON.parse((await leerCuerpo(req)).toString() || "{}");
      try { return json(res, 200, await rpc(m[1], args, q)); }
      catch (e) {
        const codigo = e.code === "42501" ? 403 : e.code === "42883" ? 404 : 400;
        return json(res, codigo, {code: e.code, message: e.message, details: null, hint: null});
      }
    }

    // ---- Almacén (como Supabase Storage)
    const ms = p.match(/^\/storage\/v1\/object\/(sign\/)?sat-archivos\/(.+)$/);
    if (ms) {
      const nombre = ms[2];
      if (ms[1] && req.method === "GET") {
        const f = firmasUrl.get(url.searchParams.get("token"));
        if (!f || f.nombre !== nombre || f.caduca < Date.now() || !fs.existsSync(rutaArchivo(nombre))) return json(res, 400, {statusCode: "404", error: "not_found"});
        res.writeHead(200, {"Content-Type": tipoArchivo.get(nombre) || "application/octet-stream"});
        return res.end(fs.readFileSync(rutaArchivo(nombre)));
      }
      const q = quien(req);
      if (!q) return json(res, 400, {statusCode: "403", error: "Unauthorized", message: "invalid JWT"});
      const visible = async () => q.servicio || (await comoUsuario(q.uid, "select 1 from storage.objects where bucket_id = 'sat-archivos' and name = $1", [nombre])).rows.length > 0;
      if (ms[1] && req.method === "POST") {
        const b = JSON.parse((await leerCuerpo(req)).toString() || "{}");
        if (!(await visible())) return json(res, 400, {statusCode: "404", error: "not_found", message: "Object not found"});
        const t = crypto.randomBytes(16).toString("hex");
        firmasUrl.set(t, {nombre, caduca: Date.now() + (Number(b.expiresIn) || 60) * 1000});
        return json(res, 200, {signedURL: `/object/sign/sat-archivos/${nombre.split("/").map(encodeURIComponent).join("/")}?token=${t}`});
      }
      if (req.method === "POST") {
        const cuerpo = await leerCuerpo(req);
        try {
          if (q.servicio) await db.query("insert into storage.objects (bucket_id, name) values ('sat-archivos', $1) on conflict do nothing", [nombre]);
          else await comoUsuario(q.uid, "insert into storage.objects (bucket_id, name) values ('sat-archivos', $1)", [nombre]);
        } catch (e) {
          if (e.code === "23505") return json(res, 409, {statusCode: "409", error: "Duplicate", message: "The resource already exists"});
          return json(res, 403, {statusCode: "403", error: "Unauthorized", message: "new row violates row-level security policy"});
        }
        fs.writeFileSync(rutaArchivo(nombre), cuerpo);
        tipoArchivo.set(nombre, req.headers["content-type"] || "application/octet-stream");
        return json(res, 200, {Key: "sat-archivos/" + nombre});
      }
      if (req.method === "GET") {
        if (!(await visible()) || !fs.existsSync(rutaArchivo(nombre))) return json(res, 400, {statusCode: "404", error: "not_found"});
        res.writeHead(200, {"Content-Type": tipoArchivo.get(nombre) || "application/octet-stream"});
        return res.end(fs.readFileSync(rutaArchivo(nombre)));
      }
    }

    // ---- Función Edge sat-stel (el código real) contra el STEL falso
    if (p === "/functions/v1/sat-stel") {
      const cuerpo = req.method === "POST" ? await leerCuerpo(req) : undefined;
      const peticion = new Request(origen + p, {method: req.method, headers: req.headers, body: cuerpo});
      const env = (k) => ({SUPABASE_URL: origen, SUPABASE_SERVICE_ROLE_KEY: SERVICIO, SUPABASE_ANON_KEY: "anon-local", STEL_API_KEY: "clave-falsa",
        STEL_BASE: origen + "/__stel/app/", SAT_ORIGENES: origen})[k];
      const r = await satStel(peticion, {env, dormir: () => Promise.resolve()});
      res.writeHead(r.status, Object.fromEntries(r.headers));
      return res.end(Buffer.from(await r.arrayBuffer()));
    }

    // ---- Transcripción de prueba (sustituye al servicio real)
    if (p === "/transcribir" && req.method === "POST") {
      if (!quien(req)?.uid) return json(res, 401, {mensaje: "Sin sesión"});
      const b = await leerCuerpo(req);
      if (b.length < 50) return json(res, 400, {mensaje: "Audio vacío"});
      return json(res, 200, {texto: TRANSCRIPCION_PRUEBA});
    }

    // ---- Ficheros de la web
    if (p === "/") { res.writeHead(302, {Location: "/sat/"}); return res.end(); }
    let f = path.normalize(path.join(RAIZ, p));
    if (!f.startsWith(RAIZ) || f.includes(`${path.sep}node_modules${path.sep}`) || f.includes(`${path.sep}.git`)) return json(res, 404, {error: "no"});
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
    if (!fs.existsSync(f)) return json(res, 404, {error: "No existe"});
    res.writeHead(200, {"Content-Type": TIPOS[path.extname(f).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-cache"});
    return res.end(fs.readFileSync(f));
  }

  const servidor = http.createServer((req, res) => {
    atender(req, res).catch((e) => { registro(e); try { json(res, 500, {error: e.message}); } catch {} });
  });
  await new Promise((r) => servidor.listen(puerto, "127.0.0.1", r));
  origen = `http://127.0.0.1:${servidor.address().port}`;
  stel.estado.baseUrl = origen; // las facturas del STEL falso enlazan su PDF en este mismo servidor

  const emulador = {
    origen, db, stel, semilla, rpc,
    cerrar: async () => {
      servidor.closeAllConnections?.();
      await new Promise((r) => servidor.close(r));
      await db.close();
      fs.rmSync(dirArchivos, {recursive: true, force: true});
    },
    entrar: async (email) => {
      const r = await fetch(origen + "/auth/v1/token?grant_type=password", {method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({email, password: "prueba"})});
      return (await r.json()).access_token;
    },
  };
  if (demo) {
    try { await prepararDemo(emulador); }
    catch (e) { await emulador.cerrar(); throw e; }
  }
  return emulador;
}

/** Datos de demostración: catálogo copiado del STEL falso, servicios configurados y dos avisos para el técnico. */
export async function prepararDemo(e) {
  const admin = await e.entrar("admin@prueba.local");
  const h = {Authorization: "Bearer " + admin, apikey: "anon-local", "Content-Type": "application/json"};
  const llamar = async (ruta, cuerpo) => {
    const r = await fetch(e.origen + ruta, {method: "POST", headers: h, body: JSON.stringify(cuerpo)});
    const t = await r.text();
    if (!r.ok) throw new Error(ruta + " " + r.status + " " + t);
    return t ? JSON.parse(t) : null;
  };
  await llamar("/functions/v1/sat-stel", {accion: "catalogo"});
  await llamar("/rest/v1/rpc/sat_ajuste_guardar", {p_clave: "stel_servicio_mano_obra_id", p_valor: e.semilla.s1.id});
  await llamar("/rest/v1/rpc/sat_ajuste_guardar", {p_clave: "stel_servicio_desplazamiento_id", p_valor: e.semilla.s2.id});
  await llamar("/rest/v1/rpc/sat_ajuste_guardar", {p_clave: "transcripcion_url", p_valor: e.origen + "/transcribir"});
  const cat = await llamar("/rest/v1/rpc/sat_catalogo", {});
  const cli = cat.clientes.find((c) => c.stel_id === e.semilla.c1.id);
  const dir = cat.direcciones.find((d) => d.cliente_id === cli.id);
  const con = cat.contactos.find((d) => d.cliente_id === cli.id);
  const eq = cat.equipos.find((d) => d.cliente_id === cli.id);
  const tec = USUARIOS[0].id;
  await llamar("/rest/v1/rpc/sat_aviso_guardar", {p: {id: crypto.randomUUID(), motivo: "La caldera central no arranca", prioridad: "URGENTE",
    cliente_id: cli.id, direccion_id: dir.id, contacto_id: con.id, equipo_id: eq.id, cliente_texto: cli.nombre, direccion_texto: dir.texto,
    contacto_texto: con.nombre, equipo_texto: eq.nombre, tecnico_id: tec}});
  const cli2 = cat.clientes.find((c) => c.stel_id === e.semilla.c2.id);
  await llamar("/rest/v1/rpc/sat_aviso_guardar", {p: {id: crypto.randomUUID(), motivo: "Revisión anual de la cámara frigorífica", prioridad: "NORMAL",
    cliente_id: cli2.id, cliente_texto: cli2.nombre, tecnico_id: tec}});
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf("--puerto");
  const e = await crearEmulador({puerto: i > 0 ? Number(process.argv[i + 1]) : 8787, demo: process.argv.includes("--demo"), registro: console.error});
  console.log(`DAFRICA SAT · emulador local en ${e.origen}/sat/`);
  console.log("Usuarios (contraseña «prueba»): " + USUARIOS.map((u) => u.email).join(", "));
  console.log(`Simular sin conexión: ${e.origen}/__red/caida · volver: ${e.origen}/__red/ok`);
}
