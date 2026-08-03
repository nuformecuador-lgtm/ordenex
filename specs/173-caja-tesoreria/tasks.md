# Feature 173 — La caja principal en modo tesorería · tasks

> Checklist de pasos discretos y verificables. `[P]` = paralelizable con las demás tasks de su
> misma tanda. Cada task declara **archivos esperados**, **dependencias**, criterio de **hecho** y
> los `R<n>` que cubre.
>
> Cobertura obligatoria: **R1–R68**, todos mapeados a un test concreto (§ Trazabilidad).
> Zona `fullstack` ⇒ el orden global es **backend (tandas A–F) → frontend (tanda G)**, y dentro de
> cada tanda también.
>
> **PUERTA ABIERTA.** La Tanda 0 es la puerta: **nada de las tandas A–H se escribe** hasta que el
> humano responda P1–P7. Cuatro respuestas cambian trabajo de verdad (P2, P3, P4, P5); tres son
> rótulos y presentación (P1, P6, P7).

## Cómo se entrega: 9 tandas

| Tanda | Qué entrega | Depende de |
| --- | --- | --- |
| **0** | **Puerta**: las 7 respuestas del humano | — |
| **A** | Base de datos + derivación pura: enum, `CHECK`, naturaleza, `derivarCaja` | 0 |
| **B** | **El COD entra**: feed nuevo + enganche en la aprobación del cierre | A |
| **C** | **El dinero sale y vuelve**: pago a tienda y su anulación (el puerto estrecho) | A, B |
| **D** | **Leer la caja**: repositorio, servicio y borde de las dos cifras | A |
| **E** | **Los datos ya escritos**: servicio + ejecutable de registro retroactivo | B, C |
| **F** | **Analítica**: catálogo, servicio y guardias | B, C, D |
| **G** | **Frontend**: la tarjeta de dos cifras, etiquetas y página | D, F |
| **H** | Guardias, censo, no-regresión y cierre por entorno | todas |

**Regla de cierre de tanda:** `./init.sh --rapido` verde. **Regla de cierre de feature y de cada
PR:** `./init.sh` completo, sin excepción.

**Criterio del orden y por qué es este:**
1. **La base primero** (A). El `CHECK` valida filas existentes al aplicarse y puede tumbar un
   despliegue: hay que descubrirlo antes de escribir una sola pantalla.
2. **El COD antes que el pago a tienda** (B antes que C). No es estético: emitir
   `egreso_pago_tienda` sin que el COD haya entrado es **exactamente** lo que la 172 se prohibió a sí
   misma («restaría de la caja un dinero que nunca entró»). Si las tandas se invirtieran, existiría
   una tanda entera en la que la caja estaría hundida.
3. **Leer (D) puede ir en paralelo a C**, porque solo depende de A.
4. **El registro retroactivo después de que existan los emisores** (E), para que use exactamente las
   mismas categorías, fechas y claves de origen que el camino vivo, no una copia.
5. **La analítica antes que el frontend** (F antes que G): si el catálogo va a partirse, mejor
   saberlo antes de pintar.
6. **El frontend al final** (G), cuando ya hay dos cifras reales que enseñar.

---

# TANDA 0 — Puerta de aprobación humana

Las siete preguntas viven en `requirements.md § Preguntas al humano`, con opciones, default y
consecuencias. Aquí queda qué desencadena cada respuesta.

### [ ] T0.1 — P1: los nombres en pantalla
- **Desencadena:** los textos de `T G.1` y `T G.3`. Nada más.
- **Hecho:** respuesta escrita en `requirements.md`; los rótulos exactos citados en `T G.1`.

### [ ] T0.2 — P2: ¿el pago al mensajero pasa a tesorería?
- **Si (a) —default—:** nada cambia; `T H.2` verifica que la suite del feed del mensajero sigue
  **sin editar**.
- **Si (b):** entra una **tanda nueva** (`C-bis`): tercer valor de enum, cambio de
  `WalletMensajeroFeedService` a `min(P,E)`, emisión en la liquidación al mensajero, asientos
  correctores en el backfill y reescritura de la otra mitad de R40 de la 172. **Roughly duplica la
  feature.**
- **Hecho:** respuesta escrita; si es (b), `C-bis` creada con sus `R` propios antes de tocar código.

