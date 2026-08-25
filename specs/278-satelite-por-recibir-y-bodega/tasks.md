# Feature 278 — Desglose de tareas

> Cada tarea es pequeña, verificable y trae su criterio de **hecho**. `[P]` = puede ir en
> paralelo con las de su misma tanda. Al final, la tabla de trazabilidad `R<n>` → test.
>
> Gate: `./init.sh --rapido` en cada tanda; el completo antes de release. La ficha **no**
> toca migraciones ni `lib/types/`, así que el modo rápido no debería negarse; si se niega,
> se corre el completo y se anota por qué.

---

## Tanda 0 — Medir antes de escribir

- [x] **T0.1 — Medir el agujero del quitador en el archivo del menú (el ANTES de Q4).**
  Script de un solo uso (a archivo, no inline) que imprima sobre
  `lib/auth/menu-visibility.ts`, pasado por `quitarComentarios`:
  (a) líneas no vacías que sobreviven; (b) si el texto barrido contiene `label: "Incidentes"`;
  (c) si contiene `"/recepcion-satelite"`; (d) la línea exacta que abre el bloque.
  **Hecho:** los cuatro valores en `progress/impl_278.md`, y el script borrado. Esperado:
  (b) y (c) `false`, (d) = la línea del comodín. **Si (b) o (c) salieran `true`, el agujero
  no está donde se cree**: se para y se re-decide §16 en vez de aplicarla a ciegas.
  *(Una imposibilidad razonada no es una imposibilidad medida.)*

- [x] **T0.2 — Verificar que el QR no comparte camino con el lote (el permiso para Q2).**
  Comprobar en el árbol, y anotar con archivo:línea, que: (a) `recibir()` llama a
  `recibirEnSatelite` y `recibirLote()` a `recibirLoteEnSatelite`; (b)
  `recibirLoteEnSatelite` tiene **un solo** llamador en `lib/`, `app/` y `scripts/`;
  (c) `distinct()` solo lo usa `recibirLote`.
  **Hecho:** las tres comprobaciones en la bitácora. **Si alguna falla, se para**: la
  retirada dejaría de ser segura y eso es una pregunta para el humano, no una decisión del
  implementador.

- [x] **T0.3 [P] — Fotografiar el verde de partida.**
  Correr y anotar el resultado de los archivos que esta ficha va a mover:
  `RecepcionSateliteModule`, `PorAceptarSection`, `SateliteSeleccionOtrasPaginas`,
  `RecepcionSatelitePage`, `AppLayout`, `Sidebar`, `menu-visibility`, `destino-post-login`,
  `recepcion-satelite-service`, `recepcion-satelite-action`,
  `orden-repository.recepcion-satelite`, `cotizacion-api-key`.
  **Hecho:** conteo de tests verde ANTES del cambio, en la bitácora. Sin esto, un rojo
  posterior no tiene culpable.

---

## Tanda 1 — El menú (independiente del resto)

- [x] **T1.1 — `lib/auth/menu-visibility.ts`: el ítem del satélite gana `children`.**
  Etiqueta del padre intacta («Órdenes»), `href` del padre intacto, dos hijos en el orden
  firmado. Comentario nuevo que diga POR QUÉ se parte y por qué el `href` del padre se
  conserva (patrón «Entregas»), **sin escribir ninguna ruta con comodín** (R33).
  **Hecho:** typecheck verde y `SIDEBAR_ITEMS` expone los dos hijos. Depende de: T0.1.

- [x] **T1.2 — Tests del menú (valor en runtime, no fuente).**
  En `tests/unit/auth/menu-visibility.test.ts`: caso nuevo «el ítem Órdenes del
  adminSatelite declara Por recibir (primero) y En bodega» + «los subítems heredan la
  visibilidad del padre» (ningún otro rol los alcanza) + actualizar el caso de
  `primerDestino` del `adminSatelite` y el caso diferencial R54 de la 192.
  **Hecho:** los cuatro casos verdes y ninguno derivado de `primerDestino` para su esperado.
  Depende de: T1.1.

