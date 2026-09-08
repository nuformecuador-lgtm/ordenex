# Ficha 376 — informe de implementación

> `CHECKPOINTS.md > Trazabilidad` exige este archivo con el mapa `R<n> → test`. La tabla completa
> vive además en `specs/376-zona-central-guarda-y-rastro/tasks.md`; aquí está consolidada junto a
> lo que se midió, lo que se decidió y lo que queda vivo.

**Rama:** `fix/376-zona-central-guarda-y-rastro` · **Backend:** `09bcf240` → `0367aac4` → `65995683`
→ `11e8aa2d` · **Pantalla:** `630b5b46` · **Revisión:** `56e99a37`
**Zona:** fullstack · **Fecha:** 2026-09-07

## Qué arregla, en una línea

`esCentral: z.boolean().default(false)` vivía en el `zonaFields` que comparten crear y actualizar,
así que **omitir el campo apagaba la marca de zona central** — la marca que elige la columna de
flete. Sin confirmación al desmarcar, sin guarda contra quedarse en cero centrales, y sin rastro.

## Cómo se verificó

- **`./init.sh` completo** (el rápido se niega aquí: migración + `lib/types/` + rutas con nombre de
  dinero), corrido en las **tres** entregas —backend, pantalla y revisión— con `INIT_EXIT=0` **leído
  de dentro del log**, nunca del código de salida del shell.
- Última corrida: **1769/1769 archivos, 25 263 tests, 26 `skipped`**. Los 26 están contados uno a
  uno: 17 en `AnaliticaPage.test.tsx` y 9 en `AnaliticaShell.test.tsx`, preexistentes y ajenos.
  **Cero saltados en `integration/db`**: los 132 archivos contra Postgres sí se ejecutaron.
- **Once mutaciones aplicadas a mano y revertidas** (nueve del implementer, seis del reviewer, con
  solape). Todas rojas. Las que más importan: `esCentral: data.esCentral ?? false` → rojo en R1 y
  R4; `actualizarZonaSchema = crearZonaSchema` → rojo; quitar la guarda de R5 → rojo en R3/R5/R19;
  quitar `if (exists.esCentral)` de `hardDelete` → rojo en R10 **por borrado**; `else if (false)` en
  la rama de R20 → 9 de 15 rojos.
- La migración se aplicó, **se revirtió con `pnpm run db:rollback`, se re-aplicó**, y
  `prisma migrate status` quedó limpio y sin drift.

## Mapa R → test

| R | Task | Test |
| --- | --- | --- |
| R1 | T4, T6 | T11 «la marca SOBREVIVE a su ausencia» + `zona-schema` «al ACTUALIZAR sale `undefined`» + `zona-service` + `zonas-action` «el mismo guardado SIN el campo devuelve ok» |
| R2 | T4 | `zona-schema` «al CREAR sigue saliendo `false`» |
| R3 | T4, T6 | `zona-schema` + T11 «`false` explícito se RECHAZA» + `zona-service` |
| R4 | T6 | T11 «el resto del guardado SÍ se aplica entero» |
| R5 | T6 | T11 (las cuatro escrituras, una por una) + `zona-repository` |
| R6 | T9 | `zona-service` «`fieldErrors.esCentral`», con el texto **literal** |
| R7 | T9 | `zonas-action`, `ZonaService` real sobre repo doble, sin formulario |
| R8 | T6 | T11 + `zona-repository` + `zonas-action` |
| R9 | T6 | T11 «el traslado deja EXACTAMENTE una central» |
| R10 | T8 | T11 «sin órdenes ni usuarios» + `zona-repository` |
| R11 | T8, T9 | T11 «`referenced`, no `es_central`» + `zona-service` + `zonas-action` + `tarifa-zona-borrado-fk-real` (`motivo: "en_uso"`) |
| R12 | T6, T7 | T11 «el traslado escribe DOS filas» + «R12 en `create`» |
| R13 | T6 | T11 «forma de la fila» |
| R14 | T3, T6 | `historial-accion-sin-datos-cliente.guardia.test.ts` |
| R15 | T6, T7 | T11 «mismo lote» + «lote distinto del de la 366» |
| R16 | T3 | `catalogo-y-choke-point.test.ts` (categoría `mueve_dinero`, reparto 27/10/12) |
| R17 | T6, T10 | `historial-accion-escrituras-cubiertas.guardia` + T11 «atomicidad» con `clienteConSavepoint(tx, true)` |
| R18 | T6, T7 | T11 «idempotencia» + «crear sin la marca ⇒ cero filas» |
| R19 | T6, T8 | T11 «y no deja fila» (rechazo de R5) + el rechazo de R10 no escribe nada |
| R20 | T12 | `ZonaCentralConfirmacion.test.tsx` › «abre el modal nombrando la zona y NO llama a actualizarZona todavía» + «al confirmar SÍ envía, con la marca apagada» |
| R21 | T12 | `ZonaCentralConfirmacion.test.tsx` › «el modal dice el NOMBRE de la zona que perderá la marca» + «al confirmar envía con la marca encendida» |
| R22 | T12 | `ZonaCentralConfirmacion.test.tsx` › «cancelar el modal de desmarcar no llama a ninguna acción de guardado» + «cancelar el modal de marcar tampoco envía» |
| R23 | T12 | `ZonaCentralConfirmacion.test.tsx` › «`fieldErrors.esCentral` aparece bajo «Zona Central» y la casilla lo referencia» + «el toast repite el motivo del servidor» |
| R24 | T12 | `ZonaBorradoMotivo.test.tsx` › «motivo `es_central` dice que hay que marcar otra zona, no que esté en uso» + «motivo `en_uso` conserva EXACTAMENTE el texto de antes de esta ficha» |
| Q4 | T12 | `ZonaCentralConfirmacion.test.tsx` › cinco casos: suma de las dos zonas, singular, cero ≠ «no lo pude contar», bloqueo mientras cuenta, y fallo de la consulta |

