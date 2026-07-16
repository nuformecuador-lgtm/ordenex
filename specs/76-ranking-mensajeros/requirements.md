# Feature 76 — Ranking DIARIO de mensajeros + tabla de premios (top 3)

> Requisitos en notación EARS. Sin detalles de implementación (esos van en `design.md`).
> Cada `R<n>` debe poder mapearse a un test concreto (columna "Traza a").
>
> **Gate F1.4 CERRADA (2026-07-16):** decisiones (a)-(f) fijas.
> **DS1 RESUELTA (2026-07-16):** "órdenes asignadas del día" se mide con una columna nueva
> `orden.asignado_at` estampada en cada asignación/reasignación. NO quedan sub-decisiones
> abiertas; solo una limitación conocida y aceptada (ver "Limitación conocida").

## Contexto y alcance

Ranking **básico y DIARIO** de mensajeros ordenado por porcentaje de entregas exitosas
**del día en curso (zona horaria CR, UTC-6)**, más una **tabla de premios editable para
las 3 primeras posiciones**. Los montos de premio son **inputs abiertos y opcionales**:
un input vacío significa "sin premio asignado" (no es cero ni error). Fuera de alcance:
dashboards, gráficos, histórico de rankings/premios, notificaciones.

## Decisiones firmes de la gate (F1.4)

- **(a) Definición del %** = entregas exitosas del DÍA / órdenes ASIGNADAS del DÍA
  (NO histórico, NO gestiones totales).
- **(b) Ventana** = DÍA en curso en CR (UTC-6), usando el helper `startOfDayCR`
  (`lib/utils/fecha-cr.ts:19-25`, feature 46).
- **(c) Mínimo de muestra** = umbral de asignaciones para entrar al podio, **default 1**,
  parametrizable vía `lib/config/*` (patrón `readPositiveInt`/env, `lib/config/reintentos.ts:6-22`).
- **(d) Premio** = solo monto en colones por posición (nullable = sin premio). Tabla
  `premio_ranking` monto-only, sin columna `etiqueta`.
- **(e) Visibilidad** = MAESTRO ve y edita todo; MENSAJERO ve todo en SOLO-LECTURA.
- **(f) Formateo del %** = redondeo en el SERVIDOR a 1 decimal, serializado a string.

## Glosario

- **Entrega exitosa (del día):** gestión con `resultado = entregada`
  (`GestionResultado`, `db/schema.prisma:368-375`), **vigente** (`anuladaAt IS NULL`,
  feature 67) y ocurrida HOY(CR). Atribuida por `GestionOrden.mensajeroId`.
- **Orden asignada (del día):** orden con `mensajero_asignado_id = X` y `asignado_at` en
  HOY(CR). `orden.asignado_at` (columna NUEVA, `DateTime?`) se estampa `= now` en cada
  asignación/reasignación de mensajero (R23). Históricas quedan en NULL (no cuentan).
- **Hoy(CR):** día calendario de Costa Rica; límite inferior = `startOfDayCR(now)`,
  límite superior = `startOfDayCR(now) + 24h` (`lib/utils/fecha-cr.ts`).
- **Mensajero:** `Usuario` con `rol = mensajero` y `estado = activo`
  (`UserRepository.listMensajeros()`, `lib/repositories/UserRepository.ts:117-123`).

---

## Requisitos

### Cálculo del ranking diario

- **R1 (Ubicuo).** El sistema DEBE calcular, para cada mensajero activo y **acotado al día
  en curso en CR**, el número de **órdenes asignadas HOY** (denominador = órdenes con
  `mensajero_asignado_id` = ese mensajero y `asignado_at ∈ HOY(CR)`) y el número de
  **entregas exitosas HOY** (numerador), usando `startOfDayCR` como límite del día.

- **R2 (Ubicuo).** El sistema DEBE calcular el porcentaje de entregas exitosas de cada
  mensajero como `entregadasHoy / asignadasHoy`, redondeado a 1 decimal en el servidor (R12).

- **R3 (Condicional).** SI un mensajero tiene `asignadasHoy = 0`, ENTONCES el sistema DEBE
  tratar su porcentaje como indefinido (no como 100 %) y NO DEBE ubicarlo en el podio de
  premios, aunque SÍ puede listarlo con su conteo crudo (0/0).

- **R4 (Ubicuo).** El sistema DEBE ordenar el ranking de forma descendente por porcentaje
  de entregas exitosas del día.

