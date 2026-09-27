# 454 — Datos del chip (cierre del BLOQUEO-1 de la Fase 2) y nombre del resultado en el rastreo: bitacora

> Rama `feature/454-datos-pendiente`, nacida de `9e5a4a8c` (gate completo de la fase 2 en verde).
> Agente: backend_dev. Solo backend (ni UI ni componentes). Busqueda de codigo: MCP
> `codebase-memory` (`R-job-singularis-projects-ordenex`) para localizar el DTO del listado;
> el resto, confirmado leyendo el archivo real (regla 7).

## Entorno

- `git switch -c feature/454-datos-pendiente 9e5a4a8c` → `git log --oneline -1` =
  `9e5a4a8c chore(454): gate completo de la fase 2 en verde (INIT_EXIT=0)`.
- `node_modules` por junction (`fs.symlinkSync(..., "junction")`), `.env` copiado sin imprimirlo,
  `prisma generate` en verde. Base local compartida con M1-M3 ya aplicadas; esta tanda NO migra.

## Que se cierra

### 1. Las dos señales en los lectores internos (R29, design §11 U9)

Forma EXACTA por fila (la misma en los tres lectores):

```ts
gestionPendiente: { resultado: GestionResultado; registradaAt: string /* ISO-8601 UTC */ } | null;
ayudaAbierta: boolean;
```

`resultado` es el codigo del enum (`entregada|reprogramada|devuelta|rechazada|incidente`); el nombre
visible lo pone la pantalla (`notaGestionPendiente(resultado)` de `estatus-label.ts`, ya hecho en la
fase 2). Tipos en `lib/types/orden.ts`: `GestionPendienteDTO`, `SenalesGestionDTO`.

| Lector | Donde viajan | Nota |
|---|---|---|
| `/ordenes` (maestro, admin, adminTienda) | `OrdenListItemDTO.gestionPendiente?` / `.ayudaAbierta?` (opcionales por el patron aditivo; el repositorio SIEMPRE los envia) | `OrdenRepository.list()`; lo heredan `listar` y `listarCompleto` (descarga) |
| Bodega satelite (`/recepcion-satelite`) | los mismos campos en `RecepcionSateliteDTO` (= `FilaBodegaSatelite`, interseccion con `OrdenListItemDTO`) | `hidratarSatelite` (pagina + descarga) y `findRecepcionSateliteByZona` (grupos) |
| Detalle (drawer «Ver historial», `obtenerHistorialOrden`) | en el `ok`: `{ status, entradas, intentos, umbral, gestionPendiente, ayudaAbierta }` (obligatorios) | `IOrdenHistorialRepository.findSenalesGestion`, leido DESPUES de autorizar |

- **Predicado unico.** Nada se reescribe fuera de `gestion-pendiente.ts` / `ayuda-abierta.ts`:
  - `gestion-pendiente.ts`: las condiciones 1-3 pasan a UN fragmento privado
    (`sqlCondicionesPendiente`) que comparten las tres formas SQL (existe, ultima de UNA orden —la
    del rastreo—, y la nueva `sqlUltimaGestionPendienteLateral`, la ultima de CADA orden de un lote).
    La ultima se desempata ahora por `created_at DESC, id DESC` (antes solo `created_at`).
  - `ayuda-abierta.ts`: `senalesGestionDe(cliente, ids)` compone `sqlAyudaAbierta` + el lateral en
    UNA consulta; `SIN_SENALES_GESTION` para una fila sin respuesta.
- **Sin N+1.** Una consulta por pagina (`LEFT JOIN LATERAL` sobre `orden WHERE id IN (pagina)`).
  El listado de `/ordenes` pasa de 2 a 3 consultas de datos fijas por pagina; la pagina satelite de
  2 a 3 `$queryRaw`+`findMany`. Tests que contaban consultas actualizados con nota fechada.
- **Alcance.** No se toca: se anotan solo los ids que el `where` del lector ya recorto (tienda,
  zona, mensajero). El detalle usa la autorizacion de hoy (`OrdenHistorialService.autorizar`), asi
  que las señales las ven los mismos roles que la linea de tiempo — incluido el mensajero asignado,
  que ya veia el evento `gestion_registrada` en esa linea (R30). No es acceso nuevo (R64).
- Guardia `gestion-pendiente-unica-fuente` verde.

### 2. Rastreo publico: el NOMBRE del resultado pendiente (decision del humano, prevalece)

