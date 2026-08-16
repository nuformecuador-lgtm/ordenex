# Feature 227 — Hilo de notas por orden entre tienda y mensajero · bitacora de implementacion

Rama: `feature/227-hilo-notas-orden` · worktree `C:/w227` · nacida de `origin/dev` @ `a145cab8`.
Spec: `specs/227-hilo-notas-orden/` (requirements 37 requisitos = R1-R36 + R38; **R37 no existe**,
salio a la ficha 228 y su numero no se reutiliza).

Baseline medido por el leader antes de empezar: `pnpm exec tsc --noEmit` → EXIT 0 limpio.

---

## T0.1 — Conteo informativo de `orden_mensajero_meta.nota` (R23)

**Fecha de la medicion:** 2026-08-15.
**Entorno:** base LOCAL de desarrollo, `postgresql://***@localhost:5432/ordenex?schema=public`.

Consulta ejecutada (la del spec, tasks.md T0.1):

```sql
SELECT count(*) AS filas,
       count(DISTINCT usuario_id) AS mensajeros,
       min(created_at), max(created_at)
FROM orden_mensajero_meta
WHERE nota IS NOT NULL;
```

Salida real:

```
nota IS NOT NULL: [{"filas":0,"mensajeros":0,"primera":null,"ultima":null}]
total filas de la tabla: [{"total":0}]
```

**Lectura honesta del dato:** en la base local la tabla `orden_mensajero_meta` esta ENTERAMENTE
vacia (0 filas en total, no solo 0 con nota). Por lo tanto el conteo local **no dice nada** sobre
cuantas notas privadas reales existen.

**Conteo de PRODUCCION: NO MEDIDO.** No hay acceso a produccion desde este entorno y no se toca
produccion desde aqui. **No se inventa una cifra.** La migracion destructiva M2 cita este hecho
explicitamente: el `count` local es 0 y el de produccion queda por medir por quien tenga la
credencial, ANTES de aplicar la migracion alli. La decision humana de perder el contenido (P1,
2026-08-14) NO depende de ese numero: el conteo es informativo y no reabre la decision.

---

## Bloque 1 — Datos (T1.1, T1.2, T1.3) · backend_dev · 2026-08-15

### Archivos

| Archivo | Que |
| --- | --- |
| `db/schema.prisma` | **modificado**: modelo `OrdenNota` nuevo (+ relaciones inversas `Orden.notasHilo` y `Usuario.ordenNotasEscritas`). +41 lineas, nada borrado. |
| `db/migrations/20260815120000_orden_nota/migration.sql` | **nuevo**: M1, aditiva. |
| `db/migrations/20260815120000_orden_nota/down.sql` | **nuevo**: `DROP TABLE IF EXISTS "orden_nota";` |
| `tests/integration/db/orden-nota-migration.test.ts` | **nuevo**: 16 tests, 13 de ellos ejecutando el DDL REAL contra Postgres. |

La relacion inversa en `Orden` se llama `notasHilo` y **no** `notas`: ese nombre ya lo ocupa la
nota de la TIENDA (`orden.notas`, R14a/R25), que esta feature no toca.

### T1.2 — aplicacion real, rollback y reaplicacion

`pnpm run db:migrate` (= `prisma migrate dev`) **NO se pudo usar**, y no por culpa de esta
migracion: la base local tiene aplicadas 4 migraciones que **no existen en esta rama**
(`20260728120000_orden_historial_origen_deshacer_asignacion` y las tres de trazado de ruta del
14-ago: `20260814120000_ruta_optimizada_trazado`, `20260814140000_ruta_parada_tramo`,
`20260814160000_ruta_tramo_vivo_at`), mas el drift de columnas que traen. `migrate dev` detecta
esa divergencia ajena y exige `migrate reset` (**borrar la base local entera**). No se hizo: es
destructivo y el problema no es de esta rama. Se aplico con `prisma migrate deploy`, que aplica
las pendientes sin exigir reset.

```
$ npx prisma migrate deploy
117 migrations found in prisma/migrations
Applying migration `20260815120000_orden_nota`
The following migration(s) have been applied:
migrations/
  └─ 20260815120000_orden_nota/
    └─ migration.sql
All migrations have been successfully applied.

$ pnpm run db:rollback
Aplicando rollback: 20260815120000_orden_nota
Script executed successfully.   (down.sql)
Script executed successfully.   (borrado del registro en _prisma_migrations)
Rollback completado: 20260815120000_orden_nota

$ npx prisma migrate deploy      # reaplicada
All migrations have been successfully applied.
```

Sin drift PROPIO: `prisma migrate diff --from-config-datasource --to-schema db/schema.prisma`
sale limpio en todo lo de esta feature (`orden_nota` no aparece). Lo unico que reporta es el
drift AJENO de `ruta_optimizada` / `ruta_optimizada_parada` descrito arriba, identico antes y
despues. Tras el `down.sql` el diff decia `[+] Added tables - orden_nota` (la tabla se habia ido
entera, con sus dos indices y sus dos FK) y tras reaplicar volvio a estar limpio: el
`down.sql` deja el esquema EXACTAMENTE como estaba. `prisma validate` verde.

### T1.3 — el test no es una regex

`tests/integration/db/orden-nota-migration.test.ts` **ejecuta** el `migration.sql` real,
sentencia a sentencia, en un esquema temporal dentro de una transaccion que siempre se revierte
(patron de la feature 196), con `public` en el `search_path` para que las dos FK apunten a las
tablas `orden`/`usuario` REALES. Lee `information_schema.columns`, `pg_constraint`
(`confdeltype`), `pg_indexes`, `pg_class.relrowsecurity` y `pg_policies`; **crea sus propios**
usuarios, orden y notas; y ejercita el borrado de verdad. Al final corre el `down.sql` real.
Nada sobrevive al test y `_prisma_migrations` no se toca.

Comprobado por MUTACION (que es la unica prueba de que un test muerde): al invertir el indice a
`(created_at, orden_id)` y quitar la linea de RLS, fallan exactamente los dos tests de R28 y R26;
al cambiar el CASCADE por `NO ACTION`, la suite se pone roja. Restaurado el SQL, verde.

| R | Test |
| --- | --- |
| R26 | «R26: relrowsecurity es true en `orden_nota`» + «R26: CERO policies — solo el service role entra…» |
| R28 | «R28: existe el indice compuesto (orden_id, created_at) EN ESE ORDEN, y el de autor» |
| R30 | «R30: la FK a `orden` es ON DELETE CASCADE, leida de pg_constraint» + «R30: borrar la orden ARRASTRA sus notas y no deja ni una huerfana» |

Salida real:

```
$ pnpm exec vitest run tests/integration/db/orden-nota-migration.test.ts
 Test Files  1 passed (1)
      Tests  16 passed (16)

$ pnpm exec tsc --noEmit
(sin salida, EXIT 0)

$ pnpm exec eslint tests/integration/db/orden-nota-migration.test.ts
(sin salida, EXIT 0)
```

