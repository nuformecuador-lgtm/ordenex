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
---

## T6.3 — Gate: `./init.sh --rapido` desde `C:/w335`

**Veredicto: `== init OK ==`.**

| Tramo | Resultado |
| --- | --- |
| Modo | `✓ el cambio no toca esquema, tipos compartidos, config ni dinero: el modo rapido basta` |
| `pnpm run typecheck` | **`✓ typecheck paso`** — 0 errores |
| `pnpm run lint` | **`✓ lint paso`** — `✖ 127 problems (0 errors, 127 warnings)`. **Los 127 avisos son preexistentes de `dev`** (imports sin usar en `app/`, `<img>` en `Sidebar`, un `exhaustive-deps` en `CobroVehiculoTarifas`). Medido aparte sobre los **12 archivos de la ficha**: `exit 0`, **sin una sola línea de salida → 0 errores y 0 avisos**. |
| Tests relacionados (`--changed origin/dev`) | **82 archivos, 1118 passed + 17 skipped (1135)** — **0 rojos** |
| Guardias | **166 archivos, 2517 passed, 1 failed (2518)** |
| Comparación con el baseline | **`✓ tests: sin rojos nuevos (1 archivo rojo sobre 247 ejecutados, todos en el baseline conocido)`** |

**El único rojo es ajeno y estaba ya declarado.** Es
`tests/unit/guards/superficie-de-uso.guardia.test.ts`, que señala
`lib/actions/tarifas.ts:67 obtenerTarifa` — deuda de la cascada de tarifas (ficha 274),
inscrita en `tests/baseline-rojos.json` con motivo y fecha desde el 2026-08-28. **No tiene
camino causal con este diff**: esta ficha no toca `lib/actions/`, ni Server Actions, ni
`app/`. **Delta de rojos contra el baseline de T0.1: 0.**

Ningún rojo intermitente apareció en las corridas (el gate se ejecutó tres veces y el
conjunto de rojos fue idéntico), así que no hay nada que descartar como flake de saturación
ni nada que proponer para el baseline.

---

## Decisiones que hubo que tomar y no estaban en el spec

Cuatro. Las dos primeras son **bugs reales que el spec no preveía** y que se arreglaron; las
otras dos son límites que se documentan en vez de taparse.

### 1. «Limpiar todo» no navega si la URL no cambia
El caso NORMAL de las 8 pantallas es entrar **sin params**. Tal cual estaba escrito el
diseño, pulsar «Limpiar todo» habría disparado un `router.replace` **a la misma URL** en
todas ellas, y en el App Router eso es una navegación real (refetch del payload RSC) donde
antes no había ninguna. `borrarParams` compara ahora la query resultante con la actual y no
llama a `replace` si son idénticas.

### 2. La memoria de lo recién borrado (el bug del remonte)
**Verificado en el código, no supuesto.** `NovedadesFiltrosBarra.tsx:74` le pasa
`key={filtro.reset}` a `BuscadorFiltros`, y `useNovedadesFiltro.ts:229-235` incrementa ese
`reset` dentro del `onLimpiarTodo`. Secuencia al pulsar «Limpiar todo» con `?q=guia&zona=A`:
`borrarParams` llama a `replace`; en el mismo manejador el consumidor incrementa `reset` y
React **remonta la barra en ese mismo commit**; el `replace` de Next viaja por una transición
y **todavía no ha actualizado `useSearchParams`**; la barra recién montada lee los params
viejos y **resucita el término y el filtro que el usuario acaba de borrar**.

Se arregló **en el hook, no en `app/`** (la ficha no toca `app/`): una memoria a nivel de
módulo —sobrevive al remonte, que es justo lo que un `useRef` no hace— de los pares
`ruta + nombre + valor` recién retirados; el `params` que el hook expone los filtra.
- Se compara por **nombre Y valor**: limpiar `?zona=A` y llegar después por un enlace nuevo
  a `?zona=B` **sí se honra**. Solo se suprime exactamente lo que se acaba de tirar.
- Va **scopeada por `pathname`**: limpiar `zona=A` en `/novedades` no ciega `zona=A` en
  `/ordenes`.
- **Límite conocido — CORREGIDO tras la revisión (M1), estaba subestimado.** Lo que decía
  esta nota era «solo afecta al botón atrás». **El límite real es más ancho:**
  `paresBorrados` **no se vacía nunca en toda la sesión SPA**, así que CUALQUIER llegada
  posterior a esa misma ruta con ese mismo par `nombre=valor` queda suprimida — un `Link`
  interno, un enlace pegado en la barra de direcciones sin recarga completa, o cualquier
  navegación cliente que reconstruya esa query—, no solo el botón atrás. Se recupera con
  una recarga completa de la página.
  Lo que sí resiste, y quedó **verificado por el reviewer**: el scopeado por `pathname` y
  por **valor** evita el envenenamiento cruzado entre pantallas (limpiar `zona=A` en
  `/novedades` no ciega `zona=A` en `/ordenes`, y `?zona=B` se honra), y el conjunto
  crece **acotado** —unas pocas entradas por cada «Limpiar todo»—, así que no es un
  problema práctico de memoria.
  Se acepta a sabiendas: la alternativa —no recordar nada— resucita los filtros que el
  usuario acaba de borrar, que es un fallo visible y seguro en vez de uno raro y latente.
