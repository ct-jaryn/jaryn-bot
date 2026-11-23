'use strict'
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { DEFAULT_URL, loadConfig, saveConfig, normalizeServerUrl } = require('./config.cjs')

let mainWindow = null

function userData() {
  return app.getPath('userData')
}

function currentConfig() {
  return loadConfig(userData())
}

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0f1115',
    title: 'jaryn',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  mainWindow.on('closed', () => { mainWindow = null })
  loadUi(url)
  return mainWindow
}

function loadUi(url) {
  if (!mainWindow) return
  if (!url) {
    mainWindow.loadFile(path.join(__dirname, 'setup.html'))
    return
  }
  mainWindow.loadURL(url).catch(() => showSetup(`无法连接 ${url}`))
}

function showSetup(message) {
  if (!mainWindow) return
  mainWindow.loadFile(path.join(__dirname, 'setup.html'))
  if (message) dialog.showMessageBox({ type: 'warning', message, buttons: ['好'] })
}

function buildMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    {
      label: '连接',
      submenu: [
        { label: '重新连接', accelerator: 'CmdOrCtrl+R', click: () => loadUi(currentConfig().serverUrl) },
        { label: '更改服务器…', click: () => mainWindow && mainWindow.loadFile(path.join(__dirname, 'setup.html')) },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: '视图',
      submenu: [
        { role: 'reload' }, { role: 'toggleDevTools' },
        { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' }, { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [{ label: '打开仓库', click: () => shell.openExternal('https://github.com/ct-jaryn/jaryn-bot') }],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

ipcMain.handle('jaryn:get-config', () => currentConfig())
ipcMain.handle('jaryn:set-config', async (_event, { serverUrl, apiToken }) => {
  const url = normalizeServerUrl(serverUrl)
  if (!url) throw new Error('服务器地址无效，请填写 http(s):// 开头的地址')
  saveConfig(userData(), url, apiToken)
  loadUi(url)
  return { serverUrl: url }
})
ipcMain.handle('jaryn:open-setup', () => { if (mainWindow) mainWindow.loadFile(path.join(__dirname, 'setup.html')) })

app.whenReady().then(() => {
  buildMenu()
  const cfg = currentConfig()
  createWindow(cfg.configured ? cfg.serverUrl : null)
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(currentConfig().configured ? currentConfig().serverUrl : null) })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })

// Guard against unexpected navigations to arbitrary schemes.
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  contents.on('will-navigate', (event, url) => {
    const cfg = currentConfig()
    if (!cfg.serverUrl) return
    if (!String(url).startsWith(cfg.serverUrl)) event.preventDefault()
  })
  void fs
  void DEFAULT_URL
})
