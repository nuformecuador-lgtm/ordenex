# Ficha 469 — Diseño

> Amplía pantallas EXISTENTES (el libro de la caja, los estados de cuenta y el panel de detalle de una
> fila). No hay pantalla ni módulo nuevo, así que no pasa por `/design`.
>
> Búsqueda: grafo `R-job-singularis-projects-ordenex` (`search_graph`). El índice está rancio para esta zona
> (no devolvió `CierreAporteRepository.buildWhere`, `fuenteDeMovimiento` ni `condicionTerminoCajaSql`), así
> que cada símbolo citado se leyó en el archivo real de `dev` @ 4d5a9107. La rama de la 468 no está en
> disco: lo que viene de la 468 se cita de su spec aprobado (`specs/468-wallet-excel-kardex-por-guia/`).

## 0. Lo verificado en el código (2026-10-02)

| Hecho | Dónde |
| --- | --- |
| El criterio «esta orden aporta» tiene dos formas: el `WHERE` (`buildWhere`) y el predicado en memoria (`satisfaceCriterio`), atadas por el test de equivalencia de la 344 | `lib/repositories/CierreAporteRepository.ts:41-67`, `lib/utils/aporte-por-orden.ts:297-304`, `tests/unit/utils/aporte-por-orden-equivalencia.test.ts` |
| `satisfaceCriterio` no tiene consumidores de producción en la wallet (solo el test y `dinero-por-producto.ts`). El que usa el detalle es `buildWhere` | grep en `lib/` |
| `buildWhere(cierreId, criterio, tiendaId)` necesita el `cierreId` literal: la correlación `gestiones.some({ cierreId })` no se puede expresar en Prisma contra la fila padre | `CierreAporteRepository.ts:56-64` |
| El lote de la 464 ya compone `buildWhere` con un `OR` de ramas (`whereDelLote`) | `CierreAporteRepository.ts:108-110` |
| `criterioDeFuente` + `fuenteDeMovimiento` deciden si un movimiento se reparte: concepto con criterio Y `origen_tipo = 'cierre_dia'` | `aporte-por-orden.ts:307-344` |
| Catálogos `FUENTE_CAJA`, `FUENTE_TIENDA`, `FUENTE_MENSAJERO`, `Record` totales. La 468 añade `snapshot_gestion` y dos criterios (`CRITERIO_PAGO_MENSAJERO`, `CRITERIO_INDEMNIZACION`) | `aporte-por-orden.ts:56-157`; 468 `design.md §2` |
| El detalle de una fila lista las órdenes con `listarOrdenesQueAportan({ cierreId, criterio, tiendaId, rango })` y deriva cada aporte con `aporteDeOrden` | `lib/services/DetalleMovimientoService.ts:228-274` |
| El término de la caja va en `whereLibroCajaConTerminoSql` → `condicionTerminoCajaSql` (descripción, anotación, registrador) | `lib/repositories/libro-caja-a-quien-sql.ts:299-328` |
| `WalletMovimientoRepository.listar` usa el camino SQL cuando hay término o «A quién»; el conteo usa el mismo `WHERE` | `WalletMovimientoRepository.ts:266-314` |
| Estado de cuenta: el término (`terminoSql`) y el chip (`filtroDeChip`, «lista cerrada calculada por el servicio») van en el `WHERE` EXTERIOR, después de la ventana del saldo corrido | `lib/repositories/EstadoCuentaRepository.ts:83-106`, `:279-301` |
| `VentanaDeLibro` = `{ desdeUtc, hastaUtc, pares, cierreId, termino, sortDir, conNombreRegistrador, … }` | `lib/interfaces/repositories/IEstadoCuentaRepository.ts:25-55` |
| Movimientos de una sola orden: el cobro por rechazo (y su anulación) lleva `origen_tipo = 'gestion_orden'`, `origen_id = <gestionId>` en los dos libros; la indemnización por incidente, `origen_tipo = 'orden_incidente'` | `lib/services/RechazoTiendaCobroService.ts:192-196`, `CajaRechazoTiendaCobroFeedService.ts:28-35`, `WalletIndemnizacionIncidenteFeedService.ts:53` |
| `libro-caja-a-quien-sql.ts` ya une `orden_incidente` → `orden` y `rechazo_tienda_cobro` → `gestion_id` | `libro-caja-a-quien-sql.ts:72-89` |
| `orden.num_guia` es `Int? @unique` (índice único). `num_remision` es único POR TIENDA entre vivas: índice parcial `(tienda_id, num_remision) WHERE deleted_at IS NULL`; sin índice suelto por remisión | `db/schema.prisma:682-683`, `:831-875` |
| `cierre_detail` congela `num_guia` y `num_remision` sin índice; sí tiene `@@index([ordenId])` y `@@unique([cierreId, ordenId])` | `db/schema.prisma:2769-2795` |
| El panel de detalle manda solo `movimientoId` y `page`; su clave SWR es `[prefijo, movimientoId, page]` | `app/(app)/wallet/_components/DetalleMovimientoCierre.tsx:77-110` |
| Textos de ayuda del buscador | `app/(app)/wallet/_components/libro-caja-labels.ts:80`, `components/shared/estado-cuenta/estado-cuenta-labels.ts:173-174` |
| `BUSQUEDA_LIBRO_MIN_CHARS = 3` | `lib/config/libro-wallet.ts:12` |

