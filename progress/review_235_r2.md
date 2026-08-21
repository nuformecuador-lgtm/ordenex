# Re-revisión — Feature 235 · Ayuda a la tienda: estatus propio

> Rama `feature/235-ayuda-tienda-estatus`, commit **0fb7c397**. Acta del rechazo anterior:
> `progress/review_235.md` (sobre `29310f74`), que **no se toca**.
>
> Alcance: **los tres commits nuevos** (`db23911b`, `e366e57c`, `0fb7c397`) y nada más. El núcleo ya
> lo verifiqué en la primera vuelta con seis mutaciones propias y lo di por bueno; solo he vuelto
> sobre lo que lo nuevo toca.
>
> **Árbol medido antes y después: limpio.** Los ocho archivos que muté vuelven a su sha256 exacto
> (tabla en §6). No corrí `./init.sh` — el gate completo es del leader, con el árbol quieto.

---

## Veredicto

# OK

**0 bloqueantes.** Los cuatro del rechazo están cerrados y lo he verificado yo, no leído: cada uno
con su mutación aplicada de una en una y con la salida real de vitest delante.

Se levanta el rechazo. Queda **T8.3** (gate completo `./init.sh` con el árbol quieto + PR), que es lo
único sin marcar en `tasks.md` y que por definición no puede marcarse antes de hacerse.

### Qué queda FUERA, y con qué remite

| Lo que no entra | Remite a | Estado |
| --- | --- | --- |
| La **lectura del hilo del lado tienda** (hoy la tienda ve que le piden ayuda y **no puede leer el motivo**) | **236** | Enmienda de R35 escrita y fechada el 2026-08-19, con dueño y condición de reapertura |
| La **pestaña propia y la card** de `/novedades` (hoy la orden en ayuda aparece bajo «En devolución», con un subtítulo que no es cierto de ella) | **236** | Medido en pantalla en T8.1; ⚠️ **la 235 y la 236 salen juntas o seguidas** |
| Las **gestiones desde ayuda** y la invariante «una orden en ayuda bloquea el cierre», falsa en las dos rutas de re-solicitud | **237** | Documentado en tres sitios; no es defecto de esta ficha |
| El rechazo manual de la tienda y la guardia del botón «Notas» | **240** | Fuera de alcance declarado |
| Las guardas de bloqueo retiradas en `6a0e6d36` | **241** | Fuera de alcance declarado |

**Menores que sobreviven y salen con la ficha:** m1, m2, m3, m6, m7, m8, m9 del acta anterior, más
cinco nuevos (N1–N5) que abro abajo. **Ninguno bloquea.** De **m2** y **N1** pido una línea escrita
antes del PR, y digo por qué en §5.

---

## 1 · B1 y B2 (`db23911b`) — CERRADOS

### La guardia: ¿lee el fuente o se mira al espejo?

**Lee el fuente.** No es una afirmación de la bitácora: lo medí.

`tests/unit/guards/carga-del-mensajero.guardia.test.ts` entra por `codigoSinComentarios(rel)` →
`readFileSync` sobre la ruta relativa a la raíz del repo (`tests/fixtures/sin-comentarios.ts:104`).
No importa ninguna de las siete constantes. Tres de ellas son `const` privadas de módulo y tres son
literales en el sitio de la llamada, así que importarlas no era ni posible sin exportarlas.

**La prueba, no el argumento:** muté **tres fuentes distintos**, uno a uno, y en los tres la guardia
se puso roja **imprimiendo el contenido mutado**, que es lo que un espejo no puede hacer:

```
AssertionError: la regla de dedicación de la 157 (`ESTADOS_REPARTO_PENDIENTE`)
(lib/services/GuiaAsignacionService.ts) NO nombra `ayuda_tienda`.
```
```
AssertionError: expected [ 'ayuda_tienda', 'en_reparto' ] to deeply equal [ 'en_reparto' ]
```

### Anti-vacuidad: sí, y en cuatro capas

1. **`reventar(...)` corta en seco.** Ninguna extracción devuelve `[]` como si fuera «no hay
   infracciones»: si el patrón no casa, si la lista sale vacía, si un identificador no se declara con
   un literal, si la llamada ya no recibe un array — la guardia **lanza** con el archivo y el nombre.
2. **Censo cerrado por número.** `expect(FAMILIA).toHaveLength(7)`.
3. **Los valores tienen que ser estatus reales del catálogo** (`ORDER_STATUS_SEED`), así que una
   extracción que devolviera basura sintáctica muere antes de que ninguna decisión diga nada.
4. **Autocomprobación explícita**, y de las dos clases: el caso «REVIENTA si el patrón deja de
   encontrarse» (7 aserciones sobre fuentes falsos) **y** la CONTRAPRUEBA «sobre un fuente MUTADO el
   detector devuelve lo mutado» (4 aserciones), que es justo lo que distingue leer de recitar.

Y **casos negativos de verdad**: `por_recoger` NO puede entrar en las listas del corte (109/R5), y
ningún miembro puede nombrar un desenlace (`entregada`, `rechazada`, `devuelta_a_tienda`,
`incidente`). Sin ellos, «incluye `ayuda_tienda`» pasaría con una lista que trajera el catálogo
entero.

