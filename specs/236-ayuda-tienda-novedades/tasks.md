# Feature 236 — Tareas

> Leer antes: `requirements.md` (R1-R47) y `design.md`.
>
> **Gate:** `./init.sh --rapido` para cerrar cada tanda; **`./init.sh` completo antes del PR, sin
> excepción**. El gate **no** se corre en paralelo con un subagente que muta el árbol: leería el árbol
> mutado y su veredicto no valdría.
>
> **Punto de despliegue.** Sólo T1 es inerte (un módulo puro sin consumidores). **T2 a T6 van
> obligatoriamente en un solo PR**: si el corte del servidor sale sin la pestaña, las órdenes en
> ayuda **desaparecen de `/novedades`** con el árbol verde — invisibles para la tienda, que es peor
> que hoy.
>
> **Zona `fullstack` ⇒ se secuencia backend → frontend.** T1-T3 con el subagente de **backend**,
> T4-T6 con el de **frontend**, nunca a la vez sobre los mismos archivos.

---

## T0 — Puerta humana: medir y firmar (sin código)

- [ ] **T0.1 — Re-medir contra producción** vía MCP de Supabase, **solo lectura**, con las consultas
      **ya escritas** en `progress/medicion_236.md` §4: (a) población por estatus, para saber si
      `devuelta` y `ayuda_tienda` siguen en cero; (b) notas de orden vivas y órdenes con nota.
      **Hecho:** los números pegados en `progress/impl_236.md` con su fecha y **con su denominador**
      (un cero sin denominador no dice nada).
      ⏳ **Cuándo:** la foto del 2026-08-19 vale para **especificar**; se re-mide **antes de
      desplegar**, no antes de mergear. **Bloquea el despliegue, no T1.**
      > Lo que la re-medición puede cambiar: si ya hay órdenes en `ayuda_tienda`, la ficha pasa de
      > **prospectiva** a **correctiva** —hay solicitudes reales esperando lectura desde el primer
      > minuto— y el aviso a las tiendas deja de ser opcional.
- [x] **T0.2 — Firmar las decisiones abiertas.** **D1** (qué muestra la pestaña), **D2** («Habilitar»
      conserva la nota), **D3** (la descarga), **D4** (escribir sin rescatar), **D5** (dónde se monta
      el hilo), **D6** (**todos los textos**), **D7** (el orden de la lista), **D8** («Habilitar» que
      no mueve nada).
      **Hecho:** cada una respondida en `requirements.md` bajo «PUERTA HUMANA PASADA» y transcrita en
      `progress/impl_236.md`. Si alguna se aparta de la recomendación, **el spec se corrige antes de
      escribir código**. **Bloquea T1.**
      > **D6 y D8 son las que no se pueden diferir.** D6 porque el copy atraviesa cinco tandas y
      > cambiarlo después toca todos los tests de texto. D8 porque mueve un contrato que la **240**
      > también va a tocar.

---

## T1 — La declaración única *(inerte: puede salir suelta)*

- [x] **T1.1 — `lib/types/novedad-grupo.ts`** (módulo puro): `GrupoNovedad`, `GRUPOS_NOVEDAD` (que
      además fija el **orden de las pestañas**), `ESTATUS_POR_GRUPO` con
      `satisfies Record<GrupoNovedad, OrderStatusValue>`, y `grupoDeEstatus()` **derivado del mapa**.
      **Hecho:** `tests/unit/types/novedad-grupo.test.ts` afirma: los dos grupos están declarados;
      los dos valores existen en `ORDER_STATUS_SEED`; `grupoDeEstatus` es **la inversa exacta** del
      mapa (no un segundo literal — se comprueba recorriendo el `Record`); un estatus ajeno devuelve
      `null`; y `GRUPOS_NOVEDAD` cubre **todas** las claves del mapa. **Depende de:** T0.2.
      **Cubre:** R5 (mitad), R6 (mitad), R7.

**R cubiertos por T1:** R5 (mitad), R6 (mitad), R7.

---

## T2 — El corte en el servidor *(mismo PR que T3-T6; subagente de backend)*

