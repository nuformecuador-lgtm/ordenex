# Feature 462 — Tareas

> Orden: **backend (Fase 1-2) → frontend (Fase 3) → verificación y release (Fase 4-5)**. `[P]` = puede ir
> en paralelo con las de su bloque. Cada tarea trae su criterio de «hecho». Los `R<n>` son los de
> `requirements.md`; las secciones `§` son de `design.md`.
>
> Gate de esta ficha: **`./init.sh` completo** (toca `db/schema.prisma`, `lib/types/**` y archivos con
> `cierre` en el nombre; `--rapido` se niega solo). Los tests de `tests/integration/db` solo corren con
> `DATABASE_URL`: si el gate los reporta `skipped`, la ficha **no está verificada** (mirar los `skipped`,
> no solo el `INIT_EXIT`).
>
> Base de la rama: `origin/dev` con la 454 mergeada (`lib/repositories/gestion-pendiente.ts` existe).
> El worktree de agente nace de `dev` (memoria): primer paso, `git checkout --detach <SHA>` del
> pre-vuelo y comprobar el merge-base.

---

## Fase 0 — Pre-vuelo (backend_dev)

- [ ] **T0.1** Confirmar en el archivo real (no en el grafo) los símbolos que este spec reutiliza:
  `puedeLiberarse` y su `export` (`LiberacionReprogramadaService.ts:53`), `findOrdenesLiberables` y
  `OrdenLiberableRow`, `sqlUltimaGestionPendienteLateral` (`gestion-pendiente.ts:151`),
  `derivarJornada`, `resolverDestinoCierre`, `hrefDetalleCierre`/`RUTA_CIERRES_ADMIN`
  (`cierre-enlace.ts`), `ESTADO_LABEL` (`cierre-labels.ts`), `NOMBRE_ESTADO.reprogramado`,
  `ESTADOS_COLA_CIERRE_DIA`, `emitirYContar`, `AMBITO_REPRESADAS_POR_ROL`.
  **Hecho:** lista en `progress/impl_462.md` con archivo:línea de cada uno; si alguno no existe o cambió
  de forma, se anota y se adapta el diseño antes de codificar.
- [ ] **T0.2** Medir la última carpeta de `db/migrations` en `origin/dev` y fijar `<ts>` posterior.
  **Hecho:** `<ts>` anotado en `impl_462.md`; no colisiona con ninguna carpeta existente.
- [ ] **T0.3** Verificar que `cierre-labels.ts` es puro (sin `react`, sin `next/*`, sin `@/lib/db`).
  **Hecho:** anotado; si no lo es, T3.4 aplica la extracción a `lib/constants/`.

## Fase 1 — El conteo (backend_dev)

- [ ] **T1.1** Ampliar la proyección de `sqlUltimaGestionPendienteLateral` en `gestion-pendiente.ts`
  con `"gp"."id" AS "gestion_id"`, `"gp"."cierre_id"`, `"gp"."fecha_reprogramacion"` (§1.2). Comentario
  fechado. **Hecho:** `tests/integration/db/454/gestion-pendiente-sql-real.test.ts` sigue verde y gana
  un aserto de que las tres columnas llegan; `ayuda-abierta.ts` sin cambios.
- [ ] **T1.2** `[P]` Añadir `mensajeroAsignadoId: string | null` a `OrdenLiberableRow` y al `select`
  de `buscarLiberables` (§1.1). Sin tocar `where`/`orderBy`/`take`. **Hecho:** fixtures actualizados;
  suites de 46/276/315/371 verdes; `correccion-fecha-reprogramacion.guardia` verde.
- [ ] **T1.3** `[P]` Crear `lib/interfaces/repositories/IReprogramadaRetenidaRepository.ts` y
  `lib/repositories/ReprogramadaRetenidaRepository.ts` (§2.2): `findRetenidasEnReparto(hoyCR)` con el
  `$queryRaw` de §1.2 compuesto con el fragmento importado (el literal `gestion_registrada` NO aparece en
  el archivo), `findCierresQueRetienen(ids)`, `findMensajeros(ids)`. Solo lecturas. **Hecho:**
  typecheck; `gestion-pendiente-unica-fuente.guardia` verde.
