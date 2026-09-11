# 412 — Diseño técnico

> Requisitos en `requirements.md` (26, sin preguntas abiertas). Desglose en `tasks.md`.
> Zona **backend**. **Gate: `./init.sh` COMPLETO, sin excepción** (§11).
> Todo lo de §1 se verificó **en el archivo real**, no sólo en el grafo del MCP.
> **Ficha PREVENTIVA:** producción, 2026-09-11 — **78 cierres `aprobado`, 5 `solicitado`, 0
> `rechazado`** desde el arranque comercial del 2026-08-27. **Nadie verá un cambio al desplegar**, y
> ninguna decisión de aquí tiene que respetar una fila previa. Lo que sí está vivo es el fallo del
> §3 (A1), esperando al primer rechazo.

---

## §0 — El problema técnico en una frase

El rechazo de un cierre es **un hecho nuevo cada vez que ocurre**, y hoy se le cuelga a una entidad
que no cambia (el cierre) y a un aviso que habla de otra cosa (el bloqueo). Esta ficha le da al
rechazo **su propio evento** y **su propia entidad**, para que el mensajero se entere **siempre** y
**cada vez**, y borra la duplicación en el mismo movimiento.

---

## §1 — Lo que ya existe y NO se toca

| Pieza | Qué hace hoy | Esta ficha |
| --- | --- | --- |
| `predicadoVisibilidad` (`lib/repositories/NotificacionRepository.ts`) | fuente única de R13-R17 de la 146 | **no se toca** (R26) |
| `notificacion_dedupe_key` | UNIQUE `(evento, entidad_id, destinatario_rol, destinatario_usuario_id)`, `NULLS NOT DISTINCT`, `WHERE entidad_id IS NOT NULL` | **no se toca**; se respeta al elegir la entidad (§3) |
| `emitirFilas` + `existeNoLeidaPara` + `crear` (absorbe `P2002`) | guardia de dedupe | se reutiliza tal cual |
| `presentacionDe` (`lib/notificaciones/presentacion-aviso.ts`) | título = `descripcion`, cuerpo = `anexo`, destino = atajo del catálogo | **no se toca**: el evento nuevo no es agregado y cae en la rama normal |
| `estaBloqueadoPorCierres` (`lib/utils/bloqueo-cierre.ts`) | la regla de la 271 | **no se toca ni un carácter** |
| `avisoBloqueo` (`lib/constants/bloqueo-mensajero.ts`) | compositor del aviso de bloqueo, compartido con tres pantallas | **no cambia su salida**; sólo se **exporta** una constante suya (§4) |
| `resolverCierre` (`lib/repositories/CierresAdminRepository.ts:1735`) | escribe `estado`, `resuelto_por`, `resueltoAt: new Date()`, `motivo_rechazo`, guardado por `ESTADOS_RESOLUBLES` y por el alcance | **no se toca** |
| `emitirCierreDiaVencido` / `emitirMensajeroBloqueado` | los dos avisos de la 271 | el segundo gana **un parámetro obligatorio** de alcance (§6); su texto y su entidad, intactos |

⚠️ **Dos hechos medidos que el diseño usa como cimiento:**

1. `estaBloqueadoPorCierres({n,v}) = n>=2 || v>=1` y un cierre `rechazado` **suma a `V`**
   (`CIERRE_ESTADOS_RESOLICITABLES`). Luego **un rechazo confirmado casi siempre deja bloqueado** al
   mensajero, y el aviso de bloqueo casi siempre sale. La rama «no bloquea» del título de la ficha
   existe (la carrera de `CierresAdminService.ts:304`) pero es la minoritaria: **el agujero grande
   es el otro**, el del §0 de `requirements.md`.
2. La re-solicitud **reutiliza la misma fila de `cierre_dia`** (`transicionarASolicitado`,
   `CierreDiaRepository.ts:616`), así que dos rechazos del mismo cierre comparten `cierre_dia.id`.
   Ésa es toda la razón de §3.

---

## §2 — El evento nuevo

```
NotificacionEvento       += cierre_dia_rechazado
NotificacionEntidadTipo  += cierre_dia_rechazo
```

**Por qué un evento y no una variante de texto del bloqueo** (A6 en §9): el compositor `avisoBloqueo`
lo comparten **tres productores** (el corte, la solicitud y el rechazo) y **tres pantallas**
(271/R43/R52). Meter «rechazado» ahí lo volvería falso para las otras dos causas —un `vencido` no lo
rechazó nadie— y además el tipo de evento es lo que la campana usa para **agrupar y deduplicar**:
una diferencia metida en la descripción es invisible para todo lo que no sea leer la frase.

