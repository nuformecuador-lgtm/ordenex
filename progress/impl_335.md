# 335 — Bitácora de implementación

Rama: `feature/335-filtros-desde-url` · worktree `C:/w335` · base `origin/dev` (2f9f3f6f).

## T0.1 — Baseline (2026-08-31, antes de tocar nada)

- `components/shared/BuscadorFiltros.tsx` y `components/shared/FilterComponent.tsx`
  **idénticos a `origin/dev`** (`git diff --stat origin/dev --` sin salida). La 326 no los
  ha movido todavía.
- `pnpm db:generate` fue necesario: el worktree recién creado no tenía cliente Prisma y el
  typecheck daba 14 errores fantasma `Module '@prisma/client' has no exported member`.
  **No son rojos del repo**, son árbol sin generar.
- `pnpm typecheck` → **verde, 0 errores**.
- Subconjunto de tests que esta ficha puede tocar
  (`tests/unit/components`, `CierresAdminFiltros`, `HistoricoFiltros`, `NovedadesBuscador`,
  `CierresAdminDeepLink`, `descarga/SateliteDescarga`, `tests/components/paginacion`):
  **77 archivos / 1053 tests, 0 rojos**, 192 s.

**Baseline de rojos preexistentes en el perímetro de la ficha: 0.**

---

## Qué se construyó

Cuatro piezas, ninguna bajo `app/`. La restricción dura del diseño (§6) —«la 335 no toca
ni un archivo bajo `app/`»— **se cumplió**: el diff son 2 archivos compartidos, 2 archivos
nuevos y sus tests.

### Archivos creados
| Archivo | Qué es |
| --- | --- |
| `lib/utils/filtros-url.ts` | El **códec puro**. Sin React, sin DOM, sin router. Ahí viven R4 y R8-R16 y son verificables sin renderizar nada. |
| `hooks/useFiltrosUrl.ts` | La **única pieza que toca `next/navigation`**. Congela la lectura y expone `borrarParams`. |
| `tests/unit/utils/filtros-url.test.ts` | Formato de valores y borrado (R4, R8, R9, R15, R19-R21). |
| `tests/unit/utils/filtros-url-kinds.test.ts` | Validación por `kind` (R10-R14, R16). |
| `tests/unit/hooks/filtros-url-hook.test.tsx` | El hook: entornos sin router, borrado, las dos guardas. |
| `tests/unit/components/buscador-filtros-url.test.tsx` | La barra: precarga, activación, «Limpiar todo», no-escritura. |
| `tests/unit/components/buscador-filtros-url-sin-router.test.tsx` | R24 con `next/navigation` mockeado a medias (archivo aparte: el mock es por archivo). |
| `tests/unit/components/filter-component-url.test.tsx` | El orquestador: siembra, orden de montaje, poda, controles no controlados. |
| `tests/unit/components/filtros-url-herencia.test.tsx` | **T5.1**: `NovedadesFiltrosBarra` real hereda la capacidad sin editarlo. |
| `tests/unit/guards/filtros-url-r25.test.ts` | **R25 como assert ejecutable**, no como «lint en verde». |

### Archivos modificados
| Archivo | Qué cambió |
| --- | --- |
| `components/shared/BuscadorFiltros.tsx` | +79/-5. Props `leerDeUrl` (default `true`) y `terminoKey` (default `"q"`). Término en inicializador perezoso; efecto de montaje de una sola pasada que emite claves y término; `limpiarTodo` borra los params propios. |
| `components/shared/FilterComponent.tsx` | +192/-10. Prop `leerDeUrl`. Selección en inicializador perezoso; siembra por crecimiento **dentro del efecto de poda**; cierre tras el primer gesto; `valorInicial` en `TextFilter` y `defaultRange` en `DateRangeFilter` para que el control no mienta. |
| `specs/335-filtros-desde-url/tasks.md` | Tasks marcadas `[x]`. |

**Las dos piezas de diseño intocables se respetaron:**
1. **El reparto.** `BuscadorFiltros` lee el término y decide qué claves activar (es el único
   que ve `filtros` y puede llamar a `onActivosChange`); `FilterComponent` lee los valores
   (es el único que tiene `kind`/`options` para validarlos).
2. **La lectura inicial va en inicializador perezoso de `useState`, no en un efecto**, en los
   dos componentes. R25 lo verifica ahora un guardia que corre ESLint de verdad.

**La poda (R17) no hizo falta desactivarla.** La siembra sucede siempre sobre claves ya
declaradas (`montados`), así que la poda nunca las ve como sobrantes. Además la siembra por
crecimiento se metió **dentro del mismo efecto de poda** en vez de en uno nuevo: los dos
reaccionan al mismo disparador (`clavesMontadas`) y escriben el mismo estado, así que
separarlos habría dejado el resultado a merced del orden en que corrieran.

---

## T6.1 — `Suspense` / prerender (design §4)

