# Feature 23 — Dashboard del admin maestro · design.md

## 1. Alcance y principios

Frontend puro. No hay migraciones, tablas, RLS, endpoints ni Server Actions
nuevas: esta feature **solo consume** el backend de la feature 22
(`lib/actions/aprobacion-postulaciones.ts`). Todo el trabajo vive en `app/(app)/`
y (si aplica) `components/`.

Se respetan los patrones del repo:
- Ramificación de rol **server-side** en `page.tsx` (`resolveActorFromSession`),
  como ya hace la feature 26.
- Mutaciones internas vía **Server Actions** (no `fetch` a rutas API).
- Data fetching cliente con **SWR** (patrón `OrdenesModule`), para poder
  revalidar tras aprobar/rechazar.
- Reutilización de `PageHeader`, `Pagination`, `Modal` (async), `useToast`.
- Identidad de marca del rebrand (naranja/navy/Poppins) heredada de los
  componentes compartidos; no se introduce estilo ad-hoc de color.

## 2. Estructura de archivos (nuevos, de producción — los crea el implementer)

```
app/(app)/page.tsx                                   ← MODIFICAR: añadir rama maestro/admin
app/(app)/_components/AdminMaestroDashboard.tsx      ← NUEVO (Server Component)
app/(app)/_components/PostulacionesPendientesPanel.tsx ← NUEVO (Client Component, SWR)
app/(app)/_components/PostulacionCard.tsx            ← NUEVO (Client, presentacional)
app/(app)/_components/postulacion-documento-labels.ts ← NUEVO (mapa tipo→etiqueta)
app/(app)/_components/decision-error-messages.ts     ← NUEVO (mapa ActionError.status→texto)
```

`AdminMaestroDashboard` sigue el precedente exacto de `AdminTiendaDashboard`
(feature 26): Server Component que solo compone `PageHeader` + el módulo cliente.
Ningún componente hace fetch de datos sensibles por props del servidor; el panel
cliente consume las actions (que ya autorizan por rol en el backend, feature 22).

## 3. Ramificación de la home (R1–R4)

`page.tsx` amplía la ramificación existente sin romper la de la feature 26:

```
const actor = await resolveActorFromSession();
if (actor?.rol === "adminTienda")            return <AdminTiendaDashboard />;   // R2 (feature 26)
if (actor?.rol === "maestro" || actor?.rol === "admin")
                                             return <AdminMaestroDashboard />;  // R1
// resto (mensajero, adminSatelite, sin sesión) → placeholder "Bienvenido"      // R3
```

- El orden mantiene intacta la rama `adminTienda` previa (R2).
- El rol se resuelve solo en el servidor; el cliente nunca decide la rama (R4).
- La rama placeholder conserva el chequeo de sesión y el `LogoutButton` actuales
  (R3), sin cambios de comportamiento.

## 4. Panel de postulaciones (R5–R12)

`AdminMaestroDashboard` (Server Component):

```
<section>
  <PageHeader title="Panel maestro" description="Postulaciones de mensajeros pendientes" />
  <PostulacionesPendientesPanel />
</section>
```

`PostulacionesPendientesPanel` (Client Component):
- Estado local: `page`, `pageSize` (default = `PAGE_SIZE_DEFAULT` del backend, 20).
- `useSWR(["postulaciones:pendientes", page, pageSize], fetcher)` donde el fetcher
  llama `listarPostulacionesPendientes({ page, pageSize })`. Si `status !== "ok"`
  lanza para que SWR exponga `error` (R12), replicando el patrón de `OrdenesModule`.
- Render por estado:
  - `isLoading` → bloque de carga (R10).
  - `error` → mensaje "No se pudieron cargar las postulaciones" (R12).
  - `items.length === 0` → "No hay postulaciones pendientes" (R11).
  - En otro caso → lista de `PostulacionCard` + `<Pagination>` con `page`,
    `pageSize`, `total` del backend (R9).
