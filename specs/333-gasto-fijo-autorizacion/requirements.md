# Ficha 333 — El gasto fijo se cobra con autorización, aviso y recordatorio

> **Hoy el cron escribe el egreso del gasto fijo DIRECTO en el libro y nadie lo autoriza.** Pasa a
> crear un **cobro PENDIENTE** que el maestro aprueba o rechaza, con **interruptor por plantilla**
> («cobra sola» / «requiere aprobación»), **aviso por la campana** y **recordatorio diario** mientras
> siga pendiente.
>
> **El momento es barato y está MEDIDO (2026-08-29):** producción tiene **CERO** movimientos
> `egreso_gasto_fijo` emitidos jamás y las **2** plantillas existentes están **inactivas**. No hay ni
> un dato que migrar. Ese es el argumento de por qué esto se hace ahora y no después.
>
> **Fuentes leídas para escribir esto (ninguna heredada, todas confirmadas en el archivo real):**
> `lib/services/GeneracionGastosFijosService.ts`, `lib/utils/periodicidad.ts`,
> `app/api/cron/generar-gastos-fijos/route.ts`, `vercel.json`,
> `lib/services/GastoFijoPlantillaService.ts`, `lib/repositories/GastoFijoPlantillaRepository.ts`,
> `lib/actions/gasto-fijo-plantilla.ts`, `lib/types/gasto-fijo-plantilla.ts`,
> `lib/services/WalletEgresoService.ts`, `lib/actions/wallet-egresos.ts`,
> `lib/repositories/WalletMovimientoRepository.ts`, `lib/auth/acceso-total.ts`,
> `lib/types/notificacion.ts`, `lib/notificaciones/emitir.ts`,
> `lib/notificaciones/notificadores.ts`, `lib/repositories/NotificacionRepository.ts`,
> `app/api/cron/corte-diario/route.ts`, `app/(app)/wallet/page.tsx`,
> `app/(app)/wallet/_components/WalletModule.tsx`,
> `app/(app)/wallet/_components/GastosFijosPlantillasPanel.tsx`, `db/schema.prisma`,
> `db/migrations/20260712160000_wallet_movimiento/migration.sql`,
> `db/migrations/20260713150000_gasto_fijo_plantilla/migration.sql`,
> `db/migrations/20260727120000_notificacion/migration.sql`,
> `db/migrations/20260822130000_orden_dia_reparto_cambio/migration.sql`,
> `db/migrations/20260823120000_notificacion_evento_bloqueo_cierre/{migration,down}.sql`,
> `tests/unit/services/notificacion-productores-wiring.test.ts`,
> `tests/unit/services/notificacion-notificadores-reales.test.ts`,
> `tests/unit/descarga/censo-tablas.ts`, `tests/unit/descarga/contadores-cabecera.guardia.test.ts`,
> `tests/integration/db/_postgres-real.ts`, `docs/verification.md`,
> **`specs/332-eliminar-plantilla-gasto-fijo/{requirements,design}.md`** (ya escrito: su **R25/R26** y
> su §5 fijan el reparto de responsabilidad de la cascada, y esta ficha lo cumple al pie de la letra).

---

## Vocabulario

| Término | Qué significa aquí |
| --- | --- |
| **plantilla** | Fila de `gasto_fijo_plantilla`: configuración recurrente (concepto, monto, periodicidad, ancla). Mutable; hoy no se borra (la 332 añadirá el borrado). |
| **el cron** | `GET /api/cron/generar-gastos-fijos`, agendado en `vercel.json` como `0 6 * * *` — que es **06:00 UTC = 00:00 de Costa Rica**, o sea el arranque del día CR. Autoriza por `CRON_SECRET`. |
| **aplica hoy** | Que la plantilla dispara en el día calendario CR de la corrida, según `aplicaHoy` de `lib/utils/periodicidad.ts`. |
| **período** | La cadena que devuelve `periodoDe`: `YYYY-MM` para `meses`, `YYYY-MM-DD` para `dias`/`semanas`. |
| **la clave del libro** | `origen_id = "<plantillaId>:<periodo>"`, bajo el índice único parcial **`wallet_movimiento_origen_categoria_uq`** `(origen_tipo, origen_id, categoria) WHERE origen_id IS NOT NULL`. Es lo que hoy impide el doble cobro. |
| **cobro** | Fila nueva de esta ficha: la intención de cobrar un período de una plantilla. Nace `pendiente`; termina `aprobado`, `rechazado` o `cancelado`. |
| **cobra sola** | Plantilla cuyo cobro se escribe directo en el libro, exactamente como hoy. |
| **requiere aprobación** | Plantilla cuyo cobro nace como cobro `pendiente` y no toca el libro hasta que alguien lo apruebe. |
| **acceso total** | `maestro` + `admin`, el guard `esAccesoTotal` de `lib/auth/acceso-total.ts` (paridad de la ficha 94). |
| **la campana** | El indicador de avisos de la feature 146: tabla `notificacion` + `notificacion_lectura`. |
| **día CR** | Fecha calendario de `America/Costa_Rica` (UTC-6 fijo), `lib/utils/fecha-cr.ts`. |

