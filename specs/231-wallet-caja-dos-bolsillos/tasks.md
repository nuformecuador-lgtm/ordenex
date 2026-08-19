# Feature 231 — Wallet · la caja partida en dos bolsillos · tasks.md

> Checklist de pasos discretos y verificables. `[P]` = paralelizable con las tareas **de su mismo
> bloque**. Cada task lleva su criterio de «hecho».
>
> **Feature `fullstack`: se secuencia backend → frontend.** Bloques 1-3 los ejecuta `backend_dev`;
> bloques 4-6, `frontend_dev`. Ninguno de los dos corre la suite entera: solo
> `pnpm typecheck`, `pnpm lint` y `pnpm exec vitest related --run <sus archivos>`.
> El gate lo corre el leader: `./init.sh --rapido` al cerrar cada tanda y **`./init.sh` completo
> antes del PR, sin excepción** (`docs/verification.md`).
>
> **Dos bloques nacen BLOQUEADOS por una firma humana:** el 5 por **D1** y el 3+6 por **D2**
> (`requirements.md` §Preguntas abiertas). No se empiezan sin ella.

---

## Bloque 0 — Puerta humana (bloquea 3, 5 y 6)

- [x] **T0.1 — Firmar D1** (cambiar la aserción de `WalletDescarga.test.tsx:590-597`).
  **Hecho:** la respuesta queda escrita en `progress/current.md` y en el `status_note` de la ficha
  231. *Bloquea el Bloque 5 entero.*
- [x] **T0.2 [P] — Firmar D2** (fila «Otros gastos de Ordenex», absorción de `DesgloseEgresosCard` y
  copy heredado de la 158).
  **Hecho:** ídem. *Bloquea T3.2, el Bloque 6 y la re-hospedación de las aserciones de la 45/158.*
- [x] **T0.3 [P] — Firmar D3, D4 y D5** (forma STRING de los campos nuevos, caso espejo
  `deTerceros < 0`, séptimo concepto de ingreso).
  **Hecho:** ídem. *No bloquean: sin firma se implementa la propuesta del spec y queda anotada como
  tal en `progress/impl_231.md`.*

---

## Bloque 1 — Tipos y derivación pura (backend)

- [x] **T1.1 — Ampliar `lib/types/wallet.ts`.** `CajaResumenDTO` += `porcentajeTiendas: string` y
  `modoComposicion` (union de 4 cadenas, exportada como tipo propio). `WalletMovimientoDTO` +=
  `dueno: NaturalezaMovimiento`. Nuevos: `WALLET_INGRESO_PROPIO_SEED`, `WalletIngresoPropio`,
  `ComposicionGananciaDTO` (design §2).
  **Hecho:** `pnpm typecheck` verde; el SEED nuevo lleva `satisfies readonly
  WalletMovimientoCategoria[]`; ningún `any`; ningún import de `app/` ni de repositorios.
- [x] **T1.2 — `derivarCaja` gana el modo y el porcentaje** (`lib/utils/caja-tesoreria.ts`, design
  §3.1). Tabla de 4 filas evaluada en orden; comparaciones con `Prisma.Decimal` (`.lt(0)`, `.gt(0)`,
  `.isZero()`), **nunca** leyendo `signo`. Firma y resto de la salida intactas.
  **Hecho:** el archivo sigue conteniendo **exactamente 3** `derivarBalance(`, ningún literal
  `"positivo"`/`"negativo"`/`"cero"`, ningún `.sub(` ni `.minus(`; y
  `tests/unit/guards/caja-derivaciones.guardia.test.ts` pasa **sin haber sido editado**.
- [x] **T1.3 — `derivarComposicionGanancia(filas)`**, función pura en el mismo módulo (design §2.2).
  Suma por categoría de ingreso propio, total, `otrosEgresos` (suma de `egreso_pago_mensajero`,
  `egreso_gasto`, `egreso_ajuste`) y `totalEgresos`. Claves **por categoría**, nunca camelCase de
  fórmula.
  **Hecho:** typecheck verde; `caja-173-alcance.guardia.test.ts` pasa **sin editarse** (el módulo no
  nombra `comisionCod`, `ivaFlete`, `valorFlete`, `PrismaClient`, `groupBy` ni `await`).
