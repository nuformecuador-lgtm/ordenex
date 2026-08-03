# impl_127_E — analitica financiera · TANDA E (el borde) y TANDA F (integracion y cierre)

Rama: `feature/127-analitica-financiera-servicios` · worktree `ordenex-wt-127`.
Sesion del **2026-08-02**. Continua `progress/impl_127.md` (tandas 0/A/B, `92134879`),
`progress/impl_127_C.md` (C.1–C.3, `fb4d98b5`) y `progress/impl_127_D.md` (C.4/C.5 + TANDA D,
`b6a93cff`).

**Alcance de esta sesion:** **E.1–E.5** y **F.1–F.7**.
**Fuera de alcance y NO hecho:** **F.8** (sincronizar con `dev` y abrir el PR), que es del leader.
`lib/analytics/metrics.ts` **no se ha tocado ni una linea**: sigue con las dos entradas que
⟨D8⟩ y ⟨D10⟩ autorizaron, y no hizo falta una tercera (ver C8 abajo).

---

## Archivos

### Creados (4)

| Archivo | Que es |
|---|---|
| `lib/actions/analitica-financiera.ts` | **E.1–E.5** — el borde: `'use server'`, actor por `resolveActorFromSession()`, los tres pasos (auditar → 403 generico → identidad), 400 sin auditar y el error con contexto sin PII. Sin una sola consulta. |
| `tests/unit/actions/analitica-financiera-action.test.ts` | **E.1, E.2, E.5** + R5 y R15 en el borde (17 tests). |
| `tests/unit/analytics/financiera-borde.guardia.test.ts` | **E.3, E.4** — los siete motivos y el barrido de identidad sobre las ocho metricas (30 tests). |
| `tests/integration/actions/analitica-financiera-action.test.ts` | **F.1–F.6** — contra Postgres real, sin un mock de Prisma, todo en transaccion revertida (13 tests). |
| `tests/unit/analytics/financiera-trazabilidad.guardia.test.ts` | **F.7** — el mapa `R1..R43` vigilado por un guardia ejecutable (5 tests). |

(Son cinco archivos; el primero es codigo y los otros cuatro tests.)

### Modificados (3)

| Archivo | Cambio |
|---|---|
| `lib/services/AnaliticaFinancieraService.ts` | **Una fuga real, encontrada por E.4.** Ver C8. `porEstado` deja de reenviar el array del repositorio y pasa por una proyeccion explicita (`soloLoDeclarado`). |
| `tests/unit/services/analitica-financiera-service.test.ts` | Los dos censos de R29 (moneda literal) y R28 (reloj/azar) suman `lib/actions/analitica-financiera.ts` a su lista. **Sube la resolucion, no la baja**: un archivo mas juzgado, ninguno menos. |
| `progress/impl_127.md` | **F.7** — el mapa completo `R1..R43 → test`, uniendo las cuatro tandas. |

`tasks.md` marcado: E.1–E.5 y F.1–F.7. **F.8 sigue sin marcar.**

---

## E.3 y E.4 son de seguridad, y por eso se miden asi

**E.3 · los siete motivos, uno a uno.** El guardia no comprueba "un" 403: construye los **siete**
`MotivoDenegacion` a traves del propio Server Action (`sin_sesion` con actor nulo,
`rol_desconocido`, `rol_sin_analitica` con `apiKey`, `sin_zona_asignada` con un satelite sin
zona sobre una metrica acotada, `metrica_desconocida`, `metrica_prohibida` con un `adminTienda`
sobre `egresos`, y `filtro_fuera_de_alcance` pidiendo la tienda ajena) y, en cada uno, afirma
**las dos mitades**: que el literal **no** esta en la cadena serializada de la respuesta y que
**si** esta en el registro del `ErrorLogger`. La comparacion de la respuesta es una igualdad
estricta contra `{ status: "forbidden", code: "FORBIDDEN" }`: no basta con que el motivo no
aparezca hoy, es que no hay ningun campo de mas donde pudiera aparecer mañana. Un caso extra
afirma que los siete estan ejercitados, para que añadir un octavo motivo al dominio deje el
guardia rojo en vez de dejarlo mudo.

