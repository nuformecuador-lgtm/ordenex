# review_462 — Aviso a primera hora: reprogramados de hoy que esperan la aprobación de un cierre

> Reviewer independiente, 2026-09-25. Rama `origin/feature/462-frontend` @ `9d9284d0` (backend `6ae492b3`
> + Fase 3). Worktree propio con `git checkout --detach 9d9284d0`, `pnpm install --frozen-lockfile` propio (sin
> junction) y `prisma generate`. Base: clon `ordenex_462_rev` (`CREATE DATABASE … TEMPLATE ordenex_462`, 0
> conexiones a la plantilla en ese instante), `.env` del worktree apuntando a él; **borrado al terminar**
> (`DROP DATABASE`, comprobado). El gate completo ya estaba en verde en las dos bitácoras; no se repitió
> entero: se corrieron typecheck, las 22 suites de la ficha y las 4 de integración a mano.
>
> Herramientas: el índice del grafo (`R-job-singularis-projects-ordenex`) está rancio para esta ficha —
> `search_graph` no conoce ningún símbolo de la 462 y solo devuelve `liberar-reprogramadas`—, así que la
> lectura se hizo sobre los archivos reales (`git diff 39ad33c4 9d9284d0`, 97 archivos, +5857/−29).

## Veredicto: **APROBADO** (sin hallazgos bloqueantes; 6 menores, ninguno de código de producción roto)

## Checklist (CHECKPOINTS.md + encargo del leader)

| Punto | Estado | Evidencia |
|---|---|---|
| requirements.md con R1–R56 en EARS | ✓ | `specs/462-aviso-reprogramadas-esperan-cierre/requirements.md` |
| design.md con alternativas descartadas | ✓ | §11, siete alternativas (A–G) con su porqué |
| tasks.md con todas las tasks `[x]` | ✗ **menor** | 0 de 35 marcadas; T0–T3 y T4.1–T4.3 están hechas según las dos bitácoras, pero nadie tildó nada (H1) |
| Cada R mapea a un test concreto | ✓ | tabla abajo; se ejecutaron todos |
| `impl_462.md` con el mapa R→test | ✓ | `progress/impl_462.md` (backend) + `progress/impl_462_frontend.md` (Fase 3) |
| typecheck | ✓ | `pnpm exec tsc --noEmit` → `TSC_EXIT=0` |
| lint | ✓ (no repetido) | verde en `gate_462_frontend.log` (`INIT_EXIT=0`); el diff no toca config de lint |
| tests | ✓ | 22 archivos / **348** tests unit+componentes+guardias verdes; 4 archivos / **52** tests de integración contra Postgres real, **0 skipped** |
| E2E Playwright para flujo crítico | n/a | sin arnés E2E en el repo (memoria); recorrido manual con Playwright por 5 roles en `impl_462_frontend.md` y reproducción numérica por servicios en esta revisión |
| RLS en tablas nuevas | n/a | no hay tabla ni columna nueva: solo 2 valores de enum |
| Migración versionada y reversible | ✓ | `20260925130000_notificacion_evento_reprogramadas_esperan_cierre/{migration,down}.sql`; down DINÁMICO (P12 de la 459); 13 tests de integración, incluido el down ejecutado de verdad en tx revertida |
| Sin secretos hardcodeados | ✓ | `lib/config/reprogramadas-retenidas.ts` solo hora y roles; el cron sigue con `CRON_SECRET` |
| Webhooks nuevos con firma/idempotencia | n/a | no hay webhook; la dedupe del aviso la da el índice único (`entidad_id = ${ambito}:${diaCR}`), medida en `aviso-reprogramadas-dedupe.test.ts` |
| Controller sin queries ni negocio | ✓ | `lib/actions/reprogramadas-retenidas.ts` autoriza, construye y recorta; el route del cron enumera campos |
| Service sin HTTP | ✓ | `ReprogramadasRetenidasService` recibe `hoyCR` y repos por constructor |
| Repository solo Prisma | ✓ | `ReprogramadaRetenidaRepository` (solo lecturas; guardia `reprogramadas-retenidas-solo-lectura` verde) |
| Interfaces en `lib/interfaces/` | ✓ | `IReprogramadaRetenidaRepository.ts`, `IReprogramadasRetenidasService.ts` |
| Páginas protegidas validan en servidor | ✓ | `/ordenes` lee la franja solo si `esAccesoTotal(rol)`; la acción devuelve `forbidden` a tienda/satélite/mensajero (medido) |
| Componentes reciben datos por props | ✓ | `FranjaReprogramadasRetenidas` y `RetieneReprogramadasBadge` son puros |
| Mutaciones por Server Actions | ✓ | no hay mutaciones nuevas (ficha de solo lectura) |
| Sin país/moneda hardcodeados | ✓ | la hora CR está declarada como config con test que la ata a `vercel.json` |
| `./init.sh` en verde | ✓ (bitácora) | `progress/gate_462_frontend.log` `INIT_EXIT=0`, 2215 archivos, 31300 tests, 0 skipped en `integration/db` |
| `review_462.md` con veredicto OK | ✓ | este archivo |
| Entrada en `progress/history.md` | pendiente | se añade al cerrar la ficha (T5.4, fuera de rama de agente) |

