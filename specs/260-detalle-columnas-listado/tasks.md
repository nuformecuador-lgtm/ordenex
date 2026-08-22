# Feature 260 — Tasks

> **Orden de ejecución: BLOQUE 0 → BLOQUE BACKEND → BLOQUE FRONTEND → GUARDIA → CIERRE.**
> Backend y frontend los implementan **agentes distintos** (`backend_dev` y `frontend_dev`),
> secuenciados: el frontend no arranca hasta que el contrato del bloque 0 está en disco y el
> backend está verde.
>
> `[P]` = paralelizable con las tareas marcadas igual **dentro de su bloque**.
>
> ✅ **Puerta humana resuelta el 2026-08-21.** Las cuatro preguntas están cerradas y escritas como
> requisitos (`requirements.md > Decisiones cerradas`). **No se reabren.**

---

## ⛔ GATE: esta feature va al gate COMPLETO, no al rápido

Se tocan **`lib/types/tablero-dia.ts`** y **`lib/types/orden.ts`**. `./init.sh --rapido` **se niega
solo** ante cualquier diff que toque `lib/types/**` (`docs/verification.md`): es un `fail`, no un
aviso. La verificación de esta feature —incluida la de abrir el PR— es **`./init.sh` completo**, sin
excepción.

Y lo corre el **leader**, no el subagente (`AGENTS.md > Regla del gate`). Cada `*_dev` corre sólo
`pnpm typecheck`, `pnpm lint` y `pnpm exec vitest related --run <sus archivos>`.

Recordatorio operativo (memoria del repo): el gate y las mutaciones **no** van en paralelo —el gate
leería un árbol a medio mutar y su veredicto no valdría—; y el exit code se escribe **dentro** del
log (`INIT_EXIT=$?`), que un `echo` posterior lo tapa.

---

## BLOQUE 0 — El contrato (lo escribe `backend_dev`; el frontend depende de él)

- [x] **T0.1 · El contacto de la tienda pasa a ser opcional.** En `lib/types/orden.ts`,
      `OrdenTiendaRef.email` y `.telefono` pasan a `email?: string` / `telefono?: string`. Es lo que
      hace **representable** el recorte de R13 sin declarar un segundo tipo (`design.md §3.1`).
      **Hecho:** `pnpm typecheck` verde **sin tocar ningún consumidor** —está medido que se escriben
      en `OrdenRepository.ts:465-466` y no los lee nadie (`design.md §1.10`)—, y el comentario del
      tipo dice por qué son opcionales y quién los envía siempre.
      → **R13, R43**

- [x] **T0.2 · El contrato compartido.** En `lib/types/tablero-dia.ts`: `OrdenDetalleDia` pasa a ser
      `OrdenListItemDTO & { resultadoDelDia; asignadoAt }` (`import type` de `@/lib/types/orden`), y
      `DetalleMensajeroDia` gana `alcance: "global" | "zona"`.
      **Hecho:** `pnpm typecheck` señala **exactamente** los consumidores que hay que migrar (esa
      lista roja ES el inventario del trabajo restante); un test afirma que `OrdenDetalleDia` es
      **asignable** a `OrdenListItemDTO` (es lo que sostiene el montaje de `ordenesColumns` sin
      cast); y `lib/types/tablero-dia.ts` no importa nada de `repositories/`, `services/`,
      `@/lib/db` ni `next/headers`. Depende de T0.1. → **R1, R12**

- [x] **T0.3 · La lista única de lo restringido y su recorte.** En el mismo módulo:
      `CAMPOS_SOLO_ALCANCE_GLOBAL` (`orden: [fleteConIva, comisionConIva]`,
      `tienda: [email, telefono, tarifa]`) con su `satisfies` contra `keyof OrdenListItemDTO` y
      `keyof OrdenTiendaRef`, y `recortarPorAlcance(orden, alcance)` pura.
      **Hecho:** test unitario que, sobre un DTO con los cinco campos poblados con **centinelas**,
      afirma que con `"zona"` no sobrevive ninguno, que con `"global"` sobreviven **todos**, y que
      el resto del objeto queda intacto (`montoCobrar` incluido). Un rename en `lib/types/orden.ts`
      deja de compilar aquí. Depende de T0.2. → **R13, R17, R43, R46**

---

## BLOQUE BACKEND (`backend_dev`)

