# Feature 456 — Diseño técnico

> Requisitos en `requirements.md` (R1-R37). Base: el árbol de `feature/454-backend` del 2026-09-23 **más** el
> diseño de la 454 y de la 455, que se aplican antes. Las líneas citadas son del archivo real a esa fecha. La 455
> mueve varias piezas, así que el implementador vuelve a medir el inventario en T0.3 antes de editar. Búsqueda
> hecha con el MCP `codebase-memory` (proyecto `R-job-singularis-projects-ordenex`) y confirmada en el archivo
> real.
>
> **Sin base de datos, sin migraciones, sin endpoints, sin RLS**: las explicaciones son texto estático del
> bundle. El único cambio fuera de `app/` y `components/` son dos constantes en `lib/types/order-status.ts`.
> Tocar `lib/types/` obliga al **gate completo** (`./init.sh`).
>
> **Enmienda del 2026-09-23.** Llevan botón la analítica (§5, fila 16), los filtros de estado (§4.4), los
> resultados de gestión con nombre de estado (§5, filas 4, 6 y 14) y la nota de ayuda (§1, §3). La guardia se
> reduce a las excepciones que siguen justificadas (§6).

---

## 0. Decisiones, en una tabla

| # | Pregunta | Decisión | Por qué, en una línea |
|---|---|---|---|
| **DA** | ¿Dónde vive el texto? | `DESCRIPCION_ESTADO` y `DESCRIPCION_NOTA_AYUDA` en `lib/types/order-status.ts`, junto a `NOMBRE_ESTADO`. La primera es `as const satisfies Record<OrderStatusValue, string>`. | Así el tipo obliga a tener un texto por estado (R3), y la guardia G3 de la 455 prohíbe cualquier `Record` código→texto fuera de ese archivo. |
| **DB** | Plazos de «Novedad» | La entrada se **construye** con `descripcionNovedad(devolucionSlaConfig)`. | R4-R5: un número repetido a mano es el fallo de la 407/409. |
| **DC** | Primitivo | **Popover** de `@base-ui/react/popover` con `openOnHover`, envuelto en `components/ui/popover.tsx` nuevo. No se usa el tooltip. | El tooltip no se abre con el dedo (R21) y no es un elemento con nombre y descripción (R24). |
| **DD** | ¿Un componente o uno por pantalla? | **Uno**: `components/shared/EstadoInfo.tsx`, con cinco piezas: `InfoEstado`, `EstadoConInfo`, `SenalPendienteConInfo`, `NotaAyudaConInfo` y `LeyendaEstadosConInfo`. `EstatusBadge` pasa a usar `EstadoConInfo`. | R7, R18. |
| **DE** | Señal de pendiente | Botón con la explicación de `en_reparto`. | Es el texto aprobado que habla de «pendiente de confirmación». |
| **DF** | Rastreo público sin códigos (455/R32) | El cliente traduce nombre → código con la inversa de `NOMBRE_ESTADO`. | R36: la frontera pública no se toca. |
| **DG** | Control dentro de otro control (fila del chat, opción de filtro, resumen del filtro aplicado, lista `aria-hidden` de la gráfica, pestaña) | **Patrón de hermano**: el botón de información va fuera del control, junto a él. Si no hay sitio junto a él (gráfica), va en una leyenda propia. | HTML y ARIA no admiten un control dentro de otro, ni uno enfocable dentro de `aria-hidden`. |
| **DH** | Vigilancia | Guardia `estado-con-info.guardia.test.ts` con cuatro brazos (§6). | R18-R19. |

---

## 1. La fuente única (DA, DB)

### 1.1 `lib/types/order-status.ts` (añadido; lo demás es de la 455)

