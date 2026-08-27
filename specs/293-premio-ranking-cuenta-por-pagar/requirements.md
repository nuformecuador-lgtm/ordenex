# 293 — El maestro registra el premio del ranking en la cuenta por pagar del mensajero

Requisitos en notación EARS. Sin detalles de implementación (esos van en `design.md`).
Cada `R<n>` queda mapeado a un test concreto en `tasks.md`.

## Contexto cerrado (no se reabre)

De la `status_note` de la ficha (2026-08-27):

- (a) el pago **no es automático**: siempre hay un acto humano;
- (b) **una sola puerta**: `Wallet > Mensajeros`;
- (c) el premio **suma a la cuenta por pagar**; no es un pago suelto;
- (d) en el detalle debe verse **qué parte** de la cuenta es premio → categoría propia;
- (e) el monto sale del **podio congelado**, no del premio vigente;
- guarda no negociable: **un premio por (mensajero, día)**, impuesto por índice único en la base;
- riesgo declarado: con todos a 0 % el podio lo decide el orden alfabético (el 26/08 el primer
  puesto fue 0 de 21) → la pantalla muestra `entregadas / asignadas` del día.

**Decisión humana del 2026-08-27, sobre cómo se cobra:** el premio **se imputa al cierre del día
del podio** y se salda con el flujo de pago por cierre que ya existe. Se le ofrecieron tres vías
(entregar solo el devengo; abrir el pago contra saldo; imputar al cierre) y eligió imputar al
cierre. **No se reabre.**

## Vocabulario

- **Podio congelado**: filas con `posicion` 1, 2 o 3 del snapshot del ranking de una fecha
  calendario de Costa Rica, con el nombre congelado, `entregadas`, `asignadas`, el monto del premio
  y su descripción tal como quedaron ese día.
- **Cierre del día del podio**: el cierre del día de ese mensajero que agrupa las gestiones de esa
  fecha. Su resolución exacta está en `design.md §4`.
- **Libro del mensajero**: registro append-only por mensajero del que se deriva la cuenta por pagar
  (Σ devengo − Σ pago). Filas inmutables.
- **Lo pagable de un cierre**: cuánto de ese cierre sigue sin entregarse al mensajero. Hoy sale de
  su snapshot; con esta feature suma además los premios imputados vivos.
- **Premio vivo**: registrado y no anulado.
- **Acceso total**: cómo se expresa hoy «solo el maestro» en Wallet (`maestro` y `admin`, paridad de
  la feature 94). Ver `design.md §8`.

---

## Alcance y permisos

**R1** — El sistema DEBE ofrecer el registro del premio del podio **únicamente** desde la pantalla de
cuentas por pagar a mensajeros (`Wallet > Mensajeros`), y desde ninguna otra pantalla, ruta, webhook
ni tarea programada.

**R2** — MIENTRAS el actor no tenga acceso total, el sistema DEBE responder `forbidden` a toda
solicitud de lectura del panel de premios, de registro y de anulación, sin escribir nada y sin
exponer ningún monto ni ningún nombre.

**R3** — El sistema NO DEBE emitir ningún movimiento de premio sin un acto humano explícito: ni una
tarea programada, ni la aprobación de un cierre, ni el congelado diario del ranking pueden
producirlo.

## Lectura del podio de un día

**R4** — CUANDO el actor con acceso total elige una fecha, el sistema DEBE mostrar las filas del
podio **congelado** de esa fecha, ordenadas por posición ascendente, con posición, nombre congelado
del mensajero, `entregadas`, `asignadas`, monto y descripción del premio, tal como se congelaron.

**R5** — SI una fila del podio tiene `entregadas` en cero, o `asignadas` en cero, ENTONCES el sistema
DEBE mostrar igualmente el par `entregadas / asignadas` junto al premio, sin ocultarlo ni
sustituirlo, y DEBE seguir permitiendo el registro: la decisión es humana, con el dato delante.

**R6** — SI la fecha elegida no tiene podio congelado, ENTONCES el sistema DEBE decirlo de forma
explícita y NO DEBE ofrecer ninguna acción de registro para esa fecha.

**R7** — SI una fila del podio no tiene premio (monto ausente o cero), ENTONCES el sistema NO DEBE
ofrecer su registro, y SI aun así se solicita, ENTONCES DEBE rechazarlo sin escribir nada.

**R8** — SI la fecha solicitada no es una fecha calendario válida, o es posterior a hoy en Costa
Rica, ENTONCES el sistema DEBE rechazar la petición en el borde, sin consultar ni escribir datos.

