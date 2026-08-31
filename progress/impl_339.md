# 339 — Bitácora de implementación

Rama: `feature/339-filtros-desde-url` · worktree `C:/w335` · base `origin/dev` (2f9f3f6f).

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

Cuatro piezas, ninguna bajo `app/`. La restricción dura del diseño (§6) —«la 339 no toca
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
| `specs/339-filtros-desde-url/tasks.md` | Tasks marcadas `[x]`. |

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

**25 de 25 requisitos tienen un test nombrado.** 110 casos etiquetados sobre 87 `it` en
**9 archivos**.

**«Rojo demostrado» = se vio fallar de verdad contra un árbol roto**, no «debería fallar».
Son **6** requisitos: los 5 de la primera corrección (verificados restaurando
`FilterComponent.tsx` a `41c774c9`) más **R17**, que la segunda revisión detectó que pasaba
igual con y sin arreglo (M5) y que ahora cae bajo mutación.

| Requisito | Test que lo verifica | Otros | Rojo demostrado |
| --- | --- | --- | --- |
| R1 | `filtros-url.test.ts`::«R1 — el termino libre llega recortado desde su param» | 5 | — |
| R2 | `filtros-url-herencia.test.tsx`::«R2/R3/R5 — entrando por `?zona=…` el control queda con esa zona SELECCIONADA cuando llega el catalogo» | 6 | **sí** |
| R3 | `filter-component-url.test.tsx`::«R3/R5 — un catalogo que llega DESPUES del montaje siembra la clave que quedo pendiente» | 9 | **sí** |
| R4 | `filtros-url.test.ts`::«R4 — el nombre del param es exactamente FilterDef.key, sin prefijo ni transformacion» | 1 | — |
| R5 | `filter-component-url.test.tsx`::«R3/R5 — un catalogo que llega DESPUES del montaje siembra la clave que quedo pendiente» | 3 | **sí** |
| R6 | `buscador-filtros-url.test.tsx`::«R1/R6 — sin params el campo aparece vacio» | 3 | — |
| R7 | `filter-component-url.test.tsx`::«R7 — cambiar los params ANTES de declarar el filtro no siembra el valor nuevo» | 5 | **sí** |
| R8 | `filtros-url.test.ts`::«R8 — parte un param por coma en una lista de valores» | 3 | — |
| R9 | `filtros-url.test.ts`::«R9 — concatena las apariciones repetidas en el orden de la URL» | — | — |
| R10 | `filtros-url-kinds.test.ts`::«R10 — acepta un atajo ofrecido en la terna `atajo,desde,hasta`» | 7 | — |
| R11 | `filtros-url-kinds.test.ts`::«R11/R16 — cualquier otro valor descarta el param» | — | — |
| R12 | `filtros-url-kinds.test.ts`::«R12 — se queda con el PRIMER valor valido y descarta el resto» | 1 | — |
| R13 | `filtros-url-kinds.test.ts`::«R13 — acepta el valor recortado cuando alcanza minChars» | 4 | — |
| R14 | `filtros-url-kinds.test.ts`::«R14 — conserva los valores declarados y descarta los que no estan en options» | 2 | — |
| R15 | `filtros-url.test.ts`::«R15 — un param que no corresponde a ningun filtro ofrecido no activa nada» | 3 | — |
| R16 | `filtros-url-kinds.test.ts`::«R14/R16 — si ningun valor esta declarado, la clave no aparece en la seleccion» | 6 | — |
| R17 | `filter-component-url.test.tsx`::«R17 — cuando la poda SI tiene trabajo, se lleva lo que sobra y conserva lo sembrado» | 1 | **sí** |
| R18 | `filtros-url-hook.test.tsx`::«R18/R22 — «Limpiar todo» sin un solo param propio que borrar NO llama a replace» | 2 | — |
| R19 | `filtros-url.test.ts`::«R19 — quita el param del termino y las claves propias» | 6 | — |
| R20 | `filtros-url.test.ts`::«R20 — conserva los params ajenos con su valor y sin reordenarlos» | 4 | — |
| R21 | `filtros-url.test.ts`::«R21 — sin ningun par restante devuelve cadena vacia» | 2 | — |
| R22 | `filtros-url-hook.test.tsx`::«R19/R20/R22 — replace recibe la ruta con SOLO los params ajenos y { scroll: false }» | 3 | — |
| R23 | `filtros-url-hook.test.tsx`::«R23 — con activo=false los params se ven vacios y la URL no se toca» | 2 | — |
| R24 | `filtros-url-hook.test.tsx`::«R24 — mock PARCIAL sin useSearchParams ni usePathname: no lanza y la URL se ve vacia» | 4 | — |
| R25 | `filtros-url-r25-propiedad.test.tsx`::«R25 — mutar los query params tras el montaje no entra por la siembra: gana la foto de entrada» | 3 | **sí** |

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

