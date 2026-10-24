# Laboratorio virtual RC — Métodos Numéricos

Sitio estático para comparar mediciones de carga/descarga de un capacitor con el modelo teórico RC. Está preparado para publicarse con GitHub Pages.

## Archivos
- `index.html`: interfaz y secciones de resultados.
- `styles.css`: presentación adaptable a computadora y móvil.
- `app.js`: lectura CSV, interpolación, métodos de raíces, derivación e integración.
- `ejemplo_sintetico.csv`: datos sintéticos para probar la interfaz (NO son datos experimentales).
- `arduino_rc_logger.ino`: programa base de adquisición para Arduino Uno.

## CSV esperado
Cabecera: `fase,tiempo_s,voltaje_V`

Cada fila usa `carga` o `descarga`, el tiempo en segundos contado desde el inicio de ESA fase y el voltaje del capacitor en voltios. Usa punto decimal. La web acepta también nombres de cabecera habituales en español/inglés.

## Probar localmente
1. Descomprime todos los archivos en una misma carpeta.
2. Abre `index.html` con un navegador moderno y conexión a internet. Si el navegador no permite leer el CSV de ejemplo al abrirlo localmente, selecciona el archivo con el botón CSV. También puedes ejecutar un servidor local, por ejemplo la extensión Live Server de Visual Studio Code.
3. Pulsa `Cargar datos de ejemplo` o selecciona un CSV propio.
4. Cambia R, C, Vs o la fase y pulsa `Analizar datos`.

## Publicar con GitHub Pages
1. Crea un repositorio público, por ejemplo `proyecto-metodos-numericos-rc`.
2. Sube todos los archivos (`index.html`, `styles.css`, `app.js`, `README.md`, `arduino_rc_logger.ino` y `ejemplo_sintetico.csv`) a la raíz del repositorio.
3. En el repositorio entra a Settings → Pages.
4. En Build and deployment elige `Deploy from a branch`; selecciona la rama `main` y la carpeta `/(root)`; pulsa Save.
5. Espera a que la publicación termine y abre la URL mostrada en Settings → Pages. Debe existir `index.html` en la raíz.
6. Prueba la web pública desde una ventana incógnita y desde el teléfono.

## Métodos incluidos (versión inicial)
- Interpolación lineal, Lagrange local y Newton por diferencias divididas.
- Bisección, Newton-Raphson y secante sobre el modelo RC teórico.
- Cruce de umbral experimental por interpolación lineal.
- Diferencias finitas hacia adelante, atrás y central para dVc/dt.
- Integración de corriente estimada con trapecios y Simpson 1/3 (trapecio final si el número de intervalos es impar).

Antes de entregar, contrasta esta lista con las diapositivas y la rúbrica del profesor. Si requiere otros métodos, deben añadirse de forma explícita.

## Nota sobre Arduino
La fórmula `V = raw * (VREF/1023.0)` es aproximada; calibra VREF si quieres una lectura más precisa. Abre el Monitor Serie a 115200 baudios. El programa registra un ciclo de carga y descarga por ejecución; guarda ese resultado como un CSV. Para repetir, reinicia la placa y guarda cada repetición en un archivo distinto, evitando combinar filas con tiempos duplicados.

El circuito propuesto usa D8 para cargar y descargar a través de una resistencia de 1 kΩ. Capacitor positivo al nodo A0 y negativo a GND. Respeta la polaridad del electrolítico y no excedas la tensión permitida por la placa.