**R9** — El sistema DEBE mostrar, por cada fila del podio, en cuál de estos estados está su premio:
sin premio, **sin cierre de ese día**, **cierre no aprobado**, no registrado, registrado o anulado;
y DEBE derivarlo de los datos, no de un estado almacenado aparte.

## Imputación al cierre

**R10** — CUANDO el actor con acceso total registra el premio de una fila del podio, el sistema DEBE
imputarlo al **cierre del día del podio** de ese mensajero, de modo que el movimiento quede
vinculado a ese cierre y se vea bajo él en el desglose.

**R11** — SI ese mensajero no tiene ningún cierre para el día del podio, ENTONCES el sistema NO DEBE
registrar el premio y DEBE explicar exactamente esa causa —que no hay cierre de ese día—, nunca un
error genérico.

**R12** — SI el cierre del día del podio existe pero no está aprobado, ENTONCES el sistema NO DEBE
registrar el premio y DEBE explicar exactamente esa causa, nombrando el estado en que está.

**R13** — El sistema NO DEBE modificar `total_pago_mensajero` ni ningún otro total congelado del
cierre, ni al registrar el premio ni al anularlo: el snapshot sigue diciendo lo que dijo el día en
que se aprobó.

## Registro del premio

**R14** — CUANDO se registra el premio, el sistema DEBE escribir en el libro de ese mensajero **un**
movimiento de tipo devengo con una **categoría propia de premio**, distinta de las categorías de
ajuste y de las que emite el cierre.

**R15** — El monto del movimiento DEBE ser el monto **congelado** en esa fila del podio, y NO DEBE
depender del premio vigente en la tabla de premios del ranking en el momento del registro.

**R16** — El mensajero y la fecha del premio DEBEN salir de la fila congelada del podio; la petición
del cliente solo identifica **cuál** fila se registra, y ningún monto, mensajero, cierre ni fecha
recibidos del cliente pueden influir en lo que se escribe.

**R17** — El sistema DEBE admitir **como máximo un premio por (mensajero, día del podio)**, y esa
unicidad DEBE estar impuesta por un índice único en la base de datos, no solo por una comprobación
del servicio.

**R18** — CUANDO se solicita registrar un premio que ya está registrado, el sistema DEBE responder
«ya registrado», sin crear una segunda fila, sin modificar la existente y sin devolver un error.

**R19** — SI dos días de podio distintos se imputan al **mismo** cierre, ENTONCES el sistema DEBE
registrar los dos premios: la unicidad es por (mensajero, día), nunca por cierre.

**R20** — CUANDO se registra el premio, el sistema DEBE emitir además, en la **misma transacción**,
un egreso en la caja principal por el mismo monto y con la categoría con la que hoy sale de la caja
el pago a un mensajero; SI cualquiera de las dos escrituras falla, ENTONCES no DEBE quedar ninguna de
las dos.

**R21** — El sistema NO DEBE actualizar ni borrar ninguna fila ya escrita en el libro del mensajero
ni en la caja: toda corrección es un movimiento nuevo.

**R22** — El movimiento de premio DEBE dejar rastro de quién lo registró, y su descripción DEBE
nombrar la fecha del podio, la posición y la descripción congelada del premio.

**R23** — El sistema DEBE fechar el movimiento del premio con el **instante del registro**, no con la
fecha del podio, de modo que un registro de hoy no altere el dinero ya leído de un día pasado.

## Lo pagable del cierre

**R24** — Lo pagable de un cierre aprobado DEBE ser lo que su snapshot dejó pendiente, **más** los
premios vivos imputados a ese cierre, **menos** los pagos vigentes registrados contra él.

**R25** — El premio NO DEBE entrar en la regla que acota el pago con el efectivo recaudado del día:
ese efectivo nunca contuvo el premio, así que un cierre con efectivo de sobra NO DEBE dar el premio
por entregado.

**R26** — Toda superficie que responda «cuánto se le debe por este cierre» o «¿está saldado este
cierre?» DEBE usar el mismo cálculo, derivado en un único sitio; ninguna DEBE calcularlo por su
cuenta.

**R27** — CUANDO se registra un premio contra un cierre que ya estaba saldado, el sistema DEBE
volver a mostrarlo como pendiente por el importe del premio, tanto en el listado de cierres como en
lo que el diálogo de pago ofrece saldar.