- [x] **T1.4 — Tests de la derivación**: `tests/unit/utils/caja-composicion.test.ts` (NUEVO).
  Cubre **R10, R14-R19, R23, R26**. Un conjunto por modo, con importes distintos entre sí; el
  `dos_bolsillos` con un porcentaje verificable a mano (p. ej. 10 000 / 12 000 → `"83.33"`).
  **Hecho:** los cuatro modos medidos; `totalIngresos === ingresosPropios` y
  `totalEgresos === egresosPropios` comprobados con `Prisma.Decimal` sobre **varios** conjuntos;
  ningún caso pasa por conjunto vacío.
- [x] **T1.5 [P] — Guardia de exhaustividad**:
  `tests/unit/guards/caja-composicion-exhaustiva.guardia.test.ts` (NUEVO). Recorre
  `WALLET_MOVIMIENTO_CATEGORIA_SEED` en RUNTIME y afirma que la partición cubre **todas** las
  categorías propias: ingresos ⇒ una fila del desglose; egresos ⇒ uno de los 4 conceptos o
  `otrosEgresos`. Con control de no-vacuidad.
  **Hecho:** una categoría añadida al SEED en el test pone la guardia roja. Cubre **R23, R26, R32**.
- [x] **T1.6 — Actualizar `tests/unit/utils/caja-tesoreria.test.ts:194`** (caso vacío: `toEqual` con
  las dos claves nuevas).
  **Hecho:** el caso vacío devuelve `modoComposicion: "sin_reparto"` y `porcentajeTiendas: "0.00"`;
  **ninguna otra aserción del archivo se toca**.

Dependencias: T1.2, T1.3 ← T1.1; T1.4 ← T1.2, T1.3; T1.6 ← T1.2.

---

## Bloque 2 — Servicio, repositorio y borde (backend; depende del Bloque 1)

- [x] **T2.1 — `WalletMovimientoRepository.toDTO` asigna `dueno`** desde
  `NATURALEZA_POR_CATEGORIA` (design §3.3). Una sola línea, un solo sitio.
  **Hecho:** `agregarPorCategoriaYTipo` y el resto del repo **sin tocar**; el archivo sigue sin
  nombrar `walletTiendaMovimiento`, `pagoMensajeroMovimiento`, `gestionOrden` ni `cierreDia`
  (`caja-173-alcance.guardia` verde sin editarse).
- [x] **T2.2 — `verResumenCaja` devuelve `{ resumen, composicion }`** con **una sola** llamada a
  `agregarPorCategoriaYTipo` (design §3.2), y `IWalletService`/`VerResumenCajaServiceResult` se
  actualizan. `forbidden` sigue viajando sin datos.
  **Hecho:** typecheck verde; el guard de rol sigue **antes** de tocar la base; `construirFiltros`
  sigue siendo el método compartido con el listado y la descarga.
- [x] **T2.3 [P] — `lib/actions/wallet.ts`**: el tipo de retorno de `verResumenCajaAction` acompaña
  al del servicio. **Sin schema nuevo, sin acción nueva.**
  **Hecho:** el diff de este archivo es solo de tipos; ninguna operación aritmética entra en el borde.
- [x] **T2.4 — Tests de servicio y repositorio**:
  `tests/unit/services/wallet-service.test.ts` (ampliado) y
  `tests/unit/repositories/wallet-movimiento-repository.test.ts` (ampliado).
  **Hecho:** cubre **R24** (el doble se llama **una vez** y las dos derivaciones salen del mismo
  array), **R30** (`forbidden` sin `composicion`), **R31/R32** (cada categoría del SEED produce el
  `dueno` que dice el `Record`, comprobado en runtime sobre el SEED entero).

Dependencias: T2.2 ← T1.2, T1.3; T2.3 ← T2.2; T2.4 ← T2.1, T2.2.

---

## Bloque 3 — La otra mitad del servidor: `otrosEgresos` (backend; **bloqueado por D2**)

