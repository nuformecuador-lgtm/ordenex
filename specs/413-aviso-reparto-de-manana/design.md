# 413 — Diseño técnico

> Zona: **backend**. Sin frontend: el panel, la campana y el atajo ya los construyó la 409 y esta
> ficha **no toca ni un componente**.
> **Las tres preguntas abiertas están CERRADAS** (humano, 2026-09-11): la hora con medición (§4.1),
> la segunda corrida descartada con su umbral (§4.3) y el mensajero bloqueado fuera (§6.1).
> ⚠️ **El gate de esta ficha es `./init.sh` COMPLETO, sin excepción.** El diff toca
> `db/schema.prisma`, `db/migrations/**`, `lib/types/**` y `vercel.json`: `--rapido` **se niega
> solo** (`docs/verification.md`). También después de mergear a `dev`.

---

## §0 — El problema técnico en una frase

El mensajero es el único rol al que la app le pide estar en un sitio concreto a una hora concreta, y
es el único que **no sabe la noche anterior cuánto le espera**. Esta ficha emite, una vez por tarde,
**un número** por mensajero —jamás un aviso por orden— y lo cuelga de la maquinaria de avisos
agregados que la 409 ya dejó montada y probada.

---

## §1 — Lo que YA existe y esta ficha reutiliza sin tocar

Verificado en el árbol real el 2026-09-11 (no en el grafo; el grafo de este repo devuelve de más):

| Pieza | Dónde | Esta ficha |
| --- | --- | --- |
| Catálogo de avisos (clase + atajo + título con cifra viva) | `lib/notificaciones/catalogo-avisos.ts` | **+1 entrada** |
| `presentacionDe(fila)` pura | `lib/notificaciones/presentacion-aviso.ts` | **no se toca**: ya compone título con cifra viva y apaga con `0` |
| Cifra viva / apagado solo | `IVigenciaAvisoAgregado` + `VigenciaAvisoAgregadoService` | **+1 rama** |
| `emitirFilas` (guardia de dedupe) + `crear` (absorbe el `P2002`) | `lib/notificaciones/emitir.ts`, `NotificacionRepository` | **se reutiliza tal cual** |
| `emitirBestEffort` + patrón `notificar*Con` / `notificar*Real` / `notificadorNoOp` | `lib/notificaciones/notificadores.ts` | **+1 notificador** |
| Patrón de cron con `CRON_SECRET` y respuesta de conteos | `app/api/cron/avisos-diarios/route.ts` | **clon literal**, otra hora |
| Predicado de visibilidad de la 146 | `NotificacionRepository.predicadoVisibilidad` | **no se toca** (R39) |
| `esParaManana` del portal | `MisAsignacionesService` | **no cambia de comportamiento**; se le extrae la lista de estados (§3.2) |

**Lo que NO existe y hay que crear:** el valor del enum, el `entidad_tipo`, el emisor, el
notificador, el repositorio de la consulta, el servicio, el route handler y la entrada del cron.
Siete piezas. Por eso esta ficha es **la más cara de las dos hermanas** y va aparte de la 412.

---

## §2 — La trampa horaria, resuelta en la dirección contraria a la que avisa la ficha

La `status_note` de la 413 dice —correctamente para el caso general— que las cotas contra columnas
`timestamp` son `inicioDelDiaCREnUtc` / `inicioDelDiaSiguienteCREnUtc` y nunca `startOfDayCR`. **Aquí
ese consejo no aplica, y aplicarlo sería el error.** Medido en el archivo real:

```
db/schema.prisma:658   fechaReparto DateTime? @map("fecha_reparto") @db.Date
```

`fecha_reparto` **no es un `timestamp`: es un `DATE`**. Y el propio bloque que nombra la trampa lo
dice en las dos direcciones:

- `lib/analytics/ranges.ts:40-59` (bloque **(c)**): *«`startOfDayCR` … esa es la convención CORRECTA
  para columnas `@db.Date` (feature 46) y por eso la función se conserva; pero como cota contra
  columnas `timestamp` está 6 h por debajo»*.
- `lib/utils/dia-reparto.ts:19-24`: *«`inicioDelDiaCREnUtc(fecha)` NO sirve para esto … `fecha_reparto`
  es `DATE`: usar el helper equivocado desplaza el día seis horas»*.
- `lib/utils/fecha-cr.ts:19-29`: lista a `orden.fecha_reparto` entre los **consumidores declarados**
  de `startOfDayCR`.

**Decisión: el helper de esta ficha es `startOfDayCR`**, igual que lo usan ya el portal del
mensajero, la reserva de la 261 y el corte diario. Usar `inicioDelDiaCREnUtc` aquí metería en «lo de
mañana» las órdenes de hoy desde las 18:00 CR y dejaría fuera las de mañana en esa misma franja:
seis horas de desplazamiento que no se ven a ojo y que **R3 pone en rojo con un reloj fijo a las
23:50 CR**.

⚠️ **Y no hay un tercer helper que inventar**: como `DIA_REPARTO = ["hoy","manana"]`
(`lib/types/dia-reparto.ts:18`), «reservada para un día posterior al de hoy» **es** «reservada para
mañana». Se usa la comparación que ya existe —`fechaReparto > startOfDayCR(now)`, la de
`estaReservadaParaOtroDia` en `MisAsignacionesService`— y no una igualdad contra una fecha calculada
aparte. Una comparación menos que pueda equivocarse.

**Guardia de ese supuesto, para que no se pudra en silencio:**
`tests/unit/guards/dia-reparto-tokens.guardia.test.ts` afirma que `DIA_REPARTO` tiene **exactamente**
`["hoy","manana"]`. El día que alguien añada «pasado mañana», el guard se pone rojo y obliga a
revisar el título del aviso —que dice «mañana»— antes de que la app mienta.

---

## §3 — Qué se cuenta, exactamente

