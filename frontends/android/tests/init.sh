#!/usr/bin/env bash
set -euo pipefail

# === CONFIG ===
ANDROID_HOME="$HOME/Android"
SDK_ROOT="$ANDROID_HOME/sdk"
EMULATOR_NAME="test_emulator"
DEVICE="pixel_4"
ANDROID_VERSION="30"   # Android 11
ABI="x86_64"
CHROMEDRIVER_VERSION="113.0.5672.63"

# === INSTALL HOMEBREW (if not already installed) ===
if ! command -v brew &>/dev/null; then
  echo "Installing Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi

# === INSTALL DEPENDENCIES ===
brew install --cask temurin     # Java
brew install --cask android-studio || true
brew install wget unzip node

# === SET ENVIRONMENT VARIABLES ===
if ! grep -q "ANDROID_HOME" ~/.zshrc; then
  echo "export ANDROID_HOME=$SDK_ROOT" >> ~/.zshrc
  echo "export PATH=\$ANDROID_HOME/cmdline-tools/latest/bin:\$ANDROID_HOME/platform-tools:\$ANDROID_HOME/emulator:\$PATH" >> ~/.zshrc
fi

mkdir -p "$SDK_ROOT/cmdline-tools"

# === DOWNLOAD AND INSTALL CMDLINE-TOOLS (SDK) ===
if [ ! -d "$SDK_ROOT/cmdline-tools/latest" ]; then
  echo "Downloading Android cmdline-tools..."
  wget -q https://dl.google.com/android/repository/commandlinetools-mac-11076708_latest.zip -O /tmp/cmdline-tools.zip
  unzip -q /tmp/cmdline-tools.zip -d "$SDK_ROOT/cmdline-tools"
  mv "$SDK_ROOT/cmdline-tools/cmdline-tools" "$SDK_ROOT/cmdline-tools/latest"
fi


# === INSTALL SDK COMPONENTS ===
sdkmanager --sdk_root="$SDK_ROOT" \
  "platform-tools" \
  "platforms;android-$ANDROID_VERSION" \
  "system-images;android-$ANDROID_VERSION;google_apis;$ABI" \
  "emulator"

# === CREATE EMULATOR ===
if ! avdmanager list avd | grep -q "$EMULATOR_NAME"; then
  echo "Creating emulator $EMULATOR_NAME..."
  echo "no" | avdmanager create avd \
    --name "$EMULATOR_NAME" \
    --package "system-images;android-$ANDROID_VERSION;google_apis;$ABI" \
    --device "$DEVICE"
fi

# === DOWNLOAD CHROMEDRIVER ===
mkdir -p "$ANDROID_HOME/emulator"
cd "$ANDROID_HOME/emulator"

if [ ! -f "chromedriver" ]; then
  wget -q "https://chromedriver.storage.googleapis.com/$CHROMEDRIVER_VERSION/chromedriver_mac64.zip"
  unzip -o chromedriver_mac64.zip
  mv chromedriver "chromedriver-$CHROMEDRIVER_VERSION"
  chmod +x "chromedriver-$CHROMEDRIVER_VERSION"
  ln -sf "$ANDROID_HOME/emulator/chromedriver-$CHROMEDRIVER_VERSION" "$ANDROID_HOME/emulator/chromedriver"
  rm chromedriver_mac64.zip
fi

# === SANITY CHECK ===
echo "🚀 Starting emulator..."
nohup emulator -avd "$EMULATOR_NAME" -no-snapshot -no-audio -no-window >/dev/null 2>&1 &

echo "⏳ Waiting for emulator to boot..."
adb wait-for-device

adb devices   # should list emulator
"$ANDROID_HOME/emulator/chromedriver" --version

echo "✅ Android emulator + Chromedriver are set up correctly!"
echo
echo "Next steps:"
echo "1. In your project: npm install"
echo "2. Start Appium: npx appium"
echo "3. Run your test: npx mocha e2e/base.test.js"

