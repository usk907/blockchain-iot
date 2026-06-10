int xPin = A0;
int yPin = A1;

int xCenter = 512;
int yCenter = 512;

int stepSize = 10;   // sensitivity

void setup() {
  Serial.begin(9600);
}

void loop() {

  int rawX = analogRead(xPin);
  int rawY = analogRead(yPin);

  int x = (rawX - xCenter) / stepSize;
  int y = (rawY - yCenter) / stepSize;

  Serial.print("X: ");
  Serial.print(x);

  Serial.print("  Y: ");
  Serial.println(y);

  delay(800);
}