### Precisiones verificadas en el código, no supuestas

1. **La idempotencia del gasto fijo es la clave del libro, y tocar su FORMATO duplica plata.** Está
   escrito por triplicado (`periodoDe`, la cabecera de `GeneracionGastosFijosService`, el comentario
   de `GastoFijoPlantilla` en `db/schema.prisma`): si a las mensuales se les cambiara `YYYY-MM`, en
   el mes del deploy la clave vieja y la nueva **no colisionarían** y se cobraría dos veces. Esta
   ficha **no cambia el formato**: ver **R11**, **R16** y `design.md` §2.
2. **`notificacion_dedupe_key` es UNIQUE `(evento, entidad_id, destinatario_rol,
   destinatario_usuario_id)` con `NULLS NOT DISTINCT` y `WHERE entidad_id IS NOT NULL`,** y
   `NotificacionRepository.crear` **absorbe el `P2002` devolviendo `false`**. Con una entidad que no
   cambie entre días, el segundo aviso **no sale nunca, en silencio** — es el error que la 262
   documentó y evitó eligiendo como entidad el CAMBIO y no la orden. Ver **R29** y `design.md` §4.
3. **El enum `NotificacionEvento` tiene HOY OCHO valores vivos** (`orden_rechazada`,
   `carga_masiva_terminada`, `postulacion_mensajero_pendiente`, `cierre_dia_por_aprobar`,
   `postulacion_recurso_pendiente`, `dia_reparto_corregido`, `cierre_dia_vencido`,
   `mensajero_bloqueado_por_cierres`) y **ninguno es de wallet**. La ficha decía «7»: contado en
   `db/schema.prisma` y en `lib/types/notificacion.ts`, son ocho. La lista **literal** que hay que
   actualizar vive en `tests/unit/services/notificacion-productores-wiring.test.ts` (su título dice
   «exactamente seis» y está caduco; lo que afirma es la lista).
4. **Los notificadores reales se inyectan en el composition root, no por defecto.** El default del
   constructor es el no-op (`notificadorNoOp`), y el precedente medido está escrito en
   `app/api/cron/corte-diario/route.ts`: **el aviso de cierre vencido no se emitió nunca** porque la
   llamada pasaba cinco argumentos y el notificador se quedaba con su default, **con la suite en
   verde**. Ver **R33** y **R34**.
5. **`esAccesoTotal` = `maestro` + `admin`** y lo usan **todos** los métodos de
   `GastoFijoPlantillaService` y **todos** los de `WalletEgresoService` —además de una veintena larga
   de servicios y páginas del resto del árbol—. Aprobar un cobro es la **primera excepción
   deliberada** a esa paridad. Ver sección **E**.
6. **El único control que existe hoy es anular DESPUÉS:** `reversarEgresoAdministrativoAction` emite
   un `ingreso_ajuste` compensatorio contra el egreso original. Sigue existiendo y esta ficha no lo
   toca. Ver **R47**.
7. **`WalletModule` monta `<Pagination>`**, así que cualquier componente de tabla que importe entra
   en el alcance de `contadores-cabecera.guardia`: un `({X.length})` en la sección nueva pondría rojo
   el árbol. Ver **R41**.

---

## A · El interruptor vive en la plantilla

**R1.** El sistema DEBE guardar en cada plantilla de gasto fijo un interruptor de exactamente dos
valores: **cobra sola** o **requiere aprobación**.

**R2.** CUANDO se cree una plantilla sin indicar el interruptor, el sistema DEBE dejarla en
**requiere aprobación**.

**R3.** El sistema DEBE permitir a los roles de **acceso total** leer y cambiar el interruptor de una
plantilla; SI el actor no tiene acceso total, ENTONCES el sistema DEBE responder `forbidden` sin
tocar la plantilla.

