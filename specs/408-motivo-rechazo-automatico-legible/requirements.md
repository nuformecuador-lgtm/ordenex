# 408 — El motivo de un rechazo automático se lee en lenguaje humano

## Contexto (medido en el código, 2026-09-10)

En el detalle de un cierre, la columna **Motivo** pinta `g.motivo` crudo
(`app/(app)/cierres-admin/_components/cierre-detalle-shared.tsx:1385, 1424, 1433, 1455`).
Para las gestiones sintéticas del cron de plazos vencidos (feature 99) ese texto es la plantilla
que compone `lib/services/DevolucionSlaService.ts:262`:

```ts
motivo: `escalado SLA ${orden.causa}`,
```

`orden.causa` es uno de los tres valores de `CAUSA_DEVOLUCION_SEED`
(`lib/types/causa-devolucion.ts`): `not_found`, `wrong_number`, `wrong_address`. Nunca es nulo en
esa rama: `DevolucionSlaService.ts:126` omite la orden sin causa antes de escalar. Así que el texto
guardado siempre es uno de estos tres, y son los que hay vivos en producción:

- `escalado SLA not_found`
- `escalado SLA wrong_number`
- `escalado SLA wrong_address`

**Dos superficies, y no se parecen en nada:**

| | ¿Quién mira? | ¿Hay marcador de origen en la fila? |
| --- | --- | --- |
| `/cierres-admin` (detalle, descargas, comprobante) | administración | **Sí.** `Automático` + su nota (`cierre-detalle-shared.tsx:318-319, 862-880`) |
| `/cierre-dia` (pantalla y descarga del mensajero) | el mensajero | **No, y no puede haberlo:** `CierreDiaRepository.ts:295` fija `esRechazoSla: false` para esta vista |

La segunda es la peor: el mensajero lee `escalado SLA wrong_address` **sin nada al lado que lo
explique**, sobre un rechazo que él no hizo. Y la gestión sintética sí entra en su cierre —
`escalado_devuelta_sla` no está en `ORIGENES_GESTION_FUERA_DEL_CIERRE`
(`lib/types/orden-historial.ts:399-407`).

**Decisión ya tomada:** se traduce AL PINTAR. No se reescribe el histórico —esas filas son
evidencia—, no se toca la base ni el productor del texto.

**Vocabulario: el ya aprobado (feature 73, 2026-07-15)**, `CAUSA_DEVOLUCION_LABEL`
(`app/(app)/mis-asignaciones/_components/causa-devolucion-options.ts:12`): «Cliente no localizado» /
«Número de celular errado» / «Dirección errada». Es lo que el mensajero elige en el selector y lo que
ya pinta Novedades. Un concepto, un nombre.

---

## Requisitos

### R1 — La plantilla del cron se lee en castellano
SI el motivo de una gestión es exactamente `escalado SLA <causa>`, donde `<causa>` es uno de los tres
valores de `CAUSA_DEVOLUCION_SEED`, ENTONCES el sistema DEBE mostrar en su lugar la etiqueta en
castellano de esa causa.

**Test:** unitario sobre el traductor, un caso por causa, comparando contra los tres literales
**escritos a mano en el test** (nunca contra el mapa que los produce).
`tests/unit/components/motivo-rechazo-automatico-legible.test.ts`

### R2 — Un motivo que no es la plantilla se muestra intacto
SI el motivo de una gestión no es exactamente una de esas tres plantillas, ENTONCES el sistema DEBE
mostrarlo tal cual, sin recortar, prefijar, traducir ni normalizar ninguna parte, **en las dos
variantes de texto** (con marcador de origen a la vista y sin él).

**Test:** mismo archivo. Casos obligatorios: texto libre del mensajero (`"El cliente no contesta el
timbre"`), un texto que CONTIENE la plantilla dentro de una frase más larga
(`"ojo: escalado SLA wrong_address según me dijeron"` → sale igual), cadena vacía, y la plantilla en
otra caja (`"Escalado sla wrong_address"` → sale igual). Cada caso se corre con las dos variantes y
con el literal de entrada repetido a mano en la aserción de salida.

### R3 — Un motivo ausente conserva lo que cada superficie ya hacía
SI el motivo de una gestión es nulo, ENTONCES el sistema DEBE conservar el comportamiento vigente de
cada superficie: `"—"` en la pantalla y **celda vacía** (nulo) en el archivo descargado.

**Test:** unitario del traductor (nulo → nulo, en las dos variantes) + aserción de la celda en
`tests/unit/descarga/cierre-gestiones-descarga-columnas.test.ts` (la celda sigue siendo `null` y no
la cadena `"—"`).

### R4 — Ni la sigla ni el value del enum llegan a la pantalla
El sistema DEBE producir, para las tres plantillas y en **las dos variantes**, un texto que no
contenga la sigla `SLA` ni ninguno de los tres values en inglés (`not_found`, `wrong_number`,
`wrong_address`).

**Test:** guardia de comportamiento —no de código fuente—
`tests/unit/guards/motivo-automatico-sin-jerga.guardia.test.ts`: recorre `CAUSA_DEVOLUCION_SEED`,
compone cada plantilla, pasa la salida por el traductor en sus dos variantes y afirma que no incluye
`"SLA"` ni el value. Se pone rojo si alguien devuelve la entrada sin traducir.

