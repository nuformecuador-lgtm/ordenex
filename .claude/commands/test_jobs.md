---
description: Prueba los background jobs de la cola `jobs` ejecutando SOLO los tipos que elijas
argument-hint: "[tipo1,tipo2 | --listar] [--seco] [--limite=N] [--vueltas=N]"
allowed-tools: Bash(node --env-file=.env ./node_modules/tsx/dist/cli.mjs scripts/drenar-jobs.ts:*), PowerShell(node --env-file=.env ./node_modules/tsx/dist/cli.mjs scripts/drenar-jobs.ts:*), Read
---

Ejecuta el drenador manual y **selectivo** de la cola `jobs` (`scripts/drenar-jobs.ts`).

Argumentos recibidos: `$ARGUMENTS`

## Qué hacer

1. **Si no hay argumentos, o el usuario pidió `--listar`**: corre el inventario y muéstralo.

   ```
   node --env-file=.env ./node_modules/tsx/dist/cli.mjs scripts/drenar-jobs.ts --listar
   ```

   Presenta la tabla (tipo · estado · total · vencidos · próximo) y pregunta qué tipo quiere probar.
   **No drenes nada sin un tipo explícito.**

2. **Si el usuario nombró uno o varios tipos**: pásalos separados por comas a `--tipo=`.
   Los flags que el usuario haya escrito (`--seco`, `--limite=N`, `--vueltas=N`) van tal cual.

   ```
   node --env-file=.env ./node_modules/tsx/dist/cli.mjs scripts/drenar-jobs.ts --tipo=<tipos> [flags]
   ```

3. **Antes de drenar un tipo con efecto externo caro o irreversible**, corre primero con
   `--seco` (muestra cuántos se reclamarían, sin tocar nada), enseña el conteo y **pide
   confirmación**. Son caros/irreversibles:

   | Tipo | Efecto real al ejecutarse |
   |---|---|
   | `whatsapp_bienvenida` | manda un WhatsApp **al cliente final** |
   | `whatsapp_chat_envio` | manda un WhatsApp **al destinatario real** |
   | `whatsapp_template_sync` | crea/edita/borra plantillas en la cuenta de Meta |
   | `optimizacion_ruta` | llama a Google Routes — **cuota facturable** |
   | `geocodificacion` | llama a Google Geocoding — **cuota facturable** |
   | `webhook_estado` | POST firmado al callback del integrador suscrito |
   | `analitica_rollup_diario` | reescribe el rollup y es **recurrente** (se re-agenda) |

   `liberar_reprogramadas` y `analitica_invalidacion_cache` no salen a ninguna red.

4. **Reporta el resultado** con los conteos de `DrenarResult`
   (`procesados / ok / fallidos / reintentados / muertos`), el estado final de la cola y, si
   los hay, los `last_error` agrupados. **Interpreta los fallos, no los recites**: distingue
   un fallo del destino (un `HTTP 429` del sink, un timeout) de un fallo del código nuestro.
   `reintentados` ≠ perdidos: volvieron a `pending` con backoff exponencial y el cron los
   retomará. Solo `muertos` es dead-letter (`failed`, agotó `max_intentos`).

## Cómo funciona por dentro (para responder dudas sin releer el script)

- La cola es la tabla `jobs` (patrón **transactional outbox**): quien produce el evento
  inserta la fila **dentro de su misma transacción**, y un worker la drena aparte.
- En producción drena `GET /api/cron/procesar-jobs` (Vercel Cron, `* * * * *`), que reclama
  el lote **sin mirar el tipo**. Por eso existe este script: para probar un tipo sin
  arrastrar los demás pendientes de la cola local.
- El script **no reimplementa nada**: los handlers salen de `buildHandlers()` del propio
  route —un tipo nuevo registrado allí queda cubierto solo— y el ciclo
  claim → handler → complete / backoff / dead-letter es el `JobQueueService` real. Lo único
  propio es un decorador del repositorio cuyo `claimBatch` añade `tipo = ANY(tipos)`,
  conservando la misma sentencia (CTE + `FOR UPDATE SKIP LOCKED` + `intentos + 1`).
- **Guarda de host**: aborta si `DATABASE_URL` no es `localhost:5432/ordenex`. Si el usuario
  pide explícitamente correrlo contra otra base, existe `--host-remoto`; **no lo pases por tu
  cuenta**, solo si lo piden con esas palabras.
- El drenado repite vueltas hasta que una devuelve `procesados: 0` (tope `--vueltas`, 20 por
  defecto). Un job reintentado no vuelve a salir en la misma corrida: su `run_after` ya está
  en el futuro.
