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

---

# 427 · Bitácora de implementación (FRONTEND) — tandas 6 y 7

> Rama `feat/427-traspasar-ordenes-en-reparto`, sobre el commit de backend `895b3bdb`.
> Alcance de esta tanda: **T20/T21 (la línea de tiempo, R29)** y **T22/T23/T24 (la pantalla)**.
> Se escribe **debajo** de la bitácora del backend, sin tocarla.

---

## F1. Archivos

### Creados

| Archivo | Qué es |
| --- | --- |
| `lib/interfaces/repositories/IOrdenTraspasoRepository.ts` | T20 — contrato de **solo lectura** del rastro. No declara ningún método de escritura a propósito: el choke point del append ya existe y es `registrar-traspaso-mensajero.ts` |
| `lib/repositories/OrdenTraspasoRepository.ts` | T20 — `findTraspasosByOrden`, `created_at ASC, id ASC`, `Pick<PrismaClient, "ordenTraspasoMensajero">`. Molde literal de `OrdenDiaRepartoCambioRepository` (262) |
| `app/(app)/ordenes/_components/TraspasarMensajeroModal.tsx` | T22 — el modal. Cuerpo de `DeshacerAsignacionModal` + selector de `AsignarBodegaModal`, con la fase de **resultado** de `CorregirFechaReprogramacionModal` |
| `app/(app)/ordenes/_components/traspaso-error-messages.ts` | T22 — el mapeo de errores por causa + las cotas del motivo. Compara contra las constantes tipadas de `mensajes-traspaso.ts`, nunca contra literales duplicados |
| `tests/components/TraspasarMensajeroModal.test.tsx` | T24 — 24 casos sobre el componente real (R6/R7/R8/R28/R33/R35/R36/R37) |
| `tests/components/TraspasarMensajeroListado.test.tsx` | T24 — 9 casos sobre la barra de `/ordenes` (R3/R34) y el cableado barra → modal |

### Modificados

| Archivo | Qué cambia |
| --- | --- |
| `lib/types/orden-historial.ts` | T20 — `OrdenHistorialTraspasoDTO` y la unión de **tres** |
| `lib/services/OrdenHistorialService.ts` | T20 — `RANGO_POR_CLASE.traspaso_mensajero = 2`, tercer parámetro de `fusionarLineaDeTiempo`, cuarto parámetro **obligatorio** del constructor y la tercera lectura dentro del `Promise.all` |
| `app/(app)/ordenes/_components/HistorialOrdenTimeline.tsx` | T20 — la rama `case "traspaso_mensajero"` que faltaba para que el `const _exhaustivo: never` volviera a compilar |
| `app/(app)/ordenes/_components/OrdenesListado.tsx` | T23 — `abrirTraspasarMensajero`, `accionTraspasarMensajero`, el `case` de los dos estados traspasables y el montaje del modal |
| `lib/actions/traspasar-mensajero.ts` | **Se borra la anotación de excepción de `superficie-de-uso.guardia`** y queda escrito el episodio |
| **32 archivos** que construyen `new OrdenHistorialService(...)` | los **33 sitios** pasan ahora el repositorio nuevo (20 en `app/`+`lib/`, 1 en `scripts/`, 11 en `tests/`; `recepcion-satelite.ts` lo construye dos veces) |
| `tests/unit/types/orden-historial-union.test.ts` | la tercera clase en el `switch` de `etiquetaDe`, tres `@ts-expect-error` nuevos y el censo de `clase` |
| `tests/unit/services/orden-historial-fusion.test.ts` | T21 — fixture `traspaso()`, el doble de la tercera fuente y **8 casos nuevos** (R26/R29/R30 + no-regresión) |
| `tests/components/HistorialOrdenTimeline.test.tsx` | T21 — **8 casos nuevos** sobre la entrada de traspaso |
| `tests/unit/services/orden-historial-service.test.ts` | doble `traspasoRepo()` que devuelve lista vacía (no-regresión) |
| `tests/components/AsignacionBloqueoPorCierre.test.tsx` | censo 271/R32: `toHaveLength(2)` → **3**, con el motivo escrito (el tercer consumidor de `bloqueadosIds` es este modal) |

---

## F2. Las tres decisiones de esta tanda que conviene conocer al revisar

