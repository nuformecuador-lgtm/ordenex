# Ficha 393 — Tareas

> Checklist verificable. `[P]` = paralelizable con las de su mismo bloque.
> Cada tarea lleva su criterio de **HECHO**. Sin criterio, no está hecha.
>
> **Secuencia de bloques:** T0 → B (backend) → C (contrato de descarga) → F (frontend) →
> G (guardias) → V (verificación).
> **B y F no se paralelizan entre sí:** la ficha es `fullstack` y F consume el contrato que B
> publica (`docs/architecture.md`; y la memoria del árbol: fullstack se secuencia backend→frontend).

---

## T0 — Antes de tocar nada (bloqueante)

- [ ] **T0.1 — Confirmar EN DISCO** (no en el índice del MCP, que devuelve de más) los diez
      símbolos de los que cuelga el diseño: `pagoTiendaOrdenex`, `gananciaOrdenex`,
      `totalesIngresoOrdenex`, `derivarIngresoOrden`, `toBodegaResumenRow`, `HojaResumen`,
      `CierreBodegaFacturaResumen`, `verCierreBodegaDetalle`, `sumTotales`, `FUENTE_CAJA`.
      **HECHO:** tabla símbolo → archivo → línea en `progress/impl_393.md`. Si alguno no está,
      **PARAR** y avisar al leader antes de escribir una línea.

- [ ] **T0.2 — Confirmar que el detalle YA pinta «Pago a tienda» y «Ganancia»**
      (`CierresBodegaAdminModule.tsx:550-569`). Es la corrección de premisa de la ficha
      (`requirements.md` hallazgo 8) y cambia lo que hay que hacer: **agrupar y renombrar**, no
      añadir dos números que no existían.
      **HECHO:** las dos líneas citadas en la bitácora.

- [ ] **T0.3 — MEDIR las tres identidades del snapshot contra la base real**, en **solo lectura**,
      antes de escribir código. Una consulta que, por cada `cierre_bodega`, compare
      `total_general`, `total_pago_mensajero` y `total_ingreso_bodega_rechazos` contra la suma de
      sus `cierre_dia` vinculados, y devuelva **cuántos cuadran y cuántos no**, con los ids de los
      que no.
      **HECHO:** el número, escrito. `design.md §9` es una imposibilidad **razonada**, y en este
      árbol una imposibilidad razonada ya se desmintió midiendo. Si algún cierre no cuadra:
      **PARAR**, decirlo, y abrir ficha aparte por el descuadre — **no se maquilla en pantalla**.
      ⚠️ Con la base vacía (producción se limpió el 2026-08-25), «0 cierres» **no es una medición**:
      dilo así y mide contra la base local sembrada.

- [ ] **T0.4 — Censar los tests que localizan lo que se retira del detalle.**
      Los `aria-label` de las cinco tarjetas sueltas: `"Ingreso bruto del cierre de bodega"`,
      `"Pago a mensajeros del cierre de bodega"`, `"Ganancia del cierre de bodega"`,
      `"Ingreso de bodega por rechazos del cierre de bodega"`, `"Pago a tienda del cierre de
      bodega"`, y sus gemelos `· <mensajero>` de las secciones por día.
      **HECHO:** lista archivo:línea en la bitácora. Es la lección medida «el test que vive dentro
      de lo que borras»: borrar el montaje se lleva la red de features ajenas si no se traslada.

- [ ] **T0.5 — Anotar el veredicto del gate.** El diff toca archivos con nombre de dinero
      (`cierre`, `ingreso`, `pago`, `factura`), así que `./init.sh --rapido` **se niega**
      (`design.md §11`).
      **HECHO:** escrito en la bitácora antes de empezar: «el gate de esta ficha es `./init.sh`
      completo».

