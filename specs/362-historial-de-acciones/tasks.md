# 362 — Historial de acciones · tasks

> Leer antes: `requirements.md` (R1–R40 + Anexo A) y `design.md`.
> `[P]` = paralelizable con las tareas de su misma tanda. Toda tanda depende de que **T0 esté
> cerrada**.
> **Zona `fullstack`: se secuencia backend → frontend.** Las tandas T0–T4 y T6.1 son backend; T5,
> T6.2 y T6.3 son frontend.

**Regla de esta ficha, y no es negociable:** un registro de auditoría **incompleto es un mentiroso
silencioso**. La ficha NO se da por hecha con tandas de instrumentación a medias (T1, T2, T3
completas o nada). Si hay que entregar antes, la única forma honesta es declarar tipos **sin
productor** *y* decirlo en pantalla — y eso hay que pedírselo al humano, no decidirlo aquí.

---

## T0 — Cimientos (bloquea todo lo demás)

- [ ] **T0.1 — `lib/types/historial-accion.ts`.** Declara `HISTORIAL_ACCION_TIPOS` (los 40 del
  Anexo A, `as const`), `HISTORIAL_ACCION_ENTIDADES` (17), `CATEGORIAS_ACCION` (3),
  `CATEGORIA_POR_ACCION: Record<HistorialAccionTipo, CategoriaAccion>` y `ACCION_LABELS:
  Record<HistorialAccionTipo, string>`. Módulo puro: sin Prisma, sin React.
  **Hecho cuando:** `typecheck` verde y un test afirma que los dos `Record` son **exhaustivos**
  sobre el enum (quitar una clave no compila; añadir un valor al enum sin etiqueta no compila).
  *(R14, R17)*

- [ ] **T0.2 — Esquema Prisma.** `db/schema.prisma`: los dos enums, el modelo `HistorialAccion` de
  `design.md §1.2` con sus 3 índices, y la relación inversa en `Usuario`. Cabecera de comentario que
  declare la inmutabilidad (patrón `orden_historial_estado`).
  **Hecho cuando:** `pnpm exec prisma validate` verde y `prisma format` no cambia nada.
  *(R1, R2, R3, R4, R6, R7)* · **depende de T0.1**

- [ ] **T0.3 — Migración up/down.** `db/migrations/<ts>_historial_accion/migration.sql` con los dos
  `CREATE TYPE`, la tabla, los 3 índices, la FK `ON DELETE RESTRICT` y
  `ALTER TABLE historial_accion ENABLE ROW LEVEL SECURITY` **sin políticas**. `down.sql` con
  `DROP TABLE` + los dos `DROP TYPE`. **No se toca ningún `down.sql` anterior** (son fotos
  históricas; los enums son nuevos).
  **Hecho cuando:** `pnpm run db:migrate` aplica, `pnpm run db:rollback` revierte y vuelve a
  aplicarse limpio; un test de integración lee `pg_class.relrowsecurity = true` y `pg_policy` vacío
  para la tabla.
  *(R8)* · **depende de T0.2** · ⚠ avisar: la base local la comparten worktrees.

- [ ] **T0.4 — El choke point.** `lib/repositories/registrar-accion.ts` con `appendAccion(tx,
  entradas, loteId?)` y su interfaz `lib/interfaces/repositories/IHistorialAccionRepository.ts`
  (tipo `HistorialAccionTxClient`, `EntradaAccion`). No-op con `entradas` vacío. `loteId` generado
  **una vez** por llamada.
  **Hecho cuando:** test unitario con doble de `tx` que afirma (a) una fila por entrada, (b) el
  mismo `lote_id` en todas, (c) `loteId` distinto entre dos llamadas, (d) no-op con `[]`.
  *(R1, R7, R13)* · **depende de T0.2**

- [ ] **T0.5 — `lib/types/historial-accion-etiquetas.ts`.** Función pura `etiquetaDeEntidad(tipo,
  fila)` con un caso por `HistorialAccionEntidad`, según la tabla de `design.md §1.3-b`. Trunca a
  120 caracteres.
  **Hecho cuando:** test con un caso por entidad, incluido el respaldo `"(sin guía)"` de una orden
  sin guía ni remisión, y la truncación.
  *(R4, R5)* · **depende de T0.1** · `[P]` con T0.4

