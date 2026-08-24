# Feature 274 — Diseño

> Frontend puro. **Cero backend, cero base de datos, cero migraciones, cero rutas nuevas.** El dato
> que separa los dos grupos ya viaja en el DTO desde la feature 246.

---

## 1 · Por qué esto se puede hacer ahora, y por qué no es la alternativa A7 que se descartó

Esto no es una idea nueva: es **A7 de la feature 261**, que el humano descartó al firmar **P3** el
2026-08-22. El texto de aquella decisión, verbatim de `specs/261-dia-reparto-protege/design.md`:

> **A7 · Mover las órdenes reservadas a un grupo propio «Para mañana».** Descartada […]: obliga a
> decidir, para una cuarta lista, si cuenta en los KPI, si es parada del mapa, si entra en el chat y
> si el buscador la alcanza — cuatro decisiones nuevas para un cambio que la deshabilitación
> resuelve con el patrón que el usuario ya conoce del bloqueo por cierre. Y roza R9: lo que se saca
> del grupo de siempre está a un paso de esconderse.

**Qué cambió, punto por punto, y por qué esta ficha sí procede:**

| Objeción de A7 | Estado en esta ficha |
| --- | --- |
| «si cuenta en los KPI» | **No existe la pregunta.** `RecogerModule` no tiene KPIs; lo dice su propia cabecera («Qué NO se trajo: el filtro cantón/distrito y los KPIs, que siguen solo en Reparto»). |
| «si es parada del mapa» | **No existe la pregunta.** Esta pantalla no monta mapa ni ruta: las cards van con `mostrarRuta={false}` porque estas órdenes todavía no entraron en la ruta optimizada. |
| «si entra en el chat» | **No existe la pregunta.** El chat flotante no se trajo a esta pantalla: «conversa sobre gestiones en curso, y aquí no hay ninguna». |
| «si el buscador la alcanza» | **Existe, y se decide aquí**, con requisito propio y test propio: **R18/R21**, §6. Es la única de las cuatro que sobrevive, y es la que decide si un mensajero encuentra una guía escaneada que resulta ser de otro día. |
| «una cuarta lista» | **No hay cuarta lista.** Son dos pestañas **de la misma lista**, en la misma pantalla, sin ruta ni entrada de menú nuevas. |
| «roza R9: está a un paso de esconderse» | **Es el riesgo real, y se cierra con requisitos, no con buena voluntad:** R7 (las dos pestañas siempre montadas, nunca deshabilitadas), R8 (cada una dice su conteo, incluido el cero, sin interactuar), R9 (una sola pulsación), R10/R11 (la pestaña vacía explica y señala). |

Y lo que cambió por debajo. A7 se descartó **el mismo día en que se cerraba el candado**, con el
argumento de que «la deshabilitación resuelve con el patrón que el usuario ya conoce» — un argumento
sobre **cómo** presentar la restricción, no sobre **si** la orden debía seguir mezclada con el
trabajo del día. Esa segunda pregunta nunca se hizo: `R23` de la 246 («no ocultar») se firmó pegada a
`R24` («y se puede trabajar»), `R24` murió el 2026-08-21, y `R23` sobrevivió por inercia. La ficha
274 es el humano decidiendo la visibilidad **con el candado ya puesto**, mirando la pantalla real el
2026-08-24 y con el defecto del contador medido delante.

**`R23` no se toca y no se reescribe.** Lo que esta ficha hace es *operacionalizarlo* para una
pantalla con dos pestañas: «no ocultar» pasa a significar **montada siempre, contada siempre,
a una pulsación siempre** (R7-R9). Nada sale de la pantalla.

---

## 2 · Alcance: qué archivos se tocan

