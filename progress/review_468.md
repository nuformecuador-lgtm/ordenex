# Ficha 468 — Revisión (Excel del libro de la wallet: kardex + detalle por guía que cuadran)

Revisor: reviewer, 2026-10-02. Rama revisada `origin/feature/468-wallet-excel-kardex-por-guia` @ `3dfad607`
(11 commits sobre `cbf02021`), en worktree propio (`review/468`).

> Grafo `codebase-memory`: no se usó; la revisión se hizo con el diff, `grep`, lectura de archivos y SQL de
> solo lectura contra la base LOCAL (`localhost:5432`, host comprobado sin imprimir credencial).

## Veredicto

**APROBADA** para mergear a `dev`. **0 bloqueantes**, 9 menores. **No apta para `done`** hasta marcar
`tasks.md` (m1), anotar `progress/history.md` (m2, leader) y hacer la medición T16 en producción (m8).

## PRIORIDAD 1 — las «Diferencia sin repartir» del recorrido local

**Conclusión: las 33 diferencias (17 caja, 14 tienda Tania, 2 mensajero Marco) son datos locales
incoherentes (a). Ninguna es un defecto del reparto (b).** El campo `diferencias` de
`comprobaciones-xlsx.json` cuenta exactamente las filas «Diferencia sin repartir» de la hoja 2 (contadas
leyendo los `.xlsx` con exceljs: 17 / 14 / 2). Todas caen en tres cierres de agosto de Marco
(`70ebf5e2` 2026-08-12, `942993c5` y `f4c93d88` 2026-08-13) y se explican por tres causas medidas:

### Causa 1 — feed del cierre escrito como «entregado», gestiones que hoy no lo son (12 caja + 12 tienda)

Los seis conceptos del feed (flete, IVA flete, comisión, IVA comisión) de los tres cierres salen «0 guías».

- `942993c5`: el feed escribió flete 4.000,00 · IVA 520,00 · comisión 570,50 · IVA comisión 74,17. Es
  EXACTAMENTE `derivarIngresoOrden` con sus dos guías (990014, 990015; `cierre_detail` con tarifa, GAM)
  como **entregadas**: 2 × 2.000 = 4.000; 13 % = 520; 3,5 % × (9.800 + 6.500) = 570,50; 13 % = 74,17.
  Hoy las dos gestiones son `reprogramado` **con `monto_recibido` 9.800 / 6.500**, un estado que la app no
  produce (el recaudo es solo de ENTREGADA). El criterio de la 344 (flete solo de `entregado`,
  preexistente) hace bien en no repartirlas.
- `70ebf5e2`: sus 12 `cierre_detail` tienen `tarifa_id` NULL, pero el feed escribió flete 12.000 (6 × 2.000)
  y comisión 4.343,50 (= 3,5 % × 124.100): calculado con una tarifa que el cierre no congeló, y con 6
  gestiones entregadas que hoy son `reprogramado`/`incidente`.
- `f4c93d88`: sus 4 conceptos (2.000 / 260 / 437,50 / 56,88) no tienen ninguna gestión colgada de ese
  cierre (causa 2).

### Causa 2 — una gestión colgada del cierre equivocado (4 caja + 2 tienda + 2 mensajero)

La gestión `c3cadd03` (guía 990001, `monto_recibido` 12.500, `pago_mensajero` 1.700) se creó el
2026-08-14T01:22:14Z, **22 s antes** de solicitarse `f4c93d88` (01:22:36Z), cuyo snapshot es exactamente
ella (`total_general` 12.500, `total_pago_mensajero` 1.700, único `cierre_detail` = 990001). Pero su
`cierre_id` apunta a `70ebf5e2`, cuyo feed se escribió el 2026-08-12T22:56Z, antes de que esa gestión
existiera. Resultado, simétrico al céntimo:

| Cierre | Concepto | Movimiento | Σ guías | Diferencia |
| --- | --- | --- | --- | --- |
| `70ebf5e2` | Contra-entrega (caja y tienda) | 124.100 | 136.600 | −12.500 |
| `70ebf5e2` | Pago al mensajero (caja) / pago devengado (mensajero) | 10.200 | 11.900 (7 × 1.700) | −1.700 |
| `f4c93d88` | Contra-entrega (caja y tienda) | 12.500 | 0 | +12.500 |
| `f4c93d88` | Pago al mensajero / pago devengado | 1.700 | 0 | +1.700 |

