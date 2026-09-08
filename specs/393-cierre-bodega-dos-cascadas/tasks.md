# Ficha 393 — Tareas

> Checklist verificable. `[P]` = paralelizable con las de su mismo bloque.
> Cada tarea lleva su criterio de **HECHO**. Sin criterio, no está hecha.
>
> **Secuencia de bloques:** T0 → B (backend) → C (rótulos y descarga) → F (frontend) →
> G (guardias) → V (verificación).
> **B y F no se paralelizan entre sí:** la ficha es `fullstack` y F consume el contrato que B
> publica (fullstack se secuencia backend→frontend).
>
> **Revisión 2 (2026-09-08):** `quedaTrasPagos` pasa a llamarse `paraLaCentral`; entran el caso
> negativo (§12 del diseño), el aviso de efectivo, la tarjeta en las **dos** pantallas y la columna
> de descarga como decisión y no como duda.

---

## T0 — Antes de tocar nada (bloqueante)

- [x] **T0.1 — Confirmar EN DISCO** (no en el índice del MCP, que devuelve de más) los once
      símbolos de los que cuelga el diseño: `pagoTiendaOrdenex`, `gananciaOrdenex`,
      `totalesIngresoOrdenex`, `derivarIngresoOrden`, `pagoPorResultado`, `toBodegaResumenRow`,
      `HojaResumen`, `CierreBodegaFacturaResumen`, `verCierreBodegaDetalle`, `sumTotales`,
      `FUENTE_CAJA`.
      **HECHO:** tabla símbolo → archivo → línea en `progress/impl_393.md`. Si alguno no está,
      **PARAR** y avisar al leader antes de escribir una línea.

- [x] **T0.2 — Confirmar que el detalle YA pinta «Pago a tienda» y «Ganancia»**
      (`CierresBodegaAdminModule.tsx:550-569`), y que **«Para la central» no existe en ninguna
      parte**. Es la corrección de premisa de la ficha (`requirements.md` hallazgo 8): la cascada A
      se **agrupa y renombra**; la cascada B se **crea**.
      **HECHO:** las dos comprobaciones citadas en la bitácora.

- [x] **T0.3 — MEDIR las tres identidades del snapshot contra la base real, en SOLO LECTURA**,
      antes de escribir código. **Las tres consultas están escritas abajo (§ Consultas de T0.3):
      se copian y se corren, no se improvisan.**
      **HECHO:** los números de la consulta 2 escritos en la bitácora (`cierres`, `cuadran`,
      `descuadran`, `negativos`, `efectivo_no_alcanza`, `peor_para_la_central`,
      `peor_holgura_efectivo`) + el de la consulta 3.
      - Si `descuadran > 0`: **PARAR**, listar los ids con la consulta 1 y abrir ficha aparte por el
        descuadre del snapshot. **No se maquilla en pantalla.**
      - Si `negativos > 0` o `efectivo_no_alcanza > 0`: los casos de §12 del diseño **no son
        teóricos**; el número entra en el mensaje del test de F6.
      - ⚠️ Con la base vacía (producción se limpió el 2026-08-25), **«0 cierres» NO es una
        medición**: dilo así y mide contra la base local sembrada.

- [x] **T0.4 — Censar los tests que localizan lo que se retira del detalle.**
      Los `aria-label` de las cinco tarjetas sueltas: `"Ingreso bruto del cierre de bodega"`,
      `"Pago a mensajeros del cierre de bodega"`, `"Ganancia del cierre de bodega"`,
      `"Ingreso de bodega por rechazos del cierre de bodega"`, `"Pago a tienda del cierre de
      bodega"`, y sus gemelos `· <mensajero>` de las secciones por día.
      **HECHO:** lista archivo:línea en la bitácora. Es la lección medida «el test que vive dentro
      de lo que borras».

- [x] **T0.5 — Anotar el veredicto del gate.** El diff toca archivos con nombre de dinero
      (`cierre`, `ingreso`, `pago`, `factura`), así que `./init.sh --rapido` **se niega**
      (`design.md §11`).
      **HECHO:** escrito en la bitácora antes de empezar: «el gate de esta ficha es `./init.sh`
      completo».

- [x] **T0.6 [P] — Fotografiar en VERDE los archivos que NO deben cambiar de comportamiento** y
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

- [x] **B1** — `lib/utils/ingreso-ordenex.ts`: `netoOrdenex(...)`, `paraLaCentral(...)` y
      `efectivoCubreDescuentos(...)`, con su docstring diciendo **por qué no son**
      `gananciaOrdenex` ni `netoDe` (`design.md §2.2`).
      **HECHO:** las dos primeras son `Prisma.Decimal(...).minus().minus().toFixed(2)`; la tercera
      **compara** con `Decimal` y no emite importe. El diff del archivo no contiene `Number(`,
      `parseFloat(`, `parseInt(` ni `.toFixed(` sobre nada que no sea el `Decimal` de salida.
      `gananciaOrdenex` y `pagoTiendaOrdenex` **sin tocar**.