**R4.** El sistema DEBE mostrar el valor del interruptor en la tabla de plantillas de `/wallet` y DEBE
permitir fijarlo desde el diálogo de crear/editar plantilla.

---

## B · La corrida diaria

**R5.** CUANDO el cron corra y una plantilla **activa** que **aplica hoy** esté en **cobra sola**, el
sistema DEBE escribir su egreso en el libro con el **mismo** tipo (`egreso`), la **misma** categoría
(`egreso_gasto_fijo`), el **mismo** `origen_tipo` (`gasto`), la **misma** clave del libro y el
**mismo** autor (`registrado_por = NULL`) que antes de esta ficha.

**R6.** CUANDO el cron corra y una plantilla **activa** que **aplica hoy** esté en **requiere
aprobación**, el sistema DEBE crear un **cobro** en estado `pendiente` y NO DEBE escribir ningún
movimiento en el libro por esa plantilla.

**R7.** El sistema DEBE guardar en el cobro una **copia** del concepto y del monto que la plantilla
tenía en el instante en que el cobro se creó.

**R8.** El sistema DEBE guardar en el cobro **la clave del libro** que le corresponde
(`"<plantillaId>:<periodo>"`), resuelta **una sola vez** en el momento de crearlo.

**R9.** CUANDO el cron se re-ejecute el **mismo día CR**, el sistema NO DEBE crear un segundo cobro
ni un segundo egreso para la misma (plantilla, período), y la corrida DEBE terminar en éxito.

**R10.** El sistema DEBE escribir los egresos automáticos y los cobros pendientes de una **misma
corrida** dentro de **una sola transacción**: o quedan las dos colecciones, o no queda ninguna.

**R11.** El sistema DEBE derivar el período con la **misma** función y el **mismo formato** que hoy
(`YYYY-MM` para `meses`, `YYYY-MM-DD` para `dias`/`semanas`); NO DEBE introducir un segundo formato
de período ni una segunda forma de componer la clave del libro.

**R12.** MIENTRAS una plantilla esté **inactiva**, el sistema NO DEBE generar por ella ni egreso ni
cobro, sea cual sea su interruptor.

**R13.** La respuesta del cron DEBE llevar **solo conteos y la fecha CR** de la corrida —incluidos
los cobros pendientes creados y los pendientes que quedan— y NO DEBE llevar montos, conceptos,
identificadores de persona ni el secreto.

---

## C · Aprobar

**R14.** CUANDO el maestro apruebe un cobro `pendiente`, el sistema DEBE escribir en el libro **un**
movimiento `egreso` / `egreso_gasto_fijo` por el **monto copiado en el cobro**, con `origen_tipo =
gasto`, `origen_id` = la clave guardada en el cobro y `registrado_por` = el usuario que aprobó.

**R15.** CUANDO el maestro apruebe, el sistema DEBE dejar el cobro en `aprobado` con **quién** y
**cuándo**, y **enlazado** al movimiento resultante; la escritura del libro y el cambio de estado
DEBEN ocurrir **ambos o ninguno**.

**R16.** El sistema DEBE cobrar **exactamente** el monto copiado en el cobro, aunque la plantilla haya
cambiado de monto entre la generación y la aprobación.

**R17.** SI el cobro ya no está en `pendiente` cuando llega la aprobación, ENTONCES el sistema NO
DEBE escribir nada en el libro y DEBE responder que **ya fue decidido**.

**R18.** CUANDO dos aprobaciones del **mismo** cobro lleguen a la vez, el sistema DEBE dejar como
máximo **un** movimiento en el libro y **una** decisión registrada.

**R19.** SI el libro ya contiene un movimiento con la clave del cobro, ENTONCES el sistema NO DEBE
crear un segundo, DEBE dejar el cobro `aprobado` enlazado a **ese** movimiento y DEBE informar de que
**ya estaba en el libro** (no de que acaba de cobrarse).

**R20.** SI el cobro no existe, ENTONCES el sistema DEBE responder `not_found` sin escribir nada.

---

## D · Rechazar

**R21.** CUANDO el maestro rechace un cobro `pendiente`, el sistema DEBE dejarlo en `rechazado` con
**quién** y **cuándo**, y NO DEBE escribir ningún movimiento en el libro.

**R22.** MIENTRAS exista un cobro `rechazado` para una (plantilla, período), el sistema NO DEBE volver
a crear un cobro `pendiente` para esa misma (plantilla, período), aunque el cron vuelva a correr.

**R23.** El sistema NO DEBE permitir editar ni reabrir un cobro ya decidido: una decisión tomada es
final para ese período.

