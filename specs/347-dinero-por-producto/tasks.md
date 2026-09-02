# Ficha 347 — Tareas

> Checklist verificable. `[P]` = paralelizable con las de su mismo bloque.
> Cada tarea lleva su criterio de HECHO. Sin criterio, no está hecha.
>
> **Secuencia de bloques:** T0 → B (backend) → F (frontend) → G (guardias y censos) → V
> (verificación). B y F **no se paralelizan entre sí**: la ficha es `fullstack` y F consume el
> contrato que B publica (`progress/impl_347.md §contrato`, como hizo la 345).

---

## T0 — Antes de tocar nada (bloqueante)

- [ ] **T0.1 — Confirmar los 14 símbolos EN DISCO**, no en el índice del MCP (que devuelve de
      más). Lista: `derivarIngresoOrden`, `pagoTiendaOrdenex`, `resolverFlete`,
      `CRITERIO_DE_APORTE`, `CRITERIO_COD_RECAUDADO`, `satisfaceCriterio`, `CriterioDeAporte`,
      `OrdenCongelada`, `GestionDelCierre`, `tarifaDe`, `DETALLE_SELECT`,
      `condicionesDeConsulta`, `claveConPrefijo`, `etiquetaDeDesenlace`.
      **HECHO:** tabla símbolo → archivo → línea en `progress/impl_347.md`. Si alguno no está,
      **PARAR** y avisar al leader antes de escribir código.

- [ ] **T0.2 — Fotografiar los censos en VERDE y anotar los números de partida.** Los cinco:
      `cobertura-tablas.guardia`, `columnas-sensibles.guardia`,
      `columnas-asercion-de-orden.guardia`, `alcance-fuente-unica.guardia`,
      `alcance-dinero.guardia`.
      **HECHO:** en la bitácora, los valores actuales de `TOTAL_ARCHIVOS_CON_DATATABLE`,
      `TOTAL_INSTANCIAS_DATATABLE`, `totalCensado`, número de tablas `con_descarga` y `fuera`, y
      `METRICAS.length`. **Medidos, no copiados de este spec.**

- [ ] **T0.3 — Medir el coste de la consulta de dinero** con el SQL de `design.md §5.2` sobre la
      base alcanzable, sin filtro de fecha.
      **HECHO:** filas devueltas, órdenes distintas, wall time y `EXPLAIN ANALYZE`. Y la
      **comparación con la de volumen**: cuántas filas devuelve cada una sobre el mismo recorte —
      es el número que sostiene la decisión de `design.md §1` y el que responde a ⟨Q4⟩.

- [ ] **T0.4 — Comprobar que `claveConPrefijo` NO incluye ningún campo nuevo** de la consulta.
      **HECHO:** una línea en la bitácora citando el cuerpo de la función. Es la premisa de R9 y
      de `design.md §6.3`; si resultara falsa, el sufijo sobra y hay que decirlo.

---

## B — Backend

### B1 — El módulo puro del dinero

- [ ] **B1.1 [P]** — `lib/utils/dinero-por-producto.ts`: `CRITERIO_RECAUDO_ENTREGA`,
      `RESULTADOS_QUE_APORTAN` (**derivado**, `design.md §4.5`) y `repartoDeOrden`.
      Sin Prisma salvo `Decimal`. Sin `Number(`, `parseFloat(`, `parseInt(`.
      **HECHO:** el módulo compila, no importa repositorios ni servicios, y `repartoDeOrden`
      devuelve cuatro STRING escala 2. Depende de T0.1.

- [ ] **B1.2** — `tests/unit/utils/dinero-por-producto.test.ts`: las dos invariantes (R20, R21),
      el retorno fuera del reparto (R19), la gestión sin tarifa congelada que no deriva nada
      (R23), la orden en DOS cierres (R18), y que `RESULTADOS_QUE_APORTAN` **se deriva**.
      **HECHO:** el caso del concepto inyectado (mutación M4) pone rojo el test de derivación, con
      la línea de fallo copiada.

