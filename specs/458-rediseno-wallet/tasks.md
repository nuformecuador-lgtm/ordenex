# 458 — Tareas (reescritas el 2026-09-25)

Organizadas por ficha hija (`design.md` §9): **458-A → 458-B → 458-C → (458-D ∥ 458-E)**, con 458-A y
458-B en paralelo si hay capacidad (zonas distintas). Ninguna hija arranca hasta que la **461 y la 457
estén en `dev`**. Cada hija: rama propia, worktree con `git checkout --detach <SHA de dev que dé el
leader>` + comprobación del merge-base como primer paso, spec breve derivado de este (los R que cubre)
antes de tocar código, `progress/impl_458-<hija>.md` con la tabla R → test, revisión y entrada en
`progress/history.md`. `[P]` = paralelizable con la anterior dentro de la misma hija. Implementan
`backend_dev` (458-B y la parte de servidor de las demás) y `frontend_dev` (pantallas), en ese orden.

## Reglas que valen para TODAS las hijas

- **Confirmar la 461 al abrir** (`design.md` §0.2): la primera tarea de cada hija lee en `dev` los
  símbolos que esta ficha da por hechos y anota en el informe lo que difiere. Si un molde no existe o
  tiene otra forma, cambia la tarea (se anota), no el requisito.
- **Antes y después:** `caja-caracterizacion-459.test.ts` (y, desde 458-B, `wallet-caracterizacion-
  458.test.ts`) corren en verde al empezar y al terminar cada hija, sin tocar sus literales salvo el
  bloque «a propósito» de 458-B. Si una hija necesita cambiar otro literal, se para y se pregunta: es
  dinero.
- **No en paralelo:** gate y mutaciones nunca a la vez sobre el mismo árbol.
- **Test que se retira o reescribe:** se lista en el informe con el R que lo sustituye. Ninguno
  desaparece sin reemplazo (lección «el test que vive dentro de lo que borras»).
- **Log del gate:** `INIT_EXIT=$?` dentro del log, sin `tail` en tubería; mirar los `skipped` de
  `tests/integration/db` (sin `.env` se saltan y el gate dice «OK»).
- **Commit por tarea** (`feat(458-x): …`, `test(458-x): …`, `docs(458-x): …`) y verificar el blob
  commiteado antes de dar la hija por cerrada. **No escribir `feature_list.json`** desde el worktree.
  **No commitear el informe sin pedirlo** (y pedirlo).
- **Nombres:** todo rótulo nuevo sigue la regla de la 461 §7 (desde Ordenex, quién le paga a quién,
  sin siglas); ninguno es un nombre retirado ni reservado.
- **Ayuda y asistente dentro de cada hija:** `docs/ayuda/**` de las pantallas que toca (frontmatter
  `actualizado` y `fuentes`), `tests/unit/asistente/contexto-458.test.ts` con un bloque por hija y
  cuatro preguntas reales al asistente en local anotadas en el informe.
- **Recorrido por rol** de `design.md` §10 al cerrar cada hija (los pasos que aplican), capturas y
  números en `progress/recorrido_458-<hija>/`.

---

## 458-A — Detalles y guardias sobre las pantallas actuales (fullstack) · depende de 461 y 457 en `dev`

- [x] **TA.0** Confirmar en `dev`: `ORIGEN_LABEL`/`ORIGEN_TIENDA_LABEL`/`ORIGEN_PAGO_LABEL` con los
  textos de la 461 §7.3 y la 457; si la 461 dejó `cargosHint` de `/wallet/tiendas` con los cobros
  (R90 anterior) y el estado real de C1.1/C1.2/C3.1/C4.1 (`design.md` §1.1). *Hecho:* nota en
  `progress/impl_458-A.md` con lo que sigue vivo. Fotografía 459 verde sobre el SHA anotado.
  *Evidencia:* `progress/impl_458-A.md` §1 (lo vivo y lo que difiere del design, sobre `752e40df`); fotografía `caja-caracterizacion-459` 18/18 en `752e40df` y en `1d938439`.
