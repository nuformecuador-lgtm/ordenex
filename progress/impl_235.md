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

## 1 · T0.1 — la medición de datos en vuelo: **CERRADA**

✅ **Re-medida por el leader el 2026-08-19 contra producción (MCP, solo lectura): 0 órdenes con
`orden.ayuda = true`.** Confirma la medición de la puerta humana y cierra **P6 como *grandfather***:
se retira la columna y **no hace falta script de datos**. Por eso `scripts/migrar-ayuda-a-estatus.ts`
no existe: escribirlo para un conjunto medido como vacío sería código sin caso.

Por qué no la hice yo, dicho para que quede el precedente: **el MCP de Supabase no está expuesto a un
subagente** (`.mcp.json` lo declara, pero la herramienta no llega), y `prisma migrate status` apunta
a `localhost:5432`. Un implementer no puede cerrar T0.1 por sí solo en este arnés.

⚠️ **La foto sigue caducando.** Si el despliegue se retrasa, se vuelve a medir. La consulta es
`SELECT count(*) FROM orden o JOIN order_status os ON os.id = o.estatus_id WHERE o.ayuda = true
GROUP BY os.value`. Si algún día no diera vacío, hace falta ese script **antes** de la migración del
retiro (design §9).

R43 queda cubierto además por su **propiedad estructural**, que no caduca: una orden en
`ayuda_tienda` la ve su tienda y tiene dos salidas (test nombrado en §3).

---

## 1.bis · La revisión rechazó la ficha: el barrido incompleto (B1/B2) y cómo se cerró

`progress/review_235.md` (commit **29310f74**) confirmó que el núcleo estaba bien —P4, las dos rutas
exentas y las dos deudas de la 239, con seis mutaciones propias del reviewer— y encontró que **lo que
falló fue el barrido**: dos consultas de una familia entera que esta ficha no miró.

### El censo de la familia — **7 listas**

La familia son las listas que responden **«¿qué ocupa a este mensajero?»** o **«¿a quién hay que
barrer?»**. No es la familia que T3.4 barrió (esa es «¿qué órdenes se ofrecen?»), y esa distinción es
justo lo que se coló.

| # | Lista | Archivo | Pregunta | Estado antes de la revisión |
| --- | --- | --- | --- | --- |
| 1 | `ESTADOS_PENDIENTES` | `lib/services/CierreDiaService.ts` | qué ocupa | ✅ migrada (R22/R23) |
| 2 | corte del portal (`findMisAsignaciones`) | `lib/services/MisAsignacionesService.ts` | qué ocupa | ✅ migrada (R18) |
| 3 | ids que resuelve el corte | `lib/services/CorteDiarioService.ts` | a quién barrer | ✅ migrada (R26) |
| 4 | **`ESTADOS_A_BARRER`** (era `ESTADO_EN_REPARTO`) | `lib/repositories/CorteDiarioRepository.ts` | a quién barrer | ❌ **B1 — sin migrar** |
| 5 | **`ESTADOS_REPARTO_PENDIENTE`** | `lib/services/GuiaAsignacionService.ts` | qué ocupa | ❌ **B2 — sin migrar** |
| 6 | **`conRepartoIds`** (gemelo de interfaz de la 5) | `lib/actions/ordenes-guia.ts` | qué ocupa | ❌ **B2 — sin migrar** |
| 7 | **`ESTADOS_EN_MANO_DEL_MENSAJERO`** (era `!= en_reparto`) | `lib/repositories/GestionOrdenRepository.ts` | qué ocupa | ⚠️ **red latente** (ver abajo) |

**Descartadas del censo, con su razón** (para que no parezcan olvidos):

- `RankingRepository.contarAsignadasPorMensajero` — cuenta por `asignadoAt`, es **agnóstica al
  estatus**: no puede quedarse atrás.
- `findMensajerosBloqueados`, `findZonasConMensajeroBloqueado`, `existeBodegaSateliteBloqueada` —
  derivan de **cierres**, no de estados de orden.
