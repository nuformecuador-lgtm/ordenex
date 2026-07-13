# Feature 40 — Cierre de bodega satélite → bodega principal · requirements.md

Zone: `fullstack` · complexity: `high` · depends_on: 38 (`done`, transitivamente 37) · branch: `feature/40-cierre-bodega-satelite`

> **F1.4 APROBADA por el humano el 2026-07-12** (SUPERSEDE "## Preguntas abiertas"; todas las
> recomendadas). Decisiones:
> - **(a)** Tabla nueva `CierreBodega` + FK nullable `cierre_bodega_id` en `cierre_dia` (espejo de la 37).
> - **(b)** Reusa el enum `CierreEstado` (`solicitado`/`aprobado`/`rechazado`).
> - **(c)** Entran solo los `cierre_dia` `aprobado` de la zona con `cierre_bodega_id IS NULL`; los `rechazado` se excluyen y no bloquean.
> - **(d) Precondición:** el adminSatélite SOLO puede solicitar si NO quedan `cierre_dia` en `solicitado` sin resolver en su zona.
> - **(e)** Totales snapshot AGREGADOS (suma de los `cierre_dia` incluidos), money-critical.
> - **(f) Pago al mensajero:** OMITIR/placeholder en el detalle (es la feature 39; no invadir).
> - **(g)** Índice único parcial `(zona_id) WHERE estado='solicitado'` (≤1 cierre de bodega abierto por zona).
> - **(h)** El maestro ve cola `solicitado` + histórico `aprobado`/`rechazado`.
> - **(i)** Motivo de rechazo obligatorio y no vacío.
> - **(j)** Rechazo INMUTABLE: no desvincula los `cierre_dia` (desbloqueo = feature 41).
> - **(k)** Auditoría `resuelto_por`/`resuelto_at`/`motivo_rechazo` (patrón 38).
> - **(l) Módulo:** EXTENDER `/cierres-admin`, **role-aware**: el **adminSatélite SOLICITA** el cierre de su bodega
>   desde su rol; el **maestro APRUEBA/RECHAZA** los cierres de bodega satélite desde el suyo (mismo módulo, secciones
>   por rol, coherente con el alcance por rol de la 38). + E2E Playwright (escrito, ejecución diferida).
> Estado: `in_progress`.

## Contexto y nivel

La feature 40 es el **SEGUNDO NIVEL** de cierre. El primer nivel ya está en `dev`:

- **Feature 37** — el `mensajero` gestiona sus órdenes y **solicita** su cierre del día
  (`cierre_dia` en estado `solicitado`, con snapshot de totales por método y destino derivado
  `bodega_central`/`bodega_satelite` según su zona).
- **Feature 38** — el administrador de la bodega (`maestro` para la central, `adminSatelite`
  para su satélite) **aprueba/rechaza** los `cierre_dia` de SUS mensajeros
  (`solicitado` → `aprobado`/`rechazado`, con auditoría `resuelto_por`/`resuelto_at`/`motivo_rechazo`).

La 40 introduce el cierre de **NIVEL BODEGA**: la bodega satélite, como entidad, **CONSOLIDA**
los `cierre_dia` YA `aprobado` de sus mensajeros y **SOLICITA** su cierre a la bodega principal;
el `maestro` (bodega central) lo **APRUEBA o RECHAZA**. El maestro pasa a aprobar dos cosas: los
`cierre_dia` de sus propios mensajeros del GAM (feature 38, ya hecho) **y** los cierres de bodega
satélite (esta feature).

## Alcance (qué SÍ hace la 40)

1. El `adminSatelite` **consolida** los `cierre_dia` `aprobado` de su zona satélite aún NO
   incluidos en un cierre de bodega y **solicita** el cierre de su bodega, creando un
   `CierreBodega` en estado `solicitado`, vinculando esos `cierre_dia`, con **snapshot** de los
   totales **agregados** por método, destino = bodega central.
2. El `maestro` ve la **cola** de cierres de bodega satélite `solicitado` dirigidos a la central
   + un **histórico** de resueltos, con el **detalle agregado** (por cada `cierre_dia` incluido,
   su detalle de gestiones reusado de 37/38 + totales por cierre + totales agregados).
3. El `maestro` **aprueba/rechaza** cada cierre de bodega (transición guardada + auditoría,
   patrón feature 38). Todo el alcance por rol+zona se resuelve **server-side**.

## Fuera de alcance (lo hace otra feature — NO construir aquí)