## 1. Modelo de datos

**Sin migraciones, sin tablas, sin RLS nueva.** Índices: **ninguno a priori**; se decide con la medición de
T1 (§7). Todo sale de `orden`, `cierre_detail`, `gestion_orden`, `orden_incidente`, `rechazo_tienda_cobro`
y los tres libros.

`lib/types/` cambia (contratos de borde y DTO). El modo rápido del gate se negará: **el gate de esta ficha es
`./init.sh` completo**.

## 2. Cómo se resuelve una búsqueda por guía (servidor)

Tres pasos, en un servicio nuevo `BusquedaPorGuiaService` (`lib/services/BusquedaPorGuiaService.ts`), que
usan igual la lectura paginada, la descarga y el detalle.

### 2.1 Paso 1 — identificar las órdenes (R2–R7)

Repositorio nuevo `IOrdenIdentificadaRepository.identificar({ termino, tiendaId? })` →
`{ ordenId, numGuia, numRemision }[]`:

```sql
SELECT o.id, o.num_guia, o.num_remision FROM orden o
WHERE ( o.num_guia = $guia               -- solo si el término es todo cifras y cabe en int4
        OR lower(o.num_remision) = lower($termino) )
  [AND o.tienda_id = $tiendaId]          -- AL FINAL, en tienda y /mi-wallet (R5)
```

- `$guia`: el término si casa con `^\d{1,9}$` (int4 sin desbordar); si no, esa rama no se escribe. Igualdad
  completa: «123» no es la guía 1234 (R3). La remisión, igualdad sin mayúsculas (R4).
- Se identifica por la **orden viva** (`orden`), no por la copia de `cierre_detail`. La guía la asigna una
  secuencia y no cambia; la remisión solo cambiaría si alguien la editara después de un cierre. T1 mide que
  no hay ninguna `cierre_detail` cuya guía o remisión congelada difiera de la de su orden; si hubiera, se
  añade la rama `cierre_detail` al `OR` (§8, alternativa 3) antes de implementar.
- Las órdenes borradas (`deleted_at`) cuentan: un cierre puede haber congelado una orden que después se
  borró y su dinero sigue en el libro.
- En la tienda y en `/mi-wallet`, `tiendaId` sale de la CUENTA del input validado (oficina) o del ACTOR
  (`/mi-wallet`), nunca de un campo libre. Sin órdenes identificadas en ese alcance → búsqueda de texto
  (R5, R6): la respuesta es byte a byte la de la 463, así que la existencia de una guía ajena no se filtra.

### 2.2 Paso 2 — los movimientos repartibles a los que aportan (R8–R13, R34)

