# Ficha 314 — la descarga del listado de órdenes deja elegir qué columnas salen · design.md

Cómo se implementa lo que `requirements.md` pide. Sin código de producción: esto es la decisión
previa. Todo lo afirmado aquí sobre el árbol está verificado en los archivos reales del worktree
(`R:/wt314`), no en el índice del grafo.

**El cambio mínimo de esta ficha es GENERALIZAR el mecanismo que ya existe (feature 194), no
escribir otro.** Cada pieza nueva de abajo es la misma pieza de hoy con un parámetro más.

---

## §0 — Decisiones de arranque

| # | Decisión | Por qué |
| --- | --- | --- |
| **D1** | La preferencia sigue viviendo en el **dispositivo** (`localStorage`), no en base de datos. Ni tabla, ni RLS, ni migración. | Es lo que ya hace la 194 y lo que `specs/146` declara fuera de alcance. Esta ficha no abre esa puerta: es frontend puro, y el propio encargo lo fija («ni un campo nuevo de backend»). |
| **D2** | Se guardan las columnas **OCULTAS** (lista de exclusión), y ahora **además** un **orden PARCIAL**. Las dos listas son parciales a propósito. | Es la propiedad que la 194 razonó en la cabecera de `lib/manifiesto/preferencia-columnas.ts:8-22` y que esta ficha NO puede perder: lo que no está guardado se resuelve *por el catálogo*, así que una columna publicada mañana aparece sola y cae en su sitio. Ver §3. |
| **D3** | **La clave de almacenamiento del manifiesto NO se toca**: sigue siendo `ordenex:manifiesto-columnas:<flujo>`, byte por byte. El ámbito nuevo estrena la suya: `ordenex:descarga-columnas:<ambito>`. | El manifiesto es superficie viva en producción. Mover el prefijo huerfanaría en silencio todas las preferencias guardadas hoy en el navegador de la gente: no fallaría nada, simplemente volverían todas las columnas. Un fallo mudo. |
| **D4** | El **formato guardado se AMPLÍA de forma aditiva**: `{"ocultas":[…]}` → `{"ocultas":[…],"orden":[…]}`, con `orden` **omitido cuando está vacío**. | Compatible hacia atrás **y hacia delante** (§2). Sin versionado, sin migración, sin código de migración que alguien tenga que acordarse de borrar. |
| **D5** | El mecanismo se generaliza sobre la **clave de columna (`string`)**, que es el mínimo común denominador de `XlsxColumn.key` y `DescargaColumna.clave`. Los dos mundos se tocan en **dos accesores** (`claveDe`, `etiquetaDe`), no en un tipo común nuevo. | Es el nudo técnico de la ficha. Inventar un tipo `ColumnaElegible` obligaría a adaptar 35 catálogos o a mapear en cada llamada; dos funciones de una línea no obligan a nada. |
| **D6** | Se **enciende con un `string`**: `DataTableDescarga` gana `ambitoColumnas?: string`. Sin ámbito no hay selector y salen todas las columnas (R33). | Encender otra tabla mañana = **una línea** en su módulo (decisión 1 del humano). Un `string` no mete dominio en el `DataTable`; ver §7 y la guardia que hay que ampliar. |
| **D7** | El **catálogo de órdenes se amplía a 22 columnas** y `COLUMNAS_DESCARGA_ORDENES` **no se mueve de archivo ni de nombre**. | `tests/unit/descarga/columnas-asercion-de-orden.guardia.test.ts:156` afirma su ruta exacta como canario del detector. Moverla pondría roja una guardia por un motivo que no tiene nada que ver con esta ficha. |
| **D8** | **Reordenar vive en el componente**, no en cada pantalla: un solo selector, con el mismo comportamiento en manifiesto y en órdenes (decisión 3 del humano). | Un selector con dos comportamientos según quién lo monta es la clase de bifurcación que nadie recuerda al mes siguiente. |

---

## §1 — Mapa de archivos

**Se crea**

| Archivo | Qué es |
| --- | --- |
| `lib/columnas/preferencia-columnas.ts` | Módulo **puro** generalizado: lectura/saneo/orden efectivo/escritura. Sin React, sin dominio, sin `ManifiestoFlujo`, sin `XlsxColumn`. |
| `hooks/usePreferenciaColumnas.ts` | Hook genérico (`useSyncExternalStore` sobre el string crudo), con `alternar`, `mover` y `restablecer`. |
| `components/shared/ColumnasPopover.tsx` | El selector, genérico y **con reordenar**. |

