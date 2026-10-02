# Ficha 467 — Revisión (barra del libro de la wallet igual a la de órdenes)

Revisor: reviewer, 2026-10-02. Rama revisada `origin/feature/467-wallet-barra-como-ordenes` @ `3b50e9b8`
(8 commits sobre `68aae8c2`), en un worktree propio (`review/467`).

> Grafo `codebase-memory`: no estaba en el conjunto de herramientas de este agente. Se revisó con el
> diff, `grep` y lectura de archivos.

## Veredicto

**APROBADA** para mergear a `dev`. 0 bloqueantes, 7 menores. **No apta para `done`** hasta marcar
`tasks.md` (m1) y anotar la entrada de `progress/history.md` (m2, leader), como en las 461/462/465.

## Gate (corrido por el revisor)

`progress/gate_review_467.log` (sin `tail` en la tubería, `INIT_EXIT` escrito dentro):

- `./init.sh --rapido` → **se niega** (`INIT_EXIT=1`): el diff toca cimientos (`wallet/_components/*`,
  `conceptos-filtro.ts`, `use-conceptos-con-movimientos.ts`, `zonas-filtros-labels.ts`…). Correcto.
- `./init.sh` completo, con `.env` copiado («los 326 archivos de tests contra Postgres SI se ejecutan»)
  y borrado al acabar: typecheck ✓, lint ✓, **2367 archivos / 32 860 tests en verde, 26 skipped**,
  `init OK`, **`INIT_EXIT=0`**. Coincide con lo que declaró el implementador. Los 26 skipped son
  `AnaliticaPage`/`AnaliticaShell`, preexistentes. Ningún rojo de integración (no hubo que aislar nada).

## Mutaciones del revisor (distintas de las del implementador)

| # | Mutación | Resultado |
| --- | --- | --- |
| M1 | `WalletModule.tsx:574` — quitar `if (salen.has(CASILLA.concepto)) fl.categoria = "";` (desmarcar Concepto ya no quita el filtro) | **2 rojos**: `WalletCajaBarra467` «R10 la ÚLTIMA casilla con valor…» y «R27/R28 desmarcar Concepto… FALLE» |
| M2 | `EstadoCuenta.tsx:658` — quitar `setPeriodo({desde:"",hasta:""})` de `limpiarTodo` | **1 rojo**: `EstadoCuentaBarra467` «R25: vacía término, periodo, tipo y cierre…» |
| M3 | `SelectorBuscable.tsx:215` — no pintar `etiqueta` con `rotuloVisible` | **4 rojos**: `SelectorBuscableRotulo467` R23, `WalletCajaBarra467` R23, `EstadoCuentaBarra467` R23 y R27/R28 (cierre) |

Las tres se repusieron restaurando el archivo desde HEAD; árbol limpio después. Los tests no son
decorativos. Nota: con M1, «R10 Concepto con valor (junto a Entra/Sale)» sigue verde porque la poda del
orquestador que queda montado emite y cubre el hueco; el caso de la ÚLTIMA casilla es el que lo caza,
exactamente como anticipa el design §2.

## Checklist

### Especificación
- [x] `requirements.md` con R1–R37 en EARS y sección «Aprobación» (2026-10-02, propuestas por defecto: sin Entra/Sale en estados de cuenta, periodo sin «Aplicar»). La implementación respeta ambas.
- [x] `design.md` con 6 alternativas descartadas y su porqué.
- [ ] `tasks.md` con todas las tasks `[x]` — **las 10 siguen en `[ ]`** → m1.

