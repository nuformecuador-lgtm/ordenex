# impl — Feature 82 (API keys: UI de gestion) — PARTE BACKEND

Rama `feature/82-api-keys-ui`, apilada sobre `feature/81-api-keys` (`1ebc350`). **No mergear a `dev` antes que la 81 (PR #86).**
Alcance de esta bitacora: **solo Fase 1 (T1.1–T1.10), el backend del listado**. La UI (Fases 2–3, R11–R31) la implementa despues un `frontend_dev`.

## Baseline MEDIDO (no citado) — antes de tocar nada

El worktree venia **sin `node_modules` y sin `.env`** → `pnpm install` + copia de `.env` desde el repo principal (`.gitignore:40` → `.env*`, no se commitea).

**La trampa del cliente Prisma se confirmo, con una variante:** `pnpm db:generate` fallaba con `PrismaConfigEnvError: Cannot resolve environment variable: DATABASE_URL` (por el `.env` ausente), y con el cliente sin generar el typecheck reportaba **7 errores falsos** (`Module '@prisma/client' has no exported member 'Prisma' / 'RolValue' / 'VehiculoValue'`). Tras `db:generate` con el `.env` en su sitio: **0 errores**. El baseline habria mentido.

| Medicion | Baseline (sin cambios) | Final (con esta feature) |
| --- | --- | --- |
| `pnpm typecheck` | **0 errores** | **0 errores** |
| `pnpm lint` | **0 errores, 140 warnings** | **0 errores, 140 warnings** (delta 0) |
| `pnpm test` | **2 failed / 3184 passed (3186)** | **1 failed / 3224 passed (3225)** |

> Los numeros de la columna final estan **REMEDIDOS tras reescribir la asercion de R19**
> (ver la seccion "Reescritura de R19"). El unico rojo final es el ajeno.

Fallos del baseline, ambos **AJENOS**:
1. `tests/components/CierreDiaPage.test.tsx > R1` — real pero ajeno (PR #82 cambio `CierreDiaModule.tsx` sin actualizar su test). Sigue rojo al final; no es mio, no lo toque.
2. `tests/unit/guards/no-embalaje.test.ts` — `Test timed out in 5000ms` bajo carga. **Verificado en aislado: pasa en 575ms** → flake por el walk del filesystem con el runner saturado. No reaparecio en la corrida final.

**+39 tests nuevos** (3186 → 3225), todos verdes. El unico rojo final (`CierreDiaPage`) es
el mismo ajeno del baseline; mi rojo a-proposito quedo resuelto (R19 pasa, ahora mas fuerte).

## Archivos creados

- `lib/config/api-keys.ts` — `apiKeysConfig` (25/100, envs `API_KEYS_DEFAULT_PAGE_SIZE` / `API_KEYS_MAX_PAGE_SIZE`). Molde literal de `lib/config/usuarios.ts`. [D3]
- `tests/unit/repositories/api-key-repository.list.test.ts`
- `tests/unit/services/api-key-service.listar.test.ts`
- `tests/unit/actions/api-keys-listar.test.ts`
- `tests/unit/repositories/api-key-repository.secreto.test.ts` — **guard nuevo de R19** (reemplaza la asercion vieja; ver "Reescritura de R19").

> Nota de nombres: el spec proponia `ApiKeyRepository.list.test.ts` / `ApiKeyService.listar.test.ts`. Se uso **kebab-case** (`api-key-repository.list.test.ts`) por `docs/conventions.md:9` ("Archivos: `kebab-case.ts`") y por consistencia con los vecinos ya existentes (`api-key-repository.test.ts`, `api-key-service.test.ts`, `user-repository.crud.test.ts`).

## Archivos modificados

- `lib/interfaces/repositories/IApiKeyRepository.ts` — `ApiKeyListItem`, `ListApiKeysParams`, `ListApiKeysResult`, metodos `list` / `count`.
- `lib/repositories/ApiKeyRepository.ts` — `LIST_SELECT`, `list()`, `count()`. `PUBLIC_SELECT` y `createConUsuario` **intactos**.
- `lib/interfaces/services/IApiKeyService.ts` — `listar(input, actor)` + doc del contrato.
- `lib/services/ApiKeyService.ts` — `listar()` reusando el `ALLOWED_ROLES` existente. `generar()` intacto.
- `lib/types/api-key.ts` — `listarApiKeysSchema`, `ListarApiKeysInput`, `ApiKeyListItemDTO`, `ListarApiKeysResult`, `ApiKeyActionErrorResult`.
- `lib/actions/api-keys.ts` — `listarApiKeys`. **`generarApiKey`: diff de 0 lineas.**
- `tests/unit/services/api-key-service.test.ts`, `tests/unit/actions/api-keys.test.ts` — mocks de la 81 completados con los miembros nuevos de la interfaz (ver "Tests ajenos afectados").

### Desvio menor del design, declarado

El design (§2.7) daba por hecho que `listarApiKeys` podia reusar `toApiKeyActionError` tal cual, pero ese helper declaraba `: GenerarApiKeyResult`, que **no es asignable** al union mas estrecho `ListarApiKeysResult` (no admite `conflict` / `not_found`). Se estrecho su tipo de retorno a `ApiKeyActionErrorResult` — que es exactamente lo unico que puede quedar tras los dos `throw` de `conflict`/`not_found` que el helper ya tenia. Sirve a ambas actions y **no cambia ni una linea del cuerpo de `generarApiKey`**.

## R6 — el secreto no cruza al cliente, por construccion

La propiedad se mantuvo tal como la diseño el spec, en tres capas que se refuerzan:

1. **`LIST_SELECT` no le pide `keyHash` a Postgres.** No es un filtrado posterior: el hash no sale de la base.
2. **`ApiKeyListItem` no declara `keyHash` ni `plainKey`.** Filtrarlo seria innecesario; *exponerlo* exigiria escribir codigo nuevo a proposito y tocar el tipo.
3. **`ListarApiKeysResult` no tiene ninguna rama que lo contenga.**

Cubierto con test propio en las tres capas (repositorio, service, action), incluyendo una asercion sobre el **objeto serializado** — que es la forma en que esto viaja al cliente y donde una fuga seria real.

Autorizacion: **server-side y en dos capas** (action resuelve el actor → R1; service filtra por rol → R2), ninguna en la UI.

## Mapa R → test (alcance backend: R1–R10)

| R | Test |
| --- | --- |
| **R1** sin sesion → `unauthenticated`, sin DB | `tests/unit/actions/api-keys-listar.test.ts` › "R1: devuelve unauthenticated cuando no hay sesion, sin tocar el service" |
| **R2** rol ≠ maestro → `forbidden`, sin DB | `tests/unit/services/api-key-service.listar.test.ts` › "R2: rechaza con forbidden a todo rol que no sea maestro, sin consultar la base" (derivado del enum `RolValue`) · `tests/unit/actions/api-keys-listar.test.ts` › "R2: propaga el forbidden del service…" + "R2: la autorizacion es server-side…" |
| **R3** params invalidos → `validation_error`, sin DB | `tests/unit/actions/api-keys-listar.test.ts` › "R3: %s -> validation_error, sin tocar el service" (7 casos: page 0/negativa/no entera/no numerica, pageSize 0/negativo/no entero) |
| **R4** `ok` con items/page/pageSize/total | `tests/unit/services/api-key-service.listar.test.ts` › "R4: devuelve status ok con items, page, pageSize y el total real" · action › "R3/R4: sin parametros aplica los defaults de la configuracion" |
| **R5** campos exactos del item | `tests/unit/services/api-key-service.listar.test.ts` › "R5: cada item trae exactamente los campos del contrato" · `tests/unit/repositories/api-key-repository.list.test.ts` › "R5/[D1]: aplana el email del usuario dedicado y devuelve las claves exactas" |
| **R6** sin `keyHash` ni secreto | **repositorio:** "R6: no le pide `keyHash` a Postgres: la clave no figura en el select" + "R6: el item devuelto no expone el hash ni ningun secreto" · **service:** "R6: ningun item devuelto contiene keyHash ni plainKey" + "R6: el resultado serializado hacia el cliente no menciona el secreto" · **action:** "R6: el resultado que la action devuelve no contiene keyHash ni plainKey" |
| **R7** `createdAt desc` | `tests/unit/repositories/api-key-repository.list.test.ts` › "R7: ordena por createdAt descendente" · service › "R7: preserva el orden que entrega el repositorio (createdAt desc), sin reordenar" |
| **R8** clamp a `MAX_PAGE_SIZE` reflejado en la salida | `tests/unit/actions/api-keys-listar.test.ts` › "R8: acota pageSize a MAX_PAGE_SIZE antes de llegar al service" + "R8: el pageSize efectivo (acotado) es el que se refleja en la salida" + "R8: un pageSize por debajo de la cota se respeta tal cual" |
| **R9** page fuera de rango → `items: []`, `total` real | `tests/unit/services/api-key-service.listar.test.ts` › "R9: una pagina mas alla del ultimo registro devuelve items vacios y el total real" · repositorio › "R9: una pagina fuera de rango devuelve items vacios conservando el total real" |
| **R10** capas separadas | `tests/unit/services/api-key-service.listar.test.ts` **entero**: el service se prueba con `IApiKeyRepository` mock, sin Prisma ni DB. La action se prueba con `deps` inyectadas, sin cookies ni Prisma. |

Decisiones del gate aplicadas: **[D1]** email sintetico via `include` (no el uuid) · **[D2]** sin scoping por `createdById` (test: "el total cuenta todas las keys, sin filtro por creador") · **[D3]** config con molde de `usuarios.ts` · **[D4]** sin `sortBy`/`sortDir`.

R11–R31 (pagina + UI) quedan **fuera de esta bitacora**: los cubre el `frontend_dev`.

## Tests de la 81 afectados por la ampliacion de interfaz

Ampliar `IApiKeyRepository` / `IApiKeyService` rompio los mocks de la 81 (efecto previsto por el propio `tasks.md` T1.2: *"prueba de que la interfaz manda"*). Se **completaron** los mocks con stubs que **fallan ruidosamente** si `list`/`count`/`listar` se invocan desde los tests de `generar` — en vez de devolver un vacio que haria pasar un test por la razon equivocada. Ninguna asercion existente se debilito.

## Reescritura de R19 (aprobada por el coordinador)

La asercion vieja en `api-key-service.test.ts:259` era:

```ts
// R19: el repositorio NO ofrece ninguna operacion de lectura de la key.
expect(Object.keys(repo)).toEqual(["createConUsuario"]);
```

**Por que cambio (no es un aflojamiento):** R19 protege la **irrecuperabilidad del secreto en claro**, NO la **cardinalidad de la interfaz**. La asercion vieja medía la forma —prohibía *cualquier* metodo nuevo— cuando la 82 agrego `list`/`count` legitimamente (design §2.1/§2.2) y **ninguno lee el secreto** (`LIST_SELECT` ni se lo pide a Postgres). Ademas corría sobre el **mock** (un objeto literal), no sobre la clase: los metodos reales de `ApiKeyRepository` viven en el prototipo, asi que `Object.keys` de una instancia real habria dado `[]` — nunca miraba el codigo que importa.

**La reescritura es ESTRICTAMENTE MAS FUERTE** que la vieja. Nuevo guard: `tests/unit/repositories/api-key-repository.secreto.test.ts`, contra la **clase real**:

1. **Robusto a metodos futuros, sin clavar nombres.** Deriva la superficie del **prototipo real** (`Object.getOwnPropertyNames(ApiKeyRepository.prototype)`) y exige que **toda** operacion tenga entrada en el mapa `INVOCACIONES`. Un metodo nuevo no puede entrar en silencio: o se registra (y entonces queda sujeto a la asercion de fuga) o el test falla. La lista de nombres —lo que hacia fragil a la vieja— desaparece; lo que perdura es la obligacion de demostrar no-fuga.
2. **Afirma sobre lo que cada operacion DEVUELVE, serializado.** Un Prisma fake **honra `select` como Postgres**: sobre una fila envenenada con `keyHash` y un secreto en claro, si un metodo pidiera el hash el fake se lo entregaria (como la base real) y `JSON.stringify(resultado)` lo delataria. Se corre sobre **todas** las operaciones (`createConUsuario`, `list`, `count`), no solo el listado.
3. **Verifica la garantia por construccion (82/R6):** ningun `select` emitido por ninguna operacion contiene `keyHash` — el hash no se filtra de la respuesta, es que nunca sale de la base.
4. **Control negativo:** un test comprueba que el fake SI entrega el hash cuando se lo piden, probando que las aserciones de arriba pueden fallar de verdad (un guard de no-fuga que no puede fallar no vale nada).

Lo que la vieja detectaba (un metodo nuevo) → el guard tambien lo obliga a declararse. Lo que la vieja NO podia detectar (un metodo que filtre el secreto en su retorno o en su `select`) → el guard SI. Mas fuerte en ambos ejes.

En `api-key-service.test.ts` la linea se reemplazo por un comentario que explica el traslado, para que el proximo lector no crea que alguien aflojo el test. El resto de ese test (`r.apiKey` sin `keyHash`/`plainKey`, claves exactas) queda intacto.

## Veredicto

Backend del listado completo y trazado (R1–R10, cada uno con test); typecheck 0 errores y lint sin delta (140 warnings preexistentes); R19 reescrito **estrictamente mas fuerte** y en verde. Suite en **1 failed** (unico rojo = el ajeno `CierreDiaPage`, del baseline).
