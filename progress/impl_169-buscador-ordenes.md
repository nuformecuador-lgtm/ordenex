# impl — Feature 169 · Buscador de texto en el listado de órdenes (T0 + T1 + T2)

> Rama `feature/169-buscador-ordenes` · worktree `.claude/worktrees/lote-135` · 2026-07-31
> Alcance de esta bitácora: **T0, T1 y T2**. **T3 (frontend) y T4 (medición) NO están
> hechos**: T3 lo hace `frontend_dev`; T4 vuelve a backend cuando la UI exista.
> Nada de lo entregado aquí es visible para el usuario todavía: el `filter.q` está abierto
> en el servidor, pero ninguna superficie lo envía.

---

## 1 · T0 — verificación previa: qué se midió y qué NO

| # | Base | Resultado | Estado |
| --- | --- | --- | --- |
| T0.1 | **local** (`ordenex@localhost:5432`, PostgreSQL 18.2) | `SELECT count(*) FROM orden` = **67** | medido |
| T0.1 | **preview** | — | **NO MEDIDO** |
| T0.1 | **producción** | — | **NO MEDIDO** |
| T0.2 | **local** | `pg_trgm` **no estaba instalada** (`pg_available_extensions` la ofrecía en 1.6). La migración la creó en el esquema `extensions`, que tampoco existía | verificado |
| T0.2 | **preview** | — | **NO VERIFICADO** |
| T0.2 | **producción** | — | **NO VERIFICADO** |

### Por qué no se midieron preview y producción

El `DATABASE_URL` de producción está marcado *sensitive* en Vercel (no recuperable por CLI
ni por dashboard) y el MCP de Supabase **no está autenticado en esta sesión**. No hay forma
honesta de obtener esos dos números desde aquí, y **no se inventan**. Quedan como
**requisito de despliegue**, no como deuda de código:

### Comprobación obligatoria ANTES de aplicar la migración en cada base

```sql
-- (a) ¿Cuántas filas hay que reescribir?  Umbral de decisión: 200 000 (design §2.2)
SELECT count(*) FROM orden;

-- (b) ¿Existe pg_trgm y en qué esquema?
SELECT e.extname, n.nspname
FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
WHERE e.extname = 'pg_trgm';
```

- **(a) > 200 000 filas ⇒ ventana de mantenimiento.** `ADD COLUMN … GENERATED … STORED`
  **reescribe la tabla entera** y toma un `ACCESS EXCLUSIVE`: mientras dura, `orden` no
  admite **ni lecturas ni escrituras**. `CREATE INDEX` añade después un `SHARE` (bloquea
  escrituras). Con las decenas de miles que el humano espera son segundos; con la ingesta
  masiva corriendo hay que pararla. No se puede usar `CONCURRENTLY`: Prisma ejecuta cada
  migración dentro de una transacción.
- **(b) devuelve un esquema distinto de `extensions` ⇒ reparar ANTES**, con
  `ALTER EXTENSION pg_trgm SET SCHEMA extensions;`. Si no, la migración **falla en voz
  alta** al no resolver `extensions.gin_trgm_ops`. Ese fallo ruidoso es deliberado (P2,
  default aprobado): la alternativa —no cualificar el opclass— crearía el índice en una
  base y no en otra, con la búsqueda lenta solo en producción y sin ninguna señal.
- **(b) devuelve vacío** ⇒ nada que hacer: la migración la crea.

### T0.3 — preguntas abiertas resueltas por *default*

- **P3** (término solo-dígitos que es guía *y* fragmento de teléfono): se aplica el default
  del spec, **R9 tal cual** — devuelve esa guía y solo esa; si no coincide con ninguna, cae
  a parcial (R10). El disparador del fallback es **`total`, nunca `items.length`** (R11).
- **P2**: default aplicado (crear si no existe, fallar ruidosamente si está en otro
  esquema). Sigue **abierta** hasta que alguien corra la consulta (b) en preview y prod.
