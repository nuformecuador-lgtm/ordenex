# Bitácora de implementación — Feature 235 · Ayuda a la tienda: estatus propio

> Rama `feature/235-ayuda-tienda-estatus`. Base `origin/dev` = **5f35963f**.
> Spec: `specs/235-ayuda-tienda-estatus/{requirements,design,tasks}.md` (46 requisitos, T0–T8).
> Puerta humana pasada el 2026-08-19 (final de `requirements.md`).
>
> **Lo que esta ficha hace, en una línea:** la solicitud de ayuda deja de ser un **booleano
> `orden.ayuda`** y pasa a ser un **estatus propio (`ayuda_tienda`)**, con lo que las cinco
> superficies que debían excluir la orden lo hacen **por construcción** en vez de por un filtro que
> alguien tenía que acordarse de escribir — y no escribió en ninguna
> (`progress/auditoria_ayuda_tienda.md` §2/§4).

---

## 0 · Las firmas, y cómo aterrizaron

| P | Firmado | Dónde vive en el código |
| --- | --- | --- |
| **P1** | `ayuda_tienda` · «Ayuda solicitada a la tienda» · badge `warning` | `lib/types/order-status.ts`, `EstatusBadge.tsx` |
| **P2** | `solicitud_ayuda_tienda` + `rescate_ayuda_tienda`; **sin** `gestion_tienda_ayuda` | `lib/types/orden-historial.ts`, `db/schema.prisma` |
| **P3** | hito público = el mismo que `en_reparto` | `lib/types/rastreo-publico.ts` |
| **P4** | **EN CONTRA de la recomendación:** el rescate **no** emite webhook | `lib/types/webhook-eventos.ts` (§ abajo) |
| **P5** | la columna `ayuda` se retira en esta ficha | migración `20260819160000_orden_retiro_ayuda` |
| **P6** | grandfather, sin script | ninguna migración de datos (§ T0.1 abajo) |
| **P7** | los KPI del día **siguen contando** las órdenes en ayuda | `MisAsignacionesService` (§ mutación (e)) |
| **P8** | el chat conserva a esos clientes | `RepartoModule.contactosChat` |
| **P9** | solo el **mensajero asignado** pide ayuda, **por la ventana** | `ventana-hilo-notas.ts` + `autorizarSobreHilo` |
| **P10** | el punto de rescate se entrega aquí; «Habilitar» lo llama | `lib/services/rescate-ayuda.ts` |

### P4 — la excepción del webhook, que era lo más delicado

Se implementó **por FAMILIA DE ORIGEN y nunca por estado destino**, tal como pide la firma:

```ts
// lib/types/webhook-eventos.ts
export const ORIGENES_SIN_EVENTO_PUBLICO = ["rescate_ayuda_tienda"] as const;
export function esTransicionEmitible(estadoDestino: string, origenTipo: string): boolean {
  return esEventoPublico(estadoDestino) && !esFamiliaSinEventoPublico(origenTipo);
}
```

Las tres condiciones de la firma, una a una:

1. **Solo la familia del rescate, jamás el estado.** La decisión vive en la **política**
   (`webhook-eventos.ts`), y el emisor la consulta. Si se hubiera implementado por estado, una
   `reprogramada` liberada por el cron dejaría de avisar.
2. **Hay test que se pone rojo si alguien amplía la excepción.** Dos, de hecho: uno fija la lista por
   **igualdad literal** y otro comprueba que `liberacion_reprogramada` / `deshacer_gestion` /
   `recoleccion` **siguen emitiendo** al mismo estado destino. Medido con mutación (c), abajo.
3. **`emitirBestEffort` y el emisor no cambian de contrato.** `emitirWebhooksEstado`, `WebhookEmisor`
   y `emisorWebhookEstadoReal` conservan firma; el único cambio es *a quién le pregunta* el `continue`
   del paso 2. `emitirBestEffort` (que es de **notificaciones**, no de webhooks) no se tocó.

**No resultó frágil**, así que no se reabre P4.

---

## 1 · T0.1 — la medición de datos en vuelo: **PENDIENTE, y bloquea el despliegue**

⚠️ **No pude re-medir.** El MCP de Supabase **no está expuesto a este subagente** (`.mcp.json` lo
declara, pero la herramienta no llega hasta aquí). La base contra la que corre `prisma migrate
status` es `localhost:5432` (`ordenex`), no producción.