Los **tres cruces de gemelos** son los que importan, porque son exactamente donde vivieron B1 y B2:
servicio ↔ selector, selección del corte ↔ ids que el service resuelve, portal ↔ bloqueo del cierre.
Los dos primeros mueren en mis mutaciones 1, 2 y 4.

### El test de B1 mide desde `ejecutarCorte`, que es lo que exigí

`tests/unit/services/corte-diario-seleccion.test.ts` monta `CorteDiarioService` sobre el
**`CorteDiarioRepository` REAL**, y ese repositorio sobre un doble de Prisma **con semántica**: el
`orden.findMany` aplica de verdad el `where` que recibe sobre un conjunto de filas (`deletedAt`,
`mensajeroAsignadoId`, `estatus.value` como igualdad **o** como `in`, y el `distinct`). No es un
doble que devuelve lo que le dictan.

La rama (a) (`gestionOrden.findMany`) devuelve `[]` **a propósito y con su razón escrita**: pedir
ayuda no crea `gestion_orden`, así que el mensajero de la regresión solo puede entrar por (b).

Medido: **mutación 2** (volver `ESTADOS_A_BARRER` a `["en_reparto"]`) pone en rojo, entre otros:

```
× le CREA su cierre `vencido` y le pasa los ids del barrido (EL CASO DE LA REGRESION)
  AssertionError: expected { mensajerosEvaluados: +0, …(2) } to deeply equal { mensajerosEvaluados: 1, …(2) }
× los dos a la vez: dos mensajeros, dos cierres
  AssertionError: expected 1 to be 2
```

El fallo se manifiesta **como 0 mensajeros evaluados y `crearCierre` no llamado**, que es exactamente
la forma que tenía en producción y la que el test viejo (`crearCierre` a mano) no podía ver. El caso
negativo (`por_recoger` no entra) y el de la orden borrada están, así que un `where` que trajera
cualquier fila no pasaría.

### El hallazgo nº 7, que nadie pidió buscar

`ESTADOS_EN_MANO_DEL_MENSAJERO` (`GestionOrdenRepository`) pasó de `!= en_reparto` a
`notIn [en_reparto, ayuda_tienda]`. La bitácora argumenta —y el razonamiento se sostiene— que el
conjunto era **vacío por alcanzabilidad** (`deshacerGestion` anula la gestión y `gestionDelDia` exige
`anuladaAt: null`), y que se amplía igual porque la 237 abre aristas. Correcto: «vacío hoy» es justo
el argumento que ese `where` dice en su propio comentario no querer usar. Mutación 3 → 3 rojos.

**B1 y B2: cerrados.**

---

## 2 · B3 / R35 (enmienda humana) — CERRADO

La enmienda está en `specs/235-ayuda-tienda-estatus/requirements.md`, bajo el título
`## RECONCILIACIÓN DE R35 TRAS LA REVISIÓN — 2026-08-19`. Comprobada punto por punto contra lo que mi
acta anterior exigió:

| Lo que pedí | ¿Está? |
| --- | --- |
| Escrita | ✅ 28 líneas al final del requirements, con título propio |
| Fechada | ✅ 2026-08-19, en el título |
| Que diga cómo se lee R35 desde hoy | ✅ *«el rol que tiene ventana de escritura … debe tener dónde ejercerla; para el mensajero se entrega en esta ficha, y para el `adminTienda` es la pestaña de la 236»* |
| Que diga **qué se acepta mientras tanto** | ✅ *«La tienda ve que hay una solicitud de ayuda y no puede leer el motivo»*, con la nota de que **esta ficha no lo empeora** (hoy tampoco se leía) y de que **tampoco lo arregla** |
| Que remita a la 236 | ✅ con **dueño y fecha de muerte**, y con condición de reapertura: *«si la 236 se retrasara, esto pasa a ser deuda visible en producción y hay que reabrir la decisión»* |
| Que el spec deje de contradecirse | ✅ nombra la contradicción por su nombre («la contradicción era del propio spec, no de la implementación») y la resuelve del lado del alcance ya declarado |

No es ambigua y no deja el requisito prometiendo lo que la ficha no entrega. **La superficie del
mensajero sí existe y está trazada** (`235/R35: desde la card se abre el HILO…`), así que bajo la
lectura enmendada R35 queda cubierto.

Único reparo, cosmético: **la línea 179 —el texto de R35— sigue intacta y sin puntero a la enmienda**
(N5). Quien lea R35 y pare ahí lee la promesa vieja.

---

## 3 · B4 / `tasks.md` 38 de 39 — CERRADO

La única sin marcar es **T8.3** (gate completo + PR), y es correcto que lo esté: es lo último que
corre el leader y marcarla antes sería mentir. Comprobé las dos que exigí ver de verdad:

### T0.1 — la medición de P6, pegada y fechada ✅

Está en **dos sitios**: `progress/impl_235.md` (§0) y en la propia casilla de `tasks.md`. Trae lo que
pedí y algo más:

- el número (**0 órdenes con `orden.ayuda = true`**), la fecha (**2026-08-19**), quién (el leader),
  cómo (**MCP de Supabase, solo lectura**) y contra qué (**producción**);
- la **consulta literal** para repetirla (`SELECT count(*) … GROUP BY os.value`);
- la caducidad dicha con esas palabras: *«la foto sigue caducando; si el despliegue se retrasa, se
  vuelve a medir»*, y qué pasaría si algún día no diera vacío (haría falta el script **antes** de la
  migración del retiro);
- y el precedente de por qué no pudo cerrarla el implementer (el MCP no llega a un subagente).

Cierra P6 como *grandfather* y con ello T6.4-(a). Coherente.

### T8.1 — «ver la app» ✅, y lo que afirma **cuadra con el código**

`progress/recorrido_235.md` no es una lista de expectativas: es texto leído del navegador, con los
dos roles y el OTP de la tienda resuelto. Verifiqué contra el código las afirmaciones verificables, y
**ninguna se contradice**:

| Lo que el recorrido dice que vio | Contra el código |
| --- | --- |
| Los 4 KPI **no bajan** al pedir ayuda (`Pendientes 3`, `Por cobrar ₡45.257`) | ✅ `MisAsignacionesService:250-253`: `enManoDelMensajero = [...porGestionar, ...conAyuda]` y los tres KPI se derivan de la unión, con P7/R20 escrito al lado |
| La orden **sale del listado** (3 → 2) y aparece **una sola vez** abajo | ✅ el bucle del servicio es un `if/else if/else if` por `estatusValue`: tres acumuladores disjuntos |
| Desaparece **del mapa de ruta**, no solo su card | ✅ `conAyuda` se empuja **sin `secuenciaRuta`** (`:207-210`) y `paradasSinOptimizar` se calcula solo sobre `porGestionar` (`:227`) |
| La sección **desaparece entera** al vaciarse | ✅ `{conAyuda.length > 0 ? <section …> : null}` (`RepartoModule.tsx:795`) |
| `/novedades` muestra el chip **«Ayuda solicitada»** | ✅ `NovedadesModule.tsx:150` |
| La tienda **NO tiene** acción de leer el hilo | ✅ `HiloNotasNovedadModal` sigue sin montar; es lo diferido a la 236 |
| «Habilitar» devuelve la orden a `en_reparto` y sale de Novedades | ✅ punto único de rescate, ya verificado en la primera vuelta |
| §9: la orden en ayuda aparece bajo la pestaña **«En devolución»** | ✅ `NovedadesTabs.tsx:18` — `TAB_NOVEDADES_LABEL = "En devolución"`. Observación **correcta** y correctamente atribuida a la 236 |

Los dos defectos que el recorrido dice haber encontrado son reales y están arreglados en el mismo
commit, con test. **Nada se declara visto que el código contradiga.**

Apunto lo que hace bien y no le pedí: documenta los **dos muros** para llegar a la primera pantalla
(cliente Prisma rancio disfrazado de 404; el OTP legible **solo si la salida del servidor va a un
archivo**, no por tubería). Eso vale más que el recorrido mismo.

**Las demás casillas marcadas:** T6.3 (migrar/revertir contra el motor) y T8.2 (los tres documentos
con su nota fechada) ya las había verificado en la primera vuelta; T3.4 lleva ahora escrita, en su
propia casilla, la nota de que **se quedó corta y la revisión la cazó**, que es exactamente lo que
una lista de tareas honesta debe conservar.

---

## 4 · m4 (`e366e57c`) y lo nuevo de T8.1 (`0fb7c397`)

### R25, ¿queda bien trazado? — **Sí**

`tests/components/RepartoAyuda.test.tsx :: 235/R25: bloqueado por cierre, «Recuperar» sigue pulsable
y llega hasta la Server Action`. Lo importante es que **no se conforma con la ausencia del
atributo**, y son tres pasos encadenados:

1. `expect(screen.getByRole("alert")).toBeInTheDocument()` — **el bloqueo llegó de verdad al
   módulo**. Sin esto el caso quedaría verde aunque la prop `bloqueado` se ignorara, y no probaría
   nada. Esta es la aserción que lo salva de la vacuidad.
2. `expect(recuperar).not.toBeDisabled()`.
3. El click **hasta la Server Action** (`recuperarMock` llamado con `{ ordenId: "g2" }`) y el
   `router.refresh()`. Un permiso ejercitable, no un atributo ausente.

Reproduje la mutación del leader (**reponer la prop en el componente Y pasarla desde la card**, las
dos cosas: solo una no reproduce el defecto porque la prop ya no existe) y el caso **muere**:

```
× 235/R25: bloqueado por cierre, «Recuperar» sigue pulsable y llega hasta la Server Action
Error: expect(element).not.toBeDisabled()
Received element is disabled:
```

R25 tenía antes un solo test del lado servicio; ahora tiene también el de la pantalla, que es donde
el permiso se negaba. **Trazabilidad de R25: correcta.**

### El comentario que justifica la excepción — **su premisa es falsa** (N1, menor)