- [ ] **B1.3** — Ampliar `tests/unit/utils/aporte-por-orden-equivalencia.test.ts` con el criterio
      nuevo: para todas las combinaciones de (resultado × cobraComision × hayTarifa ×
      hayMontoRecibido), `satisfaceCriterio(CRITERIO_RECAUDO_ENTREGA, …)` coincide con «esa
      gestión recaudó».
      **HECHO:** el test existente sigue verde y el bloque nuevo también. Depende de B1.1.

### B2 — Alcance, consulta preparada y caché

- [ ] **B2.1** — `ALCANCE_PRODUCTOS_DINERO` en `lib/analytics/metrics.ts`.
      **HECHO:** `METRICAS.length` **no se mueve**, `alcance-fuente-unica.guardia` sigue verde y
      la tabla es exhaustiva (omitir un rol no compila).

- [ ] **B2.2** — `lib/analytics/productos-consulta.ts`: `resolverAlcanceProductosDinero`, el campo
      `dinero` en `ConsultaProductos`, el quinto paso de `prepararConsultaProductos` y el sufijo
      de la clave de caché (`design.md §6.3`).
      **HECHO:** un `denegado` de dinero **no** deniega la lectura, la apaga. Depende de B2.1.

- [ ] **B2.3** — `tests/unit/analytics/productos-dinero-alcance.test.ts`: R1, R2 (rol por rol),
      R3, R4, R5, R8, R9.
      **HECHO:** R2 se afirma recorriendo `ROLES_ANALITICA` y comparando contra
      `ALCANCE_PRODUCTOS`, **no** con una lista escrita. Mutación M5 (quitar el sufijo) ⇒ rojo,
      con línea copiada. Depende de B2.2.

### B3 — El repositorio del dinero

- [ ] **B3.1** — `lib/interfaces/repositories/IDineroProductosRepository.ts` y
      `lib/repositories/DineroProductosRepository.ts` con el SQL de `design.md §5.2`.
      Recibe `ConsultaProductos` en la firma; **importa** `condicionesDeConsulta`; **no escribe
      ninguna condición de recorte propia**; los importes salen ya como STRING.
      **HECHO:** `alcance-obligatorio.guardia` sigue verde sin ampliar `TIPOS_OPACOS`.
      Depende de B2.2.

- [ ] **B3.2** — `tests/unit/analytics/dinero-productos-sql.test.ts`: el `where` es **el mismo**
      fragmento a fragmento que el de la 345 (R75), el alcance es la **primera** condición, el id
      viaja como parámetro y no incrustado, el `LATERAL` está (y su ausencia rompe, `design.md
      §5.1`), `resultado IN (...)` sale de `RESULTADOS_QUE_APORTAN`, y las órdenes borradas
      quedan fuera (R74).
      **HECHO:** cada afirmación con su caso; el nombre del caso describe el comportamiento.

- [ ] **B3.3** — `tests/integration/repositories/dinero-productos.int.test.ts` contra **Postgres
      real**: aislamiento por tienda (R7/R43), una orden en dos cierres (R18), una entregada sin
      cierre aprobado (R26/R28), una rechazada liquidada (R19), y el tope (R76).
      **HECHO:** **ninguna rama `if (!datos) return;`** — si la siembra no produjo el caso, el
      test falla. Mutación M2 ⇒ rojo, con línea copiada. Depende de B3.1.

### B4 — El servicio y el DTO

- [ ] **B4.1** — `lib/types/conteo-productos.ts`: `+ ordenesAcompanadas` por fila, `+ dinero`
      (`DineroProductoDTO | null`) y el estado de tope. Sin Prisma, sin zod.
      **HECHO:** todo importe tipado `string`; ninguno `number`.

