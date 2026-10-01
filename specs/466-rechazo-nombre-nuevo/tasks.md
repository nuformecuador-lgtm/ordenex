# Feature 466 — Tareas

> Requisitos: `requirements.md` (R1-R28, textos de §0). Diseño: `design.md` (§ citados).
> **Orden obligatorio: aprobación humana del spec → Fase 0 → Fase 1 (backend_dev) → Fase 2 (frontend_dev) →
> Fase 3 (verificación) → Fase 4 (revisión).** Sin migraciones.
>
> Convenciones: `[P]` = paralelizable con las otras `[P]` de su bloque (sin archivos en común). `Dep:` =
> dependencias. **Hecho** = criterio verificable. Un commit por tarea (`test(466): …`, `feat(466): …`,
> `docs(466): …`). El worktree nace de `dev`: primer paso `git checkout --detach <SHA dado por el leader>` +
> `git merge-base` (memoria «El worktree de agente nace de dev»); `git status -sb` antes de cada commit.
> Gate: la ficha toca `lib/types/` → **`./init.sh` completo** (D8), con `INIT_EXIT=$?` escrito dentro del log.
> Los tests de texto afirman el **literal nuevo**, nunca el valor de la fuente (D3).

---

## FASE 0 — Reconfirmar el inventario (backend_dev)

- [x] **T0.1 — Inventario sobre el árbol de hoy.** Repetir el barrido de `design.md` §2 sobre el SHA dado
  (`grep -i` de «rechaz» en literales y en `docs/`), y anotar en `progress/impl_466.md` toda línea que se haya
  movido o que falte/sobre respecto de §2, con su clase (Cambia / Se conserva) y el motivo. Una línea nueva
  que no encaje en §0.6 ni en §0.2-§0.4 se **eleva al leader**, no se decide. Dep: ninguna.
  **Hecho:** tabla en `progress/impl_466.md` con «sin diferencias» o la lista de diferencias resueltas.

- [x] **T0.2 — Censo de tests que fijan literales viejos** `[P]` con T0.1. Listar los archivos de `tests/` que
  afirman un texto de la columna «Antes» de §0 (no el nombre vigente del estado). **Hecho:** lista con
  archivo:línea en `progress/impl_466.md`; es la lista de trabajo de T1.6 y T2.7.

## FASE 1 — `lib/`, `docs/api/` y la guardia (backend_dev)

- [x] **T1.1 — Guardia en modo informe.** Crear `tests/unit/guards/rechazo-nombre-466.guardia.test.ts` con
  los tres brazos y la autocomprobación de `design.md` §3.1-§3.4, y una tabla `PENDIENTES` archivo → número
  exacto de hallazgos medidos hoy (patrón de la G2 de la 455: uno más es infracción, uno menos caduca). Las
  mutaciones de §3.4 deben dar rojo **ejecutadas**, no razonadas. Dep: T0.1.
  **Hecho:** suite verde con `PENDIENTES` no vacío; salida roja de cada mutación pegada en
  `progress/impl_466.md` (nombre del test, `passed ≥ 1`, `skipped = 0`).

- [x] **T1.2 — Conceptos en `lib/constants/`** (C1-C4, C15). `wallet-rotulos.ts:31,34,40,41`,
  `origen-legible-rotulos.ts:21` (la clave `cobroPorRechazo` no cambia). Dep: T1.1.
  **Hecho:** `PENDIENTES` de esos dos archivos retirado; test de `OrigenLegibleService` afirma
  «Gestión de orden · cobro por devolución a origen · guía …» para una fila `ingreso_flete_devolucion`.

- [x] **T1.3 — Historial, métricas, mensajes de servidor** `[P]` con T1.2. `historial-accion.ts:511,512,535,587`
  (C25-C28); `metrics.ts:258,393` (K1, K2; ids intactos); `mensajes-bloqueo.ts:106-108` (E6);
  `CierresAdminService.ts:115` (E4); `emitir.ts:1104,1107` (E12, E13). Medir y declarar las excepciones del
  brazo 1 de la guardia en estos archivos (§3.1). Dep: T1.1.
  **Hecho:** `PENDIENTES` de esos archivos retirados; excepciones con texto + motivo; test del aviso de novedades
  afirma los dos textos literales con la cifra de configuración.

- [x] **T1.5 — Contrato y documentación de integradores** `[P]` con T1.2. `openapi-spec.ts:1424,2062,2068,2073`
  (R16), espejo idéntico en `docs/api/api-key-openapi.yaml`, `manual-metricas-por-mensajero.md:283` (R18),
  entrada sin ruptura en `docs/api/CHANGELOG.md` (R19). Dep: T1.1.
  **Hecho:** los tests de `tests/unit/api/openapi-*` verdes; test nuevo afirma que ningún `properties`,
  `enum`, `required` ni id de métrica cambió respecto del SHA de partida (R17).

- [x] **T1.6 — Tests de `lib/`.** Actualizar al literal nuevo los tests de T0.2 que cubren `lib/`. Dep: T1.2, T1.3, T1.5.
  **Hecho:** `./init.sh` completo verde (`INIT_EXIT=0` en el log, integración con `skipped = 0`); commit y
  SHA anotados.

## FASE 2 — `app/`, `components/` y la ayuda (frontend_dev)

- [x] **T2.1 — Wallet** `[P]`. `wallet-labels.ts:301`, `composicion-detalle-labels.ts:78-79`,
  `desglose-tienda-labels.ts:46,49,62,63`, `mi-wallet-labels.ts:107,110,124,125`,
  `detalle-movimiento-panel-labels.ts:64,144,155,157`, `cobro-rechazo-tienda-labels.ts:20,38,40,104,107`
  (C5-C14, C16-C24). Dep: Fase 1. **Hecho:** sus `PENDIENTES` retirados; tests de rótulos con literal nuevo.