- [ ] **T0.6 — Lectura del actor congelado.** Helper que, dentro de una `tx`, resuelve
  `{ nombre, rol }` del actor con **una** consulta, y devuelve los tres campos a `null` cuando el
  actor es el sistema.
  **Hecho cuando:** test que afirma **una sola** consulta por llamada y el caso `actor = null`.
  *(R3, R36)* · **depende de T0.4** · `[P]` con T0.5

---

## T1 — Instrumentar «hace desaparecer algo» (6 tipos)

> Va **primera** porque es donde el agujero está medido (79 órdenes sin rastro) y donde vive el
> cambio más arriesgado del lote.

- [ ] **T1.1 — `orden_eliminada` por pantalla.** `OrdenRepository.softDelete` pasa a
  `prisma.$transaction` y su `updateMany` a `UPDATE … RETURNING id, num_guia, num_remision` vía
  `$queryRaw` con `Prisma.sql`/`Prisma.join` (**sin interpolación de texto**). El `where` **no
  cambia**: los ids, `deleted_at IS NULL` y la frontera `tiendaId` de la ficha 358 siguen en la misma
  sentencia. `appendAccion` se llama con las filas **devueltas**.
  **Hecho cuando:** (a) `tests/integration/db/eliminar-orden-pantalla-frontera-tienda.test.ts` sigue
  verde sin tocarlo; (b) un caso nuevo: lote de 3 con una ya borrada → `eliminadas = 2` y
  **exactamente 2** filas de registro, ninguna de la tercera; (c) la mutación «construir las entradas
  con los ids pedidos» pone rojo ese caso, con línea.
  *(R9, R11, R12)* · **depende de T0**

- [ ] **T1.2 — `orden_eliminada` por API key.** `OrdenRepository.softDeleteViaApi`, mismo
  tratamiento. El actor es la cuenta dedicada de la key; `actorRol` queda congelado como `apiKey`.
  **Hecho cuando:** `tests/integration/db/eliminar-orden-api-frontera-tienda.test.ts` sigue verde y
  un caso nuevo afirma la fila con `actor_rol = 'apiKey'`.
  *(R3, R9)* · **depende de T1.1** (comparten el patrón de `RETURNING`)

- [ ] **T1.3 — `orden_recuperada`.** El reverso de `softDelete`, mismo tratamiento.
  **Hecho cuando:** caso de integración que borra y recupera y encuentra **dos** filas, en ese orden.
  *(R9, R12)* · **depende de T1.1**

- [ ] **T1.4 — `tarifa_borrada`.** ⚠ **Borrado FÍSICO.** La etiqueta se congela **antes** del
  `DELETE`, dentro de la misma tx.
  **Hecho cuando:** caso de integración que borra la tarifa y comprueba que la fila del registro
  sigue diciendo de qué tarifa se trataba (R4), con la tarifa ya inexistente.
  *(R4, R9)* · **depende de T0** · `[P]` con T1.5, T1.6

- [ ] **T1.5 — `zona_borrada`.** `ZonaRepository` ya corre en `$transaction`: la llamada va dentro.
  Etiqueta congelada antes del `delete` (arrastra tarifas en cascada).
  **Hecho cuando:** caso de integración con la zona ya borrada y la fila legible. *(R4, R9)* · `[P]`

- [ ] **T1.6 — `vehiculo_borrado` y `plantilla_eliminada`.**
  **Hecho cuando:** un caso por tipo, contra Postgres. *(R9)* · `[P]`

---

## T2 — Instrumentar «mueve dinero» (23 tipos)

> Todas estas escrituras **ya corren dentro de una `$transaction`**: la tarea es añadir la llamada
> dentro del callback y congelar el importe. Money-safe en todo el camino.

- [ ] **T2.1 — Cierres.** `cierre_dia_aprobado`, `cierre_dia_rechazado`,
  `cierre_dia_pagos_editados`, `cierre_bodega_aprobado`, `cierre_bodega_rechazado`. `monto` =
  `total_general` del cierre (snapshot), `Prisma.Decimal`.
  **Hecho cuando:** un caso por tipo contra Postgres, y uno que afirma que **aprobar un cierre
  produce UNA fila**, no una por movimiento de wallet emitido (design §0: se registra la decisión,
  no sus asientos). *(R6, R9)* · **depende de T0**

- [ ] **T2.2 — Liquidación.** `pago_mensajero_registrado`, `pago_tienda_registrado`, `pago_anulado`,
  `reparto_mensajero_registrado`, `reparto_anulado`. `monto` = el del pago/reparto.
  **Hecho cuando:** un caso por tipo; y uno que afirma que un **reparto** produce la fila del reparto
  y **no** una por cada `liquidacion_pago` hijo. *(R6, R9)* · `[P]` con T2.1

