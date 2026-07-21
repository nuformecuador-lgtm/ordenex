# DESIGN.md — Ordenex

Sistema de diseño de la app (product UI). Dirección: **refinar la identidad actual, no rediseñar**. Toda pantalla nueva o refactorizada referencia estas reglas. Fuente de verdad de tokens: `app/globals.css`.

## Identidad y register
App UI que **sirve a la tarea** (no marketing). Objetivo: familiaridad ganada (Linear, Stripe) — la herramienta desaparece en la tarea. **Consistencia > sorpresa**; el delight se guarda para momentos, no para cada pantalla.

## Color
Única fuente: los tokens de `app/globals.css` (shadcn + marca). **NUNCA** hex sueltos ni utilidades ad-hoc (`emerald-600`, `text-[#065f46]`, `red-*`).
- Marca: `--primary` (#f26419 naranja) para acción primaria/selección/estado; `--sidebar` (navy) para el chrome de navegación.
- Semánticos: `--color-success`, `--color-danger`, `--color-warning`, `--color-info` (+ variantes `-soft`). Todo indicador de estado (entregada/positivo, error, alerta, info) sale de acá.
- **Restrained**: el acento es para acción primaria, selección y estado — nunca decoración. Nada de saturación fuerte en estados inactivos.

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
