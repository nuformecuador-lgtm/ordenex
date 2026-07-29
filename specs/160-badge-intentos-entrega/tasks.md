# Feature 160 — Tasks

Checklist verificable. `[P]` = paralelizable con las tareas del MISMO bloque.
Cada task lleva su criterio de "hecho" y los `R<n>` que cubre.

Zona `fullstack`: la implementación se secuencia **backend (bloques 1–3) →
frontend (bloques 5–7)**; ninguna task de frontend arranca antes de que el gate
del bloque 4 esté verde.

**Sin migración en toda la feature.** Si alguna task obliga a tocar
`db/schema.prisma` o a crear un índice, es señal de que el diseño se torció (R7):
se detiene y se escala como decisión, no se añade por cuenta propia.

---

## Bloque 0 — Puerta F1.4-bis

- [ ] **T0.1. Medir el radio de impacto en dinero.** (bloquea T0.2)
  - Ejecutar la consulta de **solo lectura** de `design.md §4.3` contra la base
    que corresponda (sin escribir nada) para obtener la **cota superior** del lote
    de órdenes vivas que saltarían el umbral con el criterio nuevo.
  - **Hecho:** el número de órdenes y la lista de remisiones quedan escritos en
    `progress/impl_160-badge-intentos-entrega.md`, con la fecha y el entorno
    consultado. Sin este dato, QA1 se decide a ciegas.

- [ ] **T0.2. Cerrar las preguntas abiertas con el humano.** (depende de T0.1)
  - **Bloqueantes:** QA1 (efecto retroactivo sobre órdenes vivas), QA2 (mecanismo
    del corte si QA1 ≠ "aplica a todas"), QA3 (la 12.ª columna del manifiesto
    deroga R2/R11 de la feature 148, o el manifiesto queda fuera).
  - **No bloqueantes, con recomendación:** QA4 (paquete/etiqueta), QA5 (API
    pública), QA6 (cierre del día), QA7 (filas legadas).
  - **Hecho:** las siete respuestas quedan escritas en `progress/current.md`.
    **QA1 y QA2 bloquean el Bloque 2**; **QA3 bloquea el Bloque 7**. El resto de
    bloques puede avanzar sin ellas.

---

## Bloque 1 — Backend · el criterio y su derivador

- [ ] **T1. Declarar la familia admitida por la rama B.**
  - En `lib/types/orden-historial.ts`: `ORIGEN_TIPOS_REPROGRAMADA_INTENTO =
    ["gestion"]` con `satisfies readonly OrdenHistorialOrigenTipo[]` y el
    comentario que explica por qué es lista de INCLUSIÓN y por qué
    `reprogramacion_tienda` queda fuera (design §1.2/§1.3).
  - **Corregir en el mismo commit** los bloques de comentario de las features
    99/100/109/138/139 de ese archivo que hoy afirman "destino != `devuelta` → no
    altera `contarIntentos`": la conclusión sigue siendo cierta para todos ellos,
    pero la razón cambió y el comentario tiene que decirlo.
  - **Hecho:** `tsc` verde; un unit test afirma que `reprogramacion_tienda` NO
    está en la constante y que `gestion` sí. (R1, R2)

- [ ] **T2. Predicado único `whereIntentosVigentes` + renombre del conteo
      individual.** (depende de T1)
  - En `lib/repositories/OrdenHistorialRepository.ts`: función pura
    `whereIntentosVigentes(ordenId, criterio)` que acepta `string` o
    `{ in: string[] }` y compone el `OR` de destinos (rama A + rama B, esta última
    omitida si `criterio.reprogramadaId === null`) con el `OR` de VIGENCIA
    **idéntico al de hoy**.
  - `contarPorDestinoVigentes(ordenId, estatusDestinoId)` → **renombrar** a
    `contarIntentosVigentes(ordenId, criterio)` en la implementación y en
    `lib/interfaces/repositories/IOrdenHistorialRepository.ts`, y actualizar su
    documentación (design §3.3).
  - **Hecho:** unit tests verdes que afirman, con el mismo doble de Prisma:
    (a) fila `devuelta` cuenta; (b) fila `reprogramada` + `gestion` cuenta;
    (c) fila `reprogramada` + `reprogramacion_tienda` **no** cuenta;
    (d) escenario "1 devuelta + 1 reprogramación de tienda" → **1**, no 2;
    (e) gestión anulada no cuenta en NINGUNA de las dos ramas;
    (f) fila huérfana no cuenta; (g) fila sin gestión (`ajuste_estado` → `devuelta`)
    sigue contando; (h) destino `incidente` no altera el conteo. (R1, R2, R3, R5)