- [x] **TA.1** `lib/utils/etiqueta-cuenta.ts`: UNA función de etiqueta de tienda/mensajero/bodega,
  usada por avisos, historial, tablas, origen y «A quién» de la wallet (sustituye a `etiquetaDePersona`
  donde la wallet la usa y a `nombre` a secas). *Hecho:* `etiqueta-cuenta.test.ts`; guardia de fuente
  que prohíbe otra composición del nombre en `app/(app)/wallet/**` y `app/(app)/mi-wallet/**` (R33).
  *Evidencia:* `68dc8d42`; revisión B1 en `dde7ac7e` (historial: `CobroTiendaAnulacionRepository`, `LiquidacionPagoRepository` y `LiquidacionRepartoRepository` con `etiquetaDeCuenta`). `tests/unit/utils/etiqueta-cuenta.test.ts`; guardia `wallet-etiqueta-cuenta` con el censo del historial por contenido + contraprueba de `cd91bcf4`; `tests/integration/db/wallet-etiqueta-historial-458.test.ts` (Postgres, literales, mensajero con segundo apellido). Mutaciones en `progress/impl_458-A.md` §16.
- [x] **TA.2** [P] `OrigenLegibleService` en LOTE (`design.md` §3.3): una consulta por tipo presente;
  los tres mapas de origen pasan a `Record<WalletOrigenTipo, …>` totales y los DTO a
  `origenTipo: WalletOrigenTipo`; fuera `origenLabel` con `??`; enlace por rol (`hrefDetalleCierre`,
  estado de cuenta, orden por guía, plantillas). *Hecho:* `wallet-origen-legible.test.ts` (un caso por
  origen, incluido `gestion_orden` en el libro de la tienda), test de número de consultas,
  `wallet-origen-enlace.test.tsx` (con y sin acceso), guardia `wallet-origen-total` + contraprueba
  (R5–R9, R94).
  *Evidencia:* `bef2d2f8` (servidor), `1ceab0a6` (pantalla). `tests/unit/services/wallet-origen-legible.test.ts` (14 orígenes, R7/R8, lote sin ids), `tests/integration/db/wallet-origen-legible.test.ts` (literal desde `aed9f27a`), `tests/components/OrigenMovimiento.test.tsx`, guardia `wallet-origen-total` + contraprueba. `wallet-origen-enlace.test.tsx` no existe: lo cubren `OrigenMovimiento.test.tsx` y el bloque R7/R8 (revisión m7, anotado).
- [x] **TA.3** [P] `FiltrosWalletService.conceptosConMovimientos` (repo `groupBy` con `_count`, sin el
  propio filtro de concepto) + action; los 3 filtros (`WalletFiltros`, `MiWalletFiltros`,
  `DesgloseMovimientosTienda`) lo consumen con el diccionario de su superficie y conservan el elegido
  en 0; fuera `CATEGORIA_OPTIONS`/`CATEGORIA_TIENDA_OPTIONS` del SEED y los comentarios T5. *Hecho:*
  `tests/integration/db/wallet-conceptos-con-movimientos.test.ts` (periodo, cuenta; `egreso_gasto` y
  `ajuste_debito` ausentes sin filas), tests de los tres filtros, guardia `wallet-conceptos-sin-seed`
  + contraprueba (R13–R15, R95).
  *Evidencia:* `8cd41703` (servidor), `1ceab0a6` (filtros). `tests/integration/db/wallet-conceptos-con-movimientos.test.ts`, `tests/unit/components/conceptos-filtro.test.ts`, `tests/components/WalletFiltros458.test.tsx`, guardia `wallet-conceptos-sin-seed` + contraprueba.
- [x] **TA.4** `FiltrosWalletService.cierresDeLaCuenta` (tienda con nombre de mensajero; mensajero) con
  tope y `hayMas`; borde `cierreId: z.string().uuid()` en `wallet-tienda.ts:177` y
  `wallet-mensajero.ts:157`, `WHERE` siempre con la cuenta; `SelectorBuscable` mínimo
  (`components/shared/SelectorBuscable.tsx`: popover + input, vacío/cargando/error, foco opaco,
  teclado) en `DesgloseMovimientosTienda` y `DesglosePagosMensajero`; fuera los `<Input>`, sus
  placeholders y la ayuda que pide pegar la dirección; `/mi-wallet` conserva su selector. *Hecho:*
  `tests/integration/db/wallet-cierres-selector.test.ts` (cierre ajeno → 0 filas; mutación que quita la
  cuenta del `WHERE` → rojo), tests de las dos pantallas, `SelectorBuscable.test.tsx`, guardia
  `wallet-sin-campo-id` + contraprueba (R2, R10–R12, R93). Depende de TA.1.
  *Evidencia:* `251274de` (servidor), `1ceab0a6` (selector), `069b7ca2` (revisión m4: la búsqueda en la misma consulta, sin `IN` sin tope). `tests/integration/db/wallet-cierres-selector.test.ts` (cierre ajeno → 0 filas; 33.000 cierres que casan; texto literal), `tests/components/SelectorBuscable.test.tsx`, guardia `wallet-sin-campo-id` + contraprueba.
