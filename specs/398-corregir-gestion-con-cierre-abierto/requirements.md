# 398 — Corregir una gestión mal declarada con el cierre ya solicitado

> ## ⚠️ ESTA FICHA LLEVA MIGRACIÓN — y son DOS enums, no uno
>
> `db/migrations/<ts>_correccion_resultado_gestion/` añade un valor a
> `orden_historial_origen_tipo` y otro a `historial_accion_tipo`, cada uno con su
> `down.sql` **recrear-con-lista**. Eso cambia cómo se lanza esta ficha: el gate rápido
> (`./init.sh --rapido`) **se niega solo** cuando el diff toca migraciones y manda al completo
> (`CLAUDE.md`, regla 5). Y el `down.sql` de un enum es una **foto del día**: ver T1.4.

## El caso, medido

Un mensajero marcó **`entregada`** una orden que fue **`rechazada`** y ya solicitó el cierre.
Hoy no hay ninguna vía para corregirlo, y esto se comprobó en el árbol real el 2026-09-08:

1. **Anular una gestión exige que no tenga cierre.** `CierreDiaRepository.anularGestionYDevolverAGestion`
   (`lib/repositories/CierreDiaRepository.ts:1185`) escribe con
   `where: { id, mensajeroId, cierreId: null, anuladaAt: null }`. Confirmado además que la
   línea 1186 es el **único** sitio del repo que escribe `anuladaAt` (todo lo demás lo **lee**).
2. **La corrección de admin sobre un cierre abierto toca solo el reparto por método.**
   `CierresAdminRepository.actualizarPagosGestion` (`:1391`) está guardada por
   `resultado: RESULTADO_ENTREGADA` y `estado IN ESTADOS_ABIERTOS = ["solicitado","vencido"]` (`:114`);
   el comentario del `:116` lo dice: *«El unico resultado con desglose que corregir»*. No toca el
   `resultado`.
3. **Reabrir un cierre solo cambia el estado.** `forzarSolicitudVencido` (`:2130`) hace un
   `updateMany` con `data: { estado: 'solicitado' }` y nada más; `ESTADOS_REABRIBLES = ["vencido","rechazado"]` (`:105`).
   Las gestiones conservan su `cierreId`. Y re-solicitar **no vuelve a fotografiar nada**:
   `CierreDiaService.solicitarCierre` rama 2 devuelve `via: "resolicitado"` con el comentario
   `// R20: sin snapshot nuevo` (`lib/services/CierreDiaService.ts:547`).

Es decir: **no existe ninguna vía, ni siquiera indirecta, para sacar del cierre un dinero que
nadie recaudó.** Por eso es dinero: a la tienda se le cobra flete y comisión sobre un cobro
inexistente, `total_general` incluye efectivo que el mensajero no tiene y al consolidar el
efectivo no cubre los pagos.

## Alcance

**DENTRO:** corregir el `resultado` de **una** gestión de `entregada` a `rechazada`, dentro de un
cierre en estado `solicitado` o `vencido`, ejecutado por `admin` o `maestro`.

**FUERA, y se declara para que nadie lo suponga:**

- Cierres `aprobado`, `rechazado` o ya consolidados en un `cierre_bodega`. La restricción a
  `solicitado`/`vencido` cubre por construcción el «no consolidado» —la consolidación solo toma
  `estado = aprobado` (`CierreBodegaRepository.ts:175-178` y `:376-378`)— pero eso es un
  razonamiento, no una medida: **lo mide T2.3**, no se da por cierto.
- Cualquier otra pareja de resultados (`rechazada→entregada`, `entregada→devuelta`, …).
- Rediseñar el modelo de cierres, el snapshot o la anulación de gestiones.
- Corregir en lote.

---

## Requisitos (EARS)

### Autorización y alcance

**R1** — SI el rol del actor no es `maestro` ni `admin`, ENTONCES el sistema DEBE rechazar la
corrección y no modificar ninguna fila.

**R2** — SI la gestión indicada no existe, está anulada, o su cierre queda fuera del alcance del
actor, ENTONCES el sistema DEBE responder «no encontrada» **sin distinguir los tres casos entre sí**
y sin modificar ninguna fila.