- [ ] **T2.3 — Wallet.** `wallet_movimiento_manual_registrado`,
  `egreso_administrativo_registrado`, `egreso_administrativo_reversado`.
  **Hecho cuando:** un caso por tipo; el reverso por cron escribe con actor `null` y la fila lo dice.
  *(R6, R9, R36)* · `[P]`

- [ ] **T2.4 — Tarifas (alta y cambio).** `tarifa_creada`, `tarifa_actualizada`. `valorAnterior`/
  `valorNuevo` van **`NULL`** (ver Q3 de `requirements.md`); `monto` va `NULL` (una tarifa son diez
  importes, no uno).
  **Hecho cuando:** un caso por tipo, y uno que afirma que las tres columnas van `NULL` — para que
  quien mañana quiera meter ahí un volcado se tope con un test. *(R5, R9)* · `[P]`

- [ ] **T2.5 — Incidentes, gastos fijos, cobros por rechazo y premios.** `incidente_aprobado`,
  `incidente_rechazado`, `cobro_gasto_fijo_aprobado`, `cobro_gasto_fijo_rechazado`,
  `cobro_rechazo_tienda_aprobado`, `cobro_rechazo_tienda_rechazado`, `premio_ranking_registrado`,
  `premio_ranking_anulado`. `monto` = la indemnización / el cobro / el premio.
  **Hecho cuando:** un caso por tipo contra Postgres. *(R6, R9)* · `[P]`

---

## T3 — Instrumentar «cambia quién puede hacer qué» (11 tipos)

- [ ] **T3.1 — Usuarios.** `usuario_creado`, `usuario_rol_cambiado`, `usuario_zona_cambiada`,
  `usuario_estado_cambiado`, `usuario_contrasena_restablecida`. Los métodos del repositorio se
  envuelven en `$transaction`. Los dos primeros salen de `actualizarUsuario` y **solo se escriben si
  el campo cambia de verdad**: `valorAnterior`/`valorNuevo` con el `RolValue` / el nombre de la zona.
  **Hecho cuando:** (a) un caso por tipo; (b) un caso «se edita el teléfono y **no** se registra
  nada»; (c) un caso «se cambian rol y zona a la vez → **dos** filas con el **mismo** `lote_id`»;
  (d) un caso que afirma que `valor_anterior`/`valor_nuevo` solo contienen valores del enum.
  *(R5, R7, R9)* · **depende de T0**

- [ ] **T3.2 — Postulaciones.** `postulacion_aprobada`, `postulacion_rechazada`.
  **Hecho cuando:** un caso por tipo. *(R9)* · `[P]` con T3.1

- [ ] **T3.3 — API keys.** `api_key_generada`, `api_key_rotada`, `api_key_activada`,
  `api_key_desactivada`. ⚠ **Ni el secreto ni el hash ni el prefijo entran en la fila**: la etiqueta
  es el identificador visible de la key.
  **Hecho cuando:** un caso por tipo, más un test que afirma que ninguna columna de la fila contiene
  el secreto ni el `key_hash`. *(R5, R9)* · `[P]`

---

## T4 — Lectura (backend)

- [ ] **T4.1 — Repositorio.** `lib/repositories/HistorialAccionRepository.ts` +
  `IHistorialAccionRepository`. **Un solo constructor de `where`** y un solo `orderBy`, compartidos
  por `list` (paginado) y `listAll` (descarga). `orderBy` armado con `ordenTotal(criterios,
  {id:"asc"})` **importado** de `lib/types/ordenamiento-listado.ts`.
  **Hecho cuando:** `tests/integration/db/historial-accion-orden-total.test.ts` verde con un corpus
  que incluya **un lote de ≥120 filas del mismo instante** y páginas de 25, cubriendo: no repite ni
  pierde en `desc`, ídem en `asc`, la misma página dos veces da lo mismo, y la descarga sale en el
  **mismo** orden que la pantalla. Y la mutación «quitar el desempate» pone **rojo** ese archivo, con
  línea. ⚠ Con un corpus pequeño esa mutación **sobrevive en verde**: es el hallazgo nº 1 de
  `progress/impl_352.md`; las cifras del corpus van escritas en la cabecera del test.
  *(R22, R23, R24, R25, R30)* · **depende de T0**

