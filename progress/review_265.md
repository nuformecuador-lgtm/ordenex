# Review — Feature 265 · el optimizador de ruta lee lo que el proveedor le dice

> Revisión de **solo lectura** sobre `dev` en **`96940710`**, contra `241f1842` (base de la ficha).
> Dos bloques: backend **PR #464** (`3d71497c`, `fb1f72d7`, `3277a9c9`, `2e66b6a1`) y frontend
> **PR #466** (`9c815607`, `60a11abc`). La **262** también entró en ese rango: **no se revisa**,
> pero donde interfiere se dice (hallazgo m9).
>
> **VEREDICTO: RECHAZADO** — 2 bloqueantes, 11 menores. Los dos bloqueantes son **baratos** y
> **ninguno es un defecto de comportamiento**: el código está sano, el gate completo está verde en
> mi propia corrida y no hay ni una red de tests ajena encogida. Lo que falla es (1) un requisito
> cuyo test **no muerde** —y el mapa dice que sí— y (2) el registro de tasks.

---

## 1 · Verificación ejecutable (hecha por mí, no leída de la bitácora)

`pnpm exec prisma generate --schema db/schema.prisma` antes de nada (el cliente vive en un
`node_modules` compartido por junction) y después `./init.sh` **completo**:

```
== Arnes SDD :: init (modo: completo) ==
-> pnpm run typecheck        ✓
-> pnpm run lint             ✖ 99 problems (0 errors, 99 warnings)  → ✓ lint paso
-> pnpm run test
 Test Files  1319 passed (1319)
      Tests  17793 passed | 26 skipped (17819)
   Duration  348.13s
✓ test paso
! migraciones sin down.sql: 20260814120000_ruta_optimizada_trazado
                            20260814140000_ruta_parada_tramo
                            20260814160000_ruta_tramo_vivo_at
== init OK ==
INIT_EXIT=0
```

- `INIT_EXIT=0` está escrito **dentro** del log, no detrás de un `echo`.
- **99 warnings, 0 errores**: los mismos que midieron los dos bloques; ninguno sale de esta ficha.
- La lista de «migraciones sin down.sql» **NO crece**: son las tres `ruta_*` del 2026-08-14 y la
  migración nueva **no aparece** (tiene su `down.sql`).
- Los **2 rojos** que dejó la bitácora del backend (enums de la base local, feature 262) **ya no
  existen**: se curaron al mergear la 262, tal como esa bitácora predijo. Confirmado, no supuesto.
- Árbol limpio al terminar (`git status --porcelain` vacío): no he tocado una línea de código.

---

## 2 · Checklist de `CHECKPOINTS.md`, punto por punto

