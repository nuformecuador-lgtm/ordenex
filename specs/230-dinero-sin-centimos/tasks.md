# Feature 230 — El dinero se pinta sin céntimos · tasks.md

> Checklist de pasos discretos y verificables. `[P]` = paralelizable **dentro de su bloque**. Cada
> task lleva su criterio de **Hecho**.
>
> **Los bloques 1–3 son `backend_dev` (`lib/**`, `tests/unit/**`); los bloques 4–5 son
> `frontend_dev` (`app/**`, `components/**`, `tests/components/**`).** La implementación se
> **secuencia backend → frontend**: el bloque 4 no arranca hasta que el 1 está verde, porque los
> tres archivos de UI **heredan** el formato del módulo.
>
> Gate: `./init.sh --rapido` al cerrar cada tanda; **`./init.sh` completo antes del PR, sin
> excepción** (`docs/verification.md`).
>
> ⛔ **El bloque 5 no se hace con `sed`.** 265 líneas se releen **una a una**: cada una afirma algo
> —un redondeo, un cero, un negativo— y reescribirlas a ciegas convierte la suite en decorado.

---

## Bloque 0 — Puerta humana (BLOQUEA el resto)

- [ ] **T0.1 — Respuesta a las preguntas abiertas Q1, Q2 y Q3** de `requirements.md` §4.
  **Hecho:** las tres respuestas quedan escritas en `requirements.md` §4 con fecha, y el
  `status_note` de la ficha 230 las resume. **Q1 bloquea T1.4 y T2.5.** Si no llega respuesta a Q1,
  se implementa la opción **(b)** —conservar el campo— por ser la reversible, y se deja escrito como
  deuda declarada. *(Lo hace el leader.)*
- [ ] **T0.2 [P] — Registrar en `progress/impl_230.md` las consecuencias YA aceptadas**: A1 (una
  columna puede no cuadrar con su total por ±1/±2), A2, A3 de `requirements.md` §3, y las cuatro
  contradicciones C1–C4 de §5.
  **Hecho:** están escritas como **decisiones**, no como pendientes. El reviewer no debe tratarlas
  como hallazgos.
- [ ] **T0.3 [P] — Ficha y rama.** `feature_list.json` id 230: `spec_path`, `status: spec_ready` →
  `in_progress`, `branch: feature/230-dinero-sin-centimos`.
  **Hecho:** `./init.sh` valida la ficha; no hay más de 2 features `in_progress` en la zona
  `fullstack`. *(Lo hace el leader.)*

---

## Bloque 1 — `backend_dev` · el único cambio de verdad: `lib/config/moneda.ts`

Depende de: T0.1.

- [ ] **T1.1 — `sumarUno(enteros: string): string`**, privada del módulo: acarreo manual de derecha a
  izquierda, `'9' → '0'` arrastrando, y `'1'` antepuesto si el acarreo sobrevive (design §2.2).
  **Hecho:** typecheck verde; la función **no** contiene `Number(`, `parseFloat(`, `parseInt(` ni
  aritmética sobre números; cubierta por T2.4 (`"999" → "1000"`, `"9" → "10"`, `"0" → "1"`,
  `"999999" → "1000000"`).
- [ ] **T1.2 — `redondearEnteros(enteros, decimales)`**: mira **solo** el primer dígito decimal
  (≥`'5'` llama a `sumarUno`, si no devuelve `enteros` tal cual); `decimales === null` o vacío →
  `enteros` (design §2.2). Depende de T1.1.
  **Hecho:** typecheck verde; sin conversiones; cubre **R2** y **R6**.
- [ ] **T1.3 — Nuevo cuerpo de `formatMontoString`** (design §2.3): redondear **antes** de agrupar, y
  **caída del signo** cuando el resultado es cero. Depende de T1.2.
  **Hecho:** la tabla de contrato de `design.md` §2.4 pasa entera; `-0.49` da `₡0` y **nunca** `-₡0`;
  las ramas de ausencia (R9) y verbatim (R8) quedan **byte a byte** como estaban. Cubre **R1–R5,
  R7–R10**.
