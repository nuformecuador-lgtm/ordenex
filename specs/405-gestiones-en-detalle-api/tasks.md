# Feature 405 — tasks

> `[P]` = paralelizable con las tareas que comparten su bloque.
> Cada task dice cómo se sabe que está **hecha**. Un commit por task lógica
> (`feat(405): …` / `test(405): …` / `docs(405): …`).
> Gate normal: **`./init.sh --rapido`**. Antes de la release a `prod`: **`./init.sh`** completo.

---

## Bloque 0 — Puertas. Nada de esto es código, y sin esto no se empieza

### T0.1 — ⚠️ Confirmar Q1 con el integrador (BLOQUEA TODO)
- **Depende de:** nada.
- **Hacer:** mandar al integrador el texto de `requirements.md` §7-Q1 y esperar respuesta.
- **Hecho cuando:** la respuesta queda pegada literal en `progress/impl_405_backend.md`, con fecha.
- **Si responde «el texto libre»:** se **para**, no se implementa nada, y se lleva al humano. Emitir
  `gestion_orden.motivo` contradice 256/R22.

### T0.2 — Aprobación humana del spec (puerta SDD)
- **Depende de:** T0.1.
- **Hacer:** el humano lee los tres archivos y responde «aprobado» o pide cambios. Confirmar de paso
  Q2, Q4, Q6, Q7 y Q8. **Q5 ya no se pregunta: quedó CERRADA el 2026-09-10 con medición de
  producción** (máximo 5 gestiones por orden, 0 por encima de 10 — design §5.1). Sin tope y sin
  paginación.
- **Hecho cuando:** la ficha 405 pasa a `spec_ready` y el veredicto de cada Q queda escrito en
  `progress/impl_405_backend.md`.

### T0.3 — Confirmar el estado de la ficha 404
- **Depende de:** nada. `[P]` con T0.1.
- **Hacer:** comprobar en disco si `specs/404-mensajero-en-webhook-y-api/` existe y si el tipo público
  del mensajero ya está en `lib/types/api-orden.ts`.
- **Hecho cuando:** está anotado cuál de los dos mundos aplica:
  - **404 ya implementada** → T2 **importa** su tipo y no crea ninguno.
  - **404 aún no** → T2 crea el tipo en `lib/types/api-orden.ts` con ESE nombre y ESA forma, y se
    avisa a quien lleve la 404 para que lo reutilice. **Nunca dos tipos para el mismo concepto.**

---

## Bloque 1 — Tipos y contrato interno (después de T0.2)

### T1 — `ApiOrdenGestionRow` en la interfaz del repositorio
- **Depende de:** T0.2, T0.3.
- **Hacer:** en `lib/interfaces/repositories/IOrdenRepository.ts`, añadir `ApiOrdenGestionRow`
  (`createdAt`, `resultado`, `estadoResultante: string | null`, `motivo`, `mensajero`) y sumar
  `gestiones: ApiOrdenGestionRow[]` a `ApiOrdenDetalleRow`. Comentario que cite 405/R3 y R12.
- **Hecho cuando:** `pnpm typecheck` señala el `toDetalleDTO` incompleto (el fallo esperado: los DTO
  son espejo, como declara `ApiOrdenEvidenciaDTO`).

### T2 — `ApiOrdenGestionDTO` en los tipos públicos
- **Depende de:** T1.
- **Hacer:** en `lib/types/api-orden.ts`, declarar `ApiOrdenGestionDTO` con las **cinco** claves de
  R3 y `mensajero` tipado con el tipo de la 404 (§2.4 del design; NO redeclarar `{id, nombre}`).
  `ApiOrdenDetalleDTO` gana `gestiones: ApiOrdenGestionDTO[]`. Comentario que diga, con archivo y
  línea, que `motivo` es la causa **tipificada** y **no** `gestion_orden.motivo` (256/R22).
- **Hecho cuando:** compila, y un `ApiOrdenGestionDTO` con una clave de más o de menos no compila.

