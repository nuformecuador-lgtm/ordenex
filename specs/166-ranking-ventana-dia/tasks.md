# 166 — Tasks

Rama `feature/166-ranking-ventana-dia` (base `origin/dev` @ `64957dca`).
`[P]` = paralelizable con las tareas del mismo bloque. Toda referencia fichero:línea está en
`design.md §4`.

---

## Bloque 0 — puerta humana (BLOQUEA todo lo demás)

- [x] **T0** — Obtener respuesta a **Q1** (`requirements.md §5`) y, si el humano quiere,
      a Q2/Q3/Q4.
      *Hecho:* la decisión queda escrita en `requirements.md §5` con fecha y autor.
      **Si Q1 ≠ opción C**, se detiene la implementación y se re-estima la ficha (H6 del design):
      `low` deja de ser válido.
      **CERRADA el 2026-08-04.** Las CUATRO respondidas, escritas en `requirements.md §6`:
      **Q1 = opción C** (discontinuidad declarada) → la ficha **sigue siendo `low`** y T1–T9 quedan
      desbloqueadas sin re-estimar. **Q2** = desplegar entre 00:00 y 06:00 CR y nada más.
      **Q3** = sí, se comunica a los mensajeros (tarea de despliegue). **Q4** = sí, nota de
      supersesión **apendada** a los specs de la 76.
      *Depende de:* nada. *Bloquea:* T1–T9.

---

## Bloque 1 — tests primero (rojos antes del cambio)

- [x] **T1** `[P]` — Reescribir el bloque de ventana de
      `tests/unit/services/ranking-service.test.ts:243-256` con los casos de **R1, R2, R5, R7,
      R13 y R14**: bordes en `T06:00:00.000Z`, misma pareja `(desde, hasta)` a ambos conteos,
      cota superior exclusiva, determinismo con el mismo `now`, igualdad al milisegundo con
      `resolverRango({ preset: "dia" }, now)` y `hasta` = 24:00 CR (no `now`).
      *Hecho:* los casos existen, **fallan** contra el código actual, y su mensaje nombra la
      ventana esperada.
      *Depende de:* T0.
      **HECHA.** 8 casos en `describe("RankingService.obtenerRanking — ventana del dia natural
      CR (166)")`; 6 de ellos rojos contra el código viejo (R2 y R7 ya pasaban: son invariantes
      que la ventana vieja también cumplía, valen como no-regresión).

- [x] **T2** `[P]` — Añadir a `ranking-service.test.ts` los casos de frontera de **R3 y R4**:
      un evento a las 19:00 CR de hoy CUENTA hoy; un evento a las 19:00 CR de ayer NO cuenta hoy.
      Ambos expresados con instantes UTC explícitos y comentario de la hora CR equivalente.
      *Hecho:* dos casos rojos que se vuelven verdes solo con la ventana nueva (mutación:
      restaurar `startOfDayCR` ⇒ rojo).
      *Depende de:* T0.
      **HECHA.** Ambos casos rojos antes de T4, verdes después.

- [x] **T3** `[P]` — Crear `tests/unit/guards/ranking-ventana-dia.guardia.test.ts` con los cinco
      casos de `design.md §6` (**R6, R7, R15, R16**), incluida la **autocomprobación** del censo.
      *Hecho:* la guardia falla hoy (el service aún importa `startOfDayCR`) y su autocomprobación
      pasa; `pnpm run test:guardias` la selecciona sin añadirla a ninguna lista.
      *Depende de:* T0.
      **HECHA.** 5 casos. Los de R6/R15 rojos antes de T4. El censo de R7 neutraliza
      quirúrgicamente el default de firma `now: Date = new Date()` (costura de reloj de la 76,
      que NO se elimina) vía `sinDefaultDeNow()`, y la autocomprobación verifica que esa
      excepción solo perdona la firma y no un `new Date()` del cuerpo.

---

## Bloque 2 — el cambio de producción

