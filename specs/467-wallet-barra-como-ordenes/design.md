# Ficha 467 — Diseño

> Reorganización visual de pantallas EXISTENTES (la caja y el componente compartido de estado de
> cuenta). No hay pantalla nueva: **no pasa por `/design`**. **Frontend puro** (zona `frontend`): ni
> migraciones, ni esquemas, ni acciones, ni repositorios. Esta ficha sustituye en lo VISUAL a la 463;
> sus contratos de servidor se quedan como están.

## 0. Lo verificado en el código (2026-10-02, `dev` @ 762c6d7d)

Grafo `R-job-singularis-projects-ordenex` consultado primero; está rancio (no conoce `LibroCajaBarra`
ni `WalletFiltrosCaja`), así que todo lo de abajo se confirmó leyendo el archivo.

| Hecho | Dónde |
| --- | --- |
| Barra de órdenes: `BuscadorFiltros` con hijos `SegmentedToggle soloIcono` (campo y dirección) + un `FilterComponent` con los filtros de las casillas marcadas (`filtrosMontados`) | `app/(app)/ordenes/_components/OrdenesListado.tsx:1349-1443` |
| Las casillas las posee el consumidor (`activos` controlado); montados = declarados ∩ activos, en el orden declarado | `OrdenesListado.tsx:870`, `:1104-1107`; `components/shared/BuscadorFiltros.tsx:79-93`, `:410-415` |
| Iconos de la dirección por fecha: `ArrowDownWideNarrow` («Más recientes») / `ArrowUpNarrowWide` («Más antiguas») | `app/(app)/ordenes/_components/ordenamiento-ordenes.ts:137-138` |
| «Descargar» y columnas los pinta `DataTable` (vía `DescargarDatasetButton`) en la MISMA fila que su prop `filtros`, a la derecha | `components/shared/DataTable.tsx:566-600` |
| Caja hoy: tarjeta `WalletFiltrosCaja` (alcance + `FilterComponent` dateRange con `aplicarConBoton` + `Label` + `SelectorBuscable` «A quién») encima de `CajaResumenCard` | `app/(app)/wallet/_components/WalletFiltrosCaja.tsx:73-112`; `WalletModule.tsx:537-545` |
| Libro de la caja hoy: `LibroCajaBarra` = alcance + `BuscadorFiltros` con orden CON texto, Todo/Entra/Sale y un `Select` de categorías sueltos | `app/(app)/wallet/_components/LibroCajaBarra.tsx:83-128` |
| La caja ya separa `FiltrosWallet`/`FiltrosLibro`, `recargarTodo` (atómica) / `recargarLibro`, un solo `turno`, y restaura con `siembra` al fallar | `WalletModule.tsx:292-511` |
| Estado de cuenta hoy: sección de periodo con `aplicarConBoton` ANTES de las tarjetas; en el libro, `BuscadorFiltros` con orden con texto, `ChipsEstadoCuenta` (un `SegmentedToggle`) y `selectorCierre` sueltos | `components/shared/estado-cuenta/EstadoCuenta.tsx:600-677` |
| `selectorCierre`: tienda y mensajero montan `SelectorCierreDeCuenta` (`SelectorBuscable`, `w-full sm:w-80`); `/mi-wallet` monta `SelectorMiCierre` (`Label` visible ENCIMA + `Select` `h-9` + aviso) | `EstadoCuentaTienda.tsx:70`, `EstadoCuentaMensajero.tsx:60`, `components/shared/estado-cuenta/SelectorCierreDeCuenta.tsx:25-35`, `app/(app)/mi-wallet/_components/MiEstadoCuenta.tsx:63-93` |
| `aplicarConBoton` solo lo usan `WalletFiltrosCaja` y `EstadoCuenta` | grep en `app/`, `components/` |
| `FilterComponent` `single` ya pinta el nombre DENTRO del disparador (`labelPrefix`), `w-auto min-w-56`, `h-8`; sin opciones, se deshabilita | `components/shared/FilterComponent.tsx:943-976`, `:206` |
| `SelectorBuscable`: disparador `h-9`, sin nombre visible dentro (solo `aria-label`); `cn` usa `tailwind-merge` | `components/shared/SelectorBuscable.tsx:190-205`; `lib/utils.ts` |
| `DateRangeFilter`: el primer clic fija un rango de un día y emite; el orquestador espera `DEBOUNCE_MS_DEFAULT = 500` ms | `components/shared/DateRangeFilter.tsx:105-195`; `FilterComponent.tsx:205` |
| Textos de zona y orden con texto | `components/shared/wallet/zonas-filtros-labels.ts` |
| La ayuda declara como fuentes `WalletFiltrosCaja.tsx`, `LibroCajaBarra.tsx` y `zonas-filtros-labels.ts`, y describe las dos zonas, «Aplicar» y «Quitar periodo» | `docs/ayuda/oficina/wallet-caja.md:7-16`, `:417-447`; `wallet-tiendas.md`, `wallet-mensajeros.md`, `tienda/mi-wallet.md` |