- **R5 (Condicional).** SI dos o más mensajeros tienen el mismo porcentaje, ENTONCES el
  sistema DEBE desempatar por número absoluto de entregas exitosas del día (descendente) y,
  si persiste, por nombre del mensajero (ascendente, alfabético). El orden DEBE ser
  determinista y estable entre peticiones con los mismos datos.

- **R6 (Ubicuo).** El sistema DEBE exponer, junto al porcentaje, el conteo crudo de cada
  mensajero (entregadas HOY y asignadas HOY) para que el porcentaje sea auditable en la UI.

- **R7 (Condicional).** SI el número de órdenes asignadas HOY de un mensajero es menor que
  el umbral mínimo de muestra configurado (default 1, `lib/config/*`), ENTONCES el sistema
  NO DEBE ubicarlo en el podio de premios (posiciones 1-3), aunque SÍ puede listarlo.

### Tabla de premios (top 3)

- **R8 (Ubicuo).** El sistema DEBE mantener exactamente tres posiciones de premio
  (`posicion` 1, 2 y 3), cada una con un monto opcional en colones **y una descripción
  opcional (texto libre)**.

- **R25 (Por evento).** CUANDO el maestro guarda la descripción de una posición de premio,
  el sistema DEBE persistirla como texto libre opcional (campo vaciado → posición sin
  descripción, `null`; no se interpreta el vacío como un valor). La descripción es
  independiente del monto: una posición puede tener descripción sin monto y viceversa.

- **R9 (Condicional).** SI el monto de una posición está vacío (no asignado), ENTONCES el
  sistema DEBE tratar esa posición como "sin premio asignado" y NO DEBE mostrar un monto ni
  interpretarlo como cero.

- **R10 (Por evento).** CUANDO el maestro guarda una posición de premio, el sistema DEBE
  persistir sus valores (monto válido → guardado; campo vaciado → posición sin premio;
  descripción → texto libre o `null` si se vacía) y reflejar el cambio en la siguiente
  lectura del ranking.

- **R11 (Condicional).** SI el maestro envía un monto no válido (no numérico, negativo, o
  con más de 2 decimales), ENTONCES el sistema DEBE rechazar el guardado con un mensaje de
  error y NO DEBE persistir el valor.

- **R12 (Condicional).** SI se envían datos al cliente, ENTONCES el sistema DEBE serializar
  todo monto de premio como cadena (string) y el porcentaje ya redondeado (1 decimal) como
  string (nunca `Prisma.Decimal` ni ratio crudo cruzando servidor→cliente, patrón
  `app/(app)/wallet/page.tsx:16-18`).

### Presentación y asociación premio↔mensajero

- **R13 (Ubicuo).** El sistema DEBE mostrar el ranking como una tabla ordenada
  (posición, nombre del mensajero, % de entregas exitosas del día, conteo crudo).

- **R14 (Condicional).** SI una posición del podio (1-3) tiene un mensajero elegible
  (R3+R7) y esa posición tiene premio asignado (R9), ENTONCES el sistema DEBE mostrar el
  monto del premio asociado a ese mensajero en esa posición.

- **R15 (Condicional).** SI una posición del podio no tiene mensajero elegible (menos de 3
  mensajeros elegibles ese día), ENTONCES el sistema NO DEBE inventar un ocupante para esa
  posición.

### Permisos y acceso

- **R16 (De estado).** MIENTRAS el actor autenticado tenga rol `maestro`, el sistema DEBE
  permitirle ver el ranking completo y editar los montos de premio de las 3 posiciones.

- **R17 (De estado).** MIENTRAS el actor autenticado tenga rol `mensajero`, el sistema DEBE
  mostrarle el ranking completo en modo **solo-lectura** (sin inputs de edición de premios).

- **R18 (Condicional).** SI el actor NO es `maestro` ni `mensajero` (otro rol o sin sesión),
  ENTONCES el sistema NO DEBE exponer el ranking ni permitir edición, resolviendo el acceso
  como denegado sin exponer datos (patrón `notFound`/forbidden de `/wallet`).

- **R19 (Condicional).** SI el actor es `mensajero` e intenta editar un premio, ENTONCES el
  sistema DEBE rechazar la mutación (forbidden) sin persistir cambios.

- **R20 (Ubicuo).** El sistema DEBE mantener el ítem de menú `/ranking` visible para
  `maestro` y `mensajero` (`lib/auth/menu-visibility.ts:89-95`) de forma coherente con la
  autorización real, corrigiendo el comentario "hoy solo para maestro" para reflejar que la
  visibilidad maestro+mensajero es intencional.

### Datos y seguridad