- [x] **T1.3 — `tests/unit/auth/destino-post-login.test.ts`: literal a mano.**
  Cambiar `"/recepcion-satelite"` por la ruta del primer subítem, **a mano**, respetando la
  prohibición escrita en la cabecera del archivo de derivarlo de `primerDestino`. Anotar en
  el propio caso la fecha y la decisión (ficha 278).
  **Hecho:** el caso verde y la cabecera del archivo sigue diciendo por qué el valor va a
  mano. Depende de: T1.1.

- [x] **T1.4 — `tests/components/AppLayout.test.tsx`: el caso del `adminSatelite`.**
  Reexpresar: hoy busca un ENLACE con `href="/recepcion-satelite"`; pasa a afirmar el
  disparador desplegable «Órdenes» y sus dos subenlaces. **Se conserva** la mitad negativa
  (no ve `/ordenes`) y se conserva que no ve «Configuración».
  **Hecho:** el caso verde, con las dos mitades (positiva y negativa) presentes.
  Depende de: T1.1.

- [x] **T1.0 — Arreglar el comentario que ciega a las guardias (Q4) y medir el DESPUÉS.**
  En `lib/auth/menu-visibility.ts`, la ruta con comodín del ítem «Entregas» pasa a nombrar
  las dos rutas reales. **No se toca `quitarComentarios`** (R47). Volver a correr la
  medición de T0.1 sobre el archivo arreglado.
  **Hecho:** (b) y (c) de T0.1 pasan a `true`, (a) sube, y los dos juegos de números están
  en la bitácora uno al lado del otro. Va ANTES de T1.1 para que el «después» no mezcle el
  arreglo con los subítems nuevos. Depende de: T0.1.

- [x] **T1.0b — Correr TODAS las guardias tras el arreglo, y comparar.**
  Con ~150 líneas dejando de estar ocultas, cualquier guardia que escanee fuentes ve por
  primera vez ese tramo.
  **Hecho:** el conjunto de guardias verde, o —si alguna se pone roja— **se para y se
  reporta** con el nombre de la guardia y la línea que la dispara: es un hallazgo previo,
  no un daño de esta ficha, y la regla de qué hacer con él es la pregunta **P1** de
  `requirements.md`. Depende de: T1.0.

- [x] **T1.5 [P] — `tests/components/Sidebar.test.tsx`.**
  (a) Caso nuevo: con la ruta de un subítem del satélite activa, ese subítem queda
  `aria-current="page"` y su padre desplegado. (b) Corregir el comentario de `linkPorHref`
  (líneas 57–63): ya no hay dos ítems «Órdenes» que sean ENLACE; el del satélite es un
  disparador.
  **Hecho:** caso verde y comentario que describe el árbol real. Depende de: T1.1.

- [x] **T1.6 — Caso permanente de legibilidad del menú (R46).**
  En `tests/unit/auth/menu-visibility.test.ts`, un `describe` nuevo: (a) ninguna línea del
  archivo abre un bloque de comentario dentro de un comentario de línea; (b) el fuente
  pasado por `quitarComentarios` contiene `label: "Incidentes"` **y** las dos subrutas del
  satélite.
  **Hecho:** los dos casos verdes, y comprobado a mano que (b) FALLA si se revierte T1.0
  (si no falla, el caso no vale). Depende de: T1.0, T1.1.

---

## Tanda 2 — Las rutas

- [x] **T2.1 — `app/(app)/recepcion-satelite/en-bodega/page.tsx`.**
  Mueve, tal cual, el Server Component de hoy (gate de rol, las seis lecturas, degradaciones
  suaves). Cambia: el `title` a «En bodega», la descripción de §3, y **deja de bajar**
  `porRecibir` (no lo sustituye nada).
  **Hecho:** la pantalla renderiza el listado con datos de prueba y el gate de rol sigue
  lanzando `notFound`. Depende de: T3.1.

- [x] **T2.2 — `app/(app)/recepcion-satelite/por-recibir/page.tsx`.**
  Server Component nuevo: mismo gate de rol, UNA sola lectura (`listarRecepcionSatelite`),
  `notFound` si no responde `ok`, `title` «Por recibir». Baja `porRecibir`, `zonaNombre` y
  `sinZona` al módulo nuevo.
  **Hecho:** con rol distinto lanza `notFound` sin consultar datos; con `adminSatelite`
  pinta el módulo. Depende de: T3.2.

