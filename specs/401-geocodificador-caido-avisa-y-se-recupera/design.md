# Feature 401 — Diseño

> El QUÉ está en `requirements.md`; el desglose en `tasks.md`. Regla que gobierna todo:
> **arreglar lo evidenciado, no rediseñar.** Lo evidenciado son dos silencios: 19 horas sin que nadie
> se enterara, y 25 jobs muertos que sólo revivieron porque un humano abrió la base de producción.

---

## §0 — La decisión, en cinco frases

1. **Nada de estado nuevo.** La condición de caída se **deriva** de la tabla `jobs`, que ya guarda el
   tipo, el estado, el instante del último cambio y —desde la **ficha 400**— la causa, en forma de
   marcador estable dentro de `last_error`. Sin tabla nueva, sin columna nueva, sin fila de
   configuración global. *(Ésta es la diferencia estructural con la 403, que sí tenía dónde guardarlo:
   `webhook_suscripcion`.)*
2. **La caída se evalúa donde se conoce la causa y sólo cuando hace falta:** en la rama de
   configuración de `GeocodificacionService`, no en el drenador —que corre **cada minuto** sobre una
   tabla sin índice por `tipo`— y no en `JobQueueService`, que sirve a **nueve** tipos de job.
3. **El aviso reutiliza el mecanismo que ya existe** (146/253/262/271/333): un evento nuevo, una fila
   `alert` **por cada uno de los roles `maestro` y `admin`** (decisión del humano del 2026-09-09,
   reutilizando la constante `ROLES_ADMINISTRACION` que ya usan otros cuatro emisores), emitida por un
   notificador `notificar…Con` / `notificar…Real` +
   `emitirBestEffort`, con la **entidad sintética = jornada CR** (convención de la 333, la misma que la
   403 declaró reutilizable).
4. **La recuperación viaja en la estela de un éxito real del proveedor:** cuando una geocodificación se
   resuelve con una llamada satisfactoria, se devuelven a la cola hasta `N` jobs muertos por
   configuración, **los más antiguos primero, escalonados en el tiempo**. Es exactamente el rescate que
   el leader hizo a mano el 2026-09-09, sin abrir la base.
5. **Dos migraciones y ninguna tabla:** los dos valores de enum del aviso, y un índice **parcial** sobre
   `jobs` para que las dos consultas nuevas no sean un escaneo secuencial.

---

## §1 — Frontera explícita con la 403: quién define el mecanismo y quién lo consume

Lo pide la ficha, así que se dice sin rodeos:

| Pieza | Quién la **define** | Quién la **consume** |
| --- | --- | --- |
| El patrón `notificar<X>Con` / `notificar<X>Real` + `emitirBestEffort`, el `notificadorNoOp` como default y la regla «el composition root inyecta el real» | **Ya existe en el árbol** desde la feature **146** (`lib/notificaciones/notificadores.ts`), ampliado por 253/262/271/333. **Ni 401 ni 403 lo crean.** | 401 y 403, cada una añadiendo **su propio par**, sin tocar los ocho existentes |
| La convención de `entidadTipo` **sintético sin fila real** (para que la dedupe no mate el segundo aviso) | La **ficha 333** (`gasto_fijo_cobro_dia`); la 403 la declaró explícitamente reutilizable en su §4.1 | 401 la aplica con `geocodificacion_caida_dia` (§3.1) |
| El **criterio de razonamiento del umbral** (elegir el eje, poner un piso de evidencia contra el dato aislado, declarar el límite conocido) | La **ficha 403** §3, como plantilla | 401 lo aplica **con sus propios datos**; ver §4 |
| Los **números** del umbral (3 fallos consecutivos **y** ≥24 h sin entrega exitosa) | La 403, calibrados sobre el histórico de **webhooks** | **Nadie más.** 401 **no los hereda**: mide los suyos, y además **descarta el segundo eje entero** por una razón medida (§4.2) |
| El estado del circuito (`fallosConsecutivos` / `sinExitoDesde` en `webhook_suscripcion`) | La 403 | **Sólo la 403.** No existe una tabla equivalente para el geocodificador y 401 **no crea una** |

**No hay dependencia de código en ninguna dirección.** 401 no importa nada de la 403 ni al revés, y
`feature_list.json` no declara relación entre ellas. El **único** acoplamiento real es que las dos
añaden valores a los mismos dos enums de notificación; se resuelve por regla de orden en §3.3, no por
dependencia.

---

## §2 — Frontera explícita con la 400: elegibilidad vs. estado

La 400 es `depends_on` y deja hecho el trabajo duro: un **marcador estable** (`lib/geo/fallo-config-geocode.ts`,
prefijo constante + `marcarFalloConfigGeocode()` + `esFalloConfigGeocode()`) que viaja hasta
`jobs.last_error` y sobrevive al recorte de 500 caracteres.

| | Ficha 400 | Ficha 401 |
| --- | --- | --- |
| **Escribe** el marcador en fallos nuevos | Sí (`GeocodificacionService`, dos caminos) | **Nunca** (R33) |
| **Añade** el marcador a filas legadas | Sí, con `scripts/backfill-marcador-config-geocode.ts`, idempotente y de un solo uso | **Nunca**, y no lo automatiza |
| **Lee** el marcador | Sí, en el gate de asignabilidad | Sí, para contar evidencia y para elegir a quién revivir |
| **Cambia** `estado` / `intentos` / `run_after` de un job | **Nunca** — R18 de la 400 lo prohíbe explícitamente | **Sí, y sólo ella** |

### 2.1 — El solapamiento con el backfill de la 400: no lo hay, y quién manda

Se comprobó frase por frase contra la 400 (§7 y R17/R18): **su operación sólo añade el marcador y no
toca `estado`, `intentos`, `run_after`, `dedupe_key` ni `payload`.** La recuperación de la 401 sólo
toca `estado`, `intentos`, `run_after`, `locked_at` y `last_error` **de filas que ya llevan el
marcador**. Los dos conjuntos de columnas son **disjuntos**, y la relación es de composición, no de
competencia:

> **La 400 manda sobre la ELEGIBILIDAD (quién lleva el marcador). La 401 manda sobre el ESTADO (quién
> vuelve a la cola). Si las dos corren a la vez sobre la misma fila, el resultado es el mismo en
> cualquier orden: primero elegible y luego revivida, o revivida cuando ya era elegible.**

Un único cruce a declarar: la recuperación **limpia `last_error`** (R15, y es lo que hizo el rescate
manual). Si el backfill de la 400 corriera **después**, esa fila ya no encajaría en su `WHERE` —que
exige la prosa legada— así que no la volvería a tocar. **No hay pérdida ni doble escritura.** Y en el
otro orden tampoco: el backfill deja el marcador, y la 401 revive.

**Consecuencia práctica, declarada:** un job `failed` con la prosa legada y **sin** marcador **nunca**
será recuperado por la 401. Cerrarlo exige correr la operación de la 400; medido el 2026-09-09, hoy hay
**cero** filas en esa condición (pregunta abierta Q4).

---

## §3 — Modelo de datos

### 3.1 — Cero tablas, cero columnas. Se deriva de `jobs`

Todo lo que la regla necesita ya está en la fila del job:

| Dato | Columna | Quién lo escribe hoy |
| --- | --- | --- |
| Es de geocodificación | `tipo = 'geocodificacion'` | `enqueue` (feature 91) |
| Murió / sigue vivo | `estado` | `JobQueueService.manejarFallo` → `JobRepository.fail` |
| **Por qué** murió | `last_error` con el marcador al principio | **Ficha 400** |
| **Cuándo** fue su último fallo | `updated_at` (lo reescribe `fail()` en cada intento) | Feature 90 |

Verificado en `lib/repositories/JobRepository.ts:148-167`: las **dos** ramas de `fail()` escriben
`updated_at = CURRENT_TIMESTAMP`, así que `updated_at` es el ancla temporal correcta y **no hace falta
inventar ninguna**.

> Alternativa descartada aquí mismo: usar `created_at` como ancla. No sirve — es la fecha de encolado,
> no la del fallo, y un job creado antes del corte que muere durante el corte quedaría fuera de
> cualquier ventana de recencia. *(Memoria del repo: «una fecha mutable de otra tabla no sirve de
> ancla»; aquí el ancla es la del propio job y la escribe la propia cola.)*

