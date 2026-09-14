# 427 — Traspasar a otro mensajero lo que ya lleva encima · Bitácora de implementación (BACKEND)

> Rama `feat/427-traspasar-ordenes-en-reparto`, sobre `origin/dev` @ `95264fb4`.
> Alcance de esta tanda: **tandas 1-5 de `tasks.md`** (datos, escritura, avisos, reglas, borde).
> **La tanda 6 (línea de tiempo) NO entra aquí** — ver «Lo que queda fuera y por qué», abajo.
> La tanda 7 (pantalla) es del `frontend_dev`, como manda la ficha.

---

## 1. Archivos

### Creados

| Archivo | Qué es |
| --- | --- |
| `db/migrations/20260917120000_orden_traspaso_mensajero/migration.sql` + `down.sql` | T2 — la tabla del rastro, sus 4 FK `RESTRICT`, sus 5 índices, el CHECK de «distinto» y la RLS |
| `db/migrations/20260917120100_notificacion_evento_traspaso/migration.sql` + `down.sql` | T4 — los 3 valores de enum de los avisos; el `down` recrea los DOS tipos y retipa **tres** columnas |
| `lib/repositories/registrar-traspaso-mensajero.ts` | T6 — choke point del rastro. `tx` primer parámetro, tipo `Pick<PrismaClient,"ordenTraspasoMensajero">` (no puede abrir transacción propia) |
| `lib/repositories/traspasar-conversaciones.ts` | T7 — choke point del chat. Mismo patrón |
| `lib/services/mensajes-traspaso.ts` | T14 — los motivos nuevos; los 6 existentes se **importan**, no se copian |
| `lib/interfaces/services/ITraspasoMensajeroService.ts` | T15 — contrato. El input **no tiene campo de origen** (R8 puesto en el tipo) |
| `lib/services/TraspasoMensajeroService.ts` | T15 — las reglas, `ESTADOS_TRASPASABLES`, las guardas del destino y los dos avisos fuera de la tx |
| `lib/actions/traspasar-mensajero.ts` | T18 — Server Action: zod + actor + **composition root de los dos notificadores reales** |
| `tests/integration/db/orden-traspaso-migration.test.ts` | T3 — la forma de la tabla contra Postgres |
| `tests/integration/db/notificacion-evento-traspaso-migration.test.ts` | T5 — el rollback del enum y los dos índices que sobreviven |
| `tests/integration/db/traspaso-mensajero.int.test.ts` | T9 — el caso real de 31 órdenes, todo-o-nada, carrera, rastro, jobs |
| `tests/unit/repositories/traspasar-conversaciones.test.ts` | T7 — la sentencia del chat (lo que el `SET` **no** menciona) |
| `tests/unit/notificaciones/emitir-traspaso.test.ts` | T13 — los dos emisores, R38/R39/R40/R42 |
| `tests/unit/services/traspaso-mensajero-service.test.ts` | T16 — las reglas con dobles |
| `tests/unit/actions/traspasar-mensajero.test.ts` | T19 + T18 — el borde y el composition root |

### Modificados

