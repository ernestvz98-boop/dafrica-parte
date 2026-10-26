import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// DAFRICA · maquina-qr (2026-10-26, revisión de seguridad autorizada por el usuario).
// La página antigua tenía su propio formulario de contraseña, sin verificación en dos pasos. Los QR
// que aún apunten aquí se envían a la web (maquina.html), que pide sesión y código. No lee ni
// escribe nada. Código anterior en respaldo-v7.ts.
const WEB = "https://ernestvz98-boop.github.io/dafrica-parte/maquina.html";
Deno.serve((req: Request) => {
  const entrada = new URL(req.url).searchParams;
  const destino = new URL(WEB);
  for (const k of ["token", "tag"]) {
    const v = entrada.get(k) || "";
    if (/^[A-Za-z0-9_-]{1,128}$/.test(v)) destino.searchParams.set(k, v);
  }
  return new Response(null, { status: 302, headers: { Location: destino.href, "Cache-Control": "no-store" } });
});