### [ ] T0.3 — P3: ¿registro retroactivo?
- **Si (a) —default—:** la Tanda E se hace como está descrita.
- **Si (b):** la Tanda E desaparece y su contenido se mueve a la migración de `T A.1`, con un
  `down.sql` que **borraría filas de dinero** (contradice el modelo append-only: hay que decirlo en
  el `design.md` antes de escribirlo).
- **Si (c):** la Tanda E desaparece y `T G.1` gana la fecha de corte visible en pantalla.
- **Hecho:** respuesta escrita; tanda E confirmada, movida o eliminada.

### [ ] T0.4 — P4: ¿la analítica gana las dos cifras? ¿173 o 175?
- **Si (a) —default—:** Tanda F completa.
- **Si (b):** Tanda F se reduce al **guardia** de que las tres métricas de ingreso no se inflan, y se
  anota en `feature_list.json` que `egresos` cambió de número sin descripción nueva.
- **Si (c):** hay que decidir ids nuevos y avisar a las pantallas 132/134.
- **Hecho:** respuesta escrita; alcance de la Tanda F fijado y frontera con la 175 declarada.

### [ ] T0.5 — P5: ¿entra el `CHECK` categoría↔tipo?
- **Si (a) —default—:** `T A.0` y `T A.2` son obligatorias.
- **Si (b):** `T A.2` desaparece y se anota la deuda; la clasificación por naturaleza queda sin red
  de base de datos.
- **Hecho:** respuesta escrita.

### [ ] T0.6 — P6: ¿tercera línea de dinero de terceros?
- **Desencadena:** un bloque de `T G.1` y el campo `deTerceros` del DTO de `T D.2`.
- **Hecho:** respuesta escrita.

### [ ] T0.7 — P7: ¿el «dinero en caja» filtrado sigue llamándose así?
- **Desencadena:** el rótulo condicional de `T G.1` y el campo `periodoFiltrado` del DTO, o su
  eliminación.
- **Hecho:** respuesta escrita.

---

# TANDA A — Base de datos y derivación pura · *backend*

### [ ] T A.0 — Medir la base ANTES de escribir la migración `[P5]`
- **Qué:** por MCP de Supabase, contra **producción** y (si es alcanzable) **preview**: conteo de
  `wallet_movimiento` por `(tipo, categoria)` y búsqueda de filas incoherentes según la disyunción
  de `design.md §2.2`.
- **Por qué:** el `CHECK` valida las filas existentes al aplicarse, y **en Vercel mergear ES
  aplicar**. Es la misma task que la 172 corrió antes de su `CHECK`.
- **Archivos:** ninguno de código. La medición se escribe en `progress/impl_173-caja-tesoreria.md`.
- **Depende de:** T0.5 · **Cubre:** prepara R45, R46
- **Hecho:** cifras reales anotadas (no deducidas), y decisión escrita entre `CHECK` directo y
  `NOT VALID` + `VALIDATE` (`design.md §13.1`). Si preview no es alcanzable por MCP, queda
  **declarado** en el archivo, no asumido.

### [ ] T A.1 — Migración: dos valores de enum
- **Archivos:** `db/migrations/<ts>_caja_tesoreria/migration.sql`, `.../down.sql`,
  `db/schema.prisma`.
- **Qué:** `ALTER TYPE … ADD VALUE IF NOT EXISTS` para `ingreso_cod_recaudado` y
  `ingreso_reverso_pago_tienda`. `down.sql` espejo del de la 45/158: suelta los 2 índices que citan
  `categoria`, recrea el enum con los **15** valores previos, `USING cast`, recrea los índices. No
  toca RLS. **No reescribe ningún `down.sql` previo.**
- **Depende de:** T A.0 · **Cubre:** R49, R50
- **Hecho:** test estático verde; `pnpm db:migrate` y `pnpm db:rollback` hacen el round-trip local
  sin error.

### [ ] T A.2 — Migración: el `CHECK` categoría↔tipo de la caja `[P5]`
- **Archivos:** los de T A.1 (misma carpeta).
- **Qué:** la disyunción de listas cerradas de `design.md §2.2`, que **falla cerrado**.
- **Depende de:** T A.0, T A.1 · **Cubre:** R45, R46
- **Hecho:** test de integración contra Postgres que comprueba que un `INSERT` incoherente devuelve
  `23514` **y** contrapruebas de que las 17 combinaciones legítimas pasan. Borrar a mano una rama del
  `CHECK` hace fallar el test que la afirma.

