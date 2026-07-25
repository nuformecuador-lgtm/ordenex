# Feature 113 — mensajero: card en reparto con detalle completo + modo foco al gestionar

> Zona: frontend · Complexity: medium · Rama: `feature/113-card-detalle-modo-foco` · depends_on: 36 (done)
> Portal del mensajero (`app/(app)/mis-asignaciones`). Cambio de PRESENTACIÓN sobre
> el módulo existente. NO toca backend, contratos ni el bloqueo 1-a-1.

## Contexto (código real)

- Módulo: `app/(app)/mis-asignaciones/_components/MisAsignacionesModule.tsx`.
  - Hoy la grilla "En reparto" pinta cards COMPACTAS (destinatario/producto/teléfono),
    no el detalle completo — `MisAsignacionesModule.tsx:367-377`.
  - Hoy, MIENTRAS hay una gestión activa sobre OTRA orden, la card queda `bloqueada`
    y OCULTA sus detalles mostrando el aviso "Termina la gestión en curso…" —
    `MisAsignacionesModule.tsx:300-304`, `:358-382`.
  - El panel grande inline (`GestionarOrdenPanel`) se renderiza SIEMPRE que haya una
    orden en detalle y el mensajero no esté bloqueado — `MisAsignacionesModule.tsx:395-404`.
  - `ordenEnGestionId` llega por props desde el Server Component (backend, robusto a
    recarga) — `MisAsignacionesModule.tsx:47`, `page.tsx:43`.
- Detalle reutilizable (Pedido/Entrega/Cobro): `AsignacionDetalle`
  (`_components/AsignacionDetalle.tsx:65-101`). Ya lo reusa `GestionarOrdenPanel.tsx:321`.
- Bloqueo 1-a-1 backend (sin cambios): `escogerParaGestion` / `liberarGestion` /
  puntero `ordenEnGestionId` — `IMisAsignacionesService.ts:97,133-136,178-190`.
- R19/R20 del spec 36 (bloqueo 1-a-1) — `specs/36-mensajero-mis-asignaciones/requirements.md:165-171`.

Este cambio: (1) cada card en 'En reparto' muestra el detalle completo inline y se
ELIMINA el estado "card bloqueada que oculta el detalle"; (2) con `ordenEnGestionId`
fijado la vista entra en "modo foco" y colapsa a solo esa orden.

## Requisitos (EARS)

### Grupo A — Detalle completo inline en 'En reparto'

- **R1** — MIENTRAS el portal muestre al menos una orden en 'En reparto' y NO esté
  activo el modo foco (ver R5), el sistema DEBE renderizar, dentro de CADA card de esa
  sección, el detalle completo de su orden (secciones **Pedido**, **Entrega** y
  **Cobro**) reutilizando el componente `AsignacionDetalle`.

- **R2** — El sistema NO DEBE renderizar el estado de card compacta con el mensaje
  "Termina la gestión en curso para gestionar esta orden" (se elimina el ocultamiento
  de detalle por gestión activa introducido en el spec 36). Ese texto no debe existir
  en ningún estado de la vista.

- **R3** — MIENTRAS el mensajero esté BLOQUEADO (feature 111) y NO esté activo el modo
  foco, el sistema DEBE seguir mostrando el detalle completo de cada card (R1) aunque
  la card quede deshabilitada (la deshabilitación restringe la acción, no la visibilidad).

### Grupo B — Quitar el ocultamiento NO relaja las restricciones de acción (R19/R20)

- **R4** — SI existe una gestión activa (`ordenEnGestionId` ≠ `null`) sobre una orden,
  ENTONCES el sistema NO DEBE ofrecer iniciar la gestión de ninguna otra orden distinta
  desde el portal (la única orden gestionable sigue siendo la activa; el bloqueo 1-a-1
  se mantiene como restricción de ACCIÓN, no de visibilidad).

- **R5-pre / R4b** — El sistema DEBE conservar SIN CAMBIOS el contrato de backend del
  bloqueo 1-a-1: esta feature NO modifica las llamadas ni los payloads de
  `escogerParaGestion`, `liberarGestion` ni el significado del puntero `ordenEnGestionId`.
  (Verificable: los mocks de esas Server Actions se invocan con los mismos argumentos
  que hoy y no aparecen llamadas nuevas.)

### Grupo C — Modo foco

- **R5** — CUANDO `ordenEnGestionId` está fijado (≠ `null`) y el mensajero NO está
  bloqueado, el sistema DEBE entrar en "modo foco" y colapsar la vista para mostrar
  ÚNICAMENTE la orden activa (su detalle + controles de gestión), reutilizando
  `GestionarOrdenPanel`.

- **R6** — MIENTRAS el modo foco esté activo, el sistema DEBE OCULTAR las cards de las
  demás órdenes en 'En reparto' (la grilla de cards no se muestra).

