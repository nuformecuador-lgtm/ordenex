# Feature 221 — Hilo de notas por orden entre tienda y mensajero · design.md

> El QUÉ está en `requirements.md`. Aquí van las decisiones técnicas: modelo de datos, migraciones,
> RLS, capas, contratos de entrada/salida, puntos de montaje en la UI, y las alternativas
> descartadas con su motivo.
>
> **Spec CERRADO (2026-08-14, tercera vuelta).** No quedan preguntas abiertas ni piezas
> condicionadas. Las tres decisiones de cierre: **ventana de escritura asimétrica por rol** (D1),
> **la notificación sale íntegra a la ficha N2** (D2, §8) y **sin indicador en las cards** (D3, §5).

---

## 1. Modelo de datos

### 1.1 Tabla nueva `orden_nota`

Prisma (`db/schema.prisma`), modelo `OrdenNota`, `@@map("orden_nota")`:

| Columna | Tipo | Notas |
| --- | --- | --- |
| `id` | `String @id @default(uuid())` | patrón del repo (uuid en TEXT) |
| `orden_id` | `String` | FK -> `orden(id)`, `ON DELETE CASCADE` (R30) |
| `autor_id` | `String` | FK -> `usuario(id)`, `ON DELETE RESTRICT`: la autoría es evidencia y no se pierde al dar de baja un usuario |
| `rol_autor` | `RolValue` (enum nativo ya existente) | congelado en el instante de publicar (R4) |
| `cuerpo` | `String` (`text`) | NOT NULL; recorte y tope de 200 en el borde (R6/R7) |
| `created_at` | `DateTime @default(now())` | orden cronológico del hilo (R3) |
| `deleted_at` | `DateTime?` | borrado LÓGICO (R31); `NULL` = vigente |

Índices:
- `@@index([ordenId, createdAt])` — lectura del hilo ordenada en una sola consulta (R3/R28). Copia
  la FORMA del índice de `ChatMensaje` (`@@index([conversacionId, ocurridoAt])`,
  `db/schema.prisma:291`), que resuelve el mismo problema.
- `@@index([autorId])` — segunda FK indexada (patrón `orden_mensajero_meta`).

Sin `updated_at`: el cuerpo no se edita (R2). Lo único que muta en una fila es `deleted_at`, una vez
y en un solo sentido.

**Por qué `deleted_at` y no `DELETE`** (P3a): la fila borrada sigue probando que ALGUIEN escribió
algo y cuándo, que es la mitad del valor del hilo en una disputa tienda↔mensajero. El coste conocido
es que toda lectura debe filtrar; se controla en §2.1 (un único método de lectura, más la guardia de
§7).

**Por qué el cuerpo NO se borra de la fila:** con `deleted_at` el texto sigue en la base pero deja de
servirse (R34). Si más adelante se decide que un borrado debe destruir el texto (p. ej. alguien
escribió un dato sensible), se resuelve con un `UPDATE` que vacíe `cuerpo` en el mismo borrado; hoy
no se pidió y no se hace.

**Por qué `rol_autor` es una columna y no un JOIN a `usuario.rol`:** R4. El rol de un usuario puede
cambiar; el hilo debe decir con qué sombrero se escribió cada nota.

**Por qué NO hay tabla "conversación":** a diferencia de `ChatConversacion` (que existe porque el
hilo se identifica por orden **+ número de teléfono** y necesita `ultimoEntranteAt` para la ventana
de 24 h de Meta), aquí el hilo se identifica por la ORDEN y nada más. Una tabla contenedora sin
estado propio sería una fila vacía por orden y un JOIN extra en toda lectura.

### 1.2 RLS

`ALTER TABLE "orden_nota" ENABLE ROW LEVEL SECURITY;` **sin policies** (solo service role). La
autorización de negocio (rol, pertenencia a la tienda, asignación del mensajero, ventana de
escritura) vive en el service (R26). Patrón literal de
`db/migrations/20260723120000_orden_mensajero_meta/migration.sql:28-30`.

### 1.3 Migraciones

Dos migraciones separadas, en este orden. Separadas a propósito: la primera es aditiva y segura, la
segunda es DESTRUCTIVA y su `down.sql` no puede devolver el dato.

**M1 — `<ts>_orden_nota` (aditiva)**
- `CREATE TABLE "orden_nota"` con las columnas de §1.1, PK y las dos FK (cascade a `orden`, restrict
  a `usuario`).
- `CREATE INDEX "orden_nota_orden_id_created_at_idx" ON "orden_nota"("orden_id","created_at");`
- `CREATE INDEX "orden_nota_autor_id_idx" ON "orden_nota"("autor_id");`
- `ALTER TABLE "orden_nota" ENABLE ROW LEVEL SECURITY;`
- `down.sql`: `DROP TABLE IF EXISTS "orden_nota";` (arrastra PK, índices, FKs y RLS — mismo texto y
  mismo razonamiento que el `down.sql` de `orden_mensajero_meta`).