- [x] **TA.5** [P] `EnlaceCierre`/`CIERRE_ENLACE` sin uuid en el nombre accesible (se nombra por día CR
  y mensajero, con `etiquetaDeCuenta`); guardia de render `wallet-sin-uuid` sobre todas las superficies
  con fixtures uuid. *Hecho:* guardia verde; contraprueba con el `EnlaceCierre` de hoy roja (R1, R96,
  R99). Depende de TA.1.
  *Evidencia:* `1ceab0a6`. Guardia de render `wallet-sin-uuid` (7 superficies) + contraprueba con el `EnlaceCierre` de antes; `RepartoPrevisualizacion.test.tsx`, `DesglosePagosMensajero.test.tsx`.
- [x] **TA.6** [P] `listarMovimientosTiendaSchema` `.strict()` (m1); `WalletEgresoService.ts:123` sin
  caída al `id` (texto legible); comentarios T1–T6 y subtítulo T9 de `design.md` §1.4; guardia
  `wallet-textos-458` + contraprueba; ampliar `nombres-wallet-461.guardia` a `components/shared/
  {estado-cuenta,wallet}/**` (aún vacías: control de no-vacuidad ajustado a «≥ 0 archivos hoy, falla si
  aparece un retirado»). *Hecho:* tests verdes; `tests/unit/types/wallet-tienda-schemas.test.ts` rojo
  con `tiendaId` ajeno (R4, R36, R97, R101).
  *Evidencia:* `1d938439`; revisión m3 en `4b1ddecc` (el comentario del desglose ya no niega el `.strict()`). `tests/unit/types/wallet-tienda-schemas.test.ts` (paginado y desglose por la action → `validation_error`), `tests/unit/services/wallet-egreso-reverso-legible.test.ts`, guardias `wallet-textos-458` (9 afirmaciones) y `nombres-wallet-461` ampliada.
- [x] **TA.7** [P] `/analitica`: el panel mensual rotula la cifra de caja con `rotuloCifraPrincipal({
  periodoFiltrado: true, estado })` → «Movimiento neto del periodo». *Hecho:*
  `tests/unit/analitica/panel-mensual-rotulo.test.ts` (R62).
  *Evidencia:* `f7fe9471`; revisión m5 en `1eb205dc` (ya no se pide `verResumenCajaAction`). `tests/unit/analitica/panel-mensual-rotulo.test.ts`, `tests/unit/analytics/tablero-financiero-cargar.test.ts`.
- [x] **TA.8** Ayuda y asistente: `docs/ayuda/oficina/wallet-tiendas.md`, `wallet-mensajeros.md`,
  `tienda/mi-wallet.md` (filtros por selector, orígenes con nombre y enlace, conceptos con cuenta);
  `contexto-458.test.ts` bloque A; cuatro preguntas reales. *Hecho:* frases literales por rol en el
  test; respuestas anotadas (R102, R103).
  *Evidencia:* `12444e25`. Los tres documentos con `actualizado` y `fuentes`; `tests/unit/asistente/contexto-458.test.ts` bloque A; las cuatro preguntas en `progress/recorrido_458-A/recorrido.md`.
- [x] **TA.9** Recorrido pasos 1, 8, 12 y accesibilidad de §10 sobre las pantallas actuales;
  fotografía 459 verde; gate rápido; revisión. *Hecho:* `progress/recorrido_458-A/` con números;
  `INIT_EXIT=0`; `progress/impl_458-A.md` con la tabla R→test y los tests reescritos (R104).
  *Evidencia:* `cd91bcf4` (recorrido `progress/recorrido_458-A/`, gate `progress/gate_458A.log`); revisión `progress/review_458-A.md` RECHAZADA y cierre de sus puntos en `progress/impl_458-A.md` §16 con el gate completo `progress/gate_458A_cierre.log`.

## 458-B — Cimientos (backend, migración) · depende de 461 y 457 en `dev` · [P] con 458-A

