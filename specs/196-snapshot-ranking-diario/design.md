# Feature 196 — Diseño técnico

Decisiones **antes** de escribir código (`docs/specs.md`). Requisitos en
`requirements.md`. Alternativas descartadas en §9.

---

## 1. La decisión central: congelar, no recalcular

**Se CONGELA** el resultado en tablas propias. El histórico no se recalcula nunca.

Motivo, con el código en la mano y no por analogía:

1. **Los insumos del orden cambian.** El umbral de podio es configuración de entorno
   (`RANKING_MIN_ASIGNADAS`, `lib/config/ranking.ts`), el premio es una fila editable por
   `maestro` (`premio_ranking`, sin historia) y el comparador es código. Recalcular «el
   ranking del martes» con la configuración del viernes produce un podio que **nadie vio el
   martes** y, si hubo premio, contradice **lo que se pagó**.
2. **`analytics_daily` no puede responder la pregunta.** Su grano agrega gestiones
   (`entregas`, `devoluciones`, …), pero el **denominador** del ranking son las
   *órdenes asignadas ese día* (`orden.asignado_at` en la ventana CR,
   `RankingRepository.contarAsignadasPorMensajero`) y esa magnitud **no tiene columna** en
   `analytics_daily`. Recalcular desde ahí exigiría o bien añadirle una medida nueva —tocar
   la tabla de otra feature y su guard de contrato (R45 de la 123)— o bien recalcular desde
   `orden`/`gestion_orden` crudas, que es exactamente el punto 1 con más pasos.
3. **La inmutabilidad es el producto.** El pedido es «almacenar las posiciones finales del
   día», no «poder volver a calcularlas».

Consecuencia que se asume: el snapshot es **redundante** respecto de los datos crudos y
puede divergir de lo que hoy calcularía el vivo. Eso no es un defecto, es el objetivo.

## 2. Modelo de datos

Dos tablas nuevas, cabecera + detalle, patrón `ruta_optimizada` / `ruta_optimizada_parada`.

### 2.1 `ranking_snapshot_dia` (cabecera, una fila por fecha CR)

| columna | tipo | notas |
| --- | --- | --- |
| `id` | TEXT PK | `cuid()` |
| `fecha` | DATE **UNIQUE** | fecha CR a **medianoche UTC**, convención `@db.Date` del repo (feature 46; ver `fechaComoDate` en `lib/analytics/rollup-dia.ts:86`). **No** es `desde` de la ventana. |
| `generado_at` | TIMESTAMP(3) NOT NULL DEFAULT now() | R24: evidencia de que el cron corrió y cuándo. |
| `min_asignadas_podio` | INTEGER NOT NULL | R1: umbral **aplicado** esa corrida. Congelarlo es lo que hace auditable el podio cuando el env cambie. |
| `filas` | INTEGER NOT NULL | R1/R11: conteo congelado. `0` = día sin actividad. |

- CHECK `min_asignadas_podio >= 1`, CHECK `filas >= 0`.
- **Sin `updated_at`**: la fila es inmutable por diseño (R12). Una columna que nunca se
  actualiza invita a actualizarla.
- `fecha` UNIQUE **es** la garantía de idempotencia (R13); no hay índice suelto de `fecha`
  porque el UNIQUE ya lo sirve (única consulta: igualdad por fecha).

### 2.2 `ranking_snapshot_fila` (detalle, una fila por mensajero con actividad)

