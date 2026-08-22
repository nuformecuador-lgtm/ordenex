# Feature 262 — Tasks

> Lee `requirements.md` y `design.md` antes. Cada task lleva su **criterio de hecho**; `[P]` = puede
> ir en paralelo con las de su mismo bloque que no dependan de ella.
>
> **Secuencia entre bloques:** el bloque **BACKEND** va primero (zona `fullstack` = backend→frontend,
> nunca a la vez). El **FRONTEND** arranca cuando `B2` (textos) y `B3` (contratos) estén en la rama;
> el resto del backend puede seguir en paralelo a partir de ahí.
>
> ⚠️ **El gate lo corre el leader, no el subagente.** `backend_dev` / `frontend_dev` corren
> `pnpm typecheck`, `pnpm lint` y `pnpm exec vitest related --run <sus archivos>`. Nada más. Y el
> gate **no se corre en paralelo** con un subagente que esté mutando el árbol: leería el árbol a
> medias y su veredicto no valdría.
>
> ⚠️ **`./init.sh --rapido` SE NIEGA en esta ficha, por dos vías independientes:** el diff toca
> `db/migrations/**` + `db/schema.prisma` y además `lib/types/**` (`orden.ts`,
> `recepcion-satelite.ts`). El gate **COMPLETO** es obligatorio antes del PR. No es una elección.

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

---

## BLOQUE BACKEND

### Cimientos

- [ ] **B1 — La tabla del rastro: esquema + migración + `down.sql` + RLS.** (sin dependencias)
  `db/schema.prisma`: `model OrdenDiaRepartoCambio` (`design.md` §5.1) y sus dos relaciones inversas
  (`Orden.diaRepartoCambios`, `Usuario`). Migración nueva con **`migration.sql`** (tabla + 2 FK +
  `CHECK (fecha_nueva <> fecha_anterior)` + 2 índices + `ENABLE ROW LEVEL SECURITY`) y **`down.sql`**
  (`DROP TABLE IF EXISTS`, diciendo en voz alta que es destructivo). Molde:
  `db/migrations/20260820200000_postulacion_recurso/`.
  **Hecho, cuatro cosas:** (1) `pnpm run db:migrate` aplica; (2) `pnpm run db:rollback` revierte y
  vuelve a aplicar sin residuos; (3) `prisma migrate status` no reporta drift; (4) el modelo **no
  tiene** `updated_at` ni `deleted_at` (**R23**).
  ⚠️ La migración **no se edita después de aplicarse**: si hay que cambiar algo, migración nueva.

- [ ] **B2 `[P]` — Textos, en una sola fuente.** (sin dependencias)
  `lib/utils/dia-reparto-textos.ts`: `avisoDiaActualDeLaOrden(fechaISO)` («hoy está para el 22 de
  agosto») y el título/ayuda del selector en modo corrección. Reutiliza `fechaLegible`; **no** se
  reescribe `confirmacionDiaReparto`, se **usa** (**R18**).
  **Hecho:** el archivo sigue **sin importar `Date` ni `Intl`** (**R17**), y no aparece ninguna sigla
  ni ningún nombre de columna en el texto visible.

- [ ] **B3 — Contratos.** (sin dependencias)
  - `IOrdenRepository`: `corregirDiaRepartoLote(...)`, `CorreccionDiaConflictoError`, y
    `OrdenTransicionRow.fechaReparto: Date | null` **sin `?`**.
  - `ICorreccionDiaRepartoService` (nuevo): `corregir(input, actor, now?: Date)` con el union
    `ok | forbidden | sin_zona | conflict | validation_error`.
  - `lib/types/orden.ts`: `OrdenListItemDTO.fechaRepartoISO?: string | null`.
  - `lib/types/recepcion-satelite.ts`: lo mismo en `RecepcionSateliteDTO`.
  **Hecho:** `pnpm typecheck` señala **todos** los llamadores y fixtures que faltan por actualizar —
  ese rojo es el objetivo de quitar el `?` de `fechaReparto`, no un accidente.

### La escritura