**R3** — MIENTRAS el cierre de la gestión no esté en estado `solicitado` o `vencido`, el sistema
DEBE rechazar la corrección como conflicto y no modificar ninguna fila.

**R4** — SI el `resultado` vigente de la gestión no es `entregada`, ENTONCES el sistema DEBE
rechazar la corrección con un error de validación y no modificar ninguna fila.

**R5** — SI el motivo del rechazo llega vacío, o queda vacío tras recortar espacios, ENTONCES el
sistema DEBE rechazar la corrección con un error de validación y no modificar ninguna fila.

### Lo que la corrección escribe

**R6** — CUANDO la corrección se aplica, el sistema DEBE dejar la gestión con `resultado`
`rechazada`, con el motivo recibido, sin ninguna línea de desglose de pago, y sin monto recibido
ni método de pago.

**R7** — CUANDO la corrección se aplica, el sistema DEBE dejar el pago al mensajero de esa gestión
en `0.00` y su ingreso de bodega por rechazo en el importe que corresponde a un rechazo según la
tarifa de la zona destino del cierre.

**R8** — CUANDO la corrección se aplica, el sistema DEBE dejar los seis totales snapshot del cierre
—`total_efectivo`, `total_simpe`, `total_transferencia`, `total_general`, `total_pago_mensajero` y
`total_ingreso_bodega_rechazos`— coherentes con las gestiones vigentes de ese cierre después de la
corrección.

**R9** — CUANDO la corrección se aplica, el sistema DEBE dejar la orden en el estado destino que le
corresponde al resultado `rechazada`, y DEBE añadir una fila al historial de estados de la orden
que enlace la gestión corregida y que **no** cuente como una visita de entrega nueva.

**R10** — CUANDO la corrección se aplica, el sistema DEBE añadir una fila al registro de acciones
con el actor congelado (identificador, nombre y rol en ese instante), con el total general
resultante del cierre como importe, y con el resultado anterior y el nuevo.

### Integridad

**R11** — El sistema DEBE aplicar los efectos de R6 a R10 en una sola transacción; SI cualquiera de
ellos no se puede aplicar, ENTONCES ninguno DEBE quedar aplicado.

**R12** — SI entre la lectura previa y la escritura el cierre deja de estar abierto, o la gestión
deja de ser una `entregada` vigente, ENTONCES el sistema DEBE abortar sin modificar ninguna fila y
responder como conflicto.

**R13** — El sistema NO DEBE modificar, al corregir: las filas de detalle congelado del cierre, las
filas de órdenes sin gestionar del cierre, las evidencias de la gestión, su mensajero autor, ni su
fecha de creación.

**R14** — El sistema DEBE transportar todo importe como cadena decimal de escala 2 desde el borde
hasta la escritura, sin convertirlo nunca a coma flotante.

### Consecuencia declarada

**R15** — CUANDO una gestión corregida pertenece a un cierre que después se aprueba, el sistema
DEBE contarla como un intento de entrega de esa orden.

> Esto **no es un efecto secundario, es la corrección funcionando**, y se declara porque cambia
> números que ya mueven dinero. `RESULTADOS_QUE_CUENTAN_COMO_INTENTO = ["rechazada","devuelta","reprogramada"]`
> (`lib/types/orden-historial.ts:218`) **excluye `entregada`**: en cuanto la gestión pasa a
> `rechazada`, el contador de esa orden sube en uno al aprobarse el cierre, y ese contador gobierna
> el tope de intentos (276) y el escalado del cron de plazos (99).

### Presentación

**R16** — El sistema DEBE ofrecer la corrección únicamente desde el detalle de un cierre abierto en
la pantalla de cierres de administración, y únicamente sobre gestiones con resultado `entregada`.

---

## Mapa R → prueba (el implementer lo completa; el reviewer lo exige)

| R | Dónde se prueba | Nota |
| --- | --- | --- |
| R1, R2, R3, R4, R5 | `tests/unit/services/…` (dobles) | guardias del servicio |
| R6, R7, R8, R9, R12, R13 | **`tests/integration/db/` contra Postgres real** | los dobles no ven el SQL |
| R10 | **`tests/integration/db/`** + entrada nueva en el censo | ver la trampa 2 de abajo |
| R11 | `tests/integration/db/` (fallo forzado → cero efectos) | |
| R14 | `tests/unit/…` + guardia de aritmética existente | |
| R15 | `tests/integration/db/` sobre el derivador de intentos | |
| R16 | `tests/components/` | |

