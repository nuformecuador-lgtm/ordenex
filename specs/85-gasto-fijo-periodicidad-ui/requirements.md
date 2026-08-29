# Ficha 85 — Periodicidad y día de cobro del gasto fijo en la UI · requisitos (EARS)

> Zona `fullstack`, complejidad media, `depends_on: 84`. Secuenciada **backend → frontend**.
> El modelo de datos NO se toca: la ficha 84 ya entregó `periodicidad_unidad`,
> `periodicidad_cantidad` y `fecha_cobro` en `gasto_fijo_plantilla`
> (`db/schema.prisma:1836-1849`). Esta ficha **expone** esas columnas y **tapa el agujero**
> por el que hoy se reescriben solas.

## Alcance

Tres cosas, y solamente tres:

- **A.** Cerrar el reset silencioso del ciclo al editar una plantilla (borde de `actualizar`).
- **B.** La lógica pura del **próximo cobro** (una función nueva en `lib/utils/periodicidad.ts`).
- **C.** El diálogo pide periodicidad y fecha de cobro; el listado gana «Periodicidad» y
  «Próximo cobro».

**Fuera de alcance (no se toca ni se propone):** aprobación de cobros (ficha 333), borrado de
plantillas (ficha 332), unificar los diálogos de movimiento (ficha 334), cambiar el cron, la
clave de idempotencia o el modelo de datos.

## El fallo que esta ficha existe para cerrar

Verificado leyendo el código el 2026-08-29:

1. `app/(app)/wallet/_components/GastoFijoPlantillaDialog.tsx:75-83` llama a
   `actualizarPlantillaAction({ id, concepto, monto })` — sin ningún campo del ciclo.
2. `lib/types/gasto-fijo-plantilla.ts:36-45` declara `periodicidadFields` con
   `.default("meses")`, `.default(1)` y `.default(() => fechaCalendarioCR())`, y
   `actualizarGastoFijoPlantillaSchema` (línea 58) los **hereda** de
   `crearGastoFijoPlantillaSchema`.
3. `GastoFijoPlantillaService.actualizarPlantilla` (`lib/services/GastoFijoPlantillaService.ts:57-63`)
   los pasa siempre y `GastoFijoPlantillaRepository.actualizar`
   (`lib/repositories/GastoFijoPlantillaRepository.ts:82-94`) los **escribe sin condición**.

Consecuencia: **editar el monto reescribe la periodicidad a `meses`/`1` y mueve `fecha_cobro`
al día de la edición.** Y pasar de `semanas` a `meses` cambia el formato de la clave de
idempotencia derivada (`<id>:2026-09-14` → `<id>:2026-09`), que es exactamente el escenario de
**doble cobro** que `lib/services/GeneracionGastosFijosService.ts:23-32` advierte por escrito.

Medido contra producción el 2026-08-29: 2 plantillas, ambas inactivas desde el 2026-08-27,
`fecha_cobro = 2026-08-04` en las dos, y **cero** movimientos `egreso_gasto_fijo` emitidos. El
fallo aún no ha mordido porque las dos ediciones del 27 fueron desactivaciones (`setActiva`, que
no toca `fecha_cobro`).

---

## 1. Contrato de actualización (backend)

**R1.** SI una solicitud de actualización de una plantilla de gasto fijo no incluye
`periodicidadUnidad`, `periodicidadCantidad` o `fechaCobro`, ENTONCES el sistema DEBE
rechazarla con `validation_error` nombrando cada campo ausente, y NO DEBE invocar la capa de
servicio ni escribir en la plantilla.

**R2.** CUANDO se actualiza una plantilla enviando su ciclo vigente y un monto distinto, el
sistema DEBE persistir el monto nuevo y DEBE dejar `periodicidadUnidad`, `periodicidadCantidad`
y `fechaCobro` con exactamente los valores que la plantilla ya tenía.

**R3.** CUANDO el maestro guarda una edición desde el diálogo habiendo cambiado únicamente el
monto, el sistema DEBE enviar el ciclo vigente de esa plantilla —unidad, cantidad y fecha de
cobro— sin alterar ninguno de los tres.