**M2 — `<ts>_orden_mensajero_meta_drop_nota` (DESTRUCTIVA)**
- `ALTER TABLE "orden_mensajero_meta" DROP COLUMN "nota";`
- `down.sql`: `ALTER TABLE "orden_mensajero_meta" ADD COLUMN "nota" TEXT;` — repone la ESTRUCTURA
  (columna nullable), **no el contenido**.
- Cabecera obligatoria de la migración, en mayúsculas: el contenido se pierde de forma **definitiva
  y deliberada** por decisión humana del 2026-08-14 (P1), y el conteo real de filas afectadas
  medido contra producción (T0.1) va citado ahí mismo (R23).
- NO toca `marcar_luego`, ni el índice único `(usuario_id, orden_id)`, ni las FKs, ni la RLS (R24).

Ninguna migración de esta feature lee ni copia `orden_mensajero_meta.nota` hacia `orden_nota` (R22).

---

## 2. Capas y archivos

```
app/(app)/novedades/_components/…                      ← montaje lado TIENDA
app/(app)/mis-asignaciones/_components/…               ← montaje lado MENSAJERO (panel existente)
   ↓ Server Action
lib/actions/orden-notas.ts                             ← 'use server': actor + zod + withErrorHandler
   ↓ interfaz
lib/services/OrdenNotaService.ts                       ← autorización y reglas del hilo
   ↓ interfaz
lib/repositories/OrdenNotaRepository.ts                ← solo Prisma
lib/interfaces/services/IOrdenNotaService.ts
lib/interfaces/repositories/IOrdenNotaRepository.ts
lib/types/orden-nota.ts                                ← schemas zod + resultados discriminados
components/shared/HiloNotasOrden.tsx                   ← UI del hilo (dos consumidores, §5)
```

Nada de rutas `app/api/`: son mutaciones internas del propio proyecto y `docs/architecture.md`
manda Server Action.

### 2.1 Repositorio (`OrdenNotaRepository`)

Sin lógica de negocio ni permisos. Métodos:

- `listarPorOrden(ordenId): Promise<OrdenNotaRow[]>` — **una sola consulta** (R28), con
  `orderBy: [{ createdAt: "asc" }, { id: "asc" }]` (desempate determinista, R3). **NO filtra por
  `deleted_at`**: trae también las borradas, porque R34 exige pintar el hueco marcado. El `select`
  resuelve el nombre del autor por JOIN (`autor: { select: { nombre: true } }`); **el `cuerpo` de
  una fila borrada lo descarta el SERVICE**, no el cliente (§2.2).
- `crear({ ordenId, autorId, rolAutor, cuerpo }): Promise<OrdenNotaRow>` — un solo `create`.
- `marcarBorrada(notaId, autorId): Promise<number>` — `updateMany` con
  `where: { id: notaId, autorId, deletedAt: null }` → `deletedAt: new Date()`. **El `autorId` va en
  el `where`, no en un `if` previo**: la propiedad se comprueba en el mismo statement que muta, sin
  ventana entre chequeo y efecto (R32). Devuelve el `count` para que el service distinga 0 (ajena /
  inexistente / ya borrada → R33) de 1.
- `findOrdenParaHilo(ordenId): Promise<{ tiendaId; mensajeroAsignadoId; estatusValue; deletedAt } | null>`
  — la lectura mínima para autorizar (pertenencia, asignación y ventana).

### 2.2 Service (`OrdenNotaService`)

Recibe el repo por constructor (DI por interfaz; testeable sin DB ni HTTP). Orden de comprobaciones,
idéntico en `listar`, `publicar` y `borrar`:

1. `actor.rol ∈ { adminTienda, mensajero }` — si no, `forbidden` (R12). Precedente:
   `NovedadesService.ROL_AUTORIZADO`.
2. Cargar la orden (`findOrdenParaHilo`). Inexistente o borrada lógicamente → `forbidden` (mismo
   resultado que "ajena", R10: no se filtra existencia).
3. Pertenencia:
   - `adminTienda`: `orden.tiendaId === actor.usuarioId` (R9). Es el mecanismo YA vigente:
     `NovedadesService` pasa `actor.usuarioId` como `tiendaId` y `orden.tiendaId` es FK a `usuario`
     (`db/schema.prisma:488`).
   - `mensajero`: `orden.mensajeroAsignadoId === actor.usuarioId` (R11, decisión P5). Única fuente
     de verdad del mensajero desde la feature 159.
