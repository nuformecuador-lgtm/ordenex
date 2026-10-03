# Ficha 469 — Implementación, parte de servidor (backend)

> Rama `feature/469-wallet-buscar-guia` (local `be469`). Base: `dev` con la 468 mergeada (`f32f7ed6`,
> T0 cumplido: `FUENTE_MENSAJERO.pago_devengado` es `snapshot_gestion`). Spec APROBADO con las tres
> propuestas por defecto (requirements.md § Aprobación).
> Dos agentes previos cayeron por red; su trabajo (`0c3c15af`, `6e97cf57`, `0b1acb6c`) se revisó contra el
> spec antes de seguir (sección «Revisión de lo heredado»). Este agente añadió la integración contra
> Postgres (`45dd3cfd`), corrió el gate completo y escribió este informe.
> Búsqueda de código: el MCP `codebase-memory` NO estaba en el conjunto de herramientas de este agente;
> se usó `grep` y lectura de archivos.

## Lo hecho (T2–T10, T14 de servidor)

| Tarea | Qué | Archivos |
| --- | --- | --- |
| T2 | Tipos: `ModoBusquedaLibro`, `ParDeGuia`, `BusquedaResuelta`, `SuperficieConGuia`, `OrdenIdentificada`. `modoBusqueda?` en `ListarMovimientosPayload` y `EstadoCuentaDTO`. `resaltar` (mismo esquema que `q`) en `verDetalleDeMovimientoSchema` y `ordenesDeFilaSchema`; fuera del completo. `destacadas` en `DetalleMovimientoPayload`; `ordenes` pasa a `OrdenDeDetalleDTO` (= `OrdenAporteDTO` + `resaltada`). | `lib/types/busqueda-por-guia.ts` (nuevo), `lib/types/detalle-movimiento.ts`, `lib/types/estado-cuenta.ts`, `lib/interfaces/services/IWalletService.ts` |
| T3 | `IOrdenIdentificadaRepository` + implementación: `identificar` (`$queryRaw`, `num_guia = $guia OR lower(num_remision) = lower($t)`, `tienda_id` al final en `AND`), `cierresDeOrdenes`, `gestionesConCobroPorRechazo`, `incidentesDeOrdenes`. | `lib/interfaces/repositories/IOrdenIdentificadaRepository.ts`, `lib/repositories/OrdenIdentificadaRepository.ts` |
| T4 | `CierreAporteRepository.cierresDondeAporta` (OR de `buildWhere(cierre, criterio, tienda) AND orden_id` por par) y `ordenIds` opcional en `listarOrdenesQueAportan` (AND aparte). `buildWhere` no se tocó. | `lib/repositories/CierreAporteRepository.ts`, `lib/interfaces/repositories/ICierreAporteRepository.ts` |
| T5 | `BusquedaPorGuiaService.resolver` / `identificar`; `gruposDeCriterio` agrupa el catálogo de la superficie por criterio (sin lista de conceptos escrita). | `lib/services/BusquedaPorGuiaService.ts`, `lib/interfaces/services/IBusquedaPorGuiaService.ts` |
| T6 | Caja: `condicionPorGuiaSql` y `porGuia` excluyente con `termino` en `whereLibroCajaConTerminoSql`; `listar` va por el camino SQL también con `porGuia`. | `lib/repositories/libro-caja-a-quien-sql.ts`, `lib/repositories/WalletMovimientoRepository.ts`, `lib/interfaces/repositories/IWalletMovimientoRepository.ts` |
| T7 | Estado de cuenta: `porGuia` en `VentanaDeLibro`; `busquedaSql` en el `WHERE` exterior (después de la ventana del corrido). La bodega sigue con `terminoSql` (R36). | `lib/repositories/EstadoCuentaRepository.ts`, `lib/interfaces/repositories/IEstadoCuentaRepository.ts` |
| T8 | `WalletService` (`listarMovimientos`, `listarMovimientosCompleto`) y `EstadoCuentaService.leerCuenta` (oficina, completo, `/mi-wallet`) resuelven `q` y devuelven `modoBusqueda`. Composition roots: `buildBusquedaPorGuia(prisma)` en los tres bordes. | `lib/services/WalletService.ts`, `lib/services/EstadoCuentaService.ts`, `lib/actions/_shared/busqueda-por-guia.ts`, `lib/actions/{wallet,wallet-tienda,estado-cuenta}.ts` |
| T9 | Integración de punta a punta contra Postgres (este agente). | `tests/integration/db/busqueda-por-guia-469.test.ts` (nuevo) |
| T10 | `DetalleMovimientoService.resolverConjunto` con `resaltar`: identifica con el MISMO `tiendaId` del detalle, `destacadas` con el mismo método y el mismo mapeo (`aDTO`), `resaltada` por fila. | `lib/services/DetalleMovimientoService.ts` |
| T14 | Sin código nuevo: la descarga (kardex de la 468) reutiliza `listarMovimientosCompleto` / `leerCuenta`, que ya resuelven igual. Probado en integración. | — |

