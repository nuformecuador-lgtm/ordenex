# 213 — Pago múltiple por entrega (captura y presentación) — Diseño

> Zona `frontend`. **No hay modelo de datos, ni migraciones, ni RLS, ni endpoints nuevos** (R33):
> el contrato entero lo creó la 212 y esta ficha solo lo consume. Lo que sí hay son contratos de
> I/O (el `FormData` de la Server Action y el DTO de cierre), y ahí es donde se decide.

## 0. La costura con la 212, verificada contra el código

Tres cosas se comprobaron en el código real antes de escribir nada, porque de las tres depende que
esta ficha sea posible tal como está planteada:

1. **El borde acepta el desglose PURO.** `validarRecaudoEntrega`
   (`lib/types/gestion-orden.ts:239-302`) solo exige el escalar cuando NO hay desglose (regla 3).
   Con `pagos` presente y `metodoPago` ausente, las cinco reglas pasan. Por tanto **el panel puede
   dejar de enviar la forma escalar** (R15) sin tocar el backend, y sin que eso sea «retirarla»:
   la forma sigue viva en el schema para quien la mande (R32, ficha 214).
2. **«Sin cobro» ya significa cero líneas en el borde.** Con `montoRecibido === 0` la regla 3 no
   dispara (exige `> 0`) y la regla 4 solo castiga un desglose NO vacío. Así que
   `{ montoRecibido: 0 }` sin `metodoPago` y sin `pagos` es **válido**. Esto cierra la trampa de
   `GestionarOrdenPanel.tsx:331`: el `"efectivo"` forzado deja de hacer falta y se borra (R16).
3. **El util puro NO es el que decía el encargo.** `lib/utils/lineas-pago.ts` importa
   `Prisma`/`MetodoPagoValue` de `@prisma/client` (`:1`): es el serializador de las proyecciones y
   **no puede viajar al navegador**. El util que sí sirve, y que esta ficha reusa sin duplicar
   ninguna regla, es **`lib/utils/pagos-recaudo.ts`** (`aCentimos`, `sumaCuadra`, `normalizarPagos`),
   escrito explícitamente para el bundle del cliente. R19 lo atornilla con una guardia.

---

## 1. Captura: el editor de líneas

### 1.1 Módulo puro nuevo — `app/(app)/mis-asignaciones/_components/desglose-captura.ts`

Toda la lógica del editor que no es JSX vive en un módulo PURO, sin React, junto al panel (un solo
consumidor → `docs/architecture.md`, «sin sobre-ingeniería»). Es lo que hace que R3–R5 y R12–R14 se
puedan testear sin montar un componente y sin `userEvent`.

```ts
/** Una línea EN EDICIÓN: los dos campos pueden estar a medias mientras se teclea. */
export interface LineaEnEdicion {
  /** id estable de React; NO viaja al servidor. */
  id: string;
  metodo: MetodoPago | "";
  /** El texto crudo del input. `""` = vacío. Nunca un number: el usuario teclea. */
  monto: string;
}

export function lineaNueva(montoPendiente: number): LineaEnEdicion;
export function opcionesPara(lineas, indice): SelectOption[];   // D2: usados → disabled
export function puedeAnadirLinea(lineas): boolean;              // < nº de métodos
export function pendiente(lineas, totalACobrar): number;        // céntimos → number con 2 dec
export function lineasParaEnviar(lineas): LineaPago[];          // [Q2]: descarta las VACÍAS
export function erroresDeLinea(lineas): (string | undefined)[]; // R13: las a medias
```

- **`opcionesPara` (R5).** Devuelve las tres opciones SIEMPRE, marcando `disabled: true` las usadas
  en OTRA línea. Se eligió deshabilitar en vez de validar después: `components/ui/select.tsx` ya
  soporta `disabled` por opción (`:9-15`, `:93`), el método sigue VISIBLE —el mensajero ve que
  existe y que ya lo usó, en vez de que desaparezca de la lista sin explicación— y el error
  imposible de cometer es mejor que el error bien explicado. La regla 2 del `superRefine` de la 212
  (`gestion-orden.ts:261-268`) sigue ahí como red: esto es prevención, no sustitución.
- **`lineasParaEnviar` (R12/R13).** Descarta la línea con método `""` **y** monto `""`. Una línea a
  medias NO se descarta: la reporta `erroresDeLinea` y el envío se detiene. Descartarla en silencio
  significaría cambiar el reparto del dinero sin decírselo a nadie, que en un camino que alimenta la
  `E` del `min(P,E)` no es una comodidad, es un fallo silencioso. Es la lectura estricta de
  [Q2 de la 212] y está en la puerta como **[Q6]**.
