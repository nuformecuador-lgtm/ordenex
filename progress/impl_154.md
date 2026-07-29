# impl_154 — Catálogo de estados v2 (`por_recolectar_en_tienda` + `incidente`)

> Rama: `feature/154-catalogo-estados-v2` · Worktree: `.claude/worktrees/lote-135` · Zona: `backend`
> Spec: `specs/154-catalogo-estados-v2/` (R1–R33) · Fase: implementación (backend_dev)
> Fecha: 2026-07-29

---

## 1. Veredicto

**Hecho y verde.** El catálogo pasa de 18 a 20 estados, el enum de familias de historial de 22 a
24, y el grafo de transiciones suma 2 aristas de flujo (#43, #44) y 1 de creación. **No se retira
ninguna arista** (decisión Q2 del gate). Ningún service, action, repository ni route handler
cambia: los dos values nacen **declarados y sin productor**, con un guard de censo que lo impide
hasta las features 155–158.

`./init.sh` termina en `== init OK ==` con **547 archivos de test / 5735 tests / 0 fallos**.

---

## 2. La puerta T0 y cómo condiciona todo lo demás

Las tres preguntas bloqueantes se cerraron con el humano el **2026-07-29** (antes de que empezara
esta fase). Están escritas en el bloque de cabecera de `specs/154-catalogo-estados-v2/requirements.md`
y en el `status_note` de la ficha 154 de `feature_list.json`.

| Q | Respuesta | Efecto en la implementación |
| --- | --- | --- |
| **Q1** | `#5` (`en_preparacion → en_bodega_central` vía `generacion_guia`) **sobrevive** | R22 se implementa tal cual: la arista sigue en el mapa |
| **Q2** | **La 154 es SOLO ADITIVA. Cero bajas.** `#4`/`#6`/`#7c` → feature 156; `#1`/`#3`/`#7b` → feature 155 | **R18–R21 quedan diferidos.** El mapa conserva las 43 aristas previas |
| **Q3** | 154 + 155 + 156 viajan como tren a `prod` | Explica por qué la 154 no retira nada; ver §7 |
| **Q4** | `en_reparto → incidente` va vía `gestion`; el value `incidente` del enum de historial nace **sin productor** hasta la 158 | Deliberado. No se "arregla" |
| **Q5** | Confirmada tal cual: `warning` / `danger`, sin acento de marca | Implementado en `EstatusBadge.tsx` |
| **Q6** | No se excluye `por_recolectar_en_tienda` de ningún tablero aquí | Sin cambios en services |
| **Nueva** | **`incidente` es TERMINAL y sin NINGUNA salida.** El `indemnizada` que se planteó quedó descartado | `incidente: []` en el mapa, `ESTADOS_TERMINALES` a 3 |

**T0.3 verificada de verdad contra el código**, no asumida: `rg -n "\ben_ruta\b" lib/ app/ tests/`
devuelve 20 coincidencias y **todas** están en el guard de censo de la 153
(`tests/unit/guards/censo-order-status-rename.test.ts`) o en los dos tests de migración que su
propia allowlist admite (`order-status-en-reparto-migration.test.ts`,
`order-status-rename-nomenclatura-migration.test.ts`). Cero en `lib/` y `app/`.
`ORDER_STATUS_SEED[10] === "en_reparto"` y existe
`db/migrations/20260728120000_order_status_en_reparto`. La 153 está mergeada en la base.

---

## 3. Discrepancias entre el spec y la realidad (lo que NO se hizo como estaba escrito)

### 3.1 R18–R21 se implementan AL REVÉS de como están redactados

El spec pide considerar **ilegales** cuatro transiciones. La decisión Q2 dice que la 154 no retira
ninguna arista. Resultado: esas cuatro **siguen siendo legales** al terminar esta feature.

No lo dejé como un hueco silencioso. Hay un `describe` explícito —
`tests/unit/domain/order-status-transiciones.guardia.test.ts` › *"154 — BAJAS DIFERIDAS: R18-R21 se
mudan a las features 155/156"* — con un caso por requisito que **afirma que la arista sigue pasando**
y nombra la feature que la retirará. Cuando la 155/156 la retire, ese test se pondrá rojo y obligará
a mover el caso a la feature correspondiente. Es un contrato de postergación, no una excepción.

Motivo técnico de la decisión (verificado en el código, no supuesto): `GuiaAsignacionService`
ejecuta HOY esas seis aristas (`generarGuia` GAM/no-GAM y `rutearABodegaSatelite` con
`ORIGEN_RUTEO_SATELITE`). Retirarlas sin tocar el service dejaría `en_fulfillment: []` — rompe el
invariante de conectividad (R26) — y atraparía las órdenes vivas en ese estado.

**Documentos ajustados** (T0.1 lo exige): `requirements.md` (bloque de cabecera nuevo, R18–R21
marcados como diferidos, R24 reformulado) y `design.md` (§1 tabla de superficie, §3.2 "BAJAS →
BAJAS DIFERIDAS", §3.3, §3.4 recuentos reales, §3.5 histórico, §4 Q5 confirmada, §6/A1 pasa de
descartada a **elegida**).

### 3.2 Los recuentos del design §3.4 estaban calculados para el escenario con bajas

`design.md` decía 39 aristas de flujo / 37 pares. Con Q2 = solo aditiva los reales son
**45 / 41 / 4**. Corregido en el design y aplicado a `RECUENTO_INVENTARIO`.

### 3.3 R24 estaba redactado sobre "una transición retirada por R18–R21"

Al no haber ninguna retirada, ese enunciado se quedó sin sujeto. Lo reformulé en `requirements.md`
a "una transición ilegal" y lo verifico sobre pares ilegales que involucran los dos values nuevos.

### 3.4 El design §2.3 lista 5 tests de migraciones de enum previas; barrí y encontré más consumidores

`rg -l "ORDEN_HISTORIAL_ORIGEN_TIPO_SEED" tests/` devuelve **8** archivos, no 5. Los 3 que el design
no listaba y que también había que tocar:

- `tests/unit/types/orden-historial-types.test.ts` — fija el recuento 22 y la lista literal.
- `tests/unit/repositories/orden-historial-cobertura.test.ts` — ver §3.5, es el más delicado.
- `tests/integration/db/no-migration-102.test.ts` — no requería cambio (no deriva la lista).

### 3.5 HALLAZGO no previsto por el spec: el test de cobertura del choke point exigía biyección

`tests/unit/repositories/orden-historial-cobertura.test.ts` afirmaba que los `origen_tipo` de
`PUNTOS_DE_ESCRITURA` cubren **exactamente** el enum. Añadir dos familias sin productor lo rompía,
y la salida fácil (inventar un punto de escritura falso) habría hecho mentir al test.

Solución: una lista nueva `FAMILIAS_SIN_PRODUCTOR` con las dos familias y la feature que las
consumirá, y la aserción pasa a ser *"puntos de escritura ∪ familias sin productor = enum, y los
dos conjuntos no se solapan"*. Más un test dedicado a R28 que falla en cuanto una de las dos
adquiera productor sin migrar de lista. La red de seguridad se conserva; solo se hace explícita la
ventana declarada-sin-uso.

### 3.6 Dos tests de orden de migraciones fuera del inventario del spec

Además de la denylist conocida de `zonas-migration.test.ts`, se pusieron rojos:

- `tests/integration/db/notificacion-migration.test.ts` — misma denylist apendida a mano.
- `tests/integration/db/order-status-en-reparto-migration.test.ts` — afirmaba que la migración de
  la 153 es **la última carpeta del repo**, invariante que cualquier migración nueva rompe. Lo
  relajé al patrón del repo (descontar las carpetas apendidas después) conservando la intención:
  "la 153 no nació antes de lo que ya existía".

### 3.7 `incidente` es una palabra común: el guard de censo necesita frontera de palabra

`rg -i incidente` marca **"coincidentes"** (nombres de test de filtros de cantón/distrito). El guard
usa `\bincidente\b`, que no las marca, y hay un test que lo fija explícitamente.

---

## 4. Archivos creados

| Archivo | Qué es |
| --- | --- |
| `db/migrations/20260729120000_order_status_v2_por_recolectar_incidente/migration.sql` | Migración A: 2 `INSERT ... SELECT ... WHERE NOT EXISTS` en la tabla catálogo |
| `db/migrations/20260729120000_order_status_v2_por_recolectar_incidente/down.sql` | `DELETE` guardado por ausencia de referencias en `orden` y `orden_historial_estado` |
| `db/migrations/20260729130000_orden_historial_origen_recoleccion_tienda_incidente/migration.sql` | Migración B: 2 `ALTER TYPE ADD VALUE IF NOT EXISTS` |
| `db/migrations/20260729130000_orden_historial_origen_recoleccion_tienda_incidente/down.sql` | Recrea el enum con las 22 familias previas + `ALTER COLUMN ... USING` + `DROP TYPE ..._old` |
| `tests/integration/db/order-status-v2-migration.test.ts` | Cobertura estática de la migración A (R1–R6) |
| `tests/integration/db/orden-historial-origen-recoleccion-tienda-incidente-migration.test.ts` | Cobertura estática de la migración B (R7–R12) + verificación de que los 8 `down.sql` previos NO se tocaron |
| `tests/unit/guards/censo-catalogo-estados-v2.test.ts` | Guard de censo "declarado y sin uso" (R28) |
| `tests/components/EstatusBadgeCatalogoV2.test.tsx` | Etiquetas y variantes de los dos chips nuevos (R29–R31) |
| `progress/impl_154.md` | Esta bitácora |

## 5. Archivos modificados

**Producción (6):**

- `db/schema.prisma` — `enum OrdenHistorialOrigenTipo` +2 values; comentario del modelo `OrderStatus` 18 → 20.
- `lib/types/order-status.ts` — `ORDER_STATUS_SEED` +2 (índices 18/19, apéndice).
- `lib/types/orden-historial.ts` — `ORDEN_HISTORIAL_ORIGEN_TIPO_SEED` +2; comentario que justifica por qué NO entran en `ORIGEN_TIPOS_CON_GESTION` (R12).
- `lib/types/order-status-transiciones.ts` — `por_recolectar_en_tienda: [#43]`, `en_reparto` gana #44, `incidente: []`, `ESTADOS_CREACION` 3→4, `ESTADOS_TERMINALES` 2→3, cabecera con recuentos y con la nota de por qué las bajas se mudan.
- `app/(app)/ordenes/_components/EstatusBadge.tsx` — **único `.tsx` de producción tocado**: 2 labels y 2 variantes. `ORDER_STATUS_CLASS` intacto.

**Tests (14):** `tests/fixtures/inventario-transiciones-140.ts`,
`tests/unit/domain/order-status-transiciones.{connectividad,guardia}.test.ts`,
`tests/unit/types/{order-status,orden-historial-types}.test.ts`,
`tests/unit/scripts/seed-order-status.test.ts`,
`tests/unit/repositories/{orden-historial-cobertura,registrar-cambio-estado.guardia}.test.ts`,
`tests/components/{EstatusLabel.test.ts,EstatusBadgeEnReparto.test.tsx}`,
`tests/integration/db/{gestion-orden-anulacion,orden-historial-origen-tipo-sla-devuelta,orden-historial-origen-tipo-resolver-novedad,orden-historial-origen-tipo-cancelacion-api,orden-historial-origen-recepcion-bodega-central,zonas,notificacion,order-status-en-reparto}-migration.test.ts`.

**Spec (3):** `specs/154-catalogo-estados-v2/{requirements,design,tasks}.md`.

**Los 8 `down.sql` previos que recrean el enum NO se tocaron** (T1.6, corrección (2) de la ficha):
son fotos históricas y el rollback es secuencial (`scripts/db-rollback.ts` toma siempre la última
carpeta). Hay un test que lo verifica archivo por archivo con sus recuentos (11/12/13/15/17/18/20/21).
`git diff --stat db/migrations/` solo muestra las dos carpetas nuevas.

---

## 6. Mapa `R<n> → test`

Los 33 requisitos, cada uno con al menos un test citado por archivo y nombre.

| R | Test |
| --- | --- |
| **R1** | `order-status-v2-migration.test.ts` › "R1: el catalogo reconoce por_recolectar_en_tienda como estado valido" · `unit/types/order-status.test.ts` › "feature 154/R1/R2: incluye por_recolectar_en_tienda (19no) e incidente (20mo)" · `unit/scripts/seed-order-status.test.ts` › "feature 154/R1/R2: siembra por_recolectar_en_tienda e incidente" |
| **R2** | `order-status-v2-migration.test.ts` › "R2: el catalogo reconoce incidente como estado valido" · (+ los dos anteriores) |
| **R3** | `order-status-v2-migration.test.ts` › "R3: los 18 previos siguen ahi, sin renombrar ni reordenar; el catalogo tiene 20" y "R3: el UP es ADITIVO — no borra, no renombra, no toca columnas ni RLS" · `unit/types/order-status.test.ts` › "feature 154/R3: los 18 values previos siguen intactos y en su posicion" |
| **R4** | `order-status-v2-migration.test.ts` › "R4: cada INSERT esta guardado por WHERE NOT EXISTS sobre el mismo value" y "R4: aplicarla dos veces seguidas deja 20 values y ningun duplicado" · `unit/types/order-status.test.ts` › "feature 154/R4: el alta de los dos values nuevos es idempotente (20 filas, sin duplicar)" |
| **R5** | `order-status-v2-migration.test.ts` › "R5: borra exactamente los dos values nuevos (el catalogo vuelve a 18)" |
| **R6** | `order-status-v2-migration.test.ts` › "R6: el DELETE esta guardado por ausencia de referencias en orden y en el historial" y "R6: documenta que si algo referencia NO borra y NO rompe FKs (best-effort)" |
| **R7** | `orden-historial-origen-recoleccion-tienda-incidente-migration.test.ts` › "R7: reconoce `recoleccion_tienda` como familia de origen de una transicion" y "R7/R8: añade las dos con IF NOT EXISTS" · `unit/types/orden-historial-types.test.ts` › "feature 154/R7/R8: reconoce recoleccion_tienda e incidente como familias de origen" |
| **R8** | `orden-historial-origen-recoleccion-tienda-incidente-migration.test.ts` › "R8: reconoce `incidente` como familia de origen de una transicion" · (+ los dos anteriores) |
| **R9** | `orden-historial-origen-recoleccion-tienda-incidente-migration.test.ts` › "R9: la correspondencia codigo <-> DB es EXACTA en ambas direcciones (24 = 24)" · `unit/types/orden-historial-types.test.ts` › "coincide 1:1 con los valores del enum Prisma orden_historial_origen_tipo" · **+ el build**: `satisfies readonly PrismaOrdenHistorialOrigenTipo[]` y `_EnsureExhaustive` en `lib/types/orden-historial.ts` |
| **R10** | `orden-historial-origen-recoleccion-tienda-incidente-migration.test.ts` › "R10: recrea el enum SIN las dos nuevas, con las 22 previas derivadas del SEED" y "R10: migra `origen_tipo` con USING y suelta el tipo viejo" |
| **R11** | `orden-historial-origen-recoleccion-tienda-incidente-migration.test.ts` › "R11: documenta la precondicion (0 filas con los origenes nuevos) y que el rollback ABORTA" |
| **R12** | `orden-historial-origen-recoleccion-tienda-incidente-migration.test.ts` › "R12: NINGUNA de las dos entra en ORIGEN_TIPOS_CON_GESTION (no alteran los intentos)" |
| **R13** | `order-status-transiciones.guardia.test.ts` › "R13: es LEGAL que una orden nazca en por_recolectar_en_tienda" · `…connectividad.test.ts` › "cada estado de creacion es alcanzable desde START y tiene salida de flujo" |
| **R14** | `order-status-transiciones.guardia.test.ts` › "R14: es LEGAL por_recolectar_en_tienda -> en_ruta_bodega_central (#43)" · `registrar-cambio-estado.guardia.test.ts` › "#43 deja pasar por_recolectar_en_tienda -> en_ruta_bodega_central (origen_tipo recoleccion_tienda) y registra el historial" (data-driven sobre el inventario, atraviesa el choke point real) |
| **R15** | `order-status-transiciones.guardia.test.ts` › "R15: es LEGAL en_reparto -> incidente (#44)" · `registrar-cambio-estado.guardia.test.ts` › "#44 deja pasar en_reparto -> incidente (origen_tipo gestion) y registra el historial" |
| **R16** | `…connectividad.test.ts` › "154/R16: incidente es terminal, alcanzable (#44) y SIN ninguna arista de salida" · `…guardia.test.ts` › "R16: incidente no tiene NINGUNA salida legal (terminal de verdad)" |
| **R17** | `…connectividad.test.ts` › "154/R17: por_recolectar_en_tienda NO es terminal y tiene entrada y salida" · `…guardia.test.ts` › "R17: la unica salida legal de por_recolectar_en_tienda es en_ruta_bodega_central" |
| **R18** | *(DIFERIDO a la 156)* `…guardia.test.ts` › "R18 (#4, lo retira la 156): en_preparacion -> por_recoger SIGUE siendo legal en la 154" |
| **R19** | *(DIFERIDO a la 156)* `…guardia.test.ts` › "R19 (#6/#7c, los retira la 156): en_preparacion -> en_ruta_bodega_satelite SIGUE siendo legal en la 154" |
| **R20** | *(DIFERIDO a la 155)* `…guardia.test.ts` › "R20 (#1, lo retira la 155): en_fulfillment -> por_recoger SIGUE siendo legal en la 154" |
| **R21** | *(DIFERIDO a la 155)* `…guardia.test.ts` › "R21 (#3/#7b, los retira la 155): en_fulfillment -> en_ruta_bodega_satelite SIGUE siendo legal en la 154" · + "la 154 no retira ninguna arista: el mapa conserva las 43 previas y suma 2" |
| **R22** | `…guardia.test.ts` › "R22: en_preparacion -> en_bodega_central sigue legal (destino de generar guia)" |
| **R23** | `…guardia.test.ts` › "R23: la asignacion en_bodega_central -> en_ruta_bodega_satelite / en_bodega_central -> por_recoger / en_bodega_satelite -> por_recoger sigue legal" (3 casos) |
| **R24** | `…guardia.test.ts` › "el mensaje de un par ilegal cita SOLO los dos value del catalogo" y "todo par ilegal que involucre los values nuevos produce un mensaje de solo dos values" |
| **R25** | `…connectividad.test.ts` › "154/R25: los dos values nuevos estan clasificados en el mapa (sin sobrantes)" y "el mapa declara una entrada por cada value del catalogo (exhaustividad, R5)" · **+ el build**: `satisfies Record<OrderStatusValue, …>` y `_EnsureExhaustive`, INTACTOS (no se relajaron) |
| **R26** | `…connectividad.test.ts` › "todo estado NO terminal tiene al menos UNA salida", "todo estado tiene al menos UNA entrada (los de creacion, desde START)" y "los estados terminales tienen entrada y estan exentos de necesitar salida" — los tres nombran los `value` ofensores al fallar |
| **R27** | `…guardia.test.ts` › "el mapa declara exactamente las aristas del inventario, ni una mas", "las dos aristas nuevas estan en el inventario transcrito a mano" y "los recuentos del inventario son 45 flujo / 41 pares / 4 creacion" |
| **R28** | `unit/guards/censo-catalogo-estados-v2.test.ts` (5 tests, incl. "ningun archivo de app/, lib/, components/, hooks/, scripts/ ni e2e/ fuera de la allowlist los nombra") · `unit/repositories/orden-historial-cobertura.test.ts` › "feature 154/R28: recoleccion_tienda e incidente estan declaradas y SIN productor" |
| **R29** | `components/EstatusBadgeCatalogoV2.test.tsx` › "la etiqueta legible en español es “Por recolectar en tienda”" y "usa la variante de ESPERA: mismo chip que `por_devolver` (warning), sin acento de marca" · `components/EstatusLabel.test.ts` › "154/R29: por_recolectar_en_tienda se muestra como “Por recolectar en tienda”" |
| **R30** | `components/EstatusBadgeCatalogoV2.test.tsx` › "la etiqueta legible en español es “Incidente”" y "usa la variante de ERROR: mismo chip que `rechazada` (danger), sin acento de marca" · `components/EstatusLabel.test.ts` › "154/R30: incidente se muestra como “Incidente”" |
| **R31** | `components/EstatusBadgeCatalogoV2.test.tsx` › "muestra el value CRUDO con la variante neutra" · `components/EstatusLabel.test.ts` › "cae al value crudo si el estado es desconocido" |
| **R32** | `unit/repositories/registrar-cambio-estado.guardia.test.ts` › "154/R32: un estado de la DB que el build no reconoce -> motivo `estatus_desconocido`" |
| **R33** | `unit/repositories/registrar-cambio-estado.guardia.test.ts` › "154/R33: con la DB sin los dos values nuevos, las transiciones previas siguen validando" |

---

## 7. Nota de release para el leader (T5.6)

**Q3 se cerró como TREN.** Las features **154 + 155 + 156** viajan **juntas** a `prod`.

Aun así, conviene tener claro por qué el riesgo es hoy bajo: como la 154 quedó **solo aditiva**, no
introduce por sí sola ninguna ventana de rotura — "generar guía" y "rutear a satélite" siguen
funcionando igual con la 154 sola. El acoplamiento del tren viene de la 155/156, que sí retiran
aristas y deben llegar junto al recableado de `GuiaAsignacionService`.

Efecto visible aceptado (design §7): la Server Action `listarOrderStatus` devolverá **20** filas en
vez de 18, así que los dos estados nuevos aparecerán en el desplegable de filtro de listados **sin
resultados** hasta la 155/157.

Esta nota debería copiarse a `progress/current.md`; no la escribo yo porque ese archivo es del
leader.

---

## 8. Lo que NO verifiqué — deuda declarada, explícita

1. **Round-trip real de migraciones contra Postgres (T5.3): NO HECHO.** No hay base de datos en el
   entorno de esta fase. Los cuatro `.sql` (dos UP y dos `down.sql`) se verificaron **solo por
   lectura y por test estático de regex**: nunca se ejecutaron contra un Postgres. En concreto,
   **no está probado empíricamente** que:
   - el `USING ("origen_tipo"::text::"orden_historial_origen_tipo")` del down de la B aborte de
     verdad ante una fila con los orígenes nuevos (R11) — está razonado y calcado del down de la
     139, pero no ejecutado;
   - el `DELETE` guardado del down de la A deje exactamente 18 filas con la base limpia (R5) ni que
     no borre nada con una orden apuntando a `incidente` (R6) — el test simula la semántica del
     `WHERE NOT EXISTS` en memoria, no la ejecuta en SQL;
   - la migración B no dispare 55P04 en un `prisma migrate deploy` real.

   Es la **misma deuda que arrastran la 137, la 138 y la 139** con sus migraciones de enum; se
   salda en el despliegue del tren.

2. **La cadena completa de rollback secuencial** (`db:rollback` ×2 para revertir B y luego A) no se
   ejecutó, por lo mismo. Lo que sí verifiqué de forma automatizada es que los 8 `down.sql` previos
   siguen siendo fotos históricas correctas (recuentos 11/12/13/15/17/18/20/21, ninguno cita los
   values de la 154).

3. **Comportamiento en runtime de los values nuevos:** por diseño no hay ninguno que probar — nadie
   los produce. Lo que se verifica es precisamente lo contrario (R28: que nadie los use).

4. **E2E (Playwright):** no se corrió. La feature no añade ningún flujo alcanzable por la UI (los
   dos chips solo se pueden renderizar con datos que todavía no existen), así que no hay recorrido
   E2E que escribir. Los dos chips se verifican con render de componente en jsdom.

---

## 9. Salida real de la verificación

```
$ pnpm run typecheck
> tsc --noEmit
(sin salida: 0 errores)

$ pnpm run lint
✖ 10 problems (0 errors, 10 warnings)
  (los 10 son warnings preexistentes de `dev`: react-hooks/exhaustive-deps y
   @typescript-eslint/no-unused-vars en archivos que esta feature no toca.
   Esta feature no añade ninguno.)

$ pnpm run test
 Test Files  547 passed (547)
      Tests  5735 passed (5735)
   Duration  129.99s

$ pnpm exec vitest run tests/integration/db     # peaje conocido al tocar enums
 Test Files  67 passed (67)   (corridos tambien dentro de la suite completa, 0 fallos)

$ ./init.sh
== Arnes SDD :: init ==
✓ node v24.13.0
✓ dependencias presentes
✓ regla max-2-por-zona respetada (in_progress=2)
✓ specs presentes para features sdd en vuelo
✓ typecheck paso
✓ lint paso
✓ test paso
✓ todas las migraciones tienen down.sql
✓ .env presente
== init OK ==
```

Partida de base: 543 archivos / 5655 tests. Final: **547 / 5735** (+4 archivos, +80 tests).

---

## 10. Fuera de alcance (confirmado, no olvidado)

- **Ningún service, repository, action ni route handler cambia.** El guard de censo de R28 lo hace
  cumplir de forma mecánica.
- **API pública de integradores sin cambios.** `lib/api/openapi-spec.ts` mantiene su enum de 14
  estados (es un subconjunto del catálogo; su test solo exige que todo value del enum exista en el
  catálogo, no la inversa). El `.yaml` espejo tampoco cambia.
- **Webhooks sin cambios**: `EVENTOS_PUBLICOS` sigue con 9 elementos.
- **Sin backfill de datos.** Ninguna orden viva cambia de estado.
- **RLS:** las dos migraciones son aditivas y no crean tablas ni columnas; `order_status` y
  `orden_historial_estado` conservan la RLS de features previas. Hay tests que verifican que ni el
  UP ni el DOWN tocan `CREATE POLICY` / `ROW LEVEL SECURITY`.
- El `satisfies Record<OrderStatusValue, …>` del mapa y los `Record<OrderStatusValue, …>` del badge
  **no se relajaron**: fueron justamente los que rompieron el build hasta clasificar los dos values,
  que es su función.
