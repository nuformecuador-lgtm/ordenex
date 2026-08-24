# Feature 276 — tasks

> **Regla de «hecho» en esta ficha:** el criterio es **un aserto que se pone rojo si el código está
> mal**, nunca un `grep` ni «se leyó y está bien». Donde la comprobación solo pueda ser humana, se
> dice explícitamente y se nombra quién firma.
>
> **Regla de dinero:** toda task marcada 💰 toca una ruta que acaba en `cobroRechazado` (56). Ninguna
> se da por hecha con un test de servicio con dobles a secas: necesita además su aserto contra
> Postgres real o su caso de no-efecto. En este repo está medido que una mutación del `WHERE` pasa
> en verde una suite de dobles.

Leyenda: `[P]` = paralelizable con las demás `[P]` de su bloque.

---

## T0 — Medir producción antes de escribir nada (BLOQUEA TODO) · R37

Consulta de **solo lectura**, con el predicado de intentos vigente (no uno reescrito a mano), que
devuelva: cuántas órdenes vivas tienen `intentos >= umbral` y **en qué estado** están, agrupadas por
`order_status.value`.

Qué hacer con lo que salga:

- **Solo órdenes en `devuelta`** → la foto del 2026-08-24 sigue valiendo, «sin backfill» se sostiene
  y se sigue.
- **Alguna en `reprogramada`, `en_bodega_*`, `por_recoger` o `en_reparto`** → **se para** y se lleva
  al humano (**Q6** de requirements). T7/T8 dejarían esas órdenes inasignables sin que nadie lo haya
  decidido.

Además, en la misma corrida: contar las órdenes en `reprogramada` cuya gestión vigente está en un
cierre **no aprobado**. Es la población que T6 va a congelar el primer día.

**Hecho cuando:** `progress/impl_276.md` abre con la fecha, el SHA de `origin/dev` usado, el SQL
exacto y su salida pegada, y una línea de decisión por cada uno de los dos números. Verificación
humana: la firma el implementer, la revisa el reviewer.

**No hacer:** ningún `UPDATE`, ni «de prueba». R35.

---

## T1 [P] — El punto único de la regla · R3, R7

Crear `lib/types/tope-intentos.ts` (módulo **puro**: sin Prisma en runtime, sin servicios, sin
`next/*`) con `RESULTADOS_PERMITIDOS_EN_EL_TOPE`, `alcanzaElTope(intentos, umbral)` y
`permitidoEnElTope(resultado)`. El umbral **entra por parámetro**; el módulo no lo lee ni lo importa.

**Hecho cuando:** existe `tests/unit/types/tope-intentos.test.ts` con:

1. `RESULTADOS_PERMITIDOS_EN_EL_TOPE` fijado por **igualdad de contenido** a los tres values —el
   test se pone rojo si alguien lo ensancha, que es justo lo que tiene que costar una decisión;
2. `permitidoEnElTope("reprogramada") === false` y `permitidoEnElTope("devuelta") === false`;
3. una tabla que recorre **todos** los values de `GestionResultado` y afirma que los que no están en
   la lista dan `false` (la lista de inclusión probada como inclusión, no como negación);
4. `alcanzaElTope` con `umbral = 3`: `1 → false`, `2 → true`, `3 → true`, `4 → true`; y con
   `umbral = 5`: `3 → false`, `4 → true`. Falla si alguien escribe `===` en vez de `>=`;
5. un aserto de que el fichero **no** nombra `MIN_INTENTOS_ENTREGA` ni `reintentosConfig` (patrón
   de `tests/unit/components/intentos-entrega.test.tsx:171`).

---

## T2 [P] — El valor de enum y su migración · R22, R36

`orden_historial_origen_tipo` gana `rechazo_tope_intentos` (**Q5**). Migración con `migration.sql` y
`down.sql`, más el alta en `ORDEN_HISTORIAL_ORIGEN_TIPO_SEED` con su comentario.

