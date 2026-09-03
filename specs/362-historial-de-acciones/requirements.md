# 362 — Historial de acciones · requirements

> Zona: `fullstack` · Complejidad: `alta` · Rama: `feature/362-historial-de-acciones`
> Pedido humano (2026-09-02): «es importante guardar estas cosas en el historial que se muestra
> en la navegación del maestro, sería un nuevo módulo que muestre el historial de acciones en la
> app». Y después: «obviamente esto debe usar el componente que ya tenemos de búsqueda y filtros».

## Qué problema resuelve

Hoy **no hay forma de saber quién hizo qué**. El caso literal: el 2026-09-02 se borraron **79
órdenes** y no quedó ni una línea de rastro — `EliminarOrdenService` lo dice por escrito («borrar
no es transicionar») y no escribe nada. Lo mismo con aprobar o rechazar un cierre, registrar un
pago, mover plata en la caja, cambiar una tarifa (que además **borra en físico**: la fila
desaparece y con ella el precio que estuvo vigente) y activar, desactivar o cambiar el rol de un
usuario.

Lo que sí existe es el patrón: `orden_historial_estado` (`db/schema.prisma:2115`) guarda filas
**inmutables** —sin `updated_at` ni `deleted_at`— con actor, clasificación e instante. **Este
módulo es eso, extendido a acciones que no son transiciones de una orden.**

**No va por logs**, y la decisión está cerrada: los del servidor rotan, no se filtran desde la app
y meter datos ahí los saca de sus reglas de retención. Un módulo que se consulta necesita tabla.

## Alcance

**Entra:** la tabla append-only, el punto único de escritura transaccional, los **40 tipos de
acción del Anexo A** con sus 40 puntos de escritura, y el módulo de lectura (pantalla + descarga)
colgado del apartado «Histórico» que ya existe en la navegación.

**No entra, y con motivo:**

- **Las transiciones de estado de una orden.** Ya tienen su historial, con actor y clasificación
  (`orden_historial_estado`, 799 filas/día medidas). Duplicarlas aquí ahogaría el módulo.
- **Los asientos contables automáticos.** Los 34 movimientos de wallet/día son en su mayoría la
  *consecuencia* de aprobar un cierre, no una decisión de nadie: se registra **la decisión** (≈5/día),
  no sus asientos. Los movimientos ya son inmutables y consultables en `/wallet`.
- **Las gestiones del mensajero** (115/día): mueven dinero, pero son el trabajo normal del turno y
  ya tienen módulo propio; anular una gestión ya deja actor en dos sitios
  (`gestion_orden.anulada_por` y `origen_tipo = deshacer_gestion`).
- **La corrección del día de reparto**: ya tiene tabla propia inmutable con actor (`orden_dia_reparto_cambio`).
- **La corrección de los datos del cliente** (fichas 312/327): hoy **no deja rastro por decisión
  humana declarada** del 2026-08-28, vigilada por `tests/unit/guards/corregir-datos-sin-rastro.guardia.test.ts`.
  Ver **Q1** en Preguntas abiertas: esa decisión hay que reabrirla o mantenerla, pero no se toca aquí.
- **Los intentos de acceso** (`login_attempt`): ya existen, y son cientos al día.
- **Versionar las tarifas** (guardar el precio anterior campo a campo): es otra feature. Ver **Q3**.

---

# Requisitos

## A. La fila: qué se guarda y qué nunca

**R1** — CUANDO el sistema registre una acción, DEBE escribir **una fila por entidad afectada**
con: tipo de acción, tipo de entidad, identificador de la entidad, etiqueta legible de la entidad,
identificador del actor, nombre del actor, rol del actor, identificador de lote e instante.
*Mutación: escribir una sola fila para un borrado de N órdenes → el caso «se borran 3 y el registro
tiene 3 filas» → rojo.*

**R2** — El registro DEBE ser **inmutable**: el sistema NO DEBE ofrecer ninguna operación que
modifique ni que borre una fila ya escrita, y la tabla NO DEBE tener columna de modificación ni de
borrado lógico.
*Mutación: añadir `updated_at` al modelo, o exponer un `update`/`delete` en el repositorio → la
guardia de forma de la tabla → rojo.*