Fixtures tocados solo para cablear la dependencia nueva: `tests/integration/db/_fixtures/{busqueda-469,caja-459,libro-468,wallet-458}.ts`,
`detalle-en-lote-464`, `detalle-movimiento-cierre-postgres`, `estado-cuenta-concurrencia-458`, y dos unitarios de detalle.

## Revisión de lo heredado (contra el spec)

- **R34 / sin fórmulas nuevas:** confirmado. El criterio sigue escrito una vez (`buildWhere`); la búsqueda
  lo reutiliza con la orden fijada en un `AND` aparte. No hay ni una operación de dinero nueva; el aporte
  destacado sale de `aporteDeOrden` con el mismo mapeo que la fila (R27 por construcción).
- **R12/R13:** los conceptos salen de `FUENTE_*` vía `criterioDeFuente`; `pago_efectivo` (sin_reparto)
  queda fuera solo. Incluye los cuatro de la 468.
- **R14 (pregunta 1 aprobada):** pares `gestion_orden` (solo gestiones con `rechazo_tienda_cobro`) y
  `orden_incidente`, sin categoría. Sin resaltado: esas filas son `sin_reparto` en el detalle.
- **R36 (pregunta 2 aprobada):** la bodega no resuelve (`modoBusqueda: "texto"` y `termino`).
- **R7 / pregunta 3 aprobada:** identifica por guía O remisión en la misma consulta: si una remisión
  numérica coincide con la guía de otra orden, salen las dos.
- **Orden de guard:** la resolución corre DESPUÉS del guard de rol en los dos servicios (`forbidden` no
  consulta nada; unitario R33).
- **Nada que corregir** en el código heredado. Solo se añadió la integración que faltaba.

## Mapa R → test (servidor)

`INT` = `tests/integration/db/busqueda-por-guia-469.test.ts`; `U-BUS` = `tests/unit/services/busqueda-por-guia-469.test.ts`;
`U-SRV` = `tests/unit/services/busqueda-por-guia-469-servicios.test.ts`; `U-ROOT` = `tests/unit/actions/busqueda-por-guia-469-roots.test.ts`.

