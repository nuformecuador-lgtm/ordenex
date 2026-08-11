# Feature 196 - Snapshot diario del ranking de mensajeros - bitacora de implementacion

Rama: `ux` (la actual; no se creo rama ni worktree). Spec aprobado por el humano el 2026-08-10.
Coordinacion: implementer sobre 4 `backend_dev` + 1 `frontend_dev`, en el orden de tandas de
`specs/196-snapshot-ranking-diario/tasks.md`.

**Sin commit y sin migracion aplicada** (ambas cosas quedan en manos del humano; ver seccion 5).

---

## 1. Archivos

### Creados

**Tanda 0 - criterio unico (reuso real, no copia)**
- `lib/ranking/orden-ranking.ts`
- `lib/ranking/snapshot-dia.ts`
- `tests/unit/ranking/orden-ranking.test.ts`
- `tests/unit/ranking/snapshot-dia.test.ts`

**Tanda 1 - persistencia**
- `db/migrations/20260811120000_ranking_snapshot/migration.sql`
- `db/migrations/20260811120000_ranking_snapshot/down.sql`
- `tests/integration/db/ranking-snapshot-migration.test.ts`

**Tanda 2 - repositorio y servicio**
- `lib/interfaces/repositories/IRankingSnapshotRepository.ts`
- `lib/repositories/RankingSnapshotRepository.ts`
- `lib/interfaces/services/IRankingSnapshotService.ts`
- `lib/services/RankingSnapshotService.ts`
- `lib/types/ranking-snapshot.ts`
- `tests/unit/repositories/ranking-snapshot-repository.test.ts`
- `tests/unit/services/ranking-snapshot-service.test.ts`

**Tanda 3 - cron**
- `app/api/cron/snapshot-ranking/route.ts`
- `tests/integration/actions/snapshot-ranking-route.test.ts`
- `tests/unit/guards/ranking-snapshot-cron.guardia.test.ts`

**Tanda 4 - lectura y UI**
- `lib/actions/ranking-historico.ts`
- `app/(app)/ranking/historico/page.tsx`
- `app/(app)/ranking/historico/_components/RankingHistoricoModule.tsx`
- `app/(app)/ranking/historico/_components/ranking-historico-labels.ts`
- `tests/unit/actions/ranking-historico-actions.test.ts`
- `tests/components/RankingHistoricoPage.test.tsx`
- `tests/components/RankingHistoricoModule.test.tsx`

**Tanda 5 - descarga**
- `app/(app)/ranking/historico/_components/ranking-historico-descarga-columnas.ts`
- `tests/components/descarga/RankingHistoricoDescarga.test.tsx`
- `tests/unit/descarga/ranking-historico-descarga-columnas.test.ts`

### Modificados
- `db/schema.prisma` - modelos `RankingSnapshotDia` / `RankingSnapshotFila` + relacion inversa en `Usuario`. Aditivo.
- `lib/services/RankingService.ts` - consume el modulo puro. Sin cambio de comportamiento observable (R36).
- `lib/auth/menu-visibility.ts` - subitems bajo "Ranking", patron Wallet (el primer subitem es `/ranking`, porque un item con `children` deja de navegar).
- `app/(app)/ranking/page.tsx` - SOLO el enlace al historico.
- `tests/unit/guards/ranking-ventana-dia.guardia.test.ts` - censo de migraciones del modulo ranking (ver 4.1).
- `tests/components/Sidebar.test.tsx`, `tests/components/AppLayout.test.tsx` - "Ranking" pasa de enlace a desplegable.
- `tests/unit/descarga/censo-tablas.ts`, `tests/unit/descarga/cobertura-tablas.guardia.test.ts` - alta de la DataTable nueva.

`tests/unit/services/ranking-service.test.ts` NO se toco: ni un assert. Es la prueba de R36.

---

## 2. Mapa R<n> -> test (los 38, ninguno huerfano)

