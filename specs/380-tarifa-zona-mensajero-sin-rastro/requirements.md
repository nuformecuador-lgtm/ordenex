# Ficha 380 — el guardado de zona reescribe el pago al mensajero sin dejar rastro

**Zona:** backend. **SDD:** sí. **Rama:** `fix/380-tarifa-zona-mensajero-sin-rastro`.
**Lleva migración** (un valor nuevo de `historial_accion_tipo`), así que **se implementa SOLA**.

## Las tres puertas humanas, firmadas el 2026-09-08

Se dejan escritas con quién decidió qué, porque dentro de un año es lo que explica por qué el diseño
es el que es.

| Pregunta | Recomendación del leader | **Firma del humano (2026-09-08)** |
| --- | --- | --- |
| **Q1** — ¿tipo nuevo `zona_pago_mensajero_cambiado` con su migración, o reutilizar los `tarifa_*`? | tipo nuevo | **A FAVOR: tipo nuevo.** No se reutilizan los `tarifa_*`. Coincide con la recomendación. |
| **Q2** — ¿registrar solo EL HECHO, o también los importes de antes y de después? | guardar el antes y el después | **EN CONTRA DE LA RECOMENDACIÓN: solo el hecho**, sin importes, con el precedente de `tarifa_actualizada` delante. |
| **Q3** — ¿se audita también la CREACIÓN de una zona con pagos? | sí, cerrar las dos puertas | **EN CONTRA DE LA RECOMENDACIÓN: solo la edición**, la puerta evidenciada. |

Q2 y Q3 se acatan y **recortan el alcance de verdad**: los requisitos que dependían de ellas están
retirados de este documento, no comentados «por si acaso». La decisión es del humano; el registro de
que fue contra la recomendación es información, no un reproche.

## ⚠️ Límite conocido y ACEPTADO del diseño (consecuencia de Q2)

Con «solo el hecho», el historial dirá **que el pago de una zona cambió y quién lo cambió, y nunca
podrá reconstruir de cuánto a cuánto**. El guardado destruye las filas viejas de
`tarifa_zona_mensajero` (`deleteMany` + `createMany`) y no queda copia en ninguna otra parte.

Dicho con el caso que importa: **si mañana un mensajero reclama, el rastro dirá que hubo un cambio,
en qué zona, quién lo hizo y cuándo. Y ahí se acaba.** No es un efecto colateral que se descubrirá
después: es el alcance firmado.

## Lo que se midió en el árbol real, y en qué corrige a la ficha

Todo lo de abajo se leyó en los archivos (tip `988c1345`, con la **376** y la **377** ya mergeadas),
no en el grafo del MCP —que en este repo miente devolviendo símbolos ya borrados—.

**El defecto que la ficha nombra ES REAL y sigue vivo.** `ZonaRepository.update`
(`lib/repositories/ZonaRepository.ts:382-385`) hace
`tx.tarifaZonaMensajero.deleteMany({ where: { zonaId: id } })` seguido de un `createMany` con lo que
traiga el payload: **todo guardado de zona destruye y recrea entero el pago al mensajero de esa
zona**, y no queda ni una fila de historial de ese hecho. `tarifa_zona_mensajero` es lo que cobra una
persona por entregar y por recibir un rechazo (`TarifaZonaMensajeroRepository.resolvePagoTarifa`,
feature 39).

**Cuatro afirmaciones de la ficha/encargo que el código de HOY desmiente, y hay que decirlo:**

1. **«ese camino NO llama a `appendAccion`: solo escribe `orden_zona_reconciliada»`.** Ya no.
   `update` llama a `appendAccion` **dos veces**: la reconciliación de órdenes de la 366
   (`:480`) y el cambio de marca de zona central de la 376 (`:514`). Lo que NO existe es una fila
   por la reescritura de los pagos. El hueco es exactamente ése, y solo ése.
