# Ficha 463 — Wallets: buscador y orden del libro — bitácora del BACKEND (T1–T4)

Rama `feature/463-wallets-filtros-y-orden`, nacida de `78972be6` (incluye 465 y 466). Agente: backend_dev.
El frontend (T5–T10, incluido el modo «Aplicar» de `FilterComponent`, que `tasks.md` asigna a T5/frontend)
lo hace un frontend_dev después, en esta misma rama.

Búsqueda de código: se usó `grep`/lectura directa de archivos (el MCP `codebase-memory` no estaba en
el conjunto de herramientas de este agente).

**Sin migraciones, sin índices, sin RLS nueva** (design §1). No hizo falta índice para la búsqueda:
el término se resuelve con `ILIKE` dentro de un conjunto ya acotado (cuenta o periodo de la caja).

## Archivos

Creados:
- `lib/config/libro-wallet.ts` — `BUSQUEDA_LIBRO_MIN_CHARS = 3`, `BUSQUEDA_LIBRO_MAX_CHARS = 100`,
  `CAMPOS_ORDEN_LIBRO = ["fecha"]`.
- `tests/unit/types/wallet-libro-463-schemas.test.ts` (T1).
- `tests/unit/actions/wallet-libro-463-actions.test.ts` (T4 + servicio de la caja).
- `tests/integration/db/libro-caja-busqueda-orden-463.test.ts` (T2, Postgres real).
- `tests/integration/db/estado-cuenta-busqueda-orden-463.test.ts` (T3, Postgres real).
- `tests/integration/db/saldos-tiendas-busqueda-463.test.ts` (T4/R45, Postgres real).

Modificados (código):
- `lib/types/wallet.ts` — `listarLibroCajaSchema` / `listarLibroCajaCompletoSchema` (+ `q`, `sortBy`,
  `sortDir` con default `desc`, `.strict()`); `ListarLibroCaja(Completo)ServicioInput` (término y orden
  opcionales para llamadores internos). `listarMovimientosSchema` SIN cambios de forma (R14).
- `lib/types/estado-cuenta.ts` — `q` + `esquemaOrdenamiento(CAMPOS_ORDEN_LIBRO, "fecha", "desc")` en
  `filtrosDelExtracto` (las cuatro variantes lo heredan).
- `lib/types/wallet-tienda.ts` — `busqueda` en el paginado de saldos (el completo la hereda).
- `lib/repositories/libro-caja-a-quien-sql.ts` — `patronDeTermino`, `condicionTerminoCajaSql`,
  `whereLibroCajaConTerminoSql`.
- `lib/repositories/WalletMovimientoRepository.ts` — `listar`: término y `sortDir` (ambos caminos, con
  `ordenTotal`; con término o «A quién» va por SQL).
- `lib/interfaces/repositories/IWalletMovimientoRepository.ts` — `ListarMovimientosFiltros.termino/sortDir`
  (NO en `BalanceFiltros`: ningún agregado de las cifras puede recibirlos).
- `lib/repositories/EstadoCuentaRepository.ts` — `terminoSql`, `sentidoSql`; `ORDER BY` final según
  `sortDir` en `paginar` y `paginaDeBodega`; el conteo con el mismo `FROM … LEFT JOIN usuario`.
  La ventana `OVER (ORDER BY …)` NO se toca.
- `lib/interfaces/repositories/IEstadoCuentaRepository.ts` — `VentanaDeLibro.termino/sortDir/conNombreRegistrador`.
- `lib/services/EstadoCuentaService.ts` — propaga `q`, `sortDir`, `conNombreRegistrador = vista === "oficina"`.
- `lib/interfaces/services/IEstadoCuentaService.ts` — docstring (orden ya no siempre ascendente).
- `lib/services/WalletService.ts`, `lib/interfaces/services/IWalletService.ts` — `listarMovimientos` y
  `listarMovimientosCompleto` llevan `termino`/`sortDir` al repositorio (`terminoYOrden`, fuera de
  `construirFiltros`, que comparten las cifras).
- `lib/actions/wallet.ts` — `listarMovimientosAction`/`listarMovimientosCompletoAction` parsean los
  esquemas nuevos; resumen/desglose/detalle de fila SIN cambio de esquema.
- `lib/repositories/WalletTiendaMovimientoRepository.ts`, `lib/interfaces/repositories/IWalletTiendaMovimientoRepository.ts`,
  `lib/services/WalletTiendaService.ts`, `lib/interfaces/services/IWalletTiendaService.ts`,
  `lib/actions/wallet-tienda.ts` — `busqueda` de saldos de tiendas hasta el repositorio (mismo criterio
  que «Cuentas por pagar»: recorte, minúsculas, sin acentos, subcadena, sin comodines).

