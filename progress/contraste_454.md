# 454 — Contraste historico (T3.1) y poblacion legada (T3.3)

> Rama `feature/454-contraste`, nacida de `186d5e19` (backend de la 454 cerrado). Verificacion
> INDEPENDIENTE: no toca `lib/`, `app/` ni `db/`. Archivos: `scripts/contraste-454.sql`,
> `scripts/contraste-454.ts` y este informe.
>
> Busqueda de codigo: MCP `codebase-memory` (`R-job-singularis-projects-ordenex`) con `search_graph`
> para `whereIntentosVigentes`/`resolverCierre`/`crearCierre`. El indice esta RANCIO para la 454
> (seguia mostrando `anclajeDevolucion` en `resolverCierre`), asi que cada pieza del simulador se leyo
> en el archivo real de la rama: `CierresAdminRepository.resolverCierre` (aplicacion, tope 276,
> seleccion 139), `OrdenHistorialRepository.whereIntentosVigentes`, `CierreDiaRepository.crearCierre`
> (corte), `DevolucionSlaRepository`/`DevolucionSlaService` (ancla y decision SLA),
> `LiberacionReprogramadaRepository`/`Service` (`puedeLiberarse`), los cinco feeds
> (`WalletFeedService`, `WalletTiendaFeedService`, `CajaCodFeedService`, `WalletMensajeroFeedService`,
> `WalletIndemnizacionFeedService`) y `lib/utils/ingreso-ordenex.ts`, `cierre-detalle.ts`,
> `cuenta-por-pagar.ts`. `grep` solo para `db/schema.prisma`, `specs/` y `progress/`.

## Como se corre

- **Produccion** (lo corre el leader): pegar `scripts/contraste-454.sql` ENTERO en `execute_sql` del MCP
  de Supabase. Es UNA sentencia `WITH … SELECT` de solo lectura (ningun CTE escribe, sin funciones
  volatiles, sin `now()`). Solo usa tablas que produccion ya tiene: `cierre_dia`, `gestion_orden`,
  `orden_historial_estado`, `order_status`, `orden`, `cierre_sin_gestion`, `cierre_detail`,
  `wallet_movimiento`, `wallet_tienda_movimiento`, `pago_mensajero_movimiento`. Nada de la 454
  (`orden_evento`, M1-M3) ni de SF-001. Los enums se comparan como `::text`, asi que un valor que
  produccion no tuviera no rompe la sentencia.
- **Local**: `node --env-file=.env ./node_modules/tsx/dist/cli.mjs scripts/contraste-454.ts [--desde=AAAA-MM-DD] [--json]`
  — misma sentencia en una transaccion `SET TRANSACTION READ ONLY` (Postgres rechaza cualquier
  escritura) + dos consultas solo-local (P0 y T3.3 con `orden_evento`). Guarda de host: aborta si
  `DATABASE_URL` no es `localhost:5432/ordenex`.
- **Autocomprobacion**: `… scripts/contraste-454.ts --autocomprobacion` (ver abajo).

Parametros (CTE `params`): `desde = 2026-08-25`, `umbral = 3` (`REINTENTOS_MIN_INTENTOS`),
`horas_not_found = 24`, `dias_wrong = 5` (defectos de `lib/config/*`). **Si produccion tiene esas
variables de entorno con otro valor, hay que cambiarlos antes de correr** (no se pudo medir aqui).

## Que compara cada bloque (resumen; el detalle esta en los comentarios del SQL)

Proxy de «gestion de calle» (en produccion no hay eventos): gestion SIN fila de historial enlazada de
las cuatro familias sinteticas (`escalado_devuelta_sla`, `rechazo_tope_intentos`,
`reprogramacion_tienda`, `rechazo_tienda`) y con `motivo` distinto del literal del tope. El proxy se
valida en local contra el evento real (P0).

