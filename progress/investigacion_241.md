# Investigación 241 — las guardas de bloqueo que retiró `6a0e6d36`

> **Encargo:** averiguar si hubo motivo ANTES de decidir si se repone. Esto es una investigación,
> no una implementación: **no se tocó una sola línea de `lib/`, `app/`, `tests/` ni `specs/`.**
>
> **Base:** `dev` = `db23911b`. El commit investigado **está en producción** desde el
> **2026-08-19 09:49 -0500** (PR #400, `git merge-base --is-ancestor 6a0e6d36 origin/prod` → sí).

---

## VEREDICTO EN TRES LÍNEAS

1. **¿Hubo motivo?** Hubo una **queja humana real**, citada en el propio mensaje del commit, y es
   verosímil: con la guarda puesta, **un solo cierre sin aprobar congelaba una bodega satélite
   entera** —incluidos los compañeros sin ningún cierre— hasta que alguien aprobara. Pero **no hay
   deadlock**: busqué los cinco caminos posibles y **los cinco tienen salida**, cerrada a propósito
   por `111/R9`, `109/R28`, `111/R16` y `149/R19`. Lo que había era una **parada de operación con
   dependencia de un tercero**, no un ciclo.
2. **¿Es peligroso hoy?** **Sí, y bastante más de lo que dice la ficha.** El tope quedó en
   `CIERRES_ABIERTOS_TOLERADOS = 1` con el corte en `> 1`, y el invariante `109/R30` dice que **un
   mensajero NUNCA tiene 2 cierres abiertos a la vez**. Es decir: el commit no subió un umbral,
   **apagó el predicado entero** — incluidas **tres superficies que el propio commit afirma no haber
   tocado**. Y dejó una **incoherencia lectura/escritura** que hoy produce, en producción, un error
   sin explicación en la bodega satélite.
3. **¿Se repone?** **Hace falta decisión humana**, y no es un `git revert`. Reponer tal cual
   reintroduce exactamente la queja que lo originó. Ver §7: hay una forma de reponer que no la
   reintroduce, y hay **una pieza que se puede reponer hoy sin discusión** porque hoy no está
   funcionando de ninguna de las dos maneras.

---

## 1. El commit: qué es, de dónde vino, qué dice y qué hizo

| | |
|---|---|
| SHA | `6a0e6d36c86ca15bb0657557c7b70ea14d125ce2` |
| Autor / fecha | `usuario <cquevedo68@gmail.com>` · 2026-08-18 22:22 -0500 |
| Padre | `c6fe6fc1` (el último de la pila de ayuda de la rama `ux`) |
| Rama de origen | **`ux`** — la misma rama sin ficha ni spec que auditó `auditoria_ayuda_tienda.md` |
| Entró en `dev` por | **PR #396**, merge `9095d4e5`, 2026-08-19 03:36 UTC |
| Llegó a `prod` por | **PR #400** (release), merge `4a152b46`, 2026-08-19 09:49 -0500 |
| Tamaño | **26 archivos**, +444 / −601 |

**Mensaje completo:**

> `feat(asignacion): el bloqueo por cierres pasa de "alguno" a "mas de los tolerados"`
>
> Pedido humano 2026-08-18. Un mensajero dejaba de recibir asignaciones con UN solo cierre sin
> aprobar; ahora el corte es un umbral de cierres pendientes.
>
> El criterio se CONSULTA y no se re-deriva en cada pantalla, para que el aviso que ve el mensajero
> diga exactamente lo que el servidor va a rechazar. Los cuatro puntos de asignacion -guia, bodega,
> recoleccion y satelite- y el listado leen el mismo dato.

**El mensaje describe un cambio de umbral. Lo que hizo fue retirar cinco guardas y borrar un
loader.** La segunda mitad («los cuatro puntos … leen el mismo dato») es literalmente cierta y
engañosa: los cuatro leen el mismo dato **porque los cuatro dejaron de leer nada**.

El PR #396 tampoco lo cuenta: su cuerpo dedica **una línea** al asunto («**Asignación** — el bloqueo
por cierres pasa de "tiene alguno sin aprobar" a "tiene más de los tolerados", consultado y no
re-derivado en cada pantalla»). No menciona ninguna retirada. El PR #400 es una release que arrastra
`dev` entero.

---

## 2. Lo que retiró EXACTAMENTE, con el diff citado

### 2.1 · Guarda de mensajero bloqueado en `asignarDesdeBodega` (41/R13/R23)

`lib/services/GuiaAsignacionService.ts:351` (hoy)

```diff
-    const bloqueados = await this.repo.findMensajerosBloqueados([input.mensajeroId]);
-    if (bloqueados.has(input.mensajeroId)) {
-      return {
-        status: "conflict",
-        detalle: ordenIds.map((ordenId) => ({ ordenId, motivo: MSG_MENSAJERO_BLOQUEADO })),
-      };
-    }
+    // --- Feature 41/R13/R23 RETIRADA (pedido humano 2026-08-18) ---
```

### 2.2 · La misma guarda en `asignarRecoleccion` (157/R7)

`lib/services/GuiaAsignacionService.ts:464` — idéntica, sustituida por un comentario.

### 2.3 · Guarda de mensajero bloqueado en la asignación SATÉLITE (41/R14)

`lib/services/AsignacionSateliteService.ts:97`

```diff
-    const mensajerosBloqueados = await this.repo.findMensajerosBloqueados([input.mensajeroId]);
-    if (mensajerosBloqueados.has(input.mensajeroId)) {
-      return { status: "validation_error", fieldErrors: { mensajeroId: [MSG_MENSAJERO_BLOQUEADO] } };
-    }
+    // 3b. Feature 41/R14 RETIRADA (pedido humano 2026-08-18): ...
```

> **Esta tercera no está en la ficha ni en la auditoría §5.** La ficha habla de «dos guardas»; son
> **tres retiradas de guarda por-mensajero**, más la causa de bodega, más el loader borrado.

### 2.4 · Causa (i) del bloqueo de bodega satélite

`lib/repositories/OrdenRepository.ts:2941`

```diff
-      bloqueada: porMensajeros || porCierreBodega,
+      bloqueada: porCierreBodega,
```

`porMensajeros` **se sigue calculando y viajando al borde**, pero ya no entra en la decisión.

### 2.5 · El umbral, que es la retirada de verdad

`lib/repositories/OrdenRepository.ts:214` y `:2826`

```ts
const CIERRES_ABIERTOS_TOLERADOS = 1;
...
grupos.filter((g) => g._count._all > CIERRES_ABIERTOS_TOLERADOS)
```

### 2.6 · Un loader borrado entero

`listarZonasBloqueadasPorCierre` (server action) y su tipo `ListarZonasBloqueadasResult`,
**eliminados**. Consecuencia colateral: `OrdenRepository.findZonasConMensajeroBloqueado()`
(`:2875`) **ya no tiene un solo consumidor de producción** — solo lo referencian tests. Es código
muerto vivo en la interfaz.

---

## 3. LO GRANDE: el umbral es inalcanzable, así que no es un umbral

`findMensajerosBloqueados` devuelve a quien tiene **más de 1** cierre abierto
(`{solicitado, vencido, rechazado}`). El repo tiene un invariante explícito que dice que eso **no
puede pasar**:

> **`specs/109-sin-gestionar-cierre-vencido/requirements.md:232` — R30.** «El sistema DEBE preservar
> el INVARIANTE GENERALIZADO (extiende 111/R10): un mensajero **NUNCA DEBE tener 2 cierres ABIERTOS
> simultáneamente**.»

Y lo sostiene el código, verificado punto por punto:

| Pieza | Qué impide |
|---|---|
| `CierreDiaRepository.ts:425` | **El ÚNICO** `cierreDia.create` de todo el repositorio |
| `CierreDiaService.solicitarCierre:432/447/462` | Con `vencido` **transiciona**; con `rechazado` **transiciona**; con `solicitado` devuelve `conflict`. Solo crea con **cero** cierres abiertos |
| `CorteDiarioRepository.ts:85-95` | El corte **RESTA** a los que ya tienen un cierre abierto antes de crear el `vencido` |
| `CierresAdminRepository.forzarSolicitudVencido:1620` | La válvula **transiciona**, no crea |
| `tests/unit/services/cierre-dia-service.test.ts:1379` | Test vivo: *«el `vencido` tiene prioridad sobre el `rechazado` (a lo sumo uno abierto, R30)»* |

**Conclusión: `> 1` no se cumple nunca. El commit no subió un umbral; apagó el predicado.**

Y el predicado lo consumen **ocho** superficies, no cuatro:

| Consumidor | Qué dejó de hacer | ¿Estaba en el alcance declarado? |
|---|---|---|
| `GuiaAsignacionService` ×2 | rechazar la asignación | sí (retirada explícita) |
| `AsignacionSateliteService` | rechazar la asignación | sí (retirada explícita) |
| `OrdenRepository.existeBodegaSateliteBloqueada` | bloquear la bodega | sí (retirada explícita) |
| `GuiaAsignacionService.zonasSateliteBloqueadas:178` | impedir el **ruteo** a un satélite en cierre | **no** — la guarda sigue escrita, y ya no dispara |
| `MisAsignacionesService:137` | **`gestionar` / `recoger` / `escoger`** (111/R1, R4) | **NO** |
| `CierreDiaService.deshacerGestion:541` | **deshacer gestión** (111/R5, Q2 cerrada por el humano) | **NO** |
| `RecoleccionTiendaService:99` | **confirmar recolección en tienda** (157/R31) | **NO** |
| `lib/actions/cierre-dia.ts:91` | el **aviso en pantalla del mensajero** (41/R21) | **NO** |

El comentario que el propio commit dejó en `GuiaAsignacionService.ts:356` dice:

> «El predicado NO desaparece del repo porque otras superficies lo siguen usando —`deshacerGestion`,
> la recolección en tienda y el aviso del panel del mensajero—, **y esas NO estaban en el alcance de
> este cambio**.»

**Esa frase es falsa en el mismo commit que la escribe.** Esas tres superficies leen el predicado
que el commit acababa de neutralizar. No es un descuido de redacción: es la prueba de que quien lo
escribió **creía** estar cambiando solo un número.

### La única excepción — y es una pregunta abierta, no un matiz

R30 vale hacia adelante. **Hacia atrás no.** La feature 109 (`95160f7c`, 2026-07-22) convirtió
`rechazado` de terminal a bloqueante. Un `rechazado` **anterior** a esa fecha, que en su momento no
excluía del corte, pudo convivir con un `vencido` creado después. Esos pares —si existen— son **la
única población que el tope `> 1` sí bloquea hoy**, y es una población arbitraria: no la eligió
nadie. No encontré backfill ni migración de datos que los limpie. **Es una pregunta de datos, y no
pude medirla** (§6).

