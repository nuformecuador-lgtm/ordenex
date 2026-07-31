# impl — Feature 169 · Buscador de texto en el listado de órdenes (T0 → T5.3)

> Rama `feature/169-buscador-ordenes` · worktree `.claude/worktrees/lote-135` · 2026-07-31
> Alcance de esta bitácora, en tres fases y por orden de escritura:
> **T0+T1+T2** (§1-§10, `backend_dev`), **T3** (§11-§17, `frontend_dev`) y
> **T4+T5.1-T5.3** (§18-§24, `backend_dev`). Falta solo **T5.4** (registro en
> `feature_list.json` e `history.md`), que es del leader tras el reviewer.
>
> **Cada fase conserva su texto tal como lo escribió su autor**, incluido lo que después dejó
> de ser cierto — se corrige señalándolo, no reescribiendo la historia. Los dos casos:
> - §2 dice "ninguna superficie lo envía": era cierto al cerrar T2. Desde T3 (§11)
>   `/ordenes` sí lo envía.
> - §5, §9.7, §13 y §17 dicen que **R31 sigue sin cubrir**: era cierto al cerrar T3.
>   **T4 lo cubrió y lo midió** — ver §19 (números y planes), §20 (mapa completo) y §24.

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
| **R32-R42** | ~~PENDIENTE~~ → **cubiertos en T3: tabla completa en §13** | ver §13 |

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

---
---

# T3 — Frontend (`frontend_dev`, 2026-07-31)

> Alcance: **T3.1 a T3.6**. **T4 NO se tocó** (medición: vuelve a backend). **R31 sigue
> sin cubrir**, por lo mismo. Nada de lo de abajo cambia una línea de `lib/`, `db/` ni
> `app/api/`: la capa de datos es la que dejó T2, tal cual.

## 11 · Archivos

### Creados

| Archivo | Qué es |
| --- | --- |
| `tests/unit/components/filter-component-texto.test.tsx` | El `kind: "text"` genérico, con filtros de FANTASÍA (26 casos) |
| `tests/unit/components/ordenes-buscador-declaracion.test.ts` | Declaración en la barra de órdenes + traducción escalar (15) |
| `tests/unit/components/ordenes-module-busqueda.test.tsx` | Key SWR, reset de página/selección y vacío con término (15) |
| `tests/unit/components/ordenes-listado-buscador.test.tsx` | Cableado en la superficie real: primer control y término que llega a la action (8) |

### Modificados

| Archivo | Cambio |
| --- | --- |
| `components/shared/FilterComponent.tsx` | `kind: "text"`, `minChars` en `FilterDef`, el control `TextFilter` y `avisoMinimoCaracteres` |
| `app/(app)/ordenes/_components/ordenes-filtros-def.ts` | `CLAVE_BUSQUEDA`, `PLACEHOLDER_BUSQUEDA` y el `FilterDef` del buscador, PRIMERO |
| `app/(app)/ordenes/_components/seleccion-a-filter.ts` | `q` baja de lista a **escalar** |
| `app/(app)/ordenes/_components/OrdenesListado.tsx` | El buscador va delante del filtro de estado y NO se deshabilita con el catálogo geográfico |
| `app/(app)/ordenes/_components/OrdenesModule.tsx` | `emptyState` alternativo cuando hay término (R40) |
| `tests/unit/components/ordenes-filtros-def.test.ts` | **único test existente tocado** (ver §12.5) |
| `specs/169-buscador-ordenes/tasks.md` | `[x]` de T3.1-T3.6 |

**No se tocó** `DataTable`, `MultiSelectFilter`, `DateRangeFilter`, `TableFilters`,
`serializar-filtro.ts`, el buscador del mensajero (114), `SateliteOrdenesListado` (el otro
consumidor de `FilterComponent`) ni ninguna otra superficie. **Ningún archivo nuevo en
`components/`**: el control de texto vive DENTRO de `FilterComponent.tsx` (§12.1).

---

## 12 · Decisiones de implementación (y las tres que el design no cerraba)

### 12.1 El control de texto NO es un archivo nuevo

`MultiSelectFilter` y `DateRangeFilter` son componentes propios porque tienen sustancia
(panel, buscador interno, calendario, atajos). El de texto es un `Input`, una X y una
regla de mínimo: `TextFilter` vive como componente de módulo dentro de
`FilterComponent.tsx`, sin exportarse. Así la tabla "capas tocadas" del design §9 sigue
siendo exacta (UI = tres archivos de órdenes + `FilterComponent`) y la 145 no hereda una
pieza más que mantener.

### 12.2 El design decía "primero en `ordenes-filtros-def.ts`"; eso NO bastaba

`OrdenesListado` compone la barra como `[estado, ...construirFiltrosOrdenes(...)]`: el
filtro de ESTADO se declara ahí (su catálogo viene de `listarOrderStatus`, no del
catálogo geográfico). Declarar el buscador primero dentro de `construirFiltrosOrdenes` lo
dejaba **segundo** en pantalla, detrás del estado — R32 dice "primer control de su barra",
no "primer elemento de un array". Se reordenó el cableado: `[buscador, estado, ...resto]`.
El test que lo afirma **no mira el array**, mira el DOM: `compareDocumentPosition` del
campo contra los ocho controles restantes.

### 12.3 El buscador NO se apaga cuando falla el catálogo geográfico

`OrdenesListado` deshabilitaba en bloque todo lo que devolvía `construirFiltrosOrdenes`
cuando `catalogoFiltros === null` (R64 de la 144). Aplicar eso al buscador habría apagado
la búsqueda por guía porque no cargó la lista de provincias — dos cosas sin relación. El
`.map` que deshabilita se aplica ahora solo al resto; `reasignables` sigue cayendo con
ellos, como antes (no se cambia lo que no toca esta feature). Hay test de las dos mitades:
buscador `enabled`, Zona `disabled`.

### 12.4 Emisión: recortada, y solo cuando cambia algo

Dos reglas que el design no escribe y que decide la implementación:

1. **Se emite el término RECORTADO** (`"  pepe  "` produce `["pepe"]`). El borde ya hace
   `.trim()` antes de validar, así que mandar los espacios solo serviría para que
   `"pepe"` y `"pepe "` fueran dos keys de caché distintas con el mismo resultado.
2. **No se emite si lo que se emitiría es lo ya aplicado.** Sin esta guarda, cada
   pulsación por debajo del mínimo (y cada espacio final) reprogramaba el debounce y
   avisaba al consumidor de un cambio que no existía. Con ella, "teclear 2 caracteres **no
   emite**" (T3.1) y "vaciar el campo **emite sin la clave**" (T3.1) conviven: lo primero
   es que nada cambió; lo segundo es que había término y dejó de haberlo — si eso no se
   emitiera, el listado se quedaría filtrado por un texto que ya no está en el campo.

La guarda vive en el control (compara contra `aplicado`, el valor de su clave en la
selección), **no** en `fijar`: tocar `fijar` habría cambiado el comportamiento de los
cuatro tipos previos.

### 12.5 El único test existente que se tocó

