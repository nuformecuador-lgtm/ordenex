# Ficha 461 — Revisión independiente (reviewer)

- **Fecha:** 2026-09-25. **Revisado:** `origin/feature/461-frontend` @ `3319dceb` (backend `c1b2cdf6` + frontend). Merge-base con `dev`: `f415f4bb`.
- **Entorno propio:** worktree `checkout --detach 3319dceb`, `pnpm install --frozen-lockfile` propio (sin junction), `prisma generate` propio.
- **Base:** clon nuevo `ordenex_461_rev` (`CREATE DATABASE … TEMPLATE ordenex_461`, 222 migraciones, «Database schema is up to date!»), `.env` del worktree apuntando a él. Línea base del clon: cifra 13.483.932,72 · ganancia 13.336.262,62 · «De las tiendas» 147.670,10 = Σ saldos · **R7 0,00 · R8 0,00**. Borrado al terminar.
- **Búsqueda:** el MCP `codebase-memory` (`R-job-singularis-projects-ordenex`) no ve los archivos de la 459/461 (índice rancio, ya declarado por las tres bitácoras); todo se leyó del archivo real con `grep`/`sed`.
- **Gate completo:** NO se repitió (indicación del leader; 2.ª corrida del implementer `INIT_EXIT=0`, 2 224 archivos). Sí se corrieron: typecheck, lint, todos los tests de la ficha (integración contra el clon, unitarios, componentes) y TODAS las guardias.
- Leído antes de revisar: `specs/461-*/` (requirements con la §J R66–R75, design, tasks), `progress/impl_461.md`, `progress/impl_461_frontend.md`, `progress/fase0_461.md`, `progress/auditoria_wallet.md` (en `origin/dev`), `specs/459-*/design.md`, `docs/verification.md`, `CHECKPOINTS.md`.

## 0. Veredicto en una línea

**APROBADO para mergear a `dev`.** El dinero cuadra al céntimo en cada paso, las siete mutaciones (más una) ponen la suite en rojo, las seis migraciones van y vuelven limpias, los nombres son los aprobados y los roles cierran. **NO apta para `done` ni para release** hasta cerrar los tres pendientes de cierre Z que la propia ficha declara (H1–H3, abajo): `tasks.md` sin marcar, R65 (recorrido por rol) sin evidencia y R38 (contraste en producción, del leader) sin correr.

## 1. Checklist (CHECKPOINTS.md + encargo del leader)

### Especificación
- [x] `requirements.md` con R1–R75 en EARS (la §J añade los hallazgos D2, D3, T1, T2 de la auditoría).
- [x] `design.md` con alternativas descartadas y su porqué (§18, A1–A11) y decisiones P1–P17.
- [ ] **`tasks.md`: 0 de 38 tareas marcadas `[x]`** (todas siguen `[ ]`, incluidas las que las bitácoras dan por hechas). → H1.

### Trazabilidad
- [x] Mapa R → test en `progress/impl_461.md` §3 (backend, R1–R37, R51, R55, R59–R64, R66–R75) y en `progress/impl_461_frontend.md` §3 (R17, R20, R21, R27, R37, R39–R58, R66/R68 UI, P1, P3). Los archivos existen y **pasaron en mi entorno** (§3 de este informe).
- [x] Los tests fijan los literales a mano (no contra su fuente): `wallet-labels.test.ts` (23 + 13), `mi-wallet-labels.test.ts` (R44 exige lectura DISTINTA), `caja-clasificacion-459.guardia` (`["ajuste_debito"]` escrito a mano), `caja-caracterizacion-459` (66 471,43 / −87 374,34 en comentario), `cobro-tienda-service` (R19 por `getOwnPropertyNames` del prototipo).
- [ ] **R38** (`progress/contraste_461.md`, del leader, antes de desplegar): no existe en la rama ni en `dev`. → H3.
- [ ] **R65** (`progress/recorrido_461.md` + capturas, T Z.3): no existe; `impl_461_frontend.md` lo declara pendiente del cierre Z. → H2.
- [x] R59/R75: `progress/fase0_461.md` (5 mutaciones de control M0-1…M0-5 en rojo) + anexo de 23 mutaciones en `impl_461.md` §6 y 14 en `impl_461_frontend.md` §4 (el spec pedía el anexo en `fase0_461.md`; vive en `impl_461.md`, equivalente).

