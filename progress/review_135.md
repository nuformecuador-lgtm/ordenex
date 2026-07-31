# Feature 135 — analitica: catalogo de KPIs + rangos temporales · REVIEW

> Reviewer, 2026-07-30. Medido **dentro del worktree** `.../scratchpad/wt135`, rama
> `feature/135-analitica-catalogo-kpis-rangos` @ `2bb22453` sobre `dev` @ `664840f3`.
> El checkout principal (`ux`) no se toco: cero comandos git que muevan su arbol, cero
> `pnpm install` / `db:generate`.
>
> **VEREDICTO: APROBADO-CON-NOTAS.** El codigo esta bien y la trazabilidad es real
> (verificada por MUTACION, no leyendo el mapa). La feature **NO puede pasar a `done`
> todavia**: R26 no se cumple (init.sh y typecheck en rojo) y `tasks.md` tiene 4 casillas
> abiertas. Ninguna de las dos cosas es un defecto del codigo de la 135.

---

## 1. Checklist de CHECKPOINTS.md

| Punto | Estado | Evidencia |
|---|---|---|
| `requirements.md` con R EARS numerados | OK | 36 R (R1-R36), puerta T0 cerrada con D1-D10 |
| `design.md` con alternativa descartada y su porque | OK | seccion 7, 6 alternativas; 3.3 es el contrato aprobado |
| `tasks.md` con **todas** las tasks `[x]` | **NO** | 18/22. Abiertas: T0.3, T6.1, T6.3, T6.5 (razon escrita, ver seccion 4) |
| Cada `R<n>` mapea a un test concreto | OK | 36/36; 35 verificados por mutacion (seccion 3) |
| `progress/impl_135.md` contiene el mapa `R -> test` | OK | seccion 3 de la bitacora, sin "pendiente" |
| `pnpm run typecheck` sin errores | **NO** | 2 errores **ajenos a la 135**, delta 0 verificado (2.3) |
| `pnpm run lint` sin errores | OK | 19 warnings preexistentes, 0 errores; feature limpia (exit 0) |
| `pnpm test` pasa | OK con matiz | 626 archivos / 7150 tests; 4 rojos flaky de OTRAS suites, verdes aislados (2.1) |
| E2E si toca flujo critico | N/A | backend puro: sin ruta, sin UI, sin Server Action |
| RLS en tabla nueva | N/A | **no hay migracion ni tabla** (verificado sobre el diff) |
| Migracion reversible con `down.sql` | N/A | idem |
| Sin secretos hardcodeados | OK | censo de `process.env` en `lib/analytics/**` = 0 (guard R1) |
| Webhooks firmados/idempotentes | N/A | no hay webhook |
| Capas separadas | OK | modulo puro: no importa `@/lib/db`, repos, servicios ni `next/headers` |
| Interfaces en `lib/interfaces/` | N/A | no introduce interfaz de repositorio |
| Permisos server-side / Server Actions | N/A | el filtro **no** es autorizacion (R24); el catalogo solo **declara** alcance |
| Sin hardcode de pais/moneda/cuenta | OK | `metrics.ts` remite a `lib/config/moneda.ts`; ninguna cadena de moneda |
| `./init.sh` en verde | **NO** | cae en la primera puerta (typecheck contaminado). Salida en 2.3 |
| `progress/review_135.md` con veredicto | OK | este archivo |
| Entrada en `progress/history.md` | pendiente | bookkeeping del leader (T6.3) |

---

## 2. Verificacion ejecutable (corrida por el reviewer, no copiada de la bitacora)

### 2.1 Suite completa

```
$ npx vitest run          # worktree wt135, arbol limpio (git status --porcelain vacio)
 Test Files  3 failed | 623 passed (626)
      Tests  4 failed | 7146 passed (7150)
   Duration  478.47s
```

**Los 626 / 7150 CONFIRMAN el delta declarado** (baseline 617 / 6973 -> +9 archivos, +177 tests).

Los 4 rojos **no son de la 135** y **no son reproducibles aislados**:

```
 FAIL tests/unit/components/filter-component.test.tsx        (debounce: 2 emisiones en vez de 1)
 FAIL tests/unit/components/usuario-form.test.tsx            (Test timed out in 15000ms)
 FAIL tests/integration/recuperar-contrasena-form.test.tsx   (2 casos, findByText)

$ npx vitest run <esos 3 archivos>
 Test Files  3 passed (3)
      Tests  60 passed (60)
```

