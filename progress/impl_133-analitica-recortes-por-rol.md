# 133 — analítica: recortes por rol · bitácora de implementación

> Rama `feature/133-analitica-recortes-por-rol`, nacida de `origin/dev` @ `35940b0d`.
> Base de la fase 2: `7b850f2e` (spec + puerta cerrada). Worktree `C:/w133`.
> **Todo lo que sigue está MEDIDO en esta rama.** Donde no lo medí, lo digo.

## 0. La regla que esta feature no puede violar

**«Un panel que no se pinta NO es un dato que no se filtra.»** Esto es recorte de
**PRESENTACIÓN**. El recorte de **DATOS** es de la 122, vive en el servidor y **no se ha
tocado**. R21 lo prueba, no lo declara: `AnaliticaNoSustitucion.test.tsx` compara los
argumentos que llegan al borde **con y sin** recorte de presentación y exige que sean
idénticos.

---

## 1. Archivos tocados

### Producción (6)

| Archivo | Qué cambió |
|---|---|
| `lib/analytics/presentacion.ts` | **NUEVO.** Módulo puro de servidor: `Faceta`, `RecortePresentacion`, `recorteDePresentacion(actor)`. Deriva el alcance de `resolverAlcance` (fuente única de la 122). |
| `lib/auth/menu-visibility.ts` | `ROLES_ACCESO_ANALITICA` pasa a **derivarse** de `ROLES_ANALITICA`. Campo nuevo `destinoInicial?: false` en `MenuItem`; `primerDestino` salta los no elegibles. |
| `app/(app)/analitica/page.tsx` | Cablea `recorteDePresentacion(actor)` y pasa `facetas` / `alcance` en **las dos** ramas. La bifurcación de `esAccesoTotal` **no se tocó**. Comentario de las líneas 60-63 corregido (afirmaba que la constante era `readonly ["maestro","admin"]`). |
| `app/(app)/analitica/_components/operativo/FiltrosOperativos.tsx` | Prop `facetas?` (def. las tres). Una faceta ausente **no se dibuja**; su catálogo **no se pide**; su degradado **no se anuncia**. |
| `app/(app)/analitica/_components/operativo/PanelesOperativos.tsx` | Prop `alcance?` (def. `global`) y rótulo único. **Sin `filter` sobre `PANELES_OPERATIVOS`.** |
| `app/(app)/analitica/_components/operativo/textos.ts` | `TEXTO_ALCANCE` por **tipo de alcance** (no por rol), `textoAlcance()`, `ETIQUETA_ALCANCE`. |

**NO se tocó** `lib/analytics/metrics.ts`, ni `AnaliticaShell.tsx`, ni `_components/financiero/**`,
ni ninguna migración, tabla o RLS.

### Tests (12)

`tests/unit/analytics/presentacion.test.ts` (NUEVO) · `tests/unit/auth/destino-post-login.test.ts`
(NUEVO) · `tests/components/AnaliticaNoSustitucion.test.tsx` (NUEVO) ·
`tests/unit/analytics/presentacion-oraculo-frontera.test.ts` (NUEVO) ·
`tests/unit/analytics/presentacion-etiquetas-mensajero.test.ts` (NUEVO) ·
`e2e/analitica-roles.spec.ts` (NUEVO) · `tests/components/AnaliticaPage.test.tsx` ·
`tests/components/FiltrosOperativos.test.tsx` · `tests/components/TableroOperativo.test.tsx` ·
`tests/unit/analytics/tablero-operativo-frontera.guardia.test.ts` ·
`tests/unit/auth/menu-visibility.test.ts` ·
`tests/unit/guards/roles-analitica-acceso-vs-dominio.test.ts`

**Intacto a propósito:** `tests/unit/analytics/tablero-catalogo-paneles.test.ts` (`git diff` vacío).
La **175** lo reexpresó el 2026-08-03 para **no afirmar valores concretos de `estadoProduccion`**;
esta feature **no se los devuelve**. El censo de R12/R13 vive en un bloque aparte de
`TableroOperativo.test.tsx`.

`3463 insertions(+), 165 deletions(-)` en 18 archivos.

---

## 2. Mapa `R<n>` → test nombrado → mutación que lo pone rojo

Las mutaciones marcadas **[MEDIDA]** se aplicaron de verdad, se vio el rojo y se revirtieron;
la salida real está en §4. Lo que no se midió va marcado como tal.

