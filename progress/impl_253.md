# Feature 253 — bitácora del BACKEND (T1-T5 + D6 + P2)

> Alcance de esta tanda: **solo backend**. No se tocó ni un archivo de UI.
> `app/_landing/PostularRecursoModal.tsx`, `app/(app)/_components/**` y `app/(app)/dashboard/**`
> siguen exactamente como estaban. T6, T7 y T8 son del agente de frontend.
>
> Rama: `feat/253-impl-backend`. Medido contra `origin/dev` = `2d946420` (2026-08-20).

---

## 1 · Archivos

### Creados

| Archivo | Qué es |
| --- | --- |
| `db/migrations/20260820200000_postulacion_recurso/migration.sql` | enum + tabla + FK RESTRICT + CHECK + 2 índices + RLS |
| `db/migrations/20260820200000_postulacion_recurso/down.sql` | `DROP TABLE` y **después** `DROP TYPE` |
| `db/migrations/20260820210000_notificacion_evento_postulacion_recurso/migration.sql` | **D6**: `+postulacion_recurso_pendiente` y `+postulacion_recurso` a los enums de la 146 |
| `db/migrations/20260820210000_notificacion_evento_postulacion_recurso/down.sql` | recreación de los DOS enums sin el valor nuevo |
| `lib/types/postulacion-recurso.ts` | schema zod compartido cliente/servidor + DTO + resultados tipados |
| `lib/config/postulacion-recurso.ts` | topes, `RATE_MAX`, paginación y **retención de la purga** |
| `lib/interfaces/repositories/IPostulacionRecursoRepository.ts` | contrato de datos |
| `lib/interfaces/services/IPostulacionRecursoService.ts` | contrato del servicio |
| `lib/interfaces/services/IPurgaPostulacionRecursoService.ts` | contrato del cron de purga |
| `lib/repositories/PostulacionRecursoRepository.ts` | solo queries Prisma |
| `lib/services/PostulacionRecursoService.ts` | negocio: normaliza, autoriza por rol, anti-carrera |
| `lib/services/PurgaPostulacionRecursoService.ts` | **P2**: corte `now − 6 meses` sobre `atendida_at` |
| `lib/actions/postulacion-recurso.ts` | **Server Action PÚBLICA**, sin sesión |
| `lib/actions/atencion-postulaciones-recurso.ts` | las dos del admin |
| `app/api/cron/purga-postulaciones-recurso/route.ts` | Route Handler del cron (auth por `CRON_SECRET`) |

Tests nuevos: `tests/unit/types/postulacion-recurso-schema.test.ts`,
`tests/unit/config/postulacion-recurso-config.test.ts`,
`tests/unit/repositories/postulacion-recurso-repository.test.ts`,
`tests/unit/services/postulacion-recurso-service.test.ts`,
`tests/unit/services/purga-postulacion-recurso-service.test.ts`,
`tests/unit/services/notificacion-postulacion-recurso.test.ts`,
`tests/unit/actions/postulacion-recurso-action.test.ts`,
`tests/integration/actions/atencion-postulaciones-recurso-action.test.ts`,
`tests/integration/actions/purga-postulaciones-recurso-route.test.ts`,
`tests/integration/db/postulacion-recurso-migration.test.ts`,
`tests/integration/db/notificacion-evento-postulacion-recurso-migration.test.ts`.

### Modificados

| Archivo | Qué cambió y por qué |
| --- | --- |
| `db/schema.prisma` | modelo `PostulacionRecurso`, enum `PostulacionRecursoTipo`, relación inversa en `Usuario`, `+1` valor en `NotificacionEvento` y `+1` en `NotificacionEntidadTipo` |
| `lib/types/notificacion.ts` | los dos valores nuevos en las uniones |
| `lib/notificaciones/emitir.ts` | `TEXTO_POSTULACION_RECURSO_PENDIENTE` + `emitirPostulacionRecursoPendiente` |
| `lib/notificaciones/notificadores.ts` | `PostulacionRecursoNotificador`, `…Con(repo)` y el binding real |
| `vercel.json` | registra el cron `/api/cron/purga-postulaciones-recurso` a las 09:30 |
| `tests/unit/services/notificacion-productores-wiring.test.ts` | el inventario cerrado de la 146 pasa de **cuatro a cinco** eventos (era `toEqual([...4])`) |
| `tests/integration/db/no-migration-102.test.ts` | el censo «la única migración de notificaciones es la de la 146» pasa a lista cerrada + declaración explícita de la de la 253 |

