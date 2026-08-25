# Feature 278 — Desglose de tareas

> Cada tarea es pequeña, verificable y trae su criterio de **hecho**. `[P]` = puede ir en
> paralelo con las de su misma tanda. Al final, la tabla de trazabilidad `R<n>` → test.
>
> Gate: `./init.sh --rapido` en cada tanda; el completo antes de release. La ficha **no**
> toca migraciones ni `lib/types/`, así que el modo rápido no debería negarse; si se niega,
> se corre el completo y se anota por qué.

---

## Tanda 0 — Medir antes de escribir

- [ ] **T0.1 — Medir el agujero del quitador en el archivo del menú.**
  Escribir un script de un solo uso (a archivo, no inline) que imprima:
  (a) si `quitarComentarios(fuente de lib/auth/menu-visibility.ts)` contiene la cadena
  `"/recepcion-satelite"`; (b) cuántas líneas del tramo de `SIDEBAR_ITEMS` quedan vacías
  tras la pasada; (c) la línea exacta que abre el bloque.
  **Hecho:** el número y la línea quedan en `progress/impl_278.md`, y el script borrado.
  Si resultara que el fuente SÍ es legible, D7 del design se re-decide en vez de aplicarse
  a ciegas. *(Una imposibilidad razonada no es una imposibilidad medida.)*

- [ ] **T0.2 [P] — Fotografiar el verde de partida.**
  Correr y anotar el resultado de los archivos que esta ficha va a mover:
  `RecepcionSateliteModule`, `PorAceptarSection`, `SateliteSeleccionOtrasPaginas`,
  `RecepcionSatelitePage`, `AppLayout`, `Sidebar`, `menu-visibility`, `destino-post-login`.
  **Hecho:** conteo de tests verde ANTES del cambio, en la bitácora. Sin esto, un rojo
  posterior no tiene culpable.

---

## Tanda 1 — El menú (independiente del resto)

- [ ] **T1.1 — `lib/auth/menu-visibility.ts`: el ítem del satélite gana `children`.**
  Etiqueta del padre intacta («Órdenes»), `href` del padre intacto, dos hijos en el orden
  firmado. Comentario nuevo que diga POR QUÉ se parte y por qué el `href` del padre se
  conserva (patrón «Entregas»), **sin escribir ninguna ruta con comodín** (R33).
  **Hecho:** typecheck verde y `SIDEBAR_ITEMS` expone los dos hijos. Depende de: T0.1.

- [ ] **T1.2 — Tests del menú (valor en runtime, no fuente).**
  En `tests/unit/auth/menu-visibility.test.ts`: caso nuevo «el ítem Órdenes del
  adminSatelite declara Por recibir (primero) y En bodega» + «los subítems heredan la
  visibilidad del padre» (ningún otro rol los alcanza) + actualizar el caso de
  `primerDestino` del `adminSatelite` y el caso diferencial R54 de la 192.
  **Hecho:** los cuatro casos verdes y ninguno derivado de `primerDestino` para su esperado.
  Depende de: T1.1.

- [ ] **T1.3 — `tests/unit/auth/destino-post-login.test.ts`: literal a mano.**
  Cambiar `"/recepcion-satelite"` por la ruta del primer subítem, **a mano**, respetando la
  prohibición escrita en la cabecera del archivo de derivarlo de `primerDestino`. Anotar en
  el propio caso la fecha y la decisión (ficha 278).
  **Hecho:** el caso verde y la cabecera del archivo sigue diciendo por qué el valor va a
  mano. Depende de: T1.1.

- [ ] **T1.4 — `tests/components/AppLayout.test.tsx`: el caso del `adminSatelite`.**
  Reexpresar: hoy busca un ENLACE con `href="/recepcion-satelite"`; pasa a afirmar el
  disparador desplegable «Órdenes» y sus dos subenlaces. **Se conserva** la mitad negativa
  (no ve `/ordenes`) y se conserva que no ve «Configuración».
  **Hecho:** el caso verde, con las dos mitades (positiva y negativa) presentes.
  Depende de: T1.1.

- [ ] **T1.5 [P] — `tests/components/Sidebar.test.tsx`.**
  (a) Caso nuevo: con la ruta de un subítem del satélite activa, ese subítem queda
  `aria-current="page"` y su padre desplegado. (b) Corregir el comentario de `linkPorHref`
  (líneas 57–63): ya no hay dos ítems «Órdenes» que sean ENLACE; el del satélite es un
  disparador.
  **Hecho:** caso verde y comentario que describe el árbol real. Depende de: T1.1.

