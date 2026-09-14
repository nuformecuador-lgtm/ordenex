# 424 — El `admin` puede eliminar órdenes · Diseño

> Requisitos: `specs/424-admin-elimina-ordenes/requirements.md`.
> Zona: `backend` (con un cableado de una línea en la página de `/ordenes`).

---

## 1. La frase que cambia, y por qué es UNA sola

La capacidad de borrar órdenes **no** se decide con `esAccesoTotal` ni con un `if (actor.rol !==
"maestro")` dentro de un servicio. Desde la ficha 358 la decide una función pura y única:

```ts
// lib/services/alcance-borrado-orden.ts
export function resolverAlcanceBorradoOrden(actor: Actor): AlcanceBorradoOrden
//   { alcance: "todas" } | { alcance: "propias"; ownerId } | { alcance: "denegado" }
```

**Todo el cambio funcional de esta ficha es mover `admin` de `denegado` a `todas` en esa función.**

| Rol | Antes (2026-09-02, ficha 358) | Después (esta ficha) |
| --- | --- | --- |
| `maestro` | `todas` | `todas` (sin cambio) |
| **`admin`** | **`denegado`** | **`todas`** ⭑ |
| `adminTienda` | `propias` (`ownerId = usuarioId`) | igual |
| `apiKey` | `propias` (`ownerId = usuarioId`) | igual |
| `adminSatelite` | `denegado` | igual |
| `mensajero` | `denegado` | igual |

La lista sigue siendo de **INCLUSIÓN** (R6): un `RolValue` nuevo cae en `denegado` por defecto.

### 1.1 Registro de la reversión (obligatorio en el código, no solo aquí)

El comentario de esa función y el del paso 1 de `EliminarOrdenService.eliminar` afirman hoy, con
nombre y fecha, que «el `admin` SIGUE sin poder borrar». Esas dos afirmaciones pasan a decir:

> **2026-09-14 — PEDIDO HUMANO (Carlos Restrepo). Se REVIERTE el estrechamiento del 2026-08-27.**
> Aquel decía: «con dos roles capaces de borrar, el rastro de quien lo hizo deja de ser una sola
> persona». El humano lo revierte con esa consecuencia sobre la mesa. Lo que la sostiene es la
> ficha 362: cada orden borrada deja una fila con el NOMBRE y el ROL congelados de quien la borró,
> agrupadas por acto (`lote_id`) y consultables en `/histórico/acciones`. El rastro ya no es «una
> persona»: es «qué persona, con qué rol, sobre qué orden y en qué acto».

No es decoración: el test de la fuente única (`tests/unit/services/alcance-borrado-orden.test.ts`)
existe literalmente «para impedir que alguien restaure la paridad sin leer por qué se rompió», y
el siguiente lector tiene que encontrarse la decisión, no la ausencia de ella.

## 2. Modelo de datos: **cero migraciones**

No hay tabla nueva, columna nueva, enum nuevo ni RLS nueva. Lo verificado antes de decidirlo:

- `orden.deleted_at` ya existe y es el único dato que el borrado escribe (`softDelete`).
- `historial_accion.actor_rol` es de tipo **`RolValue`** (enum nativo `rol_value`), y ese enum
  **ya contiene `admin`** (`db/schema.prisma`, `enum RolValue`). Un borrado hecho por un `admin`
  escribe un valor que la columna ya admite: **no hace falta ampliar ningún enum**, y por tanto no
  aparece el problema de los `down.sql` que recrean-con-lista.
- `historial_accion` tiene RLS habilitada sin policies (solo service role); no cambia.
- El tipo de acción `orden_eliminada` y la entidad `orden` ya están en el catálogo cerrado.

**Consecuencia operativa:** el diff de esta ficha **no toca** `db/migrations/**`,
`db/schema.prisma`, `lib/types/**` ni configuración de build, así que **`./init.sh --rapido` no se
niega** por los cimientos (regla 5 de `CLAUDE.md`). Sí hay tests de integración contra Postgres
(§6.2), y sin `DATABASE_URL` resoluble **se saltan en silencio**: hay que mirar los `skipped`.

## 3. Los tres consumidores de la función, y qué le pasa a cada uno

Tocar `resolverAlcanceBorradoOrden` alcanza a **los tres**. Esto se comprobó leyendo los tres
call-sites, no se supuso:

### 3.1 `EliminarOrdenService` (borrado por pantalla) — **es el que se abre**
Paso 1: `denegado → forbidden`; si no, `ownerId = alcance === "propias" ? ownerId : null`.
Con `admin → todas`, el `ownerId` viaja `null`, exactamente como el del `maestro`: sin frontera de
tienda en el `where` del `softDelete`. Los pasos 2–4 (precarga, predicado de estado + intentos,
todo-o-nada, escritura) **no se tocan** (R2).

### 3.2 `OrdenService.marcarEliminable` (¿ofrezco el botón?) — **se abre solo, y es lo correcto**
Anota `eliminable` en cada fila **solo para quien puede borrar**, y lo resuelve con la misma
función. Con `admin → todas`, el campo empieza a viajar en las filas del `admin` con el criterio de
estado + intentos y sin recorte de dueño. Es la respuesta a R7/R8: pantalla y servidor no pueden
divergir porque leen la misma línea.

### 3.3 `ApiOrdenEliminacionService` (canal por API key) — **NO se abre, y falla cerrado**
Su paso 0 exige `alcance === "propias"`; **cualquier otra cosa, incluido `todas`, devuelve
`not_found` sin tocar la base**. Es decir: al mover `admin` a `todas`, el canal por API key lo
**rechaza** por la puerta que ya existía.

**Decisión explícita (D1): el `admin` borra por PANTALLA, no por API.** Razones:

1. Por ese canal no entra un `admin`: el borde autentica por API key y `ApiKeyAuthService` emite
   siempre rol `apiKey`. Abrirlo sería legislar sobre un camino que nadie recorre.
2. Aceptar «todas» en ese canal convertiría una credencial de integración en capaz de borrar
   órdenes de **cualquier** tienda. El 404 uniforme del canal existe precisamente para no filtrar
   siquiera la existencia de órdenes ajenas.
3. La contrapartida del rastro es **una persona**, y una API key no es una persona.

R10 fija ese rechazo con un test para que quede como decisión y no como efecto colateral.

## 4. La pantalla: `puedeEliminar` deja de ser una copia de la regla

`app/(app)/ordenes/page.tsx` decide hoy qué se **ofrece** con una copia literal de la regla:

```ts
const puedeEliminar = rol === RolValue.maestro || rol === RolValue.adminTienda;
const puedeVerEliminadas = rol === RolValue.maestro;
```

Si esta ficha solo añadiera `|| rol === RolValue.admin` ahí, quedarían **dos** listas de roles que
contestan la misma pregunta. Ese modo de fallo ya está documentado en el repo: el defecto de la
ficha 358 («Nuform quiere eliminar NA-495 y no le aparece el checkbox») fue exactamente eso.

**Decisión (D2), confirmada por el humano el 2026-09-14 y elevada a requisito (R20):**
`puedeEliminar` se **deriva** de la fuente única. Nada de añadir `admin` a una segunda lista.

```ts
// El MISMO punto que autoriza el borrado en el servidor decide si la pantalla lo ofrece.
const puedeEliminar = actor ? resolverAlcanceBorradoOrden(actor).alcance !== "denegado" : false;
```

- `alcance-borrado-orden.ts` es **puro** (sin Prisma, sin `next/`, sin entorno): importarlo desde
  un Server Component no arrastra nada. Ya lo importa `OrdenService`.
- `puedeVerEliminadas` **NO** se toca y sigue siendo el literal `rol === RolValue.maestro`: es otra
  pregunta (R18) y tiene que poder divergir. La separación de las dos props es de la ficha 358 y se
  conserva.
- `OrdenesListado` no cambia ni una línea: ya pregunta `row.eliminable === true` y ya monta la
  columna de casillas con `haySeleccion = accionesLote || puedeEliminar`.

## 5. Contratos de entrada/salida: **ninguno cambia**

