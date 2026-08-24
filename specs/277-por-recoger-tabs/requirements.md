# Feature 277 — «Por recoger» separa en pestañas las de hoy de las reservadas para otro día

> **La pantalla «Por recoger» del mensajero deja de mezclar en una sola lista lo que puede recoger
> ahora con lo que el servidor le va a rechazar. Dos pestañas dentro de la MISMA pantalla, y el
> contador de la cabecera pasa a contar sólo lo trabajable hoy.**
>
> **No se oculta ninguna orden.** `R23` de la feature 246 —«el sistema NO DEBE ocultarle al mensajero
> una orden que tiene asignada por estar reservada para mañana»— **sigue vigente y no se toca**.
> Cambia el **sitio**, no la **visibilidad**: las dos pestañas están siempre montadas, cada una dice
> cuántas órdenes tiene sin que nadie interactúe, y ninguna orden queda a más de una pulsación.
>
> **Por qué esta ficha existe, dicho entero.** `R23` se decidió **pegada** a `R24` («y se puede
> trabajar»): la orden se mostraba entre el trabajo del día **porque el mensajero podía recogerla**.
> `R24` murió el **2026-08-21** con la feature 261 —la guía **17496963** se recogió y se gestionó
> `entregada` a las 22:10 CR estando reservada para el 22, refutando la medición **M3**— y desde
> entonces el servidor **rechaza** recoger una orden reservada. `R23` sobrevivió sin que nadie
> volviera a decidir la visibilidad **con el candado ya puesto**. Esta ficha es esa decisión.
>
> **Medido en producción el 2026-08-24** (no heredado de ningún informe): había **2 órdenes en
> `por_recoger`, 1 de hoy y 1 reservada para después**, y la cabecera de `RecogerModule` decía
> **«2 Órdenes nuevas asignadas»** con **1 sola recogible**.
>
> **Sin backend.** `esParaManana` ya viaja en `MiAsignacionDTO`, **derivado en el servidor**
> (246/R26), y caduca solo al llegar el día (246/R25). No hay contrato nuevo, ni consulta nueva, ni
> migración, ni un segundo origen de verdad.
>
> Fuentes leídas para escribir esto: `CLAUDE.md`, `docs/specs.md`, `docs/architecture.md`,
> `docs/conventions.md`, `feature_list.json` (entrada 277),
> `app/(app)/mis-asignaciones/recoger/page.tsx`,
> `app/(app)/mis-asignaciones/_components/RecogerModule.tsx`,
> `app/(app)/mis-asignaciones/_components/RecogerPaqueteCard.tsx`,
> `app/(app)/mis-asignaciones/_components/useRecogerPorGuia.ts`,
> `app/(app)/mis-asignaciones/_components/mis-asignaciones-buscador.ts`,
> `app/(app)/mis-asignaciones/_components/pos-card/PosOrderCard.tsx`,
> `lib/interfaces/services/IMisAsignacionesService.ts`, `lib/utils/dia-reparto-textos.ts`,
> `components/ui/tabs.tsx`, `components/shared/TabsGroup.tsx`,
> `app/(app)/novedades/_components/NovedadesTabs.tsx`, `specs/246-asignacion-por-dia/requirements.md`
> (§D y el apéndice del 2026-08-21), `specs/261-dia-reparto-protege/design.md` (§5.1 y la
> alternativa **A7**), `specs/167-apartado-recoleccion-mensajero/requirements.md` (R7/R8),
> `tests/components/RecogerModule.test.tsx`, `tests/unit/guards/d5-revertida.guardia.test.ts`.

---

## Vocabulario