- **Cambió un assert preexistente**: `filtros-url-hook.test.tsx::"R24 — useSearchParams
  devuelve null…"` exigía un `replace` con la URL vacía, que es exactamente la navegación
  inútil que mata la guarda 1. Es el **único** test cuya expectativa cambia, y lleva el
  porqué escrito al lado.

### 3. Catálogo asíncrono — ESTA NOTA ERA FALSA. El reviewer la tumbó (B1) y se arregló

**Lo que decía, y era mentira:** «se revisaron los 8 consumidores y ninguno está hoy en ese
caso». **`/novedades` SÍ lo está**, y el reviewer lo midió con el hook real: entrando por
`/novedades?zona=Norte` el control se montaba diciendo **«Zona: Todas»**. El enlace
compartido no acotaba, que es la promesa entera de la ficha (R3 y R5 incumplidos).

**Por qué me equivoqué**, dicho para que no se repita: comprobé que
`novedades-filtros.ts:304-310` **declara los `FilterDef` desde el primer render** y di el
caso por descartado. Es cierto y es irrelevante: los declara con **`options: []`** mientras
`conjunto === null`, y `useNovedadesFiltro` pide el conjunto de forma **perezosa**. La
clave se activaba (R2, correcto) pero su valor caía por R14 contra un catálogo vacío, se
apuntaba como sembrada y **no se reintentaba jamás**. Miré si el filtro se DECLARABA cuando
lo que decidía el resultado era si tenía OPCIONES.

**Agravante, y la causa de que pasara inadvertido (B1-bis):** el test de herencia de T5.1
sustituía `useNovedadesFiltro` por una maqueta con las `options` ya presentes. Decía
«consumidor REAL» y ejercitaba la cáscara de presentación. Un test que no puede fallar por
el fallo no vale; está reescrito contra el hook real, con el catálogo llegando **después**
del montaje.

**Cómo quedó arreglado:** ver «La corrección tras la revisión» más abajo. En una frase: se
congelan los params de entrada en un **snapshot inmutable** y se **re-siembra contra ese
snapshot** cuando aparecen opciones para una clave todavía no sembrada. Re-sembrar contra la
foto de entrada **no viola R7**: R7 prohíbe **releer** la URL, no prohíbe **terminar de
aplicar lo que ya se leyó**.

### 4. Un byte NUL crudo en el fuente
`FilterComponent.tsx` traía desde `origin/dev` (commit `0cd040f7`, fichas 144/169) un
`join("<NUL crudo>")`, y por eso **git clasificaba el archivo como binario y no mostraba sus
diffs**. Al copiarse el patrón, `useFiltrosUrl.ts` heredó el problema. Se extrajo a una
constante con el byte **escapado** (`"\u0000"`) en los dos archivos: mismo valor en
ejecución, y los dos vuelven a ser texto UTF-8 revisable. Es la única línea de
`FilterComponent.tsx` que se toca sin pedirlo la ficha.

---

## Lo que este implementer NO hizo

- **No se tocó ni un archivo bajo `app/`.** Confirmado en el diff.
- **No se hizo push ni PR** (es del leader).
- **No se corrió `./init.sh` completo** — el rápido es el gate normal y también el de PR
  (`docs/verification.md`); el completo es obligatorio antes de una release a `prod` y
  después del merge a `dev`.
- **No se tocó `tests/baseline-rojos.json`**: no había nada que añadir ni nada que podar
  (el único rojo listado sigue rojo y sigue siendo ajeno).

---

## Aviso para quien aterrice esto: `dev` se movió mientras se implementaba

La rama salió de `2f9f3f6f`. Mientras se trabajaba, **`origin/dev` avanzó 4 commits**
(PR #624 `fix/historico-conversaciones-movil` y PR #625 `fix/nombre-completo-mensajero`),
que tocan `lib/repositories/*`, `lib/utils/nombre-usuario.ts` y
`app/(app)/historico/conversaciones/*`. **Ni un solo archivo se solapa con esta ficha**, así
que no hay conflicto semántico ni textual previsible, pero **la rama está 4 commits por
detrás** y hay que ponerla al día antes del PR.

Diff real de la ficha, medido contra la base común (`git merge-base`) y no contra el `dev` ya
movido: **17 archivos, +3122/-12**, de los cuales **0 bajo `app/`**.

Recordatorio de `docs/verification.md`: el gate rápido compara `--changed` **contra** `dev`,
así que **no ve un `dev` que ya venga rojo**. La corrida completa post-merge sigue siendo
obligatoria.

---

## M3 — `/novedades` monta DOS barras: la precarga se duplica. LÍMITE CONOCIDO, no se toca.

Las dos pestañas de `/novedades` viven montadas a la vez (`keepMounted`) con el mismo
`pathname`, así que entrar por `/novedades?q=guia` **escribe el término en los DOS campos y
dispara DOS `listarCompleto()`**, que es la lectura cara de esa pantalla.

No incumple ningún requisito escrito, y **no se corrige en esta ficha por decisión expresa
del coordinador**: lo consulta con el humano y, si hay que acotarlo, es ficha aparte.
Verificado por el reviewer que **no hay envenenamiento cruzado** de la memoria de borrados
entre las dos barras.

Queda anotado aquí precisamente para que no se descubra dos veces.
