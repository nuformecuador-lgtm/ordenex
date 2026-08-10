# 184 — Tasks

> Ocho tandas (A–H) más una preparatoria (T0). Cada tanda es **backend → frontend** y se cierra
> sola. `[P]` = paralelizable con lo que está a su lado.
>
> **Regla del gate:** `./init.sh --rapido` al cerrar CADA tanda; `./init.sh` completo antes de
> CADA PR. Ningún subagente corre la suite entera.
>
> **Regla de rol:** las tareas `.1`/`.2` de backend las hace `backend_dev`; las de pantalla,
> `frontend_dev`. Nunca al revés: `app/**` está fuera del alcance del backend.

---

## T0 — Preparar el censo para que no mienta a mitad de camino

- [x] **T0.1 — Sustituir las dos afirmaciones agregadas por la lista declarada.**
  En `tests/components/paginacion/paginacion-transversal.test.tsx`: nace
  `PENDIENTES_184: readonly string[]` con los **doce** nombres del Anexo A; se borran las dos
  afirmaciones de `:910-913` (la lista de `completo` y el `toHaveLength(12)`) y se sustituyen
  por `expect(los de adaptador "conjunto").toEqual(PENDIENTES_184)`.
  **Hecho:** el archivo pasa sin tocar ninguna pantalla; `PENDIENTES_184` tiene 12 entradas;
  ya no queda ningún número escrito a mano en el archivo.
  **Dependencias:** ninguna.

- [x] **T0.2 — Añadir la mitad negativa del censo.** [P con T0.1]
  Para cada listado: si declara `completo`, su archivo NO puede contener
  `filasDelConjuntoCompleto(`; si declara `conjunto`, NO puede contener `filasDesdeResultado(`.
  Mismo tratamiento en `tests/components/descarga/WalletPropsDescarga.test.tsx`.
  **Hecho:** verificado por mutación — cambiar a mano el adaptador de UN listado del censo pone
  rojo el caso, y cambiarlo en la pantalla también. Las dos mutaciones se revierten.

---

## Tanda A — Bodega satélite: el conjunto y la poda de la selección

> La más cara y la única con criterio duplicado. La poda va aquí porque necesita **el mismo
> fragmento SQL** que el conjunto: separarlas obliga a escribir dos veces el `WHERE`.

- [x] **A.1 — Extraer el criterio y añadir el conjunto completo (repositorio).** · depende de T0
  En `lib/repositories/OrdenRepository.ts`: extraer `condicionesSatelite(filtro)` y
  `ordenBodegaSatelite()` del `findRecepcionSatelitePaginada` actual (`:2155`) y añadir
  `findRecepcionSateliteCompleta(filtro)` que los reusa sin `LIMIT`/`OFFSET`. Declarar el método
  en `lib/interfaces/repositories/IOrdenRepository.ts`.
  **Hecho:** en `tests/unit/repositories/satelite-paginado-where.test.ts` hay casos nuevos que
  afirman (a) que el conjunto y la página emiten **las mismas condiciones y el mismo orden**
  para el mismo filtro (R16), (b) que el conjunto NO lleva `LIMIT`/`OFFSET` (R15) y (c) cuántas
  consultas emite (R15). La página sigue verde sin cambios de comportamiento.

- [x] **A.2 — Vigencia de identificadores (repositorio).** · depende de A.1
  `findIdsVigentesEnBodega(filtro, ids)`: reusa `condicionesSatelite` + `o."id" IN (…)`,
  `SELECT o."id"` y nada más. Sin ids → sin consulta.
  **Hecho:** caso en `satelite-paginado-where.test.ts` que afirma que el `WHERE` lleva **la zona
  del actor además del `IN`** (R21), que es UNA sola consulta y que con `ids` vacío no consulta.

- [x] **A.3 — Servicio, schemas y bordes de la satélite.** · depende de A.1, A.2
  `RecepcionSateliteService.listarOrdenesBodegaCompleto` (guard de rol → zona → repo → tope
  `descargaConfig.MAX_FILAS` → mismo mapper y mismo lote de `contarIntentosEnLote` que la
  página) y `listarIdsVigentesBodega` (guard, zona, lista blanca de estados, `[]` sin zona y sin
  ids). Schemas derivados con `.omit({ page, pageSize })` + `.strict()`; el de vigencia añade
  `ids` acotado (ver **Q2**: default 500 en `lib/config/recepcion-satelite.ts`). Acciones
  `listarOrdenesBodegaCompleto` y `listarIdsVigentesBodega` en `lib/actions/recepcion-satelite.ts`.
  **Hecho:** `tests/unit/services/recepcion-satelite-completo.test.ts` y
  `recepcion-satelite-vigencia.test.ts` nuevos, con: forbidden antes del repositorio, tope en el
  borde exacto (`MAX_FILAS` y `MAX_FILAS + 1`), filtro que estrecha el conjunto (R11), id de otra
  zona → no vigente (R21). `tests/unit/actions/recepcion-satelite-action.test.ts` gana los casos
  de clave no declarada → `validation_error` sin tocar el servicio (R17).

