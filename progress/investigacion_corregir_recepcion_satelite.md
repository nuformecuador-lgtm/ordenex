# Investigación — botón «Corregir» de la recepción de dinero de satélites

Fecha: 2026-10-05 · Solo lectura (código + SELECT en prod por MCP + logs Vercel). Nada escrito.

## Veredicto

**El botón «Corregir» NUNCA funciona.** En el único estado en que aparece («Recibido incompleto»)
llama a la acción de MARCAR, cuyo `WHERE` exige que la consolidación esté SIN marcar. Resultado:
`conflict` el 100 % de las veces, sin escribir nada. No es un fallo mudo en sentido estricto (el
usuario ve un aviso rojo), pero el aviso es **engañoso**: dice «Esta consolidación ya cambió de
estado. Actualizando la lista.» y no actualiza nada; el diálogo queda abierto y reintentar da lo
mismo. La sospecha previa es correcta.

## Camino completo (verificado leyendo el código)

1. UI — `components/shared/conciliacion/ConciliacionAcciones.tsx`
   - `estado = estadoConciliacionDe(marca)` (`app/(app)/cierres-admin/_components/cierre-labels.ts:663-669`):
     `pendiente` si no conciliado; `incompleto` si conciliado y `faltaPorRecibir > 0`; si no `recibido`.
   - L144-154: «Corregir» se pinta SOLO con `estado === "incompleto"` y abre el MISMO diálogo que
     «Marcar recibido» (`setMarcando(true)`).
   - L111-113: `marcar()` → `marcarConsolidacionRecibidaAction({ ...campos, cierreBodegaId })`.
     No existe ninguna acción de «corregir».
   - Montado en dos pantallas: desglose de `/wallet/satelites/[zonaId]`
     (`app/(app)/wallet/satelites/_components/ConciliacionSatelite.tsx:246`) y detalle de la cola de
     `/cierres-admin` (`app/(app)/cierres-admin/_components/CierresBodegaAdminModule.tsx:866`).
2. Action — `lib/actions/conciliacion-satelites.ts:176-190` `marcarConsolidacionRecibidaAction`
   → `service.marcarRecibida`.
3. Service — `lib/services/ConciliacionSatelitesService.ts:126-142` → `escrituras.marcarConciliado`;
   `"conflict"` → `{ status: "conflict" }`.
4. Repositorio — `lib/repositories/CierresBodegaAdminRepository.ts:527-528`:
   ```ts
   const res = await tx.cierreBodega.updateMany({
     where: { id, estado: ESTADO_SOLICITADO, conciliadoAt: null },
   ```
   Una consolidación «incompleta» está, por definición, en `estado = 'aprobado'` y
   `conciliado_at IS NOT NULL` → `count = 0` → `return null` → el `count({ where: { id } })`
   posterior (L563-564) la encuentra → `"conflict"`. Es exactamente R11 de la 431 («marcar una ya
   marcada responde conflicto») aplicado a un botón que pretendía otra cosa.
5. Diálogo — `components/shared/conciliacion/MarcarRecibidoDialog.tsx`
   - `esCorreccion = montoActual !== null` cambia solo el título a «Corregir el monto recibido»;
     el botón de confirmar sigue diciendo «Marcar recibido» y llama a lo mismo.
   - En `conflict` (L190) hace `setAviso(avisoDe(resultado))` y NO llama a `onMarcado`/`onCambio`:
     el diálogo sigue abierto y la lista no se refresca, contra lo que dice el texto
     (`conciliacion-labels.ts`, `CONCILIACION_RESPUESTA.conflicto`).

## Qué ve el usuario, por estado

| Estado de la consolidación | Botones | Al pulsar «Corregir» |
|---|---|---|
| Pendiente de conciliar (`solicitado`, sin marca) | «Marcar recibido» | (no hay «Corregir») — marcar funciona |
| Recibido (`aprobado`, monto ≥ declarado) | «Desmarcar» | (no hay «Corregir») |
| **Recibido incompleto** (`aprobado`, monto < declarado) | «Corregir», «Desmarcar» | Aviso rojo «Esta consolidación ya cambió de estado. Actualizando la lista.»; nada se escribe, nada se refresca, el diálogo sigue abierto. Siempre. |

No hay caso en que la action devuelva `ok` sin escribir (la guarda es por `count`), ni error
genérico/500: el desenlace es un `conflict` controlado, por eso **no aparece en los logs de errores
de Vercel** (verificado: `get_runtime_errors` 7 d no tiene nada de esta acción).

## Cómo reproducirlo

1. Como admin de acceso total, en `/wallet/satelites/<zona>` (o en el detalle de un cierre de bodega
   en `/cierres-admin`), «Marcar recibido» una consolidación con un monto MENOR que el declarado.
