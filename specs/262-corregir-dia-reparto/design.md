# Feature 262 — Diseño

> Lee `requirements.md` antes que esto. Aquí sólo van las **decisiones**, con lo que se descartó y
> por qué. Todo lo que se afirma como «medido» se leyó en el árbol y se cita por archivo y línea.

---

## 1 · Alcance

| Entra | No entra |
| --- | --- |
| Una operación de **lote** que fija el día de reparto de órdenes ya asignadas | Cambiar el **estado**, el mensajero, la guía o el instante de asignación (**R1**) |
| Las **dos superficies** que ya eligen el día al asignar: `/ordenes` y `/recepcion-satelite` | Una pantalla nueva (§4.2, **A3**) |
| El **rastro** de cada corrección: tabla nueva, migración con `down.sql` y RLS (§5) | Una **pantalla** para leer el rastro (límite 3, **P1**) |
| El **cierre por la puerta** del riesgo aceptado en 261/R33 (§9) | Avisar al mensajero (límite 4, **P2**) |
| La **excepción declarada** a la invariante 246/R10, con su guardia (§6.3) | Cualquier backfill o reparación automática (**R33**) |

**Una migración, ninguna alteración.** La tabla del rastro es **nueva**; `orden` no cambia de forma:
ni columna, ni índice, ni default. `fecha_reparto` sigue siendo `DateTime? @db.Date` tal cual.

⚠️ **El gate rápido SE NIEGA en esta ficha, y no es una elección.** El diff toca `db/migrations/**`
y `db/schema.prisma`, dos de las rutas que `docs/verification.md` (§ tabla) declara sin escape:
«una migración no la importa nadie: ningún test sale seleccionado por tocarla». **`./init.sh`
completo, obligatorio.**

---

## 2 · Lo medido antes de decidir nada: quién escribe hoy el día de reparto

Tercera medición de lo mismo (el spec de la 261 y el leader la hicieron antes; ésta es
independiente y coincide):

| Escritor | Archivo | Qué hace con el día |
| --- | --- | --- |
| Asignación desde bodega central | `OrdenRepository.asignarBodegaLote:2040-2046` | Lo FIJA junto a `asignadoAt` (Prisma `data`) |
| Asignación desde bodega satélite | `OrdenRepository.asignarSateliteLote:2805-2817` | Lo FIJA junto a `"asignado_at" = NOW()` (SQL crudo, `::date`) |
| Generar guía (rama muerta desde la 156) | `OrdenRepository:1984-1986` | Lo FIJA si hubiera mensajero |
| Deshacer asignación | `OrdenRepository.deshacerAsignacionLote:2890-2896` | Lo LIMPIA junto a `asignado_at` |
| Cuatro limpiezas más | `DevolucionSlaRepository`, `LiberacionReprogramadaRepository`, `RecuperacionBodegaRepository`, `CierresAdminRepository` | Lo LIMPIAN junto a `asignado_at` |
| Deshacer una gestión (261) | `CierreDiaRepository` | Lo estampa **conservando** la reserva futura |
| **`app/`** | `mis-asignaciones/**` (5 archivos) | **Sólo lectura**: badge, aviso y `disabled` |

**Conclusión, en una frase:** hoy el día de reparto **sólo se puede fijar asignando y sólo se puede
borrar desasignando**. Corregirlo sin hacer ninguna de las dos cosas **no tiene ningún camino**, y
ése es exactamente el hueco que esta ficha abre — uno, con nombre, y vigilado (§6.3).

---

## 3 · Arquitectura de la operación

```
app/(app)/ordenes/_components/CambiarDiaRepartoModal.tsx            ← superficie central
app/(app)/recepcion-satelite/_components/CambiarDiaRepartoSateliteModal.tsx  ← superficie satélite
  ↓ (Server Action, nunca fetch a una ruta API: mutación interna)
lib/actions/corregir-dia-reparto.ts        ← borde: actor + zod + delegar
  ↓
lib/services/CorreccionDiaRepartoService.ts ← rol, zona, estados, día ya resuelto
  ↓
lib/repositories/OrdenRepository.corregirDiaRepartoLote()  ← UPDATE guardado + rastro, 1 tx
  ↓
lib/repositories/registrar-cambio-dia-reparto.ts           ← choke point del rastro
```

**Servicio propio y no un método más de `GuiaAsignacionService`.** El mismo argumento que el repo ya
escribió para `DeshacerAsignacionService` (149, design §7-C) y que aquí es aún más directo:
`asignarDesdeBodega` es **sólo acceso total** y **sólo zona GAM**, y `AsignacionSateliteService` es
**sólo `adminSatelite`** y **sólo su zona**. La corrección cruza las dos (§4.1). Meterla en
cualquiera de los dos servicios obligaría a abrir su autorización con un `if` — y los dos son
servicios que deciden a quién se le asigna trabajo.

**La Server Action es un borde delgado.** `withErrorHandler` + `resolveActorFromSession` + zod +
fábrica del servicio, calcado de `lib/actions/deshacer-asignacion.ts`. Ninguna regla de negocio
ahí: `docs/architecture.md` reserva esa capa para el borde y el reviewer lo rechaza.

---

## 4 · Las cuatro decisiones que la ficha exigía cerrar

### 4.1 · D1 — **Quién puede cambiar el día**

> **Decisión: exactamente quien puede elegirlo al asignar.** `maestro` y `admin` (acceso total),
> sin restricción de zona; y `adminSatelite`, acotado a **su** zona resuelta en el servidor. Nadie
> más. → **R11**, **R12**, **R15**.

**El razonamiento, y no es «los admin pueden todo».** El día lo elige quien asigna, en el mismo
modal en el que asigna (`AsignarBodegaModal`, `AsignarSateliteModal`). Quien tiene la potestad de
**crear** ese dato es quien tiene que poder **arreglarlo**: cualquier otro reparto obliga a que la
persona que se equivocó le pida a otra que lo corrija, que es como se termina pidiendo un `UPDATE`
a mano — el defecto que esta ficha cierra.

**«¿También bodega?» — la pregunta tiene truco y hay que decirlo.** En este esquema **no existe un
rol `bodega`**: `RolValue` son `maestro`, `admin`, `adminTienda`, `adminSatelite`, `mensajero` y
`apiKey`. «Bodega» es un puesto, y en la app se reparte en dos: la **central** la operan
maestro/admin (`esAccesoTotal`, `lib/auth/acceso-total.ts`) y la **satélite** el `adminSatelite`.
Así que la respuesta a «¿también bodega?» es **sí, y ya está contenida en la decisión**: las dos
bodegas entran, cada una por su rol.

**Quién queda fuera, con su motivo:**

- **`adminTienda`**: no elige el día al asignar, no opera la ruta del mensajero y su superficie es
  la de sus propias órdenes. Darle esta acción sería darle a la tienda el control de la
  planificación de la bodega.
