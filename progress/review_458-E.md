# Revisión 458-E «Libro de caja» — reviewer (adversarial)

**HEAD revisado:** `5a75ca51` (`origin/feature/458-E`, desanclado y comprobado). Diff contra `origin/dev`
(que ya trae la 458-C). Fecha: 2026-09-26.

**Búsqueda:** no usé el MCP `codebase-memory` (las bitácoras de la 458-B/C/E dicen que el índice está
rancio para la wallet y no conoce `autoriaDelLibroCajaAction`); cada símbolo se leyó en el archivo real
con `grep`/lectura directa.

## Veredicto: **RECHAZADA**

Un bloqueante (R58 «cuándo lo registró», deuda que la 458-C dejó asignada a TE.3 y que esta hija ni
cierra ni reasigna). El filtro «A quién» en sí está bien hecho: el WHERE es único, parametrizado y las
tarjetas, composición, desglose, conceptos y descarga salen del mismo WHERE que el libro (probado contra
Postgres con oráculo independiente). Lo demás son mayores y menores.

## Verificación ejecutada por mí (sin base propia)

| Qué | Resultado |
| --- | --- |
| `pnpm install --frozen-lockfile` propio (sin junction) + `prisma generate` (URL ficticia) | OK |
| `pnpm run typecheck` | `TC_EXIT=0` |
| `pnpm run lint` | `LINT_EXIT=0` (0 errores, 218 warnings previos) |
| `vitest run` sin `DATABASE_URL` | `TEST_EXIT=0` — 2052 archivos verdes, 261 saltados (integration/db, sin base); 29.874 tests verdes |
| `pnpm run build` | `BUILD_EXIT=0` (migraciones omitidas: build local). Rutas: `/wallet/tiendas` y `/wallet/mensajeros`, **sin** `[tiendaId]`/`[mensajeroId]` |
| Gate con base | `progress/gate_458E_cierre.log`: `INIT_EXIT=0`, 2313/2313 archivos, 32.257 verdes, 26 saltados (Analitica, previos). Los 261 archivos de integración que yo salté corren ahí. No lo pude reproducir |

## Checklist

- [x] requirements/design/tasks existen (458 común).
- [ ] **tasks.md: TE.1–TE.7 siguen `[ ]`** (tasks.md:309-329). TE.1–TE.6 están hechas en código; TE.7 no (ver M5).
- [ ] **Trazabilidad:** R53, R54, R55, R56, R57, R59, R60, R61, R73, R101, R102, R103: con test real. **R58 incompleto** (B1). R62 en la 458-A (`panel-mensual-rotulo.test.ts`). R104: recorrido parcial (M5).
- [x] Mapa R → test en `progress/impl_458-E.md` §«Mapa R → test».
- [x] typecheck / lint / tests / build (arriba).
- [x] Sin tablas nuevas ni migraciones (no aplica RLS). Sin secretos. Tope `WALLET_MAX_QUIENES_FILTRO` por configuración.
- [x] Capas: SQL en `lib/repositories/`, rol en el servicio antes de leer, actions validan con zod; interfaces en `lib/interfaces/`.
- [x] Permisos: `quienesDelLibroCaja` (FiltrosWalletService) y los seis bordes del libro con `esAccesoTotal` antes de leer; test contra Postgres (adminTienda → `forbidden`, sin sesión → `unauthenticated`).
- [x] SQL parametrizado: todo por `Prisma.sql`/`Prisma.join`; sin `Prisma.raw` ni `*Unsafe` en el diff; `id` validado como uuid y `.strict()`.
- [x] Colas de gasto fijo y de rechazo: sus componentes y sus tests **sin tocar** (lista de archivos del diff); solo cambia que su `onCambio` relee además la autoría (aditivo).
- [x] «Cerrar» en `components/ui/sheet.tsx`: no rompe tests (suite completa verde). Los Sheet con X propia (`AsistentePanel`, `EnviarPlantillaWhatsappButton`) usan `showCloseButton={false}`; `DetalleMensajeroPanel` ya es `Modal`. No aparece un segundo botón «Cerrar» en ninguna pantalla.
- [x] Tests reescritos: `WalletDescarga` (encabezados literales `ENCABEZADOS_DEL_LIBRO`), `wallet-caja-descarga-columnas` (claves y encabezados literales), 457/461 («Entra»/«Sale» literales) y `wallet-ledger-dueno` (mismas aserciones, mirando `[data-dueno]` dentro de «Monto»): el literal sigue siendo contrato, ninguno compara contra su propia fuente. `wallet-page.test.tsx`: solo añade.
- [x] Descarga sin ids: `filaDescargaMovimientoCaja` no emite `id`/`origenId`/`registradoPor`; «A quién» sin autoría → «—»; test con regex de uuid en todas las celdas.
- [x] Libro: «A quién»/«Registró» en UNA lectura por página (SWR con los ids), «Cargando…»/«No se pudo leer»; fila anulada dice «Anulado» (insignia `inline-flex`, sin tachar) y se tacha; Todo/Entra/Sale; refresco tras anular con versión de la clave de autoría.
- [x] Ayuda `docs/ayuda/oficina/wallet-caja.md` y bloque E de `contexto-458.test.ts`.
- [ ] `progress/history.md` sin entrada de la 458-E (se añade al cerrar).