### [ ] T A.3 [P] — Tipos, SEED y contrato de escritura
- **Archivos:** `lib/types/wallet.ts` (SEED + `CajaResumenDTO` + `AgregadoCajaRow`),
  `lib/interfaces/repositories/IWalletMovimientoRepository.ts` (`fechaMovimiento?` opcional).
- **Depende de:** T A.1 · **Cubre:** prepara R7, R20, R25
- **Hecho:** typecheck verde (el `_EnsureCategoriaExhaustive` obliga a los dos valores nuevos);
  ningún escritor existente cambia de comportamiento por el campo opcional.

### [ ] T A.4 — `NATURALEZA_POR_CATEGORIA` + `derivarCaja` (pura)
- **Archivos:** `lib/utils/caja-tesoreria.ts` (NUEVO),
  `tests/unit/utils/caja-tesoreria.test.ts` (NUEVO).
- **Qué:** el `Record` **total** y la derivación de las dos cifras. `Prisma.Decimal` dentro, STRING
  fuera, cero `number`.
- **Depende de:** T A.3 · **Cubre:** R1, R2, R3, R4, R5, R6, R7, R10
- **Hecho:** el test **recorre `WALLET_MOVIMIENTO_CATEGORIA_SEED` en runtime** y afirma que cada
  categoría tiene naturaleza (no basta el typecheck); un conjunto sin movimientos de terceros
  devuelve las dos cifras iguales; **mutación obligatoria**: mover `ingreso_cod_recaudado` a
  «propio» pone rojo al menos un test.

### [ ] T A.5 [P] — Guardia: `derivarBalance` intacto
- **Archivos:** `tests/unit/utils/wallet-balance.test.ts` (**sin editar**),
  `tests/unit/guards/caja-derivaciones.guardia.test.ts` (NUEVO).
- **Qué:** afirmar que `derivarBalance` conserva firma y salida, y que `derivarCaja` **no** lo
  reimplementa por dentro (reusa o coexiste, pero no duplica la resta con signo).
- **Depende de:** T A.4 · **Cubre:** R9
- **Hecho:** la suite de `wallet-balance` no aparece en el diff.

---

# TANDA B — El COD entra en la caja · *backend*

### [ ] T B.1 — `CajaCodFeedService`
- **Archivos:** `lib/interfaces/services/ICajaCodFeedService.ts`,
  `lib/services/CajaCodFeedService.ts`, `tests/unit/services/caja-cod-feed-service.test.ts` (NUEVOS).
- **Qué:** lee de `wallet_tienda_movimiento` los créditos `cod_recaudado` de **ese** cierre, suma,
  devuelve 0 o 1 fila. No persiste. No recalcula desde `gestion_orden`.
- **Depende de:** T A.4 · **Cubre:** R11, R12, R13, R17
- **Hecho:** con dos tiendas en el cierre, el monto es la suma exacta de sus dos créditos; un cierre
  sin COD devuelve `[]` (**ni una fila en 0.00**); no se pasa `fechaMovimiento`; **contraprueba**: si
  el feed leyera `gestion_orden.montoRecibido` en vez del ledger, un test con ledger y gestiones
  discrepantes lo detecta.

### [ ] T B.2 — Enganche en la aprobación del cierre
- **Archivos:** `lib/repositories/CierresAdminRepository.ts`,
  `tests/unit/repositories/cierres-admin-caja-cod.test.ts` (NUEVO).
- **Qué:** llamada al feed **después** del feed del ledger por tienda, inserción con el repositorio
  de la 42 **ya inyectado**, dentro de la misma `tx`. Cero dependencias nuevas en el constructor.
- **Depende de:** T B.1 · **Cubre:** R15
- **Hecho:** si la inserción falla, la aprobación entera revierte (nada de cierre aprobado sin su
  COD); el orden respecto al feed de tienda está afirmado por un test, no por un comentario.