**Antes de escribir el `down.sql`:** abrir los `down.sql` de
`20260819110000_orden_historial_origen_anclaje_devolucion` y
`20260820120000_orden_historial_origen_gestion_tienda_ayuda` y **copiar su forma** (si recrean el
tipo con la lista o solo eliminan). Los `down.sql` previos **no se tocan**: son fotos históricas.

**Hecho cuando:**

- existe `tests/integration/db/rechazo-tope-intentos-migration.test.ts` (molde:
  `anclaje-devolucion-migration.test.ts`) que afirma contra Postgres real que el value existe en el
  enum y que el `down` deja la base legible por el código anterior (R36);
- `tests/unit/types/orden-historial-types.test.ts` sigue verde con el value añadido, y sus asertos
  de que **NO** está en `ORIGEN_TIPOS_VISITA_REAL` ni en `ORIGEN_TIPOS_CON_GESTION` existen y son
  explícitos. Si el value entrara en la lista de visita real, ese test se pone rojo.

**No hacer:** ninguna columna, ninguna tabla, ningún `order_status` nuevo.

---

## T3 — La arista del grafo, con su productor (depende de T2; se mergea con T9)

`lib/types/order-status-transiciones.ts`: `sin_gestionar` gana
`{ to: "rechazada", via: "rechazo_tope_intentos", rol: "admin (aprobar cierre)" }`, con el comentario
que explique que su productor es el bloque de la aprobación y por qué no reusa
`liberacion_sin_gestionar`.

⚠️ **Va en el MISMO commit que T9.** Una arista sin productor es el error de la 154 que costó el tren
154+155+156; y sin la arista, T9 hace que el choke point **revierta la aprobación entera**.

**Hecho cuando:** `tests/unit/domain/order-status-transiciones.guardia.test.ts` está verde con el
inventario **re-derivado** (no copiado) en `tests/fixtures/inventario-transiciones-140.ts`, y existe
un caso que afirma que el par `(sin_gestionar, rechazada)` es legal y que `(sin_gestionar, entregada)`
sigue sin serlo.

---

## T4 — 💰 La puerta en el panel del mensajero · R1, R2, R5, R6, R7, R11 (depende de T1)

En `MisAsignacionesService.gestionar`, junto a las guardas de bloqueo por cierres y de reserva por
día —es decir **antes** del `subirEvidenciasCompensadas` y antes de la transacción—. El `Pick` de
`historial` se ensancha con `"contarIntentos"`. El umbral sale de `reintentosConfig`.

**Hecho cuando:** existe `tests/unit/services/mis-asignaciones-tope-intentos.test.ts` con:

1. con `intentos = umbral − 1`, `resultado: "reprogramada"` → `conflict` con el motivo compartido;
2. ídem con `"devuelta"`;
3. con `intentos = umbral − 1`, los **tres** permitidos siguen llegando al repositorio (un caso por
   resultado; el de `incidente` es el que blinda la decisión 3 del humano);
4. con `intentos = umbral − 2`, `"reprogramada"` pasa (la puerta no se cierra antes de tiempo);
5. **R5, el caso que de verdad importa**: en el rechazo, el doble de `IFileStorage` recibe **cero**
   llamadas de subida y el doble del repositorio **cero** llamadas de escritura. Falla si alguien
   coloca la guarda después del upload;
6. **R7**: con `REINTENTOS_MIN_INTENTOS = 5` en el entorno del test, con `intentos = 3` pasa y con
   `intentos = 4` no. Falla si alguien escribió un `3`;
7. **R11**: no hay ninguna rama que dependa de un campo del input para decidir; el caso 1 se ejecuta
   con el input tal cual lo mandaría un cliente que ignore la UI.

**No hacer:** tocar el orden de las guardas anteriores (bloqueo por cierres primero, siempre).

---

## T5 — 💰 La puerta en la pestaña de ayuda de la tienda · R1, R4, R5, R6, R11 (depende de T1)