1. **El cuarto parámetro del constructor es OBLIGATORIO, como su vecino.** Podría haber sido
   opcional con «sin traspasos» por defecto y los 33 sitios no se habrían tocado. Se descartó por el
   mismo argumento que la 262 dejó escrito para el tercero: un cableado olvidado se convertiría en
   un drawer que **enseña menos de lo que hay** —justo sobre la orden cuyo mensajero cambió, que es
   la que más falta hace explicar— y **no rompería nada**. Con el obligatorio, olvidarlo es un rojo
   de `pnpm typecheck`.

2. **El rango del traspaso en el empate de instante es `2`, el último.** Es una regla arbitraria, y
   por eso se declara en vez de dejarla al `sort`. El criterio: un traspaso **no** cambia el estado
   (R21) ni el día (R16), así que cuando comparte instante con una transición o con una corrección,
   lo que pasó primero es aquello —el cambio real sobre la orden— y el traspaso es el apunte de
   quién la lleva a partir de ahí.

3. **El modal NO se cierra solo tras el éxito.** `onSuccess` está cableado a `revalidarTablas` y no a
   `handleSuccess`: el listado se relee detrás, pero el modal se queda con el desenlace a la vista.
   Cerrarlo de golpe se llevaría **las dos cifras (R36) y el aviso de la ruta (R33)**, que es
   exactamente lo que el arreglo manual del 2026-09-14 enseñó que hay que decir. Mismo criterio y
   mismo precedente que `CorregirFechaReprogramacionModal` (371).

   El aviso de la ruta sale **dos veces**: antes de confirmar (en cuanto hay destino elegido, cuando
   todavía se puede decidir) y en el resultado. No es duplicación: son dos momentos distintos de la
   misma consecuencia.

---

## F3. La guardia `@sin-superficie`: **verde, y medido**

La anotación se borró de `lib/actions/traspasar-mensajero.ts` al montar el modal.
`tests/unit/guards/superficie-de-uso.guardia.test.ts` pasa **18/18**.

Y no se da por bueno leyendo el código: se **midió** re-poniendo la anotación sobre el árbol ya
terminado, para comprobar que la otra mitad de la guardia la caza y **nombra la superficie**:

```
=== MUTACION: re-poner la anotacion con el modal ya montado ===
 FAIL  tests/unit/guards/superficie-de-uso.guardia.test.ts > ninguna anotacion `@sin-superficie`
       de accion sobrevive a su motivo
- Expected  []
+ Received  [
+   "lib/actions/traspasar-mensajero.ts:115 traspasarMensajero -> app/(app)/ordenes/_components/TraspasarMensajeroModal.tsx",
+ ]
 Test Files  1 failed (1)
      Tests  1 failed | 17 passed (18)
EXIT=1
```

Restaurado el árbol: `grep -c 'sin-superficie' lib/actions/traspasar-mensajero.ts` → **0**.

---

## F4. Mapa `R<n> → test` de esta tanda

Completa las siete filas que la bitácora del backend dejó marcadas como «frontend».

