# review_127 — analitica: servicios financieros

Rama `feature/127-analitica-financiera-servicios`, worktree `ordenex-wt-127`.
Diff revisado: `origin/dev...HEAD`, cinco commits `92134879..fee4b1b8`, 42 archivos, +9803/-5.
Revision del **2026-08-02**. Todo lo que sigue se **midio en esta sesion**, no se leyo de la bitacora.

## VEREDICTO: **APROBADO**

Ningun hallazgo bloqueante. Siete hallazgos menores, todos de higiene o de alcance declarado;
ninguno afecta a una cifra de dinero ni a la frontera con el cliente.

---

## Checklist

| Punto | Estado |
|---|---|
| `./init.sh` verde | OK — **exit 0**, corrido entero por el reviewer |
| Suite completa | OK — **795 archivos / 9681 tests, 0 rojos**, sin *unhandled errors* ni forks caidos |
| Conteo de archivos vs. baseline `dev` (778) | OK — +17, la corrida **no** esta degradada |
| `tsc --noEmit` | OK — 0 (dentro de init.sh) |
| lint | OK — 0 errores (27 warnings preexistentes y ajenos) |
| Trazabilidad R1..R43 | OK — mapa completo + guardia ejecutable; **muestra de 20 R verificada a mano** |
| Tasks `[x]` | AVISO — **F.8 sin marcar** (es la del leader: sync con `dev` + PR), menor 4 |
| Integracion contra Postgres real | OK — **13 tests que corren de verdad**, no saltados |
| `lib/analytics/metrics.ts` (ajeno) | OK — **exactamente las tres cosas autorizadas**, ni una cuarta |
| Guardias modificados | OK — los tres suben resolucion; verificado diff a diff |
| Fuga de identidad (C8/R14) | OK — corregida, y **no hay otro sitio con la misma forma** |
| Ningun test pasa por conjunto vacio | OK — bloque dedicado por archivo + M23/M36/M51/M59/M68/M69 |
| RLS / migraciones | OK — n/a: feature de **lectura**, cero migraciones en el diff |
| Secretos | OK — ni un `process.env` en los archivos nuevos |
| Moneda / pais hardcodeados | OK — censo activo de literales sobre los 8 archivos |
| Capas | OK — repos solo Prisma, servicio sin Prisma/HTTP/cookies, action sin consultas |
| `git status` al terminar | OK — **limpio** (mutaciones revertidas byte a byte con `cmp`) |

---

## 1. El archivo ajeno `lib/analytics/metrics.ts`

El diff son **tres cosas y ninguna cuarta**, verificado sobre `git diff origin/dev...HEAD`:

1. D8 — `egresos.estadoProduccion`: `"declarada"` -> `"producida"` (linea 462).
2. D10 — `conciliacion_cierres.fuente.tablas` gana los tres ledgers (lineas 539-551).
3. D11 — el comentario de `egresos` que D8 dejo mintiendo (lineas 462-465), reescrito citando la
   autorizacion y su archivo.

Las tres con autorizacion humana fechada del **2026-08-02** en `progress/decision_C2_127.md`.
No hay cambio de etiqueta, grano, alcance, unidad ni de ninguna otra metrica. **Correcto.**

---

## 2. Muestra de trazabilidad verificada a mano (20 de 43)

Lo que el guardia de trazabilidad **no** puede comprobar es que el test citado mida el requisito.
Se abrio el test de cada fila y se leyo la asercion. No se encontro **ni un mapeo de relleno**.