En `GestionDesdeAyudaService.gestionar`, paso **5-ter**, después de la guarda de reserva por día y
antes de subir evidencias. `GestionDesdeAyudaDeps` gana
`historial: Pick<IOrdenHistorialService, "contarIntentos">`, **obligatoria** (no opcional).

**Hecho cuando:**

1. `tests/unit/services/gestion-desde-ayuda-tope-intentos.test.ts`: `"reprogramada"` en el tope →
   `conflict` con el mismo motivo que T4 (**el mismo símbolo importado**, no un literal gemelo);
   `"rechazada"` en el tope sigue pasando; con `intentos = umbral − 2` reprogramar pasa;
2. el caso de no-efecto: cero subidas, cero llamadas a `crearGestionDesdeAyuda`;
3. **el composition root PASA la dependencia**: un caso en
   `tests/integration/actions/gestion-desde-ayuda-action.test.ts` (o el que exista para esa action)
   que ejercite la action **sin** inyectar el service y afirme que el objeto construido trae el
   `historial` cableado. Comprobar que el módulo lo importa **no vale**: en este repo hay
   precedente de notificadores muertos con la suite verde.

---

## T6 — 💰 La liberación de reprogramadas espera al cierre · R12, R13, R14, R15, R16 (depende de T0)

**T6.1 — Repositorio.** `LiberacionReprogramadaRepository.findOrdenesLiberables` amplía el `select`
de la gestión con `cierreId`, `cierre.estado` y la sonda de visita real
(`historialEstados` filtrado por `ORIGEN_TIPOS_VISITA_REAL`, `take: 1`). **No decide nada**: conserva
su filtro por fecha, su `orderBy` y su `take: 1`. `OrdenLiberableRow` crece con esos tres hechos.

**T6.2 — Servicio.** `LiberacionReprogramadaService.ejecutarLiberacion` aplica la regla: libera si la
gestión **no puede ya subir el contador** (no es visita real **o** su cierre está `aprobado`); si no,
la cuenta en `esperandoCierre` y sigue. `LiberacionResult` gana ese contador y el route handler lo
devuelve.

**Hecho cuando:**

- `tests/unit/services/liberacion-reprogramada-tope.test.ts`:
  1. visita real + cierre `solicitado` → **no** se libera, `esperandoCierre = 1`, y el doble del
     repositorio **no** recibe `liberarOrden` (R13);
  2. visita real + cierre `aprobado` → se libera (R15);
  3. visita real + `cierreId = null` → **no** se libera (todavía puede entrar a un cierre);
  4. **no** visita real (`reprogramacion_tienda`) + `cierreId = null` → **sí** se libera (R14: la
     reprogramación de escritorio de la tienda no pierde su latencia);
  5. cierre `rechazado` y cierre `vencido` → no se liberan (y el comentario cita la válvula
     `forzarSolicitudVencido`);
  6. una orden que falla no aborta la corrida y la siguiente se libera igual (R16);
- 🔴 **y además** `tests/integration/db/liberacion-reprogramada-cierre-real.test.ts`, **contra
  Postgres**: sembrar una orden `reprogramada` con dos gestiones (una vieja anulada y la vigente),
  y afirmar que `findOrdenesLiberables` devuelve el `cierre.estado` y la sonda de visita real
  **de la gestión correcta**. Este test es obligatorio: los de arriba usan dobles y no ven el SQL.

**Hecho cuando (mutación, se ejecuta y se anota):** quitar del `select` la sonda de visita real deja
rojo el test de integración; cambiar `aprobado` por otro estado en el servicio deja rojo el caso 2.
Los dos se comprueban a mano una vez y el resultado se pega en `progress/impl_276.md`.

---

## T7 [P] — 💰 La asignación desde bodega central no asigna una orden agotada · R18, R19, R20