| R | Test que lo cubre |
| --- | --- |
| R3 | `TraspasarMensajeroListado.test.tsx` › «sin `accionesLote` no hay ni casilla ni acción» + «con casilla pero SIN acciones de flujo (la tienda) tampoco aparece». La puerta dura sigue siendo el `notFound()` de `app/(app)/ordenes/page.tsx` para `mensajero` y `adminSatelite` |
| R6 | `TraspasarMensajeroModal.test.tsx` › «lo dice con palabras y deja el confirmar apagado, SIN llamar a la acción» (+ «una orden SIN mensajero» y «selección vacía») |
| R7 | idem › «Andy no está entre los destinos posibles, y los otros dos sí» (las dos mitades: la ausencia sola estaría verde con una lista vacía) |
| R8 | idem › «el ORIGEN se muestra y NO se elige — no hay ningún control para cambiarlo» (un solo `combobox`, y es el del destino) + «el objeto enviado NO lleva ningún campo de origen» (`Object.keys(...).sort()`) |
| R26 | `HistorialOrdenTimeline.test.tsx` › «el rol que se pinta es el CONGELADO de CADA fila»; `orden-historial-fusion.test.ts` › «la fusión NO toca el rol del actor» |
| R28 | `TraspasarMensajeroModal.test.tsx` › 4 casos (sin motivo / 9 caracteres / sin destino / los dos puestos), los tres primeros afirmando `not.toHaveBeenCalled()` |
| R29 | `orden-historial-fusion.test.ts` › bloque «(b-427)», 8 casos; `HistorialOrdenTimeline.test.tsx` › «nombra al de ORIGEN, al de DESTINO, a quien lo ejecutó y su motivo» + «mezclado con las otras DOS clases» |
| R30 | `orden-historial-fusion.test.ts` › «DOS traspasos salen LOS DOS, en orden y sin alterarse» (literal a mano, campo a campo); `HistorialOrdenTimeline.test.tsx` › «la primera no se reescribe» |
| R33 | `TraspasarMensajeroModal.test.tsx` › «tras el éxito, el aviso se LEE, con el nombre de quien recibe» **buscando el texto del aviso**, no la ausencia de error + «y ANTES de confirmar» |
| R34 | `TraspasarMensajeroListado.test.tsx` › `en_reparto` y `ayuda_tienda` **sí**; `por_recoger`, `devolviendo_a_tienda` y `en_bodega_central` **no**, cada uno con su control positivo en la misma barra; + «con estados MEZCLADOS el traspaso desaparece» |
| R35 | `TraspasarMensajeroModal.test.tsx` › «Vas a pasar 3 orden(es) de Andy Cortés a Carlos Eduardo.» (literal a mano) + la variante sin destino elegido; `TraspasarMensajeroListado.test.tsx` › el mismo texto **abriendo desde la barra**, con el origen derivado de dos filas |
| R36 | `TraspasarMensajeroModal.test.tsx` › «con las cifras DEL SERVIDOR (31 y 31), no con el tamaño de la selección» (la selección es de 2: si la pantalla contara la selección, el caso cae) + `onSuccess` llamado una vez |
| R37 | idem › 8 causas, cada una con su literal a mano, + «ninguno de los mensajes lleva un uuid» |

---

## F5. Autocomprobación por mutación: **siete, ejecutadas, todas rojas**

Cada una: se aplicó al árbol, se corrieron los tests indicados, se restauró el árbol en un
`finally` y se verificó el ancla con `grep` después. Salida real.

```
=== M1: quitar la accion de los dos `case` traspasables ===
 Test Files  1 failed (1)
      Tests  5 failed | 4 passed (9)
 FAIL  TraspasarMensajeroListado > R34 > se ofrece en `en_reparto` — el caso de la ficha
 FAIL  TraspasarMensajeroListado > R34 > se ofrece en `ayuda_tienda`
 FAIL  TraspasarMensajeroListado > R34 > NO se ofrece en `devolviendo_a_tienda` (control positivo)
 FAIL  TraspasarMensajeroListado > R34 > con estados MEZCLADOS, el traspaso desaparece de la barra
 FAIL  TraspasarMensajeroListado > R35 > dice cuantas y de quien, y al confirmar manda UNA llamada
EXIT=1

=== M2: quitar el aviso de la ruta pendiente (R33) de la fase de resultado ===
 Test Files  1 failed (1)
      Tests  1 failed | 23 passed (24)
 FAIL  TraspasarMensajeroModal > R33 > tras el exito, el aviso se LEE, con el nombre de quien recibe
EXIT=1

=== M3: NO excluir al mensajero de origen del selector (R7) ===
 Test Files  1 failed (1)
      Tests  1 failed | 23 passed (24)
 FAIL  TraspasarMensajeroModal > R7 > Andy no esta entre los destinos posibles, y los otros dos si
EXIT=1

=== M4: contar la SELECCION en vez de las cifras del servidor (R36) ===
 Test Files  1 failed (1)
      Tests  1 failed | 23 passed (24)
 FAIL  TraspasarMensajeroModal > R36 > con las cifras DEL SERVIDOR (31 y 31), no con el tamano
EXIT=1

=== M5: pintar el rol VIVO en la linea de tiempo en vez del congelado (R26) ===
 Test Files  1 failed (1)
      Tests  2 failed | 21 passed (23)
 FAIL  HistorialOrdenTimeline > R29 > el traspaso nombra al de ORIGEN, al de DESTINO, a quien...
 FAIL  HistorialOrdenTimeline > R26 > el rol que se pinta es el CONGELADO de CADA fila
EXIT=1

=== M6: dar rango 0 al traspaso en el empate de instante ===
 Test Files  1 failed (1)
      Tests  2 failed | 32 passed (34)
 FAIL  fusion > 427/R29 > EMPATE EXACTO de instante: transicion, luego correccion, luego TRASPASO
 FAIL  fusion > 427/R29 > empatado SOLO con una correccion, el traspaso va DESPUES
EXIT=1

=== M7: no leer la tercera fuente en el servicio (el drawer que ensena menos) ===
 Test Files  1 failed (1)
      Tests  2 failed | 32 passed (34)
 FAIL  OrdenHistorialService > R41 > el `ok` trae YA fusionadas las entradas de las TRES fuentes
 FAIL  OrdenHistorialService > R41 > ordena en el servidor aunque los repos devuelvan al reves
EXIT=1

ARBOL RESTAURADO
```