- [x] **T3.1 — Confirmar contra el código** que las categorías de egreso propio no cubiertas por
  `DesgloseEgresosDTO` son exactamente `egreso_pago_mensajero`, `egreso_gasto` y `egreso_ajuste`.
  **Hecho:** la lista sale de recorrer `NATURALEZA_POR_CATEGORIA` en el test de T1.5, no de una copia
  a mano en un comentario.
- [x] **T3.2 — Cablear `otrosEgresos`/`totalEgresos`** en el DTO y en la derivación (ya escritos en
  T1.3) y documentar en `progress/impl_231.md` que **el pago a mensajeros entra** en la columna de
  egresos de la tarjeta nueva (consecuencia firmada en D2).
  **Hecho:** `DesgloseEgresosDTO` **no cambia de forma**; `verDesgloseEgresosAction` no se toca.

Dependencias: bloque entero ← T0.2.

---

## Bloque 4 — La caja en pantalla (frontend; depende del Bloque 2)

- [x] **T4.1 — Rótulos nuevos en `wallet-labels.ts`**: bolsillo de tiendas / de Ordenex, textos de la
  barra, mensaje del caso límite (`solo_tiendas`), del `sin_reparto` y del espejo (`solo_ordenex`),
  `DUENO_LABEL` (`propio` → «Ordenex», `terceros` → «Tienda») y el compositor del nombre accesible de
  la barra.
  **Hecho:** ningún texto vive dentro de un componente; los `Record` son **totales** (un modo o una
  naturaleza nuevos rompen el build); el vocabulario evita la jerga que la 173 prohíbe (nada de
  «balance», «tesorería», «devengo», ni nombres de enum).
- [x] **T4.2 — `BarraComposicionCaja.tsx` (NUEVO)**: cuatro modos, segmento de tiendas por
  `style={{ width: ... }}`, segmento de Ordenex `flex-1`, `role="img"` + `aria-label` compuesto,
  colores por token (design §4.2).
  **Hecho:** sin estado, sin efectos, sin controles; el barrido money-safe de su fuente pasa.
  Cubre **R2, R11, R13, R16, R18, R20**.
- [x] **T4.3 — Rediseñar `CajaResumenCard.tsx`** al árbol de design §4.1: regiones disjuntas, padres
  acotados, «Entró/Salió/Movimientos» como datos secundarios, los dos bolsillos hermanos, la banda de
  aviso de las tiendas con su enlace, y la nota de la diferencia + el aviso de periodo donde están.
  **Hecho:** `tests/components/CajaResumenCard.test.tsx` pasa **con el único cambio de su fixture**
  (los dos campos nuevos); cero `useState`/`useEffect`/`useSearchParams`; cero `role="button"`;
  la fuente sigue sin contener `filtros`, `document` ni `window.location`.
  Cubre **R1, R3, R4, R5, R6, R7, R8, R21**.
- [x] **T4.4 [P] — Test de la barra y de los modos**:
  `tests/components/CajaComposicionBarra.test.tsx` (NUEVO).
  **Hecho:** un caso por modo; en `solo_tiendas` hay **un** segmento y el bloque de Ordenex trae el
  mensaje del dinero de las tiendas; en `sin_reparto` no se enuncia ningún porcentaje; el ancho
  pintado es el STRING del DTO; barrido money-safe sobre las **dos** fuentes nuevas.
  Cubre **R12, R14, R15, R17, R19, R20, R39**.
- [x] **T4.5 — Actualizar el fixture de `tests/integration/wallet-page.test.tsx`** (`RESUMEN_OK`,
  `MOVIMIENTOS_OK`) y **no tocar ninguna aserción**; añadir un caso que compruebe que `composicion`
  cruza por props con todos sus importes STRING.
  **Hecho:** el barrido `Object.entries(props.resumen)` de las líneas 266-272 sigue **literalmente
  igual** y en verde. Cubre **R9, R12**.

Dependencias: T4.2 ← T4.1; T4.3 ← T4.2; T4.4 ← T4.2; T4.5 ← T2.2.

---

## Bloque 5 — El libro y la columna «Dueño» (frontend; **bloqueado por D1**)