- **Pago al mensajero por zona** (monto a pagar por entrega/rechazo según la zona) → **feature 39**.
  La 40 NO calcula ese pago. Si el detalle lo menciona, es un dato **derivado/placeholder** que la
  39 llenará (ver R14 y F1.4-f). NO invadir.
- **Bloqueos / obligatoriedad / vencidos** (cron 00:00, bloqueo de bodega con cierres pendientes,
  desbloqueo tras aprobación) → **feature 41**. La 40 solo **modela y transiciona**; las
  consecuencias son de la 41.
- **Wallet / caja** y movimientos de dinero → **features 42–45**.

## Actores y datos base (verificados en `dev`)

- `resolveActorFromSession()` → `Actor { usuarioId, rol }` (`lib/auth/resolve-actor.ts`).
- `model CierreDia` (`db/schema.prisma`, feature 37/38): `mensajeroId`, `estado` (`CierreEstado`:
  `solicitado`/`aprobado`/`rechazado`), `destinoTipo` (`CierreDestinoTipo`:
  `bodega_central`/`bodega_satelite`), `destinoZonaId`, totales snapshot
  (`totalEfectivo`/`totalSimpe`/`totalTransferencia`/`totalGeneral`, `Decimal(12,2)`),
  `solicitadoAt`, `resueltoPor`/`resueltoAt`/`motivoRechazo` (feature 38). Índices `[mensajeroId]`,
  `[destinoTipo, destinoZonaId]`, `[estado]`. RLS habilitada sin políticas (solo service role).
- `GestionOrden.cierreId` (FK nullable): las gestiones incluidas en un `cierre_dia` lo referencian;
  el detalle por orden se deriva de esas filas.
- Detalle reutilizable de la 37: `CierreGestionPendienteRow` (repo) → `CierreDetalleGestion`
  (service DTO), proyección `WITH_DETALLE` + mapper `toPendienteRow`/`toDetalleDTO`
  (`lib/repositories/CierreDiaRepository.ts`, `lib/services/CierreDiaService.ts`, ambos exportados
  para reuso), tipos `CierreTotales`/`CierreGrupos` (`lib/interfaces/services/ICierreDiaService.ts`)
  y firma de evidencias con `ISignedUrlProvider` (bucket privado de la feature 36).
- Alcance por zona: `IZonaRepository.findCentralZonaId()` (id de la zona central o `null`),
  `IOrdenRepository.findUsuarioZonaId(usuarioId)` (zona del actor o `null`).
- Patrón de transición guardada + auditoría de la feature 38 (`CierresAdminService`/`Repository`):
  `updateMany ... WHERE id=X AND estado='solicitado' AND <alcance>`; `count===0` → distinguir
  `conflict` de `fuera_de_alcance`.

---

## Requisitos (EARS)

### Acceso y autorización

- **R1** — El sistema DEBE exponer la capacidad de **solicitar** el cierre de bodega ÚNICAMENTE al
  rol `adminSatelite`; la página/acción valida el actor server-side y, si el rol no es
  `adminSatelite` (o no hay sesión), NO DEBE permitir consolidar ni solicitar (`notFound`/`forbidden`,
  patrón features 33/36/37/38). *Testeable:* `maestro`/`mensajero`/`adminTienda`/`admin`/sin sesión
  no pueden consolidar ni solicitar.

- **R2** — El sistema DEBE exponer la capacidad de **aprobar/rechazar** cierres de bodega ÚNICAMENTE
  al rol `maestro`; cualquier otro rol (incluido `adminSatelite`) o sin sesión NO DEBE poder
  resolver ni ver la cola/histórico de aprobación de cierres de bodega. *Testeable:* solo `maestro`
  ve la cola de cierres de bodega y puede aprobar/rechazar.

- **R3** — El sistema DEBE resolver el alcance **server-side**: SI el actor es `adminSatelite`,
  ENTONCES la consolidación y la solicitud DEBEN acotarse a **su** zona (`findUsuarioZonaId`); un
  `adminSatelite` NUNCA DEBE consolidar cierres de otra zona. *Testeable:* con `cierre_dia`
  aprobados de varias zonas, el adminSatelite de la zona A solo consolida los de A.

- **R4** — SI el actor es `adminSatelite` y no tiene `zonaId` asignada, ENTONCES el sistema DEBE
  mostrar el módulo vacío con un aviso accionable y NO DEBE permitir solicitar el cierre de bodega
  (patrón feature 38/R3). *Testeable:* adminSatelite sin zona → estado vacío + `sinZona`, sin crear fila.