### 3.1 — El predicado

```
mensajero_asignado_id = <mensajero>
AND deleted_at IS NULL
AND estatus.value IN (por_recoger, en_reparto, ayuda_tienda)
AND fecha_reparto > startOfDayCR(now)          -- el día CR en curso, convención @db.Date
```

**Por qué ESOS tres estados y no sólo `por_recoger`.** En la práctica una orden reservada para mañana
sólo puede estar en `por_recoger`, porque la 261 bloquea recoger y gestionar mientras la reserva es
futura. Pero «en la práctica» es un razonamiento, no una medida, y este repo ya pagó una
*imposibilidad razonada* que Postgres desmintió. El universo que se cuenta es **el mismo que el
portal del mensajero muestra** (`MisAsignacionesService` pide esos tres a
`findMisAsignaciones`), porque la regla que decide todo aquí es la de la 409:

> Si el aviso dijera «5» y la pantalla enseñara 4, el aviso queda desacreditado el primer día.

`recolectando` sigue **fuera**, como lo dejó el corte limpio de la 167/R34.

### 3.2 — Una declaración, dos lectores

Hoy los tres estados son constantes privadas de `MisAsignacionesService` (`ORIGEN_RECOGER`,
`ESTADO_EN_REPARTO`, `ESTADO_AYUDA`). Se extraen a un módulo puro:

```
lib/constants/reparto-mensajero-estados.ts   ->  ESTADOS_REPARTO_MENSAJERO
```

y lo leen **dos**: el servicio del portal y el repositorio del aviso. Es el mismo remedio que la 409
aplicó a `PROYECCION_ANCLAJE_DEVOLUCION` cuando una guardia paró al backend por escribir una segunda
derivación del mismo ancla, y tiene su propia guardia (R2): **1 declaración, 2 lectores**. Sin esto,
el día que el portal gane un cuarto estado el aviso contaría uno menos y **nada se pondría rojo**.

### 3.3 — Dónde se prueba de verdad

⚠️ **Este predicado es SQL, y un doble no puede verlo.** Los tests de servicio con dobles demuestran
que el doble hace lo que el doble hace; el `WHERE`, el tipo `DATE` y el `GROUP BY` se prueban en
`tests/integration/db/reparto-manana-repository.test.ts` **contra Postgres real**. Es la lección
«probar el WHERE donde vive», medida cuatro veces en este repo.

Y el modo de fallo contrario está declarado: **un test de cron que no encuentra nada reporta
`passed` sin comprobar nada.** Por eso cada caso `[PG]` lleva su **contraprueba de escenario no
vacío** y una mutación que lo mata (§13).

---

## §4 — A qué hora se congela «lo de mañana»

### 4.1 — La decisión: 19:00 CR

**Cron nuevo, hora propia, y la conversión escrita para que nadie la «corrija»:**

```jsonc
// vercel.json (décima entrada)
{ "path": "/api/cron/aviso-reparto-manana", "schedule": "0 1 * * *" }
```

> ⚠️ `vercel.json` va **en UTC**. Costa Rica es **UTC−6 fijo, sin horario de verano**. Por tanto
> **19:00 CR = 01:00 UTC del día siguiente ⇒ `0 1 * * *`**. Escribir `0 19 * * *` pondría el aviso a
> **la 1:00 de la madrugada CR**, que es exactamente la hora a la que la 410 no debe empujar nada al
> teléfono de nadie. Los crons vecinos usan `0 6 * * *`, que **no es «las seis»: es medianoche CR**.

La corrida de `01:00Z` del día *D+1* es, en hora de pared, **las 19:00 del día D**:
`fechaCalendarioCR(2026-09-12T01:00Z)` = `"2026-09-11"`, y su mañana es `"2026-09-12"`. El código no
hace ninguna resta: usa `startOfDayCR(now)` y compara con `>`.

**Por qué las 19:00, y no otra hora. MEDIDO el 2026-09-11, no estimado** — asignaciones de los
últimos 14 días, por franja de hora CR:

| Franja (hora CR) | Asignaciones | |
| --- | ---: | --- |
| 06:00–11:00 | **3.183** | 89 % |
| 12:00–18:00 | 262 | 7 % |
| **19:00 en adelante** | **148** | **~4 %** (unas 10 al día) |

> **A las 19:00 ya está asignado el ~96 % del volumen del día.** Eso es lo que convierte esta hora
> de «parece razonable» en una decisión con número: **a las 19:00 falta por asignar el 4 %**, y ese
> 4 % son ~10 asignaciones repartidas entre 18 mensajeros.

Y las tres razones de forma, que la medida confirma:

1. **Después de la jornada de bodega y antes de la noche.** Es la franja en la que el número ya es el
   que va a ser —el 96 % de la tabla de arriba— y en la que un aviso al teléfono todavía no es una
   interrupción; R11 prohíbe explícitamente 22:00–06:00.
2. **Cinco horas antes del corte diario** (`0 6 * * *` = 00:00 CR). El corte no toca las órdenes
   reservadas para un día futuro (246), así que no hay interacción; pero emitir *después* del corte
   habría dejado el aviso llegando de madrugada.
3. **Le deja la tarde entera al mensajero** para organizarse: es literalmente para lo que sirve el
   aviso.

**Lo que NO se hace: escribir 19 en el cron y llamarlo «la hora».** La hora CR vive en
`lib/config/aviso-reparto-manana.ts` (`HORA_CR: 19`) y una **guardia** (`R10`, `R11`) convierte la
expresión de `vercel.json` a hora CR y la compara con esa constante. Dos sitios que dicen la misma
hora en unidades distintas es justo como se acaba con dos verdades; aquí uno de los dos es la fuente
y el otro se **verifica** contra él.

### 4.2 — Lo que la hora NO decide, y es la mitad importante