- [x] **T2.3 — `app/(app)/recepcion-satelite/page.tsx` pasa a redirect.**
  `redirect("/recepcion-satelite/por-recibir")`, sin gate propio, con el comentario que
  explique por qué la ruta no se borra (enlaces viejos, historial, PWA instalada) — copiando
  el precedente de `mis-asignaciones/page.tsx`.
  **Hecho:** el archivo no importa ninguna acción ni el resolver de sesión.
  Depende de: T2.2.

---

## Tanda 3 — Los módulos cliente

- [x] **T3.1 — `RecepcionSateliteModule.tsx`: queda solo «En bodega».**
  Se retira: el bloque JSX de «Por recibir» entero, `aceptarRecepcion`, el import de
  `recibirLote` y la prop `porRecibir` (**sin sustituto**). El escáner queda montado con la
  condición **`!sinZona`** a secas (R42). `releerBodega` **conserva** `router.refresh()`
  **+** `mutate()` (design §6). El aviso de zona ausente pasa a `AvisoSinZonaSatelite`.
  **Hecho:** typecheck verde; el módulo no menciona `recibirLote`; el `onRecibida` del
  escáner sigue llamando a la relectura completa. Depende de: T3.3.

- [x] **T3.2 — `PorRecibirModule.tsx` (nuevo).**
  Escáner + `PorAceptarSection` con `renderItem` de `SateliteOrderCard` **sin acciones** +
  `AvisoSinZonaSatelite`. Su relectura tras el QR es `router.refresh()` y nada más.
  Visibilidad: **el escáner se monta siempre que haya zona** (R42/R43), con lista vacía
  incluida; sin zona, solo el aviso (R26).
  **Hecho:** typecheck verde, ni un `<Button>` en el árbol del módulo, y la condición del
  escáner no menciona la longitud de la lista. Depende de: T3.3, T3.4.

- [x] **T3.3 — `AvisoSinZonaSatelite.tsx` (nuevo).**
  El aviso `role="alert"` con el MISMO texto de hoy, exportando también el literal para que
  los tests puedan afirmarlo sin copiarlo.
  **Hecho:** un solo sitio en el árbol contiene ese texto (comprobado por búsqueda).

- [x] **T3.4 — `PorAceptarSection.tsx`: fuera las piezas del botón, y el comentario deja de
  mentir.**
  Fuera `onAceptarUna`, `textoBotonUna`, `mostrarAcciones`, el `CardAction` + `<Button>` y
  su import. Cabecera y JSDoc reescritos (R4): único consumidor real, sin acción por-orden y
  sin acción en lote. **No se mueve el archivo ni su test.**
  **Hecho:** typecheck verde en todo el árbol y el archivo ya no contiene las afirmaciones
  falsas enumeradas en design §8.

- [x] **T3.5 — `SateliteOrderCard.tsx`: fuera la prop `acciones`.**
  Con su contenedor y su JSDoc.
  **Hecho:** typecheck verde; ningún consumidor la pasaba (comprobado antes de borrar).

---

## Tanda 3B — La retirada de la recepción EN LOTE (backend)

> **Una sola tanda, un solo commit.** Entre borrar la acción y borrar el método del
> repositorio hay estados que no compilan; el orden es consumidor → contrato (design §17).
> Depende de: T0.2 (el permiso medido) y T3.1 (el consumidor ya retirado).

- [x] **T3B.1 — La Server Action y su borde.**
  Fuera `recibirLote` de `lib/actions/recepcion-satelite.ts` y sus dos imports; fuera
  `recibirLoteSchema`, `RecibirLoteActionInput` y `RecibirLoteResult` de
  `lib/types/recepcion-satelite.ts`.
  **Hecho:** ningún archivo de `app/` ni `lib/` menciona `recibirLote`.

