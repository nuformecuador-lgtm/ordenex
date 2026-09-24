# Feature 456 — Botón de información que explica cada estado

> Pedida y aprobada por el humano el 2026-09-23 (la autorización cubre este spec de antemano: sin preguntas
> bloqueantes; lo no confirmable va en «Abierto»). Zona `frontend`, `depends_on: 455` (que a su vez depende de
> la 454). Se construye **sobre el resultado de las dos**: 20 estados con los códigos y nombres de
> `specs/455-un-nombre-por-estado/requirements.md` §0.1, sin `devolucion_por_confirmar` ni `ayuda_tienda`, y la
> gestión pendiente mostrada como «<resultado> · pendiente de confirmación». Sale a `prod` **junto con SF-001,
> la 454 y la 455, solo cuando el humano lo ordene**.
>
> Textos: `specs/456-tooltip-estados/textos-aprobados.md`. Su tabla de los 20 estados está aprobada por el
> humano y no se edita. Su sección «Pendiente de visto bueno del humano» contiene el texto de la nota de ayuda.
> Diseño en `design.md`, desglose en `tasks.md`.
>
> La regla del humano, literal: el botón está «para TODOS los lugares donde se muestren los mismos estados»,
> para todos los roles y en el rastreo público. Transparencia: **mismo texto para todos**.
>
> **Enmienda del 2026-09-23 (coordinador).** Ahora llevan botón la analítica, los filtros de estado (opciones y
> filtro ya aplicado), los resultados de gestión que muestran el nombre de un estado y la nota de ayuda.

## 0. Términos y alcance

### 0.1 Glosario

- **Explicación**: el texto que dice qué significa un estado (una por estado vigente) o la nota de ayuda.
- **Botón de información**: el control que acompaña a un nombre y da acceso a su explicación.
- **Nombre de estado**: un nombre visible de la tabla §0.1 de la 455, sea el estado de una orden o el resultado
  homónimo de una gestión (455 §0.2).
- **Señal de pendiente**: el texto «<resultado> · pendiente de confirmación» (455 R33).
- **Nota de ayuda**: el texto «Ayuda solicitada a la tienda» sobre una orden con ayuda abierta (454/455).
- **Rótulo de recuento**: un texto que rotula una cifra que agrega varias órdenes o gestiones (contador,
  pestaña con cifra, KPI, encabezado de columna numérica).
- **Estado retirado / no reconocido**: los de la 455 R10/R11.
- **Superficie visible**: la definición de la 455 §1.

### 0.2 Qué lleva botón y qué no

| Lleva botón | No lleva botón (con su motivo) |
|---|---|
| El estado de una orden concreta, en cualquier pantalla y rol, incluido el rastreo público (R9). | Rótulos de recuento: contadores del tablero del día, pestañas con cifra de un cierre, KPI y encabezados de columnas numéricas. Cada caso se justifica en `design.md` §5.2 (R16). |
| El resultado de una gestión cuando muestra un nombre de estado: filas de un cierre, «Resultado del día» del monitoreo, eventos de gestión de la línea de tiempo (R10). | Nombres dentro de una frase (errores, avisos, confirmaciones, notificaciones, WhatsApp) o de un nombre accesible (R16). |
| La señal de pendiente (R11) y la nota de ayuda (R12). | Descargas CSV/XLSX/PDF (R17). |
| Cada opción de los filtros de estado, y el filtro ya aplicado cuando muestra un único estado (R13). | Estados retirados y «Estado no reconocido»: no tienen texto aprobado (R15). |
| Las categorías y leyendas de las gráficas de analítica que nombran estados o resultados (R14). | |

### 0.3 Inventario mínimo de superficies con botón (medido 2026-09-23; `tasks.md` T0.3 lo vuelve a medir sobre la 455)

1. `/ordenes`: chip de la columna «Estado» y detalle de la orden. Aplica a maestro, admin y adminTienda.
2. Resumen de la carga masiva y tabla de órdenes existentes de la carga.
3. Línea de tiempo de la orden: origen y destino de cada transición, y eventos de gestión de la 454.
4. `/monitoreo`: columna «Estado» y columna «Resultado del día» del detalle del día.
5. `/incidentes`: «Estado de la orden» del detalle.
6. `/cierres-admin` y cierres de SF-001:
   - estado de origen de una orden barrida;
   - resultado de cada fila de gestión.
