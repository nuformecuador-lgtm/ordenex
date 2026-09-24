# 454 — La nota de la gestion pendiente en pantalla (cierre de T2.2, T2.6 y el rastreo): bitacora

> Rama `feature/454-nota-pendiente`, nacida de `09828d5b` (los datos del chip, backend). Agente:
> frontend_dev. Solo UI. Busqueda de codigo: MCP `codebase-memory`
> (`R-job-singularis-projects-ordenex`) para localizar las superficies (`search_graph`); todo
> confirmado leyendo el archivo real (regla 7).

## Entorno

- `git switch -c feature/454-nota-pendiente 09828d5b` → `git log --oneline -1` =
  `09828d5b feat(454): senales de gestion pendiente y ayuda en los lectores; nombre del resultado en el rastreo`.
- `node_modules` por junction (`fs.symlinkSync(..., "junction")`), `.env` copiado sin imprimirlo,
  `prisma generate` en verde.

## Que se hizo

| Superficie | Cambio | Test |
|---|---|---|
| `/ordenes` y bodega satelite (R29) | `NotaGestionPendiente` montada junto al `EstatusBadge` en la columna «Estado» COMPARTIDA (`ordenes-columns.tsx`, que `recibidas-columns` reusa tal cual): lee `gestionPendiente?.resultado` y `ayudaAbierta` del DTO. Un DTO sin los campos no pinta nota. | `components/OrdenesListado.gestion-pendiente.test.tsx`, `components/SateliteOrdenesListado.gestion-pendiente.test.tsx` |
| Detalle (drawer «Ver historial», R29) | La nota encima del timeline, desde el `ok` de `obtenerHistorialOrden`. | `components/HistorialOrdenSheet.gestion-pendiente.test.tsx` |
| `/ordenes` acciones (R54/R55) | `accionesDe` recibe la fila: `en_reparto` con `gestionPendiente` → sin «Traspasar a otro mensajero» ni «Cambiar día de reparto». La fila no se marca y el «!» dice: «Tiene una gestión pendiente de confirmación: no se puede traspasar ni cambiar el día hasta que se apruebe el cierre del mensajero.» La de ayuda abierta sigue ofreciendo las dos (R28). | idem `/ordenes` (una prueba por accion + ayuda + solo pendientes) |
| Satelite acciones (R54/R55) | Sin cambio de codigo: alli «Cambiar día» solo existe para `por_recoger` y el traspaso no tiene superficie. El test lo fija (pendiente marcada → ninguna de las dos; `por_recoger` como control). | idem satelite |
| Rastreo publico (R31) | La entrada pendiente pinta `textoPendienteConfirmacion(nombreResultado)` (cae a la etiqueta del hito si faltara); la cabecera usa el mismo texto. | `components/RastreoDialog.pendiente.test.tsx` (actualizado con nota fechada: «Entregado · …» → «Entregada · …»; caso nuevo «Rechazada · …» en vez de «No entregado · …») |
| `NotaGestionPendiente` | Fuera la marca `@sin-superficie` (la guardia `superficie-de-uso` exige retirarla al montarse); gana `className` opcional para colocarse (`self-start` en el drawer). | `superficie-de-uso.guardia`, `NotaGestionPendiente.test` |

Solo UI: ningun archivo de `lib/`, `db/` ni rutas de API tocado. Clic de fila, seleccion, filtros y
vistas guardadas: sin cambios de logica; `tests/components` + `tests/unit/components` +
`tests/unit/guards` = `627 passed`, `9058 passed | 26 skipped` (los 26 de siempre, Analitica).

## Mutaciones (arnes propio: base verde con passed ≥ 1 y 0 skipped, aplica, corre, restaura byte a byte)

| # | Superficie | Mutacion | Test | Resultado |
|---|---|---|---|---|
| M1 | `/ordenes` acciones | `orden.gestionPendiente != null` → `false` en `accionesDe` | `OrdenesListado.gestion-pendiente` (9) | ROJO (3), restaurado |
| M2 | `/ordenes` nota | `resultadoPendiente={null}` en la columna | `OrdenesListado.gestion-pendiente` (9) | ROJO (2), restaurado |
| M3 | satelite nota | `resultadoPendiente={null}` en la columna | `SateliteOrdenesListado.gestion-pendiente` (5) | ROJO (1), restaurado |
| M4 | satelite ayuda | `ayudaAbierta={false}` en la columna | `SateliteOrdenesListado.gestion-pendiente` (5) | ROJO (1), restaurado |
| M5 | detalle | `resultadoPendiente={null}` en el drawer | `HistorialOrdenSheet.gestion-pendiente` (3) | ROJO (1), restaurado |
| M6 | rastreo | `textoPendienteConfirmacion(etiqueta)` (ignora `nombreResultado`) | `RastreoDialog.pendiente` (4) | ROJO (3), restaurado |

`git status` tras el arnes: solo los cambios de esta tanda.

## Red

`pnpm exec vitest run tests/integration/db/454` → `Test Files 47 passed (47)` · `Tests 243 passed (243)`, 0 skipped.

## Gate

(ver abajo)