- **R7** — MIENTRAS el modo foco esté activo, el sistema DEBE OCULTAR el mapa de ruta
  y sus elementos asociados de ruta (aviso de "orden no actualizado" y botón de
  sincronizar ruta).

- **R8** — MIENTRAS el modo foco esté activo, el sistema DEBE OCULTAR la sección
  "Por recoger" completa (input de guía, escáner y la lista de solo-visualización).

- **R9** — MIENTRAS el modo foco esté activo, el sistema DEBE mostrar los controles de
  gestión (`GestionarOrdenPanel`) de la orden activa, arrancando en el paso propio de
  una gestión ya activa (`yaActiva = true`, es decir los 4 botones de resultado), de
  modo que el flujo de gestión y su "Cancelar gestión" queden disponibles.

- **R10** — CUANDO `ordenEnGestionId` vuelve a `null` (gestión finalizada con éxito,
  "Cancelar gestión" o liberación del puntero), el sistema DEBE SALIR del modo foco y
  RESTAURAR la vista completa: grilla de cards con detalle inline (R1), mapa de ruta y
  sección "Por recoger".

### Grupo D — Estados límite

- **R11** — SI no hay órdenes en 'En reparto', ENTONCES el sistema DEBE mostrar el
  aviso de vacío ("No hay órdenes en reparto.") y NO DEBE entrar en modo foco.

- **R12** — MIENTRAS el mensajero esté BLOQUEADO (feature 111), el sistema NO DEBE
  entrar en modo foco: DEBE conservar el comportamiento actual (aviso de bloqueo total,
  cards deshabilitadas con detalle visible por R3, y sin renderizar el panel de gestión).

## Fuera de alcance

- No se toca el backend, ni el service/repository, ni el contrato `MiAsignacionDTO`.
- No se toca `page.tsx`; los KPIs (`KpisMensajero`, renderizados fuera del módulo)
  permanecen visibles incluso en modo foco (no forman parte de "cards/mapa/listas").
- No cambia el flujo interno de `GestionarOrdenPanel` (pasos, validación, envío).

## Trazabilidad (cada R → test)

Tests en `tests/components/MisAsignacionesModule.test.tsx` (jsdom, mocks de actions/router/toast).

| Req | Test (comportamiento) |
| --- | --- |
| R1 | Con 2 órdenes en reparto y `ordenEnGestionId=null`: CADA card contiene las secciones Pedido/Entrega/Cobro (p. ej. "Valor a cobrar", "Dirección") de su orden. |
| R2 | En ningún estado (con o sin gestión activa) aparece el texto "Termina la gestión en curso". |
| R3 | `bloqueado=true`, sin gestión activa: las cards están deshabilitadas y AÚN muestran el detalle completo de su orden. |
| R4 | `ordenEnGestionId="g2"`: no existe control para escoger/gestionar otra orden (las demás cards no están en el DOM) y `escogerParaGestion` no se llama para otra orden. |
| R4b | El test de flujo "verificar guía → gestionar" sigue llamando `escogerParaGestion({ ordenId })` con el mismo payload; no hay llamadas nuevas a actions. |
| R5 | `ordenEnGestionId="g2"`: el panel de gestión muestra "Orden REM-G2 · Activa Dos" (la orden activa). |
| R6 | `ordenEnGestionId="g2"` con g1 y g2: la card/detalle de g1 NO está en el DOM. |
| R7 | En foco: no se renderiza `RutaMapa` (testid), ni "Mapa de ruta", ni el botón "Sincronizar ruta". |
| R8 | En foco: no está la región "Por recoger" ni sus controles (input/escáner). |
| R9 | En foco (`yaActiva`): se ven los 4 botones de resultado y "Cancelar gestión". |
| R10 | Re-render con `ordenEnGestionId=null`: vuelven la grilla con detalle inline, el mapa y "Por recoger". |
| R11 | `porGestionar=[]`: aparece "No hay órdenes en reparto." y no hay panel/foco. |
| R12 | `bloqueado=true` + `ordenEnGestionId="g2"`: NO colapsa a foco (sigue el aviso de bloqueo total; sin panel de gestión). |

## Preguntas abiertas

1. **Salida de foco sin liberar el puntero.** En modo foco la única forma de volver a
   la lista es "Cancelar gestión" (libera `ordenEnGestionId`) o finalizar la gestión.
   ¿Se requiere además una salida "volver a la lista" que CONSERVE la gestión activa
   (sin liberar el puntero)? Por defecto, esta spec NO la incluye (foco = vista sin
   distracciones; el backend ya mantiene el puntero robusto a recarga).

2. **Encabezado en foco.** ¿Se conserva algún encabezado/breadcrumb ("Gestionando
   orden X") por encima del panel en foco, o el `GestionarOrdenPanel` (que ya muestra
   "Detalle de la orden · REM-X") es suficiente? Por defecto, se considera suficiente
   el propio panel; no se añade encabezado extra.
