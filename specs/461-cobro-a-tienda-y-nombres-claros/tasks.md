# Ficha 461 — Tareas

Cinco bloques en orden: **0 → A → B → C → D**, más el cierre **Z**. Es una sola entrega (sale con la
release completa, HD/L6): los bloques ordenan el trabajo, no el despliegue. `[P]` = paralelizable con sus
hermanas del mismo bloque (sin archivos en común). Un commit por tarea (`feat(461): …`, `test(461): …`,
`docs(461): …`), y verificar el blob commiteado antes de dar un bloque por cerrado. Implementan
`backend_dev` (0, A, B) y `frontend_dev` (C, D), en ese orden.

## Reglas para todas las tareas

- **Primer paso del worktree:** `git checkout --detach <SHA de dev que dé el leader>` y comprobar el
  merge-base (el worktree de agente nace de `dev`, no de la rama en curso).
- **Gate:** todos los bloques tocan `lib/types/wallet.ts` (cimiento) y B toca migraciones y
  `db/schema.prisma`: **`./init.sh` COMPLETO**, con `INIT_EXIT=$?` escrito dentro del log, sin `tail` en
  tubería, mirando que `tests/integration/db` no tenga archivos saltados (sin `.env` se saltan y el gate dice
  «OK»). **Gate y mutaciones nunca a la vez** sobre el mismo árbol.
- **La fotografía de la fase 0** (`caja-caracterizacion-459.test.ts`) corre verde al empezar y al terminar
  cada bloque **sin tocar sus literales**, salvo el bloque nuevo «lo que la 461 cambia a propósito» y las dos
  cifras del bloque de la 459 que esta ficha mueve (T A.1). Si hiciera falta cambiar otro literal, se para y
  se pregunta: es dinero.
- **Test que se retira o se reescribe** (hay ≈97 literales de nombres viejos en 14 archivos): se lista en
  `progress/impl_461.md` con el requisito que lo sustituye. Ninguno desaparece sin reemplazo. Los tests de
  la reclasificación de la 459 **no se tocan** (R61).
- **Migraciones a mano** (P3006); **ninguna migración aplicada se edita**; timestamps posteriores al último
  de `origin/dev` en el momento de escribirlas (hoy `20260925120300_reclasificar_cobros_459`).
- **No escribir `feature_list.json`** desde el worktree. **No commitear** el informe sin pedirlo.

## BLOQUE 0 — Caracterizar lo que NO puede cambiar (sin código de producción) · `backend_dev`

- [ ] **T0.1** Correr `tests/integration/db/caja-caracterizacion-459.test.ts` y
  `caja-invariante-tiendas.test.ts` sobre el SHA de `dev`: verdes, `skipped = 0`. Anotar en
  `progress/fase0_461.md` los literales de HOY de: ganancia, `deTerceros`, `enCaja`, `entradas`, saldos y
  desgloses de A y B, filas del libro de la caja y de la tienda B (con el cobro de 2.500,50). *Hecho:* la
  nota existe y cita el SHA. (R59)
- [ ] **T0.2** Mutaciones medibles HOY sobre el código actual (las 14 de design §14.2 nombran código que
  aún no existe y se corren en T Z.1): quitar `emitirEgresoDePagoPorCuenta` en `PagoPorCuentaTiendaService`
  (control positivo del arnés: la fotografía y la invariante tienen que ponerse rojas); `cobro_manual` con
  cubeta `aFavor`; `ajuste_credito` → `ajuste_debito` en el contra-asiento del pago a tienda; el monto del
  documento sustituido por uno de la petición en la anulación del pago por cuenta; `ingreso_flete` como
  `efectivo`. Con autocomprobación: diff de una línea, comando, salida roja con el nombre del caso y el
  número de tests ejecutados (≠ 0), `git diff --stat` vacío al final. *Hecho:* informe en
  `progress/fase0_461.md`; ninguna superviviente sin explicar. (R59, R60)