- [ ] **B4.2** — `ConteoProductosService`: segunda consulta condicionada a
      `consulta.dinero === "concedido"`, fusión con el MISMO parser (`design.md §5.3`),
      `ordenesAcompanadas` en `fundir()`, y `lastSync` **uno solo** dentro del productor.
      **HECHO:** con el dinero denegado, el repositorio de dinero **no se llama ni una vez**
      (test con doble que cuenta llamadas). Depende de B3.1, B4.1.

- [ ] **B4.3** — `lib/actions/conteo-productos.ts`: construye el servicio con los dos
      repositorios. Sin literales de rol, sin resolver alcance por su cuenta.
      **HECHO:** `superficie-de-uso.guardia` no reporta la acción (ya la importa el componente).

- [ ] **B4.4** — Tests del servicio: R11–R21, R25, R30. Incluye el caso de la orden en dos cierres
      contada UNA vez (R18) y el de «sin nada liquidado ⇒ `null`, no `"0.00"`» (R30).
      **HECHO:** mutaciones M1, M3, M6, M10 ⇒ rojo, con línea copiada de cada una.
      Depende de B4.2.

### B5 — El detalle orden por orden

- [ ] **B5.1 [P]** — `lib/config/dinero-productos.ts` (molde de `lib/config/detalle-movimiento.ts`)
      y `lib/types/dinero-productos.ts`.
      **HECHO:** ningún número de página escrito como literal fuera de este archivo; test de
      config con las mismas comprobaciones que su hermano.

- [ ] **B5.2** — `lib/services/DetalleDineroProductoService.ts`: filtra por clave con el parser,
      excluye las órdenes con las cuatro cifras en cero (R39), ordena de forma total, pagina y
      cuenta el total **sobre el conjunto** (R40). Devuelve `totales` (R38).
      **HECHO:** el total nunca es `items.length`; mutación M7 ⇒ rojo. Depende de B3.1, B5.1.

- [ ] **B5.3** — `lib/actions/detalle-dinero-producto.ts`: el `tienda_id` entra **como faceta del
      filtro** (`design.md §7.2`), `.strict()`, y la denegación no revela el motivo (R10, R44).
      **HECHO:** una tienda ajena da `forbidden`, **no** un resultado vacío. Depende de B5.2.

- [ ] **B5.4** — Tests del detalle: R32, R35, R36, R37, R38, R39, R40, R41, R42, R43, R44.
      **HECHO:** el test de cuadre lleva **las cinco aserciones de `design.md §10`**, incluidas
      «no vacía» y «no cero». Depende de B5.3.

---

## F — Frontend

> No empieza hasta que B esté cerrado y el contrato escrito en `progress/impl_347.md`.

- [ ] **F1 [P]** — `otros-resultados.ts` + `tests/unit/analytics/otros-resultados.test.ts`:
      R50–R56. El caso del **sexto desenlace inyectado** (`vi.doMock` + `vi.resetModules()`, como
      hizo la 346) es obligatorio.
      **HECHO:** mutación M8 (lista escrita a mano) pasa el resto de casos y **cae** en ése, con
      la línea copiada. Es la única prueba de que se deriva.

- [ ] **F2** — `lib/analytics/presentacion.ts`: `+ productosDinero`, derivado de
      `ALCANCE_PRODUCTOS_DINERO`. Etiqueta, no `boolean` (`design.md §6.4`).
      **HECHO:** `tests/unit/analytics/presentacion.test.ts` cubre los cinco roles.

- [ ] **F3** — `app/(app)/analitica/page.tsx`: pasa `productosDinero` a la tabla. **Sin importar
      `metrics` ni `alcance`** (allowlist nominal de la ruta).
      **HECHO:** `tablero-operativo-frontera.guardia` verde. Depende de F2.

