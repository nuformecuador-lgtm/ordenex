# Feature 279 — Diseño técnico

> Cubre `requirements.md` R1–R47. **`fullstack`** desde el 2026-08-24: la mitad de servidor
> es una **retirada** (el camino de recepción en lote, §15). **Sin migraciones, sin tablas
> nuevas, sin cambios de RLS y sin endpoints nuevos**: lo que se toca del servidor son una
> Server Action, un esquema zod, un método de servicio, un método de repositorio y sus dos
> entradas de interfaz — todo en la dirección de borrar.
>
> Secciones §1–§14 son el diseño original; §15–§17 entraron con las cuatro decisiones
> firmadas y **mandan sobre lo que las contradiga**.

## 1. Qué hay hoy (medido el 2026-08-24, leyendo el árbol)

`/recepcion-satelite` es **una sola página**. Su Server Component
(`app/(app)/recepcion-satelite/page.tsx`) resuelve el rol, llama a cinco acciones y baja
diez props a un único módulo cliente
(`app/(app)/recepcion-satelite/_components/RecepcionSateliteModule.tsx`), que pinta, en
este orden:

1. el aviso de «no tienes zona asignada» (`role="alert"`);
2. si hay zona **y** hay algo por recibir: el escáner (`EscanerRecepcion`) y la sección
   «Por recibir» (`PorAceptarSection` + una `SateliteOrderCard` por orden);
3. el aviso de bodega bloqueada / cierres abiertos, el botón del manifiesto del último
   envío, el listado único `SateliteOrdenesListado` y su `Pagination`;
4. el aviso «Liberadas hoy» y los tres modales (asignar, deshacer, cambiar día).

Dos hechos que condicionan todo el diseño:

- **El botón «Aceptar» está duplicado en el mismo render**: como `textoBotonUna="Aceptar"`
  + `onAceptarUna` de `PorAceptarSection` (líneas 471–474 del módulo) y como un `<Button>`
  propio dentro de `renderItem` (líneas 484–493). Quitar uno deja el otro vivo.
- **`PorAceptarSection` no la comparte nadie más.** Su cabecera dice que se «extrajo de Por
  recoger del mensajero» y su JSDoc la llama «compartida (mensajero / adminSatelite)» y
  dice que ofrece «acción en lote» —lo cual es falso dos veces: el lote se retiró el
  2026-08-19 y el único consumidor vivo es el satélite (más su propio test), comprobado por
  búsqueda en todo el árbol.

## 2. Árbol de archivos: antes y después

```
app/(app)/recepcion-satelite/
  page.tsx                      ← HOY: la pantalla entera.  DESPUÉS: redirect (R13)
  por-recibir/page.tsx          ← NUEVO: Server Component + gate de rol
  en-bodega/page.tsx            ← NUEVO: el contenido del page.tsx de hoy
  _components/
    RecepcionSateliteModule.tsx ← SE QUEDA con su nombre y su ruta (§7). Pierde el bloque
                                   «Por recibir» y el botón; conserva listado, filtros,
                                   paginación, modales y avisos de bodega
    PorRecibirModule.tsx        ← NUEVO: escáner + tarjetas, sin acciones
    AvisoSinZonaSatelite.tsx    ← NUEVO: el aviso de R25, en un solo sitio
    EscanerRecepcion.tsx        ← sin cambios; lo montan las DOS pantallas
    SateliteOrderCard.tsx       ← pierde la prop `acciones` (§8)
    SateliteOrdenesListado.tsx  ← sin cambios
app/(app)/_components/
    PorAceptarSection.tsx       ← SE QUEDA donde está; pierde las piezas del botón (§8)
lib/auth/menu-visibility.ts     ← el ítem del satélite gana `children` (§5)
```

`_components/` compartido entre las dos subrutas es el patrón literal de
`app/(app)/mis-asignaciones/_components/`, que sirve a `reparto/` y a `recoger/`.

**El middleware no se toca.** Deniega por defecto y no lleva lista de rutas privadas
(`middleware.ts`: solo enumera públicas y auto-autenticadas), así que las dos subrutas
quedan protegidas sin escribir nada. La defensa real sigue siendo el `notFound()` de cada
página (R19).

## 3. Las dos pantallas

