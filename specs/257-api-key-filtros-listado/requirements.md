# Feature 257 — API key: el listado filtra por rango de fechas, `num_guia` y `num_remision`

Requisitos en notación EARS. Sin detalles de implementación (esos van en `design.md`).
Cada `R<n>` se mapea a un test concreto en `tasks.md`.

**Alcance en una línea:** `GET /api/ordenes/api-key` gana tres filtros OPCIONALES —rango de
fechas (`desde`/`hasta`), `num_guia` y `num_remision`— combinables entre sí y con `estado`, que
siempre ACOTAN dentro del owner y nunca amplían el alcance.

**Fuera de alcance (explícito):**

- Los endpoints de DETALLE `GET /api/ordenes/api-key/{numGuia}` (feature 106) y
  `GET /api/ordenes/api-key/orden/{id}` (feature 177) NO se tocan: devuelven evidencias, son otro
  contrato y se quedan exactamente como están. Que el listado acepte `num_guia` no los duplica ni
  los deprecia.
- `limit`, `offset`, `estado` y el `orderBy { createdAt: "desc" }` NO cambian de semántica.
- El webhook (feature 256) NO se toca.
- No se añade ningún filtro por fecha distinta de `created_at` (fecha de último movimiento, de
  reparto, de liquidación: otra ficha).

---

## 1. Compatibilidad y borde

**R1.** CUANDO llega una petición sin ninguno de los parámetros nuevos (`desde`, `hasta`,
`num_guia`, `num_remision`), el sistema DEBE devolver exactamente la misma página que devolvía
antes de esta feature para la misma query (mismos items, mismo orden, mismo `pagination`).

**R2.** El sistema DEBE seguir leyendo de la query SOLO las claves conocidas, e ignorar cualquier
otra (p. ej. `tiendaId`, `owner`, `ownerId`), sin error y sin efecto sobre el resultado.

**R3.** CUANDO la petición no está autenticada o el usuario de la key no está activo, el sistema
DEBE responder `401`/`403` respectivamente ANTES de validar los parámetros nuevos, aunque estos
sean inválidos (la autenticación gana sobre la validación).

## 2. Filtro por rango de fechas

**R4.** El sistema DEBE aceptar los parámetros opcionales e independientes `desde` y `hasta`, cada
uno como una fecha CALENDARIO de Costa Rica en formato `YYYY-MM-DD`, sin hora y sin zona.

**R5.** SI llega `desde`, ENTONCES el sistema DEBE excluir toda orden cuyo `created_at` sea
ANTERIOR al instante de comienzo (00:00 hora de pared de Costa Rica) de esa fecha calendario.

**R6.** SI llega `hasta`, ENTONCES el sistema DEBE excluir toda orden cuyo `created_at` sea IGUAL
o POSTERIOR al instante de comienzo (00:00 hora de pared de Costa Rica) del día SIGUIENTE a esa
fecha calendario; es decir, `hasta` es INCLUSIVO y la ventana es semiabierta
`[desde 00:00 CR, hasta+1día 00:00 CR)`.

**R7.** El sistema DEBE situar ambos bordes de la ventana en `...T06:00:00.000Z` (00:00 hora de
Costa Rica, UTC-6), NO en la medianoche UTC de la fecha calendario. Una orden creada a las
`00:30` hora de CR del día `D` (`D T06:30:00Z`) DEBE entrar en `desde=hasta=D`, y una creada a las
`19:00` hora de CR del día `D-1` (`D T01:00:00Z`) NO DEBE entrar.

**R8.** CUANDO `desde` y `hasta` traen la MISMA fecha, el sistema DEBE cubrir las 24 horas
completas de ese día en Costa Rica (no una franja vacía ni un solo instante).

**R9.** SI llega solo `desde`, ENTONCES el sistema DEBE aplicar únicamente la cota inferior; SI
llega solo `hasta`, ENTONCES el sistema DEBE aplicar únicamente la cota superior.

**R10.** CUANDO `desde` o `hasta` no cumplen el formato `YYYY-MM-DD` (p. ej. `22/07/2026`,
`2026-07-22T00:00:00Z`, `hoy`, cadena vacía), el sistema DEBE responder `422` con el código
`VALIDATION_ERROR` y `fieldErrors` sobre el campo ofensor, sin consultar la base de datos.

**R11.** CUANDO `desde` o `hasta` tienen forma válida pero designan un día que NO existe
(p. ej. `2026-02-31`, `2026-13-01`), el sistema DEBE responder `422` y NO DEBE rodar la fecha al
mes siguiente.

**R12.** CUANDO `desde` es POSTERIOR a `hasta`, el sistema DEBE responder `422` con
`fieldErrors`, y NO DEBE devolver una página vacía silenciosa.

## 3. Filtro por `num_guia`