- [ ] **T1.4** Crear `lib/interfaces/services/IReprogramadasRetenidasService.ts` (tipos de §2.1 y el
  helper puro `recortarPorAmbito`) y `lib/services/ReprogramadasRetenidasService.ts` (§2.3): Forma A por
  reuso (`findOrdenesLiberables` + `!puedeLiberarse`), Forma B por el repo nuevo, cierres en lote,
  `derivarJornada` por cierre, ámbito por destino persistido / `resolverDestinoCierre`, `contar` y
  `contarPorCierre` derivados de `resumen`. Depende de T1.2, T1.3. **Hecho:** tests unitarios con
  dobles (`tests/unit/services/reprogramadas-retenidas-service.test.ts`): agrupación, ámbito central vs
  zona, sin cierre, orden de la lista, `recortarPorAmbito`, dos gestiones vivas (solo la vigente).
- [ ] **T1.5** Test de integración `tests/integration/db/462/reprogramadas-retenidas-sql-real.test.ts`
  (§8.1) con `enTransaccionRevertida`, siembra propia (zona, tienda, mensajero, cierres en los cuatro
  estados, órdenes en `reprogramado`/`en_reparto`, gestiones con y sin `orden_evento`
  `gestion_registrada`, con y sin fila de historial de visita real, fechas hoy/ayer/mañana, una borrada,
  una en bodega). Casos: R1, R2 (cada exclusión), R3 (igualdad con `esperandoCierre` del reloj sobre la
  misma siembra), R40 (cierre aprobado con la orden aún en `reprogramado` → 0), R41, R42, R43, R44,
  R45/R46 (fecha corregida a hoy / a futuro), R47 (sin cierre → con cierre). Cada aserto positivo
  comprueba primero que la siembra existe. Depende de T1.4. **Hecho:** verde con `DATABASE_URL`; las
  mutaciones 1-6 y 10 de §8.2 lo ponen rojo (probadas y anotadas en `impl_462.md`).
- [ ] **T1.6** `[P]` Guardia nueva `tests/unit/guards/reprogramadas-retenidas-solo-lectura.guardia.test.ts`:
  el repositorio y el servicio (fuente sin comentarios) no contienen `.update(`, `.updateMany(`,
  `.create(`, `.createMany(`, `.delete(`, `.deleteMany(`, `.upsert(`, `$executeRaw`, `INSERT `,
  `UPDATE `, `DELETE `; y `LiberacionReprogramadaService.ts`, `liberacion-al-aprobar-cierre.ts`,
  `liberacion-tras-corregir-fecha.ts` no nombran `reprogramadas_esperan_cierre` (R20). Con
  autocomprobación (una cadena con `update(` la pone roja). **Hecho:** verde; mutación 11 roja.
- [ ] **T1.7** `[P]` Script `scripts/medir-462-retenidas.sql` (§9), con la lista de
  `ORIGEN_TIPOS_VISITA_REAL` verificada en el archivo real al escribirlo y el aviso de que exige la 454.
  **Hecho:** el test de T1.5 lo ejecuta contra su siembra (`$queryRawUnsafe` del archivo leído) y
  `SUM(retenidas)` coincide con `resumen().total` (R55).

## Fase 2 — Aviso, push, cifra viva y marca (backend_dev)

- [ ] **T2.1** Migración `db/migrations/<ts>_notificacion_evento_reprogramadas_esperan_cierre/`
  (`migration.sql` con los dos `ADD VALUE IF NOT EXISTS`; `down.sql` recrea los dos enums con la lista
  previa) + `db/schema.prisma` (+2 valores con comentario fechado) + `pnpm prisma generate`. Avisar antes
  de aplicar en la base local compartida. **Hecho:** `pnpm run db:migrate` y `pnpm run db:rollback`
  funcionan en local (ida y vuelta); los `down.sql` previos NO se tocan; el test del enum afirma los dos
  valores.