## 1. Modelo de datos y servidor

**Nada.** Sin migraciones, sin RLS, sin esquemas, sin acciones. La pantalla sigue mandando lo mismo:

- Caja: `inputDeWallet(fw)` a resumen/desglose/detalle de fila y `inputDeLibro(fw, fl)` al libro y a la
  descarga (`wallet-filtros-input.ts`). `tipo` (Entra/Sale) y `categoria` (Concepto) siguen viajando
  solo al libro. Los esquemas `.strict()` de la 463 siguen rechazando `q`/orden en las cifras.
- Estado de cuenta: `filtrosDeLectura(periodo, chip, cierreId, { termino, sortDir })` sin cambios; la
  clave SWR (`claveEstadoCuenta`) tampoco.

## 2. La barra, pieza a pieza (común a las dos superficies)

```
[↓↑ orden] [controles de las casillas marcadas…] [🔍 buscador — flex-1 ……] [Filtros ▾] [Limpiar todo]   [Descargar] [⚙ columnas]
└──────────────────────── prop `filtros` de DataTable ─────────────────────────────────────────────┘   └─ DataTable ─┘
```

| Pieza | Componente (existente) | Notas |
| --- | --- | --- |
| Contenedor | `BuscadorFiltros` | `leerDeUrl={false}` (R30), `minChars={BUSQUEDA_LIBRO_MIN_CHARS}`, placeholders de hoy por superficie (R24), `filtros` = casillas, `activos`/`onActivosChange` controlados, `onLimpiarTodo`, `siembra` del término. Sin `vistas`. |
| Orden | `SegmentedToggle soloIcono` | Primer hijo. Opciones `ORDEN_LIBRO` con `Icono` añadido (R4). Solo dirección (pregunta abierta 2). |
| Periodo, Entra/Sale, Concepto, Tipo de movimiento | UN `FilterComponent` con las declaraciones de las casillas marcadas | Como `filtrosMontados` de órdenes. `leerDeUrl={false}`, sin `aplicarConBoton`, `siembra` para R28. |
| A quién (caja) | `SelectorBuscable` | Búsqueda en servidor (no la tiene `FilterComponent`). Con el nombre visible nuevo (§4.2). |
| Cierre (estados de cuenta) | el que ya construye la superficie (`selectorCierre`) | Adaptado a la barra (§4.3). |
| Descargar + columnas | `DataTable` → `DescargarDatasetButton` | Ya están en esa fila; no se tocan (R2). |

Desaparecen: los textos de alcance, la tarjeta de arriba, el `Label`+`Select` de categorías, los
conmutadores con texto y los botones «Aplicar»/«Quitar periodo» (R1, R3).

**Ancho (R5).** El buscador ya es `flex-1 min-w-[250px]`. Lo que hoy lo estrecha son ~600 px de
conmutadores con texto y el `Select` de `w-56`. Con dos botones cuadrados y «Filtros», la fila de
órdenes (que lleva además Vistas y un conmutador más) cabe en 1440 px; la del libro, más corta, también.
Se mide en la verificación en la app (T9).

**Estado de las casillas.** Lo posee el MÓDULO de cada superficie (no la barra), porque R27/R28 obligan a
reponerlo tras un fallo: `activos: string[]`, que arranca en `[]` (R11).

**Regla de coherencia (R27).** En cada punto en que se fija lo aplicado (lectura buena o restauración
tras fallo) se garantiza `activos ⊇ claves con valor`, igual que hace `aplicarVista` en órdenes
(`OrdenesListado.tsx:972-975`).

**Desmarcar una casilla (R10).** El módulo NO confía en la poda del orquestador (cuando se desmarca la
última casilla el `FilterComponent` se desmonta y ya no emite nada): `cambiarActivos(claves)` calcula
qué claves salen, y si alguna tenía valor compone la selección sin ellas y la aplica por el mismo camino
que un cambio de valor —una sola recarga—. Una emisión posterior de la poda con la misma selección cae
en la guarda de «sin cambio» (`mismoLibro` + la nueva `mismaWallet`) y no relee.