4. **Ventana ASIMÉTRICA POR ROL** (solo `publicar` y `borrar`, R14/R35/D1):

   ```ts
   const VENTANA_ESCRITURA = {
     adminTienda: "devuelta",   // lo que /novedades lista
     mensajero:   "en_reparto", // uno de los dos estatus que su panel lee (167/R34)
   } as const satisfies Record<"adminTienda" | "mensajero", OrderStatusValue>;

   const puedeEscribir = orden.estatusValue === VENTANA_ESCRITURA[actor.rol];
   ```

   Una sola tabla, un solo punto de decisión, y el `satisfies` obliga a que ambos valores existan en
   el catálogo. `listar` NO aplica ventana (R15: la novedad acota la escritura, no la lectura).

   **Por qué asimétrica y no un único estatus** (D1): cada rol solo puede escribir donde la orden se
   le aparece. `/novedades` lista exactamente `devuelta` (`novedadWhere`) y el panel del mensajero
   lee exactamente `por_recoger` y `en_reparto` (`MisAsignacionesService.ts:152`), un corte que esta
   feature NO toca (R36). Con una ventana única en `devuelta`, el mensajero **jamás** habría tenido
   delante una orden en la que pudiera publicar: el permiso existía y era inejercitable, y el hilo
   «bidireccional» habría salido de una sola dirección. La guardia de R38 (§7) impide que esa
   contradicción vuelva a colarse si alguien mueve una ventana o un corte de pantalla.

   Nota deliberada: `por_recoger` NO abre ventana. La orden aún no salió a reparto y la conversación
   de una novedad no empieza ahí; si el negocio lo pide, es cambiar un valor de la tabla y su test.
5. Ejecutar y proyectar. `autorId` y `rolAutor` salen SIEMPRE del actor (R5), nunca del input.

**Proyección de las borradas (R34), y por qué vive en el service:** al mapear a DTO, una fila con
`deletedAt !== null` viaja como `{ eliminada: true, cuerpo: "" }` conservando `autorNombre`,
`rolAutor` y `createdAt`. El cuerpo **no cruza el borde**: si se enviara y la UI lo ocultara, un
`view-source` bastaría para leerlo. Es el único punto del código que puede equivocarse y exponer
texto borrado, por eso está aislado en una función pura testeable y cubierto por guardia (§7).

**Constantes de la ventana:** ni `"devuelta"` ni `"en_reparto"` se escriben a mano aquí. Se
reutilizan las que ya existen (`ESTATUS_DEVUELTA` de `OrdenRepository.novedadWhere`;
`ESTADO_EN_REPARTO` de `MisAsignacionesService`), promovidas a un módulo compartido si hace falta.
Dos literales iguales en dos archivos es cómo nacen dos definiciones de "novedad" que divergen.

### 2.3 Server Actions (`lib/actions/orden-notas.ts`)

Patrón copiado de `lib/actions/notas-privadas-mensajero.ts` (que se borra, pero su forma es la
buena): `resolveActorFromSession()` → `UnauthenticatedError` si `null` (R13, ANTES del service) →
`schema.parse(input)` (zod, R27) → `service.<op>(…)`, todo dentro de `withErrorHandler`, con un
traductor `toOrdenNotaActionError(shape)` que mapea `VALIDATION_ERROR` → `validation_error` y
`UNAUTHORIZED` → `unauthenticated`, y lanza ante cualquier código inesperado (no lo traga).

`forbidden` NO es excepción: es resultado de dominio devuelto por el service.

---

## 3. Contratos de entrada/salida

`lib/types/orden-nota.ts` (zod en el borde + uniones discriminadas por `status`):

```ts
export const CUERPO_MAX = 200;                                   // R7 (decisión P5)

publicarNotaSchema = { ordenId: uuid, cuerpo: string().max(CUERPO_MAX) }
listarNotasSchema  = { ordenId: uuid }
borrarNotaSchema   = { notaId: uuid }
```

El tope se mide sobre el texto CRUDO (pre-recorte), como en la 116; el recorte y el rechazo del
cuerpo vacío ocurren en el service (R6).

DTO serializable (cruza el borde RSC: strings, sin `Date` ni `Prisma.Decimal`):

```ts
interface OrdenNotaDTO {
  id: string;
  cuerpo: string;         // "" cuando `eliminada` (R34: el texto borrado NO cruza el borde)
  autorNombre: string;
  rolAutor: RolValue;     // congelado (R4)
  createdAt: string;      // ISO-8601
  esPropia: boolean;      // lo calcula el SERVICE con el actor; la UI no compara ids (R16)
  eliminada: boolean;     // R34
}
```

Resultados:

```ts
ListarNotasResult  = { ok, notas: OrdenNotaDTO[], puedeEscribir: boolean }
                   | validation_error | forbidden | unauthenticated
PublicarNotaResult = { ok, nota: OrdenNotaDTO } | validation_error | forbidden | unauthenticated
BorrarNotaResult   = { ok }                     | validation_error | forbidden | unauthenticated
```

`puedeEscribir` = el actor está DENTRO de su ventana (§2.2), no «la orden está en `devuelta`»: el
mismo hilo, en el mismo estatus, es escribible para un rol y de solo lectura para el otro. Viaja en
la LECTURA porque la UI necesita decidir si pinta compositor y botones de borrar (R19), y no debe
re-derivar la regla en el cliente ni adivinarla desde el estatus.

`forbidden` cubre a la vez rol no autorizado, orden ajena, orden inexistente y ventana cerrada
(R10/R14/R33/R35): un solo resultado opaco, para no convertir el borde en un oráculo de existencia.
El detalle accionable lo pone la UI según el contexto en el que montó el hilo (R18).

`esPropia` lo calcula el service porque es la única capa que conoce al actor, y así el DTO no publica
`autorId` hacia el cliente.

---

## 4. Retiro de la feature 116 (inventario cerrado)

Se borran (R20/R21), medidos uno por uno:

| Qué | Dónde |
| --- | --- |
| Service | `lib/services/NotaPrivadaMensajeroService.ts` |
| Server Actions | `lib/actions/notas-privadas-mensajero.ts` |
| Tipos + zod | `lib/types/nota-privada-mensajero.ts` |
| Interfaz | `lib/interfaces/services/INotaPrivadaMensajeroService.ts` |
| Componente | `app/(app)/mis-asignaciones/_components/NotaPrivadaMensajero.tsx` |
| Su montaje | `GestionarOrdenPanel.tsx:729-739` |
| Campo del DTO | `lib/interfaces/services/IMisAsignacionesService.ts:66` (`notaPrivada?`) |
| Emisión del campo | `lib/services/MisAsignacionesService.ts:144-161,183,557-559` |
| Métodos del repo | `OrdenMensajeroMetaRepository.upsertNota` / `limpiarNota` / `findNotasByMensajero` (+ `IOrdenMensajeroMetaRepository.ts:30,38,46`) |
| Badges y preview | `pos-card/PosOrderCard.tsx:203-212`, `PosOrderCardMosaico.tsx:189-198`, `PosOrderCardDetalle.tsx:117-122,143-147` |
| Tests propios | `tests/components/NotaPrivadaMensajero.test.tsx`, `tests/unit/services/nota-privada-mensajero-service.test.ts`, `tests/unit/actions/notas-privadas-mensajero-action.test.ts`, `tests/unit/services/mis-asignaciones-nota-privada.test.ts`, `tests/integration/repositories/nota-privada-mensajero-repo.int.test.ts` |
| Tests que la MENCIONAN de refilón (limpiar la referencia, no borrar el archivo) | `tests/components/RepartoModule.test.tsx`, `MarcarLuegoToggle.test.tsx`, `GestionarOrdenPanelIncidente.test.tsx`, `GestionarOrdenPanelEvidencias.test.tsx`, `RecoleccionModule.test.tsx`, `RecoleccionPage.test.tsx`, `tests/unit/services/mis-asignaciones-orden-ruta.test.ts`, `mis-asignaciones-causa-devolucion.test.ts`, `recoleccion-tienda-service.test.ts`, `tests/integration/actions/recoleccion-tienda-action.test.ts` |
| Columna | `orden_mensajero_meta.nota` (M2) + su declaración en `db/schema.prisma:627` y el comentario del modelo (`:616-621`) |
| Spec | `specs/116-notas-privadas-mensajero/` se conserva como registro histórico con un aviso de "RETIRADA por la 221" |

**Lo que NO se toca:** `marcar_luego` y todos sus métodos/tests (feature 115, R24), `orden.notas`
(R25), y las tres pos-card en todo lo que no sea el badge de nota privada.

**Reescritura obligatoria de un comentario:** `lib/types/novedad.ts:32-33` documenta que
`notaPrivada` no viaja al DTO de novedades «porque el actor aquí es el adminTienda; no tiene ninguna,
y un `false`/`null` fijo sería inventarlas». Ese razonamiento **muere con esta feature**: el
adminTienda pasa a tener contenido propio sobre la orden. Se reescribe para decir que la nota privada
ya no existe y que la conversación viaja por `orden_nota`, cargada aparte y no como campo del
`NovedadDTO`.

**Por qué el hilo NO entra en `NovedadDTO`:** el listado de novedades es paginado y el hilo es de
tamaño variable; meterlo en el DTO haría una consulta por orden de la página (N+1) para un dato que
solo se mira al abrir una orden. El hilo se carga bajo demanda con su propia acción (R28).