- [ ] **T0.6 [P] — Fotografiar en VERDE los archivos que NO deben cambiar de comportamiento** y
      anotar sus conteos de partida:
      `tests/components/DineroIdentidadesEnPantalla.test.tsx`,
      `tests/components/CierreFacturaPapel.test.tsx`,
      `tests/unit/guards/factura-contraste.guardia.test.ts`,
      `tests/unit/guards/cierre-detalle-superficies.guardia.test.ts`,
      `tests/unit/guards/flete-por-rechazo-censo.guardia.test.ts`,
      `tests/unit/descarga/columnas-asercion-de-orden.guardia.test.ts`,
      `tests/unit/descarga/cobertura-tablas.guardia.test.ts`,
      `tests/unit/descarga/columnas-sensibles.guardia.test.ts`,
      `tests/unit/descarga/cierres-bodega-descarga-columnas.test.ts`.
      **HECHO:** conteos medidos en la bitácora. **Regla de la ficha:** si al terminar hubo que
      editar alguno **salvo** las ampliaciones declaradas de C3 y G1, el diseño falló.

---

## B — Backend: la aritmética, en el servidor

- [ ] **B1** — `lib/utils/ingreso-ordenex.ts`: `netoOrdenex(ingresoTotal, pagoMensajero, pagoBodega)`
      y `quedaTrasPagos(general, pagoMensajero, pagoBodega)`, con su docstring diciendo **por qué no
      son** `gananciaOrdenex` ni `netoDe` (`design.md §2.2`).
      **HECHO:** las dos son `Prisma.Decimal(...).minus().minus().toFixed(2)`; el diff del archivo
      no contiene `Number(`, `parseFloat(`, `parseInt(` ni `.toFixed(` sobre nada que no sea el
      `Decimal` de salida. `gananciaOrdenex` y `pagoTiendaOrdenex` **sin tocar**.

- [ ] **B2** — `tests/unit/utils/cascadas-cierre-bodega.test.ts`, con **céntimos** en todos los
      casos (con cifras redondas estas identidades cierran igual sin el arreglo, y el caso no
      probaría nada):
      1. `netoOrdenex` resta **también** la bodega — con bodega > 0 da distinto que `gananciaOrdenex` (R8);
      2. con bodega `"0.00"`, `netoOrdenex` = `gananciaOrdenex` (el caso del cierre medido);
      3. `quedaTrasPagos` = general − mensajeros − bodega (R9);
      4. los dos aceptan y devuelven negativos con signo (R11);
      5. `fleteConIva + comisionConIva + fleteDevolucionConIva = total` sobre `totalesIngresoOrdenex` (R7);
      6. `pagoTiendaOrdenex` **no** resta el flete por rechazo: con un rechazo, `general − total ≠ paraLaTienda` y `general − (flete+comisión) = paraLaTienda` (R6, la trampa 1).
      **HECHO:** los seis verdes y **M1** los pone rojos. Depende de B1.

- [ ] **B3** — `lib/interfaces/services/ICierreBodegaService.ts`: `CierreBodegaResumen.quedaTrasPagos`
      **requerido** (`design.md §6.1`) y los tres campos nuevos de `CierreBodegaDetalleCierre`
      (`cobradoSobreRecaudado`, `netoOrdenex`, `quedaTrasPagos`), cada uno con su docstring.
      `CierreBodegaResumenLite` **sin tocar** (R21).
      **HECHO:** el typecheck **enrojece** en los literales de los dobles de test — ese rojo es la
      prueba de que el campo es requerido.

- [ ] **B4** — `lib/repositories/CierreBodegaRepository.ts` → `toBodegaResumenRow`: derivar
      `quedaTrasPagos` llamando a la función pura de B1 (`design.md §2.3`). **Ni una resta escrita
      a mano en el mapper.**
      **HECHO:** el diff del mapper llama a `quedaTrasPagos(...)` y nada más; las **cuatro**
      lecturas que lo reusan (cola, histórico, solicitados de la zona, conjuntos completos) lo
      traen sin tocar ninguna de ellas. Depende de B1, B3.