```ts
import { devolucionSlaConfig, type DevolucionSlaConfig } from "@/lib/config/devolucion-sla";

/** R4/R5 — única entrada construida. Exige plazos >= 2 (con 1, «a las 1 horas» es falso en castellano:
 *  necesita un texto nuevo aprobado). Con < 2 lanza al cargar el módulo. */
export function descripcionNovedad(p: DevolucionSlaConfig): string;

/** R1-R3 — la explicación de cada estado. Literal salvo `novedad`. */
export const DESCRIPCION_ESTADO = {
  /* … los 20, literales de la tabla aprobada, con las claves vigentes de la 455 … */
  novedad: descripcionNovedad(devolucionSlaConfig),
} as const satisfies Record<OrderStatusValue, string>;

/** R8 — PENDIENTE DE VISTO BUENO DEL HUMANO (textos-aprobados.md, sección propia). */
export const DESCRIPCION_NOTA_AYUDA =
  "El mensajero pidió ayuda a la tienda con esta entrega. El paquete sigue en reparto hasta que se registre su gestión.";

/** R15 — `null` para retirados, desconocidos y vacío: quien la llame no pinta botón. */
export function descripcionDeEstado(value: string | null | undefined): string | null;

/** DF — inversa de NOMBRE_ESTADO. */
export function codigoDeNombre(nombre: string): OrderStatusValue | null;
```

- `lib/types` puede importar `devolucion-sla.ts` porque es un módulo puro. `reintentos.ts` **no** se importa
  (R6).
- El nombre de la nota de ayuda («Ayuda solicitada a la tienda») sale de donde lo dejó la 454/455. Esta ficha
  no lo redefine.

### 1.2 Tests de la fuente — `tests/unit/types/descripcion-estado.test.ts`

1. **Contra el archivo aprobado** (R2, R5). El test lee `textos-aprobados.md` del disco y parsea **solo la
   primera tabla**, la que va antes de «## Validado». Deben salir 20 filas. Afirma
   `DESCRIPCION_ESTADO[codigoDeNombre(nombre)] === texto`. Es un literal externo, no la propia fuente: si
   `DIAS_RECHAZO_AUTOMATICO` pasa a 7, este caso cae hasta que el humano apruebe el texto.
2. **Nota de ayuda** (R8): `DESCRIPCION_NOTA_AYUDA` es igual a la fila de la tabla de la sección «Pendiente de
   visto bueno del humano».
3. **Derivación** (R4-R5): con 7 días y 48 horas salen «a los 7 días» y «a las 48 horas», y no aparecen «5» ni
   «24».
4. **Sin intentos** (R6): los únicos números de la explicación de «Novedad» son los dos plazos.
5. **Plazo menor que 2**: lanza con un mensaje que nombra el plazo.
6. **Retirados y desconocidos** (R15): `descripcionDeEstado` devuelve `null`.
7. **Tipo exhaustivo** (R3): `// @ts-expect-error` con 19 claves.

**Aviso para T0.1.** La G4 de la 455 lee la primera columna de `textos-aprobados.md`. Hay que comprobar que su
parser se queda en la primera tabla. Si recorre todas, la tabla nueva de la nota («Ayuda solicitada a la
tienda») la pondría roja. El arreglo es acotar ese parser a la primera tabla, con nota fechada.

---

## 2. El primitivo (DC)

`components/ui/popover.tsx` nuevo, con el patrón de `tooltip.tsx` (envoltorios con `data-slot`):
- `Popover`, `PopoverTrigger`;
- `PopoverContent` (Portal, Positioner, Popup y Arrow);
- `PopoverTitle`, `PopoverDescription`.

Se genera con `npx shadcn add popover` si el registro da la variante de Base UI; si no, se escribe a mano sobre
`@base-ui/react/popover`. Precedentes probados en jsdom: `NotificationsBell.tsx` y `ColumnasPopover.tsx`.
Popup: `bg-popover text-popover-foreground`, borde, `max-w-xs`, `text-sm` (la explicación de «Novedad» tiene
58 palabras).

| Aspecto | Valor | R |
|---|---|---|
| Abrir | `openOnHover` en el `Trigger` con `delay` de 200 ms. El clic, el toque, Enter y Espacio abren al instante. | R20-R22 |
| Cerrar | Pulsar fuera, segundo clic en el botón o Escape. | R21-R22 |
| Foco | Al abrir por teclado, el foco entra al popup. Escape devuelve el foco al `Trigger`. | R22 |
| Uno a la vez | Abrir otro cuenta como pulsar fuera del primero. | R25 |
| Montaje | Sin `keepMounted`: cerrado, no hay nodo en el DOM. | R29 y rendimiento en tablas de 50-500 filas |
| Modal | `modal={false}` | R30 |
| Marca | El popup lleva `data-slot="estado-info-popup"` (lo usa §4.4). | R31 |

