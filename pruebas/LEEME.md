# Lector determinista de albaranes · pruebas y precisión (P0)

## Qué hace

`albaranes/` lee **PDF digitales** sin IA: toma el texto exacto que contiene el
PDF (pdf.js), lo coloca por coordenadas en filas y columnas y devuelve, para
cada campo, el **texto literal impreso**, el valor normalizado y un estado:

| Estado | Significado |
|---|---|
| `VERIFICADO` | leído y confirmado por el cuadre cantidad × precio × (1 − dto) = importe |
| `OK` | leído sin ambigüedad, sin cuadre disponible (p. ej. albarán sin precios) |
| `REVISAR` | leído, pero una comprobación no cuadra; el valor no se acepta |
| `AMBIGUO` / `INVALIDO` / `VACIO` | sin valor (`null`); nunca se inventa |

Cada campo, cada línea y el documento llevan además una `confianza` de 0 a 1. Un
documento queda `AUTO_OK` solo si el proveedor (por NIF registrado), el número, la
fecha, todas las líneas y los totales están aceptados con confianza ≥ 0,9 y todas las
validaciones se cumplen.

**PDF escaneados (OCR).** `albaranes/escaneado.js` lee cada página varias veces con
Tesseract (segmentaciones psm 4/6/3, binarización adaptativa Sauvola para rótulos sobre
fondo gris, relectura de la banda de la tabla, de cabecera y pie, y de casillas de fecha
o número tapadas por una firma) y solo combina lo que valida: cifras de línea que
cuadran, totales con base + IVA = total, cabecera en la que coinciden las lecturas.
Además: enderezado de escaneos torcidos, descarte de manuscritos y del texto girado de
los márgenes, y sugerencia (nunca asignación) de una cantidad tapada a partir del cuadre.
En la web el OCR se ejecuta en el propio navegador con tesseract.js 5.1.1 y el modelo
español de `vendor/tesseract/` (servidos desde el sitio, sin servicios externos; el PDF no
sale del navegador): `albaranes/motor-navegador.js`. La pantalla «Interpretar PDF» lo usa
para los PDF escaneados antes de la IA. En pruebas hay dos motores con la misma interfaz:
`pruebas/motor-tesseract.js` (Tesseract nativo) y `pruebas/motor-tesseractjs.js` (el mismo
motor y modelo que la web): `npm run evaluar -- --motor=tesseractjs`.

| Archivo | Función |
|---|---|
| `albaranes/normalizar.js` | números españoles, descuentos en cascada, fechas |
| `albaranes/nif.js` | NIF/NIE/CIF con dígito de control |
| `albaranes/texto-pdf.js` | texto con coordenadas; detecta DIGITAL/ESCANEADO/MIXTO |
| `albaranes/proveedores.js` | registro de proveedores por NIF y NIF de DAFRICA |
| `albaranes/extraer.js` | cabecera, tabla, cuadres, totales, validaciones, confianza y estado |
| `albaranes/ocr.js` | palabras de OCR → líneas y celdas; enderezado; descarte de márgenes |
| `albaranes/escaneado.js` | varias lecturas OCR por página y combinación validada |
| `albaranes/motor-navegador.js` | pdf.js + tesseract.js en el navegador (misma interfaz que el motor de pruebas) |
| `vendor/tesseract/` | tesseract.js 5.1.1 y modelo `spa` (Apache-2.0), servidos desde el propio sitio |
| `control-28.js` | integración en la pantalla «Interpretar albaranes (sin guardar)» |

## Ejecutar las pruebas

```bash
npm install            # solo dependencias de desarrollo: pdf-lib y pdfjs-dist 4.10.38
npm test               # pruebas automáticas
npm run evaluar -- --sinteticos   # informe en pruebas/informes/precision-sintetico.md
```

El corpus sintético (`pruebas/sinteticos.js`) genera los PDF al ejecutarse; usa
empresas y NIF ficticios. `comparar.test.js` altera lecturas correctas para
demostrar que el evaluador detecta valores erróneos aceptados.