| Término | Qué significa aquí |
| --- | --- |
| **la pantalla** | `/mis-asignaciones/recoger`, la pantalla «Por recoger» del rol `mensajero`. Ninguna otra. |
| **orden reservada** | Orden por recoger cuyo día de reparto es **estrictamente posterior** al día de Costa Rica en curso. En el DTO es `esParaManana === true`, derivado **en el servidor** (246/R26). |
| **orden de hoy** | Toda orden por recoger que **no** es una orden reservada, incluida la que llega sin la marca. |
| **grupo de hoy** / **grupo de otro día** | Los dos conjuntos que resultan de esa separación. |
| **la pestaña activa** | La que el mensajero tiene seleccionada; su panel es el único con lista a la vista. |
| **el contador de la cabecera** | El banner `role="status"` que hoy dice «N Órdenes nuevas asignadas». |
| **el buscador** | El campo de búsqueda de guías de la pantalla (feature 114), que filtra por guía, remisión, teléfono o nombre. |
| **los controles de recogida** | La tarjeta con el número de guía y el escáner de cámara (feature 96), única vía para recoger. |

### Precisión verificada en el código, no supuesta

1. **Esta pantalla no tiene KPIs, ni mapa, ni paradas, ni chat.** `RecogerModule` los excluye a
   propósito y lo dice en su cabecera. Es la razón por la que la separación en grupos aquí no abre
   las cuatro decisiones que hicieron descartar la alternativa **A7** de la 261 (ver `design.md` §1).
2. **No hay botón «Recoger» por card.** La única vía de recogida es el número de guía o el escáner,
   y ambos resuelven contra el grupo **completo** (`RecogerPaqueteCard` → `useRecogerPorGuia`).
3. **El rechazo por reserva ya existe y dice el motivo real**, con la fecha desde la que se podrá
   (261/R13, texto único en `avisoReservaParaOtroDia`).
4. **`esParaManana` es opcional en el DTO** (`esParaManana?: boolean`). Una orden sin el campo hoy
   **no** recibe la marca «Para mañana» en la card; la separación tiene que comportarse igual.
5. **El vocabulario visible del día de reparto evita la palabra «reserva»** a propósito
   (`lib/utils/dia-reparto-textos.ts`: «no dice “reserva”, ni “corte”, ni `fecha_reparto`»), con la
   misma regla con la que el repo retiró «SLA» del frontend.

---

## A · Los dos grupos y dónde vive cada orden

**R1 (Ubicuo).** La pantalla DEBE presentar las órdenes por recoger en **exactamente dos pestañas**
dentro de la misma pantalla, sin ruta nueva y sin entrada de menú nueva.

**R2 (Ubicuo).** El sistema DEBE colocar en la pestaña del grupo de hoy **toda** orden por recoger
que no esté marcada como reservada, y en la otra pestaña **exactamente** las marcadas. Ninguna orden
puede aparecer en las dos, y ninguna puede quedar fuera de ambas.

**R3 (Condicional).** SI una orden llega **sin** la marca de reserva (campo ausente en el DTO),
ENTONCES el sistema DEBE tratarla como orden de hoy y NO DEBE inventarle la marca.

**R4 (Ubicuo).** El sistema DEBE derivar la separación **únicamente** de la marca que ya viaja en el
DTO. NO DEBE pedir ningún dato nuevo al servidor, NO DEBE leer el reloj del navegador y NO DEBE
comparar fechas en el cliente.

**R5 (Ubicuo).** Dentro de cada pestaña, el sistema DEBE conservar el orden en el que las órdenes
llegan del servidor. La separación no reordena nada.

**R6 (Por evento).** CUANDO llegue el día reservado y el servidor deje de marcar la orden, el sistema
DEBE mostrarla en la pestaña del grupo de hoy **sin que nadie ejecute ninguna acción** (246/R25).

---

## B · No se oculta nada — R23 de la 246, con el candado puesto

**R7 (Ubicuo).** El sistema DEBE mantener **las dos pestañas montadas y seleccionables siempre**,
incluso cuando una de ellas —o las dos— no contenga ninguna orden. NO DEBE ocultarlas, NO DEBE
deshabilitarlas y NO DEBE sacarlas del recorrido de teclado.

> Este requisito nace de un fallo real de este repo: la feature 167 se abrió porque
> `RecoleccionTiendaPanel` hacía `if (porRecolectar.length === 0) return null` y el bloque de
> escaneo **desaparecía justo cuando el mensajero iba a buscarlo**.

