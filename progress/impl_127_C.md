# impl_127_C — analitica financiera · TANDA C (C.1, C.2, C.3 + la parte de C.5 que les aplica)

Rama: `feature/127-analitica-financiera-servicios` · worktree `ordenex-wt-127`.
Sesion del **2026-08-02**. Continua `progress/impl_127.md` (tandas 0, A y B, commit `92134879`).

**Alcance de esta sesion:** C.1, C.2, C.3 y la mitad de C.5 que aplica a esos tres repositorios.
**Fuera de alcance, y NO tocado:** C.4 (`ConciliacionCierresAnaliticaRepository`), toda la TANDA D
—incluida D.6—, E y F. `lib/analytics/metrics.ts` **no se ha tocado ni una linea**.

---

## Archivos creados

| Archivo | Que es |
|---|---|
| `lib/repositories/IngresosAnaliticaRepository.ts` | **C.1** — caja principal: `groupBy(categoria, tipo)` + `_sum(monto)` sobre `wallet_movimiento`, categorias del catalogo, ventana `[desde, hasta)` por `fecha_movimiento`. Sirve `ingreso_flete`, `ingreso_comision_cod`, `ingreso_iva` y `egresos`. |
| `lib/repositories/RecaudoAnaliticaRepository.ts` | **C.2** — las DOS vistas de `cod_recaudado`, en dos metodos que consultan tablas distintas y no se cruzan. |
| `lib/repositories/CuentasPorPagarAnaliticaRepository.ts` | **C.3** — los dos saldos AL CORTE (`fecha_movimiento < hasta`, sin cota inferior). |
| `tests/unit/analytics/_fake-prisma-dinero.ts` | Base de datos en memoria que **ejecuta** `where`/`groupBy`/`_sum`/`orderBy`. No es un test (no lo recoge `include`); es la herramienta que hace que las mutaciones muerdan. |
| `tests/unit/analytics/financiera-ingresos-repo.test.ts` | Los "hecho cuando" de C.1 (11 tests). |
| `tests/unit/analytics/financiera-recaudo-repo.test.ts` | Los "hecho cuando" de C.2 (12 tests). |
| `tests/unit/analytics/financiera-cuentas-por-pagar-repo.test.ts` | Los "hecho cuando" de C.3 (9 tests). |
| `tests/unit/analytics/financiera-repositorios.guardia.test.ts` | **C.5 (parcial)** — sin derivacion, sin `try/catch`, sin ceros por defecto, y el error de base se propaga en los CINCO metodos (14 tests). |

### Archivo MODIFICADO (uno, y es un guardia de la TANDA B)

`tests/unit/analytics/financiera-correspondencia.guardia.test.ts` — ver **C4** abajo. Resumen: el
guardia era **insatisfacible** para C.3 tal como estaba escrito; se le sube la resolucion de
archivo a metodo y se le añade una segunda comprobacion por archivo. No se afloja: las dos
mutaciones que antes lo ponian rojo lo siguen poniendo rojo (M24/M25), y ademas muerde en un caso
nuevo (M26).

**Ningun otro archivo del repo se ha tocado.** `git status` al cerrar: 8 nuevos + ese modificado.

---

## Por que una base de datos falsa que ejecuta, y no un mock

Un `vi.fn().mockResolvedValue([...])` responde lo mismo con `where` o sin `where`. Con eso,
quitarle el filtro de fecha a un repositorio no pone nada rojo, y el test pasa a describir la
implementacion en vez de exigirsela — que es el modo de fallo que la casa cuenta como asercion
vacia. `_fake-prisma-dinero.ts` filtra de verdad, agrupa de verdad y suma con `Prisma.Decimal`.
Tres detalles que lo hacen morder:

1. **Un operador que no entiende, lanza.** Si un repositorio filtrara con algo que el fake no
   implementa, el test explota; no pasa por la via de "no apliqué el filtro y salió bien".
2. **Sin `orderBy`, devuelve los grupos en orden INVERSO al de insercion.** Postgres no promete
   orden; una base falsa que lo prometiera dejaria pasar un repositorio sin `orderBy` (R28).
   Evidencia: M16.