- [ ] **T2.2** `lib/types/notificacion.ts`: los dos valores en `NotificacionEvento` y
  `NotificacionEntidadTipo` con el comentario de la entidad (`${ambito}:${diaCR}`, `"central"`).
  Depende de T2.1. **Hecho:** typecheck; los `Record`/`satisfies` del catálogo y del push dejan de
  compilar hasta T2.3/T2.4 (es la señal esperada).
- [ ] **T2.3** `lib/notificaciones/catalogo-avisos.ts`: `EVENTOS_AGREGADOS` + entrada + título (§3.1).
  Depende de T2.2. **Hecho:** `catalogo-avisos.test.ts` extendido (clase, atajo, destinatarios,
  `esEventoAgregado`, título singular/plural **a mano**, módulo sigue puro);
  `atajo-aviso-ruta-visible.guardia` verde (los tres roles ven `/cierres-admin`, sin parámetro).
- [ ] **T2.4** `[P]` `lib/notificaciones/push-elegibles.ts`: entrada `{ push: "si", roles: ["admin",
  "adminSatelite"] }` con su porqué (§4). Depende de T2.2. **Hecho:** `push-elegibles.test.ts`
  extendido: `esElegiblePush` sí para admin/adminSatelite, no para maestro/adminTienda/mensajero.
- [ ] **T2.5** `[P]` `lib/notificaciones/emitir.ts`: `TEXTO_REPROGRAMADAS_ESPERAN_CIERRE`, contexto y
  `emitirReprogramadasEsperanCierre` (§3.2). `lib/notificaciones/notificadores.ts`: tipo, `Con`,
  `Real`, `notificadorNoOp`. Depende de T2.2. **Hecho:**
  `tests/unit/notificaciones/emitir-reprogramadas-esperan-cierre.test.ts`: destinatarios por ámbito,
  entidad `central:<dia>` / `<zonaId>:<dia>`, `warning`, sin anexo, texto literal a mano, sin dígitos ni
  PII en la descripción; `push-cableado-unico.guardia` verde.
- [ ] **T2.6** Test de integración `tests/integration/db/462/aviso-reprogramadas-dedupe.test.ts`:
  misma corrida dos veces el mismo día → una fila por destinatario (R11); dos zonas + central el mismo
  día → cada una la suya (R12, mutación 7: sin el ámbito en la entidad la segunda zona queda muda); días
  distintos → filas distintas. Depende de T2.5. **Hecho:** verde con `DATABASE_URL`.
- [ ] **T2.7** `AvisosDiariosService` + `IAvisosDiariosService` (§3.4): dep `retenidas` requerida,
  notificador con default no-op, `emitirAvisosDeRetenidas`, tres campos nuevos del resumen; `app/api/
  cron/avisos-diarios/route.ts` construye `ReprogramadasRetenidasService` y **pasa**
  `notificarReprogramadasEsperanCierreReal`, y enumera los campos campo a campo. Depende de T1.4, T2.5.
  **Hecho:** `avisos-diarios-service.test.ts` extendido (un aviso por ámbito con retenidas, ninguno con
  0, best-effort por ámbito, los dos agregados previos intactos); test del route (respuesta sin ids);
  `notificacion-notificadores-reales.test.ts` afirma que el argumento se PASA (mutación 8 roja).
- [ ] **T2.8** `VigenciaAvisoAgregadoService` + `IVigenciaAvisoAgregado` (§3.5): mapa de ámbito, rama
  nueva, dep opcional que lanza; `lib/actions/notificaciones.ts` construye y pasa el servicio de
  retenidas. Depende de T1.4, T2.3. **Hecho:** `vigencia-aviso-agregado.test.ts` extendido: central
  para maestro/admin, zona para adminSatelite, lanza sin zona / rol ajeno / dep ausente (mutación 9
  roja); `notificacion-service.test.ts`: fila oculta con 0 y visible sin número al fallar; guardia de
  composition root ampliada a esta línea.