| columna | tipo | notas |
| --- | --- | --- |
| `id` | TEXT PK | |
| `snapshot_id` | TEXT NOT NULL FK → `ranking_snapshot_dia(id)` **ON DELETE CASCADE** | la fila no significa nada sin su cabecera. |
| `puesto` | INTEGER NOT NULL | 1..N. **El orden congelado es dato, no derivación** (R25): la lectura hace `ORDER BY puesto`, jamás reordena. |
| `posicion` | INTEGER NULL | 1/2/3 si ocupó podio; NULL si no (R6/R9). |
| `mensajero_id` | TEXT NOT NULL FK → `usuario(id)` **ON DELETE RESTRICT** | R17. Igual que las 4 FK de `analytics_daily`. |
| `mensajero_nombre` | TEXT NOT NULL | R16: nombre **congelado**. Un renombrado posterior no reescribe la historia. |
| `entregadas` | INTEGER NOT NULL | numerador del día. |
| `asignadas` | INTEGER NOT NULL | denominador del día. |
| `premio_monto` | DECIMAL(12,2) NULL | R7. Mismo tipo exacto que `premio_ranking.monto`. |
| `premio_descripcion` | TEXT NULL | R7. |

- CHECK `puesto >= 1`; CHECK `posicion IS NULL OR posicion IN (1,2,3)`;
  CHECK `entregadas >= 0 AND asignadas >= 0`;
  CHECK `posicion IS NOT NULL OR (premio_monto IS NULL AND premio_descripcion IS NULL)` (R8).
- **NO** hay CHECK `entregadas <= asignadas`, y es deliberado: las dos magnitudes salen de
  fuentes distintas (`gestion_orden.created_at` vs `orden.asignado_at`), así que una orden
  asignada ayer y entregada hoy hace `entregadas > asignadas` legítimamente y el `pct` pasa
  de 100. Es el comportamiento del vivo; un CHECK aquí tumbaría el cron un día cualquiera.
- **NO** se guarda el porcentaje (R10), aplicando la regla 3 de `analytics_daily`: nada de
  tasas persistidas. `pct` es función pura de dos enteros congelados y el **orden**, que es
  lo único que un cambio de comparador podría mover, ya está congelado en `puesto`.
- Índices: UNIQUE `(snapshot_id, mensajero_id)`, UNIQUE `(snapshot_id, puesto)`, UNIQUE
  parcial `(snapshot_id, posicion) WHERE posicion IS NOT NULL` (R13). **Ninguno más**: la
  única consulta es «todas las filas de un `snapshot_id`, ordenadas por `puesto`», y el
  primer UNIQUE ya la sirve como prefijo. Sin índice suelto por `mensajero_id`: hoy no
  existe la consulta «mi histórico» (decisión humana 4: todos ven todo).

### 2.3 RLS

`ENABLE ROW LEVEL SECURITY` **sin policies** en ambas tablas, patrón
`ruta_optimizada` / `geocode_cache` / `analytics_daily`: este repo no usa Supabase Auth
(sesión propia, sin `auth.uid()`), así que el recorte por rol lo aplica el servidor. Son
datos de rendimiento **de personas identificadas**: no se acceden desde el cliente bajo
ninguna circunstancia (R38).

### 2.4 Migración

`db/migrations/20260811120000_ranking_snapshot/` con `migration.sql` (UP) y `down.sql`
(DOWN, obligatorio — `docs/architecture.md`). Aditiva: dos `CREATE TABLE`, sus CHECK, sus
FK, sus índices, sus `COMMENT ON` y las dos sentencias de RLS. El DOWN son dos
`DROP TABLE IF EXISTS` (detalle antes que cabecera), sin `DROP TYPE`: no se crea ningún
enum. Ninguna tabla preexistente se toca (R18/R37).

## 3. Dónde vive el criterio de orden (y por qué se refactoriza)

El encargo exige **reusar el mismo criterio**, no reimplementarlo. Hoy vive incrustado en
`RankingService.obtenerRanking` (`:105-131`). Se extrae **sin cambiar comportamiento** a un
módulo PURO:

```
lib/ranking/orden-ranking.ts        # comparador + asignación de podio + formato de pct
lib/ranking/snapshot-dia.ts         # fecha objetivo D−1 y su ventana CR (patrón rollup-dia.ts)
```

