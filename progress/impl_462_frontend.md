# impl_462 — Aviso a primera hora: reprogramados de hoy que esperan la aprobación de un cierre (FRONTEND)

> Bitácora del `frontend_dev`, 2026-09-25. Rama `feature/462-frontend` (nace de `origin/dev` @ `6ae492b3`,
> el commit de la bitácora del backend). Base de pruebas: el clon `ordenex_462` (`.env` copiado del worktree
> del backend sin imprimirlo; `prisma migrate status` → «Database schema is up to date!»). `pnpm install`
> propio (sin junction) y `prisma generate`. Alcance: Fase 3 (pantallas) + la Fase 4 que se puede hacer en
> local (T4.1 recorrido, T4.2 cron a mano, T4.3 medición de la campana) de
> `specs/462-aviso-reprogramadas-esperan-cierre/tasks.md`. La bitácora del backend es `progress/impl_462.md`.

## Decisión del leader que prevalece sobre el spec (BLOQUEO 1 del backend, resuelto)

**Ningún texto visible usa el plural femenino retirado «reprogramadas»** (455 §0.3). Se habla del PAQUETE
en masculino, con el nombre vigente del estado («Reprogramado») como adjetivo. Textos exactos, en las
cuatro superficies (y los literales de requirements R13/R17/R27/R32/R34 quedan superados por estos):

| Superficie | Texto |
|---|---|
| S1 campana / S2 push (título) | «Reprogramado para hoy: 1 paquete espera la aprobación de su cierre» / «Reprogramado para hoy: N paquetes esperan la aprobación de su cierre» |
| S1/S2 detalle persistido (R17) | «No se pueden asignar hasta que se apruebe el cierre del mensajero que los visitó. Revisa los cierres marcados «Retiene paquetes reprogramados para hoy» y apruébalos antes de asignar.» |
| S3 marca (R27) | «Retiene 1 paquete reprogramado para hoy» / «Retiene N paquetes reprogramados para hoy»; nota (`title` y nombre accesible): «N paquete(s) reprogramado(s) para hoy no se puede(n) asignar hasta que se apruebe este cierre.» |
| S4 franja (R32) | «Hay 1 paquete reprogramado para hoy que todavía no puedes asignar: falta 1 cierre por aprobar.» / «Hay N paquetes reprogramados para hoy que todavía no puedes asignar: faltan M cierres por aprobar.» |
| S4 franja (R34, K sin cierre con M > 0) | «1 de ellos es de un mensajero que todavía no envió su cierre.» / «K de ellos son de mensajeros que todavía no enviaron su cierre.» |
| S4 franja (R34, M = 0) | «Hay N paquete(s) reprogramado(s) para hoy que todavía no puedes asignar: su mensajero todavía no envió el cierre.» (un mensajero) / «…: sus mensajeros todavía no enviaron el cierre.» (varios) |
| S4 lista de cierres (R33) | «{mensajero} · {jornada en palabras o «cierre del día»} · {Solicitado/Vencido/Rechazado} · retiene N paquete(s)», cada línea enlaza a `/cierres-admin?cierre=<id>` (id solo en el `href`) |
| S4 atajo (R16) | «Revisar cierres» → `/cierres-admin` |

Cambios de backend autorizados por el leader para esto: `lib/notificaciones/catalogo-avisos.ts` (título),
`lib/notificaciones/emitir.ts` (literal R17) y la **retirada de la excepción** que la Fase 2 había declarado
en `tests/unit/guards/nombres-estado-retirados.guardia.test.ts`. La guardia queda verde **sin excepción
alguna** para la ficha (medido: 8 suites / 170 tests verdes tras retirarla).

## Los números salen del conteo único (R7)