## Corpus real (documentos autorizados)

**El repositorio es público: nunca subas albaranes reales ni sus resultados.**
`pruebas/corpus-real/` y `pruebas/informes-reales/` están en `.gitignore`.

1. Copia los PDF autorizados en `pruebas/corpus-real/`.
2. Genera los borradores: `npm run plantilla -- pruebas/corpus-real/*.pdf`
3. Una persona revisa cada `*.esperado.json` contra el papel, corrige los
   valores, añade en `marcados` los campos que el lector debe dejar para revisión
   (ilegibles o realmente ambiguos) y pone `"revisado_por_persona": true`.
4. Opcional: `pruebas/corpus-real/registro.json` con NIF reales:
   ```json
   {"empresa_propia":{"nifs":["NIF DE DAFRICA"]},
    "proveedores":[{"id":"SALTOKI","nifs":["NIF IMPRESO"],"formato_confirmado":true}]}
   ```
5. `npm run evaluar` → `pruebas/informes-reales/precision-real.md` y `.json`.
   El informe incluye la tabla campo a campo: valor esperado, valor extraído,
   resultado, confianza y el aviso del lector. `--incluir-sin-revisar` evalúa también
   resultados esperados aún no confirmados (el informe lo advierte).

Un PDF escaneado con un albarán por página lleva `"escaneado": true` y
`"documentos": [{"pagina": 1, "proveedor_nif": …, "numero": …, "fecha": …,
"totales": {…}, "lineas": […]}, …]`. Requiere `pdftoppm` y `tesseract` (idioma `spa`).
Un importe impreso con dos precisiones se expresa como lista: `[48.00, 48.0004]`.

El proceso termina con código 1 si algún valor erróneo se aceptó como bueno.

Opciones de `npm run evaluar`: `--motor=nativo|tesseractjs|navegador` (motor OCR) e
`--incluir-sin-revisar`. Un campo cuyo valor esperado no se puede confirmar en el papel va en
`inciertos` del esperado y no cuenta en las métricas. `pruebas/lote-b.test.js` reproduce con
datos ficticios cada fallo real del lote B (`pruebas/ayudas-ocr.js` construye las palabras).

## PDF largos en la pantalla temporal

`albaranes/lotes-pdf.js` prepara PDF internos de hasta 10 páginas con una página
compartida (1–10, 10–19, 19–28…). La página compartida permite unir un documento
que continúa al otro lado del corte. Se valida cobertura exacta por bloque antes
de acumular nada. No se deduplica por número de albarán: se unen exclusivamente
los documentos con una página física compartida; las identidades contradictorias
bloquean la aceptación. Después se reconstruye cada documento con sus páginas
originales una sola vez y se interpreta secuencialmente con el lector existente.

Los fallos de separación quedan asociados a su rango de páginas. Los documentos
cercanos a una frontera fallida no se aceptan como completos; los demás continúan.
La pantalla muestra resultados incrementales y un resumen final único, con los
fallos visibles. Los PDF separados se descartan después de interpretar cada
documento y se cierra el trabajador OCR. El PDF original y las lecturas permanecen
en RAM hasta abandonar la pantalla. No se añade persistencia ni operaciones STEL.

`pruebas/lotes-pdf.test.js` genera PDF de 11, 20, 25 y 50 páginas, comprueba orden,
cobertura sin duplicados, continuidad entre bloques, fallos parciales, separación
inválida/contradictoria, liberación y conexión de la pantalla con los caminos
digital y OCR (estos últimos con dobles de prueba). Las 100 pruebas anteriores
permanecen intactas. Total: 111 pruebas; evaluación sintética: 0 fallos críticos.