---

## 5. UI

`HiloNotasOrden` vive en `components/shared/` desde el primer día: lo montan DOS features distintas
(novedades y mis-asignaciones) con la misma API, que es exactamente el criterio de promoción de
`docs/architecture.md`. Usa primitivas existentes de `components/ui/`; **no se crea ninguna
primitiva nueva**.

Props: `ordenId`, `notas`, `puedeEscribir`, y callbacks a las Server Actions. Render:
lista cronológica ascendente + autor/hora + propio vs ajeno (R16) + marca «nota eliminada» en las
borradas conservando su hueco (R34) + estado vacío (R19).

- `puedeEscribir === false` → **modo solo lectura**: sin compositor y sin controles de borrar (R19).
  Con la ventana asimétrica (D1) cada rol alterna entre escribir y solo leer según el estatus: la
  tienda escribe en `devuelta` y solo lee después; el mensajero solo lee mientras la orden está
  `devuelta` y escribe cuando vuelve a `en_reparto`. La conversación se turna, que es exactamente lo
  que pasa en la operación real.
- El control de eliminar aparece solo en las notas propias y solo con `puedeEscribir` (R31/R32/R35).
- Tras publicar o borrar con éxito, refresca desde el servidor (`router.refresh()` o re-invocación de
  la acción de lectura), nunca solo estado local (R17).
- Contador de caracteres contra `CUERPO_MAX = 200`. La guarda de UI **no sustituye** al zod del borde
  (mismo criterio que `HabilitarNovedadModal:37-42`).

### 5.1 Lado tienda (`/novedades`)

`NovedadesModule.tsx` ya monta las cards POS y abre modales por orden (reprogramar, habilitar). El
hilo se monta como panel/sección de la orden abierta. Es el único sitio donde el hilo se ve
ESCRIBIBLE, porque `/novedades` lista exactamente las órdenes en `devuelta` (R14).

### 5.1 bis — SIN INDICADOR en las cards (decisión D3, dicha en voz alta)

No se añade badge, contador ni punto en `PosOrderCard`, `PosOrderCardMosaico` ni
`PosOrderCardDetalle`. **Consecuencia, dicha explícitamente para que nadie la lea como un olvido:
hasta que exista la ficha N2, el mensajero solo se entera de que hay notas si ABRE la orden.** No es
un descuido de UI: sin el aviso que traerá N2 no hay canal, y un badge que solo aparece al recargar
prometería una señal que el sistema no puede sostener. Cuando N2 aporte la notificación, el
indicador se decide con ella.

Nota de coherencia: esta feature RETIRA los badges de nota privada de esas mismas tres cards (R21).
No se retiran unos para poner otros.

### 5.2 Lado mensajero (`/mis-asignaciones`) — sin pantalla nueva

Decisión P6/P7: **no se abre pantalla nueva y no se toca el corte de la feature 167/R34**
(`MisAsignacionesService.ts:152` sigue leyendo exactamente `por_recoger` y `en_reparto`, R36). El
mensajero ve el hilo en el panel de gestión que ya existe (`GestionarOrdenPanel`, justo donde estaba
el editor de la nota privada que se retira), cuando la orden vuelve a circular y reaparece en
`findMisAsignaciones`.

Consecuencia honesta, que debe quedar escrita en la entrega: **hasta que exista la transición de
"habilitar" (ficha N2, §8), una orden `devuelta` no vuelve sola a `en_reparto` por acción de la
tienda**. El mensajero verá el hilo —y podrá responder, que es su ventana (D1)— cuando la orden
vuelva a circular por las vías que HOY existen (reprogramación, recuperación a bodega y su posterior
reasignación). El camino corto tienda→mensajero —escribo y se reactiva— es justamente lo que N2
aporta, y por eso N2 lleva también el aviso.

El hilo del mensajero se carga bajo demanda (misma acción de lectura), NO dentro de
`listarMisAsignaciones`: meterlo ahí sería N+1 sobre la pantalla más caliente del portal.

---

## 6. Alternativas descartadas

**A1 — Reutilizar `orden_mensajero_meta` para el hilo (fue la primera respuesta humana).**
Descartada con medición: `@@unique([usuarioId, ordenId])` (`db/schema.prisma:634`) sostiene la
idempotencia del upsert de `marcar_luego` (feature 115/R7). Un hilo necesita N filas por orden;
quitar el UNIQUE rompería la 115. Además esa tabla es meta PRIVADA del mensajero: convertirla en
contenido compartido mezcla dos niveles de visibilidad en la misma fila.