`GuiaAsignacionService.asignarDesdeBodega`: dep nueva **obligatoria**
`Pick<IOrdenHistorialService, "contarIntentosEnLote">` (por `import type`), guarda por lote después
de la validación por orden y antes del gate de coordenadas. Motivo nuevo **en**
`lib/services/mensajes-bloqueo.ts`.

**Hecho cuando:** `tests/unit/services/guia-asignacion-tope-intentos.test.ts`:

1. lote de 3 con **una** en el umbral → `conflict`, `detalle` con las **tres** órdenes y el motivo
   compartido, y `asignarBodegaLote` **no** se llama (R19, todo-o-nada);
2. lote con todas por debajo del umbral → se asigna, con **una sola** llamada a
   `contarIntentosVigentesEnLote` (R18 sin N+1);
3. una orden en `reprogramada` sigue rechazándose con `MSG_ORDEN_REPROGRAMADA_BLOQUEADA`, no con el
   motivo nuevo (el orden de guardas no se invierte);
4. `REINTENTOS_MIN_INTENTOS = 5`: con 4 intentos deja asignar, con 5 no (R7);
5. `asignarRecoleccion` **no** consulta el contador (caso explícito con el doble: cero llamadas).

---

## T8 [P] — 💰 Lo mismo en la bodega satélite · R18, R19, R20 (espejo de T7)

`AsignacionSateliteService.asignar`, misma dep obligatoria y **el mismo símbolo** de motivo.

**Hecho cuando:** `tests/unit/services/asignacion-satelite-tope-intentos.test.ts` con los casos 1, 2
y 4 de T7, más un caso que afirma que el motivo es **idéntico** al de T7 comparando los dos contra la
constante compartida (R20). Falla si alguien escribe el texto a mano en uno de los dos.

---

## T9 — 💰 El rechazo de la no gestión al aprobar el cierre · R21–R27 (depende de T2 y T3)

Absorbe la ficha **218**. En `CierresAdminRepository.resolverCierre`, dentro del bloque de
`liberacionSinGestionar` ya existente y **sin mover ningún feed de dinero**:

1. contar intentos **dentro de la transacción** con `whereIntentosVigentes` sobre
   `tx.gestionOrden.groupBy` (predicado importado, **no** reescrito);
2. partir el conjunto: `< umbral` → bodega (como hoy); `>= umbral` → `rechazada` con `updateMany`
   guardado por `estatusId = sin_gestionar` y `data` de **una sola clave**;
3. gestión sintética `rechazada`, `cierre_id NULL`, `mensajero_id` del cierre, motivo fijo sin PII
   (**R23, sujeto a Q1**);
4. `appendCambioEstado` con `origen_tipo = rechazo_tope_intentos`, actor = el admin, enlazando la
   gestión.

El `umbral` viaja **inyectado desde `CierresAdminService`** dentro de la config (R7): la
configuración no se lee en el repositorio.

**Hecho cuando:**

- `tests/unit/services/cierres-admin-tope-sin-gestion.test.ts`: el servicio pasa el umbral en la
  config, y no lo pasa cuando el catálogo no resuelve (fallo cerrado del bloque, como hoy);
- 🔴 `tests/integration/db/cierre-sin-gestion-tope-sql-real.test.ts` (molde:
  `cierre-sin-gestion-sql-real.test.ts`), **contra Postgres**, con estos casos:
  1. orden barrida con `intentos = umbral` → acaba **`por_devolver` / `por_devolver_a_tienda`**
     (porque el bloque de la 139 la recoge en la misma tx) y su historial tiene **dos** filas:
     `sin_gestionar → rechazada` con `rechazo_tope_intentos`, y `rechazada → por_devolver*` con
     `devolucion_rechazada` (R21/R22);
  2. orden barrida con `intentos = umbral − 1` → acaba en `en_bodega_*` con
     `liberacion_sin_gestionar`, mensajero limpio y `prioridad = true` (R25: la rama vieja intacta);
  3. **el punto que no se confía, se mide**: una orden barrida con una gestión **anulada** de este
     mismo cierre no ve subir su contador dentro de la tx (R21, la nota de §5.5 del design);
  4. ejecutar la aprobación **dos veces** → una sola fila de historial, una sola gestión sintética,
     un solo cambio de estado (R26);
  5. **rechazar** el cierre → cero órdenes movidas, cero gestiones (R27);
  6. money: los importes del `cierre_detail` y los movimientos de billetera del cierre aprobado son
     **idénticos** con y sin órdenes en el umbral (R24);
