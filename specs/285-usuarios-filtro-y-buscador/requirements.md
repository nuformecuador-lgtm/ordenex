# Feature 285 — Filtro por rol y buscador en el listado de usuarios · requirements.md

> Zona: `fullstack` · Complejidad: media · Rama (convención del repo):
> `feature/285-usuarios-filtro-y-buscador`
> Notación EARS estricta (`docs/specs.md`). Cada `R<n>` es testeable y **sin detalle de
> implementación** (el CÓMO va en `design.md`).

## Alcance

El listado de usuarios de **Configuración** gana **un filtro por rol (selección múltiple)**
y **un buscador por nombre o correo**, resueltos **en el servidor** (la tabla está paginada
server-side: filtrar en el cliente solo filtraría las 25 filas visibles).

**Fuera del alcance, por decisión explícita del humano (2026-08-26):**

- **La columna con la zona de cada usuario.** Se retiró de esta ficha («ya no necesito la
  columna nueva para ver de qué zona es cada persona»). No se añade, y **no se propone**.
- Con ella se va su único efecto colateral: **las columnas de la descarga de usuarios y la
  guardia de columnas de la feature 170 NO se tocan**. La descarga sí queda alcanzada por
  los filtros (R20–R22), que es otra cosa: cambia **qué filas** salen, no **qué columnas**.
- **El módulo de órdenes.** Reusar aquí significa *consumir* los componentes compartidos,
  no editar `ordenes-filtros-def.ts` ni nada de `/ordenes`.

**Decisiones del humano que este spec NO reabre:**

1. **Filtro de rol: selección MÚLTIPLE**, como el de estado en órdenes.
2. **Buscador: por nombre o correo.** Ni teléfono, ni cédula, ni identificador interno.
3. **Se reutiliza la barra ya construida** (`BuscadorFiltros` + `FilterComponent`), y lo
   específico de usuarios vive aparte, calcando el patrón de `ordenes-filtros-def.ts`.

---

## Contexto verificado en el repo (leído, no supuesto)

- **El borde no acepta nada de esto hoy.** `listarUsuariosSchema` (`lib/types/usuario.ts:95`)
  admite **solo** `page`, `pageSize`, `sortBy`, `sortDir`. No hay término de búsqueda ni
  filtro de rol: esto es **backend + frontend**, no un ajuste de pantalla.
- **El modo completo se DERIVA del listado.** `listarUsuariosCompletoSchema`
  (`lib/types/usuario.ts:118`) es `listarUsuariosSchema.omit({page, pageSize}).strict()`:
  toda clave añadida al schema base **aparece sola** en la entrada de la descarga.
- **Proyección de fila.** `UsuarioListItem` (`lib/interfaces/repositories/IUserRepository.ts:75`)
  = `id, nombre, email, rolValue, estado, createdAt`. Nunca el hash.
- **Parámetros del listado en el repositorio.** `ListUsuariosParams`
  (`…/IUserRepository.ts:86`) = `skip, take, sortBy?, sortDir?`. **No hay `where`.**
- **`UserRepository.list`** lanza `findMany` y `count` en paralelo, y hoy el **`count` no
  lleva condición alguna** (`lib/repositories/UserRepository.ts:186`).
- **Autorización: ya existe y basta.** `UsuarioService` tiene
  `ALLOWED_ROLES = new Set(["maestro"])` (`lib/services/UsuarioService.ts:35`) y
  `app/(app)/configuracion/page.tsx` no renderiza el módulo a ningún otro rol. **Esta
  feature no necesita autorización nueva** y no debe introducir ninguna.
- **El módulo es exclusivo de un rol sin acotamiento por fila**, así que el `where` nuevo
  **no convive con un acotamiento por rol** que pudiera fugarse en un `OR` (a diferencia de
  `/ordenes`).
- **Roles.** `RolValue` es un enum de Postgres y `ROL_LABELS` (`lib/auth/rol-label.ts`) es un
  `Record<RolValue, string>` **exhaustivo**: hay etiqueta legible para los 6 roles.