### Consolidación y solicitud (adminSatelite)

- **R5** — MIENTRAS existan `cierre_dia` de la zona del `adminSatelite` en estado `aprobado`,
  `destinoTipo = bodega_satelite`, `destinoZonaId = su zona` y aún NO incluidos en un cierre de
  bodega (`cierreBodegaId IS NULL`), el sistema DEBE listarlos como **consolidación pendiente**,
  cada uno con su mensajero, sus totales snapshot y su detalle derivable. `prov. F1.4-c`
  *Testeable:* dado un set de cierre_dia aprobados sin cierre de bodega en la zona, la respuesta los lista.

- **R6** — SI el `adminSatelite` tiene al menos un `cierre_dia` de su zona en estado `solicitado`
  (pendiente de que él lo apruebe/rechace, feature 38), ENTONCES el sistema DEBE impedir solicitar
  el cierre de bodega y DEBE informar que primero debe resolver los cierres de sus mensajeros.
  `prov. F1.4-d` *Testeable:* con 1 cierre_dia `solicitado` en la zona, solicitar → `conflict`, sin
  crear cierre de bodega.

- **R7** — SI no hay ningún `cierre_dia` `aprobado` consolidable en la zona (`cierreBodegaId IS
  NULL`), ENTONCES el sistema DEBE impedir crear el cierre de bodega (no se cierra una bodega vacía).
  *Testeable:* sin cierre_dia aprobados consolidables, solicitar → error sin crear fila.

- **R8** — SI ya existe un `CierreBodega` de esa zona en estado `solicitado`, ENTONCES el sistema
  DEBE impedir crear otro (a lo sumo un cierre de bodega `solicitado` por zona a la vez).
  `prov. F1.4-g` *Testeable:* segunda solicitud consecutiva de la misma zona → `conflict`.

- **R9** — CUANDO el `adminSatelite` solicite el cierre de bodega y se cumplan R4–R8, el sistema
  DEBE crear un `CierreBodega` en estado `solicitado` para su zona, con destino la bodega central,
  vinculando TODOS los `cierre_dia` consolidados (`cierre_dia.cierreBodegaId` = nuevo cierre), en
  una operación **todo-o-nada** (transaccional). `prov. F1.4-a` *Testeable:* tras solicitar, existe
  1 `CierreBodega` `solicitado` y todos los cierre_dia consolidados referencian su id.

- **R10** — CUANDO se cree el `CierreBodega`, el sistema DEBE **snapshotear** en él los totales
  **agregados** por método de pago (`efectivo`/`SIMPE`/`transferencia`) y el total general, como la
  suma de los totales snapshot de los `cierre_dia` incluidos, con Decimal de escala 2 exacto.
  `prov. F1.4-e` *Testeable:* los totales snapshot del CierreBodega == suma de los totales de sus
  cierre_dia al crearlo; suma exacta al centavo.

### Detalle agregado (money-critical) — visible para maestro y adminSatelite

- **R11** — CUANDO se abra un cierre de bodega, el sistema DEBE mostrar, por cada `cierre_dia`
  incluido, su **detalle completo**: el mensajero, sus totales snapshot, y el detalle por orden de
  sus gestiones agrupadas por `resultado` (entregada/reprogramada/devuelta/rechazada), reusando el
  DTO `CierreDetalleGestion`/`CierreGrupos` de la feature 37 (no un DTO nuevo). Además DEBE mostrar
  los **totales agregados** del cierre de bodega. `prov. F1.4-b` *Testeable:* el detalle lista cada
  cierre_dia con sus gestiones por resultado y los totales agregados coinciden con el snapshot.

- **R12** — DONDE una gestión del detalle tenga evidencia en foto, el sistema DEBE exponerla
  mediante **URL firmada de corta duración**, nunca el `storage_path` crudo ni una URL pública
  (patrón features 21/22/36/37/38). *Testeable:* la respuesta trae URL firmada; el path crudo no se filtra.

- **R13** — El sistema DEBE manejar todos los montos como Decimal de escala 2 serializados a
  **string** cruzando la frontera Server Action → cliente (nunca `number`/`parseFloat`); los totales
  mostrados DEBEN ser el **snapshot** (congelados, no recomputados). *Testeable:* los montos del DTO
  son strings con escala 2; los totales agregados == snapshot del cierre de bodega.