| Archivo | Qué cambia |
| --- | --- |
| `db/schema.prisma` | T1 — modelo `OrdenTraspasoMensajero`, 4 lados inversos (`Orden` ×1, `Usuario` ×3) y los 3 valores de enum |
| `lib/interfaces/repositories/IOrdenRepository.ts` | `TraspasoMensajeroItem`, `TraspasoMensajeroAplicado`, `TraspasoMensajeroConflictoError` y `traspasarMensajeroLote` |
| `lib/repositories/OrdenRepository.ts` | T8 — `traspasarMensajeroLote` (la transacción de design §6) + reloj inyectable (3.er parámetro opcional del constructor, para el `runAfter` del debounce) |
| `lib/notificaciones/emitir.ts` | T10 — `emitirTraspasoRecibido` / `emitirTraspasoCedido` y sus dos textos |
| `lib/notificaciones/notificadores.ts` | T12 — 2 firmas, 2 `*Con`, 2 `*Real`, y los dos en el no-op |
| `lib/notificaciones/push-elegibles.ts` | T11 — `recibido: {push:"si"}` / `cedido: {push:"no", porQué}` |
| `lib/notificaciones/catalogo-avisos.ts` | Obligado por el `Record` exhaustivo: `recibido` accionable con atajo a `/mis-asignaciones`, `cedido` **informativa** (la misma decisión que lo deja fuera del push) |
| `lib/types/notificacion.ts` | Los 3 valores en las dos uniones cerradas, con su porqué |
| `lib/services/mensajes-bloqueo.ts` | `MSG_MENSAJERO_CON_RECOLECCION` **se mueve** aquí desde `GuiaAsignacionService` (ahora lo emiten dos servicios; el literal sigue existiendo una sola vez) |
| `lib/services/GuiaAsignacionService.ts` | Importa esa constante en vez de declararla |
| `tests/unit/guards/carga-del-mensajero.guardia.test.ts` | T17 — noveno miembro del censo (`toHaveLength(8)` → `9`) |
| `tests/fixtures/api-key-dependencias-usuario.ts` | Las 3 FK nuevas hacia `usuario`, clasificadas con motivo (la guardia 373/R17 las reclamó) |
| `tests/unit/notificaciones/push-elegibles.test.ts` | Los dos eventos en las listas literales + los asertos de R43 |
| `tests/unit/services/notificacion-productores-wiring.test.ts` | Los 3 valores en los dos inventarios cerrados |
| `tests/unit/services/notificacion-notificadores-reales.test.ts` | `TraspasoMensajeroService` en el censo + guardia de cableado de sus DOS notificadores |
| `tests/integration/db/notificacion-evento-webhook-suscripcion-migration.test.ts` | Los 3 valores en la lista de «la base aplicada» (403) |
| `tests/unit/services/{bulk-orden-service,bulk-orden-service.carga-api,orden-service,rol-admin-satelite-authz}.test.ts` | El doble de `IOrdenRepository` gana `traspasarMensajeroLote` |

---

## 2. Mapa `R<n> → test`

