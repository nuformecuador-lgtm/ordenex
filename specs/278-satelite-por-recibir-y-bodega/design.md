# Feature 278 — Diseño técnico

> Cubre `requirements.md` R1–R33. **Solo frontend.** Sin migraciones, sin tablas, sin RLS,
> sin endpoints nuevos, sin cambios de contrato: la sección §9 explica por qué y qué se
> comprobó para afirmarlo.

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
| Descripción propuesta (Q3) | «Órdenes en camino a tu bodega satélite; se reciben escaneando el QR» | «Órdenes que ya están en tu bodega satélite» |
| Módulo cliente | `PorRecibirModule` | `RecepcionSateliteModule` |
| Acciones de servidor que lee la página | `listarRecepcionSatelite` | `listarRecepcionSatelite`, `listarMensajerosSatelite`, `estadoBloqueoBodegaSatelite`, `listarLiberadasHoy`, `listarOrdenesBodegaPaginado`, `obtenerCatalogoFiltrosOrdenes` |

Ninguna de esas llamadas es nueva: son exactamente las que hoy hace la página única. «Por
recibir» se queda con **una sola** de ellas, que es además la que ya le da `zonaNombre` y
`sinZona`.

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
| «hay algo por recibir» | se deriva de `porRecibir.length` | `hayPorRecibir: boolean` a `RecepcionSateliteModule` | «En bodega» lo necesita para el escáner (R28) y NO debe recibir las filas (R18) |
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

## 9. Decisión D6 — el servidor no se toca (R7), y una corrección de hecho

`recibirPorQr`, `recibirLote`, `RecepcionSateliteService`, `OrdenRepository` y los esquemas
zod quedan **idénticos**. Lo que cambia es solo qué monta el cliente.

Corrección medida, para que no quede escrita al revés: la ficha dice que `recibirLote` «lo
usa el escáner». No es así — el escáner llama a `recibirPorQr`
(`EscanerRecepcion.tsx:105` y `:138`), y `recibirLote` solo lo invocaba el botón que
desaparece (`RecepcionSateliteModule.tsx:301`). **La decisión no cambia** (no se toca), pero
el motivo correcto es otro: retirarlo sería backend, y esta ficha no lo es. Queda como Q2 en
`requirements.md`.

## 10. Decisión D7 — la guardia de no-reintroducción, y cómo se prueba que ve algo

Molde: `tests/unit/guards/entregas-sin-recoleccion.test.ts`, que ya resuelve este mismo
problema («R33 y R34 son AUSENCIAS, y las ausencias se rompen sin que nadie se entere») y
que además incluye el caso «el guard mira archivos que EXISTEN».

Guardia nueva `tests/unit/guards/satelite-sin-boton-aceptar.guardia.test.ts`:

- **Ámbito**: `PorRecibirModule.tsx`, `RecepcionSateliteModule.tsx`,
  `PorAceptarSection.tsx`, `SateliteOrderCard.tsx`.
- **Prohibido en código ejecutable** (leído con `quitarComentarios`, para juzgar lo que se
  ejecuta y no la explicación de por qué ya no está): `recibirLote`, `onAceptarUna`,
  `textoBotonUna`, `mostrarAcciones`, `aceptarRecepcion`.
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

Sustituto elegido: **la recepción por QR**, montada en «En bodega» con `hayPorRecibir` en
`true` y `recibirPorQr` doblado a `{ status: "ok" }`. Cumple las tres condiciones (relee,
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

// RecepcionSateliteModule: mismas props de hoy, con UN cambio
- porRecibir: RecepcionSateliteDTO[];
+ hayPorRecibir: boolean;   // R18: solo si hay, nunca las filas
```

Salidas: ninguna acción nueva, ningún tipo de dominio nuevo, ningún cambio en
`lib/types/` ni en `lib/interfaces/`.

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