- **R14** — El detalle NO DEBE incluir el cálculo del **pago al mensajero** por zona (feature 39):
  ese dato es responsabilidad exclusiva de la 39. `prov. F1.4-f` *Testeable:* el DTO de detalle de la
  40 no expone montos de pago al mensajero (o los expone solo como placeholder nulo documentado).

### Aprobar / rechazar (maestro)

- **R15** — El sistema DEBE listar para el `maestro` los cierres de bodega en estado `solicitado`
  (cola de pendientes de decisión) y un **histórico** de solo lectura de los resueltos
  (`aprobado`/`rechazado`), cada uno con su zona, quién lo solicitó, totales agregados y cantidad de
  cierre_dia incluidos. `prov. F1.4-h` *Testeable:* un cierre de bodega solicitado aparece en la cola
  del maestro; uno resuelto, en el histórico.

- **R16** — CUANDO el `maestro` apruebe un cierre de bodega `solicitado`, el sistema DEBE
  transicionarlo a `aprobado`. *Testeable:* aprobar un cierre de bodega solicitado → `estado = aprobado`.

- **R17** — CUANDO el `maestro` rechace un cierre de bodega `solicitado`, el sistema DEBE
  transicionarlo a `rechazado` y DEBE exigir un **motivo de rechazo** no vacío que se persiste con el
  cierre. `prov. F1.4-i` *Testeable:* rechazar sin motivo → `validation_error`; con motivo →
  `rechazado` y el motivo queda guardado.

- **R18** — El sistema DEBE hacer la transición idempotente/concurrencia-segura: DEBE aplicarla
  ÚNICAMENTE si el cierre de bodega sigue en `solicitado` (guardia en el `WHERE` del `updateMany`,
  patrón feature 38); SI ya fue resuelto, ENTONCES NO DEBE re-aplicarla y DEBE devolver `conflict`
  sin efectos. `prov. F1.4-j` *Testeable:* segunda aprobación/rechazo del mismo cierre de bodega →
  `conflict`, sin cambios.

- **R19** — SI el `maestro` intenta aprobar/rechazar un cierre de bodega inexistente, ENTONCES el
  sistema DEBE rechazar la operación sin efectos (`no_encontrada`), sin filtrar la existencia.
  *Testeable:* resolver un id inexistente → sin efectos.

- **R20** — CUANDO se resuelva un cierre de bodega (aprobar o rechazar), el sistema DEBE registrar
  QUIÉN lo resolvió (`resueltoPor` = actor maestro) y CUÁNDO (`resueltoAt`), para trazabilidad
  money/audit. `prov. F1.4-k` *Testeable:* tras resolver, el cierre de bodega guarda el id del maestro
  y la marca de tiempo.

### Límites y seguridad

- **R21** — El RECHAZO DEBE ser **inmutable**: transiciona el cierre de bodega a `rechazado` y NO
  DEBE desvincular los `cierre_dia` incluidos (`cierreBodegaId` permanece intacto), preservando el
  detalle y el snapshot. El desbloqueo/re-solicitud de la bodega es de la **feature 41**.
  `prov. F1.4-j` *Testeable:* tras rechazar, los `cierre_dia` del cierre de bodega mantienen su
  `cierreBodegaId`.

- **R22** — La transición de la 40 NO DEBE producir efectos fuera de su alcance: NO DEBE desbloquear
  bodega ni mensajeros, NO DEBE alimentar wallet/caja y NO DEBE tocar `orden`/`gestion_orden`
  /`cierre_dia` salvo el vínculo `cierreBodegaId` al solicitar (R9). Esas consecuencias son de las
  features 41/42. *Testeable:* tras aprobar/rechazar, no cambia ningún otro estado del sistema.

- **R23** — El módulo DEBE ser de solo lectura salvo las mutaciones propias (solicitar por el
  adminSatelite; aprobar/rechazar por el maestro): listar y ver detalle NO DEBEN mutar filas.
  *Testeable:* listar/ver detalle no cambia ninguna fila.

### Datos y migración

- **R24** — La tabla nueva de cierres de bodega DEBE tener **RLS habilitada** (sin políticas
  anon/authenticated; solo service role), patrón `cierre_dia`/`gestion_orden`/`orden`. *Testeable:*
  la migración habilita RLS; test de integración de migración lo verifica.

- **R25** — La migración que crea la tabla nueva, la FK `cierre_bodega_id` en `cierre_dia` y sus
  índices DEBE ser versionada y reversible: DEBE incluir `down.sql` y `pnpm run db:rollback` DEBE
  revertirla limpiamente. *Testeable:* round-trip up → down → up en la DB de test.