Ningun caso quedo sin ejercitar por falta de datos: el test **no** usa `fksDeOrden` ni depende de
filas preexistentes de negocio; crea su propia orden a partir de los catalogos
(`rol`, `tipo_identificacion`, `order_status`, `zona`, `provincia`, `canton`). Si esos catalogos
faltaran, FALLA con el motivo escrito en vez de saltarse.

---

## Bloque 4 (capa UI) — retiro de la feature 116 en `app/` · frontend_dev · 2026-08-15

Tanda corrida EN PARALELO con el Bloque 1, sobre fronteras de archivos disjuntas
(`app/` + `tests/components/` vs `db/` + `tests/integration/`).

### Archivos

| Archivo | Que |
| --- | --- |
| `app/(app)/mis-asignaciones/_components/NotaPrivadaMensajero.tsx` | **BORRADO** (T4.1, parte UI) |
| `tests/components/NotaPrivadaMensajero.test.tsx` | **BORRADO** (T4.5, parte UI) |
| `app/(app)/mis-asignaciones/_components/GestionarOrdenPanel.tsx` | desmontado el bloque completo + import; sin `null` residual ni hueco de layout (T4.2, parte UI) |
| `app/(app)/mis-asignaciones/_components/pos-card/PosOrderCard.tsx` | badge + preview + import `StickyNote` huerfano fuera (T4.4) |
| `app/(app)/mis-asignaciones/_components/pos-card/PosOrderCardMosaico.tsx` | idem (T4.4) |
| `app/(app)/mis-asignaciones/_components/pos-card/PosOrderCardDetalle.tsx` | bloque de marcas + parrafo de preview fuera (T4.4) |
| `app/(app)/mis-asignaciones/_components/RepartoModule.tsx` | solo un comentario que enumeraba «nota privada» entre las señales del modulo |
| `tests/components/PosOrderCardSinNotaPrivada.test.tsx` | **NUEVO**: asercion de R21 para las tres vistas de card |
| 9 tests de `tests/components/` | quitadas solo REFERENCIAS, sin cambio de comportamiento (ver mas abajo) |

Tests retocados por referencia: `GestionarOrdenPanelEvidencias`, `GestionarOrdenPanelIncidente`,
`GestionarOrdenPanelPagos`, `GestionarOrdenUbicacion`, `MarcarLuegoToggle`, `RepartoModule`
(se retiro el `vi.mock("@/lib/actions/notas-privadas-mensajero")`, que habria reventado al
desaparecer el modulo), `RecoleccionModule` y `RecoleccionPage` (fixture `notaPrivada: null`).

### Contradiccion spec ↔ codigo encontrada (T4.4)

`tasks.md` T4.4 y la tabla de trazabilidad de R21 citan `tests/components/PosOrderCard*.test.tsx`
como si existieran. **NO EXISTEN**: no hay ningun test de componente dedicado a las pos-card; se
ejercitan indirectamente desde `RepartoModule`, `RecoleccionModule` y `NovedadesModule`. Como la
asercion de R21 si es exigible, se CREO `tests/components/PosOrderCardSinNotaPrivada.test.tsx`,
que encaja en el glob que el spec nombra. Queda anotado para el reviewer: el spec nombraba un
archivo inexistente, no se edito nada fantasma.

Segunda imprecision menor del spec: las pos-card viven en
`app/(app)/mis-asignaciones/_components/pos-card/`, no en `components/`.

### T3.7 — decision D3, verificada

**No se añadio badge, punto ni contador de «hay notas» en ninguna card.** Se retiraron los de la
116 y no se pusieron otros. **Consecuencia dicha en voz alta: hasta que exista la ficha 228, el
mensajero solo se entera de que hay notas si ABRE la orden.** Es decision humana registrada (D3),
no un olvido de UI. El test nuevo lo deja escrito.

### Salidas reales

```
$ pnpm exec tsc --noEmit
(sin salida, EXIT 0)

$ pnpm exec eslint app components tests/components
✖ 10 problems (0 errors, 10 warnings)   EXIT 0
  — los 10 warnings son PREEXISTENTES (no-img-element, exhaustive-deps, imports sin usar
    en UbicacionMapaInner / RecoleccionModule / WebhookAccionCell). El de
    GestionarOrdenPanel.tsx:47 ('EnviarPlantillaWhatsappButton' sin usar) es previo: su uso
    esta en un bloque JSX comentado desde la rama ux.

$ pnpm exec vitest run tests/components/GestionarOrdenPanel tests/components/PosOrderCard \
    tests/components/MarcarLuegoToggle tests/components/RepartoModule tests/components/Recoleccion
 Test Files  8 passed (8)
      Tests  179 passed (179)

$ pnpm exec vitest run tests/components/GestionarOrdenUbicacion
 Test Files  1 passed (1)
      Tests  8 passed (8)
```

`rg -n "notaPrivada|NotaPrivadaMensajero|nota-privada|nota privada" app/ components/ tests/components/`
→ 4 hits, **todos** en los nombres descriptivos del test nuevo. Cero en produccion.

---

## Bloque 2 — Backend del hilo (T2.1-T2.9) · backend_dev · 2026-08-15

### Archivos (todos NUEVOS, ninguno preexistente modificado)

`lib/types/ventana-hilo-notas.ts` (T2.3) · `lib/types/orden-nota.ts` (T2.2) ·
`lib/interfaces/repositories/IOrdenNotaRepository.ts` · `lib/interfaces/services/IOrdenNotaService.ts` (T2.1) ·
`lib/repositories/OrdenNotaRepository.ts` (T2.4) · `lib/services/OrdenNotaService.ts` (T2.6) ·
`lib/actions/orden-notas.ts` (T2.8) · `tests/unit/services/orden-nota-service.test.ts` (T2.7) ·
`tests/unit/actions/orden-notas-action.test.ts` (T2.9) ·
`tests/integration/repositories/orden-nota.int.test.ts` (T2.5)

### Salidas reales

```
$ pnpm exec tsc --noEmit
(sin salida)  EXIT 0

$ pnpm exec eslint lib tests/unit tests/integration
✖ 56 problems (0 errors, 56 warnings)  EXIT 0
  — las 56 son `no-unused-vars` AJENAS, en archivos preexistentes.
    eslint sobre los 10 archivos de esta tanda en solitario → EXIT 0, cero problemas.

$ pnpm exec vitest run tests/unit/services/orden-nota-service.test.ts \
      tests/unit/actions/orden-notas-action.test.ts \
      tests/integration/repositories/orden-nota.int.test.ts
 Test Files  3 passed (3)
      Tests  34 passed (34)      (20 service + 9 actions + 5 integracion)
```

El test de integracion corrio **de verdad contra Postgres** (no `skipped`): crea sus dos usuarios,
sus dos ordenes y sus cuatro notas dentro de `enTransaccionRevertida`, y mide el SQL emitido con
el cliente espia. No hay retorno temprano por falta de datos (verde en falso).

### TRES DESVIACIONES DEL DESIGN, decididas con argumento y reportadas al leader