- [ ] **B4 — El choke point del rastro.** (dep. B1, B3)
  `lib/repositories/registrar-cambio-dia-reparto.ts`, molde de `registrar-cambio-estado.ts` pero sin
  webhook, sin notificaciones y sin catálogo: un `createMany` en el `tx` en curso, con la regla
  escrita arriba (`design.md` §5.3).
  **Hecho:** no-op con lista vacía; y **no existe ningún otro sitio** que inserte en esa tabla
  (`grep` del árbol pegado en `progress/`).

- [ ] **B5 — La escritura guardada.** (dep. B1, B3, B4)
  `OrdenRepository.corregirDiaRepartoLote`: `$transaction` con (1) `SELECT … ORDER BY "id" FOR
  UPDATE`, (2) `UPDATE` guardado con `RETURNING "id"`, (3) `throw` si no ganaron todas, (4) rastro en
  la misma tx. SQL literal en `design.md` §6.1. El día entra como **texto `::date`** vía
  `fechaRepartoComoTexto`; `updated_at` a mano.
  **Hecho:** el `SET` **no menciona `asignado_at`** (**R27**) y el `WHERE` lleva las cinco guardas
  (estado, mensajero, día presente, día distinto, no borrada) más la zona cuando aplica. B12 en
  verde.

- [ ] **B6 — El servicio.** (dep. B3, B5, B2)
  `lib/services/CorreccionDiaRepartoService.ts`: rol (`esAccesoTotal` **o** `adminSatelite`), zona
  server-side, `ESTADOS_CON_DIA_DE_REPARTO_VIVO`, pre-chequeo por orden con **motivo tipado**
  (no existe / borrada / estado no admitido / sin mensajero / sin día / ya es de ese día),
  `resolverFechaReparto(input.dia, now)` **una vez** para el lote, y traducción del
  `CorreccionDiaConflictoError` a `conflict` con detalle por orden (patrón `detalleCarrera` de la
  149).
  **Hecho:** el `Pick` del repo que el servicio recibe **NO incluye**
  `findMensajerosBloqueadosParaGestion` — que un cierre pendiente no bloquee (**R14**) es imposible
  de romper por descuido si el método no está en el tipo (patrón `DeshacerAsignacionRepo`).

- [ ] **B7 — La Server Action.** (dep. B6)
  `lib/actions/corregir-dia-reparto.ts`, molde literal de `lib/actions/deshacer-asignacion.ts`:
  `withErrorHandler` + `resolveActorFromSession` + zod (`ordenIds` uuid `.min(1)`, `dia`
  `diaRepartoSchema` **sin `.default`**, `motivo` `trim().min(10).max(300)`) + fábrica del servicio.
  **Hecho:** `parse({ ordenIds, motivo })` **sin `dia`** falla (**R2**, `design.md` §4.3), y el
  motivo de sólo espacios falla por `min(10)` tras el `trim`.

- [ ] **B8 `[P]` — El día viaja en los dos DTO de listado.** (dep. B3)
  `OrdenRepository` (listado de `/ordenes`) y el repo del listado satélite emiten `fechaRepartoISO`
  ya serializada `YYYY-MM-DD` (patrón `fechaReprogramacion`, `lib/types/orden.ts:322-329`).
  **Hecho:** el DTO **no** lleva un `Date` (el DataTable descarta objetos al renderizar) y el
  navegador no construye ninguna fecha (**R17**).

### Las guardias

- [ ] **B9 — ⚠️ La guardia de la invariante, ensanchada.** (dep. B5)
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

- [ ] **B10 `[P]` — El censo de «la carga del mensajero» gana un miembro.** (dep. B6)
  `tests/unit/guards/carga-del-mensajero.guardia.test.ts`: `ESTADOS_CON_DIA_DE_REPARTO_VIVO` entra en
  `FAMILIA`, con `incluyeAyuda: true` y su razón escrita. El campo `pregunta` gana un tercer valor,
  `"donde vive el dia de reparto"`, **declarado**: un miembro nuevo que se cuele respondiendo otra
  pregunta deja el censo diciendo una cosa por otra.
  **Hecho:** la guardia en verde, y quitar `ayuda_tienda` de la lista la pone roja (M-s).

### Tests del backend