- `findRecepcionSateliteByZona` / `…GeoByZona` — listan **órdenes por zona**: son la otra familia, la
  que T3.4 sí barrió (y su lista blanca ya decidió que `ayuda_tienda` no entra).
- `ESTADOS_RECOLECCION_PENDIENTE` (`GuiaAsignacionService`) — **sí es de la familia**, pero su
  contenido (`recolectando`) no cambia: `ayuda_tienda` no es una recolección. Queda vigilada por la
  guardia igualmente, por el cruce de gemelos.
- Los crons `liberar-reprogramadas`, `procesar-devueltas-sla`, `snapshot-ranking` y
  `RechazosSlaTiendaService` — ninguno enumera ocupación de mensajero (`grep` sobre los cuatro: cero
  coincidencias de `en_reparto` / `mensajero`).

### El hallazgo nº 7, que la revisión no pidió y salió del censo

`gestionadasDelDiaWhere` excluía **solo** `en_reparto` para mantener disjuntos los dos sumandos de
`totalACobrar` (R21). Desde esta ficha el otro sumando se calcula sobre `porGestionar ∪ conAyuda`, así
que la **red** se quedó cubriendo la mitad del conjunto que debía.

**¿Había doble conteo vivo? No** — y conviene dejarlo escrito para que nadie deshaga el cambio: para
tener una gestión VIGENTE de hoy y estar además en `ayuda_tienda` habría que volver a `en_reparto`
después de gestionar, y el único camino que hace eso es `deshacerGestion`, que **anula** la gestión;
`gestionDelDia` exige `anuladaAt: null`. El conjunto era vacío **por alcanzabilidad**.

Se amplió igualmente a `notIn: ["en_reparto", "ayuda_tienda"]` porque «vacío hoy» es justo el
argumento que ese `where` dice no querer usar: su propio comentario explica que la exclusión vive en
la query «para que ningún llamador futuro pueda combinarlos mal» — y **la ficha 237 abre aristas
desde `ayuda_tienda`**.

### La guardia que impide la tercera vez

`tests/unit/guards/carga-del-mensajero.guardia.test.ts` (**16 casos**). Censa las **siete** listas
leyéndolas **del texto fuente** (tres son `const` privadas de módulo y tres son literales en el sitio
de la llamada; importarlas la volvería un espejo de sí misma), y exige:

1. que cada una **declare su decisión** sobre `ayuda_tienda`, con la razón en el mensaje del fallo;
2. que los **gemelos** no puedan separarse — servicio ↔ selector, selección del corte ↔ ids que el
   service resuelve, portal ↔ bloqueo del cierre;
3. los **casos negativos**: `por_recoger` no se barre (109/R5) y ningún desenlace ocupa a nadie;
4. **autocomprobación**: cada extractor revienta con nombre si su patrón deja de casar, y devuelve lo
   mutado sobre un fuente sintético.

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

### El arreglo de la revisión (B1/B2, 2026-08-19)

