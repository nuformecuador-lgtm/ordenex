# review 179 — analitica: cache financiera + invalidacion por ledger

> Reviewer, 2026-08-10. Worktree `C:/w179`, rama `feature/179-analitica-cache-financiera`.
> Base de la rama: `871e6c5d` (merge-base con `origin/dev`).
>
> **VEREDICTO: RECHAZADO.** Un (1) hallazgo bloqueante, y no toca codigo de produccion: es el
> endurecimiento del propio censo (R17/R18), la pieza sobre la que descansa la feature entera.
> Todo lo demas —los ocho invalidadores, la politica por metrica, la retirada del guardia R15 de
> la 128 y la derogacion de la mitad de R30 de la 180— lo doy por **verificado y bien hecho**.

---

## 0. Como se reviso

- Leidos enteros: `specs/179-analitica-cache-financiera/{requirements,design,tasks}.md`,
  `progress/impl_179.md` (las dos bitacoras, T1-T2 y T3-T5 + §9/§10), `CHECKPOINTS.md`, y el
  material heredado de la 128 (guardia R15, D2) y de la 180 (R30).
- **La suite completa NO se re-corrio**: el leader la dejo medida en **1058/1058 archivos y
  12.976/12.976 tests**, typecheck y lint limpios, cero flakes. Aqui solo se corrieron los
  subconjuntos necesarios para comprobar hallazgos (todos verdes, ver §4) y **se aplicaron
  sondeos de mutacion propios**, revertidos: `git status --porcelain` quedo vacio y el censo
  volvio a sus 21 casos verdes.

---

## 1. Checklist de `CHECKPOINTS.md`

| punto | estado | nota |
|---|---|---|
| `requirements.md` con EARS numerados | **OK** | 28 R + D1-D4 cerradas por el humano el 2026-08-10 |
| `design.md` con alternativas descartadas | **OK** | §10: diez alternativas con su porque, incluidas las que D1/D3/D4 cierran |
| `tasks.md` con todas las tasks `[x]` | **menor** | el archivo no usa casillas: solo T0.1 lleva «HECHA». Formalmente no se cumple; materialmente T1-T5 estan hechas y **T0.2 nunca se midio** (bitacora §7) |
| cada `R<n>` mapea a un test concreto | **OK con matices** | tabla en §2; R7 y R25 tienen matiz declarado |
| `progress/impl_<feature>.md` con el mapa | **OK** | partido en dos bitacoras (T1-T2 y T3-T5); el archivo es `impl_179.md`, no el que `tasks.md` T6.1 anuncia. Menor |
| typecheck sin errores | **OK** | medido por el leader; sin cambios desde entonces |
| lint sin errores | **OK** | 57 warnings preexistentes (`no-unused-vars` con `_`), 0 errores |
| tests pasan | **OK** | 12.976/12.976 (leader) + los subconjuntos re-corridos aqui |
| E2E si toca flujo critico | **n/a** | no cambia ningun flujo de usuario: es cache + invalidacion. Ni un DTO, ni una cifra, ni una ruta |
| RLS en tablas nuevas | **n/a** | **no hay tablas nuevas ni migracion**: D2 = (a) reusa el valor de enum `analitica_invalidacion_cache` de la 128. `db/` no aparece en el diff |
| migraciones reversibles | **n/a** | idem |
| sin secretos hardcodeados | **OK** | el unico `process.env` es `ANALITICA_CACHE_DISABLED` via `analitica-cache.ts` (128) |
| webhooks con firma e idempotencia | **n/a** | no hay webhooks. El job SI es idempotente por `dedupe_key` |
| controller sin queries ni negocio | **OK** | las Server Actions solo cambian `buildService` (composition root) |
| service sin HTTP | **OK** | ni un `Request`/`Response` en los ocho escritores |
| repository sin logica | **OK** | y **se respeta a proposito**: la invalidacion NO se metio en los tres repositorios de ledger (design §10, alt. 3) porque ahi correria dentro de la `tx` (R8) |
| interfaces en `lib/interfaces/` | **OK** | `IAnaliticaCache` ampliado solo en su dominio cerrado `OrigenInvalidacion` (3 -> 11 valores) |
| permisos en servidor | **n/a** | el decorador recibe la consulta **ya autorizada y recortada** por la 122; no puede cachear un 403 (design §10, alt. 2) |
| sin hardcode de pais/moneda/cuenta | **OK** | ningun literal de contexto en el diff |
| `./init.sh` en verde | **OK** | 1058/1058 · 12.976/12.976 (leader) |
| `progress/review_<feature>.md` con veredicto OK | **NO** | este archivo: **RECHAZADO** |
| entrada en `progress/history.md` | pendiente | del leader, al cerrar |

