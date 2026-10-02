# Revisión — Ficha 464 (Excel de las wallets: columnas a elegir y hoja «Detalle por orden»)

Revisor: reviewer. Fecha: 2026-10-02. Rama revisada: `origin/feature/464-wallets-excel-por-orden @ 72e501bd`
(base `41674816`; `origin/dev` = `3e50141a`, un commit por delante solo con `feature_list.json` y un log;
merge-tree limpio). Incluye los menores m9–m12 de la 3.ª revisión de la 463
(`origin/review/463 @ 3cd1d237`).

Búsqueda de código: el MCP `codebase-memory` no estaba en mi conjunto de herramientas; se usó el diff,
`grep` y lectura directa de cada archivo citado.

Por orden del leader NO se corrió `./init.sh`, ni `tests/integration`, ni dev server (hay un gate completo
sobre la base compartida). La integración se juzgó leyendo `tests/integration/db/detalle-en-lote-464.test.ts`
y la evidencia de `progress/impl_464.md` y `progress/gate_464_frontend.log`.

## Veredicto: **OK** (sin bloqueantes; 7 menores y 1 hallazgo ajeno)

Condición ya conocida, no nueva: el gate completo del frontend salió `INIT_EXIT=1` por dos tests AJENOS de
reloj (ver H-ajeno). La corrida completa post-merge en `dev` tiene que salir verde (o repetirse fuera de la
franja 00:00–01:00 hora local) antes de dar la ficha por `done`.

## Checklist

### Especificación y tareas
- [x] `requirements.md` con R1–R44 en EARS; `design.md` con 6 alternativas descartadas; `tasks.md` T1–T12 todas `[x]`.
- [x] Spec aprobado por el humano el 2026-10-01 con «arranca con detalle» (status_note de la ficha).
- [x] Desviaciones del design anotadas y razonadas en `impl_464.md` (dos orquestadores en vez de uno; entrada
      por superficie; relectura del ledger de la tienda por id; tramos en el servicio; orden de gestiones con
      desempate por `id`). Ninguna cambia un requisito.

### Trazabilidad
- [x] `progress/impl_464.md` contiene el mapa R1–R44 → test (backend y frontend).
- [x] Cada R tiene al menos un test que lo verifica. Excepción PARCIAL en R28: la parte «resultados desde las
      etiquetas» no la fija ningún test (m1). La parte «Fecha y Movimiento = la fila» sí.

### Calidad de código (corrido por el revisor)
- [x] `tsc --noEmit`: exit 0.
- [x] `eslint` sobre todo lo tocado: 0 errores (2 avisos previos en `DescargarGestionesDialog.test.tsx`, ajenos).
- [x] Tests: 275 archivos / **3415 tests verdes** (`tests/components/descarga`, `tests/unit/descarga`,
      `tests/unit/guards` entero, los archivos de la 464 salvo integración, `WalletCaja463`,
      `EstadoCuenta{,458DPantalla,463,Anulados}`, `WalletFiltroAQuien458E`, `WalletLibroCaja458E`,
      `wallet-actions`, `datatable-descarga-contrato`). Más una corrida amplia de `tests/components` +
      `tests/unit/{descarga,utils,components}`: 664 archivos / 9230 verdes.
- [x] Integración (leída, no corrida): `detalle-en-lote-464` corre en el gate del frontend (6 tests,
      línea 9531 del log), sin `if (!x) return;`, con conteos exactos del escenario y los montos emitidos por
      los FEEDS reales; ningún archivo de `tests/integration/db` saltado (26 `skipped` = Analítica).
- [n/a] E2E: la ficha es una descarga de solo lectura (no muta pagos ni recaudo) y no hay harness E2E
      (memoria del repo). Cubierto por la verificación en la app con Playwright descrita en `impl_464.md`.

### Datos y seguridad
- [x] Sin migraciones, sin tablas, sin RLS nueva, sin cambio de `db/schema.prisma`.
- [x] Sin secretos; `TRAMO_CIERRES_LOTE` por configuración con default.
- [n/a] Webhooks.

