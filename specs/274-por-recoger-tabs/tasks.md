# Feature 274 — Tareas

> Frontend puro, zona `frontend`. **Ningún archivo de `lib/services/**`, `lib/actions/**`,
> `lib/repositories/**`, `lib/types/**`, `lib/interfaces/**`, `db/**` ni `app/api/**` se toca.**
>
> `[P]` = se puede hacer en paralelo con las otras marcadas `[P]` del mismo bloque.
> Cada tarea tiene su criterio de **hecho**; sin él la tarea no está hecha, está escrita.
>
> **Antes de T1:** la ficha está en `spec_ready` y **no se escribe código de producción** hasta que
> el humano apruebe (`docs/specs.md`, la puerta). Las preguntas **Q1-Q4** de `requirements.md`
> necesitan respuesta antes de T4 y T6.

---

## Bloque 0 — Puerta

- [x] **T0 · Aprobación humana y firma de los literales.**
      Respuesta a **Q2** (nombres de las pestañas) y **Q3** (pestaña de entrada) como mínimo; **Q1**
      (el singular del contador) y **Q4** (controles de recogida con el grupo de hoy vacío) pueden
      responderse como «se deja como está», pero **respondidas**.
      **Hecho:** las cuatro respuestas anotadas en `progress/impl_274.md`, con fecha. Si alguna
      cambia una decisión del spec, se actualiza `requirements.md`/`design.md` **antes** de T1.
      *Depende de: nada. Bloquea: todo.*

---

## Bloque 1 — La pieza pura (sin DOM, sin JSX)

- [x] **T1 · `app/(app)/mis-asignaciones/_components/recoger-grupos.ts`: la partición.**
      `separarPorDia(ordenes)` → `{ hoy, otroDia }`, con la regla **`esParaManana === true`** y todo
      lo demás —incluido `undefined`— en `hoy` (R2, R3). Preserva el orden de entrada (R5). Sin
      importar `Date` ni `Intl` (R4). Comentario que diga por qué es `=== true` y no `Boolean(...)`.
      **⚠️ El comentario NO puede contener ninguna de las frases prohibidas por
      `tests/unit/guards/d5-revertida.guardia.test.ts`** (`design.md` §11).
      **Hecho:** el archivo existe, `pnpm exec tsc --noEmit` verde, y `grep` sobre el archivo no
      encuentra `Date`, `Intl` ni ninguna de las seis frases censadas.
      *Depende de: T0.*

- [x] **T2 · [P] Los textos de vacío y del puntero, en el mismo archivo.**
      Los cinco de la tabla de `design.md` §6, con concordancia singular/plural (R29) y distinguiendo
      `órdenes` (sin búsqueda) de `coincidencias` (con búsqueda). Ninguno dice «reserva», «corte»,
      `fecha_reparto` ni una fecha `YYYY-MM-DD` (R25).
      **Hecho:** exportados y tipados; typecheck verde.
      *Depende de: T0.*

- [x] **T3 · [P] Los dos nombres de pestaña en `lib/utils/dia-reparto-textos.ts`.**
      Aditivo, junto a `ETIQUETA_PARA_MANANA`, con el comentario de por qué viven ahí y por qué el
      nombre del segundo grupo **no** dice «mañana» (R26: el `+2` de la guía 17496963).
      **Hecho:** exportados; typecheck verde; el archivo no gana ningún `import` nuevo.
      *Depende de: T0.*

- [x] **T4 · Tests de la pieza pura → `tests/unit/components/recoger-grupos.test.ts`.**
      Cubre **R2, R3, R4, R5, R11 (texto), R25, R26, R29**. Casos mínimos:
      «separa marcadas y no marcadas, sin perder ni duplicar ninguna» · «una orden sin el campo
      cuenta como de hoy» · «`esParaManana: false` cuenta como de hoy» · «conserva el orden de
      entrada dentro de cada grupo» · «la partición no lee ningún reloj» (lectura del fuente:
      ni `Date` ni `Intl`) · «1 orden / 2 órdenes, 1 coincidencia / 2 coincidencias» · «ningún texto
      visible dice “reserva”, “mañana”, `fecha_reparto` ni una fecha `YYYY-MM-DD`».
      **Literales escritos a mano**, nunca importando la constante que se prueba.
      **Hecho:** `pnpm exec vitest run tests/unit/components/recoger-grupos.test.ts` verde, sin jsdom.
      *Depende de: T1, T2, T3.*

---

## Bloque 2 — La composición de la pantalla

- [x] **T5 · Montar las dos pestañas en `RecogerModule.tsx`.**
      Sobre `components/ui/tabs.tsx` (`Tabs/TabsList/TabsTrigger/TabsContent`), **sin `keepMounted`**
      (`design.md` §7). Estructura exacta de `design.md` §5; la región `Por recoger`, el buscador y
      el conmutador de vista **no se mueven de sitio**. Pestaña de hoy a la izquierda y activa por
      defecto (R12). Conteo en el texto de cada pestaña, incluido el cero (R8).
      **Hecho:** `getByRole("tablist")`, dos `role="tab"` con sus nombres y conteos, un
      `role="tabpanel"`; typecheck y lint verdes.
      *Depende de: T4.*

