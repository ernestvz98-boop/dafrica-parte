# DAFRICA Control – Piloto V4 de validación de albaranes

Estado: **piloto independiente, no conectado a las escrituras de producción**.

## Motivo del rediseño

El lote escaneado de Canon contiene diez páginas, diez albaranes y tres proveedores. El resultado de producción fue cuatro albaranes aceptados y seis retenidos en el último intento. La comparación anterior exigía igualdad exacta de descripción, referencia, cantidad y precio en todas las lecturas, lo que bloqueaba filas correctas por diferencias cosméticas y producía errores en recortes fijos.

## Componentes

- `core-validator-v4.mjs`: comparación determinista de la cabecera y las líneas. **No realiza escrituras**.
- `core-validator-v4.test.mjs`: pruebas adversariales de recuentos, cantidades, identificadores, proveedores, fecha, materiales sin código y precios.
- `lote10-ground-truth-v4.json`: hechos visibles de las páginas 2 y 6, contra los que se deben evaluar nuevas lecturas.
- `compras-stel-abp-piloto.ts`: función Edge desplegada como `compras-stel-abp-piloto` (requiere sesión y permiso `costes.ver`). Descarga un PDF archivado, compara dos lecturas del `ABP` manuscrito y consulta STEL por `full-reference`. No cambia facturas, documentos, importes, ni obras.

## Reglas de aceptación

1. El número de albarán es el **impreso por el proveedor**; un identificador manuscrito `ABP` no lo sustituye.
2. El emisor debe ser el proveedor, nunca DAFRICA como destinatario.
3. La fecha requiere pruebas concordantes y nunca se infiere del año actual.
4. El número físico de filas se comprueba sin tomar como autoridad el recuento que invente la IA.
5. Las filas con referencia requieren coincidencia en **referencia y cantidad** de una lectura independiente; la descripción se controla como aviso separado.
6. Los productos **sin referencia** requieren lecturas independientes adicionales y concordancia de descripción/cantidad.
7. **No se incorporan precios ni costes** desde estas lecturas; se espera una factura verificada y una regla de conciliación económica distinta.
8. Un `ABP` solo relaciona un albarán con STEL si el servicio devuelve **una coincidencia exacta**, con proveedor y número externo de documento corroborados.

## Criterios para desplegar como reemplazo

- Prueba de las diez páginas reales, con cero documentos incorrectos aceptados.
- Diez albaranes con números impresos y proveedores correctos; 16 líneas válidas con cantidades correctas.
- Idempotencia: reprocesar el mismo lote no crea albaranes duplicados.
- Auditoría por página y por fila que permita rastrear cada valor al PDF.
- Ejecución sobre un lote más grande, en segundo plano, sin bloquear interfaz.
- Ensayos con documentos previamente facturados y enlace automático de precios SOLO por factura exacta verificada.

## Situación comprobada

La V4 y sus reglas tienen pruebas unitarias adversariales, **pero no han superado una prueba de extracción extremo a extremo con OCR + STEL sobre el lote real**. Mantener esta distinción es una condición para proteger la contabilidad de DAFRICA. 