- [x] **B2** — `tests/unit/utils/cascadas-cierre-bodega.test.ts`, con **céntimos** en todos los
      casos (con cifras redondas estas identidades cierran igual sin el arreglo, y el caso no
      probaría nada):
      1. `netoOrdenex` resta **también** la bodega — con bodega > 0 da distinto que `gananciaOrdenex` (R8);
      2. con bodega `"0.00"`, `netoOrdenex` = `gananciaOrdenex` (el caso del cierre medido);
      3. `paraLaCentral` = general − mensajeros − bodega (R9);
      4. **`paraLaCentral` devuelve el NEGATIVO con su signo** cuando los descuentos superan lo
         recaudado — **nunca `"0.00"`** (R36);
      5. `efectivoCubreDescuentos` es `false` cuando el efectivo no llega, **aunque
         `paraLaCentral` sea positivo** (R37: el caso de SINPE/transferencia);
      6. `fleteConIva + comisionConIva + fleteDevolucionConIva = total` sobre `totalesIngresoOrdenex` (R7);
      7. `pagoTiendaOrdenex` **no** resta el flete por rechazo: con un rechazo,
         `general − total ≠ paraLaTienda` y `general − (flete+comisión) = paraLaTienda` (R6, trampa 1).
      **HECHO:** los siete verdes y **M1**, **M13** y **M14** los ponen rojos. Depende de B1.

- [x] **B3** — `lib/interfaces/services/ICierreBodegaService.ts`: `CierreBodegaResumen.paraLaCentral`
      y `.efectivoCubreDescuentos` **requeridos** (`design.md §6.1`) y los cuatro campos nuevos de
      `CierreBodegaDetalleCierre` (`cobradoSobreRecaudado`, `netoOrdenex`, `paraLaCentral`,
      `efectivoCubreDescuentos`), cada uno con su docstring.
      `CierreBodegaResumenLite` **sin tocar** (R21).
      **HECHO:** el typecheck **enrojece** en los literales de los dobles de test — ese rojo es la
      prueba de que los campos son requeridos.

- [x] **B4** — `lib/repositories/CierreBodegaRepository.ts` → `toBodegaResumenRow`: derivar
      `paraLaCentral` y `efectivoCubreDescuentos` llamando a las funciones puras de B1
      (`design.md §2.3`). **Ni una resta escrita a mano en el mapper.**
      **HECHO:** el diff del mapper llama a las dos funciones y nada más; las **cuatro** lecturas
      que lo reusan lo traen sin tocar ninguna de ellas — que es lo que hace cumplir **R38** por
      construcción. Depende de B1, B3.

- [x] **B5** — `lib/services/CierresBodegaAdminService.ts` → `verCierreBodegaDetalle`: derivar
      `cobradoSobreRecaudado`, `netoOrdenex`, `paraLaCentral` y `efectivoCubreDescuentos` **en el
      agregado y en cada `cierre_dia`**, desde los snapshots de su propio nivel (R15).
      **HECHO:** ninguna de las cuatro se calcula a partir de otra ya derivada en un nivel distinto;
      `pagoTienda` y `ganancia` se siguen devolviendo igual. Depende de B1, B3.

- [x] **B6** — `tests/unit/services/cierres-bodega-admin-service.test.ts` (ampliación): con **dos
      `cierre_dia`** y céntimos,
      1. cada cascada del agregado cierra con las cifras del agregado (R6-R9);
      2. `Σ` de los cuatro derivados por día **=** el derivado agregado, al céntimo (R16);
      3. con un `cierre_dia` que tiene una `rechazada`, `paraLaTienda ≠ general − total` y la línea
         puente explica la diferencia exacta (R7/R10);
      4. con snapshots agregados que **no** son la suma de los días, el agregado **sigue saliendo
         del agregado** y el día del día — no se corrige ninguno (R17).
      **HECHO:** los cuatro verdes; **M2**, **M3** y **M5** los ponen rojos. Depende de B5.

- [x] **B7** — `tests/unit/repositories/cierre-bodega-repository.test.ts` (ampliación): el mapper
      emite `paraLaCentral` y `efectivoCubreDescuentos` en **las cuatro** lecturas (cola, histórico,
      solicitados de la zona, conjuntos completos), con el mismo valor para la misma fila (R38).
      **HECHO:** verde; **M15** lo pone rojo. Depende de B4.

- [x] **B8 [P]** — Actualizar los literales `CierreBodegaResumen` de los tests existentes que el
      typecheck delate.
      **HECHO:** typecheck verde y **cero cambios de comportamiento** en esos archivos: sólo los
      campos nuevos en el literal. Depende de B3.

---

## C — Rótulos y descarga

- [x] **C1 [P]** — `app/(app)/cierres-admin/_components/cierre-labels.ts`: las trece constantes de
      `design.md §5`, cada una con el porqué del nombre —incluido **por qué «Para la central» y no
      «Entrega a la central» ni «Queda en caja»**, y **por qué NO se reusa `CENTRAL_DEBE_LABEL`**—.
      Re-exportarlas desde `cierre-detalle-shared.tsx` como ya hace ese archivo (`:82-104`).
      **HECHO:** `cierre-labels.ts` sigue siendo un módulo PURO (sin React, sin Prisma) y ninguna
      constante existente cambia de valor.

- [x] **C2** — `cierres-bodega-descarga-columnas.ts`: **una** columna nueva
      (`paraLaCentral` / `PARA_LA_CENTRAL_LABEL`) **al final** de los **tres** listados de cierre de
      bodega. El de `cierre_dia` consolidable **NO** la gana (R21). `efectivoCubreDescuentos`
      **NO** va al archivo (`design.md §6.3`).
      **HECHO:** ninguna columna existente cambia de clave, encabezado ni posición. Depende de B3, C1.

