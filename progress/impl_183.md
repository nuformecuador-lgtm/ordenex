# Feature 183 — el `neto` de las cuatro métricas de caja · bitácora consolidada

> **Decisión que manda:** ⟨D12⟩, `progress/decision_183.md` (humana, 2026-08-04, CERRADA).
> **Puerta cerrada** el 2026-08-04 con las cuatro preguntas al default: **P1**=(a) el bruto es
> volumen movido · **P2**=(a) etiqueta «Bruto», sin línea secundaria · **P3**=(a) el neto de
> `egresos` conserva su signo negativo · **P4**=(a) notas fechadas en `specs/127-*` y `specs/132-*`.
>
> El detalle por tarea, con la salida de cada mutación pegada, vive en
> `progress/impl_183_backend.md` (bloques A–D) y `progress/impl_183_frontend.md` (bloque E).
> Este documento es el que R27 exige: **el mapa R→test completo**.

## Qué entregó

**Tres** métricas retiran la distinción (`ingreso_flete`, `ingreso_comision_cod`, `ingreso_iva`) y
**`egresos` la conserva** ganando `ingreso_ajuste`. `ImporteAnalitico` pasa a **unión discriminada
por `forma`**, así que leer un `neto` que no existe **no compila** (R2) en vez de resolverse a
`undefined` en ejecución.

**Por qué `egresos` no se trata como las otras tres:** `WalletEgresoService.ts:89-96` revierte un
egreso anulado emitiendo `ingreso_ajuste`, y la métrica no lo declaraba. Es decir que **anular un
egreso no lo descontaba nunca de la cifra**. Con la reversión dentro, el neto deja de ser redundante
y pasa a significar lo que realmente salió de caja.

## Mapa R → test

Construido **leyendo el caso citado** uno a uno. **Prohibido como evidencia** el conteo de `R\d+`
en títulos de test: cruza espacios de nombres entre features y ya produjo un falso 68/68 en este
repo (`progress/review_173-caja-tesoreria.md:117-120`).

