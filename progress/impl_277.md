# impl_277 — «Por recoger» separa en pestañas las de hoy de las reservadas para otro día

> Rama `feature/277-por-recoger-tabs`, sobre `dev` (94c824f6). Zona `frontend`. Implementación
> completa de las 17 tareas de `specs/277-por-recoger-tabs/tasks.md`.
> **Gate:** `./init.sh --rapido` → **verde, `INIT_EXIT=0`** (detalle en §7).

---

## 1 · T0 · La puerta humana, y qué quedó firmado (2026-08-24)

Las cuatro preguntas de `requirements.md` estaban respondidas antes de tocar código, y así se
implementaron. Se anotan aquí porque `tasks.md` T0 lo exige, no porque se hayan re-abierto:

| Pregunta | Respuesta firmada (2026-08-24) | Dónde aterrizó |
| --- | --- | --- |
| **Q2** · nombres de las pestañas | **«Para recoger hoy»** y **«Para otro día»**, tal cual `design.md` §4 | `lib/utils/dia-reparto-textos.ts` |
| **Q1** · el literal del contador | **SÍ se corrige la concordancia**: «1 orden nueva asignada» / «2 órdenes nuevas asignadas». R29 deja de estar acotado a los textos nuevos | `contadorNuevasAsignadas()` |
| **Q3** · pestaña de entrada | **Siempre «Para recoger hoy»**, aunque esté vacía | `useState<Grupo>("hoy")` |
| **Q4** · controles de recogida con el grupo de hoy vacío | **NO-CAMBIO** (R22): siguen montados | condición intacta: `bloqueado \|\| porRecoger.length === 0` |

---

## 2 · Qué se hizo, por bloques

**Bloque 1 — la pieza pura (T1-T4).**
`app/(app)/mis-asignaciones/_components/recoger-grupos.ts` (nuevo). `separarPorDia()` con la regla
única `esParaManana === true` → `otroDia`; todo lo demás —incluido el `undefined` del DTO anterior a
la feature— a `hoy`, y con el orden de entrada preservado. El módulo **no importa la fecha del
navegador ni la internacionalización**, y eso se comprueba **sobre el fuente**, no de palabra. Con
él viajan los textos que la partición obliga a decir: los dos vacíos por grupo, el del buscador
(literal de la 114, reutilizado), el contador con su concordancia y el puntero a la otra pestaña,
que distingue «órdenes» (sin búsqueda) de «coincidencias» (con ella).
Los **nombres de las pestañas** van aparte, en `lib/utils/dia-reparto-textos.ts` (aditivo, sin
imports nuevos), que es el vocabulario visible del día de reparto.

**Bloque 2 — la composición (T5-T9).** `RecogerModule.tsx` monta `Tabs/TabsList/TabsTrigger/
TabsContent` **sin `keepMounted`**. Arriba de las pestañas se quedan los controles de recogida (que
resuelven contra el grupo COMPLETO) y el buscador con el conmutador de vista, uno solo para los dos
grupos. El contador **baja al panel que cuenta** y cuenta sólo el grupo de hoy.

**Bloque 3 — tests (T10-T13).** 28 casos nuevos en `RecogerModule.test.tsx`, 13 en
`recoger-grupos.test.ts`, 1 de no-regresión en `RepartoModule.test.tsx`, y los **dos tests que
cambian de forma**, reescritos (§4).

---

## 3 · Lo que el spec NO preveía, y que me encontré

1. **No eran dos los tests existentes que cambiaban: eran seis.** `design.md` §10 nombra dos (246/R23
   y 261/R9, los que afirmaban `1 Órdenes nuevas asignadas`). Al correr la suite cayeron **cuatro
   más**, y ninguno es trivial:
   - `«Feature 63: muestra el banner con el contador de órdenes nuevas asignadas»` y `«el banner de
     contador cuenta el grupo COMPLETO, no lo que el buscador deja ver»` afirmaban `2 Órdenes nuevas
     asignadas`. Con **Q1** firmada, el literal pasa a `2 órdenes nuevas asignadas`. Cambio de
     literal, misma propiedad.
   - `«sin órdenes por recoger, la card de recogida no se muestra»` y `«sin órdenes visibles no se
     monta el carrusel»` afirmaban el vacío `No hay órdenes por recoger.`, que ya no existe: ahora el
     vacío es el **del grupo activo** (`No hay órdenes por recoger hoy.`). Se actualizó el literal
     conservando lo que cada test prueba (que no hay tarjeta de recogida / que no hay carrusel).
   - Y `«R6: sin coincidencias muestra 'sin resultados', distinto del vacío sin búsqueda»` tenía un
     `queryByText("No hay órdenes por recoger.")` que **habría quedado verde por vacío** tras el
     cambio: se repuntó al literal nuevo para que la pareja siga significando algo.