**El criterio NO se escribe otra vez.** Se reutiliza la forma `WHERE` (`buildWhere`), la misma que lista
las órdenes del detalle, y el catálogo vigente decide qué conceptos entran:

1. Pares candidatos: `cierre_detail.findMany({ where: { ordenId: { in: ids } [, tiendaId] }, select:
   { cierreId, ordenId } })` (usa `@@index([ordenId])`).
2. Del catálogo de la superficie (`FUENTE_CAJA` / `FUENTE_TIENDA` / `FUENTE_MENSAJERO`) se toman las
   categorías con `criterioDeFuente(fuente) !== null` y se agrupan por criterio (identidad del objeto: flete
   e IVA de flete comparten uno, etc.). **No hay ninguna lista de conceptos escrita en esta ficha**: cuando
   la 468 cambie el catálogo, la búsqueda lo hereda (R12); y `pago_efectivo`, que sigue `sin_reparto`, queda
   fuera solo (R13).
3. Por cada criterio, método nuevo de `CierreAporteRepository`:

   ```ts
   /** Ficha 469 — los cierres (de los pares dados) en los que ESA orden casa con el criterio. */
   async cierresDondeAporta(f: { pares: readonly { cierreId: string; ordenId: string }[];
                                 criterio: CriterioDeAporte; tiendaId?: string }): Promise<Array<{ cierreId: string; ordenId: string }>>
   // where: { OR: pares.map(p => ({ AND: [buildWhere(p.cierreId, f.criterio, f.tiendaId), { ordenId: p.ordenId }] })) }
   ```

   Es `whereDelLote` con la orden fijada en cada rama. `ordenId` es un acotamiento (como `tiendaId`), no una
   condición del criterio, y va en un `AND` aparte para no tocar `buildWhere`.
4. Salida: la lista cerrada `ParDeGuia = { categoria, origenTipo: "cierre_dia", origenId: cierreId }` por
   cada categoría del grupo y cada cierre devuelto. `origen_tipo = 'cierre_dia'` replica la misma condición
   que `fuenteDeMovimiento` (un ajuste con la misma categoría no se reparte y no sale).

Con eso, R11 (fila sale ⇔ su detalle lista la orden) se cumple por construcción: el detalle de esa fila
ejecuta `buildWhere(cierreId, criterio, tiendaId)` y lista exactamente las órdenes que aquí casan. Lo afirma
el test diferencial de T9.

Coste: tantas consultas como criterios distintos tenga el catálogo (6 en la caja con la 468, 3 en la tienda,
1 en el mensajero), en `Promise.all`, cada una acotada por `cierre_id` (índice único) y por pocas ramas (una
orden aparece en pocos cierres). Si T1 mide un término con muchas ramas (una remisión repetida en muchas
tiendas), se mide y se anota; no se cambia el diseño sin número.

### 2.3 Paso 3 — los movimientos de una sola orden (R14, pregunta abierta 1)

Solo si el humano confirma la propuesta por defecto:

- `gestion_orden`: `ParDeGuia { origenTipo: "gestion_orden", origenId }` por cada gestión de una orden
  identificada que tenga un `rechazo_tienda_cobro` (`gestion_id`). Sin categoría: cuenta cualquier categoría
  con ese origen (el cobro y su anulación, en los dos libros).
- `orden_incidente`: `ParDeGuia { origenTipo: "orden_incidente", origenId }` por cada incidente de una orden
  identificada. Solo existe en la caja.

No hay dinero en este paso: se compara el origen de la fila con un id, igual que «A quién».

### 2.4 Resultado del servicio

```ts
// lib/types/busqueda-por-guia.ts (NUEVO)
export type ParDeGuia =
  | { origenTipo: "cierre_dia"; origenId: string; categoria: string }
  | { origenTipo: "gestion_orden" | "orden_incidente"; origenId: string };   // categoría libre
export type BusquedaResuelta =
  | { modo: "texto"; termino: string }
  | { modo: "guia"; termino: string; ordenIds: string[]; pares: ParDeGuia[] };  // pares puede ir vacío (R22)
```