- [x] **T4** — En `lib/services/RankingService.ts`: sustituir el import de `startOfDayCR`
      (`:11`) por `fechaCalendarioCR`, `inicioDelDiaCREnUtc` e `inicioDelDiaSiguienteCREnUtc`;
      eliminar la constante local `UN_DIA_MS` (`:15-17`); reemplazar `:60-61` por la composición
      de `design.md §2`; reescribir el comentario de `:59` citando la ficha **166**, la
      convención de la 144 y por qué `startOfDayCR` no sirve contra columnas `timestamp` (**R15**).
      *Hecho:* T1, T2 y T3 en verde; `RankingRepository` **sin tocar**; `pnpm run typecheck` y
      `pnpm run lint` limpios.
      *Depende de:* T1, T2, T3.
      **HECHA.** `RankingRepository.ts` no aparece en el diff. Typecheck y lint limpios.

- [x] **T5** — Verificar **R8/R12 por no-regresión**: `tests/unit/services/ranking-service.test.ts`
      (resto de la suite de la 76), `tests/unit/actions/ranking-actions.test.ts`,
      `tests/unit/repositories/ranking-repository.test.ts`,
      `tests/unit/services/liberar-reprogramadas-handler.test.ts`,
      `tests/unit/utils/periodicidad.test.ts`, `tests/unit/utils/fecha-cr.test.ts` y
      `tests/unit/utils/fecha-cr-filtros.test.ts`.
      *Hecho:* los siete ficheros pasan **sin haber modificado ni un assert** en ninguno de ellos
      (salvo el bloque reescrito en T1/T2). Se pega la salida en `progress/impl_166.md`.
      *Depende de:* T4.
      **HECHA.** `Test Files 7 passed (7)` · `Tests 81 passed (81)`, cero asserts tocados.

---

## Bloque 3 — retirar la divergencia congelada

- [x] **T6** — Reescribir el bloque `(c)` de `lib/analytics/ranges.ts:39-51` (**R9**): la
      divergencia con el ranking queda **CERRADA por la feature 166**; se conserva la explicación
      de por qué `startOfDayCR` (medianoche UTC, convención `@db.Date`) no sirve como cota contra
      columnas `timestamp` y la prohibición de importarla aquí.
      *Hecho:* el texto ya no promete cifras distintas para «hoy», y sigue conteniendo
      `startOfDayCR`, `18:00` y `166`.
      *Depende de:* T4. *Debe ir en el MISMO commit que T7* (si no, el árbol queda rojo).
      **HECHA.** `startOfDayCR` aparece SOLO en comentario (el censo de `:91-96`, intacto,
      la prohíbe en código de `lib/analytics/**`).

- [x] **T7** — Reexpresar `tests/unit/analytics/ranges-reuso.guardia.test.ts:98-106` según
      `design.md §5` (**R9**) y actualizar su cabecera en prosa (`:5-28`, **A3**). **No tocar**
      los censos de `:54-96` (**R10**).
      *Hecho:* el guardia sigue exigiendo **tres** coincidencias simultáneas en `ranges.ts`
      (`startOfDayCR`, `/18:00/`, `/166/`); los cuatro censos siguen presentes y verdes;
      mutación de control: borrar la mención de `startOfDayCR` en `ranges.ts` ⇒ rojo.
      *Depende de:* T6 (mismo commit).
      **HECHA.** Mutación de control ejecutada y revertida: sustituidas las 3 menciones de
      `startOfDayCR` en `ranges.ts` ⇒ el guardia cayó SOLO en el caso reexpresado
      (`1 failed | 5 passed (6)`); restaurado ⇒ `6 passed (6)`.

- [x] **T8** `[P]` — Confirmar por censo que **ningún otro anclaje** quedó vivo ni se tocó de más:
      `pnpm run test:guardias` completo + revisión de que el diff **no toca** los ficheros de
      `design.md §4 A6, A7 y A9`.
      *Hecho:* `git diff --name-only origin/dev` no lista `lib/utils/fecha-cr.ts`,
      `lib/analytics/rollup-dia.ts`, `lib/services/AnaliticaOperativaService.ts`,
      `tests/unit/analytics/rollup-*.test.ts`, `tests/unit/analytics/operativa-intradia.test.ts`
      ni nada bajo `specs/124|135` / `progress/*` (salvo `impl_166.md`).
      *Depende de:* T7.
      **HECHA.** `test:guardias`: `Test Files 59 passed (59)` · `Tests 811 passed (811)`.
      Ningún fichero **NO TOCAR** (A6/A7/A9) aparece en el diff.