| R | Test nombrado | Mutación que lo pone rojo |
|---|---|---|
| R1 | `AnaliticaPage.test.tsx:234` «Feature 129 (R3) / 133 (R1) — quién NO entra sigue sin entrar» + `menu-visibility.test.ts:353` «R8 (+133 R1)» | conceder a `apiKey` o a la sesión ausente; o retirar a uno de los cinco lectores |
| R2 | `menu-visibility.test.ts:453` «R10: el `roles` del ítem es el mismo CONJUNTO que `ROLES_ACCESO_ANALITICA`» | desenganchar el `roles` del ítem a un literal propio |
| R3 | `roles-analitica-acceso-vs-dominio.test.ts:133` — **(b1)** identidad referencial + **(b2)** censo del fuente | **[MEDIDA]** reescribir `ROLES_ACCESO_ANALITICA` como lista literal a mano |
| R4 | `menu-visibility.test.ts:397` «R4: un `RolValue` desconocido no ve el ítem ni pasaría el gate (whitelist, no deny-list)» | convertir el conjunto en deny-list |
| R5 | `destino-post-login.test.ts` (los 5 roles **por valor**, escritos a mano) | **[MEDIDA]** quitar `destinoInicial: false` del ítem ⇒ 5 casos rojos |
| R6 | `AnaliticaPage.test.tsx:396` y `:476`, con la página **renderizada** | **[MEDIDA]** pasar la prop `financiero` a un rol acotado ⇒ 13 rojos |
| R7 | `AnaliticaPage.test.tsx:476` — censo sobre `document.body.textContent` **entero** | **[MEDIDA]** la misma que R6. La caza la aserción del **cuerpo**, no el `queryByRole` |
| R8 | `AnaliticaPage.test.tsx:634` «Feature 132 (R9) — el dinero se pre-carga en el servidor y solo si toca» | invocar el cargador financiero antes del gate de `esAccesoTotal` |
| R9 | `AnaliticaPage.test.tsx:759` «Feature 133 (R9) — ver la región financiera equivale a tener financieras en el catálogo» (5 roles) | **[MEDIDA]** abrir una financiera a `adminTienda` en `metrics.ts` ⇒ rojo **aquí y en `financiera-alcance.guardia`, a la vez** |
| R10 | `AnaliticaPage.test.tsx:816` «ningún control de navegación anuncia la región financiera» | añadir un enlace o botón cuyo nombre accesible la nombre |
| R11 | `TableroOperativo.test.tsx:428` «Feature 133 (R11) — ningún panel operativo se retira por rol» | **[MEDIDA]** un `filter` que quita un panel para un rol ⇒ 2 rojos |
| R12 | `TableroOperativo.test.tsx:597` «Feature 133 (R12/R13) — la ruta no decide paneles leyendo el catálogo de servidor» (+ `tablero-catalogo-paneles.test.ts` intacto) | filtrar la rejilla por `estadoProduccion` |
| R13 | ídem `:597` — censo de que ningún módulo de la ruta importa `lib/analytics/metrics` | derivar la rejilla de `listarMetricas()` |
| R14 | `FiltrosOperativos.test.tsx:296` «Feature 133 (R14/R16/R17) — la barra dibuja exactamente las facetas ofrecidas», más `:323`, `:328`, `:333` | **[MEDIDA]** que `recorteDePresentacion` devuelva siempre las tres facetas |
| R15 | `FiltrosOperativos.test.tsx:382` «Feature 133 (R15) — a un adminTienda no se le publica el directorio de mensajeros» + `presentacion.test.ts` «adminTienda no recibe la faceta mensajero» | ofrecer la faceta `mensajero` a `adminTienda` ⇒ nombres reales y uuids de la fixture aparecen en el documento |
| R16 | `FiltrosOperativos.test.tsx:342` «Feature 133 (R16) — un selector ausente no reaparece apagado ni como nota» | dibujar el selector `disabled`, o encender la nota de degradado sobre un control inexistente |
| R17 | `FiltrosOperativos.test.tsx:317` «SIEMPRE ve el selector de Rango (R17)» (los 5 roles) | tratar el rango como una faceta más |
| R18 | `presentacion.test.ts` — 25 casos: los 5 roles **por valor**, `null`, `apiKey`, `adminSatelite` sin zona, y el tipo idéntico para las 15 operativas | **[MEDIDA]** devolver siempre las tres facetas ⇒ 7 rojos |
| R19 | `AnaliticaNoSustitucion.test.tsx` «Feature 133 (R19) — un parámetro de faceta oculta no se silencia ni rompe la pantalla» | **[MEDIDA]** vaciar `mensajeroIds` en `desdeSearchParams` ⇒ el `raw` deja de llevarlo |
| R20 | `tablero-operativo-frontera.guardia.test.ts:378` «Feature 133 (R20, R29) — `lib/analytics/presentacion` es arista NOMINAL, única y justificada» | **[MEDIDA]** una arista sintética no autorizada desde la ruta; y `resolverAlcance` importado desde la ruta (doble candado con R10 vigente) |
| R21 | `AnaliticaNoSustitucion.test.tsx` «los argumentos enviados a `consultarAnaliticaOperativa` son IDÉNTICOS con y sin recorte» | **[MEDIDA]** recortar el filtro en el cliente según el alcance |
| R22 | `TableroOperativo.test.tsx:533` «Feature 133 (R22) — un denegado no se pinta como sin datos para ningún rol acotado» | **[MEDIDA]** retirar la rama `forbidden` de `PanelOperativo` ⇒ 6 rojos |
| R23 | `AnaliticaPage.test.tsx:907` «Feature 133 (T6.5, R23) — para un alcance acotado no aparece nada ajeno en el documento» | **[MEDIDA]** que el recorte devuelva las tres facetas ⇒ nombres de zona y de tienda ajenos en el cuerpo |
| R24 | `TableroOperativo.test.tsx:460` «Feature 133 (R24) — un rótulo de alcance, uno solo, y sólo si hace falta» | pintar el rótulo con alcance `global`, o pintarlo una vez por panel |
| R25 | `TableroOperativo.test.tsx:491` «Feature 133 (R25) — el rótulo es una frase sobre el alcance, no un dato» | meter el uuid o el nombre de la tienda o la zona en el texto |
| R26 | `presentacion-etiquetas-mensajero.test.ts` (11 casos) | **[MEDIDA]** declarar un texto «Guardar este filtro»; y añadir `desagregacion: "mensajero"` a un panel sin advertencia |
| R27 | `presentacion-oraculo-frontera.test.ts` (10 casos) | **[MEDIDA]** que el borde deje de decidir (`return false` en el sondeo); y que el borde consulte `recorteDePresentacion` |
| R28 | `e2e/analitica-roles.spec.ts` — 8 casos: los 3 roles acotados, el control positivo `maestro` y 4 de facetas | pasar la prop `financiero` a un rol acotado (la matan tres aserciones independientes). **NO EJECUTADO — ver §5.** |
| R29 | **esta bitácora, §3** | — |

