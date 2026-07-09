# Diseño — ejemplo_health_check

## Enfoque
Route Handler de Next.js (App Router) en `app/api/health/route.ts` que ejecuta un
`SELECT 1` ligero contra Supabase con un timeout corto y traduce el resultado a
200 (ok) o 503 (degraded).

## Contrato
- `GET /api/health`
- 200 → `{ "status": "ok", "db": "up" }`
- 503 → `{ "status": "degraded", "db": "down" }`

## Datos
- No crea tablas. Usa un ping trivial (`select 1`) vía el cliente de Supabase del servidor.

## Timeout
- 2s. Si Supabase no responde en ese tiempo, se trata como caído (R3).

## Alternativa descartada
- **Verificar la salud consultando una tabla real de negocio.** Descartada: acopla
  el health check al esquema de dominio y puede dar falsos negativos si esa tabla
  cambia. Un `select 1` es agnóstico y suficiente para probar conectividad.

## Trazabilidad prevista
- R1, R2 → test de éxito (200). R3 → test con cliente mockeado que falla/timeout.
- R4 → test que verifica que el cuerpo de error no contiene secretos.
