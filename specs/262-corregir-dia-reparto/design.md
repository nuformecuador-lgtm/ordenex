# Feature 262 — Diseño

> Lee `requirements.md` antes que esto. Aquí sólo van las **decisiones**, con lo que se descartó y
> por qué. Todo lo que se afirma como «medido» se leyó en el árbol y se cita por archivo y línea.
>
> ⬛ **2026-08-22 — LA PUERTA HUMANA ENSANCHÓ LA FICHA.** P1 y P2 se respondieron **en contra** de la
> recomendación de este documento y P3 a favor. El alcance nuevo vive en **§14** (el rastro en «Ver
> historial»), **§15** (el aviso al mensajero) y **§16** (P3, confirmación explícita de que nada
> cambia). §1, §10, §11, §12 y §13 quedan actualizadas; **§2 a §9 no se reescriben**: siguen siendo
> correctas y son el cimiento sobre el que se apoya lo nuevo.

---

## 1 · Alcance

| Entra | No entra |
| --- | --- |
| Una operación de **lote** que fija el día de reparto de órdenes ya asignadas | Cambiar el **estado**, el mensajero, la guía o el instante de asignación (**R1**) |
| Las **dos superficies** que ya eligen el día al asignar: `/ordenes` y `/recepcion-satelite` | Una pantalla nueva (§4.2, **A3**) |
| El **rastro** de cada corrección: tabla nueva, migración con `down.sql` y RLS (§5) | Una **pantalla propia** para el rastro: se ve dentro de «Ver historial», que ya existe (§14, **A15**) |
| ⬛ **El rastro DENTRO de «Ver historial»** (P1): DTO en unión, fusión de dos fuentes en el servicio y una entrada sin transición (§14) | Llevar «Ver historial» a una superficie nueva — el mensajero y el `adminSatelite` siguen sin ese drawer (límite 7, **P5**) |
| ⬛ **El aviso al mensajero** (P2): valor nuevo en dos enums, migración con `down.sql` de recreación y emisor best-effort (§15) | Push, WhatsApp o correo: el aviso viaja por la campana y por nada más (límite 11) |
| El **cierre por la puerta** del riesgo aceptado en 261/R33 (§9) | Backfill de avisos o de entradas de historial hacia atrás: no hay nada que rellenar (la tabla nace en esta ficha) |
| La **excepción declarada** a la invariante 246/R10, con su guardia (§6.3) | Cualquier backfill o reparación automática (**R33**) |

**Una migración, ninguna alteración.** La tabla del rastro es **nueva**; `orden` no cambia de forma:
ni columna, ni índice, ni default. `fecha_reparto` sigue siendo `DateTime? @db.Date` tal cual.

⚠️ **El gate rápido SE NIEGA en esta ficha, y no es una elección.** El diff toca `db/migrations/**`
y `db/schema.prisma`, dos de las rutas que `docs/verification.md` (§ tabla) declara sin escape:
«una migración no la importa nadie: ningún test sale seleccionado por tocarla». **`./init.sh`
completo, obligatorio.**

⬛ **Y desde el 2026-08-22 se niega por CINCO vías independientes, no por una.** Vale la pena
contarlas porque una sola bastaría y aquí ninguna es opcional: (1) `db/migrations/**` de la tabla del
rastro (§5.2); (2) `db/migrations/**` de la ampliación de los dos enums (§15.2); (3)
`db/schema.prisma`; (4) `lib/types/orden.ts` y `lib/types/recepcion-satelite.ts` (§8); (5)
`lib/types/notificacion.ts` y `lib/types/orden-historial.ts`, los dos también bajo `lib/types/**`
(§14.1, §15.2). **`./init.sh` COMPLETO antes del PR, sin excepción** (`tasks.md` § CIERRE, **C1**).

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

> ⚠️ **NOTA DE CADUCIDAD — 2026-08-23 (feature 271).** La **justificación** de arriba ya no rige: la
> regla 2 de la 241 —«recibir asignaciones no se bloquea nunca»— **la revirtió la ficha 271**.
> Recibir trabajo nuevo **sí** se bloquea, y en las tres escrituras (reparto central, reparto
> satélite y recolección). **La decisión de esta ficha —R14, que un cierre pendiente NO bloquea la
> corrección— sigue en pie**, pero por su OTRA razón, que no dependía de aquella regla: corregir el
> día de una orden que el mensajero **ya tiene en la mano** no es darle trabajo nuevo ni gestionar.
> Está escrito así en el código (`lib/services/CorreccionDiaRepartoService.ts`, cabecera del
> `Pick`). **Este spec no se reescribe**: es la foto de su momento. Regla vigente en
> `specs/271-segundo-cierre-y-bloqueo/requirements.md`.

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