**Se mide en T0.2** (Abierto): en móvil, el toque abre y deja abierto. Dentro del `Dialog` del rastreo y del
panel del filtro, el popup no cuenta como «fuera». Si falla, hay dos salidas: `openOnHover={false}` cuando se
cumpla `(hover: none)`, y `container` del `Portal` dentro del contenedor anfitrión.

---

## 3. El componente compartido (DD, DE)

`components/shared/EstadoInfo.tsx` (`"use client"`). Es el **único** archivo de `app/` y `components/` que
pinta en JSX un nombre de estado, la señal de pendiente o la nota de ayuda (§6).

```tsx
type Superficie = "app" | "landing";

/** Solo el botón (para ir como hermano de un control que ya muestra el nombre). */
export function InfoEstado(p: { codigo: string; superficie?: Superficie }): JSX.Element | null;
/** Nombre + botón. El nombre se calcula DENTRO: nadie le pasa texto. */
export function EstadoConInfo(p: { codigo: string; chipClassName?: string; superficie?: Superficie }): JSX.Element;
/** «<resultado> · pendiente de confirmación» + botón con la explicación de `en_reparto` (R11). */
export function SenalPendienteConInfo(p: { resultado: GestionResultado; superficie?: Superficie }): JSX.Element;
/** Nota de ayuda + botón con DESCRIPCION_NOTA_AYUDA (R12). */
export function NotaAyudaConInfo(p: { className?: string }): JSX.Element;
/** R14 — leyenda accesible bajo una gráfica: una EstadoConInfo por código, en el orden recibido. */
export function LeyendaEstadosConInfo(p: { codigos: readonly string[]; titulo: string }): JSX.Element;
```

- Todas las piezas comparten un `BotonInfo` interno (no exportado). Sus propiedades:
  - `aria-label` = `Qué significa «<nombre>»` (R23). Sin `aria-describedby` (§10-J).
  - Icono `Info` de `lucide-react` (`aria-hidden`), visual de 14 px dentro de un botón `size-4`
    `rounded-full`.
  - Área activable de 24 × 24 con `relative after:absolute after:-inset-1 after:content-['']`, que no ocupa caja
    (R26, R33).
  - Color `text-muted-foreground hover:text-foreground`. Foco `focus-visible:ring-3 focus-visible:ring-ring`,
    el opaco de `DESIGN.md`, no el `ring-ring/50` de la deuda 324 (R27).
  - `onClick`, `onPointerDown` y `onKeyDown` con `stopPropagation()`. El popup hace lo mismo (§4.1).
- Popup: `PopoverTitle` = el nombre y `PopoverDescription` = la explicación (R24).
- `EstadoConInfo` es `inline-flex items-center gap-1`, con el chip y el botón como **hermanos**. El chip
  conserva texto y color (R32), y el contraste del icono se mide contra la superficie y no contra el chip.
- `superficie="landing"` pone `tema-claro` y la paleta de la landing en el popup, e `text-asfalto-5` en el icono
  (R28).
- Retirados y desconocidos: se pinta el nombre de la 455 sin botón (R15).
- `EstatusBadge` pasa a `<EstadoConInfo codigo chipClassName={badgeVariants(...) + extra} />`, sin prop para
  apagarlo. Sus consumidores heredan el botón.
- `LeyendaEstadosConInfo` es una `<ul aria-label={titulo}>` visible con `flex flex-wrap gap-x-3 gap-y-1
  text-xs`. Cada `<li>` lleva una muestra del color de la serie (`aria-hidden`) y un `EstadoConInfo`.

---

## 4. No-regresión de la interacción (R30-R35)

### 4.1 Contenedores clicables

