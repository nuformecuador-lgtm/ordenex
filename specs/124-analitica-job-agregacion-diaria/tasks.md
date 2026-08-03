# Feature 124 — analítica: job de agregación diaria · tasks

> **PUERTA T0 CERRADA el 2026-08-01** (D1→A2, D2→B2, D3+D8→(i) 00:30 CR con R35 estricto, D4→C1,
> D5→(i), D6→E1, D7→excluir borradas, D9→transacción única sin lotes ni topes inventados). Las
> respuestas y su porqué están en `requirements.md > T0`; **esa sección manda** sobre cualquier
> párrafo de aquí.
>
> Marcas: **[P]** = paralelizable con las tareas de su mismo bloque. Cada task lleva su **criterio
> de hecho**, y donde el spec exige falsabilidad, el criterio **es la mutación observada en rojo**,
> no la ejecución en verde.
>
> Reglas de la casa que aplican a todas: worktree aislado, base **local** `localhost:5432/ordenex`
> (producción no se toca ni para leer), `pnpm exec next build` si hace falta compilar (**nunca**
> `pnpm build`: encadena migraciones), y **delta 0** medido contra el baseline de esta rama, no
> contra el de la bitácora.

---

## T0 — Puerta de decisiones (CERRADA)

- [x] **T0.1** Nueve decisiones recogidas **por escrito**: D1, D2, D3+D8 y D7 del humano; D4, D5, D6
      y D9 del leader.
      *Hecho:* apendadas en `requirements.md > T0 — PUERTA CERRADA`, cada una con respuesta, porqué
      y lista de requisitos propagados. «Gate aprobado en la bitácora» no contaba y no se usó.
- [x] **T0.2** Propagación a los requisitos: ya no queda ni una marca «(pendiente de D*n*)».
      Reescritos **R5, R10, R11, R12, R13, R22, R23, R24, R30, R35, R36, R39, R42, R43, R44, R47,
      R48** y añadido **R49** (caracterización de la reproducibilidad parcial).
      *Hecho:* `requirements.md` no contiene la cadena «pendiente de D»; el total es **49** R.
- [x] **T0.3** Mutaciones revisadas tras cerrar: las de R10/R11/R13 incorporan el filtro de
      `deleted_at` (D7), la de R24 pasa a discriminar la **cota estricta** del corte, la de R11
      discrimina el **universo B2**, y la de R30 incluye «partirla en dos commits» (D9).
      *Hecho:* ninguna mutación del documento describe un escenario que las decisiones hayan vuelto
      imposible.
- [x] **T0.4** Medir el **baseline** de la rama antes de tocar código: `pnpm db:generate`,
      `pnpm run typecheck`, `pnpm run lint`, `pnpm test` (corrida **no degradada**: comprobar el
      total de archivos, ~660+; una corrida con `unhandled errors` omite archivos enteros y parece
      verde).
      *Hecho:* los cuatro números y los archivos rojos **nombrados uno a uno** en
      `progress/impl_124.md`.
- [x] **T0.5** Verificar el estado de la base local: `prisma migrate status` (solo lectura) y
      `SELECT count(*) FROM analytics_daily` = 0.
      *Hecho:* «up to date» y el conteo, escritos en la bitácora. Si hay drift, se sanea **antes**
      (patrón T8.0 de la 123) y se anota qué se aplicó: esa base la comparten varias sesiones.

---

## T1 — Contratos y fecha objetivo (tras T0)

- [x] **T1.1 [P]** `lib/analytics/rollup-dia.ts`: `fechaObjetivo(now)` pura sobre `fecha-cr.ts`, que
      devuelve **D−1** (D3).
      *Hecho:* con el reloj congelado a las 00:30 CR del día D+1 devuelve `D`; correcto en los cuatro
      bordes (23:59:59 CR, 00:00:00 CR y sus equivalentes UTC); **no importa `startOfDayCR`**.
- [x] **T1.2 [P]** `lib/interfaces/repositories/IAnaliticaRollupRepository.ts`: las seis consultas
      (Q1–Q6 de `design.md §4`) + `escribirFecha`.
      *Hecho:* `pnpm run typecheck` en verde; ningún `any`; el servicio se puede mockear solo con
      esta interfaz.
- [x] **T1.3 [P]** `lib/interfaces/services/IAnaliticaRollupService.ts`: `agregarFecha(fecha)` →
      `ResumenCorrida { fecha, filasEscritas, filasRetiradas, ms }` (R47).
      *Hecho:* `ResumenCorrida` **no contiene `BigInt`** (R32) y `JSON.stringify` de un valor de
      ejemplo no lanza.
