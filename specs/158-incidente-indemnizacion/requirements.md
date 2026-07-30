# Feature 158 — Estado `incidente` + indemnización desde la wallet

> Zona: **fullstack** · Complejidad: high · `depends_on: 154`
> Se asumen APLICADAS las features **153** (`en_ruta` → `en_reparto`) y **154** (values
> `por_recolectar_en_tienda` / `incidente` en el catálogo `order_status`, arista
> `en_reparto → incidente` vía `gestion` rol mensajero, `incidente` en `ESTADOS_TERMINALES`,
> familias `recoleccion_tienda` / `incidente` en `orden_historial_origen_tipo`).
>
> ⚠️ **Ampliado el 2026-07-30** al cerrar la puerta F1.4: R1-R36 conservan su numeración (con **R6,
> R9, R10, R13, R14, R15 y R29 reescritos en su sitio**, cada uno con la nota de por qué) y entra el
> bloque **I-M (R37-R64) con el camino del ADMIN**, que es alcance nuevo.
>
> ⚠️ **Riesgo de tamaño declarado:** con esta ampliación la feature queda **por encima** de su
> estimación `high` (36 → 64 requisitos, 1 → 2 migraciones, 2 tablas nuevas, 2 productores de dinero,
> 11 aristas nuevas en el mapa de la 140, ≥10 tests de otras features a reescribir). `design.md` §15
> **propone** un corte en dos entregas y demuestra que el intermedio no deja nada roto. **Decide el
> humano** (Q-L).

## Contexto

`incidente` es el desenlace nuevo del paquete **dañado, perdido o robado**. Es **TERMINAL**: no entra
al flujo de devolución (137/139) ni vuelve a bodega, y obliga a **INDEMNIZAR**, lo que produce un
**egreso en la caja principal** (wallet, feature 42).

**Lo reportan LOS DOS actores que manipulan paquetes** (Q-A): el **mensajero** al gestionar desde
`en_reparto`, y el **admin/maestro** desde bodega y tránsitos internos. Cada camino tiene su propio
punto de aprobación del dinero: el cierre del día para el mensajero, y la aprobación del incidente
para el admin (donde **quien reporta no aprueba**).

La 154 sólo **declara** la arista `en_reparto → incidente`; esta feature es la que **cablea los dos
flujos** que la usan, declara las **11 aristas** que faltan y el dinero que generan.

## Decisiones ya cerradas por el humano (NO se reabren)

> **La puerta F1.4 quedó CERRADA el 2026-07-30.** Las diez decisiones, con su razón textual y su
> evidencia de código, están escritas en **`design.md` → §0**, que es la fuente. Aquí va sólo el
> resumen que cambia requisitos. Se escriben EN EL SPEC a propósito: la lección «CORRECCIÓN 1» de
> `progress/current.md` dice que «gate aprobado en la bitácora» no es lo mismo que las preguntas del
> spec respondidas por escrito.