| Archivo | Qué pasa |
| --- | --- |
| `app/(app)/mis-asignaciones/_components/RecogerModule.tsx` | **Modificado.** Compone las dos pestañas; el contador se mete dentro del panel que cuenta. |
| `app/(app)/mis-asignaciones/_components/recoger-grupos.ts` | **Nuevo.** Función pura de partición + los textos de vacío y del puntero a la otra pestaña. Sin JSX, sin DOM: testeable sin jsdom (mismo molde que `mis-asignaciones-buscador.ts`, que se prueba en `tests/unit/components`). |
| `lib/utils/dia-reparto-textos.ts` | **Modificado, sólo aditivo.** Se añaden los dos nombres de pestaña, junto a `ETIQUETA_PARA_MANANA`. |
| `tests/unit/components/recoger-grupos.test.ts` | **Nuevo.** |
| `tests/components/RecogerModule.test.tsx` | **Modificado.** Casos nuevos + **dos casos existentes que cambian**: §10. |
| `tests/components/RepartoModule.test.tsx` | **Modificado, sólo aditivo.** Una aserción de no-regresión (R32). |

**Nada más.** Sin `lib/services/**`, sin `lib/actions/**`, sin `lib/repositories/**`, sin `db/**`,
sin `app/api/**`, sin `lib/types/**`, sin `lib/interfaces/**`.

---

## 3 · Modelo de datos, endpoints y contratos

**Modelo de datos: ninguno.** No hay tabla nueva, ni columna nueva, ni RLS que revisar, ni migración
(y por lo tanto ningún `down.sql`). `orden.fecha_reparto` existe desde la 246 y esta ficha ni la lee
directamente: lee lo que el servidor ya derivó de ella.

**Endpoints/rutas: ninguno.** La pantalla sigue siendo `/mis-asignaciones/recoger`, servida por el
mismo Server Component, con el mismo `listarMisAsignaciones()` y el mismo gate de rol.

**Contrato de entrada (ya existente, no cambia):**

```ts
// lib/interfaces/services/IMisAsignacionesService.ts — MiAsignacionDTO
esParaManana?: boolean;      // derivado EN EL SERVIDOR (246/R26); caduca solo al llegar el día (246/R25)
fechaRepartoISO?: string | null; // YYYY-MM-DD ya resuelto por el servidor (261/R14)
```

**Contrato de la única pieza nueva** (`recoger-grupos.ts`), función pura:

```ts
export interface GruposPorRecoger {
  /** Las que el mensajero puede recoger hoy. Orden de entrada preservado. */
  hoy: MiAsignacionDTO[];
  /** Las reservadas para un día posterior. Orden de entrada preservado. */
  otroDia: MiAsignacionDTO[];
}

/** Regla ÚNICA de partición: `esParaManana === true` va a `otroDia`; TODO lo demás, a `hoy`. */
export function separarPorDia(ordenes: MiAsignacionDTO[]): GruposPorRecoger;
```

**Por qué `=== true` y no `Boolean(...)`, dicho aquí para que no se «simplifique» luego.** El campo es
opcional (`esParaManana?: boolean`) por el patrón aditivo del DTO. `=== true` deja `undefined` en el
grupo de hoy **explícitamente**, que es lo mismo que ya hace la card al no inventar la marca (R3). No
es un detalle de estilo: es la regla que decide dónde vive una orden servida por un despliegue
anterior.

**Nada de esto lee un reloj.** El módulo nuevo no importa `Date` ni `Intl`, igual que
`dia-reparto-textos.ts`. R4 se comprueba sobre el fuente, no de palabra.

---

## 4 · Los nombres de las dos pestañas — **la decisión más cara de deshacer**

**Propuesta:**

| Pestaña | Nombre | Con su conteo |
| --- | --- | --- |
| Izquierda (entrada) | **«Para recoger hoy»** | `Para recoger hoy (1)` |
| Derecha | **«Para otro día»** | `Para otro día (1)` |

**Por qué estos dos:**

1. **Dicen qué se puede HACER, no sólo cuándo.** El mensajero abre esta pantalla con una pregunta
   («¿qué recojo ahora?») y las dos etiquetas la responden por oposición.
2. **Son paralelas** («Para … / Para …»): se leen como dos mitades de lo mismo y no como dos
   conceptos distintos.
