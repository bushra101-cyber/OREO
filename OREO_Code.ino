#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <DHT.h>

void score(double *input, double *output);

#define MQ5_PIN 34
#define FLAME_PIN 32
#define VIB_PIN 33

#define TRIG_PIN 17
#define ECHO_PIN 18

#define DHT_PIN 27
#define DHT_TYPE DHT11

#define BUZZER_PIN 25
#define RED_LED_PIN 2
#define YELLOW_LED_PIN 4

LiquidCrystal_I2C lcd(0x27, 16, 2);
DHT dht(DHT_PIN, DHT_TYPE);


// ================= MINE BLACK BOX =================

#define BUFFER_SIZE 60

struct SensorRecord {
  unsigned long time;
  int gas;
  bool flame;
  bool vibration;
  float distance;
  float temperature;
  float humidity;
};

SensorRecord blackBox[BUFFER_SIZE];

int bufferIndex = 0;
bool blackBoxFrozen = false;
// Add near other global variables:
int hazardLabel = 0;
double hazardConfidence = 0.0;

// ================= SETUP =================

void setup() {
  Serial.begin(115200);

  pinMode(FLAME_PIN, INPUT);
  pinMode(VIB_PIN, INPUT);

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);

  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(RED_LED_PIN, OUTPUT);
  pinMode(YELLOW_LED_PIN, OUTPUT);

  Wire.begin(21, 22);

  lcd.init();
  lcd.backlight();

  dht.begin();

  digitalWrite(BUZZER_PIN, LOW);
  digitalWrite(RED_LED_PIN, LOW);
  digitalWrite(YELLOW_LED_PIN, HIGH);

  lcd.clear();
  lcd.print("OREO SYSTEM");
  lcd.setCursor(0, 1);
  lcd.print("BLACKBOX READY");

  delay(2000);
  lcd.clear();

  Serial.println("================================");
  Serial.println("       OREO SYSTEM ONLINE       ");
  Serial.println("     MINE BLACKBOX ACTIVE       ");
  Serial.println("================================");
}

// ================= DISTANCE =================

float readDistance() {

  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);

  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);

  digitalWrite(TRIG_PIN, LOW);

  long duration = pulseIn(ECHO_PIN, HIGH, 30000);

  if (duration == 0)
    return -1;

  return duration * 0.0343 / 2.0;
}

// ================= SAVE TO BLACKBOX =================

void saveRecord(
  int gas,
  bool flame,
  bool vibration,
  float distance,
  float temperature,
  float humidity
) {

  if (blackBoxFrozen)
    return;

  blackBox[bufferIndex].time = millis() / 1000;
  blackBox[bufferIndex].gas = gas;
  blackBox[bufferIndex].flame = flame;
  blackBox[bufferIndex].vibration = vibration;
  blackBox[bufferIndex].distance = distance;
  blackBox[bufferIndex].temperature = temperature;
  blackBox[bufferIndex].humidity = humidity;

  bufferIndex++;

  if (bufferIndex >= BUFFER_SIZE)
    bufferIndex = 0;
}

// ================= FREEZE BLACKBOX =================

