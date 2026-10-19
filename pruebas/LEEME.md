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

Un documento queda `AUTO_OK` solo si el proveedor (por NIF registrado), el número,
la fecha y todas las líneas están aceptados y todas las validaciones se cumplen.
Los PDF escaneados devuelven `NO_DIGITAL` sin ningún dato (OCR: fase P1).

| Archivo | Función |
|---|---|
| `albaranes/normalizar.js` | números españoles, descuentos en cascada, fechas |
| `albaranes/nif.js` | NIF/NIE/CIF con dígito de control |
| `albaranes/texto-pdf.js` | texto con coordenadas; detecta DIGITAL/ESCANEADO/MIXTO |
| `albaranes/proveedores.js` | registro de proveedores por NIF y NIF de DAFRICA |
| `albaranes/extraer.js` | cabecera, tabla, cuadres, validaciones y estado |
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

El proceso termina con código 1 si algún valor erróneo se aceptó como bueno.
