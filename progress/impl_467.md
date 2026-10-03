# Ficha 467 — Implementación (barra del libro de la wallet igual a la de órdenes)

Rama `feature/467-wallet-barra-como-ordenes` (nace de `68aae8c2`). Zona `frontend`, sin servidor, sin
migraciones. Implementó `frontend_dev` el 2026-10-02.

> Grafo `codebase-memory`: no estaba en el conjunto de herramientas de este agente; se buscó con
> `grep`/lectura de archivos (el design §0 ya lo había verificado contra el archivo real).

## Qué se hizo, por tarea

| Tarea | Commit | Qué |
| --- | --- | --- |
| T1–T3 | `4494865e` | `ORDEN_LIBRO` con los iconos de `/ordenes`; `SelectorBuscable rotuloVisible`; `opcionesDeConceptos` con `todos` opcional |
| T4 | `174c87a9` | `libro-caja-filtros.ts` (casillas, declaraciones, ida y vuelta, `casillasConValor`); `LIBRO_CAJA_FILTROS_TEXTO` sustituye a `FILTRO_DIRECCION` |
| T5 | `94e67bbd` | `LibroCajaBarra` reescrita; `WalletModule` recableado (`activos`, `pedidoVista`, `aplicarCambio`, `cambiarActivos`, `limpiarTodo`, `mismaWallet`, unión de casillas en `fallo`); fuera `WalletFiltrosCaja.tsx` |
| T6 | `e4c814d7` | `EstadoCuenta` con la barra única (casillas Periodo / Tipo de movimiento / Cierre); fuera la sección de periodo y `ChipsEstadoCuenta` (`CHIPS_POR_TIPO` se muda a `estado-cuenta-labels.ts`); `SelectorCierreDeCuenta` y `SelectorMiCierre` con el nombre dentro del disparador y `h-8` |
| T7 | `9f27347a` | Fuera el modo «Aplicar» de `FilterComponent`; fuera `ZONA_WALLET_TEXTO` y `ZONA_LIBRO_TEXTO.{nombre,alcance}` |
| T8 | `9eafab44` | Ayuda de caja, tiendas, mensajeros, satélites y `/mi-wallet`; guardia `wallet-barra-unica-467` |
| T9 | `db59db2d` | Capturas y medidas en `progress/recorrido_467/` |
| T10 | (este commit) | Gate e informe |

## Mapa R → test

