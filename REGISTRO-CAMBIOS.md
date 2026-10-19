# Registro de cambios · DAFRICA Control

Cada entrada indica qué cambió, cómo se verificó y si afecta a producción.
Producción = rama `main` (GitHub Pages) y funciones Edge desplegadas en Supabase.

## 2026-10-19 · Regla de precios pendientes y diseño de creación de albaranes en STEL

**Producción:** sin escrituras en STEL ni en la base de datos.
- `albaranes/precios.js` (+ `pruebas/precios.test.js`): líneas `precio_pendiente`,
  resolución por prioridad pedido → artículo STEL → factura recibida → revisión, sin
  estimar nunca; trazabilidad `precio_original`, `precio_utilizado`, `fuente_precio`,
  `fecha_resolucion_precio`; validación de importes antes de facturar.
- `docs/stel-creacion-albaranes.md`: estados `pendiente_creacion_stel` → `creado_stel` →
  `pendiente_vincular_obra` → `obra_vinculada` / `error`; campos que exige un
  `purchaseDeliveryNote` (deducidos de 500 albaranes reales); mapeo de proveedores y artículos.
- `supabase/propuestas/20261019_albaranes_stel.sql`: modelo de datos propuesto, **no aplicado**.
- Análisis de solo lectura: `claude-prueba-permisos` v4 (agregados, sin importes ni textos)
  ejecutada una vez; v5 la deja de nuevo desactivada (HTTP 410). **Pendiente:** borrarla.

## 2026-10-19 · Diagnóstico de lectura de la API de STEL

**Producción:** sin escrituras en STEL ni en la base de datos.
- `claude-prueba-permisos` se redesplegó (v2) como diagnóstico temporal de solo lectura:
  `GET ?limit=1` y `OPTIONS` sobre rutas fijas, salida limitada a códigos HTTP y nombres
  de campos, caducidad automática. Se ejecutó una vez.
- Resultado: autenticación con `STEL_API_KEY` correcta. Detalle en `docs/stel-api.md`.
- Después se redesplegó (v3) como función desactivada (siempre HTTP 410, sin acceso a
  secretos). **Pendiente:** borrarla desde el panel de Supabase.

## 2026-10-19 · Prueba de permisos de escritura en Supabase (producción)

**Producción:** queda una tabla de prueba vacía de datos reales, pendiente de borrar.
- Conector nuevo `Dafrica_Supabase`: usuario `postgres`, sin solo lectura.
- Escritura SQL: correcta (tabla temporal; sin efecto persistente).
- Crear y modificar tablas: correcto. Se creó `public._claude_prueba_permisos`
  (1 fila de prueba). El `DROP` posterior no se ejecutó: las sentencias destructivas
  esperan una confirmación que no llegó (tiempo agotado a los 60 s).
  Mitigación aplicada: RLS activado y permisos revocados a `anon` y `authenticated`.
  **Pendiente:** `drop table public._claude_prueba_permisos;`
- `apply_migration`: dos intentos agotaron el tiempo (incluían `DROP`); no se
  registró ninguna migración (siguen 57) ni quedó ningún objeto.
- Despliegue de funciones Edge: bloqueado por los permisos de la sesión de Claude Code.
  No se desplegó nada; las 17 funciones siguen sin cambios.
- Storage: lectura de buckets y configuración correcta; no se modificó nada.
- (Revisión posterior) Red abierta a Supabase y STEL. Desplegada la función de prueba
  `claude-prueba-permisos` (solo responde `{ok:true}`, exige JWT; no accede a datos):
  responde HTTP 200. **Pendiente:** borrarla desde el panel (Edge Functions) cuando se desee.

## 2026-10-19 · Lector determinista de albaranes (P0) · rama `claude/gifted-mendel-1hrahr`

**Producción:** sin cambios (nada fusionado en `main`, nada desplegado en Supabase).

### Añadido
- `albaranes/`: lectura sin IA de PDF digitales (texto exacto + coordenadas), con
  literal impreso, valor y estado por campo; proveedor por NIF; DAFRICA nunca es emisor;
  cuadre de líneas, total de líneas y suma de importes. Escaneados → `NO_DIGITAL`.
- `control-28.js` + cambios en `control-27.js`/`index.html`: los PDF digitales
  AUTO_OK no llaman a la IA en la pantalla «Interpretar albaranes (sin guardar)».
- `pruebas/`: corpus sintético, pruebas de mutación del evaluador, informe de
  precisión por campo y herramientas para el corpus real (excluido de git).

### Corregido tras pruebas (segunda iteración)
- Una fila de artículo con las palabras «ARTÍCULO … CANTIDAD … UD» se tomaba por
  cabecera repetida y se perdía en silencio. Ahora una celda que mezcla títulos y texto
  no es cabecera, y toda cabecera repetida queda registrada.
- «(BOLSA 100)»: «100)» se tomaba por número y truncaba la descripción. Un texto no
  numérico ya no puede caer en una columna numérica.
- «ALBARAN N. 7700123» no se leía: se saltan los restos de etiqueta («N.», «Nº», «:»).

### Nuevas capacidades
- Dos columnas de descuento (Dto 1 / Dto 2) aplicadas en cascada.
- Columnas desconocidas (Lote, % IVA, Pedido…) se reconocen como columnas propias
  y sus valores no contaminan las columnas vecinas.
- Cantidad con unidad impresa («8,00 UD», «20 SAC»).
- Etiqueta genérica «Nº» / «Número» cuando no hay ninguna con «albarán».
- Cabecera y filas escritas por el ERP como un único texto (reparto por posición);
  esas filas solo se aceptan si el cuadre lo confirma.

### Verificación
- `npm test`: 33/33 pruebas superadas.
- `npm run evaluar -- --sinteticos`: 14/14 documentos en el estado esperado,
  0 valores erróneos aceptados (`pruebas/informes/precision-sintetico.md`).
- Ejecución en Chromium con pdf.js 4.10.38 (la misma versión que carga la web).