**R3** — El sistema DEBE **congelar en la fila** el nombre y el rol del actor tal como eran en el
instante de la acción, y NO DEBE derivarlos de la fila viva del usuario al leer.
*Mutación: pintar el nombre resolviendo `usuario` al leer → el caso «al actor se le cambia el rol
después de la acción; la fila vieja sigue diciendo el rol de entonces» → rojo.*

**R4** — El sistema DEBE **congelar en la fila** una etiqueta legible de la entidad afectada, y esa
etiqueta DEBE seguir estando disponible aunque la entidad ya no exista.
*Mutación: resolver la etiqueta por join al leer → el caso «se borra una tarifa (borrado físico) y
su fila del registro sigue diciendo de qué tarifa se trataba» → rojo.*

**R5** — El registro NO DEBE contener el nombre, el teléfono, la dirección ni el correo del
destinatario de una orden, **ni ningún texto libre escrito por un usuario**.
*Mutación: añadir una columna `motivo` alimentada por el motivo de rechazo de un cierre → la
guardia de vocabulario prohibido sobre los puntos de escritura → rojo.*

**R6** — DONDE la acción mueva **un importe único**, el sistema DEBE congelarlo en la fila con
precisión decimal exacta, y NO DEBE representarlo con un número de coma flotante en ningún punto
del camino (base, servicio, contrato de salida ni pantalla).
*Mutación: `Number(monto)` en el DTO, o `Float` en la columna → la guardia money-safe → rojo.*

**R7** — CUANDO una acción afecte a varias entidades a la vez, todas sus filas DEBEN llevar el
**mismo identificador de lote**, y ese identificador DEBE ser distinto del de cualquier otra acción.
*Mutación: generar el identificador de lote por fila → el caso «un borrado de 3 órdenes produce 3
filas con un solo lote» → rojo.*

**R8** — El registro DEBE ser accesible **únicamente por el rol de servicio** de la base: RLS
habilitada y sin políticas, como `orden_historial_estado`, `cierre_dia` y `wallet_movimiento`.
*Mutación: no emitir el `ENABLE ROW LEVEL SECURITY` en la migración → el test de integración que lo
consulta en `pg_class` → rojo.*

## B. Atomicidad: no puede haber una sin la otra

**R9** — CUANDO una acción del Anexo A se complete, su fila de registro DEBE haberse escrito en la
**misma transacción** que la escritura de la acción.
*Mutación: mover el registro a una llamada posterior fuera de la transacción → la guardia
estructural que exige `appendAccion` dentro del callback de `$transaction` del método escritor → rojo.*

**R10** — SI la escritura del registro falla, ENTONCES la acción NO DEBE persistir.
*Mutación: envolver el registro en un `try/catch` que se lo trague → el test de integración que
fuerza el fallo del registro y cuenta 0 filas mutadas → rojo.*

**R11** — SI la escritura de la acción falla, o no alcanza ninguna fila, ENTONCES NO DEBE quedar
ninguna fila de registro.
*Mutación: escribir el registro antes de comprobar el resultado de la mutación → el caso «el
`updateMany` devuelve 0 y el registro queda vacío» → rojo.*

**R12** — CUANDO una acción por lote alcance **menos** entidades de las pedidas, el sistema DEBE
escribir exactamente una fila por entidad **efectivamente alcanzada**, y ninguna por las demás.
*Mutación: construir las entradas con los ids PEDIDOS en vez de con los devueltos por la escritura
→ el caso «una orden del lote ya estaba borrada: se registran 2 de 3» → rojo.*

**R13** — Toda fila del registro DEBE escribirse por un **único punto de escritura**.
*Mutación: insertar en la tabla desde un repositorio cualquiera → la guardia que prohíbe nombrar la
tabla o el delegado de Prisma fuera del punto único → rojo.*

## C. Qué se registra: catálogo cerrado

**R14** — El sistema DEBE registrar **exactamente** los tipos de acción del **Anexo A** y ninguno más.
*Mutación: añadir un tipo al enum sin añadirlo al Anexo → la guardia de censo → rojo.*