---

## 2. Trazabilidad `R<n> -> test`

Construida **leyendo el caso**, no contando menciones. Todos los archivos citados existen y se
corrieron aqui (§4).

| R | test que lo verifica | veredicto |
|---|---|---|
| **R1** | `cache-financiera-equivalencia.test.ts` — un caso por metrica del catalogo, igualdad profunda MISS vs HIT vs servicio desnudo | **cubierto** |
| **R2** | `cache-financiera-decorador.test.ts` › «la segunda consulta se sirve entera desde cache» + el caso anti-vacio de dos consultas distintas | **cubierto** |
| **R3** | `cache-financiera-json.test.ts` (round-trip real, por metrica) + `cache-financiera-json.guardia.test.ts` (lectura estatica del contrato) | **cubierto** — las dos mitades hacen falta: el guardia estatico es el unico que cae el dia en que se ESCRIBE un campo `Date`, no el dia en que se llena |
| **R4** | `cache-financiera-decorador.test.ts` › `dominio_invalido` y fallo de repositorio: `tamano()===0` y el interno vuelve a ser preguntado | **cubierto** |
| **R5** | `cache-financiera-clave.test.ts` — alcance, rango resuelto, orden de ids, espacio de nombres | **cubierto, con matiz** (menor M6) |
| **R6** | `cache-tags.guardia.test.ts` (128, sin tocar). Verificado a mano: `analitica:financiera` solo aparece en `lib/analytics/metrics.ts:748` y en `metrics.test.ts` | **cubierto** |
| **R7** | sin test propio **a proposito**: es el enunciado del que cuelgan R9-R15 y R26 | **cubierto por delegacion** (menor M5) |
| **R8** | `cache-financiera-invalidacion-orden.test.ts` (secuencia de eventos con doble de transaccion) | **cubierto por test en 1 de 8 puntos**; los otros siete verificados por lectura (menor M1) |
| **R9** | `cache-financiera-escritor-egreso.test.ts` — alta, reverso, y reverso ya aplicado que NO invalida | **cubierto** |
| **R10** | `cache-financiera-escritor-manual.test.ts` — el escritor que la ficha se dejo fuera | **cubierto** |
| **R11** | `cache-financiera-escritor-liquidacion.test.ts` — tienda, mensajero, anulacion, `forbidden` que no invalida, y **el cableado del composition root** | **cubierto** |
| **R12** | `cache-financiera-escritor-gastos-fijos.test.ts` — cinco pasos contra `handleGenerarGastosFijos` real + «cero egresos no invalida» + reejecucion | **cubierto** |
| **R13** | `cache-financiera-escritor-indemnizacion.test.ts` — aprobado con egreso + rechazo, `conflict` y tope | **cubierto** |
| **R14** | `cache-financiera-escritor-cierre-dia.test.ts` | **cubierto** |
| **R15** | `cache-financiera-escritor-cierre-bodega.test.ts`, en su propio archivo | **cubierto y MEDIDO aqui**: borrar su invalidacion deja `escritor-cierre-dia` VERDE y solo cae el suyo (§4) |
| **R16** | `cache-financiera-invalidacion-fallo.test.ts` — los dos extremos de D4: la aprobacion sigue `ok`, y el canal recibe `InvalidacionFinancieraFallida` con origen y tags, sin PII | **cubierto** |
| **R17** | `ledger-escritores.guardia.test.ts` — eje 1 (escritura cruda dentro de los tres repos), eje 2 por defecto/por exceso/conteo, 4 casos de discriminacion | **PARCIAL — ver BLOQUEANTE B1** |
| **R18** | `ledger-escritores.guardia.test.ts` › `it.each` de las ocho entradas | **PARCIAL — ver BLOQUEANTE B1** |
| **R19** | `ledger-escritores.guardia.test.ts` › el guardia de la 128 no existe / este censo si / la cache esta de verdad cableada | **cubierto** |
| **R20** | `cache-financiera-frontera.test.ts` — aridad, tipo de retorno, los cuatro estados del borde | **cubierto** |
| **R21** | `cache-aislamiento.guardia.test.ts` (128, sin tocar) | **cubierto** — ni los escritores ni el script importan `next/cache`; el CLI encola |
| **R22** | `cache-financiera-config.test.ts` — kill-switch, no placebo: con la bandera apagada devuelve el servicio DESNUDO | **cubierto** |
| **R23** | `cache-config.guardia.test.ts` (128, ampliado al archivo del decorador) | **cubierto** |
| **R24** | `cache-financiera-registro.test.ts` — los ocho origenes ejercidos de verdad, distintos, cuadrados con el registro, y el rastro barrido buscando ids | **cubierto** |
| **R25** | el guardia branch-scoped se escribio, paso 3/3 y **se retiro en el mismo PR** (T5.2/T5.3) | **sin testigo vivo, por diseño** — verificado a mano (menor M3) |
| **R26** | `backfill-caja-tesoreria-invalidacion.test.ts` — encola una vez si `insertadas > 0`; nada en seco, sin pendientes ni `--comprobar` | **cubierto** |
| **R27** | `cache-financiera-invalidacion-backfill.test.ts` — cinco pasos con drenado real, job sin `dominio` -> operativa, dominio desconocido -> default, claves que no colisionan, y **el job SI falla si la invalidacion lanza**. El testigo `cache-invalidacion-backfill.test.ts` de la 128 sigue **sin modificar** | **cubierto** |
| **R28** | `cache-financiera-politica.guardia.test.ts` (cuadre por exceso y por defecto) + `cache-financiera-conciliacion.test.ts` (la exclusion medida sobre el COMPORTAMIENTO: la base se consulta dos veces y el `ErrorLogger` emite dos) | **cubierto y MEDIDO aqui** (§4) |