| R | Test que lo cubre |
| --- | --- |
| R1 | `traspaso-mensajero-service.test.ts` › «`maestro` y `admin` pueden traspasar» (it.each, 2 casos) |
| R2 | idem › «cualquier otro rol: `forbidden` SIN tocar nada» (4 roles, `nadaSeConsulto` sobre los 9 métodos) + control positivo |
| R3 | **T24, frontend** (no hay superficie para el mensajero). El backend lo cubre por R2. |
| R4 | idem › «la constante tiene EXACTAMENTE esos dos» + `carga-del-mensajero.guardia` (9.º miembro) |
| R5 | idem › 6 estados rechazados nombrando el estado + «UNA orden mala aborta el LOTE COMPLETO»; `traspaso-mensajero.int.test.ts` › T9.10 |
| R6 | idem › «dos orígenes → conflict con una entrada POR ORDEN» |
| R7 | idem › «destino == origen → rechazo sin efectos»; `orden-traspaso-migration.test.ts` › «(b) el CHECK RECHAZA origen == destino» + su control; `traspaso-mensajero.int.test.ts` › «R7 en la base» |
| R8 | `traspasar-mensajero.test.ts` › «un campo de origen enviado por el cliente NO llega al service»; service › «el ORIGEN que llega al repo sale de las ÓRDENES» |
| R9 | service › «destino sin rol/zona» + «la zona se evalúa contra la de CADA orden del lote» |
| R10 | service › «destino sin vehículo» y «destino inactivo/bloqueado de cuenta» |
| R11 | service › «destino bloqueado por cierres → conflict con el MISMO motivo que las asignaciones» |
| R12 | service › «el bloqueo del ORIGEN NO impide quitarle trabajo» (+ afirma que al predicado sólo se le pregunta por el destino) |
| R13 | service › «destino con recolección pendiente» + «la consulta pregunta por `recolectando` y sólo por el DESTINO» |
| R14 | service › «tope agotado SÍ se traspasa» y «sin coordenadas SÍ se traspasa» (y los dos métodos no están en el `Pick`) |
| R15 | int › T9.1 «cambia el mensajero y `asignado_at`» |
| R16 | int › T9.2 (fila entera idéntica menos las dos columnas) + «`fecha_reparto` NULL se reescribe NULL» |
| R17 | int › T9.1 (`asignadoAt` posterior al sembrado) |
| R18 | int › T9.3 «TODAS las conversaciones pasan al destino» + «los hilos de OTRAS órdenes no se tocan»; `traspasar-conversaciones.test.ts` |
| R19 | int › T9.3 (`mensajeroLeidoAt` NULL) + `traspasar-conversaciones.test.ts` |
| R20 | int › T9.4 «las gestiones ya registradas NO cambian de dueño ni de importes» |
| R21 | int › T9.5 «CERO filas nuevas en `orden_historial_estado`» |
| R22 | int › T9.6 «las marcas privadas del ORIGEN quedan intactas» |
| R23 | int › T9.10 (4 casos: entregada, de otro mensajero, borrada, id inexistente) |
| R24 | int › T9.11 «si el estatus cambió tras la validación, el lote revierte ENTERO»; service › «el `detalle` lleva UNA entrada por orden» |
| R25 | int › T9.7 «UNA fila por orden, con los cinco datos» |
| R26 | int › T9.8, **dos mitades**: (a) cambiar el rol vivo después ⇒ la fila sigue diciendo el de entonces; (b) la fila guarda el rol DEL ACTO, no el que la base dice |
| R27 | int › T9.7 (`new Set(loteId).size === 1`) + service › «dos actos generan `lote_id` distintos» |
| R28 | `traspasar-mensajero.test.ts` › 9 caracteres / sólo espacios / ausente / >300, todos sin llamar al service |
| R29 | **Tanda 6, fuera de esta entrega** (ver abajo) |
| R30 | int › «un SEGUNDO traspaso AÑADE una fila y no altera la primera»; `orden-traspaso-migration.test.ts` › «(f) sin `updated_at` ni `deleted_at`» |
| R31 | int › «si el RASTRO no se puede escribir, NINGUNA orden queda movida» + «el rastro se escribe con el `tx`, NO con el cliente del repositorio» + su control anti-vacuidad |
| R32 | int › T9.9 «DOS jobs `optimizacion_ruta`, uno por mensajero» (payload, dedupe key y `runAfter`) |
| R33 | **T24, frontend** |
| R34 | **T24, frontend** |
| R35 | **T24, frontend**. El backend le da los dos nombres: service › «recibe las dos cifras y los dos nombres» |
| R36 | **T24, frontend**. El backend le da las cifras: int › «EL CASO REAL: 31 órdenes y 31 conversaciones» |
| R37 | **T24, frontend**. El backend no devuelve ids ni PII: `mensajes-traspaso.ts` sólo nombra el `value` del estado |
| R38 | `emitir-traspaso.test.ts` › «UNA fila aunque el acto mueva 31 órdenes»; service › «cada notificador EXACTAMENTE UNA VEZ» |
| R39 | `emitir-traspaso.test.ts` › «UNA fila, dirigida al origen y con evento PROPIO» |
| R40 | `emitir-traspaso.test.ts` › «ni el texto ni el anexo contienen el motivo» + contraprueba; service › «el contexto NO lleva el motivo» |
| R41 | service › «un notificador que LANZA no cambia el `ok`» (y el otro se emite igual) ×2 sentidos; `emitir-traspaso.test.ts` › el camino real absorbe y registra |
| R42 | `emitir-traspaso.test.ts` › «la ENTIDAD es el `lote_id`, y por eso dos actos no se pisan» (afirma sobre `entidadId`, no sobre el nº de llamadas) + «el mismo acto dos veces ⇒ uno solo» |
| R43 | `push-elegibles.test.ts` › «el traspaso empuja al que RECIBE y NO al que CEDE» + «ningún otro rol»; `notificacion-evento-traspaso-migration.test.ts` › `push_envio_dia_cupo` sobrevive al rollback |

---

## 3. Salida real de los comandos

```
$ pnpm run typecheck
> ordenex@0.1.0 typecheck R:\job\singularis\projects\ordenex
> tsc --noEmit

TYPECHECK_EXIT=0
```

```
$ pnpm run lint
✖ 199 problems (0 errors, 199 warnings)
  0 errors and 2 warnings potentially fixable with the `--fix` option.

LINT_EXIT=0
```

> Los 199 son warnings preexistentes del repo (`_args` sin usar en dobles de test, etc.).
> Antes de esta rama eran 186; los 13 nuevos son de la misma familia y del mismo estilo que los
> vecinos: parámetros `_ctx` / `_args` en dobles. **Cero errores.**