**R15** — El catálogo de tipos DEBE ser una **unión cerrada**: un valor fuera de ella DEBE
rechazarse en el borde, sin ejecutar consulta.
*Mutación: cambiar el `z.enum` por `z.string()` → el caso «un tipo inventado en el filtro devuelve
`validation_error`» → rojo.*

**R16** — Cada tipo del catálogo DEBE tener **al menos un punto de escritura que lo produzca**.
*Mutación: declarar un tipo sin productor → la guardia de cobertura → rojo.*

**R17** — El sistema DEBE clasificar cada tipo en **exactamente una** de las tres categorías del
criterio (mueve dinero / hace desaparecer algo / cambia quién puede hacer qué), y esa clasificación
DEBE **derivarse** del catálogo, no almacenarse en la fila.
*Mutación: añadir una columna `categoria` a la tabla → la guardia de forma de la tabla → rojo.
Segunda mutación: dejar un tipo sin categoría → el test de exhaustividad del mapa → rojo.*

## D. Quién lo ve

**R18** — MIENTRAS el actor no tenga uno de los roles con acceso al apartado «Histórico», el
sistema DEBE responder «no encontrado» a la ruta del módulo, y NO DEBE ejecutar **ninguna** consulta
del módulo.
*Mutación: mover el gate por debajo de la primera lectura → la aserción
`expect(servicio).not.toHaveBeenCalled()` para cada rol denegado y para la sesión ausente → rojo.*

**R19** — El ítem de navegación y el gate de la ruta DEBEN leer la **misma** declaración de roles.
NO DEBE existir una segunda lista, ni escribirse ningún literal de rol en la página.
*Mutación: sustituir la constante por `["maestro","admin"]` en la página → la guardia de fuente
única, con su contraprueba → rojo.*

**R20** — El módulo DEBE aparecer en la navegación como una entrada del apartado **«Histórico» ya
existente**, y NO DEBE cambiar el destino post-login de ningún rol.
*Mutación: colocarlo como ítem propio en la cabecera del menú → el test que afirma con `toEqual` el
aterrizaje de cada rol → rojo.*

**R21** — La pantalla del módulo NO DEBE ofrecer ninguna operación de escritura.
*Mutación: importar cualquier Server Action que mute → la guardia de solo-lectura (precedente
321/R24) → rojo.*

## E. Lectura: orden y paginación

**R22** — El sistema DEBE resolver el listado **entero en el servidor**, paginado: para los mismos
filtros y el mismo actor, NO DEBE seleccionar, ordenar ni recortar filas en el navegador.
*Mutación: traer todo y cortar con `.slice()` en el cliente → el test que afirma que la acción
devuelve `pageSize` filas y un `total` mayor → rojo.*

**R23** — El orden del listado DEBE ser **total**: dos filas que compartan instante DEBEN quedar
siempre en el mismo orden relativo.
*Mutación: quitar el desempate del `orderBy` → los casos de recorrido de páginas → rojo.*

**R24** — CUANDO se recorran todas las páginas de un mismo conjunto, ninguna fila DEBE repetirse y
ninguna DEBE faltar, **incluso cuando muchas filas compartan instante**.
*Mutación: quitar el desempate → el caso con un lote de ≥120 filas nacidas en la misma transacción
y páginas de 25 → rojo. (Es el defecto medido de la 352: 200 filas distintas de 241.)*

**R25** — CUANDO se pida dos veces la misma página del mismo conjunto, el sistema DEBE devolver
exactamente las mismas filas en el mismo orden.
*Mutación: quitar el desempate → el caso «la misma página dos veces» → rojo.*

**R26** — El orden por defecto DEBE ser **el más reciente primero**, y el sistema DEBE admitir
invertirlo. Un campo o una dirección fuera de la lista blanca DEBE dar `validation_error` sin
ejecutar consulta.
*Mutación: cambiar el defecto a ascendente → el caso del defecto → rojo. Segunda: aceptar
`sortBy` libre → el caso de la unión cerrada → rojo.*

**R27** — La caché del cliente DEBE distinguir dos peticiones que solo difieran en el ordenamiento.
*Mutación: omitir la clave de orden en la clave de SWR → el test de la clave → rojo.*