**Congelar afecta sólo a lo que se EMITE.** Lo que se **lee** es siempre la cifra viva (§5). Por eso
esta hora no puede producir un número mentiroso en la app: como mucho produce un push con un número
viejo (§5.3) y, si nadie tenía reparto a las 19:00, un mensajero sin aviso esa noche (§4.3).

### 4.3 — Alternativa DESCARTADA, con el número delante: una segunda corrida a las 21:00 CR

El hueco real de una hora fija: **el mensajero que recibe su primera orden de mañana a las 20:00 no
recibe aviso esa noche.** La reparación sería barata y **estructuralmente segura**: una segunda
entrada de cron (`0 3 * * *` = 21:00 CR) con el mismo servicio. Como la entidad del aviso es el día
anunciado, la segunda corrida **no puede duplicar nada**: para quien ya tiene su fila es un no-op
(`existeNoLeidaPara` + índice único), y para quien no la tiene crea la suya.

**Decisión del humano, 2026-09-11: NO se hace.** Y no por precaución, sino por el número de §4.1:

- lo que compraría son **~10 asignaciones tardías al día repartidas entre 18 mensajeros** — el 4 %;
- lo que costaría es **la regla que más importa de la 409: uno al día por tipo**. Dos pushes la misma
  noche por el mismo hecho es exactamente lo que aquella ficha prohibió, y el motivo por el que 26 de
  39 personas habían dejado de abrir la campana.

**Umbral escrito para quien venga a reabrirlo** (que es el punto de dejarla descartada y no
olvidada): esto se reconsidera si el reparto nocturno crece hasta que **la franja de 19:00 en
adelante deje de ser marginal** —del orden del 15–20 % de las asignaciones del día, o más de una
asignación tardía por mensajero y noche—. Se mide repitiendo la consulta de §4.1. Por debajo de eso,
el coste en ruido es mayor que lo que se gana, y la respuesta honesta es la que ya da §5.1: **el que
se asignó a las 20:00 aparece igual en la app, lo que no hay es empujón**.

---

## §5 — Qué pasa cuando el número cambia después de avisar

Es la pregunta que ningún canal responde, y la respuesta tiene **tres partes**, no una.

### 5.1 — En la app, el número nunca queda obsoleto

El aviso es **AGREGADO**, así que entra en `EVENTOS_AGREGADOS` y hereda entera la maquinaria de la
409/§5:

- la fila persiste **sin número** (R15): su `descripcion` nombra la fecha, no la cifra;
- el **título** lo compone el catálogo con la **cifra viva** en cada consulta
  (`presentacionDe` → `accion.titulo(cifra)`), sondeo a sondeo (≤ 60 s);
- si sube de 5 a 8, el panel dice 8. Si baja de 5 a 2, dice 2. **Sin una segunda notificación**
  (R14) y sin ninguna rama de código que «detecte el cambio».

```ts
// VigenciaAvisoAgregadoService — rama nueva
if (evento === "reparto_manana") {
  if (actor.rol !== "mensajero") {
    throw new Error(`vigencia: el evento "${evento}" es de un mensajero y el rol "${actor.rol}" no lo es`);
  }
  return this.repartoRepo.contarReservadasParaOtroDia(actor.usuarioId, startOfDayCR(this.now()));
}
```

⚠️ **El ámbito sale del ACTOR, nunca de la entrada de la notificación** — es la regla que el propio
`IVigenciaAvisoAgregado` tiene escrita, y aquí se respeta literalmente: el mensajero es
`actor.usuarioId`. Del `entidad_id` **no se lee nada**. Y la rama del rol equivocado **lanza**, no
devuelve `0`: la 417 cerró exactamente ese fallo, porque un `0` de cortesía apaga un aviso vivo sin
que nadie lo lea (`NotificacionService` lo registra y R16 lo muestra igual).

### 5.2 — Cuando llega el día, el aviso se apaga solo

No hace falta ningún proceso que lo caduque: al pasar la medianoche CR, `startOfDayCR(now)` avanza y
las órdenes del día anunciado **dejan de ser «posteriores»**. La cifra viva cae a `0`,
`presentacionDe` devuelve `null` y el aviso desaparece del panel y del distintivo (409/R55), **sin
que nadie lo lea, lo marque ni lo descarte**.

⚠️ **Esto es lo que permite que el título diga «mañana».** Este repo tiene escrita la lección
contraria en `textoDiaRepartoCorregido` (262): *«NOMBRA LA FECHA, NUNCA "hoy" NI "mañana" … la
campana guarda 30 días»*. Aquí la palabra es segura **porque el aviso no puede sobrevivir a su propio
día**, y eso no es un razonamiento: es **R21**, con reloj fijo a las 00:01 CR. Y como cinturón, el
texto persistido nombra la fecha igualmente (R28), así que aunque el aviso se leyera fuera de plazo
seguiría siendo cierto.

### 5.3 — El push SÍ puede quedar obsoleto, y se dice

Un push es una **foto**: sale a las 19:00 con el número de ese instante, se entrega en el teléfono y
**nadie lo corrige** (la 410 no retira ni edita lo ya entregado — su R44). Coste declarado, aceptado
**y acotado con la medida de §4.1**:

> El mensajero que reciba «tenés 5 órdenes para mañana» y abra la app a las 21:00 puede ver 6.
> **La app manda, el push es el aviso.**

**El tamaño del coste, no su idea:** después de las 19:00 se asignan **~10 órdenes al día entre 18
mensajeros** (el 4 %). Es decir, la mayoría de las noches **ningún** push queda desfasado, y el que
lo queda se desfasa **en una o dos unidades**, no en un orden de magnitud. Por eso no se persigue con
un segundo push (§4.3) ni con una corrección: se persigue con la cifra viva de §5.1, que ya lo tapa
en el único sitio donde el mensajero va a mirar antes de salir.