- [x] **C3** — Ampliar `tests/unit/descarga/columnas-asercion-de-orden.guardia.test.ts` y
      `cobertura-tablas.guardia` con la columna nueva. **Es una de las dos ediciones permitidas de
      T0.6**, y se hace por escrito y con motivo.
      **HECHO:** las guardias siguen con su autocomprobación intacta y afirman ahora el orden con
      la columna nueva **al final**. Depende de C2.

- [x] **C4 [P]** — `tests/unit/descarga/cierres-bodega-descarga-columnas.test.ts` (ampliación):
      la fila del archivo lleva el mismo `paraLaCentral` que la tarjeta, **sin recalcular**, y el
      listado de consolidables **no** gana columna (R22/R21).
      **HECHO:** verde; **M6** lo pone rojo. Depende de C2.

---

## F — Frontend: las dos superficies

- [x] **F1** — `app/(app)/cierres-admin/_components/CascadaDinero.tsx` (`design.md §7.3`).
      Sin lógica de dominio, sin aritmética: recibe las líneas ya derivadas, y el tono del negativo
      lo decide con `esMontoNegativo` (lectura del signo del STRING, no un parseo).
      **HECHO:** el archivo no contiene `Number(`, `parseFloat(`, `parseInt(`, `.toFixed(`, `+`
      ni `-` sobre importes; sólo `money()` y `esMontoNegativo()`. Depende de C1.

- [x] **F2** — `tests/components/CascadaDinero.test.tsx`: pinta el signo de cada línea, destaca el
      resultado, expone la región con su nombre accesible (R5/R32), pinta el negativo con tono de
      atención (R36) y **no altera** el importe que recibe (R13).
      **HECHO:** verde; **M7** lo pone rojo. Depende de F1.

- [x] **F3** — `cierre-factura.tsx`: prop opcional `cascadaCentral` en `HojaResumen`, columna del
      medio condicionada (`design.md §7.1`), y `CierreBodegaFacturaResumen` pasándola.
      **Las otras tres superficies, sin tocar.**
      **HECHO:** el diff no cambia `RESUMEN_METODOS_TITULO`, `RESUMEN_AJUSTES_TITULO`,
      `RESUMEN_FECHAS_TITULO` ni la rejilla; `CierreFacturaResumen`, `CierreFacturaResumenPropio` y
      `CierreConsolidableFacturaResumen` no cambian ni un carácter. Depende de B4, C1.

- [x] **F4** — `tests/components/CierreBodegaTarjetaCascada.test.tsx`:
      1. la tarjeta de bodega desplegada **no** dice «Ajustes» y sí dice «Lo que va a la central» (R19);
      2. las cuatro líneas están y la resta cierra **leyendo el DOM** (R9/R18);
      3. **la tarjeta que monta `CierresBodegaSolicitadosLista` (satélite) y la que monta
         `CierresBodegaResueltosLista` (maestro) enseñan el MISMO rótulo y el MISMO valor** (R38);
      4. las **otras tres** superficies siguen pintando «Ajustes» con sus dos líneas de siempre (R21);
      5. la tarjeta no recibe ninguna cifra que tenga que calcular: el resultado llega en la prop (R20);
      6. con `paraLaCentral` negativo: signo, tono de atención y **la nota** (R36);
      7. con `efectivoCubreDescuentos: false` y resultado positivo: **la nota del efectivo** (R37);
      8. la tarjeta **NO** enseña «Para la tienda» ni «Neto de Ordenex» (R39).
      **HECHO:** los ocho verdes; **M8**, **M9**, **M10** y **M16** los ponen rojos. Depende de F3.

- [x] **F5** — `CierresBodegaAdminModule.tsx`: montar las dos cascadas —**B primero**, `design.md
      §7.2`— en el agregado y en cada sección por `cierre_dia`, y **dejar de montar** las cinco
      tarjetas sueltas. Los componentes **no se borran**.
      **HECHO (corregido el 2026-09-08 — el criterio original se apoyaba en una premisa falsa):**
      los tres componentes siguen **exportados** y **no se borra ninguno**, que es lo que R30
      protege. Lo que el criterio daba por cierto —«siguen montados por `CierresAdminModule`»— **no
      lo era ni antes de la ficha**, y medirlo lo desmiente:
      · `PagoMensajeroTotal` e `IngresoBodegaRechazosTotal` los monta `ConsolidacionBodegaModule`
        (`:342` y `:349`), la pantalla de la satélite — no `CierresAdminModule`, que no los nombra;
      · `MontoDerivadoCard` **se queda SIN un solo consumidor** al retirarse las cinco tarjetas
        sueltas: antes de la ficha su único consumidor era `CierresBodegaAdminModule` (6 usos).
        Queda **declarado muerto** en la bitácora, igual que `GANANCIA_NOTA_BODEGA`, y **no se
        borra**: borrar un componente borra su test y con él cobertura de otras fichas, que en
        este árbol ya costó una regresión en producción.
      El criterio real, y el que se comprobó: `git grep` de los tres nombres en `app`, `lib`,
      `components` y `tests` + la guardia G2, que prohíbe montarlos en las superficies de bodega y
      **no** en las del mensajero. Depende de B5, F1, T0.4.

