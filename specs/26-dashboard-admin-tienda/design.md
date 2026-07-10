# Feature 26 — Dashboard / apartado del admin de tienda — design.md

> Frontend puro: Server Components de Next App Router + shadcn/ui + Tailwind + SWR.
> SIN backend, DB, migraciones, actions ni APIs nuevas. TypeScript strict.

## Grounding verificado (no inventar rutas/símbolos)

- Landing autenticada: `app/(app)/page.tsx` (Server Component, hoy placeholder
  "Bienvenido"; valida sesión con `SessionRepository`).
- Rol server-side: `resolveActorFromSession()` en `lib/auth/resolve-actor.ts` →
  `{ usuarioId, rol }`, `rol: RolValue` (`"maestro" | "admin" | "mensajero" |
  "adminTienda" | "adminSatelite"`).
- Módulo de órdenes: `app/(app)/ordenes/page.tsx` (client) compone `DataTable`
  (`components/shared/DataTable`), `Pagination` (`components/shared/Pagination`),
  columnas `app/(app)/ordenes/_components/ordenes-columns`, botón
  `OrdenesCargaMasivaButton` (`app/(app)/ordenes/_components/OrdenesCargaMasivaButton`),
  action `listarOrdenes` (`lib/actions/ordenes`).
- Autorización por tienda: `OrdenService.listar` aplica `where.tiendaId =
  actor.usuarioId` si `actor.rol === "adminTienda"` (`lib/services/OrdenService.ts`
  ~L131-134). El filtrado a la tienda propia YA existe; NO se toca backend.
- Columnas: `ordenesColumns` incluye `{ id: "tienda", ..., render: row => row.tiendaNombre }`.

## Decisiones técnicas

### D1 — La landing `/` se ramifica por rol en el Server Component

`app/(app)/page.tsx` sigue siendo Server Component. Se añade llamada a
`resolveActorFromSession()`. Con base en `actor.rol`:

- `actor === null` → comportamiento actual (no dashboard) (R4).
- `actor.rol === "adminTienda"` → renderiza `<AdminTiendaDashboard />` (R1, R2).
- cualquier otro rol → placeholder actual / sin dashboard de tienda (R3). El
  dashboard maestro (feature 23) queda como TODO explícito, no se implementa aquí.

Cumple R5: el rol se resuelve solo en servidor; no se añade hook de cliente.

### D2 — Extraer el módulo de órdenes a un componente cliente compartido

Para satisfacer R6–R10 sin duplicar la tabla, se **extrae** el cuerpo actual de
`app/(app)/ordenes/page.tsx` (estado de página/pageSize, SWR con `ordenesFetcher`,
`DataTable`, `Pagination`, `OrdenesCargaMasivaButton`) a un componente cliente
reutilizable:

- Nuevo: `app/(app)/ordenes/_components/OrdenesModule.tsx` (`"use client"`).
  Props opcionales: `{ columns?: Column<OrdenListItemDTO>[] }` (default =
  `ordenesColumns`). Sin props => comportamiento idéntico al `/ordenes` actual.
- `app/(app)/ordenes/page.tsx` pasa a renderizar `<OrdenesModule />` (refactor sin
  cambio funcional; los tests existentes de `/ordenes` deben seguir verdes).
- El dashboard renderiza `<OrdenesModule columns={ordenesColumnsAdminTienda} />`.

Esto mantiene una sola implementación de tabla + fetch (R10). `AdminTiendaDashboard`
es un Server Component (encabezado) que monta el módulo cliente como hijo; los datos
sensibles siguen fluyendo por la action `listarOrdenes` (server-side), no por props
del padre, coherente con el patrón existente de `/ordenes`.

### D3 — Ocultar la columna "Tienda" para adminTienda (R11) — decisión firme F1.4

