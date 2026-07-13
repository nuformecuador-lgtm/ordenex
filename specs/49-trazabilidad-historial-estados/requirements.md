# Feature 49 — Trazabilidad / historial de estados de la orden — requirements.md

> Registrar la trazabilidad COMPLETA de cada orden: el historial append-only de
> todas las transiciones de estado por las que pasó, con timestamp, actor y motivo,
> consultable como línea de tiempo en el detalle de la orden. Es la base de la
> feature 47 (contador de intentos / escalado a rechazo).
>
> Notación EARS. Cada `R<n>` es testeable y mapea a un test (ver `tasks.md`).
> Zona: fullstack. Complejidad: high. Un ciclo (backend_dev → frontend_dev), un PR.
> Depende de la feature 36 (done). La rama nace del tip de la 46 (contiene 43 + 46),
> por lo que la transición de liberación de la 46 también se instrumenta.

## Glosario

- **Transición de estado:** todo cambio de `orden.estatus_id` (incluido el paso
  `NULL → estado inicial` que ocurre al crear la orden).
- **Punto de escritura de estado:** cada método de repositorio que escribe
  `orden.estatus_id`. El mapa exacto (archivo:símbolo) vive en `design.md §2`.
- **Historial / línea de tiempo:** las filas del historial de una orden ordenadas
  cronológicamente.
- **Actor:** el `usuario_id` que originó la transición; `NULL` cuando la origina el
  sistema (cron/job), no una persona.

---

## Modelo de datos, migración y RLS

**R1** — El sistema DEBE persistir cada transición de estado de una orden como una
fila en una tabla nueva de historial `orden_historial_estado`, con: la orden
afectada, el estado de destino, el estado de origen (que DEBE ser vacío/nulo cuando
la transición es la creación de la orden), el actor (que DEBE poder ser nulo para
transiciones del sistema), el tipo de origen de la transición, un motivo opcional y
el instante en que ocurrió.

**R2** — El sistema DEBE tratar cada fila del historial como INMUTABLE y append-only:
una vez escrita, NUNCA se actualiza ni se borra (sin `updated_at`, sin `deleted_at`,
sin soft delete). Una corrección se representa con una nueva transición, jamás
alterando una fila previa.

**R3** — MIENTRAS la tabla `orden_historial_estado` exista, el sistema DEBE tenerla
con Row Level Security habilitada (sin policies: solo el service role accede, patrón
`gestion_orden` / `cierre_dia` / `wallet_movimiento`). Un acceso con clave anónima
DEBE ser rechazado.

**R4** — El sistema DEBE crear la tabla mediante una migración Prisma versionada que
incluya su `down.sql`, de modo que el round-trip `db:migrate` → `db:rollback` →
`db:migrate` deje el esquema idéntico. El `down.sql` DEBE revertir exactamente lo que
crea el `migration.sql` (tabla, enum de tipo de origen, índices y RLS), sin tocar
objetos preexistentes.

**R5** — El sistema DEBE indexar el historial por `(orden_id, created_at)` para que la
consulta de la línea de tiempo de UNA orden no escanee la tabla completa.

## Captura centralizada y atómica

**R6** — El sistema DEBE registrar el append al historial a través de UN mecanismo
centralizado (un helper/transición única que toda escritura de estado invoca), de modo
que agregar una fila de historial no dependa de recordar código ad-hoc en cada
call-site. (Diseño del choke point en `design.md §3`.)

**R7** — CUANDO una escritura de estado persiste una transición, el sistema DEBE
escribir el cambio de `orden.estatus_id` y su fila de historial en la MISMA
transacción de base de datos (atómico): si una falla, ambas se revierten; nunca queda
un cambio de estado sin su rastro ni un rastro sin su cambio de estado.

**R8** — CUANDO una escritura de estado es guardada (updateMany/SQL condicional que
solo afecta las órdenes que aún cumplen la precondición, p. ej. estado de origen +
zona + no-borrada + guarda anti-TOCTOU), el sistema DEBE registrar en el historial
ÚNICAMENTE las órdenes que EFECTIVAMENTE transicionaron (filas afectadas > 0), y NO
las que perdieron la carrera o no cumplían la guarda.