**Catálogo** (`lib/notificaciones/catalogo-avisos.ts`), entrada 14:

```ts
cierre_dia_rechazado: {
  porDefecto: {
    clase: "accionable",
    atajo: { href: "/cierre-dia", etiqueta: "Ver mi cierre" },
  },
  destinatarios: ["mensajero"],
},
```

- **Accionable** por las tres condiciones de la 409: pide una acción (corregirlo y reenviarlo), tiene
  consecuencia si no se hace (no se le liquida y sigue bloqueado) y **él** puede resolverla.
- **Con atajo**, por el criterio aprobado —*«¿le acerca esta pantalla a resolverlo?»*—: `/cierre-dia`
  no es un mirador, es **donde ejecuta la re-solicitud**. Mismo destino y misma etiqueta que
  `cierre_dia_vencido` y `mensajero_bloqueado_por_cierres` para el mensajero: tres avisos de su
  cierre, un solo sitio al que ir.
- **Sin `porRol`**: sólo hay un destinatario (R2).
- El `Record<NotificacionEvento, EntradaCatalogo>` hace que el valor nuevo **no compile** sin decidir
  (R20). Lo mismo el tipo espejo de `lib/types/notificacion.ts`.

---

## §3 — La entidad de dedupe: la decisión que evita un silencio total

```
entidad_tipo = "cierre_dia_rechazo"
entidad_id   = `${cierreId}:${resueltoAtISO}`
destinatario = { tipo: "usuario", usuarioId: mensajeroId }
```

**`resueltoAtISO` es `cierre_dia.resuelto_at` leído DESPUÉS de la escritura**, no un reloj del
servicio. Viaja ya en `CierreAdminResumenRow.resueltoAt` (`ICierresAdminRepository.ts:47`, ISO), que
es exactamente lo que `findCierreByIdEnAlcance` devuelve y lo que el servicio relee.

**Por qué NO el cierre a secas.** Es la trampa que este repo ya pagó tres veces (262, 403, y casi la
409) y que **sigue viva** en el aviso de bloqueo: con `entidad_id = cierreId`, la clave
`('cierre_dia_rechazado', '<cierreId>', NULL, '<mensajeroId>')` admite **una sola fila para siempre**
—el índice no mira el estado de lectura— y `crear` absorbe el `P2002` devolviendo `false`. Como
`rechazado` es re-solicitable y la re-solicitud **reutiliza la misma fila**, el ciclo normal de esta
pantalla —rechazo, corrección, rechazo— dejaría **el segundo rechazo mudo, sin error y sin log**. Y
el segundo rechazo es justo cuando más falta hace el aviso: significa que lo que corrigió no bastó.

**Por qué el instante y no el día** (A2 en §9): el ciclo rechazo → corrección → rechazo ocurre
**dentro del mismo día** (el admin rechaza a las 09:00, el mensajero reenvía a las 09:20, se lo
rechazan a las 09:40). El día calendario es el grano correcto de un **recordatorio** que se repite
mientras dure un estado —`gasto_fijo_cobro_dia` (333), `geocodificacion_caida_dia` (401),
`novedades_sin_gestionar_dia` (409)—, no el de un **hecho** que puede repetirse varias veces al día.
Aquí la pregunta no es «¿ya avisé hoy?» sino «¿ya avisé de **este** rechazo?».

**Por qué esto SÍ deduplica el mismo hecho (R8/R9).** Dos emisiones del mismo rechazo leen el mismo
`resuelto_at` ⇒ la misma entidad ⇒ la segunda choca con el índice único y es un no-op. Que la
exclusión la decida **el índice** y no un `if` es lo que la hace resistente a una carrera.

**Precisión, declarada:** `resuelto_at` se escribe con `new Date()` en cada resolución y el `UPDATE`
sólo se aplica si el cierre está en `ESTADOS_RESOLUBLES` (`solicitado`/`vencido`), así que **entre
dos rechazos del mismo cierre hay obligatoriamente una re-solicitud humana**: dos instantes ISO
iguales al milisegundo no son alcanzables. Precedente de forma: `webhook_suscripcion_pausa` de la
403, `'<owner>:<sin_exito_desde ISO>'`.

**Por qué no `entidad_id = NULL`:** con `null`, `emitirFilas` se salta su guardia previa y el índice
único es **parcial** (`WHERE entidad_id IS NOT NULL`): saldría un aviso por cada ejecución.

---

## §4 — El texto