- [ ] **T1.4 — Docstrings del módulo y decisión sobre `separadorDecimal`** (R18, C4). El docstring de
  `formatMontoString` dice hoy «los decimales se copian VERBATIM» y el de `formatMonto` justifica su
  `toFixed(2)` con que «es lo que hace que un importe entero se pinte `₡320,00` y no `₡320`»: los dos
  dejan de ser ciertos. Aplicar la respuesta de **Q1** al campo `separadorDecimal` y a
  `MONEDA_SEPARADOR_DECIMAL`. Depende de T1.3 y de T0.1.
  **Hecho:** ningún docstring del módulo promete decimales; si Q1 = (a), el campo y su variable ya no
  existen en el código ni en los tests; si Q1 = (b), el docstring del campo dice explícitamente que
  **ya no gobierna la salida** y por qué se conserva.
- [ ] **T1.5 — `pnpm exec vitest related --run lib/config/moneda.ts`** para medir el radio real del
  cambio antes de tocar un solo test de pantalla.
  **Hecho:** la lista de archivos y el conteo quedan pegados en `progress/impl_230.md`. Es la entrada
  del bloque 5: si aparece un archivo que **no** está en el censo de 39, se añade allí.

**Dependencias del bloque:** T1.1 → T1.2 → T1.3 → T1.4 → T1.5.

---

## Bloque 2 — `backend_dev` · donde vive el contrato: `tests/unit/config/moneda-formato.test.ts`

Depende de: bloque 1. Es el archivo más pesado del censo (**27 líneas**) y el único donde el
comportamiento se **define**, no se **observa**.

- [ ] **T2.1 — Los dos tests que MUEREN, nombrados uno a uno.** No se editan: se **retiran** y su
  razón se escribe en el archivo, para que nadie los resucite por costumbre.
  1. `:71` — «copia los decimales VERBATIM: ni rellena ni recorta». Afirmaba el corazón de lo que
     esta feature cambia (`"1500.5" → ₡1.500,5`).
  2. `:168` — «un importe ENTERO se pinta con los dos decimales» (`formatMonto(320) → ₡320,00`).
     Tras la 230 los dos caminos dan `₡320` y la asimetría que documentaba **deja de existir**.
  **Hecho:** los dos han desaparecido; en su lugar hay un comentario de una línea que dice qué
  afirmaban y qué feature los retiró.
- [ ] **T2.2 — Reescribir las aserciones de aspecto** de los bloques `formatMontoString — el formato
  objetivo` (`:42`, `:51`, `:83`, `:92`) y `formatMonto … MISMO aspecto` (`:141`, `:149`, `:177`)
  contra la tabla de `design.md` §2.4.
  **Hecho:** cada aserción reescrita **afirma un redondeo concreto**, no un formato genérico; las
  aserciones de bordes de agrupación (`"999"`, `"1000"`, `"1000000"`) y la de «ningún resultado
  empieza por el separador» **sobreviven intactas** — son de agrupación, no de decimales. Cubre
  **R2, R3, R5, R10**.
- [ ] **T2.3 [P] — Los bloques de ausencia y verbatim NO se tocan** (`:106`, `:110`, `:121`, `:128`,
  `:132`).
  **Hecho:** verificado que pasan **sin editar una línea**. Si alguno hubiera que tocar, es señal de
  que T1.3 cambió algo que no debía. Cubre **R8, R9**.
- [ ] **T2.4 — El test más importante SE TRANSFORMA, no muere** (`:262`, «los decimales sobreviven a
  un importe que un `number` no puede representar»). Mismo propósito —el módulo trabaja dígito a
  dígito—, nueva afirmación: **el redondeo de un importe de once dígitos es exacto**
  (`"99999999999.51" → ₡100.000.000.000`; `"99999999999.49" → ₡99.999.999.999`;
  `"12345678901.99" → ₡12.345.678.902`). Y el barrido money-safe de `:238` **se conserva entero**,
  contraprueba incluida.
  **Hecho:** el archivo sigue afirmando que el módulo no llama a `Number(`/`parseFloat(`/`parseInt(`
  y que su único `toFixed` es de escala 2; los tres importes de once dígitos pasan. Cubre **R7**.
