# Feature 203 — el gate da rojos espurios por timeout bajo carga

Rama `chore/deuda-203-cabos`. Fecha de la medicion: **2026-08-12**.

**Veredicto en una linea:** el `testTimeout` de 20s NO era el problema y NO se toca; el problema
era la **concurrencia** (`maxWorkers` 11 sobre 6 nucleos fisicos), y bajarla a 8 deja el techo de
la suite en ~5s de forma estable y sin coste de reloj.

---

## 1. Lo que se midio ANTES de tocar nada

### 1.1 Maquina y concurrencia de hoy

| dato | valor |
| --- | --- |
| CPU | Intel i5-11400H — **6 nucleos fisicos / 12 hilos logicos** |
| RAM | 39,7 GB (nunca bajo de 14 GB libres en ninguna corrida) |
| node | v24.13.0 · win32 |
| vitest | **4.1.10** |
| pool | `forks` (default de vitest 4) |
| `isolate` | `true` (default) → **cada archivo estrena proceso**: 1067 spawns por corrida |
| `maxWorkers` hoy | **no estaba configurado** → default `max(availableParallelism()-1, 1)` = **11** |
| suite | 1067 archivos / 13.365 tests |

El default se leyo del codigo instalado, no de la documentacion:
`node_modules/vitest/dist/chunks/cli-api.BK8pd4xc.js:3765` → `resolveMaxWorkers()`.

O sea: **11 procesos node compitiendo por 6 nucleos reales**, y `isolate: true` no reutiliza
runners nunca (`cli-api…js:3581`, `if (task.isolate) throw new Error("Isolated tasks should not
share runners")`). Ademas el teardown se lanza y **no se espera** hasta el final de la corrida
(comentario literal en `cli-api…js:3481`), asi que los procesos que se apagan se acumulan encima
de los que arrancan.

### 1.2 Distribucion real de duracion (suite completa, corrida limpia)

`Duration 335,65s (transform 77,24 · setup 122,82 · import 1092,70 · tests 843,79 · environment 879,47)`

Lo que mide `testTimeout` es el **test individual**, no el archivo. Distribucion de los 13.364:

| banda | tests | % |
| --- | --- | --- |
| 0-1s | 13.219 | 98,91 % |
| 1-2s | 110 | 0,82 % |
| 2-5s | 33 | 0,25 % |
| 5-10s | 2 | 0,01 % |
| 10-20s | 0 | 0 % |
| >20s | 0 | 0 % |

**Techo real: 6,00s** → margen 3,3x contra el limite de 20s.

Archivos mas lentos (wall del archivo, que NO es lo que corta el timeout):
`RepartoModule` 32,6s · `SatelitePaginacion` 25,0s · `ApiKeysModule` 22,0s · `usuario-form` 18,8s ·
`LoginForm` 17,2s · `date-range-filter` 16,6s · `PostulacionForm` 16,1s.

### 1.3 Los tres sospechosos, dentro de la suite sana

| archivo | wall en suite | test mas lento del archivo |
| --- | --- | --- |
| `TableroOperativo` | 7,53s (n=50) | **1,49s** |
| `wallet-tiendas-desglose` | 8,87s (n=30) | **1,72s** |
| `no-embalaje` | 0,81s (n=1) | 0,81s |

Es el dato que descarta la hipotesis facil: para que un test de 1,5s toque los 20s hace falta un
factor **12x**, no "un poco de contencion".

### 1.4 Cuanto influye la carga, medido de verdad

Se corrieron los sospechosos + los tres archivos mas pesados **con 12 procesos quemando CPU en
paralelo** (`hog.cjs`), y se comparo test a test contra la corrida sana (103 tests comparables):

| | factor |
| --- | --- |
| mediana | **1,69x** |
| p90 | **2,63x** |
| **maximo** | **3,35x** |

Test mas lento alcanzado bajo esa carga adversarial: **7,59s** → todavia 12,4s de margen.
Ninguno llego a 20s.

**Conclusion parcial: la contencion ordinaria de CPU no explica los rojos observados.**

### 1.5 El fallo de workers SI se reproduce, y es otro animal

Corriendo la suite con **un solo core extra ocupado**, el techo salto de 6,00s a **13,58s**
(2,26x) y aparecieron 5 tests en la banda 10-15s y 19 en la 5-10s, contra 2 en total en la
corrida limpia. Los que se disparan son siempre los mismos: `usuario-form`, `PostulacionForm`,
`SatelitePaginacion`, `LoginForm`.