**Se modifica**

| Archivo | Cambio |
| --- | --- |
| `lib/manifiesto/preferencia-columnas.ts` | Queda como **binding del ámbito manifiesto**: `claveColumnas(flujo)` (idéntica) + el descriptor del ámbito. La maquinaria se va al módulo genérico. |
| `hooks/usePreferenciaColumnasManifiesto.ts` | Envoltorio de 10 líneas sobre el hook genérico. Misma firma pública, más `mover`. |
| `components/shared/ColumnasManifiestoPopover.tsx` | Envoltorio sobre `ColumnasPopover`: conserva su `aria-label`, su título y su formato de etiqueta `Etiqueta (clave_maquina)`. |
| `lib/utils/manifiesto-xlsx.ts` | `columnasAEmitir` pasa a **respetar el orden recibido** (§6). Deroga 194/R8; ver §10/A0. |
| `components/shared/DataTable.tsx` | `DataTableDescarga` gana `ambitoColumnas?: string` y se pasa al botón. |
| `components/shared/DescargarDatasetButton.tsx` | Resuelve las columnas efectivas y monta el selector cuando hay ámbito. |
| `app/(app)/ordenes/_components/ordenes-descarga-columnas.ts` | Catálogo a 22 columnas + `AMBITO_DESCARGA_ORDENES`. |
| `app/(app)/ordenes/_components/OrdenesModule.tsx` | Una línea: `ambitoColumnas: AMBITO_DESCARGA_ORDENES`. |

**No se toca** (y es parte del diseño que no se toque): `lib/types/descarga.ts`, `lib/types/orden.ts`,
`lib/services/`, `lib/actions/`, `lib/repositories/`, `db/`, `lib/utils/descarga-dataset.ts`,
`lib/manifiesto/columnas-publicadas.ts`, `lib/manifiesto/etiquetas-columnas.ts`, y las otras 24
tablas del `DataTable`.

> Efecto lateral buscado: sin tocar `lib/types/**` ni ninguna ruta con nombre de dinero, el diff no
> dispara la negativa de `./init.sh --rapido` (`init.sh:135`). El gate completo se corre igual al
> final (tasks T17).

---

## §2 — Modelo de datos (no hay base de datos)

No hay tablas, ni RLS, ni migraciones: la preferencia es un dato de **presentación por dispositivo**.

**Claves de almacenamiento**

```
ordenex:manifiesto-columnas:<flujo>     ← YA EXISTE. No se toca. (7 flujos de manifiesto)
ordenex:descarga-columnas:<ambito>      ← nueva. Hoy un solo valor: "ordenes"
```

R10 sale de aquí por construcción: dos ámbitos jamás comparten clave, y nadie escribe una clave que
no sea la suya.

**Valor guardado**

```jsonc
{ "ocultas": ["notas", "peso"], "orden": ["numGuia", "estatus", "numRemision", …] }
```

- `ocultas`: claves que NO salen. Ausencia = sale. **Es la propiedad que no se pierde.**
- `orden`: orden explícito del usuario. **Opcional**, y se **omite del JSON cuando está vacío**.
- Ninguno de los dos es una lista cerrada: lo que no figure se resuelve contra el catálogo (§3).

**Qué pasa con lo que ya está guardado hoy en el navegador de la gente** (la pregunta que el encargo
exige responder, no mencionar):

| Situación | Qué ocurre | Por qué |
| --- | --- | --- |
| Preferencia vieja `{"ocultas":["telefono"]}` | Sigue valiendo entera. `orden` ausente → `[]` → el orden efectivo **es el del catálogo**, que es exactamente lo que ese usuario ve hoy. **Cero migración.** | R30. El algoritmo de §3 con `orden = []` devuelve el catálogo tal cual: no es un caso especial, es el caso general con la lista vacía. |
| Preferencia nueva leída por **código viejo** (rollback de la ficha) | El código de la 194 hace `JSON.parse` y lee **solo** `parseado.ocultas`; un campo extra se ignora sin ruido (`preferencia-columnas.ts:87-89`). El usuario pierde su orden, conserva sus ocultas. | Compatibilidad **hacia delante**. Es la dirección que muerde de verdad: un revert no puede dejar a nadie sin descarga. |
| Preferencia con `orden` corrupto | Se degrada **campo a campo**: `orden` inválido → `[]`; `ocultas` sigue valiendo si es legible. | R31: nunca se impide la descarga, y no se tira lo que sí se entiende. |
| Clave guardada que ya no existe en el catálogo | Se ignora al resolver, y se cae sola del `orden` la próxima vez que se escriba. | R29. |

