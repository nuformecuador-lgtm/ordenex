# Feature 63 — Orden lista actualizada · requirements.md

> Zona: fullstack · Complejidad: media · depends_on: null (el humano confirmó que
> NO depende de la 57).
> Notación EARS estricta (ver `docs/specs.md`). Cada `R<n>` es testeable y sin
> detalle de implementación (el CÓMO va en `design.md`).

## Contexto verificado en el repo (no inventado)

- `order_status` es una TABLA de catálogo (`OrderStatus`, `@@map("order_status")`,
  columnas `id`/`value`); el enum PG fue eliminado. Catálogo actual de 14 valores
  (13 en `ORDER_STATUS_SEED` + `pendiente` sembrado en las migraciones
  `20260714140000_*` y `20260714150000_*`).
- La FK de estado en `Orden` es `estatusId` (columna `estatus_id`), NO `status_id`.
  El caso `status_id` de la descripción se mapea a `estatusId`.
- Ya existen: `IOrdenRepository.listOrderStatus()` y la Server Action
  `listarCatalogoEstatus()` (feature 17), pero esta última está restringida a
  `maestro`/`admin`. `listarOrdenes()` ya acepta un filtro escalar `estatusId`.
- El componente `Tabs` de shadcn/ui NO existe todavía en `components/ui/`.
- "Todos los roles excepto el mensajero" = `maestro`, `admin`, `adminTienda`,
  `adminSatelite`. El mensajero tiene su propio módulo `/mis-asignaciones`.

---

## Requisitos

### Endpoint / lista de `order_status`

**R1.** El sistema DEBE exponer un endpoint (Server Action) que devuelva la lista
del catálogo `order_status`, cada elemento con al menos `id` y `value`.

**R2.** CUANDO un usuario autenticado con rol `maestro`, `admin`, `adminTienda` o
`adminSatelite` invoca el endpoint de `order_status`, el sistema DEBE devolver el
catálogo completo con estado `ok`.

**R3.** SI quien invoca el endpoint de `order_status` no tiene sesión válida,
ENTONCES el sistema DEBE responder `unauthenticated` y NO devolver datos.

**R4.** SI quien invoca el endpoint de `order_status` es rol `mensajero` (u otro
rol no reconocido), ENTONCES el sistema DEBE responder `forbidden` y NO devolver
datos.

**R5.** El sistema DEBE devolver la lista de `order_status` en un orden
determinista (misma entrada produce el mismo orden), para que las tabs sean
estables entre renders.

### Filtro genérico en el listado de órdenes

**R6.** El sistema DEBE aceptar en `listarOrdenes` un parámetro opcional
`filter` con forma `{ [campo]: valor }`, que el backend traduce a condiciones
`WHERE`.

**R7.** El sistema DEBE aceptar en `filter` ÚNICAMENTE campos de una lista blanca
definida server-side; SI `filter` contiene un campo fuera de la lista blanca,
ENTONCES el sistema DEBE responder `validation_error` sin ejecutar la consulta.

**R8.** La lista blanca de `filter` (v1) DEBE incluir el filtro por estado de la
orden, aceptado bajo la clave `status_id` y mapeado internamente a la FK
`estatusId`.

**R9.** CUANDO `listarOrdenes` recibe `filter` con el estado (`status_id`), el
sistema DEBE devolver únicamente las órdenes cuyo `estatusId` coincide, aplicadas
además las reglas de alcance por rol ya vigentes (p. ej. `adminTienda` solo ve las
suyas).

**R10.** MIENTRAS `filter` no se proporcione (u objeto vacío), el sistema DEBE
comportarse igual que antes de esta feature (sin regresión del contrato de
`listarOrdenes` de las features 6/7/8), y el parámetro escalar `estatusId`
existente DEBE seguir funcionando.

**R11.** El sistema DEBE validar el `filter` en el borde (zod) antes de construir
el `WHERE`, de modo que ningún nombre de columna arbitrario llegue a Prisma.

### Componente de órdenes con tabs (frontend, todos los roles excepto mensajero)

**R12.** DONDE el usuario tenga un rol distinto de `mensajero`, el componente de
órdenes DEBE presentar las órdenes agrupadas por estado usando un componente
`Tabs` (shadcn/ui), una tab por estado mostrado.

**R13.** El componente DEBE aceptar una prop `exclude` que indique qué estados NO
se muestran; los estados incluidos en `exclude` NO DEBEN generar una tab.

**R14.** El sistema DEBE derivar la lista de tabs a partir del catálogo
`order_status` (R1) menos los estados de `exclude`, de modo que agregar/quitar un
estado del catálogo se refleje sin cambiar el front.

**R15.** CUANDO el usuario está viendo una tab, el componente DEBE mostrar las
órdenes cuyo estado corresponde a esa tab, consultadas vía `listarOrdenes` con el
`filter` por `status_id` (R8/R9).