| R | Test |
| --- | --- |
| R1 | Contrato: `q` ya existía en los bordes; `U-SRV` «R2/R10/R20/R33…». Lo visible (sin control nuevo) es de pantalla. |
| R2 | `U-BUS` «R2: si identifica una orden…»; `U-SRV` «R2/R10/R20/R33…»; `INT` caja/tienda/mensajero (`modoBusqueda === "guia"`) |
| R3 | `INT` «T3 R3/R4/R5/R7» (prefijo, sufijo, cero inicial, 10 cifras, `_` no comodín); `U-BUS` «R3/R4» |
| R4 | `INT` «T3» (remisión en minúsculas); `U-BUS` «R3/R4» |
| R5 | `INT` «T3» (`tiendaId` acota guía y remisión) y «tienda (oficina) y /mi-wallet» (tienda B y `/mi-wallet` de B: modo texto, misma respuesta que la 463); `U-BUS` «R5/R29» |
| R6 | `INT` «caja: … R22/R7» (término inexistente ⇒ texto); `U-BUS` «R6»; `U-SRV` «R6» |
| R7 | `INT` «T3» (remisión de dos tiendas ⇒ las dos sin tienda) y «caja» (remisión compartida da el mismo conjunto); `U-BUS` «R7/R15» |
| R8 | `INT` «T9 … diferencial» |
| R9 | `INT` «T4 R9» (o9 en C1 sin aportar; o4 sin comisión) y diferencial «T9» (≥10 negativos dentro del cierre de la orden); `U-BUS` «R8/R9» |
| R10 | `INT` «caja: sin el texto…» (la nota con la guía no sale; la búsqueda de texto sí la encuentra) y «tienda» (ajuste A); `U-SRV` «R2/R10…» |
| R11 | `INT` diferencial en caja (5 órdenes × todas las filas de cierre) y en tienda; mensajero (detalle del devengado lista o9) |
| R12 | `INT` «T9» (o1: contra-entrega y pago; o5: indemnización de cierre); `U-BUS` «R12/R13/R34» (recorre los tres catálogos) |
| R13 | `INT` «mensajero» (sin `pago_efectivo`); `U-BUS` «R12/R13/R34» |
| R14 | `INT` «caja» (cobro por rechazo y su IVA + indemnización por incidente de o1; NO el cobro de o2) y «tienda» (cobro en el libro de la tienda); `U-BUS` «R14» |
| R15 | `INT` «T9» (ids únicos); `U-BUS` «R7/R15» |
| R16 | `INT` «caja» (concepto, Entra/Sale, periodo) y «mensajero» (cierre) |
| R17 | `INT` «mensajero» y «tienda» (corrido de cada fila = el de la cuenta entera) |
| R18 | `INT` «mensajero» y «tienda» (tarjetas iguales); `U-SRV` «R18» (el resumen de la caja no resuelve) |
| R19 | `INT` «caja» (total = filas, páginas de 2 = lectura entera) y «tienda» |
| R20 | `INT` «caja» (asc = desc al revés, paginado) y «tienda» |
| R21/R23 | Servidor: `modoBusqueda` en las respuestas (`INT`, `U-SRV` «R23»). El aviso es de pantalla (T11/T12). |
| R22 | `INT` «caja» (guía de o11: modo guía, 0 filas, total 0); `U-BUS` «R2 … pares vacíos (R22)». El texto es de pantalla. |
| R24 | Pantalla (T11). |
| R25 | `INT` «T10» (o4 destacada desde la página 1 con pageSize 1); `U-SRV` «R29 … R25/R26/R27» |
| R26 | `INT` «T10» (en su página, solo ella `resaltada`); `U-SRV` |
| R27 | `INT` «T10» (aporte destacado = el de su fila en la lista entera); `U-SRV` |
| R28 | `INT` «T10» (sin `resaltar`: `destacadas: []`, nada resaltado); `U-SRV` «R28» ×2 |
| R29 | `INT` «T10» (tienda B con la guía de o1: nada; con la de o4: o4); `U-SRV` «R29…» |
| R30 | `INT` «T14» (caja, tienda, `/mi-wallet`, mensajero: hoja 1 = pantalla); `U-SRV` «R30» |
| R31 | `INT` «T14» (TOTAL GENERAL = «Total del periodo» en las cuatro superficies; más de un bloque en la caja) |
| R32 | `INT` «T14» (`kardex.conOtrosFiltros === true`) |
| R33 | `U-SRV` «R33: el forbidden no llega a resolver nada»; `U-ROOT` ×3 (los roots pasan el servicio real); `U-BUS` «mismo esquema que q» |
| R34 | Por construcción (`buildWhere` reutilizado) + diferencial R11 de `INT`; `U-BUS` «R12/R13/R34» |
| R35 | Pantalla (guardia de «SLA»). Este bloque no añade textos visibles. |
| R36 | `U-SRV` «R36: en la bodega satelite…» |