---

## §3 — El nudo: un orden explícito y una columna publicada después

Hoy no hay orden guardado, así que una columna nueva «aparece sola» **y en su sitio**, porque el
sitio lo pone el catálogo. Un orden explícito guardado reabre el *dónde cae*. La respuesta:

> **El orden guardado no sustituye al catálogo: lo enmienda.** Se guarda una lista **parcial**, y
> toda clave publicada que no figure en ella se **intercala en el sitio que el catálogo le da,
> relativo a lo que el usuario sí ordenó**.

### Algoritmo `ordenEfectivo(crudo, clavesPublicadas)`

```
conocidas ← orden guardado, saneado: solo strings, deduplicado,
            y solo las que siguen publicadas            (R29)
resultado ← [...conocidas]

para cada clave K de clavesPublicadas, EN ORDEN DE CATÁLOGO:
    si K ya está en resultado → continuar
    ancla ← la última clave del catálogo ANTERIOR a K que esté en resultado
            (se busca hacia atrás; cuentan también las ya intercaladas en esta pasada)
    si no hay ancla → insertar K en la posición 0            (R28)
    si no            → insertar K justo después de ancla     (R27)

devolver resultado
```

Cuatro propiedades, y ninguna es un caso especial del código:

1. **`orden` vacío ⇒ el catálogo tal cual.** Todas las claves son «nuevas», cada una se inserta tras
   su predecesora, y sale el catálogo íntegro. Por eso R16 y R30 **no necesitan una rama propia**:
   son el caso general con la lista vacía. Un `if (sinPreferencia) return publicadas` sería código
   que se puede romper sin que se note; esto no existe como camino aparte.
2. **Una columna nueva aparece marcada.** La visibilidad la decide **solo** `ocultas`, y la clave
   nueva no está en la lista de ocultas de nadie (R26). Igual que hoy.
3. **Una columna nueva cae junto a su vecina de catálogo**, esté donde esté esa vecina en el orden
   del usuario. Si el usuario movió «Producto» al principio, «Peso (kg)» —publicada después— aparece
   junto a «Producto», no al final (R27).
4. **Dos columnas nuevas consecutivas conservan su orden relativo**, porque el ancla se busca entre
   lo ya intercalado en la misma pasada. Sin eso, insertar dos veces en la posición 0 las dejaría
   invertidas.

### Casos, con el catálogo `[a, b, c, d]`

| `orden` guardado | Publicadas | Resultado | Requisito |
| --- | --- | --- | --- |
| *(ausente)* | `a b c d` | `a b c d` | R16, R30 |
| `d c b a` | `a b c d` | `d c b a` | R19, R20 |
| `d b a` | `a b c d` (`c` es nueva) | `d b c a` — `c` va tras `b`, su predecesora presente | R27 |
| `d c b` | `a b c d` (`a` es nueva) | `a d c b` — `a` no tiene predecesora | R28 |
| `d b` | `a b c d` (`a` y `c` nuevas) | `a d b c` | R27 + R28 |
| `d z b` | `a b c d` (`z` no existe) | `a d b c` — `z` ignorada | R29 |
| `["ocultas":["b"]]` sin `orden` | `a b c d` | orden `a b c d`, archivo `a c d` | R30 |

La lista **visible** es el orden efectivo filtrado por `ocultas`, en ese mismo orden. El **selector**
muestra el orden efectivo **entero** (marcadas y desmarcadas), que es lo que hace posible mover una
columna desmarcada (R25).

---

## §4 — Contrato del módulo puro `lib/columnas/preferencia-columnas.ts`

Sin React, sin DOM más allá de `window.localStorage`, sin dominio. **Nunca lanza** (R31).

```ts
export interface PreferenciaColumnas {
  readonly ocultas: readonly string[];
  readonly orden: readonly string[];      // [] = "sin orden guardado"
}

/** null si no hay `window`, no hay valor, o el almacenamiento lanza. */
export function leerCrudo(clave: string | null): string | null;

/** Saneo campo a campo contra las claves publicadas. Nunca lanza (R29, R31). */
export function sanearPreferencia(
  crudo: string | null,
  publicadas: readonly string[],
): PreferenciaColumnas;

/** TODAS las publicadas, en el orden efectivo del §3. Base del selector (R18-R25). */
export function ordenEfectivo(
  crudo: string | null,
  publicadas: readonly string[],
): string[];

/** Las que salen en el archivo, en el orden efectivo (R4, R5, R20). */
export function clavesVisiblesEnOrden(
  crudo: string | null,
  publicadas: readonly string[],
): string[];

/** Reordena una lista de columnas por claves. Genérico: aquí se tocan los dos mundos (D5). */
export function columnasEnOrden<T>(
  publicadas: readonly T[],
  claves: readonly string[],
  claveDe: (columna: T) => string,
): T[];

/** Escribe SOLO esa clave. `orden` vacío ⇒ se omite del JSON. Nunca lanza. */
export function guardar(clave: string | null, preferencia: PreferenciaColumnas): void;
```