`ordenIds` no viaja al cliente (lo usa el detalle, §4). Al cliente le llega solo `modoBusqueda: "texto" |
"guia"` (R21/R23).

## 3. Aplicarlo al libro (R16–R20)

### 3.1 Caja

`whereLibroCajaConTerminoSql` gana una tercera entrada excluyente con `termino`:

```ts
f: FiltrosComunesSql & { aQuien?: AQuienFiltro; termino?: string; porGuia?: readonly ParDeGuia[] }
```

- `porGuia` presente ⇒ en lugar de `condicionTerminoCajaSql` (R10: exclusivo) se añade
  `condicionPorGuiaSql(pares)`: un `OR` de `(w.origen_tipo::text = $o AND w.origen_id = $id [AND
  w.categoria::text = $c])`; lista vacía ⇒ `FALSE` (molde `filtroDeChip` / `categorias: []`).
- Los demás filtros siguen en `AND` (R16) y `listar` usa el camino SQL también con `porGuia`. El conteo
  usa el mismo `WHERE` (R19) y el orden total no cambia (R20).
- `agregarPorCategoriaYTipo` y el resumen no reciben `porGuia` (no está en su tipo): R18. Es la separación
  de esquemas de la 463 (`listarMovimientosSchema` sigue `.strict()` sin `q`).
- Kardex de la 468: el saldo por fila sale de `saldosTrasMovimientos(ids, …)` sobre la caja entera y el
  inicial y el final, de `derivarCaja`: no dependen del filtro. `conOtrosFiltros` ya es verdadero con
  término (468 §3.4), así que sale el aviso de R16 de la 468 (R32).

### 3.2 Estado de cuenta (tienda, mensajero, `/mi-wallet`)

`VentanaDeLibro` gana `porGuia?: readonly ParDeGuia[]`, excluyente con `termino`. `terminoSql` pasa a
`busquedaSql(v)`:

- `porGuia` ⇒ ` AND (` OR de pares sobre `l.origen_tipo`, `l.origen_id`, `l.categoria` `)`; vacío ⇒
  ` AND FALSE`.
- Va en el `WHERE` EXTERIOR, después de la ventana, como el chip y el término: el saldo corrido de cada fila
  no cambia (R17). El `count(*)` usa el mismo `WHERE` (R19).
- `paginaDeBodega` no recibe `porGuia` (R36): el servicio no lo resuelve para la bodega.

### 3.3 Servicios

- `WalletService.listar` / `listarCompleto` y `EstadoCuentaService.leerCuenta` / `leerCompleto` /
  `leerMiTienda*`: si llega `q`, llaman a `BusquedaPorGuiaService.resolver({ termino: q, superficie,
  tiendaId? })` y pasan al repositorio `termino` (modo texto) o `porGuia` (modo guía). Devuelven
  `modoBusqueda`.
- Las tarjetas, la comprobación R22 de la 458-B y los totales del periodo no ven ni `termino` ni `porGuia`
  (ya es así con el término, 463 §4).
- La resolución corre fuera de la lectura consistente del estado de cuenta. Si un cierre se aprueba entre
  la resolución y la página, su movimiento aparece en la siguiente lectura; no hay descuadre posible porque
  el saldo corrido no depende del filtro.
- **Inyección:** `BusquedaPorGuiaService` es dependencia NO opcional de los dos servicios, y el test de cada
  acción afirma que el composition root la pasa (memoria «composition root que no inyecta»).

### 3.4 Descarga (R30–R32)

La descarga ya reutiliza el input del libro (463/467/468). Con el mismo `q`, el completo resuelve igual y
la hoja «Movimientos» trae las mismas filas (R30). El orquestador de la 468 (`CajaConDetalleService`,
`EstadoCuentaConDetalleService`) recibe esas filas y agrupa por guía con sus reglas: bloques de todas las
guías que aportan a esos movimientos y TOTAL GENERAL = «Total del periodo» (R31). **No se toca
`agruparPorGuia`.**

## 4. La guía resaltada en el detalle (R25–R29)

