# 424 — El `admin` puede eliminar órdenes · Tareas

> **Zona:** `backend`. Rama: `feat/424-admin-elimina-ordenes`.
>
> **Gate:** `./init.sh --rapido`. El diff **no** toca `db/migrations/**`, `db/schema.prisma`,
> `lib/types/**` ni configuración de build (design §2), así que el modo rápido **no se niega**.
>
> ⚠️ **`DATABASE_URL` resoluble es obligatorio.** T7 y T8 viven en `tests/integration/db/**`: sin
> base se **saltan** y el gate sale verde sin haber medido la contrapartida que sostiene toda la
> ficha. Mira los `skipped`, no solo el `INIT_EXIT`.
>
> **Cero migraciones.** Si en algún momento esta ficha necesita una, algo se entendió mal: el enum
> `rol_value` ya contiene `admin` y `historial_accion.actor_rol` es de ese tipo.

---

## Tanda 1 — La regla

### T1 · `admin → todas` en la fuente única, con la reversión escrita
**Depende de:** nada.
**Archivos:** `lib/services/alcance-borrado-orden.ts`.
**Qué:** que `resolverAlcanceBorradoOrden` devuelva `{ alcance: "todas" }` también para `admin`.
El comentario de la función dice hoy que el estrechamiento del 2026-08-27 «NO se toca aquí»; pasa a
llevar el bloque de design §1.1 — **fecha (2026-09-14), autor (Carlos Restrepo), lo que se revierte
y qué lo sostiene**. Sin reabrir el debate y sin borrar la historia previa: se añade el capítulo
nuevo, no se tacha el viejo.
**Hecho cuando:** `pnpm run typecheck` verde y el archivo nombra la fecha y el motivo de la
reversión, además del motivo del estrechamiento original.

### T2 · El test de la fuente única, que ES el contrato
**Depende de:** T1.
**Archivos:** `tests/unit/services/alcance-borrado-orden.test.ts`.
**Qué:** `admin` sale del `it.each` de «→ denegado» y entra en el caso de «→ todas», junto al
`maestro`. El `toEqual` final de clasificación del catálogo ENTERO **es el contrato** (no un
polizón): pasa a `todas: [maestro, admin]`, `denegado: [mensajero, adminSatelite]`. El comentario
que explicaba que el `admin` estaba fuera se actualiza a la reversión, conservando por qué se
estrechó en su día.
**Hecho cuando:** el archivo pasa, la clasificación recorre el enum real de Prisma (no una lista a
mano) y `propias` sigue exigiendo `ownerId` no vacío.

### T3 · El servicio del borrado por pantalla autoriza al `admin`
**Depende de:** T1.
**Archivos:** `tests/unit/services/eliminar-orden-service.test.ts`. **`EliminarOrdenService.ts` no
cambia de código** (solo su comentario, T10).
**Qué:** `ADMIN` sale de la tabla de «recibe forbidden y NO se toca la base» —que se queda con
`adminSatelite` y `mensajero` (R5)— y gana casos propios: (a) borra una orden eliminable de
**cualquier** tienda, con `ownerId: null` en la llamada a `softDelete` (R1); (b) un lote con una
orden no eliminable sale `conflict` y **no borra ninguna** (R2); (c) el motivo por orden se
distingue igual que para el `maestro`.
**Hecho cuando:** los tres casos pasan, (a) afirma el `ownerId: null` del argumento (no solo el
`status`) y la tabla de `forbidden` sigue teniendo testigos vivos.

### T4 · Ofrecer y autorizar coinciden para el `admin`, estado por estado
**Depende de:** T1.
**Archivos:** `tests/unit/services/eliminar-criterio-unico.test.ts`.
**Qué:** el archivo recorre el catálogo entero preguntando a los dos servicios y hoy lo hace para
`MAESTRO` y `TIENDA`. Entra `ADMIN` como tercer rol, con el mismo doble de intentos para los dos
lados (si cada lado sembrara el suyo, el verde no significaría nada).
**Hecho cuando:** la matriz cubre los tres roles y el catálogo entero de estados; cambiar un estado
en una sola de las dos rutas pone el archivo rojo.