Los siete archivos de esta ficha:

```
$ pnpm exec vitest run tests/integration/db/traspaso-mensajero.int.test.ts \
    tests/integration/db/orden-traspaso-migration.test.ts \
    tests/integration/db/notificacion-evento-traspaso-migration.test.ts \
    tests/unit/services/traspaso-mensajero-service.test.ts \
    tests/unit/actions/traspasar-mensajero.test.ts \
    tests/unit/notificaciones/emitir-traspaso.test.ts \
    tests/unit/repositories/traspasar-conversaciones.test.ts

 Test Files  7 passed (7)
      Tests  145 passed (145)
   Duration  2.10s
```

Todo lo que el grafo relaciona con los archivos tocados:

```
$ pnpm exec vitest related --run lib/repositories/OrdenRepository.ts \
    lib/repositories/registrar-traspaso-mensajero.ts lib/repositories/traspasar-conversaciones.ts \
    lib/services/TraspasoMensajeroService.ts lib/services/mensajes-traspaso.ts \
    lib/services/mensajes-bloqueo.ts lib/services/GuiaAsignacionService.ts \
    lib/actions/traspasar-mensajero.ts lib/notificaciones/emitir.ts \
    lib/notificaciones/notificadores.ts lib/notificaciones/push-elegibles.ts \
    lib/notificaciones/catalogo-avisos.ts lib/types/notificacion.ts \
    lib/interfaces/repositories/IOrdenRepository.ts \
    lib/interfaces/services/ITraspasoMensajeroService.ts db/schema.prisma

 Test Files  582 passed (582)
      Tests  8788 passed | 26 skipped (8814)
   Duration  312.35s
RELATED_EXIT=0
```

Las guardias enteras:

```
$ pnpm run test:guardias
 Test Files  225 passed (225)
      Tests  3295 passed (3295)
   Duration  31.08s
GUARDIAS_EXIT=0
```

> **Los `integration/db` de esta ficha NO se saltaron.** El árbol principal tiene `.env`, así que
> `HAY_BASE_DE_DATOS` es `true` y los tres archivos contra Postgres corrieron de verdad (los 145
> tests de arriba los incluyen). Los 26 `skipped` del `related` son ajenos a esta ficha.

### La primera corrida del `related` salió ROJA, y qué era

Cuatro rojos, los cuatro **censos cerrados que esta ficha tenía que ampliar** — que es exactamente
para lo que existen:

| Rojo | Qué faltaba |
| --- | --- |
| `notificacion-productores-wiring.test.ts` ×2 | los 3 valores en los dos inventarios literales de enum |
| `notificacion-notificadores-reales.test.ts` | `TraspasoMensajeroService` en `SERVICES_CON_NOTIFICADOR` |
| `notificacion-evento-webhook-suscripcion-migration.test.ts` | los 3 valores en «la base aplicada» de la 403 |

Se ampliaron los cuatro con su motivo escrito, **y de paso se añadió una guardia nueva**:
`lib/actions/traspasar-mensajero.ts inyecta LOS DOS notificadores reales que cablea`, sobre el uso
efectivo (sin imports ni comentarios) — el molde de la de `cierres-admin.ts`.

---

## 4. Las migraciones: aplicadas y revertidas

```
$ pnpm exec prisma migrate deploy
Applying migration `20260917120000_orden_traspaso_mensajero`
Applying migration `20260917120100_notificacion_evento_traspaso`
All migrations have been successfully applied.

$ pnpm run db:rollback          # revierte 20260917120100
Rollback completado: 20260917120100_notificacion_evento_traspaso

$ pnpm exec prisma db execute --file=db/migrations/20260917120000_.../down.sql
Script executed successfully.                    # + DELETE de su fila en _prisma_migrations

$ pnpm exec prisma migrate status
Following migrations have not yet been applied:
20260917120000_orden_traspaso_mensajero
20260917120100_notificacion_evento_traspaso

$ pnpm exec prisma migrate deploy && pnpm exec prisma migrate status
All migrations have been successfully applied.
Database schema is up to date!                   # sin drift
```

> `db:rollback` elige la carpeta **por nombre**, así que sólo sabe revertir la última; el `down` de
> la tabla se ejercitó a mano con `prisma db execute` + el borrado de su fila. Las dos se aplican y
> se revierten limpio y `migrate diff` no propone nada.