### 4.1 Contrato

- Entradas del detalle (`VerDetalleDeMovimientoInput`, `OrdenesDeFilaInput` y la de `/mi-wallet`) ganan
  `resaltar: terminoLibroSchema.optional()` (mismo esquema que `q`).
- `DetalleMovimientoPayload` gana `destacadas: OrdenAporteDTO[]` (vacío si no hay búsqueda por guía), y
  `OrdenAporteDTO` gana `resaltada: boolean`.

### 4.2 Servidor (`DetalleMovimientoService.resolverConjunto`)

Tras el guard y la lectura del movimiento (sin cambios de orden):

1. Si llega `resaltar`, `BusquedaPorGuiaService.identificar({ termino, tiendaId })` con el MISMO `tiendaId`
   que ya acota el detalle (R29). Modo texto ⇒ `destacadas: []` y nada resaltado (R28).
2. `destacadas` = `listarOrdenesQueAportan({ cierreId, criterio, tiendaId, rango, ordenIds })`: el método
   de siempre con un acotamiento opcional `ordenIds` (un `AND` aparte, como en §2.2). El aporte se deriva
   con el mismo `aporteDeOrden` y el mismo mapeo a `OrdenAporteDTO`: R27 por construcción.
3. En la página, `resaltada = ordenIds.includes(fila.ordenId)`.
4. Sin reparto (incluidos los movimientos de una sola orden) ⇒ sin cambios: el panel dice su motivo.

### 4.3 Pantalla (`DetalleMovimientoCierre` y el panel de `/mi-wallet`)

- `FuenteDetalleMovimiento.leer(movimientoId, page, resaltar?)`. La clave SWR gana `resaltar`
  (`[prefijo, movimientoId, page, resaltar ?? ""]`): dos búsquedas no comparten caché.
- Los consumidores (`WalletLedger`, `EstadoCuenta`, `MiEstadoCuenta`) pasan `resaltar` SOLO cuando la última
  lectura del libro volvió con `modoBusqueda === "guia"`; en modo texto no se manda (R28).
- Bloque «Guía buscada» encima de la tabla: una fila por destacada, con guía, destinatario, resultado y
  aporte (`money`, sin operar). Filas resaltadas en la lista con fondo y un texto accesible «Guía buscada»
  (no solo color, R26).

## 5. Pantalla del libro (R21–R24)

- Aviso (R21) y vacío (R22) en `libro-caja-labels.ts` y `estado-cuenta-labels.ts`, pintados solo con
  `modoBusqueda === "guia"` de la lectura PINTADA (no de la pedida: regla R49 de la 463).
- Textos de ayuda (R24):
  - caja: «Buscar por guía, remisión, descripción, nombre o referencia anotada, o quién registró»;
  - oficina (tienda y mensajero): «Buscar por guía, remisión, descripción o quién registró»;
  - `/mi-wallet`: «Buscar por guía, remisión o descripción»;
  - satélite: se queda «Buscar por descripción o quién registró» (R36). Hoy la satélite comparte el texto
    «oficina»: se separa en una clave propia.

## 6. Contratos de borde

- `listarLibroCajaSchema` y `filtrosDelExtracto` no cambian: `q` ya existe. Lo nuevo viaja en la RESPUESTA
  (`modoBusqueda`).
- Las entradas del detalle ganan `resaltar` (§4.1). Siguen `.strict()`.

## 7. Mediciones (T1, solo lectura, MCP de Supabase sobre producción)

1. Guía y remisión congeladas frente a las vivas (decide §2.1):
   ```sql
   SELECT count(*) AS filas,
          count(*) FILTER (WHERE cd.num_guia IS DISTINCT FROM o.num_guia) AS guia_distinta,
          count(*) FILTER (WHERE cd.num_remision <> o.num_remision)       AS remision_distinta
   FROM cierre_detail cd JOIN orden o ON o.id = cd.orden_id;
   ```
