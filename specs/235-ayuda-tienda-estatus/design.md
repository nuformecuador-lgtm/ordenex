# Feature 235 — Diseño técnico

> Requisitos en `requirements.md` (R1-R46). Enfoque **decidido por el humano**
> (`progress/design_pila_ayuda_tienda.md` §F1): **la solicitud de ayuda pasa de una bandera booleana
> a un estatus propio**. Aquí se documenta el cómo y el porqué, no se reabre el qué.
>
> **Molde:** `specs/239-devolucion-espera-cierre/design.md`. Esa feature ya hizo en `dev` el camino
> completo «estatus nuevo + aristas + migración de enum con `down.sql` que recrea + mapa de
> superficies», y lo hizo hace tres días. Todo lo que aquí se repite se repite **a propósito y con
> la cita al lado**, para que el diff de las dos sea comparable.
>
> El `value` del estatus está pendiente de firma (P1). En este documento se usa el **placeholder
> `⟨AYUDA⟩`**, con la recomendación `ayuda_tienda` (el nombre que ya fijó el diseño aprobado).
> Sustituir en un solo commit al recibir la firma.

---

## 0. El fallo, en una línea de causa y efecto

`orden.ayuda` es un `boolean NOT NULL DEFAULT false` (`db/migrations/20260818120000_orden_ayuda/`).
La orden **nunca sale de `en_reparto`**, así que **cada** superficie que debería excluirla tiene que
acordarse de leer esa columna. Hoy no la lee ninguna:

| Superficie | Fichero | Qué filtra hoy |
| --- | --- | --- |
| Optimizador de ruta | `OrdenRepository.findParadasEnReparto:1456` | `estatus = en_reparto`. **La bandera no aparece.** |
| Listado del portal | `MisAsignacionesService:150` → `findMisAsignaciones(id, [por_recoger, en_reparto])` | Los dos estados. **La bandera no aparece.** |
| Mapa, chat, trayecto vivo | `RepartoModule.tsx:628/776/575` | Derivan de `porGestionar`, que las trae |
| Gestionable sí/no | `MisAsignacionesService.cargarOrdenGestionable:508` | `estatusValue === "en_reparto"` → **la orden es gestionable** |
| Corte a «sección aparte» | `RepartoModule.tsx:253-262` | `useMemo` **de cliente** sobre `orden.ayuda` |

Y los tres efectos que hoy dependen de que la orden **siga en `en_reparto`** —bloqueo del cierre,
gestionabilidad y barrido nocturno— no están escritos en ningún sitio: **ocurren de rebote**.

**Con un estatus, `satisfies Record<OrderStatusValue, …>` de `TRANSICIONES` rompe el build hasta que
alguien decida las aristas del valor nuevo, y las cinco filas de arriba pasan a filtrar por
construcción.** Ese es el argumento central de la ficha y por eso está escrito aquí.

---

## 1. Modelo de datos

### 1.1 Tablas nuevas: ninguna. RLS nueva: ninguna

No se crean tablas. Se reutilizan `orden`, `order_status`, `orden_historial_estado` y `orden_nota`,
todas con su RLS ya declarada. No hay política nueva que escribir ni superficie nueva que aislar.

### 1.2 Un value nuevo en el catálogo `order_status`

`⟨AYUDA⟩` entra como **apéndice** de `ORDER_STATUS_SEED` (`lib/types/order-status.ts`), sin
renombrar, reordenar ni retirar ninguno de los 21 vigentes. **El catálogo pasa de 21 a 22.**

Migración `db/migrations/<ts>_order_status_ayuda_tienda/`:

- `migration.sql`: `INSERT INTO "order_status" ("id","value") SELECT gen_random_uuid()::text,
  '⟨AYUDA⟩' WHERE NOT EXISTS (SELECT 1 FROM "order_status" WHERE "value" = '⟨AYUDA⟩');`
  Copia literal de `20260819120000_order_status_devolucion_por_confirmar/migration.sql` (que a su vez
  copia el patrón de la 139/154/157). `order_status` es **tabla**, no enum: el alta es un INSERT.
- `down.sql`: `DELETE … AND NOT EXISTS (…referencias en "orden" ni en "orden_historial_estado"…)`.
  Copia literal del `down.sql` de la 239. En una base con historial real es **no-op** y la fila
  sobrevive huérfana: el historial es append-only y no se reescribe (R42). El código anterior verá un
  value fuera de su catálogo y lo pintará con el chip neutro (`EstatusBadge`, R41 de la 155) en vez
  de romper — que es exactamente lo que R42 pide.
- **Sin backfill** y sin `UPDATE orden` (R41). Lo que se haga con las órdenes en vuelo es un
  **script**, no una migración (§9).

### 1.3 Dos values nuevos en el enum `orden_historial_origen_tipo`

`solicitud_ayuda_tienda` (ida) y `rescate_ayuda_tienda` (vuelta), P2. **El enum pasa de 27 a 29.**

- `migration.sql`: `ALTER TYPE "orden_historial_origen_tipo" ADD VALUE IF NOT EXISTS '…';` dos veces.
- `down.sql`: RENAME a `_old`, `CREATE TYPE` **con la lista vigente hoy** (los **27** de
  `ORDEN_HISTORIAL_ORIGEN_TIPO_SEED`, es decir los 26 del down de la 157 + `anclaje_devolucion`),
  `ALTER TABLE … USING ("origen_tipo"::text::"…")`, `DROP TYPE …_old`. Patrón calcado de
  `20260819110000_orden_historial_origen_anclaje_devolucion/down.sql`.
- **Precondición del down**, dicha en el propio archivo: ninguna fila con esos dos `origen_tipo`. Si
  la hay, el `USING` **falla ruidosamente** y el rollback aborta. Es el comportamiento correcto:
  borrar el rastro de que un mensajero pidió auxilio no es seguro.

