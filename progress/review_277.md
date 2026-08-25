# review_277 — «Por recoger» separa en pestañas las de hoy de las reservadas para otro día

> Revisión de `feature/277-por-recoger-tabs` (3 commits: `337f6234`, `504c0f72`, `2894f5d4`)
> sobre `dev` @ `94c824f6`. Fecha: **2026-08-24**.
>
> **VEREDICTO: APROBADO CON RESERVAS.** **0 bloqueantes de producto o de verificación.**
> **1 checkpoint incumplido** (`tasks.md` con las 18 casillas en `[ ]`), que se cierra sin volver
> al código y **antes** de pasar la ficha a `done`.
>
> Nada de lo que sigue se apoya en la bitácora del implementer: el gate, la suite y las cinco
> mutaciones las corrí yo, y los números están abajo con su código de salida.

---

## 1 · El gate, corrido por mí, con su exit code DENTRO del log

```
{ ./init.sh --rapido; echo "INIT_EXIT=$?"; } > gate_274.log 2>&1
```

| línea del log | resultado |
| --- | --- |
| `== Arnes SDD :: init (modo: rapido) ==` | — |
| `✓ regla max-2-por-zona respetada (in_progress=1)` | verde |
| `✓ el cambio no toca esquema, tipos compartidos, config ni dinero: el modo rapido basta` | **el rápido NO se negó** |
| `✓ typecheck paso` | verde |
| `✓ lint paso` — `✖ 99 problems (0 errors, 99 warnings)` | verde, 0 errores; los 99 warnings son preexistentes y ninguno cae en los 6 archivos de la ficha |
| `test:cambiados` | **Test Files 390 passed (390)** · **Tests 5771 passed \| 26 skipped (5797)** · 203,77 s |
| `test:guardias` | **Test Files 138 passed (138)** · **Tests 2054 passed (2054)** · 15,69 s |
| `== init OK ==` | — |
| **línea 278 del log** | **`INIT_EXIT=0`** |

**Coincide exactamente con lo que declaró el implementer** (390/5771 y 138/2054). Ningún test cayó
por timeout, así que no hubo que reintentar ninguno aislado.

Y aparte del gate, corridos por mí:

- `tests/components/RecogerModule.test.tsx` + `tests/unit/components/recoger-grupos.test.ts`
  → **82 passed (82)**, 0 skipped. Es la línea base contra la que medí las mutaciones.
- `PosCardParaManana.test.tsx` + `MisAsignacionesPage.test.tsx` + `RepartoModule.test.tsx` +
  `d5-revertida.guardia.test.ts` → **160 passed (160)**. Son los cuatro archivos que la
  trazabilidad cita como «verdes sin tocar»; lo están.
- `grep` de `it.skip` / `describe.skip` / `.only` / `it.todo` en los tres archivos de test tocados
  → **ninguno**. No hay tests apagados escondidos en el diff.

---

## 2 · CHECKPOINTS.md, punto por punto

### Especificación
- [x] `specs/277-por-recoger-tabs/requirements.md` con 34 requisitos EARS numerados `R1`…`R34`.
- [x] `design.md` con alternativas descartadas y su porqué (**once**: A1-A11, más la tabla que
      rebate objeción por objeción la A7 de la 261).
- [ ] **`tasks.md` con todas las tasks marcadas `[x]` → NO.** 18 casillas, **0 marcadas**.
      Ver hallazgo **H1**.

### Trazabilidad
- [x] Cada `R<n>` mapea a al menos un test concreto. Los 34, verificados abriendo el archivo y
      leyendo la aserción (§3).
- [x] `progress/impl_277.md` contiene el mapa `R<n> -> test` (su §9, 34 filas, con el nombre exacto).

### Calidad de código
- [x] `pnpm run typecheck` sin errores (dentro del gate).
- [x] `pnpm run lint` con 0 errores (dentro del gate).
- [x] `pnpm test` — el gate corrió `--rapido`, que es lo que la regla 5 de `CLAUDE.md` exige para
      abrir PR, y **el rápido no se negó** porque el diff no toca cimientos. La corrida completa
      queda, como siempre, para después del merge a `dev`.