| Contenedor | Qué garantiza que el botón no dispara su acción |
|---|---|
| Tarjeta del mensajero (`<article onClick>`) | El `Trigger` es un `button`, que la tarjeta ya ignora, y además corta la propagación. El **popup** se portalea, pero los eventos sintéticos de React suben por el árbol de React: un toque en su texto llegaría al `onClick` de la tarjeta **sin** un `button` cerca y seleccionaría la orden. Por eso el popup también corta la propagación. |
| Fila del chat (`<button>`) | Patrón de hermano (§4.3). |
| Tablas (`DataTable`) | No hay clic de fila y la casilla vive en su celda. Se prueba que casilla y explicación son independientes. |
| Pestañas del cierre | El botón va en las filas, no en la pestaña (§5.2). |
| Diálogo del rastreo | Popover anidado en el árbol del `Dialog`. Se mide en T0.2. |
| `Collapsible` de la tarjeta satélite | El botón está fuera de su disparador. |
| Panel del filtro | §4.4. |

### 4.2 Densidad (R33)

- **Tablas:** el botón mide 16 px de caja, menos que el `Badge` más la `py-2` de la celda. La columna gana unos
  20 px de ancho.
- **Tarjetas:** el botón no cambia la altura de su cabecera.
- **Opciones de filtro:** la opción mide `py-1.5` con texto `text-sm` (unos 32 px) y el botón mide 16 px.
- Las alturas se miden en el navegador: T0.4 antes y T4.3 después.

### 4.3 Patrón de hermano

La fila del chat (`ChatOrdenesLista.tsx:67-160`) pasa a
`<div className="flex items-center"><button className="flex-1">…igual que hoy…</button><InfoEstado …/></div>`.
El contenido del botón, su nombre accesible y `aria-current` no cambian (R32).

### 4.4 Filtros de estado (R13, R31, R34)

- `FilterOption` (`FilterComponent.tsx:31`) gana `codigoEstado?: string`. `opcionesEstado`
  (`filtro-estado-def.ts:122-132`) lo rellena con `s.value`. El componente genérico no sabe qué es un estado:
  si la opción trae `codigoEstado`, pinta `InfoEstado` y si no, nada.
- **Opción** (`MultiSelectFilter.renderOpcion`, `:175-205`). El `<li>` pasa a
  `<li className="flex items-center gap-1">`: primero el `<button role="option">` de hoy (`flex-1`, contenido
  idéntico), después `<InfoEstado>` como hermano. El botón de información no está dentro de la opción, así que
  no la marca por construcción. Aun así corta la propagación, por si el `<li>` o la lista escuchan eventos.
- **Filtro aplicado.** Cuando `value.length === 1` y esa opción trae `codigoEstado`, se superpone un
  `InfoEstado` junto a la X, con la misma técnica que ya usa la X (`:232-239`). El disparador gana el padding
  derecho para los dos. Con N opciones el resumen dice «N seleccionados» y no nombra ningún estado, así que no
  lleva botón.
- **Clic fuera del panel.** El panel se cierra al pulsar fuera de `contenedorRef`, y el popup se portalea fuera
  de él. Sin cuidado, pulsar en la explicación cerraría el panel. El detector de clic fuera ignora los objetivos
  dentro de `[data-slot="estado-info-popup"]`. Alternativa, si T0.2 lo prefiere: el `container` del portal
  dentro del panel.
- **ARIA** (Abierto): dentro del listbox cada `<li>` contiene un control que no es opción. Se mide con axe en el
  recorrido. La alternativa de rediseño está en §10-D.
- **Satélite:** `satelite-ordenes-filtros.ts:87` usa la misma definición de filtro y hereda el cambio.

---

## 5. Superficies (tras la 455)

### 5.1 Con botón

