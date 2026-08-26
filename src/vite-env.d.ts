/// <reference types="vite/client" />

interface Window {
  desktopApi?: {
    chooseFolder: () => Promise<string | null>
  }
}
