# 128 — analitica: cache + invalidacion por tag · tasks

Convenciones: `[P]` = paralelizable con las tareas de su mismo bloque. Cada task lleva su
**criterio de hecho**. Ningun subagente corre la suite completa (`AGENTS.md > Regla del gate`):
`pnpm typecheck`, `pnpm lint` y `pnpm exec vitest related --run <archivos>`; el gate lo corre el
leader.

**Puerta T0: CERRADA** (humano, 2026-08-03). D1 = `unstable_cache({ tags })` + `revalidateTag`
**sin tocar `next.config.ts`**; D2 = financiera **no** se cachea, con guardia que sobrevive al
merge; D3 = **un tag por dominio**; D4 = **TTL 3600 s** en una sola constante, con censo **por
ambito** (el literal ya existe 4 veces en `lib/` por motivos ajenos); D5 = **variable de entorno,
encendida por defecto**. Razonamiento y propagacion en `requirements.md > T0`. **No queda nada que
preguntar: se puede implementar.**

---

## Bloque 0 — Baseline (bloquea todo)

- [x] **T0.1** Medir el baseline en la rama **antes de tocar nada**: `pnpm typecheck`, `pnpm lint`,
      `pnpm test`. Anotar numeros exactos en `progress/impl_128-*.md`.
      **Hecho:** los tres numeros escritos, con fecha. Nunca se cita el baseline de la bitacora.

## Bloque 1 — Piezas puras (sin Next, sin Prisma) · dependen de T0.1

- [x] **T1.1 [P]** `lib/analytics/cache-tags.ts`: **un tag por dominio** (D3), derivado de
      `tagDeDominio()` (R20). `lib/analytics/metrics.ts` NO se toca.
      **Hecho:** `tests/unit/analytics/cache-tags.test.ts` verde y
      `tests/unit/analytics/cache-tags.guardia.test.ts` verde (guardia **que sobrevive al merge**:
      ningun archivo escribe el literal `"analitica:operativa"` / `"analitica:financiera"`).
- [x] **T1.2 [P]** `lib/analytics/cache-clave.ts` — `claveDeConsulta` (R5/R6/R7/R8).
      **Hecho:** `tests/unit/analytics/cache-clave.test.ts` verde con los cuatro casos:
      preset en dos dias distintos NO comparte; `[a,b]`/`[b,a]` SI comparten; `[a]`/`[a,b]` NO;
      con/sin desagregacion NO.
- [x] **T1.3 [P]** Codec de cubos en el mismo archivo (R9). **Sin el, la escritura LANZA**:
      `unstable_cache` serializa con `JSON.stringify` (`unstable-cache.js:23`) y `segCicloAcum` es
      `bigint` (`IAnaliticaOperativaRollupRepository.ts:64`).
      **Hecho:** `tests/unit/analytics/cache-codec.test.ts` verde: round-trip con `segCicloAcum`
      `bigint`, `mensajeroId: null` y `causaDevolucion: null`; mas el caso que demuestra que el cubo
      **sin codec** hace lanzar `TypeError` a `JSON.stringify`. **Mutacion verificada:** quitar el
      codec del decorador → la consulta falla → rojo.
- [x] **T1.4 [P]** `lib/interfaces/external/IAnaliticaCache.ts` + `lib/cache/cache-nula.ts`.
      **Hecho:** `pnpm typecheck` verde; la interfaz no importa Next ni Prisma.

## Bloque 2 — Adaptador de Next (D1 = (a)) · depende de T1.4

- [x] **T2.1** `lib/cache/next-analitica-cache.ts`: `unstable_cache({ tags, revalidate })` +
      `revalidateTag`, sin logica ni ramas (R11: `invalidar` propaga el error). **`next.config.ts`
      NO se toca** y **no se usa `cacheTag()`**: lanza sin `cacheComponents` (D1).
      **Hecho:** `pnpm typecheck` verde, el archivo tiene ≤ 40 lineas de codigo efectivo y
      `git diff --stat` no incluye `next.config.ts`.
- [x] **T2.2** Guardia de aislamiento `tests/unit/analytics/cache-aislamiento.guardia.test.ts` (R21).
      **Hecho:** verde; y **verificada la mutacion**: anadir `import "next/cache"` a
      `lib/services/AnaliticaOperativaService.ts` lo pone rojo (se comprueba y se revierte).

## Bloque 3 — El decorador · depende de T1.2, T1.3, T1.4