### [ ] T B.3 [P] — El cierre de **bodega** sigue sin tocar la caja
- **Archivos:** `tests/unit/services/cierres-bodega-admin-service.test.ts` (+1 afirmación).
- **Depende de:** T B.2 · **Cubre:** R16
- **Hecho:** cuarta afirmación en la línea de las tres que ya existen (42/43/44), ahora para el COD.

### [ ] T B.4 — Idempotencia de la aprobación
- **Archivos:** `tests/integration/db/caja-tesoreria-idempotencia.test.ts` (NUEVO).
- **Depende de:** T B.2 · **Cubre:** R14, R48 (parte cierre)
- **Hecho:** aprobar dos veces el mismo cierre inserta **una** fila de COD; el segundo intento es
  no-op **a nivel de base** (`skipDuplicates`), no un `if` del servicio.

---

# TANDA C — El dinero sale y vuelve · *backend*

### [ ] T C.1 — El puerto estrecho de la caja para la liquidación
- **Archivos:** `lib/interfaces/services/ICajaPagoTiendaFeedService.ts`,
  `lib/services/CajaPagoTiendaFeedService.ts`,
  `tests/unit/services/liquidacion-caja-puerto.test.ts` (NUEVOS).
- **Qué:** dos métodos y ninguno más (`design.md §4`). La categoría y el tipo los fija el puerto, no
  quien lo llama.
- **Depende de:** T A.4 · **Cubre:** R23
- **Hecho:** test **estructural**: `LiquidacionService` **no** recibe `IWalletMovimientoRepository`, y
  el puerto no expone ningún método capaz de escribir `egreso_pago_mensajero`.

### [ ] T C.2 — El egreso del pago a tienda
- **Archivos:** `lib/services/LiquidacionService.ts`, `lib/actions/liquidacion.ts`,
  `tests/unit/services/liquidacion-service.test.ts` (aserciones de R40 **reescritas**).
- **Qué:** tercera escritura dentro de la misma `runTransaction`, con el **mismo** `montoStr` y la
  **fecha real** del pago.
- **Depende de:** T B.2, T C.1 · **Cubre:** R18, R19, R20, R22
- **Hecho:** ⚠️ **cambio deliberado de tests verdes**: las aserciones «cero llamadas a la caja» de la
  rama **tienda** pasan a «exactamente una, con esta categoría, monto, origen y fecha»; las de la
  rama **mensajero** siguen en cero y **no se tocan**. La task lo declara en el commit para que el
  review no lo lea como regresión encubierta.

### [ ] T C.3 — El reverso de la anulación
- **Archivos:** `lib/services/LiquidacionService.ts` (`escribirContraasiento`, rama tienda),
  `tests/unit/services/liquidacion-anulacion.test.ts` (aserciones de R40 **reescritas**).
- **Depende de:** T C.2 · **Cubre:** R24, R25, R26, R27, R29
- **Hecho:** el reverso usa `ingreso_reverso_pago_tienda` y **no** `ingreso_ajuste`; **mutación
  obligatoria**: cambiarlo a `ingreso_ajuste` pone rojo un test que mide la **ganancia**, no solo la
  categoría. Rama mensajero: cero llamadas.

### [ ] T C.4 — La cadena completa y la idempotencia del pago
- **Archivos:** `tests/unit/services/caja-cadena-pago-anulacion.test.ts` (NUEVO),
  `tests/integration/db/caja-tesoreria-idempotencia.test.ts` (+casos).
- **Depende de:** T C.3 · **Cubre:** R21, R28, R30, R48 (parte pago/anulación)
- **Hecho:** pagar → anular deja el **dinero en caja** en el importe exacto previo al pago y la
  **ganancia** idéntica en los tres momentos; misma clave de idempotencia dos veces ⇒ un solo egreso;
  anular dos veces ⇒ un solo reverso.

### [ ] T C.5 [P] — Guardia: los otros dos libros no ganan filas
- **Archivos:** `tests/unit/guards/caja-173-alcance.guardia.test.ts` (NUEVO).
- **Depende de:** T C.3 · **Cubre:** R31, R33
- **Hecho:** ninguna escritura nueva en `wallet_tienda_movimiento` ni en `pago_mensajero_movimiento`;
  el repositorio que sirve las dos cifras tiene un cliente Prisma **mínimo** (`walletMovimiento` y
  nada más), así que no **puede** leer los otros libros.

---

# TANDA D — Leer la caja · *backend* · (paralelizable con C)