### 3.2 — Una migración de índice PARCIAL sobre `jobs`

Hoy `jobs` tiene exactamente **dos** índices (`20260717120000_jobs_cola/migration.sql:33,39`):
`jobs_run_after_pending_idx` (parcial, `WHERE estado = 'pending'`) y el único parcial de `dedupe_key`.
**No hay índice por `tipo`, ni por `estado`, ni por `updated_at`**, y las filas de `jobs` **no se
purgan**. Las dos consultas nuevas serían un escaneo secuencial sobre una tabla que sólo crece — el
anti-patrón que `docs/architecture.md` rechaza.

```
db/migrations/20260910110000_jobs_geocodificacion_salud_idx/migration.sql
```

```sql
CREATE INDEX "jobs_geocodificacion_estado_updated_idx"
  ON "jobs" ("estado", "updated_at")
  WHERE "tipo" = 'geocodificacion';
```

`down.sql`: `DROP INDEX IF EXISTS "jobs_geocodificacion_estado_updated_idx";`

- **Parcial y no pleno:** `geocodificacion` es uno de nueve tipos; el índice sólo cubre sus filas y no
  engorda las escrituras de los otros ocho. Es el mismo criterio (y el mismo estilo a mano) del
  `jobs_run_after_pending_idx` que ya existe — **Prisma no expresa índices parciales**, así que
  `db/schema.prisma` **no cambia por esto** y no hay drift.
- **Sirve a las dos consultas** de §5.1: `(estado, updated_at)` cubre tanto `estado IN (…) AND
  updated_at >= …` como `estado = 'failed' … ORDER BY updated_at ASC LIMIT k`.
- **Consecuencia de proceso:** hay migración ⇒ `./init.sh --rapido` **se niega solo** y el gate
  completo es obligatorio (regla 5 de `CLAUDE.md`). Está en `tasks.md`.

### 3.3 — Una migración de enum, y la regla de orden frente a la 403

```
db/migrations/20260910120000_notificacion_evento_geocodificacion_caida/migration.sql
```

```sql
ALTER TYPE "notificacion_evento"       ADD VALUE IF NOT EXISTS 'geocodificacion_caida';
ALTER TYPE "notificacion_entidad_tipo" ADD VALUE IF NOT EXISTS 'geocodificacion_caida_dia';
```

Va **sola y con timestamp propio** por el `55P04` de Postgres (no se puede USAR un valor de enum en la
misma transacción que lo añadió), igual que las fichas 237/239/240/253/262/271/333. `db/schema.prisma`
gana los dos valores en `NotificacionEvento` y `NotificacionEntidadTipo`.

**`geocodificacion_caida_dia` es un `entidad_tipo` SIN fila real detrás**, como `gasto_fijo_cobro_dia`
(333) y como el que propone la 403. Es deliberado y necesario: `notificacion_dedupe_key` es UNIQUE
sobre `(evento, entidad_id, destinatario_rol, destinatario_usuario_id)` con `NULLS NOT DISTINCT` y
`WHERE entidad_id IS NOT NULL`, y `NotificacionRepository.crear` **absorbe** el `P2002` devolviendo
`false`. Con una entidad que no cambiara entre jornadas, el aviso del segundo día **no saldría jamás,
en silencio** — el fallo exacto que documentaron la 262 y la 333. Con la **jornada CR** como entidad:

- jornadas distintas ⇒ entidades distintas ⇒ el aviso del día siguiente sale siempre (**R10**);
- mismo minuto, mismo día ⇒ misma entidad ⇒ **un solo aviso por rol** (**R9**) — y esto no es
  cosmético: el drenador corre **cada minuto**, así que sin esto el corte medido habría producido
  **~2.280 filas** (~1.140 evaluaciones × 2 roles).
- Y no es `entidad_id = NULL`: con `null`, `emitirFilas` se salta la guardia previa y el índice único
  es **parcial**, así que saldría un aviso por evaluación.

**`destinatario_rol` está DENTRO de la clave de dedupe**, así que los dos destinatarios (§7.1) se
deduplican de forma **independiente**: la fila del `maestro` y la del `admin` conviven, y que uno lea la
suya no suprime la del otro (**R9**). Es la misma propiedad de la que ya dependen los cuatro emisores
multi-rol vigentes (`postulacion_mensajero_pendiente`, `postulacion_recurso_pendiente`,
`cierre_dia_por_aprobar`, `cierre_dia_vencido`).

#### La regla de orden con la 403 (memoria «el `down.sql` borra los valores posteriores»)

La 403 añade **sus propios dos valores** a **los mismos dos enums** (`notificacion_evento` y
`notificacion_entidad_tipo`). *Los nombres exactos los fija la 403 y aquí no se citan a propósito: esa
ficha revisó su decisión central el 2026-09-09 —ahora **pausa** la suscripción en vez de desactivarla—,
así que sus literales pueden haber cambiado. La regla de abajo **no depende de cómo se llamen**: se
resuelve leyendo `db/schema.prisma` de `origin/dev` al abrir el PR.* Regla, sin ambigüedad:

1. **No se toca ningún `down.sql` anterior.** Cada uno es una foto de su momento
   (`20260727120000_notificacion` sólo dropea; los de 253/262/271/333 recrean-con-lista la foto de su
   rama). Ninguno cambia por esta ficha.
2. **El `down.sql` de ESTA migración lista los enums tal como estén en `db/schema.prisma` en el momento
   de mergear a `dev`.** Si la 403 ya está mergeada, sus dos valores **entran** en la lista; si no,
   no. Se decide **al abrir el PR**, no al escribir el spec — y se verifica leyendo el árbol, no la
   memoria (`tasks.md` T5).
3. **El timestamp de la carpeta debe ser posterior** a cualquier migración de enum ya mergeada. Si la
   403 entra antes con `20260909130000`, `20260910120000` sigue siendo posterior y no hay que
   renumerar. **Renumerar una migración ya aplicada deja una fila fantasma** (memoria del repo): si el
   conflicto apareciera, se crea una carpeta con timestamp nuevo, nunca se renombra la existente.
4. **Precondición ruidosa del down**, en el mismo tono que el de la 333: ninguna fila de `notificacion`
   con `evento = 'geocodificacion_caida'` ni `entidad_tipo = 'geocodificacion_caida_dia'`. Si quedara
   alguna, el `USING` del `ALTER COLUMN` falla ruidosamente y el rollback aborta. **Es el
   comportamiento correcto**: son avisos de un servicio caído que ni el `maestro` ni los `admin` tienen
   por qué haber leído todavía.
   **Ni un `DELETE` ni un `UPDATE` «para hacer sitio».**

### 3.4 — RLS, rutas y endpoints

- **RLS:** no se crea ninguna tabla. `jobs` conserva su RLS habilitada sin policies (sólo service role)
  y `notificacion` la suya (146). Todo lo de esta ficha corre server-side dentro del cron ya
  autenticado por `CRON_SECRET`. **Cero policies nuevas.**
- **Rutas / endpoints / Server Actions:** **ninguna nueva**. El único disparador sigue siendo el cron
  ya existente `GET /api/cron/procesar-jobs` (Vercel Cron, `* * * * *`), sin cambios en su contrato,
  su autorización ni su respuesta. La notificación se lee por la campana ya existente.
- **Contrato HTTP:** sin cambios. `DrenarResult` **no** gana campos (eso acoplaría el drenador genérico
  al vocabulario de la geocodificación; ver §7-A3).

---

## §4 — El umbral, medido sobre el histórico de la geocodificación

> La 403 presta el **criterio**, no los números. Aquí se miden los propios y se justifican uno a uno.

### 4.1 — Los datos