## 1. Trazabilidad R1–R56 → test (todos ejecutados en esta revisión, todos verdes)

| R | Test que lo verifica (y que corrí) | Nota |
|---|---|---|
| R1, R2, R43, R47 | `tests/integration/db/462/reprogramadas-retenidas-sql-real.test.ts` (25 tests: A sol/ven/rec/sin cierre/ayer; NO aprobado, escritorio, futura, borrada, bodega, anulada, dos vivas; B sin cierre/sol/rec/ayer; NO aprobado, sin pendiente, `entregado`, futura, anulada, legada, dos pendientes, borrada, no `en_reparto`; R47 sin cierre → con cierre) | siembra anti-vacuidad (`formaA >= 7`, `formaB >= 6`) |
| R3 | mismo archivo, «R3: la Forma A del servicio ES el `esperandoCierre` del reloj» (reloj REAL sobre la misma base) | mi mutación M2 lo pone en rojo |
| R4 | `gestion-pendiente-unica-fuente.guardia` + `454/gestion-pendiente-sql-real.test.ts` (11 tests, las 3 columnas nuevas) | mi mutación M3 pone en rojo la 462 y la 454 a la vez |
| R5, R6, R7 | `tests/unit/services/reprogramadas-retenidas-service.test.ts` (15) + sql-real («ámbito», «R7») + reproducción numérica §3 | |
| R8, R20, R49 | `tests/unit/guards/reprogramadas-retenidas-solo-lectura.guardia.test.ts` (13) | `LiberacionReprogramadaService.ts` no está en el diff |
| R9, R10, R12, R18 | `tests/unit/services/avisos-diarios-service.test.ts` (22) + `462/aviso-reprogramadas-dedupe.test.ts` (3) | |
| R11 | `aviso-reprogramadas-dedupe.test.ts` (misma corrida → 0 filas nuevas; días distintos → distintas) | Postgres real, índice único |
| R13, R17 | `catalogo-avisos.test.ts` (título singular/plural a mano) + `emitir-reprogramadas-esperan-cierre.test.ts` (11; detalle a mano, sin dígitos/PII/«reprogramadas») | literales nuevos («paquetes») |
| R14, R15 | `vigencia-aviso-agregado.test.ts` (46) + `notificacion-service.test.ts` (41: oculta con 0, reaparece, sin número al fallar) | mis mutaciones M4 y M5 |
| R16 | `catalogo-avisos.test.ts` + `atajo-aviso-ruta-visible.guardia` (10) | `/cierres-admin`, sin parámetro |
| R19 | `notificacion-notificadores-reales.test.ts` (39: cron PASA notificador + conteo; campana; push; cierres-admin) | sobre fuente sin imports/comentarios |
| R21, R24 | `push-elegibles.test.ts` (27) + `reprogramadas-retenidas-config.test.ts` (6: hora ↔ `vercel.json`) | `ROLES_PUSH = ["admin","adminSatelite"]`, `0 13 * * *` |
| R22, R23, R25 | canal 410 sin cambios (`push-web-handler.ts` solo inyecta el conteo; `push-cableado-unico.guardia` 22 verde) | push no medible en local (sin VAPID), ver H6 |
| R26, R27, R28, R29, R30, R31, R51 | `cierres-admin-retenidas.test.ts` (10: UNA llamada por página, 0 en aprobado, alcance) + `CierresAdminRetieneReprogramadas.test.tsx` (7) + `RetieneReprogramadasBadge.test.tsx` (6) + `retiene-reprogramadas-labels.test.ts` (5) | `conPendiente` es el único camino de cola, histórico, detalle y «completo» (`CierresAdminService.ts:464/520/564/629/665/801`) |
| R32–R35, R38, R39 | `FranjaReprogramadasRetenidas.test.tsx` (10) + `impl_462_frontend.md` §R39 | |
| R36, R37 | `OrdenesPageFranjaRetenidas.test.tsx` (7) + `tests/unit/actions/reprogramadas-retenidas.test.ts` (9) | medido además por la acción real: tienda/satélite/mensajero `forbidden` |
| R40, R41, R42, R44, R45, R46 | sql-real (aprobado aún en `reprogramado` → 0 y el reloj lo libera; vencido y rechazado cuentan; satélite en su ámbito; fecha a hoy / a mañana) | |
| R48 | suites 276/315/371 verdes en el gate + guardia R20 | |
| R50 | `avisos-diarios-service.test.ts` (represadas intactas) | |
| R52 | `avisos-diarios-route.test.ts` (9) + emisor sin dígitos/uuid + franja/badge sin uuid | |
| R53 | `462/notificacion-evento-reprogramadas-migration.test.ts` (13) | up aditivo, down dinámico, indices sobreviven |
| R54 | sql-real, precondición anti-vacuidad | |
| R55 | sql-real: `SUM(retenidas)` del script = `resumen.total`, fila a fila por cierre | también corrí el script solo contra el clon: 10 ms, 0 filas (base sin retenidas) |
| R56 | `impl_462_frontend.md` §Recorrido (Playwright, 5 roles, con números) + §3 de este informe (mismos números por los servicios reales) | |