---

## E · Quién decide (excepción DELIBERADA a la paridad de la ficha 94)

**R24.** SI el actor no es `maestro`, ENTONCES el sistema DEBE responder `forbidden` a aprobar y a
rechazar, **incluso si tiene acceso total**; en particular, el rol `admin` NO DEBE poder aprobar ni
rechazar.

**R25.** El sistema DEBE permitir a los roles de **acceso total** (`maestro` y `admin`) **ver** la
lista de cobros pendientes.

**R26.** SI no hay sesión, ENTONCES el sistema DEBE responder `unauthenticated` antes de tocar
ningún servicio, en las tres operaciones (ver, aprobar, rechazar).

**R27.** El sistema DEBE expresar «quién puede decidir un cobro» en **un único predicado con nombre
propio**, distinto de `esAccesoTotal`; y el camino de aprobar/rechazar NO DEBE autorizar con
`esAccesoTotal`.

**R28.** El sistema NO DEBE cambiar la autorización de ninguna otra operación de wallet ni del CRUD
de plantillas: las que hoy autoriza `esAccesoTotal` DEBEN seguir autorizándose igual.

---

## F · El aviso y el recordatorio

**R29.** CUANDO termine una corrida del cron y quede **al menos un** cobro `pendiente`, el sistema
DEBE emitir un aviso en la campana que diga **cuántos** cobros esperan decisión.

**R30.** MIENTRAS haya cobros pendientes, el sistema DEBE emitir ese aviso **una vez por día CR**,
también los días en que **no** se generó ningún cobro nuevo, y **sin** que el aviso del día anterior
tenga que haberse leído.

**R31.** CUANDO la corrida del **mismo día CR** se repita, el sistema NO DEBE emitir un segundo aviso
de ese día.

**R32.** SI no queda ningún cobro `pendiente`, ENTONCES el sistema NO DEBE emitir aviso alguno.

**R33.** SI la emisión del aviso falla, ENTONCES la corrida DEBE terminar en éxito igualmente, los
cobros y egresos ya escritos DEBEN permanecer, y el fallo DEBE quedar **registrado con contexto**
(nunca tragado en silencio).

**R34.** El composition root del cron DEBE **inyectar** el notificador real; el default del servicio
DEBE seguir siendo el no-op, y el sistema DEBE hacer **fallar una comprobación** si ese cableado
desaparece —comprobación que NO DEBE poder satisfacerse con la sola presencia del `import`.

**R35.** El aviso NO DEBE contener monto, concepto, nombre de persona ni ningún otro dato más allá del
**número** de cobros que esperan.

**R36.** MIENTRAS el aviso exista, el inventario de eventos de la campana DEBE seguir siendo
**cerrado y enumerado literalmente**: el valor nuevo DEBE estar declarado en el esquema Prisma, en el
tipo de dominio y en la comprobación que los enumera, y esa comprobación NO DEBE relajarse a una
derivación del propio esquema.

---

## G · La sección de pendientes en `/wallet`

**R37.** MIENTRAS haya al menos un cobro `pendiente`, `/wallet` DEBE mostrar una sección de cobros
pendientes que **llame la atención** —título propio y distintivo de aviso— construida con las mismas
primitivas del módulo (`Card` / `CardHeader` / `Badge` / `DataTable`), **sin** introducir un lenguaje
visual nuevo ni alterar la disposición del resto de la página.

**R38.** SI no hay ningún cobro `pendiente`, ENTONCES la sección NO DEBE renderizarse.

**R39.** La sección DEBE mostrar, por cada cobro pendiente: **concepto**, **período**, **monto** y
**fecha en que se generó**; y DEBE ordenarlos del **más antiguo al más reciente**.

**R40.** DONDE el actor sea `maestro`, la sección DEBE ofrecer por fila los controles de **aprobar** y
**rechazar**; DONDE no lo sea, NO DEBE ofrecerlos.

**R41.** El número de cobros pendientes que enseña la sección DEBE ser el que devuelve el **servidor**,
no el largo del array pintado.

**R42.** CUANDO se apruebe o se rechace desde la sección, la pantalla DEBE refrescar la sección **y**
las cifras de la caja sin recarga manual, y DEBE informar del resultado con un aviso legible.

**R43.** Los montos DEBEN viajar del servidor al cliente y renderizarse **como cadena** con dos
decimales; el sistema NO DEBE convertirlos a número en ningún punto del camino.