| Punto | Estado |
| --- | --- |
| `specs/265-…/requirements.md` con EARS numerados | ✅ R1-R49, con sus anexos de puerta humana fechados |
| `design.md` con alternativa descartada y su porqué | ✅ **17** alternativas (A1-A17), todas razonadas |
| `tasks.md` y **todas** marcadas `[x]` | ❌ **0 de 43 marcadas** → **BLOQUEANTE B2** |
| Cada `R<n>` mapea a un test concreto | ❌ **R8 no** (test que no muerde) → **BLOQUEANTE B1**; los otros 48, sí (§4) |
| `progress/impl_<feature>.md` con el mapa `R → test` | ✅ uno por bloque, backend y frontend |
| `pnpm run typecheck` | ✅ |
| `pnpm run lint` (0 errores) | ✅ |
| `pnpm test` | ✅ 17.793 verdes |
| E2E de flujo crítico | ➖ **No aplica**: no hay harness E2E ejecutable en el repo y el reparto no está en la lista (auth/pagos/recaudo/ingesta/webhooks). Su sustituto es **F6**, hecho (ver m2) |
| RLS en tabla nueva | ➖ **No hay tabla nueva.** La columna cuelga de `ruta_optimizada`, con RLS habilitada sin policies desde su migración original; añadir una columna no toca esa superficie. Verificado en el `migration.sql` y en el test estático |
| Migraciones versionadas y **reversibles** | ✅ `20260822140000_ruta_secuencia_fuente/` con `migration.sql` **y `down.sql`** que dropea exactamente esa columna, y un test estático que lo fija |
| Sin secretos hardcodeados | ✅ `.env.example` documenta **nombres**, sin un solo valor |
| Webhooks con firma e idempotencia | ➖ No aplica: esta ficha no añade webhooks |
| Controller sin queries ni negocio | ✅ la action valida, delega y traduce; nada más |
| Service sin HTTP | ✅ el servicio no ve JSON del proveedor; el borde tipado sigue en `lib/clients/` |
| Repository sin lógica de negocio | ✅ escribe la columna en la misma transacción; `toSecuenciaFuente` solo estrecha el TEXT |
| Interfaces en `lib/interfaces/` por categoría | ✅ `external/`, `repositories/`, `services/`, con el espejo del literal razonado |
| Páginas protegidas validan en servidor | ✅ intacto: `sincronizarRuta` comprueba rol **antes** de parsear, y sus tests siguen igual |
| Componentes reciben datos por props | ✅ `RepartoModule` sigue server-driven, sin SWR |
| Mutaciones por Server Actions | ✅ |
| Sin hardcode de país/moneda/cuenta | ✅ el umbral es **configuración** (`RUTA_ORIGEN_MAX_KM`); la alternativa del recuadro de país (A5) está descartada por escrito |
| `./init.sh` en verde | ✅ (§1) |
| `progress/review_<feature>.md` con veredicto OK | ❌ este archivo: **RECHAZADO** |
| Entrada en `progress/history.md` | ❌ no existe (m8) |

---

## 3 · Lo que la ficha declaraba a deber: comprobado uno a uno

1. **P1/P5 se cierran sin resolver; schema defensivo y R7 tolerante.** ✅ **Cierto y escrito.**
   `respuestaSchema` declara los tres campos **todos opcionales** y los elementos de los dos arrays
   como `z.object({}).catchall(z.unknown())`: la forma interna **no se inventa**. R7 se implementa
   como `extraerCodigosDeSalto`, que reconoce **una clave `code` cuyo valor parece un código**
   (mayúsculas, dígitos y guion bajo; profundidad ≤ 3; tope de 3), no una forma supuesta. El caso
   «no viene ningún código» **tiene test propio** (R49: el motivo queda
   `optimizar ruta: paradas saltadas por el proveedor (servidas 0 de 6)`, sin hueco, sin
   `undefined`, sin lista vacía impresa) y el extractor se autocomprueba con seis casos, tres de
   ellos negativos: texto libre con coordenadas, identificador nuestro y número.

2. **`RUTA_ORIGEN_MAX_KM = 200` declarado SIN calibrar, y los ≈1.040 km como artefacto de pruebas.**
   ✅ **Cierto y escrito en los tres sitios**: anexo de `requirements.md` §2, `design.md` §15.2 y el
   comentario de contrato de `lib/config/route-optimization.ts`, que dice «M1 NO SE PUDO MEDIR» y
   «resulto ser UNA PRUEBA DEL PROPIO HUMANO, no evidencia de campo: que nadie lo cite despues como
   una medicion de la operacion real». Lo vigila `umbral-origen-declarado.guardia.test.ts`, que
   **muerde**: quita piezas y exige el nombre de la que falta, y le pasa un **árbol simulado** con
   el literal duplicado y con un alias (`MAX_ORIGEN_KM = 200`) exigiendo rojo. El barrido real
   recorre `lib/`, `app/` y `components/` y comprueba antes que el censo mira **más de 500
   archivos**, para que la cláusula no sea decorado.

