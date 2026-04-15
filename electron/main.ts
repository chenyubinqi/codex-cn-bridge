import { app, Menu, Tray } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';

let tray: Tray | null = null;
let bridgeProcess: ChildProcess | null = null;

const isRunning = (): boolean => {
  return bridgeProcess !== null && bridgeProcess.pid !== null;
};

function homedir(): string {
  return process.env["HOME"] ?? process.env["USERPROFILE"] ?? "/tmp";
}

function findConfigFile(): string {
  // Follow the same search order as src/config.ts
  const searchPaths = [
    process.env["BRIDGE_CONFIG"] ?? "",
    path.join(homedir(), ".codex-cn-bridge.yaml"),
    path.join(homedir(), ".config", "codex-cn-bridge", "config.yaml"),
    path.join(process.cwd(), ".codex-cn-bridge.yaml"),
    path.join(process.cwd(), "config.yaml"),
  ];

  for (const filePath of searchPaths) {
    if (!filePath) continue;
    if (fs.existsSync(filePath)) {
      return filePath;
    }
  }

  // If no config found, create default in home directory
  const defaultPath = path.join(homedir(), ".codex-cn-bridge.yaml");
  if (!fs.existsSync(defaultPath)) {
    const defaultConfig = `# Codex CN Bridge 配置文件
# 详细文档: https://github.com/samchen2008/codex-cn-bridge

# 当前激活的 provider
provider: deepseek

# 服务监听端口
port: 8088

# 日志级别: debug | info | warn | error
log_level: info

# 配置多个 provider
providers:
  deepseek:
    base_url: https://api.deepseek.com/v1
    api_key: \${API_KEY}  # 或者直接填写 sk-xxx
    model_map:
      "*": deepseek-chat

  aliyun:
    base_url: https://dashscope.aliyuncs.com/compatible-mode/v1
    api_key: \${DASHSCOPE_API_KEY}
    model_map:
      "*": qwen-plus

  moonshot:
    base_url: https://api.moonshot.cn/v1
    api_key: \${MOONSHOT_API_KEY}
    model_map:
      "*": moonshot-v1-8k

  zhipu:
    base_url: https://open.bigmodel.cn/api/paas/v4
    api_key: \${ZHIPU_API_KEY}
    model_map:
      "*": glm-4-plus

  # 本地 Ollama
  ollama:
    base_url: http://localhost:11434/v1
    api_key: ollama
    model_map:
      "*": qwen2.5:7b
`;
    fs.writeFileSync(defaultPath, defaultConfig, "utf-8");
  }
  return defaultPath;
}

function findNodePath(): string {
  // If not packaged, use process.execPath
  if (!app.isPackaged) {
    return process.execPath;
  }

  // On packaged app, find node in system
  const nodePaths: string[] = [];

  if (process.platform === 'darwin') {
    nodePaths.push('/opt/homebrew/bin/node');
    nodePaths.push('/usr/local/bin/node');
    nodePaths.push('/usr/bin/node');
  } else if (process.platform === 'linux') {
    nodePaths.push('/usr/local/bin/node');
    nodePaths.push('/usr/bin/node');
    nodePaths.push('/snap/bin/node');
  } else if (process.platform === 'win32') {
    // Windows common locations
    nodePaths.push('C:\\Program Files\\nodejs\\node.exe');
    nodePaths.push('C:\\Program Files (x86)\\nodejs\\node.exe');
    nodePaths.push(process.env.LOCALAPPDATA + '\\nodejs\\node.exe');
    // Just use 'node' from PATH
    return 'node';
  }

  for (const p of nodePaths) {
    try {
      if (fs.existsSync(p)) {
        return p;
      }
    } catch {}
  }

  // Fallback to PATH
  return 'node';
}

const getAssetPath = (filename: string): string => {
  // Packaged: extraResources goes to app/Contents/Resources/electron/assets/ (macOS)
  // On Windows/Linux: resources/electron/assets/
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'electron/assets', filename);
  }
  // Dev: relative to current directory
  return path.join(__dirname, 'assets', filename);
};

const getScriptPath = (): string => {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'dist/index.js');
  }
  return path.join(__dirname, '../dist/index.js');
};

const startBridge = () => {
  if (isRunning()) {
    console.log('Bridge is already running');
    return;
  }

  const scriptPath = getScriptPath();
  const nodePath = findNodePath();

  console.log(`Starting bridge: ${nodePath} ${scriptPath}`);
  bridgeProcess = spawn(nodePath, [scriptPath], {
    cwd: path.dirname(scriptPath),
    env: { ...process.env },
  });

  bridgeProcess.stdout?.on('data', (data) => {
    console.log(`[bridge] ${data}`);
  });

  bridgeProcess.stderr?.on('data', (data) => {
    console.error(`[bridge error] ${data}`);
  });

  bridgeProcess.on('close', (code) => {
    console.log(`Bridge exited with code ${code}`);
    bridgeProcess = null;
    updateTrayMenu();
  });

  updateTrayMenu();
};

const stopBridge = () => {
  if (!isRunning() || !bridgeProcess) {
    return;
  }

  bridgeProcess.kill('SIGTERM');
  bridgeProcess = null;
  updateTrayMenu();
};

const toggleBridge = () => {
  if (isRunning()) {
    stopBridge();
  } else {
    startBridge();
  }
};

const updateTrayMenu = () => {
  if (!tray) return;

  const menu = Menu.buildFromTemplate([
    {
      label: isRunning() ? '✅ 服务已启动 (127.0.0.1:8088)' : '⏸️  服务已停止',
      enabled: false,
    },
    { type: 'separator' },
    {
      label: isRunning() ? '停止服务' : '启动服务',
      click: () => toggleBridge(),
    },
    { type: 'separator' },
    {
      label: '打开配置文件',
      click: () => {
        const configPath = findConfigFile();
        require('electron').shell.openPath(configPath);
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        if (isRunning()) {
          stopBridge();
        }
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(menu);
  tray.setImage(getAssetPath(isRunning() ? 'icon-green.png' : 'icon-gray.png'));
};

app.whenReady().then(() => {
  // Hide dock icon on macOS
  if (app.dock) {
    app.dock.hide();
  }

  const iconPath = getAssetPath('icon-gray.png');
  tray = new Tray(iconPath);
  tray.setToolTip('Codex CN Bridge');
  updateTrayMenu();

  // Auto-start on app launch
  startBridge();
});

app.on('activate', () => {
  // Do nothing, keep app in menu bar
});

app.on('window-all-closed', () => {
  // Do nothing, keep app running in menu bar
});

app.on('before-quit', () => {
  if (isRunning()) {
    stopBridge();
  }
});