**1. `borrarNotaSchema` lleva `{ ordenId, notaId }`, no solo `{ notaId }`.**
`design.md` §3 escribe `borrarNotaSchema = { notaId: uuid }`, pero §2.2 exige que `borrar` siga la
MISMA secuencia que `publicar` (cargar la orden → pertenencia → ventana) y el repositorio de §2.1
**no tiene ningun metodo para averiguar de que orden es una nota**. Con solo `notaId`, **R35 y
R10/R11 son inaplicables en `borrar`**. No relaja nada: el `autorId` sigue saliendo de la sesion.

**2. Consecuencia: `marcarBorrada(notaId, ordenId, autorId)`** → `where: { id, ordenId, autorId,
deletedAt: null }`. Es ESTRICTAMENTE mas restrictivo que el `where` del design, con el mismo
principio (todo en el statement que muta, cero `if` previos). Sin el `ordenId`, un autor dentro de
su ventana en la orden A podia borrar su propia nota de la orden B, cuya ventana estaba cerrada:
un agujero directo de R35. Cubierto por el test de integracion «el mismo id desde OTRA orden
tampoco».

**3. R28 «UNA sola consulta» se cumple en lo que R28 realmente protege, no en lo literal.**
El orden de comprobaciones del design (paso 2 = `findOrdenParaHilo`) hace imposible que `listar`
haga exactamente 1 llamada al repo. El test afirma lo verificable y lo que importa:
`listarPorOrden` se llama **1 vez** para un hilo de 3 notas (nunca una consulta por nota) y el
total de llamadas es **2 y no crece con el tamaño del hilo**.

**4 (menor).** `validation_error` tuvo que entrar tambien en el resultado del SERVICE
(`PublicarNotaServiceResult`), no solo en el del borde: R6 exige que el rechazo del cuerpo vacio
tras recortar ocurra en el service, y ese resultado tiene que poder salir de ahi.

### Mapa `R<n> → test` de esta tanda (nombres exactos)

| R | Archivo | Nombre del test |
| --- | --- | --- |
| R1 | service | «publicar añade una nota sin alterar las previas del hilo» |
| R3 | integracion | «devuelve el hilo en orden ascendente y estable con instantes repetidos» |
| R4 | service | «conserva el rol con el que se publico aunque el rol del usuario cambie» |
| R5 | service | «ignora un autor enviado en la entrada y usa el de la sesion» |
| R6 | actions | «rechaza un cuerpo que queda vacio al recortar y no crea nota» |
| R7 | actions | «acepta 200 caracteres y rechaza 201 sin crear nota» + «el tope se mide sobre el texto CRUDO, antes del recorte» |
| R8 | actions | «devuelve rechazo tipado sobre una orden inexistente, sin excepcion» |
| R9 | service | «permite al adminTienda leer y publicar en una orden de su tienda» |
| R10 | service | «rechaza igual una orden de otra tienda y una inexistente, sin revelar cual es» + «una orden BORRADA logicamente se trata igual que una inexistente» |
| R11 | service | «da acceso al mensajero asignado y rechaza al no asignado, tambien en lectura» |
| R12 | service | «rechaza a maestro, admin y adminSatelite en leer, publicar y eliminar» |
| R13 | actions | «devuelve no autenticado sin llamar al servicio» |
| R14 | service | «la tienda publica solo en devuelta y el mensajero solo en en_reparto (matriz rol × estatus)» + «`por_recoger` NO abre ventana para nadie» + «`puedeEscribir` de la lectura es POR ROL» |
| R15 | service | «devuelve el hilo completo con la orden ya fuera de devuelta» |
| R25 | service | «publicar en el hilo no altera la nota de la tienda» |
| R27 | actions | «devuelve validation_error con errores por campo ante una entrada mal formada» |
| R28 | service | «lee el hilo con una sola llamada al repositorio» |
| R31 | service «el autor elimina su nota dentro de su ventana y el resto del hilo queda intacto» + integracion «el borrado logico conserva la fila y su autoria» |
| R32 | service «la contraparte y un maestro no pueden eliminar una nota ajena» + integracion «el borrado filtra por autor en el mismo statement» |
| R33 | service | «devuelve el mismo resultado tipado ante una nota inexistente, ajena o ya eliminada» |
| R34 | service | «una nota eliminada viaja marcada, con autor y hora, y con el cuerpo vacio» + «la proyeccion aislada es la unica que decide, y no publica `autorId`» |
| R35 | service | «fuera de su ventana, ningun rol puede eliminar ni siquiera sus propias notas» |

### Pendiente conocido al cerrar la tanda

`superficie-de-uso.guardia.test.ts` señalaba las TRES Server Actions nuevas como «sin superficie»
porque aun no habia UI que las montara. **NO se anoto con `@sin-superficie`**: esa anotacion es
para quien se queda sin superficie a proposito. Se cierra con los montajes del Bloque 3.

---

## Bloque 3 — UI del hilo (T3.1-T3.5, T3.7) · frontend_dev · 2026-08-15

### Archivos

Creados: `components/shared/HiloNotasOrden.tsx` (T3.1) ·
`app/(app)/novedades/_components/HiloNotasNovedadModal.tsx` (T3.3) ·
`tests/components/HiloNotasOrden.test.tsx` (T3.2) ·
`tests/components/NovedadesModuleHilo.test.tsx` y `tests/components/GestionarOrdenPanelHilo.test.tsx` (T3.5).

Modificados: `app/(app)/novedades/_components/NovedadAcciones.tsx` (accion «Notas», unica puerta al
hilo) · `NovedadesModule.tsx` (estado `ordenConNotas` + montaje condicional con `key`) ·
`app/(app)/mis-asignaciones/_components/GestionarOrdenPanel.tsx` (hilo en el hueco EXACTO donde
estaba el editor de la nota privada retirada, T3.4) · `tests/components/RepartoModule.test.tsx` y
`GestionarOrdenPanelEvidencias.test.tsx` (solo un mock de la accion nueva: el panel ahora lee una
Server Action al montar).

### Salidas reales

```
$ pnpm exec tsc --noEmit                              EXIT 0 (sin salida)
$ pnpm exec eslint app components tests/components    EXIT 0 — 10 warnings PREEXISTENTES
$ pnpm exec vitest run tests/components/HiloNotasOrden tests/components/NovedadesModule tests/components/GestionarOrdenPanel
 Test Files  7 passed (7)
      Tests  104 passed (104)
$ pnpm exec vitest run tests/components   # radio de impacto completo
 Test Files  184 passed (184)
      Tests  2382 passed (2382)
$ pnpm exec vitest run tests/unit/guards/superficie-de-uso.guardia.test.ts
 Test Files  1 passed (1)      Tests  18 passed (18)
```

**Guardia de superficie CERRADA por los montajes**, sin anotar nada con la marca de excepcion.
Cadenas reales: HiloNotasNovedadModal -> NovedadesModule -> novedades/page, y
GestionarOrdenPanel -> RepartoModule -> reparto/page.

### Mapa `R<n> -> test` de esta tanda