### Calidad de código
- [x] `pnpm run typecheck`: `TSC_EXIT=0`.
- [x] `pnpm run lint`: `LINT_EXIT=0` (0 errores, 2 warnings previos).
- [x] Tests: 16 archivos de `tests/integration/db` de la ficha contra el clon → **108/108**; 331 archivos (todas las guardias + unitarios/componentes de la ficha) → **4 796 passed**, 2 fallos por **timeout a 59 s bajo carga** en guardias ajenas (`impresion-flujo`, `factura-contraste`; features 223/217, ni en la ficha ni en el baseline); aisladas, ver §3.
- [ ] E2E Playwright: **no aplica** (no hay arnés; memoria del repo). Cubierto por la reproducción por las Server Actions reales contra Postgres (§2) y por los tests de integración; el recorrido por rol con navegador es R65 (pendiente, H2).

### Datos y seguridad
- [x] RLS activada en las dos tablas nuevas: `cobro_tienda_anulacion` y `ajuste_caja_anulacion` (`relrowsecurity = t`, medido en el clon y tras el up→down→up).
- [x] Seis migraciones, cada una con `down.sql`; up→down→up limpio en el clon (§4). Los `down` de enums leen `pg_enum` (función de la 459 con sufijo `_461`, byte a byte: lo exige `cobro-tienda-461-migration (e)`).
- [x] Ninguna migración ya aplicada editada: el diff `origin/dev...3319dceb` en `db/migrations` toca SOLO las seis `20260926*`.
- [x] Sin secretos en el diff (`lib`, `app`, `db`, `scripts`); sin `fetch` a rutas API desde componentes; sin `Request`/`Response`/`headers()` en servicios ni repositorios.
- [x] Idempotencia: clave UNIQUE en la propia fila (`clave_idempotencia`) para cobro, corrección y sueldo/gasto; `(origen_tipo, origen_id, categoria)` para cargo/reverso; UNIQUE(`cobro_id`) para la anulación. Webhooks: no aplica.

### Patrón de capas y permisos
- [x] Borde (`lib/actions/wallet-tienda.ts`, `wallet.ts`): sesión → zod `.strict()` → servicio; sin queries. Servicio (`CobroTiendaService`, `AjusteCajaService`): rol PRIMERO con `esAccesoTotal`, sin HTTP. Repositorios (`CobroTiendaAnulacionRepository`, `AjusteCajaAnulacionRepository`): solo Prisma/`$queryRaw`. Interfaces en `lib/interfaces/repositories` y `lib/interfaces/services`.
- [x] Mutaciones por Server Actions; el diálogo y `DocumentoCajaAcciones` las llaman sin claves de más (`payload` fijado por test).
- [x] Sin país/moneda hardcodeados; las fechas CR salen de los helpers existentes de `lib/utils/fecha-cr.ts`.

### Verificación final
- [x] Gate completo verde según las dos bitácoras (2.ª corrida de cada bloque, `INIT_EXIT=0`); solo el log del backend está commiteado (`progress/gate_461_backend.log`). → H7.
- [x] `progress/review_461.md`: este archivo.
- [ ] Entrada en `progress/history.md`: no hay (se añade al cerrar). → H11.

## 2. El dinero: el cobro de 42.000 del humano, reproducido por las Server Actions reales

Test temporal (`tests/integration/db/zz-review-461-temporal.test.ts`, borrado; NO se commitea) que entra por `registrarCobroTiendaAction` / `anularCobroTiendaAction` **sin inyectar el servicio** (composition root real) y mide, tras CADA paso, la consulta C461-1 de `design.md` §13 sobre el libro entero del clon más el saldo de la tienda. Tienda real del clon con saldo a favor: Tania Tienda (147.670,10). Actores: Maestro QA (registra), Ana/admin (anula), Tania/adminTienda y Quique/mensajero (rechazados).