Es el mismo reparto de responsabilidades que la 410 ya firmó en su D3 («el texto no promete un número
que no tiene») y la razón por la que el número **no** se persiste en la fila (R15): lo único que
queda congelado es el push, no el dato.

---

## §6 — El cero, y el bloqueado

### 6.0 — El cero

Dos capas, y las dos hacen falta:

1. **No se emite.** El resumen del cron sale de un `GROUP BY mensajero_asignado_id`, así que un
   mensajero sin reparto **no aparece en la lista**; además el servicio lleva su `continue`
   explícito (mismo patrón que 409/R43), para que un doble que devolviera `total: 0` tampoco pueda
   emitir. Nadie recibe «tenés 0 órdenes para mañana» (R18).
2. **Y si llega a cero después, se apaga.** §5.2 (R19), y vuelve si sube el mismo día sin crear una
   segunda fila (R20).

### 6.1 — El mensajero BLOQUEADO no recibe este aviso (R42, decisión del humano del 2026-09-11)

**Si está bloqueado no puede trabajar, así que decirle cuántas órdenes tiene mañana es prometerle
algo que el sistema le va a negar.** Y ya tiene su aviso propio —`mensajero_bloqueado_por_cierres`,
accionable, con atajo a `/cierre-dia`—, que es el que sí le pide la acción que lo desbloquea. **Dos
avisos que apuntan a acciones opuestas es peor que uno menos.**

No es una regla nueva de esta ficha: es **coherencia con una que ya está vigente y escrita**. El
comentario de `OrdenRepository.findMensajerosBloqueadosPorCierres` (271/T1.3) dice que desde el
2026-08-23 el bloqueo alcanza *«TODO —gestionar, cobrar y **recibir trabajo nuevo, reparto Y
recolección**»*. Un aviso que le anuncia su reparto contradiría literalmente esa frase.

**Se reutiliza el predicado, no se reescribe.** El servicio pide en **lote**
`findMensajerosBloqueadosPorCierres(ids)` —que ya existe, ya devuelve un `Set<string>` y ya deriva de
`estaBloqueadoPorCierres`, el módulo puro que es la única definición de la regla (271/R10)— con los
ids que el `GROUP BY` ya trajo. **Una consulta más por corrida diaria**, no por mensajero.

```ts
const resumen   = await this.repo.resumenPorMensajero(startOfDayCR(now));
const bloqueados = await this.cierresRepo.findMensajerosBloqueadosPorCierres(
  resumen.map((r) => r.mensajeroId),
);
for (const fila of resumen) {
  if (fila.total <= 0) continue;                  // R18
  if (bloqueados.has(fila.mensajeroId)) continue; // R42
  ...
}
```

⚠️ **El filtro es de EMISIÓN, no de lectura (R43), y esto es una decisión, no un olvido.** La cifra
viva **no** consulta cierres:

- **Qué se gana:** la ruta caliente no cambia. El resolutor de vigencia corre en cada sondeo de 60 s;
  meterle una consulta de cierres rompería R41 y ataría el apagado de este aviso a un estado que ya
  tiene su propio aviso.
- **Qué se acepta a cambio, dicho:** si un mensajero recibe su aviso a las 19:00 y **se bloquea a las
  21:00**, esa noche convivirán los dos avisos hasta la medianoche, en que el de reparto se apaga
  solo (§5.2). La ventana es de horas, el desenlace es **un aviso de más** —la dirección segura— y
  el de bloqueo es accionable, así que la campana sigue señalando la acción correcta.
- **Y el que se desbloquea no pierde el dato:** su reparto está en `/mis-asignaciones` y el número
  que lee ahí es el vivo. Lo único que se pierde es **el empujón de esa noche**, que es exactamente
  lo que la decisión quiso quitar.

---

## §7 — La entidad de dedupe, y por qué aquí NO lleva prefijo

`notificacion_dedupe_key` es UNIQUE sobre **`(evento, entidad_id, destinatario_rol,
destinatario_usuario_id)`**, `NULLS NOT DISTINCT`, `WHERE entidad_id IS NOT NULL` —verificado en
`db/migrations/20260727120000_notificacion/migration.sql:89-92`— y el ALCANCE (`tienda_id`,
`zona_id`) **no entra**.

| Aviso | `entidad_tipo` | `entidad_id` | Destinatario |
| --- | --- | --- | --- |
| reparto de mañana | `reparto_manana_dia` *(sexto que no apunta a una fila de tabla)* | `` `${fechaRepartoISO}` `` (`YYYY-MM-DD`, el **día anunciado**) | `{ tipo: "usuario", usuarioId: mensajeroId }` |

**Por qué el día va dentro: para que el aviso de pasado mañana SÍ salga.** Con una entidad que no
cambiara entre jornadas, la clave sería la misma todas las noches, `crear` absorbería el `P2002`
devolviendo `false` y **el aviso del día 2 no saldría jamás, en silencio** — el fallo que pagaron la
262 (entidad = orden) y la 403 (entidad = suscripción). Con el día dentro: noches distintas ⇒
entidades distintas ⇒ el recordatorio es **estructural** (R23/R24); misma noche repetida ⇒ misma
entidad ⇒ una sola fila (R22).

**Por qué NO lleva prefijo de mensajero, al contrario que los dos avisos de la 409.** Esto hay que
leerlo entero antes de copiarlo:

- En la 409 el destinatario es un **ROL con alcance** (`{rol: adminTienda, tiendaId}` /
  `{rol: adminSatelite, zonaId}`) y **el alcance no está en la clave**. Por eso allí
  `entidad_id = '<tiendaId>:<día>'` es obligatorio: sin él, sólo la primera tienda de la corrida
  habría recibido su aviso y **todas las demás quedaban mudas, sin error ni log**.