> ⏳ **2026-08-22 — AQUÍ DECÍA ESO, y es FALSO para `/ordenes`.** Lo corrige el leader tras
> verificarlo en el código, no el implementador por su cuenta.
>
> El párrafo de arriba **generaliza a las dos superficies el comportamiento de UNA**. Medido en
> `app/(app)/ordenes/_components/OrdenesListado.tsx:681-700`: `accionesPara` **no es una
> intersección**, es una **unión** —recorre cada orden seleccionada, acumula por `accion.key` y
> devuelve cada acción marcada con `parcial` y su **conteo** (`` `${accion.label} (${ordenes.length})` ``)
> cuando sólo aplica a parte de lo elegido—. O sea que ese listado **sí** ofrece acciones sobre
> selección mixta, acotadas al subconjunto elegible.
>
> **Lo que vale, superficie por superficie:**
>
> | | `/ordenes` | `/recepcion-satelite` |
> | --- | --- | --- |
> | forma | `accionesPara`, **unión con conteo** | botonera con `disabled` por estado mixto |
> | selección mixta | **sí** se ofrece, acotada al subconjunto | **no** se ofrece |
>
> Así que la implementación **sigue el patrón real de cada listado**, que es lo que R13 quería
> decir: la corrupción sería inventar en `/ordenes` un `disabled` que ninguna otra acción suya
> tiene. **R16 no se toca** y sigue siendo lo que impide corregir a ciegas un lote mixto: el
> subconjunto se muestra contado antes de confirmar.
>
> Lo que este spec describía era el comportamiento **anterior** de `accionesPara`. La línea de
> arriba se conserva —es la foto de lo que se creyó al diseñar— y esta nota la supersede.

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
  // ⬛ 2026-08-22: el `RETURNING` de abajo se ENSANCHA en §15.5 (el aviso necesita mensajero,
  //    guía y remisión). El `SET` NO cambia: sigue siendo `{fecha_reparto, updated_at}`, que es la
  //    huella que vigila la guardia de §6.3 — y el censo corta al PRIMER `WHERE`, así que el
  //    `RETURNING` queda fuera de la huella por construcción. Ver §15.5 para la forma final.
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
| No-regresión de la ruta y de los indicadores (**R32**) | **Postgres real, con ruta SEMBRADA** (corregido el 2026-08-23) | ⛔ Esta fila decía «los tests que ya existen + `ver la app`», y esa fue la puerta por la que R32 se quedó **sin ninguna aserción**: la revisión midió que un `rutaOptimizadaParada.deleteMany` dentro de la propia transacción de la corrección sobrevivía a **3.302 tests**. «Los tests que ya existen» no prueban una ausencia que nadie afirma, y `ver la app` no es un test. Lo que sí lo prueba está en `correccion-dia-reparto-efectos.int`, bloque R32: **hace falta ruta sembrada que perder** —con la tabla vacía todo conteo da cero y sigue dando cero—. |
| ⬛ La **fusión** de las dos fuentes y su orden (**R37**, **R40**, **R41**, **R45**) | **Servicio, con dobles** | La regla es de composición pura: dos listas entran, una sale. Un doble por fuente permite forzar el empate de instante, que contra Postgres real es difícil de provocar a voluntad. |
| ⬛ La **lectura** del rastro por orden y su índice (**R37**) | **Postgres real** | Es un `WHERE` + `ORDER BY`; un doble no ve el SQL (medido cuatro veces en este repo). |
| ⬛ La entrada **sin transición** en pantalla (**R38**, **R39**) | Componente | Que NO aparezca ninguna etiqueta de estado y que las dos fechas salgan de la fuente única. |
| ⬛ Que el build **rompa** si alguien la trata como transición (**R42**) | `pnpm typecheck` + `@ts-expect-error` | Una unión discriminada sin consumidor exhaustivo no la caza ningún test de runtime. |
| ⬛ Que el rastreo público **no la vea** (**R43**) | Guardia existente + **Postgres real** | Es una ausencia: `rastreo-frontera.guardia` ya prohíbe que ese borde nombre el DTO, y el repo público lee otra tabla. |
| ⬛ La autorización heredada (**R44**) | **Servicio, con dobles** | Los cuatro roles con visibilidad y los dos sin ella, sobre la MISMA llamada. |
| ⬛ El aviso: destinatario, texto con fecha, dos correcciones → dos avisos (**R46**, **R47**, **R48**, **R50**, **R51**) | Unitario del emisor, con repositorio doble | Es el patrón exacto de `notificacion-productores.test.ts`. |
| ⬛ Que un aviso caído **no** tumbe la corrección (**R49**) | Unitario del servicio | Molde literal de «R25 — un aviso que falla no tumba la carga masiva». |
| ⬛ El enum: inventario cerrado, migración aditiva y `down` que recrea (**R52**, **R53**, **R54**) | Lectura de los `.sql` + **Postgres real** | Molde literal de `tests/integration/db/notificacion-evento-postulacion-recurso-migration.test.ts`, incluido el `down` ejercitado de verdad. |
| ⬛ Los dos sentidos del aviso sobre una orden en la calle (**R55**) | Unitario del servicio + `ver la app` | El caso que la puerta humana nombró: «mañana → hoy» con el paquete ya encima. |
| ⬛ P3: el vocabulario no cambia (**R56**) | Los tests que YA existen | §16: es una confirmación, no un cambio. Su prueba es que `dia-reparto.ts` no aparece en el diff. |

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

### ⬛ Alternativas del alcance añadido el 2026-08-22

**A15 · Un panel propio para leer el rastro**, en vez de meterlo en «Ver historial». Descartada por
lo mismo que A3 descartó la pantalla de corrección: obliga a construir un buscador de órdenes que ya
existe, y **separa el rastro de la única línea de tiempo que la gente ya abre para entender qué le
pasó a una orden**. La respuesta a P1 fue literalmente «tiene que verse en Ver historial».

**A16 · Añadir los campos de la corrección al DTO actual y hacer `estatusDestinoValue` nullable.**
Es la opción de una línea. Descartada, y es el corazón de §14.1: con campos opcionales, **cada
consumidor sigue compilando** y pinta «undefined → undefined» o una fila vacía. Un DTO que admite una
entrada sin transición **sin obligar a nadie a mirarla** es la definición del fallo mudo que este
repo tiene documentado cinco veces. La unión discriminada rompe el build en cada consumidor: ese rojo
**es** la funcionalidad.

**A17 · Discriminar por presencia de campo** (`"fechaNuevaISO" in entrada`) en vez de por un campo
`clase` explícito. Descartada: funciona hoy y deja de funcionar el día que aparezca una tercera
clase de entrada, que caería en el `else` sin que nada se pusiera rojo. Con discriminante explícito,
el `switch` es exhaustivo y TypeScript lo demuestra (**R42**).

**A18 · Fusionar las dos fuentes en el COMPONENTE** y dejar el servicio como está. Descartada:
`R26` de la 49 puso el orden cronológico en el servicio y **R41** lo confirma. Ordenar en el
navegador metería una segunda definición del orden, y el componente tendría que comparar `Date`s —
justo lo que la 261 y la 246 sacaron del cliente.

**A19 · Escribir la corrección como fila de `orden_historial_estado` "sólo para que se vea".** Es A1
otra vez, ahora con la excusa de la pantalla. Sigue descartada por las **tres consecuencias medidas**
de §4.5 —rompe «Deshacer asignación», el choke point la rechaza por transición ilegal y emite un
webhook falso a los integradores— y ninguna de las tres se ablanda porque ahora haya un motivo
visual. La pantalla se resuelve leyendo dos tablas; la máquina de estados no se toca.

**A20 · Reusar `entidad_tipo = 'orden'` con `entidad_id = <ordenId>` para el aviso.** Descartada, y
es el hallazgo más importante de §15: `notificacion_dedupe_key` es UNIQUE sobre
`(evento, entidad_id, destinatario_rol, destinatario_usuario_id)` con `NULLS NOT DISTINCT`
(`db/migrations/20260727120000_notificacion/migration.sql:89-92`). Con esa clave, la **segunda**
corrección de la misma orden para el mismo mensajero **no produce aviso jamás** —ni siquiera después
de que el primero se lea—, y `NotificacionRepository.crear` absorbe el `P2002` devolviendo `false`
(`:116-118`): silencio absoluto. El caso que la puerta humana nombró («mañana → hoy» sobre una orden
que ya lleva encima) es **exactamente** el que llega segundo.