- [x] **T2.1 — `novedadWhere(tiendaId, grupo)`**: pierde el `OR` y pasa a ser una igualdad tomada de
      `ESTATUS_POR_GRUPO`. **El nombre del método NO cambia** (`design.md` §2.2: la guardia del hilo
      lo localiza por nombre).
      **Hecho:** `tests/unit/repositories/orden-repository.novedades.test.ts` actualizado con nota
      fechada: por **cada** grupo de `GRUPOS_NOVEDAD` el `where` es `{ tiendaId, deletedAt: null,
      estatus: { value } }` y **nada más** (`Object.keys(where).sort()` fijado); ninguna rama lleva
      clave hermana; el cuerpo no menciona ninguna marca persistida. **Depende de:** T1.1.
- [x] **T2.2 — El rename y el grupo obligatorio**: `countNovedadesByTienda(tiendaId, grupo)` y
      `findNovedadesByTienda(tiendaId, grupo, pagination)` en `IOrdenRepository` y en el repositorio.
      **Hecho:** el typecheck **rompe** en todo call-site que no pase grupo — esa es la señal
      buscada—; ningún método conserva el nombre viejo. **Depende de:** T2.1.
- [x] **T2.3 — La invariante, ahora iterando los grupos.** El caso «count y find comparten
      EXACTAMENTE el mismo where» pasa a recorrer `GRUPOS_NOVEDAD`.
      **Hecho:** el caso itera (no se duplica a mano), así que un grupo nuevo entra **solo** a la
      aserción; y un caso testigo afirma que **una orden de un grupo no casa el predicado del otro**.
      **Depende de:** T2.2. **Cubre:** R4, R9.
- [x] **T2.4 — [P] El servicio gana el grupo.** `listar({ page, pageSize, grupo })` y
      `listarCompleto({ grupo })`, **sin partirse en dos** (`design.md` §3). Para el grupo `ayuda`
      **no se consulta la causa** y el DTO la emite `null`.
      **Hecho:** `tests/unit/services/NovedadesService.test.ts` con: rol distinto de `adminTienda`
      → `forbidden` **antes** de tocar el repo, en los dos grupos y en los dos métodos; para `ayuda`
      `findCausasDevueltaVigentes` **no se llama**; el alcance sale del actor y nunca del input.
      **Depende de:** T2.2. **Cubre:** R10, R11, R26 (mitad).
- [x] **T2.5 — El orden de la lista de ayuda (D7).** `findFechaSolicitudAyuda(ordenIds)` —**una**
      consulta agregada por página, molde de `findCausasDevueltaVigentes`— y el servicio ordena el
      grupo `ayuda` por esa fecha, con `createdAt` como fallback documentado.
      **Hecho:** un caso afirma **una sola** llamada para toda la página (nunca una por fila), otro
      el orden resultante, y otro que una orden sin fecha de solicitud cae al fallback sin romper.
      **Depende de:** T2.4. **Cubre:** R17.
- [x] **T2.6 — Las dos Server Actions nuevas.** `listarAyudaTiendaAction` y
      `listarAyudaTiendaCompletoAction`, espejo literal de las de devoluciones. **El grupo NO viaja en
      el input** (`design.md` §4).
      **Hecho:** `tests/unit/actions/novedades-ayuda.test.ts`: sin sesión → `unauthenticated` **sin
      tocar el servicio**; `page` inválido → `validation_error`; el listado completo rechaza
      **cualquier** clave (`.strict()`); y un caso afirma que **no existe** ninguna clave de entrada
      con la que el cliente pueda elegir el grupo. **Depende de:** T2.4. **Cubre:** R2 (mitad), R11.
- [x] **T2.7 — Reparar `hilo-ventana-alcanzable`** (`design.md` §2.4). Los estatus de la pantalla de
      la tienda pasan a leerse del **valor importado** `ESTATUS_POR_GRUPO`; se **añade** la aserción
      que ata el predicado al mapa (el cuerpo de `novedadWhere` **no contiene ningún literal de
      estatus**); y la propiedad **sube**: los estatus que la tienda alcanza son **exactamente**
      `VENTANA_ESCRITURA.adminTienda`.
      **Hecho:** verde; y **roja** en tres mutaciones probadas a mano, con salida pegada: (a) plantar
      un literal de estatus dentro de `novedadWhere`; (b) quitar un grupo del mapa; (c) quitar
      `ayuda_tienda` de la ventana del `adminTienda`. ⚠️ **No se relaja `valorDe` ni se borra ningún
      bloque**: la guardia se pone roja por una razón legítima y hay que **enseñarle a leer**, no
      callarla. **Depende de:** T2.1. **Cubre:** R3, R36 (mitad).