`tests/unit/components/ordenes-filtros-def.test.ts`, cuatro asertos (`claves(true)`,
`claves(false)`, `toHaveLength(7)` a `8`, y la lista de `incluirReasignables: false`).
Es el **censo** de la barra —la enumera entera para que ampliarla sea explícita—, mismo
caso y mismo motivo que el `orden-filter-144.test.ts` que tocó el backend (§6):
mantenerlo intacto exigía dejar el buscador fuera de la barra declarada. Se añadió `"q"`
en primera posición y un comentario que dice por qué. **Ningún otro test existente se
modificó** (`git diff` vacío en `filter-component.test.tsx`,
`multi-select-filter-grupos.test.tsx`, `date-range-filter.test.tsx`,
`mis-asignaciones-buscador.test.ts`, `seleccion-a-filter.test.ts`,
`ordenes-module-filter-key.test.tsx`, `ordenes-listado-filtros.test.tsx`,
`ordenes-listado.test.tsx`, `ordenes-module.test.tsx` y todo `tests/components/`).

### 12.6 Lo que R38/R39 costaron: nada

Confirmado midiendo, no suponiendo: `serializarFiltro` ya serializa escalares
(`q=juan perez`) y `OrdenesModule` ya vuelve a página 1 y limpia la selección ante
cualquier cambio de key. Los tests de T3.4 **verifican** ese comportamiento con el
término; no hay una línea nueva para conseguirlo.

### 12.7 El vacío con término no lleva botón

R40 pide "ofrecer limpiar la búsqueda". Se ofrece **en el texto**
(«…». Revisa el texto o limpia la búsqueda.), como escribe el design §8.3, no como CTA:
`OrdenesModule` no es dueño de la barra —lo es `OrdenesListado`, y el `FilterComponent` es
no controlado—, así que un botón ahí exigiría un canal de "vaciar el filtro de fuera hacia
dentro" que hoy no existe. Es una limitación consciente, anotada en §16.

---

## 13 · Mapa R → test (T3)

| R | Test que lo cubre | Archivo |
| --- | --- | --- |
| R32 | `R32: el PRIMER filtro declarado es el de busqueda` + `sigue siendo el primero aunque caigan los filtros que dependen del rol` + `es UNO solo` + `se declara aunque el catalogo geografico venga vacio` | `tests/unit/components/ordenes-buscador-declaracion.test.ts` |
| R32 | `R32: precede a TODOS los demas controles de la barra, el de estado incluido` (DOM real) + `la barra monta UN campo de busqueda, con su placeholder` | `tests/unit/components/ordenes-listado-buscador.test.tsx` |
| R33 | `R33: es GENERICO — funciona con una clave y una etiqueta que no son de dominio` + `R33: no obtiene datos por si mismo` (el archivo entero usa filtros de fantasía) | `tests/unit/components/filter-component-texto.test.tsx` |
| R33 | `R33: se declara sobre el tipo generico text, con su etiqueta visible` | `tests/unit/components/ordenes-buscador-declaracion.test.ts` |
| R34 | `R34: no avisa en el acto` + `R34: una rafaga de DIEZ pulsaciones produce UNA sola emision` + `R34: usa el debounce del orquestador, no uno propio` | `tests/unit/components/filter-component-texto.test.tsx` |
| R34 | `R34: teclear un termino lo envia como ESCALAR q, en una sola consulta` | `tests/unit/components/ordenes-listado-buscador.test.tsx` |
| R35 | `R35: por debajo del minimo NO emite nada` + `avisa de cuantos caracteres hacen falta, sin error` + `con el campo vacio no hay aviso` + `alcanzado el minimo, el aviso desaparece` + `los espacios NO cuentan` | `tests/unit/components/filter-component-texto.test.tsx` |
| R35 | `R35: por debajo del minimo no se consulta nada y se avisa del minimo` (ninguna llamada a `listarOrdenes`) | `tests/unit/components/ordenes-listado-buscador.test.tsx` |
| R36 | `R36: vaciar el campo emite la seleccion SIN la clave` + `bajar del minimo borrando tambien retira la clave` + `al vaciarlo, el resto de filtros sigue en la salida` | `tests/unit/components/filter-component-texto.test.tsx` |
| R36 | `R36: [\"juan perez\"] -> q: \"juan perez\", no una lista` + `sin termino, la clave NO aparece` + `una lista vacia se omite` + `mandarlo como LISTA seria validation_error` | `tests/unit/components/ordenes-buscador-declaracion.test.ts` |
| R36 | `R36: vaciar el campo devuelve el listado a la consulta SIN busqueda` | `tests/unit/components/ordenes-listado-buscador.test.tsx` |
| R37 | `R37: se limpia individualmente con su propia accion, sin tocar a los demas` + `la accion de limpiar solo existe cuando hay algo escrito` + `Limpiar todo vacia el campo y lo saca de la salida` + `Limpiar todo emite UNA sola vez` | `tests/unit/components/filter-component-texto.test.tsx` |
| R37 | `R37: Limpiar todo vacia tambien el buscador y su clave sale de la consulta` | `tests/unit/components/ordenes-listado-buscador.test.tsx` |
| R38 | `R38: cambiar el termino vuelve a la PAGINA 1` + `R38: cambiar el termino limpia la seleccion de filas` + `R38: vaciar la busqueda tambien vuelve a la pagina 1` | `tests/unit/components/ordenes-module-busqueda.test.tsx` |
| R39 | bloque `serializarFiltro — el termino entra en la key de cache (R39)` (4 casos) + `re-renderizar con el MISMO termino no dispara una consulta nueva` + `cambiar el termino SI dispara la consulta del termino nuevo` | `tests/unit/components/ordenes-module-busqueda.test.tsx` |
| R40 | bloque `vacio CON busqueda activa (R40)` (5 casos: dice "Sin coincidencias", repite el término, ofrece limpiar, y SIN término el vacío es el de siempre) | `tests/unit/components/ordenes-module-busqueda.test.tsx` |
| R41 | `R41: se monta como campo de busqueda con nombre accesible propio y su placeholder` + `R41: el aviso es una region status a la que el campo APUNTA (aria-describedby)` | `tests/unit/components/filter-component-texto.test.tsx` |
| R42 | `R42: una barra sin kind text no monta ningun campo de busqueda ni aviso` | `tests/unit/components/filter-component-texto.test.tsx` |
| R42 | Las nueve suites vecinas **sin modificar** y en verde (145 tests): `filter-component`, `multi-select-filter-grupos`, `date-range-filter`, `mis-asignaciones-buscador` (114), `seleccion-a-filter`, `ordenes-module-filter-key`, `ordenes-listado-filtros`, `ordenes-listado`, `ordenes-module` | §14 |
| R14 (en la UI) | `R14: convive con el resto de claves en el MISMO objeto, sin pisarlas` + `R14: el termino se COMBINA con el resto de filtros, sin anularlos` | `ordenes-buscador-declaracion.test.ts`, `ordenes-listado-buscador.test.tsx` |
| R64 (de la 144) | `R64: si el catalogo geografico no cargo, el buscador sigue OPERATIVO` (y Zona sigue deshabilitada) | `tests/unit/components/ordenes-listado-buscador.test.tsx` |

**R31 NO está aquí y no lo está por olvido:** se mide en T4, después de esto.

---

## 14 · Salida real de las puertas (T3)