**E.4 · la cadena serializada completa, no campo por campo.** El uuid del mensajero se siembra
en **todas** las filas que los cuatro repositorios entregan (24 apariciones en el material) y se
barre `JSON.stringify` de la respuesta de las **ocho** metricas. Inspeccionar campo por campo
habria mirado exactamente los campos que ya sabemos que estan bien; lo que se escapa se escapa
por el que nadie penso en mirar. **Y se escapo uno** (C8).

---

## Supuestos tomados (numerados desde S19)

- **S19 · El mensaje de error del borde se CONSTRUYE, no se reenvia.** R32 pide contexto (que
  metrica, que rango) y prohibe PII. El texto de un error de Postgres puede arrastrar la fila
  entera que reviento —id de tienda, telefono, correo—, asi que la respuesta se arma solo con el
  `metricaId` que el propio actor envio y las dos fechas del rango ya resuelto; el error
  **integro** va al `ErrorLogger`, que es canal de servidor. Eso implica un `try/catch` en el
  borde, y no contradice el guardia de C.5: ese censo prohibe el `try/catch` **en los
  repositorios**, donde convertiria una base caida en un tablero de ceros. Aqui no se devuelve
  un cero: se devuelve `status: "error"`, que es un estado del contrato (design.md §5.2). El
  test lo fija por los dos lados (el fallo no es `ok` y la cadena no contiene `"0.00"`).
- **S20 · El fallo al RESOLVER LA SESION no se envuelve.** El `try/catch` cubre solo la llamada
  al servicio. Si `resolveActorFromSession()` revienta todavia no hay rango que citar, y
  devolver `status: "error"` sin contexto seria peor que dejarlo propagar: un fallo de
  autenticacion no es un fallo de la metrica, y confundirlos manda a investigar al sitio
  equivocado.
- **S21 · El borde acepta un tercer parametro `deps` (patron `lib/actions/ranking.ts`).** Es
  como el repo inyecta actor, servicio y reloj en las Server Actions ya existentes. No es una
  puerta: una funcion no cruza la frontera RSC, asi que un cliente no puede enviar un servicio;
  y ninguna de las tres dependencias concede acceso — el permiso lo decide siempre
  `prepararConsultaAnalitica` con el actor que la sesion devuelve. Sin esto, la unica forma de
  probar el borde seria mockear `next/headers`, que es justo lo que R15 quiere que nadie haga.
- **S22 · La integracion se sitúa en 2031 y las cuentas por pagar se miden por DIFERENCIA.** Seis
  de las ocho metricas se aislan poniendo la ventana en una fecha donde la base de desarrollo no
  tiene ni una fila (comprobado por asercion: `"0.00"` antes de sembrar), asi que las cifras que
  se afirman son exactamente las sembradas. Las dos cuentas por pagar **no pueden** aislarse asi
  —ignoran `desde` por diseño ⟨D3⟩ y leen el libro entero hasta el corte—, y por eso ahi se
  consulta antes y despues de sembrar y se afirma la **diferencia**, con `Prisma.Decimal` y no
  con `Number`: en dinero, tampoco en un test.
- **S23 · Toda la integracion corre en `enTransaccionRevertida`.** Ni una fila sobrevive al test,
  pase, falle o muera el proceso. Lo unico que se lee de la base preexistente son dos `usuario` y
  una `zona`, y solo para satisfacer las FKs. Si no hay `DATABASE_URL` alcanzable el archivo
  entero se salta (patron `tests/integration/db/_postgres-real.ts`): la suite tiene que seguir
  siendo verde en una maquina sin Postgres.

---

## Contradicciones y hallazgos AL IMPLEMENTAR (desde C8)

### C8 · E.4 encontro una fuga REAL en el servicio, y se arreglo (no se aflojo el test)