- Lo que hay: la medición de la **puerta humana del 2026-08-19** — columna `ayuda` existente en
  `prod`, **0 órdenes con la bandera encendida**, autocomprobado sobre 141 órdenes vivas → *grandfather*.
- Lo que falta: **re-medirlo antes de desplegar**, porque la foto caduca (design §14.4). La consulta
  es `SELECT count(*) FROM orden o JOIN order_status os ON os.id = o.estatus_id WHERE o.ayuda = true
  GROUP BY os.value`.
- Si el conjunto **no** fuera vacío, hace falta `scripts/migrar-ayuda-a-estatus.ts` **antes** de la
  migración del retiro (design §9). **No lo escribí**, porque escribir un script para un conjunto
  medido como vacío es código sin caso.

R43 sí quedó cubierto por su **propiedad estructural**, que no caduca: una orden en `ayuda_tienda`
la ve su tienda y tiene dos salidas (test nombrado abajo).

---

## 2 · Archivos

### Migraciones (3, cada una con su `down.sql`)

| Carpeta | UP | DOWN |
| --- | --- | --- |
| `db/migrations/20260819140000_order_status_ayuda_tienda/` | `INSERT … WHERE NOT EXISTS` | `DELETE … AND NOT EXISTS` (referencias en `orden` / historial) |
| `db/migrations/20260819150000_orden_historial_origen_ayuda_tienda/` | 2 × `ADD VALUE IF NOT EXISTS` | **RECREA el tipo** con los 27 previos + `USING` + `DROP TYPE …_old` |
| `db/migrations/20260819160000_orden_retiro_ayuda/` | `ALTER TABLE "orden" DROP COLUMN "ayuda"` | `ADD COLUMN IF NOT EXISTS … boolean NOT NULL DEFAULT false` (pérdida de dato declarada) |

**Índices tras el recreate del enum: RE-VERIFICADO, no citado.** Barrido de
`db/migrations/*/migration.sql`:

- la **única** columna del árbol que usa `orden_historial_origen_tipo` sigue siendo
  `orden_historial_estado.origen_tipo` (declarada en `20260713120000`, línea 36);
- sobre esa tabla hay **tres** índices y los tres son **btree plenos, sin `WHERE`**:
  `orden_historial_estado_orden_id_created_at_idx`,
  `orden_historial_estado_orden_id_estatus_destino_id_idx` y
  `orden_historial_actor_origen_created_idx` (167, el único que menciona `origen_tipo`, y como
  columna del índice, no en un predicado).

→ `ALTER COLUMN … TYPE` los reconstruye solo. **No hay que rehacer ninguno a mano.** Las dos mitades
de esta verificación están fijadas en test (no en un comentario).

**Los `down.sql` anteriores NO se tocaron.** Lo que se ajustó son los conjuntos que los tests les
descuentan al SEED vigente (7 archivos de `tests/integration/db/`), que es la forma correcta:
la foto histórica se queda quieta.

### Dominio y tipos

- `lib/types/order-status.ts` — `ayuda_tienda` como apéndice (21 → **22**).
- `lib/types/orden-historial.ts` — las dos familias (27 → **29**); ninguna en `ORIGEN_TIPOS_VISITA_REAL`
  ni en `ORIGEN_TIPOS_CON_GESTION`.
- `lib/types/order-status-transiciones.ts` — **+3 aristas, −0**: #62 `en_reparto → ayuda_tienda`,
  #63 `ayuda_tienda → en_reparto`, #64 `ayuda_tienda → sin_gestionar`. **56 → 59 aristas / 54 → 57
  pares**, re-derivadas contra `tests/fixtures/inventario-transiciones-140.ts`.
- `lib/types/ventana-hilo-notas.ts` — `VENTANA_ESCRITURA` pasa de **un valor por rol a una lista**;
  `estaEnVentanaDeEscritura` **pierde el tercer parámetro**. Aquí muere la «segunda puerta» y con
  ella la deuda de R19 de la 239.