- Aquí el destinatario es **un USUARIO**, y `destinatario_usuario_id` **ES una columna de la clave
  única**. Dos mensajeros ⇒ dos valores distintos ⇒ dos filas. El alcance ya está dentro.

Repetir el prefijo «por si acaso» enseñaría la regla equivocada («prefija siempre») en vez de la
correcta («comprueba si el alcance está en la clave»). Pero la decisión **no se sostiene sobre este
párrafo**: se sostiene sobre **R7**, un test contra Postgres real con **dos mensajeros la misma
noche**, y su **mutación obligatoria** —dirigir el aviso a un rol en vez de a un usuario— que
reproduce exactamente el silencio de la 409 y **pone el test rojo**.

> **Y si mañana este aviso se dirigiera también a un rol** (por ejemplo, a la bodega), el
> `entidad_id` **tendría** que ganar ese alcance. R7 es lo que lo destaparía el mismo día.

**No es `entidad_id = NULL`**: con `null`, `emitirFilas` se salta su guardia previa y el índice único
es PARCIAL, así que saldría un aviso por cada ejecución.

---

## §8 — Catálogo, atajo y textos

### 8.1 — La entrada del catálogo

```ts
// lib/notificaciones/catalogo-avisos.ts — entrada 14
reparto_manana: {
  porDefecto: {
    clase: "accionable",
    atajo: { href: "/mis-asignaciones", etiqueta: "Ver mi reparto" },
    titulo: tituloRepartoManana,
  },
  destinatarios: ["mensajero"],
},
```

**Accionable, y se defiende con la tabla de la 409 §2.1bis**, que es la que decide todos los atajos
futuros:

| | ¿lo cumple? |
| --- | --- |
| (a) pide una acción | **Sí.** Organizarse para mañana: saber si son 4 paquetes o 40 cambia la moto, el combustible y la hora de salida. |
| (b) tiene consecuencia si no se hace | **Sí.** Llegar a la bodega sin saber qué le espera, que es la situación de hoy y el motivo de la ficha. |
| (c) quien lo recibe puede resolverla | **Sí, y sólo él.** Nadie más puede preparar su día. |
| criterio del ATAJO: *«¿le acerca esta pantalla a resolverlo?»* | **Sí.** `/mis-asignaciones` **es** la lista de lo que va a llevar: es el insumo de su preparación, igual que `/ordenes` lo es de la llamada del admin a la bodega. Con botón. |

`/mis-asignaciones` está en `SIDEBAR_ITEMS` para `mensajero` y redirige a `/mis-asignaciones/reparto`
—es el mismo destino que la 409 le dio a `dia_reparto_corregido`, el evento hermano sobre el mismo
asunto—, y la guardia vigente `atajo-aviso-ruta-visible.guardia.test.ts` lo comprueba sola (R26).

**Coste declarado de ser accionable:** suma **1** al «N por hacer» de cada mensajero con reparto,
**desde las 19:00 CR hasta la medianoche** y ni un minuto más (§5.2). Es un aviso por tarde, se apaga
solo, y el distintivo vuelve a cero sin que nadie toque nada. Esa cota es lo que lo separa del ruido
que la 409 existe para eliminar.

### 8.2 — Los textos

```
reparto_manana        tipo: box      destinatario: usuario (el mensajero asignado)

  titulo (catálogo, con la cifra VIVA):
    n === 1 -> "Tenés 1 orden para mañana"
    n  >  1 -> "Tenés N órdenes para mañana"

  descripcion (fila, = la línea de contexto) — SIN NÚMERO, con la FECHA:
    "Es tu reparto del 12 de septiembre. Revisá la lista para organizarte."
```

- **El número vive sólo en el título**, que se recompone en cada lectura. La `descripcion` no lo
  lleva (R15): lo que se persiste no puede quedar obsoleto si no contiene la cifra.
- **La fecha en palabras** sale de `fechaLegible` (`lib/utils/dia-reparto-textos.ts`), el mismo
  formateador que usa el selector del día y el aviso de la 262. Se importa la **conversión**, no un
  literal: las cadenas de notificación siguen viviendo sólo en `emitir.ts` (146 §4.6).
- **Singular y plural explícitos**, como `textoCargaMasivaTerminada` y `tituloNovedadesSinGestionar`:
  «Tenés 1 órdenes» es el texto roto que ninguna suite ve y que un humano lee todos los días.
- **Voseo**, como el resto del vocabulario al mensajero de la 409 («Coordiná la devolución»,
  «revisalas una por una»).
- **Sin PII (R29):** un número, una fecha y una instrucción. Ni guía, ni remisión, ni dirección, ni
  teléfono, ni destinatario, ni tienda, ni monto.

---

## §9 — Elegibilidad de push (410/R2), decidida y razonada

**Decisión: ELEGIBLE, y sólo para el perfil `usuario` (el mensajero destinatario).**

| Criterio aprobado por el humano | Este aviso |
| --- | --- |
| *«Sólo lo que tiene PLAZO o DINERO»* | **Plazo.** El reparto es mañana por la mañana; el valor del aviso caduca esa misma noche. Es el caso más puro de plazo que hay en el catálogo: a las 00:00 CR ya no sirve de nada. |
| *«y siempre agregada»* | **Agregado por definición** (§5). Jamás un push por orden. |
| *«nunca nada que quien lo recibe no pueda resolver»* | Sólo él puede prepararse. |
| *¿merece interrumpir a alguien?* | **Sí, y a esta hora.** Llega a las **19:00 CR** (§4.1), tarde-noche y fuera de la franja prohibida por R11. Un mensajero que se entera a las 19:00 de que mañana lleva 35 paquetes cambia lo que hace esa noche; el mismo dato a las 07:00 del día siguiente llega tarde. |

Y ya estaba prometido: la tabla de push del lienzo aprobado lo lista («Mensajero: su reparto de
mañana») y la 410/D1 lo dejó **SIN CUBRIR, ficha aparte** — ésta.