Es flakiness de carga en el filesystem temporal del worktree, del mismo genero que los 2
timeouts de guards que la bitacora reporto en su baseline. **Correccion al parte del
implementer:** dijo "0 fallos"; en mi corrida hay 4 (otros archivos, otra causa). El delta
atribuible a la feature sigue siendo **0 regresiones**.

Suite de la feature + el guard de la 155 que toco:

```
$ npx vitest run tests/unit/analytics tests/unit/guards/censo-order-status-rename.test.ts
 Test Files  10 passed (10)
      Tests  185 passed (185)      # 177 de analitica + 8 del censo de la 155
```

### 2.2 lint

```
$ npx eslint  ->  19 problems (0 errors, 19 warnings)   [preexistentes]
$ npx eslint lib/analytics tests/unit/analytics tests/unit/guards/censo-order-status-rename.test.ts
   exit 0, sin una sola linea de salida
```

### 2.3 typecheck / init.sh — ROJO, causa ajena, delta 0 verificado por mi

```
$ npx tsc --noEmit
lib/repositories/WalletMovimientoRepository.ts(26,5): error TS2322: Type 'WalletOrigenTipo' is not
  assignable to ...  Type '"orden_incidente"' is not assignable to ...
lib/types/wallet.ts(72,7): error TS2322: Type 'true' is not assignable to type 'never'.

$ bash ./init.sh   ->   "'pnpm run typecheck' fallo"   (cae en la primera puerta)
```

No lo acepto por escrito: lo medi.

1. **Causa confirmada.** `node_modules` es un symlink al del checkout principal, que esta en
   `ux`. `git show ux:db/schema.prisma` declara `orden_incidente` en `WalletOrigenTipo`
   (linea 1018); el `db/schema.prisma` de **esta** rama no lo tiene (`grep -c orden_incidente`
   = **0**; el enum vive en :908-917 con 6 valores). El cliente Prisma generado es de la otra rama.
2. **Delta 0, medido.** Repeti el typecheck con un `tsconfig` que **excluye** `lib/analytics` y
   `tests/unit/analytics`: salen **exactamente los mismos 2 errores**, ni uno mas ni uno menos.
   Los dos archivos culpables no aparecen en el diff de la rama (`git show --stat 2bb22453`:
   solo `lib/analytics/**`, `tests/unit/analytics/**`,
   `tests/unit/guards/censo-order-status-rename.test.ts`, spec, bitacora y `feature_list.json`).
3. **Los `@ts-expect-error` negativos SI estan validados**: el typecheck completo (que si incluye
   `tests/unit/analytics`) no anade ningun error, y una directiva `@ts-expect-error` sin error
   seria un error de compilacion. R3/R10/R33 tienen su caso de tipos vivo.

**Consecuencia:** R26 **no se cumple** hoy. Se cierra con `pnpm db:generate` desde el schema de
esta rama y un `node_modules` que no sea el de la otra sesion. No es trabajo del implementer y
hizo bien en no pisar el entorno ajeno.

---

## 3. Trazabilidad R1-R36 verificada POR MUTACION

No me fie del mapa de la bitacora. Rompi la implementacion a proposito, una vez por requisito, y
exigi que el test que dice cubrirlo se pusiera ROJO. Tras cada mutacion el archivo se restauro;
`git status --porcelain` quedo **vacio** al terminar y la suite de la feature vuelve a 185/185.

**Mutaciones ejecutadas: 38. Muertas: 35. Supervivientes: 3 (todas del mismo punto, R22).**
**Requisitos mutados: 35 de 36** (R26 no es mutable: es la puerta ejecutable, la corri yo).

