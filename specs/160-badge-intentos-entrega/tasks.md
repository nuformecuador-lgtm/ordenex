# Feature 160 — Tasks

Checklist verificable. `[P]` = paralelizable con las tareas del MISMO bloque.
Cada task lleva su criterio de "hecho" y los `R<n>` que cubre.

Zona `fullstack`: la implementación se secuencia **backend (bloques 1–3) →
frontend (bloques 5–7)**; ninguna task de frontend arranca antes de que el gate
del bloque 4 esté verde.

**Sin migración en toda la feature.** Si alguna task obliga a tocar
`db/schema.prisma` o a crear un índice, es señal de que el diseño se torció (R7):
se detiene y se escala como decisión, no se añade por cuenta propia.

> **La puerta F1.4-bis está CERRADA** (2026-07-29): QA1 resuelta por medición
> (opción (a), sin mitigación), QA2 desaparecida por dependencia y QA3 resuelta
> con la derogación de R2/R11 de la feature 148. **No queda ningún bloqueante
> abierto**, así que la implementación arranca de una. Lo único que sobrevive de
> la puerta es la **re-medición previa al despliegue** (T24.1), que es obligatoria.

---

## Bloque 1 — Backend · el criterio y su derivador

- [ ] **T1. Declarar la familia admitida por la rama B, verificando el mapa v2.**
  - En `lib/types/orden-historial.ts`: `ORIGEN_TIPOS_REPROGRAMADA_INTENTO =
    ["gestion"]` con `satisfies readonly OrdenHistorialOrigenTipo[]` y el
    comentario que explica por qué es lista de INCLUSIÓN y por qué
    `reprogramacion_tienda` queda fuera (design §1.2/§1.3).
  - **Verificar contra el mapa de la feature 154 ya mergeada** (catálogo 18 → 20):
    que sigan existiendo **exactamente dos** aristas con destino `reprogramada`
    (`#13` familia `gestion`, `#22` familia `reprogramacion_tienda`) y que
    `incidente` siga **sin salidas**. Si el mapa v2 introdujo una tercera arista a
    `reprogramada`, se para y se escala: el criterio cambia.
  - **Corregir en el mismo commit** los bloques de comentario de las features
    99/100/109/138/139 de ese archivo que hoy afirman "destino != `devuelta` → no
    altera `contarIntentos`": la conclusión sigue siendo cierta, pero la razón
    cambió y el comentario tiene que decirlo.
  - **Hecho:** `tsc` verde; unit tests que afirman (a) `reprogramacion_tienda` NO
    está en la constante y `gestion` sí; (b) el mapa de transiciones tiene 2
    aristas a `reprogramada` y `incidente` 0 salidas. (R1, R2, R3)

- [ ] **T2. Predicado único `whereIntentosVigentes` + renombre del conteo
      individual.** (depende de T1)
  - En `lib/repositories/OrdenHistorialRepository.ts`: función pura
    `whereIntentosVigentes(ordenId, criterio)` que acepta `string` o
    `{ in: string[] }` y compone el `OR` de destinos (rama A + rama B, esta última
    omitida si `criterio.reprogramadaId === null`) con el `OR` de VIGENCIA
    **idéntico al de hoy**.
  - `contarPorDestinoVigentes(ordenId, estatusDestinoId)` → **renombrar** a
    `contarIntentosVigentes(ordenId, criterio)` en la implementación y en
    `lib/interfaces/repositories/IOrdenHistorialRepository.ts`, con su
    documentación actualizada (design §3.3).
  - **Hecho:** unit tests verdes que afirman, con el mismo doble de Prisma:
    (a) fila `devuelta` cuenta; (b) fila `reprogramada` + `gestion` cuenta;
    (c) fila `reprogramada` + `reprogramacion_tienda` **no** cuenta;
    (d) escenario "1 devuelta + 1 reprogramación de tienda" → **1**, no 2;
    (e) gestión anulada no cuenta en NINGUNA de las dos ramas;
    (f) fila huérfana no cuenta; (g) fila sin gestión (`ajuste_estado` →
    `devuelta`) sigue contando; (h) destino `incidente` no altera el conteo.
    (R1, R2, R3, R5)