| R | Que exige | Test citado | Mide lo que dice? |
|---|---|---|---|
| R1/R2/R3 | Solo las 5 tablas; nada de `analytics_daily` ni `orden` | `financiera-fuente.guardia.test.ts:196-225` | **Si.** Detector real sobre texto, `$queryRaw` y relaciones (`mensajero: true`); censo con descubrimiento por import; complemento no vacio (`MODELOS>20`, `PROHIBIDOS` contiene `orden`) |
| R5/R10 | Dominio invalido = error sin consultar | `analitica-financiera-service.test.ts:70-105` | **Si.** Recorre **todas** las operativas del catalogo y afirma `consultasHechas()===0`, con la mitad de control (`>0` cuando si es financiera) |
| R6 | Las ocho, ni una de mas ni una de menos | `analitica-financiera-service.test.ts:115-153` | **Si.** Defecto **y** exceso por separado contra `listarMetricas`, con tercera fuente independiente y "las ocho responden ok de verdad" |
| R7 | Toda firma publica recibe `ConsultaAnalitica` | `financiera-contratos.test.ts` (bloque R7) | **Si.** Tres `@ts-expect-error` mas comprobacion de tipos sobre el primer parametro de las 4 interfaces |
| R8/R9/R35 | Sin adaptador de dinero; sin rama de recorte; alcance total/prohibido | `financiera-alcance.guardia.test.ts:35-230` | **Si.** Mapa esperado **escrito a mano** (no derivado de `ALCANCE_FINANCIERA`), detector con 2 fixtures infractores y 1 legitimo de prosa |
| R11 | Auditar con llamada explicita **antes** de responder | `analitica-financiera-action.test.ts:58-146` | **Si**, y mejor de lo pedido: el caso de la linea 95 prueba el **orden** haciendo reventar el logger y exigiendo que el 403 **no** salga igualmente |
| R13 | 400 con `fieldErrors`, sin auditar | `analitica-financiera-action.test.ts:178-237` | **Si.** Las dos mitades; incluye el caso duro (actor que **iba** a ser denegado + entrada mala = 400 y silencio) |
| R14 | Ni un id de mensajero, ni anidado | `financiera-borde.guardia.test.ts:286-338` y los repos | **Si.** Barrido de `JSON.stringify` sobre las **8**, uuid sembrado en **24** filas, con caso que afirma que el fixture no es inocuo y otro que exige importe distinto de cero |
| R15 | Actor solo de `resolveActorFromSession()` | `analitica-financiera-action.test.ts:148-172` | **Si.** Censo de `next/headers`, `cookies(` y `SESSION_COOKIE_NAME`, con autocomprobacion y ancla de tamaño |
| R16/R26 | Suma de las categorias declaradas, ventana semiabierta CR | `financiera-ingresos-repo.test.ts:73-132` | **Si.** Base falsa que **ejecuta** el `where`; fixture con la fila de las **22:00 CR de ayer** (el off-by-one de 6 h), los dos bordes y el ajuste del mismo dia |
| R17 | Las categorias las manda el catalogo | `financiera-ingresos-repo.test.ts:138-181` | **Si.** Altera `definicion.categorias` **en memoria** y exige que la consulta cambie; restaura en `finally` y lo comprueba |
| R18 | `egresos` con las ocho `egreso_*` | `analitica-financiera-service.test.ts:282-319` y `financiera-produccion.guardia` | **Si.** Cifra concreta (750, no 500), neto negativo, `estadoProduccion === "producida"` y ausencia de `no_producida` **en codigo**, no solo en la respuesta |
| R20 | Reuso de las tres funciones money-safe | `analitica-financiera-derivacion.test.ts:54-188` | **Si**, y es el mejor test del lote: **espia** las tres funciones conservando su implementacion real y afirma los **argumentos**. Comparar solo el valor no habria detectado una resta a mano |
| R21 | Saldo al corte: `< hasta`, sin cota inferior | `financiera-cuentas-por-pagar-repo.test.ts:74-121` | **Si.** Por valor **y** por forma del `where` (`Object.keys(fecha)` es `["lt"]`), mas la asercion de que `desde` no aparece en ninguna parte |
| R22/R39 | Dos niveles separados; coordenada por fila | `financiera-conciliacion-repo.test.ts` y `analitica-financiera-conciliacion.test.ts:89-109` | **Si.** `cierre_dia/aprobado/resuelto_at` frente a `cierre_dia/solicitado/solicitado_at` y `cierre_bodega/...`, comparados como secuencia |
| R23 | Cruce por `origen_tipo`/`origen_id`, no por ventana | `analitica-financiera-conciliacion.test.ts:115-174` | **Si.** El fixture cuadrado lleva **ruido deliberado** de los otros dos libros y del debito del mismo origen; sumarlos daria 860 y declararia un descuadre inexistente |
| R24/R40 | Se emite por encima del umbral; nunca lanza | `analitica-financiera-conciliacion.test.ts:180-249` | **Si.** Los **dos** lados del umbral con el mismo descuadre de 50 (umbral 0.01 frente a 100), el centimo exacto, y "nunca lanza" con 9999999.99 |
| R27/R37 | STRING escala 2; `bruto` distinto de `neto` por signo | `analitica-financiera-derivacion.test.ts:150-273` | **Si.** Par pago mas contraasiento (`neto 0.00`, `bruto 2000.00`), `0.10+0.20`, 13 digitos, y barrido de `typeof` sobre las ocho |
| R29 | La moneda de `lib/config/moneda.ts` | `analitica-financiera-service.test.ts:224-276` | **Si.** Todo importe servido, mas censo de literales sobre 8 archivos con autocomprobacion del detector |
| R31 | Inyeccion por interfaz, sin base | `analitica-financiera-service.test.ts:31-64` | **Si**, y no por inspeccion: el `beforeAll` **borra `DATABASE_URL`** y lo restaura |
| R32 | Nada se silencia; sube con contexto y sin PII | `analitica-financiera-action.test.ts:281-343` y `financiera-repositorios.guardia` | **Si.** Error con 4 datos de PII sembrados, se afirma que **el fixture si los trae** y que la respuesta no; el error integro **si** llega al logger |