- [ ] **T4.2 — Filtros y búsqueda en el `where`.** Actor, tipo, categoría, tipo de entidad, rango de
  fechas CR y término libre (design §4.5).
  **Hecho cuando:** tests **de integración** (no de servicio con dobles: el `WHERE` se prueba donde
  vive) para cada filtro, incluido «filtrar por categoría equivale a filtrar por sus tipos» y «el
  término alcanza persona y etiqueta, y **no** alcanza nada más» (R31, con un caso negativo).
  *(R29, R31)* · **depende de T4.1**

- [ ] **T4.3 — Borde y esquemas.** `filtroHistorialAccionSchema` con `.strict()` y
  `esquemaOrdenamiento(HISTORIAL_SORT_FIELDS, "created_at", "desc")`.
  **Hecho cuando:** casos de: tipo inventado → `validation_error` sin consulta; clave desconocida →
  `validation_error`; `sortDir` inválido → `validation_error`; defecto = más reciente primero.
  *(R15, R26, R32)* · **depende de T4.1** · `[P]` con T4.2

- [ ] **T4.4 — Servicio y acciones.** `HistorialAccionService` (autorización con
  `ROLES_HISTORICO_CONVERSACIONES` + DTO con `monto` **STRING**) y
  `lib/actions/historial-acciones.ts` con `listarHistorialAccionesPaginado`,
  `listarHistorialAccionesCompleto` y `obtenerCatalogoActoresHistorial`.
  **Hecho cuando:** un caso de rol denegado **por cada** acción, incluida la de descarga (R33), y un
  test que afirma `typeof dto.monto === "string"`.
  *(R6, R33)* · **depende de T4.2, T4.3**

---

## T5 — Pantalla (frontend; empieza cuando T4 está cerrada)

- [ ] **T5.1 — Ruta y gate.** `app/(app)/historico/acciones/page.tsx` con `notFound()` **antes** de
  cualquier lectura, sin ningún literal de rol, e inyección por `deps` con default.
  **Hecho cuando:** un caso por rol denegado + sesión ausente, cada uno con
  `expect(servicio).not.toHaveBeenCalled()`. *(R18)* · **depende de T4.4**

- [ ] **T5.2 — Navegación.** Segundo subítem `{ label: "Acciones", href: "/historico/acciones" }` en
  el ítem «Histórico» de `lib/auth/menu-visibility.ts`. **Sin `roles` propios** (hereda del padre).
  **Hecho cuando:** (a) el subítem es visible exactamente para los roles del padre; (b)
  `tests/unit/auth/destino-post-login.test.ts` sigue verde **sin tocarlo** (R20); (c) un test afirma
  que el subítem no declara `roles`. *(R19, R20)* · `[P]` con T5.1

- [ ] **T5.3 — Barra de filtros.** `historial-acciones-filtros-def.ts` (puro),
  `seleccion-a-filtro.ts` (puro) y `HistorialAccionesFiltrosBar` montada sobre `BuscadorFiltros` +
  `FilterComponent`. `ATAJOS_CREACION` y `ultimosNDiasCalendarioCR` **importados**, nunca
  reescritos. `minChars` desde `BUSQUEDA_MIN_CHARS`.
  **Hecho cuando:** test que afirma con `toEqual` las 5 claves ofrecidas y su orden; test que afirma
  que el `minChars` del control **es** la constante del borde (no un `3` literal).
  *(R28, R29, R32)* · **depende de T4.4**

- [ ] **T5.4 — Módulo y tabla.** `HistorialAccionesModule` con `DataTable`, `Pagination`
  server-side, cabecera ordenable por Fecha, y la clave de SWR **con `claveDeOrden(...)`**.
  **Hecho cuando:** montaje que afirma las columnas quién/qué/sobre qué/cuándo; caso de fila sin
  actor → «Sistema»; caso de importe con el formato de la casa; caso de fecha CR (fila escrita a las
  23:30 CR aparece en el día CR correcto); y un test que afirma que dos ordenamientos **no** comparten
  clave de caché. *(R27, R34, R35, R36, R37)* · **depende de T5.3**

- [ ] **T5.5 — Estado vacío.** `EmptyState` que dice que el registro **empieza el día del despliegue**
  y que lo anterior no existe (design §5.4).
  **Hecho cuando:** test de montaje con lista vacía que afirma ese texto. · `[P]` con T5.4

---