- [ ] **B11 — Tests de servicio, con dobles.** (dep. B6)
  `tests/unit/services/correccion-dia-reparto.test.ts`. Cubren: rol (**R11**), zona del
  `adminSatelite` y `sin_zona` (**R12**), cada motivo del pre-chequeo por separado —estado no
  admitido con **su nombre** (**R6**), sin mensajero y sin día (**R5**), ya es de ese día (**R7**)—,
  **todo-o-nada** con 0 llamadas al repo (**R8**), dos `now` distintos → dos fechas distintas
  (**R2**), mensajero con cierre pendiente → **procede** (**R14**), y `mensajero`/`adminTienda` →
  `forbidden` (**R15**).
  **Hecho:** verde, y M-a … M-f producen rojo **con nombre**.

- [ ] **B12 — ⚠️ Postgres real: la escritura y el rastro.** (dep. B5)
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

- [ ] **B13 `[P]` — Postgres real: las ausencias y las consecuencias.** (dep. B1, B5)
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
  **Hecho:** verde; mismas reglas de no-saltarse que B12.

- [ ] **B14 — El cierre del riesgo de la 261, en sus TRES soportes.** (dep. B6, F3, F4)
  1. `lib/interfaces/services/IMisAsignacionesService.ts`: la nota del riesgo aceptado se
     **sustituye** por su cierre fechado (`design.md` §9), **conservando** el razonamiento de por qué
     se aceptó y diciendo en **pasado** que la única salida fue un `UPDATE` a mano.
  2. `tests/unit/guards/d5-revertida.guardia.test.ts`, mitad (e): `PIEZAS_DEL_AGUJERO` pasa a exigir
     las piezas del **cierre**. **No se borra la mitad (e)** y **no se relaja a un `toBe(true)`**.
  3. `specs/261-dia-reparto-protege/requirements.md` (límite declarado 2) y `design.md` §7.2:
     **apéndice fechado** marcando el agujero cerrado por esta ficha.
  **Hecho:** `git diff` sobre el spec de la 261 muestra **sólo adiciones**, cero líneas borradas
  (**R36**); la guardia en verde; M-r la mata.

- [ ] **B15 `[P]` — No-regresión.** (dep. B5)
  - `tests/unit/guards/fecha-reparto-acompana-asignado-at.guardia.test.ts` en verde **con sus cuatro
    cláusulas originales intactas**.
  - `corte-diario-service.test.ts` y el repo del corte, en verde (**R30** no rompe nada de la 109).
  - Los tests de las dos vías de asignación (246) y del deshacer (149/261), en verde: esta ficha
    **no retira** ninguna escritura del día (**R33**).
  - La ruta optimizada: `findParadasEnReparto` no cambia y no hay reoptimización encolada desde la
    corrección (**R32**).
  **Hecho:** los cuatro puntos verificados y escritos, con la lista de archivos corridos.

- [ ] **B16 — Matar todo con mutaciones.** (dep. B9, B10, B11, B12, B13, B14)
  Las del **bloque de mutaciones** de más abajo, una a una.
  **Hecho:** por cada una, el comando y la **salida real** (nombre del test que se puso rojo) pegados
  en `progress/impl_262_backend.md`. ⚠️ Si el arnés de mutaciones dice «todas mueren» sin mostrar una
  corrida por mutación, **no cuenta**: en este repo ya reportó «9/9» dos veces sin ejecutar un test.

---

## BLOQUE FRONTEND

> Arranca con `B2` y `B3` en la rama. No toca `lib/`, `db/` ni `tests/integration/`.

- [ ] **F1 — El modal de la bodega central.** (dep. B2, B3, B7)
  `app/(app)/ordenes/_components/CambiarDiaRepartoModal.tsx`, molde de `AsignarBodegaModal` +
  `DeshacerAsignacionModal`: lista del lote **con el día de cada orden** (**R16**),
  `SelectorDiaReparto` **sin preselección** (`design.md` §7.2) alimentado por `fechasDiaReparto`
  (**R17**), campo de **motivo** obligatorio (**R21**), confirmar deshabilitado hasta que haya día y
  motivo válidos, y la confirmación de **R10** con `confirmacionDiaReparto`.
  **Hecho:** ningún literal de día escrito en el componente: todos importados (**R18**).

