# Review — Feature 255 · cotizacion por API key

Revisor: reviewer (subagente). Fecha: 2026-08-21. Worktree: `C:/w255`,
rama `feature/255-cotizacion-api-key` (salida de `origin/dev`, `8070b508`), cambios sin commitear.

**VEREDICTO: APROBADO** — 0 hallazgos mayores. 8 menores, ninguno bloqueante.

---

## 1. Checklist de CHECKPOINTS.md

| Item | Estado | Evidencia |
| --- | --- | --- |
| `specs/255-*/requirements.md` con EARS numerados | OK | R1–R56 |
| `design.md` con alternativas descartadas | OK | §7, nueve alternativas (A1–A9) con su porque |
| `tasks.md` todas marcadas | OK | 18 tareas, cero casillas vacias |
| Cada `R<n>` mapea a un test concreto | OK | 56/56, ver §4 |
| `progress/impl_255_backend.md` contiene el mapa `R -> test` | OK | tabla de los 56 |
| `pnpm run typecheck` | **VERDE, medido** | exit 0, 0 errores |
| `pnpm run lint` | **VERDE, medido** | 97 problems (0 errors, 97 warnings) = baseline exacto |
| `pnpm test` | **VERDE fuera de tests/integration/db, medido** | 1148 archivos, 15203 passed, 26 skipped, **0 rojos** |
| E2E Playwright para flujo critico | N/A **declarado** | design.md §8: el borde no ingesta, no crea ordenes, no consume guias, no tiene UI. Menor 7 |
| RLS en tabla nueva | N/A **verificado** | `git status db/` y `git diff db/` vacios: cero tablas, cero columnas, cero migraciones |
| Migraciones versionadas + down.sql | N/A **verificado** | no hay migracion nueva |
| Sin secretos hardcodeados | OK | la key nunca entra en respuesta ni en log (test R49 + estructural sobre `console.*`) |
| Webhooks firmados/idempotentes | N/A | no hay webhook |
| Controller sin queries ni logica | OK | route.ts: solo bearer + zod + traduccion del resultado discriminado; test estructural prohibe queries Prisma y `.toFixed(` |
| Service sin HTTP | OK | test estructural: sin import de next/, sin `Request` |
| Repository solo queries | OK | `resolveTarifaCotizablePorTienda` = un findFirst + select |
| Interfaces en `lib/interfaces/` por categoria | OK | interfaces/services/ICotizacionOrdenService.ts, interfaces/repositories/ITarifaVigentePorTiendaRepository.ts |
| Sin hardcode de pais/moneda | OK | simbolo y los dos separadores se LEEN de `monedaConfig`; test estructural + test con config sobreescrita |
| `./init.sh` en verde | **PARCIAL, deliberado** | sus tres ejes medidos por separado; el completo literal incluye tests/integration/db contra una base compartida por ~25 worktrees. Menor 8 |
| `progress/review_255.md` | este archivo | |
| Entrada en `progress/history.md` | **FALTA** | Menor 2 |

---

## 2. Los cinco invariantes firmados en la puerta humana

**1. Importes SOLO formateados, sin campo crudo en paralelo — CUMPLE.**
`CostosEntregado`, `CostosDevuelto` y `TotalesCotizacion` declaran todos sus campos de dinero como
`string`. El test de integracion de R34 no se conforma con mirar los campos conocidos: aplana el JSON
entero a hojas y afirma (a) que toda hoja bajo `.entregado.`/`.devuelto.` con nombre de importe casa
el patron formateado, (b) que **ninguna** hoja del arbol —con cualquier nombre y en cualquier ruta—
es un crudo de escala 2 (`/^-?\d+\.\d{2}$/`), y (c) que no hay rutas repetidas. Eso caza el
`fleteCrudo` de cortesia que la decision A3 descarto. El formato al caracter (simbolo, miles, dos
decimales, signo delante, cero sin signo) queda fijado por las 14 filas de design.md §6.1
transcritas como test parametrizado, con un test extra que exige que la tabla siga teniendo 14 filas.

**2. Sin tarifa vigente -> error explicito ANTES de la cobertura — CUMPLE, el orden real es ese.**
`CotizacionOrdenService.cotizar` (lib/services/CotizacionOrdenService.ts:137-141) resuelve la tarifa
y hace `return { status: "sin_tarifa" }` **antes** de la linea 141 (`this.precargarGeografia()`). No
es solo lectura del fuente: el test de integracion de R13 cablea el repositorio geografico como Proxy
que registra TODO acceso y afirma que la lista de invocados es `[]` —la geografia no se toca ni una
vez—, que el cuerpo no trae `filas` ni `totales`, y que el JSON no contiene el simbolo de moneda. El
409 lleva un mensaje constante y sin interpolacion (`MSG_COTIZACION_SIN_TARIFA`). El gap de la carga
NO se replica: el service no importa `costoEnvioDeTarifa` (afirmado estructuralmente) y un test
comprueba que `derivarIngresoOrden` nunca recibe `tarifa === null` desde este camino.