| | «Por recibir» | «En bodega» |
| --- | --- | --- |
| Ruta | `/recepcion-satelite/por-recibir` | `/recepcion-satelite/en-bodega` |
| Título (`AppPage`) | «Por recibir» | «En bodega» |
| Descripción (Q3, firmada) | «Órdenes en camino a tu bodega satélite. Se reciben escaneando el QR.» | «Órdenes que ya están en tu bodega satélite: asignar a un mensajero, enviar a central o recuperar.» |
| Módulo cliente | `PorRecibirModule` | `RecepcionSateliteModule` |
| Acciones de servidor que lee la página | `listarRecepcionSatelite` | `listarRecepcionSatelite`, `listarMensajerosSatelite`, `estadoBloqueoBodegaSatelite`, `listarLiberadasHoy`, `listarOrdenesBodegaPaginado`, `obtenerCatalogoFiltrosOrdenes` |

Ninguna de esas llamadas es nueva: son exactamente las que hoy hace la página única. «Por
recibir» se queda con **una sola** de ellas, que es además la que ya le da `zonaNombre` y
`sinZona`.

**Por qué esas dos descripciones (R44).** La de hoy —«Recepción de órdenes de tu bodega
satélite por escaneo de QR»— describe solo la mitad de arriba: puesta en «En bodega» sería
falsa (ahí no se recibe: se asigna, se devuelve y se recupera). Se parten en dos, cada una
diciendo qué hay en SU pantalla y qué se puede hacer con ello:
- «Por recibir» conserva la instrucción del QR, y ahora carga con más peso: desaparecido el
  botón, la descripción es el único sitio de la pantalla que dice **cómo** se recibe.
- «En bodega» enumera las tres acciones de lote reales del listado, para que el título
  —dos palabras— no sea lo único que oriente. No se nombran los cinco estados: eso lo dice
  el filtro de estado de la propia barra.
Ninguna de las dos hereda «Mis asignaciones»: era el nombre del portal del **mensajero**
viviendo en la pantalla del satélite, y con dos pantallas propias ya no tiene dónde
agarrarse.

## 4. Decisión D1 — `/recepcion-satelite` no muere: redirige a «Por recibir»

**Qué se hace.** La página vieja deja de renderizar y pasa a `redirect("/recepcion-satelite/por-recibir")`.
Sin gate de rol propio: lo aplica la página de destino, server-side. Es el precedente
literal de `app/(app)/mis-asignaciones/page.tsx`, que dice por qué no se borró: «está en
enlaces viejos, en el historial de los navegadores de la calle y en la PWA ya instalada».

**Por qué a «Por recibir» y no a «En bodega»** (R14):
1. Es el primer subítem, y `primerDestino` —la función que decide el aterrizaje
   post-login— devuelve el `href` del primer subítem cuando el ítem tiene `children`. Si el
   redirect apuntara a «En bodega», el rol tendría **dos** puertas distintas: post-login
   caería en una y un enlace guardado en la otra.
2. Es el orden del trabajo: nada puede asignarse en bodega que no se haya recibido antes.
3. Es el orden que ya ve el usuario en la pantalla única (escáner + «Por recibir» arriba,
   bodega abajo) y el orden en que el humano enunció el encargo.
4. Es el mismo criterio con el que se eligió «Reparto» para el mensajero: la pantalla donde
   empieza el turno.

**Alternativa descartada — borrar la ruta.** Da 404 a los enlaces guardados y a la PWA
instalada, y además rompería en silencio el aterrizaje post-login: `primerDestino` seguiría
existiendo pero apuntando a una ruta muerta si alguien dejara el `href` del padre sin
`children`. Descartada por el mismo motivo por el que se conservó `/mis-asignaciones`.

**Alternativa descartada — redirigir a «En bodega»** (donde el `adminSatelite` pasa más
rato). Rompe R14: obligaría a marcar el ítem con `destinoInicial: false` o a reordenar los
subítems, y en ambos casos la puerta del rol dejaría de ser una sola.

## 5. Decisión D2 — el acordeón, y el aterrizaje que se mueve solo

El ítem del satélite pasa de plano a padre con `children`, copiando «Entregas»:

```
label: "Órdenes"           (se conserva: es el nombre que ya existe)
href:  "/recepcion-satelite"   (no navega; identifica al ítem, como en «Entregas»)
children:
  { label: "Por recibir", href: "/recepcion-satelite/por-recibir" }
  { label: "En bodega",   href: "/recepcion-satelite/en-bodega" }
```

El `Sidebar` ya sabe hacerlo: con `children` renderiza `Collapsible` +
`SidebarMenuSub`, marca activo por igualdad exacta de ruta y abre el padre si algún hijo
está activo (R9, R11). No se toca ni un archivo de `components/ui/`.