| # | Superficie | Hoy | Cambio 456 |
|---|---|---|---|
| 1 | `ordenes-columns.tsx:101-108`: `/ordenes`, detalle de `/monitoreo` y «en bodega» de `/recepcion-satelite` | `EstatusBadge` | Lo hereda de `EstatusBadge`. |
| 2 | `OrdenesCargaResumen.tsx:116`, `OrdenesExistentesTabla.tsx:33`, `recibidas-columns.tsx` | `EstatusBadge` | Lo hereda. |
| 3 | Señal de pendiente en `/ordenes` y en el detalle (454 T2.2) | — | `SenalPendienteConInfo` |
| 4 | `HistorialOrdenTimeline.tsx:128-144` y clase `evento_orden` de la 454 | `estatusLabel` | `EstadoConInfo` en origen y destino. Los eventos de gestión pintan su resultado y, en una corrección, su resultado anterior, con `EstadoConInfo`. «Creación» va sin botón. |
| 5 | `IncidentesAdminModule.tsx:488` | `estatusLabel` | `EstadoConInfo` |
| 6 | `cierre-factura.tsx`: origen de una orden barrida (`:1424`) y resultado de cada fila de gestión | mapas propios | `EstadoConInfo` en los dos, también en la vista de papel y en los cierres de SF-001. |
| 7 | `SateliteOrderCard.tsx:70` y `RecepcionDetalle` | `estadoLegible` | La prop pasa a ser el código y se pinta con `EstadoConInfo`. |
| 8 | `PosCardHeader`, `PosOrderCardMosaico`, `PosOrderCardDetalle` | un rótulo por pantalla | La prop pasa a ser el código y se pinta con `EstadoConInfo`. El marcador «Gestionando ahora» / «Abierta en detalle» no lleva botón: no es un estado. |
| 9 | `GestionarOrdenPanel.tsx:873-875` | `estatusLabel` | `EstadoConInfo` |
| 10 | `ChatOrdenesLista.tsx:113-120` | chip dentro de un `<button>` | Patrón de hermano (§4.3). |
| 11 | `ChatConversacion.tsx:651-654` | `ESTADO_CHIP` | `EstadoConInfo` |
| 12 | `/novedades`: chip de estado y nota de ayuda | — | `EstadoConInfo` y `NotaAyudaConInfo`, si T0.3 confirma que se pintan. |
| 13 | `RastreoDialog.tsx:268-283` | hitos | `EstadoConInfo` con `codigoDeNombre` y `superficie="landing"`. La entrada pendiente usa `SenalPendienteConInfo`. |
| 14 | `detalle-columnas.ts:113` «Resultado del día» | `estatusLabel` | El `render` devuelve `<EstadoConInfo codigo={resultadoDelDia} />`, o «—» si es `null`. |
| 15 | Filtros de estado (`filtro-estado-def.ts`, `MultiSelectFilter.tsx`) | sin botón | §4.4 |
| 16 | `ConteoPorStatusDona.tsx:128-160` | `etiquetaDeStatus` dentro de la lista `aria-hidden` de `GraficaRanking` | `GraficaRanking` **no se toca**: su lista es `aria-hidden` y ya lleva un tooltip de recorte, así que no admite un control. Debajo de ella, `LeyendaEstadosConInfo codigos={porStatus.map(f => f.status)} titulo="Qué significa cada estado"`, en el mismo orden que las barras. |
| 17 | Otras gráficas con categorías que sean estados o resultados (T0.3: `CohorteCargaTabla` si es gráfica, `ConteoEntregasAnillo`, `HoyGestionBarras`, las de SF-001) | — | El mismo patrón que la fila 16. Si la leyenda es propia y es HTML sin `aria-hidden`, `EstadoConInfo` va en ella. |
| 18 | Nota de ayuda en el portal del mensajero («con ayuda») y en el listado o detalle de `/ordenes` si la pinta | texto | `NotaAyudaConInfo` |

### 5.2 Sin botón: rótulos de recuento, cada caso con su motivo (R16)