- `ordenarAgregados(agregados)` — el comparador actual **más un desempate final por
  `mensajeroId` ascendente** (R4). Sin él, dos mensajeros homónimos con idénticas métricas
  quedan en orden indefinido y dos corridas del mismo día podrían congelar podios
  distintos. Es aditivo: solo actúa donde el orden actual ya estaba **sin especificar**.
- `asignarPodio(ordenados, minAsignadas)` — la regla de las 3 posiciones elegibles.
- `formatearPct(entregadas, asignadas)` — `null` si `asignadas === 0`, si no
  `(entregadas/asignadas*100)` redondeado a 1 decimal y serializado con `toFixed(1)`.
  **Único** sitio del repo que lo hace, consumido por el vivo y por el histórico (R10).

`RankingService` pasa a consumir estas tres funciones; su salida no cambia (R36, cubierto
por los tests existentes de `ranking-service`). Módulo puro: sin Prisma, sin `next/*`, sin
`new Date()` propio.

`snapshot-dia.ts` **no** importa de `lib/analytics/`: se apoya directo en
`lib/utils/fecha-cr.ts` (`fechaCalendarioCR(now − 24h)`, `inicioDelDiaCREnUtc`,
`inicioDelDiaSiguienteCREnUtc`), igual que `rollup-dia.ts` y `ventana-dia-cr.ts`. Acoplar
ranking a analytics para ahorrar cuatro líneas sería peor negocio. `now` es **obligatorio**,
sin default (la regla de `rollup-dia.ts:59`).

⛔ `startOfDayCR` **no** se usa: es la trampa documentada del repo (ficha 166).

## 4. Capas y contratos

```
app/api/cron/snapshot-ranking/route.ts          Controller HTTP (Bearer CRON_SECRET)
  ↓
lib/services/RankingSnapshotService.ts          congelar(now) / obtenerPorFecha(actor, fecha)
  ↓
lib/repositories/RankingSnapshotRepository.ts   Prisma (snapshot) 
lib/repositories/RankingRepository.ts           Prisma (conteos del día) — YA EXISTE, se reusa
lib/repositories/PremioRankingRepository.ts     Prisma (premios) — YA EXISTE, se reusa
lib/repositories/UserRepository.ts              listMensajeros() — YA EXISTE, se reusa
```

### 4.1 `IRankingSnapshotService`

```ts
export type CongelarResult =
  | { status: "creado"; fecha: string; filas: number }
  | { status: "omitido"; fecha: string; filas: number };   // R12: ya congelada

export type ObtenerSnapshotResult =
  | { status: "ok"; data: RankingSnapshotData }   // incluye filas: [] (día sin actividad)
  | { status: "sin_snapshot"; fecha: string }     // R26: el cron no corrió esa fecha
  | { status: "forbidden" };

export interface IRankingSnapshotService {
  congelar(now: Date): Promise<CongelarResult>;                       // R2/R15: sin fecha por parámetro
  obtenerPorFecha(actor: Actor, fecha: string): Promise<ObtenerSnapshotResult>;
}
```

`congelar` **no** recibe fecha: la calcula de `now` (R15). No hay firma que permita pedir
otra fecha, así que el backfill no entra «por la puerta de atrás».

### 4.2 `IRankingSnapshotRepository`

```ts
crearSnapshot(input: {
  fecha: Date;                    // medianoche UTC de la fecha CR
  minAsignadasPodio: number;
  filas: FilaSnapshotInput[];     // ya ordenadas por puesto
}): Promise<{ creado: boolean; filas: number }>;   // creado=false si la fecha ya existía

obtenerPorFecha(fecha: Date): Promise<SnapshotDiaRow | null>;
```

`crearSnapshot` corre en **una transacción** (`prisma.$transaction`): cabecera + `createMany`
de las filas. Todo o nada (R14). La colisión de `fecha` (P2002) se traduce a
`creado: false` **sin propagar** — es el camino esperado de la reejecución, no un error.

### 4.3 DTOs (`lib/types/ranking-snapshot.ts`)