3. **`RUTA_DEBUG_LOG` invierte su default.** ✅ **Verificado en el código.** `activo()` pasa de
   `!== "0"` a **lista blanca**: solo `1` o `true` encienden; un typo, la variable vacía o ausente
   dejan la traza **apagada**. La variable sigue sirviendo para **encenderla** a propósito y
   `.env.example` lo documenta con la advertencia de que vuelca coordenadas de entrega.
   **`tests/setup/jest-dom.ts:28` se conserva con su nota**, que explica que hoy es redundante y por
   qué se deja (fija la propiedad aunque alguien vuelva a invertir el default). Y hay test en las
   dos direcciones: apagada no imprime **ni una** línea, encendida sí, incluido el caso **variable
   ausente**.

4. **`F6` se hizo en local, no en preview, y su punto 3 quedó a medias.** ✅ **Cierto y declarado**
   (frontend §6 y §8.1), con transcripciones de los cinco puntos y la consulta de solo lectura
   devolviendo `origen_fuente = centroide` y `secuencia_fuente = local`. Ver **m2**.

5. **La tercera señal de R43 no es un texto.** ✅ **Cierto y declarado** (frontend §3.3 y §8.4). El
   test afirma los **dos** textos presentes y distintos —`aviso.contains(origen) === false` y
   ninguno menciona el hecho del otro— y la tercera **por la geometría** que llega al mapa
   (`trazado.fuente === "local"` en las props de `RutaMapaInner`). Ver **m3**.

---

## 4 · Mapa `R<n> → test`, verificado archivo a archivo

Leídos los tests, no el mapa de la bitácora. Abreviaturas: `google` =
`tests/unit/clients/google-route-optimization.test.ts`; `fallback` =
`…/fallback-route-optimization.test.ts`; `servicio` =
`tests/unit/services/optimizacion-ruta-service.test.ts`; `origen` = `…/optimizacion-ruta-origen.test.ts`;
`cadena` = `…/optimizacion-ruta-degradacion.test.ts`; `repo` =
`tests/integration/repositories/ruta-optimizada-repo.test.ts`; `migración` =
`tests/integration/db/ruta-secuencia-fuente-migracion.test.ts`; `reparto` =
`tests/components/RepartoModule.test.tsx`; `botón` = `tests/components/SincronizarRutaButton.test.tsx`.