### R5 — Una causa que el catálogo no conoce no rompe ni vacía la celda
SI el motivo tiene la forma de la plantilla pero con una causa que el catálogo de etiquetas no
contiene, ENTONCES el sistema DEBE mostrar el texto guardado tal cual.

**Test:** unitario, entrada `"escalado SLA direccion_incompleta"` → salida idéntica a la entrada
(literal a mano), en las dos variantes. Nada de `undefined`, `null` ni cadena vacía.

### R6 — El archivo dice exactamente lo mismo que la pantalla
CUANDO se descargue un archivo de gestiones de un cierre —descarga por sección, hoja fundida o
descarga de `/cierre-dia`—, la celda «Motivo» de una gestión DEBE llevar exactamente el mismo texto
que la celda de la pantalla que le corresponde a esa misma gestión.

**Test:** `tests/unit/descarga/cierre-gestiones-descarga-columnas.test.ts`,
`tests/unit/descarga/cierres-gestiones-fundida-descarga-columnas.test.ts` y
`tests/unit/descarga/cierre-dia-descarga-columnas.test.ts`: una gestión con
`motivo: "escalado SLA wrong_address"` produce la celda con el literal escrito a mano —el corto en
las dos primeras, el autosuficiente de R11 en la tercera.

### R7 — La traducción no toca el dato
El sistema DEBE traducir sólo al pintar: la gestión que recibe el traductor DEBE quedar sin
modificar y el traductor DEBE ser una función pura (misma entrada, misma salida, sin efectos).

**Test:** unitario con `Object.freeze` sobre la gestión y comparación profunda antes/después; dos
invocaciones seguidas con la misma entrada devolviendo el mismo valor.

### R8 — El marcador de origen sigue diciendo lo que decía
El sistema DEBE seguir mostrando el marcador de origen (`Automático` / `Manual`) y su nota
accesible, con su texto actual sin cambios.

**Test:** `tests/components/CierreMotivoRechazoAutomatico.test.tsx`: en la fila de una gestión
`rechazada` con `esRechazoSla: true`, el marcador sigue presente con la etiqueta `"Automático"` y la
nota literal («Rechazo automático por vencerse el plazo de la devolución (no lo hizo el
mensajero).»), ambos escritos a mano en el test.

### R9 — Donde está el marcador, la columna Motivo no lo repite
MIENTRAS la fila muestre el marcador de origen, el texto de la celda «Motivo» NO DEBE contener la
frase del marcador ni la palabra «automático».

**Test:** mismo archivo de componente: la celda «Motivo» de esa fila es exactamente
`"Dirección errada"` (literal a mano) y no incluye `"automático"` ni la nota del marcador.

### R10 — Las filas que ya existen se traducen sin migración
DONDE existan gestiones ya guardadas con la plantilla vieja, el sistema DEBE traducirlas con la
misma regla, sin ninguna migración, backfill ni campo nuevo en el DTO.

**Test:** los casos de R1/R6/R11 usan la cadena de producción **tal cual**
(`"escalado SLA wrong_address"`), y la gestión de prueba se construye sólo con campos que el DTO ya
tiene hoy.

### R11 — Donde NO hay marcador, el texto se sostiene solo
SI la fila no muestra el marcador de origen, ENTONCES el texto de la celda «Motivo» de un rechazo
automático DEBE decir, además de la causa, **que lo rechazó el sistema al vencerse el plazo de la
devolución** — sin la sigla `SLA` y sin depender de ningún tooltip para entenderse.

**Test:** unitario (literal completo escrito a mano) y
`tests/components/CierreDiaMotivoRechazoAutomatico.test.tsx`: en `/cierre-dia`, la fila de esa misma
gestión muestra el texto largo. Se pone rojo si alguien aplica ahí la variante corta.

### R12 — Las dos variantes nombran la causa con la misma palabra
El sistema DEBE nombrar la causa con la misma etiqueta en las dos variantes: el texto
autosuficiente DEBE contener, literalmente, la etiqueta de la variante corta.

**Test:** unitario: para cada una de las tres plantillas, la salida larga **contiene** el literal
corto escrito a mano (`"Dirección errada"`, etc.). Se pone rojo si alguien forka el vocabulario en
una de las dos ramas.

---

## Fuera de alcance (declarado)

- Reescribir, migrar o normalizar `gestion_orden.motivo`. Es evidencia.
- Tocar `lib/services/DevolucionSlaService.ts` ni ningún productor del texto.
- Rediseñar la columna «Origen», su marcador o su tooltip. **Límite conocido y aceptado:** la nota
  del marcador viaja en `title`/`aria-label`, así que en táctil esa explicación no existe. Por eso
  R11 no la da por disponible en ninguna parte: el texto largo se sostiene solo.
- El diálogo de indemnización (`CierresAdminModule.tsx:1472`) pinta `g.motivo` sólo para
  `incidente`, resultado que la plantilla del cron nunca produce: fuera, medido.

## Preguntas abiertas

Ninguna. Las tres que abrió el borrador se cerraron el 2026-09-10:

1. **Vocabulario** → el aprobado de la 73. Un concepto, un nombre.
2. **`/cierre-dia`** → entra, y es obligatorio: es la superficie sin marcador, la del rol más
   numeroso. De ahí salen R11 y R12.
3. **El `title` invisible en táctil** → se acepta el límite y queda declarado arriba; la respuesta de
   diseño es que el texto de R11 no dependa de él.
