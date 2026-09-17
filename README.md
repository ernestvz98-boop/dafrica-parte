# DAFRICA Parte v0.2

## Qué cambia
- Grabar audio desde el navegador.
- Detener y reproducir la grabación antes de cerrar.
- Alternativa para subir un audio ya grabado.
- Fotos y audio se guardan en IndexedDB junto con el borrador.
- Al recargar, el programa intenta recuperar texto, audio y fotografías.
- Validación: no deja cerrar sin obra, fecha, encargado y audio/notas.

## Cómo probar
1. Descomprime el ZIP.
2. Abre index.html con Chrome o Edge.
3. Selecciona obra y encargado.
4. Pulsa "Empezar grabación".
5. Acepta el permiso del micrófono.
6. Habla unos segundos y pulsa "Detener".
7. Reproduce el audio.
8. Añade 2 fotos.
9. Pulsa "Guardar borrador".
10. Recarga la página y comprueba si recupera audio y fotos.

## Importante
Algunos navegadores pueden bloquear el micrófono cuando un HTML se abre directamente desde el disco (file://).
Si ocurre, no significa que la app esté mal: la solución será ejecutar esta misma carpeta desde localhost.
La opción "Subir un audio ya grabado" seguirá sirviendo para probar el flujo.