| K | Poblacion | Diferencia |
|---|---|---|
| K1 aplicacion | gestiones de calle vigentes de cierres aprobados desde `desde` | destino nuevo (resultado, solo si es la de calle vigente mas reciente de la orden AL APROBAR y la orden no estaba borrada) ≠ destino de la ultima transicion enlazada real (`devolucion_por_confirmar`→`devuelta`; anclaje y #69 cuentan) |
| K2 intentos | ordenes con gestiones en esos cierres | conteo con la 6.ª condicion vieja (visita real enlazada) ≠ nueva (visita real O calle) |
| K3 tope | filas de `cierre_sin_gestion` de cierres aprobados | decision nueva (estado al aprobar + intentos nuevos en ese instante vs umbral) ≠ la ocurrida (`rechazo_tope_intentos`/`liberacion_sin_gestionar` en [-1 min, +10 min] de `resuelto_at`) |
| K4a | cierres aprobados | `SUM(ingreso_bodega_rechazo)` ≠ `total_ingreso_bodega_rechazos`, o una no-`rechazada` con ingreso > 0 |
| K4b | = K3 | sinteticas de tope creadas vs las que crearia la logica nueva (con el ingreso ya cobrado en la nota) |
| K4c | = K7b | escalados SLA ocurridos vs los que crearia el cron nuevo |
| K5a | barridas (`cierre_sin_gestion`) desde `desde` | la orden tenia en el instante del corte una gestion de calle PENDIENTE (la logica nueva no la barreria) |
| K5b | pares (corte, orden gestionada por su mensajero en las 36 h previas y NO barrida) | la gestion ni estaba pendiente ni se habria aplicado al aprobar su cierre (la logica nueva SI la barreria) |
| K6 | `devolucion_rechazada` | la seleccion nueva la excluiria (su `rechazada` vigente mas reciente estaba en OTRO cierre no aprobado entonces) |
| K7a | `liberacion_reprogramada` | no elegible con la regla nueva en ese instante (fecha ≤ hoy CR y (sintetica sin visita) o (cierre aprobado)) |
| K7b | `liberacion_devuelta_sla`/`escalado_devuelta_sla` | decision del cron nuevo (ancla = aprobacion del cierre de la `devuelta` de calle, intentos nuevos, 24 h / 5 d, tope) ≠ la ocurrida, o ancla movida > 5 min |
| K8a-e dinero | cierres aprobados | recalculo desde `gestion_orden` + `cierre_detail` (lo unico que leen los feeds) ≠ movimientos emitidos: 42 ingresos, 43 ledger por tienda, 173 caja COD, 44 pago al mensajero (+ P = Σ pago_mensajero), 158 indemnizacion. Tolerancia 0,00 |
| T3.3 | gestiones vivas no anuladas con cierre no aprobado o sin cierre | (numero, no diferencia). En produccion no existe `orden_evento`: TODAS son legadas |

## Resultados LOCALES (datos de prueba — el numero que importa es el de produccion)

La base local es compartida y sus datos son de prueba sembrados a mano; ademas termina el 2026-08-21.

**Con la ventana de produccion (`desde = 2026-08-25`)**: todos los K con `total_evaluado = 0` y
`diferencias = 0` (no hay cierres locales aprobados despues de esa fecha). T3.3 = 18. P0 = 1 evaluado,
0 diferencias. T3.3 local con el filtro de evento = 17 (+1 gestion del modelo nuevo viva, la que M3
creo al migrar la unica orden local en `devolucion_por_confirmar`).

**Con la ventana abierta (`--desde=2000-01-01`)**, para que los K tengan poblacion:

| K | evaluado | diferencias |
|---|---|---|
| K1 | 20 | 10 |
| K2 | 15 | 0 |
| K3 | 0 | 0 |
| K4a | 6 | 0 |
| K4b | 0 | 0 |
| K4c | 0 | 0 |
| K5a | 0 | 0 |
| K5b | 0 | 0 |
| K6 | 2 | 0 |
| K7a | 2 | 2 |
| K7b | 0 | 0 |
| K8a | 6 | 3 |
| K8b | 6 | 3 |
| K8c | 6 | 0 |
| K8d | 6 | 2 |
| K8e | 6 | 1 |
| T3.3 | 18 | — (de calle 18; entregada 12, reprogramada 2, devuelta 2, rechazada 1, incidente 1) |
| P0 | 1 | 0 |

### Explicacion fila a fila (local)

TODAS las diferencias locales salen de TRES manipulaciones a mano de los datos de prueba, ninguna de la
logica. La evidencia se leyo en la base (consultas de solo lectura):

1. **El `resultado` de 9 gestiones se reescribio despues de aprobarse su cierre, sin historial.**
   `34d1a4c7`, `4db1d9ca`, `6b6fa56f`, `c3cadd03`, `e46d304f`, `edc48391` (cierre `70ebf5e2`) y
   `39dec5dc`, `48c66aeb` (cierre `942993c5`) dicen `reprogramada`, y `05d95559` dice `incidente`, pero
   su UNICA transicion enlazada (familia `gestion`) lleva la orden a `entregada`, tienen
   `pago_mensajero = 1700.00` (el `cobroEntregado`: `derivarPagos` da 0 a todo lo que no es `entregada`)
   y `monto_recibido > 0`. Una correccion real (#69) dejaria una fila `correccion_resultado_gestion`, y
   no la hay. → **K1: 9 filas.** → **K8a/K8b: `942993c5`** (esperado 0 porque ya «no hay entregadas»,
   emitido 5 164,67 / 21 464,67).
2. **El `resuelto_at` del cierre `70ebf5e2` se reescribio del 2026-08-12 al 2026-08-20.** Sus
   movimientos de wallet tienen `created_at = 2026-08-12 17:56:35`, ANTERIOR a su `resuelto_at`
   (`2026-08-20 00:02:14`): un feed no puede emitir antes de aprobar. Consecuencias:
   - **K1 `b70d67f0`** (orden `f6ad3c3f`): en el `resuelto_at` falso ya existia `c3cadd03` (08-13), mas
     reciente → «no se aplicaria» (nuevo `-`, real `reprogramada`). Con el instante real (08-12) seria la
     mas reciente y coincidiria. Es la clase «dos gestiones vivas» que el design anticipa.
   - **K7a `619fa711`, `b9a3e93f`**: liberaciones del 2026-08-13 20:18 de ordenes cuya `reprogramada`
     (`b70d67f0`, `2eca6cbb`) es de `70ebf5e2`; con el `resuelto_at` falso el cierre «aun no estaba
     aprobado». Con el real, elegibles.
   - **K8a/K8b/K8e `70ebf5e2`**: ademas sus 12 filas de `cierre_detail` tienen `tarifa_id` NULL
     (esperado de ingresos 0 vs 18 468,16 emitidos) y su indemnizacion vigente (9 000) no es la que se
     emitio (12 500).
3. **La gestion `c3cadd03` (08-13 20:22) se re-vinculo del cierre `f4c93d88` al `70ebf5e2`.**
   `f4c93d88` quedo con 0 gestiones y P = 1 700; `70ebf5e2` con Σ pago_mensajero = 11 900 frente a
   P = 10 200. → **K8d: `70ebf5e2`, `f4c93d88`**; **K8a/K8b: `f4c93d88`** (0 esperado vs 2 754,38 /
   15 254,38). En los dos cierres el feed emitio EXACTAMENTE su snapshot P (devengo = egreso = P): el
   descuadre esta en el vinculo gestion→cierre, no en el dinero emitido.

Con datos coherentes ninguna de esas filas existe. Por eso el numero que decide es el de produccion.

## Autocomprobacion (un contraste que siempre da 0 no demuestra nada)

`contraste-454.ts --autocomprobacion` inyecta en el TEXTO de la consulta (marcadores `/*FIX:<tabla>*/`
al final de cada CTE `src_*`, `UNION ALL SELECT …` con tipos explicitos) un mundo ficticio en 2030 con
UNA diferencia sembrada por bloque, corre la sentencia con y sin fixtures en la misma transaccion READ
ONLY y exige, por bloque, **Δdiferencias = 1 Y que la muestra contenga el id sembrado** (T3.3: Δtotal =
5). Nada se escribe en la base. Las demas filas del fixture estan puestas para NO contaminar a los otros
bloques (p. ej. cada gestion con su `cierre_detail`, cada cierre con sus totales coherentes).

| K | caso sembrado (debe dar diferencia) | resultado |
|---|---|---|
| K1 | `g1` `entregada` cuya transicion real fue a `rechazada` | SI (`zz454-g1 nuevo=entregada real=rechazada`) |
| K2 | `g2` `devuelta` de calle con SOLO la fila `anclaje_devolucion` (lo que escribe el modelo nuevo) | SI (`viejo=0 nuevo=1`) |
| K3 | `o3` barrida en `c1`, 0 intentos, pero con `rechazo_tope_intentos` al aprobar | SI (`nuevo=bodega real=tope`) |
| K4a | `c2` aprobado con `total_ingreso_bodega_rechazos = 500` y ninguna gestion | SI |
| K4b | la sintetica del tope de `o3` | SI |
| K4c | el escalado de `o9` (ver K7b) | SI |
| K5a | `o5` barrida por el corte `c3` con `g5` de calle sin cierre creada antes | SI |
| K5b | `o6` no barrida por `c3`; su `g6` esta en `c4` aprobado antes del corte pero NO era la mas reciente al aprobar (`g6b`, anulada despues) | SI (`en_mano`) |
| K6 | `devolucion_rechazada` de `o7` con su `rechazada` en `c5` `solicitado` | SI |
| K7a | `liberacion_reprogramada` de `o8` con `reprogramada` de calle en `c5` sin aprobar | SI |
| K7b | `devuelta` `not_found` aprobada a las 10:00 y escalada a las 12:00 (ventana de 24 h viva) | SI (`nuevo=ninguna real=escalar`) |
| K8a | `c7`: ingresos esperados 1 000 + 130 de IVA, emitido solo el flete | SI |
| K8b | `c8`: `monto_recibido` 5 000, ledger `cod_recaudado` 4 000 | SI |
| K8c | `c9`: ledger 3 000, caja COD 2 500 | SI |
| K8d | `c10`: P = 1 700, egreso de caja 1 600 | SI |
| K8e | `c11`: `incidente` de 800 sin egreso | SI |
| T3.3 | 5 gestiones vivas nuevas (`g3s`, `g5`, `g7`, `g8`, `g9s`) | SI (18 → 23) |

Salida: `AUTOCOMPROBACION VERDE: cada bloque detecta su diferencia sembrada` (exit 0).

**El arnes se pone rojo** (medido, archivo restaurado byte a byte con `cmp` despues de cada una):
- K5a con su condicion de «pendiente» anulada (`WHERE FALSE AND (…)`) →
  `'K5a …' 0 0 … 'NO'` · `AUTOCOMPROBACION ROJA: 1 bloque(s)` (exit 1).
- K8c comparando el ledger contra si mismo (la caja leida de `src_wtm`) →
  `'K8c …' 'NO'` · `AUTOCOMPROBACION ROJA: 2 bloque(s)` (tambien cayo K5a, que iba mutado en la misma
  corrida). Medido sobre la primera version del SQL; el bloque K8c no cambio en la reescritura de
  rendimiento, y la mutacion de K5a se repitio sobre la version final (la linea de arriba).
- **Superviviente declarado**: quitar la segunda via (`k.calle OR`) SOLO del conteo de K7b NO lo pone
  rojo, porque el intento del fixture `o9` sale de la visita real. La segunda via la cubre K2 (su caso
  sembrado es exactamente una `devuelta` que solo cuenta por ella).

## Rendimiento (medido)

Primera version con subconsultas correlacionadas sobre CTE materializados: **~30 s con 2 000 ordenes
sinteticas** (K1 8,3 s, K5b 8,6 s). Reescrita con JOIN + `DISTINCT ON`/`GROUP BY` y `anclajes`
`MATERIALIZED`: **~9,6 s con 2 000 y ~11 s con 6 000 ordenes / 9 000 gestiones / 42 000 filas de
historial / 600 cierres** (volumen inyectado por los mismos marcadores, solo texto). Produccion (vaciada
el 2026-08-25) esta por debajo de ese volumen.

## Limites conocidos (para leer bien el numero de produccion)

- **Cambios de formula con fecha dentro de la ventana**: la 301 (2026-08-28) dejo de cobrar flete de
  devolucion a las `devuelta`. Un cierre aprobado antes de su despliegue con `devuelta` daria diferencia
  en K8a/K8b: se explica por fecha, no por la 454. Idem el tope 276 (K3, K7a) y el ancla de la 239 (K7b)
  si su despliegue fue posterior al 2026-08-25.
- K8b supone `WALLET_TIENDA_DEBITA_FLETE_DEVOLUCION = true` (defecto).
- La guarda de PROPIEDAD por mensajero de la liberacion/139 no se simula (la base no guarda el mensajero
  de una orden en un instante pasado). La asignacion del instante del tope/liberacion se casa por
  ventana temporal [-1 min, +10 min] alrededor de `resuelto_at`.
- K5b mira las gestiones de las 36 h previas al corte del mismo mensajero.

## PRODUCCION: lo corre el leader

> Pegar `scripts/contraste-454.sql` en el MCP de Supabase (`execute_sql`, solo lectura) y anotar aqui la
> tabla (k, total_evaluado, diferencias, muestra_ids, nota). Revisar antes los parametros de entorno
> (umbral y ventanas SLA). Cada diferencia distinta de 0 se explica fila a fila; K4* y K8* sin explicar
> son un FALLO.

| K | evaluado | diferencias | explicacion |
|---|---|---|---|
| (pendiente) | | | |

## Verificaciones

- `pnpm run typecheck` → `tsc --noEmit` sin errores (exit 0).
- `pnpm exec eslint scripts/contraste-454.ts` → sin salida (exit 0).
- `pnpm test`: no aplica — no hay codigo de produccion ni tests nuevos; la verificacion ejecutable de
  esta tarea es `--autocomprobacion` (verde) y su corrida roja con mutacion.

**Veredicto:** contraste y poblacion legada listos y autocomprobados en local (todos los K detectan su
caso sembrado; las diferencias locales son manipulaciones de datos de prueba explicadas fila a fila);
falta la corrida en produccion, que decide.
