# Feature 205 — Pagar la cuenta por pagar del mensajero desde `/wallet/mensajeros`

**Requisitos en notación EARS.** Sin detalles de implementación (esos van en `design.md`).
Cada `R<n>` termina mapeado a un test concreto (`docs/specs.md > Trazabilidad`); el mapa vive
en `design.md §12` y lo verifica el reviewer.

---

## Punto de partida — verificado en el código, no supuesto

Cada línea se releyó en esta rama antes de apoyarse en ella:

- **R21 de la 172 no se toca**: `lib/services/LiquidacionService.ts:214` escribe literalmente
  `cierreId: cierre.id, // R21: el pago al mensajero va SIEMPRE atado a un cierre`.
- El **bloqueo de concurrencia es POR CIERRE**:
  `this.pagoRepo.bloquearBeneficiario(tx, { tipo: "cierre", cierreId: input.cierreId })`
  — `LiquidacionService.ts:193`. El grano lo declara `BeneficiarioBloqueo`
  (`ILiquidacionPagoRepository.ts:42`).
- `registrarPagoMensajero` **ya rechaza por su cuenta**: `no_encontrado` (`:198`),
  `cierre_no_aprobado` (`:199`), `sin_saldo` (`:204`) y `excede` **devolviendo `disponible`**
  (`:205-208`). Ese `disponible` es el pendiente derivado del cierre.
- El pendiente de un cierre es **derivado, nunca almacenado**:
  `derivarPendienteCierre(P, E, Σ pagos vigentes)` — `lib/utils/pendiente-cierre.ts:28`,
  sobre `calcularSplitPago` (`lib/utils/cuenta-por-pagar.ts:22`).
- La cuenta por pagar de la pantalla es **un agregado derivado** `Σ devengo − Σ pago`
  — `derivarCuentaPorPagar`, `lib/utils/cuenta-por-pagar.ts:45`. Nunca un saldo mutable.
- En el libro del mensajero, **devengo y pago del cierre llevan `origenId = cierreId`**
  (`WalletMensajeroFeedService.ts:56` y `:69`), y el pago de la liquidación lleva
  `origenTipo: "pago_mensajero"`, `origenId = <id del pago>` (`LiquidacionService.ts:231-232`).
- El libro **se escribe al APROBAR** el cierre (`WalletMensajeroFeedService`, dentro de la
  transacción de aprobación): un cierre no aprobado no ha devengado nada todavía.
- **NO existe ruta ni enlace profundo a un cierre**: `app/(app)/cierres-admin/page.tsx` es UNA
  página y el detalle se abre por estado de cliente (`abrirDetalle(cierreId)`,
  `CierresAdminModule.tsx:341`), que pide `verCierreDetalle({ cierreId })` **por id** — no lee
  la fila de ninguna tabla. La URL no cambia.
- `CierresAdminModule` ya maneja `setOfertaPago({ cierreId, mensajeroNombre, pendiente })`
  (`:444`) y monta el diálogo compartido `RegistrarPagoDialog`.
- El precedente exacto de «pagar desde la wallet» es la tienda:
  `app/(app)/wallet/tiendas/_components/PagoTiendaAcciones.tsx`, montado **dentro del desglose
  expandido**, no en una columna de la tabla.
- La clave de idempotencia se acuña **al abrir el diálogo** y se conserva entre reintentos
  — `components/shared/liquidacion/RegistrarPagoDialog.tsx:197-219` +
  `clave-idempotencia.ts`. La barrera es el `@unique` de
  `liquidacion_pago.clave_idempotencia` (`db/schema.prisma:1310`).
- El barrido money-safe (`tests/unit/guards/liquidacion-money-safe.test.ts`) tiene un censo
  explícito **y** una cláusula que lo mantiene vivo: todo archivo bajo
  `components/shared/liquidacion/` y todo archivo de `lib/**` cuya ruta case
  `/[Ll]iquidacion/` **tiene que estar en el censo o el test cae** (`:139-146`).
- `CierreDia` tiene `solicitadoAt` y `resueltoAt` (`db/schema.prisma:935-937`): son dos
  antigüedades distintas y hay que elegir una (**Q1**, resuelta: `solicitadoAt`).