Ningún R sin test; ningún test vacío entre los leídos (los de integración comprueban la siembra antes de afirmar).

## 2. El conteo único (encargo 2)

- **Un solo ensamblaje.** Las cinco raíces (`app/api/cron/avisos-diarios/route.ts`, `lib/actions/notificaciones.ts`,
  `lib/services/jobs/push-web-handler.ts`, `lib/actions/cierres-admin.ts`, `lib/actions/reprogramadas-retenidas.ts`)
  llaman a `buildReprogramadasRetenidasService(prisma)` (`lib/services/reprogramadas-retenidas-composicion.ts`), y la
  guardia de `notificacion-notificadores-reales.test.ts` afirma que lo PASAN (no que lo importen). Campana y push:
  `contar`; marca: `contarPorCierre`; franja y cron: `resumen` + `recortarPorAmbito`. Los tres derivan del mismo
  `resumen` en memoria. La franja solo lee el DTO (`N = total`, `M = cierres.length`, `K = Σ sinCierre.cuantas`).
- **Sin otro cálculo ni otro predicado.** Forma A = `findOrdenesLiberables` (repo del reloj, mismo `where`, `select`
  aditivo `mensajeroAsignadoId`) filtrado con `!puedeLiberarse` importado de la 276. Forma B = `$queryRaw` que COMPONE
  `sqlUltimaGestionPendienteLateral` de la 454 (la LATERAL gana 3 columnas; el `WHERE` no cambia). Las guardias
  371 (`correccion-fecha-reprogramacion`) y 454 (`gestion-pendiente-unica-fuente`) siguen verdes.
- **Solo lectura.** `LiberacionReprogramadaService.ts`, `liberacion-al-aprobar-cierre.ts` y
  `liberacion-tras-corregir-fecha.ts` no están en el diff; la guardia de solo lectura (13 tests) afirma que ni el repo
  ni el servicio nuevos contienen verbos de escritura, y que el reloj/315/371 no nombran el evento.
- **Alcance por rol.** `AMBITO_RETENIDAS_POR_ROL = { maestro: central, admin: central, adminSatelite: zona }` (lista
  blanca; lo demás LANZA). La acción de la franja exige `esAccesoTotal`. Medido con la acción y el servicio reales
  (§3): maestro/admin 4, satélite 1, tienda/mensajero/satélite `forbidden` en `/ordenes`, tienda sin fila en la campana.

### Mutaciones propias (6; cada una en ROJO y revertida con `git checkout --`, árbol limpio comprobado tras cada una)