| Paso | Entró | Salió | Cifra principal | Ganancia | «De las tiendas» | Σ saldos | Saldo Tania | Filas caja | R8 | R7 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 · línea base | 13.524.733,22 | 40.800,50 | 13.483.932,72 | 13.336.262,62 | 147.670,10 | 147.670,10 | 147.670,10 | 36 | 0,00 | 0,00 |
| 0b · 4 rechazos (adminTienda, mensajero, sin sesión, sin clave) | igual | igual | igual | igual | igual | igual | igual | 36 | 0,00 | 0,00 |
| 1 · cobro 42.000 (maestro) | **igual** | **igual** | **igual** | **13.378.262,62 (+42.000)** | **105.670,10 (−42.000)** | 105.670,10 | **105.670,10 (−42.000)** | **37 (+1)** | 0,00 | 0,00 |
| 2 · doble envío, misma clave (`ya_registrado`) | igual | igual | igual | igual | igual | igual | igual | 37 | 0,00 | 0,00 |
| 3 · 7 rechazos de anular (roles, motivo vacío, `monto` colado, id ajeno, la línea de caja como id) | igual | igual | igual | igual | igual | igual | igual | 37 | 0,00 | 0,00 |
| 4 · anular (admin) | igual | igual | igual | **13.336.262,62 (vuelve)** | **147.670,10 (vuelve)** | 147.670,10 | **147.670,10 (vuelve)** | **38 (+2)** | 0,00 | 0,00 |
| 5 · segundo intento (`ya_anulado`) | igual | igual | igual | igual | igual | igual | igual | 38 | 0,00 | 0,00 |

Lo que además se leyó de la base y del libro:
- **La línea de caja del cobro:** `ingreso · ingreso_cobro_tienda · 42000.00`, origen `cobro_tienda` con el id del débito, dueño `propio`, descripción `Tania Tienda · Revisión 461 · material de despacho` (sin ningún uuid), documento `cobro_tienda / anulado false / tieneComprobante false`; **mismo instante** que el débito (`2026-09-25T21:55:26.131Z` en los dos, R3). El débito conserva la descripción tecleada tal cual (R7) y lleva la clave (R66/R67).
- **La anulación:** constancia con motivo, crédito `cobro_tienda_anulado` 42.000,00 a la tienda y reverso `egreso_reverso_cobro_tienda` 42.000,00 en la caja, **los dos con el mismo instante** (`…26.542Z`, R11), «Anulación · …» en los dos; el débito y la línea original **idénticos** antes y después (R11); el libro marca la original `anulado: true` y el reverso `documento: null` (R20/R37); `cobros_en_caja` 42.000 y `cobros_anulados` 42.000 conviven y se compensan.
- **Historial:** exactamente `cobro_tienda_registrado` y `cobro_tienda_anulado`, con importe 42.000,00 y la tienda; **el motivo no viaja** (R55).
- El servidor devolvió el saldo con su signo (`105670.10 · positivo`) y tras anular `147670.10`.

Conclusión: HD1/HD2 cumplidos tal como los firmó el humano; R4 y R12 exactos; R7 y R8 **sin excepción y al céntimo** después de cada paso, incluidos los pasos que no debían escribir nada.

## 3. Tests de la ficha, corridos en mi entorno