- [ ] **F4** — `ProductosTabla.tsx`: tres columnas de dinero, las dos líneas de contexto, el
      aviso de no-sumable, la composición de «Otros resultados», la fila que se abre y la vista de
      teléfono.
      **HECHO:** `money()` de `lib/config/moneda` en todo importe; **cero** llamadas de
      `LLAMADAS_PROHIBIDAS_EN_DINERO` en el archivo. Depende de F1, F2.

- [ ] **F5** — `DineroProductoDetalle.tsx` + `dinero-producto-swr.ts`: el panel, montado sólo al
      abrir (R33), con su paginación de servidor y su cabecera de `totales` (R38).
      **HECHO:** con las filas cerradas, la acción del detalle **no se llama** (test que cuenta
      llamadas). Depende de B5.3, F4.

- [ ] **F6** — Tests de componente: R6, R29, R30, R45, R46, R57, R59, R60, R61, R62, R63, R64,
      R65, R33, R34.
      **HECHO:** mutaciones M6 y M9 ⇒ rojo. Depende de F4, F5.

---

## G — Descarga, guardias y censos

- [ ] **G1** — `analitica-productos-descarga-columnas.ts`: columnas de dinero **condicionadas** a
      la concesión (R66/R67), la composición de «Otros resultados» como **una sola columna de
      texto** (R58), y la marca de no-sumable en los encabezados (R49).
      **HECHO:** los `toEqual` de claves y encabezados reescritos **a mano**, no derivados de la
      constante (`columnas-asercion-de-orden.guardia`). Depende de F4.

- [ ] **G2 [P]** — `detalle-dinero-producto-descarga-columnas.ts` + su test (R68–R72).
      **HECHO:** ningún uuid en el archivo; importe ausente = celda vacía, nunca `0`.
      ⟨Q5⟩: si el humano recorta esta pieza, se borran G2 y su entrada de censo. Depende de F5.

- [ ] **G3** — `tests/unit/analytics/dinero-producto-no-sumable.guardia.test.ts`, las tres mitades
      de `design.md §11` (estática, dinámica y **autocomprobación**).
      **HECHO:** mutación M9 ⇒ rojo por la mitad dinámica, con línea copiada; y la
      autocomprobación detecta el fragmento sintético con total. R47, R48. Depende de F4.

- [ ] **G4** — `alcance-dinero.guardia.test.ts`: el bloque nuevo de `design.md §3.3`, con sus dos
      autocomprobaciones. **Los dos bloques existentes no se tocan.**
      **HECHO:** el guardia afirma MÁS que antes; una tabla sintética que viola R2 se detecta, y
      una fuente sintética con `tienda_id` propio también. Depende de B2.1, B3.1.

- [ ] **G5** — Censos: `censo-tablas.ts` (la tabla del detalle, estado `con_descarga`),
      `cobertura-tablas.guardia.test.ts` (`TOTAL_ARCHIVOS_CON_DATATABLE`,
      `TOTAL_INSTANCIAS_DATATABLE`, `totalCensado`, `con_descarga`) y
      `tablero-operativo-frontera.guardia.test.ts` (`CAMPOS_DE_PRESENTACION`).
      **HECHO:** se vio la guardia **fallar antes** de tocarla («hay tablas sin registrar: …») y
      los números de partida son los de T0.2, no los de este spec. Depende de F5, G2.

---

## V — Verificación

- [ ] **V1** — El gate: `./init.sh` **completo**. El diff toca nombres de dinero en `lib/`, `app/`
      y `components/`, así que `--rapido` **se niega solo**; no se intenta.
      **HECHO:** `INIT_EXIT` escrito DENTRO del log (no por `echo` detrás de un pipe), veredicto
      contra `tests/baseline-rojos.json` y cada rojo identificado como heredado con su nombre.

- [ ] **V2** — Las **diez mutaciones** de `design.md §10`, aplicadas una a una al árbol, con la
      **línea de fallo real** copiada y el árbol restaurado y re-medido verde después de cada una.
      **HECHO:** las diez en `progress/impl_347.md`. Una superviviente se **reporta**, no se
      esconde; si sobrevive, o el test está mal o la línea es inmatable, y hay que decir cuál.