- **R21 (Ubicuo).** El sistema DEBE persistir los premios en una tabla nueva con RLS
  activado, migración aditiva versionada y su `down.sql` (patrón del arnés,
  `docs/architecture.md:121-133`), sin borrar ni alterar datos existentes.

- **R22 (Ubicuo).** El sistema DEBE calcular el ranking sin hardcodear país; la zona horaria
  del día se resuelve por el helper CR existente y el umbral de muestra por `lib/config/*`.
  El monto del premio se almacena como decimal y su formateo de moneda usa la configuración
  de moneda existente (`lib/config/moneda.ts`), no incrustada en el código.

- **R23 (Por evento).** CUANDO se asigna o reasigna un mensajero a una orden (se escribe
  `orden.mensajero_asignado_id` con un valor no nulo), el sistema DEBE estampar
  `orden.asignado_at = now` en la misma operación. Este comportamiento DEBE cumplirse en
  TODOS los puntos de escritura de asignación enumerados en el design §4 (choke-point):
  ninguna ruta de asignación puede omitir el estampado, o esas órdenes nunca contarían.

- **R24 (Ubicuo).** El sistema DEBE persistir `orden.asignado_at` como columna nueva
  `DateTime?` (NULLABLE; las órdenes históricas quedan en NULL) mediante migración aditiva
  versionada con su `down.sql`, sin borrar ni alterar datos existentes.

---

## Trazabilidad (R → test) — a completar por el implementer

| R   | Test previsto (descripción del comportamiento) |
| --- | --- |
| R1  | repo: cuenta asignadas HOY(CR) y entregadas HOY(CR) por mensajero dentro del rango `startOfDayCR` |
| R2  | service: pct = entregadasHoy/asignadasHoy |
| R3  | service: asignadasHoy=0 → pct indefinido, fuera de podio |
| R4  | service: ordena descendente por pct |
| R5  | service: desempate por # entregas y luego nombre; determinista |
| R6  | service/action: expone conteo crudo (entregadasHoy, asignadasHoy) |
| R7  | service: asignadasHoy < umbral (config) → fuera de podio; default 1 |
| R8  | repo/migración: existen exactamente 3 posiciones |
| R9  | service: monto null → "sin premio", no cero |
| R10 | action: guardar monto persiste; vaciar → sin premio |
| R11 | action/zod: monto inválido (negativo, >2 dec, no numérico) rechazado |
| R12 | page/action: montos y pct como string desde servidor |
| R13 | component: render de tabla ordenada con columnas esperadas |
| R14 | component: premio asociado a ocupante elegible del podio |
| R15 | component: posición sin ocupante no se inventa |
| R16 | service/page: maestro ve y edita |
| R17 | service/page: mensajero ve en solo-lectura |
| R18 | service/page: otro rol / sin sesión → forbidden/notFound sin datos |
| R19 | action: mensajero editando premio → forbidden, sin persistir |
| R20 | menu-visibility + page: visibilidad maestro+mensajero coherente |
| R21 | migración: tabla `premio_ranking` con RLS + down.sql revierte |
| R22 | service: zona CR por helper, umbral por config, moneda por config |
| R23 | por cada writer (W1-W4): tras asignar mensajero, `asignado_at` queda seteado a HOY |
| R24 | migración: columna `orden.asignado_at` nullable + down.sql revierte; históricas NULL |
| R25 | action/repo: guardar descripción persiste; vaciar → null; independiente del monto |

---

## Sub-decisiones resueltas

- **DS1 — RESUELTA.** "Órdenes asignadas del día" se mide con la columna nueva
  `orden.asignado_at` (R23/R24), NO con el proxy sobre `orden_historial_estado`. El
  denominador es `orden.count/groupBy` por `mensajero_asignado_id` con `asignado_at ∈ HOY(CR)`
  (design §2.2/§3). El estampado se instrumenta en cada writer de asignación (design §4).
  No quedan sub-decisiones abiertas.

## Limitación conocida (aceptada por el humano, no bloqueante)

- **LC1 — Devolución intradía deflaciona el denominador.** Una devolución del mismo día
  limpia `orden.mensajero_asignado_id` (feature 47, `limpiaMensajero`,
  `lib/repositories/GestionOrdenRepository.ts:284`), así que esa orden sale del denominador
  de ese mensajero hasta que se reasigne. El % se infla levemente por devoluciones
  intradía. Es **consistente**: esa orden tampoco entra al numerador (su gestión de entrega
  no existe / no es `entregada` vigente). Documentado; sin corrección en esta feature.
  Trazabilidad: un test de `RankingService` DEBE fijar este comportamiento como esperado
  (orden con asignación limpiada ese día no cuenta en denominador ni numerador).
