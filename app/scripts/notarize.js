#!/usr/bin/env node

const { notarize } = require('@electron/notarize');

exports.default = async function notarizeApp(context) {
  const { electronPlatformName, appOutDir } = context;
  
  if (electronPlatformName !== 'darwin') {
    return;
  }

  // Skip notarization in development
  if (process.env.NODE_ENV === 'development') {
    console.log('Skipping notarization in development mode');
    return;
  }

  const appName = context.packager.appInfo.productFilename;

  // Check for required environment variables
  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_ID_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  if (!appleId || !appleIdPassword || !teamId) {
    console.warn('Skipping notarization: Missing Apple credentials');
    return;
  }

  console.log(`Notarizing ${appName}...`);

  return await notarize({
    appBundleId: 'com.maxsort.app',
    appPath: `${appOutDir}/${appName}.app`,
    appleId: appleId,
    appleIdPassword: appleIdPassword,
    teamId: teamId,
  });
};