- [ ] **T3. Conteo EN LOTE `contarIntentosVigentesEnLote`.** (depende de T2)
  - Firma en la interfaz: `(ordenIds: string[], criterio: CriterioIntento) =>
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
    (c) el `where` usado es el MISMO que produce `whereIntentosVigentes` (comparado
    contra el del conteo individual); (d) para una misma orden, individual y lote
    devuelven el mismo número en los 8 escenarios de T2. (R4, R12, R13)

- [ ] **T4. `OrdenHistorialService`: criterio resuelto una vez + versión en
      lote.** (depende de T3)
  - `ESTATUS_REPROGRAMADA` junto a `ESTATUS_DEVUELTA`; privado
    `resolverCriterio()` que resuelve los DOS ids con un solo `Promise.all` y
    devuelve `null` si falta `devuelta`.
  - `contarIntentos(ordenId)` **conserva su firma** (features 47/99 la consumen) y
    pasa a delegar en `contarIntentosVigentes(ordenId, criterio)`.
  - Nuevo `contarIntentosEnLote(ordenIds)` en `IOrdenHistorialService` y su
    implementación.
  - **Hecho:** unit tests verdes: (a) catálogo sin `devuelta` → `0` / Map vacío,
    sin llamar al repo y sin excepción; (b) catálogo **con** `devuelta` y **sin**
    `reprogramada` → solo rama A, sin excepción; (c) los dos ids resueltos viajan
    tal cual al repo; (d) el catálogo se lee **una** vez por llamada, no por orden.
    (R4, R6, R12)

---

## Bloque 2 — Backend · el escalado (DINERO) · **bloqueado por QA1/QA2**

> No arranca hasta que T0.2 haya cerrado QA1 (y QA2 si aplica). Si la respuesta
> es la opción (b) "fecha de corte" o (d) "dos entregas" de `design.md §8.1`, este
> bloque cambia de contenido: se re-especifica antes de codificar.

- [ ] **T5. Aserciones del cambio de escalado en `DevolucionSlaService`.**
      (depende de T4 + QA1)
  - **No se toca `DevolucionSlaService.ts`**: consume `contarIntentos`, que ya
    devuelve el número nuevo. Lo que se escribe son los tests que fijan el
    comportamiento y el comentario de `:109` (`"Q4: contarIntentos YA incluye la
    devolución vigente"`), que debe pasar a decir también qué reprogramaciones
    incluye.
  - **Hecho:** unit tests verdes: (a) orden `not_found` con 2 reprogramaciones de
    mensajero vigentes + 1 devuelta y umbral 3 → **escala a `rechazada`** (hoy
    liberaría); (b) la misma orden con las reprogramaciones ANULADAS → libera;
    (c) orden con 1 reprogramación **de la tienda** + 1 devuelta → libera (no hay
    doble conteo); (d) `wrong_number`/`wrong_address` escalan directo **sin llamar
    a `contarIntentos`** (la aserción de "no llamado" ya existe en
    `tests/unit/services/devolucion-sla-service.test.ts:157`);
    (e) causa `null` se omite; (f) el resto de la suite del cron verde sin cambios
    de aserción. (R8, R9)

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
  - `ManifiestoFilaDTO`: `intentos: number` **no opcional** (design §3.6) — se
    escribe en el Bloque 7, no aquí, porque depende de QA3.
  - `OrdenDTO`, `ApiOrdenListItemDTO`, `ApiOrdenDetalleDTO` y `EtiquetaGuiaDTO`
    **no** se tocan.
  - **Hecho:** `tsc` verde y ningún fixture/mock existente roto (campo opcional).
    Un test afirma que los DTO excluidos NO tienen el campo. (R16, R28, R29)

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
    `intentosEntrega` numérico, `0` incluido; (b) los ids del lote son
    EXACTAMENTE los ya acotados por el alcance del actor; (c) resultado vacío → 0
    llamadas al historial; (d) **exactamente 1** llamada al lote por listado;
    (e) el resto de la suite del servicio verde sin cambios de aserción.
    (R11, R12, R13, R14, R15, R30)

---

## Bloque 4 — Gate de fin de fase backend

- [ ] **T14. Gate backend.** (depende de T5, T6, T8–T13)
  - **Hecho:** `./init.sh` verde + suite completa verde + `git diff` **sin**
    cambios en `db/schema.prisma` ni `db/migrations/`. Recién aquí arranca el
    frontend. (R7, R30)

---

## Bloque 5 — Frontend · piezas compartidas (depende de T14)