## Mutaciones (contra la integración, una a una, revertidas)

| Mutación | Resultado |
| --- | --- |
| `OrdenIdentificadaRepository.identificar` sin `tienda_id` | ROJO: «T3» y «tienda (oficina) y /mi-wallet» |
| `condicionPorGuiaSql` (caja) sin la categoría | ROJO: diferencial «T9 R8/R9/R11» |
| Caja: el servicio manda también `termino` y el repo hace `porGuia OR texto` | ROJO: «caja … R10» |
| `busquedaSql` (estado de cuenta) sin la categoría | ROJO: «mensajero» (sale `pago_efectivo`, R13) y «T14» |

No se ejecutó la mutación «filtro dentro de la ventana» (R17): cambiarla exige reescribir la CTE; R17 lo
afirma la aserción del corrido fila a fila.

## Desviaciones (técnicas, decididas)

1. **`WalletService` recibe la búsqueda como parámetro OPCIONAL** (design pedía no opcional): va detrás
   del opcional `comprobantes` y 58 construcciones de test no la pasan. Sin ella, `q` es texto (la 463).
   El fallo mudo «el root no la inyecta» lo cubre `U-ROOT`. `EstadoCuentaService` y
   `DetalleMovimientoService` sí la exigen.
2. **`OrdenDeDetalleDTO` aparte** en lugar de `resaltada` dentro de `OrdenAporteDTO`: el detalle
   COMPLETO (archivo) no resalta y sigue con `OrdenAporteDTO`.
3. **Guía = `^[1-9]\d{0,8}$`**: sin cero inicial (la guía visible es `String(num_guia)`) y ≤ 9 cifras
   (int4). Un término de 10 cifras solo se compara como remisión.
4. **Fixture de integración:** el cobro por rechazo y la indemnización por incidente se escriben con el
   origen exacto de `RechazoTiendaCobroService.aprobar` / `WalletIndemnizacionIncidenteFeedService`, no
   llamando a esos servicios (fechan en «ahora», fuera de la ventana 2037 del escenario de la 468). Las
   guías VIVAS se asignan en el test (la 468 solo congelaba la de `cierre_detail`).
5. **R14 en el mensajero:** los pares de una sola orden también viajan a su libro; hoy no tiene filas con
   esos orígenes (`cierre_dia | pago_mensajero | manual`), así que no cambia nada.
6. **T1 sin medir** (ver abajo).

## T1 — mediciones de producción

**MEDIDAS por el leader el 2026-10-02 (solo lectura, MCP de Supabase sobre producción):** (1) 5.695 filas de `cierre_detail`, 0 con guía distinta y 0 con remisión distinta de la orden viva: identificar por `orden` es correcto, no hace falta la rama `cierre_detail`. (2) `EXPLAIN ANALYZE` con una guía y una remisión reales: seq scan sobre 4.840 órdenes, **9,6 ms** (< 50 ms): sin índice nuevo. (3) máximo 2 órdenes por remisión.

Texto original del agente:

Este agente no tiene herramienta de solo lectura contra producción (el MCP de Supabase no estaba en su
conjunto). Producción está vacía desde el 2026-08-25, así que un cero sería «aún no ha pasado». Consultas
exactas para el humano/leader (solo lectura, MCP de Supabase sobre producción):

