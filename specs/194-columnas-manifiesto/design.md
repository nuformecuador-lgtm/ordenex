# Feature 194 — Columnas del manifiesto elegibles por acción · design.md

## §0 — Decisiones de arranque

| # | Decisión | Motivo |
| --- | --- | --- |
| D1 | **Cero backend, cero migración.** El filtrado es de presentación y ocurre en el navegador sobre las filas ya devueltas. | El servidor ya entrega las 12 columnas y el service es ÚNICO (148/R1, 155/R24). Meter el subconjunto en el contrato del service obligaría a versionarlo y a que el canal de API key lo entendiera, sin ganar nada: el archivo se arma en el cliente (148/§0/D1). R25, R26. |
| D2 | **Persistencia en `localStorage`, por dispositivo, una clave por flujo.** | No existe tabla de preferencias de usuario en el repo, y `specs/146` la declara fuera de alcance. Precedente vivo: `lib/audio/preferencia-sonido.ts` (161/R16). El precio —no viaja entre dispositivos— queda declarado, no escondido. |
| D3 | **Se guardan las columnas OCULTAS (lista de exclusión), no las visibles.** | Es lo que hace cierto R22 por construcción: una columna publicada mañana no está en la lista de ocultas de nadie, así que aparece visible sin migrar nada. Ver §3 y §7/A1. |
| D4 | **El selector vive DENTRO de `DescargarManifiestoButton`.** | Ese componente es el único consumidor de UI del manifiesto y está enganchado en 7 puntos. Poniéndolo dentro, los 7 puntos ganan la función sin tocar un solo archivo de `app/`. |
| D5 | **El generador recibe CLAVES, no columnas.** `buildManifiestoXlsx(filas, clavesVisibles?)`. | Si recibiera `XlsxColumn[]`, el llamador podría reordenar o inventar columnas. Recibiendo claves, el módulo filtra `COLUMNAS_MANIFIESTO` preservando su orden: R8 pasa a ser estructuralmente inviolable. |

## §1 — Modelo de datos

**No hay modelo de datos.** Ninguna tabla, ninguna columna, ninguna política RLS, ninguna
migración, ningún cambio en `db/schema.prisma`. El único estado persistido es del navegador.

### Formato de almacenamiento

- **Clave**: `ordenex:manifiesto-columnas:<flujo>` — una por cada valor de `MANIFIESTO_FLUJOS`
  (7). El prefijo `ordenex:` sigue el precedente de `CLAVE_SONIDO` (161).
- **Valor**: JSON `{"ocultas": string[]}` donde cada elemento es la `key` de una columna
  publicada (`numGuia`, `telefono`, …), no su cabecera.
- **Sin campo de versión a propósito.** La tolerancia del saneador (§3) ES el mecanismo de
  migración: cualquier forma que no case cae al default sin ruido. Añadir `v` obligaría a
  decidir qué hacer con `v` desconocidas, que es exactamente el mismo default.
- Ausencia de clave = todas visibles (R17). `{"ocultas": []}` = todas visibles (es lo que
  escribe "Restablecer", R6).

## §2 — Módulos y archivos

```
lib/manifiesto/preferencia-columnas.ts      (NUEVO, puro, sin React ni DOM salvo window.localStorage)
lib/manifiesto/etiquetas-columnas.ts        (NUEVO, puro: cabecera máquina -> etiqueta legible)
hooks/usePreferenciaColumnasManifiesto.ts   (NUEVO, useSyncExternalStore)
components/shared/ColumnasManifiestoPopover.tsx (NUEVO, "use client")
components/shared/DescargarManifiestoButton.tsx (MODIFICADO: envuelve botón + selector)
lib/utils/manifiesto-xlsx.ts                (MODIFICADO: 2.º parámetro OPCIONAL)
```

`lib/manifiesto/` es nuevo y refleja la estructura de `lib/audio/`: un módulo puro de
preferencia junto a su hook, separado del generador (`lib/utils/manifiesto-xlsx.ts`), que no
debe saber nada de preferencias ni de almacenamiento.

## §3 — Contrato del módulo puro (`lib/manifiesto/preferencia-columnas.ts`)