Es el caso «7 × 1.700 = 11.900 ≠ 10.200» que cita el implementador; la causa es esta.

### Causa 3 — indemnización con importe distinto del snapshot (1 caja)

`egreso_indemnizacion` de `70ebf5e2` (creado 2026-08-20T04:36Z) = 12.500; Σ `gestion_orden.indemnizacion`
de las gestiones `incidente` del cierre = 9.000 (solo 990008). Diferencia +3.500. El criterio
(`CRITERIO_INDEMNIZACION`: `incidente`, `> 0`) es el mismo predicado del feed.

**Cuadre:** caja 12 + 4 + 1 = 17; tienda 12 + 2 = 14; mensajero 2. **Contraprueba:** los cierres de
2026-09-24 (Rita, Quino), con datos coherentes, dan 0 diferencias en los 4 conceptos nuevos Y en los seis del
feed (p. ej. flete de Rita 10.000 = 5 guías × 2.000; IVA, comisión e indemnización 3.000 cuadran guía a
guía). Producción (T1, `progress/medicion_468.md`): 0 diferencias en COD, pago e indemnización. El archivo
hace lo que pide R41/R42: enseña el descuadre del dato y aun así el TOTAL GENERAL = «Total del periodo».

Consultas (solo SELECT, con `pg` desde `node -e`, `.env` copiado y borrado al final): `cierre_dia` de Marco
con nº de gestiones y detalles; `gestion_orden` de los tres cierres y de la guía 990001; `cierre_detail`
(tarifa, `monto_cobrar`, `es_central`); `wallet_movimiento` con origen en esos cierres y todas las
`egreso_indemnizacion`.

## Gate (corrido por el revisor)

`./init.sh` completo con `.env` copiado («los 328 archivos de tests contra Postgres SI se ejecutan»),
`progress/gate_review_468.log` (sin `tail`, `INIT_EXIT` dentro; no versionado, como los demás logs):
typecheck ✓, lint ✓, **2374 archivos / 32.950 tests en verde, 26 skipped**, `init OK`, **`INIT_EXIT=0`**,
a la primera (sin rojos de integración que aislar). Los 26 skipped son `AnaliticaPage` (17) y
`AnaliticaShell` (9), preexistentes. Corrieron los de la 468: `libro-kardex-468` integración (6),
`kardex-cuentas-468` (1), `WalletCaja468` (11), `EstadoCuenta468` (8), `DescargarDatasetDetalle468` (15),
`libro-kardex-468` unit (31), `detalle-por-guia-468` (12), `xlsx-monto-468` (18), etc. Coincide con lo
declarado por el implementador.

## Mutaciones del revisor — NO ejecutadas

Se pidió matar al menos 2 tests por mutación (invariante hoja 2 = hoja 1; reparto de COD/pago). El primer
intento (`lib/utils/detalle-por-guia.ts`: sacar las diferencias del TOTAL GENERAL y desactivar la
afirmación R45) fue **denegado por el clasificador de permisos** de este entorno («Security Test
Removal»). No se intentó por otra vía. El árbol quedó intacto (solo el log del gate y temporales sin
versionar). Queda para el leader/humano (m9). Evidencia indirecta: el implementador reporta 9 mutaciones
rojas (equivalencia sin `exigePagoMensajero`, T4 sin `pagoMensajero > 0` y sin correlación con el cierre,
pago repartido por `montoRecibido`, sin diferencias T8/T9, contra-entrega fuera de `CATEGORIAS_EFECTIVO`,
ventana sin `created_at`, lado de la bodega al revés), y los tests de la invariante comparan contra literales
y contra los totales de la hoja 1, no contra su propia fuente (`detalle-por-guia-468.test.ts:168-204`).

## Checklist

### Especificación
- [x] `requirements.md` R1–R61 en EARS, con «Aprobación» (2026-10-02, las 5 propuestas por defecto). La
  implementación respeta las cinco: «Cobrado a tiendas» solo en la caja; kardex siempre ascendente (forzado
  en servidor y cliente); «N guía(s)»; el detalle en pantalla de los 4 conceptos lista órdenes; pago del
  efectivo en «Movimientos sin guía».