---

## Tanda 2 — Las rutas

- [ ] **T2.1 — `app/(app)/recepcion-satelite/en-bodega/page.tsx`.**
  Mueve, tal cual, el Server Component de hoy (gate de rol, las seis lecturas, degradaciones
  suaves). Cambia: el `title` a «En bodega», la descripción, y baja `hayPorRecibir` en vez
  de `porRecibir`.
  **Hecho:** la pantalla renderiza el listado con datos de prueba y el gate de rol sigue
  lanzando `notFound`. Depende de: T3.1 (por la prop nueva).

- [ ] **T2.2 — `app/(app)/recepcion-satelite/por-recibir/page.tsx`.**
  Server Component nuevo: mismo gate de rol, UNA sola lectura (`listarRecepcionSatelite`),
  `notFound` si no responde `ok`, `title` «Por recibir». Baja `porRecibir`, `zonaNombre` y
  `sinZona` al módulo nuevo.
  **Hecho:** con rol distinto lanza `notFound` sin consultar datos; con `adminSatelite`
  pinta el módulo. Depende de: T3.2.

- [ ] **T2.3 — `app/(app)/recepcion-satelite/page.tsx` pasa a redirect.**
  `redirect("/recepcion-satelite/por-recibir")`, sin gate propio, con el comentario que
  explique por qué la ruta no se borra (enlaces viejos, historial, PWA instalada) — copiando
  el precedente de `mis-asignaciones/page.tsx`.
  **Hecho:** el archivo no importa ninguna acción ni el resolver de sesión.
  Depende de: T2.2.

---

## Tanda 3 — Los módulos cliente

- [ ] **T3.1 — `RecepcionSateliteModule.tsx`: queda solo «En bodega».**
  Se retira: el bloque JSX de «Por recibir» entero, `aceptarRecepcion`, el import de
  `recibirLote` y la prop `porRecibir`. Se añade `hayPorRecibir: boolean`. El escáner SIGUE
  montado, con la condición `!sinZona && hayPorRecibir`. `releerBodega` **conserva**
  `router.refresh()` **+** `mutate()` (design §6). El aviso de zona ausente pasa a
  `AvisoSinZonaSatelite`.
  **Hecho:** typecheck verde; el módulo no menciona `recibirLote`; el `onRecibida` del
  escáner sigue llamando a la relectura completa. Depende de: T3.3.

- [ ] **T3.2 — `PorRecibirModule.tsx` (nuevo).**
  Escáner + `PorAceptarSection` con `renderItem` de `SateliteOrderCard` **sin acciones** +
  `AvisoSinZonaSatelite`. Su relectura tras el QR es `router.refresh()` y nada más.
  Reglas de visibilidad idénticas a las de hoy: sin zona, solo el aviso; sin órdenes, el
  vacío y sin escáner.
  **Hecho:** typecheck verde y ni un `<Button>` en el árbol del módulo.
  Depende de: T3.3, T3.4.

- [ ] **T3.3 — `AvisoSinZonaSatelite.tsx` (nuevo).**
  El aviso `role="alert"` con el MISMO texto de hoy, exportando también el literal para que
  los tests puedan afirmarlo sin copiarlo.
  **Hecho:** un solo sitio en el árbol contiene ese texto (comprobado por búsqueda).

- [ ] **T3.4 — `PorAceptarSection.tsx`: fuera las piezas del botón, y el comentario deja de
  mentir.**
  Fuera `onAceptarUna`, `textoBotonUna`, `mostrarAcciones`, el `CardAction` + `<Button>` y
  su import. Cabecera y JSDoc reescritos (R4): único consumidor real, sin acción por-orden y
  sin acción en lote. **No se mueve el archivo ni su test.**
  **Hecho:** typecheck verde en todo el árbol y el archivo ya no contiene las afirmaciones
  falsas enumeradas en design §8.

- [ ] **T3.5 — `SateliteOrderCard.tsx`: fuera la prop `acciones`.**
  Con su contenedor y su JSDoc.
  **Hecho:** typecheck verde; ningún consumidor la pasaba (comprobado antes de borrar).

---

## Tanda 4 — Los tests que hoy afirman el botón (no se borran)

> Regla común (R29): **cada ausencia con un control positivo al lado, en el mismo caso.**
> Un `queryByText` que deja de encontrar algo pasa igual de verde si el render entero se
> rompió.

