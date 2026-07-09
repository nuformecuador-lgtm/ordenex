# Diseño — home - sidebar

## Enfoque general

Feature de **UI pura**. No se toca `db/`, Prisma, migraciones, `app/api/`,
`lib/actions/`, `lib/services/`, `lib/repositories/` ni `middleware.ts`. El
control de acceso a la zona autenticada ya lo hace `middleware.ts` (redirige a
`/login` cuando falta la cookie `session`); esta feature solo añade el chrome de
navegación visible dentro de esa zona ya protegida.

Se reutiliza el mismo stack de la feature `login(home)`: Next.js App Router,
TypeScript strict, Tailwind v4, primitivas de `components/ui/` (shadcn/ui sobre
`@base-ui/react`), y tests de componente con Vitest + `@testing-library/react`
en jsdom (patrón de `tests/components/`).

## Rutas elegidas (decisión cerrada)

| Item          | Ruta por defecto  |
| ------------- | ----------------- |
| Configuración | `/configuracion`  |
| Perfil        | `/perfil`         |
| Órdenes       | `/ordenes`        |

Se eligen rutas **planas, en español, en minúsculas y sin tildes** por
coherencia con la convención de nombres del repo (`kebab-case` para archivos de
ruta, español en el dominio del producto — igual que la feature `login`). Se
descarta anidar bajo `/home/*` porque no aporta jerarquía real (son secciones de
primer nivel de la app autenticada) y alarga las URLs sin beneficio. Decisión
confirmada por el humano; definitiva.

Las rutas se centralizan en una constante para que el componente y sus tests
compartan una única fuente de verdad y para absorber un eventual cambio de P1 en
un solo lugar:

```ts
// definido junto al componente (no promovido a lib/ salvo reuso futuro)
export const SIDEBAR_ITEMS = [
  { label: "Configuración", href: "/configuracion" },
  { label: "Perfil",        href: "/perfil" },
  { label: "Órdenes",       href: "/ordenes" },
] as const;
```

## Estructura de componentes

```
app/
  (app)/                         Route group de la zona autenticada (decisión cerrada)
    layout.tsx                   Server Component: layout de la zona autenticada.
                                   - Renderiza <Sidebar /> + <main>{children}</main>.
                                   - No fetchea datos sensibles para esta feature;
                                     la protección de ruta la hace middleware.ts.
    page.tsx                     Home autenticada tras login (se traslada aquí la
                                   home actual app/page.tsx, con su botón mínimo
                                   de logout de la feature login(home)).
    configuracion/page.tsx       Placeholder mínimo (heading "Configuración").
    perfil/page.tsx              Placeholder mínimo (heading "Perfil").
    ordenes/page.tsx             Placeholder mínimo (heading "Órdenes").
    _components/
      Sidebar.tsx                Client Component ('use client').
        - Lee la ruta actual con usePathname() (next/navigation) para el activo.
        - Estado local isOpen (useState) para el toggle móvil.
        - Renderiza <nav aria-label="Navegación principal"> con los 3 <Link>.
        - Botón de menú (Button de components/ui/) con aria-expanded/aria-label.
```

> Decisión cerrada: el grupo `app/(app)/` con su `layout.tsx` es el punto de
> montaje del `Sidebar`, y la home autenticada tras login vive dentro del grupo.
> `/login` queda fuera del grupo, por lo que no muestra el sidebar (R15).

### Sidebar: Client Component (no Server Component)

`Sidebar.tsx` es **Client Component** porque necesita:

1. `usePathname()` para resolver el item activo (`aria-current`, R4/R5). Es un
   hook de cliente.
2. Estado de UI (`isOpen`) para el toggle responsive (R7–R11), que es
   interacción de navegador.

El **layout** (`app/(app)/layout.tsx`) sí es Server Component (regla de
`docs/architecture.md`: las páginas/layouts son server salvo que necesiten
interacción). El layout solo compone `<Sidebar />` y `{children}`; no contiene
lógica de negocio ni fetch. Este patrón (page/layout server + componente
interactivo cliente) es el mismo que `app/login/page.tsx` + `LoginForm.tsx`.

## Item activo (R4, R5)

- Se compara `usePathname()` contra el `href` de cada item.
- Coincidencia por igualdad exacta del pathname con el `href`. Para esta feature
  (3 secciones planas, sin subrutas todavía) la igualdad exacta es suficiente y
  determinista; se evita `startsWith` para no marcar activos falsos si en el
  futuro aparecen rutas hermanas con prefijo común. Si más adelante hay subrutas
  (p. ej. `/ordenes/123`) y se quiere resaltar la sección padre, se revisará
  entonces (fuera de alcance).
- El item activo recibe `aria-current="page"` (además de un estilo Tailwind de
  resaltado). Los demás no llevan el atributo.

## Responsive (R6–R11)

- **Breakpoint:** `md` de Tailwind (768px). `< md` = móvil (colapsable con
  hamburguesa); `>= md` = escritorio (expandido siempre). Se elige `md` porque
  es el breakpoint estándar de Tailwind para el salto tablet/desktop y el que ya
  usa el proyecto en sus utilidades `sm:`/`md:`.
- **Escritorio (R6):** el `<nav>` con los 3 items se muestra siempre
  (`hidden md:flex` en el contenedor de items, o equivalente). El botón
  hamburguesa se oculta en `md:` (`md:hidden`).