- **`mensajero`**: es la parte **bloqueada** por la reserva. Quien sufre un bloqueo no puede ser
  quien lo levanta; si pudiera, la 261 no habría bloqueado nada.

**⚠️ La trampa que la 260 dejó documentada y aquí sí aplica.** `/ordenes` **no recorta por rol:
recorta por PUERTA** (`app/(app)/ordenes/page.tsx:55`, `notFound()` para `mensajero` y
`adminSatelite`). Si la corrección viviera **sólo** en `/ordenes`, el `adminSatelite` —que **sí**
elige el día al asignar— se quedaría sin poder corregir el suyo, y ni un test de rol lo detectaría:
la exclusión no está en ninguna regla de rol, está en un `notFound()` de una página. Por eso D2
tiene **dos** superficies.

**Guarda ausente, declarada:** un **cierre de día pendiente NO bloquea** la corrección (**R14**).
Es la regla 2 de la feature 241, firmada el 2026-08-20 —«recibir asignaciones no se bloquea
nunca»— y el mismo criterio con el que la 149 cerró su Q1 para el deshacer: la corrección no mueve
dinero, no crea una gestión y no cambia de estado. Consultar
`findMensajerosBloqueadosParaGestion` desde aquí sería escribir «ParaGestion» en una acción que no
gestiona nada.

### 4.2 · D2 — **Desde dónde se hace**

> **Decisión: una acción de LOTE en los dos listados que ya existen**, no una pantalla nueva.
> `/ordenes` (maestro/admin, cualquier zona) y el listado de la bodega satélite en
> `/recepcion-satelite` (adminSatelite, su zona). → **R13**.

**El precedente es exacto y ya está en el árbol: «Deshacer asignación» (feature 149).** Es la misma
forma de operación —actuar sobre un lote **ya asignado y aún no recogido**, con motivo obligatorio—
y se resolvió con **dos** modales hermanos sobre los dos listados:

| | central | satélite |
| --- | --- | --- |
| Página | `app/(app)/ordenes/page.tsx` | `app/(app)/recepcion-satelite/page.tsx` |
| Listado | `OrdenesListado.tsx` (`accionesPara`, por estado) | `SateliteOrdenesListado.tsx` (botonera por estado) |
| Modal de deshacer | `DeshacerAsignacionModal.tsx` | `DeshacerAsignacionSateliteModal.tsx` |
| **Modal de corregir (esta ficha)** | `CambiarDiaRepartoModal.tsx` | `CambiarDiaRepartoSateliteModal.tsx` |

**Y las dos páginas ya bajan las fechas del selector** (`fechasDiaReparto`, 246/T4.2 y T4.3,
resueltas en el servidor con el día de Costa Rica). O sea: la pieza que hace falta para pintar
«Hoy · 22 de agosto» **ya viaja** a las dos superficies. No hay que inventar de dónde sale la
etiqueta — que es justo donde R17 se rompería.

**Estados sobre los que se ofrece.** La corrección se ofrece donde el día **todavía decide algo**:

```ts
// lib/services/CorreccionDiaRepartoService.ts
const ESTADOS_CON_DIA_DE_REPARTO_VIVO = ["por_recoger", "en_reparto", "ayuda_tienda"];
```

- **`por_recoger`** — el caso principal: el lote está en la bodega, marcado para el día que no es.
- **`en_reparto`** — la población que la 261 dejó **atrapada**: el paquete ya está en la mano del
  mensajero y no puede gestionarlo. Medida por la 261 el 2026-08-21: **2 órdenes**. Sin este
  estado, esta ficha no rescata el caso que la motivó.
- **`ayuda_tienda`** — el mismo bloqueo por la otra puerta: 261/R28 impide que la tienda resuelva
  una orden reservada, y el paquete **sigue con el mensajero** (235/R1). El día está tan vivo aquí
  como en `en_reparto`.

⚠️ **Esa lista entra en un censo que YA EXISTE**, y ahí está la mitad del valor de declararla:
`tests/unit/guards/carga-del-mensajero.guardia.test.ts` vigila, miembro a miembro, las listas que
deciden sobre «lo que el mensajero lleva encima», y exige que incluyan `ayuda_tienda` con su razón
escrita. Nuestra lista se **añade a ese censo**. Su campo `pregunta` es hoy una unión cerrada de
dos valores (`"que ocupa al mensajero" | "a quien barre el corte"`); esta ficha le añade un tercero,
`"donde vive el dia de reparto"`, **explícitamente**, porque un miembro nuevo que se cuele como si
respondiera otra pregunta deja el censo diciendo una cosa por otra.

**Lo que NO se hace:** ofrecerla con la selección **mixta**. Igual que el resto de acciones de lote
de los dos listados, si lo seleccionado no es todo del mismo estado no se ofrece ninguna acción.

### 4.3 · D3 — **¿Se puede mover a un día PASADO?**

> **Decisión: NO, y no por un `if`: por el vocabulario.** La corrección manda el **mismo token**
> que la asignación (`"hoy" | "manana"`, `lib/types/dia-reparto.ts`) y el **servidor** lo traduce
> con `resolverFechaReparto(dia, now)`. Con dos opciones que significan «el día en curso» y «el
> siguiente», **el pasado no es expresable**. → **R2**, **R3**.

**Por qué el pasado NO puede permitirse — el argumento es de dinero, no de higiene:**

1. **El día de reparto es el denominador del ranking.**
   `RankingRepository.contarAsignadasPorMensajero` cuenta por `fechaReparto = diaReparto` (rama a) y
   detrás del ranking hay `premio_ranking`. Mover una orden a un día **ya cerrado** cambia el
   denominador de un día cuyo podio ya se calculó —y, si ya hay `RankingSnapshotDia`, deja la foto
   congelada y la realidad diciendo cosas distintas para siempre.
2. **El tablero del día copia ese mismo criterio** (`TableroDiaRepository`, 259/R7-R8). Un día
   pasado dejaría de cuadrar con lo que alguien ya leyó y decidió.
3. **Frente al corte, mover al pasado no gana nada.** El corte barre
   `(fecha_reparto IS NULL OR fecha_reparto <= diaCerrado)`: «ayer» y «hoy» se barren **igual** esta
   misma noche. O sea que permitir el pasado tiene **todo** el coste de reescribir métricas cerradas
   y **cero** beneficio operativo.

**Por qué la prohibición va en el TOKEN y no en una comprobación.** Una guarda del tipo
`if (fecha < hoy) return conflict` es correcta y es exactamente la clase de línea que un día alguien
relaja «para un caso puntual». Con el token no hay nada que relajar: para poder escribir un día
pasado habría que **cambiar el contrato** —y eso se ve en el diff, se discute y se decide. Es el
mismo razonamiento con el que la 246 decidió que el cliente mandara un token y no una fecha (R6):
«un `YYYY-MM-DD` calculado con el reloj del navegador dejaría el día de reparto en manos de un
portátil con la hora corrida».