- **La barra ya es genérica.** `BuscadorFiltros` (`components/shared/BuscadorFiltros.tsx`)
  soporta `minChars`, `placeholder`, `debounceMs` (`DEBOUNCE_MS_DEFAULT = 500`), selector de
  filtros y "Limpiar todo"; `FilterComponent` soporta `kind: "multi"`. Ninguno sabe de
  órdenes. `DataTable` acepta la barra por su prop `filtros` (nodo opaco).
- **Precedente de paginación con filtros.** `OrdenesModule` mete el filtro en la key de SWR
  y, al cambiar esa key, vuelve a página 1.
- **La tabla `usuario` no es grande** y no tiene índice de texto; sí tiene `@@index([rolId])`.

---

## Requisitos

### Bloque A — Buscador por nombre o correo

- **R1.** MIENTRAS no haya término de búsqueda ni roles seleccionados, el sistema DEBE
  devolver el listado de usuarios con **el mismo conjunto de filas, el mismo orden y el
  mismo total** que devuelve hoy.
- **R2.** CUANDO se aplica un término de búsqueda, el sistema DEBE devolver **únicamente**
  los usuarios cuyo **nombre** o cuyo **correo** contenga ese término como **fragmento en
  cualquier posición** (no solo al principio).
- **R3.** El sistema DEBE resolver la búsqueda **sobre todos los usuarios**, no sobre la
  página visible: un usuario que casa con el término DEBE aparecer aunque antes de filtrar
  estuviera en otra página.