- [x] **E2E: inaplicable, y dicho con su motivo.** Este repo no tiene harness Playwright en la
      suite. Además la ficha no toca ninguno de los flujos que el checkpoint enumera (auth, pagos,
      recaudo, ingesta de órdenes, webhooks): es presentación pura, sin backend. El riesgo queda
      cubierto por otra vía: la tarea **T17** (ver la app) está ejecutada y documentada en
      `impl_277.md` §8, con el escenario medido (1 de hoy + 3 de otro día), a 390 px, y con la base
      local restaurada al terminar.

### Datos y seguridad (Supabase)
- [x] **Tabla nueva: ninguna.** No hay RLS que revisar.
- [x] **Migración: ninguna.** No hay `down.sql` que exigir ni `db:rollback` que probar.
- [x] **Secretos: ninguno.** El diff no añade ni una variable ni una credencial.
- [x] **Webhooks: ninguno.** No hay firma ni idempotencia que verificar.

### Patrón de capas
- [x] No hay controller, service ni repository tocados (§6). `recoger-grupos.ts` es una función
      **pura de presentación**, sin JSX, sin DOM y sin negocio, colocada junto a la pantalla que la
      usa — que es lo que `docs/architecture.md` manda para lo que se usa en un solo sitio, y el
      mismo molde de `mis-asignaciones-buscador.ts`.
- [x] Las interfaces siguen donde estaban; `MiAsignacionDTO` se importa, no se modifica.

### Permisos
- [x] El gate de rol server-side (`notFound()` para todo lo que no sea `mensajero`) **no se tocó**:
      `app/(app)/mis-asignaciones/recoger/page.tsx` no está en el diff, y sus cuatro tests de
      `MisAsignacionesPage.test.tsx` los corrí verdes.
- [x] `RecogerModule` sigue recibiendo los datos por props; no fetchea nada.
- [x] No hay mutación nueva: la recogida sigue por la Server Action de siempre.

### Multi-país / configuración
- [x] Nada de país, moneda ni cuenta se hardcodeó. Los literales nuevos son texto de UI en español,
      alojados donde el repo ya aloja el vocabulario del día de reparto.

### Verificación final
- [x] `./init.sh --rapido` en verde, con `INIT_EXIT=0` (§1).
- [x] `progress/review_277.md` — este archivo.
- [ ] Entrada en `progress/history.md` — **pendiente**, y es del leader al cerrar. No es
      responsabilidad del implementer ni bloquea el merge; sí bloquea el `done`.

---

## 3 · Trazabilidad R1–R34: el test existe Y muerde

Verificado **abriendo cada test**, no leyendo la tabla. `RM` = `tests/components/RecogerModule.test.tsx`
(1743 líneas, 69 casos); `RG` = `tests/unit/components/recoger-grupos.test.ts` (13 casos);
`RP` = `tests/components/RepartoModule.test.tsx`.