Verificación de las siete anclas tras restaurar (`grep -n`, una por mutación): las siete volvieron a
su valor original antes de commitear.

---

## F6. Salida real de los comandos

```
$ pnpm exec tsc --noEmit
(sin salida)
TYPECHECK_EXIT=0
```

```
$ pnpm run lint
✖ 199 problems (0 errors, 199 warnings)
LINT_EXIT=0
```

> **199, el MISMO número que midió la tanda de backend**: esta tanda no añade ni un warning.

```
$ pnpm exec vitest run <los 7 archivos de test tocados o creados>
 Test Files  7 passed (7)
      Tests  129 passed (129)
   Duration  16.69s
```

```
$ pnpm run test:guardias
 Test Files  225 passed (225)
      Tests  3295 passed (3295)
GUARDIAS_EXIT=0
```

```
$ pnpm exec vitest related --run lib/types/orden-historial.ts \
    lib/services/OrdenHistorialService.ts lib/repositories/OrdenTraspasoRepository.ts \
    lib/interfaces/repositories/IOrdenTraspasoRepository.ts lib/actions/traspasar-mensajero.ts \
    'app/(app)/ordenes/_components/HistorialOrdenTimeline.tsx' \
    'app/(app)/ordenes/_components/TraspasarMensajeroModal.tsx' \
    'app/(app)/ordenes/_components/traspaso-error-messages.ts' \
    'app/(app)/ordenes/_components/OrdenesListado.tsx'

 Test Files  2 failed | 342 passed (344)
      Tests  3 failed | 4892 passed | 17 skipped (4912)
   Duration  240.36s
RELATED_EXIT=1
```

De los **3** rojos, **1 era de esta tanda y ya está arreglado**; los otros **2 venían de `895b3bdb`**
y siguen abiertos. Se detalla abajo porque un rojo sin dueño es lo que este repo paga más caro.

### El rojo que era mío, y qué era

`tests/components/AsignacionBloqueoPorCierre.test.tsx:251` (271/R32) cuenta cuántos modales de
`OrdenesListado.tsx` reciben `mensajerosBloqueadosIds={mensajerosBloqueadosIds}`: eran **2** y ahora
son **3**. Es un **censo cerrado que esta ficha tenía que ampliar**, que es justo para lo que existe:
traspasar es poner trabajo en la mano de alguien —igual que las dos asignaciones— y
`TraspasoMensajeroService` rechaza al destino bloqueado con el **mismo** motivo (R11). Se subió a 3
**con el motivo escrito**, y no se tocó nada más: subir el número sin añadir el consumidor deja ese
caso rojo, que es el punto.

### ⚠️ Los DOS rojos que NO son de esta tanda: vienen de `895b3bdb` y siguen abiertos

Los dos viven en `tests/integration/db/no-migration-102.test.ts` y **ya estaban rojos antes de esta
tanda**. Medido, no supuesto: el diff de frontend **no toca `db/` en absoluto** (`git status`), y
`git log -1` sobre las dos cosas que el test lee devuelve `895b3bdb` en las dos.

| Rojo | Qué lo causa | El arreglo, en una línea |
| --- | --- | --- |
| «la unica migracion de notificaciones es la de la 146, salvo las declaradas arriba» (`:131`) | la carpeta `20260917120100_notificacion_evento_traspaso` no está declarada | añadir `"_notificacion_evento_traspaso"` a `MIGRACIONES_NOTIFICACIONES_POSTERIORES` (`:68`) **con su motivo**, como las siete que ya están |
| «sin badge ni campana persistidos» (`:174`) | `db/schema.prisma` dice «campana» en **tres** comentarios de la 427 (líneas 2744, 2756, 2760) | reescribir esas tres líneas de prosa sin la palabra (el test busca la cadena en el archivo entero, comentarios incluidos) |

