# Ficha 380 — el guardado de zona reescribe el pago al mensajero sin dejar rastro

**Zona:** backend. **SDD:** sí. **Rama:** `fix/380-tarifa-zona-mensajero-sin-rastro`.
**Lleva migración** (un valor nuevo de `historial_accion_tipo`), así que **se implementa SOLA**.

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
   con tres**, y esta ficha la escribe (R12).
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
- El precedente más cercano, la **otra** tabla de dinero: `tarifa_actualizada`
  (`TarifaRepository.update:225-233`) registra **el hecho y nada más** —sin `monto`, sin
  `valor_anterior`, sin `valor_nuevo`— sobre una tabla con **diez** columnas de dinero.
- La categoría `zona` ya existe en `HISTORIAL_ACCION_ENTIDADES` (la usa `zona_borrada`): **no hace
  falta ampliar el enum de entidades**.

## Decisiones de partida (el humano puede objetarlas en la puerta de aprobación)

1. **Se registra EL HECHO, no los importes.** Precedente literal: `tarifa_actualizada`. Guardar los
   importes anteriores no cabe en las columnas que hay (dos importes por vehículo, y `valor_*` es un
   `VarChar(60)` de vocabulario cerrado); hacerlo bien pediría filas por vehículo o una tabla de
   versiones, o sea **modelo nuevo**, que es lo que este encargo prohíbe. Ver **Q2**.
2. **Se audita también la CREACIÓN de una zona con pagos**, no solo el guardado. Cuesta cinco líneas
   y evita el medio arreglo que ya costó una ficha (377/Q3: cerrar una de las dos puertas al mismo
   agujero no es un arreglo). Ver **Q3**.
3. **NO se audita el borrado de la zona.** La fila `zona_borrada` que ya se escribe
   (`ZonaRepository.hardDelete:573`) documenta la desaparición de la zona y, con ella, la de sus
   pagos. Una segunda fila diría lo mismo dos veces.
4. **No hay backfill y no puede haberlo.** Nadie registró los cambios de pago del pasado: no existe
   la fuente. El rastro empieza el día que se despliegue. Misma limitación declarada de la 376.
5. **Fuera de alcance:** el `number` del borde y del DTO de tarifas (ver corrección 4 de arriba), y
   auditar el NOMBRE y los DISTRITOS de una zona (Q4).

## Requisitos (EARS)

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

**R5** — CUANDO se cree una zona con al menos un pago al mensajero, el sistema DEBE registrar UNA
fila referida a la zona creada; y CUANDO se cree una zona sin ningún pago, NO DEBE registrar ninguna.

**R6** — CUANDO se borre una zona, el sistema NO DEBE registrar ninguna fila por este mecanismo.

### B — Qué dice la fila

**R7** — Cada fila de R1 y de R5 DEBE identificar quién hizo el cambio —usuario, nombre y rol
congelados en el instante del cambio—, cuándo, y sobre qué zona, nombrando la zona de forma legible.

**R8** — SI el cambio lo ejecuta el sistema sin un usuario detrás, ENTONCES los tres campos del actor
DEBEN quedar vacíos los tres a la vez.

**R9** — Ninguna fila de R1 ni de R5 DEBE contener importes, ni datos del destinatario de una orden,
ni texto libre escrito por una persona.

**R10** — El sistema DEBE clasificar esta acción como una acción que MUEVE DINERO.

**R11** — Cada fila de R1 y de R5 DEBE llevar un identificador de lote propio, distinto del de
cualquier otro registro escrito en el mismo guardado.

### C — Atomicidad y rechazos

**R12** — El sistema DEBE escribir la fila de R1 y la de R5 en la MISMA transacción que la escritura
de los pagos que documentan, de modo que no pueda quedar una fila sin su cambio ni un cambio sin su
fila.

**R13** — SI un guardado se rechaza —porque la zona no existe, o porque dejaría al sistema sin zona
central—, ENTONCES el sistema NO DEBE reescribir ningún pago ni registrar ninguna fila.

### D — El catálogo y la base

**R14** — El catálogo cerrado de acciones DEBE incluir el tipo nuevo, y el conjunto de valores del
enum de la base DEBE ser exactamente el del catálogo.