**⚠️ El orden de merge con la 410 importa, y no se deja al azar:**

| Situación al implementar | Qué hace esta ficha |
| --- | --- |
| `lib/notificaciones/push-elegibles.ts` **ya está en `dev`** | añade su entrada + su test (R31). Sin ella **el typecheck se pone rojo**: es 410/R2 funcionando como se diseñó. |
| **Aún no existe** (la 410 sigue en su rama) | la decisión queda escrita **aquí y en el comentario del enum**, y la 410 la aplica al rebasar —su `Record` no compilará hasta hacerlo—. La casilla de R31 **queda vacía a propósito**: marcarla sería mentir. |

En ninguno de los dos casos el evento puede colarse sin decisión ni quedarse fuera en silencio.

---

## §10 — Modelo de datos y migración

### 10.1 — La única migración de la ficha

```
db/migrations/<timestamp>_notificacion_evento_reparto_manana/
  migration.sql   ALTER TYPE "notificacion_evento"       ADD VALUE IF NOT EXISTS 'reparto_manana';
                  ALTER TYPE "notificacion_entidad_tipo" ADD VALUE IF NOT EXISTS 'reparto_manana_dia';
  down.sql        recrea los DOS tipos con la lista PREVIA
```

- **Aditiva**: no crea tablas ni columnas, no crea índices, no toca RLS (`notificacion` conserva la
  de la 146), sin backfill.
- **Va sola y con timestamp propio**: Postgres no deja usar un valor de enum recién añadido en la
  misma transacción que lo añadió (`55P04`) y Prisma corre cada `migration.sql` en una.
- **Jamás renumerar una carpeta ya aplicada**: deja una fila fantasma que `migrate status` no ve.

### 10.2 — El `down.sql`, que es la parte peligrosa

**La pregunta obligatoria de este repo, hecha y respondida:** los **ocho** downs previos de estos dos
enums (146, 253, 262, 271, 333, 403, 401 y **409**) son **fotos de su momento y todas siguen siendo
ciertas**: **NO SE TOCA NINGUNO.** Editarlos sería el drift de «migración editada en sitio»: lo
añadido después no llega nunca a la base donde aquella ya corrió.

**La mitad hermana, que sí es trabajo de esta ficha, y tiene DOS partes:**

1. **La lista se reescribe contra `db/schema.prisma` de `origin/dev` justo antes de abrir el PR**, no
   de memoria. Hoy (2026-09-11) son **13 eventos y 11 entidades**. ⚠️ **Dos fichas hermanas están
   vivas y tocan el MISMO enum:** la **412** (rechazo de cierre al mensajero) y la **410** (que no
   añade valores pero sí un consumidor, ver abajo). Si la 412 entra en `dev` antes que ésta,
   revertir con la lista vieja **borraría su valor en silencio** — le pasó a la 401 con la 403. Es
   la tarea `T2.3`, no un recordatorio.
2. **⚠️ Y hay que enumerar las COLUMNAS, no sólo los valores.** El `down` recrea el tipo y convierte
   `notificacion.evento` con un `USING`; si queda **otra** columna apuntando al tipo viejo, el
   `DROP TYPE` falla y el rollback aborta. Hoy las únicas columnas del árbol que usan estos tipos son
   `notificacion.evento` y `notificacion.entidad_tipo` —verificado—, **pero la 410 introduce una
   segunda**: `push_envio_dia.evento`, de tipo `NotificacionEvento`. **La 410 está en revisión ahora
   mismo (2026-09-11), así que lo más probable es que entre en `dev` ANTES que esta ficha**, y
   entonces este `down.sql` **tiene que convertir también esa columna** o el `DROP TYPE` falla.
   `T2.3` lo comprueba leyendo el esquema **en el momento de abrir el PR**, y `R38` lo mide
   aplicando y revirtiendo contra Postgres real. Enumerar **columnas** y no sólo valores es lo que
   hace que esta ficha funcione en **cualquier** orden de merge.

**Precondición ruidosa, declarada:** ninguna fila de `notificacion` con `evento = 'reparto_manana'`
ni `entidad_tipo = 'reparto_manana_dia'`. Si quedara alguna, el `USING` falla y el rollback aborta.
Es el comportamiento **correcto**. **Aquí no hay ningún `DELETE` para «hacer sitio».**

### 10.3 — Lo que NO cambia en la base

Ninguna tabla nueva, ninguna columna nueva, **ningún índice nuevo**, ninguna política RLS nueva.

**Sobre el índice, con su argumento y su medida.** La consulta del portal ya se sirve con
`@@index([mensajeroAsignadoId, asignadoAt, fechaReparto])` (246/D7), cuyo prefijo cubre el conteo por
mensajero; el `GROUP BY` de la corrida recorre las órdenes vivas una vez al día. No se añade un
índice «por si acaso» a la tabla más caliente del sistema: `T0.3` mide el `EXPLAIN` en producción en
**solo lectura** y, si hiciera falta, es una migración aditiva de una línea en otra ficha. (La 411
dejó escrito el matiz que aquí también aplica: con el volumen actual el planificador puede elegir
`Seq Scan`, así que el verde de un test de índice protege el futuro y **no describe producción hoy**.)

---

## §11 — Capas y archivos que toca la implementación

```
app/api/cron/aviso-reparto-manana/route.ts      Controller: sólo HTTP + secreto + conteos
  └─ lib/services/RepartoMananaAvisoService.ts  decide QUÉ se avisa (agrupación, cero, bloqueo, best-effort)
       ├─ lib/interfaces/repositories/IRepartoMananaRepository.ts
       │    └─ lib/repositories/RepartoMananaRepository.ts   SÓLO queries Prisma
       ├─ Pick<IOrdenRepository, "findMensajerosBloqueadosPorCierres">   (reuso, R42 · §6.1)
       └─ notificador inyectado en el composition root del route handler
```

