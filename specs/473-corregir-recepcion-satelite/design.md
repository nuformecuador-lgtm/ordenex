# 473 — Corregir la recepción de dinero de una satélite · design

> Árbol leído en `dev` @ `753fa9bc`. Citas `archivo:línea` contra ese SHA.
> Arreglo mínimo: una escritura nueva con su servicio y su action, y el diálogo existente apuntando a
> ella. Sin tablas nuevas, sin columnas nuevas, sin migraciones.

## 1. Lo que hay hoy (verificado en el código)

| Capa | Hoy | Problema |
|---|---|---|
| UI `components/shared/conciliacion/ConciliacionAcciones.tsx` | «Corregir» (L155-165, solo `estado === "incompleto"`) abre el MISMO diálogo que «Marcar recibido»; `marcar()` (L102-104) llama siempre a `marcarConsolidacionRecibidaAction` | no existe acción de corregir |
| Diálogo `MarcarRecibidoDialog.tsx` | `esCorreccion` (L117) solo cambia el título; `confirmLabel` (L202) sigue siendo «Marcar recibido»; en `conflict` (L193) solo pinta el aviso | diálogo abierto, lista sin refrescar, texto que miente |
| Action `lib/actions/conciliacion-satelites.ts:178-190` | `marcarConsolidacionRecibidaAction` → `service.marcarRecibida` | — |
| Service `lib/services/ConciliacionSatelitesService.ts:126-141` | guard `esAccesoTotal` → `escrituras.marcarConciliado` | — |
| Repo `lib/repositories/CierresBodegaAdminRepository.ts:517-567` | `WHERE { id, estado: 'solicitado', conciliadoAt: null }` | una «incompleta» es `aprobado` + `conciliado_at` no nulo → `count 0` → `conflict` |

Cómo se deriva «incompleto» (confirmado): `estadoConciliacionDe` (`app/(app)/cierres-admin/_components/cierre-labels.ts:663-669`)
devuelve `pendiente` si `!conciliado`, `incompleto` si `hayFaltantePorRecibir(faltaPorRecibir)`, si
no `recibido`. `faltaPorRecibir` lo calcula el SERVIDOR con `saldoDe(totalEfectivo, montoRecibido)`
(`lib/repositories/SaldosSatelitesRepository.ts:77` y `:240`); un cero o negativo es «no falta nada».
Por tanto **R13 sale gratis** en cuanto la escritura cambia `monto_recibido`: no hay que tocar la
derivación.

Cerrojo de concurrencia del marcado (confirmado): **no hay versión ni campo optimista**; el cerrojo es
la guarda por estado en el `WHERE` del `updateMany` + `count !== 1` → `conflict`/`fuera_de_alcance`
(L527-539, L565-566). La corrección usa el mismo mecanismo (§2.1).

Autorización (confirmado): el servicio responde `forbidden` si `!esAccesoTotal(actor.rol)`, PRIMERO,
antes de tocar repositorio (L130). La UI recibe `puedeConciliar` del Server Component con el mismo
predicado. La corrección reusa exactamente ese guard (R9).

## 2. Diseño

### 2.1 Repositorio — `CierresBodegaAdminRepository.corregirConciliacion` (método NUEVO)

Contrato en `lib/interfaces/repositories/ICierresBodegaAdminRepository.ts` (no en `lib/types/`):

```ts
corregirConciliacion(input: CorregirConciliacionInput): Promise<MarcaConciliacionResult>;
// CorregirConciliacionInput = { id; montoRecibido: string /* escala 2, validado */; nota: string | null; actorUsuarioId }
// MarcaConciliacionResult = "updated" | "conflict" | "fuera_de_alcance"   (el MISMO trío que hoy)
```

Molde de `marcarConciliado`/`revertirConciliacion`: `this.prisma.$transaction(async (tx) => …)`:

1. `previo = tx.cierreBodega.findUnique({ where: { id }, select: { montoRecibido, solicitadoAt, zona.nombre } })`.
   Si `previo === null` → `return null`. **NO** se corta aquí por `montoRecibido === null`: rechazar
   una pendiente o una rechazada es trabajo del `WHERE`, y un corte previo lo haría redundante e
   inmutable a las mutaciones (una mutación que quitara los predicados de estado sobreviviría).