- [x] **T3B.2 — El servicio y su contrato.**
  Fuera el método `recibirLote`, el helper `distinct()`, la clave `"recibirLoteEnSatelite"`
  del `Pick` de dependencias y los dos imports de tipo; fuera `RecibirLoteInput`,
  `RecibirLoteServiceResult` y el método del contrato en
  `lib/interfaces/services/IRecepcionSateliteService.ts`.
  **Hecho:** `RecepcionSateliteService` implementa su interfaz sin residuos y `recibir()`
  queda **idéntico** (se comprueba con `git diff` que no tiene ni una línea tocada).
  Depende de: T3B.1.

- [x] **T3B.3 — El repositorio y su contrato.**
  Fuera `recibirLoteEnSatelite` de `lib/repositories/OrdenRepository.ts` y su declaración en
  `lib/interfaces/repositories/IOrdenRepository.ts`, con sus JSDoc.
  **Hecho:** `recibirEnSatelite` intacto (diff vacío en ese método) y typecheck verde salvo
  por los dobles de test, que caen en T3B.5. Depende de: T3B.2.

- [x] **T3B.4 [P] — La mención en `lib/types/orden-guia.ts`.**
  El comentario que enumera esquemas hermanos deja de nombrar `recibirLoteSchema`.
  **Hecho:** el comentario no nombra ningún esquema inexistente.

- [x] **T3B.5 — Dobles tipados (5 archivos) y censos a mano (2).**
  Dobles: `bulk-orden-service.test.ts:94`, `bulk-orden-service.carga-api.test.ts:194`,
  `orden-service.test.ts:122`, `rol-admin-satelite-authz.test.ts:134`,
  `recepcion-satelite-asignadas.test.ts:30,62` — el typecheck los denuncia uno a uno.
  Censos: `cotizacion-api-key.test.ts:128` (se quita el nombre **y** se le ata
  `as const satisfies readonly (keyof IOrdenRepository)[]`, R41) e
  `inventario-transiciones-140.ts:81` (el `callSite` pasa a nombrar solo
  `RecepcionSateliteService.recibir`).
  **Hecho:** typecheck verde; y comprobado a mano que el `satisfies` nuevo **rompe** si se
  reintroduce un nombre inexistente en la lista (si no rompe, no vale). Depende de: T3B.3.

- [x] **T3B.6 — Los tres archivos cuyo SUJETO era el lote (R40).**
  `recepcion-satelite-service.test.ts` (`describe("recibirLote")` + `Pick` + doble),
  `recepcion-satelite-action.test.ts` (casos del borde del lote),
  `orden-repository.recepcion-satelite.test.ts` (`describe("recibirLoteEnSatelite")`).
  **ANTES de borrar cada caso**, anotar en la bitácora su destino: repuesto por qué caso
  vivo, o muerto con el código y por qué. La tabla de §15.3 es el punto de partida, pero se
  verifica caso por caso contra el archivo, no se copia.
  **Hecho:** la tabla «caso retirado → destino» completa en `progress/impl_278.md`, sin
  ninguna fila vacía, y los tres archivos verdes con lo que queda. Depende de: T3B.3.

- [x] **T3B.7 — El QR sigue vivo, y se demuestra (R38).**
  Comprobar que los casos de `recibir` / `recibirPorQr` en los tres archivos de T3B.6 siguen
  verdes **sin haber sido tocados** (`git diff` de esos bloques, vacío), cubriendo las siete
  guardas: rol, sin zona, zona ajena, estado inválido, no encontrada, idempotente y carrera.
  **Hecho:** las siete nombradas una a una en la bitácora, con el archivo y el caso que las
  sostiene. Depende de: T3B.6.

---

## Tanda 4 — Los tests que hoy afirman el botón (no se borran)

> Regla común (R29): **cada ausencia con un control positivo al lado, en el mismo caso.**
> Un `queryByText` que deja de encontrar algo pasa igual de verde si el render entero se
> rompió.