| Pieza | Motivo |
|---|---|
| Contadores del tablero del día (`ContadoresTablero.tsx`, resultados y cubos) | Cada contador rotula la cifra de varias gestiones. Además ya es la pieza que abre el detalle, cuyas filas llevan el botón (filas 1 y 14). Los cubos agrupan varios estados («Todavía no sale a reparto», «Otros estados»). |
| Pestañas con cifra del cierre (`cierre-factura`, `TAB_TONO`) | Una pestaña es un control (`role="tab"`): el botón iría dentro. Cada fila del panel que abre ya lleva su botón (fila 6). |
| KPI con nombre de estado (`KpisMensajero`, `KpisEfectividad`, `madurez-textos`) | Rotulan una cifra agregada del periodo, no una orden ni una gestión. |
| Encabezados de columnas numéricas (ranking e histórico, `CohorteCargaTabla` si es tabla) | Encabezan una columna de cifras. Un control en un `<th>` ordenable colisiona con su clic de orden. |
| Pestañas de `/novedades` («Novedad», «Ayuda solicitada») | Igual que las pestañas del cierre. Cada tarjeta de dentro lleva su botón (fila 12). |
| Frases: `*-error-messages.ts`, `Escaner*.tsx`, toasts, `GestionarOrdenPanel.tsx:786`, notificaciones | Un nombre dentro de un texto corrido, no un rótulo. |
| Descargas (`*-descarga-columnas.ts`) | R17. |

---

## 6. La guardia (DH) — `tests/unit/guards/estado-con-info.guardia.test.ts`

Usa el escáner de TypeScript (`ts.createSourceFile`) sobre los archivos `.ts` y `.tsx` de `app/**` y
`components/**`.

**Símbolos vigilados:** `nombreDeEstado`, `NOMBRE_ESTADO`, `nombreDeResultado`, `SENAL_PENDIENTE`,
`estatusLabel`, `ORDER_STATUS_LABELS`, `DESCRIPCION_ESTADO`, `DESCRIPCION_NOTA_AYUDA`, `descripcionDeEstado`, el
literal «Ayuda solicitada a la tienda» y los alias que deje la 455.

- **(a) Render, sin excepciones.** Falla si un símbolo vigilado aparece dentro de un `JsxExpression` o como
  cuerpo del `render` de una columna, en cualquier archivo distinto de `EstadoInfo.tsx`.
- **(b) Usos con motivo.** Toda referencia fuera de `EstadoInfo.tsx` tiene que estar en `USOS_PERMITIDOS`, con
  una de estas **cuatro** clases cerradas:
  - `frase`: mensajes de error, escáneres y toasts;
  - `descarga`: las columnas `*-descarga-columnas.ts`;
  - `recuento`: cada pieza de §5.2, una por una;
  - `control-con-hermano`: el chip de la fila del chat, `filtro-estado-def.ts`, las categorías de las gráficas
    de §5.1 filas 16-17, y `EstatusBadge.tsx` si conserva la reexportación.

  Desaparecen las clases `filtro` y `dato-de-gestion` de la primera versión.
- **(c) Hermano presente.** Cada archivo de clase `control-con-hermano` tiene que referenciar `InfoEstado`,
  `LeyendaEstadosConInfo` o `codigoEstado`. Si no, falla: una excepción sin su botón es exactamente el hueco que
  la enmienda cierra.
- **(d) Sin tooltips a mano.** Falla si un archivo distinto de `EstadoInfo.tsx` importa un popover o un tooltip
  **y** un símbolo vigilado.
- **Mutaciones en su propio archivo** (R19). Se pasan cinco fuentes sintéticas:
  - `<span>{nombreDeEstado(x)}</span>`;
  - `render: (o) => estatusLabel(o.estatus)`;
  - un uso en una ruta no permitida;
  - una excepción `control-con-hermano` sin `InfoEstado`;
  - `EstadoInfo.tsx`, que no debe marcarse.

  Las cuatro primeras se detectan; la quinta no.
- La guardia afirma que leyó **al menos un** archivo de cada ruta de §5, para que un glob roto no la deje verde
  en vacío.

---

## 7. Contraste (R27)

Se amplía `tests/unit/guards/contraste-tokens.guardia.test.ts`:
- `--muted-foreground` como indicador no textual, a 3:1 o más sobre las seis superficies y en los dos temas;
- el `--ring` opaco en `EstadoInfo`;
- `asfalto-5` sobre `kraft-inset` y `kraft-card` para el icono de la landing, y el anillo de la landing opaco.