**Ningun requisito se queda sin test.** Los dos parciales (R17/R18) son el bloqueante.

---

## 3. Hallazgos

### BLOQUEANTE

**B1 — El censo (R17/R18) obliga a REGISTRARSE, no a INVALIDAR: una entrada con `invalidadores: []`
y `requisitos: []` pasa en verde.** Es exactamente el auto-engaño que R18 se escribio para impedir
—«sin R18, R17 se satisface escribiendo una linea en un array: el registro seria una promesa, no
una prueba» (`requirements.md` R18)— y hoy sigue abierto.

**Medido, no razonado.** Sondeo aplicado y revertido en `C:/w179`:

1. Se creo un noveno escritor sintetico (`lib/services/__ProbeNovenoEscritorService.ts`) que llama
   a `repo.crearMovimientos(...)` y **no invalida nada**.
   -> El censo lo caza: **2 casos rojos** (eje 2 «por DEFECTO» y el conteo de ocho). Esta mitad
   funciona y es la que la spec anuncia.
2. Se registro ese escritor en `ESCRITORES_DE_LEDGER` con `invalidaEn: []`, `invalidadores: []`,
   `requisitos: []` y `tests: ["tests/unit/analytics/cache-financiera-escritor-egreso.test.ts"]`
   —un test **ajeno**, que no lo cubre— y se subieron los dos conteos de `8` a `9`, que es
   justamente lo que el mensaje de fallo del guardia le pide a quien añade un escritor.
   -> **`Test Files 1 passed · Tests 22 passed`. Verde entero.**

O sea: el noveno escritor queda censado, sin invalidador, sin test propio, y el guardia dice que
todo esta bien. Las tres puertas que lo permiten:

- `escritor.invalidadores` **nunca se comprueba no vacio** (ni se comprueba nada de su contenido);
- `escritor.requisitos` tampoco, y como el chequeo de titulos de R18 es un `for` sobre esa lista,
  **con la lista vacia R18 se vuelve vacuo**;
- `escritor.invalidaEn` **no lo lee ningun test**: hoy es prosa.