3. **Registra cada llamada.** Asi un test puede juzgar la FORMA de la consulta (que tabla, que
   `where`) y no solo el numero — que es como se comprueba "sin cota inferior" sin depender de
   que las cifras coincidan por casualidad.

---

## Mapa `R<n> → test` (solo lo que esta sesion cubre)

| R | Que se exige | Test |
|---|---|---|
| **R16** | Σ de exactamente las categorias declaradas, ventana `[desde,hasta)`, material de `bruto`+`neto` | `financiera-ingresos-repo`: «`ingreso_flete` suma sus dos categorias y NO ve el ingreso_ajuste del mismo dia», «la ventana es semiabierta…», «`ingreso_comision_cod` (una sola categoria)…» |
| **R17** | Las categorias las manda el catalogo | `financiera-ingresos-repo`: «alterar `definicion.categorias` en memoria cambia lo que la consulta devuelve», «una metrica que declara categorias ajenas a la caja NO se sirve en silencio», «una metrica sin categorias no agrega el libro entero» |
| **R18** (parcial, material) | Las ocho `egreso_*`, incluida `egreso_indemnizacion` | `financiera-ingresos-repo`: «`egresos` ve sus ocho categorias, incluida la indemnizacion» |
| **R19** | Dos vistas separadas que no se suman | `financiera-recaudo-repo`: «el mensajero con ordenes de dos tiendas…», «cada metodo consulta SU tabla y solo la suya», «la clase no ofrece un tercer metodo que funda las dos vistas», «la vista por tienda toma la categoria del catalogo…» |
| **R21** | Saldo al corte, `< hasta` sin cota inferior | `financiera-cuentas-por-pagar-repo`: «un credito de hace tres meses SIGUE en el saldo de hoy», «y el `where` no tiene cota inferior…», «el corte por `hasta` SI es estricto…», «la cuenta por pagar a mensajeros hace lo mismo…» |
| **R25** | Los no resueltos no aportan importe | `financiera-recaudo-repo`: «un cierre `solicitado` con 500 en efectivo no suma nada», «un `rechazado` RESUELTO dentro del rango tampoco…», «y el MISMO cierre, una vez aprobado, si aporta», «sin ningun cierre aprobado…» |
| **R26** | Ledger por `fecha_movimiento`, cierre por `resuelto_at`, frontera CR de `resolverRango` | `financiera-ingresos-repo`: «la ventana es semiabierta…» (incluye el movimiento de las 22:00 CR de ayer); `financiera-recaudo-repo`: «el cierre se fecha por `resuelto_at`…» |
| **R14** | Ni un id de mensajero cruza la frontera | `financiera-cuentas-por-pagar-repo`: «ninguna fila lleva mensajeroId, ni siquiera como clave del groupBy» |
| **R28** | Orden estable y reproducible | Los tres archivos: «pide orden explicito por (categoria, tipo)…», «(tienda_id, tipo)…», «por tipo» |
| **R37** (material) | El repositorio entrega el desglose por `tipo`, no el neto ya restado | `financiera-ingresos-repo`: «el material del bruto y del neto llega desglosado por tipo» |
| **R30** | Solo consultas: la derivacion es del servicio | `financiera-repositorios.guardia`: «ninguno deriva…» + 3 autocomprobaciones |
| **R32** | Nada se silencia; el fallo se propaga | `financiera-repositorios.guardia`: «ninguno silencia un fallo de base…» + los CINCO «…deja subir el error tal cual» |
| **R4** (se conserva) | Lo que se consulta cabe en lo declarado | `financiera-correspondencia.guardia`: casos **(a)** por metrica/metodo y **(b)** por archivo |

**Sigue sin cubrir** (no es de esta tanda): R5, R6, R10-R13, R15, R18 (el estado, no el material),
R20, R22, R23, R24, R27 (la aritmetica del servicio), R29, R31, R33-R36 (ya cubiertos en B), R38-R43
en su parte de servicio, y todo el borde. El mapa completo lo cierra F.7.

---

## Evidencia de mutacion

Regla de casa: un test que no se pone rojo cuando se muta lo que dice medir es una asercion vacia.
**Cada** "hecho cuando" de C.1/C.2/C.3 se mato y se revivio. Toda mutacion se aplico sobre copia
pristina y se revirtio con `cmp` (verificacion byte a byte); las 14 dicen «revertido: identico byte
a byte». `git status` al cerrar no muestra ningun archivo rastreado modificado salvo el guardia
descrito en C4.