La entrada pendiente de la linea publica gana `nombreResultado` (texto visible: `Entregada`,
`Reprogramada`, `Devuelta`, `Rechazada`, `Incidente`); `hito` sigue siendo el del vocabulario
publico. Forma: `{ hito, fecha, pendiente: true, nombreResultado }`; las entradas confirmadas siguen
`{ hito, fecha }`. Sin codigos internos, sin actor, motivo ni datos personales.

- **Copia declarada de cinco nombres.** `NOMBRE_RESULTADO_PENDIENTE` vive en
  `lib/types/rastreo-publico.ts` porque `lib/` no puede importar `ORDER_STATUS_LABELS` de `app/`.
  Atada a su fuente por `tests/unit/types/rastreo-publico.nombre-resultado.test.ts` (literal escrito
  a mano + igualdad con `ORDER_STATUS_LABELS[ESTATUS_POR_RESULTADO[r]]`). La 455 (design DA) mueve
  la fuente unica a `lib/types/order-status.ts`: esta tabla pasa entonces a derivarse de ella.
- Frontend, despues: `RastreoDialog` debe pintar `textoPendienteConfirmacion(entrada.nombreResultado)`
  en vez de `ETIQUETA_POR_HITO[hito]`.

## Archivos

Codigo: `lib/repositories/gestion-pendiente.ts`, `lib/repositories/ayuda-abierta.ts`,
`lib/repositories/OrdenRepository.ts`, `lib/repositories/OrdenHistorialRepository.ts`,
`lib/interfaces/repositories/IOrdenHistorialRepository.ts`,
`lib/interfaces/services/IOrdenHistorialService.ts`, `lib/services/OrdenHistorialService.ts`,
`lib/services/RastreoPublicoService.ts`, `lib/types/orden.ts`, `lib/types/rastreo-publico.ts`.

Tests nuevos: `tests/integration/db/454/senales-gestion-lectores-sql-real.test.ts` (12),
`tests/unit/types/rastreo-publico.nombre-resultado.test.ts` (7).

Tests actualizados con nota fechada (dobles que ganan `$queryRaw`/`findSenalesGestion`, literal de
contrato que crece, conteo de consultas 2 → 3): `orden-repository.test.ts`,
`orden-repository.recepcion-satelite.test.ts`, `satelite-paginado-where.test.ts`,
`convergencia-tarifa-listado-cierre.test.ts`, `tarifa-especial-por-distrito.test.ts`,
`orden-historial-fusion.test.ts`, `orden-historial-service.test.ts`,
`OrdenHistorialService.evento-orden.test.ts`, `fixtures/intentos-entrega.ts`,
`orden-historial-action.test.ts`, `components/HistorialOrdenSheet.test.tsx` (solo el fixture del
`ok`), `integration/db/454/rastreo-pendiente-sql-real.test.ts` (se AÑADE `nombreResultado` al
literal; no se relaja el `toEqual`).

## R → test

| Req | Test |
|---|---|
| R29 (listado `/ordenes`, 3 roles, alcance de tienda) | `454/senales-gestion-lectores-sql-real` L1 |
| R29 (bodega satelite, alcance de zona) | idem L2 (pagina y grupos) |
| R29 (detalle, tienda dueña/ajena, satelite) | idem L3 |
| R29 casos: legada sin evento → null (F), anulada → null (E), cierre aprobado → null (G), ayuda rescatada → false (D), fuera de reparto → null (I), cierre solicitado sigue pendiente (H) | idem, por caso y en los tres lectores |
| R31 (nombre del resultado, sin codigos) | `unit/types/rastreo-publico.nombre-resultado` (los 5 resultados); `454/rastreo-pendiente-sql-real` (registrada, corregida → «Rechazada», aprobada sin nombre) |

## Mutaciones (arnes propio: base verde con passed ≥ 1 y 0 skipped, aplica, corre, restaura byte a byte)

Suite: `senales-gestion-lectores-sql-real` + `rastreo-pendiente-sql-real` + `rastreo-publico.nombre-resultado`
(base: `28 passed (28)`).