R17 pide textualmente que cada llamador aparezca «con el invalidador que le corresponde» y R18 que
el test nombrado «declare el escritor cubierto». Ninguna de las dos cosas se mide.

**Que falta para cumplirlo** (todo dentro de
`tests/unit/analytics/ledger-escritores.guardia.test.ts`, **cero cambios en codigo de produccion**):

1. `expect(escritor.invalidadores.length).toBeGreaterThan(0)` y
   `expect(escritor.requisitos.length).toBeGreaterThan(0)`, con mensaje que diga por que.
2. `expect(escritor.invalidaEn.length).toBeGreaterThan(0)` y que cada ruta de `invalidaEn` **exista
   en disco**.
3. La que de verdad cierra el agujero, y es barata porque el arbol ya esta censado: para cada
   invalidador `clase: "directo"`, comprobar que **algun** archivo de su `invalidaEn` contiene
   `invalidarAnaliticaFinanciera(` **y** el literal de su `origen`. Para `por_job`, que el archivo
   nombrado encole; para `por_decorador`, lo de M2. Con eso, «registrarse sin invalidar» deja de
   pasar el guardia y el censo mide lo que su cabecera promete.

Mientras esto no este, la frase de `design.md §6` —«no hace falta que nadie se acuerde de esta
feature»— es cierta solo a medias: el noveno escritor no puede pasar **inadvertido**, pero si puede
pasar **sin invalidador**, que es el modo de fallo que la 128 dejo prohibido con su R15.

### Menores

**M1 — R8 tiene test en 1 de los 8 puntos.** `cache-financiera-invalidacion-orden.test.ts` mide la
secuencia solo en la liquidacion (donde ademas ya es una imposibilidad estructural: el decorador no
ve la `tx`). Para los otros siete **verifique a mano** que la llamada esta despues del retorno del
repositorio/`$transaction` y que las ramas sin escritura no invalidan:
`WalletEgresoService.ts:81` y `:130` (tras `crearMovimientos`, y el reverso despues del
`count === 0`), `WalletService.ts:207`, `GeneracionGastosFijosService.ts:93` (dentro de
`egresosGenerados > 0`), `IncidenteAdminService.ts:470` (rama `res === "updated"`),
`CierresAdminService.ts:516` y `CierresBodegaAdminService.ts:316` (idem). **R8 se cumple hoy en los
ocho.** Lo que no existe es un detector: un escritor futuro que invalide dentro de su `tx` no lo
caza nadie —los tests de cinco pasos no lo verian, porque su doble confirma igual—. La bitacora lo
declara (§8). Remedio barato: un caso estatico que exija que ningun `invalidarAnaliticaFinanciera(`
caiga dentro de un callback de `$transaction`.

**M2 — El invalidador `por_decorador` depende de que el composition root envuelva, y el unico
testigo es un regex sobre un archivo concreto.** `cache-financiera-escritor-liquidacion.test.ts`
comprueba que `lib/actions/liquidacion.ts` case el patron
`decorarLiquidacionConInvalidacion( new LiquidacionService( ... crearAnaliticaCacheDeNext()`.
Si mañana alguien construye `LiquidacionService` en **otro** composition root sin envolverlo, no
falla nada: el censo lo seguiria viendo registrado y ese regex mira un solo archivo. Comprobado que
hoy el riesgo es teorico —`new LiquidacionService(` aparece en **un solo** sitio de produccion
(`lib/actions/liquidacion.ts:92`); los demas son tests—. La debilidad esta declarada en tres sitios
(cabecera del decorador, `motivo` de su entrada en `escritores-ledger.ts`, bitacora §9.1), que es lo
que la salva de ser bloqueante. Remedio, del mismo tamaño que B1.3: censar `new LiquidacionService(`
en `lib/`, `app/` y `scripts/` y exigir que **toda** ocurrencia este envuelta.
**La asimetria en si (siete dentro del servicio, uno por decorador) me parece la decision correcta**
y no un atajo: la alternativa era relajar el R68 de la 172 o uniformar los ocho perdiendo la
garantia fuerte en siete sitios donde no hay frontera ajena que respetar. Esta escrita donde un
lector la va a encontrar.