**Por qué un `Pick` y no `IOrdenRepository` entero:** de ese repositorio este proceso usa **un**
método, y dejar el tipo ancho haría consultable por descuido todo lo demás. Es el patrón
`CorreccionDiaRepartoRepo` / `DeshacerAsignacionRepo` que el repo ya usa para esto mismo.

```ts
// IRepartoMananaRepository — dos métodos, UN solo `where` privado detrás (§3.2)
resumenPorMensajero(diaEnCurso: Date): Promise<Array<{ mensajeroId: string; total: number }>>;
contarReservadasParaOtroDia(mensajeroId: string, diaEnCurso: Date): Promise<number>;
```

| Archivo | Cambio |
| --- | --- |
| `db/schema.prisma` | +1 valor en `NotificacionEvento`, +1 en `NotificacionEntidadTipo` (con su comentario, como sus ocho precedentes) |
| `db/migrations/<ts>_notificacion_evento_reparto_manana/{migration,down}.sql` | **nuevos** |
| `lib/types/notificacion.ts` | +1 valor en los tipos espejo del enum |
| `lib/constants/reparto-mensajero-estados.ts` | **nuevo** (puro): `ESTADOS_REPARTO_MENSAJERO` |
| `lib/services/MisAsignacionesService.ts` | pasa a **leer** la constante extraída (sin cambio de comportamiento) |
| `lib/config/aviso-reparto-manana.ts` | **nuevo**: `HORA_CR: 19`, **con la medición del 2026-09-11 escrita al lado del valor** (89 % antes de las 11:00, ~4 % después de las 19:00) |
| `lib/notificaciones/catalogo-avisos.ts` | +1 entrada + `tituloRepartoManana` |
| `lib/notificaciones/emitir.ts` | +1 emisor, +1 texto, +1 contexto |
| `lib/notificaciones/notificadores.ts` | +1 firma, +1 `*Con`, +1 `*Real`, ampliar `notificadorNoOp` |
| `lib/interfaces/repositories/IRepartoMananaRepository.ts` | **nuevo** |
| `lib/repositories/RepartoMananaRepository.ts` | **nuevo** |
| `lib/interfaces/services/IRepartoMananaAvisoService.ts` | **nuevo** |
| `lib/services/RepartoMananaAvisoService.ts` | **nuevo** (incluye el filtro de bloqueo, §6.1) |
| `lib/services/VigenciaAvisoAgregadoService.ts` | +1 rama (§5.1) + el repositorio nuevo por constructor |
| `lib/actions/notificaciones.ts` | `buildService()` pasa el repositorio nuevo al resolutor de vigencia |
| `app/api/cron/aviso-reparto-manana/route.ts` | **nuevo** |
| `vercel.json` | +1 cron (`0 1 * * *` = 19:00 CR) |
| `lib/notificaciones/push-elegibles.ts` | +1 entrada **sólo si ya existe** (§9) |

**No se toca:** ningún componente, ningún hook, `NotificacionRepository`, `presentacion-aviso.ts`,
`AvisosDiariosService` ni su cron de las 07:00.

**Colisiones:**
- con la **412** (hermana, `backend`): **sólo en el enum y su `down.sql`**. Ningún otro archivo
  coincide. Van en serie o, si van en paralelo, la segunda en mergear reescribe su lista del `down`
  (§10.2).
- con la **410**: en `push-elegibles.ts` (§9) y en el `down.sql` por `push_envio_dia.evento` (§10.2).
- con la **414** (frontend, comprobante): ninguna.

---

## §12 — Alternativas descartadas

### 12.1 — Emitir el aviso al ASIGNAR, no por cron (descartada)

Tentadora: no hace falta cron, ni hora, ni congelación — el aviso sale cuando el maestro asigna «para
mañana».

**Se descarta por tres razones, en orden de peso:**

1. **Deja de ser agregado.** Una asignación es un **lote**, y hay varios lotes al día desde dos
   bodegas (central y satélite) más las correcciones de la 262. El mensajero recibiría tres o cuatro
   avisos por tarde diciendo cada uno un número parcial — exactamente el «una notificación por
   orden» que el lienzo prohíbe, sólo que disfrazado.
2. **El número sería el del instante del lote, no el del día.** «Tenés 4 para mañana» a las 15:00 y
   «tenés 6 para mañana» a las 17:00: dos verdades sobre el mismo hecho, que es el modo de fallo que
   este repo persigue.
3. **Ataría el aviso a una transacción de negocio.** La asignación es una escritura en lote con
   historial; meter ahí una emisión (aunque sea best-effort) añade riesgo a una operación que hoy no
   lo tiene, a cambio de nada.

El cron da lo que hace falta: **un número, una vez, por día**.

### 12.2 — Derivar el aviso al leer, sin fila en `notificacion` (descartada)

Calcular «tenés N para mañana» dentro de `listar` y no persistir nada: sin migración, sin cron, sin
dedupe, y «se apaga solo» sale gratis. **Se descarta por lo mismo que la 409 descartó su gemela**:
(a) **la 410 se queda sin nada que empujar** —un push necesita un HECHO en un instante— y este aviso
es justamente uno de los cuatro que el lienzo le promete al mensajero; (b) se pierde el «uno al día»
y el aviso vuelve a ser un adorno de pantalla; (c) rompe el patrón probado de
`gasto_fijo_cobro_pendiente`. La forma elegida se queda con lo bueno de las dos: **fila** (para el
push y el «uno al día») + **cifra viva al leer** (para que el número nunca envejezca).

### 12.3 — Congelar el número dentro del texto persistido (descartada)