**R cubiertos por T2:** R2 (mitad), R3, R4, R5, R9, R10, R11, R17, R26 (mitad), R36 (mitad).

---

## T3 — Las descargas *(mismo PR; subagente de backend)*

- [x] **T3.1 — [P] La descarga de devoluciones deja de traer las de ayuda.** Sale del grupo, sin
      tocar su archivo de columnas.
      **Hecho:** un caso afirma que el listado completo del grupo `devolucion` no incluye ninguna
      orden en el estatus de ayuda. **Depende de:** T2.4. **Cubre:** R38.
- [x] **T3.2 — [P] El archivo de columnas de la descarga de ayuda**, **sin** columna de causa, con
      intentos de contacto e intentos de entrega. Módulo puro, valores crudos (`null` = celda vacía).
      **Hecho:** `tests/unit/descarga/ayuda-descarga-columnas.test.ts` afirma las columnas exactas,
      que **no** existe la de causa, que la guía nula deja celda vacía (no el placeholder de
      pantalla) y que el `0` de intentos **sí** viaja. **Depende de:** T0.2 (D3). **Cubre:** R39.
- [x] **T3.3 — El tope de filas, en el servidor, para los dos grupos.**
      **Hecho:** un caso por grupo: superado el tope → `limite_excedido` con **conteos y ninguna
      fila**. **Depende de:** T2.4. **Cubre:** R37, R40.

**R cubiertos por T3:** R37, R38, R39, R40.

---

## T4 — La pestaña y sus textos *(mismo PR; subagente de FRONTEND)*

- [x] **T4.1 — La tercera pestaña.** `NovedadesTabs` pasa a tres ítems **en el orden de
      `GRUPOS_NOVEDAD`** (ayuda primero, D6), conservando `keepMounted`; la página añade su pre-fetch
      al `Promise.all` y su fallback a vacío.
      **Hecho:** `tests/components/NovedadesTabs.test.tsx` afirma los tres rótulos y que cambiar de
      pestaña **no reinicia** la paginación de la otra; `NovedadesPage.test.tsx` gana el caso de que
      un fallo de la lectura de ayuda **no** tumba la página. **Depende de:** T2.6.
      **Cubre:** R1, R12, R15.
- [x] **T4.2 — El módulo, parametrizado por grupo** (rótulos del estado vacío, `aria-label` de la
      lista, de la paginación y de la descarga), **sin duplicar** el componente.
      **Hecho:** un caso por grupo comprueba que los nombres accesibles de la lista y de la
      paginación son los suyos y no los del otro. **Depende de:** T4.1.
- [x] **T4.3 — [P] El estado vacío de la pestaña de ayuda (R16).** Título y detalle firmados en D6.
      **Hecho:** se lee **el texto**, no la ausencia de filas; y se afirma que **no** se renderiza una
      lista vacía. Es el primer estado que la tienda va a conocer (medición). **Depende de:** T4.2.
      **Cubre:** R16.
- [x] **T4.4 — [P] El subtítulo de la página deja de mentir (R14).** Nombra las **tres** superficies.
      **Hecho:** un caso lee el texto y afirma que ya **no** dice el de hoy. Español con tildes, sin
      siglas ni jerga. **Depende de:** T0.2 (D6). **Cubre:** R13, R14.
- [x] **T4.5 — [P] El corte es del servidor, y se prueba desde el cliente (R2).**
      **Hecho:** el módulo pinta **lo que recibe**; un caso le pasa a la pestaña de ayuda una lista
      con una orden de otro grupo y afirma que el componente **no la filtra** — la partición no vive
      aquí. Y un censo afirma que **ningún componente de `/novedades` particiona `items` por
      `estatusValue`**. **Depende de:** T4.2. **Cubre:** R2, R8.

**R cubiertos por T4:** R1, R2, R8, R12, R13, R14, R15, R16.

---

## T5 — La card y el punto único de los botones *(mismo PR; subagente de FRONTEND)*

- [x] **T5.1 — `novedad-acciones-catalogo.ts`**: `AccionNovedad`, `ACCIONES_POR_GRUPO` con
      `satisfies Record<GrupoNovedad, readonly AccionNovedad[]>`. `contacto` **dentro** de la tabla.
      `habilitar` en `devolucion` **con su comentario de dueño** (punto 12 → ficha 240).
      **Hecho:** `tests/unit/types/novedad-acciones-catalogo.test.ts` fija el juego exacto de cada
      grupo, afirma que la tabla cubre **todos** los grupos y que ninguna acción declarada queda sin
      grupo. Y afirma que **la tabla se indexa por el MISMO `GrupoNovedad` que usa el servidor**: un
      grupo nuevo en `ESTATUS_POR_GRUPO` rompe aquí el typecheck, así que lo que el servidor lista y
      lo que la pantalla ofrece no pueden describir grupos distintos (R6).
      **Depende de:** T1.1, T0.2. **Cubre:** R6, R18, R20.
