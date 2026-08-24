# Feature 258 — Requisitos

**Rediseño de `/monitoreo` sobre las primitivas + entregas acumuladas por hora.**

Esta ficha REDIBUJA la pantalla de la feature 192 (`done`) y le AÑADE una lectura de backend
que hoy no existe. No cambia qué significa ningún contador ya publicado, no toca la frontera
multi-tenant y no cambia el alcance de datos de nadie.

Notación EARS. Cada `R<n>` se verifica con al menos un test; el mapa vive en `tasks.md`.

Vocabulario que se usa aquí y no se redefine:

- **contador**: cada uno de los ocho sumandos de una tarjeta (`entregadas`, `reprogramadas`,
  `devueltas`, `rechazadas`, `incidentes`, `sinRecoger`, `enReparto`, `otros`).
- **primitiva**: un componente ya existente en `components/ui/` o `components/shared/`.
- **árbol de la feature**: los archivos que censa `tests/unit/tablero-dia/_arbol-de-la-feature.ts`
  (los doce de backend más todo `app/(app)/monitoreo/`).
- **ventana CR**: el intervalo semiabierto `[desde, hasta)` que produce
  `ventanaDelDiaEnCursoCR` (`lib/utils/ventana-dia-cr.ts`).

---

## §1 — Alcance de la ficha

**R1.** El sistema DEBE conservar, sin cambio de significado, los ocho contadores, el detalle
por mensajero y el recorte por alcance que la feature 192 ya publica; esta ficha sólo cambia
CÓMO se pintan y AÑADE la serie de entregas acumuladas por hora.

**R2.** El sistema NO DEBE crear tablas, columnas, migraciones, enums ni políticas RLS nuevas.

---

## §2 — Invariantes heredadas de la 192 (no-regresión)

**R3.** El sistema DEBE mantener la identidad de los ocho sumandos en cada tarjeta y en el
bloque de totales: `asignadas = entregadas + reprogramadas + devueltas + rechazadas +
incidentes + sinRecoger + enReparto + otros`.

**R4.** El sistema DEBE seguir presentando los cinco desenlaces y los tres cubos de «sin
resultado» en dos bloques visualmente separados, de modo que ninguno de los dos contenga al
otro en el DOM.

**R5.** El sistema DEBE pintar el cubo `otros` aunque valga cero, acompañado de la ayuda que
enumera los estatus que contiene.

**R6.** El sistema DEBE ordenar la rejilla por `asignadas` descendente, después por nombre
ascendente y después por `mensajeroId` ascendente, y ese orden NO DEBE depender del ancho de
la pantalla ni de la densidad elegida.

**R7.** CUANDO el usuario abre el detalle de un mensajero, el sistema DEBE escribir
`?mensajero=<id>` en la URL reemplazando la entrada actual del historial, no apilando una nueva.

**R8.** MIENTRAS la pantalla está montada, el sistema DEBE volver a consultar el tablero cada
30 segundos conservando los datos previos entre consultas.

**R9.** SI una re-consulta del tablero falla, ENTONCES el sistema DEBE conservar en pantalla los
últimos datos obtenidos y mostrar el aviso de fallo junto a ellos, sin vaciarlos ni ponerlos a
cero.

**R10.** El sistema DEBE calcular la antigüedad mostrada contra el `generadoAt` que viaja en el
dato, nunca contra el instante del render ni el de la respuesta.

**R11.** MIENTRAS no haya un mensajero seleccionado, el sistema NO DEBE pedir ningún detalle.

**R12.** El detalle DEBE seguir sirviéndose paginado, con `pageSize` tomado de
`ordenesConfig.DEFAULT_PAGE_SIZE`; el sistema NO DEBE traer a memoria las órdenes del día para
recortarlas después.

**R13.** CUANDO el detalle se pide con un mensajero inexistente, con uno fuera del alcance del
actor o con uno sin órdenes hoy, el sistema DEBE responder y pintar EXACTAMENTE lo mismo en los
tres casos, sin eco del identificador recibido.