**No se arreglan aquí a propósito:** uno exige editar `db/schema.prisma` y el otro es la declaración
de una migración; las dos cosas son de la tanda de backend y están **fuera del alcance de
frontend**. Quedan nombradas con archivo, línea y arreglo para que no cuesten un ciclo de gate.

---

## F7. Lo que queda pendiente de esta ficha

**T25 — ver la app funcionando.** No se hizo en esta tanda. Doce mil tests en verde no han visto
nunca esta pantalla, así que sigue debiendo los cinco puntos que `tasks.md` enumera: el listado con
el mensajero nuevo, el destino viendo el hilo de chat con su historial **y su campanada**, el origen
sin el hilo **y con su propio aviso**, y la entrada del traspaso en el historial de una de las
órdenes. Requiere un solo dev server y una sesión de maestro.

**T26/T27** (las doce mutaciones del backend, ya ejecutadas arriba por su tanda; el gate completo y
la re-lectura de la lista de enums del `down.sql` contra `origin/dev`) siguen siendo del cierre.

---

## F8. Veredicto (frontend)

Tandas 6 y 7 completas: la línea de tiempo gana su tercera clase sin dejar ningún `switch` sin rama,
`/ordenes` ofrece el traspaso **exactamente** en `en_reparto` y `ayuda_tienda`, el modal deriva el
origen de la selección, excluye al origen del selector y dice en pantalla **las dos cifras y que la
ruta del que recibe queda pendiente de recalcularse**; `typecheck` y `lint` en cero errores, 129
tests propios verdes, las 225 guardias verdes —**incluida `superficie-de-uso`, con la anotación ya
borrada y su caducidad medida por mutación**— y las siete mutaciones del plan ejecutadas y todas
rojas.

---

## F9. El typecheck que dejé rojo, y los dos defectos que aparecieron al arreglarlo

> Añadido tras el reporte del coordinador. `dc230b7d` dejó **`pnpm typecheck` en rojo** con dos
> errores en `tests/components/TraspasarMensajeroModal.test.tsx:213`. Es el paso 2 del gate: deja
> rojo a cualquiera que corra después, no sólo a quien lo rompió.

### Por qué se me escapó, dicho sin adornos

**Corrí `tsc --noEmit` ANTES de escribir los archivos de test y nunca después.** El orden fue:
cablear la pantalla → typecheck (verde) → escribir los dos `*.test.tsx` → correr `vitest` sobre
ellos (verde) → commitear. `vitest` **no** hace comprobación de tipos —transpila y tira—, así que
24 tests en verde convivieron con dos errores de compilación sin decir nada. La regla que se me
olvidó es trivial: **el typecheck se corre al final, sobre el árbol que se va a commitear**, no en
mitad.

### Los dos errores, y el arreglo (sin silenciar nada)

```
tests/components/TraspasarMensajeroModal.test.tsx(213,42): error TS2322: Type 'null' is not assignable to type 'string'.
tests/components/TraspasarMensajeroModal.test.tsx(213,69): error TS2322: Type 'null' is not assignable to type '{ mensajeroAsignado: { id: string; nombre: string; }; }'.
```

**Causa real:** el helper `ordenDeAndy` no llevaba anotación de tipo y se auto-tipaba a partir de su
propio `return`, con `mensajeroAsignadoId: string` y `relaciones` **no nulables** — más estrecho que
`TraspasarMensajeroOrdenUI`, que es el contrato que el componente declara. `renderModal` heredaba esa
estrechez vía `ReturnType<typeof ordenDeAndy>`, así que el caso «una orden SIN mensajero» **no era
expresable**: el rojo salía en el test, no donde estaba la causa.