- [x] **A.4 — La pantalla descarga por su acción y deja de filtrar en el navegador.**
  · depende de A.3
  `RecepcionSateliteModule.tsx`: borrar `conjuntoFiltrado` (`:113-124`) y el import de
  `filtrarOrdenesSatelite`; `obtenerFilasDescarga` pasa a
  `filasDesdeResultado(listarOrdenesBodegaCompleto({ ...filtro }), filaDescargaSatelite)`.
  **Hecho:** `tests/components/descarga/SateliteDescarga.test.tsx` afirma que descargar con
  filtros aplicados llama a la acción nueva **con esos filtros** y que la pantalla no vuelve a
  filtrar; el módulo ya no importa `filtrarOrdenesSatelite`.

- [x] **A.5 — La poda en la pantalla.** · depende de A.3, A.4
  El módulo baja `comprobarVigencia(ids)` (callback que cierra sobre el filtro vigente, patrón
  de `obtenerFilasDescarga`); `SateliteOrdenesListado` la invoca cuando cambia la página que
  recibe **y** hay marcas fuera de la visible, e interseca
  `seleccionados ∩ (idsPágina ∪ vigentes)`. Si no retira nada, **no** reemplaza el `Set`.
  **Hecho:** `tests/components/paginacion/SateliteSeleccionOtrasPaginas.test.tsx` gana los casos:
  orden marcada que sale del listado → deja de estar marcada (R18); cambiar de página no
  desmarca (R20); sin marcas fuera → cero llamadas (R23); una relectura → exactamente una
  llamada (R24); fallo → selección intacta (R22); el aviso baja su número y desaparece (R25). Y
  `SatelitePaginacion.test.tsx` afirma que la carga inicial y la descarga no consultan vigencia
  (R28) y que podar no cambia página/filtros/contadores (R26).

- [x] **A.6 — Censo y cierre de la tanda A.** · depende de A.4
  Listado 10 pasa a `adaptador: "completo"` y sale de `PENDIENTES_184` (11 restantes), en el
  MISMO commit que A.4.
  **Hecho:** los dos censos verdes; `./init.sh --rapido` verde; bitácora en
  `progress/impl_188-tanda-a.md` con el mapa `R<n>` → archivo + nombre del caso.

---

## Tanda B — Consolidación (listados 6 y 7)

> Comparten la relectura más cara del repo: 4 consultas + los 5 agregados de dinero + el reparto
> de efectivo. Los repositorios ya existen; lo que falta es servicio, borde y pantalla.

- [x] **B.1 — Servicios, schemas y bordes.** · depende de T0
  `CierreBodegaService.listarCierresBodegaSolicitadosCompleto` (sobre `findCierresBodegaByZona`)
  y `listarConsolidablesCompleto` (sobre `findCierresDiaConsolidables`), con guard, mismo mapper
  y tope. Schemas derivados de los de página. Acciones en `lib/actions/cierre-bodega.ts`.
  **Hecho:** `tests/unit/services/consolidacion-completo.test.ts` afirma que el conjunto de la
  descarga **no calcula agregados ni reparto de efectivo** (R10, espías en 0), el tope en el
  borde exacto y el guard antes del repositorio. Casos de repositorio en
  `historicos-paginados-where.test.ts` (R14/R15/R16).

- [x] **B.2 — Las dos pantallas.** · depende de B.1
  `CierresBodegaSolicitadosTabla.tsx` y `ConsolidacionBodegaModule.tsx` pasan a
  `filasDesdeResultado(...)`.
  **Hecho:** `tests/components/descarga/CierresDescarga.test.tsx` actualizado (mockea las
  acciones nuevas y afirma que se llaman con los filtros vigentes); los agregados de dinero de
  la pantalla siguen saliendo de `listarConsolidacion` y no cambian (R26 de la 170: R49/R50).

- [x] **B.3 — Censo y cierre.** · depende de B.2 — listados 6 y 7 fuera de `PENDIENTES_184`
  (9 restantes). **Hecho:** censos verdes, `--rapido` verde, bitácora con el mapa.

---