- [x] **T6 · El contador de la cabecera baja al panel de hoy y cuenta sólo hoy.**
      R15, R16, R17. El literal del banner **no cambia** salvo que **Q1** diga otra cosa.
      **Hecho:** con `[1 de hoy, 1 reservada]` la pantalla dice `1 …` (el caso medido en producción
      el 2026-08-24); con `[0 de hoy, 1 reservada]` no hay banner; desde la otra pestaña no se ve.
      *Depende de: T5.*

- [x] **T7 · Vacíos y puntero a la otra pestaña.**
      R10, R11. Los cuatro estados de vacío de `design.md` §6, más la frase del puntero cuando
      corresponda. **Ninguna pestaña se oculta ni se deshabilita jamás** (R7).
      **Hecho:** los cuatro mensajes salen en los cuatro escenarios, y el puntero nombra la otra
      pestaña con su número.
      *Depende de: T5, T2.*

- [x] **T8 · [P] Buscador compartido sobre los dos grupos.**
      R18, R19, R20, R21. Un solo `filtrarAsignaciones` aplicado a cada grupo; los conteos **no** se
      mueven con la búsqueda; la pestaña **no** cambia sola (R13).
      **Hecho:** buscar el número de guía de una orden de otro día desde la pestaña de hoy deja la
      pestaña donde estaba y muestra el puntero con `1 coincidencia`.
      *Depende de: T5, T7.*

- [x] **T9 · [P] Accesibilidad de las pestañas.**
      R27, R28: `aria-label` del `tablist`; nombre accesible propio para el listado de cada panel
      (`Órdenes por recoger` se conserva en el de hoy); verificación **sobre el DOM renderizado** de
      que el panel queda asociado a su pestaña, y cableado explícito si `@base-ui` no lo hace solo.
      Sin tocar el anillo de foco (R34).
      **Hecho:** el test de R28 pasa **sin** añadir clases de color nuevas; `git diff` no muestra
      ninguna clase `focus-visible:*`/`ring` nueva.
      *Depende de: T5.*

---

## Bloque 3 — Tests de la pantalla

- [x] **T10 · Casos nuevos en `tests/components/RecogerModule.test.tsx`.**
      Uno por requisito, con el nombre que fija la tabla de trazabilidad de `requirements.md` §I:
      **R1, R6, R7, R8, R9, R10, R11, R12, R13, R14, R15, R17, R18, R19, R20, R21, R22, R24, R25,
      R26, R27, R28**. Literales a mano.
      Dos que no pueden faltar por ser el corazón de la ficha:
      - «el contador dice 1 con 1 de hoy y 1 reservada» (**el caso medido en producción**);
      - «la orden reservada está a UNA pulsación: no hace falta buscarla» (**R23 de la 246, en su
        forma nueva**).
      **Hecho:** `pnpm exec vitest run tests/components/RecogerModule.test.tsx` verde, y cada
      requisito de esa lista tiene **un** test que se puede citar por nombre.
      *Depende de: T5-T9.*

- [x] **T11 · Reescribir los DOS tests existentes que cambian de forma.**
      `design.md` §10. Los de «R23: la orden reservada APARECE en su grupo de siempre» (246) y
      «R9: y la reservada SIGUE en su grupo, contada y visible» (261). Cada uno **conserva las cuatro
      propiedades** listadas en §10 y **conserva la referencia a su ficha de origen**, añadiendo por
      qué cambió de forma y la fecha.
      **Hecho:** los dos verdes en su forma nueva; el diff de cada uno muestra que la aserción de «no
      se esconde» quedó **más** fuerte (conteo visible sin interactuar + una pulsación), no más
      débil. ⛔ Borrarlos o dejarlos en un `queryByText` que pase por vacío **no** es «hecho».
      *Depende de: T10.*

- [x] **T12 · [P] No-regresión de las otras superficies.**
      R31, R32: aserción aditiva en `tests/components/RepartoModule.test.tsx` → «Reparto no monta
      ningún grupo de pestañas y la orden reservada sigue en su listado». `PosCardParaManana.test.tsx`
      y los tests 246/R22 y 261/R13 de `RecogerModule.test.tsx`, **verdes sin tocarlos**.
      **Hecho:** los tres archivos verdes; el diff de `RepartoModule.test.tsx` es sólo la aserción
      nueva.
      *Depende de: T5.*

