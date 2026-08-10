# impl_166 — Ranking: ventana del día natural CR

Rama `feature/166-ranking-ventana-dia`, base `origin/dev` @ `64957dca`
(spec en `fbbe00d8`). Zona `backend`. Cero migraciones, cero cambios de contrato,
`RankingRepository` **sin tocar**.

## 1. Qué cambió

`lib/services/RankingService.ts` resolvía la ventana «hoy» como
`[startOfDayCR(now), +24 h)`. `startOfDayCR` devuelve la **medianoche UTC** de la
fecha calendario CR — la convención correcta para columnas `@db.Date` (feature 46)
— pero las dos cotas se comparan contra columnas `timestamp` reales
(`gestion_orden.created_at`, `orden.asignado_at`), así que la ventana efectiva era
**18:00 → 18:00 hora CR**: una entrega de las 19:00 CR contaba para el día
siguiente.

Ahora se compone con la convención de la feature 144 —la misma que ya usaba la
analítica—: `fechaCalendarioCR` → `inicioDelDiaCREnUtc` /
`inicioDelDiaSiguienteCREnUtc`. Ambos bordes caen en `...T06:00:00.000Z`.

Con eso, la divergencia que `lib/analytics/ranges.ts` declaraba ACEPTADA (D6/R31
de la 135) queda **cerrada**: analítica y ranking resuelven «hoy» con cotas
idénticas al milisegundo. El bloque `(c)` de `ranges.ts` se reescribió para
seguir nombrando la trampa `startOfDayCR` (que sigue viva y sigue prohibida en
`lib/analytics/**`) sin seguir prometiendo dos cifras distintas.

## 2. Mapa `R1..R16 → test` (todos ejecutados y verdes)

| R | Test | Fichero |
| --- | --- | --- |
| R1 | «la ventana de hoy es el dia natural CR: ambos bordes en `T06:00:00.000Z`» | `tests/unit/services/ranking-service.test.ts` |
| R2 | «pasa la MISMA pareja (desde, hasta) a entregadas y a asignadas» | idem |
| R3 | «la entrega de las 19:00 CR cuenta HOY, no manana» | idem |
| R4 | «la entrega de las 19:00 CR de AYER queda fuera del ranking de hoy» | idem |
| R5 | «23:59:59.999 CR dentro; 00:00:00.000 CR del dia siguiente fuera (cota exclusiva)» | idem |
| R6 | «no usa startOfDayCR, offsets a mano ni literales horarios (R6)» | `tests/unit/guards/ranking-ventana-dia.guardia.test.ts` |
| R7 | «dos llamadas con el mismo `now` producen la misma ventana» + «no lee el reloj sin argumento en la ruta de resolucion de la ventana (R7)» | `ranking-service.test.ts` + guardia |
| R8 | suite existente de la 76 (R2–R19) y `ranking-actions.test.ts`, **sin un solo assert modificado** | `ranking-service.test.ts`, `tests/unit/actions/ranking-actions.test.ts` |
| R9 | «documenta la trampa `startOfDayCR` y la divergencia YA CERRADA con el ranking (166)» | `tests/unit/analytics/ranges-reuso.guardia.test.ts` |
| R10 | los cuatro censos de `lib/analytics/**` (`:54-96`), **intactos** | idem |
| R11 | suites sin cambios, verdes | `tests/unit/utils/fecha-cr.test.ts`, `tests/unit/utils/fecha-cr-filtros.test.ts` |
| R12 | suites sin cambios, verdes | `tests/unit/services/liberar-reprogramadas-handler.test.ts`, `tests/unit/utils/periodicidad.test.ts` |
| R13 | «la ventana coincide al milisegundo con `resolverRango({preset:"dia"}, now)`» | `ranking-service.test.ts` |
| R14 | «la cota superior son las 24:00 CR, no `now`» | idem |
| R15 | «la fuente del service cita inicioDelDiaCREnUtc y la ficha 166 (R15)» | `ranking-ventana-dia.guardia.test.ts` |
| R16 | «no hay migracion nueva de ranking/premio y premio_ranking no cambia (R16)» | idem |