- [ ] **T2.5 — Tests nuevos de los bordes que la feature crea**: acarreo que cambia dígitos
  (`999.50 → ₡1.000`, `9.99 → ₡10`, `999999.99 → ₡1.000.000`), **cero con signo**
  (`-0.49 → ₡0`, `-0.00 → ₡0`), más de dos decimales (`10.4999 → ₡10`, `10.5001 → ₡11`), y el
  **doble redondeo declarado** de C3 (`formatMonto(1234.4951)`, con el comentario que explica por qué
  el resultado es el que es y que solo ocurre fuera del contrato de escala 2).
  **Hecho:** los cuatro grupos pasan; el de C3 **fija** el comportamiento elegido en `design.md`
  §7/A3 en vez de dejarlo implícito. Cubre **R3, R4, R6**.
- [ ] **T2.6 — Bloque «el formato sale de configuración»** (`:183`, `:201`, `:216`, `:225`) según la
  respuesta a **Q1**. Hoy `:201` afirma que «cambian el símbolo y **LOS DOS** separadores». Depende
  de T1.4.
  **Hecho:** con otra configuración, `13331832.72` se pinta con el otro símbolo y el otro separador
  de miles **y sin decimales**; si Q1 = (a), ninguna aserción menciona ya el separador decimal; si
  Q1 = (b), hay una aserción que afirma explícitamente que cambiarlo **no altera** la salida. Cubre
  **R11**.

**Dependencias:** T2.1 → T2.2; T2.4, T2.5 tras T1.3; T2.6 tras T1.4.

---

## Bloque 3 — `backend_dev` · la guardia nueva (es lo que impide que esto se deshaga)

Depende de: bloque 1. Archivo: `tests/unit/guards/dinero-sin-centimos.guardia.test.ts`
(el sufijo `guardia` la mete sola en `pnpm run test:guardias` y en `./init.sh --rapido`).

- [ ] **T3.1 — Diente 1 (comportamiento).** Corpus determinista de importes **con forma decimal**
  (los de `design.md` §2.4 + 0–3 decimales × negativos × 1–12 dígitos enteros × primer decimal 0–9)
  por los **cinco** caminos: `formatMontoString`, `money`, `formatMonto`, `PriceLabel` renderizado y
  `formatearValor(v, "moneda")`.
  **Hecho:** ninguna salida contiene el separador decimal seguido de un dígito; el sub-caso `,\d\d`
  se afirma aparte por ser el que pidió el humano; el corpus tiene **más de 100 casos** y el test lo
  afirma (para que no pase por no mirar nada). Cubre **R1, R12, R19(a)**.
- [ ] **T3.2 — Diente 2 (estructura, anti-bypass).** Barrido de `app/**` y `components/**` con
  `quitarComentarios` (`tests/fixtures/sin-comentarios.ts`) buscando `.toFixed(`, con **lista blanca
  censada** de usos no monetarios: hoy **uno**, `components/shared/BulkUpload.tsx` (tamaño en MB).
  **Hecho:** el barrido recorre **más de 100 archivos** y el test lo afirma; con el árbol actual (ya
  con T4.1 aplicada) sale verde; los dos `toFixed(2)` que viven en **comentarios** de
  `ordenes-columns.tsx` **no** lo ponen rojo. Cubre **R19(b)**.
- [ ] **T3.3 [P] — Diente 3 (frontera de descargas).** `lib/utils/descarga-dataset.ts` y
  `lib/utils/manifiesto-xlsx.ts` no importan `@/lib/config/moneda` ni nombran
  `money(`/`formatMonto(`/`formatMontoString(`; contraprueba con un fuente ficticio que sí lo
  importa.
  **Hecho:** verde hoy, rojo con la contraprueba. Cubre **R16**.
- [ ] **T3.4 [P] — Diente 4 (el no-objetivo D2 y la excepción verbatim C2).**
  `formatearValor(0.842, "porcentaje")` y `formatearValor(5400, "segundos")` conservan su dígito
  decimal, comparados contra el mismo `Intl.NumberFormat` que los produce hoy (**no** contra un
  literal inventado); y un test propio deja escrito que la rama **verbatim** puede emitir `₡1,50` y
  está **fuera** del diente 1.
  **Hecho:** si alguien «sanea» también los porcentajes o las duraciones, este diente se pone rojo.
  Cubre **R15**.
