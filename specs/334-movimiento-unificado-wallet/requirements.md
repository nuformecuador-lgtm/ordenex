# Ficha 334 — Un solo diálogo para mover dinero en la wallet · Requisitos (EARS)

> Zona `fullstack` · complejidad media · `sdd: true`
> Origen: pedido del humano del 2026-08-29 — «me preocupa la simplicidad de hacer ajustes o
> movimientos de dinero dentro de la wallet».

## Qué se está arreglando (contexto, no requisitos)

`/wallet` renderiza hoy DOS botones uno al lado del otro
(`app/(app)/wallet/_components/WalletModule.tsx:202-207`):

| botón | diálogo | pide | deriva |
| --- | --- | --- | --- |
| «Registrar movimiento» | `RegistrarMovimientoManualDialog` | tipo (ingreso/egreso) + monto + descripción | `ingreso_ajuste` / `egreso_ajuste` |
| «Registrar egreso» | `RegistrarEgresoAdministrativoDialog` | tipo (`gasto_variable`/`sueldo`) + monto + descripción | `egreso_gasto_variable` / `egreso_sueldo` |

Piden lo mismo con dos vocabularios que no se explican entre sí. **Medido contra producción el
2026-08-29: 0 movimientos de ajuste sobre 38 filas del libro** — nadie ha usado nunca el de
ajustes, así que la fusión no arrastra un hábito instalado.

Además, hoy **todo movimiento manual se fecha con el reloj del instante en que se teclea**: el
gasto de ayer no se puede registrar con su fecha real. El humano decidió el 2026-08-29 que el
movimiento admite FECHA, con tope en hoy.

**Fuera de alcance:** gastos fijos y sus plantillas (fichas 85, 332, 333). No se tocan.

---

## A — El diálogo único

- **R1** — MIENTRAS un usuario con acceso total (`maestro`/`admin`) está en `/wallet`, el sistema
  DEBE ofrecer **un único** control para registrar dinero a mano en la caja principal.

- **R2** — El sistema DEBE NO ofrecer en `/wallet` ningún **segundo** control que abra un
  formulario de registro manual de dinero en la caja principal.

- **R3** — CUANDO el usuario abre ese diálogo, el sistema DEBE ofrecer **exactamente cuatro**
  conceptos: gasto variable, sueldo, ajuste que suma dinero y ajuste que resta dinero.

- **R4** — CUANDO el usuario selecciona un concepto, el sistema DEBE mostrar, dentro del diálogo,
  **con qué nombre aparecerá ese movimiento en el libro**.

- **R5** — SI el concepto elegido es «gasto variable», ENTONCES el sistema DEBE registrar un
  movimiento con `tipo = egreso`, `categoria = egreso_gasto_variable` y `origen_tipo = gasto`.

- **R6** — SI el concepto elegido es «sueldo», ENTONCES el sistema DEBE registrar un movimiento
  con `tipo = egreso`, `categoria = egreso_sueldo` y `origen_tipo = gasto`.

- **R7** — SI el concepto elegido es «ajuste que suma dinero», ENTONCES el sistema DEBE registrar
  un movimiento con `tipo = ingreso`, `categoria = ingreso_ajuste` y `origen_tipo = manual`.

- **R8** — SI el concepto elegido es «ajuste que resta dinero», ENTONCES el sistema DEBE registrar
  un movimiento con `tipo = egreso`, `categoria = egreso_ajuste` y `origen_tipo = manual`.

- **R9** — CUANDO cambia el concepto elegido, el sistema DEBE adaptar la etiqueta del campo de
  descripción a ese concepto, conservando sin cambio las dos etiquetas que ya existen:
  «Concepto del gasto» para el gasto variable y «Trabajador y periodo» para el sueldo.

- **R10** — El sistema DEBE conservar sin cambios el resto de la superficie de `/wallet`: las dos
  cifras de la caja, la composición de la ganancia, el desglose de egresos, el panel de gastos
  fijos, el libro, sus filtros, su paginación y su descarga.

## B — Reglas de negocio que NO se pierden en la fusión

- **R11** — El sistema DEBE NO ofrecer el **gasto FIJO** entre los conceptos registrables a mano
  (regla vigente: R19 de la ficha 45; el gasto fijo lo emite el cron desde su plantilla).

- **R12** — SI una petición de registro llega con un concepto, tipo o categoría fuera del conjunto
  admitido, ENTONCES el sistema DEBE rechazarla en el borde con `validation_error` y NO DEBE
  escribir ninguna fila en el libro.

- **R13** — El sistema DEBE exigir una descripción no vacía para registrar un movimiento.

- **R14** — El sistema DEBE exigir un monto mayor que cero con hasta dos decimales, validado en el
  cliente y **re-validado en el servidor** con aritmética decimal.

- **R15** — El sistema DEBE transportar los importes como **texto** en todo el camino
  cliente→borde→servicio→repositorio, sin convertirlos a punto flotante en ningún punto.

- **R16** — SI el actor no tiene acceso total, ENTONCES el sistema DEBE responder `forbidden` sin
  escribir ninguna fila; SI no hay sesión, ENTONCES DEBE responder `unauthenticated` sin tocar el
  servicio.

- **R17** — El movimiento registrado DEBE ser inmutable: el sistema NO DEBE ofrecer editarlo ni
  borrarlo, ni por interfaz ni por servicio ni por repositorio.

- **R18** — CUANDO un registro termina con éxito, el sistema DEBE refrescar el libro, las cifras de
  la caja y el desglose sin que el usuario tenga que recargar la página.

## C — La fecha del movimiento

- **R19** — El diálogo DEBE ofrecer un campo de fecha cuyo valor inicial es el **día calendario en
  curso de Costa Rica**.

- **R20** — SI la fecha elegida es posterior al día calendario en curso de Costa Rica, ENTONCES el
  sistema DEBE rechazar el registro —en el cliente y también en el borde— y NO DEBE escribir
  ninguna fila.

- **R21** — SI la fecha recibida no es un día calendario existente (formato inválido o día que no
  existe, p. ej. `2026-02-31`), ENTONCES el sistema DEBE responder `validation_error` sin escribir
  ninguna fila.

- **R22** — CUANDO la fecha elegida es **anterior** al día en curso, el sistema DEBE fechar el
  movimiento dentro de ese día calendario de Costa Rica.

- **R23** — CUANDO la fecha elegida es el **día en curso**, el sistema DEBE fechar el movimiento
  con el instante del registro, exactamente como hasta hoy.

- **R24** — El sistema DEBE conservar `created_at` como el instante en que se creó la fila; por
  tanto, para un movimiento fechado en un día anterior, `created_at` y la fecha del movimiento
  DEBEN ser distintas.

- **R25** — CUANDO el libro se agrupa por día calendario de Costa Rica (rollup diario y cubos de la
  analítica financiera), el sistema DEBE contar un movimiento fechado en el pasado **en el día
  elegido** y en ningún otro.

- **R26** — MIENTRAS dos o más movimientos comparten exactamente la misma fecha de movimiento, el
  sistema DEBE mantener un **orden total determinista** del libro, de modo que paginar no repita ni
  omita filas.

- **R27** — CUANDO el usuario aplica el filtro `desde` del libro con la fecha elegida, el sistema
  DEBE incluir el movimiento fechado en ese día.

## D — El contrato del registro

- **R28** — CUANDO un registro termina con éxito, el sistema DEBE devolver **el movimiento que
  acaba de crear**, identificado sin ambigüedad, y no otro movimiento de la misma categoría.

## E — Cobertura, lenguaje y accesibilidad

- **R29** — El sistema DEBE conservar, sobre el diálogo unificado, **todo** comportamiento hoy
  probado sobre los dos diálogos que sustituye. En concreto, los tres casos de
  `tests/unit/components/wallet-registrar-egreso-dialog.test.tsx` (el selector no ofrece gasto
  fijo; el submit envía tipo/monto/descripción; la validación de cliente bloquea monto ≤ 0 y
  descripción vacía) DEBEN seguir existiendo, con las mismas aserciones, sobre el diálogo nuevo.

- **R30** — El sistema DEBE mantener verdes, o actualizar de forma explícita y justificada cuando
  el contrato cambie a propósito, las suites que hoy cubren este camino:
  `tests/unit/actions/wallet-actions.test.ts`, `tests/unit/actions/wallet-egresos-actions.test.ts`,
  `tests/unit/services/wallet-service.test.ts`, `tests/unit/services/wallet-egreso-service.test.ts`,
  `tests/unit/repositories/wallet-movimiento-repository.test.ts` y
  `tests/integration/wallet-page.test.tsx`.

- **R31** — Los textos nuevos de interfaz DEBEN estar en español claro y en **voseo**, el que ya
  usa este módulo («No tenés permiso…», «Iniciá sesión de nuevo»).

- **R32** — Todo control del diálogo (concepto, monto, fecha, descripción) DEBE tener nombre
  accesible, y todo mensaje de error DEBE quedar asociado a su campo.

---

## Preguntas abiertas (para la puerta humana)

1. **¿Hay tope hacia atrás?** El humano fijó el tope superior («fecha futura se rechaza»), pero no
   dijo nada del pasado. Tal como está escrito, R22 admite fechar un movimiento en 2019, lo que
   reescribiría en silencio un mes ya reportado por la analítica. ¿Se acota (p. ej. «no más de N
   días atrás», o «no antes del primer movimiento del libro») o cualquier fecha pasada vale?

2. **Reversar un movimiento fechado atrás.** Hoy solo son reversables los egresos con
   `origen_tipo = gasto` —gasto variable y sueldo— y NO los ajustes (`esEgresoAdministrativo`,
   `wallet-labels.ts:272`). La fusión pone los cuatro conceptos en el mismo formulario y hace
   VISIBLE esa asimetría: dos de los cuatro se pueden deshacer y dos no. ¿Se deja tal cual (esta
   ficha no la toca) o se quiere que los cuatro se puedan reversar?

3. **El desfase de la tarde, que ya existe.** El libro pinta la fecha UTC del movimiento
   (`WalletLedger.tsx:215`, `fechaDiaISO`), así que un movimiento registrado después de las 18:00
   de Costa Rica se muestra HOY con la fecha del día siguiente. Afecta por igual a los cinco
   escritores del libro, no solo al manual. ¿Se arregla aquí (crece el radio de la ficha) o se
   registra como ficha aparte?

4. **El filtro `hasta` y el día en curso.** `hasta = D` compara contra la medianoche UTC de `D`, así
   que hoy deja fuera prácticamente todas las filas de ese mismo día. La fecha elegida no lo
   empeora ni lo mejora, pero es la primera vez que un usuario va a poner una fecha a mano y luego
   filtrar por ella. ¿Se arregla en otra ficha?

5. **Nombre de los dos ajustes en el libro.** El diálogo va a decir con qué nombre saldrá cada
   concepto (R4). Los nombres actuales del libro son «Ajuste (ingreso)» y «Ajuste (egreso)»
   (`CATEGORIA_LABEL`). ¿Se conservan tal cual —lo que esta ficha asume— o se quieren renombrar a
   lenguaje de maestro («Entra dinero por ajuste» / «Sale dinero por ajuste»)? Renombrarlos toca
   también el libro, la descarga y la analítica de etiquetas.
