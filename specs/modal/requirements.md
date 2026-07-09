# modal — requirements.md

Feature id 13 · zone: frontend · complexity: medium · branch: feature/13-modal

Componente de diálogo/modal genérico y reutilizable (`components/shared/`) que,
además del comportamiento clásico confirmar/cancelar, soporta que el handler de
confirmación sea asíncrono: mientras la promesa está pendiente muestra un spinner
en el botón de confirmación, lo bloquea y evita el doble envío.

Notación EARS. Cada `R<n>` es testeable con Vitest + @testing-library/react +
userEvent (patrón `tests/components/`). "El componente" = el `Modal` reutilizable.

## Apertura y cierre controlados

- **R1** El componente DEBE ser controlado: su visibilidad se determina por la prop
  booleana `open`. MIENTRAS `open` es `false`, el componente DEBE no renderizar el
  contenido del diálogo (título, cuerpo ni botones) en el árbol accesible.
- **R2** MIENTRAS `open` es `true`, el componente DEBE renderizar un contenedor con
  rol `dialog`, visible y consultable por el árbol accesible.
- **R3** CUANDO el usuario dispara un cierre (botón cancelar, botón de cierre,
  tecla Escape u overlay), el componente DEBE invocar `onOpenChange(false)` y NO
  DEBE cambiar por sí mismo la prop `open` (el contenedor padre es la fuente de
  verdad del estado).
- **R4** CUANDO el componente solicita abrirse o cerrarse, el componente DEBE
  invocar `onOpenChange` con el nuevo valor booleano (`true`/`false`).

## Título, contenido y acciones

- **R5** El componente DEBE mostrar un título recibido por prop (`title`) y DEBE
  asociarlo al diálogo mediante `aria-labelledby`.
- **R6** DONDE se provea una descripción (`description`), el componente DEBE
  mostrarla y asociarla al diálogo mediante `aria-describedby`.
- **R7** El componente DEBE renderizar contenido arbitrario recibido como
  `children` dentro del cuerpo del diálogo, sin imponer estructura sobre él
  (requisito para montar `BulkUpload` dentro del modal en la feature 14).
- **R8** El componente DEBE renderizar un botón de confirmación con etiqueta
  configurable (`confirmLabel`, por defecto "Confirmar") y un botón de cancelación
  con etiqueta configurable (`cancelLabel`, por defecto "Cancelar").
- **R8b** DONDE la prop `confirmVariant` sea `"destructive"`, el botón de
  confirmación DEBE recibir la variante visual `destructive` del `Button`. Por
  defecto (`"default"`), el botón DEBE recibir la variante `default`.
- **R9** DONDE no se provea handler `onConfirm`, el componente DEBE seguir
  renderizando el botón de confirmación, y al accionarlo NO DEBE fallar (no-op).
- **R10** DONDE la prop `hideCancel` sea `true`, el componente NO DEBE renderizar el
  botón de cancelación.

## Confirmar / cancelar (síncrono)

- **R11** CUANDO el usuario acciona el botón de confirmación y `onConfirm` es
  síncrono (no devuelve una promesa), el componente DEBE invocar `onConfirm` una
  sola vez.
- **R12** CUANDO `onConfirm` síncrono retorna sin lanzar y `closeOnConfirm` no es
  `false`, el componente DEBE invocar `onOpenChange(false)`.
- **R13** CUANDO el usuario acciona el botón de cancelación, el componente DEBE
  invocar `onCancel` (si se proveyó) y DEBE invocar `onOpenChange(false)`.

## Confirmar asíncrono: spinner, bloqueo y anti-doble-submit

- **R14** CUANDO el usuario acciona el botón de confirmación y `onConfirm` devuelve
  una promesa, el componente DEBE entrar en estado "pendiente" hasta que la
  promesa se resuelva o rechace.
- **R15** MIENTRAS el estado es "pendiente", el componente DEBE mostrar un
  indicador de carga (spinner) dentro del botón de confirmación.
