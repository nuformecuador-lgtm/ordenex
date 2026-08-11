# Feature 194 — Columnas del manifiesto elegibles por acción · requirements.md

> Zona: frontend · complexity: small · sdd: true
> Pedido humano (2026-08-10): «un select que permita decir qué campos exportar (no listar
> todos, solo los que ya se exportan actualmente) y guardar la selección en local storage
> POR ACCIÓN — el manifiesto de órdenes cargadas es diferente al manifiesto de asignaciones».

## Glosario

- **Columna publicada**: entrada vigente de `COLUMNAS_MANIFIESTO` (`lib/utils/manifiesto-xlsx.ts`).
  El conjunto es ABIERTO (feature 160/R28): crece cuando la orden gana un dato.
- **Flujo**: valor de `MANIFIESTO_FLUJOS` (`lib/types/manifiesto.ts`). Es el identificador de
  la "acción" del pedido humano: `carga_masiva`, `generacion_guia`, `ruteo_satelite`,
  `asignacion_satelite`, `devolucion_central`, `envio_tienda`, `recoleccion_tienda`.
- **Preferencia de columnas**: elección de columnas visibles/ocultas guardada en el
  dispositivo para UN flujo concreto.
- **Selector**: la superficie de UI (popover con casillas) que edita esa preferencia.

## Alcance

Dentro: la elección de columnas es de PRESENTACIÓN y ocurre en el navegador, sobre las filas
que el servidor ya devolvió.
Fuera: cambiar `ManifiestoService`, la Server Action `obtenerManifiesto`, `ManifiestoFilaDTO`,
el canal de API key, el esquema de base de datos y cualquier migración. Fuera también: añadir
datos nuevos de la orden, reordenar columnas y sincronizar la preferencia entre dispositivos
o entre usuarios.

---

## Requisitos

### Selector: existencia y forma

**R1** — El sistema DEBE ofrecer, junto a cada botón de descarga de manifiesto, un control
propio e independiente del botón, cuyo nombre accesible identifique que abre la elección de
columnas del manifiesto.

**R2** — CUANDO el usuario activa ese control, el sistema DEBE abrir un selector que presenta
una casilla marcable por cada columna publicada, en el mismo orden relativo en que aparecen
en el archivo.

**R3** — El sistema DEBE mostrar cada casilla marcada cuando su columna es visible en el
archivo y desmarcada cuando está oculta.

**R4** — El nombre accesible de cada casilla del selector DEBE contener la clave máquina de la
cabecera de esa columna (`num_guia`, `num_remision`, …), de modo que el usuario pueda
relacionar sin ambigüedad la casilla con la columna que verá en el archivo.

**R5** — SI una columna publicada no tiene etiqueta legible declarada, ENTONCES el selector
DEBE mostrarla igualmente usando su clave máquina como texto, sin fallar ni omitirla.

**R6** — El sistema DEBE ofrecer dentro del selector una acción "Restablecer" que deja todas
las columnas publicadas visibles.

### Efecto sobre el archivo

**R7** — CUANDO el usuario descarga un manifiesto, el archivo generado DEBE contener
exactamente las columnas visibles de ese flujo y ninguna de las ocultas.

**R8** — El sistema DEBE conservar SIEMPRE el orden relativo de `COLUMNAS_MANIFIESTO` en el
archivo generado, cualquiera que sea el orden en que el usuario marcó o desmarcó las casillas.

**R9** — El sistema DEBE emitir en la fila de cabecera del archivo la clave máquina de cada
columna visible, con independencia del texto que el selector muestre al usuario.

**R10** — CUANDO el usuario pulsa el botón de descarga, el sistema DEBE generar y descargar el
archivo con la preferencia ya guardada en un solo click, sin abrir ningún paso intermedio de
confirmación de columnas.

**R11** — El sistema DEBE mantener el nombre del archivo (`manifiesto-<flujo>-<YYYY-MM-DD>.xlsx`)
sin cambio alguno cuando se exporta un subconjunto de columnas.

### Límite mínimo

**R12** — MIENTRAS quede una sola columna visible, el sistema DEBE impedir que esa última
casilla se desmarque y DEBE indicar al usuario que al menos una columna debe permanecer
seleccionada.

**R13** — SI, pese a todo, la selección efectiva a la hora de generar quedara vacía, ENTONCES
el sistema DEBE generar el archivo con todas las columnas publicadas en lugar de fallar.

### Persistencia por acción

**R14** — CUANDO el usuario cambia la selección de un flujo, el sistema DEBE persistirla en el
almacenamiento local del dispositivo bajo una clave propia de ese flujo.

**R15** — CUANDO el usuario vuelve a abrir el selector o a descargar el manifiesto de un flujo
en el mismo dispositivo, el sistema DEBE aplicar la preferencia previamente guardada para ese
flujo.

**R16** — CUANDO el usuario cambia la selección de un flujo, el sistema NO DEBE alterar la
preferencia de ningún otro flujo.