- [ ] **TB.0** Confirmar en `dev`: cómo anula la 461 la corrección de caja (tabla, servicio, action,
  tipo de historial) → decidir D13 (reutilizar o crear `wallet_movimiento_anulacion`); nombres reales
  de `cobro_tienda_anulacion`, `DocumentoCajaDTO.tipo`, `LectoresDocumentosCaja`; timestamps de las
  migraciones de la 461 y la 457 en `origin/dev`; qué pieza usa la 461 en el borde de periodo (T1).
  *Hecho:* nota en `progress/impl_458-B.md` con la decisión de D13 y los timestamps elegidos.
- [ ] **TB.1** Fase 0 (`design.md` §8): correr `caja-caracterizacion-459` y `caja-invariante-tiendas`
  verdes (`skipped = 0`); escribir `tests/integration/db/wallet-caracterizacion-458.test.ts` (saldos,
  cuentas por pagar, pendientes, saldo corrido con dos filas del mismo instante, saldo inicial,
  totales netos) con literales a mano; mutaciones medibles HOY (1, 2, 12 de §8.2 sobre la lectura
  actual; control positivo: quitar `emitirEgresoDePagoPorCuenta`). *Hecho:* `progress/fase0_458-B.md`
  con comando, salida roja con nombre de caso, número de tests ≠ 0 y `git diff --stat` vacío (R84,
  R85, R88).
- [ ] **TB.2** Migración 1 `…_wallet_458_enums` + `down.sql` dinámico (función de la 459 renombrada
  `_458`); `schema.prisma`: los enums. *Hecho:* `migrate deploy` y `db:rollback` locales limpios; con
  una fila que use un valor nuevo el rollback falla sin borrar (R92). Depende de TB.0.
- [ ] **TB.3** Migración 2 `…_wallet_458_tablas` + `down.sql` (`design.md` §2.2): `wallet_anotacion`,
  `wallet_movimiento_anulacion` (si D13), `rechazo_tienda_cobro_anulacion`, `wallet_comprobante` (CHECK
  XOR, UNIQUE por destino), los dos CHECK tipo↔categoría ampliados, RLS; modelos y relaciones en
  `schema.prisma`; `prisma generate` sin drift. *Hecho:* `tests/integration/db/wallet-458-migration.
  test.ts` (enums valor a valor, CHECK rechazan pares invertidos, RLS activa, `down` con filas falla
  sin borrar, sin filas vuelve al estado previo; `TIPO_POR_CATEGORIA_TIENDA` = CHECK) (R92).
  Depende de TB.2.
- [ ] **TB.4** [P] `Record` totales de `design.md` §2.3 (`NATURALEZA`, `LIQUIDEZ`, `CONTRAPARTIDA`,
  `TIPO_POR_CATEGORIA_TIENDA`, `CUBETA`, `FUENTE_*`, seeds, `metrics.ts`, etiquetas en los tres
  diccionarios, `ESCRIBEN_EN_LA_TIENDA`); literales de las guardias reescritos a mano y anotados.
  *Hecho:* typecheck verde; `caja-clasificacion-459`, `caja-composicion-exhaustiva`,
  `metrics-caja-naturaleza`, `caja-derivaciones` (cuatro llamadas) verdes; mutaciones 4 y 5 → rojo
  (R85, R91). Depende de TB.2.
- [ ] **TB.5** [P] Orden estable: `listarPorTienda` y `listarPorMensajero` con `orderBy [fecha,
  createdAt, id]`. *Hecho:* test de paginación con 14 filas del mismo instante / páginas de 4 (0
  duplicadas, 0 faltantes) (R23).
- [ ] **TB.6** `EstadoCuentaRepository` (ventana `$queryRaw`, `numeric → text`) y `EstadoCuentaService`
  (tienda, mensajero, bodega por UNION sobre `cierre_bodega`; saldo inicial; totales netos; frase de
  quién debe a quién; `CHIP_POR_MOVIMIENTO` total por libro); borde con fechas `YYYY-MM-DD` y la pieza
  de periodo de la 461. *Hecho:* `saldos-corridos.test.ts` y `estado-cuenta-saldo-corrido.test.ts`
  (bordes 23:30/00:30 CR; R21 con chip; R22 con y sin anulaciones, igual a `derivarSaldoTienda`, a la
  cuenta por pagar y a `saldoDe`); guardia `estado-cuenta-chips-total` + contraprueba; mutaciones 1,
  2, 9, 12 → rojo (R16, R20–R25, R98). Depende de TB.5.
