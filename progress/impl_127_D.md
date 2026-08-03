# impl_127_D — analitica financiera · C.4, el resto de C.5 y la TANDA D entera

Rama: `feature/127-analitica-financiera-servicios` · worktree `ordenex-wt-127`.
Sesion del **2026-08-02**. Continua `progress/impl_127.md` (tandas 0/A/B, `92134879`) y
`progress/impl_127_C.md` (C.1–C.3 + media C.5, `fb4d98b5`).

**Alcance de esta sesion:** **C.4**, la mitad que faltaba de **C.5** y **D.1–D.9**.
**Fuera de alcance y NO tocado:** TANDA E (el borde) y TANDA F (integracion y cierre).

---

## Lo que desbloqueo esta sesion: ⟨D10⟩

`progress/decision_C2_127.md` (humano, 2026-08-02) cerro la contradiccion **C2** con la salida
(a): `conciliacion_cierres.fuente.tablas` se amplia con los tres ledgers. Con eso el guardia B.3
queda verde **por construccion** —no lleva exencion, y sigue sin llevarla— y C.4 se pudo escribir.

---

## Archivos

### Creados (6)

| Archivo | Que es |
|---|---|
| `lib/repositories/ConciliacionCierresAnaliticaRepository.ts` | **C.4** — las CINCO tablas del universo. Cuatro consultas de cierre (aprobados por `resuelto_at`, el resto por `solicitado_at`, en los dos niveles), el `findMany` de los snapshots aprobados y las tres agregaciones de ledger por `origen_tipo`/`origen_id`. |
| `lib/services/AnaliticaFinancieraService.ts` | **D.1–D.9** — la unica fachada: valida dominio, despacha por `metrica.id`, deriva con las tres funciones money-safe compartidas y emite el descuadre por el `ErrorLogger` sin lanzar. |
| `tests/unit/analytics/financiera-conciliacion-repo.test.ts` | Los "hecho cuando" de C.4 (20 tests). |
| `tests/unit/services/_dobles-analitica-financiera.ts` | Dobles de los cuatro repositorios + `consultaDe`. **No es un test** (no lo recoge `include`). |
| `tests/unit/services/analitica-financiera-service.test.ts` | D.1, D.3, D.4, D.5, D.8, D.9 (20 tests). |
| `tests/unit/services/analitica-financiera-derivacion.test.ts` | D.2 (11 tests). |
| `tests/unit/services/analitica-financiera-conciliacion.test.ts` | D.7 (17 tests). |

### Modificados (5)

| Archivo | Cambio |
|---|---|
| `lib/analytics/metrics.ts` | **AJENO.** Las DOS entradas autorizadas y nada mas. Diff completo abajo. |
| `lib/interfaces/repositories/IConciliacionCierresAnaliticaRepository.ts` | `TotalLedgerPorOrigenCierre` gana `tipo` (supuesto **S15**). |
| `tests/unit/analytics/_fake-prisma-dinero.ts` | **Ampliada, no reemplazada:** `cierre_bodega`, `origen_tipo`/`origen_id` en las tres filas de ledger, `mensajeroId` opcional en los cierres y la operacion `findMany` con `select`. Ademas se endurece: agrupar por una columna que la fila no tiene ahora LANZA. |
| `tests/unit/analytics/financiera-correspondencia.guardia.test.ts` | El test de la contradiccion **dado vuelta** (no borrado) + el ancla de repositorios sube de «>= 3» a «los cuatro». |
| `tests/unit/analytics/financiera-repositorios.guardia.test.ts` | **C.5 completa:** censo de los cuatro repositorios y lista de propagacion de 5 a **8** metodos. |

---

## `lib/analytics/metrics.ts` — el diff entero, para que se lea de un vistazo

