# notificaciones — design.md

Diseño técnico del sistema de toast reutilizable (feature 11). Traza contra
`requirements.md`. Es UI pura de cliente: **no** introduce tablas, RLS,
migraciones, `app/api/`, Server Actions ni cambios de schema. No hay modelo de
datos ni endpoints para esta feature.

## Ubicación y stack

- `providers/ToastProvider.tsx` (`"use client"`) — envuelve `Toast.Provider` de
  Base UI + monta el portal/viewport y el render de cada toast. Carpeta
  `providers/` prevista en `docs/architecture.md`.
- `hooks/useToast.ts` (`"use client"`) — envuelve `useToastManager()` de Base UI y
  expone nuestra API de disparo estable (R1, R2). Junto a `hooks/usePagination.ts`.
- `components/shared/Toast.tsx` (`"use client"`) — componente presentacional de UN
  toast: compone `Toast.Root`/`Toast.Title`/`Toast.Description`/`Toast.Close` y
  aplica variante (icono + clases + `role`). UI pura, data-driven → `shared/`
  (misma regla que `Modal`/`DataTable`/`Pagination`, `docs/architecture.md`).
- `lib/utils/action-error-message.ts` — adaptador puro `messageFromActionError`
  (R21). Función sin side effects → `lib/utils/`.
- Tipos colocados junto al provider (`ToastVariant`, `ToastOptions`, `ToastApi`),
  exportados desde `providers/ToastProvider.tsx` (`docs/conventions.md`).

Estilos con Tailwind v4 + `cn` (`@/lib/utils`) + `cva`
(`class-variance-authority`, ya en el repo, como `alert.tsx`/`button.tsx`).
Iconos `lucide-react` por variante (p. ej. `CheckCircle2`, `XCircle`, `Info`,
`TriangleAlert`, `X` para cerrar), patrón de `Modal`/`BulkUpload`.

## Decisión clave: componer sobre `@base-ui/react/toast` (sin dependencia nueva)

**Decisión (humano 2026-07-10, [RESUELTO-C]):** construir el sistema
**componiendo sobre `@base-ui/react/toast`**, que YA está instalado
(`@base-ui/react@1.6.0`; verificado leyendo
`node_modules/@base-ui/react/toast/index.d.ts`). Es el mismo criterio que el
`Modal` (feature 13) siguió con `@base-ui/react/dialog`: reutilizar la primitiva
Base UI en vez de reinventar la mecánica accesible.

### API real de `@base-ui/react/toast` (verificada en `index.d.ts`)

Exportada como namespace `Toast` (`export * as Toast from "./index.parts"`):

| Símbolo | Uso |
| --- | --- |
| `Toast.Provider` (`ToastProvider`) | Context. Props: `timeout` (default 5000; `0` = sin auto-descarte), `limit` (default 3; el excedente se marca `data-limited`), `toastManager?`, `children`. |
| `Toast.Portal` | Monta el viewport fuera del flujo (R9). |
| `Toast.Viewport` | Contenedor `<div>` de los toasts (R9). |
| `Toast.Root` | Agrupa un toast; requiere prop `toast: ToastObject`. Extiende props de `<div>` (podemos pasar `role`, `data-*`). |
| `Toast.Title` / `Toast.Description` | Título/descripción del toast. |
| `Toast.Close` | Botón de cierre (`<button>`); le pasamos `aria-label` (R13). |
| `Toast.Action` | (No usado; fuera de alcance.) |
| `useToastManager()` | Hook: devuelve `{ toasts, add, close, update, promise }`. `add(options) => string` (id), `close(id?)`. |
| `createToastManager()` | Manager global fuera de React (no usado; ver alternativa). |

`ToastObject` (item) tiene: `id`, `title`, `description`, `type?: string`
(para estilar por variante), `timeout?` (default 5000; `0` = persistente),
`priority?: 'low' | 'high'` (`low`→anuncio polite, `high`→urgente), `onClose?`,
`onRemove?`. `ToastManagerAddOptions` = `ToastObject` sin `id`/`height`/etc., con
`id?` opcional.

### Qué cubre Base UI de forma NATIVA (simplifica tasks)

- **Auto-descarte** por `timeout` (R10) y **override por-toast** vía `timeout` en
  `add(...)` (R11); `timeout: 0` ⇒ persistente (R12). → No implementamos timers a
  mano.
- **Pausa/reanudación** del auto-descarte al hacer hover/focus dentro del viewport y
  al perder foco la ventana: comportamiento documentado de Base UI Toast (R15). →
  No implementamos la pausa a mano; el test verifica el requisito observable.
- **Apilado** de múltiples toasts en el viewport (R17) y **límite** vía `limit`: al
  superarlo, los más antiguos se marcan `data-limited` (dejan de mostrarse) en vez
  de eliminarse abruptamente (R18). → Mapeamos nuestro `max` a `limit`.
- **`id` único** generado por `add(...)` (R6). **`close(id)`** para cierre
  programático (R14). **`onClose`** por toast, invocado una vez al cerrarse (R16).

### Qué añadimos nosotros (la capa de producto)