**M3 — R25 se queda sin testigo vivo, y su guardia se retiro ANTES de los ultimos cambios.** El
branch-scoped `cache-financiera-frontera.guardia.test.ts` se corrio (3/3) y se retiro en T5.2/T5.3
—correcto, es la leccion del repo—, pero eso ocurrio **antes** de la ronda §9/§10, que añadio
`LiquidacionConInvalidacionService.ts` y toco `liquidacion-money-safe.test.ts`, `impl_180.md` y
`specs/180-*/requirements.md`. Esos archivos nunca pasaron por el guardia. **Lo verifique a mano**
cruzando los 59 archivos del diff `871e6c5d..HEAD` contra `design.md §2`: todo el codigo esta
declarado (con cuatro ampliaciones de frontera **escritas antes de tocar**, cada una con su motivo);
lo unico fuera de §2 es contabilidad —`feature_list.json`, `progress/impl_179.md`,
`progress/impl_180.md`, `specs/180-*/requirements.md`— y las tres ultimas estan declaradas en la
bitacora §9.6. **R25 se cumple materialmente.**

**M4 — El spec dice «las ocho metricas» y son DIEZ.** R1, R3, D1 y `design.md §4bis` arrastran el
numero viejo; el catalogo sirve diez desde la 173 (`dinero_en_caja`, `ganancia_ordenex`). No se
forzo nada —todos los tests enumeran desde `listarMetricas({ dominio: "financiera" })` y la politica
declara las diez—, pero el spec deberia corregirse para que deje de mentir. Lo declara la bitacora
§4(a) y nadie lo arreglo.

**M5 — R7 no tiene test propio.** Es deliberado y esta escrito («es el enunciado del que cuelgan
R9-R15/R26»). Se acepta: los ocho puntos si tienen el suyo.

**M6 — La mutacion de R5 no es alcanzable hoy con una metrica financiera.** Las diez declaran
`ALCANCE_FINANCIERA`, que es `prohibido` para `adminSatelite`/`adminTienda`/`mensajero`: los dos
roles que llegan resuelven a `{ tipo: "global" }`. El test prueba la propiedad de la funcion
`claveFinanciera` con metricas cuyo alcance si varia, y lo dice en su cabecera. R5 vale como defensa
en profundidad; **el spec lo redacta como si fuera hoy una frontera multi-tenant viva y no lo es**.
Declarado por el implementer (§4.b).

**M7 — Contabilidad del proceso.** (a) `tasks.md` no marca `[x]` ninguna task; (b) **T0.2 nunca se
midio** —no hay baseline de `./init.sh` en esta rama previo a tocar nada—, asi que el «delta 0» de
T6.2 no tenia contra que medirse: lo salva que el gate final es **100% verde absoluto**, que no
necesita baseline; (c) el mapa de T6.1 vive partido en dos secciones de `progress/impl_179.md`, no
en el archivo que `tasks.md` nombra. Nada de esto afecta al codigo.

**M8 — Nota, no hallazgo: la derogacion de R30 de la 180 es honesta.** Se partio el requisito en sus
dos mitades, la primera sigue medida por `cache-tags.guardia.test.ts` (128) y la segunda se derogo
**con motivo y fecha** en los dos sitios (`specs/180-*/requirements.md` bajo R30 y
`progress/impl_180.md` §5 y §9), sin borrar la fila del mapa y sustituyendo el testigo por el censo.
La deuda que queda —nadie mide «la 180 no toco la invalidacion»— **ya estaba declarada en
`impl_180.md §9` antes de este PR**: se hereda, no se abre. `financiera-180-trazabilidad.guardia`
verde. **Conforme.**

**M9 — Nota: la retirada del guardia R15 de la 128 (R19) esta bien ejecutada.** El sustituto no se
«parece» al retirado: donde aquel **prohibia** cachear dinero, este **obliga** a que los ocho puntos
tengan invalidador declarado, y R19 comprueba por sistema de archivos que no puedan convivir ni
faltar los dos, mas que la cache este de verdad cableada. La unica reserva es B1: la obligacion es
hoy mas debil de lo que su cabecera promete.

---

## 4. Verificacion ejecutada por mi (no heredada)

`./init.sh` completo **no** se re-corrio (el leader lo dejo en 1058/1058 archivos y
12.976/12.976 tests, typecheck y lint limpios). Aqui, sobre ese mismo arbol:

```
vitest run <26 archivos: los de la feature + los 7 de escritor + los guardias de la 128
            + liquidacion-alcance + liquidacion-money-safe + financiera-180-trazabilidad>
  -> todos verdes (12 + 14 archivos, 92 + 70 casos)

SONDEO 1 (B1) noveno escritor sintetico sin invalidar
  -> censo ROJO (2 casos)                                    [la mitad que funciona]
SONDEO 2 (B1) el mismo, REGISTRADO con invalidadores/requisitos vacios y un test ajeno
  -> censo VERDE 22/22                                       [el agujero]

MUTACION borrar la invalidacion de CierresBodegaAdminService
  -> escritor-cierre-bodega ROJO (2) + registro ROJO (2); escritor-cierre-dia VERDE
     [la propiedad «ninguno comparte test» se sostiene]
MUTACION borrar una entrada de POLITICA_CACHE_FINANCIERA
  -> politica.guardia ROJO (3 de 6): por DEFECTO, el caso anti-vacio y «es la UNICA excluida»
     [la ausencia de decision es de verdad roja: R28/D3 se sostiene]
```

Todos los sondeos se revirtieron: `git status --porcelain` **vacio** y el censo de vuelta en
21/21 verdes. **No se edito ni una linea de codigo ni de test de la entrega.**

---

## 5. Lo que NO pude verificar

1. **Que `./init.sh` siga verde despues de arreglar B1.** El arreglo es en un guardia, pero el gate
   completo hay que volver a correrlo antes del PR (regla 5 de `CLAUDE.md`).
2. **El merge con `origin/dev`.** La rama esta ~90 archivos por detras (feature 196, landing,
   `middleware.ts`, `db/schema.prisma`). Nada de eso toca la cache financiera, pero **el gate
   completo hay que correrlo DESPUES de reconciliar, no antes**, y eso aun no ha pasado.
3. **`lib/cache/next-analitica-cache.ts` en produccion**: la pulgada que ningun test unitario cubre.
   Limite ya declarado por la 128 (§11) y que esta feature no toca; sigue siendo el unico sitio
   donde «invalidar» significa de verdad `revalidateTag`.
4. **Que el SQL de `CierresAdminRepository` e `IncidenteAdminRepository` escriba lo que sus dobles
   fingen.** Los tests de cierre, bodega e indemnizacion escriben en el libro compartido desde el
   **doble** del repositorio: miden el enganche de la invalidacion, no la escritura. Lo declara la
   bitacora §8 y lo cubren las suites propias de esos repositorios y la integracion.
5. **El comportamiento real del backfill de tesoreria contra una base.** Se verifico el encolado y
   el drenado con dobles; la corrida real del CLI no se ejecuto.
6. **Si la politica declarada para cada metrica es la CORRECTA.** El guardia obliga a decidir, no a
   acertar (limite declarado en `design.md §4bis`). Solo el caso de hoy —`conciliacion_cierres`—
   esta medido sobre el comportamiento.

---

## 6. Veredicto

**RECHAZADO**, por **B1**.

Lo que hay que hacer para que esto sea `APROBADO`: endurecer
`tests/unit/analytics/ledger-escritores.guardia.test.ts` con las tres comprobaciones de B1
(invalidadores/requisitos/`invalidaEn` no vacios, `invalidaEn` existente en disco, y el cruce «el
archivo que dice invalidar contiene la llamada y su origen»), y demostrarlo con la mutacion que hoy
pasa en verde: **registrar un escritor sin invalidador debe poner el censo rojo**. Opcionalmente, y
en el mismo sitio, M2 (censar `new LiquidacionService(` y exigir que toda ocurrencia este envuelta)
y M1 (que ninguna invalidacion caiga dentro de una `$transaction`).

**No hay que tocar codigo de produccion.** Los ocho invalidadores, el decorador de lectura, la
politica por metrica, el job del octavo escritor y la retirada del guardia R15 estan bien, medidos
y —donde se desvian de otra spec (D4 vs R11 de la 128; R30 de la 180; R68 de la 172)— declarados
por escrito en el sitio donde el siguiente lector los va a encontrar. Lo unico que falta es que el
censo mida lo que su propia cabecera promete.