- `lib/types/webhook-eventos.ts` — `ORIGENES_SIN_EVENTO_PUBLICO` + `esTransicionEmitible` (P4).
- `lib/types/rastreo-publico.ts`, `EstatusBadge.tsx` — las dos superficies exhaustivas.
- `exclude-por-rol.ts`, `estados-bodega-satelite.ts`, `tablero-dia.ts` — los tres mapas **parciales**,
  con la razón de la **ausencia** escrita en el archivo y afirmada en test con su caso negativo.
- `lib/types/gestion-orden.ts` — `ListarMisAsignacionesResult` gana `conAyuda`.

### Repositorios

- `lib/repositories/OrdenRepository.ts` —
  **`transicionarAyuda`** (nuevo): el punto único de escritura, `updateMany` **guardado por el
  estatus de origen** + `appendCambioEstado` en la misma tx. **Retirados**: `marcarAyuda`,
  `desmarcarAyuda`, `habilitarNovedad`. `novedadWhere` pasa a **dos igualdades de estado** (aquí
  muere el tapón de la 239). Proyección de `NovedadOrdenRow` sin la columna.
- `lib/repositories/CierreDiaRepository.ts` — el corte recorre **DOS bloques guardados**, uno por
  estado de origen, cada uno con su `updateMany` y **su propio append con el origen REAL**.
- `lib/repositories/GestionOrdenRepository.ts`, `OrdenNotaRepository.ts` — fuera el `select`/mapeo.

### Servicios

- `lib/services/rescate-ayuda.ts` (**nuevo**) — `rescatarOrdenAyuda`, el punto único (R8/R9). La
  guarda de estado vive **aquí**, no en los llamadores.
- `lib/services/SolicitudAyudaService.ts` — el efecto pasa de `marcarAyuda` a la transición guardada;
  catálogo resuelto **antes** de publicar (fallo cerrado); `recuperar` **delega**.
- `lib/services/HabilitarNovedadService.ts` — «Habilitar» **delega en el mismo punto**.
- `lib/services/MisAsignacionesService.ts` — tres estados leídos, tres grupos devueltos, KPI sobre
  `porGestionar ∪ conAyuda`.
- `lib/services/CierreDiaService.ts` — `ESTADOS_PENDIENTES` gana `ayuda_tienda` **por su nombre**.
- `lib/services/CorteDiarioService.ts` — resuelve el tercer id; los **tres o ninguno**.
- `lib/services/OrdenNotaService.ts`, `NovedadesService.ts` — sin el tercer argumento / sin el campo.
- `lib/services/jobs/webhook-estado-encolado.ts` — pregunta a la política; **firma intacta**.

### Interfaces

`IOrdenRepository` (+`TransicionAyudaInput`, −3 métodos, −`NovedadOrdenRow.ayuda`),
`IOrdenNotaRepository` (−`OrdenParaHilo.ayuda`), `IGestionOrdenRepository` (−`MiAsignacionRow.ayuda`),
`IMisAsignacionesService` (+`conAyuda`, −`MiAsignacionDTO.ayuda`),
`ICierreDiaRepository` (+`ayudaEstatusId` **obligatorio**), `ISolicitudAyudaService` (JSDoc).

### Server Actions

`lib/actions/habilitar-novedad.ts` (cableado del `notaRepo`). Las **tres acciones conservan firma y
forma de resultado**, tal como pide design §10.

### UI — ⚠️ ver «Decisiones abiertas»

`RepartoModule.tsx` (corte de cliente **borrado**, `conAyuda` por props, chat, card),
`HiloNotasAyudaModal.tsx` (**nuevo**, R35), `reparto/page.tsx`, `GestionarOrdenPanel.tsx`,
`NovedadAcciones.tsx`, `NovedadesModule.tsx`, `EstatusBadge.tsx`, `exclude-por-rol.ts`.

---

## 3 · Mapa `R<n> → test nombrado` (46/46)

Nombres **tal cual los imprime el runner**. Ruta abreviada: `u/` = `tests/unit/`, `c/` = `tests/components/`,
`i/` = `tests/integration/db/`.