- [ ] **T3. Conteo EN LOTE `contarIntentosVigentesEnLote`.** (depende de T2)
  - Firma: `(ordenIds: string[], criterio: CriterioIntento) =>
    Promise<Map<string, number>>`, documentada (órdenes sin filas ausentes del
    Map; `ids` vacío → Map vacío **sin query**).
  - Implementación con `groupBy({ by: ["ordenId"], where:
    whereIntentosVigentes({ in: ids }, criterio), _count: { _all: true } })`;
    fallback admitido: `findMany({ select: { ordenId: true }, where: <el MISMO
    predicado> })` + conteo en memoria (design §3.3). Guarda temprana
    `ids.length === 0` (patrón `findMensajerosBloqueados`).
  - Los dobles de Prisma de la suite del repo ganan `groupBy`.
  - **Hecho:** unit tests verdes: (a) con N ids el doble de Prisma recibe
    **exactamente 1** llamada; (b) `ids = []` → **0** llamadas y Map vacío;
    (c) el `where` usado es el MISMO que produce `whereIntentosVigentes`;
    (d) para una misma orden, individual y lote coinciden en los 8 escenarios de
    T2. (R4, R12, R13)

- [ ] **T4. `OrdenHistorialService`: criterio resuelto una vez + versión en
      lote.** (depende de T3)
  - `ESTATUS_REPROGRAMADA` junto a `ESTATUS_DEVUELTA`; privado
    `resolverCriterio()` que resuelve los DOS ids con un solo `Promise.all` y
    devuelve `null` si falta `devuelta`.
  - `contarIntentos(ordenId)` **conserva su firma** (features 47/99 la consumen) y
    delega en `contarIntentosVigentes(ordenId, criterio)`.
  - Nuevo `contarIntentosEnLote(ordenIds)` en `IOrdenHistorialService` y su
    implementación.
  - **Hecho:** unit tests verdes: (a) catálogo sin `devuelta` → `0` / Map vacío,
    sin llamar al repo y sin excepción; (b) con `devuelta` y sin `reprogramada` →
    solo rama A, sin excepción; (c) los dos ids resueltos viajan tal cual al repo;
    (d) el catálogo se lee **una** vez por llamada, no por orden. (R4, R6, R12)

---

## Bloque 2 — Backend · el escalado (DINERO)

> QA1 quedó resuelta como opción (a) **por medición** (`design.md §4.4`): 0
> órdenes saltan el umbral hoy. Este bloque ya no está bloqueado, pero **sigue
> siendo el que mueve dinero**: sus tests son los más importantes de la feature.

- [ ] **T5. Aserciones del cambio de escalado en `DevolucionSlaService`.**
      (depende de T4)
  - **No se toca `DevolucionSlaService.ts`**: consume `contarIntentos`, que ya
    devuelve el número nuevo. Lo que se escribe son los tests que fijan el
    comportamiento, más el comentario de `:109` (`"Q4: contarIntentos YA incluye la
    devolución vigente"`), que debe pasar a decir también qué reprogramaciones
    incluye.
  - **Hecho:** unit tests verdes: (a) orden `not_found` con 2 reprogramaciones de
    mensajero vigentes + 1 devuelta y umbral 3 → **escala a `rechazada`** (hoy
    liberaría); (b) la misma orden con las reprogramaciones ANULADAS → libera;
    (c) orden con 1 reprogramación **de la tienda** + 1 devuelta → libera (sin
    doble conteo); (d) `wrong_number`/`wrong_address` escalan directo **sin llamar
    a `contarIntentos`** (la aserción de "no llamado" ya existe en
    `tests/unit/services/devolucion-sla-service.test.ts:157`); (e) causa `null` se
    omite; (f) el resto de la suite del cron verde sin cambios de aserción.
    (R8, R9)

