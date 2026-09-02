# Feature 238 — Tareas

> Leer antes: `requirements.md` (R1-R44) y `design.md`.
>
> **Gate:** `./init.sh --rapido` para cerrar cada tanda; **`./init.sh` completo antes de cada PR, sin
> excepción**. El gate **no** se corre en paralelo con un subagente que muta el árbol: leería el árbol
> mutado y su veredicto no valdría.
>
> **Punto de despliegue.** T1 es **inerte** (un módulo puro y una lectura sin consumidores) y puede
> salir suelto. **T2, T3 y T4 van obligatoriamente en un solo PR**: si el servidor exige la
> confirmación y la pantalla no la manda, **todo cierre con devoluciones deja de poder aprobarse** —y
> el árbol sale verde, porque ningún test de backend sabe lo que manda el cliente.
>
> **Zona `fullstack` ⇒ se secuencia backend → frontend.** T1-T3 con el subagente de backend, T4 con el
> de frontend, nunca a la vez sobre los mismos archivos.

---

## T0 — Puerta humana: medir y firmar (sin código)

- [x] **T0.1 — Medir contra producción**, vía MCP de Supabase, solo lectura, con la consulta de
      `design.md` §9: (a) cierres `solicitado` y cuántas gestiones tendría que escanear cada uno;
      (b) **cuántas gestiones que vuelven tienen `orden.num_guia IS NULL`** — el número que decide D3;
      (c) incidentes por cierre, para dimensionar la línea de exclusión.
      **Hecho:** los tres números pegados en `progress/impl_238.md` con su fecha. **Bloquea T0.2.**
      > ✅ **MEDIDA el 2026-08-19** (MCP, solo lectura). Los tres números en `progress/impl_238.md`
      > §T0.1, **con autocomprobación**: (a) **0 cierres `solicitado`**, pero hay **12 cierres** y
      > **32 gestiones que vuelven** — el cero es «no hay cola», no «no hay datos»; (b) **0**
      > gestiones que vuelven sin `num_guia`, sobre 32 vivas y 141 órdenes → **la población de D3 no
      > existe**; (c) **2 incidentes**, en 2 cierres distintos.
      > **Tres cosas que la medición le dijo al diseño:** el caso «sin retornables» es **3 de 12**
      > (no es un `else`, es 1 de cada 4), el **techo de la ventana es 14 guías** (no 2 ni 3), y la
      > línea de exclusión de incidentes **se va a ver de verdad**.
      > ⏳ **Caduca**: un cierre solicitado aparece en cuanto un mensajero cierre su día. **Re-medir
      > justo antes de desplegar**, no antes de mergear.
- [x] **T0.2 — Firmar las decisiones abiertas.** **D1** (qué se persiste), **D2** (¿faltantes
      declarados?), **D3** (gestiones sin número de guía, con el número de T0.1 delante).
      **Hecho:** cada una respondida en `progress/impl_238.md`; si alguna se aparta de la
      recomendación, el spec se corrige **antes** de escribir código. **Bloquea T1.**
      > ✅ **FIRMADAS el 2026-08-19**, en `requirements.md` §«PUERTA HUMANA PASADA» y transcritas en
      > `progress/impl_238.md` §T0.2. **Ninguna se apartó de la recomendación**, así que el spec no
      > se corrige. D1 marca por gestión; **D2 sin escapatoria** —un solo paquete perdido devuelve el
      > cierre entero, y es deliberado—; D3 y D8 resueltas por medición.
- [ ] **T0.3 — [P] Avisar a bodega del cambio de gesto** (D8): a partir del despliegue, aprobar exige
      tener los paquetes delante, y los cierres ya en cola lo exigirán desde el primer minuto.
      **Hecho:** aviso enviado y anotado con fecha. **Bloquea el despliegue, no T1.**
      > ⏳ **ABIERTA, y ya NO bloquea el despliegue** (2026-08-19): la medición de T0.1 encontró
      > **0 cierres en cola**, así que nadie se encuentra el gesto cambiado de un día para otro.
      > Queda como acción **del humano** antes de desplegar, no de código.