**Cobertura: 29/29.** Ninguno queda sin test nombrado.

---

## 3. Los rojos por diseño — NINGUNO se relajó ni se borró (R29)

El design §5 preveía **9 bloques**. Fueron **10**: apareció uno que su tabla no enumeraba
(fila 5). Todos por el mismo motivo: un rol se mueve de una lista a la otra.

| # | Bloque | Archivo : línea original | Por qué se puso rojo | Cómo se reexpresó |
|---|---|---|---|---|
| 1 | caso **(b)** «los dos conjuntos NO son iguales» | `tests/unit/guards/roles-analitica-acceso-vs-dominio.test.ts:54-63` | D1 iguala los dos conjuntos | Partido en **(b1)** identidad referencial y **(b2)** censo del fuente. Pasa de «no son iguales» a «el acceso DERIVA del dominio». Mata la mutación «reescribir la lista a mano» [MEDIDA]. Los casos **(a)** y «no vacío» quedan **intactos**. La salida la manda el propio guard en sus líneas 34-38. |
| 2 | R9 «el resto de roles NO ve el ítem» | `tests/unit/auth/menu-visibility.test.ts:341-359` | los 3 roles pasan a verlo | **Repartido, no relajado**: `apiKey` y el actor nulo siguen excluidos (`:376`); los cinco lectores pasan a un caso propio (`:353`). |
| 3 | listas por IGUALDAD de `adminTienda` / `mensajero` / `adminSatelite` | `menu-visibility.test.ts:161-168, 170-192, 194-200` | falta «Analítica» en su posición | «Analítica» añadida en su posición. **Siguen comparándose con `toEqual`**, no se degradaron a `toContain`: un ítem no declarado sigue rompiendo. |
| 4 | 129-R3 «el resto recibe notFound» | `tests/components/AnaliticaPage.test.tsx:160-171` | los 3 entran | **Partido** (`:234`): `apiKey` sigue con `notFound`; los 3 afirman que el shell **se pinta**. Se gana la mutación simétrica («el gate concede a quien no está en el conjunto»), que antes nadie medía. |
| 5 | **129-R5 «el rol sale SOLO del mock de sesión»** | `AnaliticaPage.test.tsx:186` | usaba `mensajero` como ejemplo de rol denegado | **DESVIACIÓN: este bloque NO figura en la tabla §5 del design ni en T3.2.** Reexpresado con `apiKey`; su mutación queda intacta («el rol se lee de los argumentos en vez de la sesión»). |
| 6 | 129-R6 «el gate corre ANTES de renderizar» | `AnaliticaPage.test.tsx:201-209` | usaba `adminTienda` | `it.each` sobre los roles sin entrada (`:309`). Mutación intacta. |
| 7 | 132-R1/R8 «los otros cuatro siguen con notFound» | `AnaliticaPage.test.tsx:273-300` | los 3 entran | **Partido** (`:396`): `apiKey` → `notFound`; los 3 → entran **y no ven nada financiero**. El contrapeso de los seis `RolValue` se **refuerza**: las tres listas deben ser una **partición**. |
| 8 | **132-R2 «ni rastro de la región financiera» — el más importante** | `AnaliticaPage.test.tsx:302-331` | **pasaba porque la página LANZABA** | **Queda MÁS FUERTE** (`:476`): corre con la página **renderizada**, con tres anti-vacíos, control positivo con `maestro`, censo sobre `document.body.textContent` **entero** y dos aserciones **nuevas** (la palabra en femenino y los símbolos de moneda). Hallazgo: el dinero se pinta **formateado** (₡918 273,45), así que la aserción heredada sobre el entero crudo `918273` **no lo habría cazado**. |
| 9 | 132-R5 «ROLES_ACCESO_ANALITICA sigue siendo maestro y admin» + «acceso ⊊ dominio» | `AnaliticaPage.test.tsx:362-387` | su propio título decía «la 133 es quien lo ensancha» | Afirma la **derivación** de D1 por identidad referencial (`:600`). El «acceso ⊆ dominio» se **conserva intacto**; el `toBeLessThan` pasa a `toBe` más `not.toContain("apiKey")`. Remite al guard dedicado en vez de duplicarlo. |
| 10 | 132-R9 «para los denegados el dinero no se consulta» | `AnaliticaPage.test.tsx:389-421` | cae el `rejects.toThrow(NotFoundError)` | **Rojo en la forma, verde en el fondo** (`:634`): la aserción que importa —el cargador **no** se invoca— sigue pasando, ahora por el gate de `esAccesoTotal`, mecanismo que **hasta hoy no estaba probado** para esos tres roles. |
| 11 | 131-R26 «el gate sigue siendo maestro/admin» | `AnaliticaPage.test.tsx:440-445` | el gate son los cinco | Afirmado en las dos direcciones (`:694`). `AnaliticaPage.length === 0` **sin tocar un carácter**. |