---

# La corrección tras la revisión (rechazo del 2026-08-31)

El reviewer rechazó la ficha con **dos bloqueantes** (`progress/review_339.md`). El gate
estaba verde y limpio: **el problema era de corrección, no de suite**. B1 y B2 resultaron ser
**el mismo nudo** y se soltaron con un solo cambio.

## El nudo, y por qué un solo cambio lo suelta

| | Qué estaba mal | Consecuencia |
| --- | --- | --- |
| **B2** | `paramsRef` se **reescribía en cada render**, así que la siembra por crecimiento leía la URL **de ahora** | **R7 era FALSO**: montar sin params, cambiar la URL a `?color=azul` y declarar después el filtro sembraba `azul` |
| **B1** | `sembradas` se apuntaba **por DECLARAR**, no por sembrar; y el efecto solo dependía de `clavesMontadas`, que **no cambia** cuando llegan las opciones | En `/novedades?zona=Norte` el control se montaba diciendo **«Zona: Todas»**. **R3 y R5 incumplidos**: el enlace compartido no acotaba |

**La salida (decidida por el coordinador):** congelar los params **leídos al entrar** en un
snapshot inmutable —capturado una vez, nunca reasignado— y **re-sembrar contra ESE snapshot**
cuando aparezcan opciones para una clave todavía pendiente.

> **La distinción que no hay que deshacer** —queda escrita con estas palabras en el propio
> `FilterComponent.tsx`, porque es sutil y se ve al revés:
> **R7 prohíbe RELEER la URL, no prohíbe TERMINAR DE APLICAR lo que ya se leyó.**
> Lo que se aplica tarde no es información nueva: es exactamente la que traía la dirección
> por la que el usuario entró. Volver a leer `params` en esos puntos —que es lo que parece
> «más correcto»— reintroduce B2 entero.

## Qué cambió, bloqueante a bloqueante

- **B2** — Fuera `paramsRef` y fuera `params` de la línea del efecto que reescribe refs. En
  su lugar `const [paramsIniciales] = useState(() => new URLSearchParams([...params.entries()]))`:
  copia propia, capturada una vez. Leen **la foto** el inicializador de `seleccion`, el
  `useMemo` de `precargaUrl` (si mirara la URL viva, el cambio se colaría hasta el valor
  inicial de los controles no controlados y R7 sería falso **por otra puerta**) y la siembra
  del efecto. **R7 pasa a ser estructural: ya no queda ninguna referencia viva a la URL.**
- **B1** — `sembradas` se apunta **por SEMBRAR**: solo las claves cuya siembra produjo
  valores. Las que no, quedan **pendientes** y se reintentan. Disparador nuevo:
  **`firmaCatalogo`** (`clave:nº de opciones`) como segunda dependencia del efecto — sin ella
  el reintento no existe, porque cuando el catálogo pasa de vacío a lleno **el juego de claves
  no cambia**. Se calcula sobre *todos* los montados, no solo los pendientes, porque saber
  cuáles están pendientes exige leer `sembradas.current` y la regla `react-hooks/refs` del
  repo prohíbe leer una ref durante el render.