- [x] **T4.1 — `tests/components/RecepcionSateliteModule.test.tsx`.**
  (a) Los tres casos que afirman «Aceptar» (`la sección Por recibir expone Aceptar
  por-orden`, `NO hay Aceptar todas`, `Aceptar de una fila envía solo ese ordenId`) se
  reexpresan: esta pantalla **no tiene** región «Por recibir» ni ningún botón «Aceptar», y
  **sí tiene** la región del listado con sus filas (control positivo).
  (b) Caso nuevo R22: recibir por guía desde «En bodega» mete la orden en el listado sin
  recargar (se afirma que la lectura paginada se repitió **y** que la fila aparece).
  (c) Casos de `sinZona` y avisos reapuntados a las reglas nuevas (R24/R27).
  (d) **El caso «sin órdenes por recibir no se muestra la tarjeta de recepción ni la
  sección» (l. 315) afirma hoy lo CONTRARIO de R42**: se reexpresa a «sin órdenes por
  recibir el escáner SIGUE ofreciéndose, y la región "Por recibir" no existe en esta
  pantalla» (control positivo: la región del listado sí está). No se borra: cambia de
  sentido con la decisión firmada, y así queda escrito en el caso.
  (e) `renderModule` deja de pasar `porRecibir`.
  **Hecho:** el archivo verde, sin ningún caso borrado sin sustituto, y con el mapa de
  reexpresiones anotado en la bitácora. Depende de: T3.1.

- [x] **T4.2 — `tests/components/PorAceptarSection.test.tsx`.**
  Los casos `'aceptar' por-orden invoca onAceptarUna`, `NO ofrece acción en lote` y
  `con mostrarAcciones=false lista sin botones` se funden en: «la sección no pinta NINGÚN
  botón, ni en la tarjeta por defecto ni con `renderItem`, y sí pinta el título, el banner
  del contador y cada orden» (control positivo).
  **Hecho:** el archivo verde y su cabecera explica qué se retiró y por qué (ficha 278).
  Depende de: T3.4.

- [x] **T4.3 — `tests/components/paginacion/SateliteSeleccionOtrasPaginas.test.tsx`.**
  Sustituir el disparador de `releerListado`: de pulsar «Aceptar» a recibir por QR
  (design §11). Se conserva el `waitFor` positivo sobre las remisiones visibles. El escáner
  está siempre (R42), así que el montaje no prepara nada: solo se dobla `recibirPorQr` a
  `ok`.
  **Hecho:** los seis casos del archivo verdes, con el mismo número de aserciones que antes.
  Depende de: T3.1.

- [x] **T4.3b [P] — Los otros seis montajes del módulo.**
  `SatelitePaginacion.test.tsx:325`, `SateliteDescarga.test.tsx:191,203`,
  `RecepcionSateliteIncidente.test.tsx:155`, `ManifiestoFlujos.test.tsx:386`,
  `CambiarDiaRepartoListados.test.tsx:195`, `deshacer-asignacion.ui.test.tsx:199`: quitar la
  prop `porRecibir` y, ya que se abren, la clave inerte `recibirLote: vi.fn()` de sus
  `vi.mock`.
  **Hecho:** los seis archivos verdes y ninguno menciona ya `recibirLote`.
  Depende de: T3.1, T3B.1.

- [x] **T4.4 — `tests/components/RecepcionSatelitePage.test.tsx` se parte en tres bloques.**
  (1) La ruta vieja redirige a «Por recibir», sin resolver sesión ni consultar datos
  (molde: `MisAsignacionesPage.test.tsx:103-117`), y su destino coincide con el aterrizaje
  post-login del `adminSatelite`. (2) La página «Por recibir»: gate de rol, H1, escáner y
  tarjetas. (3) La página «En bodega»: gate de rol, H1, listado y los dos avisos de cierres
  que el archivo ya cubre.
  **Hecho:** los tres bloques verdes; ningún caso de acceso por rol perdido.
  Depende de: T2.1, T2.2, T2.3.

- [x] **T4.5 — `tests/components/PorRecibirModule.test.tsx` (nuevo).**
  Casos: tarjetas sin ningún botón (con control positivo: la remisión y el detalle están);
  el escáner presente con zona y órdenes; **el escáner presente con zona y la lista VACÍA,
  junto al texto del vacío** (R28/R42 — es el caso que el humano firmó); `sinZona` → solo el
  aviso, sin escáner; tras recibir por guía se relee del servidor; y la pantalla NO monta
  listado, filtros, paginación ni acciones de lote (con control positivo de que la región
  «Por recibir» sí está).
  **Hecho:** archivo verde y cada ausencia con su positivo. Depende de: T3.2.

---

## Tanda 5 — Las guardias