- [x] `design.md` con 8 alternativas descartadas (§11).
- [ ] `tasks.md` con todas `[x]` — **las 16 siguen en `[ ]`** → m1.

### Trazabilidad
- [x] Cada R1–R61 tiene test concreto; mapa en `progress/impl_468.md` (backend y frontend), comprobado
  contra los títulos y cuerpos de los tests. Ejemplos: R5/R8/R16/R23 `libro-kardex-468.test.ts:180-240`;
  R10 `utils/libro-kardex-468.test.ts:15` (recorre el SEED); R12/R14/R15 integración T6; R27 equivalencia
  + integración T4; R28 integración T7; R33–R46 `detalle-por-guia-468.test.ts` regla a regla; R45
  integración T9 en caja, tienda, mensajero y /mi-wallet; R55/R56/R61 `detalle-en-lote-468.test.ts`;
  R22/R58/R59 `xlsx-monto-468.test.ts`; R50–R52 `DescargarDatasetDetalle468`. R54 es por construcción (el
  adaptador no suma: sin aritmética Decimal en `libro-kardex-descarga.ts`) más los tests que exigen los
  totales del servidor (R8, R44).
- [x] Tests de la 464/344 retirados con sustituto: los 4 archivos borrados (`detalle-por-orden-464`,
  `EstadoCuenta464`, `libro-con-detalle-464` y su composition-root) y los casos reescritos tienen
  sustituto en el mapa de `impl_468.md`; comparados título a título (p. ej. `EstadoCuenta464` 7 casos →
  `EstadoCuenta468` 8, incluidos tope, lectura fallida y R57). Los dos renombrados (`WalletCaja`,
  `DescargarDatasetDetalle`) conservan los casos vigentes de la 464.
- [x] Integración no «verde sin datos»: `describe.skip` solo sin base; con base corrieron.

### Calidad de código
- [x] typecheck, lint y tests en verde (gate arriba).
- [x] E2E: no hay harness (memoria «Nada de E2E»); el riesgo se cubrió con el recorrido en la app real
  (Playwright ad hoc, `.xlsx` reales leídos con exceljs) y la integración contra Postgres. Inaplicable.

### Datos y seguridad
- [x] Sin tablas ni migraciones nuevas; no aplica RLS ni `down.sql`.
- [x] Sin secretos ni webhooks.
- [x] R55: el detalle del mensajero exige acceso total antes de la base (`detalle-en-lote-468.test.ts:74`).
- [x] Money-safe: sin `Number(`/`parseFloat`/`parseInt` nuevos en dinero salvo `celdaMonto`
  (`lib/utils/xlsx-monto.ts:37`), el único punto de conversión que exige R22, con comprobación de vuelta y
  guardia propia (`xlsx-monto-unico.guardia.test.ts`). Toda suma con `Prisma.Decimal`.
- [x] Sin fórmulas de dinero nuevas: los aportes son `derivarIngresoOrden` sobre lo congelado (344) o la
  suma por gestión de las columnas que el feed ya suma (`pago_mensajero`, `indemnizacion`,
  `monto_recibido`); diferencia = movimiento − Σ aportes (R41, pedida por el humano). `pago_efectivo` no se
  reparte (R43).

### Patrón de capas
- [x] Acciones delgadas con composition root; orquestadores en `LibroKardexService`; repositorios solo
  consultan (`CierreAporteRepository`, `WalletMovimientoRepository.saldosTrasMovimientos`,
  `EstadoCuentaRepository.listarPorIdsDeMensajero` con el mensajero en el WHERE); interfaces nuevas en
  `lib/interfaces/repositories` y `lib/interfaces/services`.

### Permisos / multipaís
- [x] Server Actions; sin fetch a API routes. Sin país/moneda hardcodeados nuevos.

### Excepciones nominales en guardias (revisadas una a una)
- [x] `mi-wallet-335.guardia.test.ts:114-120`: lista NOMINAL de las dos lecturas `miEstadoCuentaKardex*`;
  las dos solo leen (`lib/actions/estado-cuenta.ts:314`, `:335`). Justificada.
