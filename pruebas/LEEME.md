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
En pruebas se usa Tesseract nativo (`pruebas/motor-tesseract.js`); en la web se usará
tesseract.js (pendiente de integrar).

| Archivo | Función |
|---|---|
| `albaranes/normalizar.js` | números españoles, descuentos en cascada, fechas |
| `albaranes/nif.js` | NIF/NIE/CIF con dígito de control |
| `albaranes/texto-pdf.js` | texto con coordenadas; detecta DIGITAL/ESCANEADO/MIXTO |
| `albaranes/proveedores.js` | registro de proveedores por NIF y NIF de DAFRICA |
| `albaranes/extraer.js` | cabecera, tabla, cuadres, totales, validaciones, confianza y estado |
| `albaranes/ocr.js` | palabras de OCR → líneas y celdas; enderezado; descarte de márgenes |
| `albaranes/escaneado.js` | varias lecturas OCR por página y combinación validada |
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
