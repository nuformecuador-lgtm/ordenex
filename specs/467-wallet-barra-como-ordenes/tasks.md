# Ficha 467 — Tareas

Zona `frontend`, sin servidor. Implementa `frontend_dev`. `[P]` = puede ir en paralelo con las otras
`[P]` del mismo bloque (no comparten archivos). Gate de cada task: `./init.sh --rapido` en verde (la
ficha no toca migraciones, `db/schema.prisma`, `lib/types/` ni build; si el modo rápido se niega, correr
el completo, nunca a la vez que otro agente mute el árbol). Escribir `INIT_EXIT=$?` dentro del log.

Antes de empezar: leer las preguntas abiertas de `requirements.md`. Si el humano cambió alguna al
aprobar (Abonos/Cargos, campo de orden, «Aplicar»), este desglose se ajusta primero.

## Bloque 1 — Componentes compartidos

- [x] **T1 — Orden con iconos** (deps: ninguna) [P]
  - `components/shared/wallet/zonas-filtros-labels.ts`: `Icono` en `ORDEN_LIBRO.opciones`
    (`ArrowDownWideNarrow` / `ArrowUpNarrowWide`); fuera `ZONA_WALLET_TEXTO` y
    `ZONA_LIBRO_TEXTO.alcance` cuando T5/T6 dejen de importarlos (en esta task solo se AÑADE).
  - **Hecho:** test unitario que afirma, como literal, etiquetas «Más recientes»/«Más antiguas» y que
    los iconos son los mismos objetos que `OPCIONES_DIRECCION.created_at` de órdenes (R4).

- [x] **T2 — `SelectorBuscable`: `rotuloVisible`** (deps: ninguna) [P]
  - Prop opcional (design §4.2).
  - **Hecho:** test de componente: con la prop, el disparador muestra «A quién: Todos» y, tras elegir,
    «A quién: <rótulo>» (R23); sin la prop, el texto y el `aria-label` del disparador son idénticos a
    hoy (R33). Suites existentes de `SelectorBuscable` y de sus consumidores verdes.

- [x] **T3 — `opcionesDeConceptos` sin «Todas»** (deps: ninguna) [P]
  - Modo sin la opción «todas» (design §3.1); el modo de hoy sigue igual para sus otros importadores.
  - **Hecho:** test unitario de los dos modos; el elegido con 0 movimientos sigue ofrecido (R20).

## Bloque 2 — Caja

- [x] **T4 — Declaraciones de la caja** (deps: T3)
  - `app/(app)/wallet/_components/libro-caja-filtros.ts` (design §3.1), con `seleccionDePeriodo` /
    `periodoDeSeleccion` mudadas desde `WalletFiltrosCaja.tsx`.
  - **Hecho:** test unitario: `CASILLAS_CAJA` es exactamente Periodo, A quién, Entra/Sale, Concepto en
    ese orden, como literal (R6); ida y vuelta `seleccionDeCaja` ↔ `deSeleccion`; Entra/Sale ofrece
    «Entra» y «Sale» sin «Todo» (R19).

- [x] **T5 — `LibroCajaBarra` + `WalletModule`** (deps: T1, T2, T4)
  - Reescribir `LibroCajaBarra.tsx` (design §3.2) y recablear `WalletModule.tsx` (design §3.3); borrar
    `WalletFiltrosCaja.tsx`; adaptar `tests/fixtures/libro-caja-barra.tsx`.
  - Actualizar los tests que localizan la tarjeta de zona, el `Select` de categoría o los conmutadores
    con texto: `tests/components/WalletCaja463.test.tsx`, `tests/components/WalletFiltros458.test.tsx`,
    `tests/unit/components/wallet-indemnizacion-libro.test.tsx`. Cambiar el LOCALIZADOR (abrir
    «Filtros», marcar la casilla), no el contrato que el test afirma.
  - **Hecho:** nuevo `tests/components/WalletCajaBarra467.test.tsx` verde, con las acciones dobladas,
    que cubre R1, R2 (orden de los hijos en la fila y `Descargar`/columnas como hermanos de la barra),
    R3, R6, R8 (marcar = 0 llamadas), R9, R10 (desmarcar Periodo con valor = 1 llamada a libro + 1 a
    resumen; desmarcar Concepto con valor = 1 a libro y 0 a resumen; la ÚLTIMA casilla también), R11,
    R12, R13, R16 (la entrada de resumen/desglose no lleva `tipo`/`categoria`/`q`), R17 (con
    temporizadores falsos: un rango de un día emite tras 500 ms, sin botón), R18, R20, R23, R25, R26,
    R27, R28 (acción que responde error y acción que LANZA: cifras y libro intactos, casillas y valores
    repuestos), R29 (dos cambios seguidos: pinta el segundo; ningún control deshabilitado), R30, R31
    (la descarga recibe `inputDeLibro` con todos los filtros), R34. Mutación anotada en
    `progress/impl_467.md`: quitar la unión `activos ∪ claves` en `fallo` ⇒ R27/R28 rojo.