**Consecuencia declarada (límite 1):** tampoco se puede fijar **+2**. Lo que la app sabe expresar al
asignar es lo que sabe expresar al corregir. Si la operación necesita «el lunes desde el viernes»,
es un cambio para las **dos** superficies y una decisión de producto → **P3**.

**Sin `.default("hoy")` en este borde, al contrario que en la asignación.** `asignarBodegaSchema` y
`asignarSateliteSchema` lo tienen (246/R4) porque ahí el default significa «como antes de la
feature». Aquí un default significaría que una llamada **sin campo** mueve el lote a hoy sin que
nadie lo eligiera. El campo es **obligatorio**.

### 4.4 · D3' — **Lo que la corrección tampoco puede hacer: crear un día donde no lo había**

> **Decisión: la corrección exige que la orden YA tenga día y YA tenga mensajero.** No pone día a
> una orden que no lo tiene, y no lo puede quitar. → **R4**, **R5**.

Dos razones, las dos medidas:

1. **`fecha_reparto IS NULL` significa algo concreto** (`db/schema.prisma:509`): «no está reservada
   para un día que aún no ha llegado» — órdenes anteriores a la 246, sin backfill y sin default. Esas
   órdenes cuentan en el ranking por la **rama (b)**, la de respaldo, por `asignado_at`. Ponerles día
   las **mueve de rama** y por tanto de día en el denominador. No es una corrección: es una
   asignación de día nueva, disfrazada.
2. **No lo necesitan.** 261/R8 es explícito: una orden sin día **no está bloqueada** por nada. La
   población que esta ficha rescata es la que tiene día equivocado, no la que no tiene ninguno.

Si **M2** (`requirements.md`) devolviera un número grande de órdenes con mensajero y sin día, esta
decisión se re-abre: querría decir que hay una vía viva que asigna sin estampar la columna, y eso
sería otra ficha (y un fallo de la invariante).

### 4.5 · D4 — **Qué rastro deja**

> **Decisión: una tabla propia, `orden_dia_reparto_cambio`, append-only, escrita en la MISMA
> transacción que la corrección.** No se reutiliza `orden_historial_estado`. → **R20-R26**, §5.

**Por qué NO el historial de estados — tres consecuencias MEDIDAS, no tres opiniones.** Escribir un
cambio de día como una fila `por_recoger → por_recoger` con una familia nueva parece lo barato. No lo
es:

1. **Rompería «Deshacer asignación», y falla CERRADO.**
   `OrdenHistorialRepository.findOrigenesReversion:318-327` elige, con `DISTINCT ON`, la fila **más
   reciente cuyo `estatus_destino_id` es el estado ACTUAL** de la orden, y devuelve su
   `estatus_origen`. Con una fila falsa `por_recoger → por_recoger` encima, el origen devuelto sería
   `por_recoger`, que **no está** en `NORMALIZACION_DESTINO` (`DeshacerAsignacionService:56-61`) →
   `destino === undefined` → `MSG_SIN_HISTORIAL` → `conflict`. Traducción: **corregir el día de un
   lote dejaría ese lote sin poder deshacerse nunca más**, y el mensaje diría «sin historial», que
   es falso.
2. **Ni siquiera se puede escribir: el choke point la rechazaría.** `appendCambioEstado` valida cada
   entrada contra `TRANSICIONES` (`lib/types/order-status-transiciones.ts`) y lanza
   `TransicionIlegalError` si el par no está declarado. `por_recoger → por_recoger` **no existe** en
   ese grafo, y no debería: un bucle sobre sí mismo en la máquina de estados es una mentira sobre la
   máquina de estados. Para usar el historial habría que **declarar el bucle**, o sea empeorar el
   modelo para ahorrar una tabla.
3. **Le mentiría a los integradores.** Ese mismo choke point emite el **webhook** de estado
   (`emitir(tx, entradas)`, 99/R10-R11): cada corrección de día enviaría a cada integrador suscrito
   un `por_recoger` **repetido** sobre una orden que no se movió. La única excepción por familia que
   este repo admite es la del rescate de la 235, y está firmada por el humano en contra de la
   recomendación de su spec: no se le añade una segunda de tapadillo.

**Y una razón de forma, encima de las tres:** una fila de `orden_historial_estado` no tiene dónde
guardar **de qué día a qué día**. Habría que meterlo en `motivo` como texto — un dato estructurado
escondido en una cadena, que es como se construye un rastro que nadie puede consultar.

**Por qué SÍ un rastro, y no «no dejar ninguno».** Era una opción legítima que la ficha ponía sobre
la mesa, y se descarta con dos hechos:

- **La corrección pisa una decisión deliberada de otra persona.** Es literalmente el defecto (3) de
  la 261 —«cancela una decisión que alguien tomó a propósito, sin avisar»— sólo que aquí lo hace un
  humano y a propósito. Que sea legítimo no lo hace invisible.
- **Cambia lo que el corte hace esa misma noche y en qué día cuenta la orden para el ranking.** Un
  cambio con esas dos consecuencias y sin autor es exactamente el `UPDATE` a mano del 2026-08-21,
  que no dejó ni una huella dentro del producto.

**El motivo es obligatorio** (**R21**), copiando el borde de la 149: `trim()` + `min(10)` +
`max(300)` (`lib/actions/deshacer-asignacion.ts:28-35`). El tope de 300 es el del motivo de gestión,
«consistencia visual de la línea de tiempo».

---

## 5 · El rastro: modelo de datos

### 5.1 · Tabla

```prisma
/// Feature 262 (D4) — RASTRO de las correcciones del día de reparto. Fila INMUTABLE
/// (patrón `orden_historial_estado`): sin `updated_at`, sin `deleted_at`, sin soft delete.
/// Una corrección posterior AÑADE una fila; ninguna operación reescribe una anterior.
model OrdenDiaRepartoCambio {
  id             String   @id @default(uuid())
  ordenId        String   @map("orden_id")
  fechaAnterior  DateTime @map("fecha_anterior") @db.Date  // NOT NULL: sin día no hay corrección (R5)
  fechaNueva     DateTime @map("fecha_nueva") @db.Date
  actorUsuarioId String   @map("actor_usuario_id")         // NOT NULL: aquí nunca escribe un cron
  motivo         String                                    // R21: obligatorio, ya recortado en el borde
  createdAt      DateTime @default(now()) @map("created_at")

  orden Orden   @relation(fields: [ordenId], references: [id])
  actor Usuario @relation(fields: [actorUsuarioId], references: [id], onDelete: Restrict)

  @@index([ordenId, createdAt])        // el rastro de UNA orden, en orden
  @@index([actorUsuarioId])            // la FK RESTRICT, indexada (patrón `orden_nota`)
  @@map("orden_dia_reparto_cambio")
}
```