**R8 (Ubicuo).** Cada pestaña DEBE decir **cuántas órdenes contiene**, incluido el cero, y DEBE
decirlo sin que el mensajero interactúe con la pantalla.

**R9 (Ubicuo).** Toda orden por recoger asignada al mensajero DEBE quedar **alcanzable en esta misma
pantalla con una sola interacción**. El sistema NO DEBE requerir una búsqueda, un desplegable ni
navegar a otra pantalla para llegar a ninguna de ellas.

**R10 (De estado).** MIENTRAS la pestaña activa no muestre ninguna orden, el sistema DEBE explicar
ese vacío con un mensaje propio, y DEBE distinguir **el vacío por no tener órdenes** del **vacío por
una búsqueda sin coincidencias**.

**R11 (Condicional).** SI la pestaña activa no muestra ninguna orden y la otra pestaña sí tiene
órdenes bajo el estado actual de la búsqueda, ENTONCES ese mensaje DEBE **nombrar la otra pestaña y
cuántas hay allí**.

---

## C · Qué pestaña sale seleccionada, y quién la cambia

**R12 (Por evento).** CUANDO el mensajero abre la pantalla, el sistema DEBE dejar seleccionada la
pestaña del **grupo de hoy**, con independencia de cuántas órdenes tenga cada grupo.

**R13 (Ubicuo).** El sistema NO DEBE cambiar de pestaña por su cuenta: ni por el resultado de una
búsqueda, ni tras una recogida, ni porque un grupo se quede vacío. La pestaña la elige el mensajero.

**R14 (Por evento).** CUANDO el listado se refresque tras una recogida, el sistema DEBE conservar la
pestaña activa, el texto de la búsqueda y la vista elegida (mosaico o detalle).

---

## D · El contador de la cabecera

**R15 (Ubicuo).** El contador de la cabecera DEBE contar **exactamente** las órdenes del grupo de
hoy. NO DEBE incluir ninguna orden reservada para otro día.

**R16 (Ubicuo).** Ese contador DEBE contar el **grupo completo** de hoy, y no lo que el buscador deja
a la vista (comportamiento vigente de la feature 114, que no cambia).

**R17 (Condicional).** SI el grupo de hoy está vacío, ENTONCES el sistema NO DEBE mostrar el
contador; el vacío lo explica **R10**. Y el contador NO DEBE mostrarse mientras la pestaña activa sea
la del otro grupo: un contador tiene que estar **junto al listado que cuenta**.

---

## E · El buscador

**R18 (Ubicuo).** La pantalla DEBE tener **un solo** campo de búsqueda, y DEBE aplicarlo a **los dos
grupos**, no sólo a la pestaña activa.

**R19 (Ubicuo).** El campo de búsqueda DEBE permanecer montado sea cual sea la pestaña activa, y su
texto DEBE sobrevivir al cambio de pestaña.

**R20 (Ubicuo).** El buscador NO DEBE alterar ningún contador de la pantalla: ni el de la cabecera ni
los de las pestañas. Todos cuentan **lo que el mensajero tiene**, no lo que el filtro deja ver.

**R21 (Condicional).** SI el mensajero busca una guía que está en el grupo de otro día mientras tiene
activa la pestaña de hoy, ENTONCES el sistema NO DEBE responder únicamente que no hay coincidencias:
DEBE decirle **dónde está** (forma operativa de **R11**).

> Sin esto, un mensajero que escanea o teclea una guía que resulta ser de otro día leería «ninguna
> coincide», que es **falso**, y eso es exactamente la familia de fallos que este repo tiene escrita:
> el sistema no falla, **aparenta**.

---

## F · La recogida no cambia

**R22 (Ubicuo).** Los controles de recogida DEBEN seguir resolviendo la guía contra el grupo
**completo** —las dos pestañas incluidas— y su presencia NO DEBE depender de la pestaña activa ni del
tamaño del grupo de hoy.

**R23 (Por evento).** CUANDO se teclee o escanee una guía de una orden reservada para otro día, el
sistema DEBE seguir rechazándola con el **motivo real** y la fecha desde la que podrá recogerla, y NO
DEBE presentarla como guía desconocida ni como código inválido (261/R13, sin cambios).

