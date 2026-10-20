# Lector · anotaciones manuscritas (códigos de obra y de STEL)

En la oficina se escribe a mano sobre cada albarán:

- **«ABP26 1234»**: número del albarán ya registrado en STEL (serie del año + número);
- **«PRY00123»**: código de obra (proyecto STEL), a veces con el nombre de la obra a mano.

Tesseract no lee cifras manuscritas (medido: ninguna de las 57 anotaciones del corpus real se
lee completa). La segunda fase usa visión **solo sobre recortes** de esas anotaciones.

## Flujo (`albaranes/manuscritos.js`)

1. **Detección en la imagen** (sin servicios externos): página en grises a 75 ppp; se borra el
   texto impreso que el OCR leyó con fiabilidad (solo si tiene altura de texto impreso), las
   rayas largas (conservando los cruces con trazos) y las bandas grises; los trazos restantes se
   agrupan por líneas de escritura de altura parecida; cada zona crece sobre la tinta original
   para recuperar letras borradas; se descartan rótulos gruesos (densidad de tinta > 0,36).
   Máximo 8 recortes por página, de menos de ~30 % del ancho de página.
2. **Visión de recortes** (`albaranes/vision.js` → función Edge `albaranes-manuscritos`):
   transcripción literal, tipo (PRY / ABP / OTRO / ILEGIBLE), tachado y lecturas alternativas
   con su confianza. Nunca precios, cantidades ni importes.
3. **Validación** (`validarCodigos`, `coherenciaLote`). Un código se acepta solo con:
   - formato (PRY + 5 cifras; ABP + año + 4 cifras; prefijo «PRY» parcial admitido si hay 5 cifras);
   - y al menos una evidencia: número de la obra impresa («PISCINAS … 12345» ↔ PRY12345),
     catálogo de obras (cuando exista), albarán STEL del mismo proveedor y número (ABP), o
     el mismo código leído de forma independiente en otro albarán del lote con una palabra de
     obra en común, sin ningún albarán del lote que lo contradiga.
   - Tachados: se ignoran. Dos interpretaciones plausibles sin validar: no se resuelve.
   - Resultado: `{valor, literal, estado, confianza, resolucion:{metodo, evidencias, alternativas}}`.

## Medición en el corpus real (30 albaranes, 57 anotaciones esperadas)

| | Resultado |
|---|---|
| Recortes por página | 2–8 (media ≈ 5) |
| ABP con la anotación completa en algún recorte | 30 / 30 |
| PRY con la anotación completa (o sus 5 cifras) en algún recorte | 25 / 27 (en 2 recortes de Saltoki falta la última cifra) |
| Lectura y validación final | **sin medir**: requiere la función de visión desplegada |

Los valores esperados de los manuscritos (transcritos por Claude a partir de las imágenes, aún
sin confirmar por una persona) están en `pruebas/corpus-real/*.esperado.json` (fuera de git).

## Activación

- 2026-10-21: función `albaranes-manuscritos` **desplegada** con autorización del usuario (solo
  sesión con permiso `costes.ver`; rechaza llamadas sin sesión). La pantalla «Lector local de
  albaranes» (`control-29.js`) la usa automáticamente con la sesión del usuario; se puede
  desactivar con `DafricaAlbaranes.config = {vision: false}`.
- Medición con visión y catálogo: abrir la pantalla con sesión, leer los PDF del corpus,
  «Descargar resultado (JSON)» y ejecutar `node pruebas/evaluar-web.js albaranes.json`
  (compara con `pruebas/corpus-real/*.esperado.json`, fuera de git).

Coste estimado con `gpt-4o` (precios publicados de referencia, a confirmar en la factura real):
≈ 5 recortes por albarán en 1 llamada de hasta 8 imágenes, ~1.500 tokens de entrada y ~300 de
salida → del orden de **0,5–1 céntimo de euro por albarán**. La alternativa sin servicio externo
(un modelo de escritura a mano en el navegador) no es viable aquí: no hay acceso a repositorios de
modelos y el tamaño (> 60 MB) penalizaría la web.