```ts
export interface RankingSnapshotFilaDTO {
  puesto: number;
  posicion: number | null;
  mensajeroId: string;          // NO viaja al archivo de descarga (R34)
  nombre: string;               // congelado
  entregadas: number;
  asignadas: number;
  pct: string | null;           // "96.0" | null — derivado, STRING (R10/R31)
  premioMonto: string | null;   // STRING (R31), nunca Prisma.Decimal
  premioDescripcion: string | null;
}

export interface RankingSnapshotData {
  fecha: string;                // "YYYY-MM-DD"
  generadoAt: string;           // ISO, para mostrar «generado el…» (R24)
  minAsignadasPodio: number;
  filas: RankingSnapshotFilaDTO[];
}
```

## 5. Cron: endpoint, autorización y programación

- Ruta: `app/api/cron/snapshot-ranking/route.ts`, **clon literal** del patrón de
  `corte-diario` / `generar-gastos-fijos`: `bearerToken(req)` contra
  `loadCronConfig().CORTE_DIARIO_SECRET` (el mismo `CRON_SECRET`; ya lo comparten dos
  crons), **antes** de construir el service o tocar la DB. Sin secreto configurado → 401
  (R19). No se inventa otra autenticación.
- Deps inyectables (`getSecret`, `service`, `now`) para testear sin DB ni entorno, igual que
  `GenerarGastosFijosDeps`.
- Respuesta 200: `{ fecha, estado: "creado" | "omitido", filas }` (R20). Sin PII: ni un
  nombre, ni un id.
- Errores: `withErrorHandler` + `appErrorToResponse`, que ya loguea por `defaultLogger` y
  normaliza sin filtrar el secreto (R21/R22).
- `vercel.json`: `{ "path": "/api/cron/snapshot-ranking", "schedule": "0 8 * * *" }`.
  **Las programaciones de Vercel son UTC**; `08:00Z` = **02:00 CR** (UTC−6 fijo, sin
  horario de verano). Se eligen las 02:00 CR y no las 00:00: dos horas después del cambio
  de fecha CR (deja cerrar gestiones de última hora y evita la carrera con el propio cambio
  de día) y dos horas después de `corte-diario`/`generar-gastos-fijos` (`0 6 * * *` =
  00:00 CR), **sin encadenarse** a ellos: si el corte falla, este cron corre igual
  (decisión humana 2, R23).

## 6. Consulta y UI

- Página: `app/(app)/ranking/historico/page.tsx` (Server Component). Rol resuelto
  server-side con `resolveActorFromSession` + `esAccesoTotal`; `mensajero` entra en solo
  lectura; cualquier otro rol o sin sesión → `notFound()` (R27/R28), calcado de
  `app/(app)/ranking/page.tsx:27-36`.
- Fecha por **searchParam** `?fecha=YYYY-MM-DD` (URL compartible, sin estado oculto); sin
  parámetro, D−1 en calendario CR. Selector `<input type="date">` que navega.
- Server Action `lib/actions/ranking-historico.ts` →
  `obtenerRankingHistoricoAction({ fecha })`, con zod (`esFechaCalendarioValida`, R30) en el
  borde. Es una **lectura**, pero se hace Server Action y no ruta API por coherencia con
  `lib/actions/ranking.ts` (mutación interna del propio proyecto, sin CORS).
- Componente cliente `_components/RankingHistoricoModule.tsx`: `DataTable` con columnas
  puesto / posición / mensajero / % del día / entregadas / asignadas / premio, reusando los
  rótulos de `ranking-labels.ts` donde ya existen. Recibe los datos **ya serializados** por
  props (R31).
- Tres estados visibles y **distintos** (R26): filas; «ese día no hubo actividad» (cabecera
  con `filas = 0`); «no se generó el snapshot de esta fecha» (sin cabecera; incluye toda
  fecha anterior al despliegue, decisión humana 3).