**Invariantes que el módulo debe cumplir y sus tests deben morder**

- `clavesVisiblesEnOrden` **nunca devuelve vacío** si `publicadas` no lo está: si `ocultas` las
  taparía todas, `ocultas` se degrada a `[]` (regla ya viva hoy, `preferencia-columnas.ts:103`).
- **Ningún número fijo** (R35): todo se compara clave a clave contra el parámetro `publicadas`. El
  módulo funciona igual con 3, 13 o 22 columnas y sus tests usan catálogos sintéticos.
- **Serialización exacta**: `JSON.stringify({ ocultas })` cuando no hay orden;
  `JSON.stringify({ ocultas, orden })` cuando lo hay. `ocultas` primero, siempre.
  Esto **no es cosmético**: `tests/components/ColumnasManifiestoPopover.test.tsx:172` afirma el
  literal `{"ocultas":[]}` tras «Restablecer», y ese literal **es** el contrato de almacenamiento.
  «Restablecer» borra las dos listas (R8) y por tanto vuelve a escribir exactamente ese literal.

---

## §5 — Hook `hooks/usePreferenciaColumnas.ts`

Mismo esqueleto de hoy, con tres cosas más. Lo que **no** cambia y por qué (está razonado en
`hooks/usePreferenciaColumnasManifiesto.ts:15-35`, y sigue rigiendo):

- `useSyncExternalStore` y no `useState` + efecto: el botón se renderiza también en servidor.
- El **snapshot es el string crudo**. Derivar el array en `getSnapshot` construye un array nuevo en
  cada llamada, React lo compara por identidad y entra en **bucle infinito de render**.
- `getServerSnapshot` → `null` (sin preferencia ⇒ todas visibles, sin discrepancia de hidratación).
- Evento propio, porque `storage` **no** dispara en la pestaña que escribió (R32).

```ts
export const EVENTO_COLUMNAS_CAMBIO = "ordenex:columnas-cambio";

export function usePreferenciaColumnas<T>(
  clave: string | null,                    // null ⇒ sin ámbito: no lee, no escribe (R33)
  publicadas: readonly T[],
  claveDe: (columna: T) => string,
): {
  ordenadas: T[];        // TODAS, en orden efectivo → el selector
  visibles: T[];         // las marcadas, en orden efectivo → el archivo
  clavesVisibles: string[];
  alternar: (clave: string) => void;
  mover: (clave: string, direccion: "arriba" | "abajo") => void;
  restablecer: () => void;
};
```

- **Un solo nombre de evento para todos los ámbitos.** Un cambio en órdenes despierta al hook del
  manifiesto, que relee **su** clave, obtiene el mismo string y `useSyncExternalStore` no re-renderiza
  (compara strings por valor). Es un despertar barato y evita un registro de eventos por ámbito.
  El nombre viejo (`ordenex:manifiesto-columnas-cambio`) no persiste en ningún sitio: es un evento
  en memoria, no un dato guardado. Renombrarlo no rompe nada guardado.
- `alternar` y `mover` **releen del almacenamiento**, no del render: dos superficies vivas del mismo
  ámbito pueden haber escrito entre medias (R32).
- `mover` en el extremo es **no-op** (R22, R23) y **nunca toca `ocultas`** (R24).
- `alternar` conserva el guard de mínimo: si quedara una sola visible, no oculta (R7).
- **Los accesores (`claveDe`) se declaran a nivel de módulo, nunca inline**, para que las
  dependencias de los `useMemo` sean estables. Un `(c) => c.clave` escrito en el JSX cambia de
  identidad en cada render y recalcula las derivaciones sin necesidad.
- Con `clave === null` el hook devuelve `publicadas` intacto y sus escrituras son no-op: es como se
  cumple R33 sin romper las reglas de los hooks (se llama siempre, condicionar sería el error).