**La consecuencia peligrosa, y por qué NO es silenciosa.** `primerDestino` devuelve
`primero.children?.[0]?.href ?? primero.href`. En cuanto el ítem tenga `children`, el
aterrizaje post-login del `adminSatelite` deja de ser `/recepcion-satelite` y pasa a ser el
primer subítem. Eso es **exactamente lo que se quiere** (R12/R14), y hay tres tests que lo
afirman por VALOR y escrito a mano, que se pondrán rojos y hay que actualizar a conciencia:

- `tests/unit/auth/destino-post-login.test.ts` — «adminSatelite aterriza en
  /recepcion-satelite». Su cabecera prohíbe derivar el esperado de `primerDestino`: se
  cambia el literal a mano, y ahí queda la decisión firmada.
- `tests/unit/auth/menu-visibility.test.ts` — «el adminSatelite aterriza en su portal de
  órdenes» y el caso R54 de la feature 192 («el aterrizaje de CADA rol es el mismo»).
- `tests/components/AppLayout.test.tsx` — «filtra el sidebar según el rol
  (adminSatelite…)», que hoy busca un **enlace** con `href="/recepcion-satelite"`. Pasa a
  buscar el disparador del desplegable y sus dos subenlaces, **conservando** la mitad
  negativa del caso (el `adminSatelite` no ve `/ordenes`).

Que esos tres se pongan rojos es el diseño funcionando: son la red que la feature 133 puso
tras el incidente de «Analítica». Ninguno se relaja ni se borra.

## 6. Decisión D3 — el reparto del estado compartido

Es la parte donde esta ficha se puede romper en silencio. Dato por dato:

| Dato / comportamiento | Hoy | Después | Por qué |
| --- | --- | --- | --- |
| `porRecibir` (array de DTO) | prop del módulo único | prop de `PorRecibirModule` | es su contenido |
| «hay algo por recibir» | decide si se monta el escáner y la sección | **deja de existir como dato** | Q1: el escáner ya no depende de la lista (R42/R43). `RecepcionSateliteModule` pierde `porRecibir` y **no gana nada a cambio**: R18 se cumple sin transportar ni un booleano |
| `zonaNombre` | una prop | prop de las DOS | «Por recibir» compone el estado legible de la tarjeta; el listado lo usa igual |
| `sinZona` | una prop | prop de las DOS | R25/R26/R27 |
| aviso de zona ausente | literal dentro del módulo | `AvisoSinZonaSatelite`, montado por los dos | R25 exige el MISMO texto; dos copias del literal es la receta conocida de dos listas gemelas que divergen |
| `ordenesBodega`, `catalogoFiltros`, `mensajeros`, `mensajerosBloqueadosIds`, `bloqueoBodega`, `liberadasHoy`, `fechasDiaReparto` | props del módulo único | solo «En bodega» | R24 |
| `ultimoEnvioACentral` + manifiesto | estado del módulo único | solo «En bodega» | R24 |
| `releerBodega()` = `router.refresh()` + `mutate()` | uno para todo | **dos relecturas distintas**, ver abajo | R21/R22 |

**Las dos relecturas, que es donde está la trampa.** El comentario vivo de `releerBodega`
lo deja escrito: `router.refresh()` no basta para la tabla, porque sus filas las tiene SWR
y «sin `mutate()` una orden recién enviada a central seguiría en el listado hasta recargar
la página».

- En **«Por recibir»** no hay SWR: la lista viene entera del Server Component. La relectura
  tras el QR es `router.refresh()` y nada más (R21). Llamar a `mutate()` de una clave que
  esa pantalla no monta sería ruido.
- En **«En bodega»** el escáner SIGUE montado (decisión 4 del humano) y una recepción
  **mete una fila nueva en ese listado**. Su `onRecibida` DEBE conservar
  `router.refresh()` **+** `mutate()`. Si alguien lo simplifica a `refresh()` «porque el
  escáner ya no es de esta pantalla», la orden recién recibida no aparece hasta recargar, y
  nada se pone rojo salvo el test que R22 obliga a escribir.
- Las demás acciones del listado (§R23) siguen usando el mismo `releerBodega` intacto.