```ts
export function claveColumnas(flujo: ManifiestoFlujo): string;
// -> `ordenex:manifiesto-columnas:${flujo}`

export function leerCrudoColumnas(flujo: ManifiestoFlujo): string | null;
// Lectura BRUTA del almacenamiento. Devuelve null si no hay window, no hay valor, o el
// almacenamiento lanza. Nunca lanza. Es el "snapshot" estable del hook (§4).

export function sanearOcultas(
  crudo: string | null,
  publicadas: readonly XlsxColumn[],
): string[];
// Saneo (R19, R20, R21):
//  - crudo null / JSON inválido / no objeto / `ocultas` ausente o no array -> []
//  - elementos que no sean string -> descartados
//  - claves que ya no estén en `publicadas` -> descartadas (R19)
//  - si el resultado ocultaría TODAS las publicadas -> [] (R20, R13)
// Nunca lanza.

export function columnasVisibles(
  crudo: string | null,
  publicadas: readonly XlsxColumn[],
): XlsxColumn[];
// `publicadas.filter(c => !ocultas.includes(c.key))`, conservando el orden de `publicadas`
// (R8). Con crudo null devuelve `publicadas` entero (R17, R22).

export function guardarOcultas(flujo: ManifiestoFlujo, ocultas: readonly string[]): void;
// Escribe `{"ocultas":[...]}`. try/catch silencioso: sin almacenamiento la preferencia dura
// lo que la página (R21). Escribe SOLO la clave de ese flujo (R16).
```

Nota sobre R20/R22 y la regla abierta (R23): el saneador **no** compara cardinalidades ni
afirma "12"; compara pertenencia clave a clave contra `publicadas`, que es el parámetro. Por
eso funciona igual si mañana `COLUMNAS_MANIFIESTO` tiene 13 o 9 entradas.

## §4 — Hook (`hooks/usePreferenciaColumnasManifiesto.ts`)

```ts
export function usePreferenciaColumnasManifiesto(flujo: ManifiestoFlujo): {
  visibles: XlsxColumn[];        // subconjunto de COLUMNAS_MANIFIESTO, en su orden
  clavesVisibles: string[];
  alternar: (key: string) => void;
  restablecer: () => void;
};
```

- `useSyncExternalStore(suscribir, () => leerCrudoColumnas(flujo), () => null)`.
  **El snapshot es el STRING crudo**, no un array: `getSnapshot` debe devolver un valor
  estable por identidad o React entra en bucle de re-render. La derivación a `XlsxColumn[]`
  se hace con `useMemo` sobre ese string.
- `getServerSnapshot` devuelve `null` → en servidor todas visibles (R17), sin leer
  almacenamiento y sin discrepancia de hidratación. Esto es el motivo literal por el que NO se
  usa `useState` + efecto (ver el comentario de `hooks/usePreferenciaSonido.ts:10-18`: el botón
  también se renderiza en servidor, y leer en un efecto choca con
  `react-hooks/set-state-in-effect`).
- Suscripción a `window.addEventListener("storage")` **y** a un evento propio
  `ordenex:manifiesto-columnas-cambio` (el evento `storage` no llega a la pestaña que escribió).
  Esto cubre R18: dos botones del mismo flujo montados a la vez se mantienen sincronizados.
  El listener re-lee su propia clave, así que un cambio en otro flujo no altera el estado
  mostrado (R16).
- `alternar` respeta R12: si la clave a ocultar es la última visible, no hace nada (la UI ya
  la presenta deshabilitada; el guard cubre la carrera).

## §5 — UI (`components/shared/ColumnasManifiestoPopover.tsx`)

- Base: `Popover` de `@base-ui/react/popover` — precedente vivo y probado en jsdom:
  `components/shared/NotificationsBell.tsx:145` y `tests/components/NotificationsBell.test.tsx`.
  **No** se añade dependencia ni primitiva `components/ui/popover.tsx`: shadcn no aporta nada
  aquí sobre el uso directo que ya hace la campana.
- Trigger: `Button` (`variant="brand-outline"`, `size="icon"`) con `SlidersHorizontal` de
  `lucide-react` y `aria-label="Elegir columnas del manifiesto"` (R1).