---

## T1 — El punto único y la lectura *(inerte: se puede desplegar suelto)*

- [x] **T1.1 — El módulo puro `lib/types/gestion-retorno.ts`** con `RETORNA_A_BODEGA`
      (`satisfies Record<GestionResultado, boolean>`), `RESULTADOS_QUE_VUELVEN` derivado y
      `vuelveABodega()`. El `false` de `incidente` va **con su comentario y su razón**, no como
      omisión.
      **Hecho:** `tests/unit/types/gestion-retorno.test.ts` cubre los cinco resultados, afirma que
      `incidente` está declarado como no-retornable y que la lista se **deriva** del `Record` (no es
      un segundo literal). **Depende de:** T0.2.
- [x] **T1.2 — [P] Guardia de copia única (R3/R5).**
      `tests/unit/guards/confirmacion-incidentes-excluidos.guardia.test.ts`: censo del árbol; ningún
      archivo fuera de `gestion-retorno.ts` declara su propia lista de resultados que vuelven a
      bodega (un `["devuelta","rechazada","reprogramada"]` suelto la pone roja).
      **Hecho:** verde, y **roja** al plantar esa lista en otro archivo (autocomprobación **dentro
      del propio archivo**). El censo se escribe **en un archivo de test**, nunca por `node -e`: ahí
      `\b` llega como backspace y el censo miente en verde. **Depende de:** T1.1.
- [x] **T1.3 — `findGestionesRetornablesDelCierre`** en `ICierresAdminRepository` +
      `CierresAdminRepository`, molde literal de `findGestionesIncidenteDelCierre`: alcance en el
      WHERE, `resultado IN RESULTADOS_QUE_VUELVEN`, `anuladaAt: null`, proyección
      `{ gestionId, numGuia, resultado }`.
      **Hecho:** `tests/unit/repositories/cierres-admin-retornables.test.ts` afirma: el WHERE lleva
      el alcance (no se filtra en memoria); un cierre fuera de alcance devuelve `[]` **sin
      distinguirse** de uno inexistente; los `incidente` y las `entregada` **no** salen; una gestión
      cuya orden ya cambió de estatus **sí** sale (R4); `numGuia` viaja `null` cuando la orden no
      tiene guía. **Depende de:** T1.1.

**R cubiertos por T1:** R1, R2, R3 (mitad), R4, R5, R6.

---

## T2 — El borde y la cobertura en el servicio  *(mismo PR que T3 y T4)*

- [x] **T2.1 — Borde zod.** `confirmacionFisicaSchema` + `aprobarCierreSchema` gana
      `confirmacionFisica: z.array(...).default([])`; la Server Action la pasa **tal cual** al
      servicio (sin coerción).
      **Hecho:** `tests/unit/types/cierres-admin-confirmacion-schema.test.ts` cubre id no-uuid, guía
      no entera, guía ≤ 0 y ausencia del campo (`[]`); `tests/integration/actions/cierres-admin-action.test.ts`
      afirma que la lista llega al servicio sin transformar. **Depende de:** T1.3.
- [x] **T2.2 — `validarConfirmacionFisica` en `CierresAdminService`**, espejo de
      `validarCoberturaIndemnizaciones`, **antes** de ella y **antes** de tocar el repo. Sus seis
      mensajes con nombre (`design.md` §3.2).
      **Hecho:** `tests/unit/services/cierres-admin-confirmacion-fisica.test.ts` con un caso por
      desenlace: falta una, sobra una, duplicada, incidente enviado (mensaje **propio**, distinto del
      de ajena), guía que no casa, gestión sin guía, y el camino feliz. En **todos** los rojos se
      afirma que `repo.resolverCierre` **no se llamó** (R14) y que el cierre sigue `solicitado`.
      **Depende de:** T2.1.