**R16.** El sistema DEBE hacer lazy loading de las tabs: la consulta de una tab
solo se ejecuta cuando esa tab está activa; una tab que nunca ha sido visitada NO
DEBE ejecutar ninguna consulta (requisito duro).

**R17.** CUANDO el usuario cambia entre tabs, cada tab DEBE conservar su propia
paginación de forma independiente (la paginación de una tab no afecta a otra).

**R18.** MIENTRAS haya más tabs de las que caben en el ancho disponible, el
contenedor de tabs (`TabsList`) DEBE permanecer usable (scroll/overflow
horizontal), sin romper el layout ni ocultar tabs de forma inaccesible.

**R19.** El sistema DEBE usar UN SOLO componente de órdenes parametrizado por
`exclude` (y por rol), reutilizando el módulo de tabla/paginación existente
(`DataTable`/`Pagination`/`ordenesColumns`), sin duplicar la lógica de fetch.

**R20.** El rol `mensajero` NO DEBE usar este componente de tabs; su experiencia
sigue siendo el módulo `/mis-asignaciones` (features 36/61), sin regresión.

---

## Trazabilidad

Cada `R<n>` se mapea a un test concreto en `tasks.md` (tabla R→test). El reviewer
rechaza si falta alguno.

---

## Preguntas abiertas para aprobación humana (puerta F1.4)

> **F1.4 APROBADA por el humano 2026-07-14.** (a)–(g) tal cual las recomendadas.
> (h): tabs SOLO en `/ordenes` para `maestro`/`admin`/`adminTienda`; `adminSatelite`
> FUERA del v1 (sigue en `/mis-asignaciones`). **ACLARACIÓN del humano sobre `exclude`:**
> el `exclude` se resuelve en el FRONT filtrando la lista de estados antes de mapear a
> tabs — `estados.filter(e => !exclude.includes(e.value)).map(...)` (R14). El backend
> NO recibe `exclude`; devuelve el catálogo completo (R1) y el front decide qué omitir.

Cada pregunta lleva mi recomendación; marcar la elegida al aprobar.

**(a) Forma del endpoint de `order_status`.**
Recomendación: Server Action `listarOrderStatus()` en `lib/actions/` (patrón del
repo para lectura interna; ver `docs/architecture.md`). Alternativa: route handler
REST en `app/api/`. Sub-decisión: ¿reutilizar/relajar la autorización de la
`listarCatalogoEstatus()` existente (hoy solo `maestro`/`admin`) para incluir
`adminTienda`/`adminSatelite`, o crear una acción nueva `listarOrderStatus()` que
no toque el contrato de la 17? Recomiendo **acción nueva** con autorización
"todos excepto mensajero" (R2) para no alterar la semántica de la 17.

**(b) Firma del `filter`.**
Recomendación: `Record<string, string>` acotado a una WHITELIST server-side
(evita inyección de columnas en el `WHERE` de Prisma; R7/R11). Whitelist v1:
`status_id` (→ `estatusId`). ¿Se admiten más campos en v1 (p. ej. `tienda_id`)?
Recomiendo dejar solo `status_id` en v1 y ampliar por demanda.

**(c) `exclude`: ¿por `value` o por `id`? ¿default?**
Recomendación: excluir por `value` (estable y legible; los `id` pueden variar por
entorno). Default de exclusión: `["pendiente"]` (estado de borrador/transitorio
recién sembrado). ¿Se desea excluir además algún estado terminal por rol?

**(d) Fuente de la lista de tabs.**
Recomendación: derivarla del endpoint `order_status` (R1) menos `exclude` (R14),
NO una lista estática en el front (evita drift con el catálogo).

**(e) Lazy loading: ¿cachear al volver a una tab visitada o re-fetch?**
Recomendación: cachear por tab con key SWR por `status_id` (mejor UX, menos
carga); el requisito duro R16 (tabs nunca visitadas no consultan) se cumple en
ambos casos. ¿Aceptable el cache, o se exige re-fetch en cada activación?

**(f) Alcance "todos excepto mensajero": un componente o varios.**
Recomendación: UN solo componente parametrizado, con `exclude` distinto según el
rol (R19). ¿Confirmado?

**(g) Responsive de ~13 tabs (excluir `pendiente` deja ~13).**
Recomendación: `TabsList` con scroll horizontal / overflow (R18). ¿Se prefiere
scroll horizontal, wrap a varias filas, o un selector compacto en móvil?

**(h) ¿`adminSatelite` realmente entra en este componente?**
El `SIDEBAR_ITEMS` actual muestra `/ordenes` solo a `maestro`/`admin`/
`adminTienda`; `adminSatelite` opera en `/mis-asignaciones` (feature 33). La
descripción dice "todos excepto mensajero". Recomiendo: aplicar tabs en `/ordenes`
para `maestro`/`admin`/`adminTienda`, y confirmar si `adminSatelite` debe verlas
en su propia superficie o queda fuera del alcance v1.