**Arreglo:** anotar los dos sitios contra `TraspasarMensajeroOrdenUI`, el tipo que el componente
exporta. Ni `@ts-expect-error`, ni `as any`, ni relajar la prop. Con eso los casos de borde son
expresables y, si el componente cambia su contrato, estos fixtures se mueven con él en vez de
seguir describiendo una forma que ya nadie acepta. El `id` del `mensajeroAsignado` se cae de los
fixtures porque el contrato sólo pide `nombre`; que la fila real (`OrdenListItemDTO`, con su
`{ id, nombre }`) encaje ahí lo demuestra `pnpm typecheck` sobre `OrdenesListado.tsx` —que le pasa
la selección entera— y lo ejercita de punta a punta `TraspasarMensajeroListado.test.tsx`.

### ⚠️ Y al medirlo salió un SEGUNDO defecto, éste de producto

El coordinador pidió re-correr `vitest related` además del typecheck, «porque un cambio de tipos en
un test suele mover también lo que el test afirma». Se hizo, y además **dos mutaciones** sobre el
camino que los fixtures tocaban. Una sobrevivió:

```
=== M9: quedarse con el PRIMER origen en vez de rechazar el lote de dos mensajeros (R6) ===
 Test Files  1 passed (1)
      Tests  24 passed (24)
EXIT=0
```

**Por qué sobrevivió, y por qué no era «un mutante equivalente» que se pueda archivar.** La condición
era `variosOrigenes || origenNombre === null`. Con dos orígenes, `origenId` ya es `null` y por tanto
`origenNombre` también, así que **`variosOrigenes` era lógica muerta**: apagarlo no cambiaba nada.
Pero la rama compartida tenía además un defecto **visible para una persona**: el caso de **un solo
origen cuyo nombre no se resuelve** se anunciaba como «la selección mezcla órdenes de varios
mensajeros», mandando a rehacer una selección que estaba bien.

**Arreglo:** las cuatro causas se separan en cuatro ramas, y la nueva tiene mensaje propio
(`AVISO_ORIGEN_DESCONOCIDO`). Caso nuevo: «un solo origen cuyo NOMBRE no se resuelve: mensaje propio,
no el de "mezcla mensajeros"», que afirma las **dos** mitades —que sale el suyo y que NO sale el
otro—, que es lo que impide que las dos causas vuelvan a compartir rama.

Re-ejecutadas las dos mutaciones sobre el árbol arreglado:

```
=== M8: tratar la orden SIN mensajero como si tuviera origen ===
 Test Files  1 failed (1)
      Tests  1 failed | 24 passed (25)
 FAIL  TraspasarMensajeroModal > R6 > una orden SIN mensajero tampoco es un traspaso: es una asignacion
EXIT=1

=== M9: quedarse con el PRIMER origen en vez de rechazar el lote de dos mensajeros (R6) ===
 Test Files  1 failed (1)
      Tests  1 failed | 24 passed (25)
 FAIL  TraspasarMensajeroModal > R6 > lo dice con palabras y deja el confirmar apagado, SIN llamar a la accion
EXIT=1

ARBOL RESTAURADO
```

### Salida real tras el arreglo

```
$ pnpm exec tsc --noEmit
TYPECHECK_EXIT=0        # el exit va DENTRO del log, no tapado por un `echo`
```

```
$ pnpm run lint
✖ 199 problems (0 errors, 199 warnings)
LINT_EXIT=0
```

```
$ pnpm exec vitest related --run tests/components/TraspasarMensajeroModal.test.tsx \
    'app/(app)/ordenes/_components/TraspasarMensajeroModal.tsx'
 Test Files  21 passed (21)
      Tests  274 passed (274)
RELATED_EXIT=0
```

```
$ pnpm exec vitest run <los 7 archivos de test de esta ficha>
 Test Files  7 passed (7)
      Tests  130 passed (130)      # 129 + el caso nuevo de la causa separada
```

> Los **dos rojos de `no-migration-102`** que esta bitácora dejó nombrados en §F6 los cerró el
> backend en `87efe88b`, que ya está en la rama por debajo de este arreglo.

---

## 9. El gate completo salió ROJO (`progress/gate_427.log`, `INIT_EXIT=1`): los 10 rojos, uno por uno

10 tests fallidos en 5 archivos, todos en `tests/integration/db/`. **Nueve eran míos; uno no.**

### 9.1 Los nueve míos: los censos de enum de las fichas ANTERIORES