- [x] **T2.3 — [P] Los dos caminos que no cambian.** Cierre sin retornables → se aprueba con el
      payload de siempre (R16); petición sin el campo → tratada como lista vacía (R15).
      **Hecho:** dos casos en el mismo archivo, uno de ellos afirmando que el servicio **no** pide
      confirmación cuando no hay nada que devolver. **Depende de:** T2.2.
- [x] **T2.4 — [P] Claves de error disjuntas.** Un cierre con incidentes **y** retornables produce
      `fieldErrors` cuyas claves no se pisan.
      **Hecho:** un caso que lo afirma con los dos conjuntos poblados. **Depende de:** T2.2.
- [x] **T2.5 — [P] Alcance (R38).** Un `adminSatelite` recibe la misma exigencia; un cierre fuera de
      su alcance produce conjunto vacío y `no_encontrada`, sin revelar nada.
      **Hecho:** dos casos en `tests/unit/services/cierres-admin-service.test.ts`. **Depende de:** T2.2.

**R cubiertos por T2:** R3 (mitad), R7, R8, R9, R10, R11, R12, R13, R14, R15, R16, R38.

---

## T3 — La migración y la escritura dentro de la transacción  *(mismo PR que T2 y T4)*

- [x] **T3.1 — Migración `<ts>_gestion_orden_confirmacion_fisica`** (`<ts>` posterior a
      `20260819160000`): `ADD COLUMN "confirmada_fisica_at" TIMESTAMP(3);` + `down.sql` con su
      `DROP COLUMN IF EXISTS`, **pérdida de valores declarada**. `schema.prisma` actualizado. Sin
      índice, sin CHECK, sin tocar RLS.
      **Hecho:** `pnpm run db:migrate` aplica y `pnpm run db:rollback` revierte en local;
      `tests/integration/db/confirmacion-fisica-migration.test.ts` afirma que la columna es
      **nullable, sin default**, que las filas previas quedan en `NULL` (R20) y que aplicar dos veces
      no rompe. **Depende de:** T0.2.
- [x] **T3.2 — `ResolverCierreInput.confirmacionFisica`**: obligatorio en la rama `aprobado`,
      `never` en la rama `rechazado`.
      **Hecho:** el typecheck **rompe** en todo doble de `resolverCierre` que no lo pase — esa es la
      señal buscada— y **rompe** si alguien lo pasa al rechazar. **Depende de:** T3.1.
- [x] **T3.3 — El bloque**, entre `devolucionRechazadas` (139) y el anclaje (239): un solo
      `updateMany` guardado por `{ id: { in: ids }, cierreId, resultado: { in: RESULTADOS_QUE_VUELVEN } }`,
      `data` con **exactamente** `confirmadaFisicaAt`, y `throw ConfirmacionFisicaNoAplicableError`
      si `count !== ids.length`. La clase de error vive junto a `IndemnizacionNoAplicableError` y su
      mensaje lleva **sólo el id del cierre**.
      **Hecho:** `tests/unit/repositories/cierres-admin-confirmacion-fisica.test.ts` **nuevo**, con un
      doble que **honra el `where`** (nunca un `vi.fn()` que devuelve `{count: n}` a ciegas: un doble
      mudo deja la guarda sin nadie que la mire, que es exactamente cómo el fallo de agosto llegó a
      `dev`). Casos: marca las esperadas; **una gestión de OTRO cierre no se marca** (testigo del
      `cierreId`); **un incidente del mismo cierre no se marca** (testigo del `resultado`); `count`
      insuficiente lanza y revierte **todo**; rechazar no escribe nada; `data` con una sola clave.
      **Depende de:** T3.2.
- [x] **T3.4 — La invariante 238↔239 (R23).** Un caso que aprueba un cierre con devoluciones y afirma
      que **toda gestión anclada quedó confirmada** en la misma transacción, sin que el bloque de
      anclaje se toque.
      **Hecho:** el caso está en el archivo de T3.3 y
      `tests/unit/repositories/cierres-admin-anclaje-devolucion.test.ts` sigue **verde sin
      modificarse**. **Depende de:** T3.3.
