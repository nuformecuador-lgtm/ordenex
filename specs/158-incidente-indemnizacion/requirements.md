# Feature 158 — Estado `incidente` + indemnización desde la wallet

> Zona: **fullstack** · Complejidad: high · `depends_on: 154`
> Se asumen APLICADAS las features **153** (`en_ruta` → `en_reparto`) y **154** (values
> `por_recolectar_en_tienda` / `incidente` en el catálogo `order_status`, arista
> `en_reparto → incidente` vía `gestion` rol mensajero, `incidente` en `ESTADOS_TERMINALES`,
> familias `recoleccion_tienda` / `incidente` en `orden_historial_origen_tipo`).

## Contexto

`incidente` es el desenlace nuevo de la gestión del mensajero para el paquete **dañado, perdido o
robado**. Es **TERMINAL**: no entra al flujo de devolución (137/139) ni vuelve a bodega, y obliga a
**INDEMNIZAR**, lo que produce un **egreso en la caja principal** (wallet, feature 42).

La 154 sólo **declara** la arista `en_reparto → incidente`; esta feature es la que **cablea el
flujo** que la usa y el dinero que genera.

## Decisiones ya cerradas por el humano (NO se reabren)

- **El monto de la indemnización lo captura MANUALMENTE el admin al aprobar el cierre**, junto al
  resto de conceptos. Descartadas: derivarlo de `monto_cobrar` (una orden ya pagada lo tiene en 0 y
  quedaría sin indemnizar) y una columna de "valor declarado" (habría obligado a tocar la plantilla
  de carga masiva v2 de la feature 142 y el contrato público de la API).
- **El egreso se emite al APROBARSE el cierre, por el MISMO camino que el resto de conceptos.** No
  se crea un segundo productor de dinero.

## Nomenclatura

Este spec usa los nombres POST-153: el estado de reparto es **`en_reparto`** (antes `en_ruta`) y su
etiqueta "En reparto".

---

## Requisitos (EARS)

### A. Catálogos y migraciones

**R1** — El sistema DEBE ofrecer el valor `incidente` en el catálogo de resultados de gestión
(`gestion_resultado`), sin retirar, renombrar ni reordenar los cuatro valores existentes
(`entregada`, `reprogramada`, `devuelta`, `rechazada`).

**R2** — El sistema DEBE ofrecer la categoría `egreso_indemnizacion` en el catálogo de categorías de
movimiento de la caja principal (`wallet_movimiento_categoria`), sin retirar ni renombrar las 14
categorías existentes.

**R3** — El sistema DEBE exponer ambos valores nuevos en su fuente única de verdad tipada (SEED de
dominio), de modo que la compilación ROMPA si el enum de base gana un valor que el SEED no lista o
el SEED declara un valor que el enum no tiene.

**R4** — CUANDO se revierta la migración de esta feature, el sistema DEBE recrear cada enum sin el
valor añadido y DEBE abortar ruidosamente (sin dejar la base a medias) si alguna fila persistida
usa el valor que se está retirando.

**R5** — El sistema DEBE mantener el desglose por resultado y por categoría **exhaustivo en tipos**:
todo mapa `Record<GestionResultado, …>` y `Record<WalletMovimientoCategoria, …>` DEBE clasificar
explícitamente el valor nuevo (la ausencia rompe el build; esa red no se relaja con `default`,
`?? ` ni casts).

### B. Reporte del incidente (gestión del mensajero) · depende de **Q-A**

**R6** — DONDE el reporte de incidente lo hace el mensajero al gestionar (Q-A, recomendación del
design), CUANDO un mensajero registra una gestión con resultado `incidente` sobre una orden en
`en_reparto` que le está asignada, el sistema DEBE persistir la gestión y transicionar la orden a
`incidente` en una ÚNICA transacción (todo-o-nada).

**R7** — SI la orden no está en `en_reparto`, no está asignada al actor, está borrada o el actor
tiene un cierre pendiente que lo bloquea, ENTONCES el sistema DEBE rechazar el reporte sin efectos
persistidos (ni fila de gestión, ni transición, ni archivos en el bucket).

**R8** — CUANDO se registra un incidente, el sistema DEBE dejar rastro en el historial de estados de
la orden con actor, instante y familia de origen, igual que cualquier otra transición.