El comentario dice:

> *«este botón NO recibe `disabled={bloqueado}`. **El resto de la card SÍ está bloqueada** (el
> `bloqueado` de arriba apaga su gate de selección, feature 111/R14)…»*

Lo comprobé y **no es así en esta card**:

- `renderCardConAyuda` **no pasa `onGestionar`** (la card perdió «Gestionar» a propósito, y su propio
  JSDoc lo explica).
- `posSeleccionHandlers` calcula `seleccionable = Boolean(onGestionar) && !bloqueado`. Sin
  `onGestionar`, eso es `false` **venga lo que venga en `bloqueado`**.
- `PosOrderCardDetalle` **no usa `bloqueado` para nada más** (solo lo reenvía a
  `posSeleccionHandlers`). Y el otro botón del slot, «Conversación», tampoco está gateado.

Conclusión: **nada de esta card está bloqueado por `bloqueado`**, y la prop `bloqueado={bloqueado}`
de la línea 502 es **inerte**. La premisa de que «el resto sí está bloqueado» no sostiene la
excepción — la excepción se sostiene sola, por R25 y por el deadlock de `rescate-ayuda.ts`, que es el
argumento bueno y también está escrito.

La misma afirmación se repite en `progress/impl_235_m4.md`. Lo que allí se comprobó
(«`PosOrderCardDetalle` usa `bloqueado` solo para el gate de selección») es **cierto**; lo que no se
vio es que en esta card ese gate ya estaba apagado por otra vía.

Es un **comentario, no código**, y no cambia ninguna conducta. Pero **justifica una decisión con un
hecho falso**, y quien lo lea creerá que hay un bloqueo vigente donde no lo hay. Gravedad: **menor**,
con una línea de arreglo (corregir el paréntesis, o quitar la prop inerte).

### El caso de R15: ¿el contraste aguanta? — **Sí, lo maté por los dos lados**

- **Mutación 7** (quitar `mostrarRuta={false}`): rojo por la **primera** aserción —
  `expected <span data-slot="badge" …> to be null`.
- **Mutación 8, la que se me pidió juzgar** (apagar «Pendiente de optimizar» **en todas partes**,
  sobre `PosOrderCardMosaico`, que es la vista por defecto del listado de arriba): rojo por la
  **tercera** — `TestingLibraryElementError: Unable to find an element with the text: Pendiente de
  optimizar`.

O sea: **no se puede pasar en verde apagándola en todas partes.** El contraste está bien montado.

Una fragilidad que anoto sin contarla como hallazgo: la sección de ayuda está **anidada dentro** de
la región «En reparto / por gestionar» (`RepartoModule.tsx:611` envuelve a `:796`), así que
`within(listado)` es un **superconjunto** que incluye la sección de ayuda. El caso sigue siendo
correcto —las dos primeras aserciones fijan la sección de ayuda en cero, y `getByText` reventaría con
dos coincidencias— pero es robusto **por conjunción, no por aislamiento**.

### El comentario largo de `mostrarRuta={false}` — **es correcto**, y el tirón no prospera

La sospecha era que «Gestionar más tarde» no está en esta card. Lo medí:

- En `PosOrderCardDetalle` hay **dos** cosas con ese nombre y solo una está aquí en juego:
  - la **`<Badge variant="warning">Gestionar más tarde</Badge>`** (línea 114-116), gobernada por
    `orden.marcarLuego` y **con condición independiente de `mostrarRuta`**;
  - el **toggle** `MarcarLuegoToggle`, que es un control y se monta desde `RepartoModule:445`, en el
    slot `acciones` de la card **normal**.
- La card de ayuda **sí lleva la badge**: recibe el DTO entero y el servicio pone `marcarLuego` en
  los **tres** acumuladores (`MisAsignacionesService:197-201`, antes del reparto por estatus). Lo que
  no monta es el **toggle**.

El comentario está enumerando **qué NO apaga la prop**, y para esa lista «Gestionar más tarde» es
correcto **en esta card**, no solo en el componente en general. La bitácora es incluso más precisa:
dice literalmente *«el badge «Gestionar más tarde» (`orden.marcarLuego`, condición independiente)»*.

**Veredicto sobre el tirón: el comentario no induce a error de hecho, solo de lectura rápida.** Le
sobra una palabra («el badge») para ser inequívoco. **No lo cuento como hallazgo**; lo digo por si se
toca el archivo por otra cosa.

### El rótulo «En ayuda» y su color — coherente, con un reparo (N2, menor)

Lo bueno, dicho con nombre porque el argumento de la bitácora se sostiene:

- **La gramática encaja.** `PosEstado` es «En gestión / En detalle / En reparto / Por recoger»:
  preposición + sustantivo. «En ayuda» no es un cuerpo extraño.
- **El chip antes mentía**, y no de forma decorativa: para los otros tres valores describe la
  situación de la orden, y aquí afirmaba justo lo que la ficha volvió falso, a un palmo de un
  encabezado que dice lo contrario. Arreglarlo era necesario.
