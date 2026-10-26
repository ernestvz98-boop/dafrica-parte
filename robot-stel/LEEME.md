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

## Fase 2: crear en STEL los albaranes leídos (aprobada por el usuario, 2026-10-26)

La web envía cada albarán leído y su PDF a la cola `stel_cola` (orden de `albaranes/cola-stel.js`).
El robot la ejecuta desde la sesión de Claude, con una llave temporal de la cola (la huella va en
`robot_llaves` con caducidad de 12 h; la llave, en un fichero del entorno privado):

```
ROBOT_LLAVE_FICHERO=<llave.txt> node robot-stel/procesar-cola.js preparar <carpeta-privada>
#   → PDF e imágenes de cada albarán + su orden. Claude los compara y escribe aprobados.json:
#     {"<id>": {"aprobado": true}, "<id>": {"aprobado": false, "motivo": "…"}}
STEL_WEB_ESTADO=<sesion.json> node robot-stel/procesar-cola.js ensayo <carpeta-privada> <id>
#   → rellena en STEL SIN guardar (la guardia cancela cualquier escritura) y deja capturas
STEL_WEB_ESTADO=<sesion.json> ROBOT_LLAVE_FICHERO=<llave.txt> node robot-stel/procesar-cola.js crear <carpeta-privada>
```

Por cada albarán aprobado: busca su número en los albaranes de proveedor de STEL (si aparece, se para:
posible duplicado); crea los artículos nuevos de la orden (vuelve a buscar su referencia antes); crea
el albarán A MANO con proveedor, fecha, Ref. Documento Proveedor, obra, título «número fecha obra» y las
líneas (sin precio: 0,00 y «PRECIO PENDIENTE»); adjunta su PDF en «Adjuntos»; y anota en la cola
CREADO, PARADO o ERROR con el motivo. `escritura.js` solo deja salir esas escrituras, una vez cada una
y si coinciden con la orden. Con pedido (PAP) o con varios descuentos en una línea, de momento se para.
Pruebas: `pruebas/robot-escritura.test.js`, `pruebas/robot-cola.test.js`, `pruebas/cola-stel.test.js`.