Modificados (tests existentes, por el cambio de contrato — nada borrado):
- Llamadas DIRECTAS al servicio del estado de cuenta (sin pasar por el esquema) que daban por hecho el
  orden cronológico de la 458 (D4): ahora lo piden explícito con `CRONOLOGICO = { sortBy: "fecha",
  sortDir: "asc" }` (nuevo en `tests/integration/db/_fixtures/wallet-458.ts`): `estado-cuenta-concurrencia-458`,
  `estado-cuenta-pago-tienda-172r53`, `estado-cuenta-servidor-458d`, `mi-wallet-resumen-458d` y
  `leerEstadoCuenta` del fixture.
- Comparaciones acción-vs-servicio que mezclaban default `desc` (acción) con `asc` (servicio): piden
  `sortDir: "asc"` en la acción: `estado-cuenta-cierre-pagos-172r52` (porLaAction), `estado-cuenta-servidor-458d`
  (`oficinaCierres`).
- Afirmaciones de «la entrada parseada que llega al servicio» ganan `sortBy: "fecha", sortDir: "desc"`
  (es R34): `estado-cuenta-458d-action`, `wallet-tienda-actions`, `wallet-caja-descarga-action`,
  `wallet-tienda-descarga-action`.
- `wallet-listados-descarga-action` (R17): `{ busqueda: "" }` ya no es clave colada para «Saldos de
  tiendas» (R45 la declara); sigue probándose para las plantillas.

## Decisiones técnicas (anotadas, no preguntadas)

1. **Texto buscable de la caja (R25):** descripción + nombre y referencia de `wallet_anotacion` +
   nombre COMPLETO (nombre + apellidos) del `registrado_por`. La anotación se lee con la MISMA regla
   que la columna «A quién» y el filtro de la 458-E (revisión M2): el contra-asiento de un egreso o de
   una corrección anulados hereda la anotación de su ORIGINAL, y solo en orígenes `gasto`/`manual`.
   «Quién registró» es la persona de `registrado_por`; las filas automáticas (aprobación de cierre,
   plantilla…) no tienen persona registradora y no casan por nombre.
2. **Estado de cuenta (R26):** descripción + nombre de `registrado_por` (`NOMBRE_SQL`); en la bodega la
   descripción es NULL, así que solo casa por quien solicitó/recibió.