### ⚠️ El pre-vuelo del `down.sql` de los enums CADUCA

Las dos listas del `down.sql` de `20260917120100_notificacion_evento_traspaso` se escribieron
leyendo `db/schema.prisma` de **`origin/dev` @ `95264fb4bfb94206dbe02929d218cd3b26a86f42`**
(2026-09-14): **15 eventos y 13 entidades**, con `reparto_manana` / `reparto_manana_dia` de la 413
ya dentro. Re-comprobado contra `origin/dev` al cerrar esta tanda: sigue en `95264fb4`.

**Hay que volver a leerlas justo antes de abrir el PR.** Si otra ficha añade un valor a esos enums
y entra en `dev` antes que ésta, revertir con la lista vieja **borraría en silencio** su valor — le
pasó a la 401 con la 403. Las listas están en tres sitios y los tres tienen que moverse juntos:
el `down.sql`, `EVENTOS_PREVIOS`/`ENTIDADES_PREVIAS` de
`tests/integration/db/notificacion-evento-traspaso-migration.test.ts`, y la lista de «la base
aplicada» del test de la 403.

---

## 5. T26 — las doce mutaciones, ejecutadas

Cada una: se aplicó al árbol, se corrieron los tests indicados, se restauró el árbol. Salida real,
no un resumen.

| # | Mutación | Esperado | **Medido** |
| --- | --- | --- | --- |
| 1 | Quitar el `UPDATE` de `chat_conversacion` | ROJO en T9.3 | **ROJO** — 3 fallos |
| 2 | Quitar `mensajero_leido_at = NULL` | ROJO en T9.3 | **ROJO** — 2 fallos |
| 3 | Quitar `AND "mensajero_asignado_id" = origen` | ROJO en T9.10 | **ROJO** — 1 fallo |
| 4 | `"fecha_reparto" = NOW()::date` | ROJO en la guardia (d4) **y** en T9.2 | **ROJO** — 3 fallos en 2 archivos |
| 5 | Quitar `ayuda_tienda` | ROJO en T16 y T17 | **ROJO** — 4 fallos en 2 archivos |
| 6 | Rol **vivo** en la fila de rastro | ROJO en T9.8 | **ROJO** — 1 fallo |
| 7 | `registrarTraspasoMensajero` fuera de la tx | ROJO en T9.10 | **ROJO tras arreglar el arnés** (ver abajo) |
| 8 | Encolar sólo el destino | ROJO en T9.9 | **ROJO** — 1 fallo |
| 9 | Guarda de cierres también al ORIGEN | ROJO en T16 (R12) | **ROJO** — 1 fallo |
| 10 | `mensajeroId` como `entidadId` | ROJO en T13 (R42) | **ROJO** — 1 fallo |
| 11 | No pasar los notificadores reales | ROJO en T18 | **ROJO** — 2 fallos |
| 12 | Un aviso **por orden** | ROJO en T13 y T16 | **ROJO en T16**; T13 no aplica (ver abajo) |

### ⚠️ La mutación 7 sobrevivió a la primera, y así se cerró

Primera corrida, con el arnés tal y como estaba escrito:

```
=== MUTACION 7: mover registrarTraspasoMensajero FUERA de la $transaction ===
 Test Files  1 passed (1)
      Tests  22 passed (22)
EXIT=0
```

**Por qué.** El doble de test envolvía el `tx` en **un solo** proxy y su `$transaction` entregaba al
callback **ese mismo objeto**. Así, `tx` y `this.prisma` eran literalmente el mismo valor y escribir
el rastro con uno o con otro daba un resultado idéntico: ninguna aserción podía distinguirlos. Es la
familia de fallo que este repo persigue —el arnés no falla, **aparenta**—, y salió sólo porque la
mutación se **ejecutó de verdad** en vez de darla por buena.

**Arreglo:** `clienteDelRepo` devuelve ahora **dos objetos distinguibles** (externo = `this.prisma`,
interno = el `tx` del callback) y `romperRastro: "fuera"` revienta sólo el externo. Con eso, escribir
el rastro con `this.prisma` salta. Caso nuevo: «R31/mutación 7: el rastro se escribe con el `tx`, NO
con el cliente del repositorio». Re-ejecutada:

```
=== MUTACION 7: mover registrarTraspasoMensajero FUERA de la $transaction ===
 Test Files  1 failed (1)
      Tests  2 failed | 21 passed (23)
 FAIL  ... ⭑⭑ R31: si el RASTRO no se puede escribir, NINGUNA orden queda movida
 FAIL  ... ⭑⭑ R31/mutacion 7: el rastro se escribe con el `tx`, NO con el cliente del repositorio
EXIT=1
```

### La mutación 12 y T13: la desviación, dicha

El plan esperaba «ROJO en T13 **y** en T16». La mutación —emitir un aviso por orden— vive en
`TraspasoMensajeroService`, y **T13 prueba los emisores**, no el servicio: por construcción no puede
verla. Se deja como está en vez de inflar T13 con un caso que sólo repetiría lo que T16 ya mide con
el número exacto (`toHaveBeenCalledTimes(1)` con un lote de 3).

### Salida de las doce (resumen por test nombrado)

```
=== MUTACION 1: quitar el UPDATE de chat_conversacion del repo ===
 Test Files  1 failed (1)
      Tests  3 failed | 20 passed (23)
 FAIL  ... ⭑⭑ T9.3 (R18/R19): TODAS las conversaciones pasan al destino, sin leer y con su ventana
 FAIL  ... R18: los hilos de OTRAS ordenes no se tocan
 FAIL  ... ⭑⭑ EL CASO REAL: 31 ordenes y 31 conversaciones, en una sola operacion
EXIT=1

=== MUTACION 2: quitar `mensajero_leido_at = NULL` del SET del chat ===
 Test Files  1 failed (1)
      Tests  2 failed | 21 passed (23)
 FAIL  ... ⭑⭑ T9.3 (R18/R19): TODAS las conversaciones pasan al destino, sin leer y con su ventana
 FAIL  ... ⭑⭑ EL CASO REAL: 31 ordenes y 31 conversaciones, en una sola operacion
EXIT=1

=== MUTACION 3: quitar `AND "mensajero_asignado_id" = origen` del WHERE ===
 Test Files  1 failed (1)
      Tests  1 failed | 22 passed (23)
 FAIL  ... ⭑⭑ T9.10 — TODO-O-NADA > ⭑⭑ una orden DE OTRO MENSAJERO en el lote: no se mueve ninguna
   AssertionError: expected null to be an instance of TraspasoMensajeroConflictoError
EXIT=1

=== MUTACION 4: poner `"fecha_reparto" = NOW()::date` ===
 Test Files  2 failed (2)
      Tests  3 failed | 39 passed (42)
 FAIL  ... ⭑ R16: una orden con `fecha_reparto` NULL se reescribe NULL, no «hoy»
 FAIL  guardia fecha-reparto... > R17: ninguna escritura del día de reparto hace aritmética de zona horaria en el SQL
 FAIL  guardia fecha-reparto... > (d4) la cláusula de aritmética horaria se aplica TAMBIÉN al censo del día
EXIT=1

=== MUTACION 5: quitar `ayuda_tienda` de ESTADOS_TRASPASABLES ===
 Test Files  2 failed (2)
      Tests  4 failed | 60 passed (64)
 FAIL  carga-del-mensajero.guardia > ... los estados que se pueden traspasar (`ESTADOS_TRASPASABLES`) incluye `ayuda_tienda`
 FAIL  traspaso-mensajero-service > ⭑ la constante tiene EXACTAMENTE esos dos, y `ayuda_tienda` es uno de ellos (D4)
 FAIL  traspaso-mensajero-service > ⭑ `ayuda_tienda` SI se traspasa: el paquete sigue con el, en la calle (235/R1)
 FAIL  traspaso-mensajero-service > R24: el `estatusIdEsperado` que viaja al repo es el del estado LEIDO
EXIT=1

=== MUTACION 6: escribir el rol VIVO en la fila de rastro en vez del congelado ===
 Test Files  1 failed (1)
      Tests  1 failed | 22 passed (23)
 FAIL  ... ⭑⭑ T9.8 (R26, segunda mitad): la fila guarda EL ROL DEL ACTO, no el que la base dice ahora
   AssertionError: expected 'maestro' to be 'admin'
EXIT=1

=== MUTACION 7: mover registrarTraspasoMensajero FUERA de la $transaction ===
 Test Files  1 failed (1)
      Tests  2 failed | 21 passed (23)
 FAIL  ... ⭑⭑ R31: si el RASTRO no se puede escribir, NINGUNA orden queda movida
 FAIL  ... ⭑⭑ R31/mutacion 7: el rastro se escribe con el `tx`, NO con el cliente del repositorio
EXIT=1

=== MUTACION 8: encolar la reoptimizacion SOLO del destino ===
 Test Files  1 failed (1)
      Tests  1 failed | 22 passed (23)
 FAIL  ... ⭑⭑ T9.9 (R32): DOS jobs `optimizacion_ruta`, uno por mensajero
   AssertionError: expected [ { …(3) } ] to have a length of 2 but got 1
EXIT=1

=== MUTACION 9: aplicar la guarda de cierres tambien al ORIGEN ===
 Test Files  1 failed (1)
      Tests  1 failed | 45 passed (46)
 FAIL  ... 427/R12 > ⭑⭑ el bloqueo del origen NO impide quitarle trabajo, y es el caso de la ficha
   AssertionError: expected 'conflict' to be 'ok'
EXIT=1

=== MUTACION 10: usar el mensajeroId como entidadId del aviso, en vez del loteId ===
 Test Files  1 failed (1)
      Tests  1 failed | 12 passed (13)
 FAIL  ... 427/R42 > ⭑⭑ la ENTIDAD es el `lote_id`, y por eso dos actos no se pisan
   AssertionError: expected [ { tipo: 'box', …(6) } ] to have a length of 2 but got 1
EXIT=1

=== MUTACION 11: NO pasar los notificadores reales en la Server Action (dejar el no-op) ===
 Test Files  1 failed (1)
      Tests  2 failed | 11 passed (13)
 FAIL  ... 427/T18 > ⭑⭑ sin `deps.service`, el servicio se construye CON los dos notificadores reales
 FAIL  ... 427/T18 > ⭑ y NO son el no-op ni el mismo notificador dos veces
EXIT=1

=== MUTACION 12: emitir un aviso POR ORDEN en vez de uno por acto ===
 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 58 passed (59)
 FAIL  ... 427/R38-R41 > ⭑⭑ tras un traspaso correcto se llama a CADA notificador EXACTAMENTE UNA VEZ
   AssertionError: expected "vi.fn()" to be called 1 times, but got 3 times
EXIT=1
```