`hooks/usePreferenciaColumnasManifiesto.ts` queda como envoltorio: fija `claveColumnas(flujo)`,
`COLUMNAS_MANIFIESTO` y `(c) => c.key`. Misma firma que hoy más `mover`, así que
`DescargarManifiestoButton` y `tests/components/ColumnasManifiestoCatalogoAbierto.test.tsx` siguen
compilando y pasando **sin tocarlos**.

---

## §6 — UI: `components/shared/ColumnasPopover.tsx`

```ts
export interface ColumnasPopoverProps<T> {
  claveAlmacenamiento: string;
  publicadas: readonly T[];
  claveDe: (columna: T) => string;
  etiquetaDe: (columna: T) => string;   // ← aquí se resuelve R3 sin bifurcar el componente
  titulo: string;                       // encabezado del popup
  etiquetaDisparador: string;           // aria-label del botón que lo abre
}
```

Estructura de cada fila: `Checkbox` + `Label` + **dos botones de icono** (`ChevronUp`/`ChevronDown`
de lucide, ya en el repo), con nombre accesible `Subir <etiqueta>` / `Bajar <etiqueta>`. El primero
de la lista lleva «subir» deshabilitado y el último «bajar» (R22, R23). El pie conserva
«Restablecer» y el aviso de mínimo.

- **Botones y no arrastrar**: no hay biblioteca de drag-and-drop en el repo, arrastrar no es operable
  por teclado sin trabajo extra y no se puede ejercitar en jsdom. Dos botones se prueban y se usan
  con teclado desde el primer día. Ver §10/A5.
- **Etiquetas**: el manifiesto pasa `` (c) => `${etiquetaColumna(c.header)} (${c.header})` ``, que es
  literalmente lo que pinta hoy (`ColumnasManifiestoPopover.tsx:94`) y lo que sus tests afirman por
  regex `\(header\)`. Órdenes pasa `(c) => c.encabezado`, que **es** el encabezado del archivo (R3);
  poner ahí «Nº Guía (Nº Guía)» sería ruido.
- **El componente no importa ningún catálogo.** Recibe `publicadas`. Ni él ni sus pruebas pueden
  afirmar un número de columnas (R35).
- **Foco tras mover**: si el botón pulsado queda deshabilitado por llegar al extremo, el foco se
  pasa al botón contrario de la misma fila. Sin eso, mover una columna hasta el final devuelve el
  foco al `body` y el teclado se pierde.

`ColumnasManifiestoPopover` sobrevive como envoltorio de seis líneas con la prop `flujo`: conserva
`aria-label="Elegir columnas del manifiesto"` y el título «Columnas del manifiesto», que son lo que
consultan `tests/components/ColumnasManifiestoPopover.test.tsx:57,59`. **No es código muerto**: lo
monta `DescargarManifiestoButton.tsx:155`.

### El generador del manifiesto

`lib/utils/manifiesto-xlsx.ts::columnasAEmitir` filtra hoy `COLUMNAS_MANIFIESTO` por las claves
recibidas, **descartando el orden en que llegan** (194/R8). Con reordenar eso deja de valer: pasa a
mapear **las claves recibidas en su orden**, quedándose con las publicadas y degradando al catálogo
completo si no casa ninguna (194/R13 intacto, y el `throw` sin filas también).

Alcance real del cambio: el único llamador de producción es `DescargarManifiestoButton`, que pasará
las claves **ya en el orden efectivo**. Sin orden guardado, ese orden **es** el del catálogo, así que
el archivo de todo el mundo sale hoy exactamente igual que ayer. La conducta solo difiere cuando el
usuario reordena, que es lo que la ficha pide. Ver §10/A0 y §12.

---

## §7 — Enganche en la descarga de listados

`DataTableDescarga` gana **un** miembro:

```ts
export interface DataTableDescarga {
  titulo: string;
  columnas: DescargaColumna[];
  obtenerFilas: () => Promise<DescargaFilasResult>;
  formatos?: DescargaTipo[];
  /** Ámbito de la preferencia de columnas. Ausente ⇒ sin selector y salen todas (R33). */
  ambitoColumnas?: string;
}
```

`DescargarDatasetButton` pasa a ser **el único sitio** donde la preferencia se aplica a un listado:

```
clave        = ambitoColumnas ? `ordenex:descarga-columnas:${ambitoColumnas}` : null
{ visibles } = usePreferenciaColumnas(clave, columnas, claveDeDescarga)
construirDescarga({ tipo, titulo, columnas: visibles, filas })
```