### Guards que se AMPLIARON (no se relajaron)

**`tablero-operativo-frontera.guardia.test.ts`**: +432 líneas, **0 modificadas o borradas**.
Hecho medido: `page.tsx` ya importaba `lib/analytics/presentacion` y el guardia daba 9/9
verde, porque su patrón es `@/lib/analytics/alcance` y `presentacion` no casa. **La arista
pasaba por SILENCIO**, que es el «rodeo tácito» que D5 advierte. Ahora pasa por permiso
escrito: allowlist **nominal** (módulo × nombres) más una aserción de que el **retorno no
lleva datos**. El censo nuevo es **más estricto** que lo vigente: cubre la ruta entera, no
sólo el subárbol operativo.

### Guards que quedan VERDES y debían quedarlo

`tablero-catalogo-paneles.test.ts` (**intacto**, `git diff` vacío) · `financiera-alcance.guardia.test.ts` ·
`tablero-financiero.guardia.test.ts` · `modulo-puro.guardia.test.ts` (**sin tocarlo**, con el
archivo nuevo dentro de su censo) · `menu-visibility.test.ts` R10 y R16 (**sin tocarlos**) ·
`Sidebar.test.tsx`, `HomePageMaestro.test.tsx`, `AppLayout.test.tsx`.

**Relajaciones: CERO.**