| Hecho medido | Valor |
| --- | --- |
| Volumen diario de jobs `geocodificacion` `done`, 26-ago → 8-sep | **entre 2 y 269 por día** (razón 1:135) |
| Duración del corte | **19 h 55 min** (08-sep 19:40 → 09-sep 15:35) |
| Jobs acumulados con causa `config_invalida` durante el corte | **48** (25 `failed` + 23 `pending`) |
| ⇒ **tasa de llegada durante el corte** | **≈ 2,4 jobs/hora** |
| Fallos por día durante el corte | 8-sep: **25**; 9-sep: **23** |
| Intentos por job antes del dead-letter | **8** (`GEOCODIFICACION_MAX_INTENTOS`), backoff 1-2-4-8-16-32-60 min |
| Rescate manual una vez restaurada la credencial | 42 geocodificaciones en **~6 min** |

### 4.2 — Por qué NO se copia el segundo eje de la 403 («≥24 h sin entrega exitosa»)

**Porque para la geocodificación ese eje es un falso negativo estructural, y está medido en el propio
código.** Un job de geocodificación puede terminar `done` **sin tocar al proveedor**, por tres caminos
que siguen funcionando perfectamente durante un corte de credencial
(`lib/services/GeocodificacionService.ts:76-112`):

- **acierto de la caché** `geocode_cache` (`findByHash` → se escribe la orden y se completa el job,
  «SIN tocar la red ni pagar»);
- **`SIN_DIRECCION`** (la orden se quedó sin dirección entre el encolado y la ejecución);
- **orden inexistente o borrada** (el job se completa sin error).

Una condición del tipo «no ha habido ningún éxito en la ventana» **se apagaría con el primer acierto de
caché** y el aviso no saldría nunca. En una suscripción de webhook eso no pasa: allí el único camino a
`ok` es una entrega real al destino. **El eje no transfiere.** Se sustituye por un eje de **recencia**,
que no depende de que haya o no éxitos.

### 4.3 — Eje elegido: **jobs distintos** dentro de una **ventana de recencia**

**Umbral = 3 jobs de geocodificación distintos** cuyo último error lleva el marcador y cuyo último
fallo cae dentro de una **ventana de 60 minutos**.

**Por qué se cuentan JOBS DISTINTOS y no INTENTOS — y es la decisión que evita el ruido.**
Un solo job reintenta **hasta 8 veces** con backoff 1-2-4-8-16-32-60 min. Contando intentos, **una sola
orden** cruzaría un umbral de 3 en **tres minutos** — que es exactamente el «fallo aislado» que la ficha
prohíbe avisar. Contando jobs distintos hacen falta **tres direcciones distintas** rechazadas, y eso ya
no es un pico: `config_invalida` es **global y determinista** (la petición ni siquiera evalúa la
dirección), así que tres direcciones distintas rechazadas es la firma de un corte, no de un tropiezo.

**Por qué 3 y no 1.** Además del argumento anterior, el marcador de la 400 cubre **también** «falta
`GOOGLE_MAPS_API_KEY`». Esa condición aparece de forma legítima y momentánea en ventanas de despliegue
y en entornos mal configurados; con umbral 1, un despliegue produce un aviso falso.

**Por qué 3 y no 10 o 20.** A la tasa medida del incidente (**2,4 jobs/h**):

| Umbral | Latencia del aviso en el incidente medido |
| --- | --- |
| 1 job | inmediato — pero avisa por cualquier despliegue sin credencial |
| **3 jobs** | **≈ 75 min** |
| 10 jobs | ≈ 4 h |
| 20 jobs | ≈ 8 h |
| *(hoy)* | **19 h 55 min, y sólo porque un humano lo notó** |

**Por qué la ventana es 60 minutos.** Dos razones, las dos numéricas:

1. **Suelo:** el backoff de la cola **topa en `JOBS_BACKOFF_CAP_MS = 3.600.000 ms` (60 min)**. Un job
   vivo por esta causa refresca su `updated_at` **como mucho cada 60 minutos**. Una ventana más corta
   empezaría a perder de la cuenta jobs que siguen fallando, sólo porque su siguiente reintento aún no
   ha llegado. **60 min es el mínimo que garantiza que todo job aún vivo siga contando.**
2. **Techo:** una ventana larga (24 h, como la de la 403) mantendría contando jobs `failed` de un corte
   **ya resuelto** y volvería a avisar al día siguiente sin motivo. Con 60 min la condición **se apaga
   sola** una hora después del último fallo con marcador: **autolimpiante, sin estado que mantener y sin
   ningún «reset» que alguien pueda olvidar**.

**Resultado esperado frente al incidente que origina la ficha: aviso a ≈75 minutos en vez de 19 horas.**

### 4.4 — Límite conocido, declarado y aceptado

En el día de volumen **mínimo** medido (**2 jobs/día**) el umbral de 3 jobs distintos **no se alcanza**
y un corte ocurrido ese día **no se avisa**. Es deliberado:

- el daño son **2 órdenes**, y con la **400** desplegada esas 2 órdenes ya son **asignables sin
  ubicación**: no bloquean a nadie;
- bajar el umbral a 1 compraría ese caso al precio de un aviso falso por cada despliegue sin credencial;
- si el corte dura, el día siguiente traerá más órdenes y el umbral se alcanzará entonces.

Queda como **pregunta abierta Q5**, no como agujero escondido.

---

## §5 — Dónde vive cada cosa

```
lib/config/geocode-salud.ts                          (nuevo)  los 5 números, con defaults
lib/interfaces/repositories/IGeocodeSaludRepository.ts (nuevo) contar / revivir
lib/repositories/GeocodeSaludRepository.ts            (nuevo)  las dos sentencias SQL
lib/interfaces/services/IGeocodeSaludService.ts       (nuevo)  2 métodos + geocodeSaludNoOp
lib/services/GeocodeSaludService.ts                   (nuevo)  la REGLA (pura) + el aviso + la recuperación
lib/notificaciones/emitir.ts                          (ext.)   emitirGeocodificacionCaida
lib/notificaciones/notificadores.ts                   (ext.)   notificarGeocodificacionCaidaCon/Real
lib/services/GeocodificacionService.ts                (ext.)   1 colaborador nuevo, 3 llamadas
lib/services/jobs/geocodificacion-handler.ts          (ext.)   COMPOSITION ROOT
db/schema.prisma                                      (ext.)   2 valores de enum
db/migrations/…_jobs_geocodificacion_salud_idx/       (nuevo)  índice parcial
db/migrations/…_notificacion_evento_geocodificacion_caida/ (nuevo) los 2 valores
```

**No se tocan:** `lib/services/JobQueueService.ts`, `lib/repositories/JobRepository.ts`,
`lib/interfaces/repositories/IJobRepository.ts`, `lib/clients/google-geocode.ts`,
`lib/config/geocode.ts`, `app/api/cron/procesar-jobs/route.ts`,
`lib/services/AsignabilidadCoordenadasService.ts`, ni nada bajo `app/(app)/`.

### 5.1 — El repositorio: estrecho y propio, no `IJobRepository`

`IJobRepository` es el contrato **genérico** de la cola, compartido por las features 90/91/92/99, y su
propia documentación **se niega a crecer** (*«NO se añaden `cancel` ni `reschedule` a esta interfaz […]
sin tocar un contrato compartido»*). Se respeta ese precedente: la 401 abre un repositorio **propio y
estrecho** sobre la misma tabla, con vocabulario de geocodificación.

```ts
// lib/interfaces/repositories/IGeocodeSaludRepository.ts
export interface IGeocodeSaludRepository {
  /**
   * R2/R3: jobs de geocodificacion DISTINTOS, no completados, cuyo `last_error` empieza por el
   * marcador de la 400 y cuyo ultimo fallo es posterior a `desde`. `excluirJobId` es el job EN
   * CURSO, cuyo fallo todavia no esta persistido (ver §5.3).
   */
  contarFallosConfigDesde(desde: Date, excluirJobId: string): Promise<number>;

  /**
   * R13/R15/R19/R21/R22/R24: devuelve a `pending` hasta `limite` jobs `failed` con el marcador,
   * los mas ANTIGUOS primero, sin tocar los modificados despues de `tocadoAntesDe`.
   * `run_after` ESCALONADO desde `ahora` cada `espaciadoMs`. Devuelve cuantos revivio.
   */
  revivirFallosConfig(opts: {
    ahora: Date; limite: number; espaciadoMs: number; tocadoAntesDe: Date;
  }): Promise<number>;
}
```