| R | Mutacion aplicada | Resultado | Test que la mato |
|---|---|---|---|
| R1 | `process.env.DATABASE_URL` en `ranges.ts` | MUERTA | `no lee variables de entorno en lib/analytics` |
| R2 | metrica pirata (`dominio: "operativa"`) en `lib/utils/fecha-cr.ts` | MUERTA | `metrics.ts es el unico archivo del repo que declara metricas` |
| R3 | campo 13 (`campoExtra`) en `entregas` | MUERTA | `declara las 12 claves exactas y ninguna extra` |
| R4 | id duplicado (`devoluciones` -> `entregas`) | MUERTA | `no repite ningun id` |
| R5 | `aging_por_estado` a `snapshot` sin rollup | MUERTA | `es snapshot si y solo si su fuente es el rollup analytics_daily` |
| R6 | `ingreso_flete` leyendo `orden` | MUERTA | `ninguna metrica financiera lee orden, gestion_orden, historial ni el rollup` |
| R7 | `admin` a `acotado` en el alcance operativo | MUERTA | `da acceso total a maestro y admin en toda metrica` |
| R8 | estado inexistente (`en_camino`) en una definicion | MUERTA | `todo estado citado por una metrica pertenece a ORDER_STATUS_SEED` |
| R9 | `SINPE` -> `simpe` | MUERTA | `toda categoria citada pertenece a uno de los siete enums autorizados` |
| R10 | `entregas` sin el grano `fecha` | MUERTA | `incluye siempre el grano fecha` |
| R11 | `criterio` propio (`umbral_propio_intentos`) | MUERTA | `primer_intento_ok remite al criterio de intentos vigentes del historial` |
| R12 | tag operativa = tag financiera | MUERTA | `distingue la etiqueta operativa de la financiera` |
| R13 | `hasta` inclusivo (ventana cerrada) | MUERTA | `el instante hasta NO pertenece al rango y el anterior si` |
| R14 | `const CR_OFFSET_MS = 6 * 60 * 60 * 1000` en `ranges.ts` | MUERTA | `no reimplementa el desfase UTC-6 en ningun archivo de lib/analytics` |
| R15 | `dia` = ayer + hoy | MUERTA | `a las 20:00 CR del 14 el dia sigue siendo el 14, no el 15 UTC` |
| R16 | `desde` desplazado 3 h (fuera de frontera de dia) | MUERTA | invariantes (b)-(e) + casos de `dia` |
| R17 | `now` por defecto fijo (`2020-01-01`) | MUERTA | `usa el instante actual cuando no se pasa now` |
| R18 | fecha con `getFullYear/getMonth/getDate` (hora local del proceso) | MUERTA | `da el mismo resultado con TZ=UTC y con TZ=Asia/Tokyo` |
| R19 | `.strict()` -> `.passthrough()` | MUERTA | `rechaza una clave desconocida junto a un filtro por lo demas valido` |
| R20 | `rango` opcional y `z.string()` | MUERTA | `rechaza el filtro sin rango` / `rechaza el preset trimestre` |
| R21 | `idList` sin `.nonempty()` ni `.min(1)` | MUERTA | `rechaza la lista vacia de zona_id` |
| **R22** | **regex de ancho fijo desactivado** | **SOBREVIVE** | ver 3.1 |
| R23 | `parse` en vez de `safeParse` (lanza) | MUERTA | los casos de rechazo revientan con excepcion |
| R24 | `rol` y `usuario_id` admitidos en el schema | MUERTA | `rechaza el campo rol` / `rechaza el campo usuario_id` |
| R25 | archivo nuevo `lib/services/TmpMutacion135Service.ts` | MUERTA | `no anade acciones, servicios ni repositorios` + censo positivo |
| R26 | no mutable (es la puerta ejecutable) | verificado por el reviewer | seccion 2: init.sh ROJO |
| R27 | semana empieza domingo (`(dow+6)%7` -> `dow`) | MUERTA | `la semana empieza el lunes CR y llega hasta hoy` |
| R28 | ventana movil de 31 dias | MUERTA | `el preset mes es una ventana movil de 30 dias, no el mes calendario` |
| R29 | `RANGO_TOPE_DIAS` 366 -> 400 | MUERTA | `rechaza la ventana de 367 dias contando ambos extremos` |
| R30 | `entregas` sin `sinAsignar: "incluir"` | MUERTA | `agrupa las ordenes sin mensajero en el cubo sin_asignar` |
| R31 | borde en medianoche UTC (convencion del ranking) | MUERTA | `usa el dia natural de Costa Rica 00:00-24:00` |
| R32 | dinero abierto a `adminTienda` (`acotado`) | MUERTA | `solo los roles de acceso total ven metricas financieras` |
| R33 | desaparece `estadoProduccion: "declarada"` | MUERTA | `admite metricas declaradas sin productor` |
| R34 | `atribucionZona: "usuario"` | MUERTA | `atribuye por la zona de la orden en toda metrica con grano zona` |
| R35 | `entregas` contada por orden | MUERTA | `cuenta gestiones vigentes, no ordenes` |
| R36 | `sonSumables` devuelve siempre `true` | MUERTA | `sonSumables devuelve false entre entregas y ordenes_creadas` |

