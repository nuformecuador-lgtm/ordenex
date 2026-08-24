# Feature 262 — Tasks

> Lee `requirements.md` y `design.md` antes. Cada task lleva su **criterio de hecho**; `[P]` = puede
> ir en paralelo con las de su mismo bloque que no dependan de ella.
>
> **Secuencia entre bloques:** el bloque **BACKEND** va primero (zona `fullstack` = backend→frontend,
> nunca a la vez). El **FRONTEND** arranca cuando `B2` (textos) y `B3` (contratos) estén en la rama;
> el resto del backend puede seguir en paralelo a partir de ahí.
>
> ⬛ **Los dos bloques nuevos.** El **BLOQUE AVISO** (P2) es **independiente** de todo lo demás salvo
> del orden de las migraciones y puede ir en paralelo desde el principio. El **BLOQUE HISTORIAL**
> (P1) depende de `B1` (la tabla) y su `B24` es un **contrato**: `F7`/`F8` no arrancan hasta que
> `B24` y `B26` estén en la rama. `B24` **rompe el build a propósito** en varios archivos a la vez;
> se hace de una sentada, no a medias.
>
> ⚠️ **El gate lo corre el leader, no el subagente.** `backend_dev` / `frontend_dev` corren
> `pnpm typecheck`, `pnpm lint` y `pnpm exec vitest related --run <sus archivos>`. Nada más. Y el
> gate **no se corre en paralelo** con un subagente que esté mutando el árbol: leería el árbol a
> medias y su veredicto no valdría.
>
> ⚠️ **`./init.sh --rapido` SE NIEGA en esta ficha, por dos vías independientes:** el diff toca
> `db/migrations/**` + `db/schema.prisma` y además `lib/types/**` (`orden.ts`,
> `recepcion-satelite.ts`). El gate **COMPLETO** es obligatorio antes del PR. No es una elección.
>
> ⬛ **2026-08-22 — LA PUERTA HUMANA ENSANCHÓ LA FICHA, y ahora las vías son CINCO.** P1 y P2 se
> respondieron **SÍ**, en contra de la recomendación del spec. Entran dos bloques nuevos —**BLOQUE
> HISTORIAL (P1)** y **BLOQUE AVISO (P2)**— y una migración más. Las cinco vías por las que el modo
> rápido se niega: (1) migración del rastro; (2) migración de los **dos enums** de la campana; (3)
> `db/schema.prisma`; (4) `lib/types/orden.ts` + `lib/types/recepcion-satelite.ts`; (5)
> `lib/types/notificacion.ts` + `lib/types/orden-historial.ts`. **Basta una; hay cinco.**
>
> ⬛ **El criterio de «hecho» de esta ficha incluye el gate COMPLETO en verde** (**C1**), con
> `INIT_EXIT=$?` **escrito dentro del log**: en este repo un `echo` posterior ya tapó un gate rojo
> haciéndolo pasar por «exit code 0». Ninguna task se marca `[x]` a cuenta de que «el rápido pasó».
>
> ⬛ **P3 no genera ninguna task**: la respuesta fue «basta hoy/mañana», o sea **no cambia nada**.
> Su verificación es la **ausencia** de `lib/types/dia-reparto.ts` y `lib/utils/dia-reparto.ts` en el
> diff, y está en **C6**.

---

## ⬛ ESTADO DE CIERRE — 2026-08-23

> Escrito al cerrar los bloqueantes de `progress/review_262.md`. Hasta hoy este archivo tenía
> **1 de 46** tasks marcada, que es exactamente el estado en el que «casi todo hecho» y «casi nada
> hecho» se leen igual. Las marcas de abajo **no se pusieron a ojo**: salen de las cuatro bitácoras
> (`progress/impl_262_{backend,frontend,historial,historial_ui}.md`) y de lo que la revisión
> re-midió por su cuenta sobre el árbol.

**42 de 46 hechas. Cuatro siguen vivas**, y ninguna de las cuatro es de implementación:

| Viva | Por qué sigue viva, en una línea |
| --- | --- |
| **`B0.2`** | La foto de `M1` contra producción es del **2026-08-22 04:27 CR** y caducó; hay que repetirla, y es del **leader** (el MCP de Supabase). |
| **`C3`** | Es «`B0.2` hecha y escrita antes de desplegar»: cuelga de la anterior y cae con ella. |
| **`C7`** | `P4` (¿la tienda lee el motivo?) y `P5` (¿el `adminSatelite` lee el rastro que escribe?) **no se han llevado a la puerta humana**, y el spec las quiere respondidas ANTES de desplegar. |
| **`F6`** | «Ver la app» **no se ha ejecutado**: necesita preview desplegado y cuentas de los tres roles. Es LA deuda de la ficha, está anotada junto al código y bajo guardia. |

**Lo que cambió hoy y por qué importa.** `B15` estaba hecha de facto pero **sin su evidencia
escrita**, y de ella colgaba `R32` — que resultó **no tener ningún test**. La revisión lo midió:
inyectando en `corregirDiaRepartoLote` el borrado de las paradas de la ruta, **3.302 tests
siguieron verdes**. `R32` ya tiene su test (bloque R32 de `correccion-dia-reparto-efectos.int`,
dentro de **`B13`**) y se demostró que muerde con esa misma mutación. `B15` conserva su valor —la
no-regresión— pero **deja de figurar como el test de `R32`**: correr suites ajenas no puede
demostrar una propiedad que nadie afirma.

---

## BLOQUE 0 — Mediciones (antes de nada, y otra vez antes de desplegar)

- [x] **B0.1 — M1 y M2 contra producción, SOLO LECTURA (MCP de Supabase).** ✅ **2026-08-22, 04:27 CR. M1 = 0** (sin acotar estado, así que `por_recoger` entra) y **M2 = 35, pero NINGUNA en `por_recoger` ni `en_reparto`**: las 35 están en estados que R6 excluye. **D3' NO se re-abre.** Números y desglose en `progress/impl_262_backend.md`. Las corre **el leader**:
  el subagente no tiene el MCP y `DATABASE_URL` de producción es *sensitive*.
  - **M1**: órdenes con `fecha_reparto > <día CR en curso>`, agrupadas por `estatus.value`, con su
    mensajero. (La 261 midió **2** el 2026-08-21, pero **acotada a `en_reparto`/`ayuda_tienda`**:
    aquí `por_recoger` entra, y es el caso principal.)
  - **M2**: órdenes con `mensajero_asignado_id IS NOT NULL` y `fecha_reparto IS NULL`.
  **Hecho:** las dos consultas y sus números pegados en `progress/impl_262_backend.md`, con la fecha
  y la **hora CR** de la corrida. El número **se escribe**; no se resume como «son pocas».
  ⚠️ Si **M2** devuelve un número grande, la decisión **D3'** (`design.md` §4.4) se re-abre: se para
  y se pregunta.

- [ ] **B0.2 — Re-medir M1 justo antes de desplegar.** Es una foto y caduca.
  **Hecho:** segunda tanda pegada con su hora, al lado de la primera.
  ⛔ **VIVA, y ya CADUCÓ**: los números de `B0.1` son del **2026-08-22 04:27 CR** y hoy es el 23.
  Es del **leader**: el subagente no tiene el MCP de Supabase y la `DATABASE_URL` de producción es
  *sensitive*.

---

## BLOQUE BACKEND

### Cimientos

- [x] **B1 — La tabla del rastro: esquema + migración + `down.sql` + RLS.** (sin dependencias)
  `db/schema.prisma`: `model OrdenDiaRepartoCambio` (`design.md` §5.1) y sus dos relaciones inversas
  (`Orden.diaRepartoCambios`, `Usuario`). Migración nueva con **`migration.sql`** (tabla + 2 FK +
  `CHECK (fecha_nueva <> fecha_anterior)` + 2 índices + `ENABLE ROW LEVEL SECURITY`) y **`down.sql`**
  (`DROP TABLE IF EXISTS`, diciendo en voz alta que es destructivo). Molde:
  `db/migrations/20260820200000_postulacion_recurso/`.
  **Hecho, cuatro cosas:** (1) `pnpm run db:migrate` aplica; (2) `pnpm run db:rollback` revierte y
  vuelve a aplicar sin residuos; (3) `prisma migrate status` no reporta drift; (4) el modelo **no
  tiene** `updated_at` ni `deleted_at` (**R23**).
  ⚠️ La migración **no se edita después de aplicarse**: si hay que cambiar algo, migración nueva.

