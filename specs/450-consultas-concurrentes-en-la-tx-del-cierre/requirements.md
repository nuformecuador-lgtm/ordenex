# 450 — Dos consultas concurrentes sobre la conexión de la transacción que aprueba el cierre

> Zona: `backend` · `sdd: true` · `depends_on: 440` · rama base `dev` (SHA `09bb639b`, 2026-09-21).
> Código de dinero: la transacción afectada es la que escribe los dos ledgers y la caja.

## Contexto (lo ya medido, confirmado en el archivo real el 2026-09-21)

- `lib/services/WalletFeedService.ts:39` y `lib/services/WalletTiendaFeedService.ts:75` reciben un
  cliente de transacción (`WalletFeedTxClient` / `WalletTiendaFeedTxClient`, ambos
  `Pick<PrismaClient, "gestionOrden" | "cierreDetail">`) y lanzan **dos consultas a la vez** con
  `Promise.all`: `leerDetallePorOrden(cierreId, tx)` (`lib/utils/cierre-detalle.ts:137`, que hace su
  propio `tx.cierreDetail.findMany`) y un `tx.gestionOrden.findMany`.
- Los llama `CierresAdminRepository.resolverCierre` en las líneas **1823** y **1827**, dentro del
  `$transaction` abierto en la **1780** — la aprobación del cierre.
- `leerDetallePorOrden` **solo** tiene esos dos llamadores (censo del árbol, 2026-09-21).
- En producción, ventana de 7 días: la advertencia
  `Calling client.query() when the client is already executing a query` va por **32 ocurrencias y
  22 usuarios**, última el **2026-09-20**, y se **observa** en `/cierre-dia` y
  `/api/cron/corte-diario`, que son de **otro camino**.
- El parche de la 440 sigue en pie: **cero** 25P02 en `/mis-asignaciones/reparto` desde el
  2026-09-17 10:14 UTC. Esta ficha ataca la causa, no el síntoma.

La atribución de esa advertencia a estos dos sitios es **hipótesis, no medición**, y por eso es lo
primero que esta feature tiene que resolver (R1 y R2).

> ### ⚠️ Nota añadida el 2026-09-21, DESPUÉS de medir (no se reescribe lo de arriba)
>
> El contexto de arriba queda **tal y como se escribió**, porque el valor del spec incluye lo que se
> creía. Esto es lo que dijo Postgres:
>
> - **«lanzan dos consultas a la vez» no se sostiene en la conexión.** Con
>   `@prisma/client@7.8.0` + `@prisma/adapter-pg@7.8.0`, un `Promise.all` sobre un cliente de
>   transacción llega a la conexión **en serie**: Prisma serializa por su cuenta las peticiones de
>   una transacción interactiva. Medido con el contador de consultas en vuelo —**1 simultánea, 0
>   solapes, 0 advertencias**, antes y después del arreglo— y confirmado con las dos lecturas en
>   ticks distintos, con tres, y con `$transaction([…])` en forma de array
>   (`tests/integration/db/aprobacion-consultas-en-serie.test.ts`).
> - **Lo que sí lanza N consultas a la vez** es la **expansión de relaciones** de Prisma dentro de
>   una transacción: un `select` con N relaciones hermanas se resuelve con 1+N consultas y las N
>   salen juntas. Ese era el emisor del aviso de producción, y vivía en
>   `lib/repositories/CierreDiaRepository.ts` (el snapshot de `crearCierre`, 5 relaciones
>   hermanas): medido, **5 en vuelo, 4 solapes y el aviso capturado en un proceso limpio**.
>   Secuenciado en T2.7 — medido después: **1 en vuelo, 0 solapes**.
> - **El arreglo de los dos feeds sigue siendo correcto y necesario**, pero por lo que dice el
>   código y no por lo que hace el driver de esta versión: §2.4 del design (el daño necesita dos
>   consultas, no el aviso) y §5.4 (`pg@9.0` convierte el aviso en error). Su prueba de cierre es
>   el doble vigilado de T4, que mide la **forma**, no el contador de la conexión.
>
> El detalle, con los números de cada paso, está en `progress/impl_450.md`.

