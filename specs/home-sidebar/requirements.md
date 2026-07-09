# Requisitos — home - sidebar

> Alcance: menú de navegación (sidebar) responsive y simple para la zona
> autenticada de la app (lo que se ve tras el login, hoy `app/page.tsx` en la
> raíz protegida por `middleware.ts`). Expone exactamente tres items de
> navegación: **Configuración**, **Perfil** y **Órdenes**. Es una feature de
> **UI pura**: no toca backend, base de datos, Prisma, migraciones ni APIs. No
> implementa el contenido real de las páginas destino; crea *placeholders*
> mínimos para que la navegación no rompa (ver "Decisiones cerradas" y `tasks.md`).
>
> El sidebar se construye con shadcn/ui + Tailwind (mismas primitivas y patrón
> de accesibilidad que la feature `login(home)`), y se prueba con
> `@testing-library/react` sobre jsdom (Vitest), igual que los tests existentes
> en `tests/components/`.
>
> Rutas (decisión cerrada): los tres items apuntan a `/configuracion`,
> `/perfil` y `/ordenes` (rutas raíz, en español). Los requisitos R2/R4 se
> enuncian por "la ruta asociada al item" solo por claridad; los literales son
> definitivos.

## Items de navegación

- **R1 (ubicuo):** El sistema DEBE renderizar en el sidebar exactamente tres
  items de navegación, con las etiquetas de texto visibles "Configuración",
  "Perfil" y "Órdenes", y ningún otro item de navegación adicional.
- **R2 (ubicuo):** El sistema DEBE renderizar cada uno de los tres items como un
  enlace de navegación (elemento con rol `link`) cuyo destino (`href`) sea la
  ruta interna asociada a ese item (por defecto `/configuracion`, `/perfil` y
  `/ordenes` respectivamente; ver P1). Cada `href` DEBE ser una ruta interna
  (empieza con `/` y no con `//`).
- **R3 (ubicuo):** El sistema DEBE envolver el conjunto de items en un elemento
  de navegación identificable como *landmark* (elemento `<nav>` o `role="navigation"`)
  con un nombre accesible (p. ej. `aria-label`) que lo distinga de otras
  regiones de navegación de la página.

## Item activo

- **R4 (de estado):** MIENTRAS la ruta actual coincida con la ruta asociada a un
  item, el sistema DEBE marcar ese item como activo mediante el atributo
  `aria-current="page"`.
- **R5 (ubicuo):** El sistema DEBE marcar como activo (`aria-current="page"`)
  como máximo un item a la vez; SI la ruta actual no coincide con ninguna de las
  tres rutas asociadas, ENTONCES ningún item DEBE tener `aria-current="page"`.

## Comportamiento responsive

- **R6 (de estado):** MIENTRAS el viewport esté en el rango de escritorio (ancho
  igual o mayor al breakpoint definido en `design.md`), el sistema DEBE mostrar
  el sidebar expandido con sus tres items visibles y NO DEBE requerir ninguna
  acción del usuario para verlos.
- **R7 (de estado):** MIENTRAS el viewport esté en el rango móvil (ancho menor al
  breakpoint), el sistema DEBE mantener el listado de items colapsado por
  defecto y DEBE mostrar un control de tipo botón ("hamburguesa") con un nombre
  accesible para abrirlo.
- **R8 (por evento):** CUANDO el usuario activa el botón de menú estando el
  sidebar colapsado, el sistema DEBE mostrar (expandir) el listado con los tres
  items de navegación.
- **R9 (por evento):** CUANDO el usuario activa el control de cierre (el mismo
  botón de menú en estado abierto, o un control de cierre equivalente) estando el
  sidebar abierto, el sistema DEBE volver a colapsar el listado.
- **R10 (por evento):** CUANDO el usuario, con el sidebar abierto en móvil,
  activa uno de los tres items de navegación, el sistema DEBE navegar a la ruta
  del item y DEBE colapsar el sidebar.
- **R11 (ubicuo):** El botón de menú DEBE exponer su estado de expansión mediante
  `aria-expanded` (`true` cuando el listado está visible, `false` cuando está
  colapsado).

## Navegación por teclado y foco

- **R12 (ubicuo):** Cada uno de los tres items DEBE ser alcanzable por teclado
  (orden de tabulación lógico) y activable con la tecla Enter, sin depender del
  puntero.
- **R13 (por evento):** CUANDO el foco está sobre el botón de menú y el usuario
  presiona Enter o Espacio, el sistema DEBE alternar el estado de expansión del
  sidebar (equivalente a R8/R9).

## Integración en el layout de la zona autenticada

- **R14 (ubicuo):** El sistema DEBE renderizar el sidebar en el layout de la zona
  autenticada, de modo que esté presente en las páginas de esa zona junto al
  contenido de cada página (los `children` del layout).
- **R15 (ubicuo):** El sistema NO DEBE renderizar el sidebar en la ruta `/login`
  (la pantalla de login no pertenece a la zona autenticada).

## Stack de UI

- **R16 (ubicuo):** El sistema DEBE construir el sidebar con Tailwind CSS y con
  las primitivas de `components/ui/` (shadcn/ui) ya presentes en el repo cuando
  apliquen (p. ej. `Button` para el control de menú), sin reimplementar a mano
  una primitiva que shadcn/ui ya provee.

## Decisiones cerradas

Las tres preguntas de producto quedaron resueltas por el humano (confirmando las
propuestas por defecto del diseño); son definitivas para esta feature:

1. **Rutas de los tres items (afecta R2, R4).** Definitivo:
   `/configuracion`, `/perfil` y `/ordenes` — rutas raíz, en español, en
   minúsculas y sin tildes. No se anidan bajo ningún prefijo.
2. **Ubicación de la home autenticada y del layout (afecta R14, R15).**
   Definitivo: se crea un nuevo grupo de rutas `app/(app)/` con su propio
   `layout.tsx`, que monta el `Sidebar`. La home autenticada tras login vive
   dentro de ese grupo. El sidebar no aparece en `/login` (fuera del grupo).
3. **Placeholders de destino (afecta R2).** Definitivo: SÍ se crean páginas
   *placeholder* mínimas para `/configuracion`, `/perfil` y `/ordenes` (cada
   una un Server Component simple con un heading/título), para que la
   navegación no produzca 404. Su contenido real llega en features futuras
   (p. ej. `ordenes`). Se añade un test mínimo de que cada ruta renderiza su
   título (ver `tasks.md`).

## Requisitos de los placeholders de destino

- **R17 (ubicuo):** El sistema DEBE responder en las rutas `/configuracion`,
  `/perfil` y `/ordenes` con una página que renderice un encabezado
  (`heading`, p. ej. `<h1>`) con el nombre visible de la sección
  ("Configuración", "Perfil", "Órdenes" respectivamente), de modo que activar
  cualquiera de los tres items del sidebar no produzca un 404.