**Marcar una casilla (R8)** solo cambia `activos`: un control montado vacío no filtra y no hay lectura.

**Lecturas en curso (R29).** Ningún control se deshabilita (ni siquiera «A quién» o el periodo, que hoy
se deshabilitan durante la recarga de la wallet): el `turno` único de la caja y la clave SWR del estado de
cuenta ya garantizan que solo pinta la última selección pedida.

## 3. Caja (`app/(app)/wallet/_components/`)

### 3.1 Declaraciones (nuevo `libro-caja-filtros.ts`, sin JSX)

```ts
export const CASILLA = { periodo: "periodo", aQuien: "aQuien", direccion: "tipo", concepto: "categoria" } as const;
export const CASILLAS_CAJA: FiltroDisponible[] = [
  { key: CASILLA.periodo,   label: "Periodo" },
  { key: CASILLA.aQuien,    label: "A quién" },
  { key: CASILLA.direccion, label: "Entra/Sale" },
  { key: CASILLA.concepto,  label: "Concepto" },
];
export function declaracionesCaja(conceptos: FilterOption[]): FilterDef[]  // periodo (dateRange), tipo (single: Entra/Sale, placeholder «Todo»), categoria (single: conceptos, placeholder «Todos»)
export function seleccionDeCaja(fw: FiltrosWallet, fl: FiltrosLibro): FilterSelection  // para la siembra
export function deSeleccion(sel: FilterSelection): { desde; hasta; tipo; categoria }  // lo emitido, de vuelta
```

- Las claves del orquestador son las mismas palabras que ya usa `FiltrosLibro` (`tipo`, `categoria`),
  así que la traducción es directa.
- Las opciones de Concepto salen de `useConceptosConMovimientos` como hoy (R20); `opcionesDeConceptos`
  gana un modo SIN la opción «Todas» (en el `single` la ausencia de valor ya es «todos» y se dice en el
  placeholder). La regla de «el elegido sigue ofrecido con 0» se conserva.
- `seleccionDePeriodo`/`periodoDeSeleccion` se mudan aquí desde `WalletFiltrosCaja.tsx`.

### 3.2 `LibroCajaBarra.tsx` (se reescribe; mismo archivo)

Props: `filtrosWallet`, `valor` (`FiltrosLibro`), `activos`, `onActivos`, `onCambiarSeleccion(sel)`,
`onAQuien(valor | null)`, `onOrden(dir)`, `onTermino(t)`, `onLimpiar()`, `siembraSeleccion`,
`siembraTermino`. Monta: `BuscadorFiltros` → `SegmentedToggle soloIcono` → `FilterComponent` (si hay
alguna casilla del orquestador marcada) → `SelectorBuscable` de «A quién» (si su casilla está marcada).
Las opciones de «A quién» se leen con `useQuienesDelLibroCaja` y el periodo APLICADO, como hoy (R18).
Si la lectura de conceptos falla, el aviso `CONCEPTOS_FILTRO_AVISO.error` va como texto corto tras los
controles (como hoy).

### 3.3 `WalletModule.tsx`

- Fuera `<WalletFiltrosCaja>` (`:537-543`). `CajaResumenCard` queda primera en la sección.
- Estado nuevo: `activos`, `siembraSeleccion` (sustituye a `siembraPeriodo`).
- `alCambiarSeleccion(sel)`: traduce con `deSeleccion`; si cambian `desde`/`hasta` ⇒
  `recargarTodo(fwNuevo, flNuevo, 1)` (R12); si solo cambian `tipo`/`categoria` ⇒ `cambiarLibro`
  (R13). Se compone siempre sobre lo PEDIDO (`pedidoWallet`/`pedidoLibro`), como hoy.
- `cambiarWallet` pasa a recibir también el libro (`recargarTodo(fw, fl, 1)`), para que un cambio que
  toque las dos zonas a la vez (una emisión con periodo y concepto, o «Limpiar todo») sea UNA lectura.
- `limpiarTodo()` (R25): `activos = []`, término `""`, `tipo`/`categoria` `""`, periodo y «A quién»
  fuera, orden intacto; si la wallet aplicada tenía algo ⇒ `recargarTodo`, si no ⇒ `recargarLibro`.
  **Cambio respecto de la 463** (su R30 conservaba el periodo): ahora todo está en la misma barra y
  «Limpiar todo» hace lo que hace en órdenes.