- [ ] **T0.3** [P] **(LEADER, no el agente)** Contraste de línea base en producción por el MCP de Supabase,
  solo lectura: C461-0, C461-1 (con la fórmula nueva: `diferencia_r8` = Σ candidatos, `diferencia_r7` 0,00),
  C461-2 (cada cobro con exactamente una línea o ninguna: se anotan los que tengan ninguna), C461-3 y C5 de
  la 459. *Hecho:* `progress/contraste_461.md` con las salidas literales, el número y la suma de candidatos y
  el efecto previsto (ganancia + Σ, «De las tiendas» − Σ). (R38)
- [ ] **T0.4** Gate completo + commit. *Hecho:* `INIT_EXIT=0` en el log.

## BLOQUE A — La derivación, la clasificación y las guardias (sin migración) · depende de 0

- [ ] **T A.1** `lib/types/wallet.ts`: `WALLET_MOVIMIENTO_CATEGORIA_SEED` + `ingreso_cobro_tienda`,
  `egreso_reverso_cobro_tienda` (solo cuando el enum de Prisma los tenga: **esta tarea se hace sobre el
  `schema.prisma` de T B.1 aunque la migración se aplique en B**; el `satisfies` lo exige);
  `WALLET_ORIGEN_TIPO_SEED` + `cobro_tienda`, `cobro_tienda_completado`; `WALLET_INGRESO_PROPIO_SEED` +
  `ingreso_cobro_tienda`; `WALLET_EGRESO_NOMBRADO_SEED` + `egreso_reverso_cobro_tienda`;
  `DocumentoCajaDTO.tipo` + `"cobro_tienda"`. `lib/types/wallet-tienda.ts`: + `cobro_tienda_anulado`.
  *Hecho:* typecheck rojo en todos los `Record` totales (la lista de design §4), que las tareas siguientes
  ponen en verde. Bloque «lo que la 461 cambia a propósito» en la fotografía, con los literales de design
  §14.1 calculados a mano en un comentario; las dos cifras del bloque de la 459 reescritas con el mismo
  criterio. (R59)
- [ ] **T A.2** `lib/utils/caja-tesoreria.ts`: `NATURALEZA_POR_CATEGORIA` (+2 `propio`),
  `LIQUIDEZ_POR_CATEGORIA` (+2 `cargo_a_tienda`), `acumular` con `reversosDeCargos` (design §2.2, solo
  sumas), `terceros = derivarBalance(ingT + reversos, egT + cargos)`. *Hecho:*
  `tests/unit/utils/caja-derivacion-461.test.ts` verde: M6 idéntico sin cobros (R28); un cobro y su reverso no
  mueven `entradas`, `salidas` ni `enCaja` y mueven ganancia y `deTerceros` en ±M; identidad R7 sobre 500
  subconjuntos con semilla fija; mutaciones 2 y 3 de §14.2 → rojo. `caja-derivaciones.guardia` sigue en 4
  llamadas. (R22–R24, R28)
- [ ] **T A.3** [P] `lib/utils/invariante-tiendas.ts` (`cobro_manual: "ingreso_cobro_tienda"`,
  `cobro_tienda_anulado: "egreso_reverso_cobro_tienda"`, tipo `credito`) y la guardia
  `caja-clasificacion-459.guardia.test.ts` con el contrato nuevo (design §14.3) y la contraprueba nueva.
  *Hecho:* verde; mutación 4 → rojo; el literal `["ajuste_debito"]` escrito a mano. (R26)
- [ ] **T A.4** [P] `desglose-tienda.ts` (`cobro_tienda_anulado: "aFavor"`), `aporte-por-orden.ts` (tres
  entradas `sin_reparto`), `finanzas-diarias.ts` (`salidas` solo efectivo), `metrics.ts` (+2 en
  `dinero_en_caja` y `ganancia_ordenex`, +1 en `cuenta_por_pagar_tienda`, descripciones). *Hecho:*
  `desglose-tienda.test.ts`, `finanzas-diario.test.ts`, `metrics-caja-naturaleza.guardia` (23/16, `egresos`
  10), `caja-composicion-exhaustiva.guardia` (8 ingresos, 3 nombrados, «otros» = `egreso_gasto`) verdes;
  mutación 5 → rojo. (R27, R29, R30)