- [x] **T5.1 — Aplicar la firma de D1** en `tests/components/descarga/WalletDescarga.test.tsx`
  (líneas 590-597): la aserción pasa a afirmar lo que su propio caso dice —que las categorías de la
  173 no añaden ni quitan columnas—, comparada contra la lista declarada por el componente.
  **Hecho:** el caso de la 173 sigue existiendo, con su nombre y su intención; el cambio queda
  anotado en `progress/impl_231.md` citando D1.
- [x] **T5.2 — Columna «Dueño» en `WalletLedger.tsx`**: última de los datos, antes de «Acciones»;
  punto de color + texto (design §4.4). Actualizar de paso el comentario de las líneas 150-171, que
  cita `WalletDescarga.test.tsx:566` cuando la aserción vive en la **590**.
  **Hecho:** el orden de las columnas anteriores no cambia; no se monta ningún `DataTable` nuevo
  (`censo-tablas.ts` intacto). Cubre **R33, R35**.
- [x] **T5.3 [P] — Columna «Dueño» en la descarga**: `COLUMNAS_DESCARGA_WALLET_CAJA` y
  `filaDescargaMovimientoCaja`, en el **mismo commit**.
  **Hecho:** los dos casos que comparan `Object.keys(fila)` contra la lista de columnas
  (`WalletDescarga.test.tsx:572-574` y `:621-623`) siguen verdes sin tocarse. Cubre **R34**.
- [x] **T5.4 — Test de la columna**: `tests/unit/components/wallet-ledger-dueno.test.tsx` (NUEVO).
  **Hecho:** un movimiento propio y uno de terceros con textos distintos; la celda **no** es un
  `Badge`; y una guardia de fuente comprueba que ningún archivo de `app/(app)/wallet/` importa
  `NATURALEZA_POR_CATEGORIA` ni deduce el dueño de la categoría. Cubre **R31, R33, R36**.

Dependencias: bloque entero ← T0.1; T5.2/T5.3 ← T2.1.

---

## Bloque 6 — La tarjeta de la ganancia (frontend; **bloqueado por D2**, depende del 3 y del 4)

- [x] **T6.1 — Extraer `DesgloseEgresosLista.tsx`** del `<dl>` de `DesgloseEgresosCard.tsx`, sin
  cambiar el marcado (mismo `role="group"`, mismo `aria-label`, mismas filas).
  **Hecho:** `tests/unit/components/wallet-desglose-egresos-card.test.tsx` pasa **sin cambios** en
  este paso: la extracción es una mudanza, no un cambio de comportamiento.
- [x] **T6.2 — `ComposicionGananciaCard.tsx` (NUEVO)**: dos columnas + pie (design §4.3), `Card`
  hermana, nunca anidada.
  **Hecho:** los 7 conceptos de ingreso con su etiqueta de `CATEGORIA_LABEL`; la columna de egresos
  incluye «Otros gastos de Ordenex» y su total es `totalEgresos`; el pie pinta `ganancia` con
  `signoGanancia`; orden declarado en el código. Cubre **R22, R25, R26, R27, R28, R29**.
- [x] **T6.3 — Recolocar en `WalletModule.tsx`**: la tarjeta nueva entra bajo la de la caja, la de
  «Egresos» se retira de su fila (absorbida) y el panel de gastos fijos pasa a ancho completo; el
  estado del módulo guarda además `composicion` y la recarga por filtro/página la refresca junto con
  el resto.
  **Hecho:** cambiar un filtro actualiza libro, cifras, desglose y composición **en la misma
  recarga**; ningún `fetch` a rutas internas.
- [x] **T6.4 — Re-hospedar las aserciones de la 45 y la 158**:
  `tests/components/ComposicionGananciaCard.test.tsx` (NUEVO) recibe las que hoy viven en
  `wallet-desglose-egresos-card.test.tsx` (R11/R12 de la 45 y R32 de la 158) apuntando al nuevo
  anfitrión, **más** las propias de esta feature.
  **Hecho:** ninguna aserción de la 45 ni de la 158 desaparece del árbol; el copy heredado de la 158
  sigue diciendo qué **no** entra (ahora: el dinero de las tiendas). Cubre **R23, R25, R26, R27,
  R28, R29**.