- [x] **F6** — `tests/components/CierreBodegaDetalleCascadas.test.tsx`:
      1. las dos cascadas son **dos regiones distintas** con nombres accesibles distintos (R1/R32);
      2. ninguna línea aparece en las dos regiones (R2);
      3. «Para la tienda» y «Neto de Ordenex» están y están destacados (R3);
      4. «Para la central» está y está destacado, con la misma cifra que la tarjeta (R4/R23);
      5. la línea puente aparece **también con flete por rechazo = 0** (R10);
      6. un neto negativo se pinta con signo y marcado como deuda (R11);
      7. un «Para la central» negativo lleva su nota (R36);
      8. la nota del efectivo aparece sólo cuando `efectivoCubreDescuentos` es `false` (R37);
      9. la nota de «Gana la bodega satélite» dice que no es un movimiento de caja (R27);
      10. cada sección por `cierre_dia` trae sus dos cascadas con los **mismos rótulos** (R23);
      11. no queda ninguna tarjeta suelta repitiendo una cifra de una cascada (R24/R34);
      12. el panel de totales por método sigue exactamente igual (R29).
      **HECHO:** los doce verdes; **M4**, **M11** y **M12** los ponen rojos. Depende de F5.

- [x] **F7** — Trasladar (no borrar) las aserciones que T0.4 encontró: lo que se afirmaba sobre los
      `aria-label` retirados se re-afirma sobre los rótulos de la cascada equivalente.
      **HECHO:** ningún test perdido sin sustituto; la tabla «aserción vieja → aserción nueva» en la
      bitácora. Depende de T0.4, F5.

---

## G — Guardias

- [x] **G1** — Ampliar `tests/components/DineroIdentidadesEnPantalla.test.tsx` (ficha 359):
      **añadir las dos superficies nuevas al censo de la Parte D** con su identidad declarada, y
      **dos casos a la Parte B** que rendericen de verdad la tarjeta de bodega y el detalle y
      afirmen con `laCuentaCierra` las cuatro identidades (R6-R9) **sobre las cadenas pintadas**.
      Segunda edición permitida de T0.6, y la que de verdad protege esta ficha: comprobarlo sobre
      los `Decimal` de origen sería una aserción contra su propia fuente, siempre verde.
      **HECHO:** el `expect(CENSO.length).toBe(13)` pasa a `.toBe(15)` con las dos rutas nuevas;
      todos los casos de la Parte A siguen intactos. Depende de F4, F6.

- [x] **G2 [P]** — `tests/unit/guards/cierre-bodega-vocabulario.guardia.test.ts` (guardia perenne),
      con **autocomprobación obligatoria** (una guardia estática rota no falla: **calla**):
      (a) el barrido ve un número plausible de fuentes de `app/(app)/cierres-admin/`;
      (b) el MISMO extractor encuentra los rótulos NUEVOS (o sea: sí lee texto visible y el cambio
          está puesto);
      (c) sobre dos fuentes sintéticas, el detector marca el literal y **no** marca el comentario
          (patrón exacto de `flete-por-rechazo-censo.guardia.test.ts`);
      (d) el censo: en las superficies del cierre de bodega no aparece «Ajustes» (R35), ni el
          rótulo de una cifra que ya es línea de cascada (R34), ni `CENTRAL_DEBE_LABEL` (D6/A8).
      **HECHO:** la guardia cae con el canario sintético y pasa con el árbol real. Depende de F3, F5.

- [x] **G3 [P]** — `tests/unit/guards/cascada-central-en-las-dos-pantallas.guardia.test.ts`:
      **toda** superficie de `app/**` que monte `<CierreBodegaFacturaResumen>` le pasa `cierre` con
      un dato del servidor (no un literal), y **ninguna** superficie que monte
      `<CierreFacturaResumen>` / `<CierreConsolidableFacturaResumen>` pasa `cascadaCentral`.
      Mismo patrón que `cierre-detalle-superficies.guardia.test.ts` (ficha 264), con su
      autocomprobación: el censo tiene que encontrar de verdad las **tres** superficies conocidas.
      **HECHO:** la guardia lista las tres rutas y cae si aparece una cuarta sin el dato. Es la red
      perenne de **R38**. Depende de F3.

- [x] **G4 [P]** — Comprobar que `factura-contraste.guardia` sigue verde: la cascada **no estrena
      ninguna utilidad de color** fuera del inventario cerrado (`design.md §7.1`).
      **HECHO:** guardia verde **sin editarla**. Si hubo que editarla, está mal el diseño del color.

- [x] **G5 [P]** — Comprobar que `cierre-detalle-superficies.guardia` sigue verde: esta ficha no
      toca `CierreFacturaDetalle` ni sus dos superficies.
      **HECHO:** guardia verde sin editarla.

---

## V — Verificación

- [x] **V1** — **`./init.sh` COMPLETO** (no `--rapido`: se niega, `design.md §11`), con
      `INIT_EXIT=$?` escrito **dentro** del log y en su propia línea, y **sin `tail` en la tubería**.
      **HECHO:** `INIT_EXIT=0` citado, más el número de `skipped` **contados y explicados** y la
      línea de `DATABASE_URL` — sin ella se saltan ~77 archivos contra Postgres y el gate miente en
      verde.