- `fallo(...)`: además de lo de hoy, `siembraSeleccion` con `seleccionDeCaja(aplicado)` y
  `activos = activos ∪ claves con valor aplicado` (R27/R28).
- `mismaWallet(a, b)` junto a `mismoLibro` (guarda de «sin cambio»).

### 3.4 Se retiran

`WalletFiltrosCaja.tsx`; `FILTRO_DIRECCION` con «Todo» y `CATEGORIA_TODAS_OPTION` si quedan sin
importadores; el fixture `tests/fixtures/libro-caja-barra.tsx` se adapta a las props nuevas.

## 4. Componentes compartidos

### 4.1 `components/shared/wallet/zonas-filtros-labels.ts`

- `ORDEN_LIBRO.opciones` gana `Icono` (los dos de `ordenamiento-ordenes.ts`, importados de
  `lucide-react`, no del módulo de órdenes, que vive en `app/`).
- Fuera `ZONA_WALLET_TEXTO` y `ZONA_LIBRO_TEXTO.alcance`; queda el nombre accesible del buscador
  («Buscar en el libro») y la etiqueta «Periodo». Se conserva la RUTA del archivo (la citan la ayuda y
  las guardias); el nombre «zonas» queda histórico, anotado en su cabecera.

### 4.2 `SelectorBuscable` — nombre visible dentro del disparador

Prop opcional `rotuloVisible?: boolean`. Con `true`, el disparador pinta `etiqueta` en gris y delante
del valor («A quién: Todos»), como `labelPrefix` de `Select` (R23). **Ausente ⇒ idéntico a hoy** (R33).
La altura se ajusta por `className="h-8"` (`tailwind-merge` resuelve `h-9` → `h-8`); no hace falta prop.

### 4.3 Cierre en los estados de cuenta

- `SelectorCierreDeCuenta`: `rotuloVisible` y `className="h-8 w-auto min-w-56"` (antes `w-full sm:w-80`).
- `SelectorMiCierre` (`/mi-wallet`): pierde el `Label` visible ENCIMA (rompía la fila) y usa
  `labelPrefix` del mismo `Select` de `components/ui/` que ya usa —el mismo que `FilterComponent`
  `single`— con `h-8`. Su aviso (no disponible / sin cierres / solo los recientes) se mantiene como
  texto corto tras el control (R22).

No se convierte el cierre en un `FilterDef`: la tienda y el mensajero buscan en el servidor y
`FilterComponent` no sabe hacerlo; mantener el `selectorCierre` que cada superficie ya construye es lo
que no pierde funcionalidad.

### 4.4 `FilterComponent` — se RETIRA el modo «Aplicar»

Con esta ficha `aplicarConBoton` se queda sin consumidores. Se retira: la prop, el borrador, el botón,
el aviso de rango invertido, `mismaSeleccion` y `RANGO_INVERTIDO_AVISO` si no tienen otro importador,
y los tests `tests/unit/components/filter-component-aplicar-463.test.tsx` y
`filter-component-url-aplicar-463.test.tsx`. **Antes de borrarlos** se leen enteros: cualquier aserción
del camino SIN la prop (el R22 de la 463: emisiones idénticas) se muda a la suite general de
`FilterComponent` (memoria «el test que vive dentro de lo que borras»). El comportamiento de los ~15
consumidores no cambia (R33).

### 4.5 `EstadoCuenta.tsx`

- Fuera la `<section>` de periodo (`:600-617`). Encabezado y tarjetas quedan arriba.
- Casillas: `periodo` («Periodo»), `tipoMovimiento` («Tipo de movimiento») y `cierre` («Cierre») solo si
  llega `selectorCierre` (R7).
- `FilterComponent` con `periodo` (dateRange) y `tipoMovimiento` (`single`, opciones
  `CHIPS_POR_TIPO[tipo]` sin «Todo», rótulos `CHIP_LABEL`) (R21). La emisión se traduce a
  `setPeriodo`/`setChip` + `setPage(1)` (R14/R15).
- `ChipsEstadoCuenta` deja de montarse en la barra. Si queda sin importadores se retira, pero
  `CHIPS_POR_TIPO` se conserva (se muda a `estado-cuenta-labels.ts` o se exporta desde donde esté).
- Estado nuevo `activos`; `conservarLoUltimo` repone también `activos ∪ claves con valor` y la
  `siembra` del orquestador con periodo + chip de la lectura buena (R28). `limpiarLibro` pasa a limpiar
  también el periodo y las casillas (R25).