- [x] **T3.5 — Idempotencia donde de verdad se ve (R22).** El caso vive en
      `tests/integration/db/wallet-idempotencia.test.ts`, no en `cierres-admin-caja-cod.test.ts`:
      **ese doble devuelve vacío para el bloque de órdenes y pasa de largo**; el store de
      `wallet-idempotencia` honra el `where` como lo haría Postgres.
      **Hecho:** una segunda aprobación del mismo cierre da `conflict`, no ejecuta el bloque y deja
      **una sola** marca por gestión. **Depende de:** T3.3.
- [x] **T3.6 — [P] Guardia «nace sin lectores» (R21).**
      `tests/unit/guards/confirmacion-sin-lectores.guardia.test.ts`: censo del árbol; nadie proyecta
      ni lee `confirmadaFisicaAt` fuera del schema, del bloque de escritura y de sus tests, y en
      particular **nadie hace aritmética de fechas con ella**. Mismo patrón que la guardia de
      `ubicacion_lat/lng` (193).
      **Hecho:** verde, y **roja** al añadir una lectura de prueba (autocomprobación en el archivo).
      **Depende de:** T3.3.
- [x] **T3.7 — Actualizar el inventario de escrituras (R40/R42).** En
      `tests/unit/guards/aprobacion-escrituras-cubiertas.guardia.test.ts`, la entrada de
      `tx.gestionOrden.updateMany` pasa a describir **dos** bloques (indemnización 158 + confirmación
      física 238) con las **dos** suites que los nombran.
      **Hecho:** la guardia verde, y el frente 2 (ninguna aserción filtra por la forma del `where`)
      **también** verde tras T3.8. **Depende de:** T3.3.
- [x] **T3.8 — Los rojos por diseño de la indemnización.**
      `tests/unit/repositories/cierres-admin-indemnizacion.test.ts` deja de poder identificar su
      llamada por índice (ahora hay dos `tx.gestionOrden.updateMany`). Se re-apunta identificándola
      **por su significado** (`where.resultado === "incidente"`), jamás por presencia o ausencia de
      una clave.
      **Hecho:** la suite verde con la nueva identificación y la guardia de T3.7 **sin ladrar**.
      **Depende de:** T3.3.
- [x] **T3.9 — [P] Verificar que ningún feed lee la columna nueva ni `orden.estatus_id`.** Revisión
      de los cinco feeds + la caja COD.
      **Hecho:** anotado en `progress/impl_238.md` con los archivos revisados;
      `cierres-admin-caja-cod.test.ts` y las suites de idempotencia **verdes sin tocar** (R41).
      **Depende de:** T3.3.

**R cubiertos por T3:** R17, R18, R19, R20, R21, R22, R23, R24, R25, R26, R40, R41, R42, R43, R44.

---

## T4 — La pantalla  *(mismo PR que T2 y T3; subagente de frontend)*

- [x] **T4.1 — La tercera rama de `pedirAprobacion()`** (`CierresAdminModule.tsx`): retornables →
      ventana de confirmación; sin retornables y con incidentes → el sub-modal de hoy; sin ninguno →
      aprobar directo, byte a byte como hoy.
      **Hecho:** `tests/components/CierresAdminConfirmacionFisica.test.tsx` **nuevo** afirma los tres
      caminos, y que el cierre sin nada que devolver manda `{ cierreId }` sin campos nuevos (R16).
      **Depende de:** T2, T3.
- [x] **T4.2 — La ventana**: lista agrupada por resultado con guía, remisión, destinatario y estado;
      `EscanerGuiaCard` con `manual`, montado **condicionalmente** dentro del `Modal` (no
      `EscanerModal`, que trae su propio disparador); `closeOnConfirm={false}`.
      **Hecho:** el test afirma R33 (lo que muestra cada fila) y **R36** (con la ventana cerrada, la
      tarjeta de escaneo **no está en el árbol**). **Depende de:** T4.1.
- [x] **T4.3 — Los cuatro desenlaces de una guía leída** (R29-R32), cada uno con su mensaje propio:
      inválida · ajena al cierre · del cierre pero no vuelve · ya confirmada.
      **Hecho:** cuatro casos, uno por mensaje, y ninguno marca fila ni llama a la Server Action.
      **Depende de:** T4.2.