| Archivo | Qué cambia |
| --- | --- |
| `lib/repositories/CorteDiarioRepository.ts` | `ESTADO_EN_REPARTO` → **`ESTADOS_A_BARRER`** (`in`, unión) en la rama (b) de `findMensajerosConActividadSinCierre` |
| `lib/services/GuiaAsignacionService.ts` | `ESTADOS_REPARTO_PENDIENTE` gana `ayuda_tienda` |
| `lib/actions/ordenes-guia.ts` | el gemelo del selector (`conRepartoIds`) gana `ayuda_tienda` |
| `lib/repositories/GestionOrdenRepository.ts` | `!= en_reparto` → **`notIn ESTADOS_EN_MANO_DEL_MENSAJERO`** (red de R21) |
| `tests/unit/services/corte-diario-seleccion.test.ts` | **nuevo**: el corte medido **desde `ejecutarCorte`**, con el repositorio REAL sobre un doble de Prisma con semántica |
| `tests/unit/guards/carga-del-mensajero.guardia.test.ts` | **nuevo**: censo de las 7 listas de la familia + cruce de gemelos + autocomprobación |
| `tests/unit/repositories/corte-diario-repository.test.ts` | el `where` con los dos estados, aplicado a filas, con su caso negativo |
| `tests/unit/services/guia-asignacion-service.test.ts` | la orden en ayuda ocupa, con su caso negativo |
| `tests/integration/actions/ordenes-guia-action.test.ts` | el selector pregunta por los tres estados y marca al mensajero |
| `tests/unit/repositories/gestion-orden-repository.test.ts` | la red de R21 con los dos values, aplicada a filas |

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
| R17 | `u/repositories/orden-repository.test.ts` | `R17(b): el GRAFO no ofrece salida de `ayuda_tienda` hacia asignacion, ruteo ni recoleccion` · **+ (B2)** `u/services/guia-asignacion-service.test.ts::235: no se le asigna una recoleccion a quien tiene una orden en `ayuda_tienda`` |
| R18 | `u/services/mis-asignaciones-service.test.ts` | `R18: las de ayuda salen en `conAyuda` y NO en `porGestionar`` |
| R19 | `c/RepartoAyuda.test.tsx` | `235/R19: la card conserva «Recuperar», que es la salida de vuelta` |
| R20 | `u/services/mis-asignaciones-service.test.ts` | `R20 (P7): una orden que pasa a `ayuda_tienda` NO cambia ninguno de los tres KPI` |
| R21 | `u/services/mis-asignaciones-service.test.ts` | `R21: el COD de una gestionada hoy y el de una en ayuda NO se suman dos veces` · **+ (red)** `u/repositories/gestion-orden-repository.test.ts::235/R21: el predicado deja fuera `en_reparto` Y `ayuda_tienda`, y deja dentro los desenlaces` |
| R22 | `u/services/cierre-dia-service.test.ts` | `R22: con una orden en `ayuda_tienda`, `solicitarCierre` devuelve conflict con motivo accionable` |
| R23 | `u/services/cierre-dia-service.test.ts` | `R23: la lista de estados pendientes NOMBRA `ayuda_tienda`` |
| R24 | `u/services/cierre-dia-service.test.ts` | `R24: con un cierre `vencido` y una orden en `ayuda_tienda`, transiciona a `solicitado`` (+ gemelo `rechazado`) |
| R25 | `u/services/solicitud-ayuda-service.test.ts` | `235/R25: un mensajero BLOQUEADO por un cierre sin resolver PUEDE pedir ayuda` (+ `R25` en `rescate-ayuda-service`) |
| R26 | `u/services/corte-diario-seleccion.test.ts` | `le CREA su cierre `vencido` y le pasa los ids del barrido (EL CASO DE LA REGRESION)` — **desde `ejecutarCorte`**, que es donde fallaba · (escritura) `u/repositories/cierre-dia-repository.test.ts::235/R26: barre las de `en_reparto` Y las de `ayuda_tienda` en la MISMA transaccion` |
| R27 | `u/repositories/cierre-dia-repository.test.ts` | `235/R27: cada append lleva el `estatusOrigenId` de SU bloque, no uno supuesto` |
| R28 | `u/repositories/cierre-dia-repository.test.ts` | `235/R28 (MONEY-NEUTRAL): el `data` del bloque de ayuda toca SOLO `estatusId`` |
| R29 | `u/guards/ayuda-columna-retirada.guardia.test.ts` | `ningun modulo de codigo la usa (censo sobre fuente sin comentarios)` — tras el corte no queda señal que apagar porque no queda marca. **El menor m8 queda cerrado con B1**: ahora el corte SÍ alcanza a esas órdenes |
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

**Medición final (2026-08-19, tras cerrar B1/B2/B4):**

```
$ npx tsc --noEmit
typecheck exit=0        (sin salida)

$ npx eslint
lint exit=0
✖ 93 problems (0 errors, 93 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.
```