| R | Test |
| --- | --- |
| R1 | `WalletCajaBarra467` «R1»; `EstadoCuentaBarra467` «R1/R3/R7/R11» (las cuatro superficies) |
| R2 | `WalletCajaBarra467` «R2/R9» (orden de la fila y Descargar/columnas hermanos detrás); `EstadoCuentaBarra467` «R2/R9» |
| R3 | `WalletCajaBarra467` «R3»; `EstadoCuentaBarra467` (cuatro superficies); guardia (c) |
| R4 | `orden-libro-iconos-467` (literal + iconos idénticos a `OPCIONES_DIRECCION.created_at`); «R4» en los dos de superficie |
| R5 | T9 (medido, abajo); estructura de la fila en «R2/R9» |
| R6 | `libro-caja-filtros-467` (literal); `WalletCajaBarra467` «R6/R11» |
| R7 | `EstadoCuentaBarra467` «R1/R3/R7/R11» (tienda/mensajero/`mi-wallet` con Cierre, satélite sin él; literal) |
| R8 | «R8» en los dos de superficie (marcar = 0 lecturas) |
| R9 | «R2/R9» en los dos (se marcan en otro orden y salen en el de las casillas) |
| R10 | `WalletCajaBarra467` «R10» ×4 (Periodo = 1 libro + 1 cifras; Concepto = 1 libro y 0 cifras; la ÚLTIMA casilla; sin valor = 0); `EstadoCuentaBarra467` «R10» ×2 |
| R11 | «R6/R11» (caja) y superficies (estado de cuenta) |
| R12, R13, R16 | `WalletCajaBarra467` «R12/R16», «R12/R18», «R13» |
| R14, R15 | `EstadoCuentaBarra467` «R14», «R15» |
| R17 | `WalletCajaBarra467` «R17» (temporizadores falsos: un día emite a los 500 ms, sin botón); `libro-caja-filtros-467` (un día es válido) |
| R18 | `WalletCajaBarra467` «R18», «R12/R18»; `WalletFiltroAQuien458E` |
| R19 | `libro-caja-filtros-467`; `WalletCajaBarra467` «R13» |
| R20 | `conceptos-filtro` (bloque 467); `WalletCajaBarra467` «R20» |
| R21 | `EstadoCuentaBarra467` «R21» (tienda, mensajero, bodega; sin «Todo») |
| R22 | `EstadoCuentaBarra467` «R22» (no disponible, sin cierres, solo los recientes); `MiWalletFiltros` |
| R23 | `SelectorBuscableRotulo467`; «R23» en los dos de superficie; T9 (alturas reales) |
| R24 | `EstadoCuentaBarra467` «R24»; `WalletCaja463` «R24» |
| R25, R26 | «R25/R26» en los dos de superficie |
| R27, R28 | `WalletCajaBarra467` «R27/R28» ×3; `EstadoCuentaBarra467` «R27/R28» ×2 |
| R29 | «R29» en los dos de superficie (ningún control deshabilitado; pinta la última) |
| R30 | `WalletCajaBarra467` «R30»; `EstadoCuentaBarra467` «R30/R35»; `WalletCaja463` «R31» |
| R31 | «R31» en los dos de superficie |
| R32 | guardia (b) |
| R33 | `SelectorBuscableRotulo467` (sin la prop, idéntico); suites de `FilterComponent`, `BuscadorFiltros`, `SegmentedToggle`, `SelectorBuscable`, `/ordenes`, cierres y novedades (gate) |
| R34 | `WalletCajaBarra467` «R34» |
| R35 | `EstadoCuentaBarra467` «R30/R35» |
| R36 | guardia (d); `zonas-filtros-labels-463` «R48» ampliado con los textos de la 467; T9 |
| R37 | guardia (a) |

## Mutaciones (anotadas)

- **T5** — quitar `setActivos(unirCasillas(...))` de `fallo` en `WalletModule` ⇒ **2 rojos**
  (`WalletCajaBarra467` «R27/R28: desmarcar Concepto… falla» y «R28: una lectura que LANZA…»). Repuesto.
- **T6** — lo mismo en `conservarLoUltimo` de `EstadoCuenta` ⇒ **1 rojo** (`EstadoCuentaBarra467` R27/R28). Repuesto.
- **T8** — reponer «Estos filtros cambian toda la wallet» en `zonas-filtros-labels.ts` y «Aplicar» en la
  ayuda de la caja ⇒ **2 rojos** de la guardia (c) y (a). Repuesto.

## T7 — qué se mudó y adónde

- `filter-component-aplicar-463.test.tsx` → su bloque «463 R22» (las emisiones SIN la prop: racha con
  debounce = una emisión; `debounceMs={0}` = en el acto) se mudó a `filter-component.test.tsx`
  («463 R22 (mudado en la 467)»). El resto (R16–R19, `mismaSeleccion`, siembra en modo Aplicar) medía el
  modo retirado.
- `filter-component-url-aplicar-463.test.tsx` → su caso SIN la prop (precarga de la URL emitida una vez
  al vencer el debounce, mutación M5) se mudó a `filter-component-url.test.tsx`. El otro caso medía el
  modo retirado.
- `grep -r aplicarConBoton app components lib tests` → sin resultados.

## Tests de otras fichas actualizados (localizador, no contrato — salvo lo que la 467 cambia a propósito)