- [x] **T5.1 — `tests/unit/guards/satelite-sin-boton-aceptar.guardia.test.ts` (nuevo).**
  Molde: `tests/unit/guards/entregas-sin-recoleccion.test.ts`. Ámbito y prohibidos según
  design §10, **ampliado con los dos archivos de servidor de los que se retiró el lote**
  (`lib/actions/recepcion-satelite.ts` y `lib/types/recepcion-satelite.ts`: ni `recibirLote`
  ni `recibirLoteSchema` en código ejecutable), más los tres casos de anti-vacuidad
  (existencia de archivos, anclaje positivo en el texto ya sin comentarios —`recibirPorQr`
  en los de servidor, que además demuestra que el QR sigue ahí— y detección disparando
  sobre una cadena de control).
  Incluye el caso de R33: ninguna línea que mencione una subruta del satélite abre un bloque
  de comentario. **El sidebar queda FUERA del censo de fuente**, con el motivo escrito y
  apuntando a T0.1.
  **Hecho:** guardia verde y con su caso de control positivo. Depende de: T3.1–T3.5, T0.1.

- [x] **T5.2 — Matar los tests nuevos con mutaciones deliberadas.**
  Siete mutaciones, una a una, comprobando que **algo se pone rojo** y anotando qué:
  (a) devolver el `<Button>` dentro de `renderItem` → deben romper T4.5 y T5.1;
  (b) devolver `onAceptarUna`/`textoBotonUna` a la sección → T4.2 y T5.1;
  (c) quitar el `mutate()` de `releerBodega` → T4.1(b);
  (d) quitar los `children` del ítem del menú → T1.2, T1.3, T1.4;
  (e) condicionar el escáner a que la lista no esté vacía → T4.5 y T4.1(d);
  (f) volver a escribir el comodín en el comentario del menú → T1.6;
  (g) romper una guarda de `recibir()` en el servicio (p. ej. devolver `ok` con zona ajena)
  → T3B.7: si NO se pone rojo, la retirada del lote se quedó sin red y hay que reponerla
  antes de seguir.
  **Hecho:** las siete mutaciones revertidas y la tabla «mutación → test que la mató» en
  `progress/impl_278.md`. Si alguna sobrevive, el test correspondiente no vale y se
  reescribe. Depende de: tandas 3B, 4 y 5.1.

---

## Tanda 6 — Arrastres (baratos, no ejecutables)

- [x] **T6.1 [P] — Rutas de los e2e.**
  `e2e/recepcion-satelite.spec.ts:62` → `/recepcion-satelite/por-recibir`;
  `e2e/asignacion-satelite.spec.ts:64`, `e2e/reglas-bloqueos-cierre.spec.ts:115` y `:201`
  → `/recepcion-satelite/en-bodega`.
  **Hecho:** las cuatro líneas apuntan a la pantalla que su caso describe. **No se afirma
  que pasen**: estos specs siguen sin ejecutarse en este repo, y así se anota.

- [x] **T6.2 [P] — `docs/release.md`.**
  La línea de verificación manual «Corregir el día desde `/recepcion-satelite`» pasa a
  nombrar `/recepcion-satelite/en-bodega`.
  **Hecho:** la ruta del documento existe en el árbol.

- [x] **T6.3 — Bitácora y ficha.**
  `progress/impl_278.md` con: medición de T0.1, mapa de reexpresiones de la tanda 4, tabla
  de mutaciones de T5.2 y las preguntas abiertas que el humano haya cerrado.
  `feature_list.json`: `status_note` de 3–6 líneas y `spec_path`.
  **Hecho:** la ficha no repite lo que ya está en `progress/`.