- El barrido money-safe prohíbe `parseInt(` con `\b` por delante
  (`tests/fixtures/money-safe.ts:37-42`), y `Number.parseInt(` **casa** con esa expresión. Eso
  ata el nombre del módulo de configuración del tope (`design.md §2.5.2`): si su ruta contuviera
  `liquidacion`, la auto-captura lo metería en el censo y el barrido caería por un falso
  positivo sobre un cardinal que no es dinero.
- `liquidacion_pago.referencia` es `String?` **sin `@unique`** (`db/schema.prisma:1316`) y
  `LiquidacionPagoRepository` no consulta por ella (sus lecturas puntuales son `findUnique` por
  id, `:186`, `:248`, `:257`). Es el punto de partida de la verificación de R58, no su prueba.

---

## Glosario (vocabulario cerrado, para que los requisitos no se interpreten)

- **Pendiente de un cierre**: `min(P, E) − Σ pagos vigentes contra ese cierre`, derivado.
  `P = total_pago_mensajero`, `E = total_efectivo` (snapshots del propio cierre).
- **Pago vigente**: pago sin fila de anulación.
- **Cierre imputable**: cierre del mensajero con estado `aprobado` **y** pendiente > 0.
- **Total imputable**: suma de los pendientes de los cierres imputables de ese mensajero.
- **Antigüedad de un cierre**: la fecha del **día trabajado** —cuándo el mensajero pidió el
  cierre—, no la fecha en que un administrador lo resolvió (enmienda Q1; el porqué, en
  `design.md §2.4`).
- **Tope de imputaciones**: número máximo de cierres que UN reparto puede tocar. Es
  configuración, vale 50 mientras nadie lo cambie (enmienda Q2).
- **Ventana de imputación**: los primeros `min(tope, nº de cierres imputables)` cierres
  imputables en el orden de R8. Es sobre lo que un reparto puede escribir.
- **Imputable de la ventana**: suma de los pendientes de la ventana. Es el importe máximo que
  UN reparto admite, y es lo que un rechazo por exceso informa como disponible.
- **Cierre recortado**: cierre **imputable** que queda fuera de la ventana por el tope. No es lo
  mismo que un cierre excluido: el recortado sí es pagable, pero en otro reparto.
- **Reparto**: la operación de tomar UN importe y convertirlo en N pagos, uno por cierre.
- **Imputación**: la parte del importe que va a UN cierre concreto dentro de un reparto.
- **Imputación parcial**: imputación de importe menor que el pendiente de su cierre.
- **Cierre excluido**: cierre del mensajero que NO es imputable por no estar `aprobado`.
- **Previsualización**: el reparto que se produciría con el importe tecleado, calculado en el
  servidor y sin efecto alguno.
- **Reparto aplicado**: el reparto que de verdad se escribió, recalculado bajo bloqueo.
- **Actor pagador**: usuario con rol de acceso total (`maestro` / `admin`).

---

## A. Alcance, permisos y superficie

**R1** — MIENTRAS el actor no sea actor pagador, el sistema NO DEBE registrar ningún reparto,
NO DEBE previsualizar ninguno y NO DEBE devolver ningún importe del mensajero: solo un rechazo
por permiso.

**R2** — SI la petición llega sin sesión, ENTONCES el sistema DEBE rechazarla **antes** de
evaluar cualquier otro dato de la petición.

**R3** — El sistema DEBE permitir registrar el pago de la cuenta por pagar de un mensajero
**desde `/wallet/mensajeros`**, sin exigir navegar a otra pantalla para completarlo.

**R4** — El sistema DEBE resolver el permiso de pagar en el SERVIDOR con el mismo predicado de
acceso total que ya gobierna el pago contra un cierre; ocultar el control en la pantalla NO
DEBE ser la única barrera.

## B. Qué se puede pagar (conjunto imputable)

**R5** — El sistema DEBE considerar imputables EXACTAMENTE los cierres del mensajero cuyo
estado es `aprobado` y cuyo pendiente es mayor que cero.

**R6** — El sistema DEBE derivar el pendiente de cada cierre y el total imputable en cada
lectura, a partir de los datos del cierre y de sus pagos vigentes; NO DEBE leer ni escribir
ningún saldo acumulado almacenado.