Vive en `lib/notificaciones/emitir.ts`, que es la casa única de lo que se persiste (146 §4.6).

```ts
export function textoCierreRechazadoMensajero(
  jornadaCR: string | null,
  quedaBloqueado: boolean,
): string;
```

Salidas, **literales** (los tests las afirman a mano):

```
jornada fiable + bloqueado:
  "Tu cierre del 21 de agosto fue rechazado. Revísalo, corrígelo y vuelve a enviarlo a aprobación.
   Mientras tanto no puedes entregar, cobrar ni recibir trabajo nuevo."

jornada fiable + NO bloqueado:
  "Tu cierre del 21 de agosto fue rechazado. Revísalo, corrígelo y vuelve a enviarlo a aprobación."

sin jornada fiable:
  "Tu cierre del día fue rechazado. Revísalo, corrígelo y vuelve a enviarlo a aprobación."
```

- **La fecha es la JORNADA, no el nacimiento del cierre** (R11), y sale del **único derivador**
  (`lib/utils/jornada-cierre.ts`, 271/R61). Sin jornada fiable, «Tu cierre del día»: se omite, no se
  inventa (R12). Es el mismo patrón, palabra por palabra, de `textoCierreVencidoMensajero`.
- **La segunda frase es una CONSTANTE COMPARTIDA, no una redacción nueva (R14).** `NO_PUEDES`
  (`lib/constants/bloqueo-mensajero.ts:49`) pasa de privada a **exportada**, y el emisor la importa.
  Es la lista de lo que el servidor va a rechazar, y ya hay **tres** redacciones de esa misma idea en
  el árbol (`NO_PUEDES`, `textoCierreVencidoMensajero`, y la de la pantalla): esta ficha **no añade
  una cuarta**. Una guardia de árbol afirma que la frase aparece **una sola vez**.
- **Tuteo**, como sus dos hermanos dirigidos al mismo mensajero en la misma pantalla
  (`textoCierreVencidoMensajero`, `avisoBloqueo`). El voseo del repo se usa en los avisos a tienda y
  bodega (`Coordiná la devolución`); mezclarlo en la campana del mensajero sería ruido de registro.
- **Sin el motivo del rechazo, y no por disciplina: por construcción.** El `motivo_rechazo` **no
  entra en el contexto del emisor**, así que no hay nada que filtrar. Es texto libre escrito por un
  humano y puede traer un teléfono, un nombre o un monto (misma razón que 262/R48); además la ficha
  **414** documenta que ese motivo puede llegar a contradecir su propio distintivo. El motivo se lee
  en `/cierre-dia`, que es donde la autorización por cierre vive.
- **Sin anexo** (R16): la fecha ya está dentro del texto, igual que en los dos avisos de la 271.
- `tipo: "alert"` — dinero del mensajero y bloqueo, como `cierre_dia_vencido` para él.

Contexto del emisor, **sin un solo campo de más**:

```ts
export interface CierreRechazadoContexto {
  cierreId: string;
  /** `cierre_dia.resuelto_at` de ESTE rechazo, en ISO. Es la mitad de la entidad (§3). */
  resueltoAtISO: string;
  /** El dueño del cierre: ÚNICO destinatario (R2). */
  mensajeroUsuarioId: string;
  /** Ya derivada por el único derivador. `null` -> el texto omite la fecha. */
  jornadaCR: string | null;
  /** Leído DESPUÉS del rechazo. Decide la segunda frase, y nada más. */
  quedaBloqueado: boolean;
}
```

---

## §5 — Dónde se engancha

Un solo sitio, y ya existe: la rama `updated` de `CierresAdminService.rechazarCierre`
(`lib/services/CierresAdminService.ts:1425`). `avisarBloqueoPorRechazo` se **renombra y se amplía** a
`avisarDelRechazo`, con tres unidades best-effort **independientes**:

```
rechazarCierre → res === "updated"
  └─ avisarDelRechazo(cierreId, alcance)
       ├─ (1) LECTURAS, best-effort            findCierreByIdEnAlcance + findBloqueoDetalle + findJornadaDeCierre
       ├─ (2) aviso al MENSAJERO, best-effort  notificarCierreDiaRechazado(ctx)      ← SIEMPRE (R1)
       └─ (3) aviso a la BODEGA, best-effort   notificarBloqueo({..., destinatarios: "solo_bodega"})
                                                                                     ← sólo si bloqueado (R18)
```

- **(2) y (3) son unidades separadas a propósito (R5):** con un solo `emitirBestEffort` envolviendo
  las dos, un fallo en la primera se llevaría la segunda por delante.