3. **«otro día» es cierto siempre.** `fecha_reparto` es un `DATE` libre y **un `UPDATE` a mano puede
   dejar +2** — no es hipotético, ocurrió en producción el 2026-08-21 con la guía 17496963. Un grupo
   que se llamara «Para mañana» **mentiría** en cuanto contuviera una orden de pasado mañana, y un
   grupo mixto no tiene otro nombre honesto. Es el mismo razonamiento con el que la 261 (**A8**)
   descartó que el aviso dijera «mañana» en vez de la fecha.
4. **Ninguna dice «reserva».** Es una regla viva de este repo, escrita en el propio módulo de textos
   («no dice “reserva”, ni “corte”, ni `fecha_reparto`»), heredada de cuando se retiró «SLA» del
   frontend. Por eso **«Reservadas para otro día»** queda descartada aun siendo más precisa.
5. **Caben en un móvil de 360 px** con su conteo. `TabsList` scrollea en X si no cabe, pero un
   listado de dos pestañas que hay que arrastrar en la calle es un listado peor.

**Candidatos descartados, con el motivo:**

| Candidato | Por qué no |
| --- | --- |
| «Hoy» / «Mañana» | Miente con `+2` (punto 3). Y «Hoy» a secas no dice qué se hace con esas órdenes: es la clase de etiqueta ambigua que en este repo ya costó cara con «Del 23 al 24 de agosto». |
| «Disponibles» / «Bloqueadas» | **Colisión real de vocabulario:** en este mismo portal «bloqueado» ya significa *el mensajero bloqueado por un cierre pendiente* (111/271), que es otra cosa y tiene su propio aviso en esta misma pantalla. Dos significados para la misma palabra en la misma pantalla. |
| «Reservadas para otro día» | Usa «reserva», jerga interna que el repo retiró del texto visible a propósito; y 24 caracteres + conteo se arrastran en móvil. |
| «Por recoger» / «Para después» | «Por recoger» es el nombre de **la pantalla entera** (`<h1>` y `aria-label` de la región): repetirlo como nombre de una de sus partes rompe la relación todo/parte y confunde a los tests y al lector de pantalla. |
| «Hoy (1)» / «Otro día (1)» | La versión corta es tentadora, pero sin verbo las dos pestañas dejan de responder «¿qué hago con esto?». Se descarta por poco; si el humano prefiere la brevedad en la calle, es el cambio de una constante. |

**Dónde viven los literales.** En `lib/utils/dia-reparto-textos.ts`, junto a `ETIQUETA_PARA_MANANA`,
que es el archivo cuyo propósito declarado es **el vocabulario visible del día de reparto** y que
existe precisamente para que «un día una pantalla no diga “Mañana” y otra “Día siguiente”». Los
textos de vacío y del puntero, en cambio, son de **esta** pantalla y viven colocados con ella
(`recoger-grupos.ts`), según la regla de `docs/architecture.md` («si se usa en UN SOLO lugar, vive
junto a la página que lo usa»).

⚠️ **Los tests escriben estos literales A MANO**, nunca importando la constante. Este repo tiene la
lección escrita: una aserción contra su propia fuente está siempre verde y ya dejó pasar un tope que
la app rechazaba. Es lo mismo que hizo la 261 con sus frases («Los literales, escritos a mano»).

---

## 5 · Composición de la pantalla

Estructura resultante, dentro de la región `<section aria-label="Por recoger">` que ya existe (no se
mueve: es por donde la pantalla se identifica y por donde la buscan los tests):