## Decisiones, y de quién son

**Ninguna de estas la firmó el humano.** Las cuatro son del leader, del 2026-09-07, y todas son
reversibles. Se anotan aquí porque el `tasks.md` llegó a etiquetar Q4 como «FIRMADA POR EL HUMANO»,
lo cual era falso y ya está corregido.

1. **Q1 — alcance reducido:** el rastro cubre SOLO `es_central`. El hueco hermano —
   `tarifa_zona_mensajero`, el pago al mensajero, que se reescribe entero en cada guardado de zona
   sin ninguna fila de historial — salió a la **ficha 380** en vez de entrar aquí.
2. **Q2 — la regla vive solo en el servidor**, y el formulario pinta el rechazo junto a la casilla.
   Sin segunda copia del invariante en el cliente (verificado por el reviewer).
3. **Q3 — el tipo se llama `zona_central_cambiada`**, categoría «mueve dinero».
4. **Q4 — la confirmación dice el impacto.** Se pregunta por **las dos** zonas del traslado, no solo
   por la que pierde la marca: las dos cambian de columna de flete.

## Hallazgos que valen más que la ficha

1. **Una guardia mentía, y su límite es peor de lo que parecía.**
   `historial-accion-escrituras-cubiertas.guardia` comprobaba con `indexOf("appendAccion")` — solo la
   **primera** llamada. `ZonaRepository.update` es el primer método del censo con **dos**, así que la
   segunda no la vigilaba nadie: **medido**, pasarle `this.prisma` en vez de la `tx` dejaba la
   guardia 48/48 verde. Se reforzó (ahora exige todas las llamadas dentro del callback y con la
   `tx`) y se añadieron tres contrapruebas permanentes.
   **Límite que QUEDA, confirmado por el reviewer con su propia medición:** borrar *entero* el bloque
   `appendAccion` de la 376 deja la guardia **51/51 verde**, porque `fallosDelPuntoDeEscritura` solo
   comprueba `llamadas.length === 0` y el censo no ata un tipo de acción a una llamada concreta. Lo
   cazan los tests unitarios (6 rojos), así que no hay agujero abierto — pero **esa entrada del censo
   garantiza menos de lo que su nombre promete**, y quien la lea debe saberlo.
2. **Drift preexistente en la base local**, ajeno a esta ficha:
   `20260827160000_orden_num_remision_unico_parcial` fue editada después de aplicarse, así que
   `prisma migrate dev` exige un `migrate reset` de la base **compartida**. Se esquivó escribiendo la
   carpeta de la migración a mano. **Sigue ahí.**

## Riesgo residual, dicho en voz alta

**Nadie ha visto esta pantalla funcionando en la app real.** No se levantó el servidor de
desarrollo; el entorno del implementer no tenía navegador y `curl` no sirve porque la ruta redirige
en middleware antes de compilar el componente. Lo que hay son 19 casos que montan el componente
**real** en jsdom y lo manejan con `userEvent` (clic en la casilla, en Guardar, en Continuar y en
Cancelar), más el gate completo. **En este repo eso no basta y está medido**: mirar la app encontró
siete textos rotos que doce mil tests daban por buenos. Queda pendiente de verificación humana:
`configuración → tarifas`, marcar y desmarcar la casilla de zona central, y borrar la zona central.

Menor, del mismo lote: quedó un `data-testid="impacto-zona-central"` que ningún test usa. Es un
gancho de depuración consistente con el `modal-backdrop` del propio `Modal`; se quita en una línea
si sobra.
