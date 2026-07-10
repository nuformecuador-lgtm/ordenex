# Implementación — Feature 23 · Dashboard del admin maestro (FRONTEND)

> Frontend puro. Consume el backend de la feature 22 (`lib/actions/aprobacion-postulaciones.ts`).
> NO se tocó backend, DB ni las actions de la 22. Decisiones F1.4 respetadas: A1 (enlaces "Ver",
> `target="_blank" rel="noopener noreferrer"`, sin miniaturas), A2 (refresco SWR regenera URLs
> firmadas; TTL del backend intacto), A3 (rechazo sin motivo, la action solo recibe `id`).

## Archivos tocados

### Producción (nuevos)
- `app/(app)/_components/postulacion-documento-labels.ts` — mapa `MensajeroDocumentoTipo → etiqueta`
  legible + orden de render fijo de los 5 documentos.
- `app/(app)/_components/decision-error-messages.ts` — mapa `ActionError.status → mensaje de usuario`
  (5 status), sin filtrar internals ni PII.
- `app/(app)/_components/PostulacionCard.tsx` — Client, presentacional: datos del mensajero (nulos como
  guion), 5 enlaces "Ver" (pestaña nueva, rel seguro), botones Aprobar/Rechazar. Sin fetch propio.
- `app/(app)/_components/PostulacionesPendientesPanel.tsx` — Client: SWR sobre
  `listarPostulacionesPendientes`; estados carga/error/vacío/lista + `Pagination`; confirmación con
  `Modal` async (spinner + anti doble-submit); `Toast` de feedback; `mutate()` refresca (fila desaparece).
- `app/(app)/_components/AdminMaestroDashboard.tsx` — Server Component: `PageHeader` + panel (patrón
  `AdminTiendaDashboard`).

### Producción (modificados)
- `app/(app)/page.tsx` — nueva rama `rol === "maestro" || rol === "admin" → <AdminMaestroDashboard />`,
  DESPUÉS de la rama `adminTienda` (intacta) y ANTES del placeholder "Bienvenido".

### Tests (nuevos)
- `tests/components/PostulacionCard.test.tsx`
- `tests/components/PostulacionesPendientesPanel.test.tsx`
- `tests/components/HomePageMaestro.test.tsx`

### Tests (modificados)
- `tests/components/HomePageRol.test.tsx` — el caso R3 (feature 26) listaba `maestro`/`admin` como
  roles que "conservan el placeholder Bienvenido". La feature 23 (R1) cambia ese comportamiento: ahora
  ven el dashboard maestro. Se acotó la lista a `mensajero`/`adminSatelite` (los que siguen viendo
  "Bienvenido"); maestro/admin quedan cubiertos por `HomePageMaestro.test.tsx`. La rama `adminTienda`
  (feature 26, R1/R2) queda INTACTA.

## Mapa R → test

| Req | Test |
| --- | --- |
| R1 | `HomePageMaestro.test.tsx` :: "rol maestro renderiza el dashboard maestro…" + "rol admin también…" |
| R2 | `HomePageMaestro.test.tsx` :: "rol adminTienda conserva el Panel de tienda (feature 26 intacta)" |
| R3 | `HomePageMaestro.test.tsx` :: "mensajero/adminSatelite/sin sesión conservan el placeholder Bienvenido" |
| R4 | `HomePageMaestro.test.tsx` :: "el rol se resuelve server-side vía resolveActorFromSession" |
| R5 | `HomePageMaestro.test.tsx` :: "…Panel maestro" (heading + panel único bloque) |
| R6 | `PostulacionesPendientesPanel.test.tsx` :: "al montar invoca listarPostulacionesPendientes y lista los items" |
| R7 | `PostulacionCard.test.tsx` :: "muestra nombre, apellidos, email…" + "campos nulos como guion" |
| R8 | `PostulacionCard.test.tsx` :: "un enlace 'Ver' por cada uno de los 5 documentos… target _blank, rel seguro, orden fijo" |
| R9 | `PostulacionesPendientesPanel.test.tsx` :: "pagina con Pagination usando page/pageSize/total del backend" |
| R10 | `PostulacionesPendientesPanel.test.tsx` :: "muestra estado de carga mientras resuelve" |
| R11 | `PostulacionesPendientesPanel.test.tsx` :: "muestra 'No hay postulaciones pendientes' con lista vacía" |
| R12 | `PostulacionesPendientesPanel.test.tsx` :: "muestra estado de error cuando la action devuelve ActionError" |
| R13 | `PostulacionCard.test.tsx` :: "renderiza botones Aprobar y Rechazar y los cablea con la postulación" |
| R14 | `PostulacionesPendientesPanel.test.tsx` :: "aprobar abre el modal…" |
| R15 | `PostulacionesPendientesPanel.test.tsx` :: "confirmar invoca aprobarPostulacion con el usuarioId" + "rechazar confirmado invoca rechazarPostulacion con el usuarioId" |
| R16 | `PostulacionesPendientesPanel.test.tsx` :: "mientras corre la action el confirmar se bloquea y muestra spinner" |
| R17 | `PostulacionesPendientesPanel.test.tsx` :: "…toast de éxito, refresco y la fila desaparece" |
| R18 | `PostulacionesPendientesPanel.test.tsx` :: "ActionError → toast de error mapeado y la fila permanece" |
| R19 | Estructural: los tests mockean las 3 actions de la 22; ningún componente importa services/repositories/prisma. |

## Verificación

- `npm run typecheck` → **VERDE** (0 errores).
- `npm run lint` → **VERDE** (0 errores; 135 warnings preexistentes, todos bajo `.claude/skills/**`,
  ajenos a esta feature. Lint sobre los 9 archivos tocados: exit 0, sin warnings).
- `npm test` → **1017/1018** en la corrida de suite completa. El único rojo por corrida es un flaky de
  **timeout bajo carga** en tests preexistentes ajenos (variando entre `tests/unit/guards/no-embalaje.test.ts`
  —walk del FS— y `tests/integration/recuperar-contrasena-form.test.tsx`). Ambos PASAN aislados
  (5/5 y 7/7 respectivamente). No relacionados con la feature 23.
- Tests nuevos de la feature (19 casos) → **VERDE** aislados y en conjunto (PostulacionCard 6 +
  PostulacionesPendientesPanel 9 aprox. + HomePageMaestro 5 = 19/19).
- `HomePageRol.test.tsx` (feature 26) tras el ajuste → **VERDE** (adminTienda intacto).

## Notas / bloqueos
- Sin bloqueos. Los 1-2 rojos por corrida completa son flaky de timeout ajenos (I/O bajo carga), no
  bloqueantes, verificados pasando en aislamiento.
- Entorno: el worktree f23 no traía `node_modules` ni `.env`; se corrió `npm install`, se copió el
  `.env` de `ordenex/`, y se borró el `package-lock.json` generado (el repo usa pnpm).