## F. Búsqueda y filtros

**R28** — El módulo DEBE usar la **barra de búsqueda y filtros compartida** (`BuscadorFiltros` +
`FilterComponent`) y NO DEBE montar una barra propia.
*Mutación: escribir un `<input>` de búsqueda en el módulo → la guardia que exige que el módulo
importe la barra compartida y no declare campo propio → rojo.*

**R29** — El sistema DEBE ofrecer filtros por **actor**, por **tipo de acción**, por **categoría**,
por **tipo de entidad** y por **fecha**.
*Mutación: retirar uno del selector → el test que afirma con `toEqual` las claves ofrecidas → rojo.*

**R30** — CUANDO haya filtros aplicados, el conjunto que produce la descarga DEBE ser **el mismo
conjunto filtrado** que la pantalla, resuelto en el servidor.
*Mutación: descargar sin aplicar el filtro vigente → el caso «filtrado por actor, la descarga trae
solo las de ese actor» → rojo.*

**R31** — El término de búsqueda libre DEBE alcanzar **exactamente** los datos que su placeholder
enumera, y ninguno más.
*Mutación: ensanchar la búsqueda a un campo no anunciado → el caso que busca por ese campo y espera
0 resultados → rojo.*

**R32** — SI el término de búsqueda no alcanza el mínimo de caracteres, ENTONCES el sistema NO DEBE
ejecutar la consulta con él.
*Mutación: escribir el mínimo a mano en el control en vez de leerlo de la constante del borde → el
test que compara control y borde contra la misma fuente → rojo.*

**R33** — El acotamiento por rol del conjunto de la descarga DEBE ser **el mismo** que el de la
pantalla: ninguna fila que el actor no pueda ver en pantalla DEBE aparecer en el archivo.
*Mutación: saltarse el gate en la acción de descarga → el caso de rol denegado sobre la descarga → rojo.*

## G. Qué se muestra por fila

**R34** — Cada fila DEBE decir **quién**, **qué**, **sobre qué** y **cuándo** sin necesidad de abrir
nada.
*Mutación: quitar la columna «sobre qué» → el test de montaje que afirma las columnas → rojo.*

**R35** — El instante DEBE mostrarse en la zona horaria de Costa Rica.
*Mutación: formatear en UTC → el caso de una fila escrita a las 23:30 CR → rojo.*

**R36** — SI la fila no tiene actor, ENTONCES DEBE mostrarse como acción del **sistema**, y NO DEBE
mostrarse en blanco ni como un identificador.
*Mutación: pintar `""` cuando el actor es nulo → el caso de la fila sin actor → rojo.*

**R37** — DONDE la fila tenga importe, DEBE mostrarse con el formato de dinero de la casa.
*Mutación: pintar el string crudo → el test de formato → rojo.*

**R38** — La descarga NO DEBE contener identificadores internos (uuid) ni ninguna columna de la
lista negra de datos sensibles.
*Mutación: añadir la columna `entidad_id` al módulo de columnas → `tests/unit/descarga/columnas-sensibles.guardia.test.ts` → rojo.*

## H. Crecimiento

**R39** — El sistema NO DEBE ofrecer ninguna purga, caducidad ni archivado del registro.
*Mutación: añadir un job de purga → la guardia que barre `lib/services/jobs/**` en busca de un
borrado sobre esta tabla → rojo.*

**R40** — El listado DEBE resolverse sin recorrido secuencial completo de la tabla para las tres
consultas del módulo: la primera página por fecha, «todo lo de un actor» y «qué le pasó a esta
entidad».
*Mutación: quitar uno de los tres índices → el test de integración que pide el plan (`EXPLAIN`) y
exige que no sea un `Seq Scan` sobre un corpus sembrado → rojo.*

---

# Anexo A — El catálogo: qué se registra, quién lo escribe y cuánto pesa

**Criterio, tal como lo fijó el humano:** entra lo que **mueve dinero**, lo que **hace desaparecer
algo** y lo que **cambia quién puede hacer qué**.

