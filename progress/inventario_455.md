# 455 — T0.3 Inventario clasificado

> 2026-09-24 · backend_dev · `feature/455-fase0` sobre `0bd66809`. G1/G2 aun no existen como guardias
> (son T1.10): el «modo informe» se hizo con busquedas equivalentes sobre el arbol (`grep` sobre texto
> plano; el MCP `codebase-memory` esta rancio para la 454 y no sirve para un censo de literales).
> Clases (design §2.0): **1** estado de una orden concreta · **2** rotulo de UN estado/resultado (R5) ·
> **3** grupo, accion o estado de la interfaz (R6: texto propio) · **4** mensaje que nombra un estado ·
> **K** comentario/JSDoc (no visible; no cuenta como superficie, lo barre G2 solo si llega a texto).

## G1 — codigos anteriores (7) como literal entrecomillado

Medido hoy (lineas con al menos un literal, no ocurrencias): **1 187 lineas en 241 archivos** de
`app/ lib/ components/ hooks/ scripts/` y **4 342 lineas en 559 archivos** de `tests/` (el spec decia
1 166/237 y 3 981/497 ocurrencias el 2026-09-23: el arbol crecio con la 454). Clase unica: **codigo de
dominio** → reemplazo mecanico de T1.4 con el compilador y G1 como red. Excepciones previstas: el modulo
§1.1 (`CODIGO_VIGENTE_DE_ANTERIOR`), `tests/fixtures/codigos-455.ts` (el interruptor; en T1.4 deja de
contenerlos) y los tests de migracion de la 455. Nota: los tests de la Fase 0 NO contienen ningun
literal de codigo (todo va por `C`/`R`), salvo los `[INTERMEDIO]` que muestran lo que se pinta hoy.

## G2 — nombres retirados de §0.3 como texto (105 apariciones en codigo, 0 sin clasificar)

| Archivo:linea | Texto | Clase | Decision |
|---|---|---|---|
| `ordenes/_components/EstatusBadge.tsx:21,22,24,25,28,31,32` | Entregada, Devuelta, Reprogramada, Por recoger, Rechazada, Sin gestionar, Por devolver | 1 | Reexporta `NOMBRE_ESTADO` (T2.1) |
| `EstatusBadge.tsx:52,53` | Devolucion por confirmar, Ayuda solicitada a la tienda | 1 (retirado) | `nombreDeEstado` → «<historico> (estado retirado)» (R11) |
| `cierres-admin/_components/cierre-labels.ts:26-29` | Entregadas…Rechazadas (plural) | 2 | `nombreDeResultado` (T2.4) |
| `cierre-labels.ts:46-49` | Entregada…Rechazada | 2 | idem, un solo mapa |
| `cierres-admin/_components/cierre-factura.tsx:1439` | Ayuda de la tienda | 1 (retirado) | `nombreDeEstado(origen)` (R11) |
| `cierre-factura.tsx:2513`, `cierre-dia/_components/CierreDiaModule.tsx:1137` | «Entregadas», «Rechazadas» | K | comentario; cambia con T2.4 |
| `mis-asignaciones/_components/pos-card/pos-estado.ts:16,28,29,31,42,58,59` | En gestion, En detalle, Por recoger, En ayuda | 3 (UI) + 1 | chip = estado de la orden; «Gestionando ahora» / «Abierta en detalle» fuera del chip; colores por codigo (R8, R12; T2.2) |
| `pos-card/PosOrderCard.tsx:164` | En gestion / En detalle | 3 | idem |
| `pos-card/PosOrderCard.tsx:55,62`, `PosCardHeader.tsx:13,16` | «Por recoger», «En gestion» | K | comentario |
| `mis-asignaciones/_components/RepartoModule.tsx:155` | En ayuda | 3 | se retira (nota de ayuda de la 454 fuera del chip) |
| `RepartoModule.tsx:67,70,161,502,946,948` | «Por recoger» | K | comentario |
| `mis-asignaciones/_components/RecogerModule.tsx:195` | estado="Por recoger" | 1 (rotulo fijo) | chip = nombre del estado de la orden (R7) |
| `RecogerModule.tsx:309` | aria-label Por recoger | 3 | titulo de la accion «Recoger en bodega» |
| `mis-asignaciones/recoger/page.tsx:45`, `lib/auth/menu-visibility.ts:408` | Por recoger (titulo/menu) | 3 (accion) | «Recoger en bodega»; ruta intacta (R51) |
| `menu-visibility.ts:400`, `mis-asignaciones/reparto/page.tsx:14,67`, `lib/interfaces/services/IMisAsignacionesService.ts:58,303`, `lib/services/MisAsignacionesService.ts:322,338,830` | «Por recoger» | K | comentario |
| `mis-asignaciones/_components/chat/chat-format.ts:21,23,24,25` | Por recoger, Entregada, Devuelta, Asignada | 1 + 3 (cajon) | `nombreDeEstado`; color por codigo con neutro por defecto (R12) |
| `mis-asignaciones/_components/KpisMensajero.tsx:30` | Entregadas | 2 | «Entregado» (R5) |
| `monitoreo/_components/contadores.ts:40-43` | Entregadas…Rechazadas | 2 | nombre exacto del resultado (T2.3) |
| `contadores.ts:61` | Sin recoger | 3 (grupo) | «Todavia no sale a reparto» |
| `novedades/_components/novedad-grupo-textos.ts:86` | En devolucion | 2 | «Novedad» (T2.5) |
| `analitica/_components/entregas/CohorteCargaTabla.tsx:143,144` | Entregadas, Devueltas (rotula `devuelta_a_tienda`) | 2 | «Entregado», «Devuelta a tienda» |
| `analitica/_components/entregas/KpisEfectividad.tsx:85` | Entregadas | 2 | «Entregado» |
| `KpisEfectividad.tsx:86`, `analitica-productos-descarga-columnas.ts:86` | En proceso | 3 (grupo «aun sin desenlace») | texto propio que no coincida con §0.1/§0.3 (p. ej. «Sin desenlace todavia»): decision tomada, no estaba en design §2.1 |
| `analitica/_components/entregas/madurez-textos.ts:73`, `ranking/historico/_components/ranking-historico-labels.ts:30`, `ranking/_components/ranking-descarga-columnas.ts:48`, `analitica-productos-descarga-columnas.ts:78` | Entregadas | 2 | «Entregado» |
| `analitica-productos-descarga-columnas.ts:79` | Rechazadas | 2 | «Devolucion a origen por rechazo» |
| `analitica/_components/entregas/ProductosTabla.tsx:224` | «Entregadas»… | K | comentario |
| `analitica/_components/entregas/HoyGestionBarras.tsx:53` | Sin gestionar | 3 | cuenta ordenes SIN GESTION EN EL DIA (no el estado) → «Sin gestion en el dia» |
| `analitica/_components/operativo/catalogo-paneles.ts:114`, `lib/analytics/metrics.ts:322` | Sin gestionar (metrica `sin_gestionar`) | 2 | la metrica cuenta `estados: [sin_gestionar]` (`metrics.ts:338`) → «Novedad interna» |
| `recoleccion/_components/RecoleccionModule.tsx:203` | estado="Por recolectar" | 1 (rotulo fijo) | chip = estado de la orden; el DTO debe ganar `estatusValue` (T2.2) |
| `recoleccion/_components/RecolectadasHoyLista.tsx:100` | estado="Recolectada" | 1 (rotulo fijo) | idem |
| `recepcion-satelite/_components/RecepcionDetalle.tsx:98`, `SateliteOrderCard.tsx:18` | «Devueltas», «Por recoger» | K | comentario |
| `lib/types/rastreo-publico.ts:45-54` | los 9 hitos | 1 (rastreo) | se retiran (DF, T1.9) |
| `rastreo-publico.ts:201-204` (`NOMBRE_RESULTADO_PENDIENTE`) | Entregada…Rechazada | 2 | absorbido por `nombreDeResultado` (T1.1/T1.9) |
| `rastreo-publico.ts:183,184` | nombres en JSDoc | K | comentario |
| `lib/repositories/GestionOrdenRepository.ts:94` | KPI «Entregadas» | K | comentario |
| `components/shared/nota-pendiente-confirmacion.ts:25` | `NOTA_AYUDA_SOLICITADA = "Ayuda solicitada a la tienda"` | 3 (nota de la 454, no estado) | la 456 fija el texto; hoy COINCIDE con el nombre historico de `ayuda_tienda` → R6 lo prohibe: decidir texto en T2.2 |