**Las dos sentencias** (`lib/repositories/GeocodeSaludRepository.ts`, estilo `JobRepository`: SQL crudo
parametrizado, sin lógica de negocio):

```sql
-- contarFallosConfigDesde
SELECT COUNT(*)::int AS n
FROM "jobs"
WHERE "tipo"   = 'geocodificacion'
  AND "estado" IN ('pending','processing','failed')
  AND "updated_at" >= $desde
  AND "id" <> $excluirJobId
  AND left("last_error", $len) = $marcador;
```

```sql
-- revivirFallosConfig — DOS CTEs Y EL `UPDATE`. NO se colapsan. Ver el aviso de abajo.
WITH elegibles AS (
  SELECT "id", "updated_at"
  FROM "jobs"
  WHERE "tipo"   = 'geocodificacion'
    AND "estado" = 'failed'
    AND "updated_at" < $tocadoAntesDe
    AND left("last_error", $len) = $marcador
  ORDER BY "updated_at" ASC
  LIMIT $limite
  FOR UPDATE SKIP LOCKED          -- el BLOQUEO va aqui, y aqui NO hay funcion de ventana
),
candidatos AS (
  SELECT "id", row_number() OVER (ORDER BY "updated_at" ASC) AS pos
  FROM elegibles                  -- la VENTANA va aqui, sobre el conjunto ya bloqueado y acotado
)
UPDATE "jobs" AS j
SET "estado"     = 'pending',
    "intentos"   = 0,
    "last_error" = NULL,
    "locked_at"  = NULL,
    "run_after"  = $ahora + (c.pos * $espaciadoMs) * interval '1 millisecond',
    "updated_at" = $ahora
FROM candidatos c
WHERE j."id" = c."id"
RETURNING j."id";
```

> ### ⚠️ POR QUÉ SON DOS CTEs Y NO UNA: **`FOR UPDATE` y `row_number()` NO PUEDEN CONVIVIR EN LA
> MISMA `SELECT`.** Colapsarlas **no compila en tiempo de ejecución.**
>
> **La primera versión de este documento publicaba la forma colapsada** —`row_number()` y
> `FOR UPDATE SKIP LOCKED` en la misma `SELECT`— y **no corre**. Medido el 2026-09-09 contra
> Postgres, ejecutando esa CTE tal cual estaba escrita aquí:
>
> ```
> Raw query failed. Code: `0A000`.
> Message: `FOR UPDATE no está permitido con funciones de ventana deslizante`
> ```
>
> **Es la misma restricción que ya obligó a partir en tres el `claimBatch` de `JobRepository`** (la
> 402 lo dejó documentado en su propio comentario: *«Postgres prohibe `FOR UPDATE` junto a funciones
> de ventana en la MISMA `SELECT` … Colapsarlas revienta en tiempo de ejecución»*). El turno se
> calcula sin bloqueo, el conjunto se recorta con `LIMIT`, y el bloqueo se aplica sobre ese conjunto
> ya fijado — o, como aquí, al revés: se bloquea y acota primero y se numera después. Las dos formas
> valen; **la colapsada no**.
>
> **PROHIBIDO FUNDIRLAS «para que quede más corto».** Y el motivo por el que esto se escribe con
> mayúsculas es que el fallo sería **MUDO**: `revivirFallosConfig` lanzaría, la llamada está envuelta
> a propósito para que no cambie el desenlace del job (§5.3, R20), y el logger que el composition
> root inyecta hoy es el no-op. Resultado: la recuperación deja de funcionar, ninguna prueba del
> camino de producción se pone roja y no queda ni una línea de log — exactamente la familia de
> fallos que esta ficha existe para cerrar.
>
> Lo que **no** cambia respecto de la versión colapsada: el `WHERE` es el mismo, el `ORDER BY
> "updated_at" ASC` (R19) es el mismo, el `LIMIT` (R21) es el mismo, el `FOR UPDATE SKIP LOCKED`
> sigue estando y el escalonado por `row_number()` (R22) sigue siendo el mismo. **Sólo cambia en qué
> CTE vive cada cosa.**

Cuatro decisiones dentro de esas sentencias, cada una con su porqué:

- **`left("last_error", $len) = $marcador` y no `LIKE '…%'`.** Es la traducción SQL **exacta** del
  `startsWith` que la 400 define como única forma de detectar el marcador, y evita de raíz el escapado
  de `LIKE` (memoria del repo: «todo lo inline pierde una capa»). `$marcador` y `$len` se **derivan del
  módulo de la 400**: ni un literal copiado (R13 de la 400 lo prohíbe, y hay un guard suyo que lo
  vigila).
- **`FOR UPDATE SKIP LOCKED`**, igual que `claimBatch`: dos corridas del drenador solapadas **no**
  reviven el mismo job dos veces, ni se esperan la una a la otra. Va en la CTE `elegibles`, **no** en
  la que numera: ver el aviso de arriba.
- **`locked_at = NULL`.** Una fila `failed` puede arrastrar un `locked_at` viejo; el rescate manual del
  09-09 dejó las filas limpias y esto lo replica. No afecta al rescate por visibility timeout (que sólo
  mira `estado = 'processing'`), pero deja la fila indistinguible de una recién encolada.
- **`estado IN ('pending','processing','failed')` en el conteo**, es decir «no completados». Un job
  `done` con marcador es la **fotografía de un intento anterior ya superado** (mismo razonamiento con
  el que la 400 excluye `done` de su paso del gate): contarlo sería contar un corte que ya terminó.

> **Memoria del repo: «probar el `WHERE` donde vive».** Estas dos sentencias **no son verificables con
> dobles**: un test de servicio con un repo falso pasa en verde aunque el `WHERE` esté mutado. Por eso
> R15/R16/R19/R21/R22/R23/R24 se prueban en `tests/integration/db/geocode-recuperacion.test.ts` contra
> Postgres real, con filas sembradas por el propio test y **fallando si no las encuentra** (memoria
> «test de integración verde sin datos»).

### 5.2 — El servicio de salud: la regla, el aviso y la recuperación

```ts
// lib/interfaces/services/IGeocodeSaludService.ts
export interface IGeocodeSaludService {
  /** Un intento acaba de morir por configuracion propia: evalua y, si toca, avisa (R2/R3/R7). */
  registrarFalloConfig(jobId: string, ahora: Date): Promise<void>;
  /** El proveedor respondio bien: devuelve a la cola hasta N jobs muertos (R13). */
  registrarExitoProveedor(ahora: Date): Promise<number>;
}
/** DEFAULT de `GeocodificacionService`: no hace nada, no toca la base. */
export const geocodeSaludNoOp: IGeocodeSaludService = { … };
```

`lib/services/GeocodeSaludService.ts` lo implementa recibiendo por constructor
`IGeocodeSaludRepository`, `GeocodeSaludConfig`, un `GeocodificacionCaidaNotificador` **cuyo default es
`notificadorNoOp`**, un `GeocodeLogger` y `now`. La regla es una función **pura** dentro del módulo:

```ts
function hayCaida(jobsConMarcador: number, config: GeocodeSaludConfig): boolean {
  return jobsConMarcador >= config.GEOCODE_CAIDA_JOBS_MINIMOS;
}
```

La ventana no entra en la función porque **ya está aplicada en el `desde` de la consulta**: separar «qué
se cuenta» (repositorio) de «cuánto basta» (servicio) es lo que hace la regla testeable sin base.

`registrarFalloConfig`:

```
otros = repo.contarFallosConfigDesde(ahora - VENTANA, jobId)
si !hayCaida(otros + 1, config): return                 // R4
await notificar({ afectados: otros + 1, diaCR: fechaCalendarioCR(ahora) })   // R7-R10
logger.warn("[geocodificacion] caida por configuracion detectada")           // agregado, sin PII
```

`registrarExitoProveedor`:

```
n = repo.revivirFallosConfig({ ahora, limite: LOTE, espaciadoMs: ESPACIADO,
                               tocadoAntesDe: ahora - ENFRIAMIENTO })
si n > 0: logger.warn(`[geocodificacion] recuperados ${n} job(s) muertos por configuracion`)
return n
```

