# Feature 26 — Dashboard / apartado del admin de tienda — requirements.md

> Rol objetivo: `adminTienda`. Zona: frontend. Complejidad: medium.
> Notación EARS (ver `docs/specs.md`). Cada requisito es testeable y se mapea a un
> test en `tasks.md`. Sin detalles de implementación (esos van en `design.md`).

## Alcance (MVP)

Convertir la landing autenticada (`/`, actualmente placeholder "Bienvenido" en
`app/(app)/page.tsx`) en una experiencia condicional por rol. Para `adminTienda`,
esa landing es su **apartado/dashboard**: un encabezado del apartado + su **módulo
de órdenes** (reusando el módulo existente de `/ordenes`), que ya lista únicamente
las órdenes de su propia tienda (filtro de backend de la feature 6) y desde el cual
accede al botón de **carga masiva** (features 14/16).

Fuera de alcance del MVP (decisiones firmes de la puerta F1.4): métricas, widgets,
KPIs y accesos directos adicionales; ruta dedicada `/tienda`; y cambios en el
`Sidebar`. El dashboard del admin **maestro** (feature 23) NO forma parte de esta
feature.

## Requisitos

### Landing condicional por rol

- **R1** — CUANDO un usuario con sesión válida y rol `adminTienda` accede a la
  landing autenticada (`/`), el sistema DEBE renderizar el apartado/dashboard del
  admin de tienda.

- **R2** — MIENTRAS se renderiza el dashboard del admin de tienda, el sistema DEBE
  mostrar un encabezado/título visible que identifique el apartado como el del
  admin de tienda, distinguible del contenido genérico "Bienvenido" previo.

- **R3** — CUANDO un usuario con sesión válida y rol distinto de `adminTienda`
  (`maestro`, `admin`, `mensajero`, `adminSatelite`) accede a la landing (`/`), el
  sistema NO DEBE renderizar el dashboard del admin de tienda.

- **R4** — SI no existe una sesión válida al acceder a la landing (`/`), ENTONCES
  el sistema NO DEBE renderizar el dashboard del admin de tienda (se conserva el
  comportamiento de sesión existente).

- **R5** — El sistema DEBE resolver el rol únicamente en el servidor (Server
  Component) a partir de la sesión; NO DEBE introducir ningún mecanismo de cliente
  para determinar el rol.

### Módulo de órdenes dentro del dashboard

- **R6** — MIENTRAS el dashboard del admin de tienda está visible, el sistema DEBE
  renderizar el módulo de órdenes (tabla de órdenes con paginación).

- **R7** — El módulo de órdenes del dashboard DEBE listar únicamente las órdenes de
  la tienda del propio `adminTienda`, delegando el filtrado en la lógica de backend
  existente (`OrdenService.listar` aplica `where.tiendaId` para `adminTienda`); el
  frontend NO DEBE introducir filtrado propio ni cambios de backend.

- **R8** — MIENTRAS el módulo de órdenes está visible, el sistema DEBE ofrecer el
  botón de carga masiva (features 14/16) para subir órdenes desde la plantilla.

- **R9** — CUANDO la carga de órdenes está en curso, el módulo DEBE mostrar estado
  de carga; y SI la carga falla, ENTONCES DEBE mostrar un mensaje de error; y SI no
  hay órdenes, ENTONCES DEBE mostrar un mensaje de vacío (mismos estados que el
  módulo `/ordenes` existente).

### Reuso / no duplicación

- **R10** — El sistema DEBE reutilizar los componentes existentes del módulo de
  órdenes (`DataTable`, `Pagination`, columnas de `/ordenes`, `OrdenesCargaMasivaButton`)
  y la action `listarOrdenes`; NO DEBE duplicar la implementación de la tabla ni de
  la obtención de datos.

- **R11** — DONDE el módulo de órdenes se muestra para el rol `adminTienda`, el
  sistema NO DEBE incluir la columna de nombre de tienda ("Tienda" / `tiendaNombre`)
  entre las columnas renderizadas, dado que todas las órdenes pertenecen a la misma
  tienda. (Decisión firme F1.4; para el maestro —feature 23 futura— sí se mostraría.)

## Trazabilidad (resumen; mapa detallado en tasks.md)

| Req | Test previsto |
| --- | --- |
| R1  | e2e: adminTienda ve el dashboard tras login (`e2e/dashboard-admin-tienda.spec.ts`) |
| R2  | e2e/component: encabezado del apartado presente |
| R3  | component: landing no renderiza dashboard para rol != adminTienda |
| R4  | component/e2e: sin sesión no renderiza dashboard |
| R5  | unit/component: rol resuelto server-side (sin hook de cliente) |
| R6  | component: módulo de órdenes montado en el dashboard |
| R7  | integration (existente feature 6) + e2e: solo órdenes de su tienda |
| R8  | component/e2e: botón de carga masiva presente y abre modal |
| R9  | component: estados loading/error/empty del módulo |
| R10 | test estructural: dashboard consume el componente compartido, sin tabla duplicada |
| R11 | component: columna "Tienda" ausente en la variante adminTienda |

## Preguntas abiertas

Ninguna pendiente. Las 4 preguntas se resolvieron en la puerta humana F1.4:

1. **[PRODUCTO] Alcance = MVP "solo órdenes".** El landing muestra encabezado del
   apartado + módulo de órdenes de su tienda (con botón de carga masiva). Sin
   métricas/KPIs/widgets/accesos directos. → R1, R2, R6, R8.
2. **[UX] Ruta = landing `/` condicional por rol.** `app/(app)/page.tsx` ramifica por
   rol vía `resolveActorFromSession()`; `adminTienda` ve su dashboard, los demás roles
   conservan el placeholder actual. No hay ruta dedicada `/tienda`. → R1, R3, R5.
3. **[UX] Columna "Tienda" = oculta para `adminTienda`** (requisito firme). → R11.
4. **[NAV] Sidebar = no se toca en esta feature** (fuera de alcance del MVP).