- **Caja (T5):** `WalletCaja463`, `WalletCaja464`, `WalletFiltroAQuien458E`, `WalletFiltros458`,
  `WalletLibroCaja458E`, `descarga/WalletDescarga`, `integration/wallet-page`,
  `unit/components/wallet-indemnizacion-libro`; fixtures `libro-caja-barra.tsx`, `periodo-calendario.ts`
  (ahora marca la casilla «Periodo» y no pulsa «Aplicar») y la nueva `barra-libro-wallet.ts`.
- **Estado de cuenta (T6):** `EstadoCuenta`, `EstadoCuenta458DPantalla`, `EstadoCuenta463`,
  `MiWalletFiltros`, `MiWalletResumenVigente`, `PremioRankingRotulo`, `WalletFiltros458`,
  `integration/mi-wallet-page`, `unit/components/desglose-tienda-ledger`,
  `unit/descarga/estado-cuenta-descarga-columnas`.
- **Ayuda (T8):** `unit/asistente/contexto-458` (sus literales siguen a la ayuda).
- **Contratos que la 467 cambia a propósito** (y así se dice en cada test): las dos zonas y su alcance
  (463 R1–R3/R5), «Aplicar»/«Quitar periodo» (463 R15–R17/R19), «Limpiar todo» que conservaba periodo
  y «A quién» (463 R30, 458-E), la opción «Todas las categorías» del Concepto, el rótulo de cierre de
  `/mi-wallet` ENCIMA del control (335 R22: ahora dentro del disparador), los chips como conmutador.

## Desviaciones del spec

1. **Caja: dos orquestadores, no uno** (design §2/§3.2 decía UN `FilterComponent`). R9 exige los
   controles en el orden de las casillas —Periodo, **A quién**, Entra/Sale, Concepto— y «A quién» es un
   `SelectorBuscable` que no puede ir dentro del orquestador. Con uno solo, «A quién» saldría detrás de
   Concepto. El Periodo va en su propio `FilterComponent` delante y Entra/Sale + Concepto en otro detrás,
   los dos con la misma espera estándar (no es la alternativa descartada §6.2, que proponía dos ritmos).
   En el estado de cuenta sí es uno (el Cierre va al final, como su casilla).
2. **Props de `LibroCajaBarra`** distintas de §3.2: recibe `pedido` (lo pedido, en estado) además de lo
   aplicado, y `senalSiembra` en vez de `siembraSeleccion`. Así los controles dicen lo PEDIDO mientras una
   lectura viaja (R29: nada se deshabilita) y la siembra de cada orquestador sale de lo vigente (también
   si se remonta tras desmarcar la última casilla, sin reponer un valor viejo).
3. **`ZONA_LIBRO_TEXTO` queda solo con `buscar`**; la etiqueta «Periodo» no se conserva en
   `zonas-filtros-labels.ts` (vive en `LIBRO_CAJA_FILTROS_TEXTO` y `CASILLAS_ESTADO_CUENTA_TEXTO`, que
   son quienes la usan). `CATEGORIA_TODAS_OPTION` se conserva: el modo con «todas» de
   `opcionesDeConceptos` sigue existiendo y su test lo usa.
4. **Añadido no pedido, con evidencia:** `useConceptosConMovimientos` con `keepPreviousData`. Una sonda
   midió que el `Select` de base-ui **suelta su valor** si su opción desaparece de la lista: un concepto
   recién elegido (aún en la espera de 500 ms) se perdía si la lista de conceptos se vaciaba al
   recontarse. Apareció como rojo intermitente de `WalletCajaBarra467` bajo carga. Único consumidor del
   hook: `LibroCajaBarra`.
5. **Textos fuera de la barra tocados por coherencia:** el aviso del tope de la descarga del estado de
   cuenta decía «un chip» → «un tipo de movimiento» (ya no hay chips en pantalla; su test literal se
   actualizó); en la ayuda, «el chip **Cobros/Pagos/Premios**» → «el tipo de movimiento …». Fuera
   `ESTADO_CUENTA_TEXTO.{aplicar,limpiar,periodoInvalido}` (sin uso).
6. La ayuda de satélites dice «El extracto, del más antiguo al más reciente», que ya era inexacto desde
   la 463 (se entra en «Más recientes»). No se tocó: fuera del alcance de la barra.