| R | Test |
| --- | --- |
| R16 | `HiloNotasOrden.test.tsx` — «pinta cada nota con su autor y su hora y distingue las propias» |
| R17 | idem — «tras publicar y tras eliminar solicita el refresco de datos del servidor» |
| R18 | idem — «muestra el motivo del rechazo y no pinta el cambio como aplicado» |
| R19 | idem — «con puedeEscribir muestra el compositor y sin el lo oculta junto a los controles de borrado» |
| R34 (UI) | idem — «pinta «nota eliminada» conservando el hueco» |
| T3.5 mensajero | `GestionarOrdenPanelHilo.test.tsx` — «al abrir la orden carga su hilo una sola vez y lo monta en el panel», «la lista de asignaciones no pide el hilo de todas las ordenes», «el compositor del mensajero lo autoriza el servidor, no el estatus de la orden» |
| T3.5 tienda | `NovedadesModuleHilo.test.tsx` — «no pide el hilo al listar las ordenes y lo carga solo al abrir una», «al abrir una orden monta su hilo con el compositor que autoriza el servidor» |

### Desvios del design, reportados

1. **La lectura se hace con SWR + Server Action como fetcher** (precedente literal:
   ChatConversacion / listarHiloChat), y el refresco de R17 es `mutate()`. Motivo duro: el
   `useEffect + void cargar()` escrito primero produce **error de ESLint** (react-hooks:
   «Calling setState synchronously within an effect»). El design admite explicitamente
   «re-invocacion de la accion de lectura».
2. `HiloNotasOrden` lleva una prop opcional extra sobre las del design: `titulo?` (por defecto
   «Notas de la orden»). Cada montaje nombra a su contraparte —«Notas con el mensajero» / «Notas
   con la tienda»— sin textos duros dentro del componente compartido.

### T3.7 — decision D3 verificada de nuevo

Ninguna card gano badge, punto ni contador. Lo unico nuevo en superficie es el boton «Notas» de la
fila de acciones de `/novedades`. **Consecuencia asumida y dicha en voz alta: hasta la ficha 228,
el mensajero solo se entera de que hay notas si ABRE la orden.**

---

## Bloque 4 (backend) — retiro de la 116 en `lib/` y MIGRACION DESTRUCTIVA M2 · backend_dev · 2026-08-15

### M2 — el punto de mas cuidado

**Directorio: `db/migrations/20260815140000_orden_mensajero_meta_drop_nota/`** (posterior a M1).

- `migration.sql`: cabecera en mayusculas con la decision humana (perdida **DEFINITIVA Y
  DELIBERADA**, 2026-08-14, P1), el conteo LOCAL tal cual (filas = 0, tabla enteramente vacia),
  la declaracion explicita de que ese cero **no informa sobre produccion**, que el conteo de
  produccion queda **PENDIENTE** de medirse antes de aplicar alli, y que la decision **no depende**
  de ese numero. Una sola sentencia: ALTER TABLE "orden_mensajero_meta" DROP COLUMN "nota";
- `down.sql`: ADD COLUMN "nota" TEXT; diciendo sin eufemismos que repone la **estructura**
  (nullable) y **no el contenido**.

Ejecutada de verdad: `prisma migrate deploy` -> OK; `pnpm run db:rollback` -> OK (comprobado por
CATALOGO: `nota` vuelve nullable, el unique (usuario_id, orden_id) y `marcar_luego` intactos);
`deploy` de nuevo -> OK; `prisma migrate status` -> Database schema is up to date. Sin drift propio
(el unico que reporta `migrate diff` es el AJENO y preexistente de `ruta_optimizada`).

El test `tests/integration/db/orden-mensajero-meta-drop-nota-migration.test.ts` **ejecuta up y down
de verdad** contra Postgres en esquema temporal dentro de transaccion revertida. No es una regex.

### Archivos

**Borrados (8):** `lib/services/NotaPrivadaMensajeroService.ts`, `lib/actions/notas-privadas-mensajero.ts`,
`lib/types/nota-privada-mensajero.ts`, `lib/interfaces/services/INotaPrivadaMensajeroService.ts`,
`tests/unit/services/nota-privada-mensajero-service.test.ts`,
`tests/unit/actions/notas-privadas-mensajero-action.test.ts`,
`tests/unit/services/mis-asignaciones-nota-privada.test.ts`,
`tests/integration/repositories/nota-privada-mensajero-repo.int.test.ts`.

**Creados:** los 2 archivos de M2, `tests/integration/db/orden-mensajero-meta-drop-nota-migration.test.ts`,
`tests/unit/guards/nota-privada-retirada.guardia.test.ts`.

**Modificados:** `db/schema.prisma` (fuera la columna `nota`; el unique, `marcarLuego`, las FKs y el
modelo `OrdenNota` intactos) · `lib/interfaces/services/IMisAsignacionesService.ts` ·
`lib/services/MisAsignacionesService.ts` · `lib/interfaces/repositories/IOrdenMensajeroMetaRepository.ts` ·
`lib/repositories/OrdenMensajeroMetaRepository.ts` · `lib/types/novedad.ts` (T4.7) ·
`lib/services/RecoleccionTiendaService.ts` (comentario) · 9 tests de `tests/unit/services/` ·
`tests/integration/actions/recoleccion-tienda-action.test.ts` · los tres archivos de
`specs/116-notas-privadas-mensajero/` (T4.11, aviso de RETIRADA; no se borran).

**Lo que NO se toco, verificado:** el corte de 167/R34 sigue literal
(`findMisAsignaciones(actor.usuarioId, [ORIGEN_RECOGER, ESTADO_EN_REPARTO])`), `marcar_luego` y
`orden.notas`.

### T4.6 — verificacion por MUTACION de la guardia de retirada

| Mutacion | Resultado |
| --- | --- |
| Reintroducir el campo de nota privada en el DTO de `MisAsignacionesService.ts` | **ROJA** por el motivo correcto. Revertida. |
| Añadir a M2 un INSERT ... SELECT desde la tabla vieja hacia `orden_nota` | **ROJA por dos vias** (DML + cruce de la tabla vieja con el hilo). Revertida. |
| Poner el `down.sql` como TEXT NOT NULL DEFAULT '' | 3 tests rojos, incluido el del bloque contra Postgres real -> confirma que el bloque de motor **se ejecuta** y no esta verde por vacio. Revertido. |

### T4.8 — la 115 intacta (R24)

`tests/integration/repositories/orden-mensajero-meta.int.test.ts` pasa **SIN MODIFICARLO** (12 tests).

### Salidas reales

```
$ pnpm exec tsc --noEmit                                EXIT 0 (sin salida)
$ pnpm exec eslint lib tests/unit tests/integration     EXIT 0 — 55 warnings preexistentes
   (nota: `eslint db` aborta con "all files matching the glob db are ignored": db/ no esta en la config de lint)

$ pnpm exec vitest run tests/integration/db/orden-mensajero-meta-drop-nota-migration.test.ts tests/integration/repositories/orden-mensajero-meta.int.test.ts tests/unit/guards/nota-privada-retirada.guardia.test.ts tests/unit/services/mis-asignaciones
 Test Files  10 passed (10)      Tests  161 passed (161)

$ pnpm exec vitest run tests/integration/db/orden-nota-migration.test.ts      1 passed · 16 passed

$ pnpm run test:guardias
 Test Files  101 passed (101)     Tests  1530 passed (1530)
```