- [x] **T6.5 [P] — Barrido money-safe de las fuentes nuevas** (`ComposicionGananciaCard`,
  `DesgloseEgresosLista`, `BarraComposicionCaja`, `CajaResumenCard` ya lo tiene).
  **Hecho:** ninguna contiene `Number(`, `parseFloat(`, `parseInt(` ni `.toFixed(`, ni importa
  `@prisma/client` o `decimal.js`. Cubre **R12**.

Dependencias: bloque entero ← T0.2 y Bloque 3; T6.3 ← T6.2 y T4.3.

---

## Bloque 7 — Cierre

- [x] **T7.1 — Comprobar que las dos guardias de la 173 siguen verdes SIN haberse editado**
  (`caja-derivaciones.guardia.test.ts`, `caja-173-alcance.guardia.test.ts`) y que las tres pantallas
  congeladas no aparecen en el diff.
  **Hecho:** salida pegada en `progress/impl_231.md`, con `git diff --name-only` como control.
  Cubre **R37, R40**.
- [x] **T7.2 [P] — Medición de no-regresión (R38)**: mismo conjunto de filas antes y después, las
  siete cifras y los cuatro conceptos del desglose de egresos **idénticos importe a importe**.
  **Hecho:** la comparación va **ejecutada**, no razonada; el conjunto tiene importes distintos entre
  sí para que ninguna igualdad pase por casualidad.
- [x] **T7.3 — Mapa `R<n> → test` completo en `progress/impl_231.md`** con la salida real de los
  tests, y las decisiones D1-D5 registradas con su firma y su fecha.
  **Hecho:** los 40 requisitos tienen un test **nombrado y ejecutado**; el reviewer puede verificarlo
  sin volver a correr nada.
- [ ] **T7.4 — `./init.sh` completo en verde** (lo corre el leader) y PR contra `dev`.
  **Hecho:** typecheck 0, lint 0 errores, suite entera verde; la salida va en `progress/impl_231.md`.

---

## Trazabilidad `R<n> → test`