- [ ] **T4.1 — `tests/components/RecepcionSateliteModule.test.tsx`.**
  (a) Los tres casos que afirman «Aceptar» (`la sección Por recibir expone Aceptar
  por-orden`, `NO hay Aceptar todas`, `Aceptar de una fila envía solo ese ordenId`) se
  reexpresan: esta pantalla **no tiene** región «Por recibir» ni ningún botón «Aceptar», y
  **sí tiene** la región del listado con sus filas (control positivo).
  (b) Caso nuevo R22: recibir por guía desde «En bodega» mete la orden en el listado sin
  recargar (se afirma que la lectura paginada se repitió **y** que la fila aparece).
  (c) Casos de `sinZona`, escáner y avisos reapuntados a las reglas nuevas (R24/R27/R28).
  (d) `renderModule` pasa `hayPorRecibir` en vez de `porRecibir`.
  **Hecho:** el archivo verde, sin ningún caso borrado sin sustituto, y con el mapa de
  reexpresiones anotado en la bitácora. Depende de: T3.1.

- [ ] **T4.2 — `tests/components/PorAceptarSection.test.tsx`.**
  Los casos `'aceptar' por-orden invoca onAceptarUna`, `NO ofrece acción en lote` y
  `con mostrarAcciones=false lista sin botones` se funden en: «la sección no pinta NINGÚN
  botón, ni en la tarjeta por defecto ni con `renderItem`, y sí pinta el título, el banner
  del contador y cada orden» (control positivo).
  **Hecho:** el archivo verde y su cabecera explica qué se retiró y por qué (ficha 278).
  Depende de: T3.4.

- [ ] **T4.3 — `tests/components/paginacion/SateliteSeleccionOtrasPaginas.test.tsx`.**
  Sustituir el disparador de `releerListado`: de pulsar «Aceptar» a recibir por QR
  (design §11). Se conserva el `waitFor` positivo sobre las remisiones visibles. Se monta
  con `hayPorRecibir: true` y `recibirPorQr` doblado a `ok`.
  **Hecho:** los seis casos del archivo verdes, con el mismo número de aserciones que antes.
  Depende de: T3.1.

- [ ] **T4.4 — `tests/components/RecepcionSatelitePage.test.tsx` se parte en tres bloques.**
  (1) La ruta vieja redirige a «Por recibir», sin resolver sesión ni consultar datos
  (molde: `MisAsignacionesPage.test.tsx:103-117`), y su destino coincide con el aterrizaje
  post-login del `adminSatelite`. (2) La página «Por recibir»: gate de rol, H1, escáner y
  tarjetas. (3) La página «En bodega»: gate de rol, H1, listado y los dos avisos de cierres
  que el archivo ya cubre.
  **Hecho:** los tres bloques verdes; ningún caso de acceso por rol perdido.
  Depende de: T2.1, T2.2, T2.3.

- [ ] **T4.5 — `tests/components/PorRecibirModule.test.tsx` (nuevo).**
  Casos: tarjetas sin ningún botón (con control positivo: la remisión y el detalle están);
  el escáner presente con zona y órdenes; `sinZona` → solo el aviso; sin órdenes → vacío y
  sin escáner; tras recibir por guía se relee del servidor; y la pantalla NO monta listado,
  filtros, paginación ni acciones de lote (con control positivo de que la región «Por
  recibir» sí está).
  **Hecho:** archivo verde y cada ausencia con su positivo. Depende de: T3.2.

---

## Tanda 5 — Las guardias

- [ ] **T5.1 — `tests/unit/guards/satelite-sin-boton-aceptar.guardia.test.ts` (nuevo).**
  Molde: `tests/unit/guards/entregas-sin-recoleccion.test.ts`. Ámbito y prohibidos según
  design §10, más los tres casos de anti-vacuidad (existencia de archivos, anclaje positivo
  en el texto ya sin comentarios, y detección disparando sobre una cadena de control).
  Incluye el caso de R33: ninguna línea que mencione una subruta del satélite abre un bloque
  de comentario. **El sidebar queda FUERA del censo de fuente**, con el motivo escrito y
  apuntando a T0.1.
  **Hecho:** guardia verde y con su caso de control positivo. Depende de: T3.1–T3.5, T0.1.