### 5.3 — Los tres puntos de llamada, y el off-by-one dicho en voz alta

`GeocodificacionService` gana **un** parámetro opcional de constructor
(`private readonly salud: IGeocodeSaludService = geocodeSaludNoOp`) y **tres** llamadas:

| Punto (`GeocodificacionService.ejecutar`) | Llamada | Requisito |
| --- | --- | --- |
| `case "config_invalida"` (`:168-173`), **antes** del `throw` | `salud.registrarFalloConfig(job.id, now)` | R2 |
| credencial ausente (`:114-118`), **antes** del `throw` | `salud.registrarFalloConfig(job.id, now)` | R2 — es el otro camino que la 400 marca |
| `case "ok"` (`:123-140`), **después** de persistir cache y orden | `salud.registrarExitoProveedor(now)` | R13 |

Y **tres puntos donde deliberadamente NO se llama**: el acierto de caché (**R14** — no prueba nada del
proveedor y es justo lo que sigue funcionando durante un corte), los tres desenlaces deterministas de
dirección (**R17**), y `case "transitorio"` (**R5**).

> **EL OFF-BY-ONE, EXPLÍCITO PARA QUE UN TEST LO FIJE.** Cuando el service está en la rama de
> configuración, el fallo del job **en curso todavía no está persistido**: `fail()` corre después, en
> `JobQueueService.manejarFallo`. Por eso la consulta **excluye ese `jobId`** y el servicio compara
> `otros + 1` contra el umbral. Sin esa exclusión el job en curso podría contarse dos veces (si trae un
> marcador de un intento anterior) o cero (si es su primer fallo), y el umbral efectivo bailaría entre
> 2 y 4 según el intento. Es exactamente el tipo de fallo mudo que este repo colecciona.

Las tres llamadas van envueltas de forma que **no pueden cambiar el desenlace del job** (R11/R20): el
aviso ya es best-effort por construcción (`emitirBestEffort`), y `registrarExitoProveedor` se llama
dentro de un `try/catch` que registra con contexto y sigue —nunca un `catch` vacío
(`docs/conventions.md`)—. **LA COLA MANDA, EL AVISO Y EL RESCATE SON CORTESÍA.** La dirección contraria
sería mucho peor: una recuperación caída revertiría una geocodificación buena que ya está escrita.

### 5.4 — Por qué la evaluación NO vive en el drenador ni en `JobQueueService`

- **En el route handler del cron, al final de `drenar()`:** ese cron corre **cada minuto**
  (`* * * * *`). Sin índice por `tipo`, sería un escaneo secuencial por minuto sobre una tabla que no
  se purga: el anti-patrón «queries sin índice en crons frecuentes» de `docs/architecture.md`.
  Gatearlo con `result.fallidos > 0` no sirve: durante el incidente de la **403** hubo ~17 fallos de
  webhook por hora, así que el gate estaría abierto casi todos los minutos.
- **En `JobQueueService`:** sirve a **nueve** tipos de job y no conoce —ni debe— qué es una
  geocodificación. Es el mismo argumento con el que la 403 dejó su circuito fuera de ahí.
- **En la rama `config_invalida`:** **cero consultas** cuando no pasa nada, y ~2-3 por hora durante un
  corte. Es donde la causa se conoce con certeza y sin leer prosa.

---

## §6 — La recuperación: anti-tormenta y anti-bucle, con números

### 6.1 — El disparador, y por qué la caché no cuenta

**Sólo un `case "ok"` del proveedor** dispara la recuperación (R13/R14). Es la única señal fiable de
«volvió»: prueba que **esta credencial**, **ahora**, obtiene respuesta. Y hay siempre quien la produzca
mientras queden jobs vivos: durante el corte medido, **23 de los 48 jobs seguían en `pending`** y sus
propios reintentos son la sonda natural — el primero que corra tras la restauración dispara la
recuperación sin que llegue ninguna orden nueva.

**La caché queda fuera a propósito**: un acierto de `geocode_cache` se resuelve «SIN tocar la red ni
pagar» y por tanto **sigue funcionando durante el corte**. Tomarlo como prueba de recuperación
reviviría jobs con el proveedor todavía caído, y cada uno quemaría sus 8 intentos.

### 6.2 — La tormenta de reintentos, evitada con dos números medidos (R21/R22)

**El riesgo, cuantificado.** `JOBS_BATCH_SIZE = 10` por corrida, el cron corre **cada minuto**, y
`claimBatch` ordena por **`run_after ASC`** (`JobRepository.ts:111`). Reviviendo los **25** jobs del
incidente con el mismo `run_after`, ocuparían **las tres corridas siguientes casi enteras** (25/10) y
dejarían a los otros ocho tipos sin turno durante ~3 minutos. Eso es literalmente el enunciado de la
**ficha 402**, y esta ficha no debe causarlo.

| Palanca | Valor | Por qué ese |
| --- | --- | --- |
| **Lote máximo por éxito** (`GEOCODE_RECUPERACION_LOTE`) | **5** | La mitad del lote del drenador (10). Aunque toda una tanda cayera en la misma corrida —no puede, ver abajo—, quedarían **5 turnos** para los otros ocho tipos. |
| **Separación entre revividos** (`GEOCODE_RECUPERACION_ESPACIADO_MS`) | **60.000 ms** | Es **exactamente el intervalo del cron**. Con `run_after` escalonado cada minuto, **como mucho UNO de la tanda es reclamable en cada corrida**: ≤ **1 de 10** turnos, ≥9 para los demás tipos. Es una invariante **verificable sobre los `run_after` generados**, no una esperanza. |

**Cota superior en el peor caso, con los datos medidos:** el día más cargado tuvo **269**
geocodificaciones (≈11/h). Con lote 5, el techo son **55 revividos/hora ≈ 0,9 por corrida**: menos de un
job por lote de 10, de media. Tandas solapadas pueden meter puntualmente 2 en una corrida; el techo duro
sigue siendo 5 por éxito.

**El coste, dicho sin adornos:** los 25 jobs del incidente se recuperarían en **~25-30 minutos** en vez
de los ~6 minutos del rescate manual. Se acepta a sabiendas: los 6 minutos costaron **abrir la base de
producción a mano**, que es justo lo que esta ficha elimina.

### 6.3 — El bucle infinito: inalcanzable por construcción, y además acotado

**Primero, por construcción.** El conjunto elegible y el conjunto «dirección mala» son **disjuntos**, y
no por una lista de exclusiones que alguien deba mantener:

- una dirección irresoluble **nunca produce un job `failed`**: `ZERO_RESULTS`, `INVALID_REQUEST` y
  `SIN_DIRECCION` **completan** el job (`done`) y escriben `orden.geocode_status`
  (`GeocodificacionService.ts:141-162`). El gate de la 92 ya se apoya en eso;
- la recuperación exige `estado = 'failed'` **y** marcador, y el marcador sólo lo emite la 400 en los
  dos caminos de configuración propia. **Una dirección mala no puede entrar.**

**Segundo, en el ciclo de vida.** Un job revivido tiene exactamente tres desenlaces:

| Desenlace | Efecto sobre la elegibilidad |
| --- | --- |
| Éxito (`ok`) o desenlace determinista | `done` ⇒ **sale del conjunto para siempre** |
| Falla por causa **ajena** a la configuración | `fail()` **sobrescribe** `last_error` sin marcador ⇒ **nunca vuelve a ser elegible** |
| Falla otra vez por configuración | vuelve al conjunto — **pero para revivirlo hace falta un éxito real posterior del proveedor**, que no puede coexistir con un corte de configuración: `config_invalida` es **global y determinista** |

**Tercero, la red por si esas dos afirmaciones fallaran** (memoria del repo: «una imposibilidad razonada
no es una medida»). El filtro `updated_at < ahora - GEOCODE_RECUPERACION_ENFRIAMIENTO_MIN` (**60 min**)
acota el revivido de **un mismo job a ≤1 por hora**, incluso con un proveedor que parpadee. Techo duro
de coste: **≤1 llamada pagada por job y por hora**. Y ese enfriamiento se prueba en la integración
(R24), no se razona.