- `tests/integration/db` contra el clon (16 archivos): `cobro-tienda-461`, `cobro-tienda-461-concurrencia`, `cobro-tienda-461-migration`, `cobro-tienda-461-completar-migration`, `caja-invariante-tiendas` (11 pasos, R7/R8 tras cada uno), `caja-caracterizacion-459` (bloque «lo que la 461 cambia a propósito»), `reclasificacion-459-migration` (R61: solo cableado de `LectoresDocumentosCaja`, ninguna aserción cambia), `historial-accion-cobro-tienda-migration`, `ajuste-caja-anulacion-461`, `wallet-461-idempotencia-clave`, `wallet-461-migration`, `wallet-461-fechas-cr-migration`, `wallet-filtro-dia-cr-461`, `liquidacion-fechas-cr-461`, `wallet-tienda-cobro`, `caja-459-migration`: **16/16 archivos, 108/108 tests, 0 skipped** (`HAY_BASE_DE_DATOS = true`).
- Guardias + unitarios/componentes de la ficha (331 archivos): **4 796 passed**. Verdes, entre otras: `nombres-wallet-461.guardia` (16 diccionarios, 3 árboles, `docs/ayuda/**`, con contraprueba), `caja-clasificacion-459.guardia` (contrato nuevo), `caja-composicion-exhaustiva`, `metrics-caja-naturaleza` (23/16), `caja-derivaciones` (4 llamadas), `caja-textos-459`, `fuente-unica-nombre-estado`, `nombres-estado-retirados`, `sin-estados-retirados`, `columnas-sensibles`, `historial-accion-*`, `ayuda-*`, `asistente-*`, `contexto-460`, `contexto-461`; y `WalletLedgerAcciones461`, `HistorialAccionesCobroTienda461`, `WalletSaldosTiendasRefrescoP1`, `WalletCuentasPorPagarRefrescoP1`, `ComposicionGananciaCard`, `WalletDescarga`, `mi-wallet-page`, `wallet-tiendas-desglose`, `wallet-tiendas-pago`, `wallet-page`, `wallet-registrar-movimiento-dialog`, `wallet-labels`, `desglose-tienda-labels`, `mi-wallet-labels`, `wallet-conceptos-manuales`, `cobro-tienda-service`, `ajuste-caja-service`, `liquidacion-service`, `wallet-service`, `filtro-dias-cr`, `caja-derivacion-461`, `descripcion-cobro-tienda`, `finanzas-diario`, `catalogo-y-choke-point`.
- Los 2 rojos de esa corrida (`impresion-flujo.guardia`, `factura-contraste.guardia`) son guardias de las features 223/217 que barren `tests/` entero y murieron a los 59 s por saturación (331 archivos a la vez); no tocan nada de la 461 y no están en `tests/baseline-rojos.json`. **Aisladas: 2/2 verdes** (`GUARDIAS_EXIT=0`).
- El test de la invariante deja R8 «rota a propósito» SOLO en el paso que siembra los cobros legados por insert directo (el estado de la 381) y lo afirma por la cifra EXACTA de los legados; los pasos 7 (reclasificación 459) y 8 (migración 461) la devuelven a 0,00. Es la simulación correcta del dato previo, no una excepción viva.

## 4. Las seis migraciones, en el clon

1. **`down` con filas que usan lo suyo: abortan sin borrar (R62).** Con el cobro de §2 aún en la base: down de la 2 responde `ERROR: rollback 461: hay 4 filas que usan el cobro a una tienda o su anulacion; se aborta sin borrar nada`; down de la 1, `2 filas de wallet_movimiento.categoria usan ingreso_cobro_tienda / egreso_reverso_cobro_tienda; se aborta`; down de la 5, `hay 1 filas que usan … una clave de idempotencia; se aborta`. Después: la anulación, los 2 asientos, los 2 valores de enum y las 2 columnas seguían ahí. El down de la 3 sin líneas completadas: `DELETE 0`.
2. **up, down, up** (tras limpiar las filas de §2): los seis `down.sql` a mano en orden 6 a 1 (con su fila de `_prisma_migrations` borrada). Tras los seis: enums 59/21/11/13 (**0 valores de la 461 vivos**), los dos CHECK con la lista de la 459 (sin `cobro_tienda`), **0 tablas nuevas, 0 columnas `clave_idempotencia`**, los 6 asientos de mensajero de vuelta a **00:00Z**, 10 índices (los previos), filas de los tres libros intactas (36/27/12). `prisma migrate deploy` aplica las seis: enums 61/23/13/14, CHECK ampliados, RLS `t` en las dos tablas, 2 columnas + 2 índices UNIQUE (12 índices), los 6 asientos a **06:00Z**, `migrate status`: «Database schema is up to date!».
3. **Idempotencia de las dos de datos:** segunda pasada del `migration.sql` de la 3: `NOTICE: completar caja 461: ningun cobro sin linea de caja; no se escribe nada`; de la 6: `NOTICE: fechas CR 461: ningun asiento de pago a medianoche UTC; no se mueve nada` (los 6 siguen a 06:00Z). El `down` de la 3 borra solo `origen_tipo = cobro_tienda_completado AND categoria = ingreso_cobro_tienda` y aborta si alguna tiene reverso (probado por `cobro-tienda-461-completar-migration`, R36).
4. **`pnpm run db:rollback`** (CHECKPOINTS): funciona para la última migración, pero **elige el último DIRECTORIO, no la última APLICADA**: seis invocaciones seguidas revirtieron seis veces la migración 6 (`ROLLBACK_1..6_EXIT=0`, todas «20260926120500») y dejaron intactas la 1 a la 5. Por eso el punto 2 se hizo a mano. Limitación previa del script (`cb82e017`, ficha 53), no de la 461. Ver H4.
5. Timestamps: `20260926120000…120500`, posteriores a todo lo de `origin/dev` (hoy termina en `20260925130000_notificacion_evento_reprogramadas_esperan_cierre`, de la 462). Sin colisión.