- [x] **B1 · El puerto del tablero adelgaza.** En `ITableroDiaRepository`: `PaginaOrdenesDelDia`
      pasa a `{ filas: FilaDelDia[]; total }` con `FilaDelDia = { ordenId, resultadoDelDia,
      asignadoAt }`.
      **Hecho:** compila y `tests/unit/services/_doble-tablero-dia.ts` queda actualizado.
      Depende de T0.2. → **R3**

- [x] **B2 · El `SELECT` de la 2ª consulta adelgaza.** En `TableroDiaRepository.listarOrdenesDelDia`:
      se retiran `num_guia`, `s."value"`, `destinatario`, `direccion` y el `JOIN "order_status"`.
      **No se toca** el `WITH ids_del_dia`, ni el `LATERAL`, ni el `COUNT(*) OVER ()`, ni el
      `ORDER BY`, ni el `LIMIT/OFFSET`, ni la POSICIÓN de la consulta en el archivo.
      **Hecho:** `tests/unit/tablero-dia/frontera.guardia.test.ts` verde —sigue habiendo **3**
      consultas clasificadas `["agregada","paginada","agregada"]`— y
      `tests/unit/repositories/tablero-dia-detalle-sql.test.ts` actualizado a la nueva proyección.
      Depende de B1. → **R3, R8, R38**

- [x] **B3 · El método de hidratación.** `findListItemsByIds(ids, filtro: FiltroAlcanceTablero)` en
      `IOrdenRepository` + `OrdenRepository`, reusando `WITH_ESTATUS_Y_TIENDA` y `toListItemDTO`.
      Lista vacía → `[]` sin consultar.
      **Hecho:** test de repositorio que afirma el `where` (`id: { in: ids }`, `deletedAt: null`,
      `zonaId` sólo con alcance `zona`) **y** que no se declara ninguna proyección nueva: el
      `include` es literalmente el mismo objeto que usa `list()`. `[P]` con B4.
      → **R2, R11, R19, R40**

- [x] **B4 · [P] El test que mata el `WHERE` donde vive.** Test de **integración** contra Postgres:
      una orden borrada y una orden de otra zona **no** vuelven de `findListItemsByIds`, aunque su
      id esté en la lista.
      **Hecho:** el test se demuestra ROJO mutando el `where` (quitar `deletedAt: null`, y quitar el
      `zonaId`), y el resultado de las dos mutaciones queda pegado en `progress/impl_260.md`. Un
      test de servicio con dobles **no ve el SQL** —medido cuatro veces en este repo—, así que este
      paso no es opcional. `[P]` con B3. → **R11, R19**

- [x] **B5 · La composición en el servicio.** `TableroDiaService.detalle`: autorizar → página del
      día → si 0 filas, detalle vacío sin más consultas → `Promise.all([findListItemsByIds,
      contarIntentosEnLote])` → reordenar por los ids de la página, anexar `resultadoDelDia` y
      `asignadoAt`, descartar ids sin fila → **`recortarPorAlcance`** → devolver con `alcance`,
      `total`, `pagina`, `pageSize`.
      **Hecho:** tests de servicio para: orden preservado (R4), cero filas ⇒ **cero** llamadas a los
      dos colaboradores (R5), intentos mergeados con `0` para las que no tienen (R6), un id que no
      resuelve se omite (R7), el filtro que llega al repo de órdenes es el mismo de la
      autorización (R11), el detalle trae `alcance` (R12), y el payload de alcance `global` **no**
      pierde nada (R46). Depende de T0.3, B1, B3.
      → **R4, R5, R6, R7, R9, R10, R11, R12, R13, R46**

- [x] **B6 · Cableado y firma del constructor.** `TableroDiaService(repositorio, ordenes, historial,
      cache = tableroDiaCacheNula())` — `ordenes` e `historial` **obligatorios** (opcionales dejarían
      que alguien los olvidara y el detalle saliera vacío sin ponerse rojo). `construirServicio()` en
      `lib/actions/tablero-dia.ts` los instancia.
      **Hecho:** actualizadas **todas** las construcciones existentes —`tablero-dia-alcance`,
      `tablero-dia-detalle-alcance`, `tablero-dia-filas`, `tablero-dia-cache`,
      `tablero-dia-cache-aislamiento.guardia`, `tablero-dia-ritmo`, `_doble-tablero-dia.ts`— y
      `pnpm typecheck` verde. Depende de B5. → **R6, R10**

