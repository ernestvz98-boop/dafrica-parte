// DAFRICA SAT · función de transcripción: permisos, límites y que nunca se filtra la respuesta del servicio.
import test from "node:test";
import assert from "node:assert/strict";
import {handler} from "../supabase/functions/sat-transcribir/handler.mjs";

const ORIGEN = "https://ernestvz98-boop.github.io";
const env = (extra = {}) => (k) => ({SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon", OPENAI_API_KEY: "clave-ficticia", ...extra})[k];

function peticion({token = "tok", audio = new Blob([new Uint8Array(1000)], {type: "audio/webm"}), metodo = "POST"} = {}) {
  const fd = new FormData();
  if (audio) fd.append("audio", audio, "audio-1.webm");
  return new Request("https://x.supabase.co/functions/v1/sat-transcribir", {method: metodo,
    headers: {origin: ORIGEN, ...(token ? {authorization: "Bearer " + token} : {})}, body: metodo === "POST" ? fd : undefined});
}
function servidor({permisos = ["sat.tecnico"], ia = {status: 200, cuerpo: {text: " Cambio el termostato. "}}} = {}) {
  const llamadas = [];
  const fetcher = async (url, init) => {
    llamadas.push({url: String(url), init});
    if (String(url).endsWith("/rpc/tiene_permiso")) {
      if (init.headers.Authorization !== "Bearer tok") return new Response("{}", {status: 401});
      return new Response(JSON.stringify(permisos.includes(JSON.parse(init.body).permiso_codigo)), {status: 200});
    }
    if (String(url).startsWith("https://api.openai.com/")) return new Response(JSON.stringify(ia.cuerpo), {status: ia.status});
    throw new Error("URL inesperada " + url);
  };
  return {fetcher, llamadas};
}

test("transcribir: técnico de la app de partes → texto; modelo y español; CORS solo de la web", async () => {
  const s = servidor();
  const r = await handler(peticion(), {env: env(), fetcher: s.fetcher});
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), {texto: "Cambio el termostato."});
  assert.equal(r.headers.get("access-control-allow-origin"), ORIGEN);
  const ia = s.llamadas.find((l) => l.url.startsWith("https://api.openai.com/"));
  assert.equal(ia.init.body.get("model"), "gpt-4o-mini-transcribe");
  assert.equal(ia.init.body.get("language"), "es");
  assert.equal(ia.init.headers.Authorization, "Bearer clave-ficticia");
});

test("transcribir: sin sesión, sesión caducada o sin permiso de la app de partes → no llega al servicio", async () => {
  for (const [caso, req, permisos, estado] of [["sin sesión", peticion({token: null}), ["sat.tecnico"], 401],
    ["caducada", peticion({token: "otro"}), ["sat.tecnico"], 401], ["sin permiso", peticion(), ["partes.crear"], 403]]) {
    const s = servidor({permisos});
    const r = await handler(req, {env: env(), fetcher: s.fetcher});
    assert.equal(r.status, estado, caso);
    assert.ok(!s.llamadas.some((l) => l.url.startsWith("https://api.openai.com/")), caso + ": no debe llamar al servicio");
  }
  const admin = servidor({permisos: ["sat.administrar"]});
  assert.equal((await handler(peticion(), {env: env(), fetcher: admin.fetcher})).status, 200, "administración también puede");
});

test("transcribir: audio vacío, sin audio o demasiado grande; error del servicio sin filtrar su respuesta", async () => {
  assert.equal((await handler(peticion({audio: null}), {env: env(), fetcher: servidor().fetcher})).status, 400);
  assert.equal((await handler(peticion({audio: new Blob([])}), {env: env(), fetcher: servidor().fetcher})).status, 400);
  const grande = new Blob([new Uint8Array(25 * 1024 * 1024)]);
  assert.equal((await handler(peticion({audio: grande}), {env: env(), fetcher: servidor().fetcher})).status, 413);
  const s = servidor({ia: {status: 429, cuerpo: {error: {code: "insufficient_quota", message: "Cuenta org-SECRETA sin saldo"}}}});
  const r = await handler(peticion(), {env: env(), fetcher: s.fetcher});
  assert.equal(r.status, 502);
  const d = await r.json();
  assert.match(d.mensaje, /insufficient_quota/);
  assert.doesNotMatch(JSON.stringify(d), /SECRETA/);
  assert.equal((await handler(peticion(), {env: env({OPENAI_API_KEY: ""}), fetcher: servidor().fetcher})).status, 503);
  const op = await handler(new Request("https://x/", {method: "OPTIONS", headers: {origin: "https://otro.example"}}), {env: env(), fetcher: servidor().fetcher});
  assert.equal(op.headers.get("access-control-allow-origin"), null, "otro origen no recibe CORS");
});