Cada ficha que amplió el catálogo de avisos dejó su propio test de migración, y ese test afirma —con
una lista **literal y cerrada**— qué valores tiene el enum y **que los posteriores quedan AL FINAL y
en orden de adición**. Mis tres valores (`traspaso_ordenes_recibido`, `traspaso_ordenes_cedido`,
`orden_traspaso_lote`) son posteriores a todas ellas, así que rompieron sus listas:

| Archivo | Tests rojos | Qué faltaba |
| --- | ---: | --- |
| `notificacion-evento-dia-reparto-corregido-migration.test.ts` (262) | 4 | 2 listas de schema + 2 listas de «la base aplicada» |
| `notificacion-evento-postulacion-recurso-migration.test.ts` (253) | 4 | idem |
| `notificacion-evento-gasto-fijo-migration.test.ts` (333) | 1 | eventos + entidades de «la base aplicada» |
| `notificacion-evento-bloqueo-cierre-migration.test.ts` (271) | 1 | sólo eventos (su `up` no tocó el otro enum) |

**Se cerraron ampliando las listas, en su posición correcta (al final, en orden de adición) y con el
motivo escrito.** 6 inserciones de eventos y 5 de entidades, repartidas en 4 archivos.

**Lo que NO se hizo, y queda dicho:** no se relajó ni una aserción —ningún `toEqual` cambió de forma,
ninguna lista se derivó del enum (una lista que se lee a sí misma está siempre verde) y nada fue al
baseline de rojos conocidos—. `git diff` sobre los cuatro archivos **no borra ni una línea**: sólo
añade.

> Y el mismo agujero por el que entró esto: ya había ampliado
> `MIGRACIONES_NOTIFICACIONES_POSTERIORES` en `no-migration-102.test.ts` (commit `87efe88b`), pero
> **ése es otro censo**. En este repo, añadir un valor a `notificacion_evento` /
> `notificacion_entidad_tipo` obliga hoy a tocar **seis** sitios, y conviene tenerlos escritos:
>
> 1. `db/schema.prisma` (los dos enums);
> 2. `lib/types/notificacion.ts` (las dos uniones);
> 3. `lib/notificaciones/push-elegibles.ts` y `catalogo-avisos.ts` (los dos `Record` exhaustivos —
>    éstos avisan solos: **no compilan**);
> 4. `tests/unit/services/notificacion-productores-wiring.test.ts` (dos inventarios literales);
> 5. `tests/integration/db/no-migration-102.test.ts` (censo de migraciones de notificación);
> 6. **los censos de migración de las fichas anteriores**: 253, 262, 271, 333 y 403 — que es el que
>    se olvidó, porque los tres primeros no salen en `vitest related` del diff (una migración no la
>    importa nadie) y sólo aparecen en el gate completo.
>
> Los de 401, 409, 412 y 413 **no** hicieron falta: sus listas usan `slice`/`indexOf` en vez de una
> igualdad cerrada contra la base.

### 9.2 El décimo NO era mío: `ranking-snapshot-migration.test.ts`

Falla en «196 / bloque C — reejecutar el cron sobre una fecha ya congelada (R12/R14)» **con un
`40P01` («se ha detectado un deadlock») en un `DROP SCHEMA IF EXISTS … CASCADE` dentro de un
`finally`** — no con una aserción. **Medido, no supuesto:**

| Medición | Resultado |
| --- | --- |
| ¿El archivo nombra algo de la 427? (`traspaso`, `notificacion_evento`, `notificacion_entidad_tipo`, `orden_traspaso`) | **0 ocurrencias** |
| ¿Qué commit lo tocó por última vez? | `ac0d5d55 feat(196)` — ningún commit de la 427 |
| ¿Está en `tests/baseline-rojos.json`? | no |
| Corrido **aislado**, 3 veces seguidas | **49/49 verde las tres** |
| Corrido junto a otros cinco de `integration/db` | el `40P01` **reaparece, pero en OTRO archivo** (`…dia-reparto-corregido…`), y el ranking pasa |

Es la familia de fallo que el propio arnés documenta en `_postgres-real.ts`
(`CLAVE_LOCK_ESCRITURA_REAL`): varios archivos corren en paralelo, cada uno abre una transacción
larga y toman los mismos locks **en orden distinto**; Postgres mata a una de las dos. Que el rojo
**cambie de archivo entre corridas** es la firma de la contención, no de una rotura determinista.

