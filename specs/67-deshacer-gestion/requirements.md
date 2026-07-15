# Feature 67 — Deshacer gestión: devolver una orden a gestión · requirements.md

> Zona: fullstack · Complejidad: high · depends_on: 37
> Notación EARS estricta (ver `docs/specs.md`). Cada `R<n>` es testeable y sin detalle
> de implementación (el CÓMO va en `design.md`).

## Alcance

**SOLO el deshacer.** La primera mitad del pedido del humano (la gestión ligada al
cierre del día del mensajero) **YA EXISTE y NO se rehace**: la gestión nace con
`cierre_id = NULL` (feature 36), `CierreDiaRepository.findGestionesPendientes` lista
exactamente esas (`where: { mensajeroId, cierreId: null }`, feature 37/R2-R3) y
`CierreDiaModule` ya renderiza las 4 tablas. El vínculo formal al `CierreDia` se sella
al pulsar "Solicitar cierre" (todo-o-nada).

**Decisiones del humano ya tomadas (parte de la gate F1.4, no se re-preguntan):**
1. **Ventana:** solo mientras la gestión tenga `cierre_id IS NULL` (ANTES de solicitar
   el cierre).
2. **Rastro:** la gestión se **ANULA dejando huella** (quién la hizo, cuándo, quién la
   deshizo), **NO se borra**.

## Contexto verificado en el código (no inventado)

- `GestionOrden` (`db/schema.prisma` ~379): `cierreId` nullable, `pagoMensajero` e
  `ingresoBodegaRechazo` (snapshots), `evidenciaStoragePath`, `createdAt`. Sin columna
  de anulación hoy. RLS habilitada sin policies (solo service role).
- **El contador de intentos NO es una columna:** `OrdenHistorialService.contarIntentos`
  (`lib/services/OrdenHistorialService.ts:56-63`) lo deriva llamando a
  `OrdenHistorialRepository.contarPorDestino(ordenId, <id de devuelta>)`
  (`lib/repositories/OrdenHistorialRepository.ts:75-79`), que cuenta **todas** las filas
  de `orden_historial_estado` con `estatus_destino_id = devuelta`. Umbral configurable
  `REINTENTOS_MIN_INTENTOS` (default 3, `lib/config/reintentos.ts`).
- **El historial es append-only e inmutable por diseño** (feature 49): la fila no tiene
  `updated_at`/`deleted_at`; `appendCambioEstado`
  (`lib/repositories/registrar-cambio-estado.ts`) es el ÚNICO choke point y corre en la
  MISMA `$transaction` que la escritura de `orden.estatus_id`.
- **La fila del historial enlaza su gestión:** `orden_historial_estado.gestion_orden_id`
  (FK → `gestion_orden`) está poblado en las transiciones de la familia `gestion`; es `NULL`
  en las demás familias (p. ej. `ajuste_estado`).
- **⚠️ Esa FK es `ON DELETE SET NULL`, NO `RESTRICT`.** La migración
  `20260713120000_orden_historial_estado` la creó `ON DELETE RESTRICT` a mano, pero
  `20260714123909_reconcile_fks_drop_order_status_value` (mergeada 2026-07-14) la **recableó
  a `ON DELETE SET NULL`** junto con otras 4, para reconciliar el SQL con `schema.prisma`: la
  relación `gestion GestionOrden? @relation(fields: [gestionOrdenId], references: [id])` es
  OPCIONAL y no declara `onDelete`, y el default de Prisma para relaciones opcionales es
  `SetNull`. Verificado en el `migration.sql` y el `down.sql` de esa carpeta.
  **Consecuencia:** borrar una gestión NO está bloqueado por el esquema; un DELETE dejaría
  `gestion_orden_id` en `NULL` **en silencio**, cortando el vínculo entre la fila de
  historial y su gestión sin ningún error.
- Hoy **ningún código borra gestiones** (`rg "gestionOrden\.(delete|deleteMany)"` → 0
  resultados): la vía de borrado es hipotética, pero el esquema ya no la impide, así que la
  derivación del contador no puede apoyarse en la integridad referencial.
- **Una gestión `devuelta` NUNCA deja la orden en `devuelta`** (feature 47,
  `MisAsignacionesService.resolverSeguimientoDevuelta` + `crearGestionYTransicionar`):
  en la MISMA tx emite un SEGUIMIENTO a `en_bodega`/`en_bodega_satelite` (reintento,
  **limpiando `mensajero_asignado_id`**) o a `rechazada` (escalado, conservando el
  mensajero). Esa gestión produce **2** filas de historial, ambas con `gestion_orden_id`.
