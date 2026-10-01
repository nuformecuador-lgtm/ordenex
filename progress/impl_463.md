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