- **La familia de color es la correcta.** `EstatusBadge` ya asignó `ayuda_tienda: "warning"` con su
  razón escrita («espera con acción pendiente», ni `danger` ni `info`), y el encabezado de esta misma
  sección usa `text-warning-strong`. `bg-warning text-navy` es **fijo-sobre-fijo**, que es la regla
  de `DESIGN.md` para chips sólidos, y el 8.1:1 no es un número inventado: está medido y escrito en
  el comentario de `ESTADO_CLASSNAME` para **ese mismo par**.

El reparo, que es donde el argumento afloja:

- El color **no se declara: se hereda del fallback**, y ese fallback está documentado como *«cae a
  las de "En reparto" **si es un texto libre**»* — es decir, su significado es *«no sé qué es esto»*.
  Apoyar una decisión de diseño en la rama del desconocido hace que la decisión y el accidente se
  lean igual.
- **Ningún test fija la clase del chip.** Si alguien cambia la entrada `"En reparto"` de
  `ESTADO_CLASSNAME`, «En ayuda» se mueve con ella **en silencio**.
- El argumento de no declararla («sería un duplicado literal del fallback») va justo en contra del
  hábito que esta misma ficha impuso doce horas antes, en el mensaje de fallo de su propia guardia:
  *«una ausencia sin razón escrita es un olvido»*.
- Matiz de exactitud: `Badge variant="warning"` es `bg-warning-soft text-warning-strong` (suave), no
  `bg-warning text-navy` (sólido). Son la **misma familia**, tratamientos distintos. La frase «es la
  que `EstatusBadge` ya asignó» es cierta a nivel de familia, no de clase.

**Coste del arreglo: una línea** (`"En ayuda": "bg-warning text-navy"` en `ESTADO_CLASSNAME`).
**Gravedad: menor.** No bloquea.

Observación aparte, sin gravedad: el estatus tiene ya **tres cadenas visibles distintas** —«Ayuda
solicitada a la tienda» (`/ordenes`), «Ayuda solicitada» (`/novedades`) y «En ayuda» (chip de la
card)—. Cada una está justificada **en su sitio** y las tres comparten la palabra; lo dejo anotado
para que la 236, que toca la card de la tienda, no invente una cuarta.

### `235/R37`: ¿requisito correcto o prestado? — **correcto**

R37 dice, literal: *«clasificar el estatus de ayuda de forma explícita en **TODAS** las superficies
que enumeran estados de orden: **etiqueta y color visibles**, hito del rastreo público, …»*.

- El chip **es** una superficie que enumera estados de orden: su vocabulario incluye «En reparto» y
  «Por recoger», que son estados de orden, y pinta **etiqueta y color visibles**. Cae dentro del
  «TODAS» que el propio requisito escribe.
- Las seis superficies nombradas tras los dos puntos **no** incluyen la card del mensajero, así que
  esto es R37 leído por su cláusula universal y no por su enumeración. Es legítimo: la enumeración va
  después de un «TODAS», no en su lugar.
- **Y no es el patrón de m7.** El defecto de m7 era un requisito **sin aserción propia** que se
  acreditaba con el test de otro. Aquí R37 ya tiene sus tests directos (`EstatusBadgeCatalogoV2`,
  `OrdenesExcludePorRol`, `estados-bodega-satelite`, `buckets-estatus`); este caso **añade** una
  superficie, no sustituye a una ausente.

**No repite m7.** Único apunte de papeleo: los dos casos nuevos no se añadieron a la tabla
`R<n> → test` de `progress/impl_235.md` (N4).

---

## 5 · Los menores que abrí y no se arreglaron — ninguno se volvió bloqueante

- **m1 · el caso de R22 no prueba R22.** Sigue igual. **No bloquea**, y el motivo es el mismo que ya
  medí: R23 lo cubre con un `toEqual` leído de la llamada real al repo, y esa aserción **sí muere**
  al sacar `ayuda_tienda` de la lista. El caso mal nombrado es ruido, no un hueco.
- **m2 · el buscador y el filtro no alcanzan la sección de ayuda.** **Sigue vivo**, verificado en el
  código de hoy: `conAyuda` se pinta **crudo** (`RepartoModule.tsx:795-813`), fuera de
  `porGestionarVisual` — que es donde viven el buscador (114), el filtro cantón/distrito (117) y el
  reordenado. Efecto visible, leído del código: al buscar una guía que está en ayuda, arriba sale
  `SIN_RESULTADOS_REPARTO` («Ninguna guía en reparto coincide con la búsqueda») y **debajo la sección
  entera sin filtrar**.

  **Mi juicio, que es lo que se me pidió:** la dejaría salir, **pero no en silencio**. Sigue siendo
  **menor** —la dirección es segura (muestra de más, nunca esconde), la sección es corta por
  naturaleza y el filtro es puro cliente—, así que no bloquea el merge. Pero es un **cambio de
  conducta de dos features ya entregadas (114 y 117)** que **nadie decidió**: no está en `design.md`,
  no está en la bitácora, no lo pide ningún R y **no hay test que fije ninguna de las dos
  conductas**. Hoy el repo **no puede distinguir «decidido» de «olvidado»** — que es, palabra por
  palabra, el modo de fallo que produjo B1 y B2 en esta misma ficha y contra el que se escribió la
  guardia nueva.

  👉 **Pido una línea escrita antes del PR** en `design.md` §6 (o en la bitácora, con fecha): «la
  sección de ayuda queda fuera del buscador y del filtro cantón/distrito, porque ⟨razón⟩», o la
  decisión contraria. Una línea, no código. **No lo convierto en bloqueante**: el leader decide si la
  escribe ahora o la manda a la 236, que es la que vuelve a tocar estas superficies.