- [x] **T4.4 — [P] Los dos caminos de captura (R28).** Cámara (`extractNumGuiaFromScan`) y número
      tecleado (`/^\d+$/`), reusando el patrón de `RecogerPaqueteCard` sin bifurcar el componente.
      **Hecho:** un caso por camino confirma la misma gestión. **Depende de:** T4.2.
- [x] **T4.5 — [P] El bloqueo con palabras (R27) y la exclusión nombrada (R34).** Botón deshabilitado
      **más** texto con cuántas faltan y qué hacer si un paquete no llegó (rechazar el cierre); línea
      visible de incidentes excluidos cuando los haya.
      **Hecho:** dos casos que leen el **texto**, no el `disabled`. Sin siglas ni jerga en el copy.
      **Depende de:** T4.2.
- [x] **T4.6 — [P] Cerrar sin completar (R35)** y **el orden de los dos pasos (R37)**.
      **Hecho:** un caso afirma que cerrar la ventana no llama a `aprobarCierre`; otro, que con
      incidentes **y** retornables la confirmación va primero y el sub-modal de montos después.
      **Depende de:** T4.2.
- [x] **T4.7 — Errores del servidor por fila.** Un `validation_error` con clave de gestión se pinta
      en su fila y la ventana **sigue abierta**.
      **Hecho:** un caso, espejo del que la 158 tiene para los montos. **Depende de:** T4.2.

**R cubiertos por T4:** R27, R28, R29, R30, R31, R32, R33, R34, R35, R36, R37.

---

## T5 — Lo que queda fuera, mutación y verificación

- [x] **T5.1 — El cierre de bodega no hereda nada (R39).** Sin código: un test que lo afirma para que
      la ausencia sea decisión y no olvido.
      **Hecho:** un caso en `tests/unit/services/cierre-bodega-service.test.ts` afirma que resolver un
      cierre de bodega no pide confirmación física ni la exige, con la razón en el comentario
      (`CierreBodegaRepository` no toca `orden` ni el choke point). **Depende de:** T3.
      > ✅ **HECHA, en OTRO archivo del que el spec decía, y con razón (2026-08-19).** El spec lo
      > situaba en `tests/unit/services/cierre-bodega-service.test.ts`, pero `aprobarCierreBodega`
      > vive en `CierresBodegaAdminService` y sus tres hermanos («la 42/43/44 no llega al nivel 2»)
      > están en `cierres-bodega-admin-service.test.ts`. Va **junto a sus hermanos**. Se afirma por
      > tres frentes y **se sabe poner rojo**: hacer que el nivel 2 «herede» la 238 mata dos casos.

- [x] **T5.2 — Mutación: el bloqueo bloquea de verdad.** Quitar la guardia de cobertura del servicio
      y comprobar que la suite se pone **roja**.
      **Hecho:** salida real pegada en `progress/impl_238.md`, con el nombre del test que cae. Sin esa
      salida no cuenta: este repo ya tuvo un arnés de mutaciones que reportó 9/9 supervivientes dos
      veces **sin haber ejecutado un test**. **Depende de:** T2, T3, T4.
- [x] **T5.3 — [P] Mutación: la guarda del `cierreId` en la escritura.** Quitarla y comprobar que cae
      el caso testigo de T3.3 (la gestión de otro cierre).
      **Hecho:** ídem, con salida real. **Depende de:** T3.