- [ ] **TB.7** [P] Resolutores «A quién» y «Registró» (`design.md` §3.4) en lote. *Hecho:*
  `tests/integration/db/libro-caja-a-quien.test.ts` (una fila por origen; nombres, nunca ids; «—» sin
  anotación; «Automático · …») (R56, R57).
- [ ] **TB.8** Estado de anulación derivado (`design.md` §3.6): `LectoresDocumentosCaja` gana
  `egresos`, `indemnizaciones`, `rechazos`; `tipoDeDocumentoOriginal` gana los tres tipos; el libro de
  la tienda y el del mensajero ganan `documento` en sus filas originales; «motivo no registrado» para
  reversos sin constancia. *Hecho:* `libro-caja-documentos-459.test.ts` ampliado (reverso en otra
  página → «anulado»; ninguna comparación en cliente); mutaciones 10 y 11 → rojo (R71, R72).
  Depende de TB.3.
- [ ] **TB.9** Anulación uniforme (`design.md` §4.2): `reversarEgreso` gana motivo y constancia (misma
  transacción, mismo instante inyectado) y deja de caer al uuid; anulación de la indemnización;
  `RechazoTiendaCobroService.anular` + `RechazoTiendaCobroAnulacionRepository` + puerto de caja con
  los dos reversos + créditos espejo condicionados a los débitos existentes + historial;
  `anularMovimientoAction` que enruta por destino a las actions existentes (172, 293, 459, 461, 457) o
  a las nuevas. *Hecho:* `wallet-anulacion-service.test.ts`, `rechazo-tienda-cobro-anulacion.test.ts`
  (rol antes de leer; monto del original; `ya_anulado`; `no_encontrado`; sin débitos de tienda no
  escribe créditos), `tests/integration/db/wallet-anulacion-458.test.ts` (por las actions; R68 con
  `derivarCaja` sobre filas reales; R73: `estado` sigue `aprobado` y la cola no lo ofrece),
  `wallet-anulacion-concurrencia.test.ts`; `caja-invariante-tiendas` con los pasos «anulación del cobro
  por rechazo» e «indemnización anulada» a 0,00; mutaciones 6, 7, 8 → rojo (R63–R69, R73, R91).
  Depende de TB.3, TB.4, TB.8.
- [ ] **TB.10** [P] Comprobante lateral (`design.md` §4.1): `PREFIJO_COMPROBANTE` +3;
  `WalletComprobanteService` (registrar en la misma transacción, adjuntar después, ver con URL firmada
  tras comprobar alcance; limpieza del objeto si falla) y `adjuntarComprobanteAction`,
  `verComprobanteAction`; alcance de la tienda en `/mi-wallet` (sus filas, `no_encontrado` sin
  distinguir ajeno de inexistente). *Hecho:* `wallet-comprobante-service.test.ts` (tipo, tamaño,
  fallo de subida no registra, fallo de registro borra, UNIQUE impide el segundo) y
  `tests/integration/db/wallet-comprobante-alcance.test.ts` (R74–R80). Depende de TB.3.
- [ ] **TB.11** Bordes de sueldo, gasto de Ordenex y corrección: `contraparteNombre` (obligatorio en
  los dos primeros, D5), `referencia?`, `comprobante?` (`FormData`), anotación en la misma
  transacción; pago a tienda/mensajero y cobro ganan `comprobante?`; los `.strict()` se conservan.
  *Hecho:* tests de actions y servicios existentes verdes + casos nuevos; sin los campos nuevos el
  comportamiento es byte a byte el de hoy (R42, R43, R50, R51). Depende de TB.10.
- [ ] **TB.12** «Así queda» (`design.md` §4.4): `EFECTO_POR_TIPO` (misma tabla que el enrutado),
  `lib/utils/efecto-movimiento.ts` puro sobre `derivarCaja`, `previsualizarMovimientoAction` (acceso
  total antes de leer). *Hecho:* `efecto-movimiento.test.ts` (un caso por concepto, incluidos «no
  cambia», la línea de capital del aporte, `saldoEnContra`, `superaDisponible`), test de action por
  rol; mutación 9 → rojo; `caja-derivaciones.guardia` verde (R44–R47, R82).
- [ ] **TB.13** [P] «Cómo quedó» (`design.md` §3.7) en `EstadoCuentaService`/`WalletService`.
  *Hecho:* test contra la base: tras el último movimiento coincide con el resumen sin filtros (R58,
  parte servidor).