**¿El recreate obliga a rehacer índices? NO, y está verificado, no supuesto.** La única columna que
usa este enum es `orden_historial_estado.origen_tipo`; sobre ella hay **un** índice,
`orden_historial_actor_origen_created_idx` (`actor_usuario_id, origen_tipo, created_at`, feature
167). `ALTER COLUMN … TYPE` **reconstruye por sí solo** los índices que dependen de la columna
(reparsea la expresión original contra el tipo nuevo), y **no hay ningún índice parcial cuyo
predicado mencione el enum**: los tres índices de `orden_historial_estado` son btree plenos, sin
`WHERE`. Esta comprobación ya la dejó escrita el `down.sql` de la 239 (líneas 15-21); la tarea T1.2
la **re-verifica** contra `db/migrations/*/migration.sql` en vez de confiar en la cita.

**Rollback encadenado (condición conocida, se documenta y no se «arregla»):** los `down.sql`
anteriores de este enum **no se tocan** —son fotos históricas— y varios recrean el tipo con **lista
cerrada**, así que aplicarlos después de esta migración deja el enum sin los values nuevos. Es el
comportamiento esperado de una cadena de rollbacks.

**TS:** los dos entran en `ORDEN_HISTORIAL_ORIGEN_TIPO_SEED` (el `satisfies` + `_EnsureExhaustive`
rompen el build si SEED y enum divergen). **Ninguno entra en `ORIGEN_TIPOS_VISITA_REAL`** (R11):
pedir ayuda no es una visita fallida, y meterlos ahí subiría el conteo de intentos, adelantaría el
escalado del cron de SLA y **cobraría un rechazo antes de tiempo** — la dirección del error que
`specs/215` declara prohibida. **Ninguno entra en `ORIGEN_TIPOS_CON_GESTION`**: sus filas nacen con
`gestion_orden_id` nulo porque no vienen de ninguna gestión.

### 1.4 La columna `orden.ayuda` se RETIRA (P5)

Es la mitad implementada con el diseño equivocado y **queda reemplazada por el estado**. Se retira
con **todos** sus lectores y escritores, que son estos y no hay más (censo por `\.ayuda\b`):

| Sitio | Qué hace hoy | Qué pasa |
| --- | --- | --- |
| **Encendedor** — `OrdenRepository.marcarAyuda:2991` | `update { ayuda: true }` | **Se sustituye** por la transición (§3.1) |
| **Apagador 1** — `OrdenRepository.desmarcarAyuda:2999` | `update { ayuda: false }` («Recuperar») | **Se fusiona** con el 2 en el punto único de rescate (§3.2, R8) |
| **Apagador 2** — `OrdenRepository.habilitarNovedad:3019` | `update { ayuda: false }` («Habilitar») | Ídem. El método desaparece; `HabilitarNovedadService` pasa a llamar al rescate |
| **Lector** — `OrdenRepository.novedadWhere:2981` | rama `{ ayuda: true, estatus: en_reparto }` | Pasa a `{ estatus: { value: "⟨AYUDA⟩" } }` (§4). **Aquí muere el tapón que la 239 declaró con dueño** |
| **Lector** — `ventana-hilo-notas.ts:75-82` | 3er parámetro `ayuda` que abre la ventana en cualquier estatus | Desaparece (§5). **Aquí muere la deuda de R19 de la 239** |
| **Proyección** — `OrdenRepository:3087/3121`, `GestionOrdenRepository:116/154`, `OrdenNotaRepository:91/100`, `MisAsignacionesService:565`, `NovedadesService:146` | `select`/mapeo del campo | Se retiran con el campo |
| **Contratos** — `MiAsignacionDTO.ayuda?`, `MiAsignacionRow.ayuda?`, `NovedadOrdenRow.ayuda`, `OrdenParaHiloRow.ayuda` | | Se retiran. `estatusValue` ya viaja en `MiAsignacionDTO:19` y es suficiente |
| **UI** — `RepartoModule:259/312`, `GestionarOrdenPanel:821/827`, `NovedadAcciones:116/176`, `NovedadesModule:140` | | §6 |
| **Schema** — `db/schema.prisma` | columna | Se retira del modelo |

Migración `db/migrations/<ts>_orden_retiro_ayuda/`:

- `migration.sql`: `ALTER TABLE "orden" DROP COLUMN "ayuda";`
- `down.sql`: `ALTER TABLE "orden" ADD COLUMN "ayuda" boolean NOT NULL DEFAULT false;`
  **Pérdida de dato declarada:** el down repone la columna, no sus valores. Es aceptable porque la
  columna queda semánticamente muerta —ningún valor suyo significa nada después de este cambio— y el
  código anterior la leía con `DEFAULT false`, que es lo que el down deja. Mismo razonamiento, misma
  forma, que `20260819130000_orden_retiro_gestion_aprobada/down.sql`.

**Lo que NO se retira:** `orden.intentos_contacto`. Es historial acumulativo de la tienda, se
registra a mano, sobrevive deliberadamente a que la solicitud se retire y su propio contrato dice
que **no** debe atarse al flag. Sale de esta feature intacto.

### 1.5 Índices

**Ninguno nuevo.** Todas las consultas nuevas o modificadas filtran `orden` por `estatus_id` (índice
existente, el mismo que ya usan `findParadasEnReparto`, `findMisAsignaciones` y `novedadWhere`) o por
`(mensajero_asignado_id, estatus_id)`. El barrido del corte añade **una** lectura más por el mismo
índice (§7). La columna que se retira **no tenía índice**.

---

## 2. Transiciones (feature 140) — la red principal

La guardia de transiciones es **exhaustiva y rompe el build**. Es la razón de ser de esta ficha.

**Altas (3):**

| # | Arista | Familia | Rol | Productor |
| --- | --- | --- | --- | --- |
| #62 | `en_reparto → ⟨AYUDA⟩` | `solicitud_ayuda_tienda` | mensajero | `SolicitudAyudaService.solicitar` |
| #63 | `⟨AYUDA⟩ → en_reparto` | `rescate_ayuda_tienda` | mensajero / adminTienda | el punto único de rescate (§3.2) |
| #64 | `⟨AYUDA⟩ → sin_gestionar` | `corte_sin_gestionar` | sistema/cron | `CierreDiaRepository.crearCierre` (§7) |

**Bajas: ninguna.** `en_reparto` conserva sus seis salidas: pedir ayuda **no** sustituye a ningún
desenlace, lo añade. (Contraste con la 239, que sí dio de baja `en_reparto → devuelta` porque su
productor cambió de destino.)