### 6.4 — Los cinco números, en un módulo propio

`lib/config/geocode-salud.ts`, clon estructural de `lib/config/jobs.ts` (`readPositiveInt`, ausente o
inválido → default, **nunca lanza**, R30):

| Variable | Default | Papel |
| --- | --- | --- |
| `GEOCODE_CAIDA_JOBS_MINIMOS` | **3** | Umbral de jobs distintos (§4.3) |
| `GEOCODE_CAIDA_VENTANA_MIN` | **60** | Ventana de recencia (§4.3) |
| `GEOCODE_RECUPERACION_LOTE` | **5** | Máximo de revividos por éxito (§6.2) |
| `GEOCODE_RECUPERACION_ESPACIADO_MS` | **60000** | Separación entre revividos (§6.2) |
| `GEOCODE_RECUPERACION_ENFRIAMIENTO_MIN` | **60** | Intervalo mínimo de re-revivido (§6.3) |

**Módulo propio y no dentro de `GeocodeConfig`:** `GeocodeConfig` se le pasa a `GeocodificacionService`
y lo construyen a mano decenas de tests; añadirle cinco campos obligatorios los rompería a todos por una
ficha que no les concierne. El módulo separado lo consume **sólo** `GeocodeSaludService`. *(Y por eso
`lib/config/geocode.ts` está en la lista de «no se tocan».)*

---

## §7 — El aviso

### 7.1 — La emisión (`lib/notificaciones/emitir.ts`)

```ts
export interface GeocodificacionCaidaContexto {
  /** Cuantos jobs distintos llevan el marcador en la ventana. UN NUMERO, nada mas (R26). */
  afectados: number;
  /** `YYYY-MM-DD` de la jornada CR. **ES LA ENTIDAD** del aviso (§3.3). */
  diaCR: string;
}

export async function emitirGeocodificacionCaida(repo, ctx, tx?): Promise<number>;
```

**DOS filas** (**R7**, decisión del humano del 2026-09-09), una por rol, con el **mismo** texto:
`tipo: "alert"`, `evento: "geocodificacion_caida"`, `entidadTipo: "geocodificacion_caida_dia"`,
`entidadId: ctx.diaCR`, `anexo: null`, y `destinatario` recorriendo `ROLES_ADMINISTRACION`.

- **`ROLES_ADMINISTRACION` YA EXISTE, y se reutiliza tal cual — no se inventa nada.** Es la constante
  privada de `lib/notificaciones/emitir.ts:103-106`
  (`[{ tipo: "rol", rol: "maestro" }, { tipo: "rol", rol: "admin" }]`, *«espejo de ROLES_APROBADORES»*),
  y es **exactamente** el patrón «maestro + admin» que buscábamos: la usan ya **cuatro** emisores
  —`emitirPostulacionPendiente` (`:324`), `emitirPostulacionRecursoPendiente` (`:371`),
  `emitirCierreDiaPorAprobar` (`:468`) y `emitirCierreDiaVencido` (`:570`)—, siempre con la misma forma
  `ROLES_ADMINISTRACION.map((destinatario) => ({ …, destinatario }))` sobre `emitirFilas`. La 401 copia
  esa línea y nada más:

  ```ts
  return emitirFilas(
    repo,
    ROLES_ADMINISTRACION.map((destinatario) => ({
      tipo: "alert" as const,
      evento: "geocodificacion_caida" as const,
      descripcion: textoGeocodificacionCaida(ctx.afectados),
      anexo: null,
      entidadTipo: "geocodificacion_caida_dia" as const,
      entidadId: ctx.diaCR,
      destinatario,
    })),
    tx,
  );
  ```

  **La constante es privada del módulo y NO se exporta**: el emisor nuevo vive en ese mismo archivo, así
  que no hace falta tocar su visibilidad ni ningún otro emisor. Cero cambios en los ocho notificadores
  existentes.
- **`alert` y no `warning`.** `warning` es «algo pendiente de aprobación» (`cierre_dia_por_aprobar`,
  `gasto_fijo_cobro_pendiente`): una cola de trabajo normal. Esto es un servicio caído por
  configuración nuestra que exige una acción **fuera de la app** (credencial/facturación). El propio
  contrato de la 91 lo dice: *«debe ser RUIDOSO, nunca silencioso»*.
- **Por qué los dos roles** (Q1, cerrada por el humano): un corte del proveedor deja de ubicar
  direcciones de **toda** la operación, y el `admin` es quien la mira a diario. El `maestro` puede no
  estar delante durante las horas que dura el corte — que es literalmente lo que pasó las 19 h del
  8/9-sep. La alternativa «sólo `maestro`», que era la propuesta original de este spec, queda en §8-A13.
- **Sin anexo:** no hay ningún dato adicional que enseñar sin arriesgar R26.

### 7.2 — El texto (literal fijo, contrato afirmado a mano)

```ts
/** R26/R27: cifra agregada, sin PII, sin siglas, sin jerga interna. */
export function textoGeocodificacionCaida(n: number): string {
  return n === 1
    ? "El servicio de mapas esta rechazando nuestras peticiones por un problema de configuracion de la cuenta. 1 direccion quedo sin ubicar. Revisa la credencial y la facturacion de la cuenta del proveedor de mapas."
    : `El servicio de mapas esta rechazando nuestras peticiones por un problema de configuracion de la cuenta. ${n} direcciones quedaron sin ubicar. Revisa la credencial y la facturacion de la cuenta del proveedor de mapas.`;
}
```

- **«servicio de mapas»** es el mismo vocabulario que la 400 ya fija para el operador
  (`MSG_UBICACION_NO_VERIFICADA`): un solo término de cara a la persona, no dos.
- **Nada de «geocodificación», «geocodificador», «config_invalida», «REQUEST_DENIED» ni «API»** (R27,
  y memoria del repo «no siglas en el texto de UI»).
- **Nada de PII ni de secretos** (R26): un número y una instrucción. Nunca la dirección, el id de la
  orden, la guía, la URL del proveedor ni la credencial —ni siquiera enmascarada—.
- **Dice que la causa es NUESTRA**, no la dirección: es la misma lección de la 400 (el 09-09 se mandó al
  operador a corregir seis direcciones que estaban bien).
- **El literal es contrato de test, afirmado a mano** y nunca comparado contra la función que lo genera
  (memorias «aserción contra su propia fuente» y «literal: contrato o polizón»).
- **El MISMO texto para los dos roles.** Es lo que hacen los cuatro emisores multi-rol vigentes
  (`TEXTO_POSTULACION_PENDIENTE`, `TEXTO_CIERRE_POR_APROBAR`…): una sola descripción por evento,
  variando sólo el destinatario. Un texto distinto por rol duplicaría el literal —y con él el riesgo de
  que uno de los dos se quede sin revisar contra R26/R27— para decir lo mismo. El `admin` que no pueda
  tocar la facturación escala; para eso necesita **enterarse**, que es el problema que la ficha ataca.

### 7.3 — El notificador y el composition root (`lib/notificaciones/notificadores.ts`)

Molde **idéntico** a los ocho existentes, sin tocar ninguno:

```ts
export type GeocodificacionCaidaNotificador = (ctx: GeocodificacionCaidaContexto) => Promise<void>;

export function notificarGeocodificacionCaidaCon(repo, logger?): GeocodificacionCaidaNotificador {
  return async (ctx) => {
    await emitirBestEffort("geocodificacion_caida",
      () => emitirGeocodificacionCaida(repo, ctx), logger);
  };
}
export const notificarGeocodificacionCaidaReal: GeocodificacionCaidaNotificador =
  async (ctx) => notificarGeocodificacionCaidaCon(repoReal())(ctx);
```

`notificadorNoOp` gana `GeocodificacionCaidaNotificador` en su intersección de tipos.

**BEST-EFFORT Y FUERA DE TODA TRANSACCIÓN**, por el mismo motivo que sus hermanos del cron: lo llama el
drenador de la cola, que debe seguir procesando el resto del lote aunque el aviso falle. Y no es un
`catch` vacío: `emitirBestEffort` deja el fallo **registrado** con la operación y su causa (R11).

