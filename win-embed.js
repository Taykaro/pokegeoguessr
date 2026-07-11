// Intégration native Windows : "aspire" la fenêtre d'un autre programme
// (BizHawk) dans une fenêtre hôte (Electron), via l'API Win32 (SetParent...).
// Les HWND sont traités comme des entiers (uintptr_t) — plus simple que des
// objets pointeur.
const koffi = require('koffi');
const user32 = koffi.load('user32.dll');

const EnumWindowsProc = koffi.proto('bool __stdcall EnumWindowsProc(uintptr_t hwnd, intptr_t lparam)');
const EnumWindows = user32.func('bool __stdcall EnumWindows(void *proc, intptr_t lparam)');
const GetWindowThreadProcessId = user32.func('uint32 __stdcall GetWindowThreadProcessId(uintptr_t hwnd, _Out_ uint32 *pid)');
const IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(uintptr_t hwnd)');
const GetWindow = user32.func('uintptr_t __stdcall GetWindow(uintptr_t hwnd, uint cmd)');
const GetWindowTextW = user32.func('int __stdcall GetWindowTextW(uintptr_t hwnd, _Out_ uint16 *s, int max)');
const SetParent = user32.func('uintptr_t __stdcall SetParent(uintptr_t child, uintptr_t parent)');
const GetWindowLongPtr = user32.func('intptr_t __stdcall GetWindowLongPtrW(uintptr_t hwnd, int idx)');
const SetWindowLongPtr = user32.func('intptr_t __stdcall SetWindowLongPtrW(uintptr_t hwnd, int idx, intptr_t val)');
const SetWindowPos = user32.func('bool __stdcall SetWindowPos(uintptr_t hwnd, uintptr_t after, int x, int y, int cx, int cy, uint flags)');
const ShowWindow = user32.func('bool __stdcall ShowWindow(uintptr_t hwnd, int cmd)');

const GWL_STYLE = -16;
const WS_CHILD = 0x40000000;
const WS_CAPTION = 0x00C00000;
const WS_THICKFRAME = 0x00040000;
const WS_POPUP = 0x80000000;
const SWP_NOZORDER = 0x0004, SWP_FRAMECHANGED = 0x0020, SWP_SHOWWINDOW = 0x0040;

function windowTitle(hwnd) {
  const buf = Buffer.alloc(512);
  const n = GetWindowTextW(hwnd, buf, 256);
  return buf.toString('ucs2', 0, n * 2);
}

// tous les HWND top-level d'un process donné, visibles, avec titre
function topWindowsOfPid(pid) {
  const found = [];
  const cb = koffi.register((hwnd, lparam) => {
    const out = [0];
    GetWindowThreadProcessId(hwnd, out);
    if (out[0] === pid && IsWindowVisible(hwnd)) {
      const t = windowTitle(hwnd);
      if (t) found.push({ hwnd, title: t });
    }
    return true;
  }, koffi.pointer(EnumWindowsProc));
  EnumWindows(cb, 0);
  koffi.unregister(cb);
  return found;
}

// aspire `childHwnd` dans `parentHwnd` (entier) à la position/taille données
function embed(childHwnd, parentHwnd, x, y, w, h) {
  let style = GetWindowLongPtr(childHwnd, GWL_STYLE);
  style = (BigInt(style) & ~BigInt(WS_CAPTION | WS_THICKFRAME | WS_POPUP)) | BigInt(WS_CHILD);
  SetWindowLongPtr(childHwnd, GWL_STYLE, style);
  SetParent(childHwnd, parentHwnd);
  SetWindowPos(childHwnd, 0, x, y, w, h, SWP_NOZORDER | SWP_FRAMECHANGED | SWP_SHOWWINDOW);
  ShowWindow(childHwnd, 1);
}

function move(childHwnd, x, y, w, h) {
  SetWindowPos(childHwnd, 0, x, y, w, h, SWP_NOZORDER | SWP_SHOWWINDOW);
}

// masque complètement une fenêtre (SW_HIDE) — pour cacher la console Lua.
function hide(hwnd) { ShowWindow(hwnd, 0); }

module.exports = { topWindowsOfPid, embed, move, hide, windowTitle };

// self-test : node win-embed.js  -> liste les fenêtres visibles
if (require.main === module) {
  const all = [];
  const cb = koffi.register((hwnd, lparam) => {
    if (IsWindowVisible(hwnd)) { const t = windowTitle(hwnd); if (t) all.push(t); }
    return true;
  }, koffi.pointer(EnumWindowsProc));
  EnumWindows(cb, 0);
  koffi.unregister(cb);
  console.log(`fenêtres visibles: ${all.length}`);
  all.slice(0, 25).forEach((t) => console.log('  ' + t));
}