```
[aviso de bloqueo por cierre]            ← fuera de la sección, sin cambios (111/271)
[tarjeta de recogida: guía + escáner]    ← fuera de la sección, sin cambios (96/261)
<section aria-label="Por recoger">
  [buscador]  [conmutador mosaico/detalle]      ← compartidos por las dos pestañas
  <tablist aria-label="Grupos de órdenes por recoger">
    [Para recoger hoy (N)]  [Para otro día (M)]
  </tablist>
  <tabpanel «Para recoger hoy»>
    [contador: «N Órdenes nuevas asignadas»]    ← AHORA vive aquí dentro
    [carrusel/lista del grupo de hoy]  |  [vacío + puntero]
  </tabpanel>
  <tabpanel «Para otro día»>
    [carrusel/lista del grupo de otro día]  |  [vacío + puntero]
  </tabpanel>
</section>
```

**Qué queda ARRIBA de las pestañas, y por qué:**

- **Los controles de recogida** (R22). Resuelven la guía contra el grupo **completo**, así que no
  pertenecen a ninguna de las dos pestañas. Y su presencia sigue dependiendo de lo de siempre
  (`bloqueado || porRecoger.length === 0`), **no** del tamaño del grupo de hoy: si el mensajero sólo
  tiene órdenes de otro día, la tarjeta se queda y el rechazo le dice el motivo real con su fecha
  (261/R13). Retirarla ahí sería repetir el fallo que abrió la 167 —el bloque de escaneo que
  desaparecía justo cuando iban a buscarlo— con otro disfraz.
- **El buscador y el conmutador de vista** (R18/R19). Uno solo, compartido, con su estado por encima
  de las pestañas: así el texto y la vista sobreviven al cambio de pestaña sin ningún esfuerzo, y no
  hay dos campos que puedan decir cosas distintas.

**Qué BAJA al panel de hoy: el contador.** Es el cambio que arregla el defecto medido, y el sitio
importa tanto como el número: **el contador estaba fuera del grupo que decía contar**, y por eso
pudo contar de más sin que chirriara. Dentro del panel, un contador que no case con la lista que
tiene debajo se ve a simple vista.

**El panel de otro día no lleva contador propio ni línea de encabezado.** Su conteo está en el nombre
de la pestaña (R8), y **cada card ya dice** qué es (badge «Para mañana») y desde qué día se podrá
(`avisoReservaParaOtroDia`, con la fecha). Una línea de grupo repetiría, palabra por palabra, lo que
ya está una vez por orden. Se descarta a propósito (§9, A10).

---

## 6 · El buscador y los contadores: **una sola regla para todo lo que cuenta**

**La regla:** *los contadores cuentan lo que el mensajero TIENE; el buscador sólo cambia lo que se
VE.* Vale para el contador de la cabecera (R16, comportamiento vigente de la 114) y para los dos
conteos de las pestañas (R20). Una sola frase para toda la pantalla, sin excepciones que aprender.

**El buscador filtra los DOS grupos** (R18), no sólo la pestaña activa. Es la decisión que la
alternativa A7 dejó abierta, y se decide así por un caso concreto y medible:

> El mensajero escanea o teclea una guía en el buscador y esa guía resulta ser de otro día. Si el
> buscador sólo mirase la pestaña activa, la pantalla respondería **«Ninguna guía por recoger
> coincide con la búsqueda»** — que es **falso**: la guía está, en la otra pestaña, y él la tiene en
> la mano. Este repo tiene escrita la familia entera de ese fallo: *el sistema no falla, aparenta*.

**Y cuando la pestaña activa se queda sin coincidencias, se dice DÓNDE está** (R11/R21), con el
nombre de la otra pestaña y cuántas hay. El cambio de pestaña lo hace el mensajero, pulsando la
pestaña que tiene a un centímetro con su conteo al lado; la pantalla **no** salta sola (R13, y §9
A6: una pestaña que cambia mientras tecleas es una pestaña que se mueve bajo el pulgar).

**Textos, y por qué se distingue «órdenes» de «coincidencias»:**