- [ ] **T5.2 — Matar los tests nuevos con mutaciones deliberadas.**
  Cuatro mutaciones, una a una, comprobando que **algo se pone rojo** y anotando qué:
  (a) devolver el `<Button>` dentro de `renderItem` → deben romper T4.5 y T5.1;
  (b) devolver `onAceptarUna`/`textoBotonUna` a la sección → T4.2 y T5.1;
  (c) quitar el `mutate()` de `releerBodega` → T4.1(b);
  (d) quitar los `children` del ítem del menú → T1.2, T1.3, T1.4.
  **Hecho:** las cuatro mutaciones revertidas y la tabla «mutación → test que la mató» en
  `progress/impl_278.md`. Si alguna sobrevive, el test correspondiente no vale y se
  reescribe. Depende de: tandas 4 y 5.1.

---

## Tanda 6 — Arrastres (baratos, no ejecutables)

- [ ] **T6.1 [P] — Rutas de los e2e.**
  `e2e/recepcion-satelite.spec.ts:62` → `/recepcion-satelite/por-recibir`;
  `e2e/asignacion-satelite.spec.ts:64`, `e2e/reglas-bloqueos-cierre.spec.ts:115` y `:201`
  → `/recepcion-satelite/en-bodega`.
  **Hecho:** las cuatro líneas apuntan a la pantalla que su caso describe. **No se afirma
  que pasen**: estos specs siguen sin ejecutarse en este repo, y así se anota.

- [ ] **T6.2 [P] — `docs/release.md`.**
  La línea de verificación manual «Corregir el día desde `/recepcion-satelite`» pasa a
  nombrar `/recepcion-satelite/en-bodega`.
  **Hecho:** la ruta del documento existe en el árbol.

- [ ] **T6.3 — Bitácora y ficha.**
  `progress/impl_278.md` con: medición de T0.1, mapa de reexpresiones de la tanda 4, tabla
  de mutaciones de T5.2 y las preguntas abiertas que el humano haya cerrado.
  `feature_list.json`: `status_note` de 3–6 líneas y `spec_path`.
  **Hecho:** la ficha no repite lo que ya está en `progress/`.

- [ ] **T6.4 — Gate.**
  `./init.sh --rapido` verde, con `INIT_EXIT=$?` escrito DENTRO del log (un `echo` posterior
  tapa el código de salida). Si el diff tocara cimientos y el rápido se negara, se corre el
  completo.
  **Hecho:** log con el exit code y el conteo de tests, en la bitácora.

---

## Trazabilidad — cada `R<n>` con su test