**R44.** El sistema DEBE entregar los cobros pendientes **pre-obtenidos en el servidor** y pasarlos por
props al módulo cliente; la pantalla NO DEBE pedirlos al navegador sin pasar por la autorización de la
página.

---

## H · Ciclo de vida frente a la plantilla

**R45.** CUANDO se borre una plantilla, el sistema DEBE **cancelar** sus cobros `pendiente` **en la
misma operación atómica** que la borra: o se cancelan y desaparece la plantilla, o no ocurre ninguna
de las dos cosas.

**R46.** El sistema NO DEBE permitir que una plantilla desaparezca dejando cobros en `pendiente`: SI
alguien lo intenta sin cancelarlos, ENTONCES la operación DEBE fallar **ruidosamente**.

**R47.** CUANDO se borre una plantilla, los cobros ya `aprobado` o `rechazado` DEBEN conservarse con su
concepto, monto, período y decisión; y los movimientos ya escritos en el libro DEBEN permanecer
intactos y seguir siendo reversables por el camino que ya existe.

**R48.** MIENTRAS una plantilla esté **desactivada**, sus cobros ya `pendiente` DEBEN seguir
`pendiente`: desactivar detiene la generación futura y NO cancela lo ya generado.

**R49.** Un cobro `cancelado` NO DEBE producir movimiento alguno ni volver a aparecer en la sección de
pendientes.

---

## I · Datos y migración

**R50.** La tabla de cobros DEBE nacer con **RLS habilitada**.

**R51.** El sistema DEBE impedir **en la base** —no sólo en el servicio— que existan dos cobros con la
misma clave del libro.

**R52.** El sistema DEBE impedir **en la base** que un cobro guarde un monto menor o igual que cero, y
DEBE almacenarlo con la misma precisión que el libro.

**R53.** La migración DEBE ser **aditiva** (no altera ninguna tabla, columna ni índice preexistente
salvo la columna nueva del interruptor) y DEBE traer su `down.sql`; el `down.sql` del enum de eventos
DEBE recrear el tipo con **la lista previa exacta**, y NO DEBE modificarse ningún `down.sql` de una
migración anterior.

**R54.** SI al revertir quedan filas que usan el valor nuevo del enum de eventos, ENTONCES el
`down.sql` DEBE fallar **ruidosamente** y NO DEBE borrar ni reescribir ninguna fila para «hacer
sitio».

---

## J · Sutura con la ficha 332 (su **R26**, que es propiedad de ésta)

La 332 ya está escrita y **declara** el contrato sin implementarlo (`specs/332-…/design.md §5`): la
tabla de pendientes, la cancelación en cascada y **el número de la confirmación** son de esta ficha.

**R55.** ANTES de que el usuario acepte el borrado de una plantilla, el sistema DEBE decirle
**cuántos** cobros pendientes se van a cancelar, con el número delante («se cancelarán 2 cobros
pendientes»); y ese número DEBE leerse **en el momento de pedir la confirmación**, no de un listado
cargado antes.

**R56.** SI entre el aviso y la ejecución el número cambió —alguien aprobó, rechazó o el cron generó
otro—, ENTONCES el borrado DEBE seguir adelante cancelando los que sigan `pendiente` en ese instante,
y el resultado DEBE informar del número **realmente** cancelado.

**R57.** MIENTRAS exista en el árbol una operación que borre plantillas, ésta DEBE cancelar los cobros
pendientes dentro de su misma transacción; el sistema DEBE hacer **fallar una comprobación** si esa
operación existe sin esa llamada.

> **R55 y R56 son CONDICIONALES a que la 332 esté mergeada.** Si al implementar esta ficha no existe
> todavía ninguna operación de borrado, sus tests **no se pueden escribir contra nada**: entonces se
> declaran **no aplicables en voz alta** en `progress/impl_333.md` —nunca «passed» por vacío, que es el
> modo de fallo que este repo ya tiene medido— y su prueba de comportamiento viaja con la 332, que es
> quien traerá la operación. **R45, R46 y R57 se prueban siempre**: el primero contra el método del
> repositorio, el segundo contra la base y el tercero por su forma condicional.

---

## Trazabilidad `R<n>` → test

Los tests de servicio con dobles **no ven el SQL**: por eso todo requisito que dependa de un `WHERE`,
de un índice único, de un `CHECK` o de una transacción se prueba **donde vive**, contra Postgres
(`tests/integration/db/**`, envueltos en `HAY_BASE_DE_DATOS`).

