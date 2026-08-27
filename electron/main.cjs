const { app, BrowserWindow, dialog, ipcMain, Menu } = require('electron')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

let apiServer

async function createWindow() {
  if (!apiServer) {
    const serverUrl = pathToFileURL(path.join(__dirname, '..', 'dist-server', 'index.js')).href
    const { startServer } = await import(serverUrl)
    apiServer = await startServer({ port: 8787, serveWeb: !process.env.VITE_DEV_SERVER_URL })
  }

  Menu.setApplicationMenu(null)

  const window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 960,
    minHeight: 680,
    title: 'FSR',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    backgroundColor: '#f5f4ef',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  const target = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:8787'
  await window.loadURL(target)
}

ipcMain.handle('choose-folder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
  return result.canceled ? null : result.filePaths[0]
})

app.whenReady().then(createWindow)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
app.on('before-quit', () => apiServer?.close())