---

## 2 · Mapa `R<n> → test`

| R | Test (nombre del caso) |
| --- | --- |
| **R4** | `253 / R4 …` › *el modulo NO importa `cookies` ni resuelve actor…* + *el resultado NO lleva token, ni sesion, ni id de usuario* |
| **R8** | `253 / R8 …` › *acepta una postulacion completa y devuelve los cinco campos* / *un campo EXTRA no viaja al resultado* |
| **R9** | `253 / R9 …` › *rechaza tipo = %p* (5 casos) + acción › *`tipo` invalido se rechaza SIN escribir ninguna fila* |
| **R10** | `253 / R10-R13 …` › *nombre vacio tras recortar → «Escribí tu nombre»* |
| **R11** | idem › *telefono de menos de 7 caracteres…* + *un telefono con espacios, `+` y guiones SIGUE siendo valido* |
| **R12** | idem › *correo sin formato…* + `253 / R20` › *el correo sale recortado y en MINUSCULAS* |
| **R13** | idem › *mensaje vacio…* + `253 / R13 + D3` › *el mensaje de exactamente MENSAJE_MAX_CHARS pasa; uno mas, no* |
| **R14** | `253 / R14 + R15 …` › *%s → validation_error y CERO escrituras* (7 casos, sin pasar por el formulario) |
| **R15** | idem › *varios campos malos producen varias claves en `fieldErrors`* |
| **R16** | `253 / R16 …` › *al intento RATE_MAX + 1 devuelve `rate_limited` y el servicio no se llama* |
| **R18** | `253 / R18 …` › *con entrada invalida NI SIQUIERA se lee la IP* / *el intento se REGISTRA aunque el servicio falle* / *el registro del intento ocurre ANTES de llamar al servicio* |
| **R19** | `253 / R19 …` (acción, captura `console`) × 3 + `253 / R19 …` (servicio, captura el logger) |
| **R20** | `253 / R1 + R20` › *recorta y baja el correo a minusculas antes de escribir* |
| **R21** | `253 / R21 …` (estático) + bloque B › *las columnas y su nullabilidad son las de la migracion* |
| **R22** | `253 / R22 …` (estático) + bloque B › *la RLS esta ENCENDIDA y hay CERO policies* |
| **R23** | `253 / R23 …` (3 casos) + rollback ejecutado (§4) |
| **R24** | `253 / R24 …` › *el service solo depende de `IPostulacionRecursoRepository`, y solo llama a `crear`* + repo unit › *el repositorio NO conoce `usuario`* |
| **R25** | bloque C › ***dos postulaciones con el MISMO correo conviven como dos filas*** (Postgres real) |
| **R26** | bloque C › ***`listar` trae SOLO las pendientes, de la mas reciente a la mas antigua*** (Postgres real) + bloque B › *los dos indices existen con la forma que sirve al panel y al cron* |
| **R27** | `253 / R27 + R28 …` › *%s SI lista* (maestro, admin) |
| **R28** | idem › *%s recibe `forbidden` y el repositorio NO se toca* (mensajero, adminTienda, adminSatelite, apiKey) + *%s tampoco puede atender* |
| **R30** | `253 / R30 + R33 …` (servicio) + borde › *un pageSize desmedido se acota ANTES de llegar al servicio* |
| **R31** | `253 / R31 + R32 …` › *registra quien y cuando, y devuelve el instante* |
| **R32** | bloque C › ***`marcarAtendida` devuelve 1 la primera vez y 0 la segunda, sin sobrescribir*** (Postgres real) + servicio › *`count === 0` y la fila existe → `conflict`* / *…y la fila NO existe → `not_found`* |
| **R33** | servicio › *el filtro `atendidas` llega al repositorio en sus DOS valores* + borde › *`atendidas: true` viaja al servicio* + bloque C (pestaña de atendidas con el nombre de quien atendió) |
| **R34** (parte servidor) | borde › *`conflict` y `not_found` llegan DISTINGUIBLES a la pantalla* + *un fallo inesperado del servicio NO deja la accion muda ni cuelga la promesa* |
| **D6** | `tests/unit/services/notificacion-postulacion-recurso.test.ts` (7 casos) + `notificacion-evento-postulacion-recurso-migration.test.ts` (19 casos) |
| **P2** | `purga-postulacion-recurso-service.test.ts` (11 casos) + `purga-postulaciones-recurso-route.test.ts` (14) + **bloque C › `⛔ P2: una postulacion PENDIENTE de hace DOS ANOS SOBREVIVE a la purga`** |

