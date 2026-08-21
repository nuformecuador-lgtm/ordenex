# Feature 257 — Bitácora de implementación

`GET /api/ordenes/api-key` gana cuatro filtros OPCIONALES —`desde`, `hasta`, `num_guia` y
`num_remision`— combinables entre sí y con `estado`, que siempre ACOTAN dentro del owner.

Rama: `feature/257-api-key-filtros-listado`, worktree `C:/w257`, nacida de `origin/dev` (`8070b508`).
Spec: `specs/257-api-key-filtros-listado/` (requirements R1–R26, design, tasks T0–T14).

## T0 — Baseline (medido por el LEADER, no por el implementer)

Medido sobre `C:/w257` en el commit de arranque `8070b508`, **antes** de tocar nada:

- `pnpm typecheck` — **verde**, sin errores.
- `pnpm exec vitest run tests/unit/api tests/integration/api tests/unit/services/api-orden-lectura-service.test.ts`
  — **20 archivos, 197 tests, 197 passed, 0 rojos** (5,66 s).

Consecuencia asumida durante toda la implementación: **la superficie tocada arranca en verde**, así
que cualquier rojo dentro de esos 20 archivos es de esta feature y no se descarta como flake ni
como deuda preexistente de `dev`.

## T11 — DESCARTADO por el humano

El índice compuesto `(tienda_id, created_at)` queda fuera: *"aprobado, sin el índice compuesto"*
(2026-08-21). **No hay migración y no se tocó `db/schema.prisma`.** Consecuencia directa: el gate de
esta feature es `./init.sh --rapido`, incluido para abrir el PR.

## Archivos tocados

### Producción (7)

| Archivo | Cambio |
| --- | --- |
| `lib/interfaces/services/IApiOrdenLecturaService.ts` | `ApiOrdenListarParams` gana `desde?`, `hasta?`, `numGuia?`, `numRemision?` (T1) |
| `lib/interfaces/repositories/IOrdenRepository.ts` | firma de `listByOwner` + `createdAtDesde?: Date`, `createdAtHasta?: Date`, `numGuia?`, `numRemision?` (T2) |
| `lib/repositories/OrdenRepository.ts` | `where` de `listByOwner`: `createdAt: { gte, lt }`, `numGuia`, `numRemision` (T3) |
| `lib/services/ApiOrdenLecturaService.ts` | fecha calendario CR a instantes UTC con `inicioDelDiaCREnUtc` / `inicioDelDiaSiguienteCREnUtc` (T4) |
| `app/api/ordenes/api-key/route.ts` | lectura clave por clave + `listadoQuerySchema` ampliado + `superRefine` de `desde <= hasta` (T5) |
| `lib/api/openapi-spec.ts` | 4 parámetros con `example` + línea en la `description` (T12) |
| `docs/api/api-key-openapi.yaml` | espejo textual de lo anterior (T12) |

### Tests (5 archivos nuevos, 61 tests)

| Archivo | Task | Tests |
| --- | --- | --- |
| `tests/unit/services/api-orden-lectura-service.filtros-257.test.ts` | T6 | 8 |
| `tests/unit/repositories/orden-repository.listado-filtros-257.test.ts` | T7 | 8 |
| `tests/integration/api/ordenes-api-key-listado-filtros.route.test.ts` | T8 | 32 (incluye 4 bloques `it.each`) |
| `tests/integration/api/ordenes-api-key-filtros-scope-ajeno.route.test.ts` | T9 | 5 |
| `tests/unit/api/openapi-257-filtros-listado.test.ts` | T10 | 8 |

### Spec

- `specs/257-api-key-filtros-listado/tasks.md` — T0 a T10, T12 y T13 marcadas `[x]`; T11 sigue `[~]`
  (descartada); T14 la cierra el leader con el gate y el PR.

## Las tres trampas del design, verificadas en el árbol