**El árbol quedó limpio**: cada mutación restaura sus archivos en un `finally`, y se verificó a mano
con `grep` que las nueve anclas volvieron a su valor original antes de commitear.

---

## 6. Lo que queda fuera de esta tanda, y por qué

### Tanda 6 (T20/T21 — la línea de tiempo de la orden, R29)

**No entra, y no es un olvido.** T20 añade una **tercera clase** a `OrdenHistorialEntradaDTO`, y esa
unión la consume `app/(app)/ordenes/_components/HistorialOrdenTimeline.tsx` con un `switch`
**exhaustivo** cuyo `default` es un `const _exhaustivo: never` — escrito así a propósito por la 262:
«si la unión gana una tercera clase, esto NO COMPILA. Ese rojo ES la funcionalidad».

O sea: **T20 no puede aterrizar sin tocar `app/`**, y esta tanda tiene prohibido hacerlo. Aterrizarla
a medias dejaría `pnpm typecheck` en rojo para todo el mundo, que es peor que no aterrizarla.

Queda entera para quien haga la pantalla, con su alcance ya medido:

- `lib/types/orden-historial.ts` — `OrdenHistorialTraspasoDTO` y la unión de tres;
- `lib/services/OrdenHistorialService.ts` — `RANGO_POR_CLASE` (deja de compilar hasta decidir el
  rango: propuesto `traspaso_mensajero: 2`) y el tercer parámetro de `fusionarLineaDeTiempo`;
- `lib/repositories/OrdenTraspasoRepository.ts` + `lib/interfaces/repositories/IOrdenTraspasoRepository.ts`
  (nuevos) — `findTraspasosByOrden`, `created_at ASC, id ASC`;