- **Fuera de la transacción y después de que confirme**, exactamente como hoy: en Postgres un error
  de sentencia aborta la transacción entera, y un aviso caído **revertiría un rechazo legítimo**. *El
  rechazo manda, el aviso es cortesía* (R4).
- **Las lecturas se hacen una vez y se comparten.** Si `findCierreByIdEnAlcance` devuelve `null` o
  `resueltoAt` es `null` —inalcanzable tras un `updated`, pero se comprueba— **no se emite nada** y
  queda registrado: **fallo cerrado**, nunca un aviso con una entidad inventada.
- **El alcance del re-leído es el MISMO que autorizó la escritura**, como hoy: el aviso no puede
  alcanzar un cierre que ese admin no podía tocar.
- **Composition root (R6):** `lib/actions/cierres-admin.ts` pasa `notificarCierreDiaRechazadoReal`
  como argumento de `new CierresAdminService(...)`; el default del servicio sigue siendo
  `notificadorNoOp`. Trece suites instancian este servicio contra **una base local compartida**: un
  default real las convertiría en productoras de avisos. El test de `notificacion-notificadores-reales`
  afirma que **alguien lo PASA**, no que alguien lo importe — es la familia «2 de 7 notificadores
  muertos con la suite en verde».

---

## §6 — La convivencia con el aviso de bloqueo

**Regla: un hecho, un aviso por persona.** En la rama del rechazo:

| Destinatario | Hoy | Tras esta ficha |
| --- | --- | --- |
| **mensajero** | `mensajero_bloqueado_por_cierres` (si bloquea), o **nada** | **`cierre_dia_rechazado`, siempre** — y sólo ése |
| maestro, admin, adminSatelite de la zona | `mensajero_bloqueado_por_cierres` (si bloquea) | **igual, sin cambios** |

`MensajeroBloqueadoContexto` gana un campo **obligatorio** (sin default, para que ningún productor
pueda no decidir; es el mismo mecanismo del `Record` del catálogo):

```ts
readonly destinatarios: "mensajero_y_bodega" | "solo_bodega";
```

- `CierreDiaService` (la solicitud) pasa `"mensajero_y_bodega"` → **su comportamiento no cambia** (R19).
- `CierresAdminService` (el rechazo) pasa `"solo_bodega"`.

**Por qué gana el aviso nuevo y no el de bloqueo.** Los dos irían al mismo sitio (`/cierre-dia`) a
pedir la misma acción, así que dos filas serían **dos «por hacer»** en el distintivo de la 409 para
**un solo trabajo** —y, con la 410 encima, **dos pushes**, porque el cupo diario es por
`(usuario, evento, jornada)` y son eventos distintos—. De los dos textos, sólo uno dice **qué pasó**:
el de bloqueo es literalmente el mismo que recibe quien dejó vencer su cierre. Y lo único que el
mensajero pierde —el recuento de cuántos cierres arrastra en el caso `N ≥ 2`— lo lee **entero** al
llegar a `/cierre-dia`, que es a donde el atajo lo lleva y donde `CierreDiaModule` pinta
`avisoBloqueo(..., { conCta: false })`.

⚠️ **Cambia un comportamiento de la 271, y el riesgo es CERO MEDIDO. Aprobado por el humano el
2026-09-11 (D1).** Queda escrito con el dato para que nadie lo lea dentro de seis meses como «un
cambio arriesgado que se coló»: **esa fila nunca se ha emitido**, porque en producción hay **0
cierres `rechazado` en toda la historia** (78 `aprobado`, 5 `solicitado`, desde el 2026-08-27). No
hay ninguna persona a la que se le retire un aviso que estuviera recibiendo. Lo que sí está vivo es
el defecto que sustituye: hoy ese mensajero leería **el mismo texto que por un `vencido`**, y sólo el
rechazo exige corregir algo. La alternativa —emitir los dos— está descartada en §9 (A7) con su coste.

---

## §7 — La jornada del cierre rechazado

Método **nuevo** en `IOrdenRepository` / `OrdenRepository` —donde ya vive la derivación—:

```ts
findJornadaDeCierre(cierreId: string): Promise<string | null>
```

Una sola consulta (`cierreDia.findUnique` con `select: { createdAt, gestiones: { where: { anuladaAt: null }, select: { createdAt } } }`)
y el resultado se pasa por **`derivarJornada`**, el único derivador (271/R61). `CierresAdminService`
ya recibe `ordenRepo` como `Pick<IOrdenRepository, …>`: se le añade este método al `Pick`.