---

## 4. Gates — salida real, medida en esta rama

```
pnpm typecheck        ->  tsc --noEmit, sin salida.  0 errores.
pnpm lint             ->  44 problems (0 errors, 44 warnings)
pnpm exec next build  ->  Compiled successfully in 29.1s
                          Generating static pages (41/41)
                          f /analitica
pnpm exec vitest run  ->  Test Files  1 failed | 886 passed | 8 skipped (895)
                               Tests  3 failed | 11042 passed | 130 skipped (11175)
```

**Los 44 warnings son el baseline**, medido por mí en esta rama **antes** de tocar nada
(`_args` sin usar en tests ajenos). Los subagentes añadieron **0**.

**Nunca se corrió `pnpm build`**: encadena `migrate deploy` contra una base real. Se usó
`pnpm exec next build`, que compila y genera las 41 páginas, `/analitica` incluida.

### Los 3 rojos de la suite completa: la trampa de entorno, no una regresión

Los tres están en `tests/integration/db/analytics-daily-migration.test.ts` y fallan porque
`prisma migrate diff` no resuelve `DATABASE_URL`. El worktree **no tiene `.env` y no se le
creó**; el cliente Prisma se generó con un `DATABASE_URL` **inline y falso**, sin escribirlo
en disco.

**Medido: pasarle ese `DATABASE_URL` falso a la suite lo EMPEORA.** Des-saltea unos 20 tests
de integración que entonces fallan al no encontrar Postgres (`busqueda-*`,
`analitica-operativa-equivalencia`, `analitica-operativa-indices`, `analytics-daily-backfill`,
`analytics-daily-job`). La medición honesta es la corrida **sin** `DATABASE_URL`.

**Sobre la variabilidad, medida y no supuesta:** se corrió la suite **dos veces sin
`DATABASE_URL`**. La primera dio **4 fallos en 2 archivos**; la segunda, **3 fallos en 1
archivo**. El cuarto fallo **no reprodujo** y es el flake por saturación conocido del repo.
El total de archivos fue **895 en las dos corridas** y no hubo bloque `Errors` de workers, así
que la suite arrancó entera y no reporta de menos.

Ni uno solo de los 18 archivos que toca esta feature está bajo `tests/integration/db/`.

### Corridas dirigidas, todas verdes

```
AnaliticaPage + AnaliticaShell + TableroFinanciero + PanelConciliacion -> 4 files / 91 tests
FiltrosOperativos + TableroOperativo + Latencia + NoSustitucion       -> 4 files / 77 tests
tests/unit/analytics/ (completo)                                      -> 89 files / 1011 tests
tests/unit/guards/ (completo)                                         -> 15 files / 135 tests
tests/unit/auth/ + roles-analitica-acceso-vs-dominio                  -> 8 files / 114 tests
tablero-operativo-frontera + modulo-puro + operativa-frontera         -> 3 files / 55 tests
```

`AnaliticaPage.test.tsx` pasó de **17 rojos / 20 verdes** a **52 verdes / 0 rojos**.

---

## 5. Lo que NO se hizo, y lo que NO se puede afirmar

### El oráculo residual (M-4 de `review_122.md`) NO se cierra aquí

Es un problema de **DATOS**, no de presentación; vive en el borde y es la **ficha 182**
(backend). Lo que esta feature aporta es **R15** (no ofrecer el selector) y **R27** (prohibir
presentarlo como cierre). **Ocultar el control quita la comodidad, no el canal:** el filtro
viaja por la URL y por el argumento de la Server Action.
`presentacion-oraculo-frontera.test.ts` lo demuestra por el camino real de la URL, y su
cabecera prohíbe leerlo como cierre.

**PREGUNTA ABIERTA que dejo al reviewer, sin resolver por mí.** Un subagente encontró que en
esta rama `lib/actions/analitica-operativa.ts:117-128` **ya invoca**
`sondeaIdentidadDeMensajero` (`lib/analytics/oraculo-mensajero.ts`, feature **126**, T9.6/D12)
y responde `forbidden` bajo política seudónima. Es decir: **M-4 podría estar mitigado por la
126 en este consumidor**, mientras `requirements.md §4` lo declara ABIERTO. **No lo he
verificado ni lo he tocado, y no afirmo que M-4 esté cerrado.** Alguien debe decidir si §4 se
actualiza o si la 182 se re-encuadra.