**R36** merece mencion: podia haberse declarado hueco y no se declaro. El guardia
`financiera-trazabilidad.guardia.test.ts` exige los 43 sin saltos ni repetidos, que cada fila cite
al menos un `.test.ts`, que **exista en el arbol**, y que se citen 12 o mas archivos distintos. Su
cabecera dice explicitamente lo que **no** puede comprobar. Correcto.

---

## 3. Los guardias modificados: subieron o bajaron la exigencia?

Verificado diff a diff con `git diff <commit> <commit> -- <archivo>`. **Todos suben.**

- **`financiera-correspondencia.guardia.test.ts`, cambio 1 (tanda C, `92134879` -> `fb4d98b5`).**
  Pasa de mapear metrica -> **archivo** a metrica -> **metodo**, y añade una **segunda**
  comprobacion por archivo contra la union. El motivo es real, no una excusa: el design define
  **un** `CuentasPorPagarAnaliticaRepository` para dos metricas de fuentes **disjuntas**, asi que
  la version de la tanda B era **insatisfacible por construccion**: ninguna implementacion legal la
  cumplia. La salida elegida (subir resolucion) es la unica de las tres que no afloja; relajar a la
  union habria dejado que `cuenta_por_pagar_tienda` leyera el libro de mensajeros sin que nadie se
  enterara. Ademas el ancla de repositorios sube de `>= 0` a `>= 3` y aparece un caso nuevo que
  exige que cada metodo consulte **solo su tabla**.
- **`financiera-correspondencia.guardia.test.ts`, cambio 2 (tanda D, `fb4d98b5` -> `b6a93cff`).**
  El test de la contradiccion C2 esta **dado vuelta, no borrado**, tal como D10 exigia: afirma que
  las cinco tablas estan declaradas (**lista escrita a mano**, no derivada del catalogo) y que
  quitar un ledger vuelve a poner rojo. El ancla sube de `>= 3` a **igualdad exacta** con los
  cuatro. Se introduce `tablasFueraDe(...)` para poder juzgar contra un catalogo hipotetico **sin
  mutar el catalogo real dentro de un test**: buena decision.
- **`financiera-repositorios.guardia.test.ts` (tanda D).** Censo de `>= 3` a igualdad exacta con los
  cuatro; lista de propagacion de error de **5 a 8** metodos, con el `toHaveLength(8)` que obliga a
  mirarla cuando nazca un metodo nuevo. **Sube.**
- **`analitica-financiera-service.test.ts` (tanda E).** Los censos de R29 (moneda) y R28
  (reloj/azar) **suman** `lib/actions/analitica-financiera.ts`. Un archivo mas juzgado, ninguno
  menos. **Sube.**
- **`_fake-prisma-dinero.ts` (tanda D).** Ampliada y **endurecida**: agrupar por una columna que la
  fila no tiene ahora **lanza** (antes daba un grupo `undefined` silencioso) y `findMany` sin
  `select` devuelve la fila entera, que es precisamente lo que permite que el test de R14 vea la
  fuga. **Sube.**

---

## 4. La fuga de identidad (C8 / R14): hay mas sitios con la misma forma?

**No.** Se reviso el servicio entero y los cuatro repositorios:

- `deCaja` y `deCuentaDeMensajeros` no publican filas del repositorio, solo el total.
- `deRecaudo` y `deSaldoDeTiendas`: cada fila se **construye** (`{ cubo, importe }`), no se reenvia.
- `deConciliacion`: `porEstado` pasa por `soloLoDeclarado`
  (`lib/services/AnaliticaFinancieraService.ts:425-438`), lista blanca de seis campos, **sin
  `...grupo`**, y `totales` tambien se copia campo a campo. Ese detalle importa: un
  `soloLoDeclarado` descuidado habria reenviado el objeto `totales` entero.
  `cierresDescuadrados` lleva ids de cierre.
