# Review 335 — La barra de filtros compartida lee su estado inicial desde la URL

Revisor: reviewer (agente). Fecha: 2026-08-31.
Worktree: `C:/w335`, rama `feature/335-filtros-desde-url`, HEAD `68a2647b` (merge de `origin/dev` ya aplicado).
Diff revisado: merge-base..HEAD — 17 archivos, +3236/-108, **0 bajo `app/`** (confirmado).

> Nota de herramientas: el MCP `codebase-memory` no estaba disponible en este entorno de
> subagente, asi que la busqueda de codigo se hizo con `grep`/`glob` y lectura directa de
> archivos. Todo lo que se afirma aqui esta verificado contra el archivo real o contra una
> ejecucion.

## VEREDICTO: **RECHAZADO**

Dos hallazgos bloqueantes, ambos reproducidos con un test ejecutable escrito por el revisor
(y borrado despues; el worktree queda limpio).

---

## Checklist

### Especificacion
- [x] `specs/335-filtros-desde-url/requirements.md` — 25 requisitos EARS numerados R1..R25.
- [x] `specs/335-filtros-desde-url/design.md` — con alternativas descartadas y su porque (A1-A5).
- [ ] `specs/335-filtros-desde-url/tasks.md` con **todas** las tasks marcadas: **NO**. T6.2 y
      T6.3 siguen sin marcar, aunque su trabajo esta hecho y documentado en la bitacora.

### Trazabilidad
- [x] Los 25 requisitos tienen un test nombrado; ninguno dice "cubierto indirectamente".
- [x] `progress/impl_335.md` contiene el mapa R -> test completo.
- [ ] Los tests verifican DE VERDAD lo que el requisito promete: **NO para R3, R5 y R7**
      (hallazgos B1 y B2). 22 de 25 se sostienen; 3 tienen contraejemplo.

### Calidad de codigo
- [x] `pnpm run typecheck` — 0 errores.
- [x] `pnpm run lint` — 0 errores, 127 warnings, todos preexistentes de `dev`.
- [x] Tests: sin rojos nuevos, delta 0 contra el baseline.
- [n/a] E2E Playwright: la ficha no toca auth, pagos, recaudo, ingesta ni webhooks.

### Datos y seguridad
- [n/a] RLS / migraciones / down.sql: la ficha no toca la base ni `db/`.
- [x] Sin secretos hardcodeados.
- [n/a] Webhooks.

### Patron de capas
- [x] El codec (`lib/utils/filtros-url.ts`) es puro: no importa React ni `next/*`.
- [x] La unica pieza que conoce `next/navigation` es `hooks/useFiltrosUrl.ts`.
- [x] Los dos canonicos compartidos no conocen al router.
- [x] Sin hardcode de pais, moneda ni contexto.

### Verificacion final
- [x] `./init.sh --rapido` re-ejecutado por el revisor SOBRE el estado ya mergeado: init OK.
- [ ] `./init.sh` completo: no corrido (correcto segun `docs/verification.md`; obligatorio
      post-merge a `dev` y antes de release).
- [x] Este archivo existe.
- [ ] Entrada en `progress/history.md`: pendiente (es del leader).

---

## Gate re-ejecutado por el revisor (post-merge de origin/dev)

| Tramo | Resultado |
| --- | --- |
| Modo | el cambio no toca esquema, tipos compartidos, config ni dinero: el modo rapido basta |
| `pnpm run typecheck` | **verde**, 0 errores |
| `pnpm run lint` | **verde**, 127 problems (0 errors, 127 warnings), todos preexistentes |
| Tests relacionados (`--changed origin/dev`) | **83 archivos, 1122 passed + 17 skipped (1139)**, 0 rojos |
| Guardias | **167 archivos, 2524 passed, 1 failed (2525)** |
| Comparacion con baseline | sin rojos nuevos (1 archivo rojo sobre 249 ejecutados, todos en el baseline conocido) |
| Veredicto del arnes | **init OK** |