Barrido final de simbolos de la 116 en `lib/`, `tests/unit/`, `tests/integration/` y `scripts/`:
**cero codigo vivo**. Lo que queda son comentarios historicos, la guardia misma (que nombra por
definicion los simbolos prohibidos) y el test de ausencia de R21.

### Contradiccion reportada

`tests/integration/db/orden-nota-migration.test.ts` (Bloque 1) afirmaba que M1 era la **ultima**
migracion del arbol; añadir M2 la ponia roja por definicion. Se ajusto: ahora afirma que M1 va
ANTES que M2, y deja escrito que desde esta tanda `db:rollback` revierte M2 primero (hacen falta
dos rollbacks para deshacer M1).

---

## Bloque 5 — Guardias de cierre (T3.6, T5.1) · backend_dev · 2026-08-15

### Archivos creados

- `tests/unit/guards/hilo-ventana-alcanzable.guardia.test.ts` (T3.6 — **R38, R36**) — 8 tests
- `tests/unit/guards/orden-nota-frontera.guardia.test.ts` (T5.1 — **R2, R29**) — 10 tests

Modificado solo un comentario: `lib/types/orden-nota.ts:4-7` citaba como patron
`nota-privada-mensajero.ts`, archivo que esta misma feature borro. Referencia muerta corregida.

### Como muerde la guardia de R38/R36

`VENTANA_ESCRITURA` se **importa** como valor. Los dos cortes de pantalla **no se pueden importar**
(`ESTATUS_DEVUELTA`, `ORIGEN_RECOGER` y `ESTADO_EN_REPARTO` son `const` privados de modulo), asi que
se leen del FUENTE con extraccion **estructural**, no textual: se localiza la declaracion
(`novedadWhere`, `listarMisAsignaciones`), se emparejan parentesis y llaves con un contador de
anidamiento, se extrae el `estatus: { value: … }` y los elementos del array de
`findMisAsignaciones(…)`, y cada identificador se resuelve a su literal. **Ni un literal de estatus
escrito a mano en el cruce de R38.** Todo camino sin hallazgo REVIENTA con el patron y el archivo
que dejo de casar: nunca «no encontre nada → verde». Hay ademas un control de no-vacuidad que exige
que lo extraido este en `ORDER_STATUS_SEED`. Sobrevivio a un reformateo real (la mutacion 2
reescribio la lista en multilinea y la extraccion la leyo igual).
El unico censo escrito a mano es el de R36 (`["en_reparto","por_recoger"]`), que es literalmente lo
que el requisito manda afirmar.

### Mutaciones probadas — ninguna quedo viva

| # | Mutacion | Archivo | Resultado |
| --- | --- | --- | --- |
| 1 | ventana del mensajero: `en_reparto` -> `entregada` | `lib/types/ventana-hilo-notas.ts` | **ROJO** R38: «su ventana es `entregada`, pero su pantalla solo lista [por_recoger, en_reparto] — el permiso existe y es INEJERCITABLE» |
| 2 | tercer estatus (`recolectando`) en la lista + reformateo a multilinea | `MisAsignacionesService.ts` | **ROJO** R36 |
| 2b | quitar `ESTADO_EN_REPARTO` de la lista | `MisAsignacionesService.ts` | **ROJO DOBLE**: R36 y R38. Es el escenario EXACTO que la decision D1 cerro |
| 3 | `console.log("publicando nota", cuerpo)` | `OrdenNotaService.ts` | **ROJO** R29 |
| 4 | vaciar el `catch` de `handleBorrar` | `HiloNotasOrden.tsx` | **ROJO** R29 (el comentario dentro del catch no lo salva: se lee el codigo sin comentarios) |
| 5 | texto de rechazo interpolando el borrador | `HiloNotasOrden.tsx` | **ROJO** R29: «los textos de rechazo son FIJOS y sin PII» |
| 6 | `editarCuerpo` añadido a la interfaz + al service | `IOrdenNotaService.ts`, `OrdenNotaService.ts` | **ROJO** R2 |
| 7 | edicion SIN nombre: `data: { deletedAt, cuerpo: "" }` dentro de `marcarBorrada` | `OrdenNotaRepository.ts` | **ROJO** R2: «ninguna escritura del repositorio toca la columna `cuerpo` salvo el `create`» |

Cada archivo se restauro desde copia previa y se verifico con `cmp` **byte a byte**: identicos.

### Salida real

```
$ pnpm exec tsc --noEmit                 EXIT 0
$ pnpm exec eslint tests/unit            EXIT 0 — 51 warnings preexistentes
$ pnpm run test:guardias
 Test Files  103 passed (103)
      Tests  1548 passed (1548)
```
Baseline de guardias 101/1530 -> **103/1548: +2 archivos, +18 tests, cero rojos nuevos.**

### Contradiccion spec ↔ codigo reportada (decision para el leader/reviewer)

`design.md` §2.2 «Constantes de la ventana» dice que ni `"devuelta"` ni `"en_reparto"` se escriben a
mano, sino que se reutilizan las que ya existen, «promovidas a un modulo compartido si hace falta».
**El codigo implementado SI reescribe los dos literales** en `lib/types/ventana-hilo-notas.ts`; los
originales siguen siendo `const` privados en sus modulos y nadie los promovio. Hoy hay dos literales
de `devuelta` y dos de `en_reparto`.

No se cambio (es codigo de produccion, fuera del encargo de esa tanda) y hay un atenuante fuerte:
**con T3.6 en su sitio la divergencia ya no puede pasar callada** — si alguien mueve
`ESTATUS_DEVUELTA` o la lista del panel sin mover la ventana, la guardia se pone roja. Es un cierre
**por vigilancia** en vez de por construccion: mas debil que la constante unica que pedia el design,
pero no es un agujero abierto. Unificarlas (o dejar escrito en el design que se opto por vigilarlas)
es decision del leader.

---

## Cierre del hueco de R25 (fuera de las tandas del spec)

Detectado por el implementer al construir el mapa: la tabla de trazabilidad citaba
«`tests/components/AsignacionDetalle` (existente)» y **ese archivo NO EXISTIA**. Es el mismo defecto
que ya habia aparecido con `tests/components/PosOrderCard*.test.tsx`: el spec nombra tests fantasma.
Consecuencia real: R25 tenia cubierta su mitad de SERVICIO pero **no la mitad de UI** que el
requisito exige literalmente («su presentacion actual en el detalle del mensajero se conserva»).

Creado `tests/components/AsignacionDetalle.test.tsx` (2 tests):
- «R25: el detalle del mensajero sigue mostrando la nota de la TIENDA con su etiqueta»
- «R25: sin nota de la tienda, el campo se conserva con el marcador de vacio»

`AsignacionDetalle` es presentacion pura: se monta en aislado **sin ningun cambio de produccion** y
sin mocks. La asercion no busca texto suelto: exige que «Notas» sea un `<dt>` y que su
`nextElementSibling` sea el `<dd>` con el contenido, para que muerda si se renombra la etiqueta o se
rompe la pareja.

Mutaciones (revertidas): renombrar la etiqueta a «Observaciones» → 2 rojos; sustituir el campo entero
por un `<div />` → 2 rojos; original → 2 verdes. El `git diff` de `AsignacionDetalle.tsx` sale VACIO.