- **m3 · el chip del chat pinta «Asignada».** Sigue. Cosmético y en la dirección segura. Anoto que
  ahora **choca un poco más**: el chip de la card sí se arregló a «En ayuda» y el del chat sigue
  neutro. Son dos superficies distintas y no lo subo de nivel; una línea en `estadoDe` lo cierra
  cuando alguien decida qué debe decir.
- **m5 · bitácora desactualizada.** La parte concreta que señalé (T8.2) está cerrada, pero
  `progress/impl_235.md` **§8 acumuló staleness nueva** y ahora afirma tres cosas falsas: que T0.3
  sigue sin anotar (está en `current.md`), que T8.1 no se hizo (se hizo) y que m4 sigue abierto (está
  arreglado). Ver **N4**.
- **m6 · R44 se apoya en una prueba manual no repetible.** Sin cambios. Aceptable con el precedente
  del repo; solo conviene decirlo así en la columna de trazabilidad.
- **m7 · R46 mapea a un test prestado.** Sin cambios, y **no se repitió** en los casos nuevos (§4).
  Riesgo real bajo: los tres mensajes son constantes sin interpolación.
- **m8 · R29 se acredita por una propiedad estructural.** Sin cambios, pero **más fuerte que antes**:
  cuando lo escribí, la objeción era que con B1 abierto había órdenes que **nunca pasaban por el
  corte**. Con B1 cerrado esa mitad de la objeción desaparece.
- **m9 · `HiloNotasAyudaModal` usa texto de carga, no skeleton.** Sin cambios y, como dije, **no lo
  cuento como defecto**: es consistencia con su gemelo.

### Menores nuevos que abro yo

- **N1 · el comentario de la excepción de R25 justifica con un hecho falso.** «El resto de la card SÍ
  está bloqueada» no es cierto: sin `onGestionar` el gate de selección ya estaba apagado, y
  `bloqueado={bloqueado}` en esta card es **inerte**. La excepción es correcta; su justificación
  escrita, no. Repetido en `progress/impl_235_m4.md`. **Una línea.** (Ver §4.)
- **N2 · el color del chip «En ayuda» viaja en el fallback y ningún test lo fija.** Una línea en
  `ESTADO_CLASSNAME`. (Ver §4.)
- **N3 · la guardia nueva vigila, pero no descubre.** El censo es **cerrado a mano**
  (`toHaveLength(7)`) y la guardia **no recorre el árbol** buscando una octava lista: solo sabe de
  las siete que alguien le declaró. Y `incluyeAyuda` es una bandera **dentro de la propia guardia**,
  así que quien quiera sacar el estatus de una lista puede voltearla (el mensaje de fallo le exige
  escribir la razón, pero nada lo obliga). El mensaje del commit dice «lo que impide la tercera vez»
  y eso es **más de lo que hace**: lo que impide es que **estas siete** se separen entre sí —que ya
  es mucho, los dos cruces de gemelos son exactamente donde vivieron B1 y B2— pero no cierra la
  puerta por la que entraron. La red real contra un **estatus nuevo** sigue siendo el
  `satisfies Record<OrderStatusValue, …>` de los mapas exhaustivos. Lo anoto para que **la 237 no se
  confíe**: si abre una lista nueva de esta familia, la guardia no la va a encontrar sola.
- **N4 · papeleo de bitácora.** Los dos casos de T8.1 no están en la tabla `R<n> → test` de
  `impl_235.md` (R15 y R37 sí tienen fila, así que la **trazabilidad no se rompe**); el §8 de
  `impl_235.md` afirma tres cosas ya falsas; `current.md` dice 39/39 y `tasks.md` va 38/39; y el
  aviso de T8.3 sigue diciendo «depende además de T8.1, que sigue abierta». Se cierra todo en la
  misma pasada del commit de T8.3.
- **N5 · R35 (línea 179) no apunta a su propia enmienda.** El texto original queda intacto y la
  reconciliación vive al final del archivo. Correcto como práctica (no se reescribe un documento
  firmado), pero merece un «→ ver RECONCILIACIÓN al final» pegado al requisito.

---

## 6 · Lo que corrí yo, con hash antes / mutado / después

Cada mutación: hash → mutar → **correr vitest y leer su salida real** → restaurar → hash. Aplicadas
**una a una**, nunca dos a la vez, y nunca en paralelo con nada. **Ninguna quedó aplicada.**

