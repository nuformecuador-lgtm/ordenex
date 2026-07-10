# notificaciones — requirements.md

Feature id 11 · zone: frontend · complexity: low · branch: feature/11-notificaciones ·
depends_on: null

Sistema de **toast** reutilizable para mostrar mensajes efímeros al usuario
(éxito, error, info, advertencia), disparable desde cualquier componente cliente
del árbol de la app. Complementa a la feature 12 (`notificaciones-fix`), que
unificó los errores del backend: la UI debe poder tomar esos resultados de error y
mostrarlos como toast.

Notación EARS. Cada `R<n>` es testeable con Vitest + `@testing-library/react` +
`userEvent` (patrón `tests/components/`, `// @vitest-environment jsdom`) usando
temporizadores falsos de Vitest (`vi.useFakeTimers`) para el auto-descarte.
Convenciones:

- **"El sistema"** = el conjunto `ToastProvider` (`providers/`) + hook `useToast`
  (`hooks/`) + componente presentacional `Toast` (`components/shared/`).
- **"la API de disparo"** = el objeto devuelto por `useToast()` con
  `success` / `error` / `info` / `warning` / `show` / `dismiss`.
- **"un toast"** = una notificación individual renderizada en el viewport.
- **variantes** = `"success" | "error" | "info" | "warning"`.

---

## API de disparo y hook

- **R1** El sistema DEBE exponer un hook `useToast()` que devuelve una API de
  disparo con los métodos `success`, `error`, `info`, `warning` (cada uno acepta al
  menos un `message: string`), un método genérico `show(options)` y un método
  `dismiss(id)`. La identidad de la API DEBE ser estable entre renders (no crear
  una nueva referencia en cada render del consumidor).
- **R2** SI `useToast()` se invoca fuera de un `ToastProvider`, ENTONCES el sistema
  DEBE lanzar un error descriptivo (no devolver `undefined` ni fallar de forma
  silenciosa).
- **R3** El componente `ToastProvider` DEBE renderizar sus `children` sin
  alterarlos (envoltura transparente): cualquier subárbol montado dentro sigue
  visible y funcional.
- **R4** CUANDO el consumidor invoca `toast.<variante>(message)` (p. ej.
  `toast.success("Guardado")`), el sistema DEBE renderizar un toast cuyo texto
  visible es exactamente `message`.
- **R5** CUANDO el consumidor invoca `toast.show(options)` con
  `{ variant, message }` (y opcionalmente `duration`), el sistema DEBE renderizar
  el toast correspondiente y DEBE devolver un identificador (`id`) del toast creado.
  Los métodos `success`/`error`/`info`/`warning` son azúcar de `show` con la
  variante fijada y DEBEN devolver también el `id`.
- **R6** El sistema DEBE asignar a cada toast un `id` único; CUANDO se disparan
  varios toasts, los `id` devueltos NO DEBEN colisionar.

## Variantes y accesibilidad

- **R7** El sistema DEBE soportar las cuatro variantes `success`, `error`, `info`,
  `warning`. CADA toast DEBE exponer su variante de forma consultable (p. ej.
  atributo `data-variant`) y DEBE mostrar el indicador visual (icono) asociado a su
  variante.
- **R8** MIENTRAS un toast de variante `error` o `warning` está visible, el sistema
  DEBE anunciarlo con `role="alert"` (equivalente a `aria-live="assertive"`).
  MIENTRAS un toast de variante `success` o `info` está visible, el sistema DEBE
  anunciarlo con `role="status"` (equivalente a `aria-live="polite"`).
- **R9** El sistema DEBE renderizar los toasts en una región de viewport montada
  vía portal fuera del flujo del contenido (posición fija), con un nombre accesible
  (p. ej. `role="region"` + `aria-label`), de modo que no bloquee la interacción
  con el resto de la página.

## Auto-descarte, cierre manual y pausa

- **R10** CUANDO transcurre la duración por defecto tras mostrarse un toast (sin
  interacción), el sistema DEBE retirarlo automáticamente del viewport.
- **R11** DONDE se provea `duration` en las opciones de un toast, el sistema DEBE
  usar ese valor en lugar de la duración por defecto para su auto-descarte.