### [ ] T D.1 — Repositorio: agregación por categoría y tipo
- **Archivos:** `lib/interfaces/repositories/IWalletMovimientoRepository.ts`,
  `lib/repositories/WalletMovimientoRepository.ts`,
  `tests/unit/repositories/wallet-movimiento-repository.test.ts`.
- **Qué:** `agregarPorCategoriaYTipo(filtros)` con los **mismos** filtros del listado. Se elimina
  `agregarBalance` cuando quede sin consumidores.
- **Depende de:** T A.4 · **Cubre:** R8 (parte datos), R47
- **Hecho:** cero referencias a `agregarBalance` en el árbol; el repositorio sigue sin exponer
  `update` ni `delete`.

### [ ] T D.2 — Servicio y borde: `verResumenCaja`
- **Archivos:** `lib/interfaces/services/IWalletService.ts`, `lib/services/WalletService.ts`,
  `lib/actions/wallet.ts`, `lib/types/wallet.ts` (DTO),
  `tests/unit/services/wallet-service.test.ts`, `tests/unit/actions/wallet-actions.test.ts`.
- **Depende de:** T D.1 · **Cubre:** R8, R64, R65
- **Hecho:** el guardia de rol se evalúa **antes** de tocar la base (contraprueba con un rol sin
  acceso: cero llamadas al repositorio); los montos cruzan como STRING; los filtros del resumen son
  los mismos que los del listado, resueltos por el mismo método.

---

# TANDA E — Los datos ya escritos `[P3]` · *backend*

### [ ] T E.1 — Servicio de registro retroactivo
- **Archivos:** `lib/interfaces/services/ICajaBackfillTesoreriaService.ts`,
  `lib/services/CajaBackfillTesoreriaService.ts`,
  `tests/unit/services/caja-backfill-tesoreria.test.ts` (NUEVOS).
- **Qué:** los tres orígenes de `design.md §6.1` con las fechas de §6.2. Solo inserta.
- **Depende de:** T B.2, T C.3 · **Cubre:** R36, R37, R38, R41, R42
- **Hecho:** las fechas salen del **origen** y nunca de `now()` (test con un reloj fijo distinto de
  las fechas de los datos); ninguna fila existente se toca (`update`/`delete` con cero llamadas).

### [ ] T E.2 — Ejecutable con tres modos
- **Archivos:** `scripts/backfill-caja-tesoreria.ts` (NUEVO).
- **Qué:** `--simular` (por defecto), `--aplicar`, `--comprobar`.
- **Depende de:** T E.1 · **Cubre:** R40, R43, R44
- **Hecho:** sin flag **no escribe nada**; `--comprobar` **nombra** los cierres, pagos y anulaciones
  sin movimiento de caja y no dice «al día» mientras quede uno.

### [ ] T E.3 — Idempotencia real contra Postgres
- **Archivos:** `tests/integration/db/caja-backfill.test.ts` (NUEVO).
- **Depende de:** T E.2 · **Cubre:** R39
- **Hecho:** dos ejecuciones seguidas ⇒ la segunda inserta **0** filas y ningún importe cambia;
  ejecutar el backfill sobre datos que ya pasaron por el camino vivo tampoco duplica.

---

# TANDA F — Analítica `[P4]` · *backend*

### [ ] T F.1 [P] — Guardia: las métricas de ingreso no se inflan
- **Archivos:** `tests/unit/analytics/metrics-caja-naturaleza.guardia.test.ts` (NUEVO).
- **Depende de:** T A.4 · **Cubre:** R51, R52
- **Hecho:** ninguna de las tres métricas de ingreso declara una categoría de naturaleza
  «terceros»; `cod_recaudado` sigue con sus dos vistas y **no** gana la caja como tercera fuente. El
  guardia se lee del `Record` de naturaleza, no de una lista copiada a mano.

### [ ] T F.2 — Catálogo: descripción de `egresos` + dos métricas nuevas
- **Archivos:** `lib/analytics/metrics.ts`, `lib/types/analitica-financiera.ts`.
- **Depende de:** T F.1 · **Cubre:** R53, R54 (parte catálogo)
- **Hecho:** `egresos` dice que incluye el dinero entregado a las tiendas; `dinero_en_caja` y
  `ganancia_ordenex` existen con `fuente: ledger / wallet_movimiento` y el alcance de las
  financieras; `IDS_FINANCIERAS_SERVIDAS` pasa a 10.