- **R16** MIENTRAS el estado es "pendiente", el componente DEBE deshabilitar
  (`disabled`) el botón de confirmación.
- **R17** MIENTRAS el estado es "pendiente", SI el usuario vuelve a accionar el
  botón de confirmación, ENTONCES el componente NO DEBE invocar `onConfirm` una
  segunda vez (prevención de doble envío).
- **R18** MIENTRAS el estado es "pendiente", el componente DEBE anunciar el estado
  de carga a tecnologías de asistencia (elemento con `role="status"` o
  `aria-busy`).
- **R19** MIENTRAS el estado es "pendiente", el componente DEBE deshabilitar el
  botón de cancelación y el botón de cierre, y NO DEBE cerrarse por Escape ni por
  clic en el overlay (evitar cierre mientras corre la operación).

## Resolución y rechazo del confirmar asíncrono

- **R20** CUANDO la promesa de `onConfirm` se resuelve y `closeOnConfirm` no es
  `false`, el componente DEBE salir del estado "pendiente" e invocar
  `onOpenChange(false)`.
- **R21** DONDE `closeOnConfirm` sea `false`, CUANDO la promesa de `onConfirm` se
  resuelve, el componente DEBE salir del estado "pendiente" y NO DEBE invocar
  `onOpenChange(false)` (permanece abierto para flujos multi-paso).
- **R22** CUANDO la promesa de `onConfirm` se rechaza, el componente DEBE salir del
  estado "pendiente", NO DEBE invocar `onOpenChange(false)` (permanece abierto) y
  DEBE reactivar los botones de confirmación y cancelación.
- **R23** CUANDO la promesa de `onConfirm` se rechaza, SI se proveyó `onError`,
  ENTONCES el componente DEBE invocarlo con el error capturado. El componente NO
  DEBE renderizar ningún mensaje de error propio: la presentación del error queda a
  cargo del consumidor (p. ej. el toast de la feature 11).
- **R24** CUANDO tras un rechazo el usuario vuelve a accionar el botón de
  confirmación, el componente DEBE invocar `onConfirm` de nuevo (permite reintento).

## Cierre por Escape y overlay

- **R25** MIENTRAS el estado NO es "pendiente" y `dismissible` no es `false`, CUANDO
  el usuario pulsa Escape, el componente DEBE invocar `onOpenChange(false)`.
- **R26** MIENTRAS el estado NO es "pendiente" y `dismissible` no es `false`, CUANDO
  el usuario hace clic en el overlay/backdrop, el componente DEBE invocar
  `onOpenChange(false)`.
- **R27** DONDE `dismissible` sea `false`, el componente NO DEBE cerrarse por Escape
  ni por clic en el overlay (solo por los botones), independientemente del estado.

## Accesibilidad y foco

- **R28** MIENTRAS `open` es `true`, el diálogo DEBE exponer `aria-modal="true"`.
- **R29** CUANDO el diálogo se abre, el componente DEBE mover el foco al interior
  del diálogo (foco inicial en el primer elemento enfocable o en el contenedor).
- **R30** MIENTRAS `open` es `true`, el componente DEBE atrapar el foco (Tab /
  Shift+Tab) dentro del diálogo (focus trap).

- **R31** La restauración del foco al elemento disparador tras el cierre la provee
  la primitiva Base UI por defecto. El componente DEBE apoyarse en ese
  comportamiento y NO DEBE implementar lógica propia de restauración de foco. Queda
  fuera del alcance de test propio (decisión humana 2026-07-09).

## Preguntas abiertas

Ninguna. Las tres preguntas abiertas fueron resueltas por el humano el 2026-07-09 y
convertidas en requisitos firmes: R31 (restauración de foco delegada a Base UI, sin
test propio), R8b (`confirmVariant` destructive en alcance) y R23 (error async solo
delegado vía `onError`, sin render de error interno).