- **Móvil (R7–R11):** el botón hamburguesa es visible; el listado de items se
  muestra u oculta según `isOpen`. `aria-expanded={isOpen}` en el botón.
  Activar el botón alterna `isOpen` (R8/R9/R13). Activar un item pone
  `isOpen=false` (R10).
- Importante para testabilidad: la visibilidad NO debe depender solo de media
  queries CSS (jsdom no evalúa layout). El estado abierto/cerrado en móvil se
  refleja en el **DOM/atributos** (montar/desmontar el listado, o `hidden` +
  `aria-expanded`), de modo que los tests puedan afirmar sobre presencia de los
  items y sobre `aria-expanded` sin medir píxeles. El comportamiento puramente
  visual del breakpoint (mostrar en desktop, ocultar en móvil) se resuelve con
  clases Tailwind y no se testea con RTL (se cubriría, si acaso, en E2E).

## Navegación por teclado (R12, R13)

- Los items son `<Link>` de `next/link` (renderizan `<a href>`), por lo que son
  focusables y activables con Enter de forma nativa; no se añade `onKeyDown`
  manual para ellos.
- El botón de menú es el `Button` de `components/ui/` (elemento `<button>`
  nativo), que ya responde a Enter/Espacio; `aria-expanded` refleja el estado.

## Componentes de UI (shadcn/ui + Tailwind) (R16)

- Se reutiliza `Button` de `components/ui/button.tsx` (ya en el repo) para el
  control hamburguesa, con `variant="ghost"` y `size="icon"`, e ícono de
  `lucide-react` (`Menu` / `X`), dependencia ya presente en `package.json`.
- No se instala el componente `sidebar` completo de shadcn (ver alternativa
  descartada). El `<nav>` y los `<Link>` son marcado propio con clases Tailwind,
  colocado junto a la página que lo usa (`app/(app)/_components/`) porque hoy lo
  consume una sola zona (regla "sin sobre-ingeniería" de `docs/architecture.md`).
  Se promovería a `components/shared/` solo si una segunda feature lo requiere.

## Placeholders de destino (R2, R17 sin 404) — decisión cerrada

Para que activar un item no produzca 404, se crean páginas *placeholder* mínimas
(`configuracion/page.tsx`, `perfil/page.tsx`, `ordenes/page.tsx`): cada una un
Server Component que renderiza solo un encabezado (`<h1>`) con el nombre de la
sección ("Configuración", "Perfil", "Órdenes"). Su contenido real es
responsabilidad de futuras features (p. ej. `ordenes`) y queda **fuera de
alcance**. Un test mínimo por ruta verifica que renderiza su título (R17).

## Alternativas descartadas

1. **Instalar el componente `sidebar` completo de shadcn/ui
   (`npx shadcn add sidebar`).** Descartada. El sidebar de shadcn trae un
   `SidebarProvider` con contexto, persistencia del estado colapsado en cookie,
   atajos de teclado globales, `Sheet` para móvil, rieles arrastrables y una
   docena de subcomponentes. Para "un menú responsive **simple** con tres items"
   es sobre-ingeniería clara: contradice la regla "sin sobre-ingeniería" de
   `docs/architecture.md`, añade superficie de estado (cookie server/client) sin
   requisito que la justifique y complica los tests de componente. Un `<nav>` con
   tres `<Link>` + un `Button` hamburguesa cubre R1–R16 con mucho menos código.
   Nota: `docs/architecture.md` pide "revisar shadcn antes de crear uno propio";
   se revisó y se documenta aquí por qué la primitiva compuesta no encaja,
   mientras sí se reutiliza la primitiva simple `Button`.

2. **Montar el `<Sidebar />` en el `RootLayout` (`app/layout.tsx`).**
   Descartada. El `RootLayout` también envuelve `/login`, que NO debe mostrar el
   sidebar (R15). Meterlo ahí obligaría a condicionar su render por pathname
   dentro del root, ensuciando el layout raíz con lógica de zona. Un layout de
   grupo `(app)` aísla la zona autenticada y satisface R14/R15 de forma
   estructural, sin condicionales.

3. **Resolver el item activo con `startsWith(pathname, href)` en vez de igualdad
   exacta.** Descartada para esta feature: con rutas planas y sin subrutas
   definidas, `startsWith` marcaría `/` o rutas hermanas de forma ambigua y podría
   activar más de un item, violando R5. La igualdad exacta es determinista y
   testeable; el caso de resaltar sección padre por subruta no es un requisito
   actual.

## Trazabilidad prevista (detalle en tasks.md)

- R1, R2, R3, R16 → test de render de `Sidebar` (3 items con labels y `href`
  correctos, `<nav>`/landmark, uso de `Button`).
- R4, R5 → tests con `usePathname` mockeado a cada ruta (y a una ruta ajena).
- R6, R7 → assert de presencia del botón hamburguesa y del listado según estado
  (jsdom): estado colapsado inicial en móvil, listado siempre montado para desktop.
- R8, R9, R11, R13 → tests de `userEvent` sobre el botón: `aria-expanded`
  alterna y el listado aparece/desaparece (click y teclado Enter/Espacio).
- R10 → test: con menú abierto, click en un item → `isOpen` pasa a false
  (`aria-expanded="false"`).
- R12 → test de tab order / activación con Enter sobre los `<Link>`.
- R14, R15 → test del layout `app/(app)/layout.tsx` (renderiza Sidebar + children)
  y confirmación de que `/login` no lo incluye (el sidebar vive solo en el grupo).
- R17 → test mínimo de cada página placeholder: renderiza su heading/título.