**R24 (De estado).** MIENTRAS el mensajero esté bloqueado por un cierre pendiente, el aviso y la
retirada de los controles de recogida DEBEN comportarse como hoy, y **las dos pestañas con sus
listados DEBEN permanecer visibles** en solo-visualización (111/R14, 271, sin cambios).

---

## G · Lenguaje y accesibilidad

**R25 (Ubicuo).** Los nombres de las dos pestañas DEBEN estar en lenguaje claro: sin siglas, sin
nombres de columna, sin jerga interna y sin fechas en formato de máquina.

**R26 (Ubicuo).** El nombre de la pestaña del otro grupo NO DEBE afirmar un día concreto que el
sistema no pueda garantizar. El día de reparto es una fecha libre y un `UPDATE` a mano puede dejarlo
en **+2** —ya ocurrió en producción el 2026-08-21—, así que un nombre que diga «mañana» mentiría
justo en el caso en que un humano tocó la fila.

**R27 (Ubicuo).** La distinción entre las dos pestañas, **cuál está activa** y **cuántas órdenes
tiene cada una** DEBEN poder percibirse **sin depender del color**.

**R28 (Ubicuo).** El grupo de pestañas DEBE tener nombre accesible; cada panel DEBE quedar asociado a
su pestaña; y el listado de cada panel DEBE tener un nombre accesible **distinto del otro**, de forma
que se pueda saber en qué grupo se está sin mirar la pestaña.

**R29 (Ubicuo).** Los textos nuevos que lleven una cantidad DEBEN concordar en singular y plural.

---

## H · Lo que esta ficha NO cambia

**R30 (Ubicuo).** Esta ficha NO DEBE cambiar el backend: ni el contrato del DTO, ni el servicio, ni
las Server Actions, ni ninguna consulta, ni el esquema, ni añadir migración alguna.

**R31 (Ubicuo).** Esta ficha NO DEBE cambiar la marca «Para mañana» de las cards ni el aviso en
palabras con la fecha desde la que se podrá recoger (246/R22, 261/R11).

**R32 (Ubicuo).** Esta ficha NO DEBE cambiar «Reparto», «Recolección» ni ninguna otra pantalla. En
particular, la orden reservada sigue apareciendo en el listado de Reparto exactamente como hoy.

**R33 (Ubicuo).** Esta ficha NO DEBE cambiar quién puede entrar a la pantalla ni el gate de rol
server-side (`notFound()` para todo lo que no sea `mensajero`).

**R34 (Ubicuo).** Esta ficha NO DEBE tocar el anillo de foco de la aplicación: tiene ficha propia
(226) y no se arregla aquí.

---

## I · Trazabilidad

Cada requisito, con la prueba concreta que lo cierra. El desglose ejecutable está en `tasks.md`.