7. `/recepcion-satelite`:
   - tarjetas de «por recibir» (cabecera y detalle desplegable);
   - listados «en bodega» y «recibidas».
8. Portal del mensajero:
   - chip de estado de las tarjetas (completa, mosaico y detalle);
   - cabecera del panel «Gestionar orden»;
   - nota de ayuda.
9. Chat del mensajero: lista de conversaciones y cabecera de la conversación.
10. `/novedades` de la tienda: chip de estado y nota de ayuda, si tras la 454/455 se pintan (lo confirma T0.3).
11. Filtros de estado de `/ordenes` y de la bodega satélite: cada opción y el filtro aplicado.
12. `/analitica`: «Conteo por estado» y cualquier otra gráfica cuyas categorías sean estados o resultados.
13. Rastreo público (`/` → «Rastrear envío»): estado vigente, cada entrada de la línea y la señal de pendiente.
14. Cualquier otra superficie que T0.3 encuentre mostrando un nombre de estado fuera de los casos de «No lleva».

---

## A. La explicación

- **R1** — El sistema DEBE tener, para cada uno de los 20 estados vigentes, exactamente una explicación,
  declarada en una única fuente junto al nombre visible del estado.
- **R2** — La explicación de cada estado DEBE ser literalmente igual a la de su fila en la tabla aprobada de
  `specs/456-tooltip-estados/textos-aprobados.md`.
- **R3** — SI se añade al catálogo un estado vigente sin explicación, ENTONCES el typecheck DEBE fallar.
- **R4** — La explicación de «Novedad» DEBE expresar el plazo de reintento de «cliente no localizado» y el
  plazo de devolución de «número o dirección errados» con los valores vigentes de la configuración de plazos de
  devolución.
- **R5** — CUANDO cambie uno de esos dos plazos en la configuración, la explicación mostrada de «Novedad» DEBE
  cambiar con él sin que nadie edite el texto, y la suite DEBE fallar hasta que la tabla de
  `textos-aprobados.md` refleje el plazo nuevo.
- **R6** — La explicación de «Novedad» NO DEBE contener el número de intentos de entrega.
- **R7** — El sistema DEBE mostrar la misma explicación de un mismo estado en todas las superficies, a todos los
  roles y en el rastreo público.
- **R8** — El sistema DEBE tener una única explicación de la nota de ayuda, declarada junto a las de los estados
  y literalmente igual a la de la sección «Pendiente de visto bueno del humano» de `textos-aprobados.md`.

## B. Dónde aparece

- **R9** — CUANDO una superficie visible muestre el nombre del estado de una orden concreta, el sistema DEBE
  mostrar junto a ese nombre un botón de información que da acceso a la explicación de ese estado.
- **R10** — CUANDO una superficie visible muestre el resultado de una gestión con un nombre de estado, fuera de
  un rótulo de recuento, el sistema DEBE mostrar junto a él un botón de información con la explicación de ese
  estado.
- **R11** — CUANDO una superficie visible muestre la señal de pendiente, el sistema DEBE mostrar junto a ella un
  botón de información cuya explicación es la del estado «En reparto».
- **R12** — CUANDO una superficie visible muestre la nota de ayuda, el sistema DEBE mostrar junto a ella un
  botón de información con la explicación de R8.
- **R13** — El sistema DEBE mostrar un botón de información en cada opción de un filtro de estado. Además,
  CUANDO el filtro de estado aplicado muestre el nombre de un único estado, el sistema DEBE mostrar un botón de
  información junto a ese nombre.
- **R14** — CUANDO una gráfica de analítica muestre categorías o leyendas que nombran estados o resultados, el
  sistema DEBE mostrar un botón de información junto a cada uno de esos nombres, dentro de la leyenda de la
  gráfica o en una leyenda accesible propia situada bajo ella.
- **R15** — SI el estado mostrado es un estado retirado o «Estado no reconocido», ENTONCES el sistema NO DEBE
  mostrar botón de información y DEBE seguir mostrando el nombre como lo define la 455.
- **R16** — El sistema NO DEBE mostrar botón de información en los rótulos de recuento enumerados en
  `design.md` §5.2, en nombres dentro de una frase ni en nombres accesibles.
- **R17** — Las descargas NO DEBEN ganar ni perder columnas por esta ficha.
- **R18** — SI un archivo de `app/` o `components/` muestra un nombre de estado, la señal de pendiente o la
  nota de ayuda sin pasar por el componente compartido, fuera de una lista de excepciones con motivo escrito,
  ENTONCES la suite DEBE fallar nombrando el archivo.