El panel del filtro (`bg-popover`) entra como superficie si no lo está ya.

---

## 8. Tests de componentes (Testing Library, jsdom)

Precedente: `ColumnasManifiestoPopover.test.tsx`. Se usa `userEvent.setup({ advanceTimers })` con
temporizadores falsos.

| Archivo | Qué afirma |
|---|---|
| `tests/components/EstadoInfo.test.tsx` | Para los 20 estados:<br>• nombre accesible exacto;<br>• al abrir, un elemento con nombre y descripción, con la descripción comparada con el literal leído de `textos-aprobados.md`.<br>Interacción:<br>• el hover abre tras el retraso;<br>• Enter y Espacio abren;<br>• Escape cierra y devuelve el foco;<br>• pulsar fuera y el segundo clic cierran;<br>• abrir otro cierra el primero.<br>Además:<br>• retirado y desconocido van sin botón;<br>• cerrado, el texto no está en el DOM;<br>• `fetch` espiado sin llamadas;<br>• clases de área y del anillo opaco. |
| `SenalPendienteConInfo.test.tsx`, `NotaAyudaConInfo.test.tsx` | Los cinco resultados con la explicación de «En reparto». La nota con `DESCRIPCION_NOTA_AYUDA` comparada con la sección del `.md`. |
| `LeyendaEstadosConInfo.test.tsx` | Un botón por código, en el orden recibido. La lista tiene nombre accesible. |
| `EstatusBadgeInfo.test.tsx` | Para los 20: mismo nombre y mismas clases que antes, y botón presente. |
| `PosOrderCardInfoEstado.test.tsx` | En las tarjetas completa, mosaico y detalle:<br>• ni el botón, ni el texto del popup, ni Enter o Escape dentro llaman a `onGestionar`;<br>• pulsar la tarjeta sí lo llama. |
| `ChatOrdenesListaInfoEstado.test.tsx` | El nombre accesible de la fila sigue intacto. El botón no llama a `onSeleccionar`. No hay un `button` dentro de otro `button`. |
| `HistorialOrdenTimelineInfo.test.tsx` | Origen y destino con botón. Evento registrado con botón en su resultado; corregido, con botón en el anterior y en el nuevo. «Creación» y un estado retirado sin botón. |
| `CierreFacturaInfo.test.tsx` (amplía `CierreFacturaSinGestionar`) | El origen de una orden barrida y cada fila de resultado llevan botón. Las pestañas no lo llevan, y pulsar un botón de fila no cambia la pestaña. |
| `DetalleColumnasResultadoInfo.test.tsx` | «Resultado del día» con botón; `null` se pinta «—» sin botón. |
| `MultiSelectFilterInfoEstado.test.tsx` | Cada opción con `codigoEstado` lleva botón; sin `codigoEstado`, no. Al pulsar el botón:<br>• `onChange` no se llama y `aria-selected` no cambia;<br>• el panel sigue abierto.<br>Dentro de la explicación: pulsar y Escape no cambian la selección, y Escape cierra solo la explicación.<br>Filtro aplicado: con una opción, botón junto a la X y la X sigue limpiando; con N opciones, sin botón. Opciones, nombres y orden, idénticos. |
| `ConteoPorStatusDonaInfo.test.tsx` | Leyenda propia con un botón por estado presente, en el orden de las barras. Cifras y barras idénticas. La lista `aria-hidden` sigue sin controles. |
| `RastreoDialogInfoEstado.test.tsx` | Estado vigente, entradas y pendiente con botón. Pulsar dentro de la explicación no cierra el diálogo ni borra el resultado. Con `.dark` en `<html>`, el popup lleva `tema-claro`. |
| `SateliteOrderCardInfo`, `GestionarOrdenPanelInfo`, `IncidentesAdminInfo`, `ChatConversacionInfo`, novedades (si aplica) | Botón presente. El `Collapsible` abre solo con su disparador. |
| No-regresión | Las columnas de las descargas, idénticas. `DataTable` con casilla: marcar la casilla y abrir la explicación no interfieren. `ContadoresTablero`, las pestañas del cierre y los KPI: 0 botones «Qué significa». |