| # | Mutacion | Archivo mutado | Resultado |
|---|---|---|---|
| M13 | la consulta de `ingreso_flete` ve **ademas** `ingreso_ajuste` | Ingresos | **5 rojos** de 11 · revertido |
| M14 | el array de categorias se clava en el repositorio (deja de leer el catalogo) — **R17** | Ingresos | **6 rojos** de 11 · revertido |
| M15 | `gte: new Date(rango.desdeFecha)` (medianoche UTC) en vez de `rango.desde` — **R26** | Ingresos | **2 rojos** de 11 · revertido |
| M16 | se retira el `orderBy` — **R28** | Ingresos | **3 rojos** de 11 · revertido |
| M17 | el `where` acepta los cuatro estados de cierre, no solo `aprobado` — **R25** | Recaudo | **2 rojos** de 12 · revertido |
| M18 | `porMetodoDeCierresResueltos` **funde** el ledger de tienda en la cifra de efectivo — **R19** | Recaudo | **4 rojos** de 37 (recaudo + C.5 + correspondencia) · revertido |
| M19 | el cierre se fecha por `solicitado_at` — **R26 / ⟨D2b⟩** | Recaudo | **2 rojos** de 12 · revertido |
| M20 | se añade `>= rango.desde` a las dos cuentas por pagar — **R21** | CuentasPorPagar | **5 rojos** de 9 · revertido |
| M21 | `mensajeroId` entra en el `by` del groupBy — **R14** | CuentasPorPagar | **3 rojos** de 9 · revertido |
| M22 | `try { … } catch { return [{ suma: "0.00" }] }` — **R32** | CuentasPorPagar | **2 rojos** de 14 · revertido |
| M23 | la base falsa devuelve **siempre conjunto vacio** | `_fake-prisma-dinero` | **19 rojos** de 32 · revertido |
| M24 | el repo de cuentas por pagar consulta `cierre_dia`, que **ninguna** de sus dos metricas declara | CuentasPorPagar | **3 rojos** de 11 · revertido |
| M25 | el repo de ingresos consulta **ademas** `cierre_dia` (la mutacion original de B.3, M8) | Ingresos | **2 rojos** de 11 · revertido |
| M26 | se cruza la atribucion metodo→metrica dentro del propio guardia | guardia B.3 | **1 rojo** de 11 · revertido |

### «Ningun test pasa por conjunto vacio» — comprobado, no supuesto

Es el modo de fallo que mordio en la 122 y en la 123, asi que se ataca por tres vias:

1. **M23** es la prueba directa: con la base falsa devolviendo `[]` siempre, caen **19 de 32**
   tests de los tres archivos. Si los casos afirmaran cosas vacias, seguirian verdes.
2. Cada archivo tiene un bloque **«los tests de arriba no pasan por conjunto vacio»** que afirma
   (a) que el fixture tiene filas, (b) que las filas que deben quedar FUERA estan sembradas de
   verdad —el ajuste del mismo dia, el movimiento de las 22:00 CR de ayer, el del corte exacto,
   los cierres de los cuatro estados— y (c) que la consulta que las excluye devuelve filas con
   importe distinto de cero.
3. El censo de C.5 exige `>= 3` repositorios existentes y `> 500` bytes cada uno; el de
   correspondencia subio su ancla de `>= 0` a `>= 3`.

### Un hallazgo del propio ejercicio

M17 puso rojo **1** test la primera vez, no los tres que esperaba. Motivo: un cierre `solicitado`
no tiene `resuelto_at`, asi que la ventana temporal ya lo excluye **sin** el filtro por estado —el
"hecho cuando" de C.2, leido literalmente, mide menos de lo que parece. Lo que el `estado:
"aprobado"` de verdad compra es excluir los `rechazado` y `vencido` que **si** estan resueltos
dentro del rango. Se añadio el caso que lo mide («un `rechazado` RESUELTO dentro del rango tampoco»)
y se anoto en el test de dos fases que su "0.00" se sostiene por dos motivos independientes. Con
eso M17 pasa a 2 rojos.

---

## Verificacion (medida, no supuesta)

