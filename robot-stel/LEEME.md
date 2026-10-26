# Robot de STEL Order (solo lectura)

Aprobado por el usuario el 2026-10-22 **solo para revisar**: por ahora el robot no modifica nada en STEL.

- `guardia.js`: toda petición del navegador pasa por aquí. Solo GET/HEAD/OPTIONS; en la entrada,
  además, el POST de inicio de sesión. Cualquier otra (guardar, borrar, cambiar) se cancela antes de
  salir. Pruebas: `pruebas/robot-stel.test.js`.
- `explorar.js`: paso 1. Entra con `STEL_WEB_USUARIO` y `STEL_WEB_CLAVE` (variables del entorno,
  nunca en el chat ni en el repositorio), no pulsa botones y deja capturas e informe en una carpeta
  fuera del repositorio. Sirve para construir el paso 2 (lista de obras y obra de cada albarán de
  compra), que se guardará en Supabase para el lector.

Requisitos para ponerlo en marcha (los decide el usuario):
1. Un usuario de STEL solo de consulta para el robot, si STEL lo permite.
2. `STEL_WEB_USUARIO` y `STEL_WEB_CLAVE` en los ajustes del entorno de Claude Code (Editar → variables).
3. Permiso en Claude Code para ejecutar `node robot-stel/…` (el sistema de seguridad de la sesión
   bloquea por defecto la navegación automática en STEL).

Uso actual (sesión recordada en un fichero fuera del repositorio):

```
STEL_WEB_ESTADO=<fichero-sesion.json> STEL_WEB_CODIGO_FICHERO=<fichero-codigo.txt> \
STEL_WEB_VISITAR="#main_proyectos" STEL_WEB_TABLAS="listarProyectosPaginado" \
node robot-stel/explorar.js <carpeta-salida>
```

Si STEL pide el código de verificación, se escribe en `<fichero-codigo.txt>` (el robot espera 14 min).

## Pedidos a proveedor y entregas parciales (regla del usuario, 2026-10-26)

**Por qué:** en STEL, «Más → Generar → Albarán de proveedor» pasa el pedido ENTERO a «Recibido»,
aunque falten líneas, y después no deja generar otro albarán ni cambiar el estado. Si se borra ese
albarán, el pedido vuelve a «Pendiente de recibir».

`pedidos.js` (`decidirEntrega`, pruebas en `pruebas/robot-pedidos.test.js`) calcula lo pendiente
con el pedido y los albaranes anteriores que llevan su PAP, y decide:

| Caso | Cómo se crea el albarán |
|---|---|
| La entrega no completa el pedido | A mano. Lleva «PAPxxxxx» en el título, las observaciones y cada línea; los precios del pedido; la obra del pedido. La Ref. Documento Proveedor es el número del albarán del proveedor. El pedido sigue abierto. |
| La entrega completa lo que falta | Generado desde el pedido, quitando lo ya recibido. El pedido queda «Recibido» y enlazado en «Relacionados». |
| Línea fuera del pedido, más cantidad que la pendiente o pedido ya cerrado | Se para y pasa a revisión. |

Escrituras de STEL que intervienen (solo con autorización y presupuesto contado):
- `guardarProducto` (artículo nuevo);
- `guardarDocumentoComercial` (albarán; al generarlo desde un pedido lleva `idDocumentoComercialPadre`);
- `eliminarDocumentosComerciales` (borrar).

Lecturas añadidas a la guardia: `ListarTipoUnidadFeMEX` e `isDocumentoComercialCerrado`.

El robot entra con un usuario de STEL. Si es el mismo que usa una persona, las sesiones se cierran
entre sí: conviene un usuario de STEL solo para el robot.