## T9 — verificación en la app (1440 × 900, dev server propio, `admin.qa` / `tienda.qa`)

Capturas en `progress/recorrido_467/` (`01`…`13`) y números en `medidas.json`.

- **R5 sin casillas** (misma `y` y alto 32 px para barra, Descargar y columnas):
  `/ordenes` fila y=265, buscador 592 px de 1136 (52 %); `/wallet` fila y=1900, buscador **752 px de
  1104 (68 %)**; tienda y mensajero y=469/537, buscador 784 de 1136 (69 %); `/mi-wallet` y=650, 784 de
  1136. Todo en una línea.
- **R23:** orden (32 × 32 por botón), buscador, «Filtros», Descargar, columnas y cada disparador de
  casilla marcada (Periodo, A quién, Entra/Sale, Concepto, Tipo de movimiento, Cierre) miden **32 px** de
  alto en las cinco superficies.
- **Comparación con `/ordenes`:** misma fila (orden en iconos al principio, buscador ancho, «Filtros»,
  Descargar, columnas). Diferencias explicadas: `/ordenes` lleva además «Vistas» y el conmutador de
  campo (fuera de alcance / pregunta abierta 2). Con las cuatro casillas de la caja marcadas la barra pasa
  a 2–3 líneas (como `/ordenes` con varios filtros): R5 solo pide una línea sin casillas.
- **Recorrido caja:** Periodo (días 1–2) ⇒ las cifras cambian («Movimiento neto del periodo … ₡0»);
  quitando el periodo y eligiendo Concepto «Flete por devolución a origen cobrado a la tienda (1)» ⇒ el
  libro pasa de 21 a 2 filas y **las cifras no cambian**; «Más antiguas» + «Limpiar todo» ⇒ sin controles
  montados, «Más antiguas» sigue pulsado y las cifras vuelven a las de la entrada.
- **Estados de cuenta:** tienda y mensajero ofrecen Periodo/Tipo de movimiento/Cierre; satélite
  Periodo/Tipo de movimiento; elegir un tipo de movimiento filtra sin mover las tarjetas (tienda y
  mensajero, medido). `/mi-wallet` (como tienda): Periodo/Tipo de movimiento/Cierre, Cierre a 32 px.
- **Textos:** ni «SLA», ni «Aplicar», ni «Quitar periodo», ni «Estos filtros…» en la caja.
- Nota: en local, `/wallet` abre para el admin el diálogo «Confirmá el SINPE de GAM» (SF-001, ya en
  `dev`); se cerró con «Ahora no» (no escribe). No es de esta ficha.

## T10 — gate

- `./init.sh --rapido` **se negó** (exit 1, `progress/gate_467_rapido.log`): el diff toca archivos que
  clasifica como cimientos (`wallet/_components/*`, `zonas-filtros-labels.ts`, …). Como manda el
  arnés, se corrió el **completo**.
- `./init.sh` completo (`progress/gate_467.log`, con el `.env` copiado y borrado después:
  «DATABASE_URL resuelta: los 326 archivos de tests contra Postgres SI se ejecutan»):
  typecheck ✓, lint ✓, **2367 archivos / 32 860 tests en verde, 26 skipped**, `init OK`,
  **`INIT_EXIT=0`**. Los 26 skipped son `AnaliticaPage` (17) y `AnaliticaShell` (9), ajenos a esta
  ficha y ya saltados antes.
- `gh pr checks`: no aplica todavía (no se abrió PR, por instrucción). Antes de mergear hay que mirar el
  build de Vercel del PR.
- Bajo la carga de la corrida paralela de ~760 archivos, un caso de `WalletCajaBarra467` (R12/R16) salió
  rojo una vez por encadenar pasos sin esperar la emisión de 500 ms; aislado pasaba 3/3. Se ancló cada
  paso a su lectura y llevó a la desviación 4 (la sonda del `Select`). En el gate completo, verde.