**R15** — La migración DEBE ser aditiva: no crea ni altera tablas, columnas ni índices, no escribe ni
borra datos, y no amplía el catálogo de entidades.

**R16** — La reversión de la migración DEBE devolver el enum de la base exactamente a la lista que
tenía inmediatamente antes de aplicarla, valor a valor y en el mismo orden.

**R17** — SI existe alguna fila del historial que use el tipo nuevo, ENTONCES la reversión DEBE
fallar de forma ruidosa y NO DEBE borrar ni modificar esa fila.

### E — Lo que esta ficha NO cambia

**R18** — El sistema DEBE conservar sin cambios el desenlace visible de crear, guardar y borrar una
zona: los mismos campos y los mismos estados que devuelve hoy.

**R19** — El sistema DEBE seguir reemplazando por completo los pagos de la zona en cada guardado.
Esta ficha registra ese cambio; no lo impide, no lo condiciona y no lo altera.

## Trazabilidad R → test

| R | Cómo se prueba | Dónde vive |
| --- | --- | --- |
| R1 | guardar cambiando un importe → **1** fila del tipo nuevo, con `entidad_id` = id de la zona | `tests/integration/db/zona-pago-mensajero-rastro.test.ts` (Postgres real) |
| R2 | guardar cambiando SOLO el nombre, y otro caso cambiando la marca de central → **0** filas del tipo nuevo (y sí la de la 376) | mismo archivo |
| R3 | guardar EL MISMO conjunto exacto → los `id` de la tabla cambian (se afirma) y aun así **0** filas | mismo archivo + `tests/unit/repositories/pago-mensajero-cambio.test.ts` (alta, baja, cambio de importe, reordenado, `1500` vs `1500.00`) |
| R4 | guardia estática sobre el módulo del comparador: ni `Number(`, ni `parseFloat(`, ni `.toNumber(`, con contraprueba que inyecta cada uno y lo detecta | `tests/unit/guards/pago-mensajero-money-safe.guardia.test.ts` |
| R5 | crear con dos pagos → 1 fila; crear sin pagos → 0 filas | `tests/integration/db/zona-pago-mensajero-rastro.test.ts` |
| R6 | borrar una zona con pagos → 1 fila `zona_borrada` y **0** del tipo nuevo | mismo archivo |
| R7 | la fila trae `actor_usuario_id`, `actor_nombre` y `actor_rol` del usuario real, y `entidad_etiqueta` = nombre de la zona | mismo archivo |
| R8 | guardar con actor `null` → los tres campos del actor en `NULL` | mismo archivo |
| R9 | `monto`, `valor_anterior` y `valor_nuevo` en `NULL` + la guardia de vocabulario prohibido, que ya barre `ZonaRepository.ts` | mismo archivo + `tests/unit/guards/historial-accion-sin-datos-cliente.guardia.test.ts` |
| R10 | `accionesDeCategoria("mueve_dinero")` pasa de 27 a **28**; el reparto sigue siendo exhaustivo | `tests/unit/historial-accion/catalogo-y-choke-point.test.ts` |
| R11 | un guardado que a la vez reconcilia órdenes, mueve la marca y cambia el pago → **tres** `lote_id` distintos | `tests/integration/db/zona-pago-mensajero-rastro.test.ts` |
| R12 | censo de la guardia con entrada propia (mutación exigida: `tx.tarifaZonaMensajero.deleteMany(`) + **contraprueba nueva con TRES llamadas**, sacando la tercera del callback y pasándole otro cliente + caso de integración: guardado que revienta después de escribir (un `distritoId` inexistente) → 0 filas y pagos intactos | `tests/unit/guards/historial-accion-escrituras-cubiertas.guardia.test.ts` + integración |
| R13 | `not_found` y `sin_zona_central` → 0 filas y los pagos previos intactos en la tabla | `tests/integration/db/zona-pago-mensajero-rastro.test.ts` |
| R14 | los valores del enum de `public` comparados con el catálogo, y el conteo contra `HISTORIAL_ACCION_TIPOS.length` (nunca contra un número congelado) | `tests/integration/db/historial-accion-zona-pago-mensajero-migration.test.ts` |
| R15 | el `up` es una sola sentencia `ADD VALUE`, sin `CREATE/ALTER TABLE`, sin `INSERT/UPDATE/DELETE`, sin nombrar `historial_accion_entidad` | mismo archivo (estático, corre sin base) |
| R16 | se levanta el estado previo ejecutando las migraciones REALES anteriores, se aplica el `up`, se aplica el `down` y se compara **valor a valor y en orden** con lo medido antes | mismo archivo |
| R17 | con una fila que usa el valor nuevo, el `down` **rechaza** y la fila sigue ahí | mismo archivo |
| R18 | typecheck + la batería existente de servicio y repositorio de zonas sigue verde sin tocar sus aserciones de forma | `tests/unit/services/zona-service.test.ts`, `tests/unit/repositories/zona-repository.test.ts` |
| R19 | tras un guardado, la tabla contiene EXACTAMENTE los pagos del payload (ni uno más, ni uno menos), incluido el caso «payload sin pagos» | `tests/integration/db/zona-pago-mensajero-rastro.test.ts` |