- **Aritmética (R11).** `pendiente` y la comprobación de cuadre pasan por `aCentimos`/`sumaCuadra`
  de `lib/utils/pagos-recaudo.ts`. Cero suma de floats. La ÚNICA conversión de texto a número es la
  del input (`Number(texto)`), acotada y con su propio guard de `NaN`; la guardia de R11 la nombra
  como excepción explícita para que no se convierta en un permiso general.

### 1.2 Cambios en `GestionarOrdenPanel.tsx`

| Hoy | Pasa a |
| --- | --- |
| `:260` `const [metodoPago, setMetodoPago] = useState("")` | `const [lineas, setLineas] = useState<LineaEnEdicion[]>(...)` |
| `:330-331` `sinCobro` + `metodoPagoEfectivo = sinCobro ? "efectivo" : metodoPago` | `sinCobro` se CONSERVA (decide si se monta el editor); `metodoPagoEfectivo` **desaparece** (R16) |
| `:341-343` `buildRaw` → `metodoPago: metodoPagoEfectivo \|\| undefined` | `pagos: lineasParaEnviar(lineas)` y **ningún** `metodoPago` |
| `:395-396` `buildFormData` → `fd.set("metodoPago", …)` | `for (const l of lineasParaEnviar(lineas)) { fd.append("pagoMetodo", l.metodo); fd.append("pagoMonto", String(l.monto)); }` |
| `:439` `elegirResultado` → `setMetodoPago("")` | `setLineas(lineasIniciales(orden))` (R10) |
| `:508` `metodoError` | se conserva (R14 sigue colgando de `metodoPago`, que es donde la regla 3 del borde pone su issue) y se suma `pagosError = firstError(fieldErrors, "pagos")` (R18) |
| `:717-733` el `<Select>` único | `<DesglosePagoField …/>`, en el MISMO hueco y solo si `!sinCobro` |

`buildRaw` sigue alimentando el `safeParse` con `gestionarSchema` (R17): esa es la segunda barrera
y no se toca. Con desglose puro, la regla 5 del borde (`sumaCuadra`) da el error de cuadre; pero
R9 exige que el error se vea **antes de pulsar**, así que el editor calcula y pinta la diferencia de
forma continua (R8) además de que el `safeParse` lo rechace. Dos barreras, una preventiva y otra
terminal, sin duplicar la REGLA: las dos llaman al mismo `sumaCuadra`.

### 1.3 `DesglosePagoField` (subcomponente, mismo archivo)

Hermano de `EvidenciasField` / `CausaField`: vive en `GestionarOrdenPanel.tsx` porque tiene UN solo
consumidor. Pinta, por línea, un `Select` (`aria-label="Método de pago línea N"`) y un
`Input type="number"` (`aria-label="Monto línea N"`), más el botón «Quitar» cuando hay 2+ líneas
(R6), el botón «Añadir método» mientras `puedeAnadirLinea` (R3), y el resumen
«A cobrar / Capturado / Diferencia» con `money()` (R8, moneda de configuración, nunca `₡` literal).

El nombre accesible por línea es lo que hace testeable R5 y R13 sin depender del DOM interno.

**Contrato de I/O que sale del panel (R15):**

```
FormData:
  resultado=entregada
  montoRecibido=8000
  pagoMetodo=efectivo        pagoMonto=5000
  pagoMetodo=transferencia   pagoMonto=3000
  (NO se envía metodoPago)
  evidencia=<File>… ubicacionLat/Lng…
```

Emparejado por índice, exactamente el patrón que `rawFromFormData` ya lee
(`lib/actions/mis-asignaciones.ts:222-233`). Las longitudes nunca salen desparejas del panel; si un
cliente adulterado las desparejase, el borde ya lo rechaza con error de campo (desvío 5 de
`impl_212.md`).

---

## 2. Presentación: un solo formateador para tres sitios

Módulo puro nuevo **`app/(app)/cierres-admin/_components/desglose-pago.ts`**, junto a
`cierre-labels.ts` (que ya es el módulo puro compartido por los tres consumidores y por las dos
descargas):

```ts
type LineaDTO = { metodo: MetodoPagoValue; monto: string };

/** Texto de PANTALLA. `null` si no hay líneas → el llamador pinta su propio "—". */
export function desglosePantalla(pagos: LineaDTO[]): string | null;
/** Texto de ARCHIVO, money-safe: sin símbolo y con el string del servidor tal cual. */
export function desgloseDescarga(pagos: LineaDTO[]): string | null;
```

Reglas comunes (R20/R21/R24/R25/R29/R30): 0 líneas → `null`; 1 línea → `METODO_LABEL[metodo]` a
secas; 2+ → una entrada por línea con etiqueta + monto, **en el orden recibido** (que el backend ya
garantiza determinista, 212/R22 — aquí no se ordena nada, y la guardia de R23 lo vigila).