- [x] **B2 `[P]` — Textos, en una sola fuente.** (sin dependencias)
  `lib/utils/dia-reparto-textos.ts`: `avisoDiaActualDeLaOrden(fechaISO)` («hoy está para el 22 de
  agosto») y el título/ayuda del selector en modo corrección. Reutiliza `fechaLegible`; **no** se
  reescribe `confirmacionDiaReparto`, se **usa** (**R18**).
  **Hecho:** el archivo sigue **sin importar `Date` ni `Intl`** (**R17**), y no aparece ninguna sigla
  ni ningún nombre de columna en el texto visible.

- [x] **B3 — Contratos.** (sin dependencias)
  - `IOrdenRepository`: `corregirDiaRepartoLote(...)`, `CorreccionDiaConflictoError`, y
    `OrdenTransicionRow.fechaReparto: Date | null` **sin `?`**.
  - `ICorreccionDiaRepartoService` (nuevo): `corregir(input, actor, now?: Date)` con el union
    `ok | forbidden | sin_zona | conflict | validation_error`.
  - `lib/types/orden.ts`: `OrdenListItemDTO.fechaRepartoISO?: string | null`.
  - `lib/types/recepcion-satelite.ts`: lo mismo en `RecepcionSateliteDTO`.
  **Hecho:** `pnpm typecheck` señala **todos** los llamadores y fixtures que faltan por actualizar —
  ese rojo es el objetivo de quitar el `?` de `fechaReparto`, no un accidente.

### La escritura

- [x] **B4 — El choke point del rastro.** (dep. B1, B3)
  `lib/repositories/registrar-cambio-dia-reparto.ts`, molde de `registrar-cambio-estado.ts` pero sin
  webhook, sin notificaciones y sin catálogo: un `createMany` en el `tx` en curso, con la regla
  escrita arriba (`design.md` §5.3).
  **Hecho ✅** no-op con lista vacía; y **no existe ningún otro sitio** que inserte en esa tabla.
  El `grep` del árbol (`lib/`, `app/`, `scripts/`, `tests/`) sobre `ordenDiaRepartoCambio` lo
  corrió la revisión y devolvió **una sola escritura** — queda pegado en `progress/review_262.md`
  §menor (e), que además dice «no hace falta repetirlo».

- [x] **B5 — La escritura guardada.** (dep. B1, B3, B4)
  `OrdenRepository.corregirDiaRepartoLote`: `$transaction` con (1) `SELECT … ORDER BY "id" FOR
  UPDATE`, (2) `UPDATE` guardado con `RETURNING "id"`, (3) `throw` si no ganaron todas, (4) rastro en
  la misma tx. SQL literal en `design.md` §6.1. El día entra como **texto `::date`** vía
  `fechaRepartoComoTexto`; `updated_at` a mano.
  **Hecho:** el `SET` **no menciona `asignado_at`** (**R27**) y el `WHERE` lleva las cinco guardas
  (estado, mensajero, día presente, día distinto, no borrada) más la zona cuando aplica. B12 en
  verde.

- [x] **B6 — El servicio.** (dep. B3, B5, B2)
  `lib/services/CorreccionDiaRepartoService.ts`: rol (`esAccesoTotal` **o** `adminSatelite`), zona
  server-side, `ESTADOS_CON_DIA_DE_REPARTO_VIVO`, pre-chequeo por orden con **motivo tipado**
  (no existe / borrada / estado no admitido / sin mensajero / sin día / ya es de ese día),
  `resolverFechaReparto(input.dia, now)` **una vez** para el lote, y traducción del
  `CorreccionDiaConflictoError` a `conflict` con detalle por orden (patrón `detalleCarrera` de la
  149).
  **Hecho:** el `Pick` del repo que el servicio recibe **NO incluye**
  `findMensajerosBloqueadosParaGestion` — que un cierre pendiente no bloquee (**R14**) es imposible
  de romper por descuido si el método no está en el tipo (patrón `DeshacerAsignacionRepo`).

  > ⚠️ **NOTA DE CADUCIDAD — 2026-08-23 (feature 271).** El método ya no se llama
  > `findMensajerosBloqueadosParaGestion` (es `findMensajerosBloqueadosPorCierres`) y la regla que
  > sostenía dejarlo fuera —«recibir asignaciones no se bloquea nunca», feature 241— **está
  > revertida**. **Lo hecho sigue siendo correcto** y el `Pick` sigue sin el método, pero por su
  > otra razón: corregir el día de una orden que el mensajero ya lleva encima no es trabajo nuevo.
  > **No se reescribe esta tarea**: es la foto de su momento. Regla vigente en
  > `specs/271-segundo-cierre-y-bloqueo/requirements.md`.

- [x] **B7 — La Server Action.** (dep. B6)
  `lib/actions/corregir-dia-reparto.ts`, molde literal de `lib/actions/deshacer-asignacion.ts`:
  `withErrorHandler` + `resolveActorFromSession` + zod (`ordenIds` uuid `.min(1)`, `dia`
  `diaRepartoSchema` **sin `.default`**, `motivo` `trim().min(10).max(300)`) + fábrica del servicio.
  **Hecho:** `parse({ ordenIds, motivo })` **sin `dia`** falla (**R2**, `design.md` §4.3), y el
  motivo de sólo espacios falla por `min(10)` tras el `trim`.

- [x] **B8 `[P]` — El día viaja en los dos DTO de listado.** (dep. B3)
  `OrdenRepository` (listado de `/ordenes`) y el repo del listado satélite emiten `fechaRepartoISO`
  ya serializada `YYYY-MM-DD` (patrón `fechaReprogramacion`, `lib/types/orden.ts:322-329`).
  **Hecho:** el DTO **no** lleva un `Date` (el DataTable descarta objetos al renderizar) y el
  navegador no construye ninguna fecha (**R17**).

### Las guardias

- [x] **B9 — ⚠️ La guardia de la invariante, ensanchada.** (dep. B5)
  `tests/unit/guards/fecha-reparto-acompana-asignado-at.guardia.test.ts`: **lo que ya vigila no se
  toca**. Se añade el censo «escrituras del DÍA» y las cláusulas **(d1)-(d4)** de `design.md` §6.3,
  con la excepción declarada (archivo + conjunto **exacto** de columnas + **exactamente una**), su
  **fecha**, su **motivo** y el puntero a `specs/262-corregir-dia-reparto`.
  **Hecho, tres cosas:** (1) cada detector es una **función pura con autocomprobación** —un texto que
  infringe y otro que no—, incluida **la forma exacta** del `SET` de B5 y su variante infractora
  (`"asignado_at" = NULL` añadido); (2) las cuatro cláusulas viejas siguen en verde **sin tocarlas**;
  (3) M-k, M-q y M-w (bloque de mutaciones) la matan.
  ⚠️ **Esta task es el corazón de la ficha.** Sin ella, la excepción a 246/R10 queda declarada sólo
  en prosa y la próxima escritura del día entra por la misma puerta sin que nadie se entere —
  medido: la guardia actual **ni siquiera ve** una escritura que no toque `asignado_at`.