- [x] **B7 · Los tres casos malos siguen siendo indistinguibles.** Revisar que ningún camino nuevo
      pueda distinguirlos: la hidratación no se ejecuta con cero filas, y el `denegado` sigue
      saliendo antes de cualquier consulta.
      **Hecho:** `tests/unit/actions/tablero-dia-detalle-accion.test.ts` y
      `tests/unit/services/tablero-dia-detalle-alcance.test.ts` actualizados y verdes; se afirma
      que las respuestas de los tres casos son **byte a byte** la misma salvo la fecha.
      Depende de B5. → **R31, R32, R33**

- [x] **B8 · Aislamiento de extremo a extremo.** Ampliar
      `tests/integration/tablero-dia-detalle-aislamiento.test.ts`: un actor de zona A que pide el
      detalle de un mensajero con órdenes de A **y** de B recibe sólo las de A, **ya hidratadas**, y
      sin ninguno de los cinco campos restringidos.
      **Hecho, CON CORRECCIÓN (2026-08-21):** este criterio **no es alcanzable como estaba
      escrito**, y se deja dicho en vez de fingirlo. Se ejecutó la mutación —quitar el `filtro`
      de la hidratación— y el test **siguió verde**, y no por flojo: `listarOrdenesDelDia` ya
      aplica `fragmentoDeAlcance` en su `WHERE`, así que la consulta del día entrega sólo ids de
      la zona y hidratar con filtro global devuelve **las mismas filas**. Ese segundo filtro es
      defensa en profundidad y sólo es observable entrando por la puerta que se salta la primera
      consulta. **La garantía real vive en `tests/integration/orden-list-items-by-ids.test.ts`**,
      que llama al método directo con un id de otra zona; ahí la mutación SÍ mata. Verificado por
      el reviewer leyendo el SQL: la explicación es cierta, no cómoda.
      Depende de B5. → **R11, R13**

- [x] **B9 · [P] Cuadre con la tarjeta.** `tests/integration/tablero-dia-detalle-cuadre.test.ts`
      sigue verde: el `total` del detalle cuadra con `asignadas` de la tarjeta.
      **Hecho:** verde sin tocar su aserción de cuadre. Depende de B5. → **R3, R8**

- [x] **B10 · [P] Solo lectura.** `tests/unit/tablero-dia/asignado-at-solo-lectura.guardia.test.ts`
      verde: la feature sigue sin escribir. **Hecho:** verde. → **R36**

---

## BLOQUE FRONTEND (`frontend_dev`) — arranca con el backend verde

- [x] **F1 · El módulo de columnas.** Nuevo
      `app/(app)/monitoreo/_components/detalle-columnas.ts`: `COLUMNA_RESULTADO_ID`,
      `COLUMNAS_SOLO_ALCANCE_GLOBAL`, `PRIMERAS` y `columnasDetalle(alcance)` que **deriva** de
      `ordenesColumns` (añade la propia, quita las restringidas fuera de `global`, reordena).
      Parte de `ordenesColumns`, **nunca** de `ordenesColumnsReprogramada`.
      **Hecho:** el archivo no escribe ni un hex, ni una utilidad de paleta cruda, ni
      `badgeVariants`, ni un par `-soft`/`-strong`, ni un literal de tamaño de página, ni un
      identificador que empiece por `sumar`, ni lee `.rol`.
      → **R20, R22, R23, R24, R27, R45**

- [x] **F2 · El test de las columnas, derivado y no literal.** Afirma, en los dos alcances, que los
      ids montados son **exactamente** los calculados desde `ordenesColumns.map(c => c.id)` (más la
      propia, menos las restringidas), que los cinco de `PRIMERAS` van delante y en ese orden, y que
      **`liberada` no está** en ninguno de los dos.
      **Hecho:** se demuestra rojo añadiendo una columna ficticia a la lista esperada, y el test
      **no** contiene una lista literal de ids —eso sería la aserción-contra-su-propia-fuente que
      este repo ya pagó—. Depende de F1. → **R14, R16, R23, R25, R26, R45**

- [x] **F3 · El panel monta las columnas.** `DetalleMensajeroPanel.tsx`: fuera la constante
      `COLUMNAS` de cuatro, dentro `columnasDetalle(detalle.alcance)`; `rowKey="id"`; sin
      `renderExpanded`, sin `descarga`, sin `filtros`. `Modal` + `DataTable` + `Pagination` siguen
      importándose **en este archivo** (lo exige la cláusula (g) del guardia de primitivas).
      **Hecho:** `tests/unit/tablero-dia/primitivas.guardia.test.ts` verde. Depende de F1.
      → **R20, R21, R29, R30**

