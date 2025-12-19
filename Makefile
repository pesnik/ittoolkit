# Makefile for IT Toolkit v3

APP_NAME = ittoolkit
TAURI_DIR = src-tauri
TARGET_DIR = $(TAURI_DIR)/target/release/bundle
DIST_DIR = dist
VERSION = $(shell grep '"version":' package.json | cut -d '"' -f 4)

.PHONY: all build zip clean

all: build zip

build:
	@echo "Building $(APP_NAME)..."
	npm run tauri build

zip:
	@echo "Creating portable zip archive..."
	@mkdir -p $(DIST_DIR)
	@# macOS
	@if [ -d "$(TARGET_DIR)/macos/$(APP_NAME).app" ]; then \
		echo "Zipping macOS app..."; \
		cd $(TARGET_DIR)/macos && zip -r ../../../$(DIST_DIR)/$(APP_NAME)-macos-$(VERSION).zip $(APP_NAME).app; \
	fi
	@# Linux (AppImage)
	@if [ -f "$(TARGET_DIR)/appimage/$(APP_NAME)_$(VERSION)_amd64.AppImage" ]; then \
		echo "Copying Linux AppImage..."; \
		cp $(TARGET_DIR)/appimage/$(APP_NAME)_$(VERSION)_amd64.AppImage $(DIST_DIR)/$(APP_NAME)-linux-$(VERSION).AppImage; \
	fi
	@# Windows (if cross-compiled or run on Windows with Make)
	@if [ -f "$(TARGET_DIR)/nsis/$(APP_NAME)_$(VERSION)_x64-setup.exe" ]; then \
		echo "Copying Windows Installer..."; \
		cp $(TARGET_DIR)/nsis/$(APP_NAME)_$(VERSION)_x64-setup.exe $(DIST_DIR)/$(APP_NAME)-windows-setup-$(VERSION).exe; \
	fi
	@echo "Build artifacts available in $(DIST_DIR)/"

clean:
	@echo "Cleaning up..."
	rm -rf $(DIST_DIR)
	rm -rf $(TAURI_DIR)/target