| R | Dónde | Verificado |
| --- | --- | --- |
| R1 | RM:1113 | `getAllByRole("tablist")` = 1, `tab` = 2, `tabpanel` = 1, y las pestañas son `BUTTON`, no enlaces. OK |
| R2 | RG:59 | ids exactos por grupo + la suma es la entrada entera + el conjunto unión, sin duplicados. OK |
| R3 | RG:81, RG:94, RM:1294 | `undefined` y `false` a «hoy», **emparejados** con una marcada para que un «todo a hoy» no pase igual. OK |
| R4 | RG:124 | lee el FUENTE y afirma que no aparecen `Date`, `Intl` ni `toLocale`, con anti-vacuidad (`toContain("separarPorDia")`). OK |
| R5 | RG:103 | entrada intercalada a propósito; los dos arrays de salida en orden. OK |
| R6 | RM:1256 | `rerender` con el MISMO id y la marca en `false`; los dos conteos cambian y la card aparece **sin ninguna pulsación**. OK |
| R7 | RM:1176, 1197, 1208 | pestaña vacía montada, `not.toBeDisabled()`, sin `aria-disabled`; los dos ceros; y la flecha derecha mueve el foco. OK |
| R8 | RM:1158 | los dos conteos **sin un solo `user.click`** en el test. OK |
| R9 | RM:1239 | una pulsación y la card está; y `buscador()` sigue vacío — llegar no exige buscar. OK |
| R10 | RM:1357, RG:154 | los tres vacíos, y `new Set([...]).size === 3` para que no puedan converger. OK |
| R11 | RM:1385, 1398, RG:174, 183 | el puntero con su número y el nombre de la otra pestaña, en singular y plural. OK |
| R12 | RM:1225 | entra por «hoy» **estando vacía** y con la otra llena; `aria-selected` en los dos sentidos. OK |
| R13 | RM:1436, 1453 | ni la búsqueda ni el refresco que vacía el grupo activo cambian de pestaña. OK |
| R14 | RM:1594 | pestaña + texto + vista, los tres tras el `rerender`. OK |
| R15 | RM:1309 | «1 orden nueva asignada» **dentro del panel activo**, con la mitad negativa. Muere ante su defecto: §5, M2. OK (ver **H2**) |
| R16 | RM:616 | test existente, conservado; solo cambió el literal por Q1. OK |
| R17 | RM:1327, 1339 | sin órdenes de hoy `queryByRole("status")` es null; y desde la otra pestaña también. OK |
| R18 | RM:1483 | un solo `searchbox` y el mismo texto filtrando los DOS grupos. Muere ante su defecto: §5, M4. OK |
| R19 | RM:1508 | el texto sobrevive a ida y vuelta. OK |
| R20 | RM:1525 | los dos conteos de pestaña y el banner, intactos con el filtro puesto. OK |
| R21 | RM:1408 | el «ninguna coincide» **acompañado** del puntero, y la mitad negativa que exige la palabra «coincidencia» y no «orden». OK |
| R22 | RM:1550, 1566 | controles montados en las dos pestañas, y con SÓLO otro día el rechazo llega con motivo real y `recogerMock` sin llamar. OK |
| R23 | RM:874, 902, 931 | los tres de 261/R13, **verdes sin tocar** (no aparecen en el diff). OK |
| R24 | RM:1645 | `alert` presente, `accesoRecogida()` null, los dos conteos y las dos listas alcanzables. OK |
| R25/R26 | RM:1135, RG:199, RG:229 | literales a mano; y ningún texto visible casa «mañana», «reserv», «corte», el nombre de la columna ni una fecha de máquina, con anti-vacuidad sobre la lista. OK |
| R27 | RM:1671 | `aria-selected` en los dos sentidos, el conteo en el texto, y las clases de peso/sombra. OK |
| R28 | RM:1698 | los tres nombres accesibles distintos; `aria-labelledby` del panel = `id` de SU pestaña, **medido sobre el DOM**, en las dos pestañas; y los dos listados con nombre distinto. OK |
| R29 | RG:168 + los dos del puntero | 1/2/7 para el contador; 1 y 2 para órdenes y coincidencias. OK |
| R30 | diff + guardia | el filtro de rutas de backend sobre `git diff --name-only 94c824f6..HEAD` devuelve **cero**. Guardia `d5-revertida` verde y **sin tocar**. OK |
| R31 | `PosCardParaManana.test.tsx` + RM:733, 832 | archivo entero verde y fuera del diff; los dos de la marca y el aviso, verificados en §4.2. OK |
| R32 | RP:2558 | `queryByRole("tablist")` null, `queryAllByRole("tab")` vacío, y las dos órdenes en el MISMO listado de Reparto. OK |
| R33 | `MisAsignacionesPage.test.tsx` | los cuatro casos del bloque de acceso por rol, verdes y fuera del diff. OK |
| R34 | diff | el `git diff` de los tres archivos de producción no añade ni una clase `focus-visible`, `ring-` ni `outline`. Lo que hay lo hereda `components/ui/tabs.tsx`, que no se tocó. OK |

