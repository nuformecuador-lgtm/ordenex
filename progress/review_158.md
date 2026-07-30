# Feature 158 — Review del PR 1 de 2 (camino del MENSAJERO, R1-R36)

> Rama `feature/158-incidente-indemnizacion`, worktree `.claude/worktrees/lote-135`, HEAD `09f049f`.
> Base de comparación: `21400f7` (merge de `dev`, PR #207).
> Alcance revisado: **R1-R36** (camino del mensajero). **R37-R64 (camino del ADMIN) quedan FUERA
> por decisión del humano (Q-L, dos PRs) y NO se reclaman como faltantes**; sí se verificó que no
> se colaran.

---

## VEREDICTO: **OK**

**0 bloqueantes · 10 menores.** 36 de 36 requisitos del alcance verificados hasta un test concreto.
**17 mutaciones propias + 3 sondas contra Postgres local: las 17 discriminan.**

No se editó ni una línea de código de producción ni de test. Todas las mutaciones se aplicaron y
se revirtieron; `git status` quedó limpio antes y después de cada una, y al cerrar este review.

---

## 1. Verificación ejecutable (corrida por el reviewer, no leída de la bitácora)

| Comando | Resultado |
| --- | --- |
| `./init.sh` | **verde**. typecheck OK · lint **0 errores / 19 warnings** (los 19 del baseline) · **616 archivos / 6936 tests / 0 fallos** · todas las migraciones con `down.sql` · `.env` presente. Coincide exactamente con lo que declara `impl_158_frontend.md`. |
| `pnpm exec next build` | **exit 0**. Compiló, pasó TypeScript y generó las 37 páginas. Es la comprobación que la 156 incorporó para los límites cliente/servidor: **no hay fuga de módulo servidor a componente cliente** pese a las Server Actions nuevas y a que `cierre-detalle-shared.tsx` importa ahora un módulo de `mis-asignaciones/_components/`. |
| `pnpm exec vitest run tests/integration/db` | **72 archivos / 715 tests / 0 fallos** (lo que exige la regla del lote y Q-F). |
| `pnpm exec prisma migrate status` | «Database schema is up to date!», **96 migraciones**, host `localhost:5432`, base `ordenex`. Sin drift contra `schema.prisma`. Producción no se tocó. |
| Introspección de la base viva | `gestion_resultado` = 5 valores (`+incidente`) · `wallet_movimiento_categoria` = 15 (`+egreso_indemnizacion`) · `gestion_causa_incidente` = `danado,perdido,robado` · `gestion_orden.indemnizacion` = `numeric(12,2)` · **`wallet_origen_tipo` sigue en 6 valores** · RLS `gestion_orden`/`wallet_movimiento` = `true` con **0 policies** (igual que antes) · los 5 índices de `wallet_movimiento` presentes, incluido el parcial `wallet_movimiento_origen_categoria_uq`. |

---

## 2. CHECKPOINTS.md, punto por punto

### Especificación
- [x] `requirements.md` con EARS numerados `R1`…`R64`.
- [x] `design.md` con alternativas descartadas y su porqué — **13** (§9.1-§9.13), no una.
- [~] `tasks.md` con todas las tasks `[x]`: **34 de 57**. **Aplicable sólo al alcance de este PR.**
      Verificado uno a uno: las 34 marcadas son EXACTAMENTE Fase 0 (T0.1-T0.8), Fase 1
      (T1.1-T1.18 incl. T1.6b/T1.6c) y Fase 2 (T2.1-T2.6). Las 23 sin marcar son Fase 1B
      (T1.19-T1.32) y Fase 2B (T2.7-T2.10) —el PR 2— más T3.1-T3.5 (verificación final, del
      leader). **Ninguna casilla marcada fuera de alcance, ninguna casilla de alcance sin marcar.**

### Trazabilidad
- [x] Cada `R1`-`R36` mapea a al menos un test concreto. **Verificado requisito a requisito (§4),
      no aceptado del mapa de la bitácora.**
- [x] El mapa `R<n> -> test` existe: `progress/impl_158_backend.md` §2 y §10.5 +
      `progress/impl_158_frontend.md` §2. *(Nombre de archivo: ver menor **m4**.)*

### Calidad de código
- [x] `pnpm run typecheck` sin errores.
- [x] `pnpm run lint` sin errores (19 warnings preexistentes, ninguno nuevo).
- [x] `pnpm test` verde: 6936/6936.
- [~] **E2E de flujo crítico: INAPLICABLE EN LA PRÁCTICA — dispensa explícita y acotada.**
      Ver §9/**m2**. La feature toca dinero real (egreso de la caja principal), así que leído
      literal el checkpoint aplica y el veredicto sería RECHAZADO. Se dispensa por el precedente
      explícito de la 155 (`progress/current.md`, «Dispensa del E2E — CONCEDIDA»): **no hay
      harness de E2E** en el repo — los `e2e/*.spec.ts` usan emails placeholder y **no corren ni
      en `pnpm test` ni en `./init.sh`** (verificado: existen `playwright.config.ts` y 20+ specs,
      pero ningún gate los ejecuta). La deuda de fondo **sigue viva y sin dueño**. La dispensa
      **no es extensible** a la 158 PR 2, que añade un segundo productor de dinero.

### Datos y seguridad (Supabase)
- [x] **RLS: INAPLICABLE — no hay tabla nueva.** Verificado en el SQL (`migration.sql` no contiene
      `CREATE TABLE`, `CREATE POLICY` ni `ROW LEVEL SECURITY`) y en la base viva (RLS sigue en
      `true` con 0 policies sobre `gestion_orden` y `wallet_movimiento`, igual que antes).
- [x] Migración versionada y reversible: `db/migrations/20260730120000_incidente_indemnizacion/`
      con `migration.sql` + `down.sql`. `pnpm run db:rollback` funciona — **reproducido** (§3).
- [x] Ningún secreto hardcodeado. Barrido del diff de `lib/`, `app/` y `db/`: **cero**
      `console.log/error/warn`, `process.env`, tokens, contraseñas, `any`, `as any`,
      `@ts-ignore` o `eslint-disable` nuevos.
- [x] **Webhooks: INAPLICABLE — la feature no añade ninguno.**

### Patrón de capas
- [x] Controller sin queries ni lógica: `lib/actions/cierres-admin.ts` y
      `lib/actions/mis-asignaciones.ts` parsean con zod, resuelven actor y delegan.
- [x] Service sin HTTP: ninguno toca `Request`/`Response`/`headers`.
- [~] Repository sólo Prisma: sí. **Pero** `WalletIndemnizacionFeedService` (un *service*) ejecuta
      `tx.gestionOrden.findMany`. Ver **m7**: es el patrón ya mergeado de `WalletFeedService` (42)
      y `WalletTiendaFeedService` (43), replicado a propósito, no un desvío nuevo.
- [x] Interfaces en `lib/interfaces/` separadas por categoría:
      `lib/interfaces/services/IWalletIndemnizacionFeedService.ts` nace donde debe.

### Permisos
- [x] Páginas protegidas: la feature no añade páginas. `CierresAdminService.resolveAlcance`
      devuelve `forbidden` para cualquier rol que no sea maestro/admin/adminSatelite.
- [x] Componentes por props: el sub-modal y las dos tablas reciben el DTO; no fetchean.
- [x] Mutaciones internas por Server Action: `aprobarCierre` y `gestionar`. Sin route API nueva.

### Multi-país / configuración
- [x] Sin hardcode de país, moneda ni cuenta nuevo. El `₡` de `money()` es preexistente (45) y se
      reusa, no se replica.

### Verificación final
- [x] `./init.sh` en verde (corrido por el reviewer).
- [x] `progress/review_158.md` existe (este archivo) con veredicto **OK**.
- [ ] Entrada en `progress/history.md`: **pendiente, y es correcto** — es F2.6, posterior al merge.
      Corresponde al leader.

---

## 3. La migración: round-trip y precondición del `down` (reproducido, no leído)

**Lectura estática del UP.** Aditivo puro: un `CREATE TYPE` + dos `ALTER TYPE … ADD VALUE IF NOT
EXISTS` + dos `ADD COLUMN` nullable sin default. **No contiene `INSERT`, `UPDATE` ni `DELETE` de
datos, no toca RLS ni policies, no crea ni suelta índices.** Verificado a mano y con el test
estático (`incidente-indemnizacion-migration.test.ts`, 15 casos).

**Los dos enums alterados tienen exactamente UNA columna usuaria cada uno** (`gestion_orden.resultado`
y `wallet_movimiento.categoria`) — comprobado sobre `db/schema.prisma` y sobre el árbol de
migraciones. Por eso este `down.sql` no tiene el problema de las TRES tablas que sí tendrá el del
camino del admin (`wallet_origen_tipo`): aquí basta un `ALTER COLUMN … USING` por enum, y están los dos.

**Sonda propia contra `localhost:5432`**, cada caso con conexión FRESCA, `BEGIN … ROLLBACK` (la base
quedó intacta; `prisma migrate status` sigue en 96 / «up to date»):

| caso | resultado | qué demuestra |
| --- | --- | --- |
| control, sin filas con los valores nuevos | **el DOWN corrió completo (15 sentencias)** | el arnés no está siempre en rojo |
| seed `gestion_orden.resultado = incidente` (fila real), luego DOWN | **ABORTA**: «la sintaxis de entrada no es válida para el enum gestion_resultado» | el `USING` del `ALTER COLUMN "resultado"` falla ruidosamente; el rollback aborta sin dejar la base a medias |
| seed `INSERT` real en `wallet_movimiento` con `categoria = egreso_indemnizacion`, luego DOWN | **ABORTA** en el `ALTER COLUMN "categoria"` | **cierra la limitación declarada** |

**Juicio sobre la limitación declarada («`wallet_movimiento` está vacía en local, el cast del `USING`
de la categoría no se ejerció con datos»): ACEPTABLE, no bloqueante — y además ya no aplica.** Tres
razones, en orden de peso:

1. **La cerré yo con datos.** La sonda insertó una fila real con el valor nuevo y el DOWN abortó
   exactamente donde el archivo dice. La mitad que faltaba está ejercida.
2. La otra mitad sí se ejerció con datos reales: 9 filas de `gestion_orden`, checksum idéntico ida
   y vuelta (`b0347c2c…` en los cuatro estados) y los 5 índices de `wallet_movimiento` reapareciendo
   con el mismo nombre y forma — incluido el parcial `WHERE origen_id IS NOT NULL`, que verifiqué
   presente en la base viva.
3. El `down.sql` es **calcado** del de la feature 45 (`20260713140000_…`), ya ejercido, y la
   expresión del `USING` es la misma.

**Lo que la limitación sí obliga a recordar** (aviso, no hallazgo): revertir esta migración en un
entorno **con** movimientos de indemnización emitidos **abortará a propósito**. Es correcto y está
documentado en el archivo, pero significa que un rollback en producción tras el primer egreso exige
borrar dinero a mano antes.

---

## 4. Verificación R1-R36, requisito a requisito

Leyenda de **cómo**: **[M]** = mutación propia (el test se puso rojo donde debía) · **[C]** = lectura
del código de producción · **[T]** = lectura del test citado comprobando que asserta el requisito y
no una tautología · **[E]** = ejecución (suite, build o base de datos).

| R | Test(s) que lo cubren | Cómo lo verifiqué |
| --- | --- | --- |
| **R1** | `incidente-indemnizacion-migration.test.ts` › «R1: ALTER TYPE ADD VALUE…» | **[E]** la base viva declara los 5 valores con los 4 previos intactos y en orden · **[T]** |
| **R2** | ídem › «R2: …egreso_indemnizacion» y «R2/R3: …conserva las 14 previas» (nombradas una a una) | **[E]** base viva: 15 valores, las 14 previas sin renombrar ni reordenar · **[T]** |
| **R3** | ídem › «el SEED de causa y el enum del SQL declaran EXACTAMENTE los mismos 3 valores»; `lib/types/causa-incidente.ts` (`satisfies` + `_EnsureExhaustive`) | **[M16]** quité `robado` del SEED → **`pnpm run typecheck` ROMPE**. Doble candado real, en las dos direcciones. |
| **R4** | ídem › bloque «DOWN — recrea los dos enums sin los valores nuevos» (5 casos) + «documenta la PRECONDICIÓN» | **[E]** sonda propia §3: el DOWN corre en el control y **aborta** con cada uno de los dos valores sembrados · **[C]** |
| **R5** | `tests/unit/guards/incidente-exhaustividad.test.ts` (8 casos: `ESTADOS_ESPERADOS`, `buildGestionData` sin rama por defecto, los 3 `CierreGrupos`, `CATEGORIA_LABEL` completo, etiquetas de los dos detalles, sin casts) | **[M13]** dejé `ESTADOS_ESPERADOS.incidente` vacío → rojo el caso del guard · **[M16]** · **[T]** |
| **R6** | `tests/unit/services/mis-asignaciones-incidente.test.ts` › «R6 — la gestión y la transición viajan en UNA sola transacción» (3 casos, incl. «si la tx falla, el service PROPAGA») | **[T]** los tres afirman UNA llamada al repo con gestión + estatus destino · **[C]** una sola transacción |
| **R7** | ídem › «el reporte se rechaza SIN efectos» (6 casos: estado distinto de `en_reparto`, orden ajena, borrada, mensajero bloqueado, rol, otra orden activa) | **[T]** cada caso asserta además **cero subidas al bucket** y cero escrituras |
| **R8** | `tests/unit/repositories/gestion-orden-repository.test.ts` › «158/R8/Q-G: el historial usa la familia `incidente`, NO `gestion`» | **[M3]** devolví el append a la familia `gestion` → **2 rojos en 2 archivos** |
| **R9** | `tests/unit/types/gestion-orden-causa-incidente.test.ts` › bloque R9 (5 casos, igualdad exacta y ordenada, rechazo del inglés) · `gestion-orden-repository.test.ts` › «el INSERT lleva la causa en su columna propia» | **[M16]** · **[T]** · **[C]** |
| **R10** | ídem › «R10 (Q-B) — la evidencia es OBLIGATORIA en las TRES causas» (5 casos, incl. «`perdido` y `robado` NO están exentos») · `mis-asignaciones-incidente.test.ts` › bloque R10 (4 casos, con compensación de Storage) · `GestionarOrdenPanelIncidente.test.tsx` › `it.each` de las 3 causas | **[M4]** quité el mínimo de una foto **sólo en la rama `incidente`** → **6 rojos** (3 de schema + los 3 de componente). La decisión Q-B está protegida en la capa donde vive. |
| **R11** | `gestion-orden-causa-incidente.test.ts` › bloque R11 (4 casos) · `mis-asignaciones-incidente.test.ts` › «el motivo emitido es EXACTAMENTE el de entrada» | **[T]** el motivo no se decora con la causa; campos aparte |
| **R12** | `tests/components/GestionarOrdenPanelIncidente.test.tsx` › bloque «R12 — el gate de verificación de guía sigue siendo la puerta» (3 casos) | **[M12]** el panel arranca en «resultados» saltándose el gate → **3 rojos** |
| **R13** | `order-status-transiciones.guardia.test.ts` › «desde `incidente` SOLO es legal el deshacer (#53)» (barrido de los 18 destinos restantes) + `it.each` de las 10 vías que R13 nombra · `cierre-dia-service.test.ts` › «si la orden YA NO está en `incidente`, conflict» (6 estados) | **[M17]** colé una arista del admin → **6 rojos**, incluido el barrido · **[C]** `appendCambioEstado` es el único punto de escritura de estado (guard de 24 puntos) |
| **R14** | `cierre-dia-service.test.ts` › bloque «deshacerGestion de un `incidente`»: «SE PUEDE deshacer», «el destino es `en_reparto` y REPONE la asignación al autor», «NO mueve dinero» · `connectividad.test.ts` › «su ÚNICA salida es el deshacer» | **[M13]** → **4 rojos** · **[M1]** retiré #53 → **8 rojos en 4 archivos** |
| **R15** | `cierre-dia-service.test.ts` › «ya vinculada a un cierre → conflict accionable», «quien NO es el autor → forbidden sin revelar NADA», «un rol que no es mensajero tampoco» | **[T]** el caso de forbidden asserta que la respuesta no filtra datos de la gestión |
| **R16** | `cierre-dia-repository.test.ts` › «crearCierre vincula también las gestiones `incidente`» (3 casos, uno exige que el WHERE **no** filtre por resultado) · `cierre-dia-service.test.ts` › «un día SOLO con incidentes se puede cerrar» | **[M14]** excluí `incidente` del `updateMany` de vinculación → **3 rojos** |
| **R17** | `tests/unit/utils/incidente-no-mueve-dinero.test.ts` (7 casos, con tarifas ALTAS y control de discriminación) · `cierre-dia-service.test.ts` (2) · `cierres-admin-service.test.ts` (1) · `cierre-dia-repository.test.ts` («el snapshot de dinero es 0.00») · `cierre-detalle-causa-monto.test.ts` (3, la vista del mensajero) | **[M8]** ver §5.3 · **[T]** las tarifas altas evitan que el test pase por la razón equivocada |
| **R18** | `cierre-dia-service.test.ts` + `cierres-admin-service.test.ts` (backend) · `CierreDiaModuleIncidente.test.tsx` (4 casos) · `CierreDetalleIncidente.test.tsx` (4 casos) | **[T]** grupo propio, etiqueta en español, no se mezcla con los otros cuatro |
| **R19** | `cierres-admin-indemnizacion.test.ts` (service) › bloques «R19/R20» y «R19/R22» · `cierre-detalle-causa-monto.test.ts` › «monto nulo, no 0.00, mientras el cierre siga `solicitado`» | **[M7]** desactivé la guardia de cobertura → **7 rojos** |
| **R20** | `cierres-admin-indemnizacion-schema.test.ts` › «R20/R24 — montos inválidos» (11 casos `it.each` + number + ausente + índice del error) | **[T]** cubre vacío, 0, negativo, 3 decimales, coma · **[C]** `montoPositivoSchema` |
| **R21** | (service) › bloque R21 (4 casos, **incluido el duplicado**) · (repo) › «un monto que NO aplica lanza y NADA queda aplicado» | **[M5]** quité `cierreId` y `resultado` del WHERE de la escritura → **4 rojos** · **[M7]** |
| **R22** | `cierres-admin-indemnizacion.test.ts` (repo) › bloque R22 (5 casos, incl. **el orden escritura→lectura del feed**) | **[C]** todo dentro de una sola transacción; el `throw` provoca rollback total · **[M5]** |
| **R23** | (repo) › «rechazar con `indemnizaciones` presentes NO las aplica» · (service) › «rechazarCierre no consulta incidentes ni pasa `indemnizaciones`» | **[C]** doble candado: la rama vive dentro de la condición `aprobado` **y** el service no las pasa |
| **R24** | schema › «un monto NUMBER se rechaza» · `wallet-indemnizacion-feed-service.test.ts` › «suma con Decimal, salida STRING escala 2» y «no acumula error de redondeo» · `cierre-detalle-causa-monto.test.ts` › «el monto NUNCA cruza como number» · `CierresAdminIndemnizacion.test.tsx` › «los montos TAL CUAL (STRING)» | **[C]** barrido: **cero** `parseFloat` o `Number(` sobre montos en todo el camino · **[T]** |
| **R25** | (service) › bloque R25 (5 casos, incl. «los mensajes NO llevan PII») · (repo) › «la lectura va acotada por alcance en el WHERE» (2 casos) | **[C]** `findGestionesIncidenteDelCierre` pone el alcance en el WHERE vía la relación `cierre`, nunca en memoria |
| **R26** | `wallet-indemnizacion-feed-service.test.ts` › bloques «el movimiento emitido» (5) y «suma SOLO los incidentes» (2) · repo › «emite UN egreso con la SUMA» | **[C]** tipo, categoría, `origenTipo = cierre_dia` y `origenId = cierreId` exactos · **[T]** |
| **R27** | ídem › bloque R27 (4 casos: sin incidentes, montos ausentes, suma 0.00, otras gestiones con monto) · repo › «NINGÚN movimiento» | **[M6]** hice que el feed emitiera con suma 0 → **5 rojos** |
| **R28** | (repo) › «aprobar DOS veces emite UN solo egreso», «el segundo intento NO altera el monto ya emitido», «un cierre que NO se aprueba no escribe ni emite» | **[E]** el índice parcial `wallet_movimiento_origen_categoria_uq` existe en la base viva · **[C]** `crearMovimientos` usa `skipDuplicates` y `resolverCierre` guarda por estado resoluble |
| **R29** | `tests/unit/guards/egreso-indemnizacion-emisores.test.ts` (8 casos) | **[M9]** añadí un emisor no declarado en `lib/` → rojo · **[M9b]** simulé el PR 2 (segundo emisor DECLARADO) → **rojo el caso que fija UNO**. El candado obliga en las dos direcciones. Ver **m1**. |
| **R30** | `wallet-indemnizacion-no-reversable.test.ts` (5 casos) · `wallet-indemnizacion-libro.test.tsx` › «la UI tampoco ofrece la reversa» | **[M10]** la reversa dejó de exigir el origen `gasto` → **3 rojos** |
| **R31** | `incidente-exhaustividad.test.ts` › etiqueta en español + opción del filtro · `wallet-indemnizacion-libro.test.tsx` (6 casos, **abriendo el selector de verdad**) | **[T]** · **[C]** `CATEGORIA_LABEL` es un `Record` completo: el build rompe si falta |
| **R32** | `wallet-egreso-service.test.ts` › «desglose por tipo + total» (reescrito: 1150.50 → 1175.75) · `wallet-desglose-egresos-card.test.tsx` › «fila propia y suma al total» (3 casos nuevos) | **[M15]** quité la indemnización del total del service → **1 rojo**. La tarjeta **no** se pone roja, y es correcto: renderiza el total que manda el servidor, no lo recalcula — hay un caso que fija justamente eso. |
| **R33** | `GestionarOrdenPanelIncidente.test.tsx` › «la opción existe y está DIFERENCIADA» (3) · «el envío válido manda el FormData esperado» (2) · «cliente y servidor validan con el MISMO esquema» (1, estructural: los dos importan `gestionarSchema` y el panel **no** define un schema paralelo) | **[M4]** los 3 casos de foto se ponen rojos al tocar el schema compartido → el «mismo esquema» no es decorativo · **[T]** |
| **R34** | `CierresAdminIndemnizacion.test.tsx` › bloque de la captura (6 casos + `it.each` de 7 montos inválidos) **y** los 3 de la CAUSA · `CierreDetalleIncidente.test.tsx` › causa y monto en el detalle | **[M11]** quité la causa del sub-modal → **3 rojos**. Las **dos** cláusulas de R34 están cubiertas. |
| **R35** | `gestion-orden-causa-incidente.test.ts` › «las cuatro ramas previas siguen validando igual» + blindaje de la unión · `gestion-orden-repository.test.ts` › «los CUATRO resultados previos siguen appendeando con `gestion`» · `cierre-detalle-causa-monto.test.ts` › bloque R35 · `CierreDetalleIncidente.test.tsx` › «los cuatro previos conservan su orden exacto» | **[E]** suite completa en verde sin relajar ninguna expectativa previa (auditado, §6) |
| **R36** | schema › bloque R36 (3 casos) · service (2) · `cierres-admin-action.test.ts` › delega con lista vacía · **`CierresAdminModule.test.tsx` › «R10: aprobar llama a aprobarCierre…» — el test de la 38, INTACTO** | **[T]** el test de la 38 sigue exigiendo el payload exacto de un solo campo; es el que caza la mutación O del implementador · **[C]** el valor por defecto de la lista |

**Resultado: 36/36 con test concreto y no vacuo.** Ni uno solo quedó apoyado únicamente en el mapa
de la bitácora.

---

## 5. Auditoría de las declaraciones honestas del implementador

Estas cuatro no se aceptaron: se comprobaron.

### 5.1 `censo-catalogo-estados-v2.test.ts` — la pérdida de discriminación **está compensada de verdad**

El implementador declara que, al graduar `incidente`, `LITERALES_154` queda vacío y el caso del
barrido pasa a ser trivialmente cierto; dice haberlo compensado con un caso nuevo que exige que el
productor esté en los dos archivos que se nombran.

**Comprobado por mutación [M3]:** devolví el append a la familia `gestion` y el caso nuevo
—«158: `incidente` SÍ aparece ya en módulos de negocio (tiene productor real)»— **se puso rojo**.
La compensación existe y discrimina. El archivo tampoco perdió casos: pasó de 12 a 13.

**Matiz que sí queda (menor m6):** la compensación tiene dos mitades y sólo una es fuerte. La de
`GestionOrdenRepository` busca el patrón de escritura de la familia, y es la que cazó la mutación.
La de `MisAsignacionesService` busca la palabra `incidente` en el archivo entero: **la satisface un
comentario**. No abre agujero real —quitar el caso `incidente` de `buildGestionData` rompe el build
por el switch exhaustivo, verificado— pero conviene saber que esa mitad no mide nada.

### 5.2 `criterio-intento-entrega.test.ts` (feature 160) — la reescritura es **más fuerte, no distinta**

Este conteo gobierna el escalado del cron de plazos y, por esa vía, un cobro real a la tienda.
Lo auditado:

- El caso viejo afirmaba «`incidente` no tiene salidas declaradas» — condicional, escrito cuando la
  154 vivía en otra rama. Q-D lo invalida.
- El caso nuevo afirma que **ninguna arista que TOQUE `incidente` —ni de entrada ni de salida— entra
  en el conteo de intentos**, reproduciendo el predicado real (destino `devuelta` con cualquier
  familia, o destino `reprogramada` con familia en `ORIGEN_TIPOS_REPROGRAMADA_INTENTO`) **importado
  del módulo de producción**, no copiado a mano. Y lleva un assert de que el conjunto medido no está
  vacío, que impide que el caso sea vacuo.
- **Es estrictamente más fuerte:** el viejo sólo miraba las salidas; el nuevo mira entradas y
  salidas, y mide el criterio de negocio en vez de la forma del mapa. Si mañana alguien declarara
  `incidente → devuelta` o `incidente → reprogramada (gestion)`, el viejo habría fallado por «hay
  salidas» sin decir por qué importa; el nuevo falla diciendo exactamente que se adelantaría un cobro.
- Se le **sumó** un segundo caso que fija que la única salida es la reversión. El archivo pasó de 9
  a 10 casos.
- **[M1]** al retirar #53, **este archivo se pone rojo**: no es un test que sólo mire hacia otro lado.

**Veredicto: la reescritura conserva la fuerza del invariante y la aumenta. Correcta.**

### 5.3 R17 — el monto **no llega** a la vista del mensajero, y la decisión vive en el REPO

Verificado en tres niveles:

1. **[C]** `WITH_DETALLE` (`CierreDiaRepository`) **no selecciona** `indemnizacion`; `toPendienteRow`
   la emite nula incondicionalmente. La causa **sí** viaja (decisión explícita, R9).
2. **[M8]** añadí la columna al `select` **y** la propagué en el mapper → **2 rojos**, uno de ellos
   con una fila que **sí** trae monto, comprobando que el mapper lo descarta igual.
3. **Busqué otras rutas de fuga y no hay ninguna:**
   - `CierresAdminService` (el único otro consumidor del DTO con el monto poblado) devuelve
     **`forbidden` para el rol `mensajero`** en `resolveAlcance` — verificado en el código.
   - `CierreDiaModule.tsx` (vista del mensajero) importa de `cierre-detalle-shared` **sólo**
     `COLUMNA_CAUSA_INCIDENTE`, no la columna del monto; hay un caso que lo fija.
   - `/mi-wallet` y `/mis-pagos` (superficies del mensajero) **no leen `wallet_movimiento`**: el
     egreso vive en la caja principal, cuyo módulo es de acceso total.
   - Barrido de `lib/` y `app/`: los únicos sitios que nombran el monto en una proyección son
     `GESTION_ADMIN_SELECT` (admin) y `WITH_DETALLE` (con la columna excluida y el porqué escrito).

**Veredicto: la afirmación es cierta y está implementada donde dice estarlo.**

### 5.4 La mutación del frontend que NO discriminó — la explicación es **correcta**, no tapa nada

El implementador declara que mandar la lista de evidencias indefinida en la rama de incidente dejó
los 19 casos verdes, porque la regla «1..N obligatoria» vive en `evidenciasSchema` y no en el
componente.

**Comprobado [M4]:** quité el mínimo de una foto **sólo en la rama `incidente`** de
`gestionarUnionSchema` y se pusieron rojos **6 casos**: los 3 del schema **y los 3 de componente**
(`it.each` de las tres causas). Es decir: la regla está protegida en la capa donde vive, y los tests
de componente la heredan porque el panel valida con **ese mismo** schema (fijado además por un caso
estructural de R33 que prohíbe un schema paralelo en el cliente). La mutación original no
discriminaba porque **no cambiaba el comportamiento observable**: con la lista indefinida el schema
sigue rechazando y la action sigue sin llamarse.

**Q-B (evidencia obligatoria SIEMPRE, decisión explícita del humano) está protegida. No es hueco.**

---

## 6. Los 12 tests de OTRAS features: **ninguno borrado, ninguno debilitado**

Auditado con `git diff 21400f7..HEAD -- tests/`, extrayendo **todas** las líneas eliminadas que
contuvieran `it(`, `describe(` o un `expect`, y comparando el número de casos por archivo antes y
después.

| archivo (feature) | qué afirmaba | qué afirma ahora | casos antes → ahora |
| --- | --- | --- | --- |
| `order-status-transiciones.connectividad.test.ts` (140/154) | salidas de `incidente` igual a cero, mapa vacío | igualdad EXACTA con la lista de una sola arista (#53) + `indemnizada` sigue sin existir | 11 → **11** |
| `order-status-transiciones.guardia.test.ts` (140/154) | «`incidente` no tiene NINGUNA salida legal»; 41/39; `en_reparto->incidente (gestion)`; `incidente→en_reparto` como par ILEGAL | conserva el **barrido completo** eximiendo sólo #53; 42/40; `(incidente)`; usa `incidente→entregada` como par ilegal; **+ `it.each` de las 10 vías de R13 + el caso §15.2 de las 10 aristas del admin** | 38 → **41** |
| `criterio-intento-entrega.test.ts` (160) | «`incidente` no tiene salidas declaradas» (condicional) | ninguna arista que TOQUE `incidente` cuenta como intento **+** su única salida es la reversión (§5.2) | 9 → **10** |
| `censo-catalogo-estados-v2.test.ts` (154) | `incidente` sigue censado | censo CERRADO + **la graduación se verifica en los dos archivos productores** (§5.1) | 12 → **13** |
| `registrar-cambio-estado.guardia.test.ts` (140) | descuento de 2 aristas | descuento por **constante nombrada** `ARISTAS_QUE_TOCAN_LOS_VALUES_154 = 3`, no un número mágico | 24 → **24** |
| `orden-historial-cobertura.test.ts` (49/154) | dos familias sin productor, 23 puntos de escritura | una familia sin productor; `incidente` en los puntos de escritura (#24) con su símbolo real, 24 puntos | 10 → **11** |
| `tests/fixtures/inventario-transiciones-140.ts` (140) | 41/39 y `(gestion)` | 42/40 y `(incidente)`, con la cadena aritmética escrita | fixture |
| `wallet-egreso-service.test.ts` (45) | total 1150.50 | 1175.75 con la indemnización dentro | 17 → **17** |
| `wallet-desglose-egresos-card.test.tsx` (45) | «Egresos administrativos», total 1225.50 | «Egresos» + total 1250.75 + **4 casos nuevos** (fila propia, el total viene del servidor, money-safe con 11 dígitos, el copy viejo ya NO aparece) | 1 → **6** |
| `wallet-idempotencia.test.ts` (42) | idempotencia del egreso por cierre | igual + doble del feed nuevo, con la razón escrita en el archivo | 3 → **3** |
| `cierres-admin-action.test.ts` (38) | delega con dos argumentos | delega con tres, el tercero la **lista vacía** — el valor por defecto hace que el contrato de la 38 siga siendo válido tal cual | sin pérdida |
| `CierresAdminModule.test.tsx` (38) | payload de un solo campo al aprobar | **INTACTO** (es el que caza la mutación O del implementador) | 32 → **32** |

**Ningún archivo perdió casos. Seis ganaron.** Las únicas líneas `it(` eliminadas son renombrados o
inversiones con su razón escrita en el propio archivo, que es el criterio del repo (patrón con el
que la 156 trató los tests de la 154).

Los cambios de `cierres-admin-repository.test.ts`,
`CierresAdminRepository.resolverCierre.devolucion.test.ts`, `cierre-detail-congelado.test.ts`,
`devolucion-rechazadas-flow.test.ts` y las 14 factorías de fixtures son **+1 argumento de
constructor** o **+1 clave de interfaz cerrada**: no tocan aserciones.

---

## 7. Que el camino del ADMIN **no se coló** — verificado, no supuesto

| Comprobación | Resultado |
| --- | --- |
| `orden_incidente` / `OrdenIncidente` en `db/`, `lib/`, `app/`, `tests/` | **Cero apariciones** de código. La única mención es un comentario del guard de emisores que explica qué debe pasar en el PR 2. |
| `wallet_origen_tipo` | **6 valores** en `schema.prisma` **y en la base viva** (`cierre_dia, gestion_orden, manual, pago_tienda, pago_mensajero, gasto`). Sin `orden_incidente`. |
| Aristas del mapa | Sólo **#53** declarada. **#48-#52 y #54-#58 siguen RESERVADAS y sin declarar**, con el porqué escrito en la cabecera del archivo (design §15.2: no declarar una arista antes que su productor — la lección de la 154). |
| ¿Hay candado? | Sí, y **funciona**: **[M17]** declaré una de las inversas del admin (#54) → **6 rojos**, incluido el caso explícito «158/§15.2: las 10 aristas del camino del ADMIN NO están declaradas todavía». Adelantarlas sería una decisión consciente, no una inercia. |

---

## 8. Integridad de `tasks.md` tras el incidente de proceso — **confirmada de forma independiente**

Durante la fase frontend un one-liner de Python truncó `tasks.md` y se restauró con `git checkout`
reaplicando las ediciones. Verificado **sin fiarme de la restauración**, recorriendo las seis
revisiones del archivo (`3183127 → ebfb1b3 → c1e63f8 → 22b0bb4 → a9354a7 → HEAD`):

- **Los 57 identificadores de task están presentes en TODAS las revisiones**, en el mismo orden:
  T0.1-T0.8, T1.1-T1.18 (con T1.6b y T1.6c), T1.19-T1.32, T2.1-T2.10, T3.1-T3.5.
- **El número de líneas sólo crece**: 412 → 416 → 429 → 450 → 460 → **480**. No hay ningún commit
  con pérdida neta, así que **la truncación nunca llegó a un commit**.
- El `git diff` completo de `3183127..HEAD` sobre el archivo: **ninguna línea de texto de task
  desaparece**. Todas las líneas eliminadas son (a) casillas sin marcar que pasan a marcadas y
  (b) el bloque «T0.6 — Puerta PENDIENTE» reemplazado por su versión cerrada, que conserva las tres
  tasks con más texto, no menos.
- **34 casillas marcadas, y son exactamente las 34 del alcance de este PR** (Fases 0, 1 y 2).
  Ninguna casilla marcada sin su trabajo: recorrí las 34 contra los artefactos (migración,
  `schema.prisma`, `causa-incidente.ts`, el mapa de transiciones, el borde zod, el service, el
  repo, el feed, el guard, los dos detalles, el sub-modal y la wallet) y **todas tienen su
  entregable y su test**.

**No se perdió nada.**

---

## 9. Hallazgos

### BLOQUEANTES: **ninguno**

### Menores

- **m1 — `menor` · R29 no se cumple LITERALMENTE en este PR (declarado, y con candado real).**
  R29 pide «exactamente DOS» emisores de `egreso_indemnizacion`; aquí hay **UNO**
  (`WalletIndemnizacionFeedService`). Es consecuencia directa de Q-L (dos PRs) y está declarado en
  `impl_158_backend.md` §6. **El candado existe y obliga en las dos direcciones — lo verifiqué:**
  añadir un emisor no declarado pone rojo el caso de igualdad **[M9]**, y declarar el segundo pone
  rojo el caso que fija UNO **[M9b]**. La mitad de R29 que SÍ se puede cumplir hoy («ningún tercero,
  ni acción manual, ni cron, ni endpoint») está cumplida y testeada, incluido el caso que verifica
  que el formulario manual de la 45 no puede producir la categoría.
  → **Acción para el PR 2: el reviewer DEBE verificar que ese número pasa a 2 y que el segundo
  emisor es el feed del incidente del admin.** Sin eso, R29 queda a medias para siempre.

- **m2 — `menor` · Checkpoint E2E: dispensa explícita y acotada, con la deuda de fondo viva.**
  La feature produce un egreso real de la caja principal, así que el checkpoint aplica. **No hay
  harness de E2E**: `playwright.config.ts` y 20+ specs existen, pero usan emails placeholder y
  **ningún gate los ejecuta** (`pnpm test` no los corre, `./init.sh` tampoco). Escribir una spec
  nueva sin ejecutarla añadiría un archivo que nadie corre — exactamente lo que dejó pasar 3 specs
  rotas en la feature 148. **Concedo la dispensa** con el mismo alcance explícito que la 155 y
  **la declaro NO extensible al PR 2**, que añade un segundo productor de dinero. La deuda «no hay
  harness de E2E (seed + login por rol)» **sigue viva y sin dueño**.

- **m3 — `menor` · T3.1 (prueba de humo manual) no se hizo, y está bien declarado.**
  Exige levantar la app y operar de verdad (reportar, deshacer, cerrar, aprobar y mirar la wallet).
  La casilla está **sin marcar** con su razón escrita en `impl_158_frontend.md` §5-bis. Correcto:
  marcarla habría sido fingir una verificación. **Queda para el humano antes del merge.** Igualmente
  correcto: **T3.3** sin marcar porque la casilla cubre **las dos** migraciones y sólo existe la del
  mensajero — la parte que sí existe está hecha, documentada y **reproducida por mí** (§3).
  T3.4/T3.5 son del leader; el follow-up de Q-E ya está registrado como **ficha 161** en
  `feature_list.json` (verificado).

- **m4 — `menor` · `tasks.md` cita una bitácora que no existe.** T1.18 y T2.6 dicen «mapa R→test
  actualizado en `progress/impl_158-incidente-indemnizacion.md`». Los archivos reales son
  `progress/impl_158_backend.md` y `progress/impl_158_frontend.md`, que es la convención del repo
  para features fullstack partidas (121, 142, 146, 148, 149). El frontend lo declara. **Lo que está
  desactualizado es el texto de la task, no la bitácora.** Arreglar la referencia.

- **m5 — `menor` · El monto no tiene tope superior frente a `DECIMAL(12,2)`.**
  `montoPositivoSchema` valida formato y «mayor que 0», pero no un máximo; la columna admite 10
  dígitos enteros. Un monto de 11 o más dígitos pasa el borde, pasa la guardia de cobertura y
  **revienta dentro de la transacción de aprobación con un error de Postgres** (numeric field
  overflow) en vez de un `validation_error` por campo. La transacción hace rollback —no hay
  corrupción— pero el admin ve un error genérico y pierde todo lo tecleado. Es **preexistente** (el
  formulario manual de la 45 tiene la misma propiedad), pero la 158 lo pone por primera vez dentro
  de la transacción del cierre, que es mucho más cara de repetir. Sugerencia para una feature
  futura, no para este PR.

- **m6 — `menor` · Media compensación vacua en `censo-catalogo-estados-v2.test.ts`** (§5.1).
  La mitad de `GestionOrdenRepository` discrimina (verificado **[M3]**); la de
  `MisAsignacionesService` busca la palabra suelta en el archivo entero y **la satisface cualquier
  comentario**. No abre agujero (el caso `incidente` de `buildGestionData` está protegido por el
  switch exhaustivo sin rama por defecto, verificado), pero esa mitad no mide nada.

- **m7 — `menor` · `WalletIndemnizacionFeedService` consulta Prisma desde un service.**
  `docs/architecture.md` dice que el service no depende de la DB directamente. Este ejecuta
  `tx.gestionOrden.findMany`. **Es el patrón ya mergeado** de `WalletFeedService` (42) y
  `WalletTiendaFeedService` (43), replicado a propósito porque el feed debe leer, dentro de la
  misma transacción, lo que esa transacción acaba de escribir (design §9.3, lección de la 69).
  **Tercera repetición.** No lo trato como defecto nuevo, pero o se documenta la excepción en
  `docs/architecture.md` o el documento seguirá describiendo algo que el repo ya no hace.

- **m8 — `menor` · `feature_list.json` id 158: la `description` contradice a Q-F.** Sigue diciendo
  «ALTER TYPE ADD VALUE + **actualizar los down.sql previos que recrean el tipo**», y Q-F decidió
  exactamente lo contrario (no se reescribe ninguno; verificado que no se reescribió). Es texto de
  la ficha original; conviene reconciliarlo al pasar a `done` para que nadie lo lea como pendiente.

- **m9 — `menor` · Acoplamiento de la vista del mensajero al módulo del admin.**
  `app/(app)/cierre-dia/_components/CierreDiaModule.tsx` importa `COLUMNA_CAUSA_INCIDENTE` de
  `app/(app)/cierres-admin/_components/cierre-detalle-shared.tsx`. Funciona (los dos son
  componentes de cliente, y el `next build` lo confirma) y evita duplicar la etiqueta, que era el
  objetivo correcto. Pero deja la pantalla del mensajero dependiendo de un módulo del admin: un
  cambio ahí se propaga sin aviso. Anotarlo; si aparece un tercer consumidor, toca promover.

- **m10 — `menor` · `orden-historial-cobertura.test.ts` no protege Q-G por comportamiento.**
  Es un mapa declarativo: en la mutación **[M3]** (el append vuelve a la familia `gestion`) **no se
  puso rojo**. La cobertura real de Q-G la dan `gestion-orden-repository.test.ts` y el censo, que sí
  discriminan. No falta cobertura; lo que falta es que nadie confunda ese archivo con una red de
  comportamiento.

### Observaciones sobre decisiones del humano (NO se re-litigan; se anota la consecuencia)

- **Q-B (evidencia obligatoria SIEMPRE):** la UI **no disimula el coste**. El campo lleva ayuda
  accesible que dice qué fotografiar cuando no hay paquete (vehículo o compartimento vacío, guía,
  lugar del hecho, denuncia), y hay un test que **exige que el copy nombre alternativas concretas**
  —degradarlo a «La foto es obligatoria» lo pone rojo—. Es el mejor trato posible con la decisión
  tomada. El coste declarado (un mensajero sin batería o sin señal no puede reportar un robo) sigue
  siendo real y sigue siendo del humano.
- **Q-D (el `incidente` se deshace):** la reversión de la 154 está **fechada y acotada** en el
  código, sin borrar la decisión previa, y `incidente` sigue en `ESTADOS_TERMINALES` (compatible:
  ese conjunto exime de tener salida, no la prohíbe; `entregada` es el precedente). Consecuencia
  que conviene ver: deshacer devuelve la orden a `en_reparto` **y repone la asignación al autor**.
  Es idéntico al deshacer de los otros cuatro resultados, así que no introduce nada nuevo, pero
  significa que un incidente deshecho al final del día deja la orden asignada y en reparto.
- **Q-C (el monto en `gestion_orden.indemnizacion`):** revertir la migración **borra los montos
  capturados**. Está escrito en el `down.sql`. En la práctica no se pierde dinero silenciosamente,
  porque la precondición aborta antes si hay filas `incidente` — comprobado en §3.
- **Q-F (no reescribir los `down.sql` previos):** correcta y verificada por barrido real del árbol:
  ningún `down.sql` anterior recrea `gestion_resultado`, y el de la 45 conserva sus 12 valores
  punto-en-el-tiempo con su test intacto.

---

## 10. Mis mutaciones (17 aplicadas, 17 discriminan) y las 3 sondas de base

Todas en memoria, revertidas con `git checkout --`; `git status` limpio al terminar.

| # | mutación | resultado |
| --- | --- | --- |
| M1 | se retira la arista **#53** (`incidente → en_reparto`) | **8 rojos en 4 archivos** |
| M2 | el `via` de **#44** vuelve a `gestion` | 1 rojo: «el mapa declara exactamente las aristas del inventario» |
| M3 | el append escribe la familia `gestion` en vez de `incidente` | **2 rojos en 2 archivos**, incluido **el caso compensatorio del censo** |
| M4 | la evidencia pierde el mínimo de 1 foto **sólo en la rama `incidente`** | **6 rojos** (3 de schema + 3 de componente) |
| M5 | el WHERE de la escritura del monto deja de guardar `cierreId` + `resultado` | **4 rojos** |
| M6 | el feed emite aunque la suma sea 0 | **5 rojos** |
| M7 | se desactiva la guardia de cobertura EXACTA del service | **7 rojos** |
| M8 | el mensajero **sí** recibiría el monto (`select` + mapper) | **2 rojos**, uno con una fila que sí trae monto |
| M9 | aparece un emisor de `egreso_indemnizacion` **no declarado** en `lib/` | 1 rojo (igualdad, no un `some()` permisivo) |
| M9b | se declara un **segundo** emisor (simula el PR 2) | 1 rojo: el caso que fija UNO — **el candado de R29 obliga** |
| M10 | la reversa deja de exigir el origen `gasto` | **3 rojos** |
| M11 | se quita la CAUSA del sub-modal de aprobación | **3 rojos** (la cláusula de R34) |
| M12 | el panel arranca en «resultados», saltándose el gate de guía | **3 rojos** (los tres de R12) |
| M13 | `ESTADOS_ESPERADOS.incidente` queda vacío | **4 rojos** |
| M14 | `crearCierre` excluye las gestiones `incidente` de la vinculación | **3 rojos** |
| M15 | el total del desglose deja de sumar la indemnización | 1 rojo en el service (la tarjeta no recalcula, y hay un caso que lo fija) |
| M16 | se quita un valor de `CAUSA_INCIDENTE_SEED` | **el BUILD ROMPE** (`pnpm run typecheck`) |
| M17 | se cuela una arista del camino del ADMIN (#54) | **6 rojos**, incluido el caso §15.2 |

**Sondas contra Postgres local** (conexión fresca por caso, transacción revertida, base intacta):
control → el DOWN corre completo (15 sentencias) · fila con `gestion_orden.resultado = incidente`
→ **aborta** · fila real insertada en `wallet_movimiento` con la categoría nueva → **aborta**.

**Mutantes supervivientes: ninguno de los intentados.** Los dos puntos de cobertura débil que
encontré están en **m6** (media compensación del censo) y **m10** (mapa declarativo sin
comportamiento), ninguno con consecuencia real gracias a otras redes verificadas.

---

## 11. Deuda declarada que sigue viva al cerrar este review

1. **R29 a medias hasta el PR 2** (m1). Candado verificado; el reviewer del PR 2 debe cerrarlo.
2. **T3.1 — prueba de humo manual del camino del mensajero, sin hacer** (m3). Del humano.
3. **T3.3 — round-trip de las DOS migraciones; sólo existe la del mensajero** (m3). Se cierra en el PR 2.
4. **T3.4 / T3.5 — `feature_list.json` a `done`, `progress/current.md`, entrada en `history.md` y
   cierre de los follow-ups.** Del leader, post-merge. La ficha **161** (crédito de la indemnización
   en el ledger por tienda, Q-E) **ya está registrada**; **Q-J** (avisar al mensajero asignado) sigue
   abierta y es del camino del admin.
5. **No hay harness de E2E** (m2). Deuda de arnés, viva y sin dueño desde la 148.
6. **`catalogoCache` nunca se invalida** (heredado de la 154). Esta migración **no** hace crecer
   `order_status`, así que el riesgo no aumenta, pero el orden **migrar-antes-de-desplegar** sigue
   importando.
7. **Revertir esta migración en un entorno con indemnizaciones emitidas abortará a propósito.**
   Documentado en el `down.sql` y comprobado.

---

## 12. Conclusión

El PR entrega un **ciclo económico completo y cerrado** del camino del mensajero: reportar →
cerrar → aprobar capturando el monto → **un** egreso idempotente en la caja → deshacer si fue un
error. El dinero viaja **STRING/Decimal de extremo a extremo** sin pasar por coma flotante en
ningún punto, se escribe **guardado por `(id, cierreId, resultado)`** y el feed **lee de la base lo
que la misma transacción acaba de escribir**, que es la lección de la 69 aplicada bien. La migración
es aditiva, reversible, y su precondición aborta ruidosamente — comprobado contra Postgres con datos
sembrados en las dos mitades. Los tests de otras features se reescribieron conservando —y en varios
casos aumentando— su fuerza, y las cuatro declaraciones honestas del implementador resultaron
ciertas al comprobarlas por mutación.

No hay bloqueantes. **Veredicto: OK.**