| R | Archivo | Caso |
| --- | --- | --- |
| R1 | `u/types/order-status.test.ts` | `235/R1: `ayuda_tienda` existe en el catalogo y es DISTINTO de `en_reparto`` |
| R2 | `u/services/solicitud-ayuda-service.test.ts` | `235/R2: publica el motivo como nota del hilo y deja la orden en `ayuda_tienda`` |
| R3 | `u/services/solicitud-ayuda-service.test.ts` | `235/R3: publica la nota ANTES de transicionar (la nota es la que lleva la autorizacion)` |
| R4 | `u/services/solicitud-ayuda-service.test.ts` | `235/R4: rechazo del hilo (`forbidden`): la orden NO se mueve y devuelve el mismo resultado` |
| R5 | `u/types/orden-ayuda-borde.test.ts` | `un motivo de tope + 1 se RECHAZA en el borde, sin llegar al servicio` |
| R6 | `u/services/solicitud-ayuda-service.test.ts` | `235/R6/R13 (MONEY-SAFE): la transicion NO lleva mensajero, ni montos, ni prioridad` |
| R7 | `u/services/solicitud-ayuda-service.test.ts` | `235/R7: suelta el puntero 1-a-1 DEL ACTOR sobre ESTA orden, para que el panel tome la siguiente` |
| R8 | `u/services/rescate-ayuda-service.test.ts` | `los dos producen la MISMA transicion, y solo cambia el actor` |
| R9 | `u/services/rescate-ayuda-service.test.ts` | `R9: rescatar una orden en `%s` devuelve forbidden y NO escribe ni una fila de historial` |
| R10 | `u/types/orden-historial-types.test.ts` | `235/R10: las DOS familias estan en el SEED, una por cada SENTIDO del viaje` |
| R11 | `u/types/orden-historial-types.test.ts` | `235/R11: NINGUNA de las dos es VISITA REAL — pedir ayuda no es un intento de entrega` |
| R12 | `u/domain/order-status-transiciones.guardia.test.ts` | `235/R12: las salidas de `ayuda_tienda` son EXACTAMENTE esas dos, enumeradas enteras` |
| R13 | `u/services/rescate-ayuda-service.test.ts` | `R13 (MONEY-SAFE): el input NO lleva montos, ni prioridad, ni mensajero` |
| R14 | `u/repositories/orden-repository.test.ts` | `R14(a): `findParadasEnReparto` acota por IGUALDAD a `en_reparto` — un `in` la colaria` |
| R15 | `c/RepartoAyuda.test.tsx` | `235/R15: NO llega al mapa de ruta — la parada desaparece, no solo su card` |
| R16 | `u/services/mis-asignaciones-service.test.ts` | `R16: `escogerParaGestion` sobre una orden en `ayuda_tienda` devuelve `conflict`` |
| R17 | `u/repositories/orden-repository.test.ts` | `R17(b): el GRAFO no ofrece salida de `ayuda_tienda` hacia asignacion, ruteo ni recoleccion` |
| R18 | `u/services/mis-asignaciones-service.test.ts` | `R18: las de ayuda salen en `conAyuda` y NO en `porGestionar`` |
| R19 | `c/RepartoAyuda.test.tsx` | `235/R19: la card conserva «Recuperar», que es la salida de vuelta` |
| R20 | `u/services/mis-asignaciones-service.test.ts` | `R20 (P7): una orden que pasa a `ayuda_tienda` NO cambia ninguno de los tres KPI` |
| R21 | `u/services/mis-asignaciones-service.test.ts` | `R21: el COD de una gestionada hoy y el de una en ayuda NO se suman dos veces` |
| R22 | `u/services/cierre-dia-service.test.ts` | `R22: con una orden en `ayuda_tienda`, `solicitarCierre` devuelve conflict con motivo accionable` |
| R23 | `u/services/cierre-dia-service.test.ts` | `R23: la lista de estados pendientes NOMBRA `ayuda_tienda`` |
| R24 | `u/services/cierre-dia-service.test.ts` | `R24: con un cierre `vencido` y una orden en `ayuda_tienda`, transiciona a `solicitado`` (+ gemelo `rechazado`) |
| R25 | `u/services/solicitud-ayuda-service.test.ts` | `235/R25: un mensajero BLOQUEADO por un cierre sin resolver PUEDE pedir ayuda` (+ `R25` en `rescate-ayuda-service`) |
| R26 | `u/repositories/cierre-dia-repository.test.ts` | `235/R26: barre las de `en_reparto` Y las de `ayuda_tienda` en la MISMA transaccion` |
| R27 | `u/repositories/cierre-dia-repository.test.ts` | `235/R27: cada append lleva el `estatusOrigenId` de SU bloque, no uno supuesto` |
| R28 | `u/repositories/cierre-dia-repository.test.ts` | `235/R28 (MONEY-NEUTRAL): el `data` del bloque de ayuda toca SOLO `estatusId`` |
| R29 | `u/guards/ayuda-columna-retirada.guardia.test.ts` | `ningun modulo de codigo la usa (censo sobre fuente sin comentarios)` — tras el corte no queda señal que apagar porque no queda marca |
| R30 | `u/repositories/orden-repository.novedades.test.ts` | `235/R30: la orden con ayuda pedida llega con `estatusValue = ayuda_tienda`` |
| R31 | `u/repositories/orden-repository.novedades.test.ts` | `R21: `count` y `find` comparten EXACTAMENTE el mismo where` |
| R32 | `u/repositories/orden-repository.novedades.test.ts` | `235/R32: ninguna rama lista una orden que SALIO del estatus de ayuda` |
| R33 | `u/repositories/orden-repository.novedades.test.ts` | `235/R30/R33: el predicado son DOS igualdades de estado, y NADA mas` |
| R34 | `u/services/orden-nota-service.test.ts` | `235/R34: en `ayuda_tienda` publican LOS DOS — la tienda y el mensajero asignado` |
| R35 | `c/RepartoAyuda.test.tsx` | `235/R35: desde la card se abre el HILO, que es donde el mensajero ejerce su ventana` |
| R36 | `u/services/orden-nota-service.test.ts` | `235/R36: la firma de la ventana YA NO ADMITE ninguna bandera` |
| R37 | `c/EstatusBadgeCatalogoV2.test.tsx` | `la etiqueta dice A QUIEN se le pidio la ayuda, no solo que se pidio` (+ `OrdenesExcludePorRol`, `estados-bodega-satelite`, `buckets-estatus`) |
| R38 | `u/services/rastreo-publico-service.test.ts` | `235/R38: `en_reparto -> ayuda_tienda -> en_reparto` produce UNA sola entrada «En reparto»` |
| R39 | `u/types/webhook-eventos.test.ts` | `235/R39: `ayuda_tienda` NO es evento publico — el vocabulario no crece por esta feature` |
| R40 | `u/guards/ayuda-columna-retirada.guardia.test.ts` | `ningun modulo de codigo la usa (censo sobre fuente sin comentarios)` |
| R41 | `i/ayuda-tienda-migration.test.ts` | ``$nombre`: ni el up ni el down escriben `estatus_id`` (×3) |
| R42 | `i/ayuda-tienda-migration.test.ts` | `R42 — el DOWN recrea el tipo con los 27 valores previos, SIN los dos nuevos` |
| R43 | `i/ayuda-tienda-migration.test.ts` | `235/R43: una orden en el estatus de ayuda ni queda invisible ni queda sin salida` |
| R44 | prueba manual (§4) + `u/domain/…connectividad` | `los value que aparecen en el mapa, terminales y creacion cubren los 22 del SEED` |
| R45 | `c/OrdenesExcludePorRol.test.ts` | `235/R45 (CASO NEGATIVO): y eso lo distingue de `devuelta` y del pre-estado, que SI se le excluyen` (+ gemelos en satélite y buckets) |
| R46 | `u/services/cierre-dia-service.test.ts` | `R22: … motivo accionable` (afirma `not.toMatch(/m1|o1|c1/)`) + las 818 guardias verdes |