## Append en cada familia de transición de la máquina de estados

> Un requisito por familia, cada uno mapeable a un test. El mapa archivo:símbolo con
> el estado destino de cada punto está en `design.md §2`.

**R9** — CUANDO se crean órdenes por carga masiva (feature 15/27, estado inicial
`en_preparacion` o `en_fulfillment` según la tienda), el sistema DEBE registrar por
cada orden creada una fila de historial con origen vacío y destino = el estado
inicial, con tipo de origen "carga masiva".

**R10** — CUANDO se crea una orden individual por el CRUD (feature 6), el sistema DEBE
registrar una fila de historial con origen vacío y destino = el estado inicial.

**R11** — CUANDO el maestro genera guía (feature 17/30) y una orden pasa a
`en_espera_aceptacion`, `en_bodega` o `en_ruta_bodega_satelite`, el sistema DEBE
registrar una fila de historial por cada orden transicionada con su destino correcto.

**R12** — CUANDO el maestro asigna desde bodega (feature 17) y una orden pasa de
`en_bodega` a `en_espera_aceptacion`, el sistema DEBE registrar la transición en el
historial.

**R13** — CUANDO el maestro rutea a bodega satélite (feature 30) y una orden pasa a
`en_ruta_bodega_satelite`, el sistema DEBE registrar la transición en el historial.

**R14** — CUANDO el adminSatélite recibe por QR (feature 33) y una orden pasa de
`en_ruta_bodega_satelite` a `en_bodega_satelite`, el sistema DEBE registrar la
transición en el historial.

**R15** — CUANDO el adminSatélite asigna a un mensajero de su zona (feature 34) y una
orden pasa de `en_bodega_satelite` a `en_espera_aceptacion`, el sistema DEBE registrar
la transición en el historial.

**R16** — CUANDO el mensajero recoge asignaciones (feature 36) y una orden pasa de
`en_espera_aceptacion` a `en_reparto`, el sistema DEBE registrar la transición en el
historial.

**R17** — CUANDO el mensajero gestiona una orden (feature 36) y ésta pasa de
`en_reparto` a `entregada`, `reprogramada`, `devuelta` o `rechazada`, el sistema DEBE
registrar la transición en el historial, dentro de la misma transacción que crea la
`gestion_orden` y limpia el puntero de gestión.

**R18** — CUANDO el cron de liberación programada (feature 46) libera una orden y ésta
pasa de `reprogramada` a `en_bodega` o `en_bodega_satelite`, el sistema DEBE registrar
la transición en el historial con actor vacío (transición del sistema) y tipo de
origen "liberación reprogramada".

**R19** — CUANDO una orden cambia de `estatus_id` por la actualización genérica del
CRUD (feature 6, `OrdenService.actualizar`), el sistema DEBE registrar la transición en
el historial (para que ninguna ruta de escritura de estado quede sin rastro).

## Contenido de cada fila

**R20** — CUANDO el sistema registra una transición, el estado de origen DEBE ser el
estado en que estaba la orden inmediatamente antes de la transición (o vacío en la
creación), y el destino el estado resultante.

**R21** — CUANDO la transición la origina una persona autenticada, el sistema DEBE
registrar su `usuario_id` como actor; CUANDO la origina el sistema (cron/job), el
actor DEBE quedar vacío.

**R22** — DONDE la transición proviene de una gestión con motivo (reprogramación,
devolución, rechazo — feature 36), el sistema DEBE registrar ese motivo en la fila del
historial; en las demás transiciones el motivo DEBE quedar vacío.

**R23** — CUANDO el sistema registra una transición, DEBE clasificarla con un tipo de
origen que distinga, como mínimo: carga masiva, creación manual, generación de guía,
asignación desde bodega, ruteo a satélite, recepción en satélite, asignación satélite,
recolección del mensajero, gestión, liberación reprogramada y ajuste de estado (CRUD).

## Contador de intentos (derivado)