**La condición del escáner, después de Q1** (R42/R43). Hoy es
`!sinZona && porRecibir.length > 0`; pasa a ser **`!sinZona`**, en las dos pantallas. La
mitad que se cae es la del recuento; la que se queda —la zona— no es simetría: es que el
servidor responde `sin_zona` a ese actor, así que un escáner ahí solo sabría producir un
error. La lista vacía es otra cosa: el servidor **aceptaría** ese escaneo, y esconder el
escáner justo entonces es dejar sin herramienta a quien tiene el paquete en la mano (es el
fallo que la 167 documentó con la recolección del mensajero).

*Efecto colateral que desaparece con esto*: hoy, al recibir la ÚLTIMA orden pendiente, el
bloque entero se desmontaba con el modal del escáner abierto. Con el escáner incondicional
ya no puede pasar, en ninguna de las dos pantallas.

**Caso `sinZona`, pantalla por pantalla** (R25–R27), conservando exactamente lo que hoy
hace la pantalla única:

- «Por recibir»: solo el aviso. Ni escáner ni tarjetas — es lo que hoy afirma el caso
  «Feature 63 + pedido humano: sin zona no se ofrece nada de recepción», que se conserva
  reapuntado a la nueva pantalla.
- «En bodega»: el aviso **y** el listado (hoy el listado se pinta fuera del condicional de
  zona, y `sinZona` solo baja al listado para la regla de disponibilidad del incidente).
  Sin escáner.

## 7. Decisión D4 — `RecepcionSateliteModule.tsx` no se renombra ni se muda

Es el módulo de «En bodega», pero conserva nombre y ruta. **Por qué:** cuatro registros del
repo lo referencian POR RUTA o por sus exports y se romperían sin ganar nada:

- `tests/unit/descarga/adaptador-conjunto.guardia.test.ts:205` (ruta literal),
- `tests/components/paginacion/paginacion-transversal.test.tsx:318` (ruta + `PAGINACION_BODEGA_LABEL`),
- `tests/unit/descarga/contadores-cabecera.guardia.test.ts` y
  `tests/unit/descarga/censo-tablas.ts` (rutas de `SateliteOrdenesListado.tsx`),
- `tests/fixtures/satelite-bodega.ts:12`, que importa de él el tipo `OrdenesBodegaPagina`.

Además, seis archivos de prueba montan ese módulo. **Alternativa descartada — renombrarlo a
`BodegaModule.tsx`**: más legible sobre el papel, pero obliga a tocar cuatro registros y
seis suites para cero cambio de comportamiento, y el guard de contadores de cabecera —que
«mira del archivo que monta `<Pagination>` hacia los componentes que importa»— pasaría a
vigilar un archivo que ya no existe. Se descarta por coste/riesgo.

## 8. Decisión D5 — qué piezas del botón se retiran exactamente

En `PorAceptarSection` (se queda donde está, decisión firmada):

- fuera `onAceptarUna`, `textoBotonUna` y el bloque `CardAction` + `<Button>` de la tarjeta
  por defecto, con su import;
- fuera **`mostrarAcciones`**: su única función era ocultar ese botón. Dejarla sería una
  prop que promete controlar algo que ya no existe, y esta pantalla la pasa hoy
  (`mostrarAcciones={!sinZona}`) sin efecto alguno, porque usa `renderItem`;
- se reescribe el comentario de cabecera y el JSDoc (R4): único consumidor real, sin acción
  por-orden y sin acción en lote.

En `SateliteOrderCard`: fuera la prop `acciones` y su contenedor (R5). Único consumidor
comprobado: el `renderItem` que esta feature deja sin botón. Un hueco de acción que nadie
rellena, documentado como «Acción propia del grupo ("Aceptar", …)», es código muerto que
además señala dónde volver a meter el botón.

En `RecepcionSateliteModule`: fuera `aceptarRecepcion`, el import de `recibirLote` y el
bloque JSX de «Por recibir» entero.

**Alternativa descartada — conservar `mostrarAcciones` «por si vuelve a hacer falta»**: es
la puerta de reentrada del botón y una mentira en el contrato; el repo ya paga caro las
props que no hacen lo que dicen. Si mañana hace falta una acción, se decide entonces.

## 9. Decisión D6 — del servidor solo se retira el lote (R7)

> **Superada por §15** en su parte de decisión: Q2 se firmó a favor de retirar la cadena
> del lote. Lo que sigue vigente de esta sección es el límite: **todo lo demás del servidor
> queda idéntico**, y en particular `recibirPorQr` → `RecepcionSateliteService.recibir()` →
> `repo.recibirEnSatelite(...)`, con sus guardas y su historial, no se toca ni una línea
> (R38).