- [ ] **T15. `components/shared/IntentosEntregaBadge.tsx` + `conChipIntentos`.**
  - Badge de presentación pura: props `{ intentos: number }`, devuelve `null` si
    `< 1` (regla de ocultamiento en UN solo sitio), `Badge` `variant="warning"`,
    `role="status"`, `aria-label={`Intentos de entrega: ${n}`}`, texto
    `1 intento` / `${n} intentos`. **Sin "de N"** (R19).
  - Decorador `conChipIntentos(columns)` calcado de `conBadgePrioridad`
    (`components/shared/PrioridadResalte.tsx:58-94`, incluido `resolverCelda`):
    envuelve la PRIMERA columna de DATOS sin tocar cabeceras, ids ni orden.
  - **Hecho:** component tests verdes: (a) `0` → no renderiza nada; (b) `1` →
    singular; (c) `3` → plural + nombre accesible correcto; (d) el decorador
    conserva ids, cabeceras y orden de las columnas, y compone con
    `conBadgePrioridad` sin perder ninguno de los dos marcadores; (e) grep de
    contrato: el umbral no aparece en el módulo. (R17, R18, R19, R20)

---

## Bloque 6 — Frontend · superficies (dependen de T15; `[P]` entre sí)

- [ ] **T16. `[P]` Las 4 variantes de columnas del listado de órdenes.**
  - Aplicar `conChipIntentos` en **un** punto: `ordenesColumns`
    (`app/(app)/ordenes/_components/ordenes-columns.tsx`). `ordenesColumnsAdminTienda`
    y `ordenesColumnsReprogramada` lo heredan por composición, y
    `OrdenesApartado` lo reusa tal cual.
  - **Hecho:** component tests verdes: (a) fila con `intentosEntrega = 2` muestra
    el chip en la primera celda de datos; (b) fila con `0` y fila con el campo
    ausente renderizan la celda EXACTAMENTE como antes; (c) ids, cabeceras y orden
    de las 3 definiciones sin cambios, y el test existente
    `ordenesColumnsReprogramada.length === ordenesColumns.length + 1` sigue verde;
    (d) el chip aparece en el dashboard del adminTienda y en los apartados del
    maestro sin tocar esos archivos. (R20, R21, R30)

- [ ] **T17. `[P]` Diálogos de acción por lote.**
  - Chip junto a cada `<li>` de la lista de órdenes seleccionadas en
    `GenerarGuiaModal`, `AsignarBodegaModal`, `RutearSateliteModal`,
    `EtiquetasGuiaModal`, `RecuperarABodegaModal` y `DevolverATiendaModal`. El dato
    ya viaja en el `OrdenListItemDTO` de la selección: es solo pintar.
  - **Hecho:** component tests verdes por diálogo: con `2` aparece el chip; con
    `0`/ausente no aparece nada nuevo. (R22, R18)

- [ ] **T18. `[P]` Portal del mensajero.**
  - `pos-card/PosOrderCard.tsx`: sumar el chip a la fila de marcas informativas
    existente (líneas 71-84) y ampliar la guarda del contenedor con
    `(orden.intentosEntrega ?? 0) >= 1`.
  - `AsignacionDetalle.tsx`: el chip en el detalle, que es lo que ve el mensajero
    en "por recoger" (vía `PorAceptarSection.renderDetalle`) y dentro del
    desplegable de la card POS.
  - **Hecho:** component tests verdes: (a) card con `2` muestra el chip; (b) con
    `0`/ausente no aparece, y si además no hay "pendiente de optimizar" ni
    "gestionar más tarde", la fila de marcas NO se renderiza (sin hueco vacío);
    (c) el detalle lo muestra en ambos grupos; (d) los tests existentes de la card
    POS siguen verdes. (R18, R23, R30)

- [ ] **T19. `[P]` Recepción satélite (5 grupos).**
  - Tablas ("Recibidas", "Por devolver", "En tránsito a central"): aplicar
    `conChipIntentos` a `recibidasColumns(zonaNombre)`, componiéndolo con
    `conBadgePrioridad` donde ya se usa y **antes** de prepender el checkbox de
    selección, para que el chip caiga en la primera columna de DATOS.
  - Cards ("Por recibir", "Devueltas"): el chip en `RecepcionDetalle.tsx`.
  - **Hecho:** component tests verdes en los 5 grupos (≥1 → chip; 0/ausente → sin
    chip); cabeceras y orden de `recibidasColumns` sin cambios; el badge
    "Prioritaria" sigue apareciendo donde ya aparecía. (R20, R24, R18, R30)

- [ ] **T20. `[P]` Novedades de la tienda (2 pestañas).**
  - Chip en el `<li>` de `NovedadesModule.tsx` y en el de `RechazosSlaModule.tsx`.
  - **Hecho:** component tests verdes en ambas pestañas (≥1 → chip; 0/ausente →
    sin chip); el estado vacío y la paginación no cambian. (R25, R18, R30)