- Cabecera del bloque: fecha consultada + «generado el <instante>» (R24).
- **Menú**: subitem «Histórico» bajo el item «Ranking» de `lib/auth/menu-visibility.ts`
  (`children`, patrón Wallet), con los mismos roles `["maestro", "admin", "mensajero"]`. La
  defensa real sigue siendo el `notFound` de la página.
- `/ranking` (vivo) **no cambia** salvo el enlace al histórico: `obtenerRanking` y
  `editarPremio` siguen igual (R36).

## 7. Descarga

Reusa el camino existente, sin generador nuevo: `DataTable.descarga` con
`filasLocales(filas, filaDescargaRankingHistorico)` (**Familia B**: el dataset completo ya
está en el cliente, el histórico no pagina), y
`app/(app)/ranking/historico/_components/ranking-historico-descarga-columnas.ts` como módulo
puro de columnas, espejo de `ranking-descarga-columnas.ts`.

- Columnas: `Puesto`, `Posición`, `Mensajero`, `% del día`, `Entregadas`, `Asignadas`,
  `Premio`. `mensajeroId` **no** sale (R34). El premio **sí** sale aquí —a diferencia del
  vivo, donde vive en otra tarjeta fuera de alcance—: en el histórico es una columna de la
  misma tabla y es justo el dato que hace auditable lo que se pagó.
- Título/nombre de hoja/nombre de archivo: `Ranking del día <fecha>`, de modo que
  `nombreArchivoDescarga` produce `ranking-del-dia-2026-08-09-<hoy>.xlsx` (R35).
- Tope y mensaje accionable: los de `filasLocales`/`descargaConfig.MAX_FILAS` (R33). Aquí es
  una red, no un límite: el conjunto está acotado por el número de mensajeros activos.

## 8. Trazabilidad `R<n>` → test