| R | Dónde se mide | Detalle |
| --- | --- | --- |
| **R1** | `tests/unit/services/analitica-financiera-derivacion.test.ts` (3 casos) | el DTO serializado de las tres de Q1 no lleva la clave `neto`, ni vacía ni en `null` |
| **R2** | `tests/unit/analytics/financiera-contratos.test.ts` | dos `@ts-expect-error`; con `neto?: string` se vuelven directivas no usadas y `typecheck` cae (medido) |
| **R3** | mismo archivo que R1 + integración F.1/F.2 | el `bruto` vale lo mismo que antes de la feature |
| **R4** | `tests/unit/analytics/metrics-caja-naturaleza.guardia.test.ts` | las listas de las tres de Q1, literales (2 / 1 / 3 categorías) |
| **R5** | `tests/unit/analytics/financiera-ingresos-repo.test.ts` | **nivel repositorio**: el `where.categoria.in` emitido lleva las nueve |
| **R6** | `analitica-financiera-service.test.ts` + `financiera-forma-importe.guardia.test.ts` | `egresos` publica `bruto` **y** `neto` |
| **R7** | `analitica-financiera-derivacion.test.ts` + integración F.4(b) | par **real** (`egreso_*`/egreso + `ingreso_ajuste`/ingreso) → `neto 0.00`, `bruto 2×monto` |
| **R8** | `analitica-financiera-derivacion.test.ts` (espía) | el neto lo produce `derivarBalance`; la resta no se reescribe y el signo se conserva |
| **R9** | integración F.4(c), **contra Postgres** | el censo real de producción (4+1 filas, cero ajustes) → `bruto 22042.40` / `neto -22042.40` |
| **R10** | `analitica-financiera-service.test.ts` | `id`, `etiqueta`, `granos`, `fuente`, `estadoProduccion` de `egresos`, uno a uno |
| **R11** | `metrics-caja-naturaleza.guardia.test.ts` | la descripción declara el descuento **y la aserción discrimina**: el fixture literal pre-183 **no** pasa el predicado |
| **R12** | `catalogo-produccion.guardia.test.ts` | el bloque de `egresos` cita `progress/decision_183.md` con su fecha |
| **R13** | `metrics-caja-naturaleza.guardia` + `tests/unit/utils/caja-tesoreria.test.ts` | `NATURALEZA_POR_CATEGORIA` intacto: `ingreso_ajuste` sigue siendo `propio` |
| **R14** | `financiera-forma-importe.guardia.test.ts` | mapa a mano de las diez servidas; una sola que cambie de forma mueve una entrada |
| **R15** | mismo archivo + `analitica-financiera-service` + `financiera-produccion.guardia` | censo de 25 métricas / 10 financieras, por exceso **y** por defecto |
| **R16** | *sin test propio; evidencia de diff* | `git diff --name-only 64957dca..HEAD -- db/ prisma/` → **vacío** |
| **R17** | `financiera-ingresos-repo.test.ts` (2 casos) | el segundo caso —sobre `egresos`— **nació de una mutación que sobrevivió**; ver abajo |
| **R18** | `financiera-forma-importe.guardia.test.ts` + `financiera-contratos.test.ts` | una vista, una forma: total y filas no pueden mezclar |
| **R19** | `tests/components/TableroFinanciero.test.tsx` (×3 métricas) + `tablero-financiero-adaptar.test.ts` | pinta el bruto con etiqueta «Bruto»; **cero** marcadores de dato ausente donde iba el neto |
| **R20** | `TableroFinanciero.test.tsx` (4 casos) + `tablero-financiero-adaptar.test.ts` | donde hay los dos, se muestran los dos y distinguibles; `egresos` conserva el signo negativo (P3) |
| **R21** | `TableroFinanciero.test.tsx` (2 casos) + `tablero-financiero-adaptar.test.ts` | sin neto, **una** serie; con neto, **dos**. `esVistaConNeto` responde por la forma, y da `false` en una vista mezclada |
| **R22** | `TableroFinanciero.test.tsx` | la **misma** vista en sus dos formas produce dos pantallas distintas. **Ojo al límite de abajo** |
| **R23** | `tablero-financiero-adaptar.test.ts` | el adaptador no convierte la ausencia en `null`, `0` ni cadena vacía, ni la deriva del bruto |
| **R24** | `financiera-ingresos-repo` + `analitica-financiera-derivacion` + integración F.4(b bis) | los dos dobles imposibles reexpresados con el par real, y la premisa medida: la fila vieja es **23514** en la base |
| **R25** | *evidencia de diff, más los casos citados* | siete aserciones **dadas vuelta, no borradas**, incluido el comentario de la integración que afirmaba que el neto 0 no era alcanzable |
| **R26** | `specs/127-*/requirements.md` (**R16**, R18, R37) y `specs/132-*/requirements.md` (R16) | **cuatro** notas fechadas al margen, citando ⟨D12⟩, **sin reescribir el texto original** (precedente: T22 de la 160 sobre la 148). La de **R16 de la 127 se añadió tras el review**: ver B1 abajo |
| **R27** | *este documento* | mapa construido leyendo cada caso |

## Mutaciones: 35 ejecutadas, 35 mataron su test

**25 en backend, 10 en frontend.** Tres enseñaron algo que ningún test verde habría dicho:

1. **La de R17 SOBREVIVIÓ en la primera medición.** Clavar las nueve categorías a mano en
   `IngresosAnaliticaRepository` con un `if` por id dejaba los 15 casos **verdes**: el único test que
   decía «el catálogo manda» alteraba `ingreso_flete`, **no `egresos`**, que es la definición que
   esta feature cambia. Se rehízo el test con un caso sobre `egresos` que afirma sobre el `WHERE`
   emitido, y la reejecución la mató (commit `e3fd1a1d`).
2. **La de R11 deja 63 casos verdes.** Borrar la cláusula nueva de la descripción de `egresos` no
   rompe `metrics.test.ts` ni los dos guardias de catálogo. Sin el fixture literal pre-183 nadie la
   vería: es el defecto de R53 de la 173, reproducido.