```
$ pnpm run typecheck
> tsc --noEmit
(sin salida: 0 errores)

$ pnpm run lint
✖ 20 problems (0 errors, 20 warnings)
  (las MISMAS 20 warnings del baseline: `_input`/`_actor`/`_args`/`_items`…)

$ pnpm test
 Test Files  680 passed (680)
      Tests  8297 passed (8297)
   Duration  201.29s

$ ./init.sh
✓ typecheck paso
✓ lint paso
✓ test paso        (680 archivos / 8297 tests, 211.47s)
✓ todas las migraciones tienen down.sql
✓ .env presente
== init OK ==
```

**Baseline al empezar T3: 676 archivos / 8233 tests.** Delta: **+4 archivos de test,
+64 tests, 0 rojos**.

Los archivos de T3, en aislado:

```
$ pnpm exec vitest run <los 4 nuevos + el censo tocado>
 Test Files  5 passed (5)
      Tests  84 passed (84)
```

Las suites vecinas que NO se tocaron, en aislado (evidencia de R42):

```
$ pnpm exec vitest run filter-component multi-select-filter-grupos date-range-filter
    mis-asignaciones-buscador seleccion-a-filter ordenes-module-filter-key
    ordenes-listado-filtros ordenes-module ordenes-listado
 Test Files  9 passed (9)
      Tests  145 passed (145)

$ git diff --stat -- <esos 9 archivos + tests/components/>
(vacío)
```

El `DeprecationWarning` de `pg` sigue apareciendo en la salida de la suite: es el ruido
preexistente que documenta §9.6, **no** lo introduce T3.

---

## 15 · Lo que un humano debería mirar en pantalla

Los tests afirman comportamiento, no estética. Sin ojos delante quedan sin verificar:

1. Que el campo **quepa** en la fila de la barra en pantalla estrecha (`min-w-56` sobre un
   `flex flex-wrap` con otros ocho controles).
2. Que el aviso del mínimo (una línea `text-xs` bajo el campo) no descoloque
   verticalmente el resto de controles, que se alinean con `items-end`.
3. Que la X nativa de `type="search"` de algunos navegadores no se superponga a la X
   propia. En jsdom no se renderiza ninguna de las dos, así que ningún test lo ve.

---

## 16 · Preguntas abiertas y deuda que dejo (T3)

1. **El vacío con término no ofrece un BOTÓN para limpiar** (§12.7), solo lo dice el
   texto. Si el humano quiere el botón, hace falta un canal para vaciar el
   `FilterComponent` desde fuera (hoy es no controlado y solo se limpia desde dentro):
   es una ampliación del componente genérico, no un retoque del listado.
2. **"Limpiar todo" no aparece con 1-2 caracteres escritos y nada más.** El botón se
   ofrece cuando hay al menos una clave en la selección (regla de la 144, R22), y por
   debajo del mínimo el buscador no pone clave. El campo se vacía con su propia X, así que
   R37 se cumple; pero si el humano espera ver "Limpiar todo" en cuanto haya *algo*
   escrito, eso es un cambio en la regla del orquestador que afecta a las dos superficies
   que lo montan.
3. **El término no se lleva a la URL** (decisión (g) de la 144, design §8.4): recargar
   `/ordenes` pierde la búsqueda igual que pierde el resto de filtros. Coherente, pero es
   lo primero que suele pedirse de un buscador ("mándame este enlace").
4. **`minChars` es del control, no del contrato**: el buscador de órdenes lo toma de
   `BUSQUEDA_MIN_CHARS`, pero otro consumidor de la 145 podría declarar `2` y su filtro
   emitiría términos que el borde rechaza. El componente es genérico a propósito
   (no conoce el borde de nadie); la disciplina es de quien declara.
5. **El texto de la UI está hardcodeado en español** ("Buscar", el placeholder, el aviso
   del mínimo, "Sin coincidencias"), como todo lo que dejó la 144. `avisoMinimoCaracteres`
   se exportó para que los tests no reescriban la cadena, lo que además deja UN punto por
   el que pasar cuando exista i18n. No se montó nada de i18n aquí: no hay infraestructura
   en el repo y no se inventa.
6. **R31 sigue sin cubrir y T4 sin hacer.** Ahora hay un camino completo desde el campo de
   texto hasta el `where`, que es lo que T4 necesitaba para medir de punta a punta.

---

## 17 · Veredicto (T3)

**T3.1-T3.6 completas: el buscador es el primer control de la barra de `/ordenes`, sale
del `kind: "text"` genérico que la 145 va a heredar, aplaza la consulta con el debounce que
ya existía —una por ráfaga—, calla por debajo de tres caracteres avisando de por qué, viaja
como escalar `q`, entra en la key de caché devolviendo el listado a la página 1, y con 0
resultados dice que no hay coincidencias con ESE texto. 64 tests nuevos en verde, un solo
test existente tocado (el censo de la barra) y las nueve suites vecinas intactas. R31
sigue siendo deuda de T4.**

---
---

# T4 + T5 — Medición y cierre (`backend_dev`, 2026-07-31)

> Alcance: **T4.1, T4.2, T5.1, T5.2, T5.3**. **T5.4 NO** (registro en `feature_list.json` e
> `history.md`: lo hace el leader tras el reviewer).
> Esta fase existe por el aviso expreso del humano — *«ten mucho cuidado con cómo lo
> construyes, no vaya a ser que sea lenta la búsqueda por una mala implementación de
> consultas»*—. Hasta aquí, R31 era una **promesa del diseño**. A partir de aquí es un
> **hecho medido**, con su letra pequeña escrita.
>
> **No se tocó una sola línea de `lib/`, `app/`, `components/` ni `db/`.** Lo entregado son
> un script de banco, un archivo de test nuevo, y dos ampliaciones de censo en tests
> existentes (§19.7).

---

## 18 · Archivos de esta fase

### Creados

| Archivo | Qué es |
| --- | --- |
| `scripts/bench-busqueda-ordenes.ts` | Banco de T4.1: siembra 50 000 órdenes, 5 escenarios + escalera de selectividad, `EXPLAIN (ANALYZE, BUFFERS)` del SQL real, E5 de escritura, y **limpieza garantizada** |
| `tests/integration/db/busqueda-usa-indice.test.ts` | T4.2: 10 casos de plan de ejecución contra Postgres real (R31) |

### Modificados

| Archivo | Cambio |
| --- | --- |
| `tests/integration/db/_postgres-real.ts` | `crearPrismaDeTestConEspia()` + `parametrosDe()`: capturan el SQL **que Prisma emite de verdad**, para poder hacerle `EXPLAIN` |
| `tests/unit/guards/busqueda-texto-solo-lectura.test.ts` | El censo de archivos que pueden nombrar la columna crece en **uno**: el banco (§19.7) |
| `specs/169-buscador-ordenes/tasks.md` | `[x]` de T4.1, T4.2, T5.1, T5.3; T5.2 marcada con el rojo ajeno |

---

## 19 · T4.1 — la medición

### 19.1 Cómo se repite, exactamente

```
pnpm exec tsx scripts/bench-busqueda-ordenes.ts                 # 50 000 filas, 10 reps
pnpm exec tsx scripts/bench-busqueda-ordenes.ts --filas=200000  # otro volumen
pnpm exec tsx scripts/bench-busqueda-ordenes.ts --solo-limpiar  # si algo quedó a medias
```