| # | Seam | Mutación | Tests en rojo |
|---|---|---|---|
| M1 | WHERE Forma B (`ReprogramadaRetenidaRepository.ts:76`) | `fecha_reprogramacion <= hoy` → `= hoy` | sql-real: 5 («la de AYER», anti-vacuidad, marca por cierre, ámbito, R55 `SUM = total`) |
| M2 | WHERE Forma A (`ReprogramadasRetenidasService.ts:140`) | `!puedeLiberarse(o)` → `!o.gestionEsVisitaReal \|\| !puedeLiberarse(o)` (cuenta la reprogramación de escritorio) | 6: unit «NO la de escritorio», sql-real R3 (≠ `esperandoCierre`), marca, R47, R55 suma y fila a fila |
| M3 | WHERE compartido 454 (`gestion-pendiente.ts:99`) | `"gpc"."estado" <> 'aprobado'` → `<> 'rechazado'` | 8: sql-real 462 (aprobado cuenta / rechazado no, ámbito, R55) + `454/gestion-pendiente-sql-real` (rechazado → pendiente, aprobado → no) |
| M4 | Alcance por rol (`VigenciaAvisoAgregadoService.ts:74`) | `adminSatelite: "zona"` → `"central"` | 2: vigencia «el adminSatelite pide SU zona» y «sin zona útil LANZA» |
| M5 | Apagado a 0 (`presentacion-aviso.ts:92`) | `cifra <= 0` → `cifra < 0` | 7 en `notificacion-service`: las dos de 462/R15 («cifra 0 → ni se ve ni cuenta», «vuelve a salir al subir») + 5 de 409/413 |
| M6 | Alcance del recorte (`IReprogramadasRetenidasService.ts:94`) | `recortarPorAmbito` devuelve `total: r.total` (global) | 6: unit «central no incluye satélite», «total es la suma», acción R44 y R35, sql-real ámbito y R7 |

Las 15 mutaciones del backend y las 4 del frontend (una por superficie) están documentadas en las bitácoras; las mías
son distintas (cota `=` en vez de quitarla; visita real en A; el predicado compartido; el mapa de roles;
`presentacionDe`; el total del recorte).

## 3. Reproducción numérica del recorrido (R7/R56) — por los servicios reales, siembra en tx revertida

Siembra: cierre central `solicitado` que retiene 2 (1 Forma A + 1 Forma B), cierre central `rechazado` con 1 (A),
cierre satélite `vencido` con 1 (A), 1 gestión pendiente sin cierre con fecha de hoy (B, central).

| Superficie | Cómo se leyó | Resultado |
|---|---|---|
| S1 campana | `NotificacionService.listar` con `VigenciaAvisoAgregadoService` + `buildReprogramadasRetenidasService` (misma composición que `lib/actions/notificaciones.ts`) | maestro: «Reprogramado para hoy: **4** paquetes esperan la aprobación de su cierre»; adminSatelite: «… **1** paquete espera …»; adminTienda: sin fila |
| S3 marca | `CierresAdminService.listarPendientes/HistoricoPaginado` del escenario 454 | cola maestro `solicitado:2`; cola satélite `vencido:1`; histórico maestro `rechazado:1` |
| S4 franja | `resumenReprogramadasRetenidasCentral` (acción real, deps inyectadas) | maestro y admin `ok` N=**4**, M=**2**, K=**1** (`solicitado:2`, `rechazado:1`); adminTienda, adminSatelite, mensajero → `forbidden` |
| Total del sistema | `resumen()` | 5 (`porForma` A=3, B=2); central 4 + satélite 1 |
| Apagado | aprobar los 3 cierres + anular la sin cierre → `contar(central)` = **0**, la fila desaparece del listado del maestro | R15/R40 |

Los cuatro números coinciden entre sí y con la tabla del recorrido de `impl_462_frontend.md`.

## 4. Textos (encargo 3)

- `nombres-estado-retirados.guardia` verde (9 tests) y `EXCEPCIONES` solo tiene las dos entradas previas (455/456); la
  de la 462 se retiró y queda un comentario que lo explica.