**Correccion aplicada al spec** (`tasks.md`): las dos celdas que citaban tests fantasma
(R21 y R25) ahora nombran los archivos REALES y dicen que son NUEVOS, no «existentes».

---

## T5.3 — GATE COMPLETO (`./init.sh`), 2026-08-15

Corrido con redireccion a fichero, no pipeado (init.sh pipeado devuelve el exit del pipe, no el suyo).

```
== Arnes SDD :: init (modo: completo) ==
✓ node v22.13.1
✓ dependencias presentes
✓ typecheck paso
✓ lint paso        (solo warnings preexistentes; 0 errors)

 Test Files  2 failed | 1102 passed (1104)
      Tests  2 failed | 14145 passed (14147)
   Duration  681.40s
✗ fallo el paso de tests
```

**Total de archivos: 1104.** No es una corrida degradada: no hay «unhandled errors» de workers ni
archivos omitidos (una suite saturada omite archivos enteros y parece casi verde; aqui el total es el
esperado, y creciente respecto al baseline documentado en `docs/verification.md`, que es de agosto-03).

### Los 2 rojos NO son regresiones: son flakes por saturacion. Comprobado en AISLADO.

Ambos fallan por «Test timed out in 20000ms», no por asercion, y **ninguno de los dos toca nada de
la feature 227**:
- `tests/components/TableroOperativo.test.tsx` > Feature 131 (R8)
- `tests/integration/wallet-tiendas-desglose.test.tsx` > R45

```
$ pnpm exec vitest run tests/components/TableroOperativo.test.tsx tests/integration/wallet-tiendas-desglose.test.tsx
 Test Files  2 passed (2)
      Tests  80 passed (80)
   Duration  37.01s
```

**Veredicto del gate: typecheck y lint verdes; suite verde salvo 2 timeouts por saturacion que pasan
en aislado y son ajenos a esta feature. El delta atribuible a la 227 es CERO rojos.**

### Guardias (van siempre: ningun grafo de imports las selecciona)

```
$ pnpm run test:guardias
 Test Files  103 passed (103)      Tests  1548 passed (1548)
```
Baseline al empezar la feature: 101 archivos / 1530 tests. Delta: **+2 archivos, +18 tests, 0 rojos.**

---

## T5.2 — MAPA `R<n> -> test`  ·  37/37 requisitos cubiertos

Conjunto final **R1-R36 + R38 = 37**. **R37 NO EXISTE**: se retiro a la ficha 228 y su numero no se
reutiliza (por eso la tabla salta de R36 a R38).

| R | Test que lo cubre | Estado |
| --- | --- | --- |
| R1 | `tests/unit/services/orden-nota-service.test.ts` — «publicar añade una nota sin alterar las previas del hilo» | verde |
| R2 | `tests/unit/guards/orden-nota-frontera.guardia.test.ts` — «el modulo del hilo no exporta ninguna operacion que reescriba el cuerpo» | verde (mutaciones 6 y 7) |
| R3 | `tests/integration/repositories/orden-nota.int.test.ts` — «devuelve el hilo en orden ascendente y estable con instantes repetidos» | verde |
| R4 | service — «conserva el rol con el que se publico aunque el rol del usuario cambie» | verde |
| R5 | service — «ignora un autor enviado en la entrada y usa el de la sesion» | verde |
| R6 | `tests/unit/actions/orden-notas-action.test.ts` — «rechaza un cuerpo que queda vacio al recortar y no crea nota» | verde |
| R7 | actions — «acepta 200 caracteres y rechaza 201 sin crear nota» | verde |
| R8 | actions — «devuelve rechazo tipado sobre una orden inexistente, sin excepcion» | verde |
| R9 | service — «permite al adminTienda leer y publicar en una orden de su tienda» | verde |
| R10 | service — «rechaza igual una orden de otra tienda y una inexistente, sin revelar cual es» | verde |
| R11 | service — «da acceso al mensajero asignado y rechaza al no asignado, tambien en lectura» | verde |
| R12 | service — «rechaza a maestro, admin y adminSatelite en leer, publicar y eliminar» | verde |
| R13 | actions — «devuelve no autenticado sin llamar al servicio» | verde |
| R14 | service — «la tienda publica solo en devuelta y el mensajero solo en en_reparto (matriz rol × estatus)» + «`por_recoger` NO abre ventana para nadie» | verde |
| R15 | service — «devuelve el hilo completo con la orden ya fuera de devuelta» | verde |
| R16 | `tests/components/HiloNotasOrden.test.tsx` — «pinta cada nota con su autor y su hora y distingue las propias» | verde |
| R17 | HiloNotasOrden — «tras publicar y tras eliminar solicita el refresco de datos del servidor» | verde |
| R18 | HiloNotasOrden — «muestra el motivo del rechazo y no pinta el cambio como aplicado» | verde |
| R19 | HiloNotasOrden — «con puedeEscribir muestra el compositor y sin el lo oculta junto a los controles de borrado» | verde |
| R20 | `tests/unit/guards/nota-privada-retirada.guardia.test.ts` — «no queda ningun archivo ni simbolo de la nota privada del mensajero» | verde (mutacion) |
| R21 | `tests/unit/services/mis-asignaciones-service.test.ts` — «el DTO no emite el campo de nota privada» + `tests/components/PosOrderCardSinNotaPrivada.test.tsx` (las 3 vistas) | verde |
| R22 | guardia de retirada — «ninguna migracion ni modulo de la 227 lee orden_mensajero_meta.nota» | verde (mutacion del INSERT-SELECT) |
| R23 | `tests/integration/db/orden-mensajero-meta-drop-nota-migration.test.ts` — «el up retira la columna y el down la repone nullable» | verde, **DDL ejecutado de verdad** |
| R24 | `tests/integration/repositories/orden-mensajero-meta.int.test.ts` **SIN MODIFICAR** + `tests/components/MarcarLuegoToggle.test.tsx` | verde |
| R25 | service — «publicar en el hilo no altera la nota de la tienda» + `tests/components/AsignacionDetalle.test.tsx` — «R25: el detalle del mensajero sigue mostrando la nota de la TIENDA con su etiqueta» | verde |
| R26 | `tests/integration/db/orden-nota-migration.test.ts` — RLS habilitada y CERO policies | verde, catalogo real |
| R27 | actions — «devuelve validation_error con errores por campo ante una entrada mal formada» | verde |
| R28 | service — «lee el hilo con una sola llamada al repositorio» + migracion M1 — indice `(orden_id, created_at)` | verde (ver desviacion 3 del Bloque 2) |
| R29 | `tests/unit/guards/orden-nota-frontera.guardia.test.ts` — «los modulos del hilo no registran el cuerpo ni tragan errores» | verde (mutaciones 3, 4 y 5) |
| R30 | migracion M1 — «borrar la orden ARRASTRA sus notas y no deja ni una huerfana» | verde, borrado real |
| R31 | service — «el autor elimina su nota dentro de su ventana y el resto del hilo queda intacto» + integracion — «el borrado logico conserva la fila y su autoria» | verde |
| R32 | service — «la contraparte y un maestro no pueden eliminar una nota ajena» + integracion — «el borrado filtra por autor en el mismo statement» | verde |
| R33 | service — «devuelve el mismo resultado tipado ante una nota inexistente, ajena o ya eliminada» | verde |
| R34 | service — «una nota eliminada viaja marcada, con autor y hora, y con el cuerpo vacio» + HiloNotasOrden — «pinta «nota eliminada» conservando el hueco» | verde |
| R35 | service — «fuera de su ventana, ningun rol puede eliminar ni siquiera sus propias notas» | verde |
| R36 | `tests/unit/guards/hilo-ventana-alcanzable.guardia.test.ts` — «listarMisAsignaciones sigue leyendo exactamente por_recoger y en_reparto» | verde (mutaciones 2 y 2b) |
| R38 | misma guardia — «cada rol tiene al menos un estatus alcanzable en su pantalla donde puede publicar» | verde (mutaciones 1 y 2b) |