- [x] **T5.2 — `NovedadAcciones` se reescribe contra la tabla.** Desaparecen `esDevuelta`, `esAyuda`,
      `puedeHabilitar` y los tres `...(cond ? [x] : [])`. El grupo sale de
      `grupoDeEstatus(novedad.estatusValue)`; `null` → **ninguna acción de resolución** (R21).
      **Hecho:** `tests/components/NovedadAcciones.test.tsx`: un caso por grupo censa **los nombres
      accesibles** de la fila (ni uno más ni uno menos); un caso con un estatus ajeno afirma que sólo
      quedan los de contacto. **Depende de:** T5.1. **Cubre:** R21, R22, R23.
- [x] **T5.3 — Guardia de copia única (R19).**
      `tests/unit/guards/novedad-acciones-una-tabla.guardia.test.ts`: censo del árbol; ningún archivo
      de `app/(app)/novedades/` fuera del catálogo y sus tests decide si una acción se ofrece
      comparando `estatusValue` con un literal.
      **Hecho:** verde, y **roja** al plantar esa comparación en un archivo de la pantalla
      (**autocomprobación dentro del propio archivo**). ⚠️ El censo se escribe **en un archivo de
      test, nunca por `node -e`**: ahí `\b` llega como backspace y el censo miente en verde.
      **Depende de:** T5.2. **Cubre:** R19.
- [x] **T5.4 — [P] El chip de la card y la causa (R26).** El grupo de ayuda deja de pintar «Ayuda ·
      \<causa\>» y pasa al texto firmado en D6.
      **Hecho:** un caso afirma que sobre una orden del grupo de ayuda **no** aparece ningún texto de
      causa, ni siquiera «Sin causa registrada» — R26 prohíbe también **anunciar su ausencia**.
      **Depende de:** T5.2. **Cubre:** R26.
- [x] **T5.5 — «Habilitar» desde la pestaña de ayuda (R24/R25).** La fila sale de la lista y el total
      baja. Si se firmó **D8**, el aviso distingue «se devolvió a la ruta» de «no se movió».
      **Hecho:** un caso para el camino feliz (fila fuera, total −1) y otro para el rescate que **no
      se aplica**: la pantalla **no afirma** que la devolvió. **Depende de:** T5.2, T0.2 (D2, D8).
      **Cubre:** R24, R25.

**R cubiertos por T5:** R6, R18, R19, R20, R21, R22, R23, R24, R25, R26.

---

## T6 — El hilo del lado tienda *(mismo PR; subagente de FRONTEND)*

- [x] **T6.1 — Reponer el montaje.** `NovedadesModule` gana `ordenConHilo` (montaje condicional con
      `key={orden.id}`) y la acción `conversacion` lo abre. **No se escribe ningún hilo nuevo**:
      `HiloNotasNovedadModal` está entero en disco.
      **Hecho:** `tests/components/NovedadesHilo.test.tsx` afirma que la acción existe en la fila del
      grupo de ayuda, que abre el modal, y que **con el modal cerrado el hilo no está en el árbol**.
      **Depende de:** T5.2. **Cubre:** R27.
- [x] **T6.2 — El motivo de la ayuda se lee (R28).** Con el hilo devolviendo la nota que el mensajero
      publicó al pedir ayuda, la tienda la ve con su autor y su hora.
      **Hecho:** un caso lo afirma leyendo el texto de la nota. **Es el requisito por el que existe
      esta ficha**: si sólo se puede cubrir uno, es éste. **Depende de:** T6.1. **Cubre:** R28.
- [x] **T6.3 — [P] No se lee el hilo al listar (R29).**
      **Hecho:** al renderizar una página, `listarNotasOrden` **no se llama ni una vez**; y
      `NovedadDTO` **no gana ninguna clave de notas** (afirmado sobre el DTO, no sobre un comentario).
      **Depende de:** T6.1. **Cubre:** R29.