| Requisito | Prueba prevista |
| --- | --- |
| R1 | `tests/components/RecogerModule.test.tsx` → «monta exactamente dos pestañas, y ninguna ruta ni entrada de menú nuevas» |
| R2 | `tests/unit/components/recoger-grupos.test.ts` → «separa marcadas y no marcadas, sin perder ni duplicar ninguna» |
| R3 | `tests/unit/components/recoger-grupos.test.ts` → «una orden sin el campo cuenta como de hoy» + `RecogerModule.test.tsx` → «el DTO viejo no inventa la marca ni cambia de pestaña» |
| R4 | `tests/unit/components/recoger-grupos.test.ts` → «la partición no lee ningún reloj» (el módulo no importa `Date`/`Intl`; se comprueba sobre el fuente) |
| R5 | `tests/unit/components/recoger-grupos.test.ts` → «conserva el orden de entrada dentro de cada grupo» |
| R6 | `tests/components/RecogerModule.test.tsx` → «cuando el servidor deja de marcarla, la orden aparece en la pestaña de hoy sin ninguna acción» (rerender con el mismo id y la marca en `false`) |
| R7 | `tests/components/RecogerModule.test.tsx` → «con un grupo vacío la pestaña sigue montada, habilitada y enfocable» y «con los dos grupos vacíos siguen las dos pestañas» |
| R8 | `tests/components/RecogerModule.test.tsx` → «cada pestaña dice cuántas tiene, incluido el cero, sin interactuar» |
| R9 | `tests/components/RecogerModule.test.tsx` → «la orden reservada está a UNA pulsación: no hace falta buscarla» |
| R10 | `tests/components/RecogerModule.test.tsx` → «el vacío sin órdenes y el vacío por búsqueda dicen cosas distintas» |
| R11 | `tests/components/RecogerModule.test.tsx` → «la pestaña vacía nombra la otra y cuántas hay allí» + `tests/unit/components/recoger-grupos.test.ts` (el texto del puntero) |
| R12 | `tests/components/RecogerModule.test.tsx` → «entra por la pestaña de hoy aunque esté vacía y la otra tenga órdenes» |
| R13 | `tests/components/RecogerModule.test.tsx` → «una búsqueda sin coincidencias NO cambia de pestaña» |
| R14 | `tests/components/RecogerModule.test.tsx` → «tras recoger y refrescar se conservan pestaña, búsqueda y vista» |
| R15 | `tests/components/RecogerModule.test.tsx` → «el contador dice 1 con 1 de hoy y 1 reservada» (el caso medido en producción el 2026-08-24) |
| R16 | `tests/components/RecogerModule.test.tsx` → «el contador cuenta el grupo COMPLETO de hoy, no lo que el buscador deja ver» (test existente, se conserva) |
| R17 | `tests/components/RecogerModule.test.tsx` → «sin órdenes de hoy no hay contador» y «el contador no se ve desde la otra pestaña» |
| R18 | `tests/components/RecogerModule.test.tsx` → «un solo campo de búsqueda, y filtra los dos grupos» |
| R19 | `tests/components/RecogerModule.test.tsx` → «el texto de la búsqueda sobrevive al cambio de pestaña» |
| R20 | `tests/components/RecogerModule.test.tsx` → «buscar no mueve ningún contador» |
| R21 | `tests/components/RecogerModule.test.tsx` → «buscar la guía de una orden de otro día desde la pestaña de hoy dice dónde está, no que no existe» |
| R22 | `tests/components/RecogerModule.test.tsx` → «los controles de recogida no dependen de la pestaña activa» y «con sólo órdenes de otro día siguen montados» |
| R23 | `tests/components/RecogerModule.test.tsx` → tests 261/R13 existentes, verdes sin tocar |
| R24 | `tests/components/RecogerModule.test.tsx` → «bloqueado: sin controles, con aviso, y las dos pestañas visibles» |
| R25, R26 | `tests/components/RecogerModule.test.tsx` → «los nombres de las pestañas, literales a mano» + `tests/unit/components/recoger-grupos.test.ts` → «ningún texto visible dice “reserva”, “mañana”, `fecha_reparto` ni una fecha `YYYY-MM-DD`» |
| R27 | `tests/components/RecogerModule.test.tsx` → «la pestaña activa y los conteos se leen del texto y de `aria-selected`, no del color» |
| R28 | `tests/components/RecogerModule.test.tsx` → «el grupo de pestañas tiene nombre, cada panel está asociado a su pestaña y los dos listados se llaman distinto» |
| R29 | `tests/unit/components/recoger-grupos.test.ts` → «1 orden / 2 órdenes, 1 coincidencia / 2 coincidencias» |
| R30 | `tests/unit/guards/d5-revertida.guardia.test.ts` (existente, verde: el esquema no se movió) + revisión del diff: `git diff --name-only` no toca `lib/services/**`, `lib/actions/**`, `lib/repositories/**`, `db/**` (task T12) |
| R31 | `tests/components/PosCardParaManana.test.tsx` y los tests 246/R22 de `RecogerModule.test.tsx`, verdes sin tocar |
| R32 | `tests/components/RepartoModule.test.tsx` → «Reparto no monta ningún grupo de pestañas y la orden reservada sigue en su listado» |
| R33 | `tests/components/MisAsignacionesPage.test.tsx` → bloque «RecogerPage — control de acceso por rol (R9/R12)», verde sin tocar |
| R34 | Revisión del diff: ninguna clase de foco (`focus-visible:*`, `ring`) añadida o modificada fuera de la primitiva existente (task T12) |

