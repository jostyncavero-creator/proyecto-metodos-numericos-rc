/*
  Registro de carga y descarga de un circuito RC.
  Conexion: D8 -- R (1 kohm) -- nodo Vc/A0 -- capacitor (+)
  Capacitor (-) a GND. Todos los GND deben ser comunes.
  Exporta por Serial en formato CSV: fase,tiempo_s,voltaje_V
  Ajusta VREF al voltaje de referencia real aproximado del Arduino.
*/
const byte CONTROL_PIN = 8;
const byte MEASURE_PIN = A0;
const float VREF = 5.00;                 // Mejor: calibrar con multimetro
const unsigned long SAMPLE_US = 20000;   // 20 ms = 50 muestras por segundo
const unsigned long DURATION_US = 6000000; // 6 segundos por fase

float readCapacitorVoltage() {
  int raw = analogRead(MEASURE_PIN);
  return raw * (VREF / 1023.0);
}

void recordPhase(const char *phase, bool pinHigh) {
  digitalWrite(CONTROL_PIN, pinHigh ? HIGH : LOW);
  delay(100); // estabilizacion breve antes de iniciar el reloj de la fase
  unsigned long start = micros();
  unsigned long nextSample = start;
  for (unsigned long target = 0; target <= DURATION_US; target += SAMPLE_US) {
    nextSample = start + target;
    while ((long)(micros() - nextSample) < 0) { }
    float t = (micros() - start) / 1000000.0;
    float v = readCapacitorVoltage();
    Serial.print(phase);
    Serial.print(',');
    Serial.print(t, 5);
    Serial.print(',');
    Serial.println(v, 5);
  }
}

void setup() {
  pinMode(CONTROL_PIN, OUTPUT);
  digitalWrite(CONTROL_PIN, LOW);
  Serial.begin(115200);
  delay(1000);
  Serial.println("fase,tiempo_s,voltaje_V");
  // Descarga inicial para empezar la prueba con el capacitor cerca de 0 V.
  digitalWrite(CONTROL_PIN, LOW);
  delay(5000);
}

void loop() {
  static bool completed = false;
  if (completed) return;
  recordPhase("carga", true);
  recordPhase("descarga", false);
  completed = true; // un ciclo por ejecución para evitar tiempos duplicados en el CSV
}