- **R19** — La guardia de R18 DEBE ponerse roja ante una mutación que pinta un nombre de estado sin el
  componente compartido, y ante una excepción que no ofrece su botón hermano (se prueba en su propio archivo).

## C. Interacción y accesibilidad

- **R20** — CUANDO el usuario pase el puntero sobre el botón de información, el sistema DEBE mostrar la
  explicación.
- **R21** — CUANDO el usuario pulse o toque el botón de información, el sistema DEBE abrir la explicación y
  DEBE mantenerla abierta hasta que el usuario pulse o toque fuera de ella, vuelva a pulsar el botón o presione
  Escape.
- **R22** — CUANDO el botón de información tenga el foco de teclado y el usuario presione Enter o Espacio, el
  sistema DEBE abrir la explicación. CUANDO el usuario presione Escape con la explicación abierta, el sistema
  DEBE cerrarla y devolver el foco al botón.
- **R23** — El botón de información DEBE ser alcanzable con la tecla Tab y DEBE tener como nombre accesible
  «Qué significa «<nombre>»». Para la señal de pendiente, el nombre DEBE ser «pendiente de confirmación»; para
  la nota de ayuda, «Ayuda solicitada a la tienda».
- **R24** — MIENTRAS la explicación esté abierta, el sistema DEBE exponerla a las tecnologías de asistencia
  como un elemento cuyo nombre es el nombre explicado y cuya descripción es la explicación.
- **R25** — CUANDO se abra la explicación de un botón, el sistema DEBE cerrar cualquier otra explicación que
  estuviera abierta.
- **R26** — El área activable del botón de información DEBE medir al menos 24 × 24 px CSS.
- **R27** — El indicador de foco del botón DEBE tener un contraste de al menos 3:1 contra el fondo adyacente, y
  el icono de al menos 3:1 contra su fondo, en tema claro y en tema oscuro.
- **R28** — MIENTRAS la explicación esté abierta en el rastreo público, el sistema DEBE pintarla con la paleta
  clara de la landing, sea cual sea el tema elegido por el visitante.
- **R29** — Abrir o cerrar una explicación NO DEBE hacer ninguna petición de red.

## D. No-regresión

- **R30** — CUANDO el usuario active el botón de información, o pulse, toque o use el teclado dentro de la
  explicación abierta, el sistema NO DEBE disparar la acción del elemento que lo contiene. Esto incluye:
  seleccionar o gestionar una tarjeta del mensajero, abrir una conversación del chat, cambiar de pestaña,
  marcar la casilla de una fila, abrir un detalle o navegar.
- **R31** — CUANDO el usuario active el botón de información de una opción o del filtro aplicado, o interactúe
  dentro de su explicación, el sistema NO DEBE marcar ni desmarcar ninguna opción, NO DEBE cambiar el filtro
  aplicado y NO DEBE cerrar el panel del filtro.
- **R32** — El nombre visible, el color y el nombre accesible de cada estado DEBEN ser los mismos que antes de
  la ficha. Esto se aplica a chips, filas, tarjetas, opciones de filtro y botones existentes.
- **R33** — La altura NO DEBE aumentar por el botón de información en:
  - las filas de las tablas con columna de estado;
  - las cabeceras de las tarjetas del portal del mensajero y de la bodega satélite;
  - las opciones del filtro de estado.
- **R34** — Los filtros de estado DEBEN ofrecer las mismas opciones, con los mismos nombres y en el mismo orden,
  y devolver las mismas órdenes que antes de la ficha.
- **R35** — CUANDO el visitante interactúe con una explicación dentro del diálogo de rastreo público, el sistema
  NO DEBE cerrar el diálogo ni borrar el resultado consultado.
- **R36** — Ningún rol DEBE ganar ni perder acceso a pantallas, acciones o datos por esta ficha, y la respuesta
  del rastreo público NO DEBE cambiar de forma.
- **R37** — Las cifras, barras y el orden de las gráficas de analítica DEBEN ser los mismos que antes de la
  ficha. Solo se añaden los botones o la leyenda propia.

---

## Supuestos medidos (2026-09-23, árbol de `feature/454-backend`; se vuelven a medir sobre la 455 en T0)