- [x] **V2** — **Verificación humana en la app real.** No hay E2E en este repo y no se inventa uno
      aquí.
      **Con el `adminSatelite`** (es quien necesita el número): entrar en su módulo de
      consolidación → desplegar la tarjeta de un cierre de bodega pasado → comprobar que la columna
      del medio dice «Lo que va a la central», que **la resta da** sumando a mano, y que **no**
      aparece ni «Para la tienda» ni «Neto de Ordenex».
      **Con el maestro:** `/cierres-admin` → (a) misma comprobación en la tarjeta, y que el valor es
      **el mismo** que ve la satélite; (b) abrir el detalle y comprobar que las dos cascadas están
      separadas y que **las tres restas dan**; (c) repetir con un cierre que tenga al menos una
      `rechazada` y comprobar que la línea puente explica la diferencia.
      **HECHO:** capturas y los resultados en `progress/impl_393.md`. Doce mil tests no vieron siete
      textos rotos que mirar la app sí vio: este paso no es opcional.

- [x] **V3** — Confirmar que **ningún archivo de T0.6 se editó** salvo C3 y G1.
      **HECHO:** `git diff --name-only` contra la base, contrastado con la lista de T0.6.

- [x] **V4** — Confirmar que **no hay migración**: `db/migrations/` y `db/schema.prisma` **sin
      tocar** (R28).
      **HECHO:** `git diff --name-only -- db/` vacío, citado.

- [x] **V5** — Escribir `progress/impl_393.md` con el mapa `R<n> → test`, la medición de T0.3, las
      mutaciones medidas y lo que quede vivo. **Y COMMITEARLO**: un informe sin commitear describe
      el disco, no la rama.

---

## Consultas de T0.3 — copiar y correr, en SOLO LECTURA

Nombres verificados en `db/schema.prisma`: `@@map("cierre_bodega")`, `@@map("cierre_dia")`,
`@@map("gestion_orden")`; columnas `total_efectivo`, `total_general`, `total_pago_mensajero`,
`total_ingreso_bodega_rechazos`, `cierre_bodega_id`, `cierre_id`, `resultado`, `anulada_at`.

**1 · Detalle por cierre — de dónde salen los ids si algo no cuadra.**

```sql
SELECT
  cb.id,
  cb.estado,
  cb.solicitado_at::date                                      AS solicitado,
  count(cd.id)                                                AS dias,
  cb.total_general,
  coalesce(sum(cd.total_general), 0)                          AS dias_general,
  cb.total_general - coalesce(sum(cd.total_general), 0)       AS dif_general,
  cb.total_pago_mensajero,
  coalesce(sum(cd.total_pago_mensajero), 0)                   AS dias_pago,
  cb.total_pago_mensajero - coalesce(sum(cd.total_pago_mensajero), 0)                     AS dif_pago,
  cb.total_ingreso_bodega_rechazos,
  coalesce(sum(cd.total_ingreso_bodega_rechazos), 0)          AS dias_bodega,
  cb.total_ingreso_bodega_rechazos - coalesce(sum(cd.total_ingreso_bodega_rechazos), 0)   AS dif_bodega,
  cb.total_general - cb.total_pago_mensajero - cb.total_ingreso_bodega_rechazos           AS para_la_central,
  cb.total_efectivo - cb.total_pago_mensajero - cb.total_ingreso_bodega_rechazos          AS holgura_efectivo
FROM cierre_bodega cb
LEFT JOIN cierre_dia cd ON cd.cierre_bodega_id = cb.id
GROUP BY cb.id
ORDER BY cb.solicitado_at DESC;
```

**2 · El veredicto, en una fila. Es el número que hay que escribir en la bitácora.**

```sql
WITH agg AS (
  SELECT
    cb.id,
    cb.total_general                 - coalesce(sum(cd.total_general), 0)                 AS dif_general,
    cb.total_pago_mensajero          - coalesce(sum(cd.total_pago_mensajero), 0)          AS dif_pago,
    cb.total_ingreso_bodega_rechazos - coalesce(sum(cd.total_ingreso_bodega_rechazos), 0) AS dif_bodega,
    cb.total_general  - cb.total_pago_mensajero - cb.total_ingreso_bodega_rechazos        AS para_la_central,
    cb.total_efectivo - cb.total_pago_mensajero - cb.total_ingreso_bodega_rechazos        AS holgura_efectivo
  FROM cierre_bodega cb
  LEFT JOIN cierre_dia cd ON cd.cierre_bodega_id = cb.id
  GROUP BY cb.id
)
SELECT
  count(*)                                                                     AS cierres,
  count(*) FILTER (WHERE dif_general = 0 AND dif_pago = 0 AND dif_bodega = 0)  AS cuadran,
  count(*) FILTER (WHERE dif_general <> 0 OR dif_pago <> 0 OR dif_bodega <> 0) AS descuadran,
  count(*) FILTER (WHERE para_la_central < 0)                                  AS negativos,
  count(*) FILTER (WHERE holgura_efectivo < 0)                                 AS efectivo_no_alcanza,
  min(para_la_central)                                                         AS peor_para_la_central,
  min(holgura_efectivo)                                                        AS peor_holgura_efectivo
FROM agg;
```

> **Cómo leerlo.** `cuadran = cierres` y `descuadran = 0` confirma `design.md §9` y desbloquea la
> ficha. `descuadran > 0` **para la ficha**. `negativos > 0` o `efectivo_no_alcanza > 0` confirman
> que los casos de §12 son reales y no teóricos — anótalos, porque son el mensaje de los tests de
> F4/F6. Y `cierres = 0` **no es una medición**: es una base vacía.

**3 · ¿Hay rechazos? — es lo que hace que la línea puente importe.**

