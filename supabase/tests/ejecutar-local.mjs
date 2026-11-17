// Prueba las propuestas de Supabase en un Postgres EN MEMORIA (PGlite), nunca en producción. Ejecuta los
// ficheros como psql: sentencia a sentencia (cada una en su transacción), con \set y \ir.
// Alternativa a ejecutar-local.sh cuando no hay un Postgres instalado (Windows):
//   npm i --no-save @electric-sql/pglite@0.3.8
//   node supabase/tests/ejecutar-local.mjs supabase/tests/autorizacion_automatica.sql
import {PGlite} from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

export function leer(f) {
  return fs.readFileSync(f, "utf8").replace(/^﻿/, "").split(/\r?\n/).map(l => {
    if (/^\\set\b/.test(l)) return "";
    const m = l.match(/^\\ir\s+(.+)$/);
    return m ? leer(path.resolve(path.dirname(f), m[1].trim())) : l;
  }).join("\n");
}
// Divide en sentencias respetando comillas, $etiqueta$ y comentarios.
export function sentencias(sql) {
  const out = []; let i = 0, ini = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "-" && sql[i + 1] === "-") { i = sql.indexOf("\n", i); if (i < 0) i = sql.length; continue; }
    if (c === "'") { i++; while (i < sql.length && !(sql[i] === "'" && sql[i + 1] !== "'")) i += sql[i] === "'" ? 2 : 1; i++; continue; }
    if (c === "$") { const m = sql.slice(i).match(/^\$[A-Za-z_]*\$/); if (m) { const fin = sql.indexOf(m[0], i + m[0].length); i = fin + m[0].length; continue; } }
    if (c === ";") { out.push(sql.slice(ini, i + 1)); ini = i + 1; }
    i++;
  }
  if (sql.slice(ini).trim()) out.push(sql.slice(ini));
  return out.filter(s => s.replace(/--.*$/gm, "").trim() && s.trim() !== ";");
}

export async function ejecutarFicheros(db, ficheros, {silencioso = false} = {}) {
  for (const f of ficheros) {
    let ult = null;
    for (const s of sentencias(leer(f))) {
      try { const r = await db.exec(s); ult = r.at(-1)?.rows?.[0] ?? ult; }
      catch (e) { throw new Error("ERROR en " + path.basename(f) + ": " + e.message + "\n  en: " + s.trim().slice(0, 300)); }
    }
    if (!silencioso) console.log("OK  " + path.basename(f) + (ult ? "  → " + JSON.stringify(ult) : ""));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ficheros = process.argv.slice(2);
  if (!ficheros.length) ficheros.push(path.join(path.dirname(fileURLToPath(import.meta.url)), "autorizacion_automatica.sql"));
  try { await ejecutarFicheros(new PGlite(), ficheros); }
  catch (e) { console.log(e.message); process.exit(1); }
}