## Bloque 3 — Estados de cuenta

- [x] **T6 — `EstadoCuenta` con la barra única** (deps: T1, T2)
  - `EstadoCuenta.tsx` (design §4.5); `SelectorCierreDeCuenta` y `SelectorMiCierre` (design §4.3);
    retirar `ChipsEstadoCuenta` si queda sin importadores (conservando `CHIPS_POR_TIPO`).
  - Actualizar los tests que localizan la sección de periodo, el botón «Aplicar», los chips o el
    selector de cierre: `tests/components/EstadoCuenta463.test.tsx` y los de tienda, mensajero, satélite
    y `/mi-wallet` que fallen (listarlos en `progress/impl_467.md`).
  - **Hecho:** nuevo `tests/components/EstadoCuentaBarra467.test.tsx` verde, con un lector doble, que
    cubre R1, R2, R3, R4, R7 (tienda/mensajero/`mi-wallet` con «Cierre»; satélite sin él; literal),
    R8, R9, R10, R11, R14, R15 (tarjetas iguales al cambiar tipo, cierre, término u orden), R21 (las
    opciones de Tipo de movimiento = `CHIPS_POR_TIPO[tipo]` sin «Todo», para los tres tipos), R22
    (avisos de `/mi-wallet`: no disponible, sin cierres, solo los recientes), R23, R24, R25, R26, R27,
    R28, R29, R30, R31 (`filasDelPeriodo` recibe periodo, chip, cierre, término y orden), R35.

## Bloque 4 — Limpieza, ayuda y guardias

- [x] **T7 — Retirar el modo «Aplicar» de `FilterComponent`** (deps: T5, T6)
  - Leer ENTEROS `filter-component-aplicar-463.test.tsx` y `filter-component-url-aplicar-463.test.tsx`;
    mudar a la suite general de `FilterComponent` toda aserción del camino SIN la prop; después borrar
    los dos archivos y la prop (design §4.4). Retirar `ZONA_WALLET_TEXTO`, `ZONA_LIBRO_TEXTO.alcance`,
    `ESTADO_CUENTA_TEXTO.periodoInvalido`, `FILTRO_DIRECCION`/`CATEGORIA_TODAS_OPTION` si quedan sin uso,
    y actualizar `tests/unit/components/zonas-filtros-labels-463.test.ts`.
  - **Hecho:** `grep -r aplicarConBoton app components lib tests` sin resultados; suites de
    `FilterComponent`, `/ordenes`, cierres y novedades verdes (R33); anotado en `progress/impl_467.md`
    qué aserciones se mudaron y adónde.

- [x] **T8 — Ayuda y guardias** (deps: T5, T6) [P con T7]
  - `docs/ayuda/oficina/wallet-caja.md`, `wallet-tiendas.md`, `wallet-mensajeros.md`, la ayuda del
    estado de cuenta de satélites (localizarla por sus `fuentes`) y `docs/ayuda/tienda/mi-wallet.md`:
    describir la barra única y «Filtros» con sus casillas; quitar «Aplicar», «Quitar periodo» y las dos
    zonas; actualizar `fuentes` (fuera `WalletFiltrosCaja.tsx`, dentro `libro-caja-filtros.ts`).
  - Nuevo `tests/unit/guards/wallet-barra-unica-467.guardia.test.ts`: (a) R37 — esas ayudas no contienen
    «Aplicar», «Quitar periodo», «Estos filtros cambian» ni «solo afectan al libro» y sí nombran
    «Filtros» y cada casilla de su superficie; (b) R32 — `LibroCajaBarra.tsx` y `EstadoCuenta.tsx` no
    importan `components/ui/select` ni `components/ui/label`; (c) R3 — ningún archivo de `app/` o
    `components/` contiene los textos de alcance de la 463; (d) R36 — los `*-labels.ts` tocados no
    contienen «SLA».
  - **Hecho:** la guardia nueva falla si se repone cualquiera de los textos retirados (comprobarlo una
    vez a mano y anotarlo); `wallet-textos-458`, `wallet-sin-uuid` y `wallet-conceptos-sin-seed` verdes.