## T6 — Descarga (contrato)

- [ ] **T6.1 — Lectura completa.** `listarHistorialAccionesCompleto` comparte `where` y `orderBy`
  con la paginada (ya cubierto por T4.1; aquí se cablea).
  **Hecho cuando:** caso «con filtros aplicados, la descarga trae el mismo conjunto que la pantalla».
  *(R30)* · **depende de T4.4**

- [ ] **T6.2 — Módulo de columnas.** `historial-acciones-descarga-columnas.ts` con las 10 columnas de
  `design.md §4.6`. **Sin `id`, sin `entidadId`, sin `loteId`.**
  **Hecho cuando:** `tests/unit/descarga/columnas-sensibles.guardia.test.ts` verde (descubre el
  módulo por convención de nombre, no hay que registrarlo) y un
  `historial-acciones-descarga-columnas.test.ts` que afirma claves, encabezados y orden.
  *(R38)* · **depende de T6.1**

- [ ] **T6.3 — Censo de tablas.** Alta en `tests/unit/descarga/censo-tablas.ts` como `con_descarga`,
  y subir **los cuatro** números duros de `cobertura-tablas.guardia.test.ts` **al valor que la propia
  guardia reporte** (impl_336 avisa: dos de los cuatro son literales sueltos, no constantes).
  **Hecho cuando:** `pnpm run test:guardias` verde y el comentario del censo dice qué tabla entró y
  por qué. · **depende de T6.2**

---

## T7 — Las guardias (lo que sostiene R2, R5, R9, R13, R16, R21, R39)

- [ ] **T7.1 — Escrituras cubiertas.** `tests/unit/guards/historial-accion-escrituras-cubiertas.guardia.test.ts`.
  Censo cerrado `{ tipo, archivo, metodo }` de los 40 tipos. Recorte del **cuerpo real** por llaves
  balanceadas; exige `appendAccion`, la sentencia de mutación, y que la llamada caiga **dentro del
  rango del callback de `$transaction`**. Anti-vacuidad (el recorte no está vacío y es el método que
  dice ser) y **contraprueba** en las dos direcciones: cuerpo sin la llamada → rojo; llamada fuera
  del callback → rojo.
  **Hecho cuando:** las contrapruebas pasan y el censo cubre los 40 tipos.
  *(R9, R16)* · **depende de T1, T2, T3**

- [ ] **T7.2 — Punto único de escritura.** Ningún archivo del árbol fuera de
  `lib/repositories/registrar-accion.ts` nombra `historialAccion`, `historial_accion` ni
  `HistorialAccionRepository` **para escribir**. Con contraprueba.
  **Hecho cuando:** verde, y pegar `tx.historialAccion.create` en otro repositorio la pone roja.
  *(R13)* · `[P]` con T7.1

- [ ] **T7.3 — Forma de la tabla e inmutabilidad.** Sobre `db/schema.prisma`: el modelo **no** tiene
  `updatedAt`, `deletedAt` ni `categoria`; el repositorio de lectura **no** expone `update`,
  `delete`, `updateMany` ni `deleteMany`; no existe ningún job que borre de la tabla.
  **Hecho cuando:** verde con contraprueba (añadir `updated_at` en memoria → rojo).
  *(R2, R17, R39)* · `[P]`

- [ ] **T7.4 — Sin datos de cliente.** Sobre los 40 puntos de escritura y sobre
  `etiquetaDeEntidad`: ninguna expresión que alimente `entidadEtiqueta`, `valorAnterior` o
  `valorNuevo` lee `destinatario`, `telefonoDest`, `direccion`, `email`, `cedula`, `notas`,
  `motivo*`, `passwordHash`, `keyHash` ni `secret`. Contraprueba: inyectar
  `entidadEtiqueta: orden.destinatario` en memoria → rojo.
  **Hecho cuando:** verde con contraprueba en las dos direcciones.
  *(R5)* · **depende de T1, T2, T3**

- [ ] **T7.5 — Solo lectura de la pantalla.** Ningún módulo de `app/(app)/historico/acciones/**`
  importa una Server Action que escriba. Precedente: 321/R24.
  **Hecho cuando:** verde con contraprueba. *(R21)* · **depende de T5**

- [ ] **T7.6 — Fuente única de roles.** Hermana de
  `historico-roles-una-sola-fuente.guardia.test.ts` para la ruta nueva: ningún literal de rol en la
  página y sí el nombre de la constante, con las tres contrapruebas del original.
  **Hecho cuando:** verde con contrapruebas. *(R19)* · **depende de T5.1**