Corrección de un hecho de la ficha, que conviene no propagar al revés: la ficha decía que
`recibirLote` «lo usa el escáner». **No es así.** El escáner llama a `recibirPorQr`
(`EscanerRecepcion.tsx:105` y `:138`) y `recibirLote` solo lo invocaba el botón que
desaparece (`RecepcionSateliteModule.tsx:301`). Esa corrección es justamente lo que hizo
posible firmar Q2 sin riesgo: **el QR no comparte camino con el lote** (§15).

## 10. Decisión D7 — la guardia de no-reintroducción, y cómo se prueba que ve algo

Molde: `tests/unit/guards/entregas-sin-recoleccion.test.ts`, que ya resuelve este mismo
problema («R33 y R34 son AUSENCIAS, y las ausencias se rompen sin que nadie se entere») y
que además incluye el caso «el guard mira archivos que EXISTEN».

Guardia nueva `tests/unit/guards/satelite-sin-boton-aceptar.guardia.test.ts`:

- **Ámbito**: `PorRecibirModule.tsx`, `RecepcionSateliteModule.tsx`,
  `PorAceptarSection.tsx`, `SateliteOrderCard.tsx` y —desde Q2— los dos archivos de
  servidor de los que se retiró el lote: `lib/actions/recepcion-satelite.ts` y
  `lib/types/recepcion-satelite.ts`.
- **Prohibido en código ejecutable** (leído con `quitarComentarios`, para juzgar lo que se
  ejecuta y no la explicación de por qué ya no está): `recibirLote`, `recibirLoteSchema`,
  `onAceptarUna`, `textoBotonUna`, `mostrarAcciones`, `aceptarRecepcion`.
  En los dos de servidor el anclaje positivo es `recibirPorQr`: la misma pasada que
  comprueba que el lote no está demuestra que el QR sigue.
- **Anti-vacuidad (R31)**, tres capas, porque una guardia que lee mal pasa igual de verde:
  1. los cuatro archivos EXISTEN;
  2. el texto **ya sin comentarios** de cada uno contiene un anclaje POSITIVO conocido
     (`PorAceptarSection`, `SateliteOrderCard`, `EscanerRecepcion`, `SateliteOrdenesListado`
     según el archivo). Si el quitador se comiera el archivo entero —el modo de fallo real
     de este repo— el anclaje desaparece y la guardia se pone roja en vez de aprobar el
     vacío;
  3. un caso que aplica los prohibidos a una cadena de control con el botón dentro y
     comprueba que la detección DISPARA (que el `not.toContain` no está midiendo la nada).

**El sidebar NO entra en esa guardia** (R32). `lib/auth/menu-visibility.ts` es el peor caso
conocido del agujero de `quitarComentarios`: el ítem «Entregas» lleva, dentro de un
comentario `//`, una ruta con comodín cuyo `/*` **abre un bloque** que el quitador solo
cierra en el siguiente `*/` del archivo —el JSDoc de `puedeVer`—, tragándose el tramo donde
viven todos los ítems de abajo, incluido el del satélite. Por eso los subítems se afirman
sobre el **valor importado** `SIDEBAR_ITEMS` (`tests/unit/auth/menu-visibility.test.ts`,
que ya trabaja así), donde ningún comentario puede esconder nada. `tasks.md` T0 exige
**medir** ese agujero antes de escribir nada y dejar el número en la bitácora: una
imposibilidad razonada no es una imposibilidad medida.

## 11. Decisión D8 — el disparador de relectura que pierde `SateliteSeleccionOtrasPaginas`

Ese archivo usa hoy el botón «Aceptar» como «una acción CUALQUIERA de la pantalla que relee
del servidor» sin tocar selección, página ni filtros (`releerListado`, líneas 294–304). Al
morir el botón hay que sustituir el disparador, no el caso.

Sustituto elegido: **la recepción por QR**, montada en «En bodega» —donde el escáner está
siempre (R42), así que el montaje no necesita preparar nada— con `recibirPorQr` doblado a
`{ status: "ok" }`. Cumple las tres condiciones (relee,
no toca la selección, no toca filtros ni página), y además es coherente con lo que la
feature establece: recibir es solo por QR. Se conserva intacto el anclaje POSITIVO del
helper (`waitFor` sobre las remisiones visibles tras la relectura), que es lo que impide
que el test se cumpla antes de que la acción empiece.