---

## Lo que el leader tiene que decidir o vigilar

1. **Conteo de PRODUCCION del drop: NO MEDIDO** (ver T0.1). El local es 0 con la tabla vacia y no
   informa. Alguien con credencial debe correr la consulta y pegarla **antes** de aplicar M2 alli.
   La cabecera de M2 lo dice explicitamente. La decision humana (P1) no depende de ese numero.
2. **`borrarNotaSchema` real es `{ ordenId, notaId }`**, no `{ notaId }` como escribe design §3. Es
   estrictamente mas restrictivo y cierra un agujero de R35. Ver Bloque 2, desviaciones 1 y 2.
3. **Las constantes de la ventana quedan VIGILADAS, no unificadas** (design §2.2 pedia promoverlas a
   un modulo compartido). Ver Bloque 5, contradiccion.
4. **La lectura del hilo va con SWR** (el design admitia «re-invocacion de la accion de lectura»).
5. **El spec nombraba dos tests fantasma** (`PosOrderCard*.test.tsx` y `AsignacionDetalle`). Ambos
   creados; las celdas de `tasks.md` corregidas.
6. **T0.2 y T0.3 quedan SIN marcar en `tasks.md`**: son del leader (corregir el `description` de la
   227, que sigue diciendo «append-only … sin update», y dar de alta la ficha 228).
7. **`pnpm run db:migrate` es inusable en esta base local** por migraciones ajenas ya aplicadas
   (exige `reset` de todo el esquema). Se uso `prisma migrate deploy` + `pnpm run db:rollback`. No es
   deuda de esta rama.
8. **Sin notificacion y sin indicador** (R38/D3): la 227 no emite ningun aviso y ninguna card gana
   badge. Hasta la ficha 228, **el mensajero solo se entera de que hay notas si ABRE la orden**.

---

# RONDA 2 — correccion del RECHAZO del reviewer (2026-08-15)

Informe del reviewer: `progress/review_227.md`. **Un bloqueante (B1) y tres menores (m1, m2, m5).**
Lo aprobado no se toco: 37/37 requisitos verificados uno a uno por el reviewer, 7 mutaciones propias
suyas (las 7 muertas), las cinco invariantes intactas, cero codigo muerto de la 116 y las migraciones
confirmadas como ejecucion real. Las cinco contradicciones declaradas: las cinco aceptadas.

## B1 — el gate estaba ROJO por un test de la PROPIA 227 (deadlock 40P01)

**Mi diagnostico de la ronda 1 era incompleto y hay que decirlo.** Atribui los rojos del gate a los
dos flakes de saturacion conocidos (`TableroOperativo`, `wallet-tiendas-desglose`) y los verifique en
aislado, lo cual era correcto **pero no era todo**: en la corrida del reviewer esos dos pasaron y
afloro un rojo PROPIO que en mi corrida quedo tapado detras de ellos.

    FAIL tests/integration/db/orden-nota-migration.test.ts
    PrismaClientKnownRequestError: Raw query failed. Code: 40P01 — se ha detectado un deadlock

**Lo grave no era el rojo, sino su forma.** Al reventar el `beforeAll`, vitest marcaba **13 tests
como `skipped`**, no como fallidos: justo los que verifican **R26** (RLS y cero policies), **R28**
(indice compuesto) y **R30** (CASCADE ejercitado). La mitad de las corridas, la evidencia de tres
requisitos **no se ejecutaba** y el archivo lo reportaba como omitido. Es el patron «suite que omite
y parece casi verde» —que este repo ya tiene documentado como forma de mentir en verde— instalado
dentro de la propia feature.

### Causa

Los tres archivos de DB nuevos escriben en `public."usuario"` y `public."orden"` en transacciones
largas y CONCURRENTES (vitest da un worker por archivo) y toman los mismos locks en ORDEN DISTINTO:
los `KEY SHARE` de FK sobre los catalogos y el `SHARE ROW EXCLUSIVE` que un
`ADD CONSTRAINT … REFERENCES public."usuario"` toma sobre la tabla referenciada. Receta exacta de un
ciclo de espera. Reproducido antes de tocar nada: `Test Files 1 failed | 2 passed (3)`,
`Tests 27 passed | 7 skipped (34)`.

### Camino elegido: `pg_advisory_xact_lock` como PRIMERA sentencia de cada transaccion

`tests/integration/db/_postgres-real.ts` gana **solo dos exports nuevos** (`CLAVE_LOCK_ESCRITURA_REAL`,
`serializarEscriturasReales`); **ninguna funcion existente cambia**, asi que los demas tests que usan
ese helper quedan identicos (lo confirma el gate: 1105/1105). Los tres archivos de la feature lo
llaman como primera linea de su `medir`.

**Por que este y no un reintento:** reintentar un deadlock lo esconde; serializar la seccion critica
lo ELIMINA — si nunca hay dos de esas transacciones vivas a la vez, no hay ciclo posible.

**Por que `pg_advisory_xact_lock` y no `LOCK TABLE`:** el lock de aviso solo bloquea a quien pide
ESA clave (los otros ~1100 archivos siguen en paralelo) y se suelta solo al terminar la transaccion,
incluido el rollback y la muerte del proceso, sin un `finally` que mantener.

### Los otros dos caminos, descartados con motivo

- **Desactivar el paralelismo para esos tres archivos.** Vitest no permite marcarlos sin sacarlos a
  un pool aparte o bajar `fileParallelism` global; lo primero es cirugia de configuracion para tres
  archivos, lo segundo penaliza a los ~1100 restantes en un gate que ya dura 8 minutos. Y solo los
  serializa ENTRE SI dentro de vitest, no contra cualquier otra transaccion futura: garantia mas
  debil y en la capa equivocada.
- **Crear las filas de apoyo en el esquema temporal** (el que el reviewer llamaba «probablemente el
  mas limpio»). **Descartado tras leer los tests, y conviene que quede escrito por que:** el `it` de
  R30 hace `DELETE FROM public."orden"` y cuenta huerfanas contra `public."orden"`; la FK se asserta
  con `tabla_referenciada === "orden"` leido de `pg_constraint`; el RESTRICT se ejercita con un
  `DELETE FROM public."usuario"`. Con copias en el esquema temporal, el CASCADE y el RESTRICT
  medidos serian los de **tablas de juguete escritas por el propio test**: demostrarian que una
  tabla inventada cascadea, no que lo haga el esquema de produccion. Ese camino no debilita el
  sintoma, debilita **R26, R28 y R30**.