- `tests/unit/services/cierres-admin-caja-cod.test.ts` sigue verde **sin tocar sus asertos de orden**.
  Un rojo ahí es regresión, no una aserción que se actualiza.

**Válvula declarada:** si **Q1** se responde «no cobra», se retira el paso 3, el caso 1 pierde la
gestión sintética y se **añade** un caso que afirme que no nace ninguna. No se implementa el paso 3
sin la firma.

---

## T10 — 💰 El cron de SLA mira el contador en la rama `wrong_*` · R28, R29, R30

`DevolucionSlaService.ejecutar`:

1. un **solo** conteo por corrida con `contarIntentosVigentesEnLote` sobre las candidatas; las **dos**
   ramas leen del mismo `Map` (se elimina el conteo de a uno dentro del bucle);
2. la rama `wrong_number`/`wrong_address` escala a `rechazada` sin esperar la ventana cuando
   `intentos >= umbral`.

**Hecho cuando:** `tests/unit/services/devolucion-sla-tope-wrong.test.ts`:

1. `wrong_address`, `intentos = umbral`, **2 h** desde el anclaje → escala, y `escalarDevueltaSla`
   recibe la orden (R28);
2. `wrong_address`, `intentos = umbral − 1`, 2 h → **no** escala; a los 5 días → escala (R29: la
   ventana intacta por debajo del umbral);
3. `not_found` conserva **exactamente** su comportamiento actual en los dos lados del umbral (caso
   de no-regresión, con las mismas expectativas que `devolucion-sla-service.test.ts`);
4. el doble del historial recibe **una** llamada por corrida, no una por orden (R30 + el N+1);
5. una orden que ya salió de `devuelta` entre la lectura y la escritura no crea gestión sintética
   (R30, el caso de doble cobro; ya existe, se conserva).

Los casos de `devolucion-sla-service.test.ts` y `devolucion-sla-dinero.test.ts` que se pongan rojos
por el cambio de forma del conteo se actualizan **con la decisión escrita al lado**; ninguno se
relaja a un aserto de tamaño.

---

## T11 [P] — El dato derivado y la UI del mensajero · R8, R9, R10 (depende de T1, T4)

- `MiAsignacionDTO` gana `enElTope?: boolean`, calculado en
  `MisAsignacionesService.listarMisAsignaciones` con `alcanzaElTope(intentosEntrega, umbral)`.
- `GestionarOrdenPanel.tsx` filtra `RESULTADO_BOTONES` con `permitidoEnElTope` cuando
  `orden.enElTope`, y muestra un texto que explica que a esta orden le queda el último intento.
  «Reportar incidente» **sigue visible**.

**Hecho cuando:** `tests/components/GestionarOrdenPanelTope.test.tsx`:

1. con `enElTope: true`, «Reprogramar» y «Devolver» **no** están en el DOM y «Entregar», «Rechazar»
   y «Reportar incidente» sí;
2. con `enElTope: false`, los cinco están (no-regresión);
3. el texto explicativo aparece solo en el primer caso, y **no** contiene el número del umbral;
4. ampliar `tests/unit/components/intentos-entrega.test.tsx` (o su gemelo) para que el panel y el
   modal de la tienda tampoco nombren `MIN_INTENTOS_ENTREGA` ni `reintentosConfig` (R10).

---

## T12 [P] — La UI de la pestaña de ayuda · R8, R9, R10 (depende de T1, T5)