- [x] **T5.4 — [P] Mutación: los incidentes.** Poner `incidente: true` en `RETORNA_A_BODEGA` y
      comprobar que caen los casos de T1.1 y ~~T2.2~~ **del REPOSITORIO**. **Es la mutación que
      protege la decisión firmada.**
      **Hecho:** ídem, con salida real. **Depende de:** T1, T2.
      > ✅ **CORRIDA — y el spec se equivocaba, se corrige aquí (2026-08-19).** La mutación mató **8
      > casos en 3 archivos**, incluido el que corre contra Postgres real
      > (`expected [ …(5) ] to deeply equal [ …(4) ]`). Pero **NO tocó T2.2**, y no puede: la suite
      > del servicio usa **dobles del repositorio**, así que el conjunto esperado se lo da el test y
      > `RETORNA_A_BODEGA` no interviene — es **estructuralmente incapaz** de ver esta mutación.
      > Quien la mata es el módulo puro y **el repositorio**, que es donde la regla se aplica.
      > La decisión firmada **sí** queda protegida; lo que era falso es que la protegiera la suite
      > que este spec nombraba. Es el mismo error que el repo ya pagó: un test de servicio no ve el
      > `WHERE`.
- [x] **T5.5 — Guardias completas.** `pnpm run test:guardias` entero: money-safe,
      `dinero-sin-centimos`, `aprobacion-escrituras-cubiertas`, los dos criterios de intento, las
      transiciones exhaustivas, y las dos guardias nuevas de esta feature.
      **Hecho:** todas verdes. Un rojo en los criterios de intento o en las transiciones significa que
      alguien tocó algo que esta feature no toca: **es regresión, no aserción a cambiar.**
      **Depende de:** T4.
- [x] **T5.6 — Ver la app, no sólo la suite.** Cierre con devoluciones + rechazos + reprogramadas +
      un incidente: abrir el detalle → pulsar Aprobar → ver la ventana → escanear una guía → teclear
      otra → intentar una ajena → intentar la del incidente → dejar una sin confirmar y comprobar que
      **no** se puede aprobar → completarla → pasar a los montos → aprobar → ver la devolución llegar
      a `/novedades`.
      **Hecho:** recorrido anotado paso a paso en `progress/impl_238.md`, con lo que se vio y con los
      textos leídos tal cual. Doce mil tests dan por buenos textos rotos que un recorrido de minutos
      encuentra. **Depende de:** T5.5.
      > ✅ **HECHO el 2026-08-19** por el leader, con Playwright y los dos roles. Anotado en
      > `progress/recorrido_238.md` (archivo propio, para no mezclarlo con la bitácora del
      > implementer). Los cuatro desenlaces ejercidos uno a uno, el cierre aprobado, la marca
      > comprobada contra Postgres (12 de 12, ninguna que no vuelva, misma transacción) y las dos
      > devoluciones llegando a `/novedades`.
      > 🔴 **Y encontró un BLOQUEO DURO que la suite no veía**: con dos gestiones vivas de la misma
      > orden en un cierre —**existe en producción, 1 de 48**— el cierre **no se podía aprobar
      > nunca**. Arreglado, con su caso y su mutación; el design §5.3 se corrigió, que decía «casa
      > UNA gestión».

**R cubiertos por T5:** R39 (+ verificación cruzada de todos los anteriores).

---

## T6 — Cierre documental

- [x] **T6.1 — [P] Anotar en `progress/design_pila_ayuda_tienda.md` §F4** que la ficha aterrizó, con
      fecha, PR y las respuestas a D1-D3.
      **Hecho:** el §F4 deja de leerse como pendiente.
- [x] **T6.2 — [P] Anotar en `specs/239-devolucion-espera-cierre/design.md` §13** que la 238 añade una
      condición más a la aprobación y refuerza su riesgo 1 (población congelada).
      **Hecho:** la sección lo dice y no contradice al código.
- [x] **T6.3 — Cerrar la ficha.** `feature_list.json` (lo estampa el leader): estado, `status_note` de
      3-6 líneas técnicas —el detalle vive en `progress/`, no duplicado en el JSON— y el mapa
      `R<n> → test` en `progress/impl_238.md`.
      **Hecho:** `./init.sh` completo verde con el árbol quieto, y el SHA medido comparado contra
      `origin/dev` **justo antes** de abrir el PR (`dev` se mueve). **Depende de:** T5, T6.1, T6.2.

---

## Mapa `R<n> → test`