- El **contrato `useToast()`** (R1, R5): `success/error/info/warning/show/dismiss`,
  con id estable, que envuelve `add`/`close`.
- El **mapeo variante → semántica**: `type` (para `data-variant`/icono/estilo) y
  `priority` (`error`/`warning` → `high`; `success`/`info` → `low`), más el `role`
  explícito en `Toast.Root` (`alert` para error/warning, `status` para
  success/info) para cumplir R7/R8 de forma testeable por rol.
- El **render presentacional** (icono por variante, clases Tailwind, botón de cierre
  con `aria-label`).
- El **adaptador** `messageFromActionError` (R21).

### Alternativa descartada 1: toast propio sobre Tailwind + Context

Implementar a mano el estado, los timers de auto-descarte, la pausa por hover/foco,
el apilado y el portal. **Descartada** ([RESUELTO-C]): reinventa justo lo que la
primitiva Base UI (ya instalada, ya usada por `Modal`) resuelve y prueba —
auto-descarte, pausa, límite, accesibilidad de la región live y gestión de ids—.
Sería más código y más superficie de bug (timers/limpieza) para un resultado
equivalente, contradiciendo "sin sobre-ingeniería" (`docs/architecture.md`).

### Alternativa descartada 2: `createToastManager()` (singleton global)

Base UI ofrece un manager global (`createToastManager()`) para disparar toasts
fuera de React (`import` de un singleton, estilo `sonner`). **Descartada** como API
primaria: el estado a nivel de módulo complica el aislamiento entre tests y se aleja
del patrón provider/hook del repo (`usePagination`, providers previstos). Nuestro
consumidor típico (p. ej. el `onError` del `Modal`) ya está dentro de un componente
cliente, así que `useToast()`/`useToastManager()` basta. Se podría exponer un
`toastManager` más adelante sin romper el contrato del hook (el `Toast.Provider`
acepta `toastManager?`).

### Alternativa descartada 3: instalar `sonner`

Dependencia nueva no presente en `package.json` para algo que Base UI (ya
instalado) cubre. Contradice "dependencia innecesaria" (`docs/architecture.md`).

## Contrato público (TypeScript)

Nuestro contrato se mantiene idéntico al de la versión previa (envuelve Base UI):

```ts
export type ToastVariant = "success" | "error" | "info" | "warning";

export interface ToastOptions {
  /** Texto visible del toast → Toast.Title (R4). */
  message: string;
  /** Variante; default "info" en show() si se omite (R7). */
  variant?: ToastVariant;
  /**
   * ms hasta el auto-descarte → `timeout` de Base UI (R10, R11).
   * `0` => persistente (R12). Default: timeout del provider.
   */
  duration?: number;
  /** Invocado una vez al retirarse → `onClose` de Base UI (R16). */
  onDismiss?: () => void;
}

export interface ToastApi {
  /** Genérico; llama add(...) y devuelve el id (R5, R6). */
  show: (options: ToastOptions) => string;
  success: (message: string, options?: Omit<ToastOptions, "message" | "variant">) => string;
  error:   (message: string, options?: Omit<ToastOptions, "message" | "variant">) => string;
  info:    (message: string, options?: Omit<ToastOptions, "message" | "variant">) => string;
  warning: (message: string, options?: Omit<ToastOptions, "message" | "variant">) => string;
  /** close(id) de Base UI; no-op si no existe (R14). */
  dismiss: (id: string) => void;
}

export interface ToastProviderProps {
  children: React.ReactNode;
  /** → `limit` de Base UI (R18). Default 4. */
  max?: number;
  /** → `timeout` de Base UI (R10). Default 5000. */
  defaultDuration?: number;
  /** Clases de posición del viewport. Default esquina superior derecha. */
  position?: "top-right" | "top-left" | "bottom-right" | "bottom-left";
}
```

`useToast()` devuelve `ToastApi`. Internamente llama `useToastManager()` y memoiza
(`useMemo`) el objeto API para cumplir R1 (identidad estable). `show(options)`:

```ts
const { add } = useToastManager();
const show = ({ message, variant = "info", duration, onDismiss }: ToastOptions) =>
  add({
    title: message,                       // R4 (Toast.Title)
    type: variant,                        // R7 (data-variant/icono/estilo)
    priority: variant === "error" || variant === "warning" ? "high" : "low", // R8 announce
    timeout: duration,                    // R11/R12 (undefined => usa el del provider)
    onClose: onDismiss,                   // R16
  });                                     // add() => id (R5, R6)
```

`success/error/info/warning` = `show` con `variant` fijado. `dismiss = close`.

## Estructura del provider y viewport

```tsx
// providers/ToastProvider.tsx
<Toast.Provider timeout={defaultDuration} limit={max}>
  {children}
  <Toast.Portal>                               {/* R9 */}
    <Toast.Viewport
      role="region" aria-label="Notificaciones"
      className={cn("fixed z-[100] ...posición...", positionClasses[position])}
    >
      <ToastList />                            {/* usa useToastManager().toasts */}
    </Toast.Viewport>
  </Toast.Portal>
</Toast.Provider>
```