---

## Requisitos

### R1 — La aprobación del cierre, medida contra Postgres real

**CUANDO** se ejercita contra una base Postgres real el camino de aprobación de un cierre (los dos
feeds de wallet ejecutándose con el cliente de una transacción abierta), el sistema **NO DEBE**
poner dos consultas en vuelo sobre la conexión de esa transacción, **ni** emitir la advertencia de
proceso `Calling client.query() when the client is already executing a query`.

> **Obligación de medición previa (parte del requisito, no un extra).** El mismo test debe
> ejecutarse **antes** del arreglo y su resultado quedar escrito con su número: cuántas consultas
> simultáneas y cuántas advertencias. Un verde posterior sin ese rojo previo no demuestra nada, y
> este repo ya tuvo un arnés que reportó supervivientes sin haber ejecutado un test.

### R2 — Control negativo: los caminos donde la advertencia se OBSERVA

**MIENTRAS** se ejercitan contra Postgres real los puntos de concurrencia propios de los caminos
donde hoy se lee la advertencia (`/cierre-dia` y `/api/cron/corte-diario`), **sin** ninguna
aprobación de cierre en curso, el sistema **NO DEBE** poner dos consultas en vuelo sobre una misma
conexión ni emitir esa advertencia.

> Este requisito es la otra mitad de la atribución: separa «la ruta donde el mensaje se LEE» de «la
> ruta que lo PRODUCE». Su resultado —salga como salga— debe quedar escrito antes de tocar código.

### R3 — Una consulta a la vez sobre cualquier cliente de transacción

**MIENTRAS** haya una transacción de base de datos abierta, el sistema **DEBE** ejecutar sobre el
cliente de esa transacción **como máximo una consulta a la vez**, sea cual sea el archivo desde el
que se emita.

### R4 — Las lecturas siguen dentro de la transacción

**CUANDO** un feed de wallet construye los movimientos de un cierre, el sistema **DEBE** leer el
snapshot del cierre y sus gestiones **a través del cliente de la transacción de aprobación**, dentro
de esa transacción.

> Sacar las lecturas fuera cambiaría el snapshot con el que se liquida. Queda prohibido por este
> requisito, no solo desaconsejado.

### R5 — El dinero no cambia

**CUANDO** se construyen los movimientos de un cierre, el sistema **DEBE** emitir exactamente los
mismos movimientos que antes de esta feature: mismos conceptos, mismos montos, mismas tiendas,
mismos tipos y mismo orden de emisión.

### R6 — El orden de las escrituras de la aprobación no cambia

**CUANDO** se aprueba un cierre, el sistema **DEBE** ejecutar sus escrituras en el mismo orden que
hoy (transición del cierre → indemnizaciones → caja principal → ledger por tienda → ingreso COD →
libro del mensajero → egreso de indemnización → liberación/anclaje), porque cada feed lee lo que el
anterior acaba de escribir.

### R7 — Sin snapshot, la aprobación sigue abortando

**SI** falta la fila congelada de detalle de alguna orden del cierre, **ENTONCES** el sistema
**DEBE** abortar la aprobación con `CierreDetalleFaltanteError` y **NO DEBE** emitir ningún
movimiento, igual que antes de esta feature.

### R8 — Guardia: el patrón no puede volver por el tipo del parámetro

**SI** una función recibe un parámetro tipado como cliente de transacción (`*TxClient` o
`Prisma.TransactionClient`) **Y** lanza dos o más operaciones concurrentes sobre él
(`Promise.all`, `Promise.allSettled`, `Promise.race`, `Promise.any`), **ENTONCES** el sistema
**DEBE** fallar el gate nombrando el archivo y la línea.

### R9 — Guardia: tampoco por el `tx` inferido de un `$transaction`

**SI** el cuerpo de un `$transaction(async (tx) => …)` lanza dos o más operaciones concurrentes
sobre su propio cliente, **ENTONCES** el sistema **DEBE** fallar el gate nombrando el archivo y la
línea.

### R10 — La guardia se sabe romper y se sabe llena

