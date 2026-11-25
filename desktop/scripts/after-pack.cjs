'use strict'
/**
 * electron-builder afterPack hook.
 *
 * On macOS we have no Developer ID certificate in CI, so electron-builder leaves the
 * app with only Electron's linker-signed binary. That makes Gatekeeper report the app
 * as "damaged". Ad-hoc signing the whole bundle (codesign --sign -) seals resources and
 * binds Info.plist, so users get the standard "unidentified developer" prompt instead.
 *
 * Real distribution still needs a Developer ID + notarization (see docs/operations/release.md).
 */
const { execFileSync } = require('node:child_process')
const path = require('node:path')

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const appName = context.packager.appInfo.productFilename
  const appPath = path.join(context.appOutDir, `${appName}.app`)
  console.log(`[after-pack] ad-hoc signing ${appPath}`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', appPath], { stdio: 'inherit' })
  const verify = execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { encoding: 'utf8' })
  if (verify) console.log(verify)
  console.log('[after-pack] ad-hoc signature verified')
}
