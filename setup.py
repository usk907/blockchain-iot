import os

PROJECT_NAME = "blockchain-iot-project"

# Folder structure
FOLDERS = [
    "blockchain/contracts",
    "blockchain/migrations",
    "blockchain/build/contracts",

    "backend",

    "iot",

    "frontend/public",
    "frontend/src/abi",

    "docs"
]

# Files to generate
FILES = [
    # Blockchain
    "blockchain/contracts/IoTData.sol",
    "blockchain/migrations/deploy.js",
    "blockchain/truffle-config.js",
    "blockchain/package.json",
    "blockchain/build/contracts/IoTData.json",

    # Backend
    "backend/server.js",
    "backend/registerDevice.js",
    "backend/ipfs.js",
    "backend/IoTDataABI.json",
    "backend/package.json",

    # IoT
    "iot/device.js",

    # Frontend
    "frontend/src/App.js",
    "frontend/src/Admin.js",
    "frontend/src/index.js",
    "frontend/src/App.css",
    "frontend/src/abi/IoTData.json",
    "frontend/package.json",

    # Docs
    "docs/architecture-diagram.png",
    "docs/report.docx",
    "docs/presentation.pptx",

    # Root files
    ".env",
    "README.md",
    "package.json"
]

def create_structure():
    # Create root project directory
    os.makedirs(PROJECT_NAME, exist_ok=True)

    # Create folders
    for folder in FOLDERS:
        path = os.path.join(PROJECT_NAME, folder)
        os.makedirs(path, exist_ok=True)

    # Create files
    for file in FILES:
        path = os.path.join(PROJECT_NAME, file)

        os.makedirs(os.path.dirname(path), exist_ok=True)

        if not os.path.exists(path):
            with open(path, "w") as f:
                f.write("")

    print("✅ Blockchain-IoT project structure created successfully.")

if __name__ == "__main__":
    create_structure()