### Trazabilidad (R → test, verificado leyendo cada test)
- [x] Todos los R1–R37 tienen test concreto. Mapa en `progress/impl_467.md` comprobado contra los archivos:
  - R1, R3: `WalletCajaBarra467` «467 R1/R3» (2 casos) y `EstadoCuentaBarra467` «R1/R3/R7/R11» (4 superficies); guardia (c).
  - R2, R9: «R2/R9» en los dos (casillas marcadas en orden inverso; posición DOM de cada pieza; Descargar y columnas hermanos detrás).
  - R4: `orden-libro-iconos-467` (mismo objeto icono que `/ordenes`) + «R4» en los dos.
  - R5: no medible en jsdom; medido en T9 (`medidas.json`, capturas `02`, `08`, `10`, `12`): una línea a 1440 px, buscador 68–69 % del ancho. Aceptado (m6).
  - R6/R7: literales en `libro-caja-filtros-467` y en el `it.each` de superficies (satélite sin Cierre).
  - R8, R10 (×4 caja, ×2 estado de cuenta, incl. la última casilla y «sin valor = 0 lecturas»), R11.
  - R12–R16: «R12/R16», «R12/R18», «R13», «R14», «R15». El detalle de fila de la composición de R16 lo cubre `WalletCaja463.test.tsx:682` (adaptado y verde) → m4.
  - R17 (temporizadores falsos: un día emite a los 500 ms, sin «Aplicar»), R18, R19, R20 (elegido con 0), R21 (3 tipos de cuenta, literal), R22 (3 avisos de `/mi-wallet`), R23, R24.
  - R25/R26, R27/R28 (3 + 2 casos con fallo y con excepción), R29 (nada deshabilitado, pinta la última), R30, R31, R34, R35.
  - R32: guardia (b); R33: `SelectorBuscableRotulo467` «sin la prop, idéntico» + suites existentes verdes; R36: guardia (d) + `zonas-filtros-labels-463`; R37: guardia (a) sobre las 5 ayudas.
- [x] `progress/impl_467.md` contiene el mapa.
- [x] Tests borrados con sustituto: `filter-component-aplicar-463` y `filter-component-url-aplicar-463` → sus casos SIN la prop mudados a `filter-component.test.tsx:731` y `filter-component-url.test.tsx:472`; los de las dos zonas, «Aplicar»/«Quitar periodo» y «Limpiar todo conserva el periodo» (463 R1–R3/R15–R19/R30) se retiraron porque la 467 cambia ese contrato y los sustituyen R1/R3/R10/R25 de la 467. `ChipsEstadoCuenta` se borró y sus opciones siguen afirmadas en `EstadoCuenta.test.tsx` (sin «Todo») y R21.

### Calidad de código
- [x] typecheck, lint y tests en verde (gate completo del revisor).
- [x] E2E: no aplica (no toca flujos críticos; sin harness, según la memoria del proyecto). Verificación visual en la app hecha en T9.

### Datos y seguridad / capas / permisos / multi-país
- [x] **Sin servidor**: el diff no toca `lib/`, `db/`, acciones, rutas ni migraciones (comprobado sobre la lista de archivos del diff). Sin tablas, RLS ni webhooks.
- [x] Sin secretos ni hardcode de país/moneda (los importes siguen por `money`).
- [x] Capas: solo componentes cliente y módulos puros de declaraciones (`libro-caja-filtros.ts`, sin JSX).

### Componentes (intención del humano: «reutiliza los componentes, no inventes»)
- [x] **Ningún componente nuevo en `components/shared/`** (el diff no añade ningún archivo bajo `components/`). Se extendieron `SelectorBuscable` (prop opcional `rotuloVisible`, ausente = idéntico) y `opcionesDeConceptos` (`todos` opcional); se retiraron `ChipsEstadoCuenta`, `WalletFiltrosCaja` y el modo «Aplicar» de `FilterComponent` (sin otros consumidores: búsqueda de `aplicarConBoton`, `mismaSeleccion` y `RANGO_INVERTIDO_AVISO` en `app components lib tests` = 0).
- [x] Lo único nuevo es `app/(app)/wallet/_components/libro-caja-filtros.ts` (declaraciones, previsto en design §3.1).

### Verificación final
- [x] `./init.sh` verde.
- [x] Este informe.
- [ ] Entrada en `progress/history.md` → m2 (leader, al cerrar).

## Juicio de las desviaciones declaradas

1. **Dos `FilterComponent` en la caja (Periodo delante, Entra/Sale+Concepto detrás, «A quién» en medio).**
   **Aceptable.** Con uno solo, R9 (orden de las casillas) es imposible porque «A quién» es un
   `SelectorBuscable` fuera del orquestador. Reutiliza el mismo componente, con la MISMA espera estándar
   (no es la alternativa §6.2 descartada, que era por dos ritmos). Las dos emisiones posibles en la misma
   ventana no mezclan: `pedirLibro` (`WalletModule.tsx:516-519`) relee TODO si hay una lectura de wallet
   en vuelo, y el turno único pinta solo la última (cubierto por «R29» y el 463 B4).