| R | Test (archivo → comportamiento) |
| --- | --- |
| R1 | `tests/integration/db/ranking-snapshot-migration.test.ts` → la cabecera tiene fecha, generado_at, umbral y filas |
| R2 | `tests/unit/ranking/snapshot-dia.test.ts` → con `now` = 02:00 CR del día D, la fecha objetivo es D−1 |
| R3 | `tests/unit/services/ranking-snapshot-service.test.ts` → el orden congelado coincide con el de `RankingService` sobre los mismos datos |
| R4 | `tests/unit/ranking/orden-ranking.test.ts` → empate total (pct, entregadas, nombre) se desempata por id y dos corridas dan el mismo orden |
| R5 | `tests/unit/services/ranking-snapshot-service.test.ts` → mensajero con 0/0 no produce fila; con actividad, sí |
| R6 | `tests/unit/services/ranking-snapshot-service.test.ts` → la fila persistida lleva las 7 columnas de negocio |
| R7 | `tests/unit/services/ranking-snapshot-service.test.ts` → fila de podio congela monto y descripción vigentes |
| R8 | `tests/integration/db/ranking-snapshot-migration.test.ts` → el CHECK rechaza premio sin posición |
| R9 | `tests/unit/ranking/orden-ranking.test.ts` → bajo umbral: se lista con puesto, sin posición |
| R10 | `tests/unit/ranking/orden-ranking.test.ts` → `formatearPct` y su uso por vivo e histórico; no hay columna de pct |
| R11 | `tests/unit/services/ranking-snapshot-service.test.ts` → día sin actividad escribe cabecera con `filas = 0` |
| R12 | `tests/unit/services/ranking-snapshot-service.test.ts` → segunda corrida devuelve `omitido` y no escribe |
| R13 | `tests/integration/db/ranking-snapshot-migration.test.ts` → los cuatro UNIQUE rechazan el duplicado |
| R14 | `tests/unit/repositories/ranking-snapshot-repository.test.ts` → fallo al insertar filas deja la fecha sin cabecera |
| R15 | `tests/unit/guards/ranking-snapshot-cron.guardia.test.ts` → ni el service ni la ruta admiten fecha por parámetro |
| R16 | `tests/unit/services/ranking-snapshot-service.test.ts` → renombrado posterior: la lectura devuelve el nombre congelado |
| R17 | `tests/integration/db/ranking-snapshot-migration.test.ts` → borrar el usuario con filas falla (RESTRICT) |
| R18 | `tests/integration/db/ranking-snapshot-migration.test.ts` → la migración es aditiva (censo de tablas/columnas preexistentes) |
| R19 | `tests/integration/actions/snapshot-ranking-route.test.ts` → sin/mal/ausente secreto: 401 y el service nunca se construye |
| R20 | `tests/integration/actions/snapshot-ranking-route.test.ts` → 200 con `{fecha, estado, filas}` y sin PII |
| R21 | `tests/integration/actions/snapshot-ranking-route.test.ts` → ni el cuerpo ni el logger contienen el secreto |
| R22 | `tests/integration/actions/snapshot-ranking-route.test.ts` → el service lanza: respuesta de error y `logError` llamado |
| R23 | `tests/unit/guards/ranking-snapshot-cron.guardia.test.ts` → `vercel.json` declara la ruta con schedule distinto al del corte |
| R24 | `tests/components/RankingHistoricoModule.test.tsx` → se muestra el instante de generación |
| R25 | `tests/unit/services/ranking-snapshot-service.test.ts` → las filas salen en el orden de `puesto`, sin reordenar |
| R26 | `tests/components/RankingHistoricoPage.test.tsx` → «sin snapshot» y «sin actividad» pintan mensajes distintos |
| R27 | `tests/components/RankingHistoricoPage.test.tsx` → rol ajeno / sin sesión → `notFound`, sin datos |
| R28 | `tests/components/RankingHistoricoPage.test.tsx` → `mensajero` recibe todas las filas, sin recorte |
| R29 | `tests/unit/guards/ranking-snapshot-cron.guardia.test.ts` → no existe acción de escritura sobre las tablas del snapshot fuera del congelado |
| R30 | `tests/unit/actions/ranking-historico-actions.test.ts` → fecha inválida → rechazo sin llamar al service |
| R31 | `tests/unit/actions/ranking-historico-actions.test.ts` → montos y pct son `string`/`null` |
| R32 | `tests/components/descarga/RankingHistoricoDescarga.test.tsx` → el archivo lleva las mismas filas y orden que la tabla |
| R33 | `tests/components/descarga/RankingHistoricoDescarga.test.tsx` → sobre el tope: sin archivo y mensaje accionable |
| R34 | `tests/unit/descarga/ranking-historico-descarga-columnas.test.ts` → no se proyecta `mensajeroId` |
| R35 | `tests/unit/descarga/ranking-historico-descarga-columnas.test.ts` → el título/nombre de archivo lleva la fecha consultada |
| R36 | `tests/unit/services/ranking-service.test.ts` (existente, sin editar sus asserts) → el vivo no cambia |
| R37 | `tests/integration/db/ranking-snapshot-migration.test.ts` → aplicar y revertir deja el esquema previo |
| R38 | `tests/integration/db/ranking-snapshot-migration.test.ts` → `relrowsecurity` en las dos tablas |

## 9. Alternativas descartadas

**A. Recalcular el histórico al vuelo desde `analytics_daily`** *(la contraria a §1)*.
Descartada por tres razones y una de ellas es dura: la tabla **no tiene** la magnitud
«órdenes asignadas ese día», que es el denominador del ranking, así que la consulta no se
puede escribir sin añadirle una medida nueva (tocando la feature 123 y su guard de
contrato). Sumadas a que el umbral y el premio no tienen historia, un histórico
recalculado **mentiría** sobre lo que se vio y sobre lo que se pagó. Su única ventaja real
—cero almacenamiento nuevo, cero cron— no compra nada aquí: el volumen es de decenas de
filas al día.