Sustituto de reserva, si el modal del escáner diera guerra en jsdom: la acción por fila
«Reportar incidente», que también termina en `releerBodega` y ya tiene montaje propio en
`tests/components/RecepcionSateliteIncidente.test.tsx`.

## 12. Contratos de entrada/salida (props)

```ts
// NUEVO
interface PorRecibirModuleProps {
  porRecibir: RecepcionSateliteDTO[];
  zonaNombre: string | null;
  sinZona: boolean;
}

// RecepcionSateliteModule: mismas props de hoy, MENOS una
- porRecibir: RecepcionSateliteDTO[];
// (no la sustituye nada: con el escáner incondicional, «En bodega» no necesita
//  saber cuántas hay — R18/R42)
```

Salidas: ninguna acción nueva, ningún tipo de dominio nuevo. En `lib/types/` y
`lib/interfaces/` **solo se borra** (§15); no se añade nada.

## 13. Riesgos y vecindad

1. **Ficha 190 (pending)** cambia el contrato de `listarRecepcionSatelite`. Es backend y no
   toca estas pantallas, pero las dos páginas nuevas llaman a esa acción: si la 190 entra
   antes, la adaptación es de las páginas, no de los módulos.
2. **Base local compartida entre worktrees**: esta ficha no trae migraciones, así que no
   puede romper el gate de otras; tampoco depende de ninguna.
3. **e2e no ejecutados**: cinco specs navegan a `/recepcion-satelite`. El redirect los deja
   funcionando a nivel de navegación, pero los que buscan la región del listado aterrizarían
   en la pantalla equivocada. Se reapuntan por lectura (tarea marcada como no ejecutable), y
   se dice así en la bitácora: no se afirma que pasen.
4. **`AppPage title`**: el H1 «Mis asignaciones» del satélite desaparece. Solo lo afirma
   `tests/components/RecepcionSatelitePage.test.tsx:118`, que esta ficha reescribe.
5. **Guardias que ven por primera vez** (§16): al cerrar el comentario del menú, unas 150
   líneas dejan de estar ocultas para todo guardia que escanee fuentes. Si alguna se pone
   roja, es un hallazgo previo, no un daño de esta ficha. Protocolo en `requirements.md`
   → **P1**.

---

## 15. Decisión D9 — la retirada de la recepción EN LOTE (Q2, `fullstack`)

### 15.1 Por qué se puede retirar sin rozar el QR

Los dos caminos se separan **en el servicio** y no vuelven a tocarse:

```
recibirPorQr(numGuia)  → Service.recibir()      → repo.recibirEnSatelite(...)        ← SE QUEDA
recibirLote(ordenIds)  → Service.recibirLote()  → repo.recibirLoteEnSatelite(...)    ← SE VA
```

Verificado en el árbol el 2026-08-24: `recibirEnSatelite` se invoca en
`RecepcionSateliteService.ts:392` (dentro de `recibir`) y `recibirLoteEnSatelite` **solo**
en `RecepcionSateliteService.ts:436` (dentro de `recibirLote`). No hay ningún otro llamador
de este último en `lib/`, `app/` ni `scripts/`. Son dos métodos distintos, con dos SQL
distintos (uno `updateMany` guardado por orden, otro `UPDATE … RETURNING` en lote): borrar
el segundo no puede alterar el primero.

### 15.2 Qué se borra, archivo por archivo (producción)

| Archivo | Qué se va |
| --- | --- |
| `app/(app)/recepcion-satelite/_components/RecepcionSateliteModule.tsx` | `aceptarRecepcion` y el import de `recibirLote` (ya en §8) |
| `app/(app)/_components/PorAceptarSection.tsx` | la mención a `recibirLote` del comentario de cabecera (§8) |
| `lib/actions/recepcion-satelite.ts` | la Server Action `recibirLote` + sus dos imports (`recibirLoteSchema`, `type RecibirLoteResult`) |
| `lib/types/recepcion-satelite.ts` | `recibirLoteSchema`, `RecibirLoteActionInput` y `RecibirLoteResult` |
| `lib/interfaces/services/IRecepcionSateliteService.ts` | `RecibirLoteInput`, `RecibirLoteServiceResult` y el método `recibirLote` del contrato |
| `lib/services/RecepcionSateliteService.ts` | el método `recibirLote`, el helper `distinct()` (su único llamador era éste, comprobado), la clave `"recibirLoteEnSatelite"` del `Pick` de dependencias y los dos imports de tipo |
| `lib/repositories/OrdenRepository.ts` | el método `recibirLoteEnSatelite` con su JSDoc |
| `lib/interfaces/repositories/IOrdenRepository.ts` | la declaración de `recibirLoteEnSatelite` con su JSDoc |
| `lib/types/orden-guia.ts` | solo la MENCIÓN a `recibirLoteSchema` en un comentario que enumera esquemas hermanos |