**R14.** El sistema NO DEBE leer el rol del actor ni declarar una segunda lista de roles en
ningún archivo del árbol de la feature salvo `app/(app)/monitoreo/page.tsx`, que sigue siendo
la única puerta de pantalla y sigue respondiendo `notFound()` a los roles fuera de su lista.

---

## §3 — Primitivas reutilizadas (pedido humano 1)

**R15.** El sistema DEBE renderizar cada uno de los ocho contadores con la primitiva `Badge`.

**R16.** El sistema DEBE asignar a cada contador una variante semántica de `Badge` declarada
UNA sola vez en el árbol, en un mapa exhaustivo sobre las ocho claves de contador; un cubo o un
resultado nuevo NO DEBE compilar sin variante asignada.

**R17.** El mapa de variantes DEBE estar clavado por CLAVE DE CONTADOR (`entregadas`,
`sinRecoger`, …) y NO por value del catálogo de estatus ni por value de `gestion_resultado`.

**R18.** El sistema NO DEBE nombrar el identificador `badgeVariants` en ningún archivo del árbol
de la feature.

**R19.** El sistema NO DEBE declarar un segundo mapa de estatus → etiqueta ni de estatus →
color en ningún archivo del árbol de la feature; el vocabulario visual del estatus se sigue
consumiendo desde `EstatusBadge`/`estatusLabel`.

**R20.** El sistema NO DEBE añadir, renombrar ni eliminar archivos en `components/ui/` ni en
`components/shared/`.

**R21.** El estado vacío del tablero DEBE construirse con la primitiva `EmptyState`.

**R22.** Los tres avisos de la pantalla —refresco fallido, acceso denegado y tarjeta
desaparecida— DEBEN construirse con la primitiva `Alert`.

**R23.** El detalle DEBE construirse con las primitivas `Modal`, `DataTable` y `Pagination`.

---

## §4 — Los cinco estados, cada uno con su icono (pedido humano 2)

**R24.** El sistema DEBE mostrar un icono de `lucide-react` en cada uno de los cinco estados de
la ruta: cargando, sin órdenes hoy, refresco fallido, acceso denegado y tarjeta desaparecida.

**R25.** Cada uno de los cinco iconos DEBE ser DISTINTO de los otros cuatro: dos estados
distintos no pueden llevar el mismo icono.

**R26.** El icono del estado vacío DEBE entregarse por la prop `icon` de `EmptyState`, de modo
que la primitiva lo pinte como decorativo y el significado siga viviendo en el título y la
descripción.

**R27.** El icono de cada `Alert` DEBE ser el PRIMER hijo del `Alert`, para que la primitiva
aplique su rejilla de dos columnas.

**R28.** El icono del estado de carga NO DEBE sustituir el anuncio accesible: la región de carga
DEBE seguir exponiendo `role="status"` con `aria-busy="true"` y su nombre accesible.

**R29.** Ningún icono de la pantalla DEBE ser el único portador de información: en los cinco
estados el mensaje DEBE seguir siendo legible como texto con el icono suprimido.

**R30.** Los cinco estados DEBEN seguir siendo distinguibles entre sí en el DOM por su atributo
`data-slot`.

---

## §5 — El detalle en un modal (pedido humano 3)

**R31.** CUANDO el usuario activa una tarjeta con el ratón o con el teclado, el sistema DEBE
abrir el detalle en un diálogo MODAL, con foco atrapado, `aria-modal` y título asociado.

**R32.** CUANDO el usuario pulsa Escape o el fondo del modal, el sistema DEBE cerrar el detalle
y retirar `?mensajero=` de la URL conservando el resto de parámetros.

**R33.** MIENTRAS el modal está abierto, el tablero DEBE seguir montado y refrescándose; abrir y
cerrar el detalle NO DEBE provocar ninguna consulta adicional del tablero.