- [ ] **B5** — `lib/services/CierresBodegaAdminService.ts` → `verCierreBodegaDetalle`: derivar
      `cobradoSobreRecaudado`, `netoOrdenex` y `quedaTrasPagos` **en el agregado y en cada
      `cierre_dia`**, desde los snapshots de su propio nivel (R15).
      **HECHO:** ninguna de las tres se calcula a partir de otra ya derivada en un nivel distinto;
      `pagoTienda` y `ganancia` se siguen devolviendo igual. Depende de B1, B3.

- [ ] **B6** — `tests/unit/services/cierres-bodega-admin-service.test.ts` (ampliación): con **dos
      `cierre_dia`** y céntimos,
      1. cada cascada del agregado cierra con las cifras del agregado (R6-R9);
      2. `Σ` de los tres derivados por día **=** el derivado agregado, al céntimo (R16);
      3. con un `cierre_dia` que tiene una `rechazada`, `paraLaTienda ≠ general − total` y la línea
         puente explica la diferencia exacta (R7/R10);
      4. con snapshots agregados que **no** son la suma de los días, el agregado **sigue saliendo
         del agregado** y el día del día — no se corrige ninguno (R17).
      **HECHO:** los cuatro verdes; **M2**, **M3** y **M5** los ponen rojos. Depende de B5.

- [ ] **B7 [P]** — Actualizar los literales `CierreBodegaResumen` de los tests existentes que el
      typecheck delate (`cierre-bodega-service`, `cierres-bodega-admin-*`, `cierre-bodega-repository`,
      los de descarga y los de componentes).
      **HECHO:** typecheck verde y **cero cambios de comportamiento** en esos archivos: sólo el
      campo nuevo en el literal. Depende de B3.

---

## C — Rótulos y descarga

- [ ] **C1 [P]** — `app/(app)/cierres-admin/_components/cierre-labels.ts`: las once constantes de
      `design.md §5`, cada una con el porqué del nombre. Re-exportarlas desde
      `cierre-detalle-shared.tsx` como ya hace ese archivo con las demás (`:82-104`).
      **HECHO:** `cierre-labels.ts` sigue siendo un módulo PURO (sin React, sin Prisma) y ninguna
      constante existente cambia de valor.

- [ ] **C2** — `cierres-bodega-descarga-columnas.ts`: **una** columna nueva al final de los
      **tres** listados de cierre de bodega (pendientes, resueltos, solicitados de la zona). El de
      `cierre_dia` consolidable **NO** la gana (R21). La proyección lee `quedaTrasPagos` del DTO.
      **HECHO:** ninguna columna existente cambia de clave, encabezado ni posición. Depende de B3, C1.

- [ ] **C3** — Ampliar `tests/unit/descarga/columnas-asercion-de-orden.guardia.test.ts` y
      `cobertura-tablas.guardia` con la columna nueva. **Es una de las dos ediciones permitidas de
      T0.6**, y se hace por escrito y con motivo.
      **HECHO:** las guardias siguen con su autocomprobación intacta y afirman ahora el orden con
      la columna nueva **al final**. Depende de C2.

- [ ] **C4 [P]** — `tests/unit/descarga/cierres-bodega-descarga-columnas.test.ts` (ampliación):
      la fila del archivo lleva el mismo `quedaTrasPagos` que la tarjeta, **sin recalcular** (R22).
      **HECHO:** verde; **M6** lo pone rojo. Depende de C2.

---

## F — Frontend: las dos superficies

- [ ] **F1** — `app/(app)/cierres-admin/_components/CascadaDinero.tsx` (`design.md §7.3`).
      Sin lógica de dominio, sin aritmética: recibe las líneas ya derivadas.
      **HECHO:** el archivo no contiene `Number(`, `parseFloat(`, `parseInt(`, `.toFixed(`, `+`
      ni `-` sobre importes; sólo `money()`. Depende de C1.