## Trampas de este repo que el mapa de arriba respeta

1. **Los tests de servicio usan dobles y no ven el SQL.** Todo lo que decide *qué filas se tocan*
   se prueba en `tests/integration/db` contra Postgres real, y con **control positivo**: un
   `if (!filas) return;` reporta `passed` sin comprobar nada.
2. **La guardia del historial mide por MÉTODO, no por escritura.**
   `tests/unit/guards/historial-accion-escrituras-cubiertas.guardia.test.ts` comprueba que el
   método declarado en el CENSO llama a `appendAccion`. Si la escritura nueva viviera dentro de
   `actualizarPagosGestion` —que ya llama a `appendAccion` por otro motivo— borrarla dejaría la
   guardia **verde**. Por eso R10 exige **método nuevo con entrada propia en el censo**, y aun así
   se prueba contra Postgres.
3. **El dinero viaja como STRING** de punta a punta (R14). Nunca `float`.
4. **Un `down.sql` de enum recrea el tipo con la lista completa** y borra en silencio los valores
   posteriores. Las dos listas se **miden** contra el catálogo del día (T1.4).

---

## Preguntas abiertas

Ninguna se responde aquí: son **puertas**, y las tres primeras bloquean.

**H1 (BLOQUEANTE, y es lo primero) — el cierre atascado de hoy.**
El humano tiene **un** cierre que no puede aprobar ahora mismo. Esta ficha, implementada, tarda
lo que tarde; la vía manual está descrita en `design.md §8` y necesita la firma del humano y
**datos que no están en el repo**: `cierre_id`, `gestion_id`, número de guía, y si ese cierre está
o no ya consolidado. Sin esos cuatro datos medidos contra producción, la vía manual no se ejecuta.

**H2 — ¿qué tarifa gobierna el ingreso de bodega de la gestión corregida?**
`cierre_dia` congela `destino_zona_id` (la zona del mensajero al solicitar) pero **no** congela la
fila de `tarifa_zona_mensajero` que usó. Para poner el `ingreso_bodega_rechazo` de la gestión
corregida hay dos opciones: (a) resolver la tarifa **de hoy** con la zona congelada del cierre —lo
que el diseño propone por defecto—, o (b) dejarlo en `0.00` y declarar el ingreso de bodega fuera
de alcance. (a) puede diferir de lo que se habría congelado si `tarifa_zona_mensajero` cambió
entre la solicitud y la corrección; (b) subestima el ingreso de bodega en un importe. **Decide el
humano.**

**H3 — la evidencia de una entrega que no ocurrió.**
Un `rechazada` real exige `motivo` **y** al menos una foto (`lib/types/gestion-orden.ts:404-408`).
La gestión corregida conserva la foto de la *entrega*, que es la prueba del error y por eso el
diseño **no la borra ni exige una nueva**. ¿Debe la pantalla pedir una evidencia adicional del
rechazo? Si sí, es una tarea más y otra escritura.

**H4 (leader, pendiente de confirmación) — quién corrige.**
**Decisión del LEADER, no firma humana:** solo `admin` y `maestro` (`ROLES_ACCESO_TOTAL`,
`lib/auth/acceso-total.ts:5`). El mensajero no, porque mueve dinero y quien se equivocó fue él.
Queda registrada como decisión del leader **pendiente de confirmación**.

**H5 — ¿avisar al mensajero?**
Corregirle un resultado le cambia el pago (`pago_mensajero` pasa a `0.00`) sin que él se entere.
Esta ficha **no** emite ningún aviso. Si debe emitirlo, es tarea aparte.

**H6 — hallazgo colateral, no bloqueante.**
El comentario de cabecera de `HistorialAccionTipo` en `db/schema.prisma:3051` dice
`// --- mueve dinero (28) ---` y ese bloque tiene **29** valores desde que la ficha 381 añadió
`cobro_tienda_registrado` sin actualizar el número. `lib/types/historial-accion.ts:45` sí dice 51
(el total correcto). ¿Se arregla de paso en esta ficha o se deja para otra?