- [ ] **T6. `[P]` Aserciones del drawer de historial.** (depende de T4)
  - `obtenerHistorial` no cambia de forma; cambia el número que devuelve.
  - **Hecho:** unit test verde: una orden con reprogramación de mensajero reporta
    el conteo ampliado en `intentos`, y el `umbral` sigue viajando igual. Suite de
    la feature 47 verde con las aserciones actualizadas **de forma explícita**
    (nunca "ajustar hasta que pase"). (R10)

---

## Bloque 3 — Backend · exposición en lote (depende de T4)

- [ ] **T7. Campo de conteo en los DTO.**
  - `intentosEntrega?: number` (aditivo, opcional, con el comentario del patrón)
    en: `OrdenListItemDTO` (`lib/types/orden.ts`), `MiAsignacionDTO`
    (`IMisAsignacionesService.ts`), `RecepcionSateliteDTO`
    (`IRecepcionSateliteService.ts`), `NovedadDTO` (`lib/types/novedad.ts`),
    `RechazoSlaTiendaDTO` (`lib/types/rechazo-sla-tienda.ts`), `LiberadaHoyRow`
    (`ILiberacionReprogramadaRepository.ts`).
  - `ManifiestoFilaDTO` gana `intentos: number` **no opcional** — se escribe en el
    Bloque 7 junto con su columna.
  - `OrdenDTO`, `ApiOrdenListItemDTO`, `ApiOrdenDetalleDTO` y `EtiquetaGuiaDTO`
    **no** se tocan.
  - **Hecho:** `tsc` verde y ningún fixture/mock existente roto (campo opcional).
    Un test afirma que los DTO excluidos NO tienen el campo. (R16, R30, R31)

- [ ] **T8. `[P]` Merge en `OrdenService.listar`.** (depende de T7)
- [ ] **T9. `[P]` Merge en `MisAsignacionesService.listarMisAsignaciones`.**
- [ ] **T10. `[P]` Merge en `RecepcionSateliteService.listar`.**
- [ ] **T11. `[P]` Merge en `NovedadesService`.**
- [ ] **T12. `[P]` Merge en `RechazosSlaTiendaService`.**
- [ ] **T13. `[P]` Merge en `LiberacionReprogramadaService` (liberadas hoy).**

  Las seis comparten forma y criterio de hecho:
  - Dependencia nueva **requerida** de constructor:
    `Pick<IOrdenHistorialService, "contarIntentosEnLote">` (import **type-only**,
    sin ciclo). Actualizar el wiring de la Server Action correspondiente y los
    dobles de las suites afectadas.
  - Merge tras la consulta propia, sobre los items **ya acotados por
    rol/zona/tienda**: `intentosEntrega: mapa.get(id) ?? 0`.
  - **T10 en particular:** un ÚNICO lote con la unión de los ids de los CINCO
    grupos (por recibir, recibidas, por devolver, en tránsito, devueltas). Cinco
    llamadas serían un incumplimiento de R12.
  - **Hecho (cada una):** unit tests verdes: (a) los items salen con
    `intentosEntrega` numérico, `0` incluido; (b) los ids del lote son EXACTAMENTE
    los ya acotados por el alcance del actor; (c) resultado vacío → 0 llamadas al
    historial; (d) **exactamente 1** llamada al lote por listado; (e) el resto de
    la suite del servicio verde sin cambios de aserción.
    (R11, R12, R13, R14, R15, R32)

---

## Bloque 4 — Gate de fin de fase backend

- [ ] **T14. Gate backend.** (depende de T5, T6, T8–T13)
  - **Hecho:** `./init.sh` verde + suite completa verde + `git diff` **sin**
    cambios en `db/schema.prisma` ni `db/migrations/`. Recién aquí arranca el
    frontend. (R7, R32)

---

## Bloque 5 — Frontend · la pieza compartida (depende de T14)