2. `tx.cierreBodega.updateMany({ where: { id, estado: ESTADO_APROBADO, conciliadoAt: { not: null }, montoRecibido: previo.montoRecibido }, data: { montoRecibido: nuevo, conciliadoNota: nota, conciliadoPor: actor, conciliadoAt: ahora, resueltoPor: actor, resueltoAt: ahora } })`.
   - `estado: aprobado` **y** `conciliadoAt: { not: null }`: los DOS predicados, por el mismo motivo
     que en `revertirConciliacion` (L598-601): el estado es lo que leen las pantallas y
     `conciliado_at` es el predicado de la marca. (R1, R6)
   - `montoRecibido: previo.montoRecibido`: compare-and-swap con el valor leído en la misma
     transacción. En Postgres READ COMMITTED, una segunda transacción concurrente que leyó el mismo
     `previo` re-evalúa el `WHERE` tras el bloqueo de fila, ve el monto ya cambiado y obtiene
     `count 0` → `conflict`. Sin este predicado la segunda fila del historial llevaría un
     `valor_anterior` falso. (R8)
   - `estado` no se escribe (ya es `aprobado`); los cuatro datos siguen no nulos → el `CHECK`
     `cierre_bodega_conciliacion_coherente` se cumple.
3. `count !== 1` → `return null`.
4. `appendAccion(tx, [{ accion: "cierre_bodega_conciliado", entidadTipo: "cierre_bodega", entidadId: id, entidadEtiqueta: etiquetaDeEntidad("cierre_bodega", …), monto: nuevo, valorAnterior: previo.montoRecibido.toFixed(2), valorNuevo: nuevo.toFixed(2), ...actor }])`
   — DENTRO del callback y con `tx` (nunca `this.prisma`). Sin la nota (R4, R5 de la 362).
5. Fuera de la tx, igual que los hermanos: `count({ where: { id } }) > 0 ? "conflict" : "fuera_de_alcance"`. (R6, R7)

Money-safe: `new Prisma.Decimal(montoRecibido)` en el borde de la escritura; ni `Number` ni
`parseFloat`. No toca ningún libro de dinero (R12).

### 2.2 Servicio — `ConciliacionSatelitesService.corregirRecibida`

- `escrituras: Pick<ICierresBodegaAdminRepository, "marcarConciliado" | "revertirConciliacion" | "corregirConciliacion">`.
- `corregirRecibida(input: MarcarConsolidacionRecibidaInput, actor): Promise<MarcaConciliacionServiceResult>`
  (contrato añadido a `lib/interfaces/services/IConciliacionSatelitesService.ts`):
  guard `esAccesoTotal` PRIMERO (R9) → `corregirConciliacion({ id, montoRecibido, nota: input.nota ?? null, actorUsuarioId })`
  → `updated`→`{status:"ok", cierreBodegaId}`, `conflict`→`{status:"conflict"}`, `fuera_de_alcance`→`{status:"no_encontrada"}`.
- Mismo tipo de entrada que marcar: los campos son idénticos. No se añade tipo en `lib/types/`.

### 2.3 Server action — `corregirConsolidacionRecibidaAction`

En `lib/actions/conciliacion-satelites.ts`, calco de `marcarConsolidacionRecibidaAction`: sesión
primero (R10) → `marcarConsolidacionRecibidaSchema.parse` (reusado, `.strict()`, `montoPositivoSchema`,
nota ≤ 500; R11) → `service.corregirRecibida`. Devuelve `MarcaConciliacionActionResult` (sin tipo
nuevo). Sin ruta API nueva: es una mutación interna (Server Action), como sus hermanas.

La guardia `superficie-de-uso` exige que toda action exportada esté montada: la monta
`ConciliacionAcciones` en T5, en el mismo PR. Ninguna anotación `@sin-superficie`.

### 2.4 UI

`ConciliacionAcciones.tsx`:
- Una función de envío por modo: si `estado === "incompleto"`, `onMarcar` del diálogo llama a
  `corregirConsolidacionRecibidaAction`; si `pendiente`, a `marcarConsolidacionRecibidaAction`. (R14)
- Éxito de corrección: `toast.success(CONCILIACION_RESPUESTA.corregida(monto))` + `onCambio()`. (R16)
- Nuevo manejador de conflicto pasado al diálogo: `toast.error(CONCILIACION_RESPUESTA.conflicto)` + `onCambio()`. (R17)

`MarcarRecibidoDialog.tsx`:
- `confirmLabel = esCorreccion ? MARCAR_RECIBIDO_TEXTO.confirmarCorregir : MARCAR_RECIBIDO_TEXTO.confirmar`. (R15)
- Prop nueva opcional `onConflicto?: () => void | Promise<void>`. En `resultado.status === "conflict"`:
  `await onConflicto?.()` y `onOpenChange(false)`; sin `onConflicto` conserva el comportamiento de hoy
  (aviso dentro del diálogo). El resto de estados (`no_encontrada`, `forbidden`, …) no cambia. (R17)

`conciliacion-labels.ts`: `MARCAR_RECIBIDO_TEXTO.confirmarCorregir = CONCILIACION_ACCION.corregir`;
`CONCILIACION_RESPUESTA.corregida = (monto) => \`Monto recibido corregido a ${money(monto)}.\``.
El texto de `conflicto` NO cambia: con R17 pasa a ser verdad.