2. Plan y tiempo de la identificación sin tienda (la rama de remisión no tiene índice suelto):
   `EXPLAIN ANALYZE` de la consulta de §2.1 con una remisión real. Regla: **sin índice nuevo** si tarda menos
   de 50 ms; si no, se añade `orden (lower(num_remision))` en esta ficha con su migración.
3. Remisiones repetidas entre tiendas (cota de ramas de §2.2):
   `SELECT max(n) FROM (SELECT count(*) n FROM orden GROUP BY lower(num_remision)) t;`

Producción está vacía desde el 2026-08-25: un cero es «aún no ha pasado». Se anota en `progress/` con fecha.

## 8. Alternativas descartadas

1. **Buscar a la vez texto Y guía (`OR`).** Descartada. Las guías son números de secuencia: la guía «2026»
   casaría con toda descripción que lleve el año y devolvería medio libro, justo lo que el humano rechazó
   («no todos los movimientos»). La búsqueda por guía es exclusiva, y el aviso (R21) hace visible el modo.
2. **Reescribir el criterio en SQL dentro del `WHERE` del libro** (un `EXISTS` sobre `cierre_detail` y
   `gestion_orden` por concepto). Descartada: sería la tercera forma del criterio, sin test de equivalencia,
   y prohibida por R18/R46 de la 344. Se resuelve en el servicio con `buildWhere` y se pasa una lista
   cerrada, el patrón ya vivo de `filtroDeChip`.
3. **Identificar la orden por la copia congelada de `cierre_detail`.** Descartada a priori: `cierre_detail`
   no tiene índice por guía ni por remisión y la guía no cambia. Se reabre solo si T1 mide diferencias.
4. **Usar el predicado en memoria (`satisfaceCriterio`)** leyendo los hechos de cada par. Descartada:
   obligaría a reconstruir en producción los hechos por gestión (hoy nadie lo hace en la wallet) y a repetir
   el «alguna gestión de este cierre» que el `WHERE` ya expresa con `some`. La forma `WHERE` es la que usa
   el detalle, así que R11 sale por construcción.
5. **Un control aparte «Buscar guía» en la barra.** Descartada: el humano pidió el mismo buscador (467) y
   la barra ya va justa de ancho en una línea (R4 de la 467).
6. **Abrir el detalle en la página donde cae la guía** en lugar de destacarla arriba. Descartada: con dos
   órdenes identificadas (pregunta abierta 3) no hay una sola página, y el bloque destacado se lee sin
   paginar.

## 9. Riesgos y cómo se cubren

| Riesgo | Cobertura |
| --- | --- |
| El `WHERE` nuevo probado solo con dobles | Integración contra Postgres de `cierresDondeAporta` y del filtro del libro (T9), con mutaciones «sin criterio» (todas las ramas casan) y «sin `tiendaId`», que deben ponerlo rojo |
| La búsqueda y el detalle dicen cosas distintas | Test diferencial: para cada movimiento repartible del fixture, «sale en la búsqueda» ⇔ «su detalle lista la orden» (R11) |
| Saldo corrido alterado por el filtro | Integración: los `saldoCorrido` de las filas encontradas son iguales a los de las mismas filas sin búsqueda (R17) |
| Fuga entre tiendas | Integración: en `/mi-wallet`, una guía de otra tienda devuelve lo mismo que un texto ausente, y `resaltar` con esa guía deja `destacadas: []` (R5, R29) |
| Test de integración verde sin datos | Cada test afirma primero que el fixture tiene las filas que espera (N > 0 por tipo) |
| La 468 cambia el catálogo antes de mergear | La búsqueda no lista conceptos: deriva del catálogo. Un test recorre el catálogo de cada superficie y afirma que toda categoría con criterio entra en la resolución (R12) |
| Composition root que no inyecta | Test de cada acción: el servicio recibe `BusquedaPorGuiaService` real |
| Choque con la 468 en los mismos archivos | La 469 se implementa sobre `dev` con la 468 ya mergeada (T0). No se lanza en paralelo con ella |
| Base local compartida | Sin migraciones salvo que T1 pida el índice; si lo pide, se avisa antes de migrar |