| # | Archivo | Mutación | sha256 base | sha256 mutado | Rojos |
| --- | --- | --- | --- | --- | --- |
| 1 | `lib/services/GuiaAsignacionService.ts` | `ESTADOS_REPARTO_PENDIENTE` pierde `ayuda_tienda` | `4e9c0f7d…` | `364f5092…` | **4** (2 guardia + 2 servicio) |
| 2 | `lib/repositories/CorteDiarioRepository.ts` | `ESTADOS_A_BARRER` vuelve a `["en_reparto"]` | `72003baa…` | `1789a2a7…` | **6** (2 guardia + 2 repo + **2 desde `ejecutarCorte`**) |
| 3 | `lib/repositories/GestionOrdenRepository.ts` | `ESTADOS_EN_MANO_DEL_MENSAJERO` pierde `ayuda_tienda` | `ba2cf651…` | `8b869406…` | **3** (1 guardia + 2 repo) |
| 4 | `lib/actions/ordenes-guia.ts` | `conRepartoIds` vuelve a dos estados | `67d80e3f…` | `99b77cfc…` | **4** (2 guardia + 2 integración) |
| 5 | `RecuperarAyudaButton.tsx` **+** `RepartoModule.tsx` | reponer la prop `disabled` **y** pasarla | `68dbfff2…` / `1cd40aba…` | `51dc973e…` / `8ca44d3b…` | **1** (`Received element is disabled`) |
| 6 | `RepartoModule.tsx` | fuera `estado={AYUDA_CARD_ESTADO}` | `1cd40aba…` | (no anotado) | **1** (`235/R37`) |
| 7 | `RepartoModule.tsx` | fuera `mostrarRuta={false}` | `1cd40aba…` | (no anotado) | **1** (`235/R15`) |
| 8 | `pos-card/PosOrderCardMosaico.tsx` | «Pendiente de optimizar» apagada **en todas partes** | `f3176dea…` | (no anotado) | **1** (`235/R15`, por la tercera aserción) |

> En 6, 7 y 8 no anoté el hash del árbol mutado; sí el de base y el de restauración, que coinciden.

**Hashes al cerrar, idénticos a los de la línea base:**

```
4e9c0f7d62c8ef4c37d5b1d45db703c6802cf65b476a7ab88ffbe039d1f965a8  lib/services/GuiaAsignacionService.ts
72003baab2d69c4637570528d5baf47b7c20a5358b4a3b65e4c06386b9db7d6b  lib/repositories/CorteDiarioRepository.ts
ba2cf6511f2271a82f6d571d74bda3f3222d248f5ed61990f7d523e3689be032  lib/repositories/GestionOrdenRepository.ts
67d80e3f6c423bdb5d17310442d1fef21d58b488698ddf34622c8d6fd50a7064  lib/actions/ordenes-guia.ts
1cd40aba95d5155f60c73815e65a1e72f9f5e375eee81eae21eedf4812d2c9a5  app/(app)/mis-asignaciones/_components/RepartoModule.tsx
68dbfff2de0547f06ba62ff60327c2696b2a9a3188409cf9006e50a8885805db  app/(app)/mis-asignaciones/_components/RecuperarAyudaButton.tsx
f3176deaf7388e4252b72e111067a6df7fb6117525246e2fe489ba6ae5d73958  app/(app)/mis-asignaciones/_components/pos-card/PosOrderCardMosaico.tsx
```

`git status --short` **vacío** al cerrar la revisión.

### Verde propio (no la bitácora del implementer)

```
vitest run  <6 archivos del cambio>                       ->   6 passed /  157 tests
vitest run  tests/components/RepartoAyuda.test.tsx        ->   1 passed /   17 tests
vitest run  tests/unit/guards                             ->  57 passed /  834 tests
vitest run  tests/components/{RepartoAyuda,RepartoModule,
            MarcarLuegoToggle,NovedadesModule,
            EstatusBadgeCatalogoV2}                       ->   5 passed /  174 tests
vitest run  tests/unit/services tests/unit/repositories
            tests/integration/actions                     -> 297 passed / 4617 tests
tsc --noEmit                                              -> EXIT 0, sin salida
```

**No corrí `./init.sh`** — es del leader, con el árbol quieto (T8.3).

---

## 7 · Checklist de `CHECKPOINTS.md`, punto por punto

### Especificación
- [x] `requirements.md` con R1-R46 en EARS, puerta humana firmada, **+ enmienda de R35 fechada**.
- [x] `design.md` con alternativas descartadas y su porqué.
- [x] `tasks.md` — **38 de 39**. La única abierta es **T8.3** (gate completo + PR), que es lo que el
      leader ejecuta a continuación y que **no puede marcarse antes de hacerse**. El checkpoint se
      cierra formalmente con ese commit. Lo doy por satisfecho.

### Trazabilidad
- [x] **46 de 46.** R35 queda cubierto bajo su lectura enmendada (lado mensajero, con test); R25 gana
      el test de pantalla que le faltaba; R26 gana el que mide **desde `ejecutarCorte`**; R21 gana la
      red del `notIn`. Sin huérfanos ni fantasmas: los casos nuevos los ejecuté yo y los maté uno a
      uno.
