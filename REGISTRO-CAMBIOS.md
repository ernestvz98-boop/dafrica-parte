# Registro de cambios · DAFRICA Control

Cada entrada indica qué cambió, cómo se verificó y si afecta a producción.
Producción = rama `main` (GitHub Pages) y funciones Edge desplegadas en Supabase.

## 2026-10-21 · Lector PDF (Fase 1): PDF grandes, separación, manuscritos y proveedores por huella

**Producción:** sin cambios en esta sesión (rama de trabajo; nada desplegado; sin escrituras en
STEL ni en la base de datos; solo lecturas de metadatos en Supabase). La función
`supabase/functions/albaranes-manuscritos` está en el repositorio pero **no desplegada**.
Incluye la fusión del trabajo paralelo de la rama (bloques PDF, `verificacion.js`,
`compras-catalogo-lectura`, ya desplegada por esa sesión).

- `albaranes/lector.js`: PDF de cualquier tamaño leído página a página (digital, escaneado o
  mixto), separación automática de albaranes (número, CIF, «Página k de n», continuación sin
  totales), errores por página sin detener el resto, cancelación, resumen.
- `motor-navegador.js`: cada página se renderiza solo si necesita OCR y se libera al cerrar su
  albarán (antes se renderizaban todas a 300 ppp a la vez); caché de lecturas por página.
  Comprobado en Chromium con pdf.js + tesseract.js (PDF mixto: 3 albaranes bien separados).
- `control-29.js`: pantalla «Lector local de albaranes» (varios PDF, progreso por bloques,
  errores por lote, tabla consolidada, descarga JSON/CSV; catálogo STEL de solo lectura).
- `albaranes/manuscritos.js` + `vision.js`: detección de anotaciones manuscritas en la imagen
  y validación de códigos de obra/STEL; visión solo de recortes (pendiente de autorización).
  Ver `docs/lector-manuscritos.md`.
- Proveedores sin NIF en claro: los perfiles públicos guardan la huella SHA-256 del CIF.
  Fallo real encontrado: con el registro público (lo que tiene la web) el lector caía al 74,9 %
  con **2 errores críticos** (el CIF de DAFRICA aceptado como emisor). Corregido: huellas, CIF
  de DAFRICA propagado entre lecturas, NIF no registrado siempre en revisión, desempate por
  cercanía al nombre impreso. Ahora 90,3 % y 0 críticos sin registro privado.
- Saltoki: «Ø» restituido tras «PRENSAR» (el OCR lo lee M/Y/W); referencias de 10 cifras
  aceptadas por formato del proveedor + unanimidad de las relecturas.
- Corpus: separación automática evaluada (30/30 albaranes en su sitio); manuscritos esperados
  añadidos (60, no evaluables sin motor de visión); corregido un esperado mío («ceranor»).
- Pruebas: 174 superadas (lector, manuscritos, proveedor por huella, regresiones).
- Medición (30 albaranes, 545 campos): 90,6 % correcto y automático, 0 errores críticos
  (90,3 % solo con perfiles públicos). Objetivo > 95 % aún no alcanzado: ver informe.

## 2026-10-20 · Lector PDF: lote B (20 albaranes reales) y segunda fase automática

**Producción:** sin cambios (rama de trabajo; nada desplegado; sin STEL ni base de datos).
Los PDF, sus resultados esperados y los NIF reales siguen fuera de git (`pruebas/corpus-real/`).
`albaranes/proveedores.js` ya no lleva NIF: se leen del registro privado (`fusionar`).

- Lote B: 2 PDF escaneados, 20 albaranes (9 + 11), 7 proveedores nuevos (formato de número
  y nombres propios por proveedor, sin NIF).
- OCR: orientación automática (páginas de lado o del revés); títulos en blanco sobre banda
  oscura leídos invertidos; rayas de tabla y colas de subrayado fuera del texto; letras
  sueltas del margen descartadas.
- Cabecera: NIF personal (DNI/NIE) no es el emisor; número por formato del proveedor (sin
  etiqueta, tras una serie o con etiqueta propia «SALIDA»); fecha junto al título «ALBARÁN».
- Tabla: columna de código deducida por posición; unidades pegadas a la cantidad (ml, cajas,
  pce); referencia en dos renglones; anotaciones («Obra…», «En almacén…», una palabra suelta
  en la columna de código) fuera de las líneas; abonos (sello «ABONO» o todo negativo).
- Totales: cifra impresa que exige el cálculo (base + cuota = total, base × % = cuota, suma
  de líneas) aunque su etiqueta no se lea; cifras de pie de todas las lecturas OCR;
  relectura casilla a casilla de un pie con bordes que el OCR de página no ve.
- Segunda fase: relectura dirigida de número, fecha, código y descripción dudosos con 6
  estrategias; se resuelve por consenso fiable o unanimidad con validación estructural, y se
  guarda método, confianza, estrategias, evidencias y lectura inicial. Dos lecturas fiables
  distintas → no se resuelve.
- Fallo crítico encontrado y corregido: un código alfanumérico («S» leída «5») aceptado por
  consenso OCR. Los códigos con caracteres confundibles (O/0, S/5, I/1, B/8, Z/2, G/6) ya no
  se aceptan solo por OCR (necesitan validación externa: catálogo).