- Orden: `SegmentedToggle soloIcono` con `ORDEN_LIBRO`.
- `ESTADO_CUENTA_TEXTO.periodoInvalido` se retira si queda sin uso.

## 5. Flujo (caja)

```
Casilla marcada ─────────────────────────► solo `activos` (sin lectura)              R8
Periodo (FilterComponent, 500 ms) ┐
«A quién» (SelectorBuscable)      ├──────► recargarTodo(fw, fl, 1): libro + resumen + desglose   R12
Desmarcar Periodo/A quién con valor┘                                                     R10
Entra/Sale, Concepto (FilterComponent) ┐
Término (BuscadorFiltros), orden       ├─► recargarLibro(fl, 1)  (cifras intactas)       R13
Desmarcar Entra/Sale/Concepto con valor┘
Limpiar todo ─────────────────────────────► recargarTodo si había wallet, si no recargarLibro   R25
Fallo / excepción ────────────────────────► toast + pantalla intacta + siembras + activos ∪ claves  R28
```

## 6. Alternativas descartadas

1. **Mantener «Aplicar» para el Periodo dentro de la barra.** Evita la lectura intermedia del primer
   clic del calendario, pero es exactamente la «combinación» que el humano rechazó: un botón que la barra
   de órdenes no tiene, al lado de controles que se aplican solos. La lectura intermedia no deja mezcla
   (turno único) y cuesta una lectura de agregados de bajo volumen. Queda como pregunta abierta 3.
2. **Subir la espera solo para el Periodo** (otro `FilterComponent` con `debounceMs` mayor). Partiría
   la barra en dos orquestadores con dos ritmos —lo que la 463 ya descartó— y retrasaría igual la
   respuesta al usuario.
3. **«A quién» como `FilterDef` `single` con todas las opciones precargadas.** Perdería la búsqueda en
   el servidor (tiendas + mensajeros + nombres anotados; la lista se recorta a «los más recientes»).
   Extender `FilterComponent` con búsqueda remota sería un cambio grande en un componente con ~15
   consumidores para un solo uso; `SelectorBuscable` ya existe y es el control de «A quién» desde la 458-E.
4. **Conmutador de campo con una sola opción («Fecha»)** para copiar literalmente los dos grupos de
   órdenes. Un botón que no cambia nada. Ver pregunta abierta 2.
5. **Dejar `aplicarConBoton` latente «por si acaso».** Una API sin consumidores en un componente
   compartido es complejidad que alguien tiene que mantener y entender; su justificación (la 463) ya no
   existe. Si vuelve a hacer falta, está en el historial.
6. **Dejar los chips del estado de cuenta a la vista** (como la 463 dejó categoría y cierre, §9.1).
   Contradice la decisión del humano: los controles sueltos desaparecen y cada filtro vive en su casilla.

## 7. Riesgos y cobertura

| Riesgo | Cobertura |
| --- | --- |
| Romper a los otros consumidores de `FilterComponent` al retirar el modo | Mudar las aserciones sin-prop antes de borrar; suites existentes de `FilterComponent`, `/ordenes`, cierres, novedades verdes (R33) |
| Un filtro aplicado e invisible tras desmarcar o tras fallo | Tests de R10/R27/R28 con el doble de acción fallando y con la última casilla desmarcada |
| Doble lectura al desmarcar (cambio propio + poda del orquestador) | Test de R10: exactamente 1 llamada a `listarMovimientosAction` (y 1 a resumen si era Periodo) |
| Tests de otras fichas que localizan los chips, el `Select` de categoría o la tarjeta de zona | Listado en T6/T7; se actualiza el LOCALIZADOR, no el contrato (memoria «literal: contrato o polizón») |
| Guardias que citan rutas o textos (`wallet-textos-458`, `wallet-sin-uuid`, `wallet-conceptos-sin-seed`, fuentes de la ayuda) | T8 + `./init.sh --rapido` |
| «Se ve bien» sin medirlo | T9: captura y cajas medidas de la barra contra `/ordenes` |

## 8. Textos

- Casillas: «Periodo», «A quién», «Entra/Sale», «Concepto», «Tipo de movimiento», «Cierre».
- Entra/Sale: opciones «Entra», «Sale»; placeholder «Todo». Concepto: placeholder «Todos».
- Orden: grupo «Ordenar el libro»; botones «Más recientes» / «Más antiguas» (nombre accesible + tooltip).
- Sin «SLA», sin jerga (R36). Los literales viven en los `*-labels.ts` de cada superficie; los tests de
  contrato (R4, R6, R7) los afirman como literal.
