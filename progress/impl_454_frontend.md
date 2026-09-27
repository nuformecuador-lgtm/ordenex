# 454 — Fase 2 (frontend) + el resto de T1.1, T1.21 y T1.23: bitacora

> Rama `feature/454-frontend`, nacida de `186d5e19` (gate completo del backend en verde). Agente:
> frontend_dev. Busqueda de codigo: MCP `codebase-memory` no se uso en esta tanda (todo con
> `grep`/lectura directa del archivo real); se dice aqui por la regla 7.

## Entorno

- `git switch -c feature/454-frontend 186d5e19` → `git log --oneline -1` = `186d5e19 chore(454): gate completo del backend en verde (INIT_EXIT=0) y bitacora cerrada`.
- `node_modules` por junction (`fs.symlinkSync(..., "junction")` desde node), `.env` copiado sin
  imprimirlo, `prisma generate` en verde. La base local ya tenia M1-M3.

## Tareas

| Tarea | Estado | Test que lo cierra |
|---|---|---|
| T1.1 (resto) | Hecha: fuera `devolucion_por_confirmar` y `ayuda_tienda` del SEED (22 → 20); `ORDER_STATUS_RETIRADOS` + `esOrderStatusRetirado` para leer filas historicas (R40); grafo: bajas #59-#66 y claves de los dos estados, metadato #71/#72 (`gestion_tienda_ayuda` desde `en_reparto`, design §2), rol de #12/#13/#15/#44 «aplicado al aprobar» | `order-status.test`, `order-status-transiciones.guardia` (bloque «454/R37»), connectividad, inventario 140 (59 aristas / 54 pares) |
| T1.21 | Hecha: clase `evento_orden` en `OrdenHistorialEntradaDTO`, `findEventosByOrden` en el repo del historial (sin `motivo` ni mensajero), cuarta fuente de `fusionarLineaDeTiempo` (rango 3), leida DESPUES de autorizar | `unit/services/OrdenHistorialService.evento-orden.test.ts` (fusion, empate, autorizacion, forma de la consulta) |
| T1.23 | Hecha: barrido de literales; mapas `*_RETIRADO(S)` (hitos del rastreo, etiquetas del chip, origen de barridas); `ESTADOS_ESPERADOS.devuelta` pierde el pre-estado (U4); ejemplo OpenAPI reescrito (§12.2) | guardia nueva `unit/guards/sin-estados-retirados.guardia.test.ts` (AST; solo comentarios, mapas `*_RETIRADO(S)` y 1 frase historica de `openapi-spec.ts`) |
| T2.1 | Sin cambio de codigo: los grupos los sirve el servidor (backend), las pendientes no llegan, «con ayuda» igual que hoy | `RepartoAyuda.test` y demas del portal, verdes |
| T2.2 | **Parcial — §BLOQUEO-1**: fuera los dos valores de `EstatusBadge`/filtro/`OrdenesListado`; el chip de la nota esta hecho (`NotaGestionPendiente`) pero sin montar | `EstatusBadgeCatalogoV2`, `EstatusLabel`, `OrdenesExcludePorRol`, `NotaGestionPendiente.test` |
| T2.3 | Hecha: `case "evento_orden"` en el `switch` exhaustivo del timeline | `components/HistorialOrdenTimeline.evento-orden.test.tsx` (las cuatro clases, corregida, anulada, ayuda, fila historica R40) |
| T2.4 | Hecha: la entrada `pendiente` y la cabecera del rastreo dicen «<hito> · pendiente de confirmación» | `components/RastreoDialog.pendiente.test.tsx` (con y sin pendiente) |
| T2.5 | Hecha: `PREDICADO_POR_GRUPO`; la UI de `/novedades` toma el grupo de la lista que trajo la fila (`grupoDeFila`), porque una fila de ayuda ya esta `en_reparto` | `novedad-acciones-una-tabla.guardia` y `hilo-ventana-alcanzable.guardia` verdes; `NovedadAcciones`, `NovedadesModule`, `NovedadesTabs`, `novedad-grupo.test` |
| T2.6 | Parcial: fuera los dos valores del listado satelite; el chip, §BLOQUEO-1 | `estados-bodega-satelite.test`, `SateliteFiltroEstadoAlcance` |
| T2.7 | Hecha: el aviso de la correccion dice que el estado se aplica al aprobar | `CorregirResultadoCierre.test` («454: dice que el estado…») |
| T2.8 | Gate completo (toca `lib/types`): ver §Gate | — |