### Capas
- [x] Acciones = borde (actor → zod → servicio); servicios sin HTTP; repositorio solo Prisma (el filtrado de
      gestiones por su cierre en `listarAportesDeCierres` es una proyección documentada, no un criterio).
- [x] Interfaces nuevas en `lib/interfaces/{repositories,services}`.
- [x] Composition roots: las tres acciones construyen sus orquestadores con TODAS las dependencias reales
      (test `libro-con-detalle-464.composition-root`).

### Permisos / multi-país
- [x] Server Actions, rol comprobado en el servidor ANTES de leer (ver abajo).
- [x] Nada de país/moneda/cuenta hardcodeado; montos como STRING del servidor.

## Lo que se pidió mirar con atención (dinero)

1. **Control de acceso del lote.** `DetalleEnLoteService.detallar` mira el rol ANTES de cualquier lectura
   (caja y tienda-oficina: `esAccesoTotal`; `/mi-wallet`: `adminTienda`), sin fiarse de que el servicio del
   libro ya lo hiciera. En `/mi-wallet` la tienda sale SIEMPRE de `actor.usuarioId` (no hay campo de entrada
   que la nombre; `miEstadoCuentaCompletoSchema` es `.strict()`, R35). En la oficina, de `r.estado.cuenta.id`
   (la cuenta ya leída con su guard). La relectura del ledger lleva `tiendaId` en el `WHERE`
   (`listarPorIdsDeTienda`) y un id ajeno LANZA en vez de inventar un detalle vacío (IN: ids de B con la
   tienda A ⇒ `rejects`). Contar y listar llevan `tiendaId` al final de cada rama de `buildWhere`. `/mi-wallet`
   sin mensajero en el DTO (servidor) ni en el catálogo (cliente). OK.
2. **Cuadre.** `suma` = Σ `aporteDeOrden` con `Prisma.Decimal`, `cuadra = suma.equals(Decimal(monto))` en el
   servidor; el cliente solo pinta el booleano y la `suma` string. IN compara contra los montos que emiten
   `WalletFeedService`/`WalletTiendaFeedService` reales (caja: `m.monto`; tienda: `cargo ?? abono`).
   **Categorías sin reparto** (COD recaudado de la caja, indemnización, pago a mensajero, ajustes):
   `fuenteDeMovimiento` (única, compartida con el detalle de una fila) devuelve `sin_reparto` con su motivo;
   la celda dice el motivo con el MISMO diccionario del panel de esa superficie; no se calcula ni se pinta
   cuadre, y no generan filas de detalle. Nunca un cuadre falso. OK.
3. **Tope.** Se cuenta por (concepto, tramo) con el MISMO `where`, se suma por MOVIMIENTO, y con
   `total > MAX_FILAS` se devuelve `limite_excedido` SIN llamar a `listarAportesDeCierres` ni
   `cabecerasDeCierres` (LS + IN con espía sobre el repositorio real; frontera `== tope` sale). El orquestador
   añade `hoja: "detalle"`; el tope de la hoja de movimientos pasa con `hoja: "movimientos"` sin pedir el
   detalle. El cliente redacta un aviso distinto por hoja (CJ4/EC4). OK.
4. **Generador.** Sin `hojasAdicionales` (o vacío) el camino es literalmente el de antes
   (`buildXlsxRows(..., nombreHoja(titulo))`, y `buildXlsxRows` delega en `buildXlsxLibro` con una hoja); VH
   relee con exceljs y compara nombre/columnas/celdas. csv + hojas ⇒ `throw` antes de producir nada. OK.
5. **Decisiones declaradas por el frontend.**
   - «N.º» y «Detalle por orden» fijas en la hoja principal con detalle: es la única lectura compatible de
     R4 + R8 + R15/R16 una vez el humano aprobó «arranca con detalle». Entre las fijas van las columnas,
     encabezados y orden de siempre (CJ4 lo afirma literal). Ver m2 (redacción del spec).
   - Detalle solo si hay ámbito en la principal: las tres superficies con detalle lo declaran; DD lo fija.
   - Tests viejos que pasan a elegir «Solo los movimientos» (`WalletDescarga` ×5, `WalletCaja463` R42,
     458-E ×2): sus ASERCIONES no cambian, solo el camino (la descarga de siempre, que ahora es la opción
     no por defecto). No se debilita ninguna aserción. El camino por defecto queda cubierto por CJ4
     (periodo + tipo + término + orden viajan a la acción con detalle; cabecera literal; autoría ilegible ⇒
     sin archivo) y EC4. «A quién» no se afirma explícitamente con detalle, pero las dos ramas evalúan la
     MISMA expresión `inputDeLibro(filtrosWallet, filtrosLibro)`.