- [x] **T6.4 — [P] `puedeEscribir` viene del servidor (R30/R31/R32/R34).**
      **Hecho:** con `puedeEscribir: true` el campo de escritura está y publicar **no** cambia el
      estado ni saca la fila; con `false`, el aviso de solo lectura se lee **y** el campo no se monta.
      Y un censo afirma que el modal **no compara el estatus** para decidirlo. **Depende de:** T6.1.
      **Cubre:** R30, R31, R32, R34.
- [x] **T6.5 — [P] El hilo vacío y los fallos (R33/R35).**
      **Hecho:** hilo sin notas → se lee el texto del estado vacío **y**, si puede escribir, el campo
      sigue ofreciéndose; y un caso por desenlace (`forbidden`, `unauthenticated`, fallo de
      transporte) leyendo **su** mensaje, distinto de los otros dos. **Depende de:** T6.1.
      **Cubre:** R33, R35.
- [x] **T6.6 — La enmienda de R35 de la 235, cerrada (R36).** Un test que cruza
      `VENTANA_ESCRITURA` con las superficies montadas: **cada rol con ventana sobre `ayuda_tienda`
      tiene un sitio donde escribir** — el mensajero, `HiloNotasAyudaModal`; la tienda, éste.
      **Hecho:** el caso vive junto a la guardia del hilo (T2.7) y se pone **rojo** si se desmonta
      cualquiera de los dos. **Depende de:** T2.7, T6.1. **Cubre:** R36.
- [x] **T6.7 — [P] Los comentarios que dejan de ser ciertos.** `@sin-superficie` de
      `HiloNotasNovedadModal`, la nota de `NovedadAcciones` («la tienda YA NO LEE NI RESPONDE el
      hilo») y la frase «esta pantalla lista exactamente las órdenes `devuelta`».
      **Hecho:** reescritos, **no borrados**: se conserva qué pasó y por qué, con fecha. Un
      comentario que describe un mundo que ya no existe es peor que ninguno. **Depende de:** T6.1.

**R cubiertos por T6:** R27, R28, R29, R30, R31, R32, R33, R34, R35, R36.

---

## T7 — Lo que no cambia, mutación y ver la app

- [x] **T7.1 — [P] Lo que esta ficha NO toca (R41-R46).** Sin código: se corre y se deja constancia
      de que siguen verdes **sin modificarse** las guardias de dinero (`ordenes-columnas-money-safe`,
      `dinero-sin-centimos`), las dos de criterio de intento, la de transiciones exhaustivas, la
      frontera de `orden_nota`, y las suites del portal del mensajero y del plazo de devolución.
      **Hecho:** la lista de suites y su resultado en `progress/impl_236.md`. Un rojo ahí **no es una
      aserción a actualizar**: es que aterrizó trabajo que no es de esta ficha. **Depende de:** T6.
      **Cubre:** R41, R42, R43, R44, R45, R46.
      > ✅ **La lista, que faltaba (añadida el 2026-08-19 tras la revisión):**
      > `dinero-sin-centimos`, `ordenes-columnas-money-safe`, `orden-nota-frontera`,
      > `superficie-de-uso`, `anclaje-vs-intentos`, `deriva-primer-intento` y `RepartoAyuda` —
      > **7 suites / 110 tests, verdes y sin modificarse**. Están en el mapa de
      > `progress/impl_236_frontend.md` §«R41-R46». Un rojo en cualquiera **es regresión**.
- [x] **T7.2 — [P] Nada de PII en registros (R47).** Censo: ningún `console.*` ni registro de
      diagnóstico de los archivos tocados emite cuerpo de nota, teléfono, dirección ni nombre.
      **Hecho:** verde, con la lista de archivos barridos. **Depende de:** T6. **Cubre:** R47.
- [x] **T7.3 — Mutación: el corte del servidor corta de verdad.** Hacer que `novedadWhere` ignore el
      grupo (devolver el `OR` de hoy) y comprobar que la suite se pone **roja**.
      **Hecho:** **salida real pegada** en `progress/impl_236.md`, con el nombre de los tests que
      caen. Sin esa salida no cuenta: este repo ya tuvo un arnés de mutaciones que reportó 9/9
      supervivientes **dos veces sin haber ejecutado un test**. **Depende de:** T2, T4.
- [x] **T7.4 — [P] Mutación: el punto único de los botones.** Añadir `reprogramar` al grupo `ayuda` en
      la tabla y comprobar que cae el censo de nombres accesibles de T5.2.
      **Hecho:** ídem, con salida real. **Depende de:** T5.