Límites de la comprobación: no se han invocado servicios de producción ni usado
albaranes privados. El código de las Edge Functions no está en este repositorio;
su restricción de 10 páginas se evita preparando las peticiones en el navegador.
Un bloque con imágenes muy grandes puede superar límites de tamaño del servicio:
se notifica como fallo parcial. Un único albarán muy largo se reconstruye entero
para conservar sus validaciones y puede requerir más memoria que un bloque.
La exactitud de la separación externa y de OCR/IA sobre documentos reales sigue
necesitando validación con corpus autorizado. No se garantiza cero errores en
producción a partir de pruebas sintéticas. La nueva carga de pdf-lib usa el CDN
cdnjs permitido por la CSP; requiere conexión, igual que pdf.js.

## Regresión de escaneos girados y perfiles sin NIF privado

Corrección posterior al ensayo con un PDF autorizado de 11 páginas escaneadas de
lado (el archivo, imágenes y lecturas quedan fuera del repositorio):

- Un perfil público sin NIF no se confunde con un CIF contradictorio. Se utiliza
  su formato, conservando `NIF_NO_REGISTRADO`, confianza inferior a 0,9 y bloqueo
  de `AUTO_OK`. Un CIF configurado contradictorio o registrado en otro proveedor
  sigue bloqueado.
- Un número partido por OCR como `2026 /1234` conserva el sufijo contiguo; no se
  unen cifras alejadas. Se conserva la confianza más baja de ambas partes.
- La copia enviada a geometría/IA recibe la orientación detectada por OCR. Solo
  se usan número/fecha locales como pistas si están OK con confianza >= 0,9.
- La lectura OCR local parcial se muestra abierta con sus advertencias; la IA
  queda como comparación. Una fila de baja confianza deja de llamarse «Correcta».

Verificación local del PDF real: 19 líneas recuperadas en las páginas con tabla,
18 con cuadre y una sin precios. La página manuscrita no produce una tabla local
fiable; códigos y descripciones de baja confianza siguen marcados. Esto no es una
certificación de exactitud completa ni una prueba del proveedor externo de IA.
Se utiliza el motor Tesseract.js y modelo de la web, con rasterización Poppler;
la rasterización del navegador puede generar diferencias y requiere una nueva
prueba de extremo a extremo en la web publicada.

Total tras estas regresiones: 118 pruebas aprobadas; evaluación sintética: cero
fallos críticos aceptados. Los casos públicos usan valores ficticios. No se
invocan servicios de producción durante las pruebas automáticas.

## Comprobación automática sin intervención por documento

El botón ejecuta separación, orientación, relecturas dirigidas y ampliadas,
cuadres y contraste de lectura local/IA. Cuando el separador agrupa varias
páginas, se revisan sus cabeceras: distinto número/fecha/CIF separa documentos;
continuidad sin prueba suficiente impide aceptar automáticamente el grupo.

`albaranes/verificacion.js` contrasta CIF y referencia/descripción contra
catálogos completos recibidos de `compras-catalogo-lectura`. Esta función nueva
solo permite GET sobre `suppliers` y `products` de STEL; exige sesión válida y
permiso `costes.ver`. La única llamada POST a Supabase es la consulta de permisos
existente `mis_permisos`. No usa service-role, no recibe PDF y no guarda nada.
Devuelve únicamente id, CIF/nombre y referencia/descripción, sin precios.

La paginación continúa hasta una respuesta vacía (no presupone que una página
corta sea el final). Páginas repetidas, errores y límites se declaran incompletos.
El catálogo se consulta una vez por ejecución y solo existe en memoria.

Una referencia se valida si el código fue observado en OCR y existe una única
coincidencia con descripción equivalente en el catálogo completo. No se crean
variantes por sustituciones O/0 inventadas. No se rellenan precios o cantidades
a partir del catálogo ni se elimina ningún descuadre. Un dato no resuelto tras
las comprobaciones termina como «No resuelto automáticamente», sin aprobación
manual ni creación en STEL. La anotación PRY se muestra como candidato literal;
no confirma ni asigna una obra.