## Hallazgos

### BLOQUEANTE

**B1 — R58 «quién lo registró y cuándo»: el instante de registro no está, y era de esta hija.**
- `specs/458-rediseno-wallet/tasks.md:262-263` (TC.8) y `progress/history.md:5639` dejan a **TE.3 de la
  458-E** «el INSTANTE de registro en el panel del libro de la caja (R58: hoy se pinta el día del
  movimiento, no el `created_at`)». Es el M1 de `progress/review_458-C.md:114-122`.
- En HEAD sigue igual: `app/(app)/wallet/_components/VerMovimientoCaja.tsx:67` pinta
  `fechaDiaMovimientoCR(m.fechaMovimiento)`; `components/shared/wallet/DetalleMovimientoPanel.tsx:374-375`
  dice solo `textoRegistro(autoria.registro)` (quién); `WalletMovimientoDTO` no lleva `createdAt` y
  `AutoriaDeFilaDTO` tampoco.
- `progress/impl_458-E.md:206-211` (TE.3) no lo menciona: ni se hizo ni se reasignó. El mapa R → test
  (línea 254) da R58 por cubierto con tests que no miran el instante.
- Escenario: un sueldo con fecha del 2026-09-01 registrado el 26: el panel dice «Registró: Ana» y la
  fecha del 1; nadie puede saber cuándo se tecleó.
- Para cumplirlo: llevar el `created_at` (día y hora CR) a la autoría o al DTO del libro (servidor,
  solo lectura) y pintarlo en «Registró» del panel, con test y mutación. Si el leader decide no
  hacerlo aquí, tiene que quedar reasignado en `tasks.md` con el R que arrastra antes de cerrar la hija.

### MAYOR

**M1 — La guardia de la 173 queda más débil de lo que dice.** `tests/unit/guards/caja-173-alcance.guardia.test.ts:157` y `:183-192`.
- Hoy el código está limpio: la única suma del repositorio es `SUM(w."monto")`
  (`lib/repositories/WalletMovimientoRepository.ts:126`), `libro-caja-a-quien-sql.ts` no nombra
  `monto` y las otras tablas solo aparecen dentro de `EXISTS`/`JOIN` para saber de quién es la fila.
- Pero con `$queryRaw` en el `Pick`, el caso nuevo no ve:
  - `sum(` en minúsculas o `SUM (` con espacio: la regex `/SUM\(([^)]*)\)/g` es sensible a mayúsculas;
  - una suma de otra tabla con alias `w` (`FROM "wallet_tienda_movimiento" w`);
  - un `SELECT d."monto"` sin agregar, sumado luego en JS;
  - SQL en otro módulo importado que no sea `libro-caja-a-quien-sql.ts`;
  - una escritura con `$queryRaw` (`INSERT … RETURNING`) en otro libro: las guardias R31 y R47 buscan
    métodos de delegado (`walletTiendaMovimiento.create`) y no la miran.
- Además, `:178` prohíbe `cierreDia` y `walletTiendaMovimiento` en camelCase, mientras que el repositorio
  ya lee `"cierre_dia"` y `"wallet_tienda_movimiento"` por el módulo importado.
- Qué falta: regex sin distinguir mayúsculas; que todo `FROM` de un `SELECT` que agregue sea
  `"wallet_movimiento" w`; prohibir `INSERT|UPDATE|DELETE` en el SQL de estos dos módulos; y que el
  censo cubra todos los módulos que el repositorio importa de `lib/repositories/`.

**M2 — Con el filtro por nombre libre, un sueldo, gasto o corrección anulados se cuentan sin su contra-asiento.**
- El contra-asiento de un egreso lleva `origen_tipo = gasto` y `origen_id = <id del egreso>`, sin
  `wallet_anotacion` (`lib/services/EgresoCajaAnulacionService.ts:42-47` y `:93-104`).
- `condicionAQuienSql` por nombre exige una anotación en la PROPIA fila
  (`lib/repositories/libro-caja-a-quien-sql.ts:158-163`), así que el reverso queda fuera.
- Escenario: sueldo de ₡100.000 a «Pedro», anulado. Con «A quién = Pedro» el libro enseña una fila
  (tachada) y las tarjetas dicen Salió ₡100.000 y un movimiento neto de −₡100.000, cuando el efecto
  real es 0. Por tienda no pasa: el pago anulado y su reverso comparten origen, y el neto da 0.
- Es coherente con la columna «A quién» (el reverso dice «—», design §3.4), así que R59 se cumple a la
  letra. Pero lo que dicen las tarjetas de un proveedor es engañoso y ningún test lo mira: el escenario
  de `libro-caja-filtro-a-quien.test.ts` no anula nada con nombre.