2. **Tres casos de la 246/261 no cambiaban de contenido pero sí de sitio.** `«R22: la card … dice
   “Para mañana”»` (x2) y `«R11: la card … dice desde QUÉ DÍA se podrá»` miraban una card que ahora
   vive en la otra pestaña. `requirements.md` R31 los daba por «verdes sin tocar». Se les añadió **la
   pulsación** (`irAOtroDia`), que es exactamente la propiedad que la ficha promete (R9), y en el de
   la marca emparejada la pareja se conserva entera, una card a cada lado.
3. **El entorno local estaba sin dependencias.** `node_modules` existía **vacío** al empezar: hubo que
   `pnpm install --frozen-lockfile` (exit 0) y `pnpm run db:generate` (el primer intento de correr
   `RepartoModule.test.tsx` moría con `Cannot find module '.prisma/client/default'`). No es del
   alcance de la ficha; se deja escrito porque el siguiente que abra el repo se lo va a encontrar.
4. **`@base-ui` SÍ cablea el panel a su pestaña.** `design.md` §8 lo dejaba por confirmar («no se da
   por hecho»). Medido sobre el DOM renderizado: `Tabs.Panel` emite `aria-labelledby` con el `id` del
   tab activo. **No hizo falta cablearlo a mano**; el test de R28 lo afirma igualmente.
5. **El banner sigue visible cuando el filtro deja la lista vacía.** Con 1 orden de hoy y una
   búsqueda sin coincidencias, la pantalla dice «1 orden nueva asignada» encima de «Ninguna guía por
   recoger coincide con la búsqueda». **Es el comportamiento vigente** (R16/R20: los contadores
   cuentan lo que el mensajero TIENE, el buscador sólo cambia lo que se VE) y el código anterior
   hacía lo mismo. Se deja anotado por si al reviewer le chirría: cambiarlo sería tocar R16.

---

## 4 · Los DOS tests que cambian de forma (T11) — qué conservan

Los dos son trazabilidad de **otras** fichas y probaban que **la orden no se esconde**. Ninguno se
borró ni se relajó; los dos afirman ahora las **cuatro propiedades** de `design.md` §10, y cada uno
conserva la referencia a su ficha de origen con la fecha del cambio.

| Antes | Ahora |
| --- | --- |
| 246/R23 · «la orden reservada APARECE en su grupo de siempre — no se oculta ni se mueve»: estaba en la región y el banner decía `1 Órdenes nuevas asignadas` | **«R23 (246, en su forma nueva desde la 277): la orden reservada NO se esconde — está contada, a una pulsación, con su marca y con por dónde recogerla»**: (1) pestaña `Para otro día (1)` legible **sin interactuar** y la de hoy seleccionada; (2) **una** pulsación, sin buscarla; (3) marca «Para mañana» + aviso con su fecha; (4) los controles de recogida montados con el grupo de hoy **a cero** |
| 261/R9 · «y la reservada SIGUE en su grupo, contada y visible» | **«R9 (261, en su forma nueva desde la 277): bloquear no es esconder — contada sin interactuar, a una pulsación, con su aviso y con por dónde recoger»** |

La aserción de «no se esconde» queda **más fuerte**: antes bastaba con que la remisión estuviera en
el DOM; ahora hay que probar además que el conteo se lee sin tocar nada y que llegar cuesta una sola
pulsación.

---

## 5 · T13 · La mutación: la suite NO está verde por vacía

Mutación aplicada en `separarPorDia`: `orden.esParaManana === true` → `!== true` (manda al grupo de
otro día justo lo contrario).

- **Resultado: 35 tests rojos** de 82 en los dos archivos (`recoger-grupos.test.ts` +
  `RecogerModule.test.tsx`). La mutación se revirtió y los 82 vuelven a verde.