**R24** — El sistema DEBE poder derivar del historial el número de intentos de entrega
fallidos de una orden (conteo de transiciones a `devuelta`), SIN mantener una columna
materializada en `orden`. (La derivación es lectura; ver F1.4-a.)

**R25** — El sistema DEBE exponer esa derivación como una consulta/función reutilizable
para que la feature 47 la lea y aplique la regla de escalado a rechazo. La feature 49
NO implementa la regla de "3 intentos → rechazo" (esa regla es de la feature 47; ver
F1.4-e).

## Consulta e interfaz de línea de tiempo

**R26** — CUANDO un actor autorizado solicita el historial de una orden, el sistema
DEBE devolver todas sus transiciones ordenadas cronológicamente, cada una con: estado
origen (o "creación"), estado destino, instante, actor (o "sistema") y motivo si lo
hay.

**R27** — El sistema DEBE autorizar la consulta del historial reusando las MISMAS
reglas de visibilidad de la orden que ya existen: maestro/admin ven cualquier orden;
`adminTienda` solo el historial de órdenes de su propia tienda; `mensajero` solo el de
órdenes que le fueron/están asignadas; `adminSatélite` solo el de órdenes de su zona.
Un actor sin visibilidad sobre la orden DEBE recibir "no encontrado"/"prohibido", sin
filtrar datos de la orden.

**R28** — La consulta del historial DEBE ejecutarse en el servidor (Server Action /
service, con datos entregados por props al componente), nunca fetcheando datos
sensibles desde el cliente.

**R29** — El sistema DEBE mostrar la línea de tiempo en el detalle de la orden como una
secuencia legible (una entrada por transición) que presente, para cada transición, el
estado destino, el timestamp, el actor (o "sistema") y el motivo cuando exista.

**R30** — MIENTRAS un rol autorizado ve la línea de tiempo, la UI DEBE presentar los
nombres/etiquetas legibles de los estados (no los UUID) reutilizando el mapeo de
etiquetas de estado existente (`estatus-label`).

## Criterios de aceptación (no funcionales / verificación)

**R31** — El sistema DEBE mantener `./init.sh` en verde: `typecheck` 0 errores, `lint`
0 errores y la suite de tests pasando, incluyendo los nuevos tests de esta feature.

**R32** — El sistema DEBE demostrar el round-trip de la migración (aplicar → revertir
con `down.sql` → reaplicar) dejando el esquema consistente (`prisma migrate status`
up-to-date).

**R33** — El sistema NO DEBE introducir regresión en ninguna de las transiciones ya
existentes (features 15/17/30/33/34/36/46): sus tests previos DEBEN seguir pasando y su
comportamiento observable (estado destino, guardas, atomicidad) DEBE ser idéntico salvo
por el rastro añadido.

**R34** — Cada `R<n>` DEBE mapear a al menos un test concreto (unit del helper/servicio,
integración por familia de transición, y RLS/round-trip de migración), documentado en
`progress/impl_49-*.md`.

---

## Preguntas abiertas (F1.4)

> Cada una con la RECOMENDACIÓN del spec_author + la alternativa. El humano decide en
> la puerta de aprobación. Nada se implementa hasta un "aprobado".

**(a) ¿Dónde vive el contador de intentos?**
- **Recomendado:** DERIVARLO del historial (contar transiciones a `devuelta` de la
  orden) mediante una consulta/función, SIN columna materializada en `orden`. Evita una
  segunda fuente de verdad y el riesgo de desincronización. La regla de escalado a
  rechazo (3 intentos) es de la feature 47, que LEE esta derivación.
- **Alternativa:** columna materializada `orden.intentos` incrementada en cada
  devolución. Más rápida de leer, pero duplica estado y puede divergir del historial.