- **Primitivos:**
  - `components/ui/tooltip.tsx` es de `@base-ui/react/tooltip` 1.6 (no Radix).
  - `@base-ui/react/popover` ya se usa directamente en 6 componentes compartidos.
  - No existe `components/ui/popover.tsx`.
- **Textos y plazos:**
  - Hoy no existe ninguna explicación por estado.
  - Plazos de «Novedad»: `lib/config/devolucion-sla.ts` (5 días / 24 h; no se configuran por entorno).
  - Tope de intentos: `lib/config/reintentos.ts` (`MIN_INTENTOS_ENTREGA`, configurable por entorno).
- **Contenedores clicables:**
  - La tarjeta del mensajero es un `<article>` clicable que ignora los clics nacidos en `a, button, input,
    summary, label`.
  - La fila del chat es un `<button>` entero (`ChatOrdenesLista.tsx:67`).
  - La tabla compartida (`DataTable`) no tiene clic de fila.
- **Filtros:**
  - Cada opción de `MultiSelectFilter` es un `<button role="option">` (`MultiSelectFilter.tsx:181-202`).
  - El filtro aplicado se ve como resumen dentro del botón disparador, con su nombre si hay una sola opción
    (`:167-172`).
  - La X de limpiar ya va superpuesta como hermana del disparador (`:232-239`).
- **Analítica:** «Conteo por estado» pinta sus categorías en una lista **`aria-hidden`** de `GraficaRanking`
  (`GraficaRanking.tsx:102-125`), que ya envuelve cada nombre en un tooltip de recorte. Ahí no cabe un control.
- **Rastreo público:** se pinta dentro de un `Dialog` con `tema-claro` explícito
  (`RastreoDialog.tsx:29-36`).

## Fuera de alcance

- Cambiar nombres, códigos o colores de estados (455), y el modelo de gestión pendiente (454).
- Una página de glosario en `docs/ayuda/**` o en el asistente (436).
- Explicaciones de etiquetas de grupo que no son un estado («Todavía no sale a reparto», «Otros estados») y de
  métricas («Efectividad»).
- WhatsApp, notificaciones y la API por API key: no tienen interfaz donde poner un botón.
- Arreglar el anillo de foco del resto de la app (ficha 324). Esta ficha solo se obliga a no empeorarlo.

## Decisiones (alternativa en `design.md` §10)

1. **Popover que se abre al pasar el puntero y al tocar**, no tooltip. El tooltip no se abre con el dedo (R20,
   R21).
2. **La señal de pendiente usa el texto aprobado de «En reparto»**, que ya habla de «pendiente de
   confirmación» (R11).
3. **Descargas sin columna de explicación** (R17).
4. **Rótulos de recuento sin botón** (R16), caso por caso en `design.md` §5.2. Motivo: rotulan una cifra de
   varias órdenes, y cada orden o gestión contada ya lleva el botón donde se lista.
5. **Opciones de filtro y gráficas con botón como hermano del control**, nunca dentro de él (un control no
   puede contener otro). En la analítica va en una leyenda propia bajo la gráfica, porque la lista de la gráfica
   es `aria-hidden`.

## Abierto (no bloquea; se anota en `progress/` y el reviewer se lo presenta al humano)

- **Visto bueno del humano al texto de la nota de ayuda** (R8, sección «Pendiente de visto bueno» de
  `textos-aprobados.md`). Si el humano lo cambia, se cambia la sección y el test de R8 obliga a actualizar la
  fuente.
- **Resultado sin aprobar con la explicación del estado** (R10, enmienda). Los textos describen el estado ya
  confirmado («… y la bodega lo confirmó al aprobar el cierre»). Junto al resultado de una gestión aún pendiente
  (una fila de un cierre sin aprobar, «Resultado del día»), esa explicación adelanta lo que pasará al aprobar el
  cierre. Es lo que pidió la enmienda y queda anotado para el humano.
- **Los rótulos de recuento siguen sin botón** (decisión 4). Si el humano también los quiere, se usa el mismo
  patrón de hermano.
- **Popover en el móvil:** que el popover de `@base-ui/react` 1.6 se abra al tocar en un móvil real, dentro del
  `Dialog` del rastreo y dentro del panel del filtro, sin cerrar ninguno de los dos. Se **mide** en T0.2.
- **Listbox del filtro:** el filtro de estado deja de ser un listbox «puro», porque cada `<li>` contiene la
  opción y su botón hermano. Se mide con axe en el recorrido; la alternativa de rediseño está en `design.md`
  §10-D.