- [x] **F4 · Actualizar `tests/components/DetalleMensajeroPanel.test.tsx`.** Está anclado a las
      cuatro columnas y **se va a poner rojo**: no es una sorpresa, es esta tarea.
      Qué cambia: el constructor de fixture `orden()` pasa a producir un `OrdenListItemDTO` completo
      (patrón `makeOrden` de `tests/unit/components/ordenes-columns.test.tsx`); el test «muestra
      CUATRO columnas y ninguna más» se sustituye por el de F2; el censo de fuente deja de exigir el
      import de `EstatusBadge` **en el panel** y pasa a exigir `ordenes-columns` + `estatus-label`
      (el vocabulario compartido sigue consumiéndose, sólo cambia de archivo).
      Qué **no** cambia y debe seguir verde tal cual: apertura con ratón y con teclado, `?mensajero=`
      en la URL, cierre con Escape y con «Cerrar» conservando el resto de parámetros, los tres casos
      malos con el mismo texto y sin tabla, el `pageSize` que viene del servidor, el avatar de
      iniciales, y que abrir/cerrar no re-consulta el tablero.
      **Hecho:** todos los `describe` preexistentes verdes o migrados con su motivo escrito.
      Depende de F3. → **R9, R21, R30, R31, R32, R33, R34**

- [x] **F5 · La mitad de pantalla del recorte.** Test que monta el detalle con `alcance: "zona"` y un
      DTO **completamente poblado** (flete, comisión, tarifa y contacto de la tienda incluidos, como
      si el servidor se hubiera olvidado de recortar) y afirma que las cabeceras «Flete + IVA»,
      «Fulfillment» y «Comisión + IVA» **no están**, que «Monto a cobrar» **sí**, y que ninguna celda
      pinta `₡0` ni «—» en lugar de un dato retirado. Y el simétrico con `alcance: "global"`.
      **Hecho:** rojo si se quita el filtrado de `COLUMNAS_SOLO_ALCANCE_GLOBAL`. Depende de F3.
      → **R14, R15, R16, R17**

- [x] **F6 · Ancho y scroll, EN EL NAVEGADOR.** Con el modal abierto y datos reales, a 1280 / 1024 /
      830 / 768 px y en las dos densidades: la tabla desborda **dentro** de su caja, aparecen las
      flechas, ninguna cabecera ni celda queda recortada, y el diálogo no gana barra horizontal
      propia. Si falta un `min-w-0`, va en el envoltorio del panel — **nunca** en `Modal` ni en
      `DataTable`.
      **Hecho:** medido sobre **la caja que contiene**, no sobre la pieza recién tocada (la 258 dejó
      tres mediciones verdes sobre una pantalla con un número recortado), y anotado en
      `progress/impl_260.md`. Depende de F3. → **R28**

- [x] **F7 · [P] La guardia del dinero alcanza a `/monitoreo`.** Añadir
      `app/(app)/monitoreo/_components/detalle-columnas.ts` a `TABLAS_DE_ORDENES` y
      `app/(app)/monitoreo/_components` a `ARBOLES` en
      `tests/unit/guards/ordenes-columnas-money-safe.guardia.test.ts`.
      **Hecho:** el guardia sigue verde con el árbol real, y se demuestra que **muerde** en su nuevo
      territorio metiendo un `valorFleteGam` de prueba en el módulo nuevo y viéndolo rojo.
      → **R41**

---

## GUARDIA — la que impide volver atrás (R44)

