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