Se separan `desglosePantalla` y `desgloseDescarga` porque la pantalla formatea con `money()`
(`₡5.000,00`) y el archivo NO puede (R31): el módulo de descarga se declara money-safe y sin
símbolo (`cierre-dia-descarga-columnas.ts:17-18`). Un solo formateador con un flag tendría el mismo
efecto y sería una invitación permanente a colar el flag equivocado en el camino equivocado.

En pantalla el resultado se pinta como una lista corta (una línea por método), no como una cadena
larga: la celda «Método» de la tabla es estrecha y `cierre-factura.tsx` es un facsímil de factura.
Por eso `desglosePantalla` devuelve el texto ya compuesto para la celda simple y hay un
`DesglosePagoCelda` mínimo en `cierre-detalle-shared.tsx` para las dos tablas; `cierre-factura.tsx`
lo compone dentro de su `DatoFila` existente (`:953-962`), sustituyendo
`` `${money(g.montoRecibido)}${g.metodoPago ? ` · ${METODO_LABEL[g.metodoPago]}` : ""}` `` por la
versión que itera el desglose.

Los tres sitios exactos, ya verificados con línea en este worktree:

| Archivo | Línea real | Qué se sustituye |
| --- | --- | --- |
| `app/(app)/cierre-dia/_components/CierreDiaModule.tsx` | `:883-887` | `render: (g) => (g.metodoPago ? METODO_LABEL[g.metodoPago] : "—")` |
| `app/(app)/cierres-admin/_components/cierre-detalle-shared.tsx` | `:895-899` | idéntico (esta declaración la comparten cierres-admin **y** cierres de bodega) |
| `app/(app)/cierres-admin/_components/cierre-factura.tsx` | `:953-962` | la fila «Recibido · método» |

No hay un cuarto sitio: `METODO_LABEL` solo tiene esos tres consumidores de pantalla más los dos de
descarga (barrido de `app/` completo).

---

## 3. Descargas [D4]

`filaDescargaDiaEntregada` (`cierre-dia-descarga-columnas.ts:97-104`) y
`filaDescargaGestionEntregada` (`cierre-gestiones-descarga-columnas.ts:109-121`) cambian **una sola
línea** cada una:

```ts
metodo: desgloseDescarga(gestion.pagos),
```

- La declaración de columnas **no se toca** (R26). Los tests de censo y orden de
  `tests/unit/descarga/*-descarga-columnas.test.ts` fijan la lista exacta de `clave` y `encabezado`
  de las dos secciones «entregadas» (`cierre-dia-descarga-columnas.test.ts:60-84`); una columna
  nueva las pondría rojas, que es justamente la guardia que hace cumplir [D4].
- La fila sigue siendo UNA (R27): la función devuelve un objeto, y el adaptador de descarga no
  tiene noción de expandir.
- 1 línea → `"Efectivo"`, igual que hoy (R29, ver **[Q2]**). 2+ → `"Efectivo 5000.00 + Transferencia 3000.00"`
  (ver **[Q1]**). 0 → `null` (R30), que es celda vacía y no el `—` de presentación.

---

## 4. Lo que NO se toca

Nada de `db/`, `lib/repositories/`, `lib/services/`, `lib/interfaces/` (R33). Los seis módulos que
el censo de la 212 declaró inmunes siguen intactos y su guardia
(`tests/unit/guards/pagos-frontera.guardia.test.ts`) debe seguir verde **sin editarla** (R34). La
forma escalar del borde, `gestion_orden.metodo_pago` y el `metodoPago` del DTO **se conservan**
(R32): esta ficha deja de USAR el escalar en el panel, que no es lo mismo que retirarlo. Retirarlo
es la 214 y no antes de que esta esté DESPLEGADA, no solo mergeada.

---

## 5. El obstáculo que costaría descubrir a mitad: la sonda de `columnas-sensibles.guardia`

`tests/unit/descarga/columnas-sensibles.guardia.test.ts` ejecuta cada `fila*()` del árbol con una
SONDA: un `Proxy` que responde a cualquier lectura de propiedad con otra sonda encadenada
(`:123-136`). Hasta hoy todas las proyecciones leían campos ESCALARES. En cuanto
`filaDescargaDiaEntregada` haga `gestion.pagos.map(...)`, la sonda devolverá un objeto para `map` y
la llamada reventará con `TypeError`: la guardia se pone roja por su propia mecánica, no por un
hallazgo.