| R | Test |
| --- | --- |
| R1 | `tests/integration/db/ranking-snapshot-migration.test.ts` + `tests/unit/services/ranking-snapshot-service.test.ts` |
| R2 | `tests/unit/ranking/snapshot-dia.test.ts` + `tests/unit/services/ranking-snapshot-service.test.ts` |
| R3 | `tests/unit/services/ranking-snapshot-service.test.ts` (orden e ids fila a fila == `RankingService.obtenerRanking`) |
| R4 | `tests/unit/ranking/orden-ranking.test.ts` (empate total -> desempate por id; estable ante entrada invertida) |
| R5 | `tests/unit/services/ranking-snapshot-service.test.ts` (0/0 no produce fila; 3/0 y 0/6 si) |
| R6 | `tests/unit/services/ranking-snapshot-service.test.ts` + `tests/integration/db/ranking-snapshot-migration.test.ts` |
| R7 | `tests/unit/services/ranking-snapshot-service.test.ts` (podio congela monto y descripcion vigentes) |
| R8 | `tests/integration/db/ranking-snapshot-migration.test.ts` (el CHECK rechaza premio sin posicion) |
| R9 | `tests/unit/ranking/orden-ranking.test.ts` + `tests/unit/services/ranking-snapshot-service.test.ts` |
| R10 | `tests/unit/ranking/orden-ranking.test.ts` (`formatearPct`) + migracion (no existe columna de pct) |
| R11 | `tests/unit/services/ranking-snapshot-service.test.ts` (cabecera con filas = 0, sin createMany) |
| R12 | `tests/unit/repositories/ranking-snapshot-repository.test.ts` (P2002 -> creado:false) + service (omitido) |
| R13 | `tests/integration/db/ranking-snapshot-migration.test.ts` (los 4 UNIQUE rechazan su duplicado) |
| R14 | `tests/unit/repositories/ranking-snapshot-repository.test.ts` (fallo en createMany deja la fecha sin cabecera) |
| R15 | `tests/unit/guards/ranking-snapshot-cron.guardia.test.ts` (congelar.length === 1; la ruta no lee searchParams) |
| R16 | `tests/unit/services/ranking-snapshot-service.test.ts` (renombrado posterior -> nombre congelado) |
| R17 | `tests/integration/db/ranking-snapshot-migration.test.ts` (DELETE del usuario con filas -> RESTRICT) |
| R18 | `tests/integration/db/ranking-snapshot-migration.test.ts` (censo: solo las 2 tablas nuevas) |
| R19 | `tests/integration/actions/snapshot-ranking-route.test.ts` (5 casos de 401; el service no se construye) |
| R20 | `tests/integration/actions/snapshot-ranking-route.test.ts` (claves fecha/estado/filas exactas, sin PII) |
| R21 | `tests/integration/actions/snapshot-ranking-route.test.ts` (cuerpo y logError sin el secreto) |
| R22 | `tests/integration/actions/snapshot-ranking-route.test.ts` (service que lanza -> error + logError) |
| R23 | `tests/unit/guards/ranking-snapshot-cron.guardia.test.ts` (vercel.json, schedule distinto al de corte-diario) |
| R24 | `tests/components/RankingHistoricoModule.test.tsx` (instante de generacion visible) |
| R25 | `tests/unit/repositories/ranking-snapshot-repository.test.ts` (orderBy puesto asc) + service + `RankingHistoricoModule.test.tsx` |
| R26 | `tests/components/RankingHistoricoPage.test.tsx` (mensajes distintos) + service (sin_snapshot vs ok con filas vacias) |
| R27 | `tests/components/RankingHistoricoPage.test.tsx` + `tests/unit/services/ranking-snapshot-service.test.ts` |
| R28 | `tests/components/RankingHistoricoPage.test.tsx` (mensajero ve todas las filas) + service |
| R29 | `tests/unit/guards/ranking-snapshot-cron.guardia.test.ts` (unico escritor: RankingSnapshotRepository) |
| R30 | `tests/unit/actions/ranking-historico-actions.test.ts` (2026-02-31, "ayer", "", no-strings; service no invocado) |
| R31 | `tests/unit/actions/ranking-historico-actions.test.ts` + `tests/unit/repositories/ranking-snapshot-repository.test.ts` |
| R32 | `tests/components/descarga/RankingHistoricoDescarga.test.tsx` (mismas filas y mismo orden que la tabla) |
| R33 | `tests/components/descarga/RankingHistoricoDescarga.test.tsx` (sobre el tope: sin archivo, mensaje con total y tope) |
| R34 | `tests/unit/descarga/ranking-historico-descarga-columnas.test.ts` (no se proyecta mensajeroId) |
| R35 | `tests/unit/descarga/ranking-historico-descarga-columnas.test.ts` (ranking-del-dia-2026-08-09-<hoy>.xlsx) |
| R36 | `tests/unit/services/ranking-service.test.ts` (EXISTENTE, sin editar un solo assert) |
| R37 | `tests/integration/db/ranking-snapshot-migration.test.ts` (aplicar el down.sql deja el esquema previo) |
| R38 | `tests/integration/db/ranking-snapshot-migration.test.ts` (pg_class.relrowsecurity = true en ambas) |