## Bloque 5 — Verificación

- [x] **T9 — Verificación en la app** (deps: T7, T8)
  - Dev server local (si ya hay uno de otro agente, no levantar otro). Playwright, como admin: capturas
    a 1440 px de `/ordenes` y `/wallet`, y de un estado de cuenta de tienda, de mensajero, de satélite y
    `/mi-wallet` (como tienda). Guardar en el scratchpad y citar las rutas en `progress/impl_467.md`.
  - Medir con `boundingBox()`: (a) barra, «Descargar» y columnas en la misma línea (misma `y` ±4 px) sin
    casillas marcadas (R5); (b) ancho del buscador ≥ 50 % de la fila en la wallet; (c) alto del buscador,
    de los botones de orden y del disparador de cada casilla marcada iguales (R23); (d) comparar con las
    mismas medidas en `/ordenes`.
  - Recorrido: marcar Periodo y elegir un rango ⇒ cambian las cifras de la caja; marcar Concepto y elegir
    uno ⇒ cambia el libro y NO las cifras; «Limpiar todo» ⇒ todo vuelve a como al entrar, con el orden
    intacto. En un estado de cuenta, Tipo de movimiento y Cierre filtran el libro sin mover las tarjetas.
    Leer los textos visibles: sin «SLA», sin «Aplicar», sin textos de zona.
  - **Hecho:** capturas + números de las medidas en `progress/impl_467.md`; cualquier diferencia visible
    con la barra de `/ordenes` explicada o corregida.

- [x] **T10 — Gate** (deps: T9)
  - `./init.sh --rapido` en verde, revisando los `skipped` (no solo el código de salida). Revisar
    `gh pr checks` (build de Vercel) antes de pedir el merge.
  - **Hecho:** log con `INIT_EXIT=0` citado en `progress/impl_467.md` y mapa R→test completo.

## Trazabilidad R → test

| R | Test |
| --- | --- |
| R1, R2, R3 | `WalletCajaBarra467.test.tsx`, `EstadoCuentaBarra467.test.tsx`; R3 también `wallet-barra-unica-467.guardia` (c) |
| R4 | test de T1 + `EstadoCuentaBarra467` / `WalletCajaBarra467` (botones solo icono con nombre accesible) |
| R5 | T9 (medida con Playwright); orden estructural de la fila en `WalletCajaBarra467` (R2) |
| R6 | test de T4 (literal) + `WalletCajaBarra467` |
| R7 | `EstadoCuentaBarra467` |
| R8–R11 | `WalletCajaBarra467`, `EstadoCuentaBarra467` |
| R12, R13, R16 | `WalletCajaBarra467` |
| R14, R15 | `EstadoCuentaBarra467` |
| R17 | `WalletCajaBarra467` (temporizadores falsos) |
| R18, R19, R20 | `WalletCajaBarra467`; R19 también test de T4; R20 también test de T3 |
| R21, R22 | `EstadoCuentaBarra467` |
| R23 | test de T2 + los dos de superficie; altura real en T9 |
| R24 | `EstadoCuentaBarra467`, `WalletCajaBarra467` (aviso de caracteres que faltan, placeholder por superficie) |
| R25, R26, R27, R28, R29, R30, R31 | `WalletCajaBarra467`, `EstadoCuentaBarra467` |
| R32 | `wallet-barra-unica-467.guardia` (b) |
| R33 | test de T2 (sin prop) + suites existentes de `FilterComponent`, `BuscadorFiltros`, `SegmentedToggle`, `SelectorBuscable`, `/ordenes` (T7) |
| R34 | `WalletCajaBarra467` (entrada sin tocar: mismas entradas a las acciones que antes) |
| R35 | `EstadoCuentaBarra467` (sin tocar: `fallbackData` sin lectura extra, tarjetas iguales) |
| R36 | `wallet-barra-unica-467.guardia` (d) + T9 |
| R37 | `wallet-barra-unica-467.guardia` (a) |