## 5. Los nombres (design §7), leídos del archivo real y comparados a mano

- `CATEGORIA_LABEL` (23) y `ORIGEN_LABEL` (13) en `wallet-labels.ts`: **idénticos** a §7.2 y §7.3 («Ordenex le cobra a una tienda», «Cobro a una tienda anulado», «Ordenex paga un gasto de una tienda», «Ordenex le paga a una tienda», «Gasto de Ordenex», «Corrección de caja (suma)/(resta)», «Aporte de dinero a la caja», «Cobro de Ordenex a una tienda (línea de caja completada al corregir)»…).
- `CATEGORIA_TIENDA_LABEL` (§7.4, `/wallet/tiendas` y el diálogo) y `CATEGORIA_MI_WALLET_LABEL` (§7.5, `/mi-wallet`): dos `Record` totales sobre el mismo enum, **idénticos** a las tablas del diseño y distintos en los 14 conceptos («Ordenex le cobra a la tienda» / «Ordenex te cobró»; «Cobro de Ordenex a la tienda anulado» / «Ordenex anuló un cobro y te lo devolvió»; «Ordenex pagó un gasto por ti»…). Pistas de cabecera de las dos pantallas: las de §7.5, literales (R45).
- Diálogo (`wallet-conceptos-manuales.ts`): los **siete** conceptos con sus nombres, los **tres** grupos («Sale dinero de Ordenex», «Llega dinero a la caja», «Se descuenta del saldo de una tienda»), las **siete** frases de efecto de §7.6 literales, `FRASE_DEL_LIBRO.caja_y_tienda` («Se registra en la caja como «…» y en el libro de la tienda como «…»», R46), `hint` del cobro y aviso «La tienda le debe ese dinero a Ordenex» con signo negativo (R54); el payload del cobro no gana claves salvo `claveIdempotencia` (R53/R66, fijado por test).
- `CAJA_RESUMEN_AVISO_TERCEROS`: «…ya descontados el flete, la comisión, el impuesto y lo que Ordenex les cobró…» (R50); la frase «bajan su saldo sin pasar por la caja» está en los retirados de `caja-textos-459.guardia` y de `nombres-wallet-461.guardia`.
- Historial (§7.7): «Le cobró a una tienda», «Anuló un cobro a una tienda», «Anuló una corrección de caja», «Pagó un gasto de una tienda», «Anuló el pago de un gasto de una tienda», «Registró/Anuló un aporte de dinero a la caja»; los tres nuevos `mueve_dinero`; la pantalla los ofrece y los filtra (`HistorialAccionesCobroTienda461`, R51).
- Retirados y reservados: `nombres-wallet-461.guardia` barre 16 diccionarios, `app/(app)/wallet/**`, `app/(app)/mi-wallet/**`, `lib/types/historial-accion*.ts` y `docs/ayuda/**` con las tres listas de §7.8/§7.9 y contraprueba; un solo pendiente declarado con número exacto (el origen «Manual» del libro del mensajero, 458). Ningún valor técnico se pinta: `WalletLedgerAcciones461` y `columnas-sensibles.guardia` (R42/R52).
- Ayuda (R56–R58): `wallet-caja.md`, `wallet-tiendas.md`, `mi-wallet.md` con `actualizado: 2026-09-25` y `fuentes` que incluyen `CobroTiendaService.ts`, `CajaCobroTiendaFeedService.ts`, `AjusteCajaService.ts`, `descripcion-cobro-tienda.ts`; el cobro explicado como cargo («No llega dinero nuevo…», «pasa a ser ganancia de Ordenex», la tabla frente a «Ordenex paga un gasto de una tienda», «Anular…»); `grep` de las frases y nombres retirados en `docs/ayuda/`: 0. Asistente (R57): `contexto-461` verde por rol (maestro/admin caja+tiendas; adminTienda mi wallet; mensajero/adminSatelite sin la caja); las cuatro preguntas reales están transcritas en `impl_461_frontend.md` §5.
- Guardias de la 455, 459, 460 y 461: verdes (§3).

