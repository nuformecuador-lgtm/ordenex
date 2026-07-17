# Feature 89 — Novedades: incluir las devoluciones del mensajero

> Requisitos en notación EARS. Cada `R<n>` es testeable y mapea a un test concreto
> (ver `tasks.md` §Trazabilidad). Sin detalles de implementación (esos van en `design.md`).
> **Zona: backend** (ver design §7). No hay cambios de frontend ni de tipos del DTO.

## Contexto verificado (hechos, no supuestos)

Verificado leyendo el código en la rama principal:

1. **La orden NO reposa en `devuelta`.** `MisAsignacionesService.gestionar` (rama `devuelta`)
   escribe la gestión en `gestion_orden` (`resultado="devuelta"`, `causaDevolucion`, `motivo`,
   evidencia) y, en la MISMA transacción (`crearGestionYTransicionar`), la feature 47
   (`resolverSeguimientoDevuelta`) re-transiciona la orden: si `intentoActual >= MIN_INTENTOS_ENTREGA`
   → `rechazada` (conserva mensajero); si no → `en_bodega`/`en_bodega_satelite` (limpia mensajero).
2. **`/novedades` (feature 87) filtra por estatus ACTUAL = `devuelta`.** `NovedadesService`
   pasa `ESTATUS_DEVUELTA = "devuelta"` a `repo.countDevueltasByTienda`/`findDevueltasByTienda`,
   cuyo `WHERE` es `estatus.value = "devuelta"`. Como (1) mueve la orden fuera de `devuelta`,
   **las devoluciones del mensajero no aparecen en `/novedades`.** Ese es el bug.
3. **`Novedad` NO es una tabla.** Es una vista derivada de solo lectura (`NovedadDTO`), rol único
   `adminTienda`. La causa se deriva de la última gestión `devuelta` vigente
   (`resultado="devuelta" AND anuladaAt IS NULL`, la más reciente por orden) vía
   `findCausasDevueltaVigentes`.
4. **Causa tipificada (feature 73):** `gestion_orden.causaDevolucion` (enum
   `GestionCausaDevolucion {not_found, wrong_number, wrong_address}`, nullable). Es lo que el
   humano llama "el motivo": la causa tipificada de 3 opciones (ver §Aclaración del gate).

## Aclaración del gate (ratificada por el humano, 2026-07-17)

Por «el motivo» el humano se refiere al campo **`causa_devolucion`** (las 3 opciones tipificadas),
**NO** al campo de texto libre `gestion_orden.motivo`. Y esa causa **YA se expone y se renderiza
hoy**: `NovedadDTO.causa` la expone y `NovedadesModule.tsx` la muestra con `causaLabel(...)`
(etiqueta ES). El humano nunca la vio poblada solo porque la lista sale siempre vacía por el bug (2).

**Consecuencia:** esta feature NO agrega el campo de texto libre `motivo` al DTO ni a la vista.
El requisito de "mostrar la causa" se cumple con lo que la feature 87 YA hace; aquí es un requisito
de **verificación** (R10), no de código de UI nuevo.

## El choke-point (decisión clave del gate, ya RATIFICADA)

Filtrar literal por `orden.estatus === "devuelta"` da lista **vacía** y no cumple el pedido.
El predicado real debe **re-anclarse a la GESTIÓN**: una orden es NOVEDAD si tiene una gestión
**vigente** `resultado="devuelta" AND anuladaAt IS NULL` **y aún no está cerrada**. Ver R1–R5.

## Estatus que CIERRAN vs MANTIENEN la novedad (decisión #1 RATIFICADA)

Enumerando contra `ORDER_STATUS_SEED` (`lib/types/order-status.ts`, 14 valores). Los 3 valores de
cierre **existen y están verificados en el seed**:

- **CIERRAN la novedad (retiran la orden):** `entregada`, `devuelta_origen`, `recibido_origen`.
- **MANTIENEN la novedad (la orden sigue figurando mientras tenga gestión devuelta vigente):**
  `devuelta`, `reprogramada`, `en_fulfillment`, `en_ruta_bodega_principal`, `en_bodega`,
  `en_preparacion`, `en_espera_aceptacion`, `en_ruta_bodega_satelite`, `en_reparto`,
  `rechazada`, `en_bodega_satelite`. En particular `rechazada` (escalado) y
  `en_bodega`/`en_bodega_satelite` (reintento) **NO cierran** (decisión (b) del humano).

---

## Requisitos

### Predicado de novedad (re-anclaje a la gestión)

**R1** — El sistema DEBE considerar NOVEDAD de una tienda a toda orden de esa tienda que tenga
al menos una gestión **vigente** de devolución (`gestion_orden.resultado = "devuelta"` **Y**
`gestion_orden.anuladaAt IS NULL`), independientemente del estatus ACTUAL de la orden.

**R2** — MIENTRAS una orden con gestión de devolución vigente NO esté en un estatus **cerrado**
(ver R3), el sistema DEBE incluirla en las novedades de su tienda.

