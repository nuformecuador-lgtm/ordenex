# review_65-lestura-de-qr.md

Revisión cruzada de la implementación de la feature 65 (lectura QR) contra
`specs/65-lestura-de-qr/`, `docs/` y `CHECKPOINTS.md`.

---

## Hallazgos

### Bloqueantes

Ninguno.

### Menores

| # | Archivo | Hallazgo | Justificación |
|---|---------|----------|---------------|
| M1 | `app/(app)/qr/page.tsx:18-48` | Stale closure en `procesar` via `useCallback` con `procesando` en deps. El scanner callback (`onDecoded`) captura una referencia obsoleta de `procesar`, y el cambio de `procesando` re-ejecuta el `useEffect` innecesariamente. | **Mitigación:** patrón idéntico al de `EscanerRecepcion.tsx:89-101,132-136` (referencia aprobada). `camaraAbierta` se desactiva antes de `setProcesando(true)`, por lo que el cleanup del effect detiene el scanner y el effect body sale por `!camaraAbierta`. No hay riesgo real de doble escaneo. |
| M2 | `app/(app)/qr/page.tsx` | No existe el estado `error` (string \| null) que menciona T2 de `tasks.md`. | **Mitigación:** la implementación usa `toast.error()` para todos los errores (R8, R9), que es la vía correcta según `design.md` (§ Contratos I/O). El estado `error` en tasks.md es un remanente de guía; el código real es superior. |

### OK

| Aspecto | Verificación |
|---------|-------------|
| R1 — QR en sidebar con `ROLES_SEED` | `menu-visibility.ts:97-102` — ítem con `iconKey: "qrCode"`, `roles: ROLES_SEED`. `ROLES_SEED = Object.values(RolValue)` cubre todos los roles. |
| R2 — Icono QrCode + href `/qr` | `Sidebar.tsx:11` importa `QrCode` de lucide; `Sidebar.tsx:139` mapea `qrCode: QrCode`. |
| R3 — No mostrar sin sesión | `middleware.ts:8-13` — `/qr` no está en `PUBLIC_ROUTES`; sin cookie de sesión redirige a `/login`. |
| R4 — Página existe | `app/(app)/qr/page.tsx` — Client Component con `"use client"`. |
| R5 — Sesión inválida → `/login` | `middleware.ts:11-15` — protege todas las rutas no públicas. |
| R6 — Cámara no se activa sola | `camaraAbierta` inicial `false` en línea 13; botón "Escanear con cámara" activa toggle. |
| R7 — QR decodificado → redirigir | `procesar()` línea 34: `router.push(destino)` con `pathname + search + hash`. |
| R8 — QR inválido → toast error | Líneas 29-31 (origen distinto) y 38-41 (no-URL sin `/`). |
| R9 — Cámara denegada → toast error | Líneas 74-77 en el catch del useEffect. |
| R10 — Visor + "Cerrar cámara" | Líneas 104-111 (botón), 113-119 (visor condicional con `role="region"`). |
| R11 — Procesando: feedback + bloqueo | Línea 107: `disabled={procesando}`; líneas 122-126: texto "Procesando código QR…". |
| R12 — Cerrar cámara antes de redirigir | Línea 34: `setCamaraAbierta(false)` antes de `router.push(destino)`. |
| R13 — Responsive | `max-w-sm` en visor, `flex flex-1 flex-col items-center justify-center gap-4 px-4 py-8` en contenedor. |
| R14 — Accesibilidad | Botón es `<button>` (shadcn/ui). Visor con `role="region"` y `aria-label="Visor de cámara QR"`. |
| R15 — typecheck | 0 errores nuevos; 2 pre-existentes (TarifaVigentePorZonaRepository, seed-zonas). |
| R16 — build | Compila sin errores; fail de typecheck pre-existente. |
| R17 — tests sin regresiones | Sidebar: 13/13 tests pasan. Suite completa: 0 fallos nuevos. |
| Sin backend tocado | 3 archivos: 1 creado, 2 modificados. Sin Server Actions, API routes ni migraciones. |
| Patrón EscanerRecepcion | Mismo patrón: import dinámico, `useEffect` con `let cancelado` + `instancia`, `facingMode: "environment"`, `fps: 10, qrbox: 250`, cleanup con `stop()` + `clear()`. |
| Sin console.log | 0 hallazgos en los 3 archivos. |
| shadcn/ui components | `Button` de `@/components/ui/button`, `PageHeader` de `@/components/shared/PageHeader`. |
| useToast | `toast.error()` usado para errores de cámara y validación de ruta. |

---

## Veredicto

**APROBADO — 0 bloqueantes, 2 menores (M1 y M2, ambos mitigados/justificados).**

La implementación cubre R1–R17, no introduce regresiones, sigue fielmente el
patrón establecido de `EscanerRecepcion.tsx` y no toca backend. Los 2 hallazgos
menores son consistentes con el código existente y no impactan la corrección.