**R34.** El modal del detalle NO DEBE ofrecer un botón de confirmación: es una vista de lectura,
no una decisión.

**R35.** SI el detalle tiene al menos una orden, ENTONCES el sistema DEBE pintarlas con
`DataTable` en EXACTAMENTE cuatro columnas —Nº Guía, Estado, Resultado del día, Cliente /
destino— y ninguna más.

**R36.** SI el detalle no tiene ninguna orden, ENTONCES el sistema DEBE mostrar el vacío
genérico y NO DEBE pintar ninguna tabla.

**R37.** El estatus de cada orden del detalle DEBE pintarse con `EstatusBadge`, con las mismas
clases que produce ese componente en el listado de órdenes.

**R38.** CUANDO la tarjeta cuyo detalle está abierto desaparece en un refresco, el sistema DEBE
cerrar el modal y mostrar el aviso que explica por qué; y CUANDO el identificador de la URL
nunca estuvo en el tablero, el sistema DEBE dejar el modal ABIERTO con el vacío genérico.

---

## §6 — Filtro por nombre y densidad

**R39.** El sistema DEBE ofrecer un filtro por nombre de mensajero construido con la primitiva
`Input`.

**R40.** El filtro DEBE recortar únicamente qué tarjetas se pintan; NO DEBE provocar ninguna
consulta al servidor ni alterar el orden de las tarjetas restantes.

**R41.** El filtro DEBE encontrar un nombre con acentos escribiéndolo sin acentos y sin
distinguir mayúsculas de minúsculas.

**R42.** SI hay filtro activo y ningún mensajero coincide, ENTONCES el sistema DEBE mostrar un
vacío PROPIO —distinto en texto y en `data-slot` del vacío de «sin órdenes hoy»— con un icono y
una acción para quitar el filtro.

**R43.** MIENTRAS haya filtro activo, el bloque de totales DEBE recalcularse sobre las tarjetas
VISIBLES, de modo que siga siendo la suma de las filas que se pintan; y el sistema DEBE anunciar
cuántos mensajeros coinciden de cuántos.

**R44.** El sistema DEBE ofrecer un conmutador de densidad construido con la primitiva
`SegmentedToggle`, con la densidad cómoda como valor inicial.

**R45.** El conmutador de densidad DEBE ser estado de presentación puro: NO DEBE provocar
consultas, NO DEBE cambiar qué tarjetas se ven, NO DEBE cambiar su orden y NO DEBE cambiar
ninguna cifra; y en cualquier densidad el nombre accesible de cada contador DEBE seguir
diciendo su etiqueta y su valor.

---

## §7 — Tema oscuro (pedido humano 4)

**R46.** Ningún archivo del árbol de la feature DEBE escribir un color como hex literal ni como
utilidad de paleta cruda de Tailwind; todo color DEBE salir de los tokens de `app/globals.css`.

**R47.** Todo texto semántico de la pantalla DEBE usar el rol `-strong` del par; el fondo del
chip DEBE usar `-soft` con su compensación `dark:bg-{sem}/15`; el color base DEBE quedar
reservado a bordes, puntos e iconos.

**R48.** El sistema NO DEBE emparejar un color fijo del bloque `@theme` sobre una superficie que
gira con el tema, ni un color que gira sobre una superficie fija.

**R49.** El color de la línea de entregas acumuladas DEBE salir de la paleta de tokens del
paquete de gráficas, que gira con el tema; la feature NO DEBE pasar color por props ni declarar
lógica de tema propia.

---

## §8 — Entregas acumuladas por hora (lectura nueva de backend)

**R50.** El sistema DEBE publicar, junto a los conteos del tablero, una serie de ENTREGAS
ACUMULADAS por hora de pared de Costa Rica del día representado.