- [x] **B10 `[P]` — El censo de «la carga del mensajero» gana un miembro.** (dep. B6)
  `tests/unit/guards/carga-del-mensajero.guardia.test.ts`: `ESTADOS_CON_DIA_DE_REPARTO_VIVO` entra en
  `FAMILIA`, con `incluyeAyuda: true` y su razón escrita. El campo `pregunta` gana un tercer valor,
  `"donde vive el dia de reparto"`, **declarado**: un miembro nuevo que se cuele respondiendo otra
  pregunta deja el censo diciendo una cosa por otra.
  **Hecho:** la guardia en verde, y quitar `ayuda_tienda` de la lista la pone roja (M-s).

### Tests del backend

- [x] **B11 — Tests de servicio, con dobles.** (dep. B6)
  `tests/unit/services/correccion-dia-reparto.test.ts`. Cubren: rol (**R11**), zona del
  `adminSatelite` y `sin_zona` (**R12**), cada motivo del pre-chequeo por separado —estado no
  admitido con **su nombre** (**R6**), sin mensajero y sin día (**R5**), ya es de ese día (**R7**)—,
  **todo-o-nada** con 0 llamadas al repo (**R8**), dos `now` distintos → dos fechas distintas
  (**R2**), mensajero con cierre pendiente → **procede** (**R14**), y `mensajero`/`adminTienda` →
  `forbidden` (**R15**).
  **Hecho:** verde, y M-a … M-f producen rojo **con nombre**.

- [x] **B12 — ⚠️ Postgres real: la escritura y el rastro.** (dep. B5)
  `tests/integration/db/correccion-dia-reparto.int.test.ts`, con `_postgres-real.ts`.
  1. Siembra órdenes del mismo mensajero: una en `por_recoger` con día = mañana, una en `en_reparto`
     con día = mañana, una con día = hoy, una **sin** día, una de **otra zona**.
  2. Corrige a «hoy» → **sólo** las que debían: la fila queda con el día nuevo y **`asignado_at`,
     `mensajero_asignado_id`, `estatus_id` y `num_guia` IDÉNTICOS** (**R1**, **R27**).
  3. El rastro tiene **una fila por orden corregida**, con `fecha_anterior` = el día que tenía,
     `fecha_nueva`, actor y motivo (**R20**, **R21**, **R22**).
  4. Un lote donde **una** orden pierde la guarda → `throw` → **ninguna** orden corregida y **cero**
     filas de rastro (**R8**, **R22**).
  5. Con `adminSatelite`: una orden de otra zona no se corrige aunque venga en `ordenIds` (**R12**).
  6. **La trampa horaria, probada de verdad:** dentro de la transacción, `SET LOCAL TIME ZONE
     'America/Costa_Rica'` antes de escribir → el día persistido **sigue siendo el correcto**
     (mata M-p, que es pasar el `Date` sin `::date`).
  **Hecho:** verde con base; `describe.skip` **visible** sin base; **si `fksDeOrden` devuelve `null`
  el test revienta, no retorna** (un `if (!fks) return;` reporta `passed` sin comprobar nada). Todo
  dentro de `enTransaccionRevertida`, con `serializarEscriturasReales` como primera sentencia.

- [x] **B13 `[P]` — Postgres real: las ausencias y las consecuencias.** (dep. B1, B5)
  `tests/integration/db/correccion-dia-reparto-efectos.int.test.ts`.
  - **Ninguna** fila nueva en `orden_historial_estado` para la orden corregida, y su conteo de
    intentos de entrega **no cambia** (**R25**).
  - `pg_class.relrowsecurity` es `true` para `orden_dia_reparto_cambio` (**R26**). Se lee **de la
    base**, no del `.sql`: afirmarlo leyendo el archivo que lo escribe es una aserción contra su
    propia fuente.
  - El predicado del corte `(fecha_reparto IS NULL OR fecha_reparto <= diaCerrado)`: **no** la cumple
    tras corregir a mañana, **sí** la cumple tras corregir a hoy (**R30**).
  - Con la fila ya corregida a hoy, la guarda de reserva de la 261 **deja de dispararse** para esa
    orden, sin escribir nada más (**R31**).
  - ⬛ **AÑADIDO EL 2026-08-23 — el bloque `R32`, que es lo que cerró el bloqueante 1 de la
    revisión.** Con **ruta SEMBRADA** (mensajero propio, cabecera vigente y una parada posicionada
    con su tramo): las **filas enteras** de `ruta_optimizada` y `ruta_optimizada_parada` son las
    mismas antes y después; los **indicadores del portal** —`kpis`, `RutaResumenDTO` y la secuencia
    por orden, por `MisAsignacionesService.listarMisAsignaciones` con los repositorios **reales**
    sobre la transacción— tampoco se mueven; y el **delta de `jobs` `optimizacion_ruta`** es cero.
  **Hecho ✅:** verde (**11 tests**); mismas reglas de no-saltarse que B12. Las dos mutaciones del
  bloque R32 se corrieron y **matan con nombre** (salida real en `progress/impl_262_historial.md`
  §9).

- [x] **B14 — El cierre del riesgo de la 261, en sus TRES soportes.** (dep. B6, F3, F4)
  1. `lib/interfaces/services/IMisAsignacionesService.ts`: la nota del riesgo aceptado se
     **sustituye** por su cierre fechado (`design.md` §9), **conservando** el razonamiento de por qué
     se aceptó y diciendo en **pasado** que la única salida fue un `UPDATE` a mano.
  2. `tests/unit/guards/d5-revertida.guardia.test.ts`, mitad (e): `PIEZAS_DEL_AGUJERO` pasa a exigir
     las piezas del **cierre**. **No se borra la mitad (e)** y **no se relaja a un `toBe(true)`**.
  3. `specs/261-dia-reparto-protege/requirements.md` (límite declarado 2) y `design.md` §7.2:
     **apéndice fechado** marcando el agujero cerrado por esta ficha.
  **Hecho:** `git diff` sobre el spec de la 261 muestra **sólo adiciones**, cero líneas borradas
  (**R36**); la guardia en verde; M-r la mata.