**Qué NO se toca del servidor:** `recibirPorQr`, `Service.recibir()`,
`repo.recibirEnSatelite`, `findByNumGuiaForTransicion`, `findEstatusIdByValue`,
`appendCambioEstado`, el catálogo de estados, el historial y las constantes
`ORIGEN_RECEPCION` / `ESTADO_RECIBIDA` (las sigue usando `recibir`).

### 15.3 Los 18 archivos de test: qué se va y qué se queda

**Los 18 se tocan** —ninguno se queda como está— pero por tres motivos distintos, y
**ninguno se borra entero**. Lo que se borra son los bloques cuyo SUJETO es el lote.

**(A) Muere el sujeto — 3 archivos.** Aquí es donde aplica R40: cada caso, o se repone, o se
declara muerto por escrito.

| Archivo | Qué se retira | Destino de lo que afirmaba |
| --- | --- | --- |
| `tests/unit/services/recepcion-satelite-service.test.ts` | `describe("recibirLote (feature 63)")` (≈457–510), la clave del `Pick` (l. 33) y el doble (l. 80) | **Muere con el código.** Sus seis afirmaciones (rol ≠ adminSatelite, sin zona, lote vacío, dedupe de ids, alcance por zona/estado, conteo) tienen equivalente vivo en el `describe("recibir")` del MISMO archivo para rol, zona y estado; el dedupe y el conteo mueren porque ya no hay lote que deduplicar. Se dice así, en la bitácora |
| `tests/unit/actions/recepcion-satelite-action.test.ts` | los casos del borde de `recibirLote` (zod, `unauthenticated`, paso al service) | **Muere con el código.** El mismo trío está afirmado sobre `recibirPorQr` en el mismo archivo; se comprueba caso por caso ANTES de borrar, y se anota la correspondencia |
| `tests/unit/repositories/orden-repository.recepcion-satelite.test.ts` | `describe("OrdenRepository.recibirLoteEnSatelite (feature 63)")` (226+) | **Muere con el código.** Su hermano `recibirEnSatelite` conserva sus casos y es el que sostiene el QR: el `WHERE` que importa sigue probado donde vive |

**(B) Dobles tipados contra la interfaz — 5 archivos, cambio mecánico.** El typecheck los
denuncia solo (`Partial<IOrdenRepository>` → propiedad de más; `Pick<…, "recibirLoteEnSatelite">`
→ clave inexistente): `bulk-orden-service.test.ts:94`,
`bulk-orden-service.carga-api.test.ts:194`, `orden-service.test.ts:122`,
`rol-admin-satelite-authz.test.ts:134`, `recepcion-satelite-asignadas.test.ts:30,62`.

**(C) Censos escritos a mano — 2 archivos, verdes pero falsos si no se tocan.**
- `tests/integration/cotizacion-api-key.test.ts:128`: la lista `METODOS_ESCRITURA` alimenta
  un **Proxy** que acepta cualquier nombre, así que un método inexistente NO pone nada rojo
  — el propio archivo lo dice: «pasaría igual si el método no existiera». Se retira el
  nombre **y** se le ata el tipo: `as const satisfies readonly (keyof IOrdenRepository)[]`,
  que convierte el fallo mudo en error de compilación (R41).
- `tests/fixtures/inventario-transiciones-140.ts:81`: el `callSite` de la transición
  `en_ruta_bodega_satelite → en_bodega_satelite` pasa a nombrar solo
  `RecepcionSateliteService.recibir`. La transición **sigue existiendo**, así que la fila se
  queda; lo que se corrige es el nombre del sitio que la ejecuta (ese texto es el nombre del
  caso en `order-status-transiciones.guardia.test.ts`).

**(D) Montajes del módulo — 8 archivos, rojos por la prop, no por el lote.**
`RecepcionSateliteModule.test.tsx`, `SateliteSeleccionOtrasPaginas.test.tsx:206`,
`SatelitePaginacion.test.tsx:325`, `SateliteDescarga.test.tsx:191,203`,
`RecepcionSateliteIncidente.test.tsx:155`, `ManifiestoFlujos.test.tsx:386`,
`CambiarDiaRepartoListados.test.tsx:195`, `deshacer-asignacion.ui.test.tsx:199`. Se les
quita `porRecibir` y, **ya que se abren**, la clave inerte `recibirLote: vi.fn()` de sus
`vi.mock`.

