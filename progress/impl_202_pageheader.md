# Feature 202 — PageHeader ilegible en modo oscuro

Rama `chore/deuda-202-207`. Zona frontend. Un solo archivo tocado:
`components/shared/PageHeader.tsx`.

## El defecto, medido

El header pintaba el texto con `text-navy` (#0b2545) y `text-navy/70`, el borde con
`border-navy/20` y el chip de fecha con `border-navy/20 bg-navy/5 text-navy`. `navy` es un
hex FIJO del `@theme` (no vive en `:root`/`.dark`), así que no gira con el tema: sobre el
`--background` oscuro (#0a1524) el `<h1>` quedaba en **1.03–1.18:1**. El umbral WCAG AA
para texto normal es 4.5:1. Afectaba al `<h1>` de TODA página del portal.

## Qué se cambió (solo tokens semánticos, cero hex)

| Pieza | Antes | Después |
|---|---|---|
| `<header>` texto | `text-navy` | `text-foreground` |
| `<header>` borde inferior | `border-navy/20` | `border-border` |
| descripción `<p>` | `text-navy/70` | `text-muted-foreground` |
| chip de fecha | `border-navy/20 bg-navy/5 text-navy` | `border-border bg-foreground/5 text-foreground` |
| fondo rol maestro | `bg-navy/5` | `bg-foreground/5` |

Los otros cuatro fondos por rol (`bg-brand/10`, `bg-info/10`, `bg-warning/10`,
`bg-success/10`) **no se tocaron**: se midieron y aguantan (ver abajo).

## Verificación en el navegador

`pnpm dev` ya estaba levantado en :3000 (otra sesión), así que se midió contra ese.
Script: `scratchpad/medir-contraste.mjs` (Playwright vía
`createRequire("R:/job/singularis/projects/ordenex/package.json")`). Login
`admin.qa@ordenex.test` con `networkidle` + 900 ms antes del submit. Rutas medidas:
`/dashboard`, `/wallet`, `/ordenes`, `/analitica` — las cuatro dieron números idénticos,
como corresponde a un componente compartido. Los 5 roles se recorren poniendo `data-rol`
sobre el `[data-slot="sidebar-inset"]`, que es exactamente lo que hace el layout: se
ejercita el CSS compilado de verdad, sin 5 logins.

**Trampa encontrada y corregida en el propio medidor:** Tailwind v4 compila `bg-navy/5` a
un `color-mix` y Chromium devuelve el valor computado como `lab(L a b / alpha)`, NO como
`rgb()`. La primera pasada lo parseó como rgb y produjo una tabla entera de números
plausibles y falsos (daba `#e4e5e9` donde el color real es `#f7e9e5`). La versión buena
convierte con canvas y saca el alpha del string aparte (getImageData premultiplica y a
0.05 de alpha el redondeo destroza el color). El script se autocomprueba antes de medir:
4 conversiones conocidas + negro/blanco = 21 + `--foreground`/`--background` = 14.79
(calculado a mano con la fórmula WCAG, fuera del script). La autocomprobación ya cazó un
valor de referencia mío equivocado, así que sirve.

### Contraste antes / después (ratio WCAG, umbral 4.5:1 para texto)

| tema | rol | h1 antes | h1 desp | desc antes | desc desp | chip antes | chip desp | borde antes | borde desp |
|---|---|---|---|---|---|---|---|---|---|
| claro | maestro | 13.19 | **13.45** | 5.42 | **6.60** | 12.01 | 12.25 | 1.49 | 1.16 |
| claro | admin | 13.01 | **13.27** | 5.41 | **6.51** | 11.85 | 12.08 | 1.49 | 1.16 |
| claro | adminSatelite | 12.52 | **12.77** | 5.27 | **6.26** | 11.41 | 11.64 | 1.49 | 1.16 |
| claro | adminTienda | 13.49 | **13.76** | 5.51 | **6.75** | 12.28 | 12.53 | 1.49 | 1.16 |
| claro | mensajero | 13.25 | **13.52** | 5.43 | **6.63** | 12.07 | 12.31 | 1.49 | 1.16 |
| oscuro | maestro | 1.18 | **13.88** | 1.12 | **7.28** | 1.17 | 12.23 | 1.03 | 1.49 |
| oscuro | admin | 1.08 | **14.01** | 1.05 | **7.35** | 1.08 | 12.35 | 1.03 | 1.49 |
| oscuro | adminSatelite | 1.11 | **14.40** | 1.07 | **7.56** | 1.10 | 12.79 | 1.03 | 1.49 |
| oscuro | adminTienda | 1.03 | **13.36** | 1.01 | **7.01** | 1.03 | 11.71 | 1.03 | 1.49 |
| oscuro | mensajero | 1.03 | **13.41** | 1.02 | **7.03** | 1.03 | 11.80 | 1.03 | 1.49 |

Texto: los 10 casos pasan 4.5:1 con margen (mínimo 6.26 en la descripción). En claro
además sube, porque `muted-foreground` (#4a5368) contrasta más que el `navy/70` compuesto.

El **borde** no es texto (WCAG 1.4.11 pide 3:1 solo a bordes que identifican un control;
este es un separador decorativo). En oscuro mejora 1.03 → 1.49; en claro baja 1.49 → 1.16
porque `--border` (#e3e8f2) es más suave que el `navy/20` de antes. Es el mismo token que
usan cards, tablas y el resto del shell, así que el separador queda consistente con la app
en vez de ser el único borde oscuro. Si se quiere más marcado, es decisión de diseño, no
de accesibilidad.

### Los cinco fondos por rol, uno por uno

Se midió la distancia RGB entre el fondo compuesto del header y el fondo de página (cuánto
se NOTA el tinte; 0 = invisible):

| rol | clase | claro antes/desp | oscuro antes/desp | veredicto |
|---|---|---|---|---|
| maestro | `bg-navy/5` → `bg-foreground/5` | 18.3 / 18.3 | **1.8 / 18.7** | **cambiado** |
| admin | `bg-brand/10` | 27.1 / 27.1 | 24.5 / 24.5 | intacto, aguanta |
| adminSatelite | `bg-info/10` | 27.6 / 27.6 | 19.5 / 19.5 | intacto, aguanta |
| adminTienda | `bg-warning/10` | 25.7 / 25.7 | 27.3 / 27.3 | intacto, aguanta |
| mensajero | `bg-success/10` | 26.9 / 26.9 | 18.9 / 18.9 | intacto, aguanta |

Los cuatro semánticos son colores saturados: al 10% se separan del fondo en los DOS temas
y no hunden el contraste del texto (columna h1, 13.36–14.40 en oscuro). No necesitan
variante `dark:` propia y no se tocaron.

`maestro` era el caso roto: `navy` (#0b2545) al 5% sobre `--background` oscuro (#0a1524)
da distancia 1.8 — el portal del maestro se quedaba sin pista de color. `bg-foreground/5`
gira con el tema y en claro compone prácticamente el mismo color (#ebedf3 → #ecedf3, un
punto de diferencia: imperceptible, y la distancia al fondo no se mueve: 18.3 en los dos).

## Lo que sigue roto y NO se tocó (fuera del alcance de la 202)

Los tres controles de la derecha del header viven en otros archivos y siguen con `navy`
fijo. Medidos en la misma pasada, en oscuro:

- `LogoutButton` (`app/_components/LogoutButton.tsx`, `text-navy border-navy/40 hover:bg-navy/10`): **1.01–1.09:1**.
- `NotificationsBell` (`components/shared/NotificationsBell.tsx`, `text-navy` + panel con `text-navy`, `bg-navy/10`, `text-navy/70`): **1.03–1.11:1**.

En claro los dos están en 12.5–13.5. Es el mismo defecto de raíz, pero en otra superficie:
en el repo hay **83 usos de utilidades `-navy` fijas repartidos en 31 archivos** `.tsx`.
Eso es una ficha propia (barrido de `navy` fijo → tokens), no un apaño dentro de esta.

## Comandos

- `pnpm exec vitest run tests/components tests/unit/guards` → 2557/2558. El único rojo,
  `TableroOperativo.test.tsx > "el aviso de cobertura declara la penumbra"`, es un timeout
  de 20 s bajo carga (corrían a la vez el dev server, Playwright y otro agente); ese
  archivo **solo, pasa 50/50 en 6.1 s**. No renderiza `PageHeader`.
- `pnpm exec tsc --noEmit` → limpio.
- `pnpm exec eslint components/shared/PageHeader.tsx` → limpio.

No se tocó `tests/unit/descarga/` (otro agente trabajando ahí en paralelo).