**A21 · Emitir el aviso con `entidad_id = NULL`** para desactivar la dedupe. Descartada: apaga la
dedupe por **nulidad** en vez de por **clave**, deja `entidad_tipo = 'orden'` apuntando a ninguna
orden concreta y vuelve inútil el índice `notificacion_entidad_idx` para estas filas. Es media
verdad con formato de dato — la misma objeción que el `migration.sql` de la 253 escribió contra esta
misma idea, sólo que allí el problema era el contrario (querían dedupe y la perdían).

**A22 · Emitir el aviso DENTRO de la transacción de la corrección**, como hace el del rechazo.
Descartada, y no por comodidad: dentro de una transacción de Postgres un error de sentencia aborta la
transacción entera (lo dice el propio choke point,
`lib/repositories/registrar-cambio-estado.ts:203-205`). O sea que un aviso caído **revertiría una
corrección legítima** y devolvería a la orden al estado inalcanzable que esta ficha existe para
sacarla. La dirección segura del error es la contraria: **la corrección manda, el aviso es cortesía**
(**R49**).

**A23 · Un solo aviso agregado por lote** («3 de tus órdenes cambiaron de día»). Descartada: no
puede nombrar **qué** paquete, que es el único dato con el que el mensajero hace algo, y obligaría a
inventar una entidad de «lote» que no existe en ninguna tabla. El coste declarado es el límite 10.

**A24 · Meter el motivo escrito por quien corrige dentro del aviso.** Descartada: los textos de la
campana son fijos y compuestos en un solo sitio (146 §4.6) y **R48** prohíbe PII; el motivo es texto
libre de 10 a 300 caracteres escrito por un humano y puede contener cualquier cosa, incluido un
teléfono o un nombre. El motivo se lee en el historial (§14), que sí tiene autorización por orden.

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
| ⬛ El DTO en unión rompe consumidores que nadie tenía en el radar | Es el **objetivo**, no el riesgo: `pnpm typecheck` los enumera todos de una vez (§14.1). El riesgo real sería que NO rompiera. Inventario esperado en `tasks.md` **B24**. |
| ⬛ Un aviso duplicado desaparece en silencio por la dedupe | Cerrado por construcción: la entidad del aviso es **la corrección**, no la orden, así que la clave única nunca colisiona (§15.3, **A20**). Probado con dos correcciones seguidas sobre la misma orden (**R50**). |
| ⬛ La ampliación del enum rompe DOS tests que pertenecen a otras fichas | Conocido y con nombre: `tests/unit/services/notificacion-productores-wiring.test.ts:381-404` y `tests/integration/db/notificacion-evento-postulacion-recurso-migration.test.ts:162-185` enumeran los valores **literalmente**. Se **actualizan**, no se relajan (§15.4, **R52**). Que se pongan rojos es la prueba de que el inventario sigue cerrado. |
| ⬛ Alguien «arregla» el orden cronológico moviéndolo al componente | **R41** + el test de servicio con empate de instante. El orden vive donde 49/R26 lo puso. |
| ⬛ El rastro filtra al rastreo público al fusionar fuentes | Medido: el borde público lee `orden_historial_estado` con un `select` explícito de dos campos (`RastreoPublicoRepository:44-48`) y **no consume** el DTO; la guardia `rastreo-frontera` ya prohíbe que lo nombre. **R43** lo afirma para que la ausencia sea una comprobación y no una casualidad. |

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
| ⬛ **D6** | El rastro **se ve en «Ver historial»**: DTO en **unión discriminada**, fusión y orden **en el servicio**, entrada **sin transición** en pantalla. | §14 · R37-R45 |
| ⬛ **D7** | El aviso al mensajero: evento nuevo + **entidad nueva** (`orden_dia_reparto_cambio`), **best-effort fuera de la transacción**, un aviso por corrección. | §15 · R46-R55 |
| ⬛ **D8** | El vocabulario del día **no cambia**: sigue siendo el token `hoy`/`manana` de 246/D2, y esta ficha **no toca** `lib/types/dia-reparto.ts`. | §16 · R56 |

**Cerradas por la PUERTA HUMANA del 2026-08-22** (las tres, con su respuesta):

| # | Pregunta | Respuesta | Consecuencia |
| --- | --- | --- | --- |
| **P1** | ¿El rastro se ve en «Ver historial»? | **SÍ** — contra la recomendación de este documento | Alcance nuevo: §14, **R37-R45**. Límite declarado 3, supersedido. |
| **P2** | ¿Se avisa al mensajero? | **SÍ** — contra la recomendación | Alcance nuevo: §15, **R46-R55**. Dos valores de enum, una migración más, límite 4 supersedido. |
| **P3** | ¿Hace falta más vocabulario que «hoy / mañana»? | **NO** — a favor de la recomendación | §16: **no cambia nada**, y se afirma explícitamente para que la ausencia de diff sea una decisión. |

**Abiertas** (nacen del alcance nuevo, van a la MISMA puerta humana, con decisión por defecto ya
tomada para no bloquear la implementación): **P4** ¿la tienda lee la corrección y su motivo?; **P5**
¿el `adminSatelite` necesita leer el rastro que escribe? Texto completo en
`requirements.md § Preguntas abiertas del alcance añadido`.

**Regla que sigue en pie para la implementación:** si aparece un dato que no está en `docs/`, en
`specs/` ni en el código, **se para y se pregunta** (CLAUDE.md, regla 6). Ninguna de estas decisiones
autoriza a rellenar un hueco nuevo con un supuesto.

---
---

# ⬛ 14 · D6 — El rastro SE VE en «Ver historial» (P1, cerrada **SÍ** el 2026-08-22)

## 14.0 · Lo medido antes de proponer nada

Todo lo que sigue se leyó en el árbol. Cinco piezas y una ausencia:

| Pieza | Dónde | Qué dice hoy |
| --- | --- | --- |
| **El DTO** | `lib/types/orden-historial.ts:266-273` | Seis campos y ninguno opcional: `estatusOrigenValue: string \| null`, `estatusDestinoValue: **string**` (NO nullable), `origenTipo`, `actorNombre`, `motivo`, `createdAt`. **Es un DTO de transiciones y sólo de transiciones.** |
| **Quién lo construye** | `OrdenHistorialRepository.toEntradaDTO:79-88`, alimentado por `findHistorialByOrden:230-237` | `findMany` sobre `orden_historial_estado` con `orderBy: { createdAt: "asc" }` y el `include` de etiquetas (`WITH_LABELS:42-48`). **Una sola fuente, una sola tabla.** |
| **Quién lo sirve** | `OrdenHistorialService.obtenerHistorial:34-55` | Autoriza **primero** (`autorizar:86-110`), lee después, y suma `intentos` + `umbral`. El orden cronológico es responsabilidad **del servicio** (49/R26). |
| **El borde** | `lib/actions/orden-historial.ts:44-56` (`buildService:31-37`) | Server Action; resuelve actor y arma el servicio con **dos** repos. |
| **Quién lo pinta** | `app/(app)/ordenes/_components/HistorialOrdenTimeline.tsx:33-77` | `esCreacion = estatusOrigenValue === null` → «Creación · destino»; si no, «origen → destino» con `estatusLabel`. Componente **tonto**: recibe por props (49/R28). |
| **Quién NO lo consume** | `lib/repositories/RastreoPublicoRepository.ts:44-48` | El rastreo público lee `orden_historial_estado` **directamente**, con un `select` de dos campos, y `tests/unit/guards/rastreo-frontera.guardia.test.ts:87-96` **prohíbe** que sus siete módulos nombren siquiera `OrdenHistorialEntradaDTO`. |