- [x] **B15 `[P]` — No-regresión.** (dep. B5)
  - `tests/unit/guards/fecha-reparto-acompana-asignado-at.guardia.test.ts` en verde **con sus cuatro
    cláusulas originales intactas**.
  - `corte-diario-service.test.ts` y el repo del corte, en verde (**R30** no rompe nada de la 109).
  - Los tests de las dos vías de asignación (246) y del deshacer (149/261), en verde: esta ficha
    **no retira** ninguna escritura del día (**R33**).
  - La ruta optimizada: `findParadasEnReparto` no cambia y no hay reoptimización encolada desde la
    corrección (**R32**).
  **Hecho ✅ 2026-08-23 — LOS CUATRO PUNTOS, CON LA LISTA DE ARCHIVOS Y SUS NÚMEROS.** Corrido
  con `pnpm exec vitest run <archivos>` en tres tandas; **27 archivos, 549 tests, 0 rojos**:
  - **(1) la guardia de la invariante del día** — `fecha-reparto-acompana-asignado-at.guardia`
    (más `rastreo-sin-ruta-nueva.guardia`, de la 229, corrida de paso); **(2) el corte de la 109**
    — `corte-diario-service`, `corte-diario-seleccion`, `corte-diario-repository` →
    **5 archivos, 79 tests**.
  - **(3) las dos vías de asignación (246) y el deshacer (149/261)** —
    `guia-asignacion-service`, `guia-asignacion-gate-coordenadas`, `asignacion-satelite-service`,
    `asignacion-satelite-gate-coordenadas`, `orden-repository.asignacion-satelite`,
    `deshacer-asignacion-service`, `deshacer-asignacion.cierre-asimetria`,
    `orden-repository.deshacer-asignacion`, `mis-asignaciones-reserva-bloquea`,
    `cierre-dia-deshacer-dia-reparto`, `deshacer-gestion-conserva-reserva.int` →
    **11 archivos, 227 tests**.
  - **(4) la ruta optimizada y los indicadores** — `optimizacion-ruta-service`,
    `optimizacion-ruta-encolado`, `optimizacion-ruta-degradacion`, `optimizacion-ruta-origen`,
    `optimizacion-ruta-trazado`, `optimizacion-ruta-tramo-vivo`, `mis-asignaciones-orden-ruta`,
    `mis-asignaciones-service`, `orden-repository`, `ruta-optimizada-migracion.int`,
    `ruta-optimizada-rollback.int` → **11 archivos, 243 tests**.
  - **La guardia sólo CRECIÓ**: `git diff --numstat` del rango de la 262 sobre ese archivo da
    **277 adiciones y 3 borrados**, y los tres borrados son las líneas de armazón del constructor
    del censo (`const ESCRITURAS: Escritura[] = (() => {`, el `out.push(...)` y su `})();`) —
    **ninguna aserción**.
  - **`findParadasEnReparto` no aparece en el diff de la 262**: el `git diff` de los cuatro merges
    (#463, #465, #472, #474) contra su primer padre no lo nombra ni una vez, y los únicos archivos
    de ruta/corte/portal que la ficha toca son **`lib/interfaces/services/IMisAsignacionesService.ts`**
    (la nota del cierre de la 261, `B14`: prosa, no comportamiento). `RutaOptimizadaRepository.ts`,
    `OptimizacionRutaService.ts` y `MisAsignacionesService.ts` **no se tocaron**.
  ⚠️ **`B15` NO ES EL TEST DE `R32`, Y CREER QUE LO ERA COSTÓ LA REVISIÓN.** Correr suites ajenas
  demuestra que **lo que ya se afirmaba** sigue afirmándose; no puede demostrar una propiedad que
  **nadie afirma**. El test de `R32` es de **B13** (bloque R32 de
  `correccion-dia-reparto-efectos.int`, 2026-08-23), y se probó que muerde.

---

## ⬛ BLOQUE HISTORIAL — P1: el rastro se ve en «Ver historial»

> **B24 no depende de nada y es el contrato**: mientras no esté, ni el servicio ni el frontend pueden
> avanzar. **B25** y **B28** sí necesitan **B1** (la tabla del rastro) en la rama. Detalle completo en
> `design.md` **§14**.

- [x] **B24 — ⚠️ El DTO se vuelve UNIÓN DISCRIMINADA, y el build rompe a propósito.** (dep. ninguna)
  `lib/types/orden-historial.ts`: `OrdenHistorialTransicionDTO` (`clase: "transicion"` + los seis
  campos de siempre, **sin volver nullable `estatusDestinoValue`**) y
  `OrdenHistorialCorreccionDiaDTO` (`clase: "correccion_dia"`, `fechaAnteriorISO`, `fechaNuevaISO`,
  `actorNombre: string`, `motivo: string`, `createdAt`). `OrdenHistorialEntradaDTO` pasa a ser la
  **unión**, y **conserva el nombre** (`design.md` §14.1, punto 1).
  **Hecho, tres cosas:** (1) `pnpm typecheck` enumera **todos** los consumidores rotos y la lista
  coincide con el inventario de `design.md` §14.5 —si aparece uno que no está ahí, se añade al spec,
  no se arregla a ciegas—; (2) la corrección **no** gana ningún valor en `OrdenHistorialOrigenTipo`
  (el `_EnsureExhaustive` de ese archivo sigue intacto); (3) `rastreo-frontera.guardia` sigue en
  verde **sin tocarla** (el símbolo prohibido sigue existiendo con el mismo nombre).

- [x] **B25 `[P]` — El repositorio del rastro: lectura por orden.** (dep. B1, B24)
  `lib/interfaces/repositories/IOrdenDiaRepartoCambioRepository.ts` +
  `lib/repositories/OrdenDiaRepartoCambioRepository.ts`:
  `findCorreccionesByOrden(ordenId)` → `OrdenHistorialCorreccionDiaDTO[]`, `ORDER BY created_at ASC,
  id ASC`, con el `nombre` del actor por `include` y las dos fechas serializadas con
  `fechaRepartoComoTexto` (patrón `MisAsignacionesService.ts:266-267`).
  **Hecho:** el DTO que sale **no lleva ningún `Date` de fecha calendario** (sólo `createdAt`, que es
  un instante), y el `ORDER BY` lleva el desempate por `id` — sin él, dos filas del mismo instante
  salen en orden indefinido.

- [x] **B26 — La fusión y el orden, en el SERVICIO.** (dep. B24, B25)
  `lib/services/OrdenHistorialService.ts`: tercer repo por constructor, las dos lecturas y una
  función **pura y exportada** `fusionarLineaDeTiempo(transiciones, correcciones)` con la regla de
  `design.md` §14.3 (ascendente por `createdAt`; empate exacto → **transición primero**; dentro de
  cada fuente se preserva su orden). Cablear el tercer repo en `lib/actions/orden-historial.ts`
  (`buildService`).
  **Hecho:** la fusión es una función pura testeable sin DB; **el componente no ordena nada**
  (**R41**); y la autorización **no se toca** (**R44**: la lectura nueva va DESPUÉS de
  `decision === "ok"`, no antes).

- [x] **B27 — Tests del historial fusionado, con dobles.** (dep. B26)
  `tests/unit/services/orden-historial-fusion.test.ts`: entradas de las dos fuentes intercaladas →
  orden correcto (**R37**, **R40**); **empate exacto de instante** → transición primero, y el
  resultado **no cambia** si se invierte el orden en que se pasan las listas (**R40**); orden **sin
  correcciones** → resultado **byte a byte** el de antes (**R45**); los cuatro roles con visibilidad
  ven las correcciones y los dos sin visibilidad no llegan a leerlas (**R44**).
  **Hecho:** verde, y M-y, M-z y M-aa producen rojo **con nombre**.

- [x] **B28 `[P]` — Postgres real: la lectura del rastro resuelve por el índice que ya existe.**
  (dep. B1, B25)
  `tests/integration/db/correccion-dia-reparto-historial.int.test.ts`: sembradas N correcciones de
  una orden, `findCorreccionesByOrden` las devuelve **todas, en orden**, con el nombre del actor y el
  motivo; y el plan usa `orden_dia_reparto_cambio`'s `(orden_id, created_at)` — el índice que
  `design.md` §5.1 declaró «la única consulta prevista» **antes** de que existiera este consumidor.
  **Hecho:** verde con base; `describe.skip` **visible** sin base; **nada de `if (!fks) return;`**.

- [x] **B29 `[P]` — La ausencia: el rastreo público no la ve.** (dep. B24, B26)
  `tests/unit/guards/rastreo-frontera.guardia.test.ts` sigue **intacto y verde** (**R43**), y se
  añade la comprobación positiva en el test del rastreo público: una orden **con** corrección
  devuelve **exactamente** las mismas transiciones que sin ella.
  **Hecho:** verificado que `RastreoPublicoRepository` sigue leyendo `orden_historial_estado` con su
  `select` de dos campos y **no** consume el DTO (`design.md` §14.0).

---

## ⬛ BLOQUE AVISO — P2: al mensajero se le avisa

> Independiente del BLOQUE HISTORIAL: puede ir en paralelo. Detalle en `design.md` **§15**.
> ⚠️ Toca `db/migrations/**` y `lib/types/notificacion.ts`: dos vías más del gate COMPLETO.

- [x] **B17 — ⚠️ Los DOS enums de la campana ganan su valor.** (dep. B1 por el orden de timestamps)
  `db/schema.prisma`: `NotificacionEvento += dia_reparto_corregido` y
  `NotificacionEntidadTipo += orden_dia_reparto_cambio`, con su comentario de feature.
  `lib/types/notificacion.ts`: los dos tipos de dominio, igual.
  Migración **propia y separada** de la del rastro, con timestamp **posterior**:
  `db/migrations/<ts>_notificacion_evento_dia_reparto_corregido/` con `migration.sql` (**sólo** los
  dos `ALTER TYPE ... ADD VALUE IF NOT EXISTS`, nada más: Postgres prohíbe **usar** un valor recién
  añadido en la misma transacción, 55P04) y `down.sql` que **recrea los dos tipos con la lista
  previa** — **CINCO** valores en cada uno, no cuatro. Molde literal:
  `db/migrations/20260820210000_notificacion_evento_postulacion_recurso/`.
  **Hecho, CINCO cosas:** (1) el `down.sql` lista los **cinco** valores previos de cada enum
  (incluido `postulacion_recurso_pendiente` / `postulacion_recurso`); (2) **no se toca ningún
  `down.sql` anterior** — verificado que el de la 146 **sólo dropea** y el de la 253 recrea con
  **sus** cuatro: los dos son fotos históricas (`design.md` §15.2); (3) el `down.sql` **no** lleva
  `DELETE` ni `UPDATE` para «hacer sitio» (**R54**); (4) el nombre de la carpeta **no termina** en
  `_notificacion` ni en `_notificacion_evento_postulacion_recurso` —el helper `carpetaQueTerminaEn`
  de la 253 hace `find` sobre nombres ordenados y leería otro archivo—; (5) `db:migrate` aplica y
  `db:rollback` revierte sin residuos.
  ⚠️ La migración **no se edita después de aplicarse**: si hay que cambiar algo, migración nueva.

- [x] **B18 — ⚠️ Los DOS censos AJENOS que se ponen rojos.** (dep. B17)
  Se **actualizan**, no se relajan — que se pongan rojos ES el precio que 146/D1 puso a añadir un
  evento, y funciona:
  1. `tests/unit/services/notificacion-productores-wiring.test.ts:381-404`: la lista literal gana
     `"dia_reparto_corregido"` y el título dice **seis**. **Sigue siendo literal** (derivarla del
     esquema la dejaría siempre verde).
  2. `tests/integration/db/notificacion-evento-postulacion-recurso-migration.test.ts:162-185`:
     **sólo** las dos aserciones sobre el **esquema vivo**. ⛔ El resto de ese archivo —el UP de la
     253, su DOWN con cuatro valores y «el down de la 146 no se toca»— **no se toca**.
  **Hecho:** los dos en verde, y el `git diff` de esos dos archivos **no borra ninguna aserción**,
  sólo amplía listas (**R52**).

- [x] **B19 `[P]` — El emisor y su notificador best-effort.** (dep. B17)
  `lib/notificaciones/emitir.ts`: `DiaRepartoCorregidoContexto`, `textoDiaRepartoCorregido(fechaISO)`
  (compone con `fechaLegible`, **R18**) y `emitirDiaRepartoCorregido` — **una** fila, `tipo: "box"`,
  `destinatario: { tipo: "usuario", usuarioId: mensajero }`, `entidadTipo:
  "orden_dia_reparto_cambio"`, `entidadId: cambioId`. `lib/notificaciones/notificadores.ts`:
  `DiaRepartoCorregidoNotificador`, `notificar…Con(repo)` sobre `emitirBestEffort` y su binding real;
  el `notificadorNoOp` gana la firma.
  **Hecho, tres cosas:** (1) el texto **nombra la fecha**, no «hoy» ni «mañana» (**R47**); (2) el
  aviso **no** lleva motivo, dirección, teléfono, destinatario ni monto (**R48**, **A24**); (3)
  `entidadId` es el **id del cambio** y no el de la orden — con el de la orden, la segunda corrección
  no avisaría **nunca** (`design.md` §15.2, **A20**).

- [x] **B20 — La escritura devuelve lo que el aviso necesita.** (dep. B4, B5)
  `RETURNING "id", "mensajero_asignado_id", "num_guia", "num_remision"` en el `UPDATE` de §6.1 y
  `corregirDiaRepartoLote` → `Promise<CorreccionDiaAplicada[]>` (antes `Promise<number>`).
  `registrarCambioDiaReparto` **genera los `id` con `randomUUID()`** y los devuelve en orden
  (`createMany` de Postgres no devuelve ids).
  **Hecho, dos cosas:** (1) el `SET` **no cambia** —sigue siendo `{fecha_reparto, updated_at}`, la
  huella que vigila B9—; (2) **la autocomprobación de B9 se actualiza a la forma FINAL del SQL**,
  con el `RETURNING` ancho: validar el detector contra un texto que ya no existe en el árbol es una
  guardia que se cree verificada (`design.md` §15.5).

- [x] **B21 — El servicio emite FUERA de la transacción.** (dep. B6, B19, B20)
  `CorreccionDiaRepartoService`: tras confirmar la `$transaction`, un aviso por cada
  `CorreccionDiaAplicada`, vía el notificador inyectado (**default no-op**, real inyectado en la
  Server Action, patrón `notificadores.ts:11-19`).
  **Hecho, tres cosas:** (1) si el notificador **lanza**, `corregir` sigue devolviendo `ok` y la
  corrección **sigue escrita** (**R49**); (2) el fallo queda **loggeado con contexto** —nada de
  `catch` vacío (`docs/conventions.md`)—; (3) con la transacción revertida **no se emite ni un
  aviso**.

- [x] **B22 — ⚠️ Postgres real: la migración del enum y su DOWN ejercitado.** (dep. B17)
  `tests/integration/db/notificacion-evento-dia-reparto-corregido-migration.test.ts`, molde literal
  del de la 253: el UP **sólo** añade (dos sentencias, las dos `ALTER TYPE`, ni un `CREATE TABLE` ni
  un `ALTER TABLE`); el DOWN recrea los dos tipos con los **cinco** previos, con su `RENAME`, su
  `ALTER COLUMN ... USING` y su `DROP TYPE *_old`; y **contra Postgres de verdad**: aplicar el down
  y comprobar que `notificacion_dedupe_key` **sobrevive con su `NULLS NOT DISTINCT` y su `WHERE`
  parcial** y que `notificacion_entidad_idx` sigue ahí.
  **Hecho, tres cosas:** (1) se afirma que el down de la 146 **sólo dropea** y que el de la 253 sigue
  listando **cuatro** —si alguien los convirtiera en otra cosa, este test avisa—; (2) el nombre de la
  carpeta nueva no rompe el `carpetaQueTerminaEn` de la 253 (§15.4); (3) `describe.skip` **visible**
  sin base.

- [x] **B23 — Tests del aviso.** (dep. B19, B21)
  `tests/unit/services/notificacion-dia-reparto-corregido.test.ts`, molde de
  `notificacion-productores.test.ts`: **una** fila y sólo una (**R51**: ni maestro, ni admin, ni
  tienda); destinatario = el **mensajero asignado** (**R46**); la descripción lleva la **fecha en
  palabras** y **no** lleva «hoy» ni «mañana» (**R47**); el anexo es la guía, y la remisión cuando no
  hay guía; **ningún** campo del aviso contiene dirección, teléfono, destinatario, monto **ni el
  motivo escrito por quien corrigió** (**R48**, **A24**);
  **dos correcciones seguidas sobre la misma orden y el mismo mensajero → DOS filas** (**R50**, el
  test que mata **A20**); un emisor que lanza no cambia el resultado (**R49**); los dos sentidos
  —«mañana → hoy» y «hoy → mañana»— emiten igual (**R55**).
  **Hecho:** verde, y M-ab, M-ad y M-ae producen rojo **con nombre**.

---

- [x] **B16 — Matar todo con mutaciones.** (dep. B9, B10, B11, B12, B13, B14, B18, B22, B23, B27,
  B28, B29, F5, F8)
  Las del **bloque de mutaciones** de más abajo, una a una.
  **Hecho:** por cada una, el comando y la **salida real** (nombre del test que se puso rojo) pegados
  en `progress/impl_262_backend.md`. ⚠️ Si el arnés de mutaciones dice «todas mueren» sin mostrar una
  corrida por mutación, **no cuenta**: en este repo ya reportó «9/9» dos veces sin ejecutar un test.

---

## BLOQUE FRONTEND

> Arranca con `B2` y `B3` en la rama. No toca `lib/`, `db/` ni `tests/integration/`.

- [x] **F1 — El modal de la bodega central.** (dep. B2, B3, B7)
  `app/(app)/ordenes/_components/CambiarDiaRepartoModal.tsx`, molde de `AsignarBodegaModal` +
  `DeshacerAsignacionModal`: lista del lote **con el día de cada orden** (**R16**),
  `SelectorDiaReparto` **sin preselección** (`design.md` §7.2) alimentado por `fechasDiaReparto`
  (**R17**), campo de **motivo** obligatorio (**R21**), confirmar deshabilitado hasta que haya día y
  motivo válidos, y la confirmación de **R10** con `confirmacionDiaReparto`.
  **Hecho:** ningún literal de día escrito en el componente: todos importados (**R18**).

- [x] **F2 `[P]` — El modal de la bodega satélite.** (dep. B2, B3, B7)
  `app/(app)/recepcion-satelite/_components/CambiarDiaRepartoSateliteModal.tsx`, hermano del
  anterior (mismo reparto que `DeshacerAsignacionModal` / `DeshacerAsignacionSateliteModal`).
  **Hecho:** los dos modales leen **los mismos textos** y llaman a **la misma action**.

- [x] **F3 — La acción de lote en `/ordenes`.** (dep. F1)
  `OrdenesListado`: «Cambiar día de reparto» (`variant: "outline"`) en los casos `por_recoger`,
  `en_reparto` y `ayuda_tienda` de `accionesPara`; el modal montado junto a los demás; `handleSuccess`
  revalida las tablas.
  **Hecho:** con selección de **estados mezclados** no se ofrece (patrón del listado), y la puerta de
  la página **no se toca** (**R13**).

- [x] **F4 `[P]` — El botón en el listado satélite.** (dep. F2)
  `SateliteOrdenesListado`: botón junto a «Deshacer asignación», visible con `por_recoger`
  seleccionado y `disabled` con estado mixto; cableado en `RecepcionSateliteModule`.
  **Hecho:** el `adminSatelite` llega a la corrección **sin pasar por `/ordenes`**, que le hace
  `notFound()` (`design.md` §4.1).

- [x] **F5 — Tests de componente.** (dep. F1, F2, F3, F4)
  - `tests/components/CambiarDiaRepartoModal.test.tsx` (nuevo): el día actual de cada orden aparece
    **con la fecha legible** (**R16**); **no** hay opción preseleccionada y el confirmar arranca
    deshabilitado; sin motivo no se envía (**R21**); el `dia` elegido **viaja** en la llamada; la
    confirmación se pinta con el texto de la fuente única (**R10**, **R18**).
  - El `conflict` con detalle pinta **el motivo por orden** y no el genérico (**R19**).
  - `tests/components/OrdenesListado*.test.tsx` y el del listado satélite: la acción aparece en los
    estados que toca y **no** con selección mixta (**R13**).
  - `tests/unit/utils/dia-reparto-textos.test.ts`: el módulo **no importa `Date` ni `Intl`**
    (**R17**).
  **Hecho:** verde; M-u, M-v y M-x las matan.

- [x] **⬛ F7 — El timeline pinta la entrada SIN transición.** (dep. B24, B26)
  `app/(app)/ordenes/_components/HistorialOrdenTimeline.tsx`: `switch (entrada.clase)` con
  **exhaustividad demostrada** (`const _exhaustivo: never = entrada;` en el `default`). La rama
  `"correccion_dia"` pinta «Día de reparto» + `textoCorreccionDiaReparto(anteriorISO, nuevaISO)` +
  el sello de hora + «Por {actor}» + «Motivo: …», y **NO llama a `estatusLabel`** ni pinta la flecha
  de estados (**R39**). `lib/utils/dia-reparto-textos.ts` gana
  `textoCorreccionDiaReparto` y `ETIQUETA_CORRECCION_DIA` (**R18**). La `key` de la lista antepone
  `entrada.clase` (`design.md` §14.4).
  **Hecho, tres cosas:** (1) `dia-reparto-textos.ts` **sigue sin importar `Date` ni `Intl`**
  (**R41**); (2) el componente **no lleva ni un literal de fecha**: todos importados; (3) la rama de
  transición queda **idéntica** —el `git diff` de esa rama es sólo el `case`— (**R45**).

- [x] **⬛ F8 — Tests de componente del timeline y del tipo.** (dep. F7)
  - `tests/components/HistorialOrdenTimeline.test.tsx`: una entrada de corrección se lee con **las
    dos fechas en palabras**, su actor y su motivo (**R38**); **no** aparece ninguna etiqueta de
    estado ni la flecha en esa entrada (**R39**); mezcladas, salen en orden y la de corrección se
    distingue **por texto y no sólo por color**.
  - Los fixtures existentes ganan `clase: "transicion"` y **ninguna aserción cambia** (**R45**).
  - `tests/unit/types/orden-historial-union.test.ts` (nuevo): `@ts-expect-error` al leer
    `estatusDestinoValue` sobre la unión sin estrechar (**R42**). Si alguien deshiciera la unión, el
    `@ts-expect-error` se quedaría **sin error que suprimir** y `pnpm typecheck` se pondría rojo.
  **Hecho:** verde, y M-aa y M-ac las matan.

- [ ] **F6 — Ver la app.** (dep. F5, F8, y con el backend mergeado en la rama)
  Playwright manual en preview. **Con cuenta maestro/admin:** marcar un lote de `por_recoger` para
  mañana desde la asignación, comprobar que el mensajero **no** puede recogerlo (la 261), corregirlo
  a hoy desde `/ordenes` y comprobar que **se desbloquea solo**. Repetir en sentido contrario (hoy →
  mañana). **Con cuenta `adminSatelite`:** lo mismo desde `/recepcion-satelite`, y comprobar que una
  orden **de otra zona** no aparece. **Con cuenta de mensajero:** que la acción **no existe** y que
  KPIs y mapa **no cambiaron** (**R32**).
  ⬛ **Y lo que abre la puerta humana, en la misma pasada:**
  - **«Ver historial» de la orden corregida** (cuenta maestro/admin, y luego `adminTienda` sobre una
    orden **suya**): la entrada de corrección aparece **en su sitio cronológico**, con las dos fechas
    en palabras, el actor y el motivo, y **sin** ninguna etiqueta de estado (**R37**-**R39**).
    Corregir **dos veces** la misma orden → **dos** entradas.
  - **La campana del mensajero** (`/mis-asignaciones/reparto`): tras la corrección, el aviso aparece
    **sin recargar** en ≤ 60 s, dice **la fecha** (no «hoy»), trae la guía en el anexo y **no** trae
    motivo ni datos del destinatario (**R46**-**R48**). Corregir **dos veces** → **dos** avisos
    (**R50**). Comprobar que **maestro, admin y la tienda NO reciben nada** (**R51**).
  - **El caso que nombró la puerta humana**: «mañana → hoy» sobre una orden **ya en `en_reparto`**
    —el paquete en la mano— y comprobar que el mensajero recibe el aviso **y** puede gestionarla
    (**R55**, **R31**).
  - **El rastreo público** de esa misma guía: **no** muestra la corrección (**R43**).
  **Hecho:** capturas o transcripción en `progress/impl_262_frontend.md`, y el **rastro leído en la
  base** después de la prueba (una fila por corrección, con su motivo). En este repo mirar la app
  encontró **siete textos rotos** que doce mil tests daban por buenos.
  ⛔ **VIVA, y es LA deuda de la ficha.** Necesita un **preview desplegado** y **tres cuentas**
  (maestro/admin, `adminSatelite`, mensajero), que ningún subagente puede montar. Lo de
  `progress/impl_262_historial_ui.md` §6 —una página de fixtures en `next dev`— acota el estilo
  pero **no la sustituye**: no hubo datos reales, ni preview, ni las tres cuentas. La deuda está
  anotada junto al código (`@pendiente-262-f6`) y **bajo guardia** (`historial-correccion-dia.guardia`
  (f), que se pone roja si alguien retira la anotación).

---

## BLOQUE DE MUTACIONES (obligatorias — cada una debe producir un rojo CON NOMBRE)

| # | Mutación | Debe morir en |
| --- | --- | --- |
| **M-a** | Borrar la guarda de rol del servicio | B11 (**R11**) |
| **M-b** | Quitar el acotado por zona del `adminSatelite` en el servicio | B11 (**R12**) |
| **M-c** | Borrar el rechazo por estado no admitido | B11 (**R6**) |
| **M-d** | Borrar el rechazo por «sin mensajero» / «sin día» | B11 (**R5**) |
| **M-e** | Borrar el rechazo por «ya es de ese día» | B11 (**R7**) |
| **M-f** | Cambiar el todo-o-nada por «dejar pasar a los ganadores» | B11 + **B12 caso 4** (**R8**) |
| **M-g** | Quitar `AND "estatus_id" IN (…)` del `WHERE` de la escritura | **B12** (**R9**) |
| **M-h** | Quitar `AND "fecha_reparto" IS NOT NULL` del `WHERE` | **B12** (**R5**/**R9**) |
| **M-i** | Quitar `AND "zona_id" = …` del `WHERE` | **B12 caso 5** (**R12**) |
| **M-j** | Quitar `AND "fecha_reparto" <> …` del `WHERE` | **B12** (**R7**) |
| **M-k** | Añadir `"asignado_at" = NOW()` al `SET` de la corrección | **B12 caso 2** (**R27**) **y** B9 — la huella de columnas cambia |
| **M-l** | Quitar el `FOR UPDATE` del pre-`SELECT` | **B12** (aserción de **forma** sobre el SQL emitido con `crearPrismaDeTestConEspia`; se declara como tal: no es una prueba de concurrencia) |
| **M-m** | Mover el rastro **fuera** de la transacción | **B12 caso 4** (**R22**) |
| **M-n** | Escribir el rastro con **todas** las `ordenIds` en vez de las del `RETURNING` | **B12 caso 4** (**R22**) |
| **M-o** | Resolver la fecha **dentro** del repositorio (`new Date()`) en vez de recibirla | B11 (dos `now`, **R2**) |
| **M-p** | Pasar el `Date` al SQL sin `fechaRepartoComoTexto(...)::date` | **B12 caso 6** (sesión en `America/Costa_Rica`) |
| **M-q** | Relajar la cláusula (d3) de la guardia a «≤ 1» o borrar la (d2) | **B9** (autocomprobación, **R29**) |
| **M-r** | Borrar la nota del cierre de la 261 / su puntero | `d5-revertida.guardia` (**R34**/**R35**) |
| **M-s** | Quitar `ayuda_tienda` de `ESTADOS_CON_DIA_DE_REPARTO_VIVO` | **B10** (**R6**) |
| **M-t** | Dar `.default("hoy")` al `dia` del borde | B7 (**R2**) |
| **M-u** | Preseleccionar «Hoy» en el modal | F5 (**R16**/§7.2) |
| **M-v** | Pintar el error genérico en vez del detalle por orden | F5 (**R19**) |
| **M-w** | Añadir una **segunda** escritura del día sin `asignado_at` en `OrdenRepository` | **B9** cláusula (d3) (**R29**) |
| **M-x** | Devolver el literal del texto al componente en vez de importarlo | F5 (**R18**) |

### ⬛ Mutaciones del alcance añadido (P1 y P2)

| # | Mutación | Debe morir en |
| --- | --- | --- |
| **M-y** | Devolver sólo las transiciones y descartar las correcciones en la fusión | **B27** (**R37**) |
| **M-z** | Concatenar las dos listas **sin ordenar** (o invertir el desempate del empate exacto) | **B27** (**R40**) |
| **M-aa** | Ordenar en el componente en vez de en el servicio | **B27** + **F8** (**R41**) |
| **M-ab** | Cambiar `entidadId` del aviso por el `ordenId` | **B23** — el caso «dos correcciones, dos avisos» (**R50**, **A20**) |
| **M-ac** | Pintar la corrección con `estatusLabel` como si fuera una transición | **F8** (**R39**) |
| **M-ad** | Sustituir la fecha del texto del aviso por la palabra «hoy» | **B23** (**R47**) |
| **M-ae** | Añadir `maestro`/`admin` a los destinatarios del aviso | **B23** (**R51**) |
| **M-af** | Mover el aviso **dentro** de la `$transaction` | **B21** (**R49**: el notificador que lanza deja de devolver `ok`) |
| **M-ag** | Quitar `postulacion_recurso_pendiente` de la lista del `down.sql` nuevo (dejar cuatro) | **B22** (**R53**) |
| **M-ah** | Añadir un `DELETE FROM "notificacion"` al `down.sql` para «hacer sitio» | **B22** (**R54**) |
| **M-ai** | Relajar la lista literal de eventos a una derivación del propio esquema | **B18** (**R52**) |
| **M-aj** | Volver `estatusDestinoValue` opcional en vez de usar la unión | **F8** (`@ts-expect-error` sin error → `pnpm typecheck` rojo, **R42**) |
| **M-ak** | Añadir a la línea de tiempo una corrección **de otra orden** | **B27**/**B28** (**R37**: el `WHERE` por `orden_id`) |

---

## CIERRE

- [x] **C1 — `./init.sh` COMPLETO en verde.** No hay modo rápido en esta ficha (migración +
  `lib/types/`).
  **Hecho ✅ 2026-08-23:** salida pegada en `progress/impl_262_historial.md` §9, con
  `INIT_EXIT=$?` **escrito dentro del log** — un `echo` posterior ya tapó aquí un gate rojo
  haciéndolo pasar por «exit code 0». Corrido cuatro veces a lo largo de la ficha (una por tanda)
  y una quinta tras cerrar los bloqueantes.
- [x] **C2 — Pre-vuelo contra `origin/dev`** justo antes del PR: otra sesión puede haberlo movido, y
  el pre-vuelo caduca.
  **Hecho ✅:** cada tanda lo comparó antes de su PR; la de cierre de bloqueantes salió de
  **`c63c7235`** y lo vuelve a comparar justo antes de abrir el suyo.
- [ ] **C3 — B0.2 (re-medición) hecha y escrita** antes de desplegar a producción.
  ⛔ **VIVA.** Cuelga de `B0.2`, que no se ha hecho: sin la segunda foto no hay nada que escribir.
- [x] **C4 — `progress/impl_262_backend.md` y `progress/impl_262_frontend.md`** con el mapa
  `R<n> → test` completo (abajo), las mediciones y las mutaciones con su salida real.
  **Hecho ✅:** los cuatro mapas (backend, frontend, historial, historial-UI) están escritos;
  **el 2026-08-23 se corrigió la fila de `R32`**, que decía `B15` y `B15` no es un test.
- [x] **C5 — Migrar la base local tras mergear** (`prisma migrate deploy`): un error «sólo de un rol»
  después del merge suele ser la tabla de migración faltante, no HMR. ⬛ Ahora son **DOS**
  migraciones (la del rastro y la de los enums) y el orden entre ellas importa.
  **Hecho ✅ 2026-08-23:** `prisma migrate status` sobre `localhost:5432/ordenex` responde
  **«Database schema is up to date!»** con **143 migraciones**, y las dos de la ficha están
  aplicadas en su orden (`…130000_orden_dia_reparto_cambio` antes que
  `…140000_notificacion_evento_dia_reparto_corregido`). La prueba fuerte no es esa línea: es que
  los **11 tests** de `correccion-dia-reparto-efectos.int` corren contra esa base y leen
  `orden_dia_reparto_cambio` y su `pg_class.relrowsecurity`.
- [x] **⬛ C6 — P3: la verificación de que NO cambia nada.** `git diff origin/dev...HEAD --stat` **no
  lista** `lib/types/dia-reparto.ts` ni `lib/utils/dia-reparto.ts`, y el enum sigue teniendo **dos**
  valores. Es cómo se prueba una decisión de «no tocar»: por la ausencia, escrita (**R56**,
  `design.md` §16).
- [ ] **⬛ C7 — Las dos preguntas abiertas nuevas, llevadas a la puerta humana.** **P4** (¿la tienda
  lee la corrección y su motivo?) y **P5** (¿el `adminSatelite` necesita leer el rastro que escribe?)
  tienen decisión por defecto tomada, así que **no bloquean**; pero se preguntan **antes** de
  desplegar, no después de que una tienda lea el primer motivo.
  **Hecho:** la respuesta —o el «se queda como está»— escrita y fechada en `requirements.md`.
  ⛔ **VIVA.** Ninguna de las dos se ha llevado a la puerta humana, y `requirements.md` no tiene la
  respuesta fechada. Es del **leader**: son decisiones de producto, no de implementación.

---

## Mapa `R<n> → test`

| R | Qué exige | Test |
| --- | --- | --- |
| R1 | Cambia el día y **nada más** | **B12 caso 2** (fila entera comparada) |
| R2 | Fecha resuelta en el servidor, desde un token y un reloj inyectable | B11 (dos `now`) · B7 (sin `dia` → falla) |
| R3 | No se puede fijar un día pasado | B7 (el enum sólo admite dos valores) · B11 (la fecha sale de `resolverFechaReparto`) |
| R4 | No se puede dejar sin día | B11 · **B12 caso 2** (la fila siempre queda con día) |
| R5 | Sin día o sin mensajero → rechazo con motivo | B11 · **B12 caso 2** (la sembrada sin día no se toca) |
| R6 | Sólo los estados donde el día vive; el rechazo nombra el estado | B11 · **B10** (censo) |
| R7 | Ya es de ese día → rechazo, no escritura vacía | B11 · **B12** (`<>` en el `WHERE`) |
| R8 | Todo-o-nada, sin efectos | B11 (0 llamadas al repo) · **B12 caso 4** (0 filas de rastro) |
| R9 | Re-comprobación **en la escritura** | **B12** — el `WHERE`, contra Postgres real |
| R10 | Confirmación en palabras, sin siglas | F5 |
| R11 | Sólo maestro/admin y adminSatelite | B11 |
| R12 | El adminSatelite, acotado a su zona (server-side) | B11 (`sin_zona`) · **B12 caso 5** (el `WHERE`) |
| R13 | Las dos superficies, sin cambiar sus puertas | F5 (los dos listados) · F6 |
| R14 | Un cierre pendiente no bloquea | B11 · B6 (el `Pick` no expone el predicado) |
| R15 | Ni mensajero ni tienda | B11 (`forbidden`) · F5 (no se ofrece) |
| R16 | El día de cada orden, antes de confirmar | F5 |
| R17 | Sin reloj del navegador | F5 (`dia-reparto-textos` no importa `Date`/`Intl`; las fechas llegan por props) |
| R18 | Una sola fuente de texto | F5 (M-x) |
| R19 | Motivo real por orden al rechazar | F5 |
| R20 | El rastro: orden, día anterior, día nuevo, quién y cuándo | **B12 caso 3** |
| R21 | Motivo obligatorio | B7 (zod) · F5 (no se envía sin él) |
| R22 | Misma transacción, exactamente las corregidas | **B12 casos 3 y 4** (M-m, M-n) |
| R23 | Rastro inmutable | B1 (el modelo no tiene `updated_at`/`deleted_at`) · B4 (el choke point sólo inserta) |
| R24 | `fecha_anterior` = valor en el instante de la escritura | **B12** (`FOR UPDATE`, M-l — declarada como aserción de forma) |
| R25 | Sin fila de historial ni cambio de intentos | **B13** |
| R26 | RLS en la tabla del rastro | **B13** (`pg_class.relrowsecurity`) |
| R27 | `asignado_at` intacto | **B12 caso 2** · **B9** (M-k) |
| R28 | La invariante 246/R10 sigue entera | **B9** · **B12** (el `WHERE` exige día y mensajero) |
| R29 | La comprobación existe y no es vacía | **B9** autocomprobación · B16 (M-q, M-w) |
| R30 | El corte cambia de opinión con el día | **B13** |
| R31 | Corregida a hoy, se desbloquea sola | **B13** |
| R32 | Ruta e indicadores intactos | **B13** — `correccion-dia-reparto-efectos.int`, bloque R32 (2026-08-23): filas enteras de `ruta_optimizada`/`ruta_optimizada_parada` · los indicadores del portal por `listarMisAsignaciones` con repos reales · el delta de `jobs` `optimizacion_ruta`. `B15` (no-regresion) y `F6` (ver la app) **acompañan, no sustituyen**: ninguna de las dos es una asercion |
| R33 | Sin escrituras nuevas del día fuera de ésta | **B9** (censo con cota y excepción única) · B15 |
| R34 | El riesgo de la 261 se cierra escrito, sin borrar el porqué | **B14** · M-r |
| R35 | La guardia de esa nota se actualiza, no se borra | **B14** (mitad (e) viva con las piezas del cierre) |
| R36 | Apéndice fechado en el spec de la 261, texto original intacto | **B14** (`git diff` sólo adiciones) |

### ⬛ Alcance añadido por la puerta humana del 2026-08-22

| R | Qué exige | Test |
| --- | --- | --- |
| R37 | La corrección aparece en «Ver historial», una entrada por corrección | **B27** (fusión) · **B28** (la lectura contra Postgres real) · F6 |
| R38 | Día anterior, día nuevo, quién, cuándo y motivo, en palabras | **F8** · **B25** (el DTO sale con las dos fechas ya serializadas) |
| R39 | Sin estado de origen ni destino; no es una transición | **F8** (M-ac: ninguna etiqueta de estado en esa entrada) |
| R40 | Orden cronológico sobre las dos fuentes, y determinista en el empate | **B27** (empate exacto, y el resultado no cambia al invertir las listas — M-z) |
| R41 | La fusión y el orden, en el servidor | **B27** · **F8** (el componente no ordena; los textos no importan `Date`/`Intl`) — M-aa |
| R42 | El build rompe si alguien la trata como transición | **F8** (`@ts-expect-error`) + `pnpm typecheck` del gate — M-aj |
| R43 | El rastreo público no la ve | **B29** (`rastreo-frontera.guardia` intacta + control positivo) · F6 |
| R44 | Misma autorización, sin regla nueva | **B27** (los cuatro roles con visibilidad y los dos sin ella) |
| R45 | Sin correcciones, la línea de tiempo es la de antes | **B27** (byte a byte) · **F8** (ninguna aserción vieja cambia) |
| R46 | Se avisa al mensajero asignado | **B23** · **B21** (el servicio emite tras confirmar) · F6 |
| R47 | El aviso nombra la FECHA, no «hoy»/«mañana», e identifica la orden | **B23** — M-ad |
| R48 | Sin dirección, teléfono, destinatario ni monto | **B23** |
| R49 | Un aviso caído no revierte la corrección, y queda registrado | **B21** — M-af |
| R50 | Un aviso por corrección: dos correcciones, dos avisos | **B23** — M-ab (es el test que mata **A20**) |
| R51 | Nadie más que el mensajero | **B23** — M-ae · F6 |
| R52 | El inventario de eventos sigue cerrado y literal | **B18** — M-ai |
| R53 | Migración aditiva + `down.sql` con la lista previa exacta; ningún `down` anterior tocado | **B17** (criterio 2) · **B22** — M-ag |
| R54 | El `down` falla ruidosamente en vez de borrar filas | **B22** — M-ah |
| R55 | Los dos sentidos avisan; el desbloqueo no depende del aviso | **B23** · **B13** (**R31** sigue probándose sin aviso) · F6 |
| R56 | El vocabulario del día no cambia | **C6** (ausencia en el diff) · B7 (el borde sigue **sin** `.default`, M-t) |