Mismo campo `enElTope` en el DTO de novedades; `GestionarDesdeAyudaModal.tsx` deja de ofrecer
«Reprogramar» en el tope y dice por qué.

**Hecho cuando:** `tests/components/GestionarDesdeAyudaModalTope.test.tsx` con los tres casos de T11
adaptados a los dos modos (`reprogramar` / `rechazar`), y un caso que afirma que el modo
`reprogramar` **no se puede abrir** con `enElTope: true`.

---

## T13 — La guardia del invariante · R31, R32, R33, R34 (depende de T4–T10)

Crear `tests/unit/guards/tope-intentos-invariante.guardia.test.ts`. Es el test que impide que esta
feature se deshaga sola dentro de seis meses:

1. **R33 — el criterio no se movió.** `RESULTADOS_QUE_CUENTAN_COMO_INTENTO` y
   `ORIGEN_TIPOS_VISITA_REAL` fijados por **igualdad de contenido** a lo que hay hoy, con un
   comentario que diga que ensancharlos desde esta ficha **cobra de más**. Y un aserto de que
   `rechazo_tope_intentos` no está en ninguna de las dos.
2. **R31/R32 — las vías de retorno a circulación están enumeradas y todas tienen puerta.** Una tabla
   en el test que liste las cinco vías del §1 del design con el símbolo que las cierra, y que falle
   si aparece una arista **nueva** hacia `en_bodega_central`, `en_bodega_satelite` o `por_recoger` en
   `TRANSICIONES` que no esté en la tabla. Es una guardia de inventario, no de prosa: se deriva de
   `TRANSICIONES`, no se escribe a mano.
3. **R34** — un aserto de que el anclaje de la devolución y el conteo de intentos siguen siendo dos
   derivaciones separadas: reusar/ampliar `tests/unit/guards/anclaje-vs-intentos.guardia.test.ts` en
   vez de escribir una segunda guardia.

**Hecho cuando:** los tres bloques están verdes, y el bloque 2 se pone rojo al añadir a mano una
arista de prueba hacia `en_bodega_central` (comprobado una vez y anotado).

---

## T14 [P] — El deshacer sigue vivo · R17 (depende de T6)

No hay código que escribir: la ventana de deshacer depende de `gestion.cierre_id`, no del estado, y
la opción B no cambia el estado. Lo que hay que escribir es **la prueba de que sigue siendo cierto**.

**Hecho cuando:** en `tests/unit/services/cierre-dia-service.test.ts` (o el archivo del deshacer) hay
casos que afirman: (1) una gestión `reprogramada` con `cierre_id NULL` sobre una orden en
`reprogramada` **se puede deshacer** y la orden vuelve a `en_reparto`; (2) con `cierre_id` poblado,
`conflict` como hoy; (3) `ESTADOS_ESPERADOS.reprogramada` sigue siendo `["reprogramada"]` — con un
comentario que explique que la 276 eligió **no** crear pre-estado y que por eso esta entrada no
cambia.

---

## T15 [P] — Sin PII en nada de lo nuevo · R38

**Hecho cuando:** un caso por cada texto nuevo (los dos motivos de rechazo, el motivo de la gestión
sintética de T9 y el aviso agregado de T6) que afirme que **no** contiene número de guía, nombre de
destinatario, dirección, id de orden ni id de usuario. Molde: los asertos de PII de
`devolucion-sla-service.test.ts` y `ConfirmacionFisicaNoAplicableError`.

---

## T16 [P] — La migración no mueve órdenes · R35 (depende de T2)

**Hecho cuando:** `git diff origin/dev...HEAD -- db/migrations/` no contiene ningún `UPDATE`
`INSERT` ni `DELETE` sobre `orden`; y el test de migración de T2 afirma que aplicar y revertir la
migración **no cambia** el `estatus_id` de ninguna orden sembrada.

---

## T17 — Gate COMPLETO (depende de T1–T16)