Ninguna superficie calcula nada: la marca pinta `CierreAdminResumen.reprogramadasRetenidasHoy` (una lectura
por página, `contarPorCierre`); la franja lee `ResumenRetenidas` ya recortado al ámbito central por la
Server Action (`N = total`, `M = cierres.length`, `K = Σ sinCierre.cuantas`); la campana y el push llevan
la cifra viva de `contar`. El test de la franja afirma explícitamente que `N` es el `total` del servidor y
no una suma del navegador (R38).

## Archivos

**Nuevos:** `app/(app)/cierres-admin/_components/RetieneReprogramadasBadge.tsx`,
`app/(app)/ordenes/_components/FranjaReprogramadasRetenidas.tsx`,
`tests/unit/components/retiene-reprogramadas-labels.test.ts`, `tests/components/RetieneReprogramadasBadge.test.tsx`,
`tests/components/CierresAdminRetieneReprogramadas.test.tsx`, `tests/components/FranjaReprogramadasRetenidas.test.tsx`,
`tests/components/OrdenesPageFranjaRetenidas.test.tsx`.

**Modificados:** `app/(app)/cierres-admin/_components/cierre-labels.ts` (+`retieneReprogramadas`,
+`notaRetieneReprogramadas`; sigue PURO), `app/(app)/cierres-admin/_components/cierre-factura.tsx` (marca en
el `rotulo` de `CierreFacturaResumen` y en la cabecera de `CierreFacturaDetalle`; `CierreFacturaCabecera`
gana `reprogramadasRetenidasHoy?`), `app/(app)/ordenes/page.tsx` (bloque de la franja),
`lib/actions/reprogramadas-retenidas.ts` (se retira `@sin-superficie`: ya tiene superficie),
`lib/notificaciones/{catalogo-avisos,emitir}.ts` (literales), `tests/unit/guards/nombres-estado-retirados.guardia.test.ts`
(excepción retirada), `tests/unit/notificaciones/{catalogo-avisos,emitir-reprogramadas-esperan-cierre}.test.ts`
y `tests/unit/services/notificacion-service.test.ts` (literales a mano actualizados),
`tests/components/{OrdenesPage,OrdenesPageFiltros,OrdenesRutearSatelite}.test.tsx` (**cambio de arnés**: doble
de la acción nueva, ninguna aserción tocada — ver «Hallazgos»).

**Fuera de git (un solo uso, borrados al terminar):** `scripts/tmp-462-recorrido.ts` (siembra/estado/limpieza
del caso real en el clon) y `recorrido462.cjs` en el scratchpad (Playwright).

## Desvíos del design, anotados

1. **La cabecera del detalle vive en `cierre-factura.tsx`, no en `cierre-detalle-shared.tsx`.** El design
   (§5.2) situaba la marca del detalle en `cierre-detalle-shared.tsx`; en el archivo real la cabecera que
   el admin ve al abrir un cierre es la de `CierreFacturaDetalle` (`cierre-factura.tsx`, junto a
   `EstadoCierreBadge`). Se montó ahí. `CierreFacturaCabecera` gana el campo opcional; la vista del
   mensajero (`CierrePasadoDTO`) no lo trae y no pinta nada.
2. **Un solo montaje cubre cola e histórico.** Las dos listas pintan el MISMO comprobante compacto
   (`CierreFacturaResumen`); la marca va en su `rotulo` una vez, y el test del histórico afirma que un
   `rechazado` con 2 la lleva exactamente una vez y el `aprobado` con 0 ninguna. No se tocó
   `CierresAdminHistoricoLista.tsx`.
3. **La franja es `role="region"` con nombre, no el `role="alert"` por defecto de la primitiva `Alert`**:
   es un bloque presente al cargar, no un suceso que interrumpir. Estilo con tokens `warning` (`-soft`
   fondo, base borde, `-strong` texto, `dark:bg-warning/15`), sin hex.
4. **R37 registra con causa**: `defaultLogger.logError(new Error("ordenes/page: …", { cause }))`; el test
   de la página lo afirma con un espía de `console.error`. `forbidden`/`unauthenticated` → `null` sin log.

## R39 — la franja es un bloque removible