```diff
@@ -461,7 +461,7 @@ const CATALOGO = [
     unidadDeConteo: "moneda",
     // `declarada`: la ficha de la 127 compromete ingresos, cuentas por pagar y
     // conciliacion de cierres; los egresos NO aparecen ahi.
-    estadoProduccion: "declarada",
+    estadoProduccion: "producida",
     granos: ["fecha"],
     fuente: { tipo: "ledger", tablas: ["wallet_movimiento"] },
     alcance: ALCANCE_FINANCIERA,
@@ -534,7 +534,19 @@ const CATALOGO = [
     unidadDeConteo: "moneda",
     estadoProduccion: "producida",
     granos: ["fecha"],
-    fuente: { tipo: "snapshot_cierre", tablas: ["cierre_dia", "cierre_bodega"] },
+    // ⟨D10⟩ humano, 2026-08-02 (`progress/decision_C2_127.md`): los TRES ledgers se declaran
+    // aqui ademas de los dos cierres, porque R23 de la 127 concilia el snapshot aprobado
+    // CONTRA el dinero realmente movido (`origen_tipo = cierre_dia`).
+    fuente: {
+      tipo: "snapshot_cierre",
+      tablas: [
+        "cierre_dia",
+        "cierre_bodega",
+        "wallet_movimiento",
+        "wallet_tienda_movimiento",
+        "pago_mensajero_movimiento",
+      ],
+    },
     alcance: ALCANCE_FINANCIERA,
     // `definicion` sin `categorias` A PROPOSITO: los cuatro estados de cierre viven en el
```

Las dos cosas autorizadas, ninguna mas: ni etiqueta, ni grano, ni alcance, ni otra metrica.
⟨D8⟩ (2026-08-02) → `egresos: "producida"`, hecha **cuando el productor ya existe**.
⟨D10⟩ (2026-08-02) → los tres ledgers en `conciliacion_cierres`.
**Las dos autorizaciones viajan al cuerpo del PR.** La suite de la 135
(`tests/unit/analytics/metrics*.test.ts`, 2 archivos / 51 tests) sigue en **0 rojos**.

> ⚠ El comentario que hay **encima** de `estadoProduccion` en `egresos` («la ficha de la 127
> compromete ingresos, cuentas por pagar y conciliacion; los egresos NO aparecen ahi») ha quedado
> desactualizado. **No se toco a proposito**: la autorizacion acota el diff a esas dos cosas y
> `tasks.md` D.6 exige «exactamente una linea». Queda anotado como **C6**.

---

## Mapa `R<n> → test` (solo lo que esta sesion cubre)