- [x] **T7.5 — [P] Mutación: la lectura del hilo.** Desmontar la acción `conversacion` y comprobar que
      caen T6.1, T6.2 y **T6.6** — es la mutación que protege el motivo por el que existe la ficha.
      **Hecho:** ídem, con salida real. **Depende de:** T6.
- [x] **T7.6 — Guardias completas.** `pnpm run test:guardias` entero, con **atención especial** a
      `hilo-ventana-alcanzable` (T2.7), `orden-nota-frontera` y la guardia nueva de T5.3.
      **Hecho:** todas verdes. **Depende de:** T7.1-T7.5.
- [x] **T7.7 — VER LA APP, no sólo la suite.** En esta pila un recorrido de minutos encontró **dos
      defectos serios** que la suite no veía (`progress/recorrido_235.md` §8), y el de la 238 encontró
      un **bloqueo duro**. Recorrido, como `adminTienda`:
      pedir ayuda desde el mensajero → entrar a `/novedades` → **ver la pestaña nueva y que es la
      primera** → leer el subtítulo entero → abrir la conversación y **leer el motivo** → responder y
      comprobar que la fila **sigue ahí** → volver a la pestaña de devoluciones y comprobar que la
      orden **no está** → descargar los dos archivos y mirar sus columnas → «Habilitar» y ver la fila
      salir → dejar la pestaña vacía y **leer su estado vacío**.
      **Hecho:** recorrido anotado paso a paso en `progress/recorrido_236.md` (archivo propio, no
      mezclado con la bitácora del implementer), **con los textos leídos tal cual del navegador**.
      Doce mil tests dan por buenos textos rotos que un recorrido de minutos encuentra.
      **Depende de:** T7.6.
      > 🔑 **Dos muros conocidos, medidos en el recorrido de la 235 — no se redescubren:**
      > 1. **`/novedades` como `adminTienda` exige OTP.** El código **se puede leer del log del
      >    servidor de dev**, pero **sólo si su salida va a un ARCHIVO**, no por una tubería: con
      >    `pnpm dev > dev.log 2>&1` la línea `Codigo OTP generado: NNNNNN` aparece en menos de un
      >    segundo. (También queda en `.next/dev/logs/next-development.log`.)
      > 2. **Un 404 en una ruta que existe puede ser un cliente Prisma rancio.** `prisma generate` no
      >    basta: el proceso vivo tiene el cliente viejo en memoria y hay que **reiniciar** el
      >    servidor. Mirar el log antes que el código.

**R cubiertos por T7:** R41-R47 (+ verificación cruzada de todos los anteriores).

---

## T8 — Cierre documental

- [x] **T8.1 — [P] Cerrar la enmienda de R35 de la 235.** En
      `specs/235-ayuda-tienda-estatus/requirements.md` §«RECONCILIACIÓN DE R35», anotar **CERRADA con
      fecha** y con el PR: su dueño era esta ficha.
      **Hecho:** la sección deja de leerse como deuda viva.
- [x] **T8.2 — [P] Anotar el aterrizaje** en `progress/design_pila_ayuda_tienda.md` §F2 (fecha, PR y
      las respuestas a D1-D8) y en `progress/auditoria_ayuda_tienda.md` §4 (caen «la pestaña nueva» y
      «la nota se escribe y nadie la lee»).
      **Hecho:** ninguna de las dos secciones contradice al código.
- [x] **T8.3 — Cerrar la ficha, y declarar la 228 superada.** `feature_list.json` **lo estampa el
      leader**: estado, `status_note` de 3-6 líneas técnicas —el detalle vive en `progress/`, no
      duplicado en el JSON— y la **228 como superada** (`design.md` §14).
      **Hecho:** `./init.sh` completo verde **con el árbol quieto**, el mapa `R<n> → test` en
      `progress/impl_236.md`, y el SHA medido comparado contra `origin/dev` **justo antes** de abrir
      el PR (`dev` se mueve). **Depende de:** T7, T8.1, T8.2.

---

## Mapa `R<n>` → tanda