### T5 · El canal por API key sigue cerrado, y se afirma **[P]**
**Depende de:** T1.
**Archivos:** `tests/unit/services/api-orden-eliminacion-service.test.ts`.
**Qué:** un caso con actor de rol `admin` (alcance `todas`): la respuesta es `not_found` y **ni
`findParaEliminacionApi` ni `softDeleteViaApi` se llaman**. Con el comentario de design §3.3/D1:
por este canal no entra un `admin`, y si alguien cablea el servicio en otro sitio, falla cerrado.
**Hecho cuando:** el caso pasa con `not.toHaveBeenCalled()` en los dos métodos del repo. Este es el
test que NO debe ponerse rojo con la mutación 1 de T11.

---

## Tanda 2 — La pantalla

### T6 · `puedeEliminar` derivado de la fuente única, y el caso que se invierte
**Depende de:** T1.
**Archivos:** `app/(app)/ordenes/page.tsx`; `tests/components/OrdenesPage.test.tsx`;
`tests/unit/services/orden-service.test.ts`.
**Qué:**
1. `page.tsx`: `puedeEliminar` pasa a derivarse de `resolverAlcanceBorradoOrden(actor)` (design §4,
   **R20** — confirmado por el humano el 2026-09-14: nada de añadirle `|| admin` a una segunda
   lista). `puedeVerEliminadas` **no se toca** y sigue siendo el literal `rol === maestro`. El
   comentario que dice «`admin` NO entra en ninguna de las dos» pasa a decir que entra en la
   primera y no en la segunda, con la fecha.
2. `OrdenesPage.test.tsx`: el caso «eliminar: el `admin` NO la recibe — el estrechamiento del
   2026-08-27 sigue en pie» **se invierte**: con una fila `eliminable: true`, el `admin` recibe la
   casilla y la acción «Eliminar». El comentario del bloque explica que se invierte a petición del
   humano el 2026-09-14. El caso del `adminTienda` (358) **se conserva intacto**.
3. `orden-service.test.ts`: un caso que afirma que `eliminable` viaja para un actor `admin` sobre
   una fila de **otra** tienda (no hay recorte de dueño) y sigue sin viajar para `mensajero`.
**Hecho cuando:** los tres pasan; `grep` de `RolValue.maestro || rol === RolValue.adminTienda` en
`page.tsx` da cero; y `puedeVerEliminadas` sigue siendo un literal distinto.

---

## Tanda 3 — La contrapartida: el rastro, medido

> Esta tanda **no es opcional ni "extra"**: es REQUISITO de la ficha por decisión del humano
> (2026-09-14, `requirements.md` D1) y es lo que sostiene la reversión. Hoy nadie mide el congelado
> con el rol `admin` — el caso existente resuelve el actor con `findFirstOrThrow()` sin filtrar por
> rol (design §6.2).
>
> ⚠️ **Es BLOQUEANTE.** Si al medir resulta que el rastro no queda, o que el `maestro` no puede
> consultarlo con el rol nuevo, **se reporta y se para**. No se tapa, no se degrada a pendiente, no
> se sigue con el resto. Y no se estrena mecanismo nuevo: lo que se mide es el historial que ya
> existe (ficha 362).

### T7 · Contra Postgres: borrar como `admin` deja nombre y rol congelados
**Depende de:** T1.
**Archivos:** `tests/integration/db/historial-accion-atomicidad.test.ts` (caso nuevo) **o**
`tests/integration/db/orden-eliminada-actor-admin.test.ts` (nuevo, mismo patrón de transacción
revertida).
**Qué:** dentro de una transacción revertida, resolver (o sembrar) un usuario **con rol `admin`**,
borrar 2 órdenes con `repo.softDelete({ ids, ownerId: null, actorUsuarioId: <ese admin> })` y
afirmar sobre `historial_accion`:
- **dos** filas, una por orden, `accion = orden_eliminada`, `entidad_tipo = orden` (R11);
- `actor_rol === "admin"` y `actor_nombre` igual al nombre compuesto de esa persona (R11, R12);
- **un solo** `lote_id` para las dos, y distinto del de un segundo acto (R13);
- una orden ya borrada del mismo lote **no** deja fila (R14).
⚠️ **Prohibido** el `if (!fks) return;`: si no hay datos para sembrar, el caso **falla**, no se
salta. Anti-vacuidad explícita: afirmar primero que el actor resuelto tiene rol `admin`.
**Hecho cuando:** pasa con `DATABASE_URL` puesta, y **se pone rojo** con la mutación 3 de T11.