Quitarla es borrar `FranjaReprogramadasRetenidas.tsx` + `lib/actions/reprogramadas-retenidas.ts` y, en
`page.tsx`, 3 imports, la función `resolverRetenidasCentral` (14 líneas) y 2 líneas de render. Nada del
listado ni de las otras tres superficies cambia.

## Mapa R → test (los que la Fase 3 completa; el resto está en `impl_462.md`)

| R | Test |
|---|---|
| R13 (título, textos nuevos) | `catalogo-avisos.test.ts` (1/4/12, a mano) + `notificacion-service.test.ts` (título vivo con 4) |
| R17 (detalle) | `emitir-reprogramadas-esperan-cierre.test.ts` (literal a mano; sin dígitos, PII ni «reprogramadas») |
| R27 | `retiene-reprogramadas-labels.test.ts` (singular/plural/nota a mano) + `RetieneReprogramadasBadge.test.tsx` (0/null/undefined → nada; 1 y 3; aria-label/title; variante `warning`) + `CierresAdminRetieneReprogramadas.test.tsx` (cola, histórico, cabecera del detalle) |
| R28 | `CierresAdminRetieneReprogramadas.test.tsx` («exactamente UNA marca: rechazado con 2, aprobado con 0») |
| R29 | mismo archivo (botonera «Aprobar»/«Ver» y «Bloqueante hasta re-solicitud» intactos) + 11 suites previas de cierres-admin verdes sin editar |
| R32, R34 | `FranjaReprogramadasRetenidas.test.tsx` (las tres frases, singular y plural, a mano) |
| R33 | mismo archivo (una línea por cierre, `href` con el uuid, texto sin uuid, «cierre del día», estados en palabras) |
| R35, R37 | franja (`null`/0 → nada) + `OrdenesPageFranjaRetenidas.test.tsx` (acción que revienta → sin franja, tabla intacta, `console.error` con «ordenes/page … franja de reprogramados retenidos»; `forbidden` → sin franja y sin log) |
| R36 | `OrdenesPageFranjaRetenidas.test.tsx` («adminTienda: la lectura NO se dispara»; sin sesión tampoco) + `OrdenesPage.test.tsx` (mensajero/adminSatelite → `notFound`, previo) |
| R38, R7 | franja («N es `total` tal como llega») |
| R39 | esta bitácora (sección anterior) |
| R16 | franja («Revisar cierres» → `/cierres-admin`) + catálogo |
| R41, R42 | franja («Rechazado» en la lista) + `CierresAdminRetieneReprogramadas.test.tsx` («vencido» con marca) |
| R52 | franja y badge (sin uuid ni guía en el texto; `innerHTML` sin «reprogramadas») |
| R56 | §Recorrido, abajo |

## Mutaciones — una por superficie, cada una en ROJO y revertida (medidas juntas en una corrida; 12 rojos, atribuibles sin solape)

| Superficie | Mutación | Tests en rojo |
|---|---|---|
| S1 campana (y S2 push, mismo título) | `tituloReprogramadasEsperanCierre` plural con «órdenes» en vez de «paquetes» | `catalogo-avisos` «462/R13 … literales a mano»; `notificacion-service` «la MISMA fila vuelve a salir … con el titulo vivo» (2) |
| S3 marca | `RetieneReprogramadasBadge`: guarda `cuantas <= 0` → `cuantas < 0` (pinta con 0) | `RetieneReprogramadasBadge` «con 0, null o undefined no renderiza NADA»; `CierresAdminRetieneReprogramadas` «con 1 el singular; con 0 o SIN el campo…» y «exactamente UNA marca…» (3) |
| S4 franja | `M = cierres.length + sinCierre.length` (las «sin cierre» contadas como cierres) | `FranjaReprogramadasRetenidas` ×4 («plural con K», «K plural», «varios mensajeros», «un solo mensajero») + `OrdenesPageFranjaRetenidas` maestro y admin (frase N=4, M=2) (6) |
| S4 cableado de la página (design §8.2-13) | `page.tsx`: `rol && esAccesoTotal(rol)` → `rol` | `OrdenesPageFranjaRetenidas` «⭑ adminTienda: la lectura NO se dispara» (1) |

