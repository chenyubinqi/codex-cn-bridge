const { execSync } = require('child_process');
const path = require('path');

/**
 * Re-sign the entire .app bundle with ad-hoc signing after packaging.
 *
 * This is required because the pre-built Electron Framework shipped by the
 * Electron project is signed with Electron's Apple Developer Team ID, while
 * the main app binary gets signed with a different (or empty) Team ID when no
 * Apple Developer certificate is present. macOS 15+ enforces that the main
 * process and all loaded frameworks share the same Team ID, so we unify
 * everything under ad-hoc signing ("-") here.
 */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);

  console.log(`[afterPack] Re-signing with ad-hoc: ${appPath}`);

  // Sign inner bundles (frameworks, helpers) first, then the outer .app.
  // --force  : overwrite existing signatures
  // --deep   : recurse into nested bundles
  // --sign - : ad-hoc signature (empty Team ID)
  execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: 'inherit' });

  console.log('[afterPack] Ad-hoc re-signing complete.');
};