- **La wallet solo se alimenta al APROBAR el cierre:** `WalletFeedService`,
  `WalletTiendaFeedService` y `WalletMensajeroFeedService` leen `gestionOrden.findMany({
  where: { cierreId } })` dentro de la tx de aprobación (`CierresAdminRepository:168-180`).
  Una gestión con `cierre_id = NULL` no llega jamás a la wallet.
- **Rutas que consumen "gestiones sin cierre" y que la anulación debe considerar:**
  `CierreDiaRepository.findGestionesPendientes` (vista y `solicitarCierre`),
  `CierreDiaRepository.crearCierre` (`updateMany where { mensajeroId, cierreId: null }`,
  el que **vincula** al cierre) y `CorteDiarioRepository.findMensajerosConActividadSinCierre`
  (`where { cierreId: null }`, cron de la feature 41).
- El módulo `/cierre-dia` es exclusivo del rol `mensajero`: `page.tsx` hace `notFound()`
  para cualquier otro rol, y `CierreDiaService` responde `forbidden` si `actor.rol !== "mensajero"`.
- `ORIGEN_GESTION = "en_reparto"` es el ÚNICO estado desde el que se puede gestionar
  (`MisAsignacionesService:35`, guardia `cargarOrdenGestionable`).
- El enum `orden_historial_origen_tipo` tiene hoy 11 valores; `ORDEN_HISTORIAL_ORIGEN_TIPO_SEED`
  (`lib/types/orden-historial.ts`) es la fuente única con chequeo de exhaustividad, y
  `tests/unit/repositories/orden-historial-cobertura.test.ts` fija el conjunto cerrado de
  call-sites que escriben estado.

---

## Requisitos

### Ventana y elegibilidad

**R1.** MIENTRAS una gestión tenga `cierre_id IS NULL` y no esté anulada, el sistema DEBE
permitir deshacerla (devolver su orden a gestión).

**R2.** SI la gestión a deshacer ya está vinculada a un cierre (`cierre_id IS NOT NULL`),
ENTONCES el sistema DEBE rechazar la operación con un resultado de conflicto y un motivo
accionable, sin producir ningún efecto.

**R3.** SI la gestión a deshacer ya está anulada, ENTONCES el sistema DEBE rechazar la
operación con un resultado de conflicto, sin producir ningún efecto adicional (un segundo
envío no vuelve a transicionar la orden).

**R4.** SI la gestión a deshacer NO es la gestión no-anulada más reciente de su orden,
ENTONCES el sistema DEBE rechazar la operación con un resultado de conflicto, sin efectos.

**R5.** SI el estado actual de la orden NO es el estado que dejó esa gestión (la orden ya
avanzó por otra vía: bodega, cron de liberación, devolución a la tienda de origen o ajuste
administrativo), ENTONCES el sistema DEBE rechazar la operación con un resultado de
conflicto, sin efectos.

**R6.** SI la orden de la gestión está borrada (soft-delete), ENTONCES el sistema DEBE
rechazar la operación con un resultado de conflicto, sin efectos.

### Autorización (server-side)

**R7.** SI quien invoca deshacer no tiene sesión válida, ENTONCES el sistema DEBE responder
`unauthenticated` sin ejecutar la lógica de negocio ni tocar la base de datos.

**R8.** SI quien invoca deshacer tiene un rol distinto de `mensajero`, ENTONCES el sistema
DEBE responder `forbidden`, sin efectos.

**R9.** SI la gestión a deshacer no pertenece al mensajero que invoca (su `mensajero_id` no
es el actor), ENTONCES el sistema DEBE responder `forbidden`, sin efectos y sin revelar
datos de la gestión ajena.

**R10.** El sistema DEBE validar el identificador de la gestión en el borde antes de llegar
al servicio; SI el identificador no tiene forma válida, ENTONCES el sistema DEBE responder
`validation_error` sin ejecutar la operación.

### Anulación con rastro (decisión 2 del humano)

**R11.** CUANDO se deshace una gestión, el sistema DEBE conservar su fila (NO borrarla) y
marcarla como anulada registrando **el instante de la anulación** y **el usuario que la
deshizo**.

**R12.** CUANDO se deshace una gestión, el sistema DEBE conservar intactos todos sus datos
originales (resultado, monto recibido, método de pago, motivo, fecha de reprogramación,
referencia a la evidencia, mensajero autor e instante de creación), de modo que quede
auditable quién la hizo y cuándo.