- **Q-A — REPORTAN LOS DOS** («los dos ya que los dos manipulan paquetes»). El **mensajero** al
  gestionar desde `en_reparto` (arista #44, ya declarada por la 154) y el **admin/maestro** desde
  bodega y tránsitos internos: conjunto CERRADO de 5 estados (`en_bodega_central`,
  `en_bodega_satelite`, `en_ruta_bodega_central`, `en_ruta_bodega_satelite`, `por_recoger`). El
  camino del admin es **alcance nuevo** y vive en el bloque **I-M (R37-R64)**.
- **Q-B — causa TIPADA (3 valores, lista cerrada, sin «Otro») + evidencia fotográfica 1..N
  OBLIGATORIA SIEMPRE**, también en `perdido` y `robado`, y `motivo` libre obligatorio siempre.
  Valores **en español**: `danado`, `perdido`, `robado`. Reescribe **R9** y **R10**.
- **Q-C — el monto del camino del mensajero se persiste en `gestion_orden.indemnizacion`**
  (`DECIMAL(12,2)`). `cierre_detail` descartado por evidencia, no por preferencia.
- **Q-D — un `incidente` SÍ se puede deshacer**, dentro de ventana controlada («como es una app
  usada por seres humanos y nosotros solemos cometer errores, lo ideal es que cada acción se pueda
  deshacer, obviamente dentro de un ambiente controlado»). Es una **reversión parcial y explícita de
  una decisión de la 154 ya mergeada** (`incidente: []`). Reescribe **R13**, **R14**, **R15** y añade
  el bloque **L (R57-R60)**.
- **Q-E — el crédito a la tienda queda FUERA de alcance**, con follow-up explícito registrado
  («crédito de indemnización en el ledger por tienda», feature 43).
- **Q-F — NO se reescriben los `down.sql` previos.** Sí se corre `tests/integration/db` completo.
- **Q-G — el append de la transición escribe `origen_tipo = incidente`** y se alinea el metadato
  `via` de la arista #44.
- **Aprobación del camino del admin (decisión nueva):** se reusa el **PATRÓN** de los cierres
  (enum `CierreEstado` `solicitado → aprobado/rechazado`, cola «Pendientes de decisión» + «Histórico»,
  motivo obligatorio sólo al rechazar), **no la tabla**. El egreso se dispara **AL APROBAR**, y
  **quien reporta no aprueba** (doble control del dinero). Reescribe **R29** (pasa a haber DOS puntos
  de emisión, uno por camino) y añade los bloques **I-K (R37-R56)**.
- **El monto del camino del mensajero lo captura MANUALMENTE el admin al aprobar el cierre**, junto al
  resto de conceptos. Descartadas: derivarlo de `monto_cobrar` (una orden ya pagada lo tiene en 0 y
  quedaría sin indemnizar) y una columna de "valor declarado" (habría obligado a tocar la plantilla
  de carga masiva v2 de la feature 142 y el contrato público de la API).
- **En el camino del mensajero el egreso se emite al APROBARSE el cierre, por el MISMO camino que el
  resto de conceptos.**

## Consecuencia aceptada de Q-B (declarada, no disimulada)

Exigir evidencia fotográfica en `perdido` y `robado` significa que **al actor se le pide fotografiar
lo que sí tiene delante cuando el paquete no está**: el vehículo o el compartimento vacío, la guía o
la etiqueta, el lugar del hecho, o la denuncia/parte policial. **No hay paquete que fotografiar y el
spec no finge que lo haya.** Se le planteó al humano la objeción («bloquea al mensajero en la calle»)
y eligió esta opción de todas formas: es su decisión y **no se re-litiga**. El coste queda escrito
para que quien lo sufra sepa que fue elegido: un mensajero sin batería o sin señal no puede reportar
un robo hasta poder subir al menos una foto.

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

### B. Reporte del incidente (gestión del mensajero) · Q-A cerrada

> **Q-A cerrada: reportan LOS DOS.** Este bloque es el camino del **mensajero**; el del **admin**
> es el bloque **J (R41-R48)**. Los dos son alcance de esta feature.

**R6** — *(reescrito el 2026-07-30: la condición «DONDE… recomendación del design» desaparece porque
Q-A quedó cerrada; el requisito en sí no cambia de fondo.)* CUANDO un mensajero registra una gestión
con resultado `incidente` sobre una orden en `en_reparto` que le está asignada, el sistema DEBE
persistir la gestión y transicionar la orden a `incidente` en una ÚNICA transacción (todo-o-nada).

**R7** — SI la orden no está en `en_reparto`, no está asignada al actor, está borrada o el actor
tiene un cierre pendiente que lo bloquea, ENTONCES el sistema DEBE rechazar el reporte sin efectos
persistidos (ni fila de gestión, ni transición, ni archivos en el bucket).

**R8** — CUANDO se registra un incidente, el sistema DEBE dejar rastro en el historial de estados de
la orden con actor, instante y familia de origen, igual que cualquier otra transición.

**R9** — *(reescrito el 2026-07-30 por Q-B: deja de estar condicionado y fija los valores.)* CUANDO
el mensajero reporta un incidente, el sistema DEBE exigir una causa perteneciente a una lista CERRADA
de EXACTAMENTE tres valores —`danado`, `perdido`, `robado`, en español y sin «Otro»— y rechazar con
error por campo cualquier valor fuera de esa lista o su ausencia.

**R10** — *(reescrito el 2026-07-30 por Q-B: la regla «por causa» se cae; la evidencia es obligatoria
SIEMPRE.)* CUANDO el mensajero reporta un incidente, el sistema DEBE exigir **entre 1 y N fotos de
evidencia con independencia de la causa** —incluidas `perdido` y `robado`—, aplicando los mismos
límites por archivo y por lista que el resto de los resultados con foto, y DEBE rechazar con error por
campo el envío que no las traiga, sin efectos persistidos (ni fila de gestión, ni transición, ni
objetos en el bucket).

**R11** — El sistema DEBE conservar el motivo en texto libre como campo obligatorio y APARTE de la
causa tipificada (mismo contrato que la devolución de la feature 73).

**R12** — El sistema DEBE mantener el gate de verificación de guía antes de habilitar cualquier
resultado de gestión, incluido `incidente`.

### C. Terminalidad

> **Reversión parcial y fechada de una decisión de la 154.** La 154 dejó `incidente` sin ninguna
> arista de salida (decisión del humano del 2026-07-29). Q-D (2026-07-30) la revierte **sólo para las
> vías de reversión**: `incidente` sigue siendo TERMINAL —no continúa el flujo, no vuelve a bodega por
> ningún camino de negocio— pero conserva las salidas que permiten **deshacer un error humano**. Es
> compatible con dejarlo en `ESTADOS_TERMINALES`: ese conjunto **exime** de tener salida, **no la
> prohíbe**, y `entregada` es el precedente exacto (terminal Y con su arista de deshacer).

**R13** — *(reescrito el 2026-07-30 por Q-D: la excepción deja de ser una y pasa a ser el conjunto
cerrado de reversiones.)* MIENTRAS una orden esté en `incidente`, el sistema DEBE rechazar toda
transición de estado salvo las de reversión declaradas (R14 para el camino del mensajero, R57-R59 para
el del admin): ni cron de SLA de devolución, ni liberación por aprobación de cierre, ni recuperación
manual, ni devolución a la tienda, ni ajuste administrativo genérico, ni reasignación, ni ruteo pueden
sacarla de ahí.

**R14** — *(reescrito el 2026-07-30 por Q-D: se explicita el actor y que el destino ES el estado de
origen.)* CUANDO el **mensajero autor** deshace una gestión `incidente` que aún no está vinculada a
ningún cierre y cuya orden sigue exactamente en `incidente`, el sistema DEBE anular la gestión con
rastro y devolver la orden a **`en_reparto`, que es el único estado desde el que esa gestión pudo
nacer**, reponiendo su asignación, en una única transacción.

**R15** — SI la gestión `incidente` ya está vinculada a un cierre, ENTONCES el sistema DEBE rechazar
el deshacer con conflicto y mensaje accionable, sin tocar la orden. SI quien intenta deshacerla no es
el mensajero autor, ENTONCES el sistema DEBE rechazar sin revelar datos de la gestión.

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

**R29** — *(reescrito el 2026-07-30: la decisión de aprobación del camino del admin obliga a un segundo
emisor. El requisito pasa de «uno» a «exactamente dos, uno por camino, y ningún tercero».)* El sistema
DEBE emitir el egreso de indemnización del **cierre** por el MISMO camino y en la misma transacción que
el resto de conceptos del cierre. El sistema DEBE tener **exactamente DOS** puntos de emisión de
movimientos `egreso_indemnizacion` en todo el código: la transacción de aprobación del **cierre del
día** (camino del mensajero) y la transacción de aprobación del **incidente del admin** (R52). NO DEBE
existir un tercero, ni acción manual, ni cron, ni endpoint que emita esa categoría.

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

# Camino del ADMIN — alcance nuevo (Q-A: reportan los dos)

> Bloques **I a M**. Todo lo de aquí es NUEVO respecto de la versión anterior del spec. El actor es
> `maestro`/`admin` (acceso total) o `adminSatelite` acotado a su zona; la orden está en bodega o en un
> tránsito interno, **no en manos de un mensajero**. El reporte NO es una gestión: es una entidad
> propia con su propia aprobación (ver `design.md` §12 para la evidencia de por qué no puede ser una
> fila de `gestion_orden`).

### I. Catálogos y datos del camino del admin

**R37** — El sistema DEBE ofrecer un valor nuevo en el catálogo de tipos de origen de movimiento de la
caja principal (`wallet_origen_tipo`) que identifique al incidente reportado por el admin como origen
del egreso, sin retirar, renombrar ni reordenar los seis valores existentes, y DEBE exponerlo en su
SEED tipado con el mismo doble candado que el resto: la compilación ROMPE si el enum de base y el SEED
divergen en cualquiera de las dos direcciones.

**R38** — El sistema DEBE persistir el incidente reportado por un admin como una entidad PROPIA,
separada de la gestión del mensajero, de modo que NO participe de ningún agregado por mensajero: NO
DEBE aparecer en el cierre del día de nadie, NO DEBE contar en el ranking diario, y NO DEBE hacer que
el corte diario cree un cierre para su autor.

**R39** — Cada incidente reportado por un admin DEBE registrar, como mínimo y de forma persistida: la
orden, el autor del reporte, la causa tipada (misma lista cerrada de R9), el motivo en texto libre, sus
1..N evidencias, el estado de aprobación, el monto de la indemnización (vacío hasta que se apruebe),
quién lo resolvió, cuándo, y el motivo de rechazo si lo hubo.

**R40** — CUANDO se revierta la migración de este camino, el sistema DEBE dejar la base exactamente
como estaba (sin el valor nuevo del catálogo y sin las estructuras nuevas) y DEBE abortar ruidosamente,
sin dejarla a medias, si alguna fila persistida usa lo que se está retirando.

### J. Reporte del incidente por el admin

**R41** — CUANDO un actor autorizado (R48) registra un incidente sobre una orden no borrada que está en
uno de los CINCO estados admitidos —`en_bodega_central`, `en_bodega_satelite`, `en_ruta_bodega_central`,
`en_ruta_bodega_satelite`, `por_recoger`—, el sistema DEBE persistir el reporte y transicionar la orden
a `incidente` en una ÚNICA transacción (todo-o-nada).

**R42** — SI la orden no está en uno de esos cinco estados, o está borrada, o no existe, ENTONCES el
sistema DEBE rechazar el reporte sin ningún efecto persistido: ni fila de incidente, ni transición de
estado, ni fila de historial, ni objetos en el bucket de evidencias.

**R43** — CUANDO se persiste un incidente reportado por un admin, el sistema DEBE dejarlo en estado
`solicitado` y NO DEBE producir NINGÚN movimiento de dinero en ese instante: ni en la caja principal, ni
en el ledger por tienda, ni en el libro del pago al mensajero.

**R44** — CUANDO se registra un incidente reportado por un admin, el sistema DEBE dejar rastro en el
historial de estados de la orden con el actor, el instante y la familia de origen `incidente`, igual que
cualquier otra transición, y sin modificar ninguna fila previa del historial.

**R45** — CUANDO un admin reporta un incidente, el sistema DEBE exigir una causa de la MISMA lista
cerrada de tres valores de R9 y un motivo en texto libre no vacío, y DEBE rechazar con error por campo
cualquier valor fuera de la lista, su ausencia, o un motivo vacío.

**R46** — CUANDO un admin reporta un incidente, el sistema DEBE exigir entre 1 y N fotos de evidencia
con independencia de la causa (misma regla que R10) y DEBE exponerlas después SÓLO mediante URL firmada
de vigencia acotada, nunca la ruta cruda del bucket.

**R47** — MIENTRAS una orden tenga un incidente en estado `solicitado` o `aprobado`, el sistema DEBE
rechazar cualquier reporte nuevo sobre esa misma orden, y DEBE garantizarlo también a nivel de base, no
sólo con una comprobación previa.

**R48** — SI el actor no tiene alcance sobre la orden (rol no autorizado, o `adminSatelite` cuya zona no
es la de la orden), ENTONCES el sistema DEBE rechazar el reporte y también la consulta del incidente sin
revelar ningún dato de la orden ni del incidente, y sin efectos.

### K. Aprobación del incidente del admin y su egreso

**R49** — El sistema DEBE ofrecer al admin, acotada a su alcance, la lista de incidentes **pendientes de
decisión** y la de incidentes **ya resueltos** (histórico de sólo lectura), con el mismo modelo de dos
colas que ya usa la resolución de cierres.

**R50** — CUANDO el admin aprueba un incidente, el sistema DEBE exigir un monto de indemnización que sea
un número mayor que 0 con hasta 2 decimales, y SI falta o es inválido ENTONCES DEBE rechazar la
aprobación con error de validación por campo, dejando el incidente en `solicitado`, la orden intacta y
sin emitir ningún movimiento.

**R51** — SI el actor que intenta resolver un incidente es el MISMO que lo reportó, ENTONCES el sistema
DEBE rechazar la operación con conflicto y mensaje accionable, sin efectos. Quien reporta no aprueba.

**R52** — CUANDO un actor autorizado y distinto del autor aprueba un incidente `solicitado` con un monto
válido, el sistema DEBE, en la MISMA transacción: persistir el monto, marcar el incidente `aprobado`
con quién y cuándo lo resolvió, y emitir en la caja principal exactamente UN movimiento de
`tipo = egreso`, `categoria = egreso_indemnizacion`, con origen el incidente y monto exactamente igual
al persistido. Si algo falla, NADA queda aplicado.

**R53** — CUANDO la aprobación de un incidente ya aprobado se reintente, el sistema NO DEBE emitir un
segundo movimiento para ese incidente, NO DEBE alterar el ya emitido y NO DEBE cambiar el monto
persistido.

**R54** — CUANDO el admin RECHAZA un incidente `solicitado`, el sistema DEBE exigir un motivo de rechazo
no vacío y DEBE, en la MISMA transacción: marcar el incidente `rechazado` con su motivo, quién y cuándo,
y devolver la orden a su estado de origen (R57). NO DEBE persistir monto ni emitir ningún movimiento.

**R55** — El sistema DEBE tratar el monto de la indemnización como valor monetario exacto de extremo a
extremo (texto con 2 decimales / decimal de base), sin pasar en ningún punto por coma flotante.

**R56** — Una misma orden NO DEBE llegar a tener más de un egreso de indemnización pagado, por ninguna
combinación de los dos caminos: ni dos por el camino del admin, ni uno por cada camino.

### L. Reversión de un `incidente` (las dos vías)

**R57** — CUANDO se revierte un `incidente`, el estado destino DEBE ser el estado desde el que ese
incidente se reportó, leído de una fuente persistida y auditable. El sistema NO DEBE usar un estado
destino fijo escrito en el código para el camino del admin.

**R58** — SI no se puede determinar ese estado de origen, o el estado determinado no pertenece al
conjunto cerrado de orígenes declarados para ese camino, ENTONCES el sistema DEBE rechazar la reversión
con conflicto y mensaje accionable, sin mover la orden y sin efectos.

**R59** — MIENTRAS un incidente del admin esté `solicitado`, el sistema DEBE permitir revertirlo (por
retracto de su autor o por rechazo del aprobador). MIENTRAS esté `aprobado`, el sistema DEBE rechazar
toda reversión: el dinero ya salió y una corrección se hace con un movimiento compensatorio, nunca
alterando el movimiento emitido.

**R60** — CUANDO se revierte un incidente cuyo autor NO es un mensajero, el sistema NO DEBE asignar ni
reasignar mensajero alguno a la orden: DEBE dejar la asignación exactamente como estaba antes del
reporte.

### M. No regresión e invariantes del mapa de estados

**R61** — El sistema DEBE mantener `incidente` clasificado como estado TERMINAL y alcanzable, y sus
ÚNICAS aristas de salida declaradas DEBEN ser las de reversión de R14 y R57; el invariante de
conectividad del grafo de estados DEBE seguir cumpliéndose.

**R62** — Las aristas nuevas de entrada a `incidente` NO DEBEN alterar, retirar ni duplicar ninguna
arista existente, y el inventario declarado del grafo DEBE seguir cuadrando exactamente con el mapa
(número de aristas, de pares únicos y correspondencia una a una).

**R63** — Un incidente reportado por un admin NO DEBE aparecer en el detalle ni en los totales del
cierre del día de ningún mensajero, NO DEBE alterar el pago a mensajeros, el ingreso de bodega por
rechazos ni el ingreso de Ordenex, y NO DEBE aportar nada al ledger por tienda.

**R64** — El camino del mensajero (R6-R30) DEBE conservar exactamente su comportamiento tras añadir el
camino del admin: los dos egresos son movimientos distintos, con origen distinto, y ninguno reemplaza,
absorbe ni anula al otro.

---

## Preguntas abiertas

> **Q-A a Q-G están CERRADAS** (puerta F1.4, 2026-07-30). Sus respuestas están arriba y, con su razón
> y evidencia, en `design.md` §0. Lo que sigue son las preguntas que quedan **realmente abiertas**
> después de cerrar esa puerta: las levanta este spec al diseñar el camino del admin. **Ninguna
> bloquea el arranque del backend del camino del mensajero**; las dos primeras sí bloquean el frontend
> del camino del admin.

- **Q-H — ¿Desde dónde reporta el admin, y en qué pantalla?** El diseño propone un modal por orden en
  el módulo de órdenes (`app/(app)/ordenes/`), abierto desde la acción de fila, calcado de
  `RecuperarABodegaModal` (100) y `DeshacerAsignacionModal` (149), que son las dos acciones
  administrativas por orden con motivo que ya existen ahí. *Recomendación: eso.* Alternativa no
  elegida: colgarlo del módulo de recepción satélite, que sólo cubriría dos de los cinco orígenes.
  **Bloquea T2.7.**
- **Q-I — ¿La cola de aprobación de incidentes es una página nueva del menú, o una sección dentro de
  «Cierres»?** El diseño propone **página propia** (`/incidentes`), espejo de `cierres-admin`, porque
  un incidente no es un cierre y mezclarlos obligaría a que la pantalla de cierres cargue datos de
  otra entidad. Coste declarado: entrada nueva en `lib/auth/menu-visibility.ts` y su visibilidad por
  rol. *Recomendación: página propia.* **Bloquea T2.8.**
- **Q-J — ¿El mensajero asignado se entera de que su orden se marcó como incidente?** Si un admin
  reporta un incidente sobre una orden en `por_recoger` que ya está asignada, esa orden desaparece de
  «Mis asignaciones» sin aviso. Hay infraestructura de notificaciones (feature 146). *Recomendación:
  fuera de alcance de la 158 y follow-up explícito* — pero conviene decidirlo, no descubrirlo en
  producción.
- **Q-K — ¿Qué pasa con la asignación de la orden al reportar un incidente desde `por_recoger`?** El
  diseño **no toca `mensajero_asignado_id`** (así la reversión de R60 es trivialmente correcta: no hay
  nada que reponer). La consecuencia es que la orden queda en `incidente` con un mensajero asignado
  colgando. *Recomendación: no tocarla y declararlo*; la alternativa (limpiarla, como hace la
  liberación de `sin_gestionar`) obligaría a guardar también la asignación previa para poder revertir.
- **Q-L — ¿Se entrega la feature en una sola vez o en dos?** El diseño propone un corte en dos
  entregas con la línea trazada y el análisis de qué queda roto en el intermedio (**nada funcional**)
  en `design.md` §15. **Es una recomendación, no una decisión del spec_author: la toma el humano.**