**Alternativa descartada: reusar `bloqueo.aReenviarPrimero.jornadaCR`**, que ya viene en la lectura
que el servicio hace. Es el cierre **re-solicitable más viejo**, que coincide con el recién rechazado
sólo cuando éste es el más viejo; en el resto de casos el aviso fecharía **otro cierre**. Es
exactamente el fallo que `CierreDiaRepository.findCierreParaAviso` documenta («el aviso apuntaba al
otro cierre y la clave de dedupe se calculaba sobre la entidad equivocada — silencio o aviso falso,
sin que nada se pusiera rojo»). Una consulta más en un camino que un humano ejecuta a mano y pocas
veces es barata; fechar el cierre equivocado, no.

**Alternativa descartada: derivarla de `detalle.gestiones`** del `findCierreByIdEnAlcance` que el
servicio ya hace. Esa proyección es `CierreGestionPendienteRow` —lo que la **pantalla** necesita—, no
«todas las vinculadas y no anuladas»: la fecha del aviso acabaría dependiendo de qué pinte el
detalle.

---

## §8 — Push (R23): elegible, y por qué

El criterio aprobado de la 410 es *«sólo lo merece lo que tiene **plazo** o **dinero**, y siempre
agregada»*. Este aviso tiene **las dos cosas**, y no por analogía:

- **Dinero:** el cierre es la liquidación del mensajero. Rechazado, no se le paga hasta que lo
  corrija, lo reenvíe y se lo aprueben.
- **Plazo, y de los caros:** mientras el cierre siga sin aprobar, el servidor le rechaza **entregar,
  cobrar y recibir trabajo nuevo** (`estaBloqueadoPorCierres`). Cada hora que tarda en enterarse es
  una hora en la que no puede trabajar. Es el mismo argumento con el que el humano metió
  `cierre_dia_vencido` (D2) y `mensajero_bloqueado_por_cierres` en el catálogo de push.

```ts
// lib/notificaciones/push-elegibles.ts  (410 §3)
cierre_dia_rechazado: <perfil "usuario">,   // el mensajero, y sólo él
```

No es elegible para ningún rol, porque **no existe fila de rol de este evento** (R2). Y no hay riesgo
de doble push por el mismo hecho: la fila de bloqueo del mensajero ya no se crea en esta rama (§6), y
las copias a bodega de `mensajero_bloqueado_por_cierres` la 410 ya las declara **no elegibles**.

⚠️ **`lib/notificaciones/push-elegibles.ts` NO existe en `dev` hoy** (medido: la 410 está
`in_progress`, en su rama, y **en revisión** el 2026-09-11 — o sea que muy probablemente entre antes
que ésta). De ahí las dos ramas de la tarea **T6.1** y la forma condicional de R23 («DONDE exista…»):
si la 410 entra antes, esta ficha añade la línea y el typecheck la exige; si entra después, la 410
encuentra el evento en el enum y **R2 de la 410 no la deja compilar sin decidirlo**. En ninguno de
los dos órdenes se puede colar en silencio.

---

## §9 — Alternativas descartadas

| # | Alternativa | Por qué se descarta |
| --- | --- | --- |
| **A1** | **Entidad = el cierre** (`cierre_dia` + `cierreId`), como el aviso de bloqueo | El **segundo rechazo del mismo cierre no avisaría nunca**, en silencio: la clave única no mira el estado de lectura y la re-solicitud reutiliza la fila. Es el fallo de la 262 y la 403, y es el que esta ficha viene a no repetir |
| **A2** | **Entidad = `${cierreId}:${diaCR}`** | El ciclo rechazo → corrección → rechazo cabe entero en un día. El día es el grano de un **recordatorio**, no el de un **hecho** repetible |
| **A3** | **Entidad = el mensajero** | Peor que A1: un solo aviso de rechazo por persona **para siempre** |
| **A4** | **`entidad_id = NULL`** | `emitirFilas` se salta la guardia y el índice único es parcial: un aviso por ejecución |
| **A5** | **El instante lo pone el servicio** (`new Date()`) en vez de `resuelto_at` | Dos emisiones del **mismo** rechazo (un reintento) crearían dos entidades ⇒ dos avisos por un hecho. El instante persistido es el único que identifica el rechazo |
| **A6** | **No crear evento: que `avisoBloqueo` diga «rechazado»** | Ese compositor lo comparten tres productores y tres pantallas (271/R43/R52). Sería **falso** para el `vencido` y para la acumulación, y la campana agrupa y deduplica **por evento**: la diferencia quedaría invisible |
| **A7** | **Emitir los DOS avisos al mensajero** (no tocar la 271) | Es la opción más barata. Se descarta por ruido **medido en consecuencias**: dos «por hacer» en el distintivo para un solo trabajo, dos filas que descartar, y **dos pushes** (el cupo de la 410 es por `(usuario, evento, jornada)` y son eventos distintos). La 409 fijó las reglas anti-ruido justo para esto. Y su único argumento a favor —«no cambia nada vivo»— **se cae con el número**: lo que cambia no se ha ejercido nunca (0 rechazos). **Descartada por el humano el 2026-09-11 (D1)** |
| **A8** | **Derivar el aviso al leer**, sin fila en `notificacion` | La 410 necesita un **hecho en un instante** al que engancharse; sin fila no hay push. Ya lo razonó la 409 §5.1 |
| **A9** | **Incluir el motivo del rechazo en el texto** | Texto libre de un humano: puede traer teléfono, nombre o monto (262/R48, 146 §4.6). Y la 414 documenta que ese motivo llega a contradecirse. Se lee en `/cierre-dia`, que autoriza por cierre |
| **A10** | **Avisar también a la bodega del rechazo** | Quien rechaza es la bodega: avisarle de su propio clic es ruido puro. Su aviso —el de bloqueo— sigue igual (R18) |