Las dos pantallas que montan el componente (`ConciliacionSatelite.tsx:246`,
`CierresBodegaAdminModule.tsx:866`) ya pasan `onCambio`; no se tocan.

## 3. Decisión D1 — el tipo de historial (medido contra la guardia real)

**Decisión: reutilizar `cierre_bodega_conciliado`, con método propio y entrada propia en el censo.**

Medido en `tests/unit/guards/historial-accion-escrituras-cubiertas.guardia.test.ts`:
- El censo (L68-588) es una lista de entradas `{tipos, archivo, metodo, forma, mutacion}`. La
  cobertura (L943-956) solo exige que cada tipo del enum tenga **al menos** un productor y que ningún
  productor nombre un tipo inexistente. **Un tipo con dos métodos productores está admitido y tiene
  precedente**: `zona_central_cambiada` (`ZonaRepository.update` L254 y `.create` L264) y
  `orden_eliminada` (`softDelete` L446 y `softDeleteViaApi` L455).
- «Mide por método, no por escritura» significa que **un método** con dos `appendAccion` deja una
  mutación viva. Aquí el método es PROPIO (`corregirConciliacion`), con UN `appendAccion` y su propia
  entrada: `{ tipos: ["cierre_bodega_conciliado"], archivo: CierresBodegaAdminRepository.ts, metodo: "corregirConciliacion", forma: "abre_tx", mutacion: /tx\.cierreBodega\.updateMany\(/ }`.
  Borrar su `appendAccion`, sacarlo del callback o pasarle `this.prisma` pone esa entrada roja (R5).
- El número duro `HISTORIAL_ACCION_TIPOS` = 65 (L975) **no cambia**; ni el catálogo, ni
  `lib/types/historial-accion.ts`, ni el enum de base.

La fila se distingue de una marca porque lleva `valor_anterior`/`valor_nuevo` (la marca los deja
nulos, `CierresBodegaAdminRepository.ts:546-560`). Precedente de montos/valores de catálogo en esas
columnas: `CorreccionFechaReprogramacionRepository.ts:173`, `UserRepository.ts:503`. No es dato de
cliente: la guardia `historial-accion-sin-datos-cliente` vigila vocabulario (`nota`, `motivo`,
`direccion`…), y aquí van dos importes.

### Alternativa descartada A — tipo nuevo `cierre_bodega_conciliacion_corregida`

Rótulo propio en el registro («Corrigió el monto recibido…»). Coste medido en el árbol: migración
`ALTER TYPE "historial_accion_tipo" ADD VALUE` en su propio archivo (Postgres no deja usar el valor
en la misma tx, ver `20260919120000_historial_accion_conciliacion_bodega/migration.sql:33`) + su
`down.sql` (regla: los `down.sql` previos NO se tocan), entrada en `HISTORIAL_ACCION_TIPOS`, categoría
y rótulo en `lib/types/historial-accion.ts:251/462/538`, número duro 65→66 en la guardia del censo y
en `tests/unit/historial-accion/catalogo-y-choke-point.test.ts` (L79, L443), y revisión de los
cinco tests de migración que enumeran los valores del enum (`historial-accion-*-migration.test.ts`).
Además, la migración tiene que llegar a preview y a prod antes que el código. Descartada por ser
rediseño frente al arreglo mínimo pedido: no arregla nada que la opción elegida deje roto, y la
información (monto anterior y nuevo) queda igual de registrada. Queda escrita como vía si el humano
quiere el rótulo propio.

### Alternativa descartada B — solo frontend: «Corregir» = Desmarcar + Marcar

Es el rodeo que el usuario hizo a mano el 2026-10-01. Descartada: no es atómica (si la segunda
llamada falla, la consolidación queda «Pendiente de conciliar» y el monto desaparece), deja DOS filas
de historial por corrección (contra la ficha: «una fila de historial») y abre una ventana en la que
otra persona puede marcarla entre medias.

### Alternativa descartada C — un booleano `esCorreccion` en `marcarConciliado`

Un método con dos `WHERE` y dos `appendAccion`: es exactamente la forma que la guardia NO ve (mide por
método; medido en fichas 376 y 380, escrito en `ICierresBodegaAdminRepository.ts:185-187`).

## 4. Decisión D3 — qué columnas reescribe la corrección

Reescribe `monto_recibido`, `conciliado_nota`, `conciliado_por`, `conciliado_at` y el espejo
`resuelto_por`/`resuelto_at`. Motivo: el resultado en base queda **idéntico al del rodeo** Desmarcar
+ Marcar que hoy funciona (es lo que pasó en prod con FGAM), así que la corrección no introduce
semántica nueva, solo la hace atómica. Consecuencia declarada: la analítica financiera, que lee
`resuelto_at`, cuenta la consolidación en el periodo de la corrección.