### T3 — Helper puro `causaTipificadaDeGestion` `[P]` con T4
- **Depende de:** T2.
- **Hacer:** función pura junto al mapeo del repositorio: `devuelta → causaDevolucion`,
  `incidente → causaIncidente`, resto `null`. Tipada `CausaDevolucion | CausaIncidente | null`
  reutilizando `lib/types/causa-devolucion.ts` y `lib/types/causa-incidente.ts`. **No** se importa ni
  se copia `WebhookEstadoService.motivoPublicado` (design §2.3).
- **Hecho cuando:** hay un test unitario con los **cinco** values de `gestion_resultado` y con el caso
  «`devuelta` sin causa registrada → `null`» (histórico anterior a la 73).

---

## Bloque 2 — Lectura (después del bloque 1)

### T4 — Ampliar `API_ORDEN_DETALLE_SELECT`
- **Depende de:** T2.
- **Hacer:** en `lib/repositories/OrdenRepository.ts` añadir las dos relaciones del design §3.1:
  `gestiones` (con `anuladaAt: null`, `orderBy` `[createdAt asc, id asc]`, `mensajero` anidado) y
  `historialEstados` de la **orden** (con `gestionOrdenId: { not: null }`).
  ⛔ **No** proyectar `motivo`, `montoRecibido`, `metodoPago`, `evidenciaStoragePath`, `cierreId`,
  `ubicacion*`, `pagoMensajero`, `indemnizacion`.
  ⛔ **No** tocar el `where` que ya alimenta `evidencias[]` (268/§b).
- **Hecho cuando:** compila y `tests/unit/services/api-orden-lectura-service.por-orden-id.test.ts`
  sigue verde sin editar sus expectativas de `evidencias[]`.

### T5 — `toApiOrdenDetalleRow` mapea `gestiones`
- **Depende de:** T3, T4.
- **Hacer:** construir el `Map<gestionId, estatusDestino.value>` en **una** pasada sobre el historial
  ya ordenado (primera entrada por gestión gana, R6) y mapear cada gestión a `ApiOrdenGestionRow`.
  `nombre` vía `nombreCompletoUsuario`. **Sin `find` dentro del bucle** (design §3.2).
- **Hecho cuando:** compila y el nodo del grafo de esa función reporta `linear_scan_in_loop = 0`.

### T6 — `ApiOrdenLecturaService.toDetalleDTO` copia `gestiones`
- **Depende de:** T5.
- **Hacer:** copia campo a campo desde la fila (**nunca** un spread de la fila del repo: es
  exactamente la fuga que la guardia de T9 busca). Ni Storage ni firma: las gestiones no llevan URL.
- **Hecho cuando:** `pnpm typecheck` verde y el detalle de una orden sin gestiones devuelve `[]`.

---

## Bloque 3 — Tests (el bloque que decide si la feature existe)

### T7 — Tests de servicio `[P]` con T8, T9
- **Depende de:** T6.
- **Archivo:** `tests/unit/services/api-orden-lectura-service.gestiones-405.test.ts` (nuevo).
- **Cubre:** R2, R4, R5, R7, R8.
- **Hecho cuando:** los cinco casos pasan **y** cada uno se ha matado con una mutación deliberada del
  mapeo que lo pone rojo (anotarlas en `progress/impl_405_backend.md`). Un test de servicio usa
  dobles y **no ve el SQL**: por eso R6/R10/R11/R13 no viven aquí, viven en T8.

### T8 — 🔴 Test de integración contra Postgres real `[P]` con T7, T9
- **Depende de:** T6.
- **Archivo:** `tests/integration/db/gestiones-detalle-api-405.test.ts` (nuevo).
  Molde: `tests/integration/db/eliminar-orden-api-frontera-tienda.test.ts` (helpers
  `_postgres-real`, `describe.skip` sin base — **jamás** un `return` silencioso que reporte `passed`).
- **Cubre:** R6, R10, R11, R13, R14, R18, R19.
- **Escenario mínimo:** dos tiendas reales; una orden con **cuatro** gestiones (una anulada, una
  `devuelta` con causa, una `reprogramada`, una legada sin fila de historial), más un
  `orden_incidente` de admin, más una orden de la otra tienda con gestiones.