- [x] `tablero-dia/primitivas.guardia.test.ts:381-389`: exenta solo `libro-kardex-descarga.ts` por el campo
  `mensajeroNombre` del DTO de la wallet. Justificada.
- [x] `ControlDescargaTransversal.test.tsx:668-683`: la caja coloca con `descargaLibroCaja`; el tope sigue
  en el servidor y lo mide `WalletCaja468` (R56). NOMINAL por ruta. Justificada.
- [x] `wallet-origen-total.guardia.test.ts:84-88`: 4 → 5 bordes con origen en `wallet.ts` (+2 kardex, −1
  de la 464 retirada). Cuenta comprobada.
- [x] `datatable-descarga-contrato`, `wallet-actions`, `columnas-asercion-de-orden`: siguen el contrato
  nuevo (`columnasFijas`, censo sin la acción retirada, claves literales). Ninguna tapa un fallo.

### Verificación final
- [x] `./init.sh` en verde (revisor).
- [x] Este informe.
- [ ] `progress/history.md` → m2 (leader).

## Hallazgos

Ningún BLOQUEANTE.

| # | Tipo | Dónde | Qué | Qué hacer |
| --- | --- | --- | --- | --- |
| m1 | menor (bloquea `done`, no merge) | `specs/468-wallet-excel-kardex-por-guia/tasks.md:13,22,33,45,56,66,80,89,99,114,123,135,146,156,163` | T1–T15 siguen en `[ ]` aunque todas tienen commit o medición. CHECKPOINTS exige `[x]`. T16 (`:175`) es posterior al despliegue. | Marcar T1–T15 con su commit; T16 al medir. |
| m2 | menor (leader) | `progress/history.md` | Falta la entrada de la 468. | Añadirla al cerrar. |
| m3 | menor | `tests/components/descarga/DescargarDatasetDetalle468.test.tsx:169` | R26 dice «Movimientos» primero; la primera hoja conserva el título de la superficie («Libro de movimientos», «Estado de cuenta de …»). El vocabulario del spec define «Movimientos» como la primera hoja (rol) y el test fija ese título. | Confirmar con el humano o renombrar la hoja; no afecta al cuadre. |
| m4 | menor | `lib/actions/wallet.ts:288-290`, `lib/actions/estado-cuenta.ts:171-173` y `:212-214` | Tres acciones completas quedan sin pantalla con `@sin-superficie` (código muerto con sus tests). | Retirarlas en una ficha de servidor. |
| m5 | menor | `lib/utils/detalle-por-guia.ts:103-112` | Los cierres de un bloque se indexan por DÍA: si una guía aporta en dos cierres del MISMO día con congelados distintos, la cabecera lleva los del primero que aparece, no los del más reciente (R39). Caso límite; no ocurre en los datos medidos. | Indexar por cierre (id o instante) y sacar el día al pintar. |
| m6 | menor | `lib/utils/xlsx-monto.ts:37-38`, `lib/utils/detalle-por-guia.ts:93` | `celdaMonto("-0.00")` devuelve TEXTO; un aporte 0,00 de un movimiento negado (el `neg()` de decimal.js da `-0.00`) saldría como celda de texto (R22). Hoy ningún reverso de cargo es repartible. | Normalizar el cero negado antes de `toFixed`. |
| m7 | menor | `progress/recorrido_468/mensajero-solo-movimientos.txt` (filas «Liquidación») | El Detalle dice «… · Efectivo · Efectivo · …» (motivo y forma de pago repiten la palabra). Es lo que compone R18 con las partes de la pantalla. | Cosmético: valorar deduplicar. |
| m8 | menor (bloquea `done`) | T16 (`tasks.md:175`) | Los seis conceptos del feed no se midieron en producción (T1 cubrió COD, pago e indemnización). En local es justo ahí donde aparecen diferencias cuando el dato es incoherente. | Medir T16 tras desplegar, antes de cerrar. |
| m9 | menor (proceso) | — | Las mutaciones del revisor no se ejecutaron: el clasificador de permisos las denegó. | Autorizar o que las corra el leader (p. ej. M1 en `detalle-por-guia.ts`; M2 `CRITERIO_PAGO_MENSAJERO.resultados` solo `entregado`). |
