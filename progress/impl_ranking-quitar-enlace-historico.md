# Quitar el enlace «Histórico» de la cabecera de `/ranking`

**Rama:** `fix/ranking-quitar-enlace-historico` (creada desde `origin/dev` = `b022fa79`).
**Sin commit y sin PR**, según el encargo. Fecha: 2026-08-21.

## Qué pidió el humano

> «Hay un botón flotando en el módulo de ranking, el cual dice histórico y lleva al
> histórico, pero parece un botón desubicado; creo que sería mejor quitarlo de allí, es decir
> borrarlo.»

## 1. Qué se borró

`app/(app)/ranking/page.tsx`, **13 líneas de cuerpo + 2 de import**:

- El bloque `const enlaceHistorico = (...)`: un `<Link href="/ranking/historico">` con
  `className={buttonVariants({ variant: "brand-outline" })}` y el texto «Histórico», más el
  comentario de 4 líneas que lo introducía («Feature 196 (T4.5): ÚNICO cambio de esta
  pantalla…»).
- La prop `actions={enlaceHistorico}` del `AppPage`. Era su **único** contenido, así que la
  prop desaparece entera: `AppPage` la declara opcional y el `PageHeader` no pinta el hueco
  cuando no llega nada, así que no queda un contenedor vacío ocupando sitio en la cabecera.

No se tocó nada más de la pantalla: `obtenerRankingAction`, el guard de roles, `RankingPodio`
y `RankingModule` quedan **letra por letra** como estaban (es lo que R36 de la 196 exigía y
sigue exigiendo, ahora en el sentido contrario).

## 2. Imports huérfanos, y cómo se comprobó que lo eran

Al borrar el enlace, dos imports quedaron sin ningún consumidor en el archivo:

| Import | Único uso que tenía | Acción |
| --- | --- | --- |
| `import Link from "next/link";` | el `<Link>` del enlace | **borrado** |
| `import { buttonVariants } from "@/components/ui/button";` | el `className` del enlace | **borrado** |

Comprobación, en este orden:

1. `grep -n "Link\|buttonVariants" "app/(app)/ranking/page.tsx"` → **sin resultados**. No es
   solo que no queden usos: no queda ni la palabra, así que no hay un uso indirecto (tipo
   `typeof buttonVariants`) que se me haya escapado.
2. `pnpm run lint` → **0 errores**. `@typescript-eslint/no-unused-vars` es la regla que habría
   cazado un import muerto si me hubiera dejado uno; el conteo de warnings **no subió**
   (99, la línea base exacta del encargo).
3. `pnpm run typecheck` → limpio, que es lo que confirma que quitar `actions` no rompe el
   contrato de props de `AppPage`.

Los otros imports del archivo (`notFound`, `AppPage`, `resolveActorFromSession`,
`esAccesoTotal`, `obtenerRankingAction`) siguen todos en uso; ninguno colgaba del enlace.

## 3. Dónde quedó la nota de reversión

El enlace lo puso la **feature 196, T4.5**, y su propio comentario lo llamaba «el ÚNICO cambio
de esta pantalla»: borrarlo revierte esa decisión. Siguiendo lo que esta sesión ya hizo dos
veces (la 259 con D10 en `specs/246-asignacion-por-dia/requirements.md`, y la 260 con R49 en
`specs/192-tablero-dia-mensajeros/requirements.md`), **el texto original no se tocó**: se le
puso al lado un apéndice fechado.

- **`specs/196-snapshot-ranking-diario/tasks.md`**, justo debajo de **T4.5** — la nota larga.
  Dice qué mitad de la tarea se revierte (la de `/ranking`) y cuál **se queda** (el subítem del
  menú en `menu-visibility.ts`), el motivo con fecha y en boca del humano, y por qué el
  histórico **no queda inalcanzable**.
- **`specs/196-snapshot-ranking-diario/design.md` §6** — una nota de 3 líneas colgando del
  bullet que decía «`/ranking` (vivo) **no cambia** salvo el enlace al histórico», que era la
  otra frase del spec que a partir de hoy mentiría. Remite a la nota de T4.5 para el detalle,
  para no tener dos versiones del mismo motivo que puedan divergir.

No se editó `progress/impl_196.md` ni `progress/review_196.md`: son bitácoras de una sesión
pasada, fotos de su momento; anotar ahí una decisión de hoy sería falsificar el registro.

## 4. El histórico sigue alcanzable (verificado, no asumido)