| R | Que se exige | Test |
|---|---|---|
| **R4** | Lo que la conciliacion consulta cabe en lo que ⟨D10⟩ declara | `financiera-correspondencia.guardia`: casos (a)/(b) + «los tres ledgers que R23 cruza SI estan declarados» + «el guardia sigue mordiendo» |
| **R5** | Dominio invalido = error explicito | `analitica-financiera-service`: «pedir `entregas` devuelve dominio_invalido», «ninguna metrica operativa se cuela por una rama por defecto» |
| **R6** | Las ocho, ni una de mas ni una de menos | `analitica-financiera-service`: «falla por DEFECTO», «falla por EXCESO», «los dos conjuntos son el mismo», «las ocho responden ok de verdad» |
| **R10** | Si no se sirve, no se consulta | `analitica-financiera-service`: «NINGUN repositorio recibe una sola llamada» + «el espia si cuenta cuando la metrica SI es financiera» |
| **R14** | Ni un id de mensajero cruza | `financiera-conciliacion-repo`: «de un cierre sale su id, nunca su mensajero_id» + el `select` de dos columnas; `analitica-financiera-derivacion`: «no hay ni un cubo»; `analitica-financiera-conciliacion`: «`cierresDescuadrados` lleva ids de CIERRE» |
| **R18** | `egresos` producida, con la indemnizacion | `analitica-financiera-service`: «una `egreso_indemnizacion` en el rango entra en la cifra», «no existe ningun camino que devuelva `no_producida`» |
| **R20** | Reuso de las tres funciones money-safe | `analitica-financiera-derivacion`: «el servicio la LLAMO: la resta no esta reescrita aqui» (×3, con los argumentos) + los tres casos de valor |
| **R22** | Dos niveles por separado, conteo y `total_*` | `financiera-conciliacion-repo`: «el cierre_bodega que consolida dos cierre_dia NO duplica el dinero», «cada grupo trae su conteo y sus CUATRO totales», «los cuatro estados aparecen»; `analitica-financiera-conciliacion`: «las filas llegan enteras, sin fundir niveles» |
| **R23** | Cruce por `origen_tipo`/`origen_id`, no por ventana | `financiera-conciliacion-repo`: «un ajuste manual dentro del rango NO entra», «un movimiento con origen en un cierre AJENO tampoco», «el `where` del cruce nombra el origen y NO tiene ventana temporal»; `analitica-financiera-conciliacion`: «los movimientos del MISMO origen que no son COD no mueven el cuadre», «los ids que se le piden al ledger salen de los cierres aprobados» |
| **R24** | Se emite, nunca se lanza | `analitica-financiera-conciliacion`: «descuadrado: llega el DTO Y hay UNA llamada», «la consulta NUNCA lanza por un descuadre» |
| **R25** | Los no resueltos no aportan dinero pero se ven | `financiera-conciliacion-repo`: «el cierre `solicitado` llega con fechadoPor: solicitado_at»; `analitica-financiera-conciliacion`: «el cierre solicitado se VE con sus 900, y no entra en el cuadre» |
| **R26** | Doble coordenada temporal, frontera CR | `financiera-conciliacion-repo`: «un aprobado resuelto AYER no entra», «un rechazado solicitado AYER no entra», «el corte por `hasta` es estricto» |
| **R27** | STRING escala 2, aritmetica Decimal | `analitica-financiera-derivacion`: «0.10 + 0.20 da exactamente 0.30», «un total de siete digitos no pierde centimos», «ningun importe del DTO es un number» |
| **R28** | Determinismo y orden estable | `financiera-conciliacion-repo`: los tres casos de orden; `analitica-financiera-service`: «dos ejecuciones de cod_recaudado producen la misma secuencia», «ningun archivo usa el reloj ni el azar» |
| **R29** | La moneda sale de `lib/config/moneda.ts` | `analitica-financiera-service`: «todo importe servido lleva el codigo configurado», «ningun archivo escribe un simbolo o un codigo a mano» |
| **R30/R32** | Repositorios sin derivacion ni silencio; el error sube | `financiera-repositorios.guardia`: censo de los CUATRO + los **ocho** metodos «deja subir el error tal cual» |
| **R31** | Inyeccion por interfaz, sin base | `analitica-financiera-service`: «el entorno de estos casos NO tiene DATABASE_URL, y el servicio igual responde» + «no importa el cliente de la base» |
| **R37** | `bruto` y `neto`, y el neto por signo agregado | `analitica-financiera-derivacion`: «el par pago + contraasiento se CANCELA en el neto y se VE en el bruto», «la tienda deudora … el bruto no es el neto» |
| **R38** | Las dos vistas de `cod_recaudado`, no sumables | `analitica-financiera-service`: «llegan con ids distintos y `sumableCon` vacio en las dos» |
| **R39** | Cada fila declara su coordenada | `financiera-conciliacion-repo`: «el `aprobado` llega con fechadoPor: resuelto_at, y los no resueltos nunca»; `analitica-financiera-conciliacion`: «…y la fecha de cada fila» |
| **R40** | El umbral vive en un solo archivo y se lee | `analitica-financiera-conciliacion`: «bajo umbral: … NO hay ninguna llamada», «el umbral por defecto es el de lib/config», «con un umbral mas alto ese mismo centimo NO se emite» |
| **R41** | Catalogo ↔ produccion no se desincronizan | `financiera-produccion.guardia` (fase 2, activada sola al existir el servicio) + `analitica-financiera-service`: «ya no esta marcada como declarada sin productor» |
| **R43** | `esAcumulado` exacto | `analitica-financiera-service`: «el mapa de las ocho es el esperado, escrito a mano» |

**Sigue sin cubrir** (es de E y F): R11, R12, R13, R15, R42 y la parte de integracion de R1–R3,
R16, R19, R21, R33–R36. El mapa completo `R1..R43` lo cierra **F.7**.

---

## Evidencia de mutacion (M27–M51)

Regla de casa: un test que no se pone rojo cuando se muta lo que dice medir es una asercion
vacia. Toda mutacion se aplico sobre copia pristina y se revirtio con `cmp`; **las 25 dicen
«revertido: identico byte a byte»**, y `git status` al cerrar no muestra ningun archivo
rastreado modificado fuera de los cinco de la tabla de arriba.

### C.4 — el repositorio de la conciliacion (20 tests en el archivo)