3. **La de R7 no pone rojo el caso unitario**, porque el doble de servicio no consulta el catálogo.
   La matan el repositorio y la integración. Es la trampa del `WHERE` de este repo, confirmada otra
   vez: **probar el `WHERE` donde vive, no donde se invoca.**

## Límite conocido, escrito para que el reviewer no lo dé por bueno

**R22 está cubierto, pero NO por donde el spec decía.** El spec le asignaba esta mutación: «un
`if (metricaId === "ingreso_flete")` en el tablero → el guardia de censo lo caza». **Medido: no lo
caza.** `listasDeIdsAMano` solo marca arrays con **≥2 ids servidos**, y la propia autocomprobación
del guardia declara que una comparación suelta no cuenta
(`tests/unit/guards/tablero-financiero.guardia.test.ts:448`). El reparto real es:

| Mutación | Guardia | Quién la mata |
| --- | --- | --- |
| **lista** de ids en el componente | 🔴 rojo | el guardia |
| **decisión por id** que no forma lista | 🟢 **verde** | los casos de comportamiento (6 rojos), que comparan la misma vista en sus dos formas |

No se ensanchó el guardia: es de una feature `done` y estaba fuera del encargo. **Queda como deuda
identificada**, no como cobertura supuesta.

## Review (ronda 1): RECHAZADO, 2 bloqueantes — los dos CERRADOS

Detalle en `progress/review_183.md`. **Los dos bloqueantes eran de rastro, no de código:** se
cerraron sin tocar una línea de `lib/`, `app/`, `components/` ni `db/`.

**B1 — y es el hallazgo que más enseña de esta feature.** `specs/127-*/requirements.md:242-247`
(**R16 de la 127**) exige que `ingreso_flete`, `ingreso_comision_cod` e `ingreso_iva` se devuelvan
«**en sus dos campos `bruto` y `neto`**». Es el requisito vivo **más directamente derogado** por la
183 —nombra las tres métricas de Q1 una por una— y **ni el spec, ni ⟨D12⟩, ni las dos bitácoras lo
miraron**: la tabla de requisitos vivos listaba R18 y R37 de la 127 y R14/R16 de la 132, pero no ese.

> **La regla que queda:** buscar los requisitos vivos afectados **leyendo el spec que cita tu
> archivo** no basta. R18 y R37 se encontraron así, y por eso R16 se escapó: no habla de `metrics.ts`
> ni de `egresos`, habla del **contrato de salida**. Hay que buscarlos por el **texto del contrato que
> cambia**, no por el módulo que tocas.

**B2** — las 19 tasks de `tasks.md` seguían en `- [ ]`, contra `CHECKPOINTS.md:9`. T0–T16 marcadas;
T17 (gate y PR) y T18 (medición post-merge) quedan abiertas a propósito.

## Evidencia del gate (M6 del review)

`./init.sh` completo, **dos veces**. La primera corrida (11:48:50) se lanzó mientras aún se editaban
specs y bitácoras, así que **no medía el árbol que se iba a mergear**; se repitió con el árbol
commiteado y quieto (`git status` limpio, HEAD `0dfefb95`):

```
Test Files  926 passed (926)
     Tests  11528 passed (11528)
  Duration  240.96s
== init OK ==
```

**Baseline al arrancar la feature: 925 archivos / 11.485 tests** (medido sobre `64957dca`, no
heredado de la bitácora anterior, que decía 906/11.359 y ya estaba vieja) ⇒ **+1 archivo, +43 tests,
cero regresiones.** Las dos corridas dan el mismo número.

## Límites declarados, no tapados

| | Qué | Por qué se deja |
| --- | --- | --- |
| **M1** | La guardia de R12 solo mata la mutación si la **fecha huérfana permanece**: borrar cita y fecha a la vez la deja verde | límite de un guardia de otra feature; ensancharlo excede el alcance |
| **M2** | R22: la mutación del spec no la caza el guardia (ver arriba) | lo cubren los seis casos de comportamiento |
| **M4** | La no-regresión numérica **contra Postgres** se mide para `ingreso_flete`, no para las tres de Q1 | las otras dos se cubren por unitario; el caso de integración es el que fija la cifra real |