- Ningún literal visible de las cuatro superficies contiene «reprogramadas»: título «Reprogramado para hoy: N paquetes
  esperan…», detalle R17 «…marcados «Retiene paquetes reprogramados para hoy»…», marca «Retiene N paquetes
  reprogramados para hoy», franja «Hay N paquetes reprogramados para hoy que todavía no puedes asignar: faltan M
  cierres por aprobar.», estados en palabras (`ESTADO_LABEL`), uuid solo en el `href` (`hrefDetalleCierre`).

## 5. Push y hora (encargo 4)

- `reprogramadasRetenidasConfig.ROLES_PUSH = ["admin", "adminSatelite"]`; `PUSH_ELEGIBLE.reprogramadas_esperan_cierre`
  lee esa lista (test que lo afirma sobre el fuente). El `maestro` recibe la fila de campana (destinatario central) y
  NO es elegible: decisión del humano respetada.
- `HORA_EMISION_CR = { 7, 0 }` → `cronUtcDeHoraCR` = `"0 13 * * *"`; `vercel.json` (`/api/cron/avisos-diarios`) dice
  `0 13 * * *` y no cambió en el diff. El cupo (usuario, evento, jornada) y el filtro leído/descartado son del canal 410,
  sin cambios.

## 6. Rendimiento (encargo 5) — medido con `log: query` de Prisma sobre el clon (86 órdenes, 7 `en_reparto`, 2 `reprogramado`)

| Llamada | Consultas | Por tabla | Tiempo local |
|---|---|---|---|
| `contar(central)` con retenidas | **10** | `orden` 2 (A `findMany` + B raw), `gestion_orden` 2, `cierre_dia` 2, `orden_historial_estado` 1, `usuario` 2, `zona` 1 | 7–40 ms |
| `contar(zona)` / `contarPorCierre` / `resumen` | 10 | idénticas (derivan del mismo `resumen`) | 7–9 ms |
| `contar(central)` con **0** retenidas (pero con candidatas del reloj en la base) | 5 | A 4 + B 1 | 6 ms |
| Sondeo completo de la campana (`listar`) — maestro/admin con el aviso vivo | **12** = 2 base + 10 | | 10 ms |
| Sondeo de la campana — adminTienda (sin fila de la 462) | 2 | | 5 ms |
| Sondeo — maestro con la fila del día pero cifra 0 | 7 = 2 + 5 | | 8 ms |
| Página de cola de `/cierres-admin` (maestro) | 15 (antes ~5) | una llamada por página | 24 ms |

Frecuencia: `useNotificaciones` sondea cada **60 s** (`notificacionesConfig.REFRESH_INTERVAL_MS`) y revalida al recuperar
el foco. La cifra se resuelve **una vez por evento y sondeo** (`cifrasVivas` deduplica), así que las filas apiladas de
días consecutivos (decisión 5) no multiplican el coste. El coste existe mientras haya **una fila del evento en la
ventana de 30 días**, aunque la cifra sea 0 (5 consultas), no solo mientras haya retenidas.

Con **5 admins conectados**: 5 sondeos/min × 10 = **50 consultas/min ≈ 0,8/s** (25/min ≈ 0,4/s con cifra 0), todas
por índice sobre poblaciones de decenas de filas; la 409 aceptó 2 por sondeo y esto son 10. En cifras absolutas no
compromete a Postgres ni al pooler (6543), pero es el **doble de lo que el design declaró (~5)** y **6×** el sondeo base
de la campana. La causa no es el predicado: es que Prisma parte el `select` anidado de `findOrdenesLiberables` en 4
consultas (orden, gestiones, cierre, historial) y `findCierresQueRetienen` en 3 (cierre, mensajero, gestiones para la
jornada), más `findMensajeros` y la zona central.

**Veredicto: aceptable, no bloqueante (H2, menor).** Optimización mínima y concreta, en orden de coste/beneficio:

1. **Camino ligero para `contar`** (solo `lib/services/ReprogramadasRetenidasService.ts` + un método del repo): la campana no
   necesita nombres de mensajero ni jornadas. `contar` → `retenidas()` + `findDestinoDeCierres(ids)` (un `findMany` de
   `cierre_dia` con `select: { id, estado, destinoTipo, destinoZonaId }`, sin relaciones) + zona central solo si hay
   «sin cierre». Ahorra `usuario` ×2 y `gestion_orden` ×1: **10 → 7** por sondeo, sin cambiar el contrato ni la regla, y
   el test de R7 (`contar` = `recortarPorAmbito(resumen).total`) sigue midiendo que dan lo mismo.