| # | Mutacion | Requisito | Resultado |
|---|---|---|---|
| M27 | los dos niveles se funden (`NIVELES = [cierre_dia, cierre_dia]`) | R22 | **4 rojos** de 20 |
| M28 | los aprobados se fechan por `solicitado_at` | R26 / ⟨D2b⟩ | **6 rojos** de 20 |
| M29 | los NO resueltos se fechan por `resuelto_at` | R26 / ⟨D4b⟩ | **5 rojos** de 20 |
| M30 | el lado ledger se filtra por VENTANA en vez de por origen | R23 | **7 rojos** de 20 |
| M31 | `fechadoPor` clavado a `"resuelto_at"` en todas las filas | R39 | **2 rojos** de 20 |
| M32 | el `findMany` pierde el `select` y se lleva el cierre entero | R14 | **1 rojo** de 20 |
| M33 | se retiran los TRES `orderBy` | R28 | **7 rojos** de 20 |
| M34 | se quita el atajo de lista vacia (consulta con `in: []`) | R23/R10 | **1 rojo** de 20 |

### El catalogo y los guardias

| # | Mutacion | Guardia | Resultado |
|---|---|---|---|
| M35 | ⟨D10⟩ **revertido**: `conciliacion_cierres` vuelve a declarar solo los dos cierres | B.3 correspondencia | **4 rojos** de 580 (`tests/unit/analytics`) |
| M37 | el repositorio de la caja consulta **ademas** `cierre_bodega` | B.3 correspondencia | **2 rojos** de 12 — el guardia sigue mordiendo tras el cambio de C.4 |
| M48 | ⟨D8⟩/D.6 **revertido**: `egresos` vuelve a `"declarada"` con el servicio sirviendola | B.5 produccion | **3 rojos** de 2693 |

### TANDA D — el servicio (48 tests en tres archivos)

| # | Mutacion | Requisito | Resultado |
|---|---|---|---|
| M38 | se borra la comprobacion de dominio y el despacho gana rama por defecto | R5/R10 | **3 rojos** de 2113 |
| M39 | `deSaldoDeTiendas` resta a mano en vez de llamar a `derivarSaldoTienda` | R20 | **1 rojo** de 2113 |
| M40 | el `neto` de la caja copia el `bruto` | R37 | **3 rojos** de 2113 |
| M41 | se borra `ingreso_iva` del despacho (**por defecto**) | R6 | **6 rojos** de 2113 |
| M42 | se añade `margen_bruto` al despacho (**por exceso**) | R6 | **2 rojos** de 2113 |
| M43 | `esAcumulado: true` para todas | R43 | **1 rojo** de 2113 |
| M44 | `moneda: "CRC"` escrito a mano | R29 | **1 rojo** de 2113 |
| M45 | la conciliacion LANZA en vez de emitir | R24 | **7 rojos** de 2113 |
| M46 | se ignora el umbral y se emite ante cualquier descuadre | R40 | **2 rojos** de 2113 |
| M47 | el cuadre suma TODO el ledger en vez del credito de tienda | R23 | **8 rojos** de 2113 |
| M49 | el servicio importa `PrismaClient` | R31 | **1 rojo** de 2113 |
| M50 | los cubos se ordenan con `Math.random()` | R28 | **2 rojos** de 2113 |

### «Ningun test pasa por conjunto vacio» — comprobado, no supuesto

Es el modo de fallo que mordio en la 122 y en la 123. Se repite el ejercicio de M23 incluyendo
los tests nuevos, por los dos lados de la frontera:

| # | Mutacion | Resultado |
|---|---|---|
| M36 | la **base falsa** (`_fake-prisma-dinero`) devuelve SIEMPRE conjunto vacio | **36 rojos de 52** en los cuatro archivos de repositorio |
| M51 | los **dobles del servicio** devuelven SIEMPRE conjunto vacio | **25 rojos de 48** en los tres archivos de servicio |

Ademas, cada archivo nuevo cierra con un bloque «los tests de arriba no pasan por conjunto
vacio» que afirma que las filas que deben quedar FUERA estan sembradas de verdad: el aprobado
resuelto ayer, el rechazado solicitado ayer, el cierre resuelto justo en el corte, el ajuste
manual con `origen_id NULL`, el movimiento con origen en un cierre ajeno y el ruido de los otros
dos libros en el cuadre.

---

## Verificacion (medida, no supuesta)