**Casos adicionales que no mapean a un R pero sostienen las firmas:**
`235/P9: la tienda NO puede pedir ayuda sobre una orden en reparto — la ventana la para`,
`235/P8: SÍ sigue entre los contactos del chat`,
`235/P4 — la excepcion de webhook es POR FAMILIA, y exactamente UNA`,
`235/P2: `gestion_tienda_ayuda` NO se declara aqui — nace con su productor (ficha 237)`.

---

## 4 · T7.1 — R44 medido, no supuesto

Al añadir `ayuda_tienda` al SEED y **antes** de clasificarlo, `pnpm run typecheck` rompió en
**exactamente las tres superficies exhaustivas** que design §11 predice, y en ningún sitio más:

```
app/(app)/ordenes/_components/EstatusBadge.tsx(13,14): error TS2741: Property 'ayuda_tienda' is missing … ORDER_STATUS_LABELS
app/(app)/ordenes/_components/EstatusBadge.tsx(51,7):  error TS2741: Property 'ayuda_tienda' is missing … ORDER_STATUS_VARIANT
lib/types/rastreo-publico.ts(101,12):                  error TS1360: … does not satisfy … HITO_POR_ESTATUS
```

(+ las copias a mano de esos mapas en `EstatusLabel.test.ts`, `rastreo-hitos-exhaustivo.guardia.test.ts`
y `buckets-estatus.test.ts`, que es su función).