2. Segundo paso, si se quiere bajar más: exportar la correlación «gestión reprogramada vigente» como fragmento
   `Prisma.sql` desde `gestion-reprogramada-vigente.ts` (el mismo patrón que la 454 hizo con `sqlUltimaGestionPendienteLateral`)
   y que la Forma A sea **una** consulta en vez de cuatro → ~4 por sondeo. Es la única vía compatible con la guardia 371:
   un `SELECT count(*)` nuevo escrito a mano en `lib/**` sería una segunda correlación y la pondría en rojo.
3. Lo que NO conviene: cachear la cifra en memoria (serverless, y un número rancio es justo lo que la 409 evita) ni
   alargar `REFRESH_INTERVAL_MS` (afecta a toda la campana).

## 7. La 454 en la misma rama (encargo 6)

La Forma B distingue las `en_reparto` normales de las retenidas por construcción: la LATERAL de la 454 devuelve la
gestión PENDIENTE más reciente (no anulada, con `gestion_registrada`, cierre no aprobado) o **ninguna fila**; una
`en_reparto` sin gestión pendiente cae en `gp.resultado IS NULL` y no pasa el `WHERE`. Medido en sql-real: `b4`
(`en_reparto` sin pendiente), `b5` (pendiente `entregado` con fecha de hoy), `b8` (legada sin evento), `b9i` (la más
reciente es `entregado`), `b14` (misma gestión pero la orden ya no está `en_reparto`) → ninguna cuenta; `b2`, `b11`,
`b12`, `b9ii`, `b13` cuentan. Mi M3 confirma que el predicado que decide es el compartido (poner rojo uno pone rojo los dos
archivos). `porForma.enReparto` = 2 en mi siembra (las dos B), y el reloj real liberó la del cierre aprobado dejando
quieta la retenida (R48).

## 8. Hallazgos

| # | Etiqueta | Hallazgo | Qué falta |
|---|---|---|---|
| H1 | menor | `specs/462-…/tasks.md`: **0 de 35** tasks marcadas `[x]` (T0–T3 y T4.1–T4.3 están hechas y evidenciadas en las bitácoras; T4.4 es este informe; T5.x son de release) | Tildar T0.1–T4.4 con nota fechada antes de pasar la ficha a `done` (CHECKPOINTS §Especificación) |
| H2 | menor | Rendimiento: 10 consultas por sondeo y admin con el aviso vivo (5 con cifra 0 mientras exista la fila del día), el doble de lo declarado en design §2.1 | Aplicar la optimización 1 de §6 (camino ligero de `contar`, 10 → 7) en una ficha corta o antes de la release; medir después con el mismo método |
| H3 | menor | Deriva de spec: requirements R13/R17/R27/R32/R34 y el comentario de `lib/types/notificacion.ts:147` conservan los literales viejos («N órdenes esperan…», «reprogramadas de hoy»); el código y los tests llevan los aprobados («paquetes reprogramados para hoy») | Anotar en requirements.md la decisión del leader (2026-09-25) con los literales vigentes y corregir el comentario, para que el spec siga siendo la fuente |
| H4 | menor | `recortarPorAmbito` devuelve `porForma` **global** dentro de un resumen recortado (solo lo usan R3 y los tests; la franja no lo lee) | Documentarlo en el tipo o recortarlo también; no afecta a ninguna cifra visible |
| H5 | menor | `progress/history.md` sin entrada de la 462 | Añadirla al cerrar (T5.4), fuera de rama de agente |
| H6 | menor | El push (R22/R23/R25) no se pudo medir en local (sin claves VAPID); queda cubierto por `push-elegibles.test.ts` y el canal 410 sin cambios | Comprobar en la primera corrida de las 07:00 CR en prod (T5.3) que llega a admin/adminSatelite y no al maestro |

Ningún hallazgo es BLOQUEANTE: los requisitos tienen test real y ejecutado, el conteo es único y de solo lectura, el
alcance por rol y el apagado a 0 mueren con mutaciones propias, los textos cumplen la 455 sin excepciones, el push y la
hora coinciden con lo decidido, y la migración es reversible y está probada contra Postgres.

## Veredicto final: **APROBADO**