- **R19:** contar las consultas emitidas (Prisma `$on("query")`) con 0 y con 4 gestiones: **el mismo
  número**.
- **R18:** `SELECT count(*)` y `max(updated_at)`/`created_at` de `gestion_orden` y
  `orden_historial_estado` antes y después de servir el detalle: idénticos.
- **Hecho cuando:** pasa **y** las contrapruebas quedan anotadas y restauradas:
  1. quitar `anuladaAt: null` → **rojo** (R11);
  2. quitar `tiendaId` del `where` → **rojo** (R13);
  3. invertir el `orderBy` → **rojo** (R10);
  4. tomar la **última** transición en vez de la primera → **rojo** (R6).

### T9 — Guardia de lista blanca y no-fuga `[P]` con T7, T8
- **Depende de:** T6.
- **Archivo:** `tests/unit/guards/gestiones-detalle-lista-blanca.guardia.test.ts` (nuevo).
  Molde: `tests/unit/guards/rastreo-dto-lista-blanca.guardia.test.ts`.
- **Cubre:** R3, R9, R12.
- **Hacer:** doble del repositorio que devuelve filas **más anchas que su contrato** (con
  `motivoLibre: "FUGA-MOTIVO-el-cliente-no-contesto"`, `storagePath`, `gestionId`, `cierreId`,
  `montoRecibido`, `ubicacionLat`, `telefonoMensajero`…). Comprobar:
  1. el conjunto **EXACTO** de claves de cada elemento es `{createdAt, resultado, estadoResultante,
     motivo, mensajero}` — conjunto entero, **no** `toContain`: una clave de más es una fuga;
  2. el de `mensajero` es exactamente el de la 404;
  3. ningún valor `FUGA-…` aparece en la respuesta serializada.
- **Hecho cuando:** pasa, y cambiar el mapeo a un spread de la fila lo pone rojo.

### T10 — Ampliar el test del handler
- **Depende de:** T6.
- **Archivo:** `tests/integration/api/ordenes-api-key-orden-consulta.route.test.ts` (existente).
- **Cubre:** R1, R17.
- **Hecho cuando:** el detalle devuelto por el handler lleva `gestiones` y los casos 401/403/422/404
  ya existentes siguen verdes **sin editar sus expectativas**.

### T11 — Test de no-regresión del DTO completo
- **Depende de:** T6.
- **Archivo:** `tests/unit/services/api-orden-lectura-service.por-orden-id.test.ts` (existente).
- **Cubre:** R15.
- **Hecho cuando:** una aserción sobre el objeto **entero** demuestra que los nueve campos de la 106 y
  `evidencias[]` valen exactamente lo de antes, con `gestiones` al lado.

---

## Bloque 4 — Contrato público (puede ir `[P]` con el bloque 3 salvo T13)

### T12 — Schema `OrdenGestion` en `lib/api/openapi-spec.ts`
- **Depende de:** T2.
- **Hacer:** design §4. `resultado` con `enum` **derivado**; `motivo` con `enum` derivado de
  `CAUSA_DEVOLUCION_SEED` + `CAUSA_INCIDENTE_SEED` + `null`; `estadoResultante` **sin `enum`** (Q8);
  `mensajero` por `$ref` al schema de la 404. `OrdenDetalle` referencia `OrdenGestion` y exige
  `gestiones`. Ejemplo de respuesta con **dos** elementos (uno `reprogramada` con `motivo: null`, uno
  `devuelta` con `motivo: "wrong_address"`). Descripciones con las **dos** advertencias: los dos
  `motivo`, y la asimetría de idioma (73/F1.4-g, 158/Q-B).
- **Hecho cuando:** compila y ningún `enum` del archivo es una lista de estados copiada a mano.

### T13 — Espejo en `docs/api/api-key-openapi.yaml`
- **Depende de:** T12. **No paralelizable con T12.**
- **Hacer:** replicar a mano, mismo orden de claves, mismos textos.
- **Hecho cuando:** T14 pasa.

### T14 — Test del contrato
- **Depende de:** T13.
- **Archivo:** `tests/unit/api/openapi-405-gestiones.test.ts` (nuevo). Molde:
  `tests/unit/api/openapi-contrato-en-reparto.test.ts`.