- Contenido: una lista de `Checkbox` (`components/ui/checkbox.tsx`, Base UI) + `Label` por
  cada columna publicada, en el orden de `COLUMNAS_MANIFIESTO` (R2). Cada opción rinde
  `<etiqueta legible> (<clave máquina>)` dentro del `label`, así que el nombre accesible
  contiene la clave (R4) y el texto sigue siendo legible.
- Pie: botón "Restablecer" (R6) + texto de ayuda "Debe quedar al menos una columna"
  visible cuando solo queda una marcada; esa casilla se rinde `disabled` (R12).
- Ancho contenido (`w-72 max-w-[calc(100vw-2rem)]`) y `Popover.Portal`: el botón vive en
  modales estrechos (`GenerarGuiaModal`, `AsignarSateliteModal`, …) y el panel no debe
  desbordarlos.

### Etiquetas (`lib/manifiesto/etiquetas-columnas.ts`)

```ts
export function etiquetaColumna(header: string): string;
```
Mapa `header -> etiqueta` con las 12 actuales; **fallback = el propio `header`** (R5). Decisión
deliberada: el ARCHIVO sigue emitiendo la clave máquina (R9, regla de la 148: el manifiesto es
un documento operativo estable, no una vista), pero la PANTALLA es una vista y ahí "num_remision"
es jerga. Se muestran las dos cosas para que el usuario pueda casar casilla y columna sin
adivinar. El fallback al header hace que una columna publicada mañana aparezca en el selector
aunque nadie le haya escrito etiqueta: coherente con el conjunto abierto (R23).

## §6 — Integración en `DescargarManifiestoButton`

- Sigue devolviendo `null` con selección vacía (148/R17): el grupo entero desaparece, botón y
  selector.
- Se envuelve en `<div className="flex items-center gap-1">` el `Button` actual + el
  `ColumnasManifiestoPopover flujo={flujo}`. La prop `className` sigue aplicándose al `Button`
  (ningún consumidor la usa hoy: verificado en los 7 puntos), y `ManifiestoResultado` ya
  envuelve en un `flex flex-wrap gap-2`, así que el layout no cambia.
- `handleClick` no cambia salvo la llamada final:
  `buildManifiestoXlsx(result.filas, clavesVisibles)`. Ni la llamada a `obtenerManifiesto` ni
  su input cambian (R25), ni `manifiestoFileName` (R11). El import dinámico del generador se
  conserva (exceljs fuera del bundle inicial).
- Abrir el selector NO descarga; pulsar el botón descarga con lo guardado en un solo click (R10).

## §7 — `lib/utils/manifiesto-xlsx.ts`

```ts
export async function buildManifiestoXlsx(
  filas: ManifiestoFilaDTO[],
  clavesVisibles?: readonly string[],
): Promise<ArrayBuffer>
```
- `clavesVisibles` ausente → `COLUMNAS_MANIFIESTO` completo (R24): los tests vigentes de
  `tests/unit/utils/manifiesto-xlsx.test.ts` valen tal cual, sin tocar una línea.
- Presente → `COLUMNAS_MANIFIESTO.filter(c => clavesVisibles.includes(c.key))`. El filtro va
  sobre la lista publicada, nunca sobre la entrada: orden garantizado (R8) y claves
  desconocidas ignoradas.
- Si el filtro deja 0 columnas → se emite el conjunto completo (R13). Se elige NO propagar el
  `throw` de `buildXlsxRows` (`xlsx-template.ts:208`): ese throw protege el contrato del
  generador genérico, pero aquí el fallo sería un archivo que el usuario no obtiene por una
  preferencia corrupta. El throw sigue vivo como red de seguridad de otros llamadores.
- `toRow` NO cambia: sigue enumerando todas las propiedades del DTO. El filtrado ocurre en las
  columnas, no en los datos; `buildXlsxRows` ya ignora las claves de fila no declaradas
  (`xlsx-template.ts:230-232`).
- El comentario de cabecera del módulo (líneas 18-32) se AMPLÍA, no se reescribe: la regla
  160/R28 sigue rigiendo y esta feature elige un SUBCONJUNTO de lo publicado, no cierra la
  lista (R23).