Tras revertir: `git status` limpio respecto al commit y las 6 suites verdes (91 tests).

## Hallazgos

- **Dependencia oculta de base en tests de página.** Con la acción real importada por `page.tsx`, los casos
  de `OrdenesPage.test.tsx` con `admin`/`maestro` pasaban en verde **consultando la base local** (vitest
  carga `.env`, `resolveActorFromSession` está doblado a admin y ningún `[AppError]` salió en la consola).
  Se añadió el doble de `@/lib/actions/reprogramadas-retenidas` a los tres archivos que renderizan la
  página con esos roles (`OrdenesPage`, `OrdenesPageFiltros`, `OrdenesRutearSatelite`): cambio de arnés,
  igual que el de `filtros-ordenes` en la 144; ninguna aserción se tocó.
- En la rama de `OrdenesListado` la tabla aparece tras el primer `await` de SWR: los tests de la página
  esperan con `findByRole("table")`.

## Salidas reales

- `pnpm exec tsc --noEmit` → `TSC_EXIT=0`.
- `pnpm exec eslint <14 archivos de la fase>` → 0 errores, 0 avisos.
- Suites de la fase: `retiene-reprogramadas-labels` (5), `RetieneReprogramadasBadge` (6),
  `CierresAdminRetieneReprogramadas` (7), `FranjaReprogramadasRetenidas` (10), `OrdenesPageFranjaRetenidas`
  (7) — verdes. Guardias y suites afectadas: `nombres-estado-retirados`, `superficie-de-uso`,
  `catalogo-avisos`, `emitir-reprogramadas-esperan-cierre`, `notificacion-service`, `factura-contraste`,
  `cierre-detalle-superficies`, `estado-con-info` → 8 archivos / 170 tests verdes. Componentes previos que
  renderizan la página o el comprobante: 11 archivos / 190 tests verdes.

## Recorrido por rol (T4.1, R56/R7) — medido con Playwright contra el dev server local, 2026-09-25

**Siembra en el clon `ordenex_462`** (script de un solo uso, borrado después; todo con `cierre_detail`
congelado para que 69/R14 deje aprobar): 1 cierre central `solicitado` de «462R Andres Central» que
retiene 2 (guía 462000101, Forma A en `reprogramado` con visita real; guía 462000102, Forma B en
`en_reparto` con gestión pendiente); 1 cierre central `rechazado` de «462R Rosa Rechazada» que retiene 1
(462000103, Forma A); 1 cierre satélite (Quepos) `vencido` de «462R Sofia Satelite» que retiene 1
(462000104, Forma A); 1 gestión sin cierre de «462R Nico Sin Cierre» con fecha de hoy (462000105, Forma B).
Esperado: central 4 (2 cierres + 1 sin cierre), satélite 1. Los modales que se abren solos al entrar
(«Confirmá el SINPE de GAM/Quepos») se cerraron antes de medir.

| Rol | S1 campana | S3 marcas en `/cierres-admin` | S4 franja en `/ordenes` |
|---|---|---|---|
| **maestro** | «Reprogramado para hoy: **4** paquetes esperan la aprobación de su cierre» + detalle R17 + «Revisar cierres» | Andres **2**, Rosa (rechazado, en Resueltos) **1**; ninguna en el satélite (no lo ve) | «Hay **4** paquetes reprogramados para hoy que todavía no puedes asignar: faltan **2** cierres por aprobar.» + «**1** de ellos es de un mensajero que todavía no envió su cierre.» + 2 líneas enlazadas (`?cierre=<uuid>` solo en el `href`) + «Revisar cierres»; antes de la tabla |
| **admin** | idéntico al maestro (**4**) | idéntico (**2** y **1**) | idéntico (**4**, **2**, **1**); la captura de la franja (estado posterior a la aprobación, en el scratchpad de la sesión) confirma el bloque `warning` con icono, frase, línea de K, enlace por cierre y «Revisar cierres» |
| **adminSatelite** (Quepos) | «Reprogramado para hoy: **1** paquete espera la aprobación de su cierre» | Sofia (`vencido`) **1** | `/ordenes` → **404** (`notFound`, sin franja) |
| **adminTienda** | campana «1 por hacer», **sin** el aviso de esta ficha | `/cierres-admin` → 404 | `/ordenes` 200, **sin** franja (la lectura no se ejecuta) |
| **mensajero** | campana **sin** el aviso de esta ficha | 404 | 404 |