- [ ] **T15. `components/shared/intentos-entrega.tsx`.**
  - Módulo único con las DOS formas de presentación del mismo dato (design §5.1):
    `INTENTOS_COLUMN_ID`, `INTENTOS_LABEL`, `valorIntentos(row)` (pura, `?? 0`),
    `columnaIntentos<T>()` (definición de `Column<T>` genérica, sirve a
    `OrdenListItemDTO` y a `RecepcionSateliteDTO`) e `IntentosDato` (dato
    etiquetado "Intentos: N" para cards, listas y diálogos).
  - **Sin "de N"** (R20). Énfasis tipográfico con `>= 1` que es **redundante**:
    el número es el portador de la información, nunca el color.
  - **No se crea** `IntentosEntregaBadge` ni `conChipIntentos`: el diseño de chip
    quedó descartado por D6 (design §7.6).
  - **Hecho:** component tests verdes: (a) `valorIntentos` devuelve `0` con campo
    ausente y con `0`; (b) la columna expone `id = "intentos"` y encabezado
    "Intentos"; (c) `IntentosDato` renderiza la etiqueta y el número; (d) con `0`
    **se renderiza igual** (no devuelve `null`); (e) grep de contrato: el umbral no
    aparece en el módulo. (R17, R18, R19, R20)

---

## Bloque 6 — Frontend · superficies (dependen de T15; `[P]` entre sí)

- [ ] **T16. `[P]` Columna en el listado de órdenes y sus 3 variantes.**
  - Insertar `columnaIntentos<OrdenListItemDTO>()` en `ordenesColumns`
    (`app/(app)/ordenes/_components/ordenes-columns.tsx`) **inmediatamente después
    de la columna `estatus`** (design §5.2). `ordenesColumnsAdminTienda` y
    `ordenesColumnsReprogramada` la heredan por composición;
    `OrdenesApartado` la reusa tal cual.
  - **Hecho:** component tests verdes: (a) existe un `columnheader` "Intentos";
    (b) fila con `2` muestra `2`, fila con `0` y fila con el campo ausente muestran
    `0` (nunca celda vacía ni `—`); (c) el número **no** aparece dentro de la celda
    de estado; (d) ids, encabezados y orden relativo de las 18 columnas
    preexistentes intactos; (e) los tres asserts de
    `tests/unit/components/ordenes-columns.test.tsx:113-117` siguen verdes **sin
    tocarlos**; (f) la columna aparece en el dashboard del adminTienda y en los
    apartados del maestro sin tocar esos archivos. (R17, R19, R21, R22, R32)

- [ ] **T17. `[P]` Dato etiquetado en los diálogos de acción por lote.**
  - `IntentosDato` junto a cada `<li>` de la lista de órdenes seleccionadas en
    `GenerarGuiaModal`, `AsignarBodegaModal`, `RutearSateliteModal`,
    `EtiquetasGuiaModal`, `RecuperarABodegaModal` y `DevolverATiendaModal`. El dato
    ya viaja en el `OrdenListItemDTO` de la selección: es solo pintar.
  - **Hecho:** component tests verdes por diálogo: con `2` y con `0` el dato se
    muestra en ambos casos, con el mismo markup que el resto de la línea. (R18,
    R19, R23)

- [ ] **T18. `[P]` Dato etiquetado en el portal del mensajero.**
  - `pos-card/PosOrderCard.tsx`: el dato en el bloque de campos de la card, con el
    mismo tratamiento que Destinatario/Producto — **no** en la fila de marcas
    informativas (líneas 71-84), que es donde viven "Pendiente de optimizar" y
    "Gestionar más tarde": esas son marcas de excepción, y D6 dice que los
    intentos son un dato.
  - `AsignacionDetalle.tsx`: el dato como un campo más del detalle, que es lo que
    ve el mensajero en "por recoger" (vía `PorAceptarSection.renderDetalle`) y
    dentro del desplegable de la card POS.
  - **Hecho:** component tests verdes: (a) card con `2` y card con `0` muestran
    ambas el dato; (b) el dato NO aparece en la fila de marcas informativas, y esa
    fila sigue sin renderizarse cuando no hay ninguna marca (sin hueco vacío);
    (c) el detalle lo muestra en ambos grupos; (d) los tests existentes de la card
    POS siguen verdes. (R18, R19, R24, R32)