El sistema **DEBE** demostrar, en la propia guardia, que (a) su detector se pone **rojo** ante el
código literal que esta feature retira, (b) **no** señala un `Promise.all` sobre el cliente agrupado
(el pool), que es legítimo y existe hoy en el árbol, y (c) su censo **encuentra** las funciones con
parámetro de transacción que se sabe que existen (anti-vacío).

### R11 — El emisor de la tercera consulta queda nombrado, o el agotamiento queda declarado

**CUANDO** se haya recorrido entero el itinerario de búsqueda del emisor (design §3.5, cinco pasos
en orden), el sistema **DEBE** quedar en uno de estos dos estados, y no en un tercero:

- **emisor nombrado** — con archivo y línea, reproducido con el contador de consultas en vuelo, y
  **secuenciado** bajo R3, cubierto por un test que esté rojo antes del arreglo y verde después, y
  vigilado por la guardia (si su forma no la vigilan los brazos A ni B, la guardia gana un brazo);
- **agotamiento declarado** — con los cinco pasos marcados y su resultado escrito, y la observación
  de producción anotada con fecha en `docs/release.md`.

> «Se sigue buscando» no es un estado admisible: es lo que convierte una ficha en una ficha eterna.

### R12 — Los dos entregables no se bloquean entre sí

El sistema **DEBE** quedar correcto, verificable y desplegable con el arreglo de los dos feeds
(entregable 1) **aunque el emisor del aviso no llegue a nombrarse** (entregable 2). Ningún test ni
guardia del entregable 1 puede depender de un hallazgo del entregable 2.

---

## Fuera de alcance

- El borde de `lib/actions/mis-asignaciones.ts` y el conteo de `INTERNAL`: eso es la mitad ya
  desplegada de la 440 y funciona.
- Cambiar el tamaño del pool, el pooler de Supabase o la versión de `pg`.
- Cualquier cambio en la fórmula del dinero, en el modelo de datos o en el orden de las escrituras
  (R5 y R6 lo prohíben explícitamente).
- **No está fuera de alcance** el emisor de la tercera consulta, aunque viva en otro camino: ver
  decisión 1.

---

## Decisiones firmadas por el humano (2026-09-21)

Sustituyen a las preguntas abiertas de la primera versión de este spec. Quedan escritas aquí para
que sobrevivan a la sesión.

1. **Alcance: TODO DENTRO DE LA 450.** La ficha no se parte. Cubre las dos cosas: arreglar el patrón
   de los dos feeds **y** nombrar quién encola la tercera consulta que sí emite el aviso. Si el
   control negativo (R2) señala a `CierreDiaRepository.ts:1226` o a `CorteDiarioService.ts:164`,
   entran **también** en esta ficha; no van aparte.
2. **Prueba de cierre: el contador determinista de consultas en vuelo + `./init.sh` completo en
   verde.** La observación en producción **no** bloquea el paso a `done`: se anota como comprobación
   **fechada** en `docs/release.md`, sección «Pendiente para la PRÓXIMA release». El motivo está en
   el design §6: si el emisor resulta ser otro código, esperar a que el aviso desaparezca es esperar
   algo que puede no ocurrir nunca.
3. **La búsqueda va acotada** (R11): itinerario de cinco pasos en orden, criterio de parada
   explícito y salida declarada si se agota sin hallazgo (design §3.5). Va en su **propio bloque de
   tareas, y primero**, porque lo que encuentre puede cambiar el arreglo.
4. **Los dos entregables son independientes** (R12): el arreglo de los feeds no espera a que
   aparezca el emisor, y puede mergearse solo.
5. **Confirmado en el fuente por el humano:** en `pg@8.22.0` (`lib/client.js:714-717` y `603-624`)
   el aviso salta si la cola **ya tenía algo** al encolar; la 1.ª consulta pasa a activa y deja la
   cola en 0, la 2.ª encuentra 0 y **no avisa**, la 3.ª encuentra 1 y **sí**. El corolario —que el
   patrón siga siendo dañino aunque no avise— está escrito en el design §2.4 y es parte del spec.