Decisiones dentro de la tabla, cada una con su porqué:

| Elección | Por qué |
| --- | --- |
| `fecha_anterior` **NOT NULL** | La operación exige día previo (**R5**). Nullable admitiría una fila que dice «no tenía día», que ningún productor puede escribir. |
| `@db.Date` en las dos fechas | Son **fechas**, no instantes; misma convención que `orden.fecha_reparto` (46/246). Un `timestamp` reabriría la trampa de las seis horas. |
| `actor_usuario_id` **NOT NULL** + `Restrict` | Al revés que `orden_historial_estado`, donde NULL = cron: **aquí siempre hay una persona**, y quién corrigió es la evidencia. `Restrict` por el mismo criterio que `orden_nota.autor_id` y `postulacion_recurso.atendida_por_id`. |
| Sin `updated_at` / `deleted_at` | **R23**: append-only. |
| `CHECK (fecha_nueva <> fecha_anterior)` | **R7** en la base: una «corrección» que no corrige nada no es escribible ni por error. Prisma no expresa `CHECK` (precedente `notificacion_destinatario_xor`), así que va a mano en el SQL. |
| Índice `(orden_id, created_at)` | La única consulta prevista: «el rastro de esta orden». Cubre además la FK a `orden` por prefijo. |
| **Sin** índice por `fecha_nueva` ni por fecha de corrección | No hay consumidor. Un índice sin consulta es coste sin beneficio (mismo criterio que `postulacion_recurso`). |

### 5.2 · Migración

`db/migrations/<timestamp>_orden_dia_reparto_cambio/` con **`migration.sql`** y **`down.sql`**
(obligatorio, `docs/architecture.md`). Molde literal:
`db/migrations/20260820200000_postulacion_recurso/`.

- **`migration.sql`**: `CREATE TABLE` + las dos FK + el `CHECK` + los dos índices +
  `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`.
- **RLS habilitada SIN policies** (**R26**), patrón `orden_nota` / `plantilla_mensaje` /
  `notificacion` / `orden_historial_estado`: este repo **no usa Supabase Auth** (sesión propia, sin
  `auth.uid()`), así que la autorización de negocio vive en el servicio y una policy no tendría a
  quién preguntar. Lo que la RLS garantiza es lo que **R26** pide: nadie llega a esas filas si no es
  por el servidor de la aplicación.
- **`down.sql`**: `DROP TABLE IF EXISTS "orden_dia_reparto_cambio";`. Se lleva PK, índices, FKs,
  `CHECK` y RLS. **Destructivo y sin vuelta**: borra el rastro escrito. Se dice en voz alta dentro
  del `down.sql`, como hace el de `postulacion_recurso`.
- **Aditiva**: no altera ninguna tabla, columna, índice ni enum preexistente. **No hay enum nuevo**,
  así que no aplica la lección de «un enum nuevo y los `down.sql` previos».

### 5.3 · El choke point del rastro

`lib/repositories/registrar-cambio-dia-reparto.ts`, molde de `registrar-cambio-estado.ts` pero
**mucho más pequeño**: sin webhook, sin notificaciones, sin catálogo. Un `createMany` dentro del `tx`
en curso y una regla escrita arriba:

> Toda escritura de `orden.fecha_reparto` que **no** sea una asignación ni una limpieza DEBE invocar
> esta función en su **misma** transacción, y **sólo** con las órdenes que efectivamente cambiaron.

Que exista la función y no un `createMany` suelto es lo que hace que la regla tenga **un sitio** en
el que estar escrita, igual que `appendCambioEstado` (49/design §3.3).

---

## 6 · La escritura, y la invariante

### 6.1 · Una transacción, tres pasos

```ts
// OrdenRepository.corregirDiaRepartoLote(ordenIds, diaEnCurso→fecha, estatusIds, zonaId, ctx)
return this.prisma.$transaction(async (tx) => {
  // 1. FOTO + BLOQUEO del día anterior. `FOR UPDATE` es lo que hace que la foto no pueda
  //    quedarse rancia entre este SELECT y el UPDATE de abajo (R24). `ORDER BY "id"` da un
  //    orden de bloqueo determinista entre dos lotes concurrentes que se solapen.
  const previas = await tx.$queryRaw<{ id: string; fecha_reparto: Date }[]>`
    SELECT "id", "fecha_reparto"
    FROM "orden"
    WHERE "id" IN (${Prisma.join(ordenIds)})
    ORDER BY "id"
    FOR UPDATE`;

  // 2. LA CORRECCIÓN, GUARDADA. `RETURNING "id"` = EXACTAMENTE las que ganaron la guarda.
  const movidas = await tx.$queryRaw<{ id: string }[]>`
    UPDATE "orden"
    SET "fecha_reparto" = ${fechaRepartoComoTexto(fecha)}::date,
        "updated_at" = NOW()
    WHERE "id" IN (${Prisma.join(ordenIds)})
      AND "estatus_id" IN (${Prisma.join(estatusIds)})
      AND "mensajero_asignado_id" IS NOT NULL
      AND "fecha_reparto" IS NOT NULL
      AND "fecha_reparto" <> ${fechaRepartoComoTexto(fecha)}::date
      AND "deleted_at" IS NULL
      ${zonaId === null ? Prisma.empty : Prisma.sql`AND "zona_id" = ${zonaId}`}
    RETURNING "id"`;

  // 3. TODO-O-NADA: si alguna no ganó, LANZA y la tx revierte entera (patrón
  //    `deshacerAsignacionLote`, 149/R20-R21). No se deja pasar a los ganadores.
  if (movidas.length !== ordenIds.length) throw new CorreccionDiaConflictoError(...);

  // 4. EL RASTRO, en la MISMA tx y sobre exactamente las que ganaron (R22).
  await registrarCambioDiaReparto(tx, movidas.map((m) => ({ ... })));
  return movidas.length;
});
```

Cinco cosas, ninguna decorativa:

1. **El día entra como TEXTO `YYYY-MM-DD` con `::date` explícito**, vía `fechaRepartoComoTexto`. El
   porqué lo escribió la 246 y no es teórico (`lib/utils/dia-reparto.ts:36-52`): el driver `pg`
   serializa un `Date` de JS como `timestamptz` y Postgres lo convierte a `date` con el `TimeZone`
   **de la sesión**; el día dependería de la configuración del servidor de base de datos.
2. **`<>` contra el día elegido** es **R7** en la escritura, además de en el pre-chequeo del
   servicio: una orden que ya está en ese día no gana, y por el todo-o-nada el lote se revierte con
   su motivo. También impide que el `CHECK` de la tabla reviente con un mensaje de Postgres en vez de
   con uno accionable.