## 6. P1 y P3 de la auditoría

- **P1:** `saldos-tiendas-clave.ts` / `cuentas-por-pagar-clave.ts` (módulos puros) y `mutate(esClaveSaldosTiendas)` en `PagoTiendaAcciones` tras pagar y anular, `mutate(esClaveCuentasPorPagar)` en `DesglosePagosMensajero` tras el reparto; tests `WalletSaldosTiendasRefrescoP1`, `WalletCuentasPorPagarRefrescoP1`, `wallet-tiendas-pago` («se relee una vez») verdes; mutaciones del implementer en rojo.
- **P3:** `WalletLedger` pinta «Reversado» (Badge) en el egreso cuyo reverso está en la página (`tipo ingreso + origen gasto + origenId`, sin mirar la categoría: R36 de la 231) o que esta sesión reversó (`ok` / `already_reversed`); tests (3 casos + control «una corrección manual no se toma por reverso») verdes. **Límite declarado:** un egreso cuyo reverso vive en OTRA página sigue ofreciendo el botón (el servidor lo guarda: no hay doble asiento). Cerrarlo exige que `WalletService` resuelva el estado en lote como `documento`. → H5.

## 7. Seguridad y alcance (medido con actores inyectados, §2, y por tests)

- Registrar y anular: `adminTienda` → `forbidden`, `mensajero` → `forbidden`, sin sesión → `unauthenticated`, siempre **antes de leer** y con **0 filas escritas** (las cifras no se movieron, §2 pasos 0b y 3). `esAccesoTotal` = maestro y admin.
- La tienda: `listarMisMovimientosAction` ve su débito (`tiendaId = actor.usuarioId` al final del WHERE); `listarMovimientosDeTiendaAction` y `listarMovimientosAction` (la caja) → `forbidden` para ella.
- Borde `.strict()`: `monto` colado en anular → `validation_error` sin escribir; motivo en blanco → `validation_error`; cobro sin `claveIdempotencia` → `validation_error` (R66).
- `no_encontrado` para un uuid inexistente y para el id de la LÍNEA DE CAJA (no es un cobro: `obtenerCobroPorId` solo lee `debito/cobro_manual`).
- Ningún uuid en la descripción de la caja, en el DTO pintado ni en la descarga (`WalletLedgerAcciones461` «no lleva ningún uuid», `columnas-sensibles.guardia`); importes como STRING de punta a punta (`"42000.00"`).
- RLS en las dos tablas nuevas; FKs `RESTRICT`; CHECK del motivo `btrim(motivo) <> ''`.

## 8. Mutaciones propias (una linea cada una; sed, diff no vacio, SOLO los tests nombrados, git checkout, arbol limpio)

Ejecutor propio (`scratchpad/mutar.sh`), independiente del del implementer. Todas en **ROJO** (`VITEST_EXIT=1`) y revertidas (`ARBOL_LIMPIO=1`); el numero de tests ejecutados nunca fue 0.