1. **La ventana horaria (design §8.2).** El service usa `inicioDelDiaCREnUtc` /
   `inicioDelDiaSiguienteCREnUtc`, que dejan ambos bordes en `...T06:00:00.000Z` (00:00 hora de
   pared de CR, UTC-6). `startOfDayCR` **no se importa ni se usa**: contra una columna `timestamp`
   como `orden.created_at` produciría la ventana 18:00–18:00 CR (el off-by-one de la ficha 166).
   Un grep de `startOfDayCR` sobre `lib/services/ApiOrdenLecturaService.ts` devuelve **una sola
   línea, y es un comentario** que documenta por qué NO se usa: ni importación ni llamada.
2. **La cota superior es `lt`, nunca `lte`.** Un grep de `lte` dentro de `listByOwner` devuelve
   **una sola línea, y es el comentario** que lo prohíbe. T7 lo congela con un
   `expect(where.createdAt).not.toHaveProperty("lte")`.
3. **El owner no se puede pisar.** `tiendaId: params.ownerId` y `deletedAt: null` se escriben
   PRIMERO y de forma INCONDICIONAL, antes de todos los spreads condicionales. Los filtros llegan al
   repo como escalares tipados (`Date`, `number`, `string`), **jamás como fragmento de
   `WhereInput`**. T7 incluye un caso que cuela una clave `tiendaId` ajena por los parámetros y
   afirma que el `where` no cambia.

Además: **no hay `findUnique` + comprobar dueño después**. Guía y remisión ajenas se resuelven en un
único `where` (`tienda_id = owner AND num_guia = X`), así que la respuesta es idéntica a la de un
número inexistente: sin fila ajena en memoria y sin diferencia de latencia observable (design §4.1).
T9 lo afirma comparando los dos bodies en un solo `expect(...).toEqual(...)`.

Y el patrón clave por clave del borde sobrevive: un grep de `Object.fromEntries` en la ruta devuelve
**una sola línea, y es el comentario** que explica por qué no se usa (106/R8, R2).

## Mapa de trazabilidad `R<n>` → test

Los 26 requisitos de `requirements.md`, cada uno con archivo y nombre literal del `it(...)`.