`pnpm exec next build` (**nunca** `pnpm build`, que encadena `migrate deploy` contra una base
real): **exit 0**, `✓ Compiled successfully in 23.3s`, `✓ Generating static pages (53/53)`.
**Ninguna ruta se quejó** por `useSearchParams` y **las 38 rutas de `(app)` siguen marcadas
`ƒ` (dynamic)**, que es lo que el diseño predecía: viven bajo un layout autenticado. No hizo
falta ni `leerDeUrl={false}` en ningún consumidor ni un `Suspense` local.

---

## T6.2 — Mapa de trazabilidad `R<n> -> test`

**25 de 25 requisitos tienen un test nombrado.** Ninguno dice «cubierto indirectamente».
101 casos llevan una etiqueta `R<n>` en el nombre del `it`; la columna «Otros» cuenta los
tests adicionales que también lo cubren.
| Requisito | Test que lo verifica | Otros |
| --- | --- | --- |
| R1 | `tests/unit/utils/filtros-url.test.ts`::«R1 — el termino libre llega recortado desde su param» | 5 |
| R2 | `tests/unit/utils/filtros-url.test.ts`::«R2 — las claves activas salen en el orden OFRECIDO, no en el de la URL» | 6 |
| R3 | `tests/unit/components/filter-component-url.test.tsx`::«R3 — con `?color=rojo,azul` el control aparece con las dos marcadas y la seleccion se emite» | 7 |
| R4 | `tests/unit/utils/filtros-url.test.ts`::«R4 — el nombre del param es exactamente FilterDef.key, sin prefijo ni transformacion» | 1 |
| R5 | `tests/unit/components/buscador-filtros-url.test.tsx`::«R5 — con `?q=abc` el consumidor recibe `abc` por `onChange` exactamente una vez» | 1 |
| R6 | `tests/unit/components/buscador-filtros-url.test.tsx`::«R1/R6 — sin params el campo aparece vacio» | 3 |
| R7 | `tests/unit/components/buscador-filtros-url.test.tsx`::«R7 — cambiar los params DESPUES del montaje no cambia el campo» | 2 |
| R8 | `tests/unit/utils/filtros-url.test.ts`::«R8 — parte un param por coma en una lista de valores» | 3 |
| R9 | `tests/unit/utils/filtros-url.test.ts`::«R9 — concatena las apariciones repetidas en el orden de la URL» | — |
| R10 | `tests/unit/utils/filtros-url-kinds.test.ts`::«R10 — acepta un atajo ofrecido en la terna `atajo,desde,hasta`» | 7 |
| R11 | `tests/unit/utils/filtros-url-kinds.test.ts`::«R11/R16 — cualquier otro valor descarta el param» | — |
| R12 | `tests/unit/utils/filtros-url-kinds.test.ts`::«R12 — se queda con el PRIMER valor valido y descarta el resto» | 1 |
| R13 | `tests/unit/utils/filtros-url-kinds.test.ts`::«R13 — acepta el valor recortado cuando alcanza minChars» | 4 |
| R14 | `tests/unit/utils/filtros-url-kinds.test.ts`::«R14 — conserva los valores declarados y descarta los que no estan en options» | 2 |
| R15 | `tests/unit/utils/filtros-url.test.ts`::«R15 — un param que no corresponde a ningun filtro ofrecido no activa nada» | 3 |
| R16 | `tests/unit/utils/filtros-url-kinds.test.ts`::«R14/R16 — si ningun valor esta declarado, la clave no aparece en la seleccion» | 6 |
| R17 | `tests/unit/components/filter-component-url.test.tsx`::«R17 — tras el ciclo completo de efectos no llega ninguna emision que borre la clave sembrada» | — |
| R18 | `tests/unit/hooks/filtros-url-hook.test.tsx`::«R18/R22 — «Limpiar todo» sin un solo param propio que borrar NO llama a replace» | 2 |
| R19 | `tests/unit/utils/filtros-url.test.ts`::«R19 — quita el param del termino y las claves propias» | 6 |
| R20 | `tests/unit/utils/filtros-url.test.ts`::«R20 — conserva los params ajenos con su valor y sin reordenarlos» | 4 |
| R21 | `tests/unit/utils/filtros-url.test.ts`::«R21 — sin ningun par restante devuelve cadena vacia» | 2 |
| R22 | `tests/unit/hooks/filtros-url-hook.test.tsx`::«R19/R20/R22 — replace recibe la ruta con SOLO los params ajenos y { scroll: false }» | 3 |
| R23 | `tests/unit/hooks/filtros-url-hook.test.tsx`::«R23 — con activo=false los params se ven vacios y la URL no se toca» | 2 |
| R24 | `tests/unit/hooks/filtros-url-hook.test.tsx`::«R24 — mock PARCIAL sin useSearchParams ni usePathname: no lanza y la URL se ve vacia» | 4 |
| R25 | `tests/unit/guards/filtros-url-r25.test.ts`::«R25 — la regla que codifica el requisito existe y esta ACTIVA en la config del repo» | 2 |