| R | Test que lo defiende | ¿Muerde? |
| --- | --- | --- |
| R1 | `google` → «los TRES campos se leen de verdad»: enciende la traza y afirma el payload exacto | ✅ el único que muere si se quita un campo del schema |
| R2 | `google` → «una respuesta SANA sin … sigue siendo ok» | ✅ |
| R3 | `google` → «la decision NO depende de la forma interna» + «R3 bis: `skippedShipments` VACIO … degrada igual» | ✅ el bis mata «decidir por `.length`» |
| R4 | `google` → afirma «paradas saltadas por el proveedor» **y** que NO dice «forma inesperada» | ✅ |
| R5 | `google` → el detalle contiene «servidas 0 de 6» | ✅ |
| R6 | `google` → igualdad **exacta** del motivo + 8 prohibidos (token, proyecto, host, coordenadas, ordenId, texto libre) | ✅ |
| **R8** | `google` → el test llamado R8 afirma **solo** el `status: ok` | ❌ **no muerde** → **B1** |
| R7 | `google` → «con codigos reconocibles, se citan LOS CODIGOS» + autocomprobación del extractor | ✅ |
| R9 | `fallback` → tres casos (0, 4 y 5 de 6) delegan en el cálculo local · `cadena` | ✅ |
| R10 | `fallback` → «la secuencia devuelta cubre TODAS», con Haversine **real** · `servicio` → «no persiste nada …» · `cadena` | ✅ es la red de repuesto del test reescrito |
| R11 | `fallback` (4 de 6) · `google` («servir ALGUNAS») | ✅ |
| R12 | `fallback` → «avisa con CONTEOS y sin PII» | ✅ |
| R13 | `cadena` → el handler **no lanza** + mitad negativa «un fallo de VERDAD sigue lanzando» | ✅ |
| R14 | `fallback` → mitad negativa: `transitorio` y `config_invalida` NO degradan · `google` (los otros tres `throw` intactos) | ✅ |
| R15 | `cadena` → la persistida cubre las tres y `marcarDesactualizada` no se llama · `servicio` (R24) | ✅ |
| R16 | `origen` → «se llama al proveedor con el CENTROIDE, no con el origen lejano» | ✅ afirma el **argumento** |
| R17 | `origen` → ídem + «`>` y no `>=`» con el umbral inyectado justo en el borde | ✅ |
| R18 | `origen` → «aplica tambien a `ultima_conocida`» y «si el origen YA es el centroide, no se toca (ni se avisa)» | ✅ |
| R19 | `origen` → distancia redondeada, «2 paradas» y cuatro coordenadas prohibidas | ✅ |
| R20 | `origen` → la huella tras sustituir **es la misma** que partiendo del centroide | ✅ |
| R21 | `route-optimization-config.test.ts` → ausente/vacía/`abc`/`0`/`-1`/`NaN`/`200km` → default sin lanzar; y `"50"` se respeta | ✅ |
| R22 | `origen` → mismo número de llamadas y de lecturas con y sin sustitución | ✅ |
| R23 | `origen` → sigue en `ok` y se llama una vez al proveedor | ✅ |
| R24 | `servicio` → dos casos (error nuestro / de librería): orden previo intacto + desactualizada + `RutaIntentoFallidoError` | ✅ |
| R25 | `sincronizar-ruta.test.ts` → `conflict` y la action **no lanza** | ✅ aserción contraria al `AppErrorCode inesperado` |
| R26 | `servicio` → «la cola sigue viendo una EXCEPCION» | ✅ |
| R27 | guardia de la premisa, cláusula (a), con autocomprobación que reescribe la frase | ✅ |
| R28 | ídem (b): cinco piezas, el fallo dice **cuál** falta, y normaliza espacios | ✅ |
| R29 | ídem (c) + seis autocomprobaciones, una de ellas reintroduciendo la premisa en **otro** archivo del árbol | ✅ |
| R30 | `fallback` → los tests de la 92 intactos + «los DOS caminos de degradacion marcan `local`» | ✅ |
| R31 | `google` → el cuerpo de la petición no lleva el `ordenId` | ✅ |
| R32 | `google` (saneo) · `servicio` → el motivo de un error de librería es fijo (ni Bearer, ni token, ni URL) | ✅ |
| R33 | las cinco guardas de la 92 conservan sus tests **sin tocar** y en verde | ⚠️ el «mismo orden» no se afirma como orden (m7) |
| R34 (residual) | `migración` → sin `CREATE TABLE`, sin RLS, sin `UPDATE`/`INSERT` | ✅ |
| R35 | `repo` (create **y** update, una sola transacción) · `servicio` (argumento de `reemplazarSecuencia`) · `cadena` (cliente, compuesto y local reales) · `migración` | ✅ |
| R36 | `repo` → «recalcular de `local` a `proveedor` CAMBIA la marca»; y el literal de `marcarDesactualizada` la excluye | ✅ |
| R37 | `servicio` → rama trivial (1 y 0 paradas) → marca `null` | ✅ |
| R38 | `reparto` → el aviso está en el **primer render**, sin pulsar nada y sin abrir el mapa | ✅ |
| R39 | `botón` → toast de aviso **y** `success` no llamado · `sincronizar-ruta` (la action lo reenvía) | ✅ las dos mitades |
| R40 | `reparto` → el cuerpo literal («Revísalo antes de salir.») **dentro** del aviso | ✅ literal escrito a mano |
| R41 | `reparto` → sobre el `textContent` renderizado del aviso: sin jerga ni siglas | ✅ |
| R42 | `reparto` → sin decimales, sin guía, sin dirección, sin nombre ni id | ✅ |
| R43 | `reparto` → los dos textos presentes, ninguno contiene al otro, ninguno absorbe el hecho del otro, y la geometría `local` llega al mapa | ⚠️ hasta las props (m3) |
| R44 | `fallback` (los dos caminos marcan `local`) · `reparto` (el aviso **no nombra la causa**) | ✅ |
| R45 | `reparto` (`"proveedor"` y `null`, con presencia emparejada) · `botón` (ídem) · `repo` (basura y `undefined` → `null`) | ✅ mata el «tratar `null` como local» |
| R46 | guardia del umbral: barrido real + árbol simulado con literal y con alias | ✅ |
| R47 | ídem: las cuatro piezas, y el fallo dice cuál falta | ✅ |
| R48 | `cadena` → apagada / ausente / encendida producen la **misma** secuencia, marca, avisos y resultado; y apagada no imprime una sola línea | ✅ |
| R49 | `google` (sin huecos ni `undefined`) · `cadena` (el aviso agregado) | ✅ |