- [ ] **T19. `[P]` Recepción satélite (5 grupos, dos formas).**
  - **Tablas** ("Recibidas", "Por devolver", "En tránsito a central"): insertar
    `columnaIntentos<RecepcionSateliteDTO>()` en `recibidas-columns.tsx`, en la
    misma posición relativa (tras `estatus`). Se aplica **antes** de
    `conBadgePrioridad` y **antes** de prepender el checkbox, para que el badge
    "Prioritaria" siga cayendo en la primera columna de datos (`numGuia`).
  - **Cards** ("Por recibir", "Devueltas"): `IntentosDato` en
    `RecepcionDetalle.tsx`.
  - **Hecho:** component tests verdes en los 5 grupos (valor ≥1 y valor `0`, ambos
    visibles); encabezados y orden de las 12 columnas preexistentes de
    `recibidasColumns` intactos; el badge "Prioritaria" sigue en la celda de
    `numGuia`. (R17, R18, R19, R21, R25, R32)

- [ ] **T20. `[P]` Dato etiquetado en novedades (2 pestañas).**
  - `IntentosDato` en el `<li>` de `NovedadesModule.tsx` y en el de
    `RechazosSlaModule.tsx`. **Son listas de cards, no `DataTable`** (verificado en
    `NovedadesModule.tsx:102-140` y `RechazosSlaModule.tsx:100-133`), por eso van
    con dato etiquetado y no con columna.
  - **Hecho:** component tests verdes en ambas pestañas (≥1 y `0`, ambos
    visibles); el estado vacío y la paginación no cambian. (R18, R19, R26, R32)

- [ ] **T21. `[P]` Dato etiquetado en "Liberadas hoy (reprogramación)".**
  - `IntentosDato` en la card de `components/private/BodegaLiberadasHoy.tsx`.
  - **Hecho:** component test verde; el aviso sigue sin renderizarse con lista
    vacía; verificado en sus DOS montajes (revisión del maestro y recepción
    satélite). (R18, R19, R27)

---

## Bloque 7 — Descargable (depende de T14)

- [ ] **T22. Columna de intentos en el manifiesto + derogación de R2/R11 de la
      148.**
  - `ManifiestoFilaDTO` gana `intentos: number` (no opcional); `ManifiestoService`
    lo resuelve en el mismo lote (dependencia de constructor, como T8–T13);
    `COLUMNAS_MANIFIESTO` y `toRow` de `lib/utils/manifiesto-xlsx.ts` ganan la
    entrada nueva.
  - **Reescribir la regla, no el número.** Los comentarios de
    `lib/types/manifiesto.ts:27-36` y `lib/utils/manifiesto-xlsx.ts:19-24` que
    dicen "EXACTAMENTE las 11 columnas" pasan a declarar la regla de `design.md
    §6.3`: *el manifiesto refleja los datos de la orden y ese conjunto crece
    cuando la orden gana un dato nuevo*; se conserva el lado prohibitivo (ids
    internos, banderas de borrado y datos que no son de la orden siguen fuera).
  - **Purgar las aserciones de conjunto cerrado** en la suite de la 148: los tests
    pasan a verificar que ciertas columnas ESTÁN con su clave y su orden relativo,
    nunca que no haya otras (R28b).
  - **Anotar la derogación** en `specs/148-*/requirements.md` como nota de
    corrección fechada (2026-07-29), citando la decisión del humano, para que
    quien lea la 148 encuentre el rastro.
  - **Hecho:** unit tests verdes: (a) el libro trae la columna de intentos con su
    clave y en su posición; (b) una orden sin intentos emite `0`, no celda vacía;
    (c) el resto de las columnas conserva clave, cabecera y orden relativo;
    (d) **no queda en la suite ninguna aserción de "exactamente N columnas"**;
    (e) la nota de corrección existe en la spec de la 148. (R28, R12)