---

## §10 — Modelo de datos y migración

### 10.1 — La migración (la única de la ficha)

```
db/migrations/<ts>_notificacion_evento_cierre_rechazado/
  migration.sql
    ALTER TYPE "notificacion_evento"       ADD VALUE IF NOT EXISTS 'cierre_dia_rechazado';
    ALTER TYPE "notificacion_entidad_tipo" ADD VALUE IF NOT EXISTS 'cierre_dia_rechazo';
  down.sql
    recrea los DOS tipos con la lista PREVIA leída de `db/schema.prisma` de `origin/dev`
```

- **Aditiva**: ninguna tabla, ninguna columna, ningún índice, ninguna política RLS. Sin backfill.
- **Va sola y con timestamp propio**: Postgres no deja usar un valor de enum recién añadido en la
  misma transacción que lo añadió (`55P04`) y Prisma corre cada `migration.sql` en una. Su primer uso
  ocurre en runtime, en transacciones posteriores.
- **Jamás renumerar una carpeta ya aplicada**: deja una fila fantasma que `migrate status` no ve. Si
  el timestamp chocara con una migración ya aplicada, se crea otra carpeta con timestamp nuevo.

### 10.2 — El `down.sql`, con las DOS trampas de este repo

**Trampa 1 — la lista se lee del árbol, no de la memoria.** Los **ocho** `down.sql` previos de estos
enums (146, 253, 262, 271, 333, 403, 401, 409) son **fotos de su momento y todas siguen siendo
ciertas**: **no se toca ninguno**; editarlos sería «migración editada en sitio = drift». Pero **la
lista de ESTE down** se escribe leyendo `db/schema.prisma` de `origin/dev` **justo antes de abrir el
PR**, no antes: si otra ficha añade un valor a estos enums y entra en `dev` primero, revertir con la
lista vieja **borraría en silencio** el valor de la otra. Le pasó a la 401 con la 403. Hoy, en `dev`,
son **13 eventos y 11 entidades** (medido el 2026-09-10); esa cifra **caduca**, y por eso es la tarea
**T2.4** y no un recordatorio.

**Trampa 2 — NO es una sola columna, y ya no se puede dar por hecho.** Recrear un enum obliga a
reconstruir **todas** las columnas que lo usan **antes** del `DROP TYPE ... _old`; si queda una, el
`DROP TYPE` falla y el rollback aborta. Hoy `notificacion_evento` lo usa **sólo**
`notificacion.evento` (verificado en `db/schema.prisma`), pero **la 410 añade una segunda:
`push_envio_dia.evento`** (`specs/410-notificaciones-push/design.md §4.2`), y está `in_progress`. Por
eso el down **no se copia del de la 409**: la lista de columnas se **enumera** justo antes de
escribirlo (T2.4), y por cada una va su `ALTER TABLE … ALTER COLUMN … TYPE … USING (…::text::…)`.

```sql
-- enumeración obligatoria antes de escribir el down (solo lectura):
SELECT c.table_name, c.column_name
FROM information_schema.columns c
WHERE c.udt_name IN ('notificacion_evento','notificacion_entidad_tipo')
ORDER BY 1, 2;
```