- Decisión del leader: o el reverso hereda la anotación del original (`w.origen_id`) en filtro, opciones
  y columna, o se acepta y la ayuda lo dice.

**M3 — Los enlaces de «A quién» dan 404 hasta que llegue la 458-D.**
- `app/(app)/wallet/_components/libro-caja-labels.ts:52-55` genera `/wallet/tiendas/<id>` y
  `/wallet/mensajeros/<id>`.
- El build de este HEAD no tiene esas rutas.
- Lo reconoce `impl_458-E.md:288-289`, pero no está como condición en `tasks.md` ni en la ficha.
- Condición de release: la 458-E no sale a `prod` sin la 458-D. Si se mergea a `dev` antes, `dev` enseña
  enlaces rotos en cada fila de tienda o mensajero.

**M4 — La deuda de la 458-C asignada a TE.3 no se trató ni se reasignó** (`tasks.md:263-267`).
- m3: `reversarEgresoAdministrativoAction` (`lib/actions/wallet-egresos.ts:116`) sigue siendo una puerta
  de dinero invocable, sin superficie y sin motivo ni constancia.
- m7: no se puede pagar a una tienda o a un mensajero INACTIVO desde el diálogo (R41).
- `impl_458-E.md` no los nombra.

**M5 — `tasks.md` de la 458-E sin marcar, y TE.7 sin hacer.**
- TE.1–TE.6 están en el código, pero siguen `[ ]`.
- TE.7 pide el recorrido COMPLETO de §10 (doce pasos, cuatro roles) y la revisión final de la 458.
  `progress/recorrido_458-E/` cubre solo los pasos de `/wallet` con maestro, admin y adminTienda.
- Los pasos 4–6 y 8–11 dependen de la 458-D.
- La hija no puede cerrar la 458 hasta que se hagan (R104).

### MENOR

- **m1 — La descarga lee la autoría en serie** (`app/(app)/wallet/_components/WalletModule.tsx`, `listarConAutoria`): tramos de 100 uno detrás de otro. Con el tope `DESCARGA_MAX_FILAS=5000` son 50 Server Actions de ~15 consultas cada una, y la descarga va a tardar.
- **m2 — El selector «A quién» puede quedarse con un conteo viejo.** Guarda el rótulo elegido con su conteo (`SelectorBuscable` `rotuloElegido`). Si luego cambias el periodo o la dirección, puede seguir diciendo «Tania · Tienda · 4 movimientos» cuando ya son 1.
- **m3 — `quienesDelLibroCaja` trae todo y filtra en memoria.** Lee todas las cuentas y nombres del periodo y busca y recorta en memoria (`FiltrosWalletService.opcionesDeQuienes`); el tope no acota la consulta. Hoy es aceptable; crece con el número de tiendas.
- **m4 — La ayuda puede confundir con el contra-entrega.** Dice que al elegir una tienda «lo que entró y lo que salió son los de esa tienda» (`docs/ayuda/oficina/wallet-caja.md`, § filtros). El contra-entrega de esa tienda nace de un cierre y cae bajo el mensajero, no bajo la tienda.
- **m5 — La comprobación de «sin ids» del test mira celdas enteras.** En `tests/components/descarga/WalletDescarga.test.tsx:49-58`, el doble nombra la cuenta con el último bloque del uuid («Cuenta <bloque>»). Además, la aserción R3 del caso R34/R56/R57 compara celdas enteras (`not.toContain(id)` sobre `Object.values`): un id metido dentro de un texto pasaría. El test de columnas unitario sí usa la regex de uuid.

## Lo que se comprobó y está bien (para no repetirlo)

- **WHERE único.** `whereLibroCajaSql` es el mismo para `listar` (página y `COUNT`), `agregarPorCategoriaYTipo`, `agregarPorCategoria`, `contarConceptosCaja` y el detalle de fila (`categorias` incluido). `condicionesComunesSql` es el gemelo exacto de `buildWhere` (`hasta` exclusivo, `categorias` vacío → `FALSE`) y `BalanceFiltros` no tiene más campos. El orden total del libro es el mismo.
- **Oráculo independiente.** El test contra Postgres usa como oráculo `LibroCajaAutoriaService`, cuyo `aQuien` coincide rama a rama con `A_QUIEN_POR_ORIGEN` (pago 172: tienda primero, si no, el mensajero; rechazo por `gestion_id`; débitos de tienda).
- **Cuenta ajena → 0.** Un uuid ajeno da libro, descarga, conceptos, desglose y tarjetas en 0,00. Una tienda consultada con `tipo: "mensajero"` no casa: las ramas filtran por clase.
- **Rol antes de leer** en el selector y en los seis bordes; `.strict()` y uuid dan `validation_error`.
- **Mutaciones.** 11 + 10 + 11 (`progress/mutaciones_458*.json`), todas en rojo. No las pude repetir sin base.