Las 93 son **warnings preexistentes** de `@typescript-eslint/no-unused-vars` sobre parámetros con
prefijo `_` en dobles de test; las 4 nuevas (`_input` en los dobles de `transicionarAyuda` y de
`crearCierre`) siguen esa misma convención del repo. **Cero errores.**

```
$ npx vitest run
 Test Files  1192 passed (1192)
      Tests  15449 passed | 26 skipped (15475)
   Duration  309.56s
exit=0
```

(Antes del arreglo de la revisión: 1190 archivos / 15.420 tests. **+2 archivos, +29 casos**, todos
del cierre de B1/B2 y de la guardia de la familia.)

```
$ npx vitest run tests/unit/guards/
      Tests  834 passed (834)      # 818 + los 16 de `carga-del-mensajero`
```

```
$ npx vitest run tests/integration/db
      Tests  1375 passed (1375)
```

---

## 6 · Las mutaciones — ocho, con hash antes y después

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

### (f) B1 — la SELECCIÓN del corte, medida **desde `ejecutarCorte`**

`lib/repositories/CorteDiarioRepository.ts`

| | sha256 |
| --- | --- |
| antes | `72003baab2d69c4637570528d5baf47b7c20a5358b4a3b65e4c06386b9db7d6b` |
| mutado | `980aacaf4b6be96eafc290895b6f473c0b83ebe721aa73aa541bb7e5f0b199d6` |
| después | `72003baab2d69c4637570528d5baf47b7c20a5358b4a3b65e4c06386b9db7d6b` ✅ |

Mutación: `estatus: { value: { in: ESTADOS_A_BARRER } }` → `{ value: ESTADOS_A_BARRER[0] }`, es decir,
**el estado exacto en el que estaba el bug**.

**Murieron 2 al nivel que la revisión exigía** (`corte-diario-seleccion.test.ts`, que entra por
`ejecutarCorte` con el repositorio REAL):

- `le CREA su cierre `vencido` y le pasa los ids del barrido (EL CASO DE LA REGRESION)` —
  `expected { mensajerosEvaluados: 0, … } to deeply equal { mensajerosEvaluados: 1, … }`. **Cero
  mensajeros evaluados: exactamente el fallo, visto desde donde se veía.**
- `los dos a la vez: dos mensajeros, dos cierres` — `expected 1 to be 2`.

Y **2 más** en los otros dos niveles, que es lo que hace que el arreglo no se pueda deshacer por
ningún lado: `R4: incluye mensajeros con >=1 orden en `en_reparto` no borrada` y
`235/R26: el predicado, aplicado a filas, pesca `en_reparto` Y `ayuda_tienda` y deja fuera el resto`.

### (g) B2 — la regla de dedicación

`lib/services/GuiaAsignacionService.ts`

| | sha256 |
| --- | --- |
| antes | `4e9c0f7d62c8ef4c37d5b1d45db703c6802cf65b476a7ab88ffbe039d1f965a8` |
| mutado | `704cf1e5932b92be1e12c022df9c7dd0cc1e1c299bc274d40f6f90f97f4749fb` |
| después | `4e9c0f7d62c8ef4c37d5b1d45db703c6802cf65b476a7ab88ffbe039d1f965a8` ✅ |

Mutación: `ESTADOS_REPARTO_PENDIENTE` pierde `"ayuda_tienda"`. **Murieron 4**:

- `235: no se le asigna una recoleccion a quien tiene una orden en `ayuda_tienda`` (el de negocio)
- `pregunta EXACTAMENTE por los estados de reparto, no por otras recolecciones`
- `la regla de dedicación de la 157 (`ESTADOS_REPARTO_PENDIENTE`) incluye `ayuda_tienda`` (guardia)
- `regla de dedicación: el SERVICIO y el MARCADOR del selector piden los mismos estatus` (gemelos)

### (h) B2' — solo el GEMELO del selector, para probar que el cruce vigila

`lib/actions/ordenes-guia.ts`

