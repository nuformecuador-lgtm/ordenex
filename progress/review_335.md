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