- [ ] **T7.7 — Money-safe.** Ningún `Number(`, `parseFloat(` ni `+` sobre el importe en el camino
  `repositorio → servicio → DTO → pantalla`; la columna es `Decimal(12,2)`; el DTO lo expone como
  `string`. Patrón de `gasto-fijo-cobro-money-safe.guardia.test.ts`.
  **Hecho cuando:** verde con contraprueba. *(R6)* · **depende de T4.4**

---

## T8 — Cierre

- [ ] **T8.1 — Atomicidad medida contra Postgres.**
  `tests/integration/db/historial-accion-atomicidad.test.ts`: por cada una de las tres categorías,
  (a) fallo del registro → la mutación **no** persiste; (b) fallo de la mutación → **no** queda
  registro; (c) lote parcial → tantas filas como alcanzadas.
  **Hecho cuando:** verde, **y** el archivo se demuestra capaz de ponerse rojo con la mutación
  «quitar el `appendAccion`», con la línea del fallo apuntada.
  *(R10, R11, R12)* · **depende de T1, T2, T3**

- [ ] **T8.2 — Índices donde importa.** Test de integración con corpus sembrado que pide `EXPLAIN`
  para las tres consultas del módulo y exige que ninguna resuelva por `Seq Scan`. Anti-vacuidad: el
  corpus tiene que ser lo bastante grande para que el planificador prefiera el índice, y eso va
  escrito con la cifra en la cabecera.
  **Hecho cuando:** verde, y quitar cualquiera de los tres índices pone rojo su caso.
  *(R40)* · **depende de T4.1**

- [ ] **T8.3 — Mapa R → test.** Tabla completa `R1…R40 → archivo › nombre del caso` en
  `progress/impl_362.md`. Un requisito sin test es un fallo de la feature.
  **Hecho cuando:** los 40 mapeados, y el reviewer lo puede verificar sin abrir el código.
  · **depende de todo lo anterior**

- [ ] **T8.4 — Mutaciones declaradas.** En `progress/impl_362.md`, con la **línea real del fallo**:
  (1) quitar el `appendAccion` de `softDelete`; (2) sacarlo fuera del `$transaction`; (3) construir
  las entradas con los ids **pedidos**; (4) `loteId` por fila; (5) quitar el desempate del `orderBy`;
  (6) escribir el mínimo de caracteres a mano en el control; (7) copiar la lista de roles dentro de
  la página. Las siete tienen que poner rojo un test **nombrado**.
  **Hecho cuando:** las 7 medidas y revertidas, con su línea.
  · **depende de T8.1**

- [ ] **T8.5 — Gate.** `./init.sh` **completo** (`--rapido` se negará: el diff toca
  `db/schema.prisma`, `db/migrations/**` y `lib/types/**`). Registrar `INIT_EXIT=$?` **dentro** del
  log, no por el código de salida del `echo`.
  **Hecho cuando:** `INIT_EXIT=0` y el conteo de archivos/tests apuntado en la bitácora.
  · **depende de todo**

---

## Dependencias, de un vistazo

```
T0 ─┬─> T1 ─┐
    ├─> T2 ─┼─> T7.1, T7.4, T8.1 ─> T8.4 ─┐
    ├─> T3 ─┘                              │
    └─> T4.1 ─> T4.2 ─┬─> T4.4 ─┬─> T5.1 ─> T7.6                 ├─> T8.3 ─> T8.5
                 T4.3 ┘         ├─> T5.3 ─> T5.4 ─> T7.5         │
                                ├─> T6.1 ─> T6.2 ─> T6.3         │
                                └─> T7.7                          │
              T4.1 ─> T8.2 ──────────────────────────────────────┘
T5.2 y T7.2, T7.3 son independientes dentro de su tanda.
```

## Antes de empezar: lo que hay que preguntarle al humano

**No arrancar T1–T3 sin respuesta a Q4** (`requirements.md`): si el módulo va a ser maestro-only, la
decisión cambia `lib/auth/menu-visibility.ts` y su guardia, y es mejor saberlo antes que después.
**Q1, Q2, Q3, Q5 y Q6 no bloquean T0**, pero Q1 y Q2 pueden **añadir tipos al enum**, y añadir un
valor a un enum de Postgres después es otra migración: conviene cerrarlas antes de T0.3.