```sql
SELECT
  count(*) FILTER (WHERE tiene_rechazo)     AS cierres_bodega_con_rechazos,
  count(*)                                  AS cierres_bodega
FROM (
  SELECT cb.id,
         EXISTS (
           SELECT 1
           FROM cierre_dia cd
           JOIN gestion_orden g ON g.cierre_id = cd.id
           WHERE cd.cierre_bodega_id = cb.id
             AND g.resultado = 'rechazada'
             AND g.anulada_at IS NULL
         ) AS tiene_rechazo
  FROM cierre_bodega cb
) t;
```

> Si `cierres_bodega_con_rechazos = 0`, la trampa 1 **sigue siendo real** (sale de la fórmula, no
> del dato) y R10 sigue siendo obligatorio: sólo significa que hoy nadie la ha visto todavía.

---

## Mutaciones — cada requisito se mide, no se declara

Se aplican al árbol real, se corre la suite y **se revierten desde copia** (nunca `git checkout`:
suele haber trabajo sin commitear). Cada una anota su alcance y sus rojos.

| # | Mutación | Debe poner rojo |
| --- | --- | --- |
| **M1** | `netoOrdenex` deja de restar la bodega (vuelve a ser `gananciaOrdenex`) | B2 casos 1 y 2 (R8) |
| **M2** | el agregado deriva `paraLaTienda` con `general − totalesIngreso.total` (alternativa A6) | B6 caso 3 (R6/R7) · G1 |
| **M3** | el `netoOrdenex` de cada día se deriva con el `total_pago_mensajero` **agregado** | B6 caso 2 (R15/R16) |
| **M4** | quitar la línea puente cuando `fleteDevolucionConIva === "0.00"` | F6 caso 5 (R10) |
| **M5** | el agregado se "corrige" para que iguale la suma de los días | B6 caso 4 (R17) |
| **M6** | la columna del archivo recalcula `paraLaCentral` en vez de leer el DTO | C4 (R22) |
| **M7** | `CascadaDinero` compone el monto con `Number(monto).toFixed(2)` | F2 (R13/R14) · G1 |
| **M8** | pintar «Ajustes» también cuando `cascadaCentral` está presente | F4 caso 1 (R19) · G2 |
| **M9** | pasar `cascadaCentral` también desde `CierreFacturaResumen` (cierre de mensajero) | F4 caso 4 (R21) · G3 |
| **M10** | `CierresBodegaSolicitadosLista` (satélite) deja de recibir el campo | F4 caso 3 (R38) · G3 |
| **M11** | volver a montar `MontoDerivadoCard` «Pago a tienda» junto a la cascada A | F6 caso 11 (R24/R34) · G2 |
| **M12** | fundir las dos cascadas en una sola región | F6 casos 1 y 2 (R1/R2) |
| **M13** | `paraLaCentral` recorta el negativo a `"0.00"` (alternativa A7) | B2 caso 4 (R36) · F4 caso 6 |
| **M14** | `efectivoCubreDescuentos` compara contra `general` en vez de contra `efectivo` | B2 caso 5 (R37) |
| **M15** | derivar `paraLaCentral` en un servicio en vez de en el mapper (una copia por lectura) | B7 (R38) — una de las cuatro lecturas se queda sin el campo |
| **M16** | montar la cascada A también en la tarjeta | F4 caso 8 (R39) |
| **M17** | cuadrar los importes al colón antes de pintarlos (la regla de la 230) | G1 (las cuatro identidades dejan de cerrar) |

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
| R4 | `CierreBodegaDetalleCascadas` caso 4 · `CierreBodegaTarjetaCascada` caso 2 |
| R5 | `CascadaDinero` › cada línea sustraendo se pinta con su signo |
| R6 | `cascadas-cierre-bodega` caso 7 · `cierres-bodega-admin-service` caso 1 · `DineroIdentidadesEnPantalla` (G1) |
| R7 | `cascadas-cierre-bodega` caso 6 · `cierres-bodega-admin-service` caso 3 · `DineroIdentidadesEnPantalla` (G1) |
| R8 | `cascadas-cierre-bodega` casos 1 y 2 · `DineroIdentidadesEnPantalla` (G1) |
| R9 | `cascadas-cierre-bodega` caso 3 · `CierreBodegaTarjetaCascada` caso 2 · `DineroIdentidadesEnPantalla` (G1) |
| R10 | `CierreBodegaDetalleCascadas` caso 5 · `cierres-bodega-admin-service` caso 3 |
| R11 | `CierreBodegaDetalleCascadas` caso 6 |
| R12 | `cierres-bodega-admin-service` (los cuatro derivados llegan del servicio) · `cierre-bodega-repository` (B7) |
| R13 | `CascadaDinero` › no altera el importe que recibe · `CierreBodegaTarjetaCascada` caso 5 |
| R14 | `cierre-bodega-vocabulario.guardia` (G2, mitad money-safe) |
| R15 | `cierres-bodega-admin-service` caso 2 |
| R16 | `cierres-bodega-admin-service` caso 2 · la medición de **T0.3** (consulta 2) |
| R17 | `cierres-bodega-admin-service` caso 4 |
| R18 | `CierreBodegaTarjetaCascada` caso 2 |
| R19 | `CierreBodegaTarjetaCascada` caso 1 · `cierre-bodega-vocabulario.guardia` (G2 d) |
| R20 | `CierreBodegaTarjetaCascada` caso 5 · `cierre-bodega-repository` › el mapper deriva el campo |
| R21 | `CierreBodegaTarjetaCascada` caso 4 · `cierres-bodega-descarga-columnas` (C4) · `CierreFacturaPapel` (sin editar) · V3 |
| R22 | `cierres-bodega-descarga-columnas` (C4) · `columnas-asercion-de-orden.guardia` (C3) |
| R23 | `CierreBodegaDetalleCascadas` casos 4 y 10 · `cierre-bodega-vocabulario.guardia` (G2) |
| R24 | `CierreBodegaDetalleCascadas` caso 11 · `cierre-bodega-vocabulario.guardia` (G2 d) |
| R25 | `CierreBodegaDetalleCascadas` › la línea se llama «Gana la bodega satélite» · G2 |
| R26 | `CierreBodegaTarjetaCascada` › la nota de la resta está bajo el resultado |
| R27 | `CierreBodegaDetalleCascadas` caso 9 |
| R28 | **V4** (`git diff -- db/` vacío) |
| R29 | `CierreBodegaDetalleCascadas` caso 12 |
| R30 | `CierresAdminModule` y `CierreFacturaPapel` sin editar (T0.6/V3) · **M9** |
| R31 | `cierres-bodega-admin-service` › `pagoTienda` y `ganancia` devuelven lo mismo que antes · B8 |
| R32 | `CascadaDinero` › la región tiene nombre accesible · `CierreBodegaDetalleCascadas` caso 1 |
| R33 | `cierre-bodega-vocabulario.guardia` (G2 b) |
| R34 | `CierreBodegaDetalleCascadas` caso 11 · `cierre-bodega-vocabulario.guardia` (G2 d) |
| R35 | `cierre-bodega-vocabulario.guardia` (G2 d) + su autocomprobación (G2 a-c) |
| R36 | `cascadas-cierre-bodega` caso 4 · `CascadaDinero` › tono del negativo · `CierreBodegaTarjetaCascada` caso 6 · `CierreBodegaDetalleCascadas` caso 7 |
| R37 | `cascadas-cierre-bodega` caso 5 · `CierreBodegaTarjetaCascada` caso 7 · `CierreBodegaDetalleCascadas` caso 8 |
| R38 | `CierreBodegaTarjetaCascada` caso 3 · `cierre-bodega-repository` (B7) · `cascada-central-en-las-dos-pantallas.guardia` (G3) |
| R39 | `CierreBodegaTarjetaCascada` caso 8 · **M16** |