### 3.1 El unico superviviente: R22 (menor, con explicacion medida)

Tres sondas sobre `lib/analytics/filters.ts`:

| sonda | mutacion | resultado |
|---|---|---|
| R22 | `fechaCalendario.optional()` -> `z.string().optional()` (regex fuera) | SOBREVIVE (35/35 verdes) |
| R22b | `fechaCalendario = z.string()` dejando el resto intacto | SOBREVIVE |
| R22c | el `.refine` del tope deja pasar `NaN` (falla ABIERTO) | SOBREVIVE |
| R22b + R22c a la vez | las dos | **ROJO**: caen 3 tests de R22 |

Lectura honesta: el comportamiento que R22 exige (**no se aceptan instantes, offsets ni epochs**)
esta garantizado por **dos redes redundantes** —el regex de ancho fijo y el `.refine` del tope,
que rechaza cuando `diasInclusive` devuelve `NaN`— y los tests solo caen si se quitan **las dos**.
O sea: no hay agujero de comportamiento, pero **ningun test discrimina el mecanismo que R22 nombra
por su nombre** (patron de ancho fijo), y el caso que el propio comentario de `filters.ts`
documenta —fecha que pasa el regex pero no existe, `"2026-13-45"`— **no tiene test** (por eso R22c
sobrevive sola). Es **menor**, no bloqueante: dos aserciones lo cierran.

---

## 4. Las 4 tasks sin marcar: la razon escrita, es honesta?

- **T0.3** (ticket de saneamiento de `RankingService`, D6) — **honesta y NO hecha**. Verificado:
  `feature_list.json` tiene `maxid = 161` y ninguna entrada nueva; las features de ranking (76, 94)
  no referencian D6 ni la 135. Es bookkeeping fuera del alcance de codigo, pero sigue abierta.
- **T6.1** (`typecheck`/`lint`/`test`/`init.sh` en verde) — **honesta, la verifique yo** (2.3). Los
  2 errores viven en archivos fuera del diff y los causa el cliente Prisma de `ux`; el **delta es 0
  medido**, no declarado. No maquillo la casilla: eso es lo correcto.
- **T6.3** (bookkeeping) — **parcial**: la entrada 135 de `feature_list.json` si paso a
  `in_progress` con `status_note`, pero `progress/current.md` sigue diciendo `spec_ready` (linea 13)
  y no hay entrada en `progress/history.md`. Dejarla sin marcar es correcto.
- **T6.5** (avisos a 123/126/127/132/133) — **honesta y NO hecha**. Verificado una a una:
  **ninguna** de las cinco menciona la 135 ni `design.md` seccion 6.1. Es el aviso mas caro de
  perder: sin el, la 132/133 pueden disenar una vista financiera recortada que **no existe** (D7).

Ninguna de las cuatro es una excusa: las cuatro describen exactamente lo que falta.

---

## 5. Las 10 decisiones del humano, una a una