`TRANSICIONES` **no** apareció en esa lista porque `satisfies Record<OrderStatusValue, …>` rompe al
faltar la **clave**, y la clave se añadió en el mismo commit que el value. La exhaustividad de las
aristas la sostiene el test `235/R12: las salidas de `ayuda_tienda` son EXACTAMENTE esas dos`.

---

## 5 · Salida real de la verificación

`./init.sh` **no** se corrió: lo corre el leader con el árbol quieto.

```
$ npx tsc --noEmit
typecheck exit=0        (sin salida)

$ npx eslint
lint exit=0
✖ 92 problems (0 errors, 92 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.
```

Las 92 son **warnings preexistentes** de `@typescript-eslint/no-unused-vars` sobre parámetros con
prefijo `_` en dobles de test; las 3 nuevas (`_input` en los dobles de `transicionarAyuda`) siguen
esa misma convención del repo.

```
$ npx vitest run
 Test Files  1190 passed (1190)
      Tests  15420 passed | 26 skipped (15446)
   Duration  308.85s
exit=0
```

```
$ npx vitest run tests/unit/guards/
      Tests  818 passed (818)
```

```
$ npx vitest run tests/integration/db
      Tests  1375 passed (1375)
```

---

## 6 · Las mutaciones — cinco, con hash antes y después

Cada una: hash del archivo → mutación → tests que **mueren, nombrados** → revert → hash idéntico.

### (a) La orden en ayuda **sale del optimizador de ruta**

`lib/repositories/OrdenRepository.ts`

| | sha256 |
| --- | --- |
| antes | `a3b5c121fc1d01c817a1d2a53b207530feb2e163049ceebdbf2e37882c82f6fb` |
| mutado | `0120eef5746d5e1817dad8d3470e1da624a479c250a81ce2b32bab2761a472bb` |
| después de revertir | `a3b5c121fc1d01c817a1d2a53b207530feb2e163049ceebdbf2e37882c82f6fb` ✅ |

Mutación: `estatus: { value: ESTATUS_EN_REPARTO }` → `{ value: { in: [ESTATUS_EN_REPARTO, ESTATUS_AYUDA] } }`.

**Murieron 3:**
- `239/R25(a): las PARADAS de ruta salen SOLO de `en_reparto``
- `235/R14(a): `findParadasEnReparto` acota por IGUALDAD a `en_reparto` — un `in` la colaria`
- `235/R14(a): el predicado, aplicado a filas, DEJA FUERA la del mensajero que pidio ayuda`

Tras revertir: `Tests 38 passed`.

### (a2) …y **del mapa**

`app/(app)/mis-asignaciones/_components/RepartoModule.tsx`

| | sha256 |
| --- | --- |
| antes | `36f7b656c500f7a0a8658a6a524b717cae9982d36968bb359a71fb010367c941` |
| mutado | `a427f03d39bb819f976ced9f1957e6382e38f389f5462843c45cf49d43873822` |
| después | `36f7b656c500f7a0a8658a6a524b717cae9982d36968bb359a71fb010367c941` ✅ |

Mutación: `paradasMapa` deriva de `[...porGestionarFiltrado, ...conAyuda]`.

**Murió 1:** `235/R15: NO llega al mapa de ruta — la parada desaparece, no solo su card`
(`expected [ 'g1', 'g2' ] to deeply equal [ 'g1' ]`). Tras revertir: `Tests 14 passed`.

### (b) El bloqueo del cierre es **explícito**, no accidental

`lib/services/CierreDiaService.ts`

