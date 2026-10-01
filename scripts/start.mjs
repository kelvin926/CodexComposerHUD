if (process.platform === 'win32') await import('../launcher.mjs');
else if (process.platform === 'linux') await import('../launcher-linux.mjs');
else if (process.platform === 'darwin') await import('../launcher-macos.mjs');
else { console.error('Supported platforms: Windows, Linux and macOS'); process.exitCode = 1; }