- [x] `progress/impl_235.md` contiene el mapa `R<n> → test` (le faltan las dos filas nuevas → N4).

### Calidad de código
- [x] `typecheck` 0 errores (medido: `EXIT 0`).
- [x] `lint` sin errores (los warnings son preexistentes, no son hallazgo de esta ficha).
- [x] Tests: 5.799 casos verdes en las cinco corridas que hice yo, sobre el árbol quieto.
- [n/a] E2E: este repo no tiene arnés de Playwright vivo. **El sustituto declarado por el proceso —
      T8.1, «ver la app»— esta vez SÍ se hizo**, con los dos roles, y encontró dos defectos que
      15.000 tests daban por buenos. Era el hueco más grande del rechazo y está tapado.

### Datos y seguridad (Supabase)
- [x] Tablas nuevas: ninguna. RLS nueva: ninguna que escribir; se reutilizan tablas con RLS ya
      declarada. **Los tres commits nuevos no tocan schema ni migraciones.**
- [x] Las tres migraciones tienen su `down.sql`; rollback probado contra el motor (T6.3).
- [x] Ningún secreto hardcodeado. Ningún literal de país/moneda/cuenta.
- [x] Webhooks: ninguno nuevo; la excepción de P4 es por familia de origen y ya la verifiqué con dos
      mutaciones en la primera vuelta. **Los tres commits nuevos no la tocan.**

### Patrón de capas
- [x] Los cuatro archivos de producción de `db23911b` respetan su capa: el repositorio sigue siendo
      solo query (`ESTADOS_A_BARRER` es una lista de valores, no lógica), el servicio decide, la
      acción orquesta. `e366e57c` y `0fb7c397` son **solo presentación**, y las dos props que añaden
      ya existían en el componente.
- [x] Interfaces en `lib/interfaces/`, separadas por categoría.

### Permisos
- [x] La puerta sigue siendo la del hilo, reusada. La retirada del `disabled` **no relaja ninguna
      guarda de servidor**: `rescatarOrdenAyuda` nunca comprobó el bloqueo total, a propósito y
      documentado. Lo que se retira es una negación **solo de pantalla** de un permiso que el
      servidor ya concedía.
- [x] Mutaciones internas por Server Action.

### Multi-país / configuración
- [x] Sin hardcode de contexto.

### Verificación final
- [ ] `./init.sh` verde — **pendiente, del leader** (T8.3), con el árbol quieto.
- [x] Este archivo existe y su veredicto es **OK**.
- [ ] Entrada en `progress/history.md` — cierre del leader.

---

## 8 · Qué NO conté como hallazgo

- El **toggle** «Gestionar más tarde» ausente de la card de ayuda: el comentario nunca lo promete, y
  la **badge**, que es lo que la prop no apaga, sí está. Le sobra una palabra, nada más.
- Que la orden en ayuda aparezca hoy bajo **«En devolución»** en `/novedades`: medido en T8.1,
  atribuido correctamente a la **236** y con el aviso de mergeo escrito en `current.md`.
- El botón **«Solicitar ayuda» deshabilitado con el motivo vacío** (sin mensaje que explique por
  qué): el propio recorrido lo anota como conducta heredada de `HabilitarNovedadModal`. De acuerdo:
  no es de esta ficha.
- Que **«Guía NNN»** rotule el nº de remisión mientras el modal dice «(sin guía asignada)»:
  preexistente, anotado en el recorrido §9.
- La advertencia heredada para la **237** y que `gestion_tienda_ayuda` no se declare aquí: ya
  descontadas en la primera vuelta.
- Los **warnings de lint preexistentes**.

---

## Veredicto final

# OK — 0 bloqueantes

Los cuatro bloqueantes están cerrados y los cuatro los verifiqué **matando su test**, no leyendo la
bitácora. El que más me importaba —B1— ya no se mide un nivel por debajo de donde fallaba: se mide
desde `ejecutarCorte`, con el repositorio real y un doble que filtra de verdad, y muere con la forma
exacta que el fallo tenía en producción (**0 mensajeros evaluados**).

Lo que se ganó por el camino y no estaba pedido: la cuarta lista latente
(`ESTADOS_EN_MANO_DEL_MENSAJERO`), una guardia que cruza los tres pares de gemelos, y un recorrido
por la app que encontró dos defectos que la suite no veía. **La ficha sale mejor de lo que entró al
rechazo.**

**Se puede abrir el PR** en cuanto el leader cierre **T8.3**: `./init.sh` completo con el árbol
quieto, comparar el SHA contra `origin/dev` justo antes (el pre-vuelo caduca), marcar la casilla y
anotar `progress/history.md`.

**Dos cosas para llevarse a ese commit**, ninguna bloqueante:

1. la **línea escrita de m2** (o su decisión contraria) y la corrección de **N1** — las dos son una
   línea, y las dos evitan que una decisión y un olvido se lean igual;
2. el **aviso ya medido de que la 235 y la 236 salen juntas o seguidas**: con la 235 sola, la tienda
   ve la orden en `/novedades` bajo una pestaña que no le corresponde y **sin poder leer el motivo**.