- [ ] **T21. `[P]` Aviso "Liberadas hoy (reprogramación)".**
  - Chip en la card de `components/private/BodegaLiberadasHoy.tsx`.
  - **Hecho:** component test verde; el aviso sigue sin renderizarse cuando la
    lista está vacía; se verifica en sus DOS montajes (revisión del maestro y
    recepción satélite). (R26, R18)

---

## Bloque 7 — Descargable · **bloqueado por QA3**

- [ ] **T22. Columna de intentos en el manifiesto Excel.** (depende de T14 + QA3)
  - Solo si QA3 confirma que D4 deroga R2/R11 de la feature 148.
  - `ManifiestoFilaDTO` gana `intentos: number` (no opcional); `ManifiestoService`
    lo resuelve en el mismo lote (dependencia de constructor, como T8–T13);
    `COLUMNAS_MANIFIESTO` y `toRow` de `lib/utils/manifiesto-xlsx.ts` ganan la
    12.ª entrada; los comentarios que dicen "EXACTAMENTE las 11 columnas" se
    corrigen con la referencia a esta feature.
  - **Anotar la derogación** en `specs/148-*/requirements.md` como nota de
    corrección con fecha, para que R2/R11 de la 148 no queden mintiendo.
  - **Hecho:** unit tests verdes: (a) el libro trae la columna nueva en la
    posición acordada; (b) una orden sin intentos emite `0`, no celda vacía;
    (c) el resto de las 11 columnas conserva clave, cabecera y orden; (d) los
    tests de la 148 actualizados **explícitamente**, no "hasta que pasen".
    (R27, R12)

---

## Bloque 8 — Cierre

- [ ] **T23. `[P]` Verificar el NO alcance.** (depende de T14)
  - Confirmar que NO muestran el conteo: `app/paquete/[numGuia]/page.tsx`, la
    etiqueta de guía (`EtiquetaGuia.tsx`, `etiquetas-pdf.ts`), el canal integrador
    (`ApiOrdenLecturaService`, `openapi-spec.ts`) y el cierre del día /
    cierres de admin.
  - Confirmar que **no existe** ningún estado `indemnizada` declarado,
    referenciado ni preparado, y que `incidente` sigue sin salidas nuevas (D3).
  - **Hecho:** tests que asertan la ausencia (no solo lectura humana); `git diff`
    acotado a los archivos listados en T1–T22. (R3, R28, R29)

- [ ] **T24. `[P]` Regresión de las superficies.** (depende de T16–T21)
  - **Hecho:** las suites existentes de `/ordenes`, revisión del maestro,
    `/mis-asignaciones`, `/recepcion-satelite`, `/novedades` y el aviso de
    liberadas hoy, verdes **sin cambios de aserción** más allá del chip. (R30)

- [ ] **T25. Trazabilidad y verificación final.** (depende de todo)
  - Completar la tabla `R → test` de `requirements.md` con rutas reales y
    documentar el mapa en `progress/impl_160-badge-intentos-entrega.md`, junto con
    el resultado de la medición de T0.1 y la decisión tomada en QA1.
  - **Hecho:** `./init.sh` verde + suite completa verde; cada `R1..R30` mapeado a
    ≥ 1 test concreto; sin migración nueva en el diff.

---

## Grafo de dependencias

```
T0.1 ── T0.2 (gate) ─┬─ [QA1/QA2] ────────────────────────────┐
                     │                                        │
                     └─ [QA3] ──────────────────────┐         │
                                                    │         │
T1 ── T2 ── T3 ── T4 ─┬─ T5 (dinero, espera QA1) ───┼─────────┤
                      ├─ T6 [P] ────────────────────┤         │
                      └─ T7 ─┬─ T8  [P] ────────────┤         │
                             ├─ T9  [P] ────────────┤         │
                             ├─ T10 [P] ────────────┤         │
                             ├─ T11 [P] ────────────┤         │
                             ├─ T12 [P] ────────────┤         │
                             └─ T13 [P] ────────────┤         │
                                                    │         │
                                    T14 (gate backend) ───────┤
                                     │                        │
                                     ├─ T15 ─┬─ T16 [P] ──┐   │
                                     │       ├─ T17 [P] ──┤   │
                                     │       ├─ T18 [P] ──┤   │
                                     │       ├─ T19 [P] ──┼── T24 ──┐
                                     │       ├─ T20 [P] ──┤         │
                                     │       └─ T21 [P] ──┘         ├── T25
                                     ├─ T22 (manifiesto) ◄──────────┤
                                     └─ T23 [P] ───────────────────-┘
```