---

## 9. Recorrido en navegador

- Herramienta: Playwright MCP, con un solo dev server.
- Datos en la base local:
  - una orden en cada uno de los 20 estados;
  - una gestión pendiente de cada resultado;
  - un cierre aprobado con los cinco resultados;
  - una corrección de resultado;
  - una ayuda abierta;
  - una orden barrida;
  - un estado retirado en el historial.
- Móvil: 390 × 844 con `hasTouch`, usando `tap()`.
- Texto: `textContent` comparado con el `.md`.
- Accesibilidad: axe sobre el panel del filtro abierto (Abierto de ARIA).
- Densidad: las alturas de T0.4, antes y después.

Detalle por rol en `tasks.md` T4.3.

---

## 10. Alternativas descartadas

### A · El tooltip existente
**Descartada**: no se abre con el dedo, y el mensajero y el rastreo son móviles. Además su contenido no es un
elemento con nombre (R24).

### B · Un tooltip escrito en cada pantalla
**Descartada**: más de 20 superficies divergirían, y ninguna guardia podría afirmar que todas pasan por un
mismo sitio.

### C · Meter el botón dentro de la lista de `GraficaRanking`
Sería la solución «en su sitio». **Descartada**:
- esa lista es `aria-hidden` (un control enfocable dentro de `aria-hidden` es un fallo de accesibilidad);
- cada nombre ya es disparador de un tooltip de recorte, y el botón quedaría dentro de otro disparador;
- `GraficaRanking` también sirve al ranking de mensajeros y de productos.

La leyenda propia bajo la gráfica cumple R14 sin tocar el componente genérico.

### D · Rediseñar el filtro como grupo de casillas en vez de listbox
Haría válido el ARIA de «opción + botón». **Descartada** por ahora, porque es rediseñar el filtro compartido de
todas las pantallas (memoria «Arreglar lo evidenciado, no rediseñar»). Si axe marca un fallo **serio** en T4.3,
se abre ficha propia.

### E · Columna «Descripción del estado» en las descargas
**Descartada**: es una columna de 20 textos constantes repetida en cada fila, y cambiaría las columnas
publicadas (ficha 314).

### F · Un texto propio para la señal de pendiente
**Descartada**: el texto de «En reparto» ya la explica.

### G · Botón también en los rótulos de recuento
**Descartada** caso por caso en §5.2. Cada cifra agrega órdenes o gestiones que ya llevan su botón donde se
listan, y dos de las piezas (pestañas y encabezados ordenables) son controles. Queda en Abierto, por si el
humano los quiere.

### H · Enviar la explicación en la respuesta del rastreo
**Descartada**: cambia una respuesta pública que la 455 acaba de fijar, y el texto ya está en el bundle.

### I · Una prop `sinInfo` en `EstatusBadge`
**Descartada**: abre la puerta a apagar el botón pantalla por pantalla.

### J · `aria-describedby` en el botón
**Descartada**: con el foco pasando por la columna, el lector de pantalla leería 58 palabras por fila.

### K · Omitir la nota de ayuda hasta tener un texto aprobado
Es lo que hacía la primera versión de este spec. **Revertida por la enmienda**: el texto va marcado como
pendiente de visto bueno, y su test obliga a que la fuente y el `.md` sigan iguales si el humano lo cambia.

---

## 11. Riesgos

1. **Clics fantasma por el portal** (§4.1, §4.4): se cubren con tests que pulsan el texto del popup dentro de una
   tarjeta y dentro del panel del filtro.
2. **Más paradas de tabulación** en tablas, filtros y leyendas. Es un coste aceptado y se anota en la revisión.
3. **Explicación del estado junto a un resultado aún sin aprobar** (Abierto de `requirements.md`).
4. **La 455 se mueve**: T0.3 vuelve a medir. Lo que cambie se anota como decisión.
5. **Base UI y el toque** (§2): se mide en T0.2.
6. **La G4 de la 455 y la tabla nueva del `.md`** (§1.2): se comprueba en T0.1.