**`./init.sh` completo. El modo rápido NO vale y se niega solo**: el diff toca `db/migrations/`,
`lib/types/` y archivos con nombre de dinero. Intentar `--rapido` es un `fail`, no un aviso.

Además, en el mismo paso:

- comparar contra un baseline de `dev` **medido en esta misma sesión** (los baselines citados en
  `progress/current.md` caducan con cualquier PR ajeno). Delta esperado: **0**;
- escribir el exit code **dentro** del log (`INIT_EXIT=$?`), no fiarse del que llega por fuera;
- si la base local es compartida con otro worktree, correr la migración de T2 antes y anotarlo: una
  migración de otra rama pone rojo un gate ajeno.

**Hecho cuando:** `./init.sh` termina en verde, o con delta 0 contra un baseline medido, pegado en
`progress/impl_276.md` con su fecha y su SHA.

---

## T18 — Bookkeeping (depende de T17)

- `progress/impl_276.md` con el mapa **R → test** completo (R1–R38), la salida de T0, las dos
  mutaciones comprobadas de T6 y la de T13, y qué se hizo con **Q1** (con firma y fecha) y con
  **Q2/Q3/Q4/Q6**.
- `feature_list.json`: ficha **276** actualizada, y ficha **218** con la nota de que su decisión se
  tomó aquí. El diff debe tocar **solo** esas dos fichas (otras sesiones dejan altas sin commitear
  en ese archivo y un `git checkout` las borra).
- `progress/current.md` al día.
- ⚠️ Comprobar el **blob commiteado**, no el árbol de trabajo: `git show HEAD:specs/276-tope-de-intentos/tasks.md | head`.

**Hecho cuando:** el reviewer encuentra los 38 requisitos con un test nombrado y ejecutable, y
`git diff feature_list.json` no toca ninguna ficha ajena.

---

## Trazabilidad · R → test