**R4.** MIENTRAS una solicitud de **creación** no traiga periodicidad, el sistema DEBE aplicar
`meses`, `1` y la fecha calendario de Costa Rica del día de la solicitud (asimetría deliberada
frente a R1: crear no pisa nada; actualizar sí).

**R5.** SI `fechaCobro` no tiene el formato `YYYY-MM-DD` o no corresponde a un día que exista en
el calendario (p. ej. `2026-02-31`), ENTONCES el sistema DEBE rechazar la solicitud con
`validation_error`, tanto al crear como al actualizar.

**R6.** SI `periodicidadCantidad` no es un entero mayor o igual que 1, o `periodicidadUnidad` no
es una de `dias` / `semanas` / `meses`, ENTONCES el sistema DEBE rechazar la solicitud con
`validation_error`.

## 2. Próximo cobro (lógica pura)

**R7.** El sistema DEBE poder calcular, a partir de una plantilla y de un instante dado, la
fecha calendario de Costa Rica (`YYYY-MM-DD`) del **próximo cobro**: la primera fecha, igual o
posterior al día calendario CR de ese instante, en la que esa plantilla cobra.

**R8.** SI el día calendario CR del instante es anterior al ancla (`fechaCobro`), ENTONCES el
próximo cobro DEBE ser el ancla.

**R9.** SI la plantilla cobra ese mismo día, ENTONCES el próximo cobro DEBE ser ese mismo día.

**R10.** DONDE la unidad es `meses` y el día del ancla no existe en el mes del cobro, el sistema
DEBE usar el último día de ese mes (ancla 31 → 28 o 29 de febrero, 30 de abril) y NO DEBE
saltarse ese mes.

**R11.** El próximo cobro calculado DEBE coincidir con la regla de disparo vigente: la fecha
devuelta cobra, y ningún día entre el día del instante (incluido) y esa fecha (excluida) cobra.

**R12.** El cálculo del próximo cobro DEBE recibir el instante por parámetro y NO DEBE leer el
reloj del proceso, ni acceder a la base de datos, ni depender de la zona horaria de la máquina.

## 3. Diálogo de la plantilla (frontend)

**R13.** CUANDO el maestro abre el diálogo para CREAR una plantilla, el sistema DEBE permitirle
elegir cada cuánto se cobra —diaria, semanal, quincenal, mensual o un ciclo propio «cada N
días/semanas/meses»— y la fecha del primer cobro, con «mensual» y la fecha de hoy (Costa Rica)
preseleccionadas.

**R14.** CUANDO el maestro abre el diálogo para EDITAR una plantilla, el sistema DEBE mostrar la
periodicidad y la fecha de cobro vigentes de esa plantilla.

**R15.** CUANDO el maestro confirma el diálogo, el sistema DEBE enviar concepto, monto, unidad,
cantidad y fecha de cobro en la misma solicitud, tanto al crear como al editar.

**R16.** SI la cantidad no es un entero mayor o igual que 1, o la fecha de cobro está vacía,
ENTONCES el diálogo DEBE señalar el error junto al campo afectado y NO DEBE enviar la solicitud.

**R17.** SI el servidor responde `validation_error` para `periodicidadUnidad`,
`periodicidadCantidad` o `fechaCobro`, ENTONCES el diálogo DEBE mostrar ese mensaje junto al
campo correspondiente, y NO DEBE descartarlo en silencio.

## 4. Listado, textos y archivo (frontend)

**R18.** El listado de plantillas de gasto fijo DEBE mostrar, por plantilla, cada cuánto se
cobra en palabras y la fecha del próximo cobro.

**R19.** SI la plantilla está inactiva, ENTONCES la celda de próximo cobro DEBE decir que no se
cobra, en lugar de una fecha.

**R20.** La periodicidad en palabras DEBE ser «Diaria» para 1 día, «Semanal» para 1 semana,
«Quincenal» para 2 semanas, «Mensual» para 1 mes, y «Cada N días/semanas/meses» para cualquier
otro ciclo.

**R21.** El archivo descargable del listado DEBE llevar las mismas columnas de datos que la
tabla, en el mismo orden y con los mismos encabezados y textos visibles.