| # | Lector / pieza | Mutacion | Resultado |
|---|---|---|---|
| M1 | L1 `/ordenes` | `list()` devuelve las filas SIN anotar | ROJO (4 failed), restaurado |
| M2 | L2 pagina satelite | `hidratarSatelite` sin anotar | ROJO (1 failed), restaurado |
| M3 | L2 grupos satelite | `findRecepcionSateliteByZona` sin anotar | ROJO (1 failed), restaurado |
| M4 | L3 detalle (servicio) | `gestionPendiente: null` fijo | ROJO (2 failed), restaurado |
| M5 | L3 detalle (repo) | lee la señal de otra clave | ROJO (3 failed), restaurado |
| M6 | lateral | sin la condicion `en_reparto` | ROJO (6 failed), restaurado |
| M7 | condiciones | sin «cierre no aprobado» | ROJO (7 failed), restaurado |
| M8 | condiciones | sin «no anulada» | ROJO (7 failed), restaurado |
| M9 | condiciones | sin el evento `gestion_registrada` | ROJO (6 failed), restaurado |
| M10 | ayuda | `ayudaAbierta` siempre `false` | ROJO (7 failed), restaurado |
| M11 | rastreo | `nombreResultado` = «No entregado» | ROJO (8 failed), restaurado |

`git status` tras el arnes: solo los cambios de esta tanda.

## Red

`pnpm exec vitest run tests/integration/db/454` → `Test Files 47 passed (47)` · `Tests 243 passed (243)`,
0 skipped (las 46 de antes + la nueva). Ninguna invariante de la Fase 0 tocada.

## Gate completo (`./init.sh`, toca `lib/types`), log sin `tail` e `INIT_EXIT=$?` dentro

1. `progress/gate_454_datos_1.log` — typecheck y lint en verde; `Tests 7 failed | 30406 passed | 26
   skipped`; `INIT_EXIT=1`.
   - **MIO (1 archivo, 3 casos):** `integration/asimetria-sin-tarifa` — su doble de Prisma para
     `list()` no tenia `$queryRaw` (`cliente.$queryRaw is not a function`). Arreglado con nota fechada;
     3/3 verde aislado.
   - Ajenos: `notificacion-evento-bloqueo-cierre-migration` y `notificacion-evento-gasto-fijo-migration`
     (el CONTROL del `down` recrea el enum `notificacion_evento` y choca con filas/uso concurrente de
     `reparto_manana`: `22P02 … «reparto_manana»`), y `reparto-manana-aviso-dedupe` (la
     autocomprobacion cuenta 1 en vez de 0: fila de otro archivo concurrente). Ninguno toca lo de
     esta tanda.
2. **`progress/gate_454_datos.log` (definitiva)** — typecheck y lint en verde; `Test Files 2 failed |
   2125 passed (2127)` · `Tests 11 failed | 30402 passed | 26 skipped (30439)`; los 26 skipped son
   `tests/components/Analitica{Page,Shell}` (igual que las fases anteriores), **0 skipped en
   `integration/db`**; **`INIT_EXIT=1`**, con DOS rojos ajenos y distintos de los de la corrida 1:
   - `integration/db/costo-y-zona-api-415` (10): `cierre_dia_mensajero_id_fkey` al sembrar sobre una
     tienda leida de la base compartida que otra sesion borro en paralelo.
   - `integration/db/seed-zonas-cruza-por-codigo` (1): `expected 0 to be 1`, datos de la base compartida.

   Repeticiones aisladas (3 cada una, tras la corrida 2): `costo-y-zona-api-415` 11/11 ×3,
   `seed-zonas-cruza-por-codigo` 8/8 ×3, `asimetria-sin-tarifa` 8/8 ×3,
   `notificacion-evento-bloqueo-cierre-migration` 15/15 ×3 (antes, justo tras la corrida 1: 14/15 ×3,
   rojo mientras otra sesion usaba el valor), `notificacion-evento-gasto-fijo-migration` 20/20 ×3
   (antes 19/20 ×3, idem), `reparto-manana-aviso-dedupe` 8/8 ×3.

Lectura: los rojos cambian de archivo entre corridas y todos son verdes aislados; el unico rojo propio
(corrida 1) esta arreglado. Memoria «Base local compartida rompe gates ajenos» / «Gate rojo: cuatro
modos de flake». No se repite una tercera corrida completa (11 min) sobre la base compartida en uso.

## Veredicto

BLOQUEO-1 cerrado en backend: los tres lectores entregan `gestionPendiente`/`ayudaAbierta` desde el
predicado unico, en una consulta por pagina, con alcance intacto; el rastreo publica el nombre del
resultado pendiente; mutaciones 11/11 rojas; gate completo con rojos solo ajenos y verdes aislados.
