# Implementación — home - sidebar (id 5)

Feature de UI pura. Sin backend/DB/Prisma/APIs/middleware. Coordinada por
`implementer`, implementada por `frontend_dev` (opus). Verificación corrida y
re-verificada por el implementer.

## Archivos tocados

Creados:
- `app/(app)/layout.tsx` — Server Component: `<Sidebar />` + `<main>{children}</main>`.
- `app/(app)/page.tsx` — home autenticada (trasladada desde `app/page.tsx`), con
  su `<LogoutButton />` importado de `@/app/_components/LogoutButton`. Ruta `/`
  (los route groups no cambian la URL; el redirect del login a `/` sigue válido).
- `app/(app)/_components/Sidebar.tsx` — Client Component: `SIDEBAR_ITEMS`,
  `<nav aria-label="Navegación principal">`, 3 `<Link>`, `aria-current` exacto vía
  `usePathname`, botón hamburguesa (`Button` ghost/icon, `aria-expanded`/`aria-label`,
  ícono `Menu`/`X` de lucide-react), estado `isOpen`, cierre al navegar. Listado
  desktop siempre montado (`hidden md:flex`); listado móvil montado/desmontado por
  `isOpen` para ser observable en jsdom.
- `app/(app)/configuracion/page.tsx` — Server Component, `<h1>Configuración</h1>`.
- `app/(app)/perfil/page.tsx` — Server Component, `<h1>Perfil</h1>`.
- `app/(app)/ordenes/page.tsx` — Server Component, `<h1>Órdenes</h1>`.
- `tests/components/Sidebar.test.tsx` — 6 casos (render real del Sidebar).
- `tests/components/PlaceholderPages.test.tsx` — render real de las 3 páginas.
- `tests/components/AppLayout.test.tsx` — 2 casos (layout real + estructura /login).

Modificados:
- `tests/components/HomePage.test.tsx` — imports `@/app/page` → `@/app/(app)/page`.
- `specs/home-sidebar/tasks.md` — T001–T009 marcadas `[x]`.

Borrados:
- `app/page.tsx` — evita duplicar la ruta `/`; el grupo `(app)` conserva la URL.

## Mapa R<n> → test

| Req | Test (archivo :: caso) |
| --- | --- |
| R1  | Sidebar.test.tsx :: render de items (R1, R2, R3) — exactamente 3 links |
| R2  | Sidebar.test.tsx :: render de items (R1, R2, R3) — href /configuracion //perfil //ordenes, internos |
| R3  | Sidebar.test.tsx :: render de items (R1, R2, R3) — nav landmark con aria-label |
| R4  | Sidebar.test.tsx :: item activo (R4, R5) — aria-current="page" en la ruta actual |
| R5  | Sidebar.test.tsx :: item activo (R4, R5) — ruta ajena "/" → ningún aria-current |
| R6  | Sidebar.test.tsx :: render de items / item activo — listado desktop siempre montado |
| R7  | Sidebar.test.tsx :: responsive: boton de menu colapsado por defecto (R7, R11) |
| R8  | Sidebar.test.tsx :: toggle abre y cierra (R8, R9, R11) |
| R9  | Sidebar.test.tsx :: toggle abre y cierra (R8, R9, R11) |
| R10 | Sidebar.test.tsx :: cierra al navegar desde un item (R10) |
| R11 | Sidebar.test.tsx :: responsive colapsado por defecto + toggle abre y cierra (aria-expanded) |
| R12 | Sidebar.test.tsx :: operable por teclado (R12, R13) — tab order sobre los links |
| R13 | Sidebar.test.tsx :: operable por teclado (R12, R13) — Enter/Espacio alterna aria-expanded |
| R14 | AppLayout.test.tsx :: monta el sidebar y los children (R14) |
| R15 | AppLayout.test.tsx :: /login no incluye el sidebar (R15) |
| R16 | Sidebar.test.tsx (usa Button de components/ui + landmark) / Sidebar.tsx |
| R17 | PlaceholderPages.test.tsx :: cada ruta renderiza su título (R17) |

## Verificación (corrida por el implementer, salida real)

```
pnpm typecheck  → OK (tsc --noEmit, sin errores)
pnpm lint       → OK (eslint, sin errores)
pnpm test       → Test Files 27 passed (27) | Tests 153 passed (153)
```

Subconjunto de la feature (4 archivos nuevos/modificados):
```
Test Files  4 passed (4)
Tests  12 passed (12)
```

## Notas / deuda

- Los tests renderizan los componentes REALES (no stubs del componente bajo prueba)
  y asertan comportamiento observable (aria-current, aria-expanded, presencia en
  DOM, foco por teclado). `next/link` y `next/navigation` se mockean solo para
  aislar el runtime del router, no el Sidebar. R15 se verifica de forma estructural
  leyendo `app/layout.tsx` y `app/login/page.tsx` (ninguno monta Sidebar).
- El comportamiento puramente visual del breakpoint (`hidden md:flex` / `md:hidden`)
  no se testea con RTL (jsdom no computa CSS); se cubriría en E2E si se requiere.
- `frontend_dev` limpió `.next/dev/types` y `.next/types` (contenían un validador
  generado que aún referenciaba el `app/page.tsx` borrado); se regeneran solos.
- Pendiente por el implementer/leader: T010 (esta bitácora, hecha) y T011 (`./init.sh`
  + entrada en `progress/history.md`).