**R9** — DONDE se exija motivo tipado (Q-B), CUANDO el mensajero reporta un incidente, el sistema
DEBE exigir una causa perteneciente a una lista CERRADA (paquete dañado / perdido / robado) y
rechazar con error por campo cualquier valor fuera de esa lista o su ausencia.

**R10** — DONDE se exija evidencia (Q-B), el sistema DEBE aplicar la regla de evidencia por causa
definida en el design (§Q-B) y rechazar con error por campo el envío que no la cumpla, sin efectos
persistidos.

**R11** — El sistema DEBE conservar el motivo en texto libre como campo obligatorio y APARTE de la
causa tipificada (mismo contrato que la devolución de la feature 73).

**R12** — El sistema DEBE mantener el gate de verificación de guía antes de habilitar cualquier
resultado de gestión, incluido `incidente`.

### C. Terminalidad

**R13** — MIENTRAS una orden esté en `incidente`, el sistema DEBE rechazar toda transición de estado
salvo la de deshacer la gestión (R14): ni cron de SLA de devolución, ni liberación por aprobación de
cierre, ni recuperación manual, ni devolución a la tienda, ni ajuste administrativo genérico pueden
sacarla de ahí.

**R14** — CUANDO el mensajero deshace una gestión `incidente` que aún no está vinculada a ningún
cierre y cuya orden sigue exactamente en `incidente`, el sistema DEBE anular la gestión con rastro y
devolver la orden a `en_reparto` con su mensajero, en una única transacción.

**R15** — SI la gestión `incidente` ya está vinculada a un cierre, ENTONCES el sistema DEBE rechazar
el deshacer con conflicto y mensaje accionable, sin tocar la orden.

### D. Cierre del día

**R16** — CUANDO un mensajero solicita su cierre del día, el sistema DEBE incluir las gestiones
`incidente` vigentes del día en ese cierre, con el mismo grano y el mismo congelado por orden que el
resto de resultados.

**R17** — Una gestión `incidente` NO DEBE aportar pago al mensajero, ni ingreso de bodega por
rechazo, ni ningún concepto de ingreso de Ordenex (flete, flete de devolución, comisión COD ni sus
IVA) a los totales ni a los movimientos del cierre.

**R18** — El sistema DEBE mostrar las gestiones `incidente` como grupo PROPIO, con etiqueta legible
en español, tanto en el detalle del cierre del mensajero como en el detalle del admin.

### E. Captura del monto y aprobación

**R19** — MIENTRAS un cierre `solicitado` contenga al menos una gestión `incidente`, el sistema DEBE
exigir al admin, en el momento de aprobar, un monto de indemnización por CADA una de esas gestiones.

**R20** — SI falta el monto de alguna gestión `incidente` del cierre, o alguno de los montos no es un
número mayor que 0 con hasta 2 decimales, ENTONCES el sistema DEBE rechazar la aprobación con error
de validación por campo, dejando el cierre en `solicitado` y sin emitir ningún movimiento.

**R21** — SI la aprobación incluye montos para gestiones que no pertenecen a ese cierre o cuyo
resultado no es `incidente`, ENTONCES el sistema DEBE rechazar la aprobación sin efectos.

**R22** — CUANDO el admin aprueba un cierre con incidentes y montos válidos, el sistema DEBE, en la
MISMA transacción de la aprobación: persistir cada monto asociado a su gestión, emitir el egreso de
indemnización y aplicar los efectos de aprobación ya existentes. Si algo falla, NADA queda aplicado.

**R23** — CUANDO el admin RECHAZA un cierre, el sistema NO DEBE persistir montos de indemnización ni
emitir egreso alguno; la gestión `incidente` conserva su estado y se tarifica cuando el cierre se
apruebe.

**R24** — El sistema DEBE tratar el monto como valor monetario exacto de extremo a extremo (texto
con 2 decimales / decimal de base), sin pasar en ningún punto por coma flotante.

**R25** — SI el actor no tiene alcance sobre el cierre (rol no autorizado, o cierre de otra bodega o
zona), ENTONCES el sistema DEBE rechazar la aprobación y la captura sin revelar datos del cierre y
sin efectos.

### F. Egreso en la wallet