### [ ] T F.3 — Servicio: las dos métricas nuevas reusan `derivarCaja`
- **Archivos:** `lib/services/AnaliticaFinancieraService.ts`,
  `tests/unit/services/analitica-financiera-service.test.ts`.
- **Depende de:** T F.2 · **Cubre:** R54, R55
- **Hecho:** el manejador **no** reimplementa ninguna resta de dinero; el guardia de coherencia
  catálogo↔servicio sigue fallando por exceso **y** por defecto.

### [ ] T F.4 [P] — La conciliación no se mueve
- **Archivos:** `tests/unit/services/analitica-financiera-conciliacion.test.ts` (+casos),
  `tests/unit/repositories/ingresos-analitica-repository.test.ts`.
- **Depende de:** T F.2 · **Cubre:** R56, R57
- **Hecho:** con filas de COD en la caja con origen `cierre_dia`, el cuadre da **exactamente** lo
  mismo que sin ellas; el repositorio sigue rechazando ruidosamente una métrica que declare una
  categoría ajena.

---

# TANDA G — Frontend

### [ ] T G.1 — La tarjeta de las dos cifras
- **Archivos:** `app/(app)/wallet/_components/CajaResumenCard.tsx` (renombra
  `WalletBalanceCard.tsx`), `tests/components/CajaResumenCard.test.tsx` (NUEVO).
- **Qué:** los dos bloques con sus nombres `[P1]`, la nota de diferencia, la tercera línea con su
  advertencia `[P6]` y el rótulo condicional `[P7]`.
- **Depende de:** T D.2, T F.3 · **Cubre:** R1 (parte UI), R34, R58, R59, R60
- **Hecho:** las dos cifras se ven **a la vez**; la palabra «balance» no aparece; la tercera línea
  lleva su advertencia de que **no** es la deuda con las tiendas y el enlace a `/wallet/tiendas`.

### [ ] T G.2 [P] — Etiquetas de las categorías nuevas
- **Archivos:** `app/(app)/wallet/_components/wallet-labels.ts`.
- **Depende de:** T A.3 · **Cubre:** R61
- **Hecho:** el build no compilaba sin las dos claves (el `Record` es completo); el filtro y la
  descarga las recogen **solas** desde el SEED — se **verifica**, no se implementa.

### [ ] T G.3 — Página y módulo
- **Archivos:** `app/(app)/wallet/page.tsx`, `app/(app)/wallet/_components/WalletModule.tsx`,
  `tests/integration/wallet-page.test.tsx`, `tests/components/descarga/WalletDescarga.test.tsx`.
- **Depende de:** T G.1, T G.2 · **Cubre:** R59 (descripción), R62, R64, R65
- **Hecho:** la descripción de la página ya no dice «balance general»; el listado y la descarga
  incluyen los movimientos nuevos sin cambiar columnas; un rol sin acceso total sigue viendo
  `notFound`.

### [ ] T G.4 [P] — Las pantallas de tienda y mensajero NO cambian
- **Archivos:** ninguno. Suites de la 171/172 **sin editar**.
- **Depende de:** T G.3 · **Cubre:** R32, R35, R63
- **Hecho:** `wallet-tiendas-*`, `mi-wallet-*`, `mis-pagos-*` y las suites de liquidación no aparecen
  en el diff (salvo las dos aserciones de R40 declaradas en T C.2/T C.3).

---

# TANDA H — Guardias, censo y cierre

### [ ] T H.1 [P] — Censo de tablas y descarga
- **Archivos:** `tests/unit/descarga/censo-tablas.ts` si procede.
- **Qué:** esta feature **no** añade ninguna instancia de `<DataTable>`; se confirma que el censo no
  cambia. Los totales duros **se leen en el momento**, no se copian de este documento.
- **Depende de:** T G.3 · **Cubre:** —
- **Hecho:** el guardia de cobertura de tablas sigue verde sin tocar el censo.