| Situación de la pestaña activa | Mensaje |
| --- | --- |
| Vacía, sin búsqueda, pestaña de hoy | `No hay órdenes por recoger hoy.` |
| Vacía, sin búsqueda, pestaña de otro día | `No hay órdenes para otro día.` |
| Vacía, con búsqueda (las dos pestañas) | `Ninguna guía por recoger coincide con la búsqueda.` *(literal existente, se reutiliza)* |
| …y en la otra hay algo, **sin** búsqueda | + `Hay 2 órdenes en «Para otro día».` / `Hay 1 orden en …` |
| …y en la otra hay algo, **con** búsqueda | + `Hay 2 coincidencias en «Para recoger hoy».` / `Hay 1 coincidencia en …` |

Sin búsqueda el número es **lo que hay**; con búsqueda es **lo que casó**, y por eso las dos frases
no usan la misma palabra: decir «2 órdenes» mientras se filtra sería un número que no corresponde a
nada que el mensajero pueda ver. Las dos concuerdan en singular y plural (R29) — que es justo lo que
el literal viejo del contador no hace (pregunta abierta **Q1**).

---

## 7 · Estado de UI: dónde vive y por qué no va a la URL

Tres piezas de estado, **todas efímeras, de un solo consumidor y puramente de presentación**: la
pestaña activa, el texto de la búsqueda y la vista mosaico/detalle. Viven en `RecogerModule` con
`useState`, exactamente como ya viven hoy las otras dos.

- **No suben a la URL.** Es el criterio que la pantalla ya aplica a `vistaCards` y a `query`, escrito
  en el propio componente. Un `?tab=` obligaría a decidir qué pasa con un valor inválido, a
  sincronizar con `router.refresh()` y a mantener una superficie de entrada que nadie enlaza.
- **Sobreviven al refresco** que dispara una recogida exitosa (R14): `router.refresh()` re-renderiza
  con datos nuevos **sin desmontar** el árbol cliente. Se prueba con un `rerender` de props.
- **Los paneles NO se mantienen montados** al cambiar de pestaña (`keepMounted` **desactivado**): no
  hay nada dentro de un panel que valga la pena conservar —la búsqueda, la vista y el conteo viven
  fuera— y mantener los dos montados dejaría en el DOM **dos listados a la vez**, que es la puerta de
  los nombres accesibles duplicados (§8). Es la decisión opuesta a la de `NovedadesTabs`, y por un
  motivo concreto: allí cada panel tiene **paginación propia por Server Action** que debe sobrevivir
  (102/R12); aquí no hay estado por panel.

---

## 8 · Accesibilidad

- **Nada depende del color** (R27). La primitiva `components/ui/tabs.tsx` ya distingue la pestaña
  activa por **peso de fuente y sombra** además del relleno, y expone `aria-selected`. El conteo va
  **en el texto de la pestaña**, no en un punto de otro tono: es la misma decisión que el repo tomó
  para el badge «Para mañana» («con palabras y no sólo con color: el repo tiene guardia de contraste
  y una lección escrita sobre medir color en el navegador»).
- **Nombres accesibles, los tres distintos** (R28): la región sigue siendo `Por recoger`; el `tablist`
  se llama `Grupos de órdenes por recoger`; el buscador conserva su `Buscar guías por recoger`. Los
  tres se leen distinto a propósito — si coincidieran, el nombre accesible de uno chocaría con el de
  otro, que es el motivo por el que el buscador ya tiene región y etiqueta distintas.
- **Los dos listados se llaman distinto**: el del grupo de hoy conserva `Órdenes por recoger` (el que
  tiene hoy, y que varios tests usan para localizarlo) y el de otro día recibe `Órdenes para otro
  día`. Sin esto, saber en qué grupo estás dependería de mirar cuál pestaña se ve resaltada.
- **Panel asociado a su pestaña.** Se espera que `@base-ui/react/tabs` lo cablee solo
  (`aria-labelledby` de `Tabs.Panel` → `Tabs.Tab`). **No se da por hecho:** el test de R28 lo afirma
  sobre el DOM renderizado y, si la primitiva no lo hace, se añade explícitamente en el consumidor.
- **El anillo de foco no se toca** (R34): tiene ficha propia (226). Lo que la primitiva ya trae
  (`focus-visible:ring-3`) se hereda tal cual.