- [ ] **T A.5** [P] `lib/types/historial-accion.ts`: tipo `cobro_tienda_anulado` («mueve dinero»), texto de
  design §7.7 para los seis tipos tocados y las dos etiquetas de entidad. *Hecho:*
  `catalogo-y-choke-point.test.ts` con 60/23/38; guardias del censo verdes (la escritura llega en B). (R51)
- [ ] **T A.6** Fotografía verde (salvo T A.1), typecheck y lint verdes; gate completo. *Hecho:*
  `INIT_EXIT=0`.

## BLOQUE B — Migraciones, el cobro con su línea de caja y su anulación · depende de A · `backend_dev`

- [ ] **T B.1** (LEADER antes de empezar) Re-medir C461-3 en producción y en la base local; comprobar que
  ninguna migración pendiente de `dev` toca los cuatro enums, los dos CHECK ni las tablas de la wallet.
  *Hecho:* nota en `progress/impl_461.md` con las listas y la conclusión.
- [ ] **T B.2** Migración 1 `…_cobro_tienda_461_enums` + `down.sql` dinámico (copia de la función de la 459
  renombrada `_461`, cuatro tipos). `db/schema.prisma`: los cuatro enums. *Hecho:* `prisma migrate deploy` y
  `db:rollback` locales limpios; con una fila que use un valor nuevo, el rollback falla sin borrar. (R62, R63)
- [ ] **T B.3** Migración 2 `…_cobro_tienda_461_anulacion_y_checks` + `down.sql` (design §3.2): tabla, FK
  RESTRICT, UNIQUE, CHECK del motivo, RLS, los dos CHECK tipo↔categoría ampliados; modelo
  `CobroTiendaAnulacion` y relaciones en `schema.prisma`; `prisma generate`. *Hecho:* sin drift
  (procedimiento de la 381). Depende de T B.2. (R62, R64)
- [ ] **T B.4** `tests/integration/db/cobro-tienda-461-migration.test.ts`: enums valor a valor contra el
  estado reconstruido; CHECK rechazan los pares invertidos (23514); RLS activa; `down` con filas falla sin
  borrar; sin ellas vuelve al estado previo; `TIPO_POR_CATEGORIA_TIENDA` coincide con el CHECK. *Hecho:* verde
  y rojo con una mutación (quitar un valor de la lista del `down`). (R62–R64)
- [ ] **T B.5** [P] `lib/utils/descripcion-cobro-tienda.ts` (puro) + test (con y sin apellido de la tienda,
  prefijo de anulación, sin forma de uuid). (R7)
- [ ] **T B.6** `CajaCobroTiendaFeedService` (literales dentro; molde `CajaPagoPorCuentaFeedService`),
  `ICajaCobroTiendaFeedService`; `CobroTiendaAnulacionRepository` (`anular` con su historial en el mismo
  método, `estadoDelCobro`, `estadoDeDocumentos`), su interfaz; `WalletTiendaMovimientoRepository.obtenerCobroPorId`
  (solo `debito/cobro_manual`); `CobroTiendaTxClient` ampliado. *Hecho:* test de lista exacta de categorías
  del puerto; integración que mata una mutación del `WHERE` de `obtenerCobroPorId` (otra categoría → `null`)
  y del `EXISTS` de `estadoDelCobro`; guardias del censo del historial verdes. Depende de T B.3. (R2, R17)