- [ ] **T2.9** `CierresAdminService` + `ICierresAdminService` (§5.1): `reprogramadasRetenidasHoy?` en
  `CierreAdminResumen`, dep `retenidas` sin default, `rellenarRetenidas` en cola paginada, histórico
  paginado y detalle; `lib/actions/cierres-admin.ts` la pasa. Actualizar las suites que instancian el
  servicio con un doble. Depende de T1.4. **Hecho:**
  `tests/unit/services/cierres-admin-retenidas.test.ts`: una llamada por página (mutación 12 roja),
  campo poblado en los tres caminos, `aprobado` → 0, alcance satélite y central sin cambios; guardia de
  «alguien lo PASA» en `lib/actions/cierres-admin.ts`; suites existentes de cierres-admin verdes;
  `cierres-admin-descarga-columnas` verde.
- [ ] **T2.10** `lib/actions/reprogramadas-retenidas.ts` (§6.1): acción de lectura acotada al ámbito
  central, `esAccesoTotal`, `unauthenticated`/`forbidden`, `recortarPorAmbito`. Depende de T1.4.
  **Hecho:** `tests/unit/actions/reprogramadas-retenidas.test.ts`: maestro y admin `ok`, adminTienda
  `forbidden` (mutación 13 roja), sin sesión `unauthenticated`, el resultado no trae cierres de
  satélite.
- [ ] **T2.11** Gate backend: `./init.sh` completo en verde con `DATABASE_URL` (los archivos de
  `tests/integration/db/462` NO en `skipped`). Commit por tarea. **Hecho:** `INIT_EXIT=0` en el log y
  cero `skipped` de esta ficha; `progress/impl_462.md` con la tabla R→test parcial y las mutaciones
  probadas.

## Fase 3 — Pantallas (frontend_dev; empieza al cerrar T2.11)

- [ ] **T3.1** `cierre-labels.ts`: `retieneReprogramadas(n)` (singular/plural explícitos) y el texto
  del `title`. **Hecho:** test literal a mano de las dos formas.
- [ ] **T3.2** `RetieneReprogramadasBadge.tsx` (§5.2): `Badge variant="warning"`; `null`/`0` → nada.
  Depende de T3.1. **Hecho:** `RetieneReprogramadasBadge.test.tsx`: 0 → no renderiza; 1 y 3 → literal;
  `aria-label` presente.
- [ ] **T3.3** Montar la marca en `CierreFacturaResumen` (chips de cabecera), en la cabecera del
  detalle (`cierre-detalle-shared.tsx`) y en las filas de `CierresAdminHistoricoLista.tsx`. Depende de
  T3.2. **Hecho:** tests RTL de la cola y del histórico: fila con `reprogramadasRetenidasHoy: 2`
  muestra la marca, fila con 0 o sin campo no; acciones, orden y descargas intactos (suites existentes
  verdes).
- [ ] **T3.4** `[P]` `FranjaReprogramadasRetenidas.tsx` (§6.2): tres frases (R32/R34), enlace
  «Revisar cierres», lista de cierres con `hrefDetalleCierre`, `fechaLegible` o «cierre del día»,
  `ESTADO_LABEL`, «K de ellas…» sin enlace; `null`/0 → nada. Si T0.3 lo exige, extraer `ESTADO_LABEL`
  a `lib/constants/` y reexportar. **Hecho:** `FranjaReprogramadasRetenidas.test.tsx`: las tres frases
  a mano (singular y plural), N enlaces con el uuid solo en el `href`, sin franja con 0, «cierre del día»
  con jornada nula.
- [ ] **T3.5** `app/(app)/ordenes/page.tsx`: lectura solo para `esAccesoTotal`, `try` que degrada a
  `null` con log, render de la franja antes de `OrdenesListado` (§6.2). Depende de T2.10, T3.4.
  **Hecho:** test de la página o del bloque: adminTienda no dispara la lectura ni ve la franja; un
  `forbidden`/error deja la página intacta; el bloque son dos archivos + ~8 líneas (anotado en
  `impl_462.md` para R39).
- [ ] **T3.6** Gate frontend: `./init.sh` completo en verde. **Hecho:** `INIT_EXIT=0`, cero `skipped`
  de la ficha, `impl_462.md` con la tabla R→test completa (todos los R1-R56 con su test) y las 14
  mutaciones de §8.2 anotadas con el test que cada una puso en rojo.