| R | Test que lo cubre | Dónde |
| --- | --- | --- |
| R1 | `guarda el interruptor con los dos valores` | `tests/unit/services/gasto-fijo-plantilla-service.test.ts` |
| R2 | `una plantilla creada sin interruptor queda en requiere aprobación` | `tests/unit/types/gasto-fijo-plantilla-schema.test.ts` |
| R3 | `un rol sin acceso total no puede cambiar el interruptor` | `tests/unit/services/gasto-fijo-plantilla-service.test.ts` |
| R4 | `la tabla de plantillas enseña el interruptor y el diálogo lo fija` | `tests/unit/components/wallet-gastos-fijos-panel.test.tsx` |
| R5 | `una plantilla que cobra sola escribe el mismo egreso que antes` | `tests/unit/services/generacion-gastos-fijos-service.test.ts` |
| R6 | `una plantilla que requiere aprobación crea el cobro y NO toca el libro` | `tests/unit/services/generacion-gastos-fijos-service.test.ts` |
| R7 | `el cobro copia concepto y monto de la plantilla` | `tests/unit/services/generacion-gastos-fijos-service.test.ts` |
| R8 | `el cobro guarda la clave del libro resuelta una sola vez` | `tests/unit/services/generacion-gastos-fijos-service.test.ts` |
| R9 | `dos corridas del mismo día dejan un cobro y un egreso` | `tests/integration/db/gasto-fijo-cobro-idempotencia.test.ts` |
| R10 | `si la escritura de cobros falla, no queda ningún egreso de la corrida` | `tests/integration/db/gasto-fijo-cobro-idempotencia.test.ts` |
| R11 | `el período sale de periodoDe y el formato no cambia` | `tests/unit/services/generacion-gastos-fijos-service.test.ts` |
| R12 | `una plantilla inactiva no genera ni egreso ni cobro` | `tests/unit/services/generacion-gastos-fijos-service.test.ts` |
| R13 | `el resumen del cron lleva conteos y fecha, sin montos ni PII` | `tests/integration/actions/generar-gastos-fijos-route.test.ts` |
| R14 | `aprobar escribe el egreso con la clave del cobro y el autor que aprobó` | `tests/unit/services/gasto-fijo-cobro-service.test.ts` |
| R15 | `aprobar deja estado, decisor, instante y enlace, o no deja nada` | `tests/integration/db/gasto-fijo-cobro-aprobacion.test.ts` |
| R16 | `aprobar cobra el monto copiado aunque la plantilla haya cambiado` | `tests/unit/services/gasto-fijo-cobro-service.test.ts` |
| R17 | `aprobar un cobro ya decidido no escribe y responde ya_decidido` | `tests/integration/db/gasto-fijo-cobro-aprobacion.test.ts` |
| R18 | `dos aprobaciones simultáneas dejan un solo movimiento` | `tests/integration/db/gasto-fijo-cobro-aprobacion.test.ts` |
| R19 | `si el libro ya tiene la clave, se enlaza y se avisa de que ya estaba` | `tests/integration/db/gasto-fijo-cobro-aprobacion.test.ts` |
| R20 | `aprobar un cobro inexistente responde not_found` | `tests/unit/services/gasto-fijo-cobro-service.test.ts` |
| R21 | `rechazar no escribe movimiento y deja decisor e instante` | `tests/unit/services/gasto-fijo-cobro-service.test.ts` |
| R22 | `un período rechazado no vuelve a generar pendiente` | `tests/integration/db/gasto-fijo-cobro-idempotencia.test.ts` |
| R23 | `un cobro decidido no admite una segunda decisión` | `tests/unit/services/gasto-fijo-cobro-service.test.ts` |
| R24 | `el admin no puede aprobar ni rechazar aunque tenga acceso total` | `tests/unit/services/gasto-fijo-cobro-service.test.ts` |
| R25 | `maestro y admin ven la lista de pendientes` | `tests/unit/services/gasto-fijo-cobro-service.test.ts` |
| R26 | `sin sesión las tres actions responden unauthenticated sin tocar el service` | `tests/unit/actions/gasto-fijo-cobro-actions.test.ts` |
| R27 | `el camino de decisión no autoriza con esAccesoTotal` | `tests/unit/guards/gasto-fijo-decision-rol.guardia.test.ts` |
| R28 | `las demás operaciones de wallet y plantillas siguen autorizando con esAccesoTotal` | `tests/unit/guards/gasto-fijo-decision-rol.guardia.test.ts` |
| R29 | `con pendientes, la corrida emite el aviso con el número` | `tests/unit/notificaciones/gasto-fijo-cobro-aviso.test.ts` |
| R30 | `dos días seguidos con el mismo pendiente producen dos avisos` | `tests/unit/notificaciones/gasto-fijo-cobro-aviso.test.ts` |
| R31 | `dos corridas del mismo día producen un solo aviso` | `tests/integration/db/gasto-fijo-cobro-aviso-dedupe.test.ts` |
| R32 | `sin pendientes no se emite ningún aviso` | `tests/unit/notificaciones/gasto-fijo-cobro-aviso.test.ts` |
| R33 | `un notificador que revienta no tumba la corrida y queda registrado` | `tests/unit/notificaciones/gasto-fijo-cobro-aviso.test.ts` |
| R34 | `la ruta del cron inyecta el notificador real (uso efectivo, sin imports)` | `tests/unit/services/notificacion-notificadores-reales.test.ts` |
| R35 | `el texto del aviso no lleva monto ni concepto ni nombre` | `tests/unit/notificaciones/gasto-fijo-cobro-aviso.test.ts` |
| R36 | `el enum de eventos sigue siendo un inventario cerrado` | `tests/unit/services/notificacion-productores-wiring.test.ts` |
| R37 | `con pendientes, /wallet pinta la sección con Card, Badge y DataTable` | `tests/unit/components/wallet-cobros-pendientes-panel.test.tsx` |
| R38 | `sin pendientes la sección no se renderiza` | `tests/unit/components/wallet-cobros-pendientes-panel.test.tsx` |
| R39 | `la sección muestra concepto, período, monto y fecha, del más antiguo al más reciente` | `tests/unit/components/wallet-cobros-pendientes-panel.test.tsx` |
| R40 | `el admin ve la tabla sin los botones de decisión` | `tests/unit/components/wallet-cobros-pendientes-panel.test.tsx` |
| R41 | `el contador de la cabecera sale del total del servidor` | `tests/unit/descarga/contadores-cabecera.guardia.test.ts` |
| R42 | `aprobar desde la sección refresca la sección y las cifras` | `tests/unit/components/wallet-cobros-pendientes-panel.test.tsx` |
| R43 | `los montos cruzan la frontera como cadena` | `tests/unit/guards/gasto-fijo-cobro-money-safe.guardia.test.ts` |
| R44 | `la página pre-obtiene los pendientes y los pasa por props` | `tests/unit/components/wallet-page-cobros-pendientes.test.tsx` |
| R45 | `borrar una plantilla cancela sus pendientes en la misma transacción` | `tests/unit/services/gasto-fijo-cobro-service.test.ts` |
| R46 | `borrar una plantilla con pendientes vivos falla ruidosamente` | `tests/integration/db/gasto-fijo-cobro-migration.test.ts` |
| R47 | `los cobros decididos y sus movimientos sobreviven al borrado de la plantilla` | `tests/integration/db/gasto-fijo-cobro-migration.test.ts` |
| R48 | `desactivar una plantilla no cancela sus pendientes` | `tests/unit/services/gasto-fijo-plantilla-service.test.ts` |
| R49 | `un cobro cancelado no aparece en pendientes ni produce movimiento` | `tests/unit/services/gasto-fijo-cobro-service.test.ts` |
| R50 | `la tabla nueva tiene RLS habilitada` | `tests/integration/db/gasto-fijo-cobro-migration.test.ts` |
| R51 | `la base rechaza dos cobros con la misma clave del libro` | `tests/integration/db/gasto-fijo-cobro-idempotencia.test.ts` |
| R52 | `la base rechaza un cobro con monto cero o negativo` | `tests/integration/db/gasto-fijo-cobro-migration.test.ts` |
| R53 | `la migración es aditiva, trae down.sql y el down del enum lista los ocho previos` | `tests/integration/db/notificacion-evento-gasto-fijo-migration.test.ts` |
| R54 | `el down del enum falla si quedan filas con el valor nuevo` | `tests/integration/db/notificacion-evento-gasto-fijo-migration.test.ts` |
| R55 | `la confirmación de borrado anuncia cuántos pendientes se cancelarán` | `tests/unit/components/wallet-gastos-fijos-panel.test.tsx` |
| R56 | `si el número cambió, el borrado sigue y reporta el número real` | `tests/unit/services/gasto-fijo-cobro-service.test.ts` |
| R57 | `una operación de borrado sin la cancelación pone rojo el árbol` | `tests/unit/guards/plantilla-gasto-fijo-borrado.guardia.test.ts` |