Muestreando procesos cada 5s durante esa corrida: **34 procesos node vivos a la vez** con
`maxWorkers=11` — 23 mas que los workers, que son los que se estan apagando sin que nadie los
espere. Memoria libre minima 14,4 GB: **el cuello no es RAM, son procesos**.

Y el detalle que cierra el caso: los mensajes `Timeout waiting for worker to respond` /
`Failed to start forks worker` **no los gobierna `testTimeout`**. Salen de
`cli-api…js:3464-3465`, con `WORKER_START_TIMEOUT = 9e4` (90s), constante y **no configurable**.
Un archivo que reporta horas es un worker que no arranco, no un test lento. **Subir
`testTimeout` no habria arreglado nada de eso; solo habria tardado mas en decirlo.**

---

## 2. El barrido de configuraciones

Suite completa en cada fila. "Techo" = test individual mas lento de toda la corrida.

| `maxWorkers` | wall (s) | techo | tests >5s | procesos node pico |
| --- | --- | --- | --- | --- |
| 11 (default, limpio) | 286 / 336 | 5,8 / 6,0s | 1-2 | 22 |
| 11 (default, +1 core ocupado) | 457 | **13,6s** | 24 | **34** |
| **8 (elegido)** | 304 / 343 / 321 | **4,7 / 5,3 / 5,2s** | **0-1** | **19** |
| 6 | 553 | 4,8s | 0 | — |

Trabajo agregado (suma de transform+setup+import+tests+environment, que mide el coste real
pagado y no el reloj): **3016s con 11** contra **2018s con 8**. Un tercio del trabajo con 11
workers era contencion pura.

### Por que 8 y no otro numero

- **No es un redondeo, es donde estan las dos curvas.** 8 es el unico punto que mejora las **dos**
  cosas a la vez: techo (6,0 → 4,7s) y reloj (304s contra 286-336s de 11, dentro de la propia
  varianza de 11). No hay compromiso que negociar.
- **11 no se sostiene**: es el unico valor que produjo un techo de dos cifras, y le basto **un**
  core extra ocupado. Con 13,6s el margen contra el limite es 1,5x — y una maquina con el `next
  dev` abierto o dos agentes trabajando esta exactamente ahi. Ese es el rojo espurio.
- **6 se descarta por caro**: baja el techo lo mismo (4,8s) pero cuesta **+62% de reloj** (553s
  contra 343s) porque deja el hardware parado (paralelismo efectivo 4,97x sobre 12 hilos).
  El arnes existe para no ser una sala de espera.
- **La proporcion es 2/3 de los hilos logicos** (12 → 8), escrita como formula y no como un `8`
  literal para que otra maquina no quede sobre-suscrita.

### Por que NO se toca `testTimeout` (se reviso y se dejo en 20s)

Con la concurrencia ya corregida, el techo de la suite es **4,7-5,3s**, o sea **3,8-4,3x de
margen**. Y aplicando el peor factor de degradacion que se consiguio provocar (3,35x):
**5,3 × 3,35 = 17,8s**, que **sigue cabiendo en 20s**.

- Subirlo no arregla el modo de fallo grave (lo gobierna `WORKER_START_TIMEOUT`, 90s, fijo) y
  solo consigue que un cuelgue real tarde mas en dar la cara — el riesgo que el encargo pedia
  evitar explicitamente.
- Bajarlo se come el margen de contencion que la medicion dice que hace falta.

### Lo que se descarto a proposito

`isolate: false` eliminaria casi todo el churn de procesos (es la causa raiz de los 1067 spawns)
y seria mucho mas rapido, **pero comparte el registro de modulos entre archivos del mismo
worker**. En una suite de 1067 archivos llena de `vi.mock` y de guardias que barren el arbol, eso
es una fabrica de falsos verdes y de acoplamientos invisibles — justo la enfermedad que esta
feature intenta curar. No se toca sin un estudio propio.

---

## 3. Hallazgo secundario (no bloqueante, pero conviene anotarlo)

La cola lenta esta **concentrada en ~6 archivos**, todos React Testing Library + `userEvent`:
`usuario-form`, `PostulacionForm`, `SatelitePaginacion`, `LoginForm`, `RepartoModule`,
`ApiKeysModule`. Son los que aportan practicamente todos los tests por encima de 5s y los que se
disparan primero bajo carga. La configuracion ya los deja con margen sobrado, pero si el techo
vuelve a subir, **el sitio donde mirar son esos seis archivos**, no el timeout.