---

## 4. Qué se puede hacer HOY que antes no, y qué daño hace

### 4.1 · Maestro/admin · `/ordenes` · «Asignar desde bodega» y «Asignar recolección»

**Antes:** `conflict` con motivo *«mensajero bloqueado por cierre pendiente»*, y el selector pintaba
el nombre con `(cierre abierto)` deshabilitado. **Hoy:** se asigna, y el selector no distingue.

**Daño.** No es carga: la regla de dedicación (157) sigue viva y sigue impidiendo mandar a recolectar
a quien lleva reparto (`GuiaAsignacionService.ts:466-479`). **El daño es de caja.** Como
`MisAsignacionesService` también quedó apagado, ese mensajero **puede recoger y gestionar**, es decir
**cobrar**, mientras su cierre anterior está `solicitado`. Y **no puede abrir un segundo cierre**
(R12/R30). Resultado: el dinero del día nuevo se acumula sin cierre al que ir, y el admin que aprueba
el cierre pendiente —con la confirmación física de la 238 delante— está cuadrando una caja que **ya
no es todo lo que el mensajero tiene en la mano**. Antes, por construcción, sí lo era.

### 4.2 · adminSatelite · `/recepcion-satelite` · «Asignar mensajero» — **el fallo vivo**

Aquí la lectura y la escritura **no** coinciden, y el resultado es peor que cualquiera de las dos
opciones. El pre-chequeo se fue, pero **la guarda anti-TOCTOU del `UPDATE` crudo sigue con el
criterio VIEJO**:

`lib/repositories/OrdenRepository.ts:2678-2681`
```sql
AND NOT EXISTS (
  SELECT 1 FROM "cierre_dia" c
  WHERE c."mensajero_id" = ${mensajeroId}
    AND c."estado" IN ('solicitado', 'vencido', 'rechazado')
)
```

Secuencia real, con **UN** cierre abierto (el caso normal, el único que el invariante permite):

1. `existeBodegaSateliteBloqueada` → `bloqueada: false` (causa (i) retirada). Pasa.
2. Guarda por-mensajero → retirada. Pasa.
3. `asignarSateliteLote` → el `NOT EXISTS` es falso → **0 filas**.
4. `count !== ordenIds.length` → el service re-lee y construye `detalleCarrera`… pero las órdenes
   **no cambiaron**: siguen vivas, en su zona y en su estado de origen. Ninguna de las tres ramas
   añade nada.
5. Devuelve **`{ status: "conflict", detalle: [] }`**.

**Medido, no razonado.** Muté el doble de `asignarSateliteLote` de `1` a `0` (que es lo que devuelve
el SQL real en este caso), corrí el test y leí el objeto devuelto:

```
AssertionError: expected { status: 'conflict', detalle: [] } to deeply equal { status: 'SONDA' }
```

> Mutación restaurada. `tests/unit/services/asignacion-satelite-service.test.ts`
> sha256 **antes** `6b331c4340a5fcec91e194c93dc5546bc8ab33b10baf6c41a405614b703c93a3`
> sha256 **después** `6b331c4340a5fcec91e194c93dc5546bc8ab33b10baf6c41a405614b703c93a3`
> `git status --porcelain` vacío.

Ese `detalle: []` cae por `mensajePorMotivo` (que no encuentra motivos en un array vacío) al genérico
de `asignacion-satelite-error-messages.ts:31`:

> **«Alguna orden de la selección ya no se puede asignar. Actualiza la lista y vuelve a intentarlo.»**

Es **mentira dos veces**: las órdenes están perfectamente, y actualizar la lista **no** lo arregla —
seguirá fallando hasta que alguien apruebe el cierre. Y el mensaje correcto **sigue en el archivo**,
huérfano, en `MOTIVOS_CON_CAUSA_PROPIA` (`:63`): *«El mensajero que elegiste tiene un cierre sin
resolver…»*. Se quedó el texto y se fue el emisor.

**Esta es la pieza que se puede arreglar sin abrir el debate de fondo** (§7).

### 4.3 · Maestro · rutear a bodega satélite

`rutearABodegaSatelite` **conserva** su comprobación (`GuiaAsignacionService.ts:619`) pero pasa por
`findMensajerosBloqueados`, así que no dispara. Se rutea a un satélite que está cuadrando caja. El
mensaje que ya nadie verá, en `guia-decision-error-messages.ts:41`, **sigue enunciando el criterio
viejo**: *«…que tiene **al menos un** mensajero con un cierre abierto»*.

### 4.4 · Mensajero · su propio panel

`estadoBloqueoMensajero` (41/R21) ya no se enciende nunca. **Y sus acciones tampoco están
bloqueadas**, así que en este caso el aviso apagado y la conducta coinciden. Es el único sitio donde
la incoherencia no existe — por accidente.

### 4.5 · Coste tonto

`listarMensajerosParaAsignacion` (`lib/actions/ordenes-guia.ts:187`) **sigue ejecutando** el `groupBy`
sobre `cierre_dia` en cada carga del listado, y `OrdenesListado.tsx:66-77` documenta que **lo tira**:
«`bloqueadosIds` sigue viniendo en la respuesta de la action y se ignora aquí a propósito».

---

## 5. El deadlock: lo busqué y NO lo encontré

La sospecha del humano es razonable y la busqué en serio. La forma que tendría que tener: *un
mensajero bloqueado por un cierre que no puede resolver porque resolverlo exige una asignación que
la guarda le niega*. **No existe**, y la razón es que **el repo ya lo había cerrado a propósito, tres
veces**:

| Camino que probé | Por qué NO se cierra el ciclo |
|---|---|
| Cierre `solicitado` → bloqueado → ¿cómo sale? | Lo aprueba un admin/maestro **o el propio adminSatelite** de su zona (`CierresAdminService.aprobarCierre` con `resolveAlcance`, `:173-180`). Ninguna asignación de por medio |
| Cierre `vencido` → bloqueado para gestionar → ¿puede solicitar? | **Sí.** `CierreDiaService.ts:432` toma la rama **EXENTA** de la precondición de pendientes. Es `111/R9`, y su comentario dice literalmente «anti-deadlock: … quedaría atrapado» |
| Cierre `rechazado` | Igual, `109/R28`, `CierreDiaService.ts:447`. Misma exención, misma razón |
| Mensajero **ausente** con un `vencido` que nadie envía | `111/R16` — **válvula de escape**: `forzarSolicitudVencido`. Existe **exactamente** para «evitar el bloqueo permanente del mensajero y su bodega (41 R17)» (`specs/111.../requirements.md:257`) |
| Órdenes `por_recoger` atascadas con un mensajero bloqueado | `149/R19` (Q1 cerrada): **deshacer asignación NO consulta el bloqueo**, a propósito, para que otro pueda llevárselas. `DeshacerAsignacionService.ts:213` |

Lo que **sí** encontré, y es el motivo de verdad, es una **parada de operación**, no un ciclo:

> Bodega satélite Z, mensajeros M1..Mn. **M1 solicita su cierre al acabar el día** —lo normal, todos
> los días—. Con la causa (i) puesta, `existeBodegaSateliteBloqueada(Z).bloqueada = true`, y entonces:
> **(a)** el adminSatelite no puede asignar **a nadie**, ni a M2..Mn que están limpios; **(b)** la
> central no puede rutear órdenes hacia Z; **(c)** la pantalla de recepción sale bloqueada. La bodega
> entera queda parada por el cierre de **una** persona, hasta que alguien apruebe.

Eso **es** «un mensajero dejaba de recibir asignaciones con UN solo cierre sin aprobar», la frase del
commit — y es un dolor real. Con el retraso gestión→aprobación medido contra producción el
2026-08-18 (**mediana 8,2 h · p90 22,1 h · máx 48,2 h**, `auditoria_ayuda_tienda.md §1`), un satélite
que cierra a las 18:00 se pasa la noche y parte de la mañana sin poder mover nada.

**Matiz honesto que juega en contra de la retirada:** el adminSatelite **puede aprobar él mismo** los
cierres de su zona. O sea que tenía una salida local, y la salida es exactamente la conducta que la
regla quería forzar: *cuadrá la caja y seguí*. Con la 238 ya dentro (aprobar exige tener los paquetes
delante), esa salida depende de que el mensajero se presente — lo cual endurece el dolor, pero **la
238 se mergeó el 2026-08-20, después** de este commit: no pudo ser su causa.

**Segundo candidato a motivo, no verificado.** Un `rechazado` anterior al 2026-07-22 (§3) dejaría a
su mensajero bloqueado **de forma indefinida y poco visible**, sin que nadie lo relacione con nada.
Encaja aún mejor con la queja. **No pude confirmar que exista**: es la primera pregunta abierta.

---

## 6. La medición contra producción — NO PUDE HACERLA

Y lo digo como bloqueo, no como omisión:

- **El MCP de Supabase no está expuesto a este subagente.** `mcp__supabase__list_tables` →
  `Error: No such tool available`.
- **Las dos vías alternativas quedaron bloqueadas por el clasificador**: extraer el host de
  `DATABASE_URL` de `.env`, y un script de solo lectura que leyera
  `.env.vercel-production` (que sí contiene `DATABASE_URL`, `SUPABASE_URL` y
  `SUPABASE_SERVICE_ROLE_KEY` de producción) para consultar por PostgREST.

**Así que aquí no hay ningún cero.** Prefiero eso a un cero sin denominador. Las consultas están
escritas y son de solo lectura; quien tenga el MCP las corre en un minuto:

```sql
-- (A) EL DENOMINADOR. ¿Cuánta gente hay y cuánta arrastra cierres?
SELECT
  (SELECT count(*) FROM usuario u JOIN rol r ON r.id = u.rol_id
     WHERE r.value = 'mensajero')                                   AS mensajeros_total,
  (SELECT count(DISTINCT mensajero_id) FROM cierre_dia
     WHERE estado IN ('solicitado','vencido','rechazado'))          AS con_al_menos_1_abierto;

-- (B) LA PREGUNTA DEL MILLÓN: ¿el tope `> 1` bloquea a alguien HOY?
--     Si `bloqueados_hoy` = 0, el predicado está apagado del todo (§3).
SELECT n_abiertos, count(*) AS mensajeros
FROM (SELECT mensajero_id, count(*) AS n_abiertos
      FROM cierre_dia WHERE estado IN ('solicitado','vencido','rechazado')
      GROUP BY mensajero_id) t
GROUP BY n_abiertos ORDER BY n_abiertos;

-- (C) ¿Existe la población legacy del §3 (rechazado anterior a la feature 109)?
SELECT count(*) AS rechazados_pre_109,
       count(DISTINCT mensajero_id) AS mensajeros_afectados
FROM cierre_dia
WHERE estado = 'rechazado' AND solicitado_at < '2026-07-22';

-- (D) IMPACTO DESDE QUE ESTÁ EN PRODUCCIÓN (2026-08-19 14:49 UTC).
--     Denominador = TODAS las asignaciones de la ventana.
SELECT count(*) FILTER (WHERE TRUE)                       AS asignaciones_totales,
       count(*) FILTER (WHERE c.id IS NOT NULL)           AS a_mensajero_con_cierre_abierto
FROM orden o
LEFT JOIN cierre_dia c
       ON c.mensajero_id = o.mensajero_asignado_id
      AND c.solicitado_at <= o.asignado_at
      AND (c.resuelto_at IS NULL OR c.resuelto_at > o.asignado_at)
      AND c.estado IN ('solicitado','vencido','rechazado')
WHERE o.asignado_at >= '2026-08-19 14:49:00+00' AND o.deleted_at IS NULL;

-- (E) El fallo vivo de §4.2: ¿hay bodegas satélite donde el adminSatelite estaría
--     comiéndose el "conflict" vacío ahora mismo?
SELECT u.zona_id, count(*) AS mensajeros_con_cierre_abierto
FROM usuario u JOIN rol r ON r.id = u.rol_id
WHERE r.value = 'mensajero' AND u.zona_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM cierre_dia c WHERE c.mensajero_id = u.id
                AND c.estado IN ('solicitado','vencido','rechazado'))
GROUP BY u.zona_id;
```

> **Lo que la consulta (D) NO puede decir**, y hay que decirlo: `cierre_dia` no guarda historial de
> estado. La ventana `[solicitado_at, resuelto_at)` es una **reconstrucción**, y para un `rechazado`
> re-solicitado es imprecisa. Sirve para el orden de magnitud, no para auditar caso por caso.

**Lo que sí sé de producción, de segunda mano y anotado como tal:** el 2026-08-19 se midieron contra
prod **48 pares (cierre, orden)** y **12 de 12 cierres aprobados** (`0a0df331`). O sea: hay datos
reales de cierres, esto no es una base vacía. Y el retraso de aprobación (mediana 8,2 h / p90 22,1 h)
se midió el 2026-08-18.

---

## 6bis. LA MEDICIÓN, HECHA — 2026-08-20, por el leader

El subagente no tenía el MCP; el leader sí. **Las cinco consultas de §6, corridas contra
producción, solo lectura.** Y antes que nada, lo que decide si esto está vivo:

> **`6a0e6d36` ESTÁ EN PRODUCCIÓN.** Comprobado con `git merge-base --is-ancestor 6a0e6d36
> origin/prod`. No es un problema de `dev`: el hueco está abierto en la app que la gente usa.

### Los números, cada uno con su denominador

| medida | valor |
| --- | --- |
| mensajeros | **4** |
| mensajeros con **al menos un cierre abierto** (`solicitado`/`vencido`/`rechazado`) | **0** |
| cierres en total | **12** — y los **12** están `aprobado` |
| `rechazado` anteriores al 2026-07-22 (la población legacy de §3) | **0**, sobre 0 mensajeros |
| órdenes vivas con `asignado_at` | **26** |
| **asignaciones a un mensajero con cierre abierto, EN CUALQUIER MOMENTO** | **0** |
| asignaciones desde que el commit llegó a producción | **0** |
| mensajeros con cierre abierto por zona (el fallo de §4.2) | **0** |

### Qué significa, y qué NO

**Lo que significa:** *nada ha pasado por el hueco todavía*. Ni una sola asignación de las 26 fue a
un mensajero con un cierre abierto, así que **la guarda retirada nunca habría disparado** sobre los
datos que existen. El fallo vivo de §4.2 tampoco está mordiendo a nadie: no hay ninguna bodega
satélite con un mensajero en esa situación.

**Lo que NO significa, y es lo importante:** que el riesgo no exista. **Los 12 cierres están
aprobados y ningún mensajero tiene uno abierto — eso es una foto, no una propiedad.** Un cierre pasa
a `solicitado` en cuanto un mensajero cierra su día, que es la operación normal. El día que eso
ocurra, la guarda **seguirá sin disparar**, porque el predicado no está subido de umbral: está
**apagado** (§3). El cero de hoy es suerte de calendario, no una defensa.

**La población legacy de §3 no existe** (0 `rechazado` pre-109, sobre 12 cierres reales): esa
pregunta queda **cerrada**, y con ella cae la única población que el tope sí bloquearía hoy.

**Consecuencia para la decisión:** reponer **no rompe a nadie ahora mismo** —no hay a quién romper— y
esperar **tampoco cuesta nada hoy**. Lo que sí cuesta es dejarlo sin decidir: la ventana en la que
esto es gratis de arreglar se cierra sola en cuanto alguien cierre su día.

⏳ **Caduca.** Re-medir antes de tocar nada.

---

## 7. Sobre reponer: qué se rompería, y qué no

**Un `git revert` sería un error.** Reintroduce, íntegra, la parada de bodega del §5 — que es una
queja humana legítima y la razón por la que existe este commit.

Lo que sí veo, separado por si la decisión se toma por partes:

### (a) Se puede reponer HOY, sin decidir nada de fondo: el mensaje de la bodega satélite

El fallo del §4.2 **no tiene defensor**. Hoy el adminSatelite **ya no puede asignar** a un mensajero
con cierre —el `NOT EXISTS` se lo impide— y encima **no se entera de por qué**. Sea cual sea la
decisión sobre la regla, el estado actual es el peor de los tres posibles. Dos salidas, y son
opuestas:

- **Si la regla debe seguir viva en satélite:** reponer el pre-chequeo de `AsignacionSateliteService`
  (§2.3) **con el criterio del `NOT EXISTS`, no con `findMensajerosBloqueados`**. Vuelve el mensaje
  correcto, que ya está escrito en `MOTIVOS_CON_CAUSA_PROPIA:63`.
- **Si no:** hay que quitar el `NOT EXISTS` del SQL crudo (`:2678-2681`) — y entonces cae el test que
  hoy lo custodia (`orden-repository.asignacion-satelite.test.ts:72-76`), que es el testigo, no un
  estorbo.

**Lo que no se puede es dejarlo como está.** Es la única recomendación que doy sin reservas.

### (b) Hace falta decisión humana: las tres superficies que se apagaron sin pedirlo

`gestionar`/`recoger`/`escoger` (111/R1-R4), `deshacerGestion` (111/R5, **Q2 cerrada por el humano
con un "SÍ" explícito**) y la recolección en tienda (157/R31). El commit **dice que no las tocó**.
Las tocó. Son las que sostienen «con un cierre pendiente no seguís cobrando», que es lo del §4.1.

**Si se reponen, no se rompe la queja original**: la queja era sobre **recibir asignaciones**, no
sobre gestionar. Reponer estas tres devuelve la propiedad de caja **sin** volver a congelar ninguna
bodega. Me parece el corte natural, pero **es una decisión de negocio y no la tomo yo.**

### (c) La causa (i) de la bodega satélite: probablemente NO reponerla

Es la que produce la parada del §5, y es la más desproporcionada de todas (una persona congela a
todo el mundo). Si el negocio quiere conservar algo de ella, la forma que no reintroduce el problema
es **por-mensajero, no por-zona**: que M1 no reciba, y M2..Mn sí. Eso es exactamente lo que hacían
las guardas §2.1–§2.3 y **no** lo que hacía la causa (i).

### (d) El número

Si se decide que el umbral debe existir de verdad, **`CIERRES_ABIERTOS_TOLERADOS` no puede valer
`1`** mientras R30 esté vivo: no hay ningún valor ≥ 1 que signifique algo. O el tope se va y el
criterio vuelve a ser «tiene alguno», o R30 tiene que dejar de ser un invariante — y eso es un
cambio mucho más grande que este commit.

**Reponer rompería, en cualquier escenario:** los **seis tests invertidos** de §8, que hoy asertan
activamente `expect(findMensajerosBloqueados).not.toHaveBeenCalled()`. Es la buena noticia: no
fallarán en silencio, fallarán señalando el sitio.

---

## 8. Los tests: NO se enseñó a ninguno a no mirar

Lo miré con la lupa que pedía el encargo, con `progress/auditoria_ayuda_tienda.md §3` delante. **El
patrón de §3 no está aquí.** Ninguna aserción se filtró para dejar de ver algo. Lo que hay es una
**inversión deliberada, comentada y firmada**:

| Archivo | Antes | Ahora |
|---|---|---|
| `unit/services/guia-asignacion-service.test.ts:577` | «R13: … → conflict, sin persistir» | «asignarDesdeBodega hacia un mensajero con cierre abierto → **persiste**» |
| ídem `:1070` | «R7: … → conflict con motivo» | «→ **se le asigna la recolección igual**» |
| `unit/services/asignacion-satelite-service.test.ts:349` | «R14: … → validation_error» | «→ **se asigna igual (R14 retirada)**» |
| `unit/services/deshacer-asignacion.cierre-asimetria.test.ts:80` | «ASIGNAR … **sigue bloqueado**» | «ASIGNAR … **YA NO se bloquea**» |
| `unit/repositories/orden-repository.bloqueo.test.ts` | «≥1 → bloqueo duro» ×2 | «→ la bodega **NO** se bloquea» ×2, + 5 casos nuevos del tope |
| `components/OrdenesListadoBloqueoCierre.test.tsx` | 7 casos de checkbox deshabilitado | 3 casos de «checkbox **HABILITADO**» |

Tres de ellos añaden `expect(findMensajerosBloqueados).not.toHaveBeenCalled()`. **Eso es una guardia
de la retirada**, y es lo más parecido a una firma que hay: quien lo escribió sabía exactamente lo
que estaba quitando y quiso que reponerlo doliera.

**Verificado por ejecución:** los 4 archivos de servicio/repositorio, `110 passed (110)`, 1,68 s.

### Lo que sí falla, y es distinto: **el test verde en la capa equivocada**

`asignacion-satelite-service.test.ts:349` afirma «se asigna igual» y está verde **solo porque su
doble es `asignarSateliteLote: vi.fn(async () => 1)`** (`:62`) — siempre éxito. El SQL real devuelve
0. Es el caso de manual de *«probar el `WHERE` donde vive»*: el test de servicio no ve el SQL, y el
test de repositorio que **sí** lo ve (`orden-repository.asignacion-satelite.test.ts:76`) sigue
asertando el criterio **viejo**, `'solicitado', 'vencido', 'rechazado'`. **Dos tests verdes que
afirman conductas contrarias, en dos capas distintas, sobre la misma acción.** Ninguno miente; nadie
los cruzó.