**R17** — MIENTRAS no exista preferencia guardada para un flujo, el sistema DEBE tratar todas
las columnas publicadas como visibles.

**R18** — CUANDO la preferencia de un flujo cambia, el sistema DEBE reflejar el nuevo estado en
todas las superficies vivas que muestran ese mismo flujo, sin requerir recarga de la página.

### Robustez del dato guardado

**R19** — CUANDO el sistema lee la preferencia guardada, DEBE descartar toda clave que ya no
corresponda a una columna publicada.

**R20** — SI tras descartar las claves obsoletas no quedara ninguna columna visible, ENTONCES
el sistema DEBE tratar todas las columnas publicadas como visibles.

**R21** — SI el contenido guardado no es legible (JSON inválido, forma o tipo inesperado) o el
almacenamiento local no está disponible, ENTONCES el sistema DEBE comportarse como si no
hubiera preferencia guardada, y NO DEBE lanzar ni impedir la descarga.

**R22** — DONDE se publique una columna nueva en `COLUMNAS_MANIFIESTO`, el sistema DEBE
mostrarla VISIBLE y marcada para un dispositivo que ya tuviera una preferencia guardada de ese
flujo, quedando su ocultación como acto explícito posterior del usuario.

### Invariantes que no se derogan

**R23** — El sistema DEBE seguir tratando el conjunto de columnas del manifiesto como ABIERTO
(feature 160/R28): ni el código ni las pruebas de esta feature pueden afirmar "exactamente N
columnas"; verifican presencia, ausencia y orden RELATIVO por clave.

**R24** — SI el generador del manifiesto no recibe selección de columnas, ENTONCES DEBE emitir
todas las columnas publicadas, tal y como lo hace hoy.

**R25** — El sistema DEBE dejar intactos el contrato y el comportamiento del servidor: la
Server Action `obtenerManifiesto`, `ManifiestoService` y `ManifiestoFilaDTO` siguen devolviendo
todos los campos, y la petición que hace la UI no lleva información de columnas.

**R26** — El sistema DEBE dejar sin efecto alguno el canal de API key
(`app/api/ordenes/api-key/carga`): su bloque `manifiesto` sigue devolviendo las filas completas.

---

## Trazabilidad prevista

| Req | Verificación |
| --- | --- |
| R1, R2, R3, R4, R5, R6, R12 | `tests/components/ColumnasManifiestoPopover.test.tsx` |
| R7, R8, R9, R13, R24 | `tests/unit/utils/manifiesto-xlsx-columnas.test.ts` |
| R10, R11, R25 | `tests/components/DescargarManifiestoColumnas.test.tsx` |
| R14–R22 | `tests/unit/manifiesto/preferencia-columnas.test.ts` + `tests/components/DescargarManifiestoColumnas.test.tsx` (R16, R18) |
| R23 | Revisión de asertos en los tests nuevos + tests vigentes de `manifiesto-xlsx` sin cambio |
| R26 | Tests vigentes del route handler de API key, sin cambio |

---

## Preguntas abiertas

Ninguna. Las tres que quedaban se cerraron en la puerta humana del **2026-08-10**, todas
confirmando la propuesta del diseño. Quedan asentadas abajo como parte del encargo.

## Decisiones cerradas en la puerta humana (2026-08-10)

**D-A — Textos del selector (cierra R4/R5).** Cada casilla muestra la etiqueta legible SEGUIDA
de la clave máquina entre paréntesis: `Número de guía (num_guia)`. El ARCHIVO sigue emitiendo
solo la clave máquina (R9). Mapa confirmado, que es el que debe implementar
`lib/manifiesto/etiquetas-columnas.ts`:

| Cabecera (archivo) | Etiqueta legible (pantalla) |
| --- | --- |
| `num_guia` | Número de guía |
| `num_remision` | Número de remisión |
| `destinatario` | Destinatario |
| `telefono` | Teléfono |
| `direccion` | Dirección |
| `zona` | Zona |
| `monto` | Monto a cobrar |
| `intentos` | Intentos de entrega |
| `origen` | Origen |
| `destino` | Destino |
| `responsable` | Responsable |
| `fecha` | Fecha |

Una cabecera sin entrada en este mapa se muestra con su propia clave (R5): el mapa NO cierra la
lista de columnas (R23).

**D-B — Afordancia del mínimo (cierra R12).** La última casilla marcada se rinde `disabled`,
con un texto de ayuda visible en el selector. NO se permite el clic con aviso de error: el
límite se ve antes de chocar con él, y así el mínimo es un estado, no un fallo.

**D-C — Copiar la preferencia entre flujos: FUERA DE ALCANCE.** No hay atajo "aplicar esta
selección a todos los flujos". La independencia entre flujos es el corazón del pedido; el
atajo se añadirá si aparece la necesidad, no por anticipado.