**Ningún requisito queda sin test. Ningún test citado deja de existir.** Y la sección
**PUERTA HUMANA PASADA** está cumplida en las cuatro firmas: Q2 (los dos nombres, verificados
literales en RM:1145/1148 y RG:230/231), Q1 (la concordancia, RG:169-171 y el código en
`contadorNuevasAsignadas`), Q3 (entrada fija por «hoy», RM:1225) y Q4 (los controles siguen
montados, RM:1566).

---

## 4 · Las cuatro cosas que el implementer declaró, auditadas con lupa

### 4.1 · «No eran dos, eran seis» — ninguno quedó más débil

Los tests existentes tocados son **diez** (no seis: seis es el subconjunto que *cayó*; los otros
cuatro son los tres reubicados de §4.2 y el `queryByText` que él mismo dice que habría quedado
verde por vacío). Los revisé uno a uno contra su forma anterior:

| Test | Qué cambió | ¿Más débil? |
| --- | --- | --- |
| `Feature 63: muestra el banner…` | «2 Órdenes nuevas asignadas» → «2 órdenes nuevas asignadas» | No. Mismo `within(listado()).getByText`, literal a mano, mismo fixture. |
| `el banner de contador cuenta el grupo COMPLETO…` | ídem | No. Y es la trazabilidad de **R16**, que sigue mordiendo (muere en la mutación M2, §5). |
| `sin órdenes por recoger, la card de recogida no se muestra` | «No hay órdenes por recoger.» → «No hay órdenes por recoger hoy.» | No. Las dos aserciones que el test existía para hacer (`accesoRecogida()` null y la región null) están intactas. |
| `sin órdenes visibles no se monta el carrusel` | ídem | No. Igual. |
| **`R6: sin coincidencias muestra 'sin resultados', distinto del vacío sin búsqueda`** | el `queryByText("No hay órdenes por recoger.")` **repuntado** al literal nuevo | **No, y lo medí.** Ver §5, M5: con la distinción rota, **este test cae**. Antes del repunte habría pasado por vacío; ahora no. |
| `R23 (246)` reescrito | de «está en la región + el banner dice 1» a las **cuatro** propiedades de `design.md` §10 | **Más fuerte.** Antes bastaba con que la remisión estuviera en el DOM; ahora hay que probar además que el conteo `(1)` se lee **sin interactuar**, que llegar cuesta **una** pulsación, que la card lleva su marca **y su aviso con la fecha**, y que `accesoRecogida()` sigue montado con el grupo de hoy **a cero**. |
| `R9 (261)` reescrito | ídem | **Más fuerte**, por lo mismo. |

Los dos reescritos **conservan la referencia a su ficha de origen** («ESTE TEST VIENE DE LA FEATURE
246 (R23) Y CAMBIÓ DE FORMA CON LA 277 (2026-08-24)», e igual para 261/R9) y explican por qué
cambió de forma, que es lo que `design.md` §10 exigía. Ninguno se borró y ninguno se relajó a un
`queryByText` que pase por vacío.

**Y ninguno se compara contra su propia fuente:** `grep` sobre `RecogerModule.test.tsx` y
`RepartoModule.test.tsx` → **no importan** `dia-reparto-textos` ni `recoger-grupos`. Todos los
literales van escritos a mano. En `RG` sí se importan las constantes, pero para afirmarlas con un
`toBe("…")` **escrito a mano** (RG:155-158, RG:169-171, RG:230-231), que es lo contrario del
problema.

### 4.2 · Los tres casos que cambiaron de sitio, no de contenido

`R31` los daba por «verdes sin tocar» y no lo estaban: la card que miran vive ahora en la otra
pestaña. Se les añadió `await irAOtroDia(user)`.

- **La pulsación ejercita lo que la ficha promete**, no es un rodeo: `irAOtroDia` es
  `user.click(pestanaOtroDia())`, exactamente la interacción única que **R9** promete, sobre el
  `role="tab"` localizado por su nombre visible.