**Aritmética:** `dev` con la 239 dentro está en **56 aristas de flujo / 54 pares únicos**. Las tres
altas son pares **nuevos**, así que quedan **59 / 57**. Estas cifras **se re-derivan en
implementación** contra `tests/fixtures/inventario-transiciones-140.ts`; no se copian de aquí.

**Lo que NO se declara, y por qué importa decirlo:**

- **`⟨AYUDA⟩ → entregada / reprogramada / devolucion_por_confirmar / rechazada / incidente`**: son las
  gestiones. La ficha **237** las trae junto con su productor (`gestionarDesdeAyuda`). Declararlas
  aquí sería repetir el error que la 154 cometió con `#43/#44` y que «costó el tren 154+155+156».
  **Consecuencia viva mientras 237 no entre:** desde `⟨AYUDA⟩` solo se sale rescatando o por el corte
  de la noche. Es un estado con salida, no un pozo.
- **`⟨AYUDA⟩ → en_bodega_*`**: no hay recuperación manual desde aquí. El paquete está en la moto, no
  en un estante.

**Invariante de conectividad (140/R14):** `⟨AYUDA⟩` tiene entrada (#62) y salidas (#63/#64) → no
entra en `ESTADOS_TERMINALES` ni en `ESTADOS_VESTIGIALES`.

---

## 3. Los dos servicios

### 3.1 Solicitar ayuda — se **modifica**, no se reescribe

`SolicitudAyudaService.solicitar` ya tiene la forma correcta y su puerta correcta: **el hilo es la
única puerta**. Lo que cambia es el **efecto**:

```
solicitar(input, actor):
  1. publicada = notas.publicar({ ordenId, cuerpo: motivo }, actor)     ← SIN CAMBIO (R3/R4)
     si publicada.status !== "ok" → devolver TAL CUAL, sin tocar nada   ← SIN CAMBIO
  2. transicionar la orden en_reparto → ⟨AYUDA⟩, GUARDADA por el estado ← era `marcarAyuda`
  3. gestionRepo.liberarOrdenEnGestion(actor.usuarioId, input.ordenId)  ← SIN CAMBIO (R7)
```

**El paso 1 va antes del 2 y eso deja de ser una preferencia para ser una necesidad:** después de la
transición la ventana de escritura del mensajero cambia de estado, y aunque §5 la mantiene abierta,
el orden inverso ataría la nota a una ventana que en un futuro podría estrecharse. Es el mismo orden
que hoy y el que fija el diseño aprobado (§F1).

**El paso 2 sustituye un `update` ciego por una transición guardada.** La guarda va **en el WHERE**
(`estatusId = enRepartoId`), no en un `if` previo: si la orden ya no está en reparto —el corte la
barrió, otra pestaña la gestionó— el `updateMany` afecta a 0 filas, **no se hace el append** y el
servicio devuelve el `forbidden` opaco del hilo. Sin efectos parciales.

**Idempotencia (cambia respecto de hoy, y hay que decirlo).** Hoy pedir ayuda dos veces deja la
orden marcada una vez y el hilo con dos motivos. Con el estatus, la **segunda** llamada encuentra la
orden fuera de `en_reparto`: la nota **no se publica** (la ventana del mensajero, §5, sí la admite en
`⟨AYUDA⟩`, así que **sí se publica**) y la transición no ocurre (`count = 0`). Resultado neto: **el
hilo sigue admitiendo el segundo motivo y la orden no se mueve**, que es el comportamiento que la UI
ya describe («lo que el mensajero suele necesitar la segunda vez es AÑADIR contexto»). Esto **exige**
que §5 abra la ventana del mensajero en `⟨AYUDA⟩`; si no, la segunda petición se rechazaría y el
botón «Ayuda pedida» quedaría muerto.

**P9 (quién puede pedir ayuda) se resuelve en la ventana, no con un `if`.** El servicio documenta a
propósito que no comprueba el rol: la puerta es la ventana del hilo. Con `VENTANA_ESCRITURA` como
tabla por rol (§5), «solo el mensajero pide ayuda» se expresa **quitando `en_reparto` de la ventana
del adminTienda**, que ya es el caso. No hace falta ninguna tabla de permisos nueva.

### 3.2 El rescate — punto **único** de escritura (R8)

Hoy hay **dos** apagadores (`desmarcarAyuda` y `habilitarNovedad`) que hacen lo mismo desde dos
servicios. Colapsan en uno:

```
rescatarOrdenAyuda({ ordenId }, actor):
  1. acceso = autorizarSobreHilo(notaRepo, ordenId, actor)     ← rol con hilo + orden viva + pertenencia
     si !acceso.ok → forbidden opaco
  2. si acceso.orden.estatusValue !== ⟨AYUDA⟩ → forbidden      ← guarda de estado (R9)
  3. transicionar ⟨AYUDA⟩ → en_reparto, GUARDADA por el estado ← una sola escritura
```

- **`SolicitudAyudaService.recuperar`** (mensajero, «Recuperar») pasa a delegar aquí.
- **`HabilitarNovedadService.habilitar`** (tienda, «Habilitar») pasa a delegar aquí **después** de
  publicar su nota obligatoria, conservando su forma «dos efectos, una sola puerta». `habilitarNovedad`
  desaparece del repo.
- **Idempotencia**: la guarda de estado + el `updateMany` guardado hacen que un segundo rescate no
  encuentre nada y no escriba historial (R9). No hay código de idempotencia; la hay por construcción.
- **No se toca el bloqueo total del mensajero** (R25): ni solicitar ni rescatar comprueban
  `estaBloqueado`. Hoy tampoco lo hacen, y **añadirlo crearía un deadlock** con R22 — un mensajero
  con un cierre `vencido` y una orden en ayuda no podría ni rescatarla ni cerrar.

### 3.3 Fallo cerrado al resolver el catálogo

Los dos servicios resuelven el id del estatus destino con `findEstatusIdByValue`. **SI devuelve
`null`** (seed incompleto), la operación se **rechaza entera**, sin publicar nota y sin mover nada.
Mismo criterio que `MSG_CATALOGO` de `CierreDiaService` y que §3.3 de la 239: una escritura a medias
sobre el estado es peor que un error visible.

---

## 4. `novedadWhere`: el tapón de la 239 se retira aquí

Hoy (`OrdenRepository:2950-2982`):

```ts
OR: [
  { estatus: { value: ESTATUS_DEVUELTA } },
  { ayuda: true, estatus: { value: ESTATUS_EN_REPARTO } },   // ← el tapón
]
```

Después:

```ts
OR: [
  { estatus: { value: ESTATUS_DEVUELTA } },   // devolución ANCLADA (239)
  { estatus: { value: ESTATUS_AYUDA } },      // solicitud de ayuda viva
]
```

- **R32/R33 se cumplen por construcción**: las dos ramas son igualdades de estado. Una solicitud
  antigua no puede sostener la fila después de que la orden salga del estatus, porque **la solicitud
  ya no existe como dato separado del estado**. El comentario de la 239 lo anticipó: «la ficha 235
  RETIRA el booleano `ayuda`; cuando entre, esta rama entera sobra».
- **Se conserva la forma `OR` de dos igualdades y no se colapsa a
  `{ estatus: { value: { in: [...] } } }`.** Razón concreta, no estética: la guardia
  `hilo-ventana-alcanzable.guardia.test.ts` **lee este predicado del texto fuente** con el patrón
  `estatus\s*:\s*\{\s*value\s*:\s*([^,}]+?)\s*\}` y **revienta en rojo** si deja de casar. Un `in`
  la pondría roja sin que nada estuviera mal; el `OR` la deja leyendo dos valores, que es lo que ha
  de leer. (Y si un día se prefiere el `in`, se cambia la extracción **a la vez**, no se borra la
  comprobación.)
- **R31 (count y find comparten predicado)** no cambia: los dos siguen llamando a `novedadWhere`.

---

## 5. La ventana del hilo: de un valor por rol a una lista por rol

`lib/types/ventana-hilo-notas.ts` es hoy:

```ts
export const VENTANA_ESCRITURA = {
  adminTienda: "devuelta",
  mensajero: "en_reparto",
} as const satisfies Record<RolConHilo, OrderStatusValue>;

export function estaEnVentanaDeEscritura(rol, estatusValue, ayuda = false): boolean {
  if (estatusValue === VENTANA_ESCRITURA[rol]) return true;
  return rol === "adminTienda" && ayuda;          // ← la segunda puerta, por la bandera
}
```

Pasa a:

```ts
export const VENTANA_ESCRITURA = {
  adminTienda: ["devuelta", "⟨AYUDA⟩"],
  mensajero:   ["en_reparto", "⟨AYUDA⟩"],
} as const satisfies Record<RolConHilo, readonly OrderStatusValue[]>;

export function estaEnVentanaDeEscritura(rol, estatusValue): boolean {
  return (VENTANA_ESCRITURA[rol] as readonly string[]).includes(estatusValue);
}
```

**Los dos roles, y no uno (R34).** Si el mensajero no puede escribir, **la tienda le habla a un hilo
mudo**: le pregunta «¿el cliente está?» y no hay quien conteste. Es literalmente el fallo que la
guardia `hilo-ventana-alcanzable` existe para impedir (su cabecera cuenta cómo la primera vuelta del
spec de la 227 dio a los dos roles la misma ventana y salió un hilo unidireccional de hecho).

**Y aquí muere la deuda de R19 de la 239.** Esa ficha midió que
`estaEnVentanaDeEscritura("adminTienda", "devolucion_por_confirmar", true)` devuelve `true` — una
bandera vieja abriendo la ventana sobre el pre-estado de la devolución— y lo declaró **no bloqueante
con dueño: «la ficha 235 retira el booleano `ayuda` y con él esta puerta»**. Al desaparecer el tercer
parámetro, la puerta desaparece: la ventana vuelve a depender **solo** del estado (R36).

**El firmante del cambio de forma:** `estaEnVentanaDeEscritura` se llama desde cuatro sitios
(`OrdenNotaService:54/66/101`, `SolicitudAyudaService:108`). Los cuatro pierden el tercer argumento y
el typecheck los señala uno a uno.

---

## 6. El portal del mensajero: el corte sube al servidor (R18)

### 6.1 De dos estados y dos grupos, a tres y tres

`MisAsignacionesService.listarMisAsignaciones:150`:

```ts
this.repo.findMisAsignaciones(actor.usuarioId, [ORIGEN_RECOGER, ESTADO_EN_REPARTO, ESTADO_AYUDA])
```

y el bucle de reparto pasa de dos acumuladores (`porRecoger`, `porGestionar`) a **tres**
(`+ conAyuda`), por `estatusValue`. `ListarMisAsignacionesResult` gana `conAyuda: MiAsignacionDTO[]`.

**Esto ensancha deliberadamente el corte de la feature 167/R34**, que hoy la guardia congela con un
censo cerrado («ni uno más ni uno menos», `hilo-ventana-alcanzable.guardia.test.ts:377`). El censo
pasa a tres **con nota fechada**, y la propiedad que protegía se conserva: sigue siendo cerrado, y
`recolectando` **sigue fuera** —que es lo que la 167 aisló—. No es la 227 «ensanchando por la puerta
de atrás»: es el estado nuevo entrando por la puerta, con su requisito (R19) delante.

### 6.2 Lo que se cae solo al hacerlo

| Superficie | Antes | Después | R |
| --- | --- | --- | --- |
| `findParadasEnReparto` (optimizador) | traía las de ayuda | `estatus = en_reparto` ya no casa | R14 |
| `RutaMapa` / paradas sin optimizar | derivan de `porGestionar` | ya no están en `porGestionar` | R15 |
| `TrayectoVivoButton` (`porGestionar[0]`) | podía apuntar a una de ayuda | ídem | R15 |
| `escogerParaGestion` / `gestionar` | `cargarOrdenGestionable` exige `en_reparto` → **pasaba** | ahora devuelve `conflict` | R16 |
| Asignación / ruteo / recolección | listan por estados concretos, ninguno es `⟨AYUDA⟩` | quedan fuera solas | R17 |
| `RepartoModule` `useMemo` de cliente (`:253-262`, `:312`) | partía la lista | **se borra**: llega partida | R18 |

### 6.3 Lo que hay que decidir a mano porque **no** se cae solo

- **Los KPI del día (P7/R20).** `pendientes`, `porCobrar` y `totalACobrar` se derivan hoy de
  `porGestionar`. Al sacar las de ayuda de ese grupo, **bajarían**. Se corrigen calculándolos sobre
  `porGestionar ∪ conAyuda`. Los dos sumandos de `totalACobrar` **siguen siendo disjuntos** (R21): el
  segundo (`sumMontoCobrarGestionadas`) exige `gestiones: { some: … }` y una orden en `⟨AYUDA⟩` no
  tiene gestión, además de que su `where` excluye `en_reparto`.
- **El chat (P8).** `ChatFlotante ordenes={porGestionar}` pasa a recibir `[...porGestionar,
  ...conAyuda]`. Es una línea, y sin ella el mensajero pierde **la única entrada al chat** que queda
  en la app sobre un paquete que sigue llevando encima.
- **El botón del panel (`GestionarOrdenPanel:821/827`).** `orden.ayuda ? "Ayuda pedida" : "Ayuda"`
  deja de compilar. El panel ya solo se abre sobre órdenes `en_reparto`, así que el rótulo pasa a ser
  fijo («Ayuda») y el estado «pedida» lo cuenta la sección de abajo, que es donde el mensajero lo mira.
- **La superficie del hilo para el mensajero (R35).** Hoy el hilo del mensajero vive **dentro** de
  `GestionarOrdenPanel`, y ese panel es inalcanzable para una orden en `⟨AYUDA⟩` (§6.2). Sin nada más,
  el mensajero tendría la ventana abierta (§5) y **ningún sitio donde ejercerla**: el permiso
  inejercitable de siempre. La card de la sección «Con ayuda solicitada» gana una acción
  «Conversación» que monta **el componente compartido que ya existe**, `components/shared/HiloNotasOrden`,
  dentro de un `Modal` —el mismo montaje que `HiloNotasNovedadModal` hace del lado tienda—. No se
  escribe un hilo nuevo ni se promueve nada: `HiloNotasOrden` **ya** está en `components/shared/` y
  `listarNotasOrden` **ya** devuelve `puedeEscribir` calculado en el servidor, así que la ventana de
  §5 lo habilita sin que la UI re-derive nada.
- **La card de ayuda pierde «Gestionar»** (`RepartoModule.renderCardConAyuda:480-488`): llamaría a
  `escogerParaGestion`, que ahora devuelve `conflict`. Se sustituye por «Conversación»; «Recuperar»
  se queda donde está.
- **La sección de ayuda queda FUERA del buscador y del filtro cantón/distrito**, y se decide así
  **a mano el 2026-08-19**, a petición de la revisión (menor m2 de `progress/review_235.md`). Antes
  de esta ficha, `visualConAyuda` se derivaba de `porGestionarVisual`, es decir **después** del
  buscador (114), del filtro (117) y del reordenado (115); ahora `conAyuda` llega por props y se
  pinta crudo. Consecuencia visible: al buscar una guía que está en ayuda, arriba se lee «Ninguna
  guía en reparto coincide con la búsqueda» y **abajo siguen todas** las cards de ayuda, sin
  filtrar.
  **Se acepta, y por qué:** la sección de ayuda es ahora una **lista aparte y corta** —lo que el
  mensajero espera de la tienda, no lo que sale a repartir—, y los dos controles rotulan «en
  reparto». El modo de fallo es **mostrar de más, nunca esconder**: ninguna orden desaparece por
  filtrar. Reaplicar los tres pasos a la segunda lista es trabajo de la pantalla que la 236
  rediseña, no de esta ficha.
  **Lo que NO se acepta es que quede sin decidir**: es un cambio de conducta de dos features ya
  entregadas (114 y 117) que nadie pidió, y este repo acaba de pagar dos bloqueantes (B1, B2) por no
  distinguir «decidido» de «olvidado». Si al usarlo molesta, el arreglo es una línea: derivar
  `conAyuda` de la lista ya filtrada, igual que antes.

### 6.4 `/novedades`, lo mínimo para no romperla (la pestaña es de la 236)

`NovedadDTO extends MiAsignacionDTO`, así que pierde `ayuda` con él. Dos call-sites dejan de compilar
y se resuelven **al mínimo**, sin rediseñar la pantalla:

- `NovedadAcciones.tsx:116` `puedeHabilitar = esDevuelta || novedad.ayuda === true` →
  `… || novedad.estatusValue === "⟨AYUDA⟩"`. **Traducción literal, no arreglo.** Que hoy
  «Habilitar» aparezca justo en las cards que vienen de un cierre —el punto 12 del pedido, al revés—
  lo corrige la **240**; adelantarlo aquí sería tocar la card que la 236 está reescribiendo.
- `NovedadAcciones.tsx:176` y `NovedadesModule.tsx:140` → misma traducción por `estatusValue`.

---

## 7. El corte de la noche: **dos bloques guardados, no uno con dos orígenes**

`CierreDiaRepository.crearCierre:447-477` hace hoy: pre-SELECT de ids con `estatusId =
enRepartoEstatusId` → `updateMany` **guardado por ese mismo id** → `appendCambioEstado` con
`estatusOrigenId: enRepartoEstatusId` y el comentario «la guarda garantiza este origen».

**Ese comentario es la razón por la que no se puede meter `⟨AYUDA⟩` en un `in`.** Con dos orígenes
posibles en un solo `updateMany`, el append tendría que **inventarse** cuál era el origen de cada
fila, y escribiría un historial falso (R27). Así que el bloque se **duplica**:

```
si (corteSinGestionar):
  para cada (origenId) en [enRepartoEstatusId, ayudaEstatusId]:
     ids = findMany({ mensajeroAsignadoId, estatusId: origenId, deletedAt: null })
     if (ids.length === 0) continue                       ← no-op, sin escrituras
     movidas = updateMany({ where: { id in ids, estatusId: origenId },   ← la guarda
                            data: { estatusId: sinGestionarId } })
     if (movidas.count > 0) appendCambioEstado(… estatusOrigenId: origenId,
                                                 origenTipo: 'corte_sin_gestionar',
                                                 actorUsuarioId: null …)
     sinGestionarTransicionadas += movidas.count
```

- `CorteSinGestionarInput` gana `ayudaEstatusId` **obligatorio** (no opcional). Un olvido de cableado
  tiene que romper el **typecheck**, no dejar órdenes en ayuda sin barrer para siempre. Mismo
  criterio y mismo precedente que §3.3 de la 239 con `anclajeDevolucion`.
- **Money-neutral (R28):** el `data` toca **solo** `estatusId`. Ni `prioridad`, ni
  `mensajeroAsignadoId`, ni totales. Igual que hoy.
- **La guarda «algo pasó»** (`vinculadas.count === 0 && sinGestionarTransicionadas === 0` →
  rollback) sigue igual: `sinGestionarTransicionadas` ahora acumula los dos bloques, así que un
  mensajero cuyo día entero acabó en ayuda **sí** genera su cierre `vencido`, que es lo que R26 pide.
- **R29 se cumple por construcción:** después del barrido la orden está en `sin_gestionar` y no queda
  ninguna marca de ayuda porque no existe ninguna marca. Es exactamente la fuga de la auditoría §2.1,
  cerrada por el mismo mecanismo que la creó.

---

## 8. El bloqueo del cierre, y las dos rutas exentas

`CierreDiaService.ts:47`:

```ts
const ESTADOS_PENDIENTES = ["por_recoger", "en_reparto", "⟨AYUDA⟩"];   // R22/R23
```

Eso es **todo el cambio funcional**, y ese es el punto: el bloqueo pasa de accidental a **escrito**.
Lo consumen los dos sitios que ya lo consumen (`listarCierreDia:183` para el gate de la pantalla y
`solicitarCierre:438` para la precondición), con su mensaje accionable ya existente.

**Las dos rutas exentas siguen exentas, y hay que decirlo en voz alta (R24).**
`vencido → solicitado` (`solicitarCierre:416-422`) y `rechazado → solicitado` (`:429-434`) **no**
comprueban pendientes, y no por descuido: están marcadas «EXENTO de la precondición, anti-deadlock»
porque el mensajero ya está bloqueado para gestionar y quedaría atrapado. Con `⟨AYUDA⟩` en la lista,
esas dos rutas se comportan **exactamente igual que con `en_reparto`**: una orden en ayuda no las
bloquea, igual que hoy no las bloquea una orden en reparto.

**Consecuencia para la ficha 237, declarada aquí para que no la descubra ella:** la invariante que su
`status_note` enuncia —«una orden en ayuda BLOQUEA la solicitud de cierre, así que la gestión de la
tienda cae antes del snapshot»— es cierta **para la creación de un cierre nuevo** y **falsa para las
dos rutas de re-solicitud**. En esas dos, el cierre ya existe con sus gestiones ya vinculadas, así que
una gestión de la tienda posterior nace con `cierre_id = NULL` y **cae en el cierre siguiente**. No
rompe dinero —cae en un cierre, solo que en otro— pero la 237 tiene que probarlo, no suponerlo.

Se añade un test que **afirma la exención** para que nadie la «arregle»: quitarla reabre el deadlock
que la 111/R9 cerró.

---

## 9. Datos en vuelo (P6) y despliegue

**No hay migración de datos, y es una decisión (R41).** El plan es medir y decidir:

1. **T0.1 — medir** contra la base donde vaya a desplegarse: `SELECT count(*) FROM orden WHERE ayuda
   = true` desglosado por `order_status.value`. Dato de contexto: `prod` (448d5169) **no lleva el
   merge #396**, así que la columna probablemente **no existe** allí y el conjunto es vacío. **Hay
   que comprobarlo, no citarlo.**
2. **Conjunto vacío** → se retira la columna y no hace falta nada más.
3. **Conjunto no vacío** → `scripts/migrar-ayuda-a-estatus.ts`, de una sola vez, idempotente,
   **por el choke point**:
   - `ayuda = true` **y** `estatus = en_reparto` → transición `en_reparto → ⟨AYUDA⟩` con
     `origen_tipo = solicitud_ayuda_tienda` y `actor = null` (sistema).
   - `ayuda = true` **y** cualquier otro estatus → **nada**. Son la fuga de la auditoría §2.1
     (órdenes que el corte barrió a `sin_gestionar`, o que llegaron a bodega, o entregadas, con el
     flag encendido); el tapón de la 239 ya las tiene fuera de `/novedades` y moverlas a un estado de
     ayuda sería resucitar una solicitud que nadie mantiene viva. La marca se pierde con la columna.
   - El script corre **antes** de la migración que retira la columna.

**Orden de despliegue.** Hay un punto intermedio seguro y conviene aprovecharlo: todo el trabajo va
en **un solo PR** de todas formas (§10-D), pero dentro del PR el orden de los commits importa —
catálogo y enum primero, código después, retirada de la columna al final—, porque si la columna
desaparece antes de que el estatus exista, `/novedades` se queda sin la rama de ayuda.

---

## 10. Contratos I/O

**Rutas nuevas: ninguna.** Ni endpoint, ni página. Las tres Server Actions existentes
(`solicitarAyudaOrden`, `recuperarOrdenAyuda`, `registrarIntentoContactoOrden`, `lib/actions/orden-ayuda.ts`)
**conservan su firma y su forma de resultado**: siguen recibiendo `{ ordenId, motivo }` / `{ ordenId }`
y devolviendo el mismo resultado discriminado (`ok` / `validation_error` / `forbidden` /
`unauthenticated`). Que la UI no cambie de contrato es deliberado: la superficie que ya existe y
funciona no se reescribe (auditoría §4).

Cambian **cinco** contratos internos:

```ts
// lib/interfaces/services/IMisAsignacionesService.ts
interface ListarMisAsignacionesDTO {
  porRecoger: MiAsignacionDTO[];
  porGestionar: MiAsignacionDTO[];
  conAyuda: MiAsignacionDTO[];          // ← nuevo (R18/R19)
}
interface MiAsignacionDTO { /* … */ }   // ← `ayuda?: boolean` RETIRADO (R40)
```

```ts
// lib/types/ventana-hilo-notas.ts
export const VENTANA_ESCRITURA: Record<RolConHilo, readonly OrderStatusValue[]>;   // era un value
export function estaEnVentanaDeEscritura(rol: RolConHilo, estatusValue: string): boolean; // sin 3.º
```

```ts
// lib/interfaces/repositories/ICierreDiaRepository.ts
interface CorteSinGestionarInput {
  enRepartoEstatusId: string;
  ayudaEstatusId: string;        // ← OBLIGATORIO (§7): un olvido rompe el typecheck
  sinGestionarEstatusId: string;
}
```

```ts
// lib/interfaces/services/ISolicitudAyudaService.ts  +  IHabilitarNovedadService
//   `recuperar` y `habilitar` delegan en el punto único de rescate (§3.2). Firmas sin cambio.
// lib/interfaces/repositories/IOrdenRepository.ts
//   RETIRADOS: marcarAyuda, desmarcarAyuda, habilitarNovedad.
//   ALTA: transicionarAyuda(...) — una escritura guardada por estado, usada por los dos sentidos.
```

**Integraciones externas:** ninguna nueva. Webhooks: §11. Rastreo público: §11.

---

## 11. Superficies de estatus: las que rompen el build y las que no

**Rompen el build al añadir el value** —no hay que buscarlas, el compilador las señala:

1. `lib/types/order-status-transiciones.ts` — `TRANSICIONES` + `_EnsureExhaustive` (§2).
2. `app/(app)/ordenes/_components/EstatusBadge.tsx` — `ORDER_STATUS_LABELS` y `ORDER_STATUS_VARIANT`
   (P1: «Ayuda solicitada a la tienda», `warning`).
3. `lib/types/rastreo-publico.ts` — `HITO_POR_ESTATUS` es `satisfies Record<OrderStatusValue, …>`.

**NO rompen el build. Es la lista de olvidos probables, y cada una tiene consecuencia concreta:**

| Archivo | Si se olvida | Decisión |
| --- | --- | --- |
| `app/(app)/ordenes/exclude-por-rol.ts` | Un estado no listado **auto-aparece** como opción de filtro del rol | `⟨AYUDA⟩` **NO** se excluye para nadie. El `adminTienda` **sí** debe verlo: es su pantalla de trabajo (a diferencia de `devuelta`/`devolucion_por_confirmar`, que sí se le excluyen porque son estados que no opera). Maestro/admin solo excluyen `pendiente`. |
| `lib/types/webhook-eventos.ts` | Contrato con integradores | `⟨AYUDA⟩` **NO** entra en `EVENTOS_PUBLICOS` (P4). **Efecto colateral firmado:** el rescate emite `en_reparto` **otra vez**, porque ese value sí está en la política. No es un fallo: la clave de idempotencia lleva el instante **precisamente** para admitir el reingreso a un mismo estado, y ya ocurre con `reprogramada` liberada por el cron. |
| `lib/utils/estados-bodega-satelite.ts` | El satélite vería o dejaría de ver algo | `⟨AYUDA⟩` **NO** entra: el paquete está en la moto, no en su estante. Mismo criterio que la 239 aplicó al pre-estado de la devolución. |
| `lib/types/tablero-dia.ts` | El mapa es parcial con default `otros`: **absorbe el value nuevo sin quejarse** | `⟨AYUDA⟩` **NO** entra en `BUCKET_POR_ESTATUS` → cae en `otros`. Los buckets `sinRecoger`/`enReparto` describen el avance normal del día; una orden detenida esperando a la tienda no es ninguno de los dos. |

**Y las que se ponen rojas aunque el value esté bien clasificado** (inventarios congelados; se
actualizan **con nota fechada**, nunca se borran): `buckets-estatus.guardia.test.ts`
(`CATALOGO_CONGELADO`, 21 → 22), `order-status.test.ts`, `analytics/definiciones-catalogo.guardia.test.ts`,
`rastreo-hitos-exhaustivo.guardia.test.ts`, `rastreo-sin-estatus-crudo.guardia.test.ts`,
`scripts/seed-order-status.test.ts`, `order-status-v2-migration.test.ts`,
`order-status-transiciones.connectividad.test.ts`, `EstatusBadgeCatalogoV2.test.tsx`,
`inventario-transiciones-140.ts`.

---

## 12. Alternativas descartadas

### A · Dejar la bandera y filtrarla en cada superficie *(la más barata — y es el fallo, otra vez)*

Sería añadir `ayuda: false` al `where` de `findParadasEnReparto`, al de `findMisAsignaciones`, a la
guarda de `cargarOrdenGestionable`, al corte nocturno y a `ESTADOS_PENDIENTES`. Cinco sitios, cinco
diffs pequeños, cero migraciones.

**Descartada porque es exactamente el diseño que produjo el fallo que esta ficha viene a cerrar.**
El problema no es que falten cinco filtros: es que **nada obliga al sexto**. La auditoría documenta
que de los **7 caminos de salida de `devuelta`** solo 2 apagaban `gestion_aprobada` —la otra columna
del mismo merge, con el mismo diseño— y que la fuga permanente de `/novedades` nació justo de una
rama que no acotó estatus. Una marca persistida tiene tantos sitios de limpieza como transiciones
tenga el estado que acompaña, y **ninguno de ellos rompe el build cuando se olvida**. Con el estatus,
`satisfies Record<OrderStatusValue, …>` no deja compilar hasta que alguien decida el caso nuevo.

Coste añadido: la separación en el portal seguiría siendo de cliente (R18 insatisfecho), y el bloqueo
del cierre seguiría siendo accidental (R22/R23 insatisfechos por definición).

### B · Un estado derivado en la consulta, sin value en el catálogo

Que `⟨AYUDA⟩` no exista como estado y que las pantallas lo deriven de `en_reparto` + una tabla
auxiliar `solicitud_ayuda` con su fila viva.

**Descartada por dos razones independientes.** (i) Es la misma marca persistida de A con una tabla
alrededor: el ciclo de vida de esa fila hay que apagarlo en cada salida de `en_reparto`, incluido el
corte nocturno, y su dirección de fallo es la de hoy —una solicitud viva sobre una orden que ya no
está en reparto—. (ii) La guardia de transiciones **no vería nada**: la orden nunca cambiaría de
estado, así que el mecanismo que hace que esta ficha valga la pena no se activaría ni una vez.
Ventaja real que se pierde a cambio: el historial de solicitudes por orden. Se conserva de todas
formas, porque **el hilo de notas ya lo es** y porque la transición queda en `orden_historial_estado`.

### C · Retirar la columna `ayuda` en una ficha aparte, después de la 235

Dejar el estatus y la columna conviviendo un tiempo, para acortar esta ficha.

**Descartada porque convivir ES el fallo.** Dos verdades sobre el mismo hecho —una marca y un
estado— pueden divergir en cuanto una transición se olvide de una de las dos, y el resultado sería
una orden en `⟨AYUDA⟩` con `ayuda = false` o al revés, con dos pantallas contando cosas distintas. Y
hay dos deudas **con dueño y con nombre** que solo mueren con la columna: el tapón de `novedadWhere`
y la reconciliación de R19, las dos escritas en `specs/239/` y en el código diciendo literalmente
«las dos mueren con la ficha 235». Aplazarlas es dejar por escrito una promesa incumplida en el repo.

### D · Feature flag para desplegar por mitades

**Descartada: no hay punto de despliegue intermedio seguro.** Si el estatus sale sin los consumidores,
una orden que pida ayuda cae de `/novedades` y del portal del mensajero a la vez —invisible para los
dos lados— con el árbol verde. Y si salen los consumidores sin el estatus, no hay nada que consumir.
El flag además no ayuda: el estado de las órdenes en vuelo depende de qué mitad estaba activa cuando
se pidió la ayuda, y apagarlo no las devuelve. Mismo razonamiento, palabra por palabra, que §10-D de
la 239. **Todo va en un solo PR.**

### E · Que la gestión de la tienda desde ayuda entre en esta ficha

Adelantar `gestionarDesdeAyuda` para que `⟨AYUDA⟩` tenga sus salidas de desenlace desde el día uno.

**Descartada: es la ficha 237 y toca dinero.** Esa gestión escribe una fila de `gestion_orden` con
`mensajero_id` del mensajero y `cierre_id = NULL`, entra al cierre de otro y cuenta como intento.
Mezclarla aquí convertiría una ficha de estados en una ficha de dinero, y la nota de §8 sobre las dos
rutas exentas dejaría de ser una advertencia para la 237 para ser un bug de la 235.

---

## 13. Rojos esperados, y rojos que son regresión

**Rojos POR DISEÑO** (se actualizan con nota fechada):

- Inventarios congelados del catálogo (§11): 21 → 22 values.
- `tests/fixtures/inventario-transiciones-140.ts` y la suite de transiciones: **+3, −0**.
- `hilo-ventana-alcanzable.guardia.test.ts`: (a) el caso que afirma `ayuda\s*:\s*true` en
  `novedadWhere` — **la bandera desaparece, es su trabajo ponerse roja**; (b) el censo cerrado del
  panel del mensajero, 2 → 3; (c) la intersección, que pasa de comparar un valor a intersecar dos
  listas. Los tres se actualizan **conservando la propiedad**: censo cerrado, extracción que revienta
  si no encuentra, e intersección no vacía por rol.
- `tests/components/RepartoAyuda.test.tsx` y `NovedadesModule.test.tsx`: el corte deja de ser de
  cliente.
- `tests/unit/services/solicitud-ayuda-service.test.ts`: el efecto pasa de `marcarAyuda` a la
  transición.
- `orden-repository.novedades.test.ts`: el predicado pasa a dos igualdades de estado.

**Rojos que son REGRESIÓN** (si aparecen, el cambio aterrizó mal — se arregla el código, no el test):

- Las guardias del criterio de intento (`intentos-entrega-criterio-unico`,
  `criterio-intento-entrega`): las dos familias nuevas **no** son visita real (R11). Un rojo ahí
  significa que alguien las metió en `ORIGEN_TIPOS_VISITA_REAL` y el escalado del cron se adelantó.
- Las guardias **money-safe** y la frontera de `orden_nota`.
- Los feeds de dinero de `resolverCierre` y `cierres-admin-caja-cod.test.ts`: esta feature **no toca**
  esa transacción. Cualquier rojo ahí es contaminación.
- `cierre-dia-service.test.ts` en los casos de `vencido → solicitado` / `rechazado → solicitado`: si
  se ponen rojos, alguien «arregló» la exención y reabrió el deadlock de la 111/R9 (§8).

---

## 14. Riesgos

1. **El punto de escritura único del rescate lo comparten dos servicios con puertas distintas** (la
   ventana del mensajero y la de la tienda). El riesgo es que alguien mueva la guarda de estado del
   punto único a uno de los dos llamadores y el otro se quede sin ella. Se cubre con un test que
   ataca el punto único directamente con una orden fuera de `⟨AYUDA⟩`.
2. **La ficha 237 hereda una invariante más débil de lo que su nota supone** (§8, dos rutas exentas).
   Está escrito aquí y hay que llevarlo a su spec.
3. **Repetición del evento `en_reparto` a integradores** (§11/P4). Precedentado y admitido por la
   clave de idempotencia, pero es observable.
4. **La medición de P6 caduca.** `prod` se mueve, y `dev` también. Re-medir el día del despliegue.
5. **El pre-vuelo caduca:** comparar el SHA medido contra `origin/dev` antes de abrir el PR (otra
   sesión puede haber empujado).

---

## 15. Documentación que esta feature deja al día

- `progress/auditoria_ayuda_tienda.md` §2 y §4 → anotar con fecha qué puntos quedan cerrados por esta
  ficha (la fuga de §2.1 por construcción; de los 9 «no están», los que caen aquí).
- `specs/239-devolucion-espera-cierre/requirements.md` → la sección «RECONCILIACIÓN DE R19» y el
  «tapón con dueño» pasan a **CERRADOS con fecha**: su dueño era esta ficha.
- El JSDoc de `ventana-hilo-notas.ts:58-74` («SEGUNDA PUERTA, SOLO PARA `adminTienda`») describe una
  puerta que deja de existir: se **reescribe**, no se deja como folclore.
- El JSDoc de `HiloNotasNovedadModal.tsx:45-53` (`@sin-superficie`) sigue vigente hasta la 236; no se
  toca aquí, pero se comprueba que su afirmación siga siendo cierta.