**Precondición ruidosa, declarada (R25):** ninguna fila de `notificacion` con `evento =
'cierre_dia_rechazado'` ni con `entidad_tipo = 'cierre_dia_rechazo'`. Si quedara alguna, el `USING`
falla y el rollback **aborta**. Es el comportamiento correcto: son avisos de trabajo pendiente que su
destinatario puede no haber leído. **Aquí no hay ningún `DELETE` para «hacer sitio».**

**Los índices se verifican, no se suponen:** que `notificacion_dedupe_key` conserve su
`NULLS NOT DISTINCT` y su `WHERE entidad_id IS NOT NULL` tras la reconstrucción lo mide un test
contra Postgres real (R24), igual que hicieron la 253, la 262, la 271, la 333, la 403, la 401 y la 409.

---

## §11 — Gate, secuenciación y colisiones

**El gate es `./init.sh` COMPLETO, y no es opcional.** `--rapido` **se niega solo** por tres motivos
independientes (`docs/verification.md`): el diff toca `db/schema.prisma`, `db/migrations/**` y
`lib/types/**`, y además toca archivos con **nombre de dinero** (`cierre`). Y después del merge a
`dev`, la corrida completa en segundo plano.

⚠️ **Sin `DATABASE_URL` resoluble, los archivos de `tests/integration/db/**` se SALTAN** y la suite
termina verde sin haber tocado la capa de datos. **El corazón de esta ficha vive ahí**: el dedupe
(R7-R10), la jornada (R11) y la migración (R24/R25). Si el gate los reporta `skipped`, la ficha **no
está verificada**: hay que mirar los `skipped`, no sólo el `INIT_EXIT`.

**Secuenciación con la 410 (`in_progress`, rama `feat/410-notificaciones-push`).** Zonas distintas
—esta es `backend`, aquélla `fullstack`—, así que el arnés las admite en paralelo, **pero solapan en
archivos**:

| Archivo | 412 | 410 |
| --- | --- | --- |
| `db/schema.prisma` | +1 evento, +1 entidad_tipo | +2 modelos, +1 `job_tipo` | 
| `lib/notificaciones/emitir.ts` | +1 emisor, +1 texto | `emitirFilas`: `!== null` |
| `lib/notificaciones/notificadores.ts` | +1 tipo, +`Con`, +`Real`, +no-op | `repoReal()` decorado |
| `lib/notificaciones/push-elegibles.ts` | +1 línea (R23) | lo **crea** |
| `lib/repositories/NotificacionRepository.ts` | — | `crear` → `Promise<string \| null>` |

**Lo recomendado: que esta ficha entre DESPUÉS de la 410**, y es además lo probable — la 410 está
**en revisión** el 2026-09-11, y ésta es de complejidad baja. Si aun así entra antes, el implementer
de la 410 encuentra el evento nuevo y **R2 de la 410 le impide compilar sin decidirlo**, que es la
red que evita el olvido en cualquier orden. Lo que **no** se hace es suponer el orden: T2.2 lo
comprueba enumerando las columnas antes de escribir el `down.sql`.

⚠️ **El punto único de cableado del push (410 §6) es un decorador de `repoReal()`**, no una inyección
por productor: el emisor nuevo usa `notificarCierreDiaRechazadoCon(repoReal())`, exactamente como sus
doce hermanos, **así que pasa por ahí sin hacer nada especial**. Hay una guardia (410/R51) que se
pone roja si un productor nuevo construye su repositorio por su cuenta: **no se construye
`new NotificacionRepository(...)` en este emisor**.

---

## §12 — Qué se prueba de verdad, y con qué

| Qué | Dónde | Por qué ahí |
| --- | --- | --- |
| Dedupe: dos rechazos del mismo cierre ⇒ **2 filas**; el mismo rechazo dos veces ⇒ **1** | `tests/integration/db/` (Postgres real) | lo decide un **índice único**, y los dobles no ven el SQL — medido cuatro veces en este repo |
| La carrera de R9 | `tests/integration/db/`, dos emisiones con `Promise.all` | una comprobación previa la burlaría; el índice no |
| La jornada sale de las gestiones vinculadas | `tests/integration/db/` | es una consulta con `where` |
| Migración: aplica, revierte, y el índice sobrevive | `tests/integration/db/` | es DDL |
| Los textos, literal a literal | unit | **a mano**, nunca contra la función que los compone |
| Un aviso por hecho (R17) y el alcance `solo_bodega` (R18) | unit con notificadores dobles | es política, sin SQL |
| El composition root **PASA** el emisor real (R6) | `notificacion-notificadores-reales.test.ts` sobre el fuente sin imports ni comentarios | no basta con que lo importe |
| El destino existe y el rol lo ve (R21) | guardia vigente de la 409 | recorre datos; ningún grafo de imports la selecciona |