## Tanda C — Cierres solicitados por el mensajero (listado 1)

- [x] **C.1 — Servicio, schema y borde.** · depende de T0
  `CierreDiaService.listarCierresPasadosCompleto` sobre `findCierresByMensajero`, calcado de
  `listarCierresPasadosPaginado` (`:317`), que **no firma URL**. Acción en
  `lib/actions/cierre-dia.ts`.
  **Hecho:** `tests/unit/services/cierre-dia-pasados-completo.test.ts` afirma con un espía que
  `createSignedUrls` recibe **cero** llamadas en el camino del conjunto (R9), más guard, tope y
  alcance acotado al propio mensajero (R4). Caso de repositorio en
  `historicos-paginados-where.test.ts`.

- [x] **C.2 — La pantalla.** · depende de C.1
  `CierreDiaModule.tsx` pasa a `filasDesdeResultado(...)`.
  **Hecho:** `CierresDescarga.test.tsx` actualizado. **Ojo:** este módulo hospeda además un
  listado del Anexo IV que usa `filasLocales` legítimamente y está declarado en
  `CONVIVEN_ANEXO_III_Y_IV`; esa excepción se conserva tal cual.

- [x] **C.3 — Censo y cierre.** · depende de C.2 — listado 1 fuera (8 restantes).

---

## Tanda D — Cierres del día del admin (listados 2 y 3) `[P con E, F]`

- [x] **D.1 — Repositorio.** · depende de T0
  `CierresAdminRepository.findHistoricoCompleto(alcance)` y `findColaCompleta(alcance)`,
  derivados del mismo `alcanceWhere` y de la misma constante `ESTADOS_COLA_CIERRE_DIA` que sus
  hermanos paginados. Interfaz en `ICierresAdminRepository.ts`.
  **Hecho:** casos en `historicos-paginados-where.test.ts` (histórico) y
  `colas-paginadas-where.test.ts` (cola) que afirman: mismas condiciones y mismo orden que la
  página (R16), sin recorte (R15), y que **cola e histórico siguen particionando el conjunto**
  (`in` / `notIn` sobre la misma constante).

- [x] **D.2 — Servicios, schemas, bordes.** · depende de D.1
  **Hecho:** tests de servicio con guard, tope y alcance por actor; tests de borde con clave no
  declarada → `validation_error` (R17).

- [x] **D.3 — Las dos pantallas.** · depende de D.2
  `CierresAdminHistoricoTabla.tsx` y `CierresAdminModule.tsx`.
  **Hecho:** `CierresDescarga.test.tsx` y los tests que renderizan esas pantallas
  (`CierresAdminModule`, `CierresAdminPage`, `ColasPaginacion`) mockean la acción nueva; el
  archivo sigue saliendo con el conjunto y no con la página (caso ya existente de descarga desde
  la última página).

- [x] **D.4 — Censo y cierre.** · depende de D.3 — listados 2 y 3 fuera (6 restantes).

---

## Tanda E — Cierres de bodega del admin (listados 4 y 5) `[P con D, F]`

- [x] **E.1 — Repositorio.** · depende de T0
  `CierresBodegaAdminRepository.findColaCompleta()` y `findHistoricoCompleto()`.
  **Hecho:** casos en los dos `*-where.test.ts`, con la partición cola/histórico afirmada
  (`ESTADOS_COLA_SOLICITADO`).

- [x] **E.2 — Servicios, schemas, bordes.** · depende de E.1 — **Hecho:** como D.2.

- [x] **E.3 — Las dos pantallas.** · depende de E.2
  `CierresBodegaAdminModule.tsx` y `CierresBodegaResueltosTabla.tsx`.
  **Hecho:** `CierresDescarga.test.tsx` actualizado; sigue verde el caso de la tanda M que
  detectó la mutación `filasDelConjuntoCompleto → filasLocales` en `CierresBodegaResueltosTabla`
  (ahora contra el adaptador nuevo).

- [x] **E.4 — Censo y cierre.** · depende de E.3 — listados 4 y 5 fuera (4 restantes).

---

## Tanda F — Incidentes (listados 8 y 9) `[P con D, E]`

- [x] **F.1 — Repositorio.** · depende de T0
  `IncidenteAdminRepository.findColaCompleta(alcance)` y `findHistoricoCompleto(alcance)`.
  **Hecho:** casos en los dos `*-where.test.ts`, con la partición afirmada.

- [x] **F.2 — Servicios, schemas, bordes.** · depende de F.1 — **Hecho:** como D.2.