**(b) ¿Mecanismo de captura?**
- **Recomendado:** un choke point CENTRALIZADO (helper `registrarCambioEstado` /
  `OrdenEstadoService`) que hace el append al historial en la MISMA `$transaction` que el
  cambio de estado. Riesgo: las escrituras de estado hoy viven en 11 métodos de 3
  repositorios (`OrdenRepository`, `GestionOrdenRepository`,
  `LiberacionReprogramadaRepository`) con 3 mecanismos distintos (updateMany,
  `$transaction`+update, `$executeRaw` crudo) → no hay un único método que TypeScript
  obligue a atravesar, así que "olvidar un call-site" es un riesgo real. Mitigación (ver
  `design.md §3`): (1) el inventario cerrado archivo:símbolo de `design.md §2`; (2) un
  test por familia de transición que afirma que quedó rastro; (3) un test de "cobertura"
  que enumera los 11 puntos. Se evalúa además si conviene un ÚNICO método
  `transicionar(tx, ...)` que todos invoquen.
- **Alternativa 1:** instrumentar cada call-site a mano sin helper compartido → máximo
  riesgo de olvido y de rastros inconsistentes.
- **Alternativa 2 (descartada, ver design):** trigger Postgres `AFTER UPDATE OF
  estatus_id` — único choke point real a nivel DB, pero no captura limpiamente actor /
  motivo / tipo de origen (contexto de aplicación).

**(c) ¿Forma de la tabla?**
- **Recomendado:** tabla nueva `orden_historial_estado` append-only e inmutable
  (`orden_id`, `estatus_origen_id` nullable, `estatus_destino_id`, `actor_usuario_id`
  nullable, `origen_tipo` enum, `motivo` nullable, `created_at`), con índice
  `(orden_id, created_at)` y RLS. Columnas y enum en `design.md §1`.
- **Alternativa (descartada, ver design):** reusar/extender `gestion_orden` — solo cubre
  las 4 transiciones del mensajero, no las 7 de asignación/ruteo/recepción/liberación, y
  mezcla evidencias/montos con trazabilidad.

**(d) ¿Backfill de órdenes existentes?**
- **Recomendado:** SIN backfill retroactivo. El historial arranca desde el deploy de la
  feature; las órdenes previas no tienen líneas anteriores (su línea de tiempo empieza en
  su próxima transición). Evita inventar timestamps/actores que no ocurrieron.
- **Alternativa:** sembrar una fila inicial con el estado ACTUAL de cada orden existente
  (origen vacío, actor "sistema", `created_at` = ahora). Da una línea de tiempo no vacía
  para órdenes viejas, pero con un timestamp ficticio.

**(e) ¿Alcance 49 vs 47?**
- **Recomendado:** la 49 entrega SOLO el historial + el derivador de conteo de intentos
  (R24/R25). La feature 47 consume ese derivador y aplica la regla "≥3 intentos fallidos
  → escala a `rechazada`". Así la 49 no se solapa con la 47.
- **Alternativa:** que la 49 ya materialice/exponga el escalado — se descarta para no
  invadir la feature 47.

**(f) ¿UI de línea de tiempo — dónde y quién la ve?**
- **Recomendado:** un componente de línea de tiempo mostrado en el DETALLE de la orden.
  Como hoy NO existe página de detalle (las órdenes se ven en lista), se añade una
  superficie de detalle mínima: un drawer/modal "Ver historial" abierto desde la lista
  de órdenes, que pre-fetchea el historial vía Server Action (patrón "etiquetas" /
  datos por props). Visibilidad por rol reutilizando la autorización de la orden (R27):
  maestro/admin (todas), adminTienda (su tienda), mensajero (sus asignadas),
  adminSatélite (su zona). Relación con la feature 35 (realtime): FUERA DE ALCANCE; la
  línea de tiempo se lee bajo demanda y se deja el punto de extensión para que la 35
  suscriba actualizaciones.
- **Alternativa:** una ruta dedicada `app/(app)/ordenes/[id]/page.tsx` (Server
  Component) como página de detalle completa — mayor cambio de navegación; candidata a
  follow-up.

**(g) ¿Se registra el estado inicial (creación) como primera línea?**
- **Recomendado:** SÍ para las órdenes creadas DESPUÉS del deploy (R9/R10): la creación
  es la transición `vacío → estado inicial` y es la primera entrada de su línea de
  tiempo. Consistente con "todos los estados por los que pasó".
- **Alternativa:** que el historial arranque en la primera transición POST-creación
  (línea de tiempo sin el estado inicial) — se descarta por incompletitud.