- **Lo que NO se rompió:** siembra y poda siguen **en el mismo efecto** (R17 verde); el
  `return` temprano sigue guardando el **silencio de R6**; y el **gesto del usuario gana** —si
  tocó algo, la siembra queda cerrada y el catálogo que llega tarde no le pisa la selección.
- **B1-bis** — `filtros-url-herencia.test.tsx` (T5.1) **reescrito entero**: monta el **hook
  real** `useNovedadesFiltro("devolucion", listarCompleto)` con un `listarCompleto` **diferido**
  (promesa que el test resuelve a mano), y afirma el ANTES («Zona: …Todas», lista sin acotar)
  y el DESPUÉS («Zona: GAM Oeste», lista acotada). Antes sustituía el hook por una maqueta con
  las `options` ya presentes: decía «consumidor REAL» y ejercitaba la cáscara de presentación.
- **M2** — El guardia de R25 conserva sus tres casos de ESLint (incluido el que comprueba que
  la regla existe y está **activa**, que es lo que impide el verde vacío) y **suma una mitad de
  comportamiento**: renderiza, muta los params tras el montaje, hace crecer el catálogo y exige
  que gane la foto de entrada. Hacen falta las dos: **el linter para la forma, el render para
  la propiedad que el linter no puede ver** (no sigue la indirección `aplicar(...)`, que era
  justo el camino de B2).

## Decisiones propias durante la corrección

1. **Se marca por «leído», no por «aplicado tras podar».** El efecto de montaje apunta las
   claves de `seleccionDesdeUrl(...)` **sin** pasar por `podarSeleccion`. Marcando las de la
   selección ya podada, una clave retirada por incoherencia con su padre quedaría pendiente y
   se resembraría en cada cambio de firma, emitiendo de más y rompiendo el silencio de R6.
2. **El caso «el gesto del usuario gana» usa catálogo PARCIAL** (`options: [verde]`) y no
   vacío: con catálogo vacío el control va `disabled` por R14 y el usuario no podría tocar
   nada — el escenario sería inejercitable.
3. **`firmaCatalogo` y `clavesMontadas` conviven como dependencias** aunque la firma ya
   codifica las claves: la segunda es la que el cuerpo usa para la poda, y dejarla explícita
   hace legible que el efecto tiene dos trabajos.

## Gate tras la corrección — `./init.sh --rapido`

**Veredicto: `== init OK ==`.**

| Tramo | Antes del rechazo | **Tras la corrección** |
| --- | --- | --- |
| `typecheck` | verde, 0 errores | **verde, 0 errores** |
| `lint` | 0 errores, 127 avisos ajenos | **0 errores, 127 avisos ajenos** (0 en los archivos de la ficha) |
| Relacionados | 83 archivos, 1122 passed | **83 archivos, 1128 passed + 17 skipped (1145)**, 0 rojos |
| Guardias | 167 archivos, 2524 passed, 1 failed | **167 archivos, 2525 passed, 1 failed (2526)** |
| Baseline | sin rojos nuevos | **`✓ sin rojos nuevos (1 archivo rojo sobre 249 ejecutados, todos en el baseline conocido)`** |

El único rojo sigue siendo `superficie-de-uso.guardia.test.ts` → `lib/actions/tarifas.ts:67
obtenerTarifa`, **ajeno**, inscrito en `tests/baseline-rojos.json` desde el 2026-08-28. Esta
ficha no toca `lib/actions/`, ni Server Actions, ni `app/`. **Delta de rojos: 0.**

**Sigue sin tocarse ni un archivo bajo `app/`** (verificado en el diff del arreglo: 4
archivos, +432/−124, ninguno en `app/`).

---

# Segunda corrección: B3, M5 y M1 (2026-08-31)

Segunda revisión: el arreglo de fondo (B1/B2) quedó **verificado y no se tocó**. Quedaban un
bloqueante y dos residuos, **los tres de test o de comentario**. `FilterComponent.tsx` queda
**byte a byte idéntico** (`git diff 813029d8 HEAD -- components/shared/FilterComponent.tsx`
vacío) y de `hooks/useFiltrosUrl.ts` **solo cambia el bloque de comentario**.