**A2 — Migrar las notas privadas existentes como primera nota del hilo.**
Descartada por privacidad, no por coste. Se escribieron bajo una promesa literal en pantalla: «Solo
tú puedes ver esta nota; no la ven la tienda ni otros mensajeros» (`NotaPrivadaMensajero.tsx:30`).
Copiarlas al hilo es una fuga retroactiva. El humano firmó la pérdida el 2026-08-14 (P1).

**A3 — Reutilizar `ChatConversacion` / `ChatMensaje`.**
Descartada. Ese es el chat con el CLIENTE por WhatsApp: sus filas están gobernadas por Meta
(`waMessageId`, `estado`, `direccion`, ventana de 24 h, dedupe por id de Meta) y su hilo se
identifica por orden **+ teléfono**. Meter una conversación interna ahí obligaría a
`direccion`/`tipo`/`estado` nullable o falsos, y contaminaría el dedupe del webhook. Se copia la
FORMA del índice de historial y nada más.

**A4 — Una sola migración que cree `orden_nota` y dropee `nota` a la vez.**
Descartada: mezcla una migración aditiva y segura con una destructiva e irreversible en el dato. Si
hubiera que revertir el drop, un `down.sql` único tiraría también la tabla del hilo con datos ya
escritos.

**A5 — Route handler en `app/api/orden-notas`.**
Descartada por `docs/architecture.md`: mutación interna → Server Action. Un endpoint HTTP añadiría
superficie pública y auth propia sin ganar nada.

**A6 — Meter las notas del hilo dentro de `NovedadDTO` o de `MiAsignacionDTO`.**
Descartada por rendimiento y contrato: N+1 en dos listados paginados para un dato que solo se mira al
abrir una orden (§4, §5.2).

**A7 — Derivar `rol_autor` con un JOIN a `usuario.rol` en la lectura.**
Descartada: el rol puede cambiar y el hilo reescribiría la historia (R4). Una columna congelada
cuesta un enum por fila.

**A8 — Borrado físico de la nota.**
Descartada por el gate (P3a) y por diseño: un hilo que el emisor puede vaciar deja de ser evidencia
de lo que se dijo sobre una orden con dinero de por medio; quien borra primero gana el relato.

**A9 — Filtrar `deleted_at IS NULL` en el repositorio.**
Descartada: R34 exige pintar el hueco marcado, así que la lectura DEBE traer las borradas. Lo que se
filtra es el CUERPO, y se filtra en el service, en un único punto (§2.2).

---

## 7. Riesgos y cómo se controlan

| Riesgo | Control |
| --- | --- |
| Fuga retroactiva de las notas de la 116 | R22 + guardia que verifica que ninguna migración ni módulo de la 221 lee `orden_mensajero_meta.nota` |
| Que el cuerpo de una nota borrada cruce el borde | Proyección aislada en el service (§2.2) + test explícito de que `cuerpo` viaja vacío cuando `eliminada` (R34) |
| Dos definiciones de "novedad" divergiendo | Constante única compartida con `OrdenRepository.novedadWhere` (§2.2) |
| Romper el corte de la feature 167/R34 al montar el lado mensajero | R36 + guardia sobre la lista de estatus de `listarMisAsignaciones` |
| Que un rol quede con permiso de escritura pero sin ningún estado alcanzable donde ejercerlo (el agujero que D1 cerró) | **R38**: guardia que cruza `VENTANA_ESCRITURA` con el conjunto de estatus que lista la pantalla de cada rol y falla si alguna intersección queda vacía |
| Drop destructivo aplicado sin conteo | M2 separada + conteo real pegado en `progress/impl_221.md` y citado en la migración (R23) |
| Ficha `feature_list.json` desalineada («sin update») | Corrección en T0.3; este spec manda sobre la ficha |
| Que la notificación arrastre dos features dentro de una | Resuelto: R37 salió íntegro a la ficha N2 (D2). La 221 no emite ningún aviso (§8) |

---

## 8. HERENCIA PARA LA FICHA N2 «transición habilitar novedad»

> **Esto ya NO es alcance de la 221.** El humano decidió (D2, 2026-08-14) que la notificación sale
> íntegra: la 221 no emite ningún aviso, no existe la ficha N1 («la tienda te escribió») y el ÚNICO
> aviso, «orden reactivada», lo emitirá **N2**, disparado por la transición y no por publicar.
>
> Esta sección se conserva para que **N2 no tenga que volver a medir nada**. Todo lo de abajo está
> medido contra el código, con archivo y línea. `depends_on: 221`.

### 8.1 El modal «Habilitar» y su nota obligatoria