y monta `<ColumnasPopover>` junto al botón **solo** si hay ámbito. Las 24 tablas restantes no cambian
ni una línea y no ven un control nuevo: es la decisión 1 del humano, y encender la siguiente cuesta
`ambitoColumnas: "…"` en su configuración.

`OrdenesModule` añade esa línea a la configuración que ya construye en el render
(`OrdenesModule.tsx:465-480`). **No lee `localStorage`**, y esto no es un detalle de estilo: el
barrido de `tests/components/descarga/ControlDescargaTransversal.test.tsx:603` prohíbe
`localStorage` en cualquier módulo de `app/` que declare `descarga={`. El ámbito viaja como
identificador; quien lee el almacenamiento es el control común.

Lo que **no** cambia y hay que demostrar que no cambia (R34): `obtenerFilas` y con él los filtros
vigentes, el acotamiento por rol y el tope del servidor; `titulo` y con él el nombre del archivo y el
de la hoja; los formatos (ninguna tabla declara `formatos`, y ésta tampoco empieza ahora);
`filaDescargaOrden`, que sigue proyectando la fila **entera** — filtrar columnas no es filtrar datos,
y `buildXlsxRows` ignora las claves que no se declaran.

---

## §8 — El catálogo de órdenes, ampliado

Las siete altas ya viajan en `OrdenListItemDTO` (verificado en `lib/types/orden.ts:261-375`). **No
hay cambio de backend.** Orden propuesto — intercalado por afinidad, sujeto a la **pregunta abierta 4**
de `requirements.md`; los encabezados, a la **pregunta abierta 1**:

| # | clave | encabezado | origen | nota |
| --- | --- | --- | --- | --- |
| 1 | `numGuia` | Nº Guía | — | ya existe |
| 2 | `numRemision` | Nº Remisión | — | ya existe |
| 3 | `estatus` | Estado | — | ya existe |
| 4 | `destinatario` | Destinatario | — | ya existe |
| **5** | **`telefonoDest`** | **Teléfono del destinatario** | `orden.telefonoDest` | alta |
| 6 | `producto` | Producto | — | ya existe |
| **7** | **`peso`** | **Peso (kg)** | `orden.peso` | alta · número, celda vacía si `null` |
| 8 | `direccion` | Dirección | — | ya existe |
| 9 | `tienda` | Tienda | — | ya existe |
| 10 | `zona` | Zona | — | ya existe |
| 11 | `provincia` | Provincia | — | ya existe |
| 12 | `canton` | Cantón | — | ya existe |
| 13 | `distrito` | Distrito | — | ya existe |
| 14 | `montoCobrar` | Monto a cobrar | — | ya existe |
| **15** | **`fleteConIva`** | **Flete + IVA** | `orden.fleteConIva` | alta · **string tal cual** |
| **16** | **`comisionConIva`** | **Comisión + IVA** | `orden.comisionConIva` | alta · **string tal cual** |
| 17 | `mensajero` | Mensajero | — | ya existe |
| 18 | `intentos` | Intentos | — | ya existe |
| 19 | `fechaCreacion` | Fecha de creación | — | ya existe |
| **20** | **`fechaReparto`** | **Día de reparto** | `orden.fechaRepartoISO` | alta · **string tal cual** |
| **21** | **`fechaReprogramacion`** | **Fecha de reprogramación** | `orden.fechaReprogramacion` | alta · **string tal cual** |
| **22** | **`notas`** | **Notas de la tienda** | `orden.notas` | alta · va al final: es texto largo |

Las quince de hoy conservan su orden relativo (R17): la secuencia 1,2,3,4,6,8,9,10,11,12,13,14,17,18,19
es estrictamente creciente.

**Reglas de proyección** (`filaDescargaOrden`):

- Los dos importes se emiten **tal cual llegan**: son `string` de escala 2 que deriva el servidor
  desde la feature 204 (`lib/types/orden.ts:321-337`). **Ni `Number(`, ni `parseFloat(`, ni
  `.toFixed(`, ni multiplicar** (R12). Ese camino ya costó 14 de 66 órdenes desviadas un céntimo, y
  `tests/unit/guards/ordenes-columnas-money-safe.guardia.test.ts` barre **el árbol entero** de
  `app/(app)/ordenes/_components`: nombrar `valorFlete`, `ivaFlete` o `comisionCod` en este archivo
  lo pone rojo. Consecuencia declarada: la celda es **texto** y Excel no la autosuma (pregunta
  abierta 2).