**R7** — El sistema DEBE tratar un pago anulado como no realizado al derivar el pendiente de
su cierre.

**R8** — El sistema DEBE imputar del cierre **más antiguo al más reciente** por la **antigüedad
del cierre** (el día trabajado), NO por la fecha en que se resolvió; y el orden DEBE ser
totalmente determinista: dos ejecuciones sobre los mismos datos DEBEN producir el mismo orden,
incluso cuando dos cierres comparten instante de antigüedad.

**R9** — El sistema NO DEBE admitir que la petición de reparto elija contra qué cierre se
imputa; SI la petición nombra un cierre, ENTONCES DEBE rechazarse en el borde sin tocar datos.

## C. Cálculo del reparto

**R10** — CUANDO se reparte un importe, el sistema DEBE imputar a cada cierre **de la ventana de
imputación**, en el orden de R8, el menor entre lo que queda del importe y el pendiente de ese
cierre.

**R11** — El sistema DEBE imputar hasta agotar el importe, y a lo sumo UNA imputación —la
última— DEBE poder ser parcial.

**R12** — El sistema NO DEBE producir imputaciones de importe cero ni negativo: un cierre que
no recibe nada no aparece en el reparto.

**R13** — CUANDO el importe no supera el **imputable de la ventana**, la suma de las
imputaciones DEBE ser exactamente igual al importe solicitado: el reparto NO DEBE crear ni
perder un céntimo.

**R14** — SI el importe supera el **imputable de la ventana**, ENTONCES el sistema DEBE rechazar
la operación entera, DEBE informar del imputable de la ventana vigente y NO DEBE escribir nada.

**R15** — SI el total imputable es cero, ENTONCES el sistema DEBE rechazar informando que no
hay nada que imputar y NO DEBE escribir nada.

**R16** — El sistema DEBE hacer TODA la aritmética del reparto en el servidor con aritmética
decimal exacta; NO DEBE convertir ningún importe a número de coma flotante en ningún punto, y
el cliente NO DEBE derivar ningún importe.

**R17** — El cálculo del reparto DEBE poder ejercitarse sin base de datos: dado un importe y
una lista de cierres con su pendiente, el resultado DEBE quedar determinado.

## D. Escritura, atomicidad y concurrencia

**R18** — CUANDO una imputación se aplica, el sistema DEBE registrar un pago **atado al cierre
de esa imputación**, con la misma forma documental que el pago contra un cierre único.

**R19** — CUANDO una imputación se aplica, el sistema DEBE escribir su movimiento en el libro
del mensajero enlazado a ese documento de pago, igual que el pago contra un cierre único.

**R20** — El sistema DEBE aplicar el reparto **todo o nada**: SI cualquier imputación falla,
ENTONCES no DEBE quedar ni un pago, ni un movimiento, ni ningún rastro del reparto.

**R21** — MIENTRAS se aplica el reparto, el sistema DEBE mantener tomado sobre CADA cierre que
toca el mismo bloqueo que toma el pago contra un cierre único, y NO DEBE sustituirlo por un
bloqueo de otro grano.

**R22** — El sistema DEBE adquirir esos bloqueos en el mismo orden determinista en toda
ejecución.

**R23** — El sistema DEBE releer el pendiente de cada cierre **bajo bloqueo** y aplicar el
reparto recalculado con esos valores; una previsualización anterior NO DEBE decidir ningún
importe.

**R24** — El sistema NO DEBE imputar, en el instante de la escritura, a un cierre que no esté
`aprobado` ni a un cierre de otro mensajero, aunque lo estuviera al previsualizar.

**R25** — CUANDO el reparto se aplica, el sistema DEBE devolver el reparto **realmente
aplicado**: qué cierre recibió cuánto y qué pendiente le queda a cada uno.

**R26** — El sistema NO DEBE modificar ningún dato del cierre: para esta operación los datos
del cierre son de solo lectura.

## E. Idempotencia

**R27** — La petición de reparto DEBE llevar una clave de idempotencia acuñada al **abrir** el
formulario, no al enviarlo.

**R28** — CUANDO llega una segunda petición con una clave ya usada, el sistema NO DEBE
registrar ningún pago nuevo y DEBE devolver el resultado del reparto original.