---

## Lo que esta ficha NO hace

1. **No añade ninguna columna de base ni migración** (`design.md §1` y §8 A2). Si alguien concluye
   que hace falta, **para**.
2. **No pone la cascada A en la tarjeta** — decisión del humano (H2/R39), no una limitación técnica
   pendiente.
3. **No renombra `INGRESO_BODEGA_RECHAZOS_LABEL` en toda la app** — es **Q4**.
4. **No toca las superficies del cierre de mensajero** ni el `cierre_dia` consolidable.
5. **No calcula «Central debe» ni reparte el efectivo** en un cierre de bodega ya cerrado: eso vive
   en la consolidación (`CierreBodegaService.ts:96-127`) y sólo se calcula antes de solicitar.
   Cuando el efectivo no llega, esta ficha **lo dice** (R37); no lo cuantifica. Es **Q7**.
6. **No toca el flujo de aprobación** aunque «Para la central» salga negativo (**Q7**).
7. **No arregla ni maquilla un descuadre de snapshot** si T0.3 encuentra uno: se para y se abre
   ficha aparte.

---

## Cierre de las 35 casillas — qué se comprobó, y CÓMO (2026-09-08)

> Las 35 se marcaron **una a una contra el árbol**, no de memoria ni por lo que dijera una
> bitácora: cada fila dice el comando o el `archivo:línea` que lo sostiene. El reviewer las
> encontró a 0 de 35 y tenía razón: marcar obliga a decir por escrito cuál se cumplió **de otra
> forma**. Las cinco que terminaron con un resultado distinto del previsto van con ⚠️.