### Criterio de aceptacion 1 — el trio, 5 corridas seguidas (agente)

```
=== CORRIDA 1 EXIT=0   Test Files  3 passed (3)   Tests  34 passed (34)   2.21s
=== CORRIDA 2 EXIT=0   Test Files  3 passed (3)   Tests  34 passed (34)   2.84s
=== CORRIDA 3 EXIT=0   Test Files  3 passed (3)   Tests  34 passed (34)   2.79s
=== CORRIDA 4 EXIT=0   Test Files  3 passed (3)   Tests  34 passed (34)   2.19s
=== CORRIDA 5 EXIT=0   Test Files  3 passed (3)   Tests  34 passed (34)   2.59s
```
`skipped` = 0 en las cinco (34 = 34 passed, frente al baseline roto `27 passed | 7 skipped (34)`).

**Reverificado por el implementer, 3 corridas independientes mas:** EXIT=0 · 3 passed (3) ·
34 passed (34) las tres veces. **8 corridas verdes en total, cero deadlocks.**

### Criterio de aceptacion 2 — los 13 tests SE EJECUTAN (no desaparecieron)

Comprobado por el implementer con `--reporter=verbose` sobre el archivo: **13 lineas, las 13 con `✓`
y su tiempo**, dentro del bloque `227 / M1 — el DDL REAL contra Postgres (R26, R28, R30)`, incluidos
nominalmente «R26: relrowsecurity es true», «R26: CERO policies», «R28: existe el indice compuesto
(orden_id, created_at) EN ESE ORDEN», «R30: la FK a `orden` es ON DELETE CASCADE, leida de
pg_constraint» y «R30: borrar la orden ARRASTRA sus notas y no deja ni una huerfana».
El archivo conserva el mismo numero de tests: **no se borro ni se salto ninguno; se ejecutan los que
antes quedaban en `skipped`.**

### Lo que NO se hizo

Cero cambios en codigo de produccion, migraciones o schema. Ninguna asercion debilitada. Ni `.skip`,
ni `.todo`, ni `retry`, ni timeouts inflados.

### Criterio de aceptacion 3 — `./init.sh` COMPLETO en EXIT 0

Corrido DOS veces: una por el agente y otra, independiente, por el implementer. Ambas redirigidas a
fichero con `$?` leido aparte (pipeado se traga el exit code: `./init.sh | tail` devuelve el de `tail`).

```
$ cd /c/w227 && ./init.sh > gate227b.txt 2>&1; echo "EXIT=$?"
EXIT=0

✓ node v22.13.1
✓ dependencias presentes
✓ typecheck paso
✖ 65 problems (0 errors, 65 warnings)
✓ lint paso
 Test Files  1105 passed (1105)
      Tests  14149 passed (14149)
✓ test paso
✓ todas las migraciones tienen down.sql
✓ .env presente
== init OK ==
```

**Total de archivos: 1105** — exactamente el que midio el reviewer, asi que no es corrida degradada
(sin «unhandled errors» de workers; una suite saturada omite archivos enteros y parece casi verde).

**La aritmetica que pedia el reviewer, cuadrada:**

| | Corrida del reviewer (rota) | Ahora |
| --- | --- | --- |
| Archivos | 1 failed \| 1104 passed (1105) | **1105 passed (1105)** |
| Tests | 14136 passed \| **13 skipped** (14149) | **14149 passed \| 0 skipped** |
| EXIT | 1 | **0** |

`passed` sube **exactamente en 13** y `skipped` baja a **0**: los 13 tests de R26/R28/R30 pasaron de
omitirse a ejecutarse, que era el fondo del bloqueante. Cero flakes en esta corrida:
`TableroOperativo` y `wallet-tiendas-desglose` pasaron.

Los 65 warnings de lint son preexistentes y con **0 errores**; el gate los admite.

---

## Menores del reviewer

### m1 — `tasks.md` T5.3 afirmaba un gate verde que no lo estaba

Corregido. La casilla volvio a `[ ]` con una nota que deja escrito el error **y su causa**: la ronda
1 la marco «verde» con `./init.sh` en EXIT 1, atribuyendo los rojos a flakes ajenos con un
diagnostico que era **incompleto**. Se vuelve a marcar `[x]` ahora, con el EXIT 0 verificado dos
veces arriba. *No se borro el rastro del error: el spec conserva por que estuvo mal.*

### m2 — `tasks.md` T4.8 afirmaba «sin modificarlos» sobre dos archivos, y uno SI estaba modificado

Corregida **la afirmacion, no el cambio** (que es correcto y obligado):
`tests/components/MarcarLuegoToggle.test.tsx` tiene −6 lineas porque se retiro el
`vi.mock("@/lib/actions/notas-privadas-mensajero")` de un modulo que esta feature BORRA — sin
retirarlo, el archivo reventaria al importar. Es cambio de **andamiaje**, no de comportamiento:
ninguna asercion del toggle se toco, asi que lo que R24 exige (que `marcar_luego` siga comportandose
igual) sigue demostrado. `tests/integration/repositories/orden-mensajero-meta.int.test.ts` si esta
**intacto**, y la celda ahora lo dice con precision.

### m3 — conteo de produccion del drop: NO se toca

El reviewer lo dio por correcto bajo la regla 6 («no inventes»): es precondicion de despliegue, no
defecto de implementacion. Sigue declarado como PENDIENTE en T0.1 y en la cabecera de M2.

### m4 — nada commiteado: es del leader, por diseño

### m5 — entrada en `progress/history.md`

Añadida.

---

## Ajustes de spec pedidos por el reviewer (hechos)

| Donde | Que se escribio |
| --- | --- |
| `design.md` §3 | `borrarNotaSchema` pasa a `{ ordenId, notaId }` **con el motivo**: sin `ordenId` los pasos 2-4 de §2.2 son inejecutables y R35/R10/R11 quedan sin aplicar en `borrar`; el agujero concreto era borrar una nota de la orden B desde la ventana abierta de la orden A |
| `requirements.md` R28 | reescrita la clausula *Testeable*: decia «exactamente una llamada», **inalcanzable por construccion** porque el paso de autorizacion es obligatorio. Ahora afirma lo que el test mide: 1 llamada a `listarPorOrden` (nunca una por nota) y **total 2, CONSTANTE con el tamaño del hilo**. El texto normativo no cambia |
| `design.md` §2.2 | escrito que las constantes de ventana quedan cerradas **por VIGILANCIA y no por unificacion** (que era lo que el design pedia): siguen duplicadas, y lo que impide la divergencia es la guardia de R38/R36, que extrae los cortes de pantalla del fuente de forma **estructural** y revienta si el patron deja de casar. Cierre mas debil que la constante unica, pero **no puede pasar callado**. Deuda declarada, no olvido |