## B3 (bloqueante) — el guardia de R25 se saltaba solo y aun así se veía verde

Al fusionar la mitad de comportamiento (M2), el archivo pasó a `// @vitest-environment jsdom`
y **el arranque de ESLint quedó corriendo dentro de jsdom**: el `beforeAll` expiraba ~2 de
cada 5 corridas —una vez **113 s aislado, sin nada compitiendo**, o sea *no* era saturación—.
Lo grave no era el rojo: al expirar un `beforeAll` **sus 3 casos quedan SKIPPED**, así que la
mitad de linter de R25 dejaba de verificar nada.

**Se partió en dos**, que es lo que devuelve la holgura en vez de depender de acertar un
número:

| Archivo | Entorno | Qué vigila |
| --- | --- | --- |
| `tests/unit/guards/filtros-url-r25.test.ts` | **node** (se le quitó la directiva jsdom) | la FORMA: ESLint con la config real; 3 casos, incluido el que exige que la regla exista y esté **activa** |
| `tests/unit/guards/filtros-url-r25-propiedad.test.tsx` | jsdom | la PROPIEDAD que el linter no ve: mutar los params tras el montaje no entra por la siembra |

Cada archivo lleva cabecera diciendo que son las dos mitades de R25, cómo se llama la otra y
**qué costó separarlas**, para que nadie las vuelva a juntar sin saberlo.

### Los números (medidos, no estimados)

Sacar el linter de jsdom lo dividió por ~7. Medido en dos tandas independientes:

| Tanda | Corridas | Peor | Resultado |
| --- | --- | --- | --- |
| Subagente (máquina con carga) | 5 | **16,8 s** (tramo `tests`) | `3 passed (3)` ×5 |
| **Mía, verificación independiente** | 5 | **44,2 s** de reloj total (la 1.ª, aún con carga); las otras 13,5–24,0 s | `3 passed (3)` ×5 |
| **Mía, máquina en reposo** | 3 | **5,5 s** (tramo `tests`) / 7,9 s de reloj | `3 passed (3)` ×3 |

**13 corridas post-partición: 0 timeouts, 0 SKIPPED, 0 rojos.** Contra los **>113 s** de
antes. La mitad de comportamiento va en **0,6–0,7 s**.

**El `hookTimeout` se deja en 60 s y NO se sube**: ahora son ~3,5x sobre el peor caso bajo
carga y ~11x en reposo. Queda escrito en el fuente con las cifras y con la instrucción de que,
si algún día roza los 60 s, se **vuelva a medir** para averiguar qué se ha encarecido, en vez
de inflar el número a ojo.

## M5 — R17 pasaba con y sin el arreglo. Ahora cae bajo mutación.

El diagnóstico era exacto: el caso viejo monta **solo** la clave sembrada, así que la poda
calcula `sobran = []` y **sale por el `return` temprano sin ejercitar nunca la convivencia**.

Caso nuevo: entra con `?color=rojo&acabado=brillo` y luego **retira `acabado` de `filters`**,
de modo que la poda tiene trabajo real y `color` debe sobrevivir.

**Verificado por mí**, no solo por el subagente. Mutación en `FilterComponent.tsx:627`,
`{ ...actual, ...sembrado }` → `{ ...sembrado }`:

```
× R17 — cuando la poda SI tiene trabajo, se lleva lo que sobra y conserva lo sembrado
  → esperado { "color": ["rojo"] } · recibido {}
  Tests  1 failed | 1 passed | 16 skipped (18)
```

**Lo revelador: con la mutación puesta, el caso VIEJO de R17 seguía pasando.** Confirma que no
distinguía un árbol sano de uno roto. No se borró —sigue valiendo como red contra una emisión
espuria— pero lleva encima el aviso de lo que no cubre. Tras revertir: `2 passed`, y
`git diff` de producción **vacío**.

## M1 (residual) — el límite ya está en el CÓDIGO, no solo en la bitácora