- Las dos fechas llegan **ya serializadas** como `YYYY-MM-DD` por el repositorio y se emiten sin
  tocarlas (R13). **Nada de `new Date(...)`** para ellas: un `@db.Date` leído en el navegador con la
  hora local devuelve el día anterior en media América. `fechaCreacion` sigue con su
  `fechaCalendarioCR` de siempre, que es otra cosa y no se toca.
- Dato ausente ⇒ `null` (celda vacía). Nunca `"—"`, nunca `undefined` (R14).
- Nada de identificadores, banderas ni relaciones crudas (R15). La guardia
  `tests/unit/descarga/columnas-sensibles.guardia.test.ts` lo comprueba sola con su sonda; ninguna de
  las siete claves ni de los siete encabezados nuevos casa con su lista negra (comprobado a mano
  contra `NOMBRES_PROHIBIDOS`, `IDENTIFICADOR_INTERNO` y `BANDERA_INTERNA`).

---

## §9 — Contratos de entrada/salida

- **Endpoints, Server Actions y rutas: ninguno nuevo, ninguno modificado.** `listarOrdenesCompleto`
  se llama con el mismo input de hoy y no se entera de que existen columnas elegibles — igual que
  `obtenerManifiesto` desde la 194.
- **Archivo de salida**: mismo `xlsx`, misma hoja, mismo nombre `ordenes-YYYY-MM-DD.xlsx`. Lo único
  que cambia es **qué columnas lleva la cabecera y en qué orden**.
- **Contrato de almacenamiento**: §2. Es el único formato persistido que esta ficha toca.
- **Integraciones externas**: ninguna.

---

## §10 — Alternativas descartadas

**A0 — Que el manifiesto ofrezca reordenar pero su archivo siga saliendo en el orden del catálogo**
(no tocar `manifiesto-xlsx.ts`, conservando 194/R8 intacto).
Descartada. Sería el fallo mudo de manual: el usuario mueve columnas, la lista se mueve en pantalla,
pulsa descargar y el archivo sale como antes, sin un solo error. R20 y R21 lo prohíben y la decisión
3 del humano es explícita («aplica al componente entero y en todos sus usos, manifiesto incluido»).
Lo que sí se hace: dejar por escrito que **deroga 194/R8** y que la conducta solo cambia para quien
reordena.

**A1 — Guardar la lista de columnas VISIBLES, con su orden (allowlist).**
Descartada, y es la misma razón de la 194: una columna publicada mañana no estaría en ninguna
allowlist guardada, así que quedaría **oculta en silencio y para siempre** justo en los navegadores
de quien más usa la función. Se conserva la lista de exclusión.

**A2 — Orden guardado AUTORITATIVO, y las columnas nuevas se añaden al FINAL.**
Descartada, y esta ficha es su propia contraprueba: publica **siete** columnas de golpe. Quien
hubiera reordenado antes recibiría las siete apiladas al final —teléfono lejos del destinatario, los
importes lejos del monto—, es decir exactamente el reparto que la pregunta abierta 4 propone
rechazar para todos los demás. Dos usuarios de la misma empresa acabarían con hojas distintas sin
que ninguno de los dos haya pedido nada, y la única salida sería «Restablecer», que tira también lo
que sí querían. El anclaje del §3 cuesta un bucle y no tiene ese precio.

**A3 — Versionar la preferencia (`{"v":2,…}`) y migrar al leer.**
Descartada. Obliga a escribir —y a mantener para siempre— un migrador que corre en el navegador de
cada persona, y **rompe el rollback**: el código viejo no reconoce `v:2` y descarta la preferencia
entera. El campo opcional del §2 consigue lo mismo con cero código de migración y sobrevive a un
revert.

**A4 — Pasar al `DataTable` un descriptor de ámbito completo** (`{ id, publicadas, claveDe,
etiquetaDe }`) en vez de un `string`.
Descartada. `columnas` ya viaja en `DataTableDescarga`: el descriptor duplicaría el catálogo y
abriría la puerta a que las dos copias divergieran. Además mete estructura donde la guardia
`datatable-descarga-contrato` vigila justamente que no entre dominio. Un `string` es lo mínimo que
resuelve el problema. *(Variante también descartada: colgar `ambitoColumnas` de `DataTableProps` en
vez de dentro de `DataTableDescarga`, que evitaría tocar esa guardia — pero permitiría declarar un
ámbito en una tabla sin descarga, un estado que no significa nada.)*