**3. `Prisma.Decimal` de punta a punta, formateo como ULTIMO paso — CUMPLE.**
`formatMontoCotizacion(valor: Prisma.Decimal)` no acepta string, asi que encadenar dos formateos o
re-parsear un importe formateado es imposible por firma. En el service: cero `Number(`,
`parseFloat(`, `parseInt(`, cero `.replace(`, cero `.mul/.div/.times/.dividedBy/.mod`, cero
`toFixed`/`toDecimalPlaces`/`ROUND_`, y ningun decimal construido sobre la salida del formateador ni
ningun `plus(` que la reciba — los seis barridos estructurales existen y estan verdes. Los dos
escenarios salen de **dos llamadas** a `derivarIngresoOrden` (espia que conserva la implementacion
REAL, `toHaveBeenCalledTimes(2)`, con los dos inputs afirmados campo a campo y la misma tarifa). Los
unicos calculos propios son los dos `total` de R30/R31, en Decimal.

**4. Total de LOTE: contadores, suma en Decimal, ceros explicitos — CUMPLE.**
`filasSumadas`/`filasExcluidas` viven dentro del bloque, su suma es `total` (probado sobre tres lotes
distintos) y coinciden con `cotizadas`/`conError` de la raiz. La suma discrimina de verdad: T7B.4 usa
una tarifa con comision 10% y monto 35.04 (comision exacta 3.504), tres filas iguales, y afirma
`₡10,50` **y** que no vale `₡10,51` — los dos centimos que separan sumar-los-redondeados-por-fila de
sumar-los-exactos son el test. El borde del cero (R56) se afirma con el objeto `totales` completo
comparado con `toEqual`, incluido `filasExcluidas: 3`.

**5. El contrato de la carga (88/141/155) no cambia; T2 fue una MUDANZA — CUMPLE, verificado
mecanicamente.** Extraje del diff las 158 lineas borradas de BulkOrdenService.ts (menos el import de
`normalizeName`), le quite el `export ` al modulo nuevo y compare linea a linea: **IDENTICO**, 158 vs
158, diff vacio. Ni una cadena, ni una rama, ni un orden de comprobacion. El resto del diff de
BulkOrdenService.ts es exclusivamente el bloque de imports. `app/api/ordenes/api-key/carga/` no
aparece en `git status`. Ademas hay un test de paridad que ejecuta `cargarViaApi` **de verdad** sobre
la misma geografia y compara los tres mensajes de no-cobertura con los que emite la cotizacion.

---

## 3. Los cuatro juicios que se me pidieron explicitamente

**(a) Los 6 dobles de suites ajenas: cero cambio de afirmaciones. Correcto.**
Verificado por diff: 11 inserciones, 0 borrados, 0 `expect` tocados, 0 lineas de comportamiento. En
cada doble el metodo nuevo devuelve **lo mismo que su hermano** `resolveTarifaPorTienda` en ese mismo
objeto (`null` donde el otro da `null`, `tarifa` donde el otro da `tarifa`), asi que ninguno afirma
nada distinto de lo que haria el repositorio real; y ninguno de esos caminos invoca el metodo nuevo
(la carga no lo llama). **Ningun doble miente.** La alternativa descartada —declararlo opcional con
`resolveTarifaCotizablePorTienda?`— estaba **bien** descartada: convertiria un fallo de wiring de
dinero en un `undefined` en runtime, que es exactamente lo que el constructor de `BulkOrdenService`
documenta que quiso evitar al exigir `tarifaRepo`. Once lineas de doble cuestan menos que un `?`
sobre un resolver de tarifas.