| R | Test | Archivo |
| --- | --- | --- |
| R1 | «las DOS cifras se ven a la vez…» + fixture nuevo | `tests/components/CajaResumenCard.test.tsx` |
| R2 | «la barra pinta los dos segmentos del modo `dos_bolsillos`» | `tests/components/CajaComposicionBarra.test.tsx` |
| R3 | «cada bolsillo muestra su importe y su explicación» | `tests/components/CajaComposicionBarra.test.tsx` |
| R4 | «R34: muestra el dinero de las tiendas y AVISA…» + «…lleva al sitio donde la deuda SÍ está» | `tests/components/CajaResumenCard.test.tsx` |
| R5 | «el bloque de Ordenex es neutro salvo en el caso límite» | `tests/components/CajaComposicionBarra.test.tsx` |
| R6 | «Entró, Salió y el conteo siguen en la tarjeta» | `tests/components/CajaResumenCard.test.tsx` |
| R7 | «cada cifra lleva su desglose, y son desgloses DISTINTOS» (173, sin editar) | `tests/components/CajaResumenCard.test.tsx` |
| R8 | «a la VEZ significa sin abrir nada…» (173, sin editar) | `tests/components/CajaResumenCard.test.tsx` |
| R9 | «`composicion` y el resumen cruzan como STRING» | `tests/integration/wallet-page.test.tsx` |
| R10 | «`dos_bolsillos`: 10 000 / 12 000 → 83.33» | `tests/unit/utils/caja-composicion.test.ts` |
| R11 | «el ancho del segmento es el STRING del DTO y el otro ocupa el resto» | `tests/components/CajaComposicionBarra.test.tsx` |
| R12 | barrido `LLAMADAS_PROHIBIDAS_EN_DINERO` sobre las fuentes nuevas | `tests/components/CajaComposicionBarra.test.tsx`, `tests/components/ComposicionGananciaCard.test.tsx` |
| R13 | «la barra tiene nombre accesible con las dos porciones» | `tests/components/CajaComposicionBarra.test.tsx` |
| R14 | «los cuatro modos, uno por conjunto» | `tests/unit/utils/caja-composicion.test.ts` |
| R15 | «ganancia negativa con dinero de tiendas → `solo_tiendas`» | `tests/unit/utils/caja-composicion.test.ts` |
| R16 | «`solo_tiendas`: un solo segmento y el bloque de Ordenex en peligro» | `tests/components/CajaComposicionBarra.test.tsx` |
| R17 | «`deTerceros` negativo → `solo_ordenex`» | `tests/unit/utils/caja-composicion.test.ts` |
| R18 | «nada que repartir → `sin_reparto`, sin porcentaje» | `tests/unit/utils/caja-composicion.test.ts` + `CajaComposicionBarra.test.tsx` |
| R19 | «el resto de conjuntos cae en `dos_bolsillos`» | `tests/unit/utils/caja-composicion.test.ts` |
| R20 | «fuera de `dos_bolsillos` no hay dos segmentos ni porcentaje» | `tests/components/CajaComposicionBarra.test.tsx` |
| R21 | «la tarjeta no compara importes: el modo llega del DTO» (contraprueba con dos DTO de mismos importes y distinto modo) | `tests/components/CajaComposicionBarra.test.tsx` |
| R22 | «la tarjeta enseña ingresos, egresos y la ganancia en el pie» | `tests/components/ComposicionGananciaCard.test.tsx` |
| R23 | «el desglose cubre todas las categorías propias y suma `ingresosPropios`» | `tests/unit/utils/caja-composicion.test.ts` + `tests/unit/guards/caja-composicion-exhaustiva.guardia.test.ts` |
| R24 | «una sola lectura: las dos derivaciones salen del mismo array» | `tests/unit/services/wallet-service.test.ts` |
| R25 | «cada concepto con su etiqueta legible, nunca el enum» | `tests/components/ComposicionGananciaCard.test.tsx` |
| R26 | «la columna de egresos suma `egresosPropios`» | `tests/unit/utils/caja-composicion.test.ts` + `tests/components/ComposicionGananciaCard.test.tsx` |
| R27 | «el pie pinta la ganancia con el signo del servidor» | `tests/components/ComposicionGananciaCard.test.tsx` |
| R28 | «el orden es el declarado, no el de magnitud» | `tests/components/ComposicionGananciaCard.test.tsx` |
| R29 | «dice qué NO entra» (heredado de la 158) | `tests/components/ComposicionGananciaCard.test.tsx` |
| R30 | «`forbidden` no viaja con composición» | `tests/unit/services/wallet-service.test.ts` |
| R31 | «cada categoría del SEED produce su `dueno`» | `tests/unit/repositories/wallet-movimiento-repository.test.ts` |
| R32 | «la partición cubre el SEED entero» | `tests/unit/guards/caja-composicion-exhaustiva.guardia.test.ts` |
| R33 | «la celda es punto + texto, no un `Badge`» | `tests/unit/components/wallet-ledger-dueno.test.tsx` |
| R34 | «la descarga trae «Dueño» con el mismo texto» | `tests/components/descarga/WalletDescarga.test.tsx` |
| R35 | «los encabezados anteriores conservan su orden y «Dueño» se añade» (D1) | `tests/components/descarga/WalletDescarga.test.tsx` |
| R36 | «ninguna fuente de `app/wallet` deriva el dueño» | `tests/unit/components/wallet-ledger-dueno.test.tsx` |
| R37 | «ni migración ni escritura nueva» (guardia de la 173, sin editar) + control del diff | `tests/unit/guards/caja-173-alcance.guardia.test.ts` + `progress/impl_231.md` (T7.1) |
| R38 | «las siete cifras y los cuatro conceptos no cambian de valor» | `tests/unit/utils/caja-composicion.test.ts` (T7.2) |
| R39 | «sin hex ni utilidades de paleta ad-hoc en las fuentes nuevas» | `tests/components/CajaComposicionBarra.test.tsx` |
| R40 | «las tres pantallas congeladas no saben nada de esto» (guardia de la 173, sin editar) | `tests/unit/guards/caja-173-alcance.guardia.test.ts` |