```
$ pnpm exec tsc --noEmit
(sin salida)  exit=0

$ pnpm exec eslint <los 7 archivos creados + los 5 modificados>
exit=0   (0 errores, 0 warnings)

$ pnpm exec vitest run tests/unit/analytics --maxWorkers=2
 Test Files  36 passed (36)
      Tests  580 passed (580)

$ pnpm exec vitest run tests/unit/services --maxWorkers=2
 Test Files  128 passed (128)
      Tests  2113 passed (2113)

$ pnpm exec vitest run tests/unit/analytics/metrics.test.ts tests/unit/analytics/metrics-dinero.guardia.test.ts
 Test Files  2 passed (2)
      Tests  51 passed (51)
```

### La suite completa

```
$ pnpm exec vitest run --maxWorkers=2
 Test Files  1 failed | 790 passed (791)
      Tests  1 failed | 9615 passed (9616)
   Duration  739.99s
```

El unico rojo es `tests/integration/wallet-tiendas-desglose.test.tsx > R5 … el fallo se cuenta
DENTRO de esa fila` con `Test timed out in 20000ms`. **No es una regresion:** es una prueba de
componente de la wallet de tiendas, no toca ningun archivo de esta feature, y **pasa en aislado**
(`30 passed`, 7.27s). Es el patron de saturacion ya conocido del repo. El conteo de archivos
—791, contra los **778** del baseline de la rama mas los 13 que llevan las tandas A/B/C/D— confirma
que la corrida no esta degradada.

Baselines medidos **antes** de empezar esta sesion: `tests/unit/analytics` **35 archivos / 556
tests, 0 rojos**; `tsc --noEmit` en 0. Ahora **36 / 580** (+1 archivo, +24 tests) y **128 / 2113**
en servicios (+3 archivos, +48 tests). Ninguna corrida reporto *unhandled errors* ni arranques
fallidos de fork, y el conteo de archivos subio en las dos — que es la comprobacion de que no
estan degradadas.

**Los cinco guardias de la TANDA B siguen verdes.** B.1 (fuente) y B.2/B.4 (alcance) sin tocarlos:
el repositorio y el servicio nuevos entraron solos a sus censos. B.3 (correspondencia) verde **por
construccion** gracias a ⟨D10⟩, con el test de la contradiccion dado vuelta y dos mutaciones que
confirman que sigue mordiendo (M35, M37). B.5 (produccion) paso solo a su **fase 2** al aparecer
`lib/services/AnaliticaFinancieraService.ts` y exige ahora que **ninguna** financiera quede
`declarada`; D.6 la satisface y M48 prueba que muerde.

---

## Supuestos tomados (numerados desde S15)

- **S15 · `TotalLedgerPorOrigenCierre` gana el campo `tipo`, y sin el R23 es insatisfacible.**
  El contrato de la TANDA A devolvia `{ ledger, cierreId, suma }`. Un cierre aprobado deja en
  `wallet_tienda_movimiento` el CREDITO del COD recaudado **y** los debitos de flete, comision e
  IVA, todos con el mismo `origen_id`: la Σ de todo eso no puede compararse con `total_general`,
  que solo mide el COD. Sin desglose por direccion, cualquier cuadre que se escribiera seria
  falso. Los tres libros tienen un `tipo` binario, asi que el campo es uniforme y no inventa
  vocabulario. Es la unica desviacion del contrato de la TANDA A en esta sesion.
- **S16 · Las metricas cuyo unico grano es `fecha` se sirven SIN `filas`, con solo el `total`.**
  `DimensionAnalitica` no tiene un valor «categoria», y `design.md §6` especifica que la caja se
  agrega por categoria sobre la ventana entera, no por dia. Publicar las categorias como cubos de
  un grano `fecha` seria mentir sobre que dimension se esta cortando, y publicar una fila unica
  con `cubo = desdeFecha` afirmaria que todo el dinero se movio ese dia. Afecta a `ingreso_flete`,
  `ingreso_comision_cod`, `ingreso_iva`, `egresos` y `cuenta_por_pagar_mensajero`. Servir el corte
  por dia de verdad exige que el repositorio agrupe por fecha: es un cambio de C.1/C.3, no del
  servicio, y no esta en el design.