Escribir «tenés 5 órdenes para mañana» en la `descripcion` y no resolver nada al leer. Es más simple
y es **el diseño que produce el problema de la pregunta 2**: el número queda obsoleto en cuanto entra
una orden más, nadie lo corrige, y el mensajero aprende que el aviso miente. Se descarta; el número
vive sólo en el título, que se recompone (R15).

### 12.4 — Reutilizar el cron `avisos-diarios` de las 07:00 (descartada)

Cero archivos nuevos de infraestructura. Pero a las 07:00 CR «mañana» es el día siguiente al que aún
no ha empezado a asignarse: el número sería casi siempre **cero**, y el aviso llegaría **doce horas
tarde** para servir de algo. Una hora propia no es un capricho de esta ficha: es su contenido.

---

## §13 — Verificación

- **`./init.sh --rapido` se va a negar**, y está bien: el diff toca `db/schema.prisma`,
  `db/migrations/**`, `lib/types/**` y `vercel.json`. **El gate es `./init.sh` completo, sin
  excepción**, y también después de mergear a `dev`.
- **Los `[PG]` son el corazón de la ficha.** Los tests de dedupe (R7/R22/R23/R24), los de predicado
  (R1/R3/R4) y el de migración (R38) sólo corren con `DATABASE_URL` resoluble, y **en un worktree no
  la hay**. Si el gate los reporta `skipped`, **la ficha no está verificada**: mirar los `skipped`,
  no sólo el `INIT_EXIT`.
- **Contraprueba obligatoria de escenario no vacío.** Un cron que no encuentra nada reporta `passed`
  sin comprobar nada, y un `if (!datos) return;` deja un test verde que no afirma. Cada caso `[PG]`
  se **mata antes de creerlo**: con la base sin sembrar debe FALLAR, y se deja constancia de haberlo
  comprobado en `progress/impl_413.md`.
- **Mutaciones obligatorias** (un aviso diario es exactamente lo que falla en silencio):
  1. cambiar `startOfDayCR` por `inicioDelDiaCREnUtc` en la cota de `fecha_reparto` → **R3 rojo**
     (los dos asertos de las 23:50 CR);
  2. dirigir el aviso a un **rol** en vez de a un usuario → **R7 rojo** (el silencio de la 409);
  3. quitar el día del `entidad_id` → **R23 rojo** (la segunda noche no avisa);
  4. hacer que el resolutor de vigencia devuelva siempre `1` → **R19 y R21 rojos** (el aviso no se
     apaga nunca y sobrevive a su día);
  5. hacer que el resolutor devuelva `0` para un rol que no es mensajero en vez de lanzar →
     **R17 rojo**;
  6. duplicar la lista de estados en el repositorio en vez de leer la constante → **R2 rojo**;
  7. escribir la hora CR directamente en `vercel.json` (`0 19 * * *`) → **R10 rojo**, y con
     `0 5 * * *` → **R11 rojo**;
  8. persistir el número en la `descripcion` → **R15 rojo**;
  9. borrar el argumento del notificador real en el composition root dejando el import →
     **R36 rojo** (la familia «el composition root que no inyecta»: dos notificadores muertos con la
     suite entera en verde);
  10. no consultar el bloqueo antes de emitir → **R42 rojo** (el bloqueado recibe el aviso que
      contradice al suyo);
  11. meter la comprobación del bloqueo **dentro** del resolutor de vigencia → **R43 y R41 rojos**
      (la ruta caliente gana una consulta y el aviso se apaga por un motivo que no es su cifra).
- **Los literales se afirman a mano.** Prohibido comparar un texto contra la función o la constante
  que lo genera: eso está siempre verde y ya dejó pasar un tope que la app rechazaba.
- **Nadie lo ha visto en un navegador.** Esta ficha no pinta nada nuevo —el panel es el de la 409—,
  pero **el aviso sí es nuevo en la campana del mensajero**, y jsdom no mide desbordes. `T7.2` es
  mirar la campana de un mensajero con el aviso vivo, en los dos temas. Es puerta de despliegue, y si
  no se hace, su casilla **queda vacía**.

---

## §14 — Coste declarado

No es urgente: nace de una promesa del diseño, no de un incidente. Y es **cara** — por eso va aparte
de la 412. El coste honesto, sin recortar:

| Concepto | Coste |
| --- | --- |
| Piezas nuevas | 7 (enum ×2, emisor, notificador, repositorio, servicio, route handler, cron) |
| Migración de enum | 1, con `down.sql` que depende del orden de merge de **dos** fichas hermanas (§10.2) |
| Archivos tocados | ~17, de los que 8 son nuevos |
| Gate | **completo siempre** (`lib/types/**` + migración), ~4 min por corrida |
| Consultas añadidas en caliente | **1** `count` por sondeo de 60 s **y sólo** para el mensajero que tiene el aviso vivo, entre las 19:00 y las 00:00 CR. Cero para todos los demás (R41) |
| Consultas añadidas en la corrida diaria | 2: el `GROUP BY` y el `Set` de bloqueados **en lote** (§6.1) |
| Filas nuevas por día | ≤ 1 por mensajero con reparto **y no bloqueado** (hoy, ≤ 18) |
| Lo que NO cubre, **medido** | la asignación tardía: **~10 al día entre 18 mensajeros, el 4 %** (§4.1), que aparece igual en la app pero sin empujón (§4.3); y el push ya entregado desfasado **en una o dos unidades** (§5.3) |
| Lo que NO cubre, **declarado** | el mensajero que se bloquea entre las 19:00 y la medianoche convive esa noche con los dos avisos (§6.1) |

Si el humano decide que no vale ese precio, la alternativa honesta **no** es recortar el diseño: es
no hacer la ficha. Un aviso agregado a medias —sin cifra viva, o sin apagado— es un aviso que miente
un día sí y otro también, y la 409 existe precisamente porque 26 de 39 personas ya dejaron de abrir
la campana.