**Y la medición que decide el alcance de esta sección:** el drawer se monta en
`OrdenesModule.tsx:381` bajo la prop `mostrarHistorial`, que **sólo** pasa
`app/(app)/ordenes/page.tsx:121` y `:132` — y esa misma página hace `notFound()` para `mensajero` y
`adminSatelite` (`:55`). O sea: **el público de esta sección es maestro, admin y adminTienda.** El
mensajero se entera por la campana (§15) y el `adminSatelite` no se entera dentro de la app (límite
7, **P5**). Los dos canales no se solapan por casualidad: se reparten a propósito.

> **El problema, en una frase, y es el que el spec ya había anticipado:** una corrección de día
> **no tiene estado destino**, y `estatusDestinoValue` es `string` NOT NULL. No hay hueco donde
> meterla sin mentir.

## 14.1 · D6-a — El DTO se vuelve una **unión discriminada**

```ts
// lib/types/orden-historial.ts

/** Feature 49 — una TRANSICIÓN de estado. Los seis campos de siempre, sin tocar. */
export interface OrdenHistorialTransicionDTO {
  clase: "transicion";
  estatusOrigenValue: string | null;   // NULL = creación (49/R20)
  estatusDestinoValue: string;         // sigue NOT NULL: una transición SIEMPRE tiene destino
  origenTipo: OrdenHistorialOrigenTipo;
  actorNombre: string | null;          // NULL = sistema/cron (49/R21)
  motivo: string | null;
  createdAt: Date;
}

/** Feature 262 (D6) — una CORRECCIÓN del día de reparto. NO tiene estado de origen ni destino. */
export interface OrdenHistorialCorreccionDiaDTO {
  clase: "correccion_dia";
  fechaAnteriorISO: string;  // `YYYY-MM-DD` YA serializado por el repo (nunca un `Date`)
  fechaNuevaISO: string;
  actorNombre: string;       // NOT NULL: aquí nunca escribe un cron (§5.1) y `usuario.nombre` es NOT NULL
  motivo: string;            // R21: obligatorio, así que aquí tampoco es opcional
  createdAt: Date;
}

export type OrdenHistorialEntradaDTO =
  | OrdenHistorialTransicionDTO
  | OrdenHistorialCorreccionDiaDTO;
```

Cinco decisiones dentro, cada una con su porqué:

1. **El NOMBRE `OrdenHistorialEntradaDTO` se conserva** y pasa a ser el de la unión. No es
   cosmética: `IOrdenHistorialService.ObtenerHistorialServiceResult` lo nombra
   (`:12`) y la guardia del borde público lo tiene en su lista de símbolos prohibidos
   (`rastreo-frontera.guardia.test.ts:79`). Renombrarlo dejaría esa guardia vigilando un símbolo
   muerto — verde para siempre y sin decir nada.
2. **Discriminante EXPLÍCITO (`clase`) y no derivado por presencia de campo** (**A17**). Con `clase`
   el `switch` es exhaustivo y TypeScript lo demuestra; con `"fechaNuevaISO" in entrada` una
   tercera clase futura caería en el `else` en silencio.
3. **`estatusDestinoValue` NO se vuelve nullable** (**A16**). Ése era el atajo de una línea y es el
   fallo mudo: cada consumidor seguiría compilando y pintaría una fila vacía. Con la unión, **todos**
   los consumidores rompen el build a la vez y hay que mirarlos uno a uno. Ese rojo **es** la
   funcionalidad — mismo criterio con el que §8 quitó el `?` de `OrdenTransicionRow.fechaReparto`.
4. **Las dos fechas viajan como `YYYY-MM-DD` ya serializado, jamás como `Date`.** Precedente literal
   y verificado: `MisAsignacionesService.ts:266-267` hace `fechaRepartoComoTexto(row.fechaReparto)`
   para `fechaRepartoISO` por esta misma razón (261/R14). Un `@db.Date` leído por Prisma es la
   medianoche UTC de esa fecha; formatearlo en el navegador con la hora local devuelve el día
   anterior en media América. Y de paso: el `DataTable` de este repo descarta objetos al renderizar
   (`lib/types/orden.ts`, nota de `fechaReprogramacion`).
5. **La corrección NO tiene `origenTipo`, y eso es deliberado.** `OrdenHistorialOrigenTipo` es el
   censo cerrado de las familias de **escritura de `orden.estatus_id`**, respaldado por un enum de
   Postgres y por el chequeo `_EnsureExhaustive` (`orden-historial.ts:253-260`). Añadirle un valor
   para algo que **no escribe ningún estado** sería (a) una migración de enum más, (b) una mentira
   sobre la máquina de estados y (c) una fila con `origen_tipo` que ninguna fila de
   `orden_historial_estado` tendría nunca. La unión hace innecesario el valor: la clase ya lo dice.

**R42, cómo se demuestra.** Además del `switch` exhaustivo en el componente (con
`const _exhaustivo: never = entrada;` en el `default`, patrón `_EnsureExhaustive` del propio
archivo), un test de tipos con `@ts-expect-error` (hay precedente: nueve archivos de `tests/` lo usan)
afirma que **leer `estatusDestinoValue` sobre la unión sin estrechar NO compila**. Si alguien
convirtiera la unión en una interfaz con opcionales, ese `@ts-expect-error` dejaría de tener error
que suprimir y `pnpm typecheck` se pondría **rojo**. Es la única forma de que R42 no sea una promesa.

## 14.2 · D6-b — La lectura del rastro: **repositorio propio**

```
lib/interfaces/repositories/IOrdenDiaRepartoCambioRepository.ts   (nuevo)
lib/repositories/OrdenDiaRepartoCambioRepository.ts               (nuevo)
  findCorreccionesByOrden(ordenId: string): Promise<OrdenHistorialCorreccionDiaDTO[]>
```

- **Repo propio y no un método más en `OrdenHistorialRepository`**: son **tablas distintas**. Aquel
  repo es el de `orden_historial_estado` y además es el **choke point del append** de estados
  (`IOrdenHistorialRepository:9-12`); colgarle una lectura de otra tabla difumina justamente el
  límite que hace que ese choke point signifique algo.