- [ ] **F2 `[P]` — El modal de la bodega satélite.** (dep. B2, B3, B7)
  `app/(app)/recepcion-satelite/_components/CambiarDiaRepartoSateliteModal.tsx`, hermano del
  anterior (mismo reparto que `DeshacerAsignacionModal` / `DeshacerAsignacionSateliteModal`).
  **Hecho:** los dos modales leen **los mismos textos** y llaman a **la misma action**.

- [ ] **F3 — La acción de lote en `/ordenes`.** (dep. F1)
  `OrdenesListado`: «Cambiar día de reparto» (`variant: "outline"`) en los casos `por_recoger`,
  `en_reparto` y `ayuda_tienda` de `accionesPara`; el modal montado junto a los demás; `handleSuccess`
  revalida las tablas.
  **Hecho:** con selección de **estados mezclados** no se ofrece (patrón del listado), y la puerta de
  la página **no se toca** (**R13**).

- [ ] **F4 `[P]` — El botón en el listado satélite.** (dep. F2)
  `SateliteOrdenesListado`: botón junto a «Deshacer asignación», visible con `por_recoger`
  seleccionado y `disabled` con estado mixto; cableado en `RecepcionSateliteModule`.
  **Hecho:** el `adminSatelite` llega a la corrección **sin pasar por `/ordenes`**, que le hace
  `notFound()` (`design.md` §4.1).

- [ ] **F5 — Tests de componente.** (dep. F1, F2, F3, F4)
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

- [ ] **F6 — Ver la app.** (dep. F5, y con el backend mergeado en la rama)
  Playwright manual en preview. **Con cuenta maestro/admin:** marcar un lote de `por_recoger` para
  mañana desde la asignación, comprobar que el mensajero **no** puede recogerlo (la 261), corregirlo
  a hoy desde `/ordenes` y comprobar que **se desbloquea solo**. Repetir en sentido contrario (hoy →
  mañana). **Con cuenta `adminSatelite`:** lo mismo desde `/recepcion-satelite`, y comprobar que una
  orden **de otra zona** no aparece. **Con cuenta de mensajero:** que la acción **no existe** y que
  KPIs y mapa **no cambiaron** (**R32**).
  **Hecho:** capturas o transcripción en `progress/impl_262_frontend.md`, y el **rastro leído en la
  base** después de la prueba (una fila por corrección, con su motivo). En este repo mirar la app
  encontró **siete textos rotos** que doce mil tests daban por buenos.

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

---

## CIERRE

- [ ] **C1 — `./init.sh` COMPLETO en verde.** No hay modo rápido en esta ficha (migración +
  `lib/types/`).
  **Hecho:** salida pegada, con `INIT_EXIT=$?` **escrito dentro del log** — un `echo` posterior ya
  tapó aquí un gate rojo haciéndolo pasar por «exit code 0».
- [ ] **C2 — Pre-vuelo contra `origin/dev`** justo antes del PR: otra sesión puede haberlo movido, y
  el pre-vuelo caduca.
- [ ] **C3 — B0.2 (re-medición) hecha y escrita** antes de desplegar a producción.
- [ ] **C4 — `progress/impl_262_backend.md` y `progress/impl_262_frontend.md`** con el mapa
  `R<n> → test` completo (abajo), las mediciones y las mutaciones con su salida real.
- [ ] **C5 — Migrar la base local tras mergear** (`prisma migrate deploy`): un error «sólo de un rol»
  después del merge suele ser la tabla de migración faltante, no HMR.

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
| R32 | Ruta e indicadores intactos | B15 · F6 |
| R33 | Sin escrituras nuevas del día fuera de ésta | **B9** (censo con cota y excepción única) · B15 |
| R34 | El riesgo de la 261 se cierra escrito, sin borrar el porqué | **B14** · M-r |
| R35 | La guardia de esa nota se actualiza, no se borra | **B14** (mitad (e) viva con las piezas del cierre) |
| R36 | Apéndice fechado en el spec de la 261, texto original intacto | **B14** (`git diff` sólo adiciones) |