| R | Archivo de test | `it(...)` |
| --- | --- | --- |
| R1 | `tests/integration/api/ordenes-api-key-listado-filtros.route.test.ts` | `R1: sin ninguno de los cuatro filtros nuevos -> misma pagina y mismos params que antes de 257` |
| R2 | `tests/integration/api/ordenes-api-key-listado-filtros.route.test.ts` | `R2: tiendaId/owner/ownerId en la query se ignoran, sin error y sin efecto en los params` |
| R3 | `tests/integration/api/ordenes-api-key-listado-filtros.route.test.ts` | `R3: query invalida SIN Bearer -> 401, no 422, y sin llamar al service` · `R3: query invalida con key de usuario inactivo -> 403, no 422, y sin llamar al service` |
| R4 | `tests/integration/api/ordenes-api-key-listado-filtros.route.test.ts` | `R4: desde/hasta en YYYY-MM-DD llegan al service como las cadenas literales` · `R4: desde y hasta son independientes (solo desde, solo hasta)` |
| R5 | `tests/unit/services/api-orden-lectura-service.filtros-257.test.ts` | `R5/R6/R7: desde=2026-08-01&hasta=2026-08-21 -> [2026-08-01T06:00:00.000Z, 2026-08-22T06:00:00.000Z)` |
| R6 | `tests/unit/services/api-orden-lectura-service.filtros-257.test.ts` | `R5/R6/R7: desde=2026-08-01&hasta=2026-08-21 -> [2026-08-01T06:00:00.000Z, 2026-08-22T06:00:00.000Z)` |
| R7 | `tests/unit/services/api-orden-lectura-service.filtros-257.test.ts` | `R7: una orden a las 00:30 de CR cae DENTRO de la ventana y una de las 19:00 del dia anterior cae FUERA` |
| R8 | `tests/unit/services/api-orden-lectura-service.filtros-257.test.ts` | `R8: desde=hasta=2026-08-10 cubre las 24 horas completas de ese dia en Costa Rica` |
| R9 | `tests/unit/services/api-orden-lectura-service.filtros-257.test.ts` | ``R9: solo `desde` aplica unicamente la cota inferior (la superior queda sin definir)`` · ``R9: solo `hasta` aplica unicamente la cota superior (la inferior queda sin definir)`` |
| R10 | `tests/integration/api/ordenes-api-key-listado-filtros.route.test.ts` | `R10: formato invalido %s -> 422 VALIDATION_ERROR con fieldErrors sobre %s y sin consultar` (`it.each`, 8 casos: `22/07/2026`, `2026-07-22T00:00:00Z`, `hoy` y cadena vacía, por `desde` y por `hasta`) |
| R11 | `tests/integration/api/ordenes-api-key-listado-filtros.route.test.ts` | `R11: dia inexistente %s -> 422 y NO rueda al mes siguiente` (`it.each`, 4 casos: `2026-02-31` y `2026-13-01` en ambos campos) |
| R12 | `tests/integration/api/ordenes-api-key-listado-filtros.route.test.ts` | `R12: desde posterior a hasta -> 422 con fieldErrors.hasta (no fieldErrors.desde)` · `R12: desde igual a hasta es valido (el dia completo, no un rango invertido)` |
| R13 | `tests/integration/api/ordenes-api-key-listado-filtros.route.test.ts` | `R13: num_guia=100234 -> 200 y el service recibe numGuia numerico` |
| R14 | `tests/integration/api/ordenes-api-key-listado-filtros.route.test.ts` | `R14: num_guia invalido %s (%s) -> 422 con fieldErrors.num_guia y sin consultar` (`it.each`, 5 casos: `abc`, `12.5`, `0`, `-3`, cadena vacía) |
| R15 | `tests/unit/repositories/orden-repository.listado-filtros-257.test.ts` | ``R15: `numGuia` se emite como igualdad estricta, y eso ya excluye las ordenes sin guia`` |
| R16 | `tests/integration/api/ordenes-api-key-listado-filtros.route.test.ts` | `R16: num_remision=REM-0001 -> 200 y el service lo recibe EXACTO` · `R16: el borde no baja a minusculas ni recorta el valor (solo trim de espacios de borde)` |
| R17 | `tests/integration/api/ordenes-api-key-listado-filtros.route.test.ts` | `R17: num_remision %s (%s) -> 422 con fieldErrors.num_remision` (`it.each`, 2 casos: cadena vacía y solo espacios) |
| R18 | `tests/unit/repositories/orden-repository.listado-filtros-257.test.ts` | `R18/R20/R23: los cuatro filtros nuevos + estado conviven en AND y el owner sigue intacto` |
| R19 | `tests/integration/api/ordenes-api-key-listado-filtros.route.test.ts` | `R19: combinacion sin resultados -> 200 con items vacios y total 0, nunca 404 ni 422` · `R19: los cinco filtros (estado + desde + hasta + num_guia + num_remision) llegan en la MISMA llamada` |
| R20 | `tests/unit/repositories/orden-repository.listado-filtros-257.test.ts` | ``R20: un `tiendaId` ajeno colado por los parametros NO altera el `where` `` |
| R21 | `tests/integration/api/ordenes-api-key-filtros-scope-ajeno.route.test.ts` | `R21: la respuesta de un num_guia AJENO es identica a la de uno INEXISTENTE` · `R21: num_guia que existe pero es de OTRA tienda -> 200 con items vacios y total 0` |
| R22 | `tests/integration/api/ordenes-api-key-filtros-scope-ajeno.route.test.ts` | `R22: la respuesta de un num_remision AJENO es identica a la de uno INEXISTENTE` · `R22: num_remision que existe pero es de OTRA tienda -> 200 con items vacios y total 0` |
| R23 | `tests/unit/repositories/orden-repository.listado-filtros-257.test.ts` | `R18/R20/R23: los cuatro filtros nuevos + estado conviven en AND y el owner sigue intacto` |
| R24 | `tests/unit/repositories/orden-repository.listado-filtros-257.test.ts` | ``R24: el orden es `createdAt desc` y `skip`/`take` son los recibidos, sobre el conjunto ya filtrado`` |
| R25 | `tests/unit/repositories/orden-repository.listado-filtros-257.test.ts` | ``R25: el `where` del `count` es el MISMO objeto que el del `findMany` (identidad, no copia)`` |
| R26 | `tests/unit/api/openapi-257-filtros-listado.test.ts` | `R26: el objeto TS declara los cuatro parámetros nuevos como query opcionales, con descripción y ejemplo` · más 7 `it` hermanos que empiezan por `R26:` (tipo/formato, aditividad de `limit`/`offset`/`estado`, el YAML espejo dentro del bloque correcto, descripciones palabra por palabra, la nota de página vacía en vez de 404 y la de `hasta` inclusivo en hora de CR) |