- **Ordena `created_at ASC, id ASC`.** El desempate por `id` no es adorno: sin él, dos filas del
  mismo instante salen en orden indefinido y la línea de tiempo cambiaría entre dos recargas. Es el
  mismo motivo con el que `findOrigenesReversion` añadió `id DESC`
  (`IOrdenHistorialRepository:138-141`: «el desempate por `id` sólo existe para que la consulta sea
  determinista»).
- **Resuelve sobre el índice `@@index([ordenId, createdAt])` que §5.1 ya declaró.** Aquella tabla se
  diseñó con «la única consulta prevista: el rastro de esta orden» — y ésta es exactamente esa
  consulta. No hace falta ningún índice nuevo: se comprueba, no se supone (**B28**).
- **Mapea a DTO en el repositorio**, con `fechaRepartoComoTexto` para las dos fechas y el `nombre`
  del actor por `include`. Es lo que ya hace `toEntradaDTO` en el repo hermano: mismo patrón, misma
  capa, y el servicio recibe algo que sólo tiene que **mezclar**.

## 14.3 · D6-c — La fusión y el orden viven **en el servicio**

```ts
// OrdenHistorialService.obtenerHistorial, tras `decision === "ok"`
const [transiciones, correcciones] = await Promise.all([
  this.historialRepo.findHistorialByOrden(ordenId),
  this.correccionRepo.findCorreccionesByOrden(ordenId),
]);
const entradas = fusionarLineaDeTiempo(transiciones, correcciones); // función PURA, exportada
```

**Por qué aquí y no en el componente** (**A18**): 49/R26 puso el orden cronológico en el servicio y
**R41** lo confirma. Ordenar en el navegador sería una **segunda** definición del orden y obligaría
al componente a comparar `Date`s — lo que la 246 y la 261 sacaron del cliente a propósito.

**La regla de orden, completa y sin huecos** (**R40**):

1. Ascendente por `createdAt`.
2. **Empate exacto de instante → primero la transición, después la corrección.** Es una regla
   arbitraria y por eso se **declara** en vez de dejarla al `sort`: `Array.prototype.sort` es estable
   desde ES2019, pero la estabilidad sólo fija el orden *dentro* de la lista de entrada, y aquí hay
   **dos** listas. Sin regla, el orden dependería de cómo se concatenaron — un detalle de
   implementación gobernando lo que alguien lee para entender qué pasó.
3. **Dentro de cada fuente se preserva el orden que la fuente entregó.** El de correcciones es
   determinista (§14.2). El de transiciones es `createdAt asc` a secas: **hoy tampoco desempata**, y
   esta ficha **no lo cambia** — es una propiedad preexistente y arreglarla aquí sería tocar una
   consulta que doce features consumen.

**El sello de tiempo: por qué las dos fuentes son comparables.** Las dos columnas se llenan con el
`DEFAULT` de la tabla, `CURRENT_TIMESTAMP`
(`db/migrations/20260713120000_orden_historial_estado/migration.sql:39`; misma convención en §5.1,
`createdAt DateTime @default(now())`). En Postgres `CURRENT_TIMESTAMP` es el instante de **inicio de
la transacción**, no el del commit — así que dos escrituras solapadas pueden ordenarse por su inicio.
**Es la propiedad que la línea de tiempo ya tiene hoy dentro de una sola tabla**; se hereda al
fusionar y se declara (límite 9). Lo que **no** se hace es inventar un segundo criterio: usar la
misma convención en las dos fuentes es lo que hace que compararlas signifique algo.

**Y un caso que no puede darse, dicho para que nadie lo «arregle»:** una corrección y una transición
de la **misma** transacción no existen — la corrección tiene prohibido escribir en
`orden_historial_estado` (**R25**, §4.5) y ni siquiera podría (el choke point rechazaría
`por_recoger → por_recoger`).

## 14.4 · D6-d — La pantalla: una entrada **sin transición**

`HistorialOrdenTimeline` pasa a `switch (entrada.clase)`. Para `"correccion_dia"`:

```
● Día de reparto
  Del 21 de agosto al 22 de agosto
  22 ago 2026, 09:14
  Por Ana Pérez
  Motivo: la bodega marcó el lote para el día siguiente por error
```

- **La primera línea es texto, no color.** Este repo tiene guardia de contraste y una lección escrita
  sobre medir color en el navegador; distinguir la entrada sólo por un punto de otro tono no dice
  **qué** es. La palabra «Día de reparto» sí.
- **No aparece ninguna etiqueta de estado** (**R39**): en esta rama **no se llama a `estatusLabel`**
  ni se pinta la flecha `→` de estado. Es afirmable en un test por ausencia.
- **Las dos fechas salen de la fuente única** (**R18**): `lib/utils/dia-reparto-textos.ts` gana
  `textoCorreccionDiaReparto(anteriorISO, nuevaISO)` → «Del 21 de agosto al 22 de agosto», compuesta
  con `fechaLegible`, que ya es pura. **Ese módulo sigue sin importar `Date` ni `Intl`** (246/R29,
  261/R14) — y por eso la fecha del día no pasa por el reloj del navegador (**R41**). El sello de
  hora sí lo formatea el componente con su `Intl` fijo a `America/Costa_Rica`, que es lo que ya hace
  hoy para todas las entradas (`HistorialOrdenTimeline.tsx:14-18`): son cosas distintas — un
  **instante** frente a una **fecha calendario**.
- **El componente no lleva ni un literal de fecha**: todos importados. Es lo que mata la mutación
  M-x, y ahora también M-ac.
- **La `key` de la lista** deja de poder ser `${index}-${createdMs}` a secas si dos fuentes empatan;
  se le antepone `entrada.clase`. Detalle pequeño y con consecuencia real: dos `key` iguales en React
  producen un remontado silencioso.

## 14.5 · El inventario de lo que se rompe **a propósito**

Convertir el DTO en unión rompe el build en todo consumidor que lea un campo de transición. Eso es el
objetivo (**A16**), pero el inventario se escribe **antes** para que nadie lo confunda con un
accidente. Los consumidores hoy, medidos con `grep` sobre `OrdenHistorialEntradaDTO`:

| Archivo | Qué le pasa |
| --- | --- |
| `lib/repositories/OrdenHistorialRepository.ts` | `toEntradaDTO` añade `clase: "transicion"`. |
| `lib/interfaces/repositories/IOrdenHistorialRepository.ts` | `findHistorialByOrden` pasa a devolver `OrdenHistorialTransicionDTO[]` (el tipo **estrecho**: ese método sólo lee transiciones, y decirlo evita que alguien crea que ya fusiona). |
| `lib/interfaces/services/IOrdenHistorialService.ts` | `entradas` sigue siendo `OrdenHistorialEntradaDTO[]` — la unión. Sin cambio de nombre. |
| `lib/services/OrdenHistorialService.ts` | Gana el tercer repo y la fusión (§14.3). |
| `lib/actions/orden-historial.ts` | `buildService` instancia el repo nuevo. |
| `app/(app)/ordenes/_components/HistorialOrdenTimeline.tsx` | `switch` exhaustivo (§14.4). |
| `tests/components/HistorialOrdenTimeline.test.tsx`, `HistorialOrdenSheet.test.tsx`, `EstatusBadgeRetiroFulfillment.test.tsx`, `tests/unit/services/orden-historial-service.test.ts`, `tests/unit/actions/orden-historial-action.test.ts` | Sus fixtures ganan `clase: "transicion"`. **Ninguno cambia de aserción**: **R45** exige que una orden sin correcciones se lea exactamente igual que antes. |
| `tests/unit/guards/rastreo-frontera.guardia.test.ts` | **No se toca.** Sigue prohibiendo el símbolo, que sigue existiendo con el mismo nombre. |

---

# ⬛ 15 · D7 — Al mensajero **se le avisa** (P2, cerrada **SÍ** el 2026-08-22)

## 15.1 · Lo medido antes de proponer nada

| Pregunta | Respuesta medida |
| --- | --- |
| ¿El mensajero ve la campana? | **Sí.** `/mis-asignaciones/reparto/page.tsx:41` y `/recoger/page.tsx:34` usan `AppPage` → `PageHeader` → `NotificationsBell` (`components/shared/AppPage.tsx:36`, `PageHeader.tsx:91`). |
| ¿Con qué retardo? | **60 s** como máximo sin recargar: `refreshInterval: REFRESH_INTERVAL_MS` (`hooks/useNotificaciones.ts:63`, `lib/config/notificaciones.ts:17`), más revalidación al recuperar el foco. |
| ¿Se puede dirigir un aviso a **una** persona? | **Sí**, y hay precedente: `destinatario: { tipo: "usuario", usuarioId }` en `emitirCargaMasivaTerminada` (`lib/notificaciones/emitir.ts:250`). El predicado de visibilidad lo resuelve por `destinatarioUsuarioId` (`NotificacionRepository.predicadoVisibilidad:39-50`). |
| ¿Cuántos valores tiene el enum y qué cuesta uno más? | **Cinco** (`db/schema.prisma:2067-2075`). Cuesta: migración de enum, `down.sql` de recreación, el tipo de `lib/types/notificacion.ts:14-20` y **dos tests ajenos que enumeran la lista literalmente** (§15.4). |
| ¿Cómo se emite: dentro o fuera de la transacción? | Las dos formas existen. Transaccional **sólo** el del rechazo (dentro del choke point, `registrar-cambio-estado.ts:206`); los otros tres son **best-effort** con `emitirBestEffort` (`lib/notificaciones/notificadores.ts:40-50`). |
| ¿Hay dedupe? | **Sí, y es el hallazgo que decide el diseño.** Guardia por «no leída» (`emitirFilas:65-84`) **más** un índice UNIQUE permanente: `notificacion_dedupe_key` sobre `(evento, entidad_id, destinatario_rol, destinatario_usuario_id)` con `NULLS NOT DISTINCT` y `WHERE entidad_id IS NOT NULL` (`db/migrations/20260727120000_notificacion/migration.sql:89-92`). |

## 15.2 · D7-a — Los dos valores nuevos y su migración

```sql
-- db/migrations/<timestamp>_notificacion_evento_dia_reparto_corregido/migration.sql
ALTER TYPE "notificacion_evento"       ADD VALUE IF NOT EXISTS 'dia_reparto_corregido';
ALTER TYPE "notificacion_entidad_tipo" ADD VALUE IF NOT EXISTS 'orden_dia_reparto_cambio';
```

**Migración SEPARADA de la del rastro (§5.2), y con timestamp POSTERIOR.** Molde literal de la 253,
que hizo exactamente esto y escribió el porqué en su propio `migration.sql:21-25`: Postgres **no
permite usar** un valor de enum recién añadido en la misma transacción que lo añadió (55P04), y
Prisma Migrate corre cada `migration.sql` en una. Aquí sólo se añaden; el primer uso ocurre en
runtime, en transacciones posteriores. Además, la entidad `orden_dia_reparto_cambio` **nombra una
tabla que la migración anterior crea**: el orden entre las dos migraciones no es estético.

**Por qué TAMBIÉN el segundo enum, que es la parte que se olvida.** `notificacion.entidad_tipo` es
`NOT NULL` y discrimina a qué tabla apunta `entidad_id` (referencia polimórfica, sin FK). Los cinco
valores vigentes son `orden`, `usuario`, `cierre_dia`, `carga` y `postulacion_recurso`, y **ninguno
describe una fila de `orden_dia_reparto_cambio`**. Reusar `orden` es lo que hace **A20**, y **A20
está descartada por una razón que no es de estilo**: con `entidad_id = <ordenId>`, la clave única
`notificacion_dedupe_key` sólo admite **una** fila por (evento, orden, mensajero) **para siempre**, y
la segunda corrección de esa orden no produciría aviso **nunca** —`crear` absorbe el `P2002` y
devuelve `false` (`NotificacionRepository.ts:116-118`), sin ruido—. El caso que la puerta humana
nombró, «mañana → hoy sobre una orden que el mensajero ya lleva encima», es **precisamente** el que
llega en segundo lugar.

### El `down.sql`: la pregunta obligatoria de este repo, hecha y respondida

> **¿El `down.sql` del enum recrea-con-lista o sólo dropea?**

Medido, sobre los **dos** downs que existen para estos tipos:

| `down.sql` | Qué hace | Qué implica para esta ficha |
| --- | --- | --- |
| `20260727120000_notificacion/down.sql:11-13` (feature **146**, el que CREÓ los enums) | **Sólo dropea**: `DROP TYPE IF EXISTS "notificacion_entidad_tipo"; DROP TYPE IF EXISTS "notificacion_evento";` — porque allí se van también las tablas que los usan. **No recrea con lista.** | **NO SE TOCA.** Es una foto histórica y el valor que añadimos no cambia nada de lo que ese down debe hacer. |
| `20260820210000_notificacion_evento_postulacion_recurso/down.sql:44-61` (feature **253**) | **Recrea con lista**: `RENAME TO *_old` → `CREATE TYPE` con los **cuatro** de la 146 → `ALTER COLUMN ... USING` → `DROP TYPE *_old`. | **NO SE TOCA.** Su lista es «el enum ANTES de la 253» y sigue siéndolo. Renumerar o editar una migración ya aplicada es la lección de *«migración editada en sitio = drift»*. |
| **El nuestro** (nuevo) | **Recrea con lista**, misma forma, pero con **los CINCO valores previos** de `notificacion_evento` (los cuatro de la 146 **más** `postulacion_recurso_pendiente`) y **los CINCO** de `notificacion_entidad_tipo`. | Es el **único** down que tiene que conocer la lista de hoy. |