---

## Tabla de trazabilidad (R → test previsto)

| R | Prueba prevista (el implementer fija la ruta en `progress/impl_40-*.md`) |
| --- | --- |
| R1 | integración action/página: rol ≠ adminSatelite no consolida/solicita |
| R2 | integración action/página: rol ≠ maestro no ve cola ni resuelve cierre de bodega |
| R3 | unit service: adminSatelite acota consolidación a su zona; otra zona excluida |
| R4 | unit service: adminSatelite sin zona → sinZona, sin crear |
| R5 | unit service: lista cierre_dia aprobados sin cierre de bodega de la zona |
| R6 | unit service: cierre_dia `solicitado` en la zona → conflict, no crea |
| R7 | unit service: sin cierre_dia aprobados consolidables → error, no crea |
| R8 | integración repo/DB: segunda solicitud de la zona → conflict (índice único parcial) |
| R9 | integración repo/DB: crea CierreBodega + vincula cierre_dia (`cierreBodegaId`), atómico |
| R10 | integración/unit: totales agregados snapshot == suma de los cierre_dia; exacto (Decimal) |
| R11 | unit service: detalle por cierre_dia con gestiones por resultado + totales agregados |
| R12 | unit service (doble `ISignedUrlProvider`): evidencia → URL firmada, no path |
| R13 | unit service: montos string escala 2; totales == snapshot, no recompute |
| R14 | unit service: el DTO de detalle no expone pago al mensajero (o placeholder nulo) |
| R15 | unit service: cola `solicitado` + histórico `aprobado`/`rechazado` para el maestro |
| R16 | integración repo/DB: aprobar solicitado → aprobado |
| R17 | unit service: rechazo sin motivo → validation_error; con motivo → rechazado + motivo |
| R18 | integración repo/DB: doble resolución → conflict (updateMany WHERE estado='solicitado') |
| R19 | unit service: id inexistente → no_encontrada, sin efectos |
| R20 | integración: cierre de bodega resuelto guarda resueltoPor + resueltoAt |
| R21 | integración: tras rechazar, `cierre_dia.cierreBodegaId` intacto |
| R22 | integración: tras resolver, sin otros efectos (orden/gestion/cierre_dia sin cambios) |
| R23 | unit service: listar/ver detalle no muta |
| R24 | integración migración: RLS habilitada en `cierre_bodega` |
| R25 | integración migración: rollback up/down verde |
| — E2E `prov. F1.4-l` | Playwright: adminSatelite consolida→solicita → maestro ve→abre detalle→aprueba/rechaza→histórico |

---

## Preguntas abiertas (F1.4 — decisiones que el humano debe cerrar)

Cada una con **recomendación** del spec_author y alternativa. NO se cierran aquí.

- **(a) Modelo del cierre de bodega.** *Recomendado:* tabla NUEVA `CierreBodega` (zona, quién
  solicita, estado, totales-snapshot agregados, auditoría del maestro) + FK **nullable**
  `cierre_bodega_id` en `cierre_dia`, seteada al solicitar — espejo EXACTO de cómo la 37 vinculó
  `gestion_orden.cierre_id`. *Alternativa:* cierre de bodega derivado on-the-fly sin tabla. *Por qué
  tabla:* las features 41/42 necesitan persistir aprobación, bloqueos y alimentación de caja sobre
  una entidad estable con snapshot money-critical.

- **(b) Enum de estado.** *Recomendado:* **reusar** el enum `CierreEstado`
  (`solicitado`/`aprobado`/`rechazado`) de la feature 37 — semántica idéntica, sin nueva migración de
  enum. *Alternativa:* enum propio `CierreBodegaEstado`. *Por qué reusar:* los tres valores calzan
  exactamente y evita duplicar la máquina de estados; la fuente de verdad (`lib/types/cierre.ts`) ya
  existe.

- **(c) Qué `cierre_dia` se consolidan.** *Recomendado:* los `aprobado` de la zona
  (`destinoTipo = bodega_satelite`, `destinoZonaId = zona`) con `cierre_bodega_id IS NULL`. *Los
  `rechazado` se EXCLUYEN* (no bloquean el cierre de bodega; su re-solicitud/desbloqueo es de la
  feature 41). *Alternativa:* incluir también los rechazados o bloquear la bodega mientras haya
  rechazados. *Por qué se descarta:* un rechazado no aporta dinero cuadrado y su ciclo lo maneja la 41;
  incluirlo contaminaría el snapshot.