- **Ninguna aserción quedó más débil:**
  - `R22: …dice «Para mañana»…` — la **pareja presencia/ausencia** que era el valor del test sigue
    entera, y sigue siendo anti-vacua: la ausencia se afirma con `within(cardDe("REM-HOY"))`, y
    `cardDe` es `getByRole("article", …)`, que **revienta si la card no está**. Además **gana** una
    aserción (`queryByText(/REM-HOY/)` null tras cambiar de pestaña), que es la que prueba que los
    paneles no se mantienen montados.
  - `R22: …en la vista DETALLE…` — el `queryByRole("region", …)` cambió de «Órdenes por recoger»
    a «Órdenes para otro día»: es **el mismo listado**, con el nombre que le toca en esa pestaña.
    Equivalente, no más flojo.
  - `R11: …dice desde QUÉ DÍA se podrá…` — la aserción del literal con la fecha es **idéntica**,
    palabra por palabra. Solo se le antepuso la pulsación.

### 4.3 · R15 sobrevive a la mutación `=== true` → `!== true`

**Confirmado, y confirmada también la explicación.** Lo reproduje (§5, M1): 35 de 82 rojos, y
`R15` **no** está entre ellos. La causa es aritmética del fixture: con «1 de hoy, 1 reservada»,
invertir la regla deja el grupo de hoy **también con una**, así que el literal no se mueve.

**Pero R15 sí muere ante el defecto que R15 prohíbe**, que es lo que decide si el requisito está
cubierto. Inyecté el defecto exacto —el contador vuelve a contar el grupo entero,
`grupos.hoy.length` → `porRecoger.length`, que es literalmente el bug medido en producción el
2026-08-24— y **`R15` cae** (§5, M2), junto con `R17` y `R20`. Un requisito está cubierto cuando su
propio defecto pone rojo un test, no cuando muere ante cualquier mutación vecina.

Conclusión: **no es bloqueante**. Queda como hallazgo **H2** (`menor`) con la mejora concreta.

### 4.4 · `RepartoModule.test.tsx` gana 35 líneas

**Legítimo, y verificado en las dos direcciones:**

- El cambio es **puramente aditivo**: 35 líneas añadidas, **cero borradas**, un solo `it` nuevo al
  final del `describe` de la 246.
- Es **la no-regresión que `tasks.md` T12 pide** para **R32**, y afirma lo correcto: Reparto **no**
  monta `tablist` ni `tab`, y la orden reservada **sigue en el mismo listado**, sin separar.
- **No se tocó ningún componente de Reparto.** El diff completo de la rama son **7 archivos**:
  `RecogerModule.tsx`, `recoger-grupos.ts` (nuevo), `dia-reparto-textos.ts`, tres archivos de test
  y `progress/impl_277.md`. `RepartoModule.tsx` **no está**.

---

## 5 · Matar y medir: cinco mutaciones, corridas por mí

Línea base de los dos archivos de la ficha: **82 passed (82)**. Cada mutación se revirtió con
`git checkout --` y se comprobó el árbol limpio con `git status --short` antes de la siguiente.

| # | Defecto inyectado (el que el requisito prohíbe) | Resultado | Quién lo caza |
| --- | --- | --- | --- |
| **M1** | **La partición invertida.** `esParaManana === true` → `!== true` en `separarPorDia` | **35 failed / 47 passed (82)** | R2, R3, R5, R6, R7 (los tres), R8, R9, R10, R12, R17, R18, R21, los dos reescritos, y **siete casos anteriores a la ficha** (carrusel, buscador, detalle) — la partición no está aislada del resto de la pantalla. Reproduce **exacto** lo que declaró el implementer. |
| **M2** | **El contador vuelve a contar todo.** `contadorNuevasAsignadas(grupos.hoy.length)` → `(porRecoger.length)`: el bug medido en producción | **3 failed / 79 passed** | **`R15`**, `R17` (el de la otra pestaña) y `R20`. **La partición y el contador, los dos requisitos centrales, tienen rojo propio.** |
| **M3** | **La pestaña vacía se esconde** (el fallo que abrió la 167): el `TabsTrigger` de otro día condicionado a que tenga órdenes | **6 failed / 63 passed (69)** | `R7` (dos), `R8`, `R6`, `R3`, `R10`. **R7 no es decorativo.** |
| **M4** | **El buscador mira solo la pestaña activa** (la alternativa A5): `filtrarAsignaciones(grupos.otroDia, query)` → `grupos.otroDia` | **1 failed / 68 passed** | `R18`. Muerde, aunque con poco margen: ver **H3**. |
| **M5** | **Se pierde la distinción vacío-por-búsqueda vs. vacío-sin-órdenes**: `buscando` forzado a `false` | **3 failed / 66 passed** | **`R6`** (el `queryByText` repuntado), `R10` y `R21`. **Confirma que el repunte de §4.1 no dejó el test verde por vacío.** |