Tres cosas que el banco hace y que conviene saber antes de leer los números:

1. **Se niega a correr contra una base que no sea local** (`--forzar` lo salta, y hay que
   escribirlo a mano). Siembra 50 000 filas y *dropea y recrea* el índice: no es un script
   para apuntar a producción por descuido.
2. **Mide por el camino real.** No hay SQL escrito a mano en ninguna aserción: se instancia
   `OrdenService` con `OrdenRepository` + `OrdenHistorialService` reales (el mismo cableado
   de `lib/actions/ordenes.ts`) y se llama a `listar(...)` con el `filter.q` que produce la
   UI. El SQL que se explica es el que **Prisma emitió**, capturado del evento `query`.
3. **Limpia detrás, siempre** (bloque `finally`): repone columna e índice con el SQL
   **literal** de `migration.sql` leído del disco, borra las 50 000 filas por su marca
   (`num_remision LIKE 'BENCH169-%'`), `VACUUM (ANALYZE)` y **`REINDEX`**. Ese `REINDEX` no
   es adorno: un GIN **no encoge** al borrar filas. Sin él la base de desarrollo se quedaba
   con un índice de **16 MB sobre una tabla de 40 kB**. Estado final verificado:
   `67 filas, tabla = 40 kB, índice = 56 kB` — idéntico al de partida.

Entorno de la medición: `PostgreSQL 18.2 x86_64-windows (msvc)`, `shared_buffers=128MB`,
`work_mem=4MB`, `max_parallel_workers_per_gather=2`, todo en caché (`shared hit` en todos
los planes, cero `read`). **50 067 filas** (50 000 sembradas + las 67 de la base).
Tabla 26 MB, índice trigram 12 MB. `p50` = mediana; `p95` = **rango más cercano sobre 10
muestras, o sea el peor de los diez**. 3 repeticiones de calentamiento descartadas.

### 19.2 Los números

**Estado B — estacionario** (la `pending list` del GIN vaciada; es donde vive el sistema el
99 % del tiempo). **Estos son los números canónicos.** Milisegundos.

| Escenario | Coincidencias | findMany p50 | findMany p95 | count p50 | count p95 | total p50 | total p95 | Umbral | Veredicto |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| **E1** guía exacta (8 dígitos que existen) | 1 | 0,8 | 1,1 | 0,6 | 1,2 | **3,5** | **4,7** | p95 > 50 ms | **PASA** (11x de margen) |
| **E2** término selectivo `zuniga` | 61 | 1,0 | 1,2 | 0,7 | 0,9 | **5,2** | **8,6** | p95 > 300 ms | **PASA** (35x) |
| E2a escalera `kopper` (0,40 % de la tabla) | 199 | 1,2 | 1,7 | 1,0 | 1,3 | 5,1 | 8,1 | — | — |
| E2b escalera `lizano` (0,99 %) | 494 | 1,8 | 2,5 | 1,4 | 2,1 | 6,8 | 8,2 | — | — |
| E2c escalera `barquero` (2,10 %) | 1 051 | 3,1 | 4,6 | 2,3 | 2,9 | 7,7 | 10,9 | — | — |
| E2d escalera `trejos` (5,67 %) | 2 841 | 6,0 | 7,6 | 4,4 | 5,6 | 10,2 | 12,6 | — | — |
| **E3** término amplio `maria` (19,98 %) | 10 004 | 15,0 | 19,4 | 8,8 | 13,4 | **20,0** | **25,4** | p95 > 500 ms | **PASA** (20x) |
| **E4** E3 + estado + rango de 90 días | 115 | 3,3 | 4,7 | 3,4 | 4,0 | **7,8** | **11,2** | debe ser <= E3 | **PASA** (3x más barato) |

`total` es el **reloj de pared de `OrdenService.listar`**, no el de la consulta: incluye las
13 consultas que dispara una llamada real (el `findMany`, el `count`, las relaciones que
`include` carga por separado y el conteo de intentos de la feature 160). Se eligió el número
**pesimista** a propósito: si el umbral se cumple contra él, no hay discusión sobre qué se
midió. La búsqueda en sí es la columna `findMany`, y **en el peor escenario cuesta 19,4 ms**.

**Ningún umbral se supera. El plan B (conteo con tope, design §6) NO se activa.** Y conviene
dejar dicho por qué eso no es una casualidad afortunada: el conteo **no es** el coste
dominante en ningún escenario — es sistemáticamente **más barato** que la página (8,8 ms vs
15,0 en E3), porque no materializa 25 filas anchas ni ordena. Capar el `total` habría
recortado la mitad barata.

### 19.3 Las dos aserciones de PLAN — que es lo que cierra R31

Corridas por el banco sobre el SQL exacto de Prisma, con sus parámetros:

```
--- ASERCIONES DE PLAN (R31) ---
  OK   E1: Index Scan using orden_num_guia_key
  OK   E1: NO hay 'Seq Scan on orden'
  OK   E2: Bitmap Index Scan on orden_busqueda_texto_trgm_idx
  OK   E2: NO hay 'Seq Scan on orden'
  OK   E2a/E2b/E2c/E2d (escalera): Bitmap Index Scan, sin Seq Scan
  OK   E3: Bitmap Index Scan on orden_busqueda_texto_trgm_idx
  OK   E3: NO hay 'Seq Scan on orden'
  (info) E4: sin asercion de plan; Seq Scan presente = false

>>> TODAS LAS ASERCIONES DE PLAN PASAN. R31 verificado empiricamente.
```

**E1 — la ruta rápida usa el índice único, sin forzar nada:**

```
Limit  (cost=8.32..8.32 rows=1) (actual time=0.024..0.024 rows=1.00 loops=1)
  ->  Sort  Sort Key: prioridad DESC, created_at DESC
        ->  Index Scan using orden_num_guia_key on orden  (actual time=0.018..0.018 rows=1.00)
              Index Cond: (num_guia = 20025000)
              Filter: (deleted_at IS NULL)
              Buffers: shared hit=3
Execution Time: 0.043 ms
```

Tres buffers. La guía exacta sobre 50 067 filas cuesta **43 microsegundos**.

**E2 — término selectivo, bitmap sobre el trigram:**

```
Limit  (cost=2248.15..2248.22 rows=25) (actual time=0.211..0.213 rows=25.00)
  ->  Sort  Sort Method: top-N heapsort  Memory: 46kB
        ->  Bitmap Heap Scan on orden  (actual time=0.033..0.112 rows=61.00)
              Recheck Cond: (busqueda_texto ~~ '%zuniga%'::text)
              Filter: (deleted_at IS NULL)
              Heap Blocks: exact=61
              ->  Bitmap Index Scan on orden_busqueda_texto_trgm_idx  (actual time=0.020..0.020 rows=61.00)
                    Index Cond: (busqueda_texto ~~ '%zuniga%'::text)
                    Buffers: shared hit=9
Execution Time: 0.236 ms
```

**Nueve páginas de índice** para localizar 61 filas entre 50 067. Eso es exactamente lo que
el humano pidió que no fuera un recorrido de tabla.