- [x] **V1 · `tests/unit/tablero-dia/recorte-por-alcance.guardia.test.ts`.** Cuatro cláusulas
      (`design.md §5.3`), atadas por **centinelas** porque las dos mitades hablan vocabularios
      distintos:
      **(a)** `recortarPorAlcance(dto, "zona")` no deja ningún centinela; con `"global"` los deja
      todos. **(b)** El detalle que devuelve el **servicio real** para un actor de alcance `zona`,
      **serializado a JSON**, no contiene ningún centinela —serializar es lo que caza un campo
      anidado que nadie listó—. **(c)** `columnasDetalle("zona")` renderizada sobre el DTO **sin
      recortar** no pinta ningún centinela; con `"global"` los pinta. **(d)** no vacía.
      **Hecho — y esto no se afirma, se ejecuta y se pega:** las **tres mutaciones** ponen roja su
      cláusula, con la salida real en `progress/impl_260.md`:
      1. `recortarPorAlcance` devuelve la orden sin tocar ⇒ (a) y (b) rojas;
      2. el servicio deja de llamarla para `zona` ⇒ (b) roja;
      3. `columnasDetalle` deja de filtrar `COLUMNAS_SOLO_ALCANCE_GLOBAL` ⇒ (c) roja.
      Si alguna mutación **no** pone roja su cláusula, la cláusula es decorado y se arregla antes de
      seguir (este repo ya pagó por un arnés de mutaciones que reportó supervivientes sin haber
      ejecutado un test). Depende de B5 y F1. → **R44**

---

## CIERRE

- [x] **C1 · La reversión de R49, con fecha y motivo.** Anotar en
      `specs/192-tablero-dia-mensajeros/requirements.md` junto a R49 (sin borrarlo) y sustituir el
      docstring de `COLUMNAS` en `DetalleMensajeroPanel.tsx` por la nota de reversión.
      **Hecho:** las dos anotaciones llevan fecha `2026-08-21` y el motivo, y R49 sigue legible.
      → **R42**

- [x] **C2 · Techo de superficie.** Test que afirma que las claves de un elemento del detalle son un
      **subconjunto** de las de un `OrdenListItemDTO` (más `resultadoDelDia` y `asignadoAt`), nunca
      un superconjunto.
      **Hecho:** rojo si se añade un campo propio al elemento del detalle. → **R18, R43**

- [x] **C3 · Guardias del árbol, íntegras.** `frontera.guardia`, `primitivas.guardia`,
      `buckets-estatus.guardia`, `cache-sin-invalidacion.guardia`,
      `asignado-at-solo-lectura.guardia` y la nueva `recorte-por-alcance.guardia` verdes con los
      archivos nuevos ya en el árbol.
      **Hecho:** las seis verdes. → **R35, R37, R38, R39, R44**

- [x] **C4 · Gate completo.** `./init.sh` (NO `--rapido`) en verde sobre el árbol final, con el exit
      code escrito dentro del log. Antes de abrir el PR, comparar el SHA medido con `origin/dev`:
      el pre-vuelo caduca.
      **Hecho:** salida real pegada en `progress/impl_260.md`, con nº de archivos y de tests.
      → gate

- [x] **C5 · Mapa `R<n> → test`.** (Vive partido entre `impl_260_backend.md` §7 e `impl_260_frontend.md` §10; el reviewer cruzó los 46 uno a uno y cubren 46/46.) Los **46** requisitos, cada uno con su
      test concreto. Un requisito sin test es hallazgo bloqueante del reviewer.
      **Hecho:** 46/46 mapeados.

---

## Mapa `R<n> → test` (previsto)