**B. Congelar solo el podio (3 filas por fecha).** Descartada por la decisión humana 1: no
responde «¿dónde quedé yo el martes?», que es la pregunta que tiene un mensajero. Además
convertiría la lista completa en un dato irrecuperable por 3 filas de ahorro.

**C. Encolar el congelado como job recurrente en `jobs_cola`** (lo que hace el rollup de la
feature 124, `analitica_rollup_diario`, con `dedupe_key` y reintentos). Es la opción
técnicamente más rica —reintento automático y deduplicación por clave—, y se descarta por
la decisión humana 2 y por coste/beneficio: ata el congelado al drenado de `procesar-jobs`
(un fallo del drenado detiene también esto) y arrastra la maquinaria de recurrencia
—re-agendado, `dedupe_key`, backoff— para un trabajo que dura milisegundos y cuya
idempotencia ya está resuelta **en la base** por `UNIQUE(fecha)`. Un `GET` autenticado con
`CRON_SECRET` es el patrón mayoritario del repo (6 de 7 crons) y el que un humano puede
disparar a mano con `curl` cuando haga falta.

**D. Encadenar el congelado al final de `corte-diario`.** Descartada por la decisión
humana 2: acopla dos trabajos independientes y hace que un fallo del corte (que mueve
dinero) se lleve por delante el ranking (que no lo mueve).

**E. Sobrescribir el snapshot al reejecutar (upsert)** en vez del no-op de R12. Descartada:
la reejecución típica es un **reintento de Vercel** o una invocación manual horas después,
cuando el premio o el umbral ya pueden ser otros; un upsert reescribiría en silencio un
resultado que quizá ya se comunicó y se pagó. «Congelado» y «se puede volver a escribir»
son incompatibles. Fallar con 500 tampoco: dispararía alertas por el camino **esperado** de
un reintento. Por eso: 200 + `estado: "omitido"`.

**F. Una sola tabla plana (sin cabecera)** con `fecha` repetida en cada fila. Descartada
porque deja **indistinguibles** «el cron no corrió» y «ese día no hubo actividad» (ambos
son «cero filas»), que es justo la distinción que R26 exige; y porque no habría dónde
congelar el umbral aplicado ni el instante de generación sin repetirlos N veces.

**G. Guardar el `pct` calculado en la fila.** Descartada por la regla 3 de `analytics_daily`
(nada de tasas persistidas) y porque no aporta: el orden —lo único frágil ante un cambio de
comparador— ya se congela en `puesto`, y numerador y denominador reconstruyen el
porcentaje exacto.

**H. `mensajero_id` nullable con `ON DELETE SET NULL`.** Considerada para que el histórico
sobreviva al borrado de un usuario; descartada porque en este repo **no existe borrado duro
de `usuario`** (el estado es `activo`/inactivo) y porque `RESTRICT` es lo que ya hacen las
cuatro FK de `analytics_daily`: ante la duda, que falle el borrado y no que se corrompa la
historia. El nombre congelado (R16) resuelve el caso real —el renombrado— sin nullable.

## 10. Riesgos y límites conocidos

- **Ventana de desactivación (Q1)**: un mensajero desactivado entre el día y la corrida
  desaparece del snapshot, porque el criterio en vivo solo mira activos.
- **Ventana del premio (Q2)**: se congela el premio vigente **en la corrida**, no a las
  23:59 del día congelado. `generado_at` deja el desfase auditable.
- **Sin backfill (decisión 3)**: toda fecha anterior al despliegue responde «no se generó
  snapshot», y así se rotula en la UI.
- **Silencio del cron**: si el cron deja de correr, nada se rompe —simplemente dejan de
  aparecer fechas—. La detección es la propia pantalla («no se generó snapshot» en una
  fecha reciente) y el 401/500 en los logs de Vercel. Una alerta activa (notificación al
  fallar N días seguidos) queda **fuera de alcance**; ningún cron del repo la tiene hoy.