**Decisión: se AMPLÍA la sonda, no se esquiva.** Un campo leído como lista devuelve un array de UNA
sonda cuya ruta es `campo[]`, de modo que el rastro sobrevive: si mañana alguien emitiera
`pagos[].referenciaFirmada`, el marcador seguiría delatándolo y la lista negra seguiría mordiendo.
Se exige, siguiendo la lección de la ficha 209 («no es un reemplazo mecánico: migrar midiendo los
totales antes y después»):

1. medir el nº de módulos descubiertos, de filas proyectadas y de hallazgos ANTES y DESPUÉS —si
   alguno se mueve, hay un falso positivo/negativo vivo y eso es un hallazgo, no un ajuste—;
2. una **contraprueba** nueva: una proyección de juguete que emita un campo prohibido DENTRO de una
   lista y que la guardia lo cace.

Alternativa rechazada: poner `Array.isArray(gestion.pagos) ? … : null` en producción. Eso es
escribir código con forma de test en un camino de dinero, y peor: si el DTO llegara alguna vez
malformado, la celda saldría vacía **en silencio** en vez de reventar. Está en la puerta como
**[Q3]**.

---

## 6. Alternativas descartadas

### A. Una columna por método en las descargas (`Efectivo`, `SINPE`, `Transferencia`) — DESCARTADA

Es lo que pediría cualquiera que quiera sumar el archivo en una hoja de cálculo: tres columnas
numéricas y se acabó. Se descarta por tres razones, y la primera basta:

1. **[D4] la prohíbe explícitamente**, y es una decisión de la puerta humana del 2026-08-12: la
   celda escalar se concatena, no se abre una columna por método.
2. Rompería los tests de censo y orden de las dos descargas
   (`cierre-dia-descarga-columnas.test.ts:57-84` y su gemelo del admin), que fijan la lista exacta
   de columnas; y esos tests existen precisamente para que el archivo no mute sin que nadie lo
   decida.
3. El enum tiene tres valores HOY. Una columna por valor convierte cada alta futura en el enum en un
   cambio de la forma del archivo para todos los consumidores.

### B. Multiplicar la fila (una por línea de pago) — DESCARTADA

También prohibida por [D4], y además envenenaría cualquier suma del archivo: las columnas
«Ganancia», «Flete», «Comisión» e «Ingreso total» se duplicarían con la fila, y quien sumara la
columna de ganancia pagaría dos veces al mensajero. Un archivo cuyo total depende de saber que hay
que deduplicar no es un archivo, es una trampa.

### C. Editor de N líneas libres con validación de duplicados en el envío — DESCARTADA

Permitir elegir cualquier método en cualquier línea y avisar al confirmar «este método está
repetido» sería más simple de implementar (`opcionesPara` desaparece). Se descarta porque el
mensajero está EN LA CALLE, con una mano, y el coste de un error de captura aquí no es una pantalla
fea: es un total por método equivocado que ya nadie revisa aguas abajo. Con [D2] hay como mucho
tres líneas, así que deshabilitar las usadas es barato y hace el error IMPOSIBLE en vez de
explicado. La regla 2 del `superRefine` del borde se conserva igual como red.

### D. Campo de texto libre «5000 efectivo, 3000 transferencia» parseado por el panel — DESCARTADA

Un solo control, cero botones. Descartada sin discusión: es un parser de lenguaje natural en el
camino que fija la `E` del `min(P, E)` del pago al mensajero.

### E. Promover el editor a `components/shared/` — DESCARTADA

Tiene un solo consumidor. `docs/architecture.md` («sin sobre-ingeniería») solo promueve cuando dos
features lo necesitan con la misma API. Lo que SÍ se comparte es el módulo puro de formateo (§2),
porque ahí sí hay cinco consumidores reales.

---

## 7. Riesgos y mitigaciones

| Riesgo | Mitigación |
| --- | --- |
| Un descuadre capturado envenena `total_efectivo`, que es la `E` del `min(P,E)` (feature 44) | R9 con casos de ±0,01, de menos y de más; y el E2E mixto que comprueba el total del cierre, no solo que el panel envió algo |
| Fixtures que fijan `metodoPago` sin `pagos` dejan de pintar el método → rojos que parecen regresión | censo hecho: 5 archivos de componente, listados en `tasks.md` T7. No se descubren a mitad |
| La guardia de columnas sensibles revienta por la sonda | §5, con medición antes/después y contraprueba |
| El panel arrastra `@prisma/client` al bundle vía un import descuidado | guardia de R19 con contraprueba de import inyectado |
| «Sin cobro» sigue mandando `efectivo` por un camino olvidado | R16 comprueba las TRES cosas a la vez (sin editor, cero pares, sin escalar) y tiene contraprueba con cobro |
| Se cuela el retiro de la forma escalar «ya que estamos» | R32 + los tests de la 212 verdes SIN editarlos; el reviewer rechaza si alguno se tocó |