Árbol de trabajo limpio al terminar: `git status --short` vacío, `git diff --stat` vacío.

---

## 6 · Guardia `d5-revertida` y ausencia de backend

- **La guardia no se tocó, ni se relajó.** `git diff 94c824f6..HEAD -- tests/unit/guards/` está
  **vacío**; su último commit sigue siendo `148f851c` (feature 262). Verde en mi corrida.
- **Y sigue vigilando el archivo nuevo.** Su censo recorre `app/(app)/mis-asignaciones` **entero**,
  así que `recoger-grupos.ts` entró solo. Su comentario dice «la reserva protege del corte de la
  noche **y también del mensajero**», que es la formulación que `design.md` §11 prescribía: el
  detector normaliza espacios y busca la subcadena «protege del corte de la noche, no del
  mensajero», que **no** aparece. No hizo falta ampliar ninguna lista de excepciones — y no se
  amplió.
- **Cero backend, medido sobre el diff**, no de palabra: el filtro de rutas
  (`lib/services/`, `lib/actions/`, `lib/repositories/`, `lib/types/`, `lib/interfaces/`, `db/`,
  `app/api/`, `middleware.ts`) sobre `git diff --name-only 94c824f6..HEAD` devuelve **nada**. Sin
  migración, sin esquema, sin contrato nuevo, sin ruta nueva.

---

## 7 · Hallazgos

### H1 · `tasks.md` con las 18 casillas sin marcar — **checkpoint incumplido**

`specs/277-por-recoger-tabs/tasks.md` tiene **0** líneas `- [x]` y **18** líneas `- [ ]`.
`CHECKPOINTS.md > Especificación` lo exige literalmente («todas las tasks estan marcadas `[x]`») y
el propio `tasks.md` lo dice de sí mismo en su cabecera: «sin él la tarea no está hecha, está
escrita».

**Matiz importante, y por eso esto no manda la ficha de vuelta al implementer:** la evidencia de
T0-T17 **existe y la verifiqué yo**, tarea por tarea — T1-T4 en `recoger-grupos.ts` y su test,
T5-T9 en `RecogerModule.tsx`, T10-T12 en los tres archivos de test, T13 reproducido en §5/M1, T14
sobre el diff en §6, T15 con mi propio gate en §1, T16 en `impl_277.md` §9, T17 en `impl_277.md` §8.
Lo que falta es **marcarlo**. Es una edición de casillas, no trabajo.

**Qué falta para cumplirlo:** marcar las 18 casillas `[x]` en `specs/277-por-recoger-tabs/tasks.md`
y commitearlo. **Antes de pasar la ficha a `done`.**

### H2 · `menor` — R15 no muerde ante la mutación de la partición, por simetría del fixture

El caso `R15: el contador dice 1 con 1 de hoy y 1 reservada` usa un fixture **1-1**, y con la regla
invertida el grupo de hoy sigue teniendo exactamente una orden. **No es un agujero de cobertura**:
el defecto que R15 prohíbe (contar también la reservada) **sí** lo mata, medido en M2. Pero el test
no discrimina *cuál* de las dos órdenes cuenta.

**Mejora concreta, barata:** cambiar el fixture a **2 de hoy + 1 reservada** y afirmar
«2 órdenes nuevas asignadas» con la mitad negativa en «3 órdenes…». Con eso M1 también lo mata y el
test pasa a afirmar «cuenta **estas**», no solo «cuenta una». Está bien anotado por el implementer
en `impl_277.md` §5; no se ocultó.