- [ ] **T3.5 — LAS DOS MUTACIONES, EJECUTADAS.** (a) revertir el paso 5 de `design.md` §2.3 (o
  inyectar un formateador que conserve céntimos) → **diente 1 rojo**; (b) devolver
  `row.montoCobrar.toFixed(2)` a la celda del resumen de carga → **diente 2 rojo**. Depende de T3.1,
  T3.2 y T4.1.
  **Hecho:** la salida **roja real** de las dos está pegada en `progress/impl_230.md`, y el árbol
  queda restaurado y verde después. **Una guardia que nadie vio morder no está probada.** Cubre
  **R19**.

---

## Bloque 4 — `frontend_dev` · los 3 archivos de UI (no arranca hasta que el bloque 1 está verde)

Depende de: bloque 1.

- [ ] **T4.1 — `app/(app)/ordenes/_components/OrdenesCargaResumen.tsx:97` — LA ÚNICA FUGA.** Sustituir
  `row.montoCobrar.toFixed(2)` por el formateador compartido; `formatMonto` ya devuelve `"-"` cuando
  el monto es `null`, que es el marcador que la celda pinta hoy a mano.
  **Hecho:** con `montoCobrar = 1234.56` la celda muestra `₡1.235` (con símbolo y separador de
  miles, que hoy **no tiene**); con `null` sigue mostrando `-`; el archivo ya no contiene `.toFixed(`.
  Test: `tests/components/…` o `tests/unit/components/…` del resumen de carga. Cubre **R13**.
- [ ] **T4.2 [P] — `components/shared/KpiValorAnimado.tsx:96`**: `decimals` pasa a **0** en modo
  moneda. **No tocar** la memoización de `formatear` ni sus dependencias (el comentario del archivo
  explica que react-countup reinicia la animación si cambia la identidad de `formattingFn`).
  **Hecho:** `tests/components/KpiValorAnimado.test.tsx` afirma que en modo moneda el texto —inicial
  y final— no contiene el separador decimal seguido de un dígito, y que el modo **no** moneda no
  cambia. Cubre **R14**.
- [ ] **T4.3 [P] — `components/shared/PriceLabel.tsx`: solo el docstring** (R18, C4). Hoy promete
  «SIEMPRE dos decimales (`₡1.234,50`, `₡0,00`)» y su punto 3 justifica los ceros finales por la
  alineación de la coma en una columna `tabular-nums` — justificación que desaparece cuando todas las
  filas son enteras. El contrato «sin valor → cero, no marcador de ausencia» **se conserva**
  (pasa a `₡0`).
  **Hecho:** ninguna línea de código cambia; el docstring describe el formato vigente y no queda
  ninguna promesa de decimales. Cubre **R18**.

---

## Bloque 5 — `frontend_dev` · las 265 líneas que afirman un importe con dos decimales

Depende de: bloques 1 y 4. **276 apariciones en 265 líneas de 39 archivos** (censo medido por el
leader). **Se releen una a una.** Cada lote se cierra con `./init.sh --rapido`.

**Método, igual para los cinco lotes:**
1. Leer la línea y decidir **qué afirma**: ¿un redondeo? ¿un cero? ¿un negativo? ¿un total?
2. Reescribir el valor esperado aplicando D1 (half away from zero) **a mano**, no con un reemplazo.
3. Si la línea afirma un **total** de una columna, comprobar A1: el total es el redondeo del total,
   no la suma de los redondeos (**R20**).
4. Si al reescribirla el test deja de afirmar algo, **decirlo** en `progress/impl_230.md` en vez de
   dejar una aserción vacía.

- [ ] **T5.0 — Lista de trabajo.** Regenerar el censo sobre el árbol actual y cruzarlo con la salida
  de T1.5.
  **Hecho:** la lista definitiva (archivo → nº de líneas) está en `progress/impl_230.md`; cualquier
  archivo que aparezca y **no** esté en los 39 se añade al lote que le toque.
- [ ] **T5.1 — Lote WALLET (8 archivos, 70 líneas)**: `tests/integration/wallet-tiendas-desglose`
  (22), `tests/integration/wallet-tiendas-pago` (13), `tests/integration/mi-wallet-page` (13),
  `tests/unit/components/wallet-desglose-egresos-card` (8), `tests/integration/wallet-mensajeros-page`
  (8), `tests/components/WalletMensajerosAvisoBrutos` (4),
  `tests/unit/components/wallet-indemnizacion-libro` (1),
  `tests/unit/components/wallet-gastos-fijos-panel` (1).
  **Hecho:** los 8 verdes; ninguna aserción de importe quedó como `expect(...).toBeTruthy()` ni
  equivalente. Aporta a **R12** y **R20**.
