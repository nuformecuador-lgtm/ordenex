# impl — Feature 169 · Buscador de texto en el listado de órdenes (T0 + T1 + T2 + T3)

> Rama `feature/169-buscador-ordenes` · worktree `.claude/worktrees/lote-135` · 2026-07-31
> Alcance de esta bitácora: **T0, T1 y T2** (§1-§10, `backend_dev`) y **T3** (§11-§17,
> `frontend_dev`). **T4 (medición) sigue SIN hacer**: vuelve a backend ahora que la UI
> existe. **R31 sigue sin cubrir.**
>
> Los párrafos de §1-§10 se conservan **tal como los escribió el backend**, incluido
> "ninguna superficie lo envía": era cierto al cerrar T2. Desde T3 (§11) `/ordenes` sí lo
> envía.

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