`app/(app)/novedades/_components/HabilitarNovedadModal.tsx` ya existe, con firma DEFINITIVA
`onConfirmar(nota: string)` y nota OBLIGATORIA. Es **maqueta declarada**: su cabecera (`:37`) dice
que «la transición todavía no existe en el backend» y su consumidor solo lanza un toast
(`NovedadesModule.tsx:174-178`, `habilitarPendiente`).

**(a) ¿Esa nota debe ser la PRIMERA nota del hilo? SÍ.** No por conveniencia, sino porque es
literalmente el mismo objeto: mismo autor (`adminTienda`), misma orden, mismo interlocutor (el
mensajero) y la misma justificación escrita en el propio modal (`:31-35`): «Habilitar una orden que
la tienda ya dio por devuelta no deja más rastro que el que alguien escriba». Ese rastro es
exactamente lo que el hilo persiste con autor y fecha. Encaja además sin forzar ninguna regla:

- En el instante de confirmar, la orden **todavía está `devuelta`**, así que la nota cae DENTRO de la
  ventana de escritura (R14) sin excepción alguna.
- Inmediatamente después de la transición la orden sale de `devuelta`, y R35 **congela** esa nota:
  la justificación de haber habilitado una orden queda inborrable. Es el comportamiento deseable y
  sale gratis.

Dos condiciones técnicas para quien lo implemente (van en la ficha de la transición, no aquí):
1. **La nota y la transición deben ir en la MISMA transacción**, y la nota debe escribirse ANTES del
   cambio de estatus. Si se escribiera después, la orden ya no estaría `devuelta` y su propio R14 la
   rechazaría.
2. El modal hoy no acota longitud ni revalida en el borde. Al cablearlo debe aplicarse el mismo
   `publicarNotaSchema` (200 caracteres, R7/R27): la guarda de UI no protege un dato, como el propio
   archivo advierte.

Y una tercera, propia de la ventana asimétrica (D1): al habilitar, la orden pasa a circular otra vez.
Si el estatus destino que N2 elija es `en_reparto`, la ventana de escritura del **mensajero** se abre
en ese mismo instante (R14) — es decir, N2 no solo notifica: habilita la respuesta. Conviene que N2
lo tenga presente al elegir destino, porque un destino distinto de `en_reparto` deja al mensajero
pudiendo leer pero no responder.