Y las tres propiedades que ese `down.sql` debe conservar, copiadas del razonamiento de la 253 porque
siguen valiendo palabra por palabra:

1. **Irreversibilidad parcial declarada**: `ALTER TYPE ... DROP VALUE` no existe; recrear es la única
   forma.
2. **Precondición ruidosa** (**R54**): si queda **alguna** fila con `evento = 'dia_reparto_corregido'`
   o `entidad_tipo = 'orden_dia_reparto_cambio'`, el `USING` falla y el rollback **aborta**. Es el
   comportamiento **correcto**: esas filas son avisos que un mensajero puede no haber leído. Nada de
   `DELETE` para «hacer sitio».
3. **Los índices no se rehacen a mano**: en `notificacion_entidad_idx` y en `notificacion_dedupe_key`
   la columna del enum entra como **columna** del índice y no en un predicado comparado contra un
   literal del tipo viejo — el único caso que `ALTER COLUMN ... TYPE` no sabe reconstruir solo. Que
   el `NULLS NOT DISTINCT` y el `WHERE` parcial **sobrevivan** no se supone: se mide contra Postgres
   (**B22**), igual que lo midió la 253.

## 15.3 · D7-b — El emisor: qué fila se escribe

```ts
// lib/notificaciones/emitir.ts  (§4.6 de la 146: los textos viven aquí y en ningún otro sitio)
export interface DiaRepartoCorregidoContexto {
  cambioId: string;            // id de la fila de `orden_dia_reparto_cambio` = LA ENTIDAD del aviso
  mensajeroUsuarioId: string;  // el destinatario, y el único
  fechaNuevaISO: string;       // `YYYY-MM-DD` ya resuelto por el servidor
  anexo: string;               // la guía si existe; si no, el nº de remisión (patrón del rechazo)
}

export function textoDiaRepartoCorregido(fechaNuevaISO: string): string { /* §15.6 */ }

export async function emitirDiaRepartoCorregido(
  repo: INotificacionRepository,
  ctx: DiaRepartoCorregidoContexto,
): Promise<number> {
  return emitirFilas(repo, [{
    tipo: "box",
    evento: "dia_reparto_corregido",
    descripcion: textoDiaRepartoCorregido(ctx.fechaNuevaISO),
    anexo: ctx.anexo,
    entidadTipo: "orden_dia_reparto_cambio",
    entidadId: ctx.cambioId,
    destinatario: { tipo: "usuario", usuarioId: ctx.mensajeroUsuarioId },
  }]);
}
```

| Elección | Por qué |
| --- | --- |
| `entidadId` = **el id del cambio**, no el de la orden | La dedupe deja de poder morder: cada corrección es una entidad distinta, así que la clave única nunca colisiona y **R50** («dos correcciones, dos avisos») es una propiedad **estructural**, no una esperanza. Y el `entidad_id` sigue apuntando a una fila que existe de verdad. **A20** y **A21** descartadas. |
| **Una** fila, no cuatro | Es la única notificación de este repo dirigida a **una** persona junto con la de carga masiva. Los admins **no** se avisan (**R51**): ellos son quienes corrigen. |
| `tipo: "box"` (icono de paquete) | Los tres tipos son `alert` (rojo, `text-danger`), `box` y `warning` (`NotificationsBell.tsx:55-63`). Esto es un **paquete que cambió de día**, no una alarma ni algo pendiente de aprobación. `alert` teñiría de rojo una corrección legítima de planificación. |
| `anexo` = guía, o remisión si no hay | Copia exacta de `emitirOrdenRechazada:113`. Identifica la orden **sin** exponer destinatario, dirección ni monto (**R48**). |
| **Sin `motivo`** en el aviso | **A24**: el motivo es texto libre de 10-300 caracteres escrito por un humano y puede llevar PII. Se lee en el historial (§14), que autoriza por orden. |

## 15.4 · D7-c — Los dos censos AJENOS que se ponen rojos (y se actualizan, no se relajan)

Esto no es un efecto colateral: es **el precio que 146/D1 le puso a añadir un evento**, y por eso
funciona.

| Test | Línea | Qué afirma hoy | Qué hay que hacer |
| --- | --- | --- | --- |
| `tests/unit/services/notificacion-productores-wiring.test.ts` | `:381-404` | «el enum de eventos sigue siendo un inventario CERRADO: **exactamente cinco**», con la lista **literal**. | Añadir `"dia_reparto_corregido"` a la lista y decir **seis** en el título. **La lista sigue siendo literal**: el propio test explica por qué derivarla del esquema la dejaría siempre verde. |
| `tests/integration/db/notificacion-evento-postulacion-recurso-migration.test.ts` | `:162-185` | Que el **esquema vivo** tiene exactamente `[...EVENTOS_146, "postulacion_recurso_pendiente"]` y `[...ENTIDADES_146, "postulacion_recurso"]`. | Actualizar **sólo esas dos aserciones** (son sobre el esquema de HOY). ⛔ Lo demás de ese archivo —el UP de la 253, su DOWN con cuatro valores, y «el down de la 146 no se toca»— **NO se toca**: son fotos históricas y siguen siendo ciertas. |

⚠️ **Y una trampa de ese archivo, medida:** su helper `carpetaQueTerminaEn(sufijo)` hace un `find`
sobre los nombres de carpeta **ordenados** (`:30-39`). La migración nueva **no puede** llamarse de
forma que termine en `_notificacion` ni en `_notificacion_evento_postulacion_recurso`, o ese test
empezaría a leer **otro** archivo y afirmaría cosas verdaderas sobre el fichero equivocado. El nombre
propuesto (`_notificacion_evento_dia_reparto_corregido`) no colisiona; **se comprueba en B22.**

## 15.5 · D7-d — El cableado: **best-effort y fuera de la transacción**

```
CorreccionDiaRepartoService.corregir(...)
  ├─ 1. $transaction: SELECT FOR UPDATE → UPDATE guardado → rastro   (§6.1, intacto)
  │     ↳ devuelve CorreccionDiaAplicada[]  (una por orden corregida)
  └─ 2. FUERA de la tx, y sólo si (1) confirmó:
        for (const c of aplicadas) await notificar(c)   ← emitirBestEffort
```