**Sin las trampas que este repo ya pagó:** los seis `if (…) return;` de los tests nuevos son
estrechamientos de tipo y **todos** van precedidos de su `expect(...).toBe(...)`; ninguno es una
salida silenciosa. Los literales de UI están **escritos a mano** en los dos archivos de test, no
importados del componente. Los dos `toEqual` literales del contrato (`mis-asignaciones-orden-ruta`,
`optimizacion-ruta-trazado`) **crecieron** con `secuenciaFuente` en vez de ablandarse.

**Ningún test ajeno encogió**, contado por mí: `ruta-optimizada-repo` 10 → 12 `it`,
`sincronizar-ruta` 13 → 17, `google-route-optimization` 15 → 28. Los once archivos que cambiaron
«solo para que el tipo compile» añaden `secuenciaFuente: null` o `"proveedor"`, que es el
comportamiento de hoy.

---

## 5 · Hallazgos

### BLOQUEANTES

**B1 · `R8` no tiene un test que muerda, y el mapa dice que sí.**

R8 exige: «CUANDO el proveedor sirva **todas** las paradas pero informe igualmente errores de
validación o paradas saltadas, el sistema DEBE dejarlo escrito en la traza **aunque la respuesta sea
utilizable**». Medido en el árbol:

- El **único** sitio de toda la suite que afirma esa línea de traza es
  `tests/unit/clients/google-route-optimization.test.ts:353-372` («R1: los TRES campos se leen de
  verdad»), y usa `RESPUESTA_DEL_INCIDENTE`, que es un caso **`sin_solucion`** — o sea, una
  respuesta que **NO** es utilizable. (`grep "informa saltos" tests/` → **una** coincidencia.)
- El test que **se llama** R8 (`:375-385`) monta el escenario correcto —seis visitas servidas más
  `validationErrors` presente— y luego afirma **solo**
  `toMatchObject({ status: "ok", fuente: "proveedor" })`. **No comprueba que se escribiera nada.**

Consecuencia: mover el `optlog` de `lib/clients/google-route-optimization.ts:322-333` dentro de la
rama de `sin_solucion` —el defecto que R8 vigila, literalmente «solo se avisa cuando ya es tarde»—
deja la suite **verde**. La tabla de mutaciones de `design.md` §10.4 tampoco trae ninguna para R8,
así que el arnés no tapa el agujero.

*Impacto acotado, y se dice:* es diagnóstico, no comportamiento —R48 exige que **nada** dependa de
la traza, y eso sí se cumple—, así que no rompe al mensajero ni al job. Pero el mapa `R → test` de
`progress/impl_265_backend.md` da R8 por cubierto con dos tests y **ninguno lo cubre**: es
exactamente el fallo mudo que esta casa persigue.

*Qué falta para cumplirlo:* una aserción en el test que ya existe — encender la traza como hace el
de R1 y exigir la línea «informa saltos» con `skippedShipments: 0` y `validationErrors: true` para
la respuesta **utilizable**; y añadir su mutación (mover el `optlog` detrás del `return ok`) a la
lista, para que quede medido y no supuesto.