**R29** — La protección contra la repetición DEBE apoyarse en una **restricción de datos**, no
en una lectura previa que decida si escribir.

**R30** — CUANDO el usuario abre el formulario de nuevo, el sistema DEBE tratar la petición
siguiente como un pago distinto, aunque coincidan mensajero, importe, método y fecha.

**R31** — SI una petición falla (red o rechazo del servidor), ENTONCES el reintento DEBE
viajar con la MISMA clave.

## F. Previsualización

**R32** — ANTES de confirmar, el sistema DEBE mostrar, para el importe tecleado, a qué cierres
se imputaría y cuánto a cada uno.

**R33** — La previsualización DEBE marcar la imputación parcial y DEBE decir cuánto le queda
pendiente a ese cierre después del pago.

**R34** — Todos los importes de la previsualización DEBEN llegar ya derivados del servidor
como texto; el cliente NO DEBE calcularlos ni recomponerlos.

**R35** — La previsualización NO DEBE escribir nada: ni pago, ni movimiento, ni rastro del
reparto.

**R36** — La previsualización DEBE informar de los cierres **excluidos** por no estar
aprobados, identificándolos y diciendo su estado, de modo que no desaparezcan en silencio.

**R37** — SI el total imputable es menor que la cuenta por pagar del mensajero, ENTONCES la
previsualización DEBE advertirlo (hay deuda que esta pantalla no puede imputar).

**R38** — SI el importe tecleado supera el **imputable de la ventana**, ENTONCES la
previsualización DEBE decirlo antes de que el usuario confirme.

## G. El cierre, direccionable

**R39** — El sistema DEBE ofrecer una dirección **estable, compartible y recargable** que abra
el detalle de UN cierre concreto.

**R40** — CUANDO se navega a esa dirección, el sistema DEBE abrir el detalle de ESE cierre sin
depender de la tabla, la página ni el filtro desde los que se llegó.

**R41** — SI el cierre no existe o queda fuera del alcance del actor, ENTONCES el sistema DEBE
informarlo sin exponer dato alguno del cierre y sin dejar la pantalla rota.

**R42** — El enlace NO DEBE ampliar permisos: la pantalla de destino DEBE aplicar su propio
control de acceso, el mismo que aplica hoy.

**R43** — CUANDO una fila del desglose de `/wallet/mensajeros` corresponde a un cierre
identificable, el sistema DEBE ofrecer en esa fila el enlace a su detalle; SI la fila no
identifica ningún cierre, ENTONCES NO DEBE ofrecer enlace.

**R44** — Cada cierre nombrado en la previsualización y en el resultado del reparto DEBE
ofrecer el mismo enlace a su detalle.

**R45** — CUANDO se cierra un detalle que se abrió por enlace, el sistema DEBE dejar la
dirección sin ese cierre, de modo que recargar la pantalla no lo reabra.

## H. Frontera, datos y no regresión

**R46** — Todo importe que cruce del servidor al cliente DEBE viajar como texto con dos
decimales.

**R47** — El borde DEBE validar la petición y rechazar cualquier clave desconocida **antes**
de tocar datos.

**R48** — El comprobante de pago DEBE seguir sin emitir identificadores internos salvo el
suyo; los contratos NUEVOS del reparto SÍ DEBEN emitir el identificador del cierre, que es lo
que hace direccionable su detalle, y NO DEBEN emitir identificadores de personas.

**R49** — Toda estructura de datos nueva DEBE crearse con migración **aditiva** y reversible
(`migration.sql` + `down.sql`) y con seguridad a nivel de fila habilitada; la migración NO
DEBE alterar, renombrar ni borrar nada preexistente.

**R50** — El módulo que calcula el reparto DEBE quedar sujeto al barrido money-safe de la
liquidación, de modo que renombrarlo, moverlo o sacarlo del censo ponga rojo el barrido.

**R51** — El pago contra UN cierre desde `/cierres-admin` DEBE conservar su comportamiento
observable: mismos estados de respuesta, mismas filas escritas y mismo bloqueo.

**R52** — El sistema NO DEBE ofrecer ninguna forma de editar ni de borrar un reparto ni sus
pagos; la única corrección posible DEBE seguir siendo anular cada pago y registrar de nuevo.

## I. Enmienda del 2026-08-11 — tope y captura única

Requisitos añadidos al plegar las respuestas a las preguntas abiertas. Cada uno dice qué
sección extiende; los de arriba que cambiaron con ellos son R8 (Q1), R10, R13, R14 y R38 (Q2).

**R53** *(extiende C)* — El sistema DEBE limitar a un máximo el número de cierres que UN reparto
puede tocar; ese máximo DEBE estar definido en un único punto de configuración, DEBE valer 50
mientras nadie lo cambie y DEBE poder cambiarse sin tocar el cálculo del reparto.

**R54** *(extiende C)* — SI el número de cierres imputables del mensajero supera ese máximo,
ENTONCES el sistema DEBE formar la ventana con los primeros en el orden de R8 hasta ese máximo
y DEBE seguir admitiendo la operación; NO DEBE rechazarla por ese motivo.

**R55** *(extiende D)* — El sistema NO DEBE tomar bloqueo ni escribir fila alguna sobre un
cierre imputable que quede fuera de la ventana: el número de cierres bloqueados y el de
imputaciones escritas por un reparto DEBEN quedar acotados por el máximo de R53.

**R56** *(extiende F)* — SI algún cierre imputable queda fuera de la ventana, ENTONCES la
previsualización DEBE decir cuántos cierres entran, cuántos quedan fuera y cuánto suman los
pendientes de los que quedan fuera; ese aviso DEBE ser distinguible del de R37, que habla de
deuda que no cuelga de ningún cierre.

**R57** *(extiende C y F)* — El sistema DEBE usar el mismo máximo al previsualizar y al escribir;
NO DEBE existir camino que impute a más cierres de los que la previsualización declaró incluidos.

**R58** *(extiende D)* — CUANDO un reparto se aplica, el sistema DEBE registrar en TODAS sus
imputaciones el mismo método, la misma referencia y la misma fecha de pago, capturados UNA sola
vez para el reparto entero; NO DEBE derivar, alterar ni inventar una referencia distinta por
cierre.

---

## Preguntas abiertas — RESUELTAS el 2026-08-11

Las cinco están contestadas por el humano y plegadas al spec. Se conserva el enunciado original
porque explica de dónde sale cada decisión; debajo de cada una, la respuesta y dónde vive.

| # | Respuesta | Dónde quedó |
| --- | --- | --- |
| Q1 | `solicitado_at` asc, desempate por id — **confirmado** | R8 (precisado) · `design.md §2.4` |
| Q2 | Tope 50 configurable que **recorta**, no rechaza | R53–R57, R10/R13/R14/R38 · `design.md §2.5` |
| Q3 | Anulación pago a pago — **fuera de alcance, confirmado** | R52 (sin cambios) · `design.md §10.5` |
| Q4 | Una referencia, copiada en los N pagos | R58 · `design.md §5.4` + tarea de verificación T0.5 |
| Q5 | Se advierte y no se paga — **confirmado con medición** | R37 (sin cambios) · `design.md §10.2` |

**No quedan preguntas abiertas.** Lo que sigue es el enunciado original de cada una.

### Enunciado original

Ninguna se rellenó con un supuesto (`CLAUDE.md > No inventes`). Las cinco fueron al humano; para
cada una se indicaba **qué se escribió mientras tanto** y qué costaría cambiarlo. Debajo de cada
enunciado va ahora la respuesta recibida.

**Q1 — ¿Qué antigüedad ordena el FIFO de R8: `solicitado_at` o `resuelto_at`?**
D1 dice «el cierre aprobado más antiguo primero». `cierre_dia` tiene las dos marcas y NO
coinciden: `solicitado_at` es cuándo el mensajero cerró su día (≈ el día trabajado) y
`resuelto_at` es cuándo el admin lo aprobó. Un cierre del lunes aprobado el viernes es el más
antiguo por una y el más nuevo por la otra. *Escrito mientras tanto:* `solicitado_at` ascendente
(el día trabajado es lo que una persona llama «el cierre más viejo»), con desempate por
identificador ascendente para que R8 sea determinista de verdad. Cambiarlo cuesta una línea del
comparador y sus tests: no arrastra esquema.
**Respuesta (2026-08-11): confirmado, queda `solicitado_at` asc + id asc.** Es la fecha del
TRABAJO, que es lo que el mensajero percibe como deuda; `resuelto_at` depende de la latencia
administrativa. El razonamiento completo, en `design.md §2.4`. R8 se precisó para nombrar la
antigüedad sin ambigüedad.

**Q2 — ¿Hay tope al número de cierres que un solo reparto puede tocar?**
El reparto escribe `2·N` filas dentro de UNA transacción (R20). Con la deuda acumulada de meses,
`N` podría ser grande y una transacción interactiva de Prisma tiene tiempo máximo. *Escrito
mientras tanto:* NO se pone tope y se declara el riesgo en `design.md §10`; el `N` real está
acotado por el importe (solo entran los cierres que el importe alcanza). Si el humano prefiere
un tope, es una constante y un estado de rechazo nuevo, y hay que decidir el número.
**Respuesta (2026-08-11): SÍ hay tope, pero NO bloquea.** 50 por defecto, configurable en
`lib/config/` (patrón `gasto-fijo.ts`). Al superarlo se imputa sobre los 50 más antiguos y, si el
importe excede lo que ESOS cubren, se responde `excede` con el `disponible` — la semántica que el
servicio ya tiene, sin estado nuevo. La previsualización enseña el recorte. Un tope que corta la
operación en seco es un callejón sin salida; uno que acota y avisa, no. → R53–R57 y
`design.md §2.5`.

**Q3 — ¿Anular un reparto entero, o pago a pago como hoy?**
Hoy `anularPago` anula UN pago. Tras un reparto de 4 imputaciones, deshacerlo son 4 anulaciones
con 4 motivos. *Escrito mientras tanto:* fuera de alcance — se anula pago a pago, exactamente
como hoy, y el reparto queda como agrupador de auditoría. Añadir «anular el reparto entero»
sería otra feature (y otra decisión: qué pasa si una de las 4 ya se anuló a mano).
**Respuesta (2026-08-11): fuera de alcance, confirmado.** No es un fallo de corrección —cada
anulación escribe su contraasiento y el dinero termina bien—, es incomodidad. `reparto_id` es lo
que mantiene la puerta abierta para agruparlas. Ficha aparte, sin urgencia. → `design.md §10.5`.

**Q4 — Método y referencia únicos para N pagos.**
El reparto captura un método y una referencia y los copia en las N filas: una referencia de
SINPE aparecerá repetida en 3 comprobantes. *Escrito mientras tanto:* se copia tal cual (es lo
que de verdad ocurrió: una transferencia que salda tres cierres). Si conciliación necesita
referencia por cierre, el formulario tendría que pedir N referencias y el reparto dejaría de ser
un solo acto.
**Respuesta (2026-08-11): UNA sola, copiada en los N pagos.** Es la verdad: hubo una
transferencia y un número de comprobante; inventar una referencia por cierre sería fabricar un
dato que no existe. Además favorece la conciliación (se busca la referencia y aparecen las N
imputaciones). → R58 y `design.md §5.4`. Lleva **tarea de verificación** T0.5: comprobar que nada
del árbol asuma referencia única por pago; si aparece algo así, se **para y se reporta**.

**Q5 — La deuda no imputable.**
El total imputable puede ser MENOR que la cuenta por pagar que enseña la fila cuando existen
ajustes manuales en el libro (`ajuste_devengo` / `ajuste_pago`), que no cuelgan de ningún cierre.
R37 obliga a advertirlo, pero **no existe hoy ninguna vía para pagar esa parte** y esta feature
no la abre (abrirla rompería R21 de la 172). *Escrito mientras tanto:* se advierte y no se paga.
Confirmar que ese es el comportamiento deseado, o convertirlo en ficha aparte.
**Respuesta (2026-08-11): confirmado, se advierte y no se paga. NO va ficha aparte.** Medido
contra producción ese día: **cero** movimientos con `origen_tipo = 'manual'` en
`pago_mensajero_movimiento`. La medición y su límite honesto —11 filas en total, muy poco dato
productivo: vale «no existe HOY», no «nunca existirá»— y qué hacer si eso cambia, en
`design.md §10.2`. R37 es la red y se queda tal cual.