| | sha256 |
| --- | --- |
| antes | `9c12b1e23c4124cc3284ef1e406466c640ae9b886ba5c62eda8ae52e491c979c` |
| mutado (b) | `a089689791ce44f776a30ad1f537dace12f8edc70ab1971338b9dd0809c72dc7` |
| mutado (b2) | `9a90eb455ed6cabf37544f84ca0fca7aa852137202a4b963298fa545110d31a6` |
| después | `9c12b1e23c4124cc3284ef1e406466c640ae9b886ba5c62eda8ae52e491c979c` ✅ |

**(b)** `ESTADOS_PENDIENTES` pierde `"ayuda_tienda"` → **murieron 2**:
`R23: la lista de estados pendientes NOMBRA `ayuda_tienda`` y
`R2: resuelve gestiones/conteo/historico SIEMPRE por el usuarioId del actor`.

**(b2) — las dos rutas exentas.** Se «arregló» la exención aplicando la precondición de pendientes a
`vencido → solicitado` y a `rechazado → solicitado` → **murieron 4**:
- `235/R24: con un cierre `vencido` y una orden en `ayuda_tienda`, transiciona a `solicitado``
- `235/R24: el gemelo para `rechazado` — misma exencion, mismo motivo`
- `111/R9 (anti-deadlock): con un vencido + órdenes pendientes -> transiciona igual…`
- `109/R28: EXENTO de la precondición de pendientes (anti-deadlock)…`

Tras revertir: `Tests 111 passed`.

### (c) La excepción del webhook **no se puede ampliar**

`lib/types/webhook-eventos.ts`

| | sha256 |
| --- | --- |
| antes | `1381ed66749ebb2c64f6825ed53371eafd4462ddba6517dcbcb4627966ece668` |
| mutado | `227a2c9370a9864accfe19912fcb25392924ddbd1b91db78e2e7dd1a3c378413` |
| después | `1381ed66749ebb2c64f6825ed53371eafd4462ddba6517dcbcb4627966ece668` ✅ |

Mutación: `ORIGENES_SIN_EVENTO_PUBLICO` gana `"liberacion_reprogramada"` → **murieron 3**:
- `la lista de familias exceptuadas es EXACTAMENTE `rescate_ayuda_tienda``
- `REINGRESO LEGITIMO a `en_reparto` via `liberacion_reprogramada`: SIGUE emitiendo…`
- `MISMA orden, MISMO estado destino, OTRA familia: `liberacion_reprogramada` SI encola`

**(c2) — la otra dirección del mismo riesgo.** Se implementó la excepción **por estado** (el emisor
vuelve a `esEventoPublico(estado)` e ignora la familia) → **murieron 2**:
- ``ayuda_tienda -> en_reparto` via `rescate_ayuda_tienda`: NO encola nada`
- `en un LOTE mixto, solo cae la del rescate: la excepcion no contamina a sus vecinas`

Tras revertir las dos: `Tests 20 passed`.

### (d) El corte escribe el **origen real** por bloque (T7.3-ii)

`lib/repositories/CierreDiaRepository.ts`

| | sha256 |
| --- | --- |
| antes | `bdeaae4d94d94d4fbc1359763c77f35fb66c31e30726d4ca16bf8dc6c52b8759` |
| mutado | `639d672b4c22f97c8a680d64ad6a1e529ee6280bffb75fa9132d0dee5e74faf0` |
| después | `bdeaae4d94d94d4fbc1359763c77f35fb66c31e30726d4ca16bf8dc6c52b8759` ✅ |

Mutación: los dos bloques se unifican en un `estatusId: { in: [...] }` con **un solo append** que
supone `en_reparto` como origen → **murieron 6**, entre ellos el que importa:
`235/R27: cada append lleva el `estatusOrigenId` de SU bloque, no uno supuesto`.

### (e) Los KPI **de verdad** incluyen las de ayuda (T7.3-iii)

`lib/services/MisAsignacionesService.ts`

| | sha256 |
| --- | --- |
| antes | `8b2f0942d7f2d312a0e564821fa09dbc7320daaeddf23fcace8d53a465251127` |
| mutado | `ef91856d06071a0215ec26230d6fb22c7463a55a0db4c0e3b5d56a3f2dc601d8` |
| después | `8b2f0942d7f2d312a0e564821fa09dbc7320daaeddf23fcace8d53a465251127` ✅ |