**R22.** Ningún texto del panel ni del diálogo DEBE afirmar que el cobro es mensual: ni el
encabezado de la columna del monto, ni la etiqueta del campo, ni la descripción del panel, ni la
del diálogo, ni los avisos de activar/desactivar.

**R23.** El instante con el que la pantalla calcula el próximo cobro DEBE resolverse en el
servidor y bajar por props; la pantalla NO DEBE leer el reloj del navegador para esa columna.

**R24.** El monto DEBE viajar y pintarse como cadena en todo el camino que esta ficha toca
—diálogo → acción → servicio → archivo—, sin `Number` ni `parseFloat`.

**R25.** El formulario de egresos manuales (gasto variable / sueldo) NO DEBE ofrecer
periodicidad: solo la plantilla de gasto fijo la ofrece (regla del pedido literal, que hoy se
cumple por construcción y aquí se fija como regresión).

---

## Trazabilidad `R<n>` → test

| R | Test (archivo :: nombre) | Nuevo/existente |
| --- | --- | --- |
| R1 | `tests/unit/actions/gasto-fijo-plantilla-actions.test.ts` :: «actualizar sin periodicidad devuelve validation_error en los tres campos y no llama al servicio» | nuevo caso |
| R2 | `tests/unit/services/gasto-fijo-plantilla-service.test.ts` :: «editar el monto no mueve el ciclo: el repositorio recibe semanas/2/2026-03-31» | nuevo caso |
| **R3** | **`tests/unit/components/wallet-gasto-fijo-plantilla-dialog.test.tsx` :: «editar solo el monto reenvía semanas/2/2026-03-31 sin moverlos»** — **guardia principal de la ficha**; literales fijos, NUNCA comparados contra los defaults del schema | archivo nuevo |
| R4 | `tests/unit/types/gasto-fijo-plantilla-schema.test.ts` :: «crear sin periodicidad aplica meses/1 y la fecha CR del día (reloj congelado en 2026-03-15)» | archivo nuevo |
| R5 | `tests/unit/types/gasto-fijo-plantilla-schema.test.ts` :: «rechaza 2026-02-31 al crear y al actualizar aunque cumpla el formato» | archivo nuevo |
| R6 | `tests/unit/types/gasto-fijo-plantilla-schema.test.ts` :: «rechaza cantidad 0, cantidad decimal y unidad desconocida» | archivo nuevo |
| R7 | `tests/unit/utils/periodicidad-proximo-cobro.test.ts` :: «devuelve la primera fecha en que la plantilla cobra, para las cuatro periodicidades del pedido» | archivo nuevo |
| R8 | `tests/unit/utils/periodicidad-proximo-cobro.test.ts` :: «antes del ancla el próximo cobro es el ancla» | archivo nuevo |
| R9 | `tests/unit/utils/periodicidad-proximo-cobro.test.ts` :: «si hoy cobra, el próximo cobro es hoy» | archivo nuevo |
| R10 | `tests/unit/utils/periodicidad-proximo-cobro.test.ts` :: «ancla 31: el próximo cobro cae 28/feb, 29/feb en bisiesto y 30/abr» | archivo nuevo |
| R11 | `tests/unit/utils/periodicidad-proximo-cobro.test.ts` :: «coincide con aplicaHoy: la fecha devuelta cobra y ningún día anterior desde hoy cobra (barrido de 400 días)» | archivo nuevo |
| R12 | `tests/unit/utils/periodicidad-proximo-cobro.test.ts` :: «con dos instantes distintos del mismo día CR devuelve lo mismo, y no usa el reloj del sistema» | archivo nuevo |
| R13 | `tests/unit/components/wallet-gasto-fijo-plantilla-dialog.test.tsx` :: «crear ofrece diaria/semanal/quincenal/mensual y un ciclo propio, con mensual y hoy preseleccionados» | archivo nuevo |
| R14 | `tests/unit/components/wallet-gasto-fijo-plantilla-dialog.test.tsx` :: «editar siembra la periodicidad y la fecha de cobro vigentes» | archivo nuevo |
| R15 | `tests/unit/components/wallet-gasto-fijo-plantilla-dialog.test.tsx` :: «crear envía los cinco campos: quincenal viaja como semanas/2 con su fecha» | archivo nuevo |
| R16 | `tests/unit/components/wallet-gasto-fijo-plantilla-dialog.test.tsx` :: «cantidad 0 y fecha vacía muestran error y no llaman a la acción» | archivo nuevo |
| R17 | `tests/unit/components/wallet-gasto-fijo-plantilla-dialog.test.tsx` :: «un validation_error de fechaCobro se pinta junto al campo de la fecha» | archivo nuevo |
| R18 | `tests/unit/components/wallet-gastos-fijos-panel.test.tsx` :: «la tabla muestra la periodicidad en palabras y la fecha del próximo cobro» | caso nuevo |
| R19 | `tests/unit/components/wallet-gastos-fijos-panel.test.tsx` :: «una plantilla inactiva dice que no se cobra en vez de una fecha» | caso nuevo |
| R20 | `tests/unit/components/wallet-periodicidad-labels.test.ts` :: «nombra las cuatro del pedido y compone “Cada N …” para el resto» | archivo nuevo |
| R21 | `tests/unit/descarga/gastos-fijos-descarga-columnas.test.ts` :: «declara las cinco columnas en el orden de la pantalla» + «la fila lleva la misma periodicidad y el mismo próximo cobro que la tabla» | casos actualizados + nuevo |
| R22 | `tests/unit/components/wallet-gastos-fijos-panel.test.tsx` :: «ningún texto del panel ni del diálogo dice “cada mes”» | caso nuevo |
| R23 | `tests/unit/components/wallet-gastos-fijos-panel.test.tsx` :: «el próximo cobro se calcula con el instante recibido por props, no con el reloj del navegador» | caso nuevo |
| R24 | `tests/unit/components/wallet-gasto-fijo-plantilla-dialog.test.tsx` :: «el monto “1234.56” viaja como cadena tal cual» + `tests/unit/descarga/gastos-fijos-descarga-columnas.test.ts` :: «el monto sale crudo, sin símbolo ni redondeo» | nuevo + existente |
| R25 | `tests/unit/components/wallet-registrar-egreso-dialog.test.tsx` :: «el diálogo de egreso manual no ofrece periodicidad ni fecha de cobro» | caso nuevo |