Ningún requisito queda «pendiente». Las dos guardias traen además su propia
**autocomprobación** del censo (`el censo detecta lo que dice detectar`), que es lo
que impide que se vuelvan verdes por vacías.

## 3. Salida real de los tests

Los nueve ficheros implicados (T1–T5, T7, T8), sobre el árbol final:

```
 RUN  v4.1.10 C:/w166
 Test Files  9 passed (9)
      Tests  92 passed (92)
   Duration  16.47s
```

Suite de guardias completa (`pnpm run test:guardias`), medida en T8:

```
 Test Files  59 passed (59)
      Tests  811 passed (811)
```

### Gate completo antes del PR (T12) — DOS corridas

| corrida | archivos | tests | rojos |
| --- | --- | --- | --- |
| 1ª | 926 | 11 497 | **4** — `filter-component.test.tsx`, `no-embalaje.test.ts`, `wallet-tiendas-desglose.test.tsx` + un cuarto que el log truncado no dejó nombrar |
| 2ª | 926 | 11 497 | **1** — `LoginForm.test.tsx` (R17, fase OTP) |

Los dos conjuntos de rojos son **disjuntos** y **ninguno** importa `RankingService`,
`ranges.ts` ni `fecha-cr.ts`. Todos son timeouts de 20 s. Re-ejecutados en aislado
sobre el mismo árbol: `5 files / 91 tests` verdes (los de la 1ª corrida más los dos
del gate rápido) y `1 file / 26 tests` verde (`LoginForm`). Es la firma documentada
de **flake por saturación** de este repo, no regresión.

**926 archivos** contra los 913 del baseline de `dev` medido en `0c9ab8ce`: la
corrida **no** está degradada —hay más ficheros porque `dev` avanzó desde entonces—.
Lo que este cambio aporta al conteo es cero rojos.

**Mutación de control ejecutada y revertida** (T7): sustituidas las 3 menciones de
`startOfDayCR` en `ranges.ts` ⇒ el guardia cayó **solo** en el caso reexpresado
(`1 failed | 5 passed (6)`); restaurado ⇒ `6 passed (6)`. El guardia sigue
exigiendo **tres** coincidencias simultáneas (`startOfDayCR`, `/18:00/`, `/166/`),
no se vació al reexpresarlo.

## 4. Discontinuidad declarada (respuesta Q1 = opción C)

El corte de ventana **no** se migra ni se recalcula hacia atrás: el día en que se
despliegue, el ranking cambia de significado de golpe. Es una discontinuidad
**declarada y aceptada** por el humano el 2026-08-04 (`requirements.md §6`).

**Condición de despliegue, obligatoria y no negociable (Q2): el merge/deploy debe
caer entre las 00:00 y las 06:00 hora CR.** Fuera de esa franja el podio del día
ya tiene entregas contadas con la ventana vieja y la premisa de «podio vacío» se
rompe: hay que volver a preguntar al humano antes de desplegar.

Fecha y hora exactas del despliegue: **pendientes de fijar al abrir el merge**;
se anotan aquí y en `progress/current.md` en el momento de mergear, no antes.

**Q3** = sí: se comunica a los mensajeros que el corte del día pasa de 18:00 a
00:00 CR (tarea de despliegue, no de código).
**Q4** = hecho: nota de supersesión apendada a `specs/76-ranking-mensajeros/`
(`requirements.md` +22/−0, `design.md` +21/−0, cero líneas históricas tocadas).

## 5. Ficheros NO TOCAR (design §4 A6/A7/A9) — verificado

`git diff --name-only origin/dev` no lista `lib/utils/fecha-cr.ts`,
`lib/analytics/rollup-dia.ts`, `lib/services/AnaliticaOperativaService.ts`,
`tests/unit/analytics/rollup-*.test.ts`, `tests/unit/analytics/operativa-intradia.test.ts`,
ni nada bajo `specs/124`, `specs/135` o `progress/` salvo este mismo fichero.

## 6. Deuda de entorno (no de la feature)

El worktree `C:\w166` nació sin `.env`, así que `pnpm db:generate` no podía correr
y el cliente Prisma generado faltaba: el typecheck salía rojo por tipos fantasma,
**no** por el cambio. Se copió el `.env` del checkout principal y se regeneró el
cliente antes de medir el gate.