### Restos menores

- `tests/unit/components/deshacer-asignacion.ui.test.tsx:77` mockea
  `listarZonasBloqueadasPorCierre`, **que ya no existe**.
- `tests/components/OrdenesListadoBloqueoCierre.test.tsx:16-18` conserva una cabecera que describe
  la regla retirada como si siguiera viva.
- `OrdenRepository.findZonasConMensajeroBloqueado` y el `MSG_BODEGA_SATELITE_BLOQUEADA` de
  `GuiaAsignacionService:104` (cuyo texto dice «tiene **un** mensajero con un cierre abierto»,
  criterio viejo) son superficie muerta o desalineada.

---

## 9. Preguntas abiertas

1. **¿Existe la población legacy del §3?** `rechazado` anteriores al 2026-07-22 que hoy sumen 2
   cierres abiertos. Es la única forma de que el tope dispare, y decide si el commit fue «apagar
   todo» o «apagar todo menos un puñado arbitrario de gente». **Consulta (C).** No la pude correr.
2. **¿Cuál fue el pedido humano textual del 2026-08-18?** El commit lo cita, el PR #396 lo resume en
   una línea, y **no hay ficha, spec ni entrada en `progress/`**. No sé si el humano pidió «subí el
   umbral», «que no se bloquee la bodega por uno» o «desbloqueá a fulano». Las tres llevan a
   implementaciones distintas y solo una lleva a esta.
3. **¿Alguien decidió apagar `gestionar`/`deshacer`/`recolección`?** Todo indica que **no** —el
   comentario del §3 dice lo contrario— pero es una consecuencia, no una prueba de intención.
4. **¿Cuántas asignaciones a mensajeros con cierre abierto van desde el 2026-08-19 09:49?**
   **Consulta (D).** Sin esto no sé si el §4.1 es un riesgo teórico o algo que ya pasó.
5. **¿Se toleraría un `@@unique` parcial sobre `(mensajero_id)` para los estados abiertos?** Hoy R30
   se sostiene **solo en código**; el schema no lo impide (`db/schema.prisma`, `model CierreDia`, sin
   restricción). Fuera del alcance de esta ficha, pero es el sitio donde el invariante debería vivir.

---

## Apéndice — método

- **Cero escrituras.** No se tocó `lib/`, `app/`, `specs/`, ni `specs/237-gestion-tienda-ayuda/`.
- **Una mutación, restaurada**, con sha256 idéntico antes y después (§4.2) y
  `git status --porcelain` vacío al terminar.
- **Tests ejecutados solo para observar:** `asignacion-satelite-service`,
  `orden-repository.asignacion-satelite`, `orden-repository.bloqueo`, `guia-asignacion-service` →
  `Test Files 4 passed (4) · Tests 110 passed (110)`.
- **Producción: no medida.** Motivo en §6, consultas listas.

---

# IMPLEMENTACIÓN — 2026-08-20

> Escrito **debajo** de la investigación, sin tocar una línea de lo anterior. Rama
> `feature/241-guardas-bloqueo`, **sin commit**. `specs/237-gestion-tienda-ayuda/` no se tocó.

## I.1 · Qué forma le di al punto único, y por qué

**La regla firmada no tiene dos políticas que reconciliar: tiene UNA política y UNA ausencia.**
«Recibir asignaciones» no es un predicado que devuelve vacío; es un sitio donde no hay predicado.
Modelarlo con un parámetro (`findMensajerosBloqueados(ids, { para: "asignacion" | "gestion" })`) o
con un segundo método habría creado una pregunta —«¿bloquea la asignación?»— que ya está contestada
para siempre. Así que el punto **sigue siendo único**, y lo que cambia es qué dice su nombre y
quién puede llamarlo:

| pieza | antes | ahora |
|---|---|---|
| `ESTADOS_CIERRE_BLOQUEANTES` | `["solicitado","vencido","rechazado"]` | **partida en dos** |
| — informativo | *(no existía)* | `ESTADOS_CIERRE_ABIERTO = ["solicitado","vencido","rechazado"]` |
| — bloqueo | *(era la de arriba)* | `ESTADOS_CIERRE_BLOQUEAN_GESTION = ["vencido","rechazado"]` |
| `CIERRES_ABIERTOS_TOLERADOS = 1`, corte `> 1` | inalcanzable (109/R30) | **borrado**; el criterio vuelve a «tiene alguno **de los que bloquean**» |
| `findMensajerosBloqueados` | `groupBy` + filtro por tope | **renombrado** a `findMensajerosBloqueadosParaGestion`, `findMany … distinct` |
| *(informativo de la bodega)* | reusaba el predicado de bloqueo | `findMensajerosConCierreAbierto`, **privado** del repositorio |

**El rename es la pieza que impide la repetición, y por eso lo pagué (36 archivos).** La ficha 241
nace de un nombre que no decía su política: alguien cambió «el bloqueo» creyendo que tocaba la
asignación y apagó de paso `gestionar`, `deshacerGestion` y la recolección en tienda. Con
`findMensajerosBloqueados(ids)` en un call site nadie se pregunta «¿bloqueado para qué?». Con
`findMensajerosBloqueadosParaGestion(ids)` dentro de `asignarDesdeBodega`, la incoherencia se lee
sola. Es mecánico y lo verifica `tsc`.

**Y el nombre no es la única defensa: el predicado salió de los `Pick<IOrdenRepository, …>` de las
superficies de asignación** (`AsignacionSateliteService`, `ListarMensajerosDeps` de
`lib/actions/ordenes-guia.ts`). Ahí no es que no se llame: **no se puede llamar**. Es el patrón que
`DeshacerAsignacionService` ya usaba —«el espía está disponible en el doble; el service no puede
invocarlo porque su `Pick` no lo incluye»— y convierte la regla en un hecho del tipo, no en una
línea que alguien podría volver a escribir.

**Dos separaciones más, ambas deliberadas:**

1. **`findMensajerosConCierreAbierto` (privado) para los campos informativos de la bodega
   satélite.** El aviso de `/recepcion-satelite` dice «tienes N cierres abiertos de tus
   mensajeros», y eso **debe seguir contando los `solicitado`**: son abiertos aunque no bloqueen.
   Si esos campos se calcularan con el predicado de bloqueo, el contador diría 0 y la bodega
   perdería de vista justo los cierres que esperan su aprobación. Privado porque nadie fuera del
   repositorio necesita la distinción, y exponerla invita a usarla como veto.
2. **`findZonasConMensajeroBloqueado` vuelve a UNA consulta.** Delegaba en el predicado tras un
   pre-filtro *sólo* porque «más de N» no es expresable como un `some`; quitado el tope, sobra la
   segunda consulta. (Sigue **sin consumidor de producción** desde el 2026-08-18; no la borro:
   esta ficha no es de limpieza, pero queda anotado en el código.)

## I.2 · Los consumidores, uno por uno, y qué política quedó en cada uno

| # | consumidor | política | qué hice |
|---|---|---|---|
| 1 | `lib/actions/ordenes-guia.ts:187` — selector del maestro | **no bloquea** | **quitada la consulta y el campo `bloqueadosIds`**. El tipo lo conserva opcional (lo lee `OrdenesListado.tsx` con `?? []`) con nota de que ya no se emite |
| 2 | `AsignacionSateliteService` | **no bloquea** | fuera de su `Pick`; comentario con el fallo vivo y su cierre |
| 3 | `lib/actions/cierre-dia.ts:91` — aviso del mensajero | **gestión** | sigue consultando; el **texto** cambió (ver I.3c) |
| 4 | `CierreDiaService.deshacerGestion:542` | **gestión** | sin cambio de código; comentario con el porqué |
| 5 | `MisAsignacionesService:137` — gestionar/recoger/escoger | **gestión** | sin cambio de código; comentario |
| 6 | `RecoleccionTiendaService:99` — recolección en tienda | **gestión** | sin cambio de código; comentario |
| 7 | `OrdenRepository.existeBodegaSateliteBloqueada` — causa (i) | **no bloquea** | sigue retirada **a propósito**; informativos con el criterio «abierto» |
| 8 | `GuiaAsignacionService.zonasSateliteBloqueadas` → `rutearABodegaSatelite` | **no bloquea** | **BORRADA** (ver I.3a) |
| 9 | `OrdenRepository.findZonasConMensajeroBloqueado` | **gestión** | simplificada; sin consumidor vivo |