| Tanda | R |
| --- | --- |
| T1 | R5 (mitad), R6 (mitad), R7 |
| T2 | R2 (mitad), R3, R4, R5, R9, R10, R11, R17, R26 (mitad), R36 (mitad) |
| T3 | R37, R38, R39, R40 |
| T4 | R1, R2, R8, R12, R13, R14, R15, R16 |
| T5 | R6 (mitad), R18, R19, R20, R21, R22, R23, R24, R25, R26 |
| T6 | R27, R28, R29, R30, R31, R32, R33, R34, R35, R36 |
| T7 | R41, R42, R43, R44, R45, R46, R47 |

---

## Mapa `R<n>` → cómo se prueba

| Req | Cómo se prueba |
| --- | --- |
| R1 | `tests/components/NovedadesTabs.test.tsx` — «hay una tercera pestaña y lista las órdenes en ayuda» |
| R2 | `NovedadAcciones`/módulo (T4.5) — «el componente no filtra `items`; pinta lo que recibe» + censo «nadie particiona por `estatusValue`» |
| R3 | `orden-repository.novedades.test.ts` — «el `where` es una igualdad de estado y sus claves son exactamente tres» |
| R4 | ídem — «count y find comparten el mismo `where`, **iterando `GRUPOS_NOVEDAD`**» (**mutación T7.3**) |
| R5 | `tests/unit/types/novedad-grupo.test.ts` — «`grupoDeEstatus` es la inversa del mapa, no un segundo literal» + `hilo-ventana-alcanzable` (T2.7) leyendo el mapa |
| R6 | `novedad-grupo.test.ts` + `novedad-acciones-catalogo.test.ts` — los dos consumidores del **mismo** `GrupoNovedad`; el `satisfies` de la tabla rompe si el mapa gana un grupo |
| R7 | typecheck (`satisfies Record<GrupoNovedad, OrderStatusValue>`) + `novedad-grupo.test.ts` |
| R8 | `NovedadesService.test.ts` — «el alcance sale del actor» · `orden-repository.novedades.test.ts` — «`deletedAt: null` y `tiendaId` en los dos grupos» |
| R9 | `orden-repository.novedades.test.ts` — «una orden de un grupo no casa el predicado del otro» |
| R10 | `NovedadesService.test.ts` — «el `tiendaId` nunca llega del input» |
| R11 | ídem — «rol distinto de `adminTienda` → `forbidden` antes de tocar el repo», en los dos grupos y los dos métodos · `novedades-ayuda.test.ts` — «sin sesión, el servicio no recibe ni una llamada» |
| R12 | `NovedadesTabs.test.tsx` — «cambiar de pestaña no reinicia la paginación de la otra» |
| R13 | `NovedadesTabs.test.tsx` — se lee el rótulo, tal cual |
| R14 | `NovedadesPage.test.tsx` — «el subtítulo nombra las tres superficies y ya no dice el de hoy» |
| R15 | `NovedadesModule` (grupo ayuda) — «la paginación dice el total y el tramo» |
| R16 | T4.3 — «se lee el TEXTO del estado vacío, y no hay lista» |
| R17 | `NovedadesService.test.ts` (T2.5) — «ordena por la fecha de la solicitud, con una sola consulta por página» |
| R18 | `novedad-acciones-catalogo.test.ts` — «el juego de cada grupo está en la tabla» (**mutación T7.4**) |
| R19 | `tests/unit/guards/novedad-acciones-una-tabla.guardia.test.ts` (censo, **con autocomprobación**) |
| R20 | typecheck (los dos `satisfies`) + `novedad-acciones-catalogo.test.ts` |
| R21 | `NovedadAcciones.test.tsx` — «estatus ajeno: sólo quedan las de contacto» |
| R22 | ídem — censo de nombres accesibles de la fila de ayuda, **ni uno más ni uno menos** |
| R23 | ídem — «sobre una orden en ayuda no se ofrecen Reprogramar ni Rechazar» |
| R24 | T5.5 — «tras habilitar, la fila sale y el total baja» |
| R25 | T5.5 — «si el rescate no se aplica, la pantalla no afirma que la devolvió» *(depende de D8)* |
| R26 | T5.4 — «sobre una orden en ayuda no aparece ninguna causa, **ni el aviso de su ausencia**» · `NovedadesService.test.ts` — «para el grupo ayuda no se consulta la causa» |
| R27 | `tests/components/NovedadesHilo.test.tsx` — «la fila de ayuda ofrece la conversación y la abre» (**mutación T7.5**) |
| R28 | ídem — «el motivo con el que se pidió la ayuda se lee dentro del hilo» |
| R29 | ídem — «al listar, `listarNotasOrden` no se llama» + «`NovedadDTO` no tiene clave de notas» |
| R30 | ídem — «con `puedeEscribir: false` no hay campo de escritura» + censo «el modal no compara el estatus» |
| R31 | ídem — «con `puedeEscribir: true` la tienda publica sin habilitar nada antes» |
| R32 | ídem — «publicar no cambia el estado ni saca la fila de la pestaña» |
| R33 | T6.5 — «hilo sin notas: se lee el texto y el campo sigue ofreciéndose» |
| R34 | T6.4 — «solo lectura: se lee el aviso y no hay campo» |
| R35 | T6.5 — un caso por desenlace, cada uno con **su** mensaje |
| R36 | T6.6 + `hilo-ventana-alcanzable` (T2.7) — «los estatus que la tienda alcanza son exactamente su ventana» y «cada rol con ventana tiene superficie montada» |
| R37 | T3.3 — «el listado completo de ayuda usa el mismo predicado y el mismo alcance» |
| R38 | T3.1 — «el archivo de devoluciones no trae ninguna orden en ayuda» |
| R39 | `tests/unit/descarga/ayuda-descarga-columnas.test.ts` — «no existe la columna de causa» |
| R40 | T3.3 — «superado el tope: conteos y ninguna fila», por grupo |
| R41 | `ordenes-columnas-money-safe` y `dinero-sin-centimos` **verdes sin tocar** (T7.1) |
| R42 | `order-status-transiciones` y la guardia de transiciones exhaustivas **verdes sin tocar** (T7.1) |
| R43 | Suites de `DevolucionSlaService` y del anclaje de la 239 **verdes sin tocar** (T7.1) |
| R44 | `RepartoAyuda.test.tsx` y las suites del portal del mensajero **verdes sin tocar** (T7.1) |
| R45 | `tests/unit/services/orden-nota-service.test.ts:380` — un `toEqual` **literal** sobre las dos listas de `VENTANA_ESCRITURA`, **verde sin tocar** (T7.1). ⚠️ Esta fila citaba `tests/unit/types/ventana-hilo-notas.test.ts`, **que nunca ha existido en ninguna rama**; corregido el 2026-08-19 tras la revisión |
| R46 | Las dos guardias de criterio de intento **verdes sin tocar** + los casos de intentos de contacto reubicados (T7.1) |
| R47 | Censo de T7.2 |