- **(d) Precondición de solicitar.** *Recomendado:* NO se puede solicitar si hay algún `cierre_dia`
  de la zona en estado `solicitado` (pendiente de que el adminSatelite lo resuelva); así se garantiza
  que la bodega cierra solo cuando todos sus mensajeros están resueltos (R6). *Alternativa:* permitir
  solicitar aunque queden `solicitado` pendientes. *Por qué:* la consolidación money-critical exige
  no dejar dinero de mensajeros sin resolver dentro del período que se cierra.

- **(e) Snapshot de totales agregados.** *Recomendado:* **snapshotear** los totales agregados por
  método + general en el `CierreBodega` al solicitar (dinero congelado para la aprobación del maestro
  y la caja de la 42). *Alternativa:* derivarlos on-the-fly sumando los cierre_dia al mostrar. *Por
  qué snapshot:* money-critical (mismo criterio que 37 §5.C / 38 alt. C): el maestro aprueba
  EXACTAMENTE el número congelado.

- **(f) Pago al mensajero en el detalle.** *Recomendado:* **omitir** el pago al mensajero por zona en
  la 40; es responsabilidad de la **feature 39**. Si el diseño de detalle deja un hueco, que sea un
  placeholder nulo documentado que la 39 llenará (R14). *Alternativa:* calcularlo aquí. *Por qué se
  descarta:* invade el alcance de la 39 (que además depende de la 24/tarifas por zona).

- **(g) Unicidad de cierre de bodega abierto.** *Recomendado:* a lo sumo UN `CierreBodega`
  `solicitado` por zona a la vez, garantizado por **índice único parcial**
  `WHERE estado='solicitado'` (espejo del índice parcial de `zona.esCentral`). *Alternativa:* validar
  solo en el service. *Por qué índice:* defensa a nivel DB contra doble solicitud concurrente.

- **(h) Qué ve el maestro.** *Recomendado:* cola de `solicitado` + histórico de solo lectura de
  `aprobado`/`rechazado` (patrón feature 38-c). *Alternativa:* solo la cola. *Por qué:* el maestro
  necesita consultar cierres de bodega ya resueltos (money/audit) sin salir del módulo.

- **(i) Motivo de rechazo obligatorio.** *Recomendado:* obligatorio y no vacío (R17), como en la 38.
  *Alternativa:* opcional. *Por qué:* la 41/adminSatelite necesita saber qué corregir para re-solicitar.

- **(j) Efecto del rechazo.** *Recomendado:* **inmutable** — el cierre de bodega pasa a `rechazado`
  y NO se desvinculan los `cierre_dia` (`cierre_bodega_id` intacto); el desbloqueo/re-solicitud de la
  bodega es de la feature 41 (R21). *Alternativa:* desvincular los `cierre_dia` (`cierre_bodega_id =
  null`) para re-consolidar de inmediato. *Por qué se descarta:* rompe la inmutabilidad del snapshot y
  pisa la responsabilidad de la 41. **Riesgo conocido:** hasta que caiga la 41, una bodega con cierre
  rechazado queda "trabada"; es la frontera de alcance esperada (igual que la 38 dejó al mensajero).

- **(k) Auditoría del maestro.** *Recomendado:* `resuelto_por` (FK usuario, `ON DELETE SET NULL`),
  `resuelto_at`, `motivo_rechazo` en `CierreBodega` (patrón exacto de la migración
  `cierre_dia_resolucion` de la 38). *Alternativa:* solo `updated_at`. *Por qué:* money-critical —
  QUIÉN aprobó/rechazó y el motivo deben quedar registrados.

- **(l) Módulo del maestro / del adminSatelite y E2E.**
  *Recomendado (ubicación):* **extender el módulo existente** `/cierres-admin` (feature 38) con una
  sección "Cierre de bodega": para el `adminSatelite`, un panel de consolidación + "Solicitar cierre
  de bodega" + histórico propio; para el `maestro`, la cola de cierres de bodega + histórico +
  detalle. Cohesión: ambos roles ya viven ahí para los cierres de mensajero. *Alternativa:* un módulo
  nuevo `/cierre-bodega`. *Recomendado (E2E):* AÑADIR un E2E Playwright del flujo completo
  (consolidar → solicitar → aprobar/rechazar), checkpoint de flujo de dinero (patrón 33/34/36/37/38).
  *Confirmar:* ¿extender `/cierres-admin` o módulo nuevo?