- **S17 · El cuadre compara `total_general` contra el CREDITO de `wallet_tienda_movimiento`.**
  Es la unica cifra del ledger que mide el mismo hecho que el snapshot: el COD que el mensajero
  entrego y que se acredita a las tiendas. La caja principal recibe el ingreso de Ordenex y el
  libro de mensajeros el devengo — otras cifras. `S8` de la tanda anterior dejo la decision al
  servicio precisamente para poder tomarla aqui; el repositorio sigue entregando los tres libros
  desglosados, asi que cambiarla no toca la capa de datos. Un cuadre contra los tres libros
  declararia un descuadre permanente, y un aviso que suena todos los dias es un aviso que alguien
  apaga.
- **S18 · El despacho del servicio es un `Record<string, Manejador>` y NO un
  `Record<MetricaFinancieraId, …>`.** Tipar las claves convertiria «sobra una metrica» y «falta
  una metrica» en errores de compilacion, y R6 pide un TEST que falle por exceso y por defecto.
  Con el mapa abierto las dos direcciones se miden de verdad (M41 y M42 lo prueban); con el mapa
  cerrado, el test seria decorativo y la garantia dependeria de que alguien leyera el error de
  `tsc`. La rama «id financiero sin manejador» **lanza** con mensaje explicito: no es una rama
  permisiva, es el caso que R41 y el guardia B.5 ya vigilan por otro lado.

---

## Contradicciones y puntos abiertos encontrados AL IMPLEMENTAR (desde C6)

### C6 · El comentario de `egresos` en el catalogo quedo desactualizado — NO se toco

Encima de `estadoProduccion` sigue diciendo «la ficha de la 127 compromete ingresos, cuentas por
pagar y conciliacion de cierres; los egresos NO aparecen ahi». Con ⟨D8(b)⟩ eso ya no describe la
realidad. **No se corrigio a proposito**: la autorizacion de `progress/decision_C2_127.md` acota
el diff de `metrics.ts` a exactamente dos cambios y `tasks.md` D.6 exige «exactamente una linea».
Corregir prosa dentro de un archivo ajeno bajo autorizacion acotada es justo el tipo de retoque
de paso que la decision quiere impedir. **Pendiente de una linea de visto bueno humano**; hasta
entonces queda aqui, a la vista, en vez de arreglado en silencio.

### C7 · `derivarCuentaPorPagar` no sabe expresar una cuenta por pagar NEGATIVA

`lib/utils/cuenta-por-pagar.ts` documenta (R16 de la 44) que en el flujo normal la cuenta nunca
es negativa, y su `signo` solo tiene `"positivo" | "cero"`. Pero el importe si puede salir
negativo (`dev.sub(pag)` con mas pagos que devengos, p.ej. una liquidacion adelantada), y en ese
caso devolveria `cuentaPorPagar: "-100.00"` con `signo: "cero"`. La 127 **no lo corrige** —seria
tocar la funcion compartida de la 44, con sus propios tests y consumidores— y **no lo esconde**:
sirve el `cuentaPorPagar` tal cual, que es el numero correcto. El `signo` no viaja al DTO
financiero, asi que la incoherencia no cruza esta frontera. Queda anotado por si la 44 lo revisa.

### Sin novedad sobre el rollup y sobre el alcance del dinero

Nada de C.4 ni de la TANDA D empujo a leer `analytics_daily` (R42 de la 124, guardia B.1) ni a
escribir un adaptador de alcance para las tablas de dinero (R25 de la 122, guardia B.2/B.4). La
ausencia de ese adaptador sigue siendo deliberada y los dos guardias siguen verdes sin tocarlos.

---

## Lo que NO se ha hecho

- **TANDA E** entera: `lib/actions/analitica-financiera.ts`, los tres pasos del borde, el 400 vs
  403, el cuerpo generico de ⟨D9⟩ y el barrido de identidad sobre la cadena serializada.
- **TANDA F** entera: integracion contra base de test, las cuatro fronteras (horaria, de cierre,
  de anulacion y de cierre pendiente), el mapa `R1..R43` completo (F.7) y el PR (F.8).
- **Nota para quien haga F.8:** el merge con `dev` tiene que mirar `lib/analytics/metrics.ts` con
  cuidado —es archivo ajeno, fuente unica de trece features— y el cuerpo del PR tiene que citar
  las **dos** autorizaciones fechadas: ⟨D8⟩ y ⟨D10⟩, ambas del 2026-08-02.