**R51.** Un punto de la serie DEBE contar EXACTAMENTE las mismas órdenes que el contador
`entregadas` del mismo tablero: órdenes del universo «asignada hoy», dentro del alcance del
actor, cuya ÚLTIMA gestión vigente del día tiene resultado `entregada`. Una orden con varias
gestiones DEBE contar una sola vez.

**R52.** El último punto de la serie DEBE ser igual a `totales.entregadas` del mismo tablero.

**R53.** La hora de un punto DEBE derivarse de `ventana.desde`; el sistema NO DEBE usar
`startOfDayCR` ni escribir un identificador de zona horaria dentro del SQL.

**R54.** La serie DEBE cubrir sin huecos las horas `0..H`, donde `H` es la hora de pared de
Costa Rica del instante de lectura, y sus valores DEBEN ser monótonos no decrecientes.

**R55.** La serie DEBE recortarse con el MISMO `resolverAlcance` y la MISMA lista blanca
`global|zona` que ya aplica el tablero, resueltos en el mismo sitio; ninguna capa nueva DEBE
resolver alcance por su cuenta ni aceptar un `zonaId` que venga del cliente.

**R56.** SI el actor no está autorizado, ENTONCES el sistema NO DEBE ejecutar la consulta de la
serie ni devolver ningún punto.

**R57.** La serie DEBE viajar dentro del mismo valor que ya publica el tablero, bajo la MISMA
clave de caché y con el MISMO `generadoAt`; una lectura del tablero NO DEBE producir dos
instantes de generación distintos.

**R58.** La consulta de la serie DEBE ser agregada (`GROUP BY`), vivir en el repositorio, ser de
sólo lectura y llevar su recorte de alcance como parámetro, nunca interpolado en la cadena.

**R59.** SI el día todavía no registra ninguna entrega, ENTONCES el sistema DEBE mostrar el
estado vacío del propio marco de la gráfica, con un texto que diga que el día aún no tiene
entregas, y NO DEBE dibujar una línea plana a cero.

**R60.** La línea DEBE exponer una alternativa textual accesible que enumere los puntos de la
serie; el sistema NO DEBE escribirla a mano si la primitiva ya la produce.

---

## §9 — Anclajes del DOM y trazabilidad

**R61.** El sistema DEBE conservar estos anclajes, que hoy sostienen los tests de la 192:
`data-mensajero`, `data-contador`, `data-grupo="resultados"`, `data-grupo="sin-resultado"`,
`data-slot="tablero-dia"`, `data-slot="tablero-dia-cabecera"`, `data-slot="tablero-dia-rejilla"`,
`data-slot="tablero-dia-totales"`, `data-slot="tablero-dia-skeleton"`,
`data-slot="tablero-dia-vacio"`, `data-slot="tablero-dia-aviso-refresco"`,
`data-slot="tablero-dia-denegado"`, `data-slot="tablero-dia-aviso-desaparecido"`,
`data-slot="detalle-mensajero-panel"`, `data-slot="detalle-mensajero-vacio"`, el `role="button"`
de la tarjeta con el nombre del mensajero en su nombre accesible, el `role="status"` del
esqueleto y el `role="alert"` de los avisos.

**R62.** CUANDO un anclaje cambie de sitio en el DOM por el cambio de `Sheet` a `Modal`, el
sistema DEBE seguir exponiéndolo con el mismo nombre, de forma que los tests existentes lo
localicen sin cambiar su selector.

**R63.** `app/(app)/monitoreo/page.tsx` DEBE seguir sin importar repositorios, servicios,
`@/lib/db` ni SQL crudo, y sin recibir props ni parámetros de ruta.

---

## §10 — Decisiones firmadas (2026-08-21)

Las siete preguntas abiertas de la primera versión de este spec están **resueltas**. Aquí quedan
como requisitos verificables, no como preguntas. La procedencia de cada una está en
`design.md §12`, para que dentro de seis meses se sepa quién decidió qué.

### Totales con filtro activo (decisión humana: recalcular)