- **33 sitios** construyen `new OrdenHistorialService(...)` y tienen que pasar el repositorio
  nuevo — contados el 2026-09-14: **21** en `app/`+`lib/`, **1** en `scripts/` y **11** en `tests/`;
- `HistorialOrdenTimeline.tsx` — la rama de la clase nueva;
- T21 — `orden-historial-fusion.test.ts` (ampliar) y `HistorialOrdenTimeline.test.tsx`.

Lo que **sí** está listo para eso: la tabla, sus índices (`(orden_id, created_at)` es «la lectura
prevista») y el rol congelado.

### T25 (ver la app funcionando) y tanda 7

De la tanda de frontend. Sin `TraspasarMensajeroModal` no hay nada que ver en pantalla.

### `@sin-superficie` en la Server Action — **caduca sola, y hay que quitarla**

`traspasarMensajero` lleva hoy:

```
@sin-superficie FICHA 427, tanda backend (2026-09-14): el servicio, la transaccion y los dos
avisos entran ANTES que su pantalla, que es la tanda 7 ...
```

Sin ella, `superficie-de-uso.guardia` se pondría roja (una Server Action que ningún módulo alcanzable
importa). **En cuanto el modal la monte, la OTRA mitad de esa guardia se pone roja hasta que se
borre la anotación.** Es el mismo episodio que vivió `corregirDiaReparto` (262), que lo dejó escrito
en su cabecera; aquí queda igual de escrito.

---

## 7. Decisiones de implementación que conviene conocer al revisar

1. **`estatusIdEsperado` viaja del servicio al repositorio.** El diseño (§6.2) dice «`AND estatus_id
   = ${estatusIdLeidoEnLaPreLectura}`». Guardar contra lo que uno acaba de leer **bajo el mismo
   bloqueo** es una guarda que siempre se cumple: no compara nada. Lo que se compara es el estatus
   que el **servicio** validó, y por eso R24 es medible (T9.11). El `WHERE` conserva además las tres
   guardas (pertenencia, estatus, `deleted_at`) como defensa en profundidad — y la de pertenencia es
   la única red contra la mutación 3.
2. **`MSG_MENSAJERO_CON_RECOLECCION` se mudó a `mensajes-bloqueo.ts`.** Era `const` privada de
   `GuiaAsignacionService`; desde esta ficha la emiten dos servicios. Se movió la **declaración**, no
   se copió el texto: el literal sigue existiendo una sola vez en el árbol (el mapeo de la UI lo
   traduce por su texto).
3. **`OrdenRepository` gana un tercer parámetro opcional: el reloj.** Lo exige el `runAfter` del
   debounce de reoptimización, que tiene que ser determinista en los tests. Mismo patrón y mismo
   motivo que `GestionOrdenRepository`. Ningún llamador existente cambia.
4. **`catalogo-avisos.ts` cambia aunque `tasks.md` no lo nombre.** Es un
   `Record<NotificacionEvento, EntradaCatalogo>` exhaustivo: un evento nuevo **no compila** hasta
   declarar su clase. `recibido` es accionable con atajo a `/mis-asignaciones`; `cedido` es
   **informativa** — la misma decisión que lo deja fuera del push (R43), y por eso no lleva atajo.
   Ninguno de los dos entra en `EVENTOS_AGREGADOS`: su número es el de un **acto cerrado** y no se
   recompone al leer.
5. **Los dos avisos van en `try` SEPARADOS.** Con un solo `try` envolviendo a los dos, un fallo del
   aviso al destino dejaría al origen sin el suyo, en silencio. Hay test de las dos direcciones.
6. **Los tres `RESTRICT` nuevos hacia `usuario`** se clasificaron en
   `tests/fixtures/api-key-dependencias-usuario.ts` como `no_alcanzable` con su motivo: la guardia
   373/R17 los reclamó al primer intento.

---

## 8. Veredicto

Backend de la 427 completo en las tandas 1-5 (datos, escritura, avisos, reglas y borde), con
`typecheck` y `lint` en cero errores, 145 tests propios verdes contra Postgres real y las doce
mutaciones del plan ejecutadas y **todas rojas** —la 7 sólo después de arreglar un arnés que no
sabía distinguir `tx` de `this.prisma`—; queda fuera la tanda 6 porque su cambio de tipo rompe por
diseño el `switch` exhaustivo de un componente de `app/`.