---

## Preguntas abiertas

**Q1 — El literal del contador no concuerda en singular, y esta ficha lo deja a la vista.**
Hoy dice «N Órdenes nuevas asignadas». Con **R15**, el caso medido en producción el 2026-08-24
—2 órdenes, 1 recogible— pasa de leerse «2 Órdenes nuevas asignadas» a leerse **«1 Órdenes nuevas
asignadas»**. El defecto ya existe (dos tests afirman hoy ese literal exacto con `1`), pero esta
ficha lo hace frecuente. **Recomendación:** corregirlo a «1 orden nueva asignada» / «2 órdenes nuevas
asignadas». **No lo doy por decidido** porque cambia un literal que la ficha no menciona y que dos
tests existentes afirman; si el humano prefiere no tocarlo, **R29** queda acotado a los textos
nuevos, como está escrito.

**Q2 — Firma de los nombres de las pestañas.** El spec propone y justifica **«Para recoger hoy»** y
**«Para otro día»** (`design.md` §4, con los cuatro candidatos descartados y el motivo de cada uno).
Es la decisión más cara de deshacer de toda la ficha —la lección del repo con «Del 23 al 24 de
agosto» está escrita— y pido **firma explícita** antes de implementar.

**Q3 — La pestaña de entrada cuando hoy no hay nada.** **R12** hace entrar siempre por «Para recoger
hoy», aunque esté vacía y la otra tenga órdenes, porque una pantalla que cambia de puerta según el
día es una pantalla que no se puede aprender. La contrapartida es real: un mensajero que sólo tenga
órdenes para otro día entra a una pestaña vacía (que **R10** y **R11** explican y señalan). **¿Se
firma así, o el humano prefiere entrar por la que tiene trabajo?**

**Q4 — Confirmación, no bloqueante: los controles de recogida con el grupo de hoy vacío.** **R22**
los deja montados cuando el mensajero **sólo** tiene órdenes de otro día — es el comportamiento de
hoy, y el rechazo dice el motivo real (261/R13). La alternativa sería retirarlos, y sería repetir el
fallo de la 167 en otro disfraz. Se deja escrito como **no-cambio**; se confirma por si el humano lo
lee distinto ahora que la pestaña de hoy puede quedar vacía.

---

## PUERTA HUMANA PASADA — 2026-08-24

Las tres preguntas que pedían decisión quedaron firmadas por el humano el 2026-08-24, con la
recomendación del spec en las tres. Se anotan aquí para que el implementer no las re-abra.

- **Q2 · Nombres de las pestañas → FIRMADO: «Para recoger hoy» y «Para otro día».** Tal cual la
  propuesta de `design.md` §4, con su razón: `fecha_reparto` admite +2 —ya ocurrió con la guía
  17496963— así que «mañana» mentiría, y el repo retiró «reserva» y «corte» del texto visible a
  propósito.
- **Q1 · El literal del contador → FIRMADO: SÍ se corrige la concordancia** («1 orden nueva
  asignada» / «2 órdenes nuevas asignadas»). El defecto ya existía, pero R15 lo vuelve frecuente y
  se decidió no dejarlo a la vista. **R29 deja de estar acotado a los textos nuevos**: alcanza a
  este literal, y los dos tests existentes que afirman la forma vieja se reescriben conservando las
  cuatro propiedades de `design.md` §10.
- **Q3 · Pestaña de entrada → FIRMADO: siempre «Para recoger hoy», aunque esté vacía.** R12 queda
  como está. Una pantalla que cambia de puerta según el día es una pantalla que no se puede
  aprender; la pestaña vacía lo explica y señala cuántas hay en la otra (R10/R11).
- **Q4 · Controles de recogida con el grupo de hoy vacío → se confirma el NO-CAMBIO** (R22): siguen
  montados, y el rechazo dice el motivo real (261/R13). Retirarlos sería repetir el fallo de la 167.