### [ ] T H.2 — Revisión de alcance
- **Archivos:** `tests/unit/guards/caja-173-alcance.guardia.test.ts` (+casos).
- **Depende de:** T G.4 · **Cubre:** R66, R67, R68
- **Hecho:** el diff no contiene ninguna tabla, estado ni pantalla de arqueo/corte de caja; la suite
  de `WalletMensajeroFeedService` sigue **sin editar** `[P2]`; las fórmulas de flete, comisión, IVA y
  pago al mensajero no aparecen en el diff.

### [ ] T H.3 — Pruebas por mutación de lo money-critical
- **Archivos:** anotación en `progress/impl_173-caja-tesoreria.md`.
- **Qué:** las tres mutaciones obligatorias, cada una debe poner rojo al menos un test:
  1. mover `ingreso_cod_recaudado` a naturaleza «propio»;
  2. cambiar el reverso de la anulación a `ingreso_ajuste`;
  3. fechar un movimiento retroactivo con `now()` en vez de con su origen.
- **Depende de:** T E.3, T C.4 · **Cubre:** refuerza R2, R26, R41
- **Hecho:** las tres medidas y anotadas con el test que se puso rojo en cada caso.

### [ ] T H.4 — Ejecución y comprobación por entorno `[P3]`
- **Qué:** `--simular` → revisión humana del informe → `--aplicar` → `--comprobar` en **cada**
  entorno, y lectura por MCP de las filas nuevas en producción.
- **Depende de:** T E.3, T H.2 · **Cubre:** cierre de R36–R44
- **Hecho:** `--comprobar` dice «al día» en producción, con las cifras leídas de la base y anotadas
  en `progress/`, **no deducidas del PR**. Si preview no es alcanzable, queda declarado como
  bloqueante del merge, igual que en la 172.

### [ ] T H.5 — Gate completo
- **Qué:** `./init.sh` completo, con baseline de archivos/tests medido **al inicio** de la feature.
- **Depende de:** todas · **Cubre:** —
- **Hecho:** verde, sin regresiones respecto al baseline, y el delta de tests explicado.

---

## Trazabilidad — `R<n>` → test