- [ ] **TB.14** Comentarios T2–T4 de `design.md` §1.4 en `schema.prisma` y `lib/types/`. *Hecho:* diff
  solo de comentarios en esos archivos (R101).
- [ ] **TB.15** Repetir la fase 0 con el árbol final (las 12 mutaciones de §8.2 rojas; fotografías
  verdes salvo el bloque «a propósito»); gate COMPLETO; revisión backend. *Hecho:* `INIT_EXIT=0`;
  anexo en `progress/fase0_458-B.md`; `progress/impl_458-B.md` con la tabla R→test; nota de release
  «migrar preview y prod; correr Q458-1 antes y Q458-3 después» (R84–R92).

## 458-C — Registrar un movimiento y panel «Ver» (fullstack) · depende de 458-A, 458-B y 457 en `dev`

- [ ] **TC.0** Confirmar en `dev`: nombres finales de las actions de la 457 (`registrarAbonoTiendaAction`,
  `anularAbonoTiendaAction`, `obtenerComprobanteAbonoAction`) y sus textos reservados; el test de la 461
  que fija «siete conceptos» (se reescribe aquí con la lista nueva como contrato y se lista con R37).
  *Hecho:* nota en `progress/impl_458-C.md`.
- [ ] **TC.1** `components/shared/wallet/RegistrarMovimientoDialog`: catálogo `Record` total por
  concepto en los tres grupos de la 461 (+ pago a tienda, pago a mensajero, «Una tienda le paga a
  Ordenex») + enlace a plantillas; campos por concepto; frase de efecto (siete de la 461 byte a byte;
  tres nuevas); `fraseDelLibro` para los diez; payload/`FormData` solo con sus claves; clave al
  abrir; preselección de cuenta y concepto; buscador de cuenta (`SelectorBuscable`) que no ofrece
  tiendas inactivas donde el camino no las admite; «a quién» obligatorio en sueldo y gasto.
  *Hecho:* `wallet-registrar-movimiento-dialog.test.tsx` reescrito (R37–R43, R48, R49, R51, R52);
  `wallet-conceptos-manuales.test.ts` ampliado; los tests de la 334/381/459/461 que se retiran,
  listados con su sustituto.
- [ ] **TC.2** «Así queda» en el diálogo: pide la previsualización con retardo, estados cargando y
  error sin cifras, «no cambia» por línea, aviso de saldo en contra, tope del pago decidido por el
  servidor. *Hecho:* tests de R44–R47; barrido money-safe sin `Number(`/`parseFloat(` en la carpeta
  (R90).
- [ ] **TC.3** [P] Campo de comprobante en el formulario (tipo y tamaño avisados antes de enviar con
  `problemaDeComprobante`; el servidor decide) y «Adjuntar comprobante» en el panel para filas sin
  él. *Hecho:* `wallet-comprobante-campo.test.tsx` (R74–R76, R79, R80).
- [ ] **TC.4** `components/shared/wallet/DetalleMovimientoPanel` (Sheet: quién, por qué, cómo,
  comprobante con rótulo legible, registró, estado de anulación, «Cómo quedó», «Anular…» /
  «Anulado», texto del cobro por rechazo R100) + `AnularMovimientoDialog` (molde `AnularPagoDialog`;
  «Ya estaba anulado»; `no_anulable` legible). *Hecho:* `DetalleMovimientoPanel.test.tsx`,
  `AnularMovimientoDialog.test.tsx` (R58, R63–R67, R71, R100).
- [ ] **TC.5** Sustituir `RegistrarMovimientoCajaDialog` en `/wallet` y enchufar «Ver» + panel en el
  libro ACTUAL (`WalletLedger`: la columna de acciones pasa a «Ver»; fuera «Reversar» y su `Modal`;
  `DocumentoCajaAcciones` absorbido por el panel). *Hecho:* `wallet-page.test.tsx` verde; el efecto de
  cada concepto en la fotografía idéntico (R50); tests retirados listados.
- [ ] **TC.6** Ayuda y asistente: `docs/ayuda/oficina/wallet-caja.md` (registrar un movimiento: diez
  conceptos, «Así queda», comprobante; «Ver» y «Anular…» uniformes); `contexto-458.test.ts` bloque C;
  cuatro preguntas reales. *Hecho:* frases literales por rol; respuestas anotadas (R102, R103).