**R1, R2, R3, R5, R6, R7, R17, R29, R35, R36, R37-R42, R44** son de pantalla o de guardia: los cubre
el agente de frontend (T6-T8). **R43** lo cubre el gate completo (§5).

---

## 3 · Mutaciones — con SHA antes / mutado / después y el error real

### (a) ⛔ La purga: `atendida_at` → `created_at` en el `WHERE`

`lib/repositories/PostulacionRecursoRepository.ts` · `c196a258` → `6438bc61` → `c196a258`

```
FAIL  tests/integration/db/postulacion-recurso-migration.test.ts > 253 / bloque C …
      > ⛔ P2: una postulacion PENDIENTE de hace DOS ANOS **SOBREVIVE** a la purga
AssertionError: una postulacion PENDIENTE de hace dos anos fue borrada por la purga:
  expected [] to include '77433012-1798-40c8-a886-785b46c23f8e'
```

`[]` — con la mutación se borraron **las tres** filas del escenario: la pendiente de hace dos años,
la atendida ayer y la atendida hace dos años.

**Y lo que hay que leer al lado, porque es la advertencia del encargo hecha medición:**

| Suite | Con la mutación viva |
| --- | --- |
| `tests/unit/services/purga-postulacion-recurso-service.test.ts` (dobles) | **11 passed — VERDE** |
| `tests/unit/repositories/postulacion-recurso-repository.test.ts` (doble de Prisma) | 1 failed (compara el `where` literal) |
| `tests/integration/db/postulacion-recurso-migration.test.ts` (Postgres real) | 1 failed — **el de la conducta** |

El test de servicio con dobles pasa en verde con una mutación que **borra todas las postulaciones
pendientes de la base**. Por eso la condición se prueba donde vive.

### (b) La anti-carrera: quitar `atendidaAt: null` del `WHERE` de `marcarAtendida`

`c196a258` → `b18123fe` → `c196a258`

```
FAIL  … > 253 / bloque C … > R32: `marcarAtendida` devuelve 1 la primera vez y 0 la segunda
AssertionError: expected 1 to be +0 // Object.is equality
```
Servicio con dobles: **24 passed — VERDE**. Otra vez: el `WHERE` solo se ve contra Postgres.

### (c) Quitar el guard de rol de `listar`

`lib/services/PostulacionRecursoService.ts` · `892a5735` → `0b0a6566` → `892a5735`

```
FAIL  … 253 / R27 + R28 … > mensajero recibe `forbidden` y el repositorio NO se toca (ni un `count`)
AssertionError: expected { status: 'ok', items: [], …(3) } to deeply equal { status: 'forbidden' }
```
Caen 4 casos (mensajero, adminTienda, adminSatelite, apiKey).

### (d) Devolver `ok` sin llamar al repositorio en `registrar`

`892a5735` → `e62d9737` → `892a5735`

```
FAIL  … R1 + R20 … AssertionError: expected "vi.fn()" to be called with arguments: [ { tipo: 'vehiculo', …(4) } ]
FAIL  … R2  …      AssertionError: expected { status: 'ok' } to deeply equal { status: 'error' }
FAIL  … R24 …      AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times
FAIL  … D6  …      AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times
```
Nota honesta: **el test de la acción (T4.1) sigue VERDE**, porque usa un doble del servicio. Quien
caza esta mutación es el test del servicio, no el del borde.

### (e) R19: añadir un `console.info` con el correo y el teléfono

`lib/actions/postulacion-recurso.ts` · `de64029d` → `9be2efef` → `de64029d`