**R13.** MIENTRAS una gestión esté anulada, el sistema NO DEBE incluirla en ninguno de los
4 grupos (entregada/reprogramada/devuelta/rechazada) del módulo "Cierre del día".

**R14.** MIENTRAS una gestión esté anulada, el sistema NO DEBE incluirla en los totales por
método de pago ni en el total general del cierre del día.

**R15.** MIENTRAS una gestión esté anulada, el sistema NO DEBE incluirla en el derivado del
pago al mensajero (feature 39) ni en el derivado del ingreso de bodega por rechazo
(feature 56), ni en vivo ni en el snapshot.

**R16.** MIENTRAS una gestión esté anulada, el sistema NO DEBE vincularla a ningún
`cierre_dia`, ni al solicitar el cierre (feature 37) ni en el corte diario automático
(feature 41).

**R17.** El sistema NO DEBE considerar una gestión anulada como "actividad del día pendiente
de cierre" al decidir a qué mensajeros les crea un cierre `vencido` el corte diario.

### Transición de la orden

**R18.** CUANDO se deshace una gestión con éxito, el sistema DEBE dejar la orden en el
estado `en_reparto` (el único estado desde el que se puede volver a gestionar).

**R19.** CUANDO se deshace una gestión con éxito, el sistema DEBE dejar la orden asignada al
mensajero autor de la gestión, incluso si el seguimiento de una gestión `devuelta` había
limpiado la asignación (reintento a bodega).

**R20.** CUANDO se deshace una gestión con éxito, el sistema DEBE registrar la transición de
estado resultante en el historial de la orden, en la misma escritura que cambia el estado,
con el actor que deshizo y el enlace a la gestión anulada.

**R21.** El sistema NO DEBE escribir el estado de la orden fuera del choke point del
historial (feature 49): toda transición producida por el deshacer pasa por él.

**R22.** CUANDO se deshace una gestión, la anulación, el cambio de estado, la reasignación
del mensajero y el registro del historial DEBEN aplicarse de forma atómica: si cualquiera
falla, ninguno queda aplicado.

**R23.** El sistema NO DEBE modificar ni borrar ninguna fila preexistente del historial de
estados al deshacer una gestión (el historial sigue siendo append-only e inmutable).

### Contador de intentos derivado (features 47/49) — hallazgo crítico

**R24.** CUANDO el sistema deriva el número de intentos de entrega de una orden (conteo de
transiciones cuyo destino es `devuelta`), DEBE excluir las transiciones causadas por
gestiones anuladas.

**R25.** CUANDO el sistema deriva el número de intentos de entrega de una orden, DEBE seguir
contando las transiciones a `devuelta` que NO fueron originadas por una gestión (p. ej. un
ajuste administrativo de estado), porque esas no son anulables por esta feature.

**R26.** SI una transición a `devuelta` declara haber sido originada por una gestión pero su
enlace a la gestión está vacío (fila huérfana: la gestión ya no existe), ENTONCES el sistema
NO DEBE contarla como intento vigente.

**R27.** CUANDO un mensajero deshace una gestión `devuelta` errónea y vuelve a gestionar la
misma orden, el intento anulado NO DEBE contar para la decisión de reintento vs. escalado a
`rechazada` (umbral configurable, feature 47).

**R28.** El sistema DEBE exponer el conteo de intentos ya corregido (sin los anulados) en la
línea de tiempo de la orden (feature 47/R15), de modo que "intento X de N" coincida con el
que usa la regla de escalado.

### Puntero de orden en gestión (feature 36/R19-R21)

**R29.** CUANDO se deshace una gestión, el sistema NO DEBE modificar el puntero
`usuario.orden_en_gestion_id` del mensajero.

**R30.** SI el mensajero ya tiene OTRA orden activa en gestión, ENTONCES deshacer una
gestión DEBE completarse igualmente (el puntero 1-a-1 no bloquea el deshacer).

**R31.** CUANDO una orden vuelve a `en_reparto` por un deshacer, el mensajero DEBE poder
escogerla para gestión con el flujo existente (feature 36), sujeto a la guardia 1-a-1 ya
vigente.

### Evidencia (bucket privado)

**R32.** CUANDO se deshace una gestión con evidencia, el sistema NO DEBE borrar el objeto
del bucket privado ni la referencia almacenada en la gestión anulada.