3. **`FOR UPDATE` y no un `SELECT` a secas**: sin el bloqueo, el `fecha_anterior` del rastro podría
   ser un valor que ya no era el de la fila al escribir. Un rastro que miente es peor que no
   tenerlo.
4. **`zona_id` repetido en el `WHERE`** cuando el actor es `adminSatelite`: defensa en profundidad
   anti-TOCTOU, exactamente como `deshacerAsignacionLote` con su `zonaActor` (149, design §3.2).
5. **`updated_at` a mano**: el SQL crudo no dispara el `@updatedAt` de Prisma (patrón
   `asignarSateliteLote`).

### 6.2 · La invariante 246/R10: **esto es una excepción legítima, y se afirma**

> **La regla (246/R10):** «El día de reparto sólo tiene valor mientras la orden tenga mensajero
> asignado. Se escribe SIEMPRE en la misma escritura que fija `asignado_at`, y se limpia SIEMPRE en
> la misma escritura que lo limpia.»
>
> **La excepción (262/D5, 2026-08-22):** una **corrección del día** no toca `asignado_at`, porque
> **no es una re-asignación**. El mensajero es el mismo y el instante en que se le asignó no ha
> cambiado. La invariante sigue entera porque esta escritura **exige** mensajero y día previos y no
> puede crear ni un día huérfano ni un mensajero sin día.

**Por qué pisar `asignado_at` sería peor, y no sólo «innecesario»:**

- **Falsearía el dato.** `db/schema.prisma:502` lo define como «instante de la **última
  (re)asignación** de mensajero». Corregir un día no reasigna a nadie.
- **El motivo original de la invariante SOBREVIVE, y lo dice el propio repo.**
  `CierreDiaRepository:902-907`: «las dos columnas no pueden contar historias distintas. Si
  `asignado_at` dijera "te la acabo de reasignar" y `fecha_reparto` conservara la reserva de ayer, el
  corte de esta misma noche la protegería o la barrería según un dato que ya no describe nada».
  Léase al revés y se ve la excepción: **aquí la que cambia es la columna que describe el reparto, y
  la que describe la asignación sigue siendo cierta.** No hay dos historias: hay una sola, corregida.
- **La 261 ya abrió esta misma puerta y en la dirección contraria**: su `CASE` **conserva** el día al
  reescribir `asignado_at`. Aquella dijo «reponer la asignación no cancela una reserva»; ésta dice
  «corregir la reserva no reescribe la asignación». Son la misma frase mirada desde los dos lados.

**⚠️ Y aquí está el hallazgo que había que afirmar y no descubrir en rojo:**

> **La guardia actual NO se pondría roja con esta escritura. NI SIQUIERA LA VERÍA.**

Medido en `tests/unit/guards/fecha-reparto-acompana-asignado-at.guardia.test.ts:95-122`: el censo
recoge **sólo** los `data: {…}` que mencionan `asignadoAt` y **sólo** los `SET` que contienen
`"asignado_at" =`. Una escritura que toca **únicamente** `fecha_reparto` **no entra en el censo**, así
que las cuatro cláusulas la ignoran —incluida la de aritmética de zona horaria (R17 de la 246)—.

Eso significa dos cosas y conviene decir las dos: (a) esta ficha **no** rompe la guardia, así que
nadie se enteraría de nada; y (b) precisamente por eso **la guardia se queda a medias**: vigila una
dirección de la invariante y a partir de ahora existe la otra.

### 6.3 · Cómo se declara la excepción **sin abrirle un agujero**

La guardia se **ensancha**, con el mismo cuidado con el que la 261 anexó la reversión de D5 a la
246: lo que ya vigila **no se toca ni se relaja**; se le añade un censo nuevo y una lista de
excepciones **de un solo elemento**.

**Censo nuevo — «escrituras del DÍA»:** todos los `data: {…}` que mencionan `fechaReparto` y todos
los `SET` que **asignan** `"fecha_reparto" =` (con o sin `asignado_at`).

| Cláusula nueva | Qué exige | Qué caza |
| --- | --- | --- |
| **(d1)** | El censo del día no está vacío y tiene **≥ 7** entradas | Un refactor que mueva las escrituras y deje la guardia verde por vacía |
| **(d2)** | Toda entrada del censo que **no** toque `asignado_at` coincide con la **excepción declarada**: `archivo === "lib/repositories/OrdenRepository.ts"` **y** el conjunto **exacto** de columnas asignadas es `{fecha_reparto, updated_at}` | Una escritura del día **nueva** que se salte la invariante por cualquier otro sitio |
| **(d3)** | Esas entradas son **exactamente UNA** | Una segunda escritura con la misma forma en el mismo archivo — el hueco que (d2) sola dejaría |
| **(d4)** | La cláusula de aritmética horaria (`NOW()::date`, `CURRENT_DATE`, `AT TIME ZONE`, `interval '`, `America/Costa_Rica`) se aplica **también** al censo nuevo | Una segunda definición del día dentro de una sentencia, que hoy nadie mira en esta escritura |

**Por qué la huella es «archivo + conjunto exacto de columnas» y no otra cosa:**

- **Por archivo a secas, no**: `OrdenRepository.ts` tiene decenas de escrituras; la excepción se
  volvería «en este archivo vale todo».
- **Por nombre del método, tampoco**: el extractor trabaja sobre texto y no conoce la función que lo
  contiene; deducirla retrocediendo hasta el `async <nombre>(` más cercano se rompe con la primera
  función anidada. Una guardia frágil termina desactivada.
- **El conjunto exacto de columnas es lo que cierra la puerta**: si mañana alguien le suma
  `"mensajero_asignado_id" =` o `"estatus_id" =` a **esta misma** escritura, la huella cambia y la
  guardia se pone **roja**. Que es justo lo que debe pasar: eso ya no sería una corrección de día.

**La excepción se declara con fecha, motivo y puntero** dentro de la guardia (molde de
`d5-revertida.guardia.test.ts`), y **cada detector es una función pura con autocomprobación**: se le
da un texto que infringe y otro que no. Sin eso, una guardia de forma se queda verde por vacía en
cuanto un rename deja de encajar — este repo ya tuvo una que no podía fallar nunca.

⚠️ **Detalle del extractor que hay que probar, no suponer:** el censo corta de `SET` al primer
`WHERE`/`RETURNING`. La escritura de §6.1 es un `UPDATE` plano, así que el corte cae donde debe. La
autocomprobación **debe incluir esa forma exacta** y una variante infractora (la misma con
`"asignado_at" = NULL` añadido) para demostrar que la huella discrimina.

---

## 7 · La superficie

### 7.1 · Dónde se pulsa