---

## 4. Cabo suelto: el ancla de `liquidacion-caja-puerto.test.ts`

### El diagnostico, medido

`tests/unit/services/liquidacion-caja-puerto.test.ts:105` anclaba en
`codigo.indexOf("constructor(")`, y en `LiquidacionService.ts` hay **cuatro clases de error con
constructor propio por delante**. Medido sobre el fuente ya sin comentarios:

| corte | lineas abarcadas | clases que se traga |
| --- | --- | --- |
| ancla actual (`constructor(`) | **109** | `YaAnuladoError`, `RepartoRepetidoError`, `ImputacionRepetidaError`, `LiquidacionService` |
| ancla correcta (`export class`) | **13** | ninguna |

**96 lineas ajenas** dentro de la asercion.

### La demostracion: hoy no hay falso verde, pero esta a UNA edicion de distancia

| mutacion | test ANTES | test DESPUES |
| --- | --- | --- |
| sin mutacion | verde | verde |
| **M1** — renombrar el 6º parametro `repartoRepo` → `repartos` (aridad intacta en 6) | **rojo** | **rojo** |
| **M1 + M2** — lo mismo, mas un señuelo `repartoRepo: ILiquidacionRepartoRepository` como **codigo real** en el constructor de `ImputacionRepetidaError` | **VERDE (falso verde)** | **rojo** |

M2 tuvo que plantarse como codigo y no como comentario porque `codigoSinComentarios()` los quita
— cosa que tambien se comprobo, con un primer intento en comentario que efectivamente no colo.

Con M1+M2 el archivo daba **12/12 en verde** con la sexta dependencia real ya renombrada. Ese es
el falso verde que la fragilidad permitia.

### El arreglo

Se aplico el patron que ya existe en `tests/unit/config/reparto-mensajero-config.test.ts:104-113`:
anclar en `export class LiquidacionService`, buscar el `constructor(` **dentro** de la clase,
cerrar con `indexOf(") {}", abre)` y añadir las cuatro autocomprobaciones del corte
(`toContain("export class …")`, `abre > -1`, `toContain("private readonly pagoRepo")`,
`not.toContain("class ")`).

Fuente restaurada intacta tras las mutaciones (`git diff` limpio sobre `LiquidacionService.ts`).

---

## 5. Archivos tocados

| archivo | que |
| --- | --- |
| `vitest.config.ts` | `maxWorkers` fijado por medicion + la tabla que lo justifica; comentario de `testTimeout` reescrito con el porque de dejarlo en 20s y con la nota de `WORKER_START_TIMEOUT` |
| `tests/unit/services/liquidacion-caja-puerto.test.ts` | ancla estructural corregida + autocomprobaciones del corte |

No se toco nada de `app/(app)/wallet/mensajeros/` ni de `tests/components/` (zona del agente en
paralelo).

## 6. Verificacion ejecutada

```
pnpm exec tsc --noEmit          → TSC_EXIT=0  (cero errores)
pnpm run lint                   → LINT_EXIT=0 (0 errors, 60 warnings preexistentes, en archivos no tocados)

Suite completa, corrida 1 (config nueva):
  Test Files  1067 passed (1067)
       Tests  13365 passed (13365)
    Duration  343.09s      techo 5,25s   tests >5s: 1   procesos pico 19

Suite completa, corrida 2 (config nueva):
  Test Files  1067 passed (1067)
       Tests  13365 passed (13365)
    Duration  321.10s      techo 5,22s   tests >5s: 1
```

Las dos verdes, y los techos practicamente identicos (5,25s / 5,22s) — que es justo la
estabilidad que se estaba buscando, frente al 5,76-13,58s que daba la configuracion anterior.

**Nota de contaminacion:** durante la corrida con `maxWorkers=6` fallaron 2 tests de
`tests/components/WalletMensajerosAvisoBrutos.test.tsx`. Es una **asercion** (`expected […] to
have a length of +0 but got 1`, 82ms), no un timeout, y viene de las ediciones en vuelo del
agente que trabaja en paralelo sobre esa zona. Queda fuera de esta medicion y ya no aparece en
las dos corridas finales. De paso sirve de ejemplo del protocolo: un rojo por asercion en 82ms
no se parece en nada a un rojo por timeout.