Lo había corregido en la bitácora y **no en `hooks/useFiltrosUrl.ts`**, que es donde se lee un
límite. El comentario dice ahora que `paresBorrados` **no se vacía nunca en toda la sesión
SPA** —así que cualquier llegada posterior a esa ruta con ese par queda suprimida: un `Link`
interno, un enlace pegado sin recarga completa, cualquier pantalla que reconstruya la query, no
solo el botón atrás— y dice también **lo que sí resiste**: el scopeado por `pathname` y por
valor, y el crecimiento acotado.

## Gate tras la segunda corrección — con el PATH VERIFICADO

**`== init OK ==`** (exit 0).

| Tramo | Resultado |
| --- | --- |
| `typecheck` | **verde, 0 errores** |
| `lint` | **0 errores**, 127 avisos preexistentes de `dev` (0 en los archivos de la ficha) |
| Relacionados | **84 archivos, 1129 passed + 17 skipped (1146)**, 0 rojos |
| Guardias | **168 archivos, 2525 passed, 1 failed (2526)** |
| Baseline | **`✓ sin rojos nuevos (1 archivo rojo sobre 250 ejecutados, todos en el baseline conocido)`** |

El guardia de R25 **ya cuenta entre las guardias** (168 archivos, uno más que antes) y **no
falla ni se salta**. El único rojo sigue siendo `superficie-de-uso.guardia.test.ts` →
`lib/actions/tarifas.ts:67 obtenerTarifa`, ajeno y en el baseline desde el 2026-08-28.
**Delta de rojos de la ficha: 0.**

---

## ⚠️ Hallazgo de ENTORNO, fuera de la ficha: el gate se degrada a avisos

No es de la 339 y **no lo he tocado** —`init.sh` está en la lista de rutas que obligan al gate
completo, y `docs/verification.md` dice por qué: tocar el gate cambia **la medida** con la que
se mide todo lo demás—. Pero lo dejo escrito porque me costó una hora y volverá a morder.

**El síntoma.** El shell del agente recibe el `PATH` **de Windows** (separado por `;`) y bash
lo parte por `:`. Resultado: **no hay `node`, ni `git`, ni siquiera `cat` o `grep`**. Lo
comprobé al arrancar esta tanda:

```
node: command not found · git: command not found · pnpm: command not found
```

**Qué hace `init.sh` en ese entorno.** Lo reproduje a propósito. `fail()` sí hace `exit 1`, así
que **con `node` ausente el gate para en seco y no miente**. El problema es el escalón de al
lado: cuando lo que falta es **otra** herramienta, el gate **degrada a `warn`, que es exit 0**:

```
! no es un repo git: no se puede clasificar el cambio   <- se salta la NEGATIVA del modo rapido
! pnpm no disponible para correr script 'typecheck'     <- typecheck NO se ejecuta
! pnpm no disponible para correr script 'lint'          <- lint NO se ejecuta
```

Es decir: en un entorno a medias, el gate **puede saltarse typecheck, lint y la regla que
obliga al modo completo ante un cambio de cimientos**, y seguir adelante. Eso es exactamente
«un verde que no significa nada» que `docs/verification.md` describe como el peor modo de
fallo. **No conseguí reproducir un `== init OK ==` con exit 0 literal** —mis dos intentos
murieron antes por `rm`/`wc` ausentes o salieron con exit 1—, así que lo reporto por lo que
medí y no por lo que se temía: **la degradación silenciosa está confirmada; el exit 0 final
no**.

**Cómo he trabajado yo:** exportando un `PATH` POSIX correcto en **cada** comando (el estado
del shell no persiste entre llamadas) y comprobando `node -v`, `git --version` y `pnpm -v`
**antes** de dar por bueno cualquier número. Los del gate de arriba están medidos así.

**Sugerencia para quien decida sobre el arnés** (no la aplico yo): que la falta de `pnpm` o de
`git` sea `fail` y no `warn`, por el mismo argumento por el que `--rapido` se niega solo ante
un cambio de cimientos — un gate que se salta sus propios pasos debería gritarlo, no
susurrarlo.
