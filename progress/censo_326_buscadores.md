# Censo — Ficha 326 · buscadores y filtros fuera de los componentes compartidos

- **Fecha:** 2026-08-28 · medido sobre `9f4a18d0`
- **Encargo:** medir, no migrar. El humano decidió sustituir **solo los que duplican** el patrón de
  listado, y pidió ver el censo antes de que se toque nada.

## El contrato canónico, que es lo que decide cada veredicto

`BuscadorFiltros` = campo de texto con *debounce* + selector que monta filtros bajo demanda.
`FilterComponent` = orquesta N filtros declarativos (`multi`/`single`/`dateRange`/`boolean`/`text`)
con encadenado `dependsOn`/`parentValue` y poda. `MultiSelectFilter` y `DateRangeFilter` son los dos
controles sueltos.

**Los cuatro son para LISTADOS: recortan filas que ya existen.** Ése es el criterio.

Ya los usan bien —línea base, no hallazgos—: `OrdenesListado`, `SateliteOrdenesListado`,
`UsuariosModule`, `HistoricoFiltrosBar`, `FiltrosCierresBarra` y `FiltrosEntregas`.

## Recuento

| Veredicto | Nº | Cuáles |
| --- | --- | --- |
| **duplica el patrón** | **5** | `ChatOrdenesLista`, `RecogerModule`, `RepartoModule`, `CuentasPorPagarFiltros`, `FiltroCantonDistrito` |
| **caso mixto** | **6** | `TableroDiaControles`, `WalletFiltros`, `MiWalletFiltros`, `DesglosePagosMensajero`, `DesgloseMovimientosTienda`, `FiltrosOperativos` |
| **es formulario, no listado** | **3** | `CampoVariablePicker`, `GeografiaSelector`, `DescargarGestionesDialog` |
| **falso positivo** | **3** | `CuentasPorPagarTable`, `filtro-secciones`, `TabsGroup` |

**El censo preliminar del leader (8 archivos) se quedaba corto: aparecieron 9 más**, entre ellos las
cuatro barras de wallet, que son el duplicado más caro del repo. Las dos sospechas del leader
—`GeografiaSelector` y `CampoVariablePicker` como formulario— quedaron **confirmadas**.

## Los que duplican de verdad

- **`ChatOrdenesLista`** — buscador de listado puro (guía, remisión, teléfono, nombre). Coste bajo en
  lógica, **alto en aspecto**: aquí el campo es una píldora dentro de una columna estrecha, y el
  canónico monta un input con marco y un botón «Filtros» en fila. Funcionaría; no se parecería.
- **`RecogerModule`** y **`RepartoModule`** — el mismo gesto que el chat: **tres copias**. Coste bajo;
  se pierde el `<label>` visible, porque el canónico usa `aria-label` a propósito.
- **`CuentasPorPagarFiltros`** — es el canónico sin el selector y sin el *debounce*, escrito a mano.
  **El más barato de todos.**
- **`FiltroCantonDistrito`** *(no estaba en el censo preliminar)* — es exactamente `dependsOn` +
  `parentValue` + poda, reescrito con un centinela `"__todos__"`.

## Los que NO se tocan, y por qué

- **`CampoVariablePicker`** — el resultado no es «ver menos filas», es **un valor que entra en un
  textarea**. Elige, no filtra.
- **`GeografiaSelector`** — define **a qué distritos aplica una tarifa**. Y su campo ni siquiera
  filtra la salida: la cascada opera sobre el árbol completo.
- **`DescargarGestionesDialog`** — define el **alcance de un archivo**, no lo que se ve en pantalla.
- **`CuentasPorPagarTable`**, **`filtro-secciones`**, **`TabsGroup`** — falsos positivos: el primero
  delega su UI, el segundo desmonta secciones de página (y su campo ya lo pinta el canónico), y el
  tercero es de la casa y filtra pestañas, no filas.

## ⚠️ Dónde el canónico se queda corto — vale más que el censo

**1. `BuscadorFiltros` es de escritura únicamente: no acepta `value` ni se puede vaciar desde fuera.**
Es dueño de su texto y sólo expone `onChange`. La única forma de reponerlo a cero es remontarlo con
`key` —lo que ya hacen tres consumidores— y eso **tira el foco**.

Esto **bloquea `TableroDiaControles`**: hay un botón «Quitar el filtro» que vive en *otro* componente
y vacía el filtro desde fuera. Con el canónico, ese botón deja de poder existir sin un remonte con
salto de foco. Lo mismo aplicaría a cualquier pantalla que quiera sembrar el término desde la URL.

**2. `FilterComponent` no tiene modo «Aplicar»: emite en cada cambio.**
Las cuatro barras de wallet mantienen un **borrador local** y sólo emiten al pulsar Aplicar, y **no
es capricho**: cada lectura de esos listados **recalcula agregaciones de dinero**. Un *debounce* no
es lo mismo que un submit cuando el usuario compone cuatro campos — dispararía consultas
intermedias sobre combinaciones que nadie pidió.

**Cuatro archivos dependen de esta única prop que falta.**

**3. `MultiSelectFilter` no sabe jerarquías.** Sólo listas planas. No es problema hoy —lo que las
necesita es formulario— pero conviene saberlo antes de que alguien lo intente.

**4. Cada consumidor escribe su propio traductor.** Ya hay cuatro archivos que convierten la
selección al contrato del servidor. No es fallo del canónico, pero es el peaje fijo de cada
migración y hay que contarlo.

## Por dónde empezar

**`CuentasPorPagarFiltros`**, junto con el *debounce* hecho a mano de `CuentasPorPagarTable`.

Es el **único caso donde el canónico ya gana sin añadirle nada**: un campo de texto contra un listado
paginado en servidor, y el consumidor ya reimplementó a mano el par «tecleado vs aplicado» —usando
además una constante importada del propio canónico—. Se borran dos piezas y no se pierde ni un
comportamiento. De regalo llega el selector «Filtros», que es justo lo que esa pantalla dice que le
falta.

**Los cuatro de wallet son el premio gordo por volumen, pero no se tocan hasta que el orquestador
acepte un modo «Aplicar».** Migrarlos antes cambiaría un submit deliberado por consultas por
pulsación sobre agregaciones de dinero — exactamente el tipo de «arreglo» que rompe algo que no
estaba roto.