**El cableado va en `lib/services/jobs/geocodificacion-handler.ts`**, dentro de
`buildGeocodificacionService(now)` — el mismo sitio donde la 403 pone el suyo
(`buildWebhookEstadoService`) y donde este archivo ya construye el cliente HTTP y los repositorios
reales:

```ts
const salud = new GeocodeSaludService(
  new GeocodeSaludRepository(prisma),
  loadGeocodeSaludConfig(),
  notificarGeocodificacionCaidaReal,   // ⚠️ ESTA LINEA ES EL REQUISITO, NO EL import DE ARRIBA
  undefined,                            // logger: default
  now,
);
return new GeocodificacionService(…, salud);
```

### 7.4 — La trampa del notificador muerto: cómo se cierra AQUÍ

Está medido en este repo: **2 de 7 notificadores estaban muertos con la suite entera en verde**, porque
`buildService()` pasaba cinco argumentos y el notificador era el séptimo. **Que un notificador se
importe NO prueba que alguien lo PASE.** Tres capas, y una prueba de la prueba:

1. **La guardia derivada que YA EXISTE** en `tests/unit/services/notificacion-notificadores-reales.test.ts`
   («ningún notificador REAL puede quedarse sin composition root») recorre `lib/` + `app/` **con los
   imports y los comentarios retirados** y exige, por cada `notificar*Real` exportado, al menos un
   fichero de producción que lo **pase**. Llamando al binding `notificarGeocodificacionCaidaReal`, entra
   en ese censo **automáticamente**, sin escribir una línea de guardia nueva.
2. **Guardia por SITIO**, molde literal de la de `generar-gastos-fijos`: sobre
   `lib/services/jobs/geocodificacion-handler.ts`, `fuenteSinImportsNiComentarios(...)` debe contener
   `notificarGeocodificacionCaidaReal` **y** casar
   `/new GeocodeSaludService\([\s\S]*notificarGeocodificacionCaidaReal,?[\s\S]*\)/`. La guardia (1) fija
   el **símbolo**; ésta fija el **sitio** — y esa distinción ya salvó a `cierre-dia.ts`.
3. **El censo de defaults se amplía solo.** `GeocodeSaludService.ts` vive en `lib/services/` y declara
   `Notificador = notificadorNoOp`, así que el test *«el censo está COMPLETO: no hay ningún otro service
   con notificador por constructor»* —que compara contra `readdirSync(lib/services)`— **se pondrá rojo**
   hasta que se añada a `SERVICES_CON_NOTIFICADOR`. Es la lista contrastada contra el árbol, no contra
   sí misma.
4. **PRUEBA DE LA PRUEBA, OBLIGATORIA (`tasks.md` T13).** No basta con escribir las guardias: hay que
   **borrar el argumento del cableado dejando el `import` intacto** y ver (1) y (2) en **ROJO**. Si
   alguna se quedara verde, esa guardia **no cubre este caso** y hay que arreglarla antes de dar el
   requisito por cumplido. *(Memoria del repo: «arnés de mutaciones que miente» — la comprobación se
   pega en `progress/impl_401_*.md` con la salida real, no se afirma de palabra.)*

> **Los destinatarios NO afectan a ninguna de las tres guardias, y conviene decirlo para que nadie las
> retoque de más.** Las tres miran el **cableado** —quién PASA `notificarGeocodificacionCaidaReal` y
> cuál es el default del constructor—, no a quién va dirigida la fila. Que el aviso vaya a uno o a dos
> roles se decide **dentro** de `emitirGeocodificacionCaida`, río abajo del notificador, y se afirma en
> `tests/unit/notificaciones/geocodificacion-caida-aviso.test.ts` (R7). Cambiar el destinatario no puede
> poner roja ninguna guardia de cableado — ni debe: son dos fallos distintos y cada uno tiene su red.

### 7.5 — El volumen con dos destinatarios: comprobado, no supuesto

La decisión de Q1 dobla las **filas**, no los **eventos**, y la cota que importa sigue siendo la entidad
sintética (§3.3). Con los números del incidente medido:

| Escenario | Filas emitidas |
| --- | --- |
| Sin entidad por jornada, 1 rol | ~1.140 (19 h × 60 evaluaciones/h) |
| Sin entidad por jornada, 2 roles | ~2.280 |
| **Con entidad = jornada CR, 1 rol** *(propuesta original)* | **2** (8-sep y 9-sep) |
| **Con entidad = jornada CR, 2 roles** *(decisión del humano)* | **4** |

**Cuatro filas para un corte de 19 horas.** El factor ×2 se aplica sobre una cota que ya era de un solo
dígito, así que **el ruido no se multiplica en ningún sentido operativo**. Y no hay efecto de segundo
orden: `emitirFilas` recorre las dos filas en el mismo bucle, con **una** consulta de dedupe y **un**
`crear` por fila —dos y dos en total, una vez por jornada—, sobre un camino que ya es best-effort y
fuera de transacción. El coste en la corrida del drenador es indistinguible de cero.

**Techo duro, por si el volumen cambia:** el número de filas de este aviso está acotado por
`roles × jornadas`, **nunca** por el número de evaluaciones ni por el de jobs caídos. Con los dos roles
de hoy, el techo es **2 filas por jornada CR**, pase lo que pase.

---

## §8 — Alternativas descartadas

**A1 — Heredar el umbral de la 403 (3 fallos consecutivos **y** ≥24 h sin entrega exitosa).**
Descartada por dos motivos medidos: (i) el segundo eje es un **falso negativo estructural** aquí, porque
un job de geocodificación puede completarse **sin tocar al proveedor** (acierto de caché,
`SIN_DIRECCION`, orden borrada) y esos caminos siguen vivos durante un corte — el aviso no saldría nunca
(§4.2); (ii) 24 h de tolerancia contra un corte medido de 19 h significa **no avisar de este incidente**.

**A2 — Umbral por INTENTOS fallidos en vez de por jobs distintos.**
Es lo primero que sale, y es **ruido**: un solo job reintenta 8 veces con backoff 1-2-4-8-16-32-60 min,
así que **una sola orden** cruzaría un umbral de 3 en **tres minutos**. Eso es exactamente el «fallo
aislado» que la ficha prohíbe avisar. Descartada.

**A3 — Evaluar la salud al final de `drenar()`, en el route handler del cron.**
Es el sitio «obvio» (composition root, todos los fallos ya persistidos, sin off-by-one). Descartada por
**coste**: ese cron corre **cada minuto** y `jobs` no tiene índice por `tipo`, `estado` ni `updated_at`,
y sus filas **no se purgan** — un escaneo secuencial por minuto sobre una tabla que sólo crece es el
anti-patrón que `docs/architecture.md` rechaza. Gatearlo con `result.fallidos > 0` no salva nada: en el
incidente de la 403 hubo ~17 fallos de webhook por hora, así que el gate estaría abierto casi siempre.
Y le costaría a `DrenarResult` un campo con vocabulario de geocodificación, acoplando el drenador
genérico a uno de sus nueve tipos.

**A4 — Un tipo de job recurrente `geocodificacion_salud` que evalúe cada N minutos.**
Usa el mecanismo del repo (`buildRecurrencias`, como `analitica_rollup_diario`) y no inventa nada.
Descartada: exige **un valor nuevo en el enum `job_tipo`** —con su migración, su `down.sql` y el
`55P04`— para responder a una pregunta que ya se puede hacer en el único instante en que importa; y el
propio job de salud **consumiría un turno del lote de 10 cada vez**, alimentando el problema de la
**402**. Más piezas y más contención para el mismo resultado.

**A5 — Entidad del aviso = franja horaria (`YYYY-MM-DDTHH`) en vez de jornada CR.**
Daría un recordatorio cada hora mientras el corte siga vivo. Descartada: el incidente medido habría
producido **~19 avisos** para un solo hecho. Con la jornada son **2** (8-sep y 9-sep), suficientes para
que no se pierda de vista y pocos para que no se ignoren. Coste declarado: dos cortes independientes en
la misma jornada dan un solo aviso (pregunta abierta Q3).