**R28** — La conciliación entre el snapshot del cierre y el dinero movido por su aprobación DEBE
seguir comparando exactamente lo que ese cierre movió al aprobarse; los movimientos de premio y sus
compensaciones NO DEBEN contarse en esa comparación.

## Corrección: anulación del premio

**R29** — CUANDO el actor con acceso total anula un premio registrado, el sistema DEBE escribir un
movimiento **compensatorio** por el mismo monto en el libro del mensajero y su reverso en la caja
principal, en la misma transacción, dejando el efecto neto en cero y sin tocar las filas originales.

**R30** — SI la anulación llega sin motivo, o con un motivo vacío, ENTONCES el sistema DEBE
rechazarla en el borde sin escribir nada; el motivo DEBE quedar registrado en el movimiento
compensatorio.

**R31** — CUANDO se solicita anular un premio ya anulado, el sistema DEBE responder «ya anulado», sin
escribir una segunda compensación y sin devolver un error.

**R32** — MIENTRAS un premio esté anulado, el sistema NO DEBE permitir volver a registrarlo para ese
mismo (mensajero, día), y la pantalla DEBE decirlo con texto, no con la ausencia del control.

**R33** — CUANDO se anula un premio, lo pagable de su cierre DEBE bajar en el mismo importe; SI ese
cierre no tenía otra deuda, ENTONCES DEBE volver a quedar saldado.

## Presentación

**R34** — CUANDO el actor con acceso total abre el desglose de un mensajero, el sistema DEBE mostrar
los movimientos de premio con un rótulo propio, distinguible del de los ajustes, y bajo el cierre al
que se imputaron; lo mismo DEBE ver el mensajero en su propia vista de pagos, y ambas descargas DEBEN
llevar el mismo rótulo.

**R35** — El sistema DEBE mover todos los importes de esta feature como texto de escala 2 entre
servidor y cliente, sin aritmética de coma flotante en ninguna capa.

---

## Fuera de alcance (declarado)

1. **El criterio del ranking y el podio.** No se toca el orden, ni el umbral, ni la regla de podio,
   ni el congelado diario. Que el primer puesto pueda salir con 0 de 21 es un hecho declarado (R5 lo
   pone a la vista), no un defecto a corregir aquí.
2. **El cálculo y la aprobación del cierre.** No se recalcula ni se reescribe ningún snapshot (R13).
   Lo único que cambia del mundo del cierre es **lo pagable**, que ya era derivado.
3. **Cualquier automatización.** Ni cron, ni emisión al aprobar un cierre, ni al congelar el ranking.
4. **El pago retroactivo por lote.** Un premio por acto humano; no hay «registrar todos los premios
   pendientes desde tal fecha».
5. **La edición del premio vigente** (`Ranking > Premios`), que ya existe y no cambia.
6. **Crear un cierre que no existe.** Si no hay cierre de ese día, el premio no se registra (R11);
   esta feature no crea cierres ni cambia su estado.

---

## Preguntas abiertas

**Q1 — El día sin gestiones no tiene cierre, y puede tener podio.** La resolución del cierre se apoya
en las gestiones de esa fecha (`design.md §4`). Un mensajero puede ocupar podio con `0` entregadas
—pasó el 26/08— y, si además no gestionó nada ese día, **no habrá cierre** al que imputar: R11
bloquea el registro con su mensaje. ¿Se acepta que ese premio quede sin registrar hasta que exista un
cierre, o el negocio quiere otra vía para ese caso?

**Q2 — ¿Se acepta que anular consuma el cupo para siempre?** Con la unicidad de R17 impuesta por la
base sobre (mensajero, día), registrar → anular → **volver a registrar** es imposible. Es coherente
con la guarda no negociable y con la inmutabilidad; R32 lo hace explícito en pantalla en vez de
dejarlo como sorpresa. Cambiarlo obliga a cambiar la guarda.

**Q3 — Antigüedad máxima.** No hay tope: se puede elegir cualquier fecha pasada con podio congelado.
¿Se quiere un tope (por ejemplo 30 días) para que no se registren premios de meses atrás por error?

**Q4 — Rótulo visible.** El diseño propone «Premio del ranking» en el desglose y en la descarga. Si
hay un término preferido por el negocio, se cambia solo el rótulo (no la categoría).

**Q5 — Dos cierres para el mismo día.** No hay restricción en la base que lo impida (medido:
`cierre_dia` no tiene ningún índice único). La resolución elige el más antiguo por
`solicitado_at` y desempata por `id` (`design.md §4`). ¿Es el criterio que el negocio espera?