- [x] **T1.4 [P]** `lib/config/analitica-rollup.ts`: **la única** constante de aviso de volumen, con
      el comentario que declara que es **provisional y no está medida** (D9/R47).
      *Hecho:* la cifra no aparece en ningún otro archivo; duplicarla pone rojo el guard de constante
      única.

## T2 — Repositorio de agregación (tras T1)

- [x] **T2.1** El **estatus congelado** (D1→A2): `DISTINCT ON (orden_id)` sobre
      `orden_historial_estado` con `created_at < corte` **estricto** y desempate determinista.
      *Hecho:* el caso «la orden se mueve después del corte» conserva el estatus del cierre; cambiar
      `<` por `<=` mete la transición `corte_sin_gestionar` de las 00:00:00 CR del día siguiente y
      pone el test rojo; y con dos transiciones del mismo `created_at`, dos corridas devuelven lo
      mismo.
- [x] **T2.2** Q1 `ordenes_creadas` y Q2 `ordenes_estado_stock` con el universo **B2** (no
      terminales + los que cerraron ese día) y `deleted_at IS NULL` (D7).
      *Hecho:* cada orden aporta **exactamente 1** al stock; la orden entregada hace tres días **no**
      aparece; la que cerró hoy **sí**; la borrada no aparece en ninguna de las dos medidas.
- [x] **T2.3 [P]** Q3, las cinco de gestión: ventana + `anulada_at IS NULL` + orden no borrada; zona
      y tienda de la **orden**, mensajero de la **gestión**, causa solo en `devuelta`.
      *Hecho:* el caso «orden de zona A, mensajero de zona B» devuelve zona A; la gestión anulada y
      la de la orden borrada no aparecen.
- [x] **T2.4 [P]** Q4 `primer_intento_ok` **llamando** a `contarIntentosEnLote` (feature 160), una
      sola consulta para todo el lote.
      *Hecho:* no existe en el archivo ningún `COUNT` propio sobre `orden_historial_estado`; el test
      del N+1 cuenta las llamadas al repo de historial y espera **1**.
- [x] **T2.5 [P]** Q5 tiempo de ciclo: última transición terminal del día, `EXTRACT(EPOCH)` a
      `BIGINT`, una contribución por orden y fecha.
      *Hecho:* orden creada D−5 y entregada D → `n = 1`, `acum` real, **en la fila de D**; el caso
      «entra a terminal, se revierte y vuelve el mismo día» sigue dando `n = 1`.
- [x] **T2.6** Q6: los siete escalares de reconciliación, por un camino **distinto** al de Q1–Q5.
      *Hecho:* coinciden con la suma de los cubos sobre datos sembrados; copiar la consulta de Q1–Q5
      quitándole el `GROUP BY` **no vale** y la revisión lo rechaza (`design.md §4.7`).
- [x] **T2.7** `escribirFecha`: upsert por `analytics_daily_grano_key` + `DELETE` de rancias por
      `updated_at < marcaCorrida`, todo en **una** transacción, **sin lotes** (D9, `design.md §5`).
      *Hecho:* el `ON CONFLICT` nombra la constraint del grano, no una lista de columnas; no hay más
      de un `commit` por corrida.
      ⚠️ **Marcada con desviación declarada (3.1 de `progress/impl_124.md`).** La primera mitad del
      criterio es **inejecutable**: la 123 creó el único del grano con `CREATE UNIQUE INDEX` (hacía
      falta para `NULLS NOT DISTINCT`) y un índice suelto **no tiene fila en `pg_constraint`**, así
      que `ON CONFLICT ON CONSTRAINT "analytics_daily_grano_key"` falla en Postgres. Se usa
      inferencia por la lista de las **seis** columnas del grano, que resuelve al mismo índice y
      arrastra su `NULLS NOT DISTINCT`. Verificado en la base local y por mutación (reducir la lista
      a 4 columnas → escritura roja, 42P10). El resto del criterio —una sola transacción, un solo
      `commit`, sin lotes— se cumple literalmente (`rollup-service.test.ts:1010`). **`design.md §5`
      debe corregirse: acción del leader, no de la implementación.**

## T3 — Servicio de composición (tras T2; el merge se puede escribir contra la interfaz en paralelo)

- [x] **T3.1** `AnaliticaRollupService.agregarFecha`: funde las seis fuentes en cubos por las seis
      coordenadas, con `NULL` significando *sin asignar* / *sin causa* y nunca *ausente*.
      *Hecho:* con dobles en memoria pasan todos los casos borde de `design.md §12` **sin base de
      datos**.