- [ ] **F2** — `tests/components/CascadaDinero.test.tsx`: pinta el signo de cada línea, destaca el
      resultado, expone la región con su nombre accesible (R5/R32) y **no altera** el importe que
      recibe (R13).
      **HECHO:** verde; **M7** lo pone rojo. Depende de F1.

- [ ] **F3** — `cierre-factura.tsx`: prop opcional `cascadaCaja` en `HojaResumen`, columna del
      medio condicionada (`design.md §7.1`), y `CierreBodegaFacturaResumen` pasándola.
      **Las otras tres superficies, sin tocar.**
      **HECHO:** el diff no cambia `RESUMEN_METODOS_TITULO`, `RESUMEN_AJUSTES_TITULO`,
      `RESUMEN_FECHAS_TITULO` ni la rejilla; `CierreFacturaResumen`, `CierreFacturaResumenPropio` y
      `CierreConsolidableFacturaResumen` no cambian ni un carácter. Depende de B4, C1.

- [ ] **F4** — `tests/components/CierreBodegaTarjetaCascada.test.tsx`:
      1. la tarjeta de bodega desplegada **no** dice «Ajustes» y sí dice «Qué sale de la bodega» (R19);
      2. las cuatro líneas están y la resta cierra **leyendo el DOM** (R9/R18);
      3. las **otras tres** superficies siguen pintando «Ajustes» con sus dos líneas de siempre (R21);
      4. la tarjeta no recibe ninguna cifra que tenga que calcular: el resultado llega en la prop (R20).
      **HECHO:** los cuatro verdes; **M8** y **M9** los ponen rojos. Depende de F3.

- [ ] **F5** — `CierresBodegaAdminModule.tsx`: montar las dos cascadas en el agregado y en cada
      sección por `cierre_dia`, y **dejar de montar** las cinco tarjetas sueltas
      (`design.md §7.2`). Los componentes **no se borran**.
      **HECHO:** `MontoDerivadoCard`, `PagoMensajeroTotal` e `IngresoBodegaRechazosTotal` siguen
      exportados y siguen montados por `CierresAdminModule` (R30). Depende de B5, F1, T0.4.

- [ ] **F6** — `tests/components/CierreBodegaDetalleCascadas.test.tsx`:
      1. las dos cascadas son **dos regiones distintas** con nombres accesibles distintos (R1/R32);
      2. ninguna línea aparece en las dos regiones (R2);
      3. «Para la tienda» y «Neto de Ordenex» están y están destacados (R3);
      4. la línea puente aparece **también con flete por rechazo = 0** (R10);
      5. un neto negativo se pinta con signo y marcado como deuda (R11);
      6. la nota de «no es efectivo en caja» está bajo el resultado de la cascada B (R26);
      7. la nota del «pago a la bodega satélite» dice que no es un movimiento de caja (R27);
      8. cada sección por `cierre_dia` trae sus dos cascadas con los **mismos rótulos** (R23);
      9. no queda ninguna tarjeta suelta repitiendo una cifra de una cascada (R24/R34);
      10. el panel de totales por método sigue exactamente igual (R29).
      **HECHO:** los diez verdes; **M4**, **M10** y **M11** los ponen rojos. Depende de F5.

- [ ] **F7** — Trasladar (no borrar) las aserciones que T0.4 encontró: lo que se afirmaba sobre los
      `aria-label` retirados se re-afirma sobre los rótulos de la cascada equivalente.
      **HECHO:** ningún test perdido sin sustituto; la tabla «aserción vieja → aserción nueva» en la
      bitácora. Depende de T0.4, F5.

---

## G — Guardias

- [ ] **G1** — Ampliar `tests/components/DineroIdentidadesEnPantalla.test.tsx` (ficha 359):
      **añadir las dos superficies nuevas al censo de la Parte D** con su identidad declarada, y
      **dos casos a la Parte B** que rendericen de verdad la tarjeta de bodega y el detalle y
      afirmen con `laCuentaCierra` las cuatro identidades (R6-R9) **sobre las cadenas pintadas**.
      Es la segunda edición permitida de T0.6, y la que de verdad protege esta ficha: comprobarlo
      sobre los `Decimal` de origen sería una aserción contra su propia fuente, siempre verde.
      **HECHO:** el `expect(CENSO.length).toBe(13)` pasa a `.toBe(15)` con las dos rutas nuevas;
      todos los casos de la Parte A siguen intactos. Depende de F4, F6.

