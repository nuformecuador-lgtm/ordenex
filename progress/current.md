# Estado — cierre de sesión del 2026-09-10 (madrugada)

## Release desplegada y verificada en producción

**PR #769**, `prod` en **`a9d48f13`**, despliegue Vercel **READY comprobado** (no solo el PR
mergeado: se verificó que el build existe, cosa que ya falló una vez). Cuatro fichas:

| Ficha | PR | Qué cierra |
|---|---|---|
| **400** | #766 | un fallo de configuración del geocodificador ya no bloquea la asignación |
| **401** | #768 | la caída avisa (~75 min en vez de 19 h) y se recupera sola |
| **402** | #765 | la cola reparte el lote entre tipos: un tipo saturado ya no deja a los demás sin turno |
| **403** | #767 | un webhook que falla en racha se pausa, avisa y se recupera solo |

**Gate completo sobre `dev` con las cuatro dentro: `INIT_EXIT=0`, 1846 archivos, 26.782 tests,
26 saltados (ajenos y preexistentes), cero rojos nuevos.**

Verificado en producción tras el despliegue: las **4 migraciones aplicadas** (06:49 UTC), los enums
en 11 y 9 valores con los nuevos dentro, **T20 = CERO candidatas** (como estaba previsto),
`fallos_consecutivos = 0`, cola sin nada vencido y **cero errores de runtime nuevos** (el único
grupo que aparece es un aviso de deprecación preexistente desde el 27 de julio).

## ⚠️ LO PRIMERO QUE HAY QUE MIRAR

**Nadie ha visto la app funcionando con los mensajes nuevos.** Ningún agente pudo levantarla; se
renderizaron los modales y se volcó el DOM literal, pero el toast real —más de 180 caracteres— no
lo ha visto una persona. **Se cierra mirando producción**, y es la deuda declarada de la 400.

## El incidente que originó todo

El **2026-09-08 a las 19:40 UTC** la Geocoding API empezó a rechazar todo con `REQUEST_DENIED`.
**19 horas sin geocodificar una sola dirección, en silencio.** Lo detectó el humano porque no podía
asignar órdenes, leyendo «Dirección no encontrada» sobre direcciones que estaban bien: de 43 órdenes
represadas, **42 lo estaban por la credencial y solo 1 por una dirección irresoluble**.

Se rescató a mano (47 jobs resucitados contra la base de producción) y salieron tres fallos
encadenados más, todos cerrados en esta release. **El más caro de encontrar:** los reintentos de un
webhook contra `webhook.site` —una URL de PRUEBAS activa en producción desde el 28 de agosto—
dejaron media hora sin turno a la geocodificación **con la credencial ya arreglada**, mientras un
integrador real llevaba cinco días sin recibir un solo evento.

## Esperando al humano

1. **Preguntar a Daniel si el secreto de firma le cuadra.** Sus eventos le llegan (177 entregados,
   cero fallidos), pero si valida la firma con otro secreto los rechaza de su lado. Es lo único que
   no se puede comprobar desde aquí.
2. **Validar los textos** que ve el operador (en el PR #766) y el del dueño del webhook (#767).
3. **El mensaje para Daniel** con las cuatro aclaraciones: el `id` es uuid y no entero; `mensajero`
   es «quién la lleva AHORA» y se vacía en devoluciones —justo lo que él quiere medir—; qué
   `motivo` necesita (**puerta BLOQUEANTE de la 405**); y que `fecha`/`tipo` cambian de nombre.
4. **Dos órdenes con direcciones irresolubles** (`ZERO_RESULTS`) que necesitan una referencia mejor.

## Backlog abierto

- **404** — el mensajero en el webhook y en la API. Spec listo (25 requisitos), premisa de
  privacidad **verificada en el código**, no supuesta.
- **405** — el historial de gestiones. Spec listo (22 requisitos). **Q1 bloqueante**: confirmar el
  `motivo` con el integrador antes de escribir una línea.
- **406** — el enlace de evidencias del webhook da 404 (uuid contra un endpoint que resuelve por
  guía/remisión). Hoy inofensivo: cero incidentes en producción. Se estrena roto ante el primero.
- **270** — sigue `pending` y ahora importa más: `geocode_precision` no lo lee nadie, y 4 de las 6
  órdenes desbloqueadas salieron con precisión `GEOMETRIC_CENTER`, no `ROOFTOP`.

## Lecciones de la madrugada, por si se repiten

- **Un gate rojo tras un merge con migraciones puede ser el cliente Prisma rancio**: 14 errores de
  typecheck sobre campos que sí estaban en el esquema. `prisma generate` y a correr otra vez.
- **La base local es compartida entre worktrees**: dos fichas con migraciones se rompieron el gate
  mutuamente. Se resuelve con orden de merge, no desde dentro de las ramas.
- **Un `down.sql` recrea-con-lista caduca en cuanto otra ficha entra antes que tú.**