**No se toca**, tal como pidió el coordinador. Lo que sí queda medido, por si se decide atacarlo:

| Archivo | `enTransaccionRevertida` | `serializarEscriturasReales` |
| --- | ---: | ---: |
| `notificacion-evento-traspaso-migration` (427, **mío**) | 3 | **3** |
| `notificacion-evento-bloqueo-cierre-migration` (271) | 2 | 2 |
| `ranking-snapshot-migration` (196) | 1 | **0** |
| `notificacion-evento-dia-reparto-corregido-migration` (262) | 0 | **0** |
| `notificacion-evento-postulacion-recurso-migration` (253) | 0 | **0** |

El archivo de esta ficha **sí** toma el lock de aviso en las tres transacciones donde escribe; los
tres que no lo toman son anteriores. Dicho con honestidad: la 427 **añade un archivo más** que
escribe en `notificacion` y `push_envio_dia`, así que sube la contención sobre esas tablas y hace
**más probable** un flake que ya existía — aunque no lo cause. Si el coordinador quiere cerrarlo, el
remedio está escrito en el arnés y es de una línea por transacción, pero son ficheros de otras
fichas y no se tocan desde aquí.

### 9.3 Estado tras el arreglo

```
$ pnpm exec vitest related --run db/schema.prisma <los 4 censos>
 Test Files  4 passed (4)
      Tests  76 passed (76)
RELATED_EXIT=0

$ # los CINCO de integración, uno por uno (sin contención entre ellos)
notificacion-evento-dia-reparto-corregido-migration    Tests  22 passed (22)
notificacion-evento-postulacion-recurso-migration      Tests  19 passed (19)
notificacion-evento-gasto-fijo-migration               Tests  20 passed (20)
notificacion-evento-bloqueo-cierre-migration           Tests  15 passed (15)
ranking-snapshot-migration                             Tests  49 passed (49)

$ # los 7 de la 427 + el 102, para que el cambio de censos no moviera nada propio
 Test Files  8 passed (8)
      Tests  152 passed (152)
```

## EL ROJO DEL GATE QUE NO ES DE ESTA FICHA (leader, 2026-09-14)

El gate completo salió `INIT_EXIT=1` **dos veces**, y las dos por
`tests/integration/db/ranking-snapshot-migration.test.ts` con `40P01` (**deadlock**) dentro de un
`DROP SCHEMA … CASCADE`. **No es de la 427**, y esto es lo medido, no lo supuesto:

| Evidencia | Resultado |
| --- | --- |
| Corrida 1 del gate | falla en el **bloque C** |
| Corrida 2 del gate | falla en el **bloque B** — *bloque distinto* |
| Aislado, 3 corridas seguidas (leader) | **49/49 verde** las tres |
| Aislado, 3 corridas (backend) | verde |
| Referencias a la 427 en ese archivo | **cero**; su último commit es `ac0d5d55 feat(196)` |
| El mismo `40P01` corriendo en paralelo | reaparece **en otro archivo distinto** |

Un defecto real es determinista: fallaría en el mismo sitio. Éste cambia de bloque entre corridas
y desaparece al correr solo, que es la firma de un **flake de concurrencia** entre archivos de
`integration/db` sobre la misma base local.

**NO se mete en el baseline de rojos conocidos.** Taparlo ahí lo volvería invisible también en un
entorno donde sí fuera un defecto real; queda escrito aquí para que el siguiente que lo vea no
gaste el diagnóstico otra vez. Los otros **9 rojos de la primera corrida SÍ eran de la ficha** y se
cerraron ampliando los censos de enum de las fichas 262, 253, 333 y 271 **sin borrar ni una línea
de aserción**.

> **Revisión 427/M2 (textos del modal), 2026-09-14:** «orden(es)» y «conversación(es)» pasan a singular y plural explícitos con el criterio `=== 1` de los emisores de la ficha —también el pronombre «se la / se las» de la confirmación—; el test del modal gana los casos de 1 y de varias para las dos palabras con literales a mano, incluidas filas MIXTAS (1 orden y 2 conversaciones, 3 órdenes y 1 conversación, 1 orden y 0 conversaciones) que caerían con una sola decisión para las dos, y `TraspasarMensajeroListado.test.tsx` actualiza sus dos literales, que afirmaban el texto viejo.