```
$ pnpm exec tsc --noEmit
(sin salida)  exit=0

$ pnpm exec eslint <los 8 archivos creados + el guardia modificado>
exit=0   (0 errores, 0 warnings)

$ pnpm exec vitest run tests/unit/analytics --maxWorkers=2
 Test Files  35 passed (35)
      Tests  556 passed (556)
```

Baseline de esta tanda, medido antes de empezar: **31 archivos / 508 tests, 0 rojos**. Ahora **35 /
556**: +4 archivos de test y +48 tests, **0 rojos, 0 workers caidos**. La corrida no reporto
*unhandled errors* ni arranques fallidos de fork; el conteo de archivos subio, que es la
comprobacion de que no esta degradada.

**Los cinco guardias de la TANDA B siguen verdes.** Cuatro sin tocarlos (B.1 fuente, B.2/B.4
alcance, B.5 produccion) — y los tres repositorios nuevos entraron solos a los censos de B.1 y B.2,
tal como el agente anterior habia previsto. El quinto (B.3 correspondencia) esta verde tras el
cambio descrito en C4.

---

## Supuestos tomados (numerados desde S10)

- **S10 · El repositorio de la caja VALIDA las categorias del catalogo y lanza; no las filtra.**
  Si `definicion.categorias` trajera un valor que `wallet_movimiento` no tiene, filtrarlo en
  silencio serviria una cifra corta sin que nada fallara. Lanzar es la unica opcion coherente con
  R32. Igual con la lista vacia: agregaria el libro entero bajo el nombre de una metrica concreta.
- **S11 · El repositorio de recaudo INTERSECA en vez de validar, y solo ahi.** `cod_recaudado` es
  la unica metrica que declara vocabulario de DOS fuentes a la vez (`efectivo`/`SINPE`/
  `transferencia` son columnas del cierre; `cod_recaudado` es categoria del ledger). Exigir que
  todo lo declarado sea del ledger haria imposible servir la metrica tal como el catalogo la
  define. Lo que si se exige es que la interseccion no quede vacia.
- **S12 · Las dos cuentas por pagar NO filtran por categoria.** Un saldo al corte es el libro
  entero hasta el corte, que es exactamente lo que `derivarSaldoTienda` y `derivarCuentaPorPagar`
  calculan para `/mi-wallet`. Las dos metricas declaran hoy TODAS las categorias de su enum, asi
  que un `categoria IN (...)` seria un no-op — y el dia que el enum gane un valor antes que el
  catalogo, dejaria de serlo en silencio y esta cifra descuadraria respecto de la que la tienda
  ve. Dos cifras del mismo dinero es el bug caro de esta feature (R20).
- **S13 · Los tres `total_*` del cierre son ESTRUCTURA, no vocabulario.** `porMetodoDeCierresResueltos`
  devuelve siempre tres filas en orden fijo (`efectivo`, `simpe`, `transferencia`) porque son
  columnas del snapshot, no valores de un enum. Por eso R17 no aplica ahi y el tipo
  `MetodoPagoCierre` de la interfaz de la TANDA A ya lo fijaba. Un metodo sin dinero sale como
  `"0.00"` en vez de omitirse, para que la vista tenga siempre los mismos tres cubos.
- **S14 · `?? new Prisma.Decimal(0)` no es un cero de error.** Aparece donde el tipo de Prisma
  admite `null` (un `aggregate` que no vio ni una fila). No hay ni un `try/catch` en los tres
  repositorios y el guardia de C.5 prohibe ademas el literal `"0.00"` en el codigo: el cero
  legitimo sale de formatear un `Decimal`, nunca de un valor por defecto.

---

## Contradicciones encontradas AL IMPLEMENTAR (numeradas desde C4)

### C4 · El guardia B.3 era INSATISFACIBLE para C.3 — resuelto subiendo su resolucion