2. **«la guardia del historial mira solo la PRIMERA llamada (`indexOf`)».** Ya no.
   `tests/unit/guards/historial-accion-escrituras-cubiertas.guardia.test.ts:452-461` la 376
   sustituyó el `indexOf` por `llamadasAAppendAccion`, que recorre **todas** las llamadas del cuerpo,
   y añadió tres contrapruebas para la segunda (`:589-626`). Una TERCERA llamada queda cubierta por
   el mismo detector, que es genérico sobre N. Lo que falta es una contraprueba que lo **demuestre
   con tres**, y esta ficha la escribe (R11).
3. **«el catálogo tiene 48 tipos».** Tiene **49** desde la 376
   (`lib/types/historial-accion.ts:45-185`; reparto 27/10/12). Los números duros que esta ficha mueve
   son 49→50 y 27→28.
4. **«el dinero viaja como STRING de punta a punta» — en ESTE camino, no.** El borde de zonas valida
   `cobroEntregado: z.number().nonnegative()` (`lib/types/zona.ts:5,13`) y `tarifaToDTO`
   (`ZonaRepository.ts:85-92`) devuelve `number` con `.toNumber()`. Es **preexistente y queda FUERA
   de alcance** (cambiarlo es rediseñar el contrato de la pantalla, no arreglar lo evidenciado). Lo
   que esta ficha sí exige es no añadir un paso de coma flotante nuevo: R4.

**Lo demás que se midió y que el diseño usa:**

- Los ÚNICOS escritores de `tarifa_zona_mensajero` en producción son tres métodos del mismo archivo:
  `ZonaRepository.create` (`createMany`, `:218`), `update` (`deleteMany`+`createMany`, `:382-385`) y
  `hardDelete` (`deleteMany`, `:564`). `TarifaZonaMensajeroRepository` es **solo lectura** y
  `VehiculoRepository` solo la **cuenta** para bloquear un borrado. No hay seeds que la escriban.
- `update` ya lee el estado previo de la N:M **antes** de borrarlo (`distritosPrevios`, `:370-373`) y
  por el motivo idéntico al que esta ficha necesita. El patrón ya está en este mismo método.
- `historial_accion` tiene `valor_anterior`/`valor_nuevo` en **`VarChar(60)`** y **Postgres no
  trunca**: un valor más largo aborta la transacción entera
  (`lib/types/historial-accion-etiquetas.ts:29-45`). `monto` es `Decimal(12,2)`, uno solo por fila.
- El precedente que la firma de Q2 adopta, en la **otra** tabla de dinero: `tarifa_actualizada`
  (`TarifaRepository.update:225-233`) registra **el hecho y nada más** —sin `monto`, sin
  `valor_anterior`, sin `valor_nuevo`— sobre una tabla con **diez** columnas de dinero.
- La categoría `zona` ya existe en `HISTORIAL_ACCION_ENTIDADES` (la usa `zona_borrada`): **no hace
  falta ampliar el enum de entidades**.

## Huecos conocidos que esta ficha VE y NO cierra (decididos, no olvidados)

Escritos aquí para que quien los encuentre dentro de seis meses sepa que se vieron y se decidieron, y
**no los registre como ficha nueva**.

1. **⭑ Crear una zona sigue escribiendo pagos de mensajero sin rastro propio** (Q3, firmada). El
   primer pago de una zona —el que se teclea al crearla— no deja fila; el segundo y todos los demás,
   sí. La decisión es además **coherente con el catálogo que ya existe**: hay `zona_borrada` y no hay
   `zona_creada`, igual que hay `vehiculo_borrado` y no `vehiculo_creado`, y el motivo está escrito
   en `lib/types/historial-accion.ts:134-137` — «lo que decide no es el nombre de la operación sino
   su PAPEL: el alta es aditiva, inocua y visible en la propia pantalla».
2. **El registro no dice de cuánto a cuánto** (Q2, firmada). Ver el límite aceptado, arriba.
3. **No hay backfill y no puede haberlo.** Nadie registró los cambios de pago del pasado: no existe
   la fuente. El rastro empieza el día que se despliegue. Misma limitación declarada de la 376.
4. **Siguen sin rastro propio el NOMBRE y los DISTRITOS de una zona.** Es el resto de la Q1 de la
   376. Queda declarado; no se abre ficha salvo que el humano lo pida.