| D | Exigencia | Estado | Donde |
|---|---|---|---|
| D1 | catalogo entero (15 operativas + 8 financieras = 23) | **OK** | `METRICAS.length === 23`; ids identicos a `design.md` 3.3, uno por uno |
| D2 | la semana empieza **lunes** | **OK** | `lunesDeLaSemanaCR` con `(getUTCDay()+6)%7`; mutacion a domingo = ROJO |
| D3 | `mes` = ventana **movil de 30 dias**, no calendario | **OK** | `MES_MOVIL_DIAS = 30`; el test exige `30*24 h` siempre y `desdeFecha != "2026-07-01"` |
| D4 | rango arbitrario con tope **366 dias** | **OK** | `RANGO_TOPE_DIAS = 366` en `types.ts` (constante unica); 366 acepta / 367 rechaza |
| D5 | cubo **`sin_asignar`** | **OK** | `MENSAJERO_SIN_ASIGNAR`; toda metrica con grano `mensajero` declara `sinAsignar: "incluir"`; censo repo-wide del literal = 0 fuera de `lib/analytics` |
| D6 | dia natural CR 00:00-24:00 via `inicioDelDiaCREnUtc`, **no** 18:00-18:00 | **OK** | todo borde en `T06:00:00.000Z`; censo de `startOfDayCR` en `lib/analytics/**` = 0; divergencia escrita en la cabecera de `ranges.ts` |
| D7 | financiera solo para los roles de `esAccesoTotal()`; `prohibido` para los otros 3 | **OK** | `ALCANCE_FINANCIERA`; el test usa **`esAccesoTotal` como criterio**, no una lista a mano; `listarMetricas({rol})` da 0 financieras a los tres |
| D8 | `declarada` / `producida` | **OK** | 20 producidas + 3 declaradas (`incidentes`, `sin_gestionar`, `egresos`), justificadas una a una en la bitacora |
| D9 | atribucion por **`orden.zona_id`** | **OK** | `atribucionZona: "orden"` en toda metrica con grano `zona`; censo de `usuario.zona_id` = 0 |
| D10 | conteo **por gestion**; ordenes y gestiones **no se suman** | **OK** | 5 metricas con `unidadDeConteo: "gestion"` + `excluye` citando `anulada_at`; `sonSumables("entregas","ordenes_creadas") === false`; no existe familia `*_por_orden`; las 3 tasas advierten en su `descripcion` que el denominador no son ordenes |

---

## 6. Frontera de la feature

- **Sin migracion**: el diff no toca `db/migrations/**` ni `db/schema.prisma` (solo lo **lee** en
  dos guards). Verificado sobre `git show --stat` y por `frontera.guardia.test.ts`.
- **Sin UI, sin Server Actions, sin servicios ni repositorios**: cero archivos en `app/`,
  `components/`, `lib/actions/`, `lib/services/`, `lib/repositories/`.
- **Nadie consume `lib/analytics/` todavia**: censo de imports en todo el repo -> solo los 4
  modulos propios y sus 9 tests (mas el comentario de la allowlist de la 155). Correcto: los
  consumidores son la 122/126/127.
- **`lib/utils/fecha-cr.ts` se REUSA, no se duplica**: `ranges.ts` importa los tres helpers y **no
  declara ni la duracion de un dia** (la deriva de los propios helpers). El unico literal temporal
  del modulo esta en `filters.ts` (`MS_POR_DIA = 24*60*60*1000`), que cuenta calendario sobre
  medianoche UTC y no toca la frontera de dia CR: no viola R14, pero rompe la simetria que
  `ranges.ts` presume (**menor**).

## 7. El catalogo cita el mundo real

- `ordenes_por_estado` enumera **`ORDER_STATUS_SEED` entero** (19), no una copia: el guard compara
  `definicion.estados` con el seed elemento a elemento.
- **`en_fulfillment` no aparece** en ninguna definicion ni en ningun archivo de `lib/analytics`
  (dos aserciones separadas).
- Se apoya en **`ESTADOS_CREACION`** (`ordenes_creadas`) y en **`ESTADOS_CREACION + ESTADOS_TERMINALES`**
  (`tiempo_ciclo`), importados, no reescritos.
- **`GestionCausaDevolucion` = 3 valores**: `motivos_devolucion` cita `not_found`, `wrong_number`,
  `wrong_address`, y el guard los lee **de `db/schema.prisma`**, no de la prosa del spec
  (`expect(causas).toEqual([...3...])`). El defecto "5 valores" quedo corregido en
  `requirements.md` y anotado en la bitacora. Correcto.

## 8. La entrada nueva en la ALLOWLIST de la 155: justificada o evasion?

**Justificada.** Juicio, no tramite:

1. La entrada es `definiciones-catalogo.guardia.test.ts`, un guard **hermano**: afirma que el
   catalogo **NO** cita el value retirado. Para censar una ausencia hay que escribir el literal
   —exactamente el motivo por el que el propio archivo del censo es la **primera** entrada de su
   allowlist desde antes de esta feature.
2. La alternativa (construir el literal por concatenacion) **si** habria sido evasion, y la
   bitacora la descarta por escrito.
3. La justificacion son 11 lineas **dentro del archivo**, comprensibles sin contexto externo, en la
   forma que el propio guard exige ("una allowlist sin justificacion es un agujero").
4. **No afloja nada**: el censo sigue con 7 `OLD_VALUES` y el guard quedo **verde 8/8** (lo corri).
   El efecto colateral en `frontera.guardia.test.ts` es una lista de **rutas exactas**, con un test
   propio que falla si alguien la convierte en prefijo de carpeta (mutacion R25: ROJO).