**R64.** MIENTRAS haya filtro activo, el sistema DEBE hacer IMPOSIBLE confundir el total de lo
filtrado con el total del día. Para eso, el bloque de totales DEBE (a) rotularse diciendo que
habla de lo filtrado, (b) mostrar cuántos mensajeros coinciden de cuántos, y (c) exponer ese
estado en el DOM con un atributo propio, de modo que un test pueda distinguir «totales del día»
de «totales de lo filtrado» sin leer texto.

**R65.** La identidad de los ocho sumandos (R3) DEBE seguir cumpliéndose en los totales
recalculados; el sistema NO DEBE tener dos implementaciones distintas de esa suma.

### Barra apilada de composición (decisión humana: entra)

**R66.** El sistema DEBE mostrar una barra apilada con la composición de los ocho contadores en
el bloque de totales y en cada tarjeta de mensajero.

**R67.** Cada segmento de la barra DEBE tomar su color de un token de `app/globals.css`; el
sistema NO DEBE escribir hex sueltos ni utilidades de paleta cruda de Tailwind para pintarla.

**R68.** El color NO DEBE ser el único portador del dato: cada segmento DEBE tener su cifra y su
etiqueta legibles fuera de la barra, y la barra entera DEBE llevar un nombre accesible que
enumere los ocho valores.

**R69.** Los segmentos DEBEN derivarse del MISMO dato que alimenta los ocho contadores; SI un
contador vale cero, ENTONCES su segmento NO DEBE pintarse.

**R70.** La barra de una tarjeta DEBE sumar el 100 % de las `asignadas` de esa tarjeta, y la del
bloque de totales el 100 % de las `asignadas` que ese bloque publique en ese momento.

### Avatar de iniciales (decisión humana: entra)

**R71.** La tarjeta de mensajero y la cabecera del detalle DEBEN mostrar un avatar con las
iniciales derivadas del nombre que ya viaja en la fila; el avatar DEBE ser decorativo y el
nombre completo DEBE seguir presente como texto.

### La serie puede retroceder (decisión humana: se acepta)

**R72.** El sistema DEBE recalcular la serie completa en cada lectura; SI la última gestión del
día de una orden deja de ser `entregada`, ENTONCES su punto DEBE dejar de contarla y el
acumulado de esa hora PUEDE decrecer entre dos refrescos. Ese decrecimiento es comportamiento
CORRECTO —es lo que hace cierto R52— y DEBE quedar fijado por un test que lo afirme como
esperado, no como tolerancia.

### Frontera de esta ficha

**R73.** El filtro por nombre NO DEBE escribirse en la URL; el único parámetro de estado de la
ruta sigue siendo `?mensajero=`.

**R74.** El sistema NO DEBE modificar `tests/unit/components/analytics-paquete-guard.test.ts` ni
ampliar el confinamiento de `recharts`; ningún archivo del árbol de la feature DEBE contener un
import literal de `recharts`.

**R75.** El tamaño de página del detalle DEBE salir de `ordenesConfig.DEFAULT_PAGE_SIZE`; el
sistema NO DEBE escribir ningún literal numérico de tamaño de página en el árbol de la feature.

### La línea se REUSA, no se dibuja (decisión humana: `GraficaLineas`)

**R76.** El sistema DEBE pintar la línea de entregas acumuladas montando el componente
`GraficaLineas` del paquete de gráficas; NO DEBE dibujar un SVG propio ni reimplementar sus
estados de carga, vacío y error.

**R77.** El sistema DEBE adaptar la serie del backend al contrato de series del paquete en una
función PURA del árbol de la ruta, testeable sin DOM; y esa adaptación NO DEBE producir más
puntos de los que el paquete acepta sin recortar.

**R78.** El montaje de la línea NO DEBE meter `recharts` en la carga inicial de `/monitoreo`: el
lienzo DEBE seguir llegando por importación diferida.