**A6 — Guardar el estado del circuito (contador + ancla) en una tabla o fila de configuración nueva,
como hace la 403 en `webhook_suscripcion`.**
Descartada: **no hay dónde**, y crearlo sería el «rediseño» que la ficha prohíbe. Y sería peor: un
contador persistido necesita un **reset** que alguien debe acordarse de hacer, y ese olvido es
silencioso. Derivar de `jobs` es autolimpiante por construcción (§4.3).

**A7 — Ampliar `IJobRepository` con `contar…` / `revivir…`.**
Sería «menos archivos». Descartada por el precedente **escrito en ese propio contrato**: la 92 se negó a
añadirle `cancel`/`reschedule` para no tocar una interfaz compartida por las features 90/91/92/99. Un
repositorio propio y estrecho deja el contrato genérico cerrado (R35).

**A8 — Revivir TODOS los jobs muertos de golpe (que es literalmente lo que hizo el humano a mano).**
Es lo más rápido: los 25 en ~6 minutos. Descartada porque con `JOBS_BATCH_SIZE = 10` y `ORDER BY
run_after`, esos 25 ocupan **tres corridas casi enteras** y dejan a los otros ocho tipos sin turno — el
enunciado exacto de la **402**, causado por la ficha que venía a arreglar otra cosa. El escalonado
cuesta ~25 minutos más y no lo provoca (§6.2).

**A9 — Detectar la causa buscando `REQUEST_DENIED` o `config_invalida` por substring en `last_error`.**
Se repite aquí la alternativa que la 400 ya descartó (su §8-A1) porque **la tentación reaparece en SQL**:
un `LIKE '%REQUEST_DENIED%'` es más corto que importar el marcador. Descartada por lo mismo: ata el
predicado a la redacción de un mensaje escrito para humanos y el primer cambio de copy lo rompe **en
silencio**. Además duplicaría el mecanismo que R1 exige que sea único.

**A10 — Emitir además un aviso de «el servicio de mapas se recuperó».**
Simétrico y tentador. Descartada por alcance: la ficha pide dos cosas, no tres, y un aviso de buenas
noticias en la misma campana que las alertas la degrada. La necesidad forense la cubre el `logger.warn`
agregado de la recuperación, y la señal operativa es que **al día siguiente no llega otra alerta**.

**A11 — Poner el circuito dentro de `JobQueueService`, genérico para cualquier tipo de job.**
Descartada por el mismo argumento que usó la 403: acoplaría un componente compartido por **nueve** tipos
a un concepto —«proveedor externo con credencial»— que sólo tiene sentido para algunos. La decisión de
revivir jobs de un tipo concreto no es agnóstica del tipo.

**A12 — Proveedor de geocodificación de respaldo.**
**Descartado por el humano**, no se reabre. Y además no arregla lo evidenciado: con dos proveedores, el
día que fallen los dos seguiría sin avisar nadie y los jobs seguirían muertos.

**A13 — Dirigir el aviso SÓLO al rol `maestro`.** *(Era la propuesta de la primera versión de este spec
—pregunta abierta Q1—; **el humano decidió lo contrario el 2026-09-09** y ahora está DENTRO del alcance
como R7. Se conserva el razonamiento porque explica el coste, que resultó menor de lo temido.)*
El argumento era el de la 333: la acción que el aviso pide —revisar credencial y facturación de la
cuenta del proveedor— es del dueño, y un `admin` que no puede atenderla sólo recibiría ruido.
**Lo que ese argumento no veía, y el incidente sí:** el corte duró **19 horas**, la mayoría fuera de
horario, y quien acabó notándolo fue **quien estaba operando**, no quien podía arreglarlo. Un aviso que
sólo llega a quien puede actuar **pero no está delante** reproduce el silencio que la ficha existe para
romper; el `admin` no arregla la facturación, pero **escala**, y para escalar necesita enterarse.
Medido el coste (§7.5): **4 filas** en vez de 2 para el corte de 19 h, con la cota `roles × jornadas`
intacta. Descartada.

---

## §9 — Riesgos y cómo se cierran

| Riesgo | Cierre |
| --- | --- |
| **El notificador muerto** (2 de 7 medidos en este repo, con la suite verde). | §7.4: guardia derivada por símbolo + guardia por sitio sobre el uso efectivo + censo de defaults contrastado contra el árbol, **y la mutación obligatoria de T13** que exige verlas rojas. |
| **El `WHERE` que ningún test ve** (medido 4 veces en este repo: una mutación del `WHERE` pasa en verde con dobles). | Las dos sentencias se prueban en `tests/integration/db/geocode-recuperacion.test.ts` contra Postgres real, con filas testigo comparadas antes/después. |
| **Test de integración verde sin datos** (`if (!filas) return;` reporta `passed`). | El test **falla** si no encuentra sus propias filas sembradas, y T12 exige matarlo con una mutación antes de creerlo. |
| **El gate se salta la integración por falta de `.env`** y aun así dice «OK». | T15: mirar los `skipped` del log del gate, no sólo el `INIT_EXIT`. |
| **Base local compartida entre worktrees** (la migración de una ficha pone rojo el gate de otra). | El test siembra y limpia con un prefijo propio de `dedupe_key` y **no asume base vacía**. El índice parcial es aditivo y no rompe ninguna otra suite. |
| **Colisión de migraciones de enum con la 403.** | §3.3: regla de orden y `down.sql` decidido **al abrir el PR** leyendo el árbol; nunca se renumera ni se edita una migración ya aplicada. |
| **La 400 no está desplegada** ⇒ no hay marcador ⇒ toda esta ficha es inerte y silenciosa. | Es la dependencia dura de la ficha. `tasks.md` **T0** la comprueba en el árbol (que `lib/geo/fallo-config-geocode.ts` exista y esté mergeado) antes de escribir una línea. Hoy **no existe**: verificado el 2026-09-09. |
| **Se revive un job de una dirección irresoluble** y entra en bucle. | §6.3: imposible por construcción (esos desenlaces dejan el job `done`, nunca `failed`), más el enfriamiento de 60 min como red **medida**, no razonada. |
| **La recuperación satura la cola y desplaza a otros tipos** (ficha 402). | §6.2: lote 5 + escalonado de 60 s ⇒ ≤1 revivido reclamable por corrida de 10. Invariante verificable sobre los `run_after` generados. |
| **Un aviso por minuto durante 19 horas.** | §3.3: entidad = jornada CR ⇒ 2 filas por jornada (una por rol) en vez de ~2.280. Techo duro `roles × jornadas` (§7.5). |
| **El aviso llega a un rol y al otro no** (fallo mudo clásico: la fila del `admin` se pierde y nadie lo nota porque el `maestro` sí la ve). | R7 se prueba con la **lista de destinatarios afirmada a mano** en el test del emisor —`["maestro","admin"]` escrito literal, **no** derivado de `ROLES_ADMINISTRACION`—, así que quitar un rol de la constante deja el test rojo. Y la dedupe por `destinatario_rol` (§3.3) impide que leer una suprima la otra. |
| Cambiar el `message` de los errores de geocodificación rompe un test que afirmaba ese literal. | Esta ficha **no toca esos mensajes** (es la 400 quien los cambia). Si un test rojo apareciera, es de la 400, no de aquí. |

---

## §10 — Cómo se demuestra que el incidente no se repite

Reproducción explícita en `tests/integration/db/geocode-recuperacion.test.ts`, con los números del
2026-09-09 y sin ninguna sentencia manual:

1. Sembrar **25** jobs `geocodificacion` en `failed` con el marcador de la 400 y `updated_at`
   escalonado, más filas testigo (otro tipo, geocodificación `done`, geocodificación `failed` **sin**
   marcador, geocodificación `pending` con marcador).
2. Simular la vuelta del proveedor invocando la recuperación con el reloj inyectado.
3. Afirmar: se reviven exactamente **5**, **los 5 más antiguos**, con `run_after` separados ≥60 s;
   `intentos = 0`, `last_error` nulo, `estado = 'pending'`; **ninguna** fila testigo cambia; repetir
   inmediatamente **no** revive a los mismos (enfriamiento) y **sí** revive a los siguientes 5 cuando el
   reloj avanza.
4. **Ninguna de esas afirmaciones se cumple hoy**, y ninguna exige abrir la base de producción.