2. **Props de `LibroCajaBarra` (`pedido`, `libroAplicado`, `senalSiembra`).** **Aceptable**: es una
   interfaz interna de `app/`, sin otros consumidores, y es lo que permite R29 (controles con lo pedido,
   nada deshabilitado) y R28 (siembra de cada orquestador solo con sus claves).
3. **`keepPreviousData` en `useConceptosConMovimientos`.** **Aceptable**, con evidencia (el `Select`
   suelta su valor si su opción desaparece), único consumidor `LibroCajaBarra`. Efecto lateral menor: m5.
4. **Textos «chip» → «tipo de movimiento».** **Aceptable y necesario**: en pantalla ya no hay chips;
   dejar la palabra sería jerga sin referente (R36).
5. **Contratos de otras fichas cambiados a propósito.** **Aceptables, todos están en el spec aprobado**:
   «Limpiar todo» quita periodo y «A quién» = R25 (y design §3.3 lo nombra como cambio respecto de la
   463 R30); Concepto sin «Todas» = design §3.1; el rótulo del cierre de `/mi-wallet` dentro del
   disparador = R23 y design §4.3 (335 R22 se conserva en lo que importa: `combobox` con `id` real y
   nombre accesible «Filtrar por cierre», `MiWalletFiltros` verde); chips → casilla = decisión 3 y R21.
   Cada test de otra ficha que se tocó lo dice en su título («467 R10», «(467)»); no se cambió un
   literal de contrato por su propia fuente.

## Hallazgos

Ninguno BLOQUEANTE.

| # | Nivel | Dónde | Qué | Qué hacer |
| --- | --- | --- | --- | --- |
| m1 | menor (bloquea `done`, no merge) | `specs/467-wallet-barra-como-ordenes/tasks.md:13,20,26,32,39,59,74,84,100,115` | Las 10 tareas siguen en `[ ]` aunque las 10 tienen commit. CHECKPOINTS exige `[x]`. | Marcar T1–T10 con su commit. |
| m2 | menor (leader) | `progress/history.md` | Sin entrada de la 467. | Añadirla al cerrar la ficha. |
| m3 | menor | `app/(app)/mi-wallet/_components/MiEstadoCuenta.tsx:88-98`; guardia `tests/unit/guards/wallet-barra-unica-467.guardia.test.ts:52-66` | R32 dice que la barra solo monta los cuatro compartidos; el Cierre de `/mi-wallet` es un `Select` de `components/ui/` montado por la superficie. Lo autoriza el design §4.3 aprobado (mismo `Select` que el `single` del orquestador), pero la guardia (b) solo mira `LibroCajaBarra` y `EstadoCuenta`, así que un control propio que entre por `selectorCierre` no lo vería nadie. | Opcional: anotar la excepción en la guardia o añadir `MiEstadoCuenta`/`SelectorCierreDeCuenta` con su lista permitida. |
| m4 | menor | `progress/impl_467.md` (fila R12, R13, R16) | La parte de R16 «el detalle de una fila de la composición» la verifica `tests/components/WalletCaja463.test.tsx:682-708`, que el mapa no cita. | Citarlo en el mapa. |
| m5 | menor | `components/shared/wallet/use-conceptos-con-movimientos.ts:43-49` | Con `keepPreviousData`, mientras se recuentan los conceptos tras cambiar Periodo/A quién/Entra-Sale, la lista muestra un instante los números de la selección anterior (R20 pide los de la aplicada). Transitorio, y es el menor de dos males frente a perder el valor elegido. | Ninguna acción; queda anotado. |
| m6 | menor | R5 | Solo se verifica a mano (T9, `progress/recorrido_467/medidas.json`); jsdom no mide. Las capturas confirman una línea a 1440 px. | Ninguna. |
| m7 | menor | `tests/components/EstadoCuentaBarra467.test.tsx:368-372` | El caso «desmarcar el Periodo» en estado de cuenta solo afirma sobre las llamadas que haya (si la caché sirve, 0 llamadas y pasa sin comprobar la lectura). El efecto queda cubierto por «R19 (467 R10)» de `EstadoCuenta463` y por la desaparición del control. | Opcional: forzar una clave sin caché, como hace el caso del Tipo de movimiento. |

Fuera de alcance, ya declarado por el implementador: la ayuda de satélites dice «del más antiguo al más
reciente» (inexacto desde la 463), no es de la barra.

## Pendiente antes de mergear (no es hallazgo de esta revisión)

- Mirar el build de Vercel del PR (comprobar los checks del PR): el gate no corre `next build`.