**E3 — término que casa el 20 % de la tabla, y aun así por índice:**

```
->  Bitmap Heap Scan on orden  (actual time=1.328..9.656 rows=10004.00)
      Recheck Cond: (busqueda_texto ~~ '%maria%'::text)
      Heap Blocks: exact=3337
      ->  Bitmap Index Scan on orden_busqueda_texto_trgm_idx  (actual time=1.037..1.038 rows=10004.00)
            Buffers: shared hit=22
Execution Time: 15.056 ms
```

22 páginas de índice para resolver 10 004 coincidencias. El coste que queda (9,6 ms) es
leer las 3 337 páginas de heap donde viven esas filas: eso no lo evita ningún índice, y es
justo lo que el design §6 anticipó (`findMany` es `O(coincidencias)`).

**El SQL que Prisma emite** (pegado íntegro por el banco; aquí la parte que importa):

```sql
-- findMany
... FROM "public"."orden"
WHERE ("public"."orden"."deleted_at" IS NULL
       AND "public"."orden"."busqueda_texto"::text LIKE ('%' || $1 || '%'))
ORDER BY "public"."orden"."prioridad" DESC, "public"."orden"."created_at" DESC
LIMIT $2 OFFSET $3
-- params: ["zuniga","25","0"]

-- count (MISMO where, R15)
SELECT COUNT(*) AS "_count$_all" FROM (
  SELECT "public"."orden"."id" FROM "public"."orden"
  WHERE ("public"."orden"."deleted_at" IS NULL
         AND "public"."orden"."busqueda_texto"::text LIKE ('%' || $1 || '%'))
  OFFSET $2) AS "sub"
-- params: ["zuniga","0"]
```

Tres cosas verificadas aquí, no supuestas (design §4.3):