El unico rojo es `tests/unit/guards/superficie-de-uso.guardia.test.ts` señalando
`lib/actions/tarifas.ts:67 obtenerTarifa`. **Confirmado ajeno**: inscrito en
`tests/baseline-rojos.json` desde el 2026-08-28, y este diff no toca `lib/actions/`, ni
Server Actions, ni `app/`. **Delta de rojos: 0.** No aparecio ningun rojo nuevo tras el
merge, asi que no hubo nada que aislar como flake.

---

## Hallazgos

### B1 — BLOQUEANTE. `/novedades` SI esta en el caso del catalogo asincrono: el enlace compartido no acota

La bitacora (`progress/impl_335.md`, decision 3) afirma: "se revisaron los 8 consumidores y
**ninguno esta hoy en ese caso**". **Es falso para `/novedades`.**

`app/(app)/novedades/_components/novedades-filtros.ts:304-310` construye los FilterDef con
`const items = conjunto ?? []`, asi que mientras `conjunto === null` los filtros `multi`
(mensajero, zona, provincia, canton, distrito, causa) se declaran con `options: []`. Y
`conjunto` **nace en null** y solo se llena de forma PEREZOSA: en `useNovedadesFiltro.ts`,
`pedirConjunto()` se dispara desde los manejadores de la barra, nunca desde un efecto de
montaje. Secuencia real al entrar por `/novedades?zona=Norte`:

1. `activosDesdeUrl` NO valida contra el catalogo, asi que la clave `zona` se activa (R2 si funciona).
2. `onActivosChange` dispara `pedirConjunto()`.
3. `FilterComponent` se monta con `filters=[zona]` y `options: []`, asi que
   `seleccionDesdeUrl` descarta "Norte" por R14 y la seleccion queda vacia.
4. El efecto de montaje apunta `zona` en `sembradas`.
5. Llega el conjunto y `options` se llena, pero `zona` ya cuenta como sembrada y **no se reintenta**.

Resultado MEDIDO por el revisor, con el hook REAL `useNovedadesFiltro` y `listarCompleto`
devolviendo una novedad de zona "Norte": el control se monta y su disparador dice
**"Zona: Todas"**. El filtro no se aplica y la lista no se acota. El spec promete R3 y R5
para cualquier consumidor de los canonicos (restriccion dura 1: la capacidad va ligada al
COMPONENTE), y en la pantalla que el propio plan eligio como prueba de herencia no se cumplen.

Agravante: **`tests/unit/components/filtros-url-herencia.test.tsx` (T5.1) no prueba lo que
dice probar.** Su enunciado es "se monta un consumidor REAL, NovedadesFiltrosBarra", pero
sustituye `useNovedadesFiltro` por un objeto `NovedadesFiltro` fabricado a mano
(`BarraDeNovedades`, lineas 59-101) con un ZONA estatico y sus `options` ya presentes.
Ejercita la cascara de presentacion, no el camino real, y por eso el fallo pasa inadvertido.

Que falta para cumplirlo: o bien reintentar la siembra cuando el catalogo de una clave ya
sembrada pasa de vacio a no vacio (decidiendo explicitamente como convive eso con R7), o bien
poner `leerDeUrl={false}` en `/novedades` y acotar por escrito lo que el spec promete, lo que
exige aprobacion humana porque cambia el alcance. Ademas T5.1 necesita un test que monte el
hook real, no una maqueta.

### B2 — BLOQUEANTE. R7 no se sostiene: la siembra por crecimiento lee la URL ACTUAL, no la de entrada

R7 exige que "MIENTRAS el usuario permanece en la pantalla, el sistema DEBE ignorar cualquier
cambio posterior de los query params". La lectura del montaje si esta congelada
(inicializador perezoso, correcto). Pero la siembra por crecimiento de `filters`, metida en el
efecto de poda de `components/shared/FilterComponent.tsx`, lee `paramsRef.current`, y esa ref
se **reescribe en cada render** (el `useEffect` sin deps de las lineas ~493-497). Cada vez que
cambia el juego de claves montadas, el componente vuelve a leer la URL DE AHORA.