`GrupoCierrePorEstado` es un **alias** de `FilaConciliacion` (asi lo dejo la TANDA A, y su propio
comentario avisa: «si el DTO gana un campo derivado, esta herencia deja de valer»). Aprovechando
eso, `deConciliacion` devolvia `porEstado` **tal cual llega del repositorio**. Compila, es
gratis, y convierte el DTO en el objeto que construyo la capa de datos: cualquier columna de mas
que ese objeto acabe llevando —un `select` que se amplia, un `groupBy` con una clave extra—
cruza al cliente sin que nada falle.

El barrido de E.4 lo demostro a la primera: de las ocho metricas, `conciliacion_cierres` era la
**unica** que dejaba salir el `mensajeroId` sembrado.

**Se arreglo el servicio, no el test.** `soloLoDeclarado` copia los seis campos declarados, uno a
uno, sin `...grupo`: es una lista blanca, y lo que no este escrito ahi no sale. Es un cambio de
un archivo de la TANDA D hecho desde la E, y esta es la justificacion por escrito. La mutacion
M58 —volver a `porEstado` a secas— pone rojo el barrido, asi que la proteccion queda medida y no
solo escrita.

> Vale la pena decir en voz alta lo que esto significa sobre el metodo: el test escrito «como
> pide E.4» (cadena serializada completa, no campo por campo) encontro en su primera ejecucion
> un fallo que ninguno de los 100 tests anteriores de la feature veia. El campo por el que se
> escapaba era, en efecto, uno que nadie habia pensado en mirar.

### C9 · El segundo caso de F.2 no lo mata la mutacion de F.2 — y esta bien asi

El "hecho cuando" de F.2 es «usar medianoche UTC en vez de `rango.desde` pone el test rojo», y lo
pone (M62). Pero el **segundo** caso que escribi —el corte de `hasta` es exclusivo, con una fila
en el instante exacto `06:00:00Z`— **sobrevive** a esa mutacion: con ventanas de medianoche UTC
esa fila sigue cayendo en el dia correcto por casualidad. No es un test vacio: lo mata otra
mutacion (M63, `lt` → `lte`). Queda anotado porque un caso que solo muere con una mutacion
distinta a la que su tarea nombra es informacion, no ruido: son dos fronteras distintas
(el **desplazamiento** de la ventana y su **cierre**) y hacen falta las dos mutaciones para
cubrirlas.

### C10 · R36 podia quedarse sin test, y no se quedo

R36 es un requisito sobre el proceso («cada `R` mapeado en `progress/impl_127.md`») y la salida
honesta habria sido declararlo hueco. Pero la parte que importa **si** es ejecutable: el guardia
de trazabilidad lee la tabla del mapa, exige los 43 numeros sin saltos ni repetidos y comprueba
que **cada archivo de test citado existe en el arbol**. Borrar una fila (M70) y apuntar a un test
inexistente (M71) lo ponen rojo. Lo que el guardia **no** puede comprobar, y queda dicho en su
cabecera para que nadie lo suponga, es que el test citado mida de verdad ese requisito: eso lo
sostienen las mutaciones, no un guardia de texto.

### Sin novedad sobre el rollup, el alcance del dinero y el catalogo

Nada de E ni de F empujo a leer `analytics_daily` (R42 de la 124), ni a escribir un adaptador de
alcance para las tablas de dinero (R25 de la 122), ni a tocar `lib/analytics/metrics.ts`. **No
hizo falta un tercer cambio en el catalogo**, que era la pregunta que esta sesion tenia que
contestar de forma explicita: la respuesta es **no**.

---

## Evidencia de mutacion (M52–M71)

Regla de casa: un test que no se pone rojo cuando se muta lo que dice medir es una asercion
vacia. Cada "hecho cuando" de E y F esta escrito como mutacion y se aplico. **Las 20 se
revirtieron con verificacion byte a byte** (`cmp` via respaldo + comparacion de buffers); `git
status` al cerrar no muestra ningun archivo rastreado modificado fuera de los tres de la tabla
de arriba.