**Menor heredado (no lo introduce la 135):** la allowlist compara por `basename`, asi que exime a
cualquier archivo con ese nombre en cualquier carpeta. Es el mecanismo preexistente de la 155.

---

## 9. Hallazgos

**BLOQUEANTES (para pasar a `done`; ninguno atribuible al codigo de la 135)**

1. **BLOQUEANTE — R26 incumplido: `./init.sh` y `pnpm run typecheck` en ROJO.** 2 errores en
   `lib/repositories/WalletMovimientoRepository.ts:26` y `lib/types/wallet.ts:72`, por un cliente
   Prisma generado desde el schema de `ux` (`orden_incidente` no existe en el schema de esta rama).
   **Delta 0 verificado por el reviewer** excluyendo los archivos de la feature: salen los mismos 2
   errores. *Que falta:* `pnpm db:generate` con el schema de esta rama y un `node_modules` que no
   sea el symlink a la sesion ajena; luego `./init.sh` en verde y marcar T6.1.
2. **BLOQUEANTE — `tasks.md` con 4 casillas abiertas** (CHECKPOINTS exige todas `[x]`): T0.3 (ticket
   de `RankingService`, verificado inexistente en `feature_list.json`), T6.1, T6.3
   (`progress/current.md` sigue en `spec_ready` y no hay entrada en `history.md`) y T6.5
   (verificado: **ninguna** de las features 123/126/127/132/133 menciona la 135 ni `design.md` 6.1).
   *Que falta:* el bookkeeping del leader; T6.5 es el mas caro de perder por D7.

**MENORES**

3. **menor — R22: mutante superviviente.** Quitar el regex de ancho fijo deja los 35 tests de
   `filters.test.ts` en verde (la red que salva el caso es el `.refine` del tope, via `NaN`). No hay
   agujero de comportamiento (3.1), pero R22 no esta verificado por su propio mecanismo y el caso
   `"2026-13-45"` que documenta `filters.ts` no tiene test. Dos aserciones lo cierran.
4. **menor — `conciliacion_cierres`:** `unidad: "conteo"` con `unidadDeConteo: "moneda"`. Esta asi en
   `design.md` 3.3 (contrato aprobado), pero implica que `sonSumables` la declara sumable con las
   metricas de dinero aunque lo que cuenta son **cierres**. Que la 126/132 lo sepan.
5. **menor — asimetria de constantes temporales:** `ranges.ts` presume de no escribir ninguna (deriva
   el dia de los helpers) y `filters.ts` escribe `MS_POR_DIA = 24*60*60*1000`. No viola R14 (el censo
   persigue el offset de 6 h) pero desmiente la nota de cabecera.
6. **menor — el uso de `ESTADOS_CREACION`/`ESTADOS_TERMINALES` no esta guardado:** una lista paralela
   con los mismos valores pasaria los tests de R8. Hoy el codigo importa las constantes (correcto),
   pero nada impide que manana alguien las expanda a mano.
7. **menor — allowlist por `basename`** (heredado de la 155), seccion 8.
8. **menor — el parte de la bitacora dice "0 fallos" en la suite completa**; en mi corrida hay **4**
   (3 archivos ajenos, flakiness de carga, verdes aislados). No cambia el delta de la feature, pero
   el numero pegado no es reproducible tal cual.

---

## 10. Veredicto

**APROBADO-CON-NOTAS.**

- **Codigo y trazabilidad: APROBADOS.** 36/36 requisitos mapeados; **35 verificados por mutacion**
  (34 muertas + R22 superviviente benigno); R26 verificado ejecutandolo yo. Las 10 decisiones del
  humano estan implementadas como dicen, incluida la rectificacion de D7 anclada a `esAccesoTotal()`.
  La frontera de la feature se respeta y el alta en la allowlist ajena esta justificada, no evadida.
- **La feature NO pasa a `done`** hasta cerrar los dos bloqueantes de la seccion 9: `./init.sh` en
  verde con un cliente Prisma limpio (T6.1) y el bookkeeping abierto (T0.3, T6.3, T6.5). Ninguno de
  los dos vuelve al implementer como defecto de codigo: el primero es de entorno y el segundo es del
  leader.