```
FAIL  … 253 / R19 … > camino feliz: la consola queda limpia de datos personales
AssertionError: expected '[postulacion-recurso] entrada ana.sol…' not to contain 'ana.solis@ejemplo.com'
Received: "[postulacion-recurso] entrada ana.solis@ejemplo.com +506 8888-8888"
```
Caen 3 casos (feliz, error y límite de tasa).

### (f) Quitar `.toLowerCase()` del correo en el schema

`lib/types/postulacion-recurso.ts` · `81e82d5e` → `deb7d74f` → `81e82d5e`

```
AssertionError: expected 'Ana.Solis@Example.COM' to be 'ana.solis@example.com'
```

### (g) Anti-vacuidad del censo de migraciones de notificación

Se creó `db/migrations/29990101000000_notificacion_intrusa/` y el censo la denunció:

```
AssertionError: hay una migracion con concepto de notificacion que nadie declaro …
+ [ "29990101000000_notificacion_intrusa" ]
```
Carpeta eliminada acto seguido.

---

## 4 · Migración: aplicada, revertida y reaplicada **de verdad**

Base: `PostgreSQL "ordenex" @ localhost:5432` (`prisma migrate status`, sin exponer credencial).

1. `prisma migrate deploy` → aplica las dos. `migrate diff --from-config-datasource --to-schema` →
   **«No difference detected»** (cero drift entre la base y el datamodel).
2. `pnpm run db:rollback` → revierte `…_notificacion_evento_postulacion_recurso`. Los dos enums
   vuelven a **cuatro** valores cada uno, medido:
   `notificacion_evento = orden_rechazada,carga_masiva_terminada,postulacion_mensajero_pendiente,cierre_dia_por_aprobar`.
3. `prisma db execute --file=…_postulacion_recurso/down.sql` → tabla y tipo desaparecen
   (`pg_class = 0`, `pg_type = 0`).
4. `prisma migrate deploy` de nuevo → las dos vuelven a aplicarse **sin error**, que es la prueba de
   que el down revirtió de verdad (si no, el `CREATE TYPE` habría fallado por duplicado).
5. Tras el ciclo, el índice `notificacion_dedupe_key` conserva
   `UNIQUE … NULLS NOT DISTINCT WHERE (entidad_id IS NOT NULL)` — medido, no supuesto, y ahora
   afirmado por test.

> ⚠️ **Hallazgo de proceso: `pnpm run db:rollback` NO alcanza a la migración de la tabla.**
> `scripts/db-rollback.ts` revierte siempre **la última carpeta por orden alfabético**. Con dos
> migraciones nuevas en la misma tanda, ejecutarlo dos veces revierte **dos veces la misma** (la de
> los enums) y deja la de la tabla aplicada — con su fila de `_prisma_migrations` intacta. Para
> revertir la de la tabla hubo que ejecutar su `down.sql` a mano y borrar su fila. No se «arregló»
> el script: no es alcance de esta ficha, pero **quien despliegue tiene que saberlo**.

---

## 5 · Verificación

```
pnpm exec tsc --noEmit      → sin salida (limpio)
pnpm exec eslint            → 0 errors, 97 warnings (todas preexistentes; ningún archivo de la 253)
./init.sh --rapido          → SE NIEGA, como estaba previsto (design §15): toca db/migrations/**,
                              db/schema.prisma y lib/types/**
./init.sh (completo)        → typecheck ✓ · lint ✓ · tests: 16.549 passed | 26 skipped | 1 FAILED
```

### El único rojo, y está previsto por escrito en el spec