Reproducido por el revisor: se monta con `filters=[]` y sin params; despues la URL cambia a
`?color=azul`; al declarar el filtro, el componente emite **{ color: ["azul"] }** cuando R7
exige {}.

El test que la ficha ofrece para este requisito
(`filter-component-url.test.tsx`, caso "R7 - cambiar los params DESPUES del montaje no cambia
la seleccion") cambia los params SIN cambiar `filters`, con lo que el efecto de poda ni
siquiera vuelve a correr: no puede detectar este camino.

Alcance real hoy: en `/analitica` conviven la barra de entregas (`FiltrosEntregas`) y el
tablero operativo, que SI escribe la URL durante la sesion
(`analitica/_components/operativo/filtro-tablero.ts`, PARAM_RANGO/ZONA/TIENDA/MENSAJERO);
`cierres-admin` tambien reescribe la URL al abrir un detalle (`?cierre=`). Hoy ninguna de esas
claves coincide con una clave de filtro (`zona` vs `zona_id`, etc.), asi que el efecto visible
esta latente y no vivo, pero la propiedad que R7 declara es FALSA y nada la vigila.

Que falta para cumplirlo: sembrar desde los params CONGELADOS al entrar (una ref inicializada
una sola vez, no reescrita en cada render) y un test que cubra el camino "cambian los params
+ crece filters".

### M1 — menor. El limite declarado de la memoria de modulo esta subestimado

`hooks/useFiltrosUrl.ts` declara como unico limite "volver ATRAS con el boton del navegador a
esa MISMA query exacta". El limite real es mas ancho: `paresBorrados` no se vacia nunca en
toda la sesion SPA, asi que CUALQUIER llegada posterior a esa misma ruta con ese mismo par
nombre+valor queda suprimida, incluido un Link interno, un enlace compartido pegado en la
barra de direcciones sin recarga completa, o una navegacion cliente que reconstruya esa query.
Lo demas del diseño resiste: el scopeado por pathname y por VALOR evita el envenenamiento
entre pantallas distintas (comprobado), y el conjunto crece sin cota durante la sesion pero a
razon de unas pocas entradas por "Limpiar todo", asi que no es un problema practico.

### M2 — menor. El guardia de R25 es real, pero mas estrecho que el requisito

Verificado: `tests/unit/guards/filtros-url-r25.test.ts` **puede fallar de verdad**. Invoca
ESLint por su API con la config real del repo, y su primer caso comprueba que
`react-hooks/set-state-in-effect` existe y esta ACTIVA en la config resuelta, que es
justamente lo que impide el verde vacio. No es un criterio tipo grep. Ahora bien, R25 habla de
"realizar la lectura inicial sin escribir estado desde un efecto", y la siembra por
crecimiento de B2 hace exactamente eso (`aplicar(...)` dentro del efecto de poda con valores
leidos de `paramsRef.current`); la regla no lo marca porque el `aplicar` es indirecto, asi que
el guardia no cubre ese camino.

### M3 — menor. `/novedades` monta DOS barras y la precarga se duplica

Las dos pestañas viven montadas a la vez (keepMounted) con el mismo pathname. Entrar por
`/novedades?q=guia` escribe "guia" en los DOS campos de busqueda y dispara DOS
`listarCompleto()`, que es la lectura cara de esa pantalla. No rompe ningun requisito escrito,
pero es un efecto de la ficha que conviene decidir a proposito. Comprobado que no hay
envenenamiento cruzado de la memoria de borrados entre las dos barras.

### M4 — menor. Dos tasks sin marcar

T6.2 (mapa de trazabilidad) y T6.3 (gate) no estan marcadas en `tasks.md`, aunque su resultado
esta escrito en `progress/impl_335.md`. Incumple el checkpoint "todas las tasks estan marcadas".

---

## Lo que si esta bien y conviene no perder en la correccion

- El reparto de responsabilidades (codec puro / hook con router / canonicos ciegos al router)
  es limpio y respeta `docs/architecture.md`.
- El codec cubre R8-R16 con casos reales, incluido `esFechaCalendario` rechazando 2026-02-31,
  el rango invertido y la excepcion del separador para kind "text".
- La guarda de "no navegar si la query no cambia" evita un refetch RSC inutil en las 8
  pantallas: es una mejora real sobre el diseño escrito.
- La memoria de lo recien borrado ataca un bug real y verificado del remonte por key, y su
  scopeado (ruta + nombre + valor) es correcto.
- R18 (no escribir la URL al filtrar) esta bien cubierto con un assert de conteo a cero.
- Extraer el byte NUL crudo a la constante escapada devuelve `FilterComponent.tsx` a ser texto
  diffeable: cambio pequeño y de valor claro.

---
---

# SEGUNDA PASADA — re-revision del arreglo (2026-08-31)

Revisor: reviewer (agente). Worktree `C:/w335`, rama `feature/335-filtros-desde-url`,
HEAD **`813029d8`** (merge de `origin/dev` posterior al arreglo, ya con la ficha 337 dentro).
Commits del arreglo revisados: `41c774c9` (docs M1/M3/M4), `f898b551` (el codigo),
`e3c5831a` (bitacora).

> Nota de herramientas: el MCP `codebase-memory` tampoco estaba disponible en este entorno de
> subagente, asi que se uso `grep` + lectura directa de archivos. Todo lo que se afirma aqui
> esta verificado contra el archivo real o contra una ejecucion propia, no contra la bitacora.
> Nota de entorno: el `PATH` del shell bash venia degradado (sin `git` ni `node`); se reparo
> exportandolo. No es un problema del repo.

## VEREDICTO: **RECHAZADO** (un solo bloqueante, acotado y barato)

**B1, B1-bis y B2 estan CERRADOS y verificados.** El arreglo es correcto y el rojo demostrado
se reprodujo clavado. Lo que impide el OK es distinto y es nuevo: **`./init.sh --rapido` sale
en ROJO (exit 1)** y entre los rojos nuevos esta **un archivo de la propia ficha**.

---

## Gate re-ejecutado por el revisor sobre `813029d8`

| Tramo | Resultado |
| --- | --- |
| Modo | el cambio no toca esquema, tipos compartidos, config ni dinero: el modo rapido basta |
| `pnpm run typecheck` | **verde**, 0 errores |
| `pnpm run lint` | **verde**, 127 problems (0 errors, 127 warnings), todos preexistentes |
| Tests relacionados (`--changed origin/dev`) | **83 archivos, 1128 passed + 17 skipped (1145)**, **0 rojos** — coincide exactamente con la bitacora, y ahora medido POST-merge |
| Guardias (corrida 1) | **167 archivos, 6 failed / 161 passed; 2517 passed, 6 failed, 3 skipped (2526)** |
| Baseline | **hay rojos NUEVOS respecto del baseline** — 5 archivos |
| **Veredicto del arnes** | **exit 1 — el gate NO pasa** |

Los 5 rojos nuevos, corridos **AISLADOS** uno por uno como manda la ficha:

| Archivo | Aislado | Diagnostico |
| --- | --- | --- |
| `tests/guards/tarifa-status-retirado.guard.test.ts` | **verde** | flake de saturacion (timeout 20s); ajeno |
| `tests/unit/guards/ayuda-columna-retirada.guardia.test.ts` | **verde** | flake de saturacion; ajeno |
| `tests/integration/db/analytics-daily-guards.test.ts` | **verde** | flake de saturacion; ajeno |
| `tests/unit/analytics/backfill-guards.test.ts` | **verde** | flake de saturacion; ajeno |
| **`tests/unit/guards/filtros-url-r25.test.ts`** | **ROJO 1 de 2 veces** | **NO es flake ajeno: es de esta ficha.** Ver B3 |

Segunda corrida de guardias, para medir la variabilidad: **167 archivos, 1 failed / 166 passed;
2525 passed, 1 failed (2526)** — es decir, solo `superficie-de-uso.guardia.test.ts` sobre
`lib/actions/tarifas.ts:67 obtenerTarifa`, **el rojo ajeno conocido**, en
`tests/baseline-rojos.json` desde el 2026-08-28. Esta ficha no toca `lib/actions/`, ni Server
Actions, ni `app/`.

**Delta de rojos atribuibles a la ficha: 1** (`filtros-url-r25`, ver B3).

---

## El rojo demostrado: REPRODUCIDO, clavado

Se restauro `components/shared/FilterComponent.tsx` a `41c774c9` (el commit de docs
inmediatamente anterior al arreglo, o sea el fuente pre-arreglo) y se corrieron los tres
archivos. Salida propia del revisor:

```
 Test Files  3 failed (3)
      Tests  5 failed | 19 passed (24)

 x R2/R3/R5 - entrando por ?zona=... el control queda con esa zona SELECCIONADA cuando llega el catalogo
 x R7  - cambiar los params ANTES de declarar el filtro no siembra el valor nuevo
 x R3/R5 - un catalogo que llega DESPUES del montaje siembra la clave que quedo pendiente
 x R3/R7 - al llegar el catalogo se siembra la URL DE ENTRADA, nunca la de ahora
 x R25 - mutar los query params tras el montaje no entra por la siembra: gana la foto de entrada
```

Restaurado el arreglo: **`Test Files 3 passed (3)` / `Tests 24 passed (24)`**, y el worktree
vuelve a quedar limpio (`git status --short` sin salida).

**Coincide archivo por archivo, test por test y conteo por conteo con lo que afirma la
bitacora.** La trazabilidad de estos cinco requisitos se sostiene sobre tests que **fallan de
verdad**, no sobre tests que «deberian» fallar.

---

## Los seis requisitos en foco

| Req | Se sostiene? | Test que lo prueba | Puede fallar de verdad? |
| --- | --- | --- | --- |
| **R2** | **SI** | `filtros-url-herencia.test.tsx` :: «R2/R3/R5 ... (hook REAL)» | **SI, medido en rojo** |
| **R3** | **SI** | `filter-component-url.test.tsx` :: «R3/R5 — catalogo que llega DESPUES» | **SI, medido en rojo** |
| **R5** | **SI** | idem + el caso de herencia | **SI, medido en rojo** |
| **R7** | **SI** | `filter-component-url.test.tsx` :: «R7 — cambiar los params ANTES de declarar» y «R3/R7 — la URL DE ENTRADA, nunca la de ahora» | **SI, medido en rojo** |
| **R17** | SI (sin regresion) | `filter-component-url.test.tsx` :: «R17 — tras el ciclo completo...» | **NO se pudo medir en rojo**: pasa igual con y sin arreglo. Ver M5 |
| **R25** | **Parcialmente** | `filtros-url-r25.test.ts` (2 mitades) | La mitad de COMPORTAMIENTO si (medida en rojo). La mitad de LINTER **se salta entera cuando el guardia expira**. Ver B3 |

### B2 — CERRADO. No queda ninguna referencia viva a la URL

Buscado a mano, no dado por bueno. En `components/shared/FilterComponent.tsx` la unica
lectura de la URL es la linea 381 (`const { params } = useFiltrosUrl(leerDeUrl)`) y su **unico
consumo** es el inicializador perezoso de la linea 401-403:

```ts
const [paramsIniciales] = useState(
  () => new URLSearchParams([...params.entries()]),
);
```

Copia propia, capturada una vez, nunca reasignada. Leen `paramsIniciales` —la foto— los tres
caminos: el inicializador de `seleccion` (l. 444-448), el `useMemo` de `precargaUrl`
(l. 477-483) y la siembra dentro del efecto de poda (l. 617-620). **La `paramsRef` reescrita en
cada render ya no existe.** La segunda puerta que el implementer dice haber cazado por los
pelos —`precargaUrl` alimentando el `valorInicial`/`defaultRange` de los controles NO
controlados (l. 678, 690, 770)— **tambien lee la foto**, confirmado en el fuente: por ahi
tampoco entra la URL de ahora. R7 pasa a ser una propiedad estructural, y esta es la forma
correcta de sostenerlo.

En `components/shared/BuscadorFiltros.tsx`, misma comprobacion: `params` (l. 174) solo se
consume en el inicializador perezoso de `precarga` (l. 191-194) y en `borrarParams`, que lee la
URL viva **a proposito y correctamente** —es un gesto del usuario que borra los params de
AHORA, no una relectura de la precarga—. Sin hallazgos.

### B1 — CERRADO. Los dos riesgos, atacados

- **(a) Se resiembra una clave que el usuario deselecciono a mano?** **No, con doble
  cinturon.** Todos los caminos de interaccion del render —`multi` (l. 705), `boolean`
  (l. 730), `single` (l. 747), `dateRange` (l. 772) y `text` (l. 691)— pasan por `fijar()`, y
  `limpiarTodo()` tambien; ambos llaman a `cerrarSiembra()`, que pone
  `siembraCerradaRef.current = true`, y el efecto calcula
  `pendientes = siembraCerradaRef.current ? [] : ...` (l. 614-616). Aparte, la clave ya sembrada
  esta en `sembradas` y queda fuera de `pendientes` de todos modos. Hay ademas un test dedicado
  que lo ejercita con catalogo PARCIAL —decision 2 de la bitacora, y es la decision correcta:
  con catalogo vacio el control va `disabled` y el escenario seria inejercitable—: «R7 — el
  gesto del usuario cierra la siembra: el catalogo que llega tarde no le pisa la seleccion».
  Verde.
- **(b) Sigue intacta la convivencia con la poda (R17)?** **Si.** Siembra y poda siguen en el
  MISMO efecto (l. 588-634), asi que no hay orden que negociar; se siembra solo sobre claves ya
  declaradas (`montadosRef.current`), que por construccion nunca estan entre las que sobran.
  **Sin ciclos**: una clave pendiente que no produce valores devuelve un objeto vacio, no hay
  nada que podar y el efecto sale por el `return` temprano de la l. 626 **sin tocar el estado**
  — que es ademas lo que preserva el **silencio de R6**. Comprobado en ejecucion: el caso «R6 —
  sin params no se emite NADA al montar» y el «R6» del test de herencia (que exige
  `listarCompleto` **no llamado**) siguen verdes. **Sin emisiones extra.**

### B1-bis — CERRADO. El test de herencia usa el hook REAL

Leido entero. `tests/unit/components/filtros-url-herencia.test.tsx` importa y monta
`useNovedadesFiltro` (l. 40, 113) y `NovedadesFiltrosBarra` (l. 39, 116) **de verdad**; lo unico
inyectado es `listarCompleto`, que el hook ya recibe **como argumento** —o sea, no se sustituye
ninguna pieza de produccion— y se difiere con una promesa que el test resuelve a mano
(`listadoDiferido`, l. 88-102). Afirma el ANTES («Zona: ... Todas», l. 158-159) y el DESPUES
(«GAM Oeste» + lista acotada a un solo destinatario, l. 166-169). **No es otra maqueta con otro
disfraz:** este es exactamente el test cuyo fallo reproduje contra el fuente pre-arreglo.

### M2 — CERRADO

`tests/unit/guards/filtros-url-r25.test.ts` conserva sus casos de ESLint —incluido el que
comprueba que `react-hooks/set-state-in-effect` existe y esta **ACTIVA** en la config resuelta,
que es lo que impide el verde vacio— y suma la mitad de comportamiento (l. 203-234), que muta
los params tras el montaje, hace crecer el catalogo y exige que gane la foto de entrada. El
razonamiento es correcto: el linter no atraviesa la indireccion `aplicar(...)`, que era el
camino de B2. Ese caso **se midio en rojo** contra el fuente pre-arreglo.

### M4 — CERRADO

`specs/335-filtros-desde-url/tasks.md`: **ninguna task sin marcar** (18 marcadas, 0 pendientes).

---

## Hallazgos de esta segunda pasada

### B3 — BLOQUEANTE. El guardia de R25 expira ~40% de las veces y pone el gate en rojo

`tests/unit/guards/filtros-url-r25.test.ts` **es el unico rojo nuevo que NO es un flake ajeno:
lo introduce esta ficha.** Su `beforeAll` (l. 102-108) arranca ESLint y resuelve la flat config
del repo, con `hookTimeout` de **60 s**, y en esta maquina ese arranque tarda entre ~25 s y mas
de 60 s. Cuando lo cruza:

```
FAIL  tests/unit/guards/filtros-url-r25.test.ts
Error: Hook timed out in 60000ms.
 -> tests/unit/guards/filtros-url-r25.test.ts:102:3
```

Medido, 5 corridas: **rojo en el gate** (suite de guardias), **rojo AISLADO** (113 s, sin nada
compitiendo — o sea **no es saturacion**), verde aislado (62,7 s), verde en grupo de 3, verde en
la segunda suite de guardias. **~2 de 5.**

Lo grave no es el rojo, es **lo que el rojo se lleva por delante**: al expirar un `beforeAll`,
los 3 casos de ESLint quedan **SKIPPED** (`Tests 1 passed | 3 skipped (4)`). Es decir, en cada
corrida en que el guardia expira **la mitad de linter de R25 deja de verificar nada** y el
requisito se queda solo con su mitad de comportamiento. Y el desenlace previsible de un guardia
que se pone rojo la mitad de las veces es que alguien lo inscriba en `baseline-rojos.json`,
momento en el que R25 deja de estar vigilado del todo — justo el «verde falso» que la cabecera
del propio archivo (l. 41-45) dice existir para impedir.

**Causa probable, y por que es NUEVA:** el arreglo de M2 (`f898b551`) fusiono la mitad de
comportamiento en este mismo archivo, lo que obligo a marcarlo `// @vitest-environment jsdom`
(l. 1). Ahora el arranque caro de ESLint corre **dentro de jsdom**. El comentario de la
l. 99-101 («con holgura sobre el testTimeout de 20 s del repo») describe un supuesto que ya no
se cumple.

**Que falta para cumplirlo** (cualquiera de las dos, ambas baratas y sin tocar produccion):
partir el archivo en dos —la mitad de ESLint en su fichero **sin** `jsdom`, la de render en otro
con `jsdom`—, que es lo que ademas devuelve la holgura; o subir el `hookTimeout` a un margen
medido de verdad contra el peor caso observado (mas de 113 s). Y volver a correr
`./init.sh --rapido` hasta verlo **verde**, porque hoy sale `exit 1` y `CHECKPOINTS.md` exige
que termine en verde.

### M5 — menor. R17 tiene test, pero no se le puede ver fallar

«R17 — tras el ciclo completo de efectos no llega ninguna emision que borre la clave sembrada»
pasa **igual con el fuente pre-arreglo y con el arreglado**, asi que no entra en el conjunto de
rojo demostrado. Revisado el cuerpo del efecto, la propiedad **si se sostiene** por construccion
(se siembra solo sobre claves declaradas, luego nunca estan entre las que sobran), y la primera
revision ya dio R17 por bueno; no hay regresion. Pero conviene saber que ese test no distingue
hoy un arbol sano de uno roto por esa via.

### M1 — menor, RESIDUAL. La correccion se escribio en la bitacora, no en el codigo

M1 se dio por cerrado en `41c774c9`, pero ese commit toca **solo** `progress/impl_335.md`,
`progress/review_335.md` y `tasks.md`: **`hooks/useFiltrosUrl.ts` no se toco**. Su comentario de
«LIMITE CONOCIDO» (l. 53-57) sigue diciendo la version estrecha —«volver ATRAS con el boton del
navegador a esa MISMA query exacta»— cuando el limite real, ya escrito correctamente en la
bitacora, es que `paresBorrados` **no se vacia en toda la sesion SPA** y suprime cualquier
llegada posterior a esa ruta con ese par nombre=valor. Quien lea el codigo —que es donde se lee
un limite— sigue leyendo la version subestimada.

### M3 — fuera de ficha, correctamente anotado

`/novedades` monta dos barras y un `?q=` dispara dos `listarCompleto()`. **No se cuenta como
hallazgo** (decision del coordinador). Verificado que **queda anotado como limite conocido** en
`progress/impl_335.md`, con su porque y sin corregir. Correcto.

---

## Checklist de esta pasada

### Especificacion
- [x] `requirements.md` con 25 requisitos EARS numerados.
- [x] `design.md` con alternativas descartadas (A1-A5).
- [x] `tasks.md` con **todas** las tasks marcadas (M4 cerrado).

### Trazabilidad
- [x] Los 25 requisitos tienen un test nombrado.
- [x] `progress/impl_335.md` contiene el mapa R -> test, ahora con columna «rojo demostrado».
- [x] R2, R3, R5, R7 y la mitad de comportamiento de R25 **verificados en rojo por el revisor**.
- [ ] R25 **completo**: su mitad de linter se salta cuando el guardia expira (B3).

### Calidad de codigo
- [x] `pnpm run typecheck` — 0 errores.
- [x] `pnpm run lint` — 0 errores, 127 avisos preexistentes.
- [ ] Tests: **delta de rojos = 1** (`filtros-url-r25`, propio de la ficha).
- [n/a] E2E Playwright: la ficha no toca auth, pagos, recaudo, ingesta ni webhooks.

### Datos y seguridad
- [n/a] RLS / migraciones / down.sql: la ficha no toca la base ni `db/`.
- [x] Sin secretos hardcodeados.
- [n/a] Webhooks (ni firma ni idempotencia aplican).

### Patron de capas
- [x] El codec (`lib/utils/filtros-url.ts`) es puro: no importa React ni `next/*`.
- [x] La unica pieza que conoce `next/navigation` es `hooks/useFiltrosUrl.ts`.
- [x] Los dos canonicos compartidos no conocen al router.
- [x] Sin hardcode de pais, moneda ni contexto.
- [x] **0 archivos bajo `app/`** en el diff — re-verificado sobre `813029d8` (18 archivos,
      +3893/-110, ninguno en `app/`). El unico contacto con `app/` es un **import de test** en
      `filtros-url-herencia.test.tsx`, que es exactamente lo que la prueba de herencia exige.

### Verificacion final
- [ ] **`./init.sh --rapido` NO termina en verde**: exit 1 por B3.
- [ ] `./init.sh` completo: no corrido (correcto aqui; obligatorio post-merge a `dev` y antes de
      release).
- [x] Este archivo existe y recoge las dos pasadas.
- [ ] Entrada en `progress/history.md`: pendiente (es del leader).

---

## Lo que NO hay que perder al cerrar B3

El arreglo de B1/B2 es bueno y no debe tocarse para arreglar B3. En particular:
- La foto `paramsIniciales` y la distincion «releer vs. terminar de aplicar», escrita en el
  fuente con esas palabras (l. 394-399): es sutil y se ve al reves.
- `sembradas` apuntado **por sembrar** y no por declarar.
- `firmaCatalogo` como segunda dependencia del efecto: sin ella el reintento no existe, porque
  cuando el catalogo pasa de vacio a lleno el juego de claves no cambia.
- El `return` temprano de la l. 626, que es lo que sostiene el silencio de R6.
- El cierre de la siembra al primer gesto del usuario.

B3 se arregla **en el archivo de test**, no en produccion.