**R33.** El sistema NO DEBE exponer la referencia cruda de la evidencia: sigue mostrándose
solo mediante URL firmada de TTL acotado.

### Dinero

**R34.** CUANDO se deshace una gestión `entregada` con monto recibido, el sistema NO DEBE
producir ningún movimiento en la wallet de Ordenex, en el libro de la tienda ni en el libro
de pago al mensajero (el dinero solo se asienta al aprobar el cierre).

### Interfaz (módulo "Cierre del día")

**R35.** DONDE el usuario sea el mensajero dueño de la gestión, el módulo "Cierre del día"
DEBE ofrecer una acción de "Devolver a gestión" por fila, en las 4 tablas.

**R36.** CUANDO el usuario activa "Devolver a gestión", el sistema DEBE pedir una
confirmación explícita antes de ejecutar la operación.

**R37.** CUANDO el deshacer termina con éxito, la vista DEBE reflejar el nuevo estado del
servidor: la fila desaparece de su tabla y los totales se recalculan sin ella.

**R38.** SI el deshacer falla (conflicto, prohibido o error), ENTONCES la vista DEBE mostrar
un mensaje accionable y NO DEBE alterar la tabla ni los totales.

---

## Trazabilidad

Cada `R<n>` se mapea a un test concreto en la tabla R→test de `tasks.md`. El reviewer
rechaza si falta alguno.

---

## Preguntas abiertas para aprobación humana (puerta F1.4)

> Cada pregunta lleva **mi recomendación y su porqué**. El humano decide; marcar la
> elegida al aprobar. La ventana (cierre_id IS NULL) y el rastro (anular, no borrar) YA
> están decididos y no se re-preguntan.

**(a) Contador de intentos derivado — la más importante.**
El conteo de la 47 sale de `contarPorDestino(ordenId, devueltaId)`, que cuenta filas de
`orden_historial_estado` con destino `devuelta`. Si una gestión `devuelta` errónea se
deshace, ese intento seguiría contando y a los 3 la orden escala sola a `rechazada`
(dinero: `cobroRechazado` de la 56).
**Recomendación: filtrar en la LECTURA, no tocar el historial** — pero **discriminando por
`origen_tipo`, NO por la nulidad del enlace**:

```
destino = devuelta AND (
  (gestion_orden_id IS NULL AND origen_tipo NOT IN ('gestion','deshacer_gestion'))  -- nunca vino de una gestion -> CUENTA (R25)
  OR gestion.anulada_at IS NULL                                                      -- vino de una gestion VIGENTE -> CUENTA
)
```

**Porqué:** (1) no modifica ni borra una sola fila del historial → la inmutabilidad de la 49
queda intacta (R23); (2) es UN predicado explícito, no una heurística; (3) las transiciones
sin gestión (`ajuste_estado`) siguen contando (R25); (4) usa el índice
`(orden_id, estatus_destino_id)` ya existente + PK de `gestion_orden`.
**Por qué NO alcanza el predicado ingenuo `gestion_orden_id IS NULL OR gestion.anulada_at IS NULL`:**
`gestion_orden_id IS NULL` es **ambiguo** — significa a la vez "esta transición nunca vino de
una gestión" (debe contar) y "la gestión se borró y la FK `ON DELETE SET NULL` vació el
enlace en silencio" (no debe contar). Como la FK **ya no es `RESTRICT`** (ver Contexto), un
DELETE sobre una gestión anulada devolvería su intento al conteo y **resucitaría exactamente
el bug que esta feature mata**. El `origen_tipo` desambigua: una fila `origen_tipo='gestion'`
SIEMPRE nace con `gestion_orden_id` poblado, así que `origen_tipo='gestion' AND gestion_orden_id IS NULL`
solo puede ser una huérfana (R26).
**Dirección del "si no se sabe":** una huérfana NO cuenta. El umbral es un **mínimo legal**
de intentos: contar de menos = más intentos que el mínimo (inofensivo); contar de más =
escalar antes de tiempo = incumplir el mínimo legal **y** cobrar `cobroRechazado` mal.
Alternativas descartadas (ver `design.md` §7): columna materializada `intentos` en `orden`
que se decrementa, y fila "de reversa" en el historial que se resta.
**Ligada a (i)**, que decide si además se defiende el enlace en el esquema.