### TANDA E — el borde

| # | Mutacion | Requisito | Resultado |
|---|---|---|---|
| M52 | se retira la llamada explicita a `logger.logError` en el `forbidden` | R11 | **11 rojos** de 47 |
| M53 | el `motivo` se propaga al cuerpo del 403 | R12 / R42 | **15 rojos** de 47 |
| M54 | el borde importa `next/headers` y lee la cookie por su cuenta | R15 | **1 rojo** de 17 |
| M55 | tambien se auditan los `validation_error` | R13 | **3 rojos** de 17 |
| M56 | la entrada malformada se responde como 403 | R13 | **3 rojos** de 17 |
| M57 | el registro de auditoria pierde el motivo real (se clava `sin_sesion`) | R42 (la otra mitad) | **6 rojos** de 30 |
| M58 | el servicio reenvia la fila del repositorio en la conciliacion | R14 | **1 rojo** de 47 — **es C8** |
| M59 | el barrido deja de sembrar el uuid (`conFuga` no hace nada) | R14 / conjunto vacio | **2 rojos** de 30 |
| M60 | el mensaje de error reenvia el texto original del fallo (con PII) | R32 | **1 rojo** de 17 |
| M61 | el fallo se silencia y se devuelve `"0.00"` | R32 | **3 rojos** de 17 |

### TANDA F — la integracion contra Postgres

| # | Mutacion | Requisito | Resultado |
|---|---|---|---|
| M62 | la caja construye la ventana con **medianoche UTC** en vez de `rango.desde` | R26 / F.2 | **1 rojo** de 13 |
| M63 | el corte por `hasta` pasa a inclusivo (`lt` → `lte`) | R26 / F.2 | **1 rojo** de 13 |
| M64 | el cierre se fecha por `solicitado_at` | R26 / F.3 / ⟨D2b⟩ | **1 rojo** de 13 |
| M65 | el `neto` de la caja copia el `bruto` | R37 / F.4 | **2 rojos** de 13 |
| M66 | los cierres NO resueltos aportan importe a `cod_recaudado` | R25 / F.5 | **2 rojos** de 13 |
| M67 | la vista por metodo se declara `sumableCon` la de tienda | R38 / F.6 | **2 rojos** de 33 |
| M68 | `sembrarCaja` no inserta nada | conjunto vacio | **5 rojos** de 13 |
| M69 | `sembrarCierreDia` no inserta nada | conjunto vacio | **4 rojos** de 13 |

### F.7 — el mapa

| # | Mutacion | Requisito | Resultado |
|---|---|---|---|
| M70 | se borra la fila de R14 del mapa | R36 | **1 rojo** de 5 |
| M71 | una fila del mapa apunta a un test que no existe | R36 | **1 rojo** de 5 |

### «Ningun test pasa por conjunto vacio» — repetido sobre lo nuevo (patron M23)

Es el modo de fallo que mordio en la 122 y en la 123, y en integracion es peor: un test que no
sembro lo que cree haber sembrado **pasa vacio y parece verde**. Cuatro vias:

1. **M68 y M69** son la prueba directa: con las dos funciones de siembra convertidas en no-ops,
   caen 5 y 4 de los 13 casos de integracion.
2. **M59** hace lo propio en el barrido de identidad: sin uuid sembrado, 2 rojos.
3. El primer caso de integracion afirma que la ventana de 2031 esta **vacia antes de sembrar**
   (`"0.00"`), asi que las cifras que despues se comparan son exactamente las insertadas y no un
   resto de la base de desarrollo.
4. Cada bloque nuevo lleva su ancla explicita: el barrido exige que las ocho respuestas sean `ok`
   y contengan un importe distinto de cero (`/"[^"]*":"-?\d*[1-9]\d*\.\d{2}"/`); el guardia de
   trazabilidad exige ≥ 12 archivos de test distintos citados; el borde exige que el camino
   concedido haya consultado de verdad (`consultasHechas() > 0`) y traiga la cifra correcta.