R7: para un mismo alcance las tres superficies visibles dan la misma cifra (central 4 = marcas 2+1 + 1
sin cierre; satélite 1 = marca 1). El texto y el estado del cierre en la franja son en palabras
(«Solicitado», «Rechazado»), la jornada «24 de septiembre», y ningún uuid ni guía aparece en el texto.

**Aprobar el `solicitado` por la UI** (admin: «Ver / decidir» → detalle con la marca «Retiene 2…» junto
al estado → «Aprobar» → confirmación física tecleando 462000101 y 462000102 → «Confirmar y aprobar» →
toast «Cierre aprobado correctamente.»). Después, en la siguiente lectura:

| Qué | Antes | Después |
|---|---|---|
| Órdenes 462000101 (A) y 462000102 (B) | `reprogramado` / `en_reparto` | **`en_bodega_central`** las dos (liberadas por el timbre 315 / la aplicación de la 454) |
| Cierre de Andres | `solicitado`, marca **2** | `aprobado`, **sin marca** |
| Franja de admin | «Hay 4 … faltan 2 cierres» | «Hay **2** paquetes … **falta 1 cierre** por aprobar.» + «1 de ellos…» + solo la línea de Rosa |
| Campana de admin | «4 paquetes esperan» | «**2** paquetes esperan» — **la misma fila** (`hace 14 min`), sin emitir una segunda (R11/R15/R40) |
| Campana del satélite | «1 paquete espera» | «1 paquete espera» (intacta: R44) |

Estado en base tras aprobar: 3 filas de aviso en total (`central:2026-09-25` para `maestro` y `admin`,
`<zonaQuepos>:2026-09-25` para `adminSatelite`), 0 lecturas, ninguna fila nueva.

## Cron a mano (T4.2)

`GET /api/cron/avisos-diarios` con `Authorization: Bearer <CRON_SECRET>` → **200**, cuerpo solo con
conteos y la fecha CR (R52): `{"fecha":"2026-09-25","tiendasConNovedades":1,"avisosNovedadesEmitidos":1,
"ordenesRepresadas":0,"zonasConRepresadas":0,"avisosRepresadasEmitidos":0,"reprogramadasRetenidas":5,
"ambitosConRetenidas":2,"avisosRetenidasEmitidos":2,"fallos":0}`. Filas creadas: exactamente una por
destinatario y ámbito (maestro y admin en `central:2026-09-25`; adminSatelite en `<zonaId>:2026-09-25`),
con `descripcion` = el literal R17 nuevo. **Push:** `jobsPush: []` — el `.env` local no tiene claves VAPID
(`VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` ausentes), así que el cupo (usuario, evento, jornada) para
admin/adminSatelite y la exclusión del maestro **no se pudieron medir en local**; quedan cubiertos por
`push-elegibles.test.ts` y el canal 410 (`notificacion-repo-con-push.test.ts`).

## Campana abierta 5 minutos con el aviso vivo (T4.3)

