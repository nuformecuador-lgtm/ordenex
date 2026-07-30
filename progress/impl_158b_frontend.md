# Feature 158 — Implementación frontend, camino del ADMIN (Fase 2B, T2.7–T2.10)

> Rama `feature/158b-incidente-admin`, apilada sobre `feature/158-incidente-indemnizacion`
> (**PR #208**). Worktree `.claude/worktrees/lote-135`.
> Alcance: **T2.7 a T2.10** — superficie visible del camino del **ADMIN**, dentro del **PR 2 de 2**
> (Q-L, T0.8).
> Fase anterior: **`progress/impl_158b_backend.md`** (T1.19–T1.32).
> Referencia de forma: `progress/impl_158_frontend.md` (frontend del camino del mensajero, PR 1).
> **NO se tocó** backend (`lib/services/`, `lib/repositories/`, `lib/actions/`, `db/`) ni nada del
> camino del mensajero (R1–R36).

## Veredicto

**Fase 2B completa y verde.** `./init.sh` OK: **629 archivos / 7329 tests / 0 fallos**, lint
**0 errores / 19 warnings** (los mismos 19 del baseline). Delta sobre F1B (624 / 7228):
**+5 archivos de test, +101 tests, 0 warnings nuevos.**

**R49 y R51 quedan CERRADOS en sus dos mitades.** F1B las dejó cubiertas sólo en el servidor y lo
declaró; aquí entra la mitad visible, y R51 con su **caso de CONTROL** para que el bloqueo no pase
por la razón equivocada.

**25 mutaciones, 23 discriminan.** Las **2 que no** están escritas con su razón en §3: una obligó a
reforzar el caso del dinero (commit propio, como hizo F1B con sus mutaciones D/E) y la otra dejó al
descubierto una guardia genuinamente redundante que se **declara** en vez de inventarle un test de
forma.

**Un hueco real, dicho en voz alta:** el `adminSatelite` está autorizado por el service (R48) pero
**no tiene ninguna superficie desde la que reportar** — `/ordenes` le hace `notFound`. Detalle y
opciones en §5.

---

## 1. Qué se hizo, por task

### T2.7 — Modal de reporte por orden (Q-H) ✅

**Creados:** `app/(app)/ordenes/_components/ReportarIncidenteModal.tsx`,
`.../ReportarIncidenteAccion.tsx`, `.../incidente-origenes.ts`.

- **Es un modal POR ORDEN, no de lote.** Recibe `orden` (singular) y no `ordenes`, que es la
  diferencia estructural con sus dos hermanos del mismo directorio: `RecuperarABodegaModal` (100) y
  `DeshacerAsignacionModal` (149) trabajan sobre el LOTE seleccionado. Un incidente pide causa,
  motivo y fotos **de cada paquete**, así que la firma tenía que impedirlo, no un comentario.
- **Disparador por FILA**, no en la barra de selección: `ReportarIncidenteAccion` sigue el patrón
  autocontenido de `EtiquetaOrdenAccion` (32) y `HistorialOrdenSheet` (49) —estado `open` propio +
  disparador + modal— y **no renderiza nada** cuando el estado de la orden no admite el reporte.
  Un botón deshabilitado habría sido peor: el actor no puede hacer nada al respecto.
- **Los cinco estados se DERIVAN, no se teclean** (`incidente-origenes.ts`). El service exporta
  `ORIGENES_INCIDENTE_ADMIN`, pero `lib/services/IncidenteAdminService.ts` importa
  `@prisma/client`: un componente cliente no puede importarlo sin arrastrar Prisma al bundle. En vez
  de copiar los cinco values a una lista paralela —que se desincroniza en silencio— se leen del
  **mapa de la 140**: las salidas de `incidente` de familia `incidente` son las cinco reversiones
  #54-#58, y por diseño el conjunto de destinos de la reversión **es** el de orígenes del reporte
  (el propio service usa la misma constante para las dos direcciones). La sexta salida (#53,
  `incidente → en_reparto`) queda fuera por su familia `deshacer_gestion`: es el deshacer del
  MENSAJERO. Un test lo fija **por igualdad** contra la constante del servidor.
- **Q-B en el sitio donde duele.** La foto se exige en las tres causas, y la ayuda dice **qué
  fotografiar en bodega cuando no hay paquete**: la ubicación o el estante vacío, la guía o la
  etiqueta, el acta de recepción o el manifiesto, o la denuncia. Es una lista **distinta** de la del
  panel del mensajero (T2.1), y a propósito: el mensajero está en la calle con un vehículo, el admin
  está en una bodega con un manifiesto.
- **La consecuencia se dice ANTES de confirmar**, no después: la orden sale del flujo y otro
  administrador decide. Es R51 hecho visible desde el propio reporte.
- Valida en cliente con **`reportarIncidenteSchema`**, el mismo módulo que el servidor revalida: el
  cliente no tiene reglas propias que puedan divergir.
- **Cableado:** `OrdenesModule` gana la prop opt-in `puedeReportarIncidente` (por defecto `false`,
  así ninguna superficie previa cambia) y la columna de acciones pasa a montarse si la enciende
  **cualquiera** de sus dos fuentes (historial/etiqueta o incidente), cada pieza por separado.
  `OrdenesListado` la pasa; `app/(app)/ordenes/page.tsx` la enciende para acceso total. **NO va por
  `accionesLote`** aunque hoy coincida el predicado, y está escrito por qué.
- **`ordenes-columns.tsx` NO se tocó.** Es el imán de drift que ya revirtieron dos veces; la acción
  de fila vive donde ya viven las otras dos (la columna `acciones` de `OrdenesModule`).

### T2.8 — Cola de aprobación en página propia (Q-I) ✅

**Creados:** `app/(app)/incidentes/page.tsx`,
`app/(app)/incidentes/_components/IncidentesAdminModule.tsx`.
**Modificados:** `lib/auth/menu-visibility.ts`, `app/(app)/_components/Sidebar.tsx`.

- **Espejo de `CierresAdminModule` (38)**: dos `DataTable` («Pendientes de decisión» con su
  recuento + «Histórico» de solo lectura), detalle en modal y sub-modales de decisión. La página
  resuelve el rol **server-side** y baja los datos por props; el módulo cliente **no fetchea la
  lista** (`docs/architecture.md`).
- **El detalle SÍ se pide al servidor al abrirlo**, aunque la fila ya traiga el DTO completo. Dos
  razones concretas: las URLs de evidencia son **firmadas y con vigencia acotada** (R46) —las de la
  carga de la página caducan si la pestaña queda abierta— y el estado puede haber cambiado (otro
  admin ya lo resolvió). Es además el camino que ya usa `CierresAdminModule.abrirDetalle`.
- **Sub-modal de aprobación**: `Input` de monto con el **mismo criterio que el servidor**
  (`montoValido` + `INDEMNIZACION_MONTO_MAX` **importado**, no reescrito), confirmar deshabilitado
  mientras no valide, y mensajes **distintos por causa** (tope vs. formato) — la lección de m5 del
  PR 1, aplicada de entrada en vez de descubierta en review. El monto viaja **STRING tal cual**.
- **Sub-modal de rechazo**: motivo obligatorio, calcado del de `CierresAdminModule:471-513`.
- **Menú:** entrada «Incidentes» → `/incidentes` con **icono propio** (`shieldAlert`) y no otro
  `clipboardCheck`: compartir el icono con «Cierres del día» invitaría a leerlo como una sección
  suya, que es justo lo que la decisión del humano descartó. Los roles son **exactamente** los que
  autoriza `IncidenteAdminService.resolveAlcance`, con un test que lo dice.
- **Lo que NO se reusó de los cierres, y por qué:** `EstadoHistoricoRotulo`. Su marcador «bloqueante
  hasta re-solicitud» (109/R31) es del cierre del mensajero; un incidente rechazado **devuelve la
  orden a su origen y no bloquea a nadie**. Copiarlo habría mentido sobre estado y sobre dinero.
  Hay un caso que lo fija. Sí se reusan `money` y `EstadoCierreBadge`, que son genéricos.
- El `—` del monto pendiente lleva su **nota**: un guion pelado se leería como «esta orden no se
  indemniza», que es lo contrario de «todavía no se decidió». Mismo patrón que T2.3.

### T2.9 — R51 en la interfaz ✅

`tests/components/IncidentesAdminR51.test.tsx` (11 casos) + la sección de decisión del módulo.

- En un incidente **propio**, «Aprobar» y «Rechazar» van **deshabilitados** y el motivo se **lee**
  («no podés aprobar ni rechazar un incidente que reportaste vos…»). No es un botón apagado sin
  explicación.
- **Caso de CONTROL** con un incidente AJENO: las dos decisiones SÍ se ofrecen y el aviso NO
  aparece. Sin él, «está deshabilitado» podría ser cierto por la razón equivocada (p. ej. que el
  botón esté siempre deshabilitado).
- El dato es **`esPropio`, calculado en el SERVIDOR** (el DTO no expone el id del autor): la UI no
  compara identificadores, así que no puede equivocarse comparándolos mal.
- **Añadido con su razón:** en un incidente propio se ofrece **«Retractar reporte»** (R59). El
  design §12.6 sólo nombra las dos decisiones, pero `retractarIncidente` **ya está implementada y
  probada** en F1B; sin superficie se habría quedado como código muerto, y el mensaje de R51 habría
  sido un «no podés» sin salida. **La fuente de verdad es el código**, así que la UI la ofrece.
- El servidor **sigue siendo la guardia real**: hay un caso que reproduce el `conflict` de R51
  llegando del servidor (dos pestañas, un reintento) y comprueba que su mensaje llega tal cual.

### T2.10 — Cierre de fase ✅

`./init.sh` verde con los tests de componente incluidos, mapa R→test de **R1-R64** en §2 y
verificación por mutación en §3.

---

## 2. Mapa R → test (R1-R64 COMPLETO)

> Rutas relativas a la raíz del repo. Para los requisitos que ya cubrieron las fases anteriores se
> cita **el archivo de test concreto**, no sólo la bitácora, para que el reviewer pueda recorrer los
> 64 sin saltar de documento. El detalle del caso está en la bitácora de su fase:
> `impl_158_backend.md` §2 (R1-R36 backend), `impl_158_frontend.md` §2 (R1-R36 visible),
> `impl_158b_backend.md` §2 (R37-R64 servidor). **Las filas en negrita son las que aporta ESTA fase.**

### Camino del MENSAJERO (R1-R36) — cubierto por el PR 1, sin cambios aquí

| R | Test(s) |
| --- | --- |
| R1 | `tests/integration/db/incidente-indemnizacion-migration.test.ts` · `tests/unit/services/mis-asignaciones-incidente.test.ts` |
| R2 | `tests/integration/db/incidente-indemnizacion-migration.test.ts` |
| R3 | `tests/integration/db/incidente-indemnizacion-migration.test.ts` (SEED + doble candado) |
| R4 | `tests/integration/db/incidente-indemnizacion-migration.test.ts` (bloque del `down`) |
| R5 | `tests/unit/guards/incidente-exhaustividad.test.ts` |
| R6 | `tests/unit/services/mis-asignaciones-incidente.test.ts` |
| R7 | `tests/unit/services/mis-asignaciones-incidente.test.ts` |
| R8 | `tests/unit/repositories/gestion-orden-repository.test.ts` · `tests/unit/repositories/orden-historial-cobertura.test.ts` |
| R9 | `tests/unit/types/gestion-orden-causa-incidente.test.ts` · `tests/unit/services/mis-asignaciones-incidente.test.ts` · `tests/components/GestionarOrdenPanelIncidente.test.tsx` |
| R10 | `tests/unit/types/gestion-orden-causa-incidente.test.ts` · `tests/unit/repositories/gestion-orden-evidencia.test.ts` · `tests/components/GestionarOrdenPanelIncidente.test.tsx` (`it.each` de las 3 causas) |
| R11 | `tests/unit/types/gestion-orden-causa-incidente.test.ts` · `tests/components/GestionarOrdenPanelIncidente.test.tsx` |
| R12 | `tests/components/GestionarOrdenPanelIncidente.test.tsx` (bloque del gate de guía) |
| R13 | `tests/unit/domain/order-status-transiciones.guardia.test.ts` · `tests/unit/services/cierre-dia-service.test.ts` |
| R14 | `tests/unit/services/cierre-dia-service.test.ts` · `tests/unit/domain/order-status-transiciones.connectividad.test.ts` · `tests/components/CierreDiaModuleIncidente.test.tsx` |
| R15 | `tests/unit/services/cierre-dia-service.test.ts` |
| R16 | `tests/unit/repositories/cierre-dia-repository.test.ts` · `tests/unit/services/cierre-dia-service.test.ts` |
| R17 | `tests/unit/utils/incidente-no-mueve-dinero.test.ts` · `tests/unit/services/cierre-dia-service.test.ts` · `tests/unit/services/cierres-admin-service.test.ts` · `tests/components/CierreDiaModuleIncidente.test.tsx` |
| R18 | `tests/unit/services/cierre-dia-service.test.ts` · `tests/unit/services/cierres-admin-service.test.ts` · `tests/components/CierreDiaModuleIncidente.test.tsx` · `tests/components/CierreDetalleIncidente.test.tsx` |
| R19 | `tests/unit/services/cierres-admin-indemnizacion.test.ts` · `tests/components/CierresAdminIndemnizacion.test.tsx` |
| R20 | `tests/unit/types/cierres-admin-indemnizacion-schema.test.ts` · `tests/components/CierresAdminIndemnizacion.test.tsx` · `tests/unit/components/wallet-monto-valido-tope.test.ts` |
| R21 | `tests/unit/services/cierres-admin-indemnizacion.test.ts` · `tests/unit/repositories/cierres-admin-indemnizacion.test.ts` · `tests/components/CierresAdminIndemnizacion.test.tsx` |
| R22 | `tests/unit/repositories/cierres-admin-indemnizacion.test.ts` |
| R23 | `tests/unit/repositories/cierres-admin-indemnizacion.test.ts` · `tests/unit/services/cierres-admin-indemnizacion.test.ts` |
| R24 | `tests/unit/types/cierres-admin-indemnizacion-schema.test.ts` · `tests/unit/services/wallet-indemnizacion-feed-service.test.ts` · `tests/components/CierresAdminIndemnizacion.test.tsx` |
| R25 | `tests/unit/services/cierres-admin-indemnizacion.test.ts` · `tests/unit/repositories/cierres-admin-indemnizacion.test.ts` |
| R26 | `tests/unit/services/wallet-indemnizacion-feed-service.test.ts` |
| R27 | `tests/unit/services/wallet-indemnizacion-feed-service.test.ts` · `tests/unit/repositories/cierres-admin-indemnizacion.test.ts` |
| R28 | `tests/unit/repositories/cierres-admin-indemnizacion.test.ts` · `tests/integration/db/wallet-idempotencia.test.ts` |
| R29 | `tests/unit/guards/egreso-indemnizacion-emisores.test.ts` (**cobrado en F1B: DOS emisores**) |
| R30 | `tests/unit/services/wallet-indemnizacion-no-reversable.test.ts` · `tests/unit/components/wallet-indemnizacion-libro.test.tsx` |
| R31 | `tests/unit/guards/incidente-exhaustividad.test.ts` · `tests/unit/components/wallet-indemnizacion-libro.test.tsx` |
| R32 | `tests/unit/services/wallet-egreso-service.test.ts` · `tests/unit/components/wallet-desglose-egresos-card.test.tsx` |
| R33 | `tests/components/GestionarOrdenPanelIncidente.test.tsx` |
| R34 | `tests/components/CierresAdminIndemnizacion.test.tsx` (monto **y** causa) · `tests/components/CierreDetalleIncidente.test.tsx` |
| R35 | `tests/unit/types/gestion-orden-causa-incidente.test.ts` · `tests/unit/repositories/gestion-orden-repository.test.ts` · `tests/components/CierreDetalleIncidente.test.tsx` + la suite previa en verde sin tocar expectativas |
| R36 | `tests/unit/types/cierres-admin-indemnizacion-schema.test.ts` · `tests/unit/services/cierres-admin-indemnizacion.test.ts` · `tests/components/CierresAdminIndemnizacion.test.tsx` · `tests/components/CierresAdminModule.test.tsx` (test de la 38, intacto) |

### Camino del ADMIN (R37-R64)

| R | Test(s) |
| --- | --- |
| R37 | `tests/integration/db/orden-incidente-migration.test.ts` · `tests/unit/services/wallet-indemnizacion-incidente-feed.test.ts` |
| R38 | `tests/unit/guards/incidente-admin-aislamiento.test.ts` (incl. el caso de CONTROL de §9.7) · `tests/integration/db/orden-incidente-migration.test.ts` (RLS) |
| R39 | `tests/integration/db/orden-incidente-migration.test.ts` · `tests/unit/repositories/incidente-admin-repository.test.ts` |
| R40 | `tests/integration/db/orden-incidente-migration.test.ts` (bloque del `down`) + round-trip real (`impl_158b_backend.md` §3) |
| **R41** | `tests/unit/repositories/incidente-admin-repository.test.ts` (`it.each` de los 5 estados) · `tests/unit/services/incidente-admin-service.test.ts` · `tests/integration/actions/incidentes-action.test.ts` · **`tests/components/ReportarIncidenteAccion.test.tsx` › «la acción sólo se ofrece en los cinco estados» (5 casos + 5 negativos + el barrido del catálogo) y «el conjunto es EXACTAMENTE `ORIGENES_INCIDENTE_ADMIN`»** · **`tests/components/ReportarIncidenteModal.test.tsx` › «el envío válido llama a la action con la forma esperada»** |
| R42 | `tests/unit/repositories/incidente-admin-repository.test.ts` · `tests/unit/services/incidente-admin-service.test.ts` |
| R43 | `tests/unit/repositories/incidente-admin-repository.test.ts` |
| R44 | `tests/unit/repositories/incidente-admin-repository.test.ts` · `tests/unit/repositories/orden-historial-cobertura.test.ts` |
| **R45** | `tests/unit/types/incidente-schema.test.ts` · **`tests/components/ReportarIncidenteModal.test.tsx` › bloque «la causa es la MISMA lista CERRADA de tres, traducida» (3 casos) y «no deja enviar sin causa / sin motivo» (incluido el motivo de sólo espacios)** · **`tests/components/IncidentesAdminModule.test.tsx` › `it.each` «la causa `%s` se pinta con su etiqueta del catálogo compartido»** |
| **R46** | `tests/unit/types/incidente-schema.test.ts` · `tests/unit/services/incidente-admin-service.test.ts` (URL firmada) · **`tests/components/ReportarIncidenteModal.test.tsx` › `it.each` «con causa «%s» y motivo, pero SIN foto, no llama a la action» (las 3 causas) + «el copy dice QUÉ fotografiar cuando NO hay paquete» + «una sola foto basta»** · **`tests/components/IncidentesAdminModule.test.tsx` › «muestra causa, motivo, quién reportó, el estado de la orden y la evidencia FIRMADA» (el `src` ES la URL firmada, nunca un path del bucket)** |
| **R48** | `tests/unit/services/incidente-admin-service.test.ts` · `tests/unit/repositories/incidente-admin-repository.test.ts` · **`tests/components/IncidentesPage.test.tsx` › «quién entra a /incidentes» (3 roles OK + 2 `notFound` + sin sesión + `forbidden` del service)** · **`tests/components/IncidentesAdminModule.test.tsx` › «un adminSatelite SIN zona ve un aviso y NINGUNA cola»** · **`tests/unit/auth/menu-visibility.test.ts` (roles del ítem «Incidentes», por igualdad de lista)** |
| **R49** | `tests/unit/services/incidente-admin-service.test.ts` (bloque «dos colas») · **`tests/components/IncidentesAdminModule.test.tsx` › bloque «las DOS colas» (5 casos: las dos tablas, el recuento, los dos vacíos, el aviso sin zona y «el histórico es de SOLO LECTURA»)** |
| **R50** | `tests/unit/types/incidente-schema.test.ts` · `tests/unit/services/incidente-admin-service.test.ts` · `tests/integration/actions/incidentes-action.test.ts` · **`tests/components/IncidentesAdminModule.test.tsx` › bloque «no se aprueba con un monto inválido» (`it.each` de 7 inválidos + el tope + el máximo EXACTO + los dos mensajes + el `validation_error` por campo)** |
| **R51** | `tests/unit/services/incidente-admin-service.test.ts` › bloque «QUIEN REPORTA NO APRUEBA» (5 casos) · `tests/integration/actions/incidentes-action.test.ts` · **`tests/components/IncidentesAdminR51.test.tsx` (11 casos: las dos decisiones deshabilitadas, el motivo visible, que el click NO abre nada ni llama a la action, el bloque de CONTROL con un incidente AJENO, y el `conflict` del servidor con su mensaje)** |
| R52 | `tests/unit/repositories/incidente-admin-repository.test.ts` · `tests/unit/services/wallet-indemnizacion-incidente-feed.test.ts` |
| R53 | `tests/unit/repositories/incidente-admin-repository.test.ts` · `tests/integration/db/wallet-idempotencia.test.ts` |
| **R54** | `tests/unit/services/incidente-admin-service.test.ts` · `tests/unit/repositories/incidente-admin-repository.test.ts` · `tests/integration/actions/incidentes-action.test.ts` · **`tests/components/IncidentesAdminModule.test.tsx` › bloque «no se rechaza sin motivo» (4 casos: sin motivo, sólo espacios, el motivo RECORTADO, y que el payload del rechazo NO lleva monto)** |
| **R55** | `tests/unit/types/incidente-schema.test.ts` · `tests/unit/repositories/incidente-admin-repository.test.ts` · **`tests/components/IncidentesAdminModule.test.tsx` › «envía el STRING TAL CUAL (sin `parseFloat`)» + `it.each` «el monto «%s» conserva sus decimales»** |
| R56 | `tests/unit/guards/incidente-admin-aislamiento.test.ts` · `tests/integration/db/wallet-idempotencia.test.ts` |
| R57 | `tests/unit/services/incidente-admin-service.test.ts` · `tests/unit/repositories/incidente-admin-repository.test.ts` |
| R58 | `tests/unit/services/incidente-admin-service.test.ts` |
| **R59** | `tests/unit/services/incidente-admin-service.test.ts` · `tests/unit/repositories/incidente-admin-repository.test.ts` · `tests/unit/types/incidente-schema.test.ts` · **`tests/components/IncidentesAdminR51.test.tsx` › «en un incidente PROPIO se ofrece Retractar», «el retracto llama a la action SIN motivo» y «en uno AJENO NO se ofrece»** · **`tests/components/IncidentesAdminModule.test.tsx` › «el histórico no ofrece decidir»** |
| R60 | `tests/unit/repositories/incidente-admin-repository.test.ts` · `tests/unit/services/incidente-admin-service.test.ts` |
| **R61** | `tests/unit/domain/order-status-transiciones.guardia.test.ts` · `tests/unit/domain/order-status-transiciones.connectividad.test.ts` · **`tests/components/ReportarIncidenteAccion.test.tsx` › «`en_reparto` NO es reportable por el admin: ese camino es el del MENSAJERO» (la UI lee del mismo mapa y no puede ofrecer una arista que no existe)** |
| R62 | `tests/unit/domain/order-status-transiciones.guardia.test.ts` · `tests/unit/domain/order-status-transiciones.connectividad.test.ts` · `tests/fixtures/inventario-transiciones-140.ts` |
| R63 | `tests/unit/guards/incidente-admin-aislamiento.test.ts` |
| R64 | `tests/integration/db/wallet-idempotencia.test.ts` · `tests/unit/guards/egreso-indemnizacion-emisores.test.ts` + la suite del camino del mensajero en verde **sin modificar ninguna de sus expectativas** |

**Los 64 requisitos tienen test citado.** Los dos que llegaban a medias (**R49** y **R51**) quedan
cerrados en sus dos mitades.

---

## 3. Verificación por mutación

Todas en memoria (`git checkout --` tras cada una; `git status` limpio antes de cada commit).
**25 mutaciones, 23 discriminan.** Las 2 que no, con su razón, en §3.1 y §3.2.

| # | mutación | resultado |
| --- | --- | --- |
| A | el confirmar del modal deja de exigir el formulario completo | **7 rojos** |
| B | la evidencia sale de la lista de campos obligatorios (viola Q-B) | **4 rojos** (los 3 `it.each` + el del bloqueo) |
| C | el `FormData` manda la ETIQUETA de la causa en vez del value del enum | 1 rojo |
| D | el copy de la foto se degrada a «La foto de evidencia es obligatoria.» | 1 rojo |
| E | el motivo viaja sin `.trim()` | 1 rojo |
| **F** | **se retira la guardia redundante del handler (`if (!completo) return`)** | **0 rojos — NO DISCRIMINA** (§3.2) |
| G | la derivación de los cinco estados deja de filtrar por familia (entra #53) | **4 rojos**, incl. la igualdad con el servidor |
| H | la acción de fila se ofrece en cualquier estado | **5 rojos** |
| I | el módulo llama a `montoValido` **sin** el tope | 1 rojo (el caso del tope) |
| J | el confirmar de la aprobación sólo exige «no vacío» | **7 rojos** (los 7 montos inválidos) |
| K | el rechazo deja de exigir motivo | **2 rojos** |
| **L** | **el monto del histórico se pinta con `parseFloat`** | **1.ª pasada: 0 rojos — NO DISCRIMINABA** (§3.1) · **tras reforzar: 3 rojos** |
| M | la columna de causa pinta el slug crudo (`danado`) | **3 rojos** |
| N | el histórico usa `EstadoHistoricoRotulo` (el de los cierres) | 1 rojo |
| O | el detalle ofrece decidir también sobre un incidente ya resuelto | 1 rojo |
| P | «Aprobar» deja de deshabilitarse en un incidente propio (viola R51) | **2 rojos** |
| Q | «Rechazar» deja de deshabilitarse en un incidente propio (viola R51) | **2 rojos** |
| R | se retira el motivo visible de R51 | 1 rojo |
| S | se retira «Retractar reporte» del incidente propio | **2 rojos** |
| T | la página sólo comprueba que haya sesión (se cae la guardia por rol) | **2 rojos** (mensajero y adminTienda) |
| U | el ítem del menú añade `mensajero` a sus roles | **2 rojos** |
| V | el detalle deja de pedirse al servidor | **23 rojos** |
| W | el módulo deja de cortocircuitar con `sinZona` | 1 rojo |
| X | el rechazo manda el motivo sin recortar | 1 rojo |
| Y | la aprobación manda el monto con `parseFloat` | 1 rojo |

### 3.1 La mutación L: no discriminaba, y por eso hay un commit más

El primer caso de money-safe del histórico usaba `"1234567.89"`, y **`parseFloat("1234567.89")`
devuelve exactamente el mismo texto**: un render que parsea pasaba igual. Es el mismo fenómeno que
el PR 1 documentó con su `padEnd` — un caso que mide lo correcto **con el dato equivocado**.

Se cerró con montos de **escala 2**, que son los que llegan de verdad (`DECIMAL(12,2)`), y ahí el
`parseFloat` sí se nota: `"12500.00"` → `12500` → «₡12500». La misma mutación pone ahora **3 rojos**.
Commit propio (`test(158…): mata la mutación del monto que el caso previo no distinguía`), siguiendo
el precedente de la fase backend con sus mutaciones D/E.

### 3.2 La mutación F: la guardia del handler es genuinamente redundante, y se dice

`handleConfirm` del modal de reporte lleva `if (!completo) return` **además** del
`confirmDisabled`. Retirarla deja los 18 casos **en verde**, y la razón es correcta: cualquier
formulario incompleto falla igual en el `safeParse` de `reportarIncidenteSchema`, así que la action
sigue sin llamarse. No hay ningún comportamiento observable que sólo esa línea produzca.

**Se conserva la guardia y NO se le inventa un test.** Escribir un caso que compruebe que la línea
existe mediría FORMA, no comportamiento — exactamente lo que la fase backend criticó de sus
mutaciones D y E antes de reforzarlas de verdad. La línea es defensa en profundidad frente a un
cambio futuro (si el schema relajara un campo, el botón seguiría siendo el único freno) y sigue el
precedente literal de `DeshacerAsignacionModal` (149), que lleva la misma guardia con el mismo
comentario. Queda declarada aquí para que nadie la lea como cobertura.

### 3.3 Un test que pasaba por la razón equivocada, cazado por `typecheck`

El barrido «ningún otro estado del catálogo es reportable» se escribió como
`ORDER_STATUS_SEED.map((s) => s.value)`, pero `ORDER_STATUS_SEED` **es un array de strings**, no de
objetos: el `it.each` corría 18 veces con `undefined` y pasaba siempre. `pnpm run typecheck` lo puso
rojo (`Property 'value' does not exist on type '"entregada"'`) antes de que llegara a ningún commit.
Corregido, el barrido cubre los **13** estados reales que no son reportables. Se escribe porque el
caso «verde por la razón equivocada» es justo lo que estas verificaciones buscan.

---

## 4. Tests de otras features que esta fase tocó

**Ninguno se borró ni se debilitó.** Uno se actualizó, y era inevitable:

| archivo (feature) | afirmaba | ahora afirma | por qué |
| --- | --- | --- | --- |
| `tests/unit/auth/menu-visibility.test.ts` (varias) | las listas de ítems visibles de `maestro`, `admin` y `adminSatelite`, por **igualdad exacta** | las mismas listas **con «Incidentes» en su sitio**, y **5 asserts nuevos**: los tres roles que sí lo ven, y los dos (`mensajero`, `adminTienda`) que no | la comparación por igualdad es justamente la que garantiza que un ítem nuevo no se cuela sin decisión: hizo su trabajo. El invariante que protegía (el menú de cada rol es exactamente éste) sigue protegido, sobre un conjunto mayor. **Es el coste declarado de Q-I** |

`tests/components/Sidebar.test.tsx` **no se tocó**: no compara listas exhaustivas.
Las 20 suites de `tests/components/Ordenes*` pasan **sin tocar ninguna expectativa**: la acción de
fila es opt-in y por defecto está apagada.

---

## 5. Lo que NO se hizo, con su razón

### El `adminSatelite` NO tiene superficie desde la que reportar — hallazgo, no olvido

El service autoriza al `adminSatelite` acotado a su zona (R48) y la cola de `/incidentes` **sí** se
la ofrece. Pero **el reporte vive en `/ordenes`, y `/ordenes` le hace `notFound`** (`page.tsx:54`,
feature 63: su superficie es `/recepcion-satelite`). Consecuencia real: hoy sólo maestro/admin
pueden reportar, y dos de los cinco orígenes (`en_bodega_satelite`, `en_ruta_bodega_satelite`) son
justamente los que el satélite ve de cerca.

**No se arregló aquí, a propósito.** Montar la acción en `/recepcion-satelite` es una superficie
nueva que Q-H no decidió —el diseño evaluó y descartó colgar el reporte de ese módulo *como único
sitio*, no como segundo—, y decidirlo es del humano. Queda como **pregunta abierta 1** de §6.

### Tasks NO marcadas

- **T3.1 / T3.2 (pruebas de humo manuales)** — exigen levantar la app, operar de verdad (reportar,
  intentar aprobar como autor, rechazar con otro admin, aprobar con monto y mirar la wallet) y una
  base con datos. No es algo que este agente pueda **declarar** sin ejecutarlo. La UI que T3.2
  necesitaba ya existe; la prueba, no.
- **T3.3 (round-trip de las dos migraciones)** — su parte técnica está hecha y documentada
  (`impl_158b_backend.md` §3). La casilla sigue sin marcar porque su cláusula «con los datos de las
  pruebas de humo BORRADOS antes» depende de T3.1/T3.2.
- **T3.4 / T3.5** — del leader.

### Decisiones tomadas donde el spec no llegaba

- **Dónde vive el disparador.** El design dice «acción de fila del listado» sin decir cuál de las
  dos mecánicas de `/ordenes`. Se eligió la columna `acciones` de `OrdenesModule` (donde ya viven
  «Ver historial» y «Ver etiqueta») y **no** la barra de acciones por lote, porque el diseño es
  explícito en que un incidente **no puede ser acción de lote**. `ordenes-columns.tsx` no se tocó.
- **La acción se OCULTA (no se deshabilita) fuera de los cinco estados.** Un botón apagado en
  `entregada` no le dice nada útil a nadie y ensucia 18 estados para servir a 5.
- **Los cinco estados se derivan del mapa de la 140** en vez de copiarse. Alternativa descartada:
  una lista literal con un test de igualdad — protege lo mismo, pero deja dos sitios que editar.
- **El detalle se re-pide al servidor** aunque la fila traiga el DTO completo (URLs firmadas frescas
  + estado fresco). Cuesta un round-trip y es el camino del precedente.
- **`retractar` se ofrece en la UI** (ver T2.9): la action existe, está probada y sin superficie
  sería código muerto.
- **`EstadoHistoricoRotulo` NO se reusa**; sí `money` y `EstadoCierreBadge`.
- **Etiqueta del menú: «Incidentes»**, no «Incidentes de orden» ni «Indemnizaciones». Nombra la
  entidad, como sus vecinas («Cierres del día», «Órdenes»), y no el dinero: la cola también contiene
  los que se rechazan, que no pagan nada.
- **Textos en segunda persona rioplatense** («tenés», «podés»), que es el registro que ya usan
  `CierresAdminModule` y `DeshacerAsignacionModal`. No se mezcla con el «tú» del panel del
  mensajero: cada superficie conserva el suyo, y unificarlos es una feature de copy, no de ésta.
- **Prohibición de la sigla respetada:** no aparece «SLA» ni «acuerdo a nivel de servicio» en ningún
  texto visible de esta fase (tampoco hacía falta: este camino no tiene plazos).

### Lo que NO se tocó por estar fuera de alcance

- **Backend**: `lib/services/`, `lib/repositories/`, `lib/actions/`, `db/`. Cero cambios.
- **El camino del mensajero (R1-R36)**: cero cambios en su código y cero expectativas de sus tests
  modificadas.
- **`app/(app)/ordenes/_components/ordenes-columns.tsx`**: intacto, a propósito (imán de drift).

---

## 6. Preguntas abiertas que deja esta fase

1. **El `adminSatelite` no puede reportar** (§5). Está autorizado en el servidor y ve la cola, pero
   no tiene botón. Decidir: (a) montar la acción también en `/recepcion-satelite`, (b) dejarlo
   explícitamente como «el satélite avisa y el central reporta», o (c) quitarle la autorización de
   reporte en el service. **Las tres son decisiones de producto**, no de implementación.
2. **Q-J sigue abierta** (heredada de F1B): el mensajero asignado no se entera de que su orden pasó
   a `incidente`. Ahora la UI del admin lo hace trivial de provocar.
3. **El E2E sigue sin harness.** `playwright.config.ts` existe pero ningún gate lo corre, así que una
   spec nueva sería un archivo que nadie ejecuta. Esta fase **no** trae E2E y lo deja como hallazgo
   abierto para el reviewer, igual que F1B — con el agravante de que ahora existe el camino completo
   de UI que un E2E podría recorrer.
4. **El sub-modal de aprobación no muestra las evidencias.** El admin las ve en el detalle y luego
   abre el sub-modal, que sólo repite orden + causa. Es suficiente (el detalle sigue detrás) pero un
   admin que quiera volver a mirar la foto tiene que cancelar. No se resolvió porque implicaría
   anidar un visor dentro de un sub-modal, y eso es una decisión de UX.

---

## 7. Salida real de la verificación

```
$ ./init.sh
== Arnes SDD :: init ==
✓ node
✓ dependencias presentes
✓ regla max-2-por-zona respetada
✓ specs presentes para features sdd en vuelo
-> pnpm run typecheck
✓ typecheck paso
-> pnpm run lint
✖ 19 problems (0 errors, 19 warnings)
✓ lint paso
-> pnpm run test
 Test Files  629 passed (629)
      Tests  7329 passed (7329)
   Duration  164.30s
✓ test paso
✓ todas las migraciones tienen down.sql
✓ .env presente
== init OK ==
```

Baseline de la fase anterior (F1B): **624 archivos / 7228 tests**, lint 0 errores / 19 warnings.
**Delta: +5 archivos de test, +101 tests, 0 fallos, 0 warnings nuevos.**

---

## 8. Archivos creados / modificados

### Creados (9)

```
app/(app)/ordenes/_components/ReportarIncidenteModal.tsx
app/(app)/ordenes/_components/ReportarIncidenteAccion.tsx
app/(app)/ordenes/_components/incidente-origenes.ts
app/(app)/incidentes/page.tsx
app/(app)/incidentes/_components/IncidentesAdminModule.tsx
tests/components/ReportarIncidenteModal.test.tsx
tests/components/ReportarIncidenteAccion.test.tsx
tests/components/IncidentesAdminModule.test.tsx
tests/components/IncidentesAdminR51.test.tsx
tests/components/IncidentesPage.test.tsx
```

*(Son 10 rutas: 5 de producción y 5 de test.)*

### Modificados — producción (5)

```
app/(app)/ordenes/_components/OrdenesModule.tsx      ← prop `puedeReportarIncidente` + columna de acciones
app/(app)/ordenes/_components/OrdenesListado.tsx     ← pasa la prop
app/(app)/ordenes/page.tsx                           ← la enciende para acceso total (con la salvedad del satélite)
lib/auth/menu-visibility.ts                          ← ítem «Incidentes» + `IconKey` nuevo
app/(app)/_components/Sidebar.tsx                    ← mapa iconKey → lucide
```

### Modificados — tests (1)

```
tests/unit/auth/menu-visibility.test.ts   ← 3 listas actualizadas + 5 asserts nuevos (§4)
```

### Modificados — spec (1)

```
specs/158-incidente-indemnizacion/tasks.md   ← T2.7-T2.10 marcadas, con lo verificado escrito
```

---

## 9. Commits

```
a65319f  feat(158…): modal por orden para reportar un incidente desde el listado   (T2.7)
25f2414  feat(158…): cola de aprobacion de incidentes en pagina propia             (T2.8/T2.9)
ecd5d13  test(158…): mata la mutacion del monto que el caso previo no distinguia  (§3.1)
```

**No se hizo `git push` ni se abrió PR**: lo decide el humano.