## Texto de la nota (decision del humano, 2026-09-23)

`components/shared/nota-pendiente-confirmacion.ts`: formato unico «<nombre> · pendiente de
confirmación» (punto medio) y «Ayuda solicitada a la tienda». El nombre lo pone cada superficie
desde su fuente canonica: `estatusLabel(ESTATUS_POR_RESULTADO[resultado])` en las internas
(Entregada, Reprogramada, Devuelta, Rechazada, Incidente) y `ETIQUETA_POR_HITO` en el rastreo
publico (ver §Decision a confirmar 2).

## Cambios fuera de la letra del encargo (por la regla 1: un rojo se arregla en el codigo)

1. **R64 — correccion de datos del `adminTienda` sobre una ayuda abierta.** Quitar `ayuda_tienda`
   de `ESTATUS_POR_GRUPO` puso rojo `corregir-datos-cliente-service` y `correccion-datos-cliente`:
   `rolAdmiteCorreccion` decidia la ayuda por el estado. El backend ya tenia la regresion en
   silencio (sus dobles aun decian `ayuda_tienda`; en la base la orden esta `en_reparto` y la tienda
   perdia el permiso que le dio P2 de la 312). Arreglo minimo: `OrdenParaCorreccionRow.ayudaAbierta`
   (derivado con `conAyudaAbiertaDe`, el punto unico) y `rolAdmiteCorreccion(rol, estatus,
   ayudaAbierta)`. Archivos de backend tocados: `lib/types/correccion-datos-cliente.ts`,
   `lib/interfaces/repositories/IOrdenRepository.ts`, `lib/repositories/OrdenRepository.ts`
   (`findParaCorreccion`), `lib/services/CorregirDatosClienteService.ts`. Test contra base real
   nuevo: `tests/integration/db/454/correccion-ayuda-abierta-sql-real.test.ts` (C1-C3).
2. **R40 — barridas historicas.** `toSinGestionRow` descartaba un origen fuera del SEED, asi que al
   retirar `ayuda_tienda` las barridas VIEJAS dejaban de leerse «Ayuda de la tienda» (rojo en
   `cierres-admin-repository`). Ahora pasa tambien un value retirado; tipo
   `OrderStatusValue | OrderStatusRetirado | null` en los dos DTO del vinculo.
3. `webhook-habilitacion-api-emision.test`: la rama A ya no produce transicion (R24); el archivo
   sigue midiendo la politica del emisor y la pausa 403/R5 sobre `por_recoger -> en_reparto`.

## BLOQUEO-1 — el chip de R29 no tiene de donde leer

R29 pide, en el listado y el detalle de la orden (maestro, admin, adminSatelite de la zona,
adminTienda dueña), «En reparto» + la nota. Los DTO que llegan a la UI (`OrdenListItemDTO` de
`/ordenes`, el del listado satelite y el detalle) **no traen ni la gestion pendiente ni la ayuda
abierta**. El design §11 U9 lo asigna al DTO del listado (`gestionPendiente: { resultado } | null`)
y la trazabilidad cita `unit/services/OrdenesListado.gestion-pendiente.test.ts`, pero ninguna tarea
de la fase 1 lo produjo (la bitacora del backend: «R29 sin test backend»). Derivarlo en el cliente
seria una segunda definicion del predicado (design DE). Queda:
- `NotaGestionPendiente` hecho y probado, anotado `@sin-superficie` (la guardia lo exige);
- falta en backend: `gestionPendiente: { resultado } | null` y `ayudaAbierta: boolean` en los DTO
  de listado (central y satelite) y detalle, con `whereGestionPendiente`/`ayuda-abierta.ts`;
- en frontend, despues: montarlo junto al `EstatusBadge` y NO ofrecer «Traspasar» ni «Cambiar dia»
  en una fila con gestion pendiente (hoy se ofrecen y el servidor responde conflicto, R54/R55).

## Decisiones a confirmar (no bloquean)