- [x] **F.3 — Las dos pantallas.** · depende de F.2
  `IncidentesAdminModule.tsx` e `IncidentesHistoricoTabla.tsx`.
  **Hecho:** `tests/components/descarga/IncidentesDescarga.test.tsx` y los tests que renderizan
  esas pantallas actualizados.

- [x] **F.4 — Censo y cierre.** · depende de F.3 — listados 8 y 9 fuera (2 restantes).

---

## Tanda G — Wallet (listados 11 y 12)

> Los dos únicos que además tocan el **segundo** censo (`WalletPropsDescarga.test.tsx`).

- [x] **G.1 — Servicios, schemas y bordes.** · depende de T0
  `GastoFijoPlantillaService.listarPlantillasCompleto` (sobre `listar()`) y
  `WalletTiendaService.listarSaldosTiendasCompleto` (sobre `listarSaldosTodasTiendas()`), con
  guard, mismo mapper de dinero y tope. Acciones `listarPlantillasCompletoAction` y
  `listarSaldosTiendasCompletoAction`.
  **Hecho:** tests de servicio (guard, tope en el borde exacto, mismo mapper que la página) y de
  borde; casos de repositorio en `historicos-paginados-where.test.ts` para las lecturas que se
  reusan.

- [x] **G.2 — Las dos pantallas + el segundo censo.** · depende de G.1
  `GastosFijosPlantillasPanel.tsx` y `SaldosTiendasTable.tsx`.
  **Hecho:** `tests/components/descarga/WalletPropsDescarga.test.tsx` declara `filasDesdeResultado`
  para los tres módulos de wallet y sigue verde el caso del tope con 5001 filas (ahora
  `limite_excedido` del servidor, R6); `WalletDescarga.test.tsx` y
  `tests/unit/components/wallet-gastos-fijos-panel.test.tsx` actualizados.

- [x] **G.3 — Censo y cierre.** · depende de G.2 — `PENDIENTES_184` queda **vacío**.

---

## Tanda H — Cierre de la deuda: guardia, retirada y bitácora

- [x] **H.1 — Guardia nueva.** · depende de A–G
  `tests/unit/descarga/adaptador-conjunto.guardia.test.ts`: (a) no queda ninguna llamada a
  `filasDelConjuntoCompleto(` bajo `app/`; (b) ninguno de los dos censos tiene casos
  deshabilitados (`.skip`) ni pendientes (`.todo`) (R31/R32).
  **Hecho:** la selecciona `vitest run guard` sin registrarla en ninguna lista; verificada por
  mutación (reintroducir una llamada en una pantalla → rojo).

- [x] **H.2 — Retirar el adaptador muerto.** · depende de H.1
  Borrar `filasDelConjuntoCompleto` de `components/shared/descarga-resultado.ts` y su mención en
  la alternancia de `ControlDescargaTransversal.test.tsx`.
  **Hecho:** typecheck verde sin él. **Criterio de no hacerlo:** si al llegar aquí apareciera un
  consumidor fuera del Anexo III, NO se borra y se anota el consumidor y el motivo en la
  bitácora.

- [x] **H.3 — Bitácora y trazabilidad final.** · depende de H.2
  `progress/impl_188-cierre.md` con el mapa `R1..R34` → archivo + nombre del caso, la salida
  real de los gates y las mutaciones verificadas.
  **Hecho:** los 34 requisitos tienen su caso nombrado. **No vale** un recuento de `R<n>` en
  títulos de test: aquí ya produjo un falso «68/68» por cruce de espacios de nombres entre
  features.

- [x] **H.4 — Gate final y PR.** · depende de H.3
  `./init.sh` completo en verde, `progress/history.md` con su entrada, y el estado de la feature
  a `done` solo tras el merge.

---

## Notas de ejecución

- **Los tests que mockean la acción-fuente de cada dominio.** El inventario midió ~45 archivos
  que referencian las ocho acciones-fuente. Cada tarea de pantalla debe enumerar los suyos con
  `pnpm exec vitest related --run <pantalla>` antes de tocar nada: si un test renderiza la
  pantalla y no mockea la acción nueva, se rompe al importar, y ese rojo es propio.
- **Un commit por tanda lógica**, con la pantalla y su línea del censo en el MISMO commit: es lo
  que impide que el censo quede mintiendo entre dos commits.
- **Lo que esta feature NO toca:** las opciones de `useSWR` de ninguna pantalla (R33, para no
  chocar con Q-M1), `db/migrations/`, `feature_list.json` (lo lleva el leader) y las preguntas
  Q-L1/Q-I1/Q-I2/Q-L3/Q-K1/Q-K2, que siguen dirigidas al humano por sus vías.