| Superficie | Contrato | Cambio |
| --- | --- | --- |
| Server Action `eliminarOrdenes(input)` | `{ ordenIds: uuid[] }` → `ok \| conflict \| forbidden \| validation_error \| unauthenticated` | **Ninguno en la forma.** Lo único observable: un `admin` que antes recibía `forbidden` ahora recibe `ok`/`conflict` |
| Server Action `recuperarOrdenes` | igual | Ninguno: `admin` sigue en `forbidden` (R17) |
| Listado `/ordenes` (DTO) | `eliminable?: boolean` | Ninguno: el campo ya existía; ahora también viaja para `admin` |
| API key `DELETE` de una orden | 404/409 uniformes | **Ninguno.** `lib/api/openapi-spec.ts` y `docs/api/api-key-openapi.yaml` no se tocan (D1) |
| Módulo `/histórico/acciones` | filtros, DTO, descarga | Ninguno |

No hay endpoint nuevo, ni parámetro nuevo, ni versión de API nueva.

## 6. El rastro: qué hay hoy, y qué se verifica con el rol nuevo

### 6.1 Lo que ya está construido (ficha 362) — leído, no supuesto

`OrdenRepository.softDelete` abre una `$transaction` y dentro:

1. `UPDATE … RETURNING id, num_guia, num_remision` — devuelve las órdenes **efectivamente**
   alcanzadas (no las pedidas). El `where` conserva `deleted_at IS NULL` y el filtro de tienda
   cuando lo hay.
2. `resolverActorCongelado(tx, actorUsuarioId)` — **una** consulta que resuelve nombre compuesto y
   `rol.value` del actor.
3. `appendAccion(tx, filas.map(...), loteId)` — **una fila por orden borrada**, con
   `accion = orden_eliminada`, la etiqueta de la orden (guía o remisión), los tres campos del actor
   y un `lote_id` compartido por el acto.

Como `appendAccion` recibe la **transacción en curso** y no puede abrir la suya, R14 (atomicidad)
es estructural: un error de sentencia aborta la transacción entera.

La consulta vive en `/histórico/acciones`: filtro por **tipo de acción** (`orden_eliminada`), por
**actor**, por entidad y por fecha; las columnas incluyen `actorNombre` y `actorRol`; hay descarga
con el mismo conjunto. Lo lee **solo el `maestro`** (`ROLES_HISTORIAL_ACCIONES`).

### 6.2 Veredicto sobre la contrapartida, y lo que falta

> **Decisión del humano (2026-09-14):** «que borre, pero que quede registro en el historial que ya
> tenemos». El registro es **requisito de esta ficha**, se resuelve con el mecanismo **existente**
> (362) y **no se estrena nada nuevo**. La medición de §6.2 es **bloqueante**: si el rastro no
> quedara o no fuera consultable con el rol `admin`, se dice y se para.

**El rastro sigue en pie con el rol nuevo, y no hace falta construir nada.** Lo que falta es
**medirlo con `admin`**, porque hoy nadie lo mide:

- El test que congela nombre y rol
  (`tests/integration/db/historial-accion-atomicidad.test.ts`, «R3/R4: la fila congela la GUIA de
  la orden y el nombre y rol del actor») resuelve el actor con `tx.usuario.findFirstOrThrow()`
  **sin filtrar por rol**: afirma «el rol que sea del primer usuario que salga». No dice nada sobre
  `admin`.
- Los demás casos de ese archivo pasan `actorUsuarioId: FKS!.tiendaId`.

Por eso **T7 es requisito de esta ficha, no un extra**: un caso de integración contra Postgres que
borra una orden con un actor **de rol `admin`** y afirma `actorRol === "admin"` + `actorNombre`
congelado + una fila por orden + un `lote_id` por acto (R11–R13); y **T8**, que lee esa fila por el
camino real de consulta filtrando por acción y por actor (R15).

Dos cautelas que este repo ya pagó:
- El caso **no puede** llevar un `if (!fks) return;` que lo deje «passed» sin comprobar nada.
- El archivo tiene que ponerse **rojo** con una mutación deliberada antes de creerlo (§8).

### 6.3 El límite conocido, declarado y aceptado

Quien borra queda consultable **para el `maestro`**, no para sí mismo (R16). Es deliberado y está
**aceptado por el humano** (`requirements.md`, D2): el registro es la contrapartida, y la
contrapartida no la revisa el revisado — la ficha 362 ya lo decidió con esas palabras. Esta ficha
**no** lo resuelve; lo deja escrito como límite.

## 7. Alternativas descartadas

