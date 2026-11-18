/*
 * DAFRICA SAT · transcripción del audio del técnico (2026-11-18).
 * El servicio anterior (/transcribir de DAFRICA Parte) solo deja transcribir a quien tiene los permisos de «partes» de
 * la aplicación antigua; los técnicos de la app de partes no los tienen. Esta función exige `sat.tecnico` o
 * `sat.administrar` (comprobado con la sesión del propio usuario) y usa la clave de OpenAI que ya está en el servidor
 * (`OPENAI_API_KEY`, el mismo servicio y modelo que DAFRICA Parte). No guarda el audio ni el texto: solo los devuelve.
 *
 * POST multipart/form-data con el campo `audio` y la sesión en Authorization. Respuesta: {texto}.
 */
const ORIGENES = ["https://ernestvz98-boop.github.io"];
const MAX_BYTES = 24 * 1024 * 1024;
const MODELO = "gpt-4o-mini-transcribe";

const cabecerasCors = (origen) => ({
  "Access-Control-Allow-Origin": origen,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
});

export async function handler(req, {env, fetcher = fetch} = {}) {
  const origen = req.headers.get("origin") || "";
  const permitidos = [...ORIGENES, ...(env("SAT_ORIGENES") || "").split(",").map((s) => s.trim()).filter(Boolean)];
  const cors = permitidos.includes(origen) ? cabecerasCors(origen) : {};
  const responder = (datos, estado = 200) => new Response(JSON.stringify(datos), {status: estado,
    headers: {...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store"}});
  if (req.method === "OPTIONS") return new Response(null, {status: 204, headers: cors});
  if (req.method !== "POST") return responder({mensaje: "Método no permitido"}, 405);

  const base = env("SUPABASE_URL") || "", anon = env("SUPABASE_ANON_KEY") || "", claveIa = env("OPENAI_API_KEY") || "";
  if (!base || !anon) return responder({mensaje: "Configuración incompleta"}, 503);
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return responder({mensaje: "Sin sesión"}, 401);

  // Permiso, con la sesión del propio usuario (tiene_permiso usa auth.uid()).
  const puede = async (permiso) => {
    const r = await fetcher(`${base}/rest/v1/rpc/tiene_permiso`, {method: "POST", signal: AbortSignal.timeout(15000),
      headers: {apikey: anon, Authorization: "Bearer " + token, "Content-Type": "application/json"}, body: JSON.stringify({permiso_codigo: permiso})});
    if (r.status === 401) throw Object.assign(new Error("Sesión no válida"), {status: 401});
    if (!r.ok) throw Object.assign(new Error("No se pudo comprobar el permiso"), {status: 502});
    return (await r.json()) === true;
  };
  try {
    if (!(await puede("sat.tecnico")) && !(await puede("sat.administrar"))) return responder({mensaje: "Sin permiso de la app de partes"}, 403);
  } catch (e) {
    return responder({mensaje: e.status === 401 ? "La sesión ha caducado: vuelve a entrar." : e.message}, e.status || 502);
  }
  if (!claveIa) return responder({mensaje: "Falta la clave del servicio de transcripción en el servidor"}, 503);

  let audio;
  try { audio = (await req.formData()).get("audio"); } catch { return responder({mensaje: "Envío no válido"}, 400); }
  if (!audio || typeof audio === "string") return responder({mensaje: "No se recibió ningún audio"}, 400);
  if (!audio.size) return responder({mensaje: "El audio está vacío"}, 400);
  if (audio.size > MAX_BYTES) return responder({mensaje: "El audio es demasiado largo: graba varios más cortos"}, 413);

  const fd = new FormData();
  fd.append("file", audio, audio.name || "audio.webm");
  fd.append("model", env("SAT_MODELO_TRANSCRIPCION") || MODELO);
  fd.append("language", "es");
  let r;
  try {
    r = await fetcher("https://api.openai.com/v1/audio/transcriptions", {method: "POST", signal: AbortSignal.timeout(120000),
      headers: {Authorization: "Bearer " + claveIa}, body: fd});
  } catch {
    return responder({mensaje: "El servicio de transcripción no responde; el audio queda guardado"}, 502);
  }
  const t = await r.text();
  let d = {};
  try { d = JSON.parse(t); } catch { /* respuesta no JSON */ }
  if (!r.ok) {
    // Nunca se devuelve la respuesta entera (podría llevar datos de la cuenta): solo el tipo de error.
    const tipo = d?.error?.code || d?.error?.type || `HTTP ${r.status}`;
    return responder({mensaje: `No se pudo transcribir (${tipo})`}, 502);
  }
  return responder({texto: typeof d.text === "string" ? d.text.trim() : ""});
}
