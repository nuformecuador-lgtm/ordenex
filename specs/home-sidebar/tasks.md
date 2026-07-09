# Tasks — home - sidebar

> Todas las tasks: `frontend_dev`. Feature de UI pura: ninguna task toca
> `db/`, Prisma, `app/api/`, `lib/actions/`, `lib/services/`,
> `lib/repositories/` ni `middleware.ts`. `[P]` = paralelizable respecto a las
> tareas de su mismo bloque de dependencia.
>
> Decisiones de producto: cerradas (ver "Decisiones cerradas" de
> `requirements.md`). Rutas definitivas `/configuracion`, `/perfil`, `/ordenes`;
> layout en nuevo grupo `app/(app)/` con la home autenticada dentro; placeholders
> mínimos para las tres rutas. No hay preguntas abiertas pendientes.

## Bloque 0 — Estructura de layout de la zona autenticada

- [x] T001 Crear el layout de la zona autenticada `app/(app)/layout.tsx`
  (Server Component) que renderice `<Sidebar />` y `<main>{children}</main>`, y
  trasladar la home autenticada tras login a `app/(app)/page.tsx` (con su botón
  mínimo de logout de la feature `login(home)`). **Hecho cuando:** el layout
  compila en `strict`, `pnpm run typecheck` y `pnpm run lint` siguen verdes, y
  las páginas de la zona se renderizan con el sidebar presente. Cubre parte de
  R14. Depende de: ninguna.

- [x] T002 [P] Crear las páginas *placeholder* mínimas de destino:
  `app/(app)/configuracion/page.tsx`, `app/(app)/perfil/page.tsx`,
  `app/(app)/ordenes/page.tsx`, cada una un Server Component con solo un
  encabezado (`<h1>`) con el nombre de la sección ("Configuración", "Perfil",
  "Órdenes"). **Hecho cuando:** navegar a cada ruta responde 200 (no 404),
  compila en `strict`, y un test mínimo confirma que cada página renderiza su
  título. Cubre R17 y da soporte a R2 (los `href` resuelven a una página real).
  Depende de: T001.
  → Test: `tests/components/PlaceholderPages.test.tsx` —
  `cada ruta renderiza su título (R17)`.

## Bloque 1 — Componente Sidebar (render e items)

- [x] T003 Crear `app/(app)/_components/Sidebar.tsx` (`'use client'`) con la
  constante `SIDEBAR_ITEMS` (label + href de los 3 items), renderizando un
  landmark `<nav aria-label="…">` con tres `<Link>` (`next/link`), etiquetas
  "Configuración", "Perfil", "Órdenes" y sus `href` de P1. **Hecho cuando:**
  test de componente confirma: exactamente 3 items con rol `link`, sus textos
  visibles, sus `href` correctos, y la presencia del landmark de navegación con
  nombre accesible. Cubre R1, R2, R3, R16 (uso de `Button` se valida en T005).
  Depende de: T001.
  → Test: `tests/components/Sidebar.test.tsx` —
  `render de items (R1, R2, R3)`.

## Bloque 2 — Item activo

- [x] T004 Resolver el item activo con `usePathname()` e igualdad exacta contra
  cada `href`, aplicando `aria-current="page"` al item activo. **Hecho cuando:**
  tests con `usePathname` mockeado verifican: (a) en `/perfil`, solo el item
  "Perfil" tiene `aria-current="page"`; (b) en cada una de las 3 rutas, es el
  item correcto; (c) en una ruta ajena (p. ej. `/`), ningún item tiene
  `aria-current`. Cubre R4, R5. Depende de: T003.
  → Test: `tests/components/Sidebar.test.tsx` —
  `item activo (R4, R5)`.

## Bloque 3 — Responsive y toggle móvil

- [x] T005 Añadir el botón de menú ("hamburguesa") con `Button` de
  `components/ui/` (variant ghost, ícono `lucide-react`), con `aria-label` y
  `aria-expanded`, y el estado local `isOpen` que controla la visibilidad del
  listado en móvil; el listado siempre montado/visible en desktop vía clases
  Tailwind (`hidden md:flex`, botón `md:hidden`). **Hecho cuando:** test de
  componente confirma que el botón existe con nombre accesible y que su
  `aria-expanded` inicial es `false` (colapsado por defecto). Cubre R7, R11,
  R16 (uso de `Button`); parte de R6. Depende de: T003.
  → Test: `tests/components/Sidebar.test.tsx` —
  `responsive: boton de menu colapsado por defecto (R7, R11)`.