---

## Paralelismo y conflictos de archivo

- **Dentro de la feature:** las `[P]` de cada tanda tocan archivos distintos. **T1.1 bloquea todo lo
  demás.** T2.1 bloquea T2.2-T2.3 y T2.7; T4.1 bloquea T4.2-T4.5; T5.1 bloquea T5.2-T5.5; T6.1
  bloquea T6.2-T6.7. **T2.7 y T6.6 no son paralelas entre sí**: las dos escriben en la guardia del
  hilo desde lados distintos.
- **Backend antes que frontend.** T1-T3 y T4-T6 **no** se trabajan a la vez: T4-T6 leen contratos que
  T2/T3 todavía están moviendo (`INovedadesService`, `IOrdenRepository`, las Server Actions).
- **El gate NUNCA en paralelo con un subagente que muta el árbol**: leería el árbol mutado.
- **Con otras fichas — esta toca `/novedades` y ahí se cruza con dos:**
  - **La 240** toca `NovedadAcciones` (retira «Habilitar» de las cards de cierre y cablea
    «Rechazar»), `NovedadesModule` y `lib/actions/habilitar-novedad.ts`. Tras esta ficha, su cambio
    principal es **una celda de `ACCIONES_POR_GRUPO`** — pero es el **mismo archivo**. **No se
    trabajan en paralelo.** Y si se firma **D8**, las dos escriben además sobre
    `HabilitarNovedadResult`: por eso D8 se firma **antes**.
  - **La 237** añade «Reprogramar» y «Rechazar» al grupo `ayuda`: otra vez la **misma tabla** y la
    misma card. Va **después** de ésta, y su cambio también debería ser una celda.
  - La **235** ya está mergeada en `dev`; esta ficha se apoya en su punto único de rescate y en su
    ventana de escritura, y **no los toca**.
- **Antes de registrar cualquier id o rama nuevos**, mirar `origin/dev`: ya hubo dos colisiones de id
  entre sesiones.
- **`dev` se mueve:** el pre-vuelo caduca. Comparar el SHA medido contra `origin/dev` **justo antes**
  de abrir el PR.