- Pruebas: 100 superadas (30 regresiones nuevas en `pruebas/lote-b.test.js`, datos ficticios).
- Medición (30 albaranes reales, 543 campos; esperados aún sin confirmar por una persona):
  **0 errores críticos aceptados**; 90,2 % correcto y aceptado automáticamente; 94,8 % con
  el valor correcto; 98,1 % sin contar referencias y descripciones.

## 2026-10-20 · Lector PDF: OCR en el navegador y columnas económicas de Rodavi

**Producción:** sin cambios (rama de trabajo; nada desplegado; sin STEL ni base de datos;
solo lecturas en Supabase para localizar el caso).
- Caso de partida: albarán Rodavi 003424 (subido el 16/10). En la ficha guardada había
  código, descripción y cantidad, pero precio, descuento e importe vacíos. Causa: lo
  procesaron las funciones de IA (`compras-auto-v3`, hoy desactivada, y
  `compras-interpretar-v2`). La primera no tiene campos de descuento ni de importe y anula
  el precio en los albaranes. La segunda solo pide las cifras con geometría fija calibrada
  por posición y exige que dos lecturas de IA coincidan exactamente. Los PDF escaneados
  nunca pasaban por el lector determinista, porque en la web no había OCR.
- Corrección: OCR en el navegador con tesseract.js 5.1.1 y el modelo español servidos
  desde `vendor/tesseract/` (compatible con la CSP de `index.html`; el PDF no sale del
  navegador). `albaranes/motor-navegador.js`; «Interpretar PDF» lo usa para los
  escaneados y, si todo queda verificado, no llama a la IA.
- Lector: títulos ilegibles en la banda gris se deducen por posición (y se marcan); el
  total se contrasta con la suma de líneas × IVA (21/10/4/0 %); el total se toma de otra
  lectura si coinciden; formato de número por proveedor; la casilla de fecha o número se
  relee si las lecturas discrepan; fila de una sola cifra de manuscrito descartada;
  confianza baja para cifras vacías en líneas sin cuadre y para un total no localizado.
- Pruebas: 70 superadas (6 regresiones nuevas, una del caso Rodavi). Evaluador con motores
  `nativo`, `tesseractjs` y `navegador` (páginas renderizadas por pdf.js en Chromium).
- Medición (10 albaranes reales, 158 campos, valores esperados aún sin confirmar por una
  persona): **0 valores erróneos aceptados** con los tres motores; correctos y aceptados
  automáticamente 134 (nativo y tesseractjs) y 130 (navegador real, ~18 s por albarán).

## 2026-10-19 · Lector PDF: albaranes escaneados (OCR) y validación con 10 albaranes reales

**Producción:** sin cambios (rama de trabajo; nada desplegado; sin STEL ni base de datos).
- Nuevo `albaranes/ocr.js` y `albaranes/escaneado.js`: lectura OCR multipasada y
  combinación validada (ver `pruebas/LEEME.md`). Motor de pruebas: Tesseract 5 nativo.
- `albaranes/extraer.js`, fallos encontrados en los 10 albaranes reales y corregidos:
  manuscritos tomados como líneas (y «2op» leído como cantidad 2); unidad pegada solo
  con unidades conocidas; cabecera fusionada con el título «ALBARÁN»; «PRECIO|» y
  «PRECIOUNIDAD»; títulos con una letra mal leída («Descrinción»); motas en la banda de
  títulos; «Entrega en:» y su dirección tomados como artículos; texto girado del margen;
  escaneo inclinado que partía las filas; código y descripción unidos; cifras de la
  descripción enviadas a la columna de cantidad; número y fecha bajo su etiqueta con el
  OCR partiendo la fila; fecha del pie de Saltoki; etiquetas de totales partidas,
  «CuotalVA», base impresa con 4 y 2 decimales; continuaciones y texto previo dudosos
  ahora se marcan para revisión.
- Confianza por campo, línea y documento; los totales cuentan para `AUTO_OK`; una
  cantidad tapada se sugiere al revisor con el cuadre, nunca se asigna.
- Pruebas: `pruebas/ocr.test.js` (13 regresiones con palabras OCR ficticias, una por
  fallo real). Total 64 pruebas superadas; informe sintético sin fallos.
- Evaluador: totales, confianza y aviso por campo, PDF escaneados con varios albaranes.
- Lote real de 10 albaranes (Saltoki, Rodavi, Maderas Pereira; fuera de git): 158 campos,
  134 correctos y aceptados (84,8 %), **0 valores erróneos aceptados**; el resto queda
  marcado para revisión. Valores esperados transcritos por Claude, pendientes de
  confirmación humana.

## 2026-10-19 · Valores STEL confirmados y resolución de artículos

**Producción:** sin escrituras en STEL ni en la base de datos.
- Lecturas (función temporal v6 y v8, ahora desactivada otra vez, v9): series, estados,
  categorías, impuestos, 14.311 albaranes de compra (300 más recientes analizados) y catálogo.
- Confirmado: serie por defecto ABP26 (id 766480), estado inicial «Pendiente de facturar»
  (id 23350), STEL guarda precio 0 (nunca null) en líneas. Detalle en `docs/stel-prueba-controlada.md`.
- `albaranes/articulos.js` (+ 10 pruebas): mapeo guardado → referencia → código de barras →
  descripción normalizada → anti-duplicados → alta; varias coincidencias → `revision_articulo`.
- Propuesta SQL ampliada con la trazabilidad de artículos (no aplicada).

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