- [x] **T6.4 — Gate COMPLETO.**
  `./init.sh` entero, no el rápido: el diff toca `lib/types/`, que es uno de los cimientos
  que mandan al completo (y la ficha ya es `fullstack`). Con `INIT_EXIT=$?` escrito DENTRO
  del log — un `echo` posterior tapa el código de salida— y **sin canalizar por `tail`**,
  que trunca el fichero en origen y deja el rojo sin nombre.
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
| R7 | del servidor solo se retira el lote | revisión de diff: **cero** cambios en `db/`, en migraciones y en RLS; en `lib/` solo las nueve retiradas de §15.2 + T3B.7 (el QR intacto) |
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
| R18 | «En bodega» sin las órdenes por recibir | `RecepcionSateliteModule.test.tsx` «no existe la región Por recibir (y sí la del listado)» + typecheck (la prop deja de existir y nada la sustituye) |
| R19 | gate de rol en las dos | `RecepcionSatelitePage.test.tsx` bloques 2 y 3, «rol distinto → notFound sin consultar datos» |
| R20 | títulos | `RecepcionSatelitePage.test.tsx` bloques 2 y 3, H1 «Por recibir» / «En bodega» |
| R21 | relectura tras QR en «Por recibir» | `PorRecibirModule.test.tsx` «tras recibir por guía se relee del servidor» |
| R22 | relectura tras QR en «En bodega» | `RecepcionSateliteModule.test.tsx` «recibir por guía mete la orden en el listado sin recargar» |
| R23 | el resto de acciones releen igual | `RecepcionSateliteModule.test.tsx` (casos vigentes de enviar a central / recuperar / asignar) + `SateliteSeleccionOtrasPaginas.test.tsx` |
| R24 | avisos y manifiesto solo en «En bodega» | `RecepcionSateliteModule.test.tsx` (bloqueo, cierres, liberadas) + `PorRecibirModule.test.tsx` «no monta ninguno de los tres avisos de bodega» |
| R25 | el aviso de zona, mismo texto | `PorRecibirModule.test.tsx` y `RecepcionSateliteModule.test.tsx`, ambos contra el literal exportado por `AvisoSinZonaSatelite` |
| R26 | sin zona en «Por recibir» | `PorRecibirModule.test.tsx` «sin zona: solo el aviso, ni escáner ni tarjetas» |
| R27 | sin zona en «En bodega» | `RecepcionSateliteModule.test.tsx` «sin zona: el listado sigue, el escáner no» |
| R28 | lista vacía: el vacío **y** el escáner | `PorRecibirModule.test.tsx` «sin órdenes por recibir se dice el vacío y el escáner sigue ofreciéndose» |
| R29 | los tres archivos reexpresados | los propios `RecepcionSateliteModule.test.tsx`, `PorAceptarSection.test.tsx` y `SateliteSeleccionOtrasPaginas.test.tsx` + T5.2(a)(b) |
| R30 | guardia de no-reintroducción | `satelite-sin-boton-aceptar.guardia.test.ts` |
| R31 | la guardia ve lo que dice ver | `satelite-sin-boton-aceptar.guardia.test.ts` «los archivos existen», «el texto sin comentarios conserva su anclaje», «la detección dispara sobre la cadena de control» |
| R32 | el sidebar se juzga por valor | `menu-visibility.test.ts` (afirma sobre `SIDEBAR_ITEMS` importado) + caso de la guardia que declara el sidebar fuera del censo de fuente |
| R33 | comentarios que no abren bloque | `satelite-sin-boton-aceptar.guardia.test.ts` «ninguna línea que nombre una subruta del satélite contiene una apertura de bloque» |
| R34 | sin acción de recepción en lote | `satelite-sin-boton-aceptar.guardia.test.ts` «`lib/actions/recepcion-satelite.ts` no exporta ninguna recepción en lote» + typecheck |
| R35 | sin schema ni tipos del borde | typecheck (nadie los importa) + el caso del guard sobre `lib/types/recepcion-satelite.ts` |
| R36 | el servicio sin el método ni su contrato | `tests/unit/services/recepcion-satelite-service.test.ts` «el `Pick` de dependencias no declara el método en lote» (typecheck del propio archivo) |
| R37 | el repositorio sin el método ni su contrato | `tests/unit/repositories/orden-repository.recepcion-satelite.test.ts` (el `describe` del lote ya no existe; el del singular sí) + typecheck |
| R38 | **el QR sigue vivo, con sus siete guardas** | `recepcion-satelite-service.test.ts` `describe("recibir")`, `recepcion-satelite-action.test.ts` casos de `recibirPorQr`, `orden-repository.recepcion-satelite.test.ts` `describe("recibirEnSatelite")` y `tests/components/EscanerRecepcion.test.tsx` — los cuatro **sin editar**; T3B.7 los enumera y T5.2(g) demuestra que muerden |
| R39 | ningún censo nombra el lote | `tests/integration/cotizacion-api-key.test.ts` (lista + `satisfies`) y `tests/unit/domain/order-status-transiciones.guardia.test.ts` (nombre del caso desde `inventario-transiciones-140.ts`) |
| R40 | cada caso retirado con su destino escrito | T3B.6: tabla «caso → destino» en `progress/impl_278.md`, revisada por el reviewer; sin fila vacía |
| R41 | el censo atado al contrato | `tests/integration/cotizacion-api-key.test.ts` con `as const satisfies readonly (keyof IOrdenRepository)[]` — verificado en T3B.5 metiendo un nombre falso y comprobando que NO compila |
| R42 | escáner siempre, con zona | `PorRecibirModule.test.tsx` «con zona y lista vacía el escáner sigue» + `RecepcionSateliteModule.test.tsx` «el escáner no depende de la lista» + T5.2(e) |
| R43 | la condición es la zona, no el recuento | `PorRecibirModule.test.tsx` «sin zona no hay escáner» + `RecepcionSateliteModule.test.tsx` «sin zona no hay escáner (y el listado sí)» |
| R44 | descripción propia por pantalla | `RecepcionSatelitePage.test.tsx` bloques 2 y 3: cada pantalla muestra SU descripción y ninguna dice «Mis asignaciones» |
| R45 | ningún comentario abre bloque | `tests/unit/auth/menu-visibility.test.ts` «ninguna línea abre un bloque dentro de un comentario de línea» (T1.6a) |
| R46 | el fuente vuelve a ser legible, medido | `tests/unit/auth/menu-visibility.test.ts` «el fuente barrido contiene el último ítem y las dos subrutas» (T1.6b) + los dos juegos de números de T0.1/T1.0 en la bitácora |
| R47 | el quitador no se toca | revisión de diff: `tests/fixtures/sin-comentarios.ts` sin cambios |