- [ ] **T B.7** `CobroTiendaService.registrarCobro` con el puerto de caja y el reloj inyectado (design §5.1);
  `ICobroTiendaService` con `anular`; docstrings de la 381 reescritos. *Hecho:*
  `tests/unit/services/cobro-tienda-service.test.ts` ampliado: rol antes de leer; los tres rechazos de tienda
  con sus textos; débito, cargo e historial con el MISMO `montoStr` y el MISMO instante (hoy = reloj del
  servicio; ayer = inicio CR); sin candado (orden de llamadas); saldo negativo devuelto; no se construye sin
  caja (el constructor lo exige por tipo). Mutación 1 → rojo. Depende de T B.5, T B.6. (R1–R9)
- [ ] **T B.8** `CobroTiendaService.anular` (design §5.1): `no_encontrado`, `no_anulable` (reclasificado /
  sin línea), `ya_anulado`, contra-asientos con el monto del cobro y el mismo instante de hoy CR, historial.
  *Hecho:* tests de servicio con reloj inyectado; mutaciones 6 y 7 → rojo. Depende de T B.7. (R10–R19)
- [ ] **T B.9** `lib/actions/wallet-tienda.ts`: `anularCobroTiendaAction` (zod `.strict()`, sin monto),
  `buildCobroTiendaService` con el puerto de caja REAL y el repositorio de anulaciones; `WalletService`:
  `tipoDeDocumentoOriginal` con `cobro_tienda` (dos orígenes) y `LectoresDocumentosCaja.cobros`; su
  composition root inyecta el lector real. *Hecho:* `tests/unit/actions/wallet-tienda-cobro-action.test.ts`
  ampliado (sesión, validación, sin monto); `tests/integration/db/cobro-tienda-461.test.ts` pasa POR LAS DOS
  ACTIONS y encuentra en Postgres el débito, el cargo, el historial, y tras anular el crédito, el reverso y su
  historial; R4/R12 medidos con `derivarCaja` sobre filas reales; `no_anulable` sobre un cobro reclasificado
  sembrado y sobre uno sin línea; `documento` del libro: `cobro_tienda` para las dos filas originales,
  `null` para el reverso y la reclasificada. Mutación 14 → rojo. (R1, R4, R9, R10, R12, R17, R20, R37)
- [ ] **T B.10** [P] `tests/integration/db/cobro-tienda-461-concurrencia.test.ts`: dos anulaciones a la vez
  → una sola fila de anulación y un solo par de contra-asientos. *Hecho:* verde y rojo sin el UNIQUE. (R15)
- [ ] **T B.11** Migración 3 `…_cobro_tienda_461_completar_caja` + `down.sql` (design §3.3) y
  `tests/integration/db/cobro-tienda-461-completar-migration.test.ts` (lee el SQL real; cobros legados por
  insert directo, uno reclasificado, uno con cargo propio; R31–R36; R8 antes y después). *Hecho:* verde;
  mutaciones 8, 9 y 10 → rojo. Depende de T B.3. (R31–R36)
- [ ] **T B.12** `caja-invariante-tiendas.test.ts`: R8 sin el término de excepción; paso 6 sobre un cobro
  legado sembrado; pasos nuevos «anulación del cobro» y «cobro completado». *Hecho:* R7 y R8 al céntimo tras
  cada paso; comprueba que hay filas; mutación 1 → rojo. Depende de T B.9, T B.11. (R25)
- [ ] **T B.13** Fotografía verde sin tocar literales (salvo T A.1), gate completo, revisión backend.
  *Hecho:* `INIT_EXIT=0`; `progress/impl_461.md` con la tabla R→test del backend y la lista de tests
  reescritos.

## BLOQUE C — Los nombres, el diálogo y los libros · depende de B · `frontend_dev`

- [ ] **T C.1** `wallet-labels.ts`: `CATEGORIA_LABEL` (§7.2), `ORIGEN_LABEL` (§7.3),
  `DOCUMENTO_CAJA_NOMBRE.cobro_tienda`, `TIPO_EGRESO_MANUAL_LABEL.gasto_variable`,
  `CAJA_RESUMEN_AVISO_TERCEROS` (R50), `ANULAR_DOCUMENTO_CAJA_RESPUESTA.noAnulable(motivo)`. *Hecho:*
  `tests/unit/components/wallet-labels.test.ts` (nuevo) con los literales de §7.2/§7.3 escritos a mano;
  `caja-textos-459.guardia` con «bajan su saldo sin pasar por la caja» en los retirados y verde. (R42, R50)