1. **`LIKE`, no `ILIKE`** (`~~`, no `~~*`): el `mode: "insensitive"` no se coló.
2. **No hay cláusula `ESCAPE`**, luego Postgres aplica su escape por defecto (`\`) — que es
   exactamente el que produce `escaparLike`. El supuesto del design queda confirmado contra
   el motor, y hay un caso de test que lo fija (`"100%_a\b"` → `"100\%\_a\\b"`).
3. El cast `::text` que Prisma añade sobre una columna que **ya es** `text` **no inhabilita
   el índice**: el plan lo demuestra.

### 19.4 EL HALLAZGO: la `pending list` del GIN, y por qué importa aquí más que en otro sitio

Un índice GIN se crea con `fastupdate = on` (el default). Eso significa que **las entradas
de las filas nuevas no se escriben en el árbol**: se apilan en una *pending list* que
**toda búsqueda tiene que recorrer entera** y que además **infla el coste que el
planificador le asigna al índice**, hasta que lo abandona.

Medido en el propio banco, **mismo corpus, mismo término, misma máquina**, lo único que
cambia es si la lista está vaciada:

| Escenario | Plan recién cargado | Plan estacionario | findMany p50 recién cargado | findMany p50 estacionario |
| --- | --- | --- | ---: | ---: |
| E2 (61 coincidencias) | Bitmap Index Scan | Bitmap Index Scan | 2,9 ms | **1,0 ms** |
| E2a (199) | Bitmap Index Scan | Bitmap Index Scan | 2,9 ms | **1,2 ms** |
| E2b (494) | Bitmap Index Scan | Bitmap Index Scan | 3,4 ms | **1,8 ms** |
| E2c (1 051) | Bitmap Index Scan | Bitmap Index Scan | 5,5 ms | **3,1 ms** |
| E2d (2 841) | **Seq Scan** | Bitmap Index Scan | 18,8 ms | **6,0 ms** |
| E3 (10 004) | **Seq Scan** | Bitmap Index Scan | 25,2 ms | **15,0 ms** |

En una corrida previa con el mismo script, con la lista aún más llena, el `Seq Scan`
empezaba ya en **E2c (2,1 % de la tabla)**: el punto exacto donde el planificador se rinde
**no es estable**, depende de cuánto haya vaciado `autovacuum`.

**Por qué esto no es un detalle de laboratorio:** el estado "recién cargado" es exactamente
el de `orden` **después de cada carga masiva de órdenes**, que es como entra la mayor parte
del volumen de este sistema. Durante esa ventana la búsqueda es **hasta 3x más lenta** y un
término poco selectivo **recorre la tabla**.

**Qué lo cierra, y su precio:** `SELECT gin_clean_pending_list('orden_busqueda_texto_trgm_idx')`
tardó **31 ms** sobre las 50 000 filas recién insertadas. `autovacuum` lo hace solo, sin
que nadie intervenga; la cuestión es *cuándo*. Opciones, por si el humano quiere cerrarlo:

- **No hacer nada** (lo que se entrega). Los números del estado A siguen estando 14x por
  debajo del umbral de E3 (25 ms de p50 frente a 500 ms), así que **nadie va a notarlo hoy**.
  Con la tabla 10x más grande, sí.
- **Vaciar la lista al final de cada carga masiva.** Una línea al terminar
  `createManyOrdenes`, 31 ms por lote. Es la opción quirúrgica, pero **es un cambio de
  diseño** (toca una ruta de escritura), no una decisión de esta fase.
- **`ALTER INDEX orden_busqueda_texto_trgm_idx SET (fastupdate = off)`.** Elimina la ventana
  entera a cambio de encarecer cada `INSERT`. Contraindicado por E5 (§19.6): el índice ya
  cuesta escritura, y `fastupdate` es precisamente lo que la amortiza.

**No se implementa ninguna por cuenta propia**: el design no lo contempla y el umbral que
habría obligado a actuar no se cruzó. Queda escrito con su número, que es lo que pedía la
regla de "si algún umbral se supera, dilo y no lo maquilles".

### 19.5 Por qué la escalera de selectividad existe, y qué contestó

El design pedía dos puntos: E2 (<100 coincidencias) y E3 (>5 000). Entre ellos está la única
pregunta accionable —*¿a partir de cuántas coincidencias deja Postgres de usar el índice?*—
y con dos puntos no se responde. El banco siembra cuatro tokens más con cardinalidades
controladas (módulos primos entre sí, para que no se solapen) y recorre 0,12 % → 0,40 % →
0,99 % → 2,10 % → 5,67 % → 19,98 %.

**Respuesta en el estado estacionario: no deja de usarlo en ningún punto**, ni siquiera
casando una de cada cinco filas de la tabla. El banco además contrasta cada plan con
`random_page_cost = 1.1` (SSD) por si el default de 4.0 estuviera falseando el resultado:
en estado estacionario da el **mismo plan**, así que la conclusión no depende de ese ajuste.

**Y esto es lo que obligó a que T4.2 no aserte la elección por coste.** Se escribió esa
versión del test y se borró, con evidencia: (i) un corpus recién insertado dentro de una
transacción deja el 100 % de las entradas en la pending list, y el planificador abandona el
índice (medido: 5 000 filas → `Seq Scan`; tras `gin_clean_pending_list()` → `Bitmap Index
Scan`; 16 000 filas, ídem); (ii) aunque se vacíe, cada corrida de la suite deja miles de
tuplas muertas, el índice **no encoge**, y el coste estimado sube con él — la versión por
coste **pasó la 1ª corrida y falló dos casos en la 2ª y la 3ª sin tocar una línea**. Un test
así es un generador de rojos falsos. La elección por coste se demuestra donde puede
demostrarse bien: aquí, sobre 50 000 filas y con el índice construido de una vez.

### 19.6 E5 — lo que cuesta escribir

200 órdenes por `createMany` (la sentencia exacta que ejecuta `createManyOrdenes` dentro de
su transacción), 20 repeticiones por brazo, cada inserción **dentro de una transacción que se
revierte** — el trabajo de escritura, mantenimiento del GIN incluido, se hace de verdad y se
mide; no queda ni una fila.

| Brazo | p50 (ms) | p95 (ms) | Δ p50 vs pre-169 |
| --- | ---: | ---: | ---: |
| con columna + índice GIN | 67,0 | 94,5 | **+15,1 %** |
| con columna, SIN índice | 62,7 | 99,4 | +7,8 % |
| SIN columna ni índice (estado pre-169) | 58,2 | 76,8 | 0 % |
| con columna + índice (**control**, tras restaurar) | 66,7 | 73,3 | +14,6 % |

**Umbral del design: +20 %. Medido: +15,1 %, y el brazo de control lo confirma en +14,6 %.**
**No se dispara la revisión**, pero el número queda escrito porque el margen no es holgado:
un lote de 200 órdenes pasa de 58 a 67 ms.

Atribución, que es lo que permite decidir si algún día hay que tocarlo: de esos ~9 ms,
**algo más de la mitad (+7,8 pp) es la columna generada** —recalcular cinco `coalesce`, dos
`regexp_replace`, un `translate` y un `lower` por fila— y **el resto (+7,3 pp) es el índice
GIN**. Apagar `fastupdate` (§19.4) atacaría justo el trozo que ya está amortizado.

El brazo de control existe para que la tabla no sea una ilusión de orden: se repite el primer
brazo **después** de dropear y restaurar todo, y sale igual. Si saliera muy distinto, la
medición sería ruido y habría que decirlo.

**Coste de APLICAR la migración, cronometrado sobre esta misma tabla de 50 067 filas:**
`ADD COLUMN ... GENERATED ... STORED` = **2,80 s** (reescribe la tabla entera, `ACCESS
EXCLUSIVE`), `CREATE INDEX ... USING gin` = **0,49 s** (`SHARE`, bloquea escrituras). Es el
dato que le faltaba a la nota de despliegue: **~3,3 s de bloqueo por cada 50 000 filas**, y
escala aproximadamente lineal. Ver §22.

### 19.7 El censo que hubo que ampliar

`tests/unit/guards/busqueda-texto-solo-lectura.test.ts` prohíbe que ningún archivo de
`lib/`, `app/`, `components/`, `hooks/` o `scripts/` nombre `busqueda_texto` salvo los cuatro
autorizados. El banco lo rompía, y **hacía bien en romperse**: es la señal que ese test
existe para dar. Se añadió `scripts/bench-busqueda-ordenes.ts` a la lista **con su
justificación escrita**, porque nombrar la columna es literalmente su trabajo (E5 la dropea y
la repone con el SQL literal de `migration.sql`) y porque
`pg_relation_size('orden_busqueda_texto_trgm_idx')` la nombra por inevitabilidad — el nombre
del índice contiene el de la columna. **Las reglas del guardia no se tocaron**: los tres
casos que prohíben `data:`, verbos de escritura y `select:` siguen aplicándose sobre ese
archivo, y pasan.

Es el mismo patrón que el backend usó con `orden-filter-144.test.ts` (§6) y el frontend con
`ordenes-filtros-def.test.ts` (§12.5): **crece la lista de nombres, no la regla**.

---

## 20 · T5.1 — Mapa `R<n> → test` COMPLETO

> **Sobre el número de requisitos:** el spec tiene **42** (`R1`-`R42` en `requirements.md`),
> no 54. Los 42 están cubiertos. No hay ninguno sin test y no se ha inventado ninguna fila:
> las de R1-R30 son las que escribió el backend (§5), las de R32-R42 las del frontend (§13),
> y R31 es lo nuevo de esta fase. Se verificó **mecánicamente** que cada `R<n>` aparece en el
> título de al menos un caso de los 18 archivos de test de la feature.

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
| R7 | `100% encuentra SOLO la orden que dice 100%` / `un % suelto no devuelve el listado entero` / `1_0 no encuentra 100` | `tests/integration/db/busqueda-comportamiento.test.ts` |
| R7 | bloque `escape de comodines de LIKE (R7)` (5 casos) | `tests/unit/repositories/orden-repository-busqueda.test.ts` |
| R7 | `los comodines del termino llegan ESCAPADOS al patron (R7)` — sobre el SQL REAL emitido | `tests/integration/db/busqueda-usa-indice.test.ts` |
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
| R14 | `R14: el termino se COMBINA con el resto de filtros, sin anularlos` | `tests/unit/components/ordenes-listado-buscador.test.tsx` |
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
| R29 | bloque `DOWN — revierte en orden INVERSO y es idempotente (R29)` (5 casos) + el round-trip real de §3.1 | `tests/integration/db/orden-busqueda-trgm-migration.test.ts` |
| R30 | bloque `carpeta y schema.prisma (R30)` (5 casos) + el diff vacío real de §3.2 | `tests/integration/db/orden-busqueda-trgm-migration.test.ts` |
| **R31** | bloque `el indice trigram SIRVE para la consulta REAL del listado (R31)` (3 casos: `findMany` por índice, `count` por el MISMO índice, y el índice devuelve **las mismas filas** que el recorrido) + bloque `ruta rapida por numero de guia` (2 casos, **sin forzar nada**) + bloque `forma de la consulta emitida` (3 casos) + `es un GIN sobre busqueda_texto con el opclass de trigramas` | `tests/integration/db/busqueda-usa-indice.test.ts` |
| **R31** | **La elección por coste, medida:** §19.2 (números), §19.3 (planes reales sobre 50 000 filas: las dos aserciones del design §6, en verde) | `scripts/bench-busqueda-ordenes.ts` |
| R32 | `R32: el PRIMER filtro declarado es el de busqueda` (+3 casos) | `tests/unit/components/ordenes-buscador-declaracion.test.ts` |
| R32 | `R32: precede a TODOS los demas controles de la barra, el de estado incluido` (DOM real) | `tests/unit/components/ordenes-listado-buscador.test.tsx` |
| R33 | `R33: es GENERICO — funciona con una clave y una etiqueta que no son de dominio` + `R33: no obtiene datos por si mismo` | `tests/unit/components/filter-component-texto.test.tsx` |
| R33 | `R33: se declara sobre el tipo generico text, con su etiqueta visible` | `tests/unit/components/ordenes-buscador-declaracion.test.ts` |
| R34 | `R34: una rafaga de DIEZ pulsaciones produce UNA sola emision` (+2 casos) | `tests/unit/components/filter-component-texto.test.tsx` |
| R34 | `R34: teclear un termino lo envia como ESCALAR q, en una sola consulta` | `tests/unit/components/ordenes-listado-buscador.test.tsx` |
| R35 | `R35: por debajo del minimo NO emite nada` (+4 casos) | `tests/unit/components/filter-component-texto.test.tsx` |
| R35 | `R35: por debajo del minimo no se consulta nada y se avisa del minimo` | `tests/unit/components/ordenes-listado-buscador.test.tsx` |
| R36 | `R36: vaciar el campo emite la seleccion SIN la clave` (+2 casos) | `tests/unit/components/filter-component-texto.test.tsx` |
| R36 | `R36: ["juan perez"] -> q: "juan perez", no una lista` (+3 casos) | `tests/unit/components/ordenes-buscador-declaracion.test.ts` |
| R36 | `R36: vaciar el campo devuelve el listado a la consulta SIN busqueda` | `tests/unit/components/ordenes-listado-buscador.test.tsx` |
| R37 | `R37: se limpia individualmente con su propia accion, sin tocar a los demas` (+3 casos) | `tests/unit/components/filter-component-texto.test.tsx` |
| R37 | `R37: Limpiar todo vacia tambien el buscador y su clave sale de la consulta` | `tests/unit/components/ordenes-listado-buscador.test.tsx` |
| R38 | `R38: cambiar el termino vuelve a la PAGINA 1` (+2 casos) | `tests/unit/components/ordenes-module-busqueda.test.tsx` |
| R39 | bloque `serializarFiltro — el termino entra en la key de cache (R39)` (4 casos) + 2 casos de render | `tests/unit/components/ordenes-module-busqueda.test.tsx` |
| R40 | bloque `vacio CON busqueda activa (R40)` (5 casos) | `tests/unit/components/ordenes-module-busqueda.test.tsx` |
| R41 | `R41: se monta como campo de busqueda con nombre accesible propio y su placeholder` + `R41: el aviso es una region status a la que el campo APUNTA (aria-describedby)` | `tests/unit/components/filter-component-texto.test.tsx` |
| R42 | `R42: una barra sin kind text no monta ningun campo de busqueda ni aviso` | `tests/unit/components/filter-component-texto.test.tsx` |
| R42 | Las nueve suites vecinas **sin modificar** y en verde (145 tests) | §14 |

**Ningún requisito queda sin test.** Dicho lo cual, dos matices que el reviewer debe leer y
no dar por buenos sin mirarlos, porque son los únicos sitios donde "cubierto" significa algo
menos que "demostrado del todo":

1. **R31** — el test (T4.2) demuestra que el índice **sirve** para la consulta emitida; que
   el planificador lo **elige** se demuestra en el banco (T4.1), no en la suite. El porqué de
   ese reparto está en §19.5 y en la cabecera del propio test, con las mediciones que lo
   obligan.
2. **R42** ("ninguna otra superficie cambia") se apoya en parte en *ausencia* de cambios
   (`git diff` vacío en nueve suites vecinas), que es evidencia legítima pero no un test.

---

## 21 · T5.2 — Puertas del arnés, salida REAL

```
$ pnpm run typecheck
> tsc --noEmit
(sin salida: 0 errores)

$ pnpm run lint
✖ 20 problems (0 errors, 20 warnings)
  (las MISMAS 20 warnings del baseline: `_input`/`_actor`/`_args`/`_items`…)

$ pnpm test
 Test Files  1 failed | 680 passed (681)
      Tests  1 failed | 8306 passed (8307)
   Duration  270.07s

 FAIL  tests/components/Modal.test.tsx > Modal — accesibilidad de foco (R28, R29, R30)
       > R30: atrapa el foco con Tab dentro del diálogo (envuelve al primer enfocable)
 AssertionError: expected false to be true
   tests/components/Modal.test.tsx:522  expect(dialog.contains(document.activeElement)).toBe(true)
```

### El rojo NO es de esta feature, y está comprobado

- **Delta correcto sobre el baseline de T3** (680 archivos / 8297 tests): esta fase añade
  **1 archivo y 10 tests** → 681 / 8307. Cuadra exactamente.
- **Reproducido en `HEAD` sin nada de esta fase.** Se guardó todo el trabajo con
  `git stash push -u`, se corrió `tests/components/Modal.test.tsx` sobre el árbol limpio y
  **falló igual**; después `git stash pop`. No es una regresión de T4/T5.
- **Falla de forma determinista, 4 de 4 corridas en aislado**, así que tampoco es
  intermitencia de la suite completa.
- **Ninguno de los dos commits de la feature 169 toca `components/shared/Modal.tsx` ni nada
  de lo que ese test importa** (`git show --stat d8d505bd` y `579f6fad`): el test solo
  importa `@/components/shared/Modal`.

**No se toca.** Es un test de la capa de componentes y esto es la fase de backend; "arreglar"
un foco de jsdom desde aquí sería exactamente el tipo de cambio silencioso que este arnés
prohíbe. **Queda escalado al leader**: la feature 169 no puede declararse `done` con la suite
en rojo, y ese rojo es de otro.

```
$ ./init.sh
✗ cae en el paso `test`, por ese mismo caso de Modal.
  typecheck y lint pasan; todas las migraciones tienen down.sql; .env presente.
```

### El archivo nuevo, en aislado

```
$ pnpm exec vitest run tests/integration/db/busqueda-usa-indice.test.ts
 Test Files  1 passed (1)
      Tests  10 passed (10)
   Duration  ~1.8s
```

Corrido **6 veces seguidas** buscando intermitencia: 6 de 6 en verde (§19.5 explica lo que
hubo que quitarle para conseguirlo).

---

## 22 · T5.3 — Despliegue y reversión

### Orden, y por qué

- **DESPLEGAR: MIGRACIÓN PRIMERO, CÓDIGO DESPUÉS.** El código construye un `where` sobre
  `busqueda_texto`; con el código desplegado y sin la columna, **toda consulta con término
  revienta** (y `/ordenes` con ella, porque el buscador ya está en la barra). Al revés no
  pasa nada: la migración sin el código nuevo solo añade una columna que nadie lee.
- **REVERTIR: CÓDIGO PRIMERO, MIGRACIÓN DESPUÉS.** Mismo motivo, en espejo. El `down.sql`
  solo revierte la base; si se ejecuta con el código nuevo todavía vivo, el listado queda
  roto entre un paso y el otro.
- En Vercel el `build` corre `scripts/migrate-deploy.ts` **antes** de `next build`, así que
  el orden de despliegue **ya lo garantiza el pipeline**. Lo que no garantiza nadie es el
  orden de reversión: eso es manual y por eso está escrito aquí.

### Comprobaciones OBLIGATORIAS antes de aplicar, en CADA base (preview y producción)

**T0.1 y T0.2 siguen PARCIALES** y esta sesión tampoco pudo cerrarlas: el `DATABASE_URL` de
producción está marcado *sensitive* en Vercel y el MCP de Supabase no está autenticado aquí.
Lo que sigue es el procedimiento exacto, con sus umbrales. **No es opcional: es lo que T0
no pudo verificar.**

```sql
-- (a) T0.1 — ¿cuántas filas hay que reescribir?
SELECT count(*) FROM orden;

-- (b) T0.2 — ¿existe pg_trgm y en qué esquema?
SELECT e.extname, n.nspname
FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
WHERE e.extname = 'pg_trgm';

-- (c) NUEVA, la añade T4.1 — ¿cómo cree el planificador que es el disco?
SHOW random_page_cost;
```

| Consulta | Respuesta | Qué hacer |
| --- | --- | --- |
| **(a)** | **<= 200 000 filas** | Aplicar en caliente. Cronometrado sobre 50 067 filas: `ADD COLUMN GENERATED` **2,80 s** + `CREATE INDEX GIN` **0,49 s** ⇒ **~3,3 s** de bloqueo, escala ~lineal (≈6,6 s a 100 k, ≈13 s a 200 k). Durante el `ADD COLUMN`, `orden` no admite **ni lecturas ni escrituras** (`ACCESS EXCLUSIVE`). |
| **(a)** | **> 200 000 filas** | **Ventana de mantenimiento**, con la ingesta masiva parada, y avisar al humano antes (design §2.2). No se puede usar `CONCURRENTLY`: Prisma envuelve cada migración en una transacción. |
| **(b)** | vacío | Nada que hacer: la migración crea la extensión en `extensions`. |
| **(b)** | `pg_trgm` en `extensions` | Nada que hacer. |
| **(b)** | `pg_trgm` en **otro esquema** | `ALTER EXTENSION pg_trgm SET SCHEMA extensions;` **ANTES** de aplicar. Si no, la migración **falla en voz alta** al no resolver `extensions.gin_trgm_ops` — fallo deliberado (design §2.3): la alternativa sería un índice creado en una base y ausente en otra, con la búsqueda lenta solo en producción y sin ninguna señal. |
| **(c)** | **<= 1.1** (lo normal en SSD) | Ideal. Medido: con 1.1 el planificador elige el índice en **todos** los escenarios. |
| **(c)** | **4.0** (el default) | Aceptable: en estado estacionario el plan es el mismo (§19.5). Pero es el valor que menos favorece al índice, así que **anotar el número** y releer §19.4 si alguien reporta lentitud tras una carga masiva. |

### Después de aplicar, en cada base: verificación de que el índice quedó VIVO

```sql
-- 1) La columna es GENERADA (no un `text` normal que alguien tendrá que rellenar a mano)
SELECT column_name, is_generated FROM information_schema.columns
WHERE table_name = 'orden' AND column_name = 'busqueda_texto';   -- espera: ALWAYS