**(b) Estado destino al deshacer y registro de la transición.**
**Recomendación: `en_reparto`**, porque es el ÚNICO origen válido de `gestionar`
(`ORIGEN_GESTION`, guardia `cargarOrdenGestionable`): cualquier otro destino deja la orden
sin poder re-gestionarse. La transición se registra con `appendCambioEstado` en la MISMA tx
(R20/R21), origen = estado actual real de la orden, destino = `en_reparto`, actor = quien
deshace, `gestion_orden_id` = la gestión anulada.
**Sub-decisión: `origen_tipo`.** Recomiendo **añadir el valor `deshacer_gestion`** al enum
`orden_historial_origen_tipo` (12º valor; hay precedente reversible en
`20260712150000_cierre_estado_vencido`). **Porqué:** el propósito de la feature es el
rastro; reusar `gestion` (como hizo la 47 con el seguimiento) haría que la línea de tiempo
muestre "en_bodega → en_reparto, origen: gestion", indistinguible de una gestión real.
Alternativa más barata (sin migración de enum): reusar `gestion`. ¿Se acepta el coste del
`ALTER TYPE` a cambio de una auditoría legible?

**(c) Puntero `usuario.orden_en_gestion_id`.**
**Recomendación: NO reponerlo (R28).** El deshacer solo devuelve la orden a `en_reparto`;
el mensajero la vuelve a tomar con "Escoger para gestión" (`escogerParaGestion`), que ya
tiene la guardia 1-a-1 idempotente y concurrencia-segura.
**Porqué:** reponerlo obligaría a decidir qué hacer cuando el mensajero YA tiene otra orden
activa: o se bloquea el deshacer (no puede corregir su error hasta terminar la otra: mala
UX y castiga justo el caso de error) o se pisa el puntero (rompe la invariante 1-a-1 de la
36/R19-R21). No tocarlo elimina el dilema y no añade TOCTOU. Consecuencia aceptada: el
mensajero da un clic extra ("Escoger para gestión") antes de re-gestionar.

**(d) Mecanismo de anulación y exclusión.**
**Recomendación: dos columnas nullable en `gestion_orden`** — `anulada_at TIMESTAMP(3)` y
`anulada_por TEXT` (FK → `usuario`, `ON DELETE SET NULL`, patrón `cierre_dia.resuelto_por`
de la 38) — con migración aditiva + `down.sql` + índice PARCIAL
`(mensajero_id) WHERE cierre_id IS NULL AND anulada_at IS NULL` (ruta caliente de
`/cierre-dia` y del cron; Prisma no expresa índices parciales → SQL a mano, patrón
`orden_liberada_reprogramada_at_idx`). Sin tabla nueva → sin RLS nueva (`gestion_orden` ya
tiene RLS habilitada sin policies).
**Exclusión (verificada contra el código, es más que "los 4 grupos"):** basta añadir
`anuladaAt: null` a **tres** WHERE para cubrir grupos, totales y derivadores 39/56:
1. `CierreDiaRepository.findGestionesPendientes` → cubre los 4 grupos (R13), `computeTotales`
   (R14), `derivarPagos`/`derivarIngresoBodega` (R15) **y** el snapshot de `solicitarCierre`
   y del corte diario, porque todos consumen esta misma lista.
2. `CierreDiaRepository.crearCierre` → el `updateMany({ where: { mensajeroId, cierreId: null } })`
   que **vincula** al cierre (R16). **Sin este, una gestión anulada recibiría `cierre_id` y
   la wallet la cobraría al aprobar: es el punto más peligroso de la feature.**
3. `CorteDiarioRepository.findMensajerosConActividadSinCierre` (R17).
¿Se aprueban las dos columnas + el índice parcial?