- [ ] **G2 [P]** — `tests/unit/guards/cierre-bodega-vocabulario.guardia.test.ts` (guardia perenne),
      con **autocomprobación obligatoria** (una guardia estática rota no falla: **calla**):
      (a) el barrido ve un número plausible de fuentes de `app/(app)/cierres-admin/`;
      (b) el MISMO extractor encuentra los rótulos NUEVOS (o sea: sí lee texto visible y el cambio
          está puesto);
      (c) sobre dos fuentes sintéticas, el detector marca el literal y **no** marca el comentario
          (patrón exacto de `flete-por-rechazo-censo.guardia.test.ts`);
      (d) el censo: en las superficies del cierre de bodega no aparece «Ajustes» (R35) ni el rótulo
          de una cifra que ya es línea de cascada (R34).
      **HECHO:** la guardia cae con el canario sintético y pasa con el árbol real. Depende de F3, F5.

- [ ] **G3 [P]** — Comprobar que `factura-contraste.guardia` sigue verde: la cascada **no estrena
      ninguna utilidad de color** fuera del inventario cerrado (`design.md §7.1`).
      **HECHO:** guardia verde sin editarla. Si hubo que editarla, está mal el diseño del color.
      Depende de F3.

- [ ] **G4 [P]** — Comprobar que `cierre-detalle-superficies.guardia` sigue verde: esta ficha no
      toca `CierreFacturaDetalle` ni sus dos superficies.
      **HECHO:** guardia verde sin editarla.

---

## V — Verificación

- [ ] **V1** — **`./init.sh` COMPLETO** (no `--rapido`: se niega, `design.md §11`), con
      `INIT_EXIT=$?` escrito **dentro** del log y en su propia línea, y **sin `tail` en la tubería**
      (canalizar por `tail` un comando en segundo plano trunca el fichero en origen y el rojo se
      queda sin nombre).
      **HECHO:** `INIT_EXIT=0` citado, más el número de `skipped` **contados y explicados** y la
      línea de `DATABASE_URL` — sin ella se saltan ~77 archivos contra Postgres y el gate miente en
      verde.

- [ ] **V2** — **Verificación humana en la app real.** No hay E2E en este repo y no se inventa uno
      aquí. Con el maestro: `/cierres-admin` → pestaña de cierres de bodega → (a) desplegar una
      tarjeta y comprobar que la columna del medio dice «Qué sale de la bodega» y que **la resta
      da**, sumando a mano; (b) abrir el detalle y comprobar que las dos cascadas están separadas,
      que «Para la tienda» y «Neto de Ordenex» se leen, y que **las dos restas dan**; (c) repetir
      con un cierre que tenga al menos una `rechazada` y comprobar que la línea puente explica la
      diferencia. Con el `adminSatelite`: `/cierres-admin` (su módulo de consolidación) → la
      tarjeta de un cierre de bodega pasado, misma comprobación de (a).
      **HECHO:** capturas y los tres resultados en `progress/impl_393.md`. Doce mil tests no vieron
      siete textos rotos que mirar la app sí vio: este paso no es opcional.

- [ ] **V3** — Confirmar que **ningún archivo de T0.6 se editó** salvo C3 y G1.
      **HECHO:** `git diff --name-only` contra la base, contrastado con la lista de T0.6.

- [ ] **V4** — Confirmar que **no hay migración**: `db/migrations/` y `db/schema.prisma` **sin
      tocar** (R28).
      **HECHO:** `git diff --name-only -- db/` vacío, citado.