`ToastList` (dentro del provider, para poder llamar `useToastManager()`):

```tsx
const { toasts } = useToastManager();
return toasts.map((t) => <Toast key={t.id} toast={t} />);
```

`components/shared/Toast.tsx` (presentacional):

```tsx
<Toast.Root
  toast={toast}
  data-variant={toast.type}                     // R7
  role={toast.type === "error" || toast.type === "warning" ? "alert" : "status"} // R8
  className={cn(toastVariants({ variant: toast.type }))}
>
  <Icon aria-hidden />                           {/* icono lucide por variante (R7) */}
  <Toast.Title>{toast.title}</Toast.Title>       {/* R4 */}
  {toast.description ? <Toast.Description>{toast.description}</Toast.Description> : null}
  <Toast.Close aria-label="Cerrar notificación" /> {/* R13 */}
</Toast.Root>
```

`toastVariants` = `cva(...)` con las 4 variantes (fondo/color/borde), estilo
`alert.tsx`. `Toast.Close` renderiza el `<button>` y su click dispara `close(id)`
internamente (R13).

| Requisito | Mecanismo |
| --- | --- |
| R4 texto | `Toast.Title` = `message` |
| R7 variante+icono | `type` → `data-variant` + icono `lucide` + `cva` |
| R8 role | `role="alert"` (error/warning) / `role="status"` (success/info) en `Toast.Root`; + `priority` de Base UI |
| R9 viewport | `Toast.Portal` + `Toast.Viewport` con `role="region"`/`aria-label`/`fixed` |
| R10–R12 auto-descarte | `timeout` del provider / por-toast; `0` persiste (nativo) |
| R13 cierre | `Toast.Close` + `aria-label` |
| R15 pausa | hover/focus del viewport (nativo Base UI) |
| R16 onDismiss | `onClose` del toast |
| R17/R18 apilado/límite | viewport apila; `limit` marca `data-limited` los más antiguos |

## Adaptador de errores del backend (R21)

`lib/utils/action-error-message.ts`, función **pura** (sin cambios respecto a la
decisión previa; [RESUELTO-B]):

```ts
import type { ActionError } from "@/lib/types/orden";
import { MSG, CODE_BY_DOMAIN_STATUS } from "@/lib/errors/codes";

export function messageFromActionError(err: ActionError): string {
  const code = CODE_BY_DOMAIN_STATUS[err.status]; // domain status -> AppErrorCode
  return MSG[code];                               // mensaje canónico en español
}
```

- Reutiliza las cadenas de `lib/errors` (no duplica textos) (R21). SOLO **importa**
  de `lib/errors/codes.ts`; **no** lo modifica (respeta el alcance).
- `validation_error` → `MSG.VALIDATION_ERROR` genérico ([RESUELTO-B]); los
  `fieldErrors` no se aplanan en el toast.
- Un `AppErrorShape` ya trae `message`: se pasa directo a `toast.error(err.message)`
  (usar `isAppErrorShape` de `lib/errors/shape.ts` si el consumidor recibe una
  unión). El adaptador cubre `ActionError` (que NO trae `message`).

## Integración con el layout (R20)

- **Decisión:** montar nuestro `<ToastProvider>` (que envuelve `Toast.Provider`) en
  **`app/(app)/layout.tsx`**, envolviendo el shell autenticado (`Sidebar` + `main`).
- **Justificación:** las superficies interactivas/de mutación (CRUD de órdenes,
  borrados con `Modal`, listados con SWR) viven bajo el grupo `(app)`; son los
  consumidores naturales. Montarlo aquí mantiene el `app/layout.tsx` raíz como
  Server Component sin frontera cliente añadida, y deja el provider disponible para
  todo el árbol autenticado (R20).
- **Nota (no bloqueante):** si el login u otra ruta fuera de `(app)` necesitara
  toasts, se promueve el provider al layout raíz sin cambiar el contrato de
  `useToast`. No se hace ahora (YAGNI).
- El cableado de superficies YA existentes queda **FUERA de alcance**
  ([RESUELTO-A]); el provider en el layout NO cambia el comportamiento observable de
  `/ordenes` mientras no se conecte un consumidor.

## Manejo de errores (convenciones)

- Sin `catch` vacíos: el sistema no envuelve promesas del consumidor.
- No se registra PII ni secretos: el toast solo renderiza el `message` que le pasa
  el consumidor; el sistema no inspecciona ni loguea su contenido.
- TypeScript `strict`, sin `any` no justificado. Nota: `useToastManager<Data>()` es
  genérico con `Data extends object = any`; al no usar `data` custom, se instancia
  con el default sin introducir `any` propio.

## Fuera de alcance

- Cableado de `/ordenes`/`Modal` para emitir toasts ([RESUELTO-A], follow-up).
- `Toast.Action` (botón de acción/undo), `promise()` (`toast.promise`), swipe para
  descartar, animaciones custom de entrada/salida — no requeridos (baja complejidad).
- Persistencia/historial de notificaciones.
- i18n global: los mensajes se pasan por prop; el adaptador reutiliza `MSG` (es).