Regresión real con pdf.js 4.10.38 + Tesseract.js y el modelo de la web: se
reproduce el descuento omitido de un escaneo y se recupera el porcentaje impreso
por relectura ampliada. El ensayo de las 11 páginas recupera 19 artículos (18 con
cuadre, uno sin precios); sigue sin haber una tabla fiable en la página manuscrita.
Se confirma por cabeceras la separación de los dos últimos albaranes. Las imágenes
se generan con pdf.js y canvas de Node: los resultados deben contrastarse también
con el navegador del usuario. No se han enviado documentos privados a los tests
públicos ni a nuevos servicios.

Validación: 143 pruebas aprobadas y evaluación sintética con cero fallos críticos.
Incluye autorización, ausencia de escrituras, paginación incompleta, CIF duplicado,
artículos ambiguos, descuadres, discrepancias IA/OCR, separación y conservación de
ceros del PRY. El contraste con los catálogos REALES requiere la sesión autorizada
de la aplicación; las pruebas de esta fase usan catálogos ficticios. No se afirma
haber verificado el catálogo real ni haber conseguido lectura perfecta del manuscrito.

## Lector completo, manuscritos y registro público

- `node pruebas/evaluar.js --incluir-sin-revisar` lee cada PDF del corpus con
  `albaranes/lector.js` (separación automática incluida) y compara cada albarán esperado con el
  documento leído en sus mismas páginas; una separación distinta cuenta como error.
- `--sin-registro-privado`: evalúa solo con los perfiles públicos (huellas del CIF, sin NIF en
  claro), que es lo que tiene la web. Debe dar también 0 errores críticos.
- Manuscritos: `"manuscritos": {"obra": "PRY…", "stel": "ABP26-…"}` en cada albarán esperado.
  Sin motor de visión se informan aparte («sin evaluar»). Diseño en `docs/lector-manuscritos.md`.
- `pruebas/lector.test.js` (separación, PDF de 120 páginas, errores, cancelación, mixtos),
  `pruebas/manuscritos.test.js` y `pruebas/proveedor.test.js` usan datos ficticios.

## Lectura de la web (con visión y catálogo)

La visión de recortes y el catálogo STEL de solo lectura exigen la sesión de un usuario con
permiso `costes.ver`, así que se miden desde la web: pantalla «Lector local de albaranes» →
leer los PDF del corpus → «Descargar resultado (JSON)» → `node pruebas/evaluar-web.js
albaranes.json`. Mismo informe que `evaluar.js` (`pruebas/informes-reales/precision-web.md`).

Cada documento leído lleva `estado_documento`: **AUTO_OK** (todo verificado), **REVISAR** (algún
campo para revisión) o **ERROR_DOCUMENTO** (página dañada o nada reconocible, en su posición del
PDF). `resumen.paginas_completas` comprueba que cada página está en exactamente un documento, en
orden (sin pérdidas, duplicados ni desorden entre bloques).

## PDF de estrés (1, 10, 25 y 54 páginas)

Fuera de git, en `pruebas/corpus-real/estres/`: PDF montados con páginas escaneadas reales del
corpus y PDF digitales sintéticos intercalados (mixtos), con un albarán de dos páginas, una página
escaneada en blanco y páginas repetidas en orden inverso. `manifiesto.json` indica qué páginas
forman cada albarán. Se comprueba, con el lector completo:

- en Node, que la separación coincide con el manifiesto, que cada página está en exactamente un
  documento y en orden (`resumen.paginas_completas`), y que cada albarán da el mismo resultado
  que leído por separado;
- en Chromium real (pdf.js + tesseract.js), cargando los 4 PDF a la vez en la pantalla «Lector
  local de albaranes» y descargando el JSON: misma separación, mismos estados AUTO_OK /
  REVISAR / ERROR_DOCUMENTO y precisión de los albaranes reales con `evaluar-web.js`.