- [ ] **TC.7** Recorrido pasos 2, 3, 5, 6, 7 de §10 + adminTienda/mensajero con las actions →
  `forbidden`; fotografías verdes; gate rápido; revisión. *Hecho:* `progress/recorrido_458-C/`;
  `INIT_EXIT=0`; `progress/impl_458-C.md` (R104).

## 458-D — Estados de cuenta y «Mi wallet» (fullstack) · depende de 458-C · [P] con 458-E

- [ ] **TD.1** `components/shared/estado-cuenta/` (tarjetas con frase, tabla extracto con saldo
  inicial arriba y orden ascendente, chips por tipo de cuenta, periodo, anulados tachados con motivo,
  «Ver» → panel de 458-C, despliegue de órdenes en las filas de cierre). *Hecho:* `EstadoCuenta.test.tsx`,
  `EstadoCuentaAnulados.test.tsx` (R18–R25, R72).
- [ ] **TD.2** [P] `/wallet/tiendas/[tiendaId]` (`notFound` por rol y cuenta) + el listado enlaza y deja
  de desplegar; acciones «La tienda le paga a Ordenex» (solo con saldo en contra), «Ordenex le cobra a
  la tienda», «Ordenex le paga a la tienda» (deshabilitado con motivo sin saldo a favor) abriendo el
  diálogo de 458-C preseleccionado. *Hecho:* `EstadoCuentaAcciones.test.tsx`,
  `wallet-tiendas-estado-page.test.tsx` (R17, R26–R28, R40, R81). Depende de TD.1.
- [ ] **TD.3** [P] `/wallet/mensajeros/[mensajeroId]`: estado de cuenta, «Ordenex le paga al
  mensajero» (reparto con previsualización) y «Anular…» de sus pagos con `anularPagoAction` /
  `anularRepartoAction`; `/cierres-admin` sigue igual. *Hecho:* `EstadoCuentaMensajeroAnular.test.tsx`,
  `wallet-mensajeros-estado-page.test.tsx`, test existente de `PagoMensajeroSeccion` verde (R29, R70).
- [ ] **TD.4** [P] `/wallet/satelites/[zonaId]`: estado de cuenta Declarado/Recibido + conciliación
  (`ConciliacionAcciones`, `MarcarRecibidoDialog`) con sus textos. *Hecho:* `EstadoCuentaSatelite.test.tsx`
  + tests de la 431 verdes (R31).
- [ ] **TD.5** `/mi-wallet` como estado de cuenta en solo lectura (lecturas 461 §7.5 y 457), selector
  de cierre actual, comprobantes de sus filas por `verComprobanteAction`/las actions de la 459 y la
  457; sin actions de escritura. *Hecho:* `mi-wallet-page.test.tsx` ampliado (R34–R36, R78);
  `mi-wallet-335.guardia` verde.
- [ ] **TD.6** [P] Descarga del estado de cuenta con saldo corrido y fila de saldo inicial. *Hecho:*
  test de columnas; `columnas-sensibles.guardia` verde (R3, R32).
- [ ] **TD.7** Refresco dirigido tras registrar/anular desde el estado de cuenta (claves SWR de ESA
  cuenta; el listado revalida al montar). *Hecho:* `WalletRefrescoDirigido.test.tsx` (R30, R48).
- [ ] **TD.8** Retirar `DesgloseMovimientosTienda`, `DesglosePagosMensajero`,
  `DesgloseConsolidacionesSatelite`, `PagoTiendaAcciones` (la acción vive en el estado de cuenta) y
  sus labels/columnas de descarga; cada test retirado listado con su R sustituto. *Hecho:* lista en el
  informe; ninguna guardia pierde archivos sin que su control de no-vacuidad lo diga.
- [ ] **TD.9** Ayuda y asistente: `docs/ayuda/oficina/wallet-tiendas.md`, `wallet-mensajeros.md`,
  `wallet-satelites.md`, `tienda/mi-wallet.md` (estado de cuenta, saldo corrido, chips, acciones,
  anulados, comprobante); `contexto-458.test.ts` bloque D; cuatro preguntas reales (una desde la
  tienda). *Hecho:* frases literales por rol (R102, R103).
- [ ] **TD.10** Recorrido pasos 4–6, 8–11 de §10 + adminTienda + mensajero/adminSatelite sin acceso;
  fotografías verdes; gate rápido; revisión. *Hecho:* `progress/recorrido_458-D/`; `INIT_EXIT=0`;
  `progress/impl_458-D.md` (R104).