Mutación: `enManoDelMensajero = porGestionar` → **murieron 2**:
`235/R20 (P7): una orden que pasa a `ayuda_tienda` NO cambia ninguno de los tres KPI` y
`235/R21: el COD de una gestionada hoy y el de una en ayuda NO se suman dos veces`.

**Autocomprobación:** las cinco mutaciones se aplicaron **una a una**, con `vitest` ejecutado en cada
una y su salida real leída; ninguna reportó «superviviente» sin haber corrido tests. Los seis hashes
posteriores coinciden con los previos, byte a byte.

---

## 7 · Consecuencia declarada para la **ficha 237** (design §8)

Su `status_note` afirma que «una orden en ayuda **bloquea** la solicitud de cierre, así que la gestión
de la tienda cae antes del snapshot». Eso es **cierto para la creación de un cierre nuevo** y **falso
para las dos rutas de re-solicitud** (`vencido → solicitado` y `rechazado → solicitado`), que están
exentas de la precondición por anti-deadlock (111/R9) y **siguen exentas** tras esta ficha (R24,
afirmado en test).

En esas dos rutas el cierre **ya existe** con sus gestiones vinculadas, así que una gestión de la
tienda posterior nace con `cierre_id = NULL` y **cae en el cierre siguiente**. No rompe dinero —cae
en un cierre, solo que en otro— pero **la 237 tiene que probarlo, no suponerlo**.

---

## 8 · Decisiones abiertas / lo que NO hice

1. **T0.1 — la medición contra producción está PENDIENTE** y **bloquea el despliegue**, no el código.
   El MCP de Supabase no está expuesto a este subagente. Ver §1.
2. **UI: hice más de lo que me toca, y hay que revisarlo.** Mi encargo era backend, pero retirar la
   columna **rompe el typecheck** en cinco componentes y dejarlos rotos habría hecho imposible
   entregar un árbol verde. Toqué:
   - **forzado por el tipo** (traducción literal, sin rediseño): `GestionarOrdenPanel`,
     `NovedadAcciones`, `NovedadesModule`, `reparto/page.tsx`;
   - **forzado + con decisión**: `RepartoModule` (borrado del corte de cliente, `conAyuda` por props,
     chat con la unión, card sin «Gestionar», mensaje de «todas con ayuda»);
   - **nuevo**: `HiloNotasAyudaModal.tsx` — lo escribí porque **R35** lo exige y sin él el mensajero
     tendría la ventana abierta y ningún sitio donde ejercerla. Es un calco del modal de la tienda
     sobre el mismo componente compartido, **sin estilos propios**.

   👉 **Un `frontend_dev` debería revisar el acabado visual** de la sección de ayuda y del modal
   (espaciados, variante del botón «Conversación», copy). La funcionalidad y sus tests están.
3. **`scripts/migrar-ayuda-a-estatus.ts` no existe**, a propósito: P6 midió el conjunto como vacío.
   Si la re-medición de T0.1 da distinto, **hay que escribirlo y correrlo antes** de la migración del
   retiro (design §9).
4. **T8.1 («ver la app») no se hizo.** No levanté el servidor ni recorrí las pantallas. Es la parte
   que la suite no cubre y que este repo ya midió como valiosa.
5. **T8.2 (documentación al día)**: no marqué como CERRADAS la «RECONCILIACIÓN DE R19» ni el «tapón
   con dueño» en `specs/239-devolucion-espera-cierre/`, ni anoté la auditoría. Las dos deudas **están
   cerradas en el código** (y así lo dicen los comentarios de `novedadWhere` y `ventana-hilo-notas`),
   pero los tres documentos siguen sin la nota fechada con el número de PR.
6. **Migraciones sin aplicar en local.** `prisma migrate status` dice que las tres están pendientes
   contra `localhost:5432`. No las apliqué para no mover la base bajo los pies de otra sesión; su
   reversibilidad está cubierta por lectura de fichero (`i/ayuda-tienda-migration.test.ts`), no por
   `db:migrate` + `db:rollback` reales — **eso queda por hacer** (T6.3).

---

## Veredicto

El estatus está entero y medido: 46/46 con test nombrado, typecheck y lint en 0 errores, 15.420 tests
verdes y cinco mutaciones que mueren donde deben — pero **no se despliega sin re-medir P6** y sin que
un frontend_dev pase por la UI que tuve que tocar.