5. **El `number` del borde y del DTO de tarifas** (corrección 4 de arriba). Preexistente.

## Requisitos (EARS) — 18

### A — El hecho que hoy no se registra

**R1** — CUANDO se guarde una zona existente y el conjunto de pagos al mensajero de esa zona quede
DISTINTO del que tenía al empezar el guardado, el sistema DEBE registrar en el historial de acciones
exactamente UNA fila, referida a la zona guardada.

**R2** — CUANDO se guarde una zona existente y el conjunto de pagos al mensajero quede IGUAL al que
tenía al empezar el guardado, el sistema NO DEBE registrar ninguna fila por este mecanismo, aunque
ese mismo guardado haya cambiado el nombre, los distritos o la marca de zona central.

**R3** — El sistema DEBE considerar que el conjunto de pagos cambió SI Y SOLO SI cambia el conjunto
de vehículos con pago, o cambia alguno de los dos importes de alguno de ellos. El identificador de
fila NO DEBE participar en esa comparación, porque el guardado lo regenera siempre.

**R4** — El sistema DEBE comparar los importes sin convertirlos a coma flotante en ningún punto.

**R5** — CUANDO se cree una zona, o CUANDO se borre una zona, el sistema NO DEBE registrar ninguna
fila por este mecanismo.

### B — Qué dice la fila

**R6** — Cada fila de R1 DEBE identificar quién hizo el cambio —usuario, nombre y rol congelados en
el instante del cambio—, cuándo, y sobre qué zona, nombrando la zona de forma legible.

**R7** — SI el cambio lo ejecuta el sistema sin un usuario detrás, ENTONCES los tres campos del actor
DEBEN quedar vacíos los tres a la vez.

**R8** — Ninguna fila de R1 DEBE contener importes, ni datos del destinatario de una orden, ni texto
libre escrito por una persona.

**R9** — El sistema DEBE clasificar esta acción como una acción que MUEVE DINERO.

**R10** — Cada fila de R1 DEBE llevar un identificador de lote propio, distinto del de cualquier otro
registro escrito en el mismo guardado.

### C — Atomicidad y rechazos

**R11** — El sistema DEBE escribir la fila de R1 en la MISMA transacción que la escritura de los
pagos que documenta, de modo que no pueda quedar una fila sin su cambio ni un cambio sin su fila.

**R12** — SI un guardado se rechaza —porque la zona no existe, o porque dejaría al sistema sin zona
central—, ENTONCES el sistema NO DEBE reescribir ningún pago ni registrar ninguna fila.

### D — El catálogo y la base

**R13** — El catálogo cerrado de acciones DEBE incluir el tipo nuevo, y el conjunto de valores del
enum de la base DEBE ser exactamente el del catálogo.

**R14** — La migración DEBE ser aditiva: no crea ni altera tablas, columnas ni índices, no escribe ni
borra datos, y no amplía el catálogo de entidades.

**R15** — La reversión de la migración DEBE devolver el enum de la base exactamente a la lista que
tenía inmediatamente antes de aplicarla, valor a valor y en el mismo orden.

**R16** — SI existe alguna fila del historial que use el tipo nuevo, ENTONCES la reversión DEBE
fallar de forma ruidosa y NO DEBE borrar ni modificar esa fila.

### E — Lo que esta ficha NO cambia

**R17** — El sistema DEBE conservar sin cambios el desenlace visible de crear, guardar y borrar una
zona: los mismos campos y los mismos estados que devuelve hoy.

**R18** — El sistema DEBE seguir reemplazando por completo los pagos de la zona en cada guardado.
Esta ficha registra ese cambio; no lo impide, no lo condiciona y no lo altera.

## Trazabilidad R → test