| # | Mutacion (archivo, linea) | Tests corridos | Resultado |
| --- | --- | --- | --- |
| M1 | `CobroTiendaService.ts`: el cobro NO escribe su linea de caja (`emitirCargoDeCobro` bajo `if (tx === null)`) | cobro-tienda-461, caja-invariante-tiendas, cobro-tienda-service | **20 rojos / 64**: R1, HD1/R4, R2/R7, R3; invariante: «De las tiendas» -2 800,50 en vez de -300,00 y la ganancia igual |
| M2 | `caja-tesoreria.ts`: `ingreso_cobro_tienda` con liquidez `efectivo` (el cargo contado como «Entro») | caja-derivacion-461, caja-clasificacion-459.guardia, caja-invariante-tiendas, caja-caracterizacion-459 | **14 rojos / 50**: «Entro» 90 017,75 en vez de 87 517,25; la cifra principal se mueve; guardia (4) «cargos a tienda distintos de los ocho»; R22/R24 |
| M3 | `CobroTiendaService.ts`: la anulacion sin su contra-asiento en la caja (`emitirReversoDeCobro` bajo `if (tx === null)`) | cobro-tienda-461, caja-invariante-tiendas, cobro-tienda-service | **9 rojos / 64**: R10/R12 (0 reversos), R11; invariante: «De las tiendas» 0,00 en vez de 2 500,50 |
| M4 | `CobroTiendaService.ts`: la clave no se guarda en la fila (`claveIdempotencia: undefined`; D2 desactivada) | wallet-461-idempotencia-clave, cobro-tienda-461-concurrencia, cobro-tienda-461 | **4 rojos / 11**: el doble envio responde `ok` en vez de `ya_registrado` (dos cobros); R66/R67/R68 |
| M5 | `filtro-dias-cr.ts`: `desde` como medianoche UTC (`new Date(v)`; T1 de vuelta) | filtro-dias-cr, wallet-filtro-dia-cr-461 | **6 rojos / 15**: el dia D devuelve filas ajenas (las 18:00-24:00 CR del dia anterior) en los tres libros; `06:00Z` esperado, `00:00Z` recibido; R72 |
| M6 | `LiquidacionService.ts:700`: el egreso del pago a tienda fechado con `medianocheUtcDelDia` (T2 de vuelta) | liquidacion-fechas-cr-461, liquidacion-service | **3 rojos / 91**: el asiento cae a `2026-09-25T00:00:00.000Z` y el rollup diario lo cuenta el dia anterior; R73 |
| M7 | Migracion 3 sin `ON CONFLICT` | cobro-tienda-461-completar-migration | **1 rojo / 6** (solo el test que lee el SQL real): el `NOT EXISTS` de candidatos la deja idempotente por si solo; equivalente conductual, ver nota |
| M7b | Migracion 3 sin el filtro de candidatos con linea (`ingreso_cobro_tienda` sustituido por un valor imposible) **y** sin `ON CONFLICT` (backfill no idempotente de verdad) | cobro-tienda-461-completar-migration | **2 rojos / 6**: «R31/R32/R33: dos pasadas dejan una» (deja dos) y el lector del SQL |
| M8 | Migracion 6 sin la cota `= date_trunc(day)` en los tres UPDATE (mueve +6 h en cada pasada) | wallet-461-fechas-cr-migration | **2 rojos / 2**: «mueve +6 h SOLO ... dos pasadas dejan lo mismo» (`06:00:00.001Z` en vez de `00:00:00.001Z`); R74 |

Nota sobre M7: la migracion 3 tiene dos cinturones de idempotencia (el criterio de candidatos por datos y el `ON CONFLICT`); quitar uno solo no cambia la conducta y solo lo detecta el test que lee el SQL. La mutacion 9 del implementer («sin ON CONFLICT: 1 rojo / 6 (R33)») es ese mismo rojo textual, no el conductual; por eso se anadio M7b, que si rompe R33 y si cae en rojo. No es un defecto: es defensa en profundidad, y esta testeada.

## 9. Hallazgos