- [x] **T13 · Comprobación de que los tests no están verdes por vacíos (mutación).**
      Mutar `esParaManana === true` → `!== true` en `separarPorDia` y **correr la suite**.
      **Hecho:** se anota en `progress/impl_274.md` **qué tests concretos caen** y con qué mensaje,
      y se revierte la mutación. Si la suite sobrevive, la tarea **no está hecha**: faltan casos.
      *Depende de: T10, T11.*

---

## Bloque 4 — Cierre

- [x] **T14 · Evidencia de R30, R33 y R34 sobre el diff.**
      `git diff --name-only origin/dev...` no contiene `lib/services/`, `lib/actions/`,
      `lib/repositories/`, `lib/types/`, `lib/interfaces/`, `db/`, `app/api/`, ni
      `middleware.ts`; y no aparece ninguna clase de foco nueva.
      **Hecho:** la lista de archivos tocados, pegada en `progress/impl_274.md`, coincide **exactamente**
      con la tabla de `design.md` §2.
      *Depende de: T1-T13.*

- [x] **T15 · Guardias y gate.**
      `pnpm run test:guardias` (en especial `d5-revertida.guardia.test.ts`, que censa el árbol entero
      del portal) y después `./init.sh --rapido`.
      **Hecho:** ambos verdes, con `INIT_EXIT=$?` escrito **dentro** del log (este repo ya tuvo un
      gate rojo llegando como «exit code 0» por un `echo` de por medio). Si `--rapido` **se niega**,
      se corre `./init.sh` completo: es un `fail`, no un aviso.
      *Depende de: T14.*

- [x] **T16 · Mapa de trazabilidad en `progress/impl_274.md`.**
      Los **34** requisitos, cada uno con el archivo y el **nombre exacto** del test que lo cierra.
      Un requisito sin test es un fallo de la feature (`docs/specs.md`), y el reviewer rechaza.
      **Hecho:** 34 filas, ninguna con «pendiente», ninguna citando un test que no exista (hay
      guardia para eso: `test-citado-desaparecido.guardia.test.ts`).
      *Depende de: T15.*

- [x] **T17 · Ver la app, no sólo la suite.**
      Abrir `/mis-asignaciones/recoger` como mensajero con **1 de hoy + 1 de otro día** —el escenario
      medido— y comprobar con los ojos: los dos nombres de pestaña, los dos conteos, el contador
      diciendo **1**, el vacío de una pestaña con su puntero, y que teclear la guía de la reservada
      en los controles de recogida sigue diciendo el motivo real con su fecha.
      **Hecho:** anotado en `progress/impl_274.md` qué se vio, con la fecha. Este repo tiene medido
      que mirar la app encuentra en minutos lo que 12.000 tests dan por bueno.
      *Depende de: T15.*

---

## Orden sugerido

```
T0
 └─ T1 · T2 [P] · T3 [P]
     └─ T4
         └─ T5
             ├─ T6
             ├─ T7 ─ T8 [P]
             ├─ T9 [P]
             └─ T12 [P]
                 └─ T10 ─ T11 ─ T13
                     └─ T14 ─ T15 ─ T16 · T17
```

## Riesgos que el implementer debe tener delante

1. **Las frases prohibidas por la guardia D5** (`design.md` §11). Se escribe un comentario
   entusiasta y el gate se pone rojo en un archivo que no es el tuyo.
2. **Los dos tests que cambian** (§10) son trazabilidad de **otras** fichas. No se borran, no se
   relajan: se reescriben conservando lo que probaban.
3. **El literal del contador** (`Q1`). Si se toca sin respuesta, se rompen dos tests existentes por
   un motivo que la ficha no pidió.
4. **`keepMounted` está desactivado a propósito.** Activarlo deja dos listados en el DOM y duplica
   nombres accesibles; si algún día hace falta, primero hay que resolver §8.
5. **El escáner resuelve contra el grupo completo.** Cualquier «simplificación» que le pase sólo el
   grupo de hoy convierte el rechazo con motivo real (261/R13) en un «guía desconocida» falso, y
   ningún test de esta ficha lo vería si además se le cambia el fixture: los tests de 261/R13 se
   dejan **intactos** por eso.

---

## Marcado de las casillas — 2026-08-24

Las 18 casillas se marcan **sobre la verificación del reviewer**, no a ojo. `progress/review_274.md`
recorrió la evidencia de las 17 tareas **una a una** y su conclusión literal fue que faltaba
*marcarla, no hacerla*. El gate que respalda el marcado es el que corrió **el propio reviewer**, no
el del implementer: `./init.sh --rapido` con `INIT_EXIT=0` escrito dentro del log, 390 archivos /
5771 tests pasados + 26 saltados y 138 archivos / 2054 de guardias, coincidiendo exacto con lo
declarado.

En este repo marcar casillas a ojo ya produjo un `tasks.md` que decía 1/46 con 42 hechas, y la
corrección costó releer cuatro bitácoras. Por eso se deja escrito de dónde sale el marcado.