**(b) La 221 NO construye la transición «habilitar»: es N2, y la dependencia va al revés de lo que
parece.** Medición del grafo de transiciones
(`lib/types/order-status-transiciones.ts:221-228`): desde `devuelta` existen HOY cinco aristas
—`en_bodega_central`/`en_bodega_satelite` por SLA (#19/#20), `rechazada` por escalado (#21),
`reprogramada` por `reprogramacion_tienda` (#22) y las recuperaciones manuales (#23/#24)— y
**ninguna es «la tienda habilita y la orden vuelve a circular»**. Construirla implica: elegir el
estatus destino, decidir si conserva el mensajero asignado, añadir la arista al grafo, muy
probablemente un valor nuevo del enum `orden_historial_origen_tipo` (con su migración y su `down.sql`
que recrea el tipo), service + Server Action + cableado del modal, y los tests de la guardia de
transiciones. Es una feature de tamaño comparable a la 100, no un añadido de una tanda.

La **221 no depende** de esa ficha: se entrega completa y útil sin ella (la tienda escribe, el
mensajero lee cuando la orden vuelve a circular por las vías existentes). Es la ficha de «habilitar»
la que depende de la 221, porque necesita el hilo donde sembrar su nota.

### 8.2 Coste real del aviso, medido (herencia para N2)

Corrección de un supuesto: **solo hay que migrar `NotificacionEvento`, no `NotificacionTipo`.**
`NotificacionTipo` ya tiene `alert | box | warning` (`db/schema.prisma:1875-1881`) y basta reutilizar
uno; `NotificacionEvento` sí es un inventario CERRADO de cuatro valores (`:1887-1894`) y hay que
ampliarlo.

| Pieza | Detalle medido |
| --- | --- |
| Migración de enum | `ALTER TYPE "notificacion_evento" ADD VALUE IF NOT EXISTS '<x>';` — **va SOLA** en su migración: Postgres no permite usar un valor recién añadido en la misma transacción (55P04) y Prisma corre cada `migration.sql` en una. Precedente literal: `20260721130000_orden_historial_origen_tipo_resolver_novedad/migration.sql:12-18` |
| `down.sql` | Postgres NO tiene `DROP VALUE`: hay que **recrear el tipo** (rename → create → `ALTER TABLE ... TYPE ... USING` → drop old), con la precondición de que no queden filas con el valor nuevo. Patrón literal del `down.sql` de esa misma migración. **A verificar en esa ficha:** el índice único parcial de dedupe (`notificacion_dedupe_key`) y los índices parciales del listado, por si el recreate del tipo obliga a recrearlos |
| Tipos | `lib/types/notificacion.ts:14-18` — ampliar la unión del inventario cerrado |
| Emisor | `lib/notificaciones/emitir.ts` — texto + `emitirOrdenReactivada(...)`. El destinatario `{ tipo: "usuario", usuarioId }` **ya está soportado** (patrón `emitirCargaMasivaTerminada`), así que no hace falta tocar el modelo de destinatarios |
| Dedupe | El emisor central aplica «existe una NO LEÍDA para el mismo (evento, entidad, destinatario) → no-op» (`emitir.ts:58-77`). **DECISIÓN PENDIENTE, propia de N2:** con `entidadId = ordenId`, una orden habilitada DOS veces (devuelta → habilitada → devuelta otra vez → habilitada) no vuelve a avisar mientras el mensajero no haya leído el primer aviso. Hay que decidirlo explícitamente, no heredarlo por omisión |
| Notificador | `lib/notificaciones/notificadores.ts` — envoltorio best-effort inyectable (patrón `notificarCierreDiaPorAprobarCon`) |
| Wiring | inyección en el **service de la transición** de N2 (no en el service del hilo: el disparador es habilitar, no publicar), patrón `CierreDiaService` |
| Tests a ampliar | los cinco que enumeran el inventario cerrado: `notificacion-productores.test.ts`, `notificacion-productores-wiring.test.ts`, `notificacion-notificadores-reales.test.ts`, `notificacion-repository.test.ts`, `tests/integration/db/notificacion-migration.test.ts` + un test de migración nuevo con su rollback |

Tamaño: una migración de enum con `down` no trivial, ~6 archivos de producción y 5 suites ampliadas.
**Es una ficha `medium` por sí sola.**

### 8.3 El nombre del evento: resuelto

En la vuelta anterior este spec señaló que el disparador propuesto («al escribir la tienda») y el
nombre («orden reactivada») no encajaban: escribir solo es posible mientras la orden está en
`devuelta`, es decir, **cuando todavía NO está reactivada**. **El humano lo aceptó (D2):** el evento
se llama «orden reactivada» y lo dispara **la transición**, no el publicar. Un aviso por cada nota de
la tienda no existe y no se echará en falta: quien recibe el aviso de reactivación abre la orden y ve
el hilo entero.

### 8.4 Partición APROBADA (2026-08-14)

| Ficha | Contenido | depends_on | Tamaño |
| --- | --- | --- | --- |
| **221 (esta)** | `orden_nota` + backend + UI del hilo en `/novedades` y en el panel del mensajero + retiro completo de la 116. **Sin notificación de ningún tipo, sin indicador en cards** (D3). Entregable y útil por sí sola. | — | high |
| ~~N1 — «aviso cuando la tienda escribe»~~ | **DESCARTADA.** No hay aviso por nota. | — | — |
| **N2 — «transición habilitar novedad»** | Arista nueva desde `devuelta`, estatus destino, `origen_tipo` nuevo, service + Server Action, cableado de `HabilitarNovedadModal`, la nota obligatoria sembrada como PRIMERA nota del hilo **en la misma transacción y ANTES del cambio de estatus**, y el ÚNICO aviso: «orden reactivada» al mensajero asignado. Todo el coste está medido en §8.1/§8.2: **N2 no re-mide nada**. | 221 | high |

Checklist de arranque para N2, para que no se pierda nada de lo medido aquí:

1. Elegir estatus destino de la transición (§8.1: si es `en_reparto`, abre además la ventana de
   respuesta del mensajero, D1) y decidir si conserva el mensajero asignado.
2. Arista nueva en `lib/types/order-status-transiciones.ts` + su guardia
   (`order-status-transiciones.guardia.test.ts`).
3. Valor nuevo de `orden_historial_origen_tipo` — migración propia + `down.sql` que **recrea el
   tipo** (Postgres no tiene `DROP VALUE`).
4. Valor nuevo de `NotificacionEvento` — migración **SOLA** (55P04) + `down.sql` que recrea el tipo
   (§8.2) + ampliar `lib/types/notificacion.ts:14-18` y las cinco suites del inventario cerrado.
5. Decidir el dedupe del aviso (§8.2, fila «Dedupe»): es la única decisión que 221 dejó abierta para
   N2 y hay que tomarla explícitamente.
6. Cablear `HabilitarNovedadModal` aplicando `publicarNotaSchema` (200 caracteres) en el borde: la
   guarda de UI del modal no protege el dato, como el propio archivo advierte (`:37-42`).
7. Sembrar la nota **antes** del cambio de estatus dentro de la misma transacción; después, la orden
   ya no está en `devuelta` y la propia ventana de la tienda (R14) la rechazaría.