---

## Bloque 8 — Cierre

- [ ] **T23. `[P]` Verificar el NO alcance.** (depende de T14)
  - Confirmar que NO muestran el conteo: `app/paquete/[numGuia]/page.tsx`, la
    etiqueta de guía (`EtiquetaGuia.tsx`, `etiquetas-pdf.ts`), el canal integrador
    (`ApiOrdenLecturaService`, `openapi-spec.ts`) y el cierre del día /
    cierres de admin.
  - Confirmar que el borde **rechaza** el campo como `sortBy` y como `filter`
    (lista blanca vigente, R29) sin código nuevo.
  - Confirmar que **no existe** ningún estado `indemnizada` declarado,
    referenciado ni preparado, y que `incidente` sigue **sin salidas** en el mapa
    de la 154 (D3).
  - **Hecho:** tests que asertan la ausencia (no solo lectura humana); `git diff`
    acotado a los archivos listados en T1–T22. (R3, R29, R30, R31)

- [ ] **T24. `[P]` Regresión de las superficies.** (depende de T16–T21)
  - **Hecho:** las suites existentes de `/ordenes`, revisión del maestro,
    `/mis-asignaciones`, `/recepcion-satelite`, `/novedades` y el aviso de
    liberadas hoy, verdes **sin cambios de aserción** más allá del dato nuevo.
    (R32)

- [ ] **T24.1. RE-MEDIR el radio de impacto ANTES del despliegue.** (obligatoria,
      inmediatamente antes de desplegar)
  - Volver a ejecutar la consulta de solo lectura de `design.md §4.3` contra
    producción. La medición del 2026-07-29 (0 órdenes que saltan el umbral) es una
    **foto**, y el conteo se recalcula al vuelo: entre esa fecha y el despliegue
    puede aparecer un lote.
  - **Hecho:** el resultado queda escrito en
    `progress/impl_160-badge-intentos-entrega.md` con fecha y entorno. **SI la
    fila "saltarían el umbral" da > 0, el despliegue SE DETIENE** y se revisa QA1
    con el humano (las opciones (b), (c) y (d) siguen documentadas en
    `design.md §8.1`). (R8)

- [ ] **T25. Trazabilidad y verificación final.** (depende de todo)
  - Completar la tabla `R → test` de `requirements.md` con rutas reales y
    documentar el mapa en `progress/impl_160-badge-intentos-entrega.md`, junto con
    las dos mediciones (la del 2026-07-29 y la de T24.1).
  - **Hecho:** `./init.sh` verde + suite completa verde; cada `R1..R32` mapeado a
    ≥ 1 test concreto; sin migración nueva en el diff.

---

## Grafo de dependencias

```
T1 ── T2 ── T3 ── T4 ─┬─ T5 (dinero) ──────────────────┐
                      ├─ T6  [P] ─────────────────────-┤
                      └─ T7 ─┬─ T8  [P] ───────────────┤
                             ├─ T9  [P] ───────────────┤
                             ├─ T10 [P] ───────────────┤
                             ├─ T11 [P] ───────────────┤
                             ├─ T12 [P] ───────────────┤
                             └─ T13 [P] ───────────────┤
                                                       │
                              T14 (gate backend) ──────┤
                               │                       │
                               ├─ T15 ─┬─ T16 [P] ──┐  │
                               │       ├─ T17 [P] ──┤  │
                               │       ├─ T18 [P] ──┼─ T24 ──┐
                               │       ├─ T19 [P] ──┤        │
                               │       ├─ T20 [P] ──┤        ├── T25 ── T24.1
                               │       └─ T21 [P] ──┘        │          (pre-deploy)
                               ├─ T22 (manifiesto) ──────────┤
                               └─ T23 [P] ───────────────────┘
```

`T24.1` va **después** de T25 en el tiempo a propósito: no es una task de
implementación sino la última puerta antes de desplegar, y su resultado puede
detener el despliegue de una feature ya verde.