- [x] T006 Implementar el toggle: activar el botón abre el listado y vuelve a
  activarlo lo cierra, actualizando `aria-expanded`. **Hecho cuando:** test con
  `userEvent.click` verifica la secuencia `false → true → false` en
  `aria-expanded` y la aparición/desaparición de los items en el DOM. Cubre R8,
  R9, R11. Depende de: T005.
  → Test: `tests/components/Sidebar.test.tsx` —
  `toggle abre y cierra (R8, R9, R11)`.

- [x] T007 [P] Cerrar el sidebar al activar un item con el menú abierto en
  móvil (`isOpen → false` tras el click en un `<Link>`). **Hecho cuando:** test
  abre el menú, hace click en un item y verifica que `aria-expanded` pasa a
  `false`. Cubre R10. Depende de: T006.
  → Test: `tests/components/Sidebar.test.tsx` —
  `cierra al navegar desde un item (R10)`.

## Bloque 4 — Teclado y accesibilidad

- [x] T008 [P] Verificar operabilidad por teclado: los tres items son
  alcanzables por tabulación y se activan con Enter (comportamiento nativo de
  `<a href>`); el botón de menú alterna el estado con Enter/Espacio. **Hecho
  cuando:** test de componente (`userEvent.tab` / `userEvent.keyboard('{Enter}')`)
  confirma el foco secuencial sobre los items y que Enter/Espacio sobre el botón
  alterna `aria-expanded`. Cubre R12, R13. Depende de: T006.
  → Test: `tests/components/Sidebar.test.tsx` —
  `operable por teclado (R12, R13)`.

## Bloque 5 — Integración en el layout

- [x] T009 Verificar la integración: el sidebar se renderiza dentro del layout
  de la zona autenticada junto a `children`, y NO aparece en `/login`. **Hecho
  cuando:** test del layout `app/(app)/layout.tsx` confirma que renderiza el
  `<nav>` del sidebar y los `children`; y se documenta/verifica que `/login`
  (fuera del grupo `(app)`) no incluye el sidebar. Cubre R14, R15. Depende de:
  T001, T003.
  → Test: `tests/components/AppLayout.test.tsx` —
  `monta el sidebar y los children (R14)` y
  `/login no incluye el sidebar (R15)`.

## Bloque 6 — Verificación final

- [ ] T010 Correr `pnpm run typecheck`, `pnpm run lint` y `pnpm test` en verde;
  registrar la salida y el mapa `R1..R17 → test` en
  `progress/impl_home-sidebar.md`. **Hecho cuando:** los tres comandos pasan y el
  mapa de trazabilidad está completo (cada R con al menos un test). Depende de:
  T001–T009.

- [ ] T011 Correr `./init.sh` y confirmar verde. **Hecho cuando:** `./init.sh`
  termina en verde y se añade la entrada correspondiente a `progress/history.md`.
  Depende de: T010.

## Mapa Requisito → Task/Test (resumen)

| Req | Task(s)      | Test (archivo :: caso)                                    |
| --- | ------------ | --------------------------------------------------------- |
| R1  | T003         | Sidebar.test.tsx :: render de items                        |
| R2  | T002, T003   | Sidebar.test.tsx :: render de items (href)                 |
| R3  | T003         | Sidebar.test.tsx :: landmark de navegación                 |
| R4  | T004         | Sidebar.test.tsx :: item activo                            |
| R5  | T004         | Sidebar.test.tsx :: item activo (ruta ajena)               |
| R6  | T005         | Sidebar.test.tsx :: listado desktop / responsive           |
| R7  | T005         | Sidebar.test.tsx :: colapsado por defecto                  |
| R8  | T006         | Sidebar.test.tsx :: toggle abre y cierra                   |
| R9  | T006         | Sidebar.test.tsx :: toggle abre y cierra                   |
| R10 | T007         | Sidebar.test.tsx :: cierra al navegar desde un item        |
| R11 | T005, T006   | Sidebar.test.tsx :: aria-expanded                          |
| R12 | T008         | Sidebar.test.tsx :: operable por teclado                   |
| R13 | T008         | Sidebar.test.tsx :: operable por teclado (Enter/Espacio)   |
| R14 | T001, T009   | AppLayout.test.tsx :: monta el sidebar y los children      |
| R15 | T009         | AppLayout.test.tsx :: /login no incluye el sidebar         |
| R16 | T003, T005   | Sidebar.test.tsx :: usa Button de components/ui            |
| R17 | T002         | PlaceholderPages.test.tsx :: cada ruta renderiza su título |