| R | Qué exige | Test |
| --- | --- | --- |
| R1 | no se acepta `reprogramada`/`devuelta` en el tope | `mis-asignaciones-tope-intentos` 1-2 · `gestion-desde-ayuda-tope-intentos` 1 |
| R2 | los tres permitidos siguen pasando | `mis-asignaciones-tope-intentos` 3 |
| R3 | lista de inclusión, punto único | `tope-intentos.test.ts` 1-3 |
| R4 | la regla vale en las dos superficies | `gestion-desde-ayuda-tope-intentos` 1 (mismo símbolo que T4) |
| R5 | rechazo sin efectos (ni fotos, ni fila, ni historial) | `mis-asignaciones-tope-intentos` 5 · `gestion-desde-ayuda-tope-intentos` 2 |
| R6 | resultado de dominio con motivo accionable | `mis-asignaciones-tope-intentos` 1 · `mensajes-bloqueo` (igualdad de símbolo) |
| R7 | umbral de configuración, nunca a mano | `mis-asignaciones-tope-intentos` 6 · `guia-asignacion-tope-intentos` 4 · `cierres-admin-tope-sin-gestion` |
| R8 | la UI no ofrece lo prohibido | `GestionarOrdenPanelTope` 1 · `GestionarDesdeAyudaModalTope` 1 |
| R9 | y dice por qué | `GestionarOrdenPanelTope` 3 |
| R10 | el umbral no cruza al cliente | `GestionarOrdenPanelTope` 3-4 · `intentos-entrega.test.tsx` |
| R11 | el servidor rechaza aunque la UI no oculte | `mis-asignaciones-tope-intentos` 7 |
| R12 | no se libera sin cierre aprobado | `liberacion-reprogramada-tope` 1,3 · `liberacion-reprogramada-cierre-real` |
| R13 | mientras espera, nada se toca | `liberacion-reprogramada-tope` 1 |
| R14 | la gestión que no cuenta se libera igual | `liberacion-reprogramada-tope` 4 |
| R15 | al aprobar, se libera en la corrida siguiente | `liberacion-reprogramada-tope` 2 |
| R16 | idempotencia y resiliencia del cron | `liberacion-reprogramada-tope` 6 + casos vigentes de 46 |
| R17 | el deshacer sigue igual | `cierre-dia-service` (T14) 1-3 |
| R18 | no se asigna en el umbral | `guia-asignacion-tope-intentos` 1-2 · `asignacion-satelite-tope-intentos` 1-2 |
| R19 | todo-o-nada con detalle por orden | `guia-asignacion-tope-intentos` 1 |
| R20 | motivo único en las dos superficies | `asignacion-satelite-tope-intentos` (igualdad de constante) |
| R21 | la no gestión en el umbral acaba `rechazada` | `cierre-sin-gestion-tope-sql-real` 1,3 |
| R22 | por el choke point, actor admin, familia propia | `cierre-sin-gestion-tope-sql-real` 1 · `order-status-transiciones.guardia` (T3) |
| R23 | gestión sintética sin cierre *(Q1)* | `cierre-sin-gestion-tope-sql-real` 1 |
| R24 | money-neutral sobre el cierre aprobado | `cierre-sin-gestion-tope-sql-real` 6 · `cierres-admin-caja-cod` |
| R25 | por debajo del umbral, la liberación intacta | `cierre-sin-gestion-tope-sql-real` 2 |
| R26 | aprobar dos veces no duplica | `cierre-sin-gestion-tope-sql-real` 4 |
| R27 | rechazar no rechaza órdenes | `cierre-sin-gestion-tope-sql-real` 5 |
| R28 | `wrong_*` escala en el umbral sin esperar | `devolucion-sla-tope-wrong` 1 |
| R29 | por debajo, la ventana de 5 días intacta | `devolucion-sla-tope-wrong` 2 |
| R30 | idempotencia y un solo conteo | `devolucion-sla-tope-wrong` 4-5 |
| R31 | invariante: no vuelve a circulación | `tope-intentos-invariante.guardia` 2 |
| R32 | ni con el contador pendiente de subir | `tope-intentos-invariante.guardia` 2 · `liberacion-reprogramada-tope` 3 |
| R33 | el criterio de conteo no se toca | `tope-intentos-invariante.guardia` 1 |
| R34 | anclaje y conteo siguen separados | `anclaje-vs-intentos.guardia` (ampliado) |
| R35 | la migración no mueve órdenes | T16 + test de migración de T2 |
| R36 | migración reversible y legible | `rechazo-tope-intentos-migration` |
| R37 | población medible antes de desplegar | T0 (verificación humana, firmada) |
| R38 | sin PII | T15 |

---

## Orden y paralelismo

```
T0 ─┬─> T1 [P] ─┬─> T4 ──> T11 [P] ────────────┐
    │           ├─> T5 ──> T12 [P] ────────────┤
    │           └─> T7 [P], T8 [P] ────────────┤
    ├─> T2 [P] ─┬─> T3 ──> T9 ─────────────────┼──> T13 ──> T17 ──> T18
    │           └─> T16 [P] ───────────────────┤
    ├─> T6 ──> T14 [P] ────────────────────────┤
    ├─> T10 ───────────────────────────────────┤
    └─> T15 [P] ───────────────────────────────┘
```

Notas de dependencia que no son decorativas:

- **T0 bloquea todo.** Si aparecen órdenes en el umbral fuera de `devuelta`, T7/T8 las dejan
  inasignables y la decisión «sin backfill» deja de estar tomada (Q6).
- **T3 y T9 van en el mismo commit.** Arista sin productor = el error de la 154; productor sin arista
  = la aprobación del cierre revierte entera.
- **T13 va al final** porque su bloque 2 enumera lo que las demás tasks cierran; escrita antes, mide
  un mundo que todavía no existe.
- **T6 antes que T14**: el deshacer se prueba contra el comportamiento nuevo del cron, no contra el
  viejo.