### T8 · Consultable: la fila se encuentra filtrando por acción y por actor
**Depende de:** T7.
**Archivos:** `tests/integration/db/historial-accion-lectura.test.ts` (caso nuevo, junto a los
«R29 filtro por ACTOR / por TIPO DE ACCION»).
**Qué:** sembrado un borrado hecho por un actor de rol `admin`, pedir la lectura por el camino real
(`HistorialAccionService.listar`) con `{ accion: ["orden_eliminada"], actorId: [<ese admin>] }` y
afirmar que la fila sale con `actorNombre` y `actorRol: "admin"`, y que el filtro por otro actor
**no** la devuelve (R15). Actor de la consulta: `maestro`.
**Hecho cuando:** pasa, y el caso negativo (otro actor) excluye la fila.

### T9 · El `admin` no audita su propio registro, y no recupera **[P]**
**Depende de:** T1.
**Archivos:** `tests/unit/historial-accion/lectura-borde-y-servicio.test.ts` (o el archivo de
autorización del módulo); `tests/unit/services/recuperar-orden-service.test.ts`;
`tests/unit/services/orden-service.test.ts`.
**Qué:** tres afirmaciones de no-regresión, que pasan a ser deliberadas y no accidentales:
- `HistorialAccionService.listar/listarCompleto/obtenerCatalogoActores` con actor `admin` →
  `forbidden`, **sin llamar al repositorio** (R16). Si ya existe, basta con referenciarlo en el
  mapa y añadir el comentario de por qué importa ahora.
- `RecuperarOrdenService.recuperar` con actor `admin` → `forbidden` y sin tocar la base (R17): el
  caso ya existe, se le añade el comentario de que a partir de hoy la asimetría es **decisión del
  humano** (2026-09-14, D1: «que borre»; la papelera no se le abre) y no un resto del
  estrechamiento del 2026-08-27.
- `OrdenService.listar` con `filter.eliminados = true` y actor `admin` → `forbidden` (R18).
**Hecho cuando:** los tres pasan y ninguno depende de que `admin` esté en `denegado` para el
borrado (si lo estuviera, serían vacíos).

---

## Tanda 4 — Cierre

### T10 · Los comentarios que quedan mintiendo **[P]**
**Depende de:** T1.
**Archivos:** `lib/services/EliminarOrdenService.ts` (bloque del paso 1),
`lib/services/RecuperarOrdenService.ts` («MISMO rol que el borrado» — deja de ser cierto: pasa a
decir que recuperar se queda en el `maestro` a propósito, R17),
`lib/services/ApiOrdenEliminacionService.ts` (cabecera: el canal sigue cerrado al `admin`, D1),
`app/(app)/ordenes/_components/OrdenesListado.tsx` (la nota de «ya no es sólo el maestro»),
`lib/services/OrdenService.ts` si su comentario de `marcarEliminable` enumera roles.
**Qué:** que ningún comentario del camino del borrado siga afirmando que el `admin` no puede
borrar. **Solo comentarios**: cero cambios de comportamiento en esta task.
**Hecho cuando:** `grep -ri "admin.*sigue sin poder borrar\|solo el maestro"` sobre
`lib/services/`, `lib/actions/` y `app/(app)/ordenes/` no devuelve ninguna afirmación viva que
contradiga esta ficha, y `git diff` de esta task son solo líneas de comentario.

### T11 · Autocomprobación por mutación (y se reporta el resultado)
**Depende de:** T2–T9.
**Qué:** aplicar, medir y **revertir**:

| # | Mutación | Esperado |
| --- | --- | --- |
| 1 | `admin → denegado` en `resolverAlcanceBorradoOrden` | **ROJO** en T2, T3, T4 y T6. **VERDE** en T5 (el canal API no cambia) |
| 2 | quitar `tiendaId` del `where` de `softDelete` | **ROJO** en `eliminar-orden-pantalla-frontera-tienda` (R3/R4). Confirma que abrir el rol no tocó la frontera |
| 3 | en `resolverActorCongelado`, devolver el rol vivo en vez del congelado (o `null`) | **ROJO** en T7 |
| 4 | `puedeEliminar = false` en `page.tsx` | **ROJO** en T6 (el caso del `admin` y el del `adminTienda`) |

**Hecho cuando:** las cuatro se ejecutaron **de verdad** (con la salida de la corrida pegada en
`progress/impl_424.md`, no un resumen), el árbol quedó limpio después, y cualquier resultado
distinto del esperado se investiga antes de seguir.