- `lib/repositories/ConciliacionCierresAnaliticaRepository.ts:203-212` usa `select` de **dos**
  columnas y mapea; `contarCierresPorEstado` construye cada fila con `fila(...)`.
- Grep de spreads en los seis archivos de codigo: los unicos son `...this.cabecera(consulta)`
  (objeto propio) y `...agregadoDeCierre()` (argumentos de Prisma). **Ningun spread de fila.**

**El barrido de E.4 cubre las ocho de verdad** (`IDS_FINANCIERAS_SERVIDAS` con `toHaveLength(8)` y
bucle sobre el registro) y **siembra algo que se veria**: 24 apariciones del uuid, con un caso
dedicado que las cuenta y otro que exige importe distinto de cero en la respuesta. La reserva sobre
su alcance real esta en el menor 3.

---

## 5. Mutaciones reproducidas por el reviewer (8 de 71)

Aplicadas sobre el arbol real, revertidas desde copia pristina obtenida con `git show HEAD:<f>` y
verificadas con `cmp`. `git status` al terminar: **limpio**.

| # | Mutacion | Requisito | Bitacora | **Medido ahora** |
|---|---|---|---|---|
| M58 | el servicio reenvia `porEstado` del repositorio (deshace C8) | R14 | 1 rojo | **1 rojo de 30** — coincide |
| M39 | `deSaldoDeTiendas` resta a mano en vez de llamar a `derivarSaldoTienda` | R20 | 1 rojo | **1 rojo de 11** — coincide |
| M20 | se añade `gte: rango.desde` a las dos cuentas por pagar | R21 | 5 de 9 | **5 rojos de 9** — exacto |
| M53 | el `motivo` se propaga al cuerpo del 403 | R12/R42 | 15 de 47 | **15 rojos de 47** — exacto |
| M47 | el cuadre suma **todo** el ledger, no el credito de tienda | R23 | 8 rojos | **8 rojos de 17** — coincide |
| M35 | D10 revertido: `conciliacion_cierres` vuelve a sus dos cierres | R4 | 4 rojos | **4 rojos de 12** — exacto |
| M48 | D8 revertido: `egresos` vuelve a `"declarada"` | R41 | 3 rojos | **2 rojos de 25** — muerde, conteo distinto |
| M43 | `esAcumulado: true` para las ocho | R43 | 1 rojo | **1 rojo de 20** — exacto |

Las ocho muerden. La unica discrepancia (M48: 2 en vez de 3) es de **perimetro de corrida**, no de
cobertura: la bitacora la midio sobre `tests/unit/services` y `tests/unit/analytics` enteros y aqui
se corrieron dos archivos. El guardia B.5 se pone rojo igual, que es lo que sostiene R41.

La bitacora tambien declara **una mutacion que NO puso nada rojo** (M4, tanda B), explica por que
—la redundancia del descubrimiento por import la absorbio— y añade M4b y M4c, que si muerden. Que
eso este escrito en vez de omitido cuenta a favor.

---

## Hallazgos

### Bloqueantes

**Ninguno.**

### Menores

1. **Anclas "no vacio" desiguales entre guardias hermanos.**
   `tests/unit/analytics/financiera-fuente.guardia.test.ts:209` y
   `tests/unit/analytics/financiera-alcance.guardia.test.ts:192` siguen exigiendo
   `censados.length >= 3` cuando ya existen los **13** archivos declarados. Los otros dos guardias
   del mismo tipo (correspondencia y repositorios) subieron en las tandas C y D a **igualdad
   exacta**. Hoy se podrian borrar 10 de los 13 archivos y esos dos censos seguirian verdes. No es
   una regresion —el ancla nunca fue mas alta— pero es la misma clase de agujero que las tandas C y
   D cerraron en los otros dos. Sugerencia: `expect([...censados].sort()).toEqual([...])`.

2. **Un caso del guardia de correspondencia promete mas de lo que hace.**
   `tests/unit/analytics/financiera-correspondencia.guardia.test.ts`, caso "y el guardia sigue
   mordiendo: una tabla que conciliacion_cierres NO declara la caza igual". Su comentario habla de
   `orden` y `gestion_orden`, pero el fixture `conElIntruso` **solo contiene tablas del universo** y
   la unica asercion que muerde es contra una declaracion **hipotetica**
   (`tablasFueraDe(["cierre_dia"], ...)`). El caso real que el titulo anuncia lo cubre
   `financiera-fuente.guardia.test.ts`, no este. El test no es vacio, pero su nombre induce a error
   sobre que esta vigilado y donde.