| # | Etiqueta | Hallazgo | Donde / que falta |
| --- | --- | --- | --- |
| H1 | **BLOQUEANTE para `done`** (no para merge) | `specs/461-*/tasks.md`: **0 de 38** tareas marcadas `[x]`, incluidas todas las que las dos bitacoras dan por hechas (bloques 0, A, B, C, D). CHECKPOINTS exige todas en `[x]`. | Marcar T0.1 a T D.2 y las de Z que se cierren; dejar explicitas T0.3, T B.1, T Z.4 y T Z.5 (leader). |
| H2 | **BLOQUEANTE para `done`** | **R65** (recorrido por rol con capturas y numeros, T Z.3): `progress/recorrido_461.md` y `progress/recorrido_461/` no existen; `impl_461_frontend.md` lo declara pendiente del cierre Z. Es la unica verificacion de lo que el usuario VE. | Hacer T Z.3 en local sembrado (un solo dev server) antes de `done`. |
| H3 | **BLOQUEANTE para release** | **R38** (contraste de solo lectura en produccion, antes y despues): `progress/contraste_461.md` no existe (ni en la rama ni en `dev`). Sin el no se sabe cuantos cobros registrados en produccion desde la foto del 24/09 va a completar la migracion 3 ni cuanto sube la ganancia. | Leader: C461-0 a C461-3 y C5 por el MCP de Supabase antes de desplegar; el «despues» tras desplegar (T Z.4). |
| H4 | menor (herramienta, previa) | `pnpm run db:rollback` revierte siempre el **ultimo directorio** y lo repite: 6 invocaciones = 6 veces la migracion 6; las otras cinco no se revierten con el script. Con mas de una migracion por ficha, el «rollback funciona» de CHECKPOINTS solo vale para la ultima. | `scripts/db-rollback.ts`: elegir la ultima **aplicada** (`_prisma_migrations`) o aceptar el nombre por argumento. Fuera de la 461. |
| H5 | menor (deuda declarada) | P3 cerrado a medias: «Reversado» solo si el reverso esta en la pagina vista o se reverso en la sesion; un egreso cuyo reverso vive en otra pagina sigue con «Reversar» (el servidor impide el doble asiento). | Lector `egresos` en `LectoresDocumentosCaja` y campo en el DTO (458 o quien tome P3). |
| H6 | menor | P5 de la auditoria sigue: la misma tienda se nombra «Tania» en el historial (`entidadEtiqueta`) y «Tania Tienda» en la linea de caja (`etiquetaDePersona`). Medido en la seccion 2. | Una sola funcion de etiqueta (458). |
| H7 | menor | El log del gate completo del frontend (`progress/gate_461_frontend.log`, citado en la bitacora) no esta commiteado; solo `gate_461_backend.log`. | Commitearlo o citar el SHA de la corrida. Mi corrida dirigida y typecheck/lint lo respaldan. |
| H8 | informativo (merge) | Desde el merge-base, `dev` (462) y esta rama tocan los tres mismos archivos: `db/schema.prisma`, `tests/integration/db/_fixtures/caja-459.ts`, `tests/integration/db/orden-traspaso-migration.test.ts`. La 462 anadio `20260925130000_...` (anterior a las seis de la 461: sin colision de timestamps), asi que los tests que enumeran «migraciones posteriores» habra que realinear al mergear. | Resolver a mano al mergear y correr el gate completo despues. |
| H9 | menor | Pendiente declarado en la guardia nueva: el origen «Manual» del libro del mensajero (`wallet-mensajeros-labels.ts`, 1 aparicion) sigue con nombre retirado; fuera del alcance de la 461 (R42 a R44). | 458. |
| H10 | nota | R75 pide el anexo de mutaciones en `progress/fase0_461.md`; vive en `impl_461.md` seccion 6 (23) y `impl_461_frontend.md` seccion 4 (14). Equivalente. | Ninguna. |
| H11 | nota | Sin entrada en `progress/history.md` (checkpoint final; se anade al cerrar). | Al pasar a `done`. |

## 10. Veredicto

**APROBADO para mergear a `dev`.** Ningun hallazgo bloqueante en el codigo ni en el dinero: R1 a R37 y R66 a R75 medidos contra Postgres real por las Server Actions reales, R7/R8 al centimo tras cada paso, nueve mutaciones propias en rojo y revertidas, seis migraciones con up-down-up limpio y `down` que se niegan con datos, nombres identicos a los aprobados en todas las superficies, roles cerrados antes de leer.

**No apta para `done` ni para release** hasta cerrar H1 (tasks.md), H2 (R65, recorrido por rol) y H3 (R38, contraste en produccion por el leader), que la propia ficha situa en el cierre Z.

Limpieza: test temporal borrado (`git status` limpio salvo este informe), clon `ordenex_461_rev` eliminado, `.env` del worktree eliminado.