### T12 · Gate, evidencia y mapa
**Depende de:** T1–T11.
**Qué:** `./init.sh --rapido` con `INIT_EXIT` escrito **dentro** del log; `progress/impl_424.md`
con el mapa `R<n> → test` de abajo relleno con los nombres de archivo y de caso reales, los
`skipped` revisados (que no se saltó `integration/db`) y la salida de T11. **Commitear el informe**
junto al código: un informe sin commitear describe un disco, no una rama.
**Hecho cuando:** el log dice `INIT_EXIT=0`, el informe está en el commit y `git show --stat` de la
rama lo lista.

---

## Mapa de trazabilidad `R<n> → test`

| R | Qué fija | Test |
| --- | --- | --- |
| R1 | El `admin` borra cualquier orden, sin frontera de tienda | **T3(a)** (`ownerId: null` en la llamada) + T2 |
| R2 | Mismo criterio y mismo todo-o-nada que el `maestro` | **T3(b)(c)** + T4 |
| R3 | La tienda sigue acotada a lo suyo | T2 + `eliminar-orden-pantalla-frontera-tienda` (T11 mut. 2) |
| R4 | La frontera vive en el `where`, no en el `if` | `eliminar-orden-pantalla-frontera-tienda` (ataque directo al repo) + T11 mut. 2 |
| R5 | `mensajero` / `adminSatelite` → `forbidden` sin tocar la base | **T3** (tabla de `forbidden` que se conserva) |
| R6 | Lista de INCLUSIÓN: un rol nuevo nace sin poder borrar | **T2** (recorre el enum real de Prisma) |
| R7 | El `admin` recibe casilla y «Eliminar» sobre filas eliminables | **T6.2** (`OrdenesPage.test.tsx`, caso invertido) |
| R8 | Ofrecer y autorizar coinciden estado por estado para `admin` | **T4** + T6.3 |
| R9 | El canal por API key sigue acotado a «propias» | T2 + `eliminar-orden-api-frontera-tienda` |
| R10 | Alcance «todas» por API → `not_found` sin escribir | **T5** |
| R11 | Una fila por orden borrada, con id/nombre/rol congelados | **T7** |
| R12 | El rol registrado de un `admin` es `admin`, congelado | **T7** + T11 mut. 3 |
| R13 | Un `lote_id` por acto, no por fila | **T7** |
| R14 | Atomicidad rastro ↔ borrado en los dos sentidos | **T7** (orden ya borrada sin fila) + casos R10/R11 existentes de `historial-accion-atomicidad` |
| R15 | Quién borró es consultable filtrando por acción y actor | **T8** |
| R16 | El `admin` no lee el módulo de acciones | **T9** (primer punto) |
| R17 | El `admin` no recupera | **T9** (segundo punto) |
| R18 | El `admin` no ve las eliminadas | **T9** (tercer punto) + T6.1 (`puedeVerEliminadas` intacto) |
| R19 | Borrado lógico, historial de estados intacto | **T7** (la fila de `orden` sigue existiendo con `deleted_at`) + suite existente de `eliminar-orden-service` |
| R20 | Una sola lista de roles para ofrecer y para autorizar | **T6.1** (`grep` a cero de la segunda lista) + **T11 mut. 1** (tocar solo la fuente única pone rojo el caso de pantalla) |

## Paralelizable

`[P]` T5, T9 y T10 no dependen entre sí y solo esperan a T1.
Todo lo demás es secuencial dentro de su tanda; la tanda 2 puede empezar en cuanto T1 esté hecha.

## Antes de implementar

**No hay preguntas abiertas.** Las cuatro decisiones están cerradas por el humano el 2026-09-14 y
escritas en `requirements.md` (D1–D4): el `admin` borra y no se le abre la papelera; el registro de
quién borró es requisito y se resuelve con el historial existente de la 362; que el `admin` no lea
`/histórico/acciones` es un límite aceptado; y `puedeEliminar` se deriva de la fuente única (R20).

**Lo único que puede parar esta ficha es la tanda 3.** Si al medir T7/T8 resulta que el rastro no
queda o no es consultable con el rol `admin`, **es bloqueante**: se reporta y se para. No se degrada
a «mejora posterior», no se tapa con un test que afirme otra cosa, y no se implementa el resto
mientras tanto — es lo único que sostiene la reversión.