- **P1** (¿existen guías de menos de 3 dígitos?): **sigue abierta**. No se investigó: la
  genera `siguiente_num_guia()` y el rango que produce no está documentado en el repo. Se
  mantiene el mínimo de 3 como limitación conocida.
- **P4**: sigue abierta (es T0.1 sobre producción).

---

## 2 · Archivos

### Creados

| Archivo | Qué es |
| --- | --- |
| `lib/utils/busqueda-orden.ts` | Normalizador compartido: `ACENTOS_FROM`/`ACENTOS_TO` (48+48), `normalizarTerminoBusqueda`, `soloDigitosSiPareceNumero`. Puro |
| `db/migrations/20260731160000_orden_busqueda_trgm/migration.sql` | UP: esquema `extensions` → `pg_trgm` → columna generada → índice GIN |
| `db/migrations/20260731160000_orden_busqueda_trgm/down.sql` | DOWN: índice → columna, con `IF EXISTS`. Sin `DROP EXTENSION`, sin `DROP SCHEMA` |
| `tests/integration/db/_postgres-real.ts` | Utilidades de los tests que necesitan Postgres de verdad (no es `.test.ts`) |
| `tests/integration/db/orden-busqueda-trgm-migration.test.ts` | Cobertura estática del UP/DOWN/schema |
| `tests/integration/db/busqueda-normalizacion-paridad.test.ts` | Paridad SQL ↔ TS sobre corpus, contra base real |
| `tests/integration/db/busqueda-sincronizacion-columna.test.ts` | Sincronización automática + imposibilidad de escritura |
| `tests/integration/db/busqueda-comportamiento.test.ts` | Comportamiento de la búsqueda contra Postgres |
| `tests/unit/utils/busqueda-orden.test.ts` | Normalizador |
| `tests/unit/types/orden-filter-busqueda.test.ts` | Borde `q` |
| `tests/unit/db/prisma-omit-busqueda-texto.test.ts` | `omit` global |
| `tests/unit/guards/busqueda-texto-solo-lectura.test.ts` | Guardia de escritura/exposición |
| `tests/unit/repositories/orden-repository-busqueda.test.ts` | `where` Prisma + escape de LIKE |
| `tests/unit/services/orden-service-busqueda.test.ts` | Traducción del término + fallback |
| `tests/unit/services/orden-service-busqueda-alcance.test.ts` | Alcance por rol |

### Modificados

| Archivo | Cambio |
| --- | --- |
| `db/schema.prisma` | `busquedaTexto String? @default(dbgenerated()) @map("busqueda_texto")` + `@@index(..., type: Gin, map: "orden_busqueda_texto_trgm_idx")` |
| `lib/db/prisma-client.ts` | `PRISMA_OMIT` exportado y cableado al `PrismaClient` |
| `lib/types/orden.ts` | `q` en `ORDEN_FILTER_FIELDS` y en `ordenFilterSchema`; `BUSQUEDA_MIN_CHARS`/`BUSQUEDA_MAX_CHARS` |
| `lib/interfaces/repositories/IOrdenRepository.ts` | `ListOrdenesWhere` gana `busqueda?: string` y `numGuia?: number` |
| `lib/services/OrdenService.ts` | `escribirBusqueda` + `listarConFallbackDeGuia`; `listar` y `listarCompleto` pasan por él |
| `lib/repositories/OrdenRepository.ts` | `escaparLike` + las dos claves nuevas en el `where` de `list` |
| `tests/unit/types/orden-filter-144.test.ts` | **único test existente tocado** (ver §6) |
| `specs/169-buscador-ordenes/tasks.md` | `[x]` de lo hecho; T0.1/T0.2 marcadas PARCIAL |