---

## 9 · Alternativas descartadas

**A1 · Una pantalla nueva (ruta + entrada de menú) para las órdenes de otro día.** Descartada, y
además está descartada de entrada por la ficha. El portal del mensajero tiene tres pantallas y este
grupo tiene **masa 1** (medido en producción el 2026-08-24). Una cuarta entrada de menú para una
orden es coste permanente por un problema temporal; y el precedente contrario está escrito en la 102,
donde una superficie nueva entró **como pestaña** de una pantalla que la tienda ya visitaba.

**A2 · Ocultar o plegar las órdenes de otro día en el mismo listado.** Descartada: viola `R23` de la
246, que esta ficha declara **vigente e intocada**. Y repite el fallo que abrió la 167.

**A3 · Un conmutador «ver también las de otro día» (interruptor, no pestañas).** Descartada: un
interruptor apagado **no dice cuántas hay al otro lado**. La diferencia con las pestañas no es
estética: R8 (el conteo siempre a la vista, sin interactuar) es lo que sostiene que aquí no se
esconde nada, y un interruptor no lo puede cumplir sin convertirse en una pestaña con peor nombre.

**A4 · Seleccionar automáticamente la pestaña que tenga órdenes.** Descartada: la pantalla cambiaría
de puerta según el día, y un mensajero que aprendió «lo mío está en la primera» se encontraría otra
cosa sin haber tocado nada. Entrada fija y predecible (R12), con el vacío explicado y señalado
(R10/R11). Se deja abierta como **Q3** por si el humano lo lee al revés desde la calle.

**A5 · Que el buscador mire sólo la pestaña activa.** Descartada: es la que produce el «ninguna guía
coincide» **falso** sobre una guía que el mensajero tiene en la mano (§6). Sería además incoherente
con los controles de recogida, que sí resuelven contra el grupo completo desde la 96.

**A6 · Cambiar de pestaña automáticamente cuando la activa se queda sin coincidencias.** Descartada:
al teclear progresivamente, la pestaña saltaría y volvería con cada carácter. Se prefiere decirle
dónde está y dejar que pulse (R11/R13).

**A7 · Dos buscadores, uno por pestaña.** Descartada: duplica un control, obliga a teclear dos veces
la misma guía y crea dos estados que pueden divergir. Un solo campo, aplicado a los dos grupos.

**A8 · Que los conteos de las pestañas sigan a la búsqueda.** Descartada: rompería la única regla de
§6 y dejaría la pantalla con dos clases de contador —uno que sigue al filtro y otro que no— sin
ninguna señal que diga cuál es cuál. El dato «cuántas casaron al otro lado» sí se da, pero donde se
necesita y llamándolo por su nombre («coincidencias»).

**A9 · Llevar la pestaña activa a la URL (`?tab=`).** Descartada: §7. Estado efímero de presentación,
de un solo consumidor, con el precedente ya sentado en esta misma pantalla.

**A10 · Una línea de encabezado en el panel de otro día explicando el grupo.** Descartada: repetiría
por grupo lo que `avisoReservaParaOtroDia` ya dice **por orden y con su fecha** — y la fecha por
orden es más cierta que cualquier frase de grupo, porque el grupo puede ser mixto.

**A11 · Que el servidor devuelva ya los dos grupos separados (DTO nuevo con dos listas).** Descartada
y con nombre: es exactamente el «segundo origen de verdad» que la propia pantalla se escribió para
evitar («Lee la MISMA action que Reparto […] no hay contrato nuevo ni un segundo origen de verdad que
pueda divergir»). Además rompería la ficha por dos sitios: obliga a tocar backend (R30) y a que los
controles de recogida recompongan la lista completa para poder seguir resolviendo cualquier guía. La
partición es una decisión de **presentación** y se queda en la presentación; el **dato** —que es lo
que no se puede derivar en el cliente— sigue viniendo del servidor (R4).

---

## 10 · Los dos tests existentes que CAMBIAN, y qué hay que conservar de ellos