2. La fila pasa a «Recibido incompleto» y ofrece «Corregir».
3. Pulsar «Corregir», poner cualquier monto válido y confirmar → aviso de conflicto; la base no cambia.
   (Test de integración que lo fijaría: llamar `marcarConciliado` dos veces sobre el mismo id; el
   segundo devuelve `"conflict"` — es el caso R11 que la suite ya cubre como comportamiento correcto.)

## Impacto medido en producción (SELECT por MCP de Supabase)

- `cierre_bodega` hoy: **85 filas, todas `aprobado` + conciliadas con monto = declarado.** Ahora
  mismo hay **0 consolidaciones en estado «incompleto»**, así que el botón no está visible en ningún
  sitio en este momento.
- `historial_accion` (entidad `cierre_bodega`): 25 `cierre_bodega_conciliado` (24 cierres), 1
  `cierre_bodega_conciliacion_revertida`.
- **El único caso real ocurrió y encaja con el fallo.** Cierre `5da68751-…` (FGAM Zona Sur), declarado
  ₡200.800:
  - 2026-10-01 12:22:15 — marcado por **₡177.800** (→ «Recibido incompleto», con «Corregir» visible).
  - 2026-10-01 20:47:20 — **revertido** (monto borrado ₡177.800).
  - 2026-10-01 20:47:34 — **re-marcado por ₡200.800**, 14 s después.
  Es decir, alguien corrigió el monto por el rodeo Desmarcar + Marcar.
- Logs de Vercel (prod, `POST /wallet/satelites/a9cc6039-…` = la zona de ese cierre), 20:45–20:48 UTC:
  POSTs a las 20:45:03(×2), 20:45:13, 20:45:26(×2), 20:45:38, 20:46:16, 20:46:26, 20:46:38, todos 200 y
  **ninguno con escritura en la base**; luego el trío de 20:47:20-21 (revertir + 2 refrescos) y el de
  20:47:34-35 (marcar + 2 refrescos).

## Verificado vs razonado

**Verificado:**
- El cableado UI → action → service → repo, y que «Corregir» llama a `marcarConciliado` (código).
- El `WHERE` de `CierresBodegaAdminRepository.ts:528` excluye toda fila ya marcada (código).
- El texto del aviso de conflicto y que el diálogo no refresca en `conflict` (código).
- Hoy 0 filas incompletas; un único incompleto histórico corregido por desmarcar+remarcar (SQL prod).
- Ningún error de esta acción en los logs de errores de Vercel (7 d).

**Razonado (no medido):**
- Que los POST sueltos de 20:45–20:46 sean intentos de «Corregir» que devolvieron `conflict`. Es
  compatible (un `conflict` no escribe y no dispara refresco, por eso van solos), pero las lecturas
  del desglose también son server actions por POST y los logs no dicen qué acción es cuál.
- No reproduje en el navegador ni ejecuté tests (tarea de solo lectura).

## Arreglo MÍNIMO propuesto (no rediseñar)

**Preferido — un método propio de corrección, atómico:**
1. `CierresBodegaAdminRepository.corregirConciliacion({ id, montoRecibido, nota, actorUsuarioId })`:
   `$transaction` + `updateMany` con `WHERE { id, estado: ESTADO_APROBADO, conciliadoAt: { not: null } }`
   que reescribe `montoRecibido`, `conciliadoNota`, `conciliadoPor`, `conciliadoAt` (y el espejo
   `resueltoPor/resueltoAt`), + `appendAccion(tx, …)` dentro del callback con el monto NUEVO; mismo
   trío de desenlaces. Método propio porque la guardia del censo mide por método.
2. `ConciliacionSatelitesService.corregirRecibida` (guard `esAccesoTotal` primero) +
   `corregirConsolidacionRecibidaAction` (reusa `marcarConsolidacionRecibidaSchema`).
3. `ConciliacionAcciones`: si `estado === "incompleto"`, el `onMarcar` del diálogo usa la acción de
   corregir. Nada más cambia en la UI.
- **Decisión abierta para el humano/leader:** el tipo de historial. `HistorialAccionTipo` es enum de
  base (`db/schema.prisma:4220`) y la censa `lib/types/historial-accion.ts:251-252`. Un tipo nuevo
  (`cierre_bodega_conciliacion_corregida`) exige migración de enum + entrada de censo (y el gate
  completo, porque toca `lib/types/` y migraciones). Reusar `cierre_bodega_conciliado` evita la
  migración, pero choca con «un tipo ↔ un método» del censo; no lo he medido contra la guardia.

**Alternativa más barata (solo frontend, sin migración):** que «Corregir» ejecute
`revertirConciliacionAction` y después `marcarConsolidacionRecibidaAction` — exactamente el rodeo que
el usuario hizo a mano el 2026-10-01. Contra: no es atómico (si la segunda falla, queda «Pendiente de
conciliar», que es un estado honesto y visible) y deja dos filas de historial en vez de una.

**En ambos casos, de paso:** el aviso `CONCILIACION_RESPUESTA.conflicto` promete «Actualizando la
lista» y el diálogo no refresca; o se llama a `onCambio` en `conflict`, o se quita esa frase.