- [x] **T3.1** `lib/repositories/CachedAnaliticaOperativaRollupRepository.ts`: intercepta
      `agregarCubos`, delega `etiquetasDeEstatus` (R2/R4/R22).
      **Hecho:** `tests/unit/analytics/cache-decorador.test.ts` verde: hit no re-consulta;
      `etiquetasDeEstatus` se delega siempre; el archivo no importa Prisma.
- [x] **T3.2** Aislamiento entre alcances (R6) — **seguridad, no rendimiento**. Dos piezas:
      (a) `tests/unit/analytics/cache-alcance.test.ts` con repositorio interno que devuelve filas
      distintas por `alcance.tipo`; (b) guardia **que sobrevive al merge**
      `tests/unit/analytics/cache-clave-alcance.guardia.test.ts`: la clave cubre las **cuatro**
      variantes de `AlcanceDatos` (`lib/analytics/alcance.ts:65-69`).
      **Hecho:** los dos verdes y **mutaciones verificadas**: quitar `alcance` de la clave pone rojo
      (a) con un mensaje que dice «fuga entre roles»; contemplar solo `zona`/`tienda` pone rojo (b).
- [x] **T3.3** Test de equivalencia con/sin cache (R1).
      **Hecho:** `tests/unit/analytics/cache-equivalencia.test.ts` verde comparando la serie campo a
      campo, incluido `tiempo_ciclo` (el que cae si el `bigint` no se rehidrata).

## Bloque 4 — Cableado en el borde operativo · depende de Bloque 3

- [x] **T4.1** `lib/config/analitica-cache.ts`: bandera por **variable de entorno, encendida por
      defecto** (R16, D5; patron `lib/config/etiquetas.ts:7-12`) y **la unica** constante de TTL =
      **3600** (R17, D4) con el comentario «provisional y no medida».
      **Hecho:** `tests/unit/analytics/cache-config.test.ts` verde (incluido «sin la variable
      definida, la cache esta habilitada») y `cache-config.guardia.test.ts` verde.
      ⚠ **El censo del literal es POR AMBITO** (archivos de la feature + `lib/analytics/` +
      `lib/cache/`), NUNCA global: `3600` ya existe en `lib/auth/google-sa-token.ts:42`,
      `lib/auth/google-adc-token.ts:28` y `lib/config/etiquetas.ts:52,69`. Un censo global naceria
      rojo por literales ajenos (leccion de la 125). Si algun dia se ampliara, con allowlist contada
      por ruta, patron de `tests/unit/analytics/rollup-guards.test.ts:681`.
- [x] **T4.2** Modificar **solo** `construirServicio` en `lib/actions/analitica-operativa.ts`:
      envolver el repositorio de rollup; **no** envolver el vivo (R3).
      **Hecho:** `tests/unit/analytics/analitica-operativa-action.test.ts` sigue verde sin tocarlo, y
      `pnpm exec vitest related --run lib/actions/analitica-operativa.ts` verde.
- [x] **T4.3** Test del dia en curso (R3).
      **Hecho:** `tests/unit/analytics/cache-dia-en-curso.test.ts` verde y **mutacion verificada**:
      decorar tambien el repositorio vivo lo pone rojo.

## Bloque 5 — Invalidador 1: el job diario · depende de T2.1, T4.1

- [x] **T5.1** Anadir el puerto `IAnaliticaCache` al handler
      `lib/services/jobs/analitica-rollup-diario-handler.ts` e invalidar **despues** de que
      `agregarFecha` resuelva (R10/R11). No se toca `AnaliticaRollupService`.
      **Hecho:** `tests/unit/services/analitica-rollup-handler.test.ts` sigue verde sin cambios de
      expectativa (solo el cableado del nuevo parametro con default).
- [x] **T5.2** Test de cinco pasos (R10) + test de propagacion de error (R11) + registro (R23).
      **Hecho:** `tests/unit/analytics/cache-invalidacion-job.test.ts` y `cache-registro.test.ts`
      verdes, y **las dos mutaciones verificadas**: borrar la invalidacion y cambiar el tag por el de
      financiera ponen rojo el paso 5.

## Bloque 6 — Invalidador 2: el backfill · depende de T5.1

- [x] **T6.1** Migracion `db/migrations/<ts>_job_tipo_analitica_invalidacion_cache/` (R24): `ALTER
      TYPE` sola en su carpeta + `down.sql` calcado del patron de la 124 (con el `DELETE FROM "jobs"`
      previo y los 7 valores en orden).
      **Hecho:** `tests/integration/db/job-tipo-analitica-invalidacion-migration.test.ts` verde.
      ⚠ **No se aplica ninguna migracion desde el worktree**: la base local la comparten varias
      sesiones. La aplicacion/rollback la decide el leader.