- Muestra del mensaje: `R2: separa marcadas y no marcadas, sin perder ni duplicar ninguna` →
  `AssertionError: expected [ 'b', 'c' ] to deeply equal [ 'a', 'd' ]`.
- Caen, entre otros: los cuatro de la partición pura; `R8: cada pestaña dice cuántas tiene…`;
  `R12: entra por la pestaña de hoy…`; `R9: la orden reservada está a UNA pulsación…`;
  `R21: buscar la guía de una orden de otro día dice DÓNDE está…`; los dos reescritos de §4; y
  siete casos **anteriores a esta ficha** (el carrusel, el buscador, el detalle de la card), que es
  la señal de que la partición no está aislada del resto de la pantalla.
- **Un superviviente que vale la pena decir:** `R15: el contador dice 1 con 1 de hoy y 1 reservada`
  **sobrevive** a esta mutación concreta — con la regla invertida el grupo de hoy sigue teniendo
  exactamente una orden (la otra), así que el literal no cambia. Lo cazan sus vecinos (`R8`, `R12`,
  `R17`); se deja escrito para que nadie lo lea como que ese test es débil por su cuenta.

---

## 6 · T14 · Evidencia de R30, R33 y R34 sobre el diff

`git diff --name-only 94c824f6..HEAD` (la base de la rama en `dev`):

```
app/(app)/mis-asignaciones/_components/RecogerModule.tsx
app/(app)/mis-asignaciones/_components/recoger-grupos.ts
lib/utils/dia-reparto-textos.ts
tests/components/RecogerModule.test.tsx
tests/components/RepartoModule.test.tsx
tests/unit/components/recoger-grupos.test.ts
```

**Seis archivos, exactamente los seis de la tabla de `design.md` §2.** Ni uno más.

- **R30:** el filtro `^(lib/services/|lib/actions/|lib/repositories/|lib/types/|lib/interfaces/|db/|app/api/|middleware\.ts)` sobre esa lista devuelve **cero**. Y la guardia `d5-revertida.guardia.test.ts` —que además comprueba que `db/schema.prisma` sigue declarando `fecha_reparto` igual— está **verde sin tocarla**.
- **R33:** `app/(app)/mis-asignaciones/recoger/page.tsx` **no se toca**; el gate de rol (`notFound()`) sigue donde estaba y sus tests, verdes sin tocar.
- **R34:** `git diff` del código de producción no añade **ninguna** clase `focus-visible:*` ni `ring-*`. Lo que la primitiva ya traía se hereda tal cual.

---

## 7 · T15 · Guardias y gate

- `pnpm run test:guardias` → **138 archivos, 2054 tests, todos verdes** (incluida
  `d5-revertida.guardia.test.ts`, que censa el árbol entero del portal: ninguna de las seis frases
  prohibidas entró en los comentarios nuevos).
- `pnpm run typecheck` → verde. `pnpm run lint` → **0 errores** (99 warnings preexistentes, ninguno
  en los archivos de esta ficha).
- **`./init.sh --rapido`** → **`INIT_EXIT=0`**, escrito DENTRO del log
  (`{ ./init.sh --rapido; INIT_EXIT=$?; echo "INIT_EXIT=$INIT_EXIT"; } > log 2>&1`), no después de un
  `echo` que pudiera taparlo.
  - El modo rápido **no se negó**: «el cambio no toca esquema, tipos compartidos, config ni dinero».
  - Tests relacionados: **390 archivos, 5771 pasados + 26 saltados**, 215 s.
  - Guardias dentro del mismo gate: **138 archivos / 2054 tests**, 14 s.
  - Ningún test cayó por timeout, así que no hubo que reintentar ninguno aislado.

---

## 8 · T17 · Ver la app, no sólo la suite (2026-08-24)

Se levantó `pnpm dev` y se condujo con Playwright a **390 px** (móvil, que es donde se usa),
entrando como `mensajero.qa@ordenex.test`. Para reproducir el escenario medido en producción se
movió el día de reparto de **tres** órdenes de la base **local** y **se restauró al terminar**
(`QA-R-0017` y `111138` → 2026-08-23; `111111` → 2026-08-22; comprobado fila a fila después). No se
tocó producción ni se sembró nada.