**A5 — Reordenar arrastrando.**
Descartada. No hay biblioteca de dnd en el repo (habría que añadir dependencia), no es operable con
teclado sin trabajo adicional y no se puede ejercitar en jsdom, que es donde vive la verificación de
esta ficha. Dos botones cubren R18-R25 y se prueban de verdad.

**A6 — Copiar el mecanismo de la 194 para órdenes y dejar el del manifiesto quieto.**
Descartada. Reordenar habría que escribirlo dos veces, y a la tercera pantalla habría tres copias que
se van separando. El encargo pide generalizar, no duplicar.

**A7 — Guardar la preferencia en base de datos, por usuario.**
Descartada. Es la decisión D2 de la 194 y `specs/146` la declara fuera de alcance: no hay tabla de
preferencias de usuario. El precio —la preferencia no viaja entre dispositivos— queda declarado, no
escondido.

---

## §11 — Riesgos

| Riesgo | Cómo queda cerrado |
| --- | --- |
| Un consumidor externo lee el manifiesto **por posición de columna** y el reordenamiento se lo rompe. | Exposición **no nueva**: desde la 194 el usuario ya puede ocultar columnas, así que la posición dejó de ser estable hace tiempo. Además solo cambia para quien lo pide, y en su propio dispositivo. |
| El selector entra en el bundle de las 25 tablas aunque solo órdenes lo use. | `ColumnasPopover` solo se **renderiza** con ámbito, pero sí se importa. Es un popover de `@base-ui/react/popover` ya presente en el repo; el peso pesado (`exceljs`) sigue detrás del `import()` dinámico y esta ficha no lo toca. Si el implementer mide que molesta, `next/dynamic` en el botón es la salida. |
| Dos superficies del mismo ámbito se pisan al escribir. | Toda escritura **relee** el almacenamiento antes de calcular (patrón vivo hoy en `alternar`), y el evento propio despierta a ambas (R32). |
| Al mover una columna al extremo se pierde el foco del teclado. | §6: el foco pasa al botón contrario de la misma fila. |
| Guardar `orden` con todas las claves engorda el valor y arrastra claves muertas. | Son ~22 cadenas cortas. Las claves despublicadas se ignoran al resolver (R29) y desaparecen en la siguiente escritura. |

---

## §12 — Tests y guardias vigentes que esta ficha toca

Tocarlos requiere justificación explícita; aquí está la de cada uno. Todo lo demás debe pasar **sin
modificarse**, y eso es parte del criterio de hecho (tasks T16).

| Archivo | Cambio | Por qué |
| --- | --- | --- |
| `tests/unit/components/datatable-descarga-contrato.test.ts:59` | La lista exacta de miembros pasa a incluir `ambitoColumnas`, y se **añade** una aserción de que es un `string` sin tipo de dominio. | Es la única forma de declarar el ámbito en la configuración de la tabla (D6/A4). La guardia sigue afirmando lo que existe para afirmar: que ahí no entra dominio. Queda **más fuerte**, no más laxa. |
| `tests/unit/components/ordenes-descarga-columnas.test.ts:153-192,205-221` | La lista de claves prohibidas pierde `telefonoDest`, `notas` y `peso`; las dos aserciones de orden pasan a 22 entradas. | Esas tres NO son identificadores internos ni banderas de borrado: son datos de la orden que el humano decidió publicar (decisión 2). Lo que la guardia protege —ids, `deletedAt`, `updatedAt`, `relaciones`— se queda entero. |
| `tests/unit/utils/manifiesto-xlsx-columnas.test.ts:114` | El caso «con las claves en orden INVERTIDO conserva el orden del catálogo» pasa a afirmar lo contrario: el generador **emite en el orden recibido**. | Deroga 194/R8 por la decisión 3 del humano. La derogación se escribe en la cabecera del test, no se borra el caso. |
| `tests/unit/manifiesto/preferencia-columnas.test.ts` | Se re-cablea al módulo genérico (`claveColumnas(flujo)` donde pasaba `flujo`); **se conservan los ocho casos** y el bloque de etiquetas. | La maquinaria se muda de archivo. Envolver el módulo viejo solo para que el test no se entere dejaría envoltorios que **solo usan los tests**, o sea código muerto en producción. |
| `tests/components/DescargarManifiestoColumnas.test.tsx` | Solo se **añade** un caso (con orden guardado, el generador recibe las claves en ese orden). Los siete existentes no se tocan. | Es la evidencia de R21 en el manifiesto. Que los otros siete sigan verdes sin tocarse es la evidencia de R30. |