- [ ] **T C.2** [P] `desglose-tienda-labels.ts`: `CATEGORIA_TIENDA_LABEL` propio (§7.4) y opciones; pistas de
  §7.5; deja de reexportar el diccionario de `/mi-wallet`. *Hecho:* `desglose-tienda-labels.test.ts`,
  `desglose-movimientos-tienda.test.tsx`, `desglose-tienda-descarga-columnas.test.ts` reescritos con los
  literales nuevos (cada uno listado con su R). (R43, R45)
- [ ] **T C.3** [P] `mi-wallet-labels.ts`: `CATEGORIA_MI_WALLET_LABEL` (§7.5) y opciones,
  `ORIGEN_TIENDA_LABEL` (§7.3, + `cobro_tienda`), pistas de la cabecera; `DesgloseTiendaLedger`,
  `MiWalletFiltros`, `mi-wallet-descarga-columnas`, `DetalleMiMovimientoCierre` lo usan. *Hecho:*
  `mi-wallet-labels.test.ts` (dos diccionarios totales; distintos en los conceptos de §7.5; listas de orígenes
  con los dos nuevos), `mi-wallet-page.test.tsx`, `wallet-tienda-descarga-columnas.test.ts`,
  `desglose-tienda-ledger.test.tsx` reescritos; mutación 12 → rojo. (R44, R45)
- [ ] **T C.4** `wallet-conceptos-manuales.ts`: nombres (§7.1), grupos, `FRASE_DEL_EFECTO` (§7.6),
  `libroDelConcepto(cobro) = caja_y_tienda`, `FRASE_DEL_LIBRO` y `CABECERA_POR_LIBRO` por concepto; importa
  el diccionario de `/wallet/tiendas`. `RegistrarMovimientoCajaDialog.tsx`: `TEXTO_COBRO_TIENDA.hint` y el
  aviso de éxito con «le debe» (R54); payload del cobro sin claves nuevas. *Hecho:*
  `wallet-conceptos-manuales.test.ts` y `wallet-registrar-movimiento-dialog.test.tsx` reescritos (el
  payload del cobro no gana ni una clave; siete nombres; tres grupos; siete frases literales); mutación 13 →
  rojo. Depende de T C.2. (R39–R41, R46, R53, R54)
- [ ] **T C.5** `DocumentoCajaAcciones.tsx`: rama `cobro_tienda` (anular; sin comprobante), aviso
  `no_anulable`. `ComposicionGananciaCard.tsx` / `DesgloseEgresosLista.tsx`: icono de las dos filas nuevas.
  *Hecho:* `tests/components/WalletLedgerAcciones461.test.tsx` (acciones solo en originales propias y
  completadas; «Anulado»; sin acción en reverso ni reclasificada; rótulos y dueño literales en tabla y
  descarga; filtro con los conceptos nuevos), `ComposicionGananciaCard.test.tsx` con las filas nuevas y sus
  totales. Depende de T C.1. (R20, R21, R27, R37, R52)
- [ ] **T C.6** [P] `tests/unit/guards/nombres-wallet-461.guardia.test.ts` (design §14.3) con contraprueba y
  no-vacuidad; correr `fuente-unica-nombre-estado`, `nombres-estado-retirados`, `sin-estados-retirados`,
  `caja-textos-459` y las guardias `ayuda-*`. *Hecho:* todas verdes; mutación 11 → rojo. (R47–R49)
- [ ] **T C.7** Historial: pantalla filtra y muestra `cobro_tienda_anulado` con su texto. *Hecho:* test de
  la pantalla del historial con el tipo nuevo. (R51)