**No se tocó** ningún archivo de `app/`, `components/` ni `hooks/`. En particular, **no se
tocó `app/(app)/ordenes/_components/OrdenesListado.tsx`** (el archivo del PR #236 abierto).

---

## 3 · Ejecuciones reales contra Postgres

### 3.1 Round-trip de la migración (T1.3 + T1.4)

Secuencia ejecutada sobre el `migration.sql`/`down.sql` **finales**:

```
$ pnpm exec prisma migrate deploy --schema db/schema.prisma
Applying migration `20260731160000_orden_busqueda_trgm`
All migrations have been successfully applied.

$ pnpm run db:rollback              # DOWN, 1ª vez
Aplicando rollback: 20260731160000_orden_busqueda_trgm
Script executed successfully.
Rollback completado: 20260731160000_orden_busqueda_trgm

$ pnpm run db:rollback              # DOWN, 2ª vez -> IDEMPOTENTE, no falla
Aplicando rollback: 20260731160000_orden_busqueda_trgm
Script executed successfully.
Rollback completado: 20260731160000_orden_busqueda_trgm

$ pnpm exec prisma migrate status
Following migration have not yet been applied:
20260731160000_orden_busqueda_trgm

$ pnpm exec prisma migrate deploy   # re-aplicación
All migrations have been successfully applied.
```

Estado tras el DOWN (comprobado por SQL): columna **0**, índice **0**, extensión
`pg_trgm` **1** (deliberadamente conservada), filas de `orden` **67** (intactas).

Estado tras el UP:

```
column_name    | data_type | is_nullable | is_generated
busqueda_texto | text      | YES         | ALWAYS

indexdef: CREATE INDEX orden_busqueda_texto_trgm_idx
          ON public.orden USING gin (busqueda_texto extensions.gin_trgm_ops)

pg_extension: pg_trgm en el esquema `extensions`
```

Que la migración aplique **demuestra empíricamente** lo que el design daba por probable:
`num_guia::text`, `translate`, `lower`, `regexp_replace` y `btrim` son admisibles en una
columna generada, y `extensions.gin_trgm_ops` resuelve sin depender del `search_path`.

### 3.2 Drift cero (T1.5, R30)

```
$ pnpm exec prisma migrate diff --from-config-datasource --to-schema db/schema.prisma --script
-- This is an empty migration.

$ pnpm exec prisma migrate dev --create-only --name t15_verificacion_drift
$ cat db/migrations/20260731172943_t15_verificacion_drift/migration.sql
-- This is an empty migration.          # carpeta descartada tras comprobarlo
```

**Se llegó midiendo, no adivinando.** La primera declaración (`busquedaTexto String? @map(…)`
sin `@default`) producía:

```
-- AlterTable
ALTER TABLE "orden" ALTER COLUMN "busqueda_texto" DROP DEFAULT;
```

Prisma lee la expresión `GENERATED ALWAYS AS (…)` como si fuera un `DEFAULT` de columna.
Con `@default(dbgenerated())` el diff sale vacío. El opclass del `@@index` va **sin
cualificar** (`raw("gin_trgm_ops")`) porque es lo que Prisma lee de `pg_opclass`, que guarda
nombre y esquema por separado; el SQL aplicado **sí** lo cualifica, que es donde importa.
No hizo falta el plan B del design §10.2.

### 3.3 Desviación deliberada del design §2.1: la clase de espacios

El design escribía `regexp_replace(…, '\s+', ' ', 'g')`. **Se cambió a
`'[ \t\n\r\f\v]+'`**, y no es cosmético:

```sql
-- medido en el Postgres 18.2 local (build msvc)
SELECT regexp_replace(E'a b', '\s+', ' ', 'g');   -- => 'a b'   (¡colapsa el NBSP!)
SELECT regexp_replace(E'a b', '[ \t\n\r\f\v]+', ' ', 'g');  -- => 'a<NBSP>b'
```

El `\s` de Postgres es `[[:space:]]`, que **depende del ctype de la base**: este build
colapsa el NBSP, un build glibc (Supabase) no. Con `\s`, la columna se calcularía distinto
en local y en producción y la paridad con Node sería indemostrable — exactamente el motivo
por el que el propio design descarta `unaccent`. La clase explícita da el mismo resultado en
cualquier build y en cualquier locale, y el corpus de paridad incluye ese caso.

---

## 4 · Decisiones de implementación que el design dejaba abiertas

1. **`escaparLike` vive en el repositorio** (`OrdenRepository`), no en el util: la sintaxis
   de comodines es dialecto de la capa de datos. El service entrega un **término**; el
   repositorio lo convierte en patrón.
2. **El fallback se implementa reconstruyendo el `where`** (`construirWhere(…, { sinRutaRapida: true })`)
   en vez de parchear el objeto ya construido, que dejaría `numGuia` y `busqueda`
   conviviendo — un AND imposible de satisfacer.
3. **`listarCompleto` pasa por el mismo método** que `listar`. Si llamara a `repo.list`
   directamente, un término numérico que no es guía daría filas en pantalla y un archivo
   vacío (R20 roto en silencio).
4. **El `omit` obliga a un ensanchamiento de tipo en `prisma-client.ts`.** `PrismaClient<{omit}>`
   no es asignable al `PrismaClient` ancho contra el que están tipados los ~25 repositorios.
   Se ensancha con un cast **en ese único punto** y se documenta: la garantía de R28 es de
   ejecución y la demuestra un test contra Postgres, no el compilador.
5. **Los tests contra base real se saltan si no hay `DATABASE_URL`**, y todo lo que insertan
   corre en una transacción que **siempre se revierte** (`enTransaccionRevertida`): ni una
   fila queda en la base de desarrollo, ni aunque el runner se caiga a mitad.
6. **El corpus de `busqueda-comportamiento` se acota con `createdAt >= marca`** y el primer
   caso del archivo comprueba ese acotamiento: sin él, los conteos no afirmarían nada.
7. **Los errores de Postgres se asertan por SQLSTATE** (`428C9`), no por texto: este
   servidor responde en español.

---

## 5 · Mapa R → test

Solo los requisitos dentro del alcance T0-T2. **R31 a R42 no están cubiertos todavía**
(R31 es T4; R32-R42 son T3, del `frontend_dev`).

| R | Test que lo cubre | Archivo |
| --- | --- | --- |
| R1 | `R1: q es una clave admitida del filter` / `R1: q es OPCIONAL` | `tests/unit/types/orden-filter-busqueda.test.ts` |
| R2 | `R2: el termino se escribe en UNA clave escalar, nunca dentro de un OR` | `tests/unit/services/orden-service-busqueda.test.ts` |
| R2 | `R2: la DIRECCION no es buscable` / `el PRODUCTO` / `las NOTAS` | `tests/integration/db/busqueda-comportamiento.test.ts` |
| R2 | `la expresion concatena los CUATRO campos buscables y NADA mas (R2)` | `tests/integration/db/orden-busqueda-trgm-migration.test.ts` |
| R3 | `R3: menos de 3 caracteres es validation_error` + `R3: los espacios NO cuentan` | `tests/unit/types/orden-filter-busqueda.test.ts` |
| R4 | `R4: por encima del maximo es validation_error` | `tests/unit/types/orden-filter-busqueda.test.ts` |
| R5 | `al PRINCIPIO` / `en MEDIO` / `al FINAL` / `dentro de una palabra` / `fragmento de la GUIA` | `tests/integration/db/busqueda-comportamiento.test.ts` |
| R6 | `un termino SIN tildes encuentra el dato CON tildes` (+3 casos) | `tests/integration/db/busqueda-comportamiento.test.ts` |
| R6 | `el texto indexado esta en minusculas y sin las tildes del mapa` | `tests/integration/db/busqueda-normalizacion-paridad.test.ts` |
| R7 | `100% encuentra SOLO la orden que dice 100%` / `un % suelto no devuelve el listado entero` / `1_0 no encuentra 100` / `\%` | `tests/integration/db/busqueda-comportamiento.test.ts` |
| R7 | bloque `escape de comodines de LIKE (R7)` (5 casos) | `tests/unit/repositories/orden-repository-busqueda.test.ts` |
| R8 | `un dato con espacios repetidos se encuentra tecleando espacios simples` + `mismo resultado` | `tests/integration/db/busqueda-comportamiento.test.ts` |
| R8 | `un dato con espacios repetidos queda con espacios simples (R8)` | `tests/integration/db/busqueda-normalizacion-paridad.test.ts` |
| R9 | `R9: un termino de SOLO DIGITOS se resuelve por igualdad contra la guia` | `tests/unit/services/orden-service-busqueda.test.ts` |
| R9 | `R9: un termino que ES una guia devuelve esa orden y SOLO esa` | `tests/integration/db/busqueda-comportamiento.test.ts` |
| R10 | `R10: si la guia NO existe, se reintenta como coincidencia parcial` | `tests/unit/services/orden-service-busqueda.test.ts` |
| R10 | `R10: un termino numerico que NO es guia cae a coincidencia parcial` | `tests/integration/db/busqueda-comportamiento.test.ts` |
| R11 | `R11: pedir la PAGINA 3 de una guia exacta NO cae al trigram` + `R11: el criterio es el MISMO en la pagina 1 y en la 3` | `tests/unit/services/orden-service-busqueda.test.ts` |
| R12 | `R12: un numero por encima del rango de int4 NO se intenta como guia` + `R12: un termino de 30 digitos` | `tests/unit/services/orden-service-busqueda.test.ts` |
| R13 | bloque `telefono con y sin separadores (R13)` (4 casos) | `tests/integration/db/busqueda-comportamiento.test.ts` |
| R13 | `R13: digitos con separadores de telefono viajan en su forma SOLO DIGITOS` | `tests/unit/services/orden-service-busqueda.test.ts` |
| R14 | `el termino es una clave HERMANA: AND con estado, catalogos y fechas` | `tests/unit/services/orden-service-busqueda.test.ts` |
| R14 | `R15: el total respeta el AND con los demas filtros (R14)` | `tests/integration/db/busqueda-comportamiento.test.ts` |
| R15 | bloque `el conteo usa EXACTAMENTE el mismo criterio que la pagina (R15)` (3 casos) | `tests/unit/repositories/orden-repository-busqueda.test.ts` |
| R15 | `R15: el total coincide con el numero real de coincidencias` | `tests/integration/db/busqueda-comportamiento.test.ts` |
| R16 | `R16: el orden del listado es el mismo con termino y sin termino` | `tests/integration/db/busqueda-comportamiento.test.ts` |
| R16 | `el orderBy es el mismo con y sin busqueda` | `tests/unit/repositories/orden-repository-busqueda.test.ts` |
| R17 | `R17: una orden borrada logicamente no aparece ni buscandola por su nombre exacto` | `tests/integration/db/busqueda-comportamiento.test.ts` |
| R17 | `R17: sigue excluyendo las borradas logicamente` | `tests/unit/repositories/orden-repository-busqueda.test.ts` |
| R18 | bloque `sin termino, el contrato previo no cambia (R18)` (3 casos) | `tests/unit/services/orden-service-busqueda.test.ts` |
| R18 | `sin termino, la clave NO aparece (R18)` | `tests/unit/repositories/orden-repository-busqueda.test.ts` |
| R19 | `R19: la whitelist crecio en UNA clave, no se abrio` | `tests/unit/types/orden-filter-busqueda.test.ts` |
| R20 | `el where de la descarga es IDENTICO al del listado para el mismo filtro` + `listarCompleto hereda el MISMO fallback numerico` | `tests/unit/services/orden-service-busqueda.test.ts` |
| R20 | `el modo COMPLETO (descarga) hereda el mismo termino y los mismos limites (R20)` | `tests/unit/types/orden-filter-busqueda.test.ts` |
| R21 | `R21: el acotamiento por rol se escribe DESPUES y el termino no lo toca` | `tests/unit/services/orden-service-busqueda.test.ts` |
| R21 | `R21: el termino solo ESTRECHA — con el, el adminTienda nunca ve mas que sin el` | `tests/unit/services/orden-service-busqueda-alcance.test.ts` |
| R22 | bloque `adminTienda (R22)` (5 casos, incluido el `total: 0`) | `tests/unit/services/orden-service-busqueda-alcance.test.ts` |
| R23 | bloque `mensajero (R23)` (3 casos) | `tests/unit/services/orden-service-busqueda-alcance.test.ts` |
| R24 | `R24: un adminSatelite recibe forbidden y NI SIQUIERA se consulta la base` (+ descarga) | `tests/unit/services/orden-service-busqueda-alcance.test.ts` |
| R25 | `R25: sin sesion, unauthenticated y el servicio ni se instancia` (+ descarga) | `tests/unit/services/orden-service-busqueda-alcance.test.ts` |
| R26 | `al CREAR…` / `al MODIFICAR el destinatario…` / `al asignar la GUIA despues…` | `tests/integration/db/busqueda-sincronizacion-columna.test.ts` |
| R27 | `escribir la columna a mano es IMPOSIBLE: Postgres lo rechaza (R27)` | `tests/integration/db/busqueda-sincronizacion-columna.test.ts` |
| R27 | bloque `nadie escribe busquedaTexto (R27)` (5 casos, censo de `lib/**`, `app/**`, `components/**`, `hooks/**`, `scripts/**`) | `tests/unit/guards/busqueda-texto-solo-lectura.test.ts` |
| R28 | `una lectura normal NO trae la columna: no viaja a ningun DTO (R28)` | `tests/integration/db/busqueda-sincronizacion-columna.test.ts` |
| R28 | bloque `omit global` (4 casos) + bloque `no se filtra a ninguna respuesta (R28)` (3 casos) | `tests/unit/db/prisma-omit-busqueda-texto.test.ts`, `tests/unit/guards/busqueda-texto-solo-lectura.test.ts` |
| R29 | bloque `DOWN — revierte en orden INVERSO y es idempotente (R29)` (5 casos) + **el round-trip real de §3.1** | `tests/integration/db/orden-busqueda-trgm-migration.test.ts` |
| R30 | bloque `carpeta y schema.prisma (R30)` (5 casos) + **el diff vacío real de §3.2** | `tests/integration/db/orden-busqueda-trgm-migration.test.ts` |
| **R31** | **PENDIENTE — T4.1/T4.2** | — |
| **R32-R42** | **PENDIENTE — T3 (`frontend_dev`)** | — |

---

## 6 · El único test existente que se tocó

`tests/unit/types/orden-filter-144.test.ts`, caso
`R30: la whitelist son exactamente estas claves`. Es un **censo**: enumera
`ORDEN_FILTER_FIELDS` entera para que ampliarla sea una decisión explícita. R1/R19 la
amplían en una clave, así que el censo tenía que crecer con ella — mantenerlo intacto
habría exigido dejar `q` fuera de la whitelist declarada, o sea, que la constante mintiera.
Se añadió `"q"` y un comentario que dice por qué. **Ningún otro test existente se modificó**,
y la suite de las features 144 y 151 pasa sin tocarse.

---

## 7 · Salida real de las puertas

```
$ pnpm run typecheck
> tsc --noEmit
(sin salida: 0 errores)

$ pnpm run lint
✖ 20 problems (0 errors, 20 warnings)
  (las 20 warnings son las del baseline: `_input`/`_actor`/`_args`/`_items`… preexistentes)

$ pnpm test
 Test Files  676 passed (676)
      Tests  8233 passed (8233)
   Duration  195.96s

$ ./init.sh
✓ typecheck paso
✓ lint paso
✓ test paso
✓ todas las migraciones tienen down.sql
✓ .env presente
== init OK ==
```

**Baseline al empezar: 665 archivos / 8052 tests.** Delta: **+11 archivos de test, +181
tests, 0 rojos**. (El archivo nº 12 de la feature, `_postgres-real.ts`, no es un `.test.ts`.)

Los 12 archivos de test de la feature, en aislado:

```
$ pnpm exec vitest run <los 12 archivos>
 ✓ tests/integration/db/orden-busqueda-trgm-migration.test.ts     (27 tests)
 ✓ tests/unit/types/orden-filter-144.test.ts                      (24 tests)
 ✓ tests/unit/utils/busqueda-orden.test.ts                        (20 tests)
 ✓ tests/unit/types/orden-filter-busqueda.test.ts                 (14 tests)
 ✓ tests/unit/guards/busqueda-texto-solo-lectura.test.ts           (8 tests)
 ✓ tests/unit/services/orden-service-busqueda.test.ts             (24 tests)
 ✓ tests/unit/repositories/orden-repository-busqueda.test.ts      (17 tests)
 ✓ tests/integration/db/busqueda-normalizacion-paridad.test.ts    (16 tests)
 ✓ tests/integration/db/busqueda-sincronizacion-columna.test.ts    (6 tests)
 ✓ tests/unit/services/orden-service-busqueda-alcance.test.ts     (13 tests)
 ✓ tests/unit/db/prisma-omit-busqueda-texto.test.ts                (4 tests)
 ✓ tests/integration/db/busqueda-comportamiento.test.ts           (32 tests)
 Test Files  12 passed (12)
      Tests  205 passed (205)
```

---

## 8 · Orden de despliegue y de reversión (adelanto de T5.3)

- **Desplegar: MIGRACIÓN PRIMERO, CÓDIGO DESPUÉS.** El código construye un `where` sobre
  `busqueda_texto`; sin la columna, toda consulta con término revienta.
- **Revertir: CÓDIGO PRIMERO, MIGRACIÓN DESPUÉS.** El `down.sql` solo revierte la base.
- **Antes de aplicar en cada base**, correr las dos consultas de §1 y actuar según los
  umbrales. **Esto no es opcional**: es lo que T0.1/T0.2 no pudieron verificar.

---

## 9 · Preguntas abiertas y deuda que dejo

1. **P1 sigue abierta** — ¿existen `num_guia` de 1-2 dígitos? Si existieran, serían
   inalcanzables desde el buscador (mínimo de 3, decisión cerrada del humano). No se
   investigó el rango de `siguiente_num_guia()`.
2. **P2 y P4 siguen abiertas** para preview y producción (§1). Bloquean el *despliegue*, no
   el código.
3. **Ampliar el mapa de acentos costará una reescritura de tabla.** Los 48 caracteres
   cubren español/portugués/francés; `ø`, `ł`, `å` y cirílico no se pliegan (en ninguno de
   los dos lados, así que no hay falso negativo por asimetría: hay que teclearlos tal cual).
   Añadir un carácter es una línea de SQL **más recalcular la columna en toda la tabla**.
4. **Falso positivo aceptado:** un término **con espacio** puede cruzar la frontera entre
   dos segmentos concatenados (p. ej. `"88880000 juan"` casando el final de un teléfono con
   el principio de un nombre). Es siempre un **superconjunto**, nunca una fuga, y un término
   solo-dígitos no puede producirlo. Documentado en el design §2.1.
5. **`ñ` → `n`** hace que "peña" y "pena" se encuentren mutuamente. Comportamiento estándar
   de una búsqueda sin acentos y consistente con el buscador del mensajero (114).
6. **Ruido en la salida de tests:** correr `OrdenRepository.list` dentro de una transacción
   interactiva dispara un `DeprecationWarning` de `pg` (el `Promise.all([findMany, count])`
   lanza dos consultas sobre la misma conexión). No afecta al resultado —`pg` las
   serializa— pero conviene saber de dónde sale antes de que alguien lo persiga.
7. **T4 (medición) no está hecha y R31 no está cubierto.** Nada de lo entregado aquí
   demuestra todavía que la consulta use el índice: eso se mide sobre 50 000 filas después
   de T3. Hasta entonces, el rendimiento es una promesa del diseño, no un hecho verificado.

---

## 10 · Veredicto

**T0 (con dos verificaciones declaradas NO ejecutables desde esta sesión y escritas como
requisito de despliegue), T1 y T2 completas: migración aplicada y revertida contra Postgres
real con diff cero, paridad SQL↔TS demostrada por test, y el término compone en AND detrás
del acotamiento por rol con 205 tests propios en verde y la suite entera intacta.**