-- 2) El índice existe y es GIN con el opclass de trigramas
SELECT indexdef FROM pg_indexes WHERE indexname = 'orden_busqueda_texto_trgm_idx';
-- espera: ... USING gin (busqueda_texto extensions.gin_trgm_ops)

-- 3) Y de verdad se usa (sustituye <termino> por un apellido que exista en esa base)
EXPLAIN SELECT id FROM orden
WHERE deleted_at IS NULL AND busqueda_texto LIKE '%<termino>%';
-- espera: Bitmap Index Scan on orden_busqueda_texto_trgm_idx
```

**El paso 3 es el que importa** y es el único que no puede darse por hecho: (1) y (2) los
garantiza la migración; que el planificador lo *use* depende del tamaño de la tabla y de
`random_page_cost`. Si sale `Seq Scan` **con una tabla grande y un término selectivo**, hay
un problema real — y lo primero que hay que mirar es la `pending list` (§19.4):
`SELECT gin_clean_pending_list('orden_busqueda_texto_trgm_idx');` y repetir el `EXPLAIN`.

### Reversión

```
1. Revertir el DESPLIEGUE de código (Vercel: promover el deployment anterior).
2. Solo entonces:  pnpm run db:rollback
   -> DROP INDEX IF EXISTS "orden_busqueda_texto_trgm_idx";
      ALTER TABLE "orden" DROP COLUMN IF EXISTS "busqueda_texto";
   Es idempotente (ejecutarlo dos veces no falla, demostrado en §3.1) y NO toca la
   extensión ni el esquema `extensions` (design §2.4).