### R26: media cobertura vacía, declarada

El censo (no existe control de guardar, fijar ni compartir un filtro por etiqueta
`Mensajero N`) es real. La parte de la **advertencia de no-estabilidad** queda **vacía por
ausencia de superficie**: esas etiquetas sólo se generan con `desagregacion: "mensajero"` y
**ningún panel pide ese grano** (la única desagregación de `catalogo-paneles.ts` es
`estatus`). **No se inventó producción para tener algo que probar.** Queda un tripwire que se
pone rojo el día que alguien añada ese grano sin advertencia.

### R28: el E2E está escrito y NO ejecutado

El worktree no tiene base ni usuarios sembrados. Verificado sólo que el runner lo **parsea y
lo enumera** (8 casos), más typecheck y lint. **En ningún sitio se afirma que el E2E pase.**
Queda diferido igual que los otros 17 specs de `e2e/`.

### Otras cosas no medidas

- **R25 · la deriva del tipo de alcance en `textos.ts`**: declara la unión localmente en vez
  de importarla de `presentacion`. La deriva la ataja el typecheck. **Razonado, no medido con
  una mutación.**
- **T6.5 · la mitad de los uuids no tiene control positivo**: `MultiSelectFilter` nunca
  escribe el `value` de una opción en el DOM, así que no hay configuración de esta pantalla en
  la que un uuid de catálogo llegue al documento. La aserción que **sí** muerde es la de los
  **nombres**, y ésa tiene control positivo (`maestro` los ve).
- **T6.5 · `adminTienda` conserva la faceta «Zona»**, así que un nombre de zona en su pantalla
  es un control legítimo y está excluido del censo. Se cubren sus dos dimensiones no dibujadas.
- **`./init.sh`** no se corrió: es del leader (T8.2, T8.3).

---

## 6. Desviaciones respecto al `design.md`, con su motivo

1. **10 bloques rojos por diseño, no 9.** El 129-R5 de `AnaliticaPage.test.tsx` no figura en
   la tabla §5. Reexpresado igual, enumerado en §3 fila 5.
2. **`presentacion.ts` no escribe `dominio: "operativa"` en línea.**
   `modulo-puro.guardia.test.ts:342` reconoce una *declaración de métrica* por ese par y salía
   rojo. Como **ningún guardia se relaja** (R29), se evitó el patrón con una constante
   intermedia. El guardia quedó **sin tocar** y verde.
3. **La autorización de catálogo (Q4) se expresa por FACETA, no por rol.** El design pedía
   derivar del alcance y prohibía una tabla `rol -> facetas`. El trío que autorizan
   `FiltrosOrdenesService.ts:28` y `UsuariosPorRolService.ts:15` (**es el mismo trío en los
   dos**, verificado) equivale a `{global, tienda}` sobre el alcance de la 122, así que el
   módulo no nombra ni un rol. Resultado: `maestro` y `admin` -> las tres facetas;
   `adminTienda` -> `["zona"]`; `adminSatelite` y `mensajero` -> `[]`, es decir sólo Rango.
4. **El alcance `denegado` sí lleva rótulo.** El design no lo cubría. Motivo escrito en
   `textos.ts`: un `adminSatelite` sin zona entra a la página pero el borde le responde
   `forbidden` en los seis paneles; callar dejaría seis errores sin causa, y mapearlo a
   `global` prometería un universo que no se está viendo. El texto no promete cifras.
5. **No se pide el catálogo cuyo selector no se dibuja** (`useSWR` con clave `null`). Sería un
   `forbidden` auditado que nadie mira, y encendería la nota de degradado sobre un control
   inexistente: R16 en forma de texto.
6. **T6.3 (R19) vive en `AnaliticaNoSustitucion.test.tsx`**, no en `FiltrosOperativos.test.tsx`
   como sugería §7: comparte el montaje de los dos slots con la URL cargada. Es un movimiento
   mecánico si el reviewer prefiere lo otro.
7. **El bloque 132-R2 ganó aserciones** (la palabra en femenino y los símbolos de moneda) y se
   **reordenó** el censo del cuerpo por delante del `queryByRole`, para que una mutación no
   aborte el caso antes de ejecutar las aserciones de texto. Es endurecimiento.
8. **El mock de `useSearchParams` en `AnaliticaPage.test.tsx` pasa a ser mutable.** Ningún caso
   preexistente cambia de comportamiento: todos siguen viendo la URL vacía.