**40 tipos, producidos desde 40 puntos de escritura.** Todos los puntos están **confirmados en el
archivo real** (no en el índice del grafo).

Frecuencias: **medido** = dato de producción que trae la ficha; **est.** = estimación derivada de
un anclaje medido; **sin medir** = no hay dato y no se inventa uno.

## A.1 · Mueve dinero (23 tipos)

| # | Tipo | Punto de escritura (Server Action) | Entidad | Frecuencia |
|---|---|---|---|---|
| 1 | `cierre_dia_aprobado` | `cierres-admin.aprobarCierre` | `cierre_dia` | **~5/día (medido)** |
| 2 | `cierre_dia_rechazado` | `cierres-admin.rechazarCierre` | `cierre_dia` | <1/día (est.) |
| 3 | `cierre_dia_pagos_editados` | `cierres-admin.actualizarPagosGestion` | `gestion_orden` | sin medir |
| 4 | `cierre_bodega_aprobado` | `cierre-bodega.aprobarCierreBodega` | `cierre_bodega` | <1/día (est.) |
| 5 | `cierre_bodega_rechazado` | `cierre-bodega.rechazarCierreBodega` | `cierre_bodega` | <1/día (est.) |
| 6 | `pago_mensajero_registrado` | `liquidacion.registrarPagoMensajeroAction` | `liquidacion_pago` | ~5/día (est.: uno por cierre aprobado) |
| 7 | `pago_tienda_registrado` | `liquidacion.registrarPagoTiendaAction` | `liquidacion_pago` | sin medir |
| 8 | `pago_anulado` | `liquidacion.anularPagoAction` | `liquidacion_pago` | <1/día (est.) |
| 9 | `reparto_mensajero_registrado` | `liquidacion.registrarRepartoMensajeroAction` | `liquidacion_reparto` | <1/día (est.) |
| 10 | `reparto_anulado` | `liquidacion.anularRepartoAction` | `liquidacion_reparto` | <1/día (est.) |
| 11 | `wallet_movimiento_manual_registrado` | `wallet.registrarMovimientoManualAction` | `wallet_movimiento` | <1/día (est.) |
| 12 | `egreso_administrativo_registrado` | `wallet-egresos.registrarEgresoAdministrativoAction` | `wallet_movimiento` | sin medir |
| 13 | `egreso_administrativo_reversado` | `wallet-egresos.reversarEgresoAdministrativoAction` | `wallet_movimiento` | <1/día (est.) |
| 14 | `tarifa_creada` | `tarifas.crearTarifa` | `tarifas` | <1/día (est.) |
| 15 | `tarifa_actualizada` | `tarifas.actualizarTarifa` | `tarifas` | <1/día (est.) |
| 16 | `incidente_aprobado` | `incidentes.aprobarIncidente` | `orden_incidente` | <1/día (est.) |
| 17 | `incidente_rechazado` | `incidentes.rechazarIncidente` | `orden_incidente` | <1/día (est.) |
| 18 | `cobro_gasto_fijo_aprobado` | `gasto-fijo-cobro.aprobarCobroGastoFijoAction` | `gasto_fijo_cobro` | <1/día (est.) |
| 19 | `cobro_gasto_fijo_rechazado` | `gasto-fijo-cobro.rechazarCobroGastoFijoAction` | `gasto_fijo_cobro` | <1/día (est.) |
| 20 | `cobro_rechazo_tienda_aprobado` | `rechazo-tienda-cobro.aprobarCobroRechazoTiendaAction` | `rechazo_tienda_cobro` | sin medir |
| 21 | `cobro_rechazo_tienda_rechazado` | `rechazo-tienda-cobro.rechazarCobroRechazoTiendaAction` | `rechazo_tienda_cobro` | sin medir |
| 22 | `premio_ranking_registrado` | `premio-ranking-devengo.registrarPremioAction` | `ranking_snapshot_fila` | 0–3/día (est.: el podio) |
| 23 | `premio_ranking_anulado` | `premio-ranking-devengo.anularPremioAction` | `ranking_snapshot_fila` | <1/día (est.) |

## A.2 · Hace desaparecer algo (6 tipos)