**R26** — CUANDO se aprueba un cierre con al menos un incidente tarifado, el sistema DEBE emitir en
la caja principal exactamente UN movimiento de `tipo = egreso`, `categoria = egreso_indemnizacion`,
`origen_tipo = cierre_dia` y `origen_id` igual al identificador del cierre, cuyo monto DEBE ser
exactamente la suma de los montos persistidos para ese cierre.

**R27** — SI el cierre no tiene gestiones `incidente`, ENTONCES el sistema NO DEBE emitir ningún
movimiento de `egreso_indemnizacion` (ni una fila en 0.00).

**R28** — CUANDO la aprobación de un cierre ya aprobado se reintente, el sistema NO DEBE emitir un
segundo movimiento de indemnización para ese cierre ni alterar el ya emitido.

**R29** — El sistema DEBE emitir ese egreso por el MISMO camino y en la misma transacción que el
resto de conceptos del cierre; NO DEBE existir un segundo punto de emisión de movimientos de
indemnización (ni acción manual, ni cron, ni endpoint).

**R30** — El movimiento de indemnización NO DEBE ser reversable por el flujo de reversa de egresos
administrativos.

### G. Superficie visible

**R31** — El sistema DEBE mostrar el concepto de indemnización con etiqueta legible en español en el
libro de la wallet y ofrecerlo como opción del filtro por categoría.

**R32** — El desglose de egresos de la wallet DEBE incluir la indemnización como fila propia, con el
total del conjunto filtrado, y DEBE sumarla al total mostrado.

**R33** — El panel de gestión del mensajero DEBE ofrecer la opción de incidente diferenciada
visualmente de los resultados existentes, y DEBE validar en cliente con el MISMO esquema que el
servidor revalida en el borde.

**R34** — CUANDO el admin abra la aprobación de un cierre con incidentes, la interfaz DEBE mostrar,
por cada incidente, la identificación de la orden y su causa, y pedir su monto; y NO DEBE permitir
confirmar la aprobación mientras falte alguno.

### H. No regresión

**R35** — Los cuatro resultados de gestión existentes DEBEN conservar exactamente su comportamiento
actual (montos, métodos de pago, evidencias, causa de devolución, transiciones y efectos de cierre).

**R36** — Un cierre SIN incidentes DEBE poder aprobarse exactamente como hoy: sin campos nuevos
obligatorios, con los mismos movimientos y los mismos efectos de estado.

---

## Preguntas abiertas

Las tres primeras vienen marcadas como ABIERTAS en la ficha de la feature; la cuarta y la quinta las
levanta este spec al leer el código. Todas están formalizadas, con recomendación razonada y su
impacto en los requisitos, en **`design.md` → §10 Preguntas abiertas**.

- **Q-A — ¿Quién reporta el incidente?** El mensajero al gestionar, o sólo un admin. Afecta a
  R6-R12 (si fuera sólo-admin, el reporte deja de ser un resultado de gestión y hay que definir
  otra arista y otra pantalla). *Recomendación: el mensajero al gestionar.*
- **Q-B — ¿Exige motivo tipado y evidencia fotográfica?** Afecta a R9/R10. *Recomendación: sí a la
  causa tipada (3 valores: dañado / perdido / robado), y evidencia obligatoria sólo cuando la causa
  es "dañado" (en perdido/robado no hay paquete que fotografiar).*
- **Q-C — ¿Dónde se persiste el monto capturado?** La ficha apunta a `cierre_detail`. **Verificado
  contra el código: `cierre_detail` NO sirve** — es un snapshot INMUTABLE escrito sólo al
  SOLICITAR el cierre (feature 69/R10), con un guard que prohíbe cualquier `update`/`delete` sobre
  la tabla, y el monto se captura al APROBAR. *Recomendación: columna nueva en `gestion_orden`.*
  Detalle y evidencia en design §3.3 y §10.
- **Q-D — ¿Se puede deshacer un incidente?** R14/R15 lo asumen posible. Requiere declarar la arista
  de deshacer para `incidente`, que la 154 no menciona. *Recomendación: sí, igual que `entregada`,
  que también es terminal y conserva su arista de deshacer.*
- **Q-E — ¿La indemnización también acredita a la tienda?** El egreso sale de la caja de Ordenex,
  pero el ledger por tienda (feature 43) no se toca en esta feature. *Recomendación: fuera de
  alcance de la 158, con follow-up explícito.*