**(E) NO se tocan:** `progress/impl_lote_vacio_schemas.md`, `progress/impl_63-*.md` y los
`design.md` de las fichas 90, 140 y 149. Son fotos históricas: reescribirlas falsearía el
registro, igual que un `down.sql` ya aplicado.

**Alternativa descartada — dejar las claves inertes de (D) y el censo de (C) como están.**
Compila y pasa. Pero (C) deja dos censos afirmando cosas de un método que no existe —el modo
de fallo favorito de este repo— y (D) deja ocho referencias a una acción borrada que el
siguiente que lea el archivo creerá viva. Como los ocho archivos hay que abrirlos igual por
la prop, el ahorro de no tocarlos era cero.

---

## 16. Decisión D10 — el comentario del menú se arregla aquí (Q4), y se MIDE

**El defecto.** `lib/auth/menu-visibility.ts:228` dice, dentro de un comentario de línea:

> `` … `/mis-asignaciones/*` (resuelven el rol server-side). ``

El quitador del repo (`tests/fixtures/sin-comentarios.ts`) hace **primero** la pasada de
bloques `/\*[\s\S]*?\*\//g` sobre el texto crudo. Ese `/*` abre un bloque que solo se cierra
en el siguiente `*/` del archivo —el JSDoc de `puedeVer`—, así que el tramo **228 → ~378**
desaparece del texto que cualquier guardia lee. Ahí dentro viven «Entregas» y sus hijos,
«Recolección», **el ítem del satélite** (y por tanto los subítems que añade esta ficha),
«Novedades», «Ranking», «Wallet», «Configuración», los dos cierres e «Incidentes».

**Comprobado el 2026-08-24:** es la **única** línea del archivo con un `/*` dentro de un
comentario de línea (las otras diez apariciones de `/*` son aperturas legítimas de JSDoc).
Cerrar ésta devuelve el archivo entero a las guardias.

**El arreglo.** La ruta con comodín pasa a nombrar las dos rutas reales —
`` `/mis-asignaciones/reparto` y `/mis-asignaciones/recoger` `` — en vez de un patrón. No es
un parche: es más preciso que el comodín y no puede reabrir el agujero. **No se toca
`quitarComentarios`** (R47): el agujero de la herramienta es otra ficha.

**Cómo se comprueba que funcionó, midiendo antes y después** (R46). Dos números y una
pertenencia, tomados con el mismo script en los dos estados del archivo:
1. líneas no vacías que sobreviven a `quitarComentarios`;
2. si el texto barrido contiene `label: "Incidentes"` (el ÚLTIMO ítem de la lista: si está,
   el tramo entero se ve);
3. si contiene las dos subrutas nuevas del satélite.

Esperado: (2) y (3) pasan de `false` a `true`, y (1) sube. Los tres quedan escritos en la
bitácora con su valor real. Lo que se afirma para siempre es (2)+(3), como caso permanente
en `tests/unit/auth/menu-visibility.test.ts` («el fuente del menú sigue siendo legible para
las guardias»): si mañana alguien vuelve a escribir un comodín en un comentario, ese caso se
pone rojo en vez de dejar ciegas a las demás.

**Lo que NO cambia con esto:** la comprobación de los subítems sigue haciéndose sobre el
**valor** `SIDEBAR_ITEMS` (R32). Que el fuente vuelva a ser legible es defensa en
profundidad, no un permiso para volver a juzgar el menú leyendo texto.

---

## 17. Orden de ejecución y gate

La retirada del lote **no compila a medias**: entre borrar la acción y borrar el método del
repositorio hay estados intermedios rojos. Se hace en UNA tanda, en este orden —consumidor
primero, contrato después—, y se comitea junta:

```
componente → acción → schema/tipos → servicio → interfaz de servicio
           → repositorio → interfaz de repositorio → censos y dobles
```

**El gate rápido va a negarse** o, si no se niega, no basta: el diff toca `lib/types/`, que
es uno de los cimientos que mandan al completo. Esta ficha corre **`./init.sh` completo**
antes de dar nada por hecho, y el `INIT_EXIT=$?` se escribe DENTRO del log.