| | sha256 |
| --- | --- |
| antes | `67d80e3f6c423bdb5d17310442d1fef21d58b488698ddf34622c8d6fd50a7064` |
| mutado | `9d680d9308b31acb0521cb513a7fb44a8b67722d42ca9c8f17bb1c5d4df0efb0` |
| después | `67d80e3f6c423bdb5d17310442d1fef21d58b488698ddf34622c8d6fd50a7064` ✅ |

Mutación: solo la lista del selector pierde `"ayuda_tienda"`, dejando el servicio correcto — la
divergencia de gemelos que produce «el selector deja elegir a quien el servidor rechaza».
**Murieron 4**, incluidos los dos de la guardia:
`el marcador del selector del maestro (`conRepartoIds`) incluye `ayuda_tienda`` y
`regla de dedicación: el SERVICIO y el MARCADOR del selector piden los mismos estatus`.

**Autocomprobación:** las ocho mutaciones se aplicaron **una a una**, con `vitest` ejecutado en cada
una y su salida real leída; ninguna reportó «superviviente» sin haber corrido tests. Los nueve hashes
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

1. **T0.3 — el orden de mergeo 235 → 236 → 240 sigue sin anotar** en `progress/current.md` (censado:
   ninguna línea lo fija). Es decisión del leader; P10 la dejó «pendiente de confirmar». No bloquea
   código, sí la nota de cierre.
2. **T8.1 — «ver la app» NO se hizo.** Es la parte que la suite no cubre y esta ficha reescribió 8
   archivos de `app/` más un componente nuevo. La asume el leader.
3. **T8.3 — el gate completo y el PR** los corre el leader con el árbol quieto. Yo corrí `tsc`,
   `eslint` y la suite entera (§5) y **no** ejecuté `./init.sh`.
4. **UI: hice más de lo que me toca, y hay que revisarlo.** Retirar la columna rompe el typecheck en
   cinco componentes. Toqué:
   - **forzado por el tipo** (traducción literal, sin rediseño): `GestionarOrdenPanel`,
     `NovedadAcciones`, `NovedadesModule`, `reparto/page.tsx`;
   - **forzado + con decisión**: `RepartoModule` (borrado del corte de cliente, `conAyuda` por props,
     chat con la unión, card sin «Gestionar», mensaje de «todas con ayuda»);
   - **nuevo**: `HiloNotasAyudaModal.tsx`, porque **R35** lo exige del lado mensajero.

   👉 **Un `frontend_dev` debería revisar el acabado.** La revisión anotó además dos menores que NO
   arreglé porque son decisiones de producto, no defectos de implementación: **m2** — la sección de
   ayuda quedó fuera del buscador y del filtro cantón/distrito (antes se derivaba de la lista ya
   filtrada); y **m4** — `RecuperarAyudaButton` sigue `disabled={bloqueado}`, así que la UI le niega
   al mensajero bloqueado el rescate que R25 le concede en el servicio. Las dos son visibles y
   baratas; ninguna es mía de decidir.
5. **B3 (R35 del lado tienda) no es mío.** El leader reconcilia el requisito en el spec: el propio
   `requirements.md` se contradecía —«fuera de alcance» difiere la lectura del hilo de la tienda a la
   236 mientras R35 la exige aquí—.
6. **Migraciones aplicadas y revertidas contra el motor por el leader** (T6.3). Yo no las apliqué en
   local para no mover la base bajo otra sesión; su reversibilidad está además cubierta por lectura
   de fichero (`tests/integration/db/ayuda-tienda-migration.test.ts`).
7. **T8.2 está hecha** (los tres documentos llevan su nota fechada); falta solo el número de PR, que
   no existe hasta que el leader lo abra.

---

## Veredicto

El estatus está entero y medido, y las dos listas que el barrido se dejó —el corte de la noche y la
regla de dedicación— están cerradas con su mutación y con una guardia que censa la familia completa
para que no haya una tercera. Queda fuera de mi alcance ver la app (T8.1), el gate y el PR (T8.3), y
el acabado de la UI que tuve que tocar.
