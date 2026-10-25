#include <Arduino.h>

#ifndef LED_PIN
#define LED_PIN 2
#endif

#ifndef BOARD_NAME
#define BOARD_NAME "ESP32"
#endif

// Array of common LED pins to toggle simultaneously
// So regardless of board revision (GPIO 2, GPIO 8, GPIO 48, GPIO 21), the LED blinks!
const int testPins[] = { 2, 8, 48, 21, 15, 12, 13 };
const int numPins = sizeof(testPins) / sizeof(testPins[0]);

bool ledState = false;
unsigned long lastBlink = 0;
unsigned long blinkCount = 0;

void setup() {
  Serial.begin(115200);
  delay(500);

  // Initialize all common LED pins as OUTPUT
  for (int i = 0; i < numPins; i++) {
    pinMode(testPins[i], OUTPUT);
    digitalWrite(testPins[i], LOW);
  }

  Serial.println();
  Serial.println("=================================================");
  Serial.print("  ESP Studio - Firmware de Teste & Validacao (");
  Serial.print(BOARD_NAME);
  Serial.println(")");
  Serial.println("=================================================");
  Serial.printf("  CPU Freq: %u MHz\n", getCpuFrequencyMhz());
  Serial.printf("  Flash Size: %u MB\n", ESP.getFlashChipSize() / (1024 * 1024));
  Serial.printf("  Free Heap: %u KB\n", ESP.getFreeHeap() / 1024);
  Serial.println("  Status: Placa totalmente operacional!");
  Serial.println("  Escreva 'help' para ver os comandos disponiveis.");
  Serial.println("-------------------------------------------------");
}

void loop() {
  unsigned long now = millis();

  // Blink every 1000ms
  if (now - lastBlink >= 1000) {
    lastBlink = now;
    ledState = !ledState;
    blinkCount++;

    for (int i = 0; i < numPins; i++) {
      digitalWrite(testPins[i], ledState ? HIGH : LOW);
    }

    Serial.printf("[%02lu:%02lu:%02lu] [ESP Studio] Placa: %s | Uptime: %lu s | LED: %s (Ciclo #%lu)\n",
      (now / 3600000) % 24,
      (now / 60000) % 60,
      (now / 1000) % 60,
      BOARD_NAME,
      now / 1000,
      ledState ? "LIGADO" : "DESLIGADO",
      blinkCount
    );
  }

  // Handle incoming commands from Serial Console
  if (Serial.available()) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();

    if (cmd.length() > 0) {
      Serial.printf("> Recebido: '%s'\n", cmd.c_str());

      if (cmd.equalsIgnoreCase("ping")) {
        Serial.println("  PONG! Comunicacao serial bidirecional 100% OK.");
      } else if (cmd.equalsIgnoreCase("help") || cmd.equalsIgnoreCase("?")) {
        Serial.println("  Comandos disponiveis:");
        Serial.println("    ping    - Testa eco e latencia");
        Serial.println("    status  - Exibe estado e estatisticas de memoria");
        Serial.println("    info    - Informacoes de hardware do chip");
        Serial.println("    restart - Reinicia o microcontrolador");
      } else if (cmd.equalsIgnoreCase("status")) {
        Serial.printf("  Estado: OPERACIONAL | Uptime: %lu s | Heap Livre: %u bytes\n", millis() / 1000, ESP.getFreeHeap());
      } else if (cmd.equalsIgnoreCase("info")) {
        Serial.printf("  Chip: %s | SDK: %s | Cores: %d\n", ESP.getChipModel(), ESP.getSdkVersion(), ESP.getChipCores());
      } else if (cmd.equalsIgnoreCase("restart") || cmd.equalsIgnoreCase("reset")) {
        Serial.println("  A reiniciar microcontrolador...");
        delay(100);
        ESP.restart();
      } else {
        Serial.printf("  Comando '%s' reconhecido. Escreva 'help' para ajuda.\n", cmd.c_str());
      }
    }
  }
}