| R | Test |
| --- | --- |
| R1 | `tests/unit/utils/caja-tesoreria.test.ts` (dos cifras distintas) + `tests/components/CajaResumenCard.test.tsx` |
| R2 | `caja-tesoreria.test.ts` — recorre el SEED en runtime: cada categoría tiene naturaleza |
| R3 | `caja-tesoreria.test.ts` (el `Record` es total) + typecheck: quitar una clave no compila |
| R4 | `caja-tesoreria.test.ts` — `enCaja` = entradas − salidas |
| R5 | idem — `ganancia` = ingresos propios − egresos propios |
| R6 | idem — conjunto sin terceros ⇒ las dos cifras iguales |
| R7 | idem — STRING escala 2, signo explícito, cero `number` |
| R8 | `tests/unit/services/wallet-service.test.ts` — resumen y listado resuelven los mismos filtros |
| R9 | `tests/unit/utils/wallet-balance.test.ts` **sin editar** + `caja-derivaciones.guardia.test.ts` |
| R10 | `caja-tesoreria.test.ts` — la firma no admite repositorio ni cliente |
| R11 | `tests/unit/services/caja-cod-feed-service.test.ts` |
| R12 | idem — monto = Σ créditos `cod_recaudado` del cierre (contraprueba con gestiones discrepantes) |
| R13 | idem — cierre sin COD ⇒ `[]`, ni una fila en 0.00 |
| R14 | `tests/integration/db/caja-tesoreria-idempotencia.test.ts` — aprobar dos veces, una fila |
| R15 | `tests/unit/repositories/cierres-admin-caja-cod.test.ts` — misma `tx`, todo o nada |
| R16 | `tests/unit/services/cierres-bodega-admin-service.test.ts` (+1 afirmación) |
| R17 | `caja-cod-feed-service.test.ts` — no pasa `fechaMovimiento` |
| R18 | `tests/unit/services/liquidacion-service.test.ts` — una llamada, `egreso_pago_tienda` |
| R19 | idem — si la caja falla, no queda el pago |
| R20 | idem — `fechaMovimiento` = fecha real del pago |
| R21 | `caja-tesoreria-idempotencia.test.ts` — misma clave dos veces, un egreso |
| R22 | `liquidacion-service.test.ts` — rama mensajero: cero llamadas al puerto |
| R23 | `tests/unit/services/liquidacion-caja-puerto.test.ts` — estructural |
| R24 | `tests/unit/services/liquidacion-anulacion.test.ts` |
| R25 | idem — fecha = día de la anulación |
| R26 | idem + `caja-cadena-pago-anulacion.test.ts` — la ganancia no se mueve (mutación) |
| R27 | `liquidacion-anulacion.test.ts` — rama mensajero: cero llamadas |
| R28 | `caja-tesoreria-idempotencia.test.ts` — anular dos veces, un reverso |
| R29 | `liquidacion-anulacion.test.ts` — solo `createMany`; ningún `update`/`delete` |
| R30 | `tests/unit/services/caja-cadena-pago-anulacion.test.ts` |
| R31 | `tests/unit/guards/caja-173-alcance.guardia.test.ts` |
| R32 | suites de la 171/172 **sin editar** (`wallet-tiendas-*`, `liquidacion-*`) |
| R33 | `tests/unit/repositories/wallet-movimiento-repository.test.ts` — cliente Prisma mínimo |
| R34 | `tests/components/CajaResumenCard.test.tsx` — la advertencia y el enlace están |
| R35 | suite de la 171 sin editar |
| R36 | `tests/unit/services/caja-backfill-tesoreria.test.ts` — cierres aprobados |
| R37 | idem — pagos a tienda |
| R38 | idem — anulaciones |
| R39 | `tests/integration/db/caja-backfill.test.ts` — segunda ejecución inserta 0 |
| R40 | `caja-backfill-tesoreria.test.ts` — `--simular` no escribe y reporta conteos y montos |
| R41 | idem — reloj fijo distinto de los datos; las fechas salen del origen |
| R42 | idem — cero `update`/`delete` |
| R43 | idem — `--comprobar` nombra los que faltan |
| R44 | idem — con uno pendiente, no dice «al día» |
| R45 | `tests/integration/db/caja-tesoreria-migration.test.ts` — `INSERT` incoherente ⇒ `23514` |
| R46 | idem — una categoría no clasificada no casa ninguna rama |
| R47 | `wallet-movimiento-repository.test.ts` — sin `update`/`delete` |
| R48 | `caja-tesoreria-idempotencia.test.ts` — la barrera es el índice, no un `if` |
| R49 | `caja-tesoreria-migration.test.ts` — el `down` recrea el enum con 15 valores y los 2 índices |
| R50 | idem — ningún `down.sql` previo en el diff |
| R51 | `tests/unit/analytics/metrics-caja-naturaleza.guardia.test.ts` |
| R52 | idem — `cod_recaudado` sigue con dos vistas |
| R53 | `tests/unit/analytics/metrics-descripciones.test.ts` |
| R54 | `tests/unit/services/analitica-financiera-service.test.ts` — las dos métricas nuevas |
| R55 | guardia de coherencia catálogo↔servicio (existente), ampliado a 10 ids |
| R56 | `tests/unit/services/analitica-financiera-conciliacion.test.ts` — con COD en caja, mismo cuadre |
| R57 | `tests/unit/repositories/ingresos-analitica-repository.test.ts` |
| R58 | `tests/components/CajaResumenCard.test.tsx` — las dos, a la vez |
| R59 | idem + `tests/integration/wallet-page.test.tsx` — «balance» no aparece |
| R60 | `CajaResumenCard.test.tsx` — la nota de diferencia está y no usa siglas |
| R61 | `CajaResumenCard.test.tsx` + `tests/components/descarga/WalletDescarga.test.tsx` |
| R62 | `WalletDescarga.test.tsx` — mismas columnas, movimientos nuevos incluidos |
| R63 | suites de `/wallet/tiendas`, `/mi-wallet` y `/mis-pagos` sin editar |
| R64 | `tests/unit/actions/wallet-actions.test.ts` — el DTO cruza como STRING |
| R65 | `tests/integration/wallet-page.test.tsx` + `wallet-service.test.ts` — rol sin acceso ⇒ nada |
| R66 | `tests/unit/services/wallet-mensajero-feed-service.test.ts` **sin editar** |
| R67 | `caja-173-alcance.guardia.test.ts` — sin tablas/estados/pantallas de arqueo en el diff |
| R68 | suites de 42/43/44 sin editar |