| Tarea | Cómo se comprobó |
| --- | --- |
| T0.1 | tabla de los once símbolos → archivo → línea en `progress/impl_393.md` §T0.1; los cuatro que toca la pantalla (`HojaResumen`, `CierreBodegaFacturaResumen` y los dos listados) reconfirmados en el archivo real antes de editarlos |
| T0.2 | `progress/impl_393.md` §T0.2: «Pago a tienda» y «Ganancia» ya estaban; `grep` de «para la central» daba **cero** en todo el árbol |
| T0.3 | **medida por el leader contra producción**: 14 cierres · 14 cuadran · 0 descuadran · **1 negativo** (peor −₡1.000) · **2 sin efectivo** (peor −₡2.000). Las tres cifras están escritas en los docstrings y en los tests |
| T0.4 | ⚠️ **resultado distinto del previsto: el censo salió VACÍO.** `grep` de los cinco `aria-label` y sus gemelos `· <mensajero>` en todo `tests/` y `e2e/` → cero. Re-verificado por el frontend y por el reviewer contra el commit base (`4c804490~1`) |
| T0.5 | escrito antes de empezar en las dos bitácoras: el diff toca `cierre`/`ingreso`/`pago`/`factura` → **el gate de esta ficha es `./init.sh` completo** |
| T0.6 | conteos de partida en las dos bitácoras (backend 134 passed → 140; frontend 140 → 145) |
| B1 | `lib/utils/ingreso-ordenex.ts`: `cobradoSobreRecaudado:375`, `netoOrdenex:396`, `paraLaCentral:426`, `efectivoCubreDescuentos:453`. `gananciaOrdenex`/`pagoTiendaOrdenex` sin tocar |
| B2 | `tests/unit/utils/cascadas-cierre-bodega.test.ts` (8 casos, con céntimos); M1/M13/M14 medidas con su rojo |
| B3 | `ICierreBodegaService.ts:49,56,94,100,106,110` — campos **requeridos**; el rojo de typecheck en 14 archivos de test es la prueba |
| B4 | `CierreBodegaRepository.ts:111,113` — el mapper **llama** a las puras; M15 mata 6 lecturas |
| B5 | `CierresBodegaAdminService.ts:315-330` (por día) y `:380-386` (agregado), cada nivel desde sus propios snapshots |
| B6 | `tests/unit/services/cierres-bodega-admin-service.test.ts`, 7 casos; M2/M3/M5 con su rojo |
| B7 | `tests/unit/repositories/cierre-bodega-repository.test.ts`, las **ocho** lecturas; M15 |
| B8 | typecheck verde con los 14 literales actualizados; dos excepciones razonadas escritas en la bitácora |
| C1 | `cierre-labels.ts:110-205`, las 13 constantes; la re-exportación desde `cierre-detalle-shared.tsx:56,125` la completó el frontend |
| C2 | `cierres-bodega-descarga-columnas.ts:102,133,191` — la columna, **al final** de los tres; consolidables sin ella |
| C3 | ⚠️ **resultado distinto del previsto:** `columnas-asercion-de-orden.guardia` y `cobertura-tablas.guardia` **NO hubo que tocarlas** (son estructurales, no literales). Lo que se amplió fueron las tres aserciones de orden de `cierres-bodega-descarga-columnas.test.ts`, **añadiendo el elemento al esperado**, nunca aflojando el `toEqual` |
| C4 | mismo archivo: canario `77777.77` que no es la resta de su propia fila; M6 lo mata |
| F1 | `app/(app)/cierres-admin/_components/CascadaDinero.tsx`; la guardia money-safe lo lee entero |
| F2 | `tests/components/CascadaDinero.test.tsx`; M7 medida — y la bitácora dice **por qué no cae en el DOM** en vez de atribuirse la cobertura |
| F3 | `cierre-factura.tsx:655,681,829-865` (prop y columna) y `:934` (la tarjeta de bodega la pasa); las otras tres superficies sin tocar (G3 + F4 caso 4) |
| F4 | `tests/components/CierreBodegaTarjetaCascada.test.tsx`, 12 casos; M8/M9/M10/M16 con su rojo |
| F5 | ⚠️ ver el criterio **corregido** arriba: los tres siguen exportados; `MontoDerivadoCard` queda **muerto y declarado**, no borrado |
| F6 | `tests/components/CierreBodegaDetalleCascadas.test.tsx`, 17 casos (16 + la nota fija de R26 que faltaba); M4/M11/M12 con su rojo |
| F7 | ⚠️ **resultado distinto del previsto: sin trabajo, con motivo medido.** T0.4 salió vacío, así que no había ninguna aserción que trasladar |
| G1 | `tests/components/DineroIdentidadesEnPantalla.test.tsx:1096` → `toBe(15)`; los dos casos nuevos leen el DOM con su propio parseador |
| G2 | `tests/unit/guards/cierre-bodega-vocabulario.guardia.test.ts`, 24 casos. **Ampliada el 2026-09-08:** el barrido money-safe lee `cierre-factura.tsx` **entero** (antes se quedaba en dos trozos que no alcanzaban a `LineaMonto`/`conOperador`) y el VALOR de los 8 rótulos y las 5 notas se ancla contra literales escritos a mano |
| G3 | `tests/unit/guards/cascada-central-en-las-dos-pantallas.guardia.test.ts`, 11 casos, las tres rutas con autocomprobación |
| G4 | ⚠️ **resultado distinto del previsto (y es el bueno): verde SIN editarla.** `factura-contraste.guardia` sigue pasando porque la cascada no estrena ni una clase de color: reusa el inventario cerrado, `text-danger-strong` incluido (par P11) |
| G5 | ⚠️ **ídem: verde sin editarla.** `cierre-detalle-superficies.guardia` no se tocó; esta ficha no entra en `CierreFacturaDetalle` |
| V1 | `./init.sh` **completo** (el rápido se niega), con `INIT_EXIT=$?` escrito DENTRO del log y sin `tail` en la tubería; corrido por el backend, por el frontend, por el reviewer y una cuarta vez al cerrar los bloqueantes |
| V2 | **hecho el 2026-09-08 en la app real**, no en jsdom: servidor propio en el puerto 3021 con `.next` propio, base local sembrada y **restaurada después**. Cifras y textos en `progress/impl_393_frontend.md` § «V2 — la pantalla, mirada» |
| V3 | `git diff --name-only 6fd97d06 HEAD` cruzado con la lista de T0.6: de los nueve, **dos** editados, y los dos son las ampliaciones declaradas (G1 y C3/C4) |
| V4 | `git diff --name-only 6fd97d06 HEAD -- db/` → **vacío** |
| V5 | `progress/impl_393.md` y `progress/impl_393_frontend.md`, **commiteados** (no sólo escritos en disco) |