6. **Saldo inicial (463).** `filasDelPeriodoConDetalle` lo pone sin número, primero con `asc` y último con
   `desc`, igual que `filasDelPeriodo`; la mutación C del revisor (invertir la posición) muere con 2 rojos en EC4.
7. **m9–m12 de la 463.** Cerrados (ver abajo).
8. **Trazabilidad R1–R44.** Verificada fila a fila contra los nombres de test reales; ver m1.
9. **Nota del frontend sobre `OrdenesDescarga`.** Confirmada leyendo el test (H-ajeno).

## Mutaciones del revisor

Arnés de un solo uso en el scratchpad (aplica solo si el texto casa EXACTAMENTE una vez, comprueba que el
archivo cambió, restaura desde copia y compara byte a byte; base verde antes y después; árbol limpio al
final). Suites: EC4, DP, CJ463, CJ4, LS, DD (101 tests); R1 además contra 664 archivos.

| # | Mutación | Resultado |
| --- | --- | --- |
| A | `/mi-wallet`: motivo sin reparto con otro diccionario | **Muerta** (DP) |
| B | m9: no resembrar nunca el término tras un fallo | **Muerta** (2: B3 «el libro lanza», B4 «C») |
| C | saldo inicial en la posición contraria con detalle | **Muerta** (2: EC4 tienda y `/mi-wallet`) |
| D | `tiendaNombre` en todas las superficies | **Muerta** (LS R5) |
| E | la hoja de detalle ignora la elección de columnas | **Muerta** (DD R2/R3/R11) |
| H | el estado de cuenta pide el detalle también con «Solo los movimientos» | **Muerta** (EC4 R4/R9) |
| R1 | caja: «Resultado» = valores crudos del enum (`join(" · ")`) en vez de `resultadosTexto` | **SOBREVIVE** (664 archivos / 9230 tests) → m1 |
| R2 | ídem en `/mi-wallet` | **SOBREVIVE** (suites de la 464) → m1 |
| R3 | ídem en la tienda (oficina) | **SOBREVIVE** (suites de la 464) → m1 |

## m9–m12 de la 463

- **m9** cerrado: `fallo(status, pedido)` solo resiembra el buscador si la lectura fallida pedía otro término.
  Test CJ «revisión m9» (teclear «Juan» con «Sale» en vuelo que falla: el campo sigue en «Juan» y luego se
  pide `{ q: "Juan" }` sin «Sale»). La rama contraria (sí resembrar cuando falló un término) la fija B3
  «el libro lanza» (mutación B del revisor: muerta).
- **m10** cerrado: test CJ «revisión m10» (periodo + «Sale» en vuelo, llega la superada, «Más antiguas»:
  `resumen` ×3 y el libro con periodo + `egreso` + `asc`). La bitácora mide la guarda de `soltarTurno`
  quitada ⇒ rojo.
- **m11** cerrado: B3 «el libro lanza» afirma `listar` con `{ q: "Juan", page: 1, pageSize: 20 }` (sin `asc`).
  La bitácora mide la línea quitada ⇒ 2 rojos.
- **m12** cerrado: las dos filas R49 de `impl_463.md` nombran B3, B4, m9 y m10.

## Hallazgos

### m1 — menor — R28 «resultados desde las etiquetas» no lo fija ningún test