**(e) Evidencia en el bucket privado (`gestion-evidencias`).**
**Recomendación: CONSERVARLA** (R31): ni se borra el objeto ni se limpia
`evidencia_storage_path` de la fila anulada.
**Porqué:** el rastro es el punto de la feature — una anulación abusiva ("marqué entregada,
la deshago y me quedo con el efectivo") se investiga justamente con esa foto; borrar es
irreversible; la fila anulada no se lista, así que la evidencia no "ensucia" ninguna vista;
y re-gestionar sube un objeto NUEVO (`${ordenId}/${resultado}-${Date.now()}.ext`), así que
no hay colisión de paths ni basura ambigua. Coste: objetos huérfanos en el bucket (aceptable;
una limpieza por retención sería otra feature).

**(f) Quién puede deshacer.**
**Recomendación v1: SOLO el propio mensajero, dueño de la gestión** (R8/R9).
**Porqué:** la ventana muere al solicitar el cierre (decisión 1 del humano) y el admin
recién ve el cierre a partir de ese momento (feature 38) → **el admin no tiene ventana en la
que deshacer**; darle el botón sería código muerto o, peor, una puerta para tocar dinero ya
snapshoteado. Además `/cierre-dia` es un módulo exclusivo del rol `mensajero` (`notFound()`
server-side para el resto). Si el humano quiere corrección administrativa, el camino
correcto es rechazar el cierre (38) y que el mensajero rehaga, o una feature aparte con su
propia superficie y auditoría. ¿Se confirma "solo el mensajero" en v1?

**(g) Dinero de una `entregada` que se deshace.**
**Confirmado contra el código: NO hay impacto en wallet.** Los tres feeds
(`WalletFeedService`, `WalletTiendaFeedService`, `WalletMensajeroFeedService`) leen
`gestionOrden.findMany({ where: { cierreId } })` **dentro de la tx de aprobación**
(`CierresAdminRepository:168-180`); una gestión con `cierre_id = NULL` nunca los alcanza. El
efectivo sigue físicamente con el mensajero y `cierre_dia.total_*` solo se congela al
solicitar. **Condición para que siga siendo cierto: el punto (d)-2** — si una gestión anulada
llegara a recibir `cierre_id`, la wallet la cobraría. Por eso R16 es requisito duro y no una
optimización. ¿Se confirma que no se requiere ningún asiento compensatorio? (Mi recomendación:
ninguno.)

**(h) Guardia de "la orden no se movió" — ¿se acepta el conflicto?**
Deshacer una `devuelta` con reintento significa arrancar la orden de `en_bodega` y
devolverla a `en_reparto` con su mensajero. Si la bodega ya la tocó (la reasignó, la ruteó,
la recibió, o el cron liberó una `reprogramada`, o se devolvió a la tienda de origen), el
deshacer es peligroso.
**Recomendación: bloquear con `conflict` (R4/R5)** exigiendo dos cosas: que la gestión sea
la más reciente no anulada de la orden **y** que el estado actual de la orden siga siendo el
que dejó esa gestión. **Porqué:** ambas guardias son baratas y cierran los casos reales
(bodega/cron/admin). El mensajero verá "esta orden ya fue procesada por la bodega; ya no se
puede deshacer" — que es la respuesta correcta, no una limitación. ¿Se acepta ese mensaje/UX?

**(i) ¿Devolver la FK `orden_historial_estado.gestion_orden_id` a `ON DELETE RESTRICT`?**
(Pregunta NUEVA, abierta por un error mío: en la primera versión de este spec afirmé que esa
FK era `RESTRICT` y que por eso el DELETE de una gestión era imposible. **Es falso**: la
migración `20260714123909` la dejó en `ON DELETE SET NULL` — ver Contexto. La decisión del
humano de anular y no borrar sigue siendo la correcta, pero se sostiene en el diseño
append-only de la 49 y en la trazabilidad, **no** en una garantía del esquema que hoy no
existe.)
**Recomendación: SÍ, volver a `RESTRICT`, pero como decisión explícita del humano y bien
hecha** — o sea declarándolo en el modelo (`@relation(..., onDelete: Restrict)`) **y** en una
migración con su `down.sql`, no solo en SQL.
**Porqué SÍ:** (1) defensa en profundidad — `gestion_orden_id` es el enlace que sostiene el
contador de intentos, que dispara `rechazada` → `cobroRechazado` (dinero); un `SET NULL`
silencioso corrompe la derivación sin dejar error; (2) hoy **nada borra gestiones**, así que
`RESTRICT` no rompe ningún flujo vivo; (3) alinea el esquema con la intención original de la
49 (la 49 lo escribió `RESTRICT` a mano).
**Porqué podría ser NO:** (1) la `20260714123909` puso `SET NULL` **a propósito**, para
eliminar el drift entre el SQL y `schema.prisma`; revertir solo el SQL **reintroduce ese
drift** y el próximo reconcile lo volvería a pisar en silencio → por eso, si se hace, hay que
tocar el modelo Prisma; (2) es alcance que no pertenece a esta feature y toca una FK que
comparten otras 4 del mismo lote (¿se revisan todas o solo esta?); (3) con el predicado de
(a), la feature es correcta **igual**, con FK o sin ella.
**Neto:** el predicado de (a) es **obligatorio** (única defensa que no depende de nadie);
esta pregunta decide si además se blinda el esquema. Si el humano dice que no, el spec queda
igualmente correcto y el riesgo queda documentado en `design.md` §8.