`financiera-correspondencia.guardia.test.ts` mapeaba **metrica → ARCHIVO** y comparaba las tablas
de todo el archivo contra la declaracion de cada metrica. Eso funciona mientras las metricas que
comparten archivo comparten fuente (el de ingresos sirve cuatro y todas declaran
`wallet_movimiento`). Pero `design.md §3` define **un solo** `CuentasPorPagarAnaliticaRepository`
para las dos cuentas por pagar, y sus metricas declaran fuentes **disjuntas**:
`cuenta_por_pagar_tienda` → `wallet_tienda_movimiento`; `cuenta_por_pagar_mensajero` →
`pago_mensajero_movimiento`. Cualquier archivo que sirva a las dos consulta las dos tablas y por
tanto **infringe a las dos por construccion**. El propio mapa del guardia declaraba que esas dos
metricas comparten archivo: la condicion que afirmaba no podia cumplirla ninguna implementacion
legal. No es que mi codigo la violara; es que no existia codigo que la satisficiera sin contradecir
el design.

Salidas posibles: (a) partir el repositorio en dos —contradice `design.md §3` y la interfaz A.2, que
ya declara los dos metodos juntos y no es mia para rediseñar—; (b) relajar el guardia a la UNION de
las tablas declaradas por las metricas del archivo —eso si es aflojar: `cuenta_por_pagar_tienda`
podria leer el libro de mensajeros sin que nadie se enterase—; (c) subir la resolucion del guardia
de archivo a metodo. **Se tomo (c)**, y el guardia ahora comprueba DOS cosas en vez de una:

- **(a) por metodo** — lo que sirve a una metrica cabe en lo que esa metrica declara;
- **(b) por archivo** — el archivo entero cabe en la UNION de lo que declaran sus metricas, para
  que una consulta escondida en un helper de modulo (fuera de todo metodo) no se escape de (a).

Para los archivos de una sola fuente las dos son la comprobacion de antes, palabra por palabra.
**Que no es un aflojamiento, medido:** M25 —la mutacion original de B.3, «añadir `cierre_dia` al
repositorio de `ingreso_flete`»— sigue poniendo rojo (2 casos); M24 —una tabla que ninguna metrica
del archivo declara— pone rojo (3 casos); y M26 —cruzar la atribucion metodo→metrica— pone rojo un
caso que **antes no existia**. El guardia muerde mas que antes, no menos.

### C5 · El "hecho cuando" de C.2 sobre el cierre `solicitado` mide menos de lo que parece

Descrito arriba en la evidencia de mutacion (M17). No es un problema del spec, es una imprecision
del criterio: la exclusion del `solicitado` la hace la coordenada temporal, no el filtro de estado.
Cubierto añadiendo el caso del `rechazado` resuelto dentro del rango.

### Sobre C2 (R4 ↔ R23), que NO es mia

Durante esta sesion aparecio `progress/decision_C2_127.md`: el humano cerro C2 el 2026-08-02 con la
salida **(a)**, ampliando `conciliacion_cierres.fuente.tablas` con los tres ledgers (⟨D10⟩). **No he
tocado nada de eso**: ni `metrics.ts`, ni C.4, ni el test que fija la contradiccion. Dos notas para
quien haga C.4:

1. El cambio de C4 (resolucion por metodo) es **ortogonal** a ⟨D10⟩ y no estorba: con el catalogo
   ampliado, la comprobacion (b) del guardia acepta los tres ledgers en ese archivo y la (a) los
   acepta en el metodo que los consulte. B.3 quedara verde **por construccion**, como pide la
   decision, no por exencion.
2. El test «el ledger que R23 quiere cruzar NO cabe hoy…» sigue **verde y sin tocar** porque el
   catalogo aun no se ha ampliado. Al aplicar ⟨D10⟩ hay que **darlo vuelta**, no borrarlo, tal como
   la decision indica.

---

## Lo que NO se ha hecho

- **C.4** entera (bloqueada por decision humana hasta esta sesion; ahora desbloqueada por ⟨D10⟩,
  pero fuera del alcance encargado).
- **C.5** solo esta hecha en su mitad: el censo y los cinco tests de propagacion cubren los tres
  repositorios que existen. Cuando nazca el de conciliacion entra solo al censo (`existentes()` lo
  descubre por ruta) y hay que añadir sus metodos a la lista de propagacion, que hoy afirma
  `toHaveLength(5)` justamente para obligar a mirarla.
- Tandas **D, E y F**. `egresos` sigue `"declarada"` en el catalogo: D.6 se hace cuando el servicio
  exista, no antes (el guardia B.5 se pone rojo si alguien lo adelanta).
