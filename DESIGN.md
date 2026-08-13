# DESIGN.md — Ordenex

Sistema de diseño de la app (product UI). Dirección: **refinar la identidad actual, no rediseñar**. Toda pantalla nueva o refactorizada referencia estas reglas. Fuente de verdad de tokens: `app/globals.css`.

## Identidad y register
App UI que **sirve a la tarea** (no marketing). Objetivo: familiaridad ganada (Linear, Stripe) — la herramienta desaparece en la tarea. **Consistencia > sorpresa**; el delight se guarda para momentos, no para cada pantalla.

## Color
Única fuente: los tokens de `app/globals.css` (shadcn + marca). **NUNCA** hex sueltos ni utilidades ad-hoc (`emerald-600`, `text-[#065f46]`, `red-*`).
- Marca: `--primary` (#f26419 naranja) para acción primaria/selección/estado; `--sidebar` (navy) para el chrome de navegación.
- Semánticos: `--color-success`, `--color-danger`, `--color-warning`, `--color-info`. Todo indicador de estado (entregada/positivo, error, alerta, info) sale de acá.
- **Tres roles por semántico** (no son intercambiables):
  - `-soft` (`--color-success-soft`, …) = **fondo** de chip/pill/alert. En dark el soft es demasiado claro: usar la técnica soft-badge `bg-{sem}/15`.
  - base (`--color-success`, …) = **borde, acento y punto de estado** (dot, icono, barra). NO sirve para body text: su contraste sobre fondo claro es <4.5:1.
  - `-strong` (`--color-success-strong`, …) = **TEXTO**. Contrast-safe ≥4.5:1 sobre `--background`/`--card` y sobre el `-soft`, con variante dark propia. Todo texto de dinero (positivo/negativo), monto de estado o label semántico usa `-strong`, nunca la base ni un hex más oscuro.
  - La primitiva `Badge` implementa esto en sus variantes `success`/`warning`/`info`/`danger` (`bg-{sem}-soft text-{sem}-strong dark:bg-{sem}/15`). `EstatusBadge` y demás chips de estado se construyen sobre esas variantes: sin hex.
- **Restrained**: el acento es para acción primaria, selección y estado — nunca decoración. Nada de saturación fuerte en estados inactivos.

### Tokens que GIRAN con el tema y tokens FIJOS (feature 208)
No todos los tokens de `globals.css` son iguales, y confundirlos es el bug de modo oscuro más repetido del repo:
- **Giran** los que se declaran en `:root` y se redefinen en `.dark`: `background`, `foreground`, `card`, `popover`, `muted`, `border`, `input`, `ring`, `sidebar-*` y los cuatro `-strong`.
- **Son fijos** los del bloque `@theme` (un hex único): `navy`, `navy-deep`, la escala `asfalto-*`, `kraft-*`, `brand*`, `hivis` y los `-soft`.

**Regla:** un color fijo solo puede ir sobre una **superficie fija**, y un color que gira solo sobre una superficie que gira. Emparejarlos al revés es lo que produce los 1.0–1.5:1.
- Fijo sobre fijo, **correcto**: texto blanco sobre `bg-navy` (bloques de la POS card, panel de marca de login/postulación), `text-navy-deep` sobre `bg-warning`/`bg-brand-light` (chips de premio del podio), toda la landing pública.
- Fijo sobre superficie que gira, **error**: `text-navy` sobre `bg-card`, `border-navy/30` sobre `bg-muted`, `from-navy/10` sobre la página.
- Que gira sobre fijo, **también error**: `text-{sem}-strong` sobre `bg-{sem}-soft` sin `dark:bg-{sem}/15` — el fondo se queda claro y la tinta se aclara con él.

Superficie clara **por diseño**: se marca con la clase `tema-claro`, que fija los valores claros en su subárbol. No se depende de "es que no usa tokens del tema". Hoy la usan la landing pública y las dos hojas de la factura del cierre (facsímil de papel: blanco con tinta navy en los dos temas).

**Papel blanco no es `bg-white`.** Si una superficie es fija pero su contenido usa tokens que giran, pintarla con `bg-white`/`bg-navy` a secas deja la tinta en el valor del otro tema y empeora el problema en vez de arreglarlo (medido en la factura: 20 textos bajo AA pasan a 116). La superficie fija se declara con `tema-claro`, que arrastra todos los tokens del subárbol. Límite conocido y medido: fija los tokens, **no apaga el variant `dark:`** —se define contra el ancestro, no contra los tokens—, así que las utilidades `dark:` de `Badge`/`Button` siguen disparando dentro (ver los números en el comentario de `globals.css`).

## Tipografía
Una sola familia sans (`--font-sans`) para títulos, labels, botones, data y body. Escala **rem fija** (no `clamp` en product UI). Ratio 1.125–1.2 entre pasos. Prosa 65–75ch; tablas y UI compacta pueden ir más densas.

## Espaciado y shell
- **`AppPage` es el único shell de página**: `PageHeader` full-bleed (su `border-b` llega a los bordes) + contenido en `Container` (`p-6`, `gap-6`). Ninguna página arma su propio `<section p-6>` ni envuelve el header en padding.
- Ritmo vertical entre secciones: **`gap-6`** por defecto. Sin doble margen (el `PageHeader` NO trae `mb`).

## Componentes y estados (obligatorios)
Todo interactivo tiene: default / hover / **focus-visible** / active / disabled — más loading y error donde aplique. No se envía la mitad.
- **Focus ring estándar**: `focus-visible:ring-3 focus-visible:ring-ring/50`. En TODAS las piezas compartidas (incluidas Pagination, expand de DataTable, Tabs, toggle del Sidebar).
- **Button**: solo variantes de `buttonVariants`; prop `loading` (spinner + disabled) para acciones async. Prohibido armar botones a mano fuera del componente.
- **DataTable**: única tabla para listas. Estados incorporados: **skeleton** (no el texto "Cargando…"), empty (vía `EmptyState`) y error. Las tablas crudas se migran a esta.
- **FormField** (`label` + control + `FieldError`): único patrón de campo. Un solo `FieldError` = `<p role="alert" className="text-sm text-destructive">`. Aplica a todos los formularios.
- **EmptyState** (icono + mensaje que **enseña** el próximo paso + CTA opcional): reemplaza los "No hay X" pelados.
- **Badge / EstatusBadge**: sobre la primitiva `Badge` + tokens semánticos. Sin hex hardcodeado.
- **Modal** (feature 13) y **Toast** (feature 11): ya son consistentes — reusarlos siempre; el modal es último recurso (agotar alternativas inline).
- **Cards**: hermanas, nunca anidadas. Radio 12–16px (sin sobre-redondeo).

## Motion
150–250 ms; transmite **estado** (cambio, feedback, loading, reveal), no decoración. `@media (prefers-reduced-motion: reduce)` siempre. Sin secuencias de carga orquestadas: la app carga a una tarea.