- [x] **T3.2** Invariante local `primer_intento_ok ≤ entregas` antes de escribir, con error propio.
      *Hecho:* el doble que devuelve más pio que entregas produce excepción con fecha y cubo en el
      mensaje, **sin** llegar a la base.
- [x] **T3.3** Reconciliación de R34 dentro de la transacción, con medida y fecha en el error (D5).
      *Hecho:* el doble que inyecta una fila de totalización **aborta**; se verifica contra la base
      que la fecha quedó **sin escribir**.
- [x] **T3.4** Resumen de la corrida y errores con contexto, sin PII (R37/R38/R47).
      *Hecho:* el resumen lleva `filasEscritas`, `filasRetiradas` y `ms`; un `catch` que trague el
      error hace fallar el test que fuerza el fallo del repositorio.

## T4 — Job, enganche y migración (tras T3; D4→C1)

- [x] **T4.1** Migración `<ts>_job_tipo_analitica_rollup_diario`: `ALTER TYPE ... ADD VALUE IF NOT
      EXISTS`, **sola** en su carpeta (55P04), con `down.sql` según el patrón de los cuatro
      `job_tipo_*` previos, y valor nuevo en `enum JobTipo` de `db/schema.prisma`.
      *Hecho:* la carpeta es la **última por nombre** según el criterio exacto de
      `scripts/db-rollback.ts` (reproducido, no `ls | tail`), y el chequeo §6 de `init.sh` la ve con
      su `down.sql`.
- [x] **T4.2** `analitica-rollup-diario-encolado.ts`: `dedupeKey` = `<prefijo>:<fecha objetivo>`.
      *Hecho:* dos siembras del mismo objetivo dejan **una** fila en `jobs`; usar la fecha de la
      corrida en vez de la objetivo deja dos → rojo.
- [x] **T4.3** `analitica-rollup-diario-handler.ts`: handler delgado + `RecurrenciaSpec` a las
      **00:30 CR (06:30 UTC)** del día siguiente (D3).
      *Hecho:* con el reloj congelado, `siguiente(now)` devuelve `06:30 UTC` del día siguiente y el
      `dedupeKey` de la fecha que se agregará.
- [x] **T4.4** Registro en `buildHandlers` y `buildRecurrencias` de
      `app/api/cron/procesar-jobs/route.ts`.
      *Hecho:* `tests/unit/api/procesar-jobs-registro.test.ts` ampliado: el tipo está en **ambos**
      mapas; quitarlo de `buildRecurrencias` pone el test rojo.
- [x] **T4.5 [P]** `scripts/seed-jobs-analitica-rollup-diario.ts` (patrón de la siembra existente).
      *Hecho:* ejecutado contra la base local deja **una** ocurrencia pendiente.
- [x] **T4.6** Invocación manual con tope de antigüedad (R39, contrapartida de R35 estricto): hoy o
      ayer; más antiguo → rechazo que remite a la 125.
      *Hecho:* pedir `hoy − 10 días` devuelve rechazo **y no escribe nada**, comprobado contando
      filas antes y después.

## T5 — Los tres guardias heredados (D6→E1; solo depende de T0, hacerlo TEMPRANO)

- [x] **T5.1** Drift (R40/R41): conjunto de referencia = **unión neta** de las migraciones que tocan
      `analytics_daily`, descubiertas **por contenido**; `toBe(9)` sustituido por la red anti-vacío.
      *Hecho:* **mutación doble observada** — migración de prueba que crea un índice sobre la tabla,
      (a) declarada en el datamodel → **verde**; (b) no declarada → **rojo**. Ambas anotadas con su
      salida literal. Sin (b) el guardia está aflojado y se revierte.
      ⚠️ **El criterio se cumple, pero queda M-2 del acta abierto:** el guardia de drift ya no
      caduca, y sin embargo `analytics-daily-migration.test.ts:218` conserva de la 123 un `toEqual`
      con los **tres** `@@index` literales, así que ante una migración legítima el ARCHIVO sale rojo
      por otra aserción. Es aserción ajena y mide otra cosa; se deja anotada, no se toca.
- [x] **T5.2** Frontera (R42): lista explícita de módulos del escritor; **toda lectura** del rollup
      sigue prohibida fuera de los dos métodos nombrados del job; ningún segundo escritor.
      *Hecho:* mutaciones observadas **en las dos direcciones** — `findMany` en un archivo cualquiera
      → rojo; `upsert` en un archivo fuera de la lista → rojo; escritor legítimo → verde. *Un guardia
      que ya no se pone rojo por nada es peor que uno retirado.*