- [ ] **V3** — El navegador (Chromium), con sesión real, a **390, 768, 1024 y 1440 px**.
      Es la cuarta ficha seguida en que el navegador encuentra lo que la suite no.
      **HECHO, medido en el DOM y no a ojo:** desborde horizontal del documento y de la sección,
      caja de la última celda numérica frente al ancho de ventana, **ninguna palabra partida**
      (`Range.getClientRects()`), y **el importe completo** —comparar el texto pintado con el del
      DOM: `₡1.70` donde el DOM dice `₡1.700` es el defecto exacto que midieron la 343 y la 344—.
      La composición de «Otros resultados» legible **sin pasar el cursor** a 390.

- [ ] **V4** — El cuadre contra la base, **en SQL y por fuera del código** (la lección de la 344:
      un cuadre calculado por la misma función que se prueba está siempre verde).
      **HECHO:** para al menos **tres** productos reales con dinero, el recaudado y el reparto
      medidos con una consulta escrita a mano coinciden con lo que pinta la pantalla; y se
      demuestra que **no es tautológico** enseñando una variante del SQL que da otro número.

- [ ] **V5** — El mapa `R<n> → test` completo, los **79** requisitos, en
      `progress/impl_347.md § Trazabilidad`, con el nombre EXACTO del caso.
      **HECHO:** ningún requisito sin test. Un requisito sin test es un fallo de la feature.

- [ ] **V6** — La bitácora dice **lo dudoso**: qué quedó sin medir, qué decisión tomó el agente y
      no el spec, y qué mutación sobrevivió.
      **HECHO:** sección «Lo dudoso, dicho» en `progress/impl_347.md`.

---

## Trazabilidad (esqueleto — el implementer lo rellena con el nombre exacto del caso)

| R | Dónde se cubre |
| --- | --- |
| R1–R2 | B2.3 · G4 |
| R3–R5 | B2.3 · B4.4 |
| R6 | F2 · F6 |
| R7 | B3.2 · B3.3 |
| R8 | B2.3 |
| R9 | B2.3 (mutación M5) |
| R10 | B2.3 |
| R11–R13 | B4.4 |
| R14–R17 | B1.2 · B4.4 |
| R18 | B1.2 · B3.3 · B4.4 (mutación M10) |
| R19 | B1.2 (mutación M3) |
| R20–R21 | B1.2 · B4.4 · B5.4 |
| R22 | B4.1 · F4 (barrido money-safe) · G3(a) |
| R23 | B1.2 |
| R24 | B1.2 (mutación M4) · B3.2 |
| R25 | B4.4 |
| R26–R28 | B3.3 · B4.4 (mutación M1) |
| R29–R31 | F6 · B4.4 (mutación M6) |
| R32–R37 | B5.4 · F5 |
| R38 | B5.4 (las cinco aserciones de §10) · V4 |
| R39 | B5.4 |
| R40 | B5.4 (mutación M7) |
| R41–R42 | B5.1 · B5.4 |
| R43–R44 | B3.3 · B5.4 |
| R45–R46 | F6 |
| R47–R48 | G3 (mutación M9) |
| R49 | G1 |
| R50–R56 | F1 (mutación M8) |
| R57 | F6 · V3 |
| R58 | G1 |
| R59–R62 | F6 |
| R63 | F6 · V3 |
| R64–R65 | F6 |
| R66–R71 | G1 |
| R72 | G2 |
| R73 | B2.3 |
| R74 | B3.2 · B3.3 |
| R75 | B3.2 |
| R76 | B3.3 · F6 |
| R77 | B2.3 · F6 |
| R78 | B4.2 (un solo `lastSync`) |
| R79 | V1 (no hay `db/migrations/**` en el diff) |