| R | Qué afirma | Dónde vive el test |
| --- | --- | --- |
| R1 | ninguna vía de recepción en las tarjetas | `PorRecibirModule.test.tsx` «las tarjetas no ofrecen ningún botón (y la remisión sí está)» + `satelite-sin-boton-aceptar.guardia.test.ts` |
| R2 | las tarjetas siguen listándose, sin acción | `PorRecibirModule.test.tsx` «lista cada orden con su remisión, su estado legible y su detalle, sin botones» |
| R3 | la sección sin piezas del botón | `PorAceptarSection.test.tsx` «no pinta ningún botón, ni por defecto ni con renderItem» + typecheck |
| R4 | el comentario deja de mentir | `satelite-sin-boton-aceptar.guardia.test.ts` «el fuente de PorAceptarSection no afirma que la comparta el mensajero ni que ofrezca acción en lote» |
| R5 | la tarjeta sin hueco de acción | `PorRecibirModule.test.tsx` «la tarjeta no monta pie de acciones (y sí el desplegable de detalle)» + typecheck |
| R6 | el QR intacto | `tests/components/EscanerRecepcion.test.tsx` (sin editar) + `PorRecibirModule.test.tsx` «ofrece cámara y número tecleado» |
| R7 | el servidor no se toca | `tests/unit/services/recepcion-satelite-service.test.ts` y `tests/unit/actions/recepcion-satelite-action.test.ts` verdes **sin editarse** + revisión de diff (sin cambios en `lib/`, `db/`) |
| R8 | dos subítems en orden | `menu-visibility.test.ts` «el ítem Órdenes del adminSatelite declara Por recibir (primero) y En bodega» |
| R9 | padre desplegable, hijos enlaces | `AppLayout.test.tsx` «el adminSatelite ve el disparador Órdenes y sus dos subenlaces» |
| R10 | herencia de visibilidad | `menu-visibility.test.ts` «los subítems del satélite solo los alcanza el adminSatelite» |
| R11 | subítem activo, padre abierto | `Sidebar.test.tsx` «con la ruta del subítem activo, queda aria-current y el padre desplegado» |
| R12 | aterrizaje post-login | `destino-post-login.test.ts` «adminSatelite aterriza en /recepcion-satelite/por-recibir» (literal a mano) + `menu-visibility.test.ts` caso diferencial R54 |
| R13 | el redirect | `RecepcionSatelitePage.test.tsx` «/recepcion-satelite redirige a Por recibir sin resolver sesión ni consultar datos» |
| R14 | una sola puerta | `RecepcionSatelitePage.test.tsx` «el destino del redirect es el mismo que el aterrizaje post-login del adminSatelite» |
| R15 | contenido de «Por recibir» | `RecepcionSatelitePage.test.tsx` bloque 2 + `PorRecibirModule.test.tsx` |
| R16 | «Por recibir» sin nada del listado | `PorRecibirModule.test.tsx` «no monta listado, filtros, paginación ni acciones de lote (y sí la región Por recibir)» |
| R17 | contenido de «En bodega» | `RecepcionSateliteModule.test.tsx` (casos vigentes del listado) + `RecepcionSatelitePage.test.tsx` bloque 3 |
| R18 | «En bodega» sin las órdenes por recibir | `RecepcionSateliteModule.test.tsx` «no existe la región Por recibir (y sí la del listado)» + contrato `hayPorRecibir` en typecheck |
| R19 | gate de rol en las dos | `RecepcionSatelitePage.test.tsx` bloques 2 y 3, «rol distinto → notFound sin consultar datos» |
| R20 | títulos | `RecepcionSatelitePage.test.tsx` bloques 2 y 3, H1 «Por recibir» / «En bodega» |
| R21 | relectura tras QR en «Por recibir» | `PorRecibirModule.test.tsx` «tras recibir por guía se relee del servidor» |
| R22 | relectura tras QR en «En bodega» | `RecepcionSateliteModule.test.tsx` «recibir por guía mete la orden en el listado sin recargar» |
| R23 | el resto de acciones releen igual | `RecepcionSateliteModule.test.tsx` (casos vigentes de enviar a central / recuperar / asignar) + `SateliteSeleccionOtrasPaginas.test.tsx` |
| R24 | avisos y manifiesto solo en «En bodega» | `RecepcionSateliteModule.test.tsx` (bloqueo, cierres, liberadas) + `PorRecibirModule.test.tsx` «no monta ninguno de los tres avisos de bodega» |
| R25 | el aviso de zona, mismo texto | `PorRecibirModule.test.tsx` y `RecepcionSateliteModule.test.tsx`, ambos contra el literal exportado por `AvisoSinZonaSatelite` |
| R26 | sin zona en «Por recibir» | `PorRecibirModule.test.tsx` «sin zona: solo el aviso, ni escáner ni tarjetas» |
| R27 | sin zona en «En bodega» | `RecepcionSateliteModule.test.tsx` «sin zona: el listado sigue, el escáner no» |
| R28 | sin nada por recibir, sin escáner | `PorRecibirModule.test.tsx` «sin órdenes: el vacío y sin escáner» + `RecepcionSateliteModule.test.tsx` «sin nada por recibir no hay escáner (y el listado sí)» |
| R29 | los tres archivos reexpresados | los propios `RecepcionSateliteModule.test.tsx`, `PorAceptarSection.test.tsx` y `SateliteSeleccionOtrasPaginas.test.tsx` + T5.2(a)(b) |
| R30 | guardia de no-reintroducción | `satelite-sin-boton-aceptar.guardia.test.ts` |
| R31 | la guardia ve lo que dice ver | `satelite-sin-boton-aceptar.guardia.test.ts` «los archivos existen», «el texto sin comentarios conserva su anclaje», «la detección dispara sobre la cadena de control» |
| R32 | el sidebar se juzga por valor | `menu-visibility.test.ts` (afirma sobre `SIDEBAR_ITEMS` importado) + caso de la guardia que declara el sidebar fuera del censo de fuente |
| R33 | comentarios que no abren bloque | `satelite-sin-boton-aceptar.guardia.test.ts` «ninguna línea que nombre una subruta del satélite contiene una apertura de bloque» |

**Sin test = requisito incumplido.** Si alguna casilla se queda sin nombre concreto al
implementar, se para y se dice, no se rellena con un test que pase por casualidad.