1. **Pregunta abierta 4.** Una barrida NUEVA con ayuda abierta se lee «En reparto» en la hoja del
   cierre (la historica sigue «Ayuda de la tienda»). Conservar la distincion exige derivar la ayuda
   en el DTO de `cierre_sin_gestion` (backend) — decision de producto.
2. **Rastreo publico y el nombre del resultado.** El DTO publico solo trae el HITO (frontera 229),
   asi que la nota dice «Entregado · …», «Reprogramado · …» y, para devuelta/rechazada/incidente,
   «No entregado · pendiente de confirmación» (el hito firmado G7). Decir «Rechazada · …» en el
   rastreo exigiria publicar el resultado interno.

## Mutaciones (arnes `mut.py`: base verde con passed ≥ 1 y 0 skipped, aplica, corre, restaura byte a byte)

| Pantalla / pieza | Mutacion | Test | Resultado |
|---|---|---|---|
| pos-card del mensajero | `{conAyuda.length > 0 ? (` → `{false ? (` (RepartoModule) | `RepartoAyuda.test` (18) | ROJO (13), restaurado |
| novedades de la tienda | `grupoDeFila(…, props.grupoListado)` → `grupoDeFila(…, "devolucion")` | `NovedadAcciones.test` (15) | ROJO (10), restaurado |
| listado `/ordenes` | sin `ORDER_STATUS_LABELS_RETIRADOS` en `EstatusBadge` | `EstatusBadgeCatalogoV2.test` (10) | ROJO (2), restaurado |
| rastreo publico | `textoEntrada` ignora `pendiente` | `RastreoDialog.pendiente.test` (3) | ROJO (2), restaurado |
| guardia T1.23 | `"ayuda_tienda"` en `ESTADOS_BODEGA_SATELITE` | `sin-estados-retirados.guardia` (6) | ROJO (1), restaurado |
| timeline (servicio) | `evento_orden: 3` → `-1` | `OrdenHistorialService.evento-orden.test` (6) | ROJO (1), restaurado |
| timeline (UI) | etiqueta de la ayuda → «Ayuda» | `HistorialOrdenTimeline.evento-orden.test` (6) | ROJO (1), restaurado |
| R64 (base real) | `ayudaAbierta: false` en `findParaCorreccion` | `454/correccion-ayuda-abierta-sql-real` (4) | ROJO (1), restaurado |
| nota (formato) | separador « · » → « — » | `NotaGestionPendiente.test` (14) | ROJO (12), restaurado |

`git status` limpio tras el arnes.

## Red

`pnpm exec vitest run tests/integration/db/454` → `Test Files 46 passed (46)` · `Tests 231 passed
(231)`, 0 skipped (las 28 de caracterizacion + las del backend + la nueva de R64). Ninguna
invariante de la Fase 0 tocada.

Tests existentes actualizados por diseño (design §16, «rojos esperados»), todos con nota fechada:
catalogo congelado 22 → 20 (`order-status`, `seed-order-status`, buckets, analitica, rastreo,
eliminables, connectividad, `EstatusBadgeCatalogoV2`, `EstatusLabel`), inventario 140 y guardias de
transiciones, los casos que afirmaban `ayuda_tienda`/pre-estado como estado (filtros, satelite,
traspaso, cambio de dia, `orden-repository`, tres migraciones de integracion) y las filas de ayuda de
los tests de `/novedades` (`estatusValue: "en_reparto"`).

## Gate

`bash ./init.sh > progress/gate_454_frontend.log 2>&1; echo "INIT_EXIT=$?" >> …` (sin `tail`):

1. `gate_454_frontend_1.log` — `INIT_EXIT=1`, 1 rojo MIO: `integration/db/gestion-tienda-ayuda-migration`
   (R1/R45 afirmaba que las dos aristas `gestion_tienda_ayuda` salian de `ayuda_tienda`; ahora
   salen de `en_reparto`, #71/#72). Actualizado con nota fechada en `f031ca1e`.
2. **`gate_454_frontend.log` (definitiva)** — typecheck y lint en verde; `Test Files 2125 passed
   (2125)` · `Tests 30394 passed | 26 skipped (30420)`; los 26 skipped son
   `tests/components/Analitica{Page,Shell}` (igual que el backend), **0 skipped en
   `integration/db`**; `== init OK ==`; **`INIT_EXIT=0`**.