**R13.** El sistema DEBE aceptar el parámetro opcional `num_guia` como un entero positivo y, SI
llega, DEBE devolver únicamente órdenes del owner cuyo `num_guia` sea EXACTAMENTE ese valor.

**R14.** CUANDO `num_guia` no es un entero positivo (`abc`, `12.5`, `0`, `-3`, cadena vacía), el
sistema DEBE responder `422` con `fieldErrors` sobre `num_guia`, sin consultar la base de datos.

**R15.** MIENTRAS se filtra por `num_guia`, el sistema DEBE excluir las órdenes que todavía no
tienen guía asignada (`num_guia` nulo).

## 4. Filtro por `num_remision`

**R16.** El sistema DEBE aceptar el parámetro opcional `num_remision` como texto no vacío y, SI
llega, DEBE devolver únicamente órdenes del owner cuyo `num_remision` sea EXACTAMENTE igual —sin
coincidencia por prefijo, sin subcadena y sin ignorar mayúsculas/minúsculas—.

**R17.** CUANDO `num_remision` llega vacío o compuesto solo de espacios, el sistema DEBE responder
`422` con `fieldErrors` sobre `num_remision`.

## 5. Combinación de filtros

**R18.** El sistema DEBE permitir cualquier combinación de `estado`, `desde`, `hasta`, `num_guia`
y `num_remision` en la misma petición, y DEBE aplicarlas en conjunción (AND): una orden aparece
solo si satisface TODAS las presentes.

**R19.** CUANDO la combinación de filtros no deja ninguna orden, el sistema DEBE responder `200`
con `items: []` y `pagination.total: 0`; NUNCA `404` ni `422`.

## 6. Scope por owner (invariante de seguridad)

**R20.** El sistema DEBE incluir SIEMPRE, en el conjunto de condiciones con que resuelve el
listado, el owner derivado de `actor.usuarioId` —el id de tienda extraído de la API key—, y
NINGÚN parámetro de la petición DEBE poder sustituirlo, ampliarlo ni omitirlo. Esta es una
invariante del ENDPOINT, no una propiedad de los filtros de esta feature: aplica igualmente a
cualquier filtro que se añada después.

**R21.** CUANDO se filtra por un `num_guia` que existe pero pertenece a OTRA tienda, el sistema
DEBE responder `200` con `items: []` y `pagination.total: 0` — jamás la fila, y jamás una
respuesta distinguible de "ese número no existe".

**R22.** CUANDO se filtra por un `num_remision` que existe pero pertenece a OTRA tienda, el
sistema DEBE responder `200` con `items: []` y `pagination.total: 0`, con la misma
indistinguibilidad de R21.

**R23.** MIENTRAS se aplica cualquier combinación de filtros nuevos, el sistema DEBE seguir
excluyendo las órdenes borradas lógicamente (`deleted_at` no nulo).

## 7. Paginación y orden

**R24.** El sistema DEBE mantener el orden `created_at` descendente y DEBE aplicar `limit`/
`offset` SOBRE el conjunto ya filtrado.

**R25.** El sistema DEBE devolver en `pagination.total` el conteo del MISMO conjunto filtrado que
produce `items` (mismo `where`), de modo que recorrer páginas con los filtros activos sea
determinista.

## 8. Documentación pública

**R26.** El sistema DEBE documentar los cuatro parámetros nuevos (`desde`, `hasta`, `num_guia`,
`num_remision`) en la especificación OpenAPI del canal, con tipo, formato, obligatoriedad y
ejemplo, y el espejo textual `docs/api/api-key-openapi.yaml` DEBE quedar consistente con ella.

---

## Decisiones cerradas en la puerta (2026-08-21, humano)

No quedan preguntas abiertas. Las tres que este spec dejó planteadas están FIRMADAS:

1. **Tope al ancho del rango: NO se impone ninguno.** Se adopta la recomendación del propio spec
   (`design.md` §7): `limit` ya acota la respuesta a 100 items y el coste real está en el `count`,
   que un tope de N días no evitaría. Es una decisión, no un olvido: no reabrir sin una medición
   que la contradiga.
2. **Rango abierto por un lado: APROBADO.** `desde` y `hasta` siguen siendo independientes (R9 sin
   cambios). Caso de uso que lo justifica: el **sync incremental** del integrador —"dame lo nuevo
   desde mi último sync"— con `?desde=<fecha>` y sin cota superior.
3. **`num_guia` + `num_remision` a la vez: se queda AND** (R18 sin cambios). Se ofreció la
   semántica OR y el humano la declinó explícitamente (le servía cualquiera de las dos), así que se
   conserva AND por ser lo ya especificado y lo más simple.

Además, el humano reforzó una condición que ya vivía en el spec y que R20 recoge ahora como
invariante del endpoint: *"siempre debe filtrar por el id de tienda extraído mediante el api key"*.