- [x] **T5.3** Tripwire de suma (R43): la columna debe estar **dentro** de la expresión agregada.
      *Hecho:* las **tres** cadenas malas del archivo siguen rojas y las tres buenas verdes, más dos
      casos nuevos: escritor legítimo → verde, agregación real de la columna sobre un rango dentro de
      un `groupBy` → rojo. Sigue aplicando a los tres estatus terminales pese a D2-B2.
- [x] **T5.4 [P]** Guard de solo-lectura del dominio (R4), de no-literales de coordenada (R26), de
      no-`startOfDayCR` (R6) y de constante única de volumen (R47).
      *Hecho:* sondas con un `UPDATE` sobre `orden`, con un id literal, con `startOfDayCR` y con la
      cifra duplicada → los cuatro rojos observados; sondas retiradas y `git status` limpio
      verificado después.

## T6 — Suite de integración con datos reales (tras T3/T4)

- [x] **T6.1** Utilidad de siembra reutilizable (transacción revertida, patrón de la 123).
      *Hecho:* al terminar cada test, `analytics_daily` y las tablas de dominio quedan con el mismo
      conteo que antes; 0 filas residuales.
- [x] **T6.2 [P]** Calendario: día sin órdenes (0 filas, sin fallar), pareja de medianoche,
      transición del corte a las 00:00:00 CR que **no** entra, fechas vecinas D−1/D+1 intactas (R35).
      *Hecho:* `updated_at` de las filas vecinas es idéntico antes y después de la corrida de D.
- [x] **T6.3 [P]** Coordenadas: orden sin mensajero (cubo `NULL`, no centinela), zona A / mensajero
      de zona B, orden desasignada tras gestionar (dos filas), estatus huérfano, orden borrada (D7).
      *Hecho:* los cinco escriben lo que dicen R22/R23/R25/R45/R13, con su mutación observada.
- [x] **T6.4 [P]** Medidas: dos cambios de estatus el mismo día, orden entregada hace tres días
      fuera del stock (B2), gestión anulada, devolución sin causa, primer intento vs. entrega tras
      devolución, ciclo atribuido al terminal.
      *Hecho:* ídem, con las mutaciones de `requirements.md` observadas.
- [x] **T6.5** Idempotencia y rancias: dos corridas seguidas (R27) y cubo que desaparece entre
      corridas (R29).
      *Hecho:* la segunda corrida deja el mismo conjunto de filas con `created_at` intacto y solo
      `updated_at` avanzado; la fila del cubo desaparecido **ya no está**. Mutación: quitar el
      `DELETE` de rancias → la fila vieja sobrevive → rojo.
- [x] **T6.6** Atomicidad (R30): fallo forzado a mitad de la escritura.
      *Hecho:* la fecha queda **exactamente** como estaba; 0 filas parciales.
- [x] **T6.7** Los tres `CHECK` de la 123 se ejercen de verdad: pio > entregas, `n = 0` con
      `acum > 0`, medida negativa.
      *Hecho:* los tres rechazos con su **nombre de constraint capturado del error de Postgres**, no
      inferido.
- [x] **T6.8** **R49 — caracterización de la reproducibilidad parcial** (D1→A2 + D7): (a) recomputar
      tras un cambio de estatus da el **mismo** `estatus_id`; (b) recomputar tras reasignar mensajero
      / cambiar zona / cambiar tienda da las coordenadas **nuevas**; (c) recomputar tras borrar la
      orden retira sus contribuciones.
      *Hecho:* los tres escritos como aserciones explícitas, con un comentario que dice que fijan la
      **rebaja acordada de R35 de la 123** y que moverlos exige reabrir D1. Mutación: congelar
      `mensajero_id` → (b) rojo; dejar de congelar `estatus_id` → (a) rojo.

## T7 — Trazabilidad y deuda heredada (tras T6)

- [x] **T7.1** Mapa `R<n> → test` de las **49** de esta feature en `progress/impl_124.md`, con la
      partición honesta **medido / nominal** (patrón §2.1 de `impl_123.md`).
      *Hecho:* ningún `R` sin test; los nominales, si los hay, nombrados y justificados.
- [x] **T7.2** Cierre de la deuda de la 123 (R44), **con la cuenta explícita y visible de un
      vistazo**: tabla de los **once** requisitos que pasan a medidos (R11, R12, R13, R24, R28, R31,
      R32, R33, R34, R35, R36) con el test de esta feature que mide cada uno, y **R15 declarado
      texto** con su razón (no es falsable desde aquí: es una propiedad del despliegue). Encabezado
      literal: **«11 medidos, 1 texto»**.
      *Hecho:* ninguna de las once filas apunta a un test de regex sobre SQL. La fila de **R33**
      (`estatus_id` al corte) dice además que se mide **porque D1 cerró en A2**; la de **R31/R32**
      (zona/tienda/mensajero) remite a **R49b** para el alcance exacto de lo que NO se reproduce.