**Mutaciones obligatorias** (un aviso que falla en silencio es exactamente lo que esta ficha viene a
cerrar). Cada una **tiene** que poner algo rojo:

1. Entidad = `cierreId` (sin el instante) ⇒ **R7 rojo** (el segundo rechazo desaparece).
2. Entidad = `${cierreId}:${diaCR}` ⇒ **R7 rojo** si los dos rechazos son del mismo día.
3. Mover la emisión del aviso dentro del `if (bloqueo.bloqueado)` ⇒ **R1 rojo**.
4. Pasar `mensajero_y_bodega` en la rama del rechazo ⇒ **R17 rojo** (dos avisos al mensajero).
5. Borrar el argumento del notificador real en el composition root, dejando el import ⇒ **R6 rojo**.
6. Poner la frase de bloqueo siempre ⇒ **R15 rojo**; quitarla siempre ⇒ **R14 rojo**.
7. Copiar la frase `NO_PUEDES` a `emitir.ts` en vez de importarla ⇒ **R14 rojo** (guardia de árbol).
8. Anclar la fecha en `cierre_dia.created_at` ⇒ **R11 rojo**.
9. Quitar una columna del `ALTER COLUMN` del `down.sql` ⇒ **R24 rojo** (el `DROP TYPE` falla).
10. Meter el `motivo_rechazo` en el contexto del emisor ⇒ **R16 rojo**.

**Autocomprobación antes de creerse el verde:** los tests de integración se matan a propósito una vez
(sembrar cero filas debe hacerlos **fallar**, no pasar por vacío). Es la lección «test de integración
verde sin datos».

⚠️ **Producción no puede verificar nada de esta ficha, y hay que decirlo antes de desplegar.** Con
**0 cierres rechazados** (§0), mirar producción después del despliegue devolverá **cero avisos
nuevos** — y eso será lo correcto, no un síntoma. La única observación posible es **en local, con un
rechazo provocado** (T7.4): el primero, el segundo del mismo cierre, y el recuento del distintivo.
Quien cierre la ficha buscando la confirmación en producción concluirá mal.

---

## §13 — Archivos que toca la implementación

| Archivo | Cambio |
| --- | --- |
| `db/schema.prisma` | +1 valor en `NotificacionEvento`, +1 en `NotificacionEntidadTipo`, con su comentario de por qué la entidad lleva el instante |
| `db/migrations/<ts>_notificacion_evento_cierre_rechazado/{migration,down}.sql` | **nuevos** |
| `lib/types/notificacion.ts` | +1 en cada tipo espejo ⇒ **obliga al gate completo** |
| `lib/notificaciones/catalogo-avisos.ts` | +1 entrada (accionable, atajo `/cierre-dia`, destinatario `mensajero`) |
| `lib/notificaciones/emitir.ts` | +`textoCierreRechazadoMensajero`, +`CierreRechazadoContexto`, +`emitirCierreDiaRechazado`; `emitirMensajeroBloqueado` respeta `destinatarios` |
| `lib/notificaciones/notificadores.ts` | +`CierreRechazadoNotificador`, +`…Con`, +`…Real`, ampliar `notificadorNoOp` |
| `lib/constants/bloqueo-mensajero.ts` | **exportar** `NO_PUEDES` (sin cambiar su valor) |
| `lib/services/CierresAdminService.ts` | `avisarBloqueoPorRechazo` → `avisarDelRechazo` (§5); +1 parámetro de constructor con default no-op; `findJornadaDeCierre` entra en su `Pick` |
| `lib/services/CierreDiaService.ts` | pasa `destinatarios: "mensajero_y_bodega"` (el campo es obligatorio) |
| `lib/interfaces/repositories/IOrdenRepository.ts` · `lib/repositories/OrdenRepository.ts` | +`findJornadaDeCierre` |
| `lib/actions/cierres-admin.ts` | **composition root**: pasa `notificarCierreDiaRechazadoReal` |
| `lib/notificaciones/push-elegibles.ts` | +1 línea **si el archivo ya existe en `dev`** (§8) |

**No se toca:** `NotificacionRepository`, `predicadoVisibilidad`, `NotificacionService`,
`presentacion-aviso.ts`, `components/shared/NotificationsBell.tsx`, `estaBloqueadoPorCierres`, la
salida de `avisoBloqueo`, ni ningún `down.sql` anterior.