**Ningún `R<n>` de `requirements.md` queda sin fila.**

Tests que no estrenan un requisito pero refuerzan la invariante, anotados para el reviewer:
``R1: sin `desde` ni `hasta` el repo no recibe ninguna cota de fecha`` y
`R20: el owner que llega al repo es SIEMPRE actor.usuarioId, aunque la peticion traiga filtros` (T6);
``R1: sin ningun filtro nuevo el `where` es EXACTAMENTE el de siempre`` y
``R18: la cota superior de la ventana usa `lt`, NUNCA `lte` `` (T7);
`R21/R22: combinar guia ajena con remision ajena tampoco filtra nada (200, no 404)` (T9).

## Salida real de los tests

Verificación acotada a la superficie del baseline. La suite entera NO se corrió aquí a propósito:
el gate lo ejecuta el leader, y una corrida larga sin emitir nada rompe el stream de los subagentes
(la lección de la feature 172, con cinco agentes muertos).

`pnpm typecheck`:

```
> ordenex@0.1.0 typecheck C:\w257
> tsc --noEmit
```

Sin errores (exit 0).

`pnpm lint`:

```
✖ 99 problems (0 errors, 99 warnings)
```

**0 errores.** Los 99 warnings son `@typescript-eslint/no-unused-vars` preexistentes en tests
ajenos (`habilitar-novedad-service`, `rastreo-publico-service`, `rescate-ayuda-service`,
`solicitud-ayuda-service`, `capturar-ubicacion`, entre otros). Ninguno cae en un archivo de esta
feature.

`pnpm exec vitest run tests/unit/api tests/integration/api tests/unit/services/api-orden-lectura-service.test.ts tests/unit/services/api-orden-lectura-service.filtros-257.test.ts tests/unit/repositories/orden-repository.listado-filtros-257.test.ts`:

```
 RUN  v4.1.10 C:/w257

 Test Files  25 passed (25)
      Tests  258 passed (258)
   Start at  12:29:07
   Duration  57.86s (transform 26.09s, setup 2.11s, import 198.26s, tests 10.14s, environment 16ms)
```

**Delta contra el baseline de T0: 20 → 25 archivos (+5, los cinco nuevos), 197 → 258 tests (+61),
0 → 0 rojos.**

Los tests preexistentes de las features 106 y 177 sobre este mismo canal siguen todos en verde: en
particular `ordenes-api-key-listado.route.test.ts` y `api-orden-lectura-service.test.ts` no
necesitaron ni un cambio, porque los cuatro campos nuevos son opcionales y `toHaveBeenCalledWith`
ignora las propiedades con valor `undefined`. Ese detalle es justo lo que hace que la ausencia de
filtros sea invisible para el matcher, así que en el test de R1 la ausencia se afirma campo por
campo en vez de fiarse de la igualdad estructural.

## Rojos ajenos anotados

**Ninguno.** No apareció ningún fallo fuera de la superficie tocada durante esta implementación.

## Pendiente (no es del implementer)

- **T14**: `./init.sh --rapido` y la apertura del PR contra `dev` los hace el leader.