Dev server con `PRISMA_LOG_QUERIES=sql`; admin con la campana abierta en `/ordenes`, 300 s sin tocar
nada: **5 sondeos** (uno cada 60 s, `REFRESH_INTERVAL_MS`) y **81 consultas** → **16,2 por sondeo**. Por
tabla y sondeo: `rol` 1, `notificacion` 1, `notificacion_lectura` 1, `Session` ~1,6, `usuario` ~3,6,
`orden` 1, `gestion_orden` 2, `cierre_dia` 2, `orden_historial_estado` 1, `zona` 1, raw de la Forma B 1.
Atribuibles al conteo de retenidas: **~10 por sondeo** (Forma A: `orden` + `gestion_orden` +
`cierre_dia` + `orden_historial_estado` = 4 porque Prisma carga cada relación aparte; Forma B: 1 raw;
cierres: `cierre_dia` + `gestion_orden` = 2; nombres de mensajero: `usuario` 1-2; zona central: 1). Es
**más de lo declarado en design §2.1 (~5)**. La optimización que el design deja escrita —que `contar` no
pida nombres de mensajero ni jornadas— ahorra 2-3 consultas por sondeo y es un cambio de
`lib/services/ReprogramadasRetenidasService.ts` (backend): **no se aplicó desde el frontend; se eleva al
leader** con este número para que decida si entra antes de cerrar (tasks T4.3).

## Gate completo (`./init.sh`, contra `ordenex_462`, dev server ya matado, `.next/dev` borrado, sin `tail`, `INIT_EXIT` dentro del log)

| Corrida | Log | Resultado | Qué pasó |
|---|---|---|---|
| #1 | `progress/gate_462_frontend_1.log` | `INIT_EXIT=1`, 3 archivos / 4 tests rojos: los controles «SIN filas del evento nuevo, ese MISMO down corre entero» de `notificacion-evento-{bloqueo-cierre,gasto-fijo,webhook-suscripcion}-migration` (271/333/403) | **Artefacto del recorrido, no de la ficha**: `22P02 … «novedades_sin_gestionar»`. El cron corrido a mano (T4.2) emitió también UN `novedades_sin_gestionar` (evento de la 409, posterior a las fotos de lista fija de esos `down.sql`) y mi limpieza solo borró las filas de `reprogramadas_esperan_cierre`. Con la base tal como la dejó el backend, esos mismos tests estaban verdes (`gate_462_backend.log`). Se midió y borró exactamente 1 fila (script de un solo uso, ya eliminado). Al relanzar los tres archivos juntos, el de la 333 volvió a salir rojo una vez y verde en solitario (20/20): flake de concurrencia de los tres tests que recrean el mismo enum en paralelo (memoria «gate rojo: cuatro modos de flake»); en la corrida #2 pasó junto a todos. |
| #2 | `progress/gate_462_frontend.log` | **`INIT_EXIT=0`** — `== init OK ==` | `✓ typecheck paso`, `✓ lint paso`, `Test Files 2215 passed (2215)`, `Tests 31300 passed | 26 skipped (31326)` (los 26, `AnaliticaPage`/`AnaliticaShell`, previos), `✓ tests: sin rojos nuevos`, **0 `skipped` en `tests/integration/db`**, los 3 de `db/462` (13 + 25 + 3) y los 5 archivos de esta fase (7 + 7 + 10 + 6 + 5) ✓. Aviso previo ajeno: «migraciones sin down.sql: 20260814120000_ruta_optimizada_trazado, …». Duración 791 s. |

## Veredicto

Fase 3 implementada sobre el conteo único, con los textos en masculino decididos por el leader en las
cuatro superficies y la guardia de nombres retirados verde sin excepciones; 4 mutaciones (una por
superficie) en rojo y revertidas; recorrido por los cinco roles con números que coinciden entre campana,
marca y franja, y que bajan solos al aprobar el cierre por la UI; cron a mano con 3 filas y respuesta sin
ids; campana medida en 16,2 consultas/sondeo (~10 del conteo, por encima de las ~5 del design: decisión
del leader si aplicar la optimización de `contar` en el backend); gate completo en verde (`INIT_EXIT=0`).
Push no medible en local (sin claves VAPID).