Esto es lo más delicado de la implementación. **Dos tests verdes hoy afirman lo contrario de lo que
esta ficha decide**, y son la trazabilidad de requisitos de **otras** fichas:

| Test | Qué afirma hoy | Qué pasa |
| --- | --- | --- |
| `RecogerModule.test.tsx` → «**R23**: la orden reservada APARECE en su grupo de siempre — no se oculta ni se mueve» | Con **una sola** orden reservada: está en la región del listado **y** el banner dice `1 Órdenes nuevas asignadas`. | Cambia. Con R15/R17 no hay banner (0 de hoy) y la orden vive en la otra pestaña. |
| `RecogerModule.test.tsx` → «**R9**: y la reservada SIGUE en su grupo, contada y visible» (261) | Lo mismo. | Cambia. |

**Qué NO se puede perder al reescribirlos** —y esta es la instrucción para el implementer—: los dos
existen para probar que **la orden no se esconde**. Esa propiedad **no se debilita**, se hace más
fuerte y más explícita. Cada uno debe seguir afirmando, en su nueva forma:

1. que la orden **está en la pantalla** (pestaña «Para otro día», conteo `(1)` visible **sin
   interactuar**);
2. que llegar a ella cuesta **una sola pulsación**, sin buscarla;
3. que sigue llevando su marca «Para mañana» y su aviso con la fecha;
4. que **sigue habiendo por dónde recoger** (los controles montados), que era el `accesoRecogida()`
   del test original.

El comentario de cada test debe decir **de qué ficha viene** (246/R23 y 261/R9) y **por qué cambió de
forma** (esta ficha, 2026-08-24), no borrar la referencia. Un test que cambia sin dejar dicho por qué
es un requisito que se pierde en el siguiente rename.

⛔ **Lo que no vale:** borrarlos, ni relajarlos a un `queryByText(...)` que pase por vacío. Este repo
tiene la lección escrita («El test que vive dentro de lo que borras» y «Literal: contrato o
polizón»).

---

## 11 · Interacción con las guardias del arnés

- **`tests/unit/guards/d5-revertida.guardia.test.ts` censa el árbol ENTERO**
  `app/(app)/mis-asignaciones/**` y **revienta en rojo** si aparece cualquiera de las seis frases que
  afirmaban D5 como vigente, incluso partidas en varias líneas dentro de un JSX. El archivo nuevo y
  los comentarios nuevos **no pueden** contener, ni parafrasear con esas palabras: *«no oculta ni
  bloquea nada»*, *«protege del CRON, no del mensajero»*, *«protege del corte de la noche, no del
  mensajero»*, *«puede recoger y gestionar igual»*, *«que la medición M3 cerró»*.
  Formulación correcta para el comentario de la partición: «la reserva protege del corte **y también
  del mensajero**; lo que esta ficha cambia es **dónde** vive la orden, no si se ve».
- Esa misma guardia comprueba que `db/schema.prisma` sigue declarando `fecha_reparto` igual. Como
  esta ficha no toca el esquema, **debe seguir verde sin tocarla** (evidencia de R30).
- El resto de guardias no vigilan esta superficie, pero **corren siempre** en el gate: no se
  seleccionan por grafo de imports.

---

## 12 · Verificación

- **Gate:** `./init.sh --rapido`. El diff **no** toca migraciones, `db/schema.prisma`, `lib/types/`,
  configuración de build ni archivos con nombre de dinero, así que el modo rápido no debería negarse.
  **Si se niega, es un `fail`**: se corre el completo, no se discute.
- **Comprobación de que los tests nuevos no están verdes por vacíos** (obligatoria, T11): mutar
  `esParaManana === true` a `!== true` en `separarPorDia` y confirmar que **la suite se pone roja**,
  nombrando qué tests caen. Este repo tiene medido cuatro veces seguidas que una suite puede
  sobrevivir a una mutación del predicado que dice probar.
- **`./init.sh` completo** tras el merge a `dev`, como siempre.