| R | Test |
| --- | --- |
| R1 | `tests/unit/tablero-dia/detalle-contrato.test.ts` — el elemento es **asignable** a `OrdenListItemDTO` |
| R2 | `tests/unit/repositories/orden-repository-list-items-by-ids.test.ts` — mismo `include` y mismo mapeo que `list()` |
| R3 | `tests/unit/repositories/tablero-dia-detalle-sql.test.ts` + `tests/integration/tablero-dia-detalle-cuadre.test.ts` |
| R4 | `tests/unit/services/tablero-dia-detalle-hidratacion.test.ts` — orden preservado |
| R5 | idem — cero filas ⇒ cero llamadas a los colaboradores |
| R6 | idem — intentos mergeados, `0` incluido |
| R7 | idem — id que no resuelve se omite |
| R8 | `tests/integration/tablero-dia-detalle-cuadre.test.ts` |
| R9 | `tests/components/DetalleMensajeroPanel.test.tsx` — `pageSize` del servidor + `primitivas.guardia` (e) |
| R10 | `tests/unit/services/tablero-dia-detalle-alcance.test.ts` |
| R11 | `tests/integration/tablero-dia-detalle-aislamiento.test.ts` + integración de B4 (el `WHERE` contra Postgres) |
| R12 | `tests/unit/services/tablero-dia-detalle-hidratacion.test.ts` — el detalle trae `alcance` |
| R13 | `tests/unit/tablero-dia/recorte-por-alcance.guardia.test.ts` (a) y (b) |
| R14 | idem (c) + `tests/unit/components/detalle-columnas.test.ts` |
| R15 | `tests/unit/components/detalle-columnas.test.ts` — ninguna celda pinta `₡0` ni «—» por un dato retirado |
| R16 | idem, alcance `global` |
| R17 | idem — «Monto a cobrar» en los dos alcances |
| R18 | `tests/unit/tablero-dia/detalle-contrato.test.ts` (C2) |
| R19 | integración de B4 — la borrada no vuelve |
| R20 | `tests/unit/components/detalle-columnas.test.ts` — ids derivados de `ordenesColumns` |
| R21 | `tests/components/DetalleMensajeroPanel.test.tsx` — sin checkbox, sin «Acciones», sin descarga, sin filtros; censo de fuente sin `OrdenesListado` |
| R22 | `tests/unit/components/detalle-columnas.test.ts` — una y sólo una columna propia |
| R23 | idem — las cinco primeras y en ese orden |
| R24 | idem + censo de fuente: una sola declaración de orden |
| R25 | idem — cada id de `PRIMERAS` existe |
| R26 | idem — el conjunto se calcula desde `ordenesColumns`, no de una lista literal |
| R27 | `frontera.guardia` (f) + `detalle-columnas.test.ts` — «—» con resultado nulo |
| R28 | F6 (navegador, anotado en `progress/impl_260_frontend.md §R28`) + `DetalleMensajeroPanel.test.tsx` monta una sola tabla |
| R29 | `tests/components/DetalleMensajeroPanel.test.tsx` — `rowKey="id"` |
| R30 | idem — sin «Confirmar», con «Cerrar» |
| R31 | idem — los tres casos malos, mismo texto |
| R32 | idem — mismo texto, misma ausencia de tabla, mismo diálogo abierto |
| R33 | idem — `?mensajero=` dispara la Server Action |
| R34 | idem — el tablero no re-consulta |
| R35 | `tests/unit/tablero-dia/cache-sin-invalidacion.guardia.test.ts` + `tablero-dia-detalle-alcance` (el detalle no pasa por caché) |
| R36 | `tests/unit/tablero-dia/asignado-at-solo-lectura.guardia.test.ts` |
| R37 | `tests/unit/tablero-dia/frontera.guardia.test.ts` (d) |
| R38 | idem — 3 consultas, `["agregada","paginada","agregada"]` |
| R39 | idem (c) |
| R40 | `tests/unit/services/tablero-dia-detalle-hidratacion.test.ts` — la lista de ids es la de la página, acotada |
| R41 | `tests/unit/guards/ordenes-columnas-money-safe.guardia.test.ts` (censo ampliado) |
| R42 | `tests/unit/tablero-dia/reversion-r49.guardia.test.ts` — censo de fuente: la nota fechada existe y R49 sigue legible |
| R43 | `tests/unit/tablero-dia/detalle-contrato.test.ts` — una sola declaración: el `satisfies` de `CAMPOS_SOLO_ALCANCE_GLOBAL` y la asignabilidad del elemento |
| R44 | `tests/unit/tablero-dia/recorte-por-alcance.guardia.test.ts` (d) + las tres mutaciones ejecutadas en `progress/impl_260.md` |
| R45 | `tests/unit/components/detalle-columnas.test.ts` — `liberada` no está en ninguno de los dos alcances |
| R46 | `recorte-por-alcance.guardia` (a) con `"global"` + `tablero-dia-detalle-hidratacion` — el payload global no pierde nada |

---

## Riesgos operativos a tener presentes

- **Conflicto de archivo con la 259**, que ya tiene spec. Las dos tocan
  `lib/repositories/TableroDiaRepository.ts` (`design.md §8`). No se lanzan en paralelo:
  `AGENTS.md > Paralelismo` bloquea por intersección de archivos. La 260 **no replica** el predicado
  de la 259: lo hereda tal como esté.
- **Un PR verde no dice nada de los tests.** El único check automático es un build de Vercel. El
  veredicto es el `./init.sh` completo del leader, y hay que volver a correrlo **después** del merge
  a `dev`.
- **`.next/dev` truncado.** Si el typecheck señala errores dentro de archivos generados, es un dev
  server muerto: `rm -rf .next/dev` antes de diagnosticar nada.