- [x] **T6.2 [P]** `lib/services/jobs/analitica-invalidacion-encolado.ts` (dedupeKey, modulo puro).
      **Hecho:** test de la clave verde; el modulo no importa Prisma ni Next.
- [x] **T6.3** `lib/services/jobs/analitica-invalidacion-cache-handler.ts` + registro en
      `buildHandlers` de `app/api/cron/procesar-jobs/route.ts`, **y no** en `buildRecurrencias`.
      **Hecho:** el test de registro de tipos verde y el de recurrencias **sin** el tipo nuevo.
- [x] **T6.4** Encolado desde `scripts/backfill-analitica.ts` solo cuando la corrida **escribio**
      (R12/R13), entrando por `EntornoCli`.
      **Hecho:** `tests/unit/scripts/backfill-analitica-invalidacion.test.ts` verde con los tres
      casos (escritura → 1 encolado; con fallidas y alguna procesada → 1; plan sin `--confirmar` →
      0), y `tests/unit/scripts/backfill-analitica-cli.test.ts` existente sigue verde.
- [x] **T6.5** Test de cinco pasos del camino completo backfill → job → consulta (R14).
      **Hecho:** `tests/unit/analytics/cache-invalidacion-backfill.test.ts` verde y **mutacion
      verificada**: quitar el registro del handler pone rojo el paso 5.

## Bloque 7 — Financiera: la puerta cerrada (D2 = (a)) · depende de T1.1

- [x] **T7.1** Guardia `tests/unit/analytics/cache-financiera.guardia.test.ts` (R15). **Sobrevive al
      merge**: censa contenido, no diff. Su cabecera enumera los escritores de ledger
      (`WalletEgresoService`, `LiquidacionService`, `GeneracionGastosFijosService`, indemnizaciones
      de incidentes, aprobacion de cierres) y dice que engancharlos es **otra feature**
      (`design.md §14`), no un apendice de esta.
      **Hecho:** verde y **mutacion verificada**: envolver `AnaliticaFinancieraService` o cualquiera
      de sus cuatro repositorios lo pone rojo, con un mensaje que enumera esos escritores.
- [x] **T7.2** Pedir al leader el alta de la ficha propuesta en `design.md §14`
      («analitica: cache financiera + invalidacion por ledger», backend, `depends_on: 128`).
      **Hecho:** el leader confirma el alta. **La 128 NO la implementa.**

## Bloque 8 — Frontera y cierre · depende de todo lo anterior

- [x] **T8.1** Guardia branch-scoped `tests/unit/analytics/cache-frontera.guardia.test.ts` (R18/R19),
      con la cabecera de caducidad de `design.md §1` escrita literalmente. **NO cuelga de el ningun
      guardia que deba sobrevivir**: los cuatro de contenido viven en sus propios archivos (T1.1,
      T2.2, T3.2, T7.1), precisamente porque este se retira en T8.5.
      **Hecho:** verde; **mutacion verificada** tocando `lib/analytics/metrics.ts` (se comprueba y se
      revierte).
- [x] **T8.2** Verificar que `tests/integration/db/analytics-daily-guards.test.ts` (R42 de la 124)
      **sigue verde sin modificarlo** (R22).
      **Hecho:** corrida del archivo pegada en `progress/impl_128-*.md`.
- [x] **T8.3** Mapa `R1..R24 → test` completo en `progress/impl_128-analitica-cache-invalidacion.md`,
      con la mutacion de cada uno marcada como **verificada** o **razonada**.
      **Hecho:** los 24 requisitos con al menos un test nombrado; ninguno sin mutacion comprobada.
- [x] **T8.4** `./init.sh` completo (lo corre el **leader**, no el implementer) y **delta 0** contra
      el baseline de T0.1.
      **Hecho:** delta 0 escrito con los dos numeros (baseline y final), antes del PR.
- [x] **T8.5** Retirar el guardia branch-scoped de T8.1 en el **mismo PR**, conservando los **cuatro**
      guardias de contenido (`design.md §1`: aislamiento, financiera, clave-alcance y tags).
      **Hecho:** el archivo eliminado, los cuatro restantes verdes, y la razon anotada en el mensaje
      del commit.