- [ ] **T C.8** Fotografía verde, gate completo, revisión frontend. *Hecho:* `INIT_EXIT=0`;
  `progress/impl_461_frontend.md` con la tabla R→test y la lista de tests reescritos.

## BLOQUE D — La ayuda y el asistente · depende de C · `frontend_dev`

- [ ] **T D.1** `docs/ayuda/oficina/wallet-caja.md`, `oficina/wallet-tiendas.md`, `tienda/mi-wallet.md` (y
  `oficina/historico-acciones.md` si nombra las acciones) según design §11: nombres, el cobro como cargo, su
  anulación, la tabla de los dos conceptos, fuera «sin pasar por la caja»; frontmatter `actualizado` y
  `fuentes`. *Hecho:* `tests/unit/asistente/contexto-461.test.ts` verde con las frases literales de §11 por
  rol (maestro/admin reciben caja y tiendas; adminTienda recibe mi wallet; mensajero/adminSatelite no reciben
  la caja); `contexto-460.test.ts` reescrito donde citaba nombres retirados, cada literal listado;
  `nombres-wallet-461.guardia` barre `docs/ayuda/**` en verde. (R56–R58)
- [ ] **T D.2** Cuatro preguntas reales al asistente en local (como hizo la 460): «¿qué pasa con la ganancia
  si le cobro a una tienda?», «¿cómo anulo un cobro?», «¿qué es Ordenex paga un gasto de una tienda?», y una
  desde la tienda «¿por qué dice Ordenex te cobró?». *Hecho:* respuestas correctas anotadas en
  `progress/impl_461_frontend.md`.

## CIERRE Z

- [ ] **T Z.1** Repetir la fase 0 con el árbol final: las 14 mutaciones de design §14.2 rojas y la
  fotografía verde sin tocar sus literales (salvo T A.1). *Hecho:* anexo en `progress/fase0_461.md`.
- [ ] **T Z.2** `progress/impl_461.md`: tabla R1–R65 → test con rutas reales (R38 y R65 con su evidencia en
  `progress/`); lista completa de tests reescritos o retirados con su R.
- [ ] **T Z.3** Recorrido por rol de design §16 (maestro, admin, adminTienda, mensajero) en local sembrado,
  un solo dev server. *Hecho:* `progress/recorrido_461.md` + capturas con números en
  `progress/recorrido_461/`. (R65)
- [ ] **T Z.4** (LEADER) Tras desplegar la release: C461-0 (0 candidatos restantes), C461-1 (`diferencia_r8`
  y `diferencia_r7` 0,00; `ganancia_despues = ganancia_antes + Σ`; cifra idéntica), C461-2 sin filas, C5
  idéntico; errores de runtime en la hora siguiente = 0. *Hecho:* «después» en `progress/contraste_461.md`.
  (R38)
- [ ] **T Z.5** (LEADER) Actualizar los specs de la 457 y la 458 y anotar la 459 según design §15; entrada en
  `progress/history.md`.

## Dependencias

```
0:  T0.1 → T0.2 ; T0.3 (leader) en paralelo ; T0.4
A:  T A.1 → T A.2 ; T A.3 [P], T A.4 [P], T A.5 [P] tras T A.1 ; → T A.6
B:  T B.1 (leader) → T B.2 → T B.3 → T B.4 ; T B.5 [P] ; T B.6 → T B.7 → T B.8 → T B.9 ; T B.10 [P] tras T B.9 ;
    T B.11 tras T B.3 ; T B.12 tras T B.9 y T B.11 ; → T B.13
C:  T C.1 ; T C.2 [P] ; T C.3 [P] ; T C.4 tras T C.2 ; T C.5 tras T C.1 ; T C.6 [P] ; T C.7 ; → T C.8
D:  T D.1 → T D.2
Z:  T Z.1 → T Z.2 → T Z.3 ; T Z.4 y T Z.5 (leader) tras el despliegue
```