- **R4.** El sistema DEBE comparar el término **sin distinguir mayúsculas de minúsculas**.
- **R5.** El sistema DEBE tratar los caracteres comodín de patrón (`%`, `_`, `\`) del término
  como **texto literal**: buscar `a%` NO DEBE devolver a un usuario llamado `Ana`.
- **R6.** El sistema DEBE **recortar los espacios de los extremos** del término antes de
  aplicarlo; un término compuesto solo por espacios DEBE equivaler a "sin búsqueda".
- **R7.** MIENTRAS lo escrito —ya recortado— tenga menos caracteres que el mínimo, el sistema
  NO DEBE consultar y la interfaz DEBE indicar cuántos caracteres faltan.
- **R8.** SI el borde recibe un término **por debajo del mínimo** o **por encima del máximo**,
  ENTONCES el sistema DEBE responder `validation_error` **sin ejecutar ninguna consulta**.
- **R9.** CUANDO lo escrito supera el máximo de caracteres, la interfaz DEBE **recortarlo al
  máximo** antes de consultar, de modo que pegar un texto largo nunca deje el listado en
  estado de error.
- **R10.** CUANDO el usuario teclea una ráfaga de pulsaciones, el sistema DEBE emitir **una
  sola consulta**, tras una espera desde la última pulsación.
- **R11.** El campo de búsqueda DEBE declarar en su texto de ayuda que busca **por nombre o
  correo**.

### Bloque B — Filtro por rol

- **R12.** El filtro de rol DEBE ofrecer **todos** los roles que el sistema reconoce, cada uno
  con su **etiqueta legible en español**, y DEBE admitir **selección múltiple**.
- **R13.** CUANDO hay uno o más roles seleccionados, el sistema DEBE devolver **únicamente**
  los usuarios cuyo rol esté entre los seleccionados.
- **R14.** MIENTRAS no haya ningún rol seleccionado, el sistema NO DEBE recortar el listado
  por rol.
- **R15.** SI el borde recibe un valor de rol **que no existe**, o una **lista de roles
  vacía**, ENTONCES el sistema DEBE responder `validation_error` **sin ejecutar ninguna
  consulta**.

### Bloque C — Combinación, paginación y vaciado

- **R16.** CUANDO hay término y roles a la vez, el sistema DEBE devolver únicamente los
  usuarios que cumplen **ambas** condiciones.
- **R17.** El **total** de la paginación DEBE contar únicamente los usuarios que cumplen los
  filtros activos.
- **R18.** CUANDO cambia el término o la selección de roles, el sistema DEBE volver a la
  **página 1**.
- **R19.** El listado filtrado DEBE conservar **el mismo criterio de orden** (columna y
  sentido) que el listado sin filtrar.
- **R20.** CUANDO hay filtros activos y ningún usuario coincide, la interfaz DEBE decir que
  **ninguno coincide con los filtros** y NO DEBE ofrecer "crea el primer usuario"; MIENTRAS
  no haya filtros activos, el estado vacío DEBE seguir siendo el actual.
- **R21.** La interfaz DEBE ofrecer una acción que deje la barra **como recién abierta** (sin
  término y sin filtros puestos), y tras usarla el listado DEBE volver a mostrar todos los
  usuarios.

### Bloque D — Descarga del listado

- **R22.** CUANDO hay filtros activos, la descarga del listado DEBE contener **exactamente
  los usuarios que casan con esos filtros**.
- **R23.** MIENTRAS no haya filtros activos, la descarga DEBE comportarse **exactamente como
  hoy** (mismas filas y misma entrada al servidor que antes de esta feature).
- **R24.** La descarga DEBE emitir **las mismas columnas que hoy** y en el mismo orden: esta
  feature no añade, quita ni reordena ninguna.
- **R25.** El tope de filas de la descarga DEBE evaluarse sobre el **total filtrado**, de modo
  que un subconjunto por debajo del tope se descargue aunque el conjunto sin filtrar lo
  exceda.

### Bloque E — Permisos, datos y reuso

- **R26.** MIENTRAS el actor no tenga el rol `maestro`, el sistema DEBE responder `forbidden`
  a cualquier listado —filtrado o no— y a cualquier descarga, **sin ejecutar ninguna
  consulta**.
- **R27.** El listado filtrado DEBE proyectar por fila **exactamente los mismos campos** que
  el listado actual: esta feature no expone ningún campo nuevo, y en particular ninguno
  sensible.
- **R28.** El listado de usuarios DEBE montar **los componentes compartidos** de búsqueda y
  filtros (el contenedor con su campo y su selector de filtros), no controles propios.
- **R29.** El mínimo de caracteres que exige el borde y el que aplica el campo de búsqueda
  DEBEN salir del **mismo origen**: cambiar el mínimo en un sitio DEBE cambiarlo en los dos.

---

## Trazabilidad (obligación del implementer)

Cada `R<n>` de arriba termina mapeado a un test concreto en
`progress/impl_285-usuarios-filtro-y-buscador.md`. Reglas duras de esta feature, ya
acordadas con el humano:

1. **El `WHERE` nuevo se prueba DONDE VIVE**: test de integración contra Postgres real. Un
   test de servicio con dobles **no ve el SQL** y pasa en verde con el `WHERE` mutado — está
   medido cuatro veces en este repo. R2, R4, R5, R13, R16 y R17 **no se dan por cubiertos**
   con un doble.
2. **Prohibido el `if (!x) return;` mudo** en el test de integración: si falta la base o
   falta el catálogo de roles, el test **falla o se salta declarándolo**, nunca reporta
   `passed` sin haber comprobado nada.
3. `design.md` §9 fija **qué mutación** debe matar cada test clave. Un test que sobrevive a
   su mutación no cuenta como evidencia.

---

## Preguntas abiertas

- **P1 — Acentos en el buscador.** La vía mínima (una comparación insensible a mayúsculas
  sobre las columnas tal cual) **no pliega acentos**: teclear `jose` no encuentra a `José`
  (aunque `jos` sí lo encuentra, porque se busca por fragmento). Plegar acentos exigiría
  columna generada + migración + índice de trigramas, como en `/ordenes`, sobre una tabla de
  decenas de filas. **Decisión provisional: se acepta la limitación** y queda escrita en
  `design.md §8`. ¿Se confirma, o se quiere el plegado desde el primer día asumiendo la
  migración?
- **P2 — El rol `apiKey` en el filtro.** Las cuentas de API key son filas del listado pero no
  son personas. **Decisión provisional: se ofrecen los 6 roles**, porque los 6 aparecen en la
  tabla y un filtro que oculta lo que la tabla muestra es un filtro que miente. ¿Se confirma?
- **P3 — Persistencia de los filtros.** Hoy la barra de órdenes **no** recuerda la selección
  entre visitas (ni en la URL ni en el navegador). **Decisión provisional: aquí tampoco.**
  ¿Se confirma?