`lib/auth/menu-visibility.ts:306` mantiene `{ label: "Histórico", href: "/ranking/historico" }`
como subítem de «Ranking», y los subítems **heredan los roles del padre**: `maestro`, `admin`
y `mensajero` — exactamente los tres que el guard de `/ranking` deja entrar. Nadie pierde
acceso. **El sidebar no se tocó**, ni tampoco `/ranking/historico`, sus componentes o sus
tests.

## 5. Comentarios revisados (ninguno quedó mintiendo)

| Sitio | Qué dice | Veredicto |
| --- | --- | --- |
| `tests/components/AppLayout.test.tsx:83` | «Feature 196 (T4.5): "Ranking" pasó a tener subítems ("Ranking del día" / "Histórico"), así que el Sidebar lo renderiza como disparador colapsable y ya no como enlace» | **Sigue siendo cierto, se queda.** Habla del **sidebar**, no de la cabecera de `/ranking`: los subítems no se han tocado y «Ranking» sigue siendo un disparador colapsable. La aserción que acompaña al comentario (`getByRole("button", { name: /ranking/i })`) pasa igual, y de hecho pasó. |
| `tests/components/Sidebar.test.tsx:163-176` | el subítem «Histórico» queda activo con `/ranking/historico` | Cierto y **deliberadamente intacto**: es el test de la puerta que se queda. |
| `specs/196…/design.md:248` | «`/ranking` no cambia salvo el enlace» | Habría quedado mintiendo → **anotado** (§3). |
| `specs/196…/tasks.md` T4.5 | «el único cambio en `page.tsx` es el enlace» | Habría quedado mintiendo → **anotado** (§3). |

Barridos hechos para no dejar ninguno suelto: `grep -rn "ranking/historico"` sobre `*.ts`,
`*.tsx` y `*.md`; `grep -rn "T4\.5"` en todo el árbol; `grep -rln "Histórico"` en `tests/`;
`grep -rn -i "hist.rico"` en `docs/`; y lo mismo en `progress/current.md`. Fuera de lo ya
listado, todo lo que aparece es de la propia pantalla `/ranking/historico` (intocada), de
`cierres-admin`/`incidentes` (otro «histórico», sin relación) o de bitácoras históricas en
`progress/`.

## 6. Ningún test afirmaba el enlace

`grep -rln "ranking/page" tests/` devuelve **un solo archivo**,
`tests/components/RankingPage.test.tsx`, y ahí no hay ni una mención a «Histórico», a
`buttonVariants` ni a `actions`. Coincide con lo que el leader ya había comprobado. Por eso
**no se borró ni se editó ningún test**: no había un test que se quedara sin objeto.

## 7. Salida real de los comandos

```
$ pnpm run typecheck
> ordenex@0.1.0 typecheck R:\job\singularis\projects\ordenex
> tsc --noEmit

TYPECHECK_EXIT=0
```

```
$ pnpm run lint
(…lista de warnings preexistentes, todos en tests/, todos del tipo "'_x' is defined but never used"…)
✖ 99 problems (0 errors, 99 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.

LINT_EXIT=0
```

→ **99 warnings, la línea base exacta. No sube ninguno, y 0 errores.**

```
$ pnpm exec vitest run tests/components
 RUN  v4.1.10 R:/job/singularis/projects/ordenex

 Test Files  222 passed (222)
      Tests  2961 passed | 26 skipped (2987)
   Duration  220.35s

VITEST_EXIT=0
```

**Extra, no pedido pero barato:** como el cambio borra código de una `page.tsx` y hay guardias
que leen el árbol de `app/(app)` por texto (`superficie-de-uso`, `landing-sin-maqueta`,
`hilo-ventana-alcanzable`…), corrí la carpeta entera de guardias para descartar una roja por
un archivo que ya no contiene lo que ellas buscan:

```
$ pnpm exec vitest run tests/unit/guards
 Test Files  63 passed (63)
      Tests  935 passed (935)
   Duration  7.42s

GUARDS_EXIT=0
```

Ninguna guardia se puso roja, así que **no hubo que aflojar nada**. El gate
(`./init.sh --rapido`) lo corre el leader; yo no lo ejecuté para no pisarle el árbol.

## Archivos tocados

| Archivo | Cambio |
| --- | --- |
| `app/(app)/ranking/page.tsx` | Borrado el `<Link>` «Histórico», la prop `actions` y los 2 imports huérfanos |
| `specs/196-snapshot-ranking-diario/tasks.md` | Apéndice fechado bajo T4.5 (texto original intacto) |
| `specs/196-snapshot-ranking-diario/design.md` | Nota fechada en §6 (texto original intacto) |
| `progress/impl_ranking-quitar-enlace-historico.md` | Este informe |