---

## Verificacion (medida, no supuesta)

```
$ pnpm exec tsc --noEmit
(sin salida)  exit=0

$ pnpm exec eslint <los 5 archivos creados + los 2 modificados de codigo/test>
exit=0   (0 errores, 0 warnings)

$ pnpm exec vitest run tests/unit/analytics tests/unit/services tests/unit/actions --maxWorkers=2
 Test Files  205 passed (205)
      Tests  3196 passed (3196)

$ pnpm exec vitest run tests/integration/actions/analitica-financiera-action.test.ts --maxWorkers=2
 Test Files  1 passed (1)
      Tests  13 passed (13)
```

```
$ pnpm exec vitest run tests/unit/analytics tests/unit/services --maxWorkers=2
 Test Files  166 passed (166)
      Tests  2728 passed (2728)
```

Baseline de esta sesion, medido antes de empezar: `tests/unit/analytics` + `tests/unit/services`
= **164 archivos / 2693 tests, 0 rojos**. Ahora **166 / 2728** en esos dos directorios (+2
archivos: el guardia del borde y el de trazabilidad; +35 tests) y **205 / 3196** añadiendo
`tests/unit/actions`, donde vive el tercer archivo nuevo.

### La suite completa

```
$ pnpm exec vitest run --maxWorkers=2
 Test Files  795 passed (795)
      Tests  9681 passed (9681)
   Duration  ~600s
```

**795 archivos contra los 791 de la referencia de la rama** (+4: los tres de la TANDA E/F que
recoge `include` mas el de trazabilidad). El conteo **sube**, la corrida no reporto *unhandled
errors* ni arranques fallidos de fork, y **no hay ni un rojo**. El flake conocido y ajeno
(`tests/integration/wallet-tiendas-desglose.test.tsx`, que cae por timeout bajo saturacion) pasó
esta vez dentro de la corrida completa; no se toco.

Y la misma corrida, esta vez a traves del gate:

```
$ ./init.sh
✓ typecheck paso · ✓ lint paso
 Test Files  795 passed (795)
      Tests  9681 passed (9681)
✓ test paso · ✓ todas las migraciones tienen down.sql · ✓ .env presente
== init OK ==                                    exit=0
```

(La 127 no añade migraciones: es una feature de **lectura**, sin tabla, sin columna y sin cambio
de RLS —`design.md §2`—, asi que la comprobacion de `down.sql` pasa por no tener nada nuevo que
comprobar.)

**Los seis guardias siguen verdes.** Los cinco de la TANDA B sin tocarlos —el borde entro solo a
los censos de B.1 (fuente) y B.2 (alcance), porque `lib/actions/analitica-financiera.ts` ya
estaba en sus listas de archivos declarados desde el primer dia— y el de C.5 (repositorios)
tampoco se movio.

---

## Lo que NO se ha hecho

- **F.8**, entera: sincronizar con `dev` y abrir el PR. Es del leader.
- Dos notas para quien la haga:
  1. El merge tiene que mirar `lib/analytics/metrics.ts` **con cuidado**: es archivo ajeno,
     catalogo de la 135 y fuente unica de trece features. Su diff son **exactamente** las dos
     entradas autorizadas (⟨D8⟩ y ⟨D10⟩, humano, 2026-08-02) y **esta sesion no lo toco**.
  2. El cuerpo del PR tiene que citar las dos autorizaciones fechadas, y conviene que cite
     tambien **C8**: la feature corrige una fuga de identidad que su propio guardia de borde
     encontro, y ese es el tipo de cosa que un revisor quiere ver señalada y no enterrada en el
     diff.
- **C6 sigue abierta** (de la sesion D): el comentario que hay encima de `estadoProduccion` en
  `egresos` quedo desactualizado y no se corrigio a proposito, porque la autorizacion acota el
  diff de `metrics.ts` a dos cosas. Pendiente de una linea de visto bueno humano.