El código es correcto (las tres proyecciones usan `resultadosTexto` del diccionario del panel de su
superficie), pero CJ4 afirma `expect.any(String)` y DP `expect.stringContaining(" · ")`: cambiar
`resultadosTexto(orden.resultados)` por `orden.resultados.join(" · ")` (el enum crudo, p. ej.
`devolucion_a_origen_por_rechazo`) sobrevive en las tres superficies (R1–R3 arriba). Arreglo: en DP, una
aserción literal del texto de «Resultado» para un resultado conocido por superficie (o igualdad con
`resultadosTexto` de SU módulo de etiquetas, que aquí sí es la fuente que R28 exige).

### m2 — menor — R4 dice literalmente otra cosa que lo que se aprobó

R4 («sin tocar el selector, mismas columnas que antes») choca con R8 + R15/R16 desde que el humano aprobó
«arranca con detalle»: por defecto la hoja de movimientos lleva «N.º» delante y «Detalle por orden» detrás.
La implementación y los tests siguen la única lectura compatible (las de siempre ENTRE las fijas; idéntica
con «Solo los movimientos»). Recomendación: enmendar el texto de R4 en `requirements.md` al cerrar la ficha
para que el spec diga lo que el código y los tests afirman.

### m3 — menor — Un movimiento con reparto y 0 órdenes dice «no coincide», no por qué

En local, 12 movimientos de cierres viejos sin datos congelados salen con «0 órdenes. La suma de las órdenes
es 0.00 y no coincide con el monto del movimiento.», mientras el panel de esa fila explica el caso con
`DETALLE_MOVIMIENTO_VACIO`. Cumple R23 (es verdad que no cuadra) y en producción, vaciada el 2026-08-25, todos
los cierres son posteriores al congelado. Si se quiere afinar: con cero órdenes usar el texto de
`DETALLE_MOVIMIENTO_VACIO`.

### m4 — menor — La posición del saldo inicial se escribe en dos sitios

`filasDelPeriodo` y `filasDelPeriodoConDetalle` repiten la misma decisión (con «Más antiguas» el saldo
inicial va primero; con «Más recientes», último). Las dos están fijadas por tests (mutación C), así que no es
un riesgo hoy, pero es la clase de duplicado que diverge. Extraer una función común cuando se toque.

### m5 — menor — Gate del frontend con `INIT_EXIT=1`

Dos rojos AJENOS de reloj (H-ajeno); verdes aislados 3/3 según la bitácora. Mismo patrón que la 463: la
corrida completa post-merge en `dev` debe salir verde.

### m6 — menor — Datos QA que no cuadran en la tienda Tania (informativo)

En la verificación en la app, el N.º 25 (COD del cierre QA del 2026-08-12, 124100.00 vs Σ 136600.00) sale con
el aviso de R23. Es justo lo que R23 promete; se anota para que nadie lo tome por un fallo de la 464.

### m7 — menor — El backend no usó el grafo y lo dijo

Ambas bitácoras lo declaran (el backend no tenía la herramienta; el frontend leyó directamente los archivos
nombrados por el design). Sin efecto en el resultado.

### H-ajeno — `OrdenesDescarga` / `OrdenesDescargaColumnas` fallan entre las 00:00 y las 01:00 locales

Confirmado leyendo los tests: `hoyISO()` (en `tests/components/OrdenesDescarga.test.tsx:126` y
`tests/components/OrdenesDescargaColumnas.test.tsx:163`) calcula el día con `getFullYear/getMonth/getDate`,
es decir en la hora LOCAL de la máquina (UTC−5 aquí), mientras que `nombreArchivoDescarga` usa
`fechaCalendarioCR` (UTC−6). Entre las 00:00 y las 01:00 locales los dos días difieren y los dos tests fallan
(`ordenes-2026-10-01.xlsx` vs `ordenes-2026-10-02.xlsx` en el log). Ni los tests ni el generador los toca la
464. Ficha aparte: que el test calcule el día con `fechaCalendarioCR()` (o fije el reloj con
`vi.setSystemTime`).

## Para mergear

1. Nada bloqueante. m1 es una aserción; m2 es texto del spec; m3/m4 opcionales.
2. Tras el merge, la corrida completa en `dev` en verde (m5).
3. Entrada en `progress/history.md` al cerrar (CHECKPOINTS; la añade el leader).