**Por qué fuera y best-effort** (**A22**): dentro de una transacción de Postgres un error de
sentencia aborta la transacción entera —lo dice el propio choke point,
`registrar-cambio-estado.ts:203-205`—, así que un aviso caído **revertiría la corrección** y devolvería
la orden al estado inalcanzable que esta ficha existe para sacarla. La dirección segura del error es
la contraria: **la corrección manda; el aviso es cortesía** (**R49**). Un aviso perdido degrada
exactamente al comportamiento de antes de esta feature —el mensajero lo ve porque el botón deja de
estar gris—, mientras que una corrección revertida deja el paquete atrapado.

**Y no es un `catch` vacío** (`docs/conventions.md`): `emitirBestEffort("dia_reparto_corregido", …)`
registra el fallo con contexto vía `defaultLogger` (`notificadores.ts:40-50`). Se reutiliza la
función que ya existe; no se escribe una segunda.

**Cableado, calcado de los otros tres** (`notificadores.ts:11-19`): el `default` del constructor del
servicio es el **no-op**, y el notificador **real** se inyecta en el composition root —la Server
Action `lib/actions/corregir-dia-reparto.ts`—. Una suite que construya el servicio sin inyectar no
escribe nada, **por construcción**.

### Lo que esto cambia del contrato de §8

`corregirDiaRepartoLote` dejaba de devolver `Promise<number>`:

```ts
export interface CorreccionDiaAplicada {
  ordenId: string;
  cambioId: string;              // fila del rastro: la ENTIDAD del aviso (§15.3)
  mensajeroAsignadoId: string;   // NOT NULL por el `WHERE` (§6.1)
  numGuia: number | null;
  numRemision: string;
  fechaAnterior: Date;
  fechaNueva: Date;
}
// IOrdenRepository
corregirDiaRepartoLote(...): Promise<CorreccionDiaAplicada[]>   // antes: Promise<number>
```

- El `RETURNING` de §6.1 se ensancha a
  `RETURNING "id", "mensajero_asignado_id", "num_guia", "num_remision"`. **El `SET` no cambia.**
- `registrarCambioDiaReparto` (§5.3) **genera los `id` explícitamente** (`randomUUID()`) y los
  devuelve en el mismo orden, en vez de dejarlos al `@default(uuid())`: `createMany` de Postgres no
  devuelve ids, y el aviso necesita el del cambio. Sigue siendo un solo `createMany` y sigue siendo
  el único sitio que inserta en esa tabla.
- El conteo que el servicio usaba pasa a ser `aplicadas.length`. **R8** (todo-o-nada) no se toca: el
  `throw` sigue estando antes.

> ⚠️ **Consecuencia para la guardia de §6.3, y hay que decirla porque es el tipo de detalle que se
> descubre en rojo:** el censo del día corta de `SET` al **primer** `WHERE`/`RETURNING`, y aquí el
> `WHERE` va antes, así que la huella de columnas sigue siendo exactamente `{fecha_reparto,
> updated_at}` y **la cláusula (d2) no cambia**. Pero la **autocomprobación** de B9 debe usar la
> forma **FINAL** del SQL —la de este párrafo, con el `RETURNING` ancho—, no la de §6.1. Validar el
> detector contra un texto que ya no existe en el árbol es una guardia que se cree verificada.

## 15.6 · El texto del aviso

> **«Una orden tuya pasó al reparto del 22 de agosto.»**  ·  anexo: `17496963`

- **Nombra la FECHA, no «hoy» ni «mañana»** (**R47**). Un aviso que dijera «pasó a hoy» y se leyera a
  la mañana siguiente sería **falso**, y la campana guarda 30 días (`VENTANA_DIAS`). Es el mismo
  argumento con el que 261 puso la fecha en `avisoReservaParaOtroDia`
  (`dia-reparto-textos.ts:129-134`): «si el texto dijera "mañana", la app mentiría».
- **La fecha se pone en palabras con `fechaLegible`**, la misma función de la fuente única (**R18**),
  que no importa `Date` ni `Intl`. La frase se **compone** en `emitir.ts` porque 146/§4.6 exige que
  las cadenas de notificación vivan ahí y sólo ahí; lo que se importa es la conversión de fecha, no
  otro literal. Precedente de texto-función en ese archivo: `textoCargaMasivaTerminada` (`:48-50`).
- **Sin siglas, sin nombres de columna, sin `YYYY-MM-DD` a la vista**, la misma regla con la que este
  repo retiró «SLA» del frontend.
- **Un solo texto para los dos sentidos.** «Pasó al reparto del X» es cierto tanto si el día se
  adelantó como si se retrasó, y evita tener que decidir en el emisor cuál es cuál. El mensajero
  compara con lo que ya sabe; la app no le explica su propia agenda.

---

# ⬛ 16 · D8 — P3: el vocabulario del día **no cambia** (cerrada a favor de la recomendación)

Se escribe **precisamente porque no hay diff**: una decisión que no deja rastro en el código es la
que alguien reabre dentro de seis meses sin saber que ya se cerró.

**Lo que se confirma:** la corrección sigue mandando el token `"hoy" | "manana"`
(`lib/types/dia-reparto.ts:18-28`) y el servidor sigue traduciéndolo con
`resolverFechaReparto(dia, now)`. **`lib/types/dia-reparto.ts` y `lib/utils/dia-reparto.ts` NO
aparecen en el diff de esta ficha**, salvo por sus consumidores.

**Lo que eso preserva, y es la razón de la respuesta:** con dos opciones que significan «el día en
curso» y «el siguiente», **el pasado no es expresable** (§4.3). **R3** no depende de ningún `if` que
alguien pueda relajar «para un caso puntual»: depende del contrato. Cambiarlo se vería en el diff, se
discutiría y se decidiría.

**Lo que sigue sin poder hacerse, sin cambios respecto a lo ya declarado:** fijar **+2**. Un `UPDATE`
a mano en producción sí puede dejar +2 —pasó el 2026-08-21— y esa orden **se puede traer a «hoy»**,
porque «hoy» es una de las dos opciones; lo que no se puede es **ponerla** en +2 desde la app. Sigue
siendo el límite declarado 1, y sigue siendo una decisión de producto que tocaría **las dos**
superficies.

**Cómo se verifica una decisión de «no cambiar nada»** (**R56**): los tests que ya existen sobre
`dia-reparto.ts` y los dos bordes de asignación siguen en verde **sin tocarlos**, el schema zod de
esta ficha usa `diaRepartoSchema` **sin `.default`** (§4.3, mutación M-t) y el enum sigue teniendo
**dos** valores. Si alguien añadiera un tercero, rompería a la vez el borde de la asignación y el de
la corrección — que es exactamente la propiedad que P3 quiso conservar.