- **Cubre:** R16, R20, R21, R22.
- **Hacer:**
  1. `OrdenDetalle` declara `gestiones` y el `.yaml` es espejo exacto;
  2. el `enum` de `motivo` del detalle **coincide valor a valor** con el de `data.motivo` del webhook
     (dos fuentes independientes comparadas entre sí, no una contra sí misma);
  3. `Listado`/`OrdenListItem` y el cuerpo del webhook **no ganan ninguna clave**;
  4. `docs/api/CHANGELOG.md` tiene la entrada de la 405 con los tres avisos de R22.
- **Hecho cuando:** pasa, y borrar una clave del `.yaml` lo pone rojo.

### T15 — Entrada en `docs/api/CHANGELOG.md`
- **Depende de:** T12.
- **Hacer:** entrada fechada. Debe decir, en este orden y sin eufemismos:
  - qué gana el detalle y que **nada existente cambia**;
  - el mapeo de nombres: pediste `fecha`/`tipo`, se llaman `createdAt`/`resultado` **y por qué** (Q2);
  - **`motivo` es la causa TIPIFICADA**, con sus seis values, y **no** el comentario en texto libre
    del mensajero, que no sale del sistema;
  - la asimetría de idioma es **deliberada**: `not_found`/`wrong_number`/`wrong_address` en inglés,
    `danado`/`perdido`/`robado` en español, sin traducir;
  - `mensajero` es el **atribuido** a la gestión: en las gestiones que crea el sistema o la tienda
    (reprogramación de escritorio, escalado por plazo, rechazo manual, desenlace de ayuda, tope de
    intentos) es el mensajero de la última devolución, no quien la registró;
  - **`gestiones.length` NO es el contador de intentos de Ordenex**, que cuenta cierres aprobados
    distintos: varias gestiones del mismo cierre valen 1;
  - `estadoResultante` puede ser `null` en gestiones antiguas anteriores al historial;
  - `gestiones[]` no incluye anuladas ni los incidentes reportados por un admin (esos siguen en
    `evidencias[]`);
  - el array llega **completo, sin paginar**.
- **Hecho cuando:** el texto es **copiable y enviable tal cual**, sin redactar nada más, y la bitácora
  de la ficha enlaza a él. **Bloquea la release, no el código.**

---

## Bloque 5 — Cierre

### T16 — Mapa de trazabilidad
- **Depende de:** bloques 3 y 4.
- **Hacer:** volcar en `progress/impl_405_backend.md` la tabla `R1..R22 → archivo::nombre del test`,
  con la lista de mutaciones aplicadas y su resultado.
- **Hecho cuando:** los 22 requisitos tienen test y **ninguno** apunta a un test que no exista (el
  reviewer rechaza si falta uno; hay una guardia de tests citados y desaparecidos).

### T17 — Gate
- **Depende de:** T16.
- **Hacer:** `./init.sh --rapido`, escribiendo `INIT_EXIT=$?` **dentro** del log (un `echo` posterior
  tapa el código de salida).
- **Hecho cuando:** `INIT_EXIT=0` **y** se ha mirado el recuento de `skipped`: si `tests/integration/db`
  sale saltado por falta de `.env`, **T8 no se ha ejecutado** y el gate no vale.

### T18 — PR
- **Depende de:** T17.
- **Hacer:** PR a `dev`. Descripción con el veredicto de Q1, la tabla de trazabilidad y el enlace a la
  entrada del CHANGELOG.
- **Hecho cuando:** el PR está abierto con el gate verde adjunto. **Un check verde de Vercel es un
  build, no una suite**: no se mergea por el estado del PR.

### T19 — Aviso al integrador (bloquea la release, no el código)
- **Depende de:** T15 y el merge a `dev`.
- **Hacer:** mandar la entrada del CHANGELOG al integrador.
- **Hecho cuando:** consta mandado, con fecha, en la bitácora de la ficha. Sin esto **no sale a
  `prod`** (y antes de `prod`, `./init.sh` completo, sin excepción).