- [ ] **V5** — Escribir `progress/impl_393.md` con el mapa `R<n> → test`, la medición de T0.3, las
      mutaciones medidas y lo que quede vivo. **Y COMMITEARLO**: un informe sin commitear describe
      el disco, no la rama — ha pasado tres veces en un día en este árbol.

---

## Mutaciones — cada requisito se mide, no se declara

Se aplican al árbol real, se corre la suite y **se revierten desde copia** (nunca `git checkout`:
suele haber trabajo sin commitear). Cada una anota su alcance y sus rojos.

| # | Mutación | Debe poner rojo |
| --- | --- | --- |
| **M1** | `netoOrdenex` deja de restar `pagoBodega` (o sea, vuelve a ser `gananciaOrdenex`) | B2 casos 1 y 4 (R8) |
| **M2** | el agregado deriva `paraLaTienda` con `general − totalesIngreso.total` (empezar por el bruto, alternativa A6) | B6 caso 3 (R6/R7) · G1 |
| **M3** | el `netoOrdenex` de cada día se deriva con el `total_pago_mensajero` **agregado** en vez del suyo | B6 caso 2 (R15/R16) |
| **M4** | quitar la línea puente cuando `fleteDevolucionConIva === "0.00"` | F6 caso 4 (R10) |
| **M5** | el agregado se "corrige" para que iguale la suma de los días | B6 caso 4 (R17) |
| **M6** | la columna del archivo recalcula `quedaTrasPagos` en vez de leer el DTO | C4 (R22) |
| **M7** | `CascadaDinero` compone el monto con `Number(monto).toFixed(2)` | F2 (R13/R14) · G1 |
| **M8** | pintar «Ajustes» también cuando `cascadaCaja` está presente | F4 caso 1 (R19) · G2 |
| **M9** | pasar `cascadaCaja` también desde `CierreFacturaResumen` (cierre de mensajero) | F4 caso 3 (R21) |
| **M10** | volver a montar `MontoDerivadoCard` «Pago a tienda» junto a la cascada A | F6 caso 9 (R24/R34) · G2 |
| **M11** | fundir las dos cascadas en una sola región | F6 casos 1 y 2 (R1/R2) |
| **M12** | cuadrar los importes al colón antes de pintarlos (la regla de la 230) | G1 (las cuatro identidades dejan de cerrar) |

**Autocomprobación obligatoria:** cada mutación viene con **la línea de fallo copiada del log**.
Este árbol ya se comió un arnés de mutaciones que reportó 9/9 supervivientes **sin haber ejecutado
un solo test**, dos veces.

---

## Trazabilidad `R<n> → test`