- [x] **T7.3** Avisos dirigidos (`design.md §13`) propuestos al leader para el `status_note` de cada
      ficha: **125** (reproducibilidad parcial + prohibición de que el diario recompute pasado),
      **128** (la invalidación del pasado **sí** existe si la 125 recomputa), **126** (embudo B2 =
      «órdenes vivas por estado» + el día en curso sin rollup), **135** (divergencia de contrato con
      `ordenes_por_estado.definicion.estados`).
      *Hecho:* los cuatro escritos en `design.md §13` y entregados al leader; el de la 135 marcado
      como **discrepancia de contrato**, no como detalle de implementación.

## T8 — Verificación final

- [x] **T8.1** Medición final contra el baseline de T0.4: typecheck, lint, suite completa **no
      degradada**.
      *Hecho:* **delta 0** en lint y typecheck; los rojos finales son subconjunto de los del
      baseline, comprobando aislado cualquier caída de `tests/components/` o de formularios antes de
      contarla como regresión (flakes por saturación conocidos).
- [x] **T8.2** Round-trip de la migración del enum contra la base local: `migrate deploy` →
      `db:rollback` → `migrate deploy`, verificando **antes del DOWN** que la carpeta de esta feature
      sigue siendo la última por nombre.
      *Hecho:* evidencia medida en `progress/roundtrip_124_job_tipo.md`, con el host confirmado y la
      fila de `_prisma_migrations` observada en cada paso.
- [x] **T8.3** Primera corrida real contra la base local con datos sembrados: **medición de volumen**
      (filas escritas, retiradas, ms) que la 125 necesita (D9/R47).
      *Hecho:* los tres números en `progress/impl_124.md`, señalados como **el primer dato de volumen
      que existe en el repo** — hasta ahora no había ninguno.
- [x] **T8.4** `./init.sh`.
      *Hecho:* termina en verde, o su rojo está **nombrado y demostrado heredado de `dev`** (hoy: 3
      errores de lint en `OrdenesModule.tsx`). Si aborta antes del §6, el chequeo de `down.sql` se
      reproduce a mano.
      ⚠️ **Procedencia de la evidencia, dicha con precisión:** la bitácora del implementer (§8.4)
      registra typecheck / lint / suite pero **no** una corrida de `./init.sh`. La corrida existe y
      está medida **dos veces por terceros**: el reviewer (`progress/review_124.md §0`: typecheck 0,
      lint 0 errores / 18 warnings con delta 0, suite 732 archivos / 8967 tests) y el cierre de los
      bloqueantes del 2026-08-01 (typecheck **0 errores**; suite **732 archivos, 8967 tests**,
      `1 failed | 8966 passed`). `init.sh` aborta en el §5 por el **único** rojo, que es
      `tests/components/descarga/WalletPropsDescarga.test.tsx` —timeout de 20 s, **heredado de
      `dev`** y ya nombrado en el baseline de §0—, así que el chequeo del §6 se reprodujo a mano
      como el propio criterio prevé: **106 carpetas en `db/migrations/`, ninguna sin `down.sql`**.
- [x] **T8.5** Bitácora `progress/impl_124.md` completa: archivos, mapa de trazabilidad, tabla de
      **mutaciones observadas** (una fila por cada una, con su salida real), baseline vs. final,
      deudas vivas y estado de la base local al cerrar.
      *Hecho:* un tercero puede reproducir cada afirmación sin preguntar nada.

---

## Dependencias

```
T0 ──▶ T1 ──▶ T2 ──▶ T3 ──▶ T4 ──▶ T6 ──▶ T7 ──▶ T8
        │              ▲
        └──▶ T5 ───────┘        (T5 solo necesita T0: hacerlo TEMPRANO)
```

- **T5 no depende de T2/T3.** Hasta que los tres guardias estén re-alcanzados, la suite estará roja
  **por construcción** en cuanto exista el primer archivo que nombre la tabla, y eso contamina
  cualquier medición intermedia. Se hace primero.
- **T2.1 (estatus congelado) es prerrequisito de T2.2 y T2.3**: las tres consultas usan la misma
  coordenada.
- **T6 depende de T4** solo para el camino del handler; los casos de datos pueden escribirse contra
  el servicio en cuanto exista T3.
- **T7.2 depende de T6**: no se declara «medido» un requisito de la 123 hasta que el test que lo mide
  exista **y se haya visto rojo al mutarlo**.