**R3** — El sistema DEBE tratar como estatus **cerrados** (que retiran la orden de las novedades)
exactamente el conjunto `{ entregada, devuelta_origen, recibido_origen }` (decisión #1 ratificada).
SI la orden está en cualquiera de esos estatus, ENTONCES el sistema DEBE excluirla de las
novedades aunque tenga una gestión de devolución vigente.

**R4** — El sistema DEBE seguir incluyendo como novedad a las órdenes cuyo estatus ACTUAL sea
`rechazada`, `en_bodega`, `en_bodega_satelite` (u otro estatus abierto de reintento/escalado)
mientras tengan una gestión de devolución vigente. En particular:
- una orden que la feature 47 movió a `en_bodega`/`en_bodega_satelite` (reintento) SÍ es novedad;
- una orden que la feature 47 escaló a `rechazada` SÍ es novedad.

**R5** — El sistema NO DEBE incluir una orden borrada (`deletedAt IS NOT NULL`) en las novedades,
aunque tenga una gestión de devolución vigente.

### Idempotencia / duplicados

**R6** — SI una orden tiene varias gestiones de devolución vigentes (varios intentos), ENTONCES
el sistema DEBE incluirla en las novedades **una sola vez**, tomando la causa de la gestión
**vigente más reciente** (mayor `createdAt`).

**R7** — El sistema NO DEBE contar una gestión de devolución **anulada** (`anuladaAt IS NOT NULL`,
feature 67) para ningún efecto: ni para incluir la orden, ni para derivar su causa. SI la única
gestión de devolución de una orden está anulada, ENTONCES la orden NO es novedad.

### Consistencia count / página

**R8** — El sistema DEBE garantizar que el conteo total (`countDevueltasByTienda`) y la página de
resultados (`findDevueltasByTienda`) usen **el mismo predicado** (R1–R7), de modo que el `total`
paginado y las filas devueltas cuenten exactamente el mismo universo de órdenes.

**R9** — El sistema DEBE acotar las novedades a la tienda del actor
(`tienda = actor.usuarioId`), sin filtrar ni exponer órdenes de otras tiendas.

### Causa tipificada (verificación; sin código de UI nuevo)

**R10** — Una vez re-anclada la query (R1–R9), el sistema DEBE seguir exponiendo la causa
tipificada de la gestión de devolución vigente más reciente en `NovedadDTO.causa` (valor
`causaDevolucion`, nullable; `null` cuando no hay causa registrada) y renderizándola con su
etiqueta ES en la vista existente, SIN cambios en `lib/types/novedad.ts` ni en `NovedadesModule.tsx`.
Este requisito se verifica con las novedades ya no vacías: la causa aparece poblada.

### Rol y paginación (regresión de la feature 87 — invariantes que NO cambian)

**R11** — SI el actor no tiene rol `adminTienda`, ENTONCES el sistema DEBE responder `forbidden`
sin exponer datos de órdenes (regresión de la feature 87).

**R12** — El sistema DEBE conservar la paginación de 10 por página y el orden por recencia
(fecha de la gestión de devolución vigente más reciente, desc; fallback documentado a
`Orden.createdAt` desc cuando no haya fecha de gestión).

**R13** — El sistema DEBE conservar el contrato de respuesta paginada
`{ status: "ok", items, total, page, pageSize }` (shape idéntico al actual de `/novedades`).

---

## Trazabilidad R → test (resumen; el detalle en tasks.md)

| R | Test (nivel) |
| --- | --- |
| R1 | repo: orden con gestión `devuelta` vigente y estatus ≠ `devuelta` aparece |
| R2 | service/repo: orden abierta con gestión vigente incluida |
| R3 | repo: orden en `entregada`/`devuelta_origen`/`recibido_origen` NO aparece |
| R4 | repo: orden en `en_bodega` (reintento) y en `rechazada` (escalado) SÍ aparecen |
| R5 | repo: orden borrada NO aparece |
| R6 | repo: orden con 2 gestiones vigentes aparece 1 vez con la más reciente |
| R7 | repo: gestión anulada no cuenta; única anulada → no aparece |
| R8 | repo/service: count y find concuerdan en el mismo universo |
| R9 | service: acota `tienda = actor.usuarioId` |
| R10 | service: causa de la gestión vigente más reciente en el DTO (null si no hay) |
| R11 | service: rol ≠ adminTienda → forbidden (regresión 87) |
| R12 | service: paginación 10/pág + orden por recencia |
| R13 | service: shape `{ items, total, page, pageSize }` |

---

## Decisiones del gate (todas resueltas — ninguna abierta)

1. **[CLAVE] Estatus que cierran la novedad — RESUELTA:**
   `{ entregada, devuelta_origen, recibido_origen }`. `rechazada` NO cierra (sigue como novedad
   pendiente); `en_bodega`/`en_bodega_satelite` tampoco cierran. Ver R3 y §Estatus arriba.

2. **Mostrar el "motivo" — RESUELTA (OBSOLETA):** por «el motivo» el humano se refiere a
   `causa_devolucion` (la causa tipificada), que **ya se renderiza** en `NovedadesModule.tsx`
   (`causaLabel(novedad.causa)`). No se agrega el campo de texto libre `motivo`. Ver R10 y la
   §Aclaración del gate. No hay trabajo de UI ni de tipos.

3. **Índice para el nuevo predicado (join órdenes × gestiones) — recomendación:** medir primero;
   sin migración en esta feature salvo que el humano lo pida. Candidato si hiciera falta:
   `gestion_orden (orden_id, resultado, anulada_at)`. Follow-up, no bloqueante.