| R | Cómo se prueba | Dónde vive |
| --- | --- | --- |
| R1 | guardar cambiando un importe → **1** fila del tipo nuevo, con `entidad_id` = id de la zona | `tests/integration/db/zona-pago-mensajero-rastro.test.ts` (Postgres real) |
| R2 | guardar cambiando SOLO el nombre, y otro caso cambiando la marca de central → **0** filas del tipo nuevo (y sí la de la 376) | mismo archivo |
| R3 | guardar EL MISMO conjunto exacto → los `id` de la tabla cambian (se afirma) y aun así **0** filas | mismo archivo + `tests/unit/repositories/pago-mensajero-cambio.test.ts` (alta, baja, cambio de importe, reordenado, `1500` vs `1500.00`) |
| R4 | guardia estática sobre el módulo del comparador: ni `Number(`, ni `parseFloat(`, ni `.toNumber(`, con contraprueba que inyecta cada uno y lo detecta | `tests/unit/guards/pago-mensajero-money-safe.guardia.test.ts` |
| R5 | crear una zona con dos pagos → **0** filas del tipo nuevo; borrar una zona con pagos → 1 fila `zona_borrada` y **0** del tipo nuevo | `tests/integration/db/zona-pago-mensajero-rastro.test.ts` |
| R6 | la fila trae `actor_usuario_id`, `actor_nombre` y `actor_rol` del usuario real, y `entidad_etiqueta` = nombre de la zona | mismo archivo |
| R7 | guardar con actor `null` → los tres campos del actor en `NULL` | mismo archivo |
| R8 | `monto`, `valor_anterior` y `valor_nuevo` en `NULL` + la guardia de vocabulario prohibido, que ya barre `ZonaRepository.ts` | mismo archivo + `tests/unit/guards/historial-accion-sin-datos-cliente.guardia.test.ts` |
| R9 | `accionesDeCategoria("mueve_dinero")` pasa de 27 a **28**; el reparto sigue siendo exhaustivo | `tests/unit/historial-accion/catalogo-y-choke-point.test.ts` |
| R10 | un guardado que a la vez reconcilia órdenes, mueve la marca y cambia el pago → **tres** `lote_id` distintos | `tests/integration/db/zona-pago-mensajero-rastro.test.ts` |
| R11 | censo de la guardia con entrada propia (mutación exigida: `tx.tarifaZonaMensajero.deleteMany(`) + **contraprueba nueva con TRES llamadas**, sacando la tercera del callback y pasándole otro cliente + caso de integración: guardado que revienta después de escribir (un `distritoId` inexistente) → 0 filas y pagos intactos | `tests/unit/guards/historial-accion-escrituras-cubiertas.guardia.test.ts` + integración |
| R12 | `not_found` y `sin_zona_central` → 0 filas y los pagos previos intactos en la tabla | `tests/integration/db/zona-pago-mensajero-rastro.test.ts` |
| R13 | los valores del enum de `public` comparados con el catálogo, y el conteo contra `HISTORIAL_ACCION_TIPOS.length` (nunca contra un número congelado) | `tests/integration/db/historial-accion-zona-pago-mensajero-migration.test.ts` |
| R14 | el `up` es una sola sentencia `ADD VALUE`, sin `CREATE/ALTER TABLE`, sin `INSERT/UPDATE/DELETE`, sin nombrar `historial_accion_entidad` | mismo archivo (estático, corre sin base) |
| R15 | se levanta el estado previo ejecutando las migraciones REALES anteriores, se aplica el `up`, se aplica el `down` y se compara **valor a valor y en orden** con lo medido antes | mismo archivo |
| R16 | con una fila que usa el valor nuevo, el `down` **rechaza** y la fila sigue ahí | mismo archivo |
| R17 | typecheck + la batería existente de servicio y repositorio de zonas sigue verde sin tocar sus aserciones de forma | `tests/unit/services/zona-service.test.ts`, `tests/unit/repositories/zona-repository.test.ts` |
| R18 | tras un guardado, la tabla contiene EXACTAMENTE los pagos del payload (ni uno más, ni uno menos), incluido el caso «payload sin pagos» | `tests/integration/db/zona-pago-mensajero-rastro.test.ts` |

## Preguntas abiertas

**Ninguna bloqueante.** Las tres puertas humanas se firmaron el 2026-09-08 y están arriba. Lo que
queda vivo está en «Huecos conocidos», declarado y decidido: no necesita respuesta para implementar.