**Sin test = requisito incumplido.** Si alguna casilla se queda sin nombre concreto al
implementar, se para y se dice, no se rellena con un test que pase por casualidad.

---

## Marcado de las casillas — 2026-08-24

Las 38 se marcan **sobre evidencia ejecutada**, no a ojo. En este repo marcar a ojo ya produjo un
`tasks.md` que decía 1/46 con 42 hechas.

De dónde sale:

- **El gate COMPLETO**, `./init.sh` con `INIT_EXIT=0` — **1377 archivos / 18.754 tests** — corrido
  por el implementer y **re-corrido por el reviewer** con el número idéntico.
- **La revisión** (`progress/review_278.md`) verificó la trazabilidad **R1–R47** abriendo cada test
  citado, y reinyectó cinco mutaciones que muerden donde la tabla dice.
- **T0.1/T1.0**: la medida del agujero está reproducida por tres partes con SHAs explícitos —
  **76 → 160** líneas visibles, tramo falso de **151** (228→378), confirmado con `awk`.
- **T1.0b**: 141 archivos / 2.096 casos de guardias en verde **antes** de añadir los subítems, para
  que cualquier rojo fuera atribuible solo al arreglo del comentario. La aritmética la comprobó el
  reviewer contra el total de HEAD (142 / 2.140 menos la guardia nueva, 1 / 44).

**Lo que NO cuenta como hecho y queda dicho:** los **e2e siguen `NOT EXECUTED`**. Las cuatro rutas
se corrigieron **por lectura** y así está escrito en cada archivo; no se afirma que pasen y no se
cuentan como cobertura.

**Y una casilla se marca dos veces por una razón:** la de **R22** estuvo verde sin cubrir nada —el
contador que leía lo movía la revalidación de montaje de SWR, no el `mutate()`— hasta que el
reviewer lo destapó (B2). Se reexpresó anclándola a una fila sentinela que solo aparece si la
lectura nueva aterrizó, y **se re-midió en corrida completa**: sin `mutate()` la suite pasa de
`18.754 passed` a `4 failed`. La primera remedición era la foto de `-t` y no reproducía.