---

## 3. Salida REAL de la verificacion

### 3.1 Los 14 archivos de test de la feature

Comando: `pnpm exec vitest run` sobre tests/unit/ranking, ranking-service.test.ts,
ranking-snapshot-service.test.ts, ranking-snapshot-repository.test.ts,
ranking-historico-actions.test.ts, ranking-snapshot-cron.guardia.test.ts,
ranking-ventana-dia.guardia.test.ts, ranking-historico-descarga-columnas.test.ts,
snapshot-ranking-route.test.ts, ranking-snapshot-migration.test.ts,
RankingHistoricoPage.test.tsx, RankingHistoricoModule.test.tsx, RankingHistoricoDescarga.test.tsx

```
 Test Files  14 passed (14)
      Tests  220 passed (220)
   Duration  8.41s
```

### 3.2 Gate `./init.sh --rapido` - VERDE

```
[OK] lint paso
  57 problems (0 errors, 57 warnings)   <- las 57 son preexistentes, ninguna en archivos de la 196

-> pnpm run test:rapido
> vitest run --changed origin/dev --passWithNoTests
 Test Files  93 passed (93)
      Tests  1283 passed (1283)
   Duration  147.50s

> vitest run guard
 Test Files  84 passed (84)
      Tests  1121 passed (1121)
   Duration  16.48s

[OK] test:rapido paso
[OK] todas las migraciones tienen down.sql
[OK] .env presente
== init OK ==
```

`pnpm run typecheck` -> `tsc --noEmit` sin salida (0 errores).

**Cero rojos.** No hubo que descartar ningun flake: ni `no-embalaje` ni `TableroOperativo`
aparecieron en rojo en esta corrida.

---

## 4. Decisiones y desviaciones del design (con motivo)

### 4.1 Guardias ajenas que la migracion nueva puso en rojo (ya cerradas)

- `tests/unit/guards/ranking-ventana-dia.guardia.test.ts` afirmaba que la unica migracion del
  modulo ranking era `20260716130000_premio_ranking`. La 196 anade una legitimamente. El guard se
  actualizo REFORZANDOLO, no aflojandolo: ademas del censo se exige ahora que el DDL de la
  migracion nueva no nombre `premio_ranking`, que no haya DROP y que todo CREATE/ALTER TABLE sea
  sobre las dos tablas nuevas. Las aserciones sobre PremioRanking y sobre la ventana CR quedan
  intactas.
- `tests/unit/tablero-dia/asignado-at-solo-lectura.guardia.test.ts` censa migraciones que MENCIONAN
  `asignado_at`; el migration.sql lo citaba en tres COMMENT ON. Se reescribieron los comentarios
  ("la fecha de asignacion de la orden") y EL GUARD QUEDO SIN TOCAR: la migracion no toca la
  columna, solo la citaba.
- `tests/unit/guards/superficie-de-uso.guardia.test.ts` estuvo rojo entre tandas (Server Action sin
  superficie alcanzable) y se apago SOLO al aterrizar page.tsx, que es lo que debia pasar. No se
  silencio con la anotacion @sin-superficie.

### 4.2 Desviaciones del design

1. `asignarPodio` devuelve `{agregado, puesto, posicion}[]` en vez de solo posiciones: R6 exige
   congelar el puesto, y calcularlo aparte abriria un segundo sitio donde el orden puede
   desincronizarse. El vivo ignora `puesto`.
2. El `puesto` se renumera 1..N tras filtrar las filas sin actividad. El servicio ordena y asigna
   podio sobre el universo COMPLETO del vivo (asi se demuestra R3) y filtra despues. Conservar el
   puesto del vivo dejaria un "puesto 7" en una tabla de 3 filas y rompería el filas = N de la
   cabecera.
3. `crearSnapshot` hace un findUnique extra al chocar el P2002, para que el `filas` del 200
   "omitido" sea el conteo REALMENTE congelado y no una cifra inventada. Es una lectura: no altera
   nada (R12).