- Expone `mutate` de SWR al flujo de aprobar/rechazar para refrescar (R17).

`PostulacionCard` (Client, presentacional):
- Muestra los datos del mensajero (R7): nombre + apellidos, email, teléfono,
  `tipoIdentificacion` + `cedula`, `vehiculo`, `placa`. Campos `null` → guion.
- Muestra los 5 documentos (R8): por cada `documentos[]`, un enlace
  `<a href={url} target="_blank" rel="noopener noreferrer">` con etiqueta legible
  vía `postulacion-documento-labels.ts` (p. ej. `cedula_anverso` → "Cédula
  (anverso)"). El orden de render es fijo por tipo para estabilidad del test.
- Botones "Aprobar" y "Rechazar" (R13) que emiten al panel la intención + el
  `usuarioId`.

### Decisión firme: tarjetas, no DataTable

El listado usa **tarjetas** (`PostulacionCard`), no `DataTable`. Cada postulación
tiene ~8 campos de datos + 5 enlaces de documento + 2 acciones; en una fila de
tabla esto produce una tabla excesivamente ancha e ilegible. Las tarjetas agrupan
todo por postulación de forma vertical y accesible. Se **reutiliza** `Pagination`
(no se reinventa la paginación).

### Alternativa descartada: `DataTable` + `Pagination` (como `OrdenesModule`)

Se consideró replicar el patrón `DataTable` de las features 7/8/26. **Descartada**
porque el número de columnas (8 datos + 5 documentos + acciones = 15 celdas por
fila) hace la tabla inmanejable en anchos normales, obliga a scroll horizontal y
degrada el acceso a los documentos (que son enlaces, no texto). Las tarjetas dan
mejor lectura por postulación con el mismo componente de paginación reutilizado.
(Alternativa secundaria también descartada: miniaturas/visor inline de documentos
— ver pregunta abierta A1; añade complejidad sin requisito confirmado.)

## 5. Aprobar / rechazar con confirmación (R13–R18)

El panel mantiene estado de "acción en curso":
`{ usuarioId, tipo: "aprobar" | "rechazar", nombre } | null`.

Flujo:
1. Click en "Aprobar"/"Rechazar" (R13) → setea el estado y abre el `Modal` (R14).
2. `Modal` async (feature 13): `onConfirm` devuelve la promesa de la Server Action
   correspondiente (R15). Mientras corre, el Modal muestra spinner y bloquea el
   confirmar (R16) — comportamiento nativo del `Modal` (`phase="pending"`,
   `pendingRef` anti doble-submit).
3. `onConfirm` interpreta el resultado:
   - `status === "ok"` → `useToast().success(...)`, cierra el modal (default
     `closeOnConfirm`), y llama `mutate()` de SWR para refrescar el listado; la
     fila desaparece (R17).
   - `ActionError` → lanza dentro de `onConfirm` para que el Modal invoque
     `onError`; el panel muestra `useToast().error(mapMessage(status))` y el modal
     permanece abierto/re-habilitado (R18). Alternativamente se muestra el toast
     directamente y se devuelve sin cerrar; se elige lanzar para reusar el canal
     `onError` del Modal.
4. `confirmVariant="destructive"` para "Rechazar"; `"default"` para "Aprobar".

`decision-error-messages.ts` mapea `ActionError.status` a texto de usuario:
- `forbidden` → "No tienes permiso para esta acción."
- `unauthenticated` → "Tu sesión expiró. Inicia sesión de nuevo."
- `not_found` → "La postulación ya no existe."
- `conflict` → "La postulación ya fue procesada."
- `validation_error` → "No se pudo procesar la solicitud."

## 6. Contratos I/O (solo consumo, sin cambios)

| Interacción | Entrada | Salida |
| --- | --- | --- |
| Listar | `{ page, pageSize }` | `ListarPostulacionesResult` |
| Aprobar | `usuarioId: string` | `DecisionResult` |
| Rechazar | `usuarioId: string` | `DecisionResult` |

Tipos importados de `@/lib/types/aprobacion-postulacion`. No se redefine ninguno.

## 7. Accesibilidad e identidad

- Botones y enlaces con nombres accesibles; enlaces de documento con `rel`
  seguro. `Pagination` y `Modal` ya aportan roles/labels accesibles.
- Colores y tipografía provienen de `PageHeader`, `Button` (ui/) y tokens del
  rebrand; no se hardcodean colores.

## 8. Trazabilidad R → test (component tests, mock de Server Actions)

Se sigue el patrón de `tests/components/HomePageRol.test.tsx` (feature 26) y
`tests/unit/components/usuarios-module.test.tsx` (mock de actions + SWRConfig +
ToastProvider + userEvent).

| Req | Test (archivo :: caso) |
| --- | --- |
| R1 | `HomePageMaestro.test.tsx` :: "rol maestro renderiza el dashboard maestro con el panel" (y caso `admin`) |
| R2 | `HomePageMaestro.test.tsx` :: "rol adminTienda conserva el Panel de tienda (feature 26 intacta)" |
| R3 | `HomePageMaestro.test.tsx` :: "mensajero/adminSatelite conservan el placeholder Bienvenido" |
| R4 | `HomePageMaestro.test.tsx` :: "el rol se resuelve server-side vía resolveActorFromSession" |
| R5 | `PostulacionesPendientesPanel.test.tsx` :: "el dashboard muestra el PageHeader y el panel como único bloque" |
| R6 | `PostulacionesPendientesPanel.test.tsx` :: "al montar invoca listarPostulacionesPendientes y lista los items" |
| R7 | `PostulacionCard.test.tsx` :: "muestra nombre, apellidos, email, teléfono, tipo/nº doc, vehículo y placa (nulos como guion)" |
| R8 | `PostulacionCard.test.tsx` :: "muestra un enlace Ver por cada uno de los 5 documentos con etiqueta y href firmado, target _blank" |
| R9 | `PostulacionesPendientesPanel.test.tsx` :: "pagina con Pagination usando page/pageSize/total del backend" |
| R10 | `PostulacionesPendientesPanel.test.tsx` :: "muestra estado de carga mientras resuelve" |
| R11 | `PostulacionesPendientesPanel.test.tsx` :: "muestra 'No hay postulaciones pendientes' con lista vacía" |
| R12 | `PostulacionesPendientesPanel.test.tsx` :: "muestra estado de error cuando la action devuelve ActionError" |
| R13 | `PostulacionCard.test.tsx` :: "renderiza botones Aprobar y Rechazar por postulación" |
| R14 | `PostulacionesPendientesPanel.test.tsx` :: "Aprobar/Rechazar abre el Modal de confirmación" |
| R15 | `PostulacionesPendientesPanel.test.tsx` :: "confirmar invoca aprobar/rechazarPostulacion con el usuarioId" |
| R16 | `PostulacionesPendientesPanel.test.tsx` :: "mientras corre la action el confirmar se bloquea y muestra spinner" |
| R17 | `PostulacionesPendientesPanel.test.tsx` :: "ok → toast de éxito, cierra modal, refresca y la fila desaparece" |
| R18 | `PostulacionesPendientesPanel.test.tsx` :: "ActionError → toast de error mapeado y la fila permanece" |
| R19 | Cubierto estructuralmente: los tests mockean las actions de la 22; ningún componente importa services/repositories/prisma (aserción de no-import / revisión) |

## 9. Riesgos

- A2 (caducidad de URLs firmadas) puede degradar UX si el TTL es corto; ver
  pregunta abierta. No bloquea la implementación del panel.
- La ramificación de `page.tsx` debe preservar los tests existentes de la feature
  26 (`HomePageRol.test.tsx`); se corre la suite completa como verificación.