## docs/ayuda (texto; lo alinea T2.10)

| Archivo | Nombres retirados (mayuscula inicial, conteo) |
|---|---|
| `mensajero/recoleccion.md` | Por recoger ×3, Recolectada ×2 |
| `mensajero/reparto.md` | Por recoger ×2, Asignada ×2 |
| `mensajero/por-recoger.md` | Por recoger ×2 (titulo → «Recoger en bodega», slug intacto) |
| `tienda/novedades.md` | En devolucion ×2, Rechazadas ×1 |

Los usos en minuscula en prosa («la orden entregada») no se pueden separar del castellano por busqueda:
T2.10 los revisa a mano.

## Piezas que T0.3 pedia confirmar

| Pieza | Resultado |
|---|---|
| Chips sin `estatusValue` en su DTO (recoleccion) | Confirmado: `RecoleccionModule.tsx:203` y `RecolectadasHoyLista.tsx:100` pintan un rotulo fijo; el DTO no lleva estado |
| Parametros de URL internos por codigo | Solo `recepcion-satelite` (`?estado=`, via `seleccionDesdeUrl`/`filtroEstado`; C02). `/ordenes` usa ids (`status_id`). La API por key (`?estado=`) es canal de integracion (R26) |
| Lectores de `historial_accion.valor_*` | `HistorialAccionService.aDTO` → `historial-acciones-columnas.ts:149,155` (pinta el valor crudo) y `historial-acciones-descarga-columnas.ts:72` (descarga). C16 |
| Textos fijos del asistente | `lib/asistente/{citas,contexto,instrucciones,protocolo}.ts` y `AsistenteService.ts`: **0** nombres ni codigos de estado (grep) |
| PDFs / manifiestos / etiquetas | Sin nombres de estado en `lib/pdf/**` (la busqueda G2 no los encontro) |
| Plantillas de WhatsApp de sistema | Solo la variable `{{estatus}}` (`plantilla-datos.ts:487-496`, C15) |
| Correos | No hay canal de correo con estados |
| Rutas de evidencias con el codigo | `MisAsignacionesService.ts:695`, `GestionDesdeAyudaService.ts:230` (ver medicion_455.md) |