| # | Tipo | Punto de escritura | Entidad | Frecuencia |
|---|---|---|---|---|
| 24 | `orden_eliminada` | `eliminar-orden.eliminarOrdenes` **y** `app/api/ordenes/api-key/orden/[id]/route.ts` | `orden` | **~79/día (medido el 2026-09-02)** |
| 25 | `orden_recuperada` | `recuperar-orden.recuperarOrdenes` | `orden` | <1/día (est.) |
| 26 | `tarifa_borrada` | `tarifas.borrarTarifa` | `tarifas` | <1/día (est.) — **borrado FÍSICO: irrecuperable** |
| 27 | `zona_borrada` | `zonas.borrarZona` | `zona` | <1/mes (est.) — **físico, y arrastra sus tarifas en cascada** |
| 28 | `vehiculo_borrado` | `vehiculos.borrarVehiculo` | `vehiculo` | <1/mes (est.) |
| 29 | `plantilla_eliminada` | `plantillas.eliminarPlantilla` | `plantilla_mensaje` | <1/mes (est.) |

## A.3 · Cambia quién puede hacer qué (11 tipos)

| # | Tipo | Punto de escritura | Entidad | Frecuencia |
|---|---|---|---|---|
| 30 | `usuario_creado` | `usuarios.crearUsuario` | `usuario` | <1/día (est.) |
| 31 | `usuario_rol_cambiado` | `usuarios.actualizarUsuario` (solo si cambia `rolId`) | `usuario` | <1/día (est.) |
| 32 | `usuario_zona_cambiada` | `usuarios.actualizarUsuario` (solo si cambia `zonaId`) | `usuario` | <1/día (est.) |
| 33 | `usuario_estado_cambiado` | `usuarios.cambiarEstadoUsuario` | `usuario` | <1/día (est.) |
| 34 | `usuario_contrasena_restablecida` | `usuarios.restablecerContrasenaUsuario` | `usuario` | <1/día (est.) |
| 35 | `postulacion_aprobada` | `aprobacion-postulaciones.aprobarPostulacion` | `usuario` | <1/día (est.) |
| 36 | `postulacion_rechazada` | `aprobacion-postulaciones.rechazarPostulacion` | `usuario` | <1/día (est.) |
| 37 | `api_key_generada` | `api-keys.generarApiKey` | `api_key` | <1/mes (est.) |
| 38 | `api_key_rotada` | `api-keys.rotarApiKey` | `api_key` | <1/mes (est.) |
| 39 | `api_key_activada` | `api-keys.activarApiKey` | `api_key` | <1/mes (est.) |
| 40 | `api_key_desactivada` | `api-keys.desactivarApiKey` | `api_key` | <1/mes (est.) |

## A.4 · El total, y la corrección al presupuesto

La estimación del encargo era **~40-50 filas/día**. Contados los eventos, **no sale ese número**:

- categoría dinero: **~20 filas/día**;
- categoría permisos: **~5 filas/día**;
- categoría desaparición: **~80 filas/día**, y **prácticamente todo es `orden_eliminada`**.

**Total: ~105 filas/día en un día como el 2026-09-02** (≈38.000/año). Si los 79 borrados de ese día
fueron atípicos y lo normal es un puñado, el total baja a **~30 filas/día** (≈11.000/año).

**En los dos escenarios el módulo es consultable** (11k–38k filas/año), así que el criterio se
sostiene. Pero hay dos consecuencias que **sí cambian el diseño** y no estaban en el presupuesto:

1. **Los borrados de órdenes son ~3 de cada 4 filas.** Un maestro que abra el módulo verá una pared
   de borrados. Por eso la fila lleva **identificador de lote** (R7): 79 borrados de un solo acto se
   distinguen de 79 actos distintos, y el filtro por categoría/tipo permite apartarlos.
2. **Las filas de un mismo lote comparten instante al milisegundo** (nacen del mismo
   `CURRENT_TIMESTAMP` de la transacción). Es exactamente el defecto que midió la 352 —440 de 909
   órdenes compartiendo instante, 200 filas distintas de 241 al paginar—, agravado aquí porque el
   empate es la norma y no la excepción. De ahí R23–R25.