9. **El censo de aristas del guardia de frontera es más amplio que R25**: cubre la ruta
   entera, no sólo el subárbol operativo. Endurecimiento.

---

## 7. Estado de las tasks

`tasks.md`: **32 marcadas**. Pendientes las tres del **leader**: T8.2 (`./init.sh --rapido`),
T8.3 (`./init.sh` completo, medido en esta rama) y T8.4 (PR hacia `dev`).

**El implementer no se autoaprueba.** El reviewer decide.

---

## 8. Integración con `dev` tras la aprobación (2026-08-04)

El reviewer aprobó la feature (0 bloqueantes, 29/29 R). Al sincronizar con `dev`, que había
avanzado **73 commits**, el merge (`0967439b`) dejó **2 errores de typecheck** en un archivo
de esta feature:

```
tests/unit/analytics/presentacion-oraculo-frontera.test.ts(40,7):  error TS2741
tests/unit/analytics/presentacion-oraculo-frontera.test.ts(111,11): error TS2741
Property 'consultarAgregado' is missing in type '{ consultar(): Promise<never>; }'
but required in type 'IAnaliticaOperativaService'.
```

**Causa: trabajo ajeno que llegó después.** La feature **176** («modo agregado de tasas y
tiempos») se mergeó a `dev` mientras se implementaba esta y añadió `consultarAgregado` a
`IAnaliticaOperativaService` (`lib/interfaces/services/IAnaliticaOperativaService.ts:72`).
Los dos dobles de este archivo sólo implementaban `consultar`. **No es un defecto de la 133
ni un fallo del review**: el archivo era correcto contra la interfaz vigente cuando se
escribió.

**Arreglo: se sigue el patrón que la propia 176 dejó** en `tests/unit/analytics/operativa-oraculo.test.ts`
(líneas 31-35 y 82-85), que resolvió el mismo caso en el archivo hermano. No hay helper de
dobles compartido: los dos son literales inline, así que se replica la forma, no se inventa
otra.

- **`SERVICIO_MUDO`** gana `consultarAgregado` que **lanza con el mismo mensaje** que
  `consultar` («el servicio NO debe ejecutarse: la decision es del borde»). El modo agregado
  recorre el **mismo** oráculo, así que llegar por esa puerta significa exactamente lo mismo:
  que el borde no decidió.
- **El doble del caso «la decisión depende del ACTOR»** gana `consultarAgregado` que lanza
  «este doble no sirve el modo agregado». Ese caso mide el camino de `consultar`.

**Los dos fallan ruidosamente a propósito.** Un método ausente devolvería `undefined` en
silencio y convertiría un fallo futuro en un pase — que es justo lo que este archivo existe
para impedir.

**No se relajó nada**: sin `as any`, sin `as unknown as`, y **sin tocar la interfaz**, que es
de la 176.

### Verificación del arreglo, medida

```
pnpm typecheck                                                  ->  0 errores (eran 2)
pnpm lint                                                       ->  0 errores, 44 warnings (= baseline)
pnpm exec vitest related --run presentacion-oraculo-frontera    ->  1 file / 10 tests, verde
presentacion-oraculo-frontera + operativa-oraculo (el de la 176) ->  2 files / 19 tests, verde
```

**El test sigue mordiendo.** Se reaplicó la mutación ya documentada para este archivo
—`sondeaIdentidadDeMensajero` pasa a `return false`, es decir el borde deja de decidir— y dio
**los mismos 2 rojos que antes del merge**:

```
× con el selector oculto, el `mensajero_id` inyectado por la URL sigue siendo cosa del borde
× y la respuesta es la MISMA por las dos vias: URL o argumento de la Server Action
Error: el servicio NO debe ejecutarse: la decision es del borde
 Tests  2 failed | 8 passed (10)
```

Revertida; `git diff` sobre producción queda **vacío**. El doble completado no dejó un test
verde que ya no prueba nada.

**Nota de entorno, para el siguiente que pase por aquí:** este worktree **no tiene `.env`** y
no se le creó ninguno. Sin él, `pnpm db:generate` falla y el cliente Prisma rancio produce
errores de typecheck **falsos** (los enums nuevos de tesorería que trajo `dev`, p. ej.
`WalletMovimientoCategoria`). Se regenera pasando `DATABASE_URL` **inline**, sin escribirla en
disco. Si aparecen esos errores, es el entorno, no el código.