- [x] **T9** `[P]` — **Solo si Q4 = sí:** añadir nota de supersesión al final de
      `specs/76-ranking-mensajeros/requirements.md` y `design.md` («la ventana Hoy(CR) de esta
      feature quedó sustituida por la 166; ver `specs/166-ranking-ventana-dia/`»), sin reescribir
      el histórico.
      *Hecho:* dos notas apendidas, cero líneas históricas modificadas.
      *Depende de:* T0 (respuesta a Q4).
      **HECHA.** `requirements.md` +22/−0, `design.md` +21/−0: solo líneas añadidas al final.

---

## Bloque 4 — cierre

- [x] **T10** — Escribir `progress/impl_166.md` con el **mapa `R1..R16 → test`** de
      `requirements.md §4`, la salida real de los tests y la nota de la discontinuidad (Q1):
      fecha y hora exactas del despliegue acordado.
      *Hecho:* los 16 requisitos tienen un test nombrado y ejecutado; ningún «pendiente».
      *Depende de:* T5, T8.
      **HECHA.** Los 16 mapeados. La fecha/hora exacta del despliegue queda **abierta a
      propósito**: se fija al abrir el merge y se anota entonces; lo que sí queda escrito es la
      franja obligatoria 00:00–06:00 CR.

- [x] **T11** — Gate rápido de tanda: `./init.sh --rapido`.
      *Hecho:* verde (typecheck + lint + relacionados + **todas** las guardias).
      *Depende de:* T10.
      **HECHA con salvedad medida.** Typecheck y lint limpios; `73 files / 705 tests` con
      **2 timeouts** en `FiltrosOperativos.test.tsx` y `TableroOperativo.test.tsx` (ficheros de
      la 131, que esta rama no toca). En aislado: `2 files / 21 tests` verdes. Flake de
      saturación. Antes hubo que copiar el `.env` al worktree y correr `pnpm db:generate`: sin
      cliente Prisma el typecheck salía rojo por entorno, no por contenido.

- [x] **T12** — Gate completo **antes del PR**: `./init.sh`.
      *Hecho:* suite entera verde, con el nº de archivos comparado contra el baseline de `dev`
      (una corrida degradada reporta de menos y parece verde). Delta de rojos = 0.
      *Depende de:* T11.
      **HECHA, DOS corridas.** `926 files / 11 497 tests` en ambas (no degradada; el baseline
      de `dev` en `0c9ab8ce` eran 913 y `dev` avanzó). 1ª: 4 rojos. 2ª: 1 rojo, **conjunto
      disjunto** del anterior. Ninguno importa `RankingService`, `ranges.ts` ni `fecha-cr.ts`;
      todos son timeouts de 20 s y todos pasan en aislado. Delta atribuible a esta rama = **0**.
      Detalle en `progress/impl_166.md §3`.

- [ ] **T13** — Actualizar `feature_list.json` (id 166: `status`, `branch`, `spec_path`) y
      `progress/current.md` con el corte de ventana aplicado.
      *Hecho:* el diff de `feature_list.json` es **solo** el de la ficha 166, en LF.
      *Depende de:* T12.

---

## Criterio global de «hecho» de la feature

1. Los 16 requisitos mapeados a un test ejecutado y verde (`progress/impl_166.md`).
2. Ningún fichero de `design.md §4` marcado **NO TOCAR** aparece en el diff.
3. Cero migraciones, cero cambios de contrato, cero cambios en `RankingRepository`.
4. `./init.sh` completo en verde con delta 0 contra el baseline de `dev` medido en la misma sesión.