## Fase 4 — Recorrido y revisión

- [ ] **T4.1** Recorrido por rol en local con Playwright o a mano (memoria «ver la app encuentra lo que
  la suite no»), con una siembra de: 1 cierre central `solicitado` que retiene 2 (una Forma A y una
  Forma B), 1 cierre central `rechazado` que retiene 1, 1 cierre satélite `vencido` que retiene 1, 1
  gestión sin cierre con fecha de hoy. Medir y anotar números:
  - maestro/admin: campana «Reprogramado para hoy: 4 órdenes…» (3 con cierre + 1 sin cierre), franja
    «Hay 4… faltan 2 cierres…» + «1 de ellas…», marcas en los dos cierres centrales (2 y 1), ninguna en
    el satélite (no lo ven);
  - adminSatelite de esa zona: campana «…1 orden…», marca en su `vencido`, sin franja;
  - adminTienda y mensajero: nada de esta ficha;
  - aprobar el `solicitado` → en el siguiente sondeo la campana dice 2, la franja «Hay 2… falta 1…»,
    la marca desaparece del cierre aprobado.
  **Hecho:** tabla con los números en `progress/impl_462.md` §recorrido (R56/R7).
- [ ] **T4.2** `[P]` Correr el cron `avisos-diarios` a mano en local con el secreto y comprobar: filas
  creadas por ámbito, respuesta sin ids, y (con claves VAPID locales) que el job `push_web` se encola
  una vez por (usuario, evento, jornada) para admin y adminSatelite y no para maestro. **Hecho:**
  anotado con conteos.
- [ ] **T4.3** `[P]` Medir la campana abierta 5 minutos con el aviso vivo: consultas por sondeo
  (`prisma` con `log: ["query"]`). **Hecho:** número anotado; si supera lo declarado en §2.1 (~5), se
  aplica la optimización de `contar` descrita ahí antes de cerrar.
- [ ] **T4.4** Reviewer: `progress/review_462.md` con veredicto, contra CHECKPOINTS.md y la tabla
  R→test; **commiteado** (memoria «informe de revisión sin commitear»). **Hecho:** veredicto OK;
  entrada en `progress/history.md`.

## Fase 5 — Release (en la release completa, con SF-001, 454-456, 459-461)

- [ ] **T5.1** Antes de desplegar: correr la parte **A** de `scripts/medir-462-retenidas.sql` (solo
  lectura, MCP de Supabase) contra producción y anotar cuántas reprogramadas legadas están retenidas y
  por qué cierres. Es el número que la oficina verá el primer día. **Hecho:** número y fecha en la nota
  de la release.
- [ ] **T5.2** Reescribir la lista del `down.sql` contra el `schema.prisma` de `origin/dev` justo antes
  de abrir el PR (memoria «El `down.sql` borra los valores posteriores»). **Hecho:** diff revisado; los
  downs previos intactos.
- [ ] **T5.3** Tras el despliegue, a la mañana siguiente de la primera corrida de las 07:00 CR: correr
  el script completo contra producción y comparar con la campana del admin, la franja de `/ordenes` y
  las marcas de `/cierres-admin` (R7). **Hecho:** los cuatro números coinciden; si no, ficha de
  corrección con la diferencia medida.
- [ ] **T5.4** Cerrar la ficha: `feature_list.json#462` → `done` con `status_note` de 3-6 líneas
  (memoria «status_note conciso»), fuera de cualquier rama de agente (memoria «no escribir feature_list
  con agentes dentro»). **Hecho:** commit en `dev`.

---

## Dependencias, en una línea

T0.* → T1.1, T1.2, T1.3 (paralelas) → T1.4 → T1.5, T1.6, T1.7 → T2.1 → T2.2 → T2.3, T2.4, T2.5
(paralelas) → T2.6, T2.7, T2.8, T2.9, T2.10 → T2.11 → T3.1 → T3.2 → T3.3 ∥ T3.4 → T3.5 → T3.6 →
T4.* → T5.*.