3. **S16 no subio de la bitacora al spec, y acota el alcance real del barrido de E.4.**
   Cinco de las ocho metricas (`ingreso_flete`, `ingreso_comision_cod`, `ingreso_iva`, `egresos`,
   `cuenta_por_pagar_mensajero`) se sirven con `filas: []` y solo `total`, aunque el catalogo
   declara `granos: ["fecha"]`. El razonamiento es correcto —publicar una fila unica con
   `cubo = desdeFecha` afirmaria que todo el dinero se movio ese dia— y ningun `R` exige el corte
   por dia, asi que **no es una desviacion del spec**. Pero tiene dos consecuencias que hoy solo
   viven en `progress/impl_127_D.md` (supuesto S16):
   (a) la **132 no puede pintar serie temporal** de cinco de las ocho metricas, y esa es una
   restriccion de contrato que su ficha deberia conocer **antes** de diseñar el tablero;
   (b) para esas cinco, el barrido de identidad de E.4 se satisface **trivialmente** —no hay filas
   donde pudiera aparecer un uuid—, asi que la parte del barrido que de verdad muerde son las tres
   que si publican cubos, que es exactamente donde estaba C8.
   Deberia subir a **pregunta abierta** de `requirements.md` y viajar al cuerpo del PR. Se registra
   como menor, y no como desviacion, porque esta declarado y razonado, que es lo que la regla 6 del
   arnes pide.

4. **`tasks.md` F.8 sin marcar; `progress/history.md` sin entrada de la 127.**
   `CHECKPOINTS.md` exige "todas las tasks marcadas `[x]`" y una entrada en `progress/history.md`.
   F.8 es "sincronizacion con `dev` y PR", que **por definicion va despues de esta revision**, y la
   entrada de history es del leader. Se anota para que el checkpoint se cierre de verdad y no se de
   por cumplido de memoria. Las otras 37 tareas estan marcadas.

5. **El checkpoint de E2E queda como hueco declarado.**
   `CHECKPOINTS.md:19-20` pide un Playwright si la feature toca "pagos, recaudo". La 127 los toca,
   pero **no tiene superficie de UI**: la pintan la 129 y la 132, que aun no existen. Lo mas cercano
   disponible —13 casos de integracion contra Postgres real, sin un solo mock de Prisma, en
   transaccion revertida— existe y corre. No es subsanable en esta feature; conviene que el PR lo
   diga en vez de dejar el checkbox mudo.

6. **C7 (`derivarCuentaPorPagar` no sabe expresar una cuenta negativa) queda abierto para la 44.**
   La 127 obro bien: no toca la funcion compartida y no esconde el problema (sirve el
   `cuentaPorPagar` correcto y el `signo` incoherente **no** cruza al DTO). Pero el hallazgo esta
   solo en `progress/impl_127_D.md` (C7) y deberia llegar a la ficha de la 44, o se pierde.

7. **D7 sigue cerrada por implicacion y no por respuesta.**
   Es el unico punto del spec que no descansa en una respuesta directa del humano; esta marcado
   como reabrible en `requirements.md:100-108` y en el apartado de riesgos del design. Si se
   reabre, cambia R23 y podria caer una de las dos vistas de R19. **Tiene que ir en el cuerpo del
   PR**, no solo en el spec.

---

## Lo que esta bien y no necesita mas espacio

Contratos money-safe (STRING escala 2 en toda frontera, `Prisma.Decimal` como unica aritmetica);
reuso de las tres funciones compartidas comprobado por **espia de argumentos** y no por comparacion
de valores; los tres pasos del borde con la sonda de **orden**; el 403 generico verificado sobre los
**siete** motivos y por las dos mitades; una base de datos falsa que **ejecuta** el `where` en vez
de devolver lo esperado; y cada archivo de test con su bloque "no pasa por conjunto vacio"
respaldado por mutaciones que vacian la fuente (M23, M36, M51, M59, M68, M69). Cero migraciones,
cero secretos, cero literales de moneda, cero adaptador de alcance para las tablas de dinero.

---

## Para el cuerpo del PR (deuda de documentacion, no de codigo)

1. Las **tres** autorizaciones fechadas sobre `lib/analytics/metrics.ts`: D8, D10 y D11, humano,
   2026-08-02, `progress/decision_C2_127.md`.
2. **C8**: la feature corrige una fuga de identidad que su propio guardia de borde encontro.
3. **D7** cerrada por implicacion (menor 7) y **S16** (menor 3).