Lo que se vio, con el texto leído de la pantalla:

- **Las dos pestañas, con su conteo, en una sola línea y sin arrastrar:** `Para recoger hoy (1)` ·
  `Para otro día (3)`. La activa se distingue por relleno, **peso y sombra**, y expone
  `aria-selected="true"`.
- **El contador, ya concordado y dentro del panel que cuenta:** «**1 orden nueva asignada**» — el
  caso que abrió la ficha, que antes se habría leído «4 Órdenes nuevas asignadas» con 1 recogible.
- **Una sola pulsación** en «Para otro día» y aparecen las tres, cada una con su badge «Para mañana»
  y su línea «Esta orden es para el reparto del 25 de agosto. Ese día podrás recogerla y
  gestionarla.».
- **Los controles de recogida siguen montados** en las dos pestañas, y al teclear la guía de la
  reservada (`97865841`) el rechazo sale con **el motivo real y su fecha**, no como guía desconocida.
- **El puntero, en la app:** con la pestaña de hoy activa y buscando `97865841`, la pantalla dice
  «Ninguna guía por recoger coincide con la búsqueda.» **y** «Hay 1 coincidencia en «Para otro
  día».», **sin cambiar de pestaña** (`aria-selected` sigue en la de hoy).

Capturas y transcripciones quedaron en el scratchpad de la sesión (no se versionan).

---

## 9 · T16 · Trazabilidad — los 34 requisitos, con el test que los cierra

Nombres **exactos**, citables. `RM` = `tests/components/RecogerModule.test.tsx`;
`RG` = `tests/unit/components/recoger-grupos.test.ts`;
`RP` = `tests/components/RepartoModule.test.tsx`.

