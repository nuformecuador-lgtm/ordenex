# modal — design.md

Diseño técnico del componente `Modal` reutilizable (feature 13). Traza contra
`requirements.md`. No introduce datos, tablas, RLS ni endpoints: es un componente
de UI puro de cliente. No hay modelo de datos ni migraciones para esta feature.

## Ubicación y stack

- Archivo: `components/shared/Modal.tsx` (compuesto reutilizable, ≥2 features lo
  usan: 14 `ordenes - carga masiva` y previsiblemente confirmaciones de borrado en
  el CRUD de órdenes → justifica vivir en `shared/`, ver `docs/architecture.md`
  "Regla: sin sobre-ingeniería").
- `"use client"` (usa estado y eventos de usuario).
- Estilos con Tailwind v4 + helper `cn` (`@/lib/utils`), como el resto de `shared/`.
- Spinner: `Loader2` de `lucide-react` con `animate-spin`, igual que
  `BulkUpload.tsx` (consistencia visual ya establecida en el repo).
- Botones: primitiva existente `@/components/ui/button` (`Button`), incluyendo su
  variante `destructive` y su estado `disabled` (ya soporta `disabled:opacity-50`
  y `disabled:pointer-events-none`).

## Decisión clave: componer sobre Base UI Dialog (no instalar shadcn/Radix dialog)

**Decisión:** construir `Modal` **componiendo sobre `@base-ui/react/dialog`**, que
YA está instalado (`@base-ui/react@1.6.0`, es la base de `components/ui/button.tsx`).

Base UI `Dialog` aporta de fábrica lo caro y propenso a bugs de accesibilidad:

- `Dialog.Root` con `open` / `onOpenChange(open, eventDetails)` controlado (R1–R4).
  `eventDetails.reason` distingue `escapeKey`, `outsidePress`, `closePress`, etc.,
  lo que permite implementar R25–R27 sin listeners manuales.
- `modal` (default `true`): focus trap + scroll lock + `aria-modal` (R28, R30).
- `Dialog.Portal` + `Dialog.Backdrop` (overlay) → R26.
- `Dialog.Popup` con foco inicial gestionado (R29).
- `Dialog.Title` / `Dialog.Description` cablean `aria-labelledby` /
  `aria-describedby` automáticamente (R5, R6).
- `disablePointerDismissal` y no propagar el cierre por Escape cubren R19/R27.

Sobre esa primitiva, `Modal` añade SOLO la capa de producto: layout de
título/cuerpo/footer, botones confirmar/cancelar y **toda la lógica async**
(spinner, bloqueo, anti-doble-submit, resolución/rechazo, error), que Base UI no
provee.

### Alternativa descartada: instalar `npx shadcn add dialog`

`docs/architecture.md` dice "primero revisar si existe en shadcn/ui antes de crear
uno propio". Se evaluó y **se descarta** porque:

1. El registro shadcn que trae este repo (`components.json`, style `base-nova`) y el
   `Button` del repo se basan en **Base UI**, no en Radix. El comando shadcn `dialog`
   estándar instala `@radix-ui/react-dialog`, introduciendo una **segunda librería
   de primitivas** (Radix) para resolver algo que Base UI ya cubre. Eso es
   exactamente la "dependencia innecesaria" y "sobre-ingeniería" que el reviewer
   penaliza (`docs/architecture.md`).
2. Aun instalando shadcn dialog, la lógica async (spinner/bloqueo/anti-doble-submit/
   manejo de rechazo) NO viene incluida: habría que escribirla igual. El ahorro es
   nulo y el coste (dep. duplicada + posible conflicto de estilos/portales) es real.

Conclusión: **componer sobre la primitiva Base UI ya presente**, sin nuevas
dependencias. (Nota: NO se cuenta como "crear un dialog propio desde cero" —no se
reimplementa focus-trap/overlay/aria; se reutiliza la primitiva instalada.)

### Segunda alternativa descartada: diálogo 100% propio con `<div>` + hooks

Implementar overlay, focus-trap, restauración de foco, `aria-modal` y Escape a mano.
Descartado: es el código más difícil de hacer accesible y correcto, ya resuelto por
la primitiva instalada. Reinventarlo contradice el principio de reutilización.

## Contrato de props (TypeScript)

```ts
import type { ReactNode } from "react";

export interface ModalProps {
  /** Visibilidad controlada. El padre es la fuente de verdad (R1, R2). */
  open: boolean;
  /** Emite el nuevo estado abierto/cerrado. El padre actualiza `open` (R3, R4). */
  onOpenChange: (open: boolean) => void;

  /** Título; se asocia como aria-labelledby (R5). */
  title: ReactNode;
  /** Descripción opcional; aria-describedby (R6). */
  description?: ReactNode;
  /** Contenido arbitrario del cuerpo (R7). */
  children?: ReactNode;

  /** Etiqueta del botón confirmar (R8). Default "Confirmar". */
  confirmLabel?: string;
  /** Etiqueta del botón cancelar (R8). Default "Cancelar". */
  cancelLabel?: string;
  /** Variante visual del confirmar; se pasa al Button (R8b). Default "default". */
  confirmVariant?: "default" | "destructive";
  /** Oculta el botón cancelar (R10). Default false. */
  hideCancel?: boolean;

  /**
   * Handler de confirmación (R9, R11, R14). Puede ser síncrono (void) o async
   * (Promise<void>). Si devuelve una promesa, se activa el flujo async.
   */
  onConfirm?: () => void | Promise<void>;
  /** Handler de cancelación, previo al cierre (R13). */
  onCancel?: () => void;
  /**
   * Único canal de error: se invoca con el error capturado si el confirmar async
   * rechaza (R23). El componente NO renderiza error propio; el consumidor decide
   * cómo mostrarlo (p. ej. toast de la feature 11).
   */
  onError?: (error: unknown) => void;

  /**
   * Si false, el modal NO se cierra tras un confirmar exitoso; permanece abierto
   * para flujos multi-paso (R12, R20, R21). Default true.
   */
  closeOnConfirm?: boolean;
  /**
   * Si false, deshabilita cierre por Escape y overlay (R27). Default true.
   * Independiente del bloqueo temporal durante "pendiente" (R19).
   */
  dismissible?: boolean;

  /** Clases extra para el popup. */
  className?: string;
}
```