**Regla de mutación para los tres requisitos de dinero.** R14, R16 y R51 no se dan por cubiertos con
un test verde: el implementador DEBE demostrar que **mueren** ante estas mutaciones concretas
—(a) cambiar el monto escrito por el de la plantilla en vez del copiado; (b) quitar el `WHERE estado
= 'pendiente'` de la transición; (c) borrar el índice único de la tabla de cobros— y dejar la
evidencia en `progress/impl_333.md`.

---

## Límites declarados (fuera de alcance, y por qué)

1. **No hay historial de cobros decididos en pantalla.** La sección enseña la **cola** de pendientes.
   Los aprobados quedan en el libro, que ya se ve y se descarga; los rechazados quedan en la tabla y
   se consultan por base. Una pantalla de histórico es otra ficha.
2. **No se toca la reversa** (`reversarEgresoAdministrativoAction`): un egreso aprobado se anula como
   hasta hoy, con su `ingreso_ajuste` compensatorio.
3. **No se añade un cron nuevo.** El recordatorio va montado en el que ya corre a diario (§ `design.md`
   §5).
4. **No se cambia el formato del período ni la clave del libro.** Ver R11.
5. **La sección no ofrece descarga.** Es una cola de decisión de un puñado de filas; lo que se aprueba
   aterriza en el libro de la caja, que sí descarga. Queda **registrado en el censo** con ese motivo
   (`tests/unit/descarga/censo-tablas.ts`), que es lo que la guardia obliga a decidir.