## 5. Límites declarados

- **Dos personas corrigiendo a la vez**: R8 garantiza que el historial no miente (cada fila lleva el
  monto que de verdad sustituyó), pero quien confirme último gana sobre lo que vio en pantalla, porque
  el cliente no envía el monto que vio. Igual que hoy en Marcar → Desmarcar → Marcar. Cerrarlo
  exigiría ampliar el contrato de la action; fuera del mínimo.
- **Corregir al mismo monto** se acepta y deja su fila (puede haber cambiado la nota). **Corregir por
  encima de lo declarado** se acepta: marcar ya lo admite («llegó de más»).
- Sin E2E (no hay harness). La UI se cubre con el test de componente existente.

## 6. Trazabilidad R → test

| R | Test (archivo · caso) |
|---|---|
| R1 | `tests/integration/db/corregir-conciliacion.int.test.ts` · «corregir una incompleta cambia el monto y la deja conciliada (aprobado, conciliado_at no nulo)» |
| R2 | idem · «la corrección reescribe conciliado_por/conciliado_at y el espejo resuelto_*» |
| R3 | idem · «la nota se sustituye; sin nota queda NULL» |
| R4 | idem · «deja exactamente UNA fila cierre_bodega_conciliado con monto nuevo, valor_anterior y valor_nuevo, sin la nota» + `tests/unit/repositories/cierres-bodega-admin-marca.test.ts` · «corregirConciliacion registra el monto nuevo y el anterior y no la nota» |
| R5 | `tests/unit/guards/historial-accion-escrituras-cubiertas.guardia.test.ts` · entrada `CierresBodegaAdminRepository.ts#corregirConciliacion` del `it.each` |
| R6 | `corregir-conciliacion.int.test.ts` · «sobre una pendiente responde conflict y no escribe nada» y «sobre una rechazada responde conflict y no escribe nada» (cuentan filas de historial antes/después) |
| R7 | idem · «sobre un id inexistente responde fuera_de_alcance» + `tests/unit/services/conciliacion-satelites-service.test.ts` · «corregir: fuera_de_alcance se traduce a no_encontrada» |
| R8 | `cierres-bodega-admin-marca.test.ts` · «el WHERE de corregirConciliacion exige aprobado, conciliadoAt no nulo y el monto leído» + «count 0 tras leer responde conflict sin appendAccion» |
| R9 | `conciliacion-satelites-service.test.ts` · «corregir: un actor sin acceso total recibe forbidden y no se llama al repositorio» |
| R10 | `tests/unit/actions/conciliacion-satelites-actions.test.ts` · «corregir sin sesión responde unauthenticated sin llamar al servicio» |
| R11 | idem · «corregir con monto 0 / negativo / tres decimales / clave extra / nota > 500 responde validation_error sin llamar al servicio» |
| R12 | `corregir-conciliacion.int.test.ts` · «corregir no escribe en wallet_movimiento, wallet_tienda_movimiento ni pago_mensajero_movimiento» |
| R13 | `corregir-conciliacion.int.test.ts` · «corregida a lo declarado: SaldosSatelitesRepository devuelve faltaPorRecibir 0.00 y conciliado» y «corregida por debajo: faltante recalculado» + `tests/integration/wallet-satelites.test.tsx` · «una consolidación sin faltante no ofrece Corregir» (existente L530, se conserva) |
| R14 | `tests/integration/wallet-satelites.test.tsx` · «Corregir llama a la action de corregir y nunca a la de marcar» (+ el caso existente de marcar comprueba que no llama a corregir) |
| R15 | idem · «el diálogo de Corregir arranca con el monto registrado y su botón dice Corregir» |
| R16 | idem · «corrección ok: cierra el diálogo, avisa el monto corregido y refresca» |
| R17 | idem · «conflict al corregir o al marcar: cierra el diálogo, muestra el aviso y refresca» |

**Mutaciones obligatorias del `WHERE`** (memoria «Probar el WHERE donde vive»: los tests de servicio
con dobles no lo ven). El integration test DEBE ponerse rojo con cada una, medido y anotado en
`progress/impl_473.md`:
1. `estado: ESTADO_APROBADO` → `ESTADO_SOLICITADO` (el bug de hoy);
2. quitar `conciliadoAt: { not: null }` y `estado` del `WHERE` (sobre una pendiente el `montoRecibido: null`
   casa, el `UPDATE` escribe y choca con el `CHECK` → excepción en vez de `conflict` → R6 rojo);
3. quitar `montoRecibido: previo.montoRecibido` → lo caza el unitario de R8 (en integración no se
   puede intercalar dos transacciones de forma fiable; se declara).