| Req | Test |
| --- | --- |
| R1 | `tests/unit/types/gestion-retorno.test.ts` — «los cinco resultados están declarados y la lista se deriva del `Record`» |
| R2 | `tests/unit/repositories/cierres-admin-retornables.test.ts` — «el conjunto son las gestiones vigentes del cierre que vuelven» |
| R3 | `gestion-retorno.test.ts` — «`incidente` está declarado como no-retornable» · `cierres-admin-retornables.test.ts` y `-sql-real.test.ts` — «los `incidente` no salen». **La mutación T5.4 la matan éstos, NO el test del servicio**: esa suite usa dobles del repo y es estructuralmente incapaz de verla (medido: la mutación mata 10 casos en 4 archivos y el del servicio es justo el que sobrevive). El caso del servicio cubre R3 desde su lado —«un incidente del cierre no entra en el conjunto esperado ni bloquea»— pero no es su red |
| R4 | `cierres-admin-retornables.test.ts` — «una gestión cuya orden ya cambió de estatus sigue en el conjunto» |
| R5 | typecheck (el `satisfies Record<GestionResultado, boolean>`) + `tests/unit/guards/confirmacion-incidentes-excluidos.guardia.test.ts` |
| R6 | `cierres-admin-retornables.test.ts` — «fuera de alcance devuelve `[]` sin distinguirse de inexistente» |
| R7 | `cierres-admin-confirmacion-fisica.test.ts` (service) — «cierre con retornables y confirmación vacía: no se aprueba» (**mutación T5.2**) |
| R8 | ídem — «el cierre sigue `solicitado` y `repo.resolverCierre` no se llamó» |
| R9 | ídem — «falta la confirmación de una gestión: error en ESA gestión» |
| R10 | ídem — «gestión ajena» y «gestión duplicada» |
| R11 | ídem — «un `incidente` enviado da un mensaje propio, distinto del de ajena» |
| R12 | ídem — «la guía leída no es la de ese paquete» |
| R13 | ídem — «gestión que vuelve sin número de guía: bloquea con su mensaje, no se omite» |
| R14 | ídem — en todos los rojos, `repo.resolverCierre` **no** se llamó |
| R15 | ídem — «sin el campo, se trata como lista vacía» |
| R16 | ídem — «cierre sin retornables: mismo payload de siempre» · `tests/components/CierresAdminConfirmacionFisica.test.tsx` — «se aprueba de un click» |
| R17 | `tests/unit/repositories/cierres-admin-confirmacion-fisica.test.ts` — «marca las gestiones esperadas dentro de la misma tx» |
| R18 | ídem — «`count` insuficiente: lanza y revierte la aprobación entera» |
| R19 | ídem — «el `data` lleva exactamente `confirmadaFisicaAt`» · `ordenes-columnas-money-safe.guardia.test.ts` y `dinero-centimos-cuando-existen.guardia.test.ts` verdes sin tocar |
| R20 | `tests/integration/db/confirmacion-fisica-migration.test.ts` — «la columna es nullable, sin default, y las filas previas quedan en NULL» |
| R21 | `tests/unit/guards/confirmacion-sin-lectores.guardia.test.ts` (censo, con autocomprobación) |
| R22 | `tests/integration/db/wallet-idempotencia.test.ts` — «segunda aprobación: `conflict`, una sola marca» |
| R23 | `cierres-admin-confirmacion-fisica.test.ts` (repo) — «toda gestión anclada quedó confirmada en la misma tx» · `cierres-admin-anclaje-devolucion.test.ts` verde **sin tocar** |
| R24 | ídem — «rechazar no escribe ninguna marca» + typecheck (`never` en la rama `rechazado`) |
| R25 | ídem — «un cierre ya aprobado da `conflict` y no ejecuta el bloque» |
| R26 | **POR CONSTRUCCIÓN, no por un test propio** (m1 de la revisión: el caso que esta fila afirmaba **no existe**). `forzarSolicitudVencido` toca **sólo** `cierreDia.estado`, y `confirmadaFisicaAt` se escribe en **un único sitio** del árbol, dentro de la rama `aprobado` de `resolverCierre`; verificado por censo, no por cita. La **segunda** mitad —que la aprobación posterior sí exige la lista completa— sí está medida, por R7/R8 |
| R27 | `CierresAdminConfirmacionFisica.test.tsx` — «dice con texto cuántas faltan y qué hacer» (se lee el texto, no el `disabled`) |
| R28 | ídem — «se confirma por cámara» y «se confirma por número tecleado» |
| R29 | ídem — «código no interpretable: avisa y no marca nada» |
| R30 | ídem — «guía que no pertenece a este cierre» |
| R31 | ídem — «guía del cierre cuyo paquete no vuelve: mensaje propio» |
| R32 | ídem — «guía ya confirmada: lo dice y no cuenta dos veces» |
| R33 | ídem — «cada fila muestra guía, remisión, destinatario, resultado y estado» |
| R34 | ídem — «los incidentes aparecen nombrados como excluidos, con su razón» |
| R35 | ídem — «cerrar la ventana sin completar no llama a `aprobarCierre`» |
| R36 | ídem — «con la ventana cerrada, la tarjeta de escaneo no está en el árbol» |
| R37 | ídem — «con incidentes y retornables, la confirmación va antes que los montos» |
| R38 | `tests/unit/services/cierres-admin-service.test.ts` — «el adminSatélite recibe la misma exigencia» |
| R39 | `tests/unit/services/cierres-bodega-admin-service.test.ts:654` — «el cierre de bodega no pide confirmación física». **Ojo al nombre**: el archivo que este mapa citaba antes (`cierre-bodega-service.test.ts`) existe y **no** menciona la 238; `aprobarCierreBodega` vive en `CierresBodegaAdminService`, junto a sus tres hermanos (ver la nota de T5.1) |
| R40 | `tests/unit/guards/aprobacion-escrituras-cubiertas.guardia.test.ts` — inventario con los dos bloques de `tx.gestionOrden.updateMany` y sus dos suites |
| R41 | El caso de **orden dentro de la transacción** de `cierres-admin-confirmacion-fisica.test.ts` (repo) y el de `wallet-idempotencia`, que son los que se ponen rojos si el bloque aterriza mal. ⚠️ `cierres-admin-caja-cod.test.ts` y las suites de los cinco feeds están verdes **pero pasan `confirmacionFisica: []`**, así que el bloque nuevo nunca se ejecuta allí: su verde es coherencia, **no evidencia** (m6 de la revisión) |
| R42 | `aprobacion-escrituras-cubiertas.guardia.test.ts`, frente 2, tras re-apuntar `cierres-admin-indemnizacion.test.ts` (T3.8) |
| R43 | `tests/integration/db/confirmacion-fisica-migration.test.ts` — «aplica, re-aplica y revierte» |
| R44 | `cierres-admin-confirmacion-fisica.test.ts` (repo) — «el error lleva sólo el id del cierre» |

---

## Paralelismo y conflictos de archivo

- **Dentro de la feature:** las `[P]` de cada tanda tocan archivos distintos. T1.1 bloquea T1.2 y
  T1.3; T3.3 bloquea T3.4-T3.9; T4.2 bloquea T4.3-T4.7. **T3.7 y T3.8 no son paralelas entre sí**:
  las dos hablan de la misma guardia desde lados opuestos.
- **Backend antes que frontend:** T1-T3 y T4 **no** se trabajan a la vez. T4 lee contratos que T2/T3
  todavía están moviendo.
- **Con otras fichas:** esta toca `CierresAdminRepository.resolverCierre`, `CierresAdminService`,
  `lib/types/cierres-admin.ts` y `CierresAdminModule.tsx`. La **239** toca los tres primeros y **ya
  está en producción**, así que el conflicto es con cualquier ficha que vuelva sobre ellos: no se
  trabaja en paralelo con nada que toque la transacción de aprobación.
- **Antes de registrar cualquier id o rama nuevos**, mirar `origin/dev`: ya hubo dos colisiones de id
  entre sesiones.