**(b) El diente 6 caza lo que dice cazar. Correcto, y salio mas fuerte que el spec.**
No declara la excepcion del route handler que design.md §6(b) preveia, porque el handler no importa
el formateador: la afirmacion resultante —ninguna pantalla lo importa, CERO excepciones— es la
fuerte. Y ancla que el barrido **mira el fuente nuevo**: exige que
app/api/ordenes/api-key/cotizacion/route.ts exista y no importe el modulo, de modo que el verde no
puede venir de no haber mirado nada. Muerde por tres sitios: censo con motivo obligatorio y
`existsSync`; afirmacion POSITIVA de dos decimales sobre el corpus entero (mas de 100 importes)
pasado por el formateador real; y contraprueba **ejecutada** que aplica el mutante obvio
(`formatMontoString(valor.toFixed(2))`, es decir alinear el modulo con las pantallas) y exige que sea
cazado en mas de 100 casos. Si alguien le quita los centimos, el diente 6 se pone rojo. Los dientes
1–5 no cambian ni una afirmacion: el diff sobre ellos es prosa (cabecera del archivo y del diente 3)
y nada mas; `LISTA_BLANCA_TO_FIXED` no crecio, y la igualdad "los caminos publicos son CINCO" se
afirma dos veces.

**(c) Mina 1 — el censo de paths 7 -> 8: subio a proposito y sigue igual de restrictivo.**
El path añadido es el real (`/api/ordenes/api-key/cotizacion`, el mismo que sirve
app/api/ordenes/api-key/cotizacion/route.ts). El censo NO se relajo: sigue con `toHaveLength(8)` mas
`toEqual(PATHS_ESPERADOS)` (igualdad **ordenada**, no `toContain`), lo repite sobre el .yaml, y la
feature **añade** dureza: posicion 7 en ambos artefactos, espejo `clavesYaml === clavesTs`, el octavo
es POST y devuelve `CotizacionResponse`, y la descripcion publicada declara `cobra_comision = true`
en los dos artefactos.

**(d) Mina 2 — el diente 6 afirma en positivo sin debilitar 1–5.** Cubierto en (b).

---

## 4. Trazabilidad: 56 de 56

Verifique que los 56 requisitos tienen un test que **existe, se ejecuta y afirma lo que dice
afirmar**.

- **Leidos en profundidad, afirmacion por afirmacion: 34.** Todos los de dinero (R23–R42, R51–R56),
  los de tarifa (R11–R16), los de cobertura (R17–R22) y los del borde (R1–R10, R43–R49).
- **Verificados como existentes y verdes sin lectura linea a linea: 22.**
- **En duda: 0.** Ninguno resulto ser un test vacio ni un test que afirma otra cosa.
- Cuatro requisitos (R42, R48, R50 y la mitad estructural de R5) se apoyan **a proposito** en
  guardias preexistentes NO editadas: dientes 1 y 5 de la guardia 230, la guardia 229 del middleware
  y las suites de `cargarViaApi`. Comprobe que las tres estan verdes en la corrida completa y que el
  diff no las toca. Es el mapeo correcto para un requisito de "esto no debe cambiar".

Muestreos que valia la pena hacer y salieron bien:

- R30/R31 no son tautologias: 25900 − (2500 + 325 + 906.50 + 117.85) = 22050.65 y
  −(1396.46 + 181.54) = −1578.00 estan escritos como constantes calculadas a mano, y el −1578 del
  humano aparece literal.
- R39 no se conforma con el barrido estructural: comprueba que 906.50 × 13% = 117.845 sale
  `₡117,85` (HALF_UP de la aritmetica) y que 999.995 redondeado agrupa a `₡1.000,00`.
- R43 no es una lista de 22 `not.toHaveBeenCalled`: el Proxy ve TODOS los accesos y afirma que el
  conjunto de invocados es exactamente el de las tres lecturas geograficas, asi que cubre tambien el
  metodo de escritura que alguien añada mañana.
- R12 afirma el WHERE exacto con `toEqual` y, en un test aparte, que el resolver de liquidacion sigue
  sin `status` en esa misma corrida.

---

## 5. El gate: medido por mi, no leido de la bitacora

| Eje | Reportado por el implementer | Medido por mi | Coincide |
| --- | --- | --- | --- |
| `pnpm run typecheck` | 0 errores | **0 errores (exit 0)** | si |
| `pnpm run lint` | 0 errores / 97 warnings | **0 errores / 97 warnings** | si |
| Las 7 suites de la 255 | 149/149 | **7 archivos, 149 passed** | si |
| Suite completa sin tests/integration/db | 1148 archivos / 15203 verdes / 0 rojos | **1148 archivos / 15203 passed / 26 skipped / 0 rojos** | si |

El conteo de archivos cuadra (1148 + 113 de tests/integration/db = los 1261 del gate completo), asi
que **no** es una corrida degradada que reporte de menos.

**Atribucion de los 71 rojos: NINGUNO es de la 255.** Comprobado en tres ejes independientes:

1. Excluyendo tests/integration/db no queda **ni un** rojo. Todo lo que este diff puede afectar esta
   ahi dentro, y esta verde.