- [ ] **T5.2 [P] — Lote CIERRES (6 archivos, 52 líneas)**: `CierresAdminModule` (20),
  `CierreDiaModule` (15), `CierresAdminPagoMensajero` (7), `CierreDetallePagos` (7),
  `CierreDiaModuleIncidente` (2), `CierreDetalleIncidente` (1).
  **Hecho:** los 6 verdes; los desgloses que suman (efectivo/simpe/transferencia vs. general) se
  revisan contra A1/**R20**.
- [ ] **T5.3 [P] — Lote PAGOS Y LIQUIDACIÓN (9 archivos, 47 líneas)**:
  `tests/integration/mis-pagos-page` (10), `PagoMensajeroAcciones` (10),
  `paginacion/CuentasPorPagarPaginacion` (9), `PagosRegistradosTabla` (8), `CuentasPorPagarTable` (4),
  `tests/unit/components/desglose-tienda-labels` (2), `RegistrarPagoDialog` (2), `AnularPagoDialog`
  (1), `DesglosePagosMensajero` (1).
  **Hecho:** los 9 verdes. **Atención:** los mensajes de «excede lo disponible» de liquidación
  incrustan un importe formateado; se relee el texto completo, no solo el número.
- [ ] **T5.4 [P] — Lote OPERACIÓN (8 archivos, 51 líneas)**: `CajaResumenCard` (16),
  `tests/unit/components/ordenes-columns` (9), `RepartoPrevisualizacion` (8), `PanelConciliacion` (6),
  `IncidentesAdminModule` (6), `RechazosSlaModule` (3), `NovedadesModule` (2), `RecogerModule` (1).
  **Hecho:** los 8 verdes. `ordenes-columns` es money-safe vigilado por la guardia de la 204: se
  revisa que **ninguna** edición introduzca una conversión.
- [ ] **T5.5 [P] — Lote PRECIO, RANKING Y ANALÍTICA (5 archivos, 16 líneas)**: `PriceLabel` (11),
  `descarga/RankingHistoricoDescarga` (2), `RankingHistoricoModule` (1), `TableroFinanciero` (1),
  `AnalyticsKpiCard` (1).
  **Hecho:** los 5 verdes. **Dos cuidados:** (a) `RankingHistoricoDescarga` toca **descargas** — si
  alguna aserción afirma el contenido del archivo descargado, **conserva los céntimos** (R16), no se
  redondea; (b) `AnalyticsKpiCard` y `TableroFinanciero` mezclan moneda con porcentaje/duración: solo
  se toca la moneda (**R15**).
- [ ] **T5.6 — Los 2 archivos de test de `lib/` del censo**: `tests/unit/services/`
  `indemnizacion-tope-negocio-incidente` (1) y `tests/unit/analytics/`
  `financiera-unidad-de-vistas.guardia` (1). *Es `backend_dev`, pero se cierra aquí para no partir el
  censo.*
  **Hecho:** los 2 verdes. **Ojo:** el segundo es una **guardia**; si su aserción de importe es sobre
  el **DTO** (frontera, escala 2) y no sobre lo pintado, **no se toca** — y se deja escrito por qué.
- [ ] **T5.7 — Barrido de cierre del censo.** Volver a contar las apariciones de un importe con dos
  decimales en `tests/**`.
  **Hecho:** las que queden están **justificadas una a una** en `progress/impl_230.md` (frontera de
  escala 2, contenido de descarga, o afirmación sobre el DTO). Cero sin justificar.

---

## Bloque 6 — Cierre

Depende de: todos los anteriores.

- [ ] **T6.1 — `./init.sh` completo, verde.** Sin excepción, antes del PR
  (`docs/verification.md`; la lección de los PR #209 y #237).
  **Hecho:** typecheck 0, lint 0 errores, suite entera verde; el conteo de archivos/tests queda
  pegado en `progress/impl_230.md`.
- [ ] **T6.2 — Mapa `R<n> → test` en `progress/impl_230.md`**, con el **nombre del test ejecutado**,
  no con el archivo.
  **Hecho:** los **20** requisitos tienen su test nombrado y su salida real. El reviewer rechaza si
  falta uno (`docs/specs.md` §Trazabilidad).
- [ ] **T6.3 — Verificación a ojo (una pantalla real).** Abrir wallet, un cierre y el listado de
  órdenes con la app corriendo.
  **Hecho:** captura o descripción en `progress/impl_230.md` de al menos **tres** pantallas sin
  céntimos, incluida la del **resumen de carga** (T4.1). *(«Ver la app encuentra lo que la suite
  no».)*
- [ ] **T6.4 — PR contra `dev`** con el resumen de la superficie: 4 archivos de producción, 1 guardia
  nueva, ~42 archivos de test tocados (los 39 del censo + la guardia + los de T4.1/T4.2),
  **0 migraciones**.
  **Hecho:** PR abierto tras T6.1, no antes.

---

## Trazabilidad — `R<n>` → test

| R | Qué afirma | Test | Task |
| --- | --- | --- | --- |
| R1 | Ningún importe se pinta con decimales | `dinero-sin-centimos.guardia` → diente 1 | T3.1 |
| R2 | Redondeo half away from zero | `moneda-formato` → «el formato objetivo» (reescrito) | T2.2 |
| R3 | Acarreo que cambia dígitos y reagrupa | `moneda-formato` → «acarreo: 999,50 → ₡1.000» (nuevo) | T2.5 |
| R4 | Cero sin signo (`-0,49 → ₡0`) | `moneda-formato` → «el cero redondeado no lleva signo» (nuevo) | T2.5 |
| R5 | Importe sin decimales se pinta igual | `moneda-formato` → «el separador de miles no se cuela» (conservado) | T2.2 |
| R6 | Más de dos decimales: manda el primero | `moneda-formato` → «más de dos decimales» (nuevo) | T2.5 |
| R7 | Sin `Number(`/`parseFloat(`/`parseInt(`; exacto con 11 dígitos | `moneda-formato` → «money-safe» (`:238` conservado) + «el redondeo de un importe que un `number` no representa» (`:262` transformado) | T2.4 |
| R8 | Lo que no tiene forma de decimal, verbatim | `moneda-formato` → «lo que no tiene forma de decimal» (**sin tocar**) + diente 4 | T2.3, T3.4 |
| R9 | Ausencia → marcador, sin cambios | `moneda-formato` → bloque «ausencia de importe» (**sin tocar**) | T2.3 |
| R10 | Signo delante del símbolo | `moneda-formato` → «el signo negativo va DELANTE» (reescrito) | T2.2 |
| R11 | Símbolo y miles por configuración | `moneda-formato` → «el formato sale de configuración» | T2.6 |
| R12 | Los cinco caminos dan lo mismo | `dinero-sin-centimos.guardia` → diente 1 (cinco caminos) | T3.1, T5.1–T5.5 |
| R13 | La celda del resumen de carga pasa por el formateador | test del resumen de carga: `₡1.235` con `1234.56` | T4.1 |
| R14 | KPI animado en moneda: 0 decimales | `KpiValorAnimado.test.tsx` | T4.2 |
| R15 | Porcentaje, duración y conteo intactos | `dinero-sin-centimos.guardia` → diente 4 (contra `Intl`) | T3.4 |
| R16 | Las descargas conservan los céntimos | `dinero-sin-centimos.guardia` → diente 3 + `RankingHistoricoDescarga` | T3.3, T5.5 |
| R17 | Sin migración ni cambio de escala en el DTO | Los tests de servicios/repositorios pasan **sin tocarlos** + revisión del diff (0 migraciones) | T6.1, T6.4 |
| R18 | Ningún docstring promete decimales | `dinero-sin-centimos.guardia` → prosa de la superficie de dinero | T1.4, T4.3 |
| R19 | La guardia existe **y muerde** | Las dos mutaciones ejecutadas, con salida roja pegada | T3.5 |
| R20 | El total es el redondeo del total, no la suma de redondeos | Test de total de columna (wallet/cierres) | T5.1, T5.2 |

**Cobertura:** 20 requisitos, 20 mapeados. **34 tasks** en 7 bloques (0–6).