## Preguntas abiertas

**Q1 — El tipo nuevo del catálogo: nombre, etiqueta y la decisión de NO reutilizar `tarifa_*`.
NECESITA FIRMA ANTES DE ESCRIBIR CÓDIGO (cuesta una migración).**
El diseño propone `zona_pago_mensajero_cambiado`, etiqueta «Cambió el pago al mensajero de una
zona», categoría «mueve dinero». **No** reutiliza `tarifa_creada`/`tarifa_actualizada`/`tarifa_borrada`
y el motivo está medido: esos tres apuntan a la tabla `tarifas` (flete de tienda/zona) y su
`entidad_tipo` es `tarifa`; meter aquí los ids de `tarifa_zona_mensajero` pondría **ids de dos tablas
distintas bajo el mismo `entidad_tipo`**, y `historial_accion` tiene `@@index([entidadTipo, entidadId])`
justo para responder «¿qué le pasó a esta entidad?». Sería mezclar dos conceptos de dinero —lo que
cobra la TIENDA y lo que cobra el MENSAJERO— en el mismo filtro. ¿Se aprueba el valor nuevo tal cual?

**Q2 — ¿Basta con el HECHO, o hay que guardar los IMPORTES? NECESITA FIRMA.**
El diseño registra quién, cuándo y sobre qué zona, sin importes, calcado de `tarifa_actualizada` —que
hace exactamente eso sobre una tabla con diez columnas de dinero—. La consecuencia hay que decirla en
voz alta: **el registro dirá que el pago cambió, pero no de cuánto a cuánto**, y ese dato no queda en
ninguna otra parte (el guardado destruye las filas viejas). Guardarlo no cabe en las columnas
actuales (`valor_anterior`/`valor_nuevo` son `VarChar(60)` de vocabulario cerrado, `monto` es UN
importe y aquí hay dos por vehículo): pediría una fila por vehículo con un formato compuesto, o una
tabla de versiones. Las dos son modelo nuevo y quedan fuera del encargo. ¿Se firma el alcance
reducido, o el humano quiere los importes y con ellos una ficha más grande?

**Q3 — ¿Se audita también la creación de una zona? NECESITA FIRMA (es el alcance de R5).**
El diseño dice que sí, por simetría con la 376 y para no dejar media puerta abierta. Si el humano
prefiere ceñirse a la palabra de la ficha —«el guardado reescribe»—, R5 se cae y se ahorra una
entrada del censo. Es reversible y barato en las dos direcciones, pero define qué contesta el
registro y por eso no lo decide el agente.

**Q4 — NO BLOQUEANTE, queda declarada para que no se pierda.** Con esta ficha, de una zona quedan
auditados: su borrado (362), el traslado de la marca de central (376), la re-derivación de la zona de
sus órdenes (366) y ahora el pago al mensajero (380). Siguen **sin rastro propio** el cambio de
NOMBRE y el de DISTRITOS —este último deja rastro indirecto en las órdenes que reconcilia, pero
ninguno si no reconcilia ninguna—. Es el resto de la Q1 de la 376. ¿Se abre ficha, o se deja así?