void freezeBlackBox() {

  if (blackBoxFrozen)
    return;

  blackBoxFrozen = true;

  Serial.println();
  Serial.println("!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
  Serial.println("   MINE BLACKBOX FROZEN");
  Serial.println("   INCIDENT DATA PRESERVED");
  Serial.println("!!!!!!!!!!!!!!!!!!!!!!!!!!!!");

  Serial.println("TIME | GAS | FLAME | VIB | DIST");

  for (int i = 0; i < BUFFER_SIZE; i++) {

    int index = (bufferIndex + i) % BUFFER_SIZE;

    Serial.print(blackBox[index].time);
    Serial.print(" | ");

    Serial.print(blackBox[index].gas);
    Serial.print(" | ");

    Serial.print(blackBox[index].flame);
    Serial.print(" | ");

    Serial.print(blackBox[index].vibration);
    Serial.print(" | ");

    Serial.println(blackBox[index].distance);
  }

  Serial.println("BLACKBOX END");
}

// Add this function anywhere before loop():
void runHazardPrediction(float temp, float hum, int gasValue, float dist) {
  double input[4];
  double output[4];

  input[0] = isnan(temp) ? 25.0 : temp;
  input[1] = isnan(hum) ? 50.0 : hum;
  input[2] = (double)gasValue/4.0;
  input[3] = (dist > 0) ? dist : 200.0;

  score(input, output);

  int bestClass = 0;
  double bestProb = output[0];
  for (int i = 1; i < 4; i++) {
    if (output[i] > bestProb) { bestProb = output[i]; bestClass = i; }
  }
  hazardLabel = bestClass;
  hazardConfidence = bestProb;
}

// ================= LOOP =================

void loop() {

  // -------- READ SENSORS --------

  int gasValue = analogRead(MQ5_PIN);

  bool flameDetected =
    digitalRead(FLAME_PIN) == LOW;

  bool vibrationDetected =
    digitalRead(VIB_PIN) == HIGH;

  float distance = readDistance();

  float temperature =
    dht.readTemperature();

  float humidity =
    dht.readHumidity();

  runHazardPrediction(temperature, humidity, gasValue, distance);
  // -------- HAZARD LOGIC --------

  bool gasHazard =
    gasValue > 1800;

  bool distanceHazard =
    distance > 0 && distance < 25;

  bool hazardDetected =
    gasHazard ||
    flameDetected ||
    vibrationDetected ||
    distanceHazard;

  // -------- SAVE HISTORY --------

  saveRecord(
    gasValue,
    flameDetected,
    vibrationDetected,
    distance,
    temperature,
    humidity
  );

  // -------- HAZARD RESPONSE --------

  if (hazardDetected) {

    digitalWrite(RED_LED_PIN, HIGH);
    digitalWrite(YELLOW_LED_PIN, LOW);
    digitalWrite(BUZZER_PIN, HIGH);

    freezeBlackBox();

    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("!! EMERGENCY !!");
    lcd.setCursor(0, 1);
    lcd.print("BLACKBOX FROZEN");

  }

  else {

    digitalWrite(RED_LED_PIN, LOW);
    digitalWrite(YELLOW_LED_PIN, HIGH);
    digitalWrite(BUZZER_PIN, LOW);

    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("OREO SAFE");

    lcd.setCursor(0, 1);
    lcd.print("D:");

    if (distance < 0)
      lcd.print("--");
    else
      lcd.print(distance, 0);

    lcd.print(" G:");
    lcd.print(gasValue);
  }

  // -------- SERIAL TELEMETRY --------

  Serial.println();
  Serial.println("========== OREO ==========");

  Serial.print("Gas: ");
  Serial.println(gasValue);

  Serial.print("Flame: ");
  Serial.println(
    flameDetected ? "DETECTED" : "CLEAR"
  );

  Serial.print("Vibration: ");
  Serial.println(
    vibrationDetected ? "DETECTED" : "CLEAR"
  );

  Serial.print("Distance: ");

  if (distance < 0)
    Serial.println("NO ECHO");
  else {
    Serial.print(distance);
    Serial.println(" cm");
  }

  Serial.print("Temperature: ");
  Serial.println(temperature);

  Serial.print("Humidity: ");
  Serial.println(humidity);

  Serial.print("BlackBox: ");
  Serial.println(
    blackBoxFrozen ? "FROZEN" : "RECORDING"
  );

  Serial.println("==========================");

  Serial.print("JSON:");
  Serial.print("{\"gas\":"); Serial.print(gasValue);
  Serial.print(",\"flame\":"); Serial.print(flameDetected ? "true" : "false");
  Serial.print(",\"vibration\":"); Serial.print(vibrationDetected ? "true" : "false");
  Serial.print(",\"distance\":"); Serial.print(distance);
  Serial.print(",\"temperature\":"); Serial.print(temperature);
  Serial.print(",\"humidity\":"); Serial.print(humidity);
  Serial.print(",\"hazard_label\":"); Serial.print(hazardLabel);
  Serial.print(",\"confidence\":"); Serial.print(hazardConfidence);
  delay(1000);
}