Ningún requisito queda sin test. El mapa definitivo, con la salida real de cada corrida, lo
escribe el implementer en `progress/impl_85.md`.

---

## Preguntas abiertas

Se escriben aquí en vez de resolverse por suposición. La propuesta de cada una está en
`design.md`; el humano confirma o corrige en la puerta de aprobación.

1. **Forma del control de periodicidad.** Propuesta: un selector con «Diaria / Semanal /
   Quincenal / Mensual / Personalizada», y solo al elegir «Personalizada» aparecen la cantidad y
   la unidad. Alternativa: los dos controles crudos (cantidad + unidad) siempre visibles, más
   simple pero sin la palabra «quincenal» que usó el pedido literal. ¿Cuál?
2. **Encabezado del monto.** `progress/impl_189.md §8` dejó esta decisión dirigida a esta ficha
   y nombró dos salidas: «Monto» (con la columna de periodicidad al lado) o «Monto por ciclo».
   Propuesta: **«Monto»**. Cambia un encabezado que un usuario descarga en Excel.
3. **Fecha de cobro en el pasado.** Hoy el backend la acepta (y la 84 la usó en su backfill).
   Propuesta: seguir aceptándola sin bloqueo ni aviso. ¿Se quiere avisar de que una fecha pasada
   no genera cobros retroactivos?
4. **Texto de la celda para plantillas inactivas.** Propuesta: «No se cobra». Alternativa: un
   guion. El guion es más discreto y menos informativo.
5. **«Próximo cobro» en el archivo Excel.** Propuesta: sí, como `YYYY-MM-DD` (ordenable), y
   «No se cobra» para las inactivas. Alternativa: dejar el archivo con periodicidad pero sin la
   fecha derivada, por ser un valor que caduca en cuanto se abre el archivo.
6. **Editar la fecha de cobro de una plantilla activa.** Mueve el ciclo entero. Propuesta: un
   texto de ayuda fijo bajo el campo, sin confirmación adicional. ¿Basta?