### H3 · `menor` — R21 sobrevive a la mutación del buscador; el margen lo sostiene R18

En M4 (el buscador mira solo la pestaña activa) cae **R18** y **no** cae `R21`, porque con **una
sola** orden en el otro grupo, filtrada y sin filtrar dan el mismo número. El requisito está
cubierto —R18 es su test y muerde—, pero R21 es el que explica *por qué* existe la decisión (el
«ninguna coincide» falso), y sería el que uno querría ver rojo.

**Mejora:** en `R21`, dos órdenes en el grupo de otro día con solo una que case, y afirmar
«Hay 1 coincidencia…» con «Hay 2 coincidencias…» como mitad negativa.

### H4 · `menor` — «una sola interacción» (R9) y el carrusel, dicho para que quede escrito

**R9** exige que toda orden quede alcanzable «con una sola interacción». En vista **mosaico** el
listado va en `CarruselCards`, de 1 a 3 por página según el ancho: una orden en la página 3 exige
pulsar el carrusel además de la pestaña. **No es regresión de esta ficha** —el carrusel es anterior,
y la ficha declara no tocarlo— y el test de R9 afirma correctamente la parte que la 277 decide (la
pestaña, sin buscar). Se deja escrito para que nadie lo lea después como si la 277 lo hubiera
cerrado.

### H5 · `menor` — el banner sigue a la vista con el filtro vaciando la lista

Con 1 orden de hoy y una búsqueda sin coincidencias, la pantalla dice «1 orden nueva asignada»
encima de «Ninguna guía por recoger coincide con la búsqueda». **Es correcto por R16/R20** (los
contadores cuentan lo que el mensajero tiene) y **es el comportamiento anterior**, no algo que esta
ficha estrene. El implementer lo declaró en `impl_277.md` §5 por si chirriaba: chirría un poco, y
cambiarlo sería tocar R16, o sea otra ficha. **No se cambia aquí.**

### H6 · `menor` — `progress/history.md` sin entrada para la 277

Es tarea del leader al cerrar, no del implementer. Bloquea el `done`, no el merge.

---

## 8 · Veredicto

# APROBADO CON RESERVAS

**0 bloqueantes de producto o de verificación.** La ficha hace lo que dice, con el contador en el
sitio correcto, sin backend, sin tocar Reparto, sin relajar la guardia y sin un solo test verde por
vacío de los que auditamos. Los dos requisitos centrales —la partición y el contador— tienen **rojo
propio** ante el defecto exacto que prohíben, medido, no razonado. El gate lo corrí yo y da
`INIT_EXIT=0` con los mismos números que la bitácora.

**Reservas, en orden de obligación:**

1. **H1 — bloqueante de cierre:** marcar las 18 casillas de `tasks.md`. Es el único checkpoint que
   hoy falla. No requiere volver al código.
2. **H6:** entrada en `progress/history.md` al cerrar (leader).
3. **H2 y H3:** dos fixtures que se pueden endurecer. Recomendados, **no** exigidos: los requisitos
   están cubiertos ante su propio defecto.
4. **H4 y H5:** dejados por escrito a propósito, para que no se lean después como cerrados por esta
   ficha.

Con H1 cerrado, esto es **APROBADO** sin más.

---

### Anexo · Cómo se midió

```
./init.sh --rapido                                        -> INIT_EXIT=0 (linea 278 del log)

pnpm exec vitest run tests/components/RecogerModule.test.tsx \
                     tests/unit/components/recoger-grupos.test.ts   -> 82/82

pnpm exec vitest run tests/components/PosCardParaManana.test.tsx \
                     tests/components/MisAsignacionesPage.test.tsx \
                     tests/components/RepartoModule.test.tsx \
                     tests/unit/guards/d5-revertida.guardia.test.ts -> 160/160

M1..M5: mutacion -> vitest -> git checkout -- <archivo> -> git status --short vacio
```