Columnas condicionales por rol, sin duplicar la `DataTable`: se define
`ordenesColumnsAdminTienda` = `ordenesColumns` sin la entrada `{ id: "tienda" }`,
colocada junto al dashboard (`app/(app)/_components/ordenes-columns-admin-tienda.ts`).
El dashboard la pasa vía la prop `columns` de `OrdenesModule` (única implementación de
tabla/fetch, ver D2). No se modifica `ordenes-columns.tsx`, que sigue sirviendo a
`/ordenes` (y al futuro maestro, feature 23) con las 5 columnas incluida "Tienda".
Así la selección de columnas es un parámetro de presentación por rol, no una segunda
tabla.

### D4 — Estructura de archivos (frontend)

```
app/(app)/page.tsx                                   ← + ramificación por rol (D1)
app/(app)/_components/AdminTiendaDashboard.tsx       ← nuevo (Server Component: header + módulo)
app/(app)/_components/ordenes-columns-admin-tienda.ts← nuevo (columnas sin "Tienda")
app/(app)/ordenes/_components/OrdenesModule.tsx      ← nuevo (extraído de ordenes/page.tsx)
app/(app)/ordenes/page.tsx                           ← refactor: usa OrdenesModule
```

### D5 — Encabezado del apartado (R2)

Título con un componente de presentación simple (heading Tailwind, o `Card` de
shadcn/ui si ya está instalado). Texto sugerido: "Órdenes de mi tienda" / "Panel de
tienda" (a ajustar por el implementer; sin impacto en requisitos). No introduce
lógica de negocio.

## Contratos I/O

- No se crean endpoints ni schemas nuevos. Se consume `listarOrdenes({ page,
  pageSize })` tal cual (mismo contrato que `/ordenes`), que ya devuelve solo las
  órdenes de la tienda para `adminTienda` por el filtro de backend (R7).
- `OrdenesModule` no añade parámetros de red; la única prop nueva (`columns`) es de
  presentación.

## Modelo de datos / RLS / migraciones

Ninguna. Feature frontend; no toca DB, Prisma ni RLS. La segregación por tienda ya
está garantizada en `OrdenService.listar` (feature 6).

## Alternativas descartadas

### A1 (descartada) — Duplicar la página de órdenes dentro del dashboard

Copiar el JSX/SWR de `ordenes/page.tsx` dentro de `AdminTiendaDashboard`.
**Descartada** porque viola R10 y `docs/architecture.md` ("sin sobre-ingeniería" /
no duplicar): habría dos implementaciones de la misma tabla+fetch que divergirían
(paginación, estados, columnas). La extracción a `OrdenesModule` (D2) da una sola
fuente de verdad.

### A2 (descartada) — Crear una ruta dedicada `/tienda` en lugar de ramificar `/`

Añadir `app/(app)/tienda/page.tsx` y redirigir `adminTienda` allí tras login.
**Descartada** (confirmado en F1.4) porque el feature_list pide explícitamente que el
dashboard sea la "primera experiencia tras iniciar sesión" (la landing `/`), y crear
una ruta + lógica de redirección por rol (middleware) es más superficie de la
necesaria. Decisión firme: landing `/` condicional por rol (D1).

### A3 (descartada) — Filtrar/ocultar la columna Tienda con un flag booleano en `ordenesColumns`

Mutar `ordenes-columns.tsx` para aceptar `hideTienda`. **Descartada** por acoplar el
módulo genérico a un caso concreto; en su lugar (D3) se pasa un array de columnas por
la prop `columns`, manteniendo `ordenes-columns.tsx` intacto y las columnas del
dashboard colocadas junto al dashboard.

## Fuera de alcance (MVP) — decisiones firmes F1.4

- Métricas / KPIs / widgets / accesos directos del dashboard.
- Ruta dedicada `/tienda` (se usa la landing `/` condicional por rol).
- Dashboard del admin maestro (feature 23).
- Cambios en `Sidebar` por rol.
- Cualquier cambio de backend, DB, actions o RLS.