3. El `DROP COLUMN` es instantáneo (Postgres solo marca la columna); el espacio lo
   recupera el siguiente VACUUM. El índice GIN sí se libera al dropearlo.
```

---

## 23 · Preguntas abiertas y deuda que deja esta fase

1. **T0.1 y T0.2 siguen PARCIALES**, y con ellas **P2 y P4**. No es deuda de código: es el
   procedimiento de despliegue de §22, que alguien con acceso a preview y producción tiene
   que ejecutar. Esta sesión no tuvo ese acceso y no se inventó ningún número.
2. **P1 sigue abierta** (¿existen `num_guia` de 1-2 dígitos?). Sin cambios respecto a §9.1.
3. **La `pending list` del GIN tras una carga masiva** (§19.4): medida, cuantificada, con
   tres opciones escritas y **ninguna implementada**, porque ningún umbral del design la
   obligaba y las tres tocan diseño. Es la deuda más relevante que deja la feature.
4. **E5 está en +15,1 % con un umbral de +20 %** (§19.6). Pasa, pero sin holgura: si algún
   día se añade otro índice a `orden`, este número hay que volver a medirlo.
5. **El rojo de `tests/components/Modal.test.tsx`** (§21) bloquea `./init.sh` y no es de
   esta feature. Necesita dueño.
6. **El banco no mide concurrencia.** Todo se midió con una sola sesión. Lo que pasa cuando
   veinte operadores teclean a la vez —contención del pool de `pg` (`DB_POOL_MAX=3` por
   instancia), no de la consulta— no está medido y sigue siendo desconocido.
7. **Todo se midió con la tabla en caché** (`shared hit` en el 100 % de los planes, cero
   `read`). En una base con más datos que RAM, el `Bitmap Heap Scan` de un término amplio
   pagaría I/O real y los números de E3 subirían. Los de E1/E2 —que tocan 3 y 70 páginas—
   no cambiarían de forma apreciable.

---

## 24 · Veredicto (T4 + T5)

**R31 deja de ser una promesa: está medido.** Sobre 50 000 órdenes y por el camino completo
que recorre el usuario, la guía exacta se resuelve en **43 µs con tres páginas de índice**
(`Index Scan using orden_num_guia_key`), un término selectivo en **0,24 ms con nueve
páginas** (`Bitmap Index Scan on orden_busqueda_texto_trgm_idx`), y hasta un término que casa
**una de cada cinco filas de la tabla sigue yendo por el índice** y cuesta 19,4 ms p95 —
**veinte veces por debajo** del umbral que habría obligado al plan B. Las dos aserciones de
plan del design §6 pasan, el `count` no es el coste dominante en ningún escenario, y **el
plan B no se activa**. La escritura sube **+15,1 %** por lote de 200 órdenes, dentro del
+20 % admitido, con la atribución medida (la mitad es la columna generada, la otra mitad el
GIN). Se declara un hallazgo que el design no anticipaba y que esta tabla sufre en cada carga
masiva: **mientras la `pending list` del GIN no se vacía, la búsqueda es hasta 3x más lenta y
un término amplio recorre la tabla**; queda escrito con sus números, sus tres remedios y
ninguna decisión tomada por cuenta propia. Los **42** requisitos tienen test. Puertas:
`typecheck` y `lint` en verde; **la suite tiene un único rojo, en `Modal.test.tsx`,
reproducido en `HEAD` con este trabajo guardado en `stash` y ajeno a la feature.**