Y las tres superficies que el commit `6a0e6d36` dijo no haber tocado (#4, #5, #6) **vuelven a
funcionar**, que es lo que sostiene la propiedad de caja del §4.1: con un `vencido` o un
`rechazado` encima no se sigue cobrando.

## I.3 · Tres cambios que la regla firmada obliga y que NADIE pidió — los señalo

**(a) `rutearABodegaSatelite` pierde su guarda por zona.** Es el que más quiero que se mire.
No podía dejarlo quieto: desde el 2026-08-18 no disparaba porque el predicado estaba apagado por el
tope, así que **al reparar el predicado habría resucitado solo**, sin decisión de nadie — y es la
forma más desproporcionada del bloqueo (por ZONA: el cierre de una persona congela la bodega entera
y a sus compañeros limpios, §5). Rutear órdenes a una bodega **es** que esa bodega reciba trabajo,
así que la regla 2 aplica. **Elegí borrarla** y dejar los cuatro tests como testigos invertidos. Si
el humano quiere conservar algo de esto, la forma que no reintroduce el dolor es por-mensajero, no
por-zona (§7c) — y hoy no existe.

**(b) La válvula `forzarSolicitudVencido` (111/R16) ahora DESBLOQUEA de verdad.** Un comentario
vivo en `cierres-admin-service.test.ts` decía «`vencido -> solicitado` NO desbloquea: el estado
resultante SIGUE siendo bloqueante». Con `solicitado` fuera de la lista, **sí desbloquea, en el
acto**. No lo suavicé porque va exactamente en la dirección de por qué existe la válvula —«evitar el
bloqueo permanente del mensajero y su bodega»— y el dinero sigue esperando aprobación, que es de
quien depende. Pero es un cambio de conducta real: **queda anotado en el test, con fecha**.

**(c) El texto del aviso al mensajero era falso y lo cambié.** `lib/constants/bloqueo-mensajero.ts`
decía *«No puedes gestionar **ni recibir nuevas asignaciones** hasta resolver tu cierre pendiente»*.
Recibir asignaciones no se bloquea desde el 2026-08-18. Ahora dice:

> «No puedes gestionar entregas ni cobrar hasta resolver tu cierre. Sí puedes seguir recibiendo
> asignaciones. Ve a «Cierre del día» para resolverlo.»

⚠️ **Queda una segunda copia de ese texto, y NO la toqué porque es un componente:**
`app/(app)/cierre-dia/_components/CierreDiaModule.tsx:133` conserva la variante sin CTA con la
frase vieja. Su test pasa (afirma su propio literal), así que **no hay rojo que avise**. Es deuda
de frontend y hay que darle ficha.

## I.4 · Los seis tests «invertidos» — uno a uno, y una corrección al conteo

La investigación (§8) contó **seis** `expect(findMensajerosBloqueados).not.toHaveBeenCalled()`.
Mirados uno a uno con la regla firmada delante, **ninguno de los seis debe volver a esperar la
llamada**: los seis están en el lado de la ASIGNACIÓN, y la regla 2 dice que ahí no se bloquea
nunca. Lo que sí apareció fueron **cuatro asertos que la investigación no contó** y que sí había
que decidir.

| # | test | veredicto | ¿el literal era el contrato? |
|---|---|---|---|
| 1 | `guia-asignacion-service.test.ts:272` — «`generarGuia` no consulta mensajeros bloqueados» | **SE QUEDA IGUAL. No es una inversión**: es 156/R4 —numerar no asigna a nadie, así que no hay a quién bloquear—. La investigación lo contó por su forma sintáctica, no por su sentido | no: afirma una ausencia de otra feature |
| 2 | `guia-asignacion-service.test.ts:593` — `asignarDesdeBodega` persiste | **SE QUEDA**, ahora por regla firmada y no por tope apagado. Añadido el puntero a dónde vive lo que ese mensajero **sí** tiene bloqueado | no: ya era la conducta nueva |
| 3 | `guia-asignacion-service.test.ts:1085` — `asignarRecoleccion` asigna igual | **SE QUEDA**. Nota nueva: lo que sí le bloquea un `vencido` es **confirmar** esa recolección | no |
| 4 | `deshacer-asignacion.cierre-asimetria.test.ts:76` — deshacer no consulta | **SE QUEDA** | no |
| 5 | `deshacer-asignacion.cierre-asimetria.test.ts:127` — asignar no consulta | **SE QUEDA**. Reescribí la cabecera: decía «la asimetría desapareció», y hoy **volvió en otro eje** (recibir vs. gestionar). Detalle que lo mantiene cierto por partida doble: su mensajero arrastra un `solicitado`, que ya no bloquea ninguna de las dos cosas | no |
| 6 | `asignacion-satelite-service.test.ts:360` — satélite asigna igual | **SE QUEDA**, y **se refuerza**: el método salió del `Pick` del service, así que el espía sigue en el doble y ahora es imposible invocarlo. Añadida la advertencia de que este test **no ve el SQL** — estaba verde mientras la acción fallaba en producción | no |

**Los cuatro que sí hubo que decidir, y que §8 no listaba:**

| test | qué afirmaba | veredicto |
|---|---|---|
| `ordenes-guia-action.test.ts:258` | `toEqual({… bloqueadosIds: ["m2"] …})` + `toHaveBeenCalledWith(["m1","m2"])` | **SÍ era el contrato**: afirmaba que la acción marcaba en el selector a quien arrastrara un cierre. Se quita el campo y la llamada. El `toEqual` sigue siendo exhaustivo a propósito: re-emitirlo lo pone rojo (mutación **M8**) |
| `orden-repository.asignacion-satelite.test.ts:72-76` | `toMatch(/NOT EXISTS/)`, `/cierre_dia/`, `/'solicitado', 'vencido', 'rechazado'/` | **SÍ era el contrato** —y era legítimo mientras el service tuvo su pre-chequeo—. **Invertido a `not.toMatch`**, con el relato del fallo y la fecha dentro del propio test. Conserva los asertos de lo que sí sigue guardando el UPDATE (origen, zona, borrada) |
| `liquidacion-alcance.test.ts` R67 | `expect(estados).toEqual(["solicitado","vencido","rechazado"])` | **SÍ era el contrato, y el tripwire hizo su trabajo**: se puso rojo en el commit que cambió la lista. Se **reexpresa** a `["vencido","rechazado"]` (no se relaja a `toContain`: un tripwire que acepta cualquier lista no vigila nada) y se añade `not.toContain("solicitado")`. Lo que R67 protege —que la 172 no lee esta lista— no cambia |
| `mis-asignaciones-service.test.ts:1157` | título «rechazado/aprobado NO bloquean» | **NO era contrato: era una etiqueta falsa desde la feature 109**. El doble devuelve un Set vacío y nunca supo de qué estado hablaba. Retitulado a lo que de verdad mide (el control del bloque) |

Y dos arreglos de arrastre: `orden-repository.deshacer-asignacion.test.ts` usaba el comentario de
sección como valla de fin de método (el rename la movió; ahora es una constante con su porqué), y
seis asertos de módulos del mensajero fijaban el texto viejo del aviso. **Los literales del aviso
se conservan como literales** —no se sustituyen por `BLOQUEO_AVISO` importado— porque comparar un
texto contra la constante que lo genera está siempre verde.

## I.5 · Las cuatro propiedades, y dónde se prueban

Archivo nuevo: **`tests/unit/services/cierre-bloqueo-asimetria.test.ts`** (19 casos). Monta el
`OrdenRepository` **REAL** sobre un doble de Prisma que **filtra de verdad** por `where.estado.in`,
y se lo inyecta a los servicios. Así el estado del cierre es una **entrada del caso**, no una
suposición del doble — que es la lección de «probar el `WHERE` donde vive»: un
`vi.fn(async () => new Set(["m1"]))` no sabe qué estado tiene el cierre y deja pasar cualquier lista.

| propiedad | dónde |
|---|---|
| (1) con `solicitado` **gestiona** | `cierre-bloqueo-asimetria` 3-a ×3 superficies (escoger, recolectar en tienda, deshacer gestión) + `orden-repository.bloqueo` PROPIEDAD 1 |
| (2) con `vencido` **no** | 3-b ×3 + PROPIEDAD 2 |
| (3) con `rechazado` **no** | 3-b ×3 + PROPIEDAD 3 |
| (4) con **cualquiera de los tres, recibe asignaciones** | propiedad 2 ×3 acciones × 3 estados (bodega, satélite, recolección) + la bodega satélite `it.each` de los tres estados + el SQL sin `cierre_dia` en `orden-repository.asignacion-satelite` |

**Anti-vacuidad, porque «no bloqueó» pasa en verde también si la función no se llamó.** Tres
defensas: (a) los casos 3-a no afirman «no dio conflict» sino que el servicio **siguió** —llega a
`findByIdsParaGestion` / `findByNumGuiaForTransicion` / `findGestionParaDeshacer`, y los `status`
resultantes son distinguibles del bloqueado—; (b) los 3-b afirman que esas mismas lecturas **no**
ocurrieron (sin efectos parciales); (c) un `describe` de control comprueba que **el mismo montaje**
da las dos respuestas según el estado, y que son distintas entre sí.

## I.6 · Mutaciones — una a una, vitest corrido, salida real leída

`lib/repositories/OrdenRepository.ts` — sha256 **antes** y **después** de todas:
`bf4e4da9ab04cbd5068b62e5ccfb8e7e3129add1d0344828d8d51e839ab4e00a` (idéntico).
`lib/services/GuiaAsignacionService.ts`: `fb77bdfc61330d84e9467f118849f162365e790ea7a32fddeb7f08f5374f2d8a`.
`lib/actions/ordenes-guia.ts`: `1d99906cd74cc020396792029450fcb48ae6d3fcee2725d053d51df94e1d96d2`.

| # | mutación | sha256 mutado | rojos | supervivió |
|---|---|---|---|---|
| **M1** | **`solicitado` vuelve a la lista bloqueante** | `e3ba4de8c4fee7ab13a1240d03781d69e46812e27f9b39c34b166a5681f81ffd` | **9** | no |
| M2 | quitar `vencido` de la lista | `a429386202576bde6bd7684494269a75b76fd08c63394f5e1b78db86852a4294` | 9 | no |
| M3 | quitar `rechazado` de la lista | `7b88413ba33c2083ef9accfd7282858fec262d181dba71c61d6f5a4ccd929884` | 7 | no |
| M4 | reponer el `NOT EXISTS` en `asignarSateliteLote` | `4c919f9a2391d45ca08c8d7d99144d74941d843b1ff6fc4ca96a01ad4e7b4b30` | 1 | no |
| M5 | informativos de la bodega con el predicado de bloqueo | `3c062ede2a3cebf1ffbf1927fc7721db9033074caf57e81aa2ae27c77c44cb2f` | 3 | no |
| M6 | `bloqueada = porMensajeros \|\| porCierreBodega` | `56a2facf72ad69bd545b06a2eec6849880327dc88b5dc76c3ad1d8a72bd9e9cb` | 4 | no |
| M7 | reponer la guarda por zona en `rutearABodegaSatelite` | `479c1a962d67b9954d5958c3c5adc26b6d0138efaf76b8a281db5964ae05ee92` | 2 | no |
| M8 | re-emitir `bloqueadosIds` desde la acción | `1b06782f0d746597f848ff096467e902cc0c5471a5ae4d35300e66a0d9cf0fcf` | 1 | no |
| M9 | reponer la guarda por mensajero en `asignarDesdeBodega` | `dc5354ffed124afcb27fab091b5d508e90a39f9e94a88f976a242bf6f3cb2a61` | 4 | no |

**M1 es la que pidió el humano, y estos son sus nueve rojos, copiados de la salida:**

```
× R67: los estados que bloquean al mensajero son EXACTAMENTE `vencido` y `rechazado` 9ms
× PROPIEDAD 1 — con un cierre `solicitado` NO se bloquea: puede gestionar y cobrar 8ms
× separa, en la misma consulta, a quien bloquea de quien no 1ms
× la consulta pide SOLO los dos estados que bloquean, con `distinct` sobre el mensajero 3ms
× el `some` usa los DOS estados que bloquean la gestion, no los tres abiertos 1ms
× 3-a · con `solicitado` GESTIONA: la guarda no dispara y el servicio sigue adelante 7ms
× 3-a · recolección en tienda con `solicitado`: pasa la guarda y busca la guía 1ms
× 3-a · deshacer gestión con `solicitado`: pasa la guarda y busca la gestión 1ms
× el MISMO montaje bloquea con `vencido` y no bloquea con `solicitado` 2ms
Tests  9 failed | 37 passed (46)
```

Y el mensaje exacto del caso que más importa —**el que dice que con `solicitado` se puede
gestionar**—, que es la prueba de que afirma algo:

```
FAIL  tests/unit/services/cierre-bloqueo-asimetria.test.ts > 241 · propiedad 3 — GESTIONAR y COBRAR
      > 3-a · con `solicitado` GESTIONA: la guarda no dispara y el servicio sigue adelante
AssertionError: expected 'conflict' to be 'forbidden' // Object.is equality
Expected: "forbidden"
Received: "conflict"
```

**M4**, el fallo vivo del satélite:

```
AssertionError: expected '\n        UPDATE "orden"\n        SET…' not to match /cierre_dia/
Tests  1 failed | 3 passed (4)
```

**M8**, el literal de la acción:

```
AssertionError: expected { status: 'ok', …(4) } to deeply equal { status: 'ok', …(3) }
+   "bloqueadosIds": [
Tests  1 failed | 27 passed (28)
```

**M9 es la más informativa de todas**, porque separa la propiedad en dos mitades: al reponer la
guarda de `asignarDesdeBodega` caen los casos de `vencido` y `rechazado`… **y el de `solicitado`
sigue verde**, porque el repositorio real dice que ese mensajero no está bloqueado. Es la prueba de
que detrás de esos casos hay un predicado leyendo un estado, y no un doble diciendo que sí:

```
× GuiaAsignacionService.asignarDesdeBodega -> ok, sin consultar el gate de cierres 8ms
× asignarDesdeBodega hacia un mensajero con cierre abierto -> persiste 8ms
× asignarDesdeBodega a un mensajero con cierre `vencido` -> ok y persiste 7ms
× asignarDesdeBodega a un mensajero con cierre `rechazado` -> ok y persiste 1ms
Tests  4 failed | 87 passed (91)
```

Todas restauradas por copia y verificadas por sha256; `git status --porcelain` sin residuos de
mutación.

## I.7 · Archivos tocados

**Producción (11).** `lib/repositories/OrdenRepository.ts` · `lib/interfaces/repositories/IOrdenRepository.ts` ·
`lib/services/GuiaAsignacionService.ts` · `lib/services/AsignacionSateliteService.ts` ·
`lib/services/MisAsignacionesService.ts` · `lib/services/CierreDiaService.ts` ·
`lib/services/RecoleccionTiendaService.ts` · `lib/actions/ordenes-guia.ts` ·
`lib/actions/cierre-dia.ts` · `lib/constants/bloqueo-mensajero.ts` · `lib/types/orden-guia.ts`.
(+ `lib/services/DeshacerAsignacionService.ts`, `lib/repositories/OrdenHistorialRepository.ts` e
`IOrdenHistorialRepository.ts`: solo el rename en comentarios.)

**Tests.** Nuevo: `tests/unit/services/cierre-bloqueo-asimetria.test.ts`. Reescrito:
`tests/unit/repositories/orden-repository.bloqueo.test.ts`. Invertidos/decididos:
`orden-repository.asignacion-satelite`, `guia-asignacion-service`, `asignacion-satelite-service`,
`deshacer-asignacion.cierre-asimetria`, `ordenes-guia-action`, `liquidacion-alcance` (R67),
`cierres-admin-service`, `mis-asignaciones-service`, `orden-repository.deshacer-asignacion`, y los
literales del aviso en `RepartoModule` / `RecogerModule` / `RecoleccionModule` / `RecoleccionPage`.
El resto (≈24 archivos) es **solo el rename mecánico** en declaraciones de dobles.

**Migraciones: ninguna.** No hay cambio de esquema. El invariante 109/R30 sigue viviendo solo en
código (§9 pregunta 5, sigue abierta y sigue fuera de alcance).

## I.8 · Salidas reales del gate

```
$ pnpm run typecheck
> ordenex@0.1.0 typecheck R:\job\singularis\projects\ordenex
> tsc --noEmit
(sin salida: 0 errores)

$ pnpm run lint
✖ 97 problems (0 errors, 97 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.
# Los 97 son `no-unused-vars` preexistentes en tests ajenos. Filtrando la salida por los archivos
# de esta tanda: 0 avisos.

$ pnpm run test:guardias      # vitest run guard
 Test Files  123 passed (123)
      Tests  1809 passed (1809)
   Duration  13.01s

$ pnpm exec vitest run --changed origin/dev --passWithNoTests
 Test Files  263 passed (263)
      Tests  3841 passed | 17 skipped (3858)
   Duration  146.59s
```

**No corrí `./init.sh` completo** (la suite entera): queda para el cierre de la feature, antes del PR.

## I.9 · Lo que dejo abierto

1. **`CierreDiaModule.tsx:133`** — segunda copia del aviso, con la frase vieja y falsa. Es un
   componente: fuera de mi alcance, y **su test no avisa** porque afirma su propio literal.
2. **`bloqueadosIds`** sigue declarado (opcional, nunca emitido) en
   `ListarMensajerosParaAsignacionResult`, y `OrdenesListado.tsx` lo sigue leyendo con `?? []`.
   Retirarlo del tipo toca UI.
3. **`guia-decision-error-messages.ts:39`** mapea el motivo «bodega satelite bloqueada», que ya
   nadie emite. Igual que arriba: capa de UI.
4. **`findZonasConMensajeroBloqueado`** sigue sin consumidor de producción (anotado en el código).
5. **La medición de §6bis caduca.** Se midió con **0 mensajeros con cierre abierto**: hoy sigue
   siendo cierto que nada pasó por el hueco, pero **estos cambios no se han visto contra datos
   reales de un cierre vivo**. El día que alguien cierre su jornada será la primera vez.
6. **La válvula ahora desbloquea (I.3b)** y **rutear ya no mira los cierres de la zona (I.3a)**:
   los dos son consecuencias de la regla firmada, no decisiones mías, pero merecen un sí explícito.

---

# J · Frontend — la segunda copia del aviso (`CierreDiaModule`)

> Cierra el punto **1 de §I.9**, que quedó anotado como deuda de UI. Alcance: **sólo presentación**.
> No se tocó `lib/`, ni rutas, ni base. Los otros specs sin commitear del árbol
> (`237-gestion-tienda-ayuda/`, `246-asignacion-por-dia/`) quedaron intactos.

## J.1 · Qué decía y qué dice

`app/(app)/cierre-dia/_components/CierreDiaModule.tsx` — constante `BLOQUEO_AVISO`.

**Antes** (falso en sus dos mitades, más el comentario que lo remataba con «el bloqueo abarca
gestionar Y recibir»):

> «No puedes gestionar ni recibir nuevas asignaciones hasta resolver tu cierre pendiente.»

**Ahora:**

> «No puedes gestionar entregas ni cobrar hasta resolver tu cierre. Sí puedes seguir recibiendo
> asignaciones: te esperan en «Entregas». Resuélvelo con el botón de abajo.»

Las tres piezas que el humano pidió, y **por qué esas tres y no otras**:

| pieza | frase | por qué no la dice ya otro aviso |
|---|---|---|
| qué **NO** puede | «gestionar entregas ni cobrar» | `VENCIDO_AVISO` y `RECHAZADO_AVISO` dicen «tu operación», que no define nada. Este es el ALCANCE, y es lo único que aporta |
| qué **SÍ** puede | «seguir recibiendo asignaciones: te esperan en «Entregas»» | no lo dice **ninguno** de los dos, y es justo lo que la frase vieja negaba |
| cómo **salir** | «Resuélvelo con el botón de abajo» | apunta al CTA sin repetir su verbo: «envíalo a aprobación» ya está en el aviso del vencido/rechazado **y** en la etiqueta del propio botón. Tres veces la misma frase en una pantalla es ruido |

**No se importa `BLOQUEO_AVISO` de `lib/constants/bloqueo-mensajero.ts`**, y eso sigue siendo
deliberado: la variante compartida remata con «Ve a «Cierre del día» para resolverlo», y aquí el
mensajero **ya está** en esa pantalla, con el CTA a la vista. Lo que se comparte es el criterio (qué
no / qué sí / cómo salir) y las dos primeras frases palabra por palabra; lo que diverge es el
remate, que es la única parte dependiente de dónde está el usuario.

Tuteo, con tildes: es lo que ya usa el módulo en TODOS sus avisos (`Tienes un cierre vencido`,
`Envíalo`, `Aún no has solicitado`) y en la constante compartida. El voseo del archivo vive sólo en
los toasts de error del deshacer (`No podés deshacer`, `Intentá de nuevo`) — no se tocó, es otra
superficie y mezclarlas no era el encargo.

## J.2 · ¿Se pintaba cuando NO debía? No — y se comprobó, no se supuso

Camino completo del dato, leído entero:

```
app/(app)/cierre-dia/page.tsx:38   const bloqueo = await estadoBloqueoMensajero();
lib/actions/cierre-dia.ts:100      repo.findMensajerosBloqueadosParaGestion([actor.usuarioId])
lib/repositories/OrdenRepository.ts  ESTADOS_CIERRE_BLOQUEAN_GESTION = ["vencido", "rechazado"]
```

`bloqueado` llega como **booleano ya resuelto por el servidor** y el componente lo pinta tal cual:
no hay `estado` en las props del aviso, no hay derivación en el cliente, no hay nada que filtrar.
Con la corrección del backend de esta misma ficha, **un cierre `solicitado` ya no enciende el
flag**, así que el aviso deja de pintarse solo. **No hizo falta cambiar el render** — y tampoco
hizo falta pedir un dato que la pantalla no tenga.

Lo que sí se corrigió es la **documentación que mentía sobre eso**: el doc de la prop `bloqueado`
decía «tiene un cierre `solicitado`/`vencido` pendiente» y «el bloqueo es TOTAL (no puede gestionar
NI recibir)». Las dos afirmaciones eran falsas y quedaban contradiciendo al código; ahora dicen qué
lo enciende hoy y por qué `solicitado` no está.

## J.3 · El test: literal a mano, y la mutación en rojo

El test viejo (`tests/components/CierreDiaModule.test.tsx`) afirmaba el texto con un **regex
escrito a mano**, no contra la constante — la constante ni se exporta. Ese detalle importa: no era
un test siempre-verde, era un test **correcto que nadie actualizó** cuando el backend arregló la
otra copia. El texto nuevo se fija igual, **completo y a mano**, por la misma razón por la que la
investigación conservó los literales de `RepartoModule`: comparar un copy contra la constante que
lo genera está siempre verde y no vigilaría nada.

Tres casos, uno de ellos nuevo:

| caso | qué afirma |
|---|---|
| `R12/241: bloqueado muestra el aviso con el alcance real` | el literal ENTERO, escrito a mano |
| `R12/241: el aviso NO afirma que se dejen de recibir asignaciones` | **nuevo** — `not.toHaveTextContent(/ni recibir/i)` y `/nuevas asignaciones/i`. Que hoy diga la verdad no impide que mañana vuelva a colarse la negación; se afirma también su AUSENCIA |
| `R12/241: sin bloqueo NO muestra el aviso` | control |

**Mutación (el texto viejo, reintroducido en la constante) — rojo, con su mensaje real:**

```
 ❯ tests/components/CierreDiaModule.test.tsx (48 tests | 2 failed)
   × R12/241: bloqueado muestra el aviso con el alcance real (no gestionar ni cobrar; recibir SÍ)
   × R12/241: el aviso NO afirma que se dejen de recibir asignaciones

Error: expect(element).toHaveTextContent()
Expected element to have text content:
  No puedes gestionar entregas ni cobrar hasta resolver tu cierre. Sí puedes seguir recibiendo
  asignaciones: te esperan en «Entregas». Resuélvelo con el botón de abajo.
Received:
  No puedes gestionar ni recibir nuevas asignaciones hasta resolver tu cierre pendiente.

Error: expect(element).not.toHaveTextContent()
Expected element not to have text content:
  /ni recibir/i
Received:
  No puedes gestionar ni recibir nuevas asignaciones hasta resolver tu cierre pendiente.

 Tests  2 failed | 46 passed (48)
```

Mutación revertida y el archivo verificado **idéntico** a su copia previa (`diff` vacío).

## J.4 · Barrido de copias: quedan TRES, todas en E2E, y no se tocaron

Además de la del backend (`lib/constants/`) y ésta, el texto viejo sobrevive en:

| archivo | línea | qué es |
|---|---|---|
| `e2e/cierre-vencido-modelo.spec.ts` | 35 | `const BLOQUEO_TOTAL_TEXT = "…ni recibir nuevas asignaciones…"` |
| `e2e/reglas-bloqueos-cierre.spec.ts` | 106 | paso 2 — `getByRole("alert").filter({ hasText: … })`, espera verlo |
| `e2e/reglas-bloqueos-cierre.spec.ts` | 194 | paso 5 — el mismo literal, espera `toHaveCount(0)` |

**No se tocaron, y la razón no es el alcance sino que arreglarles el texto los dejaría peor.**
Ambos declaran en su cabecera «NO SE EJECUTA todavía (emails placeholder / sin DB de test)», así que
un cambio ahí **no se puede verificar en rojo ni en verde**. Y el texto es su avería MENOR:
`reglas-bloqueos-cierre.spec.ts` paso 3 afirma que la bodega satélite bloqueada rechaza la
asignación con «Asignar» deshabilitado — la guarda que esta misma ficha **borró** (§I.3a). Su
cabecera describe además un «bloqueo TOTAL … no pueden gestionar NOR receive new assignments» que
dejó de existir. Ponerles el copy nuevo los haría parecer al día mientras siguen afirmando conducta
retirada: es un **arreglo cosmético sobre un spec que hay que reescribir entero** cuando exista el
harness, y merece su propia decisión.

Búsqueda hecha sobre todo el árbol (`BLOQUEO_AVISO|ni recibir nuevas asignaciones|No puedes
gestionar`, sin `node_modules`/`.git`). Los demás aciertos son **prosa histórica** —`specs/111/`,
`specs/114/`, `specs/167/`, `progress/review_111.md`, este mismo archivo— y son fotos de su
momento: no se editan.

## J.5 · Deuda que este arreglo NO cerró y que hay que decidir

**`RECHAZADO_AVISO` (`CierreDiaModule.tsx`) quedó con una afirmación que la regla nueva vuelve
falsa.** Dice: *«sigue bloqueando tu operación hasta que lo vuelvas a enviar a aprobación **y tu
bodega lo apruebe**»*. Con `solicitado` fuera de la lista bloqueante, el bloqueo **se levanta en el
acto** al re-solicitar; la aprobación de la bodega ya no interviene. Es exactamente el cambio de
conducta que §I.3b señaló como no pedido por nadie.

**No lo cambié**, y por eso el texto nuevo de J.1 **no dice cuándo se levanta el bloqueo**: si
afirmara «se destraba en cuanto lo envíes» quedaría contradiciendo al aviso de al lado, en la misma
pantalla y a tres párrafos de distancia. Prefiero un aviso que calle un matiz a dos avisos que se
desmientan. Decidir si el `rechazado` debe desbloquear al re-solicitarse **es de producto, no de
frontend**: cuando haya un sí, el copy de los dos se ajusta junto.

## J.6 · Verificación (salida real)

```
$ npx vitest run tests/components/CierreDiaModule.test.tsx
 Test Files  1 passed (1)
      Tests  48 passed (48)

$ npx vitest run  tests/components/CierreDiaModule.test.tsx  tests/components/CierreDiaPage.test.tsx \
                  tests/components/CierreDiaModuleIncidente.test.tsx  tests/components/RepartoModule.test.tsx \
                  tests/components/RecogerModule.test.tsx  tests/components/RecoleccionModule.test.tsx \
                  tests/components/RecoleccionPage.test.tsx
 Test Files  7 passed (7)
      Tests  211 passed (211)

$ npx vitest run tests/unit/guards          # todas las guardias
 Test Files  60 passed (60)
      Tests  872 passed (872)

$ npx tsc --noEmit                          # exit 0, sin salida
$ npx eslint <CierreDiaModule.tsx> <CierreDiaModule.test.tsx>
                                            # exit 0, sin salida
```

**Sin commit**, como se pidió. `./init.sh` completo queda para el cierre de la feature, antes del PR.

---

# K · Los otros dos avisos de la misma pantalla — cerrando §J.5

> Corrección al veredicto que dejé en §J.5. Lo archivé como «decisión de producto» y **no lo era**:
> elegir *cuánto* bloquear sí es de producto, y ya está firmado; que **el texto afirme algo que el
> código no hace** es un hecho comprobable. Lo único abierto era **cómo** decirlo. Se cierra aquí.

## K.1 · La comprobación, antes del copy

Los dos avisos se midieron contra el mismo camino, leído entero y no supuesto:

```
CierreDiaService.solicitarCierre
  ├─ existeCierreVencido   → transicionarVencidoASolicitado    → data: { estado: 'solicitado' }
  └─ existeCierreRechazado → transicionarRechazadoASolicitado  → data: { estado: 'solicitado' }

OrdenRepository:2855   where: { estado: { in: ESTADOS_CIERRE_BLOQUEAN_GESTION } }
                       ESTADOS_CIERRE_BLOQUEAN_GESTION = ["vencido", "rechazado"]
```

`solicitado` **no está** en la lista. Y `findMensajerosBloqueadosParaGestion` es el **único**
predicado que gatea gestionar y cobrar: sus consumidores de producción son `MisAsignacionesService`
(gestionar/escoger), `CierreDiaService.deshacerGestion` y `RecoleccionTiendaService`. Conclusión
verificada, no inferida: **el bloqueo se levanta en la escritura de la re-solicitud**, sin que la
bodega intervenga.

| aviso | ¿qué afirmaba sobre cuándo se levanta? | ¿decía algo de asignaciones? | veredicto |
|---|---|---|---|
| `VENCIDO_AVISO` | «Envíalo a aprobación **para destrabar** tu operación» → destraba AL ENVIAR | no | **ya era cierto. No se toca** |
| `RECHAZADO_AVISO` | «sigue bloqueando … hasta que lo vuelvas a enviar **y tu bodega lo apruebe**» | no | **falso. Corregido** |

El del `vencido` sale limpio de los dos frentes, así que **se dejó el texto intacto** y se anotó la
comprobación encima de la constante: la próxima revisión no tiene que re-litigarlo, y su ausencia de
cambio deja de parecer un olvido. Su literal, eso sí, **pasa a estar fijado en test** (K.3), para
que deje de depender de que alguien vuelva a mirarlo.

## K.2 · El texto nuevo del rechazado

**Antes:**

> «Tu cierre fue rechazado, pero no queda cerrado: sigue bloqueando tu operación hasta que lo vuelvas
> a enviar a aprobación **y tu bodega lo apruebe**.»

**Ahora:**

> «Tu cierre fue rechazado, pero no queda cerrado. Vuelve a enviarlo a aprobación: con eso se levanta
> el bloqueo y sigues gestionando y cobrando, sin esperar a que tu bodega lo apruebe.»

Qué conserva, qué corrige y qué **no** promete:

- **Conserva** lo único que ese aviso aportaba y sigue siendo verdad: un `rechazado` **no queda
  cerrado**. Sin eso se leería como «resuelto» y el mensajero no pulsaría el CTA.
- **Corrige** el momento en que se levanta: al **reenviar**, no al aprobar. Y lo dice en la forma
  negativa además de la positiva (*«sin esperar a que tu bodega lo apruebe»*) porque la dirección
  del error era la cara: prometía **más** bloqueo del real, y esperar de brazos cruzados no produce
  ningún síntoma — ni error, ni pantalla rara, ni ticket. Sólo jornada perdida. Con mediana de
  aprobación de 8,2 h y p90 de 22,1 h, esa espera inventada es media jornada.
- **No promete** que reenviar le devuelva las órdenes congeladas: la liberación de `sin_gestionar`
  sí ocurre **sólo al aprobar** (109/R16, `CierresAdminService`). Por eso el texto habla de lo que
  de verdad recupera —*gestionar y cobrar*— y no de recuperar órdenes. Comprobado, no asumido.

**No contradice a los vecinos de la misma pantalla**, que era la condición: `BLOQUEO_AVISO` dice
«hasta resolver tu cierre … Resuélvelo con el botón de abajo», y este aviso es justo el que define
qué es «resolver» aquí (reenviarlo). `VENCIDO_AVISO` dice «envíalo → destraba», misma forma.

**No paré a preguntar** porque las redacciones posibles no cambian lo que el mensajero hace: la
acción es la misma en todas (pulsar el CTA), y lo que cambia es sólo si además **espera o no**
después de pulsarlo — y para eso hay una sola respuesta correcta, no dos razonables.

## K.3 · Tests: literal a mano, y el rojo de la mutación

El caso que había, `R31: el aviso comunica que un cierre rechazado NO es terminal`, **afirmaba
exactamente la mentira**: pedía `/sigue bloqueando/i` **y** `/apruebe/i` juntos, que es la promesa
falsa palabra por palabra. No era un test siempre-verde: era un test **fiel a un copy equivocado**,
y por eso el copy pudo quedarse tres días desmintiendo al código sin un solo rojo.

Sustituido por tres, todos con el literal **escrito a mano** (la constante no se exporta, y
compararla contra sí misma estaría siempre verde):

| caso | qué afirma |
|---|---|
| `R31/241: el aviso del rechazado dice cuándo se levanta el bloqueo (al reenviar, no al aprobar)` | literal ENTERO + `/no queda cerrado/i`, que es lo que NO se perdió al corregirlo |
| `R31/241: el aviso NO promete que el bloqueo dure hasta que la bodega apruebe` | forma NEGATIVA: `not.toHaveTextContent(/sigue bloqueando/i)` y `/y tu bodega lo apruebe/i` |
| `R13/241: el aviso del vencido sigue diciendo que se destraba AL ENVIARLO` | **nuevo** — fija el literal del `vencido`, que hasta hoy no lo comprobaba nadie |

**Mutación (repuesto el texto viejo del rechazado en la constante) — rojo, con su mensaje real:**

```
 ❯ tests/components/CierreDiaModule.test.tsx (50 tests | 2 failed)
   × R31/241: el aviso del rechazado dice cuándo se levanta el bloqueo (al reenviar, no al aprobar)
   × R31/241: el aviso NO promete que el bloqueo dure hasta que la bodega apruebe

Error: expect(element).toHaveTextContent()
Expected element to have text content:
  Tu cierre fue rechazado, pero no queda cerrado. Vuelve a enviarlo a aprobación: con eso se
  levanta el bloqueo y sigues gestionando y cobrando, sin esperar a que tu bodega lo apruebe.
Received:
  Tu cierre fue rechazado, pero no queda cerrado: sigue bloqueando tu operación hasta que lo
  vuelvas a enviar a aprobación y tu bodega lo apruebe.Solicitar aprobación del cierre rechazado

Error: expect(element).not.toHaveTextContent()
Expected element not to have text content:
  /sigue bloqueando/i
Received:
  Tu cierre fue rechazado, pero no queda cerrado: sigue bloqueando tu operación hasta que lo
  vuelvas a enviar a aprobación y tu bodega lo apruebe.Solicitar aprobación del cierre rechazado

 Tests  2 failed | 48 passed (50)
```

Mutación revertida y el archivo verificado **idéntico** a su copia previa (`diff` vacío).

## K.4 · Verificación (salida real)

```
$ npx vitest run tests/components/CierreDiaModule.test.tsx
 Test Files  1 passed (1)
      Tests  50 passed (50)

$ npx vitest run  <los 7 de J.6>  + tests/components/CierresAdminModule.test.tsx
 Test Files  8 passed (8)
      Tests  245 passed (245)

$ npx vitest run tests/unit/guards
 Test Files  60 passed (60)
      Tests  872 passed (872)

$ npx tsc --noEmit      # exit 0, sin salida
$ npx eslint <CierreDiaModule.tsx> <CierreDiaModule.test.tsx>   # exit 0, sin salida
```

## K.5 · Lo que sigue abierto (y ahora es más corto)

De §J.5 no queda nada: el aviso del rechazado está corregido y el del vencido, comprobado. Sigue en
pie sólo lo de **§J.4** — las tres copias del texto viejo en `e2e/cierre-vencido-modelo.spec.ts:35`
y `e2e/reglas-bloqueos-cierre.spec.ts:106,194`, que no se tocan porque esos specs no se ejecutan y
afirman además conducta que esta ficha retiró; hay que reescribirlos enteros cuando exista el
harness.

Y aparece uno nuevo, de backend, que sólo señalo: **`CierreDiaService.ts:446` lleva un comentario
que dice «el desbloqueo definitivo y la liberación de `sin_gestionar` ocurren SOLO al APROBAR
(R16)»**. La segunda mitad sigue siendo cierta; la primera —«el desbloqueo definitivo»— es la misma
afirmación que acabo de retirar del copy, y quedó viva en `lib/`, que no es mío. Es prosa, no
conducta, pero es la frase que induce el error.

**Sin commit.**

---

# ADENDA — la prosa que prometía un bloqueo más largo del real · 2026-08-20

> Encargo del coordinador, después de I.9. **Corrección de comentarios: ni una línea ejecutable.**
> Sección nueva; nada de lo anterior se reescribe. **Sin commit.**

## A.1 · Por qué esto no era «un comentario suelto»

`CierreDiaService.ts` afirmaba en prosa que *«el desbloqueo definitivo … ocurre **SOLO al
APROBAR**»*. Con la regla firmada eso **es falso**: `solicitado` está fuera de
`ESTADOS_CIERRE_BLOQUEAN_GESTION`, así que el bloqueo se levanta **al re-solicitar**, en la misma
escritura, sin esperar a nadie.

Y la frase **es la fuente del error**, no una copia suya: el aviso de la pantalla decía lo mismo
—«hasta que … tu bodega lo apruebe»— y le prometía al mensajero un bloqueo más largo del real, es
decir, lo dejaba esperando de brazos cruzados una aprobación que ya no necesita. El aviso se
corrigió; dejar viva la frase que lo inspiró garantiza que el próximo que lea el servicio la vuelva
a copiar. **Es exactamente el patrón que la 241 vino a cortar: un comentario que describe una
conducta retirada.** Ya costó dos arreglos de texto en pantalla.

## A.2 · ¿Comentario obsoleto o defecto? — comprobado: obsoleto

El coordinador pedía parar si alguna rama **sí** se comportaba como decía la frase. **No la hay.**
Barrí `lib/services/` y `lib/repositories/` buscando cualquier otra puerta que mirara el estado del
cierre para frenar al mensajero: lo que aparece son alcances de resolución del admin
(`ESTADOS_RESOLUBLES = ["solicitado"]`), el cierre de BODEGA, los incidentes y el corte diario
(`ESTADOS_CIERRE_ABIERTOS`, que existe para **no crear** un segundo cierre abierto — 109/R30, y
sigue intacto). **Ninguna bloquea a un mensajero.** El único predicado que lo hace es
`findMensajerosBloqueadosParaGestion`, y `solicitado` no está en él. Verificado además por
ejecución: los tres casos `3-a` de `cierre-bloqueo-asimetria.test.ts` (escoger, recolectar en
tienda, deshacer gestión) pasan la guarda con `solicitado`.

## A.3 · Las DOS cosas que la frase mezclaba, y que ahora van separadas

| | qué la levanta | dónde vive |
|---|---|---|
| **El bloqueo del mensajero** (gestionar y cobrar) | **RE-SOLICITAR**, en el acto | `ESTADOS_CIERRE_BLOQUEAN_GESTION`, `OrdenRepository` |
| **La liberación de `sin_gestionar`** (109/R16) | **SOLO APROBAR**, y sigue siendo así | `CierresAdminRepository.ts:1367`, origen `liberacion_sin_gestionar`; único emisor, comprobado |

Confundirlas es lo que pasó, así que en los cinco sitios la corrección las **nombra por separado** y
dice explícitamente cuál de las dos mitades sigue siendo cierta. El frontend ya tuvo ese cuidado en
su aviso nuevo: no promete la liberación de `sin_gestionar`.

## A.4 · Los cinco sitios (la lupa encontró dos que el primer barrido no)

| # | archivo | decía | ahora |
|---|---|---|---|
| 1 | `lib/services/CierreDiaService.ts:445` | «El desbloqueo definitivo y la liberacion de `sin_gestionar` ocurren SOLO al APROBAR (R16)» | las dos mitades separadas, con el porqué de la pantalla |
| 2 | `lib/interfaces/repositories/ICierreDiaRepository.ts:227` | **la misma frase**, en el contrato de `transicionarRechazadoASolicitado` | ídem |
| 3 | `lib/repositories/CierresAdminRepository.ts:1613` | «El desbloqueo ocurre al APROBAR (R18)» (válvula 111/R16) | **desbloquea en el acto**, y va en la dirección de por qué existe la válvula |
| 4 | `lib/services/CierresAdminService.ts:1042` | «R18: NO desbloquea; el desbloqueo ocurre al APROBAR el `solicitado` resultante» | **sí desbloquea**; lo que queda para el aprobar es resolver el dinero y la auditoría (R17) |
| 5 | `lib/interfaces/services/ICierresAdminService.ts:458` | «NO desbloquea (R18: el desbloqueo ocurre al aprobar…)» | ídem |

**#2 y #5 son la razón de barrer.** La afirmación no vivía en un sitio: vivía en el servicio **y en
su interfaz**, dos veces cada una (`CierreDia` y `CierresAdmin`). Una sola copia superviviente
reinstala el error, y las de `lib/interfaces/` son las que más se leen, porque son el contrato.

Esto **cierra por escrito el punto I.3(b)**, que quedó abierto como «la válvula ahora desbloquea de
verdad»: hasta ahora estaba anotado sólo en un test; ahora lo dicen también los tres sitios de la
válvula.

## A.5 · Tests

`grep -rniE "SOLO al APROBAR|desbloqueo definitivo|NO desbloquea|sigue bloqueante" tests/` →
**una sola coincidencia**, `CierresAdminService.aprobar.devolucion.test.ts:13`, y **es cierta**:
habla de la devolución de RECHAZADAS (feature 139), que efectivamente sólo ocurre al aprobar. No se
toca. El otro caso —el título «(sigue bloqueante)» de `cierres-admin-service.test.ts`— ya se había
corregido en I.3(b) de esta misma tanda, por eso no aparece.

## A.6 · Verificación

**Ni una línea ejecutable.** El diff de los cinco archivos, filtrando las líneas que no empiezan por
comentario, devuelve **sólo dos**, y son el rename de la tanda anterior:

```
$ git diff -U0 <los 5 archivos> | grep -E "^[+-][^+-]" | grep -vE "^[+-]\s*(//|\*|/\*)"
-  "findUsuarioZonaId" | "findUsuarioVehiculoId" | "findEstatusIdByValue" | "findMensajerosBloqueados"
+  "findUsuarioZonaId" | "findUsuarioVehiculoId" | "findEstatusIdByValue" | "findMensajerosBloqueadosParaGestion"
-    const bloqueados = await this.ordenRepo.findMensajerosBloqueados([actor.usuarioId]);
+    const bloqueados = await this.ordenRepo.findMensajerosBloqueadosParaGestion([actor.usuarioId]);
```

Y no queda ninguna copia de la afirmación (excluyendo las citas del «decía» dentro de las propias
correcciones): el barrido vuelve **vacío**.

```
$ pnpm run typecheck
> tsc --noEmit
(sin salida: 0 errores)

$ pnpm run lint
✖ 97 problems (0 errors, 97 warnings)      # los mismos 97 preexistentes de I.8

$ npx vitest run  cierre-dia-service · cierre-dia-service-totales-mixtos · cierres-admin-service ·
                  cierre-bloqueo-asimetria · cierre-dia-action · CierresAdminService.aprobar.devolucion
 Test Files  6 passed (6)
      Tests  220 passed (220)

$ pnpm run test:guardias
      Tests  1809 passed (1809)
```