6. **No se avisa por WhatsApp ni por correo.** Los dos canales de esta ficha son la campana y la
   pantalla, por decisión humana del 2026-08-29.

---

## Preguntas abiertas

Ninguna bloquea la implementación: las cuatro llevan un **valor por defecto ya escrito en los
requisitos**, y cambiarlo en la puerta humana es un cambio de una línea más su test.

1. **¿El aviso de la campana va también al `admin`?** Escrito por defecto: **no**, solo al `maestro`
   (R29), porque el admin **ve** los pendientes pero no puede decidirlos (R24) y un recordatorio
   diario que no se puede atender es ruido. Si el humano prefiere que el admin también lo reciba, se
   añade el destinatario `admin` en el emisor y R29 pasa a nombrar los dos.
2. **¿El interruptor por defecto en las plantillas NUEVAS es «requiere aprobación»?** Escrito por
   defecto: **sí** (R2), porque es lo que la ficha pide como norma y «cobra sola» es la excepción.
   Medido: las 2 plantillas de producción están inactivas y nunca emitieron un movimiento, así que el
   valor de las existentes no cambia el comportamiento de nada hoy.
3. **¿Qué hace un cobro pendiente cuya plantilla se desactiva?** Escrito por defecto: **sigue
   pendiente** (R48). La alternativa sería cancelarlo, y no se eligió porque desactivar es un acto
   sobre el futuro, no sobre lo ya generado.
4. **¿La cola de pendientes tiene tope de filas?** Escrito por defecto: **sí**, el servidor devuelve
   como mucho el tope ya existente de `lib/config/gasto-fijo.ts` y el `total` real aparte (R41), de
   modo que si algún día hubiera más, el número lo dice y la pantalla no miente. Si el humano quiere
   paginarla, es una ficha aparte.

5. **Orden entre la 332 y la 333 — esto lo decide el leader, no el spec.** Las dos tocan
   `app/(app)/wallet/_components/GastosFijosPlantillasPanel.tsx`,
   `app/(app)/wallet/_components/GastoFijoPlantillaDialog.tsx`, `lib/types/gasto-fijo-plantilla.ts`,
   `lib/services/GastoFijoPlantillaService.ts` y `lib/actions/gasto-fijo-plantilla.ts`: hay
   **conflicto de archivos** y **no pueden ir en paralelo** (`AGENTS.md > Paralelismo`). Los dos
   órdenes funcionan y esta ficha está escrita para los dos —**R57** es la comprobación que hace que
   el orden no importe—, pero conviene saber cuál es:
   - **332 primero:** al implementar la 333 hay que **modificar** `eliminarPlantilla` para que cancele
     y cuente; hasta que se haga, y en cuanto exista un pendiente, el borrado **fallará en voz alta**
     por el CHECK (R46). Es el comportamiento buscado, pero es un rojo que hay que esperar.
   - **333 primero:** la 332 nace cableando la cancelación que esta ficha deja lista, y R26 de la 332
     se cumple sin diferido.