- **R12** DONDE `duration` sea `0` o `Infinity`, el sistema NO DEBE auto-descartar
  el toast: DEBE persistir hasta un cierre manual (R13) o programático (R14).
- **R13** El sistema DEBE renderizar en cada toast un botón de cierre con nombre
  accesible (p. ej. `aria-label="Cerrar notificación"`). CUANDO el usuario acciona
  ese botón, el sistema DEBE retirar ese toast del viewport.
- **R14** CUANDO el consumidor invoca `dismiss(id)`, el sistema DEBE retirar el
  toast cuyo `id` coincide. SI el `id` no corresponde a ningún toast activo,
  ENTONCES `dismiss` DEBE ser un no-op (no lanzar ni afectar a otros toasts).
- **R15** MIENTRAS el puntero está sobre un toast o el foco de teclado está dentro
  de él, el sistema DEBE pausar su temporizador de auto-descarte; CUANDO el puntero
  sale o el foco abandona el toast, el sistema DEBE reanudar el auto-descarte.
- **R16** DONDE se provea un callback `onDismiss` en las opciones de un toast, el
  sistema DEBE invocarlo exactamente una vez cuando ese toast se retira, sea por
  auto-descarte (R10), cierre manual (R13) o cierre programático (R14).

## Apilado de múltiples toasts

- **R17** CUANDO hay varios toasts activos, el sistema DEBE renderizarlos todos
  simultáneamente apilados en el viewport (no reemplaza el anterior).
- **R18** El `ToastProvider` DEBE aceptar un límite máximo de toasts visibles
  (`max`, con valor por defecto). CUANDO el número de toasts activos superaría
  `max`, el sistema DEBE dejar de mostrar los más antiguos (no permanecen visibles)
  para mantener a lo sumo `max` toasts visibles simultáneamente.
- **R19** CUANDO se retira un toast (manual, programático o por auto-descarte), el
  sistema NO DEBE retirar ni alterar los demás toasts activos.

## Integración con el layout y con errores del backend

- **R20** El sistema DEBE montar el `ToastProvider` en el layout de la app de forma
  que cualquier componente cliente del árbol autenticado pueda disparar toasts vía
  `useToast()` sin montar su propio provider.
- **R21** El sistema DEBE ofrecer un adaptador puro `messageFromActionError(err)`
  que, dado un `ActionError` de `lib/types/orden.ts` (literal `status` en
  `"validation_error" | "unauthenticated" | "forbidden" | "not_found" |
  "conflict"`), devuelve un mensaje en español apto para `toast.error(...)`,
  reutilizando los mensajes canónicos de `lib/errors` (`MSG` + `CODE_BY_DOMAIN_STATUS`)
  para no duplicar cadenas. Un `AppErrorShape` ya trae su propio `message` y puede
  pasarse directo a `toast.error(err.message)` (R4).

---

## Decisiones cerradas (humano, 2026-07-10)

- **[RESUELTO-A] Cableado de superficies existentes → FUERA de alcance.** Esta
  feature entrega SOLO el sistema de toast + el adaptador `messageFromActionError`.
  NO se cablea `app/(app)/ordenes/page.tsx` ni el `onError` del `Modal` (feature
  13); ese cableado es un follow-up con su propia actualización de tests. No se toca
  `OrdenesPage` ni sus tests verdes.

- **[RESUELTO-B] `validation_error` en `messageFromActionError` → mensaje genérico.**
  Para el literal `validation_error` de `ActionError` (que trae `fieldErrors`), el
  adaptador devuelve el mensaje genérico `MSG.VALIDATION_ERROR`; los errores por
  campo se muestran inline en el formulario, NO en el toast.

- **[RESUELTO-C] Primitiva → construir sobre `@base-ui/react/toast`.** Verificado en
  `node_modules`: `@base-ui/react@1.6.0` expone el submódulo `./toast`. Se construye
  el sistema **componiendo sobre esa primitiva de Base UI** (consistente con el
  `Modal`, feature 13, que usó `@base-ui/react/dialog`), NO un toast propio sobre
  Tailwind. El contrato público de `useToast()` (métodos y semántica testeable) se
  mantiene: nuestra API envuelve la primitiva. Ver `design.md`.