```
FAIL tests/unit/guards/superficie-de-uso.guardia.test.ts
  > ninguna Server Action de `lib/actions/**` es inalcanzable sin su anotación `@sin-superficie`
+ [
+   "lib/actions/atencion-postulaciones-recurso.ts:51 listarPostulacionesRecurso",
+   "lib/actions/atencion-postulaciones-recurso.ts:73 marcarPostulacionRecursoAtendida",
+   "lib/actions/postulacion-recurso.ts:100 postularRecurso",
+ ]
```

`design.md` §15 lo anticipa palabra por palabra: *«`superficie-de-uso.guardia.test.ts` roja por las
acciones nuevas — **Sí, transitoriamente**, si el backend entra antes que la pantalla. La salida
correcta es **cablear**, nunca anotar `@sin-superficie`: anotarlo sería volver a declarar la
maqueta.»*

**No se anotó nada.** Las tres acciones se apagan solas cuando el frontend haga T6 (el modal llama a
`postularRecurso`) y T7 (el panel llama a las dos del admin). **Este PR no se abre sin esa tanda.**

### Suites ajenas tocadas y por qué (R43 / no regresión)

Ninguna suite de las features 21/22/23 ni de rastreo público se modificó ni se puso roja. Las dos que
sí se editaron son censos de inventario cerrado que esta ficha **amplía legítimamente**:

- `notificacion-productores-wiring.test.ts`: D1 de la 146 dice «añadir un evento exige migración de
  enum con su `down.sql`». Se pagó ese precio, así que el inventario pasa de 4 a 5. La lista sigue
  siendo **literal**: no se cambió por una derivación del propio schema (eso la dejaría siempre
  verde).
- `no-migration-102.test.ts`: afirmaba «la única migración de notificaciones es la de la 146». Su
  intención es que **la 102** no metiera infra de notificaciones, y eso sigue siendo cierto. Ahora es
  una lista cerrada con la de la 253 declarada, más dos controles nuevos: uno de anti-vacuidad y otro
  que exige que cada excepción declarada **exista** de verdad.

---

## 6 · Decisiones de implementación que el spec no cerraba

1. **D6 necesitaba DOS valores de enum, no uno.** El spec solo nombraba `NotificacionEvento`.
   `notificacion.entidad_tipo` es `NOT NULL` y sus cuatro valores (`orden`, `usuario`, `cierre_dia`,
   `carga`) no describen una postulación de recurso. Reusar `usuario` sería un dato falso —esta
   postulación **no crea cuenta** (design §14-C)— y rompería la dedupe por `(evento, entidad_id,
   destinatario)`. Emitir con `entidad_id = NULL` desactivaría la dedupe entera. Se añadió
   `postulacion_recurso` a `notificacion_entidad_tipo`, en la misma migración, con el porqué escrito.
2. **El aviso no lleva PII.** Texto: *«Alguien ofreció un vehículo o una bodega desde la web.»*;
   anexo: `Vehiculo` / `Bodega`. Ni nombre, ni correo, ni teléfono, ni una palabra del mensaje.
3. **Servicio de purga aparte** (`PurgaPostulacionRecursoService`), no un método más del servicio del
   panel: el cron corre desatendido y con otra autorización. Precedente: `PurgaPdfCargasService`.
4. **La retención se cuenta en meses de calendario**, con el día acotado al último del mes destino
   (`restarMesesUTC`). `setUTCMonth` a secas movería «31 de agosto − 6 meses» al **3 de marzo**, es
   decir, un corte *más nuevo*: tres días de más borrados.
5. **`PURGA_RETENCION_MESES = 0` cae al default**, al revés que `PURGA_PDF_RETENCION_DIAS` (donde `0`
   sí es legítimo). Con `0` el corte sería el instante de la corrida y se borraría lo atendido hoy
   mismo. En un borrado irreversible el fallo seguro es **no borrar**.
6. **El predicado de la purga vive en UNA función** (`wherePurgables`) y el `DELETE` borra por id sin
   repetirlo. Repetir la condición daría una red falsa y, peor, **taparía una mutación del predicado
   dejando el test en verde**.

---

## 7 · Lo que este trabajo NO incluye

- Nada de UI: T6 (modal), T7 (panel) y T8 (guardia de la landing) siguen pendientes.
- `middleware.ts` **no se tocó** (§1 del design), ni se creó ninguna ruta nueva salvo la del cron.
- `app/_landing/LandingPostular.tsx` **no se tocó** (R7).
- T0.1-T0.3 (mediciones M1/M2/M3/M5 contra producción) y T10 (ver la app) no son de esta tanda.

---

**Veredicto:** backend completo y verificado contra Postgres real —incluida la garantía de que una
postulación pendiente de hace dos años sobrevive a la purga—; el único rojo del gate es el que el
spec declara esperado y que se apaga cuando entre el frontend.


---
---

# FRONTEND — anexo del leader (2026-08-21)

> Lo escribe el leader porque el subagente de frontend no publica `.md`. Los mensajes de error van
> **literales**, no parafraseados.

## 8 · Lo que entra

| archivo | qué |
| --- | --- |
| `app/_landing/PostularRecursoModal.tsx` | **deja de ser maqueta**: cableado a `postularRecurso`, `useTransition` + `try/catch`, `switch` exhaustivo, acuse D9, botón «Enviando…», aviso en `role="alert"`. La cabecera ya no se declara maqueta |
| `app/(app)/_components/AdminMaestroDashboard.tsx` | dos `ContenedorSeccion` y descripción corregida (R36) |
| `tests/unit/guards/novedad-acciones-sin-maqueta.guardia.test.ts` | **sólo los imports** (D7). 19 casos antes, 19 después, ninguno tocado |
| `tests/fixtures/deteccion-maqueta.ts` · `tests/fixtures/superficies-publicas.ts` | los detectores extraídos y el censo, con `app/postulacion` por D10 |
| `tests/unit/guards/landing-sin-maqueta.guardia.test.ts` | la guardia nueva, 23 casos |
| `PostulacionRecursoPanel/Card` + 4 archivos de test | el panel del admin y su cobertura |

`LandingPostular.tsx` **no se tocó**. `HomePageMaestro.test.tsx` y `PostulacionesPendientesPanel.test.tsx`
quedaron verdes **sin modificarse** (R43).

## 9 · T8.5 — LOS DOS ROJOS DE RECAÍDA, literales

SHA de `PostularRecursoModal.tsx`: `a84a74be` → mutado → `a84a74be`, idéntico en los dos ciclos.

### Rojo 1 — volver a la maqueta (`setEnviado(true)`, sin import ni llamada) · mutado `1c242605`

```
FAIL tests/unit/guards/landing-sin-maqueta.guardia.test.ts > 253/R39 > cada productor se importa Y se invoca dentro de una raiz publica
AssertionError: una superficie PUBLICA promete un resultado que NINGUN archivo suyo produce: es la
maqueta de `PostularRecursoModal`, que validaba, pintaba «Postulacion enviada» y no enviaba nada.
+ [
+   "postularVehiculo -> `postularRecurso` (lib/actions/postulacion-recurso): nadie la importa",
+   "postularBodega  -> `postularRecurso` (lib/actions/postulacion-recurso): nadie la importa",
+ ]

Tests  3 failed | 20 passed (23)
```

Con esa misma mutación, `PostularRecursoModal.test.tsx`: **9 failed | 2 passed (11)**.

### Rojo 2 — el `import` EN PIE, la invocación borrada · mutado `af2c3a21`

```
FAIL tests/unit/guards/landing-sin-maqueta.guardia.test.ts > 253/R39 > cada productor se importa Y se invoca dentro de una raiz publica
+ [
+   "postularVehiculo -> `postularRecurso`: la importan app/_landing/PostularRecursoModal.tsx pero NINGUNA la llama",
+   "postularBodega  -> `postularRecurso`: la importan app/_landing/PostularRecursoModal.tsx pero NINGUNA la llama",
+ ]

Tests  2 failed | 21 passed (23)
```

**Y en ese estado `eslint` sobre el archivo da `0 errors, 1 warning` y sale con `ESLINT_EXIT=0`.**
El linter no la caza; la guardia sí. Ésta es la quinta forma de replantar una maqueta que la
revisión del 2026-08-20 encontró viva, y por eso el frente 2 mide **la invocación** y no el import.

## 10 · La extracción (D7) queda justificada por MEDIDA, no por argumento

Relajar `invocaElSimbolo` **en el fixture compartido** pone **rojas las dos guardias a la vez**:

```
4 failed | 38 passed (42)
```

cada una por su propio bloque de autocomprobación. Si los detectores se hubieran duplicado, esa
relajación habría dejado **una de las dos ciega** — que es exactamente la objeción de `design.md`
§14-H, ahora con número.

## 11 · El rojo esperado, apagado por cableado REAL

`superficie-de-uso.guardia.test.ts` → **18 passed**. Las tres acciones nuevas quedan alcanzables
porque hay pantalla que las dispara, **no** porque se las haya exceptuado: `grep` de
`@sin-superficie` vacío en los dos módulos de acciones y en los componentes nuevos.

## 12 · Gate completo

```
✓ typecheck   ✓ lint (0 errors, 97 warnings preexistentes, ninguna de la 253)
Test Files  1257 passed (1257)
     Tests  16603 passed | 26 skipped (16629)
INIT_EXIT=0
```

**+54 sobre el backend**: 53 casos nuevos y el rojo de `superficie-de-uso` apagado. LF en los 13
archivos tocados.

## 13 · Lo que queda abierto de esta ficha

- **T10 — «ver la app»**: pendiente. En este repo mirar la pantalla ha encontrado, repetidamente,
  lo que la suite no ve. No se marca hasta hacerse.
- **Deuda descubierta, no arreglada:** `pnpm run db:rollback` revierte siempre la última carpeta
  **por orden alfabético**, así que con dos migraciones nuevas correrlo dos veces revierte **dos
  veces** la de los enums y deja la de la tabla aplicada. Hubo que ejecutar su `down.sql` a mano.
  Ficha aparte.


---

# T0 — Las mediciones (ejecutadas por el leader el 2026-08-21)

> La revisión rechazó por, entre otras cosas, que **T0.1 y T0.3 nunca se ejecutaron**. Aquí están,
> con su fecha, su denominador y su hora de medición: **06:02 UTC del 2026-08-21**, vía MCP de
> Supabase, **solo lectura**, contra producción.

## M5 / P4 — **desde cuándo miente la maqueta**. RESPONDIDA

```
2026-08-16  6e840bb1  feat(landing): postulacion de recurso desde un modal en la landing
2026-08-21  e26cc30f  feat(253): frontend — el modal deja de mentir, …
```

**Nació el 2026-08-16 y `origin/prod` la contiene** (comprobado con `git branch -r --contains`).
**Cinco días en producción** dando acuse de recibo de algo que no ocurría. No es un detalle
arqueológico: es la ventana en la que cualquiera pudo postular un vehículo o una bodega y quedarse
esperando una llamada que nadie iba a hacer.

## M1 — postulaciones de mensajero por estado (el hermano vivo)

| medida | valor |
| --- | --- |
| mensajeros, total | **5** |
| en `pendiente` | **1** |
| en `activo` | **3** |

**Dimensiona el panel nuevo**: el volumen es de **unidades**, que es lo que sostiene D1 (las dos
clases mezcladas, no en dos bloques con su propia paginación para repartir tres filas).

## M2 — usuarios y última alta

| medida | valor |
| --- | --- |
| usuarios, total | **12** |
| última alta | **2026-08-21 03:33 UTC** |

⚠️ **Re-verificado, no citado**: la 252 midió **11** el 2026-08-20 y el spec exigía no repetir ese
número de memoria. Bien que se exigiera, porque **cambió**: el alta nueva es
**«MensajeroP Prueba», `pendiente`, rol `mensajero`**, creada a las 03:33 de hoy — es decir,
**después** de que el arreglo de la 252 llegara a producción. Es la confirmación en producción de
que aquel defecto quedó cerrado.

## M3 — el aviso del hermano, para dimensionar D6

| medida | valor |
| --- | --- |
| avisos `postulacion_mensajero_pendiente` | **4** |
| notificaciones totales | **84** |

**El denominador importa**: 4 de 84. El mecanismo de la campana está vivo y en uso, así que
replicarlo para la 253 —lo firmado en D6— se apoya en algo que ya funciona, no en una apuesta.

## M4 — declarada NO MEDIBLE (T0.2)

Las postulaciones de recurso perdidas **no dejaron fila, ni log, ni correo**. No son recuperables
**ni contables**. Lo único conocido son las dos que hizo el humano. Enlaza con **P1**, que queda
**sin acción** por la misma razón.

---

## ⚠️ Cómo leer estos números

**Producción se está usando hoy como entorno de PRUEBAS** (confirmado por el humano el 2026-08-20).
Describen fielmente lo que el código hace, pero **no dicen frecuencia operativa**. Los 5 días de M5
sí son reales y no dependen de eso: es tiempo de calendario con la maqueta desplegada.


---

# Mapa `R<n> → test` — LAS 19 FILAS DE PANTALLA Y GUARDIA

> La revisión encontró que el mapa cubría **25 de 44**: el anexo del frontend listaba **archivos**,
> no **casos**. Un mapa que nombra un archivo no es trazabilidad — en la 236, una fila citó un
> archivo de test **que no existía en ninguna rama** y nadie lo notó, porque `vitest` **no falla**
> con un filtro que no casa nada: lo ignora en silencio. Aquí va el nombre del **caso**.

| R | Caso que lo cubre |
| --- | --- |
| **R1** | `253/R1` › *con `ok` del servidor se pinta el acuse, y el envío llevó los cinco campos normalizados* · *💀 MIENTRAS la acción no ha resuelto, el acuse NO está* |
| **R2** | `253/R2 + R5 + R17` › los tres desenlaces (`validation_error`, `rate_limited`, `error`) + *💀 PROMESA RECHAZADA*, los cuatro con `valoresIntactos()` |
| **R3** | `253/R3` › *dos clicks seguidos producen UNA sola invocación, y el botón dice que está enviando* |
| **R5** | `253/R2 + R5 + R17` › *los tres desenlaces de fallo tienen texto propio, no vacío y DISTINTO entre sí* (+ el `Record<Exclude<…,"ok">,string>` en typecheck) |
| **R6** | `253/R6` › *dice que la postulación QUEDÓ REGISTRADA, y el texto de la maqueta no vuelve* |
| **R7** | `LandingPage.test.tsx` (verde sin tocarse) + `253/R1` › *las DOS tarjetas disparan la MISMA operación, con su `tipo`* |
| **R17** | `253/R2 + R5 + R17` › *`rate_limited` tiene texto PROPIO, distinto del error genérico* |
| **R29** | `253/R29` › *tipo, nombre, teléfono, correo, el mensaje COMPLETO y la fecha* · *la fecha se pinta en la zona de Costa Rica* · *una bodega se etiqueta como bodega* |
| **R30** | Panel › *la paginación existe y cambia de página pidiendo la siguiente* |
| **R31** | Panel › *confirmar llama a la acción con el id y refresca el listado* + Card › *una atendida dice QUIÉN la atendió y CUÁNDO* |
| **R33** | Panel › *«Atendidas» vuelve a pedir el listado con el filtro puesto y vuelve a la página 1* · *en «Atendidas» no hay botón de atender, y el estado vacío es el suyo* |
| **R34** | Panel › *conflict / not_found / forbidden: mensaje visible, y la fila sigue ahí* (3 casos) · *una promesa ROTA tampoco deja el panel mudo* |
| **R35** | Panel › *sin pendientes, dice qué va a aparecer ahí y por qué* |
| **R36** | Dashboard › *ya no se describe la pantalla entera como «Postulaciones de mensajeros pendientes»* · *los dos bloques están, cada uno con su título y su propio listado* |
| **R37** | `landing-sin-maqueta.guardia.test.ts` entera (23 casos) |
| **R38** | Frente 1 › *el módulo declarado existe, es de servidor y exporta ese símbolo* + Frente 3 › *ningún `sinOperacion` está vacío* · *hoy NINGUNA superficie se declara sin operación* |
| **R39** | Frente 2 › *cada productor se importa Y se invoca dentro de una raíz pública* · *y el que la llama es un archivo REAL* + bloque 0 › *💀 el `import` en pie SIN la llamada NO cuenta como cableado* |
| **R40** | Frente 4 › *ninguna Server Action pública se dispara sin estar declarada* · *anti-vacuidad* · *la lista de exentos no tiene basura* + Frente 5 › *todo archivo público con formulario está apuntado* · *todo archivo que el censo nombra EXISTE* · *el barrido ENCUENTRA formularios de verdad* |
| **R41** | Bloque 0 completo (11 casos), incluidos `LA_MAQUETA_253`, `IMPORT_SIN_LLAMADA` y `FORM_SIN_CENSO` |
| **R42** | `pnpm run test:guardias` → 126 archivos, con los **23 casos** de `landing-sin-maqueta` en la salida **sin estar en ninguna lista** |
| **R43** | Gate completo: 1257 archivos verdes, con las suites de la 21/22/23 y la de rastreo **sin tocar** |
| **R44** | Frente 2 › mapa `consultarRastreoPublico ← app/_landing/RastreoDialog.tsx` + Frente 4 anti-vacuidad (declarado como productor **real**, no como excepción) |

**Comprobado que los archivos citados EXISTEN** — es el error concreto que la 236 dejó pasar.
