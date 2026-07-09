# Requisitos — ejemplo_health_check

> Ejemplo de referencia en notación EARS. El spec_author generará algo así por cada feature.

## Requisitos

- **R1 (ubicuo):** El sistema DEBE exponer un endpoint HTTP GET en `/api/health`.
- **R2 (por evento):** CUANDO se recibe una petición GET a `/api/health` y la
  conexión a Supabase responde correctamente, el sistema DEBE responder con
  estado HTTP 200 y un cuerpo JSON `{ "status": "ok", "db": "up" }`.
- **R3 (condicional):** SI la conexión a Supabase falla o excede el timeout,
  ENTONCES el sistema DEBE responder con estado HTTP 503 y cuerpo
  `{ "status": "degraded", "db": "down" }`.
- **R4 (ubicuo):** El endpoint NO DEBE exponer credenciales, cadenas de conexión
  ni detalles internos de error en la respuesta.

## Preguntas abiertas
- [ ] ¿El health check debe verificar también alguna cola/cron, o solo la DB?