**A1 — Autorizar con `esAccesoTotal(rol)` («restaurar la paridad maestro/admin» por la vía
general).** Descartada. `esAccesoTotal` es una respuesta **binaria** y el borrado tiene **tres**
casos: `todas`, `propias` (con dueño) y `denegado`. Usarla aquí dejaría al `adminTienda` y al
`apiKey` fuera del mismo punto de decisión —que es justo lo que la 358 vino a arreglar— y
convertiría la lista de inclusión en una paridad que arrastra a cualquier capacidad futura del
`admin`. Además, el día que el humano quiera volver a estrechar, el diff no diría qué se decidió.

**A2 — Añadir `admin` solo en `page.tsx` (abrir el botón).** Descartada: la pantalla ofrecería lo
que el servidor rechaza. Es el fallo mudo exacto que el campo `eliminable` existe para impedir.

**A3 — Añadir `admin` solo en la autorización y dejar `page.tsx` como está.** Descartada por el
motivo inverso: el servidor autorizaría un borrado que la pantalla no ofrece nunca. El `admin`
seguiría sin poder borrar en la práctica, y el gate saldría verde.

**A4 — Dar al `admin` alcance `propias`.** Descartada: su `usuarioId` no es la `tienda_id` de
ninguna orden, así que el `where` no encontraría nada y el borrado sería siempre «cero eliminadas».
Un permiso que no permite nada es peor que no darlo.

**A5 — Abrir también el canal por API key a «todas».** Descartada (D1, §3.3): por ahí no entra un
`admin`, y aceptar un actor sin frontera convertiría una credencial de integración en capaz de
borrar órdenes ajenas.

**A6 — Aprovechar y abrir también «recuperar» y el interruptor «Eliminadas».** Descartada **por el
humano el 2026-09-14** (`requirements.md`, D1): el `admin` borra y no se le abre la papelera; si se
equivoca, se lo pide al `maestro`. Dejar la recuperación en una sola persona conserva además **la
mitad** de lo que protegía la decisión del 2026-08-27.

**A7 — Dejar las dos listas de roles (`page.tsx` y la función) y añadir una guardia que las
compare.** Descartada frente a D2: una guardia que compara dos copias sigue dejando dos copias, y
el repo ya tiene la lección escrita (`historial-acciones-roles-una-sola-fuente`): lo que impide la
divergencia es que ambas capas **lean la misma constante**, no que un test las contraste.

**A8 — Crear una tabla/columna propia de «quién borró» para reforzar el rastro.** Descartada:
`historial_accion` ya lo hace con nombre y rol congelados, `lote_id` por acto, atomicidad
estructural y una pantalla de consulta. Una segunda fuente del mismo hecho es la forma conocida de
que las dos diverjan.

## 8. Riesgo declarado

El riesgo **es** la consecuencia que el humano aceptó el 2026-09-14: a partir de esta ficha hay más
de una persona del equipo capaz de retirar una orden del sistema. **Medido el 2026-09-14: de 2
personas (2 `maestro`) se pasa a 6 (más 4 `admin` activos en producción).** Lo que esta ficha exige
a cambio es que cada retirada diga **quién** y **con qué rol**, por orden y por acto, y que eso sea
consultable — verificado, no supuesto (§6.2), y **bloqueante** si no lo fuera.

Riesgo secundario, acotado: `admin` pasa a recibir `eliminable` en el listado, así que ve casillas
de selección donde antes tenía solo las acciones de lote. No es un cambio de datos ni de contrato;
se cubre con T6.

## 9. Cómo se verifica

- Gate normal de PR: **`./init.sh --rapido`** (el diff no toca cimientos, §2).
- **`DATABASE_URL` resoluble es obligatorio** para T7/T8: sin ella, `tests/integration/db/**` se
  salta y el gate sale verde sin haber medido la contrapartida. Mirar los `skipped`.
- Autocomprobación por mutación, antes de dar nada por hecho (detalle y criterio en `tasks.md`):
  1. revertir `admin → denegado` en la función ⇒ deben caer T2, T3, T4, T6 (y NO T5, que mide el
     rechazo por API, que no cambia);
  2. quitar `tiendaId` del `where` de `softDelete` ⇒ rojo en la frontera multi-tenant;
  3. sustituir el `actorRol` congelado por el rol vivo ⇒ rojo en T7.