| R | Test |
| --- | --- |
| R1 | `CierreBodegaDetalleCascadas` › dos regiones distintas con nombres accesibles distintos |
| R2 | `CierreBodegaDetalleCascadas` › ninguna línea aparece en las dos regiones |
| R3 | `CierreBodegaDetalleCascadas` › «Para la tienda» y «Neto de Ordenex» están y destacados |
| R4 | `CierreBodegaTarjetaCascada` › el resultado de la cascada B va destacado · `CierreBodegaDetalleCascadas` |
| R5 | `CascadaDinero` › cada línea sustraendo se pinta con su signo |
| R6 | `cascadas-cierre-bodega` caso 6 · `cierres-bodega-admin-service` caso 1 · `DineroIdentidadesEnPantalla` (G1) |
| R7 | `cascadas-cierre-bodega` caso 5 · `cierres-bodega-admin-service` caso 3 · `DineroIdentidadesEnPantalla` (G1) |
| R8 | `cascadas-cierre-bodega` casos 1 y 2 · `DineroIdentidadesEnPantalla` (G1) |
| R9 | `cascadas-cierre-bodega` caso 3 · `CierreBodegaTarjetaCascada` caso 2 · `DineroIdentidadesEnPantalla` (G1) |
| R10 | `CierreBodegaDetalleCascadas` caso 4 · `cierres-bodega-admin-service` caso 3 |
| R11 | `cascadas-cierre-bodega` caso 4 · `CierreBodegaDetalleCascadas` caso 5 |
| R12 | `cierres-bodega-admin-service` (los tres derivados llegan como STRING desde el servicio) · `cierre-bodega-repository` (`quedaTrasPagos` en el mapper) |
| R13 | `CascadaDinero` › no altera el importe que recibe · `CierreBodegaTarjetaCascada` caso 4 |
| R14 | `cierre-bodega-vocabulario.guardia` (G2, mitad money-safe: ninguna llamada prohibida en los módulos de la ficha) |
| R15 | `cierres-bodega-admin-service` caso 2 |
| R16 | `cierres-bodega-admin-service` caso 2 · la medición de **T0.3** contra la base real |
| R17 | `cierres-bodega-admin-service` caso 4 |
| R18 | `CierreBodegaTarjetaCascada` caso 2 |
| R19 | `CierreBodegaTarjetaCascada` caso 1 · `cierre-bodega-vocabulario.guardia` (G2 d) |
| R20 | `CierreBodegaTarjetaCascada` caso 4 · `cierre-bodega-repository` › el mapper deriva el campo |
| R21 | `CierreBodegaTarjetaCascada` caso 3 · `CierreFacturaPapel` (sin editar) · V3 |
| R22 | `cierres-bodega-descarga-columnas` (C4) · `columnas-asercion-de-orden.guardia` (C3) |
| R23 | `CierreBodegaDetalleCascadas` caso 8 · `cierre-bodega-vocabulario.guardia` (G2) |
| R24 | `CierreBodegaDetalleCascadas` caso 9 · `cierre-bodega-vocabulario.guardia` (G2 d) |
| R25 | `CierreBodegaDetalleCascadas` › la línea se llama «Pago a la bodega satélite» · G2 |
| R26 | `CierreBodegaDetalleCascadas` caso 6 · `CierreBodegaTarjetaCascada` › la nota está en la tarjeta |
| R27 | `CierreBodegaDetalleCascadas` caso 7 |
| R28 | **V4** (`git diff -- db/` vacío) |
| R29 | `CierreBodegaDetalleCascadas` caso 10 |
| R30 | `CierresAdminModule` y `CierreFacturaPapel` sin editar (T0.6/V3) · **M9** |
| R31 | `cierres-bodega-admin-service` › `pagoTienda` y `ganancia` devuelven lo mismo que antes · B7 (literales sin cambio de comportamiento) |
| R32 | `CascadaDinero` › la región tiene nombre accesible · `CierreBodegaDetalleCascadas` caso 1 |
| R33 | `cierre-bodega-vocabulario.guardia` (G2 b: el extractor encuentra los rótulos nuevos, o sea que son constantes leídas del módulo puro) |
| R34 | `CierreBodegaDetalleCascadas` caso 9 · `cierre-bodega-vocabulario.guardia` (G2 d) |
| R35 | `cierre-bodega-vocabulario.guardia` (G2 d) + su autocomprobación (G2 a-c) |

---

## Lo que esta ficha NO hace

1. **No añade ninguna columna ni migración** (`design.md §1` y §8 A2). Si alguien concluye que hace
   falta, **para**.
2. **No pone la cascada A en la tarjeta** — es **Q1** de `requirements.md`, y decide si la ficha
   crece con migración o con acción nueva.
3. **No renombra `INGRESO_BODEGA_RECHAZOS_LABEL` en toda la app** — es **Q4**, del tipo que el
   humano firmó una vez en la 338.
4. **No toca las superficies del cierre de mensajero** ni el `cierre_dia` consolidable.
5. **No calcula «Central debe» ni reparte el efectivo** en un cierre de bodega ya cerrado: eso vive
   en la consolidación (`CierreBodegaService.ts:96-127`) y sólo se calcula antes de solicitar. Es
   parte de **Q3**.
6. **No arregla ni maquilla un descuadre de snapshot** si T0.3 encuentra uno: se para y se abre
   ficha aparte.