2. Ningun archivo de tests/integration/db menciona `cotizacion`, `resolveTarifaCotizable`,
   `monto-cotizacion` ni `geo-resolucion` (grep = 0 resultados). Tres archivos de esa carpeta si
   tocan `TarifaVigentePorTiendaRepository` o `BulkOrdenService`, pero usan la **clase concreta** o
   solo el tipo `TarifaVigente` —ningun objeto literal tipado con la interfaz, por eso el typecheck
   no los obligo a cambiar— y ninguno esta entre los 6 archivos que fallan.
3. `git merge-base --is-ancestor e69efc94 HEAD` -> **si**: las migraciones de la 253 que faltan en la
   base local son anteriores al punto de partida de esta rama.

No corri `pnpm db:migrate` ni ninguna escritura contra la base compartida.

---

## 6. Hallazgos

### Mayores (bloqueantes): NINGUNO

### Menores

1. **feature_list.json no tiene entrada para la 255.** Ni id, ni status, ni spec_path; el maximo
   registrado es 254. init.sh no lo detecta porque solo audita las features que **estan** en el
   fichero, asi que la feature podria llegar a `done` sin haber existido nunca en el libro mayor.
   Bookkeeping del leader, a cerrar antes del PR (escribiendo en LF y verificando que el diff sea
   solo el alta).
2. **Falta la entrada en progress/history.md** que exige CHECKPOINTS.md, seccion Verificacion final.
3. **El mapa R -> test de la bitacora dice, en R50, "suites de la carga verdes SIN EDITAR"**, y tres
   de esas suites (bulk-orden-service*.test.ts) si se editaron: solo dobles, 0 afirmaciones. La
   bitacora lo declara con detalle 100 lineas mas arriba, pero esa linea del mapa, leida sola, se
   contradice con el diff. Conviene alinear la redaccion.
4. **El docstring de `formatMontoCotizacion` dice "NO REDONDEA"** y `toFixed(2)` si redondea cuando
   entra una escala mayor que 2 (el propio test lo documenta: 1.005 -> `₡1,01`). Hoy no puede pasar
   —lo que llega viene de `derivarIngresoOrden`, ya a escala 2— y el test es honesto al escribirlo,
   pero la afirmacion absoluta del docstring puede leerse como una garantia que no es.
5. **`distinct()` quedo duplicado** en BulkOrdenService.ts y CotizacionOrdenService.ts: la mudanza no
   se lo llevo. Trivial y sin riesgo real de drift (dos lineas, ninguna decision dentro).
6. **El OpenAPI marca provincia/canton/distrito como `required` en `CotizacionRow`**, pero el borde
   no responde 422 cuando faltan: responde 200 con esa fila en `resultado: "error"` (R21). La
   descripcion lo explica en prosa, pero un cliente generado con validacion estricta podria rechazar
   en local un cuerpo que el servidor si acepta.
7. **Sin E2E Playwright.** Declarado y argumentado en design.md §8 y en la bitacora: el borde no
   ingesta nada, no crea ordenes, no consume guias y no tiene UI; lo cubre un test de integracion
   sobre el route handler con dependencias inyectadas, el mismo patron que `handleCargaApi`. Lo
   acepto, y lo dejo escrito para que no se relea como un olvido.
8. **No corri `./init.sh` en su forma literal.** Su paso `pnpm test` incluye tests/integration/db,
   que escribe contra una base local compartida por unos 25 worktrees y que esta roja por causa
   ajena y anterior a esta rama. Medi sus tres ejes por separado (typecheck, lint y la suite completa
   menos esa carpeta) y verifique a mano los pasos no-test: migraciones sin down.sql (no hay
   migracion nueva), .env presente, y la regla max-2-por-zona (sin entrada en feature_list.json, ver
   menor 1).

---

## 7. Veredicto

**APROBADO.**

Los cinco invariantes firmados en la puerta humana se cumplen, y los dos que mas facil era falsear
—el orden tarifa-antes-que-geografia y la aritmetica en Decimal— estan verificados por
COMPORTAMIENTO, no solo por lectura del fuente. La mudanza de `resolveGeo` es byte-identica,
comprobada mecanicamente. El diente 6 de la guardia 230 muerde de verdad y salio mas fuerte que el
spec. El censo de paths subio a ocho a proposito y sin relajarse. La trazabilidad esta completa,
56 de 56, con 0 en duda. El delta del gate frente al baseline es 0 rojos.

Los ocho menores no bloquean el merge. Los dos primeros —alta en feature_list.json y entrada en
progress/history.md— son bookkeeping del leader y deberian cerrarse **antes** del PR.