## 458-E — Libro de caja (fullstack) · depende de 458-C · [P] con 458-D

- [ ] **TE.1** Columnas Fecha · Movimiento y motivo · A quién · Monto (dirección + dueño) · Registró ·
  Ver; `wallet-ledger-descarga-columnas.ts` en paralelo; la aserción de `WalletDescarga.test.tsx`
  reescrita en el MISMO commit como contrato nuevo. *Hecho:* `WalletLedger458.test.tsx` (R55–R57);
  descarga sin ids (R3).
- [ ] **TE.2** Filtros Todo/Entra/Sale (`SegmentedToggle`), «A quién» (`SelectorBuscable` con
  búsqueda por tienda, mensajero o nombre libre), concepto con cuenta (458-A) y periodo; tarjetas del
  conjunto filtrado. *Hecho:* `wallet-page.test.tsx` ampliado (R53, R54, R59).
- [ ] **TE.3** Panel «Ver» + anular + «Cómo quedó» desde el libro; refresco del libro, tarjetas,
  composición y desglose tras registrar/anular. *Hecho:* tests de R58, R60.
- [ ] **TE.4** [P] Colas de gasto fijo y de rechazo (el cobro anulado se ve «Anulado» en su detalle y
  no se vuelve a ofrecer), composición y plantillas sin cambios de comportamiento. *Hecho:* sus tests
  existentes verdes sin modificarlos + un caso para el cobro anulado (R61, R73, R83, R87).
- [ ] **TE.5** Subtítulo de `/wallet` sin «dinero en caja» en estado «flujo» (`wallet-textos-458`).
  *Hecho:* guardia verde (R101).
- [ ] **TE.6** Ayuda y asistente: `docs/ayuda/oficina/wallet-caja.md` (libro: A quién, Registró, Ver,
  filtros); `contexto-458.test.ts` bloque E; cuatro preguntas reales. *Hecho:* frases literales por
  rol (R102, R103).
- [ ] **TE.7** Recorrido COMPLETO por rol (§10, los doce pasos y los cuatro roles) con la tabla
  maqueta vs app; fotografías verdes; gate rápido; revisión final de la 458. *Hecho:*
  `progress/recorrido_458-E/` con números; `INIT_EXIT=0`; todas las R de `requirements.md` con su test
  en algún `progress/impl_458-*.md` (R104).

## Dependencias

```
458-A: TA.0 → TA.1 → TA.4 ; TA.2 [P], TA.3 [P], TA.5 [P] (tras TA.1), TA.6 [P], TA.7 [P] ; TA.8 → TA.9
458-B: TB.0 → TB.1 → TB.2 → TB.3 → TB.8 → TB.9 ; TB.4 [P] tras TB.2 ; TB.5 [P] → TB.6 ; TB.7 [P] ;
       TB.10 [P] tras TB.3 → TB.11 ; TB.12 ; TB.13 [P] ; TB.14 [P] ; → TB.15
458-C: TC.0 → TC.1 → TC.2 ; TC.3 [P] ; TC.4 ; TC.5 tras TC.1 y TC.4 ; TC.6 → TC.7
458-D: TD.1 → TD.2 [P], TD.3 [P], TD.4 [P] ; TD.5 ; TD.6 [P] ; TD.7 ; TD.8 ; TD.9 → TD.10
458-E: TE.1 → TE.2 → TE.3 ; TE.4 [P] ; TE.5 [P] ; TE.6 → TE.7
Entre hijas: (461, 457 en dev) → 458-A ∥ 458-B → 458-C → 458-D ∥ 458-E
```

## Lo que hace el LEADER, no el agente

- Antes de 458-B: Q458-1 y Q458-2 de `design.md` §14 en producción (solo lectura) y anotar en
  `progress/contraste_458.md`; comprobar que ninguna migración pendiente de `dev` toca los enums ni
  las tablas de la wallet; pasar al agente de la 457 el acople D9 (su R62).
- Tras desplegar la release: Q458-3 (R7/R8 = 0,00; cifra idéntica) y C5 de la 459 (mensajeros)
  idéntico; errores de runtime en la hora siguiente = 0. «Después» en `progress/contraste_458.md`.
- Anotar en la 461 (R39 superado por R37) y en la 459 (§14 aplicado) sin reescribir la historia.