| Superficie | Dónde | Qué se añade |
| --- | --- | --- |
| `/ordenes` (maestro/admin) | `OrdenesListado.accionesPara`, casos `por_recoger`, `en_reparto` y `ayuda_tienda` | Acción de lote **«Cambiar día de reparto»**, `variant: "outline"` (la primaria de `por_recoger` sigue siendo imprimir etiquetas / deshacer) |
| `/recepcion-satelite` (adminSatelite) | `SateliteOrdenesListado`, botonera de `por_recoger` | Botón hermano, junto a «Deshacer asignación», con el mismo `disabled` por estado mixto |

`en_reparto` y `ayuda_tienda` **ya son opciones del filtro de estado** de `/ordenes` para
maestro/admin: `EXCLUDE_POR_ROL` sólo les excluye `"pendiente"`, y ese mapa es **parcial** —lo no
listado auto-aparece— (`app/(app)/ordenes/exclude-por-rol.ts:19-21`, y la ausencia de `ayuda_tienda`
es una decisión afirmada en test por la 235). O sea: **no hay que abrir ninguna pantalla ni ningún
filtro nuevo** para alcanzar la población atrapada.

### 7.2 · Qué se lee

**El modal, en tres partes** (molde de `AsignarBodegaModal` + `DeshacerAsignacionModal`):

1. **La lista del lote, con el día de cada orden.** `«17496963 · hoy está para el 22 de agosto»`.
   Es **R16**, y es lo que impide corregir a ciegas un lote mixto.
2. **El selector de día**, el mismo componente `SelectorDiaReparto` con las mismas
   `fechasDiaReparto` que ya bajan de las dos páginas (**R17**: ni una fecha se calcula en el
   navegador). **Sin preselección**: al contrario que al asignar —donde «Hoy» viene marcado
   (246/R27)—, aquí **no hay opción por defecto**, porque la mitad de las correcciones son «hoy →
   mañana» y la otra mitad «mañana → hoy»; una preselección convertiría un despiste en una
   corrección equivocada. El confirmar está deshabilitado hasta que se elige.
3. **El motivo**, obligatorio, mismo campo y mismas cotas que `DeshacerAsignacionModal` (**R21**).

**Al confirmar**, la frase de **R10** sale de `confirmacionDiaReparto(dia, fechas)`, la misma función
que ya usa la asignación (**R18**): *«El lote quedó para el reparto de mañana, 22 de agosto.»* Sin
siglas, sin nombres de columna, sin `YYYY-MM-DD` a la vista — la regla con la que este repo retiró
«SLA» del frontend.

**Al rechazar**, el `conflict` trae **detalle por orden** y la pantalla lo pinta (**R19**), con el
mapper de errores del listado. Nada de «Actualiza la lista y vuelve a intentarlo» cuando reintentar
no arregla nada: ese mensaje falso es el que originó la investigación de la ficha 241.

**El día por orden viaja en el DTO**, no se calcula abajo: `OrdenListItemDTO` gana
`fechaRepartoISO?: string | null` (`YYYY-MM-DD` ya serializado en el repositorio). El precedente es
literal y está en el mismo tipo: `fechaReprogramacion?: string | null`, «ya serializada por el repo
[…], no `Date`: el DataTable descarta objetos al renderizar» (`lib/types/orden.ts:322-329`). El
listado satélite hace lo propio en `RecepcionSateliteDTO`.

**Lo que NO se hace, con su motivo (límite 2, alternativa A7):** no se añade una **columna** «Día de
reparto» al listado. Toca el ancho de una tabla que ya tiene un problema de anchos abierto (ficha
**263**), la descarga y los 13 listados de la FASE 2. El día se ve donde se decide.

---

## 8 · Contratos I/O — todo lo que cambia de forma