`confirmVariant` se reenvía tal cual a `<Button variant={confirmVariant}>` del
botón de confirmación (R8b). No se añade `errorMessage` ni ninguna prop de render
de error: el único canal de error es `onError` (decisión humana 2026-07-09, R23).

## Máquina de estado interna

Estado local mínimo (no se expone; el `open` lo controla el padre):

```
type ConfirmPhase = "idle" | "pending";
```

- `idle`: comportamiento normal; botones habilitados.
- `pending`: `onConfirm` devolvió una promesa aún no resuelta (R14).

No existe fase `error` ni estado de texto de error: ante un rechazo se vuelve a
`idle` (botones re-habilitados) y se delega en `onError` (R22, R23). No se guarda ni
renderiza mensaje de error alguno.

## Detección y manejo del async de `onConfirm`

Al accionar confirmar (`handleConfirm`):

1. **Guardas anti-doble-submit (R17):** si `phase === "pending"`, retornar de
   inmediato. Además el botón está `disabled` mientras `pending` (R16), doble red
   de seguridad.
2. Invocar `const result = onConfirm?.()`.
3. **Detección de promesa** (no confiar solo en `instanceof`, cubrir thenables):
   ```ts
   const isThenable =
     result != null &&
     typeof (result as { then?: unknown }).then === "function";
   ```
4. **Rama síncrona** (`!isThenable`): si `closeOnConfirm !== false` →
   `onOpenChange(false)` (R11, R12). Fin.
5. **Rama async** (`isThenable`): `setPhase("pending")` (R14, R15, R16, R18, R19).
   `await` de `Promise.resolve(result)`:
   - **resuelve:** `setPhase("idle")`; si `closeOnConfirm !== false` →
     `onOpenChange(false)` (R20); si `false`, quedarse abierto (R21).
   - **rechaza (`catch (err)`):** `setPhase("idle")` (re-habilita confirmar y
     cancelar y detiene el spinner); `onError?.(err)`; NO cerrar → el modal
     permanece abierto (R22, R23). No se renderiza ni deriva ningún mensaje: la
     presentación del error es responsabilidad del consumidor (p. ej. toast).

Nota React 19: se envuelve el manejo async en una función interna; los `setState`
tras `await` son seguros mientras el componente siga montado. Se usa una `ref`
`mountedRef` para no llamar `setState` si se desmontó durante la promesa (evita
warnings). No se usa `AbortController` porque la promesa del consumidor no es
cancelable por contrato.

## Mapeo cierre ↔ Base UI

`Dialog.Root` recibe:

- `open={open}`.
- `onOpenChange={(next, details) => { ... }}`:
  - Si `phase === "pending"` → ignorar TODA solicitud de cierre (R19).
  - Si `dismissible === false` y `details.reason` es `escapeKey` u `outsidePress` →
    ignorar (R27).
  - En cualquier otro caso de cierre → `onOpenChange(false)` (R3, R25, R26). Al
    abrir (`next === true`) → propagar `onOpenChange(true)`.
- `disablePointerDismissal={!dismissible || phase === "pending"}` como refuerzo
  declarativo de R19/R27 (evita depender solo del filtrado en el callback).

Botón cancelar (`handleCancel`): si `phase === "pending"` → no-op (R19); si no →
`onCancel?.()` y `onOpenChange(false)` (R13).

## Accesibilidad (resumen de mapeo)

| Requisito | Mecanismo |
| --- | --- |
| R2 rol dialog | `Dialog.Popup` (rol dialog) |
| R5 aria-labelledby | `Dialog.Title` |
| R6 aria-describedby | `Dialog.Description` (solo si hay `description`) |
| R18 anuncio de carga | `role="status"` + `Loader2` en el confirmar; `aria-busy` en popup |
| R28 aria-modal | `modal` (default true) de `Dialog.Root` |
| R29 foco inicial | gestión de foco de `Dialog.Popup` |
| R30 focus trap | `modal` de Base UI |
| R31 restauración de foco | provista por Base UI (default); sin lógica ni test propio |

## Manejo de errores (convenciones)

- Sin `catch` vacíos: el `catch` del confirmar async vuelve a `idle` (re-habilita
  botones, detiene spinner) y delega el error en `onError` (`docs/conventions.md`).
- No se registran secretos ni PII (el componente no inspecciona el error, solo lo
  reenvía a `onError`).
- El componente NO traga el error silenciosamente: mantiene el modal abierto (R22) y
  ofrece el error al consumidor vía `onError` (R23), único canal de presentación.

## Fuera de alcance

- Persistencia, red o llamadas a Server Actions (las aporta el consumidor vía
  `onConfirm`).
- Presentación/render del error (la decide el consumidor con `onError`, p. ej. el
  toast de la feature 11).
- Restauración de foco al disparador tras cerrar (la provee Base UI; sin test
  propio, R31).
- Variantes de tamaño/animaciones avanzadas más allá de las de Base UI.
- i18n global (etiquetas se pasan por props; textos por defecto en español).