| R | Archivo | Nombre exacto del test |
| --- | --- | --- |
| R1 | RM | `R1: monta exactamente dos pestañas, y ninguna ruta ni entrada de menú nuevas` |
| R2 | RG | `R2: separa marcadas y no marcadas, sin perder ni duplicar ninguna` |
| R3 | RG · RM | `R3: una orden SIN el campo (DTO anterior a la feature) cuenta como de hoy` · `R3: \`esParaManana: false\` cuenta como de hoy` · `R3: el DTO viejo (sin el campo) no inventa la marca ni cambia de pestaña` |
| R4 | RG | `R4: la partición no lee ningún reloj — el módulo no importa la fecha del navegador` |
| R5 | RG | `R5: conserva el orden de entrada dentro de cada grupo` |
| R6 | RM | `R6: cuando el servidor deja de marcarla, pasa a la pestaña de hoy sin ninguna acción` |
| R7 | RM | `R7: con un grupo vacío la pestaña sigue montada, habilitada y a una pulsación` · `R7: con los DOS grupos vacíos siguen las dos pestañas, con su cero` · `R7: el recorrido de teclado llega a las dos — la flecha mueve entre pestañas` |
| R8 | RM | `R8: cada pestaña dice cuántas tiene, incluido el cero, sin interactuar` |
| R9 | RM | `R9: la orden reservada está a UNA pulsación — no hace falta buscarla` |
| R10 | RM · RG | `R10: el vacío de cada pestaña nombra SU grupo, y el de la búsqueda dice otra cosa` · `los vacíos, literales a mano, y distintos entre sí` |
| R11 | RM · RG | `R11: la pestaña vacía nombra la otra y cuántas hay allí` · `R11: con UNA sola al otro lado el puntero concuerda en singular` · `R11/R29: el puntero sin búsqueda cuenta ÓRDENES, y concuerda` · `R11/R29: el puntero con búsqueda cuenta COINCIDENCIAS, y concuerda` |
| R12 | RM | `R12: entra por la pestaña de hoy aunque esté VACÍA y la otra tenga órdenes` |
| R13 | RM | `R13: una búsqueda sin coincidencias NO cambia de pestaña` · `R13: recoger la última de hoy tampoco cambia de pestaña` |
| R14 | RM | `R14: tras recoger y refrescar se conservan pestaña, búsqueda y vista` |
| R15 | RM | `R15: el contador dice 1 con 1 de hoy y 1 reservada (el caso medido en producción)` |
| R16 | RM | `el banner de contador cuenta el grupo COMPLETO, no lo que el buscador deja ver` *(existente, literal actualizado por Q1)* |
| R17 | RM | `R17: sin órdenes de hoy NO hay contador (el vacío lo explica su mensaje)` · `R17: el contador NO se ve desde la otra pestaña — está junto al listado que cuenta` |
| R18 | RM | `R18: un SOLO campo de búsqueda, y filtra los dos grupos` |
| R19 | RM | `R19: el texto de la búsqueda sobrevive al cambio de pestaña` |
| R20 | RM | `R20: buscar no mueve NINGÚN contador — ni el de la cabecera ni los de las pestañas` |
| R21 | RM | `R21: buscar la guía de una orden de otro día dice DÓNDE está, no que no existe` |
| R22 | RM | `R22: los controles de recogida no dependen de la pestaña activa` · `R22: con SÓLO órdenes de otro día los controles siguen montados` |
| R23 | RM | `R13: teclear una guía reservada muestra el MOTIVO REAL y NO llama a la action` · `R13: el rechazo NO se disfraza de guía desconocida ni de código inválido` · `R13: el \`conflict\` del servidor con su código pinta EL MISMO texto, no el genérico` *(261, verdes sin tocar)* |
| R24 | RM | `R24: bloqueado — sin controles, con aviso, y las dos pestañas con sus listados visibles` |
| R25 | RM · RG | `R25/R26: los nombres de las pestañas, literales a mano — y ninguno dice «mañana» ni «reserva»` · `R25/R26: ningún texto visible dice «reserva», «mañana», el nombre de la columna ni una fecha de máquina` |
| R26 | RM · RG | los dos de arriba · `R26: los dos nombres de pestaña, literales a mano y paralelos` |
| R27 | RM | `R27: la pestaña activa y los conteos se leen del texto y de \`aria-selected\`, no del color` |
| R28 | RM | `R28: el grupo de pestañas tiene nombre, cada panel cuelga de su pestaña y los listados se llaman distinto` |
| R29 | RG | `R29: el contador concuerda — «1 orden nueva asignada» / «2 órdenes nuevas asignadas»` · los dos del puntero (R11) |
| R30 | `tests/unit/guards/d5-revertida.guardia.test.ts` | la guardia entera, **verde sin tocarla** + la lista de archivos de §6 |
| R31 | `tests/components/PosCardParaManana.test.tsx` · RM | archivo entero **verde sin tocar** · `R22: la card de la orden reservada dice «Para mañana» CON PALABRAS, y la de hoy no` · `R11: la card de la reservada dice desde QUÉ DÍA se podrá, con la fecha en palabras` |
| R32 | RP | `277/R32: Reparto no monta ningún grupo de pestañas y la orden reservada sigue en su listado` |
| R33 | `tests/components/MisAsignacionesPage.test.tsx` | `R9: el rol mensajero ve el listado por recoger, sin las superficies de reparto` · `R12: cualquier rol distinto de mensajero NO ve el módulo (notFound)` · `R12: sin actor autenticado NO ve el módulo (notFound)` · `R12: si el listado responde forbidden, tampoco renderiza el módulo` *(verdes sin tocar)* |
| R34 | — | evidencia sobre el diff, §6: ninguna clase de foco nueva |

Ningún requisito queda sin test y ningún test citado deja de existir.

---

## 10 · Lo que el reviewer debería mirar con lupa

1. **Los seis tests existentes que se tocaron** (§3.1 y §3.2) y los **dos reescritos** (§4): que
   ninguna aserción quedó más débil de lo que era.
2. **El literal del contador**, que es la única decisión de esta ficha que cambia un texto que
   nadie pidió cambiar en el enunciado original: está firmado como Q1, y ahora concuerda.
3. **La regla `=== true`**: si alguien la «simplifica» a `Boolean(...)`, el `undefined` del DTO
   anterior a la feature cambia de grupo sin que ningún tipo se queje. Hay comentario y hay test.
4. **Que el escáner sigue resolviendo contra el grupo COMPLETO**: `RecogerPaqueteCard` recibe
   `porRecoger`, no `grupos.hoy`. Pasarle el grupo de hoy convertiría el rechazo con motivo real en
   un «guía desconocida» falso.