**B2 · `tasks.md`: 0 de 43 tasks marcadas `[x]`.**

`CHECKPOINTS.md` lo exige explícitamente y hoy **ninguna** casilla está marcada, ni siquiera las
que constan hechas con evidencia pegada (B1-B26, FE1-FE4, F6, C1, C2, C6). Es peor que un olvido de
formato: **el archivo no distingue lo hecho de lo pendiente**, y aquí hay pendientes de verdad que
alguien tiene que ver antes de desplegar — **C3** (re-medir M1 con `ruta_optimizada_parada` ya con
filas), **C7** (ver m6), **C8** (contar los `optimizacion_ruta` en `failed` posteriores al
despliegue) y **B0.1**, que se cerró como **no tomable**. Con todo en `[ ]` no hay forma de saberlo
leyendo la ficha, que es justo cómo se esconde deuda en una ficha `in_progress`.

*Qué falta para cumplirlo:* marcar `[x]` lo verificado, dejar en `[ ]` lo que sigue vivo **con su
estado escrito al lado** (B0.1 cerrada sin tomarse; C3/C7/C8 pre y post-despliegue). No se marca lo
que no está hecho.

### Menores

- **m1 · `B0.2` no aparece ejecutada en ninguna bitácora.** La task exigía «los dos números pegados
  con el snippet que los produjo». **Lo he medido yo** con `distanciaHaversineKm` del repo:
  origen → parada repetida **1.038,37 km** (el spec dice ≈1.040 ✔), parada ↔ parada **58,08 km**
  (≈58 ✔) y, el que de verdad usa la guarda, origen → **centroide** **1.028,99 km**. O sea: **los
  números escritos son correctos**; lo que falta es la evidencia. Basta con pegar estos tres.
- **m2 · `F6` se hizo en LOCAL, no en preview**, y su punto 3 quedó a medias: «y **no** se llama al
  proveedor con ese origen» no se distingue sin credencial. Declarado en frontend §6 y §8.1, con
  transcripciones y consulta pegadas. Mitiga: esa mitad **sí** está cubierta por unitario (`origen`
  afirma el **argumento** de `client.optimizar`). Repetir en preview antes de la release.
- **m3 · La tercera señal de R43 llega hasta las props del mapa, no hasta la línea punteada.**
  `dashArray` aparece en **un** sitio (`RutaMapaInner.tsx:158`) y **ningún** test lo toca en todo el
  repo — deuda anterior a esta ficha, no introducida por ella. Declarado en frontend §3.3 y §8.4.
- **m4 · `tests/integration/repositories/` NO levanta Postgres** (Prisma mockeado, patrón del repo):
  el `UPDATE` real de la columna no lo mira nadie ahí, en contra de lo que afirma `design.md` §10.2
  («el único sitio donde el `WHERE` y el `UPDATE` reales se miran de verdad»). El implementer lo
  declara (backend §7.8). Cubierto por otra vía: test estático de la migración, el `@map` del
  `schema.prisma` afirmado por regex, y F6 contra Postgres local. **Corregir esa frase del diseño**
  para que nadie herede la creencia.
- **m5 · Comentario rancio.** `lib/clients/google-route-optimization.ts:208` sigue diciendo «se apaga
  con `RUTA_DEBUG_LOG=0`». Con el default invertido eso ya no describe el comportamiento: hoy nace
  apagada y se **enciende** con `1`. Es un archivo que esta ficha toca.
- **m6 · Deriva spec ↔ código sobre P7.** `design.md` §1 y §16.1 («**Cero líneas de código**») y la
  task **C7** («el valor por defecto del código **no se toca**, eso es P7») dicen lo contrario de lo
  que el código hace. La inversión **está autorizada** por la segunda puerta de `requirements.md`
  («P7 — CERRADA: se INVIERTE EL DEFAULT EN EL CÓDIGO»), así que lo correcto es el código y lo
  desactualizado es el diseño y la task. Además **C7 queda en gran parte superada**: poner
  `RUTA_DEBUG_LOG=0` en un entorno ya no hace falta para apagarla.