## A.5 · Lo que el criterio deja fuera y el maestro podría echar de menos

- **Corregir la dirección o el distrito de una orden** (fichas 312/327). **Mueve dinero**: el
  distrito re-deriva la zona, y la zona decide la tarifa que se factura. Hoy **no deja rastro por
  decisión humana** del 2026-08-28 (D4 de la 312), con guardia que lo vigila. → **Q1**.
- **Cambiar `fulfillment` a una tienda** (`usuarios.actualizarUsuario`): mueve dinero (activa un
  cobro de bodega). No entra en A.3 porque no cambia lo que la persona *puede hacer*. → **Q2**.
- **El valor anterior de una tarifa**: se pierde al sobrescribir y este registro no lo reconstruye
  (R5 prohíbe volcados libres). → **Q3**.

---

# Preguntas abiertas

**Q1 — La corrección de datos del cliente cambia lo que se factura y hoy no deja rastro, a
propósito.** El 2026-08-28 se cerró que corregir un dato del cliente **no** deja rastro (D4 de la
312), y hay una guardia que lo hace cumplir. Pero la 327 amplió esa corrección a la **dirección y el
distrito**, y el distrito re-deriva la zona, que decide el flete facturado. O sea: hoy se puede
cambiar lo que una orden va a cobrar sin dejar quién ni cuándo. **¿Se reabre esa decisión para
registrar aquí un `orden_ubicacion_corregida` (solo el hecho: quién, qué orden, cuándo — nunca el
dato)?** Recomendación del spec: sí, porque el motivo de D4 era proteger datos personales y esta
fila no guardaría ninguno. **No se implementa sin respuesta**: revertir una decisión humana de hace
cinco días no es cosa de un spec.

**Q2 — ¿Entra `fulfillment` en el catálogo?** Cambiarlo a una tienda activa un cobro periódico de
bodega, así que mueve dinero, pero se edita desde el mismo formulario que el rol y la zona. Si entra,
es un tipo más (`usuario_fulfillment_cambiado`) sobre el punto de escritura que ya se instrumenta.

**Q3 — ¿Hace falta el valor ANTERIOR de una tarifa?** Este registro dirá «Fulano actualizó la tarifa
de la zona X el día Y», pero no de cuánto a cuánto: la fila de `tarifas` se sobrescribe y el precio
viejo se pierde. Guardarlo bien es **versionar tarifas** (tabla propia, N columnas de dinero), que es
otra ficha. Guardarlo mal es un volcado de texto libre en esta tabla, que R5 prohíbe. **¿Se abre
ficha aparte o se vive con «quién y cuándo» a secas?**

**Q4 — ¿El `admin` puede leer el historial que registra sus propias decisiones de dinero?** El humano
dijo «la navegación del maestro». El apartado «Histórico» al que se cuelga este módulo hoy lo ven
`maestro` **y** `admin` (`ROLES_HISTORICO_CONVERSACIONES`), y el encargo pide reusar esa declaración
en vez de crear una lista nueva. Consecuencia: el `admin` —que aprueba cierres y registra pagos—
podrá leer el registro de sus propios actos. No puede alterarlo (R2), así que el riesgo es de
incomodidad, no de integridad. **Si el humano quiere maestro-only, hay que decidir si se estrecha la
constante existente (y eso le quita también el histórico de conversaciones al `admin`) o si nace una
segunda constante**, que es justo lo que el encargo pedía evitar.

**Q5 — ¿Nombre de la entrada de menú?** El spec propone **«Acciones»** bajo «Histórico», junto a
«Conversaciones». Alternativas: «Auditoría», «Registro de actividad».

**Q6 — Frecuencias sin medir.** Siete tipos del Anexo A no tienen dato de producción (`pago_tienda`,
`egreso_administrativo`, los dos de `rechazo_tienda_cobro`, `cierre_dia_pagos_editados` y los dos
`cobro_gasto_fijo`). No cambian ninguna decisión de diseño —todos son de orden «unidades al día» por
construcción—, pero si alguno resultara ser de cientos al día, el reparto de la sección A.4 cambia.
**¿Se miden antes de implementar?**