| Archivo | Cambio | Por qué así |
| --- | --- | --- |
| `db/schema.prisma` | `model OrdenDiaRepartoCambio` + relaciones inversas en `Orden` y `Usuario` | §5.1 |
| `lib/interfaces/repositories/IOrdenRepository.ts` | `corregirDiaRepartoLote(ordenIds, fecha: Date, estatusIds: string[], zonaId: string \| null, ctx: { actorUsuarioId; motivo })` → `Promise<number>`; `CorreccionDiaConflictoError` con `ordenIdsNoCorregidas` | Espejo de `deshacerAsignacionLote` + su `DeshacerAsignacionConflictoError`. La fecha llega **ya resuelta**: un solo sitio que sabe traducir «hoy/mañana» (doctrina `dia-reparto.ts:4-9`). |
| idem | `OrdenTransicionRow.fechaReparto: Date \| null` — **obligatorio, sin `?`** | Es insumo de una **guarda** (**R5**/**R7**). El patrón aditivo `?` existe para no romper fixtures; aquí romperlos es **deseable**: un fixture que se olvide del campo debe romper el build, no apagar la guarda en silencio. Mismo criterio que 261/B1. |
| `lib/interfaces/services/ICorreccionDiaRepartoService.ts` (nuevo) | `corregir(input: { ordenIds; dia: DiaReparto; motivo }, actor, now?: Date)` → `ok \| forbidden \| sin_zona \| conflict \| validation_error` | `now?` inyectable: «hoy» y «mañana» sólo se prueban moviendo el reloj (246/261). El union de resultado es el de `IDeshacerAsignacionService`, que la UI ya sabe pintar. |
| `lib/actions/corregir-dia-reparto.ts` (nuevo) | zod: `ordenIds: uuid[].min(1)`, `dia: diaRepartoSchema` (**sin `.default`**, §4.3), `motivo: trim().min(10).max(300)` | Borde delgado, molde literal de `deshacer-asignacion.ts`. |
| `lib/types/orden.ts` | `OrdenListItemDTO.fechaRepartoISO?: string \| null` | §7.2. Aditivo, patrón `fechaReprogramacion`. |
| `lib/types/recepcion-satelite.ts` | idem en `RecepcionSateliteDTO` | El listado satélite necesita el mismo dato para **R16**. |
| `lib/utils/dia-reparto-textos.ts` | `avisoDiaActualDeLaOrden(fechaISO)` + `SELECTOR_DIA_TITULO_CORRECCION` | **R18**: una sola fuente. El módulo **sigue sin importar `Date` ni `Intl`** (**R17**) y reutiliza `fechaLegible`, que es puro. |
| `lib/repositories/registrar-cambio-dia-reparto.ts` (nuevo) | `registrarCambioDiaReparto(tx, entradas)` | §5.3 |

**Nada de esto toca `lib/types/**`… salvo que sí**: `lib/types/orden.ts` y
`lib/types/recepcion-satelite.ts` están ahí dentro. Sumado a la migración, el **gate completo** es
obligatorio por dos vías independientes. Ver §1.

---

## 9 · El riesgo aceptado de la 261 se cierra POR LA PUERTA

La 261 escribió el agujero **en el código** (R33) y lo puso bajo guardia (R26, mitad (e)) para que no
dependiera de que alguien se acordara. Ahora que la superficie existe, esa nota **no se borra**: se
**sustituye por su cierre**, con el mismo cuidado con el que la 261 anexó la reversión de D5 sin
reescribir el texto viejo.

**Soporte 1 — el código.** `lib/interfaces/services/IMisAsignacionesService.ts:126-133`. El párrafo
del riesgo aceptado pasa a decir, con estas piezas separadas para que el fallo diga **cuál** falta:

- que el riesgo **se aceptó** el 2026-08-22 y **por qué** (se bloquea antes de tener la salida);
- que **ya existe** superficie para corregir el día de una orden ya asignada, **dónde** está (los dos
  listados) y **quién** puede usarla;
- la **fecha** del cierre y el **puntero** a `specs/262-corregir-dia-reparto`;
- **el razonamiento de por qué se aceptó NO se borra**: quien lea el archivo dentro de seis meses
  tiene que poder entender por qué durante un tiempo no hubo salida.

**Soporte 2 — la guardia.** `tests/unit/guards/d5-revertida.guardia.test.ts`, mitad (e). Sus
`PIEZAS_DEL_AGUJERO` (`/NO EXISTE NINGUNA SUPERFICIE/`, `/ficha\s*\*{0,2}262/`, `/UPDATE.{0,20}a
mano/`) **dejarían de encajar** en cuanto se reescriba la nota. Hay que actualizarlas a las piezas
del **cierre** — y **no** relajarlas a un `.toBe(true)`:

| Antes (261/R33) | Después (262/R35) |
| --- | --- |
| «no existe ninguna superficie» | «la corrección existe» + dónde |
| puntero a la **ficha 262** | puntero a `specs/262-corregir-dia-reparto` **y** a la 261 |
| «la única salida es un `UPDATE` a mano» | «hasta el <fecha> la única salida fue un `UPDATE` a mano» (**en pasado**: el hecho no se borra) |

⛔ **Lo que NO se hace: borrar la mitad (e).** Si se borra, nadie se entera el día que alguien retire
la superficie «porque no la usa nadie», y el agujero vuelve sin ruido.

**Soporte 3 — el spec de la 261.** Apéndice **fechado** al pie de su *límite declarado 2* y de su
§7.2, marcándolo cerrado por esta ficha, **conservando intacto** el texto original (**R36**). Un spec
es la foto de su momento; el molde es el que la propia 261 le puso a §D5 de la 246.

---

## 10 · Verificación — qué prueba qué

**El gate COMPLETO (`./init.sh`) es obligatorio.** §1.

### 10.1 · El reparto, y por qué no vale con uno solo

| Qué se prueba | Dónde | Por qué **ahí** |
| --- | --- | --- |
| Rol, zona, estados, día ausente, día repetido, todo-o-nada (**R3**-**R8**, **R11**-**R15**) | **Servicio, con dobles** | La regla vive en el servicio; una mutación que borre un `if` deja el test rojo. |
| El `WHERE` de la escritura (**R9**) y el efecto sobre la fila (**R1**, **R27**) | **Postgres real** | ⚠️ Un test de servicio con dobles **no ve el SQL**. Medido cuatro veces en este repo: una mutación del `WHERE` deja once tests de servicio en verde. |
| El rastro: contenido, atomicidad y `fecha_anterior` correcta (**R20**-**R24**) | **Postgres real** | La atomicidad y el `FOR UPDATE` sólo existen dentro de una transacción de verdad. |
| Que NO hay fila de historial ni cambia el conteo de intentos (**R25**) | **Postgres real** | Es una **ausencia**: hay que contar filas antes y después. |
| RLS activa en la tabla nueva (**R26**) | **Postgres real** | Se lee `pg_class.relrowsecurity`; afirmarlo leyendo el `.sql` sería una aserción contra su propia fuente. |
| La invariante y su excepción (**R28**, **R29**) | **Guardia** | §6.3, con autocomprobación. |
| Que el corte cambia de opinión con el día (**R30**) | **Postgres real** | El predicado del corte se evalúa contra la fila corregida, no contra un doble. |
| Que el mensajero se desbloquea sin nada más (**R31**) | **Servicio** (el de la 261, con la fila ya corregida) | El bloqueo de la 261 es una comparación; con el día en hoy debe dejar de dispararse. |
| Textos y modal (**R10**, **R16**-**R19**) | Componente + unitario | Que el módulo de textos no importe `Date`/`Intl` y que la pantalla lea **el mismo string** que el servidor. |
| El cierre de la 261 (**R34**-**R36**) | Guardia de prosa | §9. |
| No-regresión de la ruta y de los indicadores (**R32**) | Los tests que ya existen + `ver la app` | La corrección no cambia `estatus_id`, y la ruta se arma de `findParadasEnReparto`. |

### 10.2 · Ningún test puede saltarse en silencio

Los de Postgres real usan `tests/integration/db/_postgres-real.ts` (`HAY_BASE_DE_DATOS`,
`enTransaccionRevertida`, `serializarEscriturasReales`, `fksDeOrden`).

- Sin base: **`describe.skip` a nivel de archivo**, que se ve en la salida.
- Con base: **dentro** del `describe` **no puede haber un `return` temprano**. Si `fksDeOrden`
  devuelve `null`, el test **revienta** con un mensaje que lo diga. Un `if (!fks) return;` reporta
  `passed` sin haber comprobado nada — ya pasó aquí.
- Todo lo sembrado vive dentro de `enTransaccionRevertida`: ni una fila queda en la base.

### 10.3 · Ver la app

En este repo mirar la app encontró **siete textos rotos que doce mil tests daban por buenos**. Es
tarea **F6** y no es opcional.

---

## 11 · Alternativas descartadas

**A1 · Reutilizar `orden_historial_estado` con una familia nueva** (`correccion_dia_reparto`).
Descartada **midiendo** las tres consecuencias: rompe «Deshacer asignación» por
`findOrigenesReversion`; el choke point la rechaza porque `por_recoger → por_recoger` no está en
`TRANSICIONES`; y emitiría un webhook duplicado a los integradores. Detalle en §4.5.

**A2 · No dejar ningún rastro.** Era una opción declarada de la ficha. Descartada: la corrección
pisa una decisión deliberada de otra persona y cambia lo que el corte hace esa noche y en qué día
cuenta la orden para el ranking. Sin autor, es el `UPDATE` a mano del 2026-08-21 con otra ropa.

**A3 · Una pantalla propia «Corrección de día de reparto».** Descartada: obliga a construir un
buscador de órdenes que **ya existe dos veces** (los dos listados con su barra de filtros), y aleja
la acción del sitio donde el operador **ve** el lote que acaba de marcar mal. El precedente de la
149 resolvió una operación de la misma forma con dos modales.

**A4 · Una sola superficie (`/ordenes`) y que el satélite pida ayuda.** Descartada: `/ordenes` hace
`notFound()` al `adminSatelite` (§4.1), así que la bodega que **eligió** el día no podría
corregirlo. Y el modo «pídeselo a otro» es el que acaba en un `UPDATE` a mano.

**A5 · Permitir mover a un día pasado, con una guarda de rol.** Descartada: reescribe denominadores
de ranking y tableros de días ya cerrados —con `premio_ranking` detrás— y **no gana nada** frente al
corte, que barre «ayer» y «hoy» igual (§4.3).

**A6 · Aceptar una fecha (`YYYY-MM-DD`) del cliente en vez de un token.** Descartada por la misma
razón que la 246 la descartó al asignar (R6) y una más: con un token, mover al pasado es
**imposible por construcción**; con una fecha, es un `if` que alguien puede relajar.

**A7 · Añadir una columna «Día de reparto» al listado.** Descartada: toca ancho de tabla, descarga y
los 13 listados de la FASE 2, con una ficha de anchos (**263**) ya abierta. El día se ve **por orden
dentro del modal**, que es donde se decide. Si se quiere la columna, es un aditivo pequeño y
separado.

**A8 · Tocar `asignado_at` «para no romper la invariante».** Descartada: falsearía el dato que el
esquema define como «instante de la última (re)asignación» y convertiría una corrección en una
reasignación fantasma. La invariante se conserva **por el `WHERE`**, no por pisar una columna (§6.2).

**A9 · Declarar la excepción de la guardia por ARCHIVO.** Descartada: `OrdenRepository.ts` tiene
decenas de escrituras y la excepción se leería como «en este archivo vale todo». La huella es
archivo **+ conjunto exacto de columnas** + **exactamente una** (§6.3).

**A10 · Declarar la excepción por NOMBRE DE MÉTODO.** Descartada: el extractor trabaja sobre texto y
deducir la función contenedora se rompe con la primera función anidada. Una guardia frágil termina
desactivada, que es peor que una guardia estrecha.

**A11 · Un solo `UPDATE ... FROM (SELECT … FOR UPDATE) RETURNING id, prev.anterior`.** Es correcto y
más corto. Descartada por dos costes concretos: el `SET` deja de ser plano y el censo de la guardia
—que corta al **primer** `WHERE`— pasaría a incluir el `WHERE` de la subconsulta, con lo que la
huella de columnas se vuelve delicada justo en la comprobación que protege la excepción; y el
`RETURNING` mezclado de dos alias es más difícil de leer en una escritura que tres personas van a
auditar. El `SELECT … FOR UPDATE` + `UPDATE` de §6.1 da la misma garantía con dos sentencias obvias.

**A12 · Un pre-`SELECT` sin `FOR UPDATE`** (como el de `asignarBodegaLote`, que pre-lee el origen
para el historial). Descartada **aquí**: allí lo que se pre-lee es el estado de origen de una
transición; aquí es **el dato que el rastro va a afirmar**. Sin bloqueo, el `fecha_anterior` puede
ser un valor que ya no era el de la fila. Un rastro que miente es peor que no tenerlo.

**A13 · Dejar pasar a los ganadores** cuando parte del lote pierde la guarda (patrón
`asignarSateliteLote`). Descartada: la 149 ya eligió el **todo-o-nada real** para una operación de
corrección sobre un lote elegido a mano, y por el mismo motivo — quien selecciona 20 órdenes y ve
«se corrigieron 17» no sabe cuáles tres faltan ni por qué.

**A14 · Ofrecerla también sobre `en_bodega_central` / `en_bodega_satelite`.** Descartada: ahí la
orden **no tiene día** (ni mensajero); lo que hace falta es asignarla, y esa pantalla ya existe.

---

## 12 · Riesgos

| Riesgo | Mitigación |
| --- | --- |
| La excepción a la invariante se convierte en la puerta por la que entran otras escrituras del día | §6.3: la guardia exige **exactamente una**, con huella de archivo + columnas, y la cláusula horaria se extiende al censo nuevo. |
| El rastro afirma un `fecha_anterior` que ya no era | `FOR UPDATE` dentro de la misma tx (§6.1, **R24**), y un test contra Postgres real que lo comprueba. |
| Alguien «limpia» la nota de la 261 en vez de cerrarla | §9: la guardia se **actualiza**, no se borra, y la mitad (e) sigue existiendo con las piezas del cierre. |
| Una corrección mueve una orden entre días del ranking sin que nadie lo sepa | Es el efecto **buscado** —el día es lo que se corrige— y por eso queda con autor, motivo e instante (**R20-R21**). El pasado está cerrado (**R3**). |
| La migración se edita después de aplicarse | Lección viva del repo: lo añadido tras aplicarse no llega nunca a esa base. Si hace falta cambiar algo, **migración nueva**. |
| Otra sesión mueve `dev` mientras esto se implementa | Pre-vuelo contra `origin/dev` justo antes del PR (**C2**). |
| El gate se corre a la vez que un subagente edita el árbol | Prohibido: el gate lee el árbol mutado y su veredicto no vale. Secuencia, no paralelismo. |

---

## 13 · Decisiones y preguntas

**Cerradas en este documento** (las cuatro que la ficha exigía, más la invariante):

| # | Decisión | Dónde |
| --- | --- | --- |
| **D1** | Quién: maestro/admin (cualquier zona) + adminSatelite (su zona). Nadie más. | §4.1 · R11-R12-R15 |
| **D2** | Desde dónde: acción de lote en **los dos listados** que ya eligen el día. Sin pantalla nueva. | §4.2 · R13 |
| **D3** | El pasado: **no**, y por el vocabulario (token `hoy`/`manana`), no por un `if`. | §4.3 · R2-R3 |
| **D3'** | Tampoco se crea un día donde no lo había, ni se borra. | §4.4 · R4-R5 |
| **D4** | Rastro: tabla propia append-only, en la misma tx, con motivo obligatorio. **No** el historial de estados. | §4.5 · §5 · R20-R26 |
| **D5** | La invariante 246/R10: **excepción legítima declarada**, `asignado_at` no se toca, y la guardia se ensancha para que sea la **única**. | §6.2 · §6.3 · R27-R29 |

**Abiertas** (van a la puerta humana, con recomendación): **P1** rastro visible en «Ver historial»,
**P2** aviso al mensajero, **P3** vocabulario más allá de «mañana». Texto completo en
`requirements.md § Preguntas abiertas`.

**Regla que sigue en pie para la implementación:** si aparece un dato que no está en `docs/`, en
`specs/` ni en el código, **se para y se pregunta** (CLAUDE.md, regla 6). Ninguna de estas decisiones
autoriza a rellenar un hueco nuevo con un supuesto.