4. Solo se traga el P2002 de `fecha`. Los otros tres UNIQUE de la feature tambien emiten P2002 y
   esos si son defectos: se propagan.
5. El UNIQUE parcial (snapshot_id, posicion) WHERE posicion IS NOT NULL va a mano en el SQL y no se
   declara en schema.prisma: declararlo como @@unique crearia un indice TOTAL distinto del real,
   que es peor drift que el huerfano. Es el patron ya establecido del repo
   (wallet_movimiento_origen_categoria_uq).
6. `?fecha` malformado -> notFound() (el design no lo fijaba). Caer a D-1 en silencio ensenaria los
   datos de una fecha distinta de la pedida.
7. "sin_snapshot" no monta tabla ni control de descarga; filas vacias si. Sin cabecera no hay
   dataset: un archivo vacio afirmaria un dia sin actividad que nadie midio.
8. `premioDescripcion` no viaja al archivo: design 7 declara UNA columna Premio y la magnitud
   auditable es el monto. La descripcion si se ve en la celda de la tabla.
9. `pnpm run db:migrate:create` NO se ejecuto: es `prisma migrate dev --create-only`, que APLICA las
   migraciones pendientes a la base antes de crear el archivo, y eso estaba prohibido. El DDL se
   genero con `prisma migrate diff --from-schema <schema previo> --to-schema db/schema.prisma
   --script`, SIN conexion a ninguna base; los CHECK, el indice parcial, los COMMENT ON y la RLS van
   detras a mano porque Prisma no los expresa.

---

## 5. Pendiente para el humano

1. La migracion `20260811120000_ranking_snapshot` NO se aplico a ninguna base. Verificado: no hay
   fila en `_prisma_migrations`, no existen las tablas en `public`, no quedo esquema temporal ni
   usuario de prueba. El test de integracion corre el migration.sql real dentro de un esquema
   temporal en una transaccion siempre revertida, asi que demuestra las restricciones sin residuo.
2. Sin commit, por indicacion expresa.
3. Antes del PR: `./init.sh` COMPLETO, sin flags. Aqui solo se corrio `--rapido`.
4. Bookkeeping (T6.3) sin hacer: feature_list.json (196 -> done) y progress/current.md quedan para
   el leader, para no arrastrar altas ajenas en el diff.

---

## 6. Cierre de los dos huecos del reviewer (post-revision)

El reviewer aprobo CON RESERVAS (cero bloqueantes) y dejo dos huecos de TEST. Ambos cerrados.
Produccion: CERO archivos modificados en este pase.

### 6.1 Hueco 1 (el que importaba) - R12 sin prueba end-to-end de dos corridas

El eslabon sin medir era: "el P2002 que Postgres emite DE VERDAD es el que `esColisionDeFecha`
reconoce". Se probaba con un error FABRICADO A MANO en el test unitario del repositorio.

Anadido un BLOQUE C (6 casos) a `tests/integration/db/ranking-snapshot-migration.test.ts`, que
ejercita la API PUBLICA del repositorio contra Postgres real:
1. corrida 1: `crearSnapshot(fecha, 2 filas)` -> `{creado:true, filas:2}`
2. captura del P2002 CRUDO por la API de modelo y asercion sobre `textoConstraintP2002`
3. corrida 2: MISMA fecha, `filas` distinto (1 fila) y umbral distinto (99) -> `{creado:false, filas:2}`
   (el 2 demuestra a la vez que se traga el P2002 real y que el conteo reportado es el
   REALMENTE congelado, no el que se habria escrito)
4. la cabecera conserva id, generado_at, min_asignadas_podio = 5 y filas = 2 (leido con SQL crudo,
   no por el repo bajo prueba)
5. las 2 filas originales intactas
6. bonus R14 real: dos filas del mismo puesto -> el P2002 de `..._snapshot_id_puesto_key` SE
   PROPAGA (no se confunde con reejecucion) y la fecha queda SIN cabecera

Helper nuevo `crearPrismaDeTestEnEsquema(esquema)` en `tests/integration/db/_postgres-real.ts`.
En `tests/unit/repositories/ranking-snapshot-repository.test.ts` solo se anadio un comentario de
cabecera que declara su limite y remite al bloque C.

**EL DATO QUE NADIE HABIA MEDIDO.** Texto real que emite Postgres atravesando `@prisma/adapter-pg`:

```
code: P2002
meta.target: AUSENTE (undefined)
meta.driverAdapterError.cause.originalCode:    "23505"
meta.driverAdapterError.cause.originalMessage: "llave duplicada viola restriccion de unicidad
                                                <<ranking_snapshot_dia_fecha_key>>"
meta.driverAdapterError.cause.kind:            "UniqueConstraintViolation"
message de Prisma:                             "Unique constraint failed on the (not available)"
```

SI casa con lo que el codigo espera: `esColisionDeFecha` encuentra "fecha" dentro de
`ranking_snapshot_dia_fecha_key`. **No aparecio ningun bug de produccion.** Pero el hallazgo tiene
valor propio: `meta.target` viene VACIO y el `message` de Prisma dice literalmente
`(not available)`, o sea que la UNICA pista viable es el `originalMessage` del adapter. Un handler
que leyera `meta.target` -que es el patron "obvio"- daria 500 en la reejecucion del cron.

Prueba de mutacion para descartar verde-por-vacio: sustituir `texto.includes("fecha")` por
`texto.includes("MUTANTE_TEMPORAL")` pone el bloque C ROJO, con el P2002 escapando desde
`RankingSnapshotRepository.ts:52` (es decir, reproduce el 500 de produccion que se temia).
Revertido acto seguido; `grep MUTANTE_TEMPORAL lib/ tests/` vacio.

Obstaculo tecnico, resuelto y por un motivo distinto del previsto: el `search_path` NO era el
problema. Prisma cualifica la tabla en el SQL que genera (`INSERT INTO "public"....`) y el
`?schema=` de la URI lo ignora bajo driver adapter; con `options=-c search_path=...` el resultado
era `P2021 · no existe la relacion <<public.ranking_snapshot_dia>>`. El unico punto donde ese
prefijo se cambia es `PrismaPgOptions.schema` del adapter:
`new PrismaPg({connectionString}, { schema: "t196_x" })`. El DDL real se aplica aparte con
`SET LOCAL search_path TO "t196_x", public`, que si hace falta, pero solo para que
`REFERENCES "usuario"("id")` quede fijada a `public.usuario` DE VERDAD.

### 6.2 Hueco 2 (menor) - assert del subitem de menu

Anadido a `tests/components/Sidebar.test.tsx` un caso: con `/ranking/historico`, el subitem
"Historico" queda activo y "Ranking del dia" NO. Calca el molde del caso ya existente de Tarifas.
No se borro ni modifico ningun caso previo, incluido el de `/incidentes`.

El defecto de doble-activo que se temia NO existe: el criterio de `Sidebar.tsx` es IGUALDAD
EXACTA (`pathname === child.href`), no prefijo, tanto para marcar el subitem como para abrir el
padre. El assert negativo sobre "Ranking del dia" queda puesto para que una mutacion a
`startsWith` ponga el test en rojo.

### 6.3 Verificacion del cierre - salida REAL

Perimetro (los 14 archivos de la feature + integracion de migracion + Sidebar + AppLayout):

```
 Test Files  16 passed (16)
      Tests  249 passed (249)
   Duration  10.74s
```
(eran 220 en 14 archivos; +29 tests: 6 del bloque C, el resto de Sidebar/AppLayout que ahora entran
en el perimetro)

Guardias completas:

```
> vitest run guard
 Test Files  84 passed (84)
      Tests  1121 passed (1121)
   Duration  11.47s
```

`pnpm run typecheck` -> limpio. `pnpm run lint` -> 0 errores, 57 warnings preexistentes.

R36 reverificado por el implementer: `git diff --stat tests/unit/services/ranking-service.test.ts`
NO devuelve nada. El archivo sigue intacto.

Estado de la base reverificado por el implementer DESPUES de todo (consulta propia, no la del
subagente): `_prisma_migrations` sin fila de `20260811120000_ranking_snapshot`,
`ranking_snapshot_dia`/`ranking_snapshot_fila` ausentes de `public`, y CERO esquemas `t196_%`.
El esquema temporal se crea fuera de transaccion y se suelta en un `afterAll` que corre pase o
falle el test, con barrido defensivo de huerfanos en el `beforeAll`. **Cero filas escritas en
`public`**: los dos mensajeros que necesitan las FK se LEEN de los que ya existen
(`SELECT id FROM public."usuario" ORDER BY id LIMIT 2`); si hubiera menos de dos, el test FALLA
con el motivo escrito en vez de saltarse.