```sql
-- 1) ¿la copia congelada difiere de la orden viva? (decide identificar por `orden`)
SELECT count(*) AS filas,
       count(*) FILTER (WHERE cd.num_guia IS DISTINCT FROM o.num_guia) AS guia_distinta,
       count(*) FILTER (WHERE cd.num_remision <> o.num_remision)       AS remision_distinta
FROM cierre_detail cd JOIN orden o ON o.id = cd.orden_id;

-- 2) plan y tiempo de la identificación sin tienda (regla: sin índice nuevo si < 50 ms)
EXPLAIN ANALYZE
SELECT o.id, o.num_guia, o.num_remision FROM orden o
WHERE (o.num_guia = 123456 OR lower(o.num_remision) = lower('<una remisión real>'))
ORDER BY o.id;

-- 3) remisiones repetidas entre tiendas (cota de ramas)
SELECT max(n) FROM (SELECT count(*) n FROM orden GROUP BY lower(num_remision)) t;
```

Si (1) da diferencias > 0, hay que añadir la rama `cierre_detail` a la identificación (design §8 alt. 3).
Si (2) pasa de 50 ms, migración con índice `orden (lower(num_remision))`.

## Contratos para el frontend

- **Libro de la caja** — `listarMovimientosAction` (y `libroCajaKardexAction` /
  `libroCajaKardexConDetalleAction` para la descarga): mismo `q` de siempre. La respuesta `ok` trae
  `data.modoBusqueda?: "texto" | "guia"` (de `ModoBusquedaLibro`, `lib/types/busqueda-por-guia.ts`).
  **Ausente** si la lectura no llevaba `q`.
- **Estado de cuenta** — `verEstadoCuentaAction`, `verMiEstadoCuentaAction` (y sus kardex): `estado.modoBusqueda?`
  con la misma semántica. En la bodega satélite siempre `"texto"` (R36): su texto de ayuda NO nombra la guía.
- **Aviso R21 / vacío R22:** pintar solo con `modoBusqueda === "guia"` de la lectura PINTADA. Los textos
  no existen aún (T11).
- **Detalle de una fila** — entradas que ganan `resaltar?: string` (recortado, 3..máx de
  `lib/config/libro-wallet`, el mismo esquema que `q`):
  - `verDetalleDeMovimientoAction` (caja) y `verDetalleDeMiMovimientoAction` (`/mi-wallet`):
    `verDetalleDeMovimientoSchema`;
  - `verOrdenesDeFilaAction` (tienda y mensajero de la oficina): `ordenesDeFilaSchema`.
  - Los `…CompletoAction` del detalle NO aceptan `resaltar` (`.strict()` ⇒ `validation_error`).
  - Mandarlo SOLO si la última lectura del libro volvió con `modoBusqueda === "guia"` (R28).
- **Respuesta del detalle** (`DetalleMovimientoPayload`, `lib/types/detalle-movimiento.ts`):
  - `destacadas: OrdenAporteDTO[]` — todas las órdenes identificadas que aportan a ESA fila, con el mismo
    `aporte` (string escala 2) que su fila de la lista; `[]` sin `resaltar`, si el término no identifica
    nada en ese alcance o si la orden no aporta a ese concepto.
  - `ordenes: OrdenDeDetalleDTO[]` = `OrdenAporteDTO & { resaltada: boolean }` (texto accesible R26 es de
    pantalla).
  - Filas `sin_reparto` (incluidos cobro por rechazo e indemnización por incidente) no cambian.
- **Clave SWR del detalle:** incluir `resaltar ?? ""` (dos términos no comparten caché).

## Verificación

- `pnpm run typecheck`, `pnpm run lint` y `pnpm test` corren dentro del gate completo:
  `progress/gate_469_backend.log` (resultado abajo).

Gate completo `INIT_EXIT=0`: 2.378 archivos, **32.981 tests en verde, 26 skipped** (Analitica, preexistentes); sin rojos nuevos.

## Veredicto

Servidor terminado. Pendiente: parte de pantalla (tareas de frontend de tasks.md) sobre esta misma rama.