- **m7 · `R33`, el «mismo orden», no se afirma como orden.** Las cinco guardas de coste conservan sus
  tests intactos y en verde (cada una con «0 llamadas»), y la parte sensible al orden —la huella con
  el origen **final**— sí tiene el suyo (R20). Pero ningún test fija la **secuencia** de las cinco:
  hoy descansa en el comentario normativo de la cabecera del servicio.
- **m8 · Falta la entrada en `progress/history.md`** (checkpoint de cierre; es del leader).
- **m9 · Interferencia de la 262, sin daño medido:** dos migraciones comparten prefijo de timestamp
  (`20260822140000_ruta_secuencia_fuente` y `20260822140000_notificacion_evento_dia_reparto_corregido`).
  No colisionan —directorios y tablas distintas— y mi gate completo pasa con las dos aplicadas. Está
  declarado en backend §7.3. Se anota solo por si alguien pensara renombrar: **editar una migración
  ya aplicada es drift**.
- **m10 · Mina heredada:** tres tests ajenos usan `getByRole("alert")` en **singular**
  (`RepartoModule.test.tsx:839`, `:1152`, `:1463`); quien escriba un caso con «bloqueado + orden
  local» se topará con un error de *multiple elements* que no dice lo que parece. No introducido
  aquí, no tocado, declarado en frontend §5.1.
- **m11 · Los avisos agregados de R12/R19/R30 no llegan a nadie en producción** (`defaultLogger` es
  un `warn` vacío en las dos construcciones reales). Es el **límite declarado 5** y **P8 lo cerró así
  a propósito**: la operación se entera consultando `ruta_optimizada.secuencia_fuente`. No es un
  defecto de esta ficha; se anota para que nadie lea esos `warn` como si se vieran.

---

## 6 · Lo que conviene decir a favor

- El defecto medido queda cerrado **en la costura donde vivía**: `optimizacion-ruta-degradacion.test.ts`
  cablea el cliente de Google **real** (con `fetch` inyectado), el compuesto **real** y el
  calculador local **real**, y comprueba que la respuesta del incidente acaba en una secuencia que
  cubre **las tres** paradas, marcada `local`, con el job **completado** y **una sola** llamada.
- El test que cambió de sentido (el de «no cubre todas → lanza») **no se borró**: se reescribió con
  el nombre actualizado y su invariante quedó cubierta por dos tests nuevos **en el mismo PR**, con
  el puntero escrito dentro del propio archivo. Igual con el de la credencial en `servicio`: la
  mitad viva se conserva y la mitad que se cambió **era el defecto**.
- Las dos guardias de prosa **pueden ponerse rojas** y lo demuestran con autocomprobación: no son de
  las que se quedan verdes por vacías.
- El motivo saneado se decide por `error.name` y no por `instanceof`, para no meterle al servicio el
  conocimiento del proveedor concreto; las cuatro clases fijan su `name` explícitamente (verificado
  en el árbol) y ante cualquier otra cosa el texto es **fijo**, con test que busca `Bearer`, el
  token y la URL.
- El default defensivo al leer la columna es `null` y **no** `"proveedor"`: no consta es no consta,
  que es justo lo que R45 manda.

---

## Veredicto

**RECHAZADO.** 2 bloqueantes (**B1**, trazabilidad de `R8`; **B2**, `tasks.md` sin marcar) y 11
menores.

Ninguno de los dos toca el comportamiento: el gate completo está **verde en mi propia corrida**
(`INIT_EXIT=0`, 17.793 tests) y el arreglo del incidente está bien hecho y bien defendido. B1 se
cierra con **una aserción** en un test que ya existe, más su mutación; B2, poniendo `tasks.md` a
decir la verdad —lo hecho en `[x]`, lo pendiente en `[ ]` con su estado—. Vuelve al implementer:
aquí no se ha tocado ni una línea de código.