- [x] **T2.2 — Cierres y tarifas** `[P]`. `cierre-detalle-shared.tsx`, `cierre-labels.ts`,
  `ConsolidacionBodegaModule.tsx:351`, `cierre-factura.tsx:2389`, `CorregirResultadoDialog.tsx:63,71,74`,
  `tarifas-labels.ts:41,44,86,90` (C29-C35, E1-E3, E8-E10; C31 con `nombreDeResultado`). Dep: Fase 1.
  **Hecho:** `PENDIENTES` retirados; excepciones de §3.1 declaradas con texto.

- [x] **T2.2b — Guardia de la 338** (`design.md` §3.5; R24). Va aquí y no en la Fase 1 porque su
  autocomprobación cuenta el nombre vigente en `app/`, que hasta T2.1-T2.4 sigue diciendo «Flete por rechazo».
  Dep: T2.1, T2.2, T2.4. **Hecho:** autocomprobación verde con `NOMBRE_VIGENTE` = flete por devolución a
  origen; caso nuevo que prueba que «Flete por devolución a origen» no casa `NOMBRE_RETIRADO`; el censo
  sigue vacío.

- [x] **T2.3 — Mensajero y novedades** `[P]`. `GestionarOrdenPanel.tsx:277` (E5),
  `GestionarDesdeAyudaModal.tsx:168` (E7), `RechazarNovedadModal.tsx:109` (C36),
  `RechazosSlaModule.tsx:47,76` (E11). Dep: Fase 1. **Hecho:** tests de componente afirman cada texto nuevo y
  que «Rechazar» y «Motivo del rechazo» siguen iguales (R13).

- [x] **T2.4 — Analítica** `[P]`. `catalogo-paneles.ts:104`, `ProductosTabla.tsx:267`,
  `analitica-productos-descarga-columnas.ts:96,160`, `DineroProductoDetalle.tsx:100,102,135` (K1, K3, K4,
  C37, C38). Dep: Fase 1 (K1 cambia con la métrica de T1.3). **Hecho:** la guardia `etiquetas-visibles` verde;
  test de descarga afirma los dos encabezados nuevos y que las claves de columna no cambiaron.

- [x] **T2.5 — Ayuda** `[P]`. `docs/ayuda/oficina/wallet-caja.md`, `tienda/mi-wallet.md`, `oficina/cierres.md`
  (líneas de `design.md` §2.3). Dep: Fase 1. **Hecho:** brazos 2 y 3 de la guardia verdes para `docs/ayuda`;
  los tests de contexto del asistente (`tests/unit/asistente/contexto-*.test.ts`) con el literal nuevo.

- [x] **T2.6 — Vaciar `PENDIENTES`.** Dep: T2.1-T2.5, T2.2b. **Hecho:** `PENDIENTES = {}` en la guardia de la 466 y
  sin ninguna excepción añadida respecto de las de T1.3/T2.2; las guardias 455 (G2, G3, catálogo) y 461
  verdes sin cambios en sus listas (R27).

- [x] **T2.7 — Tests de `app/`/`components/`.** Resto de la lista de T0.2. Dep: T2.6.
  **Hecho:** `./init.sh` completo verde (`INIT_EXIT=0`, `skipped = 0` en integración); commit y SHA anotados.

## FASE 3 — Verificación

- [x] **T3.1 — Matriz de trazabilidad.** `progress/impl_466.md`: cada R1-R28 → test concreto (archivo y nombre
  del `it`). R25 (mismos importes) → los tests de dinero existentes verdes sin cambios de valores esperados;
  R26 → test de T1.5 + `git diff --stat` del SHA de partida sin `db/`, sin `prisma/`, sin migraciones; R28 →
  ningún cambio en `lib/auth/**` ni en `middleware`. Dep: Fase 2. **Hecho:** sin R sin test.

- [x] **T3.2 — Ver la app** (memorias «Ver la app encuentra lo que la suite no», «Verificar lo que el usuario
  ve»). Con Playwright y la base local sembrada: `/wallet` (libro y su Excel abierto y leído: columnas
  «Movimiento» y «Motivo y origen» de una fila de flete por devolución a origen), `/wallet/tiendas` y su Excel,
  `/mi-wallet` y su Excel, detalle de movimiento y «Anular …» de un cobro, cola de cobros, detalle de un cierre
  con gestiones en Devolución a origen por rechazo, `/configuracion/tarifas`, `/analitica` (panel operativo y
  productos), `/novedades` pestaña de plazo vencido, diálogo de corregir resultado. Un solo dev server
  (memoria «Dos dev servers se pisan»). Dep: T3.1.
  **Hecho:** capturas o volcado de texto por pantalla en `progress/impl_466.md`, con cero apariciones de una
  frase de §0.5 y los textos de §0 presentes.

## FASE 4 — Revisión (reviewer)

- [ ] **T4.1 — Revisión.** Comprueba R1-R28 contra la matriz, re-ejecuta las mutaciones de la guardia (no se
  fía del informe: memoria «Arnés de mutaciones que miente»), confirma que ningún texto de §0.6 cambió y que
  ningún test pasó a compararse contra su propia fuente. Escribe `progress/review_466.md` **y lo commitea**.
  Dep: Fase 3. **Hecho:** veredicto en el archivo commiteado, verificado en la rama con `git show`.