3. **Escapado (R28):** `escaparComodinesLike` (escape `\`, el por defecto de `LIKE`) en los dos repositorios.
4. **Servicio de la caja:** `q`/`sortDir` OPCIONALES en su tipo (`ListarLibroCajaServicioInput`), ausente
   ⇒ `desc` = comportamiento de siempre. **Servicio del estado de cuenta:** usa el tipo inferido del
   esquema (orden OBLIGATORIO); el compilador encontró todos los llamadores directos (solo tests).
5. **Saldos de tiendas:** `listarSaldosTiendasCompleto(actor, filtro?)` — segundo parámetro opcional para
   no cambiar la firma de los consumidores existentes; la acción sin `busqueda` llama como siempre.
6. **`Prisma.raw` evitado** en `libro-caja-a-quien-sql.ts` (guardia `caja-173-alcance` M1): el nombre del
   registrador va como `Prisma.sql` literal (misma expresión que `nombreCompletoUsuarioSql`).

## Contratos para el frontend

Caja (`lib/actions/wallet.ts`):
- `listarMovimientosAction(input)` — esquema `listarLibroCajaSchema`: lo de siempre (`page`, `pageSize`,
  `tipo`, `categoria`, `desde`, `hasta`, `aQuien`) + `q?: string` (recortado, 3..100; **no mandar vacío
  ni < 3**: es `validation_error`) + `sortBy?: "fecha"` + `sortDir?: "asc" | "desc"` (default `"desc"`).
- `listarMovimientosCompletoAction(input)` — igual sin `page`/`pageSize` (R42).
- `verResumenCajaAction`, `verDesgloseEgresosAction`, `listarMovimientosDeFilaAction`: **NO** aceptan
  `q`, `sortBy` ni `sortDir` (`.strict()` ⇒ `validation_error`). `inputDeWallet` no debe llevarlos (R12/R14).
- `conceptosConMovimientosAction({ libro: "caja", tipo?, desde?, hasta?, aQuien? })` ya existía y cubre R13
  (opciones con periodo, «A quién» y Entra/Sale; sin `q`).
- Constantes: `BUSQUEDA_LIBRO_MIN_CHARS`, `BUSQUEDA_LIBRO_MAX_CHARS`, `CAMPOS_ORDEN_LIBRO` en
  `lib/config/libro-wallet.ts`; `DireccionOrden` en `lib/types/ordenamiento-listado.ts`.

Estado de cuenta (`lib/actions/estado-cuenta.ts`, las cuatro acciones `ver(Mi)EstadoCuenta(Completo)Action`):
- + `q?: string` (3..100, recortado) + `sortBy?: "fecha"` + `sortDir?: "asc" | "desc"` (default `"desc"`).
- El servidor devuelve SOLO filas de movimientos (sin línea de saldo inicial). `total` = filas del
  conjunto filtrado (chip/cierre/término). La posición del saldo inicial (R38/R39/R43) es de la pantalla:
  `asc` ⇒ primera de la página 1; `desc` ⇒ última de la última página (`page === ceil(total/pageSize)` o
  `total === 0`). El `saldoCorrido` de cada fila es el mismo en los dos sentidos (R37, probado).
- Las tarjetas (`saldoInicial`, `abonos`, `cargos`, `saldoFinal`, `saldoActual`) NO dependen de `q`,
  `chip`, `cierreId` ni `sortDir` (R11, probado).
- En `/mi-wallet` el término solo mira la descripción (R27): el placeholder no debe nombrar «quién registró».
- **Ojo (estado intermedio de la rama):** con el default `desc` del esquema, la pantalla actual (antes
  del frontend) ya recibe el libro en «Más recientes» pero sigue pintando el saldo inicial arriba en la
  página 1 y como primera fila del Excel. Lo corrige T8.

Saldos de tiendas (`lib/actions/wallet-tienda.ts`):
- `listarSaldosTiendasPaginadoAction({ page?, pageSize?, busqueda? })` y
  `listarSaldosTiendasCompletoAction({ busqueda? })` — `busqueda` texto libre (sin mínimo, como
  `/wallet/mensajeros`); el total es el del conjunto filtrado.

## Mapa R<n> → test (parte backend)

| R | Test |
| --- | --- |
| R11 | `estado-cuenta-busqueda-orden-463` «R11: las tarjetas del periodo no cambian con termino, chip u orden» |
| R12 | `wallet-libro-463-actions` «R12: el resumen lee los agregados … sin termino ni orden»; tipo `BalanceFiltros` sin `termino`/`sortDir` |
| R13 | (servidor existente) `libro-caja-filtro-a-quien` — conceptos con periodo + «A quién» + tipo; la llamada con la zona de la wallet es T7 |
| R14 | `wallet-libro-463-schemas` «R14 — el borde de las cifras rechaza…»; `wallet-libro-463-actions` «R14: las cifras de la caja rechazan termino y orden SIN leer» (resumen, desglose, detalle de fila; servicio no llamado) |
| R24 | `libro-caja-busqueda-orden-463` «R24: sin distinguir mayusculas…», «R40/R24…»; `estado-cuenta-busqueda-orden-463` «R24/R26…», «R40/R24…»; esquemas «R24: termino por debajo del minimo…» |
| R25 | `libro-caja-busqueda-orden-463` «R25: cada campo encuentra su fila…» |
| R26 | `estado-cuenta-busqueda-orden-463` «R24/R26: en la oficina…» (tienda por descripción y registrador, bodega por registrador, mensajero por descripción) |
| R27 | `estado-cuenta-busqueda-orden-463` «R27: en /mi-wallet buscar el nombre … da lo mismo que un texto ausente» |
| R28 | `libro-caja-busqueda-orden-463` «R28…» (`%`, `_`, `%%%`); `estado-cuenta-busqueda-orden-463` «R28…» (`%%%`, `___`) |
| R33 | `wallet-libro-463-schemas` «las constantes…» (solo `fecha`; direcciones `asc`/`desc`) — el control visible es T6/T7/T8 |
| R34 | esquemas «R34: por defecto…» y «default «Mas recientes» (R34/R47)» ×4; `libro-caja-busqueda-orden-463` «R34/R46…»; `estado-cuenta-busqueda-orden-463` «R34/R47…»; `wallet-libro-463-actions` «R34: sin orden…» |
| R35 | `libro-caja-busqueda-orden-463` / `estado-cuenta-busqueda-orden-463` «R36…»: la página 1 en `desc` es la cabeza del conjunto COMPLETO (servidor), no una página reordenada |
| R36 | `libro-caja-busqueda-orden-463` «R36…» (Prisma y SQL, con empates de instante y de `created_at`); `estado-cuenta-busqueda-orden-463` «R36…» (tienda, mensajero, bodega con 3 filas empatadas) |
| R37 | `estado-cuenta-busqueda-orden-463` «R37: el saldo corrido de cada fila es el MISMO en los dos sentidos» |
| R40 | esquemas «R40…» (caja ×2, estado de cuenta ×4); `wallet-libro-463-actions` «R40/R24…» (caja y estado de cuenta, servicio no llamado); integración «R40/R24…» en los dos archivos |
| R41 | (frontend, T8 — clave SWR) |
| R42 | `libro-caja-busqueda-orden-463` «R42: la descarga trae el conjunto filtrado completo…»; `wallet-libro-463-actions` «R42: la descarga recibe el termino y el orden» |
| R43 | `estado-cuenta-busqueda-orden-463` «R43/R44…» (orden del conjunto descargado; la línea del saldo inicial es T8) |
| R44 | `wallet-libro-463-actions` «R44: la descarga con termino y orden por encima del tope…»; `estado-cuenta-busqueda-orden-463` «R43/R44…» (tope bajado a 3) |
| R45 | `saldos-tiendas-busqueda-463` (4 casos R45 + alcance); `wallet-libro-463-schemas` «R45…»; `wallet-libro-463-actions` «R45…» |
| R46 | `libro-caja-busqueda-orden-463` «R34/R46…» (página 1 sin filtros = «Más recientes», el orden de siempre); el resumen no cambia de código ni de esquema |
| R47 | `estado-cuenta-busqueda-orden-463` «R34/R47…» + «R11…» |

R1–R10, R15–R23, R29–R32, R38, R39, R41, R48, R49: pantalla (T5–T10, frontend).

## Mutaciones (todas medidas, todas muertas; restauradas y comparadas con `cmp`)

Caja — `libro-caja-busqueda-orden-463` (9 tests):
| Mutación | Rojo |
| --- | --- |
| M1 quitar `OR a."referencia" ILIKE` | R25 |
| M2 sin `escaparComodinesLike` | R28 |
| M3 `ORDER BY` SQL siempre `DESC` | 6 tests (R36, R42, …) |
| M4 `orderBy` de Prisma siempre `desc` | R36 |
| M5 sin la rama del registrador (`WHERE FALSE AND …`) | R25 |
| M6 desempate `created_at` fijo `ASC` en SQL | R36 |
| M7 sin la rama de la descripción | 7 tests |
| M8 anotación de la propia fila (sin la regla M2 del contra-asiento) | R24, R25 |

Estado de cuenta — `estado-cuenta-busqueda-orden-463` (10 tests):
| Mutación | Rojo |
| --- | --- |
| E1 invertir TAMBIÉN la ventana `OVER (ORDER BY …)` con `desc` | R37 (+R27, R43/R44) |
| E2 sin la rama del nombre del registrador | R24/R26, R27 |
| E3 sin escapar comodines | R28 |
| E4 `ORDER BY` final siempre `ASC` | R37 (+R27, R43/R44) |
| E5 `conNombreRegistrador` siempre `true` | R27 |
| E6 bodega: desempate `orden`/`id` fijo `ASC` | R36 (sobrevivía con el escenario de la 458, sin empates en la bodega; se sembraron 3 filas empatadas y muere) |
| E7 el término fuera del `count(*)` | 4 tests |

Saldos de tiendas — `saldos-tiendas-busqueda-463` (5 tests):
| T1 el repositorio ignora la búsqueda | 4 tests R45 |
| T2 la descarga no pasa la búsqueda al servicio | R45 descarga |

No-vacuidad: cada integración afirma conteos exactos del conjunto sembrado (9 filas de caja; 7/6/6 filas
de las cuentas; 3 tiendas) y ningún test tiene `if (!x) return;`. Las tres corren contra el Postgres local
(`.env` del repo), dentro de `enTransaccionRevertida459` (no dejan datos).

## Verificación (salida real)

Gate COMPLETO `./init.sh` (toca `lib/types/`, el rápido se niega), secuencial y sin otro agente mutando
el árbol, en `progress/gate_463_backend.log` (sin `tail`, `INIT_EXIT` escrito dentro):

```
✓ feature_list.json: sin ids duplicados (461 fichas), cupo por zona respetado (in_progress=1) y specs en su sitio
✓ typecheck paso                         (pnpm run typecheck → tsc --noEmit, 0 errores)
✖ 220 problems (0 errors, 220 warnings)  (pnpm run lint; warnings preexistentes, ninguno en archivos de la 463)
✓ lint paso
✓ DATABASE_URL resuelta: los 325 archivos de tests contra Postgres SI se ejecutan
 Test Files  2346 passed (2346)
      Tests  32584 passed | 26 skipped (32610)
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 2346 ejecutado(s), todos en el baseline conocido)
== init OK ==
INIT_EXIT=0
```

Los 26 `skipped` son de `AnaliticaPage.test.tsx` (17) y `AnaliticaShell.test.tsx` (9), los mismos antes de
esta ficha; ningún archivo de `tests/integration/db` saltado (las tres integraciones nuevas aparecen con
sus 9/10/5 tests ejecutados).

Una corrida previa del gate (sonda) dio 5 rojos, todos propios y corregidos antes de la corrida final:
4 afirmaciones de «entrada parseada» sin el orden por defecto y la guardia `caja-173-alcance` (M1) por un
`Prisma.raw` en `libro-caja-a-quien-sql.ts`, sustituido por `Prisma.sql`.

**Veredicto:** backend de la 463 (T1–T4) hecho y verde con el gate completo; falta el frontend (T5–T10).

---

# Bitácora del FRONTEND (T5–T10)

Agente: frontend_dev, en un worktree aislado sobre `9d074ca5` (backend T1–T4), rama `fe/463` empujada a
`feature/463-wallets-filtros-y-orden`.

Búsqueda de código: se usó el MCP `codebase-memory` (proyecto `R-job-singularis-projects-ordenex`) para
ubicar los componentes; devolvió firmas rancias (`WalletFiltros` con su forma vieja, `SaldosTiendasTable`
con `DesgloseMovimientosTienda`), así que todo se confirmó leyendo el archivo real.

## Archivos

Creados:
- `components/shared/wallet/zonas-filtros-labels.ts` — textos COMPARTIDOS de las dos zonas (alcance,
  nombres accesibles, «Más recientes»/«Más antiguas», orden por defecto `desc`).
- `app/(app)/wallet/_components/WalletFiltrosCaja.tsx` — zona de la wallet de la caja: periodo
  (`FilterComponent` en modo «Aplicar») + «A quién» (se aplica al elegirlo).
- `app/(app)/wallet/_components/LibroCajaBarra.tsx` — zona del libro de la caja: `BuscadorFiltros` +
  orden + Todo/Entra/Sale + categoría.
- Tests: `tests/unit/components/filter-component-aplicar-463.test.tsx`,
  `tests/unit/components/zonas-filtros-labels-463.test.ts`, `tests/components/WalletCaja463.test.tsx`,
  `tests/components/EstadoCuenta463.test.tsx`, `tests/components/SaldosTiendasBuscador463.test.tsx`.
- Fixtures de test: `tests/fixtures/periodo-calendario.ts` (elegir y aplicar el periodo en el
  calendario), `tests/fixtures/libro-caja-barra.tsx` (la zona del libro controlada, para los tests que
  montaban la barra vieja).

Modificados (código):
- `components/shared/FilterComponent.tsx` — prop opcional `aplicarConBoton` (T5); exporta
  `mismaSeleccion` y `RANGO_INVERTIDO_AVISO`. Sin la prop, nada cambia (R22).
- `app/(app)/wallet/_components/WalletFiltros.tsx` — deja de pintar: es el módulo de TRADUCCIÓN
  (`FiltrosWallet`/`FiltrosLibro`, `inputDeWallet`/`inputDeLibro`, `filtrosDeWallet`). El componente de
  una sola banda se retiró. Se conserva el archivo (lo declaran como fuente la ayuda del asistente
  `oficina/wallet-caja.md` y `contexto-458.test.ts`).
- `app/(app)/wallet/_components/WalletModule.tsx` — estado partido en dos zonas, `recargarTodo` /
  `recargarLibro` con turnos (la respuesta lenta de un término viejo no pisa la nueva), conteo de la
  tarjeta de la wallet (R9), reposición del periodo si falla (R49).
- `app/(app)/wallet/_components/WalletLedger.tsx` — prop `filtros` (nodo opaco a la cabecera del `DataTable`).
- `app/(app)/wallet/_components/libro-caja-labels.ts` — `BUSCADOR_LIBRO_CAJA_PLACEHOLDER`.
- `components/shared/estado-cuenta/EstadoCuenta.tsx` — zona de la wallet arriba (periodo con «Aplicar»,
  sustituye a los dos `input[type=date]`), zona del libro en la cabecera de la tabla (buscador, orden,
  chips, cierre), `posicionSaldoInicial`, `filtrosDeLectura` con término y orden, `filasDelPeriodo`
  con el saldo inicial delante (`asc`) o detrás (`desc`).
- `components/shared/estado-cuenta/estado-cuenta-clave.ts` — término y orden en la clave (R41).
- `components/shared/estado-cuenta/estado-cuenta-labels.ts` — `buscarPlaceholder` (oficina / tienda).
- `app/(app)/wallet/tiendas/_components/SaldosTiendasTable.tsx`, `saldos-tiendas-clave.ts`,
  `estado-cuenta-tienda-labels.ts` — buscador canónico por tienda (R45).

Modificados (tests existentes, por el cambio de contrato — ninguno borrado, la red se conserva):
- Caja: `WalletLibroCaja458E` (R54 reescrito: Entra/Sale ya NO viaja a las cifras — pregunta abierta 1),
  `WalletFiltroAQuien458E` (opciones de «A quién» con el periodo APLICADO y sin dirección; «Limpiar» de
  banda → «Limpiar todo» del libro, que no toca «A quién»), `WalletFiltros458`,
  `wallet-indemnizacion-libro`, `descarga/WalletDescarga` (periodo por calendario).
- Estado de cuenta: `EstadoCuenta.test` (saldo inicial al final en «Más recientes»; periodo por
  calendario), `EstadoCuentaAnulados`, `EstadoCuentaSatelite`, `MiWalletFiltros`,
  `integration/mi-wallet-page`, `unit/descarga/estado-cuenta-descarga-columnas`, `WalletDescarga`
  (la página 1 de 3 ya no lleva el saldo inicial; el Excel lo lleva al final).
- Guardias con rutas: `wallet-conceptos-sin-seed`, `wallet-textos-458` (la categoría de la caja vive en
  `LibroCajaBarra.tsx`), `wallet-sin-uuid` (monta la zona del libro).

## Decisiones técnicas (anotadas, no preguntadas)

1. **Categoría y cierre a la vista, no detrás del selector «Filtros».** El design §5.2/§5.3 los ponía en
   el selector de `BuscadorFiltros`. Son el único filtro extra de cada barra: esconderlos cuesta un clic
   sin ganar sitio. Van como hijos visibles de la barra (R5/R7 se cumplen igual: están en la zona del
   libro).
2. **Se conserva `WalletFiltros.tsx` como módulo de traducción** (sin componente) en vez de borrarlo: lo
   declaran como fuente la ayuda del asistente y su test; ahí siguen viviendo `inputDeFiltros` y el tipo
   que usan la composición y el detalle de fila.
3. **El orden por defecto no viaja** (`desc` = lo que el borde aplica sin pedirlo, R34). Solo
   «Más antiguas» manda `sortBy: "fecha", sortDir: "asc"`. Igual en caja, estado de cuenta y descarga.
4. **El periodo del estado de cuenta pasa al calendario** de `FilterComponent` (era un formulario propio
   con dos `input[type=date]`). Con el calendario un «Desde» posterior a «Hasta» no se puede elegir (los
   extremos se ordenan solos); R18 queda como red del modo «Aplicar» (lo mide la siembra invertida).
5. **Conteo de la tarjeta de la caja (R9):** es de la WALLET. Si hay filtros del libro puestos al releer
   la wallet entera, se pide aparte una página de una fila con la zona de la wallet para su `total`.
6. **`recargarLibro` usa lo PEDIDO en la zona de la wallet**, no lo aplicado: si una relectura de la
   wallet está en vuelo, el libro que llega casa con las cifras que llegarán.
7. **«A quién» sin dirección:** sus opciones se piden con el periodo aplicado y SIN `tipo` (la dirección
   es del libro).
8. **Saldos de tiendas sin término:** la descarga llama al completo SIN argumentos, exactamente como
   antes (lo exige `WalletPropsDescarga` R1/R8).
9. **Clave SWR del listado de tiendas** gana el término como 4.ª posición; el refresco por predicado
   (`esClaveSaldosTiendas`) no cambia.

## Mapa R<n> → test (completo, R1–R49)

Archivos: **AP** = `tests/unit/components/filter-component-aplicar-463.test.tsx`; **LB** =
`tests/unit/components/zonas-filtros-labels-463.test.ts`; **CJ** = `tests/components/WalletCaja463.test.tsx`;
**EC** = `tests/components/EstadoCuenta463.test.tsx`; **ST** = `tests/components/SaldosTiendasBuscador463.test.tsx`;
**LC** = `tests/integration/db/libro-caja-busqueda-orden-463.test.ts`; **ECI** =
`tests/integration/db/estado-cuenta-busqueda-orden-463.test.ts`; **SCH** =
`tests/unit/types/wallet-libro-463-schemas.test.ts`; **ACT** = `tests/unit/actions/wallet-libro-463-actions.test.ts`;
**STI** = `tests/integration/db/saldos-tiendas-busqueda-463.test.ts`.

| R | Test |
| --- | --- |
| R1 | CJ «la zona de la wallet va ANTES de las cifras…»; EC «$nombre: zona de la wallet … zona del libro encima de la tabla» (×4 superficies); LB «R1: cada zona tiene su nombre accesible» |
| R2 | LB «463 R2» (literal); CJ «R2: cada zona dice su alcance»; EC superficies (×4) |
| R3 | CJ «R3: la zona de la wallet tiene el periodo y «A quién», y nada más» |
| R4 | EC superficies (×4): en la zona de la wallet solo «Periodo» |
| R5 | CJ «R5/R23/R33: la zona del libro tiene buscador, orden, Todo/Entra/Sale y categoría» |
| R6 | EC superficies (×4): buscador, orden y chips en la zona del libro |
| R7 | EC superficies (×4): cierre en la zona del libro en tienda, mensajero y `/mi-wallet`; no en la bodega |
| R8 | CJ «R15 … R16: «Aplicar» relee las tres cosas UNA vez, desde la página 1»; `WalletLibroCaja458E` «R54 + 463 R8/R12/R42» |
| R9 | CJ «R9: término, Entra/Sale, categoría y orden ⇒ solo `listarMovimientosAction`…»; `WalletLibroCaja458E` «R54 + 463 R9» |
| R10 | EC «R15 … R16 … R10: tarjetas nuevas» |
| R11 | EC «R11: cambiar chip, término u orden NO cambia las tarjetas pintadas»; ECI «R11» (servidor) |
| R12 | CJ «R12: el resumen y el desglose NUNCA reciben tipo, categoría, término ni orden»; `WalletFiltroAQuien458E` «por MENSAJERO… (las cifras, sin la dirección)»; ACT «R12» |
| R13 | CJ «R13: las opciones de la categoría se piden con el periodo APLICADO y la dirección vigente»; `WalletFiltros458` «R13» |
| R14 | SCH «R14»; ACT «R14: las cifras de la caja rechazan termino y orden SIN leer» |
| R15 | CJ «R15: editar el periodo no lee nada»; EC «R15»; AP «463 R21» (incluye esperar más que el debounce); `EstadoCuenta.test` «aplicar manda `desde` y `hasta`…» |
| R16 | CJ «R16 …»; EC «R16 …»; AP «463 R21» |
| R17 | AP «463 R17» (×3); CJ «R17»; EC (botón deshabilitado tras aplicar); `EstadoCuenta.test` «463 R17» |
| R18 | AP «463 R18» (×2: deshabilitado, aviso `role=status`, cero emisiones; aviso redactable) |
| R19 | AP «463 R19»; CJ «R19: «Quitar periodo» … CONSERVA el término, los filtros y el orden»; EC «R19» |
| R20 | `WalletFiltroAQuien458E` «por TIENDA …», «por NOMBRE LIBRE …», «se conserva al aplicar el periodo después» |
| R21 | AP «463 R21» (×3) — mutación: quitar la guarda de `emitir` ⇒ 2 rojos |
| R22 | AP «463 R22» (×2: secuencia con temporizadores falsos y sin debounce) + suites `filter-component*.test.tsx` sin tocar, verdes |
| R23 | CJ «R5/R23/R33» (placeholder); EC «R23/R27»; LB «463 R23/R25–R27» |
| R24 | CJ «R24»; EC «R24»; LC/ECI «R24»; SCH «R24» |
| R25 | LC «R25»; LB (placeholder de la caja) |
| R26 | ECI «R24/R26» |
| R27 | ECI «R27»; EC «R23/R27» (placeholder de `/mi-wallet`); LB |
| R28 | LC «R28»; ECI «R28» |
| R29 | CJ «R29»; EC «R29» |
| R30 | CJ «R30»; EC «R30»; `WalletFiltroAQuien458E` «por NOMBRE LIBRE; … el «Limpiar todo» del libro no lo toca» |
| R31 | CJ «R31: entrar con `?q=` y un periodo en la dirección no filtra nada ni rellena los controles» |
| R32 | CJ «R32: mientras se lee el libro, el buscador NO se deshabilita» |
| R33 | LB «463 R33/R34» (literal); CJ «R5/R23/R33»; EC «R34/R47» |
| R34 | CJ «R34/R46»; EC «R34/R47»; SCH/LC/ECI/ACT «R34» |
| R35 | CJ «R35: el orden se pide al SERVIDOR …»; EC «R35»; LC/ECI «R36» (página 1 = cabeza del conjunto) |
| R36 | LC «R36»; ECI «R36» |
| R37 | ECI «R37» |
| R38 | EC «la regla …» y «R38 en pantalla: con «Más antiguas» es la PRIMERA línea de la página 1» |
| R39 | EC «la regla …» (total múltiplo, no múltiplo y 0), «R39 en pantalla» (×2); `EstadoCuenta.test` «463 R39» (×2) — mutación: siempre «primera» ⇒ 3 rojos |
| R40 | SCH «R40»; ACT «R40/R24»; LC/ECI «R40/R24» |
| R41 | EC «R41» (×3: claves distintas, `esClaveDeLaCuenta` las casa, la caché sirve un orden ya visto); ST (clave del listado) |
| R42 | CJ «R42» (×2); `WalletLibroCaja458E` «R54 + 463 R8/R12/R42»; LC «R42»; ACT «R42» |
| R43 | EC «R43» (×3: asc ⇒ primera fila, desc ⇒ última, la pantalla manda término y orden); `estado-cuenta-descarga-columnas` (desc ⇒ última); ECI «R43/R44» |
| R44 | ACT «R44»; ECI «R43/R44»; `estado-cuenta-descarga-columnas` «`limite_excedido`» (sin cambios) |
| R45 | ST (×4: placeholder, servidor + página 1, descarga con y sin término, clave); STI; SCH/ACT «R45» |
| R46 | CJ «R34/R46: se entra en «Más recientes» y sin leer nada»; LC «R34/R46» |
| R47 | EC «R34/R47»; ECI «R34/R47» |
| R48 | LB «463 R48» (sin «SLA» ni jerga en los textos nuevos) |
| R49 | CJ «R49» (×2: falla el libro / falla la wallet: aviso en español, nada se pisa, el periodo vuelve); `EstadoCuenta.test` «R5 (171) … el fallo se dice» |

## Mutaciones del frontend (medidas, restauradas con `cmp`)

| Mutación | Rojo |
| --- | --- |
| F1 `cambiarLibro` relee la wallet entera (`recargarTodo`) | CJ: 7 tests (R9, R12, R19, R29, R30, R32, R42) |
| F2 `posicionSaldoInicial` siempre «primera» + Excel siempre con el saldo inicial delante | EC: 3 tests (regla, R39 en pantalla, R43 desc) |
| F3 quitar la guarda `if (modoAplicar) return;` de `emitir` | AP: 2 tests (R21). Sobrevivía a la primera versión del test (miraba antes de vencer el debounce): se añadió la espera y el caso `debounceMs={0}` |

## Ver la app (T10) — dev server propio en el worktree (`:3013`), maestro local `maestro.qa463@ordenex.test`

Playwright desde el scratchpad (`ver463.cjs`, `probe_dl.cjs`); salida completa en `ver463.out.txt` y
capturas `463_*.png` del scratchpad de la sesión (no se versionan). Datos locales: 36 movimientos en la
caja (2026-08-11 a 2026-09-24), una tienda («Tania Tienda»), un mensajero con 10 movimientos.

| Comprobación | Resultado medido |
| --- | --- |
| `/wallet` zona de la wallet (innerText) | «Estos filtros cambian toda la wallet · Periodo: Cualquier fecha · Aplicar · A quién: Todos» — encima de las cifras |
| `/wallet` zona del libro | «Estos filtros solo afectan al libro de movimientos · Más recientes · Más antiguas · Todo · Entra · Sale · Todas las categorías» + buscador, en la cabecera del libro junto a «Descargar» |
| Orden por defecto | «Más recientes» `aria-pressed=true`; primera fila 2026-09-24 |
| «Sale» | libro solo con salidas; **resumen idéntico** (`true`) |
| «Más antiguas» | primera fila 2026-08-11; resumen idéntico (`true`) |
| Excel caja | 36 filas + cabecera en los dos órdenes; asc empieza 2026-08-11, desc 2026-09-24 |
| Buscador | «ab» ⇒ «Escribe al menos 3 caracteres para buscar»; «Combustible» ⇒ 1 fila («Combustible flota»); resumen idéntico. (Buscar «cobrado» da 0: es texto del CONCEPTO, no de la descripción; R25 no lo incluye) |
| Periodo 2026-09-01→30 | «Aplicar» deshabilitado hasta elegir; al aplicar el resumen CAMBIA («Movimiento neto del periodo»); Excel 14 filas; «Quitar periodo» devuelve el resumen inicial (`true`) |
| `/wallet/tiendas` buscador | «Tania» ⇒ Tania Tienda; Excel con búsqueda: 1 fila |
| `/wallet/tiendas/<id>` | dos zonas; desc: página 1 de 20 filas SIN saldo inicial (27 movimientos: va en la página 2); asc: primera fila «Saldo inicial ₡0»; chip/orden/búsqueda: tarjetas idénticas; Excel asc 2.ª fila = saldo inicial, desc última = saldo inicial; placeholder «Buscar por descripción o quién registró»; con periodo la última línea es «Saldo inicial del periodo ₡126.512,79» |
| `/wallet/mensajeros/<id>` | 10 movimientos: desc ⇒ saldo inicial última línea, asc ⇒ primera; Excel igual; tarjetas idénticas con chip/orden/búsqueda |
| Consola | solo el aviso de Next sobre `scroll-behavior: smooth` (ajeno) |

Nota de pantalla: el disparador del periodo es el de ancho fijo del control (`w-56`) y corta
«Periodo: Cualquier fe…» en la caja; es el mismo control de `/ordenes` y otras barras, no se tocó.

### Medición pedida (no es de la 463): descargas con tabla vacía

| Botón | ¿Mensaje de vacío en la tabla? | Resultado |
| --- | --- | --- |
| `/wallet` «Descargar Plantillas de gasto fijo» | sí («Todavía no hay plantillas de gasto fijo.») | **toast «No hay datos que descargar con los filtros aplicados. Ajusta los filtros y vuelve a intentarlo.»** (esperado); sin archivo; el servidor respondió `{"status":"ok","items":[],"total":0}`; consola limpia |
| `/wallet/tiendas/<id>` «Descargar Pagos registrados de Tania Tienda» | sí | **toast «No hay datos…»** (esperado); sin archivo, sin POST (usa lo ya leído); consola limpia |

Ojo con la sonda: la primera pasada miraba solo `[data-sonner-toast]` y dio «nada»; el aviso se ve
por `[role=alert]` (memoria «La sonda de toast mira tarde»). La segunda pasada, con los dos
selectores, lo captura en ambos botones.

## Gate del frontend (salida real)

`./init.sh` COMPLETO (toca `lib/types/` en la rama), secuencial, sin dev server ni mutaciones en
paralelo, en `progress/gate_463_frontend.log` (sin `tail`, `INIT_EXIT` escrito dentro):

```
✓ feature_list.json: sin ids duplicados (461 fichas), cupo por zona respetado (in_progress=1) y specs en su sitio
✓ typecheck paso
✓ lint paso
✓ DATABASE_URL resuelta: los 325 archivos de tests contra Postgres SI se ejecutan
 Test Files  2351 passed (2351)
      Tests  32666 passed | 26 skipped (32692)
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 2351 ejecutado(s), todos en el baseline conocido)
== init OK ==
INIT_EXIT=0
```

Los 26 `skipped` son los de siempre (`AnaliticaPage`, `AnaliticaShell`); ninguno de `tests/integration/db`.
Una corrida previa (sonda) dio 2 rojos, los dos propios y corregidos: la guardia `wallet-ledger-dueno`
(R36, `categoria ===` en `WalletModule.mismoLibro`, reescrito por claves) y `ancla-de-carga` (dos
`waitFor` anclados solo a un conteo de filas en los tests nuevos: ahora llevan también el contenido).

**Veredicto:** ficha 463 completa (backend + frontend), R1–R49 mapeados, gate completo verde y vista en
la app.