## §8 — Rutas, endpoints y contratos

Ninguno nuevo. Se declara explícitamente lo que NO se toca:

| Superficie | Estado |
| --- | --- |
| `lib/actions/manifiesto.ts` (`obtenerManifiesto`) | Sin cambio. Input y output idénticos (R25). |
| `lib/services/ManifiestoService.ts`, `IManifiestoService` | Sin cambio. |
| `lib/types/manifiesto.ts` (`ManifiestoFilaDTO`, `manifiestoSchema`) | Sin cambio. |
| `app/api/ordenes/api-key/carga/route.ts` | Sin cambio. Devuelve `{ filas, omitidas }` en JSON, no un `.xlsx`; no pasa por la UI ni por `localStorage`, así que ninguna preferencia de navegador puede alcanzarlo (R26). |
| Los 7 puntos de enganche en `app/` | Sin cambio (D4). |
| `db/schema.prisma`, `db/migrations/` | Sin cambio. |

## §9 — Alternativas descartadas

**A1 — Guardar la lista de columnas VISIBLES (allowlist) en vez de las ocultas.**
Es la lectura literal de "guardar la selección" y la primera que sale. Se descarta porque
rompe R22: una columna publicada mañana no estaría en ninguna allowlist guardada, así que
quedaría OCULTA para todo dispositivo con preferencia previa, en silencio y para siempre. Eso
contradice de frente la regla 160/R28 ("el manifiesto refleja los datos de la orden y ese
conjunto crece"): un dato nuevo dejaría de aparecer justo en los navegadores de quienes más
usan la función. Con la lista de exclusión el default es "aparece", y ocultar es siempre un
acto deliberado del usuario. Coste aceptado: el JSON guardado no se lee como "lo que quiero",
sino como "lo que no quiero" — se documenta en el módulo.

**A2 — Un modal de "opciones de exportación" antes de descargar.**
Descartada por decisión humana explícita del 2026-08-10: convertiría un click en dos para los
7 puntos, y varios de ellos ya están dentro de modales estrechos (modal dentro de modal). El
selector es un control PARALELO al botón, no un paso de su camino.

**A3 — Persistir la preferencia en el servidor (tabla `preferencia_usuario`).**
Viajaría entre dispositivos, que es lo que un usuario esperaría. Descartada: no existe esa
tabla, crearla arrastra migración + RLS + service + action y convierte una feature `small` de
frontend en una fullstack; y el humano ya decidió `localStorage`. Queda anotado como deuda
consciente, igual que en 161/R16.

**A4 — Pasar la selección al servidor para que el service devuelva solo esos campos.**
Ahorraría bytes en el payload. Descartada: rompe el "service único" (155/R24), obliga a tocar
el DTO y el borde de API key, y el ahorro es irrelevante para lotes de manifiesto. Además el
binario ya se arma en el navegador, así que el servidor no gana ninguna responsabilidad nueva.

**A5 — Mostrar en el selector solo la clave máquina (`num_guia`).**
Sería el espejo exacto del archivo y cuesta cero. Descartada: la pantalla es una vista y el
archivo es un documento; obligar al operador a leer jerga snake_case para elegir columnas es
peor accesibilidad sin ninguna ganancia. Se muestran ambas (§5), que resuelve la trazabilidad
casilla-columna sin sacrificar legibilidad.

## §10 — Riesgos

| Riesgo | Mitigación |
| --- | --- |
| `getSnapshot` inestable → bucle de render | El snapshot es el string crudo; la derivación va en `useMemo` (§4). Se cubre con un test que renderiza y cuenta renders/no cuelga. |
| El grupo botón+icono rompe el layout de algún punto de enganche | `tests/components/ManifiestoFlujos.test.tsx` (vigente) sigue verde sin modificarse: es el detector. |
| Un test nuevo afirma "12 columnas" y deroga por accidente 160/R28 | R23 explícito + revisión del reviewer sobre los asertos (§tasks T9). |
| Preferencia corrupta impide descargar | R13/R21: todo camino degradado termina en "todas las columnas", nunca en excepción